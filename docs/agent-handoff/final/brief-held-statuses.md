# Brief: a held hunter's reward statuses land in the award's one write

One helper (Opus, heavy-writer) in the main tree, on `claude/zen-pasteur-ov4cgd` at the commit the lead names. Nobody else writes this tree while you work. The general brief is `final/brief-implicit-unit.md` and the lane's is `final/brief-lane.md`: read both first and follow all of both (poteto mode, the cause written before each change, a test that fails without it, a commit by path after each step with a plain message and no attribution line, no push, no helpers, never `git checkout`, `stash` or `reset` a file, never edit `.claude/skills`, no new dependency). Where they differ from this file, this file wins.

## The goal, in the owner's words

"I want it perfect, I do not care about time." "Everything must be explicit. Everything." "For all things we must fix the problem and not the symptoms." This is the one row the close of the second audit left, for budget and not for a reason in the code (`final/notes-close-audit.md`, "Unit 6 row: a held player's reward statuses after the award's write"). Read that section and V2's notes first.

The problem: Send award is one write (`gmAward`), but the reward's statuses for a hunter this phone's fight holds go to the fight's row afterwards, one `combat.status` per status (gm.js `sendAward`), and a local hunter's fight parts likewise (`hunter.granted`). A throw or a reload between leaves the award paid and logged with a status missing from a row. The smallest change that meets the goal: the award and what it puts on the fight's rows are one `store.apply`.

## Steps, a commit after each

1. In the notes (a new section at the end of `final/notes-close-audit.md`), write the cause, then weigh on paper the variants: a new fight command that puts statuses on several rows; the existing `status` command taking a list; no fight command at all but several commands reduced in one write. Pick the one with the fewest new kinds of thing. The award's step rides as the command's `also` (`fought` in fight-save.ts), so the fight, the award, the posts and the log line are one write. Read the fight's chart in `docs/state-machines.md` before you touch its `TABLE`.
2. A failing test first: a core test (tests/fight-save.test.ts or tests/award.test.ts) that a reload between any two parts finds either none or all of the award and its row statuses; then the change, by AGENTS.md's recipe "A combat command" if a command is added (every `TABLE` cell, `randomCommand`, the chart's words).
3. The local hunter's fight parts (`hunter.granted`'s second write) ride the same write. Sweep for the class: any other view that writes the save and then sends a fight command for the same act (say what you found, fix what is the same shape).
4. A browser case in `tests/e2e/reward-room.e2e.ts`: the GM awards a status to a player's hunter in a running fight; the row shows it.
5. Close: `bun run deps -- --write`, `bun run charts`, `bun run typecheck`, the whole `bun run test`, then every browser file one at a time except `tests/e2e/feel.e2e.ts` on `E2E_PORT=3260` (the loop in `final/brief-close-audit.md`, keeping every `failed` or `flaky` line), AGENTS.md's rows for what now exists, `for-the-owner.md` only if a player or GM sees a difference, the line `UNIT left-sections DONE at <commit>` replacing the NOT DONE line at the top of the notes. Leave no `bun server.ts` running.

A test that fails once is a finding about the app: name its cause from evidence before changing anything. Never retry, lengthen a wait, loosen a bound or a lint, or change a test to pass. New words a player reads get a `TODO(copy)` mark.

## Final reply (at most 150 words)

The commit range, the variant picked in one line, each check's last line, what is left and why.
