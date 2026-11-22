# Notes 9: the owner's rule calls of Nov 22, one row each

Branch `rulings-rows`. Each answer: the row, what the app did, what changed. The earlier helper's commit "Work in
progress, stopped by the usage limit" covered numbers 2 to 8 (half of 8); what of it stands is said under each number.

## 7. The collapse

- 6.1 (a capacity lowered to the fatigue): `COLLAPSE_MOVES.maxChanged` in `src/core/hunter/vitals.ts` is `rise`.
- 6.2 (full fatigue in a fight): the sheet was already collapsed by the fight's totals (`fightTotals: rise`, every change
  of the fight writes the sheet's fatigue through the `vitals` effect). Not built: a collapse of the fight's own row.
  A fight's row holds fatigue as a number and nothing in the fight reads a collapse. Missing: what a collapsed row does in
  a fight (cannot act? is it down? its turn skipped?), a ruling of its own, then a row state in `fight-turn.ts`, the
  fight card's chip (`fight-view.ts`, held by another helper) and its test. Units: the ruling; the row's state and its
  table test; the card.

## 8. Points pending and the rank

- 7.1: `handingBack` around the `xp`, `level` and `revived` cells of `PROGRESS_TABLE` (progress.ts; the stopped helper's
  commit, tests pass). Still unruled: whether a deduction of points (a quest's cost) reaches the points pending.
- 7.2: a new stored field, `Hunter.rankBy` (`'level' | 'gm'`, repaired to `level`), written only by `rankStep`: the
  GM's choice of a rank marks it `gm`, Re-evaluate and a rank the level gives mark it `level`. `RANK_TABLE.above`'s
  `levelMoved` is read by it: `level` takes the rank down to the level's, `gm` keeps it. Read as the question was
  asked (a level lost below the rank). A level risen still leaves a rank behind waiting for the GM's Re-evaluate; if
  the owner meant the rank rises with the level by itself too, that is `behind.levelMoved.level: 'earned'` plus the
  Re-evaluate button's words in `src/views/hunter.js`. Not built: the GM's screen does not show that a rank was set by
  hand (one line under the Rank field of "GM: Edit hunter" would).

## 2, 3 and 5: confirmed, nothing to change

- 2 (taking off a status fits HP, mana and fatigue; max HP at least 1): already so, `STATUS_FITS` in grant.ts and
  `MAX_FLOOR` in sheet.ts; commit 7dfb73bd added the test.
- 3 (a status stops counting when its time runs out, a tick still owed): already so, `STATUS_COUNTS.owed` is false in
  standing.ts.
- 5 (the owed dice are rolled before a turn ends): already so; the earlier helper found nothing to change and no commit
  was needed.

## 11. A shadow at 0 HP (SMX-rules-10.1)

Row changed: `TABLE` in `src/core/hunter/shadows.ts`. `summoned.fell` is `resting` (a shadow that falls is dismissed)
and `restingFallen.summon` is null (not summoned until Full HP). The row `summonedFallen` is gone: no event leads there
now, and a shadow saved summoned at 0 HP before the ruling is read as `summoned`, so its next fight or Dismiss puts it
right. The Shadows panel's Summon button is disabled at 0 HP with the reason in its title. The commit "Work in progress,
stopped for the hand-over" (ee7a606) held this and the start of 12.

## 12. A consumable in a fight (SMX-views-5.1)

"Not a full turn, but should cost something." Grep found it half built in ee7a606 as `fight.itemShare` (a share); it is
now `fight.consumableTime`, 50 hundredths of a standard action, the same kind of number as `dashTime`
(`src/core/rules.ts`), read once by `itemAbility` (`src/core/registry/abilities.ts`). Before, a consumable's ability
took a standard action's time, a full turn. Every use ends its user's turn in the GM's fight (fight.ts `after`); the
hunter's next turn comes half a standard action later.

Row changed: the held turn's `free.tap` (`src/core/combat/hold.ts`). A tap from the Bag was sent unheld, so End turn
stayed on while the potion was on its way; with the next turn half an action away, an End turn sent after it could end
that next turn. It is now held like any use. `TurnHoldSend` loses `unheld` (uses.js `command` no longer reads it).
`TurnHoldVia` stays, since inventory.js (another helper's) passes `'bag'`; both values are now held alike, so the
next holder of inventory.js can drop the argument and the type with it. Ran `tests/e2e/table-turn.e2e.ts` and
`tests/e2e/used.e2e.ts`: 28 passed.

## 9, 13, 14, 17, 18: answered again on Nov 22

He answered the plain-words questions in the lead's session (for-the-owner.md Answered, last row; merged in from
`lead-backlog`). An earlier commit on this branch said the rows stand unanswered; the sections below replace it.

## 15. An urgent quest that runs out (SMX-gates-3.3)

Row changed: `ROOM_HEARS.overdue` in `src/core/hunter/grant.ts` is true. The rollover on a player's phone in a room
fails a GM's urgent quest past due, pays its cost (as before) and now posts `questUpdate` as failed, the same post a
tapped Fail makes. A player's own quest is not posted (`reportsProgress`). The GM's phone only reads the post (log and
Quests view); the cost is paid once, on the player's phone.

## 16. A quest with a hand-ticked objective (SMX-gates-4.1)

Row changed: `COMPLETER.mixed.button` in `src/core/hunter/quest-rights.ts` is true. A quest with counted and
hand-ticked objectives shows Complete; the System still completes it when every objective fills (`counted` stays true).
The hunters guide's line says so.

## 19. A System whisper (SMX-sync-5.2)

Row changed: the `system` event's `sealed` in `src/core/protocol.ts` (`DEFS`) is `p => p.to !== undefined`. Before, it
had none, so a message the GM sent to selected hunters (gm.js `doBroadcast`, "only") reached every phone's poll. Now
it reaches the GM and the phones of the hunters it names (`servedTo`); a message to the room is not sealed. Test:
tests/protocol.test.ts, "a System whisper to one hunter...". Read as any System message with `to`, one hunter or more.

## 22. A Resurrection Crystal handed over after the death

Already so: `handOver` (goods.ts) gives a dead hunter a crystal and `useItem` (use.ts) raises it; tests/goods.test.ts
"Brakk gives dead Eldrin a Resurrection Crystal" holds it. The comment in inventory.ts and the test's name now cite the
ruling. The world bible's "A death" still says "bought before the death"; `docs/world` is not this unit's, so it is
left for the lead.

## 23. Stealth beats sight at the same level

Row changed: `perceives` in `src/core/combat/sight.ts` is `e.sight > f.stealth` (was `>=`). A hide at 0 now hides from
a plain sight of 0, so level 0 is a hide's level: `HideLevel` and `HIDE_LEVELS` go (a hide's level is a `Level`), the
parser keeps a 0 (`HIDE_DEFAULT.level` 0, the hidden op with no level written), and the status maker offers 0 to 5,
starting at 0.

