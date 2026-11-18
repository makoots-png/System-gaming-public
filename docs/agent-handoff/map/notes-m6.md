# Notes, milestone 6: terrain, lasting fields, the party's view, saved maps

## Differences from the brief

- A zone an ability leaves is a field of the ability (`Ability.zone`, a `ZoneSpec`: name, duration, ops, ends with its
  owner), not a member of `Op`. Every `Op` is also something a status holds and the status maker offers (the op-kind
  loop); "a status that leaves a field" has no meaning, and the brief's own editor for it is a group of the ability
  form, not an effects row. Its rule is still one function in resolve.ts (rule 18b, `leftZone`).
- A zone's hold on a body is a status (`Status.zone`), so the settle is the statuses' own. Each entry is a new hold
  (key `zone-<id>@<tick>`), so time spent outside between two entries is never paid. A zone's on-entry part pays under
  the key `<hold>-in` (`entryKey`), apart from its per-round part.
- The fog's memory lives in the fight (`Fight.fog.seen`, one '0' or '1' a tile, marked after every command by
  `reduce`), not on each player's phone: the party shares one view, so a player who joins late or reloads must see the
  same remembered walls as the rest; the GM's save is the one writer and the doc carries it.
- A touch now needs a line to its target (`sees`): a curse does not reach through a wall either.
- The map editor is the map maker in the maker shell (`src/views/map-maker.js`, `app.api.maps`), its own grid of tiles,
  not a mode of the fight's map view (map.js): the fight's map pans, pinches and frames tokens, and a drag there is a pan
  or the GM's token drag; an editor's drag paints. Both draw terrain with the same rules (`.mp-t.<terrain>` and
  `.mpm-c.<terrain>`). The fight's map has a GM-only Paint mode for painting during a fight (terrains, and more of a zone
  already on the ground, as `paint` and `zoneAdd` commands).
- Save as: the maker has "Save as a new map" when it edits a map (and the Workshop's Duplicate); Rename is the Name
  field; the shell holds one action button (Save map).
- Painting a zone during a fight adds a new zone like the one picked (same name, ops, side and what is left of its time)
  on the painted tiles, rather than growing the old one: `zoneAdd` stays one command with one meaning.
- A fight's starts: the map's start tiles go in the `add` command (`starts`), and the fight places rows on them (a view
  may not set a place: lint). Rows that join later take the default lines.
- The doc's map is bounded at 1,600 tiles (40 by 40, the largest saved map); a larger open arena (only by a GM's rule
  override of the default grid) is sent as open floor. DOC_MAX went from 57,300 to 62,000 with an eighth to spare, not
  a fifth: a fifth no longer fits under the server's 64 KiB body.

## Log

- 04:58 started. Read the brief, the helper rules, notes-m5 and the parts of notes-m4 the lead's items name.
- Lead item 1 and 2 (one commit, ea01969): a `pass` room message (`ownSheet`, held by `onTurn`, applier null), sent by
  "End turn" on the map's hotbar (`MapSource.pass`, null on the GM's phone, which has Next) and in the list HUD's
  actions; the GM's phone sends it as `endTurn`. A double tap frames the map and puts back what its first tap chose
  (the second click of a double tap is no tap). Browser tests: battle-map "End turn" (and the replay changes nothing),
  "a double tap", table-turn "End turn in the list".

- Lead item 3 (eb85f82): a formula the GM typed is kept when the ability's kind changes (edited, Reset gives the new
  kind's recommendation; `typed` passed from the old form to the new). An `applyStatus` row has "Same at every rank" and
  "By rank" like the other tiered ops; the `keep` row is left only for an op kind the editor has no row for (none
  today). The op-kind loop in makers.e2e.ts saves each kind twice, flat and by rank where it has a mode.
