import json, pathlib, re, sys, urllib.parse, urllib.request
import torch
from PIL import Image
from transformers import AutoModel, AutoProcessor

S = pathlib.Path(__file__).parent.parent / "_work"
name, target, frames = sys.argv[1], sys.argv[2], sys.argv[3:]

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "cardsnap-test"}), timeout=60).read()

cards = [c for c in json.loads(get("https://api.tcgdex.net/v2/en/cards?name=" + urllib.parse.quote(name))) if c.get("image") and not re.match(r"^(A\d|B\d|P-A)", c["id"])]
imgs = {}
for c in cards:
    p = S / "tcgdex_imgs" / f"{c['id']}.png"
    if not p.exists():
        p.write_bytes(get(c["image"] + "/low.png"))
    imgs[c["id"]] = Image.open(p).convert("RGB")
print("target in catalog:", target in imgs, "| low.png size", imgs[target].size if target in imgs else None)

MID = "google/siglip2-base-patch16-224"
model = AutoModel.from_pretrained(MID, dtype=torch.float16).cuda().eval()
proc = AutoProcessor.from_pretrained(MID)

@torch.no_grad()
def embed(ims):
    x = proc(images=ims, return_tensors="pt").to("cuda")
    e = model.get_image_features(pixel_values=x["pixel_values"].half())
    e = e.pooler_output if hasattr(e, "pooler_output") else e
    return torch.nn.functional.normalize(e.float(), dim=-1)

ids = list(imgs)
cat = embed([imgs[i] for i in ids])
for f in frames:
    for label, im in (("crop", Image.open(S / "crops" / f)), ("title-cut top 60%", None)):
        q = Image.open(S / "crops" / f).convert("RGB")
        if im is None:
            w, h = q.size
            q = q.crop((0, 0, w, int(h * 0.6)))
            c = cat
            cat_q = embed([imgs[i].crop((0, 0, imgs[i].size[0], int(imgs[i].size[1] * 0.6))) for i in ids])
        else:
            cat_q = cat
        sims = (embed([q]) @ cat_q.T)[0]
        order = sims.argsort(descending=True).tolist()
        rank = [ids[j] for j in order].index(target) + 1
        print(f"{f:22} {label:18} {target} rank {rank}/{len(ids)} sim {sims[ids.index(target)]:.3f} | top {ids[order[0]]} {sims[order[0]]:.3f}")
