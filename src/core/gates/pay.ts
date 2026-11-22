// pay.ts: what a fight's end and a gate's Clear pay, each in one step on the save. Pure.
//
// Before, each was a run of writes in a view (combat.js `endEncounter`, gates.js `clearGate`): the gate paid and the log
// written, then each player's award sent once, then each hunter on this phone given its XP in a write of its own, then
// the fight cleared. A reload or a throw between them left the gate paid and nobody given anything, and a player offline
// at that moment never got the XP. Now the gate's payment, the log line, every hunter's grant on this phone, every
// player's award (put in the outbox, src/core/sync/outbox.ts, which sends it until the room takes it) and the fight's
// clear are one answer, written by one `store.apply` or not at all. A settled fight is gone from the save, so a second
// settle of it is refused (`no-fight`).
import { reduce } from '../combat/fight.ts';
import { rankSeen } from '../combat/fight-facts.ts';
import type { Ctx, Ended, Fight, FightId } from '../combat/fight-types.ts';
import type { CombatantId } from '../combat/ability-types.ts';
import { grant, noteFacts } from '../hunter/grant.ts';
import type { Day, Granted } from '../hunter/grant.ts';
import { newRewards } from '../rewards.ts';
import type { Rewards } from '../rewards.ts';
import { newEvent, parseSheetKey } from '../protocol.ts';
import type { EventBody, EventStamp, RoomCode, RoomEvent, SheetKey } from '../protocol.ts';
import type { Dropped, FightLoot, Save } from '../save.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { atOutbox, post } from '../sync/outbox.ts';
import { fightAward, xpDue } from './gate.ts';
import type { XpOf } from './gate.ts';
import { clearGate, encounterEnded } from './world.ts';
import { rankIdx } from '../rules.ts';
import type { Rank, Rules } from '../rules.ts';
import type { Fact } from '../hunter/facts.ts';
import type { Gate } from './gate.ts';
import type { ClearPay } from './world.ts';

/**
 * Each payee's share of what a world gate pays (its gold roll, its XP) among `n` payees, the gate made for `party`
 * hunters (`RULES.gateParty`, design 4.1): a pot of `party` times `amount`, shrunk by party / n past the party, split
 * evenly and rounded down. So the party takes `amount` each, fewer take more, and a crowd takes less in total. None for nobody.
 */
export const shareEach = (amount: number, n: number, party: number): number =>
  n <= 0 ? 0 : Math.floor(n <= party ? amount * party / n : amount * party * party / (n * n));
/** What each of `n` payees takes of a Clear's gold roll at rank `rank`: the share of the rank's lowest and highest roll. */
export function clearGoldEach(R: Pick<Rules, 'loot' | 'gateParty'>, rank: Rank, n: number): { readonly low: number; readonly high: number } {
  const [lo = 0, hi = lo] = (R.loot[rank] ?? R.loot.E).gold;
  return { low: shareEach(lo, n, R.gateParty), high: shareEach(hi, n, R.gateParty) };
}

/** Who a share goes to: a hunter on this phone, or a player's hunter in the room (its sheet key). */
export type Payee = { readonly kind: 'local'; readonly hid: string; readonly name: string } | { readonly kind: 'remote'; readonly key: SheetKey; readonly name: string };

// ── a fight's end ──
/** What the end of a fight pays, worked out from the ended fight before the GM chooses. */
export type EncounterPlan = {
  readonly fightId: Ended['id'];
  readonly gateId: string | null;
  /**
   * The fight's XP, what it pays of its gate's XP (nothing once its gate paid all), whether the gate covered it, whether
   * the award is a world gate's pot shared among the payees (`shareEach`) or paid whole to each (a fight from no gate),
   * and each payee's share.
   */
  readonly xp: number; readonly award: number; readonly covered: boolean; readonly shared: boolean; readonly each: number;
  readonly payees: readonly Payee[];
  /** The foes that went down, with their XP. */
  readonly dead: readonly { readonly id: CombatantId; readonly name: string; readonly xp: number }[];
  readonly rounds: number;
};
/**
 * The plan of fight `f` once it is over (`f` as it is, or as `end` would leave it): the gate it came from, its award by
 * `fightAward` (gate.ts), the payees (its local hunters still on this phone, then its players' hunters) and the share:
 * of a fight from a gate, its award shared as the gate's pot among the payees, the gate made for `party`; of a fight
 * from no gate (the GM's own scene, sized for the hunters at the table), the whole award to each.
 */
