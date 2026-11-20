// fight.ts: the reworked fight as one pure reducer (docs/agent-handoff/rw/design.md sections 1, 3, 4 and 5). Every change
// goes through `reduce`, which never mutates its input, never rolls and never throws: dice arrive inside commands, and
// what happens outside the fight comes back as effects. The fight's states are one table, `TABLE`, the typecheck checks
// cell by cell; a channel's is fight-channel.ts. Stagger, shields and threat are data with one rule each in resolve.ts
// (rules 13, 15 and 16) and fight-turn.ts (expiry and decay by time), not machines. Types: fight-types.ts. Turns:
// fight-turn.ts. Stored or received fights: fight-parse.ts. A new command is a member of `Command` and its cell in every
// row of `TABLE`, with a test in tests/fight.test.ts.
import { tallied } from './row-tally.ts';
import type { Rules } from '../rules.ts';
import { diceOf } from '../formula.ts';
import type { Dice } from '../formula.ts';
import { defaultPlace, dist, GRID_SIDE, openGrid, pathCost, place, sees, straightCost, TERRAIN } from './space.ts';
import type { Place } from './space.ts';
import { acted, cost, interval, opening, paceCost, tick, walkCost } from './timeline.ts';
import type { Tick } from './timeline.ts';
import { applyStatus, modified, removeStatus, statusOn, statusShield, withStatuses } from './effect-ops.ts';
import { atTier } from './op-amount.ts';
import type { Body, Status, StatusKey } from './effect-ops.ts';
import { landUse, leftZone, placeOf, ready, resolve } from './resolve.ts';
import { alive } from './land.ts';
import type { Resolved } from './resolve.ts';
import { fireReaction, reactorsFor, reactState, reactStep, withReact } from './fight-react.ts';
import { holds, stealthStep } from './standing.ts';
import { counted, usesGates } from './uses.ts';
import type { Aim } from './resolve.ts';
import { combatantId } from './ability-types.ts';
import type { Ability, CombatantId, Outcome } from './ability-types.ts';
import { channelCan, channelStep } from './fight-channel.ts';
import { eventsOf, raised } from './triggers.ts';
import { consequences, D20, ended, held, holdsSide, isUp, logged, marked, overIf, partyView, payDue, rowLife, rowOf, sentAway, spreadTo, startTurn, triggered, uncovered, withRow, writeBack, zoneEnds } from './fight-turn.ts';
import { hpOf, refilled } from '../hunter/vitals.ts';
import { summonRow } from './rows.ts';
import { crowded } from './summons.ts';
import { line, MAX_ROWS, MAX_STATUSES, pendingKey } from './fight-types.ts';
import { attemptsLeft, extractionStep, UNTRIED } from './extraction.ts';
import { entryKey, MAX_ZONE_TILES, MAX_ZONES, oldEnough, placeZone, pricedZones, zoneActed, zoneStep } from './zones.ts';
import type { Zone } from './zones.ts';
import type { Command, CommandType, Ctx, Effect, Fight, LogLine, NewRow, Opening, Refusal, Result, Running, Setup } from './fight-types.ts';

export * from './fight-types.ts';
export { channelCan, channelStep } from './fight-channel.ts';

type Fx = Effect[];
const refused = (fight: Fight | null, reason: Refusal): Result => ({ fight, effects: [{ type: 'refused', reason }] });
const done = (fight: Fight | null, fx: Fx): Result => ({ fight, effects: fx });

// ── the table ──
/** The fight's states: no fight, and each phase. */
export const FIGHT_STATES = ['none', 'setup', 'running', 'ended'] as const;
export type FightState = (typeof FIGHT_STATES)[number];
export const stateOf = (f: Fight | null): FightState => f?.phase ?? 'none';
type In<S extends FightState> = S extends 'none' ? null : Extract<Fight, { phase: S }>;
type Step<S extends FightState, T extends CommandType> = (f: In<S>, cmd: Extract<Command, { type: T }>, ctx: Ctx) => Result;
/** For one state: what each command does there. `null` means it does not apply: the command is refused and nothing changes. */
type Row<S extends FightState> = { readonly [T in CommandType]: Step<S, T> | null };

// ── who is where ──
const freeAt = (f: Fight, p: Place, except: string | null): boolean =>
  p.x >= 0 && p.y >= 0 && p.x < f.grid.w && p.y < f.grid.h && TERRAIN[f.grid.tiles?.[p.y * f.grid.w + p.x] ?? 'floor'].walk
  && !f.rows.some(r => r.id !== except && alive(r) && r.place.x === p.x && p.y === r.place.y);
const offGrid = (f: Fight, p: Place): boolean => p.x < 0 || p.y < 0 || p.x >= f.grid.w || p.y >= f.grid.h;
const placeRefusal = (f: Fight, p: Place, id: string): Refusal | null => offGrid(f, p) ? 'offGrid' : freeAt(f, p, id) ? null : 'taken';
/** An aim is a row of the fight or a tile of its grid (a wall too: a blast may be centred on one). */
const aimRefusal = (f: Fight, aim: Aim): Refusal | null =>
  typeof aim === 'string' ? (rowOf(f, aim) ? null : 'noTarget') : offGrid(f, aim) ? 'offGrid' : null;

// ── add, remove, start, end ──
/** A row as it stands in the fight: its sheet worked out from its origin and statuses, at `place`, waiting from `at`. */
function rowFrom(nr: NewRow, place: Place, at: Tick, tie: number, R: Rules): Body {
  const { stats, sheet } = modified(nr.origin, nr.statuses, R);
  return { ...nr, place, stats, sheet, speed: sheet.speed, at, tie };
}
const openingOf = (b: { speed: number; sheet: Body['sheet'] }, o: Opening, now: Tick, R: Rules): Tick => opening(now, b.speed, o.d20 + b.sheet.opening, R.fight);

/**
 * A row as it joins at `now`: its statuses' times are from its joining (rows.ts builds them from tick 0), so each moves
 * to the fight's now. The one place a joining row's clock starts.
 */
const joined = (nr: NewRow, now: Tick): NewRow => now === 0 ? nr : {
  ...nr, statuses: nr.statuses.map(s => ({ ...s, since: tick(s.since + now), settledAt: tick(s.settledAt + now), until: s.until === null ? null : tick(s.until + now) })),
};
/**
 * Rows join, all or none, their statuses from the fight's now (`joined`; 0 in setup). A row without a free place takes
 * its side's next free start (a map's), else its side's default place. While running each needs its opening.
 */
