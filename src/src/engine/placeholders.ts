/**
 * Textures de secours dessinées en code, utilisées quand une image du pack manque.
 * Elles permettent de jouer avant que les illustrations soient livrées — et de voir d'un coup d'œil ce qui manque.
 */
import Phaser from 'phaser';

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

export function ensurePlaceholderPlane(scene: Phaser.Scene, key: string, w: number, h: number, shade: number) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  if (shade > 0) {
    // plans secondaires : transparents, juste une étiquette
    ctx.clearRect(0, 0, w, h);
    ctx.font = '24px sans-serif';
    ctx.fillStyle = 'rgba(80,70,60,.45)';
    ctx.fillText(`[ image manquante : ${key} ]`, 40, 60 + shade * 40);
    tex.refresh();
    return;
  }
  const g = ctx.createLinearGradient(0, 0, 0, h);
  const v = 235 - shade * 25;
  g.addColorStop(0, `rgb(${v},${v - 2},${v - 8})`);
  g.addColorStop(1, `rgb(${v - 30},${v - 32},${v - 36})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // grain de papier
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(60,50,40,${Math.random() * 0.08})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  ctx.font = '28px sans-serif';
  ctx.fillStyle = 'rgba(80,70,60,.5)';
  ctx.fillText(`[ image manquante : ${key} ]`, 40, 60 + shade * 40);
  tex.refresh();
}

/** Silhouette à l'encre (joueur ou PNJ), deux frames (repos / marche). */
export function ensurePlaceholderPerson(scene: Phaser.Scene, key: string, accent: string, walkFrame = false) {
  if (scene.textures.exists(key)) return;
  const W = 120,
    H = 260;
  const tex = scene.textures.createCanvas(key, W, H);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.beginPath();
  ctx.ellipse(60, 250, 40, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  const ink = '#2b2b33';
  ctx.fillStyle = ink;
  const lo = walkFrame ? 14 : 0;
  rr(ctx, 38 - lo / 2, 150, 18, 95, 8);
  rr(ctx, 64 + lo / 2, 150, 18, 95, 8);
  ctx.fillStyle = accent;
  rr(ctx, 30, 70, 60, 90, 18);
  ctx.fillStyle = ink;
  rr(ctx, 16, 78, 16, 60, 8);
  rr(ctx, 88, 78, 16, 60, 8);
  ctx.fillStyle = '#f0d9c0';
  ctx.beginPath();
  ctx.arc(60, 44, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(60, 38, 27, Math.PI * 1.02, Math.PI * 1.98);
  ctx.fill();
  tex.refresh();
}
