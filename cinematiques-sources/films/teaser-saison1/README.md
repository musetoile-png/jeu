# Teaser — Saison 1 « Les dernières couleurs de l'Empire »

Film de présentation (16:9, 57,5 s). Découpage et textes : `SCRIPT.md` ; temps des plans et des voix : `timeline.json`.

## Sources
- Carte (P5) : côte et fleuves Natural Earth (domaine public, `geo.json` déjà projeté), Grand Canal en tracé simplifié.
- Plans P1, P2, P3, P5 : animés par le code (`film.js`) avec les images du jeu (ruelle, bouquinerie, 白老师) et deux paysages générés
  (ElevenLabs, gpt-image-2.5-sunburst, style pris sur `bouquinerie_far.jpg`). Tracés des caractères : hanzi-writer-data (licence Arphic).
- Plans P4 (Mò Mò sort du rouleau) et P6 (les couleurs reviennent) : vidéos ElevenLabs, Seedance 2.5, 720p, à partir de `assets/scroll_a.jpg`
  et `assets/land_a.jpg`. Images extraites à 30 i/s dans `clips/p4` et `clips/p6` (non versionnées, voir plus bas).
- P7 : le générique du jeu (`assets/video/generique-qianli.mp4`, de 4 s à 14 s), extrait dans `clips/p7`, avec le titre de saison par-dessus.
- Voix : narrateur « Yann – Deep Storyteller » ; Mò Mò provisoire : « Lulu » (mandarin de Taïwan), en attendant une voix dessinée pour le jeu.
- Musique : ElevenLabs Music v2.5 (`audio/musique.mp3`).

## Refaire
```bash
node films/teaser-saison1/prep.mjs
ffmpeg -i p4.mp4 -vf fps=30 -frames:v 210 -q:v 2 films/teaser-saison1/clips/p4/%04d.jpg
ffmpeg -i p6.mp4 -vf fps=30 -frames:v 240 -q:v 2 films/teaser-saison1/clips/p6/%04d.jpg
ffmpeg -ss 4 -i ../assets/video/generique-qianli.mp4 -frames:v 300 -q:v 2 films/teaser-saison1/clips/p7/%04d.jpg
python3 films/teaser-saison1/mix.py
node render.mjs films/teaser-saison1 --workers 6
```
