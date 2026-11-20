# Whisper « small » écoute chaque phrase d'OMPAL SANS connaître le texte attendu (comme un Chinois qui l'entend pour la première fois).
# python3 transcrire.py sortie.jsonl [limite]
import sys, json, wave, time, numpy as np, torch, whisper
torch.set_num_threads(2)
O = '/home/claude/ext/ompal/'
m = whisper.load_model('/home/claude/whisper/small.pt', device='cpu')
fait = set()
try: fait = {json.loads(l)['id'] for l in open(sys.argv[1])}
except FileNotFoundError: pass
lim = int(sys.argv[2]) if len(sys.argv) > 2 else 10**9
ids = [(k, 'apprenant') for k in json.load(open(O + 'non-native_scores.json'))] + [(k, 'natif') for k in json.load(open(O + 'native_scores.json'))]
t0 = time.time(); n = 0
with open(sys.argv[1], 'a') as f:
    for k, g in ids[:lim]:
        if k in fait: continue
        with wave.open(f'{O}wav/SPEAKER{k[1:6]}/{k}.wav') as w: x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
        r = m.transcribe(x, language='zh', task='transcribe', temperature=0.0, fp16=False, condition_on_previous_text=False)
        f.write(json.dumps({'id': k, 'grp': g, 'texte': r['text'], 'duree': len(x) / 16000}, ensure_ascii=False) + '\n'); f.flush(); n += 1
        if n % 50 == 0: print(n, f'{time.time() - t0:.0f} s', flush=True)
print('fini', n, f'{time.time() - t0:.0f} s')
