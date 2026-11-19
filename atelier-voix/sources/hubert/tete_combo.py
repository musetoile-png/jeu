# Combinaison oreille v2 + HuBERT (score de hubert_tete.py ajouté aux petits indices de la tête).
# « Tête de jugement » : apprend directement la décision des professeurs (ton juste / faux) à partir de
# ce qu'entend l'oreille (son résumé interne de 256 nombres + ses probabilités de tons), du ton attendu,
# de la place dans la phrase, de la durée et du verdict du module à règles.
# Même validation que oreille2.py : 5 découpages officiels d'OMPAL ; seuil choisi sur l'entraînement (90 % des justes acceptés).
# python3 tete_jugement.py <oreille: base|ompal|mixte|zero> <pli>
import sys, json, numpy as np, torch
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.model_selection import GroupKFold
from sklearn.metrics import roc_auc_score
from commun import Oreille, ompal, sorties, marge as marge_de, PT, CIBLE
OR, PLI = sys.argv[1], int(sys.argv[2]); HUB = sys.argv[3]   # ex. 9-tons
D = ompal(PLI)
OX, Oatt, Opos, Ojuste, Oapp, Otest, M = D['X'], D['att'], D['pos'], D['juste'], D['app'], D['test'], D['M']
tr = ~Otest
torch.set_num_threads(2)
m = Oreille()
m.load_state_dict(torch.load(PT if OR == 'base' else f'/home/claude/aishell/oreille2-{OR}-pli{PLI}.pt', map_location='cpu'))
H, P = sorties(m, OX, Opos)
A = np.eye(4)[Oatt]
marge = marge_de(P, Oatt)
V = np.array([[m_['verdict'] == 'juste', m_['verdict'] == 'presque', m_['verdict'] == 'a_reprendre'] for m_ in M], float)
dur = np.array([m_['dur'] for m_ in M]); n = np.array([m_['n'] for m_ in M]); kk = np.array([m_['k'] for m_ in M])
# vitesse de lecture de la phrase (les débutants lisent lentement) : durée moyenne d'une syllabe dans l'enregistrement
ids = np.array([m_['id'] for m_ in M]); vit = {i: dur[ids == i].mean() for i in set(ids)}; vit = np.array([vit[i] for i in ids])
petit = np.c_[P, A, P * A, marge, Opos, dur, dur / vit, vit, kk / n]
hz = np.load(f'/home/claude/aishell/scores-hubert-{HUB}.npz'); assert list(hz['ids']) == [m_['id'] for m_ in M] and list(hz['k']) == [m_['k'] for m_ in M], 'lignes non alignées'
hs = hz[f'pli{PLI}'][:, None]
jeux = {'petits indices': petit, 'hubert seul': hs, 'petits indices + hubert': np.c_[petit, hs]}
grp = np.array([m_['loc'] for m_ in M])
res = {}
for nom, X in jeux.items():
    mk = (lambda: make_pipeline(StandardScaler(), LogisticRegression(C=0.05 if X.shape[1] > 100 else 1.0, max_iter=2000, class_weight='balanced'))) if nom == 'hubert seul' \
        else (lambda: HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05, max_leaf_nodes=15, class_weight='balanced', random_state=0))
    itr = np.where(tr)[0]
    oof = np.zeros(len(itr))
    for a, b in GroupKFold(5).split(itr, groups=grp[itr]):
        c = mk().fit(X[itr[a]], Ojuste[itr[a]]); oof[b] = c.predict_proba(X[itr[b]])[:, 1]
    sel = Oapp[itr] & Ojuste[itr]; seuil = np.quantile(oof[sel], 1 - CIBLE)
    c = mk().fit(X[itr], Ojuste[itr]); s = c.predict_proba(X)[:, 1]
    te = Otest & Oapp; J, F = te & Ojuste, te & ~Ojuste
    res[nom] = dict(justes=100 * (s[J] > seuil).mean(), faux=100 * (s[F] <= seuil).mean(), auc=roc_auc_score(Ojuste[te], s[te]),
                    natif=100 * (s[Otest & ~Oapp] > seuil).mean())
    # à 90 % exact sur le test (comparaison des juges entre eux, même tolérance)
    t90 = np.quantile(s[J], 0.10); res[nom]['faux_a_90'] = 100 * (s[F] <= t90).mean()
out = dict(oreille=OR, pli=PLI, **{k: {a: round(float(b), 3) for a, b in v.items()} for k, v in res.items()})
print(json.dumps(out, ensure_ascii=False), flush=True)
with open('/home/claude/aishell/resultats-combo.jsonl', 'a') as f: f.write(json.dumps(out, ensure_ascii=False) + '\n')
