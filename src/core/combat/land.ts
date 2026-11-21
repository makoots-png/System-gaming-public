// land.ts: what lands on a body outside a use's own formula (docs/agent-handoff/kits/design.md sections 1.2, 1.3 and 1.6):
// a threshold's ops, a trigger's ops and a delayed effect's end, each at its formulas' averages from a source (no dice:
// design 1.3.6), with the rules a hit meets on the way (defence, rule 12; the shield, rule 13; HP in 0 to max, rule 14).
// Pure. resolve.ts lands a use's thresholds here (rule 18a); triggers.ts its triggers (rule 19b); fight-turn.ts an end at
// the settle. A status put on lands by rule 18 whoever puts it (`landStatus`, which resolve.ts calls for a use too). A new
// land op is a member of `LandOp` and `LAND_USE_OPS` (effect-ops.ts) and its case in `landOne` (the typecheck asks).

import { tallyOf } from './row-tally.ts';
import { average } from '../formula.ts';
import type { Formula, KitScope, Scope } from '../formula.ts';
import { dist } from './space.ts';
import { delayed, hastened, hasteStep, interval, paceCost, stunned, tick } from './timeline.ts';
import type { Tick } from './timeline.ts';
import type { CombatantId, DamageType } from './ability-types.ts';
import type { Sheet } from '../hunter/derive.ts';
import { isUp, rowHp } from './row-hp.ts';
import { rowLifeAfter } from './row-life.ts';
import { applyStatus, controlFactor, cureStatus, dispelled, lasting, removeStatus, shielded, stackOf, statusOn, statusShield, withStatuses } from './effect-ops.ts';
import { atTier, countOn, stacked } from './op-amount.ts';
import { admitted, counting, damageShare, harmful, healShare, markWards, wardedDamage } from './standing.ts';
import type { Body, LandOp, Op, OpRules, Reach, Source, Status, StatusKey, Threshold, Tiered } from './effect-ops.ts';
import type { Side } from './space.ts';
import { ARMED, endStep } from './delayed.ts';
import { stackStep } from './stacks.ts';
import { channelStep } from './fight-channel.ts';

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** On the map: a monster or shadow at 0 HP is gone from it; a hunter at 0 still lies there. */
export const alive = (b: Body): boolean => isUp(b) || b.kind === 'hunter';

// Rule 12: penetration percent, then flat; then the flat part of what is left comes off the hit, then the percentage; at least 1.
/** Rule 12 for a hit of `raw` of `type` from a user with this sheet on a target with this one (the maker's preview reads it too). */
export function afterDefence(raw: number, type: DamageType, user: Pick<Sheet, 'pen' | 'penFlat'>, target: Pick<Sheet, 'armor' | 'resist'>, R: Pick<OpRules, 'fight'>): number {
  const def = type === 'physical' ? target.armor : target.resist;
  const left = Math.max(0, def * (1 - user.pen) - user.penFlat);
  return Math.max(1, Math.round(Math.max(0, raw - R.fight.armorFlat * left) * R.fight.armorK / (R.fight.armorK + left)));
}

// Rule 13: the shield takes it first.
export function throughShield(target: Body, dealt: number, now: Tick): { target: Body; absorbed: number } {
  const s = target.shield;
  if (!s || s.until <= now) return { target, absorbed: 0 };
  const absorbed = Math.min(s.amount, dealt);
  return { target: { ...target, shield: s.amount - absorbed > 0 ? { ...s, amount: s.amount - absorbed } : null }, absorbed };
}

// Rule 14: HP stays in 0 to max, through the row's life (row-life.ts): at 0 a hunter is dying and a foe dead, and a heal
// never lifts a dead row.
export const hurt = (target: Body, damage: number): Body => rowLifeAfter(target, { type: 'damage', amount: damage });
export const healed = (target: Body, amount: number): Body => rowLifeAfter(target, { type: 'heal', amount });

// Rule 15: a monster's threat table.
export function threatened(target: Body, from: CombatantId, amount: number): Body {
  if (!target.threat || amount === 0) return target;
  return { ...target, threat: { ...target.threat, [from]: (target.threat[from] ?? 0) + amount } };
}

/**
 * Rule 17 (design 4.1): a holding channel breaks and waits to go off at once at `breakShare` of its charge. The channel's
 * `interrupt`, so every break, whatever made it (a use's hit or op, a trigger's, a threshold's, an end's, a reaction's or
 * a shove), is halved by the one table; a channel that is not holding stays as it is.
 */
