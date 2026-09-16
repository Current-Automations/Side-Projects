import base64, difflib, io, json, pathlib, re, urllib.parse, urllib.request
from PIL import Image

S = pathlib.Path(__file__).parent.parent / "_work"
BENCH = pathlib.Path(r"C:\Users\Jarre\OneDrive\Desktop\Files\Side-Projects\cardsnap\benchmark")
labels = [l for l in json.load(open(BENCH / "labels.json", encoding="utf-8")) if l.get("tcgdex_id")]
key = next(l.split("=", 1)[1].strip().strip('"') for l in open(BENCH.parent / ".env.local", encoding="utf-8") if l.startswith("OPENAI_API_KEY="))

def get(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "cardsnap-test"}), timeout=60).read())

PROMPT = """This is a cropped Pokemon TCG card from a live stream frame (maybe sleeved or in a graded slab). Read the printed TEXT only, do not guess from the artwork.
Return JSON: {"name": string|null, "hp": int|null, "level": string|null, "attacks": [string], "abilities": [string], "collector_number": string|null, "readable": bool}
Use null or [] for anything you cannot actually read."""

def read_text(img):
    buf = io.BytesIO(); img.save(buf, "JPEG", quality=92)
    body = {"model": "gpt-4o", "response_format": {"type": "json_object"}, "messages": [{"role": "user", "content": [
        {"type": "text", "text": PROMPT},
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(), "detail": "high"}}]}]}
    req = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=120))
    return json.loads(r["choices"][0]["message"]["content"]), r["usage"]["total_tokens"]

def base_name(n):
    return re.sub(r"\b(ex|EX|V|VMAX|GX|LV\.?X)\b|\u03b4", "", n or "").strip()

details = {}
def printings(name):
    out = []
    for c in get("https://api.tcgdex.net/v2/en/cards?name=" + urllib.parse.quote(name)):
        if re.match(r"^(A\d|B\d|P-A)", c["id"]):
            continue
        if c["id"] not in details:
            details[c["id"]] = get("https://api.tcgdex.net/v2/en/cards/" + c["id"])
        out.append(details[c["id"]])
    return out

def sim(a, b):
    return difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio()

def score(read, d):
    s, why = 0.0, []
    names = [a["name"] for a in d.get("attacks", [])] + [a["name"] for a in d.get("abilities", [])]
    for i, a in enumerate(read.get("attacks", []) + read.get("abilities", [])):
        best = max((sim(a, n) for n in names), default=0)
        if best > 0.8:
            s += 2; why.append(a)
    if read.get("attacks") and d.get("attacks") and sim(read["attacks"][0], d["attacks"][0]["name"]) > 0.8:
        s += 1
    if read.get("hp") and str(read["hp"]) == str(d.get("hp")):
        s += 1; why.append(f"hp{read['hp']}")
    num = (read.get("collector_number") or "").split("/")[0].lstrip("0")
    if num and num == str(d.get("localId", "")).lstrip("0"):
        s += 1.5; why.append(f"#{num}")
    return s, why

tokens, top1, unique_right, ties, rows = 0, 0, 0, 0, []
cache_names = {}
for l in labels:
    p = S / "crops" / l["file"]
    crop = Image.open(p if p.exists() else BENCH / "frames" / l["file"]).convert("RGB")
    read, t = read_text(crop); tokens += t
    name = base_name(read.get("name"))
    if not name:
        rows.append(f"  {l['file'][:28]:28} {l['tcgdex_id']:11} | name unreadable -> human"); continue
    if name not in cache_names:
        cache_names[name] = printings(name)
    ranked = sorted(((score(read, d), d["id"]) for d in cache_names[name]), key=lambda x: -x[0][0])
    if not ranked:
        rows.append(f"  {l['file'][:28]:28} {l['tcgdex_id']:11} | read '{name}', no printings"); continue
    best = ranked[0][0][0]
    tied = [i for (s, _), i in ranked if s == best]
    ok = l["tcgdex_id"] in tied
    if len(tied) == 1 and ok: unique_right += 1
    if len(tied) > 1: ties += 1
    top1 += ok and len(tied) == 1
    rows.append(f"  {l['file'][:28]:28} {l['tcgdex_id']:11} | read {name[:14]:14} hp {str(read.get('hp')):4} atk {str(read.get('attacks'))[:34]:34} # {str(read.get('collector_number'))[:7]:7} | {'UNIQUE' if len(tied)==1 else f'tie x{len(tied)}'} {tied[:4]} score {best} {'OK' if ok else 'MISS'}")
print(f"text-first match on {len(labels)} labeled frames: unique and correct {unique_right}, ties {ties}; gpt-4o tokens {tokens}")
print("\n".join(rows))