Default I chose for the ladders: each built-in hide is one level lower, so each hides from the same sights as before
and the balance runs do not move. Stealth and Invisible are 0, 0, 1, 2, 3, 4 by rank (were 1, 1, 2, 3, 4, 5); Vanished
(kit example) 0, 0, 1, 1, 2, 2 (were 1, 1, 2, 2, 3, 3); Hunter's Eye keeps sight 2 and its words say it sees level 1 or
lower. If the lead wants one level per rank instead (0, 1, 2, 3, 4, 5), ranks D and up hide one level better: one line
in `statuses.ts`, its test in `tests/statuses.test.ts`, then the simulation. The rules page line, the combat guide and
the tests were changed to the rule; e2e `makers.e2e.ts` (the maker's level starts at 0) and `battle-map.e2e.ts` ran.

## 13. The Dice view's number to beat (SMX-views-13.1)

"Same for everyone, but more impressive feats should require higher rolls." Row changed: the DC machine
(`src/core/dc-pick.ts`) no longer holds a rank. It opens on `DC_DEFAULT`, E Standard (DC 13 in the shipped table), for
every hunter; the `hunterRank` event goes, so only a pick moves it. Before, it opened on the active hunter's rank at
Standard (an S hunter saw S Standard, DC 50). Default chosen: E Standard, the lowest rank's middle level, since his
example (a giant rock about 15) sits near it; a higher rank helps through its check bonus. dice.js, the lint rule, the
chart and the test follow. `tests/e2e/dice.e2e.ts` reads E Standard (DC 13) for an E hunter, unchanged.

## 9. A day feat and a fight over midnight (SMX-rules-9.1)

"Count for the day the fight ended." Already so: `INBOX.waiting.free` in `src/core/hunter/noticed.ts` takes a fact held
by a fight with the stamp of the write that frees it, the fight's end. The row's comment, the feat chart's note and
the tests' names now cite the ruling.

## 14. A solo run in flight when the GM switches solo runs off (SMX-gates-2.2)

"Yes that run still counts." Already so: `PLAN_TABLE.notSolo` in `src/core/gates/solo.ts` pays a won run and lets a
lost or stalled one enter the gate. The row's comment, the solo plan chart's note and the tests cite the ruling.

## 17. The world's day and a break day passed by an edit (SMX-gates-7.1, 7.2)

"Yes can see a worlds day backwards, and no it doesn't break if someone is in it. If not, yes." 7.1 was so already (a
move back is taken and leaves the gates). Row changed for 7.2: `BREAK_CHECK` in `src/core/gates/world.ts` is now by
change and by whether anybody is in the gate (`detected`: nobody; `raiding`: a party entered or fighting). An edit by
the GM or a merged world breaks a `detected` gate past its break day at once and leaves a `raiding` one open; a move
forward breaks both, as before (not asked); a move back breaks neither. Not built: a gate left open because a party was
in it does not break when the party leaves (no event says so today; `encounterEnded` would be the place). A merge
test's gate that the day passed now breaks, as the rule says.

## 18. A held Give's Undo keeps its whole time (SMX-gates-5.1, SMX-views-3.1)

"Yes the undo sticks around after I mess with the other notifications until its duration is done." Row changed: the
held-write machine (`src/core/held.ts`) loses the event `crowded` (two newer toasts committed a held write at once).
A held write now ends only by its window, its Undo, or the page hidden. ui.js pushes off only plain toasts (at most two
show), so a held toast stays beside them. New e2e in `tests/e2e/reward-room.e2e.ts`: two notices after a Give…, the
Undo is still there and undoes it. It taps Undo inside the two seconds, as the test above it does; a box pause could
fail it once.

## 20. Rewards the app pays by itself wait for the GM (rule d): built

the owner: "Yes" to "rewards the app pays by itself (a room solo clear, a counted quest, a feat, a Give… from the shelf)
wait for the GM's edit and approval". World rule 8 (`docs/world/README.md`): every System message and every reward is
editable and approved by the GM before players see it. Today each of the four pays at once. Units, in order; each is one
reviewable commit with its machine's table test and chart:

1. **One pending-reward record** (`src/core/hunter/pending.ts`, new). Shape: `{ id, hid, from: 'solo' | 'quest' |
   'feat' | 'shelf', rewards: Rewards, window: SystemWords | null, at: 'waiting' | 'approved' | 'refused' }` in the
   GM's save, a pure `pendingStep` table (waiting: edit, approve, refuse; approved and refused are ends) and its
   chart. Approve is the one place that calls `grant` (grant.ts) and sends the `award` room event; a player's phone
   posts a request event instead of granting. Test to copy: `tests/held.test.ts`. Idempotent by id (a replayed
   request makes no second record).
2. **The GM's queue**: a "Waiting for you" list on the GM screen (gm.js, another helper's now) with each record's
   rewards in the Award form's fields (award.ts draft), Approve and Refuse. Its e2e: a player's counted quest
   completes, the GM edits the gold and approves, the player gets the edited gold once.
