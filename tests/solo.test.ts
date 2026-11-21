// A solo run and a hunter's personal gates (src/core/gates/solo.ts, personal.ts; notes-2-solo.md). A run's write is
// checked against an end written by hand, so the expected sheet comes from the end itself: what the play left is what
// the sheet holds, through the life machine for the death saves. The engine's own play is checked once end to end.
import { afterEach, describe, expect, test } from 'bun:test';
import { RULES, rulesOf } from '../src/core/rules.ts';
import type { StatusDef } from '../src/core/combat/effect-ops.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';
import type { Rules } from '../src/core/rules.ts';
import { freshSave, newHunter } from '../src/core/save.ts';
import type { Hunter, ParseEnv, Save } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import { IDLE, ODDS_RUNS, oddsLine, oddsStep, readOdds } from '../src/core/combat/odds.ts';
import type { CombatantId } from '../src/core/combat/ability-types.ts';
import type { Body } from '../src/core/combat/effect-ops.ts';
import { fightId, reduce } from '../src/core/combat/fight.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { resolve } from '../src/core/combat/resolve.ts';
import { openGrid, place } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { diceOf, mean } from '../src/core/formula.ts';
import { formulaOf } from '../src/core/registry/ability-kinds.ts';
import type { OddsRun, RowEnd, RunEnd } from '../src/core/combat/odds.ts';
import { SOLO_REFUSAL_WORDS, pooled, runCostLines, soloConfirmLines, soloAnswerBody, soloDoc, soloFight, soloKey, soloPlan, soloRan, soloReady, soloRoute, soloRunBody, soloTaken, soloTargets, soloTick } from '../src/core/gates/solo.ts';
import { worldDoc } from '../src/core/gates/world.ts';
import { DOCS, DOC_MAX, newEvent } from '../src/core/protocol.ts';
import type { ReadyCtx, SoloGate, SoloRoute, SoloRun, SoloTarget } from '../src/core/gates/solo.ts';
import { newSolo, parseSolo, personalGateId, soloTracked, soloWake } from '../src/core/gates/personal.ts';
import type { PersonalGate } from '../src/core/gates/personal.ts';
import { soloRank } from '../src/core/gates/spawn.ts';
import { WAYS_BACK } from '../src/core/hunter/vitals.ts';
import { nextWake } from '../src/core/hunter/quests.ts';
import { dayKey } from '../src/core/day.ts';
import { SHOP_ITEMS, itemOf } from '../src/core/registry/items.ts';
import { putItem } from '../src/core/hunter/inventory.ts';
import { seedId } from '../src/core/ids.ts';
import type { GateId, HunterId, MonsterId } from '../src/core/ids.ts';
import { den } from './models/gate-events.ts';
import { dev, hid, iid, room } from './fixtures/ids.ts';
import { lifeAt } from './fixtures/life.ts';
import type { Life } from '../src/core/hunter/vitals.ts';

