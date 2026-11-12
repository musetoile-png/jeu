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
