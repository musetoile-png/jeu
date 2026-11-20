# « Un Chinois te comprendrait-il ? » : Whisper (sans le texte attendu) comparé au jugement des professeurs d'OMPAL.
#  1. Par phrase : taux d'erreur de caractères (CER) de Whisper contre les notes de justesse / fluidité / prosodie (1 à 5).
#  2. Par caractère : Whisper a-t-il retrouvé le caractère ? Comparé aux fautes de ton / consonne / voyelle notées par les professeurs.
import json, re, numpy as np, opencc
from scipy.stats import spearmanr
from sklearn.metrics import roc_auc_score
O = '/home/claude/ext/ompal/'
cv = opencc.OpenCC('t2s')
CH = '〇一二三四五六七八九'
def nombres(t):   # 6点半 -> 六点半, 30 -> 三十 (nombres < 100)
    def f(m):
        n = int(m.group());
        if n < 10: return CH[n]
        if n < 100: return ('' if n // 10 == 1 else CH[n // 10]) + '十' + (CH[n % 10] if n % 10 else '')
        return m.group()
    return re.sub(r'\d+', f, t)
norm = lambda t: ''.join(c for c in cv.convert(nombres(t)) if '一' <= c <= '鿿')
def aligner(ref, hyp):   # distance d'édition + pour chaque caractère de ref : retrouvé à l'identique ?
    n, m = len(ref), len(hyp); D = np.zeros((n + 1, m + 1), int); D[:, 0] = range(n + 1); D[0, :] = range(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            D[i, j] = min(D[i - 1, j] + 1, D[i, j - 1] + 1, D[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]))
    ok = [False] * n; i, j = n, m
    while i > 0 and j > 0:
        if D[i, j] == D[i - 1, j - 1] + (ref[i - 1] != hyp[j - 1]):
            ok[i - 1] = ref[i - 1] == hyp[j - 1]; i -= 1; j -= 1
        elif D[i, j] == D[i - 1, j] + 1: i -= 1
        else: j -= 1
    return D[n, m] / max(1, n), ok
det = json.load(open(O + 'non-native_scores-detail.json')); nat = json.load(open(O + 'native_scores.json'))
T = [json.loads(l) for l in open('/home/claude/whisper/transcriptions.jsonl')]
P, C = [], []   # phrases, caractères
for t in T:
    u = det.get(t['id']) or nat[t['id']]; ref = norm(u['text']); hyp = norm(t['texte'])
    cer, ok = aligner(ref, hyp)
    note = lambda c: np.mean(u[c]) if isinstance(u[c], list) else u[c]
    P.append(dict(id=t['id'], grp=t['grp'], cer=cer, exact=hyp == ref, acc=note('accuracy'), flu=note('fluency'), pro=note('prosody'), ref=ref, hyp=hyp))
    if t['grp'] == 'apprenant' and len(u['words']) == len(u['text']):
        for i, w in enumerate(u['words']):
            if len(w['text']) != 1: continue
            v = lambda c: sum(int(x) for x in w[c]) >= 2
            C.append(dict(id=t['id'], k=i, trouve=ok[i], ton=v('tone'), cons=v('phoneme_consonant'), voy=v('phoneme_vowel')))
json.dump(dict(phrases=P, caracteres=C), open('/home/claude/whisper/analyse.json', 'w'), ensure_ascii=False)
A = [p for p in P if p['grp'] == 'apprenant']; N = [p for p in P if p['grp'] == 'natif']
cer = np.array([p['cer'] for p in A]); acc = np.array([p['acc'] for p in A])
print(f"{len(A)} phrases d'élèves, {len(N)} de natifs transcrites")
for nom, X in (('élèves', A), ('natifs', N)):
    c = np.array([p['cer'] for p in X])
    print(f"{nom:7s} CER médian {100 * np.median(c):.0f} % | phrase retrouvée exactement {100 * np.mean([p['exact'] for p in X]):.1f} % | ≤ 10 % d'erreurs {100 * (c <= .1).mean():.1f} % | ≤ 20 % {100 * (c <= .2).mean():.1f} %")
for k in ('acc', 'flu', 'pro'):
    print(f"corrélation (Spearman) CER / note {k} des profs : {spearmanr(cer, [p[k] for p in A]).statistic:+.3f}")
print('CER médian par tranche de note de justesse :', {f'{a}-{b}': f"{100 * np.median(cer[(acc >= a) & (acc < b)]):.0f} % (n={((acc >= a) & (acc < b)).sum()})" for a, b in ((1, 3), (3, 4), (4, 4.5), (4.5, 5.01))})
bon = acc >= 4
print(f"AUC : le CER sépare les phrases notées ≥ 4 en justesse des autres : {roc_auc_score(bon, -cer):.3f}")
c = C
for nom, cle in (('ton', 'ton'), ('consonne', 'cons'), ('voyelle', 'voy')):
    juste = np.array([x[cle] for x in c]); tr = np.array([x['trouve'] for x in c])
    print(f"{nom:9s} : caractère retrouvé par Whisper si juste {100 * tr[juste].mean():.1f} % | si faux {100 * tr[~juste].mean():.1f} % (n faux = {(~juste).sum()})")
tous = np.array([x['ton'] and x['cons'] and x['voy'] for x in c]); tr = np.array([x['trouve'] for x in c])
print(f"tout juste (ton, consonne, voyelle) : retrouvé {100 * tr[tous].mean():.1f} % | au moins une faute : {100 * tr[~tous].mean():.1f} %")