export const broken = (target: Body, R: Pick<OpRules, 'fight'>): Body =>
  target.channel ? { ...target, channel: channelStep(target.channel, { type: 'interrupt', share: R.fight.breakShare }) } : target;

/**
 * A body's statuses that count (standing.ts `counts`: an owed one, whose time ran out, does not). `_now` is not read:
 * a status's life already holds the end of its time; it stays for the callers in charge.ts.
 */
export const live = (b: Body, _now: Tick): Status[] => counting(b.statuses);
/** Each op of a body's live statuses, at its source's tier, with the count a per-stack number is multiplied by (kits design 1.1). */
export const opsOf = (b: Body, now: Tick) => live(b, now).flatMap(s => s.def.ops.map(op => ({ op, tier: s.source.tier, n: countOn(s) })));
/** Held: a live status holds it (a stun), so its turns are passed by rule and it fires no reaction. */
export const held = (b: Body, now: Tick): boolean => opsOf(b, now).some(({ op }) => op.op === 'hold');
/** Whether a holding channel breaks: a hit of its `hold` share of max HP, or a forced break (a hold, a root, a taunt put on), unless a status protects it. */
export function channelBreaks(target: Body, damage: number, forced: boolean, now: Tick): boolean {
  if (target.channel?.state !== 'holding') return false;
  if (opsOf(target, now).some(({ op }) => op.op === 'channel' && op.mode === 'protect')) return false;
  return forced || damage >= target.sheet.hold * target.sheet.hpMax;
}

/** What putting a status on a body did (`landStatus`). */
export type Put = { readonly target: Body; readonly put: boolean; readonly threat: number; readonly breaks: boolean; readonly fired: LandFired | null };
/**
 * Rule 18's status on a body, one rule for a use's op (resolve.ts) and a land op (a trigger, a threshold, a delayed end,
 * a reaction): a control status lasts less on a tenacious or a boss target (`lasting`, `controlFactor`); a safeguard or
 * a ward may refuse it (`admitted`); with `cross` a stacking one checks its threshold (rule 18a, `crossed`); its shield
 * ops give a shield read with `by` as the user; a hold stuns; a taunt makes a threat burst for its source; a hold, a
 * root or a taunt asks a holding channel to break (`breaks`). `by` is whose potency the duration reads (a use's user, a
 * land's hitter), `source` the status's source at its tier, `side` the side it comes from (null: none).
 */
export function landStatus(t: Body, op: Extract<Op, { op: 'applyStatus' }>, by: Body, source: Source, side: Side | null, cross: boolean, now: Tick, R: OpRules): Put {
  const d = op.duration === null ? null : lasting(op.def, atTier(op.duration, source.tier), source.tier, by.sheet.potency, t.sheet.tenacity, controlFactor(t, R));
  const door = admitted(t, op.def, side, d === null ? null : now + d, now, R);
  if (!door.ok) return { target: t, put: false, threat: 0, breaks: false, fired: null };
  const until = door.until === null ? null : tick(door.until), warded = markWards(t.warded, op.def);
  let b = warded === undefined ? t : { ...t, warded };
  const before = stackOf(b.statuses.find(x => x.key === op.key));
  b = withStatuses(b, applyStatus(b.statuses, statusOn(op.def, { key: op.key, source, until, since: now, settledAt: now }, op.stacks ?? 1)), now, R);
  const c = cross ? crossed(b, op.key, before, op.stacks ?? 1, now, R) : { target: b, fired: null };
  b = c.target;
  b = { ...b, shield: statusShield(op.def, b.shield, { user: { stats: by.stats, sheet: by.sheet }, target: { stats: b.stats, sheet: b.sheet }, charge: 0 }, now, until, R) };
  let threat = 0, breaks = false;
  for (const o of op.def.ops) {
    if (o.op === 'hold' && until !== null) b = stunned(b, now, tick(until - now));
    if (o.op === 'taunt' && b.threat && source.id !== null) {
      const lead = Math.max(0, ...Object.values(b.threat)), mine = b.threat[source.id] ?? 0, burst = R.fight.tauntBurst * (lead - mine);
      b = threatened(b, source.id, burst);
      threat += burst;
    }
    if (o.op === 'hold' || o.op === 'root' || o.op === 'taunt') breaks = true;
  }
  return { target: b, put: true, threat, breaks, fired: c.fired };
}

