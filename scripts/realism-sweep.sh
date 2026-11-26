#!/bin/bash
# Realism seed sweep (realism-metrics.md step 3): runs src/sim/history/realismStats.ts on many seeds in parallel as
# --json rows, then prints the aggregate target table (p10 / median / p90 when there are more than 6 rows).
#   bash scripts/realism-sweep.sh <out.jsonl> [jobs=2] [boot=0] [seed ...]
#   OPTS='{"goods":false}' bash scripts/realism-sweep.sh off.jsonl 2 0      (HistoryOptions for every run)
# Default seeds: the 22-seed realism sweep (1 7 42 1234 + 18 more). ~35-70 s per seed on a loaded 2-core box.
# Rows are appended in completion order (not seed order); --from / --vs / --check match rows by seed.
set -eu
cd "$(dirname "$0")/.."
out=${1:?usage: realism-sweep.sh <out.jsonl> [jobs] [boot] [seed ...]}
jobs=${2:-2}; boot=${3:-0}
shift $(( $# < 3 ? $# : 3 ))
seeds=("$@")
[ ${#seeds[@]} -gt 0 ] || seeds=(1 7 42 1234 2 3 4 5 6 8 9 10 11 12 13 77 99 1337 2024 31337 99999 123456)
export OPTS=${OPTS:-'{}'} BOOT=$boot
: > "$out"
# OPTS goes through the environment: xargs -I would also substitute the {} inside a JSON argument.
printf '%s\n' "${seeds[@]}" | xargs -P "$jobs" -I{} \
  sh -c 'node --experimental-strip-types --no-warnings src/sim/history/realismStats.ts {} --boot "$BOOT" --opts "$OPTS" --json' >> "$out"
node --experimental-strip-types --no-warnings src/sim/history/realismStats.ts --from "$out"