export function planEncounter(f: Ended, gateId: string | null, save: Pick<Save, 'gates' | 'hunters'>, party: number, xpOf: XpOf): EncounterPlan {
  const gate = (gateId && save.gates.find(g => g.id === gateId)) || null;
  const locals = [...new Set(f.rows.flatMap(r => (r.holder?.kind === 'local' ? [r.holder.hunterId as string] : [])))]
    .flatMap((hid): Payee[] => { const h = save.hunters.find(x => x.id === hid); return h ? [{ kind: 'local', hid, name: h.name }] : []; });
  const remotes = f.rows.flatMap((r): Payee[] => { const key = r.holder?.kind === 'remote' ? parseSheetKey(r.holder.remote) : null; return key ? [{ kind: 'remote', key, name: r.name }] : []; });
  const payees = [...locals, ...remotes], award = fightAward(gate, f.summary.xp, xpOf), n = payees.length;
  return {
    fightId: f.id, gateId, xp: f.summary.xp, award, covered: award < f.summary.xp, shared: gate !== null,
    each: gate ? shareEach(award, n, party) : n > 0 ? award : 0, payees,
    dead: f.rows.filter(r => r.side === 'foe' && f.summary.down.includes(r.id)).map(r => ({ id: r.id, name: r.name, xp: r.xp })), rounds: f.summary.rounds,
  };
}
/** Whether the GM's choice pays: Award XP with a share over 0. */
export const pays = (plan: EncounterPlan, choice: 'award' | 'skip'): boolean => choice === 'award' && plan.each > 0;
/** The players' awards a plan sends, as the bodies of the room's `award` (the view makes each an event with its id). */
export const encounterAwards = (plan: EncounterPlan, choice: 'award' | 'skip'): EventBody<'award'>[] =>
  pays(plan, choice) ? plan.payees.flatMap(p => (p.kind === 'remote' ? [{ to: [p.key], rewards: { ...newRewards(), xp: plan.each } }] : [])) : [];

/** Where a settle step posts its players' awards, and the events it posts (made by the view from `encounterAwards`). */
export type Posts = { readonly room: RoomCode | null; readonly events: readonly RoomEvent[] };
/** What a settle did: the next save and each local hunter's grant (the view shows them with `hunter.granted`). */
export type Settled = { readonly save: Save; readonly granted: readonly { readonly hid: string; readonly g: Granted }[] };

/** The local payees given `rewardsOf`, then the posts put in the outbox: one save. */
function payAll(save: Save, locals: readonly { hid: string; rewards: Rewards }[], posts: Posts, day: Day): Settled {
  let s = save;
  const granted: { hid: string; g: Granted }[] = [];
  for (const { hid, rewards } of locals) {
    const g = grant(s, hid, rewards, null, { ...day, vitals: 'sheet' });
    if (isRefused(g)) continue;
    s = g.save; granted.push({ hid, g });
  }
  const room = posts.room;
  if (room) s = atOutbox(b => posts.events.reduce((box, ev) => post(box, room, { kind: 'event', event: ev }).box, b))(s);
  return { save: s, granted };
}

/**
 * The end of fight `plan.fightId`, as the GM chose: its gate paid what it awards (`encounterEnded`, with its log line)
 * and told who fought it (`fought`), each local hunter given its share, each player's award posted, the fight cleared
 * with what it came from, and what its monsters dropped (`drop`) added to the loot waiting, in one step. Refused when
 * the save's fight is not that fight, ended (`no-fight`): it was settled already, or it is still on.
 */
