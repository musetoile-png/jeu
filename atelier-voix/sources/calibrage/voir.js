const fs = require('fs');
const M = require('/home/claude/atelier-voix/moteur-voix.js');
const corpus = JSON.parse(fs.readFileSync('corpus.json', 'utf8'));
const nom = process.argv[2];
const x = corpus.find(c => c.pcm.includes(nom));
const buf = fs.readFileSync(x.pcm);
const sig = Float32Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4));
const { trames, seuilParole, seuilVoix } = M._interne.extraireTrames(sig);
console.log(x.hanzi, x.pinyin, 'durée', (sig.length / 16000).toFixed(2), 's seuils', seuilParole.toFixed(4), seuilVoix.toFixed(4));
let ligne = '';
trames.forEach((t, i) => {
  if (i % 2) return;
  const db = 20 * Math.log10(t.rms + 1e-7);
  ligne += (t.voisee ? Math.round(t.f0) : (t.rms > seuilParole ? '·' : ' ')) .toString().padStart(4) + (i % 40 === 38 ? '\n' : '');
});
console.log(ligne);
const r = M.analyser(sig, 16000, M.preparerPhrase(x));
console.log(r.syllabes.map(s => s.h + ' ' + s.debut.toFixed(2) + '-' + s.fin.toFixed(2) + ' ' + s.tonAttendu + '>' + s.entendu + ' ' + s.verdict + ' ' + (s.contour ? s.contour.map(v => v.toFixed(1)).join(',') : '')).join('\n'));
