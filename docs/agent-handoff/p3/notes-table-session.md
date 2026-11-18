# Notes: tests/e2e/table-session.e2e.ts

## Bug (fixme test in the file)
- Status dialog (forge.js) on a phone: the "Apply existing" chip list (`.fg-chips[data-existing]`) renders with height 0 at 390x844, so no built-in status (Poisoned, Bleeding, ...) can be tapped. Measured: list rect height 0, `.fg-scroll` scrollHeight 784 > clientHeight 735.
  Likely cause: `.fg-scroll>*{flex-shrink:0}` no longer matches the list because `.fg-cols,.fg-col{display:contents}` puts it two DOM levels down; with `max-height:140px;overflow-y:auto` it is the only item allowed to shrink, so it takes all the overflow.
  The main scenario therefore applies statuses the other way a GM can on a phone: typing the name (Poisoned) and tapping an effect chip (1d4 dmg/turn) in the same dialog, "Save to library" off. The key becomes `poisoned`, so logs and chips read the same as the built-in.

## Sync stall seen (same shape as bug 2 in bugs-found.md)
- Run 2 of the draft: after the player's first sheet PUT at 5.1 s, neither phone made any /api request until 99.6 s (api-requests.txt), so the GM board never showed the remote hunter inside 15 s and step 1 failed. Not caused by the test; no retry added.

## Behaviour notes
- A status typed in the dialog with a built-in's name does not reuse the built-in key: `Poisoned` becomes key `poisoned-2`. So the test finds chips by their label, never by key, and the tick log line reads "Poisoned N damage" (the word "poison" is only added for the built-in key). The regex accepts both.

## What the player's phone shows about the room fight (asserted)
- Status tab: a one-line banner "In combat · Round N · Your turn / <name>'s turn".
- Combat tab: HUD with "ROUND N", one row per combatant, the current row marked, "YOU" on the own hunter, exact HP for hunters, condition labels per row (monsters too).
- A "YOUR TURN" System window when the own hunter's turn starts; a System window per status the GM applies.
- After End encounter: banner gone, Combat tab says "No active encounter from your GM." (An "Encounter cleared." toast also shows; not asserted, it is transient.)

## State when I stopped (time limit)
- Passing runs: 8 of 11 with the final file. NOT five in a row.
- All 3 failures have the same shape: every /api request from BOTH phones stops for 36 to 95 s, then all land at once (see api-requests.txt; e.g. nothing between 27.5 s and 63.7 s). The assertion waiting on the other phone then times out at 15 s, at whichever step was running (join, chip removal, end). Same shape as bug 2 in bugs-found.md. Since both phones stall together and the answers arrive together, the shared server on :3217 (or the box) pausing is the likelier cause than sync.js; not proven. No retry or longer timeout was added.
- Mutation check: expected 'ROUND 2' on the player HUD changed to 'ROUND 3', test failed at that line, restored.

## Helpers to hoist
- `tapCombat` (also in combat-turns.e2e.ts), `gmSelect`, `gmApplyStatus`, `nextTurn`/`gmTurnMarker`, `playerAcknowledges`.
- Row names in the GM turn order carry the emblem letter, so read whose turn it is from the round header ("Turn: X"), not from `.cmb-nm`.
