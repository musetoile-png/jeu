// Pour chaque enregistrement : frontières des syllabes posées par le module + courbe de hauteur et de volume (une valeur par 10 ms).
// node bornes.js travaux.json sortie.jsonl     travaux = [{id, audio (.wav ou .f32), hanzi, pinyin, modele (.f32 ou null), change: {k: ton réel}, extra}]
const fs = require('fs');
const M = require(process.env.MOTEUR || '/home/claude/calibrage/moteur-exp.js');
const [travauxF, sortie] = process.argv.slice(2);
function lire(f) {
  const b = fs.readFileSync(f);
  if (f.endsWith('.f32')) return Float32Array.from(new Float32Array(b.buffer, b.byteOffset, b.length / 4));
  let o = 12, data = null;
  while (o + 8 <= b.length) { const id = b.toString('ascii', o, o + 4), n = b.readUInt32LE(o + 4); if (id === 'data') { data = b.subarray(o + 8, Math.min(b.length, o + 8 + n)); break; } o += 8 + n + (n & 1); }
  const x = new Float32Array(data.length >> 1); for (let i = 0; i < x.length; i++) x[i] = data.readInt16LE(2 * i) / 32768; return x;
}
const b3 = t => (t === '3b' ? 3 : Number(t));
const cache = {}, out = [];
for (const j of JSON.parse(fs.readFileSync(travauxF, 'utf8'))) {
  let p; try { p = M.preparerPhrase(j); } catch (e) { continue; }
  let opts = {};
  if (j.modele) { const mo = cache[j.modele + j.pinyin] || (cache[j.modele + j.pinyin] = M.preparerModele(lire(j.modele), 16000, p)); if (!mo) continue; opts = { modele: mo, jugement: 'modele' }; }
  const r = M.analyser(lire(j.audio), 16000, p, opts); if (!r.ok) continue;
  const syll = r.syllabes.map((s, k) => ({ k, p: p.syllabes[k].p, att: b3(p.syllabes[k].surface), reel: j.change && j.change[k] ? b3(j.change[k]) : b3(p.syllabes[k].surface),
    change: !!(j.change && j.change[k]), pos: (k === p.syllabes.length - 1 || p.syllabes[k].pauseApres) ? 'fin' : 'mil', debut: s.debut, fin: s.fin, verdict: s.verdict }));
  out.push(JSON.stringify({ id: j.id, ...(j.extra || {}), audio: j.audio, syll, t0: r.courbe[0].t, st: r.courbe.map(c => c.st === null ? null : Math.round(c.st * 100) / 100), db: r.courbe.map(c => Math.round(c.db * 10) / 10) }));
}
fs.appendFileSync(sortie, out.length ? out.join('\n') + '\n' : '');
console.log(out.length, 'enregistrements');
