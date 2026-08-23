"""Video encoder selection.

The sequential-parts format turns one long video into many separate
re-encodes, so encode time multiplies. Where an NVIDIA card is present,
NVENC moves that work off the CPU. Selection is config-driven with a
software fallback so the pipeline still runs on machines without one.
"""

from __future__ import annotations

import functools
import logging
import subprocess
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


@functools.lru_cache(maxsize=1)
def nvenc_available() -> bool:
    """Return True when this FFmpeg build exposes the h264_nvenc encoder."""
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return False
    return "h264_nvenc" in result.stdout


def resolve_encoder(encoder_cfg: Dict[str, Any]) -> str:
    """Resolve the configured encoder preference to a concrete encoder name."""
    preference = str(encoder_cfg.get("video", "auto")).strip().lower()

    if preference == "libx264":
        return "libx264"

    if preference == "nvenc":
        if nvenc_available():
            return "h264_nvenc"
        logger.warning("encoder.video is 'nvenc' but h264_nvenc is unavailable; using libx264")
        return "libx264"

    return "h264_nvenc" if nvenc_available() else "libx264"


def video_encode_args(encoder_cfg: Dict[str, Any]) -> List[str]:
    """Build the FFmpeg video encoding arguments for the resolved encoder."""
    encoder = resolve_encoder(encoder_cfg)

    if encoder == "h264_nvenc":
        preset = str(encoder_cfg.get("nvenc_preset", "p4"))
        cq = str(encoder_cfg.get("nvenc_cq", 23))
        return [
            "-c:v", "h264_nvenc",
            "-preset", preset,
            "-rc", "vbr",
            "-cq", cq,
            "-pix_fmt", "yuv420p",
        ]

    preset = str(encoder_cfg.get("x264_preset", "veryfast"))
    crf = str(encoder_cfg.get("x264_crf", 23))
    return [
        "-c:v", "libx264",
        "-preset", preset,
        "-crf", crf,
        "-pix_fmt", "yuv420p",
    ]
