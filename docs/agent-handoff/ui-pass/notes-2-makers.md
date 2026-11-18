# Notes, unit 2: the creation flows

Principles read: experience-first, test-behavior-not-implementation, type-system-discipline. Type-system-discipline made the Status dialog's options one union (`ForgeOpts` in `src/core/api.ts`: `{ mode: 'apply', title, target?, rank? }` or `{ mode: 'library', edit? }`) instead of a boolean pair; the typecheck found every caller.

## Steps 1 and 2: the Workshop status maker (A1), one tap for a built-in status (A24)

One commit: both change the same window in `forge.js`, and the one-tap chips only exist in the apply mode step 1 makes.

- `mode: 'library'` (the Workshop's New and Edit, and "New status…" in an effects row of the item, skill and status makers): name, description, effects, preview, colour; button "Save status". No Rounds, no Apply existing, no Save to library. It always saves to the library.
- `mode: 'apply'` (a combat card, a remote hunter's card on the GM board): Rounds and Strength on top, then the existing statuses. A tap on one closes the window and puts it on with the Rounds and Strength shown. The chips are no longer a pressed group; each has the status's description as its `title`. The preview is for the new status only.
- A status has no duration of its own in `StatusDef`, so Rounds starts at 3 as before. Adding a duration would be a save shape change; left.
- Tests: `makers.e2e.ts` "from the Workshop, New status has no Rounds, no Apply existing and no Save to library, and one Save status button keeps it"; "in a fight, Poisoned goes on a monster one tap after the Status window opens, with the Rounds and Strength the window shows" (1 tap, rounds 5, source tier 3 for B). Rewritten from two taps to one: three tests in `makers.e2e.ts`, one in `combat-turns.e2e.ts`, `table-session.e2e.ts` "on a phone one tap on a built-in status ... applies it, and the card says what it does". The mouse test of the Workshop's New status now checks the title and Name, not Rounds.
- Taps to apply a built-in status once the window is open: 2 before, 1 after (run).
- `scripts/ui-shots.ts`: `status-dialog-picked` is now the card after the one tap.

## Step 3: makers from home (A9)

- The GM view starts with a Make row (`#gm-make` in `gm.js`): Status, Item, Skill, Enemy, Reward, and "Workshop →" (quiet). Five equal columns at 390; a wrapping row at 1100 and up. Each calls what the Workshop's New calls: `forge.status({ mode: 'library' })`, `loot.item({})`, `skills.make({ give: [] })`, `bestiary.make(null)`. The reward bundle maker was a function inside `workshop.js`, on no `app.api` member; it moved to `reward-editor.js` as `bundleMaker(app, b)` and both views import it. No API member added.
- The app still opens on Status for a GM (`route()` in `src/app.js` defaults to `status`), so a maker is two taps from launch (GM tab, then Make) and one from the GM view. Opening a GM on the GM view is `app.js`, outside this unit's files; left for the lead or unit 4.
- Test: `makers.e2e.ts` "on a 390 by 844 phone, each button of the GM view's Make row opens its maker in one tap" (each button in view, one tap, the maker's heading; then Workshop opens the Workshop).

Taps from launch (the view the app opens on), run, before and after:

| Make | Before | After | How now |
|---|---|---|---|
| A status (Frostbite) | 8 | 7 | GM tab, Status, then the form |
| An item (Bottled Storm) | 9 | 8 | GM tab, Item, then the form |
| An enemy (Ice Warden) | 10 | 9 | GM tab, Enemy, then the form |
| A skill (Frost Lance) | 13 | 13 | still from the Skills panel (step 6) |

## Step 4: the item maker (A11)

- The worn block (Slot, Bonus while worn, and the quick chips "Worn: +1 attack / damage / AC", marked `worn` in `QUICK.item` in `maker.js`) shows only for a weapon, armor or accessory; the window gets `lf-unworn` otherwise. A type that is not worn saves the slot and bonus the item already had when its type did not change (as the old form kept the heal fields of a non-consumable), else none.
- Heals HP, Restores MP and Removes fatigue are gone from the form. An item that holds them opens with them as effect rows (`legacyOps` from `src/core/effects.ts`, `when: 'use'`), and Save writes `heal: 0, restoreMp: 0` and the rows. `parseItem` and `effectsOf` are unchanged, so an old item not re-saved still heals.
- Tests: "in the item maker a consumable shows no slot, no bonus while worn and no Worn quick effects; a weapon shows all three"; "an item saved before with Heals HP 10 opens in the maker with a Heal 10 row, and saved again it still heals 10 when used" (Use in the inventory, HP +10).
- Taps for Bottled Storm unchanged at 8 (it never touched the removed fields).

## Step 5: a skill's value at the monster's rank (A12)

- `describeAt(R, ops, from)` in `src/core/combat/status.ts`: each op through `atTier(o, from.tier)` (the path that already resolves a tier), then `describe`, so a status it applies is also described at that tier. `describe` itself is unchanged: an item and a hunter's skill still show all six.
- The source comes from the core: the combat card uses `sourceOf(c, ctx())` (`monsterSkillHtml` in `combat.js`); the enemy maker's preview uses the new `monsterSource(m, id, name)` in `src/core/registry/monsters.ts`, which `monsterRow` now uses too. `skills.lines(k, from?)` takes the source; `SkillsApi.lines` says so.
- Tests: `tests/status.test.ts` "a C-rank monster's skill that deals 2d8 by rank with 4d8 at C says only "Deals 4d8 damage", and a flat op stays" and "a skill that applies Scorch, used by a B-rank monster, says what Scorch does at B". `makers.e2e.ts` Ice Warden: the enemy maker's preview reads "Deals 4d8 damage", and the card in the fight reads "Deals 4d8 damage" and not "by rank".
- Left: the skill rows inside the enemy maker's form (under Skills) still show all six; they are drawn once, not on each rank change.

## Step 6: the skill maker (A21) and its taps

- Two columns at 1100 px and up (`.skm-cols`, `.skm-col`, the same pattern as `.lf-cols`): name, type, description, MP, cooldown, table roll, Affects and Rolls to hit on the left; effects, preview, Give to and Save to library on the right. A phone keeps one column.
- Fields that now start filled, and why each is the common case:
  - **Rolls to hit** starts ticked on a new skill. It shows only when the skill affects a target, and a skill aimed at someone else is an attack far more often than not (every seed monster ability that targets rolls to hit). An edited skill keeps what it saved.
  - **Affects** follows the first effect until the GM taps it: Damage or Apply status makes it "A target", anything else "The user". A heal, a cure or a buff is on the user; a hit or a debuff is on someone else. Once tapped it stays as tapped (test below).
  - **A new effect row's field** takes the focus with its text selected (`maker.js`, all makers), so after the Damage chip the GM types "2d8" over "2d6" without tapping the field.
- Nothing is hidden: Affects and Rolls to hit stay on screen and in the preview ("On a target: rolls to hit its AC first").
- Taps for Frost Lance (a target, a to-hit, 2d8 by rank with 4d8 at C, Slowed for 2 rounds), from the Skills panel's Add skill, which gives to the active hunter: 13 before, 10 after (run): Skills jump, Add skill, Name, Damage, By rank, the C value, Apply status, the status select, Rounds, Save skill. From the Make row it is one more (GM tab, Skill, and a tap on the hunter under Give to, since the Workshop's maker gives to no one by default): 11.
- Tests: the Frost Lance test asserts at most 10 and that Affects is "A target" and Rolls to hit is ticked; new "in the skill maker a new skill with a Heal effect affects the user, and a target the GM picks stays picked when the effects change".

## Step 7: small ones

- A25: the enemy maker's starting status row puts Rounds under the name (`.enm-rounds`, its own line), so the × stays on the name's line at 390. Test: "on a 390 px phone the enemy maker's starting status row keeps its × on the line of the status's name".
- A26: Enter in a field of the reward editor inside the quest form is stopped in the form's keydown (`quests.js`); Ctrl or Cmd+Enter still saves. The quest test now presses Enter in the boon's name and in the gold and sees the form still open and no quest.
- A33: a Workshop row is one button (`.ws-row`, `data-act="edit"`, "Edit <name>") that opens the maker. Duplicate, Share, Delete and Reset are behind "⋯" (`.icon-btn`, "More for <name>"), a list window with Delete and Reset as danger, and each still asks. Give to… (skill) and Award… (reward) stay on the row: they are what a GM comes to the row for. A built-in status's row has no "⋯". Tests rewritten to go through "⋯": the skill delete and the reward duplicate and delete in `makers.e2e.ts`, the reset in `combat-turns.e2e.ts`, the item share in `sharing.e2e.ts`; the Workshop test also checks a tap on the row opens the skill in its maker and that Duplicate, Share and Delete are not on the row.
- A31: a session log line is the kind and time, then the title on its own line, then the text on its own line (`.lt`, `.lx` in `gm.js`). The share code box (`io.js`) has as many rows as the code needs at about 36 characters a row, 4 to 12, and scrolls past 45 per cent of the screen.

## Step 8: everything

`E2E_CHROMIUM=/opt/pw-browsers/chromium bun run ci` on `9977f0e`, nothing beside it, last lines:

```
 1659 pass
 0 fail
  157 passed (12.1m)
CI passed
```

Then `PORT=3261 bun server.ts`, `scripts/ui-shots.ts` into the session scratch folder `after-2/`: 117 shots, no missing step. The script's only change is in step 2 (the status window closes on the chip tap, so `status-dialog-picked` is the card after it). Looked at: `gm-390-02` and `gm-1280-02` (Make row: five buttons in one row at 390, a short row at 1280, Workshop → at the right of the label on a phone), `gm-390-04` (Workshop New status: no Rounds, no Apply existing, Save status), `gm-390-06` and `gm-1280-06` (consumable: no Slot, no bonus, no Worn chips, two columns at 1280), `gm-1280-07` (skill maker in two columns, Rolls to hit ticked), `gm-390-08` (enemy maker: Hasted with × on its line and Rounds under it; preview "Deals 4d8 damage; Applies Slowed (2 rounds): AC −4"), `gm-390-10` (Workshop rows: the row and "⋯", Give to… on a skill), `gm-390-24` (apply mode: Rounds, Strength, then the chips), `gm-390-27` (Ice Warden's card: "Deals 4d8 damage"), `gm-1280-32` (session log: title, then text on its own line), `gm-390-36` (share code box: 12 rows, the rest scrolls).

## Tap counts, run, from the view the app opens on

| Make | Before | After |
|---|---|---|
| Apply a built-in status, once the window is open | 2 | 1 |
| A status (Frostbite) | 8 | 7 |
| An item (Bottled Storm) | 9 | 8 |
| An enemy (Ice Warden) | 10 | 9 |
| A skill (Frost Lance) | 13 | 10 (Skills panel), 11 (Make row) |

From the GM view each maker is one tap. The biggest remaining cut is opening a GM's phone on the GM view (`src/app.js` `route()`), which would take one tap off each row; outside this unit.

## Unsure

- Steps 1 and 2 are one commit (same window, same lines).
- A status has no duration of its own, so Rounds in the apply window starts at 3, not "the status's own duration" the design names.
- The reward bundle maker moved out of `workshop.js` into `reward-editor.js` (`bundleMaker`) so the GM view can open it without a new API member.
