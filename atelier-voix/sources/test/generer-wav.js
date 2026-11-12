// Écrit un fichier WAV de synthèse : node test/generer-wav.js "少放盐。" "shao3 fang4 yan2" sortie.wav [tons prononcés]
const fs = require('fs');
const M = require('../moteur-voix.js');
const { synthese, SR } = require('./synthese.js');
const [hanzi, pinyin, sortie, prononce] = process.argv.slice(2);
const phrase = M.preparerPhrase({ hanzi, pinyin });
const dits = prononce ? prononce.split(' ') : null;
const syl = phrase.syllabes.map((s, i) => ({ forme: dits ? dits[i] : s.surface, consonne: /^(s|sh|x|f|h|c|ch|q|k|t|p|z|zh|j)/.test(s.p) }));
let sig = synthese(syl, { baseHz: 150, bruit: 0.002 });
const fin = new Float32Array(sig.length + SR * 2.5);
fin.set(sig);
for (let i = sig.length; i < fin.length; i++) fin[i] = (Math.random() * 2 - 1) * 0.002;
const n = fin.length, buf = Buffer.alloc(44 + n * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(fin[i] * 32767))), 44 + i * 2);
fs.writeFileSync(sortie, buf);
console.log('écrit', sortie, (n / SR).toFixed(2) + ' s');
