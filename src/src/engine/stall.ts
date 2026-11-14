/**
 * Étal libre : préparation d'une partie et explication des erreurs.
 * Rien ici n'affiche ni ne joue de son (c'est le lecteur de scènes qui le fait) ; aucun mot de la langue
 * cible : tout vient du contenu (articles, distracteurs, répliques) et des chaînes d'interface.
 */
import type { Content, Item, Localized, Stall, StallGood, StallMode, Token } from './content';
import { t } from './content';
import * as notebook from './notebook';

export interface StallRound {
  good: StallGood;
  mode: StallMode;
  /** Articles posés sur l'étal pendant cette manche (le bon compris), dans l'ordre d'affichage. */
  board: StallGood[];
  /** Mots proposés (modes « dire » et « acheter ») : le bon et deux voisins, mélangés. */
  words: string[];
  /** Le mot n'avait encore jamais été reconnu au début de la partie. */
  fresh: boolean;
}

export const shuffle = <T>(a: T[]): T[] => {
  const b = [...a];
  for (let k = b.length - 1; k > 0; k--) {
    const j = Math.floor(Math.random() * (k + 1));
    [b[k], b[j]] = [b[j], b[k]];
  }
  return b;
};

/** Objet du sac correspondant à l'article (déclaré, ou même mot). */
export function itemFor(content: Content, g: StallGood): Item | undefined {
  if (g.item) return content.items.get(g.item);
  return [...content.items.values()].find((it) => it.word === g.word);
}

/** Clé d'image de l'article, si une image est réellement chargée ; sinon l'article sera une étiquette peinte. */
export function imageOf(content: Content, g: StallGood, loaded: (key: string) => boolean): string | undefined {
  const keys = [g.image, `obj_${g.word}`, itemFor(content, g)?.image];
  return keys.find((k): k is string => !!k && loaded(k));
}

/** Poids d'un mot dans le tirage : un mot jamais vu, peu vu ou raté récemment revient plus souvent. */
function weight(word: string, required: number) {
  const n = notebook.contexts(word);
  if (n === 0) return 8;
  let w = 1 + 2 * Math.max(0, required - n);
  if (notebook.recentError(word)) w += 6;
  return w;
}

function draw<T>(pool: T[], w: (x: T) => number): T {
  const total = pool.reduce((s, x) => s + w(x), 0);
  let r = Math.random() * total;
  for (const x of pool) {
    r -= w(x);
    if (r <= 0) return x;
  }
  return pool[pool.length - 1];
}

const sharesChar = (content: Content, a: string, b: string) => {
  const ta = content.lexicon.get(a)?.target ?? '';
  const tb = content.lexicon.get(b)?.target ?? '';
  return [...ta].some((c) => tb.includes(c));
};

/**
 * Prépare une partie : `rounds` manches, au moins un mot nouveau tant qu'il en reste, les mots fragiles d'abord,
 * des modes mélangés (« lire » seulement pour un article dessiné, et s'il y en a assez d'autres dessinés),
 * « acheter » une seule fois, en dernier.
 */
