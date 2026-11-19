# Écoute chaque enregistrement OMPAL avec chinese-hubert-base (pré-entraîné sur 10 000 h de chinois) et résume chaque syllabe.
# Pour chaque couche choisie : moyenne des 3 tiers de la syllabe + 150 ms avant + 150 ms après (5 x 768 nombres).
# Les frontières des syllabes sont celles du module (b-seul.jsonl), comme pour l'oreille.
import sys, json, wave, time, numpy as np, torch
from transformers import HubertModel
torch.set_num_threads(2)
COUCHES = [3, 6, 9, 12]
m = HubertModel.from_pretrained('/home/claude/hubert').eval()
entree, sortie = sys.argv[1], sys.argv[2]; lim = int(sys.argv[3]) if len(sys.argv) > 3 else 10**9
def lire(f):
    with wave.open(f) as w: return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
def moy(H, a, b):
    a, b = max(0, a), min(len(H), b)
    return H[a:b].mean(0) if b > a else np.zeros(H.shape[1], np.float32)
X, meta, t0 = [], [], time.time()
for n, ligne in enumerate(open(entree)):
    if n >= lim: break
    rec = json.loads(ligne); x = lire(rec['audio']); x = (x - x.mean()) / (x.std() + 1e-7)
    with torch.no_grad(): hs = m(torch.from_numpy(x)[None], output_hidden_states=True).hidden_states
    Hs = [hs[c][0].numpy() for c in COUCHES]   # trames de 20 ms
    T = len(Hs[0])
    for s in rec['syll']:
        if s['att'] == 5: continue
        d, f = s['debut'] / 0.02, s['fin'] / 0.02
        a, b = int(np.floor(d)), max(int(np.ceil(f)), int(np.floor(d)) + 1)
        t1, t2 = a + (b - a) / 3, a + 2 * (b - a) / 3
        v = [np.concatenate([moy(H, a, int(round(t1)) or a + 1), moy(H, int(round(t1)), int(round(t2))), moy(H, int(round(t2)), b), moy(H, a - 8, a), moy(H, b, b + 8)]) for H in Hs]
        X.append(np.stack(v).astype(np.float16))
        meta.append({k: rec.get(k) for k in ('id', 'loc', 'grp')} | {k: s[k] for k in ('k', 'p', 'att', 'pos', 'verdict')} | {'dur': s['fin'] - s['debut'], 'n': len(rec['syll'])})
    if n % 100 == 0: print(n, f'{time.time() - t0:.0f} s', flush=True)
np.savez(sortie, X=np.stack(X), meta=np.array([json.dumps(x, ensure_ascii=False) for x in meta]))
print(sortie, len(X), 'syllabes', f'{time.time() - t0:.0f} s')
