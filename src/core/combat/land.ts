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
import { delayed, hastened, hasteStep, interval, notBefore, paceCost, stunned, tick } from './timeline.ts';
import type { Tick } from './timeline.ts';
import type { CombatantId, DamageType } from './ability-types.ts';
import { defenceOf } from './damage-type.ts';
import type { Sheet } from '../hunter/derive.ts';
import { isUp, rowHp } from './row-hp.ts';
import { rowLifeAfter } from './row-life.ts';
import { isMinionOf } from './summons.ts';
import { applyStatus, cureStatus, dispelled, lasting, liveShield, removeStatus, shieldGrown, shieldOn, stackOf, statusOn, statusShield, withStatuses, withThreat } from './effect-ops.ts';
import { atTier, countOn, stacked } from './op-amount.ts';
import { admitted, counting, damageShare, dealtBy, given, harmful, healShare, hideStarts, markWards, stealthOf, stealthStep, wardedDamage } from './standing.ts';
import type { StealthEndEvent } from './standing.ts';
import type { Body, LandOp, Op, OpRules, Reach, Source, Status, StatusKey, Threshold, Tiered, UseOp } from './effect-ops.ts';
import type { Side } from './space.ts';
import { ARMED, endStep } from './delayed.ts';
import { stackStep } from './stacks.ts';
import { channelStep } from './fight-channel.ts';

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** On the map: a monster or shadow at 0 HP is gone from it; a hunter at 0 still lies there. */
export const alive = (b: Body): boolean => isUp(b) || b.kind === 'hunter';

// Rule 12 (balance plan section 9, R6): the damage type picks the defence and the pair of penetrations: armor
// and the armor pair for a physical hit, resist and the resist pair for an arcane one, and 0 for true damage.
// The percent comes off first, then the flat points; then the flat part of what is left comes off the hit, then the percentage; at least 1.
/** Zero penetration, for status ticks and other hits that carry no attacker penetration. */
export const NO_PEN: Pick<Sheet, 'armorPen' | 'resistPen' | 'armorPenFlat' | 'resistPenFlat'> = {
  armorPen: 0, resistPen: 0, armorPenFlat: 0, resistPenFlat: 0,
};
/** The armor or resist a hit of `type` from a user with this sheet meets on a target with this one, after penetration (0 for defense-ignoring damage). */
export function defenceLeft(type: DamageType, user: Pick<Sheet, 'armorPen' | 'resistPen' | 'armorPenFlat' | 'resistPenFlat'>, target: Pick<Sheet, 'armor' | 'resist'>): number {
  const defKey = defenceOf(type);
  if (defKey === null) return 0;
  const physical = defKey === 'armor';
  const def = physical ? target.armor : target.resist, pct = physical ? user.armorPen : user.resistPen, flat = physical ? user.armorPenFlat : user.resistPenFlat;
  return Math.max(0, def * (1 - pct / 100) - flat);
}
/** What of a hit of `raw` gets through `left` defence, before rule 12 rounds it: item-budget.ts weighs a point of penetration on it. */
export const throughDefence = (raw: number, left: number, R: Pick<OpRules, 'fight'>): number =>
  Math.max(0, raw - R.fight.armorFlat * left) * R.fight.armorK / (R.fight.armorK + left);
/** Rule 12 for a hit of `raw` of `type` from a user with this sheet on a target with this one (the maker's preview reads it too). */
export function afterDefence(raw: number, type: DamageType, user: Pick<Sheet, 'armorPen' | 'resistPen' | 'armorPenFlat' | 'resistPenFlat'>, target: Pick<Sheet, 'armor' | 'resist'>, R: Pick<OpRules, 'fight'>): number {
  return Math.max(1, Math.round(throughDefence(raw, defenceLeft(type, user, target), R)));
}

// Rule 13: the shield takes it first.
export function throughShield(target: Body, dealt: number, now: Tick): { target: Body; absorbed: number } {
  const s = target.shield;
  if (!s || s.until <= now) return { target, absorbed: 0 };
  const absorbed = Math.min(s.amount, dealt);
  return { target: { ...target, shield: s.amount - absorbed > 0 ? { ...s, amount: s.amount - absorbed } : null }, absorbed };
}

