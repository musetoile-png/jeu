#!/bin/bash
# aishell_locuteur.sh 0003 M : mêmes 100 phrases qu'avant → frontières + image du son de chaque syllabe
s=$1; g=$2; d=/home/claude/ecoute/tmp/S$s; rm -rf $d; mkdir -p $d
tar -xzf /mnt/user-data/uploads/AISHELL/data_aishell/wav/S$s.tar.gz -C $d
python3 - "$s" "$g" "$d" <<'PY'
import json, sys, glob, os
s, g, d = sys.argv[1:4]
ph = json.load(open('/home/claude/aishell/phrases.json'))
uids = sorted({json.loads(l)['uid'] for l in open(f'/home/claude/aishell/sorties/S{s}.jsonl')})
wav = {os.path.basename(f)[:-4]: f for f in glob.glob(f'{d}/**/*.wav', recursive=True)}
jobs = [{'id': u, 'audio': wav[u], 'hanzi': ph[u]['hanzi'], 'pinyin': ph[u]['pinyin'], 'extra': {'loc': 'S' + s, 'sexe': g}} for u in uids if u in wav]
json.dump(jobs, open(f'{d}/travaux.json', 'w'), ensure_ascii=False)
PY
node /home/claude/ecoute/bornes.js $d/travaux.json $d/bornes.jsonl > /dev/null && python3 /home/claude/ecoute/traits_son.py $d/bornes.jsonl /home/claude/ecoute/aishell/S$s.npz >> /home/claude/ecoute/journal.txt 2>&1
rm -rf $d
