#!/bin/sh
# A SessionStart hook: fetches the working branch and says how far behind this checkout is.
# Why: on Nov 19 a lead read the handoff from a checkout 57 commits behind its branch and planned from stale notes.
cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
git fetch -q origin "$branch" 2>/dev/null || { echo "This checkout could not fetch origin/$branch: do not trust the handoff notes until it can."; exit 0; }
behind=$(git rev-list --count "HEAD..origin/$branch" 2>/dev/null || echo 0)
[ "$behind" -gt 0 ] && echo "This checkout is $behind commits behind origin/$branch. Run: git merge --ff-only origin/$branch before you read any notes."
exit 0
