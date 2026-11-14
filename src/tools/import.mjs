#!/usr/bin/env node
/**
 * Importeur : le tableur d'un éditeur ou d'un prof → un paquet de contenu jouable.
 *
 * Usage : node tools/import.mjs <tableur.xlsx> [--dry-run]
 *
 * Le tableur (modèle : node tools/modele-tableur.mjs) a quatre onglets :
 *  - Leçon     : identifiant du paquet, titres, langue, paquet de base (décors et personnages réutilisés)
 *  - Mots      : le vocabulaire (mot, transcription, traduction) ; un mot déjà connu de la langue est réutilisé
 *  - Scènes    : une ligne par scène : lieu, personnage, ordre
 *  - Répliques : une ligne par réplique (« dit ») ou par question à choix (« choix »), dans l'ordre
 *
 * Les phrases s'écrivent normalement (« 我要一杯绿茶。 ») : l'importeur les découpe en mots d'après le vocabulaire.
 * Rien n'est écrit tant qu'il reste une erreur ; chaque erreur dit l'onglet et la ligne.
 * Sortie : content/packs/<identifiant>/ (pack.json, lexicon.json, places/, scenes/, voix-a-generer.json).
 */
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';

import { CONTENT, loadCatalogue } from './catalogue.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
if (!file) {
  console.log('Usage : node tools/import.mjs <tableur.xlsx> [--dry-run]');
  process.exit(1);
}

const errors = [];
const warnings = [];
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));

// ---------- Lecture du tableur ----------

/** Texte d'une cellule, quelle que soit sa forme (texte enrichi, formule, nombre). */
function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText))
      return v.richText
        .map((r) => r.text)
        .join('')
        .trim();
    if ('result' in v) return cellText(v.result);
    if ('text' in v) return String(v.text).trim();
    return '';
  }
  return String(v).trim();
}

/** Clé de colonne comparable : « Traduction faux 1 » → « traductionfaux1 ». */
const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Lignes d'un onglet sous forme d'objets { colonne normalisée → texte }, avec leur numéro de ligne. */
function rowsOf(ws) {
  const head = [];
  ws.getRow(1).eachCell(
    { includeEmpty: true },
    (c, i) => (head[i] = norm(cellText(c.value))),
  );
  const out = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const o = { _row: n };
    let any = false;
    row.eachCell({ includeEmpty: true }, (c, i) => {
      const t = cellText(c.value);
      if (head[i]) o[head[i]] = t;
      if (t) any = true;
    });
    if (any) out.push(o);
  });
  return out;
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const sheet = (name) => {
  const ws = wb.worksheets.find((w) => norm(w.name) === norm(name));
  if (!ws) errors.push(`Onglet « ${name} » introuvable`);
  return ws ? rowsOf(ws) : [];
};

const lessonRows = sheet('Leçon');
const lesson = Object.fromEntries(
  lessonRows.map((r) => [norm(r.champ ?? ''), r.valeur ?? '']),
);
const packId = lesson.identifiant ?? '';
const langCode = lesson.langue || 'zh';
const baseId = lesson.paquetdebase || 'shanghai';
if (!/^[a-z0-9-]+$/.test(packId))
  errors.push(
    `Leçon : identifiant « ${packId} » invalide (minuscules, chiffres, tirets)`,
  );
if (packId === baseId)
  errors.push(
    `Leçon : l'identifiant ne peut pas être celui du paquet de base (${baseId})`,
  );
if (!lesson.titre) errors.push('Leçon : titre manquant');

const langDir = join(CONTENT, 'languages', langCode);
if (!existsSync(join(langDir, 'language.json'))) {
  console.log(`✖  Leçon : langue inconnue « ${langCode} »`);
  process.exit(1);
}
const language = json(join(langDir, 'language.json'));
const baseLex = json(join(langDir, 'lexicon.json')).entries;
const cat = loadCatalogue(baseId);

// ---------- Mots ----------

/** Identifiant lisible d'un mot à partir de sa transcription (nǐ hǎo → ni_hao). */
function makeId(entry) {
  const src = entry.transcription || entry.target;
  const id = src
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ü/g, 'u')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return (
    id ||
    `mot_${[...entry.target].map((c) => c.codePointAt(0).toString(16)).join('_')}`
  );
}

