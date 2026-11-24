// monster-types.ts: the sixteen enemy types (the enemy draft's, balance plan sections 5 and 8) and what a type means.
// A type means one thing in the rules: whether a fallen monster of it may be extracted as a shadow. Damage is physical
// or arcane and there are no elements, so a type is never a weakness. Its picture is icon-defaults.ts's, keyed by
// `MonsterType`. A monster's type is text the GM types; `monsterTypeOf` reads it (any case, spaces around it trimmed).
// To add a type: a member of `MonsterType`, its row here (the typecheck then asks icon-defaults.ts for its picture),
// and its case in tests/monster-types.test.ts. Whether one monster may be extracted is `extractableOf`: its kind first
// (never a mythic), then its own choice, then its type.
import type { MonsterKind } from '../hunter/derive.ts';

/** An enemy type the rules know, by its lowercase name. */
export type MonsterType =
  | 'beast' | 'undead' | 'insect' | 'construct' | 'demon' | 'spirit' | 'humanoid' | 'dragon'
  | 'giant' | 'plant' | 'elemental' | 'fey' | 'aquatic' | 'aberration' | 'ooze' | 'celestial';

/**
 * Each type's column. `extractable`: whether a fallen monster of the type leaves a corpse a shadow can rise from. Not a
 * construct (nothing lived in it), an ooze (nothing holds a shape) or a spirit (no body was there): the enemy README's
 * list (item 5). Every other type yes.
 */
export const MONSTER_TYPES: { readonly [T in MonsterType]: { readonly extractable: boolean } } = {
  beast: { extractable: true }, undead: { extractable: true }, insect: { extractable: true }, construct: { extractable: false },
  demon: { extractable: true }, spirit: { extractable: false }, humanoid: { extractable: true }, dragon: { extractable: true },
  giant: { extractable: true }, plant: { extractable: true }, elemental: { extractable: true }, fey: { extractable: true },
  aquatic: { extractable: true }, aberration: { extractable: true }, ooze: { extractable: false }, celestial: { extractable: true },
};

/** The type a GM typed, or null when it is none of the sixteen (blank, or a type of the GM's own). */
export function monsterTypeOf(typed: string): MonsterType | null {
  const t = typed.trim().toLowerCase();
  return Object.hasOwn(MONSTER_TYPES, t) ? t as MonsterType : null;
}

/**
 * Whether a monster of the typed type may be extracted when nothing more particular says (a seed's or the GM's own
 * choice): its type's column, and yes for a type the registry does not hold, so a GM's own type takes nothing away.
 */
export function typeExtractable(typed: string): boolean {
  const t = monsterTypeOf(typed);
  return t === null || MONSTER_TYPES[t].extractable;
}

/**
 * Whether a monster may be extracted: never a mythic (the balance plan's call: a fight built to be won 5 to 10 times in
 * 100 does not hand its body to the party as a shadow); else its own yes or no where it has one (a seed's or the GM's),
 * else its type's (`typeExtractable`).
 */
export function extractableOf(kind: MonsterKind, typed: string, own: boolean | null): boolean {
  return kind !== 'mythic' && (own ?? typeExtractable(typed));
}
