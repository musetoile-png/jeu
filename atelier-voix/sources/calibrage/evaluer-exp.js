// Natifs (paire f/m, chacune modèle de l'autre) : % justes ; faux tons greffés : % acceptés à tort. Moteur choisi par MOTEUR.
const fs = require('fs');
const M = require(process.env.MOTEUR || '/home/claude/calibrage/moteur-exp.js');
const corpus = JSON.parse(fs.readFileSync('corpus.json', 'utf8'));
const faux = JSON.parse(fs.readFileSync('faux-greffe.json', 'utf8'));
const parNom = {}; for (const x of corpus) parNom[x.pcm] = x;
const lire = f => { const b = fs.readFileSync(f); return Float32Array.from(new Float32Array(b.buffer, b.byteOffset, b.length / 4)); };
const autre = f => /_f\.f32$/.test(f) ? f.replace('_f.f32', '_m.f32') : /_m\.f32$/.test(f) ? f.replace('_m.f32', '_f.f32') : null;
const cache = {};
const modeleDe = (f, p) => { const a = autre(f); if (!a || !parNom[a]) return null; return cache[a + p.pinyin] || (cache[a + p.pinyin] = M.preparerModele(lire(a), 16000, p)); };
const R = { seul: { t: 0, j: 0, c: 0, cj: 0, i: 0 }, modele: { t: 0, j: 0, c: 0, cj: 0, i: 0 } };
for (const x of corpus) {
  let p; try { p = M.preparerPhrase(x); } catch (e) { continue; }
  const mo = modeleDe(x.pcm, p); if (!mo) continue;
  const sig = lire(x.pcm);
  for (const mode of ['seul', 'modele']) {
    const r = M.analyser(sig, 16000, p, mode === 'seul' ? {} : { modele: mo, jugement: 'modele' });
    if (r.ok) r.syllabes.forEach(s => { if (s.verdict === 'neutre') return; R[mode].t++; if (s.verdict === 'juste') R[mode].j++; if (s.verdict === 'inaudible') R[mode].i++; });
  }
}
for (const f of faux) {
  const x = parNom[f.pcm], p = M.preparerPhrase(x), mo = modeleDe(f.pcm, p); if (!mo) continue;
  const ch = new Set(f.changes.map(c => c.k)), sig = lire(f.faux);
  for (const mode of ['seul', 'modele']) {
    const r = M.analyser(sig, 16000, p, mode === 'seul' ? {} : { modele: mo, jugement: 'modele' });
    if (r.ok) r.syllabes.forEach((s, k) => { if (!ch.has(k) || s.verdict === 'neutre') return; R[mode].c++; if (s.verdict === 'juste') R[mode].cj++; });
  }
}
const pc = (a, b) => (100 * a / b).toFixed(1) + '%';
const tag = process.argv[2] || '';
for (const m of ['seul', 'modele']) console.log(tag.padEnd(14), m.padEnd(7), 'natifs justes', pc(R[m].j, R[m].t), '| inaudibles', pc(R[m].i, R[m].t), '| faux acceptés', pc(R[m].cj, R[m].c), '(' + R[m].c + ')');
