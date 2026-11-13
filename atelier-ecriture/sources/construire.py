# Construit les données de l'atelier d'écriture à partir du lexique et des scènes du jeu.
#   python3 atelier-ecriture/sources/construire.py   (depuis la racine du dépôt)
# Sorties :
#   atelier-ecriture/donnees/caracteres.js  -> window.CARACTERES (un caractère = sens, pinyin, mots, contextes, voix)
#   atelier-ecriture/traits/<car>.json      -> données de traits Make Me a Hanzi (licence Arphic, fichiers non modifiés)
# Données de traits : paquet npm hanzi-writer-data@2.0.1 décompressé dans le dossier passé en argument
#   (par défaut /tmp/npmdl/x_hanzi-writer-data-2.0.1/package).
# Liste HSK 2021 (pour embarquer les traits des niveaux 1 à 3) : dépôt drkameleon/complete-hsk-vocabulary (MIT),
#   chemin passé en 2e argument (par défaut /tmp/hsk/repo).
import json, glob, os, re, shutil, sys

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ATELIER = os.path.join(RACINE, 'atelier-ecriture')
TRAITS_SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/npmdl/x_hanzi-writer-data-2.0.1/package'
HSK_SRC = sys.argv[2] if len(sys.argv) > 2 else '/tmp/hsk/repo'
VO = os.path.join(RACINE, 'assets', 'audio', 'vo', 'zh')

def han(c):
    return '一' <= c <= '鿿' or '㐀' <= c <= '䶿'

lex = json.load(open(os.path.join(RACINE, 'src/content/languages/zh/lexicon.json')))['entries']
par_id = {e['id']: e for e in lex}

# --- phrases des scènes (seulement les répliques justes : pas de choix faux, pas de variables) ---
phrases, vues = [], set()
def texte(ligne):
    zh = ''
    for t in ligne:
        if not isinstance(t, list):
            return None
        if t[0] == 'w':
            e = par_id.get(t[1])
            if not e:
                return None
            zh += e['target']
        elif t[0] == 'p':
            zh += t[1]
        elif t[0] == 't':
            if not any(han(c) for c in t[1]):
                return None
            zh += t[1]
        else:  # 'v' = variable remplie en jeu
            return None
    return zh

def voix(code):
    if not code:
        return ''
    for v in ([code.replace('{body}', 'f'), code.replace('{body}', 'm')] if '{body}' in code else [code]):
        if os.path.exists(os.path.join(VO, v + '.mp3')):
            return v
    return ''

def parcourir(o, scene):
    if isinstance(o, dict):
        if isinstance(o.get('line'), list) and o.get('ok') is not False and not o.get('errorType'):
            zh = texte(o['line'])
            fr = (o.get('gloss') or {}).get('fr', '')
            # didascalies du jeu entre parenthèses qui citent du chinois : on les retire (elles donneraient la réponse)
            fr = re.sub(r'\s*\([^)]*[\u3400-\u9fff][^)]*\)\s*', ' ', fr).strip()
            if zh and fr and zh not in vues and sum(han(c) for c in zh) >= 2:
                vues.add(zh)
                ids = [t[1] for t in o['line'] if t[0] == 'w']
                phrases.append({'zh': zh, 'fr': fr, 'vo': voix(o.get('vo')), 'scene': scene, 'mots': ids})
        for v in o.values():
            parcourir(v, scene)
    elif isinstance(o, list):
        for v in o:
            parcourir(v, scene)

for f in sorted(glob.glob(os.path.join(RACINE, 'src/content/packs/*/scenes/*.json'))):
    parcourir(json.load(open(f)), os.path.basename(f)[:-5])

# --- pinyin d'un caractère dans un mot ---
def syllabes(tr):
    tr = re.sub(r"[’']", ' ', tr or '')
    return [s for s in re.split(r'[\s\-]+', tr.strip()) if s]

import unicodedata
def sans_ton(s):
    return ''.join(ch for ch in unicodedata.normalize('NFD', s) if unicodedata.category(ch) != 'Mn').replace('ü', 'v')

try:  # aide au découpage seulement (MIT) ; les tons viennent toujours du lexique du jeu
    from pypinyin import lazy_pinyin, Style
except ImportError:
    lazy_pinyin = None

def pinyin_dans(mot, car):
    cs = [c for c in mot['target'] if han(c)]
    sy = syllabes(mot.get('transcription'))
    if len(cs) == len(sy):
        return sy[cs.index(car)].lower()
    # transcription collée (« shénme ») : on la découpe avec les syllabes sans ton données par pypinyin
    tr = unicodedata.normalize('NFC', re.sub(r"[\s’'\-]", '', mot.get('transcription') or '')).lower()
    if not lazy_pinyin or not tr:
        return ''
    nu, pos, res = sans_ton(tr), 0, []
    for c in cs:
        s = lazy_pinyin(c, style=Style.NORMAL, v_to_u=False)[0].replace('ü', 'v')
        if not nu.startswith(s, pos):
            return ''
        res.append(tr[pos:pos + len(s)])
        pos += len(s)
    return res[cs.index(car)] if pos == len(nu) else ''

