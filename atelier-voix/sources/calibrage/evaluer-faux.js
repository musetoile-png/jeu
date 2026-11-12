// Juge les enregistrements aux tons changés (doivent être refusés) et les syllabes intactes (doivent être acceptées).
const fs = require('fs');
const M = require('/home/claude/atelier-voix/moteur-voix.js');
const corpus = JSON.parse(fs.readFileSync('corpus.json', 'utf8'));
const faux = JSON.parse(fs.readFileSync('faux.json', 'utf8'));
const parNom = {}; for (const x of corpus) parNom[x.pcm] = x;
const lire = f => { const b = fs.readFileSync(f); return Float32Array.from(new Float32Array(b.buffer, b.byteOffset, b.length / 4)); };
const modes = (process.argv[2] || 'seul,gabarits,modele,les_deux').split(',');
const R = {}; for (const m of modes) R[m] = { chg: 0, chgJ: 0, chgP: 0, int: 0, intJ: 0, intP: 0, res: 0, resJ: 0 };
const cacheModele = {};
for (const f of faux) {
  const x = parNom[f.pcm];
  const autre = /_f\.f32$/.test(f.pcm) ? f.pcm.replace('_f.f32', '_m.f32') : f.pcm.replace('_m.f32', '_f.f32');
  const p = M.preparerPhrase(x);
  const modele = cacheModele[autre] || (cacheModele[autre] = M.preparerModele(lire(autre), 16000, p));
  const sigF = lire(f.faux), sigR = lire(f.resyn);
  const changes = new Set(f.changes.map(c => c.k));
  for (const mode of modes) {
    const opt = mode === 'seul' ? {} : { modele, jugement: mode };
    const r = M.analyser(sigF, 16000, p, opt);
    const S = R[mode];
    if (r.ok) r.syllabes.forEach((s, k) => {
      if (s.verdict === 'neutre') return;
      if (changes.has(k)) { S.chg++; if (s.verdict === 'juste') S.chgJ++; if (s.verdict === 'presque') S.chgP++; }
      else { S.int++; if (s.verdict === 'juste') S.intJ++; if (s.verdict === 'presque') S.intP++; }
    });
    const r0 = M.analyser(sigR, 16000, p, opt);
    if (r0.ok) r0.syllabes.forEach(s => { if (s.verdict === 'neutre') return; S.res++; if (s.verdict === 'juste') S.resJ++; });
  }
}
const pc = (a, b) => (100 * a / b).toFixed(1).padStart(5) + '%';
for (const m of modes) {
  const S = R[m];
  console.log(m.padEnd(9), '| tons changés acceptés à tort', pc(S.chgJ, S.chg), '(presque', pc(S.chgP, S.chg) + ')',
    '| syllabes intactes jugées justes', pc(S.intJ, S.int), '| enregistrement intact : justes', pc(S.resJ, S.res));
}
