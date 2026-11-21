#!/bin/sh
# Appends one row to the decision trail with the machine's time, so no row's time is typed by hand.
# (Nov 20 and 21: a lead guessed its rows' times and ran 90 minutes ahead, twice.)
# Use: sh scripts/trail.sh <area> "<text>"
set -eu
[ $# -eq 2 ] || { echo 'use: sh scripts/trail.sh <area> "<text>"' >&2; exit 2; }
printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%MZ)" "$1" "$2" >> "$(dirname "$0")/../docs/agent-handoff/decisions.tsv"
# Every helper's worktree must be named in handoff.md's Now block, so a restart finds it. (Nov 21: a lead's edit of the
# block cut the lines of three running helpers.) Says which branch is missing; add its line to the block, or remove
# the worktree if its unit has merged.
root="$(dirname "$0")/.."
git -C "$root" worktree list --porcelain 2>/dev/null | sed -n 's|^branch refs/heads/||p' | while read -r b; do
  [ "$b" = lead-backlog ] && continue
  grep -q "\`$b\`" "$root/docs/agent-handoff/handoff.md" || echo "trail.sh: the worktree branch '$b' is not named in handoff.md's Now block: add its line there, or remove the worktree if it has merged" >&2
done
