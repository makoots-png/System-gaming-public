// award.ts: what one of the GM view's actions writes, as one step. Pure.
//
// Before, Send award was a write per hunter of this phone, a post per group of players, then the log line, each its own
// write from gm.js; HP, Revive and a broadcast were a post and then a log line (implicit audit 2, N3, N4). A throw part
// way paid some hunters with no log line, and a second tap paid them twice. Now an action's change, its posts (queued in
// the outbox, src/core/sync/outbox.ts, which sends each until the room takes it, once) and its log lines are one answer,
// written by one `store.apply` or not at all, as a fight's end and a gate's Clear are (src/core/gates/pay.ts). What a
// running fight holds (a status on a row) is the fight's command, after this write, as a grant's fight parts are.
import { grant } from './hunter/grant.ts';
import type { Day, Granted, VitalsAt } from './hunter/grant.ts';
import type { GivenBundle, RoomCode, RoomEvent } from './protocol.ts';
import { record } from './hunter/chronicle.ts';
import type { Rewards } from './rewards.ts';
import type { Save } from './save.ts';
import { isRefused, refuse } from './save-step.ts';
import type { Refused } from './save-step.ts';
import type { FightId } from './combat/fight-types.ts';
import { told } from './session-log.ts';
import type { Said, Stamp } from './session-log.ts';
import { atOutbox, post } from './sync/outbox.ts';

/**
 * What an action sends and says beside its change: the room events it posts (for `room`; none outside a room), each
 * under its `key` when it has one (a queued message of that key stands for the same thing and is replaced), and its
 * log lines.
 */
export type Sends = { readonly room: RoomCode | null; readonly events: readonly (RoomEvent | Keyed)[]; readonly said: readonly Said[] };
/** A room event posted under a key: a newer one of the same key replaces it while it waits (src/core/sync/outbox.ts `post`). */
export type Keyed = { readonly key: string; readonly event: RoomEvent };

/** The save with `s`'s events queued in the outbox for its room, in order, and its lines on top of the log at `stamp`. */
export function sent(save: Save, s: Sends, stamp: Stamp): Save {
  const room = s.room;
  const posted = room && s.events.length ? atOutbox(box => s.events.reduce((b, e) => ('key' in e ? post(b, room, { kind: 'event', event: e.event }, e.key) : post(b, room, { kind: 'event', event: e })).box, box))(save) : save;
  return told(posted, stamp, ...s.said);
}

/** What the GM's award did: the next save and each local hunter's grant (the view shows each with `hunter.granted`). */
export type Awarded = { readonly save: Save; readonly granted: readonly { readonly hid: string; readonly g: Granted }[] };

/**
 * The GM's Send award, in one step: each hunter of this phone in `locals` granted `rewards` (with its vitals where its
 * fight holds them, `vitals`), then `s`: each player's award posted and the log line. A hunter no longer here is left out.
 * An award given from a bundle by hand (`given`, the GM's awards for roleplay) is a fact of each local hunter's chronicle,
 * in the same write; a player's phone records it when its award lands (room-events.ts).
 */
export function gmAward(save: Save, locals: readonly { readonly hid: string; readonly vitals: VitalsAt }[], rewards: Rewards, s: Sends, day: Day, given: GivenBundle | null = null): Awarded {
  let next = save;
  const granted: { hid: string; g: Granted }[] = [];
  for (const { hid, vitals } of locals) {
    const g = grant(next, hid, rewards, null, { ...day, vitals });
    if (isRefused(g)) continue;
    next = given ? { ...g.save, hunters: g.save.hunters.map(h => (h.id === hid ? record(h, { kind: 'given', key: given.key, name: given.name }) : h)) } : g.save;
    granted.push({ hid, g: { ...g, save: next } });
  }
  return { save: sent(next, s, { at: day.at, cap: day.R.logCap }), granted };
}

// ── the Award form's tie to a fight's drop ──
// Before, the form's tie to the loot was a flag on its section (`dataset.drop`) and the reward it would open with a
// `let` of gm.js (`pendingAward`). The flag stayed set when the GM folded the form or replaced the loot, so a later
// unrelated award dealt the loot as if it were given (SMX-gates-1, SMX-views-11.1). Now the tie is this machine: gm.js
// keeps its one value and steps it only through `draftStep`, and a send deals only the drop its draft names.
export const AWARD_DRAFT_STATES = ['blank', 'opening', 'fromDrop'] as const;
/**
 * The Award form: tied to nothing (whatever the GM typed); asked to open with `rewards` (a bundle's, or drop `drop`'s)
 * when the GM view next draws it; holding the drop of fight `fight`, whose send deals it.
 */
