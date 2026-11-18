# Phase 3 plan (architecture pass)

Written Nov 11 by the first phase 3 lead. Each milestone is one lead session. Update the "Status" column when a milestone ends. Decisions and evidence go in `decisions.tsv`.

## Goal

the owner's top priority: the project grows by many small additions, so each kind of addition needs one obvious place, a type that fails to compile when the addition is incomplete, a test template to copy, and a recipe in AGENTS.md. Implicit state machines become explicit unions with one pure reducer each. Nothing ships until the end of phases 3 and 4.

## Target layout

```
src/core/      pure, strict TS, no DOM, no store, no fetch
  protocol.ts          room message types and parsers, shared with server.ts
  save.ts              parse and one-way migrate a save at load
  role.ts              GM role derived in one place
  combat/encounter.ts  Encounter union and reduce(enc, cmd) -> {enc, effects[]}
  gates/gate.ts        transition(gate, event), payout
  hunter/vitals.ts     Up | Dying | Stable | Dead, penalty, jobChain
  sync/link.ts         link machine and push machine
  registry/            statuses, items, monsters, gates, jobs, paths and perks, rules
src/edge/      store, network, service worker glue
src/views/     DOM modules (JS under allowJs until a rewrite touches one)
server.ts      Bun.serve edge around a pure handler
tests/*.test.ts        bun tests (pure core, server handler, lint-style checks)
tests/e2e/*.e2e.ts     Playwright (named .e2e.ts so bun test does not pick them up)
tests/templates/       one test template per kind of addition
```

Browser delivery: `bun build` makes one bundle in `dist/`. The server builds at start. A static host can serve `dist/` (no rooms). The build hash names the service worker cache and is sent in the version handshake.

## Milestones

| # | Milestone | Status |
|---|---|---|
| M1 | Safety net: package.json, tsconfig, bun tests for what is pure today, behaviour checks ported to Playwright, CI green on the branch | done Nov 12. 57 bun tests, 70 browser tests (3 fixme) in 11 files. CI is local: `bun run ci` plus a pre-push hook, GitHub workflow removed (the owner's decision). AGENTS.md started |
| M2 | Move modules to `src/`, bundle with `bun build`, sw.js versioning from the build, version handshake (server check, clean client upgrade, tested), save parse and one-way migration, store types, single GM role (item 7) | Done Nov 12, pushed at 928054f. Move and bundle, worker from the build, build handshake (2365062 to cafbb15). Single GM role `roleOf` in `src/core/role.ts`, every room has a GM key (fc2f4a6, 8c9da9a). Typed save parser `src/core/save.ts`, schema 3, one-way migration from v2 and v1 (c4d55ba to 2284b6a). Store is `src/edge/store.ts` and asks core for the shape and the load decision; bug 3 fixed (a0863d1 to 068dd6d). See handoff.md |
| M3 | Combat reducer (item 1), status registry, effects carry their source, monster Up or Down | Done Nov 12. Status core and registry (470c3e6 to 8ab1337, bug 4 fixed), rules global out of core (e8f50c9), reducer with a model test (6f92896 to 5fa22e5), `combat.js` on the reducer with one dispatcher and a lint rule (6510b4a to dcda27a). 336 bun tests, 79 browser tests (1 fixme). See handoff.md |
| M4 | Gate transition table and payout (item 2). Reproduce the three suspected bugs as failing tests first | Done Nov 12. All three suspected bugs were real (bugs 5, 6, 7), reproduced as failing browser tests first, fixed by the model. `src/core/gates/gate.ts`: `Gate` union, typed transition table, `can`, `gateXp`, `xpDue`, `fightAward`, `parseGate`; lint rule; AGENTS.md recipe. 423 bun tests, 82 browser tests (1 fixme) |
| M5 | Protocol types, server validation with hostile-input tests, one parse-and-apply registry, award and quest deduped by event id | Done Nov 12. `src/core/protocol.ts` (branded ids, `RoomEvent` union, `EVENTS` and `DOCS` tables, `parseSheet`, `RoomState`), the server stores only what the parsers accept, `src/edge/room-events.ts` has one typed applier per event, `newEvent` is the only event constructor, applied ids ring makes award, quest, hp and status apply once across reload and rejoin. 612 bun tests with the M6 machines |
| M6 | Link machine and push machine (item 3), breadth-first model check in a bun test, the 14 deferred sync findings as reducer tests | Done Nov 12. `src/core/sync/link.ts`, `push.ts`, `connection.ts`, `invite.ts`; `src/edge/sync.ts` (strict) runs on them and replaces `sync.js`; model check over 12,716 state pairs; 9 of 14 findings are reducer tests, 3 fixed where they live, finding 8 half fixed, 12 and 14 open (see handoff.md). Popup-delay lever and 15 s action timeout for the browser suite |
| M7 | Hunter vitals (item 4), penalty (item 5), job chain (item 6) | Done Nov 12. `src/core/hunter/progress.ts` (points derived, bug 1 fixed), `vitals.ts` (life union with Dead, `settle()` deleted), `penalty.ts` (one store), `job-chain.ts` with `src/core/registry/jobs.ts` (failed state, reissue); a GM-only revive room message. 843 bun tests, 94 browser tests, no fixme |
| M8 | Room system model test over several devices and the real server handler. State charts generated from the machines (`docs/state-machines.md`, see "charts generated from the real machines"). Typed `AppApi` and event table, dependency map script and test (see "traceable dependencies"). Registries for items, monsters, gates, jobs, perks, rules, UI panels. Test templates. Lint-style checks. AGENTS.md. shots.mjs at three sizes. Report | Done Nov 12. Dependency map and state charts (generated, kept current by tests), the room system model test, typed `AppApi` and events with 39 dead API members and 4 unheard events deleted, the compiler checks the views, content tables for items, monsters, paths, gate spawning and the rules' relations, the sweep (18 entries, 4 bugs fixed, `sync.ts` split, AGENTS.md cut to 123 lines), the screenshot comparison, the Architecture section. One sweep entry (the fight's 12 s grace window) is handed to the next lead. 1,285 bun tests, 100 browser tests |

