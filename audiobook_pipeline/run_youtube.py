"""End-to-end: YouTube playlist (already-narrated audio) -> segmented,
chapter-tagged m4b. No TTS, no Whisper validation -- there's no source text
to synthesize from or diff against, this is real human speech being
repackaged, not generated.

Usage:
  venv\\Scripts\\python.exe run_youtube.py "<playlist url>" "<book title>" ["<author>"]

Resumable: downloads use a yt-dlp archive and normalized segments are kept in
WORK_ROOT until the m4b is written, so a killed run picks up where it stopped.
"""
import os
import shutil
import sys
from pathlib import Path

from epub_extract import safe_name
from extract_youtube import download_playlist
from segment_audio import segment_audio_chapter, probe_duration
from segment import HARD_CEILING_MIN
from normalize import normalize_wav
from package import package_m4b

# Final deliverable only. Point AUDIOBOOK_OUT_DIR at a synced folder to reach a phone.
OUT_ROOT = Path(os.environ.get("AUDIOBOOK_OUT_DIR", str(Path.home() / "Audiobooks")))
# Intermediate downloads/splits/normalized wavs -- local only, never synced.
# A prior run put these under OUT_ROOT and the sync client queued ~13GB of scratch
# audio ahead of the actual m4b, delaying it reaching the phone.
WORK_ROOT = Path(os.environ.get("AUDIOBOOK_WORK_DIR", str(Path(__file__).resolve().parent / "_work")))
MAX_RETRIES = 3


def run(playlist_url: str, title: str, author: str = ""):
    book_name = safe_name(f"{title} - {author}" if author else title)
    work_dir = WORK_ROOT / book_name
    dl_dir = work_dir / "_download"
    out_dir = OUT_ROOT / book_name
    out_m4b = out_dir / f"{book_name}.m4b"

    print(f"[1/4] Downloading playlist audio: {playlist_url}")
    chapters = download_playlist(playlist_url, dl_dir)
    print(f"    {len(chapters)} videos")

    print("[2/4] Segmenting long videos at silence boundaries")
    all_segs = []
    for k, ch in enumerate(chapters, 1):
        segs = segment_audio_chapter(ch["title"], ch["audio"], work_dir / "_split", stem=f"ch{k:03d}")
        all_segs.extend(segs)
    for i, (seg, path) in enumerate(all_segs, 1):
        print(f"    {i:2d}. {seg.label!r}")

    print("[3/4] Normalizing each segment")
    norm_wavs, labels = [], []
    n = len(all_segs)
    for i, (seg, path) in enumerate(all_segs, 1):
        norm_wav = work_dir / f"seg_{i:03d}_norm.wav"
        if norm_wav.exists() and norm_wav.stat().st_size > 0:
            print(f"    [{i}/{n}] {seg.label!r} cached")
        else:
            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    normalize_wav(path, norm_wav)
                    print(f"    [{i}/{n}] {seg.label!r} normalized")
                    break
                except Exception as e:
                    print(f"    [{i}/{n}] attempt {attempt}/{MAX_RETRIES} FAILED: {e}")
                    if attempt == MAX_RETRIES:
                        print(f"CIRCUIT BREAKER: segment {i} ({seg.label!r}) failed {MAX_RETRIES}x. Stopping run.")
                        sys.exit(1)
        norm_wavs.append(norm_wav)
        labels.append(seg.label)

    print("[4/4] Packaging m4b")
    result_path, total_min = package_m4b(norm_wavs, labels, out_m4b, work_dir, title=title, author=author)

    durations = [probe_duration(w) / 60 for w in norm_wavs]
    over = [(l, d) for l, d in zip(labels, durations) if d > HARD_CEILING_MIN]
    lines = [f"{title} -- {author}", f"{len(chapters)} videos, {n} segments, {total_min:.1f} min total", ""]
    lines += [f"{i:3d}. {d:5.1f} min  {l}" for i, (l, d) in enumerate(zip(labels, durations), 1)]
    if over:
        lines += ["", f"WARNING: {len(over)} segment(s) over the {HARD_CEILING_MIN} min ceiling:"]
        lines += [f"  {d:.1f} min  {l}" for l, d in over]
        print(f"    WARNING: {len(over)} segment(s) over {HARD_CEILING_MIN} min, see run_log.txt")
    (out_dir / "run_log.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")

    shutil.rmtree(work_dir, ignore_errors=True)

    print(f"\nDone. m4b: {result_path} ({total_min:.1f} min total)")
    return result_path


if __name__ == "__main__":
    sys.stdout.reconfigure(line_buffering=True)
    run(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "")
