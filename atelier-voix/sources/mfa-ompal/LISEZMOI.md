# Découpage des syllabes par le Montreal Forced Aligner sur OMPAL (20 novembre 2026)

`preparer_mfa.py` → `mfa align` (installation décrite en tête du script) → `comparer_bornes.py` (compare aux frontières du module et écrit `b-mfa.jsonl`)
→ `../aishell/traits_son.py b-mfa.jsonl mfa.npz` → dans `../oreille2/` : `SUFFIXE=-mfa OMPAL_NPZ=.../mfa.npz python3 oreille2.py ompal <pli>`, `tete_jugement.py ompal <pli>`, `tete_v3.py <pli>`, `seuils.py <pli>`.
Juge final (tout OMPAL, frontières MFA) : `../oreille2/oreille-v3-mfa.pt` + `tete-v3-mfa.pkl`. Résultats : `../oreille2/resultats-*-mfa.jsonl` ; synthèse : document de projet `claude/mesure-ompal.md`.