export function settleEncounter(save: Save, plan: EncounterPlan, choice: 'award' | 'skip', posts: Posts, day: Day, drop: Omit<Dropped, 'fight'>): Settled | Refused<'no-fight'> {
  const f: Fight | null = save.fight ?? null;
  if (!f || f.id !== plan.fightId || f.phase !== 'ended') return refuse('no-fight');
  const paid = pays(plan, choice);
  const text = `${plan.dead.length} defeated, ${plan.xp} XP.${choice === 'award' ? ` Awarded ${plan.each} XP each.` : ''}`;
  const logged = encounterEnded(save, { gateId: plan.gateId, paid: paid ? plan.award : 0, text }, { at: day.at, cap: day.R.logCap });
  // who fought it stays on the gate, so its Clear offers them first after a reload too
  const fought = plan.payees.map(p => (p.kind === 'local' ? p.hid : p.key));
  const ended = { ...logged, gates: logged.gates.map(g => (g.id === plan.gateId ? { ...g, fought } : g)) };
  const locals = paid ? plan.payees.flatMap(p => (p.kind === 'local' ? [{ hid: p.hid, rewards: { ...newRewards(), xp: plan.each } }] : [])) : [];
  const out = payAll(ended, locals, paid ? posts : { room: null, events: [] }, day);
  const ctx: Ctx = { rules: day.R };
  // what the fight dropped waits on the save after the drops before it until the GM gives it or sets it aside
  const loot = drop.gold || drop.items.length ? lootStep(out.save.loot, { type: 'dropped', drop: { fight: plan.fightId, ...drop } }) ?? out.save.loot : out.save.loot;
  const cleared = { ...out.save, fight: reduce(out.save.fight, { type: 'clear' }, ctx).fight, loot };
  delete cleared.fightRefs;
  return { save: cleared, granted: out.granted };
}

