import type { PlayerArt } from './puppet';
/**
 * Types et chargement du contenu. Le moteur ne connaît aucune langue :
 * tout texte affiché ou joué vient de ces fichiers.
 */
export type Localized = Record<string, string>;

export interface LexEntry {
  id: string;
  target: string;
  transcription?: string;
  gloss: Localized;
  pos?: string;
  level?: string;
  taughtInContext?: boolean;
}

export interface Language {
  code: string;
  bcp47: string;
  name: Localized;
  direction: 'ltr' | 'rtl';
  transcription?: string;
  font: string;
  casting: Record<string, { voice: string; label?: string; style?: string }>;
  mastery?: { contextsRequired: number };
}

/**
 * Jeton d'une ligne : ['w', idLexique] | ['p', ponctuation] | ['t', littéral, transcription, glose]
 * | ['v', VARIABLE] (remplacé selon le profil du joueur : NAME, TA…).
 */
export type Token = ['w', string] | ['p', string] | ['t', string, string, string] | ['v', string];

export interface Choice {
  ok?: boolean;
  vo?: string;
  line: Token[];
  gloss: Localized;
  why?: Localized;
  errorType?: string;
  /** Réglages du profil posés par ce choix (name, country, quest, ou drapeau). */
  set?: Record<string, string>;
}

export interface PickOption {
  object: string;
  qty?: string;
  ok?: boolean;
  why?: Localized;
  errorType?: string;
  set?: Record<string, string>;
  caption?: Localized;
}

/** Caractère proposé pour combler une case d'une ligne abîmée. */
export interface RestoreOption {
  /** Le caractère lui-même (un seul). */
  char: string;
  /** Sa transcription : cachée au départ, montrée après une première erreur sur la case. */
  transcription?: string;
  /** Mot du lexique où le joueur l'a rencontré (carnet, confusions du détour). */
  word?: string;
  ok?: boolean;
  why?: Localized;
  errorType?: string;
}

/**
 * Restauration : une ligne écrite (colophon, enseigne, stèle…) dont des caractères manquent.
 * `at` = rang du caractère manquant dans la ligne, ponctuation comprise (0 = premier).
 */
export interface Restore {
  line: Token[];
  gloss: Localized;
  /** Voix de la lecture complète, une fois la ligne restaurée. */
  vo?: string;
  gaps: { at: number; options: RestoreOption[] }[];
  /** Écrite en colonne, de haut en bas (sinon en ligne). */
  vertical?: boolean;
}

/**
 * Réplique d'étal : une ligne où ['v', 'WORD'] marque la place de l'article.
 * `vo` ne contient que la partie fixe (« 这是 », « 要吗？ ») : le mot lui-même est joué par son clip `w_<id>`.
 * Dans la glose, {word} est remplacé par la traduction de l'article.
 */
export interface StallLine {
  vo?: string;
  line: Token[];
  gloss: Localized;
}

/** Un article de l'étal. */
export interface StallGood {
  word: string;
  /** Pas encore sur l'étal (voix pas encore enregistrées, par exemple) : ni cible ni distracteur. */
  soon?: boolean;
  /** Clé d'image (sinon `obj_<word>`, puis l'image de l'objet du sac qui porte ce mot ; à défaut, étiquette peinte). */
  image?: string;
  /** Mots proposés à côté du bon (modes « dire » et « acheter ») : de préférence sur les mêmes caractères. */
  foils?: string[];
  /** Prix dit par le commerçant, en mots du lexique (ex. 三十块). */
  price?: Token[];
  /** Le même prix en chiffres, pour la traduction (30). */
  cost?: number;
  /** Objet du sac reçu à l'achat (sinon celui dont le mot est le même ; à défaut, un petit sac de provisions). */
  item?: string;
}

export type StallMode = 'listen' | 'read' | 'say' | 'buy';

/**
 * Étal libre : mini-jeu de vocabulaire rejouable. Une partie = quelques manches courtes, modes mélangés,
 * mots tirés en privilégiant ceux qui sont fragiles dans le carnet.
 */
