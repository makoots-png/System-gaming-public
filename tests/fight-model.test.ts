// A model test of the reworked fight (src/core/combat/fight.ts): 2,500 seeded fights of random legal and illegal commands
// over a mixed party and pack on a map with walls, with the invariants below checked after every command. A failure
// prints the seed and the commands up to it. The fights are in tests/models/fight-play.ts, which the charts play too.
import { tallyOf } from '../src/core/combat/row-tally.ts';
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { TERRAIN } from '../src/core/combat/space.ts';
import { modified, onSheet, perRound, stacked } from '../src/core/combat/effect-ops.ts';
import type { Status } from '../src/core/combat/effect-ops.ts';
import { hpPrice } from '../src/core/combat/resolve.ts';
import { usesGates } from '../src/core/combat/uses.ts';
import { fire, raised } from '../src/core/combat/triggers.ts';
import type { Raised, Trigger } from '../src/core/combat/triggers.ts';
import { MAX_ZONES, standsIn, zoneTiles } from '../src/core/combat/zones.ts';
import { held, isUp, partyView } from '../src/core/combat/fight-turn.ts';
import { alive } from '../src/core/combat/land.ts';
import { concealed } from '../src/core/combat/standing.ts';
import { parseFight } from '../src/core/combat/fight-parse.ts';
import { MAX_SPREAD, reduce } from '../src/core/combat/fight.ts';
import type { Command, Effect, Fight } from '../src/core/combat/fight.ts';
import { place } from '../src/core/combat/space.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import type { Rolls } from '../src/core/combat/resolve.ts';
import { fightId } from '../src/core/combat/fight.ts';
import { GRID, ROSTER, SEEDS, ctx, lengthOf, randomCommand, rng } from './models/fight-play.ts';

const deepFreeze = <T>(v: T): T => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const x of Object.values(v)) deepFreeze(x); }
  return v;
};
const json = (v: unknown): string => JSON.stringify(v);
/** Deep equality of JSON-like values, ignoring key order. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b), ra = a as Record<string, unknown>, rb = b as Record<string, unknown>;
  return ka.length === kb.length && ka.every(k => Object.hasOwn(rb, k) && same(ra[k], rb[k]));
}

/**
 * What the model remembers between commands: per status instance, the ticks its rollSettle effects paid for; per row a
 * sheet holds, what that sheet was last told (its HP, mana, fatigue and status keys, from the row as it joined and then
 * from each write-back).
 */
type Told = { hp: number; mana: number; fatigue: number; keys: string };
type Memory = { fightId: string | null; settled: Map<string, number>; since: Map<string, number>; told: Map<string, Told>; reacted: Map<string, number>; wards: Map<string, number> };
const fresh = (): Memory => ({ fightId: null, settled: new Map(), since: new Map(), told: new Map(), reacted: new Map(), wards: new Map() });
/** A sheet's status keys: a zone's hold is the ground's, and a fight's count or a delayed effect the fight's (`onSheet`): neither reaches a sheet. */
const keysOf = (list: readonly { key: string; zone?: string }[]): string => list.filter(s => s.zone === undefined).map(s => s.key).sort().join(',');
const sheetKeysOf = (list: readonly Status[]): string => keysOf(list.filter(onSheet));

/** A row's sheet must have heard of every change of its HP, mana, fatigue and statuses (a shadow's sheet, of its HP). */
function toldWrong(after: Fight, effects: readonly Effect[], mem: Memory): string | null {
  for (const r of after.rows) if (r.holder && !mem.told.has(r.id)) mem.told.set(r.id, { hp: r.hp, mana: r.mana, fatigue: r.fatigue, keys: sheetKeysOf(r.statuses) });
  for (const e of effects) {
    const r = after.rows.find(x => x.holder && (
      e.type === 'vitals' ? x.holder.kind === 'local' && x.holder.hunterId === e.hunterId
        : e.type === 'sendRemote' ? x.holder.kind === 'remote' && x.holder.remote === e.remote
          : e.type === 'shadowHp' && x.holder.kind === 'shadow' && x.holder.shadowId === e.shadowId));
    if (!r) continue;
    const was = mem.told.get(r.id)!;
    mem.told.set(r.id, e.type === 'shadowHp' ? { ...was, hp: e.hp } : e.type === 'vitals' || e.type === 'sendRemote'
      ? { hp: e.hp, mana: e.mana, fatigue: e.fatigue, keys: keysOf(e.statuses) } : was);
  }
  for (const r of after.rows) {
    if (!r.holder) continue;
    const t = mem.told.get(r.id)!;
    const now: Told = r.holder.kind === 'shadow' ? { ...t, hp: r.hp } : { hp: r.hp, mana: r.mana, fatigue: r.fatigue, keys: sheetKeysOf(r.statuses) };
    if (json(now) !== json(t)) return `${r.id}'s sheet was last told ${json(t)} but the row holds ${json(now)}`;
  }
  return null;
}

