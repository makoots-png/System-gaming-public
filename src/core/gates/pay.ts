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
import type { Ctx, Ended, Fight } from '../combat/fight-types.ts';
import type { CombatantId } from '../combat/ability-types.ts';
import { grant } from '../hunter/grant.ts';
import type { Day, Granted } from '../hunter/grant.ts';
import { newRewards } from '../rewards.ts';
import type { Rewards } from '../rewards.ts';
import { parseSheetKey } from '../protocol.ts';
import type { EventBody, RoomCode, RoomEvent, SheetKey } from '../protocol.ts';
import type { Dropped, Save } from '../save.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { atOutbox, post } from '../sync/outbox.ts';
import { fightAward, xpDue } from './gate.ts';
import type { XpOf } from './gate.ts';
import { clearGate, encounterEnded } from './world.ts';
import { record } from '../hunter/chronicle.ts';
import { rankIdx } from '../rules.ts';
import type { Rank } from '../rules.ts';
import type { Fact } from '../hunter/facts.ts';
import type { Gate } from './gate.ts';
import type { ClearPay } from './world.ts';

/** An award over `n` payees: each gets `total` split evenly and rounded down when the rules split, else all of it. None for nobody. */
export const splitAward = (total: number, n: number, split: boolean): number => (n <= 0 ? 0 : split ? Math.floor(total / n) : total);

/** Who a share goes to: a hunter on this phone, or a player's hunter in the room (its sheet key). */
export type Payee = { readonly kind: 'local'; readonly hid: string; readonly name: string } | { readonly kind: 'remote'; readonly key: SheetKey; readonly name: string };

// ── a fight's end ──
/** What the end of a fight pays, worked out from the ended fight before the GM chooses. */
export type EncounterPlan = {
  readonly fightId: Ended['id'];
  readonly gateId: string | null;
  /** The fight's XP, what it pays (nothing once its gate paid all), whether the gate covered it, and each payee's share. */
  readonly xp: number; readonly award: number; readonly covered: boolean; readonly each: number;
  readonly payees: readonly Payee[];
  /** The foes that went down, with their XP. */
  readonly dead: readonly { readonly id: CombatantId; readonly name: string; readonly xp: number }[];
  readonly rounds: number;
};
/**
 * The plan of fight `f` once it is over (`f` as it is, or as `end` would leave it): the gate it came from, its award by
 * `fightAward` (gate.ts), the payees (its local hunters still on this phone, then its players' hunters) and the share.
 */
