"""Auto-trim a raw OBS stream recording down to spans where a card is on screen.

    py -3 benchmark/two-stage/autotrim.py "C:\\Users\\Jarre\\Videos\\2026-09-16 12-11-34.mp4"
    py -3 benchmark/two-stage/autotrim.py <video> --sheet --extract

Crops to the Whatnot video-player region (same region as CAPTURE-NOTES.md's
crop=924:812:492:204, stored here as resolution-independent fractions), samples
at --fps, runs the existing OWLv2 zero-shot card detector (card_detect.py) per
frame, collapses the per-frame series into spans, and writes a manifest.
Does not cut .mp4 clips -- manifest + optional contact sheets/frames only.
"""
import argparse, io, json, pathlib, subprocess, sys

from PIL import Image, ImageDraw

from card_detect import detect_card

BENCH = pathlib.Path(__file__).parent.parent
OUT_DIR = BENCH / "_work" / "autotrim"

# Whatnot's player sits in the same spot on every recording seen so far
# (CAPTURE-NOTES.md, verified across ~5 different sellers' streams).
# Stored as fractions of frame size so it scales to any capture resolution.
LAYOUTS = {
    "whatnot-web-1080p": {"x": 492 / 1920, "y": 204 / 1080, "w": 924 / 1920, "h": 812 / 1080},
}
DEFAULT_LAYOUT = "whatnot-web-1080p"


def ffprobe(video):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-show_entries", "format=duration",
         "-of", "json", str(video)],
        capture_output=True, text=True, check=True,
    ).stdout
    d = json.loads(out)
    w = d["streams"][0]["width"]
    h = d["streams"][0]["height"]
    duration = float(d["format"]["duration"])
    return w, h, duration


def crop_rect(w, h, layout_name):
    L = LAYOUTS[layout_name]
    cx, cy = round(L["x"] * w), round(L["y"] * h)
    cw, ch = round(L["w"] * w), round(L["h"] * h)
    return cx, cy, cw, ch


def save_crop_debug(video, w, h, cx, cy, cw, ch, out_path, at=1.0):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", str(at), "-i", str(video),
         "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-"],
        capture_output=True, check=True,
    ).stdout
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    d = ImageDraw.Draw(im)
    d.rectangle((cx, cy, cx + cw, cy + ch), outline="lime", width=4)
    im.save(out_path)


