#!/bin/sh
# Runs the browser tests on GitHub's machines: sends the clean copy of the commit at HEAD (scripts/publish-clean.ts:
# no history, the owner's name and email out) to the public repository, where .github/workflows/ci.yml runs the unit
# tests and the browser tests in six parts, about six minutes. Only what is committed is sent.
#   sh scripts/ci-public.sh        sends the copy as one more commit on the public main; prints the tree id of HEAD
#   sh scripts/ci-public.sh tree   only prints that id
# When that commit's run is green (the repository's Actions page, or
#   curl -s https://api.github.com/repos/<owner>/<name>/actions/runs?per_page=1 ), push here with
#   CI_BROWSER_REMOTE=<the id> git push ...
# and the hook skips the browser pass (scripts/ci.ts); the typecheck, the unit tests and the lag test still run here.
# The public commit's message names the tree, so a run can be matched to what it tested.
# CI_PUBLIC_DIR is a clone of the public repository this session may push to (default ../system-gaming-public).
set -e
tree=$(git rev-parse 'HEAD^{tree}')
if [ "$1" = tree ]; then echo "$tree"; exit 0; fi
root=$(git rev-parse --show-toplevel)
pub="${CI_PUBLIC_DIR:-$root/../system-gaming-public}"
[ -d "$pub/.git" ] || { echo "No clone of the public repository at $pub (set CI_PUBLIC_DIR)" >&2; exit 1; }
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
(cd "$root" && bun scripts/publish-clean.ts "$out/copy") >&2
git -C "$pub" pull -q --ff-only >&2
git -C "$pub" ls-files -z | (cd "$pub" && xargs -0 rm -f)
cp -a "$out/copy/." "$pub/"
git -C "$pub" add -A
if git -C "$pub" diff --cached --quiet; then echo "The public copy already holds this tree" >&2; echo "$tree"; exit 0; fi
git -C "$pub" -c user.name="Hunter Builder" -c user.email="hunter-builder@users.noreply.github.com" commit -q -m "Copy of $tree" >&2
git -C "$pub" push -q origin HEAD:main >&2
echo "$tree"