const AT = '2026-11-18T10:00:00.000Z', NOW = Date.parse(AT), HOUR = 3600e3;
const ENV: ParseEnv = { now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-me') };
const H1 = hid('h1'), ME = combatantId('solo-h');
const ok = <T>(r: T | Refused): T => { if (isRefused(r)) throw new Error(`refused: ${r.why}`); return r as T; };
const goblin = seedId<'m'>('goblin') as MonsterId;

const mira = (h: Partial<Hunter> = {}): Hunter => ({ ...newHunter(RULES), id: H1, name: 'Mira', ...h });
const pgate = (n: number, at = AT, hours = 24, count = 1): PersonalGate =>
  ({ id: personalGateId(n), name: 'Goblin Warren', rank: 'E', monsters: [{ monsterId: goblin, count }], at, closesAt: new Date(Date.parse(at) + hours * HOUR).toISOString() });
const worldGate = { ...den('detected'), monsters: [{ monsterId: goblin, count: 2 }], bossId: null, solo: true };
/** This phone alone: Mira with one personal gate, and the world's Goblin Den open to solo runs. */
function alone(h: Partial<Hunter> = {}): Save {
  const s = freshSave(ENV, { onboarded: true });
  return { ...s, hunters: [mira({ solo: { clock: { at: 'off' }, gates: [pgate(1)] }, ...h })], gates: [worldGate] };
}
const ctx = (c: Partial<ReadyCtx> = {}): ReadyCtx => ({ R: RULES, route: 'local', held: false, nowMs: NOW, ...c });
const day = { at: AT, today: dayKey(new Date(AT), 0), R: RULES };
const PERSONAL: SoloGate = { kind: 'personal', id: personalGateId(1) }, WORLD: SoloGate = { kind: 'world', id: 'g-den' as GateId };

/** A run's end written by hand: Mira's row as `row` says, the outcome and the rounds. Its life as the fight left it is its HP's (`lifeAt`). */
function endOf(outcome: RunEnd['outcome'], row: Partial<RowEnd>, spent: RunEnd['spent'] = []): RunEnd {
  const hp = row.hp ?? 7, { life: lifeLeft } = lifeAt('hunter', hp);
  return { outcome, rounds: 4, commands: 30, spent, party: { [ME]: { hp, mana: 3, fatigue: 22, statuses: [], used: {}, life: lifeLeft.at, lifeLeft: lifeLeft as Life, kills: [], ...row } } };
}
const runOf = (s: Save, end: RunEnd, route: SoloRoute = 'local'): SoloRun => ({ end, hunter: ME, shadows: {}, from: soloKey(s.hunters[0]!), route });
const ROOM = room('ABCD23'), IN_ROOM: SoloRoute = { room: ROOM };
const NO_LOOT = { gold: 0, items: [] };
const hunter = (s: Save): Hunter => s.hunters[0]!;
/** All the XP a hunter has gained: its levels' XP (`xpPerLevel` × level for each) and what it holds toward the next. */
const lifetimeXp = (h: Hunter): number => h.xp + Array.from({ length: h.level - 1 }, (_, i) => RULES.xpPerLevel * (i + 1)).reduce((a, b) => a + b, 0);

describe('a run writes what the play left, in one write', () => {
  test('a cleared personal gate: the play\'s HP, mana and fatigue, the gate gone, its roster\'s XP and the loot given, a log line', () => {
    const s = alone(), loot = { gold: 120, items: [itemOf(RULES, SHOP_ITEMS[0]!)] };
    const r = ok(soloRan(s, H1, PERSONAL, runOf(s, endOf('won', {})), loot, { day, ready: ctx() }));
    const h = hunter(r.save);
    expect([h.life, h.mana, h.fatigue]).toEqual([{ at: 'up', hp: 7 }, 3, 22]);
    expect(h.solo.gates).toEqual([]);
    expect(r.xp, 'one goblin of 25 XP').toBe(25);
    expect(h.xp).toBe(25);
    expect(h.gold).toBe(120);
    expect(h.items.map(i => i.name)).toContain(SHOP_ITEMS[0]!.name);
    expect(r.save.log.some(l => l.title === 'Solo run' && l.text === 'Mira cleared "Goblin Warren" (E-rank) alone in 4 rounds.')).toBe(true);
    expect(r.granted?.lines).toContain('+25 XP');
    // the run and the gate it cleared are facts of the chronicle, in the run's write
    expect(h.chronicle.inbox.slice(0, 2)).toMatchObject([
      { kind: 'solo', outcome: 'won', name: 'Goblin Warren', rank: 'E', above: 0, rounds: 4, life: 'up', personal: true },
      { kind: 'gate', name: 'Goblin Warren', rank: 'E', above: 0, toBreak: null },
    ]);
  });

  test('the monsters a run took down are kill facts, measured against the hunter\'s rank, after the run\'s own fact', () => {
    const s = alone(), kills = [{ monster: 'Goblin', rank: 'D' as const, type: 'Humanoid', mkind: 'normal' as const, hpPct: 55, payback: false }];
    const h = hunter(ok(soloRan(s, H1, PERSONAL, runOf(s, endOf('won', { kills })), NO_LOOT, { day, ready: ctx() })).save);
    expect(h.chronicle.inbox.map(f => f.kind).slice(0, 3)).toEqual(['solo', 'kill', 'gate']);
    expect(h.chronicle.inbox[1]).toEqual({ kind: 'kill', monster: 'Goblin', rank: 'D', type: 'Humanoid', mkind: 'normal', above: 1, hpPct: 55, payback: false, where: 'solo' });
  });

  test('a run that fell leaves the hunter dead, as its row was at the fight\'s end', () => {
    const s = alone();
    const dead = ok(soloRan(s, H1, PERSONAL, runOf(s, endOf('lost', { hp: 0 })), NO_LOOT, { day, ready: ctx() }));
    expect(hunter(dead.save).life).toEqual({ at: 'dead' });
    expect(hunter(dead.save).solo.gates.map(g => g.id), 'the gate stays').toEqual([personalGateId(1)]);
    expect(hunter(dead.save).xp).toBe(0);
    expect(dead.save.log[0]!.text).toBe('Mira fell in "Goblin Warren" (E-rank) alone in 4 rounds and died.');
  });

  test('a retreat pays its cost and leaves the gate open', () => {
    const s = alone(), r = ok(soloRan(s, H1, PERSONAL, runOf(s, { ...endOf('stalled', { hp: 2, fatigue: 60 }), rounds: 40 }), NO_LOOT, { day, ready: ctx() }));
    expect([hunter(r.save).life, hunter(r.save).fatigue]).toEqual([{ at: 'up', hp: 2 }, 60]);
    expect(hunter(r.save).solo.gates).toHaveLength(1);
    expect(r.save.log[0]!.text).toBe('Mira retreated from "Goblin Warren" (E-rank) alone after 40 rounds.');
  });

  test('the items a run used leave the bag, one per use', () => {
    const potion = { ...itemOf(RULES, SHOP_ITEMS.find(d => d.name === 'Health Potion')!), qty: 3 };
    const s = alone({ ...putItem(mira({ solo: { clock: { at: 'off' }, gates: [pgate(1)] } }), potion, iid('i5')) });
    const r = ok(soloRan(s, H1, PERSONAL, runOf(s, endOf('won', {}, [{ by: ME, item: iid('i5') }, { by: ME, item: iid('i5') }])), NO_LOOT, { day, ready: ctx() }));
    expect(hunter(r.save).items.find(i => i.id === iid('i5'))!.qty).toBe(1);
  });

  test('a run is written whole or not at all: a hunter gone, a gate gone, or a hunter changed while it played', () => {
    const s = alone(), run = runOf(s, endOf('won', {}));
    expect(soloRan({ ...s, hunters: [] }, H1, PERSONAL, run, NO_LOOT, { day, ready: ctx() })).toEqual({ ok: false, why: 'no-hunter' });
    expect(soloRan(s, H1, { kind: 'personal', id: personalGateId(9) }, run, NO_LOOT, { day, ready: ctx() })).toEqual({ ok: false, why: 'gone' });
    const healed = { ...s, hunters: [{ ...hunter(s), mana: 0 }] };
    expect(soloRan(healed, H1, PERSONAL, run, NO_LOOT, { day, ready: ctx() })).toEqual({ ok: false, why: 'changed' });
  });

  test('a world gate cleared on this phone is its Clear for a party of one: four times its 50 XP due and four times the 40 gold rolled', () => {
    const s = alone(), r = ok(soloRan(s, H1, WORLD, runOf(s, endOf('won', {})), { gold: 40, items: [] }, { day, ready: ctx() }));
    const g = r.save.gates[0]!;
    expect(RULES.gateParty, 'the gate is made for 4, so one hunter takes 4 shares').toBe(4);
    expect(g.status).toBe('cleared');
    expect(g.xpPaid, 'the gate owed its 50 XP and owes nothing now').toBe(50);
    expect([r.xp, lifetimeXp(hunter(r.save)), hunter(r.save).gold]).toEqual([200, 200, 160]);
    expect(r.save.log.map(l => l.title).filter(t => t === 'Solo run' || t === 'GATE CLEARED').sort()).toEqual(['GATE CLEARED', 'Solo run']);
    expect(r.save.log.find(l => l.title === 'GATE CLEARED')!.text).toContain('Mira rewarded: +200 XP, 160 gold.');
  });

  test('a world gate the hunter fell in is entered, and pays nothing', () => {
    const s = alone(), r = ok(soloRan(s, H1, WORLD, runOf(s, endOf('lost', { hp: 0 })), NO_LOOT, { day, ready: ctx() }));
    expect(r.save.gates[0]!.status).toBe('raiding');
    expect(hunter(r.save).xp).toBe(0);
  });

  test('a player in a room settles a room\'s gate in that room, never on its own phone; alone or the GM, on this phone', () => {
    expect([soloRoute('alone', null), soloRoute('gm', ROOM), soloRoute('player', ROOM)]).toEqual(['local', 'local', { room: ROOM }]);
  });
});

describe('who may enter, and the words of each refusal', () => {
  const s = alone();
  const why = (save: Save, gate: SoloGate, c: Partial<ReadyCtx> = {}) => { const r = soloReady(save, H1, gate, ctx(c)); return isRefused(r) ? r.why : 'ok'; };
  test('the hunter: in a fight, dead, collapsed', () => {
    expect(why(s, PERSONAL)).toBe('ok');
    expect(why(s, PERSONAL, { held: true })).toBe('fight');
    expect(why(alone({ life: { at: 'dead' } }), PERSONAL)).toBe('dead');
    expect(why(alone({ collapsed: true }), PERSONAL)).toBe('collapsed');
    expect(why(alone({ penalty: { since: AT, days: 1, questId: 'q1' as never } }), PERSONAL), 'a penalty bars no gate').toBe('ok');
  });
  test('the gate: closed, gone, off, not solo, not the hunter played in the room, a run waiting, no monsters', () => {
    expect(why(s, PERSONAL, { nowMs: NOW + 25 * HOUR })).toBe('closed');
    expect(why(s, { kind: 'personal', id: personalGateId(2) })).toBe('gone');
    expect(why(s, PERSONAL, { R: { ...RULES, solo: { ...RULES.solo, personal: false } } })).toBe('off');
    expect(why({ ...s, gates: [{ ...worldGate, solo: false }] }, WORLD)).toBe('not-solo');
    expect(why({ ...s, gates: [{ ...worldGate, status: 'closed' }] }, WORLD)).toBe('closed');
    const target: SoloTarget = { gate: WORLD, name: 'Goblin Den', rank: 'E', boss: false, monsters: [], statuses: {} };
    expect(why(s, WORLD, { route: IN_ROOM, bound: hid('h9') })).toBe('not-played');
    expect(why(s, WORLD, { route: IN_ROOM, bound: H1, room: { targets: [], waiting: [] } })).toBe('not-solo');
    expect(why(s, WORLD, { route: IN_ROOM, bound: H1, room: { targets: [target], waiting: [WORLD.id as GateId] } })).toBe('waiting');
    expect(why(s, WORLD, { route: IN_ROOM, bound: H1, room: { targets: [target], waiting: [] } })).toBe('empty');
    expect(why(alone({ solo: { clock: { at: 'off' }, gates: [{ ...pgate(1), monsters: [{ monsterId: 'seed:none' as MonsterId, count: 1 }] }] } }), PERSONAL)).toBe('empty');
  });
  test('every refusal says why in one plain sentence or two, with no em dash, semicolon or exclamation mark', () => {
    for (const [k, w] of Object.entries(SOLO_REFUSAL_WORDS)) {
      expect(w, k).toMatch(/^[A-Z].*\.$/);
      expect(w, k).not.toMatch(/[—;!]/);
    }
  });
});

/** The engine asked for one play of `s`'s hunter against `gate`, as the Gates view asks it, then the run to write. */
function played(s: Save, gate: SoloGate, seed: number, R: Rules = RULES): SoloRun {
  const ready = ok(soloReady(s, H1, gate, ctx({ R })));
  const f = soloFight(ready.h, ready.target, R)!;
  let run: OddsRun = oddsStep(IDLE, { type: 'ask', fight: f.fight, seed, of: 1 }, f.R);
  while (run.state === 'running') run = oddsStep(run, { type: 'step', commands: 25 }, f.R);
  if (run.state !== 'done') throw new Error('no answer');
  return { end: run.odds.ends[0]!, hunter: f.hunter, shadows: f.shadows, from: soloKey(ready.h), route: 'local' };
}

describe('the run is one play of the engine', () => {
  test('the same hunter, gate and seed play the same run, and its write is what the run left', () => {
    const s = alone({ solo: { clock: { at: 'off' }, gates: [pgate(1, AT, 24, 2)] } });
    const a = played(s, PERSONAL, 42), b = played(s, PERSONAL, 42);
    expect(a).toEqual(b);
    const row = a.end.party[ME]!, r = ok(soloRan(s, H1, PERSONAL, a, NO_LOOT, { day, ready: ctx() }));
    expect([hunter(r.save).mana, hunter(r.save).fatigue]).toEqual([row.mana, row.fatigue]);
    expect(hunter(r.save).life.at === 'up' ? hunter(r.save).life : null).toEqual(row.life === 'up' ? { at: 'up', hp: row.hp } : null);
  });

  test('the fight is the hunter, its summoned shadows and each roster line\'s monsters', () => {
    const shadow = { id: 'sh1' as never, name: 'Igris', monster: null, rank: 'E' as const, archetype: 'brute' as const, grade: 'Normal' as const, hp: 30, summoned: true, notes: '' };
    const s = alone({ shadows: [shadow, { ...shadow, id: 'sh2' as never, summoned: false }], solo: { clock: { at: 'off' }, gates: [pgate(1, AT, 24, 3)] } });
    const ready = ok(soloReady(s, H1, PERSONAL, ctx())), f = soloFight(ready.h, ready.target, RULES)!;
    expect(f.fight.rows.map(r => [r.name, r.side])).toEqual([['Mira', 'party'], ['Igris', 'party'], ['Goblin A', 'foe'], ['Goblin B', 'foe'], ['Goblin C', 'foe']]);
    expect(Object.values(f.shadows)).toEqual(['sh1']);
  });
});

describe('a solo run\'s foes are harder than the table\'s by the rule (RULES.solo.autoHarder)', () => {
  const GOBLIN = seedMonsters(RULES).find(m => m.id === goblin)!, FOE = combatantId('solo-m0-0'), GRID = openGrid(RULES.fight.grid.w, RULES.fight.grid.h);
  const withHarder = (n: number): Rules => ({ ...RULES, solo: { ...RULES.solo, autoHarder: n } });
  /** Mira against `count` goblins as the GM's fight at the table makes it: the hunter's row and the monster's rows, by the reducer's `add`. */
  const tableFight = (h: Hunter, count: number) => reduce(null, { type: 'add', fightId: fightId('solo'), openings: [],
    rows: [hunterRow(h, ME, RULES), ...monsterRows(GOBLIN, Array.from({ length: count }, (_, k) => combatantId(`solo-m0-${k}`)), RULES)] }, { rules: RULES }).fight!;
  const row = (rows: readonly Body[], id: CombatantId): Body => rows.find(b => b.id === id)!;
  /** The hit of `foe`'s attack on `target` before the target's defence, every die at its mean and no crit. */
  const hitOf = (foe: Body, target: Body): number => {
    const a = foe.abilities[0]!, user = { ...foe, place: place(1, 0) }, t = { ...target, place: place(0, 0) };
    const r = resolve(a, user, [user, t], t.id, GRID, { dice: { [t.id]: diceOf(formulaOf(a, RULES)!).map(mean) }, react: { [t.id]: 20 } }, tick(0), RULES);
    if (!r.ok) throw new Error(r.reason);
    return r.outcomes[0]!.raw;
  };

  test('a solo run\'s foe has the square root of the rule times the HP and deals it times the damage of the same foe at the table', () => {
    const each = Math.sqrt(RULES.solo.autoHarder), s = alone();
    const ready = ok(soloReady(s, H1, PERSONAL, ctx())), solo = soloFight(ready.h, ready.target, RULES)!.fight, table = tableFight(ready.h, 1);
    const hp = rowHp(row(table.rows, FOE));
    // each max HP is rounded to a whole point, so the solo one is within half a point of its exact value
    expect(Math.abs(rowHp(row(solo.rows, FOE)) - hp * each)).toBeLessThanOrEqual(0.5 * (1 + each));
    expect(row(solo.rows, FOE).sheet.hpMax).toBe(rowHp(row(solo.rows, FOE)));
    expect(hitOf(row(solo.rows, FOE), row(solo.rows, ME))).toBeCloseTo(hitOf(row(table.rows, FOE), row(table.rows, ME)) * each, 9);
    expect(row(solo.rows, FOE).xp, 'its XP is the table\'s').toBe(row(table.rows, FOE).xp);
    expect([row(solo.rows, FOE).sheet.speed, row(solo.rows, FOE).sheet.armor], 'its speed and armor are the table\'s').toEqual([row(table.rows, FOE).sheet.speed, row(table.rows, FOE).sheet.armor]);
    expect(row(solo.rows, FOE).stagger, 'its stagger bar is the table\'s').toEqual(row(table.rows, FOE).stagger);
  });

  test('at autoHarder 1 a solo fight is the table\'s fight', () => {
    const s = alone({ solo: { clock: { at: 'off' }, gates: [pgate(1, AT, 24, 2)] } });
    const ready = ok(soloReady(s, H1, PERSONAL, ctx())), table = tableFight(ready.h, 2);
    expect(soloFight(ready.h, ready.target, withHarder(1))!.fight).toEqual(table);
    expect(soloFight(ready.h, ready.target, RULES)!.fight).not.toEqual(table);
  });

  test('the odds shown for a solo run are of the fight the run plays', () => {
    const s = alone({ solo: { clock: { at: 'off' }, gates: [pgate(1, AT, 24, 2)] } });
    const ready = ok(soloReady(s, H1, PERSONAL, ctx()));
    // the fight a gate's card gives its odds box (gates.js `soloCard`), played as the box plays it
    const card = soloFight(ready.h, ready.target, RULES)!;
    let odds: OddsRun = oddsStep(IDLE, { type: 'ask', fight: card.fight, seed: 42, of: ODDS_RUNS }, card.R);
    while (odds.state === 'running') odds = oddsStep(odds, { type: 'step', commands: 500 }, card.R);
    if (odds.state !== 'done') throw new Error('no answer');
    const each = Math.sqrt(RULES.solo.autoHarder), hp = rowHp(row(tableFight(ready.h, 2).rows, FOE));
    expect(Math.abs(rowHp(row(card.fight.rows, FOE)) - hp * each), 'the odds play the harder foes').toBeLessThanOrEqual(0.5 * (1 + each));
    expect(played(s, PERSONAL, 42).end, 'the run of the same seed is the odds\' first play').toEqual(odds.odds.ends[0]);
  });
});

describe('the System\'s clock: personal gates opened and closed for the time that passed', () => {
  const tick = (s: Save, now: number, R: Rules = RULES, gm = false) => soloTick(s, { now: new Date(now), R, gm, seed: 7 });
  const blank = (h: Partial<Hunter> = {}): Save => ({ ...freshSave(ENV, { onboarded: true }), hunters: [mira({ solo: newSolo(), ...h })] });

  test('a clock off turns on with a gate at once, the next spawn a spawn\'s hours later, the gate open for its hours', () => {
    const r = ok(tick(blank(), NOW)), h = hunter(r.save);
    expect(h.solo.clock).toEqual({ at: 'on', next: new Date(NOW + 8 * HOUR).toISOString() });
    expect(h.solo.gates).toHaveLength(1);
    expect(h.solo.gates[0]).toMatchObject({ at: AT, closesAt: new Date(NOW + 24 * HOUR).toISOString() });
    expect(r.opened.map(o => o.hid)).toEqual([H1]);
  });

  test('a phone closed for three days opens to the gates still open now, at most the cap, each at its own time', () => {
    const r = ok(tick(blank({ solo: { clock: { at: 'on', next: AT }, gates: [] } }), NOW + 72 * HOUR)), h = hunter(r.save);
    expect(h.solo.gates.map(g => (Date.parse(g.at) - NOW) / HOUR)).toEqual([56, 64, 72]);
    expect(h.solo.clock).toEqual({ at: 'on', next: new Date(NOW + 80 * HOUR).toISOString() });
    expect(r.opened).toHaveLength(3);
  });

  test('the cap: no more than `held` gates open at once, however short the hours', () => {
    const R = { ...RULES, solo: { ...RULES.solo, hours: 4 } };
    const h = hunter(ok(tick(blank({ solo: { clock: { at: 'on', next: AT }, gates: [] } }), NOW + 20 * HOUR, R)).save);
    expect(h.solo.gates.map(g => (Date.parse(g.at) - NOW) / HOUR)).toEqual([0, 4, 8]);
  });

  test('a tick twice at one moment writes once', () => {
    const once = ok(tick(blank(), NOW)).save;
    expect(tick(once, NOW)).toEqual({ ok: false, why: 'unchanged' });
  });

  test('the clock off spawns nothing, and the gates held close at their time', () => {
    const R = { ...RULES, solo: { ...RULES.solo, personal: false } };
    const s = blank({ solo: { clock: { at: 'on', next: AT }, gates: [pgate(1, new Date(NOW - 30 * HOUR).toISOString()), pgate(2)] } });
    const h = hunter(ok(tick(s, NOW + HOUR, R)).save);
    expect(h.solo.clock).toEqual({ at: 'off' });
    expect(h.solo.gates.map(g => g.id)).toEqual([personalGateId(2)]);
  });

  test('a dead hunter\'s clock goes off; revived, it gets a gate at once', () => {
    const dead = hunter(ok(tick(blank({ life: { at: 'dead' }, solo: { clock: { at: 'on', next: AT }, gates: [] } }), NOW)).save);
    expect(dead.solo).toEqual({ clock: { at: 'off' }, gates: [] });
    const revived = ok(tick(blank({ solo: dead.solo }), NOW + 5 * HOUR));
    expect(revived.opened).toHaveLength(1);
  });

  test('on the GM\'s phone the clock runs only for a hunter that has completed a daily; never for the starter hunter', () => {
    expect(tick(blank(), NOW, RULES, true)).toEqual({ ok: false, why: 'unchanged' });
    expect(ok(tick(blank({ daily: { streak: 1, lastCompleteKey: dayKey(new Date(AT), 0), lastCheckedKey: null } }), NOW, RULES, true)).opened).toHaveLength(1);
    expect(soloTracked(mira({ seed: true }), false)).toBe(false);
  });

  test('a gate\'s rank: one below, at or one above by the rule\'s shares; a share past E is E\'s', () => {
    const at = (x: number) => () => x;
    expect([0.2, 0.5, 0.9].map(x => soloRank('C', RULES.solo.ranks, at(x)))).toEqual(['D', 'C', 'B']);
    expect([0.2, 0.84, 0.86].map(x => soloRank('E', RULES.solo.ranks, at(x)))).toEqual(['E', 'E', 'D']);
  });

  test('a rank with no normal built-in monster opens a gate of the nearest rank that has one (an S hunter\'s are A)', () => {
    const gates = hunter(ok(tick(blank({ rank: 'S', solo: { clock: { at: 'on', next: new Date(NOW - 16 * HOUR).toISOString() }, gates: [] } }), NOW)).save).solo.gates;
    expect(gates.length).toBe(3);
    for (const g of gates) expect(['A']).toContain(g.rank);
    expect(pooled('S', [{ id: 'x', rank: 'A', type: '', name: '' }])).toBe('A');
  });

  test('the one timer wakes for the next spawn and for a gate\'s close', () => {
    const today = dayKey(new Date(AT), 0), base = blank({ daily: { streak: 0, lastCompleteKey: null, lastCheckedKey: today } });
    const s = { ...base, world: { ...base.world, lastDailyKey: today } };
    const at = (solo: Hunter['solo'], personal = true) => nextWake({ ...s, hunters: [{ ...hunter(s), solo }] }, new Date(AT), 0, { personal, gm: false }) - NOW;
    expect(at(newSolo()), 'a clock off that may run: now').toBe(0);
    expect(at(newSolo(), false), 'personal gates off: no term').toBe(60_000);
    expect(at({ clock: { at: 'on', next: new Date(NOW + 30_000).toISOString() }, gates: [] })).toBe(30_000);
    expect(at({ clock: { at: 'off' }, gates: [pgate(1, new Date(NOW - 24 * HOUR + 10_000).toISOString())] }, false), 'a gate held with personal gates off still closes').toBe(10_000);
    expect(soloWake({ hunters: [mira({ seed: true })] }, NOW, { personal: true, gm: false })).toBeNull();
    expect(soloWake({ hunters: [mira({ life: { at: 'dead' } })] }, NOW, { personal: true, gm: false }), 'a dead hunter\'s clock waits').toBeNull();
  });
});

describe('the clock across a change of the clocks', () => {
  const tz = process.env.TZ;
  afterEach(() => { process.env.TZ = tz; });
  for (const [zone, change] of [['Europe/Berlin', '2026-03-29T00:30:00.000Z'], ['Europe/Berlin', '2026-10-25T00:30:00.000Z'], ['America/New_York', '2026-03-08T06:30:00.000Z'], ['America/New_York', '2026-11-01T05:30:00.000Z']] as const) {
    test(`a spawn comes 8 hours of the wall clock later, and a gate is open 24 (${zone}, ${change.slice(0, 10)})`, () => {
      process.env.TZ = zone;
      const now = Date.parse(change) - 2 * HOUR;
      const h = hunter(ok(soloTick({ ...freshSave(ENV, { onboarded: true }), hunters: [mira()] }, { now: new Date(now), R: RULES, gm: false, seed: 1 })).save);
      expect(h.solo.clock.at === 'on' && Date.parse(h.solo.clock.next) - now).toBe(8 * HOUR);
      expect(Date.parse(h.solo.gates[0]!.closesAt) - Date.parse(h.solo.gates[0]!.at)).toBe(24 * HOUR);
    });
  }
});

describe('a hunter\'s personal gates read from a save', () => {
  test('a clock that does not read is off; a gate without an id, times or monsters is dropped; at most 10, the newest', () => {
    expect(parseSolo(null)).toEqual(newSolo());
    expect(parseSolo({ clock: { at: 'on', next: 'never' }, gates: [] }).clock).toEqual({ at: 'off' });
    const good = pgate(1);
    expect(parseSolo({ clock: { at: 'on', next: AT }, gates: [good, { ...good, id: 'g2' }, { ...pgate(3), monsters: [] }, { ...pgate(4), closesAt: 'x' }, good] }))
      .toEqual({ clock: { at: 'on', next: AT }, gates: [good] });
    expect(parseSolo({ gates: Array.from({ length: 12 }, (_, i) => pgate(i + 1)) }).gates.map(g => g.id)).toEqual(Array.from({ length: 10 }, (_, i) => personalGateId(i + 3)));
  });
  test('a hunter saved before personal gates loads with none and its clock off', () => {
    const { solo: _gone, ...old } = mira();
    const s = freshSave(ENV, { onboarded: true });
    expect(parseSolo((old as Record<string, unknown>).solo)).toEqual(newSolo());
    expect(s.hunters.every(h => h.solo.clock.at === 'off')).toBe(true);
  });
});


describe('a world gate open to solo runs, in a room', () => {
  const KEY = 'd-me:h1' as never;
  /** The GM's phone in room ROOM, with no pushed sheet of the run's hunter. */
  const TAKEN = { day, room: { code: ROOM, stamp: { device: 'd-gm', now: NOW, rand: 0.75 } }, rank: null };
  const gmSave = (gates = [worldGate]): Save => ({ ...alone(), gates });
  const docs = (s: Save) => {
    const built = soloDoc(s, RULES, DOC_MAX);
    return { world: JSON.parse(JSON.stringify(worldDoc(s, 1, new Set(built.doc.gates.map(g => g.id)), 0))), solo: JSON.parse(JSON.stringify(built.doc)) };
  };

  test('a player\'s phone plays the gate from the room\'s docs: its monsters by value, its gate the GM\'s', () => {
    const d = docs(gmSave()), targets = soloTargets(DOCS.world(d.world), DOCS.solo(d.solo));
    expect(targets.map(t => [t.gate, t.name, t.monsters.map(m => [m.monster.name, m.count])])).toEqual([[WORLD, 'Goblin Den', [['Goblin', 2]]]]);
    expect(soloTargets(DOCS.world(docs(gmSave([{ ...worldGate, solo: false }])).world), DOCS.solo(d.solo))).toEqual([]);
  });

  test('a player\'s won run writes its cost, its message and a run waiting for the answer, and nothing of the gate', () => {
    const p = { ...alone(), gates: [] }, d = docs(gmSave()), targets = soloTargets(DOCS.world(d.world), DOCS.solo(d.solo));
    const ready: Partial<ReadyCtx> = { route: IN_ROOM, bound: H1, room: { targets, waiting: [] } };
    const run = runOf(p, endOf('won', {}), IN_ROOM);
    const body = soloRunBody(hunter(p), run, targets[0]!, KEY, RULES)!;
    const event = newEvent('soloRun', body, { device: 'd-me', now: NOW, rand: 0.5 })!;
    const r = ok(soloRan(p, H1, WORLD, run, NO_LOOT, { day, ready: ctx(ready), event }));
    expect(body).toEqual({ by: KEY, gate: WORLD.id, name: 'Mira', outcome: 'won', rounds: 4, life: 'up' });
    expect(hunter(r.save).mana).toBe(3);
    expect(r.save.settings.sync.outbox!.map(e => e.id)).toEqual([event.payload.eid]);
    expect(r.save.settings.sync.runs!.map(w => [w.run, w.room, w.gate, w.state])).toEqual([[event.payload.eid, ROOM, WORLD.id, 'posted']]);
    expect([hunter(r.save).xp, r.save.gates]).toEqual([0, []]);
    expect(soloReady(r.save, H1, WORLD, ctx({ ...ready, room: { targets, waiting: [WORLD.id as GateId] } })), 'no second run before the answer').toEqual({ ok: false, why: 'waiting' });
    expect(soloRan(p, H1, WORLD, run, NO_LOOT, { day, ready: ctx(ready) }), 'no message, no write').toEqual({ ok: false, why: 'no-room' });
  });

  // SMX-gates-2.1: every new save numbers its gates from one seq, so a player's own S-rank gate and the room's E-rank
  // gate can share an id. A run started in the room and ended with the phone alone was paid as the phone's own S gate.
  test('a run settles where it started: one begun in the room and ended alone is refused, and the phone\'s own gate of the same id is untouched', () => {
    const own = { ...worldGate, rank: 'S' as const, name: 'Jeju Island' }, p = { ...alone(), gates: [own] };
    const d = docs(gmSave()), targets = soloTargets(DOCS.world(d.world), DOCS.solo(d.solo));
    expect(targets.map(t => t.gate), 'the room\'s gate has the id of the phone\'s own').toEqual([WORLD]);
    const run = runOf(p, endOf('won', {}), IN_ROOM);
    const left = soloRan(p, H1, WORLD, run, { gold: 40, items: [] }, { day, ready: ctx() });
    expect(left).toEqual({ ok: false, why: 'moved' });
    const otherRoom = soloRan(p, H1, WORLD, run, NO_LOOT, { day, ready: ctx({ route: { room: room('WXYZ45') }, bound: H1, room: { targets, waiting: [] } }) });
    expect(otherRoom, 'ended in another room').toEqual({ ok: false, why: 'moved' });
    const joined = soloRan(p, H1, WORLD, runOf(p, endOf('won', {})), NO_LOOT, { day, ready: ctx({ route: IN_ROOM, bound: H1, room: { targets, waiting: [] } }) });
    expect(joined, 'begun alone, ended in a room').toEqual({ ok: false, why: 'moved' });
    expect(SOLO_REFUSAL_WORDS.moved).toBe('This phone joined or left a room while the run played, so the run paid nothing. Enter again.');
  });

  test('a personal gate is the hunter\'s own wherever the phone is: a run of it begun in a room and ended alone is written', () => {
    const s = alone(), r = ok(soloRan(s, H1, PERSONAL, runOf(s, endOf('won', {}), IN_ROOM), NO_LOOT, { day, ready: ctx() }));
    expect(hunter(r.save).solo.gates).toEqual([]);
  });

  const paidRun = { eid: 'd-me-run1' as never, by: KEY, gate: WORLD.id as GateId, name: 'Mira', outcome: 'won' as const, rounds: 4, life: 'up' as const };
  const answerOf = (s: Save, plan: ReturnType<typeof soloPlan>) => {
    const body = soloAnswerBody(s, paidRun.eid, paidRun, plan, { gold: 30, items: [] });
    return body ? newEvent('soloAnswer', body, { device: 'd-gm', now: NOW, rand: 0.25 }) : null;
  };

  test('the GM\'s phone pays the first won run of a gate as its Clear for a party of one (four times the XP due and the gold rolled), and answers the second as taken; its cost stays the player\'s', () => {
    const s = gmSave(), plan = soloPlan(s, paidRun, RULES);
    expect(plan).toEqual({ kind: 'paid', due: 50, xp: 200, party: 4 });
    const first = ok(soloTaken(s, paidRun, plan, answerOf(s, plan), { gold: 30, items: [] }, TAKEN));
    expect(first.gates[0]).toMatchObject({ status: 'cleared', xpPaid: 50 });
    const answer = first.settings.sync.outbox![0]!.letter;
    expect(answer.kind === 'event' && answer.event.payload).toMatchObject({ to: [KEY], run: paidRun.eid, verdict: 'paid', rewards: { xp: 200, gold: 120 } });
    expect(first.log.some(l => l.title === 'Solo run')).toBe(true);
    const second = { ...paidRun, eid: 'd-other-run2' as never, by: 'd-other:h5' as never }, plan2 = soloPlan(first, second, RULES);
    expect(plan2).toEqual({ kind: 'refused', why: 'taken' });
    const body2 = soloAnswerBody(first, second.eid, second, plan2, NO_LOOT)!;
    const after = ok(soloTaken(first, second, plan2, newEvent('soloAnswer', body2, { device: 'd-gm', now: NOW + 1, rand: 0.5 }), NO_LOOT, TAKEN));
    const refused = after.settings.sync.outbox!.at(-1)!.letter;
    expect(refused.kind === 'event' && refused.event.payload).toMatchObject({ verdict: 'refused', why: 'taken', to: ['d-other:h5'] });
    expect(after.gates[0]!.xpPaid, 'paid once').toBe(50);
  });

  // The GM made Stunned do nothing; the goblins of the gate start the fight stunned for good. On the GM's table they
  // act, so a player's run of that gate must play them acting too, not by the player's own built-in Stunned.
  test('a status the GM edited plays in a player\'s run as the GM edited it, not as the player\'s built-in', () => {
    const dazed = { label: 'Stunned', desc: 'Only dazed.', ops: [] };
    const sleeper = { ...seedMonsters(RULES).find(m => m.id === goblin)!, id: 'm-sleeper' as MonsterId, statuses: [{ key: 'stunned', rounds: null }] };
    const gate = { ...worldGate, monsters: [{ monsterId: sleeper.id, count: 2 }] };
    const runOn = (library: Record<string, StatusDef>) => {
      const built = soloDoc({ ...gmSave([gate]), monsters: [sleeper] }, rulesOf({}, library), DOC_MAX).doc;
      const world = worldDoc(gmSave([gate]), 1, new Set(built.gates.map(g => g.id)), 0);
      const targets = soloTargets(DOCS.world(JSON.parse(JSON.stringify(world))), DOCS.solo(JSON.parse(JSON.stringify(built))));
      const p = { ...alone(), gates: [] };
      const ready = ok(soloReady(p, H1, WORLD, ctx({ route: IN_ROOM, bound: H1, room: { targets, waiting: [] } })));
      const f = soloFight(ready.h, ready.target, RULES)!;
      let run: OddsRun = oddsStep(IDLE, { type: 'ask', fight: f.fight, seed: 7, of: 1 }, f.R);
      while (run.state === 'running') run = oddsStep(run, { type: 'step', commands: 25 }, f.R);
      if (run.state !== 'done') throw new Error('no answer');
      return { hp: run.odds.ends[0]!.party[ME]!.hp, start: ready.h.life.at === 'up' ? ready.h.life.hp : 0 };
    };
    const asBuilt = runOn({}), asEdited = runOn({ stunned: dazed });
    expect(asBuilt.hp, 'built-in Stunned holds the goblins, so they never strike').toBe(asBuilt.start);
    expect(asEdited.hp, 'the GM\'s Stunned holds nothing, so the goblins strike').toBeLessThan(asEdited.start);
  });

  test('a lost run enters a detected gate and needs no answer; a plan that no longer holds writes nothing', () => {
    const s = gmSave(), lost = { ...paidRun, outcome: 'lost' as const, life: 'dead' as const };
    const r = ok(soloTaken(s, lost, soloPlan(s, lost, RULES), null, NO_LOOT, TAKEN));
    expect([r.gates[0]!.status, r.settings.sync.outbox ?? []]).toEqual(['raiding', []]);
    expect(r.log[0]!.text).toBe('Mira fell in "Goblin Den" (E-rank) alone in 4 rounds and died.');
    const stale = { kind: 'paid', due: 50, xp: 999, party: 4 } as const;
    expect(soloTaken(s, paidRun, stale, answerOf(s, stale), NO_LOOT, TAKEN)).toEqual({ ok: false, why: 'changed' });
    expect(soloPlan({ ...s, gates: [{ ...worldGate, status: 'closed' }] }, paidRun, RULES)).toEqual({ kind: 'refused', why: 'closed' });
    expect(soloPlan({ ...s, gates: [] }, paidRun, RULES)).toEqual({ kind: 'refused', why: 'gone' });
  });

  // The GM's phone's answer to a run, by the gate as the run finds it and the run's outcome, every cell. A won run of a
  // gate it can clear is that gate's Clear for one hunter (50 XP due, a party of 4: 200 XP); one it cannot clear is
  // answered with why; a lost or stalled run needs no answer.
  test('every gate the GM\'s phone holds against every outcome of a run', () => {
    const PAID = { kind: 'paid', due: 50, xp: 200, party: 4 } as const, REPORT = { kind: 'report' } as const;
    const gates = {
      gone: [], cleared: [{ ...worldGate, status: 'cleared' as const, clearedDay: 1 }], closed: [{ ...worldGate, status: 'closed' as const }],
      notSolo: [{ ...worldGate, solo: false }], open: [worldGate],
    };
    const expected = {
      gone: { won: { kind: 'refused', why: 'gone' }, lost: REPORT, stalled: REPORT },
      cleared: { won: { kind: 'refused', why: 'taken' }, lost: REPORT, stalled: REPORT },
      closed: { won: { kind: 'refused', why: 'closed' }, lost: REPORT, stalled: REPORT },
      // SMX-gates-2.2 waits on the owner's ruling (proposed: a gate not open to solo runs refuses a solo run). Today a
      // gate the GM unticked "Open to solo runs" on while the run played is paid, and a lost run enters it.
      notSolo: { won: PAID, lost: REPORT, stalled: REPORT },
      // SMX-gates-2.3 waits on its ruling (a solo clear's rewards wait for the GM): today the pay goes at once.
      open: { won: PAID, lost: REPORT, stalled: REPORT },
    } as const;
    for (const [at, list] of Object.entries(gates)) for (const outcome of ['won', 'lost', 'stalled'] as const) {
      const plan = soloPlan({ ...gmSave(), gates: list }, { ...paidRun, outcome }, RULES);
      expect([at, outcome, plan]).toEqual([at, outcome, expected[at as keyof typeof expected][outcome]]);
    }
  });

  test('today a lost run of a gate the GM took out of solo runs still enters it (SMX-gates-2.2, as the app behaves until the ruling)', () => {
    const s = gmSave([{ ...worldGate, solo: false }]), lost = { ...paidRun, outcome: 'lost' as const, life: 'dead' as const };
    expect(ok(soloTaken(s, lost, soloPlan(s, lost, RULES), null, NO_LOOT, TAKEN)).gates[0]!.status).toBe('raiding');
  });
});

describe('the first gate after the clock turns on is the even gate (lead-look-2-solo.md, finding 1)', () => {
  // One normal monster of the hunter's own rank is the fight every pregen clears in 95 to 99% of plays (notes-2-solo.md
  // section 16); two of them kill a level 1 pregen in about 40%. So the gate a new or revived hunter meets first is one.
  const tick = (s: Save, now: number, seed: number) => soloTick(s, { now: new Date(now), R: RULES, gm: false, seed });
  const blank = (h: Partial<Hunter> = {}): Save => ({ ...freshSave(ENV, { onboarded: true }), hunters: [mira({ solo: newSolo(), ...h })] });
  const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
  const shape = (g: PersonalGate) => [g.rank, g.monsters.reduce((n, m) => n + m.count, 0)];

  test('a new hunter\'s first gate holds one monster of its own rank, whatever the dice', () => {
    for (const rank of ['E', 'C'] as const) for (const seed of SEEDS) {
      const g = ok(tick(blank({ rank }), NOW, seed)).opened.map(o => o.gate);
      expect([rank, seed, ...g.map(shape)]).toEqual([rank, seed, [rank, 1]]);
    }
  });

  test('a revived hunter\'s first gate, and the first after personal gates are turned back on, is the even one too', () => {
    for (const seed of SEEDS) {
      const revived = ok(tick(blank({ solo: { clock: { at: 'off' }, gates: [] } }), NOW + 5 * HOUR, seed)).opened.map(o => shape(o.gate));
      expect([seed, ...revived]).toEqual([seed, ['E', 1]]);
    }
  });

  test('the spawns after it are rolled by the rule: some hold two monsters, some another rank', () => {
    const later = SEEDS.flatMap(seed => ok(tick(blank({ solo: { clock: { at: 'on', next: AT }, gates: [] } }), NOW, seed)).opened.map(o => shape(o.gate)));
    expect(later.length).toBe(SEEDS.length);
    expect(later.some(([, n]) => n === 2)).toBe(true);
    expect(later.some(([r]) => r === 'D')).toBe(true);
  });
});

describe('the words of a solo run name the way back and speak to one hunter', () => {
  test('a dead hunter is told the GM\'s Revive or a Resurrection Crystal brings it back, at the door and after the run', () => {
    expect(SOLO_REFUSAL_WORDS.dead).toBe('This hunter is dead. The GM\'s Revive or a Resurrection Crystal brings it back.');
    const m = { hpMax: 40, manaMax: 10, fatigueMax: 100 }, up = { life: { at: 'up' as const, hp: 40 }, mana: 10, fatigue: 0, collapsed: false, used: {} };
    expect(runCostLines(up, { ...up, life: { at: 'dead' } }, m)).toContain(`You died. ${WAYS_BACK} brings you back.`);
  });

  test('the card\'s odds line and the confirm read one hunter\'s chance from the same numbers', () => {
    const end = (outcome: RunEnd['outcome'], life: RowEnd['life']): RunEnd => ({ outcome, rounds: 3, commands: 9, spent: [], party: { [ME]: { hp: 0, mana: 0, fatigue: 0, statuses: [], used: {}, life, lifeLeft: null, kills: [] } } });
    const r = readOdds({ of: 4, rows: [{ id: ME, name: 'Mira', hpMax: 40, manaMax: 10, fatigueMax: 100 }], ends: [end('won', 'up'), end('lost', 'dead'), end('lost', 'dead'), end('lost', 'up')] });
    const line = oddsLine(r, 'alone'), confirm = soloConfirmLines(r);
    expect(line.startsWith(confirm[0]!)).toBe(true);
    expect(confirm[0]).toBe('You clear it in 25% of 4 plays.');
    expect(line).toContain(confirm[2]!);
    expect(confirm[2]).toBe('Dead in 50%.');
    expect(line).not.toContain('party');
  });
});
