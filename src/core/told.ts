// told.ts: what this phone has told its player of the campaign it holds, in one record (SMX-gates-8): the feats a
// hunter earned, the personal gates that appeared to a hunter, and a room's gates that appeared or broke. A quest's
// "told" is the quest's own (hunter/quests.ts `questTold`). src/edge/store.ts keeps the record on the phone (never in
// the save, a backup or a room); its one writer is `store.tell` with an event of this module. Pure.
//
// The record belongs to one campaign. The store starts a new one (`replaced`, under a new `campaign` token) as the
// phone first opens a campaign and whenever a reset, an import or a restore replaces it, so nothing told in one
// campaign silences the next (SMX-gates-8.1), and an answer to a window asked in the campaign before is dropped. A new
// record takes what the campaign arrived with as told (each hunter's earned feats and open personal gates), so a
// campaign opened replays nothing; a hunter added later has all its news told. A room is first seen when its world
// doc is first looked at (`looked`): its gates then count as told, so joining replays nothing. Every untold piece is
// news at once, oldest first; the System windows show them one at a time (windows.ts), so none waits for a later look
// (SMX-gates-8.2). A record the phone could not keep (no campaign) tells nothing, so blocked storage never asks again and again.
import type { ShownGate } from './gates/gate.ts';
import type { Hunter } from './hunter/hunter.ts';
import { FEAT_STATES_MAX } from './hunter/chronicle.ts';
import { featNews } from './hunter/feats.ts';

/** Where a piece of news is told: a hunter's feats (by key), a hunter's personal gates (by id), a room's gates (by id). */
export type ToldTopic =
  | { readonly of: 'feat' | 'personal'; readonly hunter: string }
  | { readonly of: 'room'; readonly room: string };
/** A room's gates told: those told as appeared (a gate told as broken is in both), and those told as broken. */
export type ToldRoom = { readonly ids: readonly string[]; readonly broken: readonly string[] };
/**
 * The campaign's told memory. `campaign`: which campaign it is (a random token the store gives each new one; '' for a
 * record the phone could not keep). `feat` and `personal`: the ids told, by hunter id. `room`: the rooms seen, by code.
 */
export type ToldMemory = {
  readonly campaign: string;
  readonly feat: Readonly<Record<string, readonly string[]>>;
  readonly personal: Readonly<Record<string, readonly string[]>>;
  readonly room: Readonly<Record<string, ToldRoom>>;
};
/**
 * At most this many ids are kept in a topic, newest last: as many as a chronicle holds feats, so a told feat is never
 * dropped and told again. At most this many topics (hunters, rooms) in a section, the newest kept.
 */
export const TOLD_MAX = FEAT_STATES_MAX, TOLD_TOPICS = 50;

/** What a hunter holds of its news: the parts of a hunter the record reads. */
export type ToldHunter = Pick<Hunter, 'id' | 'chronicle' | 'solo'>;
/** One piece of a room's gate news: a gate appeared, or a gate broke. */
export type ToldGateNews = { readonly kind: 'appeared' | 'broke'; readonly gate: ShownGate };
/**
 * What moves the record. `replaced`: a campaign was opened or replaced; the record starts again as campaign `campaign`,
 * with what its `hunters` hold told. `looked`: a player's phone looked at room `room`'s `gates`; at a first sight they
 * are told. `answered`: the window of `id` in `topic` was answered in campaign `campaign` (`broke`: a room gate's break).
 */
export type ToldEvent =
  | { readonly type: 'replaced'; readonly campaign: string; readonly hunters: readonly ToldHunter[] }
  | { readonly type: 'looked'; readonly room: string; readonly gates: readonly ShownGate[] }
  | { readonly type: 'answered'; readonly campaign: string; readonly topic: ToldTopic; readonly id: string; readonly broke?: boolean };

/** Where one piece of news stands: its room never seen, not told, or told. A hunter's piece is never unseen. */
export type ToldAt = 'unseen' | 'untold' | 'told';
export const TOLD_STATES = ['unseen', 'untold', 'told'] as const satisfies readonly ToldAt[];

/** A record of no campaign: what the store reads when the phone kept none. It tells nothing. */
export const NO_TOLD: ToldMemory = { campaign: '', feat: {}, personal: {}, room: {} };

const kept = (list: readonly string[], id: string): string[] => [...list.filter(x => x !== id), id].slice(-TOLD_MAX);
/** `section` with `key` set to `value`, the newest topic last and at most `TOLD_TOPICS` kept. */
function put<V>(section: Readonly<Record<string, V>>, key: string, value: V): Record<string, V> {
  const rest = Object.entries(section).filter(([k]) => k !== key);
  return Object.fromEntries([...rest, [key, value] as const].slice(-TOLD_TOPICS));
}
/** The pieces of news a hunter holds now: its earned feats oldest first (feats.ts `featNews`), or its open personal gates in their order. */
const heldBy = (h: ToldHunter, of: 'feat' | 'personal'): string[] => (of === 'feat' ? featNews(h.chronicle.feats, []) : h.solo.gates.map(g => g.id));

