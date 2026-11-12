# Fabrique des enregistrements natifs où certaines syllabes reçoivent un autre ton (resynthèse WORLD).
# Pour chaque enregistrement : une version « faux tons » et une version resynthétisée sans changement (contrôle).
import json, random, numpy as np, pyworld as pw
from concurrent.futures import ProcessPoolExecutor
SR, HOP, W = 16000, 160, 400
gab = json.load(open('gabarits.json'))
def interp5(c, n):
    return np.interp(np.linspace(0, 4, n), np.arange(5), c)
def traiter(item):
    rnd = random.Random(item['pcm'])
    x = np.fromfile(item['pcm'], dtype=np.float32).astype(np.float64)
    f0, t = pw.dio(x, SR, f0_floor=60, f0_ceil=450, frame_period=10)
    f0 = pw.stonemask(x, f0, t, SR)
    sp = pw.cheaptrick(x, f0, t, SR)
    ap = pw.d4c(x, f0, t, SR)
    voix = f0 > 0
    if voix.sum() < 10: return None
    med = np.median(f0[voix])
    f0n = f0.copy()
    changes = []
    cand = [k for k, s in enumerate(item['syl']) if s['surface'] != '5']
    rnd.shuffle(cand)
    nb = max(1, len(cand) // 2)
    for k in cand[:nb]:
        s = item['syl'][k]
        base = '3' if s['surface'] == '3b' else s['surface']
        autres = [c for c in ['1', '2', '3', '4'] if c != base]
        faux = rnd.choice(autres)
        g = gab[s['pos']][faux]
        # trames moteur -> temps -> trames WORLD (10 ms)
        t0 = (item['bornes'][k] * HOP + W / 2) / SR
        t1 = (item['bornes'][k + 1] * HOP + W / 2) / SR
        idx = np.where((t >= t0) & (t < t1) & voix)[0]
        if len(idx) < 5: continue
        lo, hi = idx[0], idx[-1]
        cible = med * 2 ** (interp5(g, hi - lo + 1) / 12)
        seg = f0n[lo:hi + 1]
        msk = seg > 0
        seg[msk] = cible[msk]
        changes.append({'k': k, 'faux': faux})
    if not changes: return None
    y = pw.synthesize(f0n, sp, ap, SR, frame_period=10).astype(np.float32)
    y0 = pw.synthesize(f0, sp, ap, SR, frame_period=10).astype(np.float32)
    nom = item['pcm'].split('/')[-1].replace('.f32', '')
    y.tofile('faux/' + nom + '_faux.f32'); y0.tofile('faux/' + nom + '_resyn.f32')
    return {'pcm': item['pcm'], 'faux': 'faux/' + nom + '_faux.f32', 'resyn': 'faux/' + nom + '_resyn.f32', 'changes': changes}
items = json.load(open('bornes.json'))
with ProcessPoolExecutor() as ex:
    res = [r for r in ex.map(traiter, items) if r]
json.dump(res, open('faux.json', 'w'))
print(len(res), 'enregistrements fabriqués,', sum(len(r['changes']) for r in res), 'syllabes au ton changé')
