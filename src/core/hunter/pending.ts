// pending.ts: a reward the app would pay by itself, waiting for the GM (World rule 8; the owner, Nov 22, rule d: "Yes").
// Pure.
//
// Four rewards used to reach a hunter with no one's say: a won solo run (a room's gate or a personal gate), a quest the
// System completed, a feat earned (and a bundle given from Give…'s shelf, which now opens the Award form instead:
// award.ts, held.ts).
// Each is now routed by where the phone sits (`ROUTE`): alone it pays at once, as before, since no GM is there to ask;
// a player's phone asks the GM with the `rewardAsk` message (protocol.ts) and pays nothing; the GM's phone keeps a
// record waiting in its save (`settings.sync.pending`), from a player's ask or from its own hunters, until the GM edits,
// approves or refuses it.
//
// One record's life is a machine (`TABLE`, docs/state-machines.md "A reward waiting for the GM"): waiting, then approved
// or refused, both ends. Approve is the one door to the reward: the GM view's Send award writes the record approved in
// the same write that grants it here or posts the `award` to the player (gm.js, award.ts `gmAward`), so the table
// refusing a second approve refuses the second payment. A record is kept by its id: a replayed ask makes no second one.
import { EARNED_WHAT_MAX, REWARD_FROM, approvalEvent, newEvent } from '../protocol.ts';
import type { AskFrom, EventStamp, RewardFrom, RoomEvent } from '../protocol.ts';
import { deviceOf, hunterIdOf, parseEventId, parseRoomCode, parseSheetKey, sheetKeyOf } from '../ids.ts';
import type { EventId, HunterId, RoomCode, SheetKey } from '../ids.ts';
import { isEmptyReward, newRewards, parseRewards, rewardLines, stripRewardJob } from '../rewards.ts';
import type { Rewards } from '../rewards.ts';
import { canonicalUniqueClass } from '../registry/jobs.ts';
import { seatOf } from '../role.ts';
import type { Seat } from '../role.ts';
import type { Rules, Save } from '../save.ts';
import { atSync, isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { told } from '../session-log.ts';
import type { Said, Stamp } from '../session-log.ts';
import { OUTBOX_MAX, atOutbox, post } from '../sync/outbox.ts';
import { timeOf } from '../day.ts';
import type { DayKey } from '../day.ts';
import { claimRemoteRewardJob, grant, idShare } from './grant.ts';
import type { Day, Granted, UniqueJobRefusal } from './grant.ts';

/**
 * Where a reward the app pays by itself goes, by the phone's seat: paid at once (`pay`), asked of the GM's phone
 * (`ask`), or kept waiting in this save for the GM (`wait`).
 */
export type RewardRoute = 'pay' | 'ask' | 'wait';
export const ROUTE: { readonly [S in Seat]: RewardRoute } = {
  // a phone playing alone has no GM to ask: its reward is paid at once, as it was before the ruling
  alone: 'pay',
  player: 'ask',
  gm: 'wait',
};
/**
 * The one routing table for every reward source by seat: player- or app-triggered rewards (`solo`, `quest`, `feat`)
 * follow `ROUTE` (GM approval stays on in a room), while a GM-confirmed gate clear (`clear`) pays directly in a room
 * as well as alone because the GM already confirmed the rewards in the Clear panel.
 */
export const REWARD_ROUTE: { readonly [F in RewardFrom]: { readonly [S in Seat]: RewardRoute } } = {
  solo: ROUTE,
  quest: ROUTE,
  feat: ROUTE,
  clear: { alone: 'pay', player: 'ask', gm: 'pay' },
};
/** Where a reward of source `from` goes on a phone in seat `seat`. */
export const routeFor = (seat: Seat, from: RewardFrom): RewardRoute => REWARD_ROUTE[from][seat];
/** Whether a reward earned on a phone in seat `seat` waits for the GM: the window shows `PENDING_WORDS.waits` in place of its lines. */
export const rewardWaits = (seat: Seat): boolean => ROUTE[seat] !== 'pay';

export const PENDING_STATES = ['waiting', 'approved', 'refused'] as const;
export type PendingState = (typeof PENDING_STATES)[number];
/**
 * A reward waiting for the GM, on the GM's phone: its id (the ask's event id), the room it waits in, the hunter it is for
 * (a player's sheet key, or this phone's own hunter's), its name, what earned it, the reward as it stands, when this
 * phone heard of it, and where it is.
 */
export type PendingReward = {
  readonly id: EventId; readonly room: RoomCode; readonly to: SheetKey; readonly name: string; readonly from: RewardFrom; readonly what: string;
  readonly rewards: Rewards; readonly heard: string; readonly at: PendingState;
};
export const PENDING_EVENTS = ['edit', 'approve', 'refuse'] as const;
/** The GM changed the reward (the Award form's fields), approved it, or refused it. */
export type PendingEvent = { readonly type: 'edit'; readonly rewards: Rewards } | { readonly type: 'approve' } | { readonly type: 'refuse' };

type PendingFn<E extends PendingEvent['type']> = (p: PendingReward, e: Extract<PendingEvent, { type: E }>) => PendingReward;
/**
 * Every state against every event; null: refused, nothing changes. The GM edits freely, above what the rule pays too, as
 * the Award form does (section 20's default). Approved and refused are ends: a second approve pays nothing.
 */
const TABLE: { readonly [S in PendingState]: { readonly [E in PendingEvent['type']]: PendingFn<E> | null } } = {
  waiting: {
    edit: (p, e) => ({ ...p, rewards: e.rewards }),
    approve: p => ({ ...p, at: 'approved' }),
    refuse: p => ({ ...p, at: 'refused' }),
  },
  approved: { edit: null, approve: null, refuse: null },
  refused: { edit: null, approve: null, refuse: null },
};
/** `p` after `e`, or null where the table refuses it. */
export function pendingStep(p: PendingReward, e: PendingEvent): PendingReward | null {
  const step = TABLE[p.at][e.type] as PendingFn<PendingEvent['type']> | null;
  return step ? step(p, e) : null;
}

// ── the save ──
/** The ended records a phone keeps past its waiting ones, so a replayed ask finds its id: a session's worth. */
export const ENDED_KEPT = 40;
/** The records the save holds, oldest first. */
export const pendingOf = (s: Pick<Save, 'settings'>): readonly PendingReward[] => s.settings.sync.pending ?? [];
const withPending = <S extends Pick<Save, 'settings'>>(s: S, list: readonly PendingReward[]): S =>
  atSync(sy => ({ ...sy, pending: [...list] }))(s);
/** `list` with each waiting record and the newest `ENDED_KEPT` ended ones. */
function kept(list: readonly PendingReward[]): readonly PendingReward[] {
  const ended = list.filter(p => p.at !== 'waiting'), over = new Set(ended.slice(0, Math.max(0, ended.length - ENDED_KEPT)));
  return over.size ? list.filter(p => !over.has(p)) : list;
}
/** The rewards waiting in room `room`, oldest first. */
export const waitingIn = (s: Pick<Save, 'settings'>, room: RoomCode): PendingReward[] => pendingOf(s).filter(p => p.room === room && p.at === 'waiting');

/** What the GM's log says of a record heard, approved or refused. */
const said = (title: string, text: string): Said => ({ kind: 'award', hunterId: null, title, text });
/** What `pendingHeard` takes: a player's `RewardAskPayload` or a GM-local pending reward such as a gate clear preset. */
export type PendingHeardInput = {
  readonly eid: EventId; readonly by: SheetKey; readonly name: string; readonly from: RewardFrom; readonly what: string; readonly rewards: Rewards;
};
/**
 * Ask `p` heard in room `room` at `heard` (a player's, from sync.ts's `sync:event` once by its id; or this phone's own,
 * `selfPaid` or a gate clear preset): a waiting record and its log line, one write. A record of that id already here changes nothing.
 */
export function pendingHeard(s: Save, p: PendingHeardInput, room: RoomCode, log: Stamp): Save {
  if (pendingOf(s).some(x => x.id === p.eid)) return s;
  const name = p.name || 'A hunter', rec: PendingReward = { id: p.eid, room, to: p.by, name, from: p.from, what: p.what, rewards: p.rewards, heard: log.at, at: 'waiting' };
  return told(withPending(s, kept([...pendingOf(s), rec])), log, said(PENDING_WORDS.logTitle, PENDING_WORDS.heardLog(name, p.from, p.what)));
}
/** Why the GM's answer to a record changed nothing: no such record here, or it was answered already. */
export type PendingRefusal = 'no-reward' | 'answered';
/** The save with record `id` after `events`, in turn; refused when there is none, or when the table refuses one. */
function stepped(s: Save, id: string, events: readonly PendingEvent[]): { save: Save; rec: PendingReward } | Refused<PendingRefusal> {
  const list = pendingOf(s), at = list.findIndex(p => p.id === id);
  if (at < 0) return refuse('no-reward');
  let rec = list[at]!;
  for (const e of events) { const next = pendingStep(rec, e); if (!next) return refuse('answered'); rec = next; }
  return { save: withPending(s, kept(list.map((p, i) => (i === at ? rec : p)))), rec };
}
/**
 * Record `id` edited in place with `rewards` while staying `waiting` (e.g. when a job-only approval was refused and kept
 * pending, so the GM's edits are preserved).
 */
export function pendingEdited(s: Save, id: string, rewards: Rewards): Save | Refused<PendingRefusal> {
  const r = stepped(s, id, [{ type: 'edit', rewards }]);
  return isRefused(r) ? r : r.save;
}
/**
 * Record `id` approved with `rewards` as the GM left them (edited, then approved). Only the record: the GM view writes it
 * in the write of its award (gm.js `sendAward`), so a refusal here writes no reward either.
 */
export function pendingApproved(s: Save, id: string, rewards: Rewards): Save | Refused<PendingRefusal> {
  const r = stepped(s, id, [{ type: 'edit', rewards }, { type: 'approve' }]);
  return isRefused(r) ? r : r.save;
}
/**
 * Record `id` refused, its log line, and for a player's hunter a System window that says so (the `system` message,
 * sealed to that hunter), one write.
 */
export function pendingRefused(s: Save, id: string, c: { readonly stamp: EventStamp; readonly log: Stamp }): Save | Refused<PendingRefusal> {
  const r = stepped(s, id, [{ type: 'refuse' }]);
  if (isRefused(r)) return r;
  const { rec } = r, mine = deviceOf(rec.to) === s.settings.deviceId;
  const ev = mine ? null : newEvent('system', { to: [rec.to], tag: '! System', title: PENDING_WORDS.refusedTitle, body: PENDING_WORDS.refusedBody(rec.from, rec.what), kind: 'warning' }, c.stamp);
  const posted = ev ? atOutbox(b => post(b, rec.room, { kind: 'event', event: ev }).box)(r.save) : r.save;
  return told(posted, c.log, said(PENDING_WORDS.refusedLogTitle, PENDING_WORDS.heardLog(rec.name, rec.from, rec.what)));
}
/** The hunter of this phone record `p` is for, or null for a player's. */
export const localHunter = (s: Pick<Save, 'settings'>, p: Pick<PendingReward, 'to'>): HunterId | null =>
  (deviceOf(p.to) === s.settings.deviceId ? hunterIdOf(p.to) : null);

/** Why `pendingApproveAll` changed nothing: nothing waits in this room, or the outbox has no free room for remote awards. */
export type ApproveAllRefusal = 'no-reward' | 'outbox-full';
/** Context for `pendingApproveAll`: the current day/rules, and any local or remote hunters held by this phone's fight. */
export type ApproveAllCtx = {
  readonly day: Day;
  readonly heldLocals?: ReadonlySet<HunterId>;
  readonly heldRemotes?: ReadonlySet<SheetKey>;
  readonly stamp?: EventStamp | null;
};
/** What `pendingApproveAll` wrote in one atomic step. */
export type ApprovedAll = {
  readonly save: Save;
  readonly approved: readonly PendingReward[];
  readonly granted: readonly { readonly hid: HunterId; readonly g: Granted; readonly rec: PendingReward }[];
  readonly posted: readonly SheetKey[];
  readonly remoteStatuses: readonly { readonly key: SheetKey; readonly statuses: Rewards['statuses'] }[];
  readonly remoteClaimed: readonly SheetKey[];
  readonly remoteJobRefused: readonly { readonly key: SheetKey; readonly name: string; readonly refusal: UniqueJobRefusal }[];
  readonly localJobRefused: readonly { readonly hid: HunterId; readonly name: string; readonly refusal: UniqueJobRefusal }[];
  readonly localJobHeld: readonly { readonly hid: HunterId; readonly name: string; readonly job: string; readonly why: 'held' | 'dead' }[];
  readonly remaining: number;
};
/**
 * Builds the deterministic `award` event for approving waiting reward `rec` with `rewards` (as asked or as edited).
 * Shared by single-row Approve (`gm.js`) and `pendingApproveAll` so concurrent GM approvals converge on `approvalIdOf(rec.id)`.
 */
export function pendingAwardEvent(rec: Pick<PendingReward, 'id' | 'to' | 'from' | 'what'>, rewards: Rewards): RoomEvent | null {
  return approvalEvent(rec.id, { to: [rec.to], rewards, earned: { from: rec.from, what: rec.what } });
}
/**
 * Approves waiting rewards in `room` in one atomic step: transitions each approved record to `approved` via
 * `pendingStep`, grants local hunters with `grant` (preserving `from` for debt and guild rules), posts one
 * deterministic `approvalEvent` per remote reward without overflowing `OUTBOX_MAX`, and appends session log lines.
 * Idempotent on a double tap (`no-reward`) and deduplicated across GM devices by `approvalIdOf(rec.id)`.
 */
export function pendingApproveAll(save: Save, room: RoomCode, ctx: ApproveAllCtx): ApprovedAll | Refused<ApproveAllRefusal> {
  const waiting = waitingIn(save, room);
  if (!waiting.length) return refuse('no-reward');
  const liveOutbox = (save.settings.sync.outbox ?? []).filter(e => e.at !== 'refused').length;
  const avail = Math.max(0, OUTBOX_MAX - liveOutbox);
  const logStamp: Stamp = { at: ctx.day.at, cap: ctx.day.R.logCap };

  let next: Save = save;
  let remotePosted = 0;
  let remaining = 0;
  const approved: PendingReward[] = [];
  const approvedIds = new Set<EventId>();
  const granted: { hid: HunterId; g: Granted; rec: PendingReward }[] = [];
  const posted: SheetKey[] = [];
  const remoteStatuses: { key: SheetKey; statuses: Rewards['statuses'] }[] = [];
  const remoteClaimed: SheetKey[] = [];
  const remoteJobRefused: { key: SheetKey; name: string; refusal: UniqueJobRefusal }[] = [];
  const localJobRefused: { hid: HunterId; name: string; refusal: UniqueJobRefusal }[] = [];
  const localJobHeld: { hid: HunterId; name: string; job: string; why: 'held' | 'dead' }[] = [];
  const events: RoomEvent[] = [];
  const logLines: Said[] = [];

  for (const rec of waiting) {
    const step = pendingStep(rec, { type: 'approve' });
    if (!step) continue;
    const hid = localHunter(next, rec);
    if (hid) {
      const vitals = ctx.heldLocals?.has(hid) ? 'fight' : 'sheet';
      const g = grant(next, hid, rec.rewards, { ...ctx.day, vitals, from: rec.from });
      if (!isRefused(g)) {
        const jobOnly = !!(rec.rewards.job && isEmptyReward(stripRewardJob(rec.rewards)));
        if (g.jobRefused) {
          localJobRefused.push({ hid, name: rec.name, refusal: g.jobRefused });
          // If the waiting reward was unique-job-only and refused, leave it waiting instead of consuming it.
          if (jobOnly) continue;
        } else if (g.jobWhy && jobOnly) {
          // A plain local job-only reward refused because the hunter is held or down stays waiting too.
          localJobHeld.push({ hid, name: rec.name, job: rec.rewards.job!, why: g.jobWhy });
          continue;
        }
        next = g.save;
        granted.push({ hid, g, rec });
      }
      const logRewards = !isRefused(g) && rec.rewards.job && g.job === null ? stripRewardJob(rec.rewards) : rec.rewards;
      const bits = rewardLines(ctx.day.R, logRewards).join(', ');
      approvedIds.add(rec.id);
      approved.push(step);
      if (bits) logLines.push({ kind: 'award', hunterId: hid, title: 'GM approved', text: `${PENDING_WORDS.earned(rec.from, rec.what)}: ${bits} → ${rec.name}` });
    } else {
      const uniqueJob = rec.rewards.job ? canonicalUniqueClass(rec.rewards.job) : null;
      const baseWire = uniqueJob ? stripRewardJob(rec.rewards) : rec.rewards;
      const held = !!ctx.heldRemotes?.has(rec.to) && baseWire.statuses.length > 0;
      const { statuses: onRow, ...restFields } = baseWire;
      const wireRewards: Rewards = held ? { ...newRewards(), ...restFields } : baseWire;
      const needsEvent = !isEmptyReward(wireRewards);
      const slotsNeeded = (needsEvent ? 1 : 0) + (uniqueJob && ctx.stamp ? 1 : 0);
      if (slotsNeeded > 0 && remotePosted + slotsNeeded > avail) { remaining++; continue; }

      let claimedUnique = false;
      if (uniqueJob) {
        const res = claimRemoteRewardJob(
          next,
          rec.rewards.job,
          { kind: 'remote', sheetKey: rec.to, name: rec.name },
          {
            at: ctx.day.at,
            room,
            stamp: ctx.stamp ? { ...ctx.stamp, seq: remotePosted } : null,
            R: ctx.day.R,
            heldLocal: () => false,
            heldRemote: key => !!ctx.heldRemotes?.has(key),
          },
        );
        if (res.claimed) {
          next = res.save;
          remoteClaimed.push(rec.to);
          claimedUnique = true;
          if (ctx.stamp) remotePosted++;
        } else if (res.refused) {
          remoteJobRefused.push({ key: rec.to, name: rec.name, refusal: res.refused });
          // If the waiting reward was unique-job-only and refused, leave it waiting instead of discarding it.
          if (!needsEvent && !held) continue;
        }
      }

      if (needsEvent) {
        const ev = pendingAwardEvent(rec, wireRewards);
        if (!ev) { remaining++; continue; }
        events.push(ev);
        remotePosted++;
        posted.push(rec.to);
      }
      if (held) remoteStatuses.push({ key: rec.to, statuses: onRow });
      const logRewards = uniqueJob && !claimedUnique ? stripRewardJob(rec.rewards) : rec.rewards;
      const bits = rewardLines(ctx.day.R, logRewards).join(', ');
      approvedIds.add(rec.id);
      approved.push(step);
      if (bits) logLines.push({ kind: 'award', hunterId: null, title: 'GM approved', text: `${PENDING_WORDS.earned(rec.from, rec.what)}: ${bits} → ${rec.name}` });
    }
  }

  if (!approved.length) {
    if ((remoteJobRefused.length || localJobRefused.length || localJobHeld.length) && remaining === 0) {
      return { save: next, approved, granted, posted, remoteStatuses, remoteClaimed, remoteJobRefused, localJobRefused, localJobHeld, remaining };
    }
    return refuse('outbox-full');
  }

  const updated = pendingOf(next).map(p => (approvedIds.has(p.id) ? pendingStep(p, { type: 'approve' }) ?? p : p));
  next = withPending(next, kept(updated));
  if (events.length) {
    next = atOutbox(box => events.reduce((b, ev) => post(b, room, { kind: 'event', event: ev }).box, box))(next);
  }
  if (logLines.length) next = told(next, logStamp, ...logLines);
  return { save: next, approved, granted, posted, remoteStatuses, remoteClaimed, remoteJobRefused, localJobRefused, localJobHeld, remaining };
}

// ── a reward the app pays by itself ──
/** Where the phone sits for a reward: alone, or in room `room` as a player or as its GM. */
export type RewardSeat = { readonly seat: 'alone' } | { readonly seat: 'player' | 'gm'; readonly room: RoomCode };
export const ALONE: RewardSeat = { seat: 'alone' };
/** Where the phone sits for a reward by the save's room fields: alone, or in `room` as a player or as its GM. */
export function rewardSeatOf(s: Pick<Save, 'settings'>): RewardSeat {
  const room = s.settings.sync.room, seat = seatOf(s.settings, room);
  return room && seat !== 'alone' ? { seat, room } : ALONE;
}
/** What earned a reward by itself, and the reward. */
export type SelfReward = { readonly from: AskFrom; readonly what: string; readonly seed: string; readonly rewards: Rewards };
/** The ask of hunter `hid` for `r` at `at`: its id made from `r.seed`, so the same reward asked twice is one message. */
export function askOf(s: Save, hid: HunterId, r: SelfReward, at: string): (RoomEvent & { type: 'rewardAsk' }) | null {
  const h = s.hunters.find(x => x.id === hid), device = s.settings.deviceId;
  if (!h) return null;
  const ev = newEvent('rewardAsk', { by: sheetKeyOf(device, hid), name: h.name, from: r.from, what: r.what.slice(0, EARNED_WHAT_MAX), rewards: r.rewards }, { device, now: Date.parse(at), rand: idShare(r.seed) });
  return ev && ev.type === 'rewardAsk' ? ev : null;
}
/** What `selfPay` wrote: the next save, and what `grant` did when paid at once (null when it waits or is empty). */
export type SelfPaid = { readonly save: Save; readonly granted: Granted | null };
/** What `selfPay` reads besides the save and reward: the write's moment, the rules, the phone's seat, and the grant step (defaults to `grant`). */
export type SelfPayCtx = {
  readonly at: string; readonly today: DayKey; readonly R: Rules; readonly seat: RewardSeat;
  readonly grant?: typeof grant;
};
/**
 * Reward `r` earned by hunter `hid` with no one's say, routed by `ROUTE`, in the write that earned it: paid at once by
 * `grant` alone (answering what `grant` did, or its refusal); asked of the GM in the room's outbox on a player's phone;
 * kept waiting in this save on the GM's phone. Refused (`no-hunter`) when the hunter is absent. An empty reward goes nowhere.
 */
export function selfPay(s: Save, hid: HunterId, r: SelfReward, c: SelfPayCtx): SelfPaid | Refused<'no-hunter'> {
  if (isEmptyReward(r.rewards)) return { save: s, granted: null };
  const route = ROUTE[c.seat.seat], room = c.seat.seat === 'alone' ? null : c.seat.room;
  if (route === 'pay') {
    const g = (c.grant ?? grant)(s, hid, r.rewards, { at: c.at, today: c.today, R: c.R, vitals: 'sheet', from: r.from });
    return isRefused(g) ? g : { save: g.save, granted: g };
  }
  if (!s.hunters.some(x => x.id === hid)) return refuse('no-hunter');
  const ev = room ? askOf(s, hid, r, c.at) : null;
  if (!ev || !room) return { save: s, granted: null };
  return { save: route === 'ask' ? atOutbox(b => post(b, room, { kind: 'event', event: ev }).box)(s) : pendingHeard(s, ev.payload, room, { at: c.at, cap: c.R.logCap }), granted: null };
}
/** As `selfPay`, answering only the next save, or its refusal. */
export function selfPaid(s: Save, hid: HunterId, r: SelfReward, c: SelfPayCtx): Save | Refused<'no-hunter'> {
  const paid = selfPay(s, hid, r, c);
  return isRefused(paid) ? paid : paid.save;
}

// ── words ──
const FROM_WORDS: { readonly [F in RewardFrom]: string } = { solo: 'Solo gate clear', quest: 'Quest complete', feat: 'Feat', clear: 'Gate clear' };
/** Every line the GM and the player read of a waiting reward. */
export const PENDING_WORDS = {
  title: 'Pending rewards',
  none: 'No pending rewards.',
  summary: (n: number): string => (n ? `${n} pending` : ''),
  /** In a window, in place of the reward's lines, on a phone where the reward waits. */
  waits: 'Waiting for GM approval',
  earned: (from: RewardFrom, what: string): string => (what ? `${FROM_WORDS[from]}: ${what}` : FROM_WORDS[from]),
  approve: 'Approve',
  approveAll: 'Approve all',
  approveAllCount: (n: number): string => `Approve all (${n})`,
  edit: 'Edit',
  refuse: 'Refuse',
  /** The Award form's line while it holds a waiting reward. */
  tie: (name: string, from: RewardFrom, what: string): string => `For ${name}: ${PENDING_WORDS.earned(from, what)}. Tap Approve to give it to ${name}, or collapse Award to leave it pending.`,
  notify: (name: string): string => `${name} earned a reward that needs your approval.`,
  approved: (name: string): string => `Approved reward for ${name}.`,
  approvedAll: (n: number): string => `Approved ${n} reward${n === 1 ? '' : 's'}.`,
  approvedAllSaved: (n: number): string => `Approved ${n} reward${n === 1 ? '' : 's'}. Players will get them once the room server confirms them.`,
  approvedAllPartial: (done: number, left: number): string => `Approved ${done} reward${done === 1 ? '' : 's'}. ${left} remain pending until your phone sends the queued room messages.`,
  refused: (name: string): string => `Refused reward for ${name}.`,
  logTitle: 'Pending reward',
  refusedLogTitle: 'Reward refused',
  heardLog: (name: string, from: RewardFrom, what: string): string => `${name}: ${PENDING_WORDS.earned(from, what)}`,
  refusedTitle: 'REWARD REFUSED',
  refusedBody: (from: RewardFrom, what: string): string => `${PENDING_WORDS.earned(from, what)}. The GM refused this reward.`,
  approvedBody: (from: RewardFrom, what: string): string => `${PENDING_WORDS.earned(from, what)}. The GM approved your reward.`,
  refusals: {
    'no-reward': 'This reward is no longer pending on this phone.',
    answered: 'You already approved or refused this reward.',
    'outbox-full': 'Your phone has too many unsent room messages. Reconnect so they can send, then tap Approve all again.',
  } satisfies { readonly [W in PendingRefusal | ApproveAllRefusal]: string },
} as const;

// ── the save's reader ──
type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const inList = <T extends string>(list: readonly T[], v: unknown): T | null => (list as readonly unknown[]).includes(v) ? v as T : null;
/** The stored records, each read whole or dropped; one per id, the waiting ones and the newest `ENDED_KEPT` ended. */
export function parsePending(v: unknown): PendingReward[] {
  const out: PendingReward[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    if (!isObj(raw)) continue;
    const id = parseEventId(raw.id), room = parseRoomCode(raw.room), to = parseSheetKey(raw.to), from = inList(REWARD_FROM, raw.from);
    const rewards = parseRewards(raw.rewards), heard = timeOf(raw.heard), at = inList(PENDING_STATES, raw.at);
    if (!id || !room || !to || !from || !rewards || !heard || !at || out.some(p => p.id === id)) continue;
    const name = typeof raw.name === 'string' ? raw.name.slice(0, 60) : '', what = typeof raw.what === 'string' ? raw.what.slice(0, EARNED_WHAT_MAX) : '';
    out.push({ id, room, to, name, from, what, rewards, heard, at });
  }
  return [...kept(out)];
}
