import json, re, sys, urllib.parse, urllib.request

def get(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "cardsnap-test"}), timeout=60).read())

for c in get("https://api.tcgdex.net/v2/en/cards?name=" + urllib.parse.quote(sys.argv[1])):
    if re.match(r"^(A\d|B\d|P-A)", c["id"]):
        continue
    d = get("https://api.tcgdex.net/v2/en/cards/" + c["id"])
    print(f"{d['id']:12} {d['set']['name'][:22]:22} hp {str(d.get('hp')):4} level {str(d.get('level')):5} attacks {[a['name'] for a in d.get('attacks', [])]} abilities {[a['name'] for a in d.get('abilities', [])]}")
