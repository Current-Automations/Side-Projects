import json, pathlib, re, sys

BENCH = pathlib.Path(r"C:\Users\Jarre\OneDrive\Desktop\Files\Side-Projects\cardsnap\benchmark")
labels = {l["file"]: l for l in json.load(open(BENCH / "labels.json", encoding="utf-8"))}
gpt = {r["file"]: r.get("guess") or {} for r in json.load(open(BENCH / "results" / "2026-09-16T15-48-50-801Z.json", encoding="utf-8"))["perFrame"]}
two = {r["file"]: r for r in json.load(open(sys.argv[1], encoding="utf-8"))}

def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower().replace("pokemon", "").replace("pokémon", ""))

def num(s):
    return (s or "").split("/")[0].lstrip("0").lower()

def name(s):
    return re.sub(r"\b(ex|v|vmax|gx)\b|\u03b4", "", (s or "").lower()).strip()

rows, g_name, g_print, t_name, t1, t5 = [], 0, 0, 0, 0, 0
scored = [l for l in labels.values() if l.get("tcgdex_id")]
for l in scored:
    g = gpt.get(l["file"], {})
    gn = name(g.get("card_name")) == name(l["card_name"])
    gp = gn and norm(g.get("set_name")) == norm(l["set_name"]) and num(g.get("card_number")) == num(l["card_number"])
    ids = [c["id"] for c in two.get(l["file"], {}).get("candidates", [])]
    tn = bool(ids) and name(two[l["file"]]["candidates"][0]["name"]) == name(l["card_name"])
    a1 = ids[:1] == [l["tcgdex_id"]]
    a5 = l["tcgdex_id"] in ids
    g_name += gn; g_print += gp; t_name += tn; t1 += a1; t5 += a5
    rows.append(f"  {l['file'][:28]:28} {l['tcgdex_id']:11} | gpt {str(g.get('set_name'))[:18]:18} #{str(g.get('card_number'))[:7]:7} {'P' if gp else ('n' if gn else '-')} | two-stage top1 {(ids or ['none'])[0]:11} {'P' if a1 else ('top5' if a5 else '-')}")
n = len(scored)
print(f"{n} frames with an exact printing label (unusable, non-English and unresolved Lopunny excluded)")
print(f"GPT-4o      name {g_name}/{n}  exact printing {g_print}/{n}")
print(f"two-stage   name {t_name}/{n}  exact printing top-1 {t1}/{n}, top-5 {t5}/{n}")
print("\n".join(rows))
