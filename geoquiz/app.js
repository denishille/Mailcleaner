/* GeoQuiz – Land des Tages (nach trivi.gg "Daily Country") und GeoRankle (nach Geotrivia) */
(function () {
  'use strict';

  const D = window.GEO_DATA;
  const COUNTRIES = D.countries;
  const BY_ISO = Object.fromEntries(COUNTRIES.map(c => [c.iso3, c]));
  const CATS = D.categories;
  const CAT_BY_KEY = Object.fromEntries(CATS.map(c => [c.key, c]));
  const N_COUNTRIES = COUNTRIES.length;

  const MAX_GUESSES = 5;
  const ROUNDS = 8;
  const MIN_POP = 250000;                       // Kleinststaaten sind nie das gesuchte Land
  const EPOCH = new Date(2026, 0, 1);           // Rätsel #1

  // ------------------------------------------------------------------ utils
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = s => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  function norm(s) {
    return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/ß/g, 'ss').replace(/^(the|die|der|das) /, '').replace(/[^a-z0-9]/g, '');
  }
  const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
  function fmtMoney(v) {
    if (v >= 1e12) return nf2.format(v / 1e12) + ' Bio. $';
    if (v >= 1e9) return nf1.format(v / 1e9) + ' Mrd. $';
    if (v >= 1e6) return nf1.format(v / 1e6) + ' Mio. $';
    return nf0.format(v) + ' $';
  }
  function fmtCompact(v) {
    if (v >= 1e9) return nf2.format(v / 1e9) + ' Mrd.';
    if (v >= 1e6) return nf1.format(v / 1e6) + ' Mio.';
    if (v >= 1e4) return nf0.format(v);
    return nf0.format(v);
  }
  function fmtStat(cat, v) {
    if (v == null) return '–';
    let s;
    switch (cat.fmt) {
      case 'money': s = fmtMoney(v); break;
      case 'int': s = (cat.key === 'pop' ? fmtCompact(v) : nf0.format(v)); break;
      case 'dec1': s = nf1.format(v); break;
      case 'dec2': s = nf2.format(v); break;
      default: s = String(v);
    }
    if (cat.unit && cat.fmt !== 'money') s += ' ' + cat.unit;
    return s;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffled(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function todayIndex() {
    const n = new Date();
    const t = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    return Math.round((t - EPOCH) / 864e5);
  }
  function msToMidnight() {
    const n = new Date();
    const m = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
    return m - n;
  }
  function fmtCountdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return [h, m, x].map(v => String(v).padStart(2, '0')).join(':');
  }

  const store = {
    get(k, fallback) { try { const v = localStorage.getItem('geoquiz.' + k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    set(k, v) { try { localStorage.setItem('geoquiz.' + k, JSON.stringify(v)); } catch (e) { /* privat/gesperrt */ } },
  };

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('In die Zwischenablage kopiert'); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('In die Zwischenablage kopiert'); } catch (e2) { toast('Kopieren nicht möglich'); }
      ta.remove();
    }
  }
  function shareOrCopy(text) {
    if (navigator.share) navigator.share({ text }).catch(() => copyText(text));
    else copyText(text);
  }

  let flagUid = 0;
  function flagSvg(c) {
    // ids je Instanz eindeutig machen (clipPath-Referenzen)
    const u = 'f' + (flagUid++) + '-';
    return c.flag
      .replace(/id="([^"]+)"/g, (m, id) => `id="${u}${id}"`)
      .replace(/url\(#([^)]+)\)/g, (m, id) => `url(#${u}${id})`)
      .replace(/href="#([^"]+)"/g, (m, id) => `href="#${u}${id}"`);
  }
  function shareUrl() {
    return /^https?:/.test(location.protocol) ? '\n' + location.origin + location.pathname : '';
  }

  // ---------------------------------------------------------------- Modals
  function openModal(id) { $(id).hidden = false; }
  function closeModals() { $$('.modal').forEach(m => { m.hidden = true; }); }
  $$('.modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m || e.target.hasAttribute('data-close')) closeModals(); });
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });

  // ---------------------------------------------------------------- Views
  let view = 'daily';
  function setView(v) {
    view = v;
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
    $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
    $('#help-daily').hidden = v !== 'daily';
    $('#help-rankle').hidden = v !== 'rankle';
    try { location.hash = v; } catch (e) { /* egal */ }
  }
  $$('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));
  $('#btn-help').addEventListener('click', () => openModal('#modal-help'));
  $('#btn-stats').addEventListener('click', () => { renderStats(); openModal('#modal-stats'); });

  // =================================================================
  //  LAND DES TAGES
  // =================================================================
  const DAILY_POOL = COUNTRIES.filter(c => c.stats.pop >= MIN_POP && c.stats.gdppc != null);
  const DAILY_ORDER = shuffled(DAILY_POOL, mulberry32(20260907));

  // Rätsel #1 = EPOCH, #N = EPOCH + N-1 Tage. Alle Rätsel bis heute sind spielbar.
  const maxPuzzle = () => todayIndex() + 1;
  const puzzleDate = n => new Date(EPOCH.getFullYear(), EPOCH.getMonth(), EPOCH.getDate() + n - 1);
  const dfmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  const clampPuzzle = n => Math.min(Math.max(1, Math.round(n) || maxPuzzle()), maxPuzzle());

  const daily = { num: 0, day: 0, secret: null, guesses: [], done: false, won: false };

  function dailySecretFor(day) { return DAILY_ORDER[((day % DAILY_ORDER.length) + DAILY_ORDER.length) % DAILY_ORDER.length]; }
  const dailyKey = n => 'daily.' + n;

  function loadDaily(n) {
    n = clampPuzzle(n);
    daily.num = n; daily.day = n - 1;
    daily.secret = dailySecretFor(daily.day);
    let saved = store.get(dailyKey(n), null);
    if (!saved) { const old = store.get('daily', null); if (old && old.day === daily.day) saved = old; }
    if (saved && saved.secret === daily.secret.iso3) {
      daily.guesses = saved.guesses.filter(i => BY_ISO[i]);
      daily.done = saved.done; daily.won = saved.won;
    } else {
      daily.guesses = []; daily.done = false; daily.won = false;
    }
    renderDaily();
  }
  function saveDaily() {
    store.set(dailyKey(daily.num), { day: daily.day, secret: daily.secret.iso3, guesses: daily.guesses, done: daily.done, won: daily.won });
  }
  function puzzleStatus(key, n) {
    const s = store.get(key(n), null);
    return s && s.done ? (s.won ? '✓' : '✗') : (s && (s.guesses || s.picks || []).length ? '…' : '');
  }
  function fillPicker(sel, current, key) {
    const max = maxPuzzle();
    sel.innerHTML = Array.from({ length: max }, (_, i) => max - i).map(n => {
      const st = puzzleStatus(key, n);
      return `<option value="${n}"${n === current ? ' selected' : ''}>#${n}${n === max ? ' · heute' : ''}${st ? ' ' + st : ''}</option>`;
    }).join('');
  }
  $('#daily-prev').addEventListener('click', () => loadDaily(daily.num - 1));
  $('#daily-next').addEventListener('click', () => loadDaily(daily.num + 1));
  $('#daily-pick').addEventListener('change', e => loadDaily(+e.target.value));

  // ---- Hinweise
  const HINTS = [
    { key: 'continent', lbl: 'Kontinent' },
    { key: 'distance', lbl: 'Entfernung' },
    { key: 'pop', lbl: 'Einwohner' },
    { key: 'area', lbl: 'Fläche' },
    { key: 'gdppc', lbl: 'BIP/Kopf' },
    { key: 'borders', lbl: 'Nachbarn' },
    { key: 'coast', lbl: 'Küste' },
    { key: 'currency', lbl: 'Währung' },
    { key: 'colors', lbl: 'Flagge', wide: true },
    { key: 'languages', lbl: 'Sprachen', wide: true },
  ];
  const DIR_ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  function geo(a, b) {
    // Luftlinie (Haversine) und Kompassrichtung von a nach b
    const R = 6371, toRad = d => d * Math.PI / 180;
    const [la1, lo1] = a.map(toRad), [la2, lo2] = b.map(toRad);
    const dLat = la2 - la1, dLon = lo2 - lo1;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    const km = 2 * R * Math.asin(Math.sqrt(h));
    const y = Math.sin(dLon) * Math.cos(la2);
    const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
    const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    return { km, arrow: DIR_ARROWS[Math.round(bearing / 45) % 8] };
  }
  const COLOR_DE = { red: 'Rot', white: 'Weiß', blue: 'Blau', green: 'Grün', yellow: 'Gelb', black: 'Schwarz', orange: 'Orange', purple: 'Lila' };
  const COLOR_HEX = { red: '#d92b2b', white: '#f4f4f4', blue: '#2b5fd9', green: '#2a9d4a', yellow: '#f2c320', black: '#111', orange: '#f28b1e', purple: '#8a3fc9' };

  function numCompare(g, s, isCount) {
    if (g == null || s == null) return { cls: 'miss', arrow: '?' };
    return { cls: s === g ? 'ok' : 'miss', arrow: s === g ? '✓' : s > g ? '↑' : '↓' };
  }
  function setCompare(gs, ss) {
    const shared = gs.filter(x => ss.includes(x));
    const same = shared.length === gs.length && shared.length === ss.length;
    return { cls: same ? 'ok' : 'miss', shared };
  }

  function evalGuess(g, s) {
    const out = {};
    out.continent = { cls: g.continent === s.continent ? 'ok' : 'miss', html: esc(g.continent) };
    const d = geo(g.latlng, s.latlng);
    out.distance = g.iso3 === s.iso3
      ? { cls: 'ok', html: '0 km', arrow: '✓' }
      : { cls: 'miss', html: nf0.format(Math.round(d.km / 10) * 10) + ' km', arrow: d.arrow };
    let c = numCompare(g.stats.pop, s.stats.pop);
    out.pop = { cls: c.cls, html: esc(fmtCompact(g.stats.pop)), arrow: c.arrow };
    c = numCompare(g.stats.area, s.stats.area);
    out.area = { cls: c.cls, html: esc(nf0.format(g.stats.area)) + ' km²', arrow: c.arrow };
    c = numCompare(g.stats.gdppc, s.stats.gdppc);
    out.gdppc = { cls: c.cls, html: g.stats.gdppc != null ? esc(nf0.format(g.stats.gdppc)) + ' $' : '?', arrow: c.arrow };
    c = numCompare(g.borders.length, s.borders.length, true);
    out.borders = { cls: c.cls, html: String(g.borders.length), arrow: c.arrow };
    out.coast = { cls: g.landlocked === s.landlocked ? 'ok' : 'miss', html: g.landlocked ? 'Binnen\u00adstaat' : 'Küste' };
    c = setCompare(g.colors, s.colors);
    out.colors = { cls: c.cls, html: '<div class="chips">' + g.colors.map(col =>
      `<span class="chip${c.shared.includes(col) ? ' hit' : ''}"><i class="dot" style="background:${COLOR_HEX[col]}"></i>${COLOR_DE[col] || col}</span>`).join('') + '</div>' };
    c = setCompare(g.languages, s.languages);
    out.languages = { cls: c.cls, html: '<div class="chips">' + g.languages.slice(0, 4).map(l =>
      `<span class="chip${c.shared.includes(l) ? ' hit' : ''}">${esc(l)}</span>`).join('') + (g.languages.length > 4 ? `<span class="chip">+${g.languages.length - 4}</span>` : '') + '</div>' };
    c = setCompare(g.currency, s.currency);
    out.currency = { cls: c.cls, html: esc(g.currencyName) };
    return out;
  }

  function guessRowHtml(g, ev) {
    return `<div class="guess">
      <div class="guess-title"><span class="mini-flag">${flagSvg(g)}</span>${esc(g.name)} <span class="cap">${esc(g.capital)}</span></div>
      <div class="cells">${HINTS.map(h => {
        const e = ev[h.key];
        return `<div class="cell ${e.cls}${h.wide ? ' wide' : ''}"><div class="lbl">${h.lbl}</div><div class="val">${e.html}</div>${e.arrow ? `<div class="arrow">${e.arrow}</div>` : ''}</div>`;
      }).join('')}</div>
    </div>`;
  }

  function emojiGrid() {
    const s = daily.secret;
    return daily.guesses.map(iso => {
      const ev = evalGuess(BY_ISO[iso], s);
      return HINTS.map(h => (ev[h.key].cls === 'ok' ? '🟩' : '⬛')).join('');
    }).join('\n');
  }

  function renderDaily() {
    const isToday = daily.num === maxPuzzle();
    $('#daily-num').textContent = 'Rätsel #' + daily.num + (isToday ? ' · heute' : ' · ' + dfmt.format(puzzleDate(daily.num)));
    $('#daily-sub').textContent = isToday
      ? 'Errate das geheime Land in 5 Versuchen. Alle spielen heute dasselbe Land.'
      : 'Errate das geheime Land in 5 Versuchen. Jedes Rätsel hat sein eigenes Land.';
    fillPicker($('#daily-pick'), daily.num, dailyKey);
    $('#daily-prev').disabled = daily.num <= 1;
    $('#daily-next').disabled = isToday;
    const s = daily.secret;
    $('#guesses').innerHTML = daily.guesses.map(iso => guessRowHtml(BY_ISO[iso], evalGuess(BY_ISO[iso], s))).join('');
    const input = $('#guess-input'), btn = $('#guess-btn');
    input.disabled = daily.done; btn.disabled = daily.done;
    input.value = '';
    input.placeholder = daily.done ? (daily.won ? 'Gelöst' : 'Nicht gelöst') : `Land eingeben … (Versuch ${daily.guesses.length + 1}/${MAX_GUESSES})`;
    renderDailyResult();
  }

  let countdownTimer;
  function renderDailyResult() {
    const box = $('#daily-result');
    clearInterval(countdownTimer);
    if (!daily.done) { box.hidden = true; return; }
    const s = daily.secret, n = daily.guesses.length;
    const isToday = daily.num === maxPuzzle();
    const title = daily.won ? `Richtig! ${s.name}` : `Leider nicht. Es war ${s.name}`;
    const shareTitle = `Land des Tages #${daily.num}`;
    const shareText = `${shareTitle} ${daily.won ? n : 'X'}/${MAX_GUESSES}\n${emojiGrid()}${shareUrl()}`;
    box.innerHTML = `
      <div class="big-flag">${flagSvg(s)}</div>
      <h2>${esc(title)}</h2>
      <div class="facts">
        <span>${esc(s.en)}</span><span>Hauptstadt: ${esc(s.capital)}</span><span>${esc(s.continent)}</span>
        <span>${fmtCompact(s.stats.pop)} Einwohner</span><span>${nf0.format(s.stats.area)} km²</span>
        ${s.stats.gdppc != null ? `<span>BIP/Kopf ${nf0.format(s.stats.gdppc)} $</span>` : ''}
      </div>
      <pre>${esc(shareText.replace(shareUrl(), ''))}</pre>
      <div class="actions">
        <button class="primary" id="btn-share-daily">Ergebnis teilen</button>
        ${daily.num > 1 ? `<button class="ghost" id="btn-daily-prev">‹ Rätsel #${daily.num - 1}</button>` : ''}
        ${!isToday ? `<button class="ghost" id="btn-daily-next">Rätsel #${daily.num + 1} ›</button>` : ''}
      </div>
      ${isToday ? '<div class="countdown">Nächstes Rätsel in <strong id="cd"></strong></div>' : ''}`;
    box.hidden = false;
    $('#btn-share-daily').addEventListener('click', () => shareOrCopy(shareText));
    const bp = $('#btn-daily-prev'); if (bp) bp.addEventListener('click', () => { loadDaily(daily.num - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    const bn = $('#btn-daily-next'); if (bn) bn.addEventListener('click', () => { loadDaily(daily.num + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    if (isToday) {
      const tick = () => { const el = $('#cd'); if (el) el.textContent = fmtCountdown(msToMidnight()); };
      tick(); countdownTimer = setInterval(tick, 1000);
    }
  }

  function recordDailyStats(won, n) {
    const st = store.get('dailyStats', { played: 0, wins: 0, streak: 0, maxStreak: 0, lastDay: null, dist: {}, done: {} });
    st.done = st.done || {};
    if (st.done[daily.num]) return;
    st.done[daily.num] = 1;
    st.played++;
    if (won) { st.wins++; st.dist[n] = (st.dist[n] || 0) + 1; }
    if (daily.num === maxPuzzle()) {
      // Serie zählt nur für das Rätsel des Tages
      if (st.lastDay !== daily.day) {
        st.streak = won ? (st.lastDay === daily.day - 1 ? st.streak + 1 : 1) : 0;
        st.maxStreak = Math.max(st.maxStreak, st.streak);
        st.lastDay = daily.day;
      }
    }
    store.set('dailyStats', st);
  }

  function submitGuess(c) {
    if (daily.done) return;
    if (daily.guesses.includes(c.iso3)) { toast('Schon geraten: ' + c.name); return; }
    daily.guesses.push(c.iso3);
    if (c.iso3 === daily.secret.iso3) { daily.done = true; daily.won = true; }
    else if (daily.guesses.length >= MAX_GUESSES) { daily.done = true; daily.won = false; }
    if (daily.done) recordDailyStats(daily.won, daily.guesses.length);
    saveDaily();
    renderDaily();
    if (!daily.done) $('#guess-input').focus();
  }

  // ---- Autocomplete
  const SEARCH = COUNTRIES.map(c => ({
    c, name: norm(c.name),
    aliases: c.aliases.map(a => ({ raw: a, n: norm(a) })).filter(a => a.n),
  }));
  function findMatches(q) {
    const nq = norm(q);
    if (!nq) return [];
    const res = [];
    for (const e of SEARCH) {
      let score = 0, via = null;
      if (e.name === nq) score = 100;
      else if (e.name.startsWith(nq)) score = 80;
      else if (e.name.includes(nq)) score = 40;
      for (const a of e.aliases) {
        let s2 = a.n === nq ? 95 : a.n.startsWith(nq) ? 70 : a.n.includes(nq) ? 30 : 0;
        if (s2 > score) { score = s2; via = a.raw; }
      }
      if (score) res.push({ c: e.c, score, via });
    }
    res.sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name, 'de'));
    return res.slice(0, 8);
  }
  function resolveInput(q) {
    const nq = norm(q);
    if (!nq) return null;
    const exact = SEARCH.find(e => e.name === nq || e.aliases.some(a => a.n === nq));
    if (exact) return exact.c;
    const m = findMatches(q);
    return m.length === 1 || (m.length && m[0].score >= 70 && (m.length === 1 || m[1].score < 70)) ? m[0].c : null;
  }

  const input = $('#guess-input'), suggest = $('#suggest');
  let sugIdx = -1, sugItems = [];
  function renderSuggest() {
    if (!sugItems.length) { suggest.hidden = true; return; }
    suggest.innerHTML = sugItems.map((m, i) =>
      `<li data-i="${i}" class="${i === sugIdx ? 'sel' : ''}"><span>${esc(m.c.name)}</span>${m.via && norm(m.via) !== norm(m.c.name) ? `<span class="alias">${esc(m.via)}</span>` : ''}</li>`).join('');
    suggest.hidden = false;
  }
  input.addEventListener('input', () => {
    sugItems = findMatches(input.value).filter(m => !daily.guesses.includes(m.c.iso3));
    sugIdx = sugItems.length ? 0 : -1;
    renderSuggest();
  });
  input.addEventListener('keydown', e => {
    if (suggest.hidden) return;
    if (e.key === 'ArrowDown') { sugIdx = Math.min(sugItems.length - 1, sugIdx + 1); renderSuggest(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sugIdx = Math.max(0, sugIdx - 1); renderSuggest(); e.preventDefault(); }
    else if (e.key === 'Tab' && sugIdx >= 0) { input.value = sugItems[sugIdx].c.name; suggest.hidden = true; e.preventDefault(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { suggest.hidden = true; }, 150));
  suggest.addEventListener('mousedown', e => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    const m = sugItems[+li.dataset.i];
    suggest.hidden = true; input.value = '';
    submitGuess(m.c);
  });
  $('#guess-form').addEventListener('submit', e => {
    e.preventDefault();
    let c = null;
    if (!suggest.hidden && sugIdx >= 0 && sugItems[sugIdx]) c = sugItems[sugIdx].c;
    else c = resolveInput(input.value);
    suggest.hidden = true;
    if (!c) { toast('Land nicht gefunden'); return; }
    input.value = '';
    submitGuess(c);
  });

  // =================================================================
  //  GEORANKLE
  // =================================================================
  const RANKLE_POOL = COUNTRIES.filter(c => c.stats.pop >= MIN_POP && Object.keys(c.ranks || {}).length >= 20);

  const rankle = { num: 0, day: 0, countries: [], round: 0, picks: [], used: [], revealed: false };
  const rankleKey = n => 'rankle.' + n;

  function pickCountries(seed) {
    const rng = mulberry32(seed);
    return shuffled(RANKLE_POOL, rng).slice(0, ROUNDS).map(c => c.iso3);
  }
  function loadRankle(n) {
    n = clampPuzzle(n);
    rankle.num = n; rankle.day = n - 1;
    rankle.countries = pickCountries(rankle.day * 1000003 + 42);
    rankle.round = 0; rankle.picks = []; rankle.used = []; rankle.revealed = false;
    let saved = store.get(rankleKey(n), null);
    if (!saved) { const old = store.get('rankle', null); if (old && old.day === rankle.day) saved = old; }
    if (saved && JSON.stringify(saved.countries) === JSON.stringify(rankle.countries)) {
      rankle.picks = saved.picks; rankle.used = saved.picks.map(p => p.cat);
      rankle.round = saved.picks.length; rankle.revealed = false;
    }
    renderRankle();
  }
  function saveRankle() {
    store.set(rankleKey(rankle.num), { day: rankle.day, countries: rankle.countries, picks: rankle.picks, done: rankle.picks.length >= ROUNDS, won: rankle.picks.length >= ROUNDS });
  }
  $('#rankle-prev').addEventListener('click', () => loadRankle(rankle.num - 1));
  $('#rankle-next').addEventListener('click', () => loadRankle(rankle.num + 1));
  $('#rankle-pick').addEventListener('change', e => loadRankle(+e.target.value));

  function points(chosen, best) {
    if (chosen === best) return 100;
    return Math.max(0, Math.round(100 * Math.exp(-(chosen - best) / 40)));
  }
  function ptsClass(p) { return p >= 90 ? 'g' : p >= 50 ? 'y' : 'r'; }
  function ptsEmoji(p) { return p >= 90 ? '🟩' : p >= 50 ? '🟨' : '🟥'; }
  const total = () => rankle.picks.reduce((a, p) => a + p.pts, 0);

  function bestAvailable(c) {
    let best = null;
    for (const cat of CATS) {
      if (rankle.used.includes(cat.key)) continue;
      const r = c.ranks && c.ranks[cat.key];
      if (r != null && (best === null || r < best.rank)) best = { cat: cat.key, rank: r };
    }
    return best;
  }

  function chooseCategory(key) {
    if (rankle.revealed || rankle.round >= ROUNDS) return;
    const c = BY_ISO[rankle.countries[rankle.round]];
    const rank = c.ranks[key];
    if (rank == null || rankle.used.includes(key)) return;
    const best = bestAvailable(c);
    const pts = points(rank, best.rank);
    rankle.picks.push({ iso3: c.iso3, cat: key, rank, bestCat: best.cat, bestRank: best.rank, pts });
    rankle.used.push(key);
    rankle.revealed = true;
    saveRankle();
    renderRankle();
  }
  function nextRound() {
    rankle.round++; rankle.revealed = false;
    if (rankle.round >= ROUNDS) recordRankleStats();
    renderRankle();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function recordRankleStats() {
    const st = store.get('rankleStats', { games: 0, sum: 0, best: 0, lastDay: null, streak: 0, maxStreak: 0, done: {} });
    st.done = st.done || {};
    if (st.done[rankle.num]) return;
    st.done[rankle.num] = 1;
    const t = total();
    st.games++; st.sum += t; st.best = Math.max(st.best, t);
    if (rankle.num === maxPuzzle() && st.lastDay !== rankle.day) {
      st.streak = st.lastDay === rankle.day - 1 ? st.streak + 1 : 1;
      st.maxStreak = Math.max(st.maxStreak, st.streak);
      st.lastDay = rankle.day;
    }
    store.set('rankleStats', st);
  }

  function renderRankle() {
    const isToday = rankle.num === maxPuzzle();
    $('#rankle-num').textContent = 'Rätsel #' + rankle.num + (isToday ? ' · heute' : ' · ' + dfmt.format(puzzleDate(rankle.num)));
    fillPicker($('#rankle-pick'), rankle.num, rankleKey);
    $('#rankle-prev').disabled = rankle.num <= 1;
    $('#rankle-next').disabled = isToday;
    $('#rankle-score').textContent = total();
    $('#rankle-rounds').innerHTML = Array.from({ length: ROUNDS }, (_, i) => {
      const p = rankle.picks[i];
      const cls = p ? 'done ' + ptsClass(p.pts) : (i === rankle.round ? 'cur' : '');
      return `<div class="round-dot ${cls}" title="Runde ${i + 1}">${p ? p.pts : i + 1}</div>`;
    }).join('');

    const finished = rankle.round >= ROUNDS;
    $('#rankle-board').hidden = finished;
    $('#rankle-result').hidden = !finished;
    if (finished) { renderRankleResult(); return; }

    const c = BY_ISO[rankle.countries[rankle.round]];
    $('#flag-wrap').innerHTML = flagSvg(c);
    $('#rankle-country').textContent = c.name;
    $('#rankle-country-sub').textContent = `${c.continent} · Hauptstadt ${c.capital} · Runde ${rankle.round + 1} von ${ROUNDS}`;

    const pick = rankle.revealed ? rankle.picks[rankle.picks.length - 1] : null;
    $('#cat-grid').innerHTML = CATS.map(cat => {
      const used = rankle.used.includes(cat.key) && !(pick && pick.cat === cat.key);
      const noData = c.ranks[cat.key] == null;
      const dis = used || noData || rankle.revealed;
      return `<button class="cat${used ? ' used' : ''}" data-cat="${cat.key}" ${dis ? 'disabled' : ''} title="${esc(cat.desc)}">
        <span class="cn">${esc(cat.name)}</span>
        <span class="cd">${noData ? 'keine Daten' : used ? 'bereits benutzt' : esc(cat.desc)}</span></button>`;
    }).join('');
    $$('#cat-grid .cat').forEach(b => b.addEventListener('click', () => chooseCategory(b.dataset.cat)));

    const rev = $('#rankle-reveal');
    if (!pick) { rev.hidden = true; return; }
    const rows = CATS.map(cat => ({ cat, rank: c.ranks[cat.key], v: c.stats[cat.key] }))
      .sort((a, b) => (a.rank == null) - (b.rank == null) || a.rank - b.rank);
    const catName = k => CAT_BY_KEY[k].name;
    const msg = pick.pts === 100
      ? `Volltreffer! ${catName(pick.cat)} ist die beste verfügbare Kategorie.`
      : `Beste verfügbare Kategorie wäre <strong>${esc(catName(pick.bestCat))}</strong> gewesen (Rang ${pick.bestRank}).`;
    rev.innerHTML = `
      <div class="headline">
        <div class="pts ${ptsClass(pick.pts)}">+${pick.pts}</div>
        <div><strong>${esc(catName(pick.cat))}: Rang ${pick.rank} von ${N_COUNTRIES}</strong> · ${fmtStat(CAT_BY_KEY[pick.cat], c.stats[pick.cat])}<br><span class="muted">${msg}</span></div>
        <button class="primary" id="btn-next" style="margin-left:auto">${rankle.round + 1 >= ROUNDS ? 'Ergebnis ansehen' : 'Nächstes Land'}</button>
      </div>
      <div class="table-wrap"><table class="rank-table">
        <thead><tr><th>Rang</th><th>Kategorie</th><th style="text-align:right">Wert</th></tr></thead>
        <tbody>${rows.map(r => {
          const cls = r.cat.key === pick.cat ? 'pick' : r.cat.key === pick.bestCat ? 'best' : rankle.used.includes(r.cat.key) ? 'used' : '';
          return `<tr class="${cls}"><td class="r">${r.rank != null ? '#' + r.rank : '–'}</td><td>${esc(r.cat.name)}${r.cat.key === pick.cat ? ' ← deine Wahl' : r.cat.key === pick.bestCat && pick.pts < 100 ? ' ← beste Wahl' : ''}</td><td class="v">${fmtStat(r.cat, r.v)}</td></tr>`;
        }).join('')}</tbody></table></div>`;
    rev.hidden = false;
    $('#btn-next').addEventListener('click', nextRound);
    rev.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function rankleShareText() {
    const head = `GeoRankle #${rankle.num}`;
    const flags = rankle.picks.map(p => BY_ISO[p.iso3].emoji).join(' ');
    const bars = rankle.picks.map(p => ptsEmoji(p.pts)).join('');
    return `${head} · ${total()}/${ROUNDS * 100} Punkte\n${flags}\n${bars}${shareUrl()}`;
  }
  function renderRankleResult() {
    const box = $('#rankle-result');
    const t = total();
    const verdict = t >= 750 ? 'Weltklasse!' : t >= 600 ? 'Stark!' : t >= 450 ? 'Solide.' : t >= 300 ? 'Ausbaufähig.' : 'Beim nächsten Mal wird’s besser.';
    const share = rankleShareText();
    box.innerHTML = `
      <h2>${t} / ${ROUNDS * 100} Punkte · ${verdict}</h2>
      <div class="rounds-summary">${rankle.picks.map((p, i) => {
        const c = BY_ISO[p.iso3];
        return `<div class="rs"><span class="mini-flag">${flagSvg(c)}</span>
          <div class="rs-body"><strong>${i + 1}. ${esc(c.name)}</strong>${esc(CAT_BY_KEY[p.cat].name)} #${p.rank}${p.pts < 100 ? `<br><span class="muted">Beste: ${esc(CAT_BY_KEY[p.bestCat].name)} #${p.bestRank}</span>` : ''}</div>
          <span class="rs-pts ${ptsClass(p.pts)}">${p.pts}</span></div>`;
      }).join('')}</div>
      <pre>${esc(share.replace(shareUrl(), ''))}</pre>
      <div class="actions">
        <button class="primary" id="btn-share-rankle">Ergebnis teilen</button>
        ${rankle.num > 1 ? `<button class="ghost" id="btn-rankle-prev">‹ Rätsel #${rankle.num - 1}</button>` : ''}
        ${rankle.num < maxPuzzle() ? `<button class="ghost" id="btn-rankle-next">Rätsel #${rankle.num + 1} ›</button>` : ''}
      </div>
      ${rankle.num === maxPuzzle() ? '<div class="countdown">Nächstes Rätsel in <strong id="cd2"></strong></div>' : ''}`;
    $('#btn-share-rankle').addEventListener('click', () => shareOrCopy(share));
    const rp = $('#btn-rankle-prev'); if (rp) rp.addEventListener('click', () => { loadRankle(rankle.num - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    const rn = $('#btn-rankle-next'); if (rn) rn.addEventListener('click', () => { loadRankle(rankle.num + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    if (rankle.num === maxPuzzle()) {
      const tick = () => { const el = $('#cd2'); if (el) el.textContent = fmtCountdown(msToMidnight()); };
      tick(); setInterval(tick, 1000);
    }
  }

  // =================================================================
  //  Statistik
  // =================================================================
  function renderStats() {
    const el = $('#stats-content');
    if (view === 'daily') {
      const st = store.get('dailyStats', { played: 0, wins: 0, streak: 0, maxStreak: 0, dist: {} });
      const maxD = Math.max(1, ...Object.values(st.dist));
      const hl = daily.done && daily.won ? daily.guesses.length : -1;
      el.innerHTML = `<h2>Land des Tages – Statistik</h2>
        <div class="stat-grid">
          <div><strong>${st.played}</strong><span>gespielt</span></div>
          <div><strong>${st.played ? Math.round(100 * st.wins / st.played) : 0}%</strong><span>gelöst</span></div>
          <div><strong>${st.streak}</strong><span>Serie</span></div>
          <div><strong>${st.maxStreak}</strong><span>beste Serie</span></div>
        </div>
        <h2>Verteilung der Versuche</h2>
        <div class="dist">${[1, 2, 3, 4, 5].map(n => `<span>${n}</span><div class="bar${n === hl ? ' hl' : ''}" style="width:${Math.max(7, 100 * (st.dist[n] || 0) / maxD)}%">${st.dist[n] || 0}</div>`).join('')}</div>`;
    } else {
      const st = store.get('rankleStats', { games: 0, sum: 0, best: 0, streak: 0, maxStreak: 0 });
      el.innerHTML = `<h2>GeoRankle – Statistik</h2>
        <div class="stat-grid">
          <div><strong>${st.games}</strong><span>Spiele</span></div>
          <div><strong>${st.games ? Math.round(st.sum / st.games) : 0}</strong><span>Ø Punkte</span></div>
          <div><strong>${st.best}</strong><span>Bestwert</span></div>
          <div><strong>${st.streak}</strong><span>Serie</span></div>
        </div>
        <p class="muted">Die Serie zählt nur, wenn du das Rätsel des Tages am selben Tag spielst.</p>`;
    }
  }

  // =================================================================
  //  Start
  // =================================================================
  loadDaily();
  loadRankle();
  setView(location.hash === '#rankle' ? 'rankle' : 'daily');

  // Tageswechsel bei offener Seite erkennen: neues Rätsel in die Auswahl aufnehmen
  let knownMax = maxPuzzle();
  setInterval(() => {
    if (maxPuzzle() !== knownMax) {
      knownMax = maxPuzzle();
      renderDaily(); renderRankle();
      toast('Ein neuer Tag, ein neues Rätsel #' + knownMax + '!');
    }
  }, 30000);
})();