3. **Solo clear** (SMX-gates-2.3): `pay` in `src/core/gates/solo.ts` (around line 454) makes a `solo` record in
   place of the `soloAnswer` paid; the run's verdict is told at once, its rewards when approved.
4. **Counted quest**: `countQuests` in `src/core/hunter/noticed.ts` completes the quest (status done stays the
   System's) but its rewards become a `quest` record; on a player's phone it posts the request with the
   `questUpdate`. A hand-completed quest of the GM's is unchanged (the GM sees the Complete tap already).
5. **Feat**: a feat earned (feats.ts, noticed.ts) is recorded as earned at once (the Chronicle fact) and its reward
   becomes a `feat` record. Open: whether the "FEAT EARNED" window shows before the approval; default, it shows
   "Waiting for the GM" in place of the reward lines.
6. **Give… from the shelf** (SMX-gates-5.2): `HELD_TABLE.absent.pick` in `src/core/held.ts` opens the Award form's
   draft with the bundle filled in, and only the draft's send is held (the comment there names this cell).

Open for the owner or the lead: whether a reward the GM approves may be raised above what the rule pays (default: the
GM edits freely, as the Award form does).

Built (branch `rulings-20`, six commits, one a unit): both defaults taken as decided (the GM edits freely, above the
rule too; a feat's window shows "Waiting for the GM" in place of its lines). Where a reward goes is `ROUTE` by the seat
(`src/core/hunter/pending.ts`): alone it is paid at once, since no GM is there to ask; a player's phone posts the new
sealed `rewardAsk`; the GM's phone keeps a `PendingReward` in `settings.sync.pending` (chart "A reward waiting for the
GM", `pendingStep`). The record has no `from: 'shelf'` and no `window`: the shelf opens the Award form instead of making
a record (unit 6), and an approved reward opens REWARD RECEIVED saying what earned it (`AwardPayload.earned`). Approve
is the Award form's send tied to the record (award.ts `DraftTie`, the old `fromDrop` state is now `tied`), the record
approved in the award's one write, so a second approve pays nothing; the row's Approve sends it as it stands, Edit
opens it in the form. Refuse posts a `system` window sealed to the player. The `soloAnswer` verdict `paid` became
`cleared`, with no reward. A counted quest completes through `questDone` (`finishQuest` up to its reward). The notice
step's seat is read from the save's room fields, so a player offline in a room still asks. The GM's own hunters' feats
and counted quests in a room wait in the list too. Not changed: a personal gate's run and the GM's own solo run pay at
once; alone a Give… is held at its tap as before. Tests: `tests/pending.test.ts`, cases in `award.test.ts`,
`feats.test.ts`, `quests.test.ts`, `solo.test.ts`, `applied.test.ts`; new `tests/e2e/rewards-wait.e2e.ts`;
`solo.e2e.ts`, `feats-room.e2e.ts` and `reward-room.e2e.ts` changed to approve or to Give from the form.

## 21. The free revive and the revive on debt are a System raise: built

the owner: "System raise" (no GM button). World rule 6 and the machine "Revive standing" (`docs/world/machines.md`):
first revive free, then one on debt (ten Clears owed), then only a crystal or the GM. Rule 3: the GM applies the
hour; the app does not. Units:

1. **Revive standing on the hunter** (`src/core/hunter/vitals.ts` or a new `revive-standing.ts`): a stored field
   `reviveLeft: 'free' | 'debt' | 'none'` (repaired to `free`; the save's one-way migration gives existing hunters
   `free`), a pure table `{ free: { raise: 'debt' }, debt: { raise: 'none' }, none: { raise: null } }`, its table
   test and its chart. Only a System raise moves it; a crystal or the GM's Revive does not.
2. **The System raise**: a new `LifeEvent` `{ type: 'revive', by: 'system' }` (the life table's `dead.revive` cell
   takes it as today); `systemRaise(save, hid)` in grant.ts steps the standing and the life in one write, and on
   `debt` adds the debt (ten Clears at the hunter's rank, `economy.md` section 13; the number goes in `RULES` with its
   reason). Refused when the standing is `none`.
3. **Where it shows**: on the dead hunter's own phone, a System window "THE SYSTEM CAN RAISE YOU" with Rise (and the
   cost on debt) and Not now; no GM button. In a room the GM's phone hears it as a `revive` event by the System and
   its log says so. Since the GM applies the hour, the GM's screen shows that a raise is still possible.

Open: rule 8 says every System message waits for the GM's approval, and the raise is a System message; the owner's
"System raise, no GM button" is read as an exception (default). Also open: whether the raise is offered at once or
only after the fight ends (default: after the fight, since a fight's dead row is the GM's to revive).

Built (branch `rulings-21`, three commits): both Open defaults taken as decided. The ladder is `Hunter.reviveLeft`
(`src/core/hunter/revive-standing.ts`, `standingStep`, chart "A hunter's revive ladder"); `systemRaise` in grant.ts
writes the standing, the life (a revive `by: 'system'`, levels lost as any raising) and `Hunter.debt` (a second new
field: the gold owed, `RULES.reviveDebtClears` Clears of the rank, threaded through the room's rules) in one write that
also posts the room's new `systemRaise` message. `offerRaise` in hunter.js opens the window by itself once per death,
once no fight holds the hunter, and the dead sheet's Rise opens it again after Not now; the GM's phone logs the message
and its card shows a dead hunter's ladder; the bag shows the debt. Nothing pays the debt off yet. Tests:
`tests/revive-standing.test.ts`, `tests/e2e/raise.e2e.ts`; `crystal.e2e.ts` now starts its dead hunters past the
ladder, and `character.e2e.ts` answers Not now.

## Principles and proof

- principle-test-behavior-not-implementation: each test's expected value is read from his words (a consumable's time
  is between 0 and a standard action; a whisper reaches only the named phone; stealth at a sight equal to its level is
  hidden). Tests that encoded the old rule were rewritten, not re-run to their new output.
- principle-subtract-before-you-add: a rule that removed a distinction removed its code: `HideLevel`, `HIDE_LEVELS`,
  the parser's 0-to-1 step, the DC machine's `hunterRank` event and rank, the held machine's `crowded` event,
  `TurnHoldSend`'s `unheld`.
- After the merge of `origin/lead-backlog` (clean): `bun run test`, 5878 pass, 0 fail, last line "Ran 5884 tests
  across 132 files. [277.02s]" (run again after the maker fix).
- Browser tests run: table-turn and used, 28 passed; battle-map and makers, 90 passed and 2 failed on the maker
  refusing a stealth level of 0 (a real bug, fixed in "Ruling 23, follow-up"), then makers again, 61 passed;
  reward-room (with ruling 18's new test), dice and look, 56 passed.
