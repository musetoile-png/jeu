# Combine le module actuel (règles + voix modèle) et le réseau appris sur AISHELL :
# on accepte un ton si le module le juge juste ET si le réseau ne le contredit pas trop.
import json, glob, pickle, numpy as np
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
X = lambda s: (s['traits'] if 'traits' in s else s['t']) + s['q'] + [1.0 if s['pos'] == 'fin' else 0.0]
A = [json.loads(l) for f in sorted(glob.glob('/home/claude/aishell/sorties/*.jsonl')) for l in open(f)]
A = [s for s in A if s.get('q') and s['att'] in (1, 2, 3, 4)]
m = make_pipeline(StandardScaler(), MLPClassifier(hidden_layer_sizes=(64,), max_iter=200, early_stopping=True, random_state=0, alpha=1e-3))
m.fit(np.array([X(s) for s in A]), np.array([s['att'] for s in A]))
pickle.dump(m, open('reseau-aishell.pkl', 'wb'))
J = [s for s in json.load(open('/home/claude/calibrage/jeu-traits.json')) if s.get('t') and s.get('q')]
cl = list(m.classes_)
def marge(S):
    P = m.predict_proba(np.array([X(s) for s in S]))
    return np.array([np.log(max(p[cl.index(int(s['att']))], 1e-9)) - np.log(max(max(np.delete(p, cl.index(int(s['att'])))), 1e-9)) for s, p in zip(S, P)])
for mode in ['seul', 'modele']:
    for pos in ['tout', 'mil', 'fin']:
        ok = lambda s: s['mode'] == mode and (pos == 'tout' or s['pos'] == pos)
        nat = [s for s in J if s['ens'] == 'natif' and ok(s)]; fx = [s for s in J if s['ens'] == 'faux' and s['change'] and ok(s)]
        mn, mf = marge(nat), marge(fx)
        vn = np.array([s['verdict'] == 'juste' for s in nat]); vf = np.array([s['verdict'] == 'juste' for s in fx])
        ligne = f'{mode:6s} {pos:4s} module {100*vn.mean():5.1f}% / {100*vf.mean():4.1f}%'
        # réseau seul, au même taux de faux acceptés que le module
        th = np.quantile(mf, 1 - vf.mean()); ligne += f' | réseau seul (même exigence) {100*(mn > th).mean():5.1f}%'
        for t in [-2.0, -1.0, 0.0]:
            ligne += f' | module ET réseau>{t:+.0f} : {100*(vn & (mn > t)).mean():5.1f}% / {100*(vf & (mf > t)).mean():4.1f}%'
        print(ligne)
