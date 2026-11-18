# Notes of unit P4, the room's fight doc

Worktree `/home/user/systemgaming/.claude/worktrees/agent-a9274bba688ceb048`, branch `worktree-agent-a9274bba688ceb048`, on 9ea4203. Commits 8b41861 (the module), 8694e06 (its tests), then this file.

No file outside the unit changed. `docs/dependency-map.md` is not committed (the lead regenerates it), so `tests/deps.test.ts` fails in this worktree for that reason alone: `bun run deps -- --write` adds only the entry of `fight-doc.ts` and the counts (checked, then the file was put back as it was).

## Choices where the plan was silent

- **`fightDoc(f: Fight | null, R, o)` answers `FightDoc | null`.** `o` is `{ by, at, was, keyOf }`: this phone, the time stamp, the doc the room holds now, and the sheet key of a hunter on this phone. With no fight it ends this phone's fight on the table and never another GM phone's, the rule `encDoc` in `combat.js:559-562` holds today. That rule now lives in core, so `combat.js` publishes `() => fightDoc(fight, R, { by, at: new Date().toISOString(), was: S.doc(...), keyOf: S.myKey })` and does nothing else. Null means "publish nothing", as `sync.publish` reads it.
- **An ended fight (phase `ended`) is the ended doc**, `{ ended: true, active: false, id, at }`. The table shows "combat ended" on it, as today when the GM's End removed the encounter. The summary stays on the GM's phone.
- **In setup** `active` is false, `now` 0, `currentId` null and `ahead` empty: nobody has a turn yet.
- **`ahead`** is `ahead(rows that are up, 8, RULES.fight)` from `timeline.ts`, so the current row is first. P3's `order(f, n)` was not there to call. If it answers something else, W3 or W5 should make `fightDoc` call it so the two phones draw one order.
- **Field names follow the plan**: `rows` (was `list`), `statuses` (was `conds`), `down` (was `defeated`), and each status's rounds left is `left`, worked out by `sheetStatuses` so the one-decimal rule has one home. `round` is gone; `now` replaces it.
- **No `color` on a status.** The new `StatusDef` (`effect-ops.ts`) has no color, so there is nothing to carry. If W1a gives the def a color, it is one line in `docRow` and one field in `DocStatus`.
- **Only live statuses show**: a status whose end is at or before `now` but still owes its bearer a per-round op stays on the row until its turn settles it (`advance` in `fight-turn.ts`), and the table would show it at 0 rounds. The doc leaves it out, the same rule `held` uses.
- **A shield past its end shows null**, the rule of `shielded`.
- **A monster's intent** is `{ name, target }`: the ability's name and the aim as the fight holds it, a row id or a tile `{ x, y }`. The table names a row from the doc's own rows. The design's `reveal` and "a channeling monster shows its channel as its intent" are not in the plan's field list, so they are left out.
- **Stagger `fill` and `max` are whole numbers** (rounded). The fight keeps fractions (a weak hit fills 1.5 times), which would add up to 15 digits each to the doc.
- **Past 32 rows** the doc keeps the current row, then the rows on the map, then those gone from it (a monster or shadow down), and keeps the fight's order. Today's doc cut the first 30 in join order, which could drop the current row.
- **Names, labels, status keys and log lines keep the fight's own bounds** (`NAME_MAX` 60, an id 80, `LOG_LINE_MAX` 300), so the doc never cuts a text the GM sees whole. Today's doc cut labels and keys to 40 and log lines to 200. W3's reader takes the doc's counts from the exported `DOC_ROWS`, `DOC_STATUSES`, `DOC_AHEAD` and `DOC_LOG`.
- **`BANDS` and `Band` are defined here.** `protocol.ts` still has its own until W3 imports these and deletes its copy; that is two homes for the length of the wave. Importing protocol's would make a value cycle once W3's `DOCS` imports this file.
- `isUp` and `present` come from `fight-turn.ts`, whose header says only the reducer calls it. They are read-only predicates; a second copy would be a second rule for "down".

## For W3 (the reader) and the lead: the size

Measured with this format, a row with a 60-character name, six built-in statuses (the six longest labels), a shield, an intent and stagger is about 627 characters, not design 5.4's 492 (the row now has `side`, `place`, `at`, `speed`, `shield`, `stagger` and `key`). The test's 20 rows (4 hunters, 4 shadows, 12 monsters) with 5 log lines of 300 characters measure 14,076 of 16,384, so design table 5.3's case fits. Two cases do not:

- 32 such rows are about 20,000 characters, so design 5.4's "33 rows always fit" does not hold. About 23 such rows fit with a full log, about 26 without.
- GM statuses with 60-character labels and 40-character keys, six on each of 20 rows, measured 23,876.

So W3's retry without the log and the "too big to share" pill are a path a big fight with GM statuses will reach. I left the 32 cap as the plan says. Cutting labels again, or showing fewer statuses per row, are the levers if the owner wants a big fight always shared.

## What I made

`src/core/combat/fight-doc.ts` (144 lines added, 0 removed):

- `fightDoc(f, R, o)`: the doc for a fight, the ended doc, or null.
- `FightDoc`, `FightDocRow`, `DocStatus`, `DocIntent`, `DocPlace`, `DocContext`: the doc's types.
- `band(hp, hpMax)`, `BANDS`, `Band`: the HP band, moved from `combat.js:557` with its thresholds (above 75, 50, 25 and 0 percent; 0 HP is down).
- `DOC_ROWS` 32, `DOC_STATUSES` 12, `DOC_AHEAD` 8, `DOC_LOG` 5.

`tests/fight-doc.test.ts` (179 lines, 12 tests): the band at each threshold; exact HP for a hunter and a shadow and only a band for a monster; setup; whose turn and the 8 turns ahead without a downed body; statuses with rounds left, the 12 cap and a shield; a monster's intent and stagger; the sheet keys; the 5 newest log lines; an ended fight; no fight on this phone and on another GM's phone; the 32-row cap; 20 rows under 16,384 characters. Expected values come from the plan's fields, the old thresholds and the timeline rule (a d20 of 10 opens at 500 ticks).

Nothing in my files became dead, so nothing was deleted. `combat.js:557-570` (the old band and `encDoc`) is W5's to delete when it calls `fightDoc`.

## Which principle changed a choice

- minimize-reader-load: the "end it on the table only if this phone published it" rule moved into `fightDoc` with the rest, so `combat.js` holds no doc logic at all.
- type-system-discipline: ids stay branded in the doc type (`CombatantId`, `SheetKey`, `StatusKey`, `FightId`, `Tick`); a remote's key goes through `parseSheetKey`, not a cast.
- test-behavior-not-implementation: the band test uses the thresholds at their edges (75 is wounded, 76 healthy), so a `>=` for `>` fails it; the order ahead comes from the interval rule, not from a run.

## The checks

- `bun test tests/fight-doc.test.ts`: `Ran 12 tests across 1 file. [69.00ms]`, 12 pass.
- `bun run test`: `Ran 2094 tests across 57 files. [96.05s]`, 2089 pass, 4 todo, 1 fail: `tests/deps.test.ts` ("the committed dependency map is what bun run deps -- --write writes"), the uncommitted map only.

Red after this unit: `tests/deps.test.ts` until the lead regenerates `docs/dependency-map.md`.
