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
    # Campaign rules dictate clip length, so any positive value is allowed
    # rather than a fixed 30/60 choice, and overlap is independent of it.
    if not isinstance(clip_length, int) or clip_length <= 0:
        raise ValidationError("'clip_settings.clip_length_seconds' must be a positive integer")
    if not isinstance(overlap, int) or overlap < 0:
        raise ValidationError("'clip_settings.overlap_seconds' must be a non-negative integer")
    if overlap >= clip_length:
        raise ValidationError(
            "'clip_settings.overlap_seconds' must be less than 'clip_settings.clip_length_seconds'"
        )
    if not isinstance(max_clips, int) or max_clips <= 0:
        raise ValidationError("'clip_settings.max_clips_per_video' must be a positive integer")

    clip_format = clip_settings.get("format", "parts")
    if clip_format not in ("parts", "highlights"):
        raise ValidationError("'clip_settings.format' must be 'parts' or 'highlights'")

    min_tail = clip_settings.get("min_tail_seconds", 10)
    if not isinstance(min_tail, int) or min_tail < 0:
        raise ValidationError("'clip_settings.min_tail_seconds' must be a non-negative integer")

    encoder = data.get("encoder", {})
    if not isinstance(encoder, dict):
        raise ValidationError("'encoder' must be an object")
    video_encoder = encoder.get("video", "auto")
    if video_encoder not in ("auto", "nvenc", "libx264"):
        raise ValidationError("'encoder.video' must be 'auto', 'nvenc', or 'libx264'")

    captions = data.get("captions", {})
    if not isinstance(captions, dict):
        raise ValidationError("'captions' must be an object")
    caption_style = captions.get("style", "part_label")
    if caption_style not in ("none", "part_label", "karaoke"):
        raise ValidationError("'captions.style' must be 'none', 'part_label', or 'karaoke'")
    if caption_style == "karaoke":
        raise ValidationError(
            "'captions.style' 'karaoke' is not implemented yet. Use 'part_label' or 'none'"
        )

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


def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively merge ``override`` onto a copy of ``base``."""
    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_account_config(
    account: str, configs_dir: Path | str = "configs"
) -> Dict[str, Any]:
    """Load one account profile merged over the shared defaults.

    Layout::

        configs/defaults.json          shared settings
        configs/accounts/<name>.json   per-account overrides

    An account profile only needs to state what differs from defaults, so a
    highlights campaign account and a sequential-parts interest account can
    live side by side without duplicating everything.
    """
    configs_dir = Path(configs_dir)
    defaults_path = configs_dir / "defaults.json"
    account_path = configs_dir / "accounts" / f"{account}.json"

    if not defaults_path.is_file():
        raise FileNotFoundError(f"Defaults file not found: {defaults_path}")
    if not account_path.is_file():
        available = sorted(
            p.stem for p in (configs_dir / "accounts").glob("*.json")
        )
        raise FileNotFoundError(
            f"Account profile not found: {account_path}. "
            f"Available accounts: {', '.join(available) if available else 'none'}"
        )

    defaults = json.loads(defaults_path.read_text(encoding="utf-8"))
    overrides = json.loads(account_path.read_text(encoding="utf-8"))
    if not isinstance(defaults, dict) or not isinstance(overrides, dict):
        raise ValidationError("Config files must contain JSON objects")

    merged = _deep_merge(defaults, overrides)
    merged["account"] = account
    _validate_config(merged)
    return merged


def list_accounts(configs_dir: Path | str = "configs") -> list[str]:
    """Return the names of every available account profile."""
    accounts_dir = Path(configs_dir) / "accounts"
    if not accounts_dir.is_dir():
        return []
    return sorted(p.stem for p in accounts_dir.glob("*.json"))
