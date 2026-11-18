# Notes: the wording pass

UNIT wording DONE at 8fdbca4 (the notes' own commit follows it)

Brief: `final/brief-wording.md`. Helper on `claude/zen-pasteur-ov4cgd`, main tree, from 61356fc.

## Goal, problem, smallest change

Goal: a player or GM at the table reads one voice and one name for each thing on every screen. Problem: about 200 `TODO(copy)` marks left placeholder words, written by many units, with two names for some things. Smallest change: read every marked sentence once against one glossary and the brief's voice, rewrite what breaks them, delete every mark, and add a lint that keeps the mark from coming back. Words only: no control, rule, identifier, key or class changes.

## Principles read and what each changed

- `unslop` and `technical-writing`: read in full before writing. The UI strings follow the brief's voice (technical-writing says product strings follow the product's own copy rules), and these notes follow both skills.
- `poteto-mode`: this note's first section; the decision trail below.
- `principle-encode-lessons-in-structure` (named by poteto mode, the leaf not reread this session, so not cited as shaping a choice): the brief's step 5 lint is that idea.

## Method of the counts

`tools/count.ts` in the scratch folder counts a word inside string literals that read as a sentence or a label (a word, a space, a lowercase word) in `src` and `public/index.html`, skipping comments, imports and markup attributes. It undercounts labels of one word inside markup (`>Bag<`), so for those the raw grep of `src/views`, `src/edge` and `src/app.js` is given too. The counts are from 61356fc.

## Step 1: the glossary

