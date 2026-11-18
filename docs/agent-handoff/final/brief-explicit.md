# Brief: every write to the save is a named core function (two helpers, split by view)

This widens `brief-roundtrip.md`; read that first and do its steps, with this added. The owner: "Ok everything must be explicit. Everything." (START-HERE.md, "Everything explicit").

Measured: about 120 `store.update` calls in `src/views`, most with the rule written inline in the callback (hunter.js 24, custom.js 15, inventory.js 13, quests.js 10, gates.js 9, shadows.js 7, bestiary.js 7, and so on). Some already call core (`gate.ts` `step`, `progress.ts`, `vitals.ts`, `rewards.ts`, the fight); many do not.

## The end state

- Each inline callback becomes a call of a pure function in core, in the module that owns that state by AGENTS.md's table (inventory and equipment, gold and the shop, quests and dailies, shadows, titles and jobs, skills a hunter holds, the library's lists, settings and prefs, the session log, the party's hunters). Where no module owns it, make one beside its kin, with a header saying what it owns. A function takes the hunter or the save part it changes and its arguments (the role where the rule differs by role, the rules `R`, a time or a die where it needs one: core reads no clock and rolls nothing), and returns the next value or a typed refusal (`{ ok: false, why }`), never throws, never half-changes.
- A view's callback is then one line: `store.update(d => { Object.assign(h, op(h, args)) }, tag)` or the equivalent the store already supports; if the store's draft style makes that awkward, add one helper in `store.ts` (say `store.apply(tag, save => nextSave)`) and use it everywhere rather than inventing per-view shapes. Say which in the notes before starting.
- Each function has a test in its module's test file: what it gives, what it refuses, and, where a second function undoes it, the round trip (roundtrip brief step 2). Where the functions of one thing form states (a quest: offered, accepted, done, failed, abandoned; a daily; a shadow: extracted, summoned, dismissed, lost; an item: held, worn, used up) and no `TABLE` exists yet, write the table as the other machines do, with its chart entry (`scripts/charts/`, `MACHINES`) and walk events.
- A lint test in `tests/lint.test.ts`: inside `src/views`, no assignment to, `++`/`--` on, `push`/`splice`/`pop`/`shift`/`sort`/`delete` of anything reached from the store's draft, outside the one `Object.assign`/apply form. Start it with an allow-list of the files not yet converted and end the unit with the list empty; if a file cannot be finished in time, it stays on the list with its count, and that is reported.
- Device prefs (this phone's view choices) are not the save: leave them, but name the one function that writes them.
- No behaviour change is intended. Where moving a rule shows a bug (a role branch that loses something, a silent commit, a missing bound), fix it in its own commit and list it as a finding with what a player would have seen.

## The split

- **Helper A (main tree):** roundtrip brief step 1 (allocation), then `hunter.js`, `inventory.js`, `skills.js`, `shadows.js`, `starter.js`, `gm.js`, `uses.js`, `dice.js`, `effects.js`.
- **Helper B (own worktree, branch off the same commit):** `custom.js`, `quests.js`, `gates.js`, `bestiary.js`, `workshop.js`, `forge.js`, `loot.js`, `reward-editor.js`, `map-maker.js`, `coin.js`, `io.js`, `onboard.js`, `room.js`, `table.js`, `combat.js` (outside the fight's `send`), and any other view.
- Shared files (`tests/lint.test.ts`, `AGENTS.md`, `src/core/save.ts`, `src/edge/store.ts`, `docs/dependency-map.md`, `docs/state-machines.md`): A owns `store.ts` and decides the apply form in its first twenty minutes, commits it alone, and B merges that commit before converting (B: start with the round-trip table and core functions for your views, which need no store change). Each adds its own lint allow-list entries in a separate block so the merge is two blocks. Regenerate deps and charts last.
- Both: roundtrip brief steps 2 and 3 for your own views; A does step 4's recipe in AGENTS.md.

Work view by view: convert, run that view's bun tests and browser file, commit. A view half converted is never committed.

Time: four hours each. Reply in at most 250 words: branch and commit range, each check's last line, how many callbacks converted of how many, the machines added, the findings (what a player would have seen), what is left on the allow-list.
