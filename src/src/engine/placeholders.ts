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

/** Clés des textures de secours (pour les mettre à la bonne taille tant que l'illustration manque). */
export const placeholderKeys = new Set<string>();

/**
 * Décor pas encore peint, avec un titre : une feuille de papier de riz, le nom du lieu au pinceau,
 * un lavis pour le sol. Sobre et jouable — rien qui ressemble à une erreur.
 */
function paperPlane(ctx: CanvasRenderingContext2D, w: number, h: number, title: string) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#f1eadb');
  g.addColorStop(0.75, '#e9dfca');
  g.addColorStop(1, '#d9ccb2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // fibres du papier : petits traits clairs et sombres, déterministes
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    ctx.strokeStyle = rnd() < 0.5 ? `rgba(90,70,40,${rnd() * 0.07})` : `rgba(255,255,255,${rnd() * 0.25})`;
    ctx.lineWidth = 1;
    const x = rnd() * w;
    const y = rnd() * h;
    const a = rnd() * Math.PI;
    const l = 6 + rnd() * 22;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  // sol : un lavis d'encre diluée, plus dense vers le bas
  const floor = h * 0.88;
  const f = ctx.createLinearGradient(0, floor - 60, 0, h);
  f.addColorStop(0, 'rgba(43,43,51,0)');
  f.addColorStop(0.35, 'rgba(43,43,51,0.07)');
  f.addColorStop(1, 'rgba(43,43,51,0.16)');
  ctx.fillStyle = f;
  ctx.fillRect(0, floor - 60, w, h - floor + 60);
  // le nom du lieu, à l'encre, et un trait de pinceau dessous
  ctx.fillStyle = 'rgba(43,43,51,0.82)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(h * 0.17)}px 'Ma Shan Zheng', 'Noto Serif SC', 'Noto Sans SC', serif`;
  ctx.fillText(title, w / 2, h * 0.36);
  ctx.strokeStyle = 'rgba(43,43,51,0.35)';
  ctx.lineCap = 'round';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(w / 2 - h * 0.24, h * 0.49);
  ctx.quadraticCurveTo(w / 2, h * 0.47, w / 2 + h * 0.26, h * 0.5);
  ctx.stroke();
  // sceau rouge
  ctx.fillStyle = 'rgba(214,50,42,0.85)';
  rr(ctx, w / 2 + h * 0.3, h * 0.27, h * 0.05, h * 0.05, 6);
}

export function ensurePlaceholderPlane(scene: Phaser.Scene, key: string, w: number, h: number, shade: number, title?: string) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  placeholderKeys.add(key);
  const ctx = tex.getContext();
  if (title) {
    if (shade > 0) ctx.clearRect(0, 0, w, h);
    else {
      paperPlane(ctx, w, h, title);
      // la police calligraphique arrive peut-être après : on repeint le titre une fois chargée
      void document.fonts.load(`40px 'Ma Shan Zheng'`).then(() => {
        if (!scene.textures.exists(key)) return;
        paperPlane(ctx, w, h, title);
        tex.refresh();
      });
    }
    tex.refresh();
    return;
  }
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
  placeholderKeys.add(key);
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