export interface Stall {
  goods: StallGood[];
  /** Nombre de manches (6 par défaut). */
  rounds?: number;
  /** Articles posés sur l'étal à chaque manche (6 par défaut). */
  show?: number;
  /** Modes autorisés ; « buy » n'est joué qu'une fois, à la dernière manche. */
  modes?: StallMode[];
  /** Nom du contexte noté dans le carnet (« étal de 陈爷爷 »). */
  context?: Localized;
  /** Objet du sac qui permet de payer (sans lui, le commerçant dit « la prochaine fois »). */
  money?: string;
  lines: {
    open?: StallLine;
    /** Le commerçant propose un article (au moins une réplique) : la phrase varie, le contexte aussi. */
    offer: StallLine[];
    /** « Qu'est-ce que c'est ? » (mode « dire »). */
    ask?: StallLine;
    /** Le joueur demande l'article (mode « acheter »). */
    want?: StallLine;
    sold?: StallLine;
    broke?: StallLine;
    bye?: StallLine;
  };
}

/** Réplique simple (voix d'une seule personne, clip entier). */
export interface Said {
  vo?: string;
  line: Token[];
  gloss: Localized;
}

/** Une réponse proposée dans une case de ticket, une carte d'étape… */
export interface TaskOption {
  line: Token[];
  ok?: boolean;
  why?: Localized;
  errorType?: string;
}

/**
 * Ticket de commande : le client commande (souvent sans texte, à l'oreille), le joueur remplit une case par élément
 * (quantité + classificateur, plat, précision…). Rien n'est corrigé sur le moment : l'erreur se découvre au service.
 */
export interface Ticket {
  /** Identifiant repris par les étapes « serve » et « pay ». */
  id: string;
  /** La commande n'est pas écrite dans la bulle : on l'écoute (par défaut). */
  hidden?: boolean;
  /** « Attendez ! » : le joueur peut faire répéter une fois ; le client répète (en soupirant) et ses mots s'affichent. */
  wait?: Said;
  again?: Said;
  items: {
    /** Nombre d'unités et prix unitaire (pour l'addition à la caisse). */
    n: number;
    unit: number;
    /** Ce que dit le client si cet élément est faux (« je n'en veux pas, je veux… »). */
    complaint: Said;
    cells: { kind?: string; options: TaskOption[]; complaint?: Said }[];
  }[];
}

/** Cartes d'étapes à remettre dans l'ordre de la consigne (recette, itinéraire…). L'ordre du fichier est le bon. */
export interface Sequence {
  hidden?: boolean;
  cards: { line: Token[]; why: Localized }[];
}

/** Service : chaque plateau (ticket rempli par le joueur) est porté à une place, désignée par ce qu'a dit le client. */
export interface Serve {
  /** Perte de caisse pour un plateau mal servi (plat refait). */
  penalty?: number;
  places: {
    ticket: string;
    actor: string;
    line: Token[];
    caption?: Localized;
    /** Pourquoi c'est cette place (rappel de ce que le client a dit). */
    why: Localized;
    thanks: Said;
  }[];
}

/** Encaissement : dire le total (au choix), puis rendre la monnaie avec les pièces et billets de la monnaie du pack. */
export interface Pay {
  ticket: string;
  ask: Said;
  /** Totaux proposés au joueur (le bon = la somme du ticket). */
  totals: { n: number; why?: Localized; errorType?: string }[];
  /**
   * Répliques du joueur avec un montant : ["v", "AMOUNT"] marque sa place, {n} le remplace dans la voix et la glose
   * (un clip par montant : `c2_p_kuai_{n}_{body}`). `total` = « 七块。 », `change` = « 找你三块。 ».
   */
  total: Said;
  change: Said;
  /** Le billet tendu par le client (« 给你十块。 »). */
  given: Said & { n: number };
  thanks: Said;
  /** Monnaie fausse. */
  wrong: Said;
}

