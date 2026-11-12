// Voix de synthèse aux courbes de ton connues (pour les tests).
const SR = 44100;
// Échelle de Chao (1 = grave, 5 = aigu) vers demi-tons autour du milieu de la voix
const chao = n => (n - 3) * 2.5;
const FORMES = {
  '1': [5, 5, 5], '2': [3, 3.5, 5], '3': [2, 1, 4], '3b': [2, 1, 1], '4': [5, 3, 1], '5': [3, 2.6, 2.4]
};

function graine(s) { return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

function synthese(syllabes, { baseHz = 130, bruit = 0.003, alea = graine(7), consonnes = true } = {}) {
  const morceaux = [];
  const silence = ms => morceaux.push(new Float32Array(Math.round(SR * ms / 1000)));
  silence(300);
  for (const s of syllabes) {
    const forme = FORMES[s.forme];
    if (consonnes && s.consonne) {
      const n = Math.round(SR * 0.05);
      const c = new Float32Array(n);
      for (let i = 0; i < n; i++) c[i] = (alea() * 2 - 1) * 0.03;
      morceaux.push(c);
    } else {
      silence(25);
    }
    const duree = s.forme === '5' ? 0.14 : s.forme === '3' ? 0.34 : 0.25;
    const n = Math.round(SR * duree);
    const v = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const p = i / (n - 1);
      const k = p < 0.5 ? 0 : 1, q = p < 0.5 ? p * 2 : (p - 0.5) * 2;
      const niveau = forme[k] + (forme[k + 1] - forme[k]) * q;
      const f0 = baseHz * Math.pow(2, (chao(niveau) + (s.decalage || 0)) / 12);
      phase += 2 * Math.PI * f0 / SR;
      let x = 0;
      for (let h = 1; h * f0 < 3500; h++) x += Math.sin(h * phase) / h;
      const env = Math.min(1, i / (SR * 0.02), (n - i) / (SR * 0.04));
      v[i] = x * 0.12 * env;
    }
    morceaux.push(v);
  }
  silence(400);
  const total = morceaux.reduce((s, m) => s + m.length, 0);
  const sig = new Float32Array(total);
  let o = 0;
  for (const m of morceaux) { sig.set(m, o); o += m.length; }
  for (let i = 0; i < total; i++) sig[i] += (alea() * 2 - 1) * bruit;
  return sig;
}


module.exports = { synthese, SR };
