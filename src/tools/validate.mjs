#!/usr/bin/env node
/**
 * Validateur de contenu — règle n° 1 du moteur : aucun mot de la langue cible dans le code.
 * Ce script vérifie que le contenu est cohérent AVANT le build :
 *  - chaque jeton [w, id] d'une scène existe dans le lexique de la langue ;
 *  - chaque objet d'une scène pointe sur un mot du lexique ;
 *  - chaque mot du lexique apparaît dans au moins N contextes différents (§12 : « chaque caractère doit voyager ») ;
 *  - chaque étape « choose » / « pick » a exactement une bonne réponse et des explications sur les mauvaises.
 * Usage : node tools/validate.mjs [--strict]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../content/', import.meta.url).pathname;
const strict = process.argv.includes('--strict');
const errors = [];
const warnings = [];
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));

const languages = {};
for (const code of readdirSync(join(ROOT, 'languages'))) {
  const dir = join(ROOT, 'languages', code);
  const lang = json(join(dir, 'language.json'));
  const lex = json(join(dir, 'lexicon.json'));
  const byId = new Map(lex.entries.map((e) => [e.id, e]));
  const dup = lex.entries.map((e) => e.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dup.length) errors.push(`[${code}] identifiants dupliqués dans le lexique : ${[...new Set(dup)].join(', ')}`);
  languages[code] = { lang, lex, byId, contexts: new Map() };
}

const lineText = (line) =>
  line.map((tok) => (tok[0] === 'w' ? `{${tok[1]}}` : tok[0] === 't' ? tok[1] : tok[1])).join('');

function checkLine(L, line, where) {
  for (const tok of line) {
    if (!Array.isArray(tok) || tok.length < 2) { errors.push(`${where} : jeton invalide ${JSON.stringify(tok)}`); continue; }
    const [kind, v] = tok;
    if (kind === 'w') {
      if (!L.byId.has(v)) errors.push(`${where} : mot inconnu « ${v} » (absent du lexique)`);
      else {
        const ctx = L.contexts.get(v) ?? new Set();
        ctx.add(lineText(line));
        L.contexts.set(v, ctx);
      }
    } else if (kind === 't') {
      if (tok.length < 4) warnings.push(`${where} : littéral « ${v} » sans transcription/glose`);
    } else if (kind === 'v') {
      /* variable de profil (NAME, TA…) : résolue au jeu */
    } else if (kind !== 'p') errors.push(`${where} : type de jeton inconnu « ${kind} »`);
  }
}

