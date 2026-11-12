// Passe tout le corpus dans le moteur et résume. node evaluer.js [chemin-moteur]
const fs = require('fs');
const M = require(process.argv[2] || '/home/claude/atelier-voix/moteur-voix.js');
const corpus = JSON.parse(fs.readFileSync('corpus.json', 'utf8'));
const stats = { juste: 0, presque: 0, a_reprendre: 0, inaudible: 0, neutre: 0 };
const confusion = {};
const scores = [];
let echecs = 0, approx = 0;
const details = [];
for (const x of corpus) {
  let phrase;
  try { phrase = M.preparerPhrase(x); } catch (e) { continue; }
  const buf = fs.readFileSync(x.pcm);
  const sig = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  const r = M.analyser(Float32Array.from(sig), 16000, phrase);
  if (!r.ok) { echecs++; continue; }
  if (r.approximatif) approx++;
  scores.push(r.score);
  for (const s of r.syllabes) {
    stats[s.verdict]++;
    if (s.verdict !== 'neutre' && s.entendu) {
      const k = s.tonAttendu + '→' + s.entendu;
      confusion[k] = (confusion[k] || 0) + 1;
    }
  }
  details.push({ f: x.pcm, h: x.hanzi, score: r.score, s: r.syllabes.map(s => s.h + s.tonAttendu + '>' + (s.entendu || '-') + (s.verdict === 'juste' ? '' : '!')).join(' ') });
}
const notes = stats.juste + stats.presque + stats.a_reprendre + stats.inaudible;
console.log('phrases analysées', scores.length, '| échecs', echecs, '| découpage approximatif', approx);
console.log('syllabes notées', notes, '| juste', (100 * stats.juste / notes).toFixed(1) + '%', '| presque', (100 * stats.presque / notes).toFixed(1) + '%', '| à reprendre', (100 * stats.a_reprendre / notes).toFixed(1) + '%', '| inaudible', (100 * stats.inaudible / notes).toFixed(1) + '%');
const med = scores.slice().sort((a, b) => a - b)[Math.floor(scores.length / 2)];
console.log('score médian par phrase', med + '%', '| phrases ≥ 80 %', (100 * scores.filter(s => s >= 80).length / scores.length).toFixed(0) + '%');
const parAttendu = {};
for (const [k, n] of Object.entries(confusion)) { const [a, e] = k.split('→'); (parAttendu[a] = parAttendu[a] || {})[e] = n; }
for (const a of Object.keys(parAttendu).sort()) {
  const tot = Object.values(parAttendu[a]).reduce((s, n) => s + n, 0);
  console.log('  attendu ' + a.padEnd(2) + ' (' + tot + ') → ' + Object.entries(parAttendu[a]).sort((x, y) => y[1] - x[1]).map(([e, n]) => e + ':' + (100 * n / tot).toFixed(0) + '%').join('  '));
}
fs.writeFileSync('details.json', JSON.stringify(details, null, 0));

// ---------- Contrôle inverse : mêmes voix, tons volontairement faux ----------
let graine = 12345;
const alea = () => { graine = (graine * 16807) % 2147483647; return graine / 2147483647; };
let changees = 0, accepteesAtort = 0, presqueAtort = 0;
for (const x of corpus) {
  let vrai;
  try { vrai = M.preparerPhrase(x); } catch (e) { continue; }
  const syl = x.pinyin.split(' ');
  const faux = syl.map(p => {
    const m = /^(.*?)([1-5])$/.exec(p);
    if (!m || m[2] === '5' || alea() < 0.5) return p;
    const choix = ['1', '2', '3', '4'].filter(t => t !== m[2]);
    return m[1] + choix[Math.floor(alea() * 3)];
  }).join(' ');
  if (faux === x.pinyin) continue;
  let pf;
  try { pf = M.preparerPhrase({ hanzi: x.hanzi, pinyin: faux }); } catch (e) { continue; }
  const buf = fs.readFileSync(x.pcm);
  const r = M.analyser(Float32Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4)), 16000, pf);
  if (!r.ok) continue;
  const base3 = t => (t === '3b' ? '3' : t);
  r.syllabes.forEach((s, i) => {
    const a = vrai.syllabes[i].surface, b = pf.syllabes[i].surface;
    if (a === '5' || b === '5' || base3(a) === base3(b)) return;
    changees++;
    if (s.verdict === 'juste') accepteesAtort++;
    if (s.verdict === 'presque') presqueAtort++;
  });
}
console.log('contrôle inverse : ' + changees + ' syllabes au ton faux | jugées justes à tort ' + (100 * accepteesAtort / changees).toFixed(1) + '% | presque ' + (100 * presqueAtort / changees).toFixed(1) + '%');
