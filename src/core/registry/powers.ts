// powers.ts: what a held thing gives its holder in a fight (item-stats 6.1), one shape for an item and a title, and its
// one parser. Pure. A worn item holds its powers while worn, a title while it is the active title; the fight's row reads
// both in one place (combat/rows.ts `heldPowers`). The stat bonus is not a power: it stays each thing's `bonus`, which
// reaches the sheet (hunter/sheet.ts). A new power is a field here, its line in `parsePowers`, its use in `heldPowers`,
// its rows in status-refs.ts, and a case in tests/powers.test.ts.
import type { Ability } from '../combat/ability-types.ts';
import type { StatusDef } from '../combat/effect-ops.ts';
import { abilityTooLarge, parseAbility, parseStatusDef, statusTooLarge } from '../combat/fight-parse.ts';
import { RULES } from '../rules.ts';

/**
 * The powers a held thing gives. `worn`: a status on the holder's row in every fight, with its triggers, until removed
 * (kits design 1.3.2). `active`: an ability the holder may use in a fight, with the cooldown, costs and `uses` gates of
 * any ability; it is never a bag item's use, so a use spends nothing held.
 */
export type Powers = { worn?: StatusDef; active?: Ability };

/**
 * The powers of `v` (an item's or a title's own fields), read from outside data: `worn` by the status parser and `active`
 * by the ability parser, each with the shipped rules' limits as every item and reward is read, and each dropped when its
 * parser refuses it (an `item` the active claims is dropped by `parseAbility`). Null when either part reads but is past
 * its size (size.ts): the thing that holds it is then refused whole, never kept without the power it was made with.
 */
export function parsePowers(v: { readonly worn?: unknown; readonly active?: unknown }): Powers | null {
  if (statusTooLarge(v.worn, RULES) || abilityTooLarge(v.active, RULES)) return null;
  const worn = v.worn === undefined ? null : parseStatusDef(v.worn, RULES), active = v.active === undefined ? null : parseAbility(v.active, RULES);
  return { ...(worn ? { worn } : {}), ...(active ? { active } : {}) };
}
