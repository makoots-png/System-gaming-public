# V3 The fight's end and the Clear panel

Goal: what a fight drops is never lost to a reload, the Clear panel shows the split that pays, the panel opens without a timer, and a use's toast is the line the fight logged, not one found by its words.

## Inventory (code at e8779fd)

| Row | Verdict | Where now |
|---|---|---|
| 41 | still true | combat.js `endEncounter`: the Loot dropped window after the settle is the only offer; nothing in the save keeps the drop |
| 42 | still true | gates.js:319 `perHunter` works the split again (`Math.floor(dueXp / n)`) beside pay.ts `splitAward` |
| 84 | still true | gates.js:452 `setTimeout(() => openClear(g.id), 0)` after `app.go`, through `mounted.open` |
| N5 | still true | combat.js:306 finds the use's log line by `includes(\`${u.name} uses ${a.name}\`)` |

## Rows

### 41 (done)
Cause: what the defeated monsters dropped lived only in the window shown after the settle; a reload or a closed tab while it waited lost it, and nothing in the save remembered it. Change: a save field `dropped` (`Dropped`: gold and items, save.ts, default null, repaired through `parseItem`); `settleEncounter(..., drop)` keeps it in the same write as the settle; `dropDealt` (pay.ts) clears it. combat.js offers it after the settle and again when the app opens (`offerDrop`: Later keeps it, Set aside clears it, Award loot… opens the Award form with `drop`); gm.js's Send award clears it in the award's own write when the form holds it (lane B's file, its own commit). Tests: pay.test.ts "what the fight dropped stays on the save after the settle, read back after a reload" (nothing kept it before); combat-turns.e2e.ts "the loot of a fight the GM has not given yet is offered again after a reload, and Set aside ends the offer".

### 42 (done)
Cause: the Clear panel's "each selected hunter gets N XP" was worked out again in gates.js (`perHunter`), apart from the split that pays (pay.ts `splitAward`, read by `clearShares`); with no hunter picked it promised the whole XP while the Clear pays nobody. Change: `perHunter` is `splitAward(dueXp, n, xpSplit)`. Test: gates-quests-dailies.e2e.ts "clearing a gate that never had an encounter pays the gate XP the panel promises" now also unticks every hunter and reads 0 (it read the whole XP before).

### 84 (done)
Cause: the Clear panel opened from `setTimeout(() => openClear(g.id), 0)` after `app.go`, through `mounted.open`, a task's delay standing for "after the view drew" (kind 8). Change: the fight's end puts an open request on `mounted.asked`, and the Gates view's draw reads it and puts it down (the card drawn again with its panel), whether the view was mounted already or mounts now; `mounted.open`, `openClear` and the timer are gone, and the timer lint's permit for gates.js is deleted (the lint now fails on any timer there). Tests: the browser cases that mark a gate cleared at a fight's end (gates-quests-dailies.e2e.ts "a gate cleared after End encounter ...") drive it; tests/lint.test.ts holds the timer out.

### N5 (done)
Cause: after a use, combat.js found the use's log line by its words (`l.includes(\`${u.name} uses ${a.name}\`)`), so a reworded line, or a row and an ability whose names made another line match, toasted nothing or the wrong line. Change: the fight's `act` answers a `used` effect with the line it logged (fight-types.ts `Effect`, fight.ts); combat.js toasts that; `newLines` is deleted. Lint: the label rule also refuses finding a line by `.includes(` of a template. Tests: fight.test.ts "a use answers the line it logged"; lint.test.ts (its first case is the old toast line).

## Sweep and left

Sweep: the same classes in the unit's files. A drop kept only by a window: the fight's end's own windows (rewards, the gate's "Encounter over") are news of a write already made, so nothing is lost with them. A preview worked out apart from what pays: the fight's end window reads `planEncounter`, the payer's plan. A timer standing for "after a draw": none left in gates.js or combat.js but the lint's named ones. A line found by its words: none left (the lint holds it).
Left: nothing of the unit's rows.
