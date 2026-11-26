// fight-turn.ts: how a fight's time moves and what follows from a change to its rows (docs/agent-handoff/rw/design.md
// sections 1.3, 4.2, 4.4 and 4.7). `startTurn` is the one function that begins a turn; `consequences` is the one place that
// turns a change of a row into effects (a defeat, a move, a channel, a stagger); `sheetBacks` is the one place that turns
// a command's change of the rows into what their sheets hear (HP, mana, fatigue, statuses, uses), read once by `reduce`
// from the fight the command found and the one it left; `grounded` keeps the zones' holds (zones.ts); `overIf` ends a
// fight whose side has nobody up; `spreadsOf`, `spreadTo` and `marked` pass a spreading status on (design 4.8). A
// mythic's script (notes-11-keystones.md, design B.3 and B.4) moves here at its turn start (a phase change, an omen
// announced, an act beat) and in `consequences` (an answer to its omen, its arrival at its gate); `phasedRow` is the one
// place a phase begins, and `omenMove` and `omenNeeds` the landing move and its dice. Called only by the reducer in
// fight.ts.
import { tallied } from './row-tally.ts';
import { diceOf } from '../formula.ts';
import type { Dice, Scope } from '../formula.ts';
import type { Rules } from '../rules.ts';
import { acted, next, paceCost, roundOf, roundsOf, tick } from './timeline.ts';
import type { Tick } from './timeline.ts';
import { isUp, rowHp } from './row-hp.ts';
import { rowLifeAfter, sameLife } from './row-life.ts';
import { applyStatus, dueRate, modified, onSheet, owedOf, perRound, prorated, resetMoved, settle, sheetStatuses, statusOn, withStatuses, withThreat } from './effect-ops.ts';
import { atTier } from './op-amount.ts';
import type { Body, Due, HunterRow, SheetStatus, Status, StatusKey } from './effect-ops.ts';
import type { SheetKey } from '../ids.ts';
import type { Ability, AbilityId, CombatantId } from './ability-types.ts';
import { needs, resists } from './resolve.ts';
import type { Aim, Needs } from './resolve.ts';
import { channelCan } from './fight-channel.ts';
import { aimedBody, answerBack, answerMet, beatOf, enraged, heldAtGate, mythicCan, mythicOff, mythicStepped, omenAim, phaseOver, playsScript, scriptOf } from './mythic.ts';
import type { MetAnswer, MythicRefusal, Scripted } from './mythic.ts';
import type { MythicMove, Omen } from './mythic-types.ts';
import { bandOf } from '../registry/mythics.ts';
import { mythicMove } from '../registry/mythic-moves.ts';
import { isRefused } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { staggerOf } from './rows.ts';
import { channelStep } from './fight-channel.ts';
import { anchorOf, oldEnough, payUpkeep, zoneStep, zoneSync } from './zones.ts';
import type { Zone } from './zones.ts';
import { armyKillOf, fire, raised } from './triggers.ts';
import { NO_PEN, afterDefence, alive, held, landedWords, landEnd, landOps, stealthAfter, throughShield } from './land.ts';
export { held };
import { dismissed, isSummon, ownerOf, summonStep, timeUp } from './summons.ts';
import { damageShare, given, healShare, statusLife, statusStep, stealthOf, stealthState, wardedDamage } from './standing.ts';
import { reactState, reactStep, restored, turnReaction, withReact } from './fight-react.ts';
import { gateUsed } from './uses.ts';
import { ARMED, endStep } from './delayed.ts';
import type { Raised } from './triggers.ts';
import { dist, place, sees, seenBy, TERRAIN } from './space.ts';
import type { Place, Side } from './space.ts';
import { line, LOG_CAP, LOG_LINE_MAX, MAX_PENDING, MAX_SPREAD, MAX_STATUSES, spreadKey } from './fight-types.ts';
import type { Ctx, Effect, Ended, Fight, LogLine, Running, Spread, Summary } from './fight-types.ts';

type Fx = Effect[];

/** The tiles the party sees now (space.ts `seenBy`), or null when the fight has no fog: the party then sees the whole map. */
export function partyView(f: Pick<Fight, 'rows' | 'grid' | 'fog'>): Set<number> | null {
  return f.fog ? seenBy('party', f.rows.map(r => ({ place: r.place, side: r.side, up: isUp(r) })), f.grid, f.fog.sight) : null;
}

export const rowOf = (f: Fight, id: string): Body | undefined => f.rows.find(r => r.id === id);
export const withRow = <F extends Fight>(f: F, row: Body): F => ({ ...f, rows: f.rows.map(r => r.id === row.id ? row : r) });

/** The fight with `l` on top of its log, its words prefixed with the round once it has a time. */
export function logged<F extends Fight>(f: F, l: LogLine, R: Rules): F {
  const text = (f.phase === 'setup' ? l.text : `R${roundOf(f.now, R.fight)}: ${l.text}`).slice(0, LOG_LINE_MAX);
  return { ...f, log: [{ ...l, text }, ...f.log].slice(0, LOG_CAP) };
}

const scopeOf = (b: Body): Scope => ({ user: { stats: b.stats, sheet: b.sheet }, target: { stats: b.stats, sheet: b.sheet }, charge: 0 });

/**
 * Who gives a per-round heal of the status `key` among `statuses` (item-stats 2.1): the body that put it on, as its row
 * is in `f` when the heal settles. None for a worn status (an item's or a passive's), a status no body put on (the GM's,
 * a zone's) or one not in `statuses`.
 */
export function giverOf(f: Pick<Fight, 'rows'>, statuses: readonly Status[], key: StatusKey): Body | null {
  const s = statuses.find(x => x.key === key);
  return s && !s.worn && s.source.id !== null ? f.rows.find(r => r.id === s.source.id) ?? null : null;
}

/**
 * What a paid per-round op does to its bearer at `now`: damage applies the bearer's taken share and rule 12
 * (`afterDefence` with `NO_PEN`) to the round's rate before prorating, then takes the shield first (rule 13,
 * `throughShield`) and HP; a heal is `giver`'s to give (standing.ts `given`, `giverOf`) and the bearer's healed share;
 * a heal, mana and fatigue stay in their bounds.
 */
export function payDue(b: Body, due: Due, dice: readonly number[], now: Tick, R: Rules, giver: Pick<Body, 'sheet'> | null): Body {
  if (!alive(b)) return b;
  const rawRate = dueRate(due, scopeOf(b), dice);
  switch (due.op.op) {
    case 'damage': {
      // rule 11c reads the bearer's damage taken share at the settle (kits design 8.1), then rule 12 meets the round's rate before prorating
      const rate = rawRate * damageShare(null, b, R);
      if (rate <= 0) return b;
      const hit = Math.max(0, prorated(afterDefence(rate, due.op.type, NO_PEN, b.sheet, R), due));
      if (hit <= 0) return b;
      const s = throughShield(b, hit, now);
      return rowLifeAfter(s.target, { type: 'damage', amount: wardedDamage(s.target, hit - s.absorbed) });
    }
    case 'heal': { const n = prorated(rawRate, due); return rowLifeAfter(b, { type: 'heal', amount: Math.max(0, Math.round(given(n, giver) * healShare(b, R))) }); }
    case 'mana': { const n = prorated(rawRate, due); return { ...b, mana: Math.max(0, Math.min(b.sheet.manaMax, b.mana + n)) }; }
    case 'fatigue': { const n = prorated(rawRate, due); return { ...b, fatigue: Math.max(0, Math.min(b.sheet.fatigueMax, b.fatigue + n)) }; }
    // A shield op is not per-round: `settle` never makes it due.
    case 'shield': return b;
    default: return due.op satisfies never;
  }
}

