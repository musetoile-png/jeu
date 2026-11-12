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

## Version 0.3 : comparaison avec la voix modèle (12 novembre 2026)
Les phrases de l'atelier sont des répliques du joueur dans le jeu, avec leur voix ElevenLabs (femme ou homme), intégrées à la page.
Le moteur aligne l'enregistrement du joueur sur la voix modèle grâce au timbre (MFCC + DTW : consonnes et voyelles, pas la hauteur),
reporte les frontières de syllabes du modèle et compare chaque syllabe à celle du modèle. Le graphe superpose la mélodie du modèle.

Mesures (voix d'homme jugée avec la voix de femme comme modèle, et inversement, 452 enregistrements) :
- tons natifs jugés justes : 58,5 % (sans modèle) -> 61,8 % (avec modèle) ; phrases au-dessus de 80 % : 41 % -> 48 % ;
- vrais faux tons (voix natives resynthétisées avec un autre ton sur la moitié des syllabes, `fabriquer-faux.py`) : acceptés à tort 11,4 % -> 12,1 %.
Gain modeste sur la note ; l'apport principal est la mélodie du modèle affichée sous la tienne.

## Essai d'un classifieur de tons appris (12 novembre 2026)
Petit réseau de neurones (courbe de la syllabe et de ses voisines -> 32 neurones -> 4 tons), validé voix par voix
(jamais testé sur une voix vue à l'entraînement). Faux tons de contrôle refaits en greffant de vraies courbes natives
(`python3 fabriquer-faux.py greffe`), car ceux fabriqués avec les formes des règles avantageaient les règles.
- Avec les tons attendus des voisines comme indice, le réseau « devine » (habitudes de la langue) : 32 % de faux tons acceptés. Indice retiré.
- Mode voix modèle, à exigence égale : règles 66,5 % de bons tons / 16,4 % de faux acceptés ; réseau 58,2 % / 17,7 %.
- Mode seul : réseau légèrement meilleur (61,9 % / 21,3 % contre 57,7 % / 20,1 %).
Conclusion : non intégré. Deux voix de synthèse ne suffisent pas ; il faudra de vraies voix (apprenants, natifs variés).
Le passage avant reste disponible dans le moteur (option `classifieur`, fonctions `classer` et `traitsSyllabe`).

## Réseau plus grand et Montreal Forced Aligner (12 novembre 2026)
- Taille du réseau (`taille-reseau.py`) : de 8 à 512 neurones, aucun gain (55,9 à 57,2 % de bons tons à 16,4 % de faux acceptés, contre 66,5 % pour les règles + voix modèle). Même sur ses propres données d'entraînement, le réseau plafonne à 73 % : la limite vient des courbes données en entrée (découpage, information), pas de la taille.
- Montreal Forced Aligner 3.4.3 installé avec micromamba (conda-forge), modèle acoustique `mandarin_mfa` v3.0.0 et dictionnaire `mandarin_mfa` (dépôt MontrealCorpusTools/mfa-models). Besoin aussi de `pip install spacy-pkuseg dragonmapper hanziconv`.
  1 090 enregistrements alignés en 65 s sur 2 processeurs (texte : caractères séparés par des espaces, un dossier par voix).
- Notes avec les frontières de l'aligneur (`evaluer-mfa.js`, `evaluer-mfa2.js`) : 47,2 % de bons tons natifs (48,9 % avec des formes remesurées), contre 58,4 % (règles seules) et 63,1 % (règles + voix modèle). Faux tons greffés acceptés : 21,2 % / 19,1 % contre 20,1 % / 14,9 %.
  Conclusion : l'aligneur découpe bien les sons, mais ce découpage n'aide pas le jugement des tons tel qu'il est fait aujourd'hui. Son meilleur usage : étiqueter automatiquement un grand corpus de vraies voix (ex. AISHELL-1, Apache 2.0, 400 locuteurs) pour entraîner un classifieur de tons.
