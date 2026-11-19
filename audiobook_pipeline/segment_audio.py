"""Long already-narrated audio -> segments split at silence boundaries.

Mirrors segment.py's target/ceiling for text, but audio has no paragraphs to
split on -- so it splits at the nearest detected silence to each balanced
boundary instead. If no silence falls near a boundary, or snapping would push
a segment over the hard ceiling, it cuts at the boundary anyway (accepted
risk for audio-only content, not text).
"""
import math
import re
import subprocess
from pathlib import Path

from segment import TARGET_MAX_MIN, HARD_CEILING_MIN, Segment

SEARCH_WINDOW_SEC = 180  # how far from a target boundary to look for a silence to cut on
TARGET_SEG_MIN = 18      # aim for the middle of the 15-20 band


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


def _detect_silences(path: Path) -> list[float]:
    """Midpoints of detected silences, in seconds."""
    result = subprocess.run(
        ["ffmpeg", "-i", str(path), "-af", "silencedetect=noise=-30dB:d=0.5", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    starts = [float(m) for m in re.findall(r"silence_start:\s*([\d.]+)", result.stderr)]
    ends = [float(m) for m in re.findall(r"silence_end:\s*([\d.]+)", result.stderr)]
    return [(s + e) / 2 for s, e in zip(starts, ends)]


def _nearest_silence(target: float, silences: list[float]) -> float | None:
    candidates = [s for s in silences if abs(s - target) <= SEARCH_WINDOW_SEC]
    if not candidates:
        return None
    return min(candidates, key=lambda s: abs(s - target))


def _slice(src: Path, start: float, end: float, dst: Path):
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{start:.3f}", "-t", f"{end - start:.3f}",
         "-i", str(src), "-vn", "-ac", "1", "-ar", "24000", str(dst)],
        check=True,
    )


def segment_audio_chapter(title: str, audio_path: Path, work_dir: Path, stem: str = "") -> list[tuple[Segment, Path]]:
    duration = probe_duration(audio_path)
    duration_min = duration / 60
    stem = stem or re.sub(r"[^A-Za-z0-9]+", "_", title).strip("_")[:40]
    work_dir.mkdir(parents=True, exist_ok=True)

    if duration_min <= TARGET_MAX_MIN:
        seg_path = work_dir / f"{stem}.wav"
        _slice(audio_path, 0.0, duration, seg_path)
        return [(Segment(label=title, text=""), seg_path)]

    silences = _detect_silences(audio_path)
    n = max(2, math.ceil(duration_min / TARGET_SEG_MIN))
    targets = [i * duration / n for i in range(1, n)]
    boundaries = [0.0]
    for t in targets:
        cut = _nearest_silence(t, silences)
        boundaries.append(cut if cut is not None else t)
    boundaries.append(duration)

    # Snapping can stretch a span past the ceiling; fall back to the exact
    # target for that cut.
    for k in range(1, len(boundaries) - 1):
        if (boundaries[k] - boundaries[k - 1]) > HARD_CEILING_MIN * 60 or \
           (boundaries[k + 1] - boundaries[k]) > HARD_CEILING_MIN * 60:
            boundaries[k] = targets[k - 1]
    boundaries = sorted(set(boundaries))

    out = []
    n_segs = len(boundaries) - 1
    for i in range(n_segs):
        start, end = boundaries[i], boundaries[i + 1]
        seg_path = work_dir / f"{stem}_{i+1:02d}.wav"
        _slice(audio_path, start, end, seg_path)
        out.append((Segment(label=f"{title} ({i+1} of {n_segs})", text=""), seg_path))
    return out


if __name__ == "__main__":
    import sys
    src = Path(sys.argv[1])
    for seg, path in segment_audio_chapter(src.stem, src, src.parent / "_segsplit"):
        print(f"{seg.label!r} -> {path} ({probe_duration(path)/60:.1f} min)")
