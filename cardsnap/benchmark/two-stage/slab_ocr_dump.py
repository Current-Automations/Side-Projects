import pathlib
from PIL import Image
from rapidocr import RapidOCR

S = pathlib.Path(__file__).parent.parent / "_work"
BENCH = pathlib.Path(__file__).parent.parent
engine = RapidOCR()
for f in sorted(p.name for p in (BENCH / "frames").iterdir() if "slab" in p.name):
    p = S / "crops" / f
    img = Image.open(p if p.exists() else BENCH / "frames" / f).convert("RGB")
    img = img.resize((img.width * 2, img.height * 2))
    r = engine(img)
    lines = sorted(zip(r.txts or [], r.boxes if r.boxes is not None else []), key=lambda x: min(q[1] for q in x[1]))
    print(f, "|", " / ".join(f"{t}@{max(q[1] for q in b) / img.height:.2f}" for t, b in lines[:10]))
