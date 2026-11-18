# Brief, milestone 5: the map made right, and intent, threat, stagger, shields and channels on the screens

One helper (Opus, heavy-writer), in the main tree. Commit after each numbered step with `git commit -m "..." -- <paths>` (plain message, no AI attribution, no Co-Authored-By; this overrides "do not commit" in your built-in text). Do not push. Do not start helpers. Never edit `.claude/skills`. Do not run `bun run ci`. Checks: `bun run typecheck`, `bun run test`, browser files one at a time on `E2E_PORT=3241` (`E2E_CHROMIUM=/opt/pw-browsers/chromium ... --workers=1 --trace off --output=/tmp/pw-<file>`). The machine may restart: commit each step and keep your notes current.

Another helper works in its own worktree on the makers (`src/views/maker.js`, `forge.js`, `loot.js`, `workshop.js`, the maker part of `skills.js` and `bestiary.js`, `src/core/registry/ability-kinds.ts`). Keep out of those files.

Read first, in full: `AGENTS.md`, `docs/agent-handoff/later-phases/combat-rework-notes.md` (the owner's words on channeling, the ideas from other games, custom statuses, and "The map"), `docs/agent-handoff/later-phases/feel-notes.md`, `docs/agent-handoff/rw/design.md` section 4 (channel, taunt and threat, stagger, shields, intent: the rules exist in core and are tested) and `rw/proposals.md` number 3 (what intent shows), `docs/agent-handoff/map/brief-m3-map.md` (the lead's design decisions for the map still stand) and `map/notes-m3.md`, `docs/agent-handoff/feel/notes-2-redraw.md`, `docs/agent-handoff/rw/principles.md` and the leaf skills for experience-first, model-the-domain, minimize-reader-load, laziness-protocol, the code: `src/core/combat/map-view.ts`, `fight-view.ts`, `fight.ts`, `fight-types.ts`, `fight-channel.ts`, `fight-doc.ts`, `src/views/map.js`, `combat.js`, `table.js`, `patch.ts`, `motion.ts`, `tests/e2e/battle-map.e2e.ts`, `tests/e2e/feel.e2e.ts`, `.claude/skills/unslop/SKILL.md`.

## Why (the owner's goal)

the owner, the owner and GM, whose players are on phones: "Everything should be satisfying on UI. Nothing over the top, but I want to emphasize FEEL." He trusts the lead with design decisions. The map exists and works; the lead looked at it on a 390 px phone and it is not yet what he was promised. And five things he asked for are in the rules but nothing draws them: "a monster shows its intent for its next action", "a stagger bar on bosses", "shields as a layer of temporary HP", "a threat table that suggests each monster's target", and channeling, where "if a heavy power character can focus on an ability for 5x turns his next one should probably oneshot someone". A table cannot use what it cannot see.

## Part A: what the lead saw on the map, and what it must become

