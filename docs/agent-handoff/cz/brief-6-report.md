# Brief: the Customization report, its screenshots and the recipes (customization, unit 6)

One helper (Sonnet, writer), in the main tree, on branch `claude/zen-pasteur-ov4cgd`. No other helper writes while you work. You change no app code and no test. You write docs and one screenshot script.

Run `bun install` once. Read first: `.claude/skills/unslop/SKILL.md` (every sentence you write follows it), `AGENTS.md`, `docs/agent-handoff/later-phases/customization-prompt.md` (step 6 is this unit), `docs/agent-handoff/cz/design.md`, `docs/agent-handoff/cz/inventory.md` (only its Summary table and the "Missing" lines: this is the "before"), every `docs/agent-handoff/cz/notes-*.md` (the "now": read each one's "Table-visible", "Decided by the helper" and "Unsure" lines with care), and `docs/agent-handoff/lead-report.md` section 11 (the style and length to match).

Commit after every numbered step (name the files, plain messages, no AI attribution, no Co-Authored-By). This overrides the "do not commit" line of your built-in rules. Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Notes file: `docs/agent-handoff/cz/notes-6-report.md`.

## Why (the owner's goal)

"We're optimizing for customizability. The ability to make custom abilities, status effects, custom rewards, items, enemies, etc... and ways to notify me when players have used rewards." The owner reads the report on his phone. He does not read code. He wants to know what he can now make, how fast, how he is told about a use, and what his table will notice.

## Steps

1. **Screenshots** (`scripts/maker-shots.ts`, modelled on `scripts/shots.ts`: its own server is not needed, take `--url` and `--out`). At 390 by 844, device scale factor 2, on a seeded GM save, capture each as a PNG: the Workshop; the status maker with a by-rank damage row and its preview; the item maker with a target, an effect and "Tell me when it is used"; the skill maker with its preview; the enemy maker with a skill, a starting status and loot; the reward editor with an item, a title, a boon and its preview; a player's sheet with a boon and its Redeem button; the GM's "Reward uses" with one line; the Share code box. Drive the screens the way `tests/e2e/makers.e2e.ts`, `tests/e2e/used.e2e.ts` and `tests/e2e/sharing.e2e.ts` do (copy their selectors). Start the app with `PORT=3260 bun server.ts` in the background for the run and stop it after. Save them to `docs/agent-handoff/cz/shots/` (nine files, named by what they show). Look at each image yourself (the Read tool shows a PNG) and write one line per image in the notes: what it shows, and anything that looks wrong at phone size (clipped text, a control under 44 px, a horizontal scroll, the Save bar covering a field). Do not fix anything; the list goes to the UI run.
2. **`lead-report.md` section 12, "Customization"**, in this order, each short:
   - The answer first, in three or four sentences: what a GM can now make from a phone and how he is told about a use.
   - A table, one row per kind (status, item, skill or ability, enemy, reward, reward bundle; then quest, gate, job, path, rule number as "unchanged" rows with one clause each): what a GM could make before, what they can make now, and the taps from the home screen to a saved one (the numbers the browser tests check; name the test).
   - "One rule for custom content": the table of `design.md` (kind, parser, home, lookup) and one sentence on why it matters to him (adding a field is one parser line and it then works in saves, rooms and sharing).
   - "Abilities that act": what a skill and an item with a target now do in a fight, for a hunter, a player in a room (the feed's "Apply to…") and an enemy; what is still the GM's call (save DCs, anything written as a note).
   - "When a player uses a reward": the flow step by step (mark an item, or give a boon; the player uses it; the feed row, the toast, the log line, "Reward uses"; the notification), why "tell me" is off for ordinary loot and on for boons, that each use is told once (how, in one sentence, and the model test that checks it), and the plain limits: a phone with its screen locked gets nothing until it is opened; a hidden page checks every 30 seconds; real push would need a push service and keys and was not built.
   - "Sharing": a pack, a code, Add and Replace.
   - "What a table will notice": every behaviour change of the phase a player or GM would see, from the notes' "Table-visible" lines, the trail rows of this phase in `decisions.tsv` and the helpers' "Decided" lists. One line each. Do not leave one out because it is small.
   - "Things the owner can choose": decisions made for him that he may want otherwise, each with what he would say to change it. At least: `tell` off by default for loot; applying an existing status is two taps (preview, then Apply); a player's phone reports a use and the GM applies it; no makers for jobs, paths and rule numbers; what the helpers were unsure of.
   - "Numbers": bun tests and browser tests before the phase (1,378 and 106) and after (from the last `push-N` row of the trail), units and their durations from the trail.
   - "Open items": from the notes' "Unsure" lists and the screenshot notes.
   - The screenshots, each as a markdown image with a one-line caption.
   Every number in the section comes from a notes file, the trail or a test name. Where you cannot find one, write "not measured" and say where you looked.
3. **`AGENTS.md`**: one recipe, "A kind of custom content": its type, its parser in core, its home in `library`, its line in `parsePack` and `mergePack`, its maker on `app.api.maker`, its Workshop section, its tests. Check each existing recipe the phase touched still names real files and functions (`grep` each name). Keep the file's size about what it is; cut a sentence for each you add where you can.
4. **`docs/agent-handoff/copy-tasks.md`**: check every string the phase's notes sent there is present, grouped under one "Customization" heading.
5. `bun run deps -- --write`, `bun run charts`, `bun run test` (the docs tests fail when a generated file is stale). Commit.

## Rules

- Plain sentences. No long dashes. Lead with the answer. Tables over prose.
- Facts only, each with its source. If two notes disagree, the later one wins and you say so in your notes.
- Do not describe anything as working that a test does not check: name the test.

## Done means

`bun run test` passes. Final reply under 150 words: the commit range, the nine image paths, the three things from the screenshots that most need the UI run.

If you are still going after about 60 minutes, commit what you have, write where you are in the notes, and reply.
