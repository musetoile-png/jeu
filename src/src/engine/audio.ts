/**
 * Voix : clip pré-généré d'abord (ElevenLabs), synthèse du navigateur en repli.
 * Le ralenti utilise playbackRate avec conservation de la hauteur.
 */
import type { Content } from './content';
import { assetUrl } from './content';

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

function playClip(url: string, rate: number, onEnd: () => void) {
  const a = new Audio(url);
  current = a;
  try {
    (a as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
  } catch {
    /* non supporté */
  }
  a.playbackRate = rate;
  let done = false;
  const fin = () => {
    if (done) return;
    done = true;
    if (current === a) current = null;
    onEnd();
  };
  a.onended = fin;
  a.onerror = fin;
  a.play().catch(fin);
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
    // On tente le clip ; en cas d'absence (404) l'élément déclenche onerror → repli sur la synthèse.
    const a = new Audio(file);
    a.oncanplaythrough = () => playClip(file, rate, onEnd);
    a.onerror = () => synth(text, content.language.bcp47, rate, onEnd);
    a.load();
    return;
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
