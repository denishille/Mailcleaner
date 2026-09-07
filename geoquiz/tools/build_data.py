#!/usr/bin/env python3
"""Erzeugt geoquiz/data.js aus offenen Datenquellen.

Quellen (werden nicht mitversioniert, siehe README):
  - mledoze/countries      countries.json   (Namen, Grenzen, Sprachen, Währungen, Fläche)
  - factbook/factbook.json <region>/<fips>.json (CIA World Factbook: Statistiken)
  - lipis/flag-icons       flags/4x3/<cc>.svg (Flaggen)
  - tools/flagcolors.json  (aus flag_colors.py: dominante Flaggenfarben)

Aufruf:
  python3 tools/build_data.py --countries countries.json --factbook factbook.json \
      --flags flag-icons/flags/4x3 --colors tools/flagcolors.json --out data.js
"""
import argparse
import glob
import json
import os
import re
import unicodedata

# ----------------------------------------------------------------------------
# Factbook-FIPS-Code -> ISO3 (die Zuordnung über Namen klappt fast immer, hier
# nur die Sonderfälle)
FIPS_FIX = {"cg": "COD", "cf": "COG", "tu": "TUR", "vt": "VAT", "kv": "UNK", "tw": "TWN"}

CONTINENT_DE = {
    "Africa": "Afrika",
    "Asia": "Asien",
    "Europe": "Europa",
    "Oceania": "Ozeanien",
    "South America": "Südamerika",
    "North America": "Nordamerika",
    "Central America": "Nordamerika",
    "Caribbean": "Nordamerika",
}