/**
 * A status its bearer's turn must still settle: per-round ops not paid to its end yet, or an end (a delayed effect,
 * kits table 2.2) that lands at that settle. It stays until then, owed (standing.ts `statusStep`).
 */
const owes = (s: Status): boolean => s.until !== null && ((s.settledAt < s.until && s.def.ops.some(perRound)) || s.def.end !== undefined);

/**
 * Time moves from `f.now` to `now` for everyone: every threat table falls by the decay for the time that passed (so a
 * monster reads it decayed by elapsed time at its turn start), except the entry of a body holding a channel, which is not
 * idle (design 4.1); shields that ended are dropped; and each status takes its life's `time` step (standing.ts
 * `statusStep`): one whose end is now behind it is owed while its bearer's settle still owes it (`owes`), and counts no
 * more, else it is gone. A body whose statuses changed has its sheet worked out again.
 */
function advance(f: Running, now: Tick, R: Rules): { fight: Running; ended: Raised[] } {
  if (now === f.now) return { fight: f, ended: [] };
  const ended: Raised[] = [];
  const k = Math.pow(1 - R.fight.threatDecay, (now - f.now) / R.fight.round);
  const holding = new Set(f.rows.filter(r => r.channel?.state === 'holding').map(r => r.id as string));
  const rows = f.rows.map(r => {
    let x = r;
    x = withThreat(x, t => Object.fromEntries(Object.entries(t).map(([id, n]) => [id, holding.has(id) ? n : n * k])));
    if (x.shield && x.shield.until <= now) x = { ...x, shield: null };
    const kept: Status[] = [];
    for (const s of x.statuses) {
      const life = statusStep(statusLife(s), { type: 'time', past: s.until !== null && s.until <= now, owes: owes(s) });
      if (life === 'gone') { if (s.zone === undefined) ended.push(raised(x.id, 'statusEnded', null, [], s.key)); }
      else kept.push(life === 'owed' && !s.owed && s.until !== null ? owedOf({ ...s, until: s.until }) : s);
    }
    if (kept.some((s, i) => s !== x.statuses[i]) || kept.length !== x.statuses.length) x = withStatuses(x, kept, now, R);
    return x;
  });
  return { fight: { ...f, now, rows }, ended };
}

/**
 * Rule 19b (kits design 1.3): the triggers `events` set off at the fight's now, fired on its rows; a line names those
 * that fired.
 */
export function triggered<F extends Running>(f: F, events: readonly Raised[], ctx: Ctx): F {
  const t = fire(f.rows, events, f.now, ctx.rules);
  if (t.bodies.every((b, i) => b === f.rows[i])) return f;
  const g = { ...f, rows: t.bodies };
  return t.said.length ? logged(g, line(`Then: ${t.said.join(', ')}.`, [...t.about]), ctx.rules) : g;
}

/** Thresholds that went off (a use's, a reaction's), one `burst` a bearer. */
export const burstsOf = (bursts: readonly { readonly bearer: CombatantId }[]): Fx => [...new Set(bursts.map(b => b.bearer))].map(id => ({ type: 'burst', id }));

/** Whether a row keeps its side in the fight: up, and not a summon (kits design 1.9: a fight is not held by a sprite). */
export const holdsSide = (b: Body): boolean => isUp(b) && !isSummon(b);
/** A side with nobody up ends the fight. A summon does not count. */
export function overIf(f: Running, fx: Fx, R: Rules): Ended | null {
  const up = standing(f);
  if (up.length === 2) return null;
  return ended(f, up[0] ?? null, fx, R);
}
/** The sides with a body up that keeps its side in the fight (`holdsSide`). */
const standing = (f: Running): Side[] => (['party', 'foe'] as const).filter(side => f.rows.some(r => r.side === side && holdsSide(r)));

/**
 * Post-fight fatigue recovery (`R.fight.fightRest`): each living hunter drops by `fightRest`, down to 0. Dead hunters
 * and non-hunters do not change. Returns the updated rows and how much fatigue each recovered hunter dropped.
 */
export function fightRested(rows: readonly Body[], R: Pick<Rules, 'fight'>): { readonly rows: readonly Body[]; readonly rested: Readonly<Record<CombatantId, number>> } {
  const amount = Math.max(0, R.fight.fightRest);
  if (amount === 0) return { rows, rested: {} };
  const rested: Record<CombatantId, number> = {};
  let changed = false;
  const next = rows.map(r => {
    if (r.kind !== 'hunter' || !isUp(r) || r.fatigue <= 0) return r;
    const after = Math.max(0, r.fatigue - amount), got = r.fatigue - after;
    if (got <= 0) return r;
    rested[r.id] = got;
    changed = true;
    return { ...r, fatigue: after };
  });
  return changed ? { rows: next, rested } : { rows, rested };
}

/**
 * The fight ended at its `now`, with the side still up. Its XP is the banked XP and that of every foe down. A running
 * fight applies `fightRest` once to its living hunters (`fightRested`), so `reduce`'s `sheetBacks` writes the lower
 * fatigue to local and remote sheets in the same step; ending in setup does not.
 */
export function ended(f: Fight, winner: Summary['winner'], fx: Fx, R: Rules): Ended {
  const now = f.phase === 'setup' ? tick(0) : f.now;
  const keptRows = f.rows.filter(r => !(isSummon(r) && summonStep('present', { type: 'fightEnds' }) === 'gone'));
  const after = f.phase === 'running' ? fightRested(keptRows, R) : { rows: keptRows, rested: {} as Readonly<Record<CombatantId, number>> };
  const restedIds = Object.keys(after.rested) as CombatantId[];
  const down = after.rows.filter(r => !isUp(r));
  const xp = down.reduce((n, r) => r.side === 'foe' ? n + r.xp : n, f.banked);
  const summary: Summary = { rounds: roundsOf(now, R, 'near'), winner, down: down.map(r => r.id), xp, ...(restedIds.length ? { rested: after.rested } : {}) };
  fx.push({ type: 'ended', summary });
  let out: Ended = { phase: 'ended', id: f.id, grid: f.grid, zones: f.zones, fog: f.fog, rows: after.rows, log: f.log, banked: f.banked, had: f.had, now, summary };
  if (restedIds.length) {
    const names = restedIds.map(id => { const r = after.rows.find(x => x.id === id); return `${r ? r.name : id} ${after.rested[id]}`; });
    out = logged(out, line(`Fatigue recovered: ${names.join(', ')}.`, restedIds), R);
  }
  return logged(out, line(`The fight ends${winner ? `. The ${winner === 'party' ? 'party' : 'foes'} won` : ''}.`), R);
}

