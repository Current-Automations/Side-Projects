import difflib
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
HISTORY = os.path.join(HERE, "history.jsonl")
EDITS = os.path.join(HERE, "edits.jsonl")
DICTIONARY = os.path.join(HERE, "dictionary.txt")


def _read_jsonl(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def entries():
    """History newest first, with the latest manual edit (if any) merged in as `edited`."""
    edits = {e["at"]: e["text"] for e in _read_jsonl(EDITS)}
    rows = _read_jsonl(HISTORY)
    for r in rows:
        if r["at"] in edits:
            r["edited"] = edits[r["at"]]
    return rows[::-1]


def save_edit(at, text):
    with open(EDITS, "a", encoding="utf-8") as f:
        f.write(json.dumps({"at": at, "text": text}, ensure_ascii=False) + "\n")


def _words(s):
    return re.findall(r"[\w'.-]+", s)


def _norm(w):
    return w.lower().strip(".'-")


def suggestions(before, after, max_words=4):
    """Short word swaps between what was pasted and the edit: (heard, written)."""
    a, b = _words(before), _words(after)
    out = []
    sm = difflib.SequenceMatcher(a=[_norm(w) for w in a], b=[_norm(w) for w in b], autojunk=False)
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op != "replace" or i2 - i1 > max_words or j2 - j1 > max_words:
            continue
        heard, written = " ".join(a[i1:i2]).strip(".,"), " ".join(b[j1:j2]).strip(".,")
        if heard.lower() != written.lower() and (heard, written) not in out:
            out.append((heard, written))
    return out


def add_alias(heard, written):
    with open(DICTIONARY, encoding="utf-8") as f:
        lines = f.read().splitlines()
    for i, line in enumerate(lines):
        right, sep, wrongs = line.partition(":")
        if right.strip().lower() == written.lower() and not line.startswith("#"):
            existing = [w.strip().lower() for w in wrongs.split(",") if w.strip()]
            if heard.lower() not in existing:
                lines[i] = f"{right.strip()}: {', '.join([w.strip() for w in wrongs.split(',') if w.strip()] + [heard])}"
            break
    else:
        lines.append(f"{written}: {heard}")
    with open(DICTIONARY, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
