"""Bande-son de la cinématique « le chien vole le portefeuille ». Écrit score.wav et beats.json.

Ambiance du soir (rumeur de ville, grillons), guzheng synthétisé (Karplus-Strong, gamme pentatonique de ré),
bruitages calés sur les mêmes temps que l'image (timeline.json) et les voix du jeu (ElevenLabs, dossier assets).
Lancer : python3 films/chien-voleur/score.py
"""
import json, math, pathlib, subprocess, sys
import numpy as np

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE.parent.parent))
from lib.synth import SR, Mixer, tt, env, noise, sweep_sine, bp, hp, lp, mtof, whoosh, master, seed_for  # noqa: E402


def S(*p):
    return seed_for('chien-voleur', *p)


T = json.loads((HERE / 'timeline.json').read_text())
C = {c['name']: c['t'] for c in T['cues']}
DUR = T['duration']
mx = Mixer(DUR, tail=2.0)
log = {}


def mark(name, t):
    log.setdefault(name, []).append(round(t, 3))


def zheng(m, d=2.2, bright=0.5, seed=None):
    """Corde pincée (Karplus-Strong) + petit glissé vers le haut à l'attaque, comme un guzheng."""
    f = mtof(m)
    n = int(d * SR)
    period = SR / f
    N = int(period)
    rng = np.random.default_rng(seed)
    buf = rng.uniform(-1, 1, N)
    buf = lp(buf, 1500 + 5000 * bright)
    out = np.zeros(n)
    frac = period - N
    decay = 0.996
    prev = 0.0
    for i in range(n):
        j = i % N
        s = buf[j]
        out[i] = s
        nxt = buf[(j + 1) % N]
        v = decay * ((1 - frac) * s + frac * nxt + s) / 2 * 0.998
        buf[j] = 0.5 * v + 0.5 * prev
        prev = v
    out = hp(out, 80)
    out *= np.minimum(1, tt(d) / 0.002)
    return out / (np.abs(out).max() + 1e-9)


PENTA = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86]  # ré pentatonique, de D4


MUSIC = False  # la musique (guzheng, gong, woodblock) est retirée : Manu posera une musique libre de droits
_cache = {}


def note(t, idx, d=2.0, g=0.22, pan=0.0, send=0.35):
    if not MUSIC:
        return
    m = PENTA[idx]
    if m not in _cache:
        _cache[m] = zheng(m, 3.0, seed=S('z', m))
    x = _cache[m][: int(d * SR)].copy()
    x[-2400:] *= np.linspace(1, 0, 2400)
    mx.add(t, x, g, pan, send)
    mark('zheng', t)


def load_voice(name):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(HERE / 'assets' / f'{name}.mp3'), '-f', 'f32le', '-ac', '1',
                          '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(float)


# ---- ambiance ----
amb_d = C['ink'] + 0.8
brown = np.cumsum(noise(amb_d, S('amb')))
brown = hp(brown - np.convolve(brown, np.ones(4800) / 4800, mode='same'), 40)
brown = lp(brown, 500) / (np.abs(brown).max() + 1e-9)
fade = np.minimum(1, tt(amb_d) / 1.2) * np.clip((amb_d - tt(amb_d)) / 0.8, 0, 1)
mx.add(0, brown * fade, 0.22, 0.0)
for k, (f0, pan) in enumerate([(4300, -0.6), (4900, 0.5)]):  # grillons
    t = tt(amb_d)
    chirp = (np.sin(2 * np.pi * 28 * t + k) > 0.6) * (np.sin(2 * np.pi * 0.35 * t + k * 2) > -0.2)
    x = np.sin(2 * np.pi * f0 * t) * lp(chirp.astype(float), 300) * fade
    mx.add(0, x, 0.015, pan)

# ---- la lampe s'allume (grésillement) ----
for i, on in enumerate([1, 0.2, 0.9, 0.1, 1, 0.5, 1]):
    tt0 = C['lamp-on'] + i * 0.075
    if on > 0.6:
        mx.add(tt0, bp(noise(0.012, S('click', i)), 2000, 8000) * env(0.012, 0.0005, 0.003), 0.25, 0.3)
hum_d = 2.4
mx.add(C['lamp-on'], (np.sin(2 * np.pi * 100 * tt(hum_d)) + 0.4 * np.sin(2 * np.pi * 200 * tt(hum_d)))
       * np.minimum(1, tt(hum_d) / 0.4) * np.exp(-tt(hum_d) / 1.2), 0.03, 0.3)

