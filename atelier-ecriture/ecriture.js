/* Atelier d'écriture — interface (téléphone, tablette, ordinateur).
 * Données : donnees/caracteres.js (généré depuis le lexique et les scènes du jeu) + ajouts importés d'Excel.
 * Tracé : Hanzi Writer, données de traits servies depuis traits/ (hors ligne) ou, à défaut, jsDelivr. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const VO = '../assets/audio/vo/zh/';
  const CDN_TRAITS = 'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/';
  const HAN = /[㐀-䶿一-鿿]/;

  // ---------- stockage ----------
  const stock = {
    lire(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    ecrire(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage plein ou interdit */ } },
  };
  const R = Object.assign({ tolerance: 1.5, parJour: 5, epaisseur: 0.085, pinyin: true, niveaux: ['1'], eleve: '', dictee: 'mot' },
    stock.lire('ecriture_reglages_v1') || {});
  const sauverR = () => stock.ecrire('ecriture_reglages_v1', R);

  const moteur = MoteurEcriture.creerMoteur({ stockage: stock });
  const journal = MoteurEcriture.creerJournal({ stockage: stock, eleve: () => R.eleve });
  if (!stock.lire('ecriture_migre_v1')) {
    const n = moteur.migrerPrototype(stock.lire('hanzi_srs_v1'));
    stock.ecrire('ecriture_migre_v1', { le: Date.now(), cartes: n });
  }

  // ---------- paquet : caractères du jeu + ajouts (Excel, Anki) ----------
  // ajouts[c] = { c, pinyin, sens, histoire, mnemo, noteProf, niveau, paquets:[nom], contextes:[{zh, fr, py, vo, synth, paquet}], mots:[…] }
  let PAR = {}, ORDRE = [];
  function lireAjouts() {
    const aj = stock.lire('ecriture_ajouts_v1') || {};
    Object.values(aj).forEach(a => { if (!a.paquets || !a.paquets.length) a.paquets = ['Excel']; a.mots = a.mots || []; a.contextes = a.contextes || []; });
    return aj;
  }
  function construirePaquet() {
    PAR = {}; ORDRE = [];
    (window.CARACTERES || []).forEach(d => { PAR[d.c] = JSON.parse(JSON.stringify(d)); PAR[d.c].paquets = []; ORDRE.push(d.c); });
    Object.values(lireAjouts()).forEach(a => {
      let d = PAR[a.c];
      if (!d) { d = PAR[a.c] = { c: a.c, pinyin: '', sens: '', niveau: 0, source: 'import', histoire: '', mnemo: '', mots: [], contextes: [], paquets: [] }; ORDRE.push(a.c); }
      ['histoire', 'mnemo', 'noteProf'].forEach(k => { if (a[k]) d[k] = a[k]; });
      ['pinyin', 'sens'].forEach(k => { if (a[k] && (a.force || !d[k] || d.source === 'import')) d[k] = a[k]; });
      if (a.niveau) d.niveau = a.niveau;
      d.importe = true;
      d.paquets = [...new Set(d.paquets.concat(a.paquets))];
      const deja = new Set(d.contextes.map(x => x.zh));
      d.contextes = a.contextes.filter(x => !deja.has(x.zh)).concat(d.contextes);
      const dejaM = new Set(d.mots.map(x => x.zh));
      d.mots = d.mots.concat(a.mots.filter(x => !dejaM.has(x.zh)));
    });
  }
  if (R.niveaux.includes('ajouts')) { R.niveaux = R.niveaux.filter(x => x !== 'ajouts').concat('p:Excel'); }
  construirePaquet();
  function etiquettes(d) {
    const t = d.paquets.map(n => 'p:' + n);
    if (d.source !== 'import' || d.niveau) t.push(d.niveau >= 1 && d.niveau <= 3 ? String(d.niveau) : 'autres');
    return t;
  }
  const liste = () => ORDRE.filter(c => etiquettes(PAR[c]).some(t => R.niveaux.includes(t)));
  function paquetsImportes() {
    const n = {}; Object.values(PAR).forEach(d => d.paquets.forEach(p => { n[p] = (n[p] || 0) + 1; })); return n;
  }

  // ---------- sons importés (IndexedDB : trop gros pour le stockage simple) ----------
  const sonsDB = {
    base: null,
    ouvrir() {
      if (this.base) return this.base;
      this.base = new Promise((ok, ko) => {
        const r = indexedDB.open('atelier-ecriture', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('sons');
        r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
      });
      return this.base;
    },
    async op(mode, f) { const db = await this.ouvrir(); return new Promise((ok, ko) => { const t = db.transaction('sons', mode); const r = f(t.objectStore('sons')); t.oncomplete = () => ok(r && r.result); t.onerror = () => ko(t.error); }); },
    mettre(k, blob) { return this.op('readwrite', st => st.put(blob, k)); },
    lire(k) { return this.op('readonly', st => st.get(k)); },
    async retirerPrefixe(p) { const db = await this.ouvrir(); return new Promise(ok => { const t = db.transaction('sons', 'readwrite'); t.objectStore('sons').delete(IDBKeyRange.bound(p, p + '￿')); t.oncomplete = ok; t.onerror = ok; }); },
  };

  // ---------- traceur (Hanzi Writer dans une grille 米字格) ----------
  function chargerTraits(c, ok, ko) {
    const local = (window.TRAITS_EMBARQUES || '').includes(c);
    fetch((local ? 'traits/' : CDN_TRAITS) + encodeURIComponent(c) + '.json')
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(ok)
      .catch(e => { if (local) { fetch(CDN_TRAITS + encodeURIComponent(c) + '.json').then(r => r.json()).then(ok).catch(ko); } else ko(e); });
  }
  // la grille entière doit tenir à l'écran sous le sens et le pinyin, sans faire défiler pendant qu'on écrit
  function taille(zone) {
    const larg = document.querySelector('.page').clientWidth - 30;
    const haut = zone ? innerHeight - (zone.getBoundingClientRect().top + scrollY) - 14 : innerHeight * 0.5;
    return Math.max(240, Math.floor(Math.min(larg, haut < 240 ? innerHeight - 24 : haut, 520)));
  }
  function grilleVisible(zone) {
    const r = zone.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) zone.scrollIntoView({ block: r.height > innerHeight - 40 ? 'start' : 'end' });
  }
  let saisie = 'inconnue';
  function creerTraceur(zone, c, etape, rappels) {
    zone.innerHTML = '';
    const t = taille(zone), NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('id', zone.id === 'zone' ? 'cible' : 'dCible'); svg.setAttribute('width', t); svg.setAttribute('height', t);
    svg.style.cssText = 'display:block;background:#fffefa;border:2px solid var(--cinabre);border-radius:6px;touch-action:none';
    const lignes = [[0, 0, t, t], [t, 0, 0, t], [t / 2, 0, t / 2, t], [0, t / 2, t, t / 2]];
    lignes.forEach(([a, b, c2, d], i) => {
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', a); l.setAttribute('y1', b); l.setAttribute('x2', c2); l.setAttribute('y2', d);
      l.setAttribute('stroke', i < 2 ? '#efe6e3' : '#e6d6d2'); l.setAttribute('stroke-dasharray', '6 6');
      svg.appendChild(l);
    });
    zone.appendChild(svg);
    svg.addEventListener('pointerdown', e => { saisie = e.pointerType || 'inconnue'; }, { capture: true });
    const w = HanziWriter.create(svg, c, {
      width: t, height: t, padding: Math.round(t * 0.06), showCharacter: false, showOutline: etape === 1,
      outlineColor: '#d8cbbf', strokeColor: '#1c2220', highlightColor: '#b4412e', drawingColor: '#2a2a2a',
      drawingWidth: Math.max(10, Math.round(t * R.epaisseur)), strokeAnimationSpeed: 1.2, delayBetweenStrokes: 220,
      showHintAfterMisses: etape === 3 ? 3 : 1, highlightOnComplete: true,
      charDataLoader: (car, onLoad, onError) => chargerTraits(car, onLoad, e => { onError(e); rappels.erreur && rappels.erreur(e); }),
    });
    function quiz() {
      w.quiz({
        leniency: R.tolerance,
        onMistake: s => rappels.erreurTrait && rappels.erreurTrait(s),
        onCorrectStroke: s => rappels.traitJuste && rappels.traitJuste(s),
        onComplete: s => rappels.fini && rappels.fini(s),
      });
    }
    quiz();
    requestAnimationFrame(() => grilleVisible(zone));
    return { w, quiz, taille: t };
  }

  // ---------- audio : voix du jeu, synthèse du navigateur en secours ----------
  let audioCourant = null;
  function jouer(vo, texte, vitesse, quoi) {
    if (audioCourant) { audioCourant.pause(); audioCourant = null; }
    journal.ajouter({ evenement: 'ecoute', mode: vueActive, caractere: (etat && etat.c) || '', detail: (quoi || '') + ':' + (vo || 'synthese') + (vitesse && vitesse < 1 ? ':lent' : '') });
    const synthese = () => {
      if (!('speechSynthesis' in window) || !texte) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(texte); u.lang = 'zh-CN'; u.rate = (vitesse || 1) * 0.85; speechSynthesis.speak(u);
    };
    if (!vo) return synthese();
    const lancer = url => { const a = new Audio(url); a.playbackRate = vitesse || 1; audioCourant = a; a.play().catch(synthese); };
    if (vo.startsWith('idb:')) {
      sonsDB.lire(vo.slice(4)).then(b => b ? lancer(URL.createObjectURL(b)) : synthese()).catch(synthese);
      return;
    }
    lancer(VO + vo + '.mp3');
  }

  // ---------- pinyin ----------
  function majPinyin() {
    $('btnPinyin').textContent = R.pinyin ? 'Masquer le pinyin' : 'Afficher le pinyin';
    $('btnPinyin').setAttribute('aria-pressed', String(R.pinyin));
    $('pinyin').classList.toggle('cache', !R.pinyin && !(etat && etat.fini));
  }
  $('btnPinyin').onclick = () => {
    R.pinyin = !R.pinyin; sauverR(); majPinyin();
    journal.ajouter({ evenement: 'pinyin', mode: vueActive, caractere: (etat && etat.c) || '', pinyin_visible: R.pinyin });
  };

  // ---------- RÉVISER ----------
  let etat = null, traceur = null;
  const CONSIGNES = {
    1: 'Repasse sur le modèle, trait après trait.',
    2: 'Écris-le. Si un trait se trompe, le bon s\'allume.',
    3: 'De mémoire. Après trois erreurs, un indice apparaît.',
  };
  const cacher = (s, c) => s.split(c).join('\u0000');
  function htmlContexte(zh, c, revele) {
    const esc = s => s.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
    return cacher(zh, c).split('\u0000').map(esc).join(revele ? '<span class="vise">' + c + '</span>' : '<span class="trou"></span>');
  }
  function majCompteurs() {
    const l = liste(), S = moteur.etat(), t = Date.now();
    const dues = l.filter(c => S[c] && S[c].vu && S[c].etape === 3 && S[c].due <= t).length;
    const appris = l.filter(c => S[c] && S[c].reps > 0).length;
    const nv = Math.max(0, R.parJour - moteur.nouveauxDuJour());
    $('compteurs').innerHTML = `<span>À réviser <b>${dues}</b></span><span>Nouveaux aujourd'hui <b>${nv}</b></span><span>Écrits de mémoire <b>${appris}</b>/${l.length}</span>`;
  }
  function majEtapes(e) {
    document.querySelectorAll('#etapes .etape').forEach(x => {
      const n = +x.dataset.e;
      x.classList.toggle('active', n === e); x.classList.toggle('faite', n < e);
    });
  }
  function afficherMots(d, revele) {
    const m = d.mots.filter(x => x.zh !== d.c).slice(0, 3);
    $('mots').innerHTML = m.map(x => `<span class="hz">${revele ? x.zh.split(d.c).join('<span style="color:var(--cinabre)">' + d.c + '</span>') : x.zh.split(d.c).join('＿')}</span> ${x.fr}`).join(' · ');
  }
  function afficherContexte(revele) {
    const d = PAR[etat.c], x = etat.ctx;
    if (!x) {
      $('contexte').innerHTML = d.mots.length ? '' : '<div class="vide">Pas encore de phrase du jeu pour ce caractère.</div>';
      return;
    }
    $('contexte').innerHTML = `<div class="zh">${htmlContexte(x.zh, d.c, revele)}</div>${revele && R.pinyin && x.py ? '<div class="fr" style="color:var(--cinabre)">' + x.py + '</div>' : ''}<div class="fr">${revele ? x.fr : x.fr.split(d.c).join('＿')}</div>${x.paquet ? '<div class="aide">' + x.paquet + '</div>' : ''}
      <div class="boutons" style="margin-top:6px"><button class="btn son discret" id="btnPhrase" type="button">Phrase</button>
      ${d.contextes.length > 1 ? '<button class="btn discret" id="btnAutre" type="button">Autre phrase</button>' : ''}</div>`;
    const bp = $('btnPhrase'); if (bp) bp.onclick = () => jouer(x.vo, x.zh, 1, 'phrase');
    const ba = $('btnAutre'); if (ba) ba.onclick = () => {
      const avant = etat.ctx.zh; let essai = 0;
      do { etat.ctx = moteur.choisirContexte(etat.c, d.contextes).ctx; } while (etat.ctx.zh === avant && ++essai < 8);
      etat.ctxNouveau = moteur.choisirContexte(etat.c, [etat.ctx]).nouveau;
      afficherContexte(revele);
    };
  }
  function motAudio(d) { return d.mots.find(m => m.zh === d.c && m.vo) || d.mots.find(m => m.vo) || null; }

  function ouvrir(c, type, etapeForcee) {
    const d = PAR[c]; if (!d) return;
    const k = moteur.carte(c);
    let e = etapeForcee || (type === 'nouveau' ? 1 : k.etape || 1);
    const ch = moteur.choisirContexte(c, d.contextes);
    etat = { c, type, etape: e, rattrapage: !!k.retourMemoire && e === 2, ctx: ch.ctx, ctxNouveau: ch.nouveau };
    $('repos').hidden = true; $('carte').hidden = false;
    lancerEtape(e);
  }
  function lancerEtape(e) {
    const d = PAR[etat.c];
    scrollTo(0, 0);
    Object.assign(etat, { etape: e, debut: Date.now(), erreurs: 0, parTrait: [], indices: 0, ordreMontre: false, fini: false, traitCourant: 0 });
    majEtapes(e); majCompteurs();
    $('sens').textContent = d.sens || '—';
    $('pinyin').textContent = d.pinyin || '';
    majPinyin();
    const ma = motAudio(d);
    $('btnMot').hidden = !ma && !d.pinyin;
    $('btnMot').onclick = () => ma ? jouer(ma.vo, ma.zh, 1, 'mot') : jouer('', d.c, 1, 'mot');
    $('btnMot').textContent = ma && ma.zh !== d.c ? ma.zh.split(d.c).join('＿') : 'Écouter';
    afficherMots(d, e === 1); afficherContexte(e === 1);
    $('retour').className = 'retour'; $('retour').textContent = CONSIGNES[e];
    $('btnSuite').hidden = true; $('histoire').hidden = true; $('aides').hidden = false;
    traceur = creerTraceur($('zone'), etat.c, e, {
      erreurTrait: s => { etat.erreurs++; etat.parTrait[s.strokeNum] = (etat.parTrait[s.strokeNum] || 0) + 1; },
      traitJuste: s => { etat.traitCourant = s.strokeNum + 1; },
      fini: () => finTrace(),
      erreur: () => { $('retour').className = 'retour ko'; $('retour').textContent = 'Données de traits introuvables pour ce caractère (connexion ?).'; },
    });
  }
  function finTrace() {
    if (etat.fini) return; etat.fini = true;
    const d = PAR[etat.c], e = etat.etape;
    const aide = e === 3 && (etat.indices > 0 || etat.ordreMontre);
    const r = moteur.noter(etat.c, e, etat.erreurs, aide);
    moteur.marquerContexte(etat.c, etat.ctx && etat.ctx.zh);
    const nbTraits = traceur.w._character ? traceur.w._character.strokes.length : '';
    journal.ajouter({
      evenement: 'trace', mode: 'revision', caractere: etat.c, etape: e, type_carte: etat.rattrapage ? 'rattrapage' : etat.type,
      nb_traits: nbTraits, erreurs: etat.erreurs, erreurs_par_trait: Array.from({ length: nbTraits || etat.parTrait.length }, (_, i) => etat.parTrait[i] || 0).join('-'),
      indices: etat.indices, ordre_montre: etat.ordreMontre, duree_ms: Date.now() - etat.debut, resultat: r.resultat,
      prochain_intervalle_j: e === 3 ? r.carte.ivl : '', contexte: etat.ctx ? etat.ctx.zh : '', contexte_nouveau: etat.ctx ? etat.ctxNouveau : '',
      pinyin_visible: R.pinyin, tolerance: R.tolerance, saisie, ecran: innerWidth + 'x' + innerHeight,
    });
    afficherMots(d, true); afficherContexte(true); majPinyin(); majCompteurs();
    const b = $('btnSuite'), m = $('retour');
    $('aides').hidden = true; b.hidden = false;
    if (e < 3) {
      if (r.resultat === 'refaire') {
        m.className = 'retour moyen'; m.textContent = 'Encore une fois cette étape, tranquillement.';
        b.textContent = 'Recommencer l\'étape ' + e + ' →'; b.onclick = () => lancerEtape(e);
      } else if (etat.rattrapage) {
        moteur.finRattrapage(etat.c);
        m.className = 'retour ok'; m.textContent = 'Bien. Tu le réécriras de mémoire dans 10 minutes.';
        b.textContent = 'Suite →'; b.onclick = () => suivante();
      } else {
        m.className = 'retour ok'; m.textContent = (etat.erreurs === 0 ? 'Parfait. ' : 'Bien. ') + 'Étape suivante : ' + (e === 1 ? 'guidé.' : 'de mémoire.');
        b.textContent = 'Étape ' + (e + 1) + ' : ' + (e === 1 ? 'guidé' : 'de mémoire') + ' →'; b.onclick = () => lancerEtape(e + 1);
      }
    } else {
      if (r.resultat === 'a_revoir') {
        m.className = 'retour ko'; m.textContent = 'À revoir : on repasse par l\'étape guidée.';
        b.textContent = 'Étape 2 : guidé →'; b.onclick = () => { etat.rattrapage = true; lancerEtape(2); };
      } else {
        m.className = 'retour ok';
        m.textContent = (r.resultat === 'parfait' ? 'Parfait ! ' : 'Bien. ') + 'Prochaine fois dans ' + r.carte.ivl + (r.carte.ivl > 1 ? ' jours.' : ' jour.');
        b.textContent = 'Suite →'; b.onclick = () => suivante();
      }
      afficherHistoire(d);
    }
    b.focus({ preventScroll: true });
  }
  function afficherHistoire(d) {
    if (!d.histoire && !d.mnemo && !d.noteProf) { $('histoire').hidden = true; return; }
    $('histoire').innerHTML = `<div class="grand">${d.c}</div>${d.histoire ? '<b>Histoire :</b> ' + d.histoire + '<br>' : ''}${d.mnemo ? '<b>Pour s\'en souvenir :</b> ' + d.mnemo + '<br>' : ''}${d.noteProf ? '<b>Note du cours :</b> ' + d.noteProf : ''}`;
    $('histoire').hidden = false;
  }
  function suivante() {
    const r = moteur.prochaine(liste(), R, etat && etat.c);
    if (r) return ouvrir(r.c, r.type);
    repos();
  }
  function repos() {
    $('carte').hidden = true; $('repos').hidden = false; majCompteurs();
    const p = moteur.prochaineEcheance(liste());
    const quand = p ? delai(p - Date.now()) : null;
    $('repos').innerHTML = `<h2>Pause</h2><p>Rien à réviser pour l'instant${quand ? ' : prochaine révision ' + quand : ''}.</p>
      <div class="boutons" style="justify-content:flex-start">
        <button class="btn principal" id="rNouveaux" type="button">5 caractères de plus</button>
        <button class="btn" id="rAvance" type="button">Réviser en avance</button>
        <button class="btn" id="rDictee" type="button">Faire une dictée</button></div>`;
    $('rNouveaux').onclick = () => { R.parJour += 5; sauverR(); majReglages(); suivante(); };
    $('rAvance').onclick = () => { const r = moteur.enAvance(liste(), null); if (r) ouvrir(r.c, r.type, moteur.estNouveau(r.c) ? 1 : 3); };
    $('rDictee').onclick = () => montrerVue('dictee');
  }
  function delai(ms) {
    const mn = Math.round(ms / 6e4);
    if (mn < 60) return 'dans ' + Math.max(1, mn) + ' min';
    const h = Math.round(mn / 60); if (h < 24) return 'dans ' + h + ' h';
    const j = Math.round(h / 24); return 'dans ' + j + (j > 1 ? ' jours' : ' jour');
  }
  $('btnOrdre').onclick = () => {
    if (!traceur || etat.fini) return;
    etat.ordreMontre = true;
    journal.ajouter({ evenement: 'ordre', mode: 'revision', caractere: etat.c, etape: etat.etape });
    const w = traceur.w; w.cancelQuiz(); w.showOutline();
    w.animateCharacter({ onComplete: () => { if (etat.etape !== 1) w.hideOutline(); w.hideCharacter(); etat.traitCourant = 0; traceur.quiz(); } });
  };
  $('btnIndice').onclick = () => {
    if (!traceur || etat.fini) return;
    etat.indices++;
    journal.ajouter({ evenement: 'indice', mode: 'revision', caractere: etat.c, etape: etat.etape, detail: 'trait ' + (etat.traitCourant + 1) });
    traceur.w.highlightStroke(etat.traitCourant);
  };
  $('btnEffacer').onclick = () => {
    if (!traceur || etat.fini) return;
    journal.ajouter({ evenement: 'recommencer', mode: 'revision', caractere: etat.c, etape: etat.etape });
    etat.traitCourant = 0; traceur.w.cancelQuiz(); traceur.quiz();
  };
  $('btnPasser').onclick = () => {
    journal.ajouter({ evenement: 'passer', mode: 'revision', caractere: etat ? etat.c : '', etape: etat ? etat.etape : '' });
    suivante();
  };

  // ---------- DICTÉE ----------
  let dic = null, dTraceur = null;
  function appris(c) { const k = moteur.etat()[c]; return !!(k && k.vu && k.etape === 3); }
  function itemsDictee() {
    const l = new Set(liste());
    const dispo = c => !!PAR[c];
    if (R.dictee === 'mot') {
      const vus = new Set(), items = [];
      liste().forEach(c => PAR[c].mots.forEach(m => {
        if (vus.has(m.id) || (!m.vo && !m.synth)) return; vus.add(m.id);
        const cs = [...m.zh].filter(x => HAN.test(x));
        if (!cs.length || !cs.every(x => l.has(x))) return;  // seulement des mots entièrement dans le paquet choisi
        items.push({ zh: m.zh, fr: m.fr, py: m.py, vo: m.vo, cibles: cs.map((_, i) => i).filter(i => HAN.test([...m.zh][i])), score: cs.filter(appris).length / cs.length });
      }));
      return items;
    }
    const vus = new Set(), items = [];
    liste().forEach(c => PAR[c].contextes.forEach(x => {
      if (vus.has(x.zh) || (!x.vo && !x.synth)) return; vus.add(x.zh);
      const cars = [...x.zh];
      let cibles = cars.map((ch, i) => i).filter(i => appris(cars[i]) && l.has(cars[i]));
      if (!cibles.length) cibles = cars.map((ch, i) => i).filter(i => l.has(cars[i]) && dispo(cars[i])).slice(0, 1);
      if (!cibles.length) return;
      items.push({ zh: x.zh, fr: x.fr, vo: x.vo, cibles: cibles.slice(0, 3), score: cibles.filter(i => appris(cars[i])).length / cibles.length });
    }));
    return items;
  }
  function nouvelleDictee(jouerAuto) {
    const items = itemsDictee();
    if (!items.length) { $('dRetour').className = 'retour ko'; $('dRetour').textContent = 'Pas de dictée possible avec ce paquet.'; return; }
    const meilleurs = items.filter(x => x.score === 1), moyens = items.filter(x => x.score > 0);
    const pool = meilleurs.length >= 3 ? meilleurs : moyens.length ? moyens : items;
    const it = pool[Math.floor(Math.random() * pool.length)];
    dic = { it, i: 0, erreurs: {}, aides: {}, debut: Date.now(), cars: [...it.zh] };
    $('dTexte').innerHTML = ''; $('dRetour').className = 'retour';
    $('dRetour').textContent = meilleurs.length || moyens.length ? 'Écoute, puis écris.' : 'Ces caractères ne sont pas encore appris : commence par Réviser si c\'est trop dur.';
    $('dSuite').hidden = true; $('dAide').hidden = false;
    dessinerCases(); ecrireCible();
    if (jouerAuto) jouer(it.vo, it.zh, 1, 'dictee');
  }
  function dessinerCases() {
    const it = dic.it;
    $('dCases').innerHTML = it.cibles.map((ci, n) => {
      const fait = n < dic.i, actif = n === dic.i;
      return `<div class="case ${fait ? 'faite' : ''} ${actif ? 'active' : ''}">${fait ? dic.cars[ci] : ''}</div>`;
    }).join('');
  }
  function ecrireCible() {
    const ci = dic.it.cibles[dic.i], c = dic.cars[ci];
    dic.erreurs[ci] = dic.erreurs[ci] || 0;
    dTraceur = creerTraceur($('dZone'), c, 3, {
      erreurTrait: () => { dic.erreurs[ci]++; },
      fini: () => {
        journal.ajouter({ evenement: 'trace', mode: 'dictee_' + R.dictee, caractere: c, etape: 3, type_carte: appris(c) ? 'revision' : 'non_appris',
          erreurs: dic.erreurs[ci], indices: dic.aides[ci] ? 1 : 0, ordre_montre: !!dic.aides[ci], contexte: dic.it.zh, tolerance: R.tolerance,
          pinyin_visible: R.pinyin, saisie, ecran: innerWidth + 'x' + innerHeight,
          resultat: dic.aides[ci] || dic.erreurs[ci] > 2 ? 'a_revoir' : dic.erreurs[ci] ? 'bien' : 'parfait' });
        if (appris(c)) moteur.noter(c, 3, dic.erreurs[ci], !!dic.aides[ci]);
        dic.i++; dessinerCases();
        if (dic.i < dic.it.cibles.length) ecrireCible(); else finDictee();
      },
      erreur: () => { $('dRetour').className = 'retour ko'; $('dRetour').textContent = 'Données de traits introuvables (connexion ?).'; },
    });
  }
  function finDictee() {
    const tot = Object.values(dic.erreurs).reduce((a, b) => a + b, 0), aides = Object.keys(dic.aides).length;
    $('dRetour').className = 'retour ' + (tot === 0 && !aides ? 'ok' : tot <= 2 && !aides ? 'moyen' : 'ko');
    $('dRetour').textContent = tot === 0 && !aides ? 'Parfait !' : 'Fini — ' + tot + ' erreur' + (tot > 1 ? 's' : '') + (aides ? ', ' + aides + ' aide' + (aides > 1 ? 's' : '') : '') + '.';
    montrerTexte(true);
    $('dSuite').hidden = false; $('dAide').hidden = true; $('dSuite').focus({ preventScroll: true });
    journal.ajouter({ evenement: 'dictee', mode: 'dictee_' + R.dictee, contexte: dic.it.zh, erreurs: tot, indices: aides, duree_ms: Date.now() - dic.debut });
  }
  function montrerTexte(complet) {
    const it = dic.it;
    const zh = dic.cars.map((ch, i) => it.cibles.includes(i) && !complet && it.cibles.indexOf(i) >= dic.i ? '<span class="trou"></span>' : it.cibles.includes(i) ? `<span class="vise">${ch}</span>` : ch).join('');
    $('dTexte').innerHTML = `<div class="zh">${zh}</div><div class="fr">${it.fr}${complet && it.py ? ' · ' + it.py : ''}</div>`;
  }
  $('dEcouter').onclick = () => dic ? jouer(dic.it.vo, dic.it.zh, 1, 'dictee') : nouvelleDictee(true);
  $('dLent').onclick = () => dic && jouer(dic.it.vo, dic.it.zh, 0.72, 'dictee');
  $('dSens').onclick = () => { if (!dic) return; $('dTexte').innerHTML = `<div class="fr" style="font-size:1.1rem">${dic.it.fr}</div>`; journal.ajouter({ evenement: 'aide_sens', mode: 'dictee_' + R.dictee, contexte: dic.it.zh }); };
  $('dTrous').onclick = () => { if (!dic) return; montrerTexte(false); journal.ajouter({ evenement: 'aide_trous', mode: 'dictee_' + R.dictee, contexte: dic.it.zh }); };
  $('dAide').onclick = () => {
    if (!dic || !dTraceur) return;
    const ci = dic.it.cibles[dic.i]; dic.aides[ci] = true;
    const w = dTraceur.w; w.cancelQuiz(); w.showOutline();
    w.animateCharacter({ onComplete: () => { w.hideOutline(); w.hideCharacter(); dTraceur.quiz(); } });
  };
  $('dSuite').onclick = () => nouvelleDictee(true);
  document.querySelectorAll('#dicteeType button').forEach(b => b.onclick = () => {
    R.dictee = b.dataset.t; sauverR();
    document.querySelectorAll('#dicteeType button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $('dicteeAide').textContent = R.dictee === 'mot' ? 'On entend un mot, on l\'écrit.' : 'On entend une phrase du jeu, on écrit les caractères qui manquent.';
    nouvelleDictee(true);
  });

  // ---------- CARNET, paquet, réglages ----------
  function majCarnet() {
    const groupes = [['1', 'HSK 1'], ['2', 'HSK 2'], ['3', 'HSK 3'], ['autres', 'Autres']];
    const comptes = {}; ORDRE.forEach(c => etiquettes(PAR[c]).forEach(t => { comptes[t] = (comptes[t] || 0) + 1; }));
    const pq = paquetsImportes();
    Object.keys(pq).forEach(n => groupes.push(['p:' + n, '★ ' + n]));
    $('niveaux').innerHTML = groupes.map(([g, nom]) => comptes[g] ? `<button type="button" data-g="${g.replace(/"/g, '&quot;')}" aria-pressed="${R.niveaux.includes(g)}">${nom} · ${comptes[g]}</button>` : '').join('');
    document.querySelectorAll('#niveaux button').forEach(b => b.onclick = () => {
      const g = b.dataset.g, on = R.niveaux.includes(g);
      if (on && R.niveaux.length === 1) return;
      R.niveaux = on ? R.niveaux.filter(x => x !== g) : R.niveaux.concat(g); sauverR(); majCarnet(); majCompteurs();
    });
    $('listePaquets').innerHTML = Object.entries(pq).map(([n, k]) => `<div class="ligne-paquet"><span>★ ${n} · ${k} caractères</span>
      <button class="btn petit" type="button" data-seul="${n.replace(/"/g, '&quot;')}">Ne travailler que celui-ci</button>
      <button class="btn petit discret" type="button" data-renommer="${n.replace(/"/g, '&quot;')}">Renommer</button>
      <button class="btn petit discret" type="button" data-retirer="${n.replace(/"/g, '&quot;')}">Retirer</button></div>`).join('');
    document.querySelectorAll('[data-renommer]').forEach(b => b.onclick = () => renommerPaquet(b.dataset.renommer));
    document.querySelectorAll('[data-seul]').forEach(b => b.onclick = () => { R.niveaux = ['p:' + b.dataset.seul]; sauverR(); majCarnet(); majCompteurs(); });
    document.querySelectorAll('[data-retirer]').forEach(b => b.onclick = () => retirerPaquet(b.dataset.retirer));
    const l = liste();
    $('infoPaquet').textContent = l.length + ' caractères dans le paquet, dans l\'ordre où le jeu les enseigne.';
    $('carnetGrille').innerHTML = l.map(c => `<button type="button" class="n${moteur.niveau(c)}" data-c="${c}" title="${PAR[c].pinyin} ${PAR[c].sens}">${c}</button>`).join('');
    document.querySelectorAll('#carnetGrille button').forEach(b => b.onclick = () => {
      const c = b.dataset.c, k = moteur.etat()[c];
      montrerVue('reviser', true); ouvrir(c, 'choisi', k && k.vu ? (k.etape || 3) : 1);
    });
  }
  function segments(id, cle, conv) {
    document.querySelectorAll('#' + id + ' button').forEach(b => {
      b.setAttribute('aria-pressed', String(conv(b.dataset.v) === R[cle]));
      b.onclick = () => { R[cle] = conv(b.dataset.v); sauverR(); majReglages(); majCompteurs(); };
    });
  }
  function majReglages() { segments('tolerance', 'tolerance', Number); segments('parJour', 'parJour', Number); segments('epaisseur', 'epaisseur', Number); }

  $('fichier').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    e.target.value = '';
    if (/\.apkg$/i.test(f.name)) return importerAnki(f);
    const rd = new FileReader();
    rd.onload = ev => {
      const wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      const ajouts = lireAjouts(), paquet = f.name.replace(/\.(xlsx|xls|csv)$/i, '');
      let ajout = 0, maj = 0, horsLigne = 0;
      rows.forEach(r => {
        const c = String(r[0] || '').trim();
        if (!c || !HAN.test(c) || c.length !== 1) return;
        const ctx = String(r[5] || '').split(/\s*;\s*/).filter(Boolean).map(s => { const [zh, fr] = s.split('|'); return { zh: zh.trim(), fr: (fr || '').trim(), vo: '', synth: true, paquet }; });
        const niv = parseInt(String(r[6] || '').replace(/\D/g, ''), 10) || 0;
        if (PAR[c] || ajouts[c]) maj++; else ajout++;
        if (!(window.TRAITS_EMBARQUES || '').includes(c)) horsLigne++;
        const a = ajouts[c] || { c, contextes: [], mots: [], paquets: [] };
        a.pinyin = String(r[1] || '') || a.pinyin; a.sens = String(r[2] || '') || a.sens; a.histoire = String(r[3] || '') || a.histoire;
        a.mnemo = String(r[4] || '') || a.mnemo; a.niveau = niv || a.niveau; a.force = true;
        if (!a.paquets.includes(paquet)) a.paquets.push(paquet);
        const deja = new Set(a.contextes.map(x => x.zh)); a.contextes = a.contextes.concat(ctx.filter(x => !deja.has(x.zh)));
        ajouts[c] = a;
      });
      stock.ecrire('ecriture_ajouts_v1', ajouts);
      construirePaquet();
      if (!R.niveaux.includes('p:' + paquet)) R.niveaux.push('p:' + paquet); sauverR();
      majCarnet(); majCompteurs();
      $('infoImport').textContent = `${ajout} caractère(s) ajouté(s), ${maj} mis à jour. Progression conservée.` + (horsLigne ? ` ${horsLigne} caractère(s) chargeront leurs traits par internet.` : '');
      journal.ajouter({ evenement: 'import', detail: f.name + ':' + ajout + '+' + maj });
    };
    rd.readAsArrayBuffer(f);
  };

  /* Paquet Anki (.apkg) : chaque fiche devient une phrase de contexte (avec le son de la prof s'il y en a un),
     chaque caractère chinois des fiches devient un caractère à écrire. */
  async function importerAnki(f) {
    const info = $('infoImport');
    info.textContent = 'Lecture du paquet Anki…';
    let p;
    try { p = await ImportAnki.lire(await f.arrayBuffer(), f.name); }
    catch (err) { info.textContent = 'Lecture impossible : ' + err.message; return; }
    const nom = p.nom, fiches = p.notes.map(ImportAnki.analyserNote).filter(a => a.nbHan);
    const ajouts = lireAjouts(), pyCars = window.PINYIN_CARS || {};
    let sonsGardes = 0; const sonsUtiles = new Set(fiches.flatMap(a => a.sons));
    await sonsDB.retirerPrefixe(nom + '/');
    for (const [n, octets] of p.sons) {
      if (!sonsUtiles.has(n)) continue;
      const type = /\.ogg$/i.test(n) ? 'audio/ogg' : /\.wav$/i.test(n) ? 'audio/wav' : /\.m4a$/i.test(n) ? 'audio/mp4' : 'audio/mpeg';
      try { await sonsDB.mettre(nom + '/' + n, new Blob([octets], { type })); sonsGardes++; } catch (e) { /* stockage refusé */ }
    }
    const entree = c => {
      const a = ajouts[c] || (ajouts[c] = { c, contextes: [], mots: [], paquets: [] });
      if (!a.paquets.includes(nom)) a.paquets.push(nom);
      return a;
    };
    // on repart de zéro pour ce paquet (réimporter une version corrigée remplace l'ancienne)
    Object.values(ajouts).forEach(a => { a.contextes = a.contextes.filter(x => x.paquet !== nom); a.mots = a.mots.filter(x => x.paquet !== nom); });
    const cars = new Set(), nouveaux = new Set();
    let phrases = 0;
    fiches.forEach(a => {
      const son = a.sons.find(n => p.sons.has(n));
      const vo = son ? 'idb:' + nom + '/' + son : '';
      const vus = new Set();
      a.cars.forEach(({ c, py }) => {
        if (vus.has(c)) return; vus.add(c); cars.add(c);
        if (!PAR[c] || PAR[c].source === 'import') nouveaux.add(c);
        const e = entree(c);
        if (!e.pinyin && !(PAR[c] && PAR[c].source !== 'import' && PAR[c].pinyin)) e.pinyin = (/[^a-z]/i.test(py) ? py : '') || pyCars[c] || py;  // pinyin de la prof s'il porte un ton (机场 : chǎng), sinon forme de citation
        if (a.zh === c && a.fr) { e.sens = a.fr; if (a.note) e.noteProf = a.note; }
        if (a.nbHan >= 2) {
          if (!e.contextes.some(x => x.zh === a.zh)) e.contextes.push({ zh: a.zh, fr: a.fr, py: a.py, vo, synth: !vo, paquet: nom });
        }
        if (a.nbHan <= 4 && !/[，。？！?!…、]/.test(a.zh)) {
          if (!e.mots.some(x => x.zh === a.zh)) e.mots.push({ id: 'anki-' + a.id, zh: a.zh, py: a.py, fr: a.fr, vo, synth: !vo, paquet: nom });
        }
      });
      if (a.nbHan >= 2) phrases++;
    });
    // sens d'un caractère sans fiche à lui : « dans 机场 (aéroport) »
    cars.forEach(c => {
      const e = ajouts[c];
      if (e.sens || (PAR[c] && PAR[c].source !== 'import' && PAR[c].sens)) return;
      const m = e.mots.filter(x => x.paquet === nom && x.fr).sort((x, y) => x.zh.length - y.zh.length).slice(0, 2);
      if (m.length) e.sens = m.map(x => `dans ${x.zh} (${x.fr})`).join(' · ');
    });
    stock.ecrire('ecriture_ajouts_v1', ajouts);
    const meta = stock.lire('ecriture_paquets_v1') || {}; meta[nom] = { prefixe: nom + '/', importe: new Date().toISOString(), fichier: f.name }; stock.ecrire('ecriture_paquets_v1', meta);
    construirePaquet();
    if (!R.niveaux.includes('p:' + nom)) R.niveaux.push('p:' + nom); sauverR();
    majCarnet(); majCompteurs();
    const horsLigne = [...cars].filter(c => !(window.TRAITS_EMBARQUES || '').includes(c)).length;
    info.innerHTML = `<b>★ ${nom}</b> : ${p.notes.length} fiches lues, ${cars.size} caractères à écrire (${nouveaux.size} absents du jeu), ${phrases} phrases de contexte, ${sonsGardes} enregistrement(s) de la prof.` +
      (horsLigne ? ` ${horsLigne} caractère(s) chargeront leurs traits par internet.` : '') + ' Le paquet est ajouté à la sélection ci-dessus.';
    journal.ajouter({ evenement: 'import', detail: 'anki:' + nom + ':' + p.notes.length + ' fiches:' + cars.size + ' caracteres' });
  }

  function renommerPaquet(ancien) {
    const nom = (prompt('Nouveau nom du paquet :', ancien) || '').trim().replace(/"/g, '');
    if (!nom || nom === ancien) return;
    const ajouts = lireAjouts();
    Object.values(ajouts).forEach(a => {
      a.paquets = [...new Set(a.paquets.map(x => x === ancien ? nom : x))];
      a.contextes.forEach(x => { if (x.paquet === ancien) x.paquet = nom; });
      a.mots.forEach(x => { if (x.paquet === ancien) x.paquet = nom; });   // les sons gardent leur clé d'origine
    });
    stock.ecrire('ecriture_ajouts_v1', ajouts);
    const meta = stock.lire('ecriture_paquets_v1') || {}; if (meta[ancien]) { meta[nom] = meta[ancien]; delete meta[ancien]; stock.ecrire('ecriture_paquets_v1', meta); }
    R.niveaux = R.niveaux.map(x => x === 'p:' + ancien ? 'p:' + nom : x); sauverR();
    construirePaquet(); majCarnet(); majCompteurs();
  }

  async function retirerPaquet(nom) {
    if (!confirm('Retirer le paquet « ' + nom + ' » ? La progression déjà faite est gardée.')) return;
    const ajouts = lireAjouts(), sons = new Set();
    Object.values(ajouts).forEach(a => a.contextes.concat(a.mots).forEach(x => { if (x.paquet === nom && x.vo && x.vo.startsWith('idb:')) sons.add(x.vo.slice(4)); }));
    Object.keys(ajouts).forEach(c => {
      const a = ajouts[c];
      a.paquets = a.paquets.filter(x => x !== nom);
      a.contextes = a.contextes.filter(x => x.paquet !== nom); a.mots = a.mots.filter(x => x.paquet !== nom);
      if (!a.paquets.length) delete ajouts[c];
    });
    stock.ecrire('ecriture_ajouts_v1', ajouts);
    const meta = stock.lire('ecriture_paquets_v1') || {};
    await sonsDB.retirerPrefixe((meta[nom] && meta[nom].prefixe) || nom + '/');
    delete meta[nom]; stock.ecrire('ecriture_paquets_v1', meta);
    for (const k of sons) { try { await sonsDB.op('readwrite', st => st.delete(k)); } catch (e) { /* déjà absent */ } }
    R.niveaux = R.niveaux.filter(x => x !== 'p:' + nom); if (!R.niveaux.length) R.niveaux = ['1']; sauverR();
    construirePaquet(); majCarnet(); majCompteurs();
    journal.ajouter({ evenement: 'retrait_paquet', detail: nom });
  }

  $('btnModele').onclick = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['caractère', 'pinyin', 'sens', 'histoire', 'mnémotechnique', 'contextes (phrase|traduction ; phrase|traduction)', 'niveau'],
      ['火', 'huǒ', 'feu', 'Pictogramme de flammes qui montent.', 'Un feu de camp qui crépite.', '火车站在哪儿？|Où est la gare ? ; 小心火！|Attention au feu ! ; 我们点火吧。|Allumons le feu.', 'HSK2'],
    ]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'caracteres'); XLSX.writeFile(wb, 'modele_caracteres.xlsx');
  };

  // ---------- JOURNAL ----------
  function majJournal() {
    const L = journal.lignes(), traces = L.filter(l => l.evenement === 'trace');
    const sessions = new Set(L.map(l => l.session)).size, cars = new Set(traces.map(l => l.caractere)).size;
    $('resumeJournal').textContent = `${L.length} événements · ${traces.length} tracés · ${cars} caractères · ${sessions} séance(s).`;
    const der = L.slice(-40).reverse();
    $('tableJournal').innerHTML = '<tr><th>Heure</th><th>Quoi</th><th>Car.</th><th>Étape</th><th>Err.</th><th>Résultat</th><th>Saisie</th></tr>' +
      der.map(l => `<tr><td>${new Date(l.horodatage).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td>${l.evenement}${l.mode ? ' · ' + l.mode : ''}</td><td class="hz">${l.caractere || ''}</td><td>${l.etape || ''}</td><td>${l.erreurs ?? ''}</td><td>${l.resultat || ''}</td><td>${l.saisie || ''}</td></tr>`).join('');
  }
  function telecharger(nom, contenu, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([contenu], { type })); a.download = nom;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const nomFichier = ext => 'journal-ecriture-' + (R.eleve || 'eleve').replace(/[^\w-]+/g, '_') + '-' + new Date().toISOString().slice(0, 10) + '.' + ext;
  $('btnCsv').onclick = () => telecharger(nomFichier('csv'), journal.csv(), 'text/csv;charset=utf-8');
  $('btnJson').onclick = () => telecharger(nomFichier('json'), JSON.stringify({ colonnes: journal.COLONNES, lignes: journal.lignes(), progression: moteur.etat() }, null, 1), 'application/json');
  $('btnVider').onclick = () => { if (confirm('Vider le journal ? Pense à l\'exporter avant.')) { journal.vider(); majJournal(); } };
  $('btnRaz').onclick = () => { if (confirm('Remettre toute la progression d\'écriture à zéro ?')) { moteur.reinitialiser(); majCarnet(); suivante(); } };
  $('eleve').value = R.eleve;
  $('eleve').oninput = e => { R.eleve = e.target.value.trim(); sauverR(); };

  // ---------- navigation ----------
  let vueActive = 'reviser';
  function montrerVue(v, sansRelance) {
    vueActive = v;
    document.querySelectorAll('nav button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.vue === v)));
    ['reviser', 'dictee', 'carnet', 'journal'].forEach(x => { $('vue-' + x).hidden = x !== v; });
    if (v === 'carnet') majCarnet();
    if (v === 'journal') majJournal();
    if (v === 'dictee' && !dic) nouvelleDictee(false);
    if (v === 'reviser' && !sansRelance && (!etat || etat.fini && $('btnSuite').hidden)) suivante();
  }
  document.querySelectorAll('nav button').forEach(b => b.onclick = () => montrerVue(b.dataset.vue));
  document.querySelectorAll('#dicteeType button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.t === R.dictee)));

  // ré-adapte la grille quand on tourne la tablette (l'étape en cours reprend, les erreurs restent comptées)
  let dernierLarg = innerWidth, minuteur = null;
  addEventListener('resize', () => {
    clearTimeout(minuteur);
    minuteur = setTimeout(() => {
      if (Math.abs(innerWidth - dernierLarg) < 60) return; dernierLarg = innerWidth;
      if (vueActive === 'reviser' && etat && !etat.fini) { const e = etat.erreurs, p = etat.parTrait, i = etat.indices, o = etat.ordreMontre, d = etat.debut; lancerEtape(etat.etape); Object.assign(etat, { erreurs: e, parTrait: p, indices: i, ordreMontre: o, debut: d }); }
      if (vueActive === 'dictee' && dic && dic.i < dic.it.cibles.length) ecrireCible();
    }, 250);
  });

  majReglages();
  suivante();
  window.__atelier = { moteur, journal, get PAR() { return PAR; }, liste, etat: () => etat, dic: () => dic, R }; // pour les tests
})();
