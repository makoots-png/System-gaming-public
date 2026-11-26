// award.ts: what one of the GM view's actions writes, as one step. Pure.
//
// Before, Send award was a write per hunter of this phone, a post per group of players, then the log line, each its own
// write from gm.js; HP, Revive and a broadcast were a post and then a log line (implicit audit 2, N3, N4). A throw part
// way paid some hunters with no log line, and a second tap paid them twice. Now an action's change, its posts (queued in
// the outbox, src/core/sync/outbox.ts, which sends each until the room takes it, once) and its log lines are one answer,
// written by one `store.apply` or not at all, as a fight's end and a gate's Clear are (src/core/gates/pay.ts). What a
// running fight holds (a status on a row) is the fight's command, after this write, as a grant's fight parts are.
import { claimRemoteRewardJob, grant } from './hunter/grant.ts';
import type { Day, Granted, UniqueJobRefusal, VitalsAt } from './hunter/grant.ts';
import type { EventStamp, GivenBundle, RewardFrom, RoomCode, RoomEvent, SheetKey } from './protocol.ts';
import { canonicalUniqueClass } from './registry/jobs.ts';
import { record } from './hunter/chronicle.ts';
import { isEmptyReward, jobLine, rewardLines, stripRewardJob } from './rewards.ts';
import type { Rewards } from './rewards.ts';
import type { Rules } from './rules.ts';
import type { Save } from './save.ts';
import { isRefused, refuse } from './save-step.ts';
import type { Refused } from './save-step.ts';
import type { EventId, FightId } from './ids.ts';
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

/** What the GM's award did: the next save, each local hunter's grant, and any remote unique-class claims or refusals. */
export type Awarded = {
  readonly save: Save;
  readonly granted: readonly { readonly hid: string; readonly g: Granted }[];
  readonly remoteClaimed: readonly SheetKey[];
  readonly remoteJobRefused: readonly { readonly key: SheetKey; readonly name: string; readonly refusal: UniqueJobRefusal }[];
};

/** Who took an award's job: this phone's hunters by id, the players by sheet key. */
export type JobTook = { readonly local: readonly string[]; readonly remote: readonly SheetKey[] };
/** An award's log lines, built once `gmAward` knows who took its job (statechart rule 3: a refused job is never logged as given). */
export type AwardSaid = (took: JobTook) => readonly Said[];
/** What the GM's Send award sends and says: as `Sends`, with its lines built from who took the job when they depend on it. */
export type AwardSends = Omit<Sends, 'said'> & { readonly said: readonly Said[] | AwardSaid };

/**
 * The Send award's log lines once its grants are known, for `rewards` (or bundle `bundle`, by name) given to `to`:
 * `line(bits, names)` once with the whole reward to everyone when every one took its job or it names none. Otherwise
 * the reward without its job to everyone (left out when that gives nothing, even for a bundle), and `Job: X` to
 * those who took it when any did, as a waiting reward's approval logs it (hunter/pending.ts `pendingApproveAll`). A player
 * takes a unique job only by its claim (`took.remote`); a plain job goes in the player's award, so each player sent it
 * counts as taking it. No recipient, no line.
 */
export function awardSaid(o: {
  readonly R: Rules;
  readonly rewards: Rewards;
  readonly bundle: string | null;
  readonly to: JobTook;
  readonly names: { readonly local: (hid: string) => string; readonly remote: (key: SheetKey) => string };
  readonly line: (bits: string, names: readonly string[]) => Said;
}): AwardSaid {
  return took => {
    const all = [...o.to.local.map(o.names.local), ...o.to.remote.map(o.names.remote)];
    if (!all.length) return [];
    const job = o.rewards.job;
    const remote = job && canonicalUniqueClass(job) ? took.remote : o.to.remote;
    const tookNames = [...o.to.local.filter(h => took.local.includes(h)).map(o.names.local), ...o.to.remote.filter(k => remote.includes(k)).map(o.names.remote)];
    if (!job || tookNames.length === all.length) return [o.line(o.bundle ?? rewardLines(o.R, o.rewards).join(', '), all)];
    const stripped = stripRewardJob(o.rewards);
    const rest = isEmptyReward(stripped) ? '' : (o.bundle ?? rewardLines(o.R, stripped).join(', '));
    return [
      ...(rest ? [o.line(rest, all)] : []),
      ...(tookNames.length ? [o.line(jobLine(job), tookNames)] : []),
    ];
  };
}

/**
 * Whether an approved waiting reward should stay pending because it was job-only and every recipient's job was refused
 * on this phone (any unique-class claim refusal, or a local plain job refused because the hunter is held or down).
 */
