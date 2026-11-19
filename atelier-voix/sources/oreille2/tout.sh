#!/bin/bash
# traite les locuteurs au fur et à mesure que les archives arrivent (2 en parallèle)
cd /home/claude/aishell
while read s g; do
  [ -s npz/S$s.npz ] && continue
  arc=/mnt/user-data/uploads/AISHELL/data_aishell/wav/S$s.tar.gz
  for i in $(seq 1 900); do [ -s "$arc" ] && break; sleep 2; done
  a=0; b=1; while [ "$a" != "$b" ]; do a=$(stat -c%s "$arc"); sleep 3; b=$(stat -c%s "$arc"); done
  while [ $(jobs -r | wc -l) -ge 2 ]; do sleep 1; done
  bash scripts/un_locuteur.sh $s $g >> journal.txt 2>&1 &
done < /home/claude/jeu/atelier-voix/sources/aishell/locuteurs-choisis.txt
wait; echo FINI >> journal.txt