export function planEncounter(f: Ended, gateId: string | null, save: Pick<Save, 'gates' | 'hunters'>, split: boolean, xpOf: XpOf): EncounterPlan {
  const gate = (gateId && save.gates.find(g => g.id === gateId)) || null;
  const locals = [...new Set(f.rows.flatMap(r => (r.holder?.kind === 'local' ? [r.holder.hunterId as string] : [])))]
    .flatMap((hid): Payee[] => { const h = save.hunters.find(x => x.id === hid); return h ? [{ kind: 'local', hid, name: h.name }] : []; });
  const remotes = f.rows.flatMap((r): Payee[] => { const key = r.holder?.kind === 'remote' ? parseSheetKey(r.holder.remote) : null; return key ? [{ kind: 'remote', key, name: r.name }] : []; });
  const payees = [...locals, ...remotes], award = fightAward(gate, f.summary.xp, xpOf);
  return {
    fightId: f.id, gateId, xp: f.summary.xp, award, covered: award < f.summary.xp, each: splitAward(award, payees.length, split), payees,
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
 * and told who fought it (`fought`), each local hunter given its share, each player's award posted, and the fight cleared with what it came from, in one
 * step. Refused when the save's fight is not that fight, ended (`no-fight`): it was settled already, or it is still on.
 */
export function settleEncounter(save: Save, plan: EncounterPlan, choice: 'award' | 'skip', posts: Posts, day: Day, drop: Dropped): Settled | Refused<'no-fight'> {
  const f: Fight | null = save.fight ?? null;
  if (!f || f.id !== plan.fightId || f.phase !== 'ended') return refuse('no-fight');
  const paid = pays(plan, choice);
  const text = `${plan.dead.length} defeated, ${plan.xp} XP${choice === 'award' ? ` awarded (${plan.each} each)` : ''}.`;
  const logged = encounterEnded(save, { gateId: plan.gateId, paid: paid ? plan.award : 0, text }, { at: day.at, cap: day.R.logCap });
  // who fought it stays on the gate, so its Clear offers them first after a reload too
  const fought = plan.payees.map(p => (p.kind === 'local' ? p.hid : p.key));
  const ended = { ...logged, gates: logged.gates.map(g => (g.id === plan.gateId ? { ...g, fought } : g)) };
  const locals = paid ? plan.payees.flatMap(p => (p.kind === 'local' ? [{ hid: p.hid, rewards: { ...newRewards(), xp: plan.each } }] : [])) : [];
  const out = payAll(ended, locals, paid ? posts : { room: null, events: [] }, day);
  const ctx: Ctx = { rules: day.R, life: id => out.save.hunters.find(h => h.id === id)?.life ?? null };
  // what the fight dropped is kept on the save until the GM gives it or sets it aside, so a reload keeps the offer
  const cleared = { ...out.save, fight: reduce(out.save.fight, { type: 'clear' }, ctx).fight, dropped: drop.gold || drop.items.length ? drop : null };
  delete cleared.fightRefs;
  return { save: cleared, granted: out.granted };
}

/** The last fight's drop dealt with: given in the Award form's send, or set aside by the GM. A save with none is the same. */
export const dropDealt = (save: Save): Save => (save.dropped === null ? save : { ...save, dropped: null });

// ── a gate's Clear ──
/** What one payee of a Clear gets: the split XP and gold, and the gate's items to the one taker. */
export type ClearShare<I> = { readonly payee: Payee; readonly xp: number; readonly gold: number; readonly items: readonly I[] };
/**
 * The shares of a Clear: the gate's XP still due and the rolled gold split over the payees when the rules split and there
 * is more than one, the items to `takerOf` (the payee picked, else the first).
 */
export function clearShares<I>(save: Pick<Save, 'gates'>, gateId: string, xpOf: XpOf, gold: number, items: readonly I[], payees: readonly Payee[], taker: string | null, split: boolean): { due: number; shares: ClearShare<I>[] } | null {
  const gate = save.gates.find(g => g.id === gateId); if (!gate) return null;
  const due = xpDue(gate, xpOf), n = payees.length, by = split && n > 1;
  const idOf = (p: Payee) => (p.kind === 'local' ? p.hid : p.key), first = payees.find(p => idOf(p) === taker) ?? payees[0] ?? null;
  return { due, shares: payees.map(p => ({ payee: p, xp: splitAward(due, n, by), gold: splitAward(gold, n, by), items: first && idOf(first) === idOf(p) ? items : [] })) };
}
/**
 * The fact of gate `g` cleared with a hunter of rank `rank` among its payees, on world day `day` (a local payee's here, a
 * player's in the room's `noted`, null when its sheet is not on the GM's phone: fight-facts.ts `rankSeen`).
 */
export const gateFact = (g: Pick<Gate, 'name' | 'rank' | 'breakDay'>, rank: Rank | null, day: number): Fact =>
  ({ kind: 'gate', name: g.name, rank: g.rank, above: rankIdx(g.rank) - rankIdx(rankSeen(rank)), toBreak: Math.max(0, g.breakDay - day) });
/**
 * Gate `gateId` cleared, in one step: the gate paid what it owed and logged (`clearGate`, world.ts), each local payee
 * given `rewards` (the view reads its share with `parseRewards`), each player's award posted. Refused as `clearGate` is.
 */
export function settleClear(save: Save, gateId: string, pay: ClearPay, locals: readonly { hid: string; rewards: Rewards }[], posts: Posts, day: Day): Settled | Refused<'missing' | 'unchanged'> {
  const cleared = clearGate(save, gateId, pay, { at: day.at, cap: day.R.logCap });
  if (isRefused(cleared)) return cleared;
  // the gate cleared is a fact of each local payee's chronicle (chronicle.ts), in the Clear's write
  const g = save.gates.find(x => x.id === gateId), paid = new Set(locals.map(l => l.hid));
  const facts = !g ? cleared : { ...cleared, hunters: cleared.hunters.map(h => (!paid.has(h.id) ? h : record(h, gateFact(g, h.rank, save.world.day)))) };
  return payAll(facts, locals, posts, day);
}
