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

**What "a weight to their rolls" is: a shift of the d20's face, clamped to 1..20.** The fight already has this move: a held die moves the kept face the same way (`keptFace`). I set aside the alternatives:
- Rolling twice and keeping the better is the fight's edge. Its size is fixed, about +3.3 faces on average, and it cannot be +1 or +2. Doubling the GM's d20 draws also shows nowhere, so it is no more secret than a shift.
- Changing the die's odds adds a second kind of die to `draws.ts`, and the odds engine and the sim would need it too.
- A shift of n faces is a number a GM can state: "+2 makes every threshold 10% easier". It also stacks with a real edge and held dice under the one clamp.

At the table no phone shows a face (section 1), so a shift reads as luck.

**Its sign is the row's luck.** A row's fudge is a whole number. Plus means the dice fall its way, minus means against it. Since in this fight the d20 belongs to the target, "raise their rolls" becomes the one rule below.

**The one rule.** A d20 the fight reads helps one body and hinders another, or no other. Its face becomes `clamp(face + fudge(helped) − fudge(hindered), 1, 20)` with high faces good for the helped body, and is applied once, after the edge and the held dice:

| d20 | helped | hindered | high is good for the helped |
|---|---|---|---|
| A target's reaction d20 (dodge, resist, crit) | the target | the user | yes |
| The opening d20 | its row | none | yes |
| A refund's d20 | the user | none | no: the face moves down by `fudge(user)` |
| A passing curse's resist d20 | the bearer it passes to | none | yes |

So a hunter at +2 that a mythic attacks gets its own die moved up 2 faces. When that hunter attacks, the mythic's die moves down 2: it crits more often and dodges less. If the party and the foes are both at +2, the two cancel. A shifted face of 20 counts as a natural 20, as a face moved by held dice does today.

**What it leaves out (defaults, section 6).** Damage and heal dice: a player's own phone rolls them, they come in many sizes, and the mythic problem is about hitting, avoiding and crits. Death saves: the player sees the face on their own phone (section 3). Checks outside a fight, the extraction roll and the GM's tray: the face shows on the phone that rolls, and the GM already sets the DC.

**Scope: the two sides and one row; the two add.** `fudge(b)` is the fudge of b's side plus b's own fudge, kept within `±fudgeMax`. "My own rolls" are the foes: their own reaction dice and the faces their attacks read. Both are covered by the foe side's fudge or a single foe's. I leave out a fudge per ability, per kind of roll and per pair of rows. Each would be a new concept and needs a screen to show it.

**Life: it belongs to the fight.** A fight's fudge is created at 0 with the fight and ends with it. The next fight starts at 0. It stays as set until the GM changes it, through setup and every round. Reason: a +2 set for a mythic must not quietly carry into the next goblin fight, and a value on the fight is a value the GM sees on the fight's own screen.

**The data shapes.**
```ts
// fight-types.ts, on Shared (so in setup, running and ended)
export type Fudge = { readonly sides: Readonly<Record<Side, number>>; readonly rows: Readonly<Record<CombatantId, number>> };
export type FudgeScope = { readonly kind: 'side'; readonly side: Side } | { readonly kind: 'row'; readonly id: CombatantId };
// Command: | { readonly type: 'fudge'; readonly scope: FudgeScope; readonly n: number }
```
The fudge has no states, so it needs no machine. It has one writer: the fight's `fudge` command, a cell in each row of `TABLE` (setup and running take it, ended refuses it). It sets `n` rather than adding to it, so a replayed command changes nothing. A whole `n` outside `±fudgeMax` is refused as `fudgeRange`. The command writes no log line and raises no effect beyond the new fight. Removing a row drops its entry. `fudgeOf(f, b, R)` is the one reader that `keptFace`, `refundLands`, `openingOf` and the curse's resist call. `resolve`, `landUse` and `needs` take the `Fudge` as an argument. `needs` asks for the same dice either way, because a fudge moves faces but adds no die.

**The range is a rule:** `RULES.fight.fudgeMax: whole(5, 0, 10, 'faces a fudge moves a d20 either way: at 10 one face is half the die')`. Its reason: 5 faces is 25% on every threshold, more than an edge's average, and still within the die.

