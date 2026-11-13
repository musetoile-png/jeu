// Passe les enregistrements d'un locuteur AISHELL dans le moteur (découpage seul) et exporte chaque syllabe.
// node aishell-extraire.js phrases.json dossier_wav N sortie.jsonl locuteur sexe
const fs = require('fs'), path = require('path');
const M = require(process.env.MOTEUR || '/home/claude/atelier-voix/moteur-voix.js');
const [phrasesF, dir, N, sortie, loc, sexe] = process.argv.slice(2);
const phrases = JSON.parse(fs.readFileSync(phrasesF, 'utf8'));
function lireWav(f) {
  const b = fs.readFileSync(f); let o = 12, sr = 16000, data = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), n = b.readUInt32LE(o + 4);
    if (id === 'fmt ') sr = b.readUInt32LE(o + 12);
    if (id === 'data') { data = b.subarray(o + 8, Math.min(b.length, o + 8 + n)); break; }
    o += 8 + n + (n & 1);
  }
  const x = new Float32Array(data.length >> 1);
  for (let i = 0; i < x.length; i++) x[i] = data.readInt16LE(2 * i) / 32768;
  return { x, sr };
}
const fichiers = []; (function parcourir(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) parcourir(p); else if (/\.wav$/.test(e.name)) fichiers.push(p); } })(dir);
let g = 12345; const alea = () => { g = (g * 16807) % 2147483647; return g / 2147483647; };
fichiers.sort(); for (let i = fichiers.length - 1; i > 0; i--) { const j = Math.floor(alea() * (i + 1)); [fichiers[i], fichiers[j]] = [fichiers[j], fichiers[i]]; }
const b = t => (t === '3b' ? '3' : String(t));
let pris = 0, lignes = [];
for (const f of fichiers) {
  if (pris >= Number(N)) break;
  const uid = path.basename(f, '.wav'), ph = phrases[uid]; if (!ph) continue;
  let p; try { p = M.preparerPhrase(ph); } catch (e) { continue; }
  const { x, sr } = lireWav(f);
  const r = M.analyser(x, sr, p); if (!r.ok) continue;
  pris++;
  r.syllabes.forEach((s, k) => {
    const sy = p.syllabes[k];
    if (sy.surface === '5' || !s.contour || !s.traits) return;
    lignes.push(JSON.stringify({ loc, sexe, uid, k, n: p.syllabes.length, p: sy.p, att: Number(b(sy.surface)), pos: s.position,
      regles: s.verdict, q: s.qualite ? s.qualite.map(v => Math.round(v * 1000) / 1000) : null, traits: s.traits.slice(0, 16).map(v => Math.round(v * 1000) / 1000) }));
  });
}
fs.appendFileSync(sortie, lignes.length ? lignes.join('\n') + '\n' : '');
console.log(loc, sexe, pris, 'phrases', lignes.length, 'syllabes');
