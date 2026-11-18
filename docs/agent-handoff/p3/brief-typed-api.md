# Brief: a typed `app.api` and a typed event table (M8, unit 4)

Read `AGENTS.md` and `docs/agent-handoff/helper-rules.md` first (its last section names the principle skills: here `principle-type-system-discipline`, `principle-subtract-before-you-add`, `principle-migrate-callers-then-delete-legacy-apis`, `principle-minimize-reader-load`, `principle-build-the-lever`, `principle-encode-lessons-in-structure`). Where this brief and the rules differ, this brief wins.

You work in the repo root on the branch that is checked out. No other helper is running. Commit after every numbered step (name the files you add, plain messages, no AI attribution lines). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Browser runs: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3241 bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-api`. Never run `playwright install`. If a browser test fails once, rerun that file once before reading anything into it.

Notes file (append a line after each commit): `docs/agent-handoff/p3/notes-typed-api.md`.

## Why (the owner's goal)

"It should be stupidly easy to add or change features, with a very clear trace to whatever they depend on or what depends on them." `docs/dependency-map.md` (made by `bun run deps`, kept current by `tests/deps.test.ts`) now shows every dependency, including two kinds the compiler does not see: calls through `app.api.<name>.<member>`, an object each view fills at run time, and events named by strings (`app.emit('combat:turn', ...)`, `app.on(...)`). The map found 4 events that are emitted and heard by nobody, 41 registered API members nothing in `src/` uses (4 used only by browser tests), and 2 places it cannot follow. Renaming an API member or changing an event's payload today breaks callers silently, because the views are JavaScript and nothing checks them.

The views stay JavaScript. This unit does not convert them. It gives the two invisible contracts one typed definition each and makes the existing checks enforce them.

## What to build

1. **Subtract first.** Read `docs/dependency-map.md` and the allow lists in `tests/deps.test.ts`. Delete every registered API member that nothing uses, in the module that registers it, with the code that only it reached. Keep one only when a browser test uses it as its setup or read path (list those in the notes, and say for each whether the test could use the UI or the store instead: if so, change the test and delete the member). Delete each event nobody hears, or, if a listener clearly should exist (say why), add it. Remove each deleted entry from the allow lists. Run `bun run test` and the browser files of each module you touched. This step alone should shrink the app.
2. **The event table.** `src/core/events.ts`: one type, `AppEvents`, mapping each event name to its payload type (reuse core types: the fight's ids, `Gate`, protocol events, the store's change payload), with a one-line comment per event saying who emits it and why a listener would care. Typed `emit` and `on` on the app object: write the small typed emitter in TypeScript (`src/edge/bus.ts` or inside the app's typed part) and have `src/app.js` use it, so the TypeScript modules that emit or listen (`src/edge/sync.ts`, `src/edge/room-events.ts`, any other `.ts`) are checked by the compiler. For the JavaScript views, extend `scripts/deps.ts` and `tests/deps.test.ts` so the test fails on an event name that is not in `AppEvents` (read the table's keys from the source), and on a listener or emitter of an event the table does not list.
3. **The API table.** One interface per module's API, declared next to the pure code it fronts where that exists, or in `src/core/api.ts` where it does not, and one `AppApi` type that maps each `app.api` name to its interface. TypeScript modules reach other modules through that type and nothing else: remove the two Unresolved entries (`src/edge/sync.ts` hands the whole hunter API to `room-events.ts`: give it the narrow typed slice it needs; `src/views/hunter.js` reaches `app.api[n].bonuses` through a computed name: make the list of bonus providers explicit). For the JavaScript views, extend the map's test: every member a view uses must be in the interface of the API it belongs to, and every member an interface declares must be registered by its module (so the interface, the registration and the uses cannot drift). The test's allow lists should now be empty or nearly so; say why for anything left.
4. **The map.** `docs/dependency-map.md` gains, for each event, its payload type, and for each API member, its signature from the interface. Regenerate it. Regenerate the state charts if a machine's files moved.
5. **AGENTS.md.** Replace the prose that this unit makes redundant with the tables it points to, and keep it short: one recipe "To add an event" and one "To add an API member" (the table entry, the registration, the use, `bun run deps -- --write`). The owner's rule from the pstack author: prefer a type or a check over a paragraph of instructions. If a sentence in AGENTS.md describes something the typecheck or a test now enforces, shorten it to a pointer.
6. Run `bun run test` and the full `E2E_CHROMIUM=/opt/pw-browsers/chromium bun run ci` once at the end and quote its last lines.

## Rules for this unit

- What a player or GM sees does not change.
- No parallel old and new paths: when a member is typed, its callers use the typed name in the same commit; when one is deleted, nothing refers to it.
- Do not convert a view to TypeScript and do not restyle one. A view changes only where it registers, calls or listens.
- Do not weaken `tests/deps.test.ts`. An allow list entry may only leave.

## Done means

- `bun run ci` passes. Final reply under 200 words: how many API members and events were deleted and how many remain, what is left in the allow lists and why, the two Unresolved entries' fate, the last lines of `bun run ci`, anything you were unsure of or left out.

If a step turns out to be wrong or much larger than it reads, stop, write why in the notes file and reply. Do not widen the task. If you are still going after about 75 minutes of work, commit what passes, write exactly where you are in the notes, and reply.