/**
 * Fires `minionDown` on the owner of any minion that went from up in `prev` to down in `curr` (before `dismissed`
 * sweeps dead summons), so a `reform` trigger can lift it in the same step. If a reformed minion's tile was taken
 * by a shove in the same use, nudges it to the nearest free walkable tile.
 */
function handleMinionDown(prev: readonly Body[], curr: Running, ctx: Ctx): Running {
  const events: Raised[] = [];
  const fellIds = new Set<CombatantId>();
  for (const b of prev) {
    if (!isUp(b)) continue;
    const owner = ownerOf(b);
    if (owner === null) continue;
    const a = rowOf(curr, b.id);
    if (a && !isUp(a)) {
      events.push(raised(owner, 'minionDown', a.id));
      fellIds.add(a.id);
    }
  }
  if (!events.length) return curr;
  let next = triggered(curr, events, ctx);
  // Nudge any reformed minion whose tile was occupied in the same use (e.g. a shove onto its tile before reform).
  for (const id of fellIds) {
    const r = rowOf(next, id);
    if (!r || !isUp(r)) continue;
    const clash = next.rows.some(o => o.id !== r.id && alive(o) && o.place.x === r.place.x && o.place.y === r.place.y);
    if (!clash) continue;
    const spots: Place[] = [];
    for (let y = 0; y < next.grid.h; y++) for (let x = 0; x < next.grid.w; x++) {
      if (!TERRAIN[next.grid.tiles?.[y * next.grid.w + x] ?? 'floor'].walk) continue;
      if (next.rows.some(o => o.id !== r.id && alive(o) && o.place.x === x && o.place.y === y)) continue;
      spots.push(place(x, y));
    }
    const free = spots.sort((p, q) => dist(p, r.place) - dist(q, r.place) || p.y - q.y || p.x - q.x)[0];
    if (free) next = withRow(next, { ...r, place: free });
  }
  return next;
}

/**
 * Turns the difference between `before` and `after` rows into effects, and keeps what follows from it: fires
 * `minionDown` before `dismissed` sweeps dead summons (and again if `grounded` downs a minion), a row that went down
 * loses its channel, a row that came back up waits no less than `now`. Rows only in `after` (new) are skipped.
 */
export function consequences(before: readonly Body[], after: Running, ctx: Ctx, fx: Fx, forced?: ReadonlySet<string>): Running {
  const reformed = handleMinionDown(before, after, ctx);
  const swept = sentAway(reformed, dismissed(reformed.rows), 'fades', ctx);
  let f = grounded(swept, ctx, fx, forced);
  if (f.rows !== swept.rows) {
    const reformed2 = handleMinionDown(swept.rows, f, ctx);
    f = sentAway(reformed2, dismissed(reformed2.rows), 'fades', ctx);
  }
  f = { ...f, rows: tallied(f.rows, { type: 'changed', before }) };
  for (const b of before) {
    let a = rowOf(f, b.id);
    if (!a) continue;
    if (isUp(b) && !isUp(a)) {
      if (a.channel) a = { ...a, channel: channelStep(a.channel, { type: 'drop' }) };
      // a reactor down is unarmed (kits table 8.9.1)
      if (a.armed) a = withReact(a, reactStep(reactState(a), { type: 'down' }));
      if (a.kind !== 'hunter') fx.push({ type: 'defeated', id: a.id });
      f = logged(f, line(`${a.name} is ${a.kind === 'hunter' ? 'dead' : 'defeated'}.`, [a.id]), ctx.rules);
    }
    if (!isUp(b) && isUp(a)) a = { ...a, at: tick(Math.max(a.at, f.now)) };
    if (a.place.x !== b.place.x || a.place.y !== b.place.y) fx.push({ type: 'moved', id: a.id, to: a.place });
    if (a.channel?.state !== b.channel?.state || a.channel?.charge !== b.channel?.charge) {
      fx.push({ type: 'channel', id: a.id, state: a.channel?.state ?? null, charge: a.channel?.charge ?? 0 });
    }
    // a break grows the bar within a phase; a mythic's new phase sets its bar to that phase's size (`phasedRow`)
    if (a.stagger && b.stagger && a.stagger.max > b.stagger.max && a.mythic?.phase === b.mythic?.phase) {
      fx.push({ type: 'staggered', id: a.id });
      f = logged(f, line(`${a.name} is staggered.`, [a.id]), ctx.rules);
    }
    if (!heldAtGate(b) && heldAtGate(a)) f = logged(f, line(`${a.name} stopped at its phase HP threshold.`, [a.id]), ctx.rules);
    const met = answered(f, before, a, ctx.rules, fx);
    f = withRow(met.fight, met.row);
  }
  return hurtHides(before, f, ctx);
}

/**
 * The answers mythic row `a`'s standing omen met in the change from rows `before` to fight `f` (design B.4, mythic.ts
 * `answerMet`: its own row's change, and the hunter and the tile it aims at), while an omen stood before and after it:
 * each its state takes, cancels first, moves the standing, with a line and an `answered` effect. A cancel leaves nothing
 * standing, so a weaken met with it is not taken.
 */
function answered(f: Running, before: readonly Body[], a: Body, R: Rules, fx: Fx): { fight: Running; row: Body } {
  const b = before.find(r => r.id === a.id);
  if (a.mythic?.at !== 'omen' && a.mythic?.at !== 'faltering') return { fight: f, row: a };
  if (!b || (b.mythic?.at !== 'omen' && b.mythic?.at !== 'faltering')) return { fight: f, row: a };
  const s = a.mythic, script = scriptOf(s), omen = script.omens[s.omen]!;
  let g = f, row: Body = a;
  for (const m of answerMet(omen, s, { row: b, rows: before }, { row: a, rows: f.rows }, f.now, R)) {
    if (!playsScript(row) || !mythicCan(row.mythic, m.outcome)) continue;
    const next = mythicStepped<Body>(row, { type: m.outcome, how: m.how, back: answerBack(row.mythic, m.outcome, f.now, R) });
    if (isRefused(next)) continue;
    row = next;
    const weak = omen.weak === null ? null : script.moves[omen.weak]!;
    const then = m.outcome === 'cancel' || !weak ? `${omen.name} is canceled` : `${omen.name} will land as ${weak.name}`;
    const text = `${answerWords(g, b, a, omen, m, R)}. ${then}.`;
    g = logged(g, line(text, [a.id]), R);
    fx.push({ type: 'omenAnswered', id: a.id, omen: s.omen, how: m.how, outcome: m.outcome, line: text });
  }
  return { fight: g, row };
}
/** What answered an omen, read from the change and the omen: "The Fourth Rider is stunned by Brakk". */
function answerWords(f: Running, b: Body, a: Body, omen: Omen, m: MetAnswer, R: Rules): string {
  const s = a.mythic;
  switch (m.how) {
    case 'interrupt': {
      const st = a.statuses.find(x => !b.statuses.some(y => y.key === x.key) && x.def.ops.some(o => (omen.interrupt.by as readonly string[]).includes(o.op)));
      const by = st?.source.id ? rowOf(f, st.source.id)?.name : undefined;
      return `${a.name} is ${(st?.def.label ?? 'held').toLowerCase()}${by && by !== a.name ? ` by ${by}` : ''}`;
    }
    case 'stagger': return `${a.name}'s stagger bar takes enough damage`;
    case 'burst': return `${a.name} loses ${Math.round(R.fight.mythic.answerReach.burst * 100)}% of its HP`;
    case 'shield': return `${(s && s.at !== 'calm' ? aimedBody(s.aim, a.side, f.rows)?.name : undefined) ?? 'Its target'} is shielded`;
    case 'step': return `No one stands where ${omen.name} was aimed`;
    default: return m.how satisfies never;
  }
}

