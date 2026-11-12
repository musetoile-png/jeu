// Exporte chaque syllabe avec son contour, celui de la voix modèle et son contexte (tons voisins attendus, position).
const fs = require('fs');
const M = require(process.env.MOTEUR || '/home/claude/atelier-voix/moteur-voix.js');
const corpus = JSON.parse(fs.readFileSync('corpus.json', 'utf8'));
const faux = JSON.parse(fs.readFileSync('faux-greffe.json', 'utf8'));
const parNom = {}; for (const x of corpus) parNom[x.pcm] = x;
const lire = f => { const b = fs.readFileSync(f); return Float32Array.from(new Float32Array(b.buffer, b.byteOffset, b.length / 4)); };
const groupe = f => (/_f\.f32$/.test(f) ? 'f' : /_m\.f32$/.test(f) ? 'm' : 'pnj');
const autre = f => /_f\.f32$/.test(f) ? f.replace('_f.f32', '_m.f32') : /_m\.f32$/.test(f) ? f.replace('_m.f32', '_f.f32') : null;
const b = t => (t === '3b' ? '3' : String(t));
const cache = {};
const modeleDe = (f, p) => { const a = autre(f); if (!a || !parNom[a]) return null; return cache[a] || (cache[a] = M.preparerModele(lire(a), 16000, p)); };
const out = [];
function sortir(r, p, x, ens, mode, ch) {
  if (!r.ok) return;
  const n = p.syllabes.length;
  r.syllabes.forEach((s, k) => {
    const sy = p.syllabes[k];
    if (sy.surface === '5' || !s.contour) return;
    const prev = k > 0 && !p.syllabes[k - 1].pauseApres ? b(p.syllabes[k - 1].surface) : '0';
    const next = k < n - 1 && !sy.pauseApres ? b(p.syllabes[k + 1].surface) : '0';
    out.push({ grp: groupe(x.pcm), ens, mode, f: x.pcm, k, n, att: b(sy.surface), reel: ch && ch.has(k) ? b(ch.get(k)) : b(sy.surface), change: !!(ch && ch.has(k)),
      prev, next, pos: (k === n - 1 || sy.pauseApres) ? 'fin' : 'mil', rel: n > 1 ? k / (n - 1) : 1, p: sy.p,
      c: s.contour.map(v => +v.toFixed(3)), q: s.qualite ? s.qualite.map(v => +v.toFixed(3)) : null, cm: s.contourModele ? s.contourModele.map(v => +v.toFixed(3)) : null, verdict: s.verdict });
  });
}
for (const x of corpus) {
  let p; try { p = M.preparerPhrase(x); } catch (e) { continue; }
  const sig = lire(x.pcm);
  sortir(M.analyser(sig, 16000, p), p, x, 'natif', 'seul');
  const mo = modeleDe(x.pcm, p);
  if (mo) sortir(M.analyser(sig, 16000, p, { modele: mo, jugement: 'modele' }), p, x, 'natif', 'modele');
}
for (const fx of faux) {
  const x = parNom[fx.pcm], p = M.preparerPhrase(x), mo = modeleDe(fx.pcm, p);
  const ch = new Map(fx.changes.map(c => [c.k, c.faux])), sig = lire(fx.faux);
  sortir(M.analyser(sig, 16000, p), p, x, 'faux', 'seul', ch);
  if (mo) sortir(M.analyser(sig, 16000, p, { modele: mo, jugement: 'modele' }), p, x, 'faux', 'modele', ch);
}
fs.writeFileSync(process.argv[2] || 'contextes.json', JSON.stringify(out));
console.log(out.length, 'syllabes');
