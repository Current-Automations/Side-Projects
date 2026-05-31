"""Utilities for interacting with FFmpeg.

Currently includes functions to verify that FFmpeg is installed and
available on the system ``PATH``.  Future milestones will add helpers
for building command lines to cut, scale and encode clips.
"""

from __future__ import annotations

import shutil
import subprocess
import logging



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