function add<F extends Setup | Running>(f: F, cmd: Extract<Command, { type: 'add' }>, ctx: Ctx): Result | F {
  const R = ctx.rules;
  let g: F = f;
  if (f.rows.length + cmd.rows.length > MAX_ROWS) return refused(f, 'tooMany');
  for (const nr of cmd.rows) {
    if (rowOf(g, nr.id)) return refused(f, 'duplicate');
    const asked = nr.place && freeAt(g, nr.place, null) ? nr.place : null;
    const start = asked ? null : cmd.starts?.[nr.side].find(p => freeAt(g, p, null)) ?? null;
    const place = asked ?? start ?? defaultPlace(nr.side, g.rows.filter(alive).map(r => r.place), g.grid, R.fight);
    if (!place) return refused(f, 'noPlace');
    const o = cmd.openings.find(x => x.id === nr.id);
    if (g.phase === 'running' && !o) return refused(f, 'needsRoll');
    const base = rowFrom(joined(nr, g.phase === 'running' ? g.now : tick(0)), place, tick(0), 0, R);
    const row = g.phase === 'running' && o ? { ...base, at: openingOf(base, o, g.now, R), tie: o.tie } : base;
    g = { ...g, rows: [...g.rows, row] };
  }
  return logged(g, line(`${cmd.rows.map(r => r.name).join(', ')} ${cmd.rows.length === 1 ? 'joins' : 'join'}.`, [...cmd.rows.map(r => r.id)]), R);
}
const addTo = <F extends Setup | Running>(f: F, cmd: Extract<Command, { type: 'add' }>, ctx: Ctx): Result => {
  const r = add(f, cmd, ctx);
  if ('effects' in r) return r;
  // a row that joins on a zone stands in it from now
  return r.phase === 'running' ? after(f as Running, r as Running, '', null, ctx, []) : done(r, []);
};
const create: Step<'none', 'add'> = (_f, cmd, ctx) => {
  const grid = cmd.grid ?? openGrid(ctx.rules.fight.grid.w, ctx.rules.fight.grid.h);
  const setup: Setup = { phase: 'setup', id: cmd.fightId, grid, zones: cmd.zones ?? [], fog: cmd.fog ?? null, rows: [], log: [], banked: 0, had: {} };
  const r = add(setup, cmd, ctx);
  return 'effects' in r ? { fight: null, effects: r.effects } : done(r, []);
};

function removeFrom<F extends Setup | Running>(f: F, id: string, R: Rules): F | null {
  const row = rowOf(f, id);
  if (!row) return null;
  const rows = f.rows.filter(r => r.id !== id).map(r => {
    if (!r.threat || !(id in r.threat)) return r;
    return { ...r, threat: Object.fromEntries(Object.entries(r.threat).filter(([k]) => k !== id)) };
  });
  // A foe removed while down keeps the XP it earned the party.
  const g = { ...f, rows, banked: row.side === 'foe' && !isUp(row) ? f.banked + row.xp : f.banked };
  return logged(g.phase === 'running' ? { ...g, pending: g.pending.filter(p => p.id !== id) } : g, line(`${row.name} leaves the fight.`, [row.id]), R);
}
const removeInSetup: Step<'setup', 'remove'> = (f, cmd, ctx) => { const g = removeFrom(f, cmd.id, ctx.rules); return g ? done(g, []) : refused(f, 'unknown'); };
const removeRunning: Step<'running', 'remove'> = (f, cmd, ctx) => {
  const g = removeFrom(f, cmd.id, ctx.rules);
  if (!g) return refused(f, 'unknown');
  const fx: Fx = [];
  // a zone that ends with the row that left is gone
  const h = consequences(g.rows, g, ctx, fx);
  // the row that left, or a summon of it (kits table 2.4), may have been the current one
  return done(cmd.id === f.currentId || !rowOf(h, h.currentId) ? startTurn(h, ctx, fx) : overIf(h, fx, ctx.rules) ?? h, fx);
};

/** Every row's first turn from its opening roll; then the first turn starts. Both sides need someone up. */
const start: Step<'setup', 'start'> = (f, cmd, ctx) => {
  const R = ctx.rules;
  if (!f.rows.some(r => r.side === 'party' && isUp(r)) || !f.rows.some(r => r.side === 'foe' && isUp(r))) return refused(f, 'needBothSides');
  const rows: Body[] = [];
  for (const r of f.rows) {
    const o = cmd.openings.find(x => x.id === r.id);
    if (!o) return refused(f, 'needsRoll');
    // a surprised side's openings come `kit.surprise` rounds later, but an alert row's (kits design 8.7.5)
    const late = cmd.surprised === r.side && !holds(r, 'alert') ? R.fight.kit.surprise * R.fight.round : 0;
    rows.push({ ...r, at: tick(openingOf(r, o, tick(0), R) + late), tie: o.tie });
  }
  const running: Running = { ...f, phase: 'running', rows, now: tick(0), currentId: rows[0]!.id, pending: [] };
  const fx: Fx = [];
  // who stands in a zone as the fight begins holds it from time 0
  const begins = cmd.surprised ? `The fight begins: the ${cmd.surprised === 'party' ? 'party is' : 'foes are'} surprised.` : 'The fight begins.';
  return done(startTurn(consequences(rows, logged(running, line(begins), R), ctx, fx), ctx, fx), fx);
};

const end = (f: Setup | Running, ctx: Ctx): Result => {
  const fx: Fx = [];
  const up = (['party', 'foe'] as const).filter(side => f.rows.some(r => r.side === side && holdsSide(r)));
  return done(ended(f, up.length === 1 ? up[0]! : null, fx, ctx.rules), fx);
};

// ── a turn's actions ──
/** Whether `by` may take this turn's action: in the fight, up, and the current one (or the GM forcing it). */
function actor(f: Running, by: string, force: boolean): Body | Refusal {
  const u = rowOf(f, by);
  if (!u) return 'unknown';
  if (!isUp(u)) return 'down';
  if (!force && by !== f.currentId) return 'notYourTurn';
  return u;
}

/**
 * After `by`'s action: the effects of what changed, then the next turn when it was `by`'s turn, or when the current row
 * can no longer take this one (down, held, or its turn pushed past now by a use out of turn).
 */
function after(before: Running, g: Running, by: string, said: LogLine | null, ctx: Ctx, fx: Fx, forced?: ReadonlySet<string>): Result {
  let x = said ? logged(g, said, ctx.rules) : g;
  // a turn's action spent: its bearer's turn ends (rule 19b's turnEnd, kits design 1.3)
  if (by && by === g.currentId) x = triggered(x, [raised(g.currentId, 'turnEnd')], ctx);
  const h = consequences(before.rows, x, ctx, fx, forced);
  const over = overIf(h, fx, ctx.rules);
  if (over) return done(over, fx);
  const cur = rowOf(h, h.currentId);
  const lost = !cur || !isUp(cur) || held(cur, h.now) || cur.at > h.now;
  return done(by === h.currentId || lost ? startTurn(h, ctx, fx) : h, fx);
}

