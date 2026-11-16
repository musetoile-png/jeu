"""Bande-son du générique 千里 : goutte d'encre, pinceau calé sur chaque trait (data.json), bourdon, guzheng, sceau.
Lancer : python3 films/titre-qianli/score.py
"""
import json, pathlib, sys
import numpy as np

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE.parent.parent))
from lib.synth import SR, Mixer, tt, env, noise, sweep_sine, bp, hp, lp, mtof, whoosh, master, seed_for  # noqa: E402


def S(*p):
    return seed_for('titre-qianli', *p)


T = json.loads((HERE / 'timeline.json').read_text())
D = json.loads((HERE / 'data.json').read_text())
C = {c['name']: c['t'] for c in T['cues']}
DUR = T['duration']
mx = Mixer(DUR, tail=2.5)
log = {}


def mark(n, t):
    log.setdefault(n, []).append(round(t, 3))


def zheng(m, d=3.0, seed=None):
    f = mtof(m)
    period = SR / f
    N = int(period)
    buf = lp(np.random.default_rng(seed).uniform(-1, 1, N), 4000)
    n = int(d * SR)
    out = np.zeros(n)
    prev = 0.0
    for i in range(n):
        j = i % N
        s = buf[j]
        out[i] = s
        v = 0.997 * (s + buf[(j + 1) % N]) / 2
        buf[j] = 0.5 * v + 0.5 * prev
        prev = v
    out = hp(out, 80) * np.minimum(1, tt(d) / 0.002)
    return out / (np.abs(out).max() + 1e-9)


PENTA = [50, 52, 54, 57, 59, 62, 64, 66, 69, 71, 74, 76, 78, 81]
MUSIC = False  # bourdon, guzheng et gong retirés : place pour une musique libre de droits
_c = {}


def note(t, idx, d=2.5, g=0.18, pan=0.0, send=0.5):
    if not MUSIC:
        return
    m = PENTA[idx]
    if m not in _c:
        _c[m] = zheng(m, 4.0, S('z', m))
    x = _c[m][: int(d * SR)].copy()
    x[-2400:] *= np.linspace(1, 0, 2400)
    mx.add(t, x, g, pan, send)
    mark('zheng', t)


# bourdon (ré + la) qui gonfle doucement
d = DUR
tm = tt(d)
drone = sum(a * np.sin(2 * np.pi * f * tm + ph) for f, a, ph in [(73.4, 1, 0), (73.9, 0.7, 1), (110, 0.6, 2), (146.8, 0.35, 3), (220.3, 0.15, 4)])
drone *= np.minimum(1, tm / 3.0) * np.clip((d - tm) / 1.5, 0, 1) * (0.8 + 0.2 * np.sin(2 * np.pi * 0.15 * tm))
if MUSIC:
    mx.add(0, lp(drone, 900), 0.07, 0, 0.2)

# goutte
a = C['drop']
x = np.sin(2 * np.pi * np.cumsum(600 + 900 * (1 - np.exp(-tt(0.18) / 0.03))) / SR) * env(0.18, 0.001, 0.05)
mx.add(a, x, 0.28, -0.2, 0.9)
mark('drop', a)
note(a + 0.05, 7, 3.5, 0.12, -0.3)

# pinceau : un frottement par trait, plus appuyé pour le titre
for s in D['schedule']:
    dur = s['t1'] - s['t0']
    big = s['group'] == 'title'
    n = dur + (0.12 if big else 0.04)
    u = tt(n) / n
    shape = np.minimum(1, tt(n) / 0.02) * (1 - u) ** 0.6 * (0.7 + 0.3 * np.sin(np.pi * u))
    x = bp(noise(n, S('brush', s['c'], s['i'], s['group'])), 900, 5000) * shape
    x += 0.35 * lp(noise(n, S('paper', s['c'], s['i'])), 400) * shape
    mx.add(s['t0'], x, 0.16 if big else 0.07, 0.2 if big else 0.6, 0.15)
    mark('brush', s['t0'])

# guzheng : une note posée au début de chaque caractère du titre, phrase qui monte
for i, c in enumerate(['千', '里']):
    t0 = next(s['t0'] for s in D['schedule'] if s['group'] == 'title' and s['c'] == c)
    note(t0, 8 + i * 2, 3.0, 0.16, -0.3 + 0.6 * i)
    note(t0 + 0.42, 5 + i, 2.6, 0.1, -0.1)

# le sceau
t = D['seal']
dd = 0.9
x = sweep_sine(dd, 110, 48, 0.05) * env(dd, 0.001, 0.25) + 0.5 * sweep_sine(dd, 220, 96, 0.04) * env(dd, 0.001, 0.12)
x += 0.5 * bp(noise(dd, S('seal')), 300, 2500) * env(dd, 0.001, 0.02)
mx.add(t, x, 0.55, 0, 0.3)
mark('seal', t)
gd = 4.0
gm = tt(gd)
g = sum(a * np.sin(2 * np.pi * np.cumsum(110 * r * (1 + 0.01 * np.exp(-gm / 0.5))) / SR) * np.exp(-gm / dec)
        for r, a, dec in [(1, 1, 1.8), (1.52, 0.55, 1.2), (2.04, 0.45, 0.9), (2.76, 0.3, 0.6), (3.3, 0.2, 0.4)])
if MUSIC:
    mx.add(t + 0.02, g * np.minimum(1, gm / 0.005), 0.22, 0, 0.6)

# proverbe : petites notes qui tombent avec chaque caractère
prov = [s for s in D['schedule'] if s['group'] == 'proverb' and s['i'] == 0]
for k, s in enumerate(prov):
    note(s['t0'], [12, 11, 10, 8, 9, 7, 6, 5][k], 1.6, 0.07, 0.6, 0.6)

# « Mille li »
L = C['latin']
mx.add(L - 0.5, whoosh(0.7, 300, 2500, seed=S('lat')), 0.08, 0, 0.4)
for k, idx in enumerate([5, 7, 8, 10, 12]):
    note(L + 0.09 * k, idx, 3.0, 0.12, -0.4 + 0.2 * k, 0.7)
note(L + 0.9, 3, 3.0, 0.1, 0, 0.7)

mix = mx.render(rev_time=0.9, rev_gain=0.12, seed=S('rev'))[: int(DUR * SR)]
I, tp = master(mix, HERE / 'score.wav', target=-20.0, fade_out=1.2)
(HERE / 'beats.json').write_text(json.dumps(log, indent=1))
print(f'score.wav: {I:.2f} LUFS, {tp:.2f} dBTP')
