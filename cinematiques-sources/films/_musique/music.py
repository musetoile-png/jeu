"""Musique sous les films : un extrait d'un morceau fourni, posé en stéréo, fondu et baissé sous les voix.

Réglages dans timeline.json → "music" :
  file      chemin du morceau, relatif au dossier du film
  start     seconde du morceau qui tombe au temps 0 du film (calée sur un moment de l'image)
  gain      niveau du morceau (avant la normalisation finale)
  fadeIn / fadeOut   fondus au début et à la fin du film (s)
  duck      [[début, fin], …] passages où la musique se retire (voix), de duckDb décibels
"""
import pathlib, subprocess
import numpy as np


def add_music(mx, T, here, sr):
    M = T.get('music')
    if not M:
        return None
    path = (pathlib.Path(here) / M['file']).resolve()
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(M['start']), '-t', str(T['duration'] + 0.5), '-i', str(path),
                          '-f', 'f32le', '-ac', '2', '-ar', str(sr), '-'], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).astype(float).reshape(-1, 2)
    n = min(len(x), mx.n)
    x = x[:n]
    t = np.arange(n) / sr
    g = np.ones(n) * M.get('gain', 0.5)
    fi, fo = M.get('fadeIn', 0.0), M.get('fadeOut', 1.0)
    if fi > 0:
        g *= np.clip(t / fi, 0, 1)
    g *= np.clip((T['duration'] - t) / max(fo, 1e-3), 0, 1)
    # baisse sous les voix, avec des rampes de 0,15 s
    duck = np.ones(n)
    low = 10 ** (M.get('duckDb', -9) / 20)
    for a, b in M.get('duck', []):
        r = 0.15
        k = np.clip(np.minimum((t - (a - r)) / r, ((b + r) - t) / r), 0, 1)
        duck = np.minimum(duck, 1 - (1 - low) * k)
    mx.dry[:n] += x * (g * duck)[:, None]
    return path.name
