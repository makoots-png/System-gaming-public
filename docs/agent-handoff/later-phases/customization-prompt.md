# Customization (runs after phase 4, before the UI and UX run)

the owner, Nov 12: "we're optimizing for customizability. The ability to make custom abilities, status effects, custom rewards, items, enemies, etc... and ways to notify me when players have used rewards."

Read `START-HERE.md`, `handoff.md`, `AGENTS.md`, `docs/state-machines.md` and `docs/dependency-map.md` first. The owner is on his phone: everything here must work one-handed on a 390 px screen.

## Goal

A GM can make their own version of every kind of content the game has, from their phone, in under a minute each, and it behaves exactly like built-in content everywhere (fights, sheets, rooms, saves, export and import). A GM is told when a player uses something the GM gave them.

## What phase 3 left to build on

Each kind of content has one typed table of built-ins, one parser, and one test every entry must pass: statuses (`src/core/registry/statuses.ts`, the Status dialog in `src/views/forge.js` already makes custom ones and saves them to `rulesOverrides.conditions`), items (`registry/items.ts`, a library in the save), monsters (`registry/monsters.ts`, custom monsters in the save, the stat block as a pure function), jobs (`registry/jobs.ts`), paths and perks (`registry/paths.ts`), gate spawning (`gates/spawn.ts`), the rules' numbers (`rules.ts`, GM overrides). Abilities are text read by `src/core/combat/ability.ts`. Skills live on a hunter. Rewards are a typed shape (`Rewards` in `save.ts`, `GivenRewards` in `protocol.ts`). Room messages have one table (`protocol.ts`), and a player's phone applies each at most once.

## Steps

1. **Inventory first** (a read-only helper writes it): for each kind (ability or skill, status effect, item, enemy, reward, quest, gate, job, path or perk, rule number), what a GM can make or change today, from which screen, in how many taps, where the custom entry is stored, whether it goes through the same parser as a built-in, whether it reaches players in a room, whether it survives export and import, and what is missing. Include what a player can customize. The result decides the rest; do not assume gaps.
2. **One rule for custom content**: a custom entry is data of the same type as a built-in, checked by the same parser, stored in one place per kind in the save (or the rules overrides where it already lives), and looked up through the same function as a built-in. Where a kind does not meet that today, fix the model in core first, with the kind's table test extended to cover a custom entry (round trip, hostile input, a custom entry overriding a built-in key or being refused, as decided per kind).
3. **A maker per kind**, sharing one small form pattern (the Status dialog is the model: pick an existing one, or name a new one and choose its mechanics from chips, with a live preview of what it does in the game's own words). At least: abilities or skills (dice, cost, cooldown, statuses applied, usable by a hunter or given to an enemy), status effects (exists: bring it to the shared pattern and to phase 4's scaling), items (type, slot, dice, effects, rarity, value), enemies (rank or custom stats, abilities, statuses, XP, loot), rewards (XP, gold, points, items, a title, a status, a custom text reward the GM honours at the table), and reward bundles a GM can save and reuse. Each maker's output is validated by the kind's parser before it is saved, and a test drives each maker through the UI on a phone viewport.
4. **Reward use reaches the GM.** When a player uses or consumes something the GM gave them (an item, a one-time reward, a custom text reward marked "redeem"), the GM is told: a new room message from the player's phone (follow "To add a room message" in AGENTS.md; it is not GM-only; the server checks the sender owns the sheet), shown in the GM's table feed with who, what and when, kept in a short log the GM can open later, and, if the GM's phone has notification permission and the app is in the background, a notification. A reward the GM gives can be marked "tell me when it is used" (default on for custom rewards, off for ordinary loot; say why in the report). Add it as a move in `tests/models/room-world.ts` so the room system model test checks it arrives once. Solo play (no room) logs it locally.
5. **Sharing**: a GM can export their custom content (all of it, or one kind) as a file or a code and import it on another phone or campaign, through the same parsers. Reuse the existing export and import (`src/views/io.js`) rather than a second path.
6. Charts and the dependency map regenerated, AGENTS.md recipes updated ("To add a kind of custom content", and each maker's place), `bun run ci` green, and a "Customization" section in `lead-report.md`: a table of each kind (what a GM could make before, what they can make now, taps to make one), the reward-use flow, and screenshots at phone size on a page the owner can open on his phone.

## Rules

- Same standing rules as every phase: tests first for behaviour, explain every number, no new dependencies, views stay JavaScript but the compiler checks them, one helper in the main tree at a time, Opus or Sonnet helpers only.
- Do not build a scripting language or free-form formulas. Mechanics are picked from the ops the effect engine already has, plus what phase 4 adds. If a GM cannot express something, a custom text line the GM adjudicates at the table is the escape hatch.
- Wording goes in `copy-tasks.md` for the copy pass.

## TestFlight (do not start; a note for the owner at the very end)

The app is a web app that installs to a phone's home screen today. TestFlight distributes native iOS builds. Getting there takes: an Apple Developer Program membership (99 USD a year, in the owner's name); a thin native shell around the web app (Capacitor is the usual one; it would be the project's first runtime dependency outside dev tools, so it needs his OK); a Mac with Xcode or a hosted Mac build service to build and sign it; an App Store Connect record, then upload and add testers by email. The room server stays where it is. Alternatives that need none of that: the home-screen install it already supports, which works on iPhone from Safari's Share menu. Give him this as five plain sentences and ask which way he wants to go.
