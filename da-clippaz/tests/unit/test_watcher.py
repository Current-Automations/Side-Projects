from pathlib import Path

from daclippaz.watcher.watch import _adopt_dropped_files


def _config(tmp_path):
    return {
        "input_dir": str(tmp_path / "input"),
        "jobs_root": str(tmp_path / "jobs"),
        "clip_settings": {"clip_length_seconds": 60, "overlap_seconds": 2},
    }


def test_a_growing_file_is_not_adopted(tmp_path, monkeypatch):
    monkeypatch.setattr("daclippaz.watcher.watch.probe_duration", lambda p: 60.0)
    config = _config(tmp_path)
    drop = Path(config["input_dir"])
    drop.mkdir(parents=True)
    f = drop / "recording.mp4"
    f.write_bytes(b"a" * 100)

    # First sighting: the size is unknown, so nothing is adopted yet.
    assert _adopt_dropped_files(config, {}) == 0

    seen = {}
    _adopt_dropped_files(config, seen)
    f.write_bytes(b"a" * 200)
    assert _adopt_dropped_files(config, seen) == 0


def test_a_settled_file_becomes_a_job(tmp_path, monkeypatch):
    monkeypatch.setattr("daclippaz.watcher.watch.probe_duration", lambda p: 60.0)
    config = _config(tmp_path)
    drop = Path(config["input_dir"])
    drop.mkdir(parents=True)
    (drop / "recording.mp4").write_bytes(b"a" * 100)

    seen = {}
    _adopt_dropped_files(config, seen)
    assert _adopt_dropped_files(config, seen) == 1
    assert list(drop.iterdir()) == []


def test_non_video_files_are_ignored(tmp_path):
    config = _config(tmp_path)
    drop = Path(config["input_dir"])
    drop.mkdir(parents=True)
    (drop / "notes.txt").write_text("hi", encoding="utf-8")

    seen = {}
    _adopt_dropped_files(config, seen)
    assert _adopt_dropped_files(config, seen) == 0


def test_an_unreadable_file_does_not_stop_the_loop(tmp_path, monkeypatch):
    def boom(_):
        raise RuntimeError("not a video")

    monkeypatch.setattr("daclippaz.watcher.watch.probe_duration", boom)
    config = _config(tmp_path)
    drop = Path(config["input_dir"])
    drop.mkdir(parents=True)
    (drop / "broken.mp4").write_bytes(b"a" * 100)

    seen = {}
    _adopt_dropped_files(config, seen)
    assert _adopt_dropped_files(config, seen) == 0
