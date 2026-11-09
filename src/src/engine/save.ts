/**
 * Sauvegarde de la partie : profil du joueur, drapeaux d'histoire, sac, quête, album.
 * Tout tient dans le navigateur (localStorage) ; le carnet de mots et le journal ont leurs propres clés.
 */
import type { Content, Token } from './content';

export interface Photo {
  subject: string;
  place: string;
  word: string;
  /** Rectangle cadré, en coordonnées du lieu : l'album redessine le décor (aucune image stockée). */
  rect: { x: number; y: number; w: number; h: number };
  t: number;
  /** Sujet mobile (le chat) : son image et sa place au moment de la photo, posées sur le décor recadré. */
  extra?: { image: string; x: number; y: number; h: number; flip?: boolean };
}

/** Le sujet est-il déjà dans l'album ? */
export const hasPhoto = (subject: string) => get().album.some((p) => p.subject === subject);

export interface SaveData {
  profile: { body: 'm' | 'f'; name?: string; country?: string };
  flags: Record<string, string>;
  items: string[];
  quest?: string;
  questStep: Record<string, number>;
  album: Photo[];
  place?: string;
}

const KEY = 'jeu-zh-save';
let data: SaveData | null = load();

function load(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SaveData) : null;
  } catch {
    return null;
  }
}

function persist() {
  try {
    if (data) localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* navigation privée : la partie dure le temps de l'onglet */
  }
}

export const exists = () => data !== null;

export function get(): SaveData {
  data ??= { profile: { body: 'm' }, flags: {}, items: [], questStep: {}, album: [] };
  return data;
}

export function newGame(body: 'm' | 'f', startItems: string[]) {
  data = { profile: { body }, flags: { time: 'nuit' }, items: [...startItems], questStep: {}, album: [] };
  persist();
}

export function flag(k: string) {
  return get().flags[k] ?? '';
}

/**
 * Vrai si toutes les conditions sont remplies.
 * `clé: "valeur"` : le drapeau vaut exactement cela ('' = absent) ;
 * `clé: "!valeur"` : le drapeau vaut autre chose ;
 * `"item:id": "1"` / `""` : l'objet est dans le sac / n'y est pas ;
 * `"quest": "lettre"` : la quête de fond choisie dans la valise (rangée dans le profil, pas dans les drapeaux) ;
 * `"name": "an"` : le nom chinois choisi le premier soir (profil).
 */
export function matches(when?: Record<string, string>) {
  if (!when) return true;
  return Object.entries(when).every(([k, v]) => {
    const cur = k.startsWith('item:') ? (hasItem(k.slice(5)) ? '1' : '') : k === 'quest' ? (get().quest ?? '') : k === 'name' ? (get().profile.name ?? '') : flag(k);
    return v.startsWith('!') ? cur !== v.slice(1) : cur === v;
  });
}

/** Applique un réglage de choix : name / country / quest vont au profil, le reste en drapeaux. */
export function set(values: Record<string, string>) {
  const d = get();
  for (const [k, v] of Object.entries(values)) {
    if (k === 'name') d.profile.name = v;
    else if (k === 'country') d.profile.country = v;
    else if (k === 'quest') {
      d.quest = v;
      d.questStep[v] ??= 0;
    } else d.flags[k] = v;
  }
  persist();
}

export function setFlags(values: Record<string, string>) {
  Object.assign(get().flags, values);
  persist();
}

/** Fait avancer une quête de fond à l'étape donnée (jamais en arrière : rejouer une scène ne fait pas reculer). */
export function setQuestStep(id: string, step: number) {
  const d = get();
  d.questStep ??= {};
  if ((d.questStep[id] ?? 0) >= step) return false;
  d.questStep[id] = step;
  persist();
  return true;
}

export const hasItem = (id: string) => get().items.includes(id);

export function addItem(id: string) {
  if (!hasItem(id)) get().items.push(id);
  persist();
}

export function removeItem(id: string) {
  const d = get();
  d.items = d.items.filter((i) => i !== id);
  persist();
}

export function addPhoto(p: Photo) {
  const d = get();
  d.album = d.album.filter((x) => x.subject !== p.subject);
  d.album.push(p);
  persist();
}

export function setPlace(id: string) {
  get().place = id;
  persist();
}

/** Remplace les variables de profil dans une ligne (NAME, TA…). */
export function resolveLine(content: Content, line: Token[]): Token[] {
  const d = get();
  return line.map((tok): Token => {
    if (tok[0] !== 'v') return tok;
    if (tok[1] === 'NAME') {
      const n = content.pack.profile?.names.find((x) => x.id === d.profile.name);
      return n ? ['t', n.zh, n.pinyin, ''] : ['p', ''];
    }
    return content.pack.profile?.vars?.[tok[1]]?.[d.profile.body] ?? ['p', ''];
  });
}

/** Remplace {body}, {name}, {country} dans une clé de voix ou un texte. */
export function fill(text: string, content?: Content) {
  const d = get();
  const name = content?.pack.profile?.names.find((x) => x.id === d.profile.name);
  return text
    .replaceAll('{body}', d.profile.body)
    .replaceAll('{name}', d.profile.name ?? '')
    .replaceAll('{country}', d.profile.country ?? '')
    .replaceAll('{NAME}', name ? name.zh : '');
}
