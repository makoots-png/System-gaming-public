# Brief: kits, build units 7 to 14 (triggers, delayed, zones, summons, limited uses, doc, machines, simulation)

One helper (Opus, heavy-writer), in your own worktree, on a branch started at the local branch `kits` (units 1 to 6). Everything in `brief-kits-build-1.md` holds: its rules, its reading list, its checks, its "Why". Read also `docs/agent-handoff/kits/notes-build-1.md` in full ("what the next unit must know" and each departure from the design; `design.md` on that branch is corrected to match).

Build units 7, 8, 9, 10, 11, 12, 13, 14 of design 5.3 in that order, a commit each, each ending in its test file, typecheck and the whole `bun run test` green after each.

- Unit 7 sets `kills` and the chain depth; unit 9 the zone price; unit 11 the per-use gate and `Body.used`; unit 12 lists the refusals `gated`, `hp`, `stacks` in the doc's `TABLE_REFUSALS`.
- Unit 12 changes the room doc: do the size arithmetic above `DOC_MAX` in `protocol.ts` with the stack counts and a summon's row; `DOC_ROWS` is 30 by the design. `tests/server-rooms.test.ts` and `tests/protocol.test.ts` hold.
- Unit 13: every machine of design section 2 has its `TABLE`, its chart in `scripts/charts/`, its entry in `MACHINES`, its walk events; the model's random play uses the blocks; the invariants (depth bounded, fires bounded, a summon never keeps a side up, no count over its cap, HP price never kills).
- Unit 14: the three example kits as builds (a stacker with the scalers in place of an execute, a mark and detonate caster, a counter-spending bruiser) and the rows of 3.2. Every old row stays where it is. A new row outside its bound is fixed by a number in `RULES.fight.kit` with its reason and a line in `docs/agent-handoff/rw/sim-log.md`, never by loosening the bound. Unit 14 green is the gate for the makers.
- You touch no file under `src/views` except a one-line change the typecheck forces (name each in the notes). No browser runs.

Close: deps, charts, typecheck, the whole `bun run test`; AGENTS.md rows and recipes; notes in `docs/agent-handoff/kits/notes-build-2.md` with what the makers unit and the table unit (15 to 17) must know. Commit.

Time: four hours; stop at a unit boundary if short. Reply in at most 250 words: branch, worktree, commit range; units done; each check's last line; the simulation's kit rows (numbers); departures from the design; what is left.
