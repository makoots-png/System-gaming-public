UNIT V6 DONE at a52df49
UNIT V3 DONE at a52df49
UNIT V10 DONE at a52df49
UNIT V13 DONE at 013d1d2

# Lane A (the fight): V13, V10, V3, V6

Started 2026-11-15 16:56 UTC at 5b162ed on branch lane-a. No browser and no whole `bun run test` before 17:31 (the lead's CI times frames).

Goal (the owner): "Everything must be explicit. Everything." and "fix the problem and not the symptoms". The problem: each audit row is a fight rule written twice, a fact kept twice or a loosely typed thing, and several are bugs a player or GM meets. The smallest change: each row's remedy done where AGENTS.md says that kind of thing lives, a test that fails without it.

Per-unit notes: notes-V13.md, notes-V10.md, notes-V3.md, notes-V6.md.

## V13 checks (at 013d1d2)

- `bun run deps -- --write`, `bun run charts`: committed.
- `bun run typecheck`: `tsc --noEmit && tsc -p tsconfig.views.json --noEmit`, no error.
- `bun run test`: `Ran 3376 tests across 89 files.` 3373 pass, 0 fail (3 skipped by their files).
- Every browser file but feel.e2e.ts, one at a time on port 3233: 30 of 30 files passed, no failure, no flaky (from `battle-map` 20 passed to `used`).
- Lines in lane B's files, each in its own commit: registry/items.ts and views/effects.js (EO2, c4956ea), views/maker.js (LD1, 39798f7), views/effects.js and views/maker.js (RD1, cf83fc6), views/bestiary.js (B3, 67fe11f).

## V10 checks (at a52df49, which also holds V3 and V6)

- Rows done 9 of 9: S1, S2, SM1 (b1f8c9f), CU1 (876d1f3), B2 and C2 (9323fc9, 46ae0cf), B4 (ac27887, e431ae2), SK1 (b1c18b6), C3 (942281a; a player's Necromancer on another phone left, notes-V10.md). AGENTS.md rows and the notes in e9a30cf. V13's leftovers: a reaction may not push or give an extra action (f33439d), the browser test of a player's blast (e8779fd).
- First browser loop at e8779fd: 28 of 30 files passed; customization.e2e.ts (2) and table-turn.e2e.ts (1) failed, each a test fault named from evidence and fixed in e6bc7bd (notes-V10.md "Checks": the gear test's fight held no row of the hunter, so it asserted the CU1 bug; the blast test's shape lacked `ring: null`, so the store dropped its ability).
- Merged claude/zen-pasteur-ov4cgd (ffd5aca) as a52df49, no conflict. `bun run deps -- --write` and `bun run charts`: nothing changed. `bun run typecheck`: no error. `bun run test`: 3445 pass, 0 fail (`Ran 3448 tests across 92 files.`).
- Every browser file but feel.e2e.ts at a52df49, one at a time on port 3250: 30 of 30 files passed, 312 tests, no failure, no flaky. No server of mine left running.
- Lines in lane B's files from V10: views/bestiary.js (B2 46ae0cf; B4 e431ae2, 15 lines, each its own commit); views/hunter.js `fightOf` and two imports (CU1, inside 876d1f3); views/shadows.js top helpers and the extraction outcome (S1, S2, SM1 in b1f8c9f; C3 2 lines inside 942281a); lane B's S3 summon lines untouched.

## V3 checks (at a52df49)

- Rows done 4 of 4: 41 (eac19e4, c25ec5c), 42 (84eaf81), 84 (aab5801), N5 (63a906a); sweep and AGENTS rows in 48896bd.
- typecheck, `bun run test` and the 30 browser files: as V10's, at a52df49.
- Lines in lane B's files: views/gm.js 10 lines (c25ec5c, its own commit); core/save.ts 17 lines (the `dropped` field and its repair) inside eac19e4 with pay.ts, not in a commit of its own: the brief asks for its own; named here for the lead.

## V6 checks (at a52df49)

- Rows done 8 of 8: I2 and G3 (cd650b7, d8a561e), G1 and G2 (857234d, c59363a, 54744ea), N7 (bcb0747), T1 (fdc960b), 51 (2aaf286), T2 (4ea5c9f); sweep in 48896bd.
- typecheck, `bun run test` and the 30 browser files: as V10's, at a52df49.
- Lines in lane B's files: views/gm.js 3 lines (G2, c59363a) and 2 lines (G3, d8a561e), each its own commit.

## For the lead

- The dropped-fight notice (a fight dropped at load told the player): save.ts and store.ts, lane B's V12 files; listed in notes-V13.md (FP1, Left).
- A player's Necromancer on another phone cannot extract (C3, notes-V10.md): it needs a room message or reward field that gives a shadow.
