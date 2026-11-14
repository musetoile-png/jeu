# Clients (marque blanche)

Un client = le même moteur, à ses couleurs, avec son contenu et ses propres sauvegardes.
On ne touche jamais au code pour ajouter un client : on ajoute un dossier ici.

## Ouvrir le jeu d'un client

Ajouter `?client=<id>` à l'adresse du jeu :

- `index.html` : Mille li (client par défaut)
- `index.html?client=demo-editeur` : la démonstration « Éditions Exemple » (client fictif)

Un identifiant inconnu ouvre Mille li. Pour livrer un jeu qui s'ouvre directement sur un client, construire avec `VITE_CLIENT=<id> npm run build`.

## Ajouter un client

Créer `content/clients/<id>/client.json` (l'id en minuscules, chiffres et tirets, identique au nom du dossier) :

```json
{
  "id": "mon-client",
  "name": "Nom affiché",
  "mark": "中文",
  "tagline": { "fr": "Petite ligne sous le nom" },
  "description": { "fr": "Description de la page" },
  "pack": "shanghai",
  "uiLanguage": "fr",
  "storagePrefix": "mon-client",
  "theme": { "paper": "#eef2f6", "accent": "#1e5fa8" }
}
```

| Champ | Rôle |
| --- | --- |
| `name`, `mark`, `tagline` | En-tête, titre de l'onglet, bilan pour l'enseignant |
| `inkTitle` | `true` : l'en-tête reprend le titre du paquet, à l'encre du carnet (Mille li) |
| `pack` | Paquet de contenu joué (`content/packs/<pack>`) |
| `uiLanguage` | Langue de l'interface et des explications (`content/ui-strings/<langue>.json`) |
| `storagePrefix` | Préfixe des sauvegardes dans le navigateur. Unique par client, et à ne jamais changer une fois des élèves inscrits : ils perdraient leur progression |
| `theme` | Couleurs et polices : `paper`, `paper2`, `ink`, `ink2`, `mute`, `accent`, `highlight`, `success`, `display`, `body`. Une clé absente garde la valeur de Mille li |
| `fontsUrl` | Feuille de polices supplémentaire (Google Fonts…) |

Puis lancer `node tools/validate.mjs` : il vérifie que le paquet existe, que l'interface est traduite, que le préfixe n'est pas déjà pris et que les clés du thème sont connues.

## Une autre langue cible

La langue apprise vient du paquet (`pack.json` → `language`), décrite dans `content/languages/<code>/language.json`.
Les champs propres à une langue y vivent, plus dans le code : `transcription` (pinyin, furigana… ; absent = pas de bouton de transcription), `transcriptionLabel`, `transcriptionShort`, `calligraphy` (police des enseignes et titres), `font`.
