import difflib, json, pathlib, re, urllib.parse, urllib.request

HERE = pathlib.Path(__file__).parent
GRADE = re.compile(r"\b(GEM\s*-?\s*MT|MINT|NM\s*-?\s*MT|NM|EX\s*-?\s*MT|EX|VG\s*-?\s*EX|VG|GOOD|FAIR|POOR|AUTHENTIC)\b\s*(10|[1-9](?:\.5)?)?(?![\d.])", re.I)
CERT = re.compile(r"\b\d{8,9}\b")
# PSA grade words map to one number, except half grades which print the number anyway
PSA_GRADE_NUMBER = {"GEMMT": "10", "MINT": "9", "NMMT": "8", "NM": "7", "EXMT": "6", "EX": "5", "VGEX": "4", "VG": "3", "GOOD": "2", "FAIR": "1.5", "POOR": "1"}

def get(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "cardsnap-test"}), timeout=120).read())

def sets():
    p = HERE / "tcgdex_sets.json"
    if not p.exists():
        p.write_text(json.dumps(get("https://api.tcgdex.net/v2/en/sets")), encoding="utf-8")
    return json.load(open(p, encoding="utf-8"))

def squash(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())

def parse_label(lines, base_names):
    """lines: OCR text from the top band of a slab crop. Returns None if this is not a PSA label."""
    blob = " ".join(lines)
    cert = CERT.search(blob)
    fixed = re.sub(r"POKEMON\s*EX", "POKEMON-EX", blob.upper().replace("GEMMT", "GEM MT"))
    grades = [g for g in GRADE.finditer(fixed) if not fixed[max(0, g.start() - 8):g.start()].endswith("POKEMON-")]
    grade = max(grades, key=lambda g: len(g.group(1)), default=None)
    if not (cert and grade):
        return None
    words = re.sub(r"-(HOLO|REV\.?\s*HOLO|1ST ED\.?)", " ", blob.upper())
    words = re.sub(r"[^A-Z0-9#' ]", " ", words)
    name = next((n for n in base_names if len(n) >= 4 and re.search(r"\b" + re.escape(n.upper()) + r"\b", words)), None)
    num = re.search(r"#\s*0*(\d+)", blob)
    year = re.search(r"\b(19[89]\d|20[0-3]\d)", blob)
    japanese = "JAPANESE" in blob.upper()
    s = squash(blob)
    set_hit = None
    if not japanese and "POKEMON" in s.upper():
        cands = [x for x in sets() if len(squash(x["name"])) >= 5 and squash(x["name"]) in s]
        set_hit = max(cands, key=lambda x: len(x["name"]), default=None)
    word = re.sub(r"\s*-?\s*", "", grade.group(1).upper())
    number = grade.group(2) or PSA_GRADE_NUMBER.get(word)
    return {"slab": True, "cert": cert.group(0), "grade": f"{word} {number or ''}".strip(), "name": name,
            "number": num.group(1) if num else None, "year": year.group(1) if year else None,
            "language": "ja" if japanese else ("en" if "POKEMON" in s.upper() else None), "set": set_hit["name"] if set_hit else None, "set_id": set_hit["id"] if set_hit else None}

def merge(reads):
    """Several frames of the same slab: most common non-empty value per field."""
    out = {}
    for k in reads[0]:
        vals = [r[k] for r in reads if r.get(k)]
        out[k] = max(set(vals), key=vals.count) if vals else None
    return out

def resolve(label):
    """English slab with name + set: look the exact card up in TCGdex."""
    if label["language"] != "en" or not (label["name"] and label["set_id"]):
        return None
    cards = [c for c in get("https://api.tcgdex.net/v2/en/sets/" + label["set_id"])["cards"] if label["name"] in c["name"].lower()]
    if label["number"]:
        exact = [c for c in cards if c["localId"].lstrip("0") == label["number"]]
        cards = exact or cards
    return [f"{label['set_id']}-{c['localId']}" for c in cards]
