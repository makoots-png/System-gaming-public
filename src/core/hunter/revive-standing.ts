// revive-standing.ts: what is left of a hunter's revive ladder and System revive debt, each as a machine. Pure.
// World rule 6 (docs/world/README.md) and the machine "Revive standing" (docs/world/machines.md): the first revive is
// free, then one revive on debt, then none, unless the GM grants one or the hunter uses a crystal bought before death.
// the owner, Nov 22: the free revive and the revive on debt are a "System raise" (no GM button). Only a System raise moves
// the standing; a crystal or the GM's Revive raises the hunter and leaves it as it is. `Hunter.reviveLeft` holds it, and
// `Hunter.debt` the gold a raise on debt owes. grant.ts (`systemRaise` and `grant`) is the one writer of both.
import { clearOf } from '../rules.ts';
import type { Rank, Rules } from '../rules.ts';
import type { RewardFrom } from '../protocol.ts';
import type { Said } from '../session-log.ts';
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
/**
 * Maximum total System debt a hunter of `rank` may reach through shop borrowing: `R.borrowCapClears` same-rank gate
 * clears, rounded (0 turns shop borrowing off). A System revive ignores this limit.
 */
export const borrowCap = (rank: Rank, R: Pick<Rules, 'loot' | 'borrowCapClears'>): number =>
  (R.borrowCapClears > 0 ? Math.max(0, Math.round(R.borrowCapClears * clearOf(R, rank))) : 0);

// ── debt payoff machine ──
export const DEBT_STATES = ['clear', 'owing'] as const;
/** `clear`: owes 0 gold; `owing`: owes gold to the System from a raise on debt. */
export type DebtState = (typeof DEBT_STATES)[number];
/** `incur`: debt added by a System raise on debt; `clearGold`: gate clear gold split three ways; `xp`: earned XP scaled while owing. */
export type DebtEvent =
  | { readonly type: 'incur'; readonly amount: number }
  | { readonly type: 'clearGold'; readonly gold: number }
  | { readonly type: 'xp'; readonly xp: number };
export type DebtEventType = DebtEvent['type'];
export const DEBT_EVENT_TYPES = ['incur', 'clearGold', 'xp'] as const satisfies readonly DebtEventType[];
/** Result of one debt step: remaining debt after the step, gold applied to debt, gold lost to debt costs, gold kept, and earned XP after debt scaling. */
export type DebtStep = { readonly debt: number; readonly paid: number; readonly burn: number; readonly kept: number; readonly xp: number };
/** Rules read by the System revive debt machine. */
export type DebtRules = Pick<Rules, 'reviveDebtShare' | 'reviveDebtBurn' | 'reviveDebtXpRate'>;
/** Gate clear gold split applied under System revive debt in one grant, and the remaining balance after it. */
export type DebtPaid = { readonly total: number; readonly paid: number; readonly burn: number; readonly kept: number; readonly left: number };
/** Earned XP reduced under System revive debt in one grant, with the base XP, applied rate, and remaining debt. */
export type DebtXpCut = { readonly base: number; readonly xp: number; readonly rate: number; readonly left: number };

