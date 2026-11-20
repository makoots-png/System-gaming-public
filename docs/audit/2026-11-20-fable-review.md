# Fable review of the 5.5 lead's work of Nov 20

- **Date:** 20 November 2026.
- **Read at:** `e2a3d95e` (branch `lead-backlog`), the merges of `git log --first-parent 92cc0de1..e2a3d95e`.
- **Goal:** say, with proof, whether each unit fixes its cause, whether a test fails without the fix, and what it broke or left half done. Nothing is fixed here.
- **Method:** poteto mode from `origin/pstack-skills-update` (`be7e5f4d`), its Investigation playbook and four of its principles (Fix Root Causes, Prove It Works, Test Behavior Not Implementation, Explain the Number). Its Cursor-only steps (`poteto-agent`, `/deslop`) do not exist in this session and were not used. No helper was started.
- **Scale:** `docs/audit/2026-11-20-ranked.md`. Only 6 and above are fixed.
- **Ran** means I ran it on this box. **Read** means I inferred it from the code.

## Result

No finding scores 6 or above. All six code units fix the cause they name, and each has a test that fails when the fix is taken out. I took each fix out and ran the test.

| Score | Count | Findings |
|---|---|---|
| 5 | 1 | S-1 |
| 4 | 1 | E-1 |
| 3 | 1 | S-2 |
| 2 | 3 | D-1, D-2, S-3 |
| 1 | 11 | L-1, R-1, R-2, I-1, D-3, G-1, E-3, E-4, H-1, N-1, N-2 |
| 0 | 7 | L-2, S-4, E-2, H-2, H-3, N-3, N-4 |

Two findings score low on the player scale and still deserve a fix today, because each costs a few lines. N-1: the lead's last commits are on a branch no document names. S-1: the number the sale-value unit corrected is cut off on a 390 px phone.

Baseline: `bun run test` at `e2a3d95e` ends 4562 pass, 0 fail (ran).

## Level-cap (BUG-rules-18, AW-rules-11), merge `4fa9a65c`

Cause, not symptom. Six readers each wrote a level bound. One file now states it and the others ask it.

Proof (ran): with `fight-parse.ts` put back to `whole(b.level, 1, 200)`, `tests/rows.test.ts` "a running fight holding a hunter of any level" fails, and so does the lint "a hunter's level is bounded once". With the fix both pass.

I looked for a seventh reader (`grep` of every `level` read through `whole`, `int`, `num`, `wholeIn`, `own`, and every `min=`, `max=` in the views). There is none. `xpToNext` lost its `Math.max(1, level)`, and its four callers all pass a level that `fixHunter` or `levelOf` has bounded.

- **L-1, score 1 (read).** The lint's pattern sees a bound written as arguments (`whole(level, 1, 200)`) or as `Math.min` and `Math.max`. It does not see one written as a comparison (`if (level > 200) return null`). What should be: the pattern also matches `level` compared with a number literal.
- **L-2, score 0 (ran `ls`).** The row in `landed.md` names `src/core/sync/protocol.ts`. The file is `src/core/protocol.ts`.

## Reaction-cost (BUG-rules-5), merge `73a4b51a`

Cause, not symptom. Each step used to call the write-back itself, so a path that skipped it left the sheet behind. `reduce` now reads the write-backs once, from the fight a command found and the fight it left. This is the right shape and it deletes code (`joinFx`, the setup branch of `gmChange`).

Proof (ran): I checked out the parent `eab07e49` in a worktree, copied in the new `tests/fight.test.ts`, and ran "a turn reaction's cost reaches its hunter's sheet". It fails there (no `vitals` effect at all) and passes at the merge.

The changed expectation in the stun test (3 rounds became 2.5) is correct. The sheet now hears the time left as the command leaves the fight, at tick 500.

- **R-1, score 1 (read).** The lint requires the literal text `sheetBacks(f, g, ctx)`. Renaming a local in `reduce` fails it with no behavior changed. What should be: the lint counts calls of `sheetBacks` and names the file, without the argument text.
- **R-2, score 1 (read).** `sheetBacks` writes nothing for a row that left during the command. Today that is safe. Only summons leave by themselves (`sentAway`) and a summon has no sheet. The GM's remove changes nothing else. A later rule that changes a hunter's or shadow's row and removes it in one command would lose its last write with no error. What should be: one test that says a held row that leaves in a command still writes its change, or a line in `sheetBacks` that writes the row's last state as it leaves.

