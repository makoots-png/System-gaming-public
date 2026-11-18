#!/bin/sh
# Sends the commit at HEAD to the public CI mirror, where GitHub runs the browser tests (.github/workflows/ci.yml).
# What is sent is a snapshot: one commit with no history and a neutral author, without docs/agent-handoff (the lead's
# notes, which no test reads and which are not for a public repository). Prints the snapshot's tree id: the CI's answer
# is for that tree, and `CI_BROWSER_REMOTE=<that id> git push` then skips the browser pass here (scripts/ci.ts).
# With the argument `tree` it only prints the id.
set -e
# The snapshot is not scrubbed of the owner's name, so it has no default mirror: CI_MIRROR must name a repository
# The owner has said may hold it. The public copy (scripts/publish-clean.ts) is the one that goes to a public repository.
MIRROR="${CI_MIRROR:-}"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
GIT_INDEX_FILE="$tmp" git read-tree HEAD
GIT_INDEX_FILE="$tmp" git rm -r -q --cached --ignore-unmatch docs/agent-handoff >/dev/null
tree=$(GIT_INDEX_FILE="$tmp" git write-tree)
if [ "$1" = tree ]; then echo "$tree"; exit 0; fi
if [ -z "$MIRROR" ]; then echo "CI_MIRROR is not set: nothing sent" >&2; exit 1; fi
commit=$(GIT_AUTHOR_NAME="Hunter CI" GIT_AUTHOR_EMAIL="ci@users.noreply.github.com" GIT_COMMITTER_NAME="Hunter CI" GIT_COMMITTER_EMAIL="ci@users.noreply.github.com" \
  GIT_AUTHOR_DATE="2026-01-01T00:00:00Z" GIT_COMMITTER_DATE="2026-01-01T00:00:00Z" git commit-tree "$tree" -m "CI snapshot of $tree")
git push --no-verify --force "$MIRROR" "$commit:refs/heads/ci" >&2
echo "$tree"
