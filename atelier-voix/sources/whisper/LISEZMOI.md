# « Un Chinois te comprendrait-il ? » — Whisper sur OMPAL (20 novembre 2026)

Modèle : Whisper « small » d'OpenAI (`small.pt`, 483 617 219 octets, SHA-256 9ecf7799…e794 = empreinte de l'adresse officielle ; paquet `openai-whisper` 20250625). Poids non versés dans le dépôt.
1. `python3 transcrire.py transcriptions.jsonl` : chaque phrase écoutée SANS le texte attendu (langue zh, température 0). 1 850 phrases en 77 min sur 2 processeurs (≈ 2,5 s par phrase).
2. `python3 analyser.py` puis `python3 pinyin_cer.py` : comparaison au texte attendu (en caractères et en pinyin) et aux notes des professeurs.
3. `../oreille2/tete_whisper.py <pli>` (avec `SUFFIXE=-mfa OMPAL_NPZ=.../mfa.npz`) : l'avis de Whisper ajouté au juge des tons.
Transcriptions brutes : `transcriptions.jsonl`. Synthèse : document de projet `claude/mesure-ompal.md`.