- Lead item 4: `scripts/ui-shots.ts --serve 3241 --out /tmp/shots-m6` starts `bun server.ts` in its own process group,
  waits for `/api/health`, stops it at the end. Run once: "126 shots in /tmp/shots-m6", no step failed (the 390 pass
  skips its conditional `combat-map-aiming` shot, number 31, because the GM's map has no hotbar on a hunter's turn).

- Step 1 (0bb6ce6): `TERRAIN` rows floor, wall, cover (`o`), rough (`~`, enter 2), pit (`_`); `Zone`, `ZoneSpec`,
  `Fight.zones` and `Fight.fog`; commands `paint`, `zoneAdd`, `zoneRemove`; `BattleMap` and `parseBattleMap`
  (registry/maps.ts) in `library.maps`, the pack's `maps`, `GateFields.mapId`; `RULES.fight.coverShare` 0.25 and
  `sight` 25.
- Step 2 (d8c2561): walks, dashes and dodges pay `enter`; a blast takes the tiles its centre `sees`; `sees`, `seenBy`;
  rule 11b cover in resolve.ts. Tests on drawn grids.
- Step 3 (624dd9f): `zoneSync` (zones.ts), `grounded` in fight-turn.ts after every change and every advance of time;
  rule 18b `leftZone`; the GM's drag and a row joining go through the ground. Random play paints and makes zones; new
  invariants (expired zone gone, a body holds a zone exactly when it stands in it, present bodies on standable tiles).
  A monster at 0 may lie under a painted wall (the parser and the invariant allow it). fight-sim unchanged and green.
- Step 4 (b741e54): `explored` in `reduce` marks seen tiles; `fightDoc` builds from `partyView`; the doc's grid is
  `{ w, h, tiles, lit }`, zones as runs; DOC_MAX 62,000 (arithmetic in protocol.ts).

