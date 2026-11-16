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
| Mots | un mot | caractères, pinyin, traduction, et facultativement l'**analyse** du prof (7ᵉ colonne). Un mot déjà connu du jeu est réutilisé (même voix, même carnet) ; s'il est donné avec un autre sens, un autre pinyin ou une analyse, il est **surchargé** pour cette leçon (voir plus bas) |
| Scènes | une scène | un lieu et un personnage du Catalogue ; les scènes s'ouvrent l'une après l'autre |
| Répliques | une réplique ou une question | « dit » : le personnage parle ; « choix » : l'élève choisit sa réponse parmi la bonne et 1 à 3 fausses, chacune avec son explication |

Les phrases s'écrivent normalement (« 我要一杯绿茶。 ») : l'importeur les découpe en mots d'après l'onglet Mots.
Si une découpe est ambiguë, une espace ou une barre la tranche : « 香蕉 很 好吃 ».

## L'analyse du prof et la surcharge d'un mot connu

L'onglet Mots a une 7ᵉ colonne facultative, **Analyse** : la décomposition du mot telle que le prof l'écrit dans son cours
(caractères, composants, étymologie, aide-mémoire). Exemple pour 护照 :

> 护 : 扌(main) + 户 (hù, porte, phonétique) ; sens « protéger ».
> 照 : 昭 (clair, soleil) + 灬 (feu) ; sens « éclairer », puis « document qui atteste ».
> Aide-mémoire : le papier qui te protège et atteste qui tu es.

Les retours à la ligne de la cellule (Alt+Entrée) sont gardés. Les en-têtes des tableaux de cours sont acceptés aussi :
« Pinyin » pour Transcription, « Sens » pour Traduction, « Étymologie » ou « Explication » pour Analyse
(même convention que l'atelier d'écriture, qui lit la colonne « Analyse » des cours Word).

Dans le jeu, un mot qui a une analyse porte un point d'ambre dans le carnet, et il est souligné de points dans les dialogues.
Le toucher (dans le carnet ou dans une réplique) ouvre sa **fiche** en haut du carnet : le mot, son pinyin, son sens, puis « Analyse ».
Le carnet défile si le texte est long. Un mot sans analyse s'affiche comme avant.

**Surcharge.** Un mot que le jeu connaît déjà (你, 护照…) peut être repris dans l'onglet Mots : si la ligne donne une traduction,
un pinyin ou une analyse **différents** de ceux du jeu, l'importeur écrit dans le lexique du paquet une entrée de surcharge
(même identifiant, même caractère que le mot du jeu). Pour cette leçon seulement, l'élève voit le sens et l'analyse du prof ;
la voix, la nature et le niveau du mot restent ceux du jeu, et les autres leçons ne changent pas.
Si la ligne redit exactement ce que le jeu sait déjà, rien n'est écrit. Le résumé de l'import compte les mots nouveaux,
les surcharges et les analyses ; `node tools/validate.mjs` liste les surcharges de chaque paquet (lignes « ↺ »).

Dans `content/packs/<identifiant>/lexicon.json`, une surcharge ne contient que les champs qui changent :

```json
{ "id": "ni", "target": "你", "gloss": { "fr": "tu (sens donné par le cours)" }, "analysis": { "fr": "(l’analyse du cours, recopiée)" } }
```

Seuls `gloss`, `transcription` et `analysis` se surchargent. Le même caractère sous un autre identifiant, ou le même identifiant
pour un autre caractère, reste une erreur du validateur.

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

### Adapter une leçon existante (manuel d'un éditeur, cours d'un prof)

```sh
node tools/generer.mjs consigne --lecon @manuels/lecon-fictive-fruits.txt --niveau "HSK 1" --scenes 1 -o consigne.md
node tools/generer.mjs tableur reponse.md --lecon @manuels/lecon-fictive-fruits.txt
```

Le texte de la leçon (dialogue, vocabulaire, exercices) se colle tel quel dans un fichier texte. L'IA **garde les phrases du dialogue mot pour mot** :
les répliques de l'élève deviennent des questions (la phrase du manuel est la bonne réponse, l'IA écrit les mauvaises), celles des autres personnages sont dites.
Sans `--mots`, la liste à travailler est le vocabulaire de la leçon (生词).
Avec `--lecon`, la commande `tableur` vérifie chaque phrase du dialogue (lignes « locuteur : … ») : toute phrase coupée, modifiée ou oubliée apparaît dans la Relecture.

Si le cours contient une analyse des caractères (colonne « Analyse » du tableau de vocabulaire), l'IA la **recopie mot pour mot**
dans le champ `analyse` du mot (→ colonne Analyse), et liste aussi dans `mots` les mots déjà connus dont le cours donne un sens ou une analyse
(→ surcharge). Elle n'invente jamais d'étymologie. La Relecture signale chaque mot connu surchargé, et chaque analyse
qui ne se retrouve pas telle quelle dans le texte du cours (ou qui existe alors qu'aucun cours n'a été fourni).
Pour que cette vérification marche, coller le tableau de vocabulaire du cours (avec sa colonne Analyse) dans le fichier `--lecon`.

Démonstration : `manuels/lecon-fictive-fruits.txt` (leçon **fictive**, écrite dans le style d'un manuel, elle ne vient d'aucun manuel publié)
→ `brouillons/au-marche-de-fruits.xlsx`, jouable avec `index.html?client=demo-manuel`. Pas encore relue par Nuwa.

`--mots` accepte une liste (virgules, espaces, retours à la ligne) ou `@fichier.txt` (un mot par ligne ; le pinyin et le sens éventuels sont ignorés).

Le brouillon s'ouvre sur l'onglet **Relecture**, qui liste ce que le prof doit regarder :
- les **erreurs à corriger** (trouvées par l'importeur : mot absent du vocabulaire, lieu inconnu…) ;
- les **lieux manquants** : le thème demandait un décor qui n'existe pas (un bureau…), l'IA a joué la scène dans le lieu le plus proche. C'est la liste des décors à dessiner ensuite ;
- les **mots demandés** jamais employés, ou seulement dans une mauvaise réponse ;
- les **mots ajoutés** par l'IA hors de la liste ;
- les **mots connus surchargés** (sens ou analyse du cours à la place de ceux du jeu) et les **analyses à vérifier** ;
- les **doutes de l'IA** ;
- la liste de contrôle du relecteur (chinois, pinyin, mauvaises réponses, niveau), puis la validation : son nom dans Leçon › « relu par ».

Le nom du relecteur est gardé dans le paquet (`pack.json` → `source.relu`).

Démonstration : `brouillons/negocier-un-prix.xlsx` (thème « rendez-vous d'affaires », 20 mots HSK 2, rédigé par Claude),
jouable avec `index.html?client=demo-ia`. **Pas encore relu par Nuwa.**
