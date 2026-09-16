import json, pathlib
for r in json.load(open(pathlib.Path(__file__).parent.parent / "_work" / "two_stage_results.json", encoding="utf-8")):
    if r.get("candidates"):
        print(r["file"][:26].ljust(26), (r["title"] or {}).get("name"), "|", " ".join(f"{c['id']}:{c['sim']}" for c in r["candidates"]))
