// Frontières des syllabes des voix natives (découpage guidé par les tons, comme pour une voix modèle).
const fs = require('fs');
const M = require('/home/claude/atelier-voix/moteur-voix.js');
const corpus = JSON.parse(fs.readFileSync('corpus.json', 'utf8'));
const parNom = {}; for (const x of corpus) parNom[x.pcm] = x;
const sortie = [];
for (const x of corpus) {
  const autre = x.pcm.replace(/_f\.f32$/, '_m.f32') === x.pcm ? x.pcm.replace(/_m\.f32$/, '_f.f32') : x.pcm.replace(/_f\.f32$/, '_m.f32');
  if (autre === x.pcm || !parNom[autre]) continue;
  let p; try { p = M.preparerPhrase(x); } catch (e) { continue; }
  const b = fs.readFileSync(x.pcm);
  const m = M.preparerModele(Float32Array.from(new Float32Array(b.buffer, b.byteOffset, b.length / 4)), 16000, p);
  if (!m) continue;
  sortie.push({ pcm: x.pcm, hanzi: x.hanzi, pinyin: x.pinyin, bornes: m.bornes,
    syl: p.syllabes.map((s, k) => ({ surface: s.surface, pos: (k === p.syllabes.length - 1 || s.pauseApres) ? 'fin' : 'mil' })) });
}
fs.writeFileSync('bornes.json', JSON.stringify(sortie));
fs.writeFileSync('gabarits.json', JSON.stringify(M.MODELES_PAROLE));
console.log(sortie.length, 'enregistrements');
