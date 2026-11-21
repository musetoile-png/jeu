"""Bruitages discrets du teaser : goutte d'encre, pinceau (un frottement par trait), rouleau qui se déroule,
papier qui se déchire, sceau du générique. Écrit audio/sfx.wav (48 kHz stéréo), mixé ensuite par mix.py."""
import json, math, sys, pathlib
import numpy as np, soundfile as sf
HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE.parent.parent / 'lib'))
from synth import SR, tt, env, noise, seed_for as S, bp, lp, hp

T = json.loads((HERE / 'timeline.json').read_text())
D = json.loads((HERE / 'data.json').read_text())
G = json.loads((HERE.parent / 'titre-qianli' / 'data.json').read_text())
N = int(T['duration'] * SR)
L = np.zeros(N); R = np.zeros(N)

def add(t, x, g, pan=0.0):
    i = int(t * SR); x = x[: max(0, N - i)] * g
    L[i:i + len(x)] += x * math.sqrt((1 - pan) / 2); R[i:i + len(x)] += x * math.sqrt((1 + pan) / 2)

mlen = lambda m: sum(math.hypot(m[k][0] - m[k - 1][0], m[k][1] - m[k - 1][1]) for k in range(1, len(m)))
def schedule(chars, t0, speed, gap, cgap, data=D):
    t, out = t0, []
    for c in chars:
        for i, m in enumerate(data['chars'][c]['medians']):
            d = max(0.05, mlen(m) / speed); out.append((c, i, t, t + d)); t += d + gap
        t += cgap
    return out

def brush(c, i, t0, t1, g, pan):
    n = (t1 - t0) + 0.1; u = tt(n) / n
    shape = np.minimum(1, tt(n) / 0.02) * (1 - u) ** 0.6 * (0.7 + 0.3 * np.sin(np.pi * u))
    x = bp(noise(n, S('brush', c, i, t0)), 900, 5000) * shape + 0.35 * lp(noise(n, S('paper', c, i, t0)), 400) * shape
    add(t0, x, g, pan)

# P1 : la goutte, puis la signature 林月
x = np.sin(2 * np.pi * np.cumsum(600 + 900 * (1 - np.exp(-tt(0.18) / 0.03))) / SR) * env(0.18, 0.001, 0.05)
add(0.4, x, 0.16)
for c, i, a, b in schedule('林月', 0.9, 2100, 0.05, 0.15): brush(c, i, a, b, 0.035, 0.1)

# P2 : le rouleau se déroule, puis se déchire
n = 1.5; u = tt(n) / n
add(6.0, lp(noise(n, S('unroll')), 700) * np.sin(np.pi * u) ** 0.8 * (0.8 + 0.2 * np.sin(40 * u)), 0.05, -0.4)
for k, t in enumerate([9.38, 9.52, 9.7, 9.86]):
    n = 0.55; u = tt(n) / n
    crack = (np.abs(noise(n, S('crack', k))) > 2.2) * noise(n, S('crackv', k))
    x = (hp(noise(n, S('tear', k)), 1800) * 0.6 + bp(crack, 1500, 7000)) * np.minimum(1, tt(n) / 0.01) * (1 - u) ** 1.5
    add(t, x, 0.03, -0.6 + 0.4 * k)

# P5 : les noms des villes s'écrivent
for k, c in enumerate(['上海', '杭州', '南京', '开封', '北京', '西安', '洛阳', '安阳']):
    for ch, i, a, b in schedule(c, 27.1 + k * 0.95 + 0.05, 3800, 0.012, 0.03): brush(ch, i, a, b, 0.013, -0.5 + k / 7)

# P7 : le générique (de 4 s à 14 s, posé à 46 s) : traits du titre et du proverbe, puis le sceau
off = 46 - 4.0
for s in G['schedule']:
    if s['t1'] <= 4.0: continue
    big = s['group'] == 'title'
    a = max(s['t0'], 4.0) + off
    brush(s['c'], s['i'], a, s['t1'] + off, 0.03 if big else 0.012, 0.1 if big else 0.6)
dd = 0.5; x = bp(noise(dd, S('seal')), 200, 1800) * env(dd, 0.001, 0.03) + 0.6 * lp(noise(dd, S('seal2')), 180) * env(dd, 0.001, 0.06)
add(G['seal'] + off, x, 0.12)

sf.write(HERE / 'audio/sfx.wav', np.stack([L, R], 1).astype(np.float32), SR)
print('sfx peak', float(np.max(np.abs(np.stack([L, R])))))
