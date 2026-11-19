# Brief: the design of icons (a design only; build nothing)

## The goal, in the owner's words

"To add to the list we need icons." "All of them? Do as you see fit. For sure enemies, items, statuses. Idk about
abilities since we will be making a lot of them." And his standing words: "architecture first", "everything must be
explicit", adding or changing a feature must be very easy, with a clear trace from each feature to what it
depends on.

The lead's ruling (`docs/agent-handoff/handoff.md`, item 4a of section 4: read that item only): icons are drawn
in the repository as SVG, no outside set and no new dependency; an enemy, an item and a status each hold an icon
key, picked in its maker, with a default worked out from what the thing is; an ability shows its kind's icon;
the app's own buttons wait for the PC pass.

## What the design must settle, each with its reason

1. **The registry.** One table in core that names every icon by a key: its type, where the drawing itself lives
   (core holds no DOM: say what core holds and what the view holds), how an icon is added in one step (the
   recipe, as the guide's recipes are written), and the test that checks every entry.
2. **How many icons, and which.** A first set sized from the game as it is: count the enemy types
   (`docs/agent-handoff/features/enemies/README.md` lists 16), the item slots and kinds
   (`src/core/registry/items.ts`), the built-in statuses (`src/core/registry/statuses.ts`), the five ability
   kinds. List the set by key. Say how one visual style is held across them (grid, stroke, one colour from a
   token) so a later icon matches without a designer.
3. **The default rule.** A pure function for each kind of thing, from fields it already holds, so 366 drafted
   enemies and a GM's own content get an icon with no one choosing. Say what happens to a key that no longer
   exists (a pack from another phone, an old save).
4. **The field.** Where the key is stored for a monster, an item and a status (its parser, its bound, its
   default), whether it travels (a room message, the fight doc, a pack) and what that costs against `DOC_MAX`
   (`src/core/protocol.ts`: give the arithmetic for the worst fight doc).
5. **Where each screen draws one**, at phone size: the map's token, the fight card, the bestiary, the bag, a
   status chip, the hotbar slot, the makers' picker. For each: the size in px, what it replaces or sits beside,
   and what a player loses if it is absent. Name what must not change (a 44 px target, 12 px text).
6. **The picker in a maker**: how a GM picks one of perhaps 80 icons on a phone in few taps.
7. **The units to build it**, in order, each landing alone with its tests, the first being the registry with no
   screen. Say which unit is mechanical (Sonnet) and which is not.
8. **What you would not build**, and questions only the owner can answer (at most three, each with the default
   you would take).

## Read only this

- `.claude/skills/poteto-mode/SKILL.md`, the skill `architect`, and the leaves `principle-model-the-domain`,
  `principle-foundational-thinking`, `principle-experience-first`, `principle-laziness-protocol`.
- `AGENTS.md` (already loaded) and, in `docs/guide/`, only the rows your grep for `item`, `status`, `monster`,
  `fight doc` and `maker` finds in `makers.md` and `combat.md`.
- The type and parser of a monster, an item and a status (`src/core/registry/monsters.ts`, `items.ts`,
  `src/core/combat/fight-parse.ts` `parseStatusDef`), `fightWire` in `src/core/combat/fight-doc.ts`, and how one
  existing screen draws a token (`src/views/map.js`, the token's markup only).

## Deliver

`docs/agent-handoff/features/icons/design.md`, at most 200 lines, in the order above, on branch `icons-design`
in worktree `../sg-icons`. Change no code. Run nothing that loads the box (no tests, no build). No dashes as
punctuation and no cleverness in any text. No AI attribution in commits. Do not push.

## Your report, under 200 words

The registry's shape in three lines, the count of icons, the units, and your questions for the owner.
