# Customization inventory

Base commit 2eb5db5. Read only: no app code or test changed. Every `file:line` is at that commit. Tap counts are read from the views, not run: they start on the home screen (Status, `app.js:134`), count taps only (typing is not a tap), and assume a phone, where the GM's bottom bar is GM, Combat, Quests, Dice and More (`app.js:87`) and the GM view's sections start collapsed except Party (`gm.js:96`).

## 1. Each kind

### Ability or skill

There are three different things here. A hunter's skill is a typed record. A monster's ability is a line of text. A shadow has no abilities.

| What | Fact |
|---|---|
| Type | `Skill` (`save.ts:80-85`): name, type active or passive, level, label, grade, mpCost, cooldown, cdLeft, dice, desc, bonus, perk?. A monster ability is a string in `Monster.abilities` (`save.ts:118`). `Shadow` has no abilities field (`save.ts:93-97`). |
| Built-ins and parser | Skills: no core table. Eight seeds are a const in a view (`skills.js:5-14`). The save repair fills and clamps each skill (`save.ts:416-421`); it does not check `dice`. Monster abilities: the seeds' strings (`monsters.ts:17-40`), read at render by `parseAbility` (`ability.ts:20`). |
| GM makes today | Skill: Status view, Skills panel, "Add skill" form (`skills.js:93-161`), on the active hunter only. Monster ability: a line in the bestiary editor's "Abilities (one per line)" box (`bestiary.js:243`). |
| Taps | Skill: Skills chip (`hunter.js:276`), Add skill, Name, Acquire = 4. Monster ability: More, Bestiary, Edit, Abilities box, Save monster = 5. |
| Stored at | `hunters[].skills[]`. Monster ability text: `monsters[].abilities[]` (a seed edited is saved as a new custom copy, `bestiary.js:57`). |
| Same parser | Skill: the form writes in `store.update`, and every update runs the save repair (`store.ts:117-123`), so yes. The form checks dice by rolling them (`skills.js:141-142`); the repair does not. Monster ability: `clean` (`bestiary.js:51`) then the repair (`save.ts:525`, each string cut to 500). Seed strings pass no parser. |
| Lookup | Skill: `h.skills.find` in `skills.use` (`skills.js:46`); no registry. Ability: `parseAbility(text, rules().conditions)` for seed and custom alike (`combat.js:282`). |
| Reaches a room | A player's skills ride on their sheet (`protocol.ts:374-384`, each list cut to 100). No room message carries a skill to a player (`protocol.ts:180-183`). Monster abilities: the codex doc carries at most 4, each cut to 70 characters (`protocol.ts:331`, `bestiary.js:74`); the encounter doc carries none (`protocol.ts:266-268`). |
| Export and import | Skills inside each hunter (campaign and hunter export, `io.js:164-173`). Monster abilities in the campaign export only. |
| Player | Adds, edits and deletes skills on their own hunter with no GM check (`skills.js:89-192`), and adds seeds (`skills.js:164-173`). |
| Missing | Using a skill spends MP, sets the cooldown, rolls its dice and shows a toast (`skills.js:45-59`). It hits nothing, applies no status and heals nothing. |
| | No skill library: a skill is typed again for each hunter; the seeds are in a view. |
| | The form never sets `grade` (always `'E'`, `skills.js:156`). |
| | A monster ability cannot hold structured mechanics; it is text read by regex. |
| | Shadows have no abilities: `combat.js:162` reads `s.abilities`, which a shadow never has. |

### Status effect

| What | Fact |
|---|---|
| Type | `StatusDef` = label, desc, color?, ops? (`status.ts:39`); `Op` (`status.ts:35`); an instance `Status` = key, rounds, def?, source? (`status.ts:48`). |
| Built-ins and parser | `STATUSES` (`statuses.ts:9-30`), served as `RULES.conditions` (`rules.ts:53`). Parser `sanitizeDef` (`status.ts:149-156`) over `sanitizeOps` (`status.ts:99-147`). |
| GM makes today | The Status dialog `openForge` (`forge.js:36-179`), opened from: GM view, Status library panel, "+ New status" (`forge.js:243-259`); a combat card's "+ Status" (`combat.js:635,783`); a remote card's "Status" on the GM board (`gm.js:218,335`); the Loot Forge's "Apply status…" chip (`loot.js:171`). The rules editor JSON can also add or override any `conditions` key (`gm.js:57,69-70`). |
| Taps | GM, + New status, Name, one effect chip, Apply = 5. |
| Stored at | `rulesOverrides.conditions[key] = { ...def, custom: true }` (`forge.js:28-33`). Also as `def` on each applied instance: `hunters[].conditions[]`, combatants' `statuses`, an item op's `applyStatus.def`. |
| Same parser | The dialog runs `sanitizeDef` before it saves (`forge.js:132`). At load, `rulesOverrides` is not repaired (`save.ts:506` only reads it); each read runs `sanitizeOps` inside `unresolved` (`status.ts:213`). The rules editor checks nothing under `conditions` (`gm.js:69-70`). Instances on a hunter run `sanitizeDef` at repair (`save.ts:330-339`). |
| Lookup | `statusDef(R, x)` (`status.ts:195-198`): the instance's def, else `R.conditions` (built-ins merged with overrides by `rulesOf`, `rules.ts:94`), else the key. Custom entries go through it. |
| Reaches a room | The `status` message carries the def as written and the source (`protocol.ts:153-159`): label cut to 40, desc to 200, at most 8 ops, a nested def two levels deep. Encounter doc rows carry key, label, rounds and color only (`protocol.ts:265,292-297`). The library (`rulesOverrides.conditions`) never travels. |
| Export and import | The library is in the campaign export only (inside `rulesOverrides`). Instances travel inside hunters. |
| Player | Adds any status their own rules know to their own hunter from the sheet (`hunter.js:341,399-400`). The Status library panel is GM-only (`forge.js:244`). A solo player reaches the dialog from a combat card (`combat.js:27,635`) and saves to their own `rulesOverrides`. |
| Missing | The dialog writes flat numbers only: no `tiers`, no `pct` (`forge.js:8-16,82-85`). |
| | No live preview of the status being made: `sync()` only lists kept extra ops (`forge.js:101-106`). |
| | No rank picker for a status put on by hand. |
| | A built-in cannot be edited in the dialog: Edit lists only entries marked `custom` (`forge.js:24`). |
| | No choice of `when` for an op. |

### Item