/**
 * Mythic row `row` entering its next phase at `now` (design B.3, "What `next` does besides the standing"), the one place
 * a phase begins, for its turn and for the GM's hand: the old phase's worn statuses come off by key and the new phase's
 * go on, from the row at its tier until removed (a status that is not the script's is never
 * touched; one worn by both phases stays as it was); its stagger bar empties at its kind's bar times the new phase's
 * `bar`; its channel drops. By the GM, its HP comes down to the new phase's start if it is higher (the life's `setHp`,
 * whose floor is now the new gate); at its turn, the turn is spent (`mythic.turnPace`). Refused in its last phase.
 */
export function phasedRow(row: Scripted<Body>, by: 'turn' | 'gm', now: Tick, R: Rules): Body | Refused<MythicRefusal> {
  const s = row.mythic, next = mythicStepped<Body>(row, { type: 'next', now, by });
  if (isRefused(next)) return next;
  const script = scriptOf(s), was = script.phases[s.phase]!, to = script.phases[s.phase + 1]!;
  const off = new Set<string>(was.worn.filter(w => !to.worn.some(x => x.key === w.key)).map(w => w.key));
  let list: Status[] = next.statuses.filter(x => !off.has(x.key));
  for (const w of to.worn) {
    if (list.some(x => x.key === w.key) || list.length >= MAX_STATUSES) continue;
    list = applyStatus(list, statusOn(w.def, { key: w.key, source: { id: row.id, tier: row.tier }, until: null, since: now, settledAt: now }));
  }
  const o = row.origin, bar = o.kind === 'monster' ? staggerOf({ rank: o.rank, archetype: o.archetype, kind: o.monsterKind, tweak: o.tweak }, R) : null;
  const y = withStatuses(next, list, now, R);
  // only a monster's row holds a standing (effect-ops.ts `MonsterOwn`) and a stagger bar
  if (y.kind !== 'monster') return y;
  const x: Body = { ...y, stagger: bar ? { fill: 0, max: bar.max * to.bar, hit: bar.hit } : y.stagger, channel: y.channel && channelCan(y.channel, 'drop') ? channelStep(y.channel, { type: 'drop' }) : y.channel };
  if (by === 'turn') return acted(x, now, paceCost(R.fight.mythic.turnPace, R.fight), R.fight);
  const top = Math.ceil(bandOf(script, s.phase + 1).from * x.sheet.hpMax);
  return rowHp(x) > top ? rowLifeAfter(x, { type: 'setHp', hp: top }) : x;
}

/**
 * Mythic row `row` with its script taken off when a fight in setup starts under rules with `fight.mythic.scripts` off:
 * clears its standing (`mythicOff`), takes off its phase's worn statuses, undoes the script's `hp` factor on its origin
 * and restores its kind's stagger bar, recomputing its sheet and updating life through `rowLifeAfter`.
 */
export function unscriptedRow(row: Scripted<Body>, R: Rules): Body {
  const s = row.mythic, script = scriptOf(s), phase = script.phases[s.phase]!;
  const off = new Set<string>(phase.worn.map(w => w.key));
  const statuses = row.statuses.filter(x => !off.has(x.key));
  const o = row.origin;
  const tweak = o.kind === 'monster' ? { ...o.tweak, hp: script.hp > 0 ? o.tweak.hp / script.hp : o.tweak.hp } : null;
  const origin = o.kind === 'monster' && tweak ? { ...o, tweak } : o;
  const bar = o.kind === 'monster' && tweak ? staggerOf({ rank: o.rank, archetype: o.archetype, kind: o.monsterKind, tweak }, R) : null;
  const { stats, sheet } = modified(origin, statuses, R);
  const cleared = mythicOff(row);
  const fullHp = rowHp(row) === row.sheet.hpMax, fullMana = row.mana === row.sheet.manaMax;
  const mana = fullMana ? sheet.manaMax : Math.min(row.mana, sheet.manaMax);
  const rebuilt: Body = cleared.kind === 'monster'
    ? { ...cleared, origin, statuses, stats, sheet, speed: sheet.speed, mana, stagger: bar ? { fill: Math.min(cleared.stagger?.fill ?? 0, bar.max), max: bar.max, hit: bar.hit } : null }
    : { ...cleared, origin, statuses, stats, sheet, speed: sheet.speed, mana };
  return rowLifeAfter(rebuilt, fullHp ? { type: 'setHp', hp: sheet.hpMax } : { type: 'maxChanged' });
}

/**
 * The move mythic row `u` must land on its turn while an omen stands (design B.3, "The omen moves are not on the row"):
 * the standing's landing move (mythic.ts `landingMove`, its weak one while it falters) as `mythicMove` builds it on
 * `u`'s body, the aim it was announced at, and the move as its script writes it. Null when no omen stands.
 */
export function omenMove(u: Body, R: Rules): { readonly ability: Ability; readonly aim: Aim; readonly move: MythicMove } | null {
  const s = u.mythic, o = u.origin;
  if (!s || s.at === 'calm' || o.kind !== 'monster') return null;
  const omen = scriptOf(s).omens[s.omen], key = omen && (s.at === 'faltering' && omen.weak !== null ? omen.weak : omen.full), move = key && scriptOf(s).moves[key];
  if (!key || !move) return null;
  return { ability: mythicMove(key, move, { rank: o.rank, archetype: o.archetype, kind: o.monsterKind, tweak: o.tweak }, R), aim: s.aim, move };
}
/**
 * `u` as no taunt binds it: an omen lands where it was announced (design B.3), so the landing is read on the row without
 * its taunts (`ready`'s rule 2 then finds none). Its sheet is the row's own; the reducer puts the taunts back (`retaunted`).
 */
