import Phaser from 'phaser';

import type { Content } from './engine/content';
import { count, toCsv } from './engine/log';
import * as notebook from './engine/notebook';
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
function renderNotebook(content: Content) {
  const v = document.getElementById('vocab') as HTMLElement;
  const wc = document.getElementById('wc') as HTMLElement;
  const ids = notebook.all();
  wc.textContent = String(ids.length);
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
    document.addEventListener('game-started', () => (bar.hidden = false));
    bar.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach((b) => {
      b.onclick = () => (world as unknown as { openPanel: (w: string) => void }).openPanel(b.dataset.panel ?? '');
    });
    document.addEventListener('notebook-changed', () => {
      renderNotebook(content);
      exp.textContent = `${ui.exportLog} · ${count()}`;
    });
  });
});
