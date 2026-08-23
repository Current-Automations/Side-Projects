"""The crop expression has to survive a source of any shape.

Cropping width alone assumed the source was wider than 9:16. Anything taller
made FFmpeg reject the filter outright, which failed every clip in the job.
"""

import subprocess

import pytest

from daclippaz.pipeline.segmentation import run_clipping

pytestmark = pytest.mark.skipif(
    subprocess.run(["ffmpeg", "-version"], capture_output=True).returncode != 0,
    reason="ffmpeg not available",
)

SHAPES = [("1920x1080", "wide"), ("1080x2400", "taller than 9:16"), ("1000x1000", "square")]


@pytest.mark.parametrize("size,label", SHAPES)
def test_crop_handles_any_source_shape(tmp_path, size, label):
    source = tmp_path / f"{size}.mp4"
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", f"testsrc=size={size}:rate=30:duration=2",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "35", str(source),
        ],
        check=True,
    )

    clips = run_clipping(
        source,
        [(0, 1)],
        tmp_path / "out",
        {"width": 1080, "height": 1920, "mode": "crop"},
        captions_cfg={"style": "none"},
        encoder_cfg={"video": "libx264"},
    )

    assert clips, f"crop produced no clips for a {label} source"
    probe = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries", "stream=width,height",
            "-of", "csv=p=0", str(clips[0]),
        ],
        capture_output=True, text=True, check=True,
    )
    assert probe.stdout.strip().splitlines()[0] == "1080,1920"
