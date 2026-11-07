/**
 * Voix : clip pré-généré d'abord (ElevenLabs), synthèse du navigateur en repli.
 * Le ralenti utilise playbackRate avec conservation de la hauteur.
 */
import type { Content } from './content';
import { assetUrl } from './content';
import { duck } from './sfx';

export const RATE = { SLOW: 0.75, NORMAL: 1.0, WORD: 0.85 } as const;

let current: HTMLAudioElement | null = null;
let voice: SpeechSynthesisVoice | null = null;

export function initVoices(bcp47: string) {
  if (!('speechSynthesis' in window)) return;
  const pick = () => {
    const vs = speechSynthesis.getVoices();
    const lang = bcp47.toLowerCase();
    voice = vs.find((v) => v.lang.toLowerCase().replace('_', '-') === lang) ?? vs.find((v) => v.lang.toLowerCase().startsWith(lang.split('-')[0])) ?? null;
  };
  speechSynthesis.onvoiceschanged = pick;
  pick();
}

export function stop() {
  if (current) {
    current.pause();
    current = null;
  }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

/**
 * Clips déjà demandés : un seul élément audio par fichier, réutilisé.
 * (Avant, chaque réplique téléchargeait le fichier, attendait, puis le rechargeait pour le jouer : d'où un petit blanc.)
 */
const clips = new Map<string, HTMLAudioElement | 'missing'>();

function clip(url: string) {
  let a = clips.get(url);
  if (!a) {
    const el = new Audio();
    el.preload = 'auto';
    el.onerror = () => clips.set(url, 'missing');
    el.src = url;
    el.load();
    clips.set(url, el);
    a = el;
  }
  return a;
}

/** Charge à l'avance les voix d'une scène, pour qu'aucune réplique n'attende le réseau. */
export function preloadVoices(content: Content, vos: (string | undefined)[]) {
  for (const vo of vos) if (vo && !vo.includes('{')) clip(assetUrl(`${content.pack.assets.voicePath}${vo}.mp3`));
}

let turn = 0;

function playClip(a: HTMLAudioElement, rate: number, onEnd: () => void, onFail: () => void) {
  const mine = ++turn;
  current = a;
  try {
    (a as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
  } catch {
    /* non supporté */
  }
  a.pause();
  a.currentTime = 0;
  a.playbackRate = rate;
  let done = false;
  const fin = () => {
    if (done) return;
    done = true;
    // une lecture plus récente a pu reprendre le même élément : on n'y touche pas
    if (turn === mine) {
      a.onended = null;
      if (current === a) current = null;
      duck(false);
    }
    onEnd();
  };
  a.onended = fin;
  duck(true);
  a.play().catch((e: unknown) => {
    if (done) return;
    // interrompue par stop() ou par une autre réplique : rien à faire
    if (e instanceof DOMException && e.name === 'AbortError') return;
    done = true;
    if (turn === mine) {
      if (current === a) current = null;
      duck(false);
    }
    if (a.error) onFail();
    else onEnd();
  });
  setTimeout(fin, 8000 / rate);
}

function synth(text: string, bcp47: string, rate: number, onEnd: () => void) {
  if (!('speechSynthesis' in window)) return onEnd();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = bcp47;
  if (voice) u.voice = voice;
  u.rate = rate * 0.9;
  let done = false;
  const fin = () => {
    if (done) return;
    done = true;
    onEnd();
  };
  u.onend = fin;
  u.onerror = fin;
  speechSynthesis.speak(u);
  setTimeout(fin, 1200 + (text.length * 450) / rate);
}

/** Joue une réplique : par clé de fichier si fournie, sinon par synthèse du texte. */
export function speak(content: Content, text: string, vo: string | undefined, rate: number, onEnd: () => void = () => {}) {
  stop();
  const file = vo ? assetUrl(`${content.pack.assets.voicePath}${vo}.mp3`) : null;
  if (file) {
    // Clip pré-généré s'il existe ; s'il manque (404), synthèse du navigateur.
    const a = clip(file);
    if (a !== 'missing') {
      playClip(a, rate, onEnd, () => {
        clips.set(file, 'missing');
        synth(text, content.language.bcp47, rate, onEnd);
      });
      return;
    }
  }
  synth(text, content.language.bcp47, rate, onEnd);
}

/** Mot à mot : enchaîne les clips de chaque mot (fichier `w_<id>` s'il existe). */
export function speakWords(content: Content, ids: string[]) {
  stop();
  let i = 0;
  const next = () => {
    if (i >= ids.length) return;
    const id = ids[i++];
    const entry = content.lexicon.get(id);
    if (!entry) return next();
    speak(content, entry.target, `w_${id}`, RATE.WORD, () => setTimeout(next, 120));
  };
  next();
}
