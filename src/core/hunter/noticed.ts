// noticed.ts: the notice step (docs/agent-handoff/features/notes-1-feats.md section 4). Pure. The store runs `noticed`
// at the end of every `store.apply`, in the same write as the step (src/edge/store.ts), so a fact a step recorded
// (chronicle.ts `record`) is taken in the write of the thing it records: stamped with the write's moment, folded into the
// lifetime tally and kept when its kind is kept (facts.ts `KEPT`).
//
// A hunter a fight holds keeps its inbox until the fight lets it go: what a fact leads to may change what a fight holds
// (a reward's statuses), and the fight's next totals would write over it. A fact in the inbox is a machine of two states
// (`INBOX`), moved at the end of each write by whether a fight holds its hunter:
//   recorded --held--> waiting  (stamped with this write's moment: the moment it happened)
//   recorded --free--> taken    (with this write's stamp)
//   waiting  --held--> waiting  (as it was)
//   waiting  --free--> taken    (with the stamp of the write that frees it, as today: SMX-rules-9.1 waits on the day ruling)
// A taken fact is folded, kept and counted, oldest first. On a player's phone the GM's fight holds a hunter through the
// room's fight doc, which is not in the save: sync.ts runs one write when that doc lets a hunter with a waiting inbox go
// (`released`).
import type { Hunter, Quest, Save } from '../save.ts';
import type { DayKey } from '../day.ts';
import { sheetKeyOf } from '../ids.ts';
import type { HunterId, RoomCode } from '../ids.ts';
import type { Rules } from '../rules.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { CHRONICLE_MAX, tallyAfter } from './chronicle.ts';
import type { Chronicle, FeatState, InboxFact } from './chronicle.ts';
import { kept } from './facts.ts';
import type { Fact, FactStamp, Kept } from './facts.ts';
import { countStep, markOf, objectiveStep } from './counts.ts';
import type { Counted } from './counts.ts';
import { featStep, startOf, stateHolds } from './feats.ts';
import type { FeatBook, FeatDef, FeatEvent } from './feats.ts';
import { finishQuest, grant } from './grant.ts';
import { reportsProgress, systemCompletes } from './quest-rights.ts';
import { newEvent } from '../protocol.ts';
import { sent } from '../award.ts';
import { record } from './chronicle.ts';

/**
 * What the notice step reads besides the save: the write's moment (its time, today's day key, the session it belongs
 * to), whether a fight holds a hunter (asked of the save after the step), the rules a reward is given by, and the feats
 * that apply on this phone (feats.ts `featsFor`).
 */
export type NoticeCtx = {
  readonly at: string; readonly today: DayKey; readonly session: number; readonly held: (save: Save, hid: HunterId) => boolean;
  readonly R: Rules; readonly feats: FeatBook;
  /** The room this phone is a player in, where a quest the GM issued reports its end; null alone or on the GM's phone. */
  readonly room?: RoomCode | null;
};
/** A feat a write earned, for the window the view shows (and the level-up its reward may have given). */
export type Earned = { readonly hid: HunterId; readonly key: string };

const waiting = (save: Save): boolean => save.hunters.some(h => h.chronicle.inbox.length > 0);

/** A hunter's inbox between two writes: empty, or holding facts a fight keeps waiting (its chart: scripts/charts/feat.ts `inbox`). */
export const INBOX_STATES = ['empty', 'waiting'] as const;
export type InboxState = (typeof INBOX_STATES)[number];
/** Where a fact in the inbox is: recorded in this write, or stamped and waiting for a fight to let its hunter go. */
export type InboxAt = 'recorded' | 'waiting';
/** A fact stamped by the write it happened in is waiting; one recorded in this write has no stamp yet. */
const isWaiting = (f: InboxFact): f is Kept => 'at' in f;
type InboxRow<F extends InboxFact> = {
  /** The fact at the end of a write in which a fight holds its hunter: waiting, stamped. */
  readonly held: (f: F, now: FactStamp) => Kept;
  /** The stamp the fact is taken with at the end of a write in which no fight holds its hunter. */
  readonly free: (f: F, now: FactStamp) => FactStamp;
};
/** Every cell of a fact's life in the inbox: its state by the end of a write, held or free, with the write's stamp `now`. */
export const INBOX: { readonly [S in InboxAt]: InboxRow<S extends 'waiting' ? Kept : Fact> } = {
  recorded: {
    held: (f, now) => ({ ...f, ...now }),
    free: (_f, now) => now,
  },
  waiting: {
    held: f => f,
    // SMX-rules-9.1 waits on the owner's day ruling: today a waiting fact is taken with the write that frees it, so a fight
    // held over midnight counts its facts in the next day. The ruling "the day it happened" is
    // `f => ({ at: f.at, day: f.day, session: f.session })` here.
    free: (_f, now) => now,
  },
};
/** The stamp fact `f` is taken with in a write that frees its hunter (`INBOX`, the `free` column). */
const takenWith = (f: InboxFact, now: FactStamp): FactStamp => (isWaiting(f) ? INBOX.waiting.free(f, now) : INBOX.recorded.free(f, now));
/** A held hunter's inbox at the end of a write: each fact recorded in it stamped (`INBOX`, the `held` column); the same list when none was. */
function heldInbox(inbox: readonly InboxFact[], now: FactStamp): readonly InboxFact[] {
  const out = inbox.map(f => (isWaiting(f) ? INBOX.waiting.held(f, now) : INBOX.recorded.held(f, now)));
  return out.every((f, i) => f === inbox[i]) ? inbox : out;
}