const byTarget = new Map(baseLex.map((e) => [e.target, e]));
const usedIds = new Set(baseLex.map((e) => e.id));
const packLex = [];
for (const r of sheet('Mots')) {
  const target = r.mot ?? '';
  if (!target) {
    errors.push(`Mots ligne ${r._row} : colonne « mot » vide`);
    continue;
  }
  const gloss = r.traduction ?? '';
  if (!gloss)
    errors.push(`Mots ligne ${r._row} : « ${target} » sans traduction`);
  if (language.transcription && !r.transcription)
    warnings.push(
      `Mots ligne ${r._row} : « ${target} » sans ${language.transcription}`,
    );
  const known = byTarget.get(target);
  if (known) continue; // déjà dans la langue : on réutilise l'entrée existante (même identifiant, même voix)
  const entry = {
    id: '',
    target,
    transcription: r.transcription || undefined,
    gloss: { fr: gloss },
  };
  if (r.nature) entry.pos = r.nature;
  if (r.niveau) entry.level = r.niveau;
  let id = r.identifiant ? norm(r.identifiant) : makeId(entry);
  for (let k = 2; usedIds.has(id); k++) id = `${makeId(entry)}_${k}`;
  entry.id = id;
  usedIds.add(id);
  byTarget.set(target, entry);
  packLex.push(entry);
}

// ---------- Découpe des phrases en mots ----------

const PUNCT = new Set([...'，。！？：；、“”‘’…—（）《》,.!?:;"\'()«»']);
const noSpaces = ['hans', 'hant', 'jpan', 'thai'].includes(language.script);
const longest = Math.max(1, ...[...byTarget.keys()].map((t) => [...t].length));

/** « 我要一杯绿茶。 » → [['w','wo'],['w','yao'],…,['p','。']] ; les inconnus sont signalés. */
function tokenize(text, where) {
  const out = [];
  if (noSpaces) {
    // un espace ou une barre « / » force une coupure (pour trancher une découpe ambiguë : « 很 好吃 »)
    const chars = [...text.trim().replace(/[\s/]+/g, ' ')];
    let i = 0;
    while (i < chars.length) {
      if (chars[i] === ' ') {
        i++;
        continue;
      }
      if (PUNCT.has(chars[i])) {
        out.push(['p', chars[i]]);
        i++;
        continue;
      }
      let hit = null;
      for (let n = Math.min(longest, chars.length - i); n > 0; n--) {
        const piece = chars.slice(i, i + n).join('');
        if (piece.includes(' ')) continue;
        if (byTarget.has(piece)) {
          hit = piece;
          break;
        }
      }
      if (!hit) {
        // caractères inconnus d'affilée : un seul message (« 咖啡 » plutôt que « 咖 » puis « 啡 »)
        const last = out.at(-1);
        if (last?.[0] === '?') last[1] += chars[i];
        else out.push(['?', chars[i]]);
        i++;
        continue;
      }
      out.push(['w', byTarget.get(hit).id]);
      i += [...hit].length;
    }
  } else {
    for (const piece of text.match(/[^\s,.!?:;«»"()]+|[,.!?:;«»"()]/g) ?? []) {
      if (PUNCT.has(piece)) out.push(['p', piece]);
      else if (byTarget.has(piece) || byTarget.has(piece.toLowerCase()))
        out.push([
          'w',
          (byTarget.get(piece) ?? byTarget.get(piece.toLowerCase())).id,
        ]);
      else
        errors.push(
          `${where} : « ${piece} » n'est pas dans le vocabulaire — ajoute-le dans l'onglet Mots`,
        );
    }
  }
  for (const t of out)
    if (t[0] === '?')
      errors.push(
        `${where} : « ${t[1]} » n'est pas dans le vocabulaire — ajoute-le dans l'onglet Mots`,
      );
  if (!out.some((t) => t[0] === 'w')) errors.push(`${where} : phrase vide`);
  return out.filter((t) => t[0] !== '?');
}

// ---------- Scènes ----------