# --- pinyin de secours depuis la liste HSK 2021 (caractères seuls) ---
hsk_py, hsk_niv = {}, {}
for n in (1, 2, 3, 4, 5, 6):
    p = os.path.join(HSK_SRC, 'wordlists', 'exclusive', 'new', f'{n}.json')
    if not os.path.exists(p):
        continue
    for w in json.load(open(p)):
        s = w['simplified']
        if len(s) == 1 and s not in hsk_py:
            hsk_py[s] = w['forms'][0]['transcriptions']['pinyin']
        for c in s:
            if han(c):
                hsk_niv.setdefault(c, n)

histoires = json.load(open(os.path.join(ATELIER, 'sources', 'histoires.json')))

# --- caractères, dans l'ordre du lexique ---
cars, ordre = {}, []
for e in lex:
    for c in e['target']:
        if not han(c):
            continue
        if c not in cars:
            cars[c] = {'c': c, 'mots': []}
            ordre.append(c)
        cars[c]['mots'].append(e['id'])
for c in histoires:
    if c not in cars:
        cars[c] = {'c': c, 'mots': []}
        ordre.append(c)

NIV = {'HSK1': 1, 'HSK2': 2, 'HSK3': 3, 'HSK4': 4}
sortie = []
for c in ordre:
    d = cars[c]
    mots = [par_id[i] for i in d['mots']]
    seul = next((m for m in mots if m['target'] == c), None)
    py = (seul or {}).get('transcription') or next((pinyin_dans(m, c) for m in mots if pinyin_dans(m, c)), '')
    if not py or sans_ton(py) == py:  # absent ou ton neutre dans le mot (朋友 péngyou) : forme de citation du caractère
        py = hsk_py.get(c) or histoires.get(c, {}).get('pinyin') \
            or (lazy_pinyin(c, style=Style.TONE)[0] if lazy_pinyin else '') or py
    if seul:
        sens = seul['gloss'].get('fr', '')
    elif c in histoires:
        sens = histoires[c]['sens']
    else:
        sens = ' · '.join(f"dans {m['target']} ({m['gloss'].get('fr', '')})" for m in mots[:2])
    niveaux = [NIV[m['level']] for m in mots if m.get('level') in NIV]
    niveau = min(niveaux) if niveaux else hsk_niv.get(c, 0)
    ctx = [{'zh': p['zh'], 'fr': p['fr'], 'vo': p['vo'], 'scene': p['scene']} for p in phrases if c in p['zh']]
    ctx.sort(key=lambda p: (not p['vo'], len(p['zh'])))
    for s in histoires.get(c, {}).get('contextes', []):
        zh, _, fr = s.partition('|')
        if zh not in [x['zh'] for x in ctx]:
            ctx.append({'zh': zh, 'fr': fr, 'vo': '', 'scene': ''})
    sortie.append({
        'c': c, 'pinyin': py, 'sens': sens, 'niveau': niveau, 'source': 'jeu' if d['mots'] else 'prototype',
        'histoire': histoires.get(c, {}).get('histoire', ''), 'mnemo': histoires.get(c, {}).get('mnemo', ''),
        'mots': [{'id': m['id'], 'zh': m['target'], 'py': m.get('transcription', ''), 'fr': m['gloss'].get('fr', ''),
                  'vo': ('w_' + m['id']) if os.path.exists(os.path.join(VO, 'w_' + m['id'] + '.mp3')) else ''} for m in mots],
        'contextes': ctx[:10],
    })

# --- données de traits embarquées : caractères du jeu + HSK 1 à 3 + caractères des phrases ---
voulus = set(ordre) | {c for c, n in hsk_niv.items() if n <= 3} | {c for p in phrases for c in p['zh'] if han(c)}
dest = os.path.join(ATELIER, 'traits')
os.makedirs(dest, exist_ok=True)
absents = []
for c in sorted(voulus):
    src = os.path.join(TRAITS_SRC, c + '.json')
    if os.path.exists(src):
        shutil.copyfile(src, os.path.join(dest, c + '.json'))
    else:
        absents.append(c)
shutil.copyfile(os.path.join(TRAITS_SRC, 'ARPHICPL.TXT'), os.path.join(dest, 'ARPHICPL.TXT'))
embarques = sorted(f[:-5] for f in os.listdir(dest) if f.endswith('.json'))
sans_traits = [d['c'] for d in sortie if d['c'] not in embarques]
sortie = [d for d in sortie if d['c'] in embarques]

js = '// Généré par sources/construire.py — ne pas éditer à la main.\n'
js += 'window.CARACTERES = ' + json.dumps(sortie, ensure_ascii=False, separators=(',', ':')) + ';\n'
js += 'window.TRAITS_EMBARQUES = ' + json.dumps(''.join(embarques), ensure_ascii=False) + ';\n'
open(os.path.join(ATELIER, 'donnees', 'caracteres.js'), 'w').write(js)

print(f'{len(sortie)} caractères, {len(phrases)} phrases du jeu, {len(embarques)} fichiers de traits embarqués')
print('sans données de traits :', ''.join(sans_traits) or '—', '| absents de hanzi-writer-data :', ''.join(absents) or '—')
print('sans pinyin :', ''.join(d['c'] for d in sortie if not d['pinyin']) or '—')
print('avec ≥3 contextes :', sum(len(d['contextes']) >= 3 for d in sortie), '/ sans contexte :', ''.join(d['c'] for d in sortie if not d['contextes']))
