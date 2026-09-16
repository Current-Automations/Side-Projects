import json, pathlib

path = pathlib.Path(__file__).parent.parent / "labels.json"
labels = json.load(open(path, encoding="utf-8"))
NOTE = " | review 2026-09-16: fields from the PSA label text"
for l in labels:
    f = l["file"]
    if f in ("c1c2-latias-ex-slab-07.jpg", "c1c2-latias-ex-slab-08.jpg"):
        for k in ("tcgdex_id", "set_id"):
            l.pop(k, None)
        l.update(language="ja", card_name="Dark Gyarados", set_name="Japanese Silver Deck Kit, 1st Edition (2004)", card_number="004",
                 psa_grade="GEM MT 10", psa_cert="152041682", notes=l.get("notes", "") + NOTE)
    elif f.startswith("c1c2-latias-ex-slab-"):
        l.update(psa_grade="NM-MT 8", psa_cert="148921562")
    elif f.startswith("c3-ninetales-slab-"):
        l.update(psa_grade="NM-MT 8", psa_cert="146967545")
path.write_text(json.dumps(labels, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print("done")
