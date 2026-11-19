# Brief: the detail panel that will not open again (the audit's BUG-views-1 with SM-views-2)

## The goal, in the owner's words

"Fix the problem and not the symptoms." "Everything must be explicit." No implicit state machines anywhere.
"If we do fuck up, it needs to be obvious where it happened and how to fix it at a glance."

The audit says: `detail.close()` (`src/views/detail.js`, about lines 60 to 67) removes the open panel from the
page by hand without a redraw, so the callers' kept HTML no longer matches the page and a panel cannot be opened
again on a third tap; and which detail is open is held in three places (`detail.js`'s `open`, the callers' caches,
`map.js`'s `mapDt`). The audit's author did not verify it.

## The work

1. Reproduce first: a browser case that fails on today's code, driven by taps as a player makes them (open a
   detail, close it, open it again; then the same on the map's press and hold). If it does not reproduce, record
   that with what you tried in your report and change nothing.
2. Fix at the cause: one owner of which detail is open, and a close that goes the way an open does (a redraw),
   so no caller's cache can differ from the page. If the open one is a state with more than two values or with
   events from several places, it is a small machine in core with its table, as the repository's other machines
   are (`docs/guide/machines.md` says how one is added). Do not add a guard beside the old path: delete the old path.
3. The audit also names `idOf` (percent-encode it). Reproduce that with a thing whose key holds a character an id
   cannot, before fixing it.

## Read only this

- `.claude/skills/poteto-mode/SKILL.md`, its `playbooks/bug-fix.md`, and the leaf skills
  `principle-fix-root-causes`, `principle-model-the-domain`, `principle-test-behavior-not-implementation`.
- `docs/audit/2026-11-19-neon-audit.md`: only line 44, line 70, line 211 and the section `#### SM-views-2`
  (grep the IDs; never read the file whole).
- In `AGENTS.md`, nothing more than what is loaded. In `docs/guide/`, grep `detail` and read those rows only;
  `docs/guide/tests-ci.md` for how a browser test is written.
- `src/views/detail.js`, its callers (grep `api.detail`), and `tests/e2e/look.e2e.ts`'s detail cases.

## Rules of the work

- Work in a worktree of your own: `git worktree add ../sg-views1 -b views-1` from `/home/user/systemgaming`,
  `bun install` there. Commit each step. Do not push. Do not touch `.claude/skills/`.
- Another helper is timing frames on this box. Wrap every test, typecheck and build in `flock /tmp/box.lock`,
  run one browser file at a time with `--workers=1`, and never the lag test (`feel.e2e.ts`).
  Set `E2E_PORT=3231` and `E2E_CHROMIUM=/opt/google/chrome/chrome`. Never `playwright install`.
- Do not change `src/edge/store.ts` or `src/core/save*.ts`: the other helper is in them.
- No fixed waits and no retries in a test. No dashes as punctuation and no cleverness in any text.
  No AI attribution in commits.
- If a lint in `tests/lint.test.ts` names a `let` or a Map you remove or add, keep it true.

## Before you report

`flock /tmp/box.lock bun run typecheck`, `flock /tmp/box.lock bun test tests/lint.test.ts` and any unit test of
a machine you add, then each browser file that draws a detail (`look.e2e.ts`, `battle-map.e2e.ts`,
`map-extras.e2e.ts`, and any other your grep finds), one at a time. If you add a machine: `bun run charts` and
`bun run deps -- --write`.

## Your report, under 300 words

The branch and its commits; whether each fault reproduced and the test that shows it; where the open detail
lives now and what was deleted; the checks you ran with their counts; anything you saw and left.
