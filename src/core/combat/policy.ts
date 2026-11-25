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
import { isDamage } from './damage-type.ts';
import type { Ability, CombatantId } from './ability-types.ts';
import { isUp, rowHp } from './row-hp.ts';
import type { Body } from './effect-ops.ts';
import { runningState } from './fight.ts';
import type { Command, Fight, Running } from './fight-types.ts';
import { counting, hides, warded } from './standing.ts';
import { perceivedBy } from './sight.ts';
import { dist, reachable } from './space.ts';
import type { Place } from './space.ts';
import { againstFoes, coversBody, needs, placeOf, usable, whoIsIn } from './resolve.ts';
import type { Aim, Needs, Rolls } from './resolve.ts';
import type { Tick } from './timeline.ts';
import { spotOf, stepToward } from './fight-view.ts';
import { taunter, threatOf } from './threat.ts';
import { omenMove, omenNeeds } from './fight-turn.ts';
import { ANSWERS, aimedBody, answerOutcome, scriptOf } from './mythic.ts';
import type { Answer } from './mythic.ts';
import type { MythicStanding, Omen } from './mythic-types.ts';

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
  if (!isDamage(type)) return 0;
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

/** The perceived living foe that a taunt forces `me` to target, or undefined when none holds it. */
const forcedOf = (me: Body, foes: readonly Body[]): Body | undefined => {
  const t = taunter(me);
  return t ? foes.find(b => b.id === t.by) : undefined;
};

