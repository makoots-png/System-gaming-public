# Brief: the skill maker and the enemy maker (customization, unit 4b)

One helper (Opus, heavy-writer), in the main tree, on branch `claude/zen-pasteur-ov4cgd`. No other helper writes while you work. Earlier units are merged; read their notes in `docs/agent-handoff/cz/` (`notes-1-homes.md`, `notes-2-skills.md`, `notes-3-rewards.md`, `notes-4a-makers.md`).

Run `bun install` once. Read first: `AGENTS.md` (the recipe "A maker"), `docs/agent-handoff/helper-rules.md`, `docs/agent-handoff/cz/design.md`, `docs/agent-handoff/cz/inventory.md` sections 1 and 2. Principle skills: `principle-experience-first`, `principle-minimize-reader-load`, `principle-migrate-callers-then-delete-legacy-apis`, `principle-test-behavior-not-implementation`, and `unslop`.

Commit after every numbered step (name the files, plain messages, no AI attribution, no Co-Authored-By). This overrides the "do not commit" line of your built-in rules. Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Browser runs: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3243 bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-cz4b`. Never run `playwright install`. Rerun a file once before reading anything into one failure.

Notes file (append a line after each commit): `docs/agent-handoff/cz/notes-4b-skill-enemy.md`.

## Why (the owner's goal)

"The ability to make custom abilities, status effects, custom rewards, items, enemies, etc..." The core can now carry a skill with effects, a target and an attack roll, and a monster with skills, starting statuses and loot. No screen writes them. A GM on a phone must make an ability once, keep it, give it to a hunter or an enemy, and build an enemy that uses it, each in under a minute.

## Steps

Each step ends with `bun run test`, the browser file it names, and a commit.

1. **The skill maker** on `app.api.maker` (in `skills.js` or a new `src/views/skill-maker.js`; say which): name, active or passive, description; for an active skill MP cost, cooldown, the table roll (`dice`), "Affects: the user / a target", "Rolls to hit" (`attack`), and the effects editor (by rank: a hunter's or a monster's rank); for a passive skill the bonus fields. The live preview says what a use does in the game's words (cost, cooldown, to hit, each effect). "Save to library" is on by default and writes `library.skills` through `parseSkill` (same name replaces, as items do). The Skills panel's "Add skill" form opens this maker; its "Add from list" lists the built-in table and then the library. The maker never sets `grade`: if nothing reads it (the inventory says nothing does), delete the field from the type, the parser and the repair.
2. **Give a skill.** From the library list (step 5) and from the maker's result, "Give to…" lists this phone's hunters and, in a room, the players' sheets. A local hunter gets a copy at once. A remote player gets it through an `award` whose rewards hold only that skill (unit 3 made `Rewards.skills`); the player sees the reward window.
3. **The enemy maker** (`bestiary.js`, on the shell): keep Generate stat block as the fast path (name, rank, boss, elite: four taps), and make the full editor a maker with: name, rank, type, the numbers (prefilled from the rank table when the rank changes and a number is untouched, so a custom enemy starts balanced), boss, elite, extractable; abilities as text lines (as today); **skills** (pick from the built-in table and the library, or "New skill…" which opens the skill maker and comes back; at most 12); **starts with** (statuses from the rules, each with rounds or until removed; at most 8); **loot** (gold, and items from the library or "New item…"; at most 20); description. The preview shows the stat line and each skill in words. Saved through `parseMonster`.
4. **Loot at the end of a fight.** When the GM ends an encounter and defeated monsters had loot, the end window lists what dropped (gold summed, items) with one button, "Award loot…", that opens the Award form with the gold and the items filled in (the Award form holds many items after unit 3 or 4c; if it still holds one, add the rest as a list the form sends, in the smallest way, and say so). No auto-award: the GM chooses who gets it.
5. **The Workshop view**: one view (`app.registerView`, in the GM's More menu, GM only), with a section per kind: Statuses, Items, Skills, Enemies, Rewards (bundles; if unit 4c has not landed, leave its section out and say so). Each lists the library's entries with New, Edit, Duplicate, Delete, and for a skill "Give to…". It replaces the GM view's Status library and Item library panels (delete them and move their tests) and links to the Bestiary for the full enemy list. An empty section says what the kind is in one line and shows its New button.
6. **Browser tests** in `tests/e2e/makers.e2e.ts`, through the UI on a phone viewport:
   - a GM makes a skill "Frost Lance" (target, rolls to hit, 2d8 damage by rank, applies a status for 2 rounds), sees the preview, saves; it is in the library; given to a local hunter, the hunter uses it on a monster in a fight and the monster takes damage and shows the status;
   - a GM gives a library skill to a player in a room and the player's Skills panel shows it;
   - a GM makes an enemy "Ice Warden" at rank C with that skill, a starting status and loot of 50 gold and one item; added to a fight it shows the status; it uses the skill on a hunter; when the fight ends the window lists the loot and Award loot opens the form with it;
   - changing an untouched enemy's rank changes its HP to the rank table's value, and a number the GM typed is kept;
   - the Workshop lists one of each kind made above, and Delete removes one;
   - the taps to make the skill and the enemy from the GM's home screen, counted in the test's name and in the notes.
7. `bun run test`, `bun run deps -- --write`, every e2e file that touches skills, the bestiary, a fight or the GM view. `AGENTS.md`: the Skill and Monster recipes name their makers; a line for the Workshop.

## Rules

- A maker saves only what the kind's parser gives back for it.
- One-handed at 390 px: controls at least 44 px tall, no horizontal scroll, the Save bar above the keyboard.
- No new op, no formula. Words go to `docs/agent-handoff/copy-tasks.md`.
- Views stay JavaScript and pass `tsconfig.views.json`.
- If a step needs a decision the design does not make, choose the smaller option, write it in the notes under "Decided by the helper", and go on.

## Done means

`bun run test` passes and the browser files pass. Final reply under 200 words: the commit range, the counts, the tap counts, what you decided yourself, anything unsure.

If you are still going after about 90 minutes of work, commit what passes, write exactly where you are in the notes, and reply.
