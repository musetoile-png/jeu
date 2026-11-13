# Entraîne un classifieur de tons sur les syllabes AISHELL (vraies voix) et le juge sur les voix du jeu
# (bons tons natifs reconnus / faux tons greffés acceptés), comparé au module actuel.
import json, glob, sys, numpy as np
from sklearn.neural_network import MLPClassifier
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline

def X(s, jeu=('t', 'q')):
    v = []
    if 't' in jeu: v += s['traits'] if 'traits' in s else s['t']
    if 'q' in jeu: v += s['q']
    v += [1.0 if s['pos'] == 'fin' else 0.0]
    return v
A = [json.loads(l) for f in sorted(glob.glob('/home/claude/aishell/sorties/*.jsonl')) for l in open(f)]
A = [s for s in A if s.get('q') and s['att'] in (1, 2, 3, 4)]
locs = sorted(set(s['loc'] for s in A)); rng = np.random.RandomState(0); rng.shuffle(locs)
test_locs = set(locs[:max(1, len(locs) // 5)])
J = json.load(open('/home/claude/calibrage/jeu-traits.json'))
J = [s for s in J if s.get('t') and s.get('q')]
print(f'AISHELL : {len(A)} syllabes, {len(locs)} voix ({len(test_locs)} gardées pour le test) ; jeu : {len(J)} syllabes')

def marges(model, S):
    P = model.predict_proba(np.array([X(s, JEU) for s in S]))
    cl = list(model.classes_)
    out = []
    for s, p in zip(S, P):
        a = cl.index(int(s['att']))
        out.append(np.log(max(p[a], 1e-9)) - np.log(max(max(np.delete(p, a)), 1e-9)))  # > 0 : le ton attendu l'emporte
    return np.array(out)

def bilan(nom, model):
    res = {}
    # AISHELL voix jamais vues
    T = [s for s in A if s['loc'] in test_locs]
    m = marges(model, T); res['aishell'] = (m > 0).mean()
    fin = np.array([s['pos'] == 'fin' for s in T]); res['aishell_fin'] = (m[fin] > 0).mean()
    for mode in ['seul', 'modele']:
        nat = [s for s in J if s['ens'] == 'natif' and s['mode'] == mode]
        fx = [s for s in J if s['ens'] == 'faux' and s['mode'] == mode and s['change']]
        mn, mf = marges(model, nat), marges(model, fx)
        th = np.quantile(mf, 1 - 0.164)  # seuil qui donne 16,4 % de faux acceptés (le niveau du module actuel)
        res[mode] = ((mn > 0).mean(), (mf > 0).mean(), (mn > th).mean())
        res[mode + '_m'] = (mn, mf)
        regles_n = np.mean([s['verdict'] == 'juste' for s in nat]); regles_f = np.mean([s['verdict'] == 'juste' for s in fx])
        res[mode + '_regles'] = (regles_n, regles_f)
    print(f"{nom:34s} AISHELL voix nouvelles {100*res['aishell']:.1f}% (fin {100*res['aishell_fin']:.1f}%) | jeu, découpage seul : justes {100*res['seul'][0]:.1f}% faux acc. {100*res['seul'][1]:.1f}% | avec voix modèle : justes {100*res['modele'][0]:.1f}% faux acc. {100*res['modele'][1]:.1f}% || à 16,4 % de faux acceptés : {100*res['seul'][2]:.1f}% / {100*res['modele'][2]:.1f}%")
    return res

tr = [s for s in A if s['loc'] not in test_locs]
for JEU in [('t',), ('t', 'q')]:
    Xtr = np.array([X(s, JEU) for s in tr]); ytr = np.array([s['att'] for s in tr])
    lda = make_pipeline(StandardScaler(), LinearDiscriminantAnalysis()).fit(Xtr, ytr)
    r = bilan(f"LDA {'+'.join(JEU)}", lda)
    for h in [(64,), (128, 64)]:
        mlp = make_pipeline(StandardScaler(), MLPClassifier(hidden_layer_sizes=h, max_iter=200, early_stopping=True, random_state=0, alpha=1e-3)).fit(Xtr, ytr)
        r = bilan(f"réseau {h} {'+'.join(JEU)}", mlp)
J0 = [s for s in J if s['mode'] == 'modele']
print('module actuel (règles + voix modèle) : justes {:.1f}% faux acc. {:.1f}% ; règles seules : justes {:.1f}% faux acc. {:.1f}%'.format(
    100*r['modele_regles'][0], 100*r['modele_regles'][1], 100*r['seul_regles'][0], 100*r['seul_regles'][1]))