# ---- thème d'ouverture au guzheng ----
for t, i, d in [(0.15, 6, 2.5), (0.75, 5, 2.0), (1.15, 4, 2.0), (1.55, 3, 2.6), (2.35, 1, 1.6), (2.75, 2, 2.4),
                (3.6, 4, 1.8), (4.0, 3, 2.2), (4.9, 5, 1.6)]:
    note(t, i, d, 0.2, -0.2 + 0.1 * i % 0.5)

# ---- pas du joueur ----
WK = T['walk']


def step_sound(t, k, g=0.3):
    d = 0.11
    x = bp(noise(d, S('step', k)), 250, 2200) * env(d, 0.002, 0.025) + 0.5 * sweep_sine(d, 160, 70, 0.02) * env(d, 0.001, 0.03)
    mx.add(t, x, g, -0.1 + 0.2 * (k % 2), 0.1)
    mark('step', t)


k = 1
while True:
    t = WK['t0'] + k * math.pi / WK['omega']
    if t > WK['stop'] - 0.15:
        break
    if t > WK['t0'] + 0.25:
        step_sound(t, k)
    k += 1
RN = T['run']
k = 1
while True:
    t = RN['t0'] + k * math.pi / RN['omega']
    if t > RN['recedeEnd']:
        break
    step_sound(t, 100 + k, 0.3 * max(0.15, 1 - (t - RN['arrive']) / 0.9) if t > RN['arrive'] else 0.32)
    k += 1

# ---- le portefeuille ----
mx.add(C['wallet-slip'], whoosh(0.3, 1200, 5000, up=False, seed=S('slip')), 0.12, -0.3)
thud = 0.35
mx.add(C['wallet-land'], sweep_sine(thud, 180, 90, 0.03) * env(thud, 0.001, 0.05) + 0.6 * bp(noise(thud, S('thud')), 400, 3000) * env(thud, 0.001, 0.02), 0.5, -0.2)
mx.add(C['wallet-land'] + 0.22, bp(noise(0.08, S('tick')), 600, 3000) * env(0.08, 0.001, 0.015), 0.25, -0.2)
mark('thud', C['wallet-land'])
note(C['wallet-land'] + 0.05, 7, 1.8, 0.16, 0.4)  # petite note interrogative
note(C['wallet-land'] + 0.3, 9, 2.0, 0.12, 0.4)

# ---- le chien ----
mx.add(C['bark'], load_voice('p0_01'), 2.0, -0.7)
mark('bark', C['bark'])
gal = 17.5
t = C['dog-enter']
k = 0
while t < C['gone']:
    g = 0.42 if t < C['alley'] else 0.42 * max(0.05, 1 - (t - C['alley']) / (C['gone'] - C['alley']))
    pan = max(-0.9, min(0.9, -0.9 + 1.6 * (t - C['dog-enter']) / (C['alley'] - C['dog-enter'])))
    for off in (0.0, 0.045):
        x = bp(noise(0.06, S('paw', k, off)), 300, 4000) * env(0.06, 0.001, 0.012)
        mx.add(t + off, x, g * (1 if off == 0 else 0.7), pan, 0.05)
    mark('paw', t)
    t += math.pi / gal
    k += 1
mx.add(C['dog-enter'] - 0.15, whoosh(0.5, 200, 3000, seed=S('in')), 0.3, -0.8)
mx.add(C['turn'] - 0.15, whoosh(0.45, 400, 6000, seed=S('turn')), 0.35, 0.3)

# moineaux qui s'envolent
for i in range(3):
    d = 0.7
    am = (np.sin(2 * np.pi * (22 + 3 * i) * tt(d)) > 0).astype(float)
    x = hp(noise(d, S('flut', i)), 1800) * lp(am, 200) * np.exp(-tt(d) / 0.35)
    mx.add(C['sparrows'] + 0.05 * i, x, 0.12, -0.6 + 0.2 * i, 0.2)
    chirp = np.sin(2 * np.pi * np.cumsum(3200 + 900 * np.sin(2 * np.pi * 14 * tt(0.12))) / SR) * env(0.12, 0.003, 0.04)
    mx.add(C['sparrows'] + 0.07 * i + 0.02, chirp, 0.06, -0.6 + 0.2 * i, 0.3)


