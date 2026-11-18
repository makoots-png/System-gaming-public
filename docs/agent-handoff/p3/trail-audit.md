reviewed by Claude Opus 5.5 (claude-opus-5-5)

# Audit of the decision trail, phase 3 M3 to M8

Scope: the 66 rows of `docs/agent-handoff/decisions.tsv` from "sixth phase 3 lead picked up M3" (row 63, stamped 2026-11-12T14:40Z) to the end (row 128), read against the repo at `cbe1f25`. Row numbers below are file line numbers.

## Verdict

The trail is mostly honest: every commit it names exists, the test counts it quotes match the push logs and notes, and the decisions it records are the ones the code shows. It is not complete enough to trust on its own, because it stops at the 22:27 commit while about 25 more commits (with eight visible behaviour changes) went in, its timestamps are typed estimates that run up to eight hours ahead of the commits, and the owner's most consequential permission is recorded only in a file the lead wrote. The five fixes are cheap: rows for the last stretch, a row saying the ts column is not a clock, his confirmation of the launch permission, a decision on `.claude/`, and the open list extended with the items below.

## Flags, most important first

1. **The trail stops before the work does.** The last row (128) records push 13 (`c4e68cf..7466544`). After it came push 14 (`7466544..de29ad8`, scratch log: 1278 bun pass, 98 browser passed, CI passed), the second sweep (`a35676f` to `3302dfd`), the report and handoff (`9881ae5` to `cbe1f25`), and push 15, which was still running during this audit. None has a row. That stretch holds behaviour a table will notice: the Table feed keeps its Apply mark after a reload, shadow extraction follows the hunter's job, a Create or Join tap ended by a replaced campaign shows no error, a second tab follows the room the first one left, the Status window opens at its top, the fight log says "is defeated", the codex doc follows after 800 ms instead of 300, and the old-server peek 404 branch is gone. It also holds structural decisions: one edge publisher replaced four view publishers and their flags (`4981cb6`), `AGENTS.md` went from 195 to 123 lines with the lint list moved to a pointer (`01852d1`), `sync.ts` was split (`7f02c9e`), and `SENT_GRACE` was left for the next lead. Rows 100 and 110 still say "open" although `a764d4e`, `4c6b299`, `2b0cb62` and `3ff745f` closed them. To settle it, append rows for this stretch with commits and the CI line, and add rows that supersede 100 and 110.

2. **The ts column is not a clock.** Each row was stamped by hand (the rows were appended by a scratch `append.py`, not `log.sh`). `git log -- docs/agent-handoff/decisions.tsv` shows the gap: commit `a54517d` (14:46) holds rows stamped up to 15:26, `b7b1abe` (15:26) holds rows stamped 18:05, `e1b5ff7` (18:17) holds a row stamped 2026-11-13T02:05Z, then `30bc3bd` (19:34) adds a row stamped 19:55, and `6d90fd6` (22:27) adds one stamped 23:50. Rows 108 to 115 are dated Nov 13, a day that had not started when this audit ran (23:47Z Nov 12). Row 116 jumps six hours back from row 115, and rows 119 to 123 are out of order. The plan's heading "Added Nov 13" carries the same error. A reader cannot use the column to tell what was known when. To settle it, add one row saying the ts values before it are estimates and that `git log -- decisions.tsv` gives the real order, and stamp later rows with `log.sh` or `date -u`.

3. **the owner's permissions rest on the lead's own paraphrase.** Row 127 (23:25Z, "the owner gave standing permission to push, commit, merge and deploy") cites `START-HERE.md`, which the lead itself edited in `7466544`. That permission lets the last lead merge to `main` and deploy without asking. Rows 78, 80, 85 and 120 ("the owner asked", "the owner said so", "the owner: he does not want to do anything") have the same kind of evidence. They may all be accurate, but nothing in the repo is in his words from his own hand. To settle it, the owner confirms row 127 in one line, or the row points at his message.

4. **The `.claude/` rule contradicts the repo.** `START-HERE.md` says "Never commit `.claude/`" under the owner's standing rules, and step 4 of its order of work checks "`.claude/` not committed". The same file says the skills are committed there, and 529 files under `.claude/` are tracked (added in `71f24d0` by the owner's side, merged by the lead in `8b73fed`, row 78). No row reconciles the two. The verify step will either fail or be skipped without a word. To settle it, the owner picks one, and `START-HERE.md` changes the rule and the verify step to match.

5. **A player in a room cannot get a Job Change chain.** The unit D helper wrote "Remote players still cannot get a chain (the room `quest` offer has no chain)" in `p3/notes-hunter.md`. At `cbe1f25`, `src/core/protocol.ts` and `src/edge/room-events.ts` have no chain field. In a room every player is remote, so the feature works only for hunters on the GM's phone. This is not in the handoff's open list, the plan, `bugs-found.md` or the report's "Open" section. To settle it, add it to the handoff's open list, or decide it is fine and say so.

