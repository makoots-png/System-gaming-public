# The fudge: the GM's hidden weight on a fight's dice (feature 8)

the owner, Nov 21: "There's something else I want to add, a "fudge factor" where I can click it and give a weight to their rolls. Either lowering them or raising them. This should NOT be visible to the players. Like if they encounter a mythic I want to be able to raise their rolls to give them a chance." And later that day: "Also I should be able to "fudge factor" my own rolls". By his ruling of the same day, a party of 3 beats a mythic enemy 5 to 10% of the time.

Read at the tree of branch `fudge` (Nov 21). "Read" means I read it in the code; "inferred" means I did not trace it to the end.

## 1. What exists today

**Every die of a GM's fight, and which phone rolls it.** Core never draws. `src/core/draws.ts` turns a source into dice and `src/edge/roll.ts` gives it the browser's `crypto` (read).

| Die | Rolled by | On which phone | What reads it |
|---|---|---|---|
| A target's reaction d20 (dodge share, resist, crit), with a second d20 for an edge and the held dice (`Needs.react`, `second`, `boost`) | `rollNeeds` in `combat.js` (lines 334, 348, 405) | The GM's phone, for every use. That includes a player's `cast`: "The GM's phone rolls each target's reaction d20 itself" (protocol.ts `CastPayload`) | `keptFace` (resolve.ts 419): it keeps the higher or lower die for an edge, moves the face by each held die, then clamps it to 1..20. `whereItEnds`, `resists` and `crit` read the result |
| An extra-turn refund's d20 (`Needs.refund`; it lands when the face is low) | `rollNeeds` | The GM's phone | `refundLands` (resolve.ts 363) |
| The opening d20 and its d1000 tie | `rollOpenings` in `combat.js` 245, 259 | The GM's phone | `openingOf` (fight.ts 76): the d20 plus the sheet's `opening` |
| A curse that passes on: the resist d20 | `rollSettle` (combat.js 171) | The GM's phone | `resists` in fight-turn.ts 341 |
| Damage and heal dice of the GM's own use | `rollNeeds` | The GM's phone | `Rolls.dice` |
| Damage dice of a player's use | `rollDice` in `uses.js` 123, sent as `cast.dice` | The player's phone. `castDice` puts them on the aimed target only; every other target's dice are the GM's | `Rolls.dice` |
| A death save's d20 | `app.api.dice.roll('1d20')` in `hunter.js` 535 | The player's phone. The player sees "You rolled N" and the roll goes into the player's session log. It is sent as `deathSave.roll` | The fight's `life` command on the GM's phone |
| An extraction's Presence check | `dice.roll` in `shadows.js` 60 | The GM's phone (inferred: it rolls for a remote hunter without its `hid`) | The extraction machine |

**What of a roll reaches a player's phone (read).** No d20 face. The fight doc (`fightDoc`, `fightWire`) holds the rows, their HP or band, statuses, the order (`ahead`), the map and the five newest log lines. A use's log line gives the outcome only: "Goblin caught, crit 12" or "Goblin avoids it" (fight.ts 255). One log line names a face, and that is a death save that raises its hunter: "rolls a 20 on a death save and gets up" (fight.ts 535). That roll is the player's own. The write-back to a player's hunter (`sendRemote`, `vitals`) carries HP, mana and the counts (crits, hits, avoided), all outcomes. The room's `rules` doc (`RoomRules`) carries no `RULES.fight` number. A player's phone shows no odds for the GM's fight: `paintOdds` paints only for `canRun()`.

**A check outside a fight (read).** `dice.check` and `dice.roll` in `dice.js` roll on the phone that taps, with the page's `Math.random` (`trayRandom`). The face and the total show on that phone: `1d20+3 [14] = 17`. A player's roll goes to the GM's Table feed as `roll` (`RollPayload`: its expr, its faces, its total). `checkBonus` (sheet.ts) gives the bonus. The GM's own tray roll stays on the GM's phone (inferred: `RollPayload.by` is a hunter's sheet key, and a GM has none).

So in a fight every d20 that decides an outcome is rolled on the GM's phone, and no phone shows its face. The one d20 a player rolls in a fight is the death save.

## 2. The design

Sections 2 to 5 follow the owner's rulings of Nov 21 (the last section, which keeps his words). Where an earlier draft of this file differs, the rulings won.

