# Atelier de la voix — module de reconnaissance des tons (prototype 0.1)

## Ouvrir
En ligne : https://musetoile-png.github.io/jeu/atelier-voix/ (autoriser le micro). La page `../index.html` est la version construite par `construire.py`.

## Fichiers
- `moteur-voix.js` : le moteur, sans dépendance (navigateur et Node). À intégrer au jeu.
- `atelier-voix.html` : la page de test (charge `moteur-voix.js`).
- `dist/atelier-voix.html` : la même page en un seul fichier.
- `test/` : tests sur des voix de synthèse (`node test/test-moteur.js`) et générateur de WAV de test.

## Interface pour le jeu
```js
const phrase = MoteurVoix.preparerPhrase({ hanzi: '少放盐。', pinyin: 'shao3 fang4 yan2', fr: 'Mets peu de sel.' });
const r = MoteurVoix.analyser(signalFloat32, frequence, phrase, { registreHz });
// r.syllabes[i] : { h, pinyin, tonAttendu, entendu, verdict: juste|presque|a_reprendre|neutre|inaudible, conseil }
// r.score : % de tons justes ; r.medianeHz : à mémoriser pour apprendre la voix du joueur
```
Dans la page, l'appel passe par un objet `evaluateur` : un service spécialisé (SpeechSuper, TonePerfect) pourra le remplacer sans toucher au reste.

## Calibrage sur voix natives (version 0.2, 12 novembre 2026)
Le dossier `calibrage/` passe les 651 répliques ElevenLabs du jeu (`src/public/assets/audio/vo/zh`, textes tirés des scènes) dans le moteur :
`python3 extraire.py` (corpus + conversion en PCM 16 kHz avec ffmpeg), puis `node evaluer.js` et `node roc.js`.
Un contrôle inverse fait juger les mêmes voix contre des tons volontairement faux, pour vérifier que le moteur ne devient pas complaisant.

| Version | Tons natifs jugés justes | Score médian par phrase (natifs) | Faux tons acceptés à tort |
|---|---|---|---|
| 0.1 (formes des manuels, découpage par creux d'énergie) | 30 % | 38 % | 15 % |
| 0.2 (découpage par programmation dynamique, formes mesurées milieu / fin de phrase) | 57 % | 70 % | 13 % |

Limite : un natif obtient encore autour de 70 % ; le moteur reste sévère, surtout sur le 3e ton en fin de phrase et le 1er ton.
