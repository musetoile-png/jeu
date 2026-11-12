// Taux de syllabes « pas entendues » selon la consonne initiale (voix natives).
const fs = require('fs');
const M = require(process.argv[2] || '/home/claude/atelier-voix/moteur-voix.js');
const corpus = JSON.parse(fs.readFileSync('corpus.json', 'utf8'));
const g = {};
let shen = [];
for (const x of corpus) {
  let p; try { p = M.preparerPhrase(x); } catch (e) { continue; }
  const b = fs.readFileSync(x.pcm);
  const r = M.analyser(Float32Array.from(new Float32Array(b.buffer, b.byteOffset, b.length / 4)), 16000, p);
  if (!r.ok) continue;
  r.syllabes.forEach((s, k) => {
    if (s.verdict === 'neutre') return;
    const ini = (/^(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])/.exec(p.syllabes[k].p) || ['∅'])[0];
    const sourde = /^(zh|ch|sh|[ptkfhjqxzcs])/.test(ini) ? 'sourde' : 'voisée';
    for (const cle of [ini, sourde]) { g[cle] = g[cle] || [0, 0]; g[cle][0]++; if (s.verdict === 'inaudible') g[cle][1]++; }
    if (s.h === '什') shen.push(s.verdict);
  });
}
const fmt = k => k + ' ' + (100 * g[k][1] / g[k][0]).toFixed(0) + '% (' + g[k][0] + ')';
console.log('consonne sourde :', fmt('sourde'), '| voisée :', fmt('voisée'));
console.log(Object.keys(g).filter(k => k.length <= 2 && g[k][0] >= 30).sort((a, b) => g[b][1] / g[b][0] - g[a][1] / g[a][0]).slice(0, 10).map(fmt).join(' · '));
const c = {}; shen.forEach(v => c[v] = (c[v] || 0) + 1);
console.log('什 :', JSON.stringify(c));