LANG_DE = {
    "Afrikaans": "Afrikaans", "Albanian": "Albanisch", "Amharic": "Amharisch", "Arabic": "Arabisch",
    "Aramaic": "Aramäisch", "Armenian": "Armenisch", "Austro-Bavarian German": "Deutsch", "Aymara": "Aymara",
    "Azerbaijani": "Aserbaidschanisch", "Belarusian": "Belarussisch", "Belizean Creole": "Belize-Kreolisch",
    "Bengali": "Bengalisch", "Berber": "Berberisch", "Bislama": "Bislama", "Bosnian": "Bosnisch",
    "Bulgarian": "Bulgarisch", "Burmese": "Birmanisch", "Catalan": "Katalanisch", "Chewa": "Chichewa",
    "Chibarwe": "Chibarwe", "Chinese": "Chinesisch", "Comorian": "Komorisch", "Croatian": "Kroatisch",
    "Czech": "Tschechisch", "Danish": "Dänisch", "Dari": "Dari", "Dutch": "Niederländisch",
    "Dzongkha": "Dzongkha", "English": "Englisch", "Estonian": "Estnisch", "Fiji Hindi": "Fidschi-Hindi",
    "Fijian": "Fidschianisch", "Filipino": "Filipino", "Finnish": "Finnisch", "French": "Französisch",
    "Georgian": "Georgisch", "German": "Deutsch", "Gilbertese": "Kiribatisch", "Greek": "Griechisch",
    "Guaraní": "Guaraní", "Haitian Creole": "Haitianisch", "Hebrew": "Hebräisch", "Herero": "Herero",
    "Hindi": "Hindi", "Hiri Motu": "Hiri Motu", "Hungarian": "Ungarisch", "Icelandic": "Isländisch",
    "Indonesian": "Indonesisch", "Irish": "Irisch", "Italian": "Italienisch", "Jamaican Patois": "Jamaika-Kreolisch",
    "Japanese": "Japanisch", "Kalanga": "Kalanga", "Kazakh": "Kasachisch", "Khmer": "Khmer",
    "Khoekhoe": "Khoekhoe", "Khoisan": "Khoisan", "Kikongo": "Kikongo", "Kinyarwanda": "Kinyarwanda",
    "Kirundi": "Kirundi", "Korean": "Koreanisch", "Kwangali": "Kwangali", "Kyrgyz": "Kirgisisch",
    "Lao": "Laotisch", "Latin": "Latein", "Latvian": "Lettisch", "Lingala": "Lingala",
    "Lithuanian": "Litauisch", "Lozi": "Lozi", "Luxembourgish": "Luxemburgisch", "Macedonian": "Mazedonisch",
    "Malagasy": "Malagasy", "Malay": "Malaiisch", "Maldivian": "Dhivehi", "Maltese": "Maltesisch",
    "Marshallese": "Marshallesisch", "Mauritian Creole": "Morisyen", "Moldavian": "Rumänisch",
    "Mongolian": "Mongolisch", "Montenegrin": "Montenegrinisch", "Māori": "Māori", "Nauru": "Nauruisch",
    "Ndau": "Ndau", "Ndonga": "Ndonga", "Nepali": "Nepali", "New Zealand Sign Language": "NZ-Gebärdensprache",
    "Northern Ndebele": "Nord-Ndebele", "Northern Sotho": "Nord-Sotho", "Norwegian Bokmål": "Norwegisch",
    "Norwegian Nynorsk": "Norwegisch", "Palauan": "Palauisch", "Pashto": "Paschtu", "Persian (Farsi)": "Persisch",
    "Polish": "Polnisch", "Portuguese": "Portugiesisch", "Quechua": "Quechua", "Romanian": "Rumänisch",
    "Romansh": "Rätoromanisch", "Russian": "Russisch", "Sami": "Samisch", "Samoan": "Samoanisch",
    "Sango": "Sango", "Serbian": "Serbisch", "Seychellois Creole": "Seychellenkreol", "Shona": "Shona",
    "Sinhala": "Singhalesisch", "Slovak": "Slowakisch", "Slovene": "Slowenisch", "Somali": "Somali",
    "Sorani": "Kurdisch", "Sotho": "Sotho", "Southern Ndebele": "Süd-Ndebele", "Southern Sotho": "Süd-Sotho",
    "Spanish": "Spanisch", "Swahili": "Swahili", "Swazi": "Swazi", "Swedish": "Schwedisch",
    "Swiss German": "Deutsch", "Tajik": "Tadschikisch", "Tamil": "Tamil", "Tetum": "Tetum", "Thai": "Thai",
    "Tigrinya": "Tigrinya", "Tok Pisin": "Tok Pisin", "Tonga": "Tonga", "Tongan": "Tongaisch",
    "Tshiluba": "Tshiluba", "Tsonga": "Tsonga", "Tswana": "Setswana", "Turkish": "Türkisch",
    "Turkmen": "Turkmenisch", "Tuvaluan": "Tuvaluisch", "Ukrainian": "Ukrainisch",
    "Upper Guinea Creole": "Guinea-Kreolisch", "Urdu": "Urdu", "Uzbek": "Usbekisch", "Venda": "Venda",
    "Vietnamese": "Vietnamesisch", "Xhosa": "Xhosa", "Zimbabwean Sign Language": "Gebärdensprache",
    "Zulu": "Zulu",
}