/** Whether a hunter currently owes System revive debt. */
export const debtState = (debt: number): DebtState => (debt > 0 ? 'owing' : 'clear');
/** Reward sources whose gold pays down System revive debt: table gate clears and solo gate clears only. */
export const paysDebt = (from: RewardFrom | null | undefined): boolean => from === 'clear' || from === 'solo';

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
type DebtFn<E extends DebtEventType> = (debt: number, e: Extract<DebtEvent, { type: E }>, R: DebtRules) => DebtStep;
const addDebt = (debt: number, amount: number): number => debt + Math.max(0, Math.trunc(amount) || 0);
/** For each debt state, what each event does to the balance, clear gold split, and earned XP. */
const DEBT_TABLE: { readonly [S in DebtState]: { readonly [E in DebtEventType]: DebtFn<E> } } = {
  clear: {
    incur: (_d, e) => ({ debt: addDebt(0, e.amount), paid: 0, burn: 0, kept: 0, xp: 0 }),
    clearGold: (_d, e) => ({ debt: 0, paid: 0, burn: 0, kept: e.gold, xp: 0 }),
    xp: (_d, e) => ({ debt: 0, paid: 0, burn: 0, kept: 0, xp: e.xp }),
  },
  owing: {
    incur: (d, e) => ({ debt: addDebt(d, e.amount), paid: 0, burn: 0, kept: 0, xp: 0 }),
    clearGold: (d, e, R) => {
      if (e.gold <= 0) return { debt: d, paid: 0, burn: 0, kept: e.gold, xp: 0 };
      const share = clamp01(R.reviveDebtShare);
      const burnRate = Math.min(1 - share, clamp01(R.reviveDebtBurn));
      if (share <= 0 && burnRate <= 0) return { debt: d, paid: 0, burn: 0, kept: e.gold, xp: 0 };
      if (share <= 0) {
        const burn = Math.min(e.gold, Math.round(e.gold * burnRate));
        return { debt: d, paid: 0, burn, kept: e.gold - burn, xp: 0 };
      }
      const wantPay = Math.round(e.gold * share);
      const paid = Math.min(d, e.gold, wantPay);
      const burn = d < wantPay
        ? Math.min(e.gold - paid, Math.round(paid * (burnRate / share)))
        : Math.min(e.gold - paid, Math.round(e.gold * burnRate));
      return { debt: d - paid, paid, burn, kept: e.gold - paid - burn, xp: 0 };
    },
    xp: (d, e, R) => ({ debt: d, paid: 0, burn: 0, kept: 0, xp: e.xp > 0 ? Math.round(e.xp * clamp01(R.reviveDebtXpRate)) : e.xp }),
  },
};
/** Steps `debt` on `e` under `R`, splitting clear gold three ways (proportional burn on final payoff) and scaling positive XP while owing. */
export function debtStep(debt: number, e: DebtEvent, R: DebtRules): DebtStep {
  const clean = Math.max(0, Math.trunc(debt) || 0);
  const fn = DEBT_TABLE[debtState(clean)][e.type] as DebtFn<DebtEventType>;
  return fn(clean, e, R);
}

// ── the words ──
const numFmt = (n: number): string => n.toLocaleString('en-US');
const gold = (n: number): string => `${numFmt(n)} gold`;
const ratePct = (n: number): string => `${Math.round(clamp01(n) * 10000) / 100}%`;
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
/** The bag's line of what a hunter owes the System (revive debt and shop borrowing), or null when it owes nothing. */
export const debtLine = (debt: number): string | null => (debt > 0 ? `Debt owed to the System: ${gold(debt)}.` : null);
/** Plain-language summary of what applies while you owe System debt (clear-gold split and XP rate). */
export function debtTermsLine(R: DebtRules): string {
  const share = clamp01(R.reviveDebtShare);
  const burn = Math.min(1 - share, clamp01(R.reviveDebtBurn));
  const keep = Math.max(0, 1 - share - burn);
  const xpRate = clamp01(R.reviveDebtXpRate);
  const goldPart = share > 0 && burn > 0
    ? `${ratePct(share)} of your gate clear gold goes to your debt, ${ratePct(burn)} is lost to debt costs, and you get ${ratePct(keep)}`
    : share > 0
      ? `${ratePct(share)} of your gate clear gold goes to your debt, and you get ${ratePct(keep)}`
      : burn > 0
        ? `you get ${ratePct(keep)} of your gate clear gold, and ${ratePct(burn)} is lost to debt costs`
        : '';
  const xpPart = xpRate < 1 ? `you earn ${ratePct(xpRate)} XP from every source` : '';
  if (goldPart && xpPart) return `While you owe debt, ${goldPart}. You also earn ${ratePct(xpRate)} XP from every source until your debt is paid off.`;
  if (goldPart) return `While you owe debt, ${goldPart}.`;
  if (xpPart) return `While you owe debt, ${xpPart} until your debt is paid off.`;
  return '';
}
/** What a reward window says when gate clear gold splits for System revive debt, or null when nothing was taken or lost. */
export function debtPaidLine(p: DebtPaid): string | null {
  if (p.paid <= 0 && p.burn <= 0) return null;
  const split = p.paid > 0 && p.burn > 0
    ? `${numFmt(p.paid)} went to your System debt, you got ${numFmt(p.kept)}, and ${numFmt(p.burn)} was lost to debt costs.`
    : p.paid > 0
      ? `${numFmt(p.paid)} went to your System debt, and you got ${numFmt(p.kept)}.`
      : `You got ${numFmt(p.kept)}, and ${numFmt(p.burn)} was lost to debt costs.`;
  const tail = p.left > 0 ? `You owe ${numFmt(p.left)} more.` : 'You paid off your System debt.';
  return `Gate clear: ${gold(p.total)}. ${split} ${tail}`;
}
/** What a reward window says when earned XP is reduced while owing System revive debt. */
export const debtXpLine = (x: DebtXpCut): string =>
  `XP is reduced to ${ratePct(x.rate)} while you owe ${gold(x.left)}: +${numFmt(x.xp)} XP (from ${numFmt(x.base)} XP).`;
