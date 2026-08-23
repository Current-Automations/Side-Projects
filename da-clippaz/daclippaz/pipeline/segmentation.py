"""Fixed interval segmentation and clipping utilities.

This module implements logic for computing fixed-length clip intervals
and invoking FFmpeg to cut and convert clips into vertical
exports.  It is used by the YouTube ingestion pipeline and may be
reused by other ingestion sources in the future.
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

from ..captioner import build_caption_filter
from ..encoders import video_encode_args

logger = logging.getLogger(__name__)

def compute_clip_windows(
    duration: float,
    clip_length: int,
    overlap: int,
    max_clips: int,
    min_tail_seconds: int = 10,
) -> List[Tuple[int, int]]:
    """Compute start and end offsets for fixed-length clips.

    Clips start at offset 0 and then advance by (clip_length - overlap)
    seconds.  The final window is allowed to be shorter than
    ``clip_length`` so the end of the source is covered.

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
    min_tail_seconds : int
        Shortest allowed final clip. A remainder below this is folded into
        the previous window rather than posted as its own stub part.

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
        if end > duration:
            # The sequential-parts format needs the tail covered, otherwise
            # every series is missing its ending. Emit a short final window,
            # or extend the previous one when the remainder is too small to
            # stand on its own as a part.
            remaining = duration - start
            if remaining >= min_tail_seconds:
                windows.append((int(start), int(duration)))
            elif windows and remaining > 0:
                prev_start, _ = windows[-1]
                windows[-1] = (prev_start, int(duration))
            break
        windows.append((int(start), int(end)))
        start += step
    return windows


def run_clipping(
    source_path: Path,
    windows: List[Tuple[int, int]],
    output_dir: Path,
    tiktok_cfg: Dict[str, Any],
    clip_format: str = "parts",
    captions_cfg: Optional[Dict[str, Any]] = None,
    encoder_cfg: Optional[Dict[str, Any]] = None,
    source_title: Optional[str] = None,
    temp_dir: Optional[Path] = None,
) -> List[Path]:
    """Cut clips from a source video using FFmpeg.

    Modes:
    - crop: centre-crop to 9:16, then scale to target size (existing behavior)
    - blur: blurred full-frame background with centered foreground video
    - smart: face-tracking dynamic crop and vertical reframing

    ``clip_format`` selects between the sequential-parts format, where each
    clip carries a "Part N/Total" label, and standalone highlights, which get
    no part label because there is no series to place them in.
    """

    width = int(tiktok_cfg.get("width", 1080))
    height = int(tiktok_cfg.get("height", 1920))
    mode = str(tiktok_cfg.get("mode", "crop")).strip().lower()
    smart_detect_every_n_frames = int(tiktok_cfg.get("smart_detect_every_n_frames", 5))
    smart_smoothing_alpha = float(tiktok_cfg.get("smart_smoothing_alpha", 0.25))

    captions_cfg = captions_cfg or {}
    encoder_cfg = encoder_cfg or {}
    video_args = video_encode_args(encoder_cfg)

    output_dir.mkdir(parents=True, exist_ok=True)

    # Smart mode writes a large scratch file per clip. Keeping it out of the
    # clips folder means a crash never leaves half-rendered files sitting where
    # finished ones belong.
    scratch_dir = Path(temp_dir) if temp_dir else output_dir
    scratch_dir.mkdir(parents=True, exist_ok=True)

    logger.info(
        "Clipping mode=%s format=%s encoder=%s clips=%d",
        mode,
        clip_format,
        video_args[1],
        len(windows),
    )

    clip_paths: List[Path] = []
    total_parts = len(windows)

    # Use integer-safe crop expression
    # Crop width = round(input_height * (width / height))
    crop_width_expr = f"round(in_h*{width}/{height})"

    crop_filter_str = (
        f"crop={crop_width_expr}:in_h:"
        f"(in_w-{crop_width_expr})/2:0,"
        f"scale={width}:{height}"
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

        caption_filter = build_caption_filter(
            captions_cfg,
            clip_format,
            part_number=idx,
            total_parts=total_parts,
            source_title=source_title,
        )

        if mode == "smart":
            temp_video_path = scratch_dir / f"clip_{idx:03d}.smart_video.mp4"
            temp_audio_path = scratch_dir / f"clip_{idx:03d}.smart_audio.m4a"
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

                # The smart renderer writes its intermediate through OpenCV,
                # which means MPEG-4 Part 2 at a huge bitrate. Copying that
                # through would ship a 25Mbps non-H.264 file to TikTok, so the
                # remux always re-encodes rather than copying.
                video_stage = video_args
                if caption_filter:
                    video_stage = ["-vf", caption_filter] + video_args

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
                    ] + video_stage + [
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
                    ] + video_stage + [
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
            caption_stage = f",{caption_filter}" if caption_filter else ""
            blur_filter_complex = (
                f"[0:v]scale={width}:{height},boxblur=20:10,setsar=1[bg];"
                f"[0:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
                f"setsar=1[fg];"
                f"[bg][fg]overlay=(W-w)/2:(H-h)/2,"
                f"scale={width}:{height},setsar=1{caption_stage}[v]"
            )
            cmd = base_cmd + [
                "-filter_complex",
                blur_filter_complex,
                "-map",
                "[v]",
                "-map",
                "0:a?",
            ] + video_args + [
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                str(clip_path),
            ]
        else:
            # Default/fallback keeps existing crop behavior unchanged.
            vf = crop_filter_str
            if caption_filter:
                vf = f"{vf},{caption_filter}"
            cmd = base_cmd + [
                "-vf",
                vf,
            ] + video_args + [
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
