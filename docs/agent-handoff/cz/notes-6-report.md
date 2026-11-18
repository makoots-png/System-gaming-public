# Notes: unit 6, the report, its screenshots and the recipes

Principles read: unslop. Started at b2c2959.

## Step 1: screenshots

`scripts/maker-shots.ts` drives two phones (390 by 844, scale 2) against `PORT=3260 bun server.ts`: a GM who opens a room and a player who joins it. The GM makes a status, an item, a skill and an enemy through the makers (copying the selectors of `tests/e2e/makers.e2e.ts`), builds a reward in the Award form and sends it; the player redeems the boon. The save is the starter campaign the GM's first run creates, not a fixture. The nine PNGs are in `docs/agent-handoff/cz/shots/`. Nothing was fixed. Each line below is what I saw by eye in the PNG; I measured no control height, so "44 px" claims come from the existing tests, not from these shots.

| Image | Shows | Looks wrong at phone size |
|---|---|---|
| `status-maker-by-rank.png` | Status maker, Frostbite, Damage by rank E to S (9d12 at S), the preview "1d6 / 2d6 / 3d8 / 4d10 / 5d12 / 9d12 damage at turn start, by rank E to S", Cancel and Apply in the sticky bar | Nothing clipped. The dialog scrolls inside itself, so the Name field is cut at the top of the shot: the shot shows the bottom of the form. No horizontal scroll. The Apply bar does not cover a field |
| `item-maker-target-and-tell.png` | Item maker, Bottled Storm, Damage 2d6 and Apply status Bleeding (3), Affects "A target" pressed, preview, "Tell me when it is used" ticked, "Save to library" ticked, Save item | Nothing clipped. The two checkbox rows have a lot of empty space between them. The preview calls nothing by rarity, though the row says "By rarity" (copy-tasks already lists the ", by rank E to S" suffix) |
| `skill-maker-preview.png` | Skill maker, Frost Lance, A target, Rolls to hit, 2d8 by rank with 4d8 at C, Apply status Slowed for 2 rounds, preview of four lines, Save skill | Nothing clipped. Six by-rank boxes fit in one row at 390 px, each about 50 px wide, so a value such as "12d10" would not show whole (not tried) |
| `enemy-maker-skill-status-loot.png` | Enemy maker, Ice Warden at rank C: "Starts with" Hasted 3 rounds, Loot 50 gold and Bottled Storm, preview with stat line, the skill line, "Starts with" and "Drops", Save monster | The remove "x" of the Hasted row wraps to its own line under the name and rounds, so the row is two lines tall where the item row below is one. The skill list is above the shot (not visible), so this shot does not show the skill picker. The skill line in the preview is one long run joined by semicolons |
| `workshop.png` | Workshop at its top: Share custom content, Statuses (Frostbite with its by-rank line, Edit, Duplicate, Delete, Share, "Built-in statuses (14)"), Items (Bottled Storm), the start of Skills | A "Ice Warden saved." toast from the last save sits over the top and hides the page header. The bottom bar covers the rest of the Skills row; Monsters and Rewards are below the fold, so the shot does not show every kind. Four buttons per row fit without wrapping |
| `reward-editor-item-title-boon.png` | The Award form's reward editor, lower half: a Hasted status row, a boon row (name, "What it gives", the line "The player redeems it from their sheet, and you are told."), the Add chips (Title greyed, one title at most), and "The player sees" with five lines | The same stale toast covers the top. The Send award button is under the bottom bar in this shot (the form is not sticky, as notes-4c says). The item row with "Tell me when used" and the title row are above the shot, so the shot does not show the item's tell box |
| `player-sheet-boon-redeem.png` | A player's Status view: Titles with Wolf Slayer (+2 STR, Set active) and "Boons", One free reroll with its text and a Redeem button | Nothing clipped. The button is the same height as the rows around it. The Skills panel is cut by the bottom bar at the foot, as it always is |
| `gm-reward-uses.png` | The GM view after tapping "Reward uses": the Session log open with Kind "use" and "1 of 14 entries", the line "Mira Test used Boon: One free reroll Reroll one die, once this session." | The title and the text run together in the log line with no separator ("...free reroll Reroll one die"). The "Reward uses" button itself is above the shot, so the count is not shown. The toast "Mira Test used Boon..." covers the top. The date is "11/13/2026, 7:13:52 AM" (US order) |
| `share-code.png` | The Share code window over the Data view: "This code holds 1 status, 1 item, 1 skill and 2 monsters", the code in a read-only box, Copy code, Close | The box shows six lines of the code and cuts the seventh, so the GM cannot see it all without scrolling the box (it can be copied). The count says 2 monsters because the starter campaign's gate made one, not the GM. The first run of the script caught the window half drawn; the shot waits 800 ms |

