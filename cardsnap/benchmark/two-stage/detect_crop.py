import json, pathlib, time
import torch
from PIL import Image, ImageDraw
from transformers import Owlv2Processor, Owlv2ForObjectDetection

BENCH = pathlib.Path(r"C:\Users\Jarre\OneDrive\Desktop\Files\Side-Projects\cardsnap\benchmark")
OUT = pathlib.Path(__file__).parent.parent / "_work" / "crops"
OUT.mkdir(parents=True, exist_ok=True)
labels = json.load(open(BENCH / "labels.json", encoding="utf-8"))

MID = "google/owlv2-base-patch16-ensemble"
proc = Owlv2Processor.from_pretrained(MID)
model = Owlv2ForObjectDetection.from_pretrained(MID, dtype=torch.float16).cuda().eval()
QUERIES = [["a pokemon trading card", "a graded card slab", "a trading card in a plastic case"]]

results = {}
t = time.time()
for l in labels:
    im = Image.open(BENCH / "frames" / l["file"]).convert("RGB")
    W, H = im.size
    # stream UI covers the sides; the video column is roughly the middle half
    x = proc(text=QUERIES, images=im, return_tensors="pt").to("cuda")
    x["pixel_values"] = x["pixel_values"].half()
    with torch.no_grad():
        out = model(**x)
    side = max(W, H)  # owlv2 pads to square
    r = proc.post_process_object_detection(out, threshold=0.1, target_sizes=torch.tensor([[side, side]]).cuda())[0]
    boxes = []
    for b, s in zip(r["boxes"].tolist(), r["scores"].tolist()):
        x0, y0, x1, y1 = [max(0, v) for v in b]
        x1, y1 = min(W, x1), min(H, y1)
        w, h = x1 - x0, y1 - y0
        if w < 40 or h < 60 or w * h > 0.5 * W * H:
            continue
        ar = h / max(w, 1)
        cx = (x0 + x1) / 2
        if not (0.25 * W < cx < 0.75 * W) or y1 > 0.95 * H or not (1.15 < ar < 2.3):
            continue
        boxes.append((s, x0, y0, x1, y1, ar))
    boxes = [b for b in boxes if b[0] >= 0.15]
    boxes.sort(key=lambda b: -((b[3] - b[1]) * (b[4] - b[2])))
    if boxes:
        s, x0, y0, x1, y1, ar = boxes[0]
        im.crop((int(x0), int(y0), int(x1), int(y1))).save(OUT / l["file"])
        results[l["file"]] = {"score": round(s, 3), "box": [int(x0), int(y0), int(x1), int(y1)], "aspect": round(ar, 2)}
    else:
        results[l["file"]] = None
    dbg = im.copy()
    d = ImageDraw.Draw(dbg)
    for s, x0, y0, x1, y1, _ in boxes[:3]:
        d.rectangle((x0, y0, x1, y1), outline="lime" if (s, x0) == (boxes[0][0], boxes[0][1]) else "red", width=3)
    dbg.save(OUT / ("_dbg_" + l["file"]))
(OUT / "boxes.json").write_text(json.dumps(results, indent=2))
found = sum(1 for v in results.values() if v)
print(f"OWLv2: card box found in {found}/{len(labels)} frames, {time.time()-t:.0f}s, peak VRAM {torch.cuda.max_memory_allocated()/1e9:.1f}GB")
for k, v in results.items():
    print(" ", k[:30].ljust(30), v)
