# A channel's release against a use through `act` (audit BUG-rules-3, AW-rules-2)

The audit (`docs/audit/2026-11-19-neon-audit.md`, rows 7 and 9) says a channel's `release` in `src/core/combat/fight.ts`
has its own pipeline beside `act` and skips what `act` applies. Its author did not check it. This file checks it, step
by step, against the rules of a use (`docs/agent-handoff/rw/design.md` 3.1 and 4.1, `docs/agent-handoff/kits/design.md`
1.4, 1.9, 8.1 to 8.7).

Line numbers are of `src/core/combat/fight.ts` at commit `77efa141`, before any change here.

## 1. What `act` runs after a channel's begin, and what `release` runs

A channel's begin is `act` up to line 209: rule 1 (`actor`), the zone price's check (202), `ready` (rules 2 to 5, 205),
the uses counted (207) and the channel's `begin`. It returns there. The table is every step `act` runs after that line
for a use that is not a channel.

| # | Step (rule) | `act` | `release` | Verdict |
|---|---|---|---|---|
| a | A hide is refused while a foe that is up sees the user (kits 8.7.2, table 8.9.4) | 211 | none | Fault of the begin. The begin returns at 208, before the check, so a channeled hide is never refused. The release cannot be refused (a broken channel must go off), so the check belongs to the begin, with rules 2 to 5 |
| b | The `before` reactions fire on the bodies they protect (rule 7c, kits 8.4.1) | 213 | none | Fault. The release is the moment the use lands; 7c has no exception for it |
| c | Rules 2 to 5 (`ready`: aim, taunt, extra action, cooldown, gate 3b, cost and kit prices 4, range 5) | 215 (`resolve`) | none | Right. A channel pays them at its begin, once (design 4.1, "The cost is paid once, at the start"; line 205). Held by "a channel pays its HP price at its begin, once" |
| d | Rules 5b to 19 (`landUse`) | 215 | 378 | Both |
| e | The `lethal` reaction before a killing hit (rule 13b, `answers.lethal`) | 215 | none (no `answers`) | Fault, as b |
| f | Acting on a foe or a place ends the user's untargetable and hidden statuses (kits 8.1, 8.7.3) | 219 to 220 | none | Fault. A hidden channeler stays hidden after its release lands on a foe |
| g | One more use spent of a limited ability (table 2.3, `counted`) | 223 | none | Right. Counted at the begin (207). Held by the same test as c |
| h | Rule 17's break fires at half charge (design 4.1, the channel's `interrupt`) | 224 to 226 | none | Fault. See below: the cause is not in `release` |
| i | One log line naming every target's outcome and number (rule 20), and the zones its field evicted | 227 to 237 | 386: "released at charge N", naming the user only | Fault of rule 20. The line's rows also decide what the party reads (`fightDoc` drops a line about a hidden row) |
| j | The zone price is taken, and the ends of the zones it took land when old enough (rule 4, kits 1.4.3, table 2.6) | 234, 238, 239 (`zoneEnds`) | none | Fault of the begin. The begin checks the price (202) and returns before it takes it; the release never takes it. Rule 4 is the begin's, so the zone goes at the begin |
| k | Its own field goes down, within the cap per owner (rule 18b) | 235 to 236 | 385 to 386 | Both. The release does not log the zones evicted (row i) |
| l | A summon (rule 18d, `summoned`) | 239 | none | Fault. A channeled summon calls nobody |
| m | A zone act, shift or grow (kits 8.5.4, `zoneActed`) | 241 to 242 | none | Fault |
| n | A body shoved, swapped or reached by a zone act pays no on-entry part (kits 8.3.4, 8.5.5): `pushedIn` to `after` | 243, 246 | not passed | Fault. A body a released push moves into spikes pays their entry |
| o | The rows' tally (`tallied`, `used`) | 244 | 387 | Both |
| p | The use's triggers (rule 19b, `eventsOf`) | 245 | 388 | Both |
| q | The `after` reactions (rule 19c) | 246 | none | Fault, as b |
| r | Effects: `used` (the GM's toast of the use's line), `crit`, `burst` | 246 | `crit`, `burst` | `used` is no rule, only the GM's news (`fight-types.ts`, combat.js `send`). The release had no toast. It comes with the shared tail. The audit's claim that a channeled item is never spent is wrong: `itemSpent` (`fight-save.ts`) reads the `act` command, not the `used` effect, and `itemAbility` (`registry/abilities.ts`) makes no channel |
| s | `after`: the turn's end trigger when it was the user's turn, `consequences`, the next turn | 246 | 388, with `''` as the actor off turn | Both. Off turn a broken channel costs no time and is no turn's action (design 4.1), so no `turnEnd`: right |

### Row h: where a break loses its halving

