/**
 * Sons d'interface et ambiances de lieu.
 *
 * Par défaut, chaque son est synthétisé (Web Audio) : rien à télécharger, discret, dans une gamme pentatonique.
 * Pour le remplacer par un vrai son, il suffit de déclarer un fichier dans pack.json → assets.sfx
 * (ex. "good": "audio/sfx/good.mp3") : le fichier est alors joué à la place de la synthèse.
 * Les ambiances (place.json → ambience) sont des boucles qui se fondent d'un lieu à l'autre.
 *
 * Règle : aucun son ne doit couvrir une voix chinoise. Les sons sont courts, aigus ou feutrés, et la voix reste devant.
 */
import { assetUrl } from './content';

export type Cue = 'tap' | 'good' | 'bad' | 'item' | 'page' | 'door';

const STORE_KEY = 'jeu-sfx';
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let files: Partial<Record<Cue, string>> = {};
const buffers = new Map<string, AudioBuffer | null>();
let muted = (() => {
  try {
    return localStorage.getItem(STORE_KEY) === 'off';
  } catch {
    return false;
  }
})();

function audio(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Fichiers déclarés par le contenu ; ils sont chargés tout de suite pour être prêts au premier clic. */
export function initSfx(map: Partial<Record<Cue, string>> | undefined) {
  files = map ?? {};
  for (const path of Object.values(files)) if (path) void loadBuffer(path);
}

async function loadBuffer(path: string) {
  if (buffers.has(path)) return buffers.get(path) ?? null;
  buffers.set(path, null);
  try {
    const c = audio();
    if (!c) return null;
    const res = await fetch(assetUrl(path));
    if (!res.ok) return null;
    const buf = await c.decodeAudioData(await res.arrayBuffer());
    buffers.set(path, buf);
    return buf;
  } catch {
    return null;
  }
}

export function isMuted() {
  return muted;
}

export function setMuted(on: boolean) {
  muted = on;
  try {
    localStorage.setItem(STORE_KEY, on ? 'off' : 'on');
  } catch {
    /* navigation privée */
  }
  if (ambienceEl) ambienceEl.volume = on ? 0 : AMBIENCE_VOL;
}

// ---------- Synthèse ----------

/** Corde pincée (façon guzheng très simplifié) : attaque nette, extinction exponentielle. */
function pluck(c: AudioContext, freq: number, at: number, vol: number, len = 0.9) {
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(freq * 6, at);
  lp.frequency.exponentialRampToValueAtTime(freq * 1.5, at + len * 0.6);
  for (const [mult, type, v] of [
    [1, 'triangle', 1],
    [2, 'sine', 0.35],
    [3.01, 'sine', 0.12],
  ] as const) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = freq * mult;
    const og = c.createGain();
    og.gain.value = v;
    o.connect(og).connect(lp);
    o.start(at);
    o.stop(at + len + 0.05);
  }
  lp.connect(g).connect(master!);
}

/** Bruit filtré : papier, souffle de porte. */
function noise(c: AudioContext, at: number, dur: number, vol: number, f0: number, f1: number, q = 0.8) {
  const n = Math.ceil(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = q;
  bp.frequency.setValueAtTime(f0, at);
  bp.frequency.exponentialRampToValueAtTime(f1, at + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(bp).connect(g).connect(master!);
  src.start(at);
}

/** Bloc de bois feutré (erreur) : grave, bref, jamais punitif. */
function knock(c: AudioContext, at: number, vol: number) {
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(240, at);
  o.frequency.exponentialRampToValueAtTime(150, at + 0.12);
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
  o.connect(g).connect(master!);
  o.start(at);
  o.stop(at + 0.2);
  noise(c, at, 0.04, vol * 0.4, 900, 600, 2);
}

// Pentatonique sur ré : 宫 ré, 商 mi, 角 fa#, 徵 la, 羽 si
const D5 = 587.33;
const E5 = 659.25;
const FS5 = 739.99;
const A5 = 880;
const B5 = 987.77;

const SYNTH: Record<Cue, (c: AudioContext, t: number) => void> = {
  tap: (c, t) => {
    // petit clic de bois clair
    const o = c.createOscillator();
    o.frequency.setValueAtTime(1800, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.03);
    const g = c.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(master!);
    o.start(t);
    o.stop(t + 0.06);
  },
  good: (c, t) => {
    pluck(c, A5, t, 0.11, 0.7);
    pluck(c, D5 * 2, t + 0.09, 0.09, 1.1);
  },
  bad: (c, t) => knock(c, t, 0.14),
  item: (c, t) => [D5, FS5, A5, B5].forEach((f, i) => pluck(c, f, t + i * 0.07, 0.07, 0.8)),
  page: (c, t) => noise(c, t, 0.2, 0.05, 2200, 5200, 0.6),
  door: (c, t) => {
    noise(c, t, 0.9, 0.05, 300, 1600, 0.5);
    pluck(c, E5 / 2, t + 0.55, 0.05, 1.4);
  },
};

/** Joue un son d'interface (fichier déclaré, sinon synthèse). */
export function play(cue: Cue) {
  if (muted) return;
  const c = audio();
  if (!c || !master) return;
  const path = files[cue];
  const buf = path ? buffers.get(path) : undefined;
  if (buf) {
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(master);
    src.start();
    return;
  }
  SYNTH[cue](c, c.currentTime + 0.005);
}

// ---------- Ambiance de lieu ----------

const AMBIENCE_VOL = 0.35;
let ambienceEl: HTMLAudioElement | null = null;
let ambiencePath: string | null = null;

function fade(a: HTMLAudioElement, to: number, ms: number, done?: () => void) {
  const from = a.volume;
  const t0 = performance.now();
  const tick = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    a.volume = from + (to - from) * k;
    if (k < 1) requestAnimationFrame(tick);
    else done?.();
  };
  requestAnimationFrame(tick);
}

/** Change d'ambiance en fondu ; sans fichier, le lieu reste silencieux (l'ancienne boucle s'éteint). */
export function ambience(path: string | undefined) {
  if ((path ?? null) === ambiencePath) return;
  ambiencePath = path ?? null;
  const old = ambienceEl;
  ambienceEl = null;
  if (old) fade(old, 0, 1200, () => old.pause());
  if (!path) return;
  const a = new Audio(assetUrl(path));
  a.loop = true;
  a.volume = 0;
  a.onerror = () => {
    if (ambienceEl === a) ambienceEl = null;
  };
  ambienceEl = a;
  a.play()
    .then(() => fade(a, muted ? 0 : AMBIENCE_VOL, 1800))
    .catch(() => undefined);
}

/** Pendant une réplique, l'ambiance se fait plus discrète. */
export function duck(on: boolean) {
  if (!ambienceEl || muted) return;
  fade(ambienceEl, on ? AMBIENCE_VOL * 0.35 : AMBIENCE_VOL, on ? 250 : 700);
}