export const untaunted = (u: Body): Body => ({ ...u, statuses: u.statuses.filter(s => !s.def.ops.some(o => o.op === 'taunt')) });
/** `b`, the landing's user as the use left it, holding again the taunts `u` held before it (`untaunted`). */
export function retaunted(b: Body, u: Body, now: Tick, R: Rules): Body {
  const taunts = u.statuses.filter(s => s.def.ops.some(o => o.op === 'taunt') && !b.statuses.some(x => x.key === s.key));
  return taunts.length ? withStatuses(b, [...b.statuses, ...taunts], now, R) : b;
}
/** The dice the landing of `u`'s omen asks for (resolve.ts `needs` on the untaunted row); null when no omen stands. */
export function omenNeeds(f: Running, u: Body, R: Rules): Needs | null {
  const m = omenMove(u, R), free = untaunted(u);
  return m && needs(m.ability, free, f.rows.map(r => r.id === u.id ? free : r), m.aim, f.grid, f.now, R);
}

/**
 * Stealth after a change (notes-7-stealth.md section 4): a hidden body that lost HP meets the stealth machine's `hurt`,
 * which ends each of its hides that ends on a hurt (land.ts `stealthAfter`). A foe beside it reveals nothing (the owner's
 * ruling 4). Then each body hidden before the command and seen after it, by whatever ended its last hide (a hurt, a
 * reveal, damage it dealt, its time, a cure), is logged as seen.
 */
function hurtHides(before: readonly Body[], f: Running, ctx: Ctx): Running {
  let g = f;
  for (const b of before) {
    const a = rowOf(g, b.id);
    if (a && rowHp(a) < rowHp(b)) g = withRow(g, stealthAfter(a, { type: 'hurt' }, g.now, ctx.rules));
  }
  for (const b of before) {
    const a = rowOf(g, b.id);
    if (a && stealthState(stealthOf(b)) === 'hidden' && stealthState(stealthOf(a)) === 'seen') g = logged(g, line(`${a.name} is seen.`, [a.id]), ctx.rules);
  }
  return g;
}
/** `b` without its untargetable statuses: what using an ability against a foe or a place ends (kits design 8.1). */
export const unwarded = (b: Body, now: Tick, R: Rules): Body => withStatuses(b, b.statuses.filter(s => !s.def.ops.some(o => o.op === 'untargetable')), now, R);

/** Whether a sheet would see a change between two lists: a status put on, taken off, or changed in def, source, end or stacks. */
const sameStatuses = (x: readonly Status[], y: readonly Status[]): boolean => x.length === y.length && x.every((s, i) => {
  const t = y[i]!;
  return s.key === t.key && s.def === t.def && s.source.id === t.source.id && s.source.tier === t.source.tier && s.until === t.until && s.stacks === t.stacks;
});

/**
 * What the sheets of the rows of `after` hear of one command that left it from `before` (`reduce` calls it for every
 * command that changed the fight, so no path of a command changes a row its sheet does not hear of): a row that was
 * there, its change (`writeBack`); a row that joined, its totals at once (`joinedBack`). A row that left writes nothing.
 * Read at `after`'s now (0 in setup), so each status's time left is the fight's as the command leaves it.
 */
export function sheetBacks(before: Fight | null, after: Fight, ctx: Ctx): Effect[] {
  const fx: Fx = [], now = after.phase === 'setup' ? tick(0) : after.now;
  for (const a of after.rows) {
    const b = before?.rows.find(r => r.id === a.id);
    if (b) writeBack(b, a, now, ctx, fx);
    else joinedBack(a, now, ctx, fx);
  }
  return fx;
}

/**
 * The write-back of a row whose sheet holder must hear of a change from `b` to `a` at `now`: a hunter's life, mana,
 * fatigue and statuses as `vitals` (this phone) or `sendRemote` (another phone); the row's life is the sheet's while the
 * fight holds it, wherever the sheet is. A shadow's HP as `shadowHp`. Totals, so a repeat changes nothing. A row no sheet
 * holds, or with nothing changed, writes nothing. A stacking status whose count is the fight's (kits table 2.1, `keep:
 * 'fight'`) is not the sheet's: it stays in the fight and ends with it.
 */
function writeBack(b: Body, a: Body, now: Tick, ctx: Ctx, fx: Fx): void {
  const h = a.holder;
  if (!h) return;
  if (h.kind === 'shadow') { if (rowHp(a) !== rowHp(b)) fx.push({ type: 'shadowHp', hunterId: h.hunterId, shadowId: h.shadowId, hp: rowHp(a) }); return; }
  // a hunter's sheet, here or on another phone, is held only by a hunter's row (rows.ts `partyRow`)
  if (a.kind !== 'hunter') return;
  if (sameLife(a.life, b.life) && a.mana === b.mana && a.fatigue === b.fatigue && sameStatuses(a.statuses, b.statuses) && a.used === b.used) return;
  if (h.kind === 'remote') { fx.push(remoteBack(a, h.remote, now, ctx.rules)); return; }
  const t = sheetTotals(a, now, ctx.rules);
  fx.push({ type: 'vitals', hunterId: h.hunterId, life: a.life, mana: t.mana, fatigue: t.fatigue, statuses: t.statuses, ...(Object.keys(t.used).length ? { used: t.used } : {}) });
}

/**
 * What a hunter's row on another phone tells that phone as it joins (the fight's `add`): its life, mana, fatigue and
 * statuses as `sendRemote`, whatever they are. The row is built from the sheet the GM's phone last read, which can be a
 * poll behind the player's own (a fall to 0 HP just before the join), and from the join the row is the one writer of
 * them: the sheet hears the row at once, not at the row's first change, so the two never disagree in between.
 */
function joinedBack(a: Body, now: Tick, ctx: Ctx, fx: Fx): void {
  if (a.holder?.kind === 'remote' && a.kind === 'hunter') fx.push(remoteBack(a, a.holder.remote, now, ctx.rules));
}
/** The `sendRemote` of hunter row `a` for the phone of `remote` at `now`: the row's own life, and its other totals. */
function remoteBack(a: HunterRow, remote: SheetKey, now: Tick, R: Rules): Effect {
  const t = sheetTotals(a, now, R);
  return { type: 'sendRemote', remote, life: a.life, mana: t.mana, fatigue: t.fatigue, statuses: t.statuses };
}

/** What a hunter's row leaves on its sheet at `now`: HP, mana, fatigue, the statuses a sheet keeps (`onSheet`), the uses spent this rest. */
export type SheetTotals = {
  readonly hp: number; readonly mana: number; readonly fatigue: number; readonly statuses: readonly SheetStatus[]; readonly used: Readonly<Record<AbilityId, number>>;
};
/** The one answer to what a row writes back to its sheet: the fight's write-back and a played fight's end (odds.ts) both read it. */
export const sheetTotals = (a: Body, now: Tick, R: Rules): SheetTotals =>
  ({ hp: rowHp(a), mana: a.mana, fatigue: a.fatigue, statuses: sheetStatuses(a.statuses.filter(onSheet), now, R), used: gateUsed(a) });

/**
 * Pays what is due on `row`: each due op at once when its formula has no dice, and otherwise it waits in `pending` for
 * the dice a `rollSettle` effect asks for (the `settle` command pays it). `from` are the statuses the dues came from,
 * as they were before the settle, which name each heal's giver (`giverOf`).
 */
