# Idée « mélodie de phrase » : des gabarits de ton qui dépendent du contexte (tons voisins, place dans la phrase),
# appris sur les autres voix (validation croisée par voix), comparés aux gabarits simples.
import json, numpy as np, sys
D = json.load(open('contextes.json'))
TONS = ['1', '2', '3', '4']
W = 0.35
def dist(c, t):
    c, t = np.asarray(c), np.asarray(t)
    return float(np.mean(((c - c.mean()) - (t - t.mean())) ** 2) + W * (c.mean() - t.mean()) ** 2)
def oh(v, vals): return [1.0 if v == x else 0.0 for x in vals]
CTX = ['0', '1', '2', '3', '4']
def feats(s, niveau):
    f = [1.0]
    if niveau >= 1: f += [1.0 if s['pos'] == 'fin' else 0.0]
    if niveau >= 2: f += oh(s['prev'], CTX)[1:] + oh(s['next'], CTX)[1:]
    if niveau >= 3: f += [s['rel'], s['rel'] ** 2, min(s['n'], 12) / 12]
    return np.array(f)
def apprendre(train, niveau, lam=3.0):
    mod = {}
    for t in TONS:
        X = np.array([feats(s, niveau) for s in train if s['att'] == t]); Y = np.array([s['c'] for s in train if s['att'] == t])
        mod[t] = np.linalg.solve(X.T @ X + lam * np.eye(X.shape[1]), X.T @ Y)
    return mod
def marge(s, mod, niveau, ref=None):
    d = {t: dist(s['c'], feats(s, niveau) @ mod[t]) for t in TONS}
    da = d[s['att']] if ref is None else ref
    return da - min(v for t, v in d.items() if t != s['att'])
def evaluer(mode, niveau, avec_modele=False):
    res = []
    for g in ['f', 'm', 'pnj']:
        train = [s for s in D if s['ens'] == 'natif' and s['mode'] == mode and s['grp'] != g]
        mod = apprendre(train, niveau)
        for s in D:
            if s['grp'] != g or s['mode'] != mode: continue
            if s['ens'] == 'faux' and not s['change']: continue
            if avec_modele and not s['cm']: continue
            ref = dist(s['c'], s['cm']) if avec_modele else None
            res.append((s['ens'], marge(s, mod, niveau, ref)))
    nat = np.array([m for e, m in res if e == 'natif']); fx = np.array([m for e, m in res if e == 'faux'])
    return nat, fx
def ligne(nom, nat, fx, cible):
    acc0, far0 = (nat < 0).mean(), (fx < 0).mean()
    th = np.quantile(fx, cible); acc = (nat < th).mean()
    print(f'{nom:44s} justes {100*acc0:5.1f}% | faux acceptés {100*far0:5.1f}%  || à {100*cible:.0f}% de faux acceptés : justes {100*acc:5.1f}%')
NOMS = ['gabarits fixes (ton seul)', '+ fin de phrase', '+ tons voisins (mélodie locale)', '+ place dans la phrase (déclinaison)']
for mode in ['seul', 'modele']:
    print('— découpage', mode)
    for niv in range(4):
        nat, fx = evaluer(mode, niv); ligne(NOMS[niv], nat, fx, 0.15)
    for niv in [1, 3]:
        nat, fx = evaluer(mode, niv, True); ligne('voix modèle vs ' + NOMS[niv], nat, fx, 0.15)
