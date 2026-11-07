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

export interface Step {
  type: 'say' | 'choose' | 'pick' | 'cinematic';
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
}

export interface SceneEnd {
  flags?: Record<string, string>;
  give?: string[];
  goto?: { place: string; entrance?: string };
  /** Cartouche affiché au changement (ex. 第二天 / Le lendemain). */
  card?: Localized;
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
  onEnd?: SceneEnd;
  /** Patience à zéro : détour (mini-révision) puis retour à l'étape. */
  onExhausted?: { detour: string; refill: number };
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
  /** « errand » : une liste de courses (case cochée quand le drapeau vaut « fait »), en plus de la quête de fond. */
  kind?: 'story' | 'errand';
  list?: { word: string; flag: string; who?: Localized }[];
}

export interface Credit {
  author: string;
  license: string;
  url: string;
  title?: string;
}

export interface Hotspot {
  id: string;
  kind: 'npc' | 'object' | 'exit' | 'subject';
  /** Visible seulement si les drapeaux correspondent ('' = drapeau absent). */
  when?: Record<string, string>;
  /** Sujet photo : image réelle de l'album (clé d'asset) ; sinon le décor est recadré. */
  photo?: string;
  x: number;
  y: number;
  actor?: string;
  sprite?: string;
  scene?: string;
  word?: string;
  to?: string;
  /** Entrée du lieu d'arrivée (sinon son spawn). */
  toEntrance?: string;
  /** Dessiné derrière les plans médians (ex. 奶奶 derrière le fourneau). */
  behind?: boolean;
  /** Échelle du sprite (1 par défaut). */
  scale?: number;
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
  photo?: { item: string; credits?: string };
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