# Währung: Anzeigename = Typ (Dollar, Franc, ...) + ggf. Präfix
CURRENCY_DE = {
    "EUR": "Euro", "USD": "US-Dollar", "GBP": "Britisches Pfund", "CHF": "Schweizer Franken",
    "JPY": "Yen", "CNY": "Yuan (Renminbi)", "INR": "Indische Rupie", "RUB": "Rubel", "BRL": "Real",
    "AUD": "Australischer Dollar", "CAD": "Kanadischer Dollar", "NZD": "Neuseeland-Dollar",
    "XAF": "CFA-Franc (BEAC)", "XOF": "CFA-Franc (BCEAO)", "XCD": "Ostkaribischer Dollar",
    "TRY": "Türkische Lira", "KRW": "Won", "KPW": "Won", "MXN": "Mexikanischer Peso", "ZAR": "Rand",
    "SEK": "Schwedische Krone", "NOK": "Norwegische Krone", "DKK": "Dänische Krone", "ISK": "Isländische Krone",
    "CZK": "Tschechische Krone", "PLN": "Złoty", "HUF": "Forint", "RON": "Leu", "MDL": "Leu",
    "BGN": "Lew", "UAH": "Hrywnja", "BYN": "Belarussischer Rubel", "ILS": "Schekel", "EGP": "Ägyptisches Pfund",
    "SAR": "Saudi-Riyal", "AED": "Dirham", "MAD": "Dirham", "THB": "Baht", "VND": "Đồng", "IDR": "Rupiah",
    "MYR": "Ringgit", "PHP": "Philippinischer Peso", "SGD": "Singapur-Dollar", "HKD": "Hongkong-Dollar",
    "TWD": "Neuer Taiwan-Dollar", "PKR": "Pakistanische Rupie", "BDT": "Taka", "LKR": "Sri-Lanka-Rupie",
    "NPR": "Nepalesische Rupie", "IRR": "Rial", "IQD": "Irakischer Dinar", "KWD": "Kuwait-Dinar",
    "QAR": "Katar-Riyal", "OMR": "Omanischer Rial", "BHD": "Bahrain-Dinar", "JOD": "Jordanischer Dinar",
    "LBP": "Libanesisches Pfund", "SYP": "Syrisches Pfund", "YER": "Jemen-Rial", "AFN": "Afghani",
    "KZT": "Tenge", "UZS": "Soʻm", "KGS": "Som", "TJS": "Somoni", "TMT": "Manat", "AZN": "Manat",
    "GEL": "Lari", "AMD": "Dram", "MNT": "Tögrög", "ARS": "Argentinischer Peso", "CLP": "Chilenischer Peso",
    "COP": "Kolumbianischer Peso", "PEN": "Sol", "UYU": "Uruguayischer Peso", "PYG": "Guaraní",
    "BOB": "Boliviano", "VES": "Bolívar", "GTQ": "Quetzal", "HNL": "Lempira", "NIO": "Córdoba",
    "CRC": "Colón", "PAB": "Balboa", "DOP": "Dominikanischer Peso", "CUP": "Kubanischer Peso",
    "JMD": "Jamaika-Dollar", "HTG": "Gourde", "TTD": "Trinidad-und-Tobago-Dollar", "NGN": "Naira",
    "GHS": "Cedi", "KES": "Kenia-Schilling", "TZS": "Tansania-Schilling", "UGX": "Uganda-Schilling",
    "ETB": "Birr", "DZD": "Algerischer Dinar", "TND": "Tunesischer Dinar", "LYD": "Libyscher Dinar",
    "SDG": "Sudanesisches Pfund", "AOA": "Kwanza", "MZN": "Metical", "ZMW": "Kwacha", "MWK": "Kwacha",
    "BWP": "Pula", "NAD": "Namibia-Dollar", "MUR": "Mauritius-Rupie", "MGA": "Ariary", "RWF": "Ruanda-Franc",
    "BIF": "Burundi-Franc", "CDF": "Kongo-Franc", "GNF": "Guinea-Franc", "DJF": "Dschibuti-Franc",
    "SOS": "Somalia-Schilling", "ERN": "Nakfa", "SSP": "Südsudanesisches Pfund", "SLE": "Leone",
    "LRD": "Liberianischer Dollar", "GMD": "Dalasi", "CVE": "Kap-Verde-Escudo", "STN": "Dobra",
    "SCR": "Seychellen-Rupie", "KMF": "Komoren-Franc", "LSL": "Loti", "SZL": "Lilangeni", "ZWB": "Simbabwe-Dollar",
    "MRU": "Ouguiya", "ALL": "Lek", "MKD": "Denar", "RSD": "Serbischer Dinar", "BAM": "Konvertible Mark",
    "MMK": "Kyat", "LAK": "Kip", "KHR": "Riel", "BND": "Brunei-Dollar", "MVR": "Rufiyaa", "BTN": "Ngultrum",
    "PGK": "Kina", "FJD": "Fidschi-Dollar", "SBD": "Salomonen-Dollar", "VUV": "Vatu", "WST": "Tala",
    "TOP": "Paʻanga", "KID": "Kiribati-Dollar", "TVD": "Tuvalu-Dollar", "BSD": "Bahama-Dollar",
    "BBD": "Barbados-Dollar", "BZD": "Belize-Dollar", "GYD": "Guyana-Dollar", "SRD": "Suriname-Dollar",
    "CUC": "Konvertibler Peso",
}

