# Construit les deux versions : fichier autonome (dist/atelier-voix.html) et page pour l'artefact Claude.
import re, json, base64, os
# Voix modèles : enregistrements natifs du jeu (ElevenLabs), intégrés en base64
VO = '/home/claude/jeu/src/public/assets/audio/vo/zh/'
html = open('atelier-voix.html').read()
codes = sorted(set(re.findall(r"vo: '([^']+)'", html)))
audio = {}
for c in codes:
    for v in ('f', 'm'):
        f = VO + c + '_' + v + '.mp3'
        if os.path.exists(f):
            audio.setdefault(c, {})[v] = 'data:audio/mpeg;base64,' + base64.b64encode(open(f, 'rb').read()).decode()
manquants = [c for c in codes if c not in audio]
assert not manquants, manquants
audio_js = 'window.AUDIO_MODELES = ' + json.dumps(audio) + ';'
open('audio-modeles.js', 'w').write(audio_js)
html = html.replace('<script src="audio-modeles.js"></script>', '<script>\n' + audio_js + '\n</script>')
js = open('moteur-voix.js').read()
html = html.replace('<script src="moteur-voix.js"></script>', '<script>\n' + js + '\n</script>')
open('dist/atelier-voix.html', 'w').write(html)
art = html
art = re.sub(r'^<!doctype html>\s*<html lang="fr">\s*<head>\s*<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*', '', art)
art = art.replace('<title>Atelier de la voix</title>', '<title>Atelier de la voix</title>\n<meta name="claude:viewport-fit-sides" content="cover">', 1)
art = re.sub(r'</head>\s*<body>\s*', '', art, count=1)
art = re.sub(r'\s*</body>\s*</html>\s*$', '\n', art)
assert not re.search(r'<(!doctype|html|head|body)\b', art, re.I)
open('dist/atelier-voix-artifact.html', 'w').write(art)
print('ok', len(html), len(art))
