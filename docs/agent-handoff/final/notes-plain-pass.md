# The plain pass

the owner's ruling (Nov 19): cleverness is fine in names and ideas, never in a line that describes, explains, informs, instructs, refuses or hints. This pass reads every such string in `src/` and `public/index.html` against "Plain first" in `copy-tasks.md` and changes only the lines that break it. Names, titles, tags, keys and behavior are untouched. `src/core/registry/bundles.ts` was done before and is skipped.

The candidate list came from a scratch script that prints every string literal of four or more words by file (about 1,900 outside bundles.ts). Most are plain and stay.

## Batch 1: the registries

Statuses, items, skills, monsters, the kits' examples and the rule titles (`src/core/registry/*.ts`, `src/core/rules.ts`).

| Area | Changed | Left |
|---|---|---|
| Statuses (`statuses.ts`) | 9 | 9 |
| Items (`items.ts`) | 32 | 5 |
| Skills (`skills.ts`) | 14 | 1 |
| Monsters (`monsters.ts`, desc and notes) | 13 | 46 |
| Kits' examples (`kit-examples.ts`) | 14 | 1 |
| Rule titles and the daily quest (`rules.ts`) | 5 | 1 |
| Jobs, paths, perks | 0 | all (plain already, or no prose) |

A status line now names the stat and the sheet number it moves ("Has lower Control, so its Accuracy drops"), since that is what its ops do. An item line says what the thing is and what it adds; the numbers already on the item card are repeated only where the old line had no other content.

The ten worst:

| Name | Before | After |
|---|---|---|
| Ring of Vitality | Warm to the touch. Your pulse steadies. | A ring that adds 5 Vitality. |
| Monarch's Scepter | Authority given a handle. | A scepter that adds 6 Power and 10 max mana. |
| Ring of the Monarch's Will | The System itself bends to it. | A ring that adds 6 Strength and 6 Presence. |
| Orb of Avarice | Greed made solid. | An orb worn at the neck that adds 4 Power and 6 max mana. |
| Armor of the Black Knight | It remembers every blow. | Heavy chest armor that adds 3 Vitality. |
| Signature | The mark of the visionary. Two marks detonate on the bearer and its friends close by. | At 2 stacks, both are spent, and the bearer and its allies within 2 tiles take magical damage. |
| Hemoplague (status) | Blood that turns on its host when the time comes. | When it ends, the bearer takes magical damage. Removing it early cancels the damage. |
| Bloodlust (status) | Cowed by a superior presence: Will falters and blows land softer. | Has lower Discipline, Strength and Power, so its Will drops and its hits do less damage. |
| Frightened | Will falters while the source is in sight. | Has lower Discipline, so its Will drops. (The old line claimed a sight rule the status does not have.) |
| Bloodlust (skill) | Bloodthirst sharpens your strikes. | Adds 1 Strength. |

## Batch 2: core words tables

The status op lines (`effect-ops.ts`), the fight log (`fight.ts`, `fight-turn.ts`), the ability lines (`ability-kinds.ts`), the worth line (`worth.ts`), the gates list (`world.ts`). Read and left plain: `refusal-words.ts`, `odds.ts`, `solo.ts`, `solo-wait.ts`, `rules-text.ts`, `first-run.ts`, `taps.ts`, `connection.ts`, `coin.ts`, `vitals.ts`, `use.ts`, `penalty.ts`, `chips.ts`, `facts.ts`, `detail.ts`, `scalers.ts`, `rewards.ts`, `session-log.ts`, `store-life.ts`.