/** A row about to act or move: a holding or broken channel ends without going off. */
const dropChannel = (u: Body): Body => u.channel && channelCan(u.channel, 'drop') ? { ...u, channel: channelStep(u.channel, { type: 'drop' }) } : u;

const act: Step<'running', 'act'> = (f, cmd, ctx) => {
  const R = ctx.rules, who = actor(f, cmd.by, cmd.force === true);
  if (typeof who === 'string') return refused(f, who);
  const a = who.abilities.find(x => x.id === cmd.ability);
  if (!a) return refused(f, 'unknownAbility');
  const badAim = aimRefusal(f, cmd.aim);
  if (badAim) return refused(f, badAim);
  const u = { ...dropChannel(who), intent: null };
  const rows = f.rows.map(r => r.id === u.id ? u : r);
  // Rule 4's zone price (kits design 1.4.3): the user must hold a zone of each price's name
  const at = placeOf(cmd.aim, rows)!, zonePrices = (a.prices ?? []).flatMap(p => (p.kind === 'zone' ? [p] : []));
  if (zonePrices.some(p => !pricedZones(f.zones, u.id, p, at, rows, f.grid, f.now, R).length)) return refused(f, 'zone');
  const taken = zonePrices.flatMap(p => pricedZones(f.zones, u.id, p, at, rows, f.grid, f.now, R));
  // table 8.9.4: a hide while a foe that is up sees the tile leaves its user seen, refused; a channel's at its begin, since its release is never refused
  if (hides(a) && stealthStep('seen', { type: 'hide', seen: seenByFoes(f, u, R) }) === 'seen') return refused(f, 'seen');
  // a channel's begin is a use's rules 2 to 5 (`ready`): it pays what a use pays, once, its zone price too; its release lands what was paid
  if (a.channel) {
    const ok = ready(a, u, rows, cmd.aim, f.grid, f.now, R);
    if (typeof ok === 'string') return refused(f, ok);
    const c = acted({ ...counted(ok.paid, a, R), channel: channelStep(null, { type: 'begin', ability: a.id, aim: cmd.aim, spent: ok.spent }) }, f.now, a.cost.time, R.fight);
    const begun = logged({ ...withRow(f, c), zones: f.zones.filter(z => !taken.includes(z)) }, line(`${u.name} begins to channel ${a.name}.`, [u.id]), R);
    return after(f, zoneEnds(begun, landingOf(taken, f.now, R), rows, ctx), u.id, null, ctx, []);
  }
  const resolved = resolve(a, u, rows, cmd.aim, f.grid, cmd.rolls, f.now, R);
  if (resolved.ok === false) return refused(f, resolved.reason);
  // table 2.3: a use that resolved is one more spent of an ability limited a fight or a rest
  const r = { ...resolved, bodies: resolved.bodies.map(b => b.id === u.id ? counted(b, a, R) : b) };
  const forced = cmd.force && cmd.by !== f.currentId ? ' (GM)' : '';
  return landed(f, { a, u, rows, at, r, taken, head: `${u.name} uses ${a.name}${forced}`, by: u.id }, ctx);
};

/** The zones a zone price took whose end lands: those a round old or more (table 2.6). */
const landingOf = (taken: readonly Zone[], now: Tick, R: Rules): Zone[] => taken.filter(z => zoneStep({ at: 'laid' }, { type: 'price', old: oldEnough(z, now, R) }).lands);

/**
 * A use that landed, as `act` and a channel's `release` hand it on: the ability, its user and the rows as the use found
 * them, the tile it aimed at, what `landUse` answered (with what the command does to its user: a use counted, a channel
 * gone off; and the reactions it set off), the zones its price takes now, the start of its log line, and who acted (none
 * for a broken channel going off out of its user's turn, which is no turn's action).
 */
type Landed = {
  readonly a: Ability; readonly u: Body; readonly rows: readonly Body[]; readonly at: Place;
  readonly r: Extract<Resolved, { readonly ok: true }>; readonly taken: readonly Zone[];
  readonly head: string; readonly by: string;
};
/**
 * What follows a use that landed, the one path of `act` and `release`, so a rule added here holds for both: acting on a
 * foe or a place ends its user's ward and hide (kits design 8.1, 8.7.3); one log line naming each target's outcome
 * (rule 20); the zones its price took end and its own goes down (rule 18b); a summon (18d); a zone act (kits 8.5.4),
 * whose bodies, as a shove's, pay no entry (8.3.4, 8.5.5); the tally; its triggers (19b); the `after` reactions (19c);
 * then the next turn.
 */
function landed(f: Running, use: Landed, ctx: Ctx): Result {
  const R = ctx.rules, { a, u, rows, at, taken } = use, reacted = use.r.reacted;
  // acting on a foe or a place ends the user's untargetable and hidden statuses, after the use (kits design 8.1, 8.7)
  const ends = (a.aim === 'foe' || a.aim === 'place') && !hides(a);
  const r = ends ? { ...use.r, bodies: use.r.bodies.map(b => b.id === u.id ? uncovered(b, f.now, R) : b) } : use.r;
  const said = [
    ...reacted.said, ...reacted.lethal,
    ...r.outcomes.map(o => `${rowOf(f, o.target)?.name ?? o.target} ${o.avoid === 'out' ? 'avoids it' : `${o.avoid}${o.crit ? ', crit' : ''}${o.dealt ? ` ${o.dealt}` : ''}`}`),
    ...r.bursts.map(b => `${rowOf(f, b.bearer)?.name ?? b.bearer}'s ${b.label} goes off${b.landed.some(l => l.dealt) ? ` (${b.landed.map(l => `${rowOf(f, l.target)?.name ?? l.target} ${l.dealt}`).join(', ')})` : ''}`),
  ];
  // the zones its price ends land their ends when old enough (table 2.6), then its own zone goes down (rule 18b, the cap per owner)
  const rest = f.zones.filter(z => !taken.includes(z));
  const left = leftZone(a, u, at, f.grid, f.now, rest, R);
  const placed = left ? placeZone(rest, left, R) : { zones: rest, evicted: [] };
  const useLine = `${use.head}${said.length ? `: ${said.join(', ')}` : ''}${left ? `; ${left.name} covers the ground` : ''}${placed.evicted.length ? `; ${placed.evicted.map(z => z.name).join(', ')} gives way` : ''}.`;
  const about = [u.id, ...reacted.about, ...r.outcomes.map(o => o.target), ...r.bursts.flatMap(b => [b.bearer, ...b.landed.map(l => l.target)])];
  const used0 = summoned(zoneEnds(logged({ ...f, rows: r.bodies, zones: placed.zones }, line(useLine, about, [...(left ? [left.id] : []), ...placed.evicted.map(z => z.id)]), R), landingOf(taken, f.now, R), rows, ctx), a, u.id, ctx);
  // a zone act (kits design 8.5.4): a zone moved or widened onto a body pays it no entry, as a forced move pays none (8.5.5)
  const z = a.zoneAct ? zoneActed(used0.zones, u.id, a.zoneAct, at, used0.rows, used0.grid, used0.now, R) : null;
  const used = z?.acted ? logged({ ...used0, zones: z.zones }, line(`${z.acted.name} ${a.zoneAct!.act === 'shift' ? 'moves' : 'widens'}.`, [], [z.acted.id]), R) : used0;
  const pushedIn = new Set<string>(z?.acted ? used.rows.map(b => b.id) : r.shoved);
  const scored = { ...used, rows: tallied(used.rows, { type: 'used', by: u.id, ability: a, outcomes: r.outcomes, before: rows }) };
  const fired = triggered(scored, eventsOf(a, u.id, r.outcomes, rows, scored.rows), ctx);
  return after(f, afterReactions(fired, u.id, r.outcomes, R, reacted.count), use.by, null, ctx, [{ type: 'used', by: u.id, ability: a.id, line: useLine }, ...critsOf(r.outcomes), ...burstsOf(r.bursts)], pushedIn);
}