/** What is wrong after `cmd` took `before` to `after`, or null. */
function check(before: Fight | null, cmd: Command, after: Fight | null, effects: readonly Effect[], mem: Memory): string | null {
  if (effects.length && effects.every(e => e.type === 'refused') && after !== before && json(after) !== json(before)) return 'a refused command changed the fight';
  const by = 'by' in cmd ? before?.rows.find(r => r.id === cmd.by) : undefined;
  if (by && by.kind !== 'hunter' && by.hp === 0 && ['act', 'move', 'endTurn', 'release'].includes(cmd.type) && !effects.some(e => e.type === 'refused')) {
    return `${by.id}, down, took ${cmd.type}`;
  }
  if (!after) return null;
  if (after.id !== mem.fightId) { mem.fightId = after.id; mem.settled.clear(); mem.since.clear(); mem.told.clear(); mem.reacted.clear(); mem.wards.clear(); }
  const told = toldWrong(after, effects, mem);
  if (told) return told;
  const ids = after.rows.map(r => r.id);
  if (new Set(ids).size !== ids.length) return 'two rows share an id';
  const tiles = new Set<string>();
  for (const r of after.rows) {
    const s = r.sheet;
    if (r.hp < 0 || r.hp > s.hpMax) return `${r.id} has HP ${r.hp} of ${s.hpMax}`;
    if (r.mana < 0 || r.mana > s.manaMax) return `${r.id} has mana ${r.mana} of ${s.manaMax}`;
    if (r.fatigue < 0 || r.fatigue > s.fatigueMax) return `${r.id} has fatigue ${r.fatigue} of ${s.fatigueMax}`;
    const { x, y } = r.place;
    if (x < 0 || y < 0 || x >= after.grid.w || y >= after.grid.h) return `${r.id} stands off the grid at ${x},${y}`;
    // a monster or shadow at 0 is gone from the map, and a painted wall may cover where it fell
    if (alive(r) && !TERRAIN[after.grid.tiles?.[y * after.grid.w + x] ?? 'floor'].walk) return `${r.id} stands on ${after.grid.tiles?.[y * after.grid.w + x]} at ${x},${y}`;
    if (alive(r)) { if (tiles.has(`${x},${y}`)) return `two bodies stand on ${x},${y}`; tiles.add(`${x},${y}`); }
    const max = r.abilities.find(a => a.id === r.channel?.ability)?.channel?.max ?? RULES.fight.channelMax;
    if (r.channel && (r.channel.charge < 0 || r.channel.charge > max)) return `${r.id}'s channel has charge ${r.channel.charge} of ${max}`;
  }
  const paid = new Map<string, number>();
  for (const e of effects) if (e.type === 'rollSettle') { const k = `${e.id}|${e.key}`; paid.set(k, (paid.get(k) ?? 0) + e.share * RULES.fight.round); }
  for (const r of after.rows) for (const s of r.statuses.filter(x => x.def.ops.some(perRound))) {
    const k = `${r.id}|${s.key}`;
    const total = (mem.since.get(k) === s.since ? mem.settled.get(k) ?? 0 : 0) + (paid.get(k) ?? 0);
    mem.since.set(k, s.since); mem.settled.set(k, total);
    if (Math.abs(total - (s.settledAt - s.since)) > 1e-6) return `${r.id}'s ${s.key} settled for ${total} ticks over a span of ${s.settledAt - s.since}`;
  }
  if (before && 'now' in before && 'now' in after && before.id === after.id && after.now < before.now) return `now went back from ${before.now} to ${after.now}`;
  if (after.fog && after.phase !== 'ended') {
    const lit = partyView(after)!, missed = [...lit].find(i => after.fog!.seen[i] !== '1');
    if (missed !== undefined) return `the party sees tile ${missed} but the fog has not marked it seen`;
  }
  if (after.phase === 'running') {
    const gone = after.zones.find(z => z.until !== null && z.until <= after.now);
    if (gone) return `${gone.id} ended at ${gone.until} and is still on the ground at ${after.now}`;
    for (const r of after.rows.filter(x => x.hp > 0 || x.kind === 'hunter')) for (const z of after.zones) {
      const open = r.statuses.filter(s => s.zone === z.id && s.until === null).length, inside = standsIn(z, zoneTiles(z, after.rows, after.grid, after.now, RULES), r) ? 1 : 0;
      if (open !== inside) return `${r.id} holds ${open} open holds on ${z.id} and ${inside ? 'stands' : 'does not stand'} in it`;
    }
    for (const z of after.zones) {
      const g = z.ground, a = g.kind === 'around' && g.anchor.kind === 'body' ? g.anchor : null, b = a && after.rows.find(r => r.id === a.id);
      if (a && !(b && isUp(b))) return `the aura ${z.id} is on the ground around ${a.id}, who is not up`;
      if (a?.status && !b!.statuses.some(s => s.key === a.status && s.zone === undefined && s.def.ops.some(o => o.op === 'aura'))) return `the aura ${z.id} stays after ${a.id} lost ${a.status}`;
    }
    for (const r of after.rows) for (const s of r.statuses) {
      if (s.zone !== undefined || !s.def.ops.some(o => o.op === 'spread')) continue;
      const list = after.had[s.key];
      if (Object.keys(after.had).length < MAX_SPREAD && !list?.includes(r.id)) return `${r.id} holds the spreading ${s.key} and is not on its list`;
      const was = before?.rows.find(x => x.id === r.id);
      if (cmd.type === 'settle' && before?.had[s.key]?.includes(r.id) && !was?.statuses.some(x => x.key === s.key)) return `${r.id} caught ${s.key} again`;
    }
    if (Object.keys(after.had).length > MAX_SPREAD) return `the fight lists ${Object.keys(after.had).length} spreading statuses`;
    for (const [k, ids] of Object.entries(after.had)) if (ids.some(id => !after.rows.some(r => r.id === id))) return `${k}'s list names a row not in the fight`;
    if (after.zones.length < MAX_ZONES) for (const r of after.rows.filter(isUp)) for (const s of r.statuses) {
      const lasts = s.zone === undefined && (s.until === null || s.until > after.now) && s.def.ops.some(o => o.op === 'aura');
      const has = after.zones.some(z => z.ground.kind === 'around' && z.ground.anchor.kind === 'body' && z.ground.anchor.id === r.id && z.ground.anchor.status === s.key);
      if (lasts && !has) return `${r.id} bears ${s.key}, which gives off an aura, and none is on the ground`;
    }
  }
  const tally = tallyWrong(before, after);
  if (tally) return tally;
  const kits = kitsWrong(before, cmd, after, effects);
  if (kits) return kits;
  const wave2 = wave2Wrong(before, cmd, after, effects, mem);
  if (wave2) return wave2;
  if (after.phase === 'running') {
    for (const side of ['party', 'foe'] as const) if (!after.rows.some(r => r.side === side && isUp(r) && r.kind !== 'summon')) return `the ${side} side has only summons up, or none, and the fight runs on`;
    const cur = after.rows.find(r => r.id === after.currentId);
    if (!cur) return `the current row ${after.currentId} is not in the fight`;
    if (!isUp(cur)) return `the current row ${cur.id} is down`;
    if (held(cur, after.now)) return `the current row ${cur.id} is held`;
    if (cur.at !== after.now) return `the current row ${cur.id} waits to ${cur.at}, not now ${after.now}`;
    const early = after.rows.find(r => isUp(r) && !held(r, after.now) && r.at < after.now);
    if (early) return `${early.id} is up at ${early.at}, before now ${after.now}`;
  }
  const stored = JSON.parse(json(after));
  if (!same(parseFight(stored, RULES), stored)) return 'parseFight does not give the same fight back';
  return null;
}

