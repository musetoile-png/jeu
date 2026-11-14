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

## Faire rédiger la leçon par l'IA (générateur)

Le prof donne un thème et sa liste de mots ; l'IA remplit le même tableur ; le prof relit et valide ; l'importeur construit la leçon.
L'IA propose, l'enseignant dispose : **un brouillon de l'IA ne s'importe pas tant que l'onglet Leçon n'a pas de nom dans « relu par »**.

```sh
# 1. La consigne à donner à Claude (dans une conversation) : catalogue, vocabulaire connu, règles pédagogiques, format attendu
node tools/generer.mjs consigne --theme "Négocier un prix" --mots "公司，经理，价格，便宜，贵…" --niveau "HSK 2" --scenes 2 -o consigne.md

# 2. La réponse de Claude (copiée dans un fichier .md ou .json) → le tableur brouillon, vérifié
node tools/generer.mjs tableur reponse.md --mots "公司，经理，价格…"
#    → sources/editeurs/brouillons/<identifiant>.xlsx

# Ou les deux d'un coup, par l'API d'Anthropic (clé dans ANTHROPIC_API_KEY ; modèle : ANTHROPIC_MODEL)
node tools/generer.mjs auto --theme "Négocier un prix" --mots @mots.txt --niveau "HSK 2"
```

`--mots` accepte une liste (virgules, espaces, retours à la ligne) ou `@fichier.txt` (un mot par ligne ; le pinyin et le sens éventuels sont ignorés).

Le brouillon s'ouvre sur l'onglet **Relecture**, qui liste ce que le prof doit regarder :
- les **erreurs à corriger** (trouvées par l'importeur : mot absent du vocabulaire, lieu inconnu…) ;
- les **lieux manquants** : le thème demandait un décor qui n'existe pas (un bureau…), l'IA a joué la scène dans le lieu le plus proche. C'est la liste des décors à dessiner ensuite ;
- les **mots demandés** jamais employés, ou seulement dans une mauvaise réponse ;
- les **mots ajoutés** par l'IA hors de la liste ;
- les **doutes de l'IA** ;
- la liste de contrôle du relecteur (chinois, pinyin, mauvaises réponses, niveau), puis la validation : son nom dans Leçon › « relu par ».

Le nom du relecteur est gardé dans le paquet (`pack.json` → `source.relu`).

Démonstration : `brouillons/negocier-un-prix.xlsx` (thème « rendez-vous d'affaires », 20 mots HSK 2, rédigé par Claude),
jouable avec `index.html?client=demo-ia`. **Pas encore relu par Nuwa.**
