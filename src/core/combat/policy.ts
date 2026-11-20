// policy.ts: who decides for a row in a played fight (the odds engine, play.ts). A policy is a pure function from the
// fight and the row whose turn it is to a `TurnChoice`, written as a sensible player plays, not as an optimizer. `sensible`
// plays any row from what it holds: its own abilities, each asked of the rules' own check (`usable`: rules 2 to 5, aim,
// taunt, extra action, cooldown, cost, gates, prices, uses, range, and a body in its shape), so it never chooses what the reducer refuses. A
// monster plays its intent when it may, else on the target its threat table suggests (`threatOf`, the GM's card's rule).
// A new choice is a line of `sensible` with a case in tests/odds.test.ts; the tests' archetype policies
// (tests/models/fight-sim.ts) are policies too, passed to the same loop.
import type { Rules } from '../rules.ts';
import { average } from '../formula.ts';
import { formulaOf } from '../registry/ability-kinds.ts';
import type { Ability } from './ability-types.ts';
import { isUp, rowHp } from './row-hp.ts';
import type { Body } from './effect-ops.ts';
import type { Running } from './fight-types.ts';
import { concealed } from './standing.ts';
import { dist } from './space.ts';
import type { Place } from './space.ts';
import { usable, whoIsIn } from './resolve.ts';
import type { Aim } from './resolve.ts';
import { spotOf, stepToward, tauntOf, threatOf } from './fight-view.ts';

/** What a row does on its turn: a use, a move (a dash when `dash`), End turn, or a holding channel's release. */
export type TurnChoice =
  | { readonly type: 'act'; readonly ability: Ability; readonly aim: Aim }
  | { readonly type: 'move'; readonly to: Place; readonly dash?: boolean }
  | { readonly type: 'pass' }
  | { readonly type: 'release' };
/** What a row does on its turn in `f`, under the rules `R`. */
export type Policy = (f: Running, me: Body, R: Rules) => TurnChoice;

const PASS: TurnChoice = { type: 'pass' };
/** A hunter heals or shields an ally under this share of its max HP. */
const HURT = 0.5;

const byId = (a: Body, b: Body): number => (a.id < b.id ? -1 : 1);
const nearest = (me: Body, list: readonly Body[]): Body | undefined =>
  [...list].sort((a, b) => dist(me.place, a.place) - dist(me.place, b.place) || rowHp(a) - rowHp(b) || byId(a, b))[0];
const foesOf = (f: Running, me: Body): Body[] => f.rows.filter(r => r.side !== me.side && isUp(r) && !concealed(r, me.side));
const alliesOf = (f: Running, me: Body): Body[] => f.rows.filter(r => r.side === me.side && isUp(r));

/**
 * The abilities a policy plays on a turn: not a reaction (armed ahead, not used), not a move or a zone act (where to put
 * a body or a field is a choice the GM makes), not one priced in zones, not a hide (refused while seen).
 */
const playable = (a: Ability): boolean =>
  !a.react && !a.move && !a.zoneAct && !(a.prices ?? []).some(p => p.kind === 'zone')
  && !a.ops.some(o => o.op === 'applyStatus' && o.def.ops.some(x => x.op === 'hidden'));

const aimAt = (a: Ability, me: Body, t: Body): Aim => a.aim === 'place' ? t.place : a.aim === 'self' ? me.id : t.id;
const fits = (f: Running, me: Body, a: Ability, aim: Aim, R: Rules): boolean => usable(a, me, f.rows, aim, f.grid, f.now, R);

/** The bodies a use at `t` lands on, and whether it would catch one of the user's own side. */
function caught(f: Running, me: Body, a: Ability, t: Body): { foes: number; allies: boolean } {
  const onMap = f.rows.filter(r => isUp(r) || r.kind === 'hunter');
  const { hit, ring } = whoIsIn(a, me, onMap, t.place, f.grid);
  const all = [...hit, ...ring];
  return { foes: all.filter(b => b.side !== me.side && isUp(b)).length, allies: !a.foesOnly && all.some(b => b.side === me.side && b.id !== me.id) };
}
/** What one use of a damaging `a` on `t` is worth: its formula's average, once for each foe it catches. 0 for any other. */
function damageOf(f: Running, me: Body, a: Ability, t: Body, R: Rules): number {
  const type = a.effect?.type;
  if (type !== 'physical' && type !== 'magical') return 0;
  const formula = formulaOf(a, R);
  if (!formula) return 0;
  const { foes, allies } = caught(f, me, a, t);
  return allies ? 0 : Math.max(1, foes) * average(formula, { user: me, target: t, charge: 0 });
}
/** The status keys a use puts on its target. */
const putsOn = (a: Ability): string[] => a.ops.flatMap(o => (o.op === 'applyStatus' ? [o.key as string] : []));
const lacks = (b: Body, a: Ability, now: number): boolean => {
  const keys = putsOn(a);
  return keys.length > 0 && keys.some(k => !b.statuses.some(s => s.key === k && (s.until === null || s.until > now)));
};
const mends = (a: Ability): boolean => a.effect?.type === 'heal' || a.effect?.type === 'shield' || a.ops.some(o => o.op === 'shield');