function owe(f: Running, row: Body, dues: readonly Due[], fx: Fx, R: Rules, from: readonly Status[]): Running {
  let x = row;
  const pending = [...f.pending];
  for (const due of dues) {
    const dice = diceOf(atTier(due.op.amount, due.tier));
    fx.push({ type: 'rollSettle', id: x.id, key: due.key, dice, share: due.share });
    if (!dice.length) x = payDue(x, due, [], f.now, R, giverOf(f, from, due.key));
    else if (pending.length < MAX_PENDING) pending.push({ id: x.id, due });
  }
  return { ...withRow(f, x), pending };
}

/**
 * Settles `row`'s statuses at `now` (`settle`), paying what is due (`owe`), and asks for the d20s of each spreading
 * status's pass (`spreadsOf`). A status that ended leaves after it settled.
 */
function settleRow(f: Running, row: Body, ctx: Ctx, fx: Fx): { fight: Running; ended: Raised[] } {
  const R = ctx.rules, s = settle(row.statuses, f.now, R), passes = spreadsOf(f, row, R);
  const ended = s.expired.filter(x => x.zone === undefined).map(x => raised(row.id, 'statusEnded', null, [], x.key));
  let g = f;
  for (const gone of s.expired) g = logged(g, line(`${row.name}: ${gone.def.label} ends.`, [row.id]), R);
  for (const gone of s.spent) g = logged(g, line(`${row.name}: the last ${gone.def.label} wears off.`, [row.id]), R);
  g = owe(g, withStatuses(row, s.statuses, f.now, R), s.due, fx, R, row.statuses);
  const afterOwe = rowOf(g, row.id)!;
  if (isUp(row) && !isUp(afterOwe)) {
    const killDue = s.due.find(d => d.op.op === 'damage' && !diceOf(atTier(d.op.amount, d.tier)).length);
    const st = killDue ? row.statuses.find(x => x.key === killDue.key) : undefined;
    const srcId = st?.source.id ?? null, src = srcId === null ? undefined : rowOf(g, srcId);
    if (srcId !== null) ended.push(raised(srcId, 'kill', afterOwe.id));
    const ak = armyKillOf(src, afterOwe);
    if (ak) ended.push(ak);
    ended.push(raised(afterOwe.id, 'down', srcId));
  }
  // the settle's S2 (kits design 1.6, table 2.2): a delayed effect whose time ran out lands its end on its bearer
  const due = s.expired.filter(x => x.def.end !== undefined && x.zone === undefined && endStep(ARMED, { type: 'due' }, x.def.end).lands);
  if (due.length && isUp(rowOf(g, row.id)!)) {
    const rows = new Map(g.rows.map(b => [b.id, b] as const));
    for (const x of due) {
      const e = landEnd(rows, row.id, x, f.now, R);
      const srcName = e.sourceHealed && x.source.id !== null ? rows.get(x.source.id)?.name : null;
      const parts = [...(e.dealt ? [`${e.dealt}`] : []), ...(e.sourceHealed && srcName ? [`${srcName} heals ${e.sourceHealed}`] : [])];
      g = logged({ ...g, rows: g.rows.map(b => rows.get(b.id)!) }, line(`${row.name}: ${x.def.label} lands${parts.length ? ` (${parts.join(', ')})` : ''}.`, [row.id]), R);
      if (e.dealt > 0) ended.push(raised(row.id, 'struck', x.source.id));
      if (e.down) {
        if (x.source.id !== null) ended.push(raised(x.source.id, 'kill', row.id));
        const ak = armyKillOf(x.source.id === null ? undefined : rows.get(x.source.id), rows.get(row.id));
        if (ak) ended.push(ak);
        ended.push(raised(row.id, 'down', x.source.id));
      }
    }
  }
  const pending = [...g.pending];
  for (const p of passes) {
    fx.push({ type: 'rollSettle', id: row.id, key: p.key, dice: p.targets.map(() => D20), share: 1 });
    if (pending.length < MAX_PENDING) pending.push({ id: row.id, spread: p });
  }
  return { fight: passes.length ? { ...g, pending } : g, ended };
}

/** The die a spread's resist is rolled on (rule 8b). */
export const D20: Dice = { count: 1, sides: 20 };
/**
 * The passes of `row`'s spreading statuses at its settle at `f.now` (design 4.8): for each status that is not a zone's
 * hold, that the fight keeps a list for (`had`), whose first `spread` op reaches `range` tiles (at most `spreadRangeMax`)
 * and in which a new whole round of holding it (from its `since`) has begun since it last settled: every other body
 * that is up, that the bearer sees within that reach, that does not hold the status and has never held it. At most
 * `MAX_STATUSES` statuses times the other rows, each measured once.
 */
function spreadsOf(f: Running, row: Body, R: Rules): Spread[] {
  const out: Spread[] = [];
  for (const s of row.statuses) {
    const op = s.zone === undefined ? s.def.ops.find(o => o.op === 'spread') : undefined, had = f.had[s.key];
    if (op?.op !== 'spread' || !had) continue;
    const end = s.until === null ? f.now : Math.min(f.now, s.until), round = R.fight.round;
    if (Math.floor((end - s.since) / round) <= Math.floor((s.settledAt - s.since) / round)) continue;
    const reach = Math.min(op.range, R.fight.spreadRangeMax);
    const targets = f.rows.filter(b => b.id !== row.id && isUp(b) && !had.includes(b.id) && !b.statuses.some(x => x.key === s.key)
      && dist(row.place, b.place) <= reach && sees(row.place, b.place, f.grid)).map(b => b.id);
    if (targets.length) out.push({ key: spreadKey(s.key), status: s.key, def: s.def, source: s.source, length: s.until === null ? null : tick(s.until - s.since), aim: row.sheet.aim, targets });
  }
  return out;
}

/**
 * A spreading status's pass paid with its d20s, one a target in order (design 4.8): a target still up, not holding the
 * status and not on the fight's list for it, resists on rule 8b's roll against the bearer's Accuracy, or takes the
 * status from the same source for its first length from now.
 */
export function spreadTo(f: Running, p: Spread, dice: readonly number[], R: Rules): Running {
  let g = f;
  p.targets.forEach((id, i) => {
    const t = rowOf(g, id);
    if (!t || !isUp(t) || t.statuses.some(x => x.key === p.status) || (g.had[p.status] ?? []).includes(id) || t.statuses.length >= MAX_STATUSES) return;
    if (resists(dice[i] ?? D20.sides, t.sheet.will, p.aim, R)) { g = logged(g, line(`${t.name} resists ${p.def.label}.`, [t.id]), R); return; }
    const list = applyStatus(t.statuses, statusOn(p.def, { key: p.status, source: p.source, until: p.length === null ? null : tick(g.now + p.length), since: g.now, settledAt: g.now }));
    g = logged(withRow(g, withStatuses(t, list, g.now, R)), line(`${t.name} catches ${p.def.label}.`, [t.id]), R);
  });
  return g;
}

