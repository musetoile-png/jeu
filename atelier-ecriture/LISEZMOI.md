# Atelier d'écriture — module de 千里 Mille li (v0.8, 21 novembre 2026)

En ligne : https://musetoile-png.github.io/jeu/atelier-ecriture/ (téléphone, tablette, ordinateur ; doigt, stylet ou souris).

## Ce que fait l'élève
1. **Réviser** : chaque caractère passe par trois étapes — 1 calque (modèle visible), 2 guidé (le bon trait s'allume dès l'erreur), 3 de mémoire (grille vide, indice après trois erreurs). Un caractère nouveau enchaîne les trois ; ensuite il ne revient qu'en étape 3, à 1 jour, 3 jours, puis des intervalles croissants. Raté de mémoire : retour au guidé, nouvel essai de mémoire 10 minutes plus tard.
2. Chaque carte montre le sens, le pinyin (masquable), la voix du mot et **une phrase du jeu** où le caractère est remplacé par un trou ; la phrase change d'une fois à l'autre (« chaque caractère doit voyager »).
3. **Dictée** : on entend un mot (ou une phrase du jeu) avec la voix ElevenLabs, on écrit les caractères. Les caractères déjà appris viennent en premier.
4. **Carnet** : les caractères du paquet, de l'encre pâle (jamais écrit) à l'encre noire (maîtrisé : 3 réussites et 3 contextes). Choix du paquet (HSK 1, 2, 3, autres, ajoutés), réglages (tolérance, nouveaux par jour, épaisseur du trait), import Excel.
5. **Journal** : un événement par geste (tracé, écoute, indice, ordre montré, pinyin…), avec erreurs par trait, durée, contexte déjà vu ou nouveau, doigt/stylet/souris. Export CSV (séparateur `;`, s'ouvre dans Excel) ou JSON, avec un pseudonyme d'élève.

## Ordre de présentation des caractères (v0.8)
- Paquets du jeu (HSK 1, 2, 3, autres) : l'ordre où le jeu enseigne les caractères.
- Dès qu'un paquet importé (Anki, Word, Excel) est choisi, ses caractères passent **d'abord, dans l'ordre du cours** — y compris ceux que le jeu connaît déjà (给你 « tenez », 护照 « passeport »…). Les caractères déjà appris sont sautés comme nouveaux ; les révisions dues restent mélangées aux nouveaux.
- Chaque caractère importé garde son rang par paquet (`rangs` dans `ecriture_ajouts_v1`). Pour un import fait avant la v0.8, le rang est retrouvé à partir des fiches (approché pour les caractères qui n'apparaissent que dans des phrases) ; réimporter le paquet donne l'ordre exact, sans perdre la progression.

## Moins de « on recommence », bilan court, geste animé (v0.7, retours du 21 novembre)
- **Notation plus douce, révisions plus nombreuses** (`moteur-ecriture.js`, `noter`) : étapes 1 et 2 avancent toujours ; à l'étape de mémoire, « parfait » (0 erreur), « réussi » (1 trait raté, 2 erreurs au plus), « presque » (quelques traits ratés : revient de mémoire dans 5 min, sans repasser par le guidé), « pas encore » (la moitié des traits ratés, ou ordre montré : guidé puis mémoire 10 min plus tard). Un caractère récent réussi revient en petit rappel 10 minutes après.
- **Bilan court** : une ligne par trait raté (numéro, nom du trait, l'erreur en quelques mots) ; les conseils de geste sont repliés dans « Comment les écrire » ; l'histoire ne s'ouvre plus d'elle-même quand il y a un bilan (le bouton reste disponible).
- **« Voir le geste »** (ex-« Revoir ce trait », qui animait la grande grille hors de l'écran) : anime les traits ratés en rouge, lentement, dans le bilan lui-même. « Montrer l'ordre » et « Indice » ramènent la grille à l'écran.

## Histoires, cours Word et relecture de Nuwa (v0.6)
- **Les 235 caractères ont une histoire et un moyen mnémotechnique**, rédigés par Claude : `sources/brouillons/*.json` (`{"car": {"h": histoire, "m": mnémo}}`), statut « brouillon à vérifier par Nuwa » affiché dans l'atelier. Conventions : « explication traditionnelle », « origine discutée », « pour le son ».
- **Relecture** : `sources/histoires-a-verifier.xlsx` (onglets Histoires + Mode d'emploi). Nuwa met « validé » ou corrige le texte ; importé dans l'atelier (Carnet → Importer), il s'applique sur l'appareil (stockage `ecriture_corrections_v1`, pas de paquet créé). Pour l'intégrer au jeu : reporter les lignes validées ou corrigées dans `sources/histoires-validees.json` (même format que les brouillons) et relancer `construire.py`.
- **Cours Word (.docx)** : `import-word.js` lit les tableaux de vocabulaire (en-têtes 词 ou Mot, Pinyin, Sens, Analyse), découpe l'analyse d'un mot caractère par caractère (« 机 : … 场 : … »), et reprend les phrases chinoises du cours comme contextes (sans traduction, voix du navigateur). Affiché dans « Histoire et mnémo » sous « Analyse du cours ». Le contenu reste sur l'appareil : il n'est pas dans le dépôt.
- Corrigé : le sens du type « dans 手机 (…) » ne donne plus la réponse aux étapes 2 et 3 ; pinyin des particules (个 gè, 吗 ma, 吧 ba…).

## Retours de Manu du 16 novembre (v0.5)
- **Nouveaux et révisions mélangés** : la séance répartit les nouveaux caractères entre les révisions (ex. 2 révisions, 1 nouveau…). Correction d'un bug : le moteur ignorait le réglage « nouveaux par jour » et restait à 5.
- **Histoire et mnémo pendant la révision** : bouton à côté des aides ; à l'étape de mémoire, le caractère lui-même est masqué dans le texte. Ouvert sans pénalité, noté dans le journal (`histoire`).
- **Dictée dans une phrase** : la phrase à trous s'affiche au-dessus de la grille, la case à écrire clignote en rouge ; indices **Pinyin** (syllabe du caractère en rouge dans le pinyin du mot) et **Sens** (le mot, puis la phrase, sans révéler les caractères à écrire) ; « Je ne sais pas » anime le caractère. Indices notés dans le journal (`aide_pinyin`, `aide_sens`).

## Aide pédagogique : dire ce qui ne va pas (v0.4)
`diagnostic-traits.js` compare le trait dessiné (Hanzi Writer le transmet à chaque erreur) aux lignes médianes des traits attendus :
- **ordre** : le trait dessiné ressemble à un autre trait du caractère (plus tard ou déjà fait) ;
- **sens** : départ et arrivée inversés ;
- **forme** : point trop long, crochet oublié ou en trop, coude oublié ou en trop, mauvaise direction ;
- **place et longueur** : plus haut, plus à gauche…, trop court, trop long.
Chaque trait attendu est classé (point, horizontal, vertical, 撇, 捺, 提, coude, crochet) avec un conseil (« pose, appuie, relâche », « finis par un petit coup sec vers la gauche »…). Le nom chinois n'est affiché que pour les traits courants reconnus avec sûreté.
Pendant le tracé : un message sous la grille à chaque erreur. Après le tracé : « Ce qui a coincé », une planche avec les traits à revoir en rouge (numéro, départ, sens) et un bouton pour les revoir animés. Même chose en dictée. Le journal reçoit une colonne `diagnostics` (ex. `t1:ordre|t4:crochet_oublie`).

## Importer un paquet Anki (.apkg)
Carnet → « Choisir un fichier » → le `.apkg` exporté d'Anki. Tout se passe dans le navigateur, rien n'est envoyé.
- Chaque fiche est lue (recto, verso) : le chinois (premier segment), le pinyin (balises `<ruby>` ou texte accentué), le français, les sons `[sound:…]`, les textes à trous `{{c1::…}}`. Ce qui suit un saut de ligne double et les champs supplémentaires deviennent la « note du cours ».
- Chaque caractère chinois devient un caractère à écrire ; chaque fiche de 2 caractères ou plus devient une phrase de contexte, avec l'enregistrement de la prof (gardé dans IndexedDB sur l'appareil) ou, à défaut, la voix du navigateur.
- Le paquet apparaît comme un groupe « ★ nom » dans le carnet : le sélectionner seul, le renommer, le retirer (la progression est gardée). Réimporter une version corrigée remplace l'ancienne.
- Formats lus : Anki récent (`collection.anki21b`, zstd + liste des sons en protobuf), et anciens (`collection.anki21`, `collection.anki2`, liste JSON).
- Le format n'est pas propriétaire : Anki est un logiciel libre (AGPL) et un `.apkg` est un zip contenant une base SQLite. Le contenu d'un paquet (fiches, voix) appartient à qui l'a fait : il reste sur l'appareil de l'élève ; ne pas le publier dans le dépôt sans l'accord de l'autrice.

## Fichiers
- `index.html` + `ecriture.js` : la page.
- `moteur-ecriture.js` : répétition espacée de l'écriture + journal, sans DOM — à réutiliser tel quel dans le jeu (le « pinceau »).
- `donnees/caracteres.js` : **généré** par `sources/construire.py` à partir de `src/content/languages/zh/lexicon.json` et des scènes des paquets (phrases justes seulement, avec traduction et voix). Relancer le script après chaque ajout au lexique.
- `traits/` : données de traits Make Me a Hanzi (caractères du jeu + HSK 1 à 3 de 2021 : 940 fichiers, 3,8 Mo), **non modifiées**, avec `ARPHICPL.TXT`. Les autres caractères se chargent depuis jsDelivr (connexion nécessaire).
- `import-word.js` : lecture des cours Word (.docx).
- `diagnostic-traits.js` : diagnostic des traits faux et planche de correction (sans DOM, réutilisable dans le jeu).
- `import-anki.js` : lecture des `.apkg` (chargé, avec ses bibliothèques, seulement au moment d'importer).
- `lib/` : Hanzi Writer 3.7.3 (MIT), SheetJS 0.18.5 (Apache 2.0), sql.js 1.16.0, fflate 0.8.3, fzstd 0.1.1 (MIT), copiés pour ne dépendre d'aucun service.
- `sources/histoires.json` : histoires et moyens mnémotechniques du prototype du 11 novembre ; `sources/prototype-11-novembre.html` : le prototype d'origine.

## Licences (à relire par un juriste avant une vente)
- Hanzi Writer, sql.js, fflate, fzstd : MIT. SheetJS : Apache 2.0.
- Données de traits (Make Me a Hanzi, `graphics.txt` → paquet `hanzi-writer-data`) : **Arphic Public License**. Usage commercial permis ; obligations : garder `ARPHICPL.TXT` inchangé avec les données, signaler toute modification des fichiers de traits et la redistribuer sous la même licence, n'ajouter aucune restriction. La licence porte sur les données, pas sur le code du jeu.
- Le dictionnaire de Make Me a Hanzi (`dictionary.txt`, LGPL) n'est **pas** utilisé.

## Construire
```
npm pack hanzi-writer-data@2.0.1   # puis décompresser
git clone https://github.com/drkameleon/complete-hsk-vocabulary   # liste HSK 2021 (MIT)
pip install pypinyin                # aide au découpage du pinyin (les tons viennent du lexique)
python3 atelier-ecriture/sources/construire.py <dossier hanzi-writer-data/package> <dossier complete-hsk-vocabulary>
```