## Item-stack (BUG-rules-27), merge `54461c75`

Cause, not symptom. The key was a hand list that missed fields. `DISTINGUISHES` is typed by `keyof Item`, so a new field fails the typecheck until someone decides it.

Proof (ran): with `desc: true` set to `false`, "two slotless things that differ only in their description stay two stacks" fails.

`stackOf` has three callers (`grant.ts`, two in `inventory.js`) and no other place decides a stack.

- **I-1, score 1 (read).** The unit added `worn` to the key and the test has cases for `desc`, `attack` and `penFlat` only. What should be: the test loops over every field `DISTINGUISHES` marks true, so the table and the test cannot drift.

## Dying-flake (event ids), merge `90b53f8c`

The cause is fixed for the path that failed. Two posts of one tap shared an id because the id's only difference was `Math.random`, which the test fixes. `stampTime` makes each id of `sync.ts` `event()` later than the last. The second half is the better half: a different message under a held id used to be answered ok and dropped, and is now refused by the outbox (`IdTaken`) and the room (409).

Proof (ran):
- With `stamped = Date.now()` in place of `stampTime`, the browser test "a player's death save made in the same millisecond as its roll" fails with the page error "the outbox holds a roll message under id ..., so this deathSave message was not posted". With the fix it passes (21.8 s).
- The room API against a real Postgres 16 on this box: `DATABASE_URL=... bun test tests/server-rooms.test.ts tests/server-handshake.test.ts` ends 132 pass, 0 fail. That includes the 409 case and the resend of the same message.

One fact for the record. On a real phone the old collision needed the same millisecond and the same random number, so players did not lose death saves to this. The red run was the test's fixed `Math.random`. The lasting gain is the refusal.

- **D-1, score 2 (ran `grep`).** The comment on `stampTime` and on `IdTaken` says every id a page makes is later than its last. That holds for one maker of five. These build their own stamp from a raw `Date.now()` and never touch `stamped`:
  - `src/views/gates.js:39` `stampNow`, used by `settleClear` at `src/core/gates/pay.ts:159` (`now + i` for each payee) and by `soloTaken`
  - `src/views/stories.js:79`, used at `src/core/story/run.ts:221` (`now + i`)
  - `src/core/hunter/noticed.ts:117` (`Date.parse(c.at)`, random part from the quest id)
  - `src/core/trade/offer.ts:292` (`a.stamp`)

  Gate-feat, merged 15 minutes after this unit, moved the Clear's `noted` from the guarded maker (`S.event`) to the unguarded one. No player effect today, because these use `cryptoRandom` (32 bits) and a test cannot fix it. The handoff's "Left" list names `stories.js:79` only. What should be: one maker of stamps. `sync.ts` hands a stamp to whoever needs one (it already owns `stamped`), and a lint refuses `Date.now()` in an object that also holds `rand`.
- **D-2, score 2 (ran).** `IdTaken` is thrown inside a save step. Nothing catches it and shows it. In the browser run above it reached the console as a page error, and the player's tap did nothing on screen. The landed row says "refused loudly". It is loud for a developer with the console open. What should be: the place that runs a view's write reports a thrown step through `ui` (a "Not sent, this is a bug" line with the id), as a refused write is reported.
- **D-3, score 1 (read).** In the Postgres store, `addEvent` parses the stored payload again to compare. If a deploy tightens a parser, an event stored before it no longer parses, `was` is null, and a phone that resends that same message gets 409. Its outbox then shows a refusal for a message the room holds. It needs a resend across a deploy. What should be: when the stored event does not parse, compare the raw stored payload with the posted one.

## Gate-feat (BUG-gates-8), merge `a0236c64`

Cause, not symptom. Each caller that paid a player had to post the gate fact itself, and `soloTaken` forgot. `settleClear` now takes each player with the message that pays it and posts the fact itself. A caller cannot pay without the fact. `gateFact` is the one constructor, and the personal gate's literal fact is gone.

Proof (ran): with `return [p.pays, noted]` changed to `return [p.pays]`, two tests fail: `tests/pay.test.ts` "cleared in one step ... each with the gate as a fact" and `tests/applied.test.ts` "a run the GM's phone paid counts as a gate cleared on the player's phone". The second one drives the GM's `soloTaken`, hands its posted messages to a player's phone and reads the tally, which is the behavior a player sees.

