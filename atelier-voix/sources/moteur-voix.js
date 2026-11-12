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
  const FMIN = 70, FMAX = 450; // plage de hauteur d'une voix parlée
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
      if (cm[tau] < 0.15) {
        while (tau + 1 <= TAU_MAX && cm[tau + 1] < cm[tau]) tau++;
        meilleur = tau;
        break;
      }
    }
    if (meilleur < 0) {
      let m = Infinity;
      for (let tau = TAU_MIN; tau <= TAU_MAX; tau++) if (cm[tau] < m) { m = cm[tau]; meilleur = tau; }
      if (cm[meilleur] > 0.35) return { f0: 0, ap: cm[meilleur] };
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
      if (r.f0 >= FMIN && r.f0 <= FMAX && r.ap < 0.3) { tr.f0 = r.f0; tr.voisee = true; }
    }

    // Corrige les sauts d'octave autour de la hauteur médiane
    const med = mediane(trames.filter(t => t.voisee).map(t => t.f0));
    if (med > 0) {
      for (const tr of trames) {
        if (!tr.voisee) continue;
        if (tr.f0 > 1.75 * med) tr.f0 /= 2;
        else if (tr.f0 < 0.6 * med) tr.f0 *= 2;
        if (tr.f0 < FMIN || tr.f0 > FMAX) { tr.voisee = false; tr.f0 = 0; }
      }
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

  /** Découpe la zone de parole en n syllabes, d'après les creux d'énergie et les coupures de voix. */
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

  function evaluerSyllabe(contour, attendu, poidsNiveau) {
    const distances = {};
    for (const cle of Object.keys(MODELES)) distances[cle] = distance(contour, MODELES[cle], poidsNiveau);
    const ordre = Object.keys(distances).sort((x, y) => distances[x] - distances[y]);
    const meilleur = ordre[0];
    const entendu = meilleur === '3b' ? '3' : meilleur;
    if (attendu === '5') return { entendu, verdict: 'neutre', distances };
    const acceptes = ACCEPTES[attendu];
    const dAttendu = Math.min(...acceptes.map(c => distances[c]));
    let verdict;
    if (acceptes.includes(meilleur)) verdict = 'juste';
    else if (dAttendu <= distances[meilleur] * 1.25 + 0.3) verdict = 'presque';
    else verdict = 'a_reprendre';
    const attenduBase = attendu === '3b' ? '3' : attendu;
    let conseil = null;
    if (verdict !== 'juste') {
      conseil = (CONSEILS[attenduBase] && CONSEILS[attenduBase][entendu]) ||
        'Écoute le modèle et exagère la forme du ' + NOMS_TONS[attendu] + '.';
    }
    return { entendu, verdict, distances, conseil };
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

    const { frontieres, approximatif } = decouper(trames, a, b, n);
    const bornes = [a, ...frontieres, b + 1];

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
      const ev = evaluerSyllabe(contour, s.surface, poidsNiveau);
      return Object.assign(base, { contour, entendu: ev.entendu, verdict: ev.verdict, distances: ev.distances, conseil: ev.conseil });
    });

    const notees = syllabes.filter(s => s.verdict !== 'neutre');
    const points = notees.reduce((p, s) => p + (s.verdict === 'juste' ? 1 : s.verdict === 'presque' ? 0.5 : 0), 0);
    const score = notees.length ? Math.round(100 * points / notees.length) : 100;

    const marge = 5;
    const courbe = [];
    for (let i = Math.max(0, a - marge); i <= Math.min(trames.length - 1, b + marge); i++) {
      const t = trames[i];
      courbe.push({ t: t.t, st: t.voisee ? st(t.f0) : null, db: 20 * Math.log10(t.rms + 1e-7) });
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
      approximatif
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
    version: '0.1.0',
    MODELES, NOMS_TONS,
    pinyinAccentue, preparerPhrase, tonsDeSurface,
    analyser, comparerTexte,
    _interne: { reechantillonner, extraireTrames, decouper, distance, evaluerSyllabe, SR, HOP }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MoteurVoix;
  else racine.MoteurVoix = MoteurVoix;
})(typeof window !== 'undefined' ? window : globalThis);
