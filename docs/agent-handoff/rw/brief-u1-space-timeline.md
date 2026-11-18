# Brief, unit 1: `space.ts` and `timeline.ts` (two pure modules and their tests)

One helper (Opus, heavy-writer), in your own git worktree (not the main tree). Commit after each numbered step (plain message, no AI attribution, no Co-Authored-By; this overrides "do not commit" in your built-in text). Do not push. Do not start helpers. Never edit `.claude/skills`. Do not run `bun run ci` or Playwright. Your checks are `bun run typecheck` and `bun test tests/space.test.ts tests/timeline.test.ts tests/lint.test.ts`. Run `bun install` once in your worktree.

You create only these files: `src/core/combat/space.ts`, `src/core/combat/timeline.ts`, `tests/space.test.ts`, `tests/timeline.test.ts`, `docs/agent-handoff/rw/notes-u1.md`. You change no existing file. If you believe an existing file must change, stop and say so in your reply.

Read first, in full: `AGENTS.md`, `docs/agent-handoff/rw/principles.md` (and the leaf skill of each row your work touches: model-the-domain, type-system-discipline, boundary-discipline, foundational-thinking, test-behavior-not-implementation, minimize-reader-load, laziness-protocol), `docs/agent-handoff/rw/design.md` (the summary, sections 1, 3.1 rules 5 to 8 and 19, 4.6 and 5), `scripts/rw-paper.ts` (its `PAPER` constants and the functions that print sections 1 and 5; your code must give the same numbers), `tests/encounter.test.ts` (the style to copy), `.claude/skills/unslop/SKILL.md`.

## Why (the owner's goal)

the owner is the GM of a tabletop game played on phones. He is reworking the fight so that turns come from speed and every combatant has a real place on a grid, and he asked for an architecture that stays "ROCK solid": "everything is defined, easy to find". The design is on paper in `rw/design.md`. These two modules are the first of the real rules: who acts next, and where things are. A later unit's reducer and a balance simulation call them. No screen changes.

## Steps

1. **Types first** (foundational-thinking). In `timeline.ts`: a branded `Tick`, the per-combatant timeline value (`at`, `speed`), the cost of an action. In `space.ts`: a branded or structural `Place` that cannot be confused with a size, a `Shape` union (touch, line, radius with an optional ring) exactly as design 3.3 sketches it, a `Grid` (size, and room for walls and terrain as design 5.3 says, so that a later unit adds a terrain by adding a cell and not by changing a signature). Rule numbers (the 1000 ticks of a round, the costs, the tile's 5 feet, the default lines 8 tiles apart) come in as a parameter object whose type you export (`TimelineRules`, `SpaceRules`); a later unit passes `RULES.fight`. Do not import `scripts/rw-paper.ts`. Commit the types with `bun run typecheck` green.
2. **`timeline.ts`**: pure functions, each a few lines, for design section 1: `interval(speed, cost)`, the opening time from a d20 the caller passes in, `before(a, b)` with the design's tie rule, `next(rows)`, `ahead(rows, n)` (the order ahead that phones draw), acting (`at += interval`), a change of speed that rescales the wait left, the stun floor, the extra-turn refund, a delay, joining mid-fight. No `Math.random`, no module-level `let`. `tests/timeline.test.ts`: every expected value comes from the rule in the design or from the tables `bun scripts/rw-paper.ts` prints for section 1 (turns in a fixed span for speeds 80, 100, 130, 200, and the sample five-combatant sequence), typed in as literals; plus properties over a seeded generator (copy `rng` from `tests/models/fight-play.ts` by import): `next` is always the lowest `at` under the tie rule, `ahead` is what repeated `next` and act gives, a slow never brings a turn nearer, a haste never pushes it later, two combatants of equal speed alternate. Commit.
3. **`space.ts`**: the 5-10-5 distance, `tilesOf(shape, from, aim, grid)` with one cell per member of `Shape` (the typecheck must ask when a member is added: use an exhaustive switch with a `never` check), who is in a shape, the ring, the default places for two sides with no map (two lines 8 tiles apart on the same data), reachable tiles within `n` steps around bodies and walls and the path cost, and the choice design 3.1 rule 8a makes (the best tile within `can` steps: out of the shape, else in the ring, else nearest to out; ties by fewest steps, then lowest `y`, then `x`). `tests/space.test.ts`: distances and shapes from the design's worked examples and section 5 tables as literals, each shape on a small drawn grid (write the grid as rows of characters in the test so a reader sees it), and properties: distance is symmetric, a tile is in a radius exactly when its distance is at most the radius, the chosen tile is never worse than staying, a rooted target (0 steps) stays. Commit.
4. **Check and notes.** `bun run typecheck`; `bun test tests/space.test.ts tests/timeline.test.ts tests/lint.test.ts` (the lint tests keep `src/core` pure). In the notes: the exported names of each module with one line each, any place the design was unclear and what you chose, which principle changed a choice. Commit.

## Rules

- Pure core TypeScript, strict, no `any`, no dependency, no existing file changed.
- No validation inside these functions (boundary-discipline): they trust their types. Parsing a place from a save or a room message is a later unit.
- A test's expected value never comes from running the code under test.
- Smallest thing the design needs (laziness-protocol): no pathfinding beyond what rule 8a and movement need, no line-of-sight unless the design's section 5 asks for it now.
- Plain whole sentences in notes and comments; comments only for a why the code cannot show.

## Done means

The two modules and two test files, typecheck and the three test files green, four commits, your worktree clean.

## Time

60 minutes. Reply in at most 200 words: your worktree path and branch, the commit range, the exact last line of the test run, and anything in the design you had to decide.