| What | Fact |
|---|---|
| Type | `Item` (`save.ts:86-90`); `ItemTemplate` = Item without id (`items.ts:76`); built-in `ItemDef` union by type (`items.ts:18-22`). |
| Built-ins and parser | `SHOP_ITEMS` (`items.ts:25-37`), `LOOT_ITEMS` (`items.ts:40-66`), `STARTER_GEAR` (`items.ts:69-73`), made into items by `itemOf` (`items.ts:82-87`). Four item parsers: `fixItem` (`save.ts:323-329`), `givenItem` (`protocol.ts:109-122`), `clean` (`inventory.js:20-43`), `cleanItem` (`quests.js:118-123`). |
| GM makes today | Loot Forge `item` (`loot.js:106-218`) from: GM view, Item library, "New item" (`loot.js:245-249`); Award, "Custom item…" (`gm.js:716`); quest rewards, "Custom…" (`quests.js:466-468`). Inventory panel's "Add / edit item" form (`inventory.js:214-234,318-334`) for a held item or the shop (shop buttons GM-only, `inventory.js:376`). |
| Taps | GM, New item, Name, a type chip, Save item = 5. |
| Stored at | `library.items[]` (`save.ts:148`, at most 200, `save.ts:166,518`); `shop: ItemTemplate[] \| null` (`save.ts:153,520`); `hunters[].items[]`; a quest's `rewards.items[]`. `lootTables` is `unknown` (`save.ts:151`) and nothing writes it (read only at `inventory.js:60`). |
| Same parser | Library and shop pass `fixItem` at every update (`save.ts:518,520`). A built-in passes `itemOf`, then `clean` or `fixItem` once a hunter holds it. The forge runs `sanitizeOps` on effects (`loot.js:209`). |
| Lookup | None by id: items are copied by value into a hunter (`put`, `inventory.js:66-73`; stacks by `stackKey`, `inventory.js:46`). Use reads `effectsOf` (`effects.ts:23-27`); equip bonus is `inventory.bonuses` (`inventory.js:87-103`). The same for custom and built-in. |
| Reaches a room | `award` and `quest` carry `GivenItem` (`protocol.ts:109-122`): every Item field but `id`, unknown keys dropped, at most 20 items (`protocol.ts:29`), qty 1 to 999, dice unchecked text of 30, effects sanitized. The library and the GM's shop never travel; a player's shop is their own. |
| Export and import | Library and shop in the campaign export; held items in hunter exports. |
| Player | Edits every field of any item they hold and adds new ones, with no GM check (`inventory.js:312-317,326-332,356`). |
| Missing | No one form has both: the forge has no bonus fields (keeps `ini.bonus`, `loot.js:202`) and the inventory form has no effects (`inventory.js:214-228`). |
| | Flat numbers only. An item op with `tiers` rolls 0 (`effects.js:47-48`, `rollFor` at `status.ts:223-224`). |
| | A `damage` op only writes a line; `applyStatus` hits only the user (`effects.js:46-49,64-66`). |
| | An item's `check` mod is ignored when worn (`inventory.js:94` reads ac, atk, dmg). |
| | The forge's Edit drops a heal or damage op that has `tiers` or `pct` (`rowsFromEffects` reads only `dice` or `amount`, `loot.js:95`). |

### Enemy (monster, shadow)

| What | Fact |
|---|---|
| Type | `Monster` (`save.ts:116-122`); `MonsterSeed` (`monsters.ts:11`); combat rows `Monster` and `Shadow` (`encounter-types.ts:38-44`); a hunter's `Shadow` (`save.ts:93-97`). |
| Built-ins and parser | `SEEDS` (`monsters.ts:17-40`), numbers from the rank table by `statBlock` and `seedMonsters` (`monsters.ts:43-66`). Custom: `clean` (`bestiary.js:47-54`) and the save repair (`save.ts:523-527`). Seeds pass neither. |
| GM makes today | Bestiary view: New monster editor (`bestiary.js:229-245,289,319-333`), Generate stat block (`bestiary.js:264-288`), Duplicate (`bestiary.js:300-303`), Edit of a seed saves a copy (`bestiary.js:57`). A quick-line combatant is saved on its first defeat (`bestiary.js:87-100`). Combat's quick line makes rows only, not monsters (`combat.js:311-346`). Gate spawn makes placeholder monsters (`gates.js:43-46`). |
| Taps | More, Bestiary, New monster, Name, Save monster = 5. Generate: More, Bestiary, Name, Generate stat block = 4. |
| Stored at | `monsters[]`; the defeat record in `codex` by `name|rank` (`save.ts:156,159`). |
| Same parser | Custom yes; `statusDefs` is only checked to be a list (`save.ts:526`). |
| Lookup | `bestiary.get(id)` (`bestiary.js:27`) over seeds plus custom (`bestiary.js:25`); `toCombatant` builds rows for both (`bestiary.js:30-43`). Gate packs prefer custom monsters (`spawnPool`, `spawn.ts:50-55`). |
| Reaches a room | No monster message. The codex doc (`protocol.ts:278-281,327-334`): name, rank, hp, ac, atk, dmg, 4 abilities of 70, kills, firstAt; at most 200 entries, cut to 15,500 characters (`bestiary.js:126`). Encounter rows show a monster's name, health band and statuses only (`protocol.ts:266-268`). |
| Export and import | Campaign export only. |
| Player | In a room, sees codex entries only (`bestiary.js:355-361`). The editor buttons are GM-only (`bestiary.js:225,345-347`). Shadows come from extraction or a GM grant (`shadows.js:18-27,73`). |
| Missing | The editor has no statuses: `statusDefs` is written only by auto-add and read by nothing (only hits in `save.ts:121,526`, `bestiary.js:53,98`). |
| | `toCombatant` drops `statusDefs` (`bestiary.js:36-39`). |
| | The editor cannot set `elite` (kept from the record edited, `bestiary.js:330`). |
| | No loot of its own: a monster has no drop list. |
| | Abilities are text with the reader's gaps (section 3). |

### Reward

| What | Fact |
|---|---|
| Type | `Rewards` = xp, points, gold, items, titleName, job (`save.ts:70`); `GivenRewards` (`protocol.ts:82`); an award adds `build?` (`protocol.ts:165`). |
| Built-ins and parser | The daily template's rewards (`rules.ts:42`). Parsers: `givenRewards` (`protocol.ts:123-130`), `cleanRewards` (`quests.js:124-128`), the save repair of a quest's rewards (`save.ts:408-409`: items only checked to be objects, plus effects). |
| GM makes today | GM view Award (`doAward`, `gm.js:378-398`): XP, gold, points, title, one item and its qty. Quest form rewards (`quests.js:591-598`): XP, points, gold, title, free-text job, many items. Gate Clear (loot roll, `gates.js:110-143`). Fight end XP (`combat.js:373-411`). A build change by award (`custom.js:326-342`). |
| Taps | GM, Award, a hunter, XP, Send award = 5. |
| Stored at | Not stored: an award is applied at once (`applyRewards`, `hunter.js:220-248`). A quest keeps its `rewards` until complete. The GM's log gets one line (`gm.js:396`). |
| Lookup | `applyRewards` for every reward. |
| Reaches a room | `award` and `quest` (both GM-only). Details in section 5. |
| Export and import | Only inside a quest inside a hunter. |
| Player | A player's own quest has no rewards (`quests.js:425,498-499`). |
| Missing | A reward cannot hold a status or a text line. |
| | No saved reward bundle (section 5). |
| | The Award form gives one item. |
| | A title reward is a name only; its bonus and description come from the receiving phone's `rules().titles` by name (`hunter.js:133-138`). |
| | No "tell me when it is used" flag. |