/** What a reward window says for XP on the gate clear that finishes paying off System revive debt. */
export const debtXpClearedLine = (xp: number): string =>
  `+${numFmt(xp)} XP (you paid off your System debt, so you got full XP).`;
/** What a GM Pending rewards card previews when approving a reward splits clear gold or reduces XP for System revive debt. */
export function debtPreviewLine(p: DebtPaid | null, x: DebtXpCut | null = null): string | null {
  const parts: string[] = [];
  if (p && (p.paid > 0 || p.burn > 0)) {
    const split = p.paid > 0 && p.burn > 0
      ? `${numFmt(p.paid)} goes to System debt, hunter gets ${numFmt(p.kept)}, and ${numFmt(p.burn)} is lost to debt costs.`
      : p.paid > 0
        ? `${numFmt(p.paid)} goes to System debt, and hunter gets ${numFmt(p.kept)}.`
        : `Hunter gets ${numFmt(p.kept)}, and ${numFmt(p.burn)} is lost to debt costs.`;
    const tail = p.left > 0 ? `${gold(p.left)} left.` : 'Debt paid off.';
    parts.push(`Gate clear: ${gold(p.total)}. ${split} ${tail}`);
  }
  if (x) parts.push(`XP reduced to ${ratePct(x.rate)} while owing ${gold(x.left)}: +${numFmt(x.xp)} XP (from ${numFmt(x.base)} XP).`);
  return parts.length ? parts.join(' ') : null;
}
/** The GM board's chip of a hunter's System revive debt, or null at 0 debt. */
export const debtChip = (debt: number): string | null => (debt > 0 ? `System debt: ${gold(debt)}` : null);
/** The session log line when a hunter pays toward System revive debt or gets reduced XP while owing, or null when neither applies. */
export function debtPaidLog(name: string, p: DebtPaid | null, x: DebtXpCut | null = null, clearedFullXp = 0): Said | null {
  if (p && (p.paid > 0 || p.burn > 0)) {
    const split = p.paid > 0 && p.burn > 0
      ? `${numFmt(p.paid)} went to System debt, ${name} got ${numFmt(p.kept)}, and ${numFmt(p.burn)} was lost to debt costs.`
      : p.paid > 0
        ? `${numFmt(p.paid)} went to System debt, and ${name} got ${numFmt(p.kept)}.`
        : `${name} got ${numFmt(p.kept)}, and ${numFmt(p.burn)} was lost to debt costs.`;
    const tail = p.left > 0 ? `${name} owes ${numFmt(p.left)} more.` : `${name} paid off their System debt.`;
    const xpPart = x
      ? ` XP was reduced to ${ratePct(x.rate)}: +${numFmt(x.xp)} XP (from ${numFmt(x.base)} XP).`
      : p.left === 0 && clearedFullXp > 0
        ? ` Full XP applied: +${numFmt(clearedFullXp)} XP.`
        : '';
    return {
      kind: 'award',
      hunterId: null,
      title: `Debt payment: ${name}`,
      text: `${name} cleared a gate for ${gold(p.total)}: ${split} ${tail}${xpPart}`,
    };
  }
  if (x) {
    return {
      kind: 'award',
      hunterId: null,
      title: `Debt XP cut: ${name}`,
      text: `${name} got +${numFmt(x.xp)} XP (reduced to ${ratePct(x.rate)} from ${numFmt(x.base)} XP while owing ${gold(x.left)} to the System).`,
    };
  }
  return null;
}
/** A refused System raise, in the words a player reads. */
export const RAISE_REFUSED: { readonly [Why in 'spent' | 'cannot' | 'held']: string } = {
  spent: 'You have used all your System revives. Only a Resurrection Crystal or the GM can revive you now.',
  cannot: 'You are not dead.',
  held: 'You cannot use a System revive during a fight. Wait until the fight ends.',
};
