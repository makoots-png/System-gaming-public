# Screenshot comparison: did the architecture pass change how the app looks?

Result: no screen lost its style, moved or overflowed because of the architecture pass. 48 pairs compared (16 per size). 34 are pixel-identical or differ only in antialiasing. 14 differ, every one for a reason named below. Two are copy slips worth a look (list at the end). Nothing was fixed.

## What was compared

The baseline is `972081d` (the last commit before the app moved into `src/`: it already has the mobile pass, so it differs from this branch only by the architecture pass). It was served with `bun server.ts` from a worktree at `/tmp/shots-base`. The branch was served from its own worktree.

A first run against `origin/main` (`8b41075`) is not a fair baseline: it predates the mobile pass (one-row header, hidden wordmark, d20 button hidden, Device and Room views), so every pair differed (17% to 48%). It is not used below.

Same seeded save for both: a `hunter-system-v2` save from `tests/fixtures/saves/main-gm-starter.json` (Brakk Ironhide at 22 HP and Poisoned, a gate of two monsters, Goblin Den). The branch migrates it at load. Fixed clock 2026-11-10 12:30 UTC, seeded `Math.random`, animations and caret off. The fight, the Clear panel, the Status dialog and the System window are reached by the same taps on both. Sizes: 390x844 (`phone`), 360x780 (`small`), 844x390 (`landscape`), scale 2.

## Rerun

```
PORT=3401 bun server.ts                       # in the old worktree (git worktree add /tmp/shots-base 972081d)
PORT=3402 bun server.ts                       # in this branch
E2E_CHROMIUM=/opt/pw-browsers/chromium bun scripts/shots.ts --url http://localhost:3401 --out /tmp/shots/base
E2E_CHROMIUM=/opt/pw-browsers/chromium bun scripts/shots.ts --url http://localhost:3402 --out /tmp/shots/branch
E2E_CHROMIUM=/opt/pw-browsers/chromium bun scripts/shots.ts --compare /tmp/shots/base /tmp/shots/branch --report /tmp/shots/report.json
```

`--compare` prints, per pair, both sizes and the share of pixels that differ by more than 24 in any channel, and writes `<name>.diff.png` next to the second folder's image for pairs over `--threshold` (default 0.001 = 0.1%) or of unequal size. The views come from the nav on the page, so a new tab is picked up. `--mask` takes CSS selectors to paint over. Windows are shot at screen size, views full page.

## Pairs (phone / small / landscape; share of differing pixels)

Identical (0.000%), all three sizes: Gates, Gates with Clear panel open, Combat view, Quests, Dice, Shadows, Bestiary, Device, status sheet with Poisoned chip and 22 HP, System window (landscape included).

| Pair | Phone / small / landscape | Class |
|---|---|---|
| room-view | 0.10% / 0.000 / 0.074 | Antialiasing only: the grey "ABC234" placeholder in the Join field, glyph edges. Crops look identical |
| combat-running-one-down | 0.020 / 0.020 / 0.013 | Intended copy change: bottom Combat log line reads "Lizardman is defeated." before, "Lizardman is down." now (reducer logs `is down.` for the Defeat button, `encounter.ts:165`). Nothing else moved |
| combat-status-window-open | 32.7 / 31.7 / 10.8 | Intended fix: the "Apply existing" list was squeezed to zero height on a phone before (the heading sat over empty space), now the chips show (commit 84ca631). Side effect, see note 1 |
| data-view | 22.8 / 23.3 / 16.4 | Intended: Mode field removed from Settings (top of the Settings panel), and its help text now reads "The daily reset hour decides when a new day begins." The page is 134 px (phone) shorter. Backup row: the seeded v2 save is backed up at load, so the row says BEFORE THE UPDATE (was DAILY) and the date wraps with Restore below it; storage says 48 KB (was 33 KB). Content from the migration backup, not styling |
| rules-view | 14.8 / 14.2 / 10.3 | Intended copy: Conditions list in the rules text loses Exhausted, Unconscious, Penalized (chips, not statuses) at about y 1690 css; level rules gain "Losing a level takes its points back" and "Reaching a level for the first time fully restores HP and MP. Regaining a lost level does not."; the Long rest and 0 HP bullets are longer (only a long rest clears Exhausted; death saves, a 20 and a 1; only the GM's Revive raises the dead). Conditions table first column is narrower. Page is 32 px taller (phone) |
| gm-view | 0 / 0 / 8.9 | Intended: the same three conditions leave the Conditions reference at the top of the GM screen (landscape only; phone and small show it collapsed and are identical). Everything below shifts up 43 px |

The new tags Dying and Dead, the Penalized chip and the room pill words are not on screen in this seed (no downed hunter, no missed daily, no room), so they are not covered here.

## Notes and regressions to look at

1. Status dialog, landscape (`landscape-combat-status-window-open`): opening it now focuses the first existing-status chip, and the dialog opens scrolled down, so its title, the Rounds field and the first chips are above the visible area. Before, the list was empty so nothing scrolled. Consequence of the intended fix, but the opening view is worse than the phone one. Not fixed.
2. Stale copy (`phone/small/landscape-rules-view`): the last Rules bullet still says "Switch to GM mode (Data → Settings)". That Mode field is gone (`src/views/rulesref.js:181`).
3. `phone/small/landscape-combat-running-one-down`: log wording changed from "is defeated" to "is down" for the same tap, while the card still says DEFEATED. A wording inconsistency, not a layout change.

No layout regression (moved, vanished, overflowed, lost style) was found in any other pair.

## Could not capture

Not reached from the seed, so no shots: a downed (Dying or Dead) hunter, the Penalized chip, a live room pill. Add them by driving the UI after load if the owner wants them compared.
