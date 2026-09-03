#!/usr/bin/env python3
"""Bestandsaufnahme des Apple-Mail-Postfachs.

Liest den Envelope-Index von Apple Mail nur lesend und schreibt einen Bericht
plus eine Regel-Vorlage fuer aufraeumen.js. Verschiebt nichts, loescht nichts,
startet Mail nicht.

Aufruf:
    python3 bestandsaufnahme.py [--ausgabe ORDNER] [--top N]
"""

import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

MAC_EPOCH_OFFSET = 978307200  # 2001-01-01 in Unix-Sekunden


def finde_index() -> Path:
    """Sucht den Envelope Index. Apple versioniert den Ordner (V8, V9, V10 ...)."""
    basis = Path.home() / "Library" / "Mail"
    if not basis.is_dir():
        raise SystemExit(
            f"{basis} existiert nicht. Ist Apple Mail auf diesem Rechner eingerichtet?"
        )

    kandidaten = []
    for version_ordner in basis.glob("V*"):
        index = version_ordner / "MailData" / "Envelope Index"
        if index.is_file():
            # Versionsnummer als Zahl, damit V10 nach V9 sortiert und nicht davor
            nummer = int(re.sub(r"\D", "", version_ordner.name) or 0)
            kandidaten.append((nummer, index))

    if not kandidaten:
        raise SystemExit(
            f"Kein 'Envelope Index' unter {basis} gefunden.\n"
            "Meist fehlt der Vollzugriff auf die Festplatte: Systemeinstellungen > "
            "Datenschutz & Sicherheit > Festplattenvollzugriff > Terminal (bzw. die "
            "Claude-App) aktivieren und das Programm neu starten."
        )

    return max(kandidaten)[1]


def oeffne_lesend(index: Path) -> tuple[sqlite3.Connection, Path | None]:
    """Oeffnet den Index lesend.

    Erst der direkte Weg. Laeuft Mail gerade, haelt es eine WAL-Sperre; dann
    arbeiten wir auf einer Kopie, statt Mail zum Beenden zu zwingen.
    """
    try:
        verbindung = sqlite3.connect(f"file:{index}?mode=ro", uri=True)
        verbindung.execute("SELECT COUNT(*) FROM messages").fetchone()
        return verbindung, None
    except sqlite3.Error:
        pass

    kopie_ordner = Path(tempfile.mkdtemp(prefix="mail-bestandsaufnahme-"))
    for endung in ("", "-wal", "-shm"):
        quelle = Path(str(index) + endung)
        if quelle.is_file():
            shutil.copy2(quelle, kopie_ordner / quelle.name)

    kopie = kopie_ordner / index.name
    verbindung = sqlite3.connect(f"file:{kopie}?mode=ro", uri=True)
    verbindung.execute("SELECT COUNT(*) FROM messages").fetchone()
    return verbindung, kopie_ordner


def spalten(verbindung: sqlite3.Connection, tabelle: str) -> set[str]:
    return {
        zeile[1] for zeile in verbindung.execute(f"PRAGMA table_info({tabelle})")
    }


def als_datum(wert) -> datetime | None:
    """Apple mischt Unix- und Mac-Epoche. Kleine Werte sind Mac-Epoche."""
    if not wert:
        return None
    sekunden = int(wert)
    if sekunden < 1_000_000_000:
        sekunden += MAC_EPOCH_OFFSET
    try:
        return datetime.fromtimestamp(sekunden, tz=timezone.utc)
    except (OSError, OverflowError, ValueError):
        return None


def konto_aus_url(url: str) -> str:
    """'imap://denis%40gmx.de@imap.gmx.net/INBOX' -> 'imap.gmx.net'."""
    if not url:
        return "unbekannt"
    treffer = re.match(r"^([a-z-]+)://(?:([^@/]*)@)?([^/]*)(/.*)?$", url)
    if not treffer:
        return url
    schema, _benutzer, host, _pfad = treffer.groups()
    if schema == "local" or not host:
        return "Auf meinem Mac"
    return host


def pfad_aus_url(url: str) -> str:
    treffer = re.match(r"^[a-z-]+://[^/]*(/.*)?$", url or "")
    pfad = (treffer.group(1) if treffer else "") or "/"
    from urllib.parse import unquote

    return unquote(pfad).lstrip("/") or "INBOX"


