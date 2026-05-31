"""Unit tests for configuration loading."""

import json
from pathlib import Path

import pytest

from daclippaz.config import load_config, ValidationError


def write_config(tmp_path: Path, data: dict) -> Path:
    """Helper to write a JSON config to a temporary file."""
    cfg_path = tmp_path / "config.json"
    cfg_path.write_text(json.dumps(data))
    return cfg_path


def valid_config_dict() -> dict:
    """Return a minimal valid configuration dictionary."""
    return {
        "input_dir": "C:/input",
        "output_dir": "C:/output",
        "temp_dir": "C:/temp",
        "jobs_root": "jobs",
        "clip_settings": {
            "clip_length_seconds": 60,
            "overlap_seconds": 5,
            "max_clips_per_video": 2,
        },
        "tiktok": {
            "enabled": True,
            "width": 1080,
            "height": 1920,
            "mode": "crop",
        },
        "logging": {"level": "INFO"},
        "watcher": {"poll_interval_seconds": 5},
        "retries": {"max_retries": 3},
    }


def test_load_valid_config(tmp_path: Path) -> None:
    cfg = valid_config_dict()
    cfg_path = write_config(tmp_path, cfg)
    loaded = load_config(cfg_path)
    assert loaded == cfg


def test_missing_required_key(tmp_path: Path) -> None:
    cfg = valid_config_dict()
    # Remove a required key
    cfg.pop("input_dir")
    cfg_path = write_config(tmp_path, cfg)
    with pytest.raises(ValidationError):
        load_config(cfg_path)


def test_smart_mode_is_valid(tmp_path: Path) -> None:
    cfg = valid_config_dict()
    cfg["tiktok"]["mode"] = "smart"
    cfg["tiktok"]["smart_detect_every_n_frames"] = 5
    cfg["tiktok"]["smart_smoothing_alpha"] = 0.3
    cfg_path = write_config(tmp_path, cfg)
    loaded = load_config(cfg_path)
    assert loaded["tiktok"]["mode"] == "smart"