/** Where `id` of `topic` stands in `m`. In a room, a gate stands as told when told as appeared. */
export function toldAt(m: ToldMemory, topic: ToldTopic, id: string): ToldAt {
  if (topic.of !== 'room') return (m[topic.of][topic.hunter] ?? []).includes(id) ? 'told' : 'untold';
  const r = m.room[topic.room];
  return !r ? 'unseen' : r.ids.includes(id) ? 'told' : 'untold';
}

/**
 * The record after `e`. A replace starts a new record with what the campaign's hunters hold told. A first look at a
 * room tells its gates (a broken one as broken too); a later look changes nothing. An answer in the record's campaign
 * tells its piece (a room gate's break tells it as appeared too); an answer from another campaign changes nothing. The
 * same record when nothing changed.
 */
export function toldStep(m: ToldMemory, e: ToldEvent): ToldMemory {
  if (e.type === 'replaced') {
    const of = (k: 'feat' | 'personal') => Object.fromEntries(e.hunters.slice(-TOLD_TOPICS).map(h => [h.id, heldBy(h, k).slice(-TOLD_MAX)] as const));
    return { campaign: e.campaign, feat: of('feat'), personal: of('personal'), room: {} };
  }
  if (e.type === 'looked') {
    if (m.room[e.room]) return m;
    const ids = e.gates.map(g => g.id).slice(-TOLD_MAX), broken = e.gates.filter(g => g.status === 'broken').map(g => g.id).slice(-TOLD_MAX);
    return { ...m, room: put(m.room, e.room, { ids, broken }) };
  }
  const t = e.topic;
  if (e.campaign !== m.campaign) return m;
  if (t.of !== 'room') return toldAt(m, t, e.id) === 'told' ? m : { ...m, [t.of]: put(m[t.of], t.hunter, kept(m[t.of][t.hunter] ?? [], e.id)) };
  const was = m.room[t.room] ?? { ids: [], broken: [] };
  if (was.ids.includes(e.id) && (!e.broke || was.broken.includes(e.id))) return m;
  return { ...m, room: put(m.room, t.room, { ids: kept(was.ids, e.id), broken: e.broke ? kept(was.broken, e.id) : was.broken }) };
}

/** The record a campaign opens with: campaign `campaign`, what `hunters` hold told. */
export const toldFor = (campaign: string, hunters: readonly ToldHunter[]): ToldMemory => toldStep(NO_TOLD, { type: 'replaced', campaign, hunters });

/** Hunter `h`'s news of `of` not told yet, oldest first (its earned feat keys, its open personal gate ids); none in a record of no campaign. */
export function hunterNews(m: ToldMemory, h: ToldHunter, of: 'feat' | 'personal'): string[] {
  if (!m.campaign) return [];
  const told = m[of][h.id] ?? [];
  return heldBy(h, of).filter(id => !told.includes(id));
}

/**
 * A room's gate news on a player's phone (`gates` as the room's world doc shows them): each gate not told as appeared
 * and not broken, then each broken gate not told as broken, all of them. None before the room's first look.
 */
export function gateNews(m: ToldMemory, room: string, gates: readonly ShownGate[]): ToldGateNews[] {
  const told = m.room[room];
  if (!told || !m.campaign) return [];
  const appeared = gates.filter(g => g.status !== 'broken' && !told.ids.includes(g.id)).map((gate): ToldGateNews => ({ kind: 'appeared', gate }));
  const broke = gates.filter(g => g.status === 'broken' && !told.broken.includes(g.id)).map((gate): ToldGateNews => ({ kind: 'broke', gate }));
  return [...appeared, ...broke];
}

/** The answer of a room gate's window: told as appeared, and as broken when it broke. */
export const gateTold = (campaign: string, room: string, n: ToldGateNews): Extract<ToldEvent, { type: 'answered' }> =>
  ({ type: 'answered', campaign, topic: { of: 'room', room }, id: n.gate.id, broke: n.kind === 'broke' });

// ── the boundary: the record as the store reads it back ──
type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const ids = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 80).slice(-TOLD_MAX) : null);
function section<V>(v: unknown, read: (x: unknown) => V | null): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [k, x] of Object.entries(isObj(v) ? v : {}).slice(-TOLD_TOPICS)) { const r = read(x); if (r && k.length <= 80) out[k] = r; }
  return out;
}
const roomOf = (v: unknown): ToldRoom | null => {
  const o = isObj(v) ? v : {}, a = ids(o.ids), b = ids(o.broken);
  return a && b ? { ids: a, broken: b } : null;
};
/** The stored record, bounded, or null when it is none (no campaign): the store then starts one. */
export function parseTold(v: unknown): ToldMemory | null {
  if (!isObj(v) || typeof v.campaign !== 'string' || !v.campaign || v.campaign.length > 80) return null;
  return { campaign: v.campaign, feat: section(v.feat, ids), personal: section(v.personal, ids), room: section(v.room, roomOf) };
}
