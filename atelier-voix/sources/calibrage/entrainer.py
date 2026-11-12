# Entraîne un petit réseau de neurones (26 traits -> 32 neurones -> 4 tons) et le valide voix par voix.
import json, numpy as np, sys
L = json.load(open(sys.argv[2] if len(sys.argv) > 2 else 'traits.json'))
X = np.array([l['traits'] for l in L], dtype=np.float64)
COLS = [int(c) for c in (sys.argv[1] if len(sys.argv) > 1 else ','.join(map(str, range(16)))).split(',')]
X = X[:, COLS]
y = np.array([l['reel'] - 1 for l in L])
att = np.array([l['attendu'] - 1 for l in L])
ens = np.array([l['ens'] for l in L]); grp = np.array([l['grp'] for l in L]); mode = np.array([l['mode'] for l in L])
chg = np.array([l['change'] for l in L]); regles = np.array([l['regles'] for l in L])

def entrainer(Xt, yt, H=32, epoques=400, lam=1e-3, graine=0):
    rng = np.random.default_rng(graine)
    mu, sd = Xt.mean(0), Xt.std(0) + 1e-6
    Z = (Xt - mu) / sd
    D = Z.shape[1]
    W1 = rng.normal(0, np.sqrt(2 / D), (H, D)); b1 = np.zeros(H)
    W2 = rng.normal(0, np.sqrt(2 / H), (4, H)); b2 = np.zeros(4)
    P = [W1, b1, W2, b2]; m = [np.zeros_like(p) for p in P]; v = [np.zeros_like(p) for p in P]
    Y = np.eye(4)[yt]; n = len(Z); lr = 3e-3
    for ep in range(epoques):
        idx = rng.permutation(n)
        for s in range(0, n, 128):
            b = idx[s:s + 128]; z = Z[b]
            h = np.maximum(0, z @ W1.T + b1); o = h @ W2.T + b2
            o -= o.max(1, keepdims=True); e = np.exp(o); pr = e / e.sum(1, keepdims=True)
            g2 = (pr - Y[b]) / len(b)
            gW2 = g2.T @ h + lam * W2; gb2 = g2.sum(0)
            gh = g2 @ W2; gh[h <= 0] = 0
            gW1 = gh.T @ z + lam * W1; gb1 = gh.sum(0)
            for i, g in enumerate([gW1, gb1, gW2, gb2]):
                m[i] = 0.9 * m[i] + 0.1 * g; v[i] = 0.999 * v[i] + 0.001 * g * g
                P[i] -= lr * (m[i] / (1 - 0.9 ** (ep + 1))) / (np.sqrt(v[i] / (1 - 0.999 ** (ep + 1))) + 1e-8)
    return {'moyenne': mu, 'ecart': sd, 'W1': P[0], 'b1': P[1], 'W2': P[2], 'b2': P[3]}

def proba(cl, Xs):
    z = (Xs - cl['moyenne']) / cl['ecart']
    h = np.maximum(0, z @ cl['W1'].T + cl['b1']); o = h @ cl['W2'].T + cl['b2']
    o -= o.max(1, keepdims=True); e = np.exp(o); return e / e.sum(1, keepdims=True)

def rapport(masque, pr, nom):
    pred = pr.argmax(1)
    nat = masque & (ens == 'natif'); res = masque & (ens == 'resyn'); fx = masque & (ens == 'faux') & chg
    def taux(sel, cond): return 100 * cond[sel].mean() if sel.sum() else float('nan')
    print(f"{nom:22s} natifs justes {taux(nat, pred == att):5.1f}% (règles {taux(nat, regles == 'juste'):5.1f}%) | "
          f"resynth. justes {taux(res, pred == att):5.1f}% (règles {taux(res, regles == 'juste'):5.1f}%) | "
          f"faux tons acceptés {taux(fx, pred == att):5.1f}% (règles {taux(fx, regles == 'juste'):5.1f}%)")

print('Validation voix par voix (le réseau n\'a jamais entendu la voix testée) :')
tous = np.zeros((len(L), 4))
for g in ['f', 'm', 'pnj']:
    entr = (grp != g) & np.isin(ens, ['natif', 'resyn'])
    cl = entrainer(X[entr], y[entr])
    test = grp == g
    pr = proba(cl, X[test]); tous[test] = pr
    rapport(test, proba(cl, X), 'voix testée : ' + g)
rapport(np.ones(len(L), bool), tous, 'ensemble')
for m_ in ['seul', 'modele']:
    rapport(mode == m_, tous, 'mode ' + m_)

# Seuil « presque » : part des faux tons classés presque selon le seuil
fx = (ens == 'faux') & chg; nat = ens == 'natif'
pa = tous[np.arange(len(L)), att]; pred = tous.argmax(1)
for t in [0.15, 0.25, 0.35]:
    print(f"seuil presque {t}: natifs presque {100*((pred!=att)&(pa>=t))[nat].mean():.1f}% | faux tons presque {100*((pred!=att)&(pa>=t))[fx].mean():.1f}%")

# Modèle final, appris sur toutes les voix
cl = entrainer(X[np.isin(ens, ['natif', 'resyn'])], y[np.isin(ens, ['natif', 'resyn'])])
json.dump({**{k: (v.round(5).tolist()) for k, v in cl.items()}, 'colonnes': COLS}, open('classifieur.json', 'w'))
print('modèle final enregistré :', sum(np.size(v) for v in cl.values()), 'nombres')

# À exigence égale : exiger une probabilité minimale pour le ton attendu
print('Réseau, en exigeant p(ton attendu) >= θ :')
for m_ in ['seul', 'modele']:
    nat_m = (ens == 'natif') & (mode == m_); fx_m = (ens == 'faux') & chg & (mode == m_)
    print('  mode', m_, ' | règles : natifs', f"{100*(regles[nat_m]=='juste').mean():.1f}%", 'faux', f"{100*(regles[fx_m]=='juste').mean():.1f}%")
    for th in [0.4, 0.5, 0.6, 0.7]:
        print(f"    θ={th}: natifs acceptés {100*(pa[nat_m]>=th).mean():.1f}% | faux tons acceptés {100*(pa[fx_m]>=th).mean():.1f}%")