# GeoRankle-Kategorien: key, Name, Einheit, Formatierung, Beschreibung
CATEGORIES = [
    ("pop", "Meiste Einwohner", "", "int", "Gesamtbevölkerung, Rang 1 = am meisten"),
    ("area", "Größte Fläche", "km²", "int", "Gesamtfläche, Rang 1 = am größten"),
    ("gdppc", "Höchstes BIP pro Kopf", "$", "money", "Kaufkraftparität, Rang 1 = am höchsten"),
    ("gdp", "Größtes BIP", "$", "money", "Gesamtes BIP (Kaufkraftparität), Rang 1 = am größten"),
    ("life", "Höchste Lebens\u00aderwartung", "Jahre", "dec1", "Rang 1 = am höchsten"),
    ("medage", "Höchstes Medianalter", "Jahre", "dec1", "Ältestes Land = Rang 1"),
    ("birth", "Höchste Geburtenrate", "‰", "dec1", "Geburten je 1.000 Einwohner, Rang 1 = am höchsten"),
    ("fert", "Meiste Kinder pro Frau", "Kinder/Frau", "dec2", "Fertilitätsrate, Rang 1 = am meisten"),
    ("popgrowth", "Stärkstes Bevölkerungs\u00adwachstum", "%", "dec2", "Jährliches Wachstum, Rang 1 = am stärksten"),
    ("urban", "Höchste Urbani\u00adsierung", "%", "dec1", "Anteil Stadtbevölkerung, Rang 1 = am höchsten"),
    ("density", "Höchste Bevölkerungs\u00addichte", "Einw./km²", "int", "Einwohner je km², Rang 1 = am dichtesten"),
    ("forest", "Höchster Waldanteil", "%", "dec1", "Anteil Waldfläche, Rang 1 = am meisten Wald"),
    ("coast", "Längste Küste", "km", "int", "Küstenlänge, Rang 1 = am längsten"),
    ("high", "Höchster Berg", "m", "int", "Höchster Punkt des Landes, Rang 1 = am höchsten"),
    ("borders", "Meiste Nachbarländer", "", "int", "Anzahl Landgrenzen, Rang 1 = am meisten"),
    ("co2", "Höchster CO₂-Ausstoß", "Mt", "dec1", "Gesamtemissionen, Rang 1 = am meisten"),
    ("renew", "Meiste erneuerbare Energie", "%", "dec1", "Anteil an installierter Stromkapazität, Rang 1 = am meisten"),
    ("internet", "Meiste Internet\u00adnutzer", "%", "dec1", "Anteil der Bevölkerung, Rang 1 = am meisten"),
    ("infl", "Höchste Inflation", "%", "dec1", "Verbraucherpreise, Rang 1 = am höchsten"),
    ("unemp", "Höchste Arbeits\u00adlosigkeit", "%", "dec1", "Rang 1 = am höchsten"),
    ("exports", "Höchste Exporte", "$", "money", "Waren- und Dienstleistungsexporte, Rang 1 = am meisten"),
    ("mil", "Höchste Militär\u00adausgaben", "% BIP", "dec1", "Anteil am BIP, Rang 1 = am höchsten"),
    ("obes", "Meiste Übergewichtige", "%", "dec1", "Adipositas-Rate Erwachsene, Rang 1 = am meisten"),
    ("alc", "Höchster Alkohol\u00adkonsum", "l/Kopf", "dec2", "Liter reiner Alkohol pro Kopf und Jahr, Rang 1 = am meisten"),
]

MAG = {"thousand": 1e3, "million": 1e6, "billion": 1e9, "trillion": 1e12}


