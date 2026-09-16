import base64, html, io, json, pathlib, re, urllib.request, urllib.parse
import torch
from PIL import Image
from transformers import AutoModel, AutoProcessor

S = pathlib.Path(__file__).parent.parent / "_work"
BENCH = pathlib.Path(r"C:\Users\Jarre\OneDrive\Desktop\Files\Side-Projects\cardsnap\benchmark")
CACHE = S / "tcgdex_imgs"
labels = json.load(open(BENCH / "labels.json", encoding="utf-8"))
results = {r["file"]: r for r in json.load(open(S / "two_stage_results.json", encoding="utf-8"))}

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "cardsnap-test"}), timeout=60).read()

def base_name(n):
    return re.sub(r"\b(ex|EX|V|VMAX|GX|LV\.?X)\b|\u03b4", "", n or "").strip().lower()

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

def load(c):
    p = CACHE / f"{c['id'].replace('/', '_')}.png"
    if not p.exists():
        p.write_bytes(get(c["image"] + "/low.png"))
    return Image.open(p).convert("RGB")

def ranked(query, name, k=6):
    imgs, keep = [], []
    for c in printings(name)[:120]:
        try:
            imgs.append(load(c)); keep.append(c)
        except Exception:
            pass
    if not keep:
        return []
    sims = (embed([query]) @ embed(imgs).T)[0]
    top = sims.topk(min(k, len(keep)))
    return [(keep[j], imgs[j], round(s, 3)) for s, j in zip(top.values.tolist(), top.indices.tolist())]

def b64(im, w):
    im = im.copy(); im.thumbnail((w, w * 2))
    buf = io.BytesIO(); im.save(buf, "JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()

cards = []
for l in labels:
    f = l["file"]
    crop_p = S / "crops" / f
    query = Image.open(crop_p if crop_p.exists() else BENCH / "frames" / f).convert("RGB")
    r = results.get(f, {})
    read = (r.get("title") or {}).get("name") if (r.get("title") or {}).get("readable") else None
    names = []
    for n in (read, l["card_name"] if l["card_name"] != "TODO" else None):
        if n and base_name(n) and base_name(n) not in names:
            names.append(base_name(n))
    groups = [(n, ranked(query, n)) for n in names]
    blocks = []
    for n, cands in groups:
        opts = "".join(
            f'<label class="cand"><input type="radio" name="{html.escape(f)}" value="{c["id"]}"><img src="{b64(im, 180)}"><span>{c["id"]}<br>{html.escape(c["name"])} #{c["localId"]}<br>sim {s}</span></label>'
            for c, im, s in cands)
        blocks.append(f'<div class="grp"><div class="gname">printings of "{html.escape(n)}"</div><div class="cands">{opts or "<i>none in catalog</i>"}</div></div>')
    cards.append(f'''<section data-file="{html.escape(f)}">
<h2>{html.escape(f)}</h2>
<p class="meta">label: <b>{html.escape(l["card_name"])}</b> | GPT-4o title read: <b>{html.escape(str(read))}</b> | {html.escape(r.get("status", ""))}</p>
<div class="row"><div class="q"><img src="{b64(Image.open(BENCH / "frames" / f).convert("RGB"), 420)}"><img src="{b64(query, 260)}"></div>
<div>{"".join(blocks)}
<div class="other"><label><input type="radio" name="{html.escape(f)}" value="__other"> other id: <input type="text" class="otherid" placeholder="e.g. dp1-30"></label>
<label><input type="radio" name="{html.escape(f)}" value="__unusable"> unusable frame (card back, edge-on, blur)</label>
<label><input type="radio" name="{html.escape(f)}" value="__japanese"> Japanese / not in EN catalog</label>
<label>note: <input type="text" class="note"></label></div></div></div></section>''')

page = f'''<!doctype html><html><head><meta charset="utf-8"><title>CardSnap Label Review</title><style>
:root{{--bg:#f6f5f2;--fg:#1c1c1c;--card:#fff;--line:#ddd;--acc:#0e7359}}
@media (prefers-color-scheme:dark){{:root{{--bg:#151515;--fg:#eee;--card:#1f1f1f;--line:#333;--acc:#3fbf9a}}}}
body{{background:var(--bg);color:var(--fg);font:14px system-ui;margin:0;padding:16px 16px 80px}}
section{{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;margin:0 0 16px}}
section.done{{border-color:var(--acc)}} h2{{margin:0 0 4px;font-size:15px}} .meta{{margin:0 0 8px;opacity:.8}}
.row{{display:flex;gap:16px;flex-wrap:wrap}} .q img{{display:block;max-width:100%;margin-bottom:6px}}
.cands{{display:flex;flex-wrap:wrap;gap:8px}} .cand{{display:flex;flex-direction:column;align-items:center;width:130px;font-size:12px;cursor:pointer;border:2px solid transparent;padding:4px;border-radius:6px}}
.cand img{{width:120px}} .cand:has(input:checked){{border-color:var(--acc)}} .gname{{font-weight:600;margin:8px 0 4px}}
.other label{{display:block;margin:4px 0}} #bar{{position:fixed;bottom:0;left:0;right:0;background:var(--card);border-top:1px solid var(--line);padding:10px 16px;display:flex;gap:12px;align-items:center}}
button{{background:var(--acc);color:#fff;border:0;padding:8px 14px;border-radius:6px;font-weight:600;cursor:pointer}}
</style></head><body><h1>CardSnap label review</h1><p>Pick the exact printing per frame, then Export. Saves progress in this browser.</p>
{"".join(cards)}
<div id="bar"><button id="exp">Export picks.json</button><span id="count"></span></div>
<script>
const K="cardsnap-review";
function collect(){{const out={{}};document.querySelectorAll("section").forEach(s=>{{const f=s.dataset.file;const c=s.querySelector("input[type=radio]:checked");const note=s.querySelector(".note").value;
 let pick=c?c.value:null;if(pick==="__other")pick="other:"+s.querySelector(".otherid").value.trim();s.classList.toggle("done",!!pick);if(pick||note)out[f]={{pick,note}};}});
 document.getElementById("count").textContent=Object.values(out).filter(v=>v.pick).length+" / "+document.querySelectorAll("section").length+" picked";return out;}}
function save(){{try{{localStorage.setItem(K,JSON.stringify(collect()))}}catch(e){{collect()}}}}
try{{const d=JSON.parse(localStorage.getItem(K)||"{{}}");document.querySelectorAll("section").forEach(s=>{{const v=d[s.dataset.file];if(!v)return;s.querySelector(".note").value=v.note||"";
 if(v.pick){{let val=v.pick;if(val.startsWith("other:")){{s.querySelector(".otherid").value=val.slice(6);val="__other"}}const r=[...s.querySelectorAll("input[type=radio]")].find(i=>i.value===val);if(r)r.checked=true;}}}})}}catch(e){{}}
document.addEventListener("input",save);collect();
document.getElementById("exp").onclick=()=>{{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(collect(),null,2)],{{type:"application/json"}}));a.download="picks.json";a.click();}};
</script></body></html>'''
out = BENCH / "review.html"
out.write_text(page, encoding="utf-8")
print(out, f"{out.stat().st_size/1e6:.1f}MB", len(cards), "frames")
