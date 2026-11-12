// Tests du moteur sur des voix de synthèse aux courbes de ton connues.
// Lancer : node test/test-moteur.js
const M = require('../moteur-voix.js');

const { synthese, SR } = require('./synthese.js');

const CONSONNES_SOURDES = /^(s|sh|x|f|h|c|ch|q|k|t|p|z|zh|j)/;

function cas(hanzi, pinyin, { prononce, baseHz, registreHz } = {}) {
  const phrase = M.preparerPhrase({ hanzi, pinyin });
  const syl = phrase.syllabes.map((s, i) => ({
    forme: prononce ? prononce[i] : s.surface,
    consonne: CONSONNES_SOURDES.test(s.p)
  }));
  const r = M.analyser(synthese(syl, { baseHz }), SR, phrase, { registreHz });
  return { phrase, r, syl };
}

let echecs = 0;
function verifier(nom, condition, detail) {
  console.log((condition ? '  ok   ' : '  ÉCHEC ') + nom + (detail ? '  — ' + detail : ''));
  if (!condition) echecs++;
}

console.log('Pinyin et règles de ton');
verifier('hao3 → hǎo', M.pinyinAccentue('hao3') === 'hǎo');
verifier('lv4 → lǜ', M.pinyinAccentue('lv4') === 'lǜ');
verifier('gou3 → gǒu', M.pinyinAccentue('gou3') === 'gǒu');
verifier('shui3 → shuǐ', M.pinyinAccentue('shui3') === 'shuǐ');
const t = s => M.preparerPhrase(s).syllabes.map(x => x.surface).join(' ');
verifier('放碗里 : 3+3 → 2 + 3', t({ hanzi: '放碗里', pinyin: 'fang4 wan3 li3' }) === '4 2 3', t({ hanzi: '放碗里', pinyin: 'fang4 wan3 li3' }));
verifier('很热 : 3e ton demi', t({ hanzi: '很热', pinyin: 'hen3 re4' }) === '3b 4');
verifier('不对 : bú', t({ hanzi: '不对', pinyin: 'bu4 dui4' }) === '2 4');
verifier('一个 : yí', t({ hanzi: '一个', pinyin: 'yi1 ge5' }) === '2 5');
verifier('一杯 : yì', t({ hanzi: '一杯', pinyin: 'yi1 bei1' }) === '4 1');
verifier('好。我做 : pause coupe le sandhi', t({ hanzi: '好。我做', pinyin: 'hao3 wo3 zuo4' }) === '3 3b 4');

console.log('\nTexte reconnu');
const c = M.comparerTexte('少放盐。', '少放烟');
verifier('少放盐 / 少放烟 : 2 sur 3', Math.abs(c.taux - 2 / 3) < 1e-9, c.caracteres.map(x => x.c + (x.trouve ? '✓' : '✗')).join(' '));

console.log('\nTons bien prononcés (voix grave puis aiguë)');
const PHRASES = [
  ['油', 'you2'], ['水', 'shui3'], ['盐', 'yan2'], ['热', 're4'], ['多', 'duo1'],
  ['很热。', 'hen3 re4'], ['放油。', 'fang4 you2'], ['少放盐。', 'shao3 fang4 yan2'],
  ['什么菜？', 'shen2 me5 cai4'], ['好了。', 'hao3 le5'], ['放碗里。', 'fang4 wan3 li3'],
  ['谢谢奶奶！', 'xie4 xie5 nai3 nai5'], ['奶奶，明天见！', 'nai3 nai5 ming2 tian1 jian4'],
  ['多放米饭。', 'duo1 fang4 mi3 fan4'], ['我做什么？', 'wo3 zuo4 shen2 me5']
];
let justes = 0, totales = 0;
for (const [baseHz, registreHz] of [[120], [215], [165, 165]]) {
  for (const [h, p] of PHRASES) {
    const { r } = cas(h, p, { baseHz, registreHz });
    if (!r.ok) { verifier(h, false, r.message); continue; }
    const notees = r.syllabes.filter(s => s.verdict !== 'neutre');
    const bonnes = notees.filter(s => s.verdict === 'juste').length;
    justes += bonnes; totales += notees.length;
    verifier(h + ' (' + baseHz + ' Hz' + (registreHz ? ', voix connue' : '') + ')', bonnes === notees.length,
      r.syllabes.map(s => s.h + ':' + s.tonAttendu + '→' + (s.entendu || '-') + ' ' + s.verdict).join('  ') +
      (r.approximatif ? '  [découpage approximatif]' : ''));
  }
}
console.log('  → ' + justes + '/' + totales + ' syllabes jugées justes');

console.log('\nErreurs volontaires (le moteur doit les signaler)');
const ERREURS = [
  ['多', 'duo1', ['4']], ['油', 'you2', ['4']], ['热', 're4', ['2']], ['水', 'shui3', ['1']],
  ['少放盐。', 'shao3 fang4 yan2', ['3', '2', '4']], ['放油。', 'fang4 you2', ['1', '4']]
];
for (const [h, p, prononce] of ERREURS) {
  const { r } = cas(h, p, { prononce, baseHz: 140 });
  const fautives = r.syllabes.filter((s, i) => {
    const attendu = M.preparerPhrase({ hanzi: h, pinyin: p }).syllabes[i].surface;
    const dit = prononce[i];
    const pareil = attendu === dit || (attendu === '3b' && dit === '3') || (attendu === '3' && dit === '3b');
    return !pareil;
  });
  const signalees = fautives.filter(s => s.verdict !== 'juste').length;
  verifier(h + ' prononcé ' + prononce.join(' '), signalees === fautives.length,
    r.syllabes.map(s => s.h + ':' + s.tonAttendu + '→' + (s.entendu || '-') + ' ' + s.verdict).join('  '));
}

console.log('\nCas limites');
const vide = M.analyser(new Float32Array(SR), SR, M.preparerPhrase({ hanzi: '好', pinyin: 'hao3' }));
verifier('silence → message clair', !vide.ok && /rien entendu/.test(vide.message), vide.message);

const t0 = Date.now();
cas('奶奶，明天见！', 'nai3 nai5 ming2 tian1 jian4', { baseHz: 180 });
verifier('temps de calcul raisonnable', Date.now() - t0 < 1500, (Date.now() - t0) + ' ms');

console.log(echecs ? '\n' + echecs + ' échec(s)' : '\nTout est passé.');
process.exit(echecs ? 1 : 0);
