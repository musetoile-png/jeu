# Construit, pour chaque syllabe, l'« image du son » : 40 bandes de fréquence + hauteur + voisement + volume,
# toutes les 10 ms, sur la syllabe (ramenée à 30 pas) encadrée de 15 pas avant et 15 pas après.
import sys, json, wave, numpy as np
SR, HOP, WIN, NB = 16000, 160, 400, 40
AV, SY, AP = 15, 30, 15
def melbank():
    hz = lambda m: 700 * (10 ** (m / 2595) - 1); mel = lambda h: 2595 * np.log10(1 + h / 700)
    pts = hz(np.linspace(mel(60), mel(7600), NB + 2)); bins = np.floor((512 + 1) * pts / SR).astype(int)
    F = np.zeros((NB, 257))
    for i in range(NB):
        a, b, c = bins[i], bins[i + 1], bins[i + 2]
        F[i, a:b] = (np.arange(a, b) - a) / max(1, b - a); F[i, b:c] = (c - np.arange(b, c)) / max(1, c - b)
    return F
FB, FEN = melbank(), np.hanning(WIN)
def lire(f):
    if f.endswith('.f32'): return np.fromfile(f, dtype=np.float32)
    with wave.open(f) as w: return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
def logmel(x):
    n = max(1, 1 + (len(x) - WIN) // HOP)
    idx = np.arange(WIN)[None, :] + HOP * np.arange(n)[:, None]
    fr = np.pad(x, (0, WIN))[idx] * FEN
    P = np.abs(np.fft.rfft(fr, 512)) ** 2
    return np.log(P @ FB.T + 1e-8)                        # n x 40
def interp(M, a, b, n):                                    # ramène les pas [a, b) à n pas
    if b - a < 1: b = a + 1
    pos = np.linspace(a, b - 1, n); i0 = np.clip(np.floor(pos).astype(int), 0, len(M) - 1); i1 = np.clip(i0 + 1, 0, len(M) - 1); w = (pos - np.floor(pos))[:, None]
    return M[i0] * (1 - w) + M[i1] * w
def bloc(M, a, b):                                         # pas [a, b), complétés par des zéros hors bornes
    out = np.zeros((b - a, M.shape[1]), dtype=M.dtype)
    lo, hi = max(a, 0), min(b, len(M))
    if hi > lo: out[lo - a:hi - a] = M[lo:hi]
    return out
def traiter(rec):
    x = lire(rec['audio']); L = logmel(x); n = len(L)
    L = (L - L.mean(0)) / (L.std() + 1e-6)                 # normalisation par enregistrement
    st = np.zeros(n); vx = np.zeros(n); db = np.full(n, -80.0)
    i0 = int(round((rec['t0'] * SR - WIN / 2) / HOP))
    for j, (s, d) in enumerate(zip(rec['st'], rec['db'])):
        i = i0 + j
        if 0 <= i < n:
            db[i] = d
            if s is not None: st[i] = s; vx[i] = 1
    db = (db - db.max()) / 20
    M = np.concatenate([L, st[:, None] / 6, vx[:, None], db[:, None]], 1).astype(np.float32)   # n x 43
    res = []
    for s in rec['syll']:
        d = int(round((s['debut'] * SR - WIN / 2) / HOP)); f = int(round((s['fin'] * SR - WIN / 2) / HOP)) + 1
        img = np.concatenate([bloc(M, d - AV, d), interp(M, max(0, d), min(n, max(f, d + 1)), SY), bloc(M, f, f + AP)], 0)  # 60 x 43
        res.append(img.T.astype(np.float16))
    return res
if __name__ == '__main__':
    entree, sortie = sys.argv[1], sys.argv[2]
    X, meta = [], []
    for ligne in open(entree):
        rec = json.loads(ligne)
        try: imgs = traiter(rec)
        except Exception as e: print('erreur', rec['id'], e); continue
        for s, img in zip(rec['syll'], imgs):
            if s['att'] == 5: continue
            X.append(img); meta.append({k: rec.get(k) for k in ('id', 'loc', 'sexe', 'grp', 'ens', 'mode')} | {k: s[k] for k in ('k', 'p', 'att', 'reel', 'change', 'pos', 'verdict')} | {'dur': s['fin'] - s['debut'], 'n': len(rec['syll'])})
    np.savez_compressed(sortie, X=np.stack(X), meta=np.array([json.dumps(m, ensure_ascii=False) for m in meta]))
    print(sortie, len(X), 'syllabes')
