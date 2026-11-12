// Formes des tons remesurées avec le découpage de l'aligneur (sur les autres voix), puis notes.
const fs = require('fs');
const M = require('/home/claude/atelier-voix/moteur-voix.js');
const corpus = JSON.parse(fs.readFileSync('corpus.json', 'utf8'));
const greffe = JSON.parse(fs.readFileSync('faux-greffe.json', 'utf8'));
const mots = JSON.parse(fs.readFileSync('mfa-mots.json', 'utf8'));
const parNom = {}; for (const x of corpus) parNom[x.pcm] = x;
const lire = f => { const b = fs.readFileSync(f); return Float32Array.from(new Float32Array(b.buffer, b.byteOffset, b.length / 4)); };
const base = f => f.split('/').pop().replace('.f32', '');
const voix = f => (/_f(_greffe)?\.f32$/.test(f) ? 'f' : /_m(_greffe)?\.f32$/.test(f) ? 'm' : 'pnj');
const HAN = /[㐀-鿿]/;
function frontieres(cle, hanzi) {
  const w = mots[cle]; if (!w) return null;
  const n = [...hanzi].filter(c => HAN.test(c)).length, seq = [];
  for (const [a, b, t] of w) { const cs = [...t].filter(c => HAN.test(c)); cs.forEach((c, k) => seq.push(a + (b - a) * k / cs.length)); }
  return seq.length === n ? seq.slice(1) : null;
}
// 1. contours natifs avec le découpage MFA, par voix
const contours = [];
for (const x of corpus) {
  const fr = frontieres('natif__' + base(x.pcm), x.hanzi); if (!fr) continue;
  const p = M.preparerPhrase(x), r = M.analyser(lire(x.pcm), 16000, p, { frontieresSec: fr });
  if (!r.ok) continue;
  r.syllabes.forEach(s => { if (s.contour && s.tonAttendu !== '5') contours.push({ v: voix(x.pcm), ton: s.tonAttendu === '3b' ? '3' : s.tonAttendu, pos: s.position, c: s.contour }); });
}
const med = a => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
function formes(exclue) {
  const jeu = { mil: {}, fin: {} };
  for (const pos of ['mil', 'fin']) for (const ton of ['1', '2', '3', '4']) {
    const l = contours.filter(c => c.v !== exclue && c.pos === pos && c.ton === ton);
    jeu[pos][ton] = l.length ? [0, 1, 2, 3, 4].map(j => med(l.map(c => c.c[j]))) : M.MODELES_PAROLE[pos][ton];
  }
  for (const k of ['3r', '1c', '2c', '4c']) jeu.fin[k] = M.MODELES_PAROLE.fin[k];
  return jeu;
}
const jeux = { f: formes('f'), m: formes('m'), pnj: formes('pnj') };
// 2. notes (formes apprises sans la voix testée)
const R = {}; const ajoute = (cle, ok) => { R[cle] = R[cle] || [0, 0]; R[cle][0]++; if (ok) R[cle][1]++; };
for (const x of corpus) {
  const fr = frontieres('natif__' + base(x.pcm), x.hanzi); if (!fr) continue;
  const r = M.analyser(lire(x.pcm), 16000, M.preparerPhrase(x), { frontieresSec: fr, modelesParole: jeux[voix(x.pcm)] });
  if (r.ok) r.syllabes.forEach(s => { if (s.tonAttendu !== '5') ajoute('natifs justes', s.verdict === 'juste'); });
}
for (const g of greffe) {
  const x = parNom[g.pcm], fr = frontieres('greffe__' + base(g.faux), x.hanzi); if (!fr) continue;
  const chg = new Set(g.changes.map(c => c.k));
  const r = M.analyser(lire(g.faux), 16000, M.preparerPhrase(x), { frontieresSec: fr, modelesParole: jeux[voix(g.pcm)] });
  if (r.ok) r.syllabes.forEach((s, k) => { if (chg.has(k)) ajoute('faux tons acceptés', s.verdict === 'juste'); });
}
console.log('aligneur MFA + formes remesurées :', Object.entries(R).map(([k, [n, ok]]) => k + ' ' + (100 * ok / n).toFixed(1) + '%').join(' | '));
console.log('formes « milieu » remesurées (voix f exclue) :', JSON.stringify(jeux.f.mil));