/**
 * Rule 18d (kits design 1.9): an ability that summons calls a row to its user's side, at the first free tile nearest the
 * user (by distance, then `y`, then `x`), its first turn a standard interval from now with no opening die. A summon of
 * an owner who already holds `kit.summons` sends the oldest away first. With no free tile, or `MAX_ROWS` in the fight,
 * nobody comes.
 */
function summoned(f: Running, a: Ability, by: CombatantId, ctx: Ctx): Running {
  const R = ctx.rules, u = rowOf(f, by);
  if (!a.summon || !u || !isUp(u)) return f;
  const g = sentAway(f, crowded(f.rows, u.id, R), 'leaves: a newer summon took its place', ctx);
  if (g.rows.length >= MAX_ROWS) return g;
  const d = Math.max(g.grid.w, g.grid.h), spots: Place[] = [];
  for (let y = 0; y < g.grid.h; y++) for (let x = 0; x < g.grid.w; x++) if (Math.max(Math.abs(x - u.place.x), Math.abs(y - u.place.y)) <= d) spots.push(place(x, y));
  const at = spots.filter(p => freeAt(g, p, null)).sort((p, q) => dist(p, u.place) - dist(q, u.place) || p.y - q.y || p.x - q.x)[0];
  if (!at) return g;
  let n = 1;
  while (rowOf(g, `${u.id}~${g.now}-${n}`)) n++;
  const nr = summonRow(u, a.summon, combatantId(`${u.id}~${g.now}-${n}`), g.now, R);
  const base = rowFrom(nr, at, tick(0), 0, R), row = { ...base, at: tick(g.now + interval(base.speed, paceCost('standard', R.fight), R.fight)) };
  return logged({ ...g, rows: [...g.rows, row] }, line(`${u.name} calls ${row.name}.`, [u.id, row.id]), R);
}

/**
 * Rule 19c (kits design 8.4.1): after a foe's use and its triggers, each body it landed on (caught or in its ring) sets
 * off the armed `after` reactions that protect it, aimed at the user, within the use's `reactionsPerUse`.
 */
function afterReactions(f: Running, by: CombatantId, outcomes: readonly Outcome[], R: Rules, count: { n: number }): Running {
  const user = rowOf(f, by);
  if (!user) return f;
  const map = new Map(f.rows.map(b => [b.id, b] as const)), said: string[] = [], about: CombatantId[] = [];
  for (const o of outcomes) {
    const t = map.get(o.target);
    if (!t || t.side === user.side || (o.avoid !== 'caught' && o.avoid !== 'ring')) continue;
    for (const r of reactorsFor(map, t, 'after', by, f.now, R)) {
      if (count.n >= R.fight.kit.reactionsPerUse || !map.get(by)) break;
      const fired = fireReaction(map, r.id, by, f.now, R);
      if (!fired) continue;
      count.n++;
      said.push(fired.said);
      about.push(...fired.about);
    }
  }
  return said.length ? logged({ ...f, rows: f.rows.map(b => map.get(b.id)!) }, line(`Then: ${said.join(', ')}.`, [by, ...about]), R) : f;
}

/**
 * The fight's `arm` (kits design 8.4.2): a row arms one of its reactions, or disarms with null; a `turn` reaction names a
 * row of the fight. No time passes, and nothing is logged: a monster's armed reaction is the GM's secret.
 */
function arm<F extends Setup | Running>(f: F, cmd: Extract<Command, { type: 'arm' }>, _ctx: Ctx): Result {
  const u = rowOf(f, cmd.by);
  if (!u) return refused(f, 'unknown');
  if (cmd.ability === null) return u.armed ? done(withRow(f, withReact(u, reactStep(reactState(u), { type: 'disarm' }))), []) : refused(f, 'noChange');
  const a = u.abilities.find(x => x.id === cmd.ability);
  if (!a?.react) return refused(f, 'unknownAbility');
  const on = a.react.when === 'turn' ? cmd.on ?? null : null;
  if (a.react.when === 'turn' && (on === null || on === u.id || !rowOf(f, on))) return refused(f, 'noTarget');
  if (u.armed?.ability === a.id && u.armed.on === on) return refused(f, 'noChange');
  return done(withRow(f, withReact(u, reactStep(reactState(u), { type: 'arm' }), { ability: a.id, on })), []);
}

/** Whether a use hides its user: it puts a status with `hidden` on (kits design 8.7). */
const hides = (a: Ability): boolean => a.ops.some(o => o.op === 'applyStatus' && o.def.ops.some(x => x.op === 'hidden'));
/**
 * Whether a foe that is up sees `u`'s tile (kits design 8.7.2): within the fog's sight, or `fight.sight` with no fog, and
 * nothing between that stops sight. Hiding is refused then: in the open arena nobody hides.
 */
const seenByFoes = (f: Running, u: Body, R: Rules): boolean =>
  f.rows.some(o => o.side !== u.side && isUp(o) && dist(o.place, u.place) <= (f.fog?.sight ?? R.fight.sight) && sees(o.place, u.place, f.grid));