/**
 * A row's tally (row-tally.ts): no count goes down over a command, its lowest HP share never rises, a row other than a
 * hunter keeps only its kills, and every kill names a foe of the fight on the other side.
 */
function tallyWrong(before: Fight | null, after: Fight): string | null {
  const COUNTS = ['hits', 'crits', 'critRunMax', 'struck', 'avoided', 'dealt', 'taken', 'healed', 'raised', 'hexes', 'downs', 'turns', 'items'] as const;
  for (const r of after.rows) {
    const t = tallyOf(r), was = before?.rows.find(x => x.id === r.id);
    if (r.kind !== 'hunter' && r.tally && Object.keys(r.tally).some(k => k !== 'kills')) return `${r.id}, not a hunter, keeps ${Object.keys(r.tally).join(', ')}`;
    for (const k of t.kills) { const foe = after.rows.find(x => x.id === k.row); if (!foe || foe.side === r.side) return `${r.id} counts a kill of ${k.row}, not a foe in the fight`; }
    if (!was) continue;
    const w = tallyOf(was);
    for (const k of COUNTS) if (t[k] < w[k]) return `${r.id}'s ${k} went from ${w[k]} to ${t[k]}`;
    if (t.low > w.low) return `${r.id}'s lowest HP share rose from ${w.low} to ${t.low}`;
    if (t.kills.length < w.kills.length || t.downedBy.length < w.downedBy.length) return `${r.id} lost a kill or a fall`;
  }
  return null;
}

