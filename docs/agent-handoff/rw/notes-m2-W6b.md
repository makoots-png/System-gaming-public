# W6b, finishing the players' table: notes

Main tree, branch `claude/zen-pasteur-ov4cgd`, from f3a51e8. Not pushed.

## Files outside W6's list (smallest change each, with the reason)

- `src/core/combat/effect-ops.ts`, `resolve.ts`, `fight-parse.ts`: `UseOp` gains `mana` and `fatigue`, landed at once on
  the target by `landOps` (their dice after the effect's, as a shield's). A Mana Potion or a Stamina Tonic drunk in a fight
  must change the row, the home of mana and fatigue in a fight; no use op could. `diceFor(a, tier)` takes the user's tier,
  since a tiered amount's dice depend on it.
- `src/core/registry/abilities.ts`: `itemAbility` makes an item for its user a support on itself (`aim: 'self'`).
- `src/core/combat/rows.ts`: `hunterAbilities` takes every consumable that does something in a fight, not only those for another.

## Step 1: a potion drunk in a fight

Root cause: `inventory.use` put an item for its user straight on the sheet (`effects.applyOps`), while in a fight the
row holds HP, mana and fatigue; the fight's next `vitals` wrote the row's numbers back over the sheet. Fix: in a fight
every consumable is the item's ability (`itemAbility`), and `inventory.use` sends it to the fight (`useInFight`): this
phone's fight through `combat.useItem` (an `act`), the GM's fight through `uses.cast`. An item the row does not hold
(bought after the join) is refused with a toast instead of written to the sheet.

Test: `table-turn.e2e.ts` "a potion a player drinks on their turn heals their row on both phones, and the healed HP
stays after the next doc arrives" (30 HP from the item's text). It failed with the fix taken out
(`> 111 | await expect.poll(async () => (await fightRow(gm, HUNTER)).hp ...).toBe(healed)`) and passes with it.
Unit tests: `abilities.test.ts` (a potion is a self support; the shop's potions drunk do what their text says; dice).

## Step 2: a refused tap tells the player why

Choice: **the fight doc carries the last refusal** (`refused: { id, at, reason, n } | null`, `DocRefusal` in
fight-doc.ts), no new message. Why: a refusal changes nothing in the fight, so it is news only while the fight's time is
still the time of the tap; the doc already carries that time, is polled fast in a fight, and is a state, so a lost or
repeated poll cannot show it twice or lose it (the phone keeps the last `fightId|at|n` it toasted). A message would
need its own applier, `once` ring and GM-only test for a toast. `fightDoc` drops it as soon as `now` moves on.
`TABLE_REFUSALS` is the closed list a player's tap can meet (the six of the brief plus `unknownAbility`, `down` and the
five a step can meet); the reader takes a bad one as null and keeps the doc. `combat.js` holds it (`tableRefusal`, one
writer: the `step`/`cast` handler) and counts them (`n`), so two refusals at one time are two toasts. A tap from a
stale view (onTurn null) is `notYourTurn`. As nothing in the save changes then, it calls an empty `store.update` so
sync.ts republishes. Words in `REFUSED` of table.js.

`DOC_MAX` 30,300 becomes 30,400: the worst-case refusal is 77 more characters (24,301 x 5 / 4 = 30,376), comment and
the protocol test's worst doc updated.

Tests: `fight-doc.test.ts` (shown at its time, gone after), `protocol.test.ts` (comes through; a bad reason, id or count
drops only it; the worst doc), `table-turn.e2e.ts` "a player's Strike at the wrong rat while taunted is turned down by
the GM's phone, and the player reads why".

## Step 3: cooldowns show

`readyIn(readyAt, id, now, R)` in fight-view.ts: the rounds until an ability is ready, rounded up to a tenth (never 0
while it waits). The doc carries `ready`, the current row's abilities whose `readyAt` is past `now` (at most
`DOC_READY` 12), so a player sees the wait on their own turn, which is when a Use is live; off their turn every Use is
already off. Choice: the current row only, not every hunter row, so the doc's worst case grows once (622 characters,
`DOC_MAX` now 31,200 with the arithmetic in its comment) and not 32 times. The HUD writes "Ready in N rounds" under the
ability and its Use is off; the HUD repaints when `ready` changes. The GM's card writes "· ready in N rounds" on a local
row's ability button and turns it off (a remote row's card has no ability buttons; the player acts on their own phone).

Tests: `fight-view.test.ts` (3, from `RULES.fight.round`), `fight-doc.test.ts` (1), `protocol.test.ts` (1 and the worst
doc), `table-turn.e2e.ts` "an ability on cooldown says on the player's phone when it is ready again, and cannot be
tapped until then". `table-turn.e2e.ts`: `5 passed (1.8m)`.

## Step 4: the nine browser tests

All nine kept and rewritten; none deleted.

