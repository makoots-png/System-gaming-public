// respec.ts: taking confirmed ability points back on Confirm (cost, guards, atomic write, and room report). Pure.
// Taking points back is staged in signed `pending` (progress.ts `lower`, `takeAll`) and paid once at Confirm through
// `confirmPoints`. `respecCost` is the sole cost owner: free until a hunter's first fight, solo run, or gate clear
// (`hasFought` on `chronicle.tally`), free in GM mode, free when `RULES.respecPrices` is 0, and otherwise carried gold
// scaled off `RULES.priceBase[rank]` (`0.5x` for a full reset, a tenth per point, capped at the full reset), never borrowed.
import { priceBaseOf } from '../rules.ts';
import type { Rules } from '../rules.ts';
import type { Role } from '../role.ts';
import type { Hunter, Save } from '../save.ts';
import { refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { newEvent } from '../protocol.ts';
import type { EventStamp } from '../protocol.ts';
import { atOutbox, post } from '../sync/outbox.ts';
import { told } from '../session-log.ts';
import type { Said } from '../session-log.ts';
import { sheetKeyOf } from '../ids.ts';
import type { RoomCode } from '../ids.ts';
import { hasFought } from './chronicle.ts';
import type { Tally } from './chronicle.ts';
import { addGold } from './inventory.ts';
import { available, confirm, takenBack } from './progress.ts';
import { fitted } from './sheet.ts';

/** Why a staged take-back costs 0 gold. */
export type RespecFreeWhy = 'gm' | 'before-first-fight' | 'rules';

/** Cost summary for confirming `count` taken-back points. */
export type RespecPlan = {
  readonly count: number;
  readonly cost: number;
  readonly freeWhy: RespecFreeWhy | null;
};

/** Context for `confirmPoints` in one atomic save step. */
export type ConfirmCtx = {
  readonly role: Role;
  readonly held: boolean;
  readonly at: string;
  readonly room: RoomCode | null;
  readonly stamp: EventStamp | null;
  readonly R: Rules;
};

/** Outcome of `confirmPoints`: updated save, points taken back, gold paid, and net newly available points. */
export type ConfirmedPoints = {
  readonly save: Save;
  readonly count: number;
  readonly cost: number;
  readonly returned: number;
};

/** Why `confirmPoints` refused to apply a take-back. */
export type ConfirmRefusal = Refused<'no-hunter' | 'dead' | 'held' | 'gold'>;

/**
 * Sole owner of respec pricing. Free in GM mode, free before the hunter's first fight, solo run, or gate clear
 * (`hasFought`), and free when `RULES.respecPrices <= 0`. Otherwise `full = round(respecPrices * priceBase[rank])`,
 * `per = max(1, round(full / 10))`, and `cost = min(full, count * per)`.
 */
export function respecCost(
  h: Pick<Hunter, 'rank'> & { readonly chronicle: { readonly tally: Tally } },
  count: number,
  role: Role,
  R: Pick<Rules, 'priceBase' | 'respecPrices'>,
): RespecPlan {
  const n = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  if (n <= 0) return { count: 0, cost: 0, freeWhy: null };
  if (role === 'gm') return { count: n, cost: 0, freeWhy: 'gm' };
  if (!hasFought(h.chronicle.tally)) return { count: n, cost: 0, freeWhy: 'before-first-fight' };
  const full = Math.round(R.respecPrices * priceBaseOf(R, h.rank));
  if (full <= 0) return { count: n, cost: 0, freeWhy: 'rules' };
  const per = Math.max(1, Math.round(full / 10));
  return { count: n, cost: Math.min(full, n * per), freeWhy: null };
}

const pts = (n: number): string => (n === 1 ? '1 point' : `${n} points`);
const gp = (n: number): string => `${n.toLocaleString('en-US')} gold`;

/** Session log / GM report entry for a confirmed take-back. */
export function respecSaid(name: string, count: number, cost: number): Said {
  return {
    kind: 'system',
    hunterId: null,
    title: 'Points reset',
    text: cost > 0 ? `${name} took back ${pts(count)} for ${gp(cost)}.` : `${name} took back ${pts(count)} for free.`,
  };
}

/**
 * Confirms pending stat allocations on hunter `hid` in one step.
 * When `takenBack(h) === 0`, runs plain allocation confirm unguarded.
 * When `takenBack(h) > 0`, enforces living, not held by a fight (`ctx.held`), and carried gold (`cost <= h.gold`),
 * applies `confirm`, deducts gold, fits vitals, and either posts one sealed `respec` event (room player) or logs locally.
 */
export function confirmPoints(save: Save, hid: string, ctx: ConfirmCtx): ConfirmedPoints | ConfirmRefusal {
  const at = save.hunters.findIndex(h => h.id === hid);
  if (at < 0) return refuse('no-hunter');
  const h = save.hunters[at]!;
  const count = takenBack(h);
  if (count === 0) {
    const next = fitted(confirm(h), ctx.R);
    return {
      save: { ...save, hunters: save.hunters.map((x, i) => (i === at ? next : x)) },
      count: 0,
      cost: 0,
      returned: 0,
    };
  }
  if (h.life.at === 'dead') return refuse('dead');
  if (ctx.held) return refuse('held');
  const { cost } = respecCost(h, count, ctx.role, ctx.R);
  if (cost > h.gold) return refuse('gold');
  const beforeAvail = available(h, ctx.R);
  let next = confirm(h);
  if (cost > 0) next = addGold(next, -cost);
  next = fitted(next, ctx.R);
  const returned = available(next, ctx.R) - beforeAvail;
  let s: Save = { ...save, hunters: save.hunters.map((x, i) => (i === at ? next : x)) };
  if (ctx.role === 'player' && ctx.room && ctx.stamp) {
    const ev = newEvent('respec', { by: sheetKeyOf(save.settings.deviceId, h.id), name: h.name, count, cost }, ctx.stamp);
    if (ev) s = atOutbox(box => post(box, ctx.room!, { kind: 'event', event: ev }, null).box)(s);
  } else {
    const said = respecSaid(h.name, count, cost);
    s = told(s, { at: ctx.at, cap: ctx.R.logCap }, { ...said, hunterId: h.id });
  }
  return { save: s, count, cost, returned };
}

/** Static labels and copy builders for the Attributes take-back UI and warning dialog. */
export const RESPEC_WORDS = {
  takeAllAction: 'Take all back',
  note: 'Tap a stat to roll a check. Tap + or − to adjust points, then tap Confirm allocation.',
  warnTag: 'Point respec',
  warnTitle: 'Confirm point respec?',
  warnBody: (count: number, cost: number, gold: number): string =>
    `Take back ${pts(count)} for ${gp(cost)}? You have ${gp(gold)}.`,
  payAction: (cost: number): string => `Pay ${gp(cost)}`,
} as const;

/** Preview line shown beside Confirm allocation while taking back confirmed points; empty when `plan.count === 0`. */
export function confirmCostLine(plan: RespecPlan, gold: number): string {
  if (plan.count <= 0) return '';
  if (plan.freeWhy === 'gm') return `Taking back ${pts(plan.count)}. Free in GM mode. Tap Confirm allocation to apply.`;
  if (plan.freeWhy === 'before-first-fight') return `Taking back ${pts(plan.count)}. Free before your first fight. Tap Confirm allocation to apply.`;
  if (plan.freeWhy === 'rules') return `Taking back ${pts(plan.count)}. Free under current rules. Tap Confirm allocation to apply.`;
  if (gold < plan.cost) return `Taking back ${pts(plan.count)}. Respec costs ${gp(plan.cost)}. You have ${gold.toLocaleString('en-US')}.`;
  return `Taking back ${pts(plan.count)} costs ${gp(plan.cost)}. Tap Confirm allocation to pay.`;
}

/** Refusal toast messages for `confirmPoints`. */
export function respecRefusalWords(cost: number, gold: number): { readonly [W in 'no-hunter' | 'dead' | 'held' | 'gold']: string } {
  return {
    'no-hunter': 'Hunter not found.',
    dead: 'You cannot respec while dead.',
    held: 'You cannot respec during a fight.',
    gold: `Respec costs ${gp(cost)}. You have ${gold.toLocaleString('en-US')}.`,
  };
}

/** Success toast shown after confirming a take-back. */
export function respecToast(returned: number, count: number, cost: number): string {
  const extra = returned < count ? ` (${returned} available)` : '';
  return cost > 0 ? `Took back ${pts(count)} for ${gp(cost)}${extra}.` : `Took back ${pts(count)}${extra}.`;
}