def drum(t, g=0.8, f0=120, f1=55, name='drum'):
    d = 0.9
    x = sweep_sine(d, f0, f1, 0.06) * env(d, 0.001, 0.22) + 0.6 * sweep_sine(d, 2 * f0, 2 * f1, 0.05) * env(d, 0.001, 0.12)
    x += 0.4 * bp(noise(d, S(name, t)), 200, 2500) * env(d, 0.001, 0.03)
    mx.add(t, x, g, 0, 0.2)
    mark(name, t)


drum(C['pickup'], 0.55)
# poursuite : course de guzheng descendante + woodblock
tick = 60 / 150 / 2
i = 0
t = C['dog-enter']
seq = [10, 9, 8, 7, 9, 8, 7, 6, 8, 7, 6, 5, 7, 6, 5, 4, 6, 5, 4, 3]
while t < C['gone'] - 0.1 and i < len(seq):
    note(t, seq[i], 0.6, 0.11, 0.5 - 0.05 * i, 0.2)
    if MUSIC and i % 2 == 0:
        mx.add(t, bp(noise(0.05, S('wb', i)), 900, 1800) * env(0.05, 0.0005, 0.012) + 0.6 * np.sin(2 * np.pi * 1100 * tt(0.05)) * env(0.05, 0.0005, 0.02), 0.13, -0.4)
    t += tick
    i += 1

# ---- encart + voix du joueur ----
mx.add(C['panel'], 0.7 * np.sin(2 * np.pi * 900 * tt(0.08)) * env(0.08, 0.0005, 0.02) + bp(noise(0.08, S('pop')), 700, 2000) * env(0.08, 0.0005, 0.01), 0.3, 0.6)
note(C['panel'] + 0.02, 3, 2.4, 0.14, 0.6)
mx.add(C['say-wallet'], load_voice(f"p0_02_{T.get('body', 'm')}"), 2.6, 0.0)
mark('say', C['say-wallet'])
mx.add(C['say-dog'], load_voice(f"p0_03_{T.get('body', 'm')}"), 2.6, 0.0)
mark('say', C['say-dog'])
if MUSIC:
    drum(C['say-dog'] + 1.7, 0.45, 100, 50)

# ---- l'encre, le titre, le gong ----
ink = C['ink']
x = whoosh(1.1, 80, 1200, up=True, seed=S('ink')) + 0.6 * sweep_sine(1.1, 50, 90, 0.5) * np.sin(np.pi * tt(1.1) / 1.1)
mx.add(ink - 0.2, x, 0.5, 0, 0.3)
drum(ink + 0.75, 0.45, 90, 42, 'boom')
for j, (tt0, idx) in enumerate([(ink + 0.9, 0), (ink + 1.0, 3), (ink + 1.1, 5), (ink + 1.25, 7)]):
    note(tt0, idx, 3.0, 0.14, -0.3 + 0.2 * j, 0.5)


def gong(t, g=0.5):
    d = 3.0
    tm = tt(d)
    f = 110
    x = np.zeros_like(tm)
    for r, a, dec in [(1, 1, 1.4), (1.52, 0.6, 1.0), (2.04, 0.5, 0.8), (2.76, 0.35, 0.5), (3.3, 0.25, 0.4), (4.2, 0.15, 0.25)]:
        fr = f * r * (1 + 0.012 * np.exp(-tm / 0.4))
        x += a * np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-tm / dec)
    x *= np.minimum(1, tm / 0.004)
    x += 0.3 * bp(noise(d, S('gong')), 300, 3000) * env(d, 0.001, 0.04)
    mx.add(t, x, g, 0, 0.5)
    mark('gong', t)


if MUSIC:
    gong(C['seal'], 0.3)
else:  # le sceau : un simple coup de tampon
    sd = 0.25
    mx.add(C['seal'], sweep_sine(sd, 140, 60, 0.03) * env(sd, 0.001, 0.06) + 0.5 * bp(noise(sd, S('stamp')), 300, 2500) * env(sd, 0.001, 0.015), 0.5, 0, 0.15)
    mark('stamp', C['seal'])

mix = mx.render(rev_time=0.55, rev_gain=0.09, seed=S('rev'))[: int((DUR + 0.0) * SR)]
I, tp = master(mix, HERE / 'score.wav', target=-14.0, fade_out=0.6)
(HERE / 'beats.json').write_text(json.dumps(log, indent=1))
print(f'score.wav: {I:.2f} LUFS, {tp:.2f} dBTP')
