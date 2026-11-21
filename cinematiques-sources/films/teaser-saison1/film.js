// 千里 Mille li — teaser de la saison 1 « Les dernières couleurs de l'Empire ».
// Film = fonction du temps : window.seek(t) peint l'image t (asynchrone quand il faut charger une image de plan IA).
// Plans IA (P4, P6) et générique (P7) : images extraites dans clips/<plan>/0001.jpg…, voir README du film.
import { clamp, lerp, prog, ease } from '../../lib/motion.js';
import { rng } from '../../lib/rng.js';

const T = await (await fetch('./timeline.json')).json();
const D = await (await fetch('./data.json')).json();
const W = T.width, H = T.height;
const cv = document.getElementById('c');
cv.width = W; cv.height = H;
const ctx = cv.getContext('2d');
await document.fonts.load("italic 400 32px 'Fraunces'");
await document.fonts.load("400 32px 'FrauncesR'");
await document.fonts.load("600 64px 'Noto Serif CJK SC'");
await document.fonts.ready;

const INK = '#1b1612', PAPER = '#efe5cf', RED = '#b3261e', BROWN = '#5e4f3d';
const ZH = "'Noto Serif CJK SC', 'Noto Serif CJK TC', serif";

const load = (src) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('image ' + src)); i.src = src; });
const IMG = {};
for (const k of ['ruelle_far', 'bouquinerie_far', 'land_a', 'land_b', 'scroll_a']) IMG[k] = await load(`./assets/${k}.jpg`);
IMG.bai = await load('./assets/bai_stand.png');

