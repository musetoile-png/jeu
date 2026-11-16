// 千里 Mille li — générique : le titre s'écrit au pinceau, trait par trait, dans l'ordre réel des traits.
// Tracés : makemeahanzi / hanzi-writer-data (licence Arphic). Film = fonction pure du temps.
import { clamp, lerp, prog, ease, spring, kick } from '../../lib/motion.js';
import { rng } from '../../lib/rng.js';

const T = await (await fetch('./timeline.json')).json();
const D = await (await fetch('./data.json')).json();
const C = Object.fromEntries(T.cues.map((c) => [c.name, c.t]));
const W = T.width, H = T.height;
const cv = document.getElementById('c');
cv.width = W; cv.height = H;
const ctx = cv.getContext('2d');
await document.fonts.load("italic 400 32px 'Fraunces'");
await document.fonts.load("400 32px 'FrauncesR'");
await document.fonts.ready;

const INK = '#1b1612', PAPER = '#efe5cf', RED = '#b3261e';

// ---------- papier de riz (calculé une fois, identique à chaque image) ----------
const paper = document.createElement('canvas');
paper.width = W; paper.height = H;
{
  const p = paper.getContext('2d');
  p.fillStyle = PAPER; p.fillRect(0, 0, W, H);
  const R = rng(3);
  const img = p.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.9; }
  p.putImageData(img, 0, 0);
  p.strokeStyle = 'rgba(120,100,70,0.10)';
  for (let i = 0; i < 900; i++) { // fibres
    const x = R() * W, y = R() * H, l = 20 + R() * 90, a = R() * 6.28;
    p.lineWidth = 0.5 + R() * 1.2;
    p.beginPath(); p.moveTo(x, y);
    p.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (R() - 0.5) * 20, y + Math.sin(a) * l * 0.5 + (R() - 0.5) * 20, x + Math.cos(a) * l, y + Math.sin(a) * l);
    p.stroke();
  }
  const g = p.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H * 1.1);
  g.addColorStop(0, 'rgba(90,70,40,0)'); g.addColorStop(1, 'rgba(90,70,40,0.28)');
  p.fillStyle = g; p.fillRect(0, 0, W, H);
}

// ---------- montagnes au lavis (山水) ----------
function ridge(seed, base, amp, x) {
  const R = rng(seed);
  const comps = Array.from({ length: 6 }, (_, k) => [amp / (k + 1) ** 1.2 * (0.6 + R() * 0.8), 0.002 * (k + 1) ** 1.5 * (0.7 + R() * 0.6), R() * 6.28]);
  let y = base;
  for (const [a, f, ph] of comps) y -= a * Math.max(0, Math.sin(x * f + ph)) ** (1.2);
  return y;
}
const LAYERS = [
  { seed: 21, base: 860, amp: 260, a: 0.16, par: 0.3 },
  { seed: 22, base: 960, amp: 220, a: 0.26, par: 0.6 },
  { seed: 23, base: 1060, amp: 170, a: 0.42, par: 1.0 },
];
function drawMountains(t) {
  const rev = ease.outCubic(prog(t, 0.2, 3.2));
  LAYERS.forEach((L, li) => {
    const shift = -t * 6 * L.par;
    const reveal = clamp(rev * 1.4 - li * 0.2);
    if (reveal <= 0) return;
    ctx.save();
    ctx.filter = `blur(${lerp(14, 2.5, reveal)}px)`;
    ctx.beginPath(); ctx.moveTo(-50, H + 50);
    for (let x = -50; x <= W + 50; x += 12) ctx.lineTo(x, ridge(L.seed, L.base, L.amp, x - shift));
    ctx.lineTo(W + 50, H + 50); ctx.closePath();
    const top = L.base - L.amp * 1.4;
    const g = ctx.createLinearGradient(0, top, 0, L.base + 80);
    g.addColorStop(0, `rgba(40,34,28,${L.a * reveal})`);
    g.addColorStop(0.55, `rgba(60,52,42,${L.a * 0.45 * reveal})`);
    g.addColorStop(1, 'rgba(60,52,42,0)');
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();
  });
  // brume qui passe
  for (let k = 0; k < 3; k++) {
    const x = ((t * (18 + k * 9) + k * 700) % (W + 1200)) - 600, y = 820 + k * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 520);
    g.addColorStop(0, 'rgba(239,229,207,0.55)'); g.addColorStop(1, 'rgba(239,229,207,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 520, y - 520, 1040, 1040);
  }
}

