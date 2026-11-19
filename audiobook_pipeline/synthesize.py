"""Segment text -> single mono float32 waveform via Kokoro.

Explicit silence control (KPipeline's own sentence splitting isn't enough on
its own -- gaps need to be bigger between paragraphs than between sentences,
per the plan):
  - 250ms between sentence-level chunks Kokoro yields inside one paragraph
  - 700ms between paragraphs
  - 1.5s lead-in at the very start of the segment
  - optional spoken announcement (the segment label) followed by 1.0s, so he
    knows where he is when a segment starts mid-chapter or after falling asleep
"""
import re

import numpy as np

SR = 24000
INTER_SENTENCE_SIL = int(0.25 * SR)
INTER_PARAGRAPH_SIL = int(0.70 * SR)
LEAD_IN_SIL = int(1.5 * SR)
POST_ANNOUNCE_SIL = int(1.0 * SR)

_pipe = None


def _get_pipeline():
    global _pipe
    if _pipe is None:
        from kokoro import KPipeline
        _pipe = KPipeline(lang_code="a")
    return _pipe


def _synth_paragraph(pipe, para: str, voice: str) -> np.ndarray | None:
    sentence_audios = [
        (a.numpy() if hasattr(a, "numpy") else a) for _, _, a in pipe(para, voice=voice)
    ]
    if not sentence_audios:
        return None
    sil = np.zeros(INTER_SENTENCE_SIL, dtype=np.float32)
    joined = sentence_audios[0]
    for chunk in sentence_audios[1:]:
        joined = np.concatenate([joined, sil, chunk])
    return joined


def synthesize_segment(text: str, voice: str, announce: str = "") -> np.ndarray:
    pipe = _get_pipeline()
    paragraphs = [p for p in re.split(r"\n\n+", text) if p.strip()]

    para_audios = []
    for para in paragraphs:
        a = _synth_paragraph(pipe, para, voice)
        if a is not None:
            para_audios.append(a)

    parts = [np.zeros(LEAD_IN_SIL, dtype=np.float32)]
    if announce:
        for line in [p for p in re.split(r"\n\n+", announce) if p.strip()]:
            a = _synth_paragraph(pipe, line, voice)
            if a is not None:
                parts += [a, np.zeros(POST_ANNOUNCE_SIL, dtype=np.float32)]

    para_sil = np.zeros(INTER_PARAGRAPH_SIL, dtype=np.float32)
    for k, chunk in enumerate(para_audios):
        if k:
            parts.append(para_sil)
        parts.append(chunk)
    return np.concatenate(parts)


if __name__ == "__main__":
    import sys
    import soundfile as sf

    text = sys.argv[1] if len(sys.argv) > 1 else "This is a short test of the synthesis pipeline. It has two sentences.\n\nAnd a second paragraph, to check the longer pause."
    voice = sys.argv[2] if len(sys.argv) > 2 else "af_heart"
    audio = synthesize_segment(text, voice, announce="Chapter 1: A Test. Part 1 of 2.")
    sf.write("synth_test.wav", audio, SR)
    print(f"{len(audio)/SR:.1f}s -> synth_test.wav")
