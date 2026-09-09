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

  let flagUid = 0;
  function flagSvg(c) {
    // ids je Instanz eindeutig machen (clipPath-Referenzen)
    const u = 'f' + (flagUid++) + '-';
    return c.flag
      .replace(/id="([^"]+)"/g, (m, id) => `id="${u}${id}"`)
      .replace(/url\(#([^)]+)\)/g, (m, id) => `url(#${u}${id})`)
      .replace(/href="#([^"]+)"/g, (m, id) => `href="#${u}${id}"`);
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
    try { location.hash = v; } catch (e) { /* egal */ }
  }
  $$('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));
  $('#btn-stats').addEventListener('click', () => { renderStats(); openModal('#modal-stats'); });

  // =================================================================
  //  LAND DES TAGES
  // =================================================================
  const DAILY_POOL = COUNTRIES.filter(c => c.stats.pop >= MIN_POP && c.stats.gdppc != null);
  const DAILY_ORDER = shuffled(DAILY_POOL, mulberry32(20260907));

  // Rätsel #1 = EPOCH, #N = EPOCH + N-1 Tage. Alle Rätsel bis heute sind spielbar.
  const maxPuzzle = () => todayIndex() + 1;
  const clampPuzzle = n => Math.min(Math.max(1, Math.round(n) || maxPuzzle()), maxPuzzle());

  const daily = { num: 0, day: 0, secret: null, guesses: [], done: false, won: false };

  function dailySecretFor(day) { return DAILY_ORDER[((day % DAILY_ORDER.length) + DAILY_ORDER.length) % DAILY_ORDER.length]; }
  const dailyKey = n => 'daily.' + n;

  function loadDaily(n) {
    n = clampPuzzle(n);
    daily.num = n; daily.day = n - 1;
    store.set('dailyLast', n);
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
  // Filter: alle / gelöst / ungelöst. Liefert die passenden Rätselnummern absteigend.
  const solvedState = (key, n) => { const st = store.get(key(n), null); return !!(st && st.done && st.won); };
  function puzzleList(key, filter) {
    const max = maxPuzzle();
    const all = Array.from({ length: max }, (_, i) => max - i);
    if (filter === 'solved') return all.filter(n => solvedState(key, n));
    if (filter === 'open') return all.filter(n => !solvedState(key, n));
    return all;
  }
  function fillPicker(sel, current, key, filter) {
    const list = puzzleList(key, filter);
    if (!list.includes(current)) list.push(current), list.sort((a, b) => b - a);
    sel.innerHTML = list.map(n => `<option value="${n}"${n === current ? ' selected' : ''}>#${n}</option>`).join('');
    return list;
  }
  // Nachbar in der gefilterten Liste (Liste ist absteigend)
  const neighbour = (list, current, dir) => dir < 0
    ? list.filter(n => n < current)[0]
    : list.filter(n => n > current).slice(-1)[0];
  const filters = { daily: store.get('dailyFilter', 'all'), rankle: store.get('rankleFilter', 'all'), flag: store.get('flagFilter', 'all') };
  $('#daily-filter').value = filters.daily; $('#rankle-filter').value = filters.rankle; $('#flag-filter').value = filters.flag;

  $('#daily-prev').addEventListener('click', () => { const n = neighbour(puzzleList(dailyKey, filters.daily), daily.num, -1); if (n) loadDaily(n); });
  $('#daily-next').addEventListener('click', () => { const n = neighbour(puzzleList(dailyKey, filters.daily), daily.num, 1); if (n) loadDaily(n); });
  $('#daily-pick').addEventListener('change', e => loadDaily(+e.target.value));
  $('#daily-filter').addEventListener('change', e => {
    filters.daily = e.target.value; store.set('dailyFilter', filters.daily);
    const list = puzzleList(dailyKey, filters.daily);
    if (list.length && !list.includes(daily.num)) loadDaily(list[0]); else renderDaily();
  });

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
  // Entfernung Grenze zu Grenze aus der vorberechneten Matrix (Natural-Earth-Umrisse),
  // Notfall: Luftlinie zwischen den Landeskoordinaten
  const DIST_IDX = D.distOrder ? Object.fromEntries(D.distOrder.map((k, i) => [k, i])) : null;
  function geo(g, s) {
    if (DIST_IDX && DIST_IDX[g.iso3] != null && DIST_IDX[s.iso3] != null) return { km: D.dist[DIST_IDX[g.iso3]][DIST_IDX[s.iso3]] };
    const R = 6371, toRad = d => d * Math.PI / 180;
    const [la1, lo1] = g.latlng.map(toRad), [la2, lo2] = s.latlng.map(toRad);
    const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
    return { km: 2 * R * Math.asin(Math.sqrt(h)) };
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
    const d = geo(g, s);
    out.distance = g.iso3 === s.iso3
      ? { cls: 'ok', html: '0 km' }
      : { cls: 'miss', html: nf0.format(Math.round(d.km / 10) * 10) + ' km' };
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


  function renderDaily() {
    const isToday = daily.num === maxPuzzle();
    $('#daily-num').textContent = 'Rätsel #' + daily.num;
    $('#daily-sub').textContent = 'Errate das geheime Land in 5 Versuchen.';
    const dl = fillPicker($('#daily-pick'), daily.num, dailyKey, filters.daily);
    $('#daily-prev').disabled = !neighbour(dl, daily.num, -1);
    $('#daily-next').disabled = !neighbour(dl, daily.num, 1);
    const s = daily.secret;
    // Neueste Tipps oben
    $('#guesses').innerHTML = daily.guesses.slice().reverse().map(iso => guessRowHtml(BY_ISO[iso], evalGuess(BY_ISO[iso], s))).join('');
    const input = $('#guess-input'), btn = $('#guess-btn');
    input.disabled = daily.done; btn.disabled = daily.done;
    input.value = '';
    input.placeholder = daily.done ? (daily.won ? 'Gelöst' : 'Nicht gelöst') : 'Tipp eingeben …';
    renderDailyResult();
  }

  function renderDailyResult() {
    const box = $('#daily-result');
    if (!daily.done) { box.hidden = true; return; }
    const s = daily.secret;
    const dList = puzzleList(dailyKey, filters.daily);
    const dPrev = neighbour(dList, daily.num, -1), dNext = neighbour(dList, daily.num, 1);
    const title = daily.won ? `Richtig! ${s.name}` : `Leider nicht. Es war ${s.name}`;
    box.innerHTML = `
      <div class="big-flag">${flagSvg(s)}</div>
      <h2>${esc(title)}</h2>
      <div class="facts">
        <span>${esc(s.en)}</span><span>Hauptstadt: ${esc(s.capital)}</span><span>${esc(s.continent)}</span>
        <span>${fmtCompact(s.stats.pop)} Einwohner</span><span>${nf0.format(s.stats.area)} km²</span>
        ${s.stats.gdppc != null ? `<span>BIP/Kopf ${nf0.format(s.stats.gdppc)} $</span>` : ''}
      </div>
      <div class="actions">
        ${dPrev ? `<button class="ghost" id="btn-daily-prev">‹ Rätsel #${dPrev}</button>` : ''}
        ${dNext ? `<button class="ghost" id="btn-daily-next">Rätsel #${dNext} ›</button>` : ''}
      </div>`;
    box.hidden = false;
    const bp = $('#btn-daily-prev'); if (bp) bp.addEventListener('click', () => { loadDaily(dPrev); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    const bn = $('#btn-daily-next'); if (bn) bn.addEventListener('click', () => { loadDaily(dNext); window.scrollTo({ top: 0, behavior: 'smooth' }); });
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
  const RANKLE_POOL = COUNTRIES.filter(c => c.stats.pop >= MIN_POP && Object.keys(c.ranks || {}).length >= CATS.length - 3);

  const rankle = { num: 0, day: 0, countries: [], cats: [], round: 0, picks: [], used: [] };
  const rankleKey = n => 'rankle.' + n;

  // 8 Länder + 8 Kategorien, sodass jedes Land in genau einer Kategorie das
  // beste der 8 Länder ist (und diese Kategorie zugleich seine beste unter den 8 ist).
  function buildRankle(seed) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const rng = mulberry32(seed + attempt * 7919);
      const picked = [];
      for (const c of shuffled(RANKLE_POOL, rng)) {
        if (picked.length >= ROUNDS) break;
        const used = new Set(picked.map(p => p.cat));
        const cands = CATS.filter(cat => !used.has(cat.key) && c.ranks[cat.key] != null
          // c schlägt alle bisherigen Länder in dieser Kategorie …
          && picked.every(p => { const r = BY_ISO[p.iso3].ranks[cat.key]; return r != null && r > c.ranks[cat.key]; })
          // … und schlägt kein bisheriges Land in dessen eigener Kategorie
          && picked.every(p => { const r = c.ranks[p.cat]; return r != null && r > BY_ISO[p.iso3].ranks[p.cat]; }));
        if (!cands.length) continue;
        cands.sort((x, y) => c.ranks[x.key] - c.ranks[y.key]);
        const k = cands[0].key;
        // Die Kategorie muss zugleich die beste von c unter allen gewählten sein, und für kein bisheriges Land besser als dessen eigene
        if (picked.some(p => c.ranks[p.cat] <= c.ranks[k])) continue;
        if (picked.some(p => BY_ISO[p.iso3].ranks[k] <= BY_ISO[p.iso3].ranks[p.cat])) continue;
        picked.push({ iso3: c.iso3, cat: k });
      }
      if (picked.length === ROUNDS) {
        return { countries: picked.map(p => p.iso3), cats: shuffled(picked.map(p => p.cat), rng) };
      }
    }
    // Notnagel (sollte mit 196 Ländern nie greifen)
    const rng = mulberry32(seed);
    return { countries: shuffled(RANKLE_POOL, rng).slice(0, ROUNDS).map(c => c.iso3), cats: shuffled(CATS, rng).slice(0, ROUNDS).map(c => c.key) };
  }
  const rankleCats = () => rankle.cats.map(k => CAT_BY_KEY[k]).filter(Boolean);
  // Namen für Kategorien, die es nicht mehr gibt (alte Spielstände)
  const LEGACY_CATS = { renew: 'Meiste erneuerbare Energie', forest: 'Höchster Waldanteil', exports: 'Höchste Exporte', obes: 'Meiste Übergewichtige', fert: 'Meiste Kinder pro Frau' };
  const catName = k => CAT_BY_KEY[k] ? CAT_BY_KEY[k].name : (LEGACY_CATS[k] || k);
  function loadRankle(n) {
    n = clampPuzzle(n);
    rankle.num = n; rankle.day = n - 1;
    store.set('rankleLast', n);
    const built = buildRankle(rankle.day * 1000003 + 42);
    rankle.countries = built.countries; rankle.cats = built.cats;
    rankle.round = 0; rankle.picks = []; rankle.used = [];
    let saved = store.get(rankleKey(n), null);
    if (!saved) { const old = store.get('rankle', null); if (old && old.day === rankle.day) saved = old; }
    const finished = saved && saved.picks && saved.picks.length >= ROUNDS;
    const same = saved && JSON.stringify(saved.countries) === JSON.stringify(rankle.countries) && JSON.stringify(saved.cats) === JSON.stringify(rankle.cats);
    if (finished || same) {
      // Ein fertig gespieltes Rätsel bleibt fertig, auch wenn sich Länder oder Kategorien später geändert haben
      if (finished && !same) { rankle.countries = saved.countries; rankle.cats = saved.cats || rankle.cats; }
      rankle.picks = saved.picks; rankle.used = saved.picks.map(p => p.cat);
      rankle.round = saved.picks.length;
    }
    renderRankle();
  }
  function saveRankle() {
    store.set(rankleKey(rankle.num), { day: rankle.day, countries: rankle.countries, cats: rankle.cats, picks: rankle.picks, done: rankle.picks.length >= ROUNDS, won: rankle.picks.length >= ROUNDS });
  }
  $('#rankle-prev').addEventListener('click', () => { const n = neighbour(puzzleList(rankleKey, filters.rankle), rankle.num, -1); if (n) loadRankle(n); });
  $('#rankle-next').addEventListener('click', () => { const n = neighbour(puzzleList(rankleKey, filters.rankle), rankle.num, 1); if (n) loadRankle(n); });
  $('#rankle-pick').addEventListener('change', e => loadRankle(+e.target.value));
  $('#rankle-filter').addEventListener('change', e => {
    filters.rankle = e.target.value; store.set('rankleFilter', filters.rankle);
    const list = puzzleList(rankleKey, filters.rankle);
    if (list.length && !list.includes(rankle.num)) loadRankle(list[0]); else renderRankle();
  });

  // Punkte: Perzentil des gewählten Landes zwischen bestem und schlechtestem der 8 Länder in dieser Kategorie
  function points(c, key) {
    const ranks = rankle.countries.map(i => BY_ISO[i].ranks[key]).filter(r => r != null);
    const best = Math.min(...ranks), worst = Math.max(...ranks), r = c.ranks[key];
    if (r == null) return 0;
    if (r <= best) return 100;
    if (worst === best) return 100;
    return Math.max(0, Math.round(100 * (worst - r) / (worst - best)));
  }
  function ptsClass(p) { return p >= 90 ? 'g' : p >= 50 ? 'y' : 'r'; }
  const total = () => rankle.picks.reduce((a, p) => a + p.pts, 0);

  // Die Kategorie, in der c das beste der 8 Länder ist (Notfall: beste Kategorie von c)
  function bestAvailable(c) {
    let fallback = null;
    for (const cat of rankleCats()) {
      const r = c.ranks[cat.key];
      if (r == null) continue;
      if (rankle.countries.every(i => i === c.iso3 || BY_ISO[i].ranks[cat.key] == null || BY_ISO[i].ranks[cat.key] > r)) return { cat: cat.key, rank: r };
      if (fallback === null || r < fallback.rank) fallback = { cat: cat.key, rank: r };
    }
    return fallback;
  }

  function chooseCategory(key) {
    if (rankle.round >= ROUNDS) return;
    const c = BY_ISO[rankle.countries[rankle.round]];
    const rank = c.ranks[key];
    if (rank == null || rankle.used.includes(key)) return;
    const best = bestAvailable(c);
    const pts = points(c, key);
    rankle.picks.push({ iso3: c.iso3, cat: key, rank, bestCat: best.cat, bestRank: best.rank, pts });
    rankle.used.push(key);
    rankle.round++;
    saveRankle();
    if (rankle.round >= ROUNDS) recordRankleStats();
    toast(`+${pts} · ${catName(key)}: Rang ${rank}`);
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
    $('#rankle-num').textContent = 'Rätsel #' + rankle.num;
    const rl = fillPicker($('#rankle-pick'), rankle.num, rankleKey, filters.rankle);
    $('#rankle-prev').disabled = !neighbour(rl, rankle.num, -1);
    $('#rankle-next').disabled = !neighbour(rl, rankle.num, 1);
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

    $('#cat-grid').innerHTML = rankleCats().map(cat => {
      const used = rankle.used.includes(cat.key);
      return `<button class="cat${used ? ' used' : ''}" data-cat="${cat.key}" ${used ? 'disabled' : ''} title="${esc(cat.desc)}">
        <span class="cn">${esc(cat.name)}</span>
        <span class="cd">${used ? 'bereits benutzt' : esc(cat.desc)}</span></button>`;
    }).join('');
    $$('#cat-grid .cat').forEach(b => b.addEventListener('click', () => chooseCategory(b.dataset.cat)));
  }

  // Langes Drücken auf eine Kategorie zeigt die Definition
  (() => {
    const grid = $('#cat-grid');
    const tip = document.createElement('div');
    tip.className = 'cat-tip'; tip.hidden = true; document.body.appendChild(tip);
    let timer = null, longPressed = false, startX = 0, startY = 0, hideTimer = null;
    function showTip(btn) {
      const cat = CAT_BY_KEY[btn.dataset.cat];
      if (!cat) return;
      tip.textContent = cat.desc; tip.hidden = false;
      const r = btn.getBoundingClientRect();
      const w = Math.min(280, window.innerWidth - 16);
      tip.style.maxWidth = w + 'px';
      let left = Math.min(Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2), window.innerWidth - tip.offsetWidth - 8);
      let top = r.top - tip.offsetHeight - 10;
      if (top < 8) top = r.bottom + 10;
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
      clearTimeout(hideTimer);
    }
    const hideTip = () => { tip.hidden = true; };
    const cancel = () => { clearTimeout(timer); timer = null; };
    grid.addEventListener('pointerdown', e => {
      const b = e.target.closest('.cat');
      if (!b) return;
      longPressed = false; startX = e.clientX; startY = e.clientY;
      cancel();
      timer = setTimeout(() => { longPressed = true; showTip(b); }, 450);
    });
    grid.addEventListener('pointermove', e => {
      if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > 10) cancel();
    });
    const release = () => { cancel(); if (!tip.hidden) hideTimer = setTimeout(hideTip, 1500); };
    grid.addEventListener('pointerup', release);
    grid.addEventListener('pointercancel', release);
    grid.addEventListener('pointerleave', release);
    // Nach langem Drücken keine Auswahl auslösen
    grid.addEventListener('click', e => {
      if (longPressed) { e.preventDefault(); e.stopImmediatePropagation(); longPressed = false; }
    }, true);
    grid.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('scroll', hideTip, { passive: true });
  })();

  function renderRankleResult() {
    const box = $('#rankle-result');
    const rList = puzzleList(rankleKey, filters.rankle);
    const rPrev = neighbour(rList, rankle.num, -1), rNext = neighbour(rList, rankle.num, 1);
    const t = total();
    const verdict = t >= 750 ? 'Weltklasse!' : t >= 600 ? 'Stark!' : t >= 450 ? 'Solide.' : t >= 300 ? 'Ausbaufähig.' : 'Beim nächsten Mal wird’s besser.';
    box.innerHTML = `
      <h2>${t} / ${ROUNDS * 100} Punkte · ${verdict}</h2>
      <div class="rounds-summary">${rankle.picks.map((p, i) => {
        const c = BY_ISO[p.iso3];
        return `<div class="rs"><span class="mini-flag">${flagSvg(c)}</span>
          <div class="rs-body"><strong>${i + 1}. ${esc(c.name)}</strong>${esc(catName(p.cat))} #${p.rank}${p.pts < 100 ? `<br><span class="muted">Beste: ${esc(catName(p.bestCat))} #${p.bestRank}</span>` : ''}</div>
          <span class="rs-pts ${ptsClass(p.pts)}">${p.pts}</span></div>`;
      }).join('')}</div>
      <div class="actions">
        ${rPrev ? `<button class="ghost" id="btn-rankle-prev">‹ Rätsel #${rPrev}</button>` : ''}
        ${rNext ? `<button class="ghost" id="btn-rankle-next">Rätsel #${rNext} ›</button>` : ''}
      </div>`;
    const rp = $('#btn-rankle-prev'); if (rp) rp.addEventListener('click', () => { loadRankle(rPrev); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    const rn = $('#btn-rankle-next'); if (rn) rn.addEventListener('click', () => { loadRankle(rNext); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  }

  // =================================================================
  //  GEOFLAG – 10 Flaggen, je vier Länder zur Auswahl
  // =================================================================
  const FLAG_ROUNDS = 10;
  const FLAG_OPTIONS = 6;
  // Flaggen, auf denen der Landesname steht (Wappen/Schriftband), werden nicht abgefragt
  const FLAG_EXCLUDE = new Set(['DOM', 'SLV', 'NIC', 'PRY', 'BOL', 'EGY', 'BRN']);
  const FLAG_POOL = COUNTRIES.filter(c => c.stats.pop >= MIN_POP && !FLAG_EXCLUDE.has(c.iso3));
  const flagKey = n => 'flag.' + n;
  const flag = { num: 0, day: 0, countries: [], options: [], answers: [], round: 0, locked: false };

  function buildFlag(seed) {
    const rng = mulberry32(seed * 31 + 7);
    const picked = shuffled(FLAG_POOL, rng).slice(0, FLAG_ROUNDS);
    const options = picked.map(c => {
      // Ablenker: gleicher Kontinent und gemeinsame Flaggenfarben bevorzugt, sonst gleicher Kontinent, sonst beliebig
      const others = COUNTRIES.filter(o => o.iso3 !== c.iso3);
      const score = o => (o.continent === c.continent ? 2 : 0) + (o.colors.filter(x => c.colors.includes(x)).length >= Math.min(2, c.colors.length) ? 1 : 0);
      const ranked = shuffled(others, rng).sort((a, b) => score(b) - score(a));
      return shuffled([c.iso3, ...ranked.slice(0, FLAG_OPTIONS - 1).map(o => o.iso3)], rng);
    });
    return { countries: picked.map(c => c.iso3), options };
  }
  function loadFlag(n) {
    n = clampPuzzle(n);
    flag.num = n; flag.day = n - 1;
    store.set('flagLast', n);
    const built = buildFlag(flag.day);
    flag.countries = built.countries; flag.options = built.options;
    flag.answers = []; flag.round = 0; flag.locked = false;
    const saved = store.get(flagKey(n), null);
    const finished = saved && saved.answers && saved.answers.length >= FLAG_ROUNDS;
    const same = saved && JSON.stringify(saved.countries) === JSON.stringify(flag.countries);
    if (finished || same) {
      if (finished && !same) { flag.countries = saved.countries; flag.options = saved.options || flag.options; }
      flag.answers = saved.answers; flag.round = saved.answers.length;
    }
    renderFlag();
  }
  function saveFlag() {
    const done = flag.answers.length >= FLAG_ROUNDS;
    store.set(flagKey(flag.num), { day: flag.day, countries: flag.countries, options: flag.options, answers: flag.answers, done, won: done });
  }
  const flagScore = () => flag.answers.filter((a, i) => a === flag.countries[i]).length;

  $('#flag-prev').addEventListener('click', () => { const n = neighbour(puzzleList(flagKey, filters.flag), flag.num, -1); if (n) loadFlag(n); });
  $('#flag-next').addEventListener('click', () => { const n = neighbour(puzzleList(flagKey, filters.flag), flag.num, 1); if (n) loadFlag(n); });
  $('#flag-pick').addEventListener('change', e => loadFlag(+e.target.value));
  $('#flag-filter').addEventListener('change', e => {
    filters.flag = e.target.value; store.set('flagFilter', filters.flag);
    const list = puzzleList(flagKey, filters.flag);
    if (list.length && !list.includes(flag.num)) loadFlag(list[0]); else renderFlag();
  });

  function answerFlag(iso) {
    if (flag.locked || flag.round >= FLAG_ROUNDS) return;
    flag.locked = true;
    const correct = flag.countries[flag.round];
    flag.answers.push(iso);
    saveFlag();
    $$('#flag-answers .ans').forEach(b => {
      b.disabled = true;
      if (b.dataset.iso === correct) b.classList.add('right');
      else if (b.dataset.iso === iso) b.classList.add('wrong');
      else b.classList.add('dim');
    });
    $('#flag-score').textContent = flagScore();
    if (flag.answers.length >= FLAG_ROUNDS) recordFlagStats();
    setTimeout(() => { flag.round++; flag.locked = false; renderFlag(); }, iso === correct ? 600 : 1200);
  }
  function recordFlagStats() {
    const st = store.get('flagStats', { games: 0, sum: 0, best: 0, lastDay: null, streak: 0, maxStreak: 0, done: {} });
    st.done = st.done || {};
    if (st.done[flag.num]) return;
    st.done[flag.num] = 1;
    const t = flagScore();
    st.games++; st.sum += t; st.best = Math.max(st.best, t);
    if (flag.num === maxPuzzle() && st.lastDay !== flag.day) {
      st.streak = st.lastDay === flag.day - 1 ? st.streak + 1 : 1;
      st.maxStreak = Math.max(st.maxStreak, st.streak);
      st.lastDay = flag.day;
    }
    store.set('flagStats', st);
  }

  function renderFlag() {
    $('#flag-num').textContent = 'Rätsel #' + flag.num;
    const fl = fillPicker($('#flag-pick'), flag.num, flagKey, filters.flag);
    $('#flag-prev').disabled = !neighbour(fl, flag.num, -1);
    $('#flag-next').disabled = !neighbour(fl, flag.num, 1);
    $('#flag-score').textContent = flagScore();
    $('#flag-rounds').innerHTML = Array.from({ length: FLAG_ROUNDS }, (_, i) => {
      const a = flag.answers[i];
      const cls = a != null ? (a === flag.countries[i] ? 'g' : 'r') : (i === flag.round ? 'cur' : '');
      return `<div class="round-dot ${cls}" title="Runde ${i + 1}">${a != null ? (a === flag.countries[i] ? '✓' : '✗') : i + 1}</div>`;
    }).join('');

    const finished = flag.round >= FLAG_ROUNDS;
    $('#flag-board').hidden = finished;
    $('#flag-result').hidden = !finished;
    if (finished) { renderFlagResult(); return; }

    const c = BY_ISO[flag.countries[flag.round]];
    $('#flag-quiz-wrap').innerHTML = flagSvg(c);
    $('#flag-quiz-title').textContent = 'Runde ' + (flag.round + 1);
    $('#flag-quiz-sub').textContent = 'Welches Land ist das?';
    $('#flag-answers').innerHTML = flag.options[flag.round].map(iso =>
      `<button class="ans" data-iso="${iso}">${esc(BY_ISO[iso].name)}</button>`).join('');
    $$('#flag-answers .ans').forEach(b => b.addEventListener('click', () => answerFlag(b.dataset.iso)));
  }
  function renderFlagResult() {
    const box = $('#flag-result');
    const t = flagScore();
    const list = puzzleList(flagKey, filters.flag);
    const fPrev = neighbour(list, flag.num, -1), fNext = neighbour(list, flag.num, 1);
    const verdict = t === 10 ? 'Perfekt!' : t >= 8 ? 'Stark!' : t >= 6 ? 'Solide.' : t >= 4 ? 'Ausbaufähig.' : 'Beim nächsten Mal wird’s besser.';
    box.innerHTML = `
      <h2>${t} / ${FLAG_ROUNDS} richtig · ${verdict}</h2>
      <div class="rounds-summary">${flag.countries.map((iso, i) => {
        const c = BY_ISO[iso], a = flag.answers[i], ok = a === iso;
        return `<div class="fr"><span class="mini-flag">${flagSvg(c)}</span>
          <div class="fr-body"><strong>${i + 1}. ${esc(c.name)}</strong>${ok ? 'richtig' : 'Dein Tipp: ' + esc(BY_ISO[a] ? BY_ISO[a].name : '–')}</div>
          <span class="fr-mark ${ok ? 'g' : 'r'}">${ok ? '✓' : '✗'}</span></div>`;
      }).join('')}</div>
      <div class="actions">
        ${fPrev ? `<button class="ghost" id="btn-flag-prev">‹ Rätsel #${fPrev}</button>` : ''}
        ${fNext ? `<button class="ghost" id="btn-flag-next">Rätsel #${fNext} ›</button>` : ''}
      </div>`;
    const fp = $('#btn-flag-prev'); if (fp) fp.addEventListener('click', () => { loadFlag(fPrev); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    const fn = $('#btn-flag-next'); if (fn) fn.addEventListener('click', () => { loadFlag(fNext); window.scrollTo({ top: 0, behavior: 'smooth' }); });
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
      el.innerHTML = `<h2>GeoFind – Statistik</h2>
        <div class="stat-grid">
          <div><strong>${st.played}</strong><span>gespielt</span></div>
          <div><strong>${st.played ? Math.round(100 * st.wins / st.played) : 0}%</strong><span>gelöst</span></div>
          <div><strong>${st.streak}</strong><span>Serie</span></div>
          <div><strong>${st.maxStreak}</strong><span>beste Serie</span></div>
        </div>
        <h2>Verteilung der Versuche</h2>
        <div class="dist">${[1, 2, 3, 4, 5].map(n => `<span>${n}</span><div class="bar${n === hl ? ' hl' : ''}" style="width:${Math.max(7, 100 * (st.dist[n] || 0) / maxD)}%">${st.dist[n] || 0}</div>`).join('')}</div>`;
    } else if (view === 'flag') {
      const st = store.get('flagStats', { games: 0, sum: 0, best: 0, streak: 0, maxStreak: 0 });
      el.innerHTML = `<h2>GeoFlag – Statistik</h2>
        <div class="stat-grid">
          <div><strong>${st.games}</strong><span>Spiele</span></div>
          <div><strong>${st.games ? (st.sum / st.games).toFixed(1) : 0}</strong><span>Ø richtig</span></div>
          <div><strong>${st.best}</strong><span>Bestwert</span></div>
          <div><strong>${st.streak}</strong><span>Serie</span></div>
        </div>
        <p class="muted">Die Serie zählt nur, wenn du das Rätsel des Tages am selben Tag spielst.</p>`;
    } else {
      const st = store.get('rankleStats', { games: 0, sum: 0, best: 0, streak: 0, maxStreak: 0 });
      el.innerHTML = `<h2>GeoRank – Statistik</h2>
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
  loadDaily(store.get('dailyLast', null) || undefined);
  loadRankle(store.get('rankleLast', null) || undefined);
  loadFlag(store.get('flagLast', null) || undefined);
  setView(location.hash === '#rankle' ? 'rankle' : location.hash === '#flag' ? 'flag' : 'daily');

  // Tageswechsel bei offener Seite erkennen: neues Rätsel in die Auswahl aufnehmen
  let knownMax = maxPuzzle();
  setInterval(() => {
    if (maxPuzzle() !== knownMax) {
      knownMax = maxPuzzle();
      renderDaily(); renderRankle(); renderFlag();
      toast('Ein neuer Tag, ein neues Rätsel #' + knownMax + '!');
    }
  }, 30000);
})();