6. **Behaviour changes with no row and no line in "What a table will notice".** These come from the helpers' notes, and the lead accepted them:
   - Unit A (`p3/notes-hunter.md`): a GM raw Level edit now changes the points shown, a points reward to an overspent hunter pays the debt first so the number may not move, and a GM override of `pointsPerLevel` re-prices levels already held. The helper was unsure whether the GM's "+1 point" should also pay the debt.
   - Unit D: completing step 1 by hand below level 10 is refused, a GM edit of step 3's job reward no longer changes the job granted, and Reopen is not offered on a chain step's quest.
   - Unit D step 0: a player can no longer delete the Penalty Zone quest. The lead decided this, overriding the unit C helper, who had kept today's behaviour on purpose. The change is in the handoff's list but has no row giving the reason.
   - Link (`p3/notes-link.md`): while the sheet push is locked, an edit waits for the 30 s retry instead of sending at once.

   To settle it, add a row for each decision and add them to `lead-report.md` section 10.

7. **Some evidence resolves only in this clone.** Row 95 cites `7ee8e09` and `8012a00`, row 101 cites `28ff619`, and row 116 cites `2cd7e20` to `893f0ec` and a worktree name. These commits exist here but are on no branch, so `git gc` or any other clone loses them. Rows 111, 112 and 124 cite files "on the branches" or "on worktree-agent-...". The merged copies are `bce8312` to `a86128f` (row 95), `eab69f4` (row 101) and `b2e9f52` to `9ea2f43` (row 116). To settle it, add a row that maps each one to its merged commit.

8. **The CI evidence lives in session scratch.** Rows 83, 90, 103, 107, 117, 118, 119, 121 and 128 cite `push-N` logs. These are not in the repo. They happened to be readable from this session's scratch folder, and every count quoted matches its log (push 5: 336 and 78+1, 6.7 m; push 6: 423 and 81+1; push 7: 612 and 82+1; push 8: 626 and 82+1; push 9: 747 and 89; push 10: 843 and 94; push 12 range `5a85c7f..c4e68cf`; push 13 range `c4e68cf..7466544`). The owner cannot open them, and they go when the session ends. Rows 119, 121 and 128 quote no counts at all ("counts in its last lines"). To settle it, quote the counts in each push row, or have `scripts/ci.ts` append its summary line to a committed file.

9. **The lead's own checks left no trace.** Row 75 ("I ran my own mutation (no HP ceiling: 3 tests fail)"), row 86 ("ran two mutations", "my run of gates-quests-dailies: 15 passed, 1 skipped"), row 92 ("a player may send an award: 3 tests fail"), and rows 89 and 94 ("passed for me alone ... in five CI runs") have no notes line, command or test names behind them. The helpers' mutation runs are all written down in their notes. The lead's are not. To settle it, write one line per check in the unit's notes file with the command and the failing test names, or rerun them.

10. **Row 122's evidence does not show its claim.** It says the container restarted once and the account's 5-hour limit stopped two helpers. Its evidence, `p3/notes-check-views.md`, says the first helper stopped "at the time limit", which is the brief's 75 minutes, and `p3/notes-integration.md` mentions neither event. Row 123 (the hourly scheduled task, "untested until the first limit") never got a follow-up, yet the handoff tells the next lead to rely on it. To settle it, add a row saying whether the task has fired, from its last run.

11. **`START-HERE.md` is stale where a new reader starts.** The handoff says to read `START-HERE.md` first. Its "Where things stand" still says "M1 and M2 are done, M3 is next", and its file table calls `handoff.md` the handoff "after M2". To settle it, update those two lines.

12. **Row 88 states the gate rule more strongly than the code.** The row (18:50Z, "a second fight in a gate that has paid its full roster XP pays nothing") gives the reason "one rule: a gate pays its roster once". `tests/gate.test.ts:149` shows a gate that still owes 10 XP paying a fight's whole 125, so a gate can pay more than its roster. The handoff's wording is accurate. No browser test drives a second fight. To settle it, add a row with the exact rule, and the owner decides whether overpaying on the last fight is acceptable.

13. **The report's bug count is off by one.** `lead-report.md` says "22 bugs were found and fixed". `bugs-found.md` lists 22, but bug 2 is "Not reproduced, and bounded", not fixed. That makes it 21 fixed and one bounded. This is minor, and the report is being edited now.

## Gaps: helper items left out or unsure that are not recorded where a next reader looks

Each was checked against `handoff.md`, `phase3-plan.md`, `START-HERE.md`, `p3/bugs-found.md` and `lead-report.md` section 10.

