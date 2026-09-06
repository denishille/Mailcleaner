#!/usr/bin/env osascript -l JavaScript
//
// Bestandsaufnahme der Apple-Notizen.
//
// Liest nur. Verschiebt nichts, loescht nichts, aendert keine einzige Notiz.
// Schreibt einen Bericht (bericht.md) und eine Regel-Vorlage (regeln.json)
// fuer aufraeumen.js.
//
//   osascript -l JavaScript bestandsaufnahme.js
//   osascript -l JavaScript bestandsaufnahme.js --ausgabe ~/Desktop/notizen --top 80
//
// Notizen wird dafuer gestartet (macOS macht das von selbst). Beim ersten Lauf
// fragt macOS, ob das Programm Notizen steuern darf — bestaetigen.

const UNTER_OSASCRIPT = typeof ObjC !== 'undefined';
if (UNTER_OSASCRIPT) ObjC.import('Foundation');

// "Zuletzt gelöscht" wird gezaehlt, aber nie ausgewertet und nie angefasst.
const PAPIERKORB = ['zuletzt gelöscht', 'recently deleted'];
const OHNE_TITEL = ['', 'neue notiz', 'new note'];

// Ueberschriften, mit denen Songtexte ihre Teile markieren. Wer so schreibt,
// schreibt einen Text — da braucht es keine Reimzaehlung mehr.
const SONGTEIL = /^\s*[\[(]?\s*(hook|pre-?hook|refrain|chorus|part\s*\d|strophe\s*\d?|verse\s*\d?|bridge|intro|outro)\b/im;

const URL = /https?:\/\/\S+|\bwww\.\S+/gi;

// Fuellwoerter, die in Titeln nichts ueber das Thema sagen.
const FUELLWOERTER = new Set([
  'aber', 'alle', 'alles', 'also', 'auch', 'beim', 'bist', 'dann', 'dass', 'dein', 'deine',
  'dem', 'den', 'denn', 'der', 'des', 'dich', 'die', 'dies', 'diese', 'dieser', 'dir',
  'doch', 'durch', 'eine', 'einem', 'einen', 'einer', 'eines', 'euch', 'euer', 'für',
  'fuer', 'habe', 'haben', 'hast', 'hatte', 'hier', 'ihre', 'immer', 'ist', 'jetzt',
  'kann', 'kein', 'keine', 'mehr', 'mein', 'meine', 'mich', 'mir', 'mit', 'nach',
  'nicht', 'noch', 'nur', 'oder', 'ohne', 'schon', 'sein', 'seine', 'sich', 'sie',
  'sind', 'sonst', 'über', 'ueber', 'und', 'uns', 'unser', 'vom', 'von', 'war', 'was',
  'weil', 'wenn', 'werden', 'wie', 'wieder', 'wird', 'wir', 'zum', 'zur', 'zwei',
  'that', 'this', 'with', 'from', 'your', 'have', 'what', 'when', 'note', 'notiz',
]);

function schluessel(text) {
  return String(text || '').normalize('NFC').toLowerCase().trim();
}

function zahl(wert) {
  return String(wert).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function monatJahr(datum) {
  if (!(datum instanceof Date) || isNaN(datum)) return '—';
  return `${String(datum.getMonth() + 1).padStart(2, '0')}/${datum.getFullYear()}`;
}

function jetztAlsText() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// --- Textauswertung ---------------------------------------------------------
// Alles hier drunter ist reines JavaScript ohne Notizen-Zugriff, damit man es
// auch ausserhalb von osascript pruefen kann.

// Notizen liefert als Klartext die ganze Notiz samt Titelzeile. Fuer die
// Auswertung zaehlt nur, was darunter steht.
function rumpf(text, titel) {
  const zeilen = String(text || '').split('\n');
  if (zeilen.length > 0 && schluessel(zeilen[0]) === schluessel(titel)) zeilen.shift();
  return zeilen.join('\n');
}

// Eingebettete Anhaenge stehen im Klartext als Platzhalter-Zeichen (U+FFFC).
function anzahlAnhaenge(text) {
  return (String(text || '').match(/￼/g) || []).length;
}

function inhaltsZeilen(text) {
  return String(text || '')
    .split('\n')
    .map(z => z.replace(/￼/g, '').trim())
    .filter(z => z.length > 0);
}

// Letztes Wort einer Zeile, auf die letzten drei Buchstaben reduziert.
// "gehen"/"stehen" -> "hen", "Herz"/"Schmerz" -> "erz". Zwei Buchstaben
// waeren zu wenig: auf "-en" endet im Deutschen jeder zweite Satz.
function reimEnde(zeile) {
  const woerter = zeile
    .toLowerCase()
    .replace(/['’`´]/g, '')
    .replace(/[^a-zäöüß]+/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w.length > 0);
  if (woerter.length === 0) return '';
  const letztes = woerter[woerter.length - 1];
  if (letztes.length < 3) return '';
  return letztes.slice(-3);
}

// Anteil der Zeilen, die sich mit der naechsten oder uebernaechsten reimen.
// Deckt Paarreim (AABB) und Kreuzreim (ABAB) ab.
function reimAnteil(zeilen) {
  const enden = zeilen.map(reimEnde);
  let vergleichbar = 0;
  let treffer = 0;
  for (let i = 0; i < enden.length - 1; i += 1) {
    if (!enden[i]) continue;
    vergleichbar += 1;
    if (enden[i] === enden[i + 1] || (i + 2 < enden.length && enden[i] === enden[i + 2])) {
      treffer += 1;
    }
  }
  return vergleichbar === 0 ? 0 : treffer / vergleichbar;
}

function median(werte) {
  if (werte.length === 0) return 0;
  const sortiert = werte.slice().sort((a, b) => a - b);
  return sortiert[Math.floor(sortiert.length / 2)];
}

// Ordnet eine Notiz grob ein. Die Arten schliessen sich aus; die erste, die
// passt, gewinnt.
//
//   leer        nichts ausser dem Titel
//   links       im Wesentlichen eine Sammlung von Adressen
//   raptext     viele kurze Zeilen, die sich reimen — oder Hook/Part-Marken
//   raptext?    sieht danach aus, reimt aber schwaecher; von Hand pruefen
//   reimskizze  ein paar Zeilen, die sich reimen: Ideen, Punchlines, Hooks
//   liste       viele Zeilen mit je ein bis vier Woertern
//   schnipsel   ein, zwei Zeilen, kaum Text
//   sonstiges   alles andere: Fliesstext, Gemischtes
function einordnen(titel, text) {
  const inhalt = rumpf(text, titel);
  const zeilen = inhaltsZeilen(inhalt);
  const ergebnis = { art: 'sonstiges', zeilen: zeilen.length, reim: 0, zeichen: inhalt.trim().length };

  if (zeilen.length === 0) return { ...ergebnis, art: 'leer' };

  const adressen = (inhalt.match(URL) || []).length;
  if (adressen >= 2 && adressen >= zeilen.length * 0.5) return { ...ergebnis, art: 'links' };

  const laengeMedian = median(zeilen.map(z => z.length));
  const reim = reimAnteil(zeilen);
  ergebnis.reim = reim;

  // Zeilen eines Songtexts sind kurz. Fliesstext hat in Notizen kaum Umbrueche
  // und kommt daher als wenige, sehr lange Zeilen an.
  const zeilenPassen = laengeMedian >= 10 && laengeMedian <= 80;

  if (SONGTEIL.test(inhalt) && zeilen.length >= 4) return { ...ergebnis, art: 'raptext' };
  if (zeilen.length >= 8 && zeilenPassen && reim >= 0.28) return { ...ergebnis, art: 'raptext' };
  if (zeilen.length >= 8 && zeilenPassen && reim >= 0.18) return { ...ergebnis, art: 'raptext?' };
  if (zeilen.length >= 4 && zeilen.length < 8 && zeilenPassen && reim >= 0.34) {
    return { ...ergebnis, art: 'reimskizze' };
  }

  const kurzeZeilen = zeilen.filter(z => z.split(/\s+/).length <= 4).length;
  if (zeilen.length >= 4 && kurzeZeilen / zeilen.length >= 0.6) return { ...ergebnis, art: 'liste' };

  if (zeilen.length <= 2 && inhalt.trim().length < 80) return { ...ergebnis, art: 'schnipsel' };

  return ergebnis;
}

const ART_NAME = {
  raptext: 'Raptexte',
  'raptext?': 'Vermutlich Raptexte',
  reimskizze: 'Reimskizzen',
  liste: 'Listen',
  links: 'Linksammlungen',
  leer: 'Leere Notizen',
  schnipsel: 'Schnipsel',
  sonstiges: 'Sonstiges',
};
const ART_REIHENFOLGE = ['raptext', 'raptext?', 'reimskizze', 'liste', 'links', 'schnipsel', 'leer', 'sonstiges'];

// Fingerabdruck fuer Dubletten: Kleinschreibung, ohne Leerraum, gekuerzt.
function fingerabdruck(inhalt) {
  const kompakt = String(inhalt || '').toLowerCase().replace(/\s+/g, '');
  return kompakt.length >= 40 ? kompakt.slice(0, 400) : '';
}

function titelWoerter(titel) {
  return String(titel || '')
    .toLowerCase()
    .replace(/[^a-zäöüß#]+/g, ' ')
    .split(' ')
    .filter(w => w.length >= 4 && !FUELLWOERTER.has(w));
}

// --- Notizen auslesen -------------------------------------------------------

// Ordner koennen verschachtelt sein. Wir merken uns den vollen Pfad.
function sammleOrdner(behaelter, praefix, konto, ergebnis) {
  let kinder;
  try {
    kinder = behaelter.folders();
  } catch (e) {
    return ergebnis;
  }
  for (const ordner of kinder) {
    let name;
    try {
      name = ordner.name();
    } catch (e) {
      continue;
    }
    const pfad = praefix ? `${praefix}/${name}` : name;
    ergebnis.push({
      pfad: pfad,
      name: name,
      konto: konto,
      objekt: ordner,
      papierkorb: PAPIERKORB.includes(schluessel(name)),
    });
    sammleOrdner(ordner, pfad, konto, ergebnis);
  }
  return ergebnis;
}

// Erst alles auf einmal abfragen (ein Aufruf pro Eigenschaft und Ordner),
// bei einem Fehler Notiz fuer Notiz — gesperrte Notizen geben keinen Klartext her.
function liesNotizen(ordner, melde) {
  const sammlung = ordner.objekt.notes;
  let ids, namen, texte, erstellt, geaendert, gesperrt;
  try {
    ids = sammlung.id();
    namen = sammlung.name();
    erstellt = sammlung.creationDate();
    geaendert = sammlung.modificationDate();
  } catch (e) {
    melde(`${ordner.pfad}: nicht lesbar (${e.message}), übersprungen.`);
    return [];
  }
  try {
    gesperrt = sammlung.passwordProtected();
  } catch (e) {
    gesperrt = ids.map(() => false);
  }
  try {
    texte = sammlung.plaintext();
  } catch (e) {
    texte = [];
    const einzeln = sammlung();
    for (let i = 0; i < einzeln.length; i += 1) {
      try {
        texte.push(gesperrt[i] ? '' : einzeln[i].plaintext());
      } catch (e2) {
        texte.push('');
      }
    }
  }

  const notizen = [];
  for (let i = 0; i < ids.length; i += 1) {
    const titel = namen[i] || '';
    const text = texte[i] || '';
    notizen.push({
      id: ids[i],
      titel: titel,
      text: text,
      erstellt: erstellt[i],
      geaendert: geaendert[i],
      konto: ordner.konto,
      ordner: ordner.pfad,
      gesperrt: Boolean(gesperrt[i]),
      anhaenge: anzahlAnhaenge(text),
      ...einordnen(titel, text),
    });
  }
  return notizen;
}

// --- Bericht ----------------------------------------------------------------

function baueBericht(notizen, papierkorbAnzahl, top) {
  const zeilen = [];
  const schreib = z => zeilen.push(z);

  const gesamt = notizen.length;
  const zeichen = notizen.reduce((s, n) => s + n.zeichen, 0);
  const gesperrt = notizen.filter(n => n.gesperrt).length;
  const anhaenge = notizen.reduce((s, n) => s + n.anhaenge, 0);

  schreib('# Bestandsaufnahme Notizen');
  schreib('');
  schreib(`Erstellt: ${jetztAlsText()}`);
  schreib('');
  const teile = [`${zahl(gesamt)} Notizen`, `${zahl(zeichen)} Zeichen`];
  if (anhaenge) teile.push(`${zahl(anhaenge)} Anhänge`);
  if (gesperrt) teile.push(`${zahl(gesperrt)} gesperrt (Inhalt nicht lesbar)`);
  if (papierkorbAnzahl) teile.push(`${zahl(papierkorbAnzahl)} in „Zuletzt gelöscht" (nicht ausgewertet)`);
  schreib(teile.join(' · '));
  schreib('');

  // --- Ordner ----------------------------------------------------------------
  const nachOrdner = new Map();
  for (const n of notizen) {
    const k = `${n.konto}\t${n.ordner}`;
    if (!nachOrdner.has(k)) nachOrdner.set(k, { konto: n.konto, ordner: n.ordner, anzahl: 0, zeichen: 0, zuletzt: null });
    const e = nachOrdner.get(k);
    e.anzahl += 1;
    e.zeichen += n.zeichen;
    if (n.geaendert && (!e.zuletzt || n.geaendert > e.zuletzt)) e.zuletzt = n.geaendert;
  }
  schreib('## Ordner');
  schreib('');
  schreib('| Konto | Ordner | Notizen | Zeichen | zuletzt geändert |');
  schreib('|---|---|---:|---:|---|');
  for (const e of [...nachOrdner.values()].sort((a, b) => b.anzahl - a.anzahl)) {
    schreib(`| ${e.konto} | ${e.ordner} | ${zahl(e.anzahl)} | ${zahl(e.zeichen)} | ${monatJahr(e.zuletzt)} |`);
  }
  schreib('');

  // --- Jahre -----------------------------------------------------------------
  const nachJahr = new Map();
  for (const n of notizen) {
    if (n.erstellt instanceof Date && !isNaN(n.erstellt)) {
      const j = n.erstellt.getFullYear();
      nachJahr.set(j, (nachJahr.get(j) || 0) + 1);
    }
  }
  if (nachJahr.size > 0) {
    schreib('## Nach Jahr (angelegt)');
    schreib('');
    const hoechster = Math.max(...nachJahr.values());
    for (const jahr of [...nachJahr.keys()].sort((a, b) => b - a)) {
      const anzahl = nachJahr.get(jahr);
      const balken = '█'.repeat(Math.max(1, Math.round((anzahl / hoechster) * 40)));
      schreib(`    ${jahr}  ${zahl(anzahl).padStart(7)}  ${balken}`);
    }
    schreib('');
  }

  // --- Was drin steckt ---------------------------------------------------------
  const nachArt = new Map();
  for (const n of notizen) {
    if (!nachArt.has(n.art)) nachArt.set(n.art, []);
    nachArt.get(n.art).push(n);
  }
  schreib('## Was drin steckt');
  schreib('');
  schreib('Grobe Einordnung nach Form: Zeilenlänge, Reime, Adressen, Länge. Kein');
  schreib('Verfahren versteht den Inhalt — die Tabellen darunter zeigen, was jeweils');
  schreib('gemeint ist, damit du es prüfen kannst.');
  schreib('');
  schreib('| Art | Notizen | Anteil |');
  schreib('|---|---:|---:|');
  for (const art of ART_REIHENFOLGE) {
    const liste = nachArt.get(art) || [];
    if (liste.length === 0) continue;
    schreib(`| ${ART_NAME[art]} | ${zahl(liste.length)} | ${Math.round((liste.length / gesamt) * 100)} % |`);
  }
  schreib('');

  const kandidatenArten = ['raptext', 'raptext?', 'reimskizze', 'liste', 'links', 'schnipsel', 'leer'];
  for (const art of kandidatenArten) {
    const liste = (nachArt.get(art) || []).slice().sort((a, b) => (b.geaendert || 0) - (a.geaendert || 0));
    if (liste.length === 0) continue;
    schreib(`### ${ART_NAME[art]} (${zahl(liste.length)})`);
    schreib('');
    const mitReim = art === 'raptext' || art === 'raptext?' || art === 'reimskizze';
    schreib(mitReim
      ? '| Titel | Zeilen | Reim | Ordner | geändert |'
      : '| Titel | Zeilen | Ordner | geändert |');
    schreib(mitReim ? '|---|---:|---:|---|---|' : '|---|---:|---|---|');
    for (const n of liste.slice(0, top)) {
      const titel = (n.titel || '(ohne Titel)').replace(/\|/g, '¦').slice(0, 60);
      schreib(mitReim
        ? `| ${titel} | ${n.zeilen} | ${Math.round(n.reim * 100)} % | ${n.ordner} | ${monatJahr(n.geaendert)} |`
        : `| ${titel} | ${n.zeilen} | ${n.ordner} | ${monatJahr(n.geaendert)} |`);
    }
    if (liste.length > top) schreib(`| … und ${zahl(liste.length - top)} weitere | | | |`);
    schreib('');
  }

  // --- Ohne Titel ---------------------------------------------------------------
  const ohneTitel = notizen.filter(n => OHNE_TITEL.includes(schluessel(n.titel)) && n.art !== 'leer');
  if (ohneTitel.length > 0) {
    schreib(`## Ohne Titel (${zahl(ohneTitel.length)})`);
    schreib('');
    schreib('Notizen, deren erste Zeile „Neue Notiz" ist. Eine Überschrift drüber, und sie sind wiederzufinden.');
    schreib('');
    for (const n of ohneTitel.slice(0, top)) {
      const anfang = inhaltsZeilen(rumpf(n.text, n.titel))[0] || '';
      schreib(`- ${n.ordner} · ${monatJahr(n.geaendert)}: „${anfang.slice(0, 70)}"`);
    }
    schreib('');
  }

  // --- Dubletten -----------------------------------------------------------------
  const nachTitel = new Map();
  const nachInhalt = new Map();
  for (const n of notizen) {
    const t = schluessel(n.titel);
    if (!OHNE_TITEL.includes(t)) {
      if (!nachTitel.has(t)) nachTitel.set(t, []);
      nachTitel.get(t).push(n);
    }
    const f = fingerabdruck(rumpf(n.text, n.titel));
    if (f) {
      if (!nachInhalt.has(f)) nachInhalt.set(f, []);
      nachInhalt.get(f).push(n);
    }
  }
  const gleicherInhalt = [...nachInhalt.values()].filter(g => g.length > 1);
  // Was schon als Kopie erkannt ist, muss nicht noch einmal unter "gleicher
  // Titel" auftauchen.
  const schonKopie = new Set(gleicherInhalt.flat().map(n => n.id));
  const gleicherTitel = [...nachTitel.values()]
    .map(g => g.filter(n => !schonKopie.has(n.id)))
    .filter(g => g.length > 1);
  const dubletten = [];
  if (gleicherInhalt.length > 0 || gleicherTitel.length > 0) {
    schreib('## Doppelt');
    schreib('');
    if (gleicherInhalt.length > 0) {
      schreib(`Gleicher Inhalt (${zahl(gleicherInhalt.length)} Gruppen) — meist Kopien, die beim Bearbeiten am Handy entstanden sind:`);
      schreib('');
      for (const gruppe of gleicherInhalt.slice(0, top)) {
        const sortiert = gruppe.slice().sort((a, b) => (b.geaendert || 0) - (a.geaendert || 0));
        schreib(`- „${(sortiert[0].titel || '(ohne Titel)').slice(0, 60)}" — ${gruppe.length}× in ${[...new Set(gruppe.map(n => n.ordner))].join(', ')}`);
        // Die neueste bleibt, die aelteren sind Kandidaten.
        for (const n of sortiert.slice(1)) dubletten.push(n);
      }
      schreib('');
    }
    if (gleicherTitel.length > 0) {
      schreib(`Gleicher Titel, anderer Inhalt (${zahl(gleicherTitel.length)} Gruppen) — oft mehrere Fassungen desselben Texts:`);
      schreib('');
      for (const gruppe of gleicherTitel.slice(0, top)) {
        schreib(`- „${(gruppe[0].titel || '').slice(0, 60)}" — ${gruppe.length}× in ${[...new Set(gruppe.map(n => n.ordner))].join(', ')}`);
      }
      schreib('');
    }
  }

  // --- Woerter in Titeln ----------------------------------------------------------
  const woerter = new Map();
  for (const n of notizen) {
    for (const w of new Set(titelWoerter(n.titel))) woerter.set(w, (woerter.get(w) || 0) + 1);
  }
  const haeufig = [...woerter.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 30);
  if (haeufig.length > 0) {
    schreib('## Häufige Wörter in Titeln');
    schreib('');
    schreib('Was oft im Titel steht, ist ein Thema — und ein Kandidat für einen eigenen Ordner.');
    schreib('');
    schreib(haeufig.map(([w, c]) => `${w} (${c})`).join(' · '));
    schreib('');
  }

  return { bericht: zeilen.join('\n') + '\n', nachArt: nachArt, dubletten: dubletten };
}

function baueVorlage(nachArt, dubletten) {
  const eintrag = n => ({ id: n.id, _titel: n.titel || '(ohne Titel)', _ordner: `${n.konto}/${n.ordner}` });
  const regeln = [];
  const gruppen = [
    ['Raptexte', ['raptext']],
    ['Vermutlich Raptexte — vorher prüfen', ['raptext?']],
    ['Reimskizzen', ['reimskizze']],
    ['Listen', ['liste']],
    ['Linksammlungen', ['links']],
    ['Schnipsel', ['schnipsel']],
    ['Leere Notizen', ['leer']],
  ];
  for (const [name, arten] of gruppen) {
    const liste = arten.flatMap(a => nachArt.get(a) || []).filter(n => !n.gesperrt);
    if (liste.length === 0) continue;
    regeln.push({ name: name, ziel: '', _anzahl: liste.length, notizen: liste.map(eintrag) });
  }
  if (dubletten.length > 0) {
    regeln.push({
      name: 'Doppelt — jeweils die ältere Fassung',
      ziel: '',
      _anzahl: dubletten.length,
      notizen: dubletten.filter(n => !n.gesperrt).map(eintrag),
    });
  }
  return { quelle: 'Notizen', hoechstens: 0, regeln: regeln };
}

// --- Dateien ----------------------------------------------------------------

function absoluterPfad(pfad) {
  return $.NSString.alloc.initWithUTF8String(pfad).stringByExpandingTildeInPath.stringByStandardizingPath.js;
}

function existiert(pfad) {
  return $.NSFileManager.defaultManager.fileExistsAtPath(pfad);
}

function legeOrdnerAn(pfad) {
  $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(pfad, true, $(), null);
}

function schreibeDatei(pfad, inhalt) {
  const ok = $.NSString.alloc.initWithUTF8String(inhalt)
    .writeToFileAtomicallyEncodingError(pfad, true, $.NSUTF8StringEncoding, null);
  if (!ok) throw new Error(`Kann ${pfad} nicht schreiben.`);
}

function liesArgumente(argv) {
  const werte = { ausgabe: '.', top: 60 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--ausgabe' && argv[i + 1]) werte.ausgabe = argv[++i];
    else if (argv[i] === '--top' && argv[i + 1]) werte.top = parseInt(argv[++i], 10) || 60;
  }
  return werte;
}

function run(argv) {
  const argumente = liesArgumente(argv);
  const melde = zeile => console.log(zeile);

  const Notes = Application('Notes');

  const ordnerListe = [];
  for (const konto of Notes.accounts()) {
    let kontoName;
    try {
      kontoName = konto.name();
    } catch (e) {
      continue;
    }
    sammleOrdner(konto, '', kontoName, ordnerListe);
  }
  if (ordnerListe.length === 0) {
    melde('Keine Ordner gefunden. Ist in Notizen ein Konto eingerichtet?');
    return;
  }

  const notizen = [];
  let papierkorbAnzahl = 0;
  for (const ordner of ordnerListe) {
    if (ordner.papierkorb) {
      try {
        papierkorbAnzahl += ordner.objekt.notes.length;
      } catch (e) {
        // dann eben ohne Zahl
      }
      continue;
    }
    melde(`Lese ${ordner.konto}/${ordner.pfad} …`);
    for (const n of liesNotizen(ordner, melde)) notizen.push(n);
  }

  if (notizen.length === 0) {
    melde('Keine Notizen gefunden.');
    return;
  }

  const { bericht, nachArt, dubletten } = baueBericht(notizen, papierkorbAnzahl, argumente.top);
  const vorlage = baueVorlage(nachArt, dubletten);

  const ziel = absoluterPfad(argumente.ausgabe);
  legeOrdnerAn(ziel);

  const berichtDatei = `${ziel}/bericht.md`;
  schreibeDatei(berichtDatei, bericht);

  const regelDatei = `${ziel}/regeln.json`;
  if (existiert(regelDatei)) {
    melde(`${regelDatei} existiert bereits — nicht überschrieben.`);
  } else {
    schreibeDatei(regelDatei, JSON.stringify(vorlage, null, 2) + '\n');
  }

  melde('');
  melde(`Geschrieben: ${berichtDatei} und ${regelDatei}`);
  melde('');

  // Der Rueckgabewert landet auf stdout — so laesst sich der Bericht auch
  // direkt lesen oder weiterleiten.
  return bericht;
}

// Fuer Pruefungen ausserhalb von osascript (node): nur die reinen
// Auswertungsfunktionen, kein Zugriff auf Notizen.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { einordnen, reimAnteil, reimEnde, rumpf, fingerabdruck, titelWoerter, baueBericht, baueVorlage };
}