// Rule 14: HP stays in 0 to max, through the row's life (row-life.ts): at 0 a row is dead, and a heal never lifts a
// dead row.
export const hurt = (target: Body, damage: number): Body => rowLifeAfter(target, { type: 'damage', amount: damage });
export const healed = (target: Body, amount: number): Body => rowLifeAfter(target, { type: 'heal', amount });
/** What a body's own damage gave it back (`drained`): the body after, the HP its lifesteal healed and the shield its damage to shield added. */
export type Drained = { readonly user: Body; readonly healed: number; readonly stored: number };
/**
 * Lifesteal (balance plan section 10), after rule 14: `user` heals back its sheet's `drain` share of `lost`, the HP its
 * use took from other bodies (what rule 14 took: never a shield's part, nothing past 0), times its healing received
 * share (rule 11c, so a cut to healing cuts a drain), rounded, through its life (`healed`). Then damage to shield
 * (item-stats 2.2): its `shieldDrain` share of the same `lost` grows its shield (effect-ops.ts `shieldGrown`) up to
 * `kit.shieldDrainMax` of its max HP, lasting the rules' shield life from now. Its own heal and shield power raise
 * neither. A user that is not up drains nothing: a drain is no revive.
 */
export function drained(user: Body, lost: number, now: Tick, R: OpRules): Drained {
  if (!isUp(user) || lost <= 0) return { user, healed: 0, stored: 0 };
  const hp = rowHp(user), live = liveShield(user, now);
  let b = user.sheet.drain > 0 ? healed(user, Math.round(lost * user.sheet.drain * healShare(user, R))) : user;
  if (b.sheet.shieldDrain > 0) {
    const ceiling = Math.round(R.fight.kit.shieldDrainMax * b.sheet.hpMax), until = tick(now + R.fight.shieldLife * R.fight.round);
    b = { ...b, shield: shieldGrown(b, lost * b.sheet.shieldDrain, ceiling, until, now, R) };
  }
  return { user: b, healed: rowHp(b) - hp, stored: liveShield(b, now) - live };
}
/** What a drain says after its user's name in a fight's log: "drains 4", "stores 6", "drains 4 and stores 6"; null for nothing. */
export function drainWords(d: Pick<Drained, 'healed' | 'stored'>): string | null {
  const parts = [...(d.healed > 0 ? [`drains ${d.healed}`] : []), ...(d.stored > 0 ? [`stores ${d.stored}`] : [])];
  return parts.length ? parts.join(' and ') : null;
}

// Rule 15: a monster's threat table.
export const threatened = (target: Body, from: CombatantId, amount: number): Body =>
  amount === 0 ? target : withThreat(target, t => ({ ...t, [from]: (t[from] ?? 0) + amount }));

/**
 * Rule 17 (design 4.1): a holding channel breaks and waits to go off at once at `breakShare` of its charge. The channel's
 * `interrupt`, so every break, whatever made it (a use's hit or op, a trigger's, a threshold's, an end's, a reaction's or
 * a shove), is halved by the one table; a channel that is not holding stays as it is.
 */
export const broken = (target: Body, R: Pick<OpRules, 'fight'>): Body =>
  target.channel ? { ...target, channel: channelStep(target.channel, { type: 'interrupt', share: R.fight.breakShare }) } : target;

/** A body's statuses that count (standing.ts `counts`: an owed one, whose time ran out, does not). */
export const live = (b: Body): Status[] => counting(b.statuses);
/** Each op of a body's live statuses, at its source's tier, with the count a per-stack number is multiplied by (kits design 1.1). */
export const opsOf = (b: Body) => live(b).flatMap(s => s.def.ops.map(op => ({ op, tier: s.source.tier, n: countOn(s) })));

// Rule 16 (design 4.3): a full bar costs the target `staggerCost` rounds, empties and grows by `staggerRegrow`.
/** What a body's stagger bar fills by: 1 plus its statuses' `staggerRate` percents (each per stack), never under 0. */
export const barRate = (target: Body): number =>
  Math.max(0, 1 + opsOf(target).reduce((sum, { op, tier, n }) => (op.op === 'staggerRate' ? sum + atTier(op.pct, tier) * n : sum), 0) / 100);
/**
 * `fill` more on `target`'s stagger bar, the one place a bar fills (a hit's, resolve.ts `staggered`; a `stagger` op's,
 * `staggerOp`): a full bar stuns it for `staggerCost` rounds from `now`, empties and grows. A body with no bar (only an
 * elite or a boss keeps one, rows.ts `staggerOf`) and a fill of 0 leave it as it was.
 */
