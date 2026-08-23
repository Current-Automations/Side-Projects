"""Utilities for interacting with FFmpeg.

Verifying that FFmpeg is installed, and probing a source for its duration.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path



def check_ffmpeg() -> None:
    """Check that FFmpeg is installed and on the system ``PATH``.

    Raises
    ------
    FileNotFoundError
        If the ``ffmpeg`` executable cannot be found or executed.
    """
    if shutil.which("ffmpeg") is None:
        raise FileNotFoundError(
            "FFmpeg is not installed or not found on PATH. Please install FFmpeg and ensure it is available from the command line."
        )
    try:
        # We don't care about the output; just verify it runs
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
    except Exception as exc:
        raise FileNotFoundError(
            "FFmpeg is installed but could not be executed. Please ensure it is functioning correctly."
        ) from exc
    logging.getLogger(__name__).debug("FFmpeg detected successfully")


def probe_duration(source_path: Path) -> float:
    """Return the duration of a media file in seconds.

    Raises
    ------
    RuntimeError
        If ffprobe fails or reports nothing usable. A source with an unknown
        duration cannot be windowed, so guessing here would produce a job that
        silently clips the wrong range.
    """
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(source_path),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return float(result.stdout.strip())
    except (OSError, subprocess.CalledProcessError, ValueError) as exc:
        raise RuntimeError(f"Could not read duration of {source_path}") from exc