**What "a weight to their rolls" is: a shift of each die's face, clamped to its die.** A weight of n moves every face a die shows by n faces, and a face never leaves its die: `clamp(face + n, 1, sides)`. The shift is made where the die is drawn (`drawTerm` in `src/core/draws.ts`), before the formula's modifiers read the faces (`rollOf`), so keep and drop, rerolls, explosions and successes read a weighted face as they read a rolled one. It moves a d20 and a damage die the same way (ruling 1). The fight already moves a d20 like this: a held die moves the kept face (`keptFace`). I set aside:
- Rolling twice and keeping the better. That is the fight's edge, whose size is fixed (about +3.3 faces on average) and cannot be +1 or +2.
- Changing the die's odds. That adds a second kind of die to `draws.ts`, and the odds engine and the sim would need it too.
- A shift on the total, which ruling 1 left open. A player's phone shows the faces of every roll it makes outside a fight (`1d20+3 [14] = 17`, `2d6 [3, 5] = 8`). A shifted total either is not the sum of the faces shown or needs faces made up to match it, and it can pass what the dice can make (2d6 at +3 a die, as a total: 8 + 6 = 14, which no 2d6 shows). A shift on each face leaves every face one its die has and the total their sum plus the bonus. So a weighted roll has the shape of an honest one on every screen and in every payload, and a player's phone cannot tell it from one. It is also one rule for every die: a d20 is a die of one face.

A weight is worth more on a small die: +2 is 10% of a d20 and half of a d4. A 2d6 at +2 adds 3 on average, not 4, because a face of 5 or 6 stops at 6. That is the GM's to judge; each face still reads honestly.

**No bound (ruling 6).** A weight is any whole number of faces. `fight.fudgeMax` is gone. The clamp to the die is the only limit: past `sides − 1` a weight reads the die's top (or bottom) face every time.

**A forced face (ruling 6).** One tap forces the next d20 roll of one row (a hunter or a foe) to 20 or to 1. One tap, one roll, then it is gone. A forced face is not a shift: every d20 of that roll shows it (with an edge both dice do, so the kept one does too), and it counts as a natural 20 or a natural 1 (ruling 9). A force touches only d20s, never damage dice. In a fight its meaning is the row's luck: a forced 20 makes the die read as well as it can for that row. On a die that hinders the row (its target's reaction d20 when it attacks) a forced 20 reads 1. Two forces on one die (the user's 20 and the target's 20) cancel: both are spent and the die reads its weighted face. A force is spent by the first command that carries a d20 it decided, and a refused command spends none.

**Its sign is the row's luck.** A row's weight is a whole number. Plus means the dice fall its way, minus means against it. Since in this fight the reaction d20 belongs to the target, "raise their rolls" becomes the one rule below.

**The one rule in a fight.** A die the fight reads helps one body and may hinder another. Its weight is `fudge(helped) − fudge(hindered)`, with high faces good for the helped body; a die whose low faces are good moves the other way. With an edge each die is weighted first, then the edge keeps one, then the held dice move the kept face, then the face is clamped to 1..20 as today (`keptFace`).

| Die | Helped | Hindered | The weight on each face |
|---|---|---|---|
| A target's reaction d20 (dodge, resist, crit), and its second d20 for an edge | the target | the user | `fudge(target) − fudge(user)` |
| A use's dice on a body of the other side (damage) | the user | the target | `fudge(user) − fudge(target)` |
| A use's dice on a body of the user's side (a heal, a shield, a friend an area catches) | the user | none | `fudge(user)` |
| The opening d20 (the d1000 tie is not weighted) | its row | none | `fudge(row)` |
| A refund's d20, which lands on a low face | the user | none | `−fudge(user)` |
| A per-round op's dice (`settle`): damage or fatigue | none | the bearer | `−fudge(bearer)` |
| A per-round op's dice: heal or mana | the bearer | none | `fudge(bearer)` |
| A passing curse's resist d20 | the body it passes to | none | `fudge(body)` |
| A held die (rule 7b) | not weighted: it moves a d20 that already is, so weighting it too would count the weight twice | | |

So a hunter at +2 that a mythic attacks has its reaction die moved up 2. When that hunter attacks, the mythic's die moves down 2 (it crits more often and is dodged less), and each of the hunter's damage dice moves up 2. If the party and the foes are both at +2, every die between them reads as at 0. A face weighted to its die's top counts as a rolled top: a 20 is a natural 20, and an exploding die explodes, within `EXPLODE_MAX`.