/**
 * The kits' invariants (kits design 3.1 and 3.2): no count past its cap; an owner holds at most `summons` summons, each
 * on its owner's side for at most `summonRounds`, and at most `zonesPerOwner` zones; no limited ability past its uses;
 * and an HP price never takes its user to 0 (a use with one that went through had more HP than the price).
 */
function kitsWrong(before: Fight | null, cmd: Command, after: Fight, effects: readonly Effect[]): string | null {
  const K = RULES.fight.kit;
  for (const r of after.rows) {
    for (const s of r.statuses) if (stacked(s) && (s.stacks < 1 || s.stacks > s.def.stack.cap)) return `${r.id} holds ${s.stacks} of ${s.key}, cap ${s.def.stack.cap}`;
    const summons = after.rows.filter(x => x.kind === 'summon' && x.owner === r.id);
    if (summons.length > K.summons) return `${r.id} holds ${summons.length} summons`;
    if (summons.some(x => x.side !== r.side || x.until === undefined || x.until - ('now' in after ? after.now : 0) > K.summonRounds * RULES.fight.round)) return `${r.id} holds a summon off its side or past its rounds`;
    const zones = after.zones.filter(z => z.owner === r.id && !(z.ground.kind === 'around' && z.ground.anchor.kind === 'body' && z.ground.anchor.status !== null));
    if (zones.length > K.zonesPerOwner) return `${r.id} holds ${zones.length} zones`;
    for (const a of r.abilities) for (const g of usesGates(a)) if ((r.used?.[a.id] ?? 0) > K.fightUses || (g.per === 'fight' && (r.used?.[a.id] ?? 0) > g.n)) return `${r.id} spent ${r.used?.[a.id]} of ${a.id}, ${g.n} a ${g.per}`;
    // a corpse's extraction (extraction.ts): a monster's only, and open only with an attempt left
    const e = r.extraction, was = before?.rows.find(x => x.id === r.id)?.extraction;
    if (e && (r.kind !== 'monster' || (e.at === 'open' && (e.tried < 1 || e.tried >= RULES.shadow.maxAttempts)))) return `${r.id} holds the extraction ${json(e)}`;
    if (was && was.at === 'gone' && json(e) !== json(was)) return `${r.id}'s spent corpse took another attempt`;
  }
  if (cmd.type === 'act' && before && !effects.some(e => e.type === 'refused')) {
    const u = before.rows.find(r => r.id === cmd.by), a = u?.abilities.find(x => x.id === cmd.ability);
    for (const p of a?.prices ?? []) if (p.kind === 'hp' && u && u.hp <= hpPrice(p, u.sheet.hpMax)) return `${u.id} paid an HP price of ${hpPrice(p, u.sheet.hpMax)} at ${u.hp} HP`;
  }
  return null;
}

/**
 * Wave 2's invariants (kits design 8.10): a reaction never fires twice between two of its reactor's turns; a foe that is
 * untargetable or hidden is never a use's aim; a ward reaches a body once a fight; no turn that moved is set before the
 * next tick; no body takes more than `extraPerRound` extra actions in a round. (A forced move never ending on a wall, a
 * pit or a body is the place checks of `check`, which every command meets.)
 */
