Goal (the owner, Nov 22): "rests will give 25% of mana back, and 25% health back. exhausted will largely clear. They should get 2x per dungeon, and after a dungeon clear they should get everything back." And Nov 21: "Youre dead. You need to be ressed." Smallest change: one rest in place of the short and long rests, its numbers in `RULES.rest`, a count of rests on the hunter that a gate's Clear sets back to 0 with everything else.

# Notes: feature 10, a rest

## 0. What exists today (at 314dfa2)

- Two rests, `short` and `long`, one vitals event `{ type: 'rest', kind }` (`vitals.ts` `CELLS.rest`), each the rules' percent of a maximum: `RULES.rest.short` 25% HP, 50% mana, 25% of the fatigue capacity off; `RULES.rest.long` 100% of each. Only a long rest ends a collapse (Exhausted, `COLLAPSE_MOVES.rest` `longRest`) and gives back the uses of an ability limited "n a long rest" (`Vitals.used`, `uses.ts` event `longRest`).
- Who taps it: the Status Window's "Short rest" and "Long rest" buttons (`hunter.js`), on whatever phone holds the hunter: a player for its own hunter, the GM for a hunter on the GM's phone. `api.hunter.rest(kind, hid)` goes through `vitalsEdit`: refused in any fight ("You cannot rest during a fight."), else `sheetEdit` on the sheet. A player's sheet then reaches the GM by the sheet push. No room message carries a rest.
- What counts them: nothing. A rest was unlimited, any time. The chronicle tallies long rests (`longRests`), the window of a feat count "between long rests" (`counts.ts` `within: 'rest'`, the Marathoner feat).
- The dead: `VITAL_TABLE.dead.rest` is true (SMX-rules-1.2 waited on the owner): a rest filled a dead hunter's mana and ended its collapse.
- A gate's Clear restores nothing. It pays (`settleClear`, pay.ts) and records a `gate` fact on every payee: a local hunter in the Clear's write, a player's hunter by a `noted` message after its pay, a personal gate won alone in `soloRan` (solo.ts).
- "In a gate": only the GM's phone knows. A gate's status (`raiding`), the fight's gate (`Save.fightRefs.gate`, GM's phone only), `Gate.fought` (written at a fight's settle). A player's phone knows none of it for its own hunter: the world doc shows gates, not who is in them. What does reach every payee's phone is the Clear's `gate` fact.

## 1. The shape

- `RULES.rest`: `{ hp: 0.25, mana: 0.25, fatigue: 0.75, perGate: 2 }`. `hp` and `mana` are shares of the maximum given back (rounded up, never past the maximum); `fatigue` the share of the fatigue the hunter has that a rest takes off (rounded up). "Exhausted will largely clear": "largely" is the owner's word, 0.75 is the lead's number. Exhausted (the collapse latch) lifts when the fatigue left is under the collapse share (`R.fatigue.collapseAt`), the old long rest's recount.
- One rest. Short and long are deleted (the event's `kind`, the two rule rows, the two buttons, the fact's `long`). What the long rest did beyond a rest is the Clear's now.
- The count: `Hunter.rests`, rests taken since the hunter's last gate Clear, 0 to `perGate`. Its machine is `src/core/hunter/rests.ts` (`RestState` left or spent, `restStep` and its `TABLE`: `rest` adds one while one is left and is refused `spent` after; `cleared` sets 0). Its one writer is `sheetEdit` (grant.ts). Chart "A hunter's rests".
- A gate's Clear is a vitals event, `cleared`: HP and mana full, fatigue 0, the collapse lifted, every use limited "n a gate" back, and the count to 0. It runs where the hunter's `gate` fact is recorded, by `noteFacts` (grant.ts): `settleClear` for a hunter on the clearing phone, the `noted` applier for a player's hunter, `soloRan` for a personal gate won alone. So whatever cleared the gate, on whichever phone, the hunter gets everything back in the write that tells it of the Clear.
- An ability's uses "n a long rest" become "n a gate" (`AbilityGate` `per: 'gate'`, uses event `cleared`): the long rest that gave them back is gone, and the Clear is what gives everything back now.
- The dead: a rest is refused (`VITAL_TABLE.dead.rest` false) and changes nothing; the refusal's words name the ways back. SMX-rules-1.2 is answered for the rest.
- The window "between long rests" of a feat count is "between rests": the tally `rests` counts every rest.

## 2. Units

A share is a fraction of 1 (the `SHARE` domain). HP and mana back: `ceil(max * share)`, so 10 of 100 HP rests to 35. Fatigue off: `ceil(fatigue * share)`, so 80 rests to 20. A count is whole rests.

## 3. How a room hears it

As today: the player taps Rest on its own sheet; the sheet push carries the result. The Clear's restore needs no new message: the `noted` message that already carries a player's `gate` fact is where the player's phone restores. No change to protocol.ts.

## 4. Open questions, each with the default built

1. "Per dungeon" when no gate is open. A player's phone cannot know which gate its hunter is in (section 0), and a Clear is the one gate event that reaches it. Built: the count is rests since the last Clear, so rests outside a gate are offered and count toward the next gate. To count from a gate's entry instead, the GM's Enter (or a fight's start in a gate) would need a room message to each player: a protocol change, not built.
2. A world gate closed, broken or left uncleared does not set the count back: the count carries to the next gate. A solo run's end, won, lost or retreated from, does (rests.ts `gateLeft`, `soloRan`): it is the one other gate's end a player's phone sees.
3. A dead hunter at a Clear. The lead's ruling (Nov 22): a dead hunter gets nothing. Built: `VITAL_TABLE.dead.cleared` is false, so the life, mana, fatigue and uses stay as they were; the count of rests starts again, since the count is the gate's and the next gate is a new one (grant.ts `ended`). To leave the count spent too, `ended` returns the refusal for the dead.
4. The fatigue bar's own "Rest" button (a hand edit to 0) stays as it is: it is the bar's hand edit, not a rest, and is not counted.
5. A rest in a fight stays refused.

## 5. Finished (Nov 22, the second helper)

- Done on top of the two work-in-progress commits: the dead get nothing from a Clear (above), tests with expected values from the owner's words (`tests/rests.test.ts`: 10 of 100 rests to 35, 80 fatigue to 20, a third rest refused), the solo and feats tests moved to the one rest, the Rules page's lines tested, the chart and the dependency map redrawn.
- Browser files that held the old rests: `character.e2e.ts` (the dead's rest is refused; a collapsed hunter's rest; a third rest refused) and `gates-quests-dailies.e2e.ts` (a quest and a daily counted on rests).
- Principle that changed a choice: principle-test-behavior-not-implementation. The unit tests' numbers were worked from `RULES.rest` and are now the owner's numbers written out, so a change to the rule shows in a test.
- The sheet now shows two buttons that say "Rest": the fatigue bar's hand edit to 0 (question 4) and the rest itself. Kept as the design says; worth a look.