Design 4.1: a hit of the hold, or a hold, root or taunt that lands, breaks a holding channel, and it "resolves at once
at `floor(charge / 2)`". The channel's table has the event: `interrupt` with `share` (`fight-channel.ts`). But the one
function that breaks a channel, `broken` in `land.ts` line 53, sets `state: 'broken'` and leaves the charge. `act` then
patches the rows `resolve` answered (224 to 226), comparing each row's channel with the one before.

So the halving is lost wherever a break happens outside that patch, not only in `release`:

- a release whose hit or op breaks a channel (`resolve.ts` 584 through `landUse`);
- a trigger's, a threshold's, a delayed end's, a zone end's or a reaction's land op (`land.ts` 265 and 276), which
  `act` runs after its patch (245, 246), and `startTurn`, `settle` and the zones run with no patch at all;
- a shove or a swap (`resolve.ts` 625, 647, `moveBreaks`): inside `landUse`, so `act` halves it and `release` does not.

The fix is at the cause: `broken` runs the channel's machine (`channelStep(channel, { type: 'interrupt', share:
breakShare })`), and `act`'s patch goes. Every break is then halved by the one table, and no path can forget it.

## 2. The fix

Every fault of the table was reproduced first: ten tests in `tests/fight.test.ts`, "a channel's release lands as a use
does (design 4.1)", written from the rules, each failed on the code before the fix (10 fail, 0 pass), each for the
reason the table gives (a charge of 2 where the rule gives 1, two zones where the price took one, a hide begun in the
open, 36 HP where the negate left 45, a hide kept, no summon, the zone at (5, 4), 24 HP where the spikes' entry was
not to be paid, a line with no outcome).

The fix has two parts.

1. **A break is the channel's `interrupt`** (row h). `broken` in `land.ts` takes the rules and runs
   `channelStep(channel, { type: 'interrupt', share: breakShare })`. Its callers (`landUse`'s rule 17, `moveBreaks` of
   a shove or a swap, `landOne`'s status and `channel` op) pass the rules. `act`'s patch after `resolve` is deleted:
   nothing is left for it to do. A trigger that breaks a channel after a use is halved now too (the second test).
2. **One function for what follows a use that landed**, `landed` in `fight.ts` (rows f, i, k to s). `act` and `release`
   each do only what is theirs before it: `act` its refusals, rule 7c, `resolve` and the use counted; `release` its
   own checks, rule 7c and `landUse` with what the begin paid, the channel gone off and, off its user's turn, no time.
   `landed` takes the ability, the user, the rows as the use found them, the tile, the answer of `landUse`, the
   reactions fired, the zones a price takes now, the start of the log line and who acted. A rule added there holds
   for both.

The begin gains rows a and j: a channeled hide is refused while seen, and the zone price is taken at the begin, its
ends landing then when old enough (`landingOf`, shared with `landed`). A use through `act` still lands its price's
ends after its own hit, as before; moving that to rule 4's place would change every zone price's numbers and is not
this task.

`beforeReactions` never answered null; its `| null`, the sentence saying it could, and `act`'s branch for it are gone.

### What holds the steps a release rightly skips

- Rows c and g (paid and counted at the begin): "a channel pays its HP price at its begin, once, and a channel of once
  a fight still goes off" (already there), and the zone price test, whose release takes no second zone and lands no
  second end.
- Row s (no time and no turn's end off turn): "a broken channel fires out of turn at once at its charge and costs its
  user no time" (already there).

### Row r and the audit's item claim

A release now answers the `used` effect with its line, so the GM's phone toasts a release as it toasts a use
(`combat.js` `send`). No browser test checks that toast for a release; none was run.

### The model (step 3)

No invariant was added: random play could not have caught these faults. Counted over its 2,500 seeds, a channel broke
7 times, every time from charge 0 and through `act`; no release or trigger broke one, and no holding channel passed
charge 2. An invariant on the broken charge passed with the halving removed altogether (`share: 1` in `broken`).
Making play hold channels longer (a channeler passing on 60% of its turns) changed none of those counts. The faults
are held by the ten reducer tests instead.

### Principles

`principle-fix-root-causes` moved the halving from `release` (where the audit put it) to `broken`, the first place a
break went wrong, which also fixed the trigger, reaction and shove paths. `principle-subtract-before-you-add` removed
`act`'s patch and the never-null branch before adding `landed`.

### Checks

Each under `flock /tmp/box.lock`: `bun run typecheck`; `bun test tests/fight.test.ts tests/fight-model.test.ts
tests/resolve.test.ts tests/triggers.test.ts tests/fight-sim.test.ts tests/odds.test.ts` (381 pass, 0 fail);
`bun run charts` (the channel chart's "What changes it" and "Who calls it" rows); `bun run deps -- --write`
(land.ts imports fight-channel.ts); `bun run test` (4237 pass, 0 fail; "Ran 4240 tests across 110 files").
