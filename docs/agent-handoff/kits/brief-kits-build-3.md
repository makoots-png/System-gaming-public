# Brief: kits, build wave 2 in core (units 18 to 29), and what the dice branch left

One helper (Opus, heavy-writer), in your own worktree, on a branch started at the local branch `kits` (wave 1 units 1 to 14 and the Roll20 dice notation, merged; 2,647 tests pass). Everything in `brief-kits-build-1.md` holds: its rules, reading list, checks and "Why". Read also `kits/notes-build-1.md`, `kits/notes-build-2.md` and `kits/notes-dice.md` in full, and design.md section 8 (on the `kits` branch it is corrected to what was built).

First, three leftovers, one commit:
- `fight-parse.ts` keeps a stored formula's dice modifiers and `fn` nodes (`diceModsOf` is ready; notes-dice.md "Needed next"), with cases in its test and in `tests/save.test.ts` (an ability with `2d20kh1` and `floor(...)` survives a save and a room doc).
- `RULES.dice.maxDice` is 100 (the owner was told 100 dice a term); its reason beside it.
- Whatever `notes-build-2.md` lists as left that is core (not unit 15's parsers, not views).

Then units 18 to 29 of design 8.12 in an order the "After" column allows, a commit each, each ending in its test file, typecheck and the whole `bun run test` green after each:
- Unit 19 (scalers): much was built in wave 1's unit 3 with 8.0; finish what 8.12 still names.
- Unit 22 (edges and held dice): an edge is the dice term `2d20kh1` and its opposite `2d20kl1` through the one parser (`withEdge`), not a second rule.
- Unit 26 (reactions) adds a room message (`arm`) by the room message recipe: `Payloads`, `DEFS`, `APPLIERS`, `VALID` in `tests/protocol.test.ts`, the refusal in `tests/server-rooms.test.ts`, the GM move in `tests/models/room-world.ts`.
- Unit 28: every machine of 8.9 has its `TABLE`, chart, `MACHINES` entry and walk events; the model's invariants of 8.10 (no unbounded turns: at most one extra action a round; a reaction fires at most once between turns; advantage and its opposite cancel; a shoved body never ends in a wall or on a body).
- Unit 29: the simulation's rows of 8.10. Every old row and wave 1's kit rows stay where they are. A new row outside its bound is fixed by a number in `RULES.fight.kit` with its reason and a line in `docs/agent-handoff/rw/sim-log.md`, never by loosening a bound.
- No file under `src/views` except a one-line change the typecheck forces (name each). No browser runs.

Close: deps, charts, typecheck, the whole `bun run test`; AGENTS.md rows and recipes; notes in `docs/agent-handoff/kits/notes-build-3.md` with what the makers and table units (15 to 17 and 30) must know: every field a maker must offer, with its bound and its sentence. Commit.

Time: four and a half hours; stop at a unit boundary if short. Reply in at most 250 words: branch, worktree, commit range; units done; each check's last line; the new simulation rows; departures from the design; what is left.
