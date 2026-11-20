# Pistes 1 et 2 (20 novembre 2026) sur la tête de jugement de l'oreille v2 (oreille réajustée sur OMPAL, pli par pli).
#  Piste 1 « par rapport à sa propre voix » : on compare chaque syllabe aux habitudes du même élève
#          (son registre, sa courbe moyenne pour chaque ton), sans utiliser aucune étiquette des professeurs.
#  Piste 2 « les 3 votes » : au lieu de la majorité, on apprend avec la part de professeurs qui ont dit « juste » (0, 1/3, 2/3, 1).
# Évaluation inchangée : 5 plis officiels, seuil réglé sur l'entraînement pour accepter 90 % des tons justes (majorité),
# et en plus la « fiabilité » : parmi les syllabes signalées fausses, combien le sont vraiment pour les professeurs.
# python3 tete_v3.py <pli>
import sys, json, numpy as np, torch
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.model_selection import GroupKFold
from sklearn.metrics import roc_auc_score
from commun import Oreille, ompal, sorties, marge as marge_de, CIBLE, OMPAL, SUF
PLI = int(sys.argv[1]); torch.set_num_threads(2)
D = ompal(PLI); M = D['M']; att, pos, juste, app, te, loc = D['att'], D['pos'], D['juste'], D['app'], D['test'], D['loc']
tr = ~te
# nombre de votes « juste » (0 à 3) pour la piste 2
det = json.load(open(OMPAL + 'non-native_scores-detail.json'))
nat = json.load(open(OMPAL + 'native_scores.json'))
vj = np.array([sum(int(v) for v in det[m['id']]['words'][m['k']]['tone']) if m['grp'] == 'apprenant'
               else 3 * int(nat[m['id']]['words'][m['k']]['tone']) for m in M], float)
assert ((vj >= 2) == juste).all()

m = Oreille(); m.load_state_dict(torch.load(f'/home/claude/aishell/oreille2-ompal{SUF}-pli{PLI}.pt', map_location='cpu'))
_, P = sorties(m, D['X'], pos); A = np.eye(4)[att]; mg = marge_de(P, att)
dur = np.array([x['dur'] for x in M]); ids = np.array([x['id'] for x in M]); kk = np.array([x['k'] for x in M]); n = np.array([x['n'] for x in M])
vit = {i: dur[ids == i].mean() for i in set(ids)}; vit = np.array([vit[i] for i in ids])
petit = np.c_[P, A, P * A, mg, pos, dur, dur / vit, vit, kk / n]

# ---- piste 1 : la syllabe comparée aux habitudes du même élève (aucune étiquette utilisée) ----
X = D['X'].astype(np.float32); st, vx = X[:, 40, 15:45] * 6, X[:, 41, 15:45]   # hauteur (demi-tons) et voisement sur les 30 pas de la syllabe
def courbe(i):      # 5 points de hauteur sur la partie voisée de la syllabe
    v = vx[i] > 0.5
    if v.sum() < 3: return np.full(5, np.nan)
    y = st[i][v]; return np.interp(np.linspace(0, 1, 5), np.linspace(0, 1, len(y)), y)
C = np.array([courbe(i) for i in range(len(M))])
ok = ~np.isnan(C).any(1)
eleve = np.zeros((len(M), 4 + 4 + 4 + 3), np.float32)
for L in set(loc):
    s = loc == L; s_ok = s & ok; idx = np.where(s)[0]
    mu, sd = np.nanmean(C[s_ok]), np.nanstd(C[s_ok]) + 1e-3                 # registre de l'élève
    Z = np.nan_to_num((C[idx] - mu) / sd, nan=0.0)                           # sa hauteur en « unités de sa propre voix »
    proto = np.array([Z[(s_ok & (att == t))[idx]].mean(0) if (s_ok & (att == t)).sum() >= 5 else np.full(5, np.nan) for t in range(4)])  # sa courbe moyenne de chaque ton
    dist = np.nan_to_num(((Z[:, None, :] - proto[None]) ** 2).mean(2), nan=9.0)   # distance à chacune de ses 4 courbes
    da = dist[np.arange(len(idx)), att[idx]]
    autre = np.where(np.eye(4)[att[idx]] == 1, np.inf, dist).min(1)
    Pm = np.array([P[s & (att == t)].mean(0) if (s & (att == t)).any() else np.full(4, .25) for t in range(4)])
    eleve[idx] = np.c_[dist, P[idx] - Pm[att[idx]], Z[:, 0], Z[:, 2], Z[:, 4], Z[:, 4] - Z[:, 0], da, da - autre, mg[idx] - mg[idx].mean()]


jeux = {'tête v2 (rappel)': petit, 'piste 1 : + sa propre voix': np.c_[petit, eleve]}
mk = lambda: HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05, max_leaf_nodes=15, class_weight='balanced', random_state=0)
def fit(Xa, idx, doux):
    if not doux: return mk().fit(Xa[idx], juste[idx])
    Xd = np.r_[Xa[idx], Xa[idx]]; yd = np.r_[np.ones(len(idx)), np.zeros(len(idx))]; wd = np.r_[vj[idx] / 3, 1 - vj[idx] / 3]
    k = wd > 0; return mk().fit(Xd[k], yd[k], sample_weight=wd[k])
out = dict(pli=PLI)
for nom, Xa in jeux.items():
    for doux in (False, True):
        itr = np.where(tr)[0]; oof = np.zeros(len(M))
        for a, b in GroupKFold(5).split(itr, groups=loc[itr]): oof[itr[b]] = fit(Xa, itr[a], doux).predict_proba(Xa[itr[b]])[:, 1]
        seuil = np.quantile(oof[tr & app & juste], 1 - CIBLE)
        s = fit(Xa, itr, doux).predict_proba(Xa)[:, 1]
        T = te & app; J, F = T & juste, T & ~juste; sig = T & (s <= seuil)
        out[nom + (' + 3 votes' if doux else '')] = dict(justes=round(100 * (s[J] > seuil).mean(), 1), faux=round(100 * (s[F] <= seuil).mean(), 1),
            auc=round(roc_auc_score(juste[T], s[T]), 3), fiabilite=round(100 * (~juste[sig]).mean(), 1),
            faux_a_90=round(100 * (s[F] <= np.quantile(s[J], 0.10)).mean(), 1))
print(json.dumps(out, ensure_ascii=False), flush=True)
with open(f'/home/claude/aishell/resultats-v3{SUF}.jsonl', 'a') as f: f.write(json.dumps(out, ensure_ascii=False) + '\n')