export function barFilled(target: Body, fill: number, now: Tick, R: OpRules): { target: Body; staggered: boolean } {
  if ((target.kind !== 'monster' && target.kind !== 'hunter') || !target.stagger || fill <= 0) return { target, staggered: false };
  const bar = target.stagger;
  if (bar.fill + fill < bar.max) return { target: { ...target, stagger: { ...bar, fill: bar.fill + fill } }, staggered: false };
  const floor = notBefore(target, now, tick(R.fight.staggerCost * R.fight.round));
  return { target: { ...floor, stagger: { ...bar, fill: 0, max: bar.max * (1 + R.fight.staggerRegrow), until: floor.at } }, staggered: true };
}
/**
 * A `stagger` op on `t` (keystones A.7), one rule for a use's op (resolve.ts) and a land op (`landOne`): `share` of the
 * bar's max times the bar's rate (`barRate`), held at `kit.staggerOpMax` of the bar, so no one op breaks a bar alone;
 * a mythic playing its script takes `mythic.staggerTaken` of that (so a stagger answer to an omen needs the party's hits
 * too); then the bar fills as a hit's does (`barFilled`). A share is no hit, so a weak hit's weight does not reach it.
 */
export function staggerOp(t: Body, share: number, now: Tick, R: OpRules): { target: Body; fill: number; staggered: boolean } {
  if ((t.kind !== 'monster' && t.kind !== 'hunter') || !t.stagger) return { target: t, fill: 0, staggered: false };
  const fill = Math.min(R.fight.kit.staggerOpMax, share * barRate(t)) * t.stagger.max * (t.mythic ? R.fight.mythic.staggerTaken : 1);
  return { ...barFilled(t, fill, now, R), fill };
}
/**
 * Held: a live status holds it (a stun), so its turns are passed by rule and it fires no reaction. `_now` is not read
 * (a status's life holds its end); it goes when tests/effect-ops.test.ts stops passing it.
 */
export const held = (b: Body, _now: Tick): boolean => opsOf(b).some(({ op }) => op.op === 'hold');
/**
 * Whether a holding channel breaks: a hit of its `hold` share of max HP, or a forced break (a hold, a root, a taunt put
 * on), unless a status protects it. `_now` is not read, as `held`'s.
 */
export function channelBreaks(target: Body, damage: number, forced: boolean, _now: Tick): boolean {
  if (target.channel?.state !== 'holding') return false;
  if (opsOf(target).some(({ op }) => op.op === 'channel' && op.mode === 'protect')) return false;
  return forced || damage >= target.sheet.hold * target.sheet.hpMax;
}

/**
 * The stealth machine on a body (standing.ts `stealthStep`, notes-7-stealth.md section 4), the one writer of its hides:
 * `b` without each hidden status `e` ends; `b` itself when none ends. A hide of a key in `spare` meets no event: the use
 * or reaction that raised it put that hide on (`putBy`). Every caller raises its event here: a hurt (fight-turn.ts
 * `consequences`), damage its own use or reaction dealt (fight.ts `landed`, fight-react.ts `react`), a reveal (a
 * `reveal` op, `landOne`; a foe's use that caught it and did not pick it, `landed`).
 */
export function stealthAfter<B extends Body>(b: B, e: StealthEndEvent, now: Tick, R: OpRules, spare: readonly StatusKey[] = []): B {
  const s = stealthOf(b), met = { ...s, hides: s.hides.filter(h => !spare.includes(h.key)) };
  const left = stealthStep(met, e).hides, gone = new Set(met.hides.filter(h => !left.includes(h)).map(h => h.key));
  return gone.size ? withStatuses(b, b.statuses.filter(x => !gone.has(x.key)), now, R) : b;
}
/** The keys of the statuses a use's or a reaction's ops put on. */
export const putBy = (ops: readonly UseOp[]): StatusKey[] => ops.flatMap(o => (o.op === 'applyStatus' ? [o.key] : []));

