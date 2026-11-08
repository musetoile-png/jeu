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
  const questsFile = join(pdir, 'quests.json');
  if (existsSync(questsFile)) for (const q of json(questsFile).quests) if (!items.has(q.item)) errors.push(`[${packId}] quête ${q.id} → objet inconnu ${q.item}`);

  for (const placeId of pack.places) {
    const f = join(pdir, 'places', `${placeId}.json`);
    if (!existsSync(f)) { errors.push(`[${packId}] lieu manquant ${placeId}`); continue; }
    const place = json(f);
    for (const h of place.hotspots) {
      if (h.kind === 'npc' && !pack.scenes.includes(h.scene)) errors.push(`[${packId}/${placeId}] hotspot ${h.id} → scène inconnue ${h.scene}`);
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
      if (s.vo && typeof s.vo !== 'string') errors.push(`${where(i)} : vo doit être une clé de fichier`);
      for (const id of [...(s.give ?? []), ...(s.take ?? [])]) if (!items.has(id)) errors.push(`${where(i)} : objet inconnu « ${id} » (items.json)`);
    });
    for (const id of sc.onEnd?.give ?? []) if (!items.has(id)) errors.push(`[${packId}/${sceneId}] onEnd : objet inconnu « ${id} »`);
    if (sc.onEnd?.goto && !pack.places.includes(sc.onEnd.goto.place)) errors.push(`[${packId}/${sceneId}] onEnd : lieu inconnu ${sc.onEnd.goto.place}`);
    if (sc.onExhausted && !pack.detours?.[sc.onExhausted.detour]) errors.push(`[${packId}/${sceneId}] détour inconnu ${sc.onExhausted.detour}`);
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
