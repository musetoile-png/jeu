/*
 * Moteur de voix — Mille li (千里)
 * ---------------------------------
 * Analyse une phrase chinoise prononcée par le joueur :
 *   1. hauteur de la voix trame par trame (algorithme YIN),
 *   2. découpage de l'enregistrement en syllabes,
 *   3. tons attendus (avec les règles de changement de ton : 不, 一, 3e + 3e, 3e ton « demi »),
 *   4. ton entendu pour chaque syllabe et verdict (juste / presque / à reprendre),
 *   5. comparaison du texte reconnu (si un service de reconnaissance l'a fourni).
 *
 * Tout tourne sur l'appareil : aucun réseau, aucune dépendance.
 * Fonctionne dans le navigateur (window.MoteurVoix) et sous Node (require).
 *
 * Entrée principale : MoteurVoix.analyser(signal, frequenceEchantillonnage, phrase, options)
 *   signal  : Float32Array mono, valeurs entre -1 et 1
 *   phrase  : objet renvoyé par MoteurVoix.preparerPhrase({ hanzi, pinyin, fr })
 *   options : { registreHz }  (hauteur moyenne habituelle du joueur, si connue)
 *
 * Ce moteur est une première brique « locale ». Il est pensé pour être remplacé ou complété
 * plus tard par un service spécialisé (SpeechSuper, TonePerfect…) derrière la même interface.
 */
