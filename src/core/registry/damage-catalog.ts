// damage-catalog.ts: the built-in damaging statuses, reserved default-attack/keystone keys, and built-in damaging
// abilities listed by the GM Rules editor's Damage types controls. Pure.
import { RULES } from '../rules.ts';
import type { DamageType, ReservedDamageKey } from '../combat/damage-type.ts';
import { isDamage } from '../combat/damage-type.ts';
import type { StatusDef } from '../combat/effect-ops.ts';
import { BUILT_IN_STATUSES } from './statuses.ts';
import type { BuiltInStatus } from './statuses.ts';
import { SKILL_ABILITIES } from './abilities.ts';
import { seedMonsters } from './monsters.ts';
import { MYTHICS } from './mythics.ts';
import { keystoneOf } from './keystones.ts';

/** Built-in damaging statuses (edited through `saveStatus` / `removeStatus` on `save.library.statuses`). */
export const DAMAGING_STATUS_KEYS: readonly BuiltInStatus[] = ['bleeding', 'burning', 'poisoned', 'plague'];

/** One editable row for a reserved key in `RULES.fight.damageTypes`. */
export type ReservedDamageRow = { readonly key: ReservedDamageKey; readonly label: string; readonly shipped: DamageType };

/** Keystone status, zone, and trigger rows edited in `RULES.fight.damageTypes`. */
export const KEYSTONE_DAMAGE_ROWS: readonly ReservedDamageRow[] = [
  { key: 'keystone-seared', label: 'Seared', shipped: 'arcane' },
  { key: 'keystone-cataclysm-zone', label: 'Cataclysm zone', shipped: 'arcane' },
  { key: 'keystone-executioner', label: 'Executioner', shipped: 'physical' },
  { key: 'keystone-spellblade', label: 'Spellblade', shipped: 'arcane' },
  { key: 'keystone-riposte', label: 'Riposte', shipped: 'physical' },
];

/** Default attack rows edited in `RULES.fight.damageTypes` (each shares `ATTACK_ID` at runtime). */
export const DEFAULT_ATTACK_ROWS: readonly ReservedDamageRow[] = [
  { key: 'attack-unarmed', label: 'Unarmed strike', shipped: 'physical' },
  { key: 'attack-brute', label: 'Brute attack', shipped: 'physical' },
  { key: 'attack-skirmisher', label: 'Skirmisher attack', shipped: 'physical' },
  { key: 'attack-caster', label: 'Caster attack', shipped: 'arcane' },
];

/** One editable built-in damaging ability row for `RULES.fight.damageTypes`. */
export type AbilityDamageRow = {
  readonly id: string;
  readonly label: string;
  readonly group: 'Skill' | 'Keystone' | 'Monster' | 'Mythic';
  readonly shipped: DamageType;
};

/** Returns `def` with every `damage` op set to `type`, leaving all other ops and fields untouched. */
export function statusWithDamageType(def: StatusDef, type: DamageType): StatusDef {
  return { ...def, ops: def.ops.map(o => (o.op === 'damage' ? { ...o, type } : o)) };
}

/** Reads the first `damage` op's type from a status def, or null when the status has no damage op. */
export function statusDamageTypeOf(def: StatusDef | undefined): DamageType | null {
  const op = def?.ops.find(o => o.op === 'damage');
  return op && op.op === 'damage' ? op.type : null;
}

/** Whether `def` matches the shipped built-in status under `key`. */
export function isShippedStatusDef(key: BuiltInStatus, def: StatusDef): boolean {
  return JSON.stringify(def) === JSON.stringify(BUILT_IN_STATUSES[key]);
}

/** All 56 built-in damaging abilities (skills, keystone actives, monster seed abilities, mythic moves) with their shipped types. */
function buildAbilityDamageRows(): readonly AbilityDamageRow[] {
  const rows: AbilityDamageRow[] = [];
  const seen = new Set<string>();
  const add = (id: string, label: string, group: AbilityDamageRow['group'], type: unknown): void => {
    if (seen.has(id) || !isDamage(type)) return;
    seen.add(id);
    rows.push({ id, label, group, shipped: type });
  };
  for (const make of Object.values(SKILL_ABILITIES)) {
    const a = make(RULES);
    if (a?.effect) add(a.id, a.name, 'Skill', a.effect.type);
  }
  for (const stat of ['str', 'pow'] as const) {
    const k = keystoneOf({ tier: 'apex', stat }, RULES);
    if (k.active?.effect) add(k.active.id, k.active.name, 'Keystone', k.active.effect.type);
  }
  for (const m of seedMonsters(RULES)) {
    for (const a of m.abilities) if (a.effect) add(a.id, a.name, 'Monster', a.effect.type);
  }
  for (const sc of Object.values(MYTHICS)) {
    for (const [mvKey, mv] of Object.entries(sc.moves)) if (mv.hits > 0) add(`mythic-${mvKey}`, mv.name, 'Mythic', mv.type);
  }
  return rows;
}

/** Frozen list of every built-in damaging ability and its shipped damage type. */
export const BUILT_IN_ABILITY_DAMAGE_ROWS: readonly AbilityDamageRow[] = buildAbilityDamageRows();