/** The chronicle with fact `f` taken: folded into the tally and kept when its kind is kept, with `stamp`. */
function took(c: Chronicle, f: InboxFact, stamp: FactStamp): Chronicle {
  return { ...c, tally: tallyAfter(c.tally, f), facts: kept(f) ? [...c.facts, { ...f, ...stamp } as Kept].slice(-CHRONICLE_MAX) : c.facts };
}

/**
 * Hunter `hid`'s inbox taken, oldest first: each fact folded and kept with the stamp it is taken with (`INBOX`), then
 * counted by every feat (`countStep`, `featStep`). A feat earned is marked, told as a `feat` fact at the end of the
 * inbox, the feats shown after it are shown, and its reward is given (`grant`, which may tell a level or a title as
 * facts of their own). The loop takes those too; it ends, since each feat is earned once and a grant's facts are at
 * most a level and a title a feat.
 */
function noticeHunter(save: Save, hid: HunterId, c: NoticeCtx, now: FactStamp): Save {
  let s = save;
  const hunter = (): Hunter => s.hunters.find(h => h.id === hid)!;
  const put = (h: Hunter): void => { s = { ...s, hunters: s.hunters.map(x => (x.id === hid ? h : x)) }; };
  // each fact meets only the feats that count its kind (measured: 81 facts against 128 feats took 4.8 ms checked one by one)
  const byKind = new Map<string, (readonly [string, FeatDef])[]>();
  for (const e of c.feats) { const l = byKind.get(e[1].rule.on); if (l) l.push(e); else byKind.set(e[1].rule.on, [e]); }
  for (let h = hunter(); h.chronicle.inbox.length; h = hunter()) {
    const [f, ...rest] = h.chronicle.inbox as [InboxFact, ...InboxFact[]];
    const stamp = takenWith(f, now);
    const ch: Chronicle = took({ ...h.chronicle, inbox: rest }, f, stamp);
    const earned: (readonly [string, FeatDef])[] = [];
    let feats: Record<string, FeatState> | null = null;
    for (const [key, def] of byKind.get(f.kind) ?? []) {
      const was = (feats ?? ch.feats)[key] ?? startOf(def);
      if (was.at === 'earned') continue;
      const from: Counted = { n: was.n, mark: was.mark, ...(was.vals ? { vals: was.vals } : {}) };
      const move = countStep(from, f, def.rule, markOf(def.rule.within, stamp, ch.tally.longRests));
      if (!move) continue;
      const also = (): boolean => def.rule.also.every(t => stateHolds(t, { ...h, chronicle: ch }));
      const ev: FeatEvent = move.to === 'broke' ? { type: 'broke', count: move.count } : move.to === 'moved' ? { type: 'counted', count: move.count, also: also() } : { type: 'again', count: from, also: also() };
      const st = featStep(was, ev, def, stamp);
      if (!st) continue;
      feats ??= { ...ch.feats };
      feats[key] = st.state;
      if (st.fx === 'earned') earned.push([key, def]);
    }
    put({ ...h, chronicle: feats ? { ...ch, feats } : ch });
    s = countQuests(s, hid, f, stamp, c);
    for (const [key, def] of earned) {
      // the feats shown once this one is earned
      const now = hunter();
      let feats = now.chronicle.feats;
      for (const [k, d] of c.feats) {
        if (d.show.at !== 'feat' || d.show.key !== key) continue;
        const st = featStep(feats[k] ?? startOf(d), { type: 'unlocked' }, d, stamp);
        if (st) feats = { ...feats, [k]: st.state };
      }
      put(record({ ...now, chronicle: { ...now.chronicle, feats } }, { kind: 'feat', key, name: def.name, hidden: def.show.at === 'never' }));
      const g = grant(s, hid, def.rewards, null, { at: c.at, today: c.today, R: c.R, vitals: 'sheet' });
      if (!isRefused(g)) s = g.save;
    }
  }
  return s;
}

