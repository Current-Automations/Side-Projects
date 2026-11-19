import re


def load(path):
    """One term per line. `Right: wrong one, wrong two` also rewrites those mishearings."""
    terms, fixes = [], []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            right, _, wrongs = line.partition(":")
            right = right.strip()
            terms.append(right)
            for wrong in wrongs.split(","):
                wrong = wrong.strip()
                if wrong:
                    fixes.append((re.compile(r"\b" + re.escape(wrong) + r"\b", re.IGNORECASE), right))
    return terms, fixes


def apply(text, fixes):
    for pattern, right in fixes:
        text = pattern.sub(right, text)
    return text