/** A hasten (kits design 8.6.2): `t`'s next turn earlier by `share` of `user`'s standard action, once between its turns, never on oneself. */
export function hasteOn(user: Body, t: Body, share: number, now: Tick, R: OpRules): Body {
  if (t.id === user.id || !hasteStep(t.hastened ? 'hastened' : 'waiting', { type: 'hastened' }).moves) return t;
  return { ...hastened(t, now, share * interval(user.speed, paceCost('standard', R.fight), R.fight)), hastened: true };
}

/** A threshold a status set off on a body (rule 18a), to land once its outcome is in. */
export type LandFired = { readonly bearer: CombatantId; readonly key: StatusKey; readonly label: string; readonly threshold: Threshold; readonly source: Source };
/** A threshold that went off: on whom, which status, and what its ops did to each body they reached. */
export type Burst = { readonly bearer: CombatantId; readonly key: StatusKey; readonly label: string; readonly landed: readonly { readonly target: CombatantId; readonly dealt: number }[] };

/**
 * Rule 18a (kits design 1.2): a stacking status put on with `k` stacks, from a count of `before`, fires its threshold on
 * the crossing (stacks.ts); its count is then what the step leaves (spent or kept). The threshold's count is a number, or
 * its formula's average over the bearer.
 */
export function crossed(t: Body, key: StatusKey, before: ReturnType<typeof stackOf>, k: number, now: Tick, R: OpRules): { target: Body; fired: LandFired | null } {
  const s = t.statuses.find(x => x.key === key);
  if (!s || !stacked(s) || s.def.stack.threshold === null) return { target: t, fired: null };
  const th = s.def.stack.threshold, bearer = { stats: t.stats, sheet: t.sheet };
  const at = th.at.kind === 'count' ? th.at.n : average(th.at.formula, { user: bearer, target: bearer, charge: 0 });
  const step = stackStep(before, { type: 'apply', k }, { rule: s.def.stack, at });
  if (!step.fired) return { target: t, fired: null };
  const after = step.stack, list = after.at === 'held' ? t.statuses.map(x => x.key === key ? { ...s, stacks: after.n } : x) : removeStatus(t.statuses, key);
  return { target: withStatuses(t, list, now, R), fired: { bearer: t.id, key, label: s.def.label, threshold: th, source: s.source } };
}

/** The bodies a reach takes around `bearer`: the bearer alone, or every body on the map of the side it names within its radius (the bearer among them when its side is named). */
export function reached(rows: ReadonlyMap<CombatantId, Body>, bearer: Body, reach: Reach): Body[] {
  if (reach.kind === 'bearer') return [bearer];
  const sides = (b: Body): boolean => reach.on === 'all' || (reach.on === 'allies') === (b.side === bearer.side);
  const near = [...rows.values()].filter(b => alive(b) && sides(b) && dist(b.place, bearer.place) <= reach.radius);
  if (reach.kind === 'area') return near;
  // the one with the most HP (kits design 8.5.3), the bearer aside; a tie goes to the first in the fight's order
  const most = near.filter(b => b.id !== bearer.id && isUp(b)).sort((p, q) => rowHp(q) - rowHp(p))[0];
  return most ? [most] : [];
}

/**
 * What landing did to one body: its HP damage dealt (after defence, before the shield), whether it went down, and the
 * status keys it gained (for the triggers' events, design 1.3), with the thresholds those set off.
 */
export type Landed = { readonly target: CombatantId; readonly dealt: number; readonly down: boolean; readonly gained: readonly StatusKey[]; readonly cured: readonly StatusKey[] };

/**
 * Ops landing once on each of `targets`, from `source`, at their formulas' averages (no dice: design 1.3.6). `hitter` is
 * whose hit a damage op is for defence (rule 12) and whose sheet the formula reads as the user: the status's source for
 * a threshold or an end, the bearer for a trigger (design 1.3.9); null reads the target itself. `times` multiplies every
 * amount (an end lands times its stacks, design 1.6). With `cross` a status put on checks its threshold (rule 18a) and
 * the ones it sets off come back in `fired`, for the caller to land once; without it a status only adds its stacks. A
 * move that takes from a target gives to the hitter, which then has an entry of its own in `landed`, after the targets'.
 */