const scenesRows = sheet('Scènes');
const scenes = [];
for (const r of scenesRows) {
  const id = (r.scene ?? '').trim().toLowerCase();
  const where = `Scènes ligne ${r._row}`;
  if (!/^[a-z0-9-]+$/.test(id ?? '')) {
    errors.push(
      `${where} : identifiant de scène « ${r.scene ?? ''} » invalide (minuscules, chiffres, tirets)`,
    );
    continue;
  }
  if (scenes.some((s) => s.id === id))
    errors.push(`${where} : scène « ${id} » en double`);
  const place = cat.places.get(r.lieu ?? '');
  if (!place)
    errors.push(
      `${where} : lieu « ${r.lieu ?? ''} » inconnu (voir l'onglet Catalogue)`,
    );
  const person = cat.people.get(r.personnage ?? '');
  if (!person)
    errors.push(
      `${where} : personnage « ${r.personnage ?? ''} » inconnu (voir l'onglet Catalogue)`,
    );
  const patience = r.patience ? Number(r.patience) : 3;
  if (!(patience >= 1 && patience <= 5))
    errors.push(`${where} : patience « ${r.patience} » hors de 1…5`);
  scenes.push({
    id,
    row: r._row,
    title: r.titre || id,
    place: r.lieu ?? '',
    person: r.personnage ?? '',
    name: r.nomaffiche || person?.name || '',
    label: r.role || person?.label || '',
    after: (r.apres ?? '').trim().toLowerCase(),
    patience,
    steps: [],
  });
}
for (const s of scenes)
  if (s.after && !scenes.some((x) => x.id === s.after))
    errors.push(
      `Scènes ligne ${s.row} : « après » renvoie à une scène inconnue « ${s.after} »`,
    );

// ---------- Répliques ----------

/** Type d'erreur (colonne « erreur faux k ») → catégorie du journal, la même que dans les scènes de Mille li. */
const ERROR_TYPES = {
  sens: 'semantic',
  usage: 'pragmatic',
  grammaire: 'grammar',
  classificateur: 'classifier',
  son: 'phonetic',
  ton: 'phonetic',
  caractere: 'character',
  nombre: 'number',
  ordre: 'order',
};

const voices = [];
const counters = new Map();
for (const r of sheet('Répliques')) {
  const where = `Répliques ligne ${r._row}`;
  const sc = scenes.find((s) => s.id === (r.scene ?? '').trim().toLowerCase());
  if (!sc) {
    errors.push(
      `${where} : scène « ${r.scene ?? ''} » absente de l'onglet Scènes`,
    );
    continue;
  }
  const n = (counters.get(sc.id) ?? 0) + 1;
  counters.set(sc.id, n);
  const key = `${sc.id}_${String(n).padStart(2, '0')}`;
  const type = norm(r.type ?? '');
  if (type === 'dit') {
    const who = norm(r.qui ?? '') || sc.person;
    const actor = who === 'joueur' || who === 'player' ? 'player' : who;
    if (actor !== 'player' && actor !== sc.person)
      errors.push(
        `${where} : « ${r.qui} » ne joue pas dans cette scène (personnage : ${sc.person}, ou « joueur »)`,
      );
    if (!r.texte) errors.push(`${where} : texte vide`);
    if (!r.traduction) warnings.push(`${where} : réplique sans traduction`);
    sc.steps.push({
      type: 'say',
      actor,
      vo: key,
      line: tokenize(r.texte ?? '', where),
      gloss: { fr: r.traduction ?? '' },
    });
    voices.push({
      vo: key,
      speaker: actor === 'player' ? 'player' : sc.person,
      text: r.texte ?? '',
    });
  } else if (type === 'choix') {
    if (!r.consigne) errors.push(`${where} : question à choix sans consigne`);
    if (!r.texte)
      errors.push(`${where} : bonne réponse (colonne « texte ») vide`);
    const choices = [
      {
        ok: true,
        vo: `${key}a`,
        line: tokenize(r.texte ?? '', `${where} (bonne réponse)`),
        gloss: { fr: r.traduction ?? '' },
      },
    ];
    voices.push({ vo: `${key}a`, speaker: 'player', text: r.texte ?? '' });
    for (const k of [1, 2, 3]) {
      const wrong = r[`faux${k}`];
      if (!wrong) continue;
      const why = r[`pourquoifaux${k}`];
      if (!why)
        errors.push(
          `${where} : « faux ${k} » sans explication (colonne « pourquoi faux ${k} ») — l'élève doit savoir pourquoi c'est faux`,
        );
      const vo = `${key}${String.fromCharCode(97 + k)}`;
      const choice = {
        vo,
        line: tokenize(wrong, `${where} (faux ${k})`),
        gloss: { fr: r[`traductionfaux${k}`] ?? '' },
        why: { fr: why ?? '' },
      };
      const kind = norm(r[`erreurfaux${k}`] ?? '');
      if (kind && !ERROR_TYPES[kind])
        errors.push(
          `${where} : type d'erreur « ${r[`erreurfaux${k}`]} » inconnu (${Object.keys(ERROR_TYPES).join(', ')})`,
        );
      else if (kind) choice.errorType = ERROR_TYPES[kind];
      choices.push(choice);
      voices.push({ vo, speaker: 'player', text: wrong });
    }
    if (choices.length < 2)
      errors.push(
        `${where} : il faut au moins une mauvaise réponse (« faux 1 »)`,
      );
    sc.steps.push({ type: 'choose', ask: { fr: r.consigne ?? '' }, choices });
  } else
    errors.push(
      `${where} : type « ${r.type ?? ''} » inconnu (« dit » ou « choix »)`,
    );
}
for (const s of scenes)
  if (!s.steps.length)
    errors.push(
      `Scènes ligne ${s.row} : la scène « ${s.id} » n'a aucune réplique`,
    );

