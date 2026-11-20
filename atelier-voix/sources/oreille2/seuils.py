# « Le droit de dire je ne sais pas » : pour la tête v2 (frontières MFA), part des fautes signalées et fiabilité des signalements
# selon la tolérance (part des tons justes acceptés), seuils réglés sur l'entraînement uniquement. python3 seuils.py <pli>
import sys, json, numpy as np, torch
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.model_selection import GroupKFold
from commun import Oreille, ompal, sorties, marge as marge_de, SUF
PLI = int(sys.argv[1]); torch.set_num_threads(2)
D = ompal(PLI); M = D['M']; att, pos, juste, app, te, loc = D['att'], D['pos'], D['juste'], D['app'], D['test'], D['loc']; tr = ~te
m = Oreille(); m.load_state_dict(torch.load(f'/home/claude/aishell/oreille2-ompal{SUF}-pli{PLI}.pt', map_location='cpu'))
_, P = sorties(m, D['X'], pos); A = np.eye(4)[att]; mg = marge_de(P, att)
dur = np.array([x['dur'] for x in M]); ids = np.array([x['id'] for x in M]); kk = np.array([x['k'] for x in M]); n = np.array([x['n'] for x in M])
vit = {i: dur[ids == i].mean() for i in set(ids)}; vit = np.array([vit[i] for i in ids])
X = np.c_[P, A, P * A, mg, pos, dur, dur / vit, vit, kk / n]
mk = lambda: HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05, max_leaf_nodes=15, class_weight='balanced', random_state=0)
itr = np.where(tr)[0]; oof = np.zeros(len(M))
for a, b in GroupKFold(5).split(itr, groups=loc[itr]): oof[itr[b]] = mk().fit(X[itr[a]], juste[itr[a]]).predict_proba(X[itr[b]])[:, 1]
s = mk().fit(X[itr], juste[itr]).predict_proba(X)[:, 1]
T = te & app; J, F = T & juste, T & ~juste; out = dict(pli=PLI)
for cible in (0.80, 0.90, 0.95, 0.975, 0.99):
    seuil = np.quantile(oof[tr & app & juste], 1 - cible); sig = T & (s <= seuil)
    out[str(cible)] = dict(justes=100 * (s[J] > seuil).mean(), faux=100 * (s[F] <= seuil).mean(), fiabilite=100 * (~juste[sig]).mean() if sig.any() else float('nan'), signales=int(sig.sum()))
print(json.dumps(out)); open(f'/home/claude/aishell/resultats-seuils{SUF}.jsonl', 'a').write(json.dumps(out) + '\n')
