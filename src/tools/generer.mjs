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
 *   node tools/generer.mjs consigne --lecon @lecon-du-manuel.txt [--mots …] [--niveau …] [--scenes N]
 *     Variante « éditeur » : on part du texte d'une leçon de manuel (dialogue, vocabulaire, exercices,
 *     copiés tels quels). L'IA garde les phrases du manuel et ajoute les questions ; la liste de mots
 *     est celle du manuel si --mots est absent. « tableur » et « auto » acceptent aussi --lecon :
 *     chaque phrase du dialogue absente de la leçon jouable est alors signalée dans la Relecture.
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

/** Section de la consigne pour adapter une leçon existante (manuel d'un éditeur, cours d'un prof). */
function adaptation(lessonText) {
  return `## La leçon à adapter (texte fourni par l'éditeur ou l'enseignant)

Cette leçon existe déjà, dans un manuel ou un cours. Tu ne la réécris pas : tu la **mets en scène**.

\`\`\`
${lessonText.trim()}
\`\`\`

Règles d'adaptation :
A. **Les phrases du dialogue restent celles de la leçon**, mot pour mot, avec leur ponctuation. Tu peux couper une réplique longue en deux lignes, jamais la reformuler. Si une phrase te paraît fautive ou impossible à garder, garde-la quand même et explique pourquoi dans « notes ».
B. L'élève joue le personnage du dialogue qui lui ressemble le plus (un étudiant, un client, un visiteur) ; dis lequel dans « notes ». Ses répliques deviennent des « choix » : la phrase du manuel est la bonne réponse, et c'est toi qui écris les mauvaises. Les répliques des autres personnages deviennent des « dit ».
C. Les personnages du manuel gardent leur nom : mets-le dans « nomAffiche », et prends pour chacun le dessin le plus plausible du catalogue.
D. Le lieu de la leçon devient le lieu le plus proche du catalogue (sinon : « lieuxManquants »).
E. Si l'enseignant n'a pas donné de liste de mots, « motsDemandes » est la liste de vocabulaire de la leçon (生词…), recopiée.
F. Les exercices de la leçon, s'il y en a, peuvent t'inspirer des « choix » supplémentaires, placés là où ils s'insèrent naturellement dans la scène.
G. Le titre de la leçon garde son titre d'origine (titreCible) et sa traduction (titre).
I. **Un récit** (texte sans dialogue) devient une **lecture guidée** : chaque phrase du récit est une ligne « dit » dont « qui » vaut « narrateur », mot pour mot ; puis 1 à 3 « choix » de compréhension : la consigne pose la question en français, la bonne réponse est une phrase du récit (ou une phrase courte faite de ses mots), les mauvaises la contredisent. Une scène de lecture garde un personnage du catalogue (celui près duquel l'élève lit), qui peut ne rien dire.
J. Si le texte impose le personnage joué par l'élève (un prénom, un genre), mets « m » ou « f » dans « joueur ».
H. La longueur des scènes suit celle du dialogue : les limites de nombre de lignes et de « choix » de la règle 3 ne s'appliquent pas.
I. **Analyse des caractères.** Si la leçon contient une analyse des mots (colonne « Analyse » d'un tableau de vocabulaire, décomposition en caractères et composants, étymologie, aide-mémoire), recopie-la **mot pour mot** dans le champ « analyse » du mot, sans la résumer, la corriger ni la compléter (retours à la ligne permis : \\n). Un mot dont la leçon ne donne pas d'analyse n'a pas de champ « analyse ».
J. **Mots déjà connus du jeu.** Si la leçon donne pour un mot déjà connu du jeu un sens ou une analyse, liste-le **aussi** dans « mots » avec la traduction de la leçon et son analyse recopiée : c'est l'explication de l'enseignant que l'élève doit retrouver dans son carnet (elle remplace celle du jeu pour cette leçon seulement). Les autres mots connus n'ont rien à faire dans « mots ».

`;
}

