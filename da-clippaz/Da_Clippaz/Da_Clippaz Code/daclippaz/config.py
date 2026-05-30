"""Configuration loading and validation.

The configuration is stored as a JSON file.  A minimal schema is
enforced in code to ensure that required keys are present and have
reasonable types.  Future milestones may switch to a formal JSON
schema and incorporate default values.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict


class ValidationError(Exception):
    """Raised when the configuration file is missing required fields."""


def _validate_config(data: Dict[str, Any]) -> None:
    """Validate the configuration data in place.

    Parameters
    ----------
    data : dict
        The parsed JSON configuration.

    Raises
    ------
    ValidationError
        If required keys are missing or of the wrong type.
    """
    # Required top-level keys.  PR2 replaces clip_seconds/clip_overlap_seconds
    # with a nested clip_settings object and adds jobs_root to specify where
    # job folders should be created.
    required_top = [
        "input_dir",
        "output_dir",
        "temp_dir",
        "jobs_root",
        "clip_settings",
        "tiktok",
        "logging",
        "watcher",
        "retries",
    ]
    missing = [key for key in required_top if key not in data]
    if missing:
        raise ValidationError(f"Missing required config keys: {', '.join(missing)}")

    # Validate clip_settings: ensure structure and acceptable values.  The clip
    # length may be 30 or 60 seconds.  The overlap depends on the clip length.
    clip_settings = data.get("clip_settings", {})
    if not isinstance(clip_settings, dict):
        raise ValidationError("'clip_settings' must be an object")
    for key in ["clip_length_seconds", "overlap_seconds", "max_clips_per_video"]:
        if key not in clip_settings:
            raise ValidationError(f"'clip_settings' missing required key '{key}'")

    clip_length = clip_settings["clip_length_seconds"]
    overlap = clip_settings["overlap_seconds"]
    max_clips = clip_settings["max_clips_per_video"]
    if clip_length not in (30, 60):
        raise ValidationError("'clip_settings.clip_length_seconds' must be either 30 or 60")
    # Validate overlap defaults based on clip length
    if clip_length == 30 and overlap != 3:
        raise ValidationError("'clip_settings.overlap_seconds' must be 3 when clip_length_seconds is 30")
    if clip_length == 60 and overlap != 5:
        raise ValidationError("'clip_settings.overlap_seconds' must be 5 when clip_length_seconds is 60")
    if not isinstance(max_clips, int) or max_clips <= 0:
        raise ValidationError("'clip_settings.max_clips_per_video' must be a positive integer")

    tiktok = data["tiktok"]
    if not isinstance(tiktok, dict):
        raise ValidationError("'tiktok' must be an object")
    for key in ["enabled", "width", "height", "mode"]:
        if key not in tiktok:
            raise ValidationError(f"'tiktok' missing required key '{key}'")

    if tiktok["mode"] not in ("crop", "blur", "smart"):
        raise ValidationError("'tiktok.mode' must be one of 'crop', 'blur', or 'smart'")

    smart_every_n = tiktok.get("smart_detect_every_n_frames", 5)
    if not isinstance(smart_every_n, int) or smart_every_n <= 0:
        raise ValidationError("'tiktok.smart_detect_every_n_frames' must be a positive integer")

    smart_alpha = tiktok.get("smart_smoothing_alpha", 0.25)
    if (
        not isinstance(smart_alpha, (int, float))
        or float(smart_alpha) < 0.0
        or float(smart_alpha) > 1.0
    ):
        raise ValidationError("'tiktok.smart_smoothing_alpha' must be a number in [0.0, 1.0]")

    watcher = data["watcher"]
    if not isinstance(watcher, dict) or "poll_interval_seconds" not in watcher:
        raise ValidationError("'watcher.poll_interval_seconds' is required")

    retries = data["retries"]
    if not isinstance(retries, dict) or "max_retries" not in retries:
        raise ValidationError("'retries.max_retries' is required")


def load_config(path: Path | str) -> Dict[str, Any]:
    """Load and validate a configuration file.

    Parameters
    ----------
    path : Path or str
        Path to the JSON configuration file.

    Returns
    -------
    dict
        The configuration dictionary.

    Raises
    ------
    FileNotFoundError
        If the file does not exist.
    json.JSONDecodeError
        If the file is not valid JSON.
    ValidationError
        If required keys are missing or invalid.
    """
    if isinstance(path, str):
        path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"Configuration file not found: {path}")
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValidationError("Configuration must be a JSON object")
    _validate_config(data)
    return data