function wave2Wrong(before: Fight | null, cmd: Command, after: Fight, effects: readonly Effect[], mem: Memory): string | null {
  const refused = effects.some(e => e.type === 'refused');
  const texts = after.log.map(l => l.text), at = before ? texts.indexOf(before.log[0]?.text ?? '') : texts.length;
  const fresh = (before && before.id === after.id ? (at < 0 ? [] : texts.slice(0, at)) : texts).slice().reverse();
  for (const line of fresh) for (const r of after.rows) {
    if (line.endsWith(`: ${r.name}'s turn.`)) mem.reacted.set(r.id, 0);
    const n = line.split(`${r.name} reacts with `).length - 1;
    if (n > 0) { const k = (mem.reacted.get(r.id) ?? 0) + n; mem.reacted.set(r.id, k); if (k > 1) return `${r.id} reacted ${k} times between two of its turns`; }
  }
  if (cmd.type === 'act' && before && !refused && typeof cmd.aim === 'string') {
    const u = before.rows.find(r => r.id === cmd.by), t = before.rows.find(r => r.id === cmd.aim);
    if (u && t && concealed(t, u.side)) return `${u.id} used ${cmd.ability} on ${t.id}, which is hidden or untargetable to it`;
  }
  for (const r of after.rows) {
    const was = before?.rows.find(x => x.id === r.id);
    for (const w of ['untargetable', 'invulnerable'] as const) {
      const now = r.statuses.filter(s => s.def.ops.some(o => o.op === w)).map(s => s.key), then = was?.statuses.filter(s => s.def.ops.some(o => o.op === w)).map(s => s.key) ?? [];
      if (now.some(k => !then.includes(k))) { const k = `${r.id}|${w}`, c = (mem.wards.get(k) ?? 0) + 1; mem.wards.set(k, c); if (c > 1) return `${r.id} was ${w} ${c} times in a fight`; }
    }
    if ((r.extras?.n ?? 0) > RULES.fight.kit.extraPerRound) return `${r.id} took ${r.extras!.n} extra actions in a round`;
    if (before && 'now' in before && before.phase === 'running' && was && isUp(was) && isUp(r) && r.at !== was.at && r.at < before.now + 1 && !(after.phase === 'running' && after.currentId === r.id && r.at === after.now)) {
      return `${r.id}'s turn moved to ${r.at}, before the next tick after ${before.now}`;
    }
  }
  return null;
}

type Failure = { seed: number; at: number; problem: string; commands: Command[] };
/**
 * Plays one seed; answers its first failure with the commands up to it. The fight and the command are frozen deep, so a
 * reducer that writes to its input throws (modules are strict) and is reported.
 */
function runSeed(seed: number, tally: Map<string, number>): Failure | null {
  const g = rng(seed), mem = fresh(), commands: Command[] = [];
  let fight: Fight | null = null, n = 0;
  const next = (): string => `x${seed}-${n++}`;
  for (let i = 0; i < lengthOf(seed); i++) {
    const cmd = randomCommand(g, fight, next);
    commands.push(cmd);
    const before: Fight | null = deepFreeze<Fight | null>(fight);
    let out: { fight: Fight | null; effects: readonly Effect[] } | null = null;
    try { out = reduce(before, deepFreeze(cmd), ctx); } catch (err) { return { seed, at: i, problem: `threw ${String(err)}`, commands }; }
    const problem = check(before, cmd, out.fight, out.effects, mem);
    if (problem) return { seed, at: i, problem, commands };
    for (const e of out.effects) tally.set(e.type, (tally.get(e.type) ?? 0) + 1);
    for (const e of out.effects) if (e.type === 'rollSettle' && e.key.endsWith('-spread')) tally.set('spread', (tally.get('spread') ?? 0) + 1);
    // the kits' blocks, by the lines they log
    const fresh = out.fight && out.fight !== before ? out.fight.log.slice(0, 8) : [];
    for (const [k, re] of KIT_LINES) if (fresh.some(l => re.test(l.text))) tally.set(k, (tally.get(k) ?? 0) + 1);
    if (before?.phase !== out.fight?.phase) tally.set(`${before?.phase ?? 'none'}>${out.fight?.phase ?? 'none'}`, 1);
    fight = out.fight;
  }
  return null;
}

