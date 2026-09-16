import base64, html, io, json, pathlib, re, sys, urllib.parse, urllib.request
from PIL import Image

BENCH = pathlib.Path(r"C:\Users\Jarre\OneDrive\Desktop\Files\Side-Projects\cardsnap\benchmark")
name, frames = sys.argv[1], sys.argv[2:]

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "cardsnap-test"}), timeout=60).read()

def b64(im, w):
    im = im.convert("RGB"); im.thumbnail((w, w * 2))
    buf = io.BytesIO(); im.save(buf, "JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()

cards = [c for c in json.loads(get("https://api.tcgdex.net/v2/en/cards?name=" + urllib.parse.quote(name))) if c.get("image") and not re.match(r"^(A\d|B\d|P-A)", c["id"])]
tiles = []
for c in cards:
    d = json.loads(get("https://api.tcgdex.net/v2/en/cards/" + c["id"]))
    im = Image.open(io.BytesIO(get(c["image"] + "/high.png")))
    tiles.append(f'<figure><img src="{b64(im, 360)}"><figcaption><b>{c["id"]}</b><br>{html.escape(d["set"]["name"])} #{c["localId"]}</figcaption></figure>')
refs = "".join(f'<img src="{b64(Image.open(BENCH / "frames" / f), 520)}">' for f in frames)
out = BENCH / "two-stage" / f"all-{name.lower()}.html"
out.write_text(f'''<!doctype html><html><head><meta charset="utf-8"><title>All {html.escape(name)} Printings</title><style>
:root{{--bg:#f6f5f2;--fg:#1c1c1c}}@media (prefers-color-scheme:dark){{:root{{--bg:#151515;--fg:#eee}}}}
body{{background:var(--bg);color:var(--fg);font:14px system-ui;margin:0;padding:16px}}
.refs{{position:sticky;top:0;background:var(--bg);display:flex;gap:8px;overflow-x:auto;padding-bottom:8px;z-index:1}} .refs img{{height:260px}}
.grid{{display:flex;flex-wrap:wrap;gap:12px}} figure{{margin:0;width:180px}} figure img{{width:180px}}
</style></head><body><div class="refs">{refs}</div><div class="grid">{"".join(tiles)}</div></body></html>''', encoding="utf-8")
print(out, len(tiles), "printings")
