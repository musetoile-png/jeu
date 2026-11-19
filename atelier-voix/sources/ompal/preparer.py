# OMPAL -> travaux pour bornes.js : pinyin (pypinyin + corrections relues à la main), voix modèle = enregistrement natif OMPAL de la même phrase.
import json, re, os, sys
from pypinyin import lazy_pinyin, Style
O = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/ext/ompal/'
nn = json.load(open(O + 'non-native_scores.json')); nat = json.load(open(O + 'native_scores.json'))
# corrections : (contexte, rang du caractère dans le contexte, syllabe)
REGLES = [('著', 0, 'zhe5'), ('得意地', 2, 'de5'), ('熱熱地', 2, 'de5'), ('看得', 1, 'de5'), ('掃得', 1, 'de5'), ('變得', 1, 'de5'), ('覺得', 1, 'de5'),
  ('先得', 1, 'dei3'), ('乾乾', 0, 'gan1'), ('乾乾', 1, 'gan1'), ('個', 0, 'ge5'), ('夜裡', 1, 'li5'), ('那裡', 1, 'li5'), ('館裡', 1, 'li5'), ('心裡', 1, 'li5'),
  ('室裡', 1, 'li5'), ('市裡', 1, 'li5'), ('裡邊', 1, 'bian5'), ('外邊', 1, 'bian5'), ('時候', 1, 'hou5'), ('衣服', 1, 'fu5'), ('朋友', 1, 'you5'), ('漂亮', 1, 'liang5'),
  ('早上', 1, 'shang5'), ('晚上', 1, 'shang5'), ('穿上', 1, 'shang5'), ('貼上', 1, 'shang5'), ('騎上', 1, 'shang5'), ('名字', 1, 'zi5'), ('熱鬧', 1, 'nao5'),
  ('麻煩', 1, 'fan5'), ('知道', 1, 'dao5'), ('眼睛', 1, 'jing5'), ('看了看', 2, 'kan5'), ('要是', 1, 'shi5'), ('招呼', 1, 'hu5'), ('答應', 0, 'da1'), ('答應', 1, 'ying5'),
  ('哥哥', 1, 'ge5'), ('爸爸', 1, 'ba5'), ('媽媽', 1, 'ma5'), ('學生', 1, 'sheng5'), ('窗戶', 1, 'hu5'), ('洗洗', 1, 'xi5'), ('到過', 1, 'guo5'), ('點兒', 1, 'er5'),
  ('大夫', 0, 'dai4'), ('大夫', 1, 'fu5'), ('空座', 0, 'kong4'), ('兩只', 1, 'zhi1'), ('家來', 1, 'lai5'), ('一', 0, 'yi1'), ('不', 0, 'bu4')]
def pinyin(t):
    py = [s.replace('v', 'ü') for s in lazy_pinyin(t, style=Style.TONE3, neutral_tone_with_five=True)]
    assert len(py) == len(t) and all(re.fullmatch(r'[a-zü]+[1-5]', s) for s in py), t
    for ctx, r, syl in REGLES:
        for m in re.finditer(re.escape(ctx), t): py[m.start() + r] = syl
    return ' '.join(py)
modele = {u['text']: f'{O}wav/SPEAKER{k[1:6]}/{k}.wav' for k, u in nat.items()}
jobs, PY = [], {}
for grp, D in (('apprenant', nn), ('natif', nat)):
    for k, u in sorted(D.items()):
        t = u['text']; PY.setdefault(t, pinyin(t))
        j = {'id': k, 'audio': f'{O}wav/SPEAKER{k[1:6]}/{k}.wav', 'hanzi': t.replace('個', '个') + '。', 'pinyin': PY[t], 'extra': {'loc': k[1:6], 'grp': grp}}
        assert os.path.exists(j['audio']), j['audio']
        jobs.append(j)
json.dump(jobs, open('travaux-seul.json', 'w'), ensure_ascii=False)
jm = [dict(j, modele=modele[j['hanzi'][:-1].replace('个', '個')]) for j in jobs if j['extra']['grp'] == 'apprenant' and j['hanzi'][:-1].replace('个', '個') in modele]
json.dump(jm, open('travaux-modele.json', 'w'), ensure_ascii=False)
json.dump(PY, open('pinyin-ompal.json', 'w'), ensure_ascii=False, indent=0)
print(len(jobs), 'travaux seul ;', len(jm), 'avec voix modèle')