/** Plays fixed commands with the same checks; answers the first problem and the last fight. */
export function replay(commands: readonly Command[]): { problem: string | null; fight: Fight | null; effects: Effect[] } {
  const mem = fresh(), all: Effect[] = [];
  let fight: Fight | null = null;
  for (const [i, cmd] of commands.entries()) {
    const out = reduce(fight, cmd, ctx);
    all.push(...out.effects);
    const problem = check(fight, cmd, out.fight, out.effects, mem);
    if (problem) return { problem: `command ${i + 1}: ${problem}`, fight: out.fight, effects: all };
    fight = out.fight;
  }
  return { problem: null, fight, effects: all };
}

/** The whole roster on the map, and a start where `first` rolls 20 and everyone else 1. */
const opening = (first: string): Command[] => [
  { type: 'add', fightId: fightId('f-replay'), rows: ROSTER, openings: [], grid: GRID },
  { type: 'start', openings: ROSTER.map(r => ({ id: r.id, d20: r.id === first ? 20 : 1, tie: 0 })) },
];
const rolls = (dice: Record<string, number[]>, react: Record<string, number>): Rolls => ({ dice: dice as Rolls['dice'], react: react as Rolls['react'] });
const cid = combatantId;

describe('what random play found', () => {
  // Seed 19: Mira's snare weakens the Ogre's Vitality, which lowers its max HP, and its HP stayed above the new max.
  test('a status that lowers a full monster\'s max HP leaves its bar full at the new max, not over it', () => {
    const r = replay([...opening('c-mira'), { type: 'act', by: cid('c-mira'), ability: abilityId('snare'), aim: cid('c-ogre'), rolls: rolls({ 'c-ogre': [4] }, { 'c-ogre': 2 }) }]);
    expect(r.problem).toBeNull();
    const ogre = r.fight!.rows.find(x => x.id === 'c-ogre')!, fresh = ROSTER.find(x => x.id === 'c-ogre')!;
    expect(ogre.statuses.map(x => x.key)).toContain('weakened');
    expect(ogre.hp).toBe(ogre.sheet.hpMax);
    expect(ogre.hp).toBeLessThan(fresh.hp);
  });

  // Seed 89: Sela began a channel aimed at a tile past the map's edge; the fight then could not be read back, so it could
  // not be stored or shared.
  test('a channel aimed past the edge of the map is refused, and the fight can still be stored', () => {
    const r = replay([...opening('c-sela'), { type: 'act', by: cid('c-sela'), ability: abilityId('charge'), aim: place(-1, 10), rolls: rolls({}, {}) }]);
    expect(r.problem).toBeNull();
    expect(r.effects.at(-1)).toEqual({ type: 'refused', reason: 'offGrid' });
  });

  // Seed 596: the GM made a wolf stun the hunter whose turn it was; the turn stayed with the stunned hunter.
  test('a hunter stunned by the GM on its own turn loses that turn, and its next one starts when the stun ends', () => {
    const r = replay([...opening('c-brakk'), { type: 'act', by: cid('c-w1'), ability: abilityId('howl'), aim: cid('c-brakk'), rolls: rolls({ 'c-brakk': [3] }, { 'c-brakk': 2 }), force: true }]);
    expect(r.problem).toBeNull();
    expect(r.effects.filter(e => e.type === 'refused')).toEqual([]);
    const started = r.effects.flatMap(e => e.type === 'turnStarted' ? [[e.id, e.now]] : []);
    expect(started[0]).toEqual([cid('c-brakk'), 0]);
    expect(started.at(-1)![1]).toBeGreaterThan(0);
  });
});

/** What each kits block logs, so random play shows it reached each (kits design 3.2). */
const KIT_LINES: readonly (readonly [string, RegExp])[] = [
  ['trigger', /^R\d+: Then: /], ['extraction', /: The extraction of .+ fails|rises as a shadow|corpse is destroyed/], ['threshold', /Resonance goes off/], ['delayed end', /Hemoplague lands/], ['zone upkeep lapse or end', /Boundary ends/],
  ['summon', /calls Sprite/], ['summon leaves', /Sprite (leaves|fades)/], ['zone price', /uses shatter/], ['stack price', /uses violence/], ['hp price', /uses pact/],
];