/** The `crit` effects of a use's outcomes: one per target a critical hit landed on. */
const critsOf = (outcomes: readonly Outcome[]): Fx => outcomes.filter(o => o.crit).map(o => ({ type: 'crit', id: o.target }));
/** A use's thresholds that went off, one `burst` a bearer. */
const burstsOf = (bursts: readonly { readonly bearer: CombatantId }[]): Fx => [...new Set(bursts.map(b => b.bearer))].map(id => ({ type: 'burst', id }));

/**
 * A channel goes off: a holding one on its user's turn, costing the ability's time; a broken one at once, costing no
 * time. It lands what its begin paid (`landUse`), where it was aimed however far that is now; nothing is asked again
 * but its dice. What follows is a use's (`landed`), the same as `act`'s. One that can land nothing (its aim gone, a
 * blink with nowhere to stand) goes off at nothing and ends, so a broken one is never owed for good.
 */
const release: Step<'running', 'release'> = (f, cmd, ctx) => {
  const R = ctx.rules, u = rowOf(f, cmd.by);
  if (!u) return refused(f, 'unknown');
  if (!isUp(u)) return refused(f, 'down');
  const c = u.channel;
  if (!c || !channelCan(c, 'release')) return refused(f, 'noChannel');
  if (c.state === 'holding' && cmd.by !== f.currentId) return refused(f, 'notYourTurn');
  const a = u.abilities.find(x => x.id === c.ability);
  if (!a) return refused(f, 'unknownAbility');
  const turn = cmd.by === f.currentId;
  const nothing = (): Result => {
    const done = { ...(turn ? acted(u, f.now, a.cost.time, R.fight) : u), channel: channelStep(c, { type: 'release' }) };
    return after(f, logged(withRow(f, done), line(`${u.name}'s ${a.name} is released and hits nothing.`, [u.id]), R), turn ? u.id : '', null, ctx, []);
  };
  const at = placeOf(c.aim, f.rows);
  if (!at) return nothing();
  const r = landUse(a, u, { at, paid: u, spent: c.spent }, f.rows, c.aim, f.grid, cmd.rolls, f.now, R);
  if (r.ok === false) return r.reason === 'needsRoll' ? refused(f, r.reason) : nothing();
  // it goes off; out of its user's turn (a broken one) it costs no time
  const fired = (b: Body): Body => b.id !== u.id ? b : { ...b, channel: channelStep(c, { type: 'release' }), ...(turn ? {} : { at: u.at }) };
  return landed(f, { a, u, rows: f.rows, at, r: { ...r, bodies: r.bodies.map(fired) }, taken: [], head: `${u.name}'s ${a.name} is released at charge ${c.charge}`, by: turn ? u.id : '' }, ctx);
};

/**
 * A walk on the turn: at most a stride, around bodies and walls, costing its tiles' share of a standard action. A dash
 * (design 4.6) runs up to the whole `move` in a straight line with no body or wall on it, for a standard action's time
 * and `dashFatigue`: a charge is how a heavy body closes on an archer, and it costs breath.
 */
const move: Step<'running', 'move'> = (f, cmd, ctx) => {
  const R = ctx.rules, who = actor(f, cmd.by, false);
  if (typeof who === 'string') return refused(f, who);
  if (who.sheet.stride <= 0) return refused(f, 'rooted');
  if (who.place.x === cmd.to.x && who.place.y === cmd.to.y) return refused(f, 'noMove');
  const bad = placeRefusal(f, cmd.to, who.id);
  if (bad) return refused(f, bad);
  const others = f.rows.filter(r => r.id !== who.id && alive(r)).map(r => r.place);
  const dash = cmd.dash === true;
  const steps = dash ? straightCost(who.place, cmd.to, f.grid, others) : pathCost(who.place, cmd.to, f.grid, others);
  if (steps === null) return refused(f, 'blocked');
  if (steps > (dash ? Math.floor(who.sheet.move) : who.sheet.stride)) return refused(f, 'tooFar');
  const moved = { ...dropChannel(who), place: cmd.to };
  const u = dash
    ? acted({ ...moved, fatigue: Math.min(who.sheet.fatigueMax, who.fatigue + R.fight.dashFatigue) }, f.now, cost(R.fight.dashTime), R.fight)
    : acted(moved, f.now, walkCost(steps, R.fight), R.fight);
  const walked = logged(withRow(f, u), line(`${u.name} ${dash ? 'dashes' : 'moves'} ${steps} tile${steps === 1 ? '' : 's'}.`, [u.id]), R);
  return after(f, triggered(walked, [raised(u.id, 'moved')], ctx), u.id, null, ctx, []);
};

/** A pass: a standard action's time. A holding channel keeps charging unless it is full, when it ends unspent. */
const endTurn: Step<'running', 'endTurn'> = (f, cmd, ctx) => {
  const R = ctx.rules, who = actor(f, cmd.by, false);
  if (typeof who === 'string') return refused(f, who);
  const max = who.abilities.find(a => a.id === who.channel?.ability)?.channel?.max ?? R.fight.channelMax;
  const keeps = who.channel?.state === 'holding' && who.channel.charge < max;
  const u = acted(keeps ? who : dropChannel(who), f.now, paceCost('standard', R.fight), R.fight);
  return after(f, withRow(f, u), u.id, line(keeps ? `${u.name} keeps channeling.` : `${u.name} waits.`, [u.id]), ctx, []);
};

// ── the GM's own moves ──
function setIntent<F extends Setup | Running>(f: F, cmd: Extract<Command, { type: 'setIntent' }>, ctx: Ctx): Result {
  const u = rowOf(f, cmd.by);
  if (!u) return refused(f, 'unknown');
  if (u.kind !== 'monster') return refused(f, 'notMonster');
  if (!isUp(u)) return refused(f, 'down');
  const a = u.abilities.find(x => x.id === cmd.ability);
  if (!a) return refused(f, 'unknownAbility');
  const badAim = aimRefusal(f, cmd.aim);
  if (badAim) return refused(f, badAim);
  const target = typeof cmd.aim === 'string' ? rowOf(f, cmd.aim)?.name : `(${cmd.aim.x}, ${cmd.aim.y})`;
  return done(logged(withRow(f, { ...u, intent: { ability: a.id, aim: cmd.aim, revealed: false } }), line(`${u.name} will use ${a.name} on ${target}.`, [u.id, ...(typeof cmd.aim === 'string' ? [cmd.aim] : [])]), ctx.rules), []);
}

/** The GM shows an announced intent's numbers. Nothing announced, or shown already, is refused. */
function reveal<F extends Setup | Running>(f: F, cmd: Extract<Command, { type: 'reveal' }>, ctx: Ctx): Result {
  const u = rowOf(f, cmd.by);
  if (!u) return refused(f, 'unknown');
  if (!u.intent) return refused(f, 'noIntent');
  if (u.intent.revealed) return refused(f, 'noChange');
  const a = u.abilities.find(x => x.id === u.intent!.ability);
  return done(logged(withRow(f, { ...u, intent: { ...u.intent, revealed: true } }), line(`${u.name}'s ${a?.name ?? 'intent'} is revealed.`, [u.id]), ctx.rules), []);
}