### Quest

| What | Fact |
|---|---|
| Type | `Quest` (`save.ts:74-79`); `QuestOffer` (`protocol.ts:91`). |
| Built-ins and parser | The daily template (`rules.ts:36-43`); Job Change steps (`jobs.ts:15-19`). Parsers: save repair (`save.ts:404-412`), `questOffer` (`protocol.ts:145-152`), `quests.issue` (`quests.js:142-157`). |
| GM makes today | Quests view, "+ New quest" form (`quests.js:402-520`); GM view, Issue quest (`gm.js:422-439`, one objective, no items, no title); the urgent roll table fills that form (`gm.js:503-512`). |
| Taps | Quests, + New quest, Title, a player box, Save quest = 5 (4 when no player is in the room: the active hunter is then pre-ticked, `quests.js:432`). |
| Stored at | `hunters[].quests[]`. No quest template or library; "Issue to…" copies a quest to another local hunter (`quests.js:533-546`). |
| Same parser | Yes: local through `issue` and the repair; remote through `questOffer` then `issue` (`room-events.ts:36`). |
| Reaches a room | `quest` (GM-only): kind, title, desc, 10 objectives, rewards, dueAt, penaltyText (`protocol.ts:145-152`). No `chainId`. Progress returns by `questUpdate` (`quests.js:210-216`). |
| Export and import | Inside hunters. |
| Player | Makes their own quests with no rewards (`quests.js:409,425`); cannot edit or delete a GM quest while in a room (`quests.js:371`). |
| Missing | No quest template library. |
| | A sent quest cannot be changed or withdrawn by the GM. |
| | The player taps Complete and gets the rewards on their own phone (`quests.js:258-301`); the GM is told only through `questUpdate`. |

### Gate

| What | Fact |
|---|---|
| Type | `Gate`, `GateFields`, `newGate` (`gate.ts:25-36`). |
| Built-ins and parser | `gateNames` (`rules.ts:70`) and `gateSpawn` weights (`rules.ts:69`); the roll `rollGate` (`spawn.ts:58-78`). Parser `parseGate` (`gate.ts:137-150`). |
| GM makes today | Gates view: Spawn gate (`gates.js:257-259,423-426`) and the Edit panel (`gates.js:334-351,434-443`): name, rank, type, status, break day, monsters and counts, boss, notes. GM view, Gates section, spawn with a name (`gm.js:451-455`). |
| Taps | More, Gates, Spawn gate = 3. Edit adds Edit, fields, Save gate. |
| Stored at | `gates[]` (`save.ts:151`). |
| Same parser | Yes: the repair calls `parseGate` (`save.ts:291-298`). |
| Reaches a room | The world doc (`protocol.ts:284-286,335-341`): id, name, rank, type, status, breakDay; at most 40 gates. No monsters, notes or rewards. |
| Export and import | Campaign export only. |
| Player | Nothing (`gates.js:402,422`). |
| Missing | No reward or loot of a gate's own: Clear rolls `rollLoot` by rank (`gates.js:116`). |
| | No gate template. |

### Job and Job Change chain