**Where the GM sets it.** In the Fight tools sheet, under See as, a Fudge block of two lines: "Hunters" and "Foes", each `− 0 +` with 44 px buttons. A line is about 300 px wide, so it fits on a 390 px phone. A row's own fudge is the same stepper on that row's GM card (`cardOf`, which only the GM's phone draws). The fewest taps for party +2: open Fight tools, then `+` twice, so 3 taps. Each tap is one `fudge` command at the new value.

**How the GM sees it is on.** While any fudge is not 0, the Fight tools button carries a small gold dot, and its label for a screen reader says "Fight tools, fudge on". A card whose row's `fudgeOf` is not 0 shows "Fudge +2" in its own line. A player who looks at the GM's phone could read the card. The dot alone says nothing to someone who does not know it.

## 3. The secrecy

This works like sight in the stealth design: the fudge is state on the GM's phone only, and it is applied only where the GM's phone turns faces into outcomes. Each path a player's phone could learn it from:

- **The roll.** The fudge applies in core, in the reducer, after the GM's phone has drawn every d20 a use asks for (`rollNeeds`, `rollOpenings`, `rollSettle`). A player's phone rolls none of those dice, so nothing has to move between phones for the fudge to work. A player's `cast` still carries its damage dice, which the fudge does not touch.
- **The roll's parts.** In "14 + 3 = 17" the 14 changes. But no phone shows a fight's d20 face, so on any screen only the outcome changes: caught or avoided, crit or not, resisted, who goes first.
- **The doc and its log.** `fightDoc` copies named fields of each row (`docRow`) and never copies the `Fudge`. A log line gives outcomes only. A weighted fight's doc is exactly the doc of the same fight played without a weight on the shifted faces. Section 5 names that test.
- **Setting the fudge.** The `fudge` command leaves the doc equal. `publishNow` in sync.ts already sends nothing for a doc equal to the last one put (`sameDoc` ignores `at`), so no put and no change of pace can betray the tap.
- **The rules doc.** `RoomRules` carries no `RULES.fight` number, and `fudgeMax` is a code rule like every other one. A GM's override of it stays on the GM's phone.
- **Room messages.** No `EventDef` carries a `Fight`. `onTurn` reads one but sends none. The write-back (`sendRemote`, `vitals`, `noted`) carries outcomes and counts.
- **Saves.** The `Fudge` lives in the GM's save, in the fight (`fight-parse.ts` reads a missing one as all 0). A player's save never holds the GM's fight. The GM's own export holds it, and that file is the GM's.
- **Odds.** Only the phone that runs the fight paints its odds (section 4). A solo run has no GM and no fudge.

**The honest limit.** Outcomes are visible, so a watchful player can count them. A hunter sheet shows Crit faces 2, which means 10% of hits are crits. Against a foe at −2, the party lands about 20% crits over the evening. Against a mythic at +2 it lands almost none. Reaction against Accuracy predicts a share of dodges, and a fudged party dodges more than that share. A fudged side also goes first more often. A shift of 1 or 2 is lost in the noise of statuses and edges over one fight. A shift of 5 shows over an evening. Two more limits: the source is public, so a player can know the feature exists, and a player who looks at the GM's card can read "Fudge +2".

## 4. The odds and the balance simulation

**The odds engine counts the fudge with no new code path.** `playBegin` and `playStep` (play.ts) play the GM's own `Fight` on the reducer, and the `Fudge` is part of that fight. `oddsKey` is the fight without its log, so a changed fudge makes a finished answer `stale` and the GM taps again. The line names the weight when any fudge is on: "The party wins about 30% (with your fudge). Mina is most likely to go down (60%). About 6 rounds." `oddsLine` gets that clause from the fight it was given (`fudgeOn(f)`), so the words cannot drift from the numbers. To compare, the GM reads the stale answer, sets +2 and asks again. The previous answer stays on screen, marked stale, until the new one is in.

**The balance simulation.** `Setup` in `tests/models/fight-sim.ts` gets `fudge?: Fudge`, which it puts on the fight it starts. Its own `resolve` call takes the same `Fudge`, so its counts match the reducer. A new case in `tests/fight-sim.test.ts` prints a party of 3 against a mythic at hunter fudges 0, +1, … +5. The mythic kind is proposed in `features/enemies/balance-plan.md` section 4, and until it lands the stand-in is an S boss. The case asserts two things: the win rate does not fall as the fudge rises, and at 0 it is the ruling's 5 to 10% once the mythic kind is balanced. Until then the stand-in's numbers are printed, not asserted (principle-explain-the-number). The GM's question "what does +2 do to a mythic" then has a row in a printed table and a number on the odds box.

## 5. Units, in order

Each unit ends with `bun run test` green and its named tests passing. Its guide rows (combat.md: the dice row, the odds row, the doc row) and `bun run deps -- --write` change in the same unit.

1. **The fudge's shape and command** (opus). Files: `fight-types.ts`, `fight.ts` (the `fudge` cell in `TABLE`), `fight-parse.ts`, `rules.ts` (`fudgeMax`), `refusal-words.ts`, `tests/fight.test.ts`, `tests/lint.test.ts`. Tests: "a fudge is set, not added: the same command twice leaves +2"; "a fudge past fudgeMax is refused"; "an ended fight refuses a fudge"; "a removed row's fudge goes with it"; "a fight read from a save without a fudge has all 0". Lint: "only the fight's fudge command writes a fight's fudge". What a table sees: nothing changes.
2. **The faces** (opus). Files: `resolve.ts` (`keptFace`, `refundLands`, `fudgeOf`), `fight.ts` (`openingOf`), `fight-turn.ts` (the curse's resist), `play.ts`, `tests/resolve.test.ts`, `tests/fight.test.ts`. Each expected value comes from the rule: "a hunter at +2 is not crit on the face that crits at 0" (face `critFaces`, kept `critFaces + 2`); "a hunter at +2 crits a foe on a face of critFaces + 2"; "a party and a foe both at +2 roll as at 0"; "a face of 19 at +5 is 20 and resists as a natural 20"; "a face of 1 at −5 stays 1"; "a refund at +3 lands on a face 3 higher"; "an opening at +2 comes 2 faces earlier"; "the edge keeps its die first, then the fudge moves it" (edge 7 and 15 kept high, +2: 17). The odds engine still plays every fight to its end (`tests/odds.test.ts`). What a table sees: under a fudge, the fight's outcomes change.
3. **The secrecy proofs** (opus). Files: `tests/fight-doc.test.ts`, `tests/lint.test.ts`. Test "a fudged roll reaches the table byte for byte as its shifted face would unfudged": fight A has the hunters at +2 and the foe's attack's reaction d20 at 10; fight B has no fudge and that d20 at 12. `JSON.stringify(fightWire(fightDoc(A, R, ctx)))` must equal the same for B with the same `ctx`. The `sendRemote` and `vitals` payloads of the two commands must be equal, and so must every effect but the GM's own. A second test, "setting a fudge leaves the players' doc equal", passes the doc before and after to `sameDoc` and expects true. Lint: "nothing a player's phone receives reads a fudge" (`fight-doc.ts`, `protocol.ts`, `sync.ts`, `table.js`, `uses.js` never name `fudge`). What a table sees: nothing; that is the test.
4. **The odds and the simulation** (sonnet). Files: `odds.ts` (`fudgeOn`, the line's clause), `tests/odds.test.ts`, `tests/models/fight-sim.ts`, `tests/fight-sim.test.ts`. Tests: "a changed fudge makes a finished answer stale"; "the line says with your fudge only while one is on"; the printed table of section 4. What the GM sees: "about 30% (with your fudge)".
5. **The GM's controls** (sonnet). Files: `combat.js` (the Fudge block in Fight tools, the dot), `fight-view.ts` (`Card.fudge`), `tests/map-view.test.ts` or `tests/fight-view.test.ts`, `tests/e2e/fudge.e2e.ts`. Browser test with a GM phone and a player phone: "the GM fudges the hunters +2 in three taps and the player's phone shows and hears nothing of it". The test taps Fight tools, `+`, `+` and expects the dot and "Fudge +2" on the hunter's card. On the player's phone it checks that `hunterApp.api.sync.doc('fight')` is equal before and after and that no request body names `fudge`. It is checked on a 390 px viewport. What a table sees: the GM's dot and card line.

## 6. Open questions for the owner, each with the default the build uses

1. Does the fudge move only d20s, or damage dice too? Default: d20s only (dodge, resist, crit, opening, refund).
2. Does it end when the fight ends? Default: yes. Each fight starts at 0.
3. Are the scopes the hunters, the foes and one row, adding up? Default: yes.
4. Should death saves count? Default: no, because the player sees their own face. Counting them would mean the GM's phone rolls death saves.
5. Should checks outside a fight count, or the GM's own tray rolls? Default: no. The face shows on the phone that rolls it, and the DC is already the GM's.
6. Is ±5 the right bound? Default: yes (`fudgeMax` 5, 25% at the most).
7. Should the GM's screen mark it with a gold dot on Fight tools, or show the number plainly? Default: the dot, with the number on each card.
8. Should the GM see each fudged roll ("10, fudged to 12")? Default: no. The GM sees the setting, not each roll.
9. Does a fudged face of 20 count as a natural 20? Default: yes, as held dice do today.

## The owner's rulings on the defaults (Nov 21, typed in the lead's session). These win over every section above

His words, in the order of the nine defaults: "It absolutely can touch damage dice.  It does reset to 0.  Sure that works.  Let's do away with death saves entirely.  I don't know what this means.  No bound -- Have an option to force either a 1 or a 20 just for the next roll. Fine.  Fine.  Yes."

1. The weight also touches damage dice. (The default said no: changed. The design must say how a weight reads on a damage roll: a shift on each die's face within the die, or on the total; and that a player's phone, which sees damage numbers, cannot tell.)
2. It goes back to 0 when the fight ends.
3. Three scopes: hunters, foes, one row.
4. Death saves are removed from the game, so the weight has none to touch. He ruled what replaces them: "Youre dead. You need to be ressed." (the unit `no-death-saves`, for-the-owner Answered); the fudge units build nothing about death saves.
5. "Just have my fudge factor affect how their dice rolls." The weight also applies to a player's rolls outside a fight (a stat check, the dice roller). A player's phone rolls those itself today and shows the face, so the builder must design this before it builds: the weight must not be on the player's phone in any form a player can read (his first words: "This should NOT be visible to the players"), so either the GM's phone makes the roll while a weight is on and sends the face, or the room does; a weight sent to the player's phone and applied there is not hidden and is not the design. The face a player sees is the weighted one, with nothing to mark it. Outside a fight the weight does not reset at a fight's end: say what its life is there (the lead's default: it stays until the GM sets it to 0, shown by the gold dot).
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