const titleTarget = lesson.titreenlanguecible ?? '';
const titleLine = titleTarget
  ? tokenize(titleTarget, 'Leçon (titre en langue cible)').filter(
      (t) => t[0] === 'w',
    )
  : [];

// ---------- Arrêt sur erreur ----------

for (const w of warnings) console.log('⚠  ' + w);
if (errors.length) {
  for (const e of errors) console.log('✖  ' + e);
  console.log(`\n${errors.length} erreur(s) : rien n'a été écrit.`);
  process.exit(1);
}

// ---------- Construction du paquet ----------

// ordre de jeu : une scène s'ouvre quand la précédente (ou celle nommée dans « après ») est finie
const flag = (id) => `vu_${id}`;
const order = scenes.map((s, i) => ({
  ...s,
  prev: s.after || (i > 0 ? scenes[i - 1].id : ''),
}));
const placeIds = [...new Set(order.map((s) => s.place))];

const sceneFiles = order.map((s) => {
  const person = cat.people.get(s.person);
  const place = cat.places.get(s.place);
  return {
    id: s.id,
    language: langCode,
    world: place.world,
    tier: 1,
    title: { fr: s.title },
    place: s.place,
    npc: s.person,
    patience: s.patience,
    actors: {
      [s.person]: {
        name: s.name,
        label: { fr: s.label },
        portrait: person.portrait,
      },
      player: { name: '', label: { fr: 'toi' }, portrait: 'player' },
    },
    objects: {},
    steps: s.steps,
    onEnd: { flags: { [flag(s.id)]: 'fait' } },
  };
});

const places = placeIds.map((pid, pi) => {
  const base = cat.places.get(pid);
  const walkY =
    base.walk.yMin + Math.round((base.walk.yMax - base.walk.yMin) / 4);
  const here = order.filter((s) => s.place === pid);
  const people = [...new Set(here.map((s) => s.person))];
  const hotspots = [];
  for (const s of here) {
    const person = cat.people.get(s.person);
    const refPlace = cat.places.get(person.ref.place);
    const scale =
      Math.round(
        person.ref.scale *
          ((base.playerScale ?? 1) / (refPlace.playerScale ?? 1)) *
          100,
      ) / 100;
    const k = people.indexOf(s.person);
    const x = Math.round(
      base.walk.xMin +
        ((base.walk.xMax - base.walk.xMin) * (k + 1)) / (people.length + 1),
    );
    const when = {};
    if (s.prev) when[flag(s.prev)] = 'fait';
    // une autre scène du même personnage, ici, plus tard : celle-ci s'efface une fois jouée pour lui laisser la place
    const later = order
      .slice(order.indexOf(s) + 1)
      .some((x2) => x2.place === pid && x2.person === s.person);
    if (later) when[flag(s.id)] = '';
    const h = {
      id: s.id,
      kind: 'npc',
      x,
      y: person.ref.place === pid ? person.ref.y : walkY,
      scene: s.id,
      sprite: person.sprite,
      scale,
      prompt: { fr: `parler à ${s.name}` },
    };
    if (person.ref.facing) h.facing = person.ref.facing;
    if (Object.keys(when).length) h.when = when;
    hotspots.push(h);
  }
  const entrances = {
    debut: { x: base.walk.xMin + 80, y: walkY, facing: 'right', walkIn: 200 },
    fin: { x: base.walk.xMax - 80, y: walkY, facing: 'left', walkIn: -200 },
  };
  const next = placeIds[pi + 1];
  const prev = placeIds[pi - 1];
  if (next)
    hotspots.push({
      id: `vers-${next}`,
      kind: 'exit',
      x: base.walk.xMax - 20,
      y: walkY,
      to: next,
      toEntrance: 'debut',
      prompt: { fr: `vers : ${cat.places.get(next).name.fr}` },
    });
  if (prev)
    hotspots.push({
      id: `vers-${prev}`,
      kind: 'exit',
      x: base.walk.xMin + 20,
      y: walkY,
      to: prev,
      toEntrance: 'fin',
      prompt: { fr: `vers : ${cat.places.get(prev).name.fr}` },
    });
  const place = { ...base, spawn: entrances.debut, entrances, hotspots };
  for (const k of ['props', 'ambient', 'onEnter', '$schema']) delete place[k];
  return place;
});

