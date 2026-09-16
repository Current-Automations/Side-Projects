import json, pathlib, re, sys
from PIL import Image
from rapidocr import RapidOCR

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
import slab

S = pathlib.Path(__file__).parent.parent / "_work"
BENCH = HERE.parent
labels = json.load(open(BENCH / "labels.json", encoding="utf-8"))
names = json.load(open(HERE / "tcgdex_names.json", encoding="utf-8"))
base = sorted({re.sub(r"\b(ex|EX|V|VMAX|VSTAR|GX)\b|\u03b4|^(Dark|Light|Shining) ", "", n).strip().lower() for n in names} | {n.lower() for n in names}, key=len, reverse=True)
engine = RapidOCR()
by_cert = {}
for l in labels:
    f = l["file"]
    p = S / "crops" / f
    img = Image.open(p if p.exists() else BENCH / "frames" / f).convert("RGB")
    img = img.resize((img.width * 2, img.height * 2))
    r = engine(img)
    top = [t for t, b in zip(r.txts or [], r.boxes if r.boxes is not None else []) if max(q[1] for q in b) < 0.4 * img.height]
    lab = slab.parse_label(top, base)
    if lab is None:
        print(f"  {f[:28]:28} not a slab (truth graded={l.get('is_graded')})")
        continue
    ids = slab.resolve(lab)
    want = l.get("tcgdex_id") or f"{l.get('language')} {l['card_name']}"
    by_cert.setdefault(l.get("psa_cert"), []).append(lab)
    print(f"  {f[:28]:28} {str(lab['language']):4} {str(lab['year']):4} {str(lab['name'])[:14]:14} #{str(lab['number']):4} set {str(lab['set'])[:16]:16} {lab['grade']:10} cert {lab['cert']} -> {ids} | truth {want} {l.get('psa_grade', '')} {l.get('psa_cert', '')}")

print("\nmerged per slab (frames grouped by the true cert, i.e. what tracking one slab across frames would give):")
for cert, reads in by_cert.items():
    m = slab.merge(reads)
    print(f"  {len(reads)} frames -> {m['language']} {m['year']} {m['name']} #{m['number']} set {m['set']} {m['grade']} cert {m['cert']} -> {slab.resolve(m)}")
