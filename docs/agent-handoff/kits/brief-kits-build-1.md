# Brief: kits, build units 1 to 6 (rules and types, stacks, formula names, rest uses, worth, resolve)

One helper (Opus, heavy-writer), in your own worktree on a branch off the commit you start at. Core only: `src/core`, `tests/*.test.ts`, `tests/models`, `scripts/charts`, docs. You touch no file under `src/views` except where the typecheck forces a one-line change (name each in the notes); other helpers are rewriting the views. No browser runs. Commit after each unit (`git commit -m "..." -- <paths>`, plain message, no AI attribution). No push, no helpers, never `git checkout`/`stash`/`reset` a file, never edit `.claude/skills`, no new dependency. Checks after each unit: `bun run typecheck` and the whole `bun run test` (it includes the lint tests and the balance simulation; both must hold).

Read in full: `AGENTS.md` (its recipes are the way each thing is added: a status op, a rule number, a formula name, a field of a saved thing, a machine), `docs/agent-handoff/kits/owner.md` (his words), `docs/agent-handoff/kits/design.md` (the design you build: sections 1, 2, 3, 5.3 and 8.0; sections 8.1 on are a later unit, but do not build anything they would have to undo), `kits/notes-design.md`, `kits/notes-design-2.md`, `bun scripts/kits-paper.ts`, `docs/agent-handoff/rw/principles.md`, the skills `principle-type-system-discipline`, `principle-model-the-domain`, `principle-explain-the-number`, `principle-prove-it-works`, `unslop`.

## Why

the owner, the GM: "Glas type kits to be makeable", "they must all be balanced properly, and everything must be defined with a state tree where applicable", "everything must be explicit. Everything." There is no instant kill: the execute is the scalers of 8.0. He checks nothing until the site is live.

## Steps

Units 1, 2, 3, 4, 5, 6 of design 5.3 in that order, each as the design writes it, each ending in the test file the table names, with these additions:

- Unit 1 also lands the scalers' rule numbers of 8.0 in `RULES.fight` with their reasons.
- Unit 3 includes the scalers of 8.0: the tick by the tick recipe in `ability-kinds.ts` (`Ticks`, `defaultTicks`, `recommended`, `ticksOf` round trip), the suggested start and scale per kind as a pure function the maker will call, and `describeAbility`'s sentence ("up to +40% against a target under half HP"). The formula field's control in `maker.js` is NOT yours: leave a line in the notes for the maker unit.
- Every thing with states gets its `TABLE` now where the design's section 2 gives one for a unit you build (the stacking status's life in unit 2), with its chart entry and walk events, so `tests/statecharts.test.ts` stays green (`bun run charts`).
- The existing balance rows must not move: nothing built in uses the new blocks yet. If a row moves, you changed an old rule: find it.
- Where the design is wrong or silent, choose, write the choice and its reason in `docs/agent-handoff/kits/notes-build-1.md`, and correct `design.md` in the same commit so the file stays true.

Close: `bun run deps -- --write`, `bun run charts`, typecheck, the whole `bun run test`; AGENTS.md rows and recipes for what now exists. Commit.

Time: three and a half hours. If time runs short stop at a unit boundary. Reply in at most 250 words: branch, worktree path, commit range; units done; each check's last line; where you departed from the design and why; what the next unit must know.
