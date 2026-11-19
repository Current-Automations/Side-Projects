"""Generate a sample passage across several Kokoro voices so you can pick one.
Run: venv\\Scripts\\python.exe voice_audition.py
Output: ~/Audiobooks/voice_audition (or VOICE_AUDITION_DIR)
"""
import os
import subprocess
import time
from pathlib import Path

import numpy as np
import soundfile as sf

OUT = Path(os.environ.get("VOICE_AUDITION_DIR", str(Path.home() / "Audiobooks" / "voice_audition")))
OUT.mkdir(parents=True, exist_ok=True)

# ~90 seconds at Kokoro's natural pace. Mixes narrative and instructional register
# since the real library is a mix of both (Gladwell-style narrative vs. Hormozi-style
# instructional).
PASSAGE = (
    "Most people think confidence comes before competence. It's the other way around. "
    "You get the feeling of confidence by stacking small, verifiable wins, not by hyping "
    "yourself up beforehand. "
    "In nineteen ninety-six, a group of park rangers noticed something strange. The "
    "campsites with the best views had the worst behaved bears, not because the bears "
    "were smarter, but because the humans there left more food out, more often, without "
    "noticing the pattern. "
    "The lesson generalizes past bears. Environment shapes behavior more reliably than "
    "willpower does, so the first move is almost never a pep talk. It's changing what's "
    "sitting on the counter."
)

# American English voices already known to be solid narrators, mixed male/female.
# am_michael and af_heart are already cached locally (he's heard both before);
# the rest download from the hexgrad/Kokoro-82M repo on first use.
VOICES = [
    "am_michael",  # already benchmarked
    "af_heart",    # already benchmarked
    "am_fenrir",
    "am_onyx",
    "am_puck",
    "af_bella",
    "af_nicole",
    "af_sky",
]

from kokoro import KPipeline  # noqa: E402

pipe = KPipeline(lang_code="a")

for voice in VOICES:
    t0 = time.time()
    try:
        audio = np.concatenate(
            [a.numpy() if hasattr(a, "numpy") else a for _, _, a in pipe(PASSAGE, voice=voice)]
        )
    except Exception as e:
        print(f"{voice}: FAILED - {e}")
        continue
    wav = OUT / f"{voice}.wav"
    sf.write(wav, audio, 24000)
    mp3 = wav.with_suffix(".mp3")
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-b:a", "192k", str(mp3)],
        check=True,
    )
    wav.unlink()
    dur = len(audio) / 24000
    print(f"{voice}: {dur:.1f}s audio in {time.time()-t0:.1f}s -> {mp3}")

print(f"\nDone. Samples in: {OUT}")
