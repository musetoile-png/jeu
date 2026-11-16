// 千里 Mille li — cinématique d'ouverture : le chien vole le portefeuille.
// Film = fonction pure du temps : window.seek(t) peint l'image t. Décors et personnages = illustrations du jeu.
import { clamp, lerp, prog, ease, spring, kick } from '../../lib/motion.js';
import { rng } from '../../lib/rng.js';

const T = await (await fetch('./timeline.json')).json();
const W = T.width, H = T.height;
const C = Object.fromEntries(T.cues.map((c) => [c.name, c.t]));
const cv = document.getElementById('c');
cv.width = W; cv.height = H;
const ctx = cv.getContext('2d');

// un film par corps (« m » : l'étudiant, « f » : l'étudiante), même mise en scène
const BODY = T.body === 'f' ? 'f' : 'm';
const PK = BODY === 'f' ? 'playerf' : 'player';
const NAMES = ['ruelle_far.jpg', 'dog.png', 'dog_vide.png', 'dog_back.png', 'item_qianbao.png', `${PK}_torso.png`, `${PK}_leg_front.png`,
  `${PK}_leg_back.png`, `${PK}_front.png`, `${PK}_back.png`, 'moineaux.png', 'lantern.png', 'gou_bust.png'];
const IMG = {};
await Promise.all(NAMES.map(async (n) => { const im = new Image(); im.src = './assets/' + n; await im.decode(); IMG[n.split('.')[0]] = im; }));
await document.fonts.load("italic 400 32px 'Fraunces'");
await document.fonts.load("400 32px 'FrauncesR'");
await document.fonts.ready;

const INK = '#1b1612', PAPER = '#efe5cf', RED = '#b3261e';
const CJK = "'Noto Serif CJK SC', 'Noto Serif CJK JP', serif";
const GROUND = 1006, DOG_GROUND = 1034;

// ---------- marionnette (même gréement que src/engine/puppet.ts) ----------
// gréements repris de pack.json (assets.player / assets.playerF)
const RIGS = {
  m: { width: 767, height: 1263, ground: 1238, cx: 345, height2: 660,
    legs: [{ key: 'player_leg_back', pivot: [290, 725], foot: [110, 1238] }, { key: 'player_leg_front', pivot: [400, 725], foot: [650, 1238] }] },
  f: { width: 777, height: 1311, ground: 1290, cx: 346, height2: 640,
    legs: [{ key: 'playerf_leg_back', pivot: [296, 705], foot: [106, 1272] }, { key: 'playerf_leg_front', pivot: [376, 705], foot: [676, 1272] }] },
};
const RIG = RIGS[BODY];
const PH = 440 * RIG.height2 / 660; // hauteur du personnage à l'écran (l'étudiante est un peu plus petite)
const U = PH / RIG.ground;
const LEGS = RIG.legs.map((l) => { const dx = l.foot[0] - l.pivot[0], dy = l.foot[1] - l.pivot[1];
  return { ...l, a0: Math.atan2(dx, dy), len: Math.hypot(dx, dy) }; });

