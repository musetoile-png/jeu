# Le réseau plus grand fait-il mieux ? Même validation voix par voix, mêmes faux tons greffés.
import json, numpy as np, sys
exec(open('entrainer.py').read().split("print('Validation voix par voix")[0].replace("COLS = [int(c) for c in (sys.argv[1] if len(sys.argv) > 1 else ','.join(map(str, range(16)))).split(',')]", "COLS = list(range(12))").replace("L = json.load(open(sys.argv[2] if len(sys.argv) > 2 else 'traits.json'))", "L = json.load(open('traits-greffe.json'))"))
def evaluer(H, lam, ep):
    tous = np.zeros((len(L), 4))
    for g in ['f', 'm', 'pnj']:
        entr = (grp != g) & np.isin(ens, ['natif', 'resyn'])
        cl = entrainer(X[entr], y[entr], H=H, lam=lam, epoques=ep)
        tous[grp == g] = proba(cl, X[grp == g])
    pa = tous[np.arange(len(L)), att]
    res = []
    for m_ in ['modele']:
        nat = (ens == 'natif') & (mode == m_); fx = (ens == 'faux') & chg & (mode == m_)
        # bons tons reconnus quand on règle l'exigence pour accepter 16,4 % de faux tons (comme les règles)
        th = np.quantile(pa[fx], 1 - 0.164)
        res.append(f"{100*(pa[nat]>=th).mean():.1f}% de bons tons à 16,4 % de faux acceptés")
    # apprentissage par cœur : précision sur les données d'entraînement
    cl = entrainer(X[np.isin(ens, ['natif', 'resyn'])], y[np.isin(ens, ['natif', 'resyn'])], H=H, lam=lam, epoques=ep)
    m = np.isin(ens, ['natif', 'resyn'])
    app = 100 * (proba(cl, X[m]).argmax(1) == y[m]).mean()
    print(f"{H:4d} neurones, régularisation {lam:g} : {res[0]} | sur ses propres données d'entraînement : {app:.1f}%")
for H, lam in [(8, 1e-3), (32, 1e-3), (128, 1e-3), (512, 1e-3), (128, 1e-1)]:
    evaluer(H, lam, 300)
print('règles : 66,5 % de bons tons à 16,4 % de faux acceptés')
