import json

import pytest

from daclippaz.config import ValidationError, _deep_merge, list_accounts, load_account_config

DEFAULTS = {
    "input_dir": "work/input",
    "output_dir": "work/output",
    "temp_dir": "work/temp",
    "jobs_root": "work/jobs",
    "clip_settings": {
        "format": "parts",
        "clip_length_seconds": 60,
        "overlap_seconds": 2,
        "max_clips_per_video": 40,
    },
    "tiktok": {"enabled": True, "width": 1080, "height": 1920, "mode": "crop"},
    "logging": {"level": "INFO"},
    "watcher": {"poll_interval_seconds": 5},
    "retries": {"max_retries": 3},
}


def _write(tmp_path, overrides):
    (tmp_path / "accounts").mkdir(parents=True)
    (tmp_path / "defaults.json").write_text(json.dumps(DEFAULTS), encoding="utf-8")
    (tmp_path / "accounts" / "lol.json").write_text(json.dumps(overrides), encoding="utf-8")
    return tmp_path


def test_deep_merge_keeps_unset_nested_keys():
    merged = _deep_merge({"a": {"x": 1, "y": 2}}, {"a": {"y": 3}})
    assert merged == {"a": {"x": 1, "y": 3}}


def test_account_overrides_merge_over_defaults(tmp_path):
    d = _write(tmp_path, {"clip_settings": {"format": "highlights"}, "tiktok": {"mode": "smart"}})
    cfg = load_account_config("lol", d)
    assert cfg["account"] == "lol"
    assert cfg["clip_settings"]["format"] == "highlights"
    assert cfg["clip_settings"]["clip_length_seconds"] == 60
    assert cfg["tiktok"]["mode"] == "smart"
    assert cfg["tiktok"]["width"] == 1080
    assert list_accounts(d) == ["lol"]


def test_unknown_account_names_the_available_ones(tmp_path):
    d = _write(tmp_path, {})
    with pytest.raises(FileNotFoundError, match="lol"):
        load_account_config("comedy", d)


def test_overlap_must_be_under_clip_length(tmp_path):
    d = _write(tmp_path, {"clip_settings": {"overlap_seconds": 60}})
    with pytest.raises(ValidationError, match="overlap_seconds"):
        load_account_config("lol", d)


def test_karaoke_is_rejected_until_implemented(tmp_path):
    d = _write(tmp_path, {"captions": {"style": "karaoke"}})
    with pytest.raises(ValidationError, match="karaoke"):
        load_account_config("lol", d)
