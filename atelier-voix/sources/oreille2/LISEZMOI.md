# Oreille v2 : réentraînée avec AISHELL + OMPAL (19 novembre 2026)

Résultats et explications : document de projet `claude/mesure-ompal.md` ; chiffres par pli : `resultats-plis.jsonl`.

## Refaire
1. Images du son AISHELL : archives `data_aishell/wav/S*.tar.gz` dans `/mnt/user-data/uploads/AISHELL/...`, transcriptions passées dans `../aishell/aishell-pinyin.py` → `/home/claude/aishell/phrases.json`, puis `bash tout.sh` (149 voix de `../aishell/locuteurs-choisis.txt`, 100 phrases chacune, environ 15 min sur 2 processeurs).
2. OMPAL : voir `../ompal/LISEZMOI.md` (produit `seul.npz`).
3. `python3 oreille2.py <base|ompal|mixte|zero> <pli 1-5>` puis `python3 tete_jugement.py <même oreille> <pli>`.
4. Juge final : `python3 oreille2.py ompal 0` puis `python3 tete_finale.py` → `oreille-v2.pt` + `tete-v2.pkl` (scikit-learn 1.9).
Chemins : écrits en dur pour l'environnement de Claude (`/home/claude/...`), comme les autres scripts de `sources/`.