// ── a fight's loot waiting for the GM ──
// Before, `Save.dropped` held one drop: the next fight's settle wrote its own over it (or null), so loot put off with
// Later was lost (SMX-gates-1.3). Now the loot is a list, added to by each settle and taken from one drop at a time.
export const LOOT_STATES = ['none', 'waiting'] as const;
export const LOOT_EVENTS = ['dropped', 'dealt'] as const;
/** A fight's settle dropped `drop` (one that holds something); the GM dealt with the drop of `fight` (gave it in the Award form's send, or set it aside). */
export type LootEvent = { readonly type: 'dropped'; readonly drop: Dropped } | { readonly type: 'dealt'; readonly fight: FightId };
type LootFn<E extends LootEvent['type']> = (l: FightLoot, e: Extract<LootEvent, { type: E }>) => FightLoot | null;
const dropsOf = (l: FightLoot): readonly Dropped[] => (l.at === 'waiting' ? l.drops : []);
/** The loot with `drops`, oldest first: waiting, or none when the list is empty. */
const lootWith = (drops: readonly Dropped[]): FightLoot => { const [first, ...rest] = drops; return first ? { at: 'waiting', drops: [first, ...rest] } : { at: 'none' }; };
/** Every state against every event; null: refused, nothing changes. A fight drops once, and a drop is dealt with once. */
const LOOT_TABLE: { readonly [S in FightLoot['at']]: { readonly [E in LootEvent['type']]: LootFn<E> | null } } = {
  none: { dropped: (_l, e) => lootWith([e.drop]), dealt: null },
  waiting: {
    dropped: (l, e) => (dropsOf(l).some(d => d.fight === e.drop.fight) ? null : lootWith([...dropsOf(l), e.drop])),
    dealt: (l, e) => (dropsOf(l).some(d => d.fight === e.fight) ? lootWith(dropsOf(l).filter(d => d.fight !== e.fight)) : null),
  },
};
/** `l` after `e`, or null where the table refuses it. */
export function lootStep(l: FightLoot, e: LootEvent): FightLoot | null {
  const step = LOOT_TABLE[l.at][e.type] as LootFn<LootEvent['type']> | null;
  return step ? step(l, e) : null;
}
/** The drop of fight `fight` dealt with: given in the Award form's send, or set aside by the GM. Refused (`no-drop`) when it is not waiting. */
export function dropDealt(save: Save, fight: FightId): Save | Refused<'no-drop'> {
  const loot = lootStep(save.loot, { type: 'dealt', fight });
  return loot ? { ...save, loot } : refuse('no-drop');
}
/** What a refused deal says: the drop was given or set aside already (another tab, a stale window). */
export const LOOT_WORDS: { readonly 'no-drop': string } = { 'no-drop': 'That loot was given or set aside already.' };
/** The drop of fight `fight` while it waits; null once it was dealt with. */
export const dropWaiting = (l: FightLoot, fight: FightId): Dropped | null => (l.at === 'waiting' ? l.drops.find(d => d.fight === fight) ?? null : null);
/** The drop the Loot dropped window offers: the oldest waiting. Null when none waits. */
export const lootOffered = (l: FightLoot): Dropped | null => (l.at === 'waiting' ? l.drops[0] : null);
/** A drop in one line: "50 gold, Frost Shard ×2"; '' for nothing. `fmt` writes a number as the screen does. */
export const dropLine = (d: Pick<Dropped, 'gold' | 'items'>, fmt: (n: number) => string): string =>
  [d.gold ? `${fmt(d.gold)} gold` : '', ...d.items.map(i => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}`)].filter(Boolean).join(', ');

// ── a gate's Clear ──
/** What one payee of a Clear gets: its share of the XP and the gold, and the gate's items to the one taker. */
export type ClearShare<I> = { readonly payee: Payee; readonly xp: number; readonly gold: number; readonly items: readonly I[] };
/**
 * The shares of a Clear: the gate's XP still due (`due`, what the gate owes and then counts as paid) and the rolled gold,
 * each the gate's pot shared among the payees (`shareEach`, the gate made for `party`); the items to the payee picked
 * (`taker`), else the first.
 */
export function clearShares<I>(save: Pick<Save, 'gates'>, gateId: string, xpOf: XpOf, gold: number, items: readonly I[], payees: readonly Payee[], taker: string | null, party: number): { due: number; shares: ClearShare<I>[] } | null {
  const gate = save.gates.find(g => g.id === gateId); if (!gate) return null;
  const due = xpDue(gate, xpOf), n = payees.length;
  const idOf = (p: Payee) => (p.kind === 'local' ? p.hid : p.key), first = payees.find(p => idOf(p) === taker) ?? payees[0] ?? null;
  return { due, shares: payees.map(p => ({ payee: p, xp: shareEach(due, n, party), gold: shareEach(gold, n, party), items: first && idOf(first) === idOf(p) ? items : [] })) };
}
/**
 * The fact of gate `g` cleared by a hunter of rank `rank`, `toBreak` days before it would have broken (null for a
 * personal gate, which closes and never breaks). `rank` is null for a player's hunter whose sheet is not on the GM's
 * phone (fight-facts.ts `rankSeen`). The one constructor of a `gate` fact, whatever cleared the gate.
 */
export const gateFact = (g: Pick<Gate, 'name' | 'rank'>, rank: Rank | null, toBreak: number | null): Fact =>
  ({ kind: 'gate', name: g.name, rank: g.rank, above: rankIdx(g.rank) - rankIdx(rankSeen(rank)), toBreak });
/**
 * A player's hunter a Clear paid: its sheet key, its rank as this phone sees it (null: no pushed sheet), and the message
 * that pays it (an `award` from the Clear panel, the `soloAnswer` of its run).
 */
export type ClearPlayer = { readonly key: SheetKey; readonly rank: Rank | null; readonly pays: RoomEvent };
/** The room a Clear posts in: its code, the stamp its `noted` messages are made with, and the players' hunters it paid. */
export type ClearRoom = { readonly code: RoomCode; readonly stamp: EventStamp; readonly players: readonly ClearPlayer[] };
/**
 * Gate `gateId` cleared, in one step, whatever cleared it (the GM's Clear, a solo run on this phone or a player's in the
 * room): the gate paid what it owed and logged (`clearGate`, world.ts), each local payee given `rewards` (the view reads
 * its share with `parseRewards`) and its `gate` fact, with everything back (`noteFacts`); each player's hunter in `room` its message that pays it,
 * and its `gate` fact in a `noted` after it. A caller cannot pay a hunter without its fact. Refused as `clearGate` is.
 */
export function settleClear(save: Save, gateId: string, pay: ClearPay, locals: readonly { hid: string; rewards: Rewards }[], room: ClearRoom | null, day: Day): Settled | Refused<'missing' | 'unchanged'> {
  const g = save.gates.find(x => x.id === gateId);
  if (!g) return refuse('missing');
  const cleared = clearGate(save, gateId, pay, { at: day.at, cap: day.R.logCap });
  if (isRefused(cleared)) return cleared;
  const fact = (rank: Rank | null) => gateFact(g, rank, Math.max(0, g.breakDay - save.world.day)), paid = new Set(locals.map(l => l.hid));
  // a payee's Clear gives it everything back with its fact (grant.ts `noteFacts`); a player's, where its `noted` lands
  const facts = { ...cleared, hunters: cleared.hunters.map(h => (paid.has(h.id) ? noteFacts(h, [fact(h.rank)], day.R) : h)) };
  const events = !room ? [] : room.players.flatMap((p, i) => {
    const noted = newEvent('noted', { to: [p.key], facts: [fact(p.rank)] }, { ...room.stamp, now: room.stamp.now + i });
    if (!noted) throw new Error('the room would refuse the fact of a gate the save holds');
    return [p.pays, noted];
  });
  return payAll(facts, locals, { room: room ? room.code : null, events }, day);
}