def lade_nachrichten(verbindung: sqlite3.Connection) -> list[dict]:
    vorhanden = spalten(verbindung, "messages")

    # Der Index hat je nach macOS-Version unterschiedliche Spalten. Wir waehlen
    # nur das, was wirklich da ist, und fuellen den Rest mit NULL.
    def feld(name: str, ersatz: str = "NULL") -> str:
        return f"m.{name}" if name in vorhanden else f"{ersatz} AS {name}"

    bedingung = "WHERE m.deleted = 0" if "deleted" in vorhanden else ""

    abfrage = f"""
        SELECT
            {feld('ROWID')}            AS rowid_,
            a.address                  AS absender,
            a.comment                  AS absender_name,
            {feld('date_received')}    AS empfangen,
            {feld('read')}             AS gelesen,
            {feld('flags')}            AS flags,
            {feld('size')}             AS groesse,
            b.url                      AS postfach_url
        FROM messages m
        LEFT JOIN addresses a  ON a.ROWID = m.sender
        LEFT JOIN mailboxes b ON b.ROWID = m.mailbox
        {bedingung}
    """

    hat_read = "read" in vorhanden
    nachrichten = []
    for zeile in verbindung.execute(abfrage):
        (_rowid, absender, absender_name, empfangen, gelesen, flags,
         groesse, postfach_url) = zeile

        if hat_read and gelesen is not None:
            ist_gelesen = bool(gelesen)
        else:
            # Fallback: Bit 0 der Flags ist das Gelesen-Bit
            ist_gelesen = bool((flags or 0) & 1)

        nachrichten.append({
            "absender": (absender or "(kein Absender)").lower().strip(),
            "absender_name": (absender_name or "").strip(),
            "empfangen": als_datum(empfangen),
            "gelesen": ist_gelesen,
            "groesse": int(groesse or 0),
            "konto": konto_aus_url(postfach_url or ""),
            "postfach": pfad_aus_url(postfach_url or ""),
        })
    return nachrichten


def zahl(wert: int) -> str:
    """Tausenderpunkte. Bewusst eng gefasst: ein .replace() ueber die ganze
    Ausgabezeile wuerde auch Kommas in Namen und Fliesstext treffen."""
    return f"{wert:,}".replace(",", ".")


def mb(bytes_: int) -> str:
    return f"{bytes_ / 1024 / 1024:,.0f}".replace(",", ".") + " MB"


