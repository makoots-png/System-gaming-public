# Customization: the model

Decided by the lead from `inventory.md`. The owner: "The ability to make custom abilities, status effects, custom rewards, items, enemies, etc... and ways to notify me when players have used rewards."

## One rule

A custom entry is data of the same type as a built-in, read by the kind's one parser, kept in one place per kind in the save, and found through the same lookup as a built-in.

| Kind | Type | The one parser (core) | Home in the save | Lookup |
|---|---|---|---|---|
| Status | `StatusDef` | `sanitizeDef` | `library.statuses` (a record by key; a built-in key is an override) | `statusDef` through `rulesOf(...).conditions` |
| Item | `Item` | `parseItem` (new, replaces `fixItem`, `givenItem`, `clean`, `cleanItem`) | `library.items` | copied by value, as today |
| Skill | `Skill` | `parseSkill` (new) | `library.skills`; built-ins in `registry/skills.ts` | copied by value onto a hunter or a monster |
| Enemy | `Monster` | `parseMonster` (new, from `bestiary.js` `clean` and the repair) | `monsters[]`, as today | `bestiary.get` |
| Reward bundle | `{ id, name, rewards: Rewards }` | `parseRewards` (new, replaces `givenRewards`, `cleanRewards` and the repair lines) | `library.rewards` | by id |
| Rule number | `rulesOverrides` | `parseOverrides` (new, from `validate` in `gm.js`) | `rulesOverrides` | `rulesOf` |

Each list is capped at 200, the cap `library.items` has. Each parser runs at load, at save, on a room message and on import.

Decided against. Makers for jobs, paths and rule numbers (the brief's list stops at abilities, statuses, items, enemies, rewards; the JSON editor stays, now checked at load). Quest and gate templates (a reward bundle covers the repeated part). Save DCs (the GM rules on them; a note line says so). Any formula or script.

## Statuses

- `rulesOverrides.conditions` moves to `library.statuses` at load and the rules editor refuses the key. `rulesOf` merges the library over the built-ins. The `custom: true` mark goes: an entry is custom because it is in the library.
- The dialog edits a built-in too (it saves an override under the same key; Delete restores the built-in).
- The dialog writes `tiers` ("By rank": six numbers, prefilled flat) and `pct` (percent of max HP a turn), shows `describe` of the def being made as it changes, and asks the rank when a status is put on by hand (`gmSource(rank)`, default the target's rank).

## Items

- One parser and one set of bounds: qty 1 to 9999, heal 0 to 99,999.
- An item op with `tiers` resolves at the item's rarity when used and when worn, through the resolver `statusDef` uses, exported once.
- `target: 'self' | 'other'` (default `self`). All of an item's use effects go to that one target.
- `tell?: true`: the GM is told when it is used. Off for loot, because a potion every fight is noise. The GM turns it on per item when giving it.
- `lootTables` (no writer) and a monster's `statusDefs` (no reader) are deleted.

## Skills (abilities)

- `Skill` gains `effects: Op[]` (the vocabulary items and statuses use), `target: 'self' | 'other'` and `attack: boolean` (roll to hit the target's AC first). `dice` stays what it is: a roll the table reads.
- The eight seeds move from `skills.js` to `src/core/registry/skills.ts`, with a table test.
- A monster holds `skills: Skill[]` beside its text abilities, `statuses` it starts a fight with, `elite`, and `loot: { gold, items }`. A shadow has no abilities and combat stops reading them.
- One fight command carries a use:

```ts
type Outcome =
  | { kind: 'damage' | 'heal' | 'mp' | 'fatigue'; n: number }
  | { kind: 'status'; key: string; rounds: number | null; def?: StatusDef }
  | { kind: 'cure'; key: string }
  | { kind: 'note'; text: string };
{ type: 'use'; by: CombatantId; on: CombatantId; name: string; outcomes: Outcome[] }
```

  `outcomesOf(ops, tier, target, roll)` in core turns ops into outcomes with an injected roller. The view rolls and sends. The reducer applies them to `on`, with `sourceOf(by)` as a status's source, writes one log line, and refuses a combatant it does not have. MP and cooldown stay on the hunter's sheet. A monster's cooldown is text.
- So a hunter's skill or item can hurt an enemy and put a status on it, and a custom enemy's skill does the same to a hunter.

## Rewards

`Rewards` = xp, points, gold, items, job, and now:

- `title: { name, desc, bonus } | null` replaces `titleName`, so a custom title carries its bonus.
- `skills: Skill[]`: the way a GM gives a skill to a player's phone.
- `statuses: { key, rounds, def? }[]`.
- `boons: { name, text }[]`: a custom text reward the GM honours at the table. A hunter holds `boons: Boon[]` (`id`, `name`, `text`, `at`) until the player taps Redeem. Cap 50 a hunter.

A bundle is a named `Rewards` in `library.rewards`. The Award form and the quest form share one reward editor that loads and saves bundles.

## Use reaches the GM

A new room message `used`, sent by a player's phone (the server checks the sender owns the sheet; that check moves into `DEFS` as a flag):

```ts
{ by, what: 'item' | 'skill' | 'boon', name, text, target: 'self' | 'other', outcomes: Outcome[], tell: boolean }
```

- Sent when a boon is redeemed, when an item with `tell` is used, and when an item or skill has `target: 'other'` (the GM applies it). It replaces the `item` and `skill` kinds of `roll`.
- On the GM's phone: a Table feed row (with "Apply to…" for `target: 'other'`, which sends the `use` command). With `tell`: also a line in the session log (new kind `use`, the log's cap of 200), a toast, and a notification when the page is hidden and permission is granted.
- Solo play writes the same log line locally.
- Notifications. A button in the GM view asks for permission. A GM's hidden page polls every 30 s while permission is granted (one small request; browsers already slow background timers to about one a minute). A phone with its screen locked gets nothing until it is opened, when the missed uses arrive in the feed and the log. Real push needs a push service and keys, so it is not built. The report says so.

## The remote Job Change chain

A GM-only message `chain` `{ to, job, kind: 'issue' | 'reissue' | 'abandon' }`, applied once on the player's phone through `quests.issueJobChain` and the chain machine.

## Makers

One module, `src/views/maker.js`: the dialog shell (focus trap, keyboard fit, sticky bar), chips, the nine bonus fields, the effects editor (rows of ops, each flat, by rank or percent) and the live preview. The status, item, skill, enemy and reward makers use it. One Workshop view lists the library by kind with New, Edit, Duplicate, Delete and Share.

## Sharing

`io.js` exports the library (all, one kind or one entry) as a file or a pasted code, `{ schema: 3, kind: 'library', library, monsters }`, and imports it through the parsers with Add (keep both) or Replace (same key or name).

## Units, in order

1. Core homes and parsers (statuses, items, overrides, monsters; the deletions).
2. Skills, the `use` command, monsters with skills, statuses and loot.
3. Rewards, boons, bundles, `used`, `chain`, the GM log, notifications.
4. Makers: (a) the shared module, status and item; (b) skill, enemy, use in a fight and from the feed; (c) the reward editor, bundles, boons, the Workshop.
5. Sharing.
6. Recipes, charts, the dependency map, the report and its screenshots page.
