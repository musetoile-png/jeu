# Compréhension mesurée en syllabes (pinyin) plutôt qu'en caractères : un homophone écrit par Whisper ne compte pas comme une erreur.
import json, numpy as np
from pypinyin import lazy_pinyin, Style
from scipy.stats import spearmanr
from sklearn.metrics import roc_auc_score
import importlib.util
spec = importlib.util.spec_from_file_location('a', '/home/claude/whisper/analyser.py')
D = json.load(open('analyse.json'))
def ed(r, h):
    n, m = len(r), len(h); d = np.zeros((n + 1, m + 1), int); d[:, 0] = range(n + 1); d[0, :] = range(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1): d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + (r[i - 1] != h[j - 1]))
    return d[n, m] / max(1, n)
for p in D['phrases']:
    p['ser_sans_ton'] = ed(lazy_pinyin(p['ref'], style=Style.NORMAL), lazy_pinyin(p['hyp'], style=Style.NORMAL))
    p['ser_avec_ton'] = ed(lazy_pinyin(p['ref'], style=Style.TONE3, neutral_tone_with_five=True), lazy_pinyin(p['hyp'], style=Style.TONE3, neutral_tone_with_five=True))
json.dump(D, open('analyse.json', 'w'), ensure_ascii=False)
for g in ('apprenant', 'natif'):
    X = [p for p in D['phrases'] if p['grp'] == g]
    for k in ('cer', 'ser_avec_ton', 'ser_sans_ton'):
        c = np.array([p[k] for p in X])
        print(f"{g:9s} {k:13s} médiane {100 * np.median(c):4.0f} % | exacte {100 * (c == 0).mean():5.1f} % | ≤ 10 % {100 * (c <= .1).mean():5.1f} % | ≤ 20 % {100 * (c <= .2).mean():5.1f} %")
A = [p for p in D['phrases'] if p['grp'] == 'apprenant']; acc = np.array([p['acc'] for p in A])
for k in ('cer', 'ser_avec_ton', 'ser_sans_ton'):
    c = np.array([p[k] for p in A])
    print(f"{k:13s} Spearman / justesse {spearmanr(c, acc).statistic:+.3f} | AUC phrases ≥ 4 {roc_auc_score(acc >= 4, -c):.3f} | AUC phrases ≥ 4,5 {roc_auc_score(acc >= 4.5, -c):.3f}")