// ---------- images des plans IA et du générique, chargées à la demande ----------
const cache = new Map();
async function clipFrame(name, t) {
  const c = T.clips[name];
  const i = clamp(Math.floor((t - c.start) * c.fps), 0, c.frames - 1);
  const key = name + i;
  if (!cache.has(key)) {
    cache.set(key, load(`./${c.dir}/${String(i + 1).padStart(4, '0')}.jpg`));
    if (cache.size > 90) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}

// ---------- papier de riz ----------
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
  for (let i = 0; i < 900; i++) {
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

function ridge(seed, base, amp, x) {
  const R = rng(seed);
  const comps = Array.from({ length: 6 }, (_, k) => [amp / (k + 1) ** 1.2 * (0.6 + R() * 0.8), 0.002 * (k + 1) ** 1.5 * (0.7 + R() * 0.6), R() * 6.28]);
  let y = base;
  for (const [a, f, ph] of comps) y -= a * Math.max(0, Math.sin(x * f + ph)) ** 1.2;
  return y;
}
function mountains(t, alpha) {
  [{ seed: 21, base: 900, amp: 240, a: 0.12, par: 0.3 }, { seed: 23, base: 1080, amp: 170, a: 0.2, par: 1 }].forEach((L) => {
    ctx.save();
    ctx.filter = 'blur(3px)';
    ctx.beginPath(); ctx.moveTo(-50, H + 50);
    for (let x = -50; x <= W + 50; x += 12) ctx.lineTo(x, ridge(L.seed, L.base, L.amp, x + t * 5 * L.par));
    ctx.lineTo(W + 50, H + 50); ctx.closePath();
    const g = ctx.createLinearGradient(0, L.base - L.amp * 1.4, 0, L.base + 80);
    g.addColorStop(0, `rgba(40,34,28,${L.a * alpha})`); g.addColorStop(1, 'rgba(60,52,42,0)');
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();
  });
}

// ---------- pinceau : tracés réels des caractères ----------
const PATHS = {};
for (const [c, d] of Object.entries(D.chars)) PATHS[c] = d.strokes.map((s) => new Path2D(s));
const mlen = (m) => m.slice(1).reduce((s, p, k) => s + Math.hypot(p[0] - m[k][0], p[1] - m[k][1]), 0);
function pointAt(m, dist) {
  let acc = 0;
  for (let i = 1; i < m.length; i++) {
    const seg = Math.hypot(m[i][0] - m[i - 1][0], m[i][1] - m[i - 1][1]);
    if (acc + seg >= dist) { const u = (dist - acc) / seg; return [lerp(m[i - 1][0], m[i][0], u), lerp(m[i - 1][1], m[i][1], u), i]; }
    acc += seg;
  }
  return [...m[m.length - 1], m.length];
}
function toChar(c, p) { c.translate(p.x, p.y); c.scale(p.s, p.s); c.translate(-512, -512); c.translate(0, 900); c.scale(1, -1); }
// horaire des traits d'une suite de caractères
function schedule(chars, t0, speed, gap, cgap) {
  let t = t0; const out = [];
  for (const ch of chars) {
    D.chars[ch].medians.forEach((m, i) => { const d = Math.max(0.05, mlen(m) / speed); out.push({ c: ch, i, t0: t, t1: t + d }); t += d + gap; });
    t += cgap;
  }
  return out;
}
function stroke(c2, ch, i, place, u, big) {
  const path = PATHS[ch][i], m = D.chars[ch].medians[i];
  const e = ease.inOutCubic(u), L = mlen(m);
  c2.save(); toChar(c2, place);
  c2.save(); c2.clip(path);
  const [hx, hy, k] = pointAt(m, e * L);
  c2.strokeStyle = INK; c2.lineCap = 'round'; c2.lineJoin = 'round'; c2.lineWidth = 150;
  c2.beginPath(); c2.moveTo(m[0][0], m[0][1]);
  for (let j = 1; j < k; j++) c2.lineTo(m[j][0], m[j][1]);
  c2.lineTo(hx, hy); c2.stroke();
  if (big) { // 飞白 : traînées sèches
    const R = rng(ch.charCodeAt(0) * 31 + i);
    c2.lineWidth = 3;
    for (let s = 0; s < 9; s++) {
      const off = (R() - 0.5) * 70, from = 0.55 + R() * 0.3;
      if (e < from) continue;
      c2.strokeStyle = `rgba(239,229,207,${0.18 + R() * 0.25})`;
      c2.beginPath();
      for (let q = from; q <= e; q += 0.02) {
        const [x0, y0] = pointAt(m, q * L), [x1, y1] = pointAt(m, Math.min(L, q * L + 4));
        const nx = -(y1 - y0), ny = x1 - x0, nl = Math.hypot(nx, ny) || 1;
        const px = x0 + nx / nl * off, py = y0 + ny / nl * off;
        q === from ? c2.moveTo(px, py) : c2.lineTo(px, py);
      }
      c2.stroke();
    }
  }
  c2.restore(); c2.restore();
}
function drawSchedule(c2, sch, places, t, big) {
  for (const s of sch) {
    if (t < s.t0) continue;
    stroke(c2, s.c, s.i, places[s.c], clamp((t - s.t0) / (s.t1 - s.t0)), big);
  }
}

// ---------- textes ----------
function shadowText(txt, x, y, font, fill, blur = 14) {
  ctx.font = font;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = blur; ctx.fillStyle = fill; ctx.fillText(txt, x, y); ctx.restore();
}
const VOICE = Object.fromEntries(T.voice.map((v) => [v.file, v]));
const DUR = { mm1: 1.5, mm2: 0.9 };
function subtitle(t, key) {
  const v = VOICE[key];
  const a = Math.min(ease.outCubic(prog(t, v.t - 0.15, v.t + 0.25)), 1 - prog(t, v.t + DUR[key] + 1.3, v.t + DUR[key] + 1.8));
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'center';
  const top = v.pos === 'top', y0 = top ? 130 : 900;
  const g = top ? ctx.createLinearGradient(0, 330, 0, 0) : ctx.createLinearGradient(0, H - 330, 0, H);
  g.addColorStop(0, 'rgba(10,8,6,0)'); g.addColorStop(1, 'rgba(10,8,6,0.62)');
  ctx.fillStyle = g; ctx.fillRect(0, top ? 0 : H - 330, W, 330);
  shadowText(v.zh, W / 2, y0, `600 72px ${ZH}`, '#fbf5e8', 18);
  shadowText(v.py, W / 2, y0 + 58, "italic 400 34px 'Fraunces'", '#eadcbf');
  shadowText(v.fr, W / 2, y0 + 110, "400 34px 'FrauncesR'", '#fbf5e8');
  ctx.restore();
}

// ---------- P1 : la signature de Lín Yuè s'efface ----------
const SIGN = schedule('林月', 0.9, 2100, 0.05, 0.15);
const SIGN_PLACE = { '林': { x: 960, y: 372, s: 0.3 }, '月': { x: 960, y: 700, s: 0.3 } };
const sigCv = document.createElement('canvas'); sigCv.width = W; sigCv.height = H;
const sig = sigCv.getContext('2d');
function p1(t) {
  ctx.drawImage(paper, 0, 0);
  mountains(t, ease.outCubic(prog(t, 0.2, 3)));
  // goutte d'encre
  if (t > 0.05 && t < 0.4) { const u = (t - 0.05) / 0.35; ctx.fillStyle = INK; ctx.beginPath(); ctx.ellipse(960, lerp(-40, 372, u * u), 9, 14, 0, 0, 7); ctx.fill(); }
  sig.clearRect(0, 0, W, H);
  drawSchedule(sig, SIGN, SIGN_PLACE, t, true);
  const fade = ease.inOutCubic(prog(t, 4.2, 5.9));
  ctx.save();
  ctx.filter = `blur(${fade * 9}px)`;
  ctx.globalAlpha = 1 - fade * 0.92;
  ctx.drawImage(sigCv, 0, 0);
  ctx.restore();
  // petite date, en marge
  const a = ease.outCubic(prog(t, 1.2, 2.2)) * (1 - prog(t, 5.0, 5.9));
  if (a > 0) { ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = BROWN; ctx.font = "italic 400 40px 'Fraunces'"; ctx.textAlign = 'left'; ctx.fillText('1919', 1180, 560); ctx.restore(); }
}

// ---------- P2 : le rouleau, puis coupé en huit ----------
const BAND = { y: 270, h: 540, border: 30 };
const SEAMS = (() => { // 7 lignes de déchirure irrégulières
  const R = rng(77), seams = [];
  for (let k = 1; k < 8; k++) {
    const x = (W / 8) * k + (R() - 0.5) * 60, pts = [];
    for (let y = BAND.y - 40; y <= BAND.y + BAND.h + 40; y += 18) pts.push([x + (R() - 0.5) * 26, y]);
    seams.push(pts);
  }
  return seams;
})();
function drawStrip(scrollX) {
  const { y, h, border } = BAND;
  ctx.fillStyle = '#5b4a37'; ctx.fillRect(-20, y - border - 8, W + 40, h + 2 * border + 16); // soie de montage
  ctx.fillStyle = '#7a6448'; ctx.fillRect(-20, y - border, W + 40, 6); ctx.fillRect(-20, y + h + border - 6, W + 40, 6);
  ctx.fillStyle = '#e6dcc6'; ctx.fillRect(-20, y - 6, W + 40, h + 12);
  const iw = h * 16 / 9;
  ctx.save(); ctx.filter = 'grayscale(1) sepia(0.25) contrast(1.05)';
  ctx.drawImage(IMG.land_a, scrollX, y, iw, h);
  ctx.drawImage(IMG.land_b, scrollX + iw, y, iw, h);
  ctx.drawImage(IMG.land_a, scrollX + 2 * iw, y, iw, h);
  ctx.restore();
}
function p2(t) {
  ctx.drawImage(paper, 0, 0);
  const dark = ease.inOutCubic(prog(t, 10.8, 12.4));
  const scrollX = -lerp(0, 240, prog(t, 6, 12.5));
  const unroll = ease.inOutCubic(prog(t, 6.0, 7.4));
  const tear = ease.inOutCubic(prog(t, 9.4, 12.2));
  if (tear <= 0) {
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 40 + unroll * (W - 40), H); ctx.clip();
    drawStrip(scrollX); ctx.restore();
    if (unroll < 1) { // le bâton du rouleau qui se déroule
      const x = 40 + unroll * (W - 40);
      ctx.fillStyle = '#3b2a1c'; ctx.fillRect(x - 22, BAND.y - 60, 44, BAND.h + 120);
      ctx.fillStyle = '#c9a66b'; ctx.fillRect(x - 26, BAND.y - 76, 52, 22); ctx.fillRect(x - 26, BAND.y + BAND.h + 54, 52, 22);
    }
  } else {
    const R = rng(5);
    for (let k = 0; k < 8; k++) {
      const left = k === 0 ? [[-30, BAND.y - 40], [-30, BAND.y + BAND.h + 40]] : SEAMS[k - 1];
      const right = k === 7 ? [[W + 30, BAND.y - 40], [W + 30, BAND.y + BAND.h + 40]] : SEAMS[k];
      const cx = (W / 8) * (k + 0.5), cy = BAND.y + BAND.h / 2;
      const dx = (k - 3.5) * 70 * tear + (R() - 0.5) * 80 * tear, dy = (R() - 0.5) * 380 * tear, rot = (R() - 0.5) * 0.5 * tear;
      ctx.save();
      ctx.globalAlpha = 1 - prog(t, 11.0, 12.3);
      ctx.translate(cx + dx, cy + dy); ctx.rotate(rot); ctx.scale(1 - 0.25 * tear, 1 - 0.25 * tear); ctx.translate(-cx, -cy);
      ctx.beginPath();
      left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      [...right].reverse().forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.closePath();
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 30 * tear; ctx.fillStyle = '#e6dcc6'; ctx.fill(); ctx.restore();
      ctx.clip(); drawStrip(scrollX);
      ctx.restore();
    }
  }
  if (dark > 0) { ctx.fillStyle = `rgba(14,11,8,${dark})`; ctx.fillRect(0, 0, W, H); }
}

// ---------- P3 : Shanghai, la ruelle puis la bouquinerie ----------
function kenBurns(img, z, cx, cy) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(z, z); ctx.translate(-cx, -cy); ctx.drawImage(img, 0, 0, W, H); ctx.restore();
}
function p3(t) {
  const a = ease.outCubic(prog(t, 12.5, 13.3));
  ctx.fillStyle = '#0e0b08'; ctx.fillRect(0, 0, W, H);
  const mix = ease.inOutCubic(prog(t, 15.8, 16.6));
  if (mix < 1) {
    ctx.save(); ctx.globalAlpha = a;
    kenBurns(IMG.ruelle_far, lerp(1.0, 1.22, ease.inOutCubic(prog(t, 12.5, 16.6))), 1280, 660);
    ctx.restore();
  }
  if (mix > 0) {
    ctx.save(); ctx.globalAlpha = mix;
    const z = lerp(1.0, 1.6, ease.inOutCubic(prog(t, 16.0, 19.7)));
    ctx.translate(330, 650); ctx.scale(z, z); ctx.translate(-330, -650);
    ctx.drawImage(IMG.bouquinerie_far, 0, 0, W, H);
    const bh = 560, bw = bh * IMG.bai.width / IMG.bai.height;
    ctx.drawImage(IMG.bai, 900 - bw / 2, 1010 - bh, bw, bh);
    ctx.restore();
  }
  // lueur chaude du soir
  ctx.fillStyle = `rgba(255,170,80,${0.06 * a})`; ctx.fillRect(0, 0, W, H);
}