/** The GM's drag: no time, no path. While running the ground answers it as any move (a zone it leaves or enters). */
function placeRow<F extends Setup | Running>(f: F, cmd: Extract<Command, { type: 'place' }>, ctx: Ctx): Result {
  const u = rowOf(f, cmd.id);
  if (!u) return refused(f, 'unknown');
  if (u.place.x === cmd.to.x && u.place.y === cmd.to.y) return refused(f, 'noMove');
  const bad = placeRefusal(f, cmd.to, u.id);
  if (bad) return refused(f, bad);
  const g = withRow(f, { ...u, place: cmd.to });
  if (g.phase === 'running') return after(f as Running, g as Running, '', null, ctx, []);
  return done(g, [{ type: 'moved', id: u.id, to: cmd.to }]);
}

/**
 * A GM's change to one row that takes no time: in setup the sheet hears of it; while running it follows as any change
 * does (a row down, the fight over, the current row's turn lost when it is down or held).
 */
function gmChange<F extends Setup | Running>(f: F, row: Body, said: LogLine, ctx: Ctx): Result {
  const was = rowOf(f, row.id)!, g = withRow(f, row);
  // A monster or shadow brought back from 0 returns to the map on its own tile, which another body may hold by now.
  if (!alive(was) && alive(row) && !freeAt(f, row.place, row.id)) return refused(f, 'taken');
  if (g.phase === 'running') return after(f as Running, g as Running, '', said, ctx, []);
  const fx: Fx = [];
  writeBack(was, row, tick(0), ctx, fx);
  return done(logged(g, said, ctx.rules), fx);
}

const signed = (n: number): string => n < 0 ? `${n}` : `+${n}`;
/**
 * The GM's hand edit: each amount added and kept within 0 and its maximum. Nothing to change is refused, and so is a
 * price (`pay`) of more mana than the row holds.
 */
function adjust<F extends Setup | Running>(f: F, cmd: Extract<Command, { type: 'adjust' }>, ctx: Ctx): Result {
  const u = rowOf(f, cmd.id);
  if (!u) return refused(f, 'unknown');
  if (cmd.pay && u.mana < -Math.min(0, cmd.mana ?? 0)) return refused(f, 'mana');
  const to = (v: number, d: number | undefined, max: number): number => Math.max(0, Math.min(max, v + (d ?? 0)));
  const limited = cmd.used && u.abilities.find(a => a.id === cmd.used!.ability && usesGates(a).length);
  if (cmd.used && !limited) return refused(f, 'unknownAbility');
  const spent = limited ? Math.max(0, Math.min(ctx.rules.fight.kit.fightUses, Math.round(cmd.used!.spent))) : 0;
  const used = limited && spent !== (u.used?.[limited.id] ?? 0) ? { used: { ...u.used, [limited.id]: spent } } : {};
  const row = { ...u, hp: to(u.hp, cmd.hp, u.sheet.hpMax), mana: to(u.mana, cmd.mana, u.sheet.manaMax), fatigue: to(u.fatigue, cmd.fatigue, u.sheet.fatigueMax), ...used };
  const said = ([['HP', u.hp, row.hp], ['mana', u.mana, row.mana], ['fatigue', u.fatigue, row.fatigue]] as const).filter(([, a, b]) => a !== b).map(([k, a, b]) => `${k} ${signed(b - a)}`);
  if (limited && 'used' in used) said.push(`${limited.name} uses spent ${spent}`);
  if (!said.length) return refused(f, 'noChange');
  return gmChange(f, row, line(`${u.name}: ${said.join(', ')} (GM).`, [u.id]), ctx);
}

/**
 * A level-up's refill of a hunter's row: the sheet's refill (vitals.ts `refilled`) from the hunter's life (`rowLife`), at
 * the maxima the row has now. A dead hunter's row stays at 0 HP, as its sheet does. A row already full changes nothing,
 * and is not refused, so the grant that asks for it is paid.
 */
function refill<F extends Setup | Running>(f: F, cmd: Extract<Command, { type: 'refill' }>, ctx: Ctx): Result {
  const u = rowOf(f, cmd.id);
  if (!u) return refused(f, 'unknown');
  if (u.kind !== 'hunter') return refused(f, 'notHunter');
  const v = refilled({ life: rowLife(u, ctx), mana: u.mana }, u.sheet), row = { ...u, hp: hpOf(v.life, u.sheet.hpMax), mana: v.mana };
  if (row.hp === u.hp && row.mana === u.mana) return done(f, []);
  return gmChange(f, row, line(`${u.name} is refilled: HP ${signed(row.hp - u.hp)}, mana ${signed(row.mana - u.mana)} (level up).`, [u.id]), ctx);
}

/** The GM's Status window: a status taken off, then one put on with the GM as its source. Nothing to change is refused. */
function status<F extends Setup | Running>(f: F, cmd: Extract<Command, { type: 'status' }>, ctx: Ctx): Result {
  const u = rowOf(f, cmd.id);
  if (!u) return refused(f, 'unknown');
  const now = f.phase === 'running' ? f.now : tick(0), said: string[] = [];
  let list: readonly Status[] = u.statuses;
  const gone = cmd.remove === undefined ? undefined : list.find(s => s.key === cmd.remove);
  if (gone) { list = removeStatus(list, gone.key); said.push(`${gone.def.label} removed`); }
  if (cmd.add) {
    const a = cmd.add, until = a.duration === null ? null : tick(now + a.duration);
    list = applyStatus(list, statusOn(a.def, { key: a.key, source: { id: null, tier: a.tier }, until, since: now, settledAt: now }));
    said.push(`${a.def.label} added`);
  }
  if (!said.length) return refused(f, 'noChange');
  if (list.length > MAX_STATUSES) return refused(f, 'tooMany');
  let row = withStatuses(u, list, now, ctx.rules);
  if (cmd.add) {
    const until = cmd.add.duration === null ? null : tick(now + cmd.add.duration), self = { stats: row.stats, sheet: row.sheet };
    row = { ...row, shield: statusShield(cmd.add.def, row.shield, { user: self, target: self, charge: 0 }, now, until, ctx.rules) };
  }
  return gmChange(f, row, line(`${u.name}: ${said.join(', ')} (GM).`, [u.id]), ctx);
}