export function awardKeepsPending(
  rewards: Rewards,
  awarded: Pick<Awarded, 'granted' | 'remoteClaimed' | 'remoteJobRefused'>,
): boolean {
  if (!rewards.job || !isEmptyReward(stripRewardJob(rewards))) return false;
  const anyTaken = awarded.remoteClaimed.length > 0 || awarded.granted.some(x => x.g.job !== null);
  if (anyTaken) return false;
  if (canonicalUniqueClass(rewards.job)) {
    const remoteRefused = awarded.remoteJobRefused.length > 0;
    const localRefused = awarded.granted.length > 0 && awarded.granted.every(x => !!x.g.jobRefused);
    return remoteRefused || localRefused;
  }
  return awarded.granted.length > 0 && awarded.granted.every(x => x.g.jobWhy === 'held' || x.g.jobWhy === 'dead');
}

/** Optional remote unique-class claim context passed to `gmAward` when `rewards.job` names a unique class. */
export type RemoteJobCtx = {
  readonly targets: readonly { readonly key: SheetKey; readonly name: string }[];
  readonly heldRemote: (key: SheetKey) => boolean;
  readonly stamp: EventStamp | null;
};

/**
 * The GM's Send award, in one step: each hunter of this phone in `locals` granted `rewards` (with its vitals where its
 * fight holds them, `vitals`), any remote unique `rewards.job` claimed via `claimUniqueClass`, then `s`: each player's
 * award posted and the log line, built from who took the job when `s.said` is a builder (`awardSaid`). A hunter no longer
 * here is left out. An award given from a bundle by hand (`given`,
 * the GM's awards for roleplay) is a fact of each local hunter's chronicle, in the same write; a player's phone records
 * it when its award lands (room-events.ts).
 */
export function gmAward(
  save: Save,
  locals: readonly { readonly hid: string; readonly vitals: VitalsAt }[],
  rewards: Rewards,
  s: AwardSends,
  day: Day,
  given: GivenBundle | null = null,
  from: RewardFrom | null = null,
  remoteJobs: RemoteJobCtx | null = null,
): Awarded {
  let next = save;
  const granted: { hid: string; g: Granted }[] = [];
  const jobOnly = !!(rewards.job && isEmptyReward(stripRewardJob(rewards)));
  for (const { hid, vitals } of locals) {
    const g = grant(next, hid, rewards, { ...day, vitals, from });
    if (isRefused(g)) continue;
    const recordGiven = given && !(jobOnly && g.job === null);
    next = recordGiven ? { ...g.save, hunters: g.save.hunters.map(h => (h.id === hid ? record(h, { kind: 'given', key: given.key, name: given.name }) : h)) } : g.save;
    granted.push({ hid, g: { ...g, save: next } });
  }
  const remoteClaimed: SheetKey[] = [];
  const remoteJobRefused: { key: SheetKey; name: string; refusal: UniqueJobRefusal }[] = [];
  if (remoteJobs && rewards.job && canonicalUniqueClass(rewards.job)) {
    for (let i = 0; i < remoteJobs.targets.length; i++) {
      const t = remoteJobs.targets[i]!;
      const res = claimRemoteRewardJob(
        next,
        rewards.job,
        { kind: 'remote', sheetKey: t.key, name: t.name },
        {
          at: day.at,
          room: s.room,
          stamp: remoteJobs.stamp ? { ...remoteJobs.stamp, seq: i } : null,
          R: day.R,
          heldLocal: () => false,
          heldRemote: remoteJobs.heldRemote,
        },
      );
      if (res.claimed) {
        next = res.save;
        remoteClaimed.push(t.key);
      } else if (res.refused) {
        remoteJobRefused.push({ key: t.key, name: t.name, refusal: res.refused });
      }
    }
  }
  const said = typeof s.said === 'function'
    ? s.said({ local: rewards.job ? granted.filter(({ g }) => g.job !== null).map(({ hid }) => hid) : [], remote: remoteClaimed })
    : s.said;
  return { save: sent(next, { ...s, said }, { at: day.at, cap: day.R.logCap }), granted, remoteClaimed, remoteJobRefused };
}

// ── the Award form's tie to what its send settles ──
// Before, the form's tie to the loot was a flag on its section (`dataset.drop`) and the reward it would open with a
// `let` of gm.js (`pendingAward`). The flag stayed set when the GM folded the form or replaced the loot, so a later
// unrelated award dealt the loot as if it were given (SMX-gates-1, SMX-views-11.1). Now the tie is this machine: gm.js
// keeps its one value and steps it only through `draftStep`, and a send settles only what its draft names: the drop of
// a fight; a reward waiting for the GM (hunter/pending.ts), which the send approves; or an award picked on Give…'s
// shelf in a room, which the send gives as that bundle, held under Undo (ruling 20, SMX-gates-5.2: held.ts).
/**
 * What a send of the form settles beside its award: fight `fight`'s drop, dealt; waiting reward `id`, approved; or bundle
 * `given` from the shelf, given to `to` (this phone's hunter id or a player's sheet key).
 */
export type DraftTie =
  | { readonly kind: 'drop'; readonly fight: FightId } | { readonly kind: 'pending'; readonly id: EventId }
  | { readonly kind: 'shelf'; readonly given: GivenBundle; readonly to: string };
