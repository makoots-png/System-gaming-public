// A fight row's life in a test fixture (src/core/combat/row-life.ts): a row holds a life by its kind, and a fixture that
// starts a row at some HP gets the life that HP means.
import type { Body, BodyLife, CombatantKind } from '../../src/core/combat/effect-ops.ts';
import type { NewRow } from '../../src/core/combat/fight-types.ts';

/** A row of `kind` at `hp` HP: up from 1 HP; at 0 a hunter has just fallen (dying, no saves made) and anything else is dead. */
export function lifeAt(kind: CombatantKind, hp: number): BodyLife {
  if (kind === 'hunter') return { kind, life: hp >= 1 ? { at: 'up', hp } : { at: 'dying', successes: 0, failures: 0 } };
  return { kind, life: hp >= 1 ? { at: 'up', hp } : { at: 'dead' } };
}
/** Row `b` standing at `hp` HP (`lifeAt`), the rest of it as it was. */
export const atHp = <T extends Body | NewRow>(b: T, hp: number): T => ({ ...b, ...lifeAt(b.kind, hp) }) as T;
/** A fixture's change to a row: any field but its kind and life, which `kind` and `hp` give (`lifeAt`). */
export type RowPatch<R extends Body | NewRow> = Partial<Omit<R, 'kind' | 'life'>> & { readonly kind?: CombatantKind; readonly hp?: number };