for (const packId of readdirSync(join(ROOT, 'packs'))) {
  const pdir = join(ROOT, 'packs', packId);
  const pack = json(join(pdir, 'pack.json'));
  const L = languages[pack.language];
  if (!L) { errors.push(`[${packId}] langue inconnue ${pack.language}`); continue; }

  // objets : un mot + une phrase d'usage + au moins deux réemplois (§ 5 de la proposition d'architecture)
  const itemsFile = join(pdir, 'items.json');
  const items = new Map(existsSync(itemsFile) ? json(itemsFile).items.map((it) => [it.id, it]) : []);
  for (const it of items.values()) {
    if (!L.byId.has(it.word)) errors.push(`[${packId}] objet ${it.id} → mot inconnu « ${it.word} »`);
    if (it.usage) checkLine(L, it.usage.line, `[${packId}] objet ${it.id}`);
    else warnings.push(`[${packId}] objet ${it.id} sans phrase d'usage`);
    if ((it.reuse ?? []).length < 2) warnings.push(`[${packId}] objet ${it.id} : moins de deux réemplois déclarés`);
  }
  for (const id of pack.profile?.startItems ?? []) if (!items.has(id)) errors.push(`[${packId}] objet de départ inconnu ${id}`);
  for (const d of Object.values(pack.detours ?? {})) { checkLine(L, d.go.line, `[${packId}] détour`); checkLine(L, d.back.line, `[${packId}] détour`); }
  if (pack.title) checkLine(L, pack.title.line, `[${packId}] titre`);
  if (pack.closedSign) checkLine(L, pack.closedSign, `[${packId}] pancarte`);
  if (pack.money) {
    checkLine(L, [pack.money.unit], `[${packId}] monnaie`);
    for (const [n, w] of Object.entries(pack.money.words)) checkLine(L, w, `[${packId}] monnaie ${n}`);
    if (pack.money.item && !items.has(pack.money.item)) errors.push(`[${packId}] monnaie → objet inconnu ${pack.money.item}`);
  }
  const questsFile = join(pdir, 'quests.json');
  if (existsSync(questsFile)) for (const q of json(questsFile).quests) if (!items.has(q.item)) errors.push(`[${packId}] quête ${q.id} → objet inconnu ${q.item}`);

  for (const placeId of pack.places) {
    const f = join(pdir, 'places', `${placeId}.json`);
    if (!existsSync(f)) { errors.push(`[${packId}] lieu manquant ${placeId}`); continue; }
    const place = json(f);
    for (const h of place.hotspots) {
      // un personnage sans scène est un figurant (client qui attend) ; s'il en a une, elle doit exister
      if ((h.kind === 'stall' || h.scene !== undefined) && !pack.scenes.includes(h.scene)) errors.push(`[${packId}/${placeId}] hotspot ${h.id} → scène inconnue ${h.scene}`);
      if (h.kind === 'npc' && !h.scene && !h.sprite) warnings.push(`[${packId}/${placeId}] figurant ${h.id} sans sprite`);
      if (h.with && !place.hotspots.some((x) => x.id === h.with)) errors.push(`[${packId}/${placeId}] hotspot ${h.id} → « with » inconnu ${h.with}`);
      for (const r of [h.replaces ?? []].flat()) if (!place.hotspots.some((x) => x.id === r)) errors.push(`[${packId}/${placeId}] hotspot ${h.id} → « replaces » inconnu ${r}`);
      if (h.sprite && !pack.assets.images[h.sprite]) warnings.push(`[${packId}/${placeId}] hotspot ${h.id} → image non déclarée ${h.sprite}`);
      if (h.kind === 'stall' && h.word && !L.byId.has(h.word)) errors.push(`[${packId}/${placeId}] étal ${h.id} → mot inconnu « ${h.word} »`);
      if (h.kind === 'subject') {
        if (!L.byId.has(h.word)) errors.push(`[${packId}/${placeId}] sujet photo ${h.id} → mot inconnu « ${h.word} »`);
        else { const c = L.contexts.get(h.word) ?? new Set(); c.add(`photo:${placeId}:${h.id}`); L.contexts.set(h.word, c); }
      }
      if (h.kind === 'object' && h.word && !L.byId.has(h.word)) warnings.push(`[${packId}/${placeId}] objet ${h.id} → mot « ${h.word} » absent du lexique`);
    }
    for (const pl of place.planes) if (!pack.assets.images[pl.image]) errors.push(`[${packId}/${placeId}] plan → image non déclarée ${pl.image}`);
  }

  for (const sceneId of pack.scenes) {
    const f = join(pdir, 'scenes', `${sceneId}.json`);
    if (!existsSync(f)) { errors.push(`[${packId}] scène manquante ${sceneId}`); continue; }
    const sc = json(f);
    const where = (i) => `[${packId}/${sceneId}] étape ${i + 1}`;
    for (const [oid, o] of Object.entries(sc.objects ?? {})) if (!L.byId.has(o.word)) errors.push(`[${packId}/${sceneId}] objet ${oid} → mot inconnu « ${o.word} »`);
    sc.steps.forEach((s, i) => {
      if (s.line) checkLine(L, s.line, where(i));
      if (s.type === 'choose') {
        const oks = s.choices.filter((c) => c.ok).length;
        if (!s.free && oks !== 1) errors.push(`${where(i)} : ${oks} bonne(s) réponse(s), il en faut exactement une`);
        s.choices.forEach((c, j) => {
          checkLine(L, c.line, `${where(i)} choix ${j + 1}`);
          if (!c.ok && !c.why?.fr) errors.push(`${where(i)} choix ${j + 1} : distracteur sans explication`);
          if (!c.ok && !c.errorType) warnings.push(`${where(i)} choix ${j + 1} : distracteur sans catégorie d'erreur`);
        });
      }
      if (s.type === 'pick') {
        const oks = s.options.filter((o) => o.ok).length;
        if (!s.free && oks !== 1) errors.push(`${where(i)} : ${oks} bonne(s) option(s), il en faut exactement une`);
        s.options.forEach((o, j) => {
          if (!sc.objects?.[o.object]) errors.push(`${where(i)} option ${j + 1} : objet inconnu ${o.object}`);
          if (!o.ok && !o.why?.fr) errors.push(`${where(i)} option ${j + 1} : distracteur sans explication`);
        });
      }
      if (s.type === 'restore') {
        // ligne abîmée : chaque case a exactement une bonne réponse, qui est bien le caractère à cet endroit
        const r = s.restore;
        if (!r?.line || !r.gaps?.length) errors.push(`${where(i)} : étape « restore » sans ligne ni cases`);
        else {
          checkLine(L, r.line, `${where(i)} ligne restaurée`);
          const chars = [...r.line.map((tok) => (tok[0] === 'w' ? (L.byId.get(tok[1])?.target ?? '') : tok[0] === 'v' ? '' : tok[1])).join('')];
          r.gaps.forEach((g, j) => {
            const oks = g.options.filter((o) => o.ok);
            if (oks.length !== 1) errors.push(`${where(i)} case ${j + 1} : ${oks.length} bonne(s) réponse(s), il en faut exactement une`);
            else if (chars[g.at] !== oks[0].char) errors.push(`${where(i)} case ${j + 1} : le caractère n° ${g.at} de la ligne est « ${chars[g.at] ?? '?'} », pas « ${oks[0].char} »`);
            g.options.forEach((o, k) => {
              if (o.word && !L.byId.has(o.word)) errors.push(`${where(i)} case ${j + 1} option ${k + 1} : mot inconnu « ${o.word} »`);
              else if (o.word && !L.byId.get(o.word).target.includes(o.char)) warnings.push(`${where(i)} case ${j + 1} : « ${o.char} » n'est pas dans le mot ${o.word}`);
              if (!o.ok && !o.why?.fr) errors.push(`${where(i)} case ${j + 1} option ${k + 1} : distracteur sans explication`);
              if (!o.ok && !o.errorType) warnings.push(`${where(i)} case ${j + 1} option ${k + 1} : distracteur sans catégorie d'erreur`);
            });
          });
        }
      }
      if (s.type === 'stall') {
        // étal libre : articles et voisins dans le lexique, répliques valides ; chaque phrase de l'étal est un contexte
        const st = s.stall;
        if (!st?.goods?.length || !st.lines?.offer?.length) errors.push(`${where(i)} : étal sans articles ou sans réplique « offer »`);
        else {
          const slot = (l) => l.line.some((tok) => tok[0] === 'v' && tok[1] === 'WORD');
          for (const [k, l] of Object.entries(st.lines)) for (const x of Array.isArray(l) ? l : [l]) {
            checkLine(L, x.line, `${where(i)} réplique ${k}`);
            if (['offer', 'want'].includes(k) && !slot(x)) errors.push(`${where(i)} réplique ${k} : il manque la place de l'article ["v", "WORD"]`);
            if (!['offer', 'want'].includes(k) && slot(x)) warnings.push(`${where(i)} réplique ${k} : place d'article inattendue`);
          }
          if (st.modes?.includes('say') && !st.lines.ask) errors.push(`${where(i)} : mode « say » sans réplique « ask »`);
          if (st.modes?.includes('buy') && !st.lines.want) errors.push(`${where(i)} : mode « buy » sans réplique « want »`);
          if (st.money && !items.has(st.money)) errors.push(`${where(i)} : argent → objet inconnu « ${st.money} »`);
          const ctxLabel = st.context?.fr ?? sceneId;
          for (const g of st.goods) {
            if (!L.byId.has(g.word)) { errors.push(`${where(i)} : article inconnu « ${g.word} »`); continue; }
            const foils = (g.foils ?? []).filter((f) => f !== g.word);
            for (const f of foils) if (!L.byId.has(f)) errors.push(`${where(i)} : ${g.word} → distracteur inconnu « ${f} »`);
            if (foils.length < 2) warnings.push(`${where(i)} : ${g.word} a moins de deux distracteurs déclarés (complétés par l'étal)`);
            if (g.price) checkLine(L, g.price, `${where(i)} prix de ${g.word}`);
            if (g.image && !pack.assets.images[g.image]) warnings.push(`${where(i)} : ${g.word} → image non déclarée ${g.image}`);
            if (g.item && !items.has(g.item)) errors.push(`${where(i)} : ${g.word} → objet inconnu « ${g.item} »`);
            const ctx = L.contexts.get(g.word) ?? new Set();
            for (const l of [...st.lines.offer, st.lines.want].filter(Boolean)) ctx.add(`${ctxLabel} · ${lineText(l.line.map((tok) => (tok[0] === 'v' && tok[1] === 'WORD' ? ['w', g.word] : tok)))}`);
            L.contexts.set(g.word, ctx);
          }
        }
      }
      // ---- service : ticket, étapes, plateaux, caisse ----
      const said = (l, w) => { if (!l?.line) errors.push(`${w} : réplique sans ligne`); else checkLine(L, l.line, w); };
      const options = (opts, w) => {
        const oks = opts.filter((o) => o.ok).length;
        if (oks !== 1) errors.push(`${w} : ${oks} bonne(s) réponse(s), il en faut exactement une`);
        opts.forEach((o, k) => {
          checkLine(L, o.line, `${w} option ${k + 1}`);
          if (!o.ok && !o.why?.fr) errors.push(`${w} option ${k + 1} : distracteur sans explication`);
          if (!o.ok && !o.errorType) warnings.push(`${w} option ${k + 1} : distracteur sans catégorie d'erreur`);
        });
      };
      const ticketIds = new Set(sc.steps.filter((x) => x.ticket).map((x) => x.ticket.id));
      if (s.type === 'ticket') {
        const tk = s.ticket;
        if (!tk?.id || !tk.items?.length) errors.push(`${where(i)} : ticket sans id ou sans éléments`);
        else {
          if (tk.wait) said(tk.wait, `${where(i)} « attendez »`);
          if (tk.again) said(tk.again, `${where(i)} répétition`);
          tk.items.forEach((it, j) => {
            if (!(it.n > 0) || !(it.unit >= 0)) errors.push(`${where(i)} élément ${j + 1} : n et unit (prix unitaire) requis`);
            said(it.complaint, `${where(i)} élément ${j + 1} plainte`);
            it.cells.forEach((c, k) => {
              options(c.options, `${where(i)} élément ${j + 1} case ${k + 1}`);
              if (c.complaint) said(c.complaint, `${where(i)} élément ${j + 1} case ${k + 1} plainte`);
            });
          });
        }
      }
      if (s.type === 'sequence') {
        if (!s.sequence?.cards?.length) errors.push(`${where(i)} : étapes sans cartes`);
        else s.sequence.cards.forEach((c, k) => { checkLine(L, c.line, `${where(i)} carte ${k + 1}`); if (!c.why?.fr) errors.push(`${where(i)} carte ${k + 1} : sans explication`); });
      }
      if (s.type === 'serve') {
        for (const [k, p] of (s.serve?.places ?? []).entries()) {
          if (!ticketIds.has(p.ticket)) errors.push(`${where(i)} place ${k + 1} : ticket inconnu ${p.ticket}`);
          if (!sc.actors?.[p.actor]) errors.push(`${where(i)} place ${k + 1} : acteur inconnu ${p.actor}`);
          checkLine(L, p.line, `${where(i)} place ${k + 1}`);
          said(p.thanks, `${where(i)} place ${k + 1} merci`);
          if (!p.why?.fr) errors.push(`${where(i)} place ${k + 1} : sans explication`);
        }
      }
      if (s.type === 'pay') {
        const py = s.pay;
        const tk = sc.steps.find((x) => x.ticket?.id === py?.ticket)?.ticket;
        if (!tk) errors.push(`${where(i)} : caisse → ticket inconnu ${py?.ticket}`);
        else {
          const sum = tk.items.reduce((a, it) => a + it.n * it.unit, 0);
          if (py.totals.filter((x) => x.n === sum).length !== 1) errors.push(`${where(i)} : le total juste (${sum}) doit figurer une fois parmi les totaux proposés`);
          for (const x of py.totals) if (x.n !== sum && !x.why?.fr) warnings.push(`${where(i)} : total ${x.n} sans explication propre (l'addition est montrée)`);
          if (py.given.n < sum) errors.push(`${where(i)} : le billet (${py.given.n}) ne couvre pas le total (${sum})`);
          for (const n of [sum, py.given.n, py.given.n - sum, ...py.totals.map((x) => x.n)]) if (n && !pack.money?.words?.[String(n)]) warnings.push(`${where(i)} : montant ${n} sans mots déclarés (pack.money.words)`);
          for (const k of ['ask', 'given', 'thanks', 'wrong', 'total', 'change']) said(py[k], `${where(i)} ${k}`);
        }
      }
      if (s.vo && typeof s.vo !== 'string') errors.push(`${where(i)} : vo doit être une clé de fichier`);
      for (const id of [...(s.give ?? []), ...(s.take ?? [])]) if (!items.has(id)) errors.push(`${where(i)} : objet inconnu « ${id} » (items.json)`);
    });
    for (const id of sc.onEnd?.give ?? []) if (!items.has(id)) errors.push(`[${packId}/${sceneId}] onEnd : objet inconnu « ${id} »`);
    if (sc.onEnd?.goto && !pack.places.includes(sc.onEnd.goto.place)) errors.push(`[${packId}/${sceneId}] onEnd : lieu inconnu ${sc.onEnd.goto.place}`);
    if (sc.onExhausted && !pack.detours?.[sc.onExhausted.detour]) errors.push(`[${packId}/${sceneId}] détour inconnu ${sc.onExhausted.detour}`);
    if (sc.till) {
      for (const l of sc.till.slate ?? []) checkLine(L, l, `[${packId}/${sceneId}] ardoise`);
      if (sc.till.mock) { checkLine(L, sc.till.mock.line, `[${packId}/${sceneId}] ricanement`); if (!sc.actors?.[sc.till.mock.actor]) errors.push(`[${packId}/${sceneId}] ricanement : acteur inconnu ${sc.till.mock.actor}`); }
    }
  }
}

// §12 — chaque caractère doit voyager
for (const [code, L] of Object.entries(languages)) {
  const N = L.lang.mastery?.contextsRequired ?? 3;
  for (const e of L.lex.entries) {
    const n = L.contexts.get(e.id)?.size ?? 0;
    if (n === 0) warnings.push(`[${code}] « ${e.target} » (${e.id}) n'apparaît dans aucune scène`);
    else if (n < N) warnings.push(`[${code}] « ${e.target} » (${e.id}) n'apparaît que dans ${n} contexte(s), ${N} requis pour la maîtrise`);
  }
}

for (const w of warnings) console.log('⚠  ' + w);
for (const e of errors) console.log('✖  ' + e);
console.log(`\n${errors.length} erreur(s), ${warnings.length} avertissement(s).`);
process.exit(errors.length || (strict && warnings.length) ? 1 : 0);
