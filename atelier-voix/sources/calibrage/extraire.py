# Construit la liste (fichier audio, caractères, pinyin numéroté) à partir des scènes du jeu.
import json, glob, os, unicodedata
J = '/home/claude/jeu/src/content'
lex = {e['id']: e for e in json.load(open(J + '/languages/zh/lexicon.json'))['entries']}
TONS = {'̄': 1, '́': 2, '̌': 3, '̀': 4}
INI = ['zh','ch','sh','b','p','m','f','d','t','n','l','g','k','h','j','q','x','r','z','c','s','y','w','']
FIN = ['iang','iong','uang','ueng','ang','eng','ing','ong','ian','iao','uai','uan','van','ai','ei','ao','ou','an','en','er','ia','ie','iu','in','ua','uo','ui','un','ve','vn','ue','a','o','e','i','u','v']
SYL = {i + f for i in INI for f in FIN} | {'m','n','ng','r'}
def decouper(base):
    import functools
    @functools.lru_cache(None)
    def d(k):
        if k == len(base): return []
        for L in range(min(6, len(base) - k), 0, -1):
            if base[k:k+L] in SYL:
                r = d(k + L)
                if r is not None: return [(k, k + L)] + r
        return None
    return d(0)
def numeroter_mot(mot):
    s = unicodedata.normalize('NFD', mot.lower().replace('ü', 'v'))
    base, tons = '', []
    for c in s:
        if c in TONS: tons[-1] = TONS[c]
        elif unicodedata.category(c) != 'Mn' and c.isalpha(): base += c; tons.append(5)
    parts = decouper(base)
    if parts is None: return None
    return [base[a:b] + str(next((t for t in tons[a:b] if t != 5), 5)) for a, b in parts]
def numeroter(s):
    s = unicodedata.normalize('NFD', s.lower().replace('ü', 'v'))
    ton, base = 5, ''
    for c in s:
        if c in TONS: ton = TONS[c]
        elif unicodedata.category(c) != 'Mn': base += c
    return base.replace('v', 'u:').replace('u:', 'v') + str(ton)
lignes = []
def walk(o):
    if isinstance(o, dict):
        if isinstance(o.get('vo'), str) and isinstance(o.get('line'), list): lignes.append(o)
        for v in o.values(): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
for f in glob.glob(J + '/packs/*/scenes/*.json') + glob.glob(J + '/packs/*/places/*.json'):
    walk(json.load(open(f)))
AUDIO = '/home/claude/jeu/src/public/assets/audio/vo/zh/'
out, vus = [], set()
for l in lignes:
    hanzi, py, ok = '', [], True
    for tok in l['line']:
        if tok[0] == 'p': hanzi += tok[1]
        elif tok[0] == 'w':
            e = lex.get(tok[1])
            if not e: ok = False; break
            hanzi += e['target']
            for x in e['transcription'].replace("'", ' ').replace('-', ' ').split():
                n = numeroter_mot(x)
                if n is None: ok = False; break
                py += n
        else: ok = False; break
    import re
    if not ok or len(py) != len(re.findall(r'\p{Han}' if False else r'[\u3400-\u9fff]', hanzi)): continue
    for nom in ([l['vo'].replace('{body}', b) for b in ('f', 'm')] if '{body}' in l['vo'] else [l['vo']]):
        f = AUDIO + nom + '.mp3'
        if os.path.exists(f) and f not in vus:
            vus.add(f); out.append({'audio': f, 'hanzi': hanzi, 'pinyin': ' '.join(py), 'fr': l.get('gloss', {}).get('fr', '')})
json.dump(out, open('corpus.json', 'w'), ensure_ascii=False, indent=0)
print(len(lignes), 'répliques ;', len(out), 'fichiers appariés')
