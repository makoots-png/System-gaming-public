# Brief: the leftovers (code), after the audit's fifteen units

One helper (Opus, heavy-writer) in the main tree, `/home/user/systemgaming`, on `claude/zen-pasteur-ov4cgd`. The general brief is `final/brief-implicit-unit.md`: read it first and follow all of it (poteto mode, commit by path after each row, no push, no helpers, the cause written before each change, a test that fails without it). This file names the rows. Where the two differ, this file wins. No other writer is in the tree, so you may change any file a row needs. A read-only audit helper may be reading the tree while you work. Browser port: `E2E_PORT=3232`.

## The goal, in the owner's words

"I want it perfect, I do not care about time." "Everything must be explicit. Everything." "Fix the problem and not the symptoms." Fifteen units each left a short list of things they did not own. The problem is that each is still a rule held by a view, a fact guessed, or a thing a GM cannot make. The smallest change that meets the goal is each row below done where AGENTS.md says that kind of thing lives, and nothing else.

## Step 0: check each row against the code

Later units did some of these. For each row write one line in `final/notes-leftovers.md`: still true (file and line), already done (by which commit), or changed shape. Commit the notes. Then do the rows still true, in this order.

## Rows

1. **The codex record written by `bestiary.js`** (`final/notes-implicit-U4-combat.md`, its "left" list). A view writes a saved record. Make it a named core step through `store.apply`, or show it is one already.
2. **No lint for per-row fight state kept in a view's Map** (same notes). U4 moved a corpse's attempts from a view's `Map` into the fight. Add the lint that refuses a module-level or register-level `Map`, `Set` or object in `src/views` that holds state keyed by a combatant, hunter or row id, with an allow-list naming each entry and why (drawing caches are allowed when named). The first case is the old line it would have caught.
3. **`store.ts` `load` ignoring a failed backup push** (`final/notes-implicit-U12.md`). A failed backup at load must reach the store's machine and the player's banner as every other failed write does.
4. **`isPlaceholder` in `combat.js`** (`final/notes-implicit-U14.md`, "Left"). "Add party" skips a local hunter it guesses was never played, from its name and fields. The lead's call: the rule belongs in core as one pure function over the hunter and the seat (for example `untouched(h)`: the hunter equals what `newHunter` makes, apart from its id), with a table test, and the view calls it. No name is compared. If reading the code shows a better explicit rule, do that and say why.
5. **A skill label that reads "Lv.n"** (`skills-held.ts`, same notes). The label follows the level because of what its text says. Make it a fact where the skill is made (the skill maker's field, its default in `save.ts`, a repair line, a test), and delete the label test from the lint's allow-list.
6. **`parseOverrides` keeps a list override as written** (same notes). Write a reader per list (titles, path tiers, the daily template and any other list rule): an entry that is not the rule's shape is refused with the GM told which, and `merge` loses its cast. A GM's real data that differs only in an optional field must still load: the test has such a case.
7. **`MakerApi.open` answers `Promise<any>`** (same notes). Type it over the maker's body and remove it from the `any` lint's list.
8. **Save ids still `string`** (same notes): skill, loadout, boon, reward bundle, battle map, a GM monster (`Monster.id`, joining gate.ts's `MonsterId`), a quest's `chainId`, a shadow's `monster`, `codexSeen`, `fightRefs`. Brand each by U14's recipe (a prefix in `SaveIds`), led by the typecheck.
9. **23 type names exported by two modules for two things** (same notes). For each, either the two are one thing (one export, the other imports it) or they are two (rename one so the name says what it is). The lint's list ends empty or holds only names with a reason a reader would accept.
10. **Einar's boundaries are not makeable** (`kits/notes-makers.md` lines 104 and 131): the ability form has no control for a field's upkeep, end or triggers, nor for a summon's starting statuses. Add the controls to the maker with the round trip tests the other kit blocks have, so the kit example for Einar's boundary can be built from the Workshop on a phone. Read `kits/design.md` for what the core already holds.
11. **The kit blocks the worth bar cannot estimate** (`kits/notes-worth.md`). Read the list. Where the simulation or a simple rule gives a defensible number (explain the number in the notes, as `principle-explain-the-number` asks), add the rule and its test against the simulation. Where none does, leave "cannot estimate: test it in a fight" and say why in the notes. Do not invent a number to make the line go away.
12. **`for-the-owner.md` holds two sections twice** ("Nothing sent to the room is lost" and "The players' sends"). Delete the second copy of each.

Not yours: the wording pass (`copy-tasks.md`, every `TODO(copy)`). A later unit does it. Leave `TODO(copy)` marks where they are and add one where you write new words.

## Checks before you report

As `final/brief-U14.md` says: deps, charts, typecheck, the whole `bun run test`, then every browser file one at a time except `feel`, with `E2E_PORT=3232`. A test that fails once is a finding. `git status --porcelain` is empty when you report.

## Close

Notes in `final/notes-leftovers.md` (each row: the cause, the change, the test, the commit; a decision trail; a "Left" section with reasons). AGENTS.md rows and recipes for what now exists. `for-the-owner.md` for any change a player or GM sees. Reply in at most 200 words: commit range, each check's last line, rows done of twelve, what a player or GM would notice, what is left and why.