def baue_bericht(nachrichten: list[dict], top: int) -> tuple[str, list[dict]]:
    zeilen = []
    schreib = zeilen.append

    gesamt = len(nachrichten)
    ungelesen = sum(1 for n in nachrichten if not n["gelesen"])
    volumen = sum(n["groesse"] for n in nachrichten)

    schreib("# Bestandsaufnahme Postfach")
    schreib("")
    schreib(f"Erstellt: {datetime.now().strftime('%d.%m.%Y %H:%M')}")
    schreib("")
    schreib(f"{zahl(gesamt)} Nachrichten · {zahl(ungelesen)} ungelesen · {mb(volumen)}")
    schreib("")

    # --- Postfaecher ---------------------------------------------------------
    nach_postfach = defaultdict(lambda: {"anzahl": 0, "ungelesen": 0, "groesse": 0})
    for n in nachrichten:
        schluessel = (n["konto"], n["postfach"])
        eintrag = nach_postfach[schluessel]
        eintrag["anzahl"] += 1
        eintrag["groesse"] += n["groesse"]
        if not n["gelesen"]:
            eintrag["ungelesen"] += 1

    schreib("## Postfächer")
    schreib("")
    schreib("| Konto | Postfach | Mails | ungelesen | Größe |")
    schreib("|---|---|---:|---:|---:|")
    for (konto, postfach), e in sorted(
        nach_postfach.items(), key=lambda p: -p[1]["anzahl"]
    )[:40]:
        schreib(f"| {konto} | {postfach} | {zahl(e['anzahl'])} | "
                f"{zahl(e['ungelesen'])} | {mb(e['groesse'])} |")
    schreib("")

    # --- Jahre ---------------------------------------------------------------
    nach_jahr = defaultdict(int)
    for n in nachrichten:
        if n["empfangen"]:
            nach_jahr[n["empfangen"].year] += 1

    if nach_jahr:
        schreib("## Nach Jahr")
        schreib("")
        hoechster = max(nach_jahr.values())
        for jahr in sorted(nach_jahr, reverse=True):
            anzahl = nach_jahr[jahr]
            balken = "█" * max(1, round(anzahl / hoechster * 40))
            schreib(f"    {jahr}  {zahl(anzahl):>9}  {balken}")
        schreib("")

    # --- Absender ------------------------------------------------------------
    nach_absender = defaultdict(
        lambda: {"anzahl": 0, "ungelesen": 0, "groesse": 0,
                 "name": "", "postfaecher": set(), "neuestes": None}
    )
    for n in nachrichten:
        e = nach_absender[n["absender"]]
        e["anzahl"] += 1
        e["groesse"] += n["groesse"]
        if not n["gelesen"]:
            e["ungelesen"] += 1
        if not e["name"] and n["absender_name"]:
            e["name"] = n["absender_name"]
        e["postfaecher"].add(n["postfach"])
        if n["empfangen"] and (e["neuestes"] is None or n["empfangen"] > e["neuestes"]):
            e["neuestes"] = n["empfangen"]

    sortiert = sorted(nach_absender.items(), key=lambda p: -p[1]["anzahl"])

    schreib(f"## Top {top} Absender")
    schreib("")
    schreib("| Absender | Mails | ungelesen | Größe | zuletzt |")
    schreib("|---|---:|---:|---:|---|")
    for adresse, e in sortiert[:top]:
        quote = e["ungelesen"] / e["anzahl"] * 100
        zuletzt = e["neuestes"].strftime("%m/%Y") if e["neuestes"] else "—"
        name = f" ({e['name']})" if e["name"] else ""
        schreib(f"| {adresse}{name} | {zahl(e['anzahl'])} | {quote:.0f} % | "
                f"{mb(e['groesse'])} | {zuletzt} |")
    schreib("")

    # --- Aufräum-Kandidaten --------------------------------------------------
    # Viele Mails, kaum gelesen: das sind fast immer Newsletter und Benachrichtigungen.
    kandidaten = [
        (adresse, e) for adresse, e in sortiert
        if e["anzahl"] >= 15 and e["ungelesen"] / e["anzahl"] >= 0.6
    ]

    schreib("## Aufräum-Kandidaten")
    schreib("")
    if kandidaten:
        summe = sum(e["anzahl"] for _, e in kandidaten)
        schreib(f"Absender mit mindestens 15 Mails, von denen du 60 % oder mehr nie "
                f"geöffnet hast — zusammen {zahl(summe)} Nachrichten "
                f"({summe / gesamt * 100:.0f} % des Postfachs), "
                f"{mb(sum(e['groesse'] for _, e in kandidaten))}.")
        schreib("")
        schreib("| Absender | Mails | ungelesen | zuletzt |")
        schreib("|---|---:|---:|---|")
        for adresse, e in kandidaten[:60]:
            quote = e["ungelesen"] / e["anzahl"] * 100
            zuletzt = e["neuestes"].strftime("%m/%Y") if e["neuestes"] else "—"
            schreib(f"| {adresse} | {zahl(e['anzahl'])} | {quote:.0f} % | {zuletzt} |")
    else:
        schreib("Keine gefunden. Dein Postfach ist sauberer als der Durchschnitt.")
    schreib("")

    vorlage = [
        {
            "absender": adresse,
            "ziel": "",
            "_mails": e["anzahl"],
            "_ungelesen_prozent": round(e["ungelesen"] / e["anzahl"] * 100),
            "_postfaecher": sorted(e["postfaecher"]),
        }
        for adresse, e in kandidaten[:60]
    ]
    return "\n".join(zeilen), vorlage


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ausgabe", default=".", help="Zielordner für Bericht und Vorlage")
    parser.add_argument("--top", type=int, default=40, help="Wie viele Absender auflisten")
    argumente = parser.parse_args()

    index = finde_index()
    print(f"Index: {index}", file=sys.stderr)

    verbindung, kopie_ordner = oeffne_lesend(index)
    if kopie_ordner:
        print("Mail läuft — es wurde auf einer Kopie gearbeitet.", file=sys.stderr)

    try:
        nachrichten = lade_nachrichten(verbindung)
    finally:
        verbindung.close()
        if kopie_ordner:
            shutil.rmtree(kopie_ordner, ignore_errors=True)

    if not nachrichten:
        raise SystemExit("Der Index enthält keine Nachrichten.")

    bericht, vorlage = baue_bericht(nachrichten, argumente.top)

    ziel = Path(argumente.ausgabe)
    ziel.mkdir(parents=True, exist_ok=True)

    bericht_datei = ziel / "bericht.md"
    bericht_datei.write_text(bericht, encoding="utf-8")

    regel_datei = ziel / "regeln.json"
    if regel_datei.exists():
        print(f"{regel_datei} existiert bereits — nicht überschrieben.", file=sys.stderr)
    else:
        regel_datei.write_text(
            json.dumps({"regeln": vorlage}, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    print(bericht)
    print(f"\nGeschrieben: {bericht_datei} und {regel_datei}", file=sys.stderr)


if __name__ == "__main__":
    main()
