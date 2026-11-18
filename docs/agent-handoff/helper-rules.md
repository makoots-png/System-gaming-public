# Rules for every helper on The Hunter System (phase 3)

Repo: `the repo root`, branch `mobile-gameplay-pass`. The goal of the phase: make the codebase easy to extend through explicit state machines, typed registries and committed tests. The owner (the owner) wants each kind of addition to have one obvious place and one test to copy.

## Hard rules

- Do only the scoped task in your brief. Do not touch files outside the list your brief names.
- No new dependencies. Only `typescript` and `@playwright/test` exist as dev dependencies. No `@types/*`, no CDN. Node built-ins a test needs get a hand-written declaration in `types/bun.d.ts`.
- Do not commit, push, or run `git stash`, `git checkout` or `git reset`. Other helpers work in the same tree. The lead commits.
- Layout: browser code is in `src/` (`src/core` pure, `src/edge` store and network, `src/views` DOM modules), static files in `public/`. `scripts/build.ts` bundles them and `server.ts` builds once at start and serves only the built files. `tests/lint.test.ts` holds the lint-style rules (core imports nothing from edge or views and touches no browser API).
- Never start or kill servers by hand. Every Playwright run starts its own server on the port in `E2E_PORT` and stops it at the end. Your brief gives you a port. Always run Playwright as `E2E_PORT=<your port> bunx playwright test ...`. There is no standing dev server any more.
- If your brief is a test-only task, do not change app code to make a test pass: mark the test `test.fixme('reason')` and describe the bug in your notes file. If your brief is an implementation task, change only the app files it names.
- No retries, no blanket `waitForTimeout` to hide a race. Wait on what the player sees (`expect(locator)...`, `expect.poll`). A short fixed wait is fine only where the old script had one and nothing observable exists.
- Old saves and old servers do not need to work. Drop checks that compare against the old `main` build on `:3100`.

## Test conventions

- Pure tests: `tests/*.test.ts`, run with `bun test`. Copy the style of `tests/server-rooms.test.ts`.
- Browser tests: `tests/e2e/*.e2e.ts`, run with `bunx playwright test tests/e2e/<file> --workers=1`. Copy the style of `tests/e2e/room-sync.e2e.ts`. Import everything from `./helpers.ts`. Use the `device(label, options)` fixture for each phone. It already fails the test on any console error or warning, so do not write your own console check.
- Test names say what a player or GM observes, in plain words. One `test()` per behaviour. Use `test.step` for phases of one scenario. Tests in one file must not depend on each other's state unless wrapped in `test.describe.serial` with a reason.
- Drive the action under test through the UI (taps, fills). `hunterApp.store` and `hunterApp.api` are for setup and for reading state only.
- No comments that narrate steps. The test name and step names carry that.
- TypeScript is strict. `bunx tsc --noEmit` must pass. Callbacks passed to `page.evaluate` may use the global `hunterApp` (typed `any`).
- Never `await` inside `page.evaluate` a call that opens a `ui.system` or `ui.confirm` window. It hangs.
- At most one Playwright run at a time per helper, always with `--workers=1`. The box is shared.
- Always pass `--output=/tmp/pw-<your-file-name>` to Playwright. Each run clears its output folder at start, so two helpers sharing the default `test-results/` break each other's runs.

## The box pauses

- This machine is paused as a whole for one to several minutes at a time, many times an hour. A browser test that times out once and passes on the next run was probably caught by a pause. Run it again before you debug it, and do not widen waits or add retries because of it. Say in your notes when it happened.

## Reporting (crash-resistance)

- The API stream drops on long replies. Write your notes to the notes file your brief names as you go, in small increments.
- Your final reply is at most 200 words: what you made, the exact command and its last line of output, anything marked `fixme`, anything you were unsure of. No diffs, no long lists.
- If you are still going after 45 minutes, stop, write where you got to in the notes file, and reply.

## Added 2026-11-12

- Do not start helpers or search agents of your own. Search with grep yourself. A sub-helper's long reply counts against the crash rules.
- The worktree you get may start at `main`. If `git log -1` is not the commit your prompt names, run `git reset --hard <that commit>` on your own branch before anything else.
- The box is paused for 10 to 15 minutes at a time, often. A browser test that fails once is not a result. Rerun that file once before reading anything into it.

## Added 2026-11-12 (cloud session): the principle skills

the owner's working principles are in `.claude/skills/principle-*/SKILL.md`. Each is under a page. Before you write code, read the ones your task touches, and say in your notes which one changed a choice you made:

- New state or a new kind of thing: `principle-model-the-domain`, `principle-type-system-discipline` (a union the compiler checks, ids of different things as different types, parse outside data once at the boundary).
- Reading a save, a room message or user input: `principle-boundary-discipline` (validate at the boundary, trust the types inside, keep the logic pure).
- Any test: `principle-test-behavior-not-implementation` (the expected value comes from the rule, not from running the code; the test must fail when the behaviour breaks and pass when only the internals change).
- A refactor: `principle-subtract-before-you-add`, `principle-minimize-reader-load`, and the playbook `.claude/skills/poteto-mode/playbooks/refactoring.md`.
- A bug: `principle-fix-root-causes` (reproduce first; a guard or a clamp where it surfaced is not a fix).
- A command that can run twice (retries, room events): `principle-make-operations-idempotent`.
- Any balance figure or measurement: `principle-explain-the-number`.
- Before you say done: `principle-prove-it-works` and `principle-sequence-verifiable-units`.
- Any prose (notes, AGENTS.md, commit messages): `unslop`.
