#!/usr/bin/env python3
"""Rendert die App-Icons (PNG) aus icon.svg – nötig, weil iOS für
apple-touch-icon kein SVG akzeptiert.

  python3 tools/build_icons.py [--chrome /pfad/zu/chromium] [--source icon.svg]

Schreibt apple-touch-icon.png (180x180) und icon-512.png neben index.html.
Gerendert wird über ein Canvas in headless Chromium, damit die Größe exakt passt.
"""
import argparse
import base64
import json
import os
import re
import shutil
import subprocess
import tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIZES = {"apple-touch-icon.png": 180, "icon-512.png": 512}

PAGE = """<body><script>
const svg = %s, sizes = %s, out = {};
const img = new Image();
img.onload = () => {
  for (const s of sizes) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, s, s);
    out[s] = cv.toDataURL('image/png');
  }
  document.body.innerHTML = '<pre id=out>' + JSON.stringify(out) + '</pre>';
};
img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
</script></body>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=os.path.join(HERE, "icon.svg"))
    ap.add_argument("--chrome", default=shutil.which("chromium") or shutil.which("google-chrome") or "chromium")
    a = ap.parse_args()

    svg = open(a.source, encoding="utf-8").read()
    with tempfile.TemporaryDirectory() as tmp:
        page = os.path.join(tmp, "icon.html")
        open(page, "w", encoding="utf-8").write(PAGE % (json.dumps(svg), json.dumps(sorted(set(SIZES.values())))))
        dom = subprocess.run([a.chrome, "--headless", "--no-sandbox", "--disable-gpu",
                              "--virtual-time-budget=20000", "--dump-dom", "file://" + page],
                             capture_output=True, text=True, timeout=180).stdout
    m = re.search(r'<pre id="out">(.*?)</pre>', dom, re.S)
    if not m:
        raise SystemExit("Chromium hat kein Ergebnis geliefert")
    data = json.loads(m.group(1))
    for name, size in SIZES.items():
        png = base64.b64decode(data[str(size)].split(",", 1)[1])
        open(os.path.join(HERE, name), "wb").write(png)
        print("geschrieben:", name, size, "px,", len(png) // 1024, "KB")


if __name__ == "__main__":
    main()