(function (racine) {
  'use strict';

  // ---------- Réglages ----------
  const SR = 16000;            // fréquence de travail
  const HOP = 160;             // pas entre deux trames : 10 ms
  const W = 400;               // fenêtre d'intégration : 25 ms
  const FMIN = 60, FMAX = 450; // plage de hauteur d'une voix parlée (3e ton grave compris)
  const TAU_MIN = Math.floor(SR / FMAX);
  const TAU_MAX = Math.ceil(SR / FMIN);
  const TRAME = W + TAU_MAX;
  const DUREE_MIN_SYLLABE = 8; // en trames (80 ms)

  // Formes de référence des tons, en demi-tons autour du milieu de la voix, sur 5 points.
  const MODELES = {
    '1':  [2.5, 2.5, 2.5, 2.5, 2.5],      // haut et plat
    '2':  [-1.5, -1.5, -0.5, 1, 2.5],     // monte
    '3':  [-2.5, -4.5, -5, -2.5, 1.5],    // plonge puis remonte (3e ton complet, « 214 »)
    '3b': [-2.5, -4, -5, -5, -5],         // reste bas (3e ton au milieu d'une phrase)
    '4':  [3, 2.5, 1, -1, -3.5]           // tombe
  };

  // Formes mesurées sur 651 répliques en voix chinoise native (voix ElevenLabs du jeu), 12 novembre 2026.
  // En parole réelle, les tons sont moins amples qu'en citation et la voix descend en fin de phrase.
  // 'mil' : syllabe au milieu de la phrase ; 'fin' : dernière syllabe ou syllabe avant une ponctuation.
  // '3r' : 3e ton « complet » des manuels (descend puis remonte), accepté en fin de phrase.
  const MODELES_PAROLE = {
    mil: {
      '1': [1.5, 1.6, 1.8, 1.7, 1.4],
      '2': [-1.0, -0.7, 0.1, 0.8, 1.1],
      '3': [-1.0, -1.7, -2.1, -2.0, -2.0],
      '4': [4.0, 3.7, 2.5, 1.4, 0.6]
    },
    fin: {
      '1': [0.1, 0.2, 0.3, 0.3, 0.6],
      '2': [-4.1, -4.2, -2.4, -1.1, -0.5],
      '3': [-1.3, -1.9, -1.7, -1.6, -1.2],
      '3r': [-2.0, -3.6, -4.0, -2.0, 1.2],
      '4': [2.5, 2.1, 0.0, -1.7, -2.0],
      // Formes « du dictionnaire », celles d'un mot dit seul : acceptées aussi en fin de phrase
      '1c': [2.5, 2.5, 2.5, 2.5, 2.5],
      '2c': [-1.5, -1.5, -0.5, 1, 2.5],
      '4c': [3, 2.5, 1, -1, -3.5]
    }
  };

  // ---------- Pinyin ----------
  const MARQUES = {
    a: ['a', 'ā', 'á', 'ǎ', 'à'], e: ['e', 'ē', 'é', 'ě', 'è'], i: ['i', 'ī', 'í', 'ǐ', 'ì'],
    o: ['o', 'ō', 'ó', 'ǒ', 'ò'], u: ['u', 'ū', 'ú', 'ǔ', 'ù'], 'ü': ['ü', 'ǖ', 'ǘ', 'ǚ', 'ǜ']
  };

  /** "hao3" → "hǎo", "lv4" → "lǜ", "me5" ou "me" → "me" */
  function pinyinAccentue(syllabe) {
    const m = /^([a-zü:v]+?)([1-5])?$/i.exec(syllabe.trim());
    if (!m) return syllabe;
    let base = m[1].toLowerCase().replace(/v|u:/g, 'ü');
    const ton = m[2] ? Number(m[2]) : 5;
    if (ton === 5) return base;
    let cible;
    if (base.includes('a')) cible = base.indexOf('a');
    else if (base.includes('e')) cible = base.indexOf('e');
    else if (base.includes('ou')) cible = base.indexOf('o');
    else {
      for (let i = base.length - 1; i >= 0; i--) {
        if ('iouü'.includes(base[i])) { cible = i; break; }
      }
    }
    if (cible === undefined) return base;
    const v = base[cible];
    return base.slice(0, cible) + MARQUES[v][ton] + base.slice(cible + 1);
  }

  const EST_HAN = /\p{Script=Han}/u;
  const EST_PAUSE = /[，。！？、；：,.!?;:…]/;

  /**
   * Prépare une phrase : associe chaque caractère à sa syllabe et calcule les tons à prononcer.
   * phrase = { hanzi: "很热。", pinyin: "hen3 re4", fr: "Très chaud." }
   */
  function preparerPhrase(phrase) {
    const caracteres = [];
    const pauseApres = [];
    for (const c of phrase.hanzi) {
      if (EST_HAN.test(c)) { caracteres.push(c); pauseApres.push(false); }
      else if (EST_PAUSE.test(c) && caracteres.length) pauseApres[pauseApres.length - 1] = true;
    }
    const syllabesPinyin = phrase.pinyin.trim().split(/\s+/);
    if (syllabesPinyin.length !== caracteres.length) {
      throw new Error('« ' + phrase.hanzi + ' » : ' + caracteres.length + ' caractères mais ' +
        syllabesPinyin.length + ' syllabes de pinyin.');
    }
    const syllabes = caracteres.map((h, i) => {
      const m = /([1-5])$/.exec(syllabesPinyin[i]);
      const ton = m ? Number(m[1]) : 5;
      return { h, p: syllabesPinyin[i], affichage: pinyinAccentue(syllabesPinyin[i]), ton, pauseApres: pauseApres[i] };
    });
    const surface = tonsDeSurface(syllabes);
    syllabes.forEach((s, i) => { s.surface = surface.tons[i]; s.note = surface.notes[i]; });
    return Object.assign({}, phrase, { syllabes });
  }

  /** Règles de changement de ton (sandhi). Renvoie les tons réellement prononcés. */
  function tonsDeSurface(syl) {
    const n = syl.length;
    const tons = syl.map(s => s.ton);
    const notes = syl.map(() => null);
    const suivant = i => (i + 1 < n && !syl[i].pauseApres) ? syl[i + 1] : null;

    for (let i = 0; i < n; i++) {
      const s = suivant(i);
      if (syl[i].h === '不' && s && s.ton === 4) {
        tons[i] = 2; notes[i] = '不 se prononce « bú » devant un 4e ton.';
      }
      if (syl[i].h === '一') {
        if (!s) { tons[i] = 1; }
        else if (s.h === '个' || s.ton === 4) { tons[i] = 2; notes[i] = '一 se prononce « yí » devant un 4e ton (et devant 个).'; }
        else if (s.ton >= 1 && s.ton <= 3) { tons[i] = 4; notes[i] = '一 se prononce « yì » devant un 1er, 2e ou 3e ton.'; }
      }
    }
    for (let i = 0; i < n - 1; i++) {
      if (tons[i] === 3 && tons[i + 1] === 3 && !syl[i].pauseApres) {
        tons[i] = 2; notes[i] = 'Deux 3e tons de suite : le premier se prononce comme un 2e ton.';
      }
    }
    for (let i = 0; i < n; i++) {
      if (tons[i] === 3 && i < n - 1 && !syl[i].pauseApres) {
        tons[i] = '3b';
        if (!notes[i]) notes[i] = 'Au milieu de la phrase, le 3e ton reste en bas, sans remonter.';
      }
    }
    return { tons: tons.map(String), notes };
  }

  // ---------- Signal ----------
  function reechantillonner(x, srEntree) {
    if (srEntree === SR) return Float32Array.from(x);
    const ratio = srEntree / SR;
    const k = Math.max(1, Math.round(ratio));
    const lisse = new Float32Array(x.length);
    let acc = 0;
    for (let i = 0; i < x.length; i++) {
      acc += x[i];
      if (i >= k) acc -= x[i - k];
      lisse[i] = acc / Math.min(i + 1, k);
    }
    const n = Math.floor(x.length / ratio);
    const y = new Float32Array(n);
    for (let j = 0; j < n; j++) {
      const p = j * ratio + (k - 1) / 2;
      const i0 = Math.min(x.length - 1, Math.floor(p));
      const f = p - i0;
      const a = lisse[i0], b = lisse[Math.min(i0 + 1, x.length - 1)];
      y[j] = a + (b - a) * f;
    }
    return y;
  }

  function yin(x, debut, d, cm) {
    for (let tau = 1; tau <= TAU_MAX; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) {
        const diff = x[debut + j] - x[debut + j + tau];
        s += diff * diff;
      }
      d[tau] = s;
    }
    let cumul = 0;
    cm[0] = 1;
    for (let tau = 1; tau <= TAU_MAX; tau++) {
      cumul += d[tau];
      cm[tau] = cumul > 0 ? d[tau] * tau / cumul : 1;
    }
    let meilleur = -1;
    for (let tau = TAU_MIN; tau <= TAU_MAX; tau++) {
      if (cm[tau] < 0.2) {
        while (tau + 1 <= TAU_MAX && cm[tau + 1] < cm[tau]) tau++;
        meilleur = tau;
        break;
      }
    }
    if (meilleur < 0) {
      let m = Infinity;
      for (let tau = TAU_MIN; tau <= TAU_MAX; tau++) if (cm[tau] < m) { m = cm[tau]; meilleur = tau; }
      if (cm[meilleur] > 0.5) return { f0: 0, ap: cm[meilleur] };
    }
    let t = meilleur;
    if (meilleur > TAU_MIN && meilleur < TAU_MAX) {
      const a = cm[meilleur - 1], b = cm[meilleur], c = cm[meilleur + 1];
      const den = a - 2 * b + c;
      if (den > 0) t = meilleur + 0.5 * (a - c) / den;
    }
    return { f0: SR / t, ap: cm[meilleur] };
  }

  function percentile(valeurs, p) {
    if (!valeurs.length) return 0;
    const v = Array.from(valeurs).sort((a, b) => a - b);
    return v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
  }

  function mediane(v) { return percentile(v, 0.5); }

  /** Trames de 10 ms : énergie, hauteur, voisement. */
  function extraireTrames(x) {
    const n = Math.max(0, Math.floor((x.length - TRAME) / HOP) + 1);
    const trames = [];
    for (let i = 0; i < n; i++) {
      const s = i * HOP;
      let e = 0;
      for (let j = 0; j < W; j++) e += x[s + j] * x[s + j];
      trames.push({ t: (s + W / 2) / SR, rms: Math.sqrt(e / W), f0: 0, ap: 1, voisee: false });
    }
    const rmsTous = trames.map(t => t.rms);
    const bruit = Math.max(percentile(rmsTous, 0.1), 1e-5);
    const crete = percentile(rmsTous, 0.98);
    const seuilParole = Math.max(bruit * 4, crete * 0.08, 2e-4);
    const seuilVoix = Math.max(bruit * 3, crete * 0.05, 1.5e-4);

    const d = new Float64Array(TAU_MAX + 1), cm = new Float64Array(TAU_MAX + 1);
    for (let i = 0; i < n; i++) {
      const tr = trames[i];
      if (tr.rms < seuilVoix) continue;
      const r = yin(x, i * HOP, d, cm);
      tr.ap = r.ap;
      // Voix grinçante (fin de 3e ton) : périodicité faible mais énergie nette, on l'accepte
      const limite = tr.rms > seuilParole ? 0.45 : 0.3;
      if (r.f0 >= FMIN && r.f0 <= FMAX && r.ap < limite) { tr.f0 = r.f0; tr.voisee = true; }
    }

    // Corrige les sauts d'octave par continuité avec les trames voisines
    const brutes = trames.map(t => t.f0);
    for (let k = 0; k < n; k++) {
      const tr = trames[k];
      if (!tr.voisee) continue;
      const voisins = [];
      for (let m = k - 10; m <= k + 10; m++) if (m !== k && m >= 0 && m < n && trames[m].voisee) voisins.push(brutes[m]);
      if (voisins.length < 4) continue;
      const loc = mediane(voisins);
      if (tr.f0 > 1.8 * loc) tr.f0 /= 2;
      else if (tr.f0 < 0.56 * loc) tr.f0 *= 2;
      if (tr.f0 < FMIN || tr.f0 > FMAX) { tr.voisee = false; tr.f0 = 0; }
    }
    // Retire les îlots de voix trop courts (bruits, clics)
    let i = 0;
    while (i < n) {
      if (!trames[i].voisee) { i++; continue; }
      let j = i;
      while (j < n && trames[j].voisee) j++;
      if (j - i < 3) for (let k = i; k < j; k++) { trames[k].voisee = false; trames[k].f0 = 0; }
      i = j;
    }
    // Lissage médian sur 5 trames, à l'intérieur des passages voisés
    const brut = trames.map(t => t.f0);
    for (let k = 0; k < n; k++) {
      if (!trames[k].voisee) continue;
      const voisins = [];
      for (let m = k - 2; m <= k + 2; m++) if (m >= 0 && m < n && trames[m].voisee) voisins.push(brut[m]);
      trames[k].f0 = mediane(voisins);
    }
    return { trames, seuilParole, seuilVoix, bruit, crete };
  }

  /**
   * Découpe la zone de parole [a, b] en syllabes par programmation dynamique.
   * Récompense : frontières dans un creux d'énergie, une consonne sourde, un silence, un saut de hauteur ;
   * pénalité : durée éloignée de la durée attendue (ton neutre court, syllabe finale allongée) ;
   * la ponctuation attire la frontière dans un silence.
   */
  function decouperDP(trames, a, b, syllabes, seuilParole, guideTons) {
    const n = syllabes.length;
    if (n <= 1) return { frontieres: [], approximatif: false };
    const F = b - a + 1;
    const E = [], actif = [], voix = [];
    for (let i = a; i <= b; i++) {
      E.push(20 * Math.log10(trames[i].rms + 1e-7));
      actif.push(trames[i].rms > seuilParole * 0.5 || trames[i].voisee);
      voix.push(trames[i].voisee);
    }
    const Es = E.map((_, i) => { let s = 0, c = 0; for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < F) { s += E[k]; c++; } return s / c; });
    // Longueur du silence qui contient chaque trame
    const silence = new Array(F).fill(0);
    for (let i = 0; i < F;) {
      if (actif[i]) { i++; continue; }
      let j = i; while (j < F && !actif[j]) j++;
      for (let k = i; k < j; k++) silence[k] = j - i;
      i = j;
    }
    // Intérêt d'une frontière placée au début de la trame i
    const B = new Float64Array(F + 1);
    for (let i = 1; i < F; i++) {
      let maxG = -Infinity, maxD = -Infinity;
      for (let k = Math.max(0, i - 12); k <= i; k++) maxG = Math.max(maxG, Es[k]);
      for (let k = i; k <= Math.min(F - 1, i + 12); k++) maxD = Math.max(maxD, Es[k]);
      let s = 0.12 * Math.max(0, Math.min(maxG, maxD) - Es[i]);
      if (!voix[i]) s += 1;
      if (!voix[i - 1] && voix[i]) s += 0.8;
      if (silence[i] > 0) s += 1 + Math.min(3, silence[i] / 8);
      if (voix[i] && voix[i - 1]) {
        const saut = Math.abs(12 * Math.log2(trames[a + i].f0 / trames[a + i - 1].f0));
        if (saut > 1.2) s += Math.min(2, saut / 1.5);
      }
      B[i] = s;
    }
    // Durées attendues (en trames actives)
    const cumActif = new Int32Array(F + 1), cumVoix = new Int32Array(F + 1);
    for (let i = 0; i < F; i++) { cumActif[i + 1] = cumActif[i] + (actif[i] ? 1 : 0); cumVoix[i + 1] = cumVoix[i] + (voix[i] ? 1 : 0); }
    const poids = syllabes.map((s, k) => {
      let w = s.surface === '5' ? 0.55 : 1;
      const finale = k === n - 1 || s.pauseApres;
      if (finale) w *= s.surface === '3' ? 1.45 : 1.2;
      return w;
    });
    const somme = poids.reduce((x, y) => x + y, 0);
    const attendu = poids.map(w => Math.max(4, cumActif[F] * w / somme));
    // Silences longs à l'intérieur d'une syllabe : à éviter
    const cumLongSil = new Int32Array(F + 1);
    for (let i = 0; i < F; i++) cumLongSil[i + 1] = cumLongSil[i] + (silence[i] >= 15 ? 1 : 0);

    // Ressemblance d'un morceau à un ton quelconque (indice neutre : ne favorise pas le ton attendu)
    const stVoix = [];
    const med = mediane(trames.slice(a, b + 1).filter(t => t.voisee).map(t => t.f0)) || 1;
    for (let i = a; i <= b; i++) stVoix.push(trames[i].voisee ? 12 * Math.log2(trames[i].f0 / med) : null);
    const memo = new Map();
    const formeTon = (s, e, modele) => {
      const cle = s * 4096 + e + (modele ? modele.join() : '');
      if (memo.has(cle)) return memo.get(cle);
      const v = [];
      for (let i = s; i < e; i++) if (stVoix[i] !== null) v.push(stVoix[i]);
      let r = 0;
      if (v.length >= 5) {
        const coeur = v.slice(Math.floor(v.length * 0.15), Math.ceil(v.length * 0.9));
        const c5 = versCinqPoints(coeur.length >= 4 ? coeur : v);
        let m = Infinity;
        if (modele) m = distance(c5, modele, 0.35);
        else for (const cle2 of Object.keys(MODELES)) m = Math.min(m, distance(c5, MODELES[cle2], 0.15));
        r = m;
      }
      memo.set(cle, r);
      return r;
    };

    const cout = (k, s, e) => {
      const act = cumActif[e] - cumActif[s];
      const vx = cumVoix[e] - cumVoix[s];
      let c = 0;
      if (act < 4) c += 30;
      if (vx < 3) c += syllabes[k].surface === '5' ? 2 : 8;
      if (guideTons && syllabes[k].surface !== '5') {
        const pos = (k === n - 1 || syllabes[k].pauseApres) ? 'fin' : 'mil';
        const base = syllabes[k].surface === '3b' ? '3' : syllabes[k].surface;
        const modele = MODELES_PAROLE[pos][base];
        if (modele) c += 1.5 * formeTon(s, e, modele);
      }
      c += 3 * Math.log(Math.max(act, 1) / attendu[k]) ** 2;
      const silInterne = cumLongSil[e] - cumLongSil[s];
      if (silInterne > 0 && !(syllabes[k].pauseApres && e === F)) c += 0.15 * silInterne;
      return c;
    };
    // D[k][e] : meilleur coût pour placer les k premières syllabes sur [0, e)
    const INF = 1e18;
    const D = Array.from({ length: n + 1 }, () => new Float64Array(F + 1).fill(INF));
    const P = Array.from({ length: n + 1 }, () => new Int32Array(F + 1).fill(-1));
    D[0][0] = 0;
    for (let k = 1; k <= n; k++) {
      const finK = k === n;
      for (let e = finK ? F : 1; e <= F; e++) {
        if (!finK && e === F) continue;
        let meilleur = INF, arg = -1;
        const plusLong = Math.ceil(attendu[k - 1] * 3.5) + 40;
        for (let s = Math.max(k - 1, e - plusLong); s < e; s++) {
          if (D[k - 1][s] >= INF) continue;
          let c = D[k - 1][s] + cout(k - 1, s, e);
          if (!finK) {
            c -= B[e];
            if (syllabes[k - 1].pauseApres && silence[e] >= 10) c -= 4;
          }
          if (c < meilleur) { meilleur = c; arg = s; }
        }
        D[k][e] = meilleur; P[k][e] = arg;
      }
    }
    const frontieres = [];
    let e = F;
    for (let k = n; k >= 1; k--) { const s = P[k][e]; if (k > 1) frontieres.unshift(a + s); e = s; }
    const approximatif = frontieres.some((f, k) => (cumVoix[f - a] - cumVoix[k ? frontieres[k - 1] - a : 0]) < 3);
    return { frontieres, approximatif };
  }

  // ---------- Timbre de la voix (coefficients MFCC), trame par trame ----------
  const NFFT = 512, NMEL = 26, NCEP = 13;
  const FENETRE = Float32Array.from({ length: W }, (_, i) => 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (W - 1)));
  const BANC_MEL = (() => {
    const mel = f => 2595 * Math.log10(1 + f / 700), inv = m => 700 * (10 ** (m / 2595) - 1);
    const m0 = mel(80), m1 = mel(7600);
    const pts = Array.from({ length: NMEL + 2 }, (_, i) => Math.floor((NFFT + 1) * inv(m0 + (m1 - m0) * i / (NMEL + 1)) / SR));
    return Array.from({ length: NMEL }, (_, k) => {
      const f = new Float32Array(NFFT / 2 + 1);
      for (let j = pts[k]; j < pts[k + 1]; j++) f[j] = (j - pts[k]) / Math.max(1, pts[k + 1] - pts[k]);
      for (let j = pts[k + 1]; j <= pts[k + 2]; j++) f[j] = (pts[k + 2] - j) / Math.max(1, pts[k + 2] - pts[k + 1]);
      return f;
    });
  })();

  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ar = re[i + k], ai = im[i + k];
          const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ar + br; im[i + k] = ai + bi;
          re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }

  /** Coefficients MFCC des trames [a, b], normalisés sur la phrase (moyenne 0, écart 1 par coefficient). */
  function timbre(x, a, b) {
    const res = [];
    const re = new Float64Array(NFFT), im = new Float64Array(NFFT), logMel = new Float64Array(NMEL);
    for (let i = a; i <= b; i++) {
      re.fill(0); im.fill(0);
      const s = i * HOP;
      for (let j = 0; j < W; j++) re[j] = (x[s + j] - 0.97 * (s + j > 0 ? x[s + j - 1] : 0)) * FENETRE[j];
      fft(re, im);
      for (let k = 0; k < NMEL; k++) {
        let e = 0; const f = BANC_MEL[k];
        for (let j = 0; j <= NFFT / 2; j++) if (f[j]) e += f[j] * (re[j] * re[j] + im[j] * im[j]);
        logMel[k] = Math.log(e + 1e-10);
      }
      const c = new Float64Array(NCEP);
      for (let q = 0; q < NCEP; q++) {
        let v = 0;
        for (let k = 0; k < NMEL; k++) v += logMel[k] * Math.cos(Math.PI * q * (k + 0.5) / NMEL);
        c[q] = v;
      }
      res.push(c);
    }
    for (let q = 0; q < NCEP; q++) {
      let m = 0; for (const c of res) m += c[q]; m /= res.length;
      let v = 0; for (const c of res) v += (c[q] - m) ** 2; v = Math.sqrt(v / res.length) || 1;
      for (const c of res) c[q] = (c[q] - m) / v;
    }
    return res;
  }

  /**
   * Aligne deux phrases dans le temps (DTW) sur le timbre : consonnes et voyelles, pas la hauteur.
   * Une erreur de ton ne fausse donc pas l'alignement. Renvoie le chemin [[i, j], ...].
   */
  function aligner(A, B, voixA, voixB) {
    const N = A.length, Mn = B.length;
    const d = (i, j) => {
      let s = 0;
      for (let q = 0; q < NCEP; q++) { const w = q === 0 ? 0.5 : 1; s += w * (A[i][q] - B[j][q]) ** 2; }
      if (voixA[i] !== voixB[j]) s += 2;
      return Math.sqrt(s);
    };
    const D = Array.from({ length: N }, () => new Float64Array(Mn).fill(Infinity));
    const bande = Math.max(15, Math.round(0.35 * Math.max(N, Mn)));
    const PEN = 0.6;
    for (let i = 0; i < N; i++) {
      const centre = Math.round(i * (Mn - 1) / Math.max(1, N - 1));
      for (let j = Math.max(0, centre - bande); j <= Math.min(Mn - 1, centre + bande); j++) {
        const c = d(i, j);
        if (i === 0 && j === 0) { D[0][0] = c; continue; }
        let m = Infinity;
        if (i > 0 && j > 0) m = D[i - 1][j - 1];
        if (i > 0) m = Math.min(m, D[i - 1][j] + PEN);
        if (j > 0) m = Math.min(m, D[i][j - 1] + PEN);
        D[i][j] = c + m;
      }
    }
    if (!isFinite(D[N - 1][Mn - 1])) return null;
    const chemin = [];
    let i = N - 1, j = Mn - 1;
    chemin.push([i, j]);
    while (i > 0 || j > 0) {
      const diag = i > 0 && j > 0 ? D[i - 1][j - 1] : Infinity;
      const haut = i > 0 ? D[i - 1][j] + PEN : Infinity;
      const gauche = j > 0 ? D[i][j - 1] + PEN : Infinity;
      if (diag <= haut && diag <= gauche) { i--; j--; } else if (haut <= gauche) i--; else j--;
      chemin.push([i, j]);
    }
    return chemin.reverse();
  }

  function zoneParole(trames, seuilParole) {
    let a = trames.findIndex(t => t.rms > seuilParole);
    let b = -1;
    for (let i = trames.length - 1; i >= 0; i--) if (trames[i].rms > seuilParole) { b = i; break; }
    if (a < 0) return null;
    return { a: Math.max(0, a - 2), b: Math.min(trames.length - 1, b + 2) };
  }

  /**
   * Prépare une voix modèle (réplique native de la même phrase) : timbre, mélodie et frontières des syllabes.
   * Les tons de la voix modèle sont justes : son découpage peut donc s'aider des tons attendus.
   */
  function preparerModele(signal, srEntree, phrase) {
    const x = reechantillonner(signal, srEntree);
    const { trames, seuilParole } = extraireTrames(x);
    const z = zoneParole(trames, seuilParole);
    if (!z) return null;
    const { frontieres } = decouperDP(trames, z.a, z.b, phrase.syllabes, seuilParole, true);
    const med = mediane(trames.filter(t => t.voisee).map(t => t.f0)) || 1;
    return {
      a: z.a, b: z.b,
      bornes: [z.a, ...frontieres, z.b + 1],
      mfcc: timbre(x, z.a, z.b),
      voix: trames.slice(z.a, z.b + 1).map(t => t.voisee),
      st: trames.slice(z.a, z.b + 1).map(t => (t.voisee ? 12 * Math.log2(t.f0 / med) : null)),
      nb: phrase.syllabes.length
    };
  }

  /** Reporte les frontières de la voix modèle sur l'enregistrement du joueur. */
  function bornesParModele(x, trames, a, b, modele) {
    const A = timbre(x, a, b);
    const voixA = trames.slice(a, b + 1).map(t => t.voisee);
    const N = A.length, Mn = modele.mfcc.length;
    if (N < 5 || N > 3.5 * Mn || Mn > 3.5 * N) return null;
    const chemin = aligner(A, modele.mfcc, voixA, modele.voix);
    if (!chemin) return null;
    const versJoueur = new Int32Array(Mn).fill(-1);
    for (const [i, j] of chemin) if (versJoueur[j] < 0) versJoueur[j] = i;
    const bornes = modele.bornes.map((mb, k) => {
      if (k === 0) return a;
      if (k === modele.bornes.length - 1) return b + 1;
      return a + versJoueur[Math.min(Mn - 1, Math.max(0, mb - modele.a))];
    });
    for (let k = 1; k < bornes.length; k++) if (bornes[k] <= bornes[k - 1] + 2) bornes[k] = bornes[k - 1] + 3;
    if (bornes[bornes.length - 1] > b + 1) return null;
    // Mélodie du modèle, recalée sur le temps du joueur
    const melodie = new Array(N).fill(null);
    for (const [i, j] of chemin) if (melodie[i] === null && modele.st[j] !== null) melodie[i] = modele.st[j];
    // Retire les décrochages isolés (bords de voisement) pour l'affichage
    const propre = melodie.map((v, i) => {
      if (v === null) return null;
      const voisins = [];
      for (let k = i - 5; k <= i + 5; k++) if (k !== i && melodie[k] !== null && melodie[k] !== undefined) voisins.push(melodie[k]);
      return voisins.length >= 3 && Math.abs(v - mediane(voisins)) > 4 ? null : v;
    });
    return { bornes, melodie: propre };
  }

  /** Ancien découpage (creux d'énergie), gardé pour comparaison. */
  function decouper(trames, a, b, n) {
    if (n <= 1) return { frontieres: [], approximatif: false };
    const E = trames.map(t => 20 * Math.log10(t.rms + 1e-7));
    const Es = E.map((_, i) => {
      let s = 0, c = 0;
      for (let k = i - 2; k <= i + 2; k++) if (k >= a && k <= b) { s += E[k]; c++; }
      return c ? s / c : E[i];
    });
    const candidats = [];
    const portee = 15;
    for (let i = a + DUREE_MIN_SYLLABE; i <= b - DUREE_MIN_SYLLABE; i++) {
      const creux = Es[i] <= Es[i - 1] && Es[i] <= Es[i + 1];
      let voixAvant = false, voixApres = false;
      for (let k = Math.max(a, i - portee); k < i; k++) if (trames[k].voisee) { voixAvant = true; break; }
      for (let k = i + 1; k <= Math.min(b, i + portee); k++) if (trames[k].voisee) { voixApres = true; break; }
      const coupure = !trames[i].voisee && voixAvant && voixApres;
      if (!creux && !coupure) continue;
      let maxG = -Infinity, maxD = -Infinity;
      for (let k = Math.max(a, i - portee); k <= i; k++) maxG = Math.max(maxG, Es[k]);
      for (let k = i; k <= Math.min(b, i + portee); k++) maxD = Math.max(maxD, Es[k]);
      let force = Math.min(maxG, maxD) - Es[i];
      if (coupure) force += 6;
      // Saut de hauteur entre deux trames voisées : indice d'un changement de syllabe
      if (trames[i].voisee && trames[i + 1].voisee) {
        const saut = Math.abs(12 * Math.log2(trames[i + 1].f0 / trames[i].f0));
        if (saut > 2.5) force += 3;
      }
      if (force > 0.5) candidats.push({ i, force });
    }
    // Plusieurs trames d'une même coupure : on garde le centre
    candidats.sort((x, y) => y.force - x.force);
    const choisies = [];
    for (const c of candidats) {
      if (choisies.length >= n - 1) break;
      if (choisies.every(f => Math.abs(f - c.i) >= DUREE_MIN_SYLLABE)) choisies.push(c.i);
    }
    let approximatif = false;
    while (choisies.length < n - 1) {
      approximatif = true;
      const bornes = [a, ...choisies.slice().sort((x, y) => x - y), b + 1];
      let plusLong = 0, debut = a;
      for (let k = 0; k < bornes.length - 1; k++) {
        if (bornes[k + 1] - bornes[k] > plusLong) { plusLong = bornes[k + 1] - bornes[k]; debut = bornes[k]; }
      }
      choisies.push(debut + Math.floor(plusLong / 2));
    }
    choisies.sort((x, y) => x - y);
    return { frontieres: choisies, approximatif };
  }

  function versCinqPoints(valeurs) {
    const res = [];
    for (let k = 0; k < 5; k++) {
      const p = (k / 4) * (valeurs.length - 1);
      const i0 = Math.floor(p), f = p - i0;
      const a = valeurs[i0], b = valeurs[Math.min(valeurs.length - 1, i0 + 1)];
      res.push(a + (b - a) * f);
    }
    return res;
  }

  function moyenne(v) { return v.reduce((s, x) => s + x, 0) / v.length; }

  /** Distance entre un contour mesuré et un modèle : forme (avec ampleur ajustable) + niveau. */
  function distance(contour, modele, poidsNiveau) {
    if (poidsNiveau === undefined) poidsNiveau = 0.35;
    const mu = moyenne(contour), mt = moyenne(modele);
    const cu = contour.map(x => x - mu), ct = modele.map(x => x - mt);
    const ctct = ct.reduce((s, x) => s + x * x, 0);
    let echelle = 1;
    if (ctct > 1e-6) {
      echelle = cu.reduce((s, x, k) => s + x * ct[k], 0) / ctct;
      echelle = Math.min(1.6, Math.max(0.5, echelle));
    }
    let forme = 0;
    for (let k = 0; k < 5; k++) forme += (cu[k] - echelle * ct[k]) ** 2;
    forme = Math.sqrt(forme / 5);
    return forme + poidsNiveau * Math.abs(mu - mt);
  }

  const ACCEPTES = { '1': ['1'], '2': ['2'], '3': ['3', '3b'], '3b': ['3b', '3'], '4': ['4'] };

  const CONSEILS = {
    '1': {
      '2': 'Le 1er ton ne monte pas : pars haut et tiens la note.',
      '3': 'Le 1er ton est haut : place ta voix plus haut, comme une note tenue.',
      '4': 'Le 1er ton reste haut et plat : ne laisse pas la voix retomber.'
    },
    '2': {
      '1': 'Le 2e ton monte : pars du milieu et monte, comme un « hein ? » étonné.',
      '3': 'Pas de creux : monte franchement dès le début.',
      '4': 'Tu descends au lieu de monter. Le 2e ton monte, comme « hein ? ».'
    },
    '3': {
      '1': 'Trop haut : le 3e ton est le plus grave, descends dans le bas de ta voix.',
      '2': 'Commence plus bas : le 3e ton plonge d\'abord.',
      '4': 'Ne pars pas d\'en haut : le 3e ton part du milieu et descend tout en bas.'
    },
    '4': {
      '1': 'Le 4e ton tombe franchement, comme un « Non ! » ferme.',
      '2': 'Tu montes au lieu de descendre : le 4e ton tombe, comme « Non ! ».',
      '3': 'Pars plus haut : le 4e ton commence en haut et tombe d\'un coup.'
    }
  };

  const NOMS_TONS = { '1': '1er ton', '2': '2e ton', '3': '3e ton', '3b': '3e ton', '4': '4e ton', '5': 'ton neutre' };

  /** Juge une syllabe. position : 'mil' (milieu de phrase) ou 'fin' (avant une ponctuation ou en fin). */
  function evaluerSyllabe(contour, attendu, poidsNiveau, position) {
    const modeles = MODELES_PAROLE[position === 'fin' ? 'fin' : 'mil'];
    const distances = {};
    for (const cle of Object.keys(modeles)) distances[cle] = distance(contour, modeles[cle], poidsNiveau);
    const ordre = Object.keys(distances).sort((x, y) => distances[x] - distances[y]);
    const meilleur = ordre[0];
    const entendu = meilleur === '3r' ? '3' : meilleur.replace('c', '');
    const attenduBase = attendu === '3b' ? '3' : attendu;
    const modele = modeles[attenduBase] || null;
    if (attendu === '5') return { entendu, verdict: 'neutre', distances, modele: null };
    const acceptes = (attenduBase === '3' ? ['3', '3r'] : [attenduBase, attenduBase + 'c']).filter(c => c in modeles);
    const dAttendu = Math.min(...acceptes.map(c => distances[c]));
    let verdict;
    if (acceptes.includes(meilleur)) verdict = 'juste';
    else if (dAttendu <= Math.max(distances[meilleur], 0.05) * 1.3) verdict = 'presque';
    else verdict = 'a_reprendre';
    let conseil = null;
    if (verdict !== 'juste') {
      conseil = (CONSEILS[attenduBase] && CONSEILS[attenduBase][entendu]) ||
        'Écoute le modèle et exagère la forme du ' + NOMS_TONS[attendu] + '.';
    }
    return { entendu, verdict, distances, conseil, modele };
  }

  /**
   * Analyse complète d'un enregistrement.
   * Renvoie { ok, message, duree, registreHz, medianeHz, courbe, syllabes, score, approximatif }.
   */
  function analyser(signal, srEntree, phrase, options) {
    options = options || {};
    const x = reechantillonner(signal, srEntree);
    const { trames, seuilParole } = extraireTrames(x);
    const n = phrase.syllabes.length;

    let a = trames.findIndex(t => t.rms > seuilParole);
    let b = -1;
    for (let i = trames.length - 1; i >= 0; i--) if (trames[i].rms > seuilParole) { b = i; break; }
    const voisees = trames.filter(t => t.voisee);
    if (a < 0 || voisees.length < 5) {
      return { ok: false, message: 'Je n\'ai rien entendu de clair. Rapproche-toi du micro et parle un peu plus fort.' };
    }
    a = Math.max(0, a - 2); b = Math.min(trames.length - 1, b + 2);
    if ((b - a + 1) < n * 6) {
      return { ok: false, message: 'L\'enregistrement est trop court pour ' + n + ' syllabes. Reprends en articulant chaque syllabe.' };
    }

    const medianeHz = mediane(voisees.map(t => t.f0));
    const registreConnu = options.registreHz && options.registreHz > 0;
    const reference = registreConnu ? options.registreHz : medianeHz;
    // Le niveau (haut / bas) n'est fiable que si l'on connaît la voix du joueur
    // ou si la phrase est assez longue pour que sa médiane serve de repère.
    const nbNotees = phrase.syllabes.filter(s => s.surface !== '5').length;
    const poidsNiveau = registreConnu ? 0.35 : 0.35 * Math.min(1, Math.max(0, nbNotees - 1) / 3);
    const st = f => 12 * Math.log2(f / reference);

    let bornes = null, approximatif = false, melodieModele = null, alignement = 'seul';
    if (options.modele && options.modele.nb === n) {
      const r = bornesParModele(x, trames, a, b, options.modele);
      if (r) { bornes = r.bornes; melodieModele = r.melodie; alignement = 'modele'; }
    }
    if (!bornes) {
      const dp = decouperDP(trames, a, b, phrase.syllabes, seuilParole);
      bornes = [a, ...dp.frontieres, b + 1];
      approximatif = dp.approximatif;
    }

    const syllabes = phrase.syllabes.map((s, k) => {
      const debut = bornes[k], fin = bornes[k + 1];
      const voix = [];
      for (let i = debut; i < fin; i++) if (trames[i].voisee) voix.push(st(trames[i].f0));
      const base = {
        h: s.h, pinyin: s.affichage, tonLexical: String(s.ton), tonAttendu: s.surface, note: s.note,
        debut: trames[debut].t, fin: trames[Math.min(fin, trames.length) - 1].t
      };
      if (voix.length < 6) {
        return Object.assign(base, { verdict: s.surface === '5' ? 'neutre' : 'inaudible', contour: null, entendu: null,
          conseil: s.surface === '5' ? null : 'Syllabe trop courte ou trop faible : tiens la voyelle un peu plus longtemps.' });
      }
      const coeur = voix.slice(Math.floor(voix.length * 0.15), Math.ceil(voix.length * 0.9));
      const contour = versCinqPoints(coeur.length >= 4 ? coeur : voix);
      const position = (k === phrase.syllabes.length - 1 || s.pauseApres) ? 'fin' : 'mil';
      const ev = evaluerSyllabe(contour, s.surface, poidsNiveau, position);
      // Comparaison directe avec la même syllabe chez la voix modèle
      let contourModele = null;
      if (alignement === 'modele' && s.surface !== '5') {
        const mo = options.modele, v = [];
        for (let j = mo.bornes[k]; j < mo.bornes[k + 1]; j++) { const y = mo.st[j - mo.a]; if (y !== null && y !== undefined) v.push(y); }
        if (v.length >= 5) {
          const c = v.slice(Math.floor(v.length * 0.15), Math.ceil(v.length * 0.9));
          contourModele = versCinqPoints(c.length >= 4 ? c : v);
        }
      }
      let verdict = ev.verdict, entendu = ev.entendu, conseil = ev.conseil;
      const jugement = options.jugement || 'les_deux';
      if (contourModele && jugement !== 'gabarits') {
        const modeles = MODELES_PAROLE[position];
        const baseAtt = s.surface === '3b' ? '3' : s.surface;
        const dRef = distance(contour, contourModele, poidsNiveau);
        let dAutres = Infinity;
        for (const [cle, gab] of Object.entries(modeles)) {
          const cb = cle === '3r' ? '3' : cle.replace('c', '');
          if (cb !== baseAtt) dAutres = Math.min(dAutres, distance(contour, gab, poidsNiveau));
        }
        const ratio = dRef / Math.max(dAutres, 0.05);
        const vRef = ratio <= 1 ? 'juste' : ratio <= 1.3 ? 'presque' : 'a_reprendre';
        const rang = { juste: 2, presque: 1, a_reprendre: 0 };
        verdict = jugement === 'modele' ? vRef : (rang[vRef] > rang[ev.verdict] ? vRef : ev.verdict);
        if (verdict === 'juste') conseil = null;
      }
      return Object.assign(base, { contour, contourModele, position, modele: ev.modele, entendu, verdict, distances: ev.distances, conseil });
    });

    // Le score ne compte que les syllabes vraiment jugées : une syllabe « pas entendue » n'est pas une faute de ton
    const notees = syllabes.filter(s => s.verdict === 'juste' || s.verdict === 'presque' || s.verdict === 'a_reprendre');
    const points = notees.reduce((p, s) => p + (s.verdict === 'juste' ? 1 : s.verdict === 'presque' ? 0.5 : 0), 0);
    const score = notees.length ? Math.round(100 * points / notees.length) : 100;

    const marge = 5;
    const courbe = [];
    for (let i = Math.max(0, a - marge); i <= Math.min(trames.length - 1, b + marge); i++) {
      const t = trames[i];
      const m = melodieModele && i >= a && i <= b ? melodieModele[i - a] : null;
      courbe.push({ t: t.t, st: t.voisee ? st(t.f0) : null, db: 20 * Math.log10(t.rms + 1e-7),
        modele: m === null ? null : m + 12 * Math.log2(medianeHz / reference) });
    }

    return {
      ok: true,
      duree: x.length / SR,
      debutParole: trames[a].t,
      finParole: trames[b].t,
      registreHz: reference,
      medianeHz,
      courbe,
      syllabes,
      score,
      approximatif,
      alignement
    };
  }

  // ---------- Texte ----------
  function nettoyer(texte) { return [...(texte || '')].filter(c => EST_HAN.test(c)); }

  /** Compare le texte attendu au texte reconnu, caractère par caractère (plus longue sous-suite commune). */
  function comparerTexte(attendu, entendu) {
    const a = nettoyer(attendu), b = nettoyer(entendu);
    const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      }
    }
    const trouves = new Array(a.length).fill(false);
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { trouves[i] = true; i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) i++;
      else j++;
    }
    const nb = trouves.filter(Boolean).length;
    return {
      caracteres: a.map((c, k) => ({ c, trouve: trouves[k] })),
      taux: a.length ? nb / a.length : 0,
      entendu: b.join('')
    };
  }

  const MoteurVoix = {
    version: '0.3.0',
    MODELES, MODELES_PAROLE, NOMS_TONS,
    pinyinAccentue, preparerPhrase, tonsDeSurface,
    analyser, comparerTexte, preparerModele,
    _interne: { reechantillonner, extraireTrames, decouper, decouperDP, distance, evaluerSyllabe, timbre, aligner, SR, HOP }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MoteurVoix;
  else racine.MoteurVoix = MoteurVoix;
})(typeof window !== 'undefined' ? window : globalThis);
