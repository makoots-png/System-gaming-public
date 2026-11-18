# Notes: unit 4b, the skill maker and the enemy maker

Principles read: experience first, minimize reader load, migrate callers then delete, test behaviour, unslop.

## Step 1: the skill maker

- In `src/views/skills.js` (not a new file): the panel, the skills API and the maker share `parseSkill`, the bonus words and the library. `make({ initial, library })` opens maker.js's shell (cls `skm`): Name, Active or Passive chips, Description; an active skill has MP cost, Cooldown, Table roll (`dice`), Affects (The user, A target), Rolls to hit (shown for A target), and the effects editor told `skill` (By rank is E to S, a rank's tier: the hunter's or the monster's that uses it); a passive skill has the nine bonus fields, still clamped to -20..50 as the old form did. The preview: cost and cooldown, the table roll, whom it is on, then `describe` of the effects. "Save to library" shows on a GM's phone, on by default, and writes `library.skills` (same name replaces, an edit pins its id, 200 at most). Save builds the skill, runs `parseSkill`, answers the parser's skill and logs a console error when the two differ.
- maker.js: a third `kind`, `skill`, with its own quick chips (Damage 2d6, Heal 2d4+2, Apply status, Cure status, Note); the tier labels are the ranks, as a status's.
- The Skills panel's inline form is gone (its HTML, its submit handler and its CSS). Add skill opens the maker and adds the result to the active hunter with the "Skill acquired" window; Edit opens it without "Save to library" and replaces the skill's fields (its id kept); Add from list lists the built-ins and then the library. An active skill's card lists what its effects do.
- `grade` is gone from `Skill`, `newSkill`, `parseSkill`, `skillOf` and the path skill's rebuild: nothing read it (searched `src/` and `tests/`). An older save's grade is dropped by the parser at load. Tests: save.test.ts (`currentSkills` drops it, the hostile skill and the path skill no longer name it), skills.test.ts (a grade is dropped); two e2e setups lost the field.
- `make` is not on `app.api` yet: its first caller in another module is the enemy maker (step 3); the deps test refuses an API member with no caller.
- Test changed (character): "The skill maker accepts mixed dice like 1d8+1d6 and keeps Save off for garbage" (was the inline form's submit and its error line).
- `bun run test`: 1628 pass. Browser: character 17 passed.
- Commit 1: step 1.

## Step 2: give a skill

- `receivers()` (skills.js): this phone's hunters (`l:` id), then, in a room, the players' sheets (`r:` key, "Mira (player)"). `giveTo(skill, to)`: a hunter here gets a copy at once through `applyRewards({ skills: [skill] }, { silent: true })` (a skill of the same name is replaced and keeps its id, as a reward's is); the players get one `award` whose rewards hold only that skill, so each player's phone shows "REWARD RECEIVED" with "Skill acquired: NAME". A send the room did not take is a warning toast.
- From the maker's result: the maker takes `give` (the receivers pressed at the start) and shows "Give to" chips (many); Save gives the skill to each one pressed, then one "Skill acquired" window says "Given to: Brakk, Mira Test (player)". On a GM's phone the Skills panel's Add skill opens the maker with the active hunter pressed, so making a skill for the hunter on screen is as before and giving it to more is one tap each; a player's Add skill has no chips and adds to the active hunter.
- The library list's "Give to…" comes with the Workshop (step 5).
- Browser (makers): "a GM makes a skill from the Skills panel and gives it to a player in the room...", 1 passed.
- `bun run test`: 1628 pass.
- Commit 2: step 2.

## Step 3: the enemy maker

- bestiary.js `make(m)`, on maker.js's shell (cls `enm`), opened by New monster and by a card's Edit (a seed's Edit saves a copy, as before). Fields: Name, Rank chips, Boss / Elite / Extractable chips, Type, HP, AC, Attack bonus, Damage, Initiative, XP, the six stats, Abilities (one per line, as before), Skills, Starts with, Loot (gold and items), Description; the preview is the stat line, a line per skill (`skills.lines`, the skill maker's own words), "Starts with: Hasted (3 rounds)" and "Drops: 50 gold, Frost Shard".
- Numbers from the rank table: a number (and the damage dice) is untouched while it holds the value `statBlock` gives the rank, boss and elite the monster was opened at; a rank, boss or elite tap refills every untouched one from `statBlock`, and typing in one makes it touched. So a new monster follows its rank, and a seed's tweaked numbers stay as they are.
- Skills: a select with the built-in table, then the library, then "New skill…" (the skill maker on top; what it makes is added and, on a GM's phone, saved to the library), at most 12, each a row with what it does and a remove button. Starts with: a select of the rules' statuses (not a hunter's state chip, each once), each row with its rounds (empty is until removed; added at 3), at most 8. Loot: Gold, and a select of the library's items and "New item…" (the item maker), at most 20. A full list's select is disabled and says the cap.
- Save builds the monster (every number clamped to `MONSTER_BOUNDS`), runs `parseMonster`, saves what the parser gives back through `saveMonster` and logs a console error when the two differ. The old inline editor (`editorHtml`, `openEditor`, its submit handler, the "kept from the monster edited" line) is gone; Merge keeps its inline form.
- Generate stat block is unchanged (name, rank, boss, elite).
- `app.api.skills` gains `make` (the enemy maker's "New skill…") and `lines` (the preview's words).
- Browser: makers (with the rank test) and custom-skills, 15 passed.
- `bun run test`: 1628 pass.
- Commit 3: step 3.

## Step 4: loot at the end of a fight

- `lootOf(drops)` in `src/core/registry/monsters.ts`: the defeated monsters' loot together, gold summed (at most a billion), the same item (every field but its count) one stack (at most 9999). Tests in tests/monsters.test.ts.
- combat.js `endEncounter`: each defeated monster's loot is its bestiary entry's (`bestiary.get(refId).loot`; a seed has none). The Encounter Complete window lists "Loot: 50 gold, Frost Shard" before the GM chooses. After the fight ends (and after the party's XP window, when there is one), a "Loot dropped" window lists it again with Close and "Award loot…". Nothing is given on its own.
- "Award loot…" calls `app.api.award.open(rewards)` (new, gm.js; `AwardApi` in api.ts): the GM view opens with the Award section unfolded and scrolled to, the gold in the Gold field and the items held the way a picked bundle's extra parts are (`fillAward`, which `pickBundle` now uses too): listed as "Also gives: Item: Frost Shard" and sent as they are with Send award. No hunter is picked. This is the smallest form of "the Award form holds the loot": the form still holds one item of its own, and unit 4c's reward editor replaces both.
- Browser (makers): the Ice Warden test's last two steps (the end window's loot line, Award loot fills the form, Send award to Brakk gives 50 gold and the shard).
- `bun run test`: 1632 pass.
- Commit 4: step 4.

## Step 5: the Workshop

- `src/views/workshop.js`, in `MODULES` after `loot`: `app.registerView({ id: 'workshop', gmOnly: true, order: 62 })`, so a GM finds it in the More menu (it is not one of the GM's four bottom tabs). A section per kind: Statuses, Items, Skills, Monsters. Rewards (bundles) is left out: unit 4c has not landed, and the Award form keeps its bundle select.
- Each row: name, a tag (rarity, active or passive, rank, "changed built-in"), a line of what it does (`describe`, `describeItem`, `skills.lines`, the monster's HP, AC, to hit and skills), and Edit, Duplicate, Delete; a skill also "Give to…". New and Edit open the kind's maker (`forge.status`, now typed with `edit`; `loot.item`; `skills.make`; `bestiary.make`). Duplicate copies the entry with "(copy)" after its name (a status under a fresh key from `effects.slug`), refused with a toast at the 200 cap. Delete asks first; a changed built-in status shows Reset instead (the old panel's words). A monster's Delete is `bestiary.remove` (new; the Bestiary's own Delete uses it too, so the codex link is cleared in one place); its Duplicate is `bestiary.save`.
- Statuses: the library's (the GM's own and changed built-ins) are the list; the unchanged built-ins are in a fold, "Built-in statuses (14)", each with Edit, so a built-in can still be changed as it could in the old panel.
- An empty section says what the kind is in one line, beside its New button. Monsters ends with "Every monster in the Bestiary".
- Skills' "Give to…" is `skills.give` (new): a list window "Give Frost Lance to…" of this phone's hunters and the room's players, then step 2's `giveTo`, then a toast. Skills' New opens the maker with an empty "Give to" group.
- Deleted: the GM view's Status library panel (forge.js: `libRows`, `renderLib`, its delete handler, its CSS) and Item library panel (loot.js: the panel, `removeFromLibrary`, `metaOf`, its CSS).
- Tests moved: makers (Frostbite, Wither, Bottled Storm, Rime Band, Hex open the Workshop instead of the GM view; the two tap counts are one more, see step 6), character (Reset rules keeps the Workshop's statuses; the library item edit), combat-turns (the New status window fits a landscape laptop; rename Poisoned then Reset, which now opens the built-in fold first).
- Browser: makers 12 passed; character and combat-turns 30 passed. `bun run test`: 1632 pass.
- The step-6 browser tests were written with steps 2 to 5 and go in this commit with the Workshop's (see step 6).
- Commit 5: step 5.

## Step 6: browser tests

All in `tests/e2e/makers.e2e.ts`, on a 390 px phone, every action under test tapped; the store only sets up and reads. Taps are counted by the test's counter (typing is not a tap; picking from a select counts one).

- Frost Lance, from the Skills panel on the home screen (Status view): Skills chip, Add skill, Name, A target, Rolls to hit, Damage 2d6, its value (typed 2d8), By rank, the C value (typed 4d8), Apply status, the status select (Slowed), Rounds (typed 2), Save skill = 13 taps. Brakk, the active hunter, is pressed in "Give to" from the start. The preview reads "On a target: rolls to hit its AC first", "Deals 2d8 / 2d8 / 4d8 / 2d8 / 2d8 / 2d8 damage, by rank E to S", "Applies Slowed (2 rounds)"; the library holds the tiers and no grade; in the Goblin Den with every roll at 0.95 (a natural 20, d8s of 8) Brakk's use takes 16 from the goblin, the log line says so and its card shows "Slowed · 2r". From the Workshop it is 15 (More, Workshop, New skill, then the same, with Brakk's give chip).
- A library skill given to a player from the Workshop's "Give to…": the player's "Skill acquired" window and the skill on their Skills panel with its effect line. Also kept from step 2: a skill made in the Skills panel and given to the player with the maker's chip.
- Ice Warden, from the home screen: More, Bestiary, New monster, Name, C, the skill select (Frost Lance), the status select (Hasted), Gold (typed 50), the item select (Frost Shard), Save monster = 10 taps. The preview's stat line, skill line, "Starts with" and "Drops"; the bestiary record; added from the combat builder it starts Hasted; with rolls at 0.5 its Frost Lance hits Brakk for 4d8 at rank C, 20, and Slowed; defeated, the end window lists "Loot: 50 gold, Frost Shard", Award loot opens the form with 50 in Gold and "Also gives: Item: Frost Shard", and Send award to Brakk gives both.
- The monster maker's numbers: HP 20 at E, 150 after C, the preview "C-rank · HP 150 · AC 24"; AC typed 30 stays at B while HP goes to 350; the saved monster is B, 350, 30.
- The Workshop: the empty Skills section's line and its New skill; a status, an item, a skill and a monster of the GM's each listed; Delete on the skill, confirmed, empties the list and the library.
- Tap counts moved by the Workshop: Frostbite 8 (was 7: More and Workshop replace the GM tab), Bottled Storm 9 (was 8).
- One run: 12 passed, first run.
- Commit 6: step 6.

## Step 7: checks and AGENTS.md

- `bun run test`: 1632 pass, 0 fail (`1632 pass`). `bun run deps -- --write` left the map as the earlier commits wrote it. No machine changed, so no chart.
- Browser, one run each, first run, no pause seen: character and combat-turns 30 passed (after step 5's code); makers, custom-skills, customization, gates-quests-dailies, rewards, used, table-session, save, room-view, room-sync, room-sync-fixes, room-onboarding, upgrade: 103 passed (15.0 min).
- AGENTS.md: the makers row names the skill maker and the monster maker; rows for the Workshop and for a fight's loot; the Skill and Monster recipes name their makers (and `skills.give`, the rank table refill); the maker recipe says to copy one of four and list the kind in the Workshop.

## Decided by the helper

- The skill maker lives in skills.js (`skills.make`), beside the panel and the parser's other callers, not in a new file.
- A skill maker on a GM's phone has "Give to" chips (this phone's hunters and the room's players); the Skills panel's Add skill presses the active hunter, so "from the maker's result" is one tap per receiver and needs no second window. The library list's "Give to…" is a list window, one receiver per pick.
- A local give goes through `applyRewards` (a skill of that name is replaced, as a reward's is), silently, with one "Skill acquired" window naming every receiver.
- The maker has no Level or Label fields: an edit keeps the skill's own; a new skill is level 1 with no label.
- The skill quick chips are a third `kind` in maker.js (`skill`): Damage 2d6, Heal 2d4+2, Apply status, Cure status, Note.
- A passive skill's bonus keeps the old form's -20..50 clamp.
- The monster maker keeps the bestiary's word "monster" (New monster, Save monster). A number counts as untouched while it equals the rank table's value for the monster's starting rank and flags; the damage dice follow the same rule.
- A starting status is added at 3 rounds (the effects editor's Apply status default); an empty rounds field is until removed.
- Loot: the Encounter Complete window lists it before the GM chooses; the "Award loot…" button is on a "Loot dropped" window after the fight ends (and after the party's XP window), so ending with or without XP and giving loot stay two choices. The Award form gets the gold in its field and the items as the "Also gives" part a bundle uses (`fillAward`), the smallest change before unit 4c's reward editor.
- `lootOf` stacks the same item from two monsters into one count.
- The Workshop lists the GM's own statuses and changed built-ins, with the unchanged built-ins in a fold with Edit only (the old panel let a GM edit every built-in). Its Rewards section is left out until unit 4c.
- Duplicate and Delete write the library in workshop.js; New and Edit go through the makers. A monster's Delete is `bestiary.remove`, shared with the Bestiary.
- New API members: `skills.make`, `skills.lines`, `skills.give`, `bestiary.make`, `bestiary.remove`, `award.open`; `forge.status` takes `edit` in its type (it already did at run time).

## Unsure

- Making a status or an item from the home screen is one tap more than in unit 4a (More and Workshop replace the GM tab): Frostbite 8, Bottled Storm 9.
- More than 20 different items dropped in one fight would show in the window, but a room award carries 20 items at most (`parseRewards`).
- A library skill's edit does not reach hunters or monsters that already hold a copy (copies by value, as items).
- The Ice Warden test kills it with `combat.applyDamage` (setup) rather than by tapping damage; the end of the fight and the loot are tapped.
