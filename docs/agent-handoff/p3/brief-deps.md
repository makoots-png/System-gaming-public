# Brief: the dependency map (M8, unit 1)

Read `AGENTS.md` and `docs/agent-handoff/helper-rules.md` first (its last section names the principle skills: here `principle-build-the-lever`, `principle-encode-lessons-in-structure`, `principle-minimize-reader-load`, `principle-prove-it-works`, and `unslop` for the generated text). Where this brief and the rules differ, this brief wins.

You work in your own git worktree (your current directory) on your own branch. First run `git log -1 --format=%H`; if it is not the commit your prompt names, `git reset --hard <that commit>`. Then `bun install`. Commit after every numbered step (name the files you add, plain messages, no AI attribution lines). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Other helpers are changing app code in other trees. You create only `scripts/deps.ts`, `tests/deps.test.ts`, `docs/dependency-map.md` and your notes file `docs/agent-handoff/p3/notes-deps.md`, and you add lines to `AGENTS.md` and `package.json` (`scripts`). You change no file under `src/`.

## Why (the owner's goal)

"It should be stupidly easy to add or change features, with a very clear trace to whatever they depend on or what depends on them." The import graph is easy to see. Two other kinds of dependency are invisible today:

- `app.api.<name>` is an object each view fills at runtime (`app.api.combat = { ... }`, `A().hunter.damage(...)`, `api.sync.send(...)`). Nothing shows who calls `app.api.combat.add`.
- Events are strings: `app.emit('combat:turn', ...)` is heard by `app.on('combat:turn', ...)` in three other modules, and by `sync:status`, `change` and so on.

A later unit makes both typed. This unit makes them visible first, with a tool, so the typed version has an exact list to start from and so the trace exists as a file anyone can read.

## What to build

1. `scripts/deps.ts`, run as `bun scripts/deps.ts` (add `"deps": "bun scripts/deps.ts"` to `package.json`). It reads every file under `src/` and `server.ts` as text (no parser dependency: regular expressions over the patterns this codebase uses, which you first list by grepping: the ways a module registers its API, the aliases views use for `app.api` such as `A()`, `api`, `app.api`, `S`, `sy`, `Y()`, and the forms of `emit` and `on`). For each module it collects:
   - what it imports (module paths), and who imports it;
   - the API it provides (`app.api.<name>` and each function name on it), and for each function, which modules call it;
   - the API functions it calls on other modules;
   - the events it emits and the events it listens to, by name; and for each event, emitters and listeners;
   - the saved fields it writes through `store.update` where that can be read off cheaply (top-level save keys only, such as `encounter`, `gates`, `hunters`, `settings.sync`).
   Modes: `bun scripts/deps.ts` prints the whole map as Markdown; `bun scripts/deps.ts <module or api or event name>` prints just that entry with both directions (depends on, depended on by); `--write` writes `docs/dependency-map.md`; `--check` exits non-zero when the committed file differs from what it would write.
   Anything the patterns cannot resolve (a computed event name, an API reached through a variable the script cannot follow) goes in an "Unresolved" section with file and line. Do not guess, and do not hide them: that list is what the typed version must remove.
2. `docs/dependency-map.md`, generated. Sections: layers (core, edge, views, server) with the import rule each obeys; one entry per module; one entry per `app.api` name; one entry per event; unresolved. Sorted, stable, no timestamps, so a diff shows only real changes. Plain sentences in the fixed text.
3. `tests/deps.test.ts`: the committed map is current (`--check`); every event that is listened to is emitted somewhere and the reverse, except a short named allow list with a reason each (for example an event only the tests use); every `app.api` function that is called exists in what its module registers. Where these find real problems today (a listener for an event nobody emits, a call to an API function that does not exist, dead API functions nobody calls), do not fix the app: list them in the notes with file and line, and put the current ones in the allow list with the reason "found by the map, to be fixed in the typed API unit", so the test passes today and fails on any new one.
4. Prove the tool on three known cases and record the output in the notes: who hears `combat:turn`; who calls `app.api.combat.add`; what `src/views/gates.js` depends on and what depends on it. Check each against a grep by hand.
5. `AGENTS.md`: a short section "Finding what depends on what" (the command, the file, and that the map must be regenerated with `bun run deps -- --write` when a module's imports, API or events change), and name the test.

## Done means

- `bun run test` passes. Final reply under 200 words: your worktree path and branch, commit hashes, counts (modules, API names and functions, events), the number of unresolved entries, and the real problems the map found.

If a step turns out to be wrong or much larger than it reads, stop, write why in the notes file and reply. Do not widen the task.
