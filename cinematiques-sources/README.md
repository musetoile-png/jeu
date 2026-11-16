# Cinématiques de 千里 Mille li

Sources des films du jeu, fabriqués avec le moteur **motion-studio** (licence MIT, voir `LICENSE` et `NOTICE.md`).
Chaque image est calculée en JavaScript (`film.js`, `window.seek(t)`), rendue par Chrome puis encodée en MP4 ;
les bruitages sont synthétisés en Python (`score.py`), calés sur les mêmes temps (`timeline.json`).

| Film | Dossier | Dans le jeu |
|---|---|---|
| Générique : 千里 écrit au pinceau, sceau, proverbe 千里之行，始于足下 | `films/titre-qianli` | `assets/video/generique-qianli.mp4` (ouverture, puis fond de l'écran titre) |
| Le chien vole le portefeuille — l'étudiant | `films/chien-voleur` | `assets/video/chien-m.mp4` |
| Le chien vole le portefeuille — l'étudiante | `films/chien-voleur-f` (liens vers `chien-voleur`, seul `timeline.json` change : `"body": "f"`) | `assets/video/chien-f.mp4` |

Branchement : `pack.json` → `films` (`opening`, `prologue`). Le film du chien remplace la scène `prologue-chien` :
ses mots comptent au carnet, le portefeuille quitte le sac, le drapeau `chien` passe à `fait`.
Sans fichier vidéo (version HTML autonome), la scène se rejoue en jeu comme avant.

## Pas de musique

Les films n'ont que les bruitages et les voix. Pour ajouter une musique libre de droits : la mixer sous `score.wav`
(ou remettre `MUSIC = True` dans `score.py` pour la musique synthétisée d'origine), puis relancer le rendu.

## Refaire un film

```bash
npm install                      # playwright + hanzi-writer-data
pip install numpy scipy soundfile
node films/titre-qianli/prep.mjs # générique seulement : tracés et horaire des traits (data.json)
python3 films/chien-voleur/score.py
CHROME_PATH=/usr/bin/google-chrome node render.mjs films/chien-voleur --workers 4
node render.mjs films/chien-voleur --stills 6.6,12.5   # quelques images pour vérifier
# version web (dans src/public/assets/video et assets/video) :
ffmpeg -i out/chien-voleur.mp4 -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart chien-m.mp4
```

Les images viennent du jeu (`assets/art`) ; les vues de dos (`player_back`, `playerf_back`, `dog_back`) ont été
générées avec Canva Pro et détourées. Tracés des caractères : hanzi-writer-data (makemeahanzi, licence Arphic).