**Death saves (ruling 4).** They are removed from the game by the unit `no-death-saves`. The fudge units build nothing for them.

**Scope: the two sides and one row; the two add.** `fudge(b)` is the weight of b's side plus b's own. "My own rolls" are the foes: their reaction dice, their damage dice and the faces their attacks read, all moved by the foe side's weight or a single foe's. I leave out a weight per ability, per kind of roll and per pair of rows. Each would be a new concept and needs a screen to show it. A force is a row's only: "the hunters' next roll" names no one roll.

**Life in a fight: it belongs to the fight (ruling 2).** A fight's fudge is made at 0 with the fight. Setup and running hold it, through every round, as the GM set it. An ended fight has none: the type `Ended` has no `fudge`, and `ended()` (fight-turn.ts), which builds the ended fight field by field, drops it. So nothing can read a weight off a fight that is over, and the next fight starts at 0. A force not spent goes with it.

**Outside a fight: the table weight (ruling 5).** A hunter's rolls outside a fight (a stat check, the dice roller) read a second weight, the GM's `TableWeight`: one for the hunters and one per hunter by its sheet key, which add, and a forced face per hunter. It is not the fight's: a fight starts at 0 whatever the table weight is, and the fight's weight never leaves the fight. Its life: it stays until the GM sets it to 0, and the gold dot on the GM's control shows it is on (the lead's default). It is applied where the roll is made today, on the phone that rolls:
- The GM's phone sends each hunter its own total (the hunters' weight plus its own) and its force in a room message `weigh`, sealed to that hunter's phone (`servedTo`). It carries a total, so a replay sets the same value; the player's phone applies each `weigh` once by its event id (`appliedOnce`), so a force spent is not set again by a copy.
- The player's phone keeps it in a phone field of `settings.sync` (`SYNC_OWNER` 'phone'), which no file holds (`exportedSave`), and draws every roll its hunter makes with it: `dice.check` and `dice.roll`.
- A hunter the GM's phone holds has no other phone: the GM's phone reads the table weight itself.
- A force is spent by the hunter's next roll that has a d20. The player's phone clears its copy as it rolls. The GM's phone clears its own when that hunter's next `roll` with a d20 reaches the Table feed.
- A solo run is a fight with no GM. It reads no table weight, so its odds line (which a player reads) cannot move with one.

**What a player sees of a weighted roll outside a fight** is in the rulings' last part: the weighted face, never a separate number; face + bonus = total; with an edge both dice shown, each already weighted, the kept one marked; a forced face on every d20 of the roll.

**The data shapes.**
```ts
// fight-types.ts. Setup and Running hold `fudge: Fudge`; Ended does not.
export const FORCED_FACES = [1, 20] as const;
export type ForcedFace = (typeof FORCED_FACES)[number];
export type Fudge = {
  readonly sides: Readonly<Record<Side, number>>;
  readonly rows: Readonly<Record<CombatantId, number>>;        // no entry: 0
  readonly forced: Readonly<Record<CombatantId, ForcedFace>>;  // the row's next d20 roll
};
export type FudgeScope = { readonly kind: 'side'; readonly side: Side } | { readonly kind: 'row'; readonly id: CombatantId };
export type FudgeSet =
  | { readonly kind: 'weight'; readonly scope: FudgeScope; readonly n: number }
  | { readonly kind: 'force'; readonly id: CombatantId; readonly face: ForcedFace | null };
// Command: | { readonly type: 'fudge'; readonly set: FudgeSet }

// draws.ts: what a draw is given for one term. A number moves each face; `forced` sets each face.
export type Weight = number | { readonly forced: number };
```
The fudge has no states, so it needs no machine. It has one writer, `fudgeStep(fudge, event)` in `src/core/combat/fudge.ts`, whose events are a `FudgeSet`, a row that left (`left`: its weight and its force go) and, from unit 4, the forces a command read (`spent`). The fight's `fudge` command is a cell in each row of `TABLE`: setup and running take it, none and ended refuse it (`notNow`). It sets rather than adds, and a command that sets what is there already leaves the fight as it was and is not refused, so a replay or a double tap changes nothing. A weight that is not a whole number, or a forced face that is not 1 or 20, is refused (`fudgeValue`); a row not in the fight is refused (`unknown`). The command writes no log line and raises no effect. `fight-parse.ts` reads a fight with no `fudge` as all 0 and refuses a fudge that names a row the fight lacks. The fight's weights for one draw are worked out by one reader, `weightsFor(f, by, needs)` in `fudge.ts` (with `openingWeights` and `settleWeights`), which the GM's `rollNeeds`, `rollOpenings` and `rollSettle` and the odds engine's draws are given. `needs` asks for the same dice either way, because a weight moves faces but adds no die.

