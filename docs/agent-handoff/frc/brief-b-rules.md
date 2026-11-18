# Brief B: the Rules page says what the game does, and 0 HP is "down" (writer)

Tree: `/workspace/sg-frc-rules`, branch `frc-rules`. Work only there. Browser tests on `E2E_PORT=3361`.
Notes file: `docs/agent-handoff/frc/notes-b.md` (write as you go). Read `design.md` in this folder first.

Where this brief and `docs/agent-handoff/helper-rules.md` differ, the brief wins: **you commit**, one commit per
numbered step below, each `git add <paths>` by path, a plain one-line message, no attribution lines. Never push, never
`--no-verify`, never touch `.claude/skills`, start no helpers. Read `.claude/skills/poteto-mode/SKILL.md`,
`principle-test-behavior-not-implementation`, `principle-fix-root-causes` and `unslop` before you write.

## What the owner asked for

The Rules tab contradicts the game. Make the text match the code, derive its numbers from the code the game runs, and
pin them with a test so they cannot drift.

| # | Today (`src/views/rulesref.js`) | The game |
|---|---|---|
| 1 | "a score of 14 adds about 2" (L107), while the worked example two lines up shows +1 | `checksOf` in `src/core/hunter/sheet.ts`: `floor(above(score) / 2)`, which is +1 at 14 |
| 2 | "Confirm the allocation, or leave the Status view, to lock it in" (L138) | Only Confirm locks. Verify in `src/core/hunter/progress.ts` (`raise`, `lower`, `confirm`) and `src/views/hunter.js` that nothing confirms on leaving |
| 3 | "Natural 1 always fails" (L111) | `checkResult` (`src/core/roll.ts`) fails a natural 1, and outside a fight a natural 1 or 20 on a check calls the coin (`src/core/coin.ts`: `isCoinRoll`, `verdict`, `VERDICT_WORDS`): a right call on a 1 reads Saved |
| 4 | 0 HP is "Unconscious" (Rules L166, the status, the death panel's first word, a refusal), "Dying" (chip, panel, toast) and "down" (the fight, the glossary) | One state |
| 5 | The page opens with "GM quick card" for everyone | A player has no use for it |

Out of scope: first-run setup, the Room view, `src/views/onboard.js`, `room.js`, `src/edge/` (brief A, another tree);
`src/core/combat/`. The life machine's state names (`up`, `dying`, `stable`, `dead` in `vitals.ts`) do not change:
`src/core/combat/play.ts` reads `dying`, and another lead is working there.

## The term: down

`docs/agent-handoff/copy-tasks.md` already rules it: "A hunter at 0 HP: down". So:

- A hunter at 0 HP is **down** and makes death saves. Three successes make it **stable**: still down, no more saves.
  Three failures: **dead**. A monster at 0 HP stays "defeated".
- `LIFE_TAG` (`src/core/hunter/vitals.ts`): `dying: 'Down'`, `stable: 'Down, stable'`, `dead: 'Dead'`. The chip and
  the death panel read it; the view writes no word of its own (`hunter.js` L413 and L552 take the word from
  `LIFE_TAG`).
- The toast when HP reaches 0 (`hunter.js` L239): "HP has reached 0. You are down." The sentence lives in core beside
  `LIFE_TAG`, not in the view.
- The status key `unconscious` becomes `down` everywhere: `src/core/registry/statuses.ts` (label "Down", its
  description in the same words as the Rules page), `VITAL_CHIPS`, `vitalChipsOf`, `chips.ts` (`chipDef`,
  `CHIP_REFUSAL`: "Down and Dead follow HP and death saves."), the comments that name it, and every test. Let the
  typecheck find the places. Old saves need not keep working.
- After the change, `grep -rni "unconscious" src/ public/ tests/ scripts/` prints nothing, and no screen says "dying"
  (`grep -rn "Dying\|dying\." src/views` shows only code that reads the state name). Say in the notes what each grep
  printed.

## `src/core/rules-text.ts` (new, pure): the lines the page got wrong, worked out from the game

The view keeps its layout and calls these. Each takes the rules (`Rules`) where it reads a number.

```ts
/** The stat's part of a check bonus: what checksOf adds for a score. */
export function statBonus(score: number, F: Rules['fight']): number;   // lives in sheet.ts or stats.ts; checksOf calls it
export interface CheckExample { readonly score: number; readonly rank: Rank; readonly above: number;
  readonly stat: number; readonly rankBonus: number; readonly dc: number; readonly need: number }
export function checkExample(R: Rules): CheckExample;      // score 14, rank E, the DC the page uses today
export function statBonusLine(R: Rules): string;           // replaces "so a score of 14 adds about 2"
export function naturalLines(): readonly string[];         // natural 20 and 1, then the coin, words from VERDICT_WORDS
export function pointsLine(): string;                      // + spends, - takes back an unconfirmed point, only Confirm locks
export function downLine(R: Rules): string;                // 0 HP, death saves, stable, dead, Revive
```

- `statBonus` is extracted from `checksOf` and `checksOf` calls it, so the page and the sheet cannot disagree. Put it
  where its inputs live and keep `checksOf`'s behaviour exactly.
- `checkExample` gives the worked example its numbers (the view's `ex`, `exX`, `exMod`, `exRb`, `exDc`, `need` go),
  and `statBonusLine` states the same `stat` number, for example: "Near 10 the effective points are close to the score
  minus 10, and half of them, rounded down, is the bonus: a score of 14 has about 3.4 points above 10 and adds +1."
  Every number in it comes from `checkExample` and the rules.
- `naturalLines`, as a draft: "A natural 20 on the d20 succeeds whatever the total, and a natural 1 fails whatever the
  total." then "Outside a fight, a natural 1 or 20 on a check also calls the coin: you call heads or tails. On a 1, a
  right call reads Saved and a wrong one Critical failure. On a 20, a right call reads Critical success and a wrong one
  Success. The coin changes no number: the GM rules what it means." Take each word from `VERDICT_WORDS` through
  `verdict`, and check `coin.ts` for who picks the side and when it is called before you keep a claim.
- `pointsLine`, as a draft: "Spend points with + on a stat. − takes back a point you have not confirmed. Confirm locks
  the points in; until then they wait, also after you leave the Status view. The GM can edit any stat." Keep only what
  the code does.
- `downLine`: the death-save rule from the life machine's own numbers. Export `SAVE_SUCCESS` and `SAVE_UP` from
  `vitals.ts` (and a named constant for "a 1 counts as two failures" if the machine has a literal there), with
  `SAVES_TO_END` and `REVIVE_HP`. For example: "At 0 HP a hunter is down and makes death saves: a d20, 10 or higher
  succeeds. Three successes make the hunter stable (still down, no more saves) and three failures are fatal. A 20 gets
  up at 1 HP, and a 1 counts as two failures. The GM can stabilize a hunter. Healing and rest do not raise the dead:
  only the GM's Revive does, at 1 HP."
- Follow `docs/agent-handoff/copy-tasks.md`: plain words, no em dash, no exclamation mark, sentence case.

## `src/views/rulesref.js`

- "GM quick card" (`cheat`) is listed only when `app.isGM()`. A player's page opens with "How checks work". The
  `update` signature includes the role, so the page redraws when the phone becomes the GM's.
- The four lines above come from `rules-text.ts`.
- L190, "Each shadow level adds +10% max HP (GM-driven)": find the rule in `src/core/hunter/shadows.ts`, `derive.ts`
  and `combat/rows.ts`. If the game does it, state the game's number from the rule; if nothing does, delete the line.
  Say which in the notes.
- Read the rest of the page once against the glossary's 0 HP term and fix any line that says it another way. Do not
  rewrite anything else.

## Tests

- `tests/rules-text.test.ts` (new). Each expected value comes from the function that plays the rule:
  1. `checkExample(RULES).stat + .rankBonus` equals `checkBonus` of a real rank E hunter with Strength 14 and no
     fatigue or penalty (build the hunter the way `tests/sheet.test.ts` does), and `statBonusLine` contains that
     `stat` as "+N"; under an override that changes the curve (`effExp` or `statBase`) both move together;
  2. `naturalLines` agrees with `checkResult` (a natural 1 with a total far above the DC fails, a natural 20 far below
     succeeds) and names `VERDICT_WORDS[verdict(...)]` for each of the four cases;
  3. `pointsLine`: a raised point comes back with `lower` before `confirm` and is refused to a player after it (the
     sentence says "Confirm" and does not say "leave" as a way to lock);
  4. `downLine`: the numbers in the sentence are the ones `lifeAfter` (or the machine's own step function) plays: a
     roll of `SAVE_SUCCESS` is a success and one below is a failure, `SAVE_UP` gets up at 1 HP, a 1 counts two,
     `SAVES_TO_END` successes make `stable`, `SAVES_TO_END` failures `dead`, Revive brings back at `REVIVE_HP`.
- The tests that name the old words and key move to the new ones: `tests/statuses.test.ts`, `tests/vitals.test.ts`,
  `tests/rewards.test.ts`, `tests/save.test.ts`, `tests/protocol.test.ts`, `tests/fight-save.test.ts`,
  `tests/lint.test.ts`, `tests/e2e/character.e2e.ts` (the chip reads Down, then Down, stable).
- A browser test (in the file that already opens the Rules page; `grep -ln "rules" tests/e2e/*.ts`): a player's Rules
  page has no GM quick card and opens with How checks work; a GM's has the card first; the 0 HP line says down.

## Steps: commit each when its check passes

While `pgrep -f scripts/ci.ts` prints a pid, the lead's CI is running: run no browser and no whole `bun test` then
(typecheck and single test files are fine). Check before each browser run.

1. `statBonus` extracted, `checksOf` calling it. Check: `bunx tsc --noEmit && bun test tests/sheet.test.ts
   tests/derive.test.ts`.
2. The term: `LIFE_TAG`, the toast sentence, the key `down`, their tests. Check: both typechecks
   (`bunx tsc --noEmit && bunx tsc -p tsconfig.views.json --noEmit`), the test files listed above, the two greps.
3. `rules-text.ts` and `tests/rules-text.test.ts`. Check: that file, the typecheck.
4. `rulesref.js` reading it, the GM card for a GM only, the shadow line, the browser test. Check:
   `E2E_PORT=3361 bunx playwright test tests/e2e/character.e2e.ts <the rules file> --workers=1
   --output=/tmp/pw-frc-b`.
5. The docs: an AGENTS.md row in "Where things live" for the Rules page's sentences (`src/core/rules-text.ts`, test to
   copy `tests/rules-text.test.ts`), the vitals row's words if they name the old chip, `copy-tasks.md` if it lists the
   old words, `bun run deps -- --write`. Check: `bun run test` (whole; only when no CI runs).
6. The browser files your change can reach, one worker: every file that
   `grep -lE "Dying|Stable|death|[Rr]ules|unconscious|chip" tests/e2e/*.e2e.ts` prints (not `feel.e2e.ts`), plus
   `look.e2e.ts` and `phone.e2e.ts`, as
   `E2E_PORT=3361 bunx playwright test <files> --workers=1 --output=/tmp/pw-frc-b 2>&1 | tail -40`. A file that
   fails once is rerun once before you read anything into it (the box pauses). Fix what your change broke; a failure
   that is not yours goes in the notes with its output. The lead runs the whole CI after the merge.

Reply in at most 200 words: what you made, each check's last line, the commits, what you were unsure of. Anything
longer goes in `notes-b.md`, which you commit too.
