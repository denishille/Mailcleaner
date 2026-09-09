#!/usr/bin/env node
// Kürzester Abstand zwischen den Landesumrissen aller Länderpaare (Grenze zu Grenze).
// Quelle: Natural Earth 1:50m admin_0_countries (GeoJSON).
//   node tools/build_distances.js ne_50m_admin_0_countries.geojson data.js tools/distances.json
'use strict';
const fs = require('fs');
const [geoPath, dataPath, outPath] = process.argv.slice(2);
const w = {}; eval(fs.readFileSync(dataPath, 'utf8').replace('window.GEO_DATA', 'w.D'));
const countries = w.D.countries;
const ISO = countries.map(c => c.iso3);
const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));

// Natural-Earth-Codes auf unsere ISO3 abbilden; Gebiete ohne eigenen Staat dem Staat zuschlagen
const MAP = { KOS: 'UNK', SDS: 'SSD', CYN: 'CYP', SOL: 'SOM' };
const SKIP = new Set(['PSX', 'SAH', 'KAS', 'ATC', 'IOA', 'ATA']);
const R = 6371;
const toXYZ = (lon, lat) => { const p = lat * Math.PI / 180, l = lon * Math.PI / 180; return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]; };
const chordToKm = d => 2 * R * Math.asin(Math.min(1, d / 2));
const MIN_SPACING = 8; // km zwischen behaltenen Umrisspunkten

// Punkte je Land sammeln (ausgedünnt)
const pts = {};
for (const f of geo.features) {
  let code = f.properties.ADM0_A3;
  if (SKIP.has(code)) continue;
  code = MAP[code] || code;
  if (!ISO.includes(code)) continue;
  const rings = [];
  const g = f.geometry;
  if (g.type === 'Polygon') rings.push(...g.coordinates);
  else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) rings.push(...poly);
  const arr = pts[code] || (pts[code] = []);
  for (const ring of rings) {
    let last = null;
    for (const [lon, lat] of ring) {
      const v = toXYZ(lon, lat);
      if (last) { const d = Math.hypot(v[0] - last[0], v[1] - last[1], v[2] - last[2]); if (chordToKm(d) < MIN_SPACING) continue; }
      arr.push(v); last = v;
    }
  }
}
const missing = ISO.filter(i => !pts[i]);
// Länder ohne Umriss (Kleinststaaten): Landeskoordinate als einzelner Punkt
for (const i of missing) { const c = countries.find(x => x.iso3 === i); pts[i] = [toXYZ(c.latlng[1], c.latlng[0])]; }
console.error('Umrisse:', ISO.length - missing.length, '| nur Punkt:', missing.join(', ') || '–', '| Punkte gesamt:', Object.values(pts).reduce((a, b) => a + b.length, 0));

const N = ISO.length;
const dist = Array.from({ length: N }, () => new Array(N).fill(0));
const borders = Object.fromEntries(countries.map(c => [c.iso3, new Set(c.borders)]));
for (let a = 0; a < N; a++) {
  const A = pts[ISO[a]];
  for (let b = a + 1; b < N; b++) {
    if (borders[ISO[a]].has(ISO[b])) { dist[a][b] = dist[b][a] = 0; continue; }
    const B = pts[ISO[b]];
    let best = Infinity;
    for (let i = 0; i < A.length; i++) {
      const ax = A[i][0], ay = A[i][1], az = A[i][2];
      for (let j = 0; j < B.length; j++) {
        const dx = ax - B[j][0], dy = ay - B[j][1], dz = az - B[j][2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < best) best = d;
      }
    }
    const km = chordToKm(Math.sqrt(best));
    dist[a][b] = dist[b][a] = Math.round(km);
  }
  if (a % 20 === 0) console.error('…', a, '/', N);
}
fs.writeFileSync(outPath, JSON.stringify({ order: ISO, km: dist }));
console.error('geschrieben:', outPath);