**Every die of a fight is drawn on the GM's phone.** Today a player's `cast` carries its own damage dice (`cast.dice`, `castDice`). Unit 2 takes them out: the GM's phone rolls a cast's dice for every target, as it rolls the GM's own uses' dice and every d20. The player's phone never showed those dice, so nothing a player sees changes. It is a subtraction (a payload field and a function go), and it keeps the fight's weight on the one phone that holds it, so the fight needs no copy of it anywhere else (section 3).

**Where the GM sets it in a fight.** In the Fight tools sheet, under See as, a Fudge block of two lines: "Hunters" and "Foes", each `− 0 +` with 44 px buttons. A line is about 300 px wide, so it fits on a 390 px phone. A row's own weight is the same stepper on that row's GM card (`cardOf`, which only the GM's phone draws), with "Next roll: 20 · 1 · off" under it. The fewest taps for party +2: open Fight tools, then `+` twice, so 3 taps. Each tap is one `fudge` command at the new value.

**Where the GM sets it outside a fight.** On the GM screen's Party board (`gm.js`): a Hunters line and each hunter's line, the same `− 0 +` and Next roll choice. Each tap posts `weigh` to the hunters it changes.

**How the GM sees it is on (ruling 7).** While any weight or force is set, the Fight tools button (for the fight's) and the Party board's heading (for the table's) carry a small gold dot, and the label for a screen reader says "fudge on". A card whose row's `fudge(b)` is not 0 shows "Fudge +2" in its own line, and "Next roll 20" while a force waits. A player who looks at the GM's phone could read the card. The dot alone says nothing to someone who does not know it. No roll shows the GM its unweighted face (ruling 8).

## 3. The secrecy

Ruling 5 sets the rule: "Idc if the data is on their phone, they just need to not be able to see it on the website." No screen of a player's phone shows a weight or anything worked out from it (no number, no dot, no word, no changed odds line), and no export a player can open as text holds it. In a fight the design keeps more than that: the fight's weight never leaves the GM's phone. Each path a player's phone could learn it from:

- **A fight's dice.** From unit 2 every die of a fight is drawn on the GM's phone, with the weight. A player's phone draws none, so nothing about the fight's weight has to move between phones.
- **A fight's faces.** No phone shows a fight's d20 face, and a damage roll shows only as the HP it took. A weighted face is a face its die has, so every number a screen shows is one an unweighted fight could show: caught or avoided, crit or not, resisted, who goes first, the damage dealt.
- **The doc and its log.** `fightDoc` copies named fields of each row (`docRow`) and never the fight's `fudge`. A log line gives outcomes only. A weighted fight's doc is exactly the doc of the same fight with the same drawn faces and no weight. Section 5, unit 5, names that test.
- **Setting the fudge.** The `fudge` command leaves the doc equal. `publishNow` in sync.ts already sends nothing for a doc equal to the last one put (`sameDoc` ignores `at`), so no put and no change of pace can betray the tap.
- **Room messages in a fight.** No `EventDef` carries a `Fight`. `onTurn` reads one but sends none. The write-back (`sendRemote`, `vitals`, `noted`) carries outcomes and counts.
- **Saves.** The `Fudge` lives in the GM's save, in the fight. A player's save never holds the GM's fight. The GM's own export holds it, and that file is the GM's.
- **Odds.** Only the phone that runs the fight paints its odds. A solo run has no GM, no fudge and no table weight.
- **The table weight (outside a fight).** It is on the player's phone by ruling 5: the `weigh` message, sealed to that hunter's phone, and a phone field of `settings.sync`. Its applier writes no news, no toast and no feed line. The field is in no file (`exportedSave` leaves the phone's fields out). The roll a player makes looks and travels as an unweighted roll does: the face shown is the weighted one, the bonus is the player's own, and the `roll` message to the GM's Table feed has the same fields (its expr, its faces, its total).

**The honest limit.** Outcomes are visible, so a watchful player can count them. A hunter sheet shows Crit faces 2, which means 10% of hits are crits. Against a foe at −2 the party lands about 20% crits over the evening; against a mythic at +2 almost none. Reaction against Accuracy predicts a share of dodges, and a weighted party dodges more than that share. Damage at +2 a die sits near the top of its range. A shift of 1 or 2 is lost in the noise of statuses and edges over one fight; a shift of 5 shows over an evening, and with no bound a shift of 19 makes every d20 read the same face. A player who reads the page's storage or its network traffic (not the website's screens) can find the table weight; ruling 5 accepts that. The source is public, so a player can know the feature exists, and a player who looks at the GM's card can read "Fudge +2".

## 4. The odds and the balance simulation

**The odds engine counts the fight's fudge through the same draws.** `playBegin` and `playStep` (play.ts) play the GM's own `Fight` on the reducer, and the `Fudge` is part of that fight. From unit 4 its draws are given `weightsFor` as the GM's are, so a played fight is weighted as the real one will be, and a force applies to that row's first roll in each played fight. `oddsKey` is the fight without its log, so a changed weight makes a finished answer `stale` and the GM taps again. The line names the weight when any is on: "The party wins about 30% (with your fudge). Mina is most likely to go down (60%). About 6 rounds." `oddsLine` gets that clause from the fight it was given (`fudgeOn(f)`), so the words cannot drift from the numbers. To compare, the GM reads the stale answer, sets +2 and asks again. The previous answer stays on screen, marked stale, until the new one is in. Only the GM's phone paints these odds.

**The balance simulation.** `Setup` in `tests/models/fight-sim.ts` gets `fudge?: Fudge`, which it puts on the fight it starts, and its draws are given the same weights, so its counts match the reducer. A new case in `tests/fight-sim.test.ts` prints a party of 3 against a mythic at hunter weights 0, +1, … +5 (where the table stops, not a bound). The mythic kind is proposed in `features/enemies/balance-plan.md` section 4, and until it lands the stand-in is an S boss. The case asserts two things: the win rate does not fall as the weight rises, and at 0 it is the ruling's 5 to 10% once the mythic kind is balanced. Until then the stand-in's numbers are printed, not asserted (principle-explain-the-number). The GM's question "what does +2 do to a mythic" then has a row in a printed table and a number on the odds box.

## 5. Units, in order

Each unit ends with `bun run test` green and its named tests passing. Its guide rows (combat.md: the dice row, the odds row, the doc row, and the fudge's own row) and `bun run deps -- --write` change in the same unit, and `bun run charts` when it changes a machine's table. Each unit changes only the files it lists.

1. **The fudge's shape and command** (opus). Files: `src/core/combat/fight-types.ts` (`Fudge`, `FudgeScope`, `FudgeSet`, `ForcedFace`, the `fudge` command, the refusal `fudgeValue`), `src/core/combat/fudge.ts` (new: `NO_FUDGE`, `fudgeStep`), `src/core/combat/fight.ts` (the `fudge` cell in each row of `TABLE`, a new fight's `fudge`, a removed row's entries through `fudgeStep`), `src/core/combat/fight-parse.ts`, `src/core/combat/refusal-words.ts`, `scripts/charts/fight.ts` (the command's words), `tests/models/fight-play.ts` (the command in `randomCommand`), `tests/fight-model.test.ts` (the invariants: a fudge names only rows of the fight, an ended fight holds none), `tests/fight.test.ts`, `tests/lint.test.ts`, `docs/guide/combat.md`, `docs/state-machines.md`, `docs/dependency-map.md`. Tests: "a fudge is set, not added: the same command twice leaves +2"; "a new fight's fudge is 0 for both sides, no row's own and no forced roll"; "a side's weight and a row's weight are kept apart, and a row set back to 0 leaves no entry"; "a weight has no bound: +40 is kept as set"; "a GM forces a row's next roll to 20, then to 1, then takes it off"; "a weight that is not a whole number, or a forced face but 1 or 20, is refused"; "a fudge on a row not in the fight is refused"; "setting a fudge writes no log line, raises no effect and takes no time, in setup and while running"; "an ended fight refuses a fudge and holds none, so the next fight starts at 0"; "a removed row's weight and force go with it, and a row that joins again under its id starts at 0"; "a fight read from a save without a fudge has all 0"; "a saved fudge reads back as it was set, and one naming a row the fight lacks, or not whole, is no fight"; "the fight's doc for the players holds none of the fudge". Built Nov 21 on branch `fudge-1`. Lint: "only the fight's fudge command writes a fight's fudge". What a table sees: nothing changes.
2. **The GM's phone rolls every die of a cast** (sonnet). Files: `src/core/protocol.ts` (`CastPayload.dice` goes), `src/core/combat/resolve.ts` (`castDice` goes), `src/views/uses.js`, `src/views/combat.js`, `tests/protocol.test.ts`, `tests/resolve.test.ts`, and the cast case of `tests/e2e/` that posts one. Test: "a player's cast lands with the dice the GM's phone rolled for each target". What a table sees: nothing (no phone showed those dice).
3. **The weighted draw** (opus). Files: `src/core/draws.ts` (`Weight`, the face shift in `drawTerm`), `src/edge/roll.ts` (`rollTerm`, `rollFormula` take a weight, 0 by default), `tests/roll.test.ts`. Tests, each expected value from the rule: "a weighted face moves by the weight and stays on its die" (a d6's 5 at +3 is 6, its 2 at −5 is 1); "advantage weighs each die before it keeps one" (7 and 15 at +2: `kh1` keeps 17, `kl1` keeps 9); "a forced face is every d20 of the roll" (`2d20kh1` forced 1 keeps 1); "a die weighted to its top explodes as a rolled top does, within EXPLODE_MAX"; "a weight of 0 draws what an unweighted draw draws from the same seed". What a table sees: nothing.
4. **The fight's faces** (opus). Files: `src/core/combat/fudge.ts` (`fudgeOf`, `weightsFor`, `openingWeights`, `settleWeights`, the `spent` event), `src/core/combat/fight.ts` (`reduce` spends the forces a command read), `src/core/draws.ts` (`drawNeeds`, `drawOpenings`, `drawSettle` take the weights), `src/edge/roll.ts` (`rollNeeds`, `rollOpenings`, `rollSettle` pass them), `src/core/combat/play.ts`, `src/views/combat.js` (gives the draws the fight's weights), `tests/fudge.test.ts` (new), `tests/fight.test.ts`, `tests/odds.test.ts`. Tests, each expected value from the rule: "a hunter at +2 is not crit on the drawn face that crits at 0" (drawn `critFaces`, read `critFaces + 2`); "a hunter at +2 crits a foe on a drawn face of critFaces + 2"; "a party and a foe both at +2 roll as at 0"; "a drawn 19 at +5 is 20 and resists as a natural 20"; "a drawn 1 at −5 stays 1"; "a hunter at +2 deals each damage die 2 faces higher, within the die" (2d6 drawn 3 and 6 deal as 5 and 6); "a foe's heal on a foe at foe +1 moves each die up 1"; "a bleed on a hunter at +2 moves each die down 2"; "a refund at +3 lands on a drawn face 3 higher"; "an opening at +2 comes 2 faces earlier"; "the edge keeps a weighted die" (7 and 15 at +2, kept high, read 17); "a hunter forced to 20 is read as a natural 1 on the foe it attacks, then the force is gone"; "a hunter forced to 20 that is attacked reads a natural 20"; "two forces on one die cancel and both are spent"; "a refused command spends no force". The odds engine still plays every fight to its end (`tests/odds.test.ts`). What a table sees: under a weight, the fight's outcomes change.
5. **The secrecy proofs in a fight** (opus). Files: `tests/fight-doc.test.ts`, `tests/lint.test.ts`. Test "a weighted fight reaches the table byte for byte as the same fight unweighted": fight A has the hunters at +2 and a forced face, fight B is A with `NO_FUDGE`; for a use with the same drawn faces, `JSON.stringify(fightWire(fightDoc(A, R, ctx)))` equals the same for B, and so do the `sendRemote` and `vitals` payloads and every effect but the GM's own. Test "setting a fudge leaves the players' doc equal" passes the doc before and after to `sameDoc` and expects true. Lint: "nothing a player's phone receives in a fight names the fight's fudge" (`fight-doc.ts`, `protocol.ts`, `sync.ts`, `table.js`, `uses.js` never name `fudge`; the table weight is named `weight`, never `fudge`, so the lint stays one word). What a table sees: nothing; that is the test.
6. **The odds and the simulation** (sonnet). Files: `src/core/combat/odds.ts` (`fudgeOn`, the line's clause), `tests/odds.test.ts`, `tests/models/fight-sim.ts`, `tests/fight-sim.test.ts`. It waits for the threat and balance branch, which changes `tests/models/fight-sim.ts`, to land. Tests: "a changed fudge makes a finished answer stale"; "the line says with your fudge only while one is on"; the printed table of section 4. What the GM sees: "about 30% (with your fudge)".
7. **The GM's fight controls** (sonnet). Files: `src/views/combat.js` (the Fudge block in Fight tools, the dot, the card's stepper and Next roll), `src/core/combat/fight-view.ts` (`Card.fudge`, `Card.forced`), `tests/fight-view.test.ts`, `tests/e2e/fudge.e2e.ts`. Browser tests with a GM phone and a player phone, on a 390 px viewport: "the GM fudges the hunters +2 in three taps and the player's phone shows and hears nothing of it" (Fight tools, `+`, `+`; the dot and "Fudge +2" on the hunter's card; on the player's phone `hunterApp.api.sync.doc('fight')` equal before and after and no request body naming `fudge`); "the GM forces a foe's next roll to 20 and the card says so until that roll". What a table sees: the GM's dot and card lines.
8. **The table weight on the GM's phone** (opus). Files: `src/core/table-weight.ts` (new: `TableWeight`, `weightStep`, `weightOf(tw, key)`), `src/core/save.ts` (the GM's `tableWeight`, its default and repair), `src/core/protocol.ts` (`weigh`: `gmOnly`, sealed to the named hunter's phone, a total and a force; its bounded reader), `src/edge/room-events.ts` (its applier: none on the GM's phone), `src/views/gm.js` (the Party board's lines and dot; a force cleared by that hunter's next d20 `roll`), `tests/table-weight.test.ts` (new), `tests/protocol.test.ts` (`VALID`, a case per bound), `tests/server-rooms.test.ts` (sealed), `docs/guide/room-sync.md`, `docs/guide/hunters.md`. Tests: "a table weight is set, not added"; "a hunter's weight is the hunters' plus its own"; "a weigh reaches only its hunter's phone"; "a force is cleared when that hunter's next d20 roll reaches the Table feed". What a table sees: the GM's controls; nothing on a player's phone.
9. **The weight on a player's rolls** (opus). Files: `src/edge/room-events.ts` (the player's `weigh` applier, once by its id), `src/core/save.ts` (the phone field of `settings.sync`, `SYNC_OWNER` 'phone'), `src/views/dice.js` (`roll` and `check` draw with the hunter's weight, spend a force, and show face + bonus = total), `tests/save.test.ts` ("no file holds the table weight"), `tests/e2e/fudge-table.e2e.ts`. Tests, from the rulings' last part: plain, advantage and disadvantage, each with a weight up, a weight down and a forced face, each showing face + bonus = total with every face inside its die; "what the player's phone holds and receives for a weighted roll has the shape of an unweighted one" (the `roll` payload's keys, the shown line); "the player's page names no weight" (its text for a weighted roll equals its text for an unweighted roll of the same faces); "a forced 20 shows on both dice of an advantage roll and is gone on the next roll". The coin call reads the weighted face as natural (`naturalOf`); the coin's own files stay with their holder. What a player sees: weighted faces, and nothing that says so.

## 6. Open questions for the owner, each with the default the build uses

He answered these nine on Nov 21 (the next section); sections 2 to 5 now follow his answers. They stay here as he was asked them.

1. Does the fudge move only d20s, or damage dice too? Default: d20s only (dodge, resist, crit, opening, refund).
2. Does it end when the fight ends? Default: yes. Each fight starts at 0.
3. Are the scopes the hunters, the foes and one row, adding up? Default: yes.
4. Should death saves count? Default: no, because the player sees their own face. Counting them would mean the GM's phone rolls death saves.
5. Should checks outside a fight count, or the GM's own tray rolls? Default: no. The face shows on the phone that rolls it, and the DC is already the GM's.
6. Is ±5 the right bound? Default: yes (`fudgeMax` 5, 25% at the most).
7. Should the GM's screen mark it with a gold dot on Fight tools, or show the number plainly? Default: the dot, with the number on each card.
8. Should the GM see each fudged roll ("10, fudged to 12")? Default: no. The GM sees the setting, not each roll.
9. Does a fudged face of 20 count as a natural 20? Default: yes, as held dice do today.

Still open after the rulings, each with the default the build uses:

10. Is the GM's own tray roll outside a fight (the GM's phone, no hunter) weighted? Default: no. "My own rolls" are the foes' in a fight, and outside one the GM sets their own outcome.
11. Does the table weight carry into a fight, or the fight's out of it? Default: no. A fight starts at 0 (ruling 2), and the table weight stays until the GM sets it to 0.
12. Is the extraction's Presence check a hunter's roll the table weight moves? Default: no while the GM's phone rolls it with no hunter named (section 1); it would follow once it names its hunter.
13. With no bound, does +2 mean 2 faces on every die, a d4's as a d20's? Default: yes, faces on every die (section 2); a weight per die size would be a new concept.

## The owner's rulings on the defaults (Nov 21, typed in the lead's session). These win over every section above

His words, in the order of the nine defaults: "It absolutely can touch damage dice.  It does reset to 0.  Sure that works.  Let's do away with death saves entirely.  I don't know what this means.  No bound -- Have an option to force either a 1 or a 20 just for the next roll. Fine.  Fine.  Yes."

1. The weight also touches damage dice. (The default said no: changed. The design must say how a weight reads on a damage roll: a shift on each die's face within the die, or on the total; and that a player's phone, which sees damage numbers, cannot tell.)
2. It goes back to 0 when the fight ends.
3. Three scopes: hunters, foes, one row.
4. Death saves are removed from the game, so the weight has none to touch. He ruled what replaces them: "Youre dead. You need to be ressed." (the unit `no-death-saves`, for-the-owner Answered); the fudge units build nothing about death saves.
5. "Just have my fudge factor affect how their dice rolls." The weight also applies to a player's rolls outside a fight (a stat check, the dice roller). The owner then ruled how hidden it must be: "Idc if the data is on their phone, they just need to not be able to see it on the website." So the weight may be sent to a player's phone and applied there, where the roll is made today; the rule is that no screen of a player's phone shows it or anything worked out from it (no number, no dot, no word, no changed odds line), and that it is in no export a player can open as text on the site. This wins over the stricter secrecy of section 3 above for rolls outside a fight, and it lets the fight's design take the simpler path too wherever a player's phone needs the weight. The face a player sees is the weighted one, with nothing to mark it. Outside a fight the weight does not reset at a fight's end: say what its life is there (the lead's default: it stays until the GM sets it to 0, shown by the gold dot).
6. No bound on the weight (`fight.fudgeMax` goes; the face is still clamped to the die). And an option to force a 1 or a 20 for the next roll only: one tap, one roll, then it is gone; a forced 20 counts as a natural 20 and a forced 1 as a natural 1 (ruling 9).
7. A gold dot shows the GM it is on, with the number on the row's card.
8. No roll shows the GM its unweighted face.
9. A roll weighted up to 20 counts as a natural 20.

A builder reads this section first.

### What a player sees of a weighted roll (the owner, Nov 21, right after ruling 5)

His words: "Ok so they will click a roll or whatever, they will have the dice rolling animation or whatever, it'll show what they get.  That should already be pre-weighted by whatever fudge factor I put on, + whatever bonuses they get.  So ideally it like shows a dice face + bonus number = final number.  Make sure this works for advantage and disadvantage and stuff."

So, for a roll a player makes outside a fight:

- The player taps the roll and sees the die's animation as today. The face it lands on is the weighted face: the weight is in the face, never a separate number, and never in the bonus.
- The screen shows the die's face + the bonus = the total ("14 + 3 = 17"). The bonus is the player's own (stat, items, title), unchanged by the weight.
- With advantage or disadvantage both dice are shown, each already weighted, and the kept one is marked as today; the weight applies to each die before the higher or lower is kept, so a forced 20 or 1 (ruling 6) reads as that face on the kept die.
- A face is always one the die can show (1 to 20 on a d20), so a weighted roll looks like any roll.
- Tests: the three shapes (plain, advantage, disadvantage) with a weight up, a weight down and a forced face, each showing face + bonus = total with the faces inside the die; and that what the player's phone holds and receives for a weighted roll has the same shape as for an unweighted one.