describe('every trigger chain stops (kits design 1.3.7, 3.1)', () => {
  /** A pool of triggers that feed each other: a hit answered by a hit, a stack on a hit or a stack, a kill that refunds. */
  const POOL: readonly Trigger[] = [
    { on: 'struck', tag: null, to: 'other', limit: { kind: 'each' }, ops: [{ op: 'damage', type: 'physical', amount: { kind: 'number', value: 3 }, when: 'use' }] },
    { on: 'hitDealt', tag: null, to: 'self', limit: { kind: 'each' }, ops: [{ op: 'applyStatus', key: 'echo' as never, def: { label: 'Echo', desc: '', ops: [], stack: { cap: 20, leave: { kind: 'never' }, keep: 'fight', threshold: null } }, duration: null }] },
    { on: 'statusGained', key: 'echo' as never, to: { kind: 'area', radius: 3 as never, on: 'all' }, limit: { kind: 'each' }, ops: [{ op: 'damage', type: 'magical', amount: { kind: 'number', value: 1 }, when: 'use' }] },
    { on: 'kill', tag: null, to: 'self', limit: { kind: 'round' }, ops: [{ op: 'refund', pct: 100 }] },
    { on: 'struck', tag: null, to: 'self', limit: { kind: 'fight', n: 3 }, ops: [{ op: 'applyStatus', key: 'echo' as never, def: { label: 'Echo', desc: '', ops: [], stack: { cap: 20, leave: { kind: 'never' }, keep: 'fight', threshold: null } }, duration: null, stacks: 2 }] },
  ];
  test('2,000 random tables of feeding triggers never fire past depth 2 or 16 times for one batch of events', () => {
    const roster = ROSTER.slice(0, 6), problems: string[] = [];
    for (let seed = 1; seed <= 2000 && problems.length < 3; seed++) {
      const g = rng(seed);
      const bodies = roster.map((r, i) => {
        const statuses = Array.from({ length: g.int(0, 4) }, (_, k) => ({ key: `t${k}`, def: { label: `T${k}`, desc: '', ops: [], triggers: Array.from({ length: g.int(1, 4) }, () => g.pick(POOL)) }, source: { id: null, tier: 1 }, until: null, since: 0, settledAt: 0 })) as never as Status[];
        const m = modified(r.origin, statuses, RULES);
        return { ...r, ...m, statuses, place: { x: i % 3, y: Math.floor(i / 3) }, at: 0, speed: m.sheet.speed, tie: 0 };
      }) as never as Parameters<typeof fire>[0];
      const events: Raised[] = Array.from({ length: g.int(1, 6) }, () => { const a = g.pick(bodies), b = g.pick(bodies); return raised(a.id, g.pick(['struck', 'hitDealt', 'kill'] as const), b.id); });
      const r = fire(bodies, events, 0 as never, RULES);
      if (r.fires > RULES.fight.kit.fires || r.deepest > RULES.fight.kit.depth) problems.push(`seed ${seed}: ${r.fires} fired, deepest ${r.deepest}`);
      for (const b of r.bodies) if (b.hp < 0 || b.hp > b.sheet.hpMax || b.statuses.some(s => stacked(s) && s.stacks > s.def.stack.cap)) problems.push(`seed ${seed}: ${b.id} out of bounds`);
    }
    expect(problems).toEqual([]);
  });
});

describe('the reworked fight under random play', () => {
  test('2,500 seeded fights keep every invariant after every command', () => {
    const failures: string[] = [], tally = new Map<string, number>();
    for (let seed = 1; seed <= SEEDS && failures.length < 3; seed++) {
      const r = runSeed(seed, tally);
      if (r) failures.push(`seed ${r.seed}, command ${r.at + 1}: ${r.problem}\n${r.commands.slice(-6).map(c => json(c).slice(0, 300)).join('\n')}`);
    }
    expect(failures).toEqual([]);
    for (const seen of ['turnStarted', 'rollSettle', 'vitals', 'sendRemote', 'shadowHp', 'moved', 'channel', 'staggered', 'crit', 'defeated', 'ended', 'refused',
      'none>setup', 'setup>running', 'running>ended', 'ended>none', 'spread', ...KIT_LINES.map(([k]) => k)]) {
      expect(tally.get(seen) ?? 0, `random play reaches ${seen}`).toBeGreaterThan(0);
    }
  // A compute budget, not a wait: the test asserts no time. Measured Nov 19 on the lead's 4-core box after its restart:
  // 107 s alone at a88b73b0 and at 59c13117, 111 s at 37e0d68f (so the day's code did not slow it), and past 120 s inside
  // the whole unit run, which refused a push of notes. A faster box runs it in about half that.
  // Inside the whole run with four workers (scripts/ci.ts), three runs on Nov 19: 103, 98 and 102 s. The budget is 300 s,
  // over twice the slowest.
  }, 300_000);
});
