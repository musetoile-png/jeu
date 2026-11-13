# Atelier d'écriture — module de 千里 Mille li (v0.3, 13 novembre 2026)

En ligne : https://musetoile-png.github.io/jeu/atelier-ecriture/ (téléphone, tablette, ordinateur ; doigt, stylet ou souris).

## Ce que fait l'élève
1. **Réviser** : chaque caractère passe par trois étapes — 1 calque (modèle visible), 2 guidé (le bon trait s'allume dès l'erreur), 3 de mémoire (grille vide, indice après trois erreurs). Un caractère nouveau enchaîne les trois ; ensuite il ne revient qu'en étape 3, à 1 jour, 3 jours, puis des intervalles croissants. Raté de mémoire : retour au guidé, nouvel essai de mémoire 10 minutes plus tard.
2. Chaque carte montre le sens, le pinyin (masquable), la voix du mot et **une phrase du jeu** où le caractère est remplacé par un trou ; la phrase change d'une fois à l'autre (« chaque caractère doit voyager »).
3. **Dictée** : on entend un mot (ou une phrase du jeu) avec la voix ElevenLabs, on écrit les caractères. Les caractères déjà appris viennent en premier.
4. **Carnet** : les caractères du paquet, de l'encre pâle (jamais écrit) à l'encre noire (maîtrisé : 3 réussites et 3 contextes). Choix du paquet (HSK 1, 2, 3, autres, ajoutés), réglages (tolérance, nouveaux par jour, épaisseur du trait), import Excel.
5. **Journal** : un événement par geste (tracé, écoute, indice, ordre montré, pinyin…), avec erreurs par trait, durée, contexte déjà vu ou nouveau, doigt/stylet/souris. Export CSV (séparateur `;`, s'ouvre dans Excel) ou JSON, avec un pseudonyme d'élève.

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