export function planStall(content: Content, st: Stall, drawn: (g: StallGood) => boolean, newPurchase: (word: string) => boolean = () => true): StallRound[] {
  const required = content.language.mastery?.contextsRequired ?? 3;
  const goods = st.goods.filter((g) => !g.soon && content.lexicon.has(g.word));
  const count = st.rounds ?? 6;
  const show = Math.max(3, st.show ?? 6);
  const modes = st.modes ?? ['listen', 'read', 'say'];
  const play = modes.filter((m) => m !== 'buy');
  if (!goods.length || !play.length) return [];

  // 1. les mots : un nouveau d'abord (s'il en reste), puis tirage pondéré sans remise (avec remise si l'étal est petit)
  const fresh = goods.filter((g) => notebook.contexts(g.word) === 0);
  const picks: StallGood[] = [];
  if (fresh.length) picks.push(fresh[Math.floor(Math.random() * fresh.length)]);
  // ce premier mot nouveau se découvre à l'oreille ; les autres mots nouveaux peuvent se deviner autrement (花茶 = 花 + 茶)
  const heard = picks[0] as StallGood | undefined;
  let pool = goods.filter((g) => !picks.includes(g));
  while (picks.length < count) {
    if (!pool.length) pool = goods.filter((g) => g !== picks[picks.length - 1]);
    if (!pool.length) pool = [...goods];
    const g = draw(pool, (x) => weight(x.word, required));
    picks.push(g);
    pool = pool.filter((x) => x !== g);
  }
  // l'ordre est mélangé ; l'achat (dernière manche) porte de préférence sur un mot déjà rencontré,
  // et jamais encore acheté ici (« 我要… » serait sinon un contexte déjà noté)
  let order = shuffle(picks);
  const buy = modes.includes('buy');
  if (buy) {
    const score = (g: StallGood) => (notebook.contexts(g.word) > 0 ? 2 : 0) + (newPurchase(g.word) ? 1 : 0);
    const best = order.reduce((b, g, i) => (score(g) > score(order[b]) ? i : b), 0);
    order = [...order.slice(0, best), ...order.slice(best + 1), order[best]];
  }

  // 2. les modes
  const drawnGoods = goods.filter(drawn);
  const used: Record<string, number> = {};
  const rounds: StallRound[] = [];
  order.forEach((good, k) => {
    const isFresh = notebook.contexts(good.word) === 0;
    let mode: StallMode;
    if (buy && k === order.length - 1) mode = 'buy';
    else {
      const ok = play.filter((m) => m !== 'read' || (drawn(good) && drawnGoods.length >= 3));
      const prev = rounds[rounds.length - 1]?.mode;
      if (good === heard && !rounds.some((r) => r.good === heard) && ok.includes('listen')) mode = 'listen';
      else
        mode = shuffle(ok)
          .map((m) => ({ m, s: (used[m] ?? 0) + (m === prev ? 0.5 : 0) }))
          .sort((a, b) => a.s - b.s)[0]?.m ?? 'listen';
    }
    used[mode] = (used[mode] ?? 0) + 1;
    rounds.push({ good, mode, board: board(content, goods, good, mode, drawn, show), words: wordsFor(content, goods, good), fresh: isFresh });
  });
  return rounds;
}

/** L'étal d'une manche : le bon article, ses voisins de caractères s'ils sont vendus ici, puis d'autres. */
function board(content: Content, goods: StallGood[], good: StallGood, mode: StallMode, drawn: (g: StallGood) => boolean, show: number) {
  // en lecture, uniquement des articles dessinés : une étiquette se lirait d'elle-même
  const cands = goods.filter((g) => g !== good && (mode !== 'read' || drawn(g)));
  const near = cands.filter((g) => good.foils?.includes(g.word) || sharesChar(content, g.word, good.word));
  // un mot nouveau se devine mieux entouré de mots connus
  const isNew = (g: StallGood) => (notebook.contexts(good.word) === 0 && notebook.contexts(g.word) === 0 ? 1 : 0);
  const rest = shuffle(cands.filter((g) => !near.includes(g))).sort((a, b) => isNew(a) - isNew(b));
  return shuffle([good, ...[...shuffle(near), ...rest].slice(0, show - 1)]);
}

/** Le bon mot et deux voisins : d'abord les distracteurs déclarés, puis les articles qui partagent un caractère. */
function wordsFor(content: Content, goods: StallGood[], good: StallGood) {
  const out = (good.foils ?? []).filter((w) => w !== good.word && content.lexicon.has(w));
  const more = shuffle(goods.map((g) => g.word).filter((w) => w !== good.word && !out.includes(w)));
  more.sort((a, b) => Number(sharesChar(content, b, good.word)) - Number(sharesChar(content, a, good.word)));
  return shuffle([good.word, ...[...out, ...more].slice(0, 2)]);
}

/** Remplace la place de l'article par un jeton. */
export function fillSlot(line: Token[], tok: Token): Token[] {
  return line.map((x) => (x[0] === 'v' && x[1] === 'WORD' ? tok : x));
}

export const fmt = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);

/** Transcription sans tons, sans espaces (pour comparer les sons). */
const bare = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

