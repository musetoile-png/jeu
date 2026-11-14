/**
 * Carnet de mots : pour chaque mot, l'ensemble des contextes (lignes) où il a été reconnu.
 * Un mot n'est « sûr » qu'à partir de N contextes différents (§12 : chaque caractère doit voyager).
 */
import { storageKey } from './client';

const KEY = storageKey('notebook');

interface Entry {
  contexts: string[];
  ok: number;
  ko: number;
  /** Dernière bonne / mauvaise réponse (horodatage) : une erreur plus récente qu'un succès rend le mot fragile. */
  lastOk?: number;
  lastKo?: number;
}

const data: Record<string, Entry> = load();

function load(): Record<string, Entry> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Entry>;
  } catch {
    return {};
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* stockage indisponible */
  }
}

/** Enregistre une rencontre ; renvoie « connu » si le contexte est nouveau mais le mot déjà vu ailleurs. */
export function meet(wordId: string, context: string): 'nouveau' | 'connu' {
  const e = (data[wordId] ??= { contexts: [], ok: 0, ko: 0 });
  const known = e.contexts.length > 0;
  if (!e.contexts.includes(context)) e.contexts.push(context);
  save();
  return known ? 'connu' : 'nouveau';
}

export function mark(wordId: string, ok: boolean) {
  const e = (data[wordId] ??= { contexts: [], ok: 0, ko: 0 });
  if (ok) {
    e.ok++;
    e.lastOk = Date.now();
  } else {
    e.ko++;
    e.lastKo = Date.now();
  }
  save();
}

/** Le mot a-t-il déjà été reconnu dans ce contexte précis ? */
export function hasContext(wordId: string, context: string) {
  return data[wordId]?.contexts.includes(context) ?? false;
}

/** Erreur plus récente que la dernière bonne réponse. */
export function recentError(wordId: string) {
  const e = data[wordId];
  return !!e?.lastKo && e.lastKo > (e.lastOk ?? 0);
}

export function contexts(wordId: string) {
  return data[wordId]?.contexts.length ?? 0;
}

/** 0 = jamais vu, 1 = fragile (encre pâle), 2 = en route, 3 = sûr (encre noire) */
export function strength(wordId: string, required = 3): 0 | 1 | 2 | 3 {
  const n = contexts(wordId);
  if (n === 0) return 0;
  if (n >= required) return 3;
  return n === 1 ? 1 : 2;
}

export function all() {
  return Object.keys(data);
}
