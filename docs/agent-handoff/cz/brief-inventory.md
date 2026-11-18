# Brief: customization inventory (read only, one new file)

One helper (Opus, heavy-writer), in its own worktree. You change no app code and no test. You write one file, `docs/agent-handoff/cz/inventory.md`, and commit it (plain message, no AI attribution, no Co-Authored-By). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

If `git log -1` in your worktree is not the commit your prompt names, run `git reset --hard <that commit>` first.

Read `AGENTS.md` first, then `docs/agent-handoff/later-phases/customization-prompt.md`, `docs/agent-handoff/handoff.md` section 4, `docs/dependency-map.md` (use `bun run deps -- <name>` for one entry) and `.claude/skills/unslop/SKILL.md`.

## Why (the owner's goal)

"We're optimizing for customizability. The ability to make custom abilities, status effects, custom rewards, items, enemies, etc... and ways to notify me when players have used rewards."

The goal of the phase: a GM makes their own version of every kind of content from a phone, in under a minute each, and it behaves like built-in content everywhere (fights, sheets, rooms, saves, export and import). A GM is told when a player uses something the GM gave them.

The lead decides the model for the whole phase from your inventory without opening the big files. So it must be complete, exact and short. Every claim carries its `file:line`.

## What to write, in this order

1. **One section per kind**: ability or skill (a hunter's skills, a monster's abilities, a shadow's), status effect, item, enemy (monster, shadow), reward (quest rewards, gate rewards, loot, GM gifts), quest, gate, job and Job Change chain, path or perk, rule number. For each, a small table:
   - the type and where it is declared; the built-in table and its parser (the function that turns unknown input into the type);
   - what a GM can make or change today, from which screen and function (`src/views/...:line`), and the taps from the home screen to a saved entry (count them by reading the view; say "read, not run");
   - where a custom entry is stored in the save (the exact key and shape, from `src/core/save.ts`), and whether it passes through the same parser as a built-in at save time and at load time;
   - the lookup: the function a fight, a sheet or a card calls to resolve an entry, and whether a custom entry goes through that same function;
   - whether it reaches a player's phone in a room, by which room message (`src/core/protocol.ts`), and what is lost on the way (fields the payload reader drops, size bounds);
   - whether it survives export and import (`src/views/io.js`), and what the import checks;
   - what a player can customize of this kind;
   - what is missing against the goal. Facts, one line each.
2. **The forms today.** Every dialog or form that creates or edits content (`src/views/forge.js`, `src/views/custom.js`, the quest, gate, shop, bestiary and GM views): the function, its fields, what it validates, what it writes. Say what the Status dialog's pattern is exactly (pick an existing one or name a new one, chips, live preview), which helpers it uses that another maker could reuse, and which forms already share code.
3. **The op vocabulary.** Every op the effect engine has (`src/core/combat/status.ts` and wherever item effects are read): its fields, including `tiers` and `pct` from phase 4, who reads it (status tick, item use, perk), and which ops only write a line of text. Then the ability reader (`src/core/combat/ability.ts`): what an ability text can express, what it returns, who rolls it, what it cannot express (the four known gaps are in `docs/agent-handoff/p4/status-audit.md` section 8; confirm each with its line).
4. **A hunter's skills.** The shape, where they come from (job, path, GM, player), what using one does in a fight and outside one (MP, cooldown, dice, statuses), and whether a skill can hit an enemy or apply a status to one through the fight reducer (`Command` in `src/core/combat/encounter-types.ts`). List the commands that exist for it.
5. **Rewards end to end.** `Rewards` in `save.ts` and `GivenRewards` in `protocol.ts`: every field, every place a reward is granted (quest complete, gate clear, fight end, GM gift, shop), the room message that carries it, the applier on the player's phone, and what the player sees. Whether a reward can hold an item, a title, a status, a text line. Whether anything like a saved reward bundle exists.
6. **Use of a thing by a player.** Every path where a player uses or consumes something (item use in `src/views/`, a skill, a one-time reward): what it writes locally (feed, log), and exactly what reaches the GM's phone today and how (the sheet push, a room message, nothing). The feed and log structures: where they are stored, their bounds, what the GM's table feed shows and from which data.
7. **Notifications.** Whether the app uses the Notification API or the service worker for anything today (`src/sw.js`, any `Notification` use), and what permission flow exists.
8. **Export and import.** What `io.js` exports and imports today (whole save, parts, a code), the format, the checks on import, and whether a part of a save (one kind of custom content) can be exported alone.
9. **The remote Job Change chain.** What the room `quest` offer carries, why a chain cannot travel, and what a message for it would need (follow the recipe "A room message" in AGENTS.md; name the files).
10. **Odd things.** Anything wrong or surprising: a custom entry that skips the parser, two stores for one kind, a form that writes a shape the type does not allow, a custom entry that a room drops. One line each. No fixes.

End with a one-page summary table: one row per kind, columns "make today (yes, partly, no)", "screen", "taps", "stored at", "same parser", "same lookup", "reaches a room", "export and import", "biggest gap".

## Rules

- Facts only. No design, no proposals.
- Under 600 lines. Tables over prose. Plain sentences (unslop).
- If something cannot be found, say "not found" and where you looked.
- Write the file in pieces, section by section, and commit after every two or three sections.

## Done means

The file is committed in your worktree. Final reply under 150 words: the commit hash, the branch name, the three facts you think matter most to the design.

If you are still going after about 50 minutes, commit what you have with a line at the top saying which sections are missing, and reply.
