# Brief: the audit of everything implicit (read only, one file)

One helper (Opus, heavy-writer). You change no code and no test. You write `docs/agent-handoff/final/implicit-audit.md` and commit it with `git commit -m "..." -- docs/agent-handoff/final/implicit-audit.md` after each numbered step (plain message, no AI attribution). No push, no browser runs, no `bun run test` (other helpers are using the box and editing `src/views`; read what is committed: use `git show HEAD:<path>` for any file that `git status` shows modified, so you never read a helper's half-written file). Never `git checkout`/`stash`/`reset`.

Read first: `AGENTS.md` in full, `docs/agent-handoff/START-HERE.md` (the sections "Everything explicit" and "The problem, not the symptom"), `docs/state-machines.md` (the machines that are explicit today), `tests/lint.test.ts` (what is already held), `docs/agent-handoff/final/notes-roundtrip.md` and `notes-roundtrip-b.md` (the save's writes were made explicit yesterday; do not redo that), the skills `principle-model-the-domain`, `principle-type-system-discipline`, `principle-boundary-discipline`, `unslop`.

## Why

the owner, the GM, after a bug where unconfirmed points were two lists compared in a view: "everything must be explicit. Everything." and now "Where else might be have implicit state machines or other impliciteness? We must root them out and rectify them." The save's writes are now named core steps. What is left is state that lives outside the save and outside the explicit tables, and rules that hold only by convention. He wants the full list, then every item fixed at its cause.

## What counts as implicit (look for each)

1. **A machine written as flags.** Two or more booleans, a nullable field, a string compared in several places, or a timer handle whose combinations mean states ("quiet", "busy", "pending", "dirty", "open", "g.kind"). Where: closures and module state in `src/views/*.js` and `src/views/*.ts`, `src/edge/*.ts`, `src/app.js`, `src/sw.js`, `server.ts`.
2. **A lifecycle with no table.** A thing that is made, changes and ends, whose states are only implied by which fields are set: an item (held, worn, used up, sold), a daily and the day's rollover, a reward (given, shown, acknowledged), a use reported to the GM, a room on the server (made, keyed, idle, expired), a room event's id (seen, applied), a window (opening, open, leaving), a maker (clean, edited, blocked, saving), onboarding's steps, the app update (none, installing, waiting, reloading), an import or export, the store (loading, repaired, backed up, full), a sheet push, the forget queue, the hidden-page poll, a typed roll, the map's gestures and its select, pick, aim, confirm flow, a toast.
3. **A rule held by convention.** An order of calls that must be kept, a field that must be updated with another, an invariant no type or test states ("stats never below locked"), a default applied in more than one place, a bound written as a literal, a role checked in a view, a time read from the clock in a view or core.
4. **A value stored that is derived**, or two copies of one fact that can disagree.
5. **A stringly or loosely typed thing**: an id, a key, a kind or a status passed as `string`; `any` in core or edge; a parse that trusts its input.
6. **An effect of looking**: anything that changes state because a screen was opened, left, hidden or redrawn.
7. **An error swallowed**: an empty `catch`, a `.catch(() => {})`, a fallback that hides a failure from the player and the log.
8. **Timing by sleep**: a `setTimeout` or interval that stands for "after that finishes".

## Steps

1. **The inventory.** Go file by file through `src/views`, `src/edge`, `src/app.js`, `src/sw.js`, `server.ts`, then `src/core` (for kinds 3, 4, 5). For each finding one row: file and line, the kind (1 to 8), what the hidden states or rule are in one sentence, what a player or GM would see if it went wrong (or "nothing: internal"), and how sure you are. Use grep to be complete (`let `, `setTimeout`, `setInterval`, `catch`, `: any`, `as any`, `Date.now`, `isGM`, `hidden`, `=== '`), then read around each hit; do not list a hit you have not read. Commit.
2. **The judgment.** For each row: a machine (a `TABLE` in core with a chart, like the others), a typed union in place of flags, a pure function with a test, a lint rule, delete it, or leave it with the reason (a plain UI value such as which tab is lit is not a machine; say so and move on). Group the rows into units a helper can do in two to four hours, each naming its files (so units can run in parallel without sharing files), its tests and what it deletes; order them by what a player would notice first. Say which lint tests would keep each class from coming back (for example: no module or closure `let` boolean pairs in a view outside a declared state union; no empty catch; no `setTimeout` in a view outside `motion.ts`). Commit.
3. **The summary** at the top: the count by kind, the ten most likely to bite a player, the units in order, and what you did not read and why. Under 400 lines in all. Commit.

Time: two and a half hours. Reply in at most 250 words: the commit range, the count by kind, the ten worst, the units.
