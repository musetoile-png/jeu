# Construit les deux versions : fichier autonome (dist/atelier-voix.html) et page pour l'artefact Claude.
import re
html = open('atelier-voix.html').read()
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
