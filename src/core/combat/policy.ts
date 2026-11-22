// policy.ts: who decides for a row in a played fight (the odds engine, play.ts). A policy is a pure function from the
// fight and the row whose turn it is to a `TurnChoice`, written as a sensible player plays, not as an optimizer. `sensible`
// plays any row from what it holds: its own abilities, each asked of the rules' own check (`usable`: rules 2 to 5, aim,
// taunt, extra action, cooldown, cost, gates, prices, uses, range, and a body in its shape), so it never chooses what the reducer refuses. A
// monster plays its intent when it may, else on the target its threat table suggests (`threatOf`, the GM's card's rule).
// A row chooses among the foes its side perceives (sight.ts `perceivedBy`, rule 2's question); a row whose side perceives
// none walks toward the nearest it would see with no fog (`soughtOf`), else passes.
// A mythic plays its script (notes-11-keystones.md, design B.4): on its landing turn the omen's move at its aim, on an act
// beat only its phase's `acts`. A party row facing a standing omen answers it first (`answerChoice`), and does not walk
// back into the omen's tiles (`keptOut`).
// A new choice is a line of `sensible` with a case in tests/odds.test.ts or tests/policy.test.ts; the tests' archetype
// policies (tests/models/fight-sim.ts) are policies too, passed to the same loop.
import type { Rules } from '../rules.ts';
import { average } from '../formula.ts';
import { formulaOf } from '../registry/ability-kinds.ts';
import type { Ability } from './ability-types.ts';
import { isUp, rowHp } from './row-hp.ts';
import type { Body } from './effect-ops.ts';
import type { Running } from './fight-types.ts';
import { counting, hides, warded } from './standing.ts';
import { perceivedBy } from './sight.ts';
import { dist, reachable } from './space.ts';
import type { Place } from './space.ts';
import { placeOf, usable, whoIsIn } from './resolve.ts';
import type { Aim } from './resolve.ts';
import { spotOf, stepToward, tauntOf } from './fight-view.ts';
import { threatOf } from './threat.ts';
import { omenMove } from './fight-turn.ts';
import { scriptOf } from './mythic.ts';
import type { AnswerOutcome, MythicStanding, Omen } from './mythic-types.ts';

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
/** The foes a row may choose: up, not warded from it, and perceived by its side (sight.ts `perceivedBy`, as rule 2 asks). */
const foesOf = (f: Running, me: Body): Body[] => f.rows.filter(r => r.side !== me.side && isUp(r) && !warded(r, me.side) && perceivedBy(me.side, r, f));
/**
 * The foes a row's side would perceive with no fog: where a side that sees no foe in a fog walks to find one, as a
 * player walks into the dark toward the fight. A foe hidden past every sight of the side is not sought.
 */
const soughtOf = (f: Running, me: Body): Body[] => f.rows.filter(r => r.side !== me.side && isUp(r) && !warded(r, me.side) && perceivedBy(me.side, r, { ...f, fog: null }));
const alliesOf = (f: Running, me: Body): Body[] => f.rows.filter(r => r.side === me.side && isUp(r));

/**
 * The abilities a policy plays on a turn: not a reaction (armed ahead, not used), not a move or a zone act (where to put
 * a body or a field is a choice the GM makes), not one priced in zones, not a hide (refused while seen).
 */
const playable = (a: Ability): boolean =>
  !a.react && !a.move && !a.zoneAct && !(a.prices ?? []).some(p => p.kind === 'zone')
  && !hides(a);

