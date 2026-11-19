"""Whisper re-transcribe check: warning log only, never a gate.

Rule of thumb: dropped words are only a dealbreaker "if i cant
understand what is trying to be said." So this flags comprehension-breaking
gaps -- long runs of source words with no match anywhere nearby in the
transcript -- not single-word diffs (a name mispronounced, a contraction
transcribed differently, numbers written as digits vs words, etc).
"""
import re
from difflib import SequenceMatcher

MODEL_NAME = "deepdml/faster-whisper-large-v3-turbo-ct2"
GAP_WORD_THRESHOLD = 8  # a dropped run shorter than this is noise, not a warning

_model = None

_SMALL = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
    "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}


def _get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        _model = WhisperModel(MODEL_NAME, device="cuda", compute_type="float16")
    return _model


def _normalize(text: str) -> list[str]:
    text = text.lower().replace("%", " percent ")
    text = re.sub(r"(\d),(\d)", r"\1\2", text)
    text = re.sub(r"[^a-z0-9' ]", " ", text)
    words = text.split()
    out = []
    for w in words:
        # "twenty" -> "20" so a Whisper digit rendering doesn't read as a drop.
        # Compound numbers ("twenty five") stay two tokens: still short, still
        # under the gap threshold, so they never fire a warning either way.
        out.append(str(_SMALL[w]) if w in _SMALL else w)
    return out


def transcribe(wav_path: str) -> str:
    model = _get_model()
    segments, _ = model.transcribe(wav_path, beam_size=5)
    return " ".join(s.text.strip() for s in segments)


def find_comprehension_gaps(source_text: str, transcript: str) -> list[str]:
    """Return a list of warning strings, one per dropped run of
    GAP_WORD_THRESHOLD+ consecutive source words with no counterpart in the
    transcript. A 'replace' only counts when the transcript side is under
    half the source span: a paraphrase-length mismatch is a transcription
    quirk, a collapse is a real drop. Empty list = clean."""
    src_words = _normalize(source_text)
    trans_words = _normalize(transcript)
    n = max(1, len(src_words))

    matcher = SequenceMatcher(None, src_words, trans_words, autojunk=False)
    warnings = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        src_len = i2 - i1
        if src_len < GAP_WORD_THRESHOLD:
            continue
        if tag == "delete" or (tag == "replace" and (j2 - j1) * 2 < src_len):
            dropped = " ".join(src_words[i1:i2])
            warnings.append(
                f"Dropped ~{src_len - (j2 - j1)} words at ~{100 * i1 // n}% in: "
                f"\"{dropped[:120]}{'...' if len(dropped) > 120 else ''}\""
            )
    return warnings


def validate_segment(wav_path: str, source_text: str, label: str) -> list[str]:
    transcript = transcribe(wav_path)
    gaps = find_comprehension_gaps(source_text, transcript)
    return [f"[{label}] {g}" for g in gaps]


if __name__ == "__main__":
    import sys
    wav = sys.argv[1]
    src = open(sys.argv[2], encoding="utf-8").read()
    warnings = validate_segment(wav, src, label=wav)
    if warnings:
        print("\n".join(warnings))
    else:
        print("Clean: no comprehension-breaking gaps found.")