// ---------- P5 : la carte des huit villes ----------
const geo = (lon, lat) => [200 + (lon - 107) * 95, 1000 - (lat - 29.5) * 80];
const CITIES = [
  { zh: '上海', py: 'Shànghǎi', ll: [121.47, 31.23], side: 'r' },
  { zh: '杭州', py: 'Hángzhōu', ll: [120.16, 30.27], side: 'l' },
  { zh: '南京', py: 'Nánjīng', ll: [118.8, 32.06], side: 'l' },
  { zh: '开封', py: 'Kāifēng', ll: [114.31, 34.8], side: 'r' },
  { zh: '北京', py: 'Běijīng', ll: [116.4, 39.9], side: 'r' },
  { zh: '西安', py: "Xī'ān", ll: [108.94, 34.34], side: 'l' },
  { zh: '洛阳', py: 'Luòyáng', ll: [112.45, 34.62], side: 'l' },
  { zh: '安阳', py: 'Ānyáng', ll: [114.39, 36.1], side: 't' },
].map((c, k) => ({ ...c, p: geo(...c.ll), t: 27.1 + k * 0.95 }));
const CS = 0.064, CW = 1024 * CS;
CITIES.forEach((c) => {
  const [x, y] = c.p, x0 = c.side === 'r' ? x + 34 + CW / 2 : c.side === 't' ? x - CW / 2 : x - 34 - CW * 1.5;
  const cy = c.side === 't' ? y - 104 : y - 6;
  c.places = { [c.zh[0]]: { x: x0, y: cy, s: CS }, [c.zh[1]]: { x: x0 + CW, y: cy, s: CS } };
  c.labelY = c.side === 't' ? y - 48 : y + 56;
  c.sch = schedule(c.zh, c.t + 0.05, 3800, 0.012, 0.03);
  c.labelX = x0 + CW / 2;
});
const RETURN = [34.45, 35.9];
function routeTo(t) { // points de la route dessinée jusqu'à t
  const pts = [CITIES[0].p];
  for (let k = 1; k < CITIES.length; k++) {
    const a = CITIES[k - 1].t + 0.25, b = CITIES[k].t;
    if (t <= a) break;
    const u = ease.inOutCubic(prog(t, a, b));
    const [x0, y0] = CITIES[k - 1].p, [x1, y1] = CITIES[k].p;
    pts.push([lerp(x0, x1, u), lerp(y0, y1, u)]);
    if (u < 1) break;
  }
  return pts;
}
function p5(t) {
  ctx.drawImage(paper, 0, 0);
  mountains(t, 0.7);
  // la route
  ctx.save(); ctx.strokeStyle = 'rgba(27,22,18,0.82)'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const pts = routeTo(t);
  ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  // retour vers Shanghai, en pointillés rouges
  const r = ease.inOutCubic(prog(t, RETURN[0], RETURN[1]));
  if (r > 0) {
    ctx.setLineDash([14, 14]); ctx.strokeStyle = RED; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(qx(0), qy(0));
    for (let u = 0.02; u < r; u += 0.02) ctx.lineTo(qx(u), qy(u));
    ctx.lineTo(qx(r), qy(r)); ctx.stroke();
  }
  ctx.restore();
  function qx(u) { const [x0] = CITIES[7].p, x1 = CITIES[0].p[0]; return (1 - u) ** 2 * x0 + 2 * (1 - u) * u * 1450 + u * u * x1; }
  function qy(u) { const y0 = CITIES[7].p[1], y1 = CITIES[0].p[1]; return (1 - u) ** 2 * y0 + 2 * (1 - u) * u * 420 + u * u * y1; }
  // les villes
  for (const c of CITIES) {
    if (t < c.t - 0.05) continue;
    const pop = ease.outBack(clamp((t - c.t + 0.05) / 0.35));
    ctx.fillStyle = c === CITIES[0] ? RED : INK;
    ctx.beginPath(); ctx.arc(c.p[0], c.p[1], 11 * pop, 0, 7); ctx.fill();
    drawSchedule(ctx, c.sch, c.places, t, false);
    const a = ease.outCubic(prog(t, c.t + 0.35, c.t + 0.8));
    if (a > 0) { ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = BROWN; ctx.textAlign = 'center'; ctx.font = "italic 400 26px 'Fraunces'"; ctx.fillText(c.py, c.labelX, c.labelY); ctx.restore(); }
  }
}