- Remote players cannot get a Job Change chain (flag 5).
- The step 1 objective +/- buttons still show, so a player can push "Reach Level 10" to 10/10 and is then refused (`notes-hunter.md`, unit D).
- No death save at the start of a turn in combat. Inventory question 2 is unchanged (unit B).
- A GM cannot lift a penalty except by deleting its quest, `store.id('q')` is spent on every miss, and the quest edit form still lets a GM change a Penalty Zone quest's kind (unit C).
- The GM "+1 point" choice was unsure, and unit A's visible changes are listed in flag 6.
- Rolling initiative refreshes a local hunter's stored `initMod`, and `rollTick` is emitted for every per-turn op. Both were "open for the lead" (`notes-reducer.md`) and have no answer.
- The room system model's random walks catch only one of three mutations. The helper named biasing the walks "the next improvement" (`notes-room-system.md`).
- The link lets "No room server" tap Create or Join (`notes-statecharts.md`). This may be intended, but no one decided it.
- Pushes 2, 3, 4 and 14 have no rows. Row 72 ("CI on 8ab1337 running for the push") was never closed. The push 2 log shows that it passed.

Recorded and found later (no action): the remote revive, the combat log at 0 HP, the penalty-quest escape, `canExtract`, the io.js import, the popup gap, the GM-key question 13, the widened room waits, the fight model's last-combatant step, the views' own `App` type, the private `oneOf` copies, the typed codex and shop, `app.pendingRoom`, `app.layout` and `app.keys`, `SENT_GRACE`, `wasRoom`, the publisher's missing unit test, finding 12, and the screenshot states that could not be captured.

## Direct checks

**(a) `bun test`.** 1285 pass, 0 fail, 34 files, 24 s, at `cbe1f25`. This matches the handoff, the report and the last line of `notes-registries-sweep.md`. It does not match any row. The latest row that states a bun count is row 118 (843, push 10), because the rows after it quote no counts (flag 8). The push logs show the path between them: 849, 847, 1278, 1278, then 1285.

**(b) Lint rules.** All 13 rules named in the `AGENTS.md` given to this audit, and every rule the current 123-line `AGENTS.md` names in its pointer paragraph, have a test in `tests/lint.test.ts`: core imports, core browser use, the role, no module-level `let`, the fight dispatcher, the gate, the room event constructor and the event id, `sync.ts` state, the save's room fields, progress, vitals, penalty and the job chain. The file also has three newer rules (one `oneOf`, `questState`, `AbortSignal.timeout`) and one sanity test, 18 in all, as the report says.

**(c) Three behaviour changes from handoff section 6.**
- "A monster put down by hand stays down when healed" is pinned by `tests/encounter.test.ts:344`, "the GM can put a monster at full HP down by hand (it fled), and healing does not bring it back". The name says what the GM sees. It is a reducer test, with no browser test.
- "A player cannot delete their penalty quest" is pinned by `tests/e2e/gates-quests-dailies.e2e.ts:592`, "a player sees no Delete on the Penalty Zone quest that holds their penalty; the GM deletes it and the penalty is lifted", and by `tests/penalty.test.ts:58`. The name says what both the player and the GM see.
- "A second fight in a gate that has paid its full XP pays nothing" is pinned only by `tests/gate.test.ts:149`, "a fight in a gate that still owes anything pays its whole XP, and nothing once the gate owes nothing". The name describes the payout rule in the GM's terms. It also shows the overpay in flag 12. No browser test plays a second fight.

## Rows checked and found sound

Evidence resolved and showed what the row claims (timestamps aside, see flag 2): 14:40 (baseline matches the scratch `ci-base.log`: 158, 75 passed, 2 skipped, 6.4 m), 14:45, all six 15:00 rows (checked against `brief-reducer.md`, `status.ts` and `status.test.ts`), 15:25, 15:26, 16:05, 16:20 (model test bugs and the monster rules), 16:50, 17:40 (both), 18:05 (push 5 and the gate plan), 18:50 (bugs 5 to 7: the test lines are right at `7c5e52b` but have since moved), 19:35, 19:40, 20:00 (unit B scope), 20:50 (machine rules, unit B scope, Postgres), 21:25 (unit B merged, 612), 21:45 (planned sweep), 22:00, 23:05 (all three), 23:40, 2026-11-13T00:05, 01:10 (M6 done, and the posts that could not be read), 01:50, 02:05, 20:10, 21:20, 22:35 (new unit), 23:10 (both). That is 43 of 66 rows. The other 23 carry a flag above: 75, 78, 80, 85, 86, 88, 89, 92, 94, 95, 100, 101, 110, 111, 112, 116, 119, 121, 122, 123, 124, 127 and 128.
