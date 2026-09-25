import json, pathlib, time
from PIL import Image, ImageDraw
from card_detect import detect_candidates

BENCH = pathlib.Path(r"C:\Users\Jarre\OneDrive\Desktop\Files\Side-Projects\cardsnap\benchmark")
OUT = pathlib.Path(__file__).parent.parent / "_work" / "crops"
OUT.mkdir(parents=True, exist_ok=True)
labels = json.load(open(BENCH / "labels.json", encoding="utf-8"))

results = {}
t = time.time()
for l in labels:
    im = Image.open(BENCH / "frames" / l["file"]).convert("RGB")
    W, H = im.size
    # stream UI covers the sides; the video column is roughly the middle half
    boxes = detect_candidates([im])[0]
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
print(f"OWLv2: card box found in {found}/{len(labels)} frames, {time.time()-t:.0f}s")
for k, v in results.items():
    print(" ", k[:30].ljust(30), v)
