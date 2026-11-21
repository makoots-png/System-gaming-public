import type { Body } from './effect-ops.ts';
import type { LifeState } from '../hunter/vitals.ts';

/**
 * The one read of a row's HP: every rule that asks how much HP a row has asks here. It is its life's: up has its HP, any
 * other state 0. The life's one writer (row-life.ts) keeps it within the row's maximum.
 */
export const rowHp = (b: Pick<Body, 'life'>): number => (b.life.at === 'up' ? b.life.hp : 0);
/**
 * Up: able to take a turn. A row at 0 HP is dead (a foe's reads Defeated): none is up. It reads a fight's
 * row and the fight doc's row alike (fight-doc.ts: the life's state without its HP).
 */
export const isUp = (b: { readonly life: { readonly at: LifeState } }): boolean => b.life.at === 'up';
