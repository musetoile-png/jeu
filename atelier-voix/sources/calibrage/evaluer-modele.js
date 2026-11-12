// Voix d'homme jugée avec la voix de femme comme modèle, et inversement. Compare avec le jugement sans modèle.
const fs = require('fs');
const M = require('/home/claude/atelier-voix/moteur-voix.js');
const corpus = JSON.parse(fs.readFileSync('corpus.json', 'utf8'));
const lire = f => { const b = fs.readFileSync(f); return Float32Array.from(new Float32Array(b.buffer, b.byteOffset, b.length / 4)); };
const parNom = {}; for (const x of corpus) parNom[x.pcm] = x;
const paires = corpus.filter(x => /_f\.f32$/.test(x.pcm) && parNom[x.pcm.replace('_f.f32', '_m.f32')])
  .flatMap(x => { const y = parNom[x.pcm.replace('_f.f32', '_m.f32')]; return [[y, x], [x, y]]; });
let g = 777; const alea = () => { g = (g * 16807) % 2147483647; return g / 2147483647; };
const b3 = t => (t === '3b' ? '3' : t);
const res = { seul: { j: 0, p: 0, tot: 0, fa: 0, fp: 0, ftot: 0, scores: [] }, modele: { j: 0, p: 0, tot: 0, fa: 0, fp: 0, ftot: 0, scores: [], echecAlign: 0 } };
const t0 = Date.now();
for (const [joueur, ref] of paires) {
  let p; try { p = M.preparerPhrase(joueur); } catch (e) { continue; }
  const sig = lire(joueur.pcm);
  const modele = M.preparerModele(lire(ref.pcm), 16000, p);
  const faux = joueur.pinyin.split(' ').map(t => { const m = /^(.*?)([1-5])$/.exec(t); if (!m || m[2] === '5' || alea() < 0.5) return t; const c = ['1', '2', '3', '4'].filter(z => z !== m[2]); return m[1] + c[Math.floor(alea() * 3)]; }).join(' ');
  let pf = null; try { if (faux !== joueur.pinyin) pf = M.preparerPhrase({ hanzi: joueur.hanzi, pinyin: faux }); } catch (e) { }
  for (const mode of ['seul', 'modele']) {
    const opt = mode === 'modele' ? { modele, jugement: process.argv[2] || 'modele' } : {};
    const r = M.analyser(sig, 16000, p, opt);
    if (!r.ok) continue;
    if (mode === 'modele' && r.alignement !== 'modele') res.modele.echecAlign++;
    const R = res[mode];
    R.scores.push(r.score);
    for (const s of r.syllabes) { if (s.verdict === 'neutre') continue; R.tot++; if (s.verdict === 'juste') R.j++; if (s.verdict === 'presque') R.p++; }
    if (pf) {
      const rf = M.analyser(sig, 16000, pf, opt);
      if (rf.ok) rf.syllabes.forEach((s, i) => {
        const a = p.syllabes[i].surface, b = pf.syllabes[i].surface;
        if (a === '5' || b === '5' || b3(a) === b3(b)) return;
        R.ftot++; if (s.verdict === 'juste') R.fa++; if (s.verdict === 'presque') R.fp++;
      });
    }
  }
}
for (const [mode, R] of Object.entries(res)) {
  const med = R.scores.slice().sort((a, b) => a - b)[Math.floor(R.scores.length / 2)];
  console.log(mode.padEnd(7), '| phrases', R.scores.length, '| natifs justes', (100 * R.j / R.tot).toFixed(1) + '%', 'presque', (100 * R.p / R.tot).toFixed(1) + '%',
    '| score médian', med + '%', '| ≥80 %', (100 * R.scores.filter(s => s >= 80).length / R.scores.length).toFixed(0) + '%',
    '| faux tons acceptés', (100 * R.fa / R.ftot).toFixed(1) + '%', 'presque', (100 * R.fp / R.ftot).toFixed(1) + '%', R.echecAlign !== undefined ? '| alignements ratés ' + R.echecAlign : '');
}
console.log('temps', ((Date.now() - t0) / 1000).toFixed(0) + ' s pour', paires.length, 'paires');
