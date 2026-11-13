# Découpe un lot de mots lus en liste aux silences, puis normalise chaque clip (méthode du jeu : -17 LUFS, limiteur, mono 44,1 kHz 64 kb/s).
import subprocess, re, sys, os
src, cles, sortie = sys.argv[1], sys.argv[2].split(','), sys.argv[3]
os.makedirs(sortie, exist_ok=True)
log = subprocess.run(['ffmpeg', '-hide_banner', '-i', src, '-af', 'silencedetect=noise=-40dB:d=0.12', '-f', 'null', '-'], capture_output=True, text=True).stderr
deb = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', log)]; fin = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', log)]
duree = float(re.search(r'Duration: (\d+):(\d+):([\d.]+)', log).group(3)) + 60 * int(re.search(r'Duration: (\d+):(\d+)', log).group(2))
sil = [(d, f) for d, f in zip(deb, fin + [duree] * (len(deb) - len(fin)))]
if sil and sil[0][0] < 0.05: sil = sil[1:]                       # silence de tête
inter = [s for s in sil if s[1] < duree - 0.1]                    # silences entre deux mots
if len(inter) != len(cles) - 1: sys.exit(f'ARRÊT : {len(inter) + 1} morceaux trouvés pour {len(cles)} mots')
bornes = [0.0] + [x for s in inter for x in s] + [duree]
for i, cle in enumerate(cles):
    a, b = max(0, bornes[2 * i] - 0.06), min(duree, bornes[2 * i + 1] + 0.12)
    tmp = f'{sortie}/_{cle}.wav'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-ss', f'{a:.3f}', '-to', f'{b:.3f}', '-af', 'afade=t=in:d=0.02,areverse,afade=t=in:d=0.04,areverse', tmp], check=True)
    I = float(re.findall(r'I:\s+(-?[\d.]+) LUFS', subprocess.run(['ffmpeg', '-hide_banner', '-i', tmp, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr)[-1])
    gain = -17 - I
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', tmp, '-af', f'volume={gain:.2f}dB,alimiter=limit=0.84:attack=3:release=60:level=disabled', '-ac', '1', '-ar', '44100', '-b:a', '64k', f'{sortie}/{cle}.mp3'], check=True)
    os.remove(tmp)
    print(f'{cle:22s} {a:6.2f}–{b:6.2f} s  ({b - a:.2f} s)  gain {gain:+.1f} dB')
