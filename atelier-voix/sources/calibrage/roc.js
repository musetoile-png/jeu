// Pour chaque syllabe : rapport distance(ton attendu) / distance(meilleur ton). Natifs = à accepter ; contrôle inverse = à refuser.
const fs = require('fs');
const M = require('/home/claude/atelier-voix/moteur-voix.js');
const corpus = JSON.parse(fs.readFileSync('corpus.json', 'utf8'));
const avecRegistre = process.argv.includes('--registre');
// Hauteur moyenne par voix (comme l'atelier l'apprend après 3 enregistrements)
const voixDe = f => (/_([fm])\.f32$/.exec(f) || [null, null])[1];
const registre = {};
if (avecRegistre) {
  const parVoix = {};
  for (const x of corpus) {
    const v = voixDe(x.pcm); if (!v) continue;
    const buf = fs.readFileSync(x.pcm);
    const { trames } = M._interne.extraireTrames(M._interne.reechantillonner(Float32Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4)), 16000));
    const f = trames.filter(t => t.voisee).map(t => t.f0).sort((a, b) => a - b);
    if (f.length) (parVoix[v] = parVoix[v] || []).push(f[Math.floor(f.length / 2)]);
  }
  for (const [v, l] of Object.entries(parVoix)) { l.sort((a, b) => a - b); registre[v] = l[Math.floor(l.length / 2)]; }
  console.log('registres', registre);
}
const rapport = (s) => {
  if (!s.distances || s.verdict === 'neutre' || s.verdict === 'inaudible') return null;
  const base = s.tonAttendu === '3b' ? '3' : s.tonAttendu;
  const acc = base === '3' ? ['3', '3r'] : [base];
  const dA = Math.min(...acc.filter(k => k in s.distances).map(k => s.distances[k]));
  const dMin = Math.min(...Object.values(s.distances));
  return dA / Math.max(dMin, 0.05);
};
let g = 12345; const alea = () => { g = (g * 16807) % 2147483647; return g / 2147483647; };
const nat = [], neg = []; let natInaud = 0, natTot = 0;
for (const x of corpus) {
  let p; try { p = M.preparerPhrase(x); } catch (e) { continue; }
  const buf = fs.readFileSync(x.pcm);
  const sig = Float32Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4));
  const opt = { registreHz: registre[voixDe(x.pcm)] };
  const r = M.analyser(sig, 16000, p, opt);
  if (!r.ok) continue;
  for (const s of r.syllabes) { if (s.verdict === 'neutre') continue; natTot++; const q = rapport(s); if (q === null) natInaud++; else nat.push(q); }
  const faux = x.pinyin.split(' ').map(t => { const m = /^(.*?)([1-5])$/.exec(t); if (!m || m[2] === '5' || alea() < 0.5) return t; const c = ['1', '2', '3', '4'].filter(z => z !== m[2]); return m[1] + c[Math.floor(alea() * 3)]; }).join(' ');
  if (faux === x.pinyin) continue;
  let pf; try { pf = M.preparerPhrase({ hanzi: x.hanzi, pinyin: faux }); } catch (e) { continue; }
  const rf = M.analyser(sig, 16000, pf, opt);
  if (!rf.ok) continue;
  const b3 = t => (t === '3b' ? '3' : t);
  rf.syllabes.forEach((s, i) => {
    const a = p.syllabes[i].surface, b = pf.syllabes[i].surface;
    if (a === '5' || b === '5' || b3(a) === b3(b)) return;
    const q = rapport(s); if (q !== null) neg.push(q);
  });
}
console.log('natifs notés', natTot, '| inaudibles', (100 * natInaud / natTot).toFixed(1) + '%');
for (const tau of [1, 1.1, 1.2, 1.3, 1.5, 1.75, 2]) {
  const tpr = nat.filter(q => q <= tau + 1e-9).length / natTot;
  const far = neg.filter(q => q <= tau + 1e-9).length / neg.length;
  console.log('tolérance ' + tau.toFixed(2) + ' : natifs acceptés ' + (100 * tpr).toFixed(1) + '% | faux tons acceptés ' + (100 * far).toFixed(1) + '%');
}
