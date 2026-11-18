# Brief: the combat view runs on the reducer (M3 unit C)

Read `AGENTS.md` and `docs/agent-handoff/helper-rules.md` first. Where this brief and the rules differ, this brief wins.

You work in the repo root on the branch that is checked out. No other helper is running. Commit after every numbered step (plain messages, no AI attribution lines, never `.claude/`). Do not push. Do not start helpers of your own.

Browser runs: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3241 bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-wiring`. Do not run `playwright install`. If a browser test fails once, rerun that file once before reading anything into it.

Notes file (append a line after each commit): `docs/agent-handoff/p3/notes-combat-wiring.md`.

## Why

`src/core/combat/encounter.ts` now holds the fight as a union (`Setup | Running`) with one pure `reduce(enc, cmd, ctx)` that returns the next encounter and a list of effects as data. It has bun tests and a property test. Nothing uses it yet: `src/views/combat.js` still keeps `e.turn`, `e.begun`, `e.active`, `c.defeated`, a mirrored copy of each hunter's statuses, and mutates the encounter in about 25 places. This unit makes the reducer the only writer of the encounter and deletes the old bookkeeping.

Read first: `src/core/combat/encounter.ts` (whole file), `docs/agent-handoff/p3/brief-reducer.md` (the model and why), `docs/agent-handoff/p3/notes-reducer.md`, then `src/views/combat.js`.

## How to work (skills in `.claude/skills/`)

This is a refactoring: the structure changes and what the table sees does not. Read `.claude/skills/poteto-mode/playbooks/refactoring.md` and follow its order. Read `.claude/skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md` if it exists, `principle-prove-it-works` and `principle-minimize-reader-load` before you start, and `unslop` before you write AGENTS.md text, notes or commit messages.

- The pin is the browser tests. Before you change any app code, run `combat-turns`, `character`, `table-session` and `gates-quests-dailies` once and record the counts in the notes. They are your contract.
- No parallel old and new paths and no compatibility shims: when a writer moves to a command, its old code is deleted in the same commit.

## Reducer amendments (step 0, before any wiring, tests first, one commit)

The lead reviewed the reducer and wants three changes in `src/core/combat/`:

- Ids of different things are different types (`principle-type-system-discipline`): brand `CombatantId`, `HunterId` and `RemoteKey` so that passing a hunter id where a combatant id belongs fails the typecheck. The parser is where a plain string becomes a branded id.
- `src/core/rules.ts` now exports the real `Rules` and `Rank` types. Use them in place of the local `Rules` slice and `rank: string`.
- A hunter on another phone has a tier too. `Remote` gets `tier` (0 to 5), `syncRemote` carries it, and a status applied on a remote hunter's turn takes it as the source tier. The view computes it from the phone's sheet the same way it does for a local hunter.

Accepted as the helper left them: a monster the GM put down by hand stays down when healed (Revive brings it back), Revive at 0 HP is refused with "Heal it to bring it back", and rolling initiative with nobody up is refused.

## What to build

1. **The save.** In `src/core/save.ts` the `Encounter` and `Combatant` types become the reducer's types (import them; delete `newEncounter`, `newCombatant`, `fixCombatant`, `COMBATANT_KINDS` if nothing else needs them). The repair calls `parseEncounter`. A fight the parser does not recognise becomes `null`. Update `tests/save.test.ts` (an old-shape fight in a schema 3 save loads with no fight and everything else intact) and the fixtures only where a test needs it.
2. **One dispatcher.** In `combat.js`, one function sends a command: inside a single `store.update` it builds the `ctx` (current rules, a lookup that turns a hunter's sheet into the reducer's `HunterView`), calls `reduce`, stores the result in `d.encounter`, and returns the effects. After the update it carries the effects out, in order: sheet changes through `app.api.hunter` and `app.api.effects`, `sendRoom` for remote hunters, `app.emit('combat:turn' | 'combat:defeated' | 'combat:end')`, a toast for `refused`, and for each `rollTick` it rolls with the dice view (as `turnEffects` does today) and dispatches the result as a command. If you can apply the sheet effects inside the same `store.update` without a nested update, do that; if the hunter API forces a second update, keep the order above and say so in the notes.
3. **Every writer goes through it.** Replace `mut(...)`, `resort`, `begin`, `step`, `setHp`, `setMp`, `toggleDefeated`, `addStatus`, `removeStatus`, `removeCombatant`, `add`, `rollInit`, the initiative edit, share-init, gate link, extract log, sheet sync and End or Clear with commands. Delete `at()`, `e.begun`, `mirrorConds`, `condsOf` on hunters, and every direct write to `d.encounter` except the dispatcher. Rolling stays at the edge: `rollInit` asks `initiativeNeeds`, rolls the d20s with the dice view, and sends one `rollInitiative` command.
4. **Readers.** The view reads the new shape: `phase === 'running'` for `active`, `currentId` for whose turn it is, `state === 'down'` for defeated, `kind: 'remote'` for a hunter on another phone, statuses from the sheet for a local hunter and from the combatant for everyone else. Fix the other readers and writers of the encounter (grep for `encounter` and `api.combat` in `src/views` and `src/edge`): `gates.js` (links a gate, reads who fought), `shadows.js` (`extractTried` becomes a command through `app.api.combat`), `bestiary.js` (builds combatants, reads `defeated`), `custom.js` (reads `active`), `room.js` (`removeRemote`). The room document `encDoc()` publishes keeps its wire format (`active`, `currentId`, `list[].defeated` and so on), so `table.js` and the player's phone do not change.
5. **Sources.** `addStatus` passes no source when the GM uses the Status button (the reducer defaults to the combatant whose turn it is). A monster ability's "Apply Poisoned" chip passes that monster as the source.
6. **Lint rule** in `tests/lint.test.ts`, named in `AGENTS.md`: only the dispatcher writes the encounter (no `.encounter =` and no `d.encounter.` or `en.` mutation outside it; write the regex so it catches the patterns this file had, and say in the test message what to do instead: add a command).
7. **Tests.** Update the browser tests that read or seed the old shape (`combat-turns`, `character`, `customization` seeds a fight by hand, `gates-quests-dailies` and `helpers.ts` set `defeated`, `table-session`, `save`). Where a test set old fields through the store for setup, drive the UI if it is short, otherwise seed the new shape. Do not weaken an assertion about what a player or GM sees. Then run every browser file that touches a fight: `combat-turns`, `character`, `customization`, `gates-quests-dailies`, `table-session`, `save`, `room-view`.
8. **AGENTS.md.** A row in "Where things live" (what a fight is and how it changes: `src/core/combat/encounter.ts`, tests to copy `tests/encounter.test.ts`) and a recipe "To add a combat command" (the command in the union, the case in `reduce`, the effect if it reaches outside the fight, the test, the button in `combat.js`).

## Rules for this unit

- What a GM or player sees must not change, except: the log may word a line differently where the reducer already does, and the stacking rule from unit A.
- Do not change the reducer's model. If the view needs something the reducer cannot answer, add a small pure selector to `encounter.ts` with a test (for example `current(enc)`, `xpTotal(enc)`), not logic in the view. If a command is missing or wrong, fix it in the reducer with a test, and list it in the notes.
- `combat.js` stays JavaScript. Do not restyle or reorder its HTML.
- The file should get shorter. Do not leave the old helpers behind "for now".

## Done means

- `bun run test` passes, and the seven browser files pass.
- `grep -n "begun\|\.turn\b\|mirrorConds\|\.defeated =" src/views/combat.js` finds nothing.
- Final reply under 200 words: what you made, the last line of `bun run test` and of each Playwright run, reducer changes you had to make, anything you were unsure of.

If a step turns out to be wrong or much larger than it reads, stop, write why in the notes file and reply. Do not widen the task.
