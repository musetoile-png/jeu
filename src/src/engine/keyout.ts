/**
 * Détourage du blanc : les images livrées sur fond blanc uni (plans médian/proche,
 * personnages, objets) sont rendues transparentes là où le pixel est quasi blanc,
 * avec un dégradé d'alpha près du seuil pour garder les bords d'encre doux.
 */
import Phaser from 'phaser';

export function keyOutWhite(scene: Phaser.Scene, key: string, threshold = 238, soft = 24) {
  if (!scene.textures.exists(key)) return;
  const src = scene.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const w = src.width,
    h = src.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const m = Math.min(d[i], d[i + 1], d[i + 2]);
    if (m >= threshold) d[i + 3] = 0;
    else if (m >= threshold - soft) d[i + 3] = Math.round((d[i + 3] * (threshold - m)) / soft);
  }
  ctx.putImageData(img, 0, 0);
  scene.textures.remove(key);
  scene.textures.addCanvas(key, canvas);
}
