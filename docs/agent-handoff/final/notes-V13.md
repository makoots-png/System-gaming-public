# V13 The fight's rules written once

Goal: one home for each fight rule, so a GM's status, a trigger and a use do the same thing, and the GM and a player read the same numbers. Smallest change: each row's remedy in the core file that owns the rule; views read it.

## Inventory (code at 5b162ed)

| Row | Verdict | Where now |
|---|---|---|
| LD1 | still true | land.ts:229 lands `shove`, `move`... no: `shove`, `hasten`, `extra`, `guard`, `negate` as no change; fight-parse.ts:316 keeps them (`USE_OPS`); maker.js:95 offers `shove`, `hasten`, `extra` in land rows |
| RS1 | still true | land.ts `landOne` case `applyStatus` (about line 207) runs `admitted` and `applyStatus` only; resolve.ts:293-318 runs `lasting` with `controlFactor`, `statusShield`, the hold's stun, the taunt's threat and the channel break |
| CR1 | still true | fight-react.ts:69-75 (`mayFire`: hold, cooldown, uses, `Math.ceil(a.cost.mana * (1 - costCut))`), 94-96 (`fireReaction` charges mana and fatigue by hand); no gate or kit price checked |
| RS2 | to check | fight.ts channel begin and release |
| C6 | still true | combat.js:365 gives `p.dice` to every key of `n.dice` |
| FP1 | still true | fight-parse.ts:611 `num(v.hp, 0, sheet.hpMax)` and the same for mana and fatigue: one past the max makes `rowOf` null and the fight unreadable |
| FD1 | still true | fight-doc.ts:230, 237: `hidden` names, `log.filter(l => !hidden.some(n => l.includes(n)))` |
| RD1 | still true | effect-ops.ts:473, 662, 669; fight-doc.ts:278, 344, 351; fight-turn.ts:134; fight-view.ts:99, 192 (`Math.ceil`); map-view.ts:301; ability-kinds.ts:209; effects.js:13; maker.js:178, 199, 722; skills.js:76 |
| Z1 | still true | zones.ts:250-257 `zoneTone` rewrites `harmful` (standing.ts:201) without the taunt |
| FT1 | still true | fight-turn.ts:58-75 `payDue` takes the shield inline beside land.ts `throughShield` |
| EO1 | to check | effect-ops.ts:451 `addSheetStatus` |
| EO2 | still true | effect-ops.ts:635 `FULL = 99999`, 650 |
| MV1 | still true | map-view.ts:520 `hittable` beside fight-view.ts:240 `aims`; fight-turn.ts:37 `present`, land.ts:22 `alive` (the same rule twice) |
| B3 | still true | bestiary.js:45 and combat.js:72 `nowOf` |
| K2 | left by the audit | a zone named by its words; abilities and zones are made apart |

## Rows

### Z1 (done)
Cause: `zoneTone` wrote its own list of what holds a body back, apart from `harmful`, and left out the taunt. Change: `zoneTone` answers `hinder` by `harmful({ ops })`. Test: effect-ops.test.ts "a zone holds back exactly when a safeguard would refuse its status as harmful" (failed before: a taunting field was `plain`). A GM saw a taunting field drawn neutral.

### FT1 (done)
Cause: `payDue` took the shield inline, apart from rule 13's `throughShield`, and without the shield's end (a shield past its end, not yet cleared by a settle, still took a burn paid by the `settle` command). Change: `payDue(b, due, dice, now, R)` calls `throughShield`; both callers pass the fight's now. Test: effect-ops.test.ts "a burn meets a shield as a hit does": a live shield takes 4 of 10, one past its end takes nothing (the inline copy took 4).

### EO1 (done)
Cause: the sheet's one-instance rule (`addSheetStatus`) was a second copy of `applyStatus`'s, adding counts by `Math.min` beside the stack machine. Change: one `oneInstance(old, before, incoming, k)` in effect-ops.ts (the winner by tier, the count through `stackStep`) read by both; `later` is one rule over a tick and a sheet's rounds. Test: effect-ops.test.ts "a sheet keeps one instance per key by the body's rule" over five puts (plain and stacking, both tier orders). It passed before too: the copies agreed today, and the audit's risk was a later change to one; the test now holds them to one answer.