| What | Fact |
|---|---|
| Type | `JobDef` with exactly three `StepDef` (`jobs.ts:6-10`); `JobChain` (`job-chain.ts:14`). The rules also hold `jobs` and `extractJobs` as plain lists (`rules.ts:44-45`). |
| Built-ins and parser | `JOBS` (`jobs.ts:21-29`), all seven on the same `STANDARD` steps; `isJobName` (`jobs.ts:35`); `parseJobChain` (`job-chain.ts:126-134`). |
| GM makes today | No job maker. The rules editor can replace the `jobs` and `extractJobs` lists (only checked to be lists, `gm.js:71`). Chain: Quests view, "Issue Job Change Quest" (`pickChain`, `quests.js:195-205`), local hunters and built-in jobs only. A quest's "Job (free text)" reward sets `h.job` (`quests.js:594`, `hunter.js:232`). |
| Taps | Quests, Issue Job Change Quest, a hunter (when more than one), a job = 3 or 4. |
| Stored at | `hunters[].jobChain`; `hunters[].job` (a string of 60). |
| Same parser | A chain's job must be a built-in name (`job-chain.ts:130`); any other job lives only as text in `h.job`. |
| Lookup | `isJobName` and `BUILT_IN_JOBS` for chains; `canExtract(R, job)` against `extractJobs` for shadows (`rules.ts:100`). |
| Reaches a room | No chain message. A job travels as text in `rewards.job` (`protocol.ts:128`). |
| Export and import | Inside hunters. |
| Player | Types any job on their own sheet (`hunter.js:310,343-351`), which also decides `canExtract`. |
| Missing | No custom job with a chain; two job lists that do not agree (`rules.jobs` feeds the quest form's datalist, `quests.js:594`; `JOB_NAMES` feeds the chain picker, `quests.js:201`). |
| | A remote hunter cannot be given a chain (section 9). |

### Path or perk

| What | Fact |
|---|---|
| Type | `PathDef` (`paths.ts:47`); `Path` and `Perk` (`rules.ts:111-112`). |
| Built-ins and parser | `PATHS` (`paths.ts:56-63`), served as `RULES.paths` (`rules.ts:75`). No parser at save; `pathOf` and `perkOf` tolerate junk at read (`rules.ts:114-122`). The tier budget is checked only by the test. |
| GM makes today | Only through the rules editor JSON, and only inside an existing path: a new path id is refused as "Unknown rule" (`gm.js:69`); `tiers` is only checked to be a list (`gm.js:71`). The Build panel sets a path, respecs and flips the switches (`custom.js:400-442`). |
| Taps | GM, Rules editor, the text box, Save = 4, plus typing JSON. |
| Stored at | `rulesOverrides.paths`. A hunter's choice is `build` plus one perk skill rebuilt at every repair (`save.ts:454-471`). |
| Lookup | `pathOf(R, id)` for built-in and overridden alike. |
| Reaches a room | The build doc carries only `enabled` and `playerPick` (`protocol.ts:283`). An award's build change carries a path id (`protocol.ts:131-140`), which the receiving phone checks against its own rules (`custom.js:322`). |
| Export and import | Campaign export (inside `rulesOverrides`). |
| Player | Picks a path and perks when `playerPick` is on (`custom.js:270,288-293`); buys a respec (`custom.js:296-300`). |
| Missing | No path or perk maker; a GM's changed path never reaches a player's rules. |

### Rule number

| What | Fact |
|---|---|
| Type | `Rules = typeof RULES` (`rules.ts:79`); `rulesOf` deep-merges `rulesOverrides` (`rules.ts:85-94`). |
| Built-ins and parser | `RULES` (`rules.ts:15-76`). `validate` checks an override's shape against `RULES` in the editor only (`gm.js:65-77`); `conditions` and `rarities` take new keys unchecked (`gm.js:57`). Nothing checks `rulesOverrides` at load (`save.ts:150`). |
| GM makes today | GM view, Rules editor JSON box (`gm.js:626-630`, `saveRules` `gm.js:531-538`); roll tables write `gateNames` and `gmTables` (`gm.js:472-484`); the Build panel writes `build` (`custom.js:343-345`). |
| Taps | GM, Rules editor, the box, Save = 4, plus typing JSON. |
| Stored at | `rulesOverrides`. |
| Reaches a room | No; only the build doc's two switches. Each phone computes with its own rules. |
| Export and import | Campaign export. |
| Player | None (the GM view is GM-only, `gm.js:571`). |
| Missing | No form per number; JSON typed on a phone. Reset keeps only forged statuses and roll tables (`gm.js:539-547`). |

## 2. The forms today

| Form | Function | Fields | Validates | Writes |
|---|---|---|---|---|
| Status dialog | `openForge` (`forge.js:36-179`) | Rounds and ∞ (not when editing); "Apply existing" chips; Name (40); Description (200); 11 quick effect chips; More…: one modifier (stat, value) and one per-turn op (op, dice); color (5 swatches); "Save to library" (on) | Name required (`forge.js:126`); dice by `sanitizeOps` (`forge.js:131`); a typed name with no mechanics becomes that existing status (`resolveStatusKey`, `forge.js:129-130`); the def by `sanitizeDef` (`forge.js:132`) | `rulesOverrides.conditions[slug]` with `custom: true` (`forge.js:135-136`); answers `{ key, rounds, def }` |
| Status library | panel `status-library` (`forge.js:243-259`) | List, Edit, Delete, + New status | Delete only a `custom` entry (`forge.js:252-254`) | Deletes from `rulesOverrides.conditions` |
| Status picker (fallback) | `statusDialog` (`gm.js:305-331`) | Status select, rounds | None | Nothing: answers the pick. Used only when `forge.status` is missing (`gm.js:335`) |
| Loot Forge | `item` (`loot.js:106-218`) | Name; type chips (6); rarity; slot; damage dice (weapon); qty; value; description; heal, MP, fatigue (consumable); effect chips (8) that add rows: heal dice, damage dice, apply status (opens the Status dialog), cure status, on-equip attack, damage, AC, note; "Save to library" (on) | Name required (`loot.js:184`); numbers clamped (`loot.js:199-208`); effects by `sanitizeOps` (`loot.js:209`). Weapon dice not checked | `library.items` (same name replaces, `loot.js:222-234`); answers the item |
| Item library | panel `item-library` (`loot.js:242-263`) | List, Edit, Duplicate, Delete, New item | None | `library.items` |
| Item form | inventory panel (`inventory.js:214-234,318-334`) | Name, rarity, type, slot, qty, value, dice, heal, MP, fatigue, 9 bonuses, description | `clean` (`inventory.js:20-43`) | The active hunter's item, or the GM's shop (`ownShop`, `inventory.js:58`) |
| Quick add | inventory "Store" (`inventory.js:277-281,312-317`) | Name, rarity | Name required | A plain item on the active hunter |
| Skill form | Skills panel (`skills.js:94-161`) | Name, type, level, label, MP cost, cooldown, dice (active); 9 bonuses (passive); description | Name; dice by a silent roll (`skills.js:141-142`); numbers clamped | `hunters[].skills` of the active hunter |
| Title form | Titles panel (`hunter.js:568-610`), GM only | Name, description, 9 bonuses | Name | `hunters[].titles` of the active hunter |
| Monster editor | `editorHtml` and submit (`bestiary.js:229-245,319-333`) | Name, rank, type, HP, AC, attack, damage, initiative, XP, 6 stats, boss, extractable, abilities (one per line), description | `clean` (`bestiary.js:47-54`); damage text not checked | `monsters[]` |
| Generate stat block | `bestiary.js:264-288` | Name, rank, boss, elite | None | A `statBlock` monster in `monsters[]` |
| Quest form | `openForm` and `submitForm` (`quests.js:402-520`) | Kind, title, description, objectives (rows), due, due hours, penalty, rewards (XP, points, gold, title, free-text job, items from library or templates or "Custom…", or text lines `Name \| rarity \| qty`), Assign to | Title; at least one hunter; a job for a job quest (`quests.js:490-512`); `cleanRewards` | Local quests by `issue`; a `quest` message to each player |
| GM Award | `doAward` (`gm.js:378-398`) | Hunters; XP, gold, points, title; one item (library, shop, template, or custom) and qty | At least one hunter and one reward (`gm.js:380,389`) | `applyRewards` locally; an `award` message to players |
| GM Issue quest | `doIssue` (`gm.js:422-439`) | Title, kind, description, one objective and target, XP, gold, points, due hours, penalty | Title and a hunter | Same as the quest form, no items |
| GM Broadcast | `doBroadcast` (`gm.js:407-419`) | Preset, to, tag, style, title, message, with a live preview (`gm.js:402-406`) | Title | A System window here and a `system` message |
| Gate edit | `editPanel` (`gates.js:334-351`) | Name, rank, type, status, break day, monster rows, boss, notes | `oneOf` on choices; the status through `transition` (`gates.js:439-441`) | `gates[]` |
| Rules editor | `checkRules`, `saveRules` (`gm.js:518-538`) | One JSON box | `validate` against `RULES` (`gm.js:65-77`), live as you type (`gm.js:524-529`) | `rulesOverrides` (keeps `gmTables`) |
| Roll tables | `gm.js:463-515` | Table, rank, lines | At least one line; 200 lines of 300 | `rulesOverrides.gateNames` or `gmTables` |
| Combat quick line | `parseQuick` (`combat.js:311-346`) | One text line ("Mantis Drone x3, HP 30, AC 13, +5, 1d8+2") | Its own token parser | Combat rows only |

**The Status dialog's pattern, exactly.** A modal built from one HTML string (`forge.js:63-95`). On a phone the two columns stack (`forge.js:229`). The left column is "Apply existing": one chip per status, the GM's own first with a gold border (`forge.js:71-73,208`); a tap answers that status at once (`forge.js:143`). Its description and effect lines are only a `title` tooltip (`forge.js:72`), which a touch screen does not show. The right column is "New status": Name, Description, then 11 toggle chips with `aria-pressed`, where chips of one `grp` exclude each other (`forge.js:8-16,144-147`). A "More…" button opens one free modifier and one free per-turn dice op (`forge.js:80-87`). Ops the chips cannot show (any with `tiers`) are kept and counted in a note: "Also keeps N other effects: …" (`forge.js:51,105`). Then color radios, "Save to library", and a sticky Cancel and Apply bar (`forge.js:221-222`). There is no live preview of the status being made: nothing renders `describe` for the new def while the GM picks. The only live preview in any form is the Broadcast's (`gm.js:402-406`). Keys: Escape cancels, Enter in a text field or Ctrl+Enter applies, Tab is trapped (`forge.js:155-166`). It resizes to the visual viewport for the keyboard (`forge.js:168,171`) and answers a Promise.

**Helpers another maker could reuse.** From `ui.js`: `system` (a window with lines, html, actions), `confirm`, `promptNum`, `promptText`, `field`, `h`, `esc`, `css`, `toast` (`ui.js:3-202`). From `app.api.effects` (`effects.js:76-83`): `describe`, `describeItem`, `sanitizeOps`, `sanitizeDef`, `slug`, `statusDef`. Inside `forge.js` and private: the chip table and `sameOp` (`forge.js:8-17`), the focus trap and keyboard fit (`forge.js:155-171`).

**Forms that share code.** The Loot Forge calls the Status dialog for its "Apply status…" row (`loot.js:171`). The GM Award and the quest form both call the Loot Forge for a custom item (`gm.js:363`, `quests.js:467`). Nothing else is shared:

- each dialog has its own focus trap (`forge.js:155-166`, `loot.js:154-162`, `gm.js:316-322`, `combat.js:445-452`);
- the item picker (library, shop or templates) is built twice (`gm.js:368-377`, `quests.js:454-460`);
- items are cleaned four ways (section 1, Item);
- the 9 bonus fields are built three times (`inventory.js:226`, `skills.js:67`, `hunter.js:564`).

## 3. The op vocabulary

Every op is in `status.ts:17-35`. Each may carry `when`: `use`, `equip` or `turn` (`status.ts:6`). Without one, a status's numeric ops fire each turn and its mods always count; an item's mods count when worn and the rest when used (`defaultWhen`, `status.ts:94-95`). `sanitizeOps` keeps at most 8 ops (`status.ts:103`), reads a nested def two levels deep (`status.ts:136`), and drops an op with nothing in it.

| Op | Fields | `tiers` / `pct` | On a status, at turn start | On an item, when used | On an item, when worn |
|---|---|---|---|---|---|
| `heal` | `dice`, `amount` (99999 = full), `pct` | both | `rollTick` heals the combatant (`combat.js:110`) | heals the user (`effects.js:51-54`) | nothing |
| `mp` | `dice`, `amount` | `tiers` | hunters only (`combat.js:111`) | restores MP (`effects.js:55-56`) | nothing |
| `fatigue` | `dice`, `amount` (negative removes) | `tiers` | hunters only (`combat.js:112`) | changes fatigue (`effects.js:57-60`) | nothing |
| `damage` | `dice`, `amount`, `pct` | both | hurts the combatant (`combat.js:109`) | writes "Deal X = N" and sends a `roll` event; no HP changes (`effects.js:49`, `inventory.js:156`); a `pct` damage writes a line only (`effects.js:46`) | nothing |
| `mod` | `stat` (ac, atk, dmg, check), `value` -99 to 99 | `tiers` | summed by `mods` (`status.ts:233-240`), read by the sheet (`hunter.js:102,111-115`) and combat (`combat.js:45,57,251`) | skipped (`effects.js:42`) | ac, atk and dmg added by `inventory.bonuses` (`inventory.js:93-95`); check ignored |
| `applyStatus` | `status`, `rounds` (1 to 999 or null), `def?` | no | never fires (see below) | on the user only, source `itemSource` at the item's rarity (`effects.js:64-67`, `inventory.js:148`) | nothing |
| `cureStatus` | `status` | no | never fires | removes it from the user (`effects.js:68-70`) | nothing |
| `note` | `text` (120) | no | a line in `describe` only | a line in the toast (`effects.js:43`) | nothing |

- `tiers` (six values, E to S) and `pct` (1 to 100) are resolved only by `statusDef` at the instance's source tier (`status.ts:183-198`); `rollFor` turns a `pct` into HP (`status.ts:222-225`). Item use calls `rollFor` on the op as written, so an item op with `tiers` rolls 0 (`effects.js:47-48`).
- A status's `applyStatus`, `cureStatus` and `note` never fire: `turnOps` hands them on only when `when` is `turn` (`status.ts:247`), and `rollTick` acts only on the four numeric ops (`combat.js:102-113`).
- Ops that only write a line: `note` everywhere; `damage` and `pct` damage on an item; every non-numeric op inside a status.
- Perks, titles, skill bonuses and item `bonus` are not ops. They are flat `Bonus` records of stat, `hpMax`, `mpMax` and `ac` (`save.ts:59-60`, `rules.ts:111`), summed by `bonusOf` (`hunter.js:90-99`).

**The ability reader.** `parseAbility(text, conditions)` (`ability.ts:20-42`) answers `{ name, parts }`. The name is the text before a colon (`ability.ts:21`). The parts are text, `dice` (`\d+d\d+` with one optional `+N`), `hit` (a bonus before "to hit", or a `+N` that opens the text) and `status` (a status label from the rules, longest first, with its rounds) (`ability.ts:22-38`). It is drawn only on a monster or shadow row that is up (`combat.js:614`). The GM taps each part and the view rolls:

- dice: `abilityRoll` rolls and offers "Apply N damage" to the target, even for a heal (`combat.js:295-303`);
- hit: `monsterAttack` with that bonus and no damage (`combat.js:799`);
- status: `abilityStatus` puts it on the picked target with the monster as source (`combat.js:304-308`).

The four known gaps, confirmed:

1. Save DCs are not rolled. The pattern has no DC part (`ability.ts:23`), so "CON save DC 13 or Poisoned" (`monsters.ts:20`) gives an Apply Poisoned button and no save.
2. "1 round" is read as 3. Only "(N rounds)" and "for N rounds" are read (`ability.ts:35`); else `ABILITY_ROUNDS` = 3 (`ability.ts:14,36`). Ice Elf's "Slowed 1 round" (`monsters.ts:26`) and "Poisoned 1 min" (`monsters.ts:20`) apply 3 rounds.
3. Per-round effects are not statuses. "Regeneration: 10 HP per round" (`monsters.ts:31`) is text; "lose 1d8 HP per round" (`monsters.ts:24`) is a one-shot dice button.
4. Buffs become attack buttons. A `+N` that opens the text is a hit (`ability.ts:23`, third group): Shield Wall "+2 AC" (`monsters.ts:22`). A bonus before "to hit" is a hit: Rally "+1 to hit" (`monsters.ts:19`).

## 4. A hunter's skills

**Shape.** `Skill` (`save.ts:80-85`). `level` 1 to 10 and `label` are display only: Lv + raises the level and rewrites a `Lv.N` label (`skills.js:178-183`) and changes no number. `grade` is `'E'` from every form (`skills.js:156,171`, `starter.js:45`), the perk skill's tier rank (`save.ts:467`), and read by nothing (searched `src/` for `grade`).

| Source | Where |
|---|---|
| Job | None: a job holds only its three chain steps (`jobs.ts:10`). |
| Path | One passive skill marked `perk`, rebuilt from `build` and the rules at every repair; edits to it are undone (`save.ts:454-471`). |
| Starter | Sprint and Bloodlust on a new profile (`save.ts:706`); each starter-campaign hunter has its own (`starter.js:8-16,45`). |
| Player or GM on this phone | The Skills panel form and "Add from list" (`skills.js:93-173`), on the active hunter. |
| GM to a player's phone | Not possible: no room message carries a skill. The broadcast preset "Skill Acquired" is text only (`gm.js:52`). |

**Using one.** `skills.use` (`skills.js:45-59`) refuses a passive skill or one on cooldown, spends MP through `spendMp`, sets `cdLeft`, rolls `dice` with the dice view and shows a toast. That is all, in a fight and outside one.

- In a fight on the GM's phone, the local hunter's card lists active skills on its turn (`combat.js:603-606`); `useSkill` calls `skills.use` and then sends a `note` command, "X uses S" (`combat.js:366-370`).
- A player in a room uses a skill from the Table kit (`table.js:139,182`); the GM's fight gets nothing but the roll (section 6).
- Cooldowns tick on `combat:turn` for that hunter (`skills.js:62`) and reset on a rest (`skills.js:63`).
- A skill applies no status and deals no damage. A passive skill adds its `bonus` (`skills.js:23-34`).

**Through the fight reducer.** `Command` (`encounter-types.ts:62-81`) has no skill command. The commands a skill's effect could use exist: `changeHp`, `changeMp`, `changeFatigue`, `applyStatus` (with a `source`; `sourceOf` makes a hunter source at its rank tier, `encounter.ts:171-177`), `removeStatus` and `note`. No code path sends them for a skill; the GM taps them by hand on the target's card. A hunter's own attack (`hunterAttack`, `hunterDamage`, `combat.js:225-247`) also only writes a `note` and a toast; the GM applies the damage.

## 5. Rewards end to end

| Field | `Rewards` (`save.ts:70`) | `GivenRewards` read by `givenRewards` (`protocol.ts:123-130`) | Quest form `cleanRewards` (`quests.js:124-128`) |
|---|---|---|---|
| `xp` | number | -1e9 to 1e9 | 0 to 99,999 |
| `points` | number | -999 to 999 | 0 to 999 |
| `gold` | number | -1e9 to 1e9 | 0 to 1e9 |
| `items` | `RewardItem[]`, only `effects` checked (`save.ts:69,408`) | at most 20 `GivenItem` | `cleanItem` each (`quests.js:118-123`) |
| `titleName` | string or null | text 60 | text 60 |
| `job` | string or null | text 60 | text 60 |
| `build` | absent | on `award` only: `'respec'`, `{ path }` or `{ tier, pick }` (`protocol.ts:84,131-140`) | absent |

| Granted at | Code | Room message | What the player sees |
|---|---|---|---|
| Quest complete | `complete` (`quests.js:258-301`): the player taps Complete and `applyRewards` runs on their own phone | None for the reward; `questUpdate` with status `done` to the GM (`quests.js:279`) | A quest window with the reward lines (`quests.js:295`) |
| Quest issued to a player | `submitForm` (`quests.js:514-517`), `doIssue` (`gm.js:436`) | `quest` (GM-only) | A quest window listing the rewards to come (`room-events.ts:35-38,84-97`) |
| Gate clear | `clearGate` (`gates.js:110-143`) | `award` with xp, gold, items (`gates.js:131`) | "REWARD RECEIVED" window |
| Fight end | `endEncounter` (`combat.js:397-410`) | `award` with xp (`combat.js:405`) | "REWARD RECEIVED" window |
| GM award | `doAward` (`gm.js:378-398`) | `award` | "REWARD RECEIVED" window |
| Build change | `gmMenu` (`custom.js:326-342`) | `award` with `build` only | "REWARD RECEIVED" with a path or perk line |
| Daily quest | the daily template's rewards plus a streak point (`quests.js:270-273,283`) | None | The quest window |
| Shop | `buy` (`inventory.js:163-168`): gold for an item; not a reward | None | A toast |

- The applier: `award` calls `applyRewards(hid, p.rewards, { title: 'REWARD RECEIVED', tag: '! Reward', … })` for each of the phone's hunters it names, at most once per event id (`room-events.ts:31-34`). `quest` calls `issueQuest` with `from: 'gm'` (`room-events.ts:35-38`).
- `applyRewards` (`hunter.js:220-248`) adds points, a title by name, the job text and a build change in one update; then gold and each item through the inventory API; then XP, which may open a level-up window. It writes no log entry.
- A reward can hold: items (with effects), a title name, a job (free text), a build change. It cannot hold a status or a text line.
- A title's bonus and description come from the receiving phone's `rules().titles` by name; an unknown name gives a title with no bonus (`hunter.js:133-138`).
- A saved reward bundle: not found. Searched `quests.js`, `gm.js`, `save.ts` and `rules.ts`. The nearest things are a quest's `rewards` (kept while the quest is open), "Issue to…" which copies a local quest (`quests.js:533-546`), the rules' `dailyTemplate.rewards` (`rules.ts:42`), and the Award form's last custom item, kept in memory for the session (`customItem`, `gm.js:346`).

## 6. Use of a thing by a player

| Path | Local write | What reaches the GM's phone |
|---|---|---|
| Use a consumable (inventory "Use", `inventory.js:343`; Table kit, `table.js:183`) | `applyOps` on the user; qty minus 1; a toast (`inventory.js:140-162`). No log entry | One `roll` event, kind `item`, only when the item has an outward damage op or a dice op (`inventory.js:155-160`, `sendItemRoll` `inventory.js:76-82`). A flat potion (`heal: 30`) sends nothing. The sheet push carries the new qty, and no GM view shows a remote hunter's items (`gm.js:190-223`) |
| Use a skill (Skills panel, `skills.js:177`; Table kit, `table.js:182`) | MP, cooldown; a roll entry when it has dice (`dice.js:100-104`) | A skill with dice: one `roll` event, kind `skill`, matched by the skill's name (`table.js:251-267`), at most 2 a second. A skill without dice: only the sheet push (MP) |
| Complete a quest | Rewards applied; log "Quest complete" (`quests.js:275`) | `questUpdate`, status `done`, for a quest with `from: 'gm'` (`quests.js:210-216,279`) |
| Quest progress | The objective | `questUpdate`, 1.5 s after the last change (`quests.js:217-221`) |
| Equip, sell, buy, respec, take a seed title (`hunter.js:589-592`) | The sheet | The sheet push only |
| Receive a reward | `applyRewards`; no log | Nothing back: the award is fire and forget |
| A one-time reward | Not a thing today: a reward is applied when it arrives | Nothing |

- The player's `roll` and `questUpdate` are the only messages a player sends (`protocol.ts:213-223`). The server checks the `by` key's device against the sender for exactly these two types (`server.ts:275`).
- `log` (`save.ts:125`): id, at, kind (system, award, quest, gate, combat, rank), hunterId, title (120), text. Capped by `logCap` 200 (`rules.ts:73`, `save.ts:530-532`). Shown in the GM view's Session log, 120 rows, filter by kind and search (`gm.js:550-559`). A player's phone keeps a log too, with no view of it outside the GM view.
- `rolls` (`save.ts:126-129`): the dice history, capped by `rollCap` 50 (`save.ts:533`).
- The Table feed (`table.js:269-331`): rows of `{ id, type, name, label, expr, total, crit, fumble, dmg }` for a `roll`, or `{ title, status, obj }` for a `questUpdate`, newest first, at most 20 (`table.js:2,284`), deduplicated by event id (`table.js:280`). Kept in memory and `sessionStorage` (`hunter-table-v1-feed`, `table.js:271-273`), so it is lost when the tab closes. Filled on the GM's phone from `sync:event` (`table.js:276-285`). Shown in the Combat view's "Table feed" panel only for a GM in a room (`table.js:313-316`). A damage roll has "Apply N →" to a combatant (`table.js:304-307`).
- On a `questUpdate` the GM's phone also writes a log line and shows a toast (`quests.js:225-232`). A `roll` gets no toast.

## 7. Notifications

- The Notification API: not used. No `Notification`, `requestPermission` or `showNotification` in `src/` or `public/`. No permission flow exists.
- The service worker (`sw.js:1-32`) caches the built app and answers `/api` with an offline reply when the network is down. It has no `push` or `notificationclick` handler. `sync.ts:772-774` registers it.
- A hidden page does not poll the room: the poll timer skips its turn while `document.visibilityState` is `hidden` (`sync.ts:256-263`) and polls again on `visible` (`sync.ts:754`). A GM phone in the background receives no room event until it is shown.
- What exists to get attention, all in the foreground: `ui.toast`; `ui.system` windows, which play a WebAudio chime when `settings.sound` is on (`ui.js:14-35,135`); vibration on level up, quest done, the hunter's turn and HP loss when the device pref is on (`custom.js:113,116-125`); the tab title "▶ Your turn" on a player's hidden page (`table.js:149-157`).

## 8. Export and import

| What | Format | Where |
|---|---|---|
| Export campaign | The whole save as pretty JSON (`store.exportJSON`, `store.ts:156`), GM keys removed unless "Include GM key" is ticked (`io.js:164-168`). File `hunter-system-YYYY-MM-DD.json` | Data view |
| Export active hunter | `{ schema: 2, kind: 'hunter', savedAt, hunters: [h] }` (`io.js:169-173`) | Data view |
| Import | A `.json` file of at most 5 MB (`io.js:3,80,146`). `preview` checks JSON, an object, a schema not newer than 3, and a hunters list or a first-app save (`io.js:32-47`), then offers Replace or Add (`io.js:86-93`) | Data view |
| Replace | Backup, then `store.importJSON`: `parseSave` (migration and repair) and `repairSave` (`store.ts:158-167`). Keeps this phone's GM key for the same room (`io.js:97-102`) | |
| Add hunters | Backup, then each raw hunter gets fresh ids for it and its titles, quests, skills, items, shadows and loadouts, and is pushed in an update, so the repair runs (`io.js:106-125`). Everything else in the file is dropped: library, monsters, shop, `rulesOverrides` | |
| Backups | The newest 8 (`backupCap`, `rules.ts:73`), one automatic per day (`io.js:72-75`) | Data view |

- One kind of custom content alone (statuses, items, monsters) cannot be exported or imported. They leave the phone only inside a whole-campaign file, and Add drops them.
- No code or text export. The only QR code is the room invite (`room.js`, `core/qr.js`).
- The custom statuses in the file pass no parser on Replace: `rulesOverrides` is copied as it is (`save.ts:506`).

## 9. The remote Job Change chain

- **What the `quest` offer carries.** `QuestOffer` (`protocol.ts:91,145-152`): kind, title, desc, at most 10 objectives, rewards, dueAt, penaltyText. No chain id, no job, no step.
- **Why a chain cannot travel.**
  - The player's phone turns the offer into a plain quest (`room-events.ts:36` calls `quests.issue`, `quests.js:142-157`).
  - A chain lives in `hunters[].jobChain`, and only `chainAfter` writes it (`quests.js:173-182`); `parseJobChain` keeps a chain only while its step's quest is open on that hunter (`job-chain.ts:130-133`).
  - A level step completes from the hunter's own level change (`quests.js:193`), so the chain has to run on the phone that holds the hunter.
  - The GM's picker lists only this phone's hunters (`quests.js:196`), and `issueJobChain` refuses a hunter it does not hold (`quests.js:159-160`).
  - Reissue and abandon are GM-only chain events (`job-chain.ts:97-98`) that a player's phone would have to receive.
- **What a message would need** (the recipe "A room message" in `AGENTS.md`):
  - `src/core/protocol.ts`: a payload in `Payloads` (`protocol.ts:180-183`), for example `{ to, job }` with `job` read by `isJobName`; a `DEFS` entry with `gmOnly: true` and a bounded reader (`protocol.ts:196-224`); its `EVENTS` entry (`protocol.ts:227-230`).
  - `src/edge/room-events.ts`: an applier in `APPLIERS` with `once: true` (`room-events.ts:29-47`) that calls `quests.issueJobChain`, which needs a new member in `ApplyDeps` (`room-events.ts:13-20`), filled in `sync.ts:409-416`.
  - `src/views/quests.js`: `pickChain` offers remote sheets and sends with `app.api.sync.send(app.api.sync.event(type, body))`. Remote reissue and abandon need a message too, or the same one with a kind.
  - Tests: the payload in `VALID` and a case per bound (`tests/protocol.test.ts`); a GM-only refusal (`tests/server-rooms.test.ts`); a GM move in `tests/models/room-world.ts`.
  - Then `bun run deps -- --write`.

## 10. Odd things

- `statusDefs` on a monster is written by auto-add (`bestiary.js:96-98`) and read by nothing; `save.ts:120` says combat reads it.
- Items have four parsers with four bounds: qty from 0 with no top (`save.ts:326`), 1 to 999 (`protocol.ts:113`, `quests.js:120`), 1 to 9999 (`inventory.js:31`, `loot.js:201`); heal up to 99,999 (`inventory.js:36`) or 1e6 (`quests.js:121`).
- GM items live in two stores, `library` and `shop` (`save.ts:148,153`), plus copies inside quest rewards. Custom statuses live in the rules (`rulesOverrides.conditions`); custom items and monsters live in top-level save keys.
- `lootTables` is typed `unknown`, has no parser and no writer, and `rollLoot` reads it in its own shape `{ w, item, gold }` (`save.ts:151`, `inventory.js:59-64,118-119`).
- `rulesOverrides` is never repaired, and the rules editor saves anything under `conditions` (`gm.js:69-70`).
- Two job lists: `rules.jobs` feeds the quest form, `JOB_NAMES` feeds the chain picker (`rules.ts:44`, `jobs.ts:34`, `quests.js:201,594`).
- A player types any job on their sheet (`hunter.js:310,351`); a job in `extractJobs` opens the Shadows view for them (`shadows.js:122`, `rules.ts:100`).
- A player edits every field of a GM-given item (`inventory.js:326-331,356`) and takes any seed title that is not `gmOnly` (`hunter.js:589-592`).
- Combat reads `s.abilities` on a shadow, which the `Shadow` type does not have (`combat.js:162`, `save.ts:93-97`).
- The Loot Forge's Edit turns a mod with `tiers` into a flat +1 (`n: o.value` is undefined, then `v.n ?? 1`, `loot.js:96,79-81`) and drops a heal or damage with `tiers` or `pct` (`loot.js:95`).
- `inventory.bonuses` adds `o.value` of a worn mod; a mod with `tiers` has none, so it adds `undefined` (`inventory.js:94`).
- Duplicate in the item library does nothing at 200 items and says nothing (`loot.js:230,252`).
- An item use's `dmg` flag on the GM's feed comes from a regex on the item's name and description (`inventory.js:80`).
- The status dialog's library entry carries `custom: true` beside the def (`forge.js:31`); `sanitizeDef` drops it on every read.
- The Award form without the Loot Forge makes a `misc` item with only a name and rarity (`gm.js:383-385`).
- A room award may carry negative XP, gold and points (`protocol.ts:126-127`); the quest form clamps them at 0 (`quests.js:125`).
- The server's "not your sheet" check for a player's message is a line per type in `server.ts:275`, outside `DEFS`; a new player message needs a line there too.
- Two lines of `p4/status-audit.md` section 8 no longer hold: a player's phone applies a status through `applyStatus` (`room-events.ts:70`, `hunter.js:83`), and item use produces an `item` source (`effects.ts:29`, `inventory.js:148`).

## Summary

| Kind | Make today | Screen | Taps | Stored at | Same parser | Same lookup | Reaches a room | Export and import | Biggest gap |
|---|---|---|---|---|---|---|---|---|---|
| Hunter skill | partly | Status, Skills | 4 | `hunters[].skills` | yes (repair) | per hunter, no registry | on the sheet; the GM cannot send one | inside the hunter | does nothing in a fight but MP, cooldown and a roll |
| Monster ability | partly (text) | Bestiary editor | 5 | `monsters[].abilities` | yes | yes (`parseAbility`) | codex: 4 of 70 characters | campaign | free text with four reader gaps |
| Status | yes | GM, Status library; + Status | 5 | `rulesOverrides.conditions` | in the dialog; not at load | yes (`statusDef`) | each instance's def; the library no | campaign only | flat numbers, no preview |
| Item | yes | GM, Item library | 5 | `library.items`, `shop` | yes (`fixItem`) | by value, `effectsOf` | in `award` and `quest` | campaign; held items in hunters | forge has no bonus; `tiers` roll 0; damage only writes a line |
| Monster | yes | Bestiary | 5 (4 to generate) | `monsters[]` | yes | yes (`bestiary.get`) | codex doc, stats only | campaign | no statuses or loot of its own |
| Shadow | no | Shadows (extract, grant) | n/a | `hunters[].shadows` | yes | n/a | on the sheet | inside the hunter | no abilities |
| Reward | partly | GM, Award; quest form | 5 | not stored | `givenRewards`, `cleanRewards` | `applyRewards` | `award`, `quest` | inside quests | no status or text line, no bundle, use never reported |
| Quest | yes | Quests, + New quest | 4 or 5 | `hunters[].quests` | yes | n/a | `quest` | inside the hunter | no template |
| Gate | yes | Gates, Spawn and Edit | 3 | `gates[]` | yes (`parseGate`) | n/a | world doc, no monsters | campaign | no reward of its own |
| Job and chain | no (built-in jobs only) | Quests, Issue Job Change | 3 or 4 | `hunters[].jobChain`, `job` | built-in names only | `isJobName` | job text only, no chain | inside the hunter | no custom job, no remote chain |
| Path or perk | partly (JSON, existing paths) | GM, Rules editor | 4 and JSON | `rulesOverrides.paths` | no (tolerant reads) | `pathOf` | no | campaign | no maker; a new path id is refused |
| Rule number | partly (JSON) | GM, Rules editor | 4 and JSON | `rulesOverrides` | editor only | `rulesOf` | no (two build switches) | campaign | JSON on a phone, not checked at load |

