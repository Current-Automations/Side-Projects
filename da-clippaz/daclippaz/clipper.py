"""Splits a downloaded video into equal-length clips using FFmpeg.

Supports three output modes:
  original  , keep the source aspect ratio (no reframing)
  crop      , centre-crop to 9:16 and scale to 1080x1920
  blur      , blurred full-frame background with centred foreground at 1080x1920
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path
from typing import Callable, List, Literal, Optional

logger = logging.getLogger(__name__)

Mode = Literal["original", "crop", "blur"]

# Fixed TikTok / short-form target dimensions
_TARGET_W = 1080
_TARGET_H = 1920

# Crop: take a 9:16 centre slice of the frame then scale up
_CROP_FILTER = (
    f"crop=round(in_h*{_TARGET_W}/{_TARGET_H}):in_h:"
    f"(in_w-round(in_h*{_TARGET_W}/{_TARGET_H}))/2:0,"
    f"scale={_TARGET_W}:{_TARGET_H}"
)

# Blur: scale source to fill 9:16 and blur it, then overlay the original
# letterboxed on top
_BLUR_FILTER_COMPLEX = (
    f"[0:v]scale={_TARGET_W}:{_TARGET_H},boxblur=20:10,setsar=1[bg];"
    f"[0:v]scale={_TARGET_W}:{_TARGET_H}:force_original_aspect_ratio=decrease,"
    f"setsar=1[fg];"
    f"[bg][fg]overlay=(W-w)/2:(H-h)/2,"
    f"scale={_TARGET_W}:{_TARGET_H},setsar=1[v]"
)


def _probe_duration(source_path: Path) -> float:
    """Return the duration of a video file in seconds via ffprobe."""
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(source_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return float(result.stdout.strip())


def _build_cmd(
    source_path: Path,
    start: float,
    segment_duration: float,
    clip_path: Path,
    mode: Mode,
) -> List[str]:
    base = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-ss", str(start),
        "-t", str(segment_duration),
        "-i", str(source_path),
    ]

    encode = [
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
    ]

    if mode == "crop":
        return base + ["-vf", _CROP_FILTER] + encode + [str(clip_path)]

    if mode == "blur":
        return base + [
            "-filter_complex", _BLUR_FILTER_COMPLEX,
            "-map", "[v]",
            "-map", "0:a?",
        ] + encode + [str(clip_path)]

    # original , no video filter
    return base + encode + [str(clip_path)]


def clip_video(
    source_path: Path,
    clip_length: int,
    output_dir: Path,
    mode: Mode = "original",
    keep_partial: bool = False,
    progress: Optional[Callable[[str], None]] = None,
) -> List[Path]:
    """Split a video into equal-length clips.

    Parameters
    ----------
    source_path : Path
        Path to the source video file.
    clip_length : int
        Desired length of each clip in seconds.
    output_dir : Path
        Directory to write clip files into.
    mode : "original" | "crop" | "blur"
        Output format. "original" preserves the source aspect ratio.
        "crop" centre-crops to 9:16 (1080x1920). "blur" places the video
        on a blurred 9:16 background.
    keep_partial : bool
        If True, the final segment is kept even when shorter than clip_length.
    progress : callable, optional
        Called with a status string after each clip is processed.

    Returns
    -------
    list of Path
        Paths to the generated clip files.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    duration = _probe_duration(source_path)

    clip_paths: List[Path] = []
    start = 0.0
    idx = 1

    while start < duration:
        remaining = duration - start
        is_partial = remaining < clip_length

        if is_partial and not keep_partial:
            break

        segment_duration = remaining if is_partial else float(clip_length)
        clip_path = output_dir / f"clip_{idx:03d}.mp4"

        cmd = _build_cmd(source_path, start, segment_duration, clip_path, mode)

        try:
            subprocess.run(cmd, check=True)
            clip_paths.append(clip_path)
            logger.info("Wrote %s [mode=%s]", clip_path.name, mode)
            if progress:
                label = " (partial)" if is_partial else ""
                progress(f"  Clip {idx}{label}: {clip_path.name}")
        except subprocess.CalledProcessError as exc:
            logger.error("FFmpeg failed for clip %d: %s", idx, exc)
            if progress:
                progress(f"  Clip {idx}: FFmpeg error , {exc}")

        start += clip_length
        idx += 1

    return clip_paths
