"""Fixed interval segmentation and clipping utilities.

This module implements logic for computing fixed‑length clip intervals
and invoking FFmpeg to cut and convert clips into vertical
exports.  It is used by the YouTube ingestion pipeline and may be
reused by other ingestion sources in the future.
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path
from typing import Dict, Any, List, Tuple

logger = logging.getLogger(__name__)

def compute_clip_windows(
    duration: float, clip_length: int, overlap: int, max_clips: int
) -> List[Tuple[int, int]]:
    """Compute start and end offsets for fixed‑length clips.

    Clips start at offset 0 and then advance by (clip_length - overlap)
    seconds.  Only windows where the end time is within the video
    duration are returned, and at most ``max_clips`` windows are
    produced.

    Parameters
    ----------
    duration : float
        Duration of the source video in seconds.
    clip_length : int
        Desired length of each clip in seconds.
    overlap : int
        Overlap between consecutive clips in seconds.
    max_clips : int
        Maximum number of clips to generate.

    Returns
    -------
    list of tuple(int, int)
        A list of (start, end) offsets in seconds for each clip.
    """
    windows: List[Tuple[int, int]] = []
    # Step between start times
    step = clip_length - overlap
    if step <= 0:
        return windows
    start = 0
    while len(windows) < max_clips:
        end = start + clip_length
        # Stop if the end of the clip exceeds the duration
        if end > duration:
            break
        windows.append((int(start), int(end)))
        start += step
    return windows


def run_clipping(
    source_path: Path,
    windows: List[Tuple[int, int]],
    output_dir: Path,
    tiktok_cfg: Dict[str, Any],
) -> List[Path]:
    """Cut clips from a source video using FFmpeg.

    Modes:
    - crop: centre-crop to 9:16, then scale to target size (existing behavior)
    - blur: blurred full-frame background with centered foreground video
    - smart: face-tracking dynamic crop and vertical reframing
    """

    width = int(tiktok_cfg.get("width", 1080))
    height = int(tiktok_cfg.get("height", 1920))
    mode = str(tiktok_cfg.get("mode", "crop")).strip().lower()
    smart_detect_every_n_frames = int(tiktok_cfg.get("smart_detect_every_n_frames", 5))
    smart_smoothing_alpha = float(tiktok_cfg.get("smart_smoothing_alpha", 0.25))

    output_dir.mkdir(parents=True, exist_ok=True)
    logger.info("Clipping mode selected: %s", mode)

    clip_paths: List[Path] = []

    # Use integer-safe crop expression
    # Crop width = round(input_height * (width / height))
    crop_width_expr = f"round(in_h*{width}/{height})"

    crop_filter_str = (
        f"crop={crop_width_expr}:in_h:"
        f"(in_w-{crop_width_expr})/2:0,"
        f"scale={width}:{height}"
    )

    blur_filter_complex = (
        f"[0:v]scale={width}:{height},boxblur=20:10,setsar=1[bg];"
        f"[0:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"setsar=1[fg];"
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2,"
        f"scale={width}:{height},setsar=1[v]"
    )

    smart_renderer = None
    if mode == "smart":
        try:
            from .smart_framing import render_smart_vertical_clip as smart_renderer
        except ImportError as exc:
            raise RuntimeError(
                "Smart mode requires optional dependencies (opencv-python, mediapipe)"
            ) from exc

    for idx, (start, end) in enumerate(windows, start=1):
        clip_name = f"clip_{idx:03d}.mp4"
        clip_path = output_dir / clip_name
        duration = end - start

        if mode == "smart":
            temp_video_path = output_dir / f"clip_{idx:03d}.smart_video.mp4"
            temp_audio_path = output_dir / f"clip_{idx:03d}.smart_audio.m4a"
            temp_video_path.unlink(missing_ok=True)
            temp_audio_path.unlink(missing_ok=True)

            try:
                rendered = smart_renderer(
                    source_path=source_path,
                    output_video_path=temp_video_path,
                    start_seconds=float(start),
                    duration_seconds=float(duration),
                    target_width=width,
                    target_height=height,
                    detect_every_n_frames=smart_detect_every_n_frames,
                    smoothing_alpha=smart_smoothing_alpha,
                )
                if not rendered:
                    logger.error(
                        "Smart framing failed for clip %s (%s-%s).",
                        clip_name,
                        start,
                        end,
                    )
                    continue

                extract_audio_cmd = [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-ss",
                    str(start),
                    "-t",
                    str(duration),
                    "-i",
                    str(source_path),
                    "-vn",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "128k",
                    str(temp_audio_path),
                ]

                audio_available = True
                try:
                    subprocess.run(extract_audio_cmd, check=True)
                except subprocess.CalledProcessError:
                    audio_available = False
                    logger.warning(
                        "Audio extraction failed for clip %s; exporting without audio.",
                        clip_name,
                    )

                if audio_available and temp_audio_path.exists():
                    remux_cmd = [
                        "ffmpeg",
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-y",
                        "-i",
                        str(temp_video_path),
                        "-i",
                        str(temp_audio_path),
                        "-c:v",
                        "copy",
                        "-c:a",
                        "aac",
                        "-b:a",
                        "128k",
                        "-shortest",
                        str(clip_path),
                    ]
                else:
                    remux_cmd = [
                        "ffmpeg",
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-y",
                        "-i",
                        str(temp_video_path),
                        "-c:v",
                        "copy",
                        "-an",
                        str(clip_path),
                    ]

                subprocess.run(remux_cmd, check=True)
                clip_paths.append(clip_path)
            except subprocess.CalledProcessError as exc:
                logger.error(
                    "FFmpeg failed for smart clip %s (%s-%s): %s",
                    clip_name,
                    start,
                    end,
                    exc,
                )
            except Exception as exc:
                logger.error(
                    "Smart clipping failed for clip %s (%s-%s): %s",
                    clip_name,
                    start,
                    end,
                    exc,
                )
            finally:
                temp_video_path.unlink(missing_ok=True)
                temp_audio_path.unlink(missing_ok=True)
            continue

        base_cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            str(start),
            "-t",
            str(duration),
            "-i",
            str(source_path),
        ]

        if mode == "blur":
            cmd = base_cmd + [
                "-filter_complex",
                blur_filter_complex,
                "-map",
                "[v]",
                "-map",
                "0:a?",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                str(clip_path),
            ]
        else:
            # Default/fallback keeps existing crop behavior unchanged.
            cmd = base_cmd + [
                "-vf",
                crop_filter_str,
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                str(clip_path),
            ]

        try:
            subprocess.run(cmd, check=True)
            clip_paths.append(clip_path)
        except subprocess.CalledProcessError as exc:
            logger.error(
                "FFmpeg failed for clip %s (%s-%s): %s",
                clip_name,
                start,
                end,
                exc,
            )
            continue

    return clip_paths
