// Prépare data.json : tracés (makemeahanzi / hanzi-writer-data, licence Arphic) + horaire de chaque trait.
import { readFileSync, writeFileSync } from 'node:fs';
const DATA = new URL('../../node_modules/hanzi-writer-data/', import.meta.url).pathname;
const len = (m) => m.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - m[i][0], p[1] - m[i][1]), 0);
const out = { chars: {}, schedule: [] };
for (const c of '千里之行始于足下') out.chars[c] = JSON.parse(readFileSync(DATA + c + '.json', 'utf8'));
// titre : 千 puis 里, traits lents ; proverbe : rapide
const plan = [
  { c: '千', t0: 1.3, speed: 1500, gap: 0.1 },
  { c: '里', t0: null, speed: 1700, gap: 0.08 },
];
let t = 0;
for (const p of plan) {
  t = p.t0 ?? t + 0.25;
  out.chars[p.c].medians.forEach((m, i) => {
    const d = Math.max(0.22, len(m) / p.speed);
    out.schedule.push({ group: 'title', c: p.c, i, t0: +t.toFixed(3), t1: +(t + d).toFixed(3), L: Math.round(len(m)) });
    t += d + p.gap;
  });
}
out.titleEnd = +t.toFixed(3);
t += 0.9; // le sceau
out.seal = +t.toFixed(3);
t += 0.7;
for (const c of '千里之行始于足下') {
  out.chars[c].medians.forEach((m, i) => {
    const d = Math.max(0.05, len(m) / 7500);
    out.schedule.push({ group: 'proverb', c, i, t0: +t.toFixed(3), t1: +(t + d).toFixed(3), L: Math.round(len(m)) });
    t += d + 0.008;
  });
  t += 0.06;
}
out.proverbEnd = +t.toFixed(3);
writeFileSync('data.json', JSON.stringify(out));
console.log('title end', out.titleEnd, 'seal', out.seal, 'proverb end', out.proverbEnd, 'strokes', out.schedule.length);