Changed 15, left about 950 (the scratch list's count for `src/core` outside the registries done in batch 1 and `bundles.ts`).

| Where | Before | After |
|---|---|---|
| A delayed end (`endLine`) | A cleanse saves you. / A cleanse sets it off. | A cure cancels it. / A cure makes it happen at once. |
| Worth line, over budget | Stronger than its pace allows by 12%: a kit this strong can flip a matchup by itself. | Stronger than its pace allows by 12%. |
| Gates list, a player with none | No gates detected. The world is quiet. | No gates detected. |
| A curse's line | Resisted by Discipline: nothing travels, so the target's Will meets the user's Aim. | Resisted by Discipline: it does not travel, so the target cannot dodge it. The target's Will is compared with the user's Accuracy. |
| Untargetable op | Foes cannot aim at it or catch it, ... | Foes cannot aim at it or hit it with an area, ... |
| Hidden op | Hidden: foes cannot aim at it or catch it; acting, a foe beside it or a hurt reveals it | Hidden: foes cannot aim at it or hit it with an area. It is revealed when it acts, when a foe is beside it, or when it is hurt |
| Fight log, a summon replaced | Sprite fades: a newer one came | Sprite leaves: a newer summon took its place |
| Fight log, upkeep unpaid | Boundary lapses: Kai cannot keep it. | Boundary ends: Kai cannot pay its upkeep. |
| Fight log, a channel | Kai's Storm goes off at nothing. / goes off at charge 2. | Kai's Storm is released and hits nothing. / is released at charge 2. |
| Fight log and window, a natural 1 on extraction | Goblin's corpse crumbles to dust. | Goblin's corpse is destroyed. (Window: "Natural 1. Goblin's corpse is destroyed and cannot be extracted.") |
| A gap's cap refusal | ... without one it is nothing between equals and a one-shot against a mismatch. | ... Without one it adds nothing between equal stats and can kill in one hit when the stats are far apart. |

## Batch 3: views, edge and the Rules page

`rulesref.js`, `shadows.js`, `gates.js`, `gm.js`, `kit-parts.js`, `maker.js`, `io.js`, `detail.js`, `room-events.ts`. Read and left plain: the rest of `src/views`, `src/edge` (the room pill, sync, store banners), `src/app.js`, `public/index.html`.

Changed 19, left about 1,280 (strings and HTML text nodes of four or more words).

| Where | Before | After |
|---|---|---|
| Rules page, curves | Doubling a stat gives 1.62 times, not twice, so spreading points pays as well as stacking them. | Doubling a stat gives 1.62 times the effective points, not twice as many, so points spread over several stats are worth about as much as points put in one. |
| Rules page, max HP | Level carries most of it, so a fight is a similar number of hits at every rank. | Most of it comes from level, so a fight takes about the same number of hits at every rank. |
| Rules page, armor | Physical damage meets Armor, magical damage meets Resist. | Armor reduces physical damage and Resist reduces magical damage. |
| Rules page, a gate break | monsters pour out into the world. | its monsters come out into the world. |
| ARISE window | Igris rises from the dark. Name your shadow. | Igris rises as your shadow. Name it. |
| Extraction failed window | The shadow slips away. 2 attempts left. / The shadow dissolves. No attempts left. | 2 attempts left. / No attempts left. (The title already says it failed.) |
| Release a shadow | Igris will return to the dark. This cannot be undone. | Igris leaves your army. This cannot be undone. |
| GATE BREAK window | Monsters are pouring out of the gate. | Its monsters are coming out of the gate. |
| Status maker, a delayed end | A cleanse: Saves you / Sets it off | A cure: Cancels it / Makes it happen now |
| Ability form | Calls a body to its user's side | Summons a body that fights for its user |

## Left on purpose, and unsure

- The Welcome window's No button (`onboard.js`): "[SYSTEM] Declining is not an option." and "[SYSTEM] The System does not accept "No"." It is a joke from Solo Leveling, but the words are literally true (the button moves and then accepts), and changing them changes the idea, not the explanation. Left. The owner may want it gone.
- The GM's "System whispers" roll table (`gm.js`, `whisper`: "The System is watching.", "Your shadow is longer than it should be.", "Level is only a number. Survival is the stat.") and the random fight and quest seeds beside it. These are lines the GM sends in the System's voice as story, so they are ideas. Left. If the owner counts them as text the app says, they are the most clever lines left in the app.
- The starter campaign's quest descriptions (`starter.ts`: "Someone has been here before.") are story, kept.
- Monster descriptions that state lore literally ("A dragon that burned half a continent.", "Hulking animated rock.") stay; only the figurative ones changed.
- Status lines name the sheet number a stat moves ("so its Accuracy drops"), read from `derive.ts` (Control gives Accuracy, Discipline gives Will, Agility goes into Reaction). Invisible's "Unseen." and Stealth's "Hidden from view." were left: the statuses have no ops, so the GM rules what they do, and the short line says what they mean.
- `tests/models/fight-sim.ts` and `tests/protocol.test.ts` hold their own copies of old descriptions ("Blood that answers its caller.", "Slew a pack leader of wolves.") as test data that nothing compares with the app; left. The chart scripts (`scripts/charts/delayed.ts`, `wave2.ts`) and `scripts/kits-paper.ts` still say "cleanse" in the docs they write, which are out of scope.
- There are no feats on this branch (`registry/feats.ts` does not exist yet), so none were read.

Names whose description needed a guess at the designer's intent:

- Trailsense (skill, no bonus): "You notice what others miss. Gates are never a surprise to you." became "You notice tracks and signs others miss, and a gate never surprises you." "Tracks and signs" is my reading of "what others miss".
- Mana Sense (skill, no bonus): "You can sense mana near you, which lets you find hidden gates." The old line said it feels hidden gates; I kept that as finding them.
- Dagger Rush: the old line said two strikes, but the ability is one quick strike with 2d4. The new line says what it does: "A quick dagger strike that rolls 2d4."
- Marked Shot: no mark rule exists, so the line is "A shot that rolls 1d6."
- One Who Overcame Adversity (title): "Survived a fight you were expected to lose." in place of "Survived what should have killed you."
- Frost Giant Hammer, Ice Elf's Cloak and the other loot keep a few words of what the thing is (a hammer with a head of ice, a heavy cloak) beside what it adds.