export const AWARD_DRAFT_STATES = ['blank', 'opening', 'tied'] as const;
/**
 * The Award form: tied to nothing (whatever the GM typed); asked to open with `rewards` (a bundle's, a drop's, a waiting
 * reward's) when the GM view next draws it, tied then to `tie`; holding `tie`, whose send settles it.
 */
export type AwardDraft =
  | { readonly at: 'blank' }
  | { readonly at: 'opening'; readonly rewards: Rewards; readonly bundle: string | null; readonly tie: DraftTie | null }
  | { readonly at: 'tied'; readonly tie: DraftTie };
export const BLANK_DRAFT: Extract<AwardDraft, { at: 'blank' }> = { at: 'blank' };
export const AWARD_DRAFT_EVENTS = ['open', 'drawn', 'bundle', 'fold', 'gone', 'sent'] as const;
/**
 * `award.open` (Award loot… with its drop, a bundle's Award… from the Workshop, a waiting reward's Edit); the GM view drew
 * the form; the GM picked a bundle in the form; the GM folded Award; what the form is tied to no longer waits (the drop
 * set aside or given from another tab, the reward answered); the form's send wrote.
 */
export type AwardDraftEvent =
  | { readonly type: 'open'; readonly rewards: Rewards; readonly bundle: string | null; readonly tie: DraftTie | null }
  | { readonly type: 'drawn' } | { readonly type: 'bundle' } | { readonly type: 'fold' } | { readonly type: 'gone' } | { readonly type: 'sent' };
/** What the form does beside the step: stays as it is, is filled with `rewards` (its bundle shown picked), or is emptied. */
export type DraftForm = { readonly do: 'keep' } | { readonly do: 'fill'; readonly rewards: Rewards; readonly bundle: string | null } | { readonly do: 'clear' };
export type AwardDraftStep = { readonly draft: AwardDraft; readonly form: DraftForm };
type DraftFn<E extends AwardDraftEvent['type']> = (d: AwardDraft, e: Extract<AwardDraftEvent, { type: E }>) => AwardDraftStep;
const KEEP: DraftForm = { do: 'keep' }, untied = (form: DraftForm): AwardDraftStep => ({ draft: BLANK_DRAFT, form });
const opened: DraftFn<'open'> = (_d, e) => ({ draft: { at: 'opening', rewards: e.rewards, bundle: e.bundle, tie: e.tie }, form: KEEP });
/**
 * Every state against every event; null: refused, nothing changes. A tied form folded, or whose tie left, is emptied as
 * it is untied: the loot or the reward still waits, offered again, and the form no longer settles it a second time.
 */
const DRAFT_TABLE: { readonly [S in AwardDraft['at']]: { readonly [E in AwardDraftEvent['type']]: DraftFn<E> | null } } = {
  blank: { open: opened, drawn: null, bundle: () => untied(KEEP), fold: () => untied(KEEP), gone: null, sent: () => untied(KEEP) },
  opening: {
    open: opened,
    drawn: d => {
      if (d.at !== 'opening') return untied(KEEP);
      const form: DraftForm = { do: 'fill', rewards: d.rewards, bundle: d.bundle };
      return { draft: d.tie ? { at: 'tied', tie: d.tie } : BLANK_DRAFT, form };
    },
    bundle: null, fold: null, gone: null, sent: null,
  },
  tied: { open: opened, drawn: null, bundle: () => untied(KEEP), fold: () => untied({ do: 'clear' }), gone: () => untied({ do: 'clear' }), sent: () => untied(KEEP) },
};
/** `d` after `e`, with what the form does, or null where the table refuses it. */
export function draftStep(d: AwardDraft, e: AwardDraftEvent): AwardDraftStep | null {
  const step = DRAFT_TABLE[d.at][e.type] as DraftFn<AwardDraftEvent['type']> | null;
  return step ? step(d, e) : null;
}
/**
 * The drop a send from `draft` deals in its write: the one the form holds, none from a form tied to no drop. A send of the loot
 * that would leave `unreached` picked hunters without it (a player's, with no room) is refused whole (`unreached`), so
 * nothing is written and the loot waits: loot leaves only by being given or by the GM's Set aside (SMX-gates-1.1).
 */
export function sendDeals(draft: AwardDraft, unreached: number): { readonly deals: FightId | null } | Refused<'unreached'> {
  if (draft.at !== 'tied' || draft.tie.kind !== 'drop') return { deals: null };
  return unreached > 0 ? refuse('unreached') : { deals: draft.tie.fight };
}
/** The bundle a send from `draft` gives from the shelf, and to whom (held under Undo: held.ts), or null. */
export const sendGives = (draft: AwardDraft): Extract<DraftTie, { kind: 'shelf' }> | null => (draft.at === 'tied' && draft.tie.kind === 'shelf' ? draft.tie : null);
/** The waiting reward a send from `draft` approves in its write (hunter/pending.ts `pendingApproved`), or null. */
export const sendApproves = (draft: AwardDraft): EventId | null => (draft.at === 'tied' && draft.tie.kind === 'pending' ? draft.tie.id : null);