def num(text):
    """Erste Zahl im Text (mit Tausendertrennern, Vorzeichen, Größenwörtern)."""
    if not text or text.strip().upper().startswith("NA"):
        return None
    m = re.search(r"(-?\$?[\d,]*\.?\d+)\s*(thousand|million|billion|trillion)?", text)
    if not m:
        return None
    v = float(m.group(1).replace("$", "").replace(",", ""))
    if m.group(2):
        v *= MAG[m.group(2)]
    return v


def get(d, *path):
    for p in path:
        if not isinstance(d, dict):
            return None
        d = d.get(p)
    return d


def latest(section):
    """Für Felder mit Jahres-Unterschlüsseln ('Real GDP per capita 2024') den jüngsten Wert."""
    if not isinstance(section, dict):
        return None
    best = None
    for k, v in section.items():
        y = re.search(r"(\d{4})$", k)
        if y and isinstance(v, dict) and "text" in v:
            yr = int(y.group(1))
            if best is None or yr > best[0]:
                best = (yr, v["text"])
    return best[1] if best else None


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"^the ", "", s)
    return re.sub(r"[^a-z0-9]", "", s)


def parse_factbook(d):
    P = "People and Society"
    s = {}
    s["pop"] = num(get(d, P, "Population", "total", "text"))
    s["medage"] = num(get(d, P, "Median age", "total", "text"))
    s["birth"] = num(get(d, P, "Birth rate", "text"))
    s["life"] = num(get(d, P, "Life expectancy at birth", "total population", "text"))
    s["urban"] = num(get(d, P, "Urbanization", "urban population", "text"))
    s["fert"] = num(get(d, P, "Total fertility rate", "text"))
    s["obes"] = num(get(d, P, "Obesity - adult prevalence rate", "text"))
    s["alc"] = num(get(d, P, "Alcohol consumption per capita", "total", "text"))
    s["popgrowth"] = num(get(d, P, "Population growth rate", "text"))
    s["forest"] = num(get(d, "Geography", "Land use", "forest", "text"))
    s["coast"] = num(get(d, "Geography", "Coastline", "text"))
    hp = get(d, "Geography", "Elevation", "highest point", "text") or ""
    m = re.search(r"(-?[\d,]+(?:\.\d+)?)\s*m\b", hp)
    s["high"] = float(m.group(1).replace(",", "")) if m else None
    s["internet"] = num(get(d, "Communications", "Internet users", "percent of population", "text"))
    s["co2"] = num(get(d, "Environment", "Carbon dioxide emissions", "total emissions", "text"))
    if s["co2"] is not None:
        s["co2"] = s["co2"] / 1e6  # -> Megatonnen
    # Erneuerbare = Summe aller Quellen außer fossil und nuklear (Anteil an installierter Kapazität)
    src = get(d, "Energy", "Electricity generation sources") or {}
    parts = [num(v.get("text")) for k, v in src.items()
             if isinstance(v, dict) and k not in ("fossil fuels", "nuclear")]
    parts = [x for x in parts if x is not None]
    s["renew"] = min(100.0, round(sum(parts), 1)) if src else None
    E = "Economy"
    s["gdppc"] = num(latest(get(d, E, "Real GDP per capita")))
    s["gdp"] = num(latest(get(d, E, "Real GDP (purchasing power parity)")))
    s["infl"] = num(latest(get(d, E, "Inflation rate (consumer prices)")))
    s["unemp"] = num(latest(get(d, E, "Unemployment rate")))
    s["exports"] = num(latest(get(d, E, "Exports")))
    s["mil"] = num(latest(get(d, "Military and Security", "Military expenditures")))
    return {k: v for k, v in s.items() if v is not None}


def continent(c):
    if c["region"] == "Americas":
        return CONTINENT_DE.get(c["subregion"], "Nordamerika")
    return CONTINENT_DE.get(c["region"], c["region"])


