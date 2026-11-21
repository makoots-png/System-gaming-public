#!/bin/sh
# Appends one row to the decision trail with the machine's time, so no row's time is typed by hand.
# (Nov 20 and 21: a lead guessed its rows' times and ran 90 minutes ahead, twice.)
# Use: sh scripts/trail.sh <area> "<text>"
set -eu
[ $# -eq 2 ] || { echo 'use: sh scripts/trail.sh <area> "<text>"' >&2; exit 2; }
printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%MZ)" "$1" "$2" >> "$(dirname "$0")/../docs/agent-handoff/decisions.tsv"
