// Exporte les traits de chaque syllabe (voix natives et vrais faux tons) pour entraîner le classifieur.
const fs = require('fs');
const M = require('/home/claude/atelier-voix/moteur-voix.js');
const corpus = JSON.parse(fs.readFileSync('corpus.json', 'utf8'));
const faux = JSON.parse(fs.readFileSync(process.argv[2] || 'faux.json', 'utf8'));
const parNom = {}; for (const x of corpus) parNom[x.pcm] = x;
const lire = f => { const b = fs.readFileSync(f); return Float32Array.from(new Float32Array(b.buffer, b.byteOffset, b.length / 4)); };
const groupe = f => (/_f\.f32$/.test(f) ? 'f' : /_m\.f32$/.test(f) ? 'm' : 'pnj');
const autreVoix = f => (/_f\.f32$/.test(f) ? f.replace('_f.f32', '_m.f32') : /_m\.f32$/.test(f) ? f.replace('_m.f32', '_f.f32') : null);
const base = t => Number(t === '3b' ? '3' : t);
const lignes = [];
const cache = {};
const modeleDe = (f, p) => { const a = autreVoix(f); if (!a || !parNom[a]) return null; return cache[a] || (cache[a] = M.preparerModele(lire(a), 16000, p)); };
function sortir(r, ens, x, mode, attendus, changes) {
  if (!r.ok) return;
  r.syllabes.forEach((s, k) => {
    if (!s.traits || s.tonAttendu === '5') return;
    lignes.push({ ens, grp: groupe(x.pcm), fichier: x.pcm, mode, k, attendu: base(attendus[k]), reel: changes && changes.has(k) ? Number(changes.get(k)) : base(attendus[k]),
      change: !!(changes && changes.has(k)), regles: s.verdict, traits: s.traits.map(v => Math.round(v * 1000) / 1000) });
  });
}
for (const x of corpus) {
  let p; try { p = M.preparerPhrase(x); } catch (e) { continue; }
  const sig = lire(x.pcm), att = p.syllabes.map(s => s.surface);
  sortir(M.analyser(sig, 16000, p), 'natif', x, 'seul', att);
  const mo = modeleDe(x.pcm, p);
  if (mo) sortir(M.analyser(sig, 16000, p, { modele: mo, jugement: 'modele' }), 'natif', x, 'modele', att);
}
for (const f of faux) {
  const x = parNom[f.pcm], p = M.preparerPhrase(x), att = p.syllabes.map(s => s.surface);
  const ch = new Map(f.changes.map(c => [c.k, c.faux]));
  const sigF = lire(f.faux), sigR = lire(f.resyn), mo = modeleDe(f.pcm, p);
  sortir(M.analyser(sigF, 16000, p), 'faux', x, 'seul', att, ch);
  sortir(M.analyser(sigR, 16000, p), 'resyn', x, 'seul', att);
  if (mo) {
    sortir(M.analyser(sigF, 16000, p, { modele: mo, jugement: 'modele' }), 'faux', x, 'modele', att, ch);
    sortir(M.analyser(sigR, 16000, p, { modele: mo, jugement: 'modele' }), 'resyn', x, 'modele', att);
  }
}
fs.writeFileSync(process.argv[3] || 'traits.json', JSON.stringify(lignes));
const c = {}; for (const l of lignes) { const k = l.ens + '/' + l.mode + '/' + l.grp; c[k] = (c[k] || 0) + 1; }
console.log(lignes.length, 'syllabes', JSON.stringify(c));
