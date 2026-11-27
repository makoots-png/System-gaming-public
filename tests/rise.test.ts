// Arise engine (Wave 2 PR 2): corpse rise machine, DC/bonus parity, Arise targeting & spawn rules,
// separate timed vs risen lanes, elite/boss/mythic/one-rise caps, minion swap, minion-only aura,
// fight-doc priority & wire round-trip, fight-view card/aims, and fight-parse round-trip.
import { describe, expect, test } from 'bun:test';
import { RANKS, RULES } from '../src/core/rules.ts';
import type { Rank } from '../src/core/rules.ts';
import { fightId } from '../src/core/ids.ts';
import type { DeviceId } from '../src/core/ids.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import type { Ability, CombatantId, RiseSpec } from '../src/core/combat/ability-types.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { statBlock } from '../src/core/registry/monsters.ts';
import { monsterRows, shadowRow } from '../src/core/combat/rows.ts';
import { modified, statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
import type { Body, MonsterRow, Status, StatusDef, SummonRow } from '../src/core/combat/effect-ops.ts';
import { NO_TWEAK } from '../src/core/hunter/derive.ts';
import type { MonsterKind } from '../src/core/hunter/derive.ts';
import { extractDc } from '../src/core/hunter/shadows.ts';
import { checksOf, hunterSheet } from '../src/core/hunter/sheet.ts';
import type { SheetHunter } from '../src/core/hunter/sheet.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Command, Fight, NewRow, Running } from '../src/core/combat/fight.ts';
import { parseFight, parseStatusDef, parseZone } from '../src/core/combat/fight-parse.ts';
import { DOC_ROWS, fightDoc, fightWire } from '../src/core/combat/fight-doc.ts';
import { DOCS } from '../src/core/protocol.ts';
import { aims, cardOf, docSpots, spotOf } from '../src/core/combat/fight-view.ts';
import { needs, ready } from '../src/core/combat/resolve.ts';
import { isUp, rowHp } from '../src/core/combat/row-hp.ts';
import { openGrid, place, tiles } from '../src/core/combat/space.ts';
import type { Place } from '../src/core/combat/space.ts';
import { cost, tick } from '../src/core/combat/timeline.ts';
import { isRisen, isTimedSummon, timeUp } from '../src/core/combat/summons.ts';
import { canRiseCorpse, canRiseFor, elitesRisen, riseBonus, riseDc, risePassed, riseState, riseStep } from '../src/core/combat/rise.ts';
import { RISE_WALK } from './models/rise-events.ts';
import { hunter } from './models/fight-sim.ts';

const ctx = { rules: RULES };
const id = (s: string): CombatantId => combatantId(s);
const body = (f: Fight, who: string): Body => f.rows.find(r => r.id === who)!;

const DEFAULT_RAISE: RiseSpec = { bonus: 4, maxRisen: 2, elitePerFight: 1 };

function ariseAbility(raise: RiseSpec = DEFAULT_RAISE): Ability {
  return {
    id: abilityId('arise'), name: 'Arise', kind: 'support',
    cost: { fatigue: 6, mana: 15, time: cost(RULES.fight.cost.standard), cooldown: tick(RULES.fight.round) },
    aim: 'corpse', range: tiles(6), shape: { kind: 'touch', reach: tiles(6) },
    delivery: { kind: 'sure' }, foesOnly: false, effect: null, ops: [], channel: null,
    raise,
  };
}

function callAbility(): Ability {
  return {
    ...abilityOf('support', { id: abilityId('call-hound'), name: 'Call Hound', range: tiles(0), shape: { kind: 'self' } }, RULES),
    cost: { fatigue: 2, mana: 4, time: cost(RULES.fight.cost.standard), cooldown: tick(0) },
    aim: 'self', delivery: { kind: 'sure' }, effect: null, ops: [],
    summon: { name: 'Spirit Hound', archetype: 'brute', rounds: 5, statuses: [] },
  };
}

function swapMinionAbility(): Ability {
  return {
    ...abilityOf('support', { id: abilityId('exchange'), name: 'Shadow Exchange', range: tiles(12) }, RULES),
    cost: { fatigue: 4, mana: 8, time: cost(RULES.fight.cost.quick), cooldown: tick(0) },
    aim: 'ally', delivery: { kind: 'sure' }, foesOnly: true, effect: null, ops: [],
    move: { kind: 'swap', only: 'minion' },
  };
}

function monster(who: string, at: Place, o: { rank?: Rank; kind?: MonsterKind; dead?: boolean; name?: string } = {}): Extract<NewRow, { kind: 'monster' }> {
  const rank = o.rank ?? 'C', kind = o.kind ?? 'normal';
  const row = monsterRows(statBlock(RULES, rank, { name: o.name ?? who, archetype: 'brute', kind }), [id(who)], RULES)[0]! as Extract<NewRow, { kind: 'monster' }>;
  return { ...row, place: at, life: o.dead ? { at: 'dead' } : row.life };
}

function caster(who: string, at: Place, extra: readonly Ability[] = [], rank: Rank = 'C', statuses: readonly Status[] = []): NewRow {
  const base = hunter('support', rank, who, RULES).row;
  const origin = base.origin.kind === 'hunter'
    ? { kind: 'hunter' as const, build: { ...base.origin.build, perks: { ...base.origin.build.perks, manaMax: 200 } } }
    : base.origin;
  return { ...base, origin, place: at, mana: 200, abilities: [...base.abilities, ...extra], statuses: [...base.statuses, ...statuses] };
}

function startFight(first: string, rows: readonly NewRow[], grid = openGrid(14, 14)): Running {
  const made = reduce(null, { type: 'add', fightId: fightId('f-rise'), rows, openings: [], grid }, ctx).fight!;
  const started = reduce(made, { type: 'start', openings: rows.map((r, i) => ({ id: r.id, d20: r.id === first ? 20 : 1, tie: rows.length - i })) }, ctx);
  if (started.fight?.phase !== 'running') throw new Error(`start failed: ${JSON.stringify(started.effects)}`);
  return started.fight;
}

function mustAct(f: Running, cmd: Command): { fight: Fight; effects: readonly ReturnType<typeof reduce>['effects'][number][] } {
  const r = reduce(f, cmd, ctx);
  const bad = r.effects.find(e => e.type === 'refused');
  if (bad) throw new Error(`${cmd.type} refused: ${JSON.stringify(bad)}`);
  return { fight: r.fight!, effects: r.effects };
}

describe('corpse rise state machine and DC/bonus parity', () => {
  test('riseStep walks open -> open on fail, open -> risen on succeed, and refuses any event once risen', () => {
    expect(RISE_WALK.map(e => riseStep('open', e))).toEqual(['open', 'risen']);
    expect(RISE_WALK.map(e => riseStep('risen', e))).toEqual([null, null]);
    expect(riseState({})).toBe('open');
    expect(riseState({ rose: true })).toBe('risen');
  });

  test('riseDc matches extractDc across all rank pairs and monster kinds', () => {
    for (let u = 0; u < RANKS.length; u++) {
      for (let f = 0; f < RANKS.length; f++) {
        for (const kind of ['normal', 'elite', 'boss'] as const) {
          const origin = { kind: 'monster' as const, name: 'Foe', rank: RANKS[f]!, archetype: 'brute' as const, monsterKind: kind, tweak: NO_TWEAK };
          expect(riseDc({ tier: u }, { origin }, RULES)).toBe(extractDc(RANKS[u]!, RANKS[f]!, kind, RULES.shadow));
        }
      }
    }
  });

  test('riseBonus matches checksOf(Presence) plus raise.bonus, including fatigue penalty', () => {
    const h: SheetHunter = {
      stats: { str: 10, agi: 10, vit: 10, pow: 16, ins: 10, pre: 28, ctl: 10, dis: 10 },
      level: RULES.rankLevels.C, rank: 'C', fatigue: 0, penalty: null, hpAdj: 0, manaAdj: 0,
      titleId: null, titles: [], items: [], equipped: {}, skills: [], conditions: [],
    };
    const at = hunterSheet(h, RULES);
    const fresh = checksOf(h, at, RULES);
    expect(riseBonus({ tier: 2, stats: at.stats, sheet: at.sheet, fatigue: 0 }, DEFAULT_RAISE, RULES))
      .toBe(fresh.bonus.pre + DEFAULT_RAISE.bonus);

    const tiredFatigue = Math.ceil(at.sheet.fatigueMax * RULES.fatigue.penaltyAt / 100) + 5;
    const tired = checksOf({ ...h, fatigue: tiredFatigue }, at, RULES);
    expect(riseBonus({ tier: 2, stats: at.stats, sheet: at.sheet, fatigue: tiredFatigue }, DEFAULT_RAISE, RULES))
      .toBe(tired.bonus.pre + DEFAULT_RAISE.bonus);
  });

  test('risePassed enforces natural 20 auto-pass and natural 1 auto-fail', () => {
    expect(risePassed(20, 0, 50)).toBe(true);
    expect(risePassed(1, 50, 5)).toBe(false);
    expect(risePassed(8, 4, 12)).toBe(true);
    expect(risePassed(7, 4, 12)).toBe(false);
  });
});

describe('Arise mid-fight flow, caps, lanes, and placement', () => {
  test('failed check (including nat 1) spends cost/cooldown only, leaves corpse open and extraction untouched; passed check raises on corpse tile', () => {
    const arise = ariseAbility();
    const f0 = startFight('N', [
      caster('N', place(2, 2), [arise]),
      monster('G1', place(4, 2), { dead: true, name: 'Goblin' }),
      monster('Alive', place(10, 10)),
    ]);
    // needs asks for a single d20 under G1 and no reaction rolls
    const n = needs(arise, body(f0, 'N'), f0.rows, id('G1'), f0.grid, f0.now, RULES);
    expect(n.dice[id('G1')]).toEqual([{ count: 1, sides: 20 }]);
    expect(n.react).toEqual([]);

    // Missing d20 is refused
    expect(reduce(f0, { type: 'act', by: id('N'), ability: arise.id, aim: id('G1'), rolls: { dice: {}, react: {} } }, ctx).effects)
      .toEqual([{ type: 'refused', reason: 'needsRoll' }]);

    // Natural 1 fails without crumbling or marking rose
    const mana0 = body(f0, 'N').mana, fat0 = body(f0, 'N').fatigue;
    const rFail = mustAct(f0, { type: 'act', by: id('N'), ability: arise.id, aim: id('G1'), rolls: { dice: { [id('G1')]: [1] }, react: {} } });
    const fFail = rFail.fight as Running;
    expect(body(fFail, 'N').mana).toBe(mana0 - arise.cost.mana);
    expect(body(fFail, 'N').fatigue).toBe(fat0 + arise.cost.fatigue);
    expect((body(fFail, 'G1') as MonsterRow).rose).toBeUndefined();
    expect((body(fFail, 'G1') as MonsterRow).extraction).toBeUndefined();
    expect(fFail.rows.filter(isRisen)).toEqual([]);

    // Advance until N's turn after cooldown clears, then roll 20 to raise
    let fReady = fFail;
    for (let i = 0; i < 10; i++) {
      if (fReady.currentId === id('N') && (body(fReady, 'N').readyAt[arise.id] ?? 0) <= fReady.now) break;
      fReady = mustAct(fReady, { type: 'endTurn', by: fReady.currentId }).fight as Running;
    }
    const rOk = mustAct(fReady, { type: 'act', by: id('N'), ability: arise.id, aim: id('G1'), rolls: { dice: { [id('G1')]: [20] }, react: {} } });
    const fOk = rOk.fight as Running;
    const risenRows = fOk.rows.filter(isRisen) as SummonRow[];
    expect(risenRows.length).toBe(1);
    const risen = risenRows[0]!;
    expect(risen.name).toBe('Risen Goblin');
    expect(risen.owner).toBe(id('N'));
    expect(risen.until).toBeNull();
    expect(risen.rose).toBe(id('G1'));
    expect(risen.holder).toBeNull();
    expect(risen.xp).toBe(0);
    expect(risen.place).toEqual(place(4, 2));
    expect(isUp(risen)).toBe(true);
    expect(rowHp(risen)).toBe(risen.sheet.hpMax);
    expect((body(fOk, 'G1') as MonsterRow).rose).toBe(true);
    // TLA+ Rule 1: mid-fight rise never touches extraction or emits shadowHp
    expect((body(fOk, 'G1') as MonsterRow).extraction).toBeUndefined();
    expect(rOk.effects.some(e => e.type === 'shadowHp')).toBe(false);
    // Risen row never expires on timeUp
    expect(timeUp(risen, tick(999_999))).toBe(false);
    // Corpse cannot rise a second time
    expect(ready(arise, body(fOk, 'N'), fOk.rows, id('G1'), fOk.grid, tick(fOk.now + RULES.fight.round * 2), RULES)).toBe('noTarget');
  });

  test('aims by CombatantId only (refuses place aim even with stacked corpses) and falls back to nearest free tile when corpse tile is occupied', () => {
    const arise = ariseAbility();
    const f0 = startFight('N', [
      caster('N', place(2, 2), [arise]),
      monster('G1', place(4, 2), { dead: true, name: 'Wolf A' }),
      monster('G2', place(4, 2), { dead: true, name: 'Wolf B' }),
      monster('Blocker', place(4, 2), { name: 'Blocker' }),
    ]);
    // Place aim is always refused for aim: 'corpse'
    expect(reduce(f0, { type: 'act', by: id('N'), ability: arise.id, aim: place(4, 2), rolls: { dice: {}, react: {} } }, ctx).effects)
      .toEqual([{ type: 'refused', reason: 'noTarget' }]);

    // Picking G2 by exact id raises G2 (leaving G1 open) on a free tile adjacent to (4, 2)
    const f1 = mustAct(f0, { type: 'act', by: id('N'), ability: arise.id, aim: id('G2'), rolls: { dice: { [id('G2')]: [20] }, react: {} } }).fight as Running;
    const risen = f1.rows.find(isRisen) as SummonRow;
    expect(risen.rose).toBe(id('G2'));
    expect(risen.name).toBe('Risen Wolf B');
    expect(risen.place).not.toEqual(place(4, 2));
    expect(Math.max(Math.abs(risen.place.x - 4), Math.abs(risen.place.y - 2))).toBe(1);
    expect((body(f1, 'G1') as MonsterRow).rose).toBeUndefined();
    expect((body(f1, 'G2') as MonsterRow).rose).toBe(true);
  });

  test('enforces elite cap (1 per fight even after death), rejects boss/mythic/shadow corpses, and separates risen vs timed summon lanes', () => {
    const arise = ariseAbility({ bonus: 4, maxRisen: 2, elitePerFight: 1 });
    const call = callAbility();
    const sh = { ...shadowRow({ id: 'sh1', name: 'Igris', rank: 'C', archetype: 'brute', grade: 'Normal', hp: 0 }, 'h1', id('N'), id('SH'), RULES), place: place(3, 5) };
    const f0 = startFight('N', [
      caster('N', place(2, 2), [arise, call]),
      monster('E1', place(4, 2), { kind: 'elite', dead: true, name: 'Alpha' }),
      monster('E2', place(5, 2), { kind: 'elite', dead: true, name: 'Beta' }),
      monster('B1', place(4, 3), { kind: 'boss', dead: true }),
      monster('M1', place(5, 3), { kind: 'mythic', dead: true }),
      monster('N1', place(4, 4), { dead: true, name: 'Imp A' }),
      monster('N2', place(5, 4), { dead: true, name: 'Imp B' }),
      monster('N3', place(6, 4), { dead: true, name: 'Imp C' }),
      sh,
      monster('Anchor', place(12, 12)),
    ]);

    // Boss, mythic, and shadow corpses are rejected
    expect(canRiseCorpse(body(f0, 'B1'))).toBe(false);
    expect(canRiseCorpse(body(f0, 'M1'))).toBe(false);
    expect(canRiseCorpse(body(f0, 'SH'))).toBe(false);
    expect(ready(arise, body(f0, 'N'), f0.rows, id('B1'), f0.grid, f0.now, RULES)).toBe('noTarget');
    expect(ready(arise, body(f0, 'N'), f0.rows, id('M1'), f0.grid, f0.now, RULES)).toBe('noTarget');
    expect(ready(arise, body(f0, 'N'), f0.rows, id('SH'), f0.grid, f0.now, RULES)).toBe('noTarget');

    // Raise elite E1
    let f = mustAct(f0, { type: 'act', by: id('N'), ability: arise.id, aim: id('E1'), rolls: { dice: { [id('E1')]: [20] }, react: {} } }).fight as Running;
    expect(elitesRisen(f.rows)).toBe(1);
    const risenElite = f.rows.find(isRisen)!;
    // Kill risen elite via GM adjust: E2 is STILL refused because 1 elite already rose this fight
    f = mustAct(f, { type: 'adjust', id: risenElite.id, hp: -9999 }).fight as Running;
    expect(f.rows.filter(isRisen)).toEqual([]);
    expect(elitesRisen(f.rows)).toBe(1);
    expect(canRiseFor(body(f, 'E2'), f.rows, arise.raise!)).toBe(false);
    expect(ready(arise, body(f, 'N'), f.rows, id('E2'), f.grid, tick(f.now + RULES.fight.round * 2), RULES)).toBe('noTarget');

    // Call 2 timed summons + raise 2 normal corpses: all 4 coexist in separate lanes
    const actAsN = (cur: Running, ab: Ability, aim: CombatantId, d20?: number): Running => {
      let g = cur;
      for (let i = 0; i < 20; i++) {
        if (g.currentId === id('N') && (body(g, 'N').readyAt[ab.id] ?? 0) <= g.now) break;
        g = mustAct(g, { type: 'endTurn', by: g.currentId }).fight as Running;
      }
      const rolls = d20 !== undefined ? { dice: { [aim]: [d20] }, react: {} } : { dice: {}, react: {} };
      return mustAct(g, { type: 'act', by: id('N'), ability: ab.id, aim, rolls }).fight as Running;
    };
    f = actAsN(f, call, id('N'));
    f = actAsN(f, call, id('N'));
    f = actAsN(f, arise, id('N1'), 20);
    f = actAsN(f, arise, id('N2'), 20);
    expect(f.rows.filter(isTimedSummon).length).toBe(2);
    expect(f.rows.filter(isRisen).length).toBe(2);

    // Raising a 3rd corpse evicts the oldest risen (N1) without touching the 2 timed summons
    f = actAsN(f, arise, id('N3'), 20);
    expect(f.rows.filter(isTimedSummon).length).toBe(2);
    expect((f.rows.filter(isRisen) as SummonRow[]).map(r => r.rose)).toEqual([id('N2'), id('N3')]);

    // Calling a 3rd timed summon evicts the oldest timed summon without touching the 2 risen rows
    f = actAsN(f, call, id('N'));
    expect(f.rows.filter(isTimedSummon).length).toBe(2);
    expect((f.rows.filter(isRisen) as SummonRow[]).map(r => r.rose)).toEqual([id('N2'), id('N3')]);

    // Ending the fight removes all summons and risen rows (TLA+ Rule 4)
    const endRes = reduce(f, { type: 'end' }, ctx).fight!;
    expect(endRes.phase).toBe('ended');
    expect(endRes.rows.some(r => r.kind === 'summon')).toBe(false);
  });

  test('risen row is swept when owner goes down or leaves the fight (TLA+ Rule 4)', () => {
    const arise = ariseAbility();
    const f0 = startFight('N', [
      caster('N', place(2, 2), [arise]),
      caster('Ally', place(1, 2)),
      monster('G1', place(4, 2), { dead: true }),
      monster('Anchor', place(10, 10)),
    ]);
    const f1 = mustAct(f0, { type: 'act', by: id('N'), ability: arise.id, aim: id('G1'), rolls: { dice: { [id('G1')]: [20] }, react: {} } }).fight as Running;
    expect(f1.rows.filter(isRisen).length).toBe(1);

    // Owner goes down -> risen fades
    const fDown = mustAct(f1, { type: 'adjust', id: id('N'), hp: -9999 }).fight as Running;
    expect(fDown.rows.filter(isRisen)).toEqual([]);

    // Owner leaves -> risen fades
    const fRemoved = mustAct(f1, { type: 'remove', id: id('N') }).fight as Running;
    expect(fRemoved.rows.filter(isRisen)).toEqual([]);
  });
});

describe('minion swap, minion-only aura, fight-doc, fight-view, and fight-parse', () => {
  test('swap with only: minion swaps with own summon/risen and refuses other allies', () => {
    const arise = ariseAbility(), swap = swapMinionAbility();
    const f0 = startFight('N', [
      caster('N', place(2, 2), [arise, swap]),
      caster('Ally', place(3, 2)),
      monster('G1', place(5, 2), { dead: true }),
      monster('Anchor', place(10, 10)),
    ]);
    // Refuses swapping with another hunter
    expect(reduce(f0, { type: 'act', by: id('N'), ability: swap.id, aim: id('Ally'), rolls: { dice: {}, react: {} } }, ctx).effects)
      .toEqual([{ type: 'refused', reason: 'noTarget' }]);

    let f = mustAct(f0, { type: 'act', by: id('N'), ability: arise.id, aim: id('G1'), rolls: { dice: { [id('G1')]: [20] }, react: {} } }).fight as Running;
    const risenId = f.rows.find(isRisen)!.id;
    while (f.currentId !== id('N')) f = mustAct(f, { type: 'endTurn', by: f.currentId }).fight as Running;

    // Aims offers only own minion for minion swap
    const offered = aims(f.rows.map(spotOf), id('N'), swap, f.grid);
    expect(offered.map(o => o.target.id)).toEqual([risenId]);

    const fSwapped = mustAct(f, { type: 'act', by: id('N'), ability: swap.id, aim: risenId, rolls: { dice: {}, react: {} } }).fight as Running;
    expect(body(fSwapped, 'N').place).toEqual(place(5, 2));
    expect(body(fSwapped, risenId).place).toEqual(place(2, 2));
  });

  test('aura on: minions buffs only owner minions (not allies or self), round-trips parseZone, and Reach rejects minions', () => {
    const auraDef: StatusDef = {
      label: 'Monarch Aura', desc: '',
      ops: [{ op: 'aura', radius: 5, on: 'minions' }, { op: 'speed', pct: 25 }],
    };
    const auraSt = statusOn(auraDef, { key: statusKey('monarch-aura'), source: { id: id('N'), tier: 2 }, until: null, since: tick(0), settledAt: tick(0), worn: true });
    const arise = ariseAbility();
    const f0 = startFight('N', [
      caster('N', place(2, 2), [arise], 'C', [auraSt]),
      caster('Ally', place(3, 2)),
      monster('G1', place(4, 2), { dead: true }),
      monster('Anchor', place(10, 10)),
    ]);
    const f1 = mustAct(f0, { type: 'act', by: id('N'), ability: arise.id, aim: id('G1'), rolls: { dice: { [id('G1')]: [20] }, react: {} } }).fight as Running;
    const risen = f1.rows.find(isRisen)!;
    const zone = f1.zones.find(z => z.name === 'Monarch Aura')!;
    expect(zone.minionsOnly).toBe(true);
    expect(zone.owner).toBe(id('N'));
    // Risen holds the aura zone status; Ally and N do not
    expect(risen.statuses.some(s => s.zone === zone.id)).toBe(true);
    expect(body(f1, 'Ally').statuses.some(s => s.zone === zone.id)).toBe(false);
    expect(body(f1, 'N').statuses.some(s => s.zone === zone.id)).toBe(false);

    // parseZone round-trips minionsOnly
    expect(parseZone(JSON.parse(JSON.stringify(zone)), f1.grid, RULES)?.minionsOnly).toBe(true);

    // Reach rejects on: 'minions' (only AuraOn allows 'minions')
    const badReach = parseStatusDef({
      label: 'Bad', desc: '', ops: [],
      triggers: [{ on: 'turnStart', to: { kind: 'area', radius: 3, on: 'minions' }, limit: { kind: 'each' }, ops: [{ op: 'note', text: 'x' }] }],
    }, RULES);
    expect(badReach).toBeNull();
  });

  test('fightDoc sets left: null on risen, canRise on eligible corpses, prioritizes canRise over spent corpses within DOC_ROWS, and round-trips wire + parseFight', () => {
    const arise = ariseAbility();
    const rows: NewRow[] = [
      caster('N', place(0, 0), [arise]),
      monster('Live', place(1, 0)),
      monster('Fresh', place(2, 0), { dead: true }),
      ...Array.from({ length: DOC_ROWS }, (_, i) => ({
        ...monster(`Spent${i}`, place(i % 10, 1 + Math.floor(i / 10)), { dead: true }),
        rose: true as const,
      })),
    ];
    const f0 = startFight('N', rows);
    const doc0 = fightDoc(f0, RULES, { by: 'd-gm' as DeviceId, at: '2026-11-26T00:00:00Z', was: null, keyOf: () => null });
    if (!doc0 || doc0.ended) throw new Error('expected active doc');
    expect(doc0.rows.length).toBe(DOC_ROWS);
    const freshRow = doc0.rows.find(r => r.id === id('Fresh'));
    expect(freshRow?.kind === 'monster' && freshRow.canRise).toBe(true);
    // Wire round-trip preserves canRise and feeds fight-view aims
    const parsedDoc = DOCS.fight(fightWire(doc0));
    if (!parsedDoc || parsedDoc.ended) throw new Error('expected active parsed doc');
    const wireFresh = parsedDoc.rows.find(r => r.id === id('Fresh'));
    expect(wireFresh?.kind === 'monster' && wireFresh.canRise).toBe(true);
    expect(aims(docSpots(parsedDoc.rows), id('N'), arise, f0.grid).map(a => a.target.id)).toEqual([id('Fresh')]);

    // Raise Fresh -> risen row has left: null in doc and summon: null in cardOf, and Fresh loses canRise
    const f1 = mustAct(f0, { type: 'act', by: id('N'), ability: arise.id, aim: id('Fresh'), rolls: { dice: { [id('Fresh')]: [20] }, react: {} } }).fight as Running;
    const risen = f1.rows.find(isRisen)!;
    expect(cardOf(f1, risen, RULES).summon).toBeNull();
    const doc1 = fightDoc(f1, RULES, { by: 'd-gm' as DeviceId, at: '2026-11-26T00:00:01Z', was: doc0, keyOf: () => null });
    if (!doc1 || doc1.ended) throw new Error('expected active doc');
    const docRisen = doc1.rows.find(r => r.id === risen.id);
    expect(docRisen?.kind === 'summon' && docRisen.left).toBeNull();
    const wireDoc1 = DOCS.fight(fightWire(doc1));
    if (!wireDoc1 || wireDoc1.ended) throw new Error('expected active wire doc');
    const wireRisen = wireDoc1.rows.find(r => r.id === risen.id);
    expect(wireRisen?.kind === 'summon' && wireRisen.left).toBeNull();

    // parseFight round-trip preserves risen row, rose: true corpse, and Ability.raise
    const roundTripped = parseFight(JSON.parse(JSON.stringify(f1)), RULES);
    expect(roundTripped).not.toBeNull();
    const rtRisen = roundTripped!.rows.find(r => r.id === risen.id) as SummonRow;
    expect(rtRisen.until).toBeNull();
    expect(rtRisen.rose).toBe(id('Fresh'));
    expect((roundTripped!.rows.find(r => r.id === id('Fresh')) as MonsterRow).rose).toBe(true);

    // parseFight rejects summon with until: null and no rose, or with rose and numeric until
    const bad1 = JSON.parse(JSON.stringify(f1));
    delete bad1.rows.find((r: { id: string }) => r.id === risen.id).rose;
    expect(parseFight(bad1, RULES)).toBeNull();
    const bad2 = JSON.parse(JSON.stringify(f1));
    bad2.rows.find((r: { id: string }) => r.id === risen.id).until = 500;
    expect(parseFight(bad2, RULES)).toBeNull();
  });
});