/** What putting a status on a body did (`landStatus`). */
export type Put = { readonly target: Body; readonly put: boolean; readonly threat: number; readonly breaks: boolean; readonly fired: LandFired | null };
/**
 * Rule 18's status on a body, one rule for a use's op (resolve.ts) and a land op (a trigger, a threshold, a delayed end,
 * a reaction): a control status lasts less on a tenacious target and as long on a boss as on any (`lasting`); a safeguard or
 * a ward may refuse it (`admitted`); a hide that starts out of sight is refused on a body a foe that is up watches
 * (`hideStarts`, whoever puts it on); with `cross` a stacking one checks its threshold (rule 18a, `crossed`); its shield
 * ops give a shield read with `by` as the user; a hold stuns; a taunt makes a threat burst for its source; a hold, a
 * root or a taunt asks a holding channel to break (`breaks`). `by` is whose potency the duration reads (a use's user, a
 * land's hitter), `source` the status's source at its tier, `side` the side it comes from (null: none), `watched`
 * whether a foe that is up has `t` in sight (sight.ts `watched`, which needs the map: resolve.ts asks it for a use).
 */
export function landStatus(t: Body, op: Extract<Op, { op: 'applyStatus' }>, by: Body, source: Source, side: Side | null, cross: boolean, watched: boolean, now: Tick, R: OpRules): Put {
  const d = op.duration === null ? null : lasting(op.def, atTier(op.duration, source.tier), source.tier, by.sheet.potency, t.sheet.tenacity);
  return putFor(t, op, d, by, source, side, cross, watched, now, R);
}
/** Rule 18's status on a body once its length `d` is known (null: until removed): the rest of `landStatus`, and an echo's (`echoed`). */
function putFor(t: Body, op: Pick<Extract<Op, { op: 'applyStatus' }>, 'key' | 'def' | 'stacks'>, d: Tick | null, by: Body, source: Source, side: Side | null, cross: boolean, watched: boolean, now: Tick, R: OpRules): Put {
  const door = admitted(t, op.def, side, d === null ? null : now + d, now, R);
  if (!door.ok || !hideStarts(t, op.key, op.def, source.tier, watched)) return { target: t, put: false, threat: 0, breaks: false, fired: null };
  const until = door.until === null ? null : tick(door.until), warded = markWards(t.warded, op.def);
  let b = warded === undefined ? t : { ...t, warded };
  const before = stackOf(b.statuses.find(x => x.key === op.key));
  b = withStatuses(b, applyStatus(b.statuses, statusOn(op.def, { key: op.key, source, until, since: now, settledAt: now }, op.stacks ?? 1)), now, R);
  const c = cross ? crossed(b, op.key, before, op.stacks ?? 1, now, R) : { target: b, fired: null };
  b = c.target;
  b = { ...b, shield: statusShield(op.def, b, { user: { stats: by.stats, sheet: by.sheet }, target: { stats: b.stats, sheet: b.sheet }, charge: 0 }, by, now, until, R) };
  let threat = 0, breaks = false;
  for (const o of op.def.ops) {
    if (o.op === 'hold' && until !== null) b = stunned(b, tick(until - now));
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
/** A threshold or delayed-effect detonation that went off: on whom, which status, and what its ops did to each body they reached (damage dealt, or a detonation's heal to its source). */
export type Burst = { readonly bearer: CombatantId; readonly key: StatusKey; readonly label: string; readonly landed: readonly { readonly target: CombatantId; readonly dealt: number; readonly healed?: number }[] };

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
 * What landing did to one body: its HP damage dealt (after defence, before the shield), any HP healed on a detonated
 * status's source, any HP a fallen minion reformed at, whether it went down, and the status keys it gained or had cured
 * (for the triggers' events, design 1.3).
 */
export type Landed = { readonly target: CombatantId; readonly dealt: number; readonly healed?: number; readonly reformed?: number; readonly down: boolean; readonly gained: readonly StatusKey[]; readonly cured: readonly StatusKey[] };

/** The log parts for landed entries (damage dealt, detonation source heals, and reformed minions), e.g. `["Monster 80", "Hemomancer heals 32"]`. */
export function landedWords(
  entries: readonly { readonly target: CombatantId; readonly dealt: number; readonly healed?: number; readonly reformed?: number }[],
  name: (id: CombatantId) => string,
): string[] {
  const out: string[] = [];
  for (const l of entries) {
    if (l.dealt) out.push(`${name(l.target)} ${l.dealt}`);
    if (l.healed) out.push(`${name(l.target)} heals ${l.healed}`);
    if (l.reformed) out.push(`${name(l.target)} reforms at ${l.reformed} HP`);
  }
  return out;
}

/**
 * Ops landing once on each of `targets`, from `source`, at their formulas' averages (no dice: design 1.3.6). `hitter` is
 * whose hit a damage op is for defence (rule 12) and whose sheet the formula reads as the user: the status's source for
 * a threshold or an end, the bearer for a trigger (design 1.3.9); null reads the target itself. `times` multiplies every
 * amount (an end lands times its stacks, design 1.6). With `cross` a status put on checks its threshold (rule 18a) and
 * the ones it sets off come back in `fired`, for the caller to land once; without it a status only adds its stacks. A
 * move that takes from a target gives to the hitter, and a cure/dispel detonation that heals a status's source reports
 * that source, each as an entry of its own in `landed`, after the targets'.
 */
export function landOps(rows: Map<CombatantId, Body>, ops: readonly LandOp[], hitter: Body | null, targets: readonly CombatantId[], source: Source, now: Tick, R: OpRules,
  o: { readonly times?: number; readonly cross?: boolean; readonly event?: StatusKey; readonly gained?: Gained } = {}): { landed: Landed[]; fired: LandFired[] } {
  const landed: Landed[] = [], fired: LandFired[] = [];
  // what a move from a target gave the body that took it (the hitter), told after the targets
  const taken: Record<CombatantId, StatusKey[]> = {};
  // what a cure/dispel detonation healed a status's source, told after the targets
  const sourceHealed = new Map<CombatantId, number>();
  const hasReform = ops.some(op => op.op === 'reform');
  for (const id of targets) {
    const start = rows.get(id);
    if (!start) continue;
    const canAdmitDead = hasReform && !isUp(start) && hitter !== null && isMinionOf(start, hitter.id);
    if (!alive(start) && !canAdmitDead) continue;
    let t: Body = start;
    const before = rowHp(t);
    let dealt = 0, reformed = 0;
    const gained: StatusKey[] = [], cured: StatusKey[] = [];
    for (const op of ops) {
      const user = hitter ? rows.get(hitter.id) ?? hitter : t;
      if (op.op === 'reform') {
        if (!isUp(t) && hitter && isUp(user) && isMinionOf(t, user.id) && user.mana >= op.mana) {
          const hp = Math.max(1, Math.round(op.hpShare * t.sheet.hpMax));
          rows.set(user.id, { ...user, mana: clamp(user.mana - op.mana, 0, user.sheet.manaMax) });
          const raised = rowLifeAfter(t, { type: 'reform', hp });
          t = { ...raised, at: tick(Math.max(raised.at, now)) };
          reformed = rowHp(t);
        }
        continue;
      }
      if (!alive(t)) continue;
      if (op.op === 'move') {
        // a move changes two bodies, and the one that receives is the one that gained (kits design 8.5.2)
        rows.set(t.id, t);
        const m = landMove(rows, op, user.id, t.id, o.event ?? null, o.cross ?? false, now, R);
        t = rows.get(t.id)!;
        if (m?.fired) fired.push(m.fired);
        if (m) (m.holder === t.id ? gained : (taken[m.holder] ??= [])).push(m.key);
        continue;
      }
      const r = landOne(op, user, hitter ? user : null, t, source, now, R, o.times ?? 1, source.id === null ? null : rows.get(source.id)?.side ?? null, o.cross ?? false);
      t = r.target; dealt += r.dealt;
      if (r.fired) fired.push(r.fired);
      if (r.gained) gained.push(r.gained);
      if (r.cured) cured.push(r.cured);
      // a cure's or a dispel's detonation (table 2.2) lands on the bearer as the ops left it
      for (const gone of r.lands) {
        rows.set(t.id, t);
        const e = landEnd(rows, t.id, gone, now, R);
        t = rows.get(t.id)!;
        dealt += e.dealt;
        if (e.sourceHealed && gone.source.id !== null) sourceHealed.set(gone.source.id, (sourceHealed.get(gone.source.id) ?? 0) + e.sourceHealed);
      }
    }
    rows.set(t.id, t);
    landed.push({ target: t.id, dealt, down: before > 0 && rowHp(t) === 0, ...(reformed > 0 ? { reformed } : {}), gained, cured });
  }
  for (const [id, keys] of Object.entries(taken) as [CombatantId, StatusKey[]][]) landed.push({ target: id, dealt: 0, down: false, gained: keys, cured: [] });
  for (const [id, amt] of sourceHealed) landed.push({ target: id, dealt: 0, healed: amt, down: false, gained: [], cured: [] });
  // an echo lands once, on a body of its own choosing, after the targets (keystones A.7)
  if (o.gained) for (const op of ops) if (op.op === 'echo') {
    const e = echoed(rows, op, o.gained, o.cross ?? false, now, R);
    if (!e) continue;
    if (e.fired) fired.push(e.fired);
    landed.push({ target: e.target, dealt: 0, down: false, gained: [], cured: [] });
  }
  return { landed, fired };
}

/**
 * The status put on that set a trigger off: who holds it and its key (triggers.ts `gainedOf`): the bearer of a
 * `statusGained`, or the foe of an `imposed`, so an echo of a status a hunter imposes goes to that foe's nearest other.
 */
export type Gained = { readonly holder: CombatantId; readonly key: StatusKey };
/**
 * An echo (keystones A.7): the status `g.holder` gained also goes on the nearest other body of the holder's side within
 * `radius` tiles that is up and does not hold it (on a tie the first in the fight's order), from the same source, for the
 * length it had when put on (its time left now, the moment it was put on; one until removed stays so), one stack, through rule 18's door as any
 * status (`putFor`: a safeguard or a spent ward refuses it, a hold stuns, a taunt bursts, a channel breaks). It answers
 * who took it and the threshold it set off, or null when no body took it. Its caller tells it as no status gained, so
 * an echoed status raises no `statusGained` and no `imposed`, and an echo never chains (as `auraOps` leaves out `aura` and `spread`).
 */
function echoed(rows: Map<CombatantId, Body>, op: Extract<LandOp, { op: 'echo' }>, g: Gained, cross: boolean, now: Tick, R: OpRules): { target: CombatantId; fired: LandFired | null } | null {
  const holder = rows.get(g.holder), s = holder?.statuses.find(x => x.key === g.key && x.zone === undefined);
  if (!holder || !s || (s.until !== null && s.until <= now)) return null;
  const radius = Math.min(op.radius, R.fight.fieldRadiusMax);
  const near = [...rows.values()].filter(b => b.id !== holder.id && b.side === holder.side && isUp(b) && !b.statuses.some(x => x.key === g.key) && dist(b.place, holder.place) <= radius);
  const t = near.reduce<Body | null>((best, b) => (best === null || dist(b.place, holder.place) < dist(best.place, holder.place) ? b : best), null);
  if (!t) return null;
  const by = s.source.id === null ? holder : rows.get(s.source.id) ?? holder, side = s.source.id === null ? null : rows.get(s.source.id)?.side ?? null;
  const p = putFor(t, { key: g.key, def: s.def }, s.until === null ? null : tick(s.until - now), by, s.source, side, cross, false, now, R);
  if (!p.put) return null;
  rows.set(t.id, p.breaks && channelBreaks(p.target, 0, true, now) ? broken(p.target, R) : p.target);
  return { target: t.id, fired: p.fired };
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
 * the fight reads the bearer itself. When `end.sourceHealShare` is set, the living source heals for that share of the
 * pop's dealt damage (modified by the source's healing received share). Its statuses set off no threshold.
 */
export function landEnd(rows: Map<CombatantId, Body>, bearer: CombatantId, s: Status, now: Tick, R: OpRules): Landed & { readonly sourceHealed?: number } {
  const from = s.source.id === null ? null : rows.get(s.source.id) ?? null;
  const r = landOps(rows, (s.def.end?.ops ?? []).filter(o => o.op !== 'refund'), from, [bearer], s.source, now, R, { times: countOn(s) });
  const res = r.landed[0] ?? { target: bearer, dealt: 0, down: false, gained: [], cured: [] };
  const share = s.def.end?.sourceHealShare ?? 0;
  let sourceHealed = 0;
  if (share > 0 && res.dealt > 0 && s.source.id !== null) {
    const src = rows.get(s.source.id);
    if (src && isUp(src)) {
      const amt = Math.max(0, Math.round(res.dealt * share * healShare(src, R)));
      if (amt > 0) {
        rows.set(src.id, healed(src, amt));
        sourceHealed = amt;
      }
    }
  }
  return sourceHealed > 0 ? { ...res, sourceHealed } : res;
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
  return { bearer: f.bearer, key: f.key, label: f.label, landed: r.landed.map(l => ({ target: l.target, dealt: l.dealt, ...(l.healed ? { healed: l.healed } : {}) })) };
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
 * One land op on `t` at its average from `source`'s tier, read with `user` as the user, every amount times `times`; a
 * heal or a shield is `giver`'s to give (standing.ts `given`): the hitter, or null when no body lands it. A refund is time back on the bearer's own turn, which the
 * caller gives (triggers.ts); here it changes nothing.
 */
function landOne(o: LandOp, user: Body, giver: Body | null, t: Body, source: Source, now: Tick, R: OpRules, times: number, from: Side | null, cross: boolean):
  { target: Body; dealt: number; fired: LandFired | null; gained: StatusKey | null; cured: StatusKey | null; lands: readonly Status[] } {
  const scope: Scope = { user: { stats: user.stats, sheet: user.sheet }, target: { stats: t.stats, sheet: t.sheet }, charge: 0, kit: kitOf(user, t, R) };
  const at = (f: Tiered<Formula>) => average(atTier(f, source.tier), scope) * times;
  const none = { fired: null, gained: null, cured: null, lands: [] };
  switch (o.op) {
    case 'damage': {
      const by = user === t ? null : user, raw = Math.max(0, at(o.amount)) * damageShare(by, t, R) * dealtBy(by), dealt = afterDefence(raw, o.type, user.sheet, t.sheet, R);
      const s = throughShield(t, dealt, now);
      return { target: hurt(s.target, wardedDamage(s.target, dealt - s.absorbed)), dealt, ...none };
    }
    case 'heal': { const n = Math.max(0, Math.round(given(at(o.amount), giver) * healShare(t, R))); return { target: healed(t, n), dealt: 0, ...none }; }
    case 'applyStatus': {
      // a status a safeguard or a spent ward refuses is not put on, and so not gained. A land op has no map, so a hide it
      // puts on is not asked whether a foe watches its body (triggers.ts, fight-turn.ts and fight-react.ts hold no grid here)
      const p = landStatus(t, o, user, source, from, cross, false, now, R);
      return { target: p.breaks && channelBreaks(p.target, 0, true, now) ? broken(p.target, R) : p.target, dealt: 0, ...none, fired: p.fired, gained: p.put ? o.key : null };
    }
    case 'cureStatus': case 'dispel': {
      const c = cleansed(t, o, now, R);
      return { target: c.target, dealt: 0, ...none, cured: o.op === 'cureStatus' && c.gone.length ? o.key : null, lands: c.lands };
    }
    case 'delay': return { target: delayed(t, atTier(o.ticks, source.tier)), dealt: 0, ...none };
    case 'threat': return { target: source.id === null ? t : threatened(t, source.id, atTier(o.amount, source.tier)), dealt: 0, ...none };
    case 'shield': return { target: { ...t, shield: shieldOn(t, given(average(o.amount, scope) * times, giver), tick(now + R.fight.shieldLife * R.fight.round), now, R) }, dealt: 0, ...none };
    case 'mana': return { target: { ...t, mana: clamp(t.mana + Math.round(at(o.amount)), 0, t.sheet.manaMax) }, dealt: 0, ...none };
    case 'fatigue': return { target: { ...t, fatigue: clamp(t.fatigue + Math.round(at(o.amount)), 0, t.sheet.fatigueMax) }, dealt: 0, ...none };
    // rule 17: a break meets a protection as a use's does
    case 'channel': return { target: o.mode === 'break' && channelBreaks(t, 0, true, now) ? broken(t, R) : t, dealt: 0, ...none };
    case 'note': case 'refund': return { target: t, dealt: 0, ...none };
    case 'hasten': return { target: hasteOn(user, t, o.share, now, R), dealt: 0, ...none };
    case 'reveal': return { target: stealthAfter(t, { type: 'revealed' }, now, R), dealt: 0, ...none };
    case 'stagger': return { target: staggerOp(t, o.share * times, now, R).target, dealt: 0, ...none };
    // a move changes two bodies, so `landOps` lands it before it asks here
    case 'move': return { target: t, dealt: 0, ...none };
    // an echo picks its own body, so `landOps` lands it once after the targets
    case 'echo': return { target: t, dealt: 0, ...none };
    // a reform changes both user (mana) and dead minion (life), so `landOps` lands it before asking here
    case 'reform': return { target: t, dealt: 0, ...none };
    default: return o satisfies never;
  }
}