export type AwardDraft =
  | { readonly at: 'blank' }
  | { readonly at: 'opening'; readonly rewards: Rewards; readonly bundle: string | null; readonly drop: FightId | null }
  | { readonly at: 'fromDrop'; readonly fight: FightId };
export const BLANK_DRAFT: Extract<AwardDraft, { at: 'blank' }> = { at: 'blank' };
export const AWARD_DRAFT_EVENTS = ['open', 'drawn', 'bundle', 'fold', 'gone', 'sent'] as const;
/**
 * `award.open` (Award loot… with its drop, a bundle's Award… from the Workshop); the GM view drew the form; the GM
 * picked a bundle in the form; the GM folded Award; the drop the form holds no longer waits (set aside, or given from
 * another tab); the form's send wrote.
 */
export type AwardDraftEvent =
  | { readonly type: 'open'; readonly rewards: Rewards; readonly bundle: string | null; readonly drop: FightId | null }
  | { readonly type: 'drawn' } | { readonly type: 'bundle' } | { readonly type: 'fold' } | { readonly type: 'gone' } | { readonly type: 'sent' };
/** What the form does beside the step: stays as it is, is filled with `rewards` (its bundle shown picked), or is emptied. */
export type DraftForm = { readonly do: 'keep' } | { readonly do: 'fill'; readonly rewards: Rewards; readonly bundle: string | null } | { readonly do: 'clear' };
export type AwardDraftStep = { readonly draft: AwardDraft; readonly form: DraftForm };
type DraftFn<E extends AwardDraftEvent['type']> = (d: AwardDraft, e: Extract<AwardDraftEvent, { type: E }>) => AwardDraftStep;
const KEEP: DraftForm = { do: 'keep' }, untied = (form: DraftForm): AwardDraftStep => ({ draft: BLANK_DRAFT, form });
const opened: DraftFn<'open'> = (_d, e) => ({ draft: { at: 'opening', rewards: e.rewards, bundle: e.bundle, drop: e.drop }, form: KEEP });
/**
 * Every state against every event; null: refused, nothing changes. A drop's form folded, or whose drop left, is emptied
 * as it is untied: the loot still waits, offered again, and the form no longer gives it a second time.
 */
const DRAFT_TABLE: { readonly [S in AwardDraft['at']]: { readonly [E in AwardDraftEvent['type']]: DraftFn<E> | null } } = {
  blank: { open: opened, drawn: null, bundle: () => untied(KEEP), fold: () => untied(KEEP), gone: null, sent: () => untied(KEEP) },
  opening: {
    open: opened,
    drawn: d => {
      if (d.at !== 'opening') return untied(KEEP);
      const form: DraftForm = { do: 'fill', rewards: d.rewards, bundle: d.bundle };
      return { draft: d.drop ? { at: 'fromDrop', fight: d.drop } : BLANK_DRAFT, form };
    },
    bundle: null, fold: null, gone: null, sent: null,
  },
  fromDrop: { open: opened, drawn: null, bundle: () => untied(KEEP), fold: () => untied({ do: 'clear' }), gone: () => untied({ do: 'clear' }), sent: () => untied(KEEP) },
};
/** `d` after `e`, with what the form does, or null where the table refuses it. */
export function draftStep(d: AwardDraft, e: AwardDraftEvent): AwardDraftStep | null {
  const step = DRAFT_TABLE[d.at][e.type] as DraftFn<AwardDraftEvent['type']> | null;
  return step ? step(d, e) : null;
}
/**
 * The drop a send from `draft` deals in its write: the one the form holds, none from a blank form. A send of the loot
 * that would leave `unreached` picked hunters without it (a player's, with no room) is refused whole (`unreached`), so
 * nothing is written and the loot waits: loot leaves only by being given or by the GM's Set aside (SMX-gates-1.1).
 */
export function sendDeals(draft: AwardDraft, unreached: number): { readonly deals: FightId | null } | Refused<'unreached'> {
  if (draft.at !== 'fromDrop') return { deals: null };
  return unreached > 0 ? refuse('unreached') : { deals: draft.fight };
}
