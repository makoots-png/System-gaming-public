# Notes: unit 4c, the reward editor, bundles, boons and the GM's use log on screen

Principles read: experience first, minimize reader load, migrate callers then delete, test behaviour, unslop.

## Step 1: one reward editor

- Home: a new `src/views/reward-editor.js`, registered as `app.api.maker.rewards` by maker.js (`RewardEditor` in api.ts). It is a component, not a dialog: the Award form and the quest form embed it, and the Workshop's bundle maker puts it in a maker shell.
- What it edits: XP, Gold, Points in one row (`<id>-xp`, `<id>-gold`, `<id>-pts`, so the Award form keeps `#gm-xp`, `#gm-gold`, `#gm-pts` and the tests that fill them); then a row per part, added by the chips Item, Title, Skill, Status, Boon, Job. An item row starts as a select (Library, Shop, Built-in, "New item…" opens the item maker), then shows the item's type and effects, Qty and "Tell me when used". A title row: a select of the built-in titles ("A new title" first), name, description and the nine bonus fields. A skill row: a select (Built-in, Library, "New skill…" opens the skill maker). A status row: the rules' statuses (no state chip) and rounds (3 to start; empty is until removed); it carries its def as written (`statusEntry`). A boon row: name, text and "The player redeems it from their sheet, and you are told." A job row: text with the jobs list. A chip is disabled at its list's bound (`REWARD_BOUNDS`; one title, one job).
- The Bundle row at the top: a select of `app.api.bundles.list()` that fills the editor, and "Save as bundle…" (`ui.promptText`; same name replaces, as `bundles.save` does).
- The preview, "The player sees", is `grantLines` (new, src/core/rewards.ts): the reward window's lines. `applyRewards` (hunter.js) now builds its window from `grantLines` too (what it gave: a title only when new, a status only when it took), so the preview and the window cannot drift. Case in tests/rewards.test.ts.
- `value()` is `parseRewards` of what the rows hold; a difference between the two is logged as a console error (a form bug; a browser test fails on it), as the makers do. `blocked()` is true while a row is unfinished (an item or skill not picked, a title, boon or job without a name, rounds out of range); the row says why.
- The Award form uses it in this commit (the deps test refuses an API member with no caller): the XP, Gold, Points and Title fields, the item select, its qty, the item card, the custom item fields, the bundle select, "Also gives", Save as bundle and Delete bundle are gone from gm.js, with `formReward`, `fillAward`, `pickedItem`, `openForge`, `refreshItemSelect`. `award.open(rewards, bundleId?)` fills the editor.
- `loot.library` left `app.api.loot`: its one caller was the Award form's item select. `bundles.remove` has no caller until the Workshop's Rewards section (step 5): it is in the deps test's UNUSED list until then.
- Tests changed: rewards.e2e.ts "the GM saves the Award form's reward as a bundle..." drives the editor (XP, Title chip, the built-in Wolf Slayer, Save as bundle…, the Bundle select); makers.e2e.ts's Award loot step reads the editor's item row and the preview instead of "Also gives".
- `bun run test`: 1633 pass. Browser: rewards 3 passed.
- Commit 1: step 1 (with the Award form, the editor's first caller).

## Step 2: the Award form and the quest form use it

- The Award form moved in step 1. The fight's "Award loot…" calls `award.open(loot)`, and the loot's gold and items arrive as the editor's number and item rows (makers.e2e.ts reads the item row and "Item acquired: Frost Shard" in the preview). "Also gives" is gone.
- The quest form (quests.js): its Rewards fieldset is the editor (`id: 'qf'`, `floor: true`, so a quest's XP, gold and points stay at 0 or more as `formRewards` kept them). Deleted: the XP, points, gold, title and job fields, the item select and its picks, the `Name | rarity | qty` text lines, `fillItemSel`, `renderPicks`, `onItemSel`, `parseItems`, `formRewards` and their CSS. The quest's skills, statuses and boons are now shown and edited, not kept unseen. The Job Change preset adds a job row (`editor.ensure('job')`) and the title follows what is typed in it; a job quest without a job says so and adds the row.
- The GM view's Issue quest is unchanged.
- `bun run test`: 1633 pass. Browser: makers 12 passed.
- Commit 2: step 2.

## Step 3: boons on the sheet

- Unit 3 already drew the Boons block in the Titles panel (name, text, Redeem, which confirms, removes and reports through `uses.report`), and hides it when empty. Decided by the helper: it stays in the Titles panel (the sheet's pattern: a hunter's earned things in one panel) rather than a panel of its own.
- New: on a GM's phone each boon also has a remove button (×, "Remove boon NAME"): a confirm, then the boon leaves the hunter. Nothing is reported, since nobody used it (`removeBoon`, hunter.js).
- Browser (rewards.e2e.ts): "a GM takes a boon back from a hunter on this phone...": the block goes, the hunter has no boon, the log has no `use` line. 1 passed.
- `bun run test`: 1633 pass.
- Commit 3: step 3.

## Step 4: the GM sees uses

- The Table feed's row for a use (table.js `usedHtml`): the player's name and the thing in bold on the first line ("**Mira** used Item: **Flash Bomb** on a target"), what it did on a line of its own (the outcome words; a boon's text). "Apply to…" as before when it has a target and a fight has anyone up. used.e2e.ts reads the second line ("5 damage") instead of one joined line.
- The GM view's top (above the sections, kept first in the desktop columns): "Reward uses" with a gold count, and beside it unit 3's notify button with its state in words (moved from the Session log section; same ids). One tap unfolds the Session log, sets its Kind filter to `use`, scrolls to it and marks the uses seen.
- The count is derived: the log's `use` lines whose time is after `usesSeen`, a new device pref (src/edge/store.ts `Prefs`, an ISO time, '' for never). Decided by the helper: device prefs rather than the save's settings (no save field, no repair line, and a last-seen time belongs to this phone, not the campaign); the log is capped at 200, so the count is bounded too.
- `questUpdate` on the GM's phone (quests.js): a completed or failed quest's log line is written through `app.api.sync.once(eid, write)`, as uses.js writes a told use, and its toast shows only when the line was written. A progress tick is left on the poll cursor, so the 200-id ring holds told uses and quest ends, not every tick (a replayed progress tick can still write its "Quest progress" line twice).
- Browser (used.e2e.ts): the boon test now taps "Reward uses" (count 1, then hidden) instead of unfolding the log and picking the filter; a new test "a player completes the GM's quest: the GM's log says so once, and a replay after a reload writes nothing more" (the cursor set back to 0 and the page reloaded, as the boon test does). With the guard taken out by hand it fails with two "COMPLETED" lines; restored, 6 passed.
- `bun run test`: 1633 pass.
- Commit 4: step 4.

## Step 5: the Workshop's Rewards section

- workshop.js: a fifth section, Rewards (`bundle`), after Monsters. Each bundle: its name, its `rewardLines` in one line, and Award…, Edit, Duplicate, Delete. Award… is `award.open(rewards, id)`: the GM view's Award form opens with the editor holding the bundle and the Bundle select showing it. New and Edit open the bundle maker: a maker shell (cls `rwm`) with a Name field and the reward editor alone (no Bundle row). Save keeps it through `bundles.save` (the same name replaces); an edit that renames removes the old one. Duplicate saves "NAME (copy)" ("(copy 2)" when that is taken; refused with a toast at 200). Delete asks, then `bundles.remove`, which leaves the deps test's UNUSED list.
- Browser (makers.e2e.ts): "the Workshop's Rewards: New opens the reward editor alone, Duplicate copies, Edit renames, Delete removes". 1 passed.
- `bun run test`: 1633 pass.
- Commit 5: step 5.

## Step 6: browser tests

All on a 390 px phone, every action under test tapped; the store sets up and reads.

- `tests/e2e/reward-room.e2e.ts` (new, the room file, copied from room-sync.e2e.ts), one scenario in steps: the GM builds 100 XP, a Health Potion marked "Tell me when used", a new title "Wolf Slayer" with +2 STR, Hasted and the boon "One free reroll" in the Award form; the preview reads the five window lines; Save as bundle… keeps "Wolf hunt"; the award reaches the player (the window's lines; the title with +2 STR, the "Hasted · 3r" chip, the boon, the potion with its mark). The player redeems the boon: it leaves the sheet; the GM gets the toast, "Reward uses" 1, one log line with the name, the boon and its text, and the Table feed row with the text on its second line. The player uses the potion: a second line; a Trail Ration without the mark writes none (checked once the GM's copy of the sheet no longer holds it). The GM's cursor set back to 0 and the page reloaded: the same two lines. A second night: More, Workshop, Award… on "Wolf hunt", the player, Send award = 5 taps (the test counts them), and the player has the boon again.
- makers.e2e.ts: "a quest whose reward is made in the reward editor pays it on completion, the boon included" (40 gold and "Guild favor" from the quest form; the card lists the boon; Complete's window lists it; the hunter has both); "on a 390 px phone the reward editor with a row of each kind scrolls only up and down, and every control is at least 44 px tall"; and step 5's Workshop test.
- Solo: unit 3's used.e2e.ts "out of a room, a redeemed boon is written to this phone's own session log and nothing is sent" is the brief's solo case; not copied.
- Fixed on the way (inventory.js): `stackKey` now includes the "tell" mark, so a told potion awarded to a hunter who holds the same untold potion keeps its own stack (it merged before, and the mark was lost).
- Browser: reward-room 1 passed, first run. makers: 14 passed, 1 failed (Frost Lance, 22 s against its usual 8 s, a timeout); rerun alone, passed: a pause of the box.
- `bun run test`: 1633 pass.
- Commit 6: step 6.

## Step 7: checks and AGENTS.md

- AGENTS.md: the reward row names the reward editor and `grantLines`; the Workshop row names Award…; the use row names the quest end's once-guard and "Reward uses"; a recipe "A reward field" (the type, `parseRewards`, `rewardLines` and `grantLines`, `applyRewards`, the editor's row) and one for a use the GM should hear of. The saved-field recipe points to it.
- copy-tasks.md: a section for unit 4c.
- `bun run test`: 1633 pass, 0 fail. `bun run deps -- --write` rewrote the map with each commit. No machine changed, so no chart.
- Browser, one run (17.4 min), no failure: character, combat-turns, custom-skills, customization, gates-quests-dailies, rewards, room-onboarding, room-sync-fixes, room-sync, room-view, save, table-session, upgrade, used, reward-room: 124 passed. makers ran in step 6 (15, one pause rerun). After the clamp: reward-room and rewards 5 passed.
- The editor's XP, gold, points and title bonus inputs are clamped to `REWARD_BOUNDS` as typed, so a number past a bound is never a parser difference (found reading the code after step 6, not by a test).

## Decided by the helper

- The editor lives in a new `src/views/reward-editor.js`, registered by maker.js as `app.api.maker.rewards` (maker.js imports it; the editor reaches the other maker parts through `app.api.maker` at call time, so the two files do not import each other). It is a component a form embeds, with its own preview; the Workshop puts it in a maker shell.
- One preview wording: `grantLines`, the reward window's words, which `applyRewards` now uses too. The quest card keeps `rewardLines` (shorter words); the copy pass may make them one.
- The editor keeps the Award form's ids `gm-xp`, `gm-gold`, `gm-pts` (its `id` option), so the tests that award XP and gold by those ids did not change.
- A part is a row added by a chip; an item or skill row starts as a select, so adding one is a chip and a pick. A title row's select starts on "A new title"; picking a built-in fills its name, description and bonus, which stay editable. One title and one job at most (a reward holds one of each).
- Every reward status carries its def as written (`statusEntry`), the AGENTS rule for a status that travels.
- "Save as bundle…" is in the editor (Award form and quest form); deleting a bundle is the Workshop's (the Award form's Delete bundle went). The bundle maker in the Workshop has a Name field and no Bundle row; an edit that renames removes the old bundle; Duplicate picks "(copy)", then "(copy 2)" and on.
- `award.open(rewards, bundleId?)`: the Workshop's Award… shows the bundle picked in the Bundle select.
- Boons stay in the Titles panel; a GM's × takes one back without a report.
- "Reward uses" keeps its last-seen time in the device prefs (`usesSeen`), not the save. One tap opens the Session log filtered to `use` and marks them seen. The notify button moved beside it.
- The quest end's once-guard covers done and failed only; progress ticks keep to the cursor.
- A told item has its own stack (`stackKey` reads `tell`).

## Unsure

- A replayed quest progress tick can still write its "Quest progress" line twice (left on the cursor, as asked).
- The reward window's words and the quest card's words still differ ("Item acquired: X" and "Item: X").
- The quest form is a `<form>`: Enter in one of the editor's text fields submits the quest, as Enter in the old reward fields did.
- The Award form's Send award is not a sticky bar; on a phone with a long reward the GM scrolls to it (the maker shell's sticky bar applies to the Workshop's bundle maker only).
