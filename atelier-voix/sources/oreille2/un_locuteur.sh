#!/bin/bash
# un_locuteur.sh 0003 M : archive AISHELL -> 100 phrases -> frontières (module) -> image du son (npz)
s=$1; g=$2; arc=/mnt/user-data/uploads/AISHELL/data_aishell/wav/S$s.tar.gz
S=/home/claude/jeu/atelier-voix/sources; d=/home/claude/aishell/tmp/S$s; rm -rf $d; mkdir -p $d
tar -xzf "$arc" -C $d || { echo "S$s archive illisible"; exit 1; }
python3 -I - "$s" "$g" "$d" <<'PY'
import json, sys, glob, os, random
s, g, d = sys.argv[1:4]
ph = json.load(open('/home/claude/aishell/phrases.json'))
wav = {os.path.basename(f)[:-4]: f for f in glob.glob(f'{d}/**/*.wav', recursive=True)}
uids = sorted(u for u in wav if u in ph); random.Random(int(s)).shuffle(uids)
jobs = [{'id': u, 'audio': wav[u], 'hanzi': ph[u]['hanzi'], 'pinyin': ph[u]['pinyin'], 'extra': {'loc': 'S' + s, 'sexe': g, 'grp': 'aishell'}} for u in uids[:100]]
json.dump(jobs, open(f'{d}/travaux.json', 'w'), ensure_ascii=False)
PY
MOTEUR=$S/calibrage/moteur-exp.js node $S/aishell/bornes.js $d/travaux.json $d/bornes.jsonl > /dev/null && python3 $S/aishell/traits_son.py $d/bornes.jsonl /home/claude/aishell/npz/S$s.npz
rm -rf $d "$arc"