/** The dice for a waiting per-round op: paid now, the first one waiting for that row and status. */
const settleDue: Step<'running', 'settle'> = (f, cmd, ctx) => {
  const i = f.pending.findIndex(p => p.id === cmd.id && pendingKey(p) === cmd.key);
  const p = f.pending[i];
  if (!p) return refused(f, 'nothingDue');
  const rest = f.pending.filter((_, k) => k !== i);
  if ('spread' in p) {
    if (cmd.dice.length !== p.spread.targets.length || cmd.dice.some(d => !Number.isInteger(d) || d < 1 || d > D20.sides)) return refused(f, 'needsRoll');
    return after(f, spreadTo({ ...f, pending: rest }, p.spread, cmd.dice, ctx.rules), '', null, ctx, []);
  }
  if (cmd.dice.length !== diceOf(atTier(p.due.op.amount, p.due.tier)).length) return refused(f, 'needsRoll');
  const row = rowOf(f, cmd.id)!;
  const g = { ...withRow(f, payDue(row, p.due, cmd.dice, f.now, ctx.rules)), pending: rest };
  const what = row.statuses.find(s => s.key === cmd.key || entryKey(s.key) === cmd.key)?.def.label ?? cmd.key;
  return after(f, g, '', line(`${row.name}: ${what} settles.`, [row.id]), ctx, []);
};

// ── the ground ──
/** A GM's change to the map or its zones, which takes no time: while running it follows as any change does. */
function groundChange<F extends Setup | Running>(f: F, g: F, said: LogLine, ctx: Ctx): Result {
  if (g.phase === 'running') return after(f as Running, g as Running, '', said, ctx, []);
  return done(logged(g, said, ctx.rules), []);
}

/** The GM paints tiles. A tile a body stands on takes only terrain a body may stand on; nothing new to paint is refused. */
function paint<F extends Setup | Running>(f: F, cmd: Extract<Command, { type: 'paint' }>, ctx: Ctx): Result {
  if (cmd.tiles.length > f.grid.w * f.grid.h) return refused(f, 'tooMany');
  if (cmd.tiles.some(p => offGrid(f, p))) return refused(f, 'offGrid');
  if (!TERRAIN[cmd.terrain].walk && cmd.tiles.some(p => f.rows.some(r => alive(r) && r.place.x === p.x && r.place.y === p.y))) return refused(f, 'taken');
  const was = f.grid.tiles ?? Array.from({ length: f.grid.w * f.grid.h }, () => 'floor' as const);
  const tiles = [...was];
  for (const p of cmd.tiles) tiles[p.y * f.grid.w + p.x] = cmd.terrain;
  if (tiles.every((t, i) => t === was[i])) return refused(f, 'noChange');
  return groundChange(f, { ...f, grid: { ...f.grid, tiles } }, line(`The GM changes ${cmd.tiles.length} tile${cmd.tiles.length === 1 ? '' : 's'} to ${cmd.terrain}.`), ctx);
}

/** The GM's zone goes on the ground from now. One id once; at most `MAX_ZONES`; its tiles on the grid. */
function zoneAdd<F extends Setup | Running>(f: F, cmd: Extract<Command, { type: 'zoneAdd' }>, ctx: Ctx): Result {
  const z = cmd.zone, now = f.phase === 'running' ? f.now : tick(0);
  if (f.zones.some(x => x.id === z.id)) return refused(f, 'duplicate');
  if (f.zones.length >= MAX_ZONES || z.tiles.length > MAX_ZONE_TILES) return refused(f, 'tooMany');
  if (!z.tiles.length) return refused(f, 'noChange');
  if (z.tiles.some(p => offGrid(f, p))) return refused(f, 'offGrid');
  const { duration, tiles: at, ...rest } = z;
  const zone: Zone = { ...rest, ground: { kind: 'tiles', tiles: at }, owner: null, endsWithOwner: false, until: duration === null ? null : tick(now + duration) };
  return groundChange(f, { ...f, zones: [...f.zones, zone] }, line(`${z.name} covers the ground (GM).`, [], [zone.id]), ctx);
}

/** The GM takes a zone off the ground. */
function zoneRemove<F extends Setup | Running>(f: F, cmd: Extract<Command, { type: 'zoneRemove' }>, ctx: Ctx): Result {
  const z = f.zones.find(x => x.id === cmd.id);
  if (!z) return refused(f, 'unknown');
  return groundChange(f, { ...f, zones: f.zones.filter(x => x.id !== z.id) }, line(`${z.name} is gone (GM).`, [], [z.id]), ctx);
}

/**
 * The GM's new size for the map (design 4.8): each side within `GRID_SIDE`. Growing adds floor at the right and the
 * bottom, so no place moves; shrinking cuts there, and is refused (`cutOff`) when a body on the map, or a tile a channel
 * or an announced intent aims at, would be cut off. A row no longer on the map (a monster or shadow at 0) moves to the
 * nearest tile inside. A fixed zone keeps its tiles inside and is gone with none; a field around a cut-off centre is
 * gone; an aura goes with its body. The fog keeps what it saw inside. Nothing else changes.
 */
function resize<F extends Setup | Running>(f: F, cmd: Extract<Command, { type: 'resize' }>, ctx: Ctx): Result {
  const { w, h } = cmd, [lo, hi] = GRID_SIDE, old = f.grid;
  if (![w, h].every(n => Number.isInteger(n) && n >= lo && n <= hi)) return refused(f, 'offGrid');
  if (w === old.w && h === old.h) return refused(f, 'noChange');
  const inside = (p: Place): boolean => p.x < w && p.y < h;
  const aims = f.rows.flatMap(r => [r.channel?.aim, r.intent?.aim]).filter((a): a is Place => !!a && typeof a !== 'string');
  if (f.rows.some(r => alive(r) && !inside(r.place)) || aims.some(a => !inside(a))) return refused(f, 'cutOff');
  const at = (i: number): Place => place(i % w, Math.floor(i / w));
  const kept = old.tiles && Array.from({ length: w * h }, (_, i) => { const p = at(i); return inside(p) && p.x < old.w && p.y < old.h ? old.tiles![p.y * old.w + p.x]! : 'floor'; });
  const grid = { w, h, tiles: kept && kept.some(t => t !== 'floor') ? kept : null };
  const rows = f.rows.map(r => inside(r.place) ? r : { ...r, place: place(Math.min(r.place.x, w - 1), Math.min(r.place.y, h - 1)) });
  const zones = f.zones.flatMap((z): Zone[] => {
    const g = z.ground;
    if (g.kind === 'tiles') { const list = g.tiles.filter(inside); return list.length ? [{ ...z, ground: { kind: 'tiles', tiles: list } }] : []; }
    return g.anchor.kind === 'place' && !inside(g.anchor.at) ? [] : [z];
  });
  const fog = f.fog && { ...f.fog, seen: Array.from({ length: w * h }, (_, i) => { const p = at(i); return p.x < old.w && p.y < old.h ? f.fog!.seen[p.y * old.w + p.x] ?? '0' : '0'; }).join('') };
  return groundChange(f, { ...f, grid, rows, zones, fog }, line(`The GM makes the map ${w} by ${h}.`), ctx);
}