/**
 * The fight's list of who has held each spreading status (design 4.8) after a change: every row that holds a status
 * with a `spread` op (not a zone's hold) is on that status's list, and an id no row has any more is dropped. A status
 * that is not listed yet gets a list while there are fewer than `MAX_SPREAD`. The same fight back when nothing changed.
 */
export function marked<F extends Fight>(f: F): F {
  const had: Record<string, CombatantId[]> = Object.fromEntries(Object.entries(f.had).map(([k, ids]) => [k, ids.filter(id => f.rows.some(r => r.id === id))]));
  let more = Object.entries(had).some(([k, ids]) => ids.length !== f.had[k as StatusKey]!.length);
  for (const r of f.rows) for (const s of r.statuses) {
    if (s.zone !== undefined || !s.def.ops.some(o => o.op === 'spread')) continue;
    const list = had[s.key] ?? (Object.keys(had).length < MAX_SPREAD ? (had[s.key] = []) : null);
    if (list && !list.includes(r.id)) { list.push(r.id); more = true; }
  }
  return more ? { ...f, had } : f;
}

/**
 * The ground at the fight's now (zones.ts `zoneSync`): zones that ended are gone, each body holds the zones it stands in,
 * and what an entry pays is paid or waits for its dice. Called after every change of a place, a zone or the time.
 */
export function grounded(f: Running, ctx: Ctx, fx: Fx, forced?: ReadonlySet<string>): Running {
  if (!f.zones.length && !f.rows.some(r => r.statuses.some(s => (s.zone !== undefined && s.until === null) || s.def.ops.some(o => o.op === 'aura')))) return f;
  const s = zoneSync(f.rows, f.zones, f.grid, f.now, ctx.rules, forced);
  // a zone whose time passed lands its end on who stood in it, when it is old enough (kits design 1.8.3, table 2.6)
  const timed = f.zones.filter(z => z.end?.length && z.until !== null && z.until <= f.now && !s.zones.some(x => x.id === z.id)
    && zoneStep({ at: 'laid' }, { type: 'time', old: oldEnough(z, z.until, ctx.rules) }).lands);
  let g: Running = zoneEnds({ ...f, rows: s.rows, zones: s.zones }, timed, f.rows, ctx);
  for (const z of f.zones) if (!s.zones.some(x => x.id === z.id)) g = logged(g, line(`${z.name} is gone.`, [], [z.id]), ctx.rules);
  for (const z of s.zones) if (!f.zones.some(x => x.id === z.id)) g = logged(g, line(`${z.name} is now around ${rowOf(g, anchorOf(z) ?? '')?.name ?? 'it'}.`, [...(anchorOf(z) === null ? [] : [anchorOf(z)!])], [z.id]), ctx.rules);
  for (const e of s.entries) g = owe(g, rowOf(g, e.id)!, [e.due], fx, ctx.rules, []);
  // what the ground paid (an entry's hit, an end's) meets the triggers as it lands: a fall under the low share
  return s.entries.length || timed.length ? triggered(g, [], ctx) : g;
}

/**
 * Zones that ended with their end landing (kits design 1.8.3): each lands its `end` ops once on every body that held it
 * in `stood` (the rows before it ended), from its owner at its tier, at their averages; a line names each.
 */
export function zoneEnds(f: Running, ending: readonly Zone[], stood: readonly Body[], ctx: Ctx): Running {
  let g = f;
  const events: Raised[] = [];
  for (const z of ending) {
    const inside = stood.filter(b => b.statuses.some(s => s.zone === z.id && s.until === null)).map(b => b.id);
    const rows = new Map(g.rows.map(b => [b.id, b] as const)), owner = z.owner === null ? null : rows.get(z.owner) ?? null;
    const r = landOps(rows, (z.end ?? []).filter(o => o.op !== 'refund'), owner, inside, { id: z.owner, tier: z.tier }, g.now, ctx.rules);
    const parts = landedWords(r.landed, id => rows.get(id)?.name ?? id);
    g = logged({ ...g, rows: g.rows.map(b => rows.get(b.id)!) }, line(`${z.name} ends${parts.length ? ` (${parts.join(', ')})` : ''}.`, [...r.landed.filter(l => l.dealt || l.healed).map(l => l.target)], [z.id]), ctx.rules);
    for (const l of r.landed) {
      if (!l.down) continue;
      if (z.owner !== null) events.push(raised(z.owner, 'kill', l.target));
      const ak = armyKillOf(owner ?? undefined, rows.get(l.target));
      if (ak) events.push(ak);
      events.push(raised(l.target, 'down', z.owner));
    }
  }
  return events.length ? triggered(g, events, ctx) : g;
}

/**
 * Summons that leave (kits table 2.4): their rows and what waits for their dice are gone, with a line each ("Sprite
 * fades."). A summon is not written back and gives no XP, so nothing else follows.
 */
export function sentAway(f: Running, gone: readonly Body[], why: string, ctx: Ctx): Running {
  if (!gone.length) return f;
  const ids = new Set(gone.map(b => b.id as string));
  let g: Running = { ...f, rows: f.rows.filter(r => !ids.has(r.id)), pending: f.pending.filter(p => !ids.has(p.id)) };
  for (const b of gone) g = logged(g, line(`${b.name} ${why}.`, [b.id]), ctx.rules);
  return g;
}

/**
 * Mythic row `row`'s turn start (design B.3, "Its turn start, in order"), the first that applies: its phase over and not
 * its last, it enters the next (`phasedRow`), the turn spent; an omen standing, nothing (the fight is `landing` until
 * the move goes off); an omen beat, the omen is announced at its aim (`omenAim`) with its HP now, the turn spent; else
 * an act beat, and the turn goes on as any monster's. `spent` says the turn is over.
 */
function scriptTurn(f: Running, row: Scripted<Body>, ctx: Ctx, fx: Fx): { fight: Running; spent: boolean } {
  const R = ctx.rules, s = row.mythic, script = scriptOf(s);
  if (phaseOver(row, f.now, R)) {
    const x = phasedRow(row, 'turn', f.now, R);
    if (isRefused(x)) return { fight: f, spent: false };
    fx.push({ type: 'phased', id: row.id, phase: s.phase + 1 });
    const g = logged(withRow(f, x), line(`${row.name} enters ${script.phases[s.phase + 1]!.name}.`, [row.id]), R);
    return { fight: consequences(f.rows, g, ctx, fx), spent: true };
  }
  if (s.at !== 'calm') return { fight: f, spent: false };
  const beat = beatOf(s, f.now, R);
  if (beat.kind === 'act') {
    const x = mythicStepped<Body>(row, { type: 'beat' });
    return { fight: isRefused(x) ? f : withRow(f, x), spent: false };
  }
  const omen = script.omens[beat.omen]!, full = script.moves[omen.full]!;
  const bar = row.stagger && { fill: row.stagger.fill, max: row.stagger.max };
  const x = mythicStepped<Body>(row, { type: 'announce', omen: beat.omen, aim: omenAim(omen.aim, full, row, f), hpAt: rowHp(row), barAt: bar });
  if (isRefused(x)) return { fight: f, spent: false };
  fx.push({ type: 'omen', id: row.id, omen: beat.omen });
  const said = enraged(s, f.now, R) ? `${row.name} is enraged and readies ${omen.name}. It lands on its next turn.` : `${row.name} readies ${omen.name}. It lands on its next turn.`;
  return { fight: logged(withRow(f, acted({ ...x, intent: null }, f.now, paceCost(R.fight.mythic.turnPace, R.fight), R.fight)), line(said, [row.id]), R), spent: true };
}

