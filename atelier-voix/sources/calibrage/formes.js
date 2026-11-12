// Contours moyens par ton attendu (voix natives), avec position dans la phrase.
const fs = require('fs');
const M = require('/home/claude/atelier-voix/moteur-voix.js');
const corpus = JSON.parse(fs.readFileSync('corpus.json', 'utf8'));
const groupes = {};
for (const x of corpus) {
  let phrase; try { phrase = M.preparerPhrase(x); } catch (e) { continue; }
  const buf = fs.readFileSync(x.pcm);
  const r = M.analyser(Float32Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4)), 16000, phrase);
  if (!r.ok) continue;
  r.syllabes.forEach((s, i) => {
    if (!s.contour) return;
    const fin = i === r.syllabes.length - 1 || phrase.syllabes[i].pauseApres;
    for (const cle of [s.tonAttendu, s.tonAttendu + (fin ? '-fin' : '-mil')]) (groupes[cle] = groupes[cle] || []).push(s.contour);
  });
}
const res = {};
for (const [k, v] of Object.entries(groupes).sort()) {
  const moy = [0, 1, 2, 3, 4].map(j => v.reduce((s, c) => s + c[j], 0) / v.length);
  const med = [0, 1, 2, 3, 4].map(j => { const a = v.map(c => c[j]).sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; });
  res[k] = med;
  console.log(k.padEnd(7), String(v.length).padStart(4), 'moy', moy.map(x => x.toFixed(1).padStart(5)).join(''), ' méd', med.map(x => x.toFixed(1).padStart(5)).join(''));
}
fs.writeFileSync('formes.json', JSON.stringify(res));