export function landOps(rows: Map<CombatantId, Body>, ops: readonly LandOp[], hitter: Body | null, targets: readonly CombatantId[], source: Source, now: Tick, R: OpRules,
  o: { readonly times?: number; readonly cross?: boolean; readonly event?: StatusKey } = {}): { landed: Landed[]; fired: LandFired[] } {
  const landed: Landed[] = [], fired: LandFired[] = [];
  // what a move from a target gave the body that took it (the hitter), told after the targets
  const taken: Record<CombatantId, StatusKey[]> = {};
  for (const id of targets) {
    let t = rows.get(id);
    if (!t || !alive(t)) continue;
    const before = rowHp(t);
    let dealt = 0;
    const gained: StatusKey[] = [], cured: StatusKey[] = [];
    for (const op of ops) {
      const user = hitter ? rows.get(hitter.id) ?? hitter : t;
      if (op.op === 'move') {
        // a move changes two bodies, and the one that receives is the one that gained (kits design 8.5.2)
        rows.set(t.id, t);
        const m = landMove(rows, op, user.id, t.id, o.event ?? null, o.cross ?? false, now, R);
        t = rows.get(t.id)!;
        if (m?.fired) fired.push(m.fired);
        if (m) (m.holder === t.id ? gained : (taken[m.holder] ??= [])).push(m.key);
        continue;
      }
      const r = landOne(op, user, t, source, now, R, o.times ?? 1, source.id === null ? null : rows.get(source.id)?.side ?? null, o.cross ?? false);
      t = r.target; dealt += r.dealt;
      if (r.fired) fired.push(r.fired);
      if (r.gained) gained.push(r.gained);
      if (r.cured) cured.push(r.cured);
      // a cure's or a dispel's detonation (table 2.2) lands on the bearer as the ops left it
      for (const gone of r.lands) { rows.set(t.id, t); const e = landEnd(rows, t.id, gone, now, R); t = rows.get(t.id)!; dealt += e.dealt; }
    }
    rows.set(t.id, t);
    landed.push({ target: t.id, dealt, down: before > 0 && rowHp(t) === 0, gained, cured });
  }
  for (const [id, keys] of Object.entries(taken) as [CombatantId, StatusKey[]][]) landed.push({ target: id, dealt: 0, down: false, gained: keys, cured: [] });
  return { landed, fired };
}

/** Whether a cure that takes `s` whole sets its end off (table 2.2: its `cleanse` is `land`). */
export const cureLands = (s: Status): boolean => s.def.end !== undefined && endStep(ARMED, { type: 'cure' }, s.def.end).lands;
/** What takes statuses off a body: a cure of a key (`stacks` of it, or all) or a dispel of the first harmful one or all. */
export type Cleanse = Extract<LandOp, { readonly op: 'cureStatus' | 'dispel' }>;
/**
 * A cure or a dispel on `t` at `now`, one edge for a use's op (resolve.ts, rule 18) and a land op (`landOne`): the body
 * without what it took, the statuses it took whole (their life's `taken`, standing.ts), and those of them whose end it
 * sets off (`cureLands`), for the caller to land on the bearer.
 */
export function cleansed(t: Body, c: Cleanse, now: Tick, R: OpRules): { target: Body; gone: Status[]; lands: Status[] } {
  const list = c.op === 'dispel' ? dispelled(t.statuses, c.which) : cureStatus(t.statuses, c.key, c.stacks);
  const gone = t.statuses.filter(s => !list.some(x => x.key === s.key));
  return { target: withStatuses(t, list, now, R), gone, lands: gone.filter(cureLands) };
}
/**
 * A delayed effect's end landing on its bearer (kits design 1.6, table 2.2), from the status's source, at its formulas'
 * averages times its stacks. The source's sheet reads as the user and meets the bearer's defence; a source no longer in
 * the fight reads the bearer itself. Its statuses set off no threshold.
 */
export function landEnd(rows: Map<CombatantId, Body>, bearer: CombatantId, s: Status, now: Tick, R: OpRules): Landed {
  const from = s.source.id === null ? null : rows.get(s.source.id) ?? null;
  const r = landOps(rows, (s.def.end?.ops ?? []).filter(o => o.op !== 'refund'), from, [bearer], s.source, now, R, { times: countOn(s) });
  return r.landed[0] ?? { target: bearer, dealt: 0, down: false, gained: [], cured: [] };
}

