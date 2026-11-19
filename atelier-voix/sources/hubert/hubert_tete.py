# Juge « HuBERT + petite tête » : ce que chinese-hubert-base entend de chaque syllabe (une couche, 5 x 768 nombres)
# -> petit réseau qui apprend le jugement des professeurs d'OMPAL.
# Deux têtes :
#   « tons »  : prédit les 4 tons ; un ton jugé faux apprend seulement « pas le ton attendu » (comme oreille2.py) ; score = marge.
#   « juge »  : prédit directement juste / faux, avec le ton attendu en entrée.
# Validation : les 5 découpages officiels d'OMPAL ; seuil réglé pour accepter 90 % des tons justes,
# par validation croisée voix par voix à l'intérieur de la partie entraînement (le test n'est jamais vu).
# python3 hubert_tete.py <couche 3|6|9|12> <tons|juge>
import sys, json, numpy as np, torch, torch.nn as nn
from sklearn.model_selection import GroupKFold
from sklearn.metrics import roc_auc_score
sys.path.insert(0, '/home/claude/aishell/scripts')
from commun import OMPAL, CIBLE
torch.set_num_threads(2)
COUCHE, TETE = int(sys.argv[1]), sys.argv[2]
ic = [3, 6, 9, 12].index(COUCHE)
z = np.load('/home/claude/aishell/hubert-ompal.npz'); M = [json.loads(x) for x in z['meta']]
det = json.load(open(OMPAL + 'non-native_scores-detail.json')); nat = json.load(open(OMPAL + 'native_scores.json'))
votes = {}
for k, u in det.items():
    if len(u['words']) != len(u['text']): continue
    for i, w in enumerate(u['words']):
        if len(w['text']) == 1: votes[(k, i)] = sum(int(v) for v in w['tone'])
for k, u in nat.items():
    for i, w in enumerate(u['words']): votes[(k, i)] = 3 * int(w['tone'])
keep = np.array([m['att'] in (1, 2, 3, 4) and (m['id'], m['k']) in votes for m in M])
X = z['X'][keep][:, ic].astype(np.float32); M = [m for m, k in zip(M, keep) if k]
att = np.array([m['att'] - 1 for m in M]); pos = np.array([m['pos'] == 'fin' for m in M], np.float32)
juste = np.array([votes[(m['id'], m['k'])] >= 2 for m in M]); app = np.array([m['grp'] == 'apprenant' for m in M])
loc = np.array([m['loc'] for m in M]); ids = np.array([m['id'] for m in M])

def entrainer(idx, ep=12):
    mu, sd = X[idx].mean(0), X[idx].std(0) + 1e-4
    nin = X.shape[1] + 1 + (4 if TETE == 'juge' else 0)
    net = nn.Sequential(nn.Dropout(0.2), nn.Linear(nin, 256), nn.ReLU(), nn.Dropout(0.3), nn.Linear(256, 4 if TETE == 'tons' else 1))
    opt = torch.optim.AdamW(net.parameters(), 1e-3, weight_decay=1e-2)
    def entree(i):
        e = [(X[i] - mu) / sd, pos[i, None]]
        if TETE == 'juge': e.append(np.eye(4, dtype=np.float32)[att[i]])
        return torch.from_numpy(np.concatenate(e, 1).astype(np.float32))
    w_faux = (juste[idx].sum() / max(1, (~juste[idx]).sum()))   # équilibre justes / faux
    for _ in range(ep):
        net.train(); perm = np.random.permutation(idx)
        for b in range(0, len(perm), 256):
            i = perm[b:b + 256]; out = net(entree(i)); j = torch.from_numpy(juste[i].astype(np.float32))
            if TETE == 'tons':
                lp = torch.log_softmax(out, 1).gather(1, torch.from_numpy(att[i])[:, None])[:, 0]
                l = torch.where(j > 0, -lp, -w_faux / 2 * torch.log1p(-lp.exp().clamp(max=1 - 1e-5))).mean()
            else:
                l = nn.functional.binary_cross_entropy_with_logits(out[:, 0], j, weight=torch.where(j > 0, 1.0, float(w_faux)))
            opt.zero_grad(); l.backward(); opt.step()
    net.eval()
    def score(i):
        with torch.no_grad(): out = net(entree(i))
        if TETE == 'juge': return out[:, 0].numpy()
        P = torch.softmax(out, 1).numpy(); A = np.eye(4)[att[i]]
        return np.log((P * A).sum(1) + 1e-9) - np.log(np.where(A == 1, 0, P).max(1) + 1e-9)
    return score

res = []; SC = {}
for pli in range(1, 6):
    torch.manual_seed(pli); np.random.seed(pli)
    test_ids = set(json.load(open(f'{OMPAL}test/test_{pli}_scores.json')))
    te = np.array([i in test_ids for i in ids]); tr = np.where(~te)[0]
    oof = np.zeros(len(X))
    for a, b in GroupKFold(5).split(tr, groups=loc[tr]):
        oof[tr[b]] = entrainer(tr[a])(tr[b])
    seuil = np.quantile(oof[tr][(app & juste)[tr]], 1 - CIBLE)
    s = entrainer(tr)(np.arange(len(X)))
    SC[pli] = np.where(te, s, oof)   # score « honnête » de chaque syllabe pour ce pli (test : modèle du pli ; entraînement : validation croisée interne)
    T = te & app; J, F = T & juste, T & ~juste
    r = dict(pli=pli, justes=100 * (s[J] > seuil).mean(), faux=100 * (s[F] <= seuil).mean(), auc=roc_auc_score(juste[T], s[T]),
             faux_a_90=100 * (s[F] <= np.quantile(s[J], 0.10)).mean(), natif=100 * (s[te & ~app] > seuil).mean())
    res.append(r); print(json.dumps({k: round(float(v), 3) for k, v in r.items()}), flush=True)
moy = {k: round(float(np.mean([r[k] for r in res])), 3) for k in res[0] if k != 'pli'}
print('MOYENNE', COUCHE, TETE, json.dumps(moy), flush=True)
np.savez(f'/home/claude/aishell/scores-hubert-{COUCHE}-{TETE}.npz', ids=ids, k=np.array([m['k'] for m in M]), **{f'pli{p}': v for p, v in SC.items()})
with open('/home/claude/aishell/resultats-hubert.jsonl', 'a') as f: f.write(json.dumps(dict(couche=COUCHE, tete=TETE, **moy, plis=res)) + '\n')