export interface Step {
  type: 'say' | 'choose' | 'pick' | 'cinematic' | 'restore' | 'stall' | 'ticket' | 'sequence' | 'serve' | 'pay';
  /** Ligne à restaurer (étape « restore »). */
  restore?: Restore;
  /** Étal libre (étape « stall »). */
  stall?: Stall;
  ticket?: Ticket;
  sequence?: Sequence;
  serve?: Serve;
  pay?: Pay;
  /** Fin de service : bilan de caisse et paie (scène avec `till`). */
  wage?: boolean;
  /** Séquence animée plein écran (ex. « valise ») ; les options y sont présentées comme des objets à choisir. */
  cinematic?: string;
  narration?: Localized;
  /** Illustration de fond de la séquence animée (clé d'image du pack). */
  backdrop?: string;
  actor?: string;
  vo?: string;
  line?: Token[];
  gloss?: Localized;
  ask?: Localized;
  choices?: Choice[];
  options?: PickOption[];
  highlight?: string[];
  effect?: string;
  expression?: string;
  end?: boolean;
  /** Toutes les réponses sont acceptées (choix de nom, de pays, de quête). */
  free?: boolean;
  /** Objets donnés / repris à cette étape (ids de items.json). */
  give?: string[];
  take?: string[];
  /** Étape jouée seulement si les drapeaux correspondent (même syntaxe que les points d'interaction : quest, name, item:…). */
  when?: Record<string, string>;
}

/** Fin de chapitre : une image plein écran, le titre-carnet, le chapitre achevé, la suite annoncée. */
export interface Ending {
  image: string;
  /** Ligne calligraphiée sur l'image (un proverbe, la dernière phrase du chapitre). */
  line?: Token[];
  /** « Fin du chapitre 1 — Premier soir à Shanghai ». */
  title: Localized;
  /** « À suivre : Hangzhou ». */
  next?: Localized;
  /** Voix de la ligne (clip entier). */
  vo?: string;
}

export interface SceneEnd {
  flags?: Record<string, string>;
  give?: string[];
  goto?: { place: string; entrance?: string };
  /** Cartouche affiché au changement (ex. 第二天 / Le lendemain). */
  card?: Localized;
  /** Fait avancer une quête de fond (questStep[id] = step, index dans quests.json). */
  quest?: { id: string; step: number };
  /** Fin de chapitre (après les drapeaux et les objets). */
  ending?: Ending;
}

export interface Scene {
  id: string;
  language: string;
  world: string;
  tier: number;
  title: Localized;
  place: string;
  npc: string;
  patience: number;
  actors: Record<string, { name: string; label: Localized; portrait: string }>;
  objects: Record<string, { word: string; image: string; label?: Localized }>;
  steps: Step[];
  /**
   * Objet posé à l'écran pendant toute la scène (la carte de Léo sur le comptoir) : son image, le texte écrit dessus,
   * et une copie au propre qui apparaît à partir d'une étape (白老师 recopie la phrase).
   */
  prop?: { image: string; text?: string; sheet?: { text: string; from?: number } };
  onEnd?: SceneEnd;
  /** Patience à zéro : détour (mini-révision) puis retour à l'étape. */
  onExhausted?: { detour: string; refill: number };
  /** Caisse du service : objectif, ardoise des prix, ricanement du rival, paie de fin. */
  till?: {
    target: number;
    slate?: Token[][];
    mock?: Said & { actor: string };
    wage?: { base: number; min: number; flag?: string };
  };
}

export interface Detour {
  actor: string;
  go: { vo?: string; line: Token[]; gloss: Localized };
  back: { vo?: string; line: Token[]; gloss: Localized };
  ask: Localized;
  bowls: number;
}

export interface Item {
  id: string;
  word: string;
  image?: string;
  from?: Localized;
  usage?: { line: Token[]; gloss: Localized; vo?: string };
  reuse?: string[];
  unlocks?: string;
}