Two things that hold for every shot: the "Used" and "saved" toasts stay on screen long enough to be in a screenshot, and every maker shot is the bottom of a scrolling dialog.

## Step 2: lead-report.md section 12

- Written at the end of `lead-report.md`, in the order of the brief, with the nine images as markdown (`cz/shots/...`).
- Taps come from the test names: Frostbite 8 (the test allows 9), Bottled Storm 9, Frost Lance 13, Ice Warden 10, a saved bundle sent again 5. A flat status at 6 is derived (5 in the inventory plus the Workshop's one more tap) and the report says it is not tested. Making a reward, a bundle, a quest, a gate, a job, a path or a rule number: "not measured", with the place I looked (the tests do not count those taps).
- Two notes disagree and the later one wins. `notes-4a` counted a by-rank status at 7 and an item at 8 from the GM tab. `notes-4b` moved both one tap because the Workshop is under More (8 and 9), and the tests now check those.
- The customization prompt says "default on for custom rewards, off for ordinary loot". The design and the code do otherwise: the item maker and the reward editor start with the box unticked, and a boon always tells. The report says what is built and lists it under "Things the owner can choose".
- Numbers: "after" is the last push row, push-7 (unit 4c): 1,633 bun, 142 browser, 11.6 min. Unit 5 has no push row yet; its own run was 1,657 bun and 6 new browser tests, and the report says so. `bun run test` at the end of this unit: 1,657 pass.
- Helper times are the trail's. Unit 6 is not timed.
- "What a table will notice" has 39 lines, taken from each notes file's "Table-visible", "Decided by the helper" and "Unsure" lists and the trail's unit rows.

## Step 3: AGENTS.md

- The recipe "A new kind of custom content" became "A kind of custom content": the type and parser in core, the `library` list (with `newSave`, the repair line and `LIMITS`), the lines in `Pack`, `PACK_KINDS`, `packOf`, `parsePack` and `mergePack`, the maker on `app.api.maker.open`, the Workshop section, the tests.
- Cut one clause from the reward-field recipe (the editor's console-error check), since the maker recipe says it.
- Every function and file the phase's recipes name was grepped: `newSave`, `LIMITS`, `Pack`, `PACK_KINDS`, `packOf`, `parsePack`, `mergePack`, the reward editor's `ADD`, `CAP`, `blank`, `rowsOf`, `raw`, `rowHtml`, `rollTick`, `statusEntry`, `gmSource`, `itemSource`, `sourceOf`, `atTier`, `rollFor`, `lootOf`, `monsterRow`, `statBlock`, `hiddenWait`, `usedLine`, `itemOps`, `outcomesOf`, the bounds tables, `grantLines`, `rewardLines`, the parsers, `skills.give`, `award.open`, `sync.once`. All exist. Every file path in the file exists.

## Step 4: copy-tasks.md

- The seven "Customization unit N" headings are one "Customization strings to review" group with a "Unit N" heading each.
- Checked against the `TODO(copy)` markers in `src`. Not listed before and added: the target picker "Use NAME on…", a monster skill's line on its card, and a skill with a target used outside a fight (with the words for a percent of an unseen target's max HP). Two lines from the screenshots are under "Unit 6".

## Step 5: checks

- `bun run deps -- --write` and `bun run charts` changed nothing. `bun run test`: 1657 pass, 0 fail.
- I did not run a browser test or `bun run ci`, as the brief says. The port 3260 server I started for the screenshots is stopped.
- Process: a broad `pkill` to stop the server was refused by the permission system. I found the server's process by its environment and stopped only that one.
