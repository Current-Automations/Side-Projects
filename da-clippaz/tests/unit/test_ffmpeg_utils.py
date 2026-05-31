"""Unit tests for FFmpeg utilities."""

import types
import subprocess
import shutil

import pytest

import daclippaz.ffmpeg_utils as ffmpeg_utils


def test_check_ffmpeg_missing(monkeypatch):
    """check_ffmpeg should raise FileNotFoundError when ffmpeg is not found."""
    monkeypatch.setattr(shutil, "which", lambda name: None)
    with pytest.raises(FileNotFoundError):
        ffmpeg_utils.check_ffmpeg()


def test_check_ffmpeg_execution_failure(monkeypatch):
    """check_ffmpeg should raise FileNotFoundError when ffmpeg cannot be executed."""
    # Pretend ffmpeg exists
    monkeypatch.setattr(shutil, "which", lambda name: "/usr/bin/ffmpeg")
    # Monkeypatch subprocess.run to raise
    def fake_run(*args, **kwargs):
        raise subprocess.CalledProcessError(1, args[0])
    monkeypatch.setattr(subprocess, "run", fake_run)
    with pytest.raises(FileNotFoundError):
        ffmpeg_utils.check_ffmpeg()