function puppetLift(m, phase) {
  const c = Math.cos(phase);
  let lowest = -Infinity;
  for (const l of LEGS) lowest = Math.max(lowest, l.pivot[1] + l.len * Math.cos(m * l.a0 * c));
  return lowest - RIG.ground;
}
// local (illustration px) → monde, pour placer le portefeuille dans la poche
function puppetPoint(p, px, py) {
  const s = p.scale * U;
  return { x: p.x + (px - RIG.cx) * s * p.face, y: p.y + (py - RIG.ground - puppetLift(p.m, p.phase)) * s };
}
// vue de dos : une seule image, qui rebondit et se balance au rythme des pas
function drawBack(im, x, y, h, gait, alpha, sway = 0.035) {
  const w = h * im.width / im.height;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y - Math.abs(Math.sin(gait)) * h * 0.035);
  ctx.rotate(sway * Math.sin(gait));
  ctx.drawImage(im, -w / 2, -h, w, h);
  ctx.restore();
}
function drawPuppet(p, extra) {
  if (p.back) {
    drawBack(IMG[`${PK}_back`], p.x, p.y, PH * p.scale, p.gait, p.alpha ?? 1);
    return;
  }
  const c = Math.cos(p.phase);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(p.face * p.scale * U, p.scale * U);
  ctx.globalAlpha = p.alpha ?? 1;
  if (p.front) {
    const im = IMG[`${PK}_front`], h = RIG.ground, w = h * im.width / im.height;
    ctx.translate(0, -(p.hop || 0) / (p.scale * U));
    ctx.drawImage(im, -w / 2, -h, w, h);
    ctx.restore();
    return;
  }
  ctx.translate(-RIG.cx, -RIG.ground - puppetLift(p.m, p.phase));
  for (const l of LEGS) {
    ctx.save();
    ctx.translate(l.pivot[0], l.pivot[1]);
    ctx.rotate(l.a0 - p.m * l.a0 * c);
    ctx.drawImage(IMG[l.key], -l.pivot[0], -l.pivot[1], RIG.width, RIG.height);
    ctx.restore();
  }
  ctx.save();
  ctx.translate(RIG.cx, RIG.ground);
  ctx.rotate(p.m * 1.2 * Math.PI / 180 * Math.sin(p.phase * 2) + (p.lean || 0));
  ctx.drawImage(IMG[`${PK}_torso`], -RIG.cx, -RIG.ground, RIG.width, RIG.height);
  ctx.restore();
  if (extra) extra();
  ctx.restore();
}

// ---------- le joueur ----------
const WK = T.walk, RN = T.run;
function walkAmount(t) { // amplitude du pas : 1 en marchant, retombe en douceur à l'arrêt
  return 1 - ease.inOutCubic(prog(t, WK.stop - WK.ease, WK.stop));
}
function walkX(t) { // intégrale de la vitesse × amplitude (pas fixe, déterministe)
  const end = Math.min(t, WK.stop);
  let x = WK.x0, dt = 1 / 240;
  for (let s = WK.t0; s < end; s += dt) x += WK.speed * walkAmount(s) * Math.min(dt, end - s);
  return x;
}
const STOP_X = walkX(WK.stop);
const GATE_X = 1272, GATE_Y = 742;

function player(t) {
  if (t < C['turn']) {
    return { x: walkX(t), y: GROUND, face: 1, scale: 1, m: t < WK.t0 ? 0 : walkAmount(t), phase: WK.omega * Math.max(0, t - WK.t0) };
  }
  if (t < RN.t0) {
    const hop = 46 * Math.max(0, kick(t - C['turn'], 3.2, 0.5));
    return { x: STOP_X, y: GROUND, face: 1, scale: 1, m: 0, phase: 0, front: true, hop };
  }
  // il s'élance vers la ruelle (de profil), puis s'enfonce de dos dans le passage
  if (t < RN.arrive) {
    const x = lerp(STOP_X, GATE_X, ease.inOutCubic(prog(t, RN.t0, RN.arrive)));
    return { x, y: GROUND, face: 1, scale: 1, m: 1, phase: RN.omega * (t - RN.t0), lean: 0.08 };
  }
  const r = ease.outCubic(prog(t, RN.arrive, RN.recedeEnd));
  return { x: GATE_X, y: lerp(GROUND, GATE_Y, r), scale: lerp(1, 0.22, r), back: true, gait: RN.omega * (t - RN.t0),
    alpha: 1 - prog(t, RN.recedeEnd - 0.35, RN.recedeEnd) };
}

