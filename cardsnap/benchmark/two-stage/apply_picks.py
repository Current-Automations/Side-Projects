import json, pathlib, sys, urllib.request

BENCH = pathlib.Path(r"C:\Users\Jarre\OneDrive\Desktop\Files\Side-Projects\cardsnap\benchmark")
picks = json.load(open(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path.home() / "Downloads" / "picks.json", encoding="utf-8"))
path = BENCH / "labels.json"
labels = json.load(open(path, encoding="utf-8"))

def card(cid):
    req = urllib.request.Request("https://api.tcgdex.net/v2/en/cards/" + cid, headers={"User-Agent": "cardsnap-test"})
    return json.load(urllib.request.urlopen(req, timeout=60))

changed = 0
for l in labels:
    p = picks.get(l["file"])
    if not p or not p.get("pick"):
        continue
    pick = p["pick"]
    if pick == "other:":
        pass
    elif pick in ("__unusable", "__japanese"):
        l["usable"] = pick != "__unusable"
        if pick == "__japanese":
            l["language"] = "non-en"
    else:
        c = card(pick.removeprefix("other:"))
        l.update(set_id=c["set"]["id"], set_name=c["set"]["name"], card_name=c["name"], card_number=c["localId"], tcgdex_id=c["id"])
    if p.get("note"):
        l["notes"] = (l.get("notes", "") + " | review: " + p["note"]).strip(" |")
    changed += 1
path.write_text(json.dumps(labels, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"updated {changed} labels")
