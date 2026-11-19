# Réentraîne « l'oreille » avec AISHELL (natifs, ton attendu = vrai ton) + OMPAL (apprenants français jugés par 3 professeurs).
# Pour un ton jugé FAUX, on ne sait pas quel ton l'élève a dit, seulement que ce n'est pas le bon :
# on apprend alors au réseau à NE PAS reconnaître le ton attendu (perte « complémentaire » : -log(1 - p_attendu)).
# Validation : les 5 découpages officiels d'OMPAL (test = 4 apprenants + 1 natif jamais entendus).
# Le seuil de décision est choisi sur la partie entraînement pour accepter 90 % des tons justes, puis appliqué tel quel au test.
#
# python3 oreille2.py <variante> <pli 1-5>     variantes : base | ompal | mixte | zero
import sys, json, glob, time, numpy as np, torch, torch.nn as nn
from sklearn.metrics import roc_auc_score
torch.set_num_threads(2)
VAR, PLI = sys.argv[1], int(sys.argv[2])
AISH = sorted(glob.glob('/home/claude/aishell/npz/S*.npz'))
torch.manual_seed(PLI); np.random.seed(PLI)

from commun import Oreille, ompal, sorties, marge as marge_de, PT, CIBLE
D = ompal(PLI)
OX, Oatt, Opos, Ojuste, Oapp, Otest = D['X'], D['att'], D['pos'], D['juste'], D['app'], D['test']
tr = ~Otest

# ---------- AISHELL ----------
AX, Aatt, Apos = [], [], []
if VAR in ('mixte', 'zero'):
    for f in AISH:
        a = np.load(f); mm = [json.loads(x) for x in a['meta']]
        k = np.array([m['att'] in (1, 2, 3, 4) for m in mm])
        AX.append(a['X'][k]); Aatt.append(np.array([m['att'] - 1 for m, kk in zip(mm, k) if kk])); Apos.append(np.array([m['pos'] == 'fin' for m, kk in zip(mm, k) if kk], dtype=np.float32))
    AX, Aatt, Apos = np.concatenate(AX), np.concatenate(Aatt), np.concatenate(Apos)

m = Oreille()
if VAR in ('base', 'ompal', 'mixte'): m.load_state_dict(torch.load(PT, map_location='cpu'))

def perte(logits, att, statut):   # statut : 1 = ton juste (vrai ton connu), 0 = ton faux (seulement « pas celui-là »)
    lp = torch.log_softmax(logits, 1); pa = lp.gather(1, att[:, None])[:, 0]
    juste = -pa
    faux = -torch.log1p(-pa.exp().clamp(max=1 - 1e-5))
    return torch.where(statut > 0, juste, 3.0 * faux).mean()   # les fautes sont 6 fois plus rares : on leur donne plus de poids

if VAR != 'base':
    EP = {'ompal': 4, 'mixte': 4, 'zero': 8}[VAR]
    lr = {'ompal': 3e-4, 'mixte': 5e-4, 'zero': 3e-3}[VAR]
    oi = np.where(tr)[0]
    n_a = {'ompal': 0, 'mixte': 2 * len(oi), 'zero': len(AX)}[VAR]
    pas = EP * ((len(oi) + n_a) // 256 + 1)
    opt = torch.optim.AdamW(m.parameters(), lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, lr, total_steps=pas)
    for ep in range(EP):
        t0 = time.time(); m.train()
        ai = np.random.choice(len(AX), n_a, replace=False) if n_a else np.array([], int)
        src = np.concatenate([np.zeros(len(oi), int), np.ones(len(ai), int)]); idx = np.concatenate([oi, ai])
        perm = np.random.permutation(len(idx)); tot = 0
        for i in range(0, len(perm), 256):
            b = perm[i:i + 256]; so, ix = src[b], idx[b]
            xo, xa = ix[so == 0], ix[so == 1]
            x = np.concatenate([OX[xo], AX[xa]] if len(xa) else [OX[xo]]).astype(np.float32)
            att = np.concatenate([Oatt[xo], Aatt[xa]] if len(xa) else [Oatt[xo]])
            pos = np.concatenate([Opos[xo], Apos[xa]] if len(xa) else [Opos[xo]])
            st = np.concatenate([Ojuste[xo], np.ones(len(xa), bool)]).astype(np.float32)
            x = torch.from_numpy(x); j = np.random.randint(0, 36); x[:, j:j + np.random.randint(0, 5)] = 0
            l = perte(m(x, torch.from_numpy(pos)), torch.from_numpy(att), torch.from_numpy(st))
            opt.zero_grad(); l.backward(); opt.step(); sched.step(); tot += l.item() * len(b)
        print(f'  [{VAR} pli {PLI}] époque {ep + 1}/{EP} perte {tot / len(perm):.3f} ({time.time() - t0:.0f} s)', flush=True)

# ---------- mesure ----------
if PLI == 0:
    torch.save(m.state_dict(), f'/home/claude/aishell/oreille2-{VAR}-final.pt'); sys.exit()
_, P = sorties(m, OX, Opos)
marge = marge_de(P, Oatt)
jtr = tr & Oapp & Ojuste
seuil = np.quantile(marge[jtr], 1 - CIBLE)
te = Otest & Oapp; J, F = te & Ojuste, te & ~Ojuste
res = dict(variante=VAR, pli=PLI, n_justes=int(J.sum()), n_faux=int(F.sum()), seuil=float(seuil),
           justes_acceptes=float(100 * (marge[J] > seuil).mean()), faux_detectes=float(100 * (marge[F] <= seuil).mean()),
           justes_0=float(100 * (marge[J] > 0).mean()), faux_0=float(100 * (marge[F] <= 0).mean()),
           auc=float(roc_auc_score(Ojuste[te], marge[te])),
           natif_accepte=float(100 * (marge[Otest & ~Oapp] > seuil).mean()))
print(json.dumps(res, ensure_ascii=False), flush=True)
with open('/home/claude/aishell/resultats-oreille2.jsonl', 'a') as f: f.write(json.dumps(res, ensure_ascii=False) + '\n')
if VAR != 'base': torch.save(m.state_dict(), f'/home/claude/aishell/oreille2-{VAR}-pli{PLI}.pt')
