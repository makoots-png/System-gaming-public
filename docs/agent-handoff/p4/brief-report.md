# Brief: the "Status scaling" section of the lead report (phase 4)

One helper (Sonnet, writer), in the repo root. You change one file, `docs/agent-handoff/lead-report.md`: add a new last section, "Status scaling", numbered after the last one. No code, no tests, no other file. Commit it (plain message, no AI attribution, no Co-Authored-By). Do not push. Never edit anything under `.claude/skills`.

Read first: `.claude/skills/unslop/SKILL.md` and `.claude/skills/technical-writing/SKILL.md` (write by them: plain words, short sentences, no dashes used as punctuation, sentence-case headings), then `docs/agent-handoff/p4/design.md`, `p4/status-audit.md`, `p4/notes-scale-core.md`, `p4/notes-scale-wiring.md`, `p4/notes-seen.md`, and the "Architecture" section of `lead-report.md` for the house form.

## Who reads it

the owner, the owner, on his phone. He asked: "make sure status effects scale a bit... even basic status effects should scale into the mid game at least a little", "the scaling should be largely decided by the strength of the user/item", "I don't mind some items/players/classes be death by a thousand effects rather than just damage output". He wants every balance number explained. The next lead reads it too.

## What the section holds, in this order

1. **In four or five lines**: what changed for a table.
2. **Before and after**, one table: every built-in status with numbers, at low (E), mid (C) and high (S) rank of whoever applied it. Before is the flat number at every rank (audit section 1). After is `design.md`'s curve. Check each after value against `src/core/registry/statuses.ts`, which is the truth.
3. **Why each curve**: one or two sentences per status, from `design.md`'s Why column, with the yardstick (a same-rank hit, the rank bonus). Say which statuses have no numbers and did not change.
4. **Who decides the strength**: the source's rank or an item's rarity, by hand the target's own rank, the stronger source wins and the longer duration stays. One short table of source and tier.
5. **The simulation**: what it plays, the result table from `notes-scale-core.md` step 7 (the numbers as measured), the bounds as restated in `design.md`'s last section and why they were restated, and the three plain conclusions (status parties keep pace on long targets from C up; attackers win on short ones; E favours statuses because a hunter hits about half the time there). Run `bun test tests/status-sim.test.ts` and quote its printed table if it differs from the notes.
6. **Things the owner can choose**, each one line with what it would take: lower the E dice; a percent-of-health built-in (give the arithmetic: monster HP grows 100 times from E to S, a hit 15 times); a rank picker when the GM applies a status by hand; enforcing "cannot act" and disadvantage, which are text today; to-hit is decided by the build from C up, so penalties to a roll matter less there.
7. **What a table will notice**: the list from the two notes files (including Blinded -4 at E, Bloodlust -1 damage at E, the GM's fight card following a player's sheet at once instead of after 12 seconds, item cards and chips showing numbers).
8. **Left open**: what the helpers listed as left out or unsure, each one line.
9. **Numbers**: tests before and after (1,285 bun and 100 browser before; read the after counts from the last lines of `p4/notes-scale-wiring.md`).

## Rules

- Every number comes from a file you read. If two files disagree, the code wins, and say so in your reply.
- Under 160 lines.
- No praise, no summary paragraph at the end.

Final reply under 120 words: the commit, anything where two sources disagreed.