### EO2 (done)
Cause: "heals fully" was a heal of at least 99999 (`FULL`), a magic number read back by `>=`. Change: `FULL_HEAL` is the formula `target.hpMax` (the target's own max HP), and `healsFully(amount, tier)` asks for that formula; `FULL` is deleted. Test: effect-ops.test.ts "a heal of the target's max HP reads Heals fully and fills any body; a heal that only reaches a big number is that number" (failed before: 99999 read "Heals fully"). Files of lane B, in their own commit: registry/items.ts (the Elixir's op) and views/effects.js (the line's `full`), tests/items.test.ts.

### RS1 and LD1 (done, one change)
RS1 cause: a status put on by a trigger, a threshold, a delayed end or a reaction ran `landOne`'s own copy (`admitted`, `applyStatus`), while a use's op ran rule 18 whole (`lasting` with `controlFactor`, `statusShield`, a hold's stun, a taunt's threat, a channel's break). LD1 cause: `LandOp` was `UseOp` and more, so the parser kept, the maker offered and `landOne` silently did nothing for `shove`, `hasten`, `extra`, `guard` and `negate`.
Change: `putStatus(t, op, by, source, side, cross, now, R)` in land.ts is rule 18's status for both; resolve.ts calls it, and `landOne` too (with the channel break through `channelBreaks`, which moved to land.ts with `live` and `opsOf`). A hasten lands through one `hasteOn` (land.ts), which resolve.ts calls too. `LandOp` holds only `LAND_USE_OPS` (effect-ops.ts): a push or pull needs the map and an anchor, an extra action is the user's own turn, and a guard or negate answers a use, so none lands outside a use; the parser refuses them (`landOpOf` reads `LAND_USE_OPS`), the maker's land rows stop offering push and extra (maker.js, lane B's file, its own commit), and a reaction's ops are filtered by `landsAlone`.
Tests: triggers.test.ts "a land op puts a status and hastens by a use's rules": a trigger's root on a boss lasts as a use's (3 rounds of 6, the boss's 0.5; it lasted 6 before), a trigger's stun holds the turn, a trigger's hasten moves the turn as a use's (it moved nothing before), the parser refuses a land push, extra, guard and negate (it kept them before).
What a GM saw: a status "when struck: root the striker" lasted its full time on a boss that shrugs the same root off a use; a status "when struck: hasten" or "push" read right and did nothing.
Sweep: a reaction ability with a push or an extra action still does nothing for those ops (fireReaction lands like a trigger). Left: the maker offers push and extra on any skill, a reaction included; refusing them on a reaction is a maker change (lane B's file) and a parser rule, named for the lead.

### CR1 (done)
Cause: fight-react.ts wrote rules 3 and 4 again for a reaction (`Math.ceil(a.cost.mana * (1 - costCut))`, the cooldown, the uses, a hold check of its own) and left out the gates and the kit prices, so a reaction fired where a use would be refused and was charged differently.
Change: `charged(a, user, bodies, at, now, R)` in resolve.ts is rules 3, 3b and 4 (cooldown, gates at the aim, uses, cost, kit prices) for a use and a reaction; `resolve` calls it. A reaction may fire (`mayFire`) when it is armed, up, not `held` (land.ts, now the one hold check; fight-turn re-exports it) and `charged` answers; `fireReaction` charges by `charged`'s body and answers null when an earlier reaction of the same use changed what it asks. `reactorsFor` takes the reaction's aim (the protected body, or the attacker for an `after` reaction), so a gate is judged where the reaction lands. One order change: a use with both an extra action taken and a cooldown now reads `extra` first.
Test: fight.test.ts "a reaction is refused and charged as a use is" (a gated Parry fired before; an HP-priced Parry paid nothing before).

### RS2 (done)
Cause: a channel's begin wrote rules 2 to 5 again by hand (taunt, cooldown, gates, cost, range) and skipped the concealed aim, the extra action and the kit prices; its release ran the whole use again through `resolve` with the cost zeroed and the range widened, so the prices were paid late, and every check could refuse it then (a channel of "once a fight" was refused `noUses` at its release, since its begin counted the use). A refused release of a broken channel stayed in `owed`, so `payOwed` sent it again after every command.
Change: resolve.ts splits into `ready` (rules 2 to 5: the aim, concealed, taunt, extra, `charged`, range) and `landUse` (5b to 19); `resolve` is the two. A channel's begin is `ready` (with the zone price, now checked before the channel branch), so it pays the cost and kit prices once; the channel keeps `spent` (the stacks a price took, its formula's `spent`; a field of `Channel`, read by the parser). Its release is `landUse` with what the begin paid: only a missing roll refuses it; one that can land nothing goes off at nothing (`channelStep` release, a log line marked TODO(copy)) and is owed no more.
Tests: fight.test.ts "a channel pays its HP price at its begin, once, and a channel of once a fight still goes off" (the begin paid nothing and the release was refused `noUses` before), "a broken channel whose aim is gone goes off at nothing and is owed no more" (refused `noTarget` and owed for good before). The chart's begin event carries `spent: 0` (scripts/charts/channel.ts); `bun run charts` moved one state count.
What a GM saw: a once-a-fight channel that could never go off; a broken channel toasting "refused" after every command.

### RD1 (done)
Cause: ticks to rounds with one decimal was written in about sixteen places with two roundings: fight-view.ts rounded up (shield, summon, taunt, ready in), the doc, the map, the sheet and the descriptions to nearest, so the GM's card and a player's table read one summon or status differently (0.94: 1 and 0.9).
Change: `roundsOf(ticks, R, 'up' | 'near')` in timeline.ts, the one place: `up` for time left on something running (it never reads 0 while it runs, the reason `readyIn` gave), `near` for a length (a duration, a delay, a cooldown, a fight's rounds). Every copy reads it: effect-ops.ts (the sheet's rounds left, the op lines), fight-doc.ts (three), fight-view.ts (two), map-view.ts, fight-turn.ts (the summary), ability-kinds.ts; the views effects.js and maker.js (lane B's files, their own commit) and skills.js. Lint: "a time is shown in rounds only through roundsOf". The view lint lets views import `roundsOf`.
Tests: fight-doc.test.ts "a status 0.94 rounds from its end reads 1 round left on a player's table" (0.9 before). Two tests encoded the nearest copy for statuses left (fight-view.test.ts "statuses show the rounds left in tenths", fight.test.ts "a hunter on another phone hears of a status ... in tenths"): 1340 ticks now reads 1.4, not 1.3, by the one rule; their titles say so. for-the-owner.md has the line.

### MV1 (done)
Cause: "who may be aimed at" was written twice (map-view's `hittable` rewrote fight-view's `aims`, its comment said so), and "on the map" three times (fight-turn `present` and land `alive` over a body, `onMap` twice over a spot).
Change: `hittable` is `aims` in range and in shape, in the order shown; `onMap` is one export of fight-view.ts read by map-view.ts; `present` is deleted and its callers (fight.ts, fight-turn.ts, fight-doc.ts, the fight model test) read land.ts `alive`. Test: map-view.test.ts "the map offers the targets the card offers ... for a foe, an ally and a self ability" (the map offered no target for a self ability before; the card offered the user). A tile-aimed ability offers tiles, not bodies, on the map by design; the test says so.

### FD1 (done)
Cause: what the party may read of the fight's log was decided by text: a line was left out when any hidden row's or zone's name was a substring of it, so a hidden "Rat" hid every line of "Ratatoskr", and a line about a hidden foe that did not use its name ("the blast hits 2") was shown.
Change: a log line is a `LogLine` (`{ text, rows, zones }`, fight-types.ts, made by `line(text, rows, zones)`), written by the step that logs it with the rows and zones it is about: the use line names its user, the reactors, every outcome's target, every burst's bearer and targets, the zone it leaves and the ones it evicts; a trigger's and a reaction's lines name their bearers and whom they dealt to; a zone's lines name the zone (and its anchor, its keeper). `fightDoc` keeps a line when none of its rows or zones is hidden, by id. The doc's log on the wire stays words, so the room format does not change. The parser reads each line's ids (`logLineOf`); combat.js reads `.text`; tests read `.text`.
Test: fight-doc.test.ts "a log line is left out by the rows it is about, not by its words: a hidden Rat hides its own lines, not Ratatoskr's" (both wrong before).

### FP1 (done in part)
Cause: a row's HP, mana and fatigue had to lie within the maxima worked out from today's rules at every read of the fight; a GM who lowered a rule a maximum reads (HP base, an HP override) while a fight ran made every row above the new maximum unreadable, and the save dropped the whole fight at the next load or the next write of another tab. Stacks and uses past a lowered rule were already clamped.
Change: the parser keeps at most the new maximum for HP, mana and fatigue (`upTo` in fight-parse.ts `rowOf`), as it keeps stacks at most their cap; the state is a legitimate one (a rule changed), so the reader handles it. Test: fight.test.ts "a running fight still reads after the GM lowers a rule a maximum reads" (parseFight answered null before).
Left: telling the GM when the save drops a fight that is not one at all (a damaged fight) needs a load notice in save.ts `Loaded` and store.ts's words, files of lane B's V12; with the clamp a rule change no longer drops a fight, so what is left is a damaged save, which the backups already keep. Named for the lead.

### C6 (done)
Cause: a player's `cast` carries one roll of the use's dice, and combat.js gave that one list to every target `needs` named, while the GM's own use rolls each target apart (`rollNeeds`): a player's blast dealt one damage roll to every foe it caught.
Change: `castDice(needs, aim, own, rolled)` in resolve.ts, the rule: the player's dice land on the body the cast aimed at (or the first the use takes when aimed at a tile), every other target rolls its own on the GM's phone. combat.js's cast handler calls it; the view lint lets combat.js import it. The room's `cast` payload is unchanged.
Test: resolve.test.ts "a player's blast rolls each foe apart, as the GM's does". It tests the rule in core; the old copy was the view's one line, which no bun test reaches, and the browser test of a player's blast is not written (named in Left).

### B3 (done)
Cause: when a joining row's statuses start (the fight's now, or 0 in setup) was decided by the views before `combat.add` (bestiary.js `toCombatant`, combat.js `nowOf` for a hunter, a remote hunter and the quick line), apart from the fight; combat.js's `nowOf` also restated fight-view's `timeOf`.
Change: rows.ts builds a new row's statuses from its joining (tick 0; `hunterRow`, `remoteRow`, `monsterRows` take no time); the fight's `add` moves them to the fight's now (`joined` in fight.ts), the one place a joining row's clock starts. combat.js reads fight-view's `timeOf` (now exported) for the zone brush and keeps no `nowOf`; bestiary.js passes no time (lane B's file, its own commit).
Tests: fight.test.ts "a row that joins a running fight has its statuses from the fight's now" (the statuses stayed at 0 before). Three rows tests said a row's statuses start "at the fight's now" with a time passed in; they now say "at its joining" (tick 0), the builders' rule.

### After the unit: a reaction's push or extra action (the sweep's finding, done)
Cause: a reaction lands its ops as a trigger does (`fireReaction` keeps those `landsAlone`), so a reaction ability holding a push or pull or an extra action read right in the maker and did nothing in the fight. Change: `reactionMayHold(op)` in effect-ops.ts (a land op, a guard or a negate); the parser refuses a reaction ability holding anything else (`abilityOf`), and the skill maker says so on Save and saves nothing (skills.js, TODO(copy)). A push from a reaction would need the use's outcomes and the map; refusing it is the explicit rule. Tests: fight.test.ts "a reaction holds only what lands from it" (the parser kept such a reaction before), makers.e2e.ts "the skill maker refuses a reaction that would push".

### After the unit: the browser test of a player's blast (C6, done)
table-turn.e2e.ts "a player's blast at two rats rolls each apart": the player's phone rolls at its highest faces and the GM's at its lowest; the rat the player aimed at loses more than the other (they lost the same before, the player's one roll given to both).