def sample_frames(video, cx, cy, cw, ch, fps):
    """Yields (t_seconds, PIL.Image) decoded from the cropped region at `fps`."""
    cmd = [
        "ffmpeg", "-v", "error", "-i", str(video),
        "-vf", f"crop={cw}:{ch}:{cx}:{cy},fps={fps}",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    frame_bytes = cw * ch * 3
    i = 0
    try:
        while True:
            buf = proc.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            yield i / fps, Image.frombytes("RGB", (cw, ch), buf)
            i += 1
    finally:
        proc.stdout.close()
        proc.wait()


def build_spans(hits, gap, min_span, pad, duration):
    """hits: list of (t, result_or_None). Returns merged/padded spans."""
    raw = []
    cur = None
    for t, r in hits:
        if r is not None:
            if cur is None:
                cur = {"start": t, "end": t, "scores": [r["score"]], "boxes": [r["box"]]}
            elif t - cur["end"] <= gap:
                cur["end"] = t
                cur["scores"].append(r["score"])
                cur["boxes"].append(r["box"])
            else:
                raw.append(cur)
                cur = {"start": t, "end": t, "scores": [r["score"]], "boxes": [r["box"]]}
    if cur is not None:
        raw.append(cur)

    raw = [s for s in raw if (s["end"] - s["start"]) >= min_span]

    padded = []
    for s in raw:
        padded.append({
            "start": max(0.0, s["start"] - pad),
            "end": min(duration, s["end"] + pad),
            "scores": s["scores"],
            "boxes": s["boxes"],
        })

    merged = []
    for s in padded:
        if merged and s["start"] <= merged[-1]["end"]:
            merged[-1]["end"] = max(merged[-1]["end"], s["end"])
            merged[-1]["scores"] += s["scores"]
            merged[-1]["boxes"] += s["boxes"]
        else:
            merged.append(s)

    spans = []
    for s in merged:
        boxes = s["boxes"]
        med_box = [sorted(c)[len(c) // 2] for c in zip(*boxes)] if boxes else None
        spans.append({
            "start": round(s["start"], 2),
            "end": round(s["end"], 2),
            "duration": round(s["end"] - s["start"], 2),
            "n_frames": len(s["scores"]),
            "score_mean": round(sum(s["scores"]) / len(s["scores"]), 3),
            "score_max": round(max(s["scores"]), 3),
            "box_median": med_box,
        })
    return spans


def write_sheet(video, cx, cy, cw, ch, span, out_path, n=6):
    dur = span["end"] - span["start"]
    times = [span["start"] + dur * (i + 0.5) / n for i in range(n)]
    thumbs = []
    for t in times:
        raw = subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", str(t), "-i", str(video),
             "-vf", f"crop={cw}:{ch}:{cx}:{cy}", "-frames:v", "1",
             "-f", "image2pipe", "-vcodec", "mjpeg", "-"],
            capture_output=True, check=True,
        ).stdout
        thumbs.append(Image.open(io.BytesIO(raw)).convert("RGB"))
    if not thumbs:
        return
    tw, th = thumbs[0].size
    sheet = Image.new("RGB", (tw * len(thumbs), th), "black")
    for i, im in enumerate(thumbs):
        sheet.paste(im, (i * tw, 0))
    sheet.save(out_path)


def extract_frames(video, cx, cy, cw, ch, span, stem, seq_start, out_dir, fps=1):
    dur = span["end"] - span["start"]
    n = max(1, round(dur * fps))
    saved = 0
    for i in range(n):
        t = span["start"] + (i + 0.5) * dur / n
        raw = subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", str(t), "-i", str(video),
             "-vf", f"crop={cw}:{ch}:{cx}:{cy}", "-frames:v", "1",
             "-f", "image2pipe", "-vcodec", "mjpeg", "-"],
            capture_output=True, check=True,
        ).stdout
        name = f"{stem}-{seq_start + saved:03d}.jpg"
        (out_dir / name).write_bytes(raw)
        saved += 1
    return saved


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--layout", default=DEFAULT_LAYOUT, choices=list(LAYOUTS))
    ap.add_argument("--crop", help="override as x,y,w,h in pixels")
    ap.add_argument("--fps", type=float, default=2.0, help="detection sample rate")
    ap.add_argument("--min-score", type=float, default=0.15, help="drop detections below this score before building spans (card_detect's own floor is 0.15; low scores near that floor are often a false positive on a facecam overlay or similar rectangle, not a card)")
    ap.add_argument("--gap", type=float, default=1.5, help="seconds of no-detection to bridge within a span")
    ap.add_argument("--min-span", type=float, default=2.0, help="drop spans shorter than this (pre-padding)")
    ap.add_argument("--pad", type=float, default=0.5, help="seconds added to each side of a kept span")
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--sheet", action="store_true", help="write a contact-sheet montage per kept span")
    ap.add_argument("--extract", action="store_true", help="write frames from kept spans into benchmark/frames-style output")
    ap.add_argument("--extract-fps", type=float, default=1.0)
    args = ap.parse_args()

    video = pathlib.Path(args.video)
    stem = video.stem.replace(" ", "_")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    w, h, duration = ffprobe(video)
    if args.crop:
        cx, cy, cw, ch = (int(v) for v in args.crop.split(","))
    else:
        cx, cy, cw, ch = crop_rect(w, h, args.layout)

    debug_path = OUT_DIR / f"{stem}_crop_debug.jpg"
    save_crop_debug(video, w, h, cx, cy, cw, ch, debug_path, at=min(1.0, duration / 2))
    print(f"{video.name}: {w}x{h}, {duration:.1f}s, crop=({cx},{cy},{cw},{ch}) -> {debug_path.name}")

    hits = []
    batch_t, batch_im = [], []

    def flush():
        if not batch_im:
            return
        for t, r in zip(batch_t, detect_card(batch_im)):
            hits.append((t, r))
        batch_t.clear()
        batch_im.clear()

    for t, im in sample_frames(video, cx, cy, cw, ch, args.fps):
        batch_t.append(t)
        batch_im.append(im)
        if len(batch_im) >= args.batch:
            flush()
    flush()

    hits = [(t, r if (r and r["score"] >= args.min_score) else None) for t, r in hits]
    spans = build_spans(hits, args.gap, args.min_span, args.pad, duration)
    kept = sum(s["duration"] for s in spans)

    manifest = {
        "source": str(video),
        "duration": round(duration, 2),
        "fps_sampled": args.fps,
        "layout": args.layout if not args.crop else "custom",
        "crop": [cx, cy, cw, ch],
        "spans": spans,
        "kept_seconds": round(kept, 2),
        "dropped_seconds": round(duration - kept, 2),
    }
    manifest_path = OUT_DIR / f"{stem}.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"{len(spans)} spans, kept {kept:.1f}s / dropped {duration - kept:.1f}s of {duration:.1f}s -> {manifest_path.name}")

    if args.sheet:
        for i, s in enumerate(spans):
            write_sheet(video, cx, cy, cw, ch, s, OUT_DIR / f"{stem}_span{i:02d}_sheet.jpg")

    if args.extract:
        frames_dir = OUT_DIR / f"{stem}_frames"
        frames_dir.mkdir(exist_ok=True)
        seq = 1
        for s in spans:
            seq += extract_frames(video, cx, cy, cw, ch, s, stem, seq, frames_dir, args.extract_fps)
        print(f"extracted frames -> {frames_dir}")

    for s in spans:
        print(f"  [{s['start']:7.2f} - {s['end']:7.2f}] {s['duration']:5.2f}s  n={s['n_frames']:3d}  score {s['score_mean']:.2f}/{s['score_max']:.2f}")


if __name__ == "__main__":
    sys.exit(main())
