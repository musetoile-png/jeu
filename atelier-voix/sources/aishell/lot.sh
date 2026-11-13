#!/bin/bash
# lot.sh S1 G1 S2 G2 ... : traite les locuteurs deux par deux en parallèle
while [ $# -gt 0 ]; do
  /home/claude/aishell/scripts/traiter.sh $1 $2 & 
  if [ $# -ge 4 ]; then /home/claude/aishell/scripts/traiter.sh $3 $4; shift 2; fi
  wait; shift 2
done
