import base64, io, json, pathlib, re, urllib.request, urllib.parse
import torch
from PIL import Image
from transformers import AutoModel, AutoProcessor

S = pathlib.Path(__file__).parent.parent / "_work"
BENCH = pathlib.Path(r"C:\Users\Jarre\OneDrive\Desktop\Files\Side-Projects\cardsnap\benchmark")
CACHE = S / "tcgdex_imgs"
labels = json.load(open(BENCH / "labels.json", encoding="utf-8"))
boxes = json.load(open(S / "crops" / "boxes.json"))

key = next(l.split("=", 1)[1].strip().strip('"') for l in open(BENCH.parent / ".env.local", encoding="utf-8") if l.startswith("OPENAI_API_KEY="))

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "cardsnap-test"}), timeout=60).read()

def read_title(img):
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=92)
    body = {
        "model": "gpt-4o",
        "response_format": {"type": "json_object"},
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": "This is a cropped Pokemon TCG card (maybe in a sleeve or graded slab). Read ONLY the card's title bar at the top: the Pokemon or trainer name and any suffix (ex, EX, GX, V, VMAX, LV.X, delta symbol, Dark, Mega/M). If this is a card back or the title is unreadable, say so. Return JSON: {\"name\": string or null, \"suffix\": string or null, \"readable\": bool}"},
            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(), "detail": "high"}},
        ]}],
    }
    req = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=120))
    return json.loads(r["choices"][0]["message"]["content"]), r["usage"]

name_cache = {}
def printings(name):
    if name not in name_cache:
        cards = json.loads(get("https://api.tcgdex.net/v2/en/cards?name=" + urllib.parse.quote(name)))
        name_cache[name] = [c for c in cards if c.get("image") and not re.match(r"^(A\d|B\d|P-A)", c["id"])]
    return name_cache[name]

MID = "google/siglip2-base-patch16-224"
model = AutoModel.from_pretrained(MID, dtype=torch.float16).cuda().eval()
proc = AutoProcessor.from_pretrained(MID)

@torch.no_grad()
def embed(ims):
    x = proc(images=ims, return_tensors="pt").to("cuda")
    e = model.get_image_features(pixel_values=x["pixel_values"].half())
    e = e.pooler_output if hasattr(e, "pooler_output") else e
    return torch.nn.functional.normalize(e.float(), dim=-1)

def base_name(n):
    return re.sub(r"\b(ex|EX|V|VMAX|GX|LV\.?X)\b|δ", "", n or "").strip().lower()

rows, tokens = [], 0
for l in labels:
    rec = {"file": l["file"], "truth": l["card_name"]}
    if not boxes.get(l["file"]):
        rec["status"] = "no card detected"
        rows.append(rec); continue
    crop = Image.open(S / "crops" / l["file"]).convert("RGB")
    title, usage = read_title(crop)
    tokens += usage["total_tokens"]
    rec["title"] = title
    name = title.get("name") if title.get("readable") else None
    if not name:
        rec["status"] = "title unreadable, needs human"
        rows.append(rec); continue
    cands = printings(base_name(name) or name)
    if not cands:
        rec["status"] = f"no catalog printings for '{name}'"
        rows.append(rec); continue
    imgs, keep = [], []
    for c in cands[:120]:
        p = CACHE / f"{c['id'].replace('/', '_')}.png"
        try:
            if not p.exists():
                p.write_bytes(get(c["image"] + "/low.png"))
            imgs.append(Image.open(p).convert("RGB")); keep.append(c)
        except Exception:
            pass
    sims = (embed([crop]) @ embed(imgs).T)[0]
    top = sims.topk(min(5, len(keep)))
    rec["candidates"] = [{"id": keep[j]["id"], "name": keep[j]["name"], "sim": round(s, 3)} for s, j in zip(top.values.tolist(), top.indices.tolist())]
    rec["n_printings"] = len(keep)
    rec["name_ok"] = bool(l["card_name"] != "TODO" and base_name(l["card_name"]) in base_name(name))
    rec["status"] = "ok"
    rows.append(rec)

(S / "two_stage_results.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
named = [r for r in rows if r["truth"] != "TODO"]
ok = sum(1 for r in named if r.get("name_ok"))
print(f"two-stage name accuracy {ok}/{len(named)}; gpt-4o tokens {tokens} (~${tokens*2.5/1e6:.3f} upper bound at input price)")
for r in rows:
    c = r.get("candidates", [{}])[0]
    print(f"  {r['file'][:28]:28} truth {r['truth'][:11]:11} | {r['status'][:28]:28} | title {str((r.get('title') or {}).get('name'))[:14]:14} {str((r.get('title') or {}).get('suffix'))[:6]:6} | top {c.get('id','')} {c.get('name','')[:16]} of {r.get('n_printings','')}")