export interface QuestStep {
  know: Localized;
  seek: Localized;
  where: Localized;
}
export interface Quest {
  id: string;
  item: string;
  title: Localized;
  pitch: Localized;
  steps?: QuestStep[];
  /**
   * « errand » : une liste à cocher (courses, photos), en plus de la quête de fond. Une ligne est cochée quand son drapeau
   * vaut « fait », ou quand son sujet photo est dans l'album.
   */
  kind?: 'story' | 'errand';
  list?: { word: string; flag?: string; subject?: string; who?: Localized }[];
  /** Liste : titre écrit dans la langue cible (ex. 拍照), en plus du titre traduit. */
  head?: Token[];
  /** Liste : nombre de lignes à cocher pour qu'elle soit « pret » (par défaut toutes). */
  goal?: number;
  /** Liste : visible seulement si les drapeaux correspondent (en plus de l'objet dans le sac). */
  when?: Record<string, string>;
  /** Liste : reste affichée une fois rendue (« fait »), pour la finir. */
  stay?: boolean;
  /** Liste : sans pinyin ni traduction tant que la ligne n'est pas cochée (lire la liste est l'exercice). */
  readOnly?: boolean;
  /** Récompense d'une liste complète : une page d'album au sceau rouge. */
  reward?: { seal: Token[]; caption: Localized; toast?: Localized };
}

export interface Credit {
  author: string;
  license: string;
  url: string;
  title?: string;
}

export interface Hotspot {
  id: string;
  kind: 'npc' | 'object' | 'exit' | 'subject' | 'stall';
  /** Rayon d'interaction (px du lieu) ; par défaut celui du moteur. */
  radius?: number;
  /** Visible seulement si les drapeaux correspondent ('' = drapeau absent). */
  when?: Record<string, string>;
  /** Sujet photo : image réelle de l'album (clé d'asset) ; sinon le décor est recadré. */
  photo?: string;
  x: number;
  y: number;
  actor?: string;
  sprite?: string;
  scene?: string;
  /** Sujet photo : le mot à légender. Étal : le caractère affiché sur l'étiquette (↑ 茶). */
  word?: string;
  /** Sujet photo : mots proposés à côté du bon pour la légende (qui partagent un caractère ou un son). */
  decoys?: string[];
  to?: string;
  /** Entrée du lieu d'arrivée (sinon son spawn). */
  toEntrance?: string;
  /** Dessiné derrière les plans médians (ex. 奶奶 derrière le fourneau). */
  behind?: boolean;
  /** Échelle du sprite (1 par défaut). */
  scale?: number;
  /** Quand ce point est visible, il remplace celui-ci (même personnage, autre scène : 奶奶 qui se souvient de Léo…). */
  replaces?: string | string[];
  /** Figurant : visible seulement quand ce point-là est visible (les clients qui attendent le service de 奶奶). */
  with?: string;
  /** Où se place le joueur pour parler (décalage depuis ce point, px, signé) ; sinon à 300 px, du côté d'où il vient. */
  playerAt?: number;
  /** Côté vers lequel regarde le dessin du personnage : il est retourné pour faire face au joueur. */
  facing?: 'left' | 'right';
  prompt: Localized;
}

export interface Entrance {
  x: number;
  y: number;
  facing: 'left' | 'right';
  /** Le joueur entre en marchant de lui-même sur cette distance (px, signe = sens). */
  walkIn?: number;
}