/** The most damaging use among `uses` on any of `targets`, as a choice; null when none may be used. */
function strongest(f: Running, me: Body, uses: readonly Ability[], targets: readonly Body[], R: Rules): TurnChoice | null {
  let best: { choice: TurnChoice; worth: number } | null = null;
  for (const a of uses) for (const t of targets) {
    const worth = damageOf(f, me, a, t, R), aim = aimAt(a, me, t);
    if (worth > 0 && (!best || worth > best.worth) && fits(f, me, a, aim, R)) best = { choice: { type: 'act', ability: a, aim }, worth };
  }
  return best?.choice ?? null;
}
const step = (f: Running, me: Body, t: Body): TurnChoice => {
  const to = stepToward(f.rows.map(spotOf), me.id, t.id, me.sheet.stride, f.grid);
  return to ? { type: 'move', to: to.place } : PASS;
};

/** A monster: its intent when it may, else its strongest use on the target its threat table suggests, else a step toward it. */
function monsterChoice(f: Running, me: Body, uses: readonly Ability[], foes: readonly Body[], R: Rules): TurnChoice {
  const i = me.intent, intended = i && uses.find(a => a.id === i.ability);
  if (intended && i && fits(f, me, intended, i.aim, R)) return { type: 'act', ability: intended, aim: i.aim };
  const suggest = threatOf(f, me, R)?.suggest, target = foes.find(b => b.id === suggest) ?? nearest(me, foes)!;
  return strongest(f, me, uses, [target], R) ?? strongest(f, me, uses, foes, R) ?? step(f, me, target);
}

/**
 * Anyone else (a hunter, a shadow, a summon of the party): mends the most hurt of its side under half HP; calls its
 * summon when none of its own is up; puts a status on its target that the target lacks; uses its strongest damaging
 * ability on the nearest foe (the taunter while taunted), or on any foe it reaches; then a status on itself it lacks;
 * else steps toward the nearest foe.
 */
function partyChoice(f: Running, me: Body, uses: readonly Ability[], foes: readonly Body[], R: Rules): TurnChoice {
  const hurt = alliesOf(f, me).filter(b => rowHp(b) < HURT * b.sheet.hpMax && !(b.shield && b.shield.until > f.now))
    .sort((a, b) => rowHp(a) / a.sheet.hpMax - rowHp(b) / b.sheet.hpMax || byId(a, b));
  for (const b of hurt) for (const a of uses) {
    if (!mends(a) || (a.aim === 'self' && b.id !== me.id) || a.aim === 'foe') continue;
    const aim = aimAt(a, me, b);
    if (fits(f, me, a, aim, R)) return { type: 'act', ability: a, aim };
  }
  const mine = f.rows.some(r => r.owner === me.id && isUp(r));
  const call = !mine && uses.find(a => a.summon && fits(f, me, a, aimAt(a, me, me), R));
  if (call) return { type: 'act', ability: call, aim: aimAt(call, me, me) };
  const taunt = tauntOf(me, f.now, R), forced = taunt && foes.find(b => b.id === taunt.by);
  const target = forced || nearest(me, foes)!;
  const curse = uses.find(a => a.aim !== 'self' && a.aim !== 'ally' && !a.effect && lacks(target, a, f.now) && fits(f, me, a, aimAt(a, me, target), R));
  if (curse) return { type: 'act', ability: curse, aim: aimAt(curse, me, target) };
  const hit = strongest(f, me, uses, [target], R) ?? (forced ? null : strongest(f, me, uses, foes, R));
  if (hit) return hit;
  const buff = uses.find(a => a.aim === 'self' && !a.effect && !a.summon && lacks(me, a, f.now) && fits(f, me, a, me.id, R));
  if (buff) return { type: 'act', ability: buff, aim: me.id };
  return step(f, me, target);
}

/** The general policy: plays any row from what it holds (see the header). */
export const sensible: Policy = (f, me, R) => {
  if (me.channel?.state === 'holding') {
    const c = me.channel, max = me.abilities.find(a => a.id === c.ability)?.channel?.max ?? R.fight.channelMax;
    return c.charge >= max ? { type: 'release' } : PASS;
  }
  const foes = foesOf(f, me);
  if (!foes.length) return PASS;
  const uses = me.abilities.filter(playable);
  return me.threat ? monsterChoice(f, me, uses, foes, R) : partyChoice(f, me, uses, foes, R);
};
