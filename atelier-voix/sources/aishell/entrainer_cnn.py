# Petit réseau convolutif qui « écoute » l'image du son de chaque syllabe (40 bandes + hauteur + voisement + volume, 60 pas de 10 ms).
# Entraîné sur 120 voix AISHELL, testé sur 30 voix jamais entendues, puis sur les voix du jeu (bons tons / faux tons greffés).
import glob, json, sys, time, numpy as np, torch, torch.nn as nn
torch.manual_seed(0); np.random.seed(0); torch.set_num_threads(2)
fich = sorted(glob.glob('/home/claude/ecoute/aishell/S*.npz'))
locs = sorted(f.split('/')[-1][:-4] for f in fich); rng = np.random.RandomState(0); rng.shuffle(locs)
test_locs = set(locs[:max(1, len(locs) // 5)])
Xtr, ytr, ptr, Xte, yte, pte = [], [], [], [], [], []
for f in fich:
    z = np.load(f); M = [json.loads(m) for m in z['meta']]
    keep = np.array([m['att'] in (1, 2, 3, 4) for m in M])
    X = z['X'][keep]; y = np.array([m['att'] - 1 for m, k in zip(M, keep) if k]); p = np.array([m['pos'] == 'fin' for m, k in zip(M, keep) if k], dtype=np.float32)
    (Xte if f.split('/')[-1][:-4] in test_locs else Xtr).append(X); (yte if f.split('/')[-1][:-4] in test_locs else ytr).append(y); (pte if f.split('/')[-1][:-4] in test_locs else ptr).append(p)
Xtr, ytr, ptr = np.concatenate(Xtr), np.concatenate(ytr), np.concatenate(ptr); Xte, yte, pte = np.concatenate(Xte), np.concatenate(yte), np.concatenate(pte)
print(f'entraînement {len(Xtr)} syllabes ({len(locs) - len(test_locs)} voix), test {len(Xte)} ({len(test_locs)} voix)', flush=True)
class Oreille(nn.Module):
    def __init__(s, c=43):
        super().__init__()
        bl = lambda i, o, k: nn.Sequential(nn.Conv1d(i, o, k, padding=k // 2), nn.BatchNorm1d(o), nn.ReLU())
        s.f = nn.Sequential(bl(c, 64, 5), bl(64, 64, 5), nn.MaxPool1d(2), bl(64, 128, 3), bl(128, 128, 3), nn.Dropout(0.2))
        s.t = nn.Sequential(nn.Linear(256 + 1, 64), nn.ReLU(), nn.Dropout(0.2), nn.Linear(64, 4))
    def forward(s, x, p):
        h = s.f(x); h = torch.cat([h.mean(2), h[:, :, 7:23].amax(2), p[:, None]], 1)   # moyenne sur tout + maximum sur la syllabe elle-même
        return s.t(h)
m = Oreille(); opt = torch.optim.AdamW(m.parameters(), 1e-3, weight_decay=1e-4)
EP = int(sys.argv[1]) if len(sys.argv) > 1 else 8
sched = torch.optim.lr_scheduler.OneCycleLR(opt, 3e-3, total_steps=EP * (len(Xtr) // 256 + 1))
def proba(X, p, bs=2048):
    m.eval(); out = []
    with torch.no_grad():
        for i in range(0, len(X), bs): out.append(torch.softmax(m(torch.from_numpy(X[i:i + bs].astype(np.float32)), torch.from_numpy(p[i:i + bs])), 1).numpy())
    return np.concatenate(out)
for ep in range(EP):
    m.train(); perm = np.random.permutation(len(Xtr)); t0 = time.time(); tot = 0
    for i in range(0, len(perm), 256):
        b = perm[i:i + 256]; x = torch.from_numpy(Xtr[b].astype(np.float32))
        if True:  # masque de quelques bandes de fréquence (robustesse au micro)
            j = np.random.randint(0, 36); x[:, j:j + np.random.randint(0, 5)] = 0
        loss = nn.functional.cross_entropy(m(x, torch.from_numpy(ptr[b])), torch.from_numpy(ytr[b]), label_smoothing=0.05)
        opt.zero_grad(); loss.backward(); opt.step(); sched.step(); tot += loss.item() * len(b)
    P = proba(Xte, pte); acc = (P.argmax(1) == yte).mean(); accf = (P.argmax(1) == yte)[pte == 1].mean()
    print(f'époque {ep + 1}: perte {tot / len(Xtr):.3f}, voix jamais entendues {100 * acc:.1f}% (fin de phrase {100 * accf:.1f}%), {time.time() - t0:.0f} s', flush=True)
torch.save(m.state_dict(), '/home/claude/ecoute/oreille.pt')
# --- voix du jeu ---
z = np.load('/home/claude/ecoute/jeu/jeu.npz'); M = [json.loads(x) for x in z['meta']]; X = z['X']
keep = np.array([mm['att'] in (1, 2, 3, 4) for mm in M]); X = X[keep]; M = [mm for mm, k in zip(M, keep) if k]
P = proba(X, np.array([mm['pos'] == 'fin' for mm in M], dtype=np.float32))
att = np.array([mm['att'] - 1 for mm in M])
marge = np.log(P[np.arange(len(P)), att] + 1e-9) - np.log(np.max(np.where(np.eye(4)[att] == 1, 0, P), 1) + 1e-9)
for mode in ['seul', 'modele']:
    for pos in ['tout', 'mil', 'fin']:
        sel = lambda mm: mm['mode'] == mode and (pos == 'tout' or mm['pos'] == pos)
        nat = np.array([mm['ens'] == 'natif' and sel(mm) for mm in M]); fx = np.array([mm['ens'] == 'faux' and mm['change'] and sel(mm) for mm in M])
        intact = np.array([mm['ens'] == 'faux' and not mm['change'] and sel(mm) for mm in M])
        vn = np.array([mm['verdict'] == 'juste' for mm in M])
        rn, rf = vn[nat].mean(), vn[fx].mean()
        th = np.quantile(marge[fx], 1 - rf)
        l = f'{mode:6s} {pos:4s} module {100 * rn:5.1f}% / {100 * rf:4.1f}% | oreille seule : {100 * (marge[nat] > 0).mean():5.1f}% / {100 * (marge[fx] > 0).mean():4.1f}%'
        l += f' ; à exigence égale {100 * (marge[nat] > th).mean():5.1f}% | syllabes intactes resynthétisées {100 * (marge[intact] > 0).mean():5.1f}%'
        for t in [-2.0, -1.0]:
            l += f' | module ET oreille>{t:+.0f} : {100 * (vn[nat] & (marge[nat] > t)).mean():5.1f}% / {100 * (vn[fx] & (marge[fx] > t)).mean():4.1f}%'
        print(l, flush=True)