Phase 4 (status scaling) follows as its own brief and builds on M3.

## Added Nov 12 (the owner): traceable dependencies

"A very clear trace to whatever a feature depends on or what depends on it" is not met by a layout rule alone. Two kinds of dependency are invisible today, and M8 makes both explicit:

- `app.api.<module>` is a bag filled at runtime, so nothing shows who calls `app.api.combat.add`. Target: one typed `AppApi` (each module's API is an interface next to its code) and a lint check that a view only calls what the interface names.
- `app.emit` and `app.on` with string names (`combat:turn` is heard by skills, custom and bestiary). Target: one typed event table (name, payload, who emits) and typed `emit` and `on`, so a rename or a payload change fails the typecheck in every listener.
- A script (`bun scripts/deps.ts`) prints, for a module, what it imports, which APIs it calls, and which events it emits and hears, and the reverse. A test keeps a committed map (`docs/dependency-map.md`) current, so the trace is one file to read and cannot go stale.

Each milestone before M8 already moves its own domain toward this: its state is a union with one reducer, and its effects are data the edge carries out.

## Added Nov 12 (the owner asked about state trees): charts generated from the real machines

Every machine gets a chart a person can read: nested states where a state has sub-states (the link's `live` with its health, `idle` with what is known about the server), parallel regions where two machines run side by side (link and push), arrows labelled with what the player or GM does or sees. The charts are generated from the real reducers and tables, not drawn by hand and not from a second spec: `scripts/statecharts.ts` walks each machine the way its model test does, a small view per machine gives the reader's words for each state and step (the idea of the `statechart` skill's view module), and it writes Mermaid into `docs/state-machines.md`. A test keeps the file current, so a new state or transition shows up in the chart or fails CI. The Architecture report embeds these. This keeps the owner's Nov 11 decision (model-check the real reducers, no TLA+) and gives the readable chart the `statechart` skill is for.

## Added Nov 13 (the owner asked whether a formal verification skill would help): a room system model test

Each machine has a model test of its own, on one phone. Nothing yet explores what several devices do together: a GM phone, player phones and the server, with polls, pushes and events delivered in any order, lost, repeated, and with a reload or a leave and rejoin in between. That is where a formal model earns its place, and it is the part a TLA+ skill would cover. M8 builds it on the real code instead: `tests/room-system-model.test.ts` runs the real link and push reducers for two or three phones against the real server handler (called in process, memory store) under a scheduler that explores the interleavings to a bound, and checks rules about the whole room: a GM event is applied on its target phone exactly once; a phone that was removed never keeps acting as a member; two phones never both hold one hunter's sheet; when the network is quiet every phone ends up showing the same roster and the same fight; a changed sheet reaches the GM. A TLA+ skill per subsystem stays an option for the owner after launch if he wants proofs over unbounded time (it needs Java and TLC, and a spec that can drift).

## Standing constraints

- No new deps beyond `typescript` and `@playwright/test` (dev only). No `@types/bun`: hand-written ambient types in `types/`.
- No AI attribution in commits. unslop style for commit text.
- Never commit `.claude/`.
- At most 3 browser-driving helpers at once (the box has about 2.7 GB free memory).
- No adversarial review rounds. Prove each unit with a run.
- CI is `bun run ci` on this box, run by the pre-push hook. There is no hosted CI.
- The box pauses for minutes at a time (`p3/stall-investigation.md`). A browser failure across a pause is not evidence.