/**
 * A threshold's ops landing once (rule 18a), from the status's source, at their formulas' averages, on its bearer or on
 * the bodies its reach takes around it. A hit meets defence (rule 12) and the shield (13); a status put on adds its
 * stacks and sets off no further threshold here.
 */
export function landThreshold(rows: Map<CombatantId, Body>, f: LandFired, now: Tick, R: OpRules): Burst {
  const bearer = rows.get(f.bearer)!, from = f.source.id === null ? null : rows.get(f.source.id) ?? null;
  const inside = reached(rows, bearer, f.threshold.to).map(b => b.id);
  const r = landOps(rows, f.threshold.ops.filter(op => op.op !== 'refund'), from, inside, f.source, now, R);
  return { bearer: f.bearer, key: f.key, label: f.label, landed: r.landed.map(l => ({ target: l.target, dealt: l.dealt })) };
}

/**
 * What the kits' formula names read outside a use (kits design 1.5): each body's stacks and lost share, and the user's
 * kills, within their rules' bounds; no field, rounds held or bodies hit, which only a use's snapshot has.
 */
export function kitOf(user: Body, target: Body, R: OpRules): KitScope {
  const K = R.fight.kit;
  const stacks = (b: Body) => Object.fromEntries(counting(b.statuses).map(s => [s.key, Math.min(K.stackCap, countOn(s))])) as Record<StatusKey, number>;
  const missing = (b: Body): number => (b.sheet.hpMax > 0 ? Math.max(0, Math.min(1, 1 - rowHp(b) / b.sheet.hpMax)) : 0);
  return { stacks: { user: stacks(user), target: stacks(target) }, field: {}, missing: { user: missing(user), target: missing(target) }, held: {}, hits: 0, kills: Math.min(K.kills, tallyOf(user).kills.length), spent: 0 };
}

/**
 * A move (kits design 8.5.1): up to `take` stacks (or all; a plain status whole) of a status leave the giver (`from`) for
 * the other of user and target, with the same def and source and the rest of their time from now, up to the receiver's
 * cap (the rest are lost); put on as `as` when named (onto the receiver's own status of that key when it holds one). The
 * key is the status named, the giver's first harmful one, or the one that raised the trigger (`event`). A safeguard on
 * the receiver refuses a harmful one, which stays. Null when nothing moves.
 */
function moved(op: Extract<LandOp, { op: 'move' }>, user: Body, target: Body, event: StatusKey | null, now: Tick, R: OpRules):
  { user: Body; target: Body; gained: StatusKey; before: ReturnType<typeof stackOf>; k: number } | null {
  if (user.id === target.id) return null;
  const giver = op.from === 'user' ? user : target, taker = op.from === 'user' ? target : user;
  const s = op.key === 'harmful' ? giver.statuses.find(x => x.zone === undefined && harmful(x.def)) : giver.statuses.find(x => x.zone === undefined && x.key === (op.key === 'event' ? event : op.key));
  if (!s) return null;
  if (!admitted(taker, s.def, giver.side, s.until, now, R).ok) return null;
  const held = countOn(s), k = op.take === 'all' ? held : Math.min(held, op.take);
  const left = stacked(s) && k < held ? giver.statuses.map(x => x === s ? { ...s, stacks: held - k } : x) : removeStatus(giver.statuses, s.key);
  const key = op.as ?? s.key, mine = taker.statuses.find(x => x.key === key);
  const def = mine ? mine.def : s.def;
  const before = stackOf(mine);
  const put = statusOn(def, { key, source: s.source, until: s.until, since: now, settledAt: now }, k);
  const g = withStatuses(giver, left, now, R), t = withStatuses(taker, applyStatus(taker.statuses, put), now, R);
  const out = op.from === 'user' ? { user: g, target: t } : { user: t, target: g };
  return { ...out, gained: key, before, k };
}

/**
 * A move between `user` and `target` as `rows` holds them, written to `rows`: the one path of a use's move (resolve.ts)
 * and a land op's. The body that receives is the one that gained the status, whichever of the two it is, and with
 * `cross` its threshold checks for the crossing (rule 18a). Answers who gained which status and the threshold it set
 * off, or null when nothing moved.
 */