def currency_name(code, en):
    if code in CURRENCY_DE:
        return CURRENCY_DE[code]
    return en[0].upper() + en[1:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--countries", required=True)
    ap.add_argument("--factbook", required=True)
    ap.add_argument("--flags", required=True)
    ap.add_argument("--colors", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    raw = json.load(open(a.countries, encoding="utf-8"))
    colors = json.load(open(a.colors, encoding="utf-8"))
    pool = [c for c in raw if c.get("unMember") or c["cca3"] in ("TWN", "UNK")]

    # Factbook-Dateien per Name zuordnen
    idx = {}
    for c in pool:
        for n in [c["name"]["common"], c["name"]["official"]] + c.get("altSpellings", []):
            idx.setdefault(norm(n), c["cca3"])
    summary = open(os.path.join(a.factbook, "SUMMARY.md"), encoding="utf-8").read()
    fips2iso = dict(FIPS_FIX)
    for code, name in re.findall(r"`(\w\w)` (.+)", summary):
        if code not in fips2iso and norm(name) in idx:
            fips2iso[code] = idx[norm(name)]
    fb = {}
    for f in glob.glob(os.path.join(a.factbook, "*", "*.json")):
        code = os.path.basename(f)[:-5]
        if code in fips2iso:
            fb[fips2iso[code]] = json.load(open(f, encoding="utf-8"))

    countries = []
    for c in pool:
        iso = c["cca3"]
        stats = parse_factbook(fb[iso]) if iso in fb else {}
        if iso not in fb:
            print("kein Factbook-Eintrag:", iso, c["name"]["common"])
        stats["area"] = float(c["area"])
        stats["borders"] = float(len(c.get("borders", [])))
        if "pop" in stats:
            stats["density"] = round(stats["pop"] / stats["area"], 1)
        cc = "xk" if iso == "UNK" else c["cca2"].lower()
        svg = open(os.path.join(a.flags, cc + ".svg"), encoding="utf-8").read()
        svg = re.sub(r"\s+", " ", svg).strip()
        de = c["translations"]["deu"]["common"]
        aliases = {c["name"]["common"], c["name"]["official"], c["translations"]["deu"]["official"]}
        aliases.update(s for s in c.get("altSpellings", []) if len(s) > 3)
        for nat in c["name"].get("native", {}).values():
            aliases.add(nat["common"])
        aliases.discard(de)
        langs = sorted({LANG_DE.get(l, l) for l in c["languages"].values()})
        cur = sorted(c["currencies"].keys())
        countries.append({
            "iso3": iso,
            "iso2": c["cca2"],
            "name": de,
            "en": c["name"]["common"],
            "aliases": sorted(aliases),
            "capital": ", ".join(c.get("capital", [])),
            "continent": continent(c),
            "subregion": c["subregion"],
            "landlocked": bool(c["landlocked"]),
            "borders": c.get("borders", []),
            "languages": langs,
            "currency": cur,
            "currencyName": ", ".join(currency_name(k, v["name"]) for k, v in sorted(c["currencies"].items())),
            "colors": colors.get(iso, []),
            "latlng": c["latlng"],
            "emoji": c["flag"],
            "flag": svg,
            "stats": stats,
        })

    # Ränge je Kategorie (1 = höchster Wert)
    for key, *_ in CATEGORIES:
        have = [c for c in countries if key in c["stats"]]
        have.sort(key=lambda c: -c["stats"][key])
        for i, c in enumerate(have):
            c.setdefault("ranks", {})[key] = i + 1
        print(f"{key:10s} {len(have)} Länder")

    countries.sort(key=lambda c: c["name"])
    out = {
        "generated": "CIA World Factbook / mledoze-countries / flag-icons",
        "categories": [dict(zip(("key", "name", "unit", "fmt", "desc"), cat)) for cat in CATEGORIES],
        "countries": countries,
    }
    with open(a.out, "w", encoding="utf-8") as f:
        f.write("window.GEO_DATA = ")
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print("geschrieben:", a.out, os.path.getsize(a.out) // 1024, "KB", len(countries), "Länder")


if __name__ == "__main__":
    main()
