import Phaser from 'phaser';

import type { Content } from './engine/content';
import { count } from './engine/log';
import { buildReport } from './engine/report';
import * as notebook from './engine/notebook';
import * as sfx from './engine/sfx';
import * as scenes from './scenes';

// La calligraphie des enseignes est dessinée dans le canvas : on attend la police (2 s max).
await Promise.race([document.fonts.load('48px "Ma Shan Zheng"'), new Promise((r) => setTimeout(r, 2000))]).catch(() => undefined);

const game = new Phaser.Game({
  parent: 'game',
  width: 1280,
  height: 720,
  title: 'Mille li',
  version: import.meta.env.VITE_APP_VERSION,
  scene: [scenes.World],
  disableContextMenu: import.meta.env.PROD,
  backgroundColor: '#efe9dc',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  pixelArt: false,
  antialias: true,
});

(window as unknown as { __game: Phaser.Game }).__game = game; // aide au test

// Mise en page : en portrait, les panneaux se posent sous l'image et ne doivent jamais la couvrir ; ils savent où elle finit.
const stageEl = document.getElementById('stage');
if (stageEl) {
  const syncStage = () => {
    const bottom = Math.round(stageEl.getBoundingClientRect().bottom);
    const root = document.documentElement.style;
    root.setProperty('--stage-bottom', `${String(bottom)}px`);
  };
  new ResizeObserver(syncStage).observe(stageEl);
  window.addEventListener('resize', syncStage);
  window.visualViewport?.addEventListener('resize', syncStage);
  syncStage();
}

// ---- Interface HTML autour du canvas : carnet de mots, journal ----
let lastCount = -1;

/**
 * Titre-carnet dans l'en-tête : chaque caractère du titre (千, 里) prend l'encre du carnet, comme sur l'écran titre :
 * pâle tant qu'on ne l'a pas rencontré, de plus en plus foncé à chaque nouveau contexte.
 */
function inkHeaderTitle(content: Content) {
  const h = document.querySelector<HTMLElement>('header h1 .zh');
  const line = content.pack.title?.line;
  if (!h || !line) return;
  const required = content.language.mastery?.contextsRequired ?? 3;
  h.replaceChildren(
    ...line.map((tok) => {
      const s = document.createElement('span');
      const b = document.createElement('b');
      if (tok[0] === 'w') {
        const e = content.lexicon.get(tok[1]);
        s.className = `ink-${String(notebook.strength(tok[1], required))}`;
        b.textContent = e?.target ?? '';
        s.title = `${e?.transcription ?? ''} · ${e?.gloss.fr ?? ''} · ${String(notebook.contexts(tok[1]))}/${String(required)}`;
      } else b.textContent = tok[0] === 'v' ? '' : tok[1];
      s.append(b);
      return s;
    }),
  );
}
function renderNotebook(content: Content) {
  const v = document.getElementById('vocab') as HTMLElement;
  const wc = document.getElementById('wc') as HTMLElement;
  const ids = notebook.all();
  wc.textContent = String(ids.length);
  // un nouveau mot dans le carnet : le compteur frémit (aucun son : la voix chinoise reste seule)
  if (lastCount >= 0 && ids.length > lastCount) {
    const pill = wc.closest('.pill');
    pill?.classList.remove('bump');
    void (pill as HTMLElement | null)?.offsetWidth;
    pill?.classList.add('bump');
  }
  lastCount = ids.length;
  inkHeaderTitle(content);
  v.innerHTML = '';
  const required = content.language.mastery?.contextsRequired ?? 3;
  for (const id of ids) {
    const e = content.lexicon.get(id);
    if (!e) continue;
    const s = document.createElement('span');
    s.className = `w ink-${notebook.strength(id, required)}`;
    s.innerHTML = `<b></b><i></i><small></small>`;
    (s.querySelector('b') as HTMLElement).textContent = e.target;
    (s.querySelector('i') as HTMLElement).textContent = e.transcription ?? '';
    (s.querySelector('small') as HTMLElement).textContent = `${e.gloss.fr ?? ''} · ${notebook.contexts(id)}/${required}`;
    v.appendChild(s);
  }
}

game.events.once('ready', () => {
  const world = game.scene.getScene('world');
  world.events.once('content-ready', (content: Content) => {
    const ui = content.ui;
    (document.getElementById('nb-title') as HTMLElement).textContent = ui.notebook;
    (document.getElementById('wc-label') as HTMLElement).textContent = ui.wordsMet;
    const exp = document.getElementById('export') as HTMLButtonElement;
    exp.textContent = `${ui.exportLog} · ${count()}`;
    // bilan pour l'enseignante : une page HTML lisible hors ligne, avec le journal brut (CSV) à l'intérieur
    exp.onclick = () => {
      let player = '';
      try {
        player = localStorage.getItem('jeu-zh-player') ?? '';
      } catch {
        /* stockage indisponible */
      }
      const typed = window.prompt(ui.exportWho ?? 'Ton prénom ou ton code de joueur :', player);
      if (typed === null) return;
      player = typed.trim() || 'anonyme';
      try {
        localStorage.setItem('jeu-zh-player', player);
      } catch {
        /* stockage indisponible */
      }
      const safe = player.replace(/[^\p{L}\p{N}_-]+/gu, '-');
      const blob = new Blob([buildReport(content, player)], { type: 'text/html;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `bilan-mille-li-${safe}-${new Date().toISOString().slice(0, 10)}.html`;
      a.click();
    };
    renderNotebook(content);
    const bar = document.getElementById('gamebar') as HTMLElement;
    // son : bouton de la barre et touche M
    const mute = document.getElementById('mute') as HTMLButtonElement | null;
    const showMute = () => mute && (mute.innerHTML = sfx.isMuted() ? '🔇 Sons <kbd>M</kbd>' : '🔈 Sons <kbd>M</kbd>');
    const toggleSound = () => {
      sfx.setMuted(!sfx.isMuted());
      if (!sfx.isMuted()) sfx.play('tap');
      showMute();
    };
    if (mute) mute.onclick = toggleSound;
    document.addEventListener('toggle-sound', toggleSound);
    showMute();
    document.addEventListener('game-started', () => (bar.hidden = false));
    bar.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach((b) => {
      b.onclick = () => (world as unknown as { openPanel: (w: string) => void }).openPanel(b.dataset.panel ?? '');
    });
    // chaque bouton répond d'un petit clic (les panneaux ont leur bruit de papier)
    document.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b && !b.disabled && !b.dataset.panel && !b.closest('#dlg .choices, #dlg .picks, #dlg-body > .go') && b.id !== 'mute') sfx.play('tap');
    });
    document.addEventListener('notebook-changed', () => {
      renderNotebook(content);
      exp.textContent = `${ui.exportLog} · ${count()}`;
    });
  });
});