function buildConsigne({
  theme,
  lessonText,
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
${theme ? `\n- Thème : **${theme}**` : ''}
- Mots à faire travailler : ${words.length ? `${words.join('，')} (${words.length})` : lessonText ? 'ceux du vocabulaire de la leçon ci-dessous (生词…)' : 'aucun imposé : choisis un vocabulaire adapté au thème'}
- Niveau : ${niveau}
- Nombre de scènes : ${nbScenes}${identifiant ? `\n- Identifiant imposé pour la leçon : ${identifiant}` : ''}

${lessonText ? adaptation(lessonText) : ''}## Ce dont tu disposes (et rien d'autre)

Le jeu n'a pas d'autres décors ni d'autres dessins de personnages que ceux-ci. Tu ne peux pas en inventer.

Lieux (colonne « lieu ») :
${places}

Personnages (colonne « personnage ») :
${people}

Un personnage peut jouer un autre rôle que son rôle d'origine : donne-lui alors un « nomAffiche » (en chinois) et un « role » (en français). Mais son dessin ne change pas : choisis un dessin plausible (âge, allure) pour le rôle.

**Si un personnage nécessaire n'a pas de dessin plausible** (un homme d'affaires en costume, une enfant…), prends le dessin le moins éloigné et déclare-le dans « personnagesManquants ».

**Si le thème demande un lieu qui n'existe pas** (un bureau, un hôpital…), joue la scène dans le lieu disponible le plus proche, adapte légèrement la situation pour qu'elle y soit crédible, et déclare-le dans « lieuxManquants ». C'est ainsi qu'on décide quels décors dessiner ensuite.

## Règles de vocabulaire (vérifiées automatiquement)

Écris les phrases normalement, avec la ponctuation chinoise (，。！？). Un outil les découpe ensuite en mots, en cherchant le mot le plus long connu. Donc **chaque mot de chaque phrase** (bonnes réponses ET mauvaises réponses) doit être :
- soit dans le vocabulaire déjà connu du jeu, ci-dessous ;
- soit dans ta liste « mots », avec son pinyin à tons et sa traduction française.
Un nom propre ou un nom de personnage utilisé dans une phrase (王经理…) doit lui aussi figurer dans « mots ». Mets dans « mots » tous les mots demandés par l'enseignant, et le moins possible d'autres mots nouveaux.

Le champ « analyse » d'un mot est **facultatif** et réservé à l'analyse écrite par l'enseignant dans la leçon fournie (caractères, composants, étymologie, aide-mémoire), recopiée mot pour mot. **N'invente jamais d'étymologie ni de décomposition** : sans analyse dans la leçon fournie, laisse « analyse » absent. Une étymologie inventée serait apprise par l'élève comme vraie.

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
8. « qui » : pour « dit », l'identifiant du personnage de la scène, « joueur », ou « narrateur » (phrase de récit) ; pour « choix », toujours « joueur ».
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
    "sousTitre": "[petite ligne sous le titre]",
    "joueur": "[m ou f, seulement si le texte impose le personnage que joue l'élève]"
  },
  "mots": [
    { "mot": "便宜", "transcription": "piányi", "traduction": "bon marché", "nature": "[adjectif]", "niveau": "[HSK2]",
      "analyse": "[seulement si la leçon fournie en donne une : recopiée mot pour mot]" }
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
  "personnagesManquants": [
    { "souhaite": "le personnage qu'il aurait fallu dessiner", "remplace": "id du dessin utilisé à la place", "pourquoi": "…" }
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

/**
 * Phrases du dialogue d'une leçon de manuel, sans le nom du locuteur (« 售货员：… », « A：… »).
 * S'il y a au moins deux lignes de dialogue avec locuteur, seules celles-là comptent (le vocabulaire
 * et les exercices sont ignorés) ; sinon, toutes les phrases à ponctuation finale.
 */
function lessonSentences(lessonText) {
  const SPEAKER = /^\s*[\p{Script=Han}A-Za-z·]{1,6}\s*[：:]/u;
  let lines = lessonText.split('\n');
  const spoken = lines.filter((l) => SPEAKER.test(l));
  if (spoken.length >= 2) lines = spoken;
  const out = [];
  for (const line of lines)
    for (const piece of line
      .replace(SPEAKER, '')
      .match(/[^。！？!?]+[。！？!?]+/g) ?? []) {
      const han = [...piece].filter((c) => HAN.test(c)).join('');
      if (han.length >= 2) out.push(compact(piece));
    }
  return [...new Set(out)];
}
/** Comparaison des phrases : à l'espace près (caractères et ponctuation doivent être identiques). */
const compact = (t) => t.replace(/[\s\u3000]+/g, '');

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

async function draftToSheet(
  draft,
  { requested, out, baseId = 'shanghai', lessonText = '' },
) {
  const cat = loadCatalogue(baseId);
  const langCode = 'zh';
  const lexicon = json(
    join(CONTENT, 'languages', langCode, 'lexicon.json'),
  ).entries;
  const known = new Set(lexicon.map((e) => e.target));
  const knownByTarget = new Map(lexicon.map((e) => [e.target, e]));

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
    joueur: L.joueur ?? '',
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
    m.analyse ?? '',
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
  const shownNames = (draft.scenes ?? [])
    .map((sc) => sc.nomAffiche ?? '')
    .join(' ');
  for (const w of req) {
    if (!allText.includes(w) && shownNames.includes(w))
      rel.push([
        'Mot demandé',
        `« ${w} » n'apparaît que dans le nom affiché d'un personnage, dans aucune phrase.`,
        'L’élève le voit sans l’entendre : ajouter une réplique qui l’emploie si le mot doit être appris.',
      ]);
    else if (!allText.includes(w))
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
  // mots connus du jeu dont la leçon donne un autre sens ou une analyse : ils surchargeront le lexique (ce paquet seulement)
  for (const m of mots) {
    const k = knownByTarget.get(m.mot);
    if (!k) continue;
    const changes = [];
    const plain = (x) =>
      (x ?? '').replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();
    if (m.traduction && plain(m.traduction) !== plain(k.gloss?.fr))
      changes.push(
        `sens : « ${k.gloss?.fr ?? ''} » dans le jeu → « ${m.traduction} » dans la leçon`,
      );
    if (m.analyse) changes.push('analyse de l’enseignant ajoutée');
    if (changes.length)
      rel.push([
        'Mot connu, surchargé',
        `${m.mot} (${k.transcription ?? ''}) : ${changes.join(' ; ')}.`,
        'Valable dans cette leçon seulement. Effacer la ligne de l’onglet Mots pour garder le sens du jeu.',
      ]);
  }
  // analyses : recopiées de la leçon fournie, jamais inventées
  const withAnalysis = mots.filter((m) => m.analyse);
  if (withAnalysis.length) {
    const source = compact(lessonText);
    const notFound = withAnalysis.filter(
      (m) => !lessonText || !source.includes(compact(m.analyse)),
    );
    for (const m of notFound)
      rel.push([
        'Analyse à vérifier',
        lessonText
          ? `L’analyse de ${m.mot} n’est pas recopiée telle quelle de la leçon fournie.`
          : `${m.mot} a une analyse, mais aucune leçon n’a été fournie : l’IA a pu l’inventer.`,
        'Comparer avec le cours (colonne Analyse de l’onglet Mots) ; une étymologie inventée doit être effacée.',
      ]);
    if (withAnalysis.length > notFound.length)
      rel.push([
        'Analyses',
        `${withAnalysis.length - notFound.length} analyse(s) recopiée(s) mot pour mot de la leçon.`,
        'Vérifié automatiquement (à l’espace près).',
      ]);
  }
  for (const m of draft.personnagesManquants ?? []) {
    const used = cat.people.get(m.remplace);
    rel.push([
      'Personnage manquant',
      `La leçon demandait : ${m.souhaite}. Il est joué pour l'instant par le dessin de ${used ? `${used.name} (${used.label})` : m.remplace}.`,
      `${m.pourquoi ?? ''} → Dessin à ajouter à la bibliothèque si la leçon est retenue.`,
    ]);
  }
  if (lessonText) {
    const played = compact(
      (draft.repliques ?? []).map((r) => r.texte ?? '').join('\n'),
    );
    const missing = lessonSentences(lessonText).filter(
      (p) => !played.includes(p),
    );
    for (const p of missing)
      rel.push([
        'Phrase du manuel',
        `« ${p} » n'est pas reprise telle quelle dans la leçon jouable.`,
        'Vérifier si elle a été coupée, modifiée ou oubliée (le texte du manuel doit rester intact).',
      ]);
    if (!missing.length)
      rel.push([
        'Phrases du manuel',
        `Les ${lessonSentences(lessonText).length} phrases du dialogue sont reprises mot pour mot.`,
        'Vérifié automatiquement.',
      ]);
  }
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

/** Texte de la leçon à adapter : @fichier ou texte direct. */
function readLesson(spec) {
  if (!spec) return '';
  const text = spec.startsWith('@')
    ? readFileSync(spec.slice(1), 'utf8')
    : spec;
  if (!HAN.test(text))
    fail('--lecon : le texte de la leçon ne contient aucun caractère chinois');
  return text;
}

const langCode = 'zh';
const baseId = opt('--base', 'shanghai');

if (command === 'consigne' || command === 'auto') {
  const theme = opt('--theme');
  const lessonText = readLesson(opt('--lecon'));
  if (!theme && !lessonText) fail('--theme ou --lecon manquant');
  const words = parseWords(opt('--mots'), langCode);
  const params = {
    theme,
    lessonText,
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
        `✔ Consigne écrite dans ${o} (${words.length ? `${words.length} mots demandés` : lessonText ? 'vocabulaire de la leçon' : 'vocabulaire libre'})`,
      );
    } else process.stdout.write(prompt);
  } else {
    mkdirSync(OUT, { recursive: true });
    console.log(
      `… Rédaction par l'IA (${theme ? `thème « ${theme} »` : 'adaptation d’une leçon'}, ${words.length} mots demandés)`,
    );
    const answer = await askClaude(prompt);
    const draft = readDraft(answer);
    const id =
      params.identifiant || slug(draft.lecon?.identifiant || theme || 'lecon');
    draft.lecon = { ...draft.lecon, identifiant: id };
    writeFileSync(
      join(OUT, `${id}.json`),
      `${JSON.stringify(draft, null, 2)}\n`,
    );
    const out = opt('-o') || join(OUT, `${id}.xlsx`);
    report(
      await draftToSheet(draft, { requested: words, out, baseId, lessonText }),
      out,
    );
  }
} else if (command === 'tableur') {
  if (!positional || !existsSync(positional))
    fail(
      'Usage : node tools/generer.mjs tableur <reponse-de-l-ia.json|.md> [--lecon @lecon.txt] [-o brouillon.xlsx]',
    );
  const draft = readDraft(readFileSync(positional, 'utf8'));
  const id = slug(
    draft.lecon?.identifiant || draft.lecon?.titre || 'lecon-generee',
  );
  mkdirSync(OUT, { recursive: true });
  const out = opt('-o') || join(OUT, `${id}.xlsx`);
  const requested = parseWords(opt('--mots'), langCode);
  const lessonText = readLesson(opt('--lecon'));
  report(
    await draftToSheet(draft, { requested, out, baseId, lessonText }),
    out,
  );
} else {
  console.log(
    'Usage :\n  node tools/generer.mjs consigne --theme "…" --mots "…" [--niveau …] [--scenes 2] [-o consigne.md]\n  node tools/generer.mjs consigne --lecon @lecon-du-manuel.txt [--mots "…"] [-o consigne.md]\n  node tools/generer.mjs tableur <reponse.json|.md> [--mots "…"] [-o brouillon.xlsx]\n  node tools/generer.mjs auto --theme "…" --mots "…"   (ANTHROPIC_API_KEY)',
  );
  process.exit(command ? 1 : 0);
}
