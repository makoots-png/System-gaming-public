# Brief: close the second audit (V7, V8, V9's row M2, lane A's two leftovers, the "Left" sections)

One helper (Opus, heavy-writer) in the main tree, on `claude/zen-pasteur-ov4cgd` at the commit the lead names. Nobody else writes this tree while you work. The general brief is `final/brief-implicit-unit.md` and the lane's is `final/brief-lane.md`: read both first and follow all of both (poteto mode, the cause written before each change, a test that fails without it, a commit by path after each row with a plain message and no attribution line, no push, no helpers, never `git checkout`, `stash` or `reset` a file, never edit `.claude/skills`, no new dependency). Where they differ from this file, this file wins.

## The goal, in the owner's words

"I want it perfect, I do not care about time." "Everything must be explicit. Everything." "For all things we must fix the problem and not the symptoms." "Internal tidiness is everything. Architecture is first because this project is large scale." He ruled on Nov 15 that all fourteen units of the second audit are done in full and that this is the last audit pass. Thirteen and a half units are in. The problem is that the rows below are still a rule a view holds, a copy of a bound, a lint that does not hold what its name says, or a thing a player or GM can meet. The smallest change that meets the goal is each row's remedy as the audit judged it, done where AGENTS.md says that kind of thing lives. Find no new rows beyond step 6: a new audit is not wanted.

## Read first

`AGENTS.md`, `docs/agent-handoff/START-HERE.md`, `docs/agent-handoff/handoff.md` sections 4 and 5, `final/implicit-audit-2.md` and `final/implicit-audit-3.md` (the summaries, every row named below, and the last table of each for a unit's files and tests), `final/notes-V9.md` ("Left, and why"), `final/notes-V10.md` (C3), `final/notes-V13.md` (FP1), `final/notes-lane-A.md` ("For the lead"), `docs/state-machines.md` for any machine you touch, `rw/principles.md`.

## The units, in this order

Notes go in `final/notes-close-audit.md`, one section per unit. Port for every browser run: `E2E_PORT=3260` (never 3233).

1. **Inventory.** For every row below, one line in the notes: still true (file and line), already done by a lane, or changed shape. The audits ran nothing and both lanes have changed these files since. Confirm a `med` or `low` row by a failing test or a run before fixing it. A row that is wrong stays as the code is, with the reason.
2. **V7, dead and wrong words, bounds read.** Audit 2: N11 (sent.ts and `seen`), N12, N19, N16. Audit 3: R2, P1, C4, C5, H7, B5, and the stale headers of `ability-types.ts` and `fight-doc.ts`. C5 is the one a GM meets (a refused fight command shown as its bare key): its words become one table keyed by `Refusal` that the typecheck holds complete, read by combat.js and table.js. Sweep for the class: a bound or a rule value written as a literal in a view beside the constant that owns it.
3. **The two leftovers of lane A.**
   - FP1's second half: a damaged fight dropped at load is told to the player as a damaged save is (`save.ts` `loadSave` answers it, `store.ts` only tells). Read what V13 did first; the clamp is done.
   - C3's second half: a player's Necromancer on another phone extracts a fallen monster. It needs a room message (AGENTS.md, "A room message": its payload and `DEFS` entry, its applier with `once: true` since it changes a hunter, the valid payload and bounds in `tests/protocol.test.ts`, the GM-only refusal in `tests/server-rooms.test.ts`, a GM move in `tests/models/room-world.ts`). Weigh on paper in the notes the variants (a new message that gives a shadow, a shadow as a field of the reward message, the roll made on which phone) and pick the one with the fewest new kinds of thing. The roll is made in a view and its numbers are sent; the fight's `extract` stays the one writer of the corpse's attempts. A browser case with two phones shows it.
4. **V9's row M2**, an ability that follows the recommended formula. The audit's remedy is a union: an effect is by the rule or by hand, and the rule's formula is worked out where a fight reads it. `notes-V9.md` names the files. Name the data shape first and write it in the notes before any code, with the variants weighed (the union in the saved effect; a row worked out from the rule where `formulaEdited` is false). It is a field of a saved thing: AGENTS.md's recipe (the type, the default, the repair line, a case in `tests/save.test.ts`). A test changes a rule the recommendation reads and shows a saved ability that follows it change with it, and one typed by hand stay. The maker's "edited" mark and Reset read the union, not a text compare. Old saves need not keep working.
5. **V8, the lints hold what they name.** Last, because it sweeps what the units before it wrote. Audit 2: N15 and step 3's "fix instead" and "stale" rows. Audit 3: H8, M1, K1, I3, X1. M1 is the one a GM meets (told "saved" for a write the store refused). Each lint fixed or added gets the old offending line as its first case, so the lint is shown to fail on what it names. Never loosen a lint, and never add to an allow-list what the row says to fix.
6. **The "Left" sections.** Read every `final/notes-V*.md`, both lane notes and `final/notes-leftovers.md` once, for anything said to be left, skipped, partial or "for the lead" (the headings differ: search the words, then read around each hit). The third audit's V13 row says "K2 left": find why. For each, one line in the notes: done since, left with a reason a reader would accept (say it), or a row of this unit, which you then do. Rows the first audit left "on purpose" (audit 2 counts 8) stay.

## Closing each unit

After each of units 2 to 6: `bun run deps -- --write`, `bun run charts`, `bun run typecheck`, the whole `bun run test`, then every browser file one at a time except `tests/e2e/feel.e2e.ts`, keeping every line that says `failed` or `flaky`:

```
for f in tests/e2e/*.e2e.ts; do case $f in *feel*) continue;; esac; echo "== $f"; E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3260 bunx playwright test $f --workers=1 --trace off --output=/tmp/pw-close 2>&1 | grep -E 'passed|failed|flaky|did not run' ; done
```

Then AGENTS.md rows and recipes for what now exists, `for-the-owner.md` for each change a player or GM sees (with what he would say to reverse it), a line `UNIT <name> DONE at <commit>` at the top of the notes, everything committed. Go on to the next unit without waiting. Leave no `bun server.ts` running.

## Rules that have cost a push before

- A test that fails once is a finding about the app until shown otherwise. Name its cause from evidence (the trace, a reproduction by hand) before changing anything. Never retry, lengthen a wait, loosen a bound or change a test to pass.
- When the lead says the CI is timing frames, run no browser and no whole `bun run test` until the time it gives.
- A machine is drawn with the `statechart` skill before its `TABLE`.
- New words a player reads get a `TODO(copy)` mark; the wording pass comes after you. Do not reword existing copy.
- The lint "every let a view keeps" lists page variables by name. A change that adds or removes one fixes the list.

## Final reply (at most 250 words)

The commit range; for each unit, rows done of rows given and each check's last line; what a player or GM would have seen for each bug fixed; the design picked for the extraction message and for M2 in one line each, and whether you think either is contested; what is left and why.