| Thing | Variants in src today (sentence strings) | The one word | Why |
|---|---|---|---|
| A battle from Start fight to its end | fight 71, encounter 29, combat 11 | **fight** | Most used, and the word of the bar ("Start fight", "Fight tools", "Fight over"). "Encounter" stays only in the gate's history log (its event names) and nowhere a player reads it beside "fight". The tab keeps its name **Combat**: it names a screen, not the battle, and every test and the bottom nav use it |
| A monster taken out of a fight | defeated 7 | **defeated** | The card's button, the end summary and the log say it |
| A hunter at 0 HP | down 9 (sentence strings) | **down** | A hunter can come back from 0 HP (death saves, a heal), so it is not "defeated". The fight already tags a player's hunter "Down" (W6b) |
| Mana | mana 25, MP 3 | **mana** | The sheet's bar and the fight say mana since milestone 2. The three "MP" left (a level-up line, an onboarding tip, a gate seed line) change |
| The shared session between phones | room 125, campaign room 5 | **room** | "Campaign room" is the old name; "room" is the header's word and the Room view's |
| The header's room control | "room button" 5 | **the room button** (at the top of the screen) | It is a button, labelled Join, Room or the room's code. "Header" is a developer's word, so the sentences say "at the top" |
| A player's character | hunter 101, character 0 (the 15 hits are "6-character code" and formula errors) | **hunter** | The only word in use |
| What a hunter carries | bag (chip "Bag", one toast), inventory (panel title "Inventory") | **bag** | The sheet's chip says Bag and the chips are what a player taps; the panel title changes to Bag to match |
| What a hunter wears | gear 10, equipment 1 (chip "Gear", panel title "Equipment") | **gear** | Same reason: the chip, Loadouts' "the gear you have on" and the toasts say gear |
| A status on a body | status 88, condition 11 | **status** | The Workshop, the makers, the fight and the map say status. "Conditions" (the sheet's heading, "Add condition", "No conditions.") changes |
| What a hunter holds (Skills panel) and what a body uses in a fight | skill 34, ability 22 | **skill** on the sheet, **ability** in a fight | Two things, not one: an ability is anything usable in a fight (the weapon's attack, a skill, an item's use), a skill is what a hunter learns. Kept apart on purpose |
| Points spent on stats | ability points 9, points 1 (the reward editor's "Points") | **ability points** | The sheet's and the rules' word. The reward editor's bare "Points" becomes "Ability points" |
| The person running the game | GM 93, "Game Master" 1 (onboarding title) | **GM** | One name. The onboarding title keeps "GM" |
| A creature of the GM's | monster 49, enemy 5 | **monster** | "Enemy maker" (3) becomes "monster maker" |
| The other side in a fight | foe 22 | **foe** (and **ally**) | A side, not a kind: a monster's foe is a hunter |
| A lasting effect on the ground | field 12 visible (ability maker, refusals, detail), zone 5 visible (map maker, Paint, the cap toast) | **field** | Most used, the kits design's word. "Zone" also reads as the Penalty Zone, a quest. The map maker's "Zone name", "+ Zone" and "Remove zone" and the paint cap become "field". A form's input is called by its label, never "the field" |
| A saved reward to give again | bundle 15, reward bundle 1, the Workshop's "Rewards" and "New reward" | **bundle** | The Award form and the reward editor say bundle. In the Workshop "a reward" also means what is given, so the section is "Bundles" with "New bundle" |
| The GM's list of what the GM made | Workshop 8 | **Workshop** | Only word; its kinds are Statuses, Items, Skills, Monsters, Bundles, Maps |
| A saved set of gear | loadout 2 | **loadout** | Only word |
| What a fight's map is | map 30, battle map 3, arena 3 | **map**, the default one **open arena** | One word for the thing; "open arena" names the default map only |

The Workshop's buttons drop the "+" of "+ New status", so all six read "New status", "New item", "New skill", "New monster", "New bundle", "New map".

## Decision trail

- Fight over encounter: "Encounter" read as a second thing (a list of monsters before a fight) in "Build encounter"; the bar and the card already say "fight". The tab "Combat" was weighed against "Fight": a tab names a place, and changing it moves the bottom nav every player knows. Kept.
- Field over zone: weighed three ways (field everywhere, zone everywhere, field in the makers and zone on the map). The third keeps two names for one thing. Zone everywhere would touch more sentences and clashes with the Penalty Zone. Field.
- Bundle over reward for the saved thing: the Workshop's "New reward" sits beside the Award form's "Bundle" select for one thing; "reward" alone already names what a quest or an award gives.

## Step 2: the inventory

### The rows of `copy-tasks.md`

The file is older than the code; the code wins. "Marked" means a `TODO(copy)` in code covers the row, so step 3 reads it with its file. "Stale" names what replaced the thing. "Final" means the words in code already meet the voice and the glossary.

| Row or group | State | Where it goes |
|---|---|---|
| 1, 2 manifest name, short_name, description | still there, unmarked | step 4: `short_name` "Hunter System" is 13 characters, over the 12 the row asks |
| 3 apple-mobile-web-app-title | still there, marked (`index.html:16`) | step 3 with row 1 |
| 4 dice.js "Dice view" button | still there, marked (`dice.js:262`) | step 3, dice.js |
| 5, 6 gm.js Reset rules confirm and its lines | still there, marked (`gm.js:555`) | step 3, gm.js |
| 7 combat.js `[removed: N XP]` | still there, marked (`combat.js:415`) | step 3, combat.js |
| 8 gates.js `[paid: N XP]` | still there, marked (`gates.js:314`) | step 3, gates.js |
| 9 path names and flavour lines | still there, marked (`paths.ts:27`, was rules.js) | names in step 3; the flavour line needs a field and a place to draw it: left, step 4 |
| 10 to 15 custom.js look picker and Device view | still there, marked | step 3, custom.js |
| 16, 17 loadout toasts and empty state | partly stale: "Armor stays on during a fight." and the weapon-only note are gone (W4: "Gear cannot change during a fight."); the rest marked | step 3, custom.js |
| 18 to 25, 30, 31 build and path words | still there, marked (custom.js, build.ts); row 31's "Rank E: STR +2" menu is gone | step 3 |
| 26 GM build toast "N player(s) on an older app version" | stale: the build handshake holds every phone to one build, the line is gone | none |
| 27, 28 the board card's path label, the path skill row | unmarked; read in step 3 with gm.js and skills.js | step 3 |
| 29 `[gate cleared: XP already paid]` | still there, marked (`combat.js:417`) | step 3, combat.js |
| 32, 39 header pill and Data panel row (was sync.js) | moved to `room-pill.ts`, marked | step 3, room-pill.ts |
| 33 to 38 Room view words | still there, one mark (`room.js:62`); "Codes have 6 letters" is gone (taps.ts's words) | step 3, room.js |
| 40 blocked GM mode | stale: removed with the stored role (the file says so) | none |
| 41 to 44 onboarding tips, invite window, field hint, Open a room? | still there, marked | step 3, onboard.js |
| 45, 46 GM tab room strip and "room button" messages | still there, marked | step 3, gm.js |
| Phase 3 strings: `STUCK_TEXT`, `ROLE_IN_ROOM`, the pill's aria, the settings line, the reducer's log lines and refusals | `ROLE_IN_ROOM` marked (`app.js:231`); the fight's log lines and refusals now live in `fight.ts`, `fight-turn.ts` and `refusal-words.ts` (marked); `encounter.ts` is gone | step 3 |
| Phase 3, P4 `status.ts` describe lines | moved to `effect-ops.ts` (`describeStatus`, `opLine`), marked | step 3, core |
| Customization units 1 to 6 | the forms they name were replaced by the makers (`maker.js`, `forge.js`, `loot.js`, `skills.js`, `bestiary.js`, `reward-editor.js`, `workshop.js`), each marked; `use.ts` `outcomeText` is gone (W6: an item's own lines) | step 3, by file |
| Unit 6: the session log's title and text run together; the date month first | unmarked | step 4 |
| UI run: "+ New status", "Awarded to 0 local hunters", Store beside Add item, "Failed 0" wraps | unmarked | step 4 |
| Unit 0: Max HP and Max MP labels | "Max MP" is gone (mana); read with maker.js | step 3 |
| Milestone 2, W1a to W9 | marked in their files (effect-ops, combat, table, uses, inventory, skills, hunter, gm) | step 3 |
| The coin call | marked (`coin.js`, `coin.ts`) | step 3 |
| The battle map, milestones 3, 5, 6 and the auras merge | marked (`map.js`, `map-view.ts`, `fight-view.ts`, `combat.js`, `table.js`, `map-maker.js`, `maker.js`, `ability-kinds.ts`, `workshop.js`, `io.js`, `room-pill.ts`) | step 3 |
| `taps.ts` (V4, N9) | marked (`taps.ts:15`) | step 3 |

### The marks in code

202 marks at 61356fc, in 52 files. Each is read in step 3 with its file; the step 3 log below says, file by file, which words changed and which were already final.

| Mark | What it covers | State |
|---|---|---|
| `src/edge/room-events.ts:109` | the toast when the GM's fight took a player's item | still there |
| `src/edge/room-events.ts:141` | a shadow the GM's phone raised for this hunter, and one an army at its cap could not take | still there |
| `src/edge/room-events.ts:229` | what a player sees when the GM starts, reissues or abandons their Job Change | still there |
| `src/edge/room-pill.ts:14` | header room pill labels (Join, Room, Offline, Opening, Joining, Updating, Updating 40%, Reloading, Out of date) and aria-labels | still there |
| `src/edge/room-pill.ts:66` | Data panel texts (no server, state line, Open room) | still there |
| `src/edge/sync.ts:224` | an invite to the room this phone is in | still there |
| `src/edge/sync.ts:399` | the room gone toast, the GM key lost toast | still there |
| `src/edge/sync.ts:440` | a GM message this phone could not apply | still there |
| `src/edge/sync.ts:594` | a full outbox | still there |
| `src/edge/sync.ts:622` | a message the room did not take | still there |
| `src/edge/store.ts:88` | the store's lasting banners; `fight` is new | still there |
| `src/views/detail.js:48` | a detail with nothing to add to the thing's own line | still there |
| `src/views/dice.js:85` | a typed roll's faces, and "N successes" | still there |
| `src/views/dice.js:164` | a recent typed roll, tapped to roll again | still there |
| `src/views/dice.js:262` | label for the button that opens the full Dice view (checks + roll log) from the quick-roll sheet (currently 'Dice view') | still there |
| `src/views/quests.js:172` | the GM's toast for a Job Change sent to a player | still there |
| `src/views/reward-editor.js:14` | the reward editor's words (chips, row labels, pickers, the boon's line, errors, the bundle row, the preview) | still there |
| `src/views/reward-editor.js:211` | (no note: a line of the block above) | still there |
| `src/views/reward-editor.js:333` | (no note: a line of the block above) | still there |
| `src/views/custom.js:74` | picker helper line  | still there |
| `src/views/custom.js:96` | window title | still there |
| `src/views/custom.js:134` | device settings intro  | still there |
| `src/views/custom.js:137` | motion hint  | still there |
| `src/views/custom.js:140` | no vibration support  | still there |
| `src/views/custom.js:190` | a gear swap refused in a fight | still there |
| `src/views/custom.js:217` | loadouts empty state  | still there |
| `src/views/custom.js:249` | respec refusals | still there |
| `src/views/custom.js:280` | GM perk menu entries | still there |
| `src/views/custom.js:288` | a build change sent | still there |
| `src/views/custom.js:307` | (no note: a line of the block above) | still there |
| `src/views/custom.js:313` | (no note: a line of the block above) | still there |
| `src/views/custom.js:321` | paid respec window | still there |
| `src/views/custom.js:352` | (no note: a line of the block above) | still there |
| `src/views/custom.js:353` | no-path prompt  | still there |
| `src/views/custom.js:366` | paid respec button  | still there |
| `src/views/ui.js:10` | a maker's save the store refused | still there |
| `src/views/coin.js:62` | a landing ruled while this phone is in no room | still there |
| `src/views/coin.js:107` | the coin card's words | still there |
| `src/views/coin.js:152` | the GM's coin call window | still there |
| `src/views/room.js:62` | all Room view texts below (labels, buttons, hints, errors); short, plain, no flavor | still there |
| `src/views/room.js:289` | why a GM's action on a sheet did not happen, by how the room answered (src/core/sync/outbox.ts `Call`) | still there |
| `src/views/onboard.js:17` | where to create a room now | still there |
| `src/views/onboard.js:23` | where to join now | still there |
| `src/views/onboard.js:99` | the four join problems, in the player's words | still there |
| `src/views/onboard.js:139` | tag, title and intro of the invite window, the "other options" link | still there |
| `src/views/onboard.js:150` | room found line | still there |
| `src/views/onboard.js:153` | Try again, Continue without a room | still there |
| `src/views/onboard.js:207` | the hint to clear the field | still there |
| `src/views/onboard.js:242` | the "Open a room?" title, line and the two buttons | still there |
| `src/views/workshop.js:16` | the Workshop's headings, its empty lines, its buttons and its confirms | still there |
| `src/views/workshop.js:81` | the examples' fold and its Duplicate | still there |
| `src/views/forge.js:57` | "Strength" and the Status dialog's other labels | still there |
| `src/views/kit-parts.js:13` | the kits' groups in the makers (their summaries, labels and errors) | still there |
| `src/views/kit-parts.js:264` | the ability form's kits groups (Costs more, Only when, Tags, Moves, Reaction, Summons, Acts on a field) | still there |
| `src/views/uses.js:62` | a use posted while the room does not answer | still there |
| `src/views/uses.js:70` | a use from a player's phone in the GM's fight: not the turn, nobody in reach, the target picker | still there |
| `src/views/uses.js:96` | the toast for a use the GM is told of | still there |
| `src/views/combat.js:126` | a monster's stagger bar filled | still there |
| `src/views/combat.js:130` | a fight that ended itself | still there |
| `src/views/combat.js:292` | a use with nobody in reach | still there |
| `src/views/combat.js:295` | the target picker of a use | still there |
| `src/views/combat.js:415` | line for XP from defeated monsters already removed from the tracker | still there |
| `src/views/combat.js:417` | line for a fight whose gate already paid all its XP (its Clear or an earlier fight) | still there |
| `src/views/combat.js:423` | the loot line of the end window | still there |
| `src/views/combat.js:455` | the loot window and its Set aside | still there |
| `src/views/combat.js:491` | was "Roll initiative now" | still there |
| `src/views/combat.js:714` | a paint the fight refused | still there |
| `src/views/combat.js:784` | the card's numbers, and the extras: stagger, channel, taunt, intent and threat | still there |
| `src/views/combat.js:800` | an ability on cooldown on the GM's card | still there |
| `src/views/combat.js:804` | the move control | still there |
| `src/views/combat.js:821` | Extract by one of several hunters | still there |
| `src/views/combat.js:834` | a row's reaction on the GM's card: None and each reaction, and Ready or Spent | still there |
| `src/views/combat.js:835` | a reaction before a named body's turn, and whose turn it waits for | still there |
| `src/views/combat.js:863` | the GM's intent picker | still there |
| `src/views/combat.js:942` | the quick line's error | still there |
| `src/views/combat.js:966` | a map size the fight refused | still there |
| `src/views/combat.js:1068` | the Fight tools' map size | still there |
| `src/views/combat.js:1074` | the bar in Map view while a fight runs, and the Fight tools sheet | still there |
| `src/views/combat.js:1077` | the order ahead | still there |
| `src/views/combat.js:1078` | an ended fight's header | still there |
| `src/views/combat.js:1079` | was "Roll initiative to begin" | still there |
| `src/views/combat.js:1082` | the fight screen's Map and List | still there |
| `src/views/combat.js:1095` | Surprised at the start of a fight | still there |
| `src/views/combat.js:1151` | was "...shadows or a custom combatant to begin." | still there |
| `src/views/map.js:195` | the map's Grid, Cancel, Move and Use | still there |
| `src/views/map.js:289` | a target the picked ability cannot reach | still there |
| `src/views/map.js:482` | a token's name for a screen reader | still there |
| `src/views/map.js:483` | a token's mark while a place ability is aimed: caught in the splash, or in its outer ring | still there |
| `src/views/map.js:622` | a player's move on its way to the GM's phone | still there |
| `src/views/map.js:647` | the map's row for the current turn | still there |
| `src/views/map.js:661` | a staggered monster in the map's turn order | still there |
| `src/views/map.js:668` | the map's words while moving and aiming | still there |
| `src/views/map.js:688` | the hotbar's costs, waits and More | still there |
| `src/views/map.js:694` | a reaction on the hotbar, and an ability's uses left | still there |
| `src/views/map.js:706` | the hotbar's Release of a channel and its payoff | still there |
| `src/views/map.js:711` | the hotbar's End turn | still there |
| `src/views/map.js:723` | the map's Paint and its brushes | still there |
| `src/views/effects.js:29` | a use outside the fight while a fight holds the hunter | still there |
| `src/views/bestiary.js:166` | the kinds' and archetypes' names on a card and in the enemy maker | still there |
| `src/views/bestiary.js:196` | the enemy maker's labels, its list rows and its preview lines | still there |
| `src/views/bestiary.js:250` | an ability row's Edit | still there |
| `src/views/bestiary.js:283` | (no note: a line of the block above) | still there |
| `src/views/bestiary.js:388` | the generated monster's toast | still there |
| `src/views/skills.js:26` | the five kinds' names, "No fight use", and the skill's lines | still there |
| `src/views/skills.js:52` | a skill used from the Skills panel during a fight on this phone, and outside a fight | still there |
| `src/views/skills.js:67` | the skill maker's labels, its preview lines and its errors | still there |
| `src/views/skills.js:206` | a reaction holding a use's own op | still there |
| `src/views/skills.js:211` | a skill the library holds under that name, and a full library | still there |
| `src/views/skills.js:248` | a skill given while this phone is in no room | still there |
| `src/views/skills.js:257` | the Give to… window and its toast | still there |
| `src/views/skills.js:291` | "Given to: Brakk, Mira (player)" | still there |
| `src/views/skills.js:312` | the list's labels for a library skill | still there |
| `src/views/hunter.js:197` | a player's hand edit refused in the GM's fight | still there |
| `src/views/hunter.js:240` | a rest refused in a fight | still there |
| `src/views/hunter.js:256` | the window when storage holds no backup of the hunter about to go | still there |
| `src/views/hunter.js:654` | the share replaced "80+" | still there |
| `src/views/hunter.js:657` | (no note: a line of the block above) | still there |
| `src/views/hunter.js:664` | the Redeem confirm and its toast | still there |
| `src/views/hunter.js:674` | the GM's remove-boon confirm | still there |
| `src/views/maker.js:74` | the effects editor's words (kinds, modes, placeholders, errors and quick chips) | still there |
| `src/views/maker.js:515` | the formula field's words (its ticks, "edited", Reset, the averages line) | still there |
| `src/views/maker.js:683` | the ability form's groups, their summaries and fields | still there |
| `src/views/maker.js:756` | a field's end with nothing in it | still there |
| `src/views/maker.js:810` | the ability form's field group | still there |
| `src/views/maker.js:882` | the preview's heading and its empty line | still there |
| `src/views/maker.js:920` | the discard question | still there |
| `src/views/maker.js:1001` | a long list's search field | still there |
| `src/views/gates.js:314` | say the encounter already paid this much of the gate's XP  | still there |
| `src/views/inventory.js:34` | an equip refused in a fight | still there |
| `src/views/inventory.js:60` | an item used while this phone's fight is being set up, and one the fight's row does not hold | still there |
| `src/views/inventory.js:72` | an item used on another outside a fight | still there |
| `src/views/inventory.js:78` | an item use sent to the GM's fight | still there |
| `src/views/inventory.js:83` | (no note: a line of the block above) | still there |
| `src/views/inventory.js:155` | the gear words (weight, armor, resist) on an item's line | still there |
| `src/views/inventory.js:180` | (no note: a line of the block above) | still there |
| `src/views/gm.js:254` | the no-room line, "Open CODE as GM", "New room", "Create room" | still there |
| `src/views/gm.js:260` | the state words, "Invite", the empty-room line | still there |
| `src/views/gm.js:312` | a message the GM posts while the room does not answer, and one this phone could not post | still there |
| `src/views/gm.js:322` | the board's HP edit of a hunter in the fight | still there |
| `src/views/gm.js:376` | the Award form opened with a reward | still there |
| `src/views/gm.js:405` | (no note: a line of the block above) | still there |
| `src/views/gm.js:411` | where a GM opens a room now (header room button) | still there |
| `src/views/gm.js:436` | where a GM opens a room now (header room button) | still there |
| `src/views/gm.js:466` | Start session's line when the browser refused the backup, and when the day did not move | still there |
| `src/views/gm.js:479` | the day that did not move | still there |
| `src/views/gm.js:531` | why an override is refused; `statuses` points the GM at the Status dialog. | still there |
| `src/views/gm.js:555` | Reset-rules confirm should say forged statuses are kept | still there |
| `src/views/gm.js:564` | the notification button's states | still there |
| `src/views/gm.js:575` | the count's spoken words | still there |
| `src/views/gm.js:621` | the GM view's top: "Reward uses" and its count | still there |
| `src/views/gm.js:622` | the Make row's label and its buttons | still there |
| `src/views/table.js:168` | the HUD's Map and List, and a token's card on the map | still there |
| `src/views/table.js:246` | the HUD's actions, "Toward" and "Away" from the nearest foe, "Ready in N rounds" | still there |
| `src/views/table.js:346` | a reaction armed or disarmed, and one that was not posted | still there |
| `src/views/table.js:355` | a pass that was not posted | still there |
| `src/views/table.js:400` | a tap while this phone's last command waits for the GM's phone | still there |
| `src/views/table.js:421` | the extras on a player's card: shield, stagger, channel, taunt, intent and the suggested target | still there |
| `src/views/table.js:426` | a teammate's reaction: ready, or spent since its turn began (the doc says not which one) | still there |
| `src/views/table.js:448` | a step that was not posted | still there |
| `src/views/table.js:589` | the Table feed's row for a use | still there |
| `src/views/io.js:29` | the share windows, the kinds' words and the code window | still there |
| `src/views/io.js:89` | a backup that storage could not keep | still there |
| `src/views/io.js:265` | a backup that storage could not keep | still there |
| `src/views/map-maker.js:16` | the map maker's labels, brushes and preview lines | still there |
| `src/views/shadows.js:70` | a shadow risen for a player's hunter, told on the GM's phone (the player's phone says ARISE) | still there |
| `src/views/loot.js:15` | the item maker's labels | still there |
| `src/views/loot.js:66` | "Affects", "The user", "A target", "Tell me when it is used", "Attacks with", "Fill from a kit" | still there |
| `src/views/loot.js:151` | the blank price's and weight's placeholder, the rule's number | still there |
| `src/views/loot.js:177` | the worn speed line | still there |
| `src/views/loot.js:190` | an item the library holds under that name | still there |
| `src/views/rulesref.js:7` | what each stat gives, in the rules reference | still there |
| `src/app.js:231` | the two lines the mode pill shows in a room | still there |
| `src/core/hunter/sheet.ts:128` | the names of a sheet number's parts, as its detail lists them | still there |
| `src/core/hunter/build.ts:78` | the reward lines of a build change | still there |
| `src/core/combat/fight.ts:380` | (no note: a line of the block above) | still there |
| `src/core/combat/fight.ts:615` | an extraction's log line | still there |
| `src/core/combat/fight-view.ts:129` | an intent's numbers once the GM reveals them | still there |
| `src/core/combat/map-view.ts:418` | the words of a move's cost on the map | still there |
| `src/core/combat/effect-ops.ts:638` | the lines a status card, an item card and a status toast show (docs/agent-handoff/copy-tasks.md, W1a). | still there |
| `src/core/combat/effect-ops.ts:735` | wave 2's op words (kits design 8.12) | still there |
| `src/core/combat/effect-ops.ts:756` | a trigger's and an end's sentence in the status maker's preview (kits design 5.1) | still there |
| `src/core/combat/effect-ops.ts:787` | how a stacking status's stacks leave, after "Stacks to N." | still there |
| `src/core/combat/refusal-words.ts:10` | the words of a refused fight command; the lines marked "new" had none before | still there |
| `src/core/combat/refusal-words.ts:26` | a player's tap the GM's phone turned down | still there |
| `src/core/rewards.ts:162` | a reward's lines, in the quest window and the quest card. | still there |
| `src/core/rewards.ts:178` | the reward window's lines | still there |
| `src/core/gates/world.ts:70` | the session line when the browser refused the backup | still there |
| `src/core/gates/gate.ts:176` | a gate's countdown words | still there |
| `src/core/detail.ts:38` | what a zone does, by its tone, on a tap | still there |
| `src/core/detail.ts:57` | the lines a detail adds to core's sentences: a count, the rounds left, a sheet number's parts | still there |
| `src/core/registry/worth.ts:163` | the words of each block the worth line cannot estimate (copy-tasks.md) | still there |
| `src/core/registry/worth.ts:349` | the worth line under every maker's preview (design 5.1) | still there |
| `src/core/registry/ability-kinds.ts:197` | the sentences the ability maker's preview says (docs/agent-handoff/copy-tasks.md, M4) | still there |
| `src/core/registry/ability-kinds.ts:221` | an ability that leaves a field | still there |
| `src/core/registry/ability-kinds.ts:234` | the kits' sentences in the ability maker's preview (kits design 5.1) | still there |
| `src/core/registry/ability-kinds.ts:242` | wave 2's sentences in the ability maker's preview (kits design 8.12) | still there |
| `src/core/registry/scalers.ts:27` | each scaler's name and the end of its sentence in the ability maker's preview (copy-tasks.md, M4) | still there |
| `src/core/registry/paths.ts:27` | path names and one-line flavour text | still there |
| `src/core/sync/taps.ts:15` | what a failed Create or Join says, on the Room view, the GM view and onboarding | still there |
| `src/core/coin.ts:187` | the coin's session log line | still there |
| `src/core/coin.ts:228` | the GM's ruling line | still there |
| `public/index.html:16` | home-screen app title (max ~12 chars) --> | still there |

## Step 3: file by file

Each file's marks are gone in its commit; words already right stayed. "Tests" names the tests whose looked-for words changed with it.

- `scripts/ui-shots.ts` (506439e, the lead's request): it waited for words the app no longer says. Three causes, each from its run: the refused code is `tapWords`' "There is no room ZZZZ22." (was "No room with that code"); the loot window's first button is "Later" (was "Close"); the penalty window is shown by the rollover the store change itself arms (`app.on('change', arm)` in quests.js), so the script's `page.reload()` threw that window away. After the three: 138 shots, no step failed. Two earlier runs each had one other step time out on the 390 pass (a tap, an evaluate) that the next run passed; no cause found in the app, consistent with a pause of the box.
- `combat.js` (6963e10): "encounter" becomes "fight" everywhere a GM reads it: End fight, Clear the fight?, Add to the fight (was Build encounter), Fight log, the end window "Fight over" (tag "! Fight"), "Fight rewards", Start fight in the party dialog, "The GM is not running a fight.", "Dismiss this fight". The end window's placeholders: "Monsters removed from the fight: N XP" and "The gate's XP is already paid.". The loot window's body says what its two buttons do. The quick line's error shows a filled example. Taunt rounds take their plural. The paint cap says fields. Tests: combat-turns, gates-quests-dailies, table-session, table-turn, battle-map (a test name), the lint's literal-cap regex and its case ("16 fields at most"), ui-shots.
- `gm.js` (7d6981a): the room button "at the top" (not "in the header"); the Make row's "Monster" and "Bundle"; "Random fight (by rank)"; the Reset rules confirm says what stays (roll tables and the Workshop); "Session 42 began on day 8. A backup was saved."; a broadcast "for the hunter picked on this phone"; the gate seed's "drain mana". Tests: gates-quests-dailies. "Awarded to 0 local hunters" (step 4) was already gone (`sentTo`).
- `custom.js` (b79ad7b): the picker's title "Emblem and color"; the Device view's notes; "No longer in the bag: X." for a loadout item that is gone; "There is no path to respec."; the path window's body; "The GM has turned builds off. Your path is kept."; "Reset build rules" (was "Default rules", which reset only the build switches). Tests: customization.
- `map.js` (bf57bce): the aim line "Hits A. In the ring: B." (was "; edge:", while the token's mark says "Ring"). Tests: battle-map.
- `table.js` (7f31635): the HUD's title "Fight", the banner "In a fight · Round N", "Your statuses", "The GM cleared the fight.", plurals of rounds. Tests: table-session.
- `skills.js` (461e696): the reaction refusal names the checkbox it means ("untick A reaction"). Tests: makers.
- `onboard.js` (4103e80): the tips name today's tabs and the room button at the top; "Run the game" for the GM step (was "Game Master"); "Or clear the room code to begin without a room."; "Join a room (optional)". The onboarding chart's words follow (408f016).
- `maker.js` (ba3fc5c): "Its defense", "whoever stands in it", a field's round plural.
- `inventory.js` (01e1625): the panels are titled Gear and Bag, as the sheet's chips; "Gear weight"; "New item…" beside Store, so the two buttons differ (Store adds a named item at once, New item… opens the maker).
- `hunter.js` (8bf01f6) and `combat.js` (5d6ffdb, a491920): Statuses for Conditions, "Add status", "Remove status X", "No statuses."; the check toast "(critical)" without its exclamation; "A check's bonus is …". Tests: character.
- `loot.js` (42fec65): "Fill with typical gear", "in medium gear: speed …". `bestiary.js` (91b751b, 3741ba8): the monster maker's name, "Add to fight ×N".
- `dice.js` (fa26afb): "Dice tab" on the quick sheet, "Critical hit." `io.js` (9c5d03b, 2d1a4fd): bundles in the share words, "Reset canceled: type RESET exactly to reset." `reward-editor.js` (5bebef9) and `workshop.js` (a80dbc6): Bundles, New bundle, Edit bundle, Save bundle, "Delete bundle?", New status without its plus, the status section's line without "condition". Tests: makers, sharing.
- `room.js` (c1b522b): "Reconnecting. The server does not answer yet." with "Your changes are kept on this device and sent when it is back online."; "Release to a new device" (was "Let another device claim"); "Room ABC234 no longer exists." (was a guess that the server restarted); the why-not words without "(offline?)" and the semicolon. Tests: room-sync-fixes.
- The small views, a commit each (9466c4d to 59e825f): shadows "Extraction failed"; rulesref Statuses, defense, "fight tools", the monster maker, "a full set of gear"; quests "HP and mana fully restored"; map-maker New field, Field name, Remove field, default names "Field N"; gates Start fight, the paid XP as a sentence, and "Gate cleared?" for the question after a gate's fight (it was titled like the end window). kit-parts, ui, forge, effects, detail, uses, coin and app.js: the words were already final; only the marks went.
- Edge (12d501c to cc7594a): one ARISE tag; "Room: none open" and "Join a room" in the pill's aria; "Offline: the server does not answer, so you play on this device"; who left the room in the gone and key-lost toasts; a full outbox "dropped" (was "let go"); the load banners without semicolons. Tests: room-sync-fixes, save.
- Core (403261b to 7f60366): a busy tap "Another create or join is under way."; the session line "A backup was saved."; a respec's reward line "Path and perks cleared: choose a new path."; `REFUSAL_WORDS` "channeled" and a player's "You did not have that when the fight began." (was "kit"); `grantLines` "+50 gold" and "+2 ability points" in lowercase as `rewardLines` has them; `opLine` splits two lines at their clause and says "center"; `describeAbility` splits two at their clause and says "fields"; the fight's log says a monster "is defeated" and a hunter "is down" (fight-turn.ts already raised `defeated` for every row but a hunter's); the gate's log "Fight started" and "Fight ended"; the sheet's "Gear weight". The coin, the gate countdown, the sheet's part names, the scalers, the details and the worth line were already final. Tests: world, fight-save, rewards, quests, applied, effect-ops, ability-kinds, used.
- Op lists stay joined with "; " ("1d6 damage a round; Cures Burning"): there the semicolon separates items of a list, not two clauses, and every status card and test reads that join. Weighed against ", " (an op line holds commas of its own) and one line per op (the toast and the GM card show one line). Kept.

### Sentences a view builds that belong in core (noted, not moved; no lint asks yet)

`combat.js` the end window's lines (`endEncounter`) and `lootText`; `gates.js` the clear panel's XP line; `inventory.js` `metaLine` and the Gear summary; `room.js` `whyNot` and the roster counts; `gm.js` `notPosted` and the award's sent line; `custom.js` `RESPEC_WHY`; `bestiary.js` the generated toast; `map.js` the aim line ("Hits A. In the ring: B.").

## Step 4: what the marks did not cover

- The manifest's name and description: `short_name` and the iOS title are "Hunter" (6 characters; "Hunter System" is 13, over the 12 iOS shows). One plain description in the manifest and `index.html` (ce2626f).
- The label sets: the Device view, the build panel's GM row, the Room view and the Workshop were read as sets in step 3.
- The session log's date: the row already calls `toLocaleString()` with no locale, so it reads in the phone's own language. The "month first" in the old shot was the test browser's en-US. Numbers keep `'en-US'` on purpose (one grouping comma for every phone); that is a number format, not a date. Nothing to change.
- A use's log row: the title and the text are already two block lines (`.lt`, `.lx` in gm.js). Nothing to change.
- "Awarded to 0 local hunters": gone before this pass (`sentTo` in gm.js says "Sent to Mira."). The broadcast's "N selected local hunters" was the same habit and changed.
- "+ New status": changed in workshop.js.
- Left, needs a field: the path flavour lines (row 9). A path has no `desc`; it needs a field on `PathDef` (`registry/paths.ts`) with its reader in the rules override, drawn in the path window (`choosePath`, custom.js) and under each path button. Words only cannot do it.
- Left, needs a control: none other.

## Step 5: the class

`grep -rn "TODO(copy)" src public server.ts` prints nothing. The lint "no placeholder words are left marked" (`tests/lint.test.ts`) reads every text file of `src` and `public` and `server.ts`; its first case is a marked line, and a probe mark in `public/app.css` made it fail at that line before it was taken out. `copy-tasks.md` is now the voice, the glossary and how a new sentence is checked; AGENTS.md's link recipe still finds the pill words and `STATE` listed there.

## Step 6: close

- `bun run deps -- --write` and `bun run charts`: no change after the pass (the chart's one change is 408f016).
- `bun run typecheck`: passes. `bun run test`: "Ran 3513 tests across 92 files", 3510 pass, 0 fail.
- Every browser file but feel.e2e.ts, one at a time on port 3260. Four failed once, each because it looked for words this pass changed, and each was changed to the new words only: character.e2e.ts:613 ("a condition ends", rulesref.js), room-sync-fixes.e2e.ts:105 and room-view.e2e.ts:233 and upgrade.e2e.ts:111 ("Room X is gone", room.js). Those test edits belonged in the commits of rulesref.js (b19afaf) and room.js (c1b522b); they landed after, in 7c0d3dc, a3a6ac1 and 93f4a94, because my grep before those commits missed them. Rerun after the fix: character 24 passed, room-sync-fixes 16 passed, room-view 10 passed, upgrade 6 passed. No file was flaky; every other file passed on its first run.
- `scripts/ui-shots.ts` at the end: 136 shots, one step failed, "gm-1280 move control and target picker: evaluate: Timeout". The same step failed once on the 390 pass in an earlier run and passed in two others. Evidence: the debug shot of the earlier 390 failure (the run with `--debug`) shows the list with the current row's card not open and no Move control on the card shown, so the step's loop (pick the current row, else Next, 12 times) ended without a card holding `[data-toward]`, and `show()` then timed out on a locator that never came. The opening order is rolled with crypto dice (`src/edge/roll.ts`), so which rows come up in those 12 turns differs per run. Why no current row of the GM's phone drew the Move control in 12 turns is not found (a guess: the monsters' rows had no foe in `aims` that turn). The app's tests of the move control (combat-turns, battle-map) passed. Left for the lead; the script's wait was not changed.
- A `bun server.ts` on port 3242 from `scratchpad/look-wt` (not this unit's; started before the close loop) was running at the end. This unit leaves none of its own.
