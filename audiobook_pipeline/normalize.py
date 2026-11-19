"""Two-pass ffmpeg loudnorm per segment. Target -18 LUFS integrated.

True peak target is -2.0 dBTP, not the plan's -1.5: the AAC encode in
package.py adds ~0.4 dB of overshoot (measured -1.1 dBTP on the first book
with a -1.5 target), so the wav needs headroom for the final m4b to land
under -1.5.
"""
import json
import re
import subprocess
from pathlib import Path

TARGET_I = -18.0
TARGET_TP = -2.0
TARGET_LRA = 11.0


def normalize_wav(src: Path, dst: Path) -> dict:
    measure = subprocess.run(
        [
            "ffmpeg", "-i", str(src), "-af",
            f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}:print_format=json",
            "-f", "null", "-",
        ],
        capture_output=True, text=True,
    )
    match = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", measure.stderr)
    if not match:
        raise RuntimeError(f"loudnorm measure pass produced no JSON for {src}:\n{measure.stderr[-1000:]}")
    stats = json.loads(match.group(0))

    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-af",
            f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA}:"
            f"measured_I={stats['input_i']}:measured_TP={stats['input_tp']}:"
            f"measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}:"
            f"offset={stats['target_offset']}:linear=true:print_format=summary",
            "-ar", "24000", "-ac", "1", str(dst),
        ],
        check=True,
    )
    return stats


if __name__ == "__main__":
    import sys
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else src.with_stem(src.stem + "_norm")
    stats = normalize_wav(src, dst)
    print(f"{src} -> {dst}: input_i={stats['input_i']} input_tp={stats['input_tp']}")