// ---------- le portefeuille ----------
const POCKET = BODY === 'f' ? [222, 752] : [215, 770];
const WL = 46; // largeur à l'écran
const FALL = C['wallet-land'] - C['wallet-slip'];
const P_SLIP = puppetPoint(player(C['wallet-slip']), ...POCKET);
const LAND_X = P_SLIP.x - 70;
function walletOnGround(t) { // position quand il ne suit plus le joueur
  const d = t - C['wallet-slip'];
  if (d < FALL) {
    const u = d / FALL;
    return { x: lerp(P_SLIP.x, LAND_X, u), y: lerp(P_SLIP.y, GROUND - 8, u * u), rot: lerp(-0.35, 2.9, u) };
  }
  const b = d - FALL; // petit rebond
  const hop = b < 0.22 ? Math.sin(Math.PI * b / 0.22) * 16 : 0;
  return { x: LAND_X, y: GROUND - 8 - hop, rot: 3.14 + 0.15 * Math.max(0, kick(b, 4, 0.4)) };
}
function drawWallet(x, y, rot, w = WL) {
  const im = IMG.item_qianbao, h = w * im.height / im.width;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.drawImage(im, -w / 2, -h / 2, w, h);
  ctx.restore();
}

// ---------- le chien ----------
const DW = 330, DH = DW * 259 / 520, MOUTH = 0.43 * DW;
function dog(t) {
  const a = C['dog-enter'], p = C['pickup'], al = C['alley'], g = C['gone'];
  if (t < a || t > g) return null;
  let x, y = DOG_GROUND, s = 1, alpha = 1;
  const pickX = LAND_X - MOUTH;
  if (t < p) x = lerp(-360, pickX, (t - a) / (p - a));
  else if (t < al) x = lerp(pickX, GATE_X - 40, ease.outCubic((t - p) / (al - p)) * 0.85 + 0.15 * (t - p) / (al - p));
  else {
    const r = ease.inOutCubic(prog(t, al, g));
    x = lerp(GATE_X - 40, GATE_X, r); y = lerp(DOG_GROUND, GATE_Y, r); s = lerp(1, 0.18, r);
    alpha = 1 - prog(t, g - 0.3, g);
    return { x, y, s, alpha, back: true, gait: 17.5 * t, feetY: y, full: true, tilt: 0 };
  }
  const gal = 17.5 * t;
  const bob = Math.abs(Math.sin(gal)) * 18 * s;
  const dip = 0.22 * Math.max(0, kick(t - p + 0.08, 3, 0.55));
  return { x, y: y - bob, s, alpha, tilt: 0.07 * Math.sin(gal) + dip, full: t >= p, feetY: y };
}
const DOG_BACK_H = 205;
function drawDog(d) {
  if (d.back) {
    drawBack(IMG.dog_back, d.x, d.y, DOG_BACK_H * d.s, d.gait, d.alpha, 0.06);
    return;
  }
  ctx.save();
  ctx.globalAlpha = d.alpha;
  ctx.translate(d.x, d.y);
  ctx.scale(-d.s, d.s); // l'illustration regarde à gauche : on la retourne
  ctx.rotate(-d.tilt);
  ctx.drawImage(d.full ? IMG.dog : IMG.dog_vide, -DW / 2, -DH, DW, DH);
  ctx.restore();
}

// poussière d'encre soulevée par les pattes
function drawDust(t) {
  const R = rng(7);
  for (let k = 0; k < 40; k++) {
    const ts = C['dog-enter'] + k * 0.045 + R() * 0.02;
    if (ts > C['alley'] + 0.6 || ts > t) { R(); R(); continue; }
    const d = dog(ts); if (!d) { R(); R(); continue; }
    const age = t - ts, life = 0.7;
    if (age > life) { R(); R(); continue; }
    const u = age / life;
    const r = (10 + 30 * ease.outCubic(u)) * d.s * (0.7 + R() * 0.6);
    const ox = (-DW * 0.35 + R() * 40) * d.s;
    ctx.fillStyle = `rgba(140,124,104,${0.16 * (1 - u)})`;
    ctx.beginPath(); ctx.arc(d.x + ox - 30 * u, d.feetY - 6 - 18 * u * d.s, r, 0, 7); ctx.fill();
  }
}