- **G-1, score 1 (read).** `settleClear` throws when `newEvent('noted', ...)` returns null. Before, a null was dropped and the Clear went on without the fact. Today it cannot be null, because a gate's name (`gate.ts`, 60) and a fact's text (`facts.ts`, `NAME` 60) have the same bound. Nothing ties the two numbers. If one moves, a GM cannot clear a long-named gate in a room, and the error reaches only the console (D-2). What should be: the fact's bound reads the gate's, or one test builds the fact of a gate at every bound.
- See D-1 for the stamp this unit added.

## Sale-value (BUG-rules-16, AW-rules-5), merge `84bf188e`

Cause fixed for the table and the daily line. The page now asks `priceOf`, `sellPrice` and the daily template. Common reads 100 and sells for 50, as the Bag pays. `dailyRewardPoints`, which nothing paid, is gone, and no other file reads it (ran `grep`).

Proof (read and ran): `saleRows(RULES)` common `sell` is pinned to 50, so a wrong function behind the table fails `tests/rules-text.test.ts`.

- **S-1, score 5, a close call with 6 (ran, looked).** On a 390 px screen the new table is 404 px wide in a 336 px column. The fourth column, "Sells for", is the number this unit exists to correct, and it is cut. The header reads "SELI", Common reads "50 g", Legendary "2,5(", Mythic "10,(". The wrapper scrolls sideways by 68 px and nothing says so. Every player who opens Rules, Loot on a phone sees it. The number is reachable by a swipe, which is why this is not a 6. Ran: a throwaway Playwright test at 390 by 844, `onboardGM`, `go('rules')`, a screenshot and the table's `getBoundingClientRect` (left 27, right 431, viewport 390). What should be: the word "gold" leaves the cells (header "Price (gold)"), or the multiplier column goes, so four columns fit in 336 px. Then a browser test reads Common's "Sells for" cell at 390 px.
- **S-2, score 3 (read).** `saleLine` says the rule in prose: "base 10 gold × its tier's multiplier × 10", "half that, rounded down". The `× 10` and "half" are typed in the sentence. No test ties them to `priceOf` or `sellPrice`, and the sentence leaves out "at least 1". This is the class of AW-rules-5 (the page works the rule out by hand) moved from a number into words. True today. The economy design's unit 1 replaces it. What should be: until then, one test that builds the sentence's claim from the functions (price of common is `baseValue × mult × 10`, sale is `floor(price / 2)`).
- **S-3, score 2 (read).** Nothing holds that the view uses `saleRows`. A later edit of `rulesref.js` can compute a number again and every test stays green. The handoff records the lint as "judged not cheap". The browser test of S-1 would hold it for this table at no extra cost.
- **S-4, score 0 (read).** Two weak tests. "each tier of the sale table is what the Bag pays" compares `saleRows` with `sellPrice`, the function it calls, so only its last line (common is 50) proves anything. "the rules hold no dailyRewardPoints" asserts that a key is absent.

## The economy design, merge `29ed569a`

Read as merged. The owner's rulings (`da673434`, section 10) arrived while I was reviewing, and I note where they change a finding.

The design does what the owner asked. It has one anchor (a Clear, the middle of `loot[rank].gold`), every price is a count of Clears, each assumption of the session model is stated with its source, and it says which numbers were measured and which were assumed. Proof (ran): `bun docs/agent-handoff/features/economy/measure.ts` prints the tables of sections 1.3, 2, 3, 4.2, 5 and 6, and every figure I compared matches the document. I also worked E's row by hand (0.85 × 100 + 0.15 × 325, times the 0.5 clear share, is 67, and 100 + 51 + 3 × (67 + 58) is 526).