// ---------- pinceau ----------
const PATHS = {};
for (const [c, d] of Object.entries(D.chars)) PATHS[c] = d.strokes.map((s) => new Path2D(s));
const PLACE = { // centre et taille (px pour 1024 unités)
  '千': { x: 640, y: 450, s: 0.46 }, '里': { x: 1110, y: 450, s: 0.46 },
};
const COL = { x: 1700, y0: 150, step: 100, s: 0.092 };
'千里之行始于足下'.split('').forEach((c, i) => { PLACE['p' + i] = { x: COL.x, y: COL.y0 + i * COL.step, s: COL.s }; });

function toChar(p) { // repère des données Hanzi Writer : boîte 1024, y vers le haut, ligne de base à 900
  ctx.translate(p.x, p.y); ctx.scale(p.s, p.s); ctx.translate(-512, -512); ctx.translate(0, 900); ctx.scale(1, -1);
}
function pointAt(m, dist) {
  let acc = 0;
  for (let i = 1; i < m.length; i++) {
    const seg = Math.hypot(m[i][0] - m[i - 1][0], m[i][1] - m[i - 1][1]);
    if (acc + seg >= dist) { const u = (dist - acc) / seg; return [lerp(m[i - 1][0], m[i][0], u), lerp(m[i - 1][1], m[i][1], u), i]; }
    acc += seg;
  }
  return [...m[m.length - 1], m.length];
}
function drawStroke(c, i, place, u, t1age, big) {
  const path = PATHS[c][i], m = D.chars[c].medians[i];
  const L = m.slice(1).reduce((s, p, k) => s + Math.hypot(p[0] - m[k][0], p[1] - m[k][1]), 0);
  const e = ease.inOutCubic(u);
  ctx.save();
  toChar(place);
  // l'encre boit le papier une fois le trait posé
  if (big && t1age > 0) {
    const b = ease.outCubic(clamp(t1age / 0.8));
    ctx.save(); ctx.filter = `blur(${2 + 5 * b}px)`; ctx.globalAlpha = 0.28 * b; ctx.fillStyle = INK; ctx.fill(path);
    ctx.lineWidth = 6 + 10 * b; ctx.strokeStyle = INK; ctx.stroke(path); ctx.restore();
  }
  ctx.save();
  ctx.clip(path);
  const [hx, hy, k] = pointAt(m, e * L);
  ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 150;
  ctx.beginPath(); ctx.moveTo(m[0][0], m[0][1]);
  for (let j = 1; j < k; j++) ctx.lineTo(m[j][0], m[j][1]);
  ctx.lineTo(hx, hy); ctx.stroke();
  if (big) {
    // 飞白 : traînées sèches dans la fin du trait
    const R = rng(c.charCodeAt(0) * 31 + i);
    ctx.lineWidth = 3;
    for (let s = 0; s < 9; s++) {
      const off = (R() - 0.5) * 70, from = 0.55 + R() * 0.3;
      if (e < from) continue;
      ctx.strokeStyle = `rgba(239,229,207,${0.18 + R() * 0.25})`;
      ctx.beginPath();
      for (let q = from; q <= e; q += 0.02) {
        const [x0, y0] = pointAt(m, q * L), [x1, y1] = pointAt(m, Math.min(L, q * L + 4));
        const nx = -(y1 - y0), ny = x1 - x0, nl = Math.hypot(nx, ny) || 1;
        const px = x0 + nx / nl * off, py = y0 + ny / nl * off;
        q === from ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    // encre humide à la pointe
    if (u < 1) {
      const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 70);
      g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(hx - 70, hy - 70, 140, 140);
    }
  }
  ctx.restore();
  ctx.restore();
  return big && u < 1 ? (() => { // position écran de la pointe, pour le pinceau
    const sx = place.x + (hx - 512) * place.s, sy = place.y + (900 - hy - 512) * place.s;
    return [sx, sy];
  })() : null;
}
function drawBrush(x, y, t) { // pointe de pinceau qui suit le trait
  ctx.save();
  ctx.translate(x, y); ctx.rotate(0.42 + 0.04 * Math.sin(t * 9));
  ctx.fillStyle = 'rgba(20,16,12,0.95)'; // touffe de poils, effilée
  ctx.beginPath(); ctx.moveTo(0, 4);
  ctx.bezierCurveTo(-6, -10, -17, -40, -13, -78); ctx.lineTo(13, -78); ctx.bezierCurveTo(17, -40, 6, -10, 0, 4); ctx.fill();
  const g = ctx.createLinearGradient(-13, 0, 13, 0);
  g.addColorStop(0, '#7a5a33'); g.addColorStop(0.45, '#d2b07a'); g.addColorStop(1, '#6e5030');
  ctx.fillStyle = g; ctx.fillRect(-13, -400, 26, 322);
  ctx.fillStyle = '#2a211a'; ctx.fillRect(-13, -96, 26, 20);
  ctx.fillStyle = '#9a2a20'; ctx.fillRect(-13, -400, 26, 30);
  ctx.restore();
}

function headAt(c, i, u) { // position écran de la pointe sur le trait i, à l'avancée u
  const m = D.chars[c].medians[i], place = PLACE[c];
  const L = m.slice(1).reduce((q, p, k) => q + Math.hypot(p[0] - m[k][0], p[1] - m[k][1]), 0);
  const [hx, hy] = pointAt(m, ease.inOutCubic(u) * L);
  return [place.x + (hx - 512) * place.s, place.y + (900 - hy - 512) * place.s];
}
const TITLE = D.schedule.filter((s) => s.group === 'title');
function brushPos(t) { // le pinceau reste en main entre les traits : il se lève et glisse au départ du suivant
  const first = TITLE[0], last = TITLE[TITLE.length - 1];
  if (t < first.t0 - 0.45) return null;
  if (t < first.t0) { const [x, y] = headAt(first.c, first.i, 0); const u = ease.outCubic((t - first.t0 + 0.45) / 0.45); return [lerp(x + 300, x, u), lerp(y - 420, y, u), 1 - u]; }
  for (let k = 0; k < TITLE.length; k++) {
    const s = TITLE[k];
    if (t <= s.t1) return t >= s.t0 ? [...headAt(s.c, s.i, (t - s.t0) / (s.t1 - s.t0)), 0] : null;
    const n = TITLE[k + 1];
    if (n && t < n.t0) {
      const u = ease.inOutCubic((t - s.t1) / (n.t0 - s.t1));
      const [x0, y0] = headAt(s.c, s.i, 1), [x1, y1] = headAt(n.c, n.i, 0);
      return [lerp(x0, x1, u), lerp(y0, y1, u), Math.sin(Math.PI * u)];
    }
  }
  if (t < last.t1 + 0.6) { const [x, y] = headAt(last.c, last.i, 1); const u = ease.inCubic((t - last.t1) / 0.6); return [lerp(x, x + 500, u), lerp(y, y - 600, u), u]; }
  return null;
}

function drawCharsInk(t) {
  for (const s of D.schedule) {
    if (t < s.t0) continue;
    const u = clamp((t - s.t0) / (s.t1 - s.t0));
    const place = s.group === 'title' ? PLACE[s.c] : PLACE['p' + '千里之行始于足下'.indexOf(s.c)];
    drawStroke(s.c, s.i, place, u, t - s.t1, s.group === 'title');
  }
  const b = brushPos(t);
  if (b) { ctx.save(); ctx.translate(b[0], b[1]); ctx.scale(1 + 0.08 * b[2], 1 + 0.08 * b[2]); ctx.translate(0, -30 * b[2]); drawBrush(0, 0, t); ctx.restore(); }
}

// goutte d'encre d'ouverture
function drawDrop(t) {
  const a = C['drop'];
  if (t < a - 0.35) return;
  const x = 640, y = 450;
  if (t < a) { // la goutte tombe
    const u = (t - (a - 0.35)) / 0.35;
    ctx.fillStyle = INK; ctx.beginPath(); ctx.ellipse(x, lerp(-40, y, u * u), 9, 14, 0, 0, 7); ctx.fill();
    return;
  }
  const u = ease.outCubic(clamp((t - a) / 1.4)), fade = 1 - prog(t, 0.9, 2.4);
  if (fade <= 0) return;
  ctx.save();
  ctx.filter = 'blur(10px)';
  const R = rng(17);
  for (let k = 0; k < 9; k++) {
    const rr = (40 + 300 * u) * (0.35 + R() * 0.7), ox = (R() - 0.5) * 420 * u, oy = (R() - 0.5) * 220 * u;
    ctx.fillStyle = `rgba(40,34,28,${0.05 * fade})`;
    ctx.beginPath(); ctx.arc(x + ox, y + oy, rr, 0, 7); ctx.fill();
  }
  ctx.restore();
}

function drawSeal(t) {
  const s = D.seal;
  if (t < s - 0.12) return;
  const x = 1440, y = 640, size = 118;
  const fall = clamp((t - (s - 0.12)) / 0.12);
  const q = t < s ? lerp(1.6, 1, ease.inCubic(fall)) : 1 + 0.04 * kick(t - s, 6, 0.4);
  ctx.save();
  ctx.translate(x, y); ctx.scale(q, q); ctx.rotate(0.03);
  ctx.globalAlpha = t < s ? 0.25 * fall : 1;
  // encre rouge un peu irrégulière
  const R = rng(41);
  ctx.fillStyle = RED;
  ctx.beginPath();
  const pts = [];
  for (let i = 0; i < 40; i++) {
    const side = Math.floor(i / 10), v = (i % 10) / 10, j = (R() - 0.5) * 4;
    const h = size / 2;
    pts.push(side === 0 ? [-h + v * size, -h + j] : side === 1 ? [h + j, -h + v * size] : side === 2 ? [h - v * size, h + j] : [-h + j, h - v * size]);
  }
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath(); ctx.fill();
  // caractères en réserve (blancs) : tracés réels, petits
  ctx.globalCompositeOperation = 'destination-out';
  for (const [c, dy] of [['千', -26], ['里', 27]]) {
    ctx.save(); toChar({ x: 0, y: dy, s: 0.05 });
    for (const p of PATHS[c]) { ctx.fill(p); ctx.lineWidth = 26; ctx.strokeStyle = '#000'; ctx.stroke(p); }
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
  // usure du tampon
  for (let i = 0; i < 70; i++) { ctx.fillStyle = `rgba(239,229,207,${0.25 + R() * 0.4})`; ctx.fillRect((R() - 0.5) * size, (R() - 0.5) * size, 1 + R() * 3, 1 + R() * 3); }
  ctx.restore();
}

function drawTexts(t) {
  const P = D.proverbEnd;
  // pinyin + traduction à côté du proverbe
  const a = ease.outCubic(prog(t, P - 0.2, P + 0.6));
  if (a > 0) {
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#5e4f3d';
    ctx.translate(1590, 150); ctx.rotate(Math.PI / 2);
    ctx.font = "italic 400 30px 'Fraunces'";
    ctx.fillText('Qiān lǐ zhī xíng, shǐ yú zú xià', 0, 0);
    ctx.restore();
  }
  const b = ease.outCubic(prog(t, C['latin'], C['latin'] + 0.9));
  if (b > 0) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = INK; ctx.globalAlpha = b;
    ctx.font = "italic 400 104px 'Fraunces'";
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 400 + 1500 * b, H); ctx.clip();
    ctx.fillText('Mille li', 875, 830);
    ctx.restore();
    ctx.globalAlpha = ease.outCubic(prog(t, C['latin'] + 0.5, C['latin'] + 1.3));
    ctx.fillStyle = '#5e4f3d'; ctx.font = "400 30px 'FrauncesR'";
    ctx.fillText('« Le voyage de mille li commence sous tes pas. »  — Laozi', 875, 892);
    ctx.restore();
  }
}

window.seek = (t) => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // très lente plongée vers le titre
  const z = lerp(1.08, 1.0, ease.outCubic(prog(t, 0, T.duration)));
  ctx.setTransform(z, 0, 0, z, W / 2 - (W / 2) * z, H / 2 - (H / 2) * z);
  ctx.drawImage(paper, 0, 0);
  drawMountains(t);
  drawDrop(t);
  drawCharsInk(t);
  drawSeal(t);
  drawTexts(t);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
};
window.filmReady = true;
