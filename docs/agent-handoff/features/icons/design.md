# Icons: the design

the owner: "For sure enemies, items, statuses. Idk about abilities since we will be making a lot of them." The lead
(handoff 4a): SVG in the repository, one registry in core, a key on an enemy, an item and a status, picked in its
maker, a default from what the thing is, an ability shown by its kind. This file settles how; nothing is built.

The shape exists. `EMBLEMS` (`src/core/rules.ts`) is twelve 24 by 24 filled SVG paths held in core as strings. Icons
grow it into a registry and fold the emblems in, so there is one way to name and draw a picture.

## 1. The registry

`src/core/registry/icons.ts`, pure, imports nothing.

```ts
export const ICON_GROUPS = ['foe', 'item', 'status', 'ability', 'emblem'] as const;
export type IconGroup = (typeof ICON_GROUPS)[number];
type IconDef = { readonly group: IconGroup; readonly label: string; readonly path: string };
const ICONS = { wolf: { group: 'foe', label: 'Wolf', path: 'M...' }, /* ... */ } satisfies Record<string, IconDef>;
export type IconKey = keyof typeof ICONS;
export const ICON_KEYS: readonly IconKey[];
export const isIconKey = (v: unknown): v is IconKey => typeof v === 'string' && Object.hasOwn(ICONS, v);
export const iconDef = (k: IconKey): IconDef => ICONS[k];
export const ICON_KEY_MAX = 20;
```

Core holds the key, the group (where a picker lists it), the label (the picker's aria label and its tooltip) and the
path data as a string. A string of path data is data, as `EMBLEMS` is today, so core stays free of DOM. The view
holds everything that is markup: `src/views/icons.ts` builds one hidden sprite of `<symbol id="i-<key>">` from the
table at start and answers `icon(key)`, an `<svg class="ic" aria-hidden="true"><use href="#i-<key>"></use></svg>`. No
file is fetched, so the service worker's list does not change. A key change on a drawn node is one attribute, which
`patch.ts` binds with `data-attr`.

`EMBLEMS` moves in as group `emblem` and is deleted, its readers (`save.ts`, `custom.js`) moved to `isIconKey`.

The recipe, for the guide: "An icon: a row of `ICONS` in `src/core/registry/icons.ts` (a key of lowercase letters and
hyphens, at most `ICON_KEY_MAX`; its group; its label; its path drawn by the style rules in the file's header). Run
`bun run test`. A key once shipped is never renamed: change its drawing instead." A default that should use it is a
cell of a table in section 3.

`tests/icons.test.ts` checks every entry: the key's form, a label, a path that reads (`MLHVCSQTAZ` either case, the
right count of numbers), every point inside 0 to 24 (relative commands walked from the current point, an arc by its
end), at most 400 characters. A second case runs every default of section 3 over every enum value and draft type.

## 2. The first set

