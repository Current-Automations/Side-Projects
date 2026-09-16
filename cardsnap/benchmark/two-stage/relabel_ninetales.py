import json, pathlib

path = pathlib.Path(__file__).parent.parent / "labels.json"
labels = json.load(open(path, encoding="utf-8"))
for l in labels:
    if l["file"].startswith("c3-ninetales-slab-"):
        for k in ("tcgdex_id", "set_id"):
            l.pop(k, None)
        l.update(language="ja", set_name="Japanese Basic (1996, base expansion)", card_name="Ninetales", card_number="38 (PSA label no.)",
                 notes=(l.get("notes", "") + " | review 2026-09-16: PSA label reads '1996 P.M. JAPANESE BASIC NINETALES-HOLO', Japanese card, not xy12-15").strip(" |"))
path.write_text(json.dumps(labels, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print("relabeled", sum(l["file"].startswith("c3-ninetales-slab-") for l in labels))
