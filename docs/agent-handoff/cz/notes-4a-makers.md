# Notes: unit 4a, the shared maker, the status maker and the item maker

Principles read: experience first, minimize reader load, migrate callers then delete, subtract before you add, test behaviour, unslop. Minimize reader load decided the shape of `app.api.maker`: five members, a shell that takes a body builder, and chips read back from the page (`picked`) instead of a chip object to keep in step with the page.

## Step 1: the shell, chips and bonus fields

- `src/views/maker.js`, in `MODULES` right after `effects` (the views call it at tap time, so the order only matters for reading). `app.api.maker` (`MakerApi`, `MakerBody`, `MakerShell` in api.ts): `open`, `chips`, `picked`, `bonus`, `readBonus`.
- `open({ tag, title, save, cls, focus, build })`: one overlay and window, the focus trap, Escape (cancel), Enter in a text or number field and Ctrl or Cmd+Enter (save), a tap outside (cancel), the fit to the visual viewport, the sticky Cancel and Save bar (`[data-cancel]`, `[data-apply]`), and the preview slot (step 2). The body answers `{ save, preview?, blocked? }`: `save` answers the value or undefined to stay open; `blocked` turns Save off. Shells stack: only the newest answers keys, so a maker opened from a maker works. `cls` names the overlay and window (`fg-overlay`, `lf-overlay`) so tests and a maker's own CSS can find them.
- Chips: `chips(name, options, value, { many, clear })` is HTML; the shell presses them in the capture phase, so the body's own click handler reads the new value with `picked(root, name)`.
- Bonus: `bonus(values)` is the nine inputs (`data-bonus`), empty when 0; `readBonus(root)` answers the non-zero whole numbers.
- Moved onto the shell: the Status dialog (forge.js), the Loot Forge (loot.js), the Start encounter dialog (combat.js `partyDialog`). Their focus traps, key handlers and viewport fits are gone. The Loot Forge's type chips are maker chips. ui.js's System window keeps its own trap: it is not a maker.
- Bonus fields replaced in inventory.js (the Add / edit item form), skills.js (a passive skill, still clamped to -20..50) and hunter.js (the title form). Labels are now one set (STR..CHA, Max HP, Max MP, AC); every field is empty for 0.
- Tests changed: the Start encounter button is `[data-apply]` (was `[data-go]`) in helpers.ts and gates-quests-dailies; the Loot Forge's Save is `[data-apply]` (was `#lf-ok`) in character.
- `bun run test`: 1627 pass. Browser (character, combat-turns, custom-skills, gates-quests-dailies, table-session): 64 passed, first run.
- Commit 1: step 1.

## Step 2: the effects editor and the preview, in the Status dialog

- `app.api.maker.effects(box, { ops, kind, newStatus })` answers `{ ops(), blocked() }` (`MakerEffects` in api.ts). One row per op over the whole vocabulary: a kind select, the modifier's stat, a remove button, for a numeric op or a mod the mode chips Flat, By rank (an item's "By rarity") and, for heal and damage, % of max HP; By rank is six inputs in one row labelled E to S (or Com, Unc, Rare, Epic, Leg, Myth). Apply status picks from `rules().conditions` with "New status…" (the caller's `newStatus`, the status maker) and rounds (empty is until removed). Cure picks a status. A note is a line of 120.
- Each row is checked by the parser itself: the row's op goes through `sanitizeOps` and is compared with what the row holds (keys sorted, a status's `def` left to the parser). A difference is the row's error, shown under it with the bad values marked (`aria-invalid`), and `blocked()` turns Save off. `ops()` answers the parser's ops, so every answer passes `sanitizeOps` unchanged. A By rank row's bad value is found by putting it beside five values that always pass.
- At most 8 rows. The quick chips and "Add effect" are disabled at 8 ("Add effect (8 at most)").
- Quick chips add a ready row. The status kind has the Status dialog's eleven (same `data-q` ids); the item kind the Loot Forge's eight as ready rows ("Heal 2d4+2", "Damage 2d6", "Apply status", "Cure status", "Worn: +1 attack/damage/AC", "Note"). A chip whose op equals the E value of a built-in status's tiered op (same op and stat) remembers those tiers; choosing By rank on its row fills them (1d6 dmg/turn gives Burning's 1d6 2d6 3d8 4d10 5d12 7d12; AC −2 gives Slowed's). Other rows fill all six with the flat value.
- An op given with a `when` keeps it; the editor has no control for it.
- The preview: the shell draws a body's `preview()` lines into `[data-mk-preview]` (or the end of the body) on every input, change and chip, with "No effects yet." when empty.
- The Status dialog (forge.js) keeps its shape: Rounds and ∞, "Apply existing", Name, Description, the editor (replacing the toggle chips, "More…" and the kept-ops note), Color, Save to library. Existing statuses are maker chips: a tap presses one and the preview moves under the chips and shows its description and `describe` lines; Apply puts it on (two taps, was one). Typing a name or building an effect lets the pick go.
- Strength: `forge.status({ rank })` shows a Strength row (E to S, default `rank`); the preview shows the numbers at that rank (`describe` of an instance with `gmSource(rank)`) and the answer carries `source: gmSource(rank)`. combat.js's "+ Status" passes the combatant's rank (E when it has none) and sends the source; gm.js's remote "Status" passes the sheet's rank and sends the answer's source.
- The Status dialog checks its def: `sanitizeDef` of the form's def must equal the form's def, else a console error (a browser test fails on it).
- combat.js: a card lists, under Conditions, what each status does at its source's tier ("Frostbite: 3d8 damage at turn start"), so the GM sees the picked strength's numbers.
- Tests changed: combat-turns and table-session tap an existing chip then Apply; table-session's "picks a built-in status" test now also reads the preview (description, "−2 to checks") and that nothing is applied before Apply.
- Fixed while checking a screenshot: the shell appended the preview slot to the end of the body because the body was not in the page yet (`isConnected`); it now checks `contains`.
- `bun run test`: 1627 pass. Browser: combat-turns, table-session 20 passed; character 17 passed.
- Commit 2: step 2.

