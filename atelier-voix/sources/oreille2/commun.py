# Éléments communs : architecture de l'oreille et chargement d'OMPAL (jugement des professeurs + images du son).
import json, numpy as np, torch, torch.nn as nn
OMPAL = '/home/claude/ext/ompal/'
import os
SEUL = os.environ.get('OMPAL_NPZ', '/home/claude/ompal-eval/seul.npz')   # images du son d'OMPAL (frontières du module, ou du MFA)
SUF = os.environ.get('SUFFIXE', '')
PT = '/home/claude/jeu/atelier-voix/sources/aishell/oreille.pt'
CIBLE = 0.90   # part des tons justes que le juge doit accepter (les professeurs : 95 %)

class Oreille(nn.Module):  # même architecture que entrainer_cnn.py
    def __init__(s, c=43):
        super().__init__()
        bl = lambda i, o, k: nn.Sequential(nn.Conv1d(i, o, k, padding=k // 2), nn.BatchNorm1d(o), nn.ReLU())
        s.f = nn.Sequential(bl(c, 64, 5), bl(64, 64, 5), nn.MaxPool1d(2), bl(64, 128, 3), bl(128, 128, 3), nn.Dropout(0.2))
        s.t = nn.Sequential(nn.Linear(256 + 1, 64), nn.ReLU(), nn.Dropout(0.2), nn.Linear(64, 4))
    def resume(s, x, p):
        h = s.f(x); return torch.cat([h.mean(2), h[:, :, 7:23].amax(2), p[:, None]], 1)
    def forward(s, x, p):
        return s.t(s.resume(x, p))

def ompal(pli):
    det = json.load(open(OMPAL + 'non-native_scores-detail.json')); nat = json.load(open(OMPAL + 'native_scores.json'))
    votes = {}
    for k, u in det.items():
        if len(u['words']) != len(u['text']): continue
        for i, w in enumerate(u['words']):
            if len(w['text']) == 1: votes[(k, i)] = sum(int(v) for v in w['tone'])
    for k, u in nat.items():
        for i, w in enumerate(u['words']): votes[(k, i)] = 3 * int(w['tone'])
    test_ids = set(json.load(open(f'{OMPAL}test/test_{pli}_scores.json'))) if pli else set()   # pli 0 : tout OMPAL sert à l'entraînement (modèle final)
    z = np.load(SEUL); M = [json.loads(x) for x in z['meta']]
    keep = np.array([m['att'] in (1, 2, 3, 4) and (m['id'], m['k']) in votes for m in M])
    M = [m for m, k in zip(M, keep) if k]
    D = dict(X=z['X'][keep], M=M, att=np.array([m['att'] - 1 for m in M]), pos=np.array([m['pos'] == 'fin' for m in M], dtype=np.float32),
             juste=np.array([votes[(m['id'], m['k'])] >= 2 for m in M]), app=np.array([m['grp'] == 'apprenant' for m in M]),
             test=np.array([m['id'] in test_ids for m in M]), loc=np.array([m['loc'] for m in M]))
    assert not set(D['loc'][D['test']]) & set(D['loc'][~D['test']]), 'locuteur à cheval'
    return D

def sorties(m, X, pos, bs=2048):
    m.eval(); H, P = [], []
    with torch.no_grad():
        for i in range(0, len(X), bs):
            h = m.resume(torch.from_numpy(X[i:i + bs].astype(np.float32)), torch.from_numpy(pos[i:i + bs]))
            H.append(h.numpy()); P.append(torch.softmax(m.t(h), 1).numpy())
    return np.concatenate(H), np.concatenate(P)

def marge(P, att):
    A = np.eye(4)[att]
    return np.log((P * A).sum(1) + 1e-9) - np.log(np.where(A == 1, 0, P).max(1) + 1e-9)
