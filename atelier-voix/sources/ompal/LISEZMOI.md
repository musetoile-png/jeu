# Mesure sur OMPAL (vrais apprenants français) — 19 novembre 2026

Corpus : https://github.com/phantomhsieh/OMPAL-corpus (licence CC BY 4.0, fichier LICENSE vérifié ; citer Hsieh et al., Interspeech 2025, DOI 10.21437/Interspeech.2025-983).
46 apprenants français + 3 natifs, 1 850 enregistrements. Pour chaque caractère : ton juste (1) ou faux (0) selon 3 professeurs (fichier `non-native_scores-detail.json`). Étiquette retenue : majorité des 3.

## Refaire la mesure
```bash
git clone --depth 1 https://github.com/phantomhsieh/OMPAL-corpus.git /chemin/ompal
pip install pypinyin torch numpy scikit-learn
python3 preparer.py /chemin/ompal/        # pinyin (pypinyin + corrections relues à la main, voir REGLES) ; voix modèle = enregistrement natif OMPAL de la même phrase
export MOTEUR=../calibrage/moteur-exp.js
node ../aishell/bornes.js travaux-seul.json b-seul.jsonl ; node ../aishell/bornes.js travaux-modele.json b-modele.jsonl
python3 ../aishell/traits_son.py b-seul.jsonl seul.npz ; python3 ../aishell/traits_son.py b-modele.jsonl modele.npz
python3 juger_ompal.py /chemin/ompal/ ../aishell/oreille.pt seul.npz modele.npz
```
Durée : 1 min (sans modèle) + 5 min (avec modèle) sur 2 processeurs. Résultat complet : `mesure-2026-11-19.log`, `resultats-ompal.json`.

Notes : 個 est passé en 个 pour la règle de 一 ; tons neutres (5) non jugés ; 1 phrase au découpage irrégulier et 7 mots à variante (還/也, 會/又) écartés.
