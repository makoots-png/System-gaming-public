# Brief: U14, ids and kinds (the audit's last sweep)

Your unit is U14 of `final/implicit-audit.md`. The general brief is `final/brief-implicit-unit.md`: read it first and follow all of it. This file adds what is particular to U14. Where the two differ, this file wins.

## The goal, in the owner's words

"Everything must be explicit. Everything." "For all things we must fix the problem and not the symptoms." U14's problem is that an id, a kind or a result is carried as a bare string or worked out again from words on the screen, so the compiler cannot tell a hunter's id from a room code and a view guesses a roll's kind from its label. The smallest change that meets it: one brand for ids, the save's ids branded at load, and each fact (a roll's hunter, kind, DC and success) stored where it is made, with the regexes and name lookups that guessed it deleted.

## Where you work

The main tree, `/home/user/systemgaming`, on `claude/zen-pasteur-ov4cgd`. No other helper is running, so the file fences of the general brief do not apply: you may change any file a row needs, and you name each one outside U14's list in your notes. Commit by path after each row. Never push. Browser port: `E2E_PORT=3231`.

## Step 0: take the inventory again

Thirteen units landed after the audit was written, so its line numbers are stale and some rows are done or moved. Before changing code, for each of rows 23, 24, 27, 57, 59, 78, 79, 87, 88, 89, 90 (step 1 has the finding, step 2 the judgment), find the code as it is now and write one line in `final/notes-implicit-U14.md`: still true (with file and line), already done (by which commit or unit), or changed shape (what it is now). Commit the notes. Then do the rows still true.

## Rows other units left for U14

Check each against the code first; do the ones still true.

1. `notes-implicit-U13.md` lines 80 to 84: the codex rule in the view whose parts are `keyOf` by name and `recFor` by name. These are name lookups. Replace them with ids and move the rule to core.
2. `notes-implicit-U10.md` line 80: `codexDoc` orders entries by comparing `lastAt` strings. Row 59 asks for times compared as numbers in one core helper; this is the same class.
3. `notes-implicit-U5.md` lines 78 and 89 to 91: save.ts's repair keeps a quest's `dueAt` as any string. Read it as a time at load (a repair line and a case in `tests/save.test.ts`), and brand the quest ids with the save's other ids.

## Sweep for the class, not the instances

After the listed rows, search for the same faults elsewhere and fix what you find, each with its cause in the notes:

- `.find(` or `.filter(` over hunters, monsters or combatants by `.name ===` in `src`.
- A regex or `includes(` on a label, a log line or a roll's text that decides behaviour.
- `as never`, `as any`, `as unknown as` and `any` in `src/core` and `src/edge` outside a core table's dispatch.
- Two types with one name, or one id type under two names.
- A time compared as a string.

Add the kind 5 lint tests the audit names (its last section) to `tests/lint.test.ts`, each with the old line it would have caught as its first case and an empty allow-list, or one that names each entry with its reason.

## Checks before you report

`bun run deps -- --write`, `bun run charts`, `bun run typecheck`, the whole `bun run test`. Then every browser file, one at a time, except `tests/e2e/feel.e2e.ts` (five pushes were refused on a test a unit did not think it touched):

```
for f in tests/e2e/*.e2e.ts; do case $f in *feel*) continue;; esac; E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3231 bunx playwright test $f --workers=1 --trace off --output=/tmp/pw-u14 | tail -3; done
```

A test that fails once is a finding about the app until shown otherwise. Name its cause before changing anything; never retry it, lengthen a wait or change the test to pass.

## Close

As the general brief says: AGENTS.md rows for what now exists, `for-the-owner.md` for any change a player sees, notes in `final/notes-implicit-U14.md` with a decision trail and a "Left" section. Reply in at most 200 words.
