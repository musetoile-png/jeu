# Essai de chinese-hubert-base comme « oreille » (19 novembre 2026)

Modèle : https://huggingface.co/TencentGameMate/chinese-hubert-base (licence MIT, pré-entraîné sur 10 000 h de WenetSpeech, corpus réservé à un usage non commercial : à faire vérifier avant tout usage commercial).
Poids (`pytorch_model.bin`, 377 552 987 octets, SHA-256 2fefccd2…e24d8) non versés dans le dépôt : à télécharger depuis la page du modèle, à placer avec `config-chinese-hubert-base.json` (renommé config.json) dans `/home/claude/hubert`.

1. `python3 hubert_traits.py ../../ompal-eval/b-seul.jsonl hubert-ompal.npz` : couches 3, 6, 9, 12 ; par syllabe (frontières du module) : moyenne des 3 tiers + 150 ms avant + 150 ms après. 14 min sur 2 processeurs.
2. `python3 hubert_tete.py <couche> <tons|juge>` : petite tête apprise sur OMPAL, 5 plis officiels, seuil à 90 % des justes réglé par validation croisée interne.
3. `python3 tete_combo.py ompal <pli> 9-tons` (dans `../oreille2/`, avec `commun.py`) : score HuBERT ajouté à la tête de l'oreille v2.
Résultats : `resultats-hubert.jsonl`, `resultats-combo.jsonl` ; synthèse dans le document de projet `claude/mesure-ompal.md`.