Sized from the game: 16 enemy types and 3 archetypes, 7 item types over 10 slots and 2 attacks, 16 built-in statuses
plus a default for each of 36 op kinds, 5 ability kinds. 95 keys, 83 of them new drawings (12 are today's emblems).

- emblem (12, existing): star, crown, moon, flame, shield, blade, eye, bolt, skull, wing, diamond, fang.
- foe (29): wolf, beetle, golem, horns, ghost, warrior, dragon, giant, vine, vortex, butterfly, fish, tentacle,
  slime, halo (a picture for each type but Undead, which is `skull`); claw, orb (the brute's and caster's; the
  skirmisher's is the item `dagger`); spider, serpent, bat, raven, rat, bear, goblin, tree, mushroom, scorpion,
  shark, mimic.
- item (24): sword, dagger, axe, hammer, spear, staff, bow; helm, chestplate, gauntlet, greaves, boots, cloak;
  amulet, ring; potion, crystal, herb, scroll, bomb; ore, gem; key; pouch. Offhand is the emblem `shield`.
- status (25): blood, poison, dizzy, fear, blind, snail, faded, fallen, chain, hood, rage, heal, plague (with flame,
  bolt and wing, the 16 built-ins); slash, spark, mana, weary, cure, up, down, taunt, ward, timer, push, status (what
  section 3's op table needs beyond those).
- ability (5): strike, arrow, burst, hex, aid.

One style, so a later icon matches with no designer. It is the emblems' style, written in the file's header:

1. A 24 by 24 grid, drawn inside 2 to 22. One path, filled, `fill-rule="evenodd"`, holes cut by a subpath.
2. One subject, seen from the front or the side, its silhouette readable at 14 px. No bar or gap thinner than 2 units.
3. No stroke, no text, no second colour. The colour is `currentColor`, set by where it is drawn: a rarity token on
   the bag, a status's `color` on its chip, the side's colour on a token.
4. Weight: the shape fills 60 to 80 percent of the box's area by eye, so two icons side by side look one size.

`scripts/ui-shots.ts` shoots every icon at 14, 24 and 44 px on one page, where a new icon is checked against its group.

## 3. The default rule

`src/core/registry/icon-defaults.ts`, one file, so "why does this thing have this picture" has one answer. Each
answer is the thing's own key when it holds one, else a table's cell. A table keyed by a union is a mapped type, so
the typecheck asks for a cell when an archetype, slot, item type, op kind or ability kind is added.

`monsterIcon(m) = m.icon ?? TYPE_ICON[m.type.trim().toLowerCase()] ?? ARCHETYPE_ICON[m.archetype]`, and
`itemIcon`, `statusIcon` and `abilityIcon` the same way:

- An enemy: `TYPE_ICON` names the 16 types (Beast wolf, Undead skull, Insect beetle, Construct golem, Demon horns,
  Spirit ghost, Humanoid warrior, Dragon dragon, Giant giant, Plant vine, Elemental vortex, Fey butterfly, Aquatic
  fish, Aberration tentacle, Ooze slime, Celestial halo). A type the GM typed that is not one of them takes its
  archetype's: brute claw, caster orb, skirmisher dagger.
- An item: a weapon by its attack (shot bow, strike sword); armor by its slot (offhand shield, head helm, chest
  chestplate, hands gauntlet, legs greaves, feet boots); an accessory by its slot (neck amulet, rings ring); a
  consumable potion, or crystal when it revives; material ore; key key; misc pouch.
- A status: the built-ins each name theirs in `statuses.ts` (a `icon` beside `label`), since four of them would
  share a first op. A GM's status without one takes `OP_ICON` of its first op: damage by type (physical slash,
  magical spark), heal heal, mana mana, fatigue weary, speed and stat by the sign of their E value (up wing or up,
  down snail or down), hold dizzy, root chain, shield shield, hidden hood, spread plague, cureStatus and dispel cure,
  taunt and threat taunt, untargetable, invulnerable and safeguard ward, delay and refund timer, shove and move push,
  the rest status. A def with no ops takes `timer` when it has an `end`, else `status`.
- An ability: its kind (strike strike, shot arrow, blast burst, curse hex, support aid); a bag item's use
  (`Ability.item`) shows the item's icon, so the hotbar's potion is the bag's.

The default is never stored. A thing holds a key only when the GM picked one, so a changed type or a better table
reaches every thing that never picked.

A key that no longer exists (a pack or a save from a build with another registry) is read by the parser as absent,
so the thing takes its default. Nothing is refused for it. Since keys are never renamed, this happens only across
builds of different registries, and the room's build handshake keeps every phone of a room on one.

## 4. The field

One optional field, `icon?: IconKey`, the same on all three, read by the parser that owns the thing:

- A monster: `Monster.icon`, read in `parseMonster` as `...(isIconKey(v.icon) ? { icon: v.icon } : {})`. A seed names
  its own in `SeedTweak.icon`, so the enemy draft's 366 rows can carry an explicit pick (section 7, unit 7).
- An item: `Item.icon` and the `Common` part of `ItemDef`, read in `parseItem` the same way.
- A status: `DefBase.icon` beside `color`, read in `defOf` (`fight-parse.ts`) the same way. Unlike `color`, a key it
  cannot read does not refuse the def; it drops the key.

The bound is the registry: only a key of `ICONS`, so at most `ICON_KEY_MAX` characters. `THING_MAX` does not move in
practice (28 bytes on a thing of thousands).

It travels wherever the thing travels already, with no new message: a pack (`parsePack` reads through each parser), an
award or an offer (an item), a chapter's reward, the solo doc (monsters by value, built within `DOC_MAX` by
construction), the sheet push (a bag item; `SHEET_MAX` is counted before sending). Only a picked key costs bytes.

Two docs gain a field:

- The codex doc: `CodexDocEntry.icon`, the resolved key, so a player's bestiary draws what the GM's does. `codexDoc`
  builds within `DOC_MAX` by construction, so this only lowers how many entries fit near the edge.
- The fight doc: `FightDocRow.icon: IconKey | null`, on the wire `ic`, left out at null. The GM's phone resolves it
  (`monsterIcon` of the row's `Origin`, which already holds `type` and `archetype`; `Origin.icon` holds a pick; a
  hunter's or a player's row its emblem when it has one). Its reader in `DOCS` takes a key or null.

The worst fight doc: `,"ic":"` (7) plus a key of 20 plus `"` (1) is 28 characters a row, 840 for `DOC_ROWS` (30).
`DOC_MAX`'s comment gives 53,627 measured and 1,821 to spare with the eighth. 53,627 + 840 = 54,467, and 54,467 x 9
/ 8 = 61,276, under 62,000 with 724 to spare. (The comment's own "60,179 with the eighth" is not 53,627 x 9 / 8, which
is 60,330; the unit re-measures with the test and corrects the comment.) A status's icon rides in its def: the `defs`
table is capped at `DOC_DEFS_MAX`, so its worst case does not move. A status named inline (its def not in the table)
draws the player's own built-in of that key, else `status`.

## 5. Where each screen draws one, at phone size

| Screen | Size | Beside or replacing | Lost if absent |
|---|---|---|---|
| Map token (`map.js`) | 22 px in the disc | Replaces the initials `mp-lbl`; a pack's letter ("Rat B") stays, 12 px, in the disc's lower corner | Telling a spider from a golem at a glance; the plate still names it |
| Fight card and turn order (`combat.js`, `table.js`) | 24 px in the card head, 16 px in the order's row | Before the name | The link between the card and the token |
| Bestiary (`bestiary.js`) | 32 px | Left of the name line | Scanning a long list by shape |
| Bag (`inventory.js`) | 24 px, in the rarity's colour | Line start, before the name | Finding the potion without reading |
| Status chip | 14 px | Inside the chip before its label, in the def's colour | Reading a row of six chips quickly |
| Hotbar slot (`map.js`) | 20 px | Above the slot's name | Seeing the kind of each ability |
| Maker's picker | 24 px in a 44 px cell | New row "Icon" | Nothing: it is how one is picked |

What must not change: every control stays a 44 px target (the token's zoom floor `MIN_FIT`, the slot, the picker's
cell); text stays 12 px or more (the pack's letter included); the icon is `aria-hidden` and never the only carrier of
a meaning, since the name and its aria label stay; the sweep in `tests/e2e/phone.e2e.ts` passes at 360 and 390 px.
The map's `mp-dot` stays a dot (chips do not fit a 40 px tile). Sizes are tokens on `:root` (`--icon-chip` and kin).

## 6. The picker in a maker

A row "Icon" near the top of the monster, item and status makers (above `data-later`): a 44 px button showing the
icon in use and a line saying why ("Wolf, from its type", or "Raven, picked"). A tap opens a sheet over the maker
(`ui.sheet`) with:

- a `.seg` row of the groups, the thing's own group selected first;
- a grid of 44 px cells, seven a row at 360 px, the first cell "Default" with the default's picture;
- a tap on a cell picks it and closes the sheet. "Default" stores no key.

Two taps for a pick in the thing's own group, three from another. Foe, the largest group, is five rows and fits one
screen. No search: 95 icons in five groups do not need one (`searchable` in `maker.js` if the set passes 200).

## 7. The units

Each lands alone with its tests, in this order.

1. **The registry, no screen.** `icons.ts` with its shape, the emblems moved in, `EMBLEMS` deleted with its two
   readers moved, `tests/icons.test.ts`, the recipe in the guide. Mechanical (Sonnet).
2. **The first set and the defaults.** The 83 drawings by the style rules, `icon-defaults.ts` with its tables, the
   built-in statuses' `icon`, the ui-shots page of every icon, the defaults case. Not mechanical: drawing by hand
   in path data and judging the set as one style (Opus).
3. **The field.** `icon?` on monster, item and status with their parsers and cases (pack round trip, unknown key
   dropped), `Origin.icon`, the codex entry, the fight doc's `ic` with its reader, the worst-case test and the
   corrected `DOC_MAX` comment. Mechanical, recipes exist (Sonnet).
4. **The drawer and the fight.** `src/views/icons.ts` (sprite and `icon`), the size tokens, the map token, the
   fight card, the turn order, the hotbar; `feel.e2e.ts` and the map cases of `look.e2e.ts`. Not mechanical: the
   token's layout under the rings, shield and stagger, and the frame budget (Opus).
5. **The lists.** Bag, status chip, bestiary (both phones through the codex doc). Mechanical (Sonnet).
6. **The picker.** The row and sheet in the three makers, an e2e step each that picks, saves and reads the key back,
   and "Default" storing none. Not mechanical: a new control on a phone (Opus).
7. **The enemy list's picks**, with the enemy balance pass, not here: a script proposes an icon per draft row from
   its name (wolf, spider, rat), a person reviews the list, the rows carry `icon`. Mechanical (Sonnet).

## 8. What I would not build, and the questions

- An icon per ability. Its kind's icon costs nothing per ability, as the owner wanted.
- A GM's own drawing or an uploaded image. It means files in saves, packs and the room, sizes past `THING_MAX`, and
  pictures no one checked at 14 px.
- A second colour or a colour per icon. The place it is drawn colours it.
- Matching a monster's name to a picture in the default rule. It is guessing; the seeds name theirs (unit 7).
- An icon font, an image file, a library. The sprite is built from the table.
- The app's own buttons, which wait for the PC pass.

Questions only the owner can answer, each with the default I would take:

1. Should a hunter's token show its emblem in place of its initials? Default yes, when the hunter picked one.
2. May a GM give any picture to anything (a wolf on a status)? Default yes, its own group shown first.
3. Filled silhouettes like today's emblems, or line drawings? Default filled, so a 14 px chip stays readable.

## The owner's rulings (Nov 20). These win over the sections above

His words, to the three questions and the lead's defaults: "Yes, yes, filled silhouettes. I don't mind you taking
them from elsewhere so long as they look consistent."

1. A hunter's token on the map shows its emblem, not its initials.
2. A GM may give any icon to anything.
3. Icons are filled silhouettes.
4. Drawings may come from an outside set, so long as the whole set looks like one hand drew it. The lead's
   reading: one source for all of them where it can be had, chosen for filled silhouettes of monsters, gear and
   effects; its licence must allow use in a public repository and a live site, and if it asks for credit the
   credit is a line in the app (the Rules page's foot) and a file beside the registry, added in the unit that
   adds the drawings. The path data is copied into the registry: no package, no CDN, no new dependency. An icon
   the source lacks is drawn here to the same grid and weight, and the unit's reviewer looks at the whole sheet
   of icons side by side at token size before it lands.
5. The lead's ruling on the fight doc: the unit that adds the field measures the worst doc again before anything
   else. If the margin under `DOC_MAX` is thinner than 2,000 characters, the doc carries only an icon a GM
   picked, and a player's phone works the default out from the enemy's type.
