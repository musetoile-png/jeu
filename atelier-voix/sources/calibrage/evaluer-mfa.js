// Notes avec les frontières du Montreal Forced Aligner, comparées aux règles (seul et voix modèle), mêmes fichiers.
const fs = require('fs');
const M = require('/home/claude/atelier-voix/moteur-voix.js');
const corpus = JSON.parse(fs.readFileSync('corpus.json', 'utf8'));
const greffe = JSON.parse(fs.readFileSync('faux-greffe.json', 'utf8'));
const mots = JSON.parse(fs.readFileSync('mfa-mots.json', 'utf8'));
const parNom = {}; for (const x of corpus) parNom[x.pcm] = x;
const lire = f => { const b = fs.readFileSync(f); return Float32Array.from(new Float32Array(b.buffer, b.byteOffset, b.length / 4)); };
const base = f => f.split('/').pop().replace('.f32', '');
const autre = f => (/_f\.f32$/.test(f) ? f.replace('_f.f32', '_m.f32') : /_m\.f32$/.test(f) ? f.replace('_m.f32', '_f.f32') : null);
const HAN = /[㐀-鿿]/;
function frontieres(cle, hanzi) {
  const w = mots[cle]; if (!w) return null;
  const chars = [...hanzi].filter(c => HAN.test(c));
  const seq = []; for (const [a, b, t] of w) { const cs = [...t].filter(c => HAN.test(c)); cs.forEach((c, k) => seq.push(a + (b - a) * k / cs.length)); }
  if (seq.length !== chars.length) return null;
  return seq.slice(1);
}
const R = {}; const ajoute = (m, cle, ok) => { R[m] = R[m] || {}; R[m][cle] = R[m][cle] || [0, 0]; R[m][cle][0]++; if (ok) R[m][cle][1]++; };
const cache = {}; let sansMfa = 0;
for (const [ens, liste] of [['natif', corpus.filter(x => autre(x.pcm) && parNom[autre(x.pcm)])], ['greffe', greffe]]) {
  for (const it of liste) {
    const x = ens === 'natif' ? it : parNom[it.pcm];
    const fichier = ens === 'natif' ? it.pcm : it.faux;
    const p = M.preparerPhrase(x), sig = lire(fichier);
    const fr = frontieres(ens + '__' + base(fichier), x.hanzi);
    if (!fr) { sansMfa++; continue; }
    const a = autre(x.pcm); const mo = cache[a] || (cache[a] = M.preparerModele(lire(a), 16000, p));
    const chg = ens === 'greffe' ? new Set(it.changes.map(c => c.k)) : new Set();
    const runs = { 'règles seul': {}, 'règles + voix modèle': { modele: mo, jugement: 'modele' }, 'aligneur MFA': { frontieresSec: fr } };
    for (const [nom, opt] of Object.entries(runs)) {
      const r = M.analyser(sig, 16000, p, opt); if (!r.ok) continue;
      r.syllabes.forEach((s, k) => {
        if (s.tonAttendu === '5') return;
        if (ens === 'natif') { ajoute(nom, 'natifs justes', s.verdict === 'juste'); ajoute(nom, 'natifs pas entendus', s.verdict === 'inaudible'); }
        else if (chg.has(k)) ajoute(nom, 'faux tons acceptés', s.verdict === 'juste');
      });
    }
  }
}
console.log('fichiers sans alignement exploitable :', sansMfa);
for (const [nom, t] of Object.entries(R)) console.log(nom.padEnd(22), Object.entries(t).map(([k, [n, ok]]) => k + ' ' + (100 * ok / n).toFixed(1) + '%').join(' | '));
