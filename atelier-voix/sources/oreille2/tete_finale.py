# Juge final pour l'atelier : oreille réentraînée sur OMPAL (oreille2-ompal-final.pt) + tête « petits indices »,
# apprise sur tout OMPAL. Seuil réglé (par validation croisée, voix par voix) pour accepter 90 % des tons justes.
import json, numpy as np, torch, pickle
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.model_selection import GroupKFold
from commun import Oreille, ompal, sorties, marge as marge_de, CIBLE, SUF
torch.set_num_threads(2)
D = ompal(0); M = D['M']
m = Oreille(); m.load_state_dict(torch.load(f'/home/claude/aishell/oreille2-ompal{SUF}-final.pt', map_location='cpu'))
H, P = sorties(m, D['X'], D['pos'])
def indices(P, att, pos, dur, ids, k, n):
    A = np.eye(4)[att]; mg = marge_de(P, att)
    vit = {i: dur[ids == i].mean() for i in set(ids)}; vit = np.array([vit[i] for i in ids])
    return np.c_[P, A, P * A, mg, pos, dur, dur / vit, vit, k / n]
dur = np.array([x['dur'] for x in M]); ids = np.array([x['id'] for x in M]); k = np.array([x['k'] for x in M]); n = np.array([x['n'] for x in M])
X = indices(P, D['att'], D['pos'], dur, ids, k, n); y = D['juste']
mk = lambda: HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05, max_leaf_nodes=15, class_weight='balanced', random_state=0)
oof = np.zeros(len(y))
for a, b in GroupKFold(5).split(X, groups=D['loc']): oof[b] = mk().fit(X[a], y[a]).predict_proba(X[b])[:, 1]
seuil = float(np.quantile(oof[D['app'] & y], 1 - CIBLE))
J, F = D['app'] & y, D['app'] & ~y
print(f'validation croisée voix par voix : justes acceptés {100 * (oof[J] > seuil).mean():.1f} %, faux détectés {100 * (oof[F] <= seuil).mean():.1f} %')
tete = mk().fit(X, y)
pickle.dump({'tete': tete, 'seuil': seuil, 'indices': 'P(4), ton attendu(4), P*attendu(4), marge, fin de phrase, durée, durée/durée moyenne de la phrase, durée moyenne, rang/longueur'}, open(f'/home/claude/aishell/tete-finale{SUF}.pkl', 'wb'))
print('seuil', seuil)
