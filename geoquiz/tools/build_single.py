#!/usr/bin/env python3
"""Baut geoquiz.html: eine einzelne, eigenständige HTML-Datei mit allem drin
(CSS, Daten, Logik). Zum Hochladen auf Cloudflare Pages, Netlify oder einfach
zum Öffnen per Doppelklick.

  python3 tools/build_single.py            # schreibt geoquiz.html neben index.html
"""
import os
import re

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
read = lambda n: open(os.path.join(here, n), encoding="utf-8").read()

import base64
import glob

html = read("index.html")

# Logo (falls vorhanden) als data-URI einbetten, sonst das img-Tag entfernen
LOGO_MIME = {".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}
logo = next((f for ext in (".svg", ".png", ".webp", ".jpg", ".jpeg")
             for f in glob.glob(os.path.join(here, "logo" + ext))), None)
if logo:
    mime = LOGO_MIME[os.path.splitext(logo)[1].lower()]
    b64 = base64.b64encode(open(logo, "rb").read()).decode()
    html = html.replace('src="logo.svg"', 'src="data:%s;base64,%s"' % (mime, b64))
    print("Logo eingebettet:", os.path.basename(logo), os.path.getsize(logo) // 1024, "KB")
else:
    html = re.sub(r'\n\s*<img class="brand-logo"[^>]*>', "", html)
    print("kein logo.* gefunden, Schriftzug bleibt")
for _name, _mime in (("apple-touch-icon.png", "image/png"), ("icon-512.png", "image/png"), ("icon.svg", "image/svg+xml")):
    _path = os.path.join(here, _name)
    if os.path.exists(_path):
        _uri = "data:%s;base64,%s" % (_mime, base64.b64encode(open(_path, "rb").read()).decode())
        html = html.replace('href="%s"' % _name, 'href="%s"' % _uri)
html = re.sub(r'\n\s*<link rel="manifest"[^>]*>', "", html)

html = html.replace('<link rel="stylesheet" href="style.css">', "<style>\n" + read("style.css") + "\n</style>")
html = html.replace('<script src="data.js"></script>', "<script>\n" + read("data.js") + "\n</script>")
html = html.replace('<script src="app.js"></script>', "<script>\n" + read("app.js") + "\n</script>")
assert 'href="style.css"' not in html and 'src="data.js"' not in html and 'src="app.js"' not in html

out = os.path.join(here, "geoquiz.html")
open(out, "w", encoding="utf-8").write(html)
print("geschrieben:", out, os.path.getsize(out) // 1024, "KB")