/** A guard on `startTurn`'s loop, not a rule: the passes it may take for each row (and one row more). */
const PASSES_PER_ROW = 4;

/**
 * Begins the next turn: the lowest `at` among those up acts, `now` moves to it, time passes for everyone (`advance`), the
 * body's statuses settle, a held body's turn is passed and a holding channel grows, its threat with it. Ends the fight when a side has
 * nobody up, before or after a status's damage. Emits `turnStarted` for the turn that begins.
 */
export function startTurn(f: Running, ctx: Ctx, fx: Fx): Running | Ended {
  const R = ctx.rules;
  let g = f;
  // Each pass either starts a turn, downs a body or moves a held body's turn past `now`, so the rows bound the passes.
  for (let pass = 0; pass < PASSES_PER_ROW * (g.rows.length + 1); pass++) {
    const over = overIf(g, fx, R);
    if (over) return over;
    const first = next(g.rows.filter(isUp))!;
    // a `turn` reaction armed on the body whose turn comes next moves its reactor's turn before it (kits design 8.6.3)
    const map = new Map(g.rows.map(b => [b.id, b] as const)), jumped = turnReaction(map, first, g.now, R);
    // what it cost or dealt meets the triggers as it lands: a fall under the low share
    if (jumped) { fx.push(...burstsOf(jumped.bursts)); g = consequences(g.rows, triggered(logged({ ...g, rows: g.rows.map(b => map.get(b.id)!) }, line(`${jumped.said}.`, [...jumped.about]), R), [], ctx), ctx, fx); continue; }
    // Taken before time moves, so a status that ends for anyone reaches its sheet.
    const before = g.rows, time = advance(g, tick(Math.max(g.now, first.at)), R);
    g = grounded(time.fight, ctx, fx);
    // a zone's end lands as time moves (`grounded`) and may down the last body of a side, or of both: what it did is
    // written, and the next pass ends the fight before anyone's turn begins
    if (standing(g).length < 2) { g = consequences(before, g, ctx, fx); continue; }
    const who = next(g.rows.filter(isUp))!;
    // the settle's S0 (kits table 2.4): a summon whose time is up leaves before it acts
    if (timeUp(who, g.now)) { g = consequences(before, sentAway(g, [who], 'leaves because its time is up', ctx), ctx, fx); continue; }
    g = { ...g, currentId: who.id };
    const settled = settleRow(g, who, ctx, fx);
    g = consequences(before, settled.fight, ctx, fx);
    if (!rowOf(g, who.id)) continue;
    // the settle's S4 (kits design 1.8.1): the row pays the upkeep of the zones it holds, or they lapse with no end
    if (g.zones.some(z => z.upkeep && z.owner === who.id)) {
      const pay = payUpkeep(rowOf(g, who.id)!, g.zones, g.now, R), pre = g.rows;
      g = { ...withRow(g, pay.owner), zones: pay.zones };
      for (const z of pay.lapsed) g = logged(g, line(`${z.name} ends because ${who.name} cannot pay its upkeep.`, [who.id], [z.id]), R);
      g = consequences(pre, g, ctx, fx);
    }
    // the settle's events (kits design 1.3.5, the settle's S3): statuses that ended by time, then the turn's start
    const pre = g.rows;
    g = consequences(pre, triggered(g, [...time.ended, ...settled.ended, ...(isUp(rowOf(g, who.id)!) ? [raised(who.id, 'turnStart')] : [])], ctx), ctx, fx);
    const done = overIf(g, fx, R);
    if (done) return done;
    const found = rowOf(g, who.id);
    // a summon its owner's fall sent away, or a row down, takes no turn
    if (!found || !isUp(found)) continue;
    let row = found;
    if (held(row, g.now)) {
      g = logged(withRow(g, resetMoved(acted(row, g.now, paceCost('standard', R.fight), R.fight))), line(`${row.name} cannot act and loses the turn.`, [row.id]), R);
      continue;
    }
    // a mythic's script at its turn start (design B.3): its phase change or an announce spends the turn; an act beat goes on
    if (playsScript(row)) {
      const m = scriptTurn(g, row, ctx, fx);
      if (m.spent) { g = m.fight; continue; }
      g = m.fight; row = rowOf(g, row.id)!;
    }
    if (row.channel?.state === 'holding') {
      const a = row.abilities.find(x => x.id === row.channel!.ability);
      const max = a?.channel?.max ?? R.fight.channelMax;
      const was = row.channel;
      row = { ...row, channel: channelStep(row.channel, { type: 'grow', max }) };
      g = withRow(g, row);
      if (row.channel?.charge !== was.charge) {
        fx.push({ type: 'channel', id: row.id, state: 'holding', charge: row.channel!.charge });
        // A channel's threat follows its payoff (design 4.1): each charge multiplies the channeler's entry in every foe's
        // table by what the charge multiplied the payoff by, so a wind-up every foe can see draws its eye.
        const id = row.id, side = row.side, k = row.channel!.charge;
        const growth = a?.channel?.growth === 'linear' ? (1 + R.fight.channelLin * k) / (1 + R.fight.channelLin * (k - 1)) : R.fight.channelExp;
        g = { ...g, rows: g.rows.map(b => b.side !== side && isUp(b) ? withThreat(b, t => ({ ...t, [id]: (t[id] ?? 0) * growth })) : b) };
      }
    }
    // its turn began: its movement bank refills, it may be hastened again (kits table 8.9.6), and the reactions its turn restores are armed again (8.9.1)
    if (row.kind === 'hunter' && row.moved !== undefined) { row = resetMoved(row); g = withRow(g, row); }
    if (row.hastened) { const { hastened: _was, ...rest } = row; row = rest; g = withRow(g, row); }
    if (g.rows.some(b => b.armed?.spent)) { g = { ...g, rows: restored(g.rows, row.id) }; row = rowOf(g, row.id)!; }
    // the turn counts on its row (row-tally.ts): a turn held or lost to a stagger was not begun
    g = { ...g, rows: tallied(g.rows, { type: 'turn', id: row.id }) }; row = rowOf(g, row.id)!;
    fx.push({ type: 'turnStarted', id: row.id, hunterId: row.holder?.kind === 'local' ? row.holder.hunterId : null, now: g.now });
    return logged(g, line(`${row.name}'s turn.`, [row.id]), R);
  }
  return g;
}
