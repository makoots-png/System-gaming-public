// row-icon.ts: the picture a fight's row is drawn with on the map token, the card and the turn order (icons design
// section 5, the owner's ruling 1). The GM's phone answers it from the row with `rowIcon`, and the fight doc carries that
// answer on every row (fight-doc.ts `FightDocRow.icon`), so a player's phone draws what the GM's draws with nothing to
// work out: the doc holds no type, archetype or hunter's sheet to work a default from. Pure.
import { isIconKey } from '../registry/icons.ts';
import type { IconKey } from '../registry/icons.ts';
import { monsterIcon } from '../registry/icon-defaults.ts';
import type { Body } from './effect-ops.ts';

/** A hunter's sheet as far as its picture goes: its emblem, '' when it picked none. */
export type EmblemHolder = { readonly emblem: string };
/**
 * The hunter sheet behind a row on this phone (this phone's own, or a player's as the room holds it), or null when it
 * has none: a monster, a shadow, a summon, or a player's sheet that left the room.
 */
export type HunterOf = (b: Body) => EmblemHolder | null;

/**
 * A row's icon:
 * - a hunter: its emblem (ruling 1); null when it picked none or its sheet is not on this phone, and its initials show;
 * - a monster, a shadow or a summon: its monster's (icon-defaults.ts `monsterIcon`: the GM's pick, else its type's,
 *   else its archetype's; a shadow's and a summon's origin has no type, so its archetype's);
 * - a body of a hunter's build that is not a hunter (only a test stands one): null.
 */
export function rowIcon(b: Pick<Body, 'kind' | 'origin'>, hunter: EmblemHolder | null): IconKey | null {
  if (b.kind === 'hunter') return hunter && isIconKey(hunter.emblem) ? hunter.emblem : null;
  return b.origin.kind === 'monster' ? monsterIcon(b.origin) : null;
}