/** The uses a monster may take on its turn: a mythic's act beat only those its phase's `acts` names (all of them under `every`). */
export function beatUses(me: Body, uses: readonly Ability[]): readonly Ability[] {
  const acts = me.mythic && scriptOf(me.mythic).phases[me.mythic.phase]?.acts;
  return !acts || acts === 'every' ? uses : uses.filter(a => acts.includes(a.name));
}
/** A monster: its intent when it may, else while taunted its strongest use on or a step toward its taunter, else its threat suggestion. */
function monsterChoice(f: Running, me: Body, all: readonly Ability[], foes: readonly Body[], R: Rules): TurnChoice {
  const uses = beatUses(me, all), forced = forcedOf(me, foes);
  const i = me.intent, intended = i && uses.find(a => a.id === i.ability);
  const intentAt = i ? placeOf(i.aim, f.rows) : null;
  const intentOk = !!intended && !!i && (!forced || !againstFoes(intended) || (intentAt !== null && coversBody(intended, me, intentAt, forced, f.grid)));
  if (intentOk && fits(f, me, intended, i.aim, R)) return { type: 'act', ability: intended, aim: i.aim };
  if (forced) return strongest(f, me, uses, [forced], R) ?? step(f, me, forced);
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
  const forced = forcedOf(me, foes);
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
/** Whether an answer of kind `how` still changes the omen: a cancel always, a weaken while it stands whole and has a weak move. */
function changes(w: Facing, how: Answer): boolean {
  const outcome = answerOutcome(w.omen, how);
  return outcome === 'cancel' || (outcome === 'weaken' && w.omen.weak !== null && w.s.at === 'omen');
}
/** Whether the omen's move is an area that tile `p` stands in (its ring included). A single-target move and a field have none to leave. */
function inArea(f: Running, w: Facing, side: Body['side'], p: Place): boolean {
  if (w.land.move.kind !== 'blast' || w.land.move.reach === 'field') return false;
  const at = placeOf(w.land.aim, f.rows);
  if (!at) return false;
  const { hit, ring } = whoIsIn(w.land.ability, { side: w.m.side, place: w.m.place }, [{ side, place: p }], at, f.grid);
  return hit.length + ring.length > 0;
}
/** Whether tile `p` is the one the omen aims at (a blast at a hunter's tile; decision 43's step answer). */
const aimTile = (w: Facing, p: Place): boolean => typeof w.s.aim !== 'string' && w.s.aim.x === p.x && w.s.aim.y === p.y;
/**
 * A step within a stride for `me`, onto no tile an omen aims at: when `off` (it stands on the tile an omen whose step
 * answer changes it aims at), the nearest such tile, out of every area on a tie, so a hunter in reach of the mythic
 * stays in reach; else the nearest tile out of every area. Nearer the mythic on a tie. Null when none is.
 */
function stepOut(f: Running, me: Body, ws: readonly Facing[], off: boolean): TurnChoice | null {
  const others = f.rows.filter(r => r.id !== me.id && (isUp(r) || r.kind === 'hunter')).map(r => r.place), m = ws[0]!.m;
  const out = (p: Place): boolean => !ws.some(w => inArea(f, w, me.side, p));
  const to = reachable(me.place, me.sheet.stride, f.grid, others)
    .filter(r => r.steps > 0 && !ws.some(w => aimTile(w, r.place)) && (off || out(r.place)))
    .sort((a, b) => a.steps - b.steps || Number(out(b.place)) - Number(out(a.place)) || dist(a.place, m.place) - dist(b.place, m.place))[0];
  return to ? { type: 'move', to: to.place } : null;
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
/** Whether the omen's move, at its average before armor, would take `b`'s HP (`shieldFrom` and the step out of an area ask it). */
function drops(w: Facing, b: Body, R: Rules): boolean {
  const formula = formulaOf(w.land.ability, R);
  return !!formula && average(formula, { user: w.m, target: b, charge: 0 }) >= rowHp(b);
}
/** `me`'s uses that put a shield on a body of its side. */
const shieldsOf = (uses: readonly Ability[]): Ability[] => uses.filter(a => a.aim !== 'foe' && (a.effect?.type === 'shield' || a.ops.some(o => o.op === 'shield')));
/** The first of `shields` `me` may put on `b`, as a choice. */
function shieldOn(f: Running, me: Body, shields: readonly Ability[], b: Body, R: Rules): TurnChoice | null {
  for (const a of shields) {
    if (a.aim === 'self' && b.id !== me.id) continue;
    const aim = aimAt(a, me, b);
    if (fits(f, me, a, aim, R)) return { type: 'act', ability: a, aim };
  }
  return null;
}
/**
 * A shield from `me` against the omen: on the hunter it is aimed at, when its shield answer changes it (decision 43);
 * else on a body it would drop, the one it names or the most hurt its area catches (every body of the side for a field)
 * whose HP its move's average, before armor, would take. A shield on a body the move leaves standing and the omen does
 * not answer to is a turn not spent on the fight (the mixed party's tank won 0.215 of the Angel's fights shielding every
 * body it hit, 0.44 never shielding: sim-log.md, MY5).
 */
function shieldFrom(f: Running, me: Body, uses: readonly Ability[], w: Facing, R: Rules): TurnChoice | null {
  const shields = shieldsOf(uses);
  if (!shields.length) return null;
  const aimed = changes(w, 'shield') ? aimedBody(w.s.aim, w.m.side, alliesOf(f, me)) : undefined;
  const answer = aimed && shieldOn(f, me, shields, aimed, R);
  if (answer) return answer;
  const bare = (b: Body): boolean => !(b.shield && b.shield.until > f.now);
  const move = w.land.move, hits = (b: Body): boolean =>
    move.kind !== 'blast' ? b.id === w.land.aim : move.reach === 'field' || inArea(f, w, b.side, b.place);
  const hit = alliesOf(f, me).filter(b => bare(b) && hits(b) && drops(w, b, R))
    .sort((a, b) => rowHp(a) / a.sheet.hpMax - rowHp(b) / b.sheet.hpMax || byId(a, b));
  for (const b of hit) { const c = shieldOn(f, me, shields, b, R); if (c) return c; }
  return null;
}
/**
 * A party row's answer to a foe mythic's standing omen (design B.4), the first that applies among `kinds`, in the order
 * of `ANSWERS`: a step off the tile it aims at when it stands there and the step answer changes the omen (decision 43),
 * or out of its tiles when it stands in them, its move would drop it, and it can (a step out of a hit it would stand
 * cost the Angel's answering party 0.103 of its wins against 0.147 without: sim-log.md, MY5 fifth pass); a status whose op the omen's interrupt names, while that outcome
 * still changes the omen; a shield on the hunter it aims at while the shield answer changes it, else on a body the omen
 * would drop (`shieldFrom`); while its stagger outcome changes the omen and its bar is at least half full, the strongest
 * hit on it; while its burst outcome does, the strongest hit on it. The shield comes before the hits, not last as B.4
 * lists it: a weaken leaves most of the move, and a body it drops is a hunter lost. Null when no omen stands or none
 * applies, and the row plays as it would.
 */
export function answerChoice(f: Running, me: Body, R: Rules, kinds: readonly Answer[] = ANSWERS): TurnChoice | null {
  if (me.threat) return null;
  const ws = facing(f, me, R);
  if (!ws.length) return null;
  const uses = me.abilities.filter(playable), on = (k: Answer): boolean => kinds.includes(k);
  if (on('step')) {
    const off = ws.some(w => changes(w, 'step') && aimTile(w, me.place));
    const out = off || ws.some(w => inArea(f, w, me.side, me.place) && drops(w, me, R)) ? stepOut(f, me, ws, off) : null;
    if (out) return out;
  }
  for (const w of ws) {
    const i = on('interrupt') && changes(w, 'interrupt') ? interrupt(f, me, uses, w, R) : null;
    if (i) return i;
  }
  for (const w of ws) { const s = on('shield') ? shieldFrom(f, me, uses, w, R) : null; if (s) return s; }
  for (const w of ws) {
    const bar = w.m.stagger, stagger = on('stagger') && changes(w, 'stagger') && bar !== null && bar.fill >= bar.max / 2;
    const burst = on('burst') && changes(w, 'burst');
    const hit = stagger || burst ? strongest(f, me, uses, [w.m], R) : null;
    if (hit) return hit;
  }
  return null;
}
/** `choice`, unless it walks `me` from outside a standing omen's tiles into them: then the turn is waited out. */
export function keptOut(f: Running, me: Body, R: Rules, choice: TurnChoice, kinds: readonly Answer[] = ANSWERS): TurnChoice {
  if (choice.type !== 'move' || !kinds.includes('step') || me.threat) return choice;
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

/** Why `autoMonsterTurn` cannot build a monster's automatic turn right now. */
export type AutoTurnRefusal = 'notNow' | 'dodging' | 'notYourTurn' | 'unknown' | 'down' | 'notMonster';

/**
 * What one automatic monster turn asks of the edge: refused (`kind: 'refused'`), a command ready to send
 * (`kind: 'ready'`, `needs: null`), or the dice (`kind: 'roll'`, `needs`) required to complete `command(rolls)`.
 * `note` is the fallback line when the fight emits no `used` or `dodgeAsked` effect (moves, waits, channel begin, or a
 * fizzled omen/release).
 */
export type AutoTurn =
  | { readonly kind: 'refused'; readonly reason: AutoTurnRefusal }
  | { readonly kind: 'ready'; readonly by: CombatantId; readonly choice: TurnChoice; readonly needs: null; readonly command: Command; readonly note: string }
  | { readonly kind: 'roll'; readonly by: CombatantId; readonly choice: TurnChoice; readonly needs: Needs; readonly command: (rolls: Rolls) => Command; readonly note: string };

/**
 * Builds the legal command for monster `by`'s current turn using `sensible`, paired with the dice it asks the edge to
 * roll (if any). When `at` is provided, rejects stale taps whose turn time has already advanced.
 */
export function autoMonsterTurn(f: Fight | null, by: CombatantId, R: Rules, at?: Tick): AutoTurn {
  if (!f || f.phase !== 'running') return { kind: 'refused', reason: 'notNow' };
  const state = runningState(f);
  if (state.at === 'dodging') return { kind: 'refused', reason: 'dodging' };
  if (state.at === 'owing') return { kind: 'refused', reason: 'notNow' };
  if (at !== undefined && f.now !== at) return { kind: 'refused', reason: 'notYourTurn' };
  if (f.currentId !== by) return { kind: 'refused', reason: 'notYourTurn' };
  const me = f.rows.find(r => r.id === by);
  if (!me) return { kind: 'refused', reason: 'unknown' };
  if (!isUp(me)) return { kind: 'refused', reason: 'down' };
  if (me.kind !== 'monster') return { kind: 'refused', reason: 'notMonster' };
  const choice = sensible(f, me, R);
  switch (choice.type) {
    case 'act': {
      if (state.at === 'landing' && state.id === me.id) {
        const n = omenNeeds(f, me, R);
        if (!n) return { kind: 'refused', reason: 'notNow' };
        return {
          kind: 'roll', by: me.id, choice, needs: n,
          command: rolls => ({ type: 'act', by: me.id, ability: choice.ability.id, aim: choice.aim, rolls }),
          note: `${choice.ability.name} hits no one.`,
        };
      }
      // Beginning a channel does not roll dice in `actWith`; passing empty rolls avoids spending a forced d20 early.
      if (choice.ability.channel) {
        return {
          kind: 'ready', by: me.id, choice, needs: null,
          command: { type: 'act', by: me.id, ability: choice.ability.id, aim: choice.aim, rolls: { dice: {}, react: {} } },
          note: `${me.name} begins to channel ${choice.ability.name}.`,
        };
      }
      const n = needs(choice.ability, me, f.rows, choice.aim, f.grid, f.now, R);
      return {
        kind: 'roll', by: me.id, choice, needs: n,
        command: rolls => ({ type: 'act', by: me.id, ability: choice.ability.id, aim: choice.aim, rolls }),
        note: `${me.name} uses ${choice.ability.name}.`,
      };
    }
    case 'release': {
      const c = me.channel, a = c && me.abilities.find(x => x.id === c.ability);
      if (!c || !a) return { kind: 'ready', by: me.id, choice: PASS, needs: null, command: { type: 'endTurn', by: me.id }, note: `${me.name} waits.` };
      const n = needs(a, me, f.rows, c.aim, f.grid, f.now, R);
      return {
        kind: 'roll', by: me.id, choice, needs: n,
        command: rolls => ({ type: 'release', by: me.id, rolls }),
        note: `${me.name}'s ${a.name} is released and hits nothing.`,
      };
    }
    case 'move':
      return {
        kind: 'ready', by: me.id, choice, needs: null,
        command: { type: 'move', by: me.id, to: choice.to, ...(choice.dash ? { dash: true } : {}) },
        note: choice.dash ? `${me.name} dashes.` : `${me.name} moves.`,
      };
    case 'pass': {
      const max = me.abilities.find(a => a.id === me.channel?.ability)?.channel?.max ?? R.fight.channelMax;
      const keeps = me.channel?.state === 'holding' && me.channel.charge < max;
      return {
        kind: 'ready', by: me.id, choice, needs: null,
        command: { type: 'endTurn', by: me.id },
        note: keeps ? `${me.name} keeps channeling.` : `${me.name} waits.`,
      };
    }
  }
}
