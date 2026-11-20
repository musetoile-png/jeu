# Corpus OMPAL pour le Montreal Forced Aligner : un dossier par locuteur, .wav (lien) + .lab (caractères simplifiés séparés par des espaces).
# Puis : mfa align -j 2 --clean corpus mandarin_mfa.dict mandarin_mfa.zip sortie
#   (MFA 3.4.4 par micromamba depuis conda-forge ; + pip install spacy-pkuseg dragonmapper hanziconv dans son environnement ;
#    modèle acoustique : github.com/MontrealCorpusTools/mfa-models/releases/download/acoustic-mandarin_mfa-v3.0.0/mandarin_mfa.zip ;
#    dictionnaire : dépôt mfa-models, dictionary/mandarin/mfa/mandarin_mfa.dict)
import json, os, opencc
cv = opencc.OpenCC('t2s'); O = '/home/claude/ext/ompal/'
for f in ('non-native_scores.json', 'native_scores.json'):
    for k, u in json.load(open(O + f)).items():
        loc = k[1:6]; d = f'corpus/{loc}'; os.makedirs(d, exist_ok=True)
        if not os.path.exists(f'{d}/{k}.wav'): os.symlink(f'{O}wav/SPEAKER{loc}/{k}.wav', f'{d}/{k}.wav')
        open(f'{d}/{k}.lab', 'w').write(' '.join(cv.convert(u['text'])))