/** Découpe grossière d'une transcription sans tons en syllabes (dēnglong → deng, long). */
const SYLLABLE = /(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?(iang|iong|uang|ang|eng|ing|ong|uai|iao|ian|uan|ai|ei|ao|ou|an|en|in|un|ia|ie|iu|ua|uo|ui|ue|er|a|o|e|i|u|v)(?![aeiouv])/g;
const syllables = (s: string): string[] => bare(s.replace(/ü/g, 'v')).match(SYLLABLE) ?? [];

/** Une syllabe commune aux deux transcriptions (sans les tons), ou ''. */
function sharedSyllable(a: string, b: string, system?: string) {
  // la découpe ci-dessous ne vaut que pour le pinyin ; ailleurs, on compare les mots de la transcription
  if (system !== 'pinyin') {
    const wb = b.toLowerCase().split(/[\s-]+/);
    return a.toLowerCase().split(/[\s-]+/).find((x) => x && wb.includes(x)) ?? '';
  }
  const sb = syllables(b);
  return syllables(a).find((x) => sb.includes(x)) ?? '';
}

function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/**
 * Explication courte d'une confusion entre le mot attendu et le mot choisi, qui nomme ce qui a trompé :
 * un caractère partagé, le ton, un son proche, ou simplement le sens. Puis le bon mot, sa transcription, sa traduction.
 */
export function explain(content: Content, expected: string, chosen: string): { why: string; errorType: string } {
  const ui = content.ui;
  const a = content.lexicon.get(expected);
  const b = content.lexicon.get(chosen);
  const ga = t(content, a?.gloss);
  const right = fmt(ui.stallRight ?? '{a} {pa} : {ga}.', { a: a?.target ?? expected, pa: a?.transcription ?? '', ga });
  if (!a || !b) return { why: right, errorType: 'semantic' };
  const charOf = (c: string) => {
    const e = [...content.lexicon.values()].find((x) => x.target === c);
    return e?.transcription ? `${c} ${e.transcription.toLowerCase()}` : c;
  };
  const shared = [...new Set([...a.target].filter((c) => b.target.includes(c)))];
  const vars: Record<string, string> = { a: a.target, b: b.target, pa: a.transcription ?? '', pb: b.transcription ?? '', ga, gb: t(content, b.gloss) };
  let why: string;
  let errorType: string;
  if (shared.length) {
    errorType = 'character';
    // même longueur et caractère commun à la même place (红茶 / 花茶, 牛奶 / 奶奶) : on compare place par place
    const A = [...a.target];
    const B = [...b.target];
    const aligned = A.length === B.length && A.some((c, i) => c === B[i]);
    const da = aligned ? A.filter((c, i) => c !== B[i]) : A.filter((c) => !shared.includes(c));
    const db = aligned ? B.filter((c, i) => c !== A[i]) : B.filter((c) => !shared.includes(c));
    const key = da.length && db.length ? 'stallShared' : 'stallSharedAlone';
    why = fmt(ui[key] ?? '{a} / {b} : {c}.', { ...vars, c: shared.join(''), da: da.map(charOf).join(' '), db: db.map(charOf).join(' '), more: [...da, ...db].map(charOf).join(' ') });
  } else if (bare(vars.pa) === bare(vars.pb)) {
    errorType = 'tone';
    why = fmt(ui.stallTone ?? '{a} {pa} / {b} {pb}.', vars);
  } else if (distance(bare(vars.pa), bare(vars.pb)) <= Math.max(1, Math.floor(Math.max(bare(vars.pa).length, bare(vars.pb).length) / 3))) {
    errorType = 'phonetic';
    why = fmt(ui.stallSound ?? '{a} {pa} / {b} {pb}.', vars);
  } else if (sharedSyllable(vars.pa, vars.pb, content.language.transcription) && ui.stallSyllable) {
    // 灯笼 dēnglong / 龙井 lóngjǐng : pas de caractère commun, mais un même son (long)
    errorType = 'phonetic';
    why = fmt(ui.stallSyllable, { ...vars, s: sharedSyllable(vars.pa, vars.pb, content.language.transcription) });
  } else {
    errorType = 'semantic';
    return { why: fmt(ui.stallMeaning ?? '{a} : {ga} ; {b} : {gb}.', vars), errorType };
  }
  return { why: `${why} ${right}`, errorType };
}

/** Glose d'une réplique d'étal, avec la traduction de l'article (ou des points de suspension s'il est caché). */
export function glossOf(content: Content, gloss: Localized, word: string | null) {
  const g = word ? t(content, content.lexicon.get(word)?.gloss) : '…';
  return fmt(t(content, gloss), { word: g });
}

/** Clé du clip d'une réplique d'étal avec son article : `cst_02` → `cst_02_huacha`, `st_woyao_{body}` → `st_woyao_huacha_{body}`. */
export function stallVoKey(vo: string, word: string): string {
  return vo.includes('{body}') ? vo.replace('{body}', `${word}_{body}`) : `${vo}_${word}`;
}