// ---------- P7 : surimpressions sur le générique ----------
function p7Over(t) {
  const a = ease.outCubic(prog(t, 50.4, 51.4));
  if (a > 0) {
    ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'center';
    ctx.fillStyle = RED; ctx.font = "400 30px 'FrauncesR'";
    ctx.letterSpacing = '8px'; ctx.fillText('SAISON 1', 875, 118); ctx.letterSpacing = '0px';
    ctx.fillStyle = INK; ctx.font = "italic 400 56px 'Fraunces'"; ctx.fillText("Les dernières couleurs de l'Empire", 875, 186);
    ctx.restore();
  }
  const b = ease.outCubic(prog(t, 55.2, 56.0));
  if (b > 0) { ctx.save(); ctx.globalAlpha = b; ctx.fillStyle = BROWN; ctx.font = "400 34px 'FrauncesR'"; ctx.textAlign = 'left'; ctx.fillText('Bientôt.', 110, 1012); ctx.restore(); }
  const end = prog(t, 56.9, 57.5);
  if (end > 0) { ctx.fillStyle = `rgba(14,11,8,${end})`; ctx.fillRect(0, 0, W, H); }
}

async function drawClip(name, t, alpha = 1) {
  const img = await clipFrame(name, t);
  ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(img, 0, 0, W, H); ctx.restore();
}

window.seek = async (t) => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none'; ctx.globalAlpha = 1;
  if (t < 6) p1(t);
  else if (t < 12.5) { p2(t); if (t < 6.8) { ctx.save(); ctx.globalAlpha = 1 - prog(t, 6, 6.8); p1(5.99); ctx.restore(); } }
  else if (t < 19.5) { p3(t); if (t > 19.0) await drawClip('p4', 19.5, ease.inOutCubic(prog(t, 19.0, 19.5))); }
  else if (t < 26.5) { await drawClip('p4', t); subtitle(t, 'mm1'); }
  else if (t < 37.5) {
    p5(t);
    if (t < 27.1) await drawClip('p4', 26.49, 1 - ease.inOutCubic(prog(t, 26.5, 27.1)));
    if (t > 37.0) await drawClip('p6', 37.5, ease.inOutCubic(prog(t, 37.0, 37.5)));
    subtitle(t, 'mm1');
  } else if (t < 46) {
    await drawClip('p6', t);
    if (t > 45.4) await drawClip('p7', 46, ease.inOutCubic(prog(t, 45.4, 46)));
    subtitle(t, 'mm2');
  } else { await drawClip('p7', t); p7Over(t); subtitle(t, 'mm2'); }
};
window.filmReady = true;
