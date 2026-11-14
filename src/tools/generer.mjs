#!/usr/bin/env node
/**
 * Générateur de leçon : un thème + une liste de mots → un tableur de leçon rempli par l'IA, à faire relire.
 * L'IA propose, l'enseignant dispose : le tableur sort avec un onglet « Relecture » et ne s'importe
 * qu'une fois que l'enseignant a écrit son nom dans Leçon › « relu par ».
 *
 * Trois commandes :
 *
 *   node tools/generer.mjs consigne --theme "Négocier un prix" --mots "便宜，贵，…" [--niveau HSK1] [--scenes 3]
 *        [--identifiant ma-lecon] [--base shanghai] [-o consigne.md]
 *     Écrit la consigne à donner à une IA (Claude, dans une conversation) : catalogue, vocabulaire connu,
 *     règles pédagogiques et format de réponse attendu (JSON).
 *
 *   node tools/generer.mjs tableur <reponse-de-l-ia.json|.md> [--mots "…"] [-o brouillon.xlsx]
 *     Transforme la réponse de l'IA en tableur de leçon, vérifie tout avec l'importeur (essai),
 *     et liste dans l'onglet Relecture ce que l'enseignant doit regarder.
 *
 *   node tools/generer.mjs auto --theme … --mots … [mêmes options que consigne]
 *     Les deux d'un coup, en appelant l'API d'Anthropic (variable ANTHROPIC_API_KEY ;
 *     modèle : ANTHROPIC_MODEL, par défaut claude-opus-5-5).
 *
 * --mots accepte une liste (séparée par virgules, espaces ou retours à la ligne) ou @fichier.txt.
 * Sorties : sources/editeurs/brouillons/<identifiant>.json (réponse de l'IA) et <identifiant>.xlsx (tableur).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CONTENT, loadCatalogue } from './catalogue.mjs';
import { CHAMPS_LECON, ecrireTableur, ERREURS } from './tableur.mjs';

const OUT = new URL('../sources/editeurs/brouillons/', import.meta.url)
  .pathname;
const IMPORTER = new URL('./import.mjs', import.meta.url).pathname;
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const HAN = /\p{Script=Han}/u;

// ---------- Arguments ----------

const argv = process.argv.slice(2);
const command = argv[0];
const opt = (name, fallback = '') => {
  const i = argv.indexOf(name);
  return i > 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const positional = argv[1] && !argv[1].startsWith('-') ? argv[1] : '';

function fail(msg) {
  console.log(`✖  ${msg}`);
  process.exit(1);
}

/** Liste de mots : « a，b、c » ou « a b c » ou @fichier (un mot par ligne ; pinyin et sens éventuels ignorés). */
function parseWords(spec, langCode) {
  if (!spec) return [];
  const text = spec.startsWith('@')
    ? readFileSync(spec.slice(1), 'utf8')
    : spec;
  const tokens = text
    .split(/[\s,，、;；/]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const words = langCode === 'zh' ? tokens.filter((t) => HAN.test(t)) : tokens;
  return [...new Set(words)];
}

const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

// ---------- Consigne ----------

function buildConsigne({
  theme,
  words,
  niveau,
  nbScenes,
  identifiant,
  baseId,
  langCode,
}) {
  const cat = loadCatalogue(baseId);
  const lexicon = json(
    join(CONTENT, 'languages', langCode, 'lexicon.json'),
  ).entries;
  const places = [...cat.places.values()]
    .map((p) => `- ${p.id} : ${p.name?.fr ?? ''} (${p.name?.zh ?? ''})`)
    .join('\n');
  const people = [...cat.people.values()]
    .map(
      (p) =>
        `- ${p.id} : ${p.name}, ${p.label} (dessin d'origine dans « ${p.ref.place} »)`,
    )
    .join('\n');
  const known = lexicon
    .map((e) => `${e.target} (${e.transcription}, ${e.gloss?.fr ?? ''})`)
    .join(' · ');

  return `# Rédiger une leçon pour le jeu « Mille li »

Tu rédiges le brouillon d'une leçon de chinois pour des **francophones débutants**. Le jeu la met en scène : l'élève se promène dans un décor, parle à un personnage, l'écoute et choisit ses réponses. Un enseignant relira et corrigera ton brouillon avant qu'il n'arrive aux élèves : signale honnêtement tes doutes plutôt que de les cacher.

## La demande de l'enseignant

- Thème : **${theme}**
- Mots à faire travailler (${words.length}) : ${words.join('，') || '(aucun : choisis un vocabulaire adapté au thème)'}
- Niveau : ${niveau}
- Nombre de scènes : ${nbScenes}${identifiant ? `\n- Identifiant imposé pour la leçon : ${identifiant}` : ''}

## Ce dont tu disposes (et rien d'autre)

Le jeu n'a pas d'autres décors ni d'autres dessins de personnages que ceux-ci. Tu ne peux pas en inventer.

Lieux (colonne « lieu ») :
${places}

Personnages (colonne « personnage ») :
${people}

Un personnage peut jouer un autre rôle que son rôle d'origine : donne-lui alors un « nomAffiche » (en chinois) et un « role » (en français). Mais son dessin ne change pas : choisis un dessin plausible (âge, allure) pour le rôle.

**Si le thème demande un lieu qui n'existe pas** (un bureau, un hôpital…), joue la scène dans le lieu disponible le plus proche, adapte légèrement la situation pour qu'elle y soit crédible, et déclare-le dans « lieuxManquants ». C'est ainsi qu'on décide quels décors dessiner ensuite.

## Règles de vocabulaire (vérifiées automatiquement)

Écris les phrases normalement, avec la ponctuation chinoise (，。！？). Un outil les découpe ensuite en mots, en cherchant le mot le plus long connu. Donc **chaque mot de chaque phrase** (bonnes réponses ET mauvaises réponses) doit être :
- soit dans le vocabulaire déjà connu du jeu, ci-dessous ;
- soit dans ta liste « mots », avec son pinyin à tons et sa traduction française.
Un nom propre ou un nom de personnage utilisé dans une phrase (王经理…) doit lui aussi figurer dans « mots ». Mets dans « mots » tous les mots demandés par l'enseignant, et le moins possible d'autres mots nouveaux.

Vocabulaire déjà connu du jeu (${lexicon.length} mots) :
${known}

## Règles pédagogiques

1. Chaque mot demandé apparaît au moins une fois, si possible deux : d'abord entendu (« dit » par le personnage), puis produit par l'élève (« choix »).
2. Phrases courtes et naturelles, au niveau demandé. Pas de tournure rare ni de vocabulaire au-dessus du niveau sans nécessité.
3. Chaque scène : 6 à 12 lignes, dont 2 à 4 « choix ». Elle commence par une réplique du personnage.
4. « choix » : la colonne « texte » est la SEULE bonne réponse. La « consigne » dit en français ce que l'élève veut exprimer, sans donner le chinois.
5. Chaque mauvaise réponse (1 à 3 par choix) est plausible pour un débutant mais fausse dans cette situation, pour **une** raison claire. Jamais deux réponses acceptables.
6. « pourquoi » : une ou deux phrases en français, au tutoiement, adressées à l'élève, qui expliquent l'erreur et redonnent la bonne forme.
7. « erreur » : un seul mot parmi ${ERREURS.join(', ')}.
8. « qui » : pour « dit », l'identifiant du personnage de la scène ou « joueur » ; pour « choix », toujours « joueur ».
9. Traductions françaises naturelles (pas de mot à mot), « tu » entre l'élève et les personnages familiers, « vous » si la situation l'exige.
10. Les scènes se jouent dans l'ordre donné ; chacune s'ouvre quand la précédente est finie.

## Format de ta réponse

Réponds uniquement par un bloc \`\`\`json contenant cet objet (les champs entre crochets sont facultatifs) :

\`\`\`json
{
  "motsDemandes": ["recopie ici exactement la liste des mots demandés"],
  "lecon": {
    "identifiant": "minuscules-et-tirets",
    "titre": "titre en français",
    "titreCible": "titre en chinois",
    "transcriptionTitre": "pinyin du titre",
    "sousTitre": "[petite ligne sous le titre]"
  },
  "mots": [
    { "mot": "便宜", "transcription": "piányi", "traduction": "bon marché", "nature": "[adjectif]", "niveau": "[HSK2]" }
  ],
  "scenes": [
    { "id": "minuscules-et-tirets", "titre": "titre en français", "lieu": "id d'un lieu", "personnage": "id d'un personnage",
      "nomAffiche": "[nom chinois du rôle]", "role": "[qui il est, en français]", "patience": 3 }
  ],
  "repliques": [
    { "scene": "id de la scène", "type": "dit", "qui": "id du personnage ou joueur", "texte": "…", "traduction": "…" },
    { "scene": "id de la scène", "type": "choix", "qui": "joueur", "texte": "la bonne réponse", "traduction": "…",
      "consigne": "ce que l'élève veut dire, en français",
      "faux": [ { "texte": "…", "traduction": "…", "pourquoi": "…", "erreur": "sens" } ] }
  ],
  "lieuxManquants": [
    { "souhaite": "le lieu qu'il aurait fallu, en français", "remplace": "id du lieu utilisé à la place", "pourquoi": "…" }
  ],
  "notes": ["tes doutes et les points que l'enseignant devrait vérifier en priorité"]
}
\`\`\`
`;
}

// ---------- Réponse de l'IA → tableur ----------

/** Extrait l'objet JSON d'une réponse (fichier .json, ou texte avec un bloc ```json). */
function readDraft(text) {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  const raw = fenced ? fenced[1] : text;
  try {
    return JSON.parse(raw);
  } catch (e) {
    fail(`La réponse de l'IA n'est pas un JSON lisible : ${e.message}`);
  }
}

/** Lance l'importeur en essai sur le tableur ; renvoie ses erreurs et avertissements. */
function dryRun(xlsx) {
  const r = spawnSync(process.execPath, [IMPORTER, xlsx, '--dry-run'], {
    encoding: 'utf8',
  });
  const lines = (r.stdout ?? '').split('\n');
  return {
    ok: r.status === 0,
    errors: lines
      .filter((l) => l.startsWith('✖'))
      .map((l) => l.slice(1).trim()),
    warnings: lines
      .filter((l) => l.startsWith('⚠'))
      .map((l) => l.slice(1).trim())
      .filter((l) => !l.includes('relu par')),
    summary: lines.find((l) => l.startsWith('Tableur valide')) ?? '',
  };
}

async function draftToSheet(draft, { requested, out, baseId = 'shanghai' }) {
  const cat = loadCatalogue(baseId);
  const langCode = 'zh';
  const lexicon = json(
    join(CONTENT, 'languages', langCode, 'lexicon.json'),
  ).entries;
  const known = new Set(lexicon.map((e) => e.target));

  const L = draft.lecon ?? {};
  const identifiant = slug(L.identifiant || L.titre || 'lecon-generee');
  const lesson = {
    identifiant,
    titre: L.titre ?? '',
    'titre en langue cible': L.titreCible ?? '',
    'transcription du titre': L.transcriptionTitre ?? '',
    'sous-titre': L.sousTitre ?? '',
    langue: langCode,
    'paquet de base': baseId,
    'rédigé par': 'IA (brouillon)',
    'relu par': '',
  };
  for (const [k] of CHAMPS_LECON) lesson[k] ??= '';

  const mots = draft.mots ?? [];
  const words = mots.map((m) => [
    m.mot ?? '',
    m.transcription ?? '',
    m.traduction ?? '',
    m.nature ?? '',
    m.niveau ?? '',
    '',
  ]);
  const scenes = (draft.scenes ?? []).map((s) => [
    s.id ?? '',
    s.titre ?? '',
    s.lieu ?? '',
    s.personnage ?? '',
    s.nomAffiche ?? '',
    s.role ?? '',
    s.apres ?? '',
    s.patience ?? 3,
  ]);
  const lines = (draft.repliques ?? []).map((r) => {
    const row = [
      r.scene ?? '',
      r.type ?? '',
      r.qui ?? '',
      r.texte ?? '',
      r.traduction ?? '',
      r.consigne ?? '',
    ];
    for (const f of (r.faux ?? []).slice(0, 3))
      row.push(
        f.texte ?? '',
        f.traduction ?? '',
        f.pourquoi ?? '',
        f.erreur ?? '',
      );
    return row;
  });

  // ---- Ce que l'enseignant doit relire ----
  const rel = [];
  const allText = (draft.repliques ?? [])
    .flatMap((r) => [
      r.texte ?? '',
      ...(r.faux ?? []).map((f) => f.texte ?? ''),
    ])
    .join(' ');
  const goodText = (draft.repliques ?? []).map((r) => r.texte ?? '').join(' ');
  const req = requested.length ? requested : (draft.motsDemandes ?? []);

  for (const m of draft.lieuxManquants ?? []) {
    const used = cat.places.get(m.remplace);
    rel.push([
      'Lieu manquant',
      `La leçon demandait : ${m.souhaite}. Elle se joue pour l'instant dans : ${used?.name?.fr ?? m.remplace}.`,
      `${m.pourquoi ?? ''} → Décor à ajouter à la bibliothèque si la leçon est retenue.`,
    ]);
  }
  for (const w of req) {
    if (!allText.includes(w))
      rel.push([
        'Mot demandé',
        `« ${w} » était demandé mais n'apparaît dans aucune phrase.`,
        'Ajouter une réplique qui l’emploie, ou le retirer de la demande.',
      ]);
    else if (!goodText.includes(w))
      rel.push([
        'Mot demandé',
        `« ${w} » n'apparaît que dans une mauvaise réponse.`,
        'L’élève ne l’entend jamais employé correctement : ajouter une réplique.',
      ]);
  }
  const reqSet = new Set(req);
  for (const m of mots)
    if (m.mot && !reqSet.has(m.mot) && !known.has(m.mot))
      rel.push([
        'Mot ajouté par l’IA',
        `${m.mot} (${m.transcription ?? '?'}) : ${m.traduction ?? '?'}`,
        'Hors de la liste demandée : vérifier qu’il est utile et au niveau de la classe.',
      ]);
  for (const n of draft.notes ?? []) rel.push(['Doute de l’IA', n, '']);

  const base = { cat, lesson, words, scenes, lines };
  await ecrireTableur(out, { ...base, relecture: rel });
  const check = dryRun(out);
  for (const e of check.errors)
    rel.unshift([
      'Erreur à corriger',
      e,
      'Bloque l’import : à corriger dans le tableur (onglet et ligne indiqués).',
    ]);
  for (const w of check.warnings) rel.push(['Avertissement', w, '']);
  rel.push(
    [
      'Chinois',
      'Chaque phrase est correcte et naturelle : caractères, grammaire, registre.',
      'Onglet Répliques, colonnes Texte et Faux.',
    ],
    [
      'Pinyin et sens',
      'Les tons et les traductions de l’onglet Mots sont justes.',
      'Ce sont eux que l’élève retrouve dans son carnet.',
    ],
    [
      'Mauvaises réponses',
      'Chaque mauvaise réponse est vraiment fausse dans la situation, et son explication (« Pourquoi ») est juste.',
      'Le type d’erreur nourrit le bilan de l’élève.',
    ],
    ['Niveau', 'Le vocabulaire et la grammaire correspondent à la classe.', ''],
    [
      'Validation',
      'Une fois tout vérifié, écrire votre nom dans l’onglet Leçon, ligne « relu par ».',
      'Sans ce nom, l’import refuse le brouillon.',
    ],
  );
  await ecrireTableur(out, { ...base, relecture: rel });
  return { identifiant, rel, check };
}

// ---------- API d'Anthropic (commande auto) ----------

async function askClaude(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key)
    fail(
      'ANTHROPIC_API_KEY absente : utilise « consigne » puis « tableur » (avec Claude dans une conversation), ou définis la clé.',
    );
  const base = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com';
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-5-5',
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    fail(`API d'Anthropic : ${res.status} ${body?.error?.message ?? ''}`);
  return (body.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

// ---------- Commandes ----------

function report({ identifiant, rel, check }, out) {
  const todo = rel.filter(
    ([k]) =>
      ![
        'Chinois',
        'Pinyin et sens',
        'Mauvaises réponses',
        'Niveau',
        'Validation',
      ].includes(k),
  );
  console.log(`✔ Brouillon : ${out.replace(/^.*\/sources\//, 'sources/')}`);
  if (check.summary)
    console.log(`  ${check.summary.replace(/ \(essai.*?\)/, '')}`);
  console.log(
    check.errors.length
      ? `  ${check.errors.length} erreur(s) à corriger avant l'import (en tête de l'onglet Relecture).`
      : '  Aucune erreur bloquante.',
  );
  for (const [k, p] of todo) console.log(`  • ${k} : ${p}`);
  console.log(
    `  Après relecture (nom dans « relu par ») : node tools/import.mjs ${out.replace(/^.*\/src\//, '')}`,
  );
  return identifiant;
}

const langCode = 'zh';
const baseId = opt('--base', 'shanghai');

if (command === 'consigne' || command === 'auto') {
  const theme = opt('--theme');
  if (!theme) fail('--theme manquant');
  const words = parseWords(opt('--mots'), langCode);
  const params = {
    theme,
    words,
    niveau: opt('--niveau', 'débutant (HSK 1-2)'),
    nbScenes: Number(opt('--scenes', '2')),
    identifiant: opt('--identifiant') ? slug(opt('--identifiant')) : '',
    baseId,
    langCode,
  };
  const prompt = buildConsigne(params);
  if (command === 'consigne') {
    const o = opt('-o');
    if (o) {
      writeFileSync(o, prompt);
      console.log(
        `✔ Consigne écrite dans ${o} (${words.length} mots demandés)`,
      );
    } else process.stdout.write(prompt);
  } else {
    mkdirSync(OUT, { recursive: true });
    console.log(
      `… Rédaction par l'IA (${words.length} mots, thème « ${theme} »)`,
    );
    const answer = await askClaude(prompt);
    const draft = readDraft(answer);
    const id = params.identifiant || slug(draft.lecon?.identifiant || theme);
    draft.lecon = { ...draft.lecon, identifiant: id };
    writeFileSync(
      join(OUT, `${id}.json`),
      `${JSON.stringify(draft, null, 2)}\n`,
    );
    const out = opt('-o') || join(OUT, `${id}.xlsx`);
    report(await draftToSheet(draft, { requested: words, out, baseId }), out);
  }
} else if (command === 'tableur') {
  if (!positional || !existsSync(positional))
    fail(
      'Usage : node tools/generer.mjs tableur <reponse-de-l-ia.json|.md> [-o brouillon.xlsx]',
    );
  const draft = readDraft(readFileSync(positional, 'utf8'));
  const id = slug(
    draft.lecon?.identifiant || draft.lecon?.titre || 'lecon-generee',
  );
  mkdirSync(OUT, { recursive: true });
  const out = opt('-o') || join(OUT, `${id}.xlsx`);
  const requested = parseWords(opt('--mots'), langCode);
  report(await draftToSheet(draft, { requested, out, baseId }), out);
} else {
  console.log(
    'Usage :\n  node tools/generer.mjs consigne --theme "…" --mots "…" [--niveau …] [--scenes 2] [-o consigne.md]\n  node tools/generer.mjs tableur <reponse.json|.md> [--mots "…"] [-o brouillon.xlsx]\n  node tools/generer.mjs auto --theme "…" --mots "…"   (ANTHROPIC_API_KEY)',
  );
  process.exit(command ? 1 : 0);
}
