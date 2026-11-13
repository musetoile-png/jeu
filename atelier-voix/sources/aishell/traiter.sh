#!/bin/bash
# traiter.sh S0003 M : décompresse l'archive d'un locuteur, passe 100 phrases dans le moteur, efface les wav.
s=$1; g=$2; arc=/mnt/user-data/uploads/AISHELL/data_aishell/wav/S$s.tar.gz
for i in $(seq 1 30); do [ -s "$arc" ] && break; sleep 2; done
d=/home/claude/aishell/tmp/S$s; rm -rf $d; mkdir -p $d
tar -xzf "$arc" -C $d && MOTEUR=/home/claude/calibrage/moteur-exp.js node /home/claude/aishell/scripts/aishell-extraire.js /home/claude/aishell/phrases.json $d 100 /home/claude/aishell/sorties/S$s.jsonl S$s $g >> /home/claude/aishell/journal.txt 2>&1
rm -rf $d
