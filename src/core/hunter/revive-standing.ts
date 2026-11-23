// revive-standing.ts: what is left of a hunter's revive ladder, as a machine. Pure.
// World rule 6 (docs/world/README.md) and the machine "Revive standing" (docs/world/machines.md): the first revive is
// free, then one revive on debt, then none, unless the GM grants one or the hunter uses a crystal bought before death.
// the owner, Nov 22: the free revive and the revive on debt are a "System raise" (no GM button). Only a System raise moves
// the standing; a crystal or the GM's Revive raises the hunter and leaves it as it is. `Hunter.reviveLeft` holds it, and
// `Hunter.debt` the gold a raise on debt owes. grant.ts `systemRaise` is the one writer of both.
import { clearOf } from '../rules.ts';
import type { Rank, Rules } from '../rules.ts';
import { refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { levelAfterRaising } from './progress.ts';
import { REVIVE_HP } from './vitals.ts';

export const REVIVE_STANDINGS = ['free', 'debt', 'none'] as const;
/** `free`: the free raise is left; `debt`: it is spent and one raise on debt is left; `none`: both are spent. */
export type ReviveStanding = (typeof REVIVE_STANDINGS)[number];
/** The System raises the dead hunter. */
export type StandingEvent = { readonly type: 'raise' };
export type StandingEventType = StandingEvent['type'];
export const STANDING_EVENT_TYPES = ['raise'] as const satisfies readonly StandingEventType[];

/** For each standing, where each event takes it. `null`: refused (`spent`), the standing stays. */
const TABLE: { readonly [S in ReviveStanding]: { readonly [E in StandingEventType]: ReviveStanding | null } } = {
  free: { raise: 'debt' },
  debt: { raise: 'none' },
  none: { raise: null },
};

/** The standing after `e`, or `spent` when the System raises no more. */
export function standingStep(s: ReviveStanding, e: StandingEvent): ReviveStanding | Refused<'spent'> {
  return TABLE[s][e.type] ?? refuse('spent');
}
/** The standings a System raise is taken from: the free raise and the one on debt. */
export const RAISES = ['free', 'debt'] as const satisfies readonly ReviveStanding[];
export type Raise = (typeof RAISES)[number];
/** Whether the System still raises a hunter of this standing: what a view asks before it offers the raise. */
export const canRaise = (s: ReviveStanding): s is Raise => TABLE[s].raise !== null;

/** For each standing, what a System raise from it owes, for a hunter of `rank`. */
const OWED: { readonly [S in ReviveStanding]: (rank: Rank, R: Pick<Rules, 'loot' | 'reviveDebtClears'>) => number } = {
  free: () => 0,
  debt: (rank, R) => Math.round(R.reviveDebtClears * clearOf(R, rank)),
  none: () => 0,
};
/**
 * The gold a System raise from standing `s` adds to the debt of a hunter of `rank`: none for the free raise; on debt,
 * `R.reviveDebtClears` Clears of the rank (economy.md section 13: "ten Clears of their rank"). None from `none`, where
 * the System does not raise.
 */
export const raiseOwes = (s: ReviveStanding, rank: Rank, R: Pick<Rules, 'loot' | 'reviveDebtClears'>): number => OWED[s](rank, R);

// ── the words ──
const gold = (n: number): string => `${n.toLocaleString('en-US')} gold`;
/** The title of the System's window that offers the raise. */
export const RAISE_TITLE = 'THE SYSTEM CAN REVIVE YOU';
/** What a hunter shows of itself to the words below. */
type Raisable = { readonly reviveLeft: ReviveStanding; readonly rank: Rank; readonly level: number };
type WordRules = Pick<Rules, 'loot' | 'reviveDebtClears' | 'reviveLevelShare'>;
/**
 * What the System's window says to dead hunter `h`: its body, its lines (the cost, where the hunter rises, and on debt
 * that no raise is left after), and its Rise button's words, which name the cost on debt. Null past the ladder.
 */
export function raiseOffer(h: Raisable, R: WordRules): { readonly body: string; readonly lines: readonly string[]; readonly rise: string } | null {
  if (!canRaise(h.reviveLeft)) return null;
  const to = levelAfterRaising(h.level, R), lost = h.level - to;
  const rises = `You revive at ${REVIVE_HP} HP${lost > 0 ? ` and level ${to} (${lost} level${lost === 1 ? '' : 's'} lost)` : ''}, with all statuses cleared.`;
  if (h.reviveLeft === 'free') return { body: 'You have died. The System can revive you once for free.', lines: ['Cost: Free (one-time free revive).', rises], rise: 'Revive for free' };
  const owes = raiseOwes(h.reviveLeft, h.rank, R);
  return {
    body: 'You have died. Your free revive is used. The System can revive you once more in exchange for debt.',
    lines: [`Cost: ${gold(owes)} debt (${R.reviveDebtClears} rank ${h.rank} gate clears).`, rises, 'After this, only a Resurrection Crystal or the GM can revive you.'],
    rise: `Revive on debt (${gold(owes)})`,
  };
}
/** The dead hunter's sheet line of what the System still does for it; `held` while a fight holds the hunter, which ends first. */
export function raiseLine(h: Raisable, R: WordRules, held: boolean): string {
  if (!canRaise(h.reviveLeft)) return 'You have used all your System revives.';
  const what = h.reviveLeft === 'free' ? 'once for free' : `once more for ${gold(raiseOwes(h.reviveLeft, h.rank, R))} debt`;
  return held ? `Once the fight ends, the System can revive you ${what}.` : `The System can revive you ${what}.`;
}
/** The GM board's chip of a dead hunter's standing: whether the System can still raise it, and how. */
export const RAISE_CHIPS: { readonly [S in ReviveStanding]: string } = { free: 'System revive: free', debt: 'System revive: on debt', none: 'No System revives left' };
/** The session log's line when the System raised `name` (the `systemRaise` message, on the GM's phone). */
export function raisedSaid(name: string, raise: Raise, owes: number): { readonly title: string; readonly text: string } {
  return {
    title: `System revive: ${name}`,
    text: raise === 'free' ? `The System revived ${name} for free. One revive on debt is left.` : `The System revived ${name} for ${gold(owes)} debt. No System revives left.`,
  };
}
/** The bag's line of what a hunter owes the System, or null when it owes nothing. */
export const debtLine = (debt: number): string | null => (debt > 0 ? `Debt owed to the System for reviving: ${gold(debt)}.` : null);
/** A refused System raise, in the words a player reads. */
export const RAISE_REFUSED: { readonly [Why in 'spent' | 'cannot' | 'held']: string } = {
  spent: 'You have used all your System revives. Only a Resurrection Crystal or the GM can revive you now.',
  cannot: 'You are not dead.',
  held: 'You cannot use a System revive during a fight. Wait until the fight ends.',
};
