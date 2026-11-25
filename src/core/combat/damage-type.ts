// damage-type.ts: the one definition of the three damage types (`physical`, `arcane`, `true`), the predicate (`isDamage`),
// the defence each meets (`defenceOf`), the shared override map reader (`parseDamageTypes`), and the single owner that
// applies GM ability damage-type overrides (`typed`) and names an effect (`effectWord`). Pure leaf module.

/** Every damage type in the game: physical meets Armor, arcane meets Resist, true ignores both. */
export const DAMAGE_TYPES = ['physical', 'arcane', 'true'] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

/** Whether `t` is one of the three damage types. The one damage-type predicate outside land.ts. */
export const isDamage = (t: unknown): t is DamageType => t === 'physical' || t === 'arcane' || t === 'true';

/** Plain display label for each damage type, used in combat cards, skill lists, and tooltips. */
export const DAMAGE_WORD: { readonly [T in DamageType]: string } = {
  physical: 'Physical damage',
  arcane: 'Arcane damage',
  true: 'True damage',
};

/** Short chip label for each damage type in makers and GM controls. */
export const DAMAGE_SHORT: { readonly [T in DamageType]: string } = {
  physical: 'Physical',
  arcane: 'Arcane',
  true: 'True',
};

/** Plain explanation of what each damage type meets. */
export const DAMAGE_HELP_LINE = 'Armor reduces physical damage. Resist reduces arcane damage. True damage is not reduced.';

/** Which defence reduces hits of `type`, or null when nothing reduces it. */
export const defenceOf = (type: DamageType): 'armor' | 'resist' | null =>
  (type === 'physical' ? 'armor' : type === 'arcane' ? 'resist' : null);

/**
 * Reserved keys in `RULES.fight.damageTypes` for built-in damage sources that do not carry a unique `AbilityId`:
 * unarmed and monster archetype attacks (which all share `ATTACK_ID`), plus keystone status, zone, and trigger ops
 * (`Seared`, `Cataclysm` zone, `Executioner`, `Spellblade`, and `Riposte`).
 */
export const RESERVED_DAMAGE_KEYS = [
  'attack-unarmed',
  'attack-brute',
  'attack-skirmisher',
  'attack-caster',
  'keystone-seared',
  'keystone-cataclysm-zone',
  'keystone-executioner',
  'keystone-spellblade',
  'keystone-riposte',
] as const;
export type ReservedDamageKey = (typeof RESERVED_DAMAGE_KEYS)[number];

/** Maximum number of entries in `RULES.fight.damageTypes` (covers all built-ins plus custom overrides within RoomRules size). */
export const DAMAGE_TYPES_MAX = 200;

/** Key pattern for `RULES.fight.damageTypes`: matches `AbilityId` and reserved keys; `attack` is refused explicitly. */
const DAMAGE_KEY_RE = /^[a-zA-Z0-9_-]{1,80}$/;

/** Sparse GM damage-type override map (`RULES.fight.damageTypes`). */
export type DamageTypeMap = Readonly<Record<string, DamageType>>;

/** Structural slice of rules needed to read GM damage-type overrides. */
export type DamageTypeRules = { readonly fight: { readonly damageTypes?: DamageTypeMap } };

/** Whether `key` is a legal key in `RULES.fight.damageTypes`. Refuses `attack` (shared by all weapons and archetypes) and prototype keys. */
export function isDamageOverrideKey(key: string): boolean {
  return DAMAGE_KEY_RE.test(key) && key !== 'attack' && key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

/**
 * Shared bounded reader for `RULES.fight.damageTypes`, used by both `overrides.ts` and `protocol.ts` (`RoomRules`).
 * Returns null when `v` is not a plain object; otherwise returns every valid entry up to `DAMAGE_TYPES_MAX` and reports
 * refused keys via `onBad`.
 */
export function parseDamageTypes(
  v: unknown,
  onBad?: (key: string, reason: 'unknown' | 'entry') => void,
): Record<string, DamageType> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, DamageType> = {};
  let count = 0;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!isDamageOverrideKey(k)) { onBad?.(k, 'unknown'); continue; }
    if (count >= DAMAGE_TYPES_MAX || !isDamage(x)) { onBad?.(k, 'entry'); continue; }
    out[k] = x;
    count += 1;
  }
  return out;
}

/** Looks up a reserved or explicit key in `R.fight.damageTypes`, falling back to `fallback`. */
export function damageTypeOf(key: string, fallback: DamageType, R?: DamageTypeRules): DamageType {
  const map = R?.fight.damageTypes;
  if (!map || !Object.hasOwn(map, key)) return fallback;
  const v = map[key];
  return isDamage(v) ? v : fallback;
}

type TypedEffect = { readonly type: DamageType | 'heal' | 'shield' };
type TypedAbility = { readonly id: string; readonly effect: TypedEffect | null };

/**
 * Applies a GM damage-type override from `R.fight.damageTypes` to ability `a`, leaving non-damaging effects and abilities
 * without an override untouched. Called only in `abilityOf` (built from code) and `distinct` (every row's and hunter's list).
 */
export function typed<A extends TypedAbility>(a: A, R?: DamageTypeRules): A {
  const e = a.effect;
  if (!e || !isDamage(e.type)) return a;
  const next = damageTypeOf(a.id, e.type, R);
  return next === e.type ? a : { ...a, effect: { ...e, type: next } };
}

/**
 * Plain display label for an ability's effect (`Physical damage`, `Arcane damage`, `True damage`, `Heals`, `Shields`),
 * resolving any GM override in `R` when passed. Returns null when the ability has no effect.
 */
export function effectWord(a: TypedAbility, R?: DamageTypeRules): string | null {
  const e = (R ? typed(a, R) : a).effect;
  if (!e) return null;
  if (e.type === 'heal') return 'Heals';
  if (e.type === 'shield') return 'Shields';
  return DAMAGE_WORD[e.type];
}