export interface Place {
  /** Zoom caméra (1 = 1280×720 visibles ; 0.72 montre presque tout le lieu). */
  zoom?: number;
  id: string;
  name: Localized;
  world: string;
  size: { width: number; height: number };
  planes: { image: string; parallax: number; y: number; depth?: 'above' }[];
  walk: { yMin: number; yMax: number; xMin: number; xMax: number };
  spawn: Entrance;
  /** Taille du joueur dans ce lieu (1 = taille du pack ; une rue le rend plus petit qu'une cuisine). */
  playerScale?: number;
  /** Textes peints dans le décor (enseignes) : les caractères exacts, jamais dessinés par une IA. */
  signs?: { x: number; y: number; text: Localized; size?: number; color?: string }[];
  /** Points d'arrivée nommés (porte de la ruelle, escalator, portique…). */
  entrances?: Record<string, Entrance>;
  hotspots: Hotspot[];
  palette?: string[];
  /** Éléments de décor posés dans le lieu (étal, charrette…), visibles selon les drapeaux. */
  props?: { image: string; x: number; y: number; scale?: number; depth?: number; when?: Record<string, string> }[];
  /** Vie du lieu : passants et animaux qui traversent ou s'arrêtent, même pendant les dialogues. */
  ambient?: Ambient[];
  /** Scènes lancées à l'arrivée, si les drapeaux correspondent. */
  onEnter?: { scene: string; when?: Record<string, string>; effect?: string; delay?: number }[];
  /** Boucle d'ambiance du lieu (fichier audio), fondue à l'entrée et à la sortie. */
  ambience?: string;
  /** Variante de nuit (drapeau time = nuit). */
  night?: { tint: string; alpha: number; lights?: { x: number; y: number; r: number; color: string }[] };
}

export interface Ambient {
  image: string;
  /** walk : traverse le lieu ; rest : arrive, s'arrête un moment, repart ; hop : petits bonds sur place (oiseaux). */
  kind: 'walk' | 'rest' | 'hop';
  /** Ligne de sol (y) ou plage [min, max] ; plus haut = plus loin, donc derrière le joueur. */
  y: number | [number, number];
  /** Hauteur à l'écran en px du lieu (l'image est mise à l'échelle). */
  height: number;
  /** Vitesse en px/s. */
  speed?: number;
  /** Délai entre deux apparitions, en secondes [min, max]. */
  every?: [number, number];
  /** Image de repos (chat assis) pour kind « rest ». */
  restImage?: string;
  /** Dessiné vers la droite (défaut) ; il est retourné quand il va à gauche. */
  facing?: 'left' | 'right';
  when?: Record<string, string>;
  /** Sujet photo mobile (le chat) : identifiant du sujet, mot à légender, distracteurs, nom dans l'album. */
  subject?: string;
  word?: string;
  decoys?: string[];
  prompt?: Localized;
}

/**
 * Première photo guidée : tant que `when` correspond, dans le lieu `place`, un panneau d'aide montre les gestes
 * et le sujet `subject` scintille ; réussir sa photo lance la scène `scene`, puis ouvre le panneau Quête.
 */
export interface PhotoGuide {
  place: string;
  subject: string;
  when: Record<string, string>;
  scene: string;
  /** Scène après laquelle le joueur fait quelques pas vers le sujet (jusqu'à x = walkTo). */
  after?: string;
  walkTo?: number;
  /** Texte d'aide de chaque étape : sortir l'appareil, cadrer et déclencher, légender ({word} = le mot du sujet). */
  text: { out: Localized; frame: Localized; name: Localized };
}

export interface Pack {
  id: string;
  name: Localized;
  language: string;
  uiLanguages: string[];
  start: { place: string; entrance?: string };
  places: string[];
  scenes: string[];
  modifiers: Record<string, boolean>;
  assets: {
    images: Record<string, string>;
    voicePath: string;
    keyWhite?: string[];
    /** Sons d'interface remplaçant la synthèse : tap, good, bad, item, page, door → chemin du fichier. */
    sfx?: Partial<Record<'tap' | 'good' | 'bad' | 'item' | 'page' | 'door', string>>;
    /** Illustration du joueur : marionnette découpée (rig) ou image simple. */
    player?: PlayerArt;
    /** La joueuse (même gabarit). Absente : silhouette de secours. */
    playerF?: PlayerArt | null;
  };
  title?: { line: Token[]; fr: string; sub?: Localized; chapter?: Localized };
  profile?: {
    bodies: { id: 'm' | 'f'; label: Localized; front: string }[];
    names: { id: string; zh: string; pinyin: string; why: Localized }[];
    vars?: Record<string, Record<string, Token>>;
    startItems?: string[];
  };
  detours?: Record<string, Detour>;
  closedSign?: Token[];
  /** Ouverture d'une nouvelle partie : une image plein écran, le nom du lieu en grand, une phrase. */
  intro?: { image: string; word: string; text: Localized };
  photo?: { item: string; credits?: string; guide?: PhotoGuide };
  /** Monnaie : l'unité (块), les montants dits (nombre → mots), les pièces et billets, l'objet du sac qui la représente. */
  money?: { unit: Token; words: Record<string, Token[]>; coins: number[]; item?: string };
}

