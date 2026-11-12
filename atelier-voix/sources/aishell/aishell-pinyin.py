# Transcription AISHELL (hanzi séparés par des espaces) -> {id: {hanzi, pinyin}} avec les tons du dictionnaire (pypinyin).
import sys, json, re
from pypinyin import lazy_pinyin, Style
out = {}
for ligne in open(sys.argv[1], encoding='utf-8'):
    p = ligne.split()
    if len(p) < 2: continue
    uid, texte = p[0], ''.join(p[1:])
    if not re.fullmatch(r'[一-鿿]+', texte): continue
    py = lazy_pinyin(texte, style=Style.TONE3, neutral_tone_with_five=True)
    if len(py) != len(texte) or not all(re.fullmatch(r'[a-zü]+[1-5]', s.replace('v', 'ü')) for s in py): continue
    out[uid] = {'hanzi': texte + '。', 'pinyin': ' '.join(s.replace('v', 'ü') for s in py)}
json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
print(len(out), 'phrases')
