# Mesure sur OMPAL (vrais apprenants français, tons jugés juste/faux par des professeurs) :
# module actuel (règles, avec ou sans voix modèle), oreille (réseau AISHELL) et leur combinaison.
# python3 juger_ompal.py dossier_ompal oreille.pt seul.npz modele.npz
import sys, json, numpy as np, torch, torch.nn as nn
O, PT = sys.argv[1], sys.argv[2]
NPZ = {'seul': sys.argv[3], 'modele': sys.argv[4]}

class Oreille(nn.Module):  # copie conforme de entrainer_cnn.py
    def __init__(s, c=43):
        super().__init__()
        bl = lambda i, o, k: nn.Sequential(nn.Conv1d(i, o, k, padding=k // 2), nn.BatchNorm1d(o), nn.ReLU())
        s.f = nn.Sequential(bl(c, 64, 5), bl(64, 64, 5), nn.MaxPool1d(2), bl(64, 128, 3), bl(128, 128, 3), nn.Dropout(0.2))
        s.t = nn.Sequential(nn.Linear(256 + 1, 64), nn.ReLU(), nn.Dropout(0.2), nn.Linear(64, 4))
    def forward(s, x, p):
        h = s.f(x); h = torch.cat([h.mean(2), h[:, :, 7:23].amax(2), p[:, None]], 1)
        return s.t(h)
m = Oreille(); m.load_state_dict(torch.load(PT, map_location='cpu')); m.eval()

def proba(X, p, bs=2048):
    out = []
    with torch.no_grad():
        for i in range(0, len(X), bs):
            out.append(torch.softmax(m(torch.from_numpy(X[i:i + bs].astype(np.float32)), torch.from_numpy(p[i:i + bs])), 1).numpy())
    return np.concatenate(out)

# --- jugement des professeurs, syllabe par syllabe (3 votes par mot ; les « mots » d'OMPAL sont des caractères) ---
det = json.load(open(O + 'non-native_scores-detail.json'))
nat = json.load(open(O + 'native_scores.json'))
votes = {}
for k, u in det.items():
    if len(u['words']) != len(u['text']): continue          # 1 phrase au découpage irrégulier
    for i, w in enumerate(u['words']):
        if len(w['text']) != 1: continue                      # mot à variante (還/也) : ignoré
        votes[(k, i)] = [int(v) for v in w['tone']]
for k, u in nat.items():
    for i, w in enumerate(u['words']): votes[(k, i)] = [int(w['tone'])] * 3

def charger(mode):
    z = np.load(NPZ[mode]); M = [json.loads(x) for x in z['meta']]
    keep = np.array([mm['att'] in (1, 2, 3, 4) and (mm['id'], mm['k']) in votes for mm in M])
    X = z['X'][keep]; M = [mm for mm, kk in zip(M, keep) if kk]
    P = proba(X, np.array([mm['pos'] == 'fin' for mm in M], dtype=np.float32))
    att = np.array([mm['att'] - 1 for mm in M])
    autres = np.where(np.eye(4)[att] == 1, 0, P)
    marge = np.log(P[np.arange(len(P)), att] + 1e-9) - np.log(autres.max(1) + 1e-9)
    return M, marge, P

R = {}
for mode in ('seul', 'modele'):
    M, marge, P = charger(mode)
    V = np.array([votes[(mm['id'], mm['k'])] for mm in M])
    R[mode] = dict(M=M, marge=marge, P=P, V=V,
                   app=np.array([mm['grp'] == 'apprenant' for mm in M]),
                   fin=np.array([mm['pos'] == 'fin' for mm in M]),
                   module=np.array([mm['verdict'] == 'juste' for mm in M]),
                   ton=np.array([mm['att'] for mm in M]),
                   loc=np.array([mm['loc'] for mm in M]))

def taux(acc, juste, faux):
    return 100 * acc[juste].mean(), 100 * (~acc[faux]).mean()

print('Juges : % des tons JUSTES (selon les profs) acceptés  /  % des tons FAUX (selon les profs) détectés')
sortie = {}
for mode in ('seul', 'modele'):
    r = R[mode]; a = r['app']; maj = r['V'].sum(1) >= 2
    juste, faux = a & maj, a & ~maj
    unan_j, unan_f = a & (r['V'].sum(1) == 3), a & (r['V'].sum(1) == 0)
    print(f'\n=== mode {mode} : {a.sum()} syllabes d\'apprenants jugées ({juste.sum()} justes, {faux.sum()} fausses ; unanimes : {unan_j.sum()} / {unan_f.sum()}) ; natifs : {(~a).sum()}')
    juges = {'module': r['module'], 'oreille': r['marge'] > 0, 'module ET oreille>-1': r['module'] & (r['marge'] > -1),
             'module ET oreille>0': r['module'] & (r['marge'] > 0), 'module OU oreille': r['module'] | (r['marge'] > 0)}
    for nom, acc in juges.items():
        j, f = taux(acc, juste, faux); ju, fu = taux(acc, unan_j, unan_f)
        jf, ff = taux(acc, juste & r['fin'], faux & r['fin'])
        jn = 100 * acc[~a].mean() if (~a).any() else float('nan')
        print(f'{nom:22s} majorité {j:5.1f} / {f:5.1f} | unanimes {ju:5.1f} / {fu:5.1f} | fin de phrase {jf:5.1f} / {ff:5.1f} | natifs acceptés {jn:5.1f}')
        sortie[f'{mode}|{nom}'] = dict(justes=j, faux=f, justes_unan=ju, faux_unan=fu, justes_fin=jf, faux_fin=ff, natifs=jn)
    # oreille à exigence égale au module (même taux de tons faux détectés)
    th = np.quantile(r['marge'][faux], (~r['module'][faux]).mean())
    acc = r['marge'] > th
    j, f = taux(acc, juste, faux)
    print(f'{"oreille, même exigence":22s} majorité {j:5.1f} / {f:5.1f}  (seuil {th:+.2f})')
    sortie[f'{mode}|oreille même exigence'] = dict(justes=j, faux=f, seuil=float(th))
    # courbe : seuil de l'oreille
    for t in (-2, -1, 0, 1, 2):
        acc = r['marge'] > t; j, f = taux(acc, juste, faux)
        print(f'   oreille>{t:+d} : {j:5.1f} / {f:5.1f}')
    # par ton attendu
    for t in (1, 2, 3, 4):
        s = r['ton'] == t
        print(f'   ton {t} : module {taux(r["module"], juste & s, faux & s)} | oreille {taux(r["marge"] > 0, juste & s, faux & s)} | n={ (juste & s).sum()}/{(faux & s).sum()}')
    # ce que l'oreille entend quand les profs disent « faux »
    ent = r['P'].argmax(1) + 1
    print('   tons faux : l\'oreille entend le ton attendu dans', f'{100 * (ent[faux] == r["ton"][faux]).mean():.1f} %')

# --- repère humain : un professeur face à la majorité des deux autres (quand ils sont d'accord) ---
r = R['seul']; a = r['app']; V = r['V'][a]
J = F = nJ = nF = 0
for i in range(3):
    o = np.delete(V, i, 1); acc = o.sum(1) == 2; rej = o.sum(1) == 0
    J += V[acc, i].sum(); nJ += acc.sum(); F += (1 - V[rej, i]).sum(); nF += rej.sum()
print(f'\nRepère humain (un prof contre les deux autres d\'accord) : {100 * J / nJ:.1f} / {100 * F / nF:.1f}')
sortie['repere humain'] = dict(justes=100 * J / nJ, faux=100 * F / nF)
json.dump(sortie, open('resultats-ompal.json', 'w'), ensure_ascii=False, indent=1)

# --- compléments : réglage « indulgent » et points de fonctionnement communs ---
print('\nCompléments')
for mode in ('seul', 'modele'):
    r = R[mode]; a = r['app']; maj = r['V'].sum(1) >= 2; juste, faux = a & maj, a & ~maj
    jp = np.array([mm['verdict'] in ('juste', 'presque') for mm in r['M']])
    print(mode, 'module juste+presque : %.1f / %.1f' % taux(jp, juste, faux), '| natifs %.1f' % (100 * jp[~a].mean() if (~a).any() else float('nan')))
    # oreille : seuil qui accepte 90 % / 95 % des tons justes
    for cible in (0.80, 0.90, 0.95):
        th = np.quantile(r['marge'][juste], 1 - cible); acc = r['marge'] > th
        print(f'   oreille réglée pour accepter {int(cible*100)} % des justes : {taux(acc, juste, faux)[0]:.1f} / {taux(acc, juste, faux)[1]:.1f}')
    # aire sous la courbe (capacité à classer un ton juste au-dessus d'un ton faux)
    from sklearn.metrics import roc_auc_score
    y = maj[a].astype(int)
    print('   AUC oreille %.3f | AUC module (juste>presque>reprendre) %.3f' % (roc_auc_score(y, r['marge'][a]),
          roc_auc_score(y, np.array([{'juste': 2, 'presque': 1}.get(mm['verdict'], 0) for mm in r['M']])[a])))
    # débit
d = [json.loads(l) for l in open('b-seul.jsonl')]
import statistics
for g in ('apprenant', 'natif'):
    deb = [len(x['syll']) / (x['syll'][-1]['fin'] - x['syll'][0]['debut']) for x in d if x['grp'] == g]
    print(g, 'débit médian %.2f syllabes/s' % statistics.median(deb))
