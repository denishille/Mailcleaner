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

html = read("index.html")
html = html.replace('<link rel="stylesheet" href="style.css">', "<style>\n" + read("style.css") + "\n</style>")
html = html.replace('<script src="data.js"></script>', "<script>\n" + read("data.js") + "\n</script>")
html = html.replace('<script src="app.js"></script>', "<script>\n" + read("app.js") + "\n</script>")
assert 'href="style.css"' not in html and 'src="data.js"' not in html and 'src="app.js"' not in html

out = os.path.join(here, "geoquiz.html")
open(out, "w", encoding="utf-8").write(html)
print("geschrieben:", out, os.path.getsize(out) // 1024, "KB")
