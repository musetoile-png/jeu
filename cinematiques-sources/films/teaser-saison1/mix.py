"""Mixe la bande son du teaser : musique ElevenLabs + voix aux temps de timeline.json.
La musique se retire sous les voix (compresseur piloté par la voix), puis le tout est normalisé à -16 LUFS.
Usage : python3 mix.py  (lit audio/musique.mp3 et audio/<voix>.mp3, écrit score.wav)"""
import json, subprocess, pathlib
HERE = pathlib.Path(__file__).parent
T = json.loads((HERE / 'timeline.json').read_text())
dur = T['duration']
inputs = ['-i', str(HERE / 'audio/musique.mp3')]
SFX = HERE / 'audio/sfx.wav'   # bruitages discrets (sfx.py), environ 10 dB sous la musique
parts, labels = [], []
for k, v in enumerate(T['voice'], start=1):
    inputs += ['-i', str(HERE / f"audio/{v['file']}.mp3")]
    ms = int(v['t'] * 1000)
    gain = v.get('gain', 1.0)
    parts.append(f"[{k}:a]aresample=44100,aformat=channel_layouts=stereo,loudnorm=I=-17:TP=-2:LRA=7,volume={gain},adelay={ms}|{ms},apad=whole_dur={dur}[v{k}]")
    labels.append(f'[v{k}]')
n = len(labels)
fc = ';'.join(parts)
fc += f";{''.join(labels)}amix=inputs={n}:normalize=0:duration=longest,atrim=0:{dur}[vo]"
fc += ';[vo]asplit=2[vo1][vo2]'
fc += f";[0:a]aresample=44100,aformat=channel_layouts=stereo,volume=0.62,afade=t=out:st={T['music'].get('fadeOut', 54.6)}:d=1.4,apad=whole_dur={dur},atrim=0:{dur}[mu]"
fc += ';[mu][vo1]sidechaincompress=threshold=0.02:ratio=5:attack=25:release=450:makeup=1[mud]'
if SFX.exists():
    inputs += ['-i', str(SFX)]
    fc += f";[{n + 1}:a]aresample=44100,volume=1.4,apad=whole_dur={dur},atrim=0:{dur}[fx];[mud][fx]amix=inputs=2:normalize=0[mud2]"
else:
    fc += ';[mud]anull[mud2]'
fc += ';[mud2][vo2]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[out]'
cmd = ['ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex', fc, '-map', '[out]', '-ac', '2', '-ar', '48000', str(HERE / 'score.wav')]
subprocess.run(cmd, check=True)
print('wrote score.wav')
