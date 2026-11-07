import Phaser from 'phaser';

import type { Content } from './engine/content';
import { count, toCsv } from './engine/log';
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

// ---- Interface HTML autour du canvas : carnet de mots, journal ----
let lastCount = -1;
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
    exp.onclick = () => {
      const blob = new Blob([toCsv()], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `journal-${new Date().toISOString().slice(0, 10)}.csv`;
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