## Step 3: the item maker

- loot.js's `item({ initial, library })` is one form: Name; Type chips (all seven `ITEM_TYPES`, `key` included); Rarity; Slot (set from the type until the GM picks one); Damage dice (a weapon); Qty; Value; Description; Heals HP, Restores MP and Removes fatigue (a consumable); the nine bonus fields ("Bonus while worn", the forge had none); the effects editor told "item" (By rarity, Com to Myth); "Affects: The user / A target" (shown when the item does something when used, read with `effectsOf(item, 'use')`); "Tell me when it is used" (GM only, off by default); "Save to library" (left out with `library: false`); the preview: "Worn: +2 STR" and `describeItem`'s lines.
- Save builds the item the form holds (every number clamped to the parser's bounds), runs `parseItem`, answers what the parser gives back and logs a console error when the two differ (a form bug; a browser test fails on it). Nothing is "kept but not shown": the Loot Forge's rows, its eight effect chips, `rowsFromEffects` and the "Also keeps N other effects" note are gone.
- `LootApi.item` answers an `ItemTemplate` (it never had an id). "Forge an item" is now "New item".
- The inventory panel's "Add / edit item" form and its fields (`fieldsHtml`, `readForm`, `fillForm`) are gone. "Add item" under the list, a held item's Edit, and the shop's Add and Edit open the item maker without "Save to library"; Save writes to the hunter or the shop as before. A held item's edit replaces the item's fields (it used to merge, keeping fields the form did not show). A player still edits an item they hold; the tell box shows only to a GM, and a player's edit keeps the item's `tell` as it was.
- `effects.sanitizeOps` left `app.api.effects`: nothing calls it now (the editor imports the parser).
- Legacy heal, MP and fatigue: they stay fields, since `Item` stores them. Folding them into effects is a clean follow-up: `legacyOps` (effects.ts) already reads them as `heal`, `mp` and `fatigue` ops with `when: 'use'`, so the maker could show them as rows and save them as effects, with a load step moving the three numbers into `effects` (the 8-op cap is the one thing to check: an item could then hold 11). The stack key and the item card's meta line read the fields and would change with it.
- Test changed (character): the library item with six effects now shows six effect rows and no kept note, and reads back equal after Save.
- `bun run test`: 1627 pass. Browser: character, rewards, custom-skills 27 passed.
- Commit 3: step 3.

## Step 4: browser tests

- `tests/e2e/makers.e2e.ts` (phone viewport, the starter campaign, the Goblin Den fight from `startGoblinDenFight` with its first monster renamed and ranked through the store):
  - Frostbite: 1d6 dmg/turn, By rank (Burning's six fill in), S changed to 9d12; the preview reads "1d6 / 2d6 / 3d8 / 4d10 / 5d12 / 9d12 damage at turn start, by rank E to S"; the library holds the `tiers` op; on a C-rank monster the Strength row starts at C, the preview says 3d8, and the card says "Frostbite: 3d8 damage at turn start".
  - Wither, 5% of max HP: the preview says "5% of max HP damage at turn start"; a monster with 200 max HP is at 190 after its next turn start.
  - Slowed at Strength A on an E-rank monster: the preview says "AC −6", the card says "Slowed: AC −6" and its AC drops by 6.
  - Bottled Storm: consumable, Damage 2d6, Apply status (Bleeding, 3 rounds), A target; the preview; the library item (`target: 'other'`, no `tell`); Edit shows name, type, target and both rows as saved, and Save leaves the item equal.
  - Rime Band: accessory, epic, +2 STR, Worn +1 AC by rarity with epic set to 4; the library item; a hunter given it (store setup) taps Equip and has 4 more AC and 2 more STR.
  - Dice "abc" on a row: the row's error and Save disabled; "1d8" clears both.
- Tap counts, from the GM's home screen (the Status view) on a phone, typing not counted, each tap made through a counter in the test:
  - the status: GM tab, + New status, Name, 1d6 dmg/turn, By rank, the S value, Apply = 7 (the test checks at most 7). A flat status is 5, as before: GM, + New status, Name, a quick chip, Apply.
  - the item: GM tab, New item, Name, Consumable, Damage 2d6, Apply status, A target, Save item = 8 (the test checks at most 8). A plain item with one effect is 6.
- One run, 6 passed, first run.
- Commit 4: step 4.

## Step 5: checks and AGENTS.md

- `bun run test`: 1627 pass, 0 fail. `bun run deps -- --write` left the map as the earlier commits wrote it.
- Browser files that open a maker or the Start encounter dialog (character, combat-turns, makers, rewards, custom-skills; then gates-quests-dailies, table-session, used): 46 passed, then 32 passed, first runs, no pause seen.
- AGENTS.md: a "Where things live" row for a form that makes a status or an item (`app.api.maker`, `forge.js`, `loot.js`, `tests/e2e/makers.e2e.ts`) and a recipe "A maker". The Status recipe says "status maker".
- copy-tasks.md: the item maker's words and the inventory's "Add item".
- Commit 5: step 5.

## Decided by the helper

- `app.api.maker` has six members: `open`, `chips`, `picked`, `bonus`, `readBonus`, `effects`. The preview is part of the shell (a body's `preview()` and a `[data-mk-preview]` slot), not a member of its own.
- Chips are HTML plus `picked`, pressed by the shell in the capture phase; a chip option may carry a class (the GM's own statuses keep their gold border).
- The shell's buttons are `[data-cancel]` and `[data-apply]`; `cls` names the overlay and window so the old `.fg-overlay` hooks keep working.
- ui.js's System window keeps its own focus trap (it is not a maker); the Start encounter dialog moved onto the shell.
- The nine bonus fields are empty for 0, with one set of labels everywhere; skills.js keeps its -20..50 clamp after reading them.
- Quick chips add a row (they are no longer toggles). The item's eight are ready rows with values ("Heal 2d4+2", "Damage 2d6", "Worn: +1 attack" and so on), since an empty row would be an error. "Add effect" adds a 1d6 damage row.
- A plain whole number in a flat numeric row is saved as `amount`, anything else as `dice`. A mod's or By rank value left empty reads as 0.
- An op's `when` is kept as given; the editor has no control for it (no rule asked for one).
- Picking an existing status then typing a name or building an effect lets the pick go. The preview moves under the existing chips while one is picked, so the GM sees it before tapping Apply.
- The Strength row shows only when the caller passes the target's rank: the combat card's "+ Status" (a combatant without a rank is E) and the GM board's remote "Status". The Status library's "+ New status" and the item maker's "New status…" have none, so their preview shows all six values.
- A combat card lists what each status does at its source's tier: the brief's tests needed the card to show the C and A numbers, and the GM had no other way to see them on a phone.
- The item maker shows "Affects" only when the item does something on use, and saves `target: 'other'` only then. A player's edit keeps the item's `tell`; only a GM sees the box.
- A held item edited in the maker is replaced whole by the parser's item (it was merged).
- `effects.sanitizeOps` left `app.api.effects` (no caller after the move).
- Legacy heal, MP and fatigue stay fields (see step 3 for the follow-up).

## Unsure

- The item maker's six values by rarity are described with status.ts's ", by rank E to S" suffix. Changing it means `describe` knowing it describes an item; left to the copy pass.
- The Status dialog's "Apply existing" chips now take two taps (preview, then Apply) where they took one. The brief asks for this; a GM who knows the status loses a tap.
- The Award form keeps its plain bundle select (unit 4c replaces it), and its "Custom item…" and the quest form's "Custom…" open the item maker with "Save to library" on, as the Loot Forge did.

## Principles that changed a choice

- Subtract before you add: the Loot Forge's row kinds, `rowsFromEffects` and the kept-ops notes were deleted rather than adapted; `effects.sanitizeOps` went when it lost its callers.
- Minimize reader load: chips read back from the page with `picked`, so no chip object has to be kept in step with the page.
- Test behaviour: every browser test reads what the GM sees (the preview, the card, the AC) or the save, and the counts come from a counter around the taps.