/** A fraction made from a quest's id, so the same quest's end is the same room event however often it is posted. */
function idShare(id: string): number {
  let x = 2166136261;
  for (let i = 0; i < id.length; i++) x = Math.imul(x ^ id.charCodeAt(i), 16777619) >>> 0;
  return x / 2 ** 32;
}
/** The end of quest `q` of hunter `hid` posted to the GM in this write (`questUpdate`), as quests.js posts a tapped one, under the same key. */
function reported(save: Save, hid: HunterId, q: Quest, c: NoticeCtx & { room: RoomCode }): Save {
  const h = save.hunters.find(x => x.id === hid), device = save.settings.deviceId;
  if (!h) return save;
  const event = newEvent('questUpdate', {
    by: sheetKeyOf(device, hid), name: h.name, questId: q.id, title: q.title, kind: q.kind, status: 'done',
    objectives: q.objectives.map(o => ({ label: o.label, progress: o.target, target: o.target })),
  }, { device, now: Date.parse(c.at), rand: idShare(q.id) });
  return event ? sent(save, { room: c.room, events: [{ key: `quest ${hid} ${q.id}`, event }], said: [] }, { at: c.at, cap: c.R.logCap }) : save;
}
/**
 * Fact `f` counted by hunter `hid`'s active quests (feature 1's notes 17.14): each counted objective not yet full moves
 * (`objectiveStep`), and a quest the System completes (`systemCompletes`) whose objectives are all full is completed
 * through `finishQuest` in this write, its end reported when the GM issued it and this phone is a player in a room.
 */
function countQuests(save: Save, hid: HunterId, f: Fact, stamp: FactStamp, c: NoticeCtx): Save {
  const h = save.hunters.find(x => x.id === hid);
  if (!h || !h.quests.some(q => q.status === 'active' && systemCompletes(q))) return save;
  let moved = false;
  const quests = h.quests.map(q => {
    if (q.status !== 'active') return q;
    let changed = false;
    const objectives = q.objectives.map(o => {
      if (!o.count) return o;
      const r = objectiveStep({ target: o.target, progress: o.progress, count: o.count }, f, markOf(o.count.rule.within, stamp, h.chronicle.tally.longRests));
      if (!r) return o;
      changed = true;
      return { ...o, progress: r.progress, count: r.count };
    });
    if (!changed) return q;
    moved = true;
    return { ...q, objectives };
  });
  if (!moved) return save;
  let s: Save = { ...save, hunters: save.hunters.map(x => (x.id === hid ? { ...x, quests } : x)) };
  for (const q of quests) {
    if (q.status !== 'active' || !systemCompletes(q) || !q.objectives.every(o => o.progress >= o.target)) continue;
    const done = finishQuest(s, hid, q.id, { at: c.at, today: c.today, R: c.R, vitals: 'sheet' });
    if (isRefused(done)) continue;
    s = done.save;
    if (c.room && reportsProgress(q, 'player')) s = reported(s, hid, q, { ...c, room: c.room });
  }
  return s;
}

/**
 * The save at the end of a write, each inbox fact moved by `INBOX` with the moment `ctx` answers: every inbox of a hunter
 * no fight holds taken (`noticeHunter`), and the facts this write recorded for a held hunter stamped to wait.
 * A save whose inboxes are all empty is answered as it is, after a length check of each and nothing else: the context
 * is asked for only when a fact waits, so a write that recorded nothing costs one look at each hunter.
 */
export function noticed(save: Save, ctx: () => NoticeCtx): Save {
  if (!waiting(save)) return save;
  const c = ctx(), now: FactStamp = { at: c.at, day: c.today, session: c.session };
  let s = save;
  for (const h of save.hunters) {
    if (!h.chronicle.inbox.length) continue;
    if (!c.held(save, h.id)) { s = noticeHunter(s, h.id, c, now); continue; }
    const inbox = heldInbox(h.chronicle.inbox, now);
    if (inbox !== h.chronicle.inbox) s = { ...s, hunters: s.hunters.map(x => (x.id === h.id ? { ...x, chronicle: { ...x.chronicle, inbox } } : x)) };
  }
  return s;
}

/** The feats a write earned: each hunter's feats earned after the write that were not before it. */
export function earnedIn(before: Save, after: Save): Earned[] {
  return after.hunters.flatMap(h => {
    const was = before.hunters.find(x => x.id === h.id)?.chronicle.feats ?? {};
    return Object.entries(h.chronicle.feats).filter(([k, st]) => st.at === 'earned' && was[k]?.at !== 'earned').map(([key]) => ({ hid: h.id, key }));
  });
}

/**
 * The release write's step (sync.ts, when the room's fight doc lets a hunter go): the save as it is when a hunter no
 * fight holds has a waiting inbox, for the store's `noticed` to take; else refused, so a repeat writes nothing.
 */
export function released(save: Save, held: (save: Save, hid: HunterId) => boolean): Save | Refused<'unchanged'> {
  return save.hunters.some(h => h.chronicle.inbox.length > 0 && !held(save, h.id)) ? save : refuse('unchanged');
}