// ---------- moineaux ----------
function drawSparrows(t) {
  const im = IMG.moineaux, cw = im.width / 3, ch = im.height, sc = 1.35;
  const base = [500, 585, 665];
  for (let i = 0; i < 3; i++) {
    let x = base[i], y = GROUND + 58 - (i % 2) * 10, rot = 0, sy = 1;
    const f = t - C['sparrows'] - i * 0.05;
    if (f < 0) rot = 0.18 * Math.max(0, Math.sin(t * 5.3 + i * 2.1)) ** 3; // picorent
    else {
      x -= 260 * f + 40 * i * f; y -= 520 * f + 140 * f * f - i * 20 * f; rot = -0.4;
      sy = 0.55 + 0.45 * Math.abs(Math.sin(f * 34 + i));
      if (y < -80) continue;
    }
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc * sy);
    ctx.drawImage(im, i * cw, 0, cw, ch, -cw / 2, -ch, cw, ch);
    ctx.restore();
  }
}

// ---------- lumière du soir ----------
function lampLevel(t) {
  const on = C['lamp-on'];
  if (t < on) return 0;
  const f = t - on; // grésillement déterministe puis stable
  if (f < 0.5) return [1, 0.2, 0.9, 0.1, 1, 0.5, 1][Math.floor(f / 0.075)] ?? 1;
  return 1;
}
function glow(x, y, r, col, a) {
  if (a <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
}
const LANTERNS = [[1128, 318, 0], [1418, 318, 1.7]];
function drawLanterns(t) {
  for (const [x, y, ph] of LANTERNS) {
    const a = 0.06 * Math.sin(t * 1.4 + ph) + 0.02 * Math.sin(t * 3.1 + ph);
    const im = IMG.lantern, w = 66, h = w * im.height / im.width;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.drawImage(im, -w / 2, 0, w, h); ctx.restore();
  }
}
function grade(t) {
  // passe au crépuscule : multiply bleu-violet, plus sombre en haut
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#5b5f86'); g.addColorStop(0.55, '#8d86a0'); g.addColorStop(1, '#a8968a');
  ctx.fillStyle = g; ctx.fillRect(-200, -200, W + 400, H + 400);
  ctx.globalCompositeOperation = 'screen';
  const L = lampLevel(t);
  glow(1283, 477, 260, '255,190,110', 0.55 * L);
  glow(1253, 640, 180, '255,200,130', 0.35);
  for (const [x, y, r] of [[240, 287, 150], [222, 597, 130], [1641, 612, 140]]) glow(x, y, r, '255,185,105', 0.42 + 0.03 * Math.sin(t * 2 + x));
  for (const [x, y, ph] of LANTERNS) glow(x + 4 * Math.sin(t * 1.4 + ph), y + 95, 120, '255,90,50', 0.5);
  ctx.restore();
}

// ---------- caméra ----------
function camera(t) {
  let z = 1, cx = W / 2, cy = H / 2;
  const o = ease.inOutCubic(prog(t, 0, 2.7));
  z = lerp(1.24, 1.0, o); cx = lerp(1270, W / 2, o); cy = lerp(500, H / 2, o);
  const push = spring(t - C['panel'], 0.9, 1);
  const P = player(Math.min(t, RN.t0));
  z = lerp(z, 1.28, push); cx = lerp(cx, P.x + 120, push); cy = lerp(cy, 760, push);
  const fol = ease.inOutCubic(prog(t, RN.t0, RN.recedeEnd));
  z = lerp(z, 1.45, fol); cx = lerp(cx, GATE_X, fol); cy = lerp(cy, 700, fol);
  // secousse quand le chien happe le portefeuille
  const sh = kick(t - C['pickup'], 7, 0.28);
  // limites : la vue reste dans le décor
  const hw = W / 2 / z, hh = H / 2 / z;
  cx = clamp(cx, hw, W - hw); cy = clamp(cy, hh, H - hh);
  return { z, cx: cx + sh * 10, cy: cy + sh * 6 };
}

// ---------- écran : encarts, sous-titres, transition ----------
function inkRing(x, y, r, seed, width = 14) {
  const R = rng(seed);
  ctx.strokeStyle = INK; ctx.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    ctx.lineWidth = width * (0.35 + R() * 0.8);
    ctx.globalAlpha = 0.55 + R() * 0.4;
    const a0 = R() * 6.28, span = 4.6 + R() * 1.8;
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const a = a0 + span * i / 60, rr = r + (R() - 0.5) * 6 + k * 3;
      i ? ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)) : ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