export interface Content {
  pack: Pack;
  language: Language;
  lexicon: Map<string, LexEntry>;
  places: Map<string, Place>;
  scenes: Map<string, Scene>;
  items: Map<string, Item>;
  quests: Map<string, Quest>;
  credits: Record<string, Credit>;
  ui: Localized;
  uiLang: string;
}

// Les fichiers de contenu sont embarqués au build par Vite (déploiement statique, zéro serveur).
// Un paquet d'école chargé à l'exécution passera par la même structure (fetch au lieu d'import).
const files = import.meta.glob('../../content/**/*.json', { eager: true, import: 'default' }) as Record<
  string,
  unknown
>;

function optional<T>(path: string): T | undefined {
  return files[`../../content/${path}`] as T | undefined;
}

function file<T>(path: string): T {
  const key = `../../content/${path}`;
  const data = files[key];
  if (!data) throw new Error(`Contenu manquant : ${path}`);
  return data as T;
}

export function loadContent(packId: string, uiLang = 'fr'): Content {
  const pack = file<Pack>(`packs/${packId}/pack.json`);
  const language = file<Language>(`languages/${pack.language}/language.json`);
  const lex = file<{ entries: LexEntry[] }>(`languages/${pack.language}/lexicon.json`);
  const lexicon = new Map(lex.entries.map((e) => [e.id, e]));
  const places = new Map(pack.places.map((id) => [id, file<Place>(`packs/${packId}/places/${id}.json`)]));
  const scenes = new Map(pack.scenes.map((id) => [id, file<Scene>(`packs/${packId}/scenes/${id}.json`)]));
  const ui = file<Localized>(`ui-strings/${uiLang}.json`);
  const items = new Map((optional<{ items: Item[] }>(`packs/${packId}/items.json`)?.items ?? []).map((i) => [i.id, i]));
  const quests = new Map((optional<{ quests: Quest[] }>(`packs/${packId}/quests.json`)?.quests ?? []).map((q) => [q.id, q]));
  const credits = optional<{ photos: Record<string, Credit> }>(`packs/${packId}/${pack.photo?.credits ?? 'credits.json'}`)?.photos ?? {};
  return { pack, language, lexicon, places, scenes, items, quests, credits, ui, uiLang };
}

/** Texte brut d'une ligne (pour la synthèse de repli et le journal). */
export function lineText(content: Content, line: Token[]): string {
  return line
    .map((t) => (t[0] === 'w' ? (content.lexicon.get(t[1])?.target ?? `{${t[1]}}`) : t[0] === 'v' ? '' : t[1]))
    .join('');
}

/** Identifiants des mots d'une ligne (pour le carnet et le SRS). */
export function lineWords(line: Token[]): string[] {
  return line.filter((t): t is ['w', string] => t[0] === 'w').map((t) => t[1]);
}

export const t = (content: Content, l: Localized | undefined, fallback = ''): string =>
  l?.[content.uiLang] ?? l?.fr ?? l?.en ?? fallback;

/**
 * URL d'un asset du pack. Un fichier HTML autonome (double-clic, sans serveur) peut
 * fournir les images incorporées dans `window.__inlineAssets[chemin]` : on les préfère.
 */
export function assetUrl(path: string): string {
  const inline = (window as unknown as { __inlineAssets?: Record<string, string> }).__inlineAssets;
  return inline?.[path] ?? `${import.meta.env.BASE_URL}assets/${path}`;
}