- Step 5 (321ad75): map-view's scene carries `zones` (outlines, tone, rounds left), `fog` (dim and dark outlines) and a
  token's `hidden`; `fightGround` (GM) and `docGround` (player) feed it; a tap on a zone alone names it. map.js draws
  walls with a soft top edge, cover hatched, rough ground dotted, a pit dark, zones as soft areas in their tone (the
  layer breathes as one through `motion.breathe`, a new move on `--t-breath` 3.2 s and `--ease-sway`), the fog as a
  blurred veil (lighter on the GM's map, where a foe out of sight is dimmed).
- Lag test, map case (`feel.e2e.ts -g "twenty tokens"`, 4x CPU, now with two runs of wall, cover, rough ground, a fire and
  a mud zone and the fog at sight 8): first with each zone path breathing on its own, 8 runs, a use's worst frame 50 to
  133 ms (two runs over the limit of 6 frames, each with two long tasks); an opacity animation on an SVG path is
  repainted, not composited. With the zone layer breathing as one composited layer (`will-change: opacity`), 6 runs: a
  pan and a pinch 16.7 to 16.8 ms, a pick 16.7 to 33.3 ms, a use 66.6 to 100 ms (median 66.7; long tasks 54 to 75 ms).
  The limits are unchanged.
- Step 6 (127aeac, 369cf4d): the map maker, the Workshop's Maps, the gate form's Battle map, a gate's fight on its map,
  the GM's Paint. maps.e2e.ts, 6 tests. A bug the browser tests found: the player's table redrew on a doc change only
  when rows or the time changed, so a wall the GM painted never reached the player's map; its signature now holds the
  grid and the zones.
- Step 7 (146292e): the ability form's "Leaves a field" group; `Ability.zone` kept by `abilityOf`; Vulcan's Inferno
  leaves Burning ground for 2 rounds (the built-in Burning's ops). Measured: its hit and one round of the ground on a B
  tank, 14 + 22 of 164 HP (22%), inside the single-use bound of 60% (tests/abilities.test.ts measures every built-in
  blast that leaves a field). makers.e2e.ts: a GM makes Fire Rain and the fight shows the ground and its burn.
- Step 8: design 3.1 (11b, 18b), 4.7, 5.3, 5.4; AGENTS.md; copy-tasks.md; for-the-owner.md "From the map"; ui-shots steps
  for the map maker and the ground (GM and player); a look test for the map maker at 390.

## What I looked at, and what I changed after looking

Throwaway screenshots from `scripts/ui-shots.ts --serve 3241` (not committed): the map maker at 390 and 1280, the GM's
fight map at 390 and 1280 with walls, cover, a burning zone and the fog at sight 8, and the player's map at 360.

- The maker at 390: with the zone brush picked, the zone's name and effects editor sat between the brushes and the map
  and pushed the map below the fold. The zone's form is now under the map.
- Cover's hatch read as a bright cyan band on both maps; it is now thinner and at 45%.
- The maker's brushes and size steppers were under 44 px; they are 44 px now (the look test checks every button).
- The player's map at 360 with the fog: the never-seen tiles are a dark stepped area with a soft edge where the floor's
  dots vanish; the foe the party cannot see is not drawn at all, while on the GM's 390 map the same rat (CB) is drawn at
  45% opacity. Seen and left: double tap frames the tokens, not the walls, so on a 360 phone a wall on the far side of
  the arena is off screen until the player pans.
- Seen and left: on the GM's map the dim veil over what the party cannot see is faint over the dark ground; the dimmed
  foe tokens (45%) carry the meaning. A stronger GM veil is a one-line change in map.js (`.mp-fog.gm .dim`).
- First ui-shots runs: my first map step shot the GM's List view (the step before had chosen List) and the player before
  the fogged doc arrived; the step now chooses Map and waits for the fog layer.

## Checks at the end (7fa239d and after)

- `bun run typecheck`: clean. `bun run test`: "Ran 2370 tests across 58 files", 0 fail. `bun run charts` and
  `bun run deps -- --write`: no change to the committed files. `tests/fight-sim.test.ts` (the balance rows, open arena):
  64 pass; the open arena takes none of the new paths (no wall to stop a line, no zone, no fog), so its fights are the
  same fights.
- Every browser file once, one at a time, `E2E_PORT=3241`: maps 6, battle-map 14, map-extras 6, makers 30, look 10,
  table-turn 8, combat-turns 14, gates-quests-dailies 21, sharing 6, save 7, table-session 7, fight-vitals 3, layout 5,
  character 20, custom-skills 7, customization 8, coin 7, pwa 3, reward-room 1, rewards 5, room-onboarding 6,
  room-sync-fixes 14, room-sync 1, room-view 9, upgrade 3, used 6 passed. feel: 4 passed, the map case failed once; the
  file rerun alone: 5 passed. The map case run 8 times after: 8 passed (a use 50 to 100 ms, a pick 16.8 to 50 ms, a pan
  16.7 to 16.8 ms). To see whether the ground moves the use, I ran the case 5 times with the ground taken out (open
  floor, no zones, no fog): it failed 1 of 5 too (a use at 116.6 ms), so the use's spread is the box's and the fight's
  redraw, as milestone 5 found; a pick without the ground was 16.8 to 33 ms, with it 16.8 to 50 (inside its 3 frames).
- `scripts/ui-shots.ts --serve 3241 --out /tmp/shots-m6d`: "131 shots", no step failed.

## Not done, and what the lead should know

- The GM's map editor is a maker of its own (above), not a mode of the fight's map view.
- Doors, light sources, elevation, background images and per-player sight are not built, and nothing is half-made for
  them.
- A zone a GM paints in a fight copies a zone on the ground; a brand-new zone mid-fight (one the map did not have) is
  made in the map maker and only reaches a fight through a map, or by an ability.
- The lag test's map case is near its use limit on this box with or without the ground (see the checks).

## Copy to list in copy-tasks.md

- map.js (TODO(copy): the hotbar's End turn): "End turn" over "Pass".
- table.js (TODO(copy): a pass that did not reach the room): the toast "Could not reach the room: your turn was not ended."; the list's "End turn".
