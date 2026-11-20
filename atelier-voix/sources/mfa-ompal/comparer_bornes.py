# Piste 3, diagnostic : frontières des syllabes posées par le module (b-seul.jsonl) contre celles du Montreal Forced Aligner.
# Produit aussi b-mfa.jsonl : même fichier que b-seul.jsonl, mais avec les frontières du MFA (pour refaire les images du son).
import json, re, glob, os, numpy as np
def mots(tg):
    t = open(tg, encoding='utf-8').read()
    tier = t.split('name = "words"')[1].split('item [')[0]
    iv = re.findall(r'xmin = ([\d.]+)\s+xmax = ([\d.]+)\s+text = "(.*?)"', tier)
    return [(float(a), float(b), x) for a, b, x in iv if x.strip()]
tgs = {os.path.basename(f)[:-9]: f for f in glob.glob('sortie/**/*.TextGrid', recursive=True)}
out, R, mauvais = [], [], 0
for l in open('/home/claude/ompal-eval/b-seul.jsonl'):
    r = json.loads(l); w = mots(tgs[r['id']]) if r['id'] in tgs else []
    if len(w) != len(r['syll']): mauvais += 1; continue
    r2 = dict(r); r2['syll'] = []
    for s, (a, b, x) in zip(r['syll'], w):
        c_mod, c_mfa = (s['debut'] + s['fin']) / 2, (a + b) / 2
        inter = max(0, min(b, s['fin']) - max(a, s['debut'])); union = max(b, s['fin']) - min(a, s['debut'])
        R.append(dict(grp=r['grp'], id=r['id'], k=s['k'], att=s['att'], ecart=abs(c_mod - c_mfa), iou=inter / union, dedans=a <= c_mod <= b, dur_mfa=b - a, dur_mod=s['fin'] - s['debut']))
        r2['syll'].append(dict(s, debut=a, fin=b))
    out.append(json.dumps(r2, ensure_ascii=False))
open('b-mfa.jsonl', 'w').write('\n'.join(out) + '\n')
json.dump(R, open('comparaison-bornes.json', 'w'))
print('enregistrements dont le nombre de syllabes diffère (écartés) :', mauvais)
for g in ('apprenant', 'natif'):
    x = [r for r in R if r['grp'] == g and r['att'] != 5]
    e = np.array([r['ecart'] for r in x]); iou = np.array([r['iou'] for r in x]); d = np.array([r['dedans'] for r in x])
    print(f"{g:9s} {len(x)} syllabes | écart des centres médian {1000 * np.median(e):.0f} ms, >100 ms : {100 * (e > .1).mean():.1f} %, >200 ms : {100 * (e > .2).mean():.1f} % | "
          f"centre du module hors de la syllabe MFA : {100 * (~d).mean():.1f} % | recouvrement médian {100 * np.median(iou):.0f} %")
