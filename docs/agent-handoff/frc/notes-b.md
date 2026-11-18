# Notes B

## Step 1
statBonus extracted in sheet.ts (typed with the CurveRules param of `above`). Check: 96 pass, 0 fail (sheet, derive).

## Step 2
LIFE_TAG now Down / Down, stable / Dead; FELL_WORDS beside it in vitals.ts; status key `down`.
- hunter.js death panel word now `LIFE_TAG[life.at]` (was a local ternary).
- tests/lint.test.ts: the chip regex matched 'down' as a bare string and hit combat code (bodies, pointers, a database state), so it now counts `down` only as a key or an argument of addC/chip; `exhausted` as before.
- `grep -rni unconscious src public tests scripts`: nothing. `grep -rn "Dying\|dying\." src/views`: nothing.
- src/edge/room-events.ts:167 comment still says "the Dying chip": src/edge is brief A's, left alone (comment only).
- Check: both tsc clean, 7 test files 666 pass 0 fail.

## Step 3
rules-text.ts, tests/rules-text.test.ts. Differences from the brief:
- `downLine()` takes no Rules: nothing in it reads a rule number (all from vitals.ts). Added to vitals.ts: `SAVE_FUMBLE`, `FUMBLE_FAILURES`, `SAVE_UP_HP` (a 20 gets up at 1 HP; separate from `REVIVE_HP`, same value today), exported `SAVE_SUCCESS`, `SAVE_UP`.
- coin claim checked: alone or the GM's own phone, a true flip picks the side (`decider`); a player in a room waits for the GM's phone. The sentence says "in a room the GM's phone picks the side".
- pointsLine: the GM's stat edit confirms at once (`setStat`), said so. No code confirms on leaving the Status view (grep in hunter.js: only `confirm-alloc`).
- checkExample.need is clamped to 1, as the page did.
- Check: 14 pass, 0 fail (rules-text).

## Step 4
rulesref.js reads rules-text.ts; GM quick card only when `app.isGM()` (the view's redraw signature includes the role). The line "Each shadow level adds +10% max HP" deleted: shadows have no level in shadows.ts, derive.ts or rows.ts. The "GM cheat-sheet" section further down is left for everyone (brief names only the quick card). Two browser tests added to character.e2e.ts; a toast assertion there moved to "You are down."
Check: character.e2e.ts 26 passed (3.5m).

## Step 5
AGENTS.md row for rules-text and the vitals row; copy-tasks.md already ruled "down", no change; deps map written. Check: bun run test: 3548 pass, 0 fail.

## Step 6
Browser files that match the grep plus look and phone: 253 passed (36.2m), 1 failed: save.e2e.ts:184 "a save whose running fight is damaged opens without the fight" (failed twice, same output): a console warning "[register:quests] app.api.sync is read before its module registered it" from isGM during quests register. Nothing in that path is touched by this change (quests.js, app.js unchanged); not investigated against the base tree. used.e2e.ts:220 is the known notifications failure; not hit here (used.e2e.ts did not match the grep).