- **E-1, score 4 (read).** Section 2's rule is "an item costs one Clear of its rarity's rank". Section 7.1 then stores the result as literals (`rarities.*.mult` 1, 3.25, 12.5, 50, 190, 750) and holds them with a test of the shipped `RULES`. A GM who edits `loot.C.gold` in the Rules editor moves the Clear and not the rare price. Section 9 says a change of `loot.*.gold` "moves every price with it", which is true of `measure.ts` and false of the game as designed. It is one number with two homes, the fault this design's own finding 4 names. The rarity to rank table (common is E, mythic is S) is also not a rule in 7.1. What should be: the price is computed, `clearOf(R, rankOf(rarity))`, with the rarity to rank table in `RULES`, and `mult` goes. This still stands under ruling 1 (prices by rank, with grades), and a grade is then a factor on that computed price.
- **E-2, score 0 now (read; it was a 6 as written).** Section 5 priced the crystal by its buyer's rank. `src/core/trade/` has no rule about a reviving item, so an E hunter could buy one for 1,000 and hand it to an S hunter whose price is 750,000. The owner's ruling 4 closes it. A crystal has its own rank and revives only that rank or lower. The revised section should say so in one line, and the unit's test should include the trade.
- **E-3, score 1 (read).** A consumable costs half its rarity's price, and half of 325 is 162.5. The script prints 163 and the sale rule rounds down. The design does not say which way a price rounds.
- **E-4, score 1 (read).** Hunter's Leather goes to 100 as "the same light piece as the Padded Cap". A chest is 35 hundredths of a kit and a head is 10 (`KIT_SHARE`), so the two are not the same piece. Ruling 1's grades are the tool for this.
- Not a finding. Ruling 5 (gold shared, a smaller party earns more each) replaces sections 4.2, 4.4 and 6 and the crystal's session counts. The lead has already written that sections 2 to 7 wait for revision.

## The hook `.claude/hooks/lead-model.py`, commit `2c5f7a86`

It does what its row says. Ran with five inputs: model `claude-fable-5-2` exits 0, no model exits 2, `claude-opus-5-5` exits 2, `claude-fable-5-2[1m]` exits 2, junk on stdin exits 1.

- **H-1, score 1 (ran).** The hook cannot tell a lead from any other session. It refuses every `create_session` that is not Fable, and the words say "Start the next lead on Fable 5.2". A lead that wants a cheaper worker session is refused with a message about something else. What should be: the message says what to do for a session that is not a lead, or the hook reads a marker the lead's start prompt always carries (its title).
- **H-2, score 0 (ran).** Unreadable input exits 1, which does not block the call. The hook fails open.
- **H-3, score 0 (ran `grep`).** No test runs any of the three hooks. The trail says "proved on both cases by hand".

## The handoff's Now block, `docs/agent-handoff/handoff.md` section 2

- **N-1, score 1 on the player scale. Fix it today anyway (ran).** The lead's commits after PR 48 are on `origin/lead-backlog`. That is the Now block itself, the hook, START-HERE's Fable rule, the owner's order, the economy design and his rulings. `handoff.md`, `START-HERE.md` and `NEXT-SESSION-PROMPT.md` name that branch zero times (`grep -c lead-backlog`). START-HERE says the working branch is `claude/festive-fermat-tvpykj`, and NEXT-SESSION-PROMPT starts the next lead from "the working branch START-HERE.md names". That branch is at `955e1c87`. It has no `lead-model.py` and no economy design, and its `handoff.md` still says the `dying-flake` helpers are running. `session-start.sh` fetches the checkout's own branch, so it would report nothing behind. This is the Nov 19 mistake (a lead planning from stale notes) through a new door. What should be: START-HERE names `lead-backlog` as the working branch with the date and the reason, or the commits go to the named branch.
- **N-2, score 1 (read).** The block says it "wins over the bullets under it", and about 25 older bullets stay under it. They contradict it and each other: `main` holds PR 36, PR 38 and PR 48; "Nothing is running"; two bullets titled "How a landing goes"; the hourly check-in is off and stays off, and also wakes the lead every hour; "Next: the list (a) to (e) in the bullet 'No helper runs' above", and no such bullet exists. The section header says "rewritten 17:50 UTC", the block says 20:40, and its content is from 21:30. A reader cannot tell at a glance which old bullet still holds. What should be: the old bullets that still hold move into the block and the rest go to the trail.
- **N-3, score 0 (read).** "Its five questions (section 8) are asked of the owner" follows the sentence about the Fable reviewer, so "Its" reads as the reviewer's. It means the economy design's.
- **N-4, score 0 (read).** "Left, scored under 6" lists `stories.js:79` as the one place that makes its own ids. D-1 lists four.
