#!/bin/bash
# Runs the realism harness on many seeds in parallel (JSON rows), then aggregates.
#   bash sweep.sh <scratch checkout> <out.jsonl> <jobs> <boot> seed...
dir=$1; out=$2; jobs=$3; boot=$4; shift 4
: > "$out"
printf '%s\n' "$@" | xargs -P "$jobs" -I{} sh -c "cd '$dir' && node --experimental-strip-types --no-warnings src/sim/history/realismStats.ts {} --boot $boot --json >> '$out'"
cd "$dir" && node --experimental-strip-types --no-warnings src/sim/history/realismStats.ts --from "$out"