const aimAt = (a: Ability, me: Body, t: Body): Aim => a.aim === 'place' ? t.place : a.aim === 'self' ? me.id : t.id;
const fits = (f: Running, me: Body, a: Ability, aim: Aim, R: Rules): boolean => usable(a, me, f.rows, aim, f.grid, f.now, R, f.fog);

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
/** Whether `b` lacks a status `a` puts on: one it holds that does not count (standing.ts `counts`) is lacked. */
const lacks = (b: Body, a: Ability): boolean => {
  const keys = putsOn(a);
  return keys.length > 0 && keys.some(k => !counting(b.statuses).some(s => s.key === k));
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

/** The uses a monster may take on its turn: a mythic's act beat only those its phase's `acts` names (all of them under `every`). */
export function beatUses(me: Body, uses: readonly Ability[]): readonly Ability[] {
  const acts = me.mythic && scriptOf(me.mythic).phases[me.mythic.phase]?.acts;
  return !acts || acts === 'every' ? uses : uses.filter(a => acts.includes(a.name));
}
/** A monster: its intent when it may, else its strongest use on the target its threat table suggests, else a step toward it. */
function monsterChoice(f: Running, me: Body, all: readonly Ability[], foes: readonly Body[], R: Rules): TurnChoice {
  const uses = beatUses(me, all), i = me.intent, intended = i && uses.find(a => a.id === i.ability);
  if (intended && i && fits(f, me, intended, i.aim, R)) return { type: 'act', ability: intended, aim: i.aim };
  const suggest = threatOf(f, me)?.suggest, target = foes.find(b => b.id === suggest) ?? nearest(me, foes)!;
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
  const curse = uses.find(a => a.aim !== 'self' && a.aim !== 'ally' && !a.effect && lacks(target, a) && fits(f, me, a, aimAt(a, me, target), R));
  if (curse) return { type: 'act', ability: curse, aim: aimAt(curse, me, target) };
  const hit = strongest(f, me, uses, [target], R) ?? (forced ? null : strongest(f, me, uses, foes, R));
  if (hit) return hit;
  const buff = uses.find(a => a.aim === 'self' && !a.effect && !a.summon && lacks(me, a) && fits(f, me, a, me.id, R));
  if (buff) return { type: 'act', ability: buff, aim: me.id };
  return step(f, me, target);
}

// ── a mythic's omen and the party's answers (design B.4) ──
/**
 * The answers a party row makes to a standing omen, in the order `answerChoice` tries them: step out of its tiles, land
 * a status whose op its interrupt names, shield a body it would drop, break its stagger bar, take its burst share of HP.
 */
export const ANSWER_KINDS = ['move', 'interrupt', 'shield', 'stagger', 'burst'] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];
/** A foe mythic whose omen stands: the row, its standing, the omen, and the move that lands on its next turn with its aim. */
type Facing = {
  readonly m: Body; readonly s: Extract<MythicStanding, { readonly at: 'omen' | 'faltering' }>; readonly omen: Omen;
  readonly land: NonNullable<ReturnType<typeof omenMove>>;
};
function facing(f: Running, me: Body, R: Rules): Facing[] {
  return f.rows.flatMap(m => {
    const s = m.mythic;
    if (m.side === me.side || !isUp(m) || !s || s.at === 'calm') return [];
    const omen = scriptOf(s).omens[s.omen], land = omenMove(m, R);
    return omen && land ? [{ m, s, omen, land }] : [];
  });
}
/** Whether an answer of `outcome` still changes the omen: a cancel always, a weaken while it stands whole and has a weak move. */
const changes = (w: Facing, outcome: AnswerOutcome): boolean =>
  outcome === 'cancel' || (outcome === 'weaken' && w.omen.weak !== null && w.s.at === 'omen');
/** Whether the omen's move is an area that tile `p` stands in (its ring included). A single-target move and a field have none to leave. */
function inArea(f: Running, w: Facing, side: Body['side'], p: Place): boolean {
  if (w.land.move.kind !== 'blast' || w.land.move.reach === 'field') return false;
  const at = placeOf(w.land.aim, f.rows);
  if (!at) return false;
  const { hit, ring } = whoIsIn(w.land.ability, { side: w.m.side, place: w.m.place }, [{ side, place: p }], at, f.grid);
  return hit.length + ring.length > 0;
}
/** The nearest tile within a stride out of every standing omen's area, nearer the mythic on a tie; null when none is. */
function stepOut(f: Running, me: Body, ws: readonly Facing[]): TurnChoice | null {
  const others = f.rows.filter(r => r.id !== me.id && (isUp(r) || r.kind === 'hunter')).map(r => r.place), m = ws[0]!.m;
  const out = reachable(me.place, me.sheet.stride, f.grid, others)
    .filter(r => r.steps > 0 && !ws.some(w => inArea(f, w, me.side, r.place)))
    .sort((a, b) => a.steps - b.steps || dist(a.place, m.place) - dist(b.place, m.place))[0];
  return out ? { type: 'move', to: out.place } : null;
}
/** A use of `me`'s that lands on `w`'s mythic a status it lacks holding an op the omen's interrupt names. */
function interrupt(f: Running, me: Body, uses: readonly Ability[], w: Facing, R: Rules): TurnChoice | null {
  const by: readonly string[] = w.omen.interrupt.by;
  for (const a of uses) {
    const keys = a.ops.flatMap(o => (o.op === 'applyStatus' && o.def.ops.some(x => by.includes(x.op)) ? [o.key as string] : []));
    const aim = aimAt(a, me, w.m);
    if (keys.some(k => !w.m.statuses.some(s => s.key === k)) && fits(f, me, a, aim, R)) return { type: 'act', ability: a, aim };
  }
  return null;
}
/**
 * A shield from `me` on a body the omen would drop: the one it names, or the most hurt its area catches (every body of the
 * side for a field) whose HP its move's average, before armor, would take. A shield on a body the move leaves standing
 * is a turn not spent on the fight (the mixed party's tank won 0.215 of the Angel's fights shielding every body it hit,
 * 0.44 never shielding: sim-log.md, MY5).
 */
