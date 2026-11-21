/* Diagnostic des traits : dit à l'élève ce qui ne va pas, en mots simples.
 * Entrées : les lignes médianes des traits (données Make Me a Hanzi, repère 1024, y vers le haut, de -124 à 900)
 * et le trait dessiné par l'élève (même repère : Hanzi Writer le fournit dans strokeData.drawnPath.points).
 * Sans DOM, sans dépendance : réutilisable dans le jeu. */
(function (racine) {
  'use strict';

  // ---------- géométrie ----------
  const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const P = p => Array.isArray(p) ? p : [p.x, p.y];
  function longueur(pts) { let l = 0; for (let i = 1; i < pts.length; i++) l += d2(pts[i - 1], pts[i]); return l; }
  function centre(pts) { const n = pts.length; return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n]; }
  function angle(a, b) { return Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; }        // 0 = vers la droite, 90 = vers le haut
  function ecartAngle(a, b) { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  function reechantillonner(pts, n) {
    const L = longueur(pts); if (!L) return Array(n).fill(pts[0]);
    const res = [pts[0]]; let cible = L / (n - 1), acc = 0;
    for (let i = 1; i < pts.length && res.length < n; i++) {
      let a = pts[i - 1], b = pts[i], seg = d2(a, b);
      while (acc + seg >= cible && res.length < n) {
        const t = (cible - acc) / seg; const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        res.push(p); seg -= (cible - acc); a = p; acc = 0;
      }
      acc += seg;
    }
    while (res.length < n) res.push(pts[pts.length - 1]);
    return res;
  }
  // simplification Douglas-Peucker : garde les coins
  function simplifier(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const [a, b] = [pts[0], pts[pts.length - 1]];
    let imax = 0, dmax = 0;
    const L = d2(a, b) || 1;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      const d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L;
      if (d > dmax) { dmax = d; imax = i; }
    }
    if (dmax <= eps) return [a, b];
    return simplifier(pts.slice(0, imax + 1), eps).slice(0, -1).concat(simplifier(pts.slice(imax), eps));
  }
  function distanceMoyenne(a, b) { // deux tracés rééchantillonnés, dans le même sens
    const A = reechantillonner(a, 16), B = reechantillonner(b, 16);
    return A.reduce((s, p, i) => s + d2(p, B[i]), 0) / 16;
  }

  // ---------- nature d'un trait ----------
  function direction(a) {   // a : angle en degrés, repère y vers le haut
    if (a > -25 && a <= 25) return 'droite';
    if (a > 25 && a <= 75) return 'monte';         // 提
    if (a > 75 && a <= 115) return 'haut';
    if (a > 115 || a <= -165) return 'gauche';
    if (a > -165 && a <= -112) return 'basgauche';  // 撇
    if (a > -112 && a <= -68) return 'bas';         // 竖
    return 'basdroite';                             // 捺, 点
  }
  /* Découpe un trait en morceaux droits ; repère coude (折) et crochet (钩). */
  function analyser(pts, estDessin) {
    pts = pts.map(P);
    const L = longueur(pts);
    const simp = simplifier(pts, Math.max(28, L * (estDessin ? 0.07 : 0.05)));
    let morceaux = [];
    for (let i = 1; i < simp.length; i++) {
      const l = d2(simp[i - 1], simp[i]); if (l < 1) continue;
      morceaux.push({ a: angle(simp[i - 1], simp[i]), l, de: simp[i - 1], a2: simp[i] });
    }
    // fusionne les morceaux presque alignés (courbes douces)
    const fus = [];
    morceaux.forEach(m => {
      const p = fus[fus.length - 1];
      if (p && ecartAngle(p.a, m.a) < 40) { p.a2 = m.a2; p.l += m.l; p.a = angle(p.de, p.a2); } else fus.push({ ...m });
    });
    morceaux = fus.length ? fus : [{ a: angle(pts[0], pts[pts.length - 1]), l: L, de: pts[0], a2: pts[pts.length - 1] }];
    // attaque du pinceau : un tout petit morceau au départ, dans une autre direction, ne compte pas
    while (morceaux.length > 1 && morceaux[0].l < Math.max(0.18 * L, 30) && ecartAngle(morceaux[0].a, morceaux[1].a) > 30) {
      const m = morceaux.shift(); morceaux[0].de = m.de; morceaux[0].l += m.l;
    }
    const dernier = morceaux[morceaux.length - 1], avant = morceaux[morceaux.length - 2];
    const crochet = !!(avant && dernier.l < Math.max(0.3 * L, 40) && dernier.l < 200 && ecartAngle(avant.a, dernier.a) > 70
      && ['haut', 'gauche', 'monte', 'basgauche'].includes(direction(dernier.a)) && ['bas', 'droite', 'basdroite', 'basgauche'].includes(direction(avant.a)));
    const corps = crochet ? morceaux.slice(0, -1) : morceaux;
    const coudes = corps.length - 1;
    const premier = morceaux[0];
    const dir0 = direction(premier.a);
    const point = L < 265 && !crochet && coudes === 0 && (dir0 === 'basdroite' || dir0 === 'bas' || dir0 === 'basgauche');
    const ccrochet = crochet ? direction(dernier.a) : null;
    const p6 = pts[Math.floor(pts.length * 0.6)];
    const courbeGauche = pts[pts.length - 1][0] - p6[0] < -90;
    return { L, morceaux, crochet, ccrochet, coudes, point, dir0, courbeGauche, debut: pts[0], fin: pts[pts.length - 1], centre: centre(pts) };
  }

  const NOMS_DIR = {
    droite: 'de gauche à droite', bas: 'de haut en bas', basgauche: 'en descendant vers la gauche',
    basdroite: 'en descendant vers la droite', monte: 'en montant vers la droite', haut: 'vers le haut', gauche: 'vers la gauche',
  };
  /* Nom chinois et conseil pour un trait attendu. */
  function decrire(an) {
    if (an.point) return { nom: '点', fr: 'un point', conseil: 'pose le doigt, appuie, puis relâche en glissant à peine' };
    const base = { droite: '横', bas: '竖', basgauche: '撇', basdroite: '捺', monte: '提', haut: '竖', gauche: '横' }[an.dir0] || '';
    let nom = base, fr, conseil;
    const d = an.morceaux.map(m => direction(m.a));
    if (an.coudes >= 1) {
      const suite = d.slice(0, an.coudes + 1);
      nom = base + (suite[1] === 'basgauche' ? '撇' : suite[1] === 'droite' ? '折' : '折');
      if (base === '横' && suite[1] === 'basgauche') nom = '横撇';
      else if (base === '竖' && suite[1] === 'droite') nom = '竖折';
      else if (base === '撇' && suite[1] === 'droite') nom = '撇折';
      else if (base === '横' && (suite[1] === 'bas' || suite[1] === 'basdroite')) nom = '横折';
      fr = 'un trait qui tourne : ' + suite.map(x => NOMS_DIR[x]).join(', puis ');
      conseil = 'ne lève pas le doigt au coude : marque un petit arrêt et repars dans l\'autre direction';
    } else if (base === '竖' && !an.crochet && (an.courbeGauche || direction(angle(an.debut, an.fin)) === 'basgauche')) {
      nom = '竖撇'; fr = 'un trait vertical qui s\'incurve vers la gauche';
      conseil = 'de haut en bas, puis courbe vers la gauche en relâchant';
    } else {
      fr = { 横: 'un trait horizontal', 竖: 'un trait vertical', 撇: 'un trait qui part vers la gauche (撇)', 捺: 'un trait qui part vers la droite (捺)', 提: 'un trait montant (提)' }[base] || 'un trait';
      conseil = {
        横: 'de gauche à droite, en montant très légèrement',
        竖: 'de haut en bas, bien droit',
        撇: 'de haut en bas vers la gauche, en relâchant à la fin : le trait s\'affine',
        捺: 'de haut à gauche vers bas à droite : appuie vers la fin, puis étire',
        提: 'de bas à gauche vers haut à droite, d\'un petit coup rapide',
      }[base] || NOMS_DIR[an.dir0];
    }
    if (an.crochet) {
      nom += '钩';
      fr += ', avec un crochet à la fin';
      conseil += ' ; finis par un petit coup sec ' + (an.ccrochet === 'gauche' || an.ccrochet === 'basgauche' ? 'vers la gauche' : an.ccrochet === 'monte' ? 'vers le haut à droite' : 'vers le haut') + ', sans lever avant';
    }
    const SURS = ['横', '竖', '撇', '捺', '提', '横折', '横撇', '竖钩', '横钩', '横折钩', '竖折', '撇折', '竖撇'];
    return { nom: SURS.includes(nom) ? nom : '', fr, conseil };
  }

  function ou(c) { // position dans la grille, repère y vers le haut (-124 … 900)
    const x = c[0] < 360 ? 'à gauche' : c[0] > 664 ? 'à droite' : '';
    const y = c[1] > 560 ? 'en haut' : c[1] < 216 ? 'en bas' : '';
    if (!x && !y) return 'au centre';
    return [y, x].filter(Boolean).join(' ');
  }
  function versOu(dx, dy) {
    const m = [];
    if (dy > 110) m.push('plus haut'); else if (dy < -110) m.push('plus bas');
    if (dx > 110) m.push('plus à droite'); else if (dx < -110) m.push('plus à gauche');
    return m.join(' et ');
  }

  /* Diagnostic d'un trait faux. medianes : tous les traits du caractère ; n : le trait attendu ; dessin : points de l'élève.
     Renvoie { code, message, detail, trait } — code court pour le journal de recherche. */
  function diagnostiquer(medianes, n, dessin) {
    const att = medianes[n].map(P), pts = (dessin || []).map(P);
    const A = analyser(att, false), info = decrire(A);
    const num = n + 1;
    const base = { trait: num, nom: info.nom, fr: info.fr, conseil: info.conseil, ou: ou(A.centre) };
    if (pts.length < 2 || longueur(pts) < 25) {
      return { ...base, code: 'trop_court', court: A.point ? 'appuie un peu plus longtemps' : 'glisse le doigt, ne fais pas que toucher', message: A.point ? `Trait ${num} : c'est ${info.fr}. Appuie un peu plus longtemps.` : `Trait ${num} : glisse le doigt, ne fais pas que toucher.` };
    }
    const D = analyser(pts, true);
    // 1. ordre : le dessin ressemble beaucoup plus à un autre trait
    let meilleur = n, dmin = Infinity;
    medianes.forEach((m, i) => {
      const mm = m.map(P);
      const dd = Math.min(distanceMoyenne(pts, mm), distanceMoyenne(pts, mm.slice().reverse()) + 30);
      if (dd < dmin) { dmin = dd; meilleur = i; }
    });
    const dAtt = Math.min(distanceMoyenne(pts, att), distanceMoyenne(pts, att.slice().reverse()));
    if (meilleur !== n && dmin < 130 && dmin < dAtt * 0.6) {
      if (meilleur > n) return { ...base, autre: meilleur + 1, code: 'ordre', court: `ordre — tu as d'abord tracé le trait ${meilleur + 1}`, message: `Ordre des traits : celui-là, c'est le trait ${meilleur + 1}. Avant, le trait ${num} : ${info.fr}, ${base.ou}.` };
      return { ...base, autre: meilleur + 1, code: 'deja_fait', court: `tu as repassé le trait ${meilleur + 1}, déjà fait`, message: `Ce trait est déjà fait. Maintenant le trait ${num} : ${info.fr}, ${base.ou}.` };
    }
    // 2. sens : départ et arrivée inversés
    const direct = d2(pts[0], att[0]) + d2(pts[pts.length - 1], att[att.length - 1]);
    const inverse = d2(pts[0], att[att.length - 1]) + d2(pts[pts.length - 1], att[0]);
    if (inverse < direct * 0.7 && !A.point) {
      return { ...base, code: 'sens', court: `dans l'autre sens — commence ${ou(att[0])}`, message: `Trait ${num} : dans l'autre sens. On l'écrit ${NOMS_DIR[A.dir0]} — commence ${ou(att[0])}.` };
    }
    // 3. forme : point, crochet, coude
    if (A.point && D.L > 1.8 * A.L + 60) return { ...base, code: 'point', court: 'c\'est un simple point : court', message: `Trait ${num} : c'est un simple point. ${cap(info.conseil)}.` };
    if (A.coudes > D.coudes) return { ...base, code: 'coude_oublie', court: 'ne lève pas le doigt au coude', message: `Trait ${num} : c'est ${info.fr}. Ne lève pas le doigt au coude.` };
    if (A.crochet && !D.crochet) return { ...base, code: 'crochet_oublie', court: 'il finit par un crochet', message: `Trait ${num} : il finit par un crochet. ${cap(info.conseil.split(' ; ')[1] || 'Finis par un petit coup sec')}.` };
    if (!A.crochet && D.crochet && D.L > 150) return { ...base, code: 'crochet_en_trop', court: 'pas de crochet, arrête-toi net', message: `Trait ${num} : pas de crochet ici, arrête-toi net à la fin.` };
    if (A.coudes < D.coudes && !A.point) return { ...base, code: 'coude_en_trop', court: 'd\'un seul mouvement, sans tourner', message: `Trait ${num} : ${info.fr}, d'un seul mouvement, sans tourner.` };
    if (!A.point && D.coudes === 0 && A.coudes === 0 && ecartAngle(A.morceaux[0].a, D.morceaux[0].a) > 35) {
      return { ...base, code: 'direction', court: `direction : ${NOMS_DIR[A.dir0] || 'à revoir'}`, message: `Trait ${num} : la direction n'est pas la bonne. ${cap(info.conseil)}.` };
    }
    // 4. place et longueur
    if (d2(pts[0], att[0]) < 150) {
      if (D.L < 0.6 * A.L) return { ...base, code: 'court', court: 'trop court, va jusqu\'au bout', message: `Trait ${num} : bon départ, mais trop court — va jusqu'au bout.` };
      if (D.L > 1.6 * A.L) return { ...base, code: 'long', court: 'trop long, arrête-toi plus tôt', message: `Trait ${num} : bon départ, mais trop long — arrête-toi plus tôt.` };
    }
    const ca = A.centre, cd = D.centre;
    const v = versOu(ca[0] - cd[0], ca[1] - cd[1]);
    if (v) return { ...base, code: 'place', court: `bonne forme, mais ${v}`, message: `Trait ${num} : bonne forme, mais ${v}.` };
    if (D.L < 0.6 * A.L) return { ...base, code: 'court', court: 'trop court, va jusqu\'au bout', message: `Trait ${num} : trop court, va jusqu'au bout.` };
    if (D.L > 1.6 * A.L) return { ...base, code: 'long', court: 'trop long, arrête-toi plus tôt', message: `Trait ${num} : trop long, arrête-toi plus tôt.` };
    return { ...base, code: 'forme', court: `regarde la forme : ${info.fr}`, message: `Trait ${num} : ${info.fr}, ${base.ou}. ${cap(info.conseil)}.` };
  }
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

  /* Petite planche SVG : le caractère en gris, les traits à revoir en rouge, numérotés, avec le point de départ et le sens. */
  function planche(data, traits, taille) {
    const t = taille || 150;
    const enRouge = new Set(traits);
    const chemins = data.strokes.map((s, i) => `<path d="${s}" fill="${enRouge.has(i + 1) ? '#b4412e' : '#cfc8bf'}"/>`).join('');
    const marques = traits.map(num => {
      const m = data.medians[num - 1]; if (!m) return '';
      const pts = m.map(p => [p[0], 900 - p[1]]);
      const ligne = pts.map(p => p.join(',')).join(' ');
      const [x, y] = pts[0];
      return `<polyline points="${ligne}" fill="none" stroke="#1c2220" stroke-width="14" stroke-dasharray="34 22" marker-end="url(#fl)"/>
        <circle cx="${x}" cy="${y}" r="44" fill="#fff" stroke="#1c2220" stroke-width="10"/>
        <text x="${x}" y="${y + 24}" text-anchor="middle" font-size="68" font-family="system-ui,sans-serif" font-weight="600" fill="#1c2220">${num}</text>`;
    }).join('');
    return `<svg viewBox="0 0 1024 1024" width="${t}" height="${t}" role="img" aria-label="Traits à revoir : ${traits.join(', ')}">
      <defs><marker id="fl" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M1 1L9 5L1 9z" fill="#1c2220"/></marker></defs>
      <rect x="4" y="4" width="1016" height="1016" fill="#fffefa" stroke="#e6d6d2" stroke-width="8"/>
      <g transform="translate(0,900) scale(1,-1)">${chemins}</g>${marques}</svg>`;
  }

  racine.DiagnosticTraits = { analyser, decrire, diagnostiquer, planche, ou };
})(typeof window !== 'undefined' ? window : globalThis);