export function landMove(rows: Map<CombatantId, Body>, op: Extract<LandOp, { op: 'move' }>, user: CombatantId, target: CombatantId, event: StatusKey | null, cross: boolean, now: Tick, R: OpRules):
  { holder: CombatantId; key: StatusKey; fired: LandFired | null } | null {
  const u = rows.get(user), t = rows.get(target), m = u && t ? moved(op, u, t, event, now, R) : null;
  if (!m) return null;
  rows.set(m.user.id, m.user); rows.set(m.target.id, m.target);
  const holder = op.from === 'user' ? m.target : m.user;
  const c = cross ? crossed(holder, m.gained, m.before, m.k, now, R) : { target: holder, fired: null };
  rows.set(holder.id, c.target);
  return { holder: holder.id, key: m.gained, fired: c.fired };
}

/**
 * One land op on `t` at its average from `source`'s tier, read with `user` as the user, every amount times `times`. A
 * refund is time back on the bearer's own turn, which the caller gives (triggers.ts); here it changes nothing.
 */
function landOne(o: LandOp, user: Body, t: Body, source: Source, now: Tick, R: OpRules, times: number, from: Side | null, cross: boolean):
  { target: Body; dealt: number; fired: LandFired | null; gained: StatusKey | null; cured: StatusKey | null; lands: readonly Status[] } {
  const scope: Scope = { user: { stats: user.stats, sheet: user.sheet }, target: { stats: t.stats, sheet: t.sheet }, charge: 0, kit: kitOf(user, t, R) };
  const at = (f: Tiered<Formula>) => average(atTier(f, source.tier), scope) * times;
  const none = { fired: null, gained: null, cured: null, lands: [] };
  switch (o.op) {
    case 'damage': {
      const raw = Math.max(0, at(o.amount)) * damageShare(user === t ? null : user, t, R), dealt = afterDefence(raw, o.type, user.sheet, t.sheet, R);
      const s = throughShield(t, dealt, now);
      return { target: hurt(s.target, wardedDamage(s.target, dealt - s.absorbed)), dealt, ...none };
    }
    case 'heal': { const n = Math.max(0, Math.round(at(o.amount) * healShare(t, R))); return { target: healed(t, n), dealt: 0, ...none }; }
    case 'applyStatus': {
      // a status a safeguard or a spent ward refuses is not put on, and so not gained
      const p = landStatus(t, o, user, source, from, cross, now, R);
      return { target: p.breaks && channelBreaks(p.target, 0, true, now) ? broken(p.target, R) : p.target, dealt: 0, ...none, fired: p.fired, gained: p.put ? o.key : null };
    }
    case 'cureStatus': case 'dispel': {
      const c = cleansed(t, o, now, R);
      return { target: c.target, dealt: 0, ...none, cured: o.op === 'cureStatus' && c.gone.length ? o.key : null, lands: c.lands };
    }
    case 'delay': return { target: delayed(t, atTier(o.ticks, source.tier)), dealt: 0, ...none };
    case 'threat': return { target: source.id === null ? t : threatened(t, source.id, atTier(o.amount, source.tier)), dealt: 0, ...none };
    case 'shield': return { target: { ...t, shield: shielded(t.shield, { amount: Math.max(0, Math.round(average(o.amount, scope) * times)), until: tick(now + R.fight.shieldLife * R.fight.round) }, now) }, dealt: 0, ...none };
    case 'mana': return { target: { ...t, mana: clamp(t.mana + Math.round(at(o.amount)), 0, t.sheet.manaMax) }, dealt: 0, ...none };
    case 'fatigue': return { target: { ...t, fatigue: clamp(t.fatigue + Math.round(at(o.amount)), 0, t.sheet.fatigueMax) }, dealt: 0, ...none };
    // rule 17: a break meets a protection as a use's does
    case 'channel': return { target: o.mode === 'break' && channelBreaks(t, 0, true, now) ? broken(t, R) : t, dealt: 0, ...none };
    case 'note': case 'refund': return { target: t, dealt: 0, ...none };
    case 'hasten': return { target: hasteOn(user, t, o.share, now, R), dealt: 0, ...none };
    // a move changes two bodies, so `landOps` lands it before it asks here
    case 'move': return { target: t, dealt: 0, ...none };
    default: return o satisfies never;
  }
}
