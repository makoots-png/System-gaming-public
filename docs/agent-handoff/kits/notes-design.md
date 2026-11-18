# Notes: kits like Glas, the design on paper (brief-kits-design.md)

## Log

- Start: the worktree was at 8b41075; fast-forwarded to ee0c53d (`claude/zen-pasteur-ov4cgd`), which holds the brief.
- There is no Glas summary in `kits/`. The design takes Glas from the brief's own words only (Resonance, Rot, Vision,
  Crimson Pact, Hemoplague, an execute, delayed damage) and says so at its top.
- Step 1: design sections 1.0 to 1.11 and `scripts/kits-paper.ts` part 1 (the caps table, the doc rebuilt from the
  worst case of tests/protocol.test.ts). The doc rebuilt here is 54,777 characters, where protocol.ts's comment says
  55,056 (its arithmetic adds the anchor to a figure measured before); the script measures the same object the test
  builds. Adding a stack count to six statuses a row and the uses left goes over the eighth's spare: `DOC_ROWS` 32 to 30.

## Which principle changed a choice

- model-the-domain, type-system-discipline: the status is a union of a plain and a stacked arm, so `stacks` and a
  threshold cannot be written on a plain status; a trigger's `to: 'other'` is allowed only on events that have another
  body (the union over `on`).
- subtract-before-you-add: triggers live on a status def only; a passive skill, an item and a zone carry one through a
  status (`worn`, a zone's hold). Entering a zone is not a trigger event, since a zone's on-entry ops already are one.
  A mode needs no type of its own.
- Step 2: design section 2, the six machines (stacks, delayed, uses, summon, trigger limit, zone upkeep) as the
  script's `MACHINES` tables and chart sketches. A mode and a threshold are not machines of their own (a cap-1 stack;
  a cell of 2.1).

## Log, continued

- Step 3: design section 3 and script part 3. The unit is the standard action (the recommended standard formula's
  average). The tolerance (0.08) is the triangle's closest margin on paper, so it comes out of the rules. A mode first
  measured as a stat bonus came out absurd (300 Power to repay one action: a point of Power is worth 0.6 eff), so a
  mode is priced as a credit to the abilities it gates. Threshold payoffs counted with floor() made a 6-round kit 0.69
  or 1.14 of its plain build by rank; counting whole firings of a binomial number of stacks is exact and smooth. Each
  kit's one lever is searched by the script, not chosen by hand.
- Step 4: design section 4 and the script's `MAPPING` (part 4): each ability a row of data, so the counts are
  counted. 96 of 200 names makeable (55% of the 174 the sheet defines); 52 by the blocks with no difference. Two small
  additions came out of the mapping: a hit's, crit's or kill's trigger may name a tag (Void Knight, Spirit Archer,
  Rend, Mercy), and `cureStatus` may take some stacks (Violence Begets Violence). No block is used by fewer than two;
  the mode and the delayed effect are the closest and are argued for in section 4.
- Step 5: design sections 5 (makers, three built-ins, the build order in 17 units, AGENTS.md rows and recipes),
  6 (not now) and 7 (for the owner), and the one-page summary at the top. design.md is 596 lines.

## Checks at the end

- `bun run typecheck`: clean. `bun scripts/kits-paper.ts`: prints sections 1 to 4; its last line is table 4.3's summon row.

## The numbers I trust least

- The tolerance (0.08): it is the paper's closest triangle margin (cannon over tank at C), and the simulation's own
  margins differ from the paper's; the kit rows of 3.2 are where it gets checked.
- The execute shares: the pack and boss rounds they come from are the paper's, not the simulation's (the boss factor
  moved to 3.2 after the paper).
- The HP price's rate (an HP is 1 / a support's heal of 1.5 sup): it assumes a support is in the party; a party with
  no healer pays HP prices for real, and the price is then worth more than the maker says.
