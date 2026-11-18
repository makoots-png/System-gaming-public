# Notes: fields that move and spread, and the map's size (brief-auras.md)

## Log

- Step 1: design 4.8 (auras, growth, `spread`, `resize`, the open arena's size) and rule 18b's new cases; five numbers in
  `RULES.fight` (`auraRadius`, `fieldRadiusMax`, `fieldGrow`, `spreadRange`, `spreadRangeMax`), each with its reason.

- Step 2: `Zone.ground` (`tiles` or `around` an `Anchor`), `zoneTiles`, `areaTiles`, `anchorOf`; `zoneSync` keeps a
  status's auras (`withAuras`), drops an aura whose body is down or no longer bears its status (`stays`), and lays every
  zone before the holds. Rule 18b: an aura around the user (`ZoneSpec.around`), a blast's field `around` its centre, and a
  field of an ability on an ally or its user spares the other side. Op `aura { radius, on }`. The doc's zone carries
  `anchor` (DOC_MAX arithmetic: 256 more characters, 55,056 x 9 / 8 = 61,938, still under 62,000). A map's zone is
  `MapZone` (fixed tiles only). The GM's painted zone (`ZoneDraft`) keeps its `tiles`, so the Paint code in combat.js is
  unchanged. Random play: Mira has a Ward aura, the GM's Status window gives "Radiating sickness" (an aura of all);
  2,500 seeds held auras on bodies 2,181 times, a status's 2,829 times and a blast's field 1,256 times across 73,570
  commands. Three new invariants (an aura's body is up; a status's aura goes with the status; a bearer's aura is on the
  ground while there is room). `bun test`: 2379 pass, 0 fail.
- The shared files of step 2 are their own commit: `map-view.ts` (`MapZoneIn.anchor`, tiles from `zoneTiles`) and
  `map-maker.js` (a map's zone reads and writes `ground: { kind: 'tiles' }`, two lines).

- Step 3: growth is `Growth { step, cap, from }` on an `around` ground and `radiusAt`; `ZoneSpec.grow`; `zoneTiles`
  takes `now` and the round. The `spread { range }` op; `Fight.had` marked by `reduce` (`marked`, beside `explored`);
  a pass is a `Pending` of its own (`{ id, spread }`), asked for at the bearer's settle with one d20 a target and paid by
  `settle` (`spreadTo`); rule 8b's roll is now `resists` in resolve.ts, used by a curse and a spread alike. Random play:
  Wolf A comes in sick (plague, range 3), Wolf B has a plague curse, the GM's window can give Plague, the blast's Embers
  grow 1 a round to 4. Spread asked for its dice 29 times over the 2,500 seeds, a growing field was on the ground 1,247
  command-steps; the model test now fails if random play never reaches a spread. Invariants: a holder of a spreading
  status is on its list, a settle never gives it back to someone on the list, the list names only rows. A first count
  found 0 spreads: random fights are short and a GM's status lasts 0.5 to 2 rounds, so a bearer rarely held one for a
  whole round; the sick wolf fixed the model, not the rule.
- `tests/fight-sim.test.ts`: 64 pass, 0 fail, unchanged (nothing built in uses these yet).

- Step 4: the `resize { w, h }` command (setup and running; `cutOff`, `offGrid`, `noChange`), `GRID_SIDE` in space.ts
  (`MAP_BOUNDS.size` reads it), `openArena` keeps a GM's override of `fight.grid` to 4 to 40. The Fight tools sheet has
  Width and Height steppers (`sizeSteps` in combat.js, the maker's look: 44 px icon buttons). Random play resizes; it
  went through 1,116 times over the 2,500 seeds. The open arena's size has no new control: the Rules screen's JSON
  already takes `{"fight":{"grid":{"w":30,"h":20}}}`, and in a fight the Fight tools steppers are the plain control.
  Zone fixtures in feel.e2e.ts, ui-shots.ts and maps.e2e.ts now write `ground` (not run: feel is the lead's).
  `bun test`: 2391 pass, 0 fail. maps.e2e.ts: 7 passed (2.1m).

- Step 5: the ability form's "Leaves a field" group has "Where it lies" (Where it lands, Around the user, with "Out
  to"), "Grows each round" with "Grows by" and "Up to"; the status maker has rows for `aura` (Everyone, Allies, Foes and
  the tiles) and `spread` (the tiles), each bounded by its rule. Built-ins: the skill Mending Aura (a support on its
  user, an aura of 2 with Regenerating's heal a round for 3 rounds, gone when its user goes down) and the status Plague
  (Poisoned's damage a round and a spread of 1). The map: an anchored zone's outline goes along with its token
  (`motion.along`, the token's own way, no new keyframes), and a field that grew in place draws its new tiles as a dashed
  edge that fades in (`MapZone.grew`, worked out in `mapScene` from the zones the map drew before, `MapInput.before`, so
  map.js still imports only the scene). Browser cases (maps.e2e.ts, two phones): a GM makes "Healing Light" in the skill
  maker (around the user, heal 5 on entry), the player casts it on their hunter, walks two tiles, and the ally the light
  comes over is healed 5 on both phones; a rat given Plague passes it to the rat beside it after a round (every die the
  GM's phone rolls at its lowest), and when both are well the first never caught it again. The plague case taps Next
  inside an `expect.poll` until the state is reached: the number of turns depends on the rats' speeds, and each tap waits
  for nothing but the next poll. makers.e2e.ts: 30 passed (the op round trip covers `aura` and `spread`).

## Built otherwise than the brief says, and why

- The brief's union is `{ kind: 'tiles' } | { kind: 'around', anchor, radius }`; the anchor is itself a union, a place
  (a blast's field) or a body (an aura), so a growing blast field and an aura share one rule, and growth (`grow`) lives
  on `around` only. A blast's field is now `around` its centre even when it does not grow: one field, one form.
- "Whether the anchor itself is inside ... decided by `spares` and a flag": the flag is the anchor's `status` (null for
  an ability's aura, which holds its user; a key for a status's aura, which does not hold its bearer). A separate boolean
  would be a second field that must agree with the first.
- A status's aura holds the status's other ops, not a list of its own (see subtract-before-you-add below).
- A ally-aimed or self-aimed ability's field now spares the other side (rule 18b), else Mending Aura heals monsters.
- The ZoneDraft of the GM's Paint keeps `tiles` (a painted field is always fixed), so combat.js's Paint is unchanged;
  a saved map's zones are `MapZone` (fixed tiles only) and the map maker writes `ground: { kind: 'tiles' }`.
- The plague's dice are not new: a pass rolls one d20 a target through the same `rollSettle` and `settle` a per-round op
  uses, so the GM's phone needed no change to roll them.
- The aura browser case is in maps.e2e.ts, not makers.e2e.ts: it needs the two-phone room and fight helpers there. The
  player's hunter gets the made skill by a store write on the player's phone (setup), not through Give to…, which no
  browser test drives yet.
- The skill is "Mending Aura" (title case like the other built-in skills); its field is named "Mending aura".

## Checks at the end (after 42ad605)

- `bun run deps -- --write` and `bun run charts`: no change to the committed files. `bun run typecheck`: clean.
- `bun run test`: "Ran 2403 tests across 58 files", 2403 pass, 0 fail.
- Browser files, one at a time, `E2E_PORT=3251`: maps 9 passed (3.0m), battle-map 14 passed (4.4m), makers 30 passed
  (3.2m, run after the last maker change), combat-turns 14 passed (1.3m), table-turn 8 passed (2.8m). No pause of the
  box hit a run. feel.e2e.ts not run (the brief); its zone fixture now writes `ground`, and map.js's zone layer gained
  one path an aura moves and one edge path, so the lead's feel run is the check on the map's frames.

## Left for the lead

- copy-tasks.md: new TODO(copy) marks in combat.js (the Fight tools' map size, a map size refused) and the words of the
  maker's new rows and group (maker.js, under the existing TODO(copy) of the effects editor and the ability form).
- The scene's `MapInput.before` and `MapZone.grew` and the zone's `anchor` are the only scene changes; the look of the
  edge (`.mp-zone.mp-zedge`, dashed) is one CSS line in map.js for the helper who owns the map's look.
- A GM can paint more of an aura with the map's Paint: it adds a fixed zone like it (Paint copies a zone's ops), which
  stays where it was painted.

## Which principle changed a choice

- model-the-domain and type-system-discipline: a zone's ground is a union (`tiles` or `around` an anchor that is a place
  or a body), and the tiles of an `around` zone are never stored. A blast's field became `around` its centre, so the same
  field has one representation whether it grows or not.
- subtract-before-you-add: the status's aura op carries no ops of its own (the status's other ops are what it gives off),
  so the status maker needs one row with a radius and a side, not a nested effects editor.