1. **The movement area is a stack of hard-edged squares with seams between tiles.** the owner was told "soft shaded areas". Draw each area (stride, dash, an ability's reach, a splash, a ring) as one shape with a soft edge and no seams: one element per area whose outline is the union of its tiles (an SVG path or a CSS `clip-path` polygon computed from the tile set by a pure function in core, tested with drawn grids), feathered a few pixels, appearing through `motion.ts`. The stride is the clearer shade and the dash the fainter one (today the far part reads darker). Measure the frame cost against the per-tile version at twenty tokens and a hundred tiles and keep the lag test's map limits.
2. **Aiming paints the whole map a muddy olive and nothing says who can be hit.** Reach is a faint tint in the ability's own colour family from the tokens (hostile uses warm, helpful uses cool), never brown. Tokens that can be hit get a clear ring and a slight lift; tokens that cannot are dimmed. A place ability shows its splash and outer ring as two soft areas under the finger, and each token inside gets a mark that says caught or ring.
3. **Map is the default view**, since the map is the fight as the owner pictures it. Existing phone tests that drive the list choose List first (one helper in `tests/e2e/helpers.ts`), except tests where either view serves.
4. **In Map view during a running fight the screen is the fight**: the turn order line, the map, the current combatant's row, the hotbar. Build encounter, the log and the rest go behind one "Fight tools" control (a sheet), so a GM does not scroll past a form to play. The list view keeps its layout.
5. **The hotbar reads as a hotbar**: buttons of equal size in one row that scrolls sideways if it must, name on top, cost below in whole words ("6 fatigue", "10 mana"), the rounds left when not ready, the selected one clearly lit. Use and Cancel sit in a fixed bar above it while aiming, not between the map and the hotbar where they push the layout around.
6. **The ground**: a quiet vignette and the faint centre dots, so an empty arena does not look like a blank panel. No texture image.
7. **Tests M3 left out**: a blast aimed at a place marks who is caught and who is in the ring before Use, and after Use a fast target is on the tile it escaped to on both phones; a consumable from the More drawer is used from the map. And `scripts/ui-shots.ts` fails one step ("gm-390 move control and target picker: evaluate timeout"): fix the script.

## Part B: the five extras, on the list view and on the map

Each is data the scene or the card already can carry from core (`fight-view.ts`, `map-view.ts`); add fields there with tests, then draw. No rule in a view.

8. **Intent.** The GM sets a monster's next action from its card or its token (the `setIntent` command exists): pick an ability and a target or place. Players see the ability's name and its target on the monster's card and as a line from the monster's token to the target (or the aimed area's outline for a place); the numbers stay hidden until the GM taps Reveal, which shows them for that one intent on every phone. A monster that is channeling shows its channel as its intent. The fight doc carries it by the recipe with its bound; a hidden number never reaches a player's phone before Reveal (a test reads the player's doc).
9. **Threat.** A monster's card shows its suggested target (the highest threat) and, behind a tap, the list with each share. On the map the suggested target is the thin line the intent would draw when no intent is set, in a quieter style. The GM may target anyone; nothing forces it. A taunt shows on the taunted monster's token and card with the rounds left.
10. **Stagger.** An elite or boss shows its bar under its HP on the card and as a second, thinner ring on its token. It fills through `fillTo`; when it breaks the token shakes once, a burst plays, the card says "Staggered" with the time it costs, and the order line shows the monster pushed back.
11. **Shields.** A shield is a pale layer over the HP bar and ring, with its amount and rounds left on the card. Damage shows the shield taking it first.
12. **Channels.** A channeling combatant shows its charge as pips (charge of max) on the card and around the token, growing at each of its turns with a pulse; the hotbar offers Release with the current payoff in words; a break shows as the pips shattering and the half-charge firing. On a player's own phone the same, with Release theirs to tap.
13. **Browser tests** for each of 8 to 12, two phones, named for what is seen, values from the rules. Add a boss with a stagger bar, a shield and a channel to the lag test's map case and keep its limits.

## Steps

Do Part A first (items 1 to 7, a commit per item or small group, the existing fight and map tests green after each), then Part B (8 to 13). Then: `bun run typecheck`, `bun run test`, every browser file one at a time, `bun run deps -- --write`, steps in `scripts/ui-shots.ts` for the new states, `AGENTS.md` rows and recipes where a new thing has a home, `docs/agent-handoff/copy-tasks.md`. Look at the map on a 360 px phone and at 1280 px with your own eyes after Part A and after Part B (throwaway screenshots you do not commit) and write in `docs/agent-handoff/map/notes-m5.md` what you changed after looking. Notes also hold the frame measurements with run counts and what is left.

## Rules

- A view computes no fight number and decides no legality; core says it in the scene or the card.
- Only `transform` and `opacity` animate; every motion through `motion.ts`; no move awaited before a command.
- No dependency. No test skipped, loosened or given a retry; no fixed wait.
- Hidden information stays hidden structurally: what a player may not know is not in the doc their phone receives.
- Where an item cannot be built as written, build the nearest thing that serves the owner's words and put the difference at the top of the notes.

## Time

200 minutes. At 170 stop adding, finish the checks with what is in, and list what is left. Reply in at most 250 words: the commit range, the last line of each check, the map's frame numbers, what is done and not done of Part A and Part B, and what the lead should know.
