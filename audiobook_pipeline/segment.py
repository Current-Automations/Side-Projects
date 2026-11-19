"""Chapter -> list of {"label": str, "text": str} segments.

Anything estimated over TARGET_MAX_MIN splits into n = ceil(total / TARGET_MAX)
balanced chunks at paragraph boundaries (never mid-sentence), so a 41-minute
chapter becomes 3 x ~14 min rather than 20 + 20 + 1. Hard ceiling
HARD_CEILING_MIN is enforced by falling back to sentence boundaries when a
single paragraph is too coarse. This is the feature that turns a 45-60 min
chapter into listenable pieces of roughly 15 to 20 minutes.
"""
import math
import re
from dataclasses import dataclass

WPM = 150  # Kokoro af_heart measured ~159 wpm; 150 keeps estimates conservative
TARGET_MIN_MIN = 15
TARGET_MAX_MIN = 20
HARD_CEILING_MIN = 30

_SENTENCE_SPLIT = re.compile(r"(?:(?<=[.!?])|(?<=[.!?][\"')\]]))\s+(?=[\"'(\[]?[A-Z0-9])")


def _words(text: str) -> int:
    return len(text.split())


def _minutes(word_count: int) -> float:
    return word_count / WPM


@dataclass
class Segment:
    label: str
    text: str


def _units(text: str) -> list[tuple[str, str]]:
    """(separator, text) units. Paragraphs by default; a paragraph that alone
    exceeds the target band is broken into sentences joined by spaces."""
    limit = TARGET_MAX_MIN * WPM
    out = []
    for para in re.split(r"\n\n+", text):
        para = para.strip()
        if not para:
            continue
        if _words(para) <= limit:
            out.append(("\n\n", para))
            continue
        for k, sent in enumerate(_SENTENCE_SPLIT.split(para)):
            out.append(("\n\n" if k == 0 else " ", sent))
    return out


def _pack(units: list[tuple[str, str]], n: int) -> list[str]:
    total = sum(_words(t) for _, t in units)
    chunks, current, current_words, consumed = [], [], 0, 0
    for idx, (sep, t) in enumerate(units):
        remaining_chunks = n - len(chunks)
        if remaining_chunks > 1 and current:
            target = (total - consumed) / remaining_chunks
            w = _words(t)
            # Close the chunk when stopping here is closer to target than
            # taking one more unit, or when taking it would breach the ceiling.
            if (abs(current_words - target) <= abs(current_words + w - target)
                    or _minutes(current_words + w) > HARD_CEILING_MIN):
                chunks.append(current)
                consumed += current_words
                current, current_words = [], 0
        current.append((sep, t))
        current_words += _words(t)
    if current:
        chunks.append(current)

    rendered = []
    for chunk in chunks:
        s = chunk[0][1]
        for sep, t in chunk[1:]:
            s += sep + t
        rendered.append(s)
    return rendered


def segment_chapter(title: str, text: str) -> list[Segment]:
    total_min = _minutes(_words(text))
    if total_min <= TARGET_MAX_MIN:
        return [Segment(label=title, text=text)]

    n = max(2, math.ceil(total_min / TARGET_MAX_MIN))
    chunks = _pack(_units(text), n)
    if len(chunks) == 1:
        return [Segment(label=title, text=chunks[0])]
    n = len(chunks)
    return [Segment(label=f"{title} ({i} of {n})", text=c) for i, c in enumerate(chunks, 1)]


def segment_book(chapters: list[dict]) -> list[Segment]:
    segments: list[Segment] = []
    for ch in chapters:
        segments.extend(segment_chapter(ch["title"], ch["text"]))
    return segments


def spoken_label(label: str) -> str:
    """'Chapter 3: The Eyes (2 of 4)' -> 'Chapter 3: The Eyes. Part 2 of 4.'
    for the spoken announcement at the head of each segment."""
    def end(s: str) -> str:
        s = s.rstrip(". ")
        return s if s.endswith(("?", "!")) else s + "."
    m = re.match(r"^(.*?)\s*\((\d+) of (\d+)\)\s*$", label)
    if m:
        return f"{end(m.group(1))} Part {m.group(2)} of {m.group(3)}."
    return end(label)


if __name__ == "__main__":
    import sys
    from pathlib import Path
    from epub_extract import extract_chapters

    chapters = extract_chapters(Path(sys.argv[1]))
    segments = segment_book(chapters)
    over = 0
    for i, seg in enumerate(segments, 1):
        w = _words(seg.text)
        flag = "  <-- over ceiling" if _minutes(w) > HARD_CEILING_MIN else ""
        over += bool(flag)
        print(f"{i:2d}. {seg.label!r:75s} {w:5d} words (~{_minutes(w):.1f} min){flag}")
    print(f"{len(segments)} segments, {over} over the {HARD_CEILING_MIN} min ceiling")