// images : seulement ce que ce paquet affiche (décors, personnages, joueur)
const images = {};
const want = new Set();
for (const p of places) for (const pl of p.planes) want.add(pl.image);
for (const s of sceneFiles) {
  const person = cat.people.get(s.npc);
  want.add(person.sprite);
  for (const k of Object.keys(cat.pack.assets.images))
    if (k.startsWith(`portrait_${person.portrait}_`)) want.add(k);
}
for (const k of Object.keys(cat.pack.assets.images))
  if (/^(player|playerf)_/.test(k) || k.startsWith('portrait_player'))
    want.add(k);
for (const b of cat.pack.profile?.bodies ?? []) want.add(b.front);
for (const k of want)
  if (cat.pack.assets.images[k]) images[k] = cat.pack.assets.images[k];

const pack = {
  id: packId,
  name: { fr: lesson.titre },
  language: langCode,
  uiLanguages: ['fr'],
  start: { place: placeIds[0], entrance: 'debut' },
  places: placeIds,
  scenes: sceneFiles.map((s) => s.id),
  modifiers: {},
  assets: {
    images,
    voicePath: `audio/vo/${packId}/`,
    keyWhite: (cat.pack.assets.keyWhite ?? []).filter((k) => images[k]),
    player: cat.pack.assets.player,
    playerF: cat.pack.assets.playerF,
  },
  title: {
    // le titre en langue cible, en mots du vocabulaire : il fonce à l'encre du carnet à mesure qu'on les rencontre
    line: titleLine,
    fr: lesson.titre,
    ...(lesson.soustitre ? { sub: { fr: lesson.soustitre } } : {}),
  },
  profile: {
    bodies: cat.pack.profile?.bodies ?? [],
    names: [],
    startItems: [],
  },
  source: {
    tableur: file.split('/').pop(),
    base: baseId,
    importe: new Date().toISOString().slice(0, 10),
  },
};

const out = join(CONTENT, 'packs', packId);
const summary = `${sceneFiles.length} scène(s), ${sceneFiles.reduce((n, s) => n + s.steps.length, 0)} étape(s), ${packLex.length} mot(s) nouveau(x), ${voices.length} voix à générer, lieu(x) : ${placeIds.join(', ')}`;
if (dryRun) {
  console.log(`\nTableur valide (essai, rien n'est écrit) : ${summary}`);
  process.exit(0);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'places'), { recursive: true });
mkdirSync(join(out, 'scenes'), { recursive: true });
const write = (p, d) =>
  writeFileSync(join(out, p), `${JSON.stringify(d, null, 2)}\n`);
write('pack.json', pack);
if (packLex.length) write('lexicon.json', { entries: packLex });
for (const p of places) write(`places/${p.id}.json`, p);
for (const s of sceneFiles) write(`scenes/${s.id}.json`, s);
write('voix-a-generer.json', voices);
console.log(`\n✔ Paquet écrit dans content/packs/${packId}/ : ${summary}`);
console.log('  Lance ensuite : node tools/validate.mjs');
