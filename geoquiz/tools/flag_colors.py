#!/usr/bin/env python3
"""Ermittelt die dominanten Flaggenfarben (Rot, Weiß, Blau, Grün, Gelb, Schwarz,
Orange, Lila) aus den SVG-Flaggen. Die SVGs werden in headless Chromium
gerastert, Pixel je Farbklasse gezählt; Farben mit mindestens 5 % Anteil zählen.

  python3 tools/flag_colors.py --countries countries.json --flags flag-icons/flags/4x3 \
      --chrome /usr/bin/chromium --out tools/flagcolors.json
"""
import argparse
import colorsys
import json
import os
import re
import subprocess
import tempfile

PAGE = """<html><body><script>
const flags=%s; const out={}; const keys=Object.keys(flags); let i=0;
function next(){
  if(i>=keys.length){document.body.innerHTML='<pre id=out>'+JSON.stringify(out)+'</pre>';return;}
  const k=keys[i++]; const img=new Image();
  img.onload=()=>{const cv=document.createElement('canvas');cv.width=320;cv.height=240;
    const ctx=cv.getContext('2d');ctx.drawImage(img,0,0,320,240);
    const px=ctx.getImageData(0,0,320,240).data;const cnt={};
    for(let p=0;p<px.length;p+=4){if(px[p+3]<128)continue;
      const key=(px[p]>>3)+','+(px[p+1]>>3)+','+(px[p+2]>>3);cnt[key]=(cnt[key]||0)+1;}
    out[k]=cnt;next();};
  img.onerror=()=>{out[k]=null;next();};
  img.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(flags[k])));}
next();
</script></body></html>"""


def classify(r, g, b):
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    h *= 360
    chroma = max(r, g, b) - min(r, g, b)
    if l > 0.78 and chroma < 80:
        return "white"
    if l < 0.17:
        return "black"
    if chroma < 25:
        return "white" if l > 0.6 else "black"
    if h < 12 or h >= 335:
        return "red"
    if h < 40:
        return "orange" if l > 0.35 else "red"
    if h < 68:
        return "yellow"
    if h < 178:
        return "green"
    if h < 265:
        return "blue"
    return "purple"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--countries", required=True)
    ap.add_argument("--flags", required=True)
    ap.add_argument("--chrome", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    raw = json.load(open(a.countries, encoding="utf-8"))
    svgs = {}
    for c in raw:
        if not (c.get("unMember") or c["cca3"] in ("TWN", "UNK")):
            continue
        cc = "xk" if c["cca3"] == "UNK" else c["cca2"].lower()
        p = os.path.join(a.flags, cc + ".svg")
        if os.path.exists(p):
            svgs[c["cca3"]] = open(p, encoding="utf-8").read()

    with tempfile.TemporaryDirectory() as tmp:
        html = os.path.join(tmp, "flags.html")
        open(html, "w", encoding="utf-8").write(PAGE % json.dumps(svgs))
        dom = subprocess.run(
            [a.chrome, "--headless=new", "--no-sandbox", "--disable-gpu",
             "--virtual-time-budget=90000", "--dump-dom", "file://" + html],
            capture_output=True, text=True, timeout=300).stdout
    m = re.search(r'<pre id="out">(.*?)</pre>', dom, re.S)
    if not m:
        raise SystemExit("Chromium hat kein Ergebnis geliefert")
    hist = json.loads(m.group(1))

    res = {}
    for iso, cnt in hist.items():
        if not cnt:
            res[iso] = []
            continue
        tot = sum(cnt.values())
        agg = {}
        for key, n in cnt.items():
            r, g, b = [int(x) * 8 + 4 for x in key.split(",")]
            col = classify(r, g, b)
            agg[col] = agg.get(col, 0) + n
        res[iso] = [c for c, n in sorted(agg.items(), key=lambda x: -x[1]) if n / tot >= 0.05]
    json.dump(res, open(a.out, "w", encoding="utf-8"), indent=0)
    print(len(res), "Flaggen ->", a.out)


if __name__ == "__main__":
    main()
