/* Moteur d'écriture de 千里 Mille li : répétition espacée propre à l'écriture + journal de recherche.
 * Sans DOM et sans dépendance : réutilisable tel quel dans le jeu (le « pinceau »).
 *
 * Une carte = un caractère. Elle a une étape :
 *   1 calque (modèle visible) → 2 guidé (aide dès l'erreur) → 3 de mémoire (grille vide).
 * Un caractère nouveau enchaîne 1, 2, 3 dans la même séance. Ensuite il ne revient qu'en étape 3,
 * à intervalles croissants (1 j, 3 j, puis × facilité). Raté de mémoire : retour à l'étape 2 tout de suite,
 * puis nouvel essai de mémoire 10 minutes plus tard.
 */
(function (racine) {
  'use strict';
  const MIN = 60e3, JOUR = 864e5;

  function creerMoteur(opts) {
    const stock = opts.stockage;            // { lire(cle), ecrire(cle, valeur) }
    const maintenant = opts.maintenant || (() => Date.now());
    const CLE = 'ecriture_srs_v2';
    let S = stock.lire(CLE) || {};

    function sauver() { stock.ecrire(CLE, S); }
    function carte(c) {
      return S[c] || (S[c] = { etape: 1, reps: 0, facilite: 2.5, ivl: 0, due: 0, vu: 0, ok: 0, ko: 0, ctx: [] });
    }
    function estNouveau(c) { return !S[c] || (!S[c].vu && S[c].etape === 1); }

    /* Note un essai.
       erreurs : total des erreurs de trait ; aide : indice ou ordre montré (étape 3) ;
       details (facultatif) : { nbTraits, traitsKO (nombre de traits ratés), grave (ordre montré, « je ne sais pas ») }.
       Règles (16 → 21 novembre, retour de Manu : « on recommence trop souvent ») :
       - étapes 1 et 2 : on avance toujours (ce sont des étapes d'apprentissage) ;
       - étape 3, parfait (0 erreur, sans aide) : l'intervalle grandit ;
       - étape 3, bien (1 trait raté, 2 erreurs au plus) : réussi, intervalle qui grandit peu ;
       - étape 3, fragile (quelques traits ratés) : PAS de retour au guidé, le caractère revient de mémoire dans 5 minutes ;
       - étape 3, à revoir (la moitié des traits ratés, ou ordre montré) : retour au guidé, nouvel essai 10 minutes plus tard.
       Toute réussite d'un caractère récent est suivie d'un rappel dans 10 minutes : plus de révisions, plus courtes. */
    function noter(c, etape, erreurs, aide, details) {
      const k = carte(c), t = maintenant();
      if (!k.vu) k.vu = t;
      if (etape < 3) {
        k.etape = etape + 1; k.due = t;
        sauver();
        return { resultat: 'etape_suivante', carte: k };
      }
      const n = (details && details.nbTraits) || 8;
      const ko = details && details.traitsKO !== undefined ? details.traitsKO : Math.min(erreurs, n);
      const grave = !!(details && details.grave) || ko >= Math.max(3, Math.ceil(n / 2));
      const resultat = erreurs === 0 && !aide ? 'parfait' : grave ? 'a_revoir' : ko <= 1 && erreurs <= 2 ? 'bien' : 'fragile';
      let rappel = false;
      if (resultat === 'a_revoir') {
        k.ko++; k.reps = 0; k.ivl = 0; k.facilite = Math.max(1.3, k.facilite - 0.2);
        k.etape = 2; k.due = t;            // repasse par le guidé
        k.retourMemoire = t + 10 * MIN;    // puis de mémoire dans 10 minutes
        delete k.rappel;
      } else if (resultat === 'fragile') {
        k.etape = 3; k.facilite = Math.max(1.3, k.facilite - 0.1);
        k.due = t + 5 * MIN;               // revient vite, toujours de mémoire
        delete k.retourMemoire;
      } else if (k.rappel) {               // rappel réussi : on confirme l'intervalle prévu
        k.etape = 3; k.due = t + k.ivl * JOUR; delete k.rappel; delete k.retourMemoire;
      } else {
        k.ok++; k.reps++; k.etape = 3;
        k.ivl = k.reps === 1 ? 1 : k.reps === 2 ? 3 : resultat === 'parfait' ? Math.max(k.ivl + 1, Math.round(k.ivl * k.facilite)) : Math.max(k.ivl, Math.round(k.ivl * 1.3));
        k.facilite = resultat === 'parfait' ? Math.min(3.2, k.facilite + 0.1) : Math.max(1.3, k.facilite - 0.05);
        delete k.retourMemoire;
        if (k.reps <= 2) { rappel = true; k.rappel = true; k.due = t + 10 * MIN; }   // caractère récent : petit rappel
        else k.due = t + k.ivl * JOUR;
      }
      sauver();
      return { resultat, carte: k, rappel };
    }

    /* Après un guidé de rattrapage réussi, la carte attend 10 minutes avant le nouvel essai de mémoire. */
    function finRattrapage(c) {
      const k = carte(c);
      if (k.retourMemoire) { k.etape = 3; k.due = k.retourMemoire; delete k.retourMemoire; sauver(); }
    }

    /* Prochaine carte : d'abord une carte en cours d'apprentissage (on finit calque → guidé → mémoire),
       puis on MÉLANGE révisions dues et nouveaux caractères, répartis sur la séance :
       s'il reste 40 révisions et 20 nouveaux, on fait 2 révisions, 1 nouveau, 2 révisions, 1 nouveau… */
    let depuisNouveau = 0;
    function prochaine(liste, reglages, exclure) {
      const t = maintenant();
      const enCours = liste.filter(c => S[c] && S[c].vu && S[c].etape < 3 && c !== exclure);
      if (enCours.length) return { c: enCours[0], type: 'apprentissage' };
      const dues = liste.filter(c => S[c] && S[c].vu && S[c].etape === 3 && S[c].due <= t && c !== exclure)
        .sort((a, b) => S[a].due - S[b].due);
      const quota = (reglages.parJour || reglages.nouveauxParJour || 5) - nouveauxDuJour();
      const neuf = quota > 0 ? liste.find(c => estNouveau(c) && c !== exclure) : null;
      if (dues.length && neuf) {
        const rythme = Math.min(4, Math.max(1, Math.round(dues.length / quota)));
        if (depuisNouveau >= rythme) { depuisNouveau = 0; return { c: neuf, type: 'nouveau' }; }
        depuisNouveau++;
        return { c: dues[0], type: 'revision' };
      }
      if (dues.length) return { c: dues[0], type: 'revision' };
      if (neuf) { depuisNouveau = 0; return { c: neuf, type: 'nouveau' }; }
      return null;
    }
    function enAvance(liste, exclure) {
      const vus = liste.filter(c => S[c] && S[c].vu && c !== exclure).sort((a, b) => S[a].due - S[b].due);
      if (vus.length) return { c: vus[0], type: 'avance' };
      const neuf = liste.find(c => estNouveau(c) && c !== exclure);
      return neuf ? { c: neuf, type: 'nouveau' } : null;
    }
    function nouveauxDuJour() {
      const debut = new Date(maintenant()); debut.setHours(0, 0, 0, 0);
      return Object.values(S).filter(k => k.vu >= debut.getTime()).length;
    }
    function prochaineEcheance(liste) {
      const d = liste.filter(c => S[c] && S[c].vu).map(c => S[c].due).filter(x => x > maintenant());
      return d.length ? Math.min(...d) : null;
    }

    /* Contextes : on tourne pour ne jamais montrer deux fois de suite la même phrase ; on retient celles déjà vues. */
    function choisirContexte(c, contextes) {
      if (!contextes || !contextes.length) return { ctx: null, nouveau: false };
      const k = carte(c);
      const jamais = contextes.filter(x => !k.ctx.includes(x.zh));
      const pool = jamais.length ? jamais : contextes.filter(x => x.zh !== k.dernierCtx);
      const ctx = (pool.length ? pool : contextes)[Math.floor(Math.random() * (pool.length || contextes.length))];
      return { ctx, nouveau: !k.ctx.includes(ctx.zh) };
    }
    function marquerContexte(c, zh) {
      const k = carte(c);
      if (zh && !k.ctx.includes(zh)) k.ctx.push(zh);
      k.dernierCtx = zh; sauver();
    }

    function niveau(c) {           // pour le carnet « encre pâle / encre noire »
      const k = S[c];
      if (!k || !k.vu) return 0;   // jamais vu
      if (k.etape < 3 || k.reps === 0) return 1; // en apprentissage
      if (k.reps < 3 || (k.ctx || []).length < 3) return 2; // fragile (moins de 3 réussites ou de 3 contextes)
      return 3;                    // maîtrisé
    }

    function migrerPrototype(ancien) { // progression du prototype du 11 novembre (hanzi_srs_v1)
      let n = 0;
      for (const [c, k] of Object.entries(ancien || {})) {
        if (S[c] || !k.reps) continue;
        S[c] = { etape: 3, reps: k.reps, facilite: k.ease || 2.5, ivl: k.ivl || 1, due: k.due || 0, vu: (k.due || maintenant()) - (k.ivl || 1) * JOUR, ok: k.reps, ko: 0, ctx: [] };
        n++;
      }
      if (n) sauver();
      return n;
    }
    function reinitialiser() { S = {}; sauver(); }

    return { carte, noter, finRattrapage, prochaine, enAvance, prochaineEcheance, choisirContexte, marquerContexte,
      niveau, estNouveau, nouveauxDuJour, migrerPrototype, reinitialiser, etat: () => S };
  }

  /* Journal d'événements pour la recherche : une ligne par geste qui compte, exportable en CSV. */
  const COLONNES = ['horodatage', 'eleve', 'session', 'evenement', 'mode', 'caractere', 'etape', 'type_carte',
    'nb_traits', 'erreurs', 'erreurs_par_trait', 'indices', 'ordre_montre', 'duree_ms', 'resultat',
    'prochain_intervalle_j', 'contexte', 'contexte_nouveau', 'pinyin_visible', 'tolerance', 'saisie', 'ecran', 'detail', 'diagnostics'];

  function creerJournal(opts) {
    const stock = opts.stockage, CLE = 'ecriture_journal_v1';
    let lignes = stock.lire(CLE) || [];
    const session = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    function ajouter(ev) {
      const l = Object.assign({ horodatage: new Date().toISOString(), session, eleve: opts.eleve() }, ev);
      lignes.push(l);
      if (lignes.length > 20000) lignes = lignes.slice(-20000);
      stock.ecrire(CLE, lignes);
      return l;
    }
    function csv() {
      const esc = v => { const s = v === undefined || v === null ? '' : String(v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      return '﻿' + [COLONNES.join(';')].concat(lignes.map(l => COLONNES.map(k => esc(l[k])).join(';'))).join('\n');
    }
    return { ajouter, csv, lignes: () => lignes, vider() { lignes = []; stock.ecrire(CLE, lignes); }, session, COLONNES };
  }

  racine.MoteurEcriture = { creerMoteur, creerJournal };
})(typeof window !== 'undefined' ? window : globalThis);
