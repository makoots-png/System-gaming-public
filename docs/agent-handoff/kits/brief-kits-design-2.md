# Brief: kits, the second wave on paper (what the first design left as "not now")

One helper (Opus, heavy-writer), in your own worktree. Paper only, as `brief-kits-design.md` (same rules, same reading list, plus `kits/design.md`, `kits/glas.md`, `kits/notes-design.md` and `bun scripts/kits-paper.ts`'s mapping table). You extend `docs/agent-handoff/kits/design.md` with a section 8 and `scripts/kits-paper.ts` with its tables; notes in `kits/notes-design-2.md`. Commit after each step.

## Why

The first design makes 96 of the 174 abilities the owner's sheet defines. He said those kits "should contain a lot of the types of customizability I'd like", and "everything must be balanced properly" and "defined with a state tree where applicable". The 78 left as "not now" fall into a few families that recur across all five kits. Decide each family: a block (with its rule, type, state tree, budget and maker row, to the standard of sections 1 to 5), or still not now with a reason the owner would accept.

## The families (from the mapping)

1. **Ops the status table lacks**: armor and resist up or down, damage taken and damage dealt by a share, healing received by a share, crit chance and crit size, an ability's cost or range changed, untargetable, invulnerable for a round, "cannot gain new harmful statuses" (Safeguard), cure the first or every harmful status (Dispel, Purge), spread the next status to an ally (Proliferate). Say which are plain new members of `Op` and which are not ops.
2. **Advantage and added dice**: roll the reaction or a check twice and keep the better or worse; a held die added to a roll (Rouse, Expected Outcome). The fight's one roll is the target's reaction d20 against Accuracy: define advantage on it for each side, and its worth.
3. **Forced movement and placement**: push, pull, knockback, teleport (blink to a seen tile), swap places; what walls, pits and zones do to a pushed body.
4. **Reactions**: an ability used on another's turn in answer to an event (Parry, React, Lamb's Respite, a counterspell): how many a round, what it costs on the timeline, how a player on a phone is asked in time without stalling the table (the GM's phone is the one writer; a pre-armed reaction that fires by rule is one answer: weigh it against a prompt), what a monster does.
5. **Moving counts and zones**: stacks moved from one body to another or handed to an ally (The Muses, Essence Transfer, The Cycle Continues), one status's stacks set from another's; a zone moved, resized or detonated by its owner.
6. **Turn economy**: an extra action, giving a turn to an ally (Transfer), acting before another (React): what each is on the next-action timeline (a delay taken off, an `at` set), bounded so no loop yields unbounded turns.
7. **Stealth and surprise**, flight: say whether the fog and `sees` already give stealth a meaning (unseen by the other side until it acts or is adjacent) and what an attack from unseen is worth.
8. Still not now unless you find them cheap: collectable sets, perk trees with prerequisites, triggers on the order of abilities, rewinds, permanent growth from kills.

## Steps

1. Section 8.1 to 8.7: each family decided, to the first design's standard (rule, type sketch, rule numbers, caps, doc size, variants weighed where real). Commit.
2. The state trees for what has states (a reaction: armed, fired, spent, restored; advantage held and used; a pushed body; stealth: hidden, revealed). Commit.
3. The budget and the degenerate loops (extra turns, damage-taken stacking with execute, advantage with crit stacks, teleport out of zones), with the script's tables; the simulation rows to add. Commit.
4. The mapping run again over all 200 names with waves 1 and 2: the new count, and what is still not now. The maker rows and the build order for wave 2 as units, which can run beside wave 1's units and which must follow. Update the summary page and the section for the owner. Commit.

Time: two hours. Reply in at most 250 words: branch, worktree, commit range; each family's decision in a line; the new makeable count; the three numbers you trust least.
