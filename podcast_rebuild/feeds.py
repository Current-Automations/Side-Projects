import urllib.request, xml.etree.ElementTree as ET, json, email.utils, os
F=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"feeds_sources.json"),encoding="utf-8"))
out={}
for s,us in F.items():
    if not us: continue
    try:
      items=[]
      for u in ([us] if isinstance(us,str) else us):
        x=urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":"Mozilla/5.0"}),timeout=60).read()
        root=ET.fromstring(x)
        ns="{http://www.itunes.com/dtds/podcast-1.0.dtd}"
        for it in root.iter("item"):
            t=it.findtext("title") or ""; d=it.findtext("pubDate") or ""
            dt=email.utils.parsedate_to_datetime(d).strftime("%Y-%m-%d") if d else ""
            enc=it.find("enclosure"); items.append(dict(t=t,d=dt,ep=it.findtext(ns+"episode"),audio=enc.get("url") if enc is not None else None))
      out[s]=items; print(s,len(items),items[0]["t"][:60],items[-1]["d"])
    except Exception as e: print(s,"ERR",e)
json.dump(out,open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"feeds.json"),"w",encoding="utf-8"))