function shieldFrom(f: Running, me: Body, uses: readonly Ability[], w: Facing, R: Rules): TurnChoice | null {
  const shields = uses.filter(a => a.aim !== 'foe' && (a.effect?.type === 'shield' || a.ops.some(o => o.op === 'shield')));
  const formula = formulaOf(w.land.ability, R);
  if (!shields.length || !formula) return null;
  const bare = (b: Body): boolean => !(b.shield && b.shield.until > f.now);
  const falls = (b: Body): boolean => average(formula, { user: w.m, target: b, charge: 0 }) >= rowHp(b);
  const move = w.land.move, hits = (b: Body): boolean =>
    move.kind !== 'blast' ? b.id === w.land.aim : move.reach === 'field' || inArea(f, w, b.side, b.place);
  const hit = alliesOf(f, me).filter(b => bare(b) && hits(b) && falls(b))
    .sort((a, b) => rowHp(a) / a.sheet.hpMax - rowHp(b) / b.sheet.hpMax || byId(a, b));
  for (const b of hit) for (const a of shields) {
    if (a.aim === 'self' && b.id !== me.id) continue;
    const aim = aimAt(a, me, b);
    if (fits(f, me, a, aim, R)) return { type: 'act', ability: a, aim };
  }
  return null;
}
/**
 * A party row's answer to a foe mythic's standing omen (design B.4), the first that applies among `kinds`: step out of
 * the omen's tiles when it stands in them and can; a status whose op the omen's interrupt names, while that outcome
 * still changes the omen; a shield on a body the omen would drop (`shieldFrom`); while its stagger outcome changes the
 * omen and its bar is at least half full, the strongest hit on it; while its burst outcome does, the strongest hit on it.
 * The shield comes before the hits, not last as B.4 lists it: a weaken leaves most of the move, and a body it drops is a
 * hunter lost. Null when no omen stands or none applies, and the row plays as it would.
 */
export function answerChoice(f: Running, me: Body, R: Rules, kinds: readonly AnswerKind[] = ANSWER_KINDS): TurnChoice | null {
  if (me.threat) return null;
  const ws = facing(f, me, R);
  if (!ws.length) return null;
  const uses = me.abilities.filter(playable), on = (k: AnswerKind): boolean => kinds.includes(k);
  if (on('move') && ws.some(w => inArea(f, w, me.side, me.place))) { const out = stepOut(f, me, ws); if (out) return out; }
  for (const w of ws) {
    const i = on('interrupt') && changes(w, w.omen.interrupt.outcome) ? interrupt(f, me, uses, w, R) : null;
    if (i) return i;
  }
  for (const w of ws) { const s = on('shield') ? shieldFrom(f, me, uses, w, R) : null; if (s) return s; }
  for (const w of ws) {
    const bar = w.m.stagger, stagger = on('stagger') && changes(w, w.omen.stagger) && bar !== null && bar.fill >= bar.max / 2;
    const burst = on('burst') && w.omen.burst !== null && changes(w, w.omen.burst.outcome);
    const hit = stagger || burst ? strongest(f, me, uses, [w.m], R) : null;
    if (hit) return hit;
  }
  return null;
}
/** `choice`, unless it walks `me` from outside a standing omen's tiles into them: then the turn is waited out. */
export function keptOut(f: Running, me: Body, R: Rules, choice: TurnChoice, kinds: readonly AnswerKind[] = ANSWER_KINDS): TurnChoice {
  if (choice.type !== 'move' || !kinds.includes('move') || me.threat) return choice;
  const ws = facing(f, me, R);
  return ws.some(w => inArea(f, w, me.side, choice.to) && !inArea(f, w, me.side, me.place)) ? PASS : choice;
}

/** The general policy: plays any row from what it holds (see the header). */
export const sensible: Policy = (f, me, R) => {
  const landing = me.mythic && me.mythic.at !== 'calm' ? omenMove(me, R) : null;
  if (landing) return { type: 'act', ability: landing.ability, aim: landing.aim };
  if (me.channel?.state === 'holding') {
    const c = me.channel, max = me.abilities.find(a => a.id === c.ability)?.channel?.max ?? R.fight.channelMax;
    return c.charge >= max ? { type: 'release' } : PASS;
  }
  const foes = foesOf(f, me);
  if (!foes.length) { const sought = nearest(me, soughtOf(f, me)); return sought ? step(f, me, sought) : PASS; }
  const uses = me.abilities.filter(playable);
  return me.threat ? monsterChoice(f, me, uses, foes, R) : answerChoice(f, me, R) ?? keptOut(f, me, R, partyChoice(f, me, uses, foes, R));
};
