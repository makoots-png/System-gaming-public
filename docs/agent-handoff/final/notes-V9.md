# V9: content saved by id, rule values read not stored (partial: 8 rows of 9)

Goal: a GM's library entry is found by its id, never by a name, and a value that follows a rule is read from the rule.
Problem: the makers replaced an entry by name, a bundle's rename lost a bundle, copies were named four ways, the
built-in items were priced once at load, and two paces fell back two ways. Done here: W1, R1, I1, KA1, H9, H6, L1,
B1. Left: M2 (below, with why).

## Inventory (code at 3a6c0ab)

| Row | Verdict | Where |
|---|---|---|
| W1 | still true | library.ts:26-33 `saveNamed` (by name in any case); hunter.js:304-309 `bundles.save` (by exact name); workshop.js:107, 180, 199, 205 (four copy names) |
| R1 | still true | reward-editor.js:327-329: `bundles.save(name)` then `bundles.remove(old id)` |
| I1 | still true | inventory.js:20-21 `POOL` priced at load; :41 the default shop from it |
| KA1 | still true | ability-kinds.ts:185 `paceOf` (standard) beside :196 `ticksOf` (the kind's pace) |
| L1, M2, B1, H6, H9 | still true | as the audit says (items.ts:167, 205; maker.js `formulaField`; monsters.ts:41 and bestiary.js; hunter.js:90, 669-670, 708; save.ts:243 and hunter.js:487) |

## The rows done

**W1.** Cause: which entry a save replaces was decided by name, three ways. Change: library.ts `saveEntry(lib, list,
entry)` saves by id (an edit and a rename keep it) and refuses a name another entry holds in any case (`taken`); the
item and skill makers show the refusal ("Rename this one, or edit that one in the Workshop"), so a save never replaces
an entry the GM did not open. `copyName(name, taken, max)` is the one rule ("(copy)", "(copy 2)", ...) for items,
skills, statuses, monsters and bundles. `saveNamed` is deleted. Tests: library.test.ts. Commits 84f0463, 1ca95f5
(skills.js, Lane A's).

**R1.** Cause: a rename was a save by name then a delete. Change: rewards.ts `saveBundle(lib, id, name, rewards, cap)`
saves by id (a rename is one write) and refuses `taken`; `bundles.save(name, rewards, id?)` answers `{ ok, id }` or why;
the bundle maker words `taken`, and the Award form's "Save as bundle" asks before it replaces a bundle of that name
(the replacement is then that bundle's own id). Test: party.test.ts "a rename onto another bundle's name is refused".

**I1.** Change: items.ts `defaultShop(R)` and `builtInItems(R)` build at each read; inventory.js reads them. Test:
items.test.ts (a price rule changed reaches an item priced by the rule). Commit 1a28bbf.

**KA1.** Change: `ticksOf` asks `paceOf`. Test: ability-kinds.test.ts (fails with the old fallback, checked by hand).
Commit 285071f.

**H9.** Cause: "no job" was the string 'None' compared in three places, and `setJob` refused a blank. Change: save.ts
`jobOf` reads a job (a blank, a non-string or the old 'None' is null) in the repair, the sheet parser and `setJob`; a
blank clears a job; `canExtract` takes null; the views show a job when it is not null. A typed job "None" now reads as
none (it is the old default's word). Tests: record.test.ts, save.test.ts; lint "no job is null". Commit db6210c.

**H6.** Cause: a rule title had no key, so "the hunter holds it" was a name compare: a held rule title the GM renamed
was offered again under Available titles (and a reward gave it twice), and a GM title written with a rule title's name
hid the rule title. Change: the rules' titles have a `key` (rules.ts); a GM's override keeps the key it gives or makes
one from the name (overrides.ts, which also keeps `gmOnly`, dropped before); a held title records `seedKey` where
`giveTitle` makes it (record.ts; `holdsTitle(h, spec, seeds)` reads the key for a rule title, the name otherwise); a
reward carries the key of the rule title it copies (`RewardTitle.key`, `titleReward`, the reward editor's built-in pick
by key) and keeps its own words; the save repair drops a key that is not one (`titleKey`, ids.ts); the starter hunter's
Wolf Slayer records its key. Tests: record.test.ts (renamed still held; a bare title of the same name is another),
rewards.test.ts (a renamed rule title is not given again), overrides.test.ts, save.test.ts. Commit 94851ca. A held rule
title from before this commit has no key, so it reads as a GM title of that name; no repair matches it by name (old
saves need not keep working, and matching by name is the bug).

**L1.** Cause: a rule's number was stored on the item as if typed: a built-in item's price (`def.value || priceOf`)
when it was made, and a weapon's weight (`weaponWeight(dice)`) while the maker's "touched" Set (kept only while the form
was open) said the GM had not typed one; and a price of 0 sold at a second rule (base x multiplier, not x 10). Change:
`Item.value` and `Item.weight` are optional, absent meaning the rule's, read through `valueOf(i, R)` and `weightOf(i)`
(items.ts) by `buy` (now takes R), `sellPrice` (half of `valueOf`, at least 1; a free item sells for 0), the sheet's
gear (`gearOf`), the shop's price and the item line; `parseItem` keeps a typed number and leaves out anything else;
`itemOf` leaves both out unless the def sets them; the item maker shows a blank Value and Weight with "By the rule: N"
(TODO(copy)), redrawn as the rarity or dice change, and the `touched` Set is gone. Armor and resist from a kit stay
typed numbers (the kit chips fill them). Tests: items.test.ts ("a price and a weight by the rule"), inventory.test.ts
(bought and sold at the rule as it is now; a free item), makers.e2e.ts (the weight placeholder follows the dice).
Commit 29e4e40. A held item from before has its old numbers, which now read as typed.

**B1.** Cause: the monster maker saved the rule's XP (`xpOf(rank, kind)`) as a number, and "follows the rule" was
guessed on open by equality (`xpTouched`), so a change of the XP table reached no saved monster and a typed XP equal to
the rule's was overwritten by the next rank pick. Change: `Monster.xp` is optional, absent meaning the rule's, read by
`monsterXp(m, R)` (monsters.ts) in a monster's fight row (`monsterRows`, rows.ts, whose rules now include `rankTable`),
the fight's award and a gate's card and XP (combat.js, gates.js `xpOf`), and the bestiary's card and list; `parseMonster`
keeps a typed number only; `statBlock` leaves it out; the maker's XP field is blank with "By the rule: N" (TODO(copy))
and `xpTouched` is gone. The seeds keep a number, built at each read with their own factor (a boss's 1.2 and so on). A
row keeps the number it joined with. Tests: monsters.test.ts (the XP table as it is now; a typed XP kept), makers.e2e.ts
(the placeholder follows rank and kind; a typed 999 kept). Commits f1d8a1e, d132005 (Lane A's rows.ts, combat.js,
gates.js; Lane A was merged by then; f1d8a1e alone does not typecheck, the pair does).

## Left, and why

This one changes what a saved thing holds (an ability's effect), so it needs a field of save.ts with its repair line,
the maker that writes it, and every reader of the value:

- M2 (an ability that follows the recommended formula): the effect's union lives in ability-types.ts and is read by
  fight-parse.ts and resolve.ts; the smaller variant is a row worked out from the rule where `formulaEdited` is false, in
  rows.ts.

It is the largest of the nine (the effect's union read by fight-parse.ts and resolve.ts, the maker's formula field), and
my lane's time ran short; a helper can take it as one unit (V9b). Nothing of it is half done in the tree.
