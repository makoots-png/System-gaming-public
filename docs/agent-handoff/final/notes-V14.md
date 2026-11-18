# V14: a sheet step answers what it changed

Goal: the words a player reads after a change to HP, life, mana or fatigue say what the change did, from the one table
that did it. Problem: hunter.js worked the life machine's transitions out again from objects held across the write,
copied the death save's numbers, judged collapse by its own sum, and charged a summon's mana in a write apart from the
summon, against the sheet's mana where a fight's row holds the true one. Smallest change: core answers what a change
was (`lifeNews`, `fatigueNews`) and a price is paid where the mana lives, with the thing it pays for, in one write.

## Inventory (code at c54e6f9)

| Row | Verdict | Where |
|---|---|---|
| H1 | still true | hunter.js:403-407 (`wasUp`, `now.life.at`), 426/435 (`h.life.at` read after the write from the held `h`), 471-476 (death save reads `h.life.at` after), 198-202 `lifeInFight`; quests.js:418-421 the same class (the quest held across its write) |
| H2 | still true | hunter.js:476 `nat >= 10`; 513-516 the pips count `3` |
| H3 | still true | hunter.js:279-280 `spendMana` compares `sheetOf(h).mana`; shadows.js:87 its caller |
| H4 | still true | hunter.js:436 `sheetOf(h).checks.dis` on every fatigue step, `fatiguePast(..., collapseAt)` for the word |
| S3 | still true | shadows.js:85-88: `spendMana`, then `stepShadow('summon')` in a second write |

## The rows

**H1.** Cause: the view decided "the hunter fell", "is stable", "is up" by reading `h.life.at` before and after a
write, the after from the object it held (live only because `writeInto` writes into it). Change: `lifeNews(before,
after)` in vitals.ts classifies a change of life (fell, raised, saved with its count, failed with its count, stable,
died, or nothing); hunter.js `lifeWrite(hid, write)` reads the life from the store before and again after, so a
refused write tells nothing and the fight's write-back (which moves the sheet's life in the same write) is read as
written. `lifeInFight` asks `lifeNews` for `raised`. quests.js `setProgress` reads the quest again after its write.
Tests: vitals.test.ts "what a change of life was" (each event, and every event a state refuses gives nothing);
character.e2e.ts "the sheet says what a step did". The audit asked `sheetEdit` to answer `{ from, to }`; reading the
store before and after works for the row path too (a hand edit in a fight is the fight's command, whose write-back
moves the life), where an answer from `sheetEdit` would not exist.

**H2.** Cause: the toast compared `nat >= 10` and the pips counted to a literal 3. Change: the death save's words come
from `lifeNews` (`saved` or `failed`, whatever the roll's threshold); `SAVES_TO_END` is exported and counted by the
pips and the words. Test: vitals.test.ts (the counts, and `SAVES_TO_END` ends the dying).

**H3.** Cause: `spendMana` checked the sheet's mana and then sent the spend to the row, whose mana is the true one in a
fight. Change: the price is checked where the mana lives. On the sheet, `sheetEdit`'s new `spend` (vitals.ts
`spendMana`) pays whole or refuses `mana`; on this phone's fight's row, the fight's `adjust` with the new `pay` flag
refuses `mana` when the row holds less (fight.ts, commit ec62832; the hand edit's clamp at 0 is unchanged), sent by
the new `combat.spend(cid, mana, also)` (combat.js, 524b458). Tests: vitals.test.ts "mana paid as a price",
fight.test.ts "mana paid as a price outside the fight".

**H4.** Cause: every fatigue step while past the disadvantage share toasted, lowering included, and "collapsed" was the
view's `fatiguePast`. Change: `fatigueNews(before, after, m, R)` answers `collapsed` (the `collapsed` field turned on,
which `setFatigue` owns) or `high` (rose across `disAt`), else nothing. Tests: vitals.test.ts "what a change of fatigue
crossed"; character.e2e.ts (+5 across says it once, +5 while past and -10 say nothing).

**S3.** Cause: a summon's mana and its state were two writes. Change: `hunter.spendMana(hid, n, also)` writes the price
and `also` (here `stepShadow(..., 'summon')`) in one write: on the sheet one `store.apply` of both steps, on a row the
fight's paid `adjust` with `also` in the same `fought` write (a refused `also` refuses the write). shadows.js asks
`can(h, sid, 'summon')` first, so the only refusal left to word is the mana.

Sweep: hunter.js's other writers of HP and life (the HP box, the steps, the death save, Revive) go through `lifeWrite`;
the GM board (gm.js) and the HUD (table.js) say nothing of the life and are left as they are.

Lines in Lane A's files: fight-types.ts and fight.ts (ec62832: `pay` on `adjust`, two lines and a test in
fight.test.ts); combat.js and api.ts (524b458: `combat.spend`).

Principles: model-the-domain (what a change was is a function of the table's two states, not of the tap);
fix-root-causes (the toasts read the store after the write instead of the held object); boundary-discipline (the
price's check is the owner's: the row's or the sheet's).

Left: none of this unit's rows. The toast words are unchanged except that fatigue now says "critically high" once
per crossing (for-the-owner.md).