- `table-session.e2e.ts` 71 (a fight with a status on a player's hunter): built-in statuses from the Status window's
  chips (the old quick effect chips are gone), the fight started with Start fight, and the hunter's HP after Poisoned
  settles at its round-2 turn read from the GM's row and checked equal on the card, the row, the player's sheet and HUD.
  Another round passes with Poisoned removed and the HP stays.
- 202 (an HP change through a stale pushed sheet): the last sub-step, "the GM's card follows the player's next sheet"
  (a +1 tapped on the player's own sheet), is gone: in the new fight the row is the home of HP and a pushed sheet does
  not change it (W5 choice 10). The test ends on both phones agreeing on the GM's 5 damage.
- 257 (scaled numbers): Burning put on at Strength B from the Status window; "4d10 magical damage a round" (statuses.ts
  at B) on the GM's card, in the player's toast and on the chip.
- 307: Poisoned at E reads "1d4 magical damage a round; Control −8" (statuses.ts). 318: reads `fight.rows`. 328 passed
  as it was once the dialog helper used the new quick line.
- `character.e2e.ts` 138 reads `fight.rows`. 566 is now "a dying hunter in a fight is asked for the death save first on
  the GM's card": a hunter at 0 HP has no turn in the new fight (`isUp`, fight-turn.ts), so "whose turn it is" cannot
  happen; the hunter falls through the card's Mark defeated. 590 adds the GM's own hunter and a rat (a fight needs
  someone up on each side) and starts with Start fight.

App changes these needed (each a regression of kept behaviour, fixed where it lives):
- `src/edge/room-events.ts` (W3's): the `vitals` applier toasts each status the hunter did not hold before, with its
  numbers, as the `status` applier did (ui-pass A4). The fight sends statuses only through `vitals` now, so a player was
  never told a status landed. Case in `applied.test.ts`.
- `src/views/combat.js` (W5's): a dying local hunter's card leads with Roll death save whatever the turn (A27 on the new
  turn rule); a hunter on another phone at 0 HP is tagged Down, not Defeated (a monster's word).

## Step 5: the two red tests that were not W6's

- `combat-turns.e2e.ts:173` (the Workshop's New status at its top): the test was wrong. It seeded a schema 2 GM save,
  which since W2 opens a new campaign at the first-run screen, so no Workshop was there to click. It now onboards as
  a GM with clicks (the device has a mouse, so `onboardGM`'s taps cannot be used). The `readFile` import went with it.
- `character.e2e.ts:249` (Reset rules keeps the Workshop's statuses): the test was wrong. It made Ember Mark with the old
  check-penalty chip `ck-`, which W7's maker replaced; it now uses the maker's "Discipline −8" chip. The rule the test
  checks (the fatigue rule's +2 on the Strength check after Reset) does not read Ember Mark's effect.

## Which principle changed a choice

- fix-root-causes: the potion is fixed where the HP lives (a use on the fight's row), not by a guard against the next
  `vitals`; the missing status toast and the remote "Defeated" tag were fixed in the applier and the card, not in tests.
- make-operations-idempotent: the refusal is a state in the doc (row, time, count), so a repeated or lost poll toasts
  it once, which is why it is not a message.
- test-behavior-not-implementation: 30 HP, 4 mana, 25 fatigue from the items' text; 4d10 at B and Control −8 at E from
  statuses.ts; the cooldown's rounds from `RULES.fight.round`.

## Checks (last lines)

- `bunx tsc -p tsconfig.views.json --noEmit --pretty false`: no error.
- `bunx tsc --noEmit --pretty false 2>&1 | cut -d'(' -f1 | sort | uniq -c`: `2 tests/encounter.test.ts`, `8 tests/status-sim.test.ts` (and their continuation lines), nothing in `src` (W8's).
- `bun test 2>&1 | grep -E '^\(fail\)' | wc -l`: 5, all `status.test.ts` (W8). `Ran 2253 tests across 59 files.`, 2246 pass, 7 fail (the 5 and the two files that do not load, `encounter.test.ts` and `status-sim.test.ts`, W8). `deps.test.ts` green.
- `bun run build`: `Built 12 files into dist/ (build 70da9600fa93)`. `bun run deps -- --write`: `wrote docs/dependency-map.md`, committed.
- Browser, port 3241, one file at a time: `table-session` `7 passed (1.5m)`, `table-turn` `5 passed (1.8m)`, `used` `6 passed (1.4m)`, `custom-skills` `7 passed (30.3s)`, `character` `20 passed (2.0m)`, `combat-turns` `10 passed (48.3s)`. No pause hit a run.

## Red after this unit

Only W8's: `encounter.test.ts`, `status-sim.test.ts` (tsc and load), `status.test.ts` (5). Browser files not run by me:
`room-*`, `layout`, `look`, `gates-quests-dailies`, `customization`, `rewards`, `save`, `pwa`, `upgrade`, `makers`, `sharing`.

## Left for the lead (not done, outside the brief)

- The HUD's own HP amount field and the sheet's HP buttons still write the sheet while the hunter is in a fight; the
  fight's next `vitals` writes the row's HP back over them (the same class as the potion). The fix is the same: in a
  fight they would go to the row (`adjust` on the GM's phone; a player has no command for it).
- W5's Burning-by-rank browser test is still not written (W5 notes).

Lines: `git diff f3a51e8 --shortstat -- src tests`: 23 files changed, 477 insertions, 171 deletions (tests are most of it).
