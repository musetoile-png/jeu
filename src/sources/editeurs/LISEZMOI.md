# Leçons d'éditeurs et de profs : du tableur au jeu

Un éditeur ou un prof remplit un tableur ; l'importeur en fait un paquet jouable, à ses couleurs, sans dessiner ni programmer.
Les décors et les personnages sont ceux de Mille li (onglet Catalogue).

## Les fichiers

- `modele-lecon.xlsx` : le tableur vide à envoyer (avec l'onglet Catalogue et les listes déroulantes).
- `exemple-salon-de-the.xlsx` : une leçon complète, « Boire un thé » (client fictif Éditions Exemple), qui sert d'exemple et de démonstration.

Les deux se refabriquent avec `node tools/modele-tableur.mjs` (et `--exemple`).

## Les quatre onglets

| Onglet | Une ligne = | À savoir |
| --- | --- | --- |
| Leçon | un réglage | identifiant du paquet, titre, titre en langue cible |
| Mots | un mot | caractères, pinyin, traduction. Un mot déjà connu du jeu est réutilisé tel quel (même voix, même carnet) |
| Scènes | une scène | un lieu et un personnage du Catalogue ; les scènes s'ouvrent l'une après l'autre |
| Répliques | une réplique ou une question | « dit » : le personnage parle ; « choix » : l'élève choisit sa réponse parmi la bonne et 1 à 3 fausses, chacune avec son explication |

Les phrases s'écrivent normalement (« 我要一杯绿茶。 ») : l'importeur les découpe en mots d'après l'onglet Mots.
Si une découpe est ambiguë, une espace ou une barre la tranche : « 香蕉 很 好吃 ».

## Importer

```sh
node tools/import.mjs sources/editeurs/exemple-salon-de-the.xlsx --dry-run   # vérifier sans rien écrire
node tools/import.mjs sources/editeurs/exemple-salon-de-the.xlsx             # écrire content/packs/<identifiant>/
node tools/validate.mjs
```

Tant qu'il reste une erreur, rien n'est écrit, et chaque erreur dit l'onglet, la ligne et quoi corriger
(« Répliques ligne 2 : « 咖啡 » n'est pas dans le vocabulaire — ajoute-le dans l'onglet Mots »).
Un tableur Google Sheets s'importe après « Fichier › Télécharger › Microsoft Excel (.xlsx) ».

Pour jouer la leçon, la fiche client nomme le paquet (`content/clients/<client>/client.json` → `"pack": "<identifiant>"`),
puis `npm run build`. Démonstration : `index.html?client=demo-editeur`.

## Les voix

L'importeur écrit `voix-a-generer.json` (une ligne par réplique : clé, personnage, texte).
Tant que les fichiers audio n'existent pas, le jeu fait lire les phrases par la voix du navigateur.
Les voix natives (ElevenLabs) seront générées à partir de cette liste.
