import base64, difflib, io, json, pathlib, re, sys, time, urllib.parse, urllib.request
from PIL import Image

S = pathlib.Path(__file__).parent.parent / "_work"
HERE = pathlib.Path(__file__).parent
BENCH = HERE.parent
labels = [l for l in json.load(open(BENCH / "labels.json", encoding="utf-8")) if l.get("tcgdex_id")]
POCKET = re.compile(r"^(A\d|B\d|P-A)")

def get(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "cardsnap-test"}), timeout=120).read())

def sim(a, b):
    return difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio()

def norm(s):
    return re.sub(r"[^a-z0-9 ]", "", (s or "").lower()).strip()

names_path = HERE / "tcgdex_names.json"
if not names_path.exists():
    names_path.write_text(json.dumps(sorted({c["name"] for c in get("https://api.tcgdex.net/v2/en/cards") if not POCKET.match(c["id"])})), encoding="utf-8")
ALL_NAMES = json.load(open(names_path, encoding="utf-8"))
BASE_NAMES = sorted({norm(re.sub(r"\b(ex|EX|V|VMAX|VSTAR|GX)\b|\u03b4", "", n)) for n in ALL_NAMES} - {""}, key=len, reverse=True)

details = {}
def printings(name):
    out = []
    for c in get("https://api.tcgdex.net/v2/en/cards?name=" + urllib.parse.quote(name)):
        if POCKET.match(c["id"]):
            continue
        if c["id"] not in details:
            details[c["id"]] = get("https://api.tcgdex.net/v2/en/cards/" + c["id"])
        out.append(details[c["id"]])
    return out

def score(read, d):
    s = 0.0
    names = [a["name"] for a in d.get("attacks", []) + d.get("abilities", []) if a.get("name")]
    for a in read["moves"]:
        if max((sim(a, n) for n in names), default=0) > 0.8:
            s += 2
    if read["moves"] and names and sim(read["moves"][0], names[0]) > 0.8:
        s += 1
    if read["hp"] and str(read["hp"]) == str(d.get("hp")):
        s += 1
    return s

def load_crop(f):
    p = S / "crops" / f
    return Image.open(p if p.exists() else BENCH / "frames" / f).convert("RGB")

# --- reader 1: plain OCR, then find names/moves/HP in the words ourselves
# name only from the top band: the title bar is always there, and moves below can't be mistaken for a name
TOP_BAND = float(next((a.split("=")[1] for a in sys.argv if a.startswith("--top=")), 0.3))
def read_ocr(img, engine):
    img = img.resize((img.width * 2, img.height * 2))
    res = engine(img)
    lines = [(t, box) for t, box in zip(res.txts or [], res.boxes if res.boxes is not None else [])]
    lines.sort(key=lambda x: min(p[1] for p in x[1]))
    text = [t for t, _ in lines]
    blob = " ".join(text)
    top = [t for t, box in lines if max(p[1] for p in box) < TOP_BAND * img.height]
    name = None
    for t in top:
        nt = norm(t)
        nt = re.sub(r"(\D)(\d)", r"\1 \2", nt)
        for n in BASE_NAMES:
            if len(n) >= 4 and (re.search(r"\b" + re.escape(n) + r"\b", nt) or (abs(len(n) - len(nt)) <= 2 and sim(n, nt) > 0.9)):
                name = n; break
        if name:
            break
    hp = re.search(r"(?:HP\s*(\d{2,3}))|(?:(\d{2,3})\s*HP)", blob, re.I)
    return {"name": name, "hp": int(hp.group(1) or hp.group(2)) if hp else None, "moves": [t for t in text if 4 <= len(t) <= 30], "raw": blob[:120]}

# --- reader 2: local vision model through Ollama
PROMPT = """Cropped Pokemon TCG card from a stream frame. Read the printed TEXT only, do not guess from the artwork.
Return JSON: {"name": string|null, "hp": int|null, "attacks": [string], "abilities": [string], "readable": bool}. Use null or [] for anything you cannot read."""

def read_vlm(img, model):
    buf = io.BytesIO(); img.save(buf, "JPEG", quality=92)
    body = {"model": model, "stream": False, "think": False, "format": "json", "options": {"temperature": 0},
            "messages": [{"role": "user", "content": PROMPT, "images": [base64.b64encode(buf.getvalue()).decode()]}]}
    req = urllib.request.Request("http://localhost:11434/api/chat", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    r = json.loads(json.load(urllib.request.urlopen(req, timeout=600))["message"]["content"])
    name = norm(re.sub(r"\b(ex|EX|V|VMAX|VSTAR|GX)\b|\u03b4", "", r.get("name") or ""))
    return {"name": name or None, "hp": r.get("hp"), "moves": (r.get("attacks") or []) + (r.get("abilities") or []), "raw": str(r)[:120]}

def run(label, reader):
    t0, rows, stats = time.time(), [], {"unique_ok": 0, "tie_ok": 0, "wrong": 0, "human": 0}
    for l in labels:
        read = reader(load_crop(l["file"]))
        cands = printings(read["name"]) if read["name"] else []
        if not cands:
            stats["human"] += 1
            rows.append(f"  {l['file'][:26]:26} {l['tcgdex_id']:11} | name {str(read['name'])[:14]:14} -> human | {read['raw'][:70]}")
            continue
        ranked = sorted(((score(read, d), d["id"]) for d in cands), reverse=True)
        best = ranked[0][0]
        tied = [i for s, i in ranked if s == best]
        ok = l["tcgdex_id"] in tied
        key = "wrong" if not ok else ("unique_ok" if len(tied) == 1 else "tie_ok")
        stats[key] += 1
        rows.append(f"  {l['file'][:26]:26} {l['tcgdex_id']:11} | name {read['name'][:14]:14} hp {str(read['hp']):4} | {'UNIQUE' if len(tied) == 1 else f'tie x{len(tied)}'} {tied[:3]} {'OK' if ok else 'WRONG'}")
    print(f"\n{label}: {stats} in {time.time() - t0:.0f}s ({(time.time() - t0) / len(labels):.1f}s/frame)")
    print("\n".join(rows))

which = [a for a in sys.argv[1:] if not a.startswith("--")] or ["ocr", "qwen"]
if "ocr" in which:
    from rapidocr import RapidOCR
    engine = RapidOCR()
    run("RapidOCR (plain OCR)", lambda im: read_ocr(im, engine))
if "qwen" in which:
    run("Qwen3.5-9B vision (Ollama)", lambda im: read_vlm(im, "hf.co/unsloth/Qwen3.5-9B-GGUF:Q4_K_M"))