function drawPanel(t) {
  const a = C['panel'], b = C['say-dog'] + 0.2;
  if (t < a || t > b + 0.5) return;
  const s = spring(t - a, 2.6, 0.62) * (1 - ease.inCubic(prog(t, b, b + 0.4)));
  if (s <= 0.001) return;
  const x = 1500, y = 320, r = 205;
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.rotate(-0.05 + 0.05 * s);
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fillStyle = PAPER; ctx.fill(); ctx.clip();
  const im = IMG.gou_bust, w = 2 * r * 1.15;
  ctx.drawImage(im, -w / 2 - 10, -w / 2 + 8, w, w);
  ctx.restore();
  inkRing(0, 0, r, 31, 16);
  // étiquette 狗 gǒu
  ctx.fillStyle = INK; ctx.textAlign = 'center';
  ctx.font = `700 92px ${CJK}`; ctx.fillStyle = PAPER; ctx.fillText('狗', -r - 70, 40);
  ctx.font = "italic 400 34px 'Fraunces'"; ctx.fillText('gǒu', -r - 70, 88);
  ctx.restore();
}

const LINES = [
  { t: C['say-wallet'], end: C['say-dog'] - 0.1, han: ['我', '的', '钱', '包', '！'], red: [2, 3], py: 'wǒ de qiánbāo !', fr: 'Mon portefeuille !' },
  { t: C['say-dog'], end: 12.85, han: ['狗', '！', '狗', '！'], red: [], py: 'gǒu ! gǒu !', fr: 'Le chien ! Le chien !' },
];
function drawSubtitle(t) {
  for (const L of LINES) {
    if (t < L.t - 0.15 || t > L.end + 0.3) continue;
    const inn = ease.outCubic(prog(t, L.t - 0.15, L.t + 0.15)), out = prog(t, L.end, L.end + 0.3);
    const a = inn * (1 - out);
    const cy = 960 + 30 * (1 - inn);
    ctx.save(); ctx.globalAlpha = a;
    // bande de papier aux bords déchirés
    const R = rng(L.t * 100 | 0), bw = 760, bh = 176, x0 = W / 2 - bw / 2, y0 = cy - 112;
    ctx.beginPath(); ctx.moveTo(x0, y0);
    for (let i = 1; i <= 20; i++) ctx.lineTo(x0 + bw * i / 20, y0 + (R() - 0.5) * 7);
    for (let i = 1; i <= 6; i++) ctx.lineTo(x0 + bw + (R() - 0.5) * 9, y0 + bh * i / 6);
    for (let i = 19; i >= 0; i--) ctx.lineTo(x0 + bw * i / 20, y0 + bh + (R() - 0.5) * 7);
    ctx.closePath(); ctx.fillStyle = 'rgba(239,229,207,0.93)'; ctx.fill();
    // caractères, un par un au rythme de la voix
    ctx.font = `700 70px ${CJK}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const widths = L.han.map((c) => ctx.measureText(c).width), tot = widths.reduce((p, q) => p + q, 0);
    let x = W / 2 - tot / 2;
    L.han.forEach((ch, i) => {
      const k = spring(t - L.t - i * 0.16, 3, 0.6);
      ctx.save(); ctx.globalAlpha = a * clamp(k * 1.5);
      ctx.translate(x + widths[i] / 2, cy - 22); ctx.scale(0.6 + 0.4 * k, 0.6 + 0.4 * k);
      ctx.fillStyle = L.red.includes(i) ? RED : INK; ctx.textAlign = 'center'; ctx.fillText(ch, 0, 0);
      ctx.restore(); x += widths[i];
    });
    ctx.textAlign = 'center'; ctx.fillStyle = '#4b3f33';
    ctx.font = "italic 400 34px 'Fraunces'"; ctx.fillText(L.py, W / 2, cy + 22);
    ctx.font = "400 26px 'FrauncesR'"; ctx.fillStyle = '#7a6a57'; ctx.fillText(L.fr, W / 2, cy + 54);
    ctx.restore();
  }
  // « 汪！ » hors champ, avant que le chien n'entre
  const b = C['bark'];
  if (t > b && t < b + 1.0) {
    const k = spring(t - b, 3.5, 0.5), a = 1 - prog(t, b + 0.7, b + 1.0);
    ctx.save(); ctx.globalAlpha = a; ctx.translate(150, 760); ctx.rotate(-0.12); ctx.scale(k, k);
    ctx.font = `700 120px ${CJK}`; ctx.textAlign = 'center'; ctx.fillStyle = INK; ctx.fillText('汪！', 0, 0);
    ctx.font = "italic 400 34px 'Fraunces'"; ctx.fillStyle = PAPER; ctx.fillText('wāng !', 0, 52);
    ctx.restore();
  }
}

// tache d'encre qui envahit l'image depuis la ruelle
function inkBlot(cx, cy, r, seed, t) {
  const R = rng(seed), n = 90;
  const amps = Array.from({ length: 12 }, (_, j) => [R() * 0.09 / (1 + j * 0.25), R() * 6.28]);
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = i / n * Math.PI * 2;
    let k = 1;
    amps.forEach(([m, ph], j) => { k += m * Math.sin(a * (j + 3) + ph + t * 0.4 * (j % 3 - 1)); });
    const rr = r * k;
    i ? ctx.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a)) : ctx.moveTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
  }
  ctx.fill();
}
function drawInk(t, cam) {
  const a = C['ink'];
  if (t < a) return;
  const sx = (GATE_X - cam.cx) * cam.z + W / 2, sy = (GATE_Y - 40 - cam.cy) * cam.z + H / 2;
  const u = prog(t, a, a + 0.9);
  ctx.fillStyle = INK;
  const r = 2600 * ease.inCubic(u) + 40 * Math.min(1, (t - a) * 6);
  ctx.save(); ctx.filter = 'blur(22px)'; ctx.globalAlpha = 0.55; inkBlot(sx, sy, r * 1.18 + 30, 4, t); ctx.restore();
  ctx.save(); ctx.filter = 'blur(3px)'; inkBlot(sx, sy, r, 5, t); ctx.restore();
  ctx.save(); ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.filter = 'blur(1px)';
  const Rf = rng(13); // fibres du papier qui boivent l'encre
  for (let i = 0; i < 45; i++) {
    const ang = Rf() * 6.28, len = r * (0.06 + Rf() * 0.16), w0 = 1 + Rf() * 3;
    ctx.globalAlpha = 0.5 * Math.min(1, u * 4); ctx.lineWidth = w0;
    ctx.beginPath(); ctx.moveTo(sx + r * 0.9 * Math.cos(ang), sy + r * 0.9 * Math.sin(ang));
    const a2 = ang + (Rf() - 0.5) * 0.25;
    ctx.lineTo(sx + (r * 0.9 + len) * Math.cos(a2), sy + (r * 0.9 + len) * Math.sin(a2)); ctx.stroke();
  }
  ctx.restore();
  const R = rng(9); // éclaboussures autour
  for (let i = 0; i < 14; i++) {
    const ang = R() * 6.28, dist = r * (1.08 + R() * 0.35), rad = 3 + R() * 12 * Math.min(1, u * 3);
    ctx.beginPath(); ctx.arc(sx + dist * Math.cos(ang), sy + dist * Math.sin(ang), rad, 0, 7); ctx.fill();
  }
}

function drawTitle(t) {
  const a = C['ink'] + 0.75;
  if (t < a) return;
  ctx.save();
  const k = ease.outCubic(prog(t, a, a + 0.9));
  ctx.textAlign = 'center';
  ctx.globalAlpha = k; ctx.fillStyle = '#8f7f68';
  ctx.font = "italic 400 34px 'Fraunces'"; ctx.fillText('Chapitre 1', W / 2, 400);
  const chars = ['上', '海', '第', '一', '夜'];
  ctx.font = `700 120px ${CJK}`;
  chars.forEach((c, i) => {
    const q = spring(t - a - 0.12 * i, 1.6, 0.9);
    ctx.save(); ctx.globalAlpha = clamp(q); ctx.translate(W / 2 + (i - 2) * 132, 560 + 30 * (1 - q));
    ctx.fillStyle = PAPER; ctx.fillText(c, 0, 0); ctx.restore();
  });
  const k2 = ease.outCubic(prog(t, a + 0.7, a + 1.4));
  ctx.globalAlpha = k2; ctx.fillStyle = PAPER;
  ctx.font = "italic 400 52px 'Fraunces'"; ctx.fillText('Premier soir à Shanghai', W / 2, 660);
  ctx.font = "italic 400 28px 'Fraunces'"; ctx.fillStyle = '#8f7f68'; ctx.fillText('Shànghǎi dì yī yè', W / 2, 712);
  // sceau rouge 千里
  const s = C['seal'];
  if (t > s) {
    const q = 1 + 0.5 * (1 - spring(t - s, 3.2, 0.7));
    ctx.save(); ctx.globalAlpha = clamp((t - s) * 8); ctx.translate(W / 2 + 420, 512); ctx.scale(q, q); ctx.rotate(0.04);
    ctx.fillStyle = RED; ctx.fillRect(-58, -58, 116, 116);
    ctx.fillStyle = INK; ctx.font = `700 50px ${CJK}`;
    ctx.fillText('千', 0, -6); ctx.fillText('里', 0, 46);
    ctx.restore();
  }
  ctx.restore();
}

function vignette() {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.05);
  g.addColorStop(0, 'rgba(20,15,10,0)'); g.addColorStop(1, 'rgba(20,15,10,0.55)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

// ---------- image t ----------
window.seek = (t) => {
  const cam = camera(t);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
  ctx.setTransform(cam.z, 0, 0, cam.z, W / 2 - cam.cx * cam.z, H / 2 - cam.cy * cam.z);
  ctx.drawImage(IMG.ruelle_far, 0, 0, W, H);
  drawLanterns(t);
  const D = dog(t);
  // le portefeuille : dans la poche, puis au sol, puis dans la gueule
  const inPocket = t < C['wallet-slip'];
  if (!inPocket && t < C['pickup']) { const w = walletOnGround(t); drawWallet(w.x, w.y, w.rot); }
  const P = player(t);
  const D_behind = D && D.s < 0.999;
  if (D_behind) { drawDust(t); drawDog(D); }
  drawPuppet(P, inPocket ? () => drawWallet(POCKET[0], POCKET[1], -0.35, WL / (P.scale * U)) : null);
  drawSparrows(t);
  if (D && !D_behind) { drawDust(t); drawDog(D); }
  grade(t);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  vignette();
  drawPanel(t);
  drawSubtitle(t);
  drawInk(t, cam);
  drawTitle(t);
};
window.filmReady = true;
