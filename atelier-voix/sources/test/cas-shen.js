// Reproduit « 什么 » prononcé par un apprenant : « sh » long (souffle sans note), « en » court, « me » enchaîné sans silence.
const M = require(process.argv[2] || '../moteur-voix.js');
const SR = 44100;
function voyelle(n, f0de, f0a, phase0) {
  const v = new Float32Array(n); let ph = phase0 || 0;
  for (let i = 0; i < n; i++) {
    const f0 = f0de + (f0a - f0de) * i / n; ph += 2 * Math.PI * f0 / SR;
    let x = 0; for (let h = 1; h * f0 < 3500; h++) x += Math.sin(h * ph) / h;
    v[i] = x * 0.12 * Math.min(1, i / (SR * 0.015), (n - i) / (SR * 0.015) + 0.6);
  }
  return v;
}
function bruit(ms, amp) { const n = Math.round(SR * ms / 1000), v = new Float32Array(n); let s = 9; for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; v[i] = (s / 2147483647 * 2 - 1) * amp; } return v; }
function concat(...m) { const n = m.reduce((s, x) => s + x.length, 0), o = new Float32Array(n); let k = 0; for (const x of m) { o.set(x, k); k += x.length; } return o; }
const base = 130, st = s => base * 2 ** (s / 12);
const cas = [
  ['什么葱 (sh 180 ms, en 110 ms, me enchaîné)', '什么葱？', 'shen2 me5 cong1', [bruit(300, 0.002), bruit(180, 0.05), voyelle(SR * 0.11 | 0, st(-1), st(3)), voyelle(SR * 0.12 | 0, st(2), st(0)), bruit(90, 0.04), voyelle(SR * 0.3 | 0, st(4), st(4)), bruit(500, 0.002)]],
  ['我做什么 (enchaîné)', '我做什么？', 'wo3 zuo4 shen2 me5', [bruit(300, 0.002), voyelle(SR * 0.2 | 0, st(-2), st(-4)), bruit(60, 0.04), voyelle(SR * 0.2 | 0, st(4), st(-1)), bruit(170, 0.05), voyelle(SR * 0.1 | 0, st(-1), st(3)), voyelle(SR * 0.15 | 0, st(2), st(-1)), bruit(500, 0.002)]]
];
for (const [nom, hanzi, pinyin, morceaux] of cas) {
  const r = M.analyser(concat(...morceaux), SR, M.preparerPhrase({ hanzi, pinyin }));
  console.log(nom, '→', r.syllabes.map(s => s.h + ' ' + s.verdict + (s.entendu ? '(' + s.entendu + ')' : '')).join(' | '));
}

// Même chose avec la voix modèle native (version 0.3)
const fs = require('fs');
const { execFileSync } = require('child_process');
function mp3(nom) {
  const brut = execFileSync('ffmpeg', ['-v', 'error', '-i', '/home/claude/jeu/src/public/assets/audio/vo/zh/' + nom + '.mp3', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1e8 });
  return Float32Array.from(new Float32Array(brut.buffer, brut.byteOffset, brut.length / 4));
}
const modeles = { '什么葱？': ['c1_09a_f', 'c1_09a_m'], '我做什么？': ['c1_02a_f', 'c1_02a_m'] };
for (const [nom, hanzi, pinyin, morceaux] of cas) {
  const p = M.preparerPhrase({ hanzi, pinyin });
  for (const v of modeles[hanzi] || []) {
    // la réplique du jeu est « 好。我做什么？» : on ne garde que les phrases de même longueur
    const pm = hanzi === '我做什么？' ? M.preparerPhrase({ hanzi: '好。我做什么？', pinyin: 'hao3 wo3 zuo4 shen2 me5' }) : p;
    if (pm !== p) continue;
    const modele = M.preparerModele(mp3(v), 16000, p);
    const r = M.analyser(concat(...morceaux), SR, p, { modele, jugement: 'modele' });
    console.log('modèle ' + v + ' :', nom, '→', r.alignement, r.syllabes.map(s => s.h + ' ' + s.verdict + ' ' + s.debut.toFixed(2) + '-' + s.fin.toFixed(2)).join(' | '));
  }
}
// La voix modèle elle-même : où tombent ses frontières ?
for (const v of ['c1_09a_f', 'c1_09a_m']) {
  const p = M.preparerPhrase({ hanzi: '什么葱？', pinyin: 'shen2 me5 cong1' });
  const m = M.preparerModele(mp3(v), 16000, p);
  console.log('frontières du modèle ' + v + ' (trames de 10 ms) :', m.bornes.join(' '), '| voisé :', m.voix.map(x => (x ? '|' : '.')).join(''));
}
