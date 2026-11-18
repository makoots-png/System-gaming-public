# Brief: the compiler reads the views (M8, unit 5)

Read `AGENTS.md` and `docs/agent-handoff/helper-rules.md` first (its last section names the principle skills: here `principle-type-system-discipline`, `principle-prove-it-works`, `principle-laziness-protocol`, `principle-fix-root-causes`, `principle-encode-lessons-in-structure`). Where this brief and the rules differ, this brief wins.

You work in the repo root on the branch that is checked out. No other helper is running. Commit after every numbered step (name the files you add, plain messages, no AI attribution lines). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Browser runs: `E2E_CHROMIUM=/opt/pw-browsers/chromium E2E_PORT=3241 bunx playwright test tests/e2e/<file> --workers=1 --trace off --output=/tmp/pw-views`. Never run `playwright install`.

Notes file (append a line after each commit): `docs/agent-handoff/p3/notes-check-views.md`.

## Why (the owner's goal)

"It should be stupidly easy to add or change features, with a very clear trace to whatever they depend on or what depends on them." The core is strict TypeScript. Every machine, the room protocol, the `app.api` contracts (`src/core/api.ts`) and the events (`src/core/events.ts`) have typed definitions. But the twenty view modules in `src/views/*.js` and `src/app.js` are plain JavaScript that the typecheck does not read. So a view can call a core function with the wrong arguments, pass a wrong payload to an event, or call an API member with the wrong shape, and nothing fails until a browser test happens to cover it. The last unit could only check API and event use by name. The types exist; the compiler just is not looking.

Converting 8,000 lines of DOM code to strict TypeScript is not this unit. This unit makes the compiler check the views as JavaScript, loosely, so that every call from a view into typed code is checked against the real signature.

## What to build

1. **Measure first.** Add a second config, `tsconfig.views.json`, that extends the main one and checks `src/views/**/*.js` and `src/app.js` with `checkJs` on and the strictness that fights untyped DOM code turned off (start with `strict: false`, `noImplicitAny: false`, keep `strictNullChecks` off at first). Give each view's `register(app)` its type with one JSDoc line (`/** @param {import('../core/api.ts').App} app */`, or whatever the typed app object is called; create that `App` type next to `AppApi` if it does not exist: `api: AppApi`, typed `emit` and `on`, `store`, `ui`, `rules`, `isGM`, `go`, `keys`, `registerView`, `registerPanel`, and the rest of what `src/app.js` puts on it). Run `bunx tsc -p tsconfig.views.json --noEmit` and record in the notes the error count by error code and by file. Do not fix anything yet.
2. **Sort the errors** in the notes into: (a) real mistakes (a wrong argument, a member that does not exist, a payload missing a field, a possibly wrong type passed to core); (b) the typed side being wrong or too narrow (an interface in `api.ts` that does not match what the module really does: fix the interface, it was only ever checked by name); (c) noise from untyped DOM code that says nothing about a contract. Decide the config from the data: turn off, in the config, the checks that produce only category (c), and say which and why. Do not silence anything with `// @ts-ignore`, `// @ts-expect-error`, `// @ts-nocheck` or `any` casts in the views. If one check gives mostly noise but also real findings, keep it and fix the noise at its source with a small JSDoc type where the value enters the view (for example the element lookups a view does once).
3. **Fix** (a) and (b). Each real mistake found is a bug or a latent one: for each that a player or GM could hit, write the failing test first (`tdd`), then the fix, and add it to `docs/agent-handoff/p3/bugs-found.md`. For the rest, fix and list in the notes.
4. **Make it part of the checks.** `bun run typecheck` and `bun run test` run both configs, so does `scripts/ci.ts`. A view that calls typed code wrongly now fails the build.
5. **Tighten as far as it pays.** Try `strictNullChecks` for the views. If the errors are mostly real (a store lookup that can miss, an optional API), fix them and keep it on. If they are mostly DOM lookups, leave it off and say so with the numbers. Same for `noImplicitAny` on function parameters that receive typed values (an event payload, a store update callback's `d`): prefer giving the app's typed helpers generic signatures so those parameters are inferred, over annotating every callback.
6. Update `scripts/deps.ts` only if the compiler now checks something its test also checks: keep one check per rule (the compiler where it can, the map's test where it cannot), and remove the duplicate. Update AGENTS.md in two or three sentences: what the compiler checks in a view and what it does not.
7. Run `bun run test` and the full `E2E_CHROMIUM=/opt/pw-browsers/chromium bun run ci` once at the end and quote its last lines.

## Rules for this unit

- What a player or GM sees does not change, except where a real mistake is fixed.
- Views stay `.js`. No restyling, no restructuring.
- The measure of success is not zero errors by any means: it is that every call from a view into typed code (core functions, `app.api`, events, the store) is checked against the real signature, with no suppression comments.

## Done means

- `bun run ci` passes with both configs in it. Final reply under 200 words: errors at the start by category, what the config turns off and why, the real mistakes found (one line each), whether `strictNullChecks` stayed on, the last lines of `bun run ci`, anything you were unsure of or left out.

If a step turns out to be wrong or much larger than it reads, stop, write why in the notes file and reply. Do not widen the task. If you are still going after about 75 minutes of work, commit what passes, write exactly where you are in the notes, and reply.