// ── a fallen monster's extraction ──
/**
 * An attempt to extract a shadow from fallen monster `id` (extraction.ts): its outcome kept on the row, with a log line,
 * so the corpse's attempts outlive a reload. No time passes. It is made by a hunter row of the fight (`by`); one that is
 * not is refused (`notExtractor`), as a body that is not a monster or still up, and a corpse with no attempt left.
 */
function extract<F extends Fight>(f: F, cmd: Extract<Command, { type: 'extract' }>, ctx: Ctx): Result {
  const u = rowOf(f, cmd.id), by = rowOf(f, cmd.by), max = ctx.rules.shadow.maxAttempts;
  if (!u) return refused(f, 'unknown');
  if (!by || by.kind !== 'hunter') return refused(f, 'notExtractor');
  if (u.kind !== 'monster') return refused(f, 'notMonster');
  if (isUp(u)) return refused(f, 'notNow');
  const e = extractionStep(u.extraction ?? UNTRIED, cmd.outcome, max);
  if (!e) return refused(f, 'noAttempts');
  const said = cmd.outcome === 'risen' ? `${u.name} rises as a shadow.` : cmd.outcome === 'crumbled' ? `${u.name}'s corpse is destroyed.`
    : `The extraction of ${u.name} fails (${attemptsLeft(e, max)} left).`;
  return done(logged(withRow(f, { ...u, extraction: e }), line(said, [u.id, by.id]), ctx.rules), []);
}

// ── the table ──
const TABLE: { readonly [S in FightState]: Row<S> } = {
  none: {
    add: create, remove: null, start: null, act: null, move: null, endTurn: null, release: null, setIntent: null, reveal: null, place: null, adjust: null, refill: null,
    status: null, settle: null, paint: null, zoneAdd: null, zoneRemove: null, resize: null, arm: null, extract: null, end: null, clear: null,
  },
  setup: {
    add: addTo, remove: removeInSetup, start, act: null, move: null, endTurn: null, release: null, setIntent, reveal, place: placeRow, adjust, refill, status,
    settle: null, paint, zoneAdd, zoneRemove, resize, arm, extract, end: (f, _cmd, ctx) => end(f, ctx), clear: () => done(null, []),
  },
  running: {
    add: addTo, remove: removeRunning, start: null, act, move, endTurn, release, setIntent, reveal, place: placeRow, adjust, refill, status, settle: settleDue,
    paint, zoneAdd, zoneRemove, resize, arm, extract, end: (f, _cmd, ctx) => end(f, ctx), clear: () => done(null, []),
  },
  // The rows of an ended fight are the summary's record: the GM edits the hunters' sheets from here on, and may still
  // extract a shadow from a fallen monster.
  ended: {
    add: null, remove: null, start: null, act: null, move: null, endTurn: null, release: null, setIntent: null, reveal: null, place: null, adjust: null, refill: null,
    status: null, settle: null, paint: null, zoneAdd: null, zoneRemove: null, resize: null, arm: null, extract, end: null, clear: () => done(null, []),
  },
};

/** Whether `type` applies to a fight in this state: what a view asks before it shows the button. */
export const can = (f: Fight | null, type: CommandType): boolean => TABLE[stateOf(f)][type] !== null;

/** What the fight waits on the dice of the phone that runs it for: a `settle` with `dice`, or a broken channel's `release`. */
export type Owed =
  | { readonly kind: 'settle'; readonly id: CombatantId; readonly key: StatusKey; readonly dice: readonly Dice[] }
  | { readonly kind: 'release'; readonly id: CombatantId };
/**
 * What `f` waits for, in the order it is paid: each pending entry's dice (a per-round op, a sickness's pass), then each
 * broken channel of a body still up, which goes off at once (design 4.1). Read from the fight as it stands, not from the
 * effects of the command that left it so (`rollSettle`, `channel`), so a page reloaded before its dice were rolled rolls
 * them at its next look, and a paid entry is gone from the fight and never paid twice.
 */
export function owed(f: Fight | null): Owed[] {
  if (f?.phase !== 'running') return [];
  return [
    ...f.pending.map((p): Owed => ({ kind: 'settle', id: p.id, key: pendingKey(p), dice: 'due' in p ? diceOf(atTier(p.due.op.amount, p.due.tier)) : p.spread.targets.map(() => D20) })),
    ...f.rows.filter(r => r.channel?.state === 'broken' && isUp(r)).map((r): Owed => ({ kind: 'release', id: r.id })),
  ];
}

/**
 * The party's fog after a change (design 5.3): every tile the party sees now (fight-doc.ts `partyView`) is marked seen,
 * so the room's doc keeps a wall it saw once. A fight with no fog, or ended, is as it was.
 */
function explored(f: Fight): Fight {
  if (!f.fog || f.phase === 'ended') return f;
  const lit = partyView(f)!, seen = [...f.fog.seen];
  let more = false;
  for (const i of lit) if (seen[i] !== '1') { seen[i] = '1'; more = true; }
  return more ? { ...f, fog: { ...f.fog, seen: seen.join('') } } : f;
}

/** Every change to a fight goes through here. A command that does not apply in the fight's state is refused. */
export function reduce(f: Fight | null, cmd: Command, ctx: Ctx): Result {
  // The table's type pairs each state with its fight and each key with the step for that command.
  const step = TABLE[stateOf(f)][cmd.type] as Step<FightState, CommandType> | null;
  if (!step) return refused(f, 'notNow');
  const r = step(f as never, cmd as never, ctx);
  return r.fight && r.fight !== f ? { ...r, fight: marked(explored(r.fight)) } : r;
}

/**
 * Several commands as one answer: each reduced in turn on the fight the one before left, their effects in order. The
 * first one refused refuses them all and leaves the fight as it was, so `fought` writes the batch whole or not at all
 * (a grant's statuses and refill on the rows of the hunters it pays, fight-save.ts `heldCommands`).
 */
export function reduceAll(f: Fight | null, cmds: readonly Command[], ctx: Ctx): Result {
  let at: Result = { fight: f, effects: [] };
  for (const cmd of cmds) {
    const r = reduce(at.fight, cmd, ctx);
    if (r.effects.some(x => x.type === 'refused')) return { fight: f, effects: r.effects.filter(x => x.type === 'refused') };
    at = { fight: r.fight, effects: [...at.effects, ...r.effects] };
  }
  return at;
}

