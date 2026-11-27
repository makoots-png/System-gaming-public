// The room's fight doc: what the players' table may see of the GM's fight. Expected values come from
// docs/agent-handoff/rw/m2-plan.md section 1.3 and design.md section 5.4 (the fields, the 32-row cap, 20 rows under the
// server's 16,384 characters), the old fight's band thresholds (75, 50 and 25 percent, combat.js) and the timeline's rule
// (design 1.2: a standard action takes `RULES.fight.round` ticks at speed 100, a d20 of 10 opens half an interval late).
import { describe, expect, test } from 'bun:test';
import { DOCS, DOC_MAX } from '../src/core/protocol.ts';
import { RULES } from '../src/core/rules.ts';
import { baseStats } from '../src/core/stats.ts';
import { kitGear } from '../src/core/hunter/derive.ts';
import { parseFormula } from '../src/core/formula.ts';
import { openGrid, percent, place, tiles, tilesOf } from '../src/core/combat/space.ts';
import type { Grid, Side, Terrain } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { abilityId, combatantId, hunterId } from '../src/core/combat/ability-types.ts';
import { fightId, parseSheetKey } from '../src/core/ids.ts';
import { freeStatusKey, modified, shadowId, statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
import type { Body, Origin, StackDef, Status, StatusDef } from '../src/core/combat/effect-ops.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import type { RowHunter, RowMonster } from '../src/core/combat/rows.ts';
import { keystoneOf } from '../src/core/registry/keystones.ts';
import { parseFight } from '../src/core/combat/fight-parse.ts';
import { withKeystones } from './fixtures/keystone-rules.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { line, reduce } from '../src/core/combat/fight.ts';
import type { Command, Ctx, Fight, NewRow } from '../src/core/combat/fight.ts';
import { DOC_DODGE_RUNS, DOC_MYTHICS, DOC_ROWS, TABLE_REFUSALS, band, docDodgeOptions, fightDoc, fightWire, tilesOfRuns } from '../src/core/combat/fight-doc.ts';
import { docDodge } from '../src/core/combat/map-view.ts';
import { MYTHIC_IDS, movesOf, mythicScriptOf } from '../src/core/registry/mythics.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';
import type { DocContext, FightDoc, FightDocRow } from '../src/core/combat/fight-doc.ts';
import type { DeviceId, SheetKey } from '../src/core/ids.ts';
import type { OmenKey } from '../src/core/combat/mythic-types.ts';
import type { CombatantId } from '../src/core/combat/ability-types.ts';
import type { Place } from '../src/core/combat/space.ts';
import type { IconKey } from '../src/core/registry/icons.ts';
import { needs } from '../src/core/combat/resolve.ts';
import { isUp } from '../src/core/combat/row-hp.ts';
import { NO_FUDGE, weightsFor } from '../src/core/combat/fudge.ts';
import { drawNeeds, seededSource } from '../src/core/draws.ts';
import type { Effect, Running } from '../src/core/combat/fight.ts';
import { atHp, lifeAt } from './fixtures/life.ts';
import type { RowPatch } from './fixtures/life.ts';
import { newEquipped } from '../src/core/hunter/hunter.ts';
const sheetKey = (s: string) => parseSheetKey(s) ?? (() => { throw new Error(`not a sheet key: ${s}`); })();

const ctx: Ctx = { rules: RULES };
const id = combatantId;
const ME = 'd-gm' as DeviceId, OTHER = 'd-other' as DeviceId, AT = '2026-11-13T10:00:00.000Z';
const docCtx = (o: Partial<DocContext> = {}): DocContext => ({ by: ME, at: AT, was: null, keyOf: h => `${ME}:${h}` as SheetKey, ...o });
const f = (text: string) => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };
const HIT = { ...abilityOf('strike', { id: abilityId('hit'), name: 'Hit' }, RULES), range: tiles(20), shape: { kind: 'touch', reach: tiles(20) } } as const;
const SLAM = { ...abilityOf('strike', { id: abilityId('slam'), name: 'Ground Slam' }, RULES), effect: { type: 'physical', by: 'hand', formula: f('10') } } as const;
const origin: Origin = { kind: 'hunter', build: { stats: baseStats(RULES.fight), level: 1, gear: kitGear('light', RULES), perks: {} } };
/** Base stats in a light kit: speed 100, so a standard action takes one round of ticks. */
const HP_MAX = modified(origin, [], RULES).sheet.hpMax;
const st = (key: string, until: number | null, label = key): Status =>
  ({ key: statusKey(key), def: { label, desc: '', ops: [] }, source: { id: null, tier: 0 }, until: until === null ? null : tick(until), since: tick(0), settledAt: tick(0) });

function row(name: string, side: Side, o: RowPatch<NewRow> = {}): NewRow {
  const { kind: k, hp, ...rest } = o;
  const kind = k ?? (side === 'party' ? 'hunter' : 'monster');
  // a row of `kind` with that kind's own fields (effect-ops.ts `Body`); a patch that names a summon gives its owner and end
  return {
    id: id(name), name, side, ...lifeAt(kind, hp ?? HP_MAX), origin, tier: 0, place: null, mana: 10, fatigue: 0, shield: null, stagger: null, channel: null,
    threat: kind === 'monster' ? {} : null, statuses: [], readyAt: {}, abilities: [HIT, SLAM], intent: null,
    holder: kind === 'hunter' ? { kind: 'local', hunterId: hunterId(`h-${name}`) } : null, xp: 0, mythic: null, ...rest,
  } as NewRow;
}
function play(...commands: Command[]): Fight {
  let fight: Fight | null = null;
  for (const cmd of commands) {
    const r = reduce(fight, cmd, ctx);
    const no = r.effects.find(e => e.type === 'refused');
    if (no) throw new Error(`${cmd.type} refused: ${JSON.stringify(no)}`);
    fight = r.fight;
  }
  return fight!;
}
const add = (...rows: NewRow[]): Command => ({ type: 'add', fightId: fightId('f-1'), rows, openings: [] });
/** A d20 of 20 opens at 0; a d20 of 10 opens half an interval late, at 500. */
const start = (...list: [string, number][]): Command => ({ type: 'start', openings: list.map(([name, d20]) => ({ id: id(name), d20, tie: 0 })) });
const live = (doc: FightDoc | null) => { if (!doc || doc.ended) throw new Error('not a live doc'); return doc; };
const rowIn = (doc: FightDoc | null, name: string): FightDocRow => live(doc).rows.find(r => r.id === name)!;
/** The fight with one row changed by hand, as a stored fight could hold it. */
const withBody = (fight: Fight, name: string, change: RowPatch<Body>): Fight => {
  const { hp, ...rest } = change;
  // a row's own fields beside its life: the patch holds neither its kind nor its life
  return { ...fight, rows: fight.rows.map(r => { const b = { ...r, ...rest } as Body; return r.id !== name ? r : hp === undefined ? b : atHp(b, hp); }) };
};

describe('each row\'s picture on the table\'s doc: the GM\'s phone answers it and the doc carries the answer (icons design 5, ruling 1)', () => {
  const monsterOrigin = (o: { icon?: IconKey; type?: string } = {}): Origin =>
    ({ kind: 'monster', name: 'Rat', rank: 'E', archetype: 'brute', monsterKind: 'normal', tweak: { hp: 1, dealt: 1, stats: {}, traits: [] }, ...o });
  /** A hunter with an emblem (A), one with none (B), a rat its GM gave a raven (M), a Beast (N), a type the table lacks (O). */
  const fight = () => play(add(
    row('A', 'party'), row('B', 'party'),
    row('M', 'foe', { origin: monsterOrigin({ icon: 'raven', type: 'Beast' }) }), row('N', 'foe', { origin: monsterOrigin({ type: 'Beast' }) }),
    row('O', 'foe', { origin: monsterOrigin({ type: 'Swamp thing' }) }),
  ), start(['A', 20], ['B', 20], ['M', 10], ['N', 10], ['O', 10]));
  const sheets: Record<string, { emblem: string }> = { A: { emblem: 'crown' }, B: { emblem: '' } };
  const hunterOf = (b: Body) => sheets[b.id] ?? null;
  const doc = () => live(fightDoc(fight(), RULES, docCtx({ hunterOf })));
  const wire = () => fightWire(doc()) as { rows: { i: string; ic?: string }[] };
  const read = (w: unknown) => live(DOCS.fight(JSON.parse(JSON.stringify(w))) as FightDoc);

  test('a pick, a type\'s picture, an archetype\'s and a hunter\'s emblem each ride the row as ic; a hunter with no emblem carries none', () => {
    expect(doc().rows.map(r => [r.id, r.icon])).toEqual([['A', 'crown'], ['B', null], ['M', 'raven'], ['N', 'wolf'], ['O', 'claw']]);
    expect(wire().rows.map(r => [r.i, r.ic])).toEqual([['A', 'crown'], ['B', undefined], ['M', 'raven'], ['N', 'wolf'], ['O', 'claw']]);
    expect(live(fightDoc(fight(), RULES, docCtx())).rows.map(r => r.icon), 'a phone that finds no sheet sends no emblem').toEqual([null, null, 'raven', 'wolf', 'claw']);
  });
  test('the reader gives each key back, and an unknown key or one that is no string reads as none, never refuses the doc', () => {
    expect(read(wire()).rows.map(r => r.icon)).toEqual(['crown', null, 'raven', 'wolf', 'claw']);
    for (const ic of ['gone', 7, {}]) {
      const w = wire(); w.rows[2]!.ic = ic as never;
      expect(read(w).rows.map(r => r.icon), String(ic)).toEqual(['crown', null, null, 'wolf', 'claw']);
    }
  });
});

describe('the band a player sees for HP they may not see', () => {
  test('above 75% is healthy, above 50% wounded, above 25% bloodied, any HP left critical, and 0 down', () => {
    const at = [100, 76, 75, 51, 50, 26, 25, 1, 0].map(hp => band(hp, 100));
    expect(at).toEqual(['healthy', 'healthy', 'wounded', 'wounded', 'bloodied', 'bloodied', 'critical', 'critical', 'down']);
  });

  test('a hunter and a shadow show their exact HP; a monster shows only its band', () => {
    const shadow = row('S', 'party', { kind: 'shadow', owner: id('A'), hp: 10, holder: { kind: 'shadow', hunterId: hunterId('h-A'), shadowId: shadowId('s-1') } });
    const doc = fightDoc(play(add(row('A', 'party', { hp: 30 }), shadow, row('M', 'foe', { hp: 1 }))), RULES, docCtx());
    expect(rowIn(doc, 'A')).toMatchObject({ kind: 'hunter', hp: 30, hpMax: HP_MAX });
    expect(rowIn(doc, 'S')).toMatchObject({ kind: 'shadow', hp: 10, hpMax: HP_MAX });
    const m = rowIn(doc, 'M');
    expect(m.band).toBe('critical');
    expect('hp' in m || 'hpMax' in m).toBe(false);
  });

  test('a hunter\'s row carries its stride for the player\'s Toward and Away and its move for the map\'s dash; a monster\'s does not', () => {
    const doc = fightDoc(play(add(row('A', 'party'), row('M', 'foe'))), RULES, docCtx());
    // a base body moves RULES.fight.moveBase (6) tiles a round at speed 100, and one move walks strideShare (half) of it: 3;
    // a dash runs the whole move (design 4.6): 6
    expect(rowIn(doc, 'A')).toMatchObject({ kind: 'hunter', stride: Math.ceil(RULES.fight.moveBase * RULES.fight.strideShare), move: RULES.fight.moveBase });
    expect('stride' in rowIn(doc, 'M') || 'move' in rowIn(doc, 'M')).toBe(false);
  });
});

describe('the fight on the table', () => {
  test('in setup nobody has a turn: not active, time 0, no current row and no order ahead', () => {
    const doc = live(fightDoc(play(add(row('A', 'party'), row('M', 'foe'))), RULES, docCtx()));
    expect(doc).toMatchObject({ ended: false, active: false, by: ME, id: 'f-1', at: AT, now: 0, currentId: null, ahead: [], grid: RULES.fight.grid });
    expect(doc.rows.map(r => [r.id, r.side, r.place])).toEqual([['A', 'party', place(0, 2)], ['M', 'foe', place(0, 10)]]);
  });

  test('a running fight shows whose turn it is and the next 8 turns of standard actions, without a body that is down', () => {
    const fight = play(add(row('A', 'party'), row('B', 'party', { hp: 0 }), row('M', 'foe')), start(['A', 20], ['B', 20], ['M', 10]));
    const doc = live(fightDoc(fight, RULES, docCtx()));
    expect(doc).toMatchObject({ active: true, now: 0, currentId: 'A' });
    expect(doc.ahead).toEqual(['A', 'M', 'A', 'M', 'A', 'M', 'A', 'M']);
    expect(rowIn(doc, 'M')).toMatchObject({ at: 500, speed: 100, life: { at: 'up' } });
    expect(rowIn(doc, 'B')).toMatchObject({ band: 'down', life: { at: 'dead' } });
  });

  test('a row shows its live statuses (not one whose time ran out, owed to its settle) with the rounds left to one decimal, at most 12, and a live shield\'s amount', () => {
    const many = Array.from({ length: 13 }, (_, i) => st(`s${i}`, null));
    const fight = play(add(row('A', 'party'), row('M', 'foe')), start(['A', 20], ['M', 10]));
    const timed = withBody(fight, 'A', { statuses: [st('burning', 2500, 'Burning'), st('marked', null, 'Marked'), { ...st('gone', 0), owed: true }], shield: { amount: 12, until: tick(2000) } });
    expect(rowIn(fightDoc(timed, RULES, docCtx()), 'A')).toMatchObject({
      statuses: [{ key: 'burning', label: 'Burning', left: 2.5 }, { key: 'marked', label: 'Marked', left: null }], shield: 12,
    });
    const crowded = withBody(fight, 'A', { statuses: many, shield: { amount: 12, until: tick(0) } });
    const a = rowIn(fightDoc(crowded, RULES, docCtx()), 'A');
    expect(a.statuses.map(s => s.key)).toEqual(many.slice(0, 12).map(s => s.key));
    expect(a.shield).toBeNull();
  });

  test('an intent\'s numbers are not in the doc a player\'s phone gets until the GM reveals them, then they are', () => {
    const set = play(add(row('A', 'party'), row('M', 'foe')), start(['A', 20], ['M', 10]), { type: 'setIntent', by: id('M'), ability: SLAM.id, aim: id('A') });
    const hidden = JSON.stringify(fightDoc(set, RULES, docCtx()));
    expect(rowIn(fightDoc(set, RULES, docCtx()), 'M')).toMatchObject({ intent: { name: 'Ground Slam', target: 'A', reveal: null } });
    expect(hidden.includes('Physical damage'), 'no word of the numbers anywhere in the doc').toBe(false);
    const shown = play(add(row('A', 'party'), row('M', 'foe')), start(['A', 20], ['M', 10]), { type: 'setIntent', by: id('M'), ability: SLAM.id, aim: id('A') }, { type: 'reveal', by: id('M') });
    expect(rowIn(fightDoc(shown, RULES, docCtx()), 'M')).toMatchObject({ intent: { reveal: { lines: ['Physical damage 10', `Range ${SLAM.range} tile${SLAM.range === 1 ? '' : 's'}`, 'Avoided by moving out of it'], radius: null, outer: null } } });
  });

  test('a monster shows its announced ability and target and its stagger bar in whole numbers', () => {
    const fight = play(add(row('A', 'party'), row('M', 'foe', { stagger: { fill: 3.4, max: 87.5, hit: 35 } })), start(['A', 20], ['M', 10]),
      { type: 'setIntent', by: id('M'), ability: SLAM.id, aim: id('A') });
    expect(rowIn(fightDoc(fight, RULES, docCtx()), 'M')).toMatchObject({ kind: 'monster', intent: { name: 'Ground Slam', target: 'A' }, stagger: { fill: 3, max: 88 } });
    expect(rowIn(fightDoc(fight, RULES, docCtx()), 'A')).not.toHaveProperty('intent');
  });

  test('a hunter on this phone carries its sheet key, a player\'s hunter its own, and a shadow or monster none', () => {
    const remote = row('P', 'party', { holder: { kind: 'remote', remote: sheetKey('d-player:h-9') } });
    const shadow = row('S', 'party', { kind: 'shadow', owner: id('A'), holder: { kind: 'shadow', hunterId: hunterId('h-A'), shadowId: shadowId('s-1') } });
    const unheld = row('U', 'party', { holder: null });
    const doc = fightDoc(play(add(row('A', 'party'), remote, shadow, unheld, row('M', 'foe'))), RULES, docCtx());
    expect(['A', 'P', 'S', 'U', 'M'].map(n => rowIn(doc, n).key)).toEqual([`${ME}:h-A`, 'd-player:h-9', null, null, null]);
    const notInRoom = fightDoc(play(add(row('A', 'party'))), RULES, docCtx({ keyOf: () => null }));
    expect(rowIn(notInRoom, 'A').key).toBeNull();
  });

  test('a player\'s tap the GM\'s phone turned down shows while the fight\'s time is still the time it was turned down at', () => {
    const fight = play(add(row('A', 'party'), row('M', 'foe')), start(['A', 20], ['M', 10]));
    const refused = { id: id('A'), at: tick(0), reason: 'mana', n: 1 } as const;
    expect(live(fightDoc(fight, RULES, docCtx({ refused }))).refused).toEqual(refused);
    expect(live(fightDoc(fight, RULES, docCtx())).refused).toBeNull();
    const later = play(add(row('A', 'party'), row('M', 'foe')), start(['A', 20], ['M', 10]), { type: 'endTurn', by: id('A') });
    expect(live(fightDoc(later, RULES, docCtx({ refused }))).refused).toBeNull();
  });

  test('the current row\'s abilities on cooldown show when each is ready again; a ready one and another row\'s do not', () => {
    const fight = play(add(row('A', 'party'), row('M', 'foe')), start(['A', 20], ['M', 10]));
    const cooling = withBody(withBody(fight, 'A', { readyAt: { [SLAM.id]: tick(2000), [HIT.id]: tick(0) } }), 'M', { readyAt: { [SLAM.id]: tick(2000) } });
    expect(live(fightDoc(cooling, RULES, docCtx())).ready).toEqual({ [SLAM.id]: 2000 });
    expect(live(fightDoc(fight, RULES, docCtx())).ready).toEqual({});
  });

  test('the table shows the 5 newest log lines, newest first', () => {
    const fight = play(add(row('A', 'party'), row('M', 'foe')));
    const log = ['six', 'five', 'four', 'three', 'two', 'one'].map(t => line(t));
    expect(live(fightDoc({ ...fight, log }, RULES, docCtx())).log).toEqual(['six', 'five', 'four', 'three', 'two']);
  });
});

describe('the end of a fight on the table', () => {
  test('a fight that ended is an ended doc that keeps only its id and time', () => {
    const fight = play(add(row('A', 'party'), row('M', 'foe')), start(['A', 20], ['M', 10]), { type: 'end' });
    expect(fightDoc(fight, RULES, docCtx())).toEqual({ ended: true, active: false, id: fightId('f-1'), at: AT });
  });

  test('with no fight, this phone ends its own fight on the table but never another GM phone\'s, and publishes nothing twice', () => {
    const was = live(fightDoc(play(add(row('A', 'party'), row('M', 'foe'))), RULES, docCtx()));
    expect(fightDoc(null, RULES, docCtx({ was }))).toEqual({ ended: true, active: false, id: fightId('f-1'), at: AT });
    expect(fightDoc(null, RULES, docCtx({ was: { ...was, by: OTHER } }))).toBeNull();
    expect(fightDoc(null, RULES, docCtx({ was: { ended: true, active: false, id: fightId('f-1'), at: AT } }))).toBeNull();
    expect(fightDoc(null, RULES, docCtx())).toBeNull();
  });
});

describe('a row\'s life as every phone reads it (notes-dead-row.md section 10)', () => {
  const fallen = () => play(add(row('A', 'party'), row('B', 'party', { hp: 0 }), row('M', 'foe'), row('G', 'foe', { hp: 0 })), start(['A', 20], ['B', 20], ['M', 10], ['G', 10]));
  /** The doc as a player's phone holds it: published on the wire and read back by the room's reader. */
  const onPhone = (fight: Fight) => live(DOCS.fight(JSON.parse(JSON.stringify(fightWire(live(fightDoc(fight, RULES, docCtx())))))) as FightDoc);
  const lives = (doc: FightDoc) => live(doc).rows.map(r => [r.id, r.kind, r.life.at]);

  test('a hunter who fell is dead on a player\'s phone, and so is a monster at 0 HP; the rest are up', () => {
    expect(lives(onPhone(fallen()))).toEqual([['A', 'hunter', 'up'], ['B', 'hunter', 'dead'], ['M', 'monster', 'up'], ['G', 'monster', 'dead']]);
  });

  test('a dead hunter is up again on a player\'s phone once the GM revives it', () => {
    const back = reduce(fallen(), { type: 'revive', id: id('B') }, ctx).fight!;
    expect(rowIn(onPhone(back), 'B')).toMatchObject({ life: { at: 'up' }, hp: 1 });
  });

  test('on the wire a life is one short field, d, absent while up: 1 dead (a hunter\'s and a defeated monster\'s), as LIFE_STATES orders them', () => {
    const rows = (fightWire(live(fightDoc(fallen(), RULES, docCtx()))) as { rows: Record<string, unknown>[] }).rows;
    expect(rows.map(r => r.d)).toEqual([undefined, 1, undefined, 1]);
  });
});

/** The six longest keys and labels of the built-in statuses (design 5.4 sizes a worst-case row with six). */
const SIX_LONGEST = [['restrained', 'Restrained'], ['frightened', 'Frightened'], ['paralyzed', 'Paralyzed'], ['bloodlust', 'Bloodlust'], ['invisible', 'Invisible'], ['poisoned', 'Poisoned']] as const;

describe('the doc stays small enough for the room', () => {
  test(`past ${DOC_ROWS} rows the doc keeps the current row and those on the map, in the fight's order`, () => {
    const foes = Array.from({ length: DOC_ROWS + 7 }, (_, i) => row(`M${i}`, 'foe', { place: place(i % 20, 8 + Math.floor(i / 20)) }));
    const fight = play(add(row('A', 'party'), ...foes), start(['A', 20], ...foes.map(m => [m.id, 10] as [string, number])));
    const downed = foes.slice(0, 8).reduce((g, m) => withBody(g, m.id, { hp: 0 }), fight);
    const doc = live(fightDoc(downed, RULES, docCtx()));
    expect(doc.rows.map(r => r.id)).toEqual(['A', ...foes.slice(8).map(m => m.id)]);
    expect(doc.rows).toHaveLength(DOC_ROWS);
  });

  test('20 rows (4 hunters, 4 shadows, 12 monsters) with 60-character names, 6 statuses each, every intent revealed and 5 full log lines fit in half the room\'s cap', () => {
    const long = (s: string, n: number) => s.padEnd(n, 'x');
    const statuses = SIX_LONGEST.map(([key, label]) => st(key, 12345, label));
    const named = (name: string, side: Side, o: Partial<NewRow>) => row(name, side, { name: long(name, 60), statuses, shield: null, ...o });
    const rows = [
      ...Array.from({ length: 4 }, (_, i) => named(`hunter-${i}`, 'party', { holder: { kind: 'remote', remote: sheetKey(long(`d-player${i}:h-`, 40)) } })),
      ...Array.from({ length: 4 }, (_, i) => named(`shadow-${i}`, 'party', { kind: 'shadow', owner: id(`hunter-${i}`), holder: { kind: 'shadow', hunterId: hunterId('h-1'), shadowId: shadowId(`s-${i}`) } })),
      ...Array.from({ length: 12 }, (_, i) => named(`monster-${i}`, 'foe', { stagger: { fill: 123.456, max: 987.654, hit: 35 } })),
    ];
    const fight = play(add(...rows), start(...rows.map(r => [r.id, 10] as [string, number])));
    const full = {
      ...fight, log: Array.from({ length: 5 }, () => line('y'.repeat(300))),
      rows: fight.rows.map((r): Body => (r.kind === 'monster' ? { ...r, shield: { amount: 99999, until: tick(99999) }, intent: { ability: SLAM.id, aim: place(19, 13), revealed: true } } : { ...r, shield: { amount: 99999, until: tick(99999) } })),
    };
    const doc = live(fightDoc(full, RULES, docCtx()));
    expect(doc.rows).toHaveLength(20);
    expect(doc.rows.every(r => r.statuses.length === 6)).toBe(true);
    expect(JSON.stringify(doc).length).toBeLessThan(DOC_MAX / 2);
  });
});

/** A wall down the middle with a gap at the bottom: a body at (1, 1) has no line to (8, 1), one at the gap (5, 4) has. */
const ROOM = ['.....#....', '.....#....', '.....#....', '.....#....', '..........'];
const grid = { w: 10, h: 5, tiles: ROOM.join('').split('').map(c => (c === '#' ? 'wall' : 'floor') as 'wall' | 'floor') };
const fog = { sight: tiles(25), seen: '0'.repeat(50) };

describe('the party\'s view: a fog of war (design 5.3)', () => {
  // Kai on the left, a Ghoul behind the wall with burning ground under it.
  const fire: Command = { type: 'zoneAdd', zone: { id: 'z1' as never, name: 'Burning ground', tiles: [place(8, 1), place(8, 2)], spares: null, tier: 0, duration: null, ops: [] } };
  const setup = (...more: Command[]) => play(
    { type: 'add', fightId: fightId('f-fog'), rows: [row('Kai', 'party', { place: place(1, 1) }), row('Ghoul', 'foe', { place: place(8, 1) })], openings: [], grid, fog },
    fire, { type: 'setIntent', by: id('Ghoul'), ability: abilityId('slam'), aim: id('Kai') }, ...more);
  const doc = (f: Fight) => live(fightDoc(f, RULES, docCtx()));
  const at = (d: ReturnType<typeof doc>, x: number, y: number) => d.grid.tiles![y * 10 + x];

  test('a foe behind a wall is not in the doc at all: not its row, its zone, its intent nor its name', () => {
    const d = doc(setup());
    expect(d.rows.map(r => r.id)).toEqual(['Kai']);
    expect(d.zones).toEqual([]);
    expect(JSON.stringify(d)).not.toContain('Ghoul');
    expect(JSON.stringify(d)).not.toContain('Burning');
    expect([at(d, 8, 1), at(d, 5, 1), at(d, 1, 1)]).toEqual(['?', '#', '.']);
  });

  test('when Kai steps to the gap the Ghoul, its intent and its burning ground appear; the GM\'s fight was the same all along', () => {
    const d = doc(setup({ type: 'place', id: id('Kai'), to: place(5, 4) }));
    expect(d.rows.map(r => r.id)).toEqual(['Kai', 'Ghoul']);
    expect(rowIn(d, 'Ghoul')).toMatchObject({ kind: 'monster', intent: { name: 'Ground Slam', target: 'Kai' } });
    expect(d.zones).toEqual([{ id: 'z1', name: 'Burning ground', tiles: '18+1,28+1', tone: 'plain', left: null, anchor: null }]);
  });

  test('stepping back hides the Ghoul again, and the floor and walls the party saw stay drawn', () => {
    const d = doc(setup({ type: 'place', id: id('Kai'), to: place(5, 4) }, { type: 'place', id: id('Kai'), to: place(1, 1) }));
    expect(d.rows.map(r => r.id)).toEqual(['Kai']);
    expect(d.zones).toEqual([]);
    expect([at(d, 8, 1), at(d, 9, 4)]).toEqual(['.', '.']);
    expect(d.grid.lit![8 + 10]).toBe('0');
  });

  test('a hunter who is down sees nothing, so a foe in the open is hidden while the party has nobody up', () => {
    const open = play({ type: 'add', fightId: fightId('f-fog'), rows: [row('Kai', 'party', { place: place(1, 4), hp: 0 }), row('Ghoul', 'foe', { place: place(3, 4) })], openings: [], grid, fog });
    expect(doc(open).rows.map(r => r.id)).toEqual(['Kai']);
  });

  test('two hunters share one view: what either sees is in the doc', () => {
    const two = play({ type: 'add', fightId: fightId('f-fog'), rows: [row('Kai', 'party', { place: place(1, 1) }), row('Mira', 'party', { place: place(9, 4) }), row('Ghoul', 'foe', { place: place(8, 1) })], openings: [], grid, fog });
    expect(doc(two).rows.map(r => r.id)).toEqual(['Kai', 'Mira', 'Ghoul']);
  });

  test('with no fog the doc carries every row and an open arena sends no tiles at all', () => {
    const plain = play(add(row('Kai', 'party'), row('Ghoul', 'foe')));
    expect(doc(plain).grid).toEqual({ w: RULES.fight.grid.w, h: RULES.fight.grid.h, tiles: null, lit: null });
    expect(doc(plain).rows).toHaveLength(2);
  });
});

describe('the kits on the table (kits design 1.11)', () => {
  const PAIN: StackDef = { label: 'Pain', desc: '', ops: [], stack: { cap: 10, leave: { kind: 'never' }, keep: 'fight', threshold: null } };
  const pain = (n: number): Status => ({ key: statusKey('pain'), def: PAIN, source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0), stacks: n });
  const twice = { ...HIT, id: abilityId('twice'), name: 'Twice', gates: [{ kind: 'uses', per: 'fight', n: 2 }] } as const;

  test('a stacking status shows its count beside its rounds left, and a plain one shows none', () => {
    const doc = fightDoc(play(add(row('A', 'party', { statuses: [pain(7), st('plain', null)] }), row('M', 'foe')), start(['A', 20], ['M', 10])), RULES, docCtx());
    expect(rowIn(doc, 'A').statuses.map(({ def: _, tier: _t, ...s }) => s)).toEqual([{ key: 'pain', label: 'Pain', left: null, stacks: 7 }, { key: 'plain', label: 'plain', left: null }]);
  });

  test('a status 0.94 rounds from its end reads 1 round left on a player\'s table, as the GM\'s card rounds what is left: up, never 0 while it runs', () => {
    const doc = fightDoc(play(add(row('A', 'party', { statuses: [st('dazed', 940)] }), row('M', 'foe')), start(['A', 20], ['M', 10])), RULES, docCtx());
    expect(rowIn(doc, 'A').statuses[0]!.left).toBe(1);
  });

  test('a status carries its def and its source\'s tier, and on the wire its def is sent once for every row that holds it', () => {
    const f = play(add(row('A', 'party', { statuses: [pain(7)] }), row('B', 'party', { statuses: [pain(2)] }), row('M', 'foe')), start(['A', 20], ['B', 15], ['M', 10]));
    const doc = live(fightDoc(f, RULES, docCtx())), held = f.rows.find(r => r.id === id('A'))!.statuses[0]!;
    expect(rowIn(doc, 'A').statuses[0]).toMatchObject({ def: held.def, tier: held.source.tier });
    const wire = fightWire(doc) as { defs: Record<string, unknown>; rows: { st: Record<string, unknown>[] }[] };
    expect(Object.keys(wire.defs)).toEqual(['pain']);
    expect(wire.rows.slice(0, 2).map(r => r.st[0])).toEqual([{ k: 'pain', n: 7 }, { k: 'pain', n: 2 }]);
    expect((DOCS.fight(JSON.parse(JSON.stringify(wire))) as typeof doc).rows.map(r => r.statuses.map(s => s.def?.label))).toEqual([['Pain'], ['Pain'], []]);
  });

  test('the current row\'s abilities limited a fight or a rest show their uses left, a spent one 0; a row with none shows nothing', () => {
    const doc = fightDoc(play(add(row('A', 'party', { abilities: [HIT, twice], used: { [twice.id]: 1 } }), row('M', 'foe')), start(['A', 20], ['M', 10])), RULES, docCtx());
    expect(live(doc).left).toEqual({ twice: 1 });
    const spent = fightDoc(play(add(row('A', 'party', { abilities: [HIT, twice], used: { [twice.id]: 2 } }), row('M', 'foe')), start(['A', 20], ['M', 10])), RULES, docCtx());
    expect(live(spent).left).toEqual({ twice: 0 });
    expect('left' in live(fightDoc(play(add(row('A', 'party'), row('M', 'foe')), start(['A', 20], ['M', 10])), RULES, docCtx()))).toBe(false);
  });

  test('a summon shows as a shadow does, with the row that owns it', () => {
    const sprite = row('S', 'party', { kind: 'summon', holder: null, owner: id('A'), until: tick(2000) });
    const doc = fightDoc(play(add(row('A', 'party'), sprite, row('M', 'foe')), start(['A', 20], ['S', 1], ['M', 10])), RULES, docCtx());
    expect(rowIn(doc, 'S')).toMatchObject({ kind: 'summon', owner: 'A', hp: HP_MAX, hpMax: HP_MAX, key: null, left: 2 });
  });

  test('a player\'s tap the kits refuse is news the table can name: a gate, uses spent, an HP price, too few stacks, no zone', () => {
    for (const r of ['gated', 'noUses', 'hp', 'stacks', 'zone'] as const) expect(TABLE_REFUSALS).toContain(r);
  });
});

describe('a hidden foe (kits design 8.7)', () => {
  test('is not in the party\'s doc, nor is its name in the log, while it hides; once seen it is back', () => {
    const veil: Status = { key: statusKey('hide'), def: { label: 'Hidden', desc: '', ops: [{ op: 'hidden', level: 1, start: 'unseen', ends: { hurt: true, revealed: true, dealt: true } }] }, source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) };
    const fight = play(add(row('A', 'party'), row('Sly', 'foe')), start(['A', 20], ['Sly', 10]));
    const hid = withBody(fight, 'Sly', { statuses: [veil] });
    expect(live(fightDoc(hid, RULES, docCtx())).rows.map(r => r.id)).toEqual(['A']);
    expect(live(fightDoc(fight, RULES, docCtx())).rows.map(r => r.id)).toEqual(['A', 'Sly']);
  });

  test('a log line is left out by the rows it is about, not by its words: a hidden Rat hides its own lines, not Ratatoskr\'s', () => {
    const veil: Status = { key: statusKey('hide'), def: { label: 'Hidden', desc: '', ops: [{ op: 'hidden', level: 1, start: 'unseen', ends: { hurt: true, revealed: true, dealt: true } }] }, source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) };
    const fight = play(add(row('A', 'party'), row('Rat', 'foe'), row('Ratatoskr', 'foe')), start(['A', 20], ['Rat', 10], ['Ratatoskr', 5]));
    const hid = { ...withBody(fight, 'Rat', { statuses: [veil] }), log: [line('Ratatoskr swings.', [id('Ratatoskr')]), line('The blast hits 2.', [id('Rat'), id('A')])] };
    expect(live(fightDoc(hid, RULES, docCtx())).log).toEqual(['Ratatoskr swings.']);
  });

  // The fog's room: a Ghoul behind the wall hides at stealth level 1. Kai has no sight content (sight 0, the rules'
  // `sightBase`); Eye holds a sight op of 2. A body that is up perceives a foe only with the foe in its own sight and its
  // own sight above the foe's level (sight.ts `perceives`, the owner, Nov 22), so one hunter must do both.
  const veil2: Status = { key: statusKey('veil'), def: { label: 'Veiled', desc: '', ops: [{ op: 'hidden', level: 1, start: 'anywhere', ends: { hurt: true, revealed: true, dealt: true } }] }, source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) };
  const eye: Status = { key: statusKey('eye'), def: { label: 'Hunter\'s Eye', desc: '', ops: [{ op: 'sheet', key: 'sight', amount: 2 }] }, source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) };
  const GAP = place(5, 4), BEHIND = place(1, 1);
  const hiddenGhoul = (kai: ReturnType<typeof place> | null, eyeAt: ReturnType<typeof place> | null, ...more: Command[]) => play({
    type: 'add', fightId: fightId('f-hide'), openings: [], grid, fog,
    rows: [
      ...(kai ? [row('Kai', 'party', { place: kai })] : []),
      ...(eyeAt ? [row('Eye', 'party', { place: eyeAt, statuses: [eye] })] : []),
      row('Ghoul', 'foe', { place: place(8, 1), statuses: [veil2] }),
    ],
  }, ...more);
  const rowsOf = (fight: Fight) => live(fightDoc(fight, RULES, docCtx())).rows.map(r => r.id);

  test('a foe hidden at level 2 is not in the doc while the only hunter who has it in sight has no sight content', () => {
    expect(rowsOf(hiddenGhoul(GAP, null))).toEqual(['Kai']);
    expect(JSON.stringify(fightDoc(hiddenGhoul(GAP, null), RULES, docCtx()))).not.toContain('Ghoul');
  });

  test('it is in the doc while a hunter with sight 2 has it in sight', () => {
    expect(rowsOf(hiddenGhoul(null, GAP))).toEqual(['Eye', 'Ghoul']);
  });

  test('it is not in the doc when the hunter with sight 2 has no line to it and the one with a line has sight 0: one body must do both', () => {
    expect(rowsOf(hiddenGhoul(GAP, BEHIND))).toEqual(['Kai', 'Eye']);
    expect(rowsOf(hiddenGhoul(BEHIND, GAP))).toEqual(['Kai', 'Eye', 'Ghoul']);
  });

  test('a hunter with sight 2 who is down brings it in no more', () => {
    expect(rowsOf(withBody(hiddenGhoul(null, GAP), 'Eye', { hp: 0 }))).toEqual(['Eye']);
  });

  test('its log lines follow it: out while no hunter perceives it, in while the hunter with sight 2 does, out again when that hunter steps back', () => {
    const lines = [line('The Ghoul creeps.', [id('Ghoul')]), line('Kai waits.', [id('Kai')])];
    const logOf = (fight: Fight) => live(fightDoc({ ...fight, log: lines }, RULES, docCtx())).log;
    const out = { type: 'place', id: id('Eye'), to: place(6, 4) } as const, back = { type: 'place', id: id('Eye'), to: BEHIND } as const;
    const behind = hiddenGhoul(GAP, BEHIND), stepped = hiddenGhoul(GAP, BEHIND, out), returned = hiddenGhoul(GAP, BEHIND, out, back);
    expect(rowsOf(stepped)).toEqual(['Kai', 'Eye', 'Ghoul']);
    expect([logOf(behind), logOf(stepped), logOf(returned)]).toEqual([['Kai waits.'], ['The Ghoul creeps.', 'Kai waits.'], ['Kai waits.']]);
  });

  test('a hidden hunter stays in the party\'s doc with its status chip', () => {
    const fight = play({ type: 'add', fightId: fightId('f-hide'), openings: [], grid, fog, rows: [row('Kai', 'party', { place: GAP, statuses: [veil2] }), row('Ghoul', 'foe', { place: place(8, 1) })] });
    const d = live(fightDoc(fight, RULES, docCtx()));
    expect(d.rows.map(r => r.id)).toEqual(['Kai', 'Ghoul']);
    expect(rowIn(d, 'Kai').statuses.map(s => s.label)).toEqual(['Veiled']);
  });
});

describe('the party\'s ready reactions (kits design 8.4.8)', () => {
  test('the doc names each armed or spent row\'s reaction (reacts), so a player\'s phone reads its own from the GM\'s fight and keeps no copy', () => {
    const fight = play(add(row('A', 'party'), row('B', 'party'), row('M', 'foe')), start(['A', 20], ['B', 15], ['M', 10]));
    const armed = withBody(withBody(fight, 'A', { armed: { ability: abilityId('parry'), on: null, spent: false } }), 'B', { armed: { ability: abilityId('stand'), on: null, spent: true } });
    const d = live(fightDoc(armed, RULES, docCtx()));
    expect([d.armed, d.spent, d.reacts]).toEqual([['A'], ['B'], { A: 'parry', B: 'stand' }]);
    expect(live(fightDoc(fight, RULES, docCtx())).reacts).toBeUndefined();
  });

  test('a teammate\'s ready reaction is named by its row, not by what it is; a spent one and a foe\'s are not', () => {
    const fight = play(add(row('A', 'party'), row('B', 'party'), row('M', 'foe')), start(['A', 20], ['B', 15], ['M', 10]));
    const parry = { ability: abilityId('parry'), on: null, spent: false };
    const armed = withBody(withBody(withBody(fight, 'A', { armed: parry }), 'B', { armed: { ...parry, spent: true } }), 'M', { armed: parry });
    expect(live(fightDoc(armed, RULES, docCtx())).armed).toEqual(['A']);
    expect(live(fightDoc(fight, RULES, docCtx())).armed).toBeUndefined();
  });

  test('a teammate whose reaction fired since its turn began is named as spent; a foe\'s is not (kits table 8.9.1)', () => {
    const fight = play(add(row('A', 'party'), row('B', 'party'), row('M', 'foe')), start(['A', 20], ['B', 15], ['M', 10]));
    const parry = { ability: abilityId('parry'), on: null, spent: true };
    const spent = withBody(withBody(fight, 'B', { armed: parry }), 'M', { armed: parry });
    expect(live(fightDoc(spent, RULES, docCtx())).spent).toEqual(['B']);
    expect(live(fightDoc(spent, RULES, docCtx())).armed).toBeUndefined();
    expect(live(fightDoc(fight, RULES, docCtx())).spent).toBeUndefined();
  });
});

describe('a threshold that went off (rule 18a)', () => {
  test('the doc carries the last command\'s bursts with their count, only of bearers the party sees', () => {
    const fight = play(add(row('A', 'party'), row('M', 'foe')), start(['A', 20], ['M', 10]));
    expect(live(fightDoc(fight, RULES, { ...docCtx(), burst: { n: 4, ids: [id('M'), id('ghost')] } })).burst).toEqual({ n: 4, ids: ['M'] });
    expect(live(fightDoc(fight, RULES, docCtx())).burst).toBeUndefined();
  });
});

describe('the fudge never reaches the table (notes-8-fudge.md section 3)', () => {
  const remote = sheetKey('d-player:h-9');
  /** P, a player's hunter on another phone, and Q, a hunter on this one, against M; the hunters at +2 and P forced to 20. */
  const weighted = (): Fight => play(add(row('P', 'party', { holder: { kind: 'remote', remote } }), row('Q', 'party'), row('M', 'foe')),
    start(['M', 20], ['P', 15], ['Q', 10]),
    { type: 'fudge', set: { kind: 'weight', scope: { kind: 'side', side: 'party' }, n: 2 } }, { type: 'fudge', set: { kind: 'force', id: id('P'), face: 20 } });
  const wire = (fight: Fight | null): string => JSON.stringify(fightWire(fightDoc(fight, RULES, docCtx())!));
  const running = (fight: Fight | null): Running => { if (fight?.phase !== 'running') throw new Error('not running'); return fight; };

  test('a weighted fight reaches the table byte for byte as the same fight unweighted with the shifted faces', () => {
    // fight A is weighted and draws its dice with its weights; fight B is A at no fudge and is sent A's commands, the
    // shifted faces in them. Whatever leaves the GM's phone (the doc on the wire, each effect: a remote hunter's
    // sendRemote, a hunter's vitals) is the same for both, so no player can tell A from an honest fight.
    const first = running(weighted()), src = seededSource(11);
    let a: Fight = first, b: Fight = { ...first, fudge: NO_FUDGE }, moved = 0, told = 0, used = 0;
    for (; a.phase === 'running' && used < 12; used++) {
      const now: Running = a, me = now.rows.find(r => r.id === now.currentId)!, aim = now.rows.find(r => r.side !== me.side && isUp(r))!;
      const n = needs(HIT, me, now.rows, aim.id, now.grid, now.now, RULES), w = weightsFor(now, me.id, n), at = src.state();
      const rolls = drawNeeds(n, src.random, w);
      if (JSON.stringify(rolls) !== JSON.stringify(drawNeeds(n, seededSource(at).random))) moved++;
      const cmd: Command = { type: 'act', by: me.id, ability: HIT.id, aim: aim.id, rolls };
      const ra = reduce(now, cmd, ctx), rb = reduce(b, cmd, ctx);
      expect(ra.effects.some(e => e.type === 'refused'), `${me.id} uses Hit on ${aim.id}`).toBe(false);
      expect(JSON.stringify(ra.effects)).toBe(JSON.stringify(rb.effects));
      told += ra.effects.filter((e: Effect) => e.type === 'sendRemote' || e.type === 'vitals').length;
      expect(wire(ra.fight)).toBe(wire(rb.fight));
      if (ra.fight?.phase === 'running' && me.id === id('P')) expect(ra.fight.fudge.forced, 'P\'s forced face was read and spent').toEqual({});
      a = ra.fight!; b = rb.fight!;
    }
    expect(used, 'the fight was played for several uses').toBeGreaterThan(2);
    expect(moved, 'the weight moved the faces the fight read').toBeGreaterThan(0);
    expect(told, 'the hunters\' sheets heard of the fight').toBeGreaterThan(0);
  });

  test('setting a fudge leaves the players\' doc equal', () => {
    // sync.ts sends nothing for a doc that says the same as the last one put (`sameDoc`, which reads the doc whole but
    // its time), so a doc equal to the letter before and after a tap betrays nothing: no put, no change of pace
    let fight: Fight = running(weighted());
    const sets: Command[] = [
      { type: 'fudge', set: { kind: 'weight', scope: { kind: 'side', side: 'foe' }, n: -4 } },
      { type: 'fudge', set: { kind: 'weight', scope: { kind: 'row', id: id('Q') }, n: 7 } },
      { type: 'fudge', set: { kind: 'force', id: id('M'), face: 1 } },
      { type: 'fudge', set: { kind: 'force', id: id('P'), face: null } },
      { type: 'fudge', set: { kind: 'weight', scope: { kind: 'side', side: 'party' }, n: 0 } },
    ];
    for (const set of sets) {
      const before = fightDoc(fight, RULES, docCtx()), r = reduce(fight, set, ctx);
      expect(r.effects).toEqual([]);
      expect(r.fight).not.toBe(fight);
      expect(JSON.stringify(fightDoc(r.fight, RULES, docCtx()))).toBe(JSON.stringify(before));
      expect(wire(r.fight)).toBe(JSON.stringify(fightWire(before!)));
      fight = r.fight!;
    }
  });
});

describe('a mythic on the table (notes-11-keystones.md, design B.3 and B.10, unit MY6)', () => {
  const RIDER = 'the-fourth-rider' as const, NAMED = 'named' as OmenKey;
  const calm = { at: 'calm', script: RIDER, phase: 1, beat: 2, since: tick(800) } as const;
  const calmDoc = { state: 'calm', script: RIDER, phase: 1, beat: 2, since: tick(800) };
  const omen = (aim: CombatantId | Place, hpAt: number) => ({ ...calm, at: 'omen', omen: NAMED, aim, hpAt, barAt: { fill: 10, max: 100 } }) as const;
  const veil: Status = { key: statusKey('hide'), def: { label: 'Hidden', desc: '', ops: [{ op: 'hidden', level: 1, start: 'unseen', ends: { hurt: true, revealed: true, dealt: true } }] }, source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) };
  const fight = play(add(row('A', 'party'), row('Rider', 'foe'), row('Sly', 'foe'), row('Rat', 'foe')), start(['A', 20], ['Rider', 10], ['Sly', 5], ['Rat', 4]));
  const through = (d: FightDoc | null) => (DOCS.fight(JSON.parse(JSON.stringify(fightWire(live(d)))) as never) as FightDoc & { ended: false }).rows;

  test('a player\'s doc carries a mythic\'s phase and its omen', () => {
    const standing = omen(id('A'), Math.floor(HP_MAX * 0.4));
    const doc = fightDoc(withBody(fight, 'Rider', { mythic: standing }), RULES, docCtx());
    const shown = rowIn(doc, 'Rider');
    expect(shown.kind === 'monster' && shown.standing).toEqual({ state: 'omen', script: RIDER, phase: 1, beat: 2, since: tick(800), omen: NAMED, aim: id('A'), band: 'bloodied' });
    expect(through(doc).find(r => r.id === 'Rider'), 'the party\'s phone reads the same standing off the wire').toEqual(shown);
    const resting = through(fightDoc(withBody(fight, 'Rider', { mythic: calm }), RULES, docCtx())).find(r => r.id === 'Rider');
    expect(resting && resting.kind === 'monster' && resting.standing).toEqual(calmDoc);
    expect(rowIn(doc, 'Rat'), 'a row that plays no script carries none').not.toHaveProperty('standing');
  });

  test('a mythic\'s HP stays off the table: the omen carries the band it was announced at, a tile aim stays a tile', () => {
    const doc = fightDoc(withBody(fight, 'Rider', { mythic: omen(place(4, 5), 123456) }), RULES, docCtx());
    const wire = JSON.stringify(fightWire(live(doc)));
    expect(wire).not.toContain('123456');
    expect(wire).not.toContain('hpAt');
    expect(wire).not.toContain('barAt');
    const shown = rowIn(doc, 'Rider');
    expect(shown.kind === 'monster' && shown.standing).toMatchObject({ aim: { x: 4, y: 5 }, band: 'healthy' });
    expect(through(doc).find(r => r.id === 'Rider'), 'a tile aim comes back as a tile').toEqual(shown);
  });

  test('an omen\'s aim on a hidden body stays off the party\'s doc', () => {
    const aimed = (sly: Fight) => withBody(sly, 'Rider', { mythic: omen(id('Sly'), HP_MAX) });
    const hid = aimed(withBody(fight, 'Sly', { statuses: [veil] }));
    const doc = fightDoc(hid, RULES, docCtx());
    expect(doc && live(doc).rows.map(r => r.id)).toEqual(['A', 'Rider', 'Rat']);
    const shown = rowIn(doc, 'Rider');
    expect(shown.kind === 'monster' && shown.standing).toMatchObject({ state: 'omen', omen: NAMED, aim: null });
    expect(JSON.stringify(fightWire(live(doc)))).not.toContain('Sly');
    const seen = rowIn(fightDoc(aimed(fight), RULES, docCtx()), 'Rider');
    expect(seen.kind === 'monster' && seen.standing).toMatchObject({ aim: id('Sly') });
  });

  test(`the doc carries at most ${DOC_MYTHICS} standings; a row past them shows as a plain monster, on the GM's phone and the player's`, () => {
    const crowd = play(add(row('A', 'party'), ...Array.from({ length: DOC_MYTHICS + 2 }, (_, i) => row(`R${i}`, 'foe', { mythic: calm }))), start(['A', 20], ...Array.from({ length: DOC_MYTHICS + 2 }, (_, i): [string, number] => [`R${i}`, 10])));
    const rows = through(fightDoc(crowd, RULES, docCtx()));
    expect(rows.filter(r => r.kind === 'monster' && r.standing).map(r => r.id)).toEqual(Array.from({ length: DOC_MYTHICS }, (_, i) => `R${i}`));
    const direct = live(fightDoc(crowd, RULES, docCtx())).rows;
    expect(direct.filter(r => r.kind === 'monster' && r.standing)).toHaveLength(DOC_MYTHICS);
  });

  test('a standing this build cannot read shows the row as a plain monster and the doc still reads', () => {
    const wire = JSON.parse(JSON.stringify(fightWire(live(fightDoc(withBody(fight, 'Rider', { mythic: omen(id('A'), HP_MAX) }), RULES, docCtx()))))) as { rows: { i: string; my?: Record<string, unknown> }[] };
    const mine = wire.rows.find(r => r.i === 'Rider')!;
    for (const bad of [{ ...mine.my, s: 'the-fifth-rider' }, { ...mine.my, o: 'nope' }, { ...mine.my, p: 'one' }, { ...mine.my, z: 9 }, { ...mine.my, z: 0 }, { ...mine.my, h: 9 }, { ...mine.my, a: 7 }, 'omen']) {
      const read = DOCS.fight({ ...wire, rows: wire.rows.map(r => r === mine ? { ...r, my: bad } : r) } as never) as FightDoc | null;
      const rider = read && live(read).rows.find(r => r.id === 'Rider');
      expect(rider, JSON.stringify(bad)).toBeDefined();
      expect(rider, JSON.stringify(bad)).not.toHaveProperty('standing');
    }
  });
});

describe('keystones on the table (notes-11-keystones.md, design A.9 and A.10, unit K7)', () => {
  const ON = withKeystones(RULES);
  const statsOf = (o: Partial<Record<'str' | 'agi' | 'vit' | 'ins' | 'dis' | 'pre' | 'pow' | 'ctl', number>> = {}) =>
    ({ str: 10, agi: 10, vit: 10, ins: 10, dis: 10, pre: 10, pow: 10, ctl: 10, ...o });
  const mkHunter = (i: number, name: string, o: Partial<RowHunter>): RowHunter => ({
    id: `h${i}`, name, stats: statsOf(), level: 70, rank: 'S', life: { at: 'up', hp: 999 }, mana: 99, fatigue: 0, penalty: null,
    hpAdj: 0, manaAdj: 0, titleId: null, titles: [], items: [], equipped: newEquipped(), skills: [],
    conditions: [], ...o,
  });
  const mkBoss: RowMonster = { name: 'Dragon', rank: 'S', archetype: 'brute', kind: 'boss', tweak: {}, abilities: [], statuses: [] };
  const wireOf = (f: Fight, R = RULES) => JSON.parse(JSON.stringify(fightWire(live(fightDoc(f, R, docCtx()))))) as Record<string, unknown>;
  const roundTrip = (f: Fight, R = RULES) => live(DOCS.fight(wireOf(f, R)) as FightDoc);

  test('with RULES.fight.keystone.on off, a fight doc carries no keystone statuses and produces the same wire output as before', () => {
    expect(RULES.fight.keystone.on).toBe(false);
    const focused = hunterRow(mkHunter(1, 'Fighter', { stats: statsOf({ str: 70, vit: 50 }), job: 'Fighter', jobDone: 'Fighter' }), id('c1'), RULES);
    const spread = hunterRow(mkHunter(1, 'Fighter', { stats: statsOf({ str: 25, agi: 25, vit: 25, ins: 25, dis: 25, pre: 25, pow: 25, ctl: 25 }), job: 'Fighter', jobDone: 'Fighter' }), id('c1'), RULES);
    const boss = monsterRows(mkBoss, [id('m1')], RULES);
    const fFocused = reduce(null, { type: 'add', fightId: fightId('f-off'), rows: [focused, ...boss], openings: [] }, { rules: RULES }).fight!;
    const fSpread = reduce(null, { type: 'add', fightId: fightId('f-off'), rows: [spread, ...boss], openings: [] }, { rules: RULES }).fight!;
    const wFocused = wireOf(fFocused, RULES), wSpread = wireOf(fSpread, RULES);
    expect(wFocused).not.toHaveProperty('defs');
    expect((wFocused.rows as Record<string, unknown>[]).every(r => !('st' in r))).toBe(true);
    // Strip the hunter's stat-derived HP/speed differences and check the wire structure has no keystone fields
    const clearStats = (w: Record<string, unknown>) => ({ ...w, rows: (w.rows as Record<string, unknown>[]).map(({ h: _h, hm: _hm, v: _v, r: _r, m: _m, ...rest }) => rest) });
    expect(JSON.stringify(clearStats(wFocused))).toBe(JSON.stringify(clearStats(wSpread)));
  });

  test('a player\'s phone receives every keystone chip with its full def for a 4-hunter S-rank awakened party while an S-rank boss holds none', () => {
    const party = [
      hunterRow(mkHunter(1, 'Fighter', { stats: statsOf({ str: 70, vit: 50 }), job: 'Fighter', jobDone: 'Fighter' }), id('c1'), ON),
      hunterRow(mkHunter(2, 'Assassin', { stats: statsOf({ agi: 70, ins: 50 }), job: 'Assassin', jobDone: 'Assassin' }), id('c2'), ON),
      hunterRow(mkHunter(3, 'Mage', { stats: statsOf({ pow: 70, ctl: 50 }), job: 'Mage', jobDone: 'Mage' }), id('c3'), ON),
      hunterRow(mkHunter(4, 'Healer', { stats: statsOf({ dis: 70, pre: 50 }), job: 'Healer', jobDone: 'Healer' }), id('c4'), ON),
    ];
    const boss = monsterRows(mkBoss, [id('m1')], ON);
    const f = reduce(null, { type: 'add', fightId: fightId('f-ks'), rows: [...party, ...boss], openings: [] }, { rules: ON }).fight!;
    const doc = live(fightDoc(f, ON, docCtx()));
    const wire = wireOf(f, ON);
    const read = live(DOCS.fight(wire) as FightDoc);
    expect(wire, 'shipped keystone defs take 0 bytes in wire.defs').not.toHaveProperty('defs');
    expect(read).toEqual(doc);
    expect(rowIn(read, 'm1').statuses, 'an S-rank boss holds no keystones').toEqual([]);
    const totalChips = read.rows.reduce((n, r) => n + r.statuses.length, 0);
    expect(totalChips).toBe(18);
    expect(read.rows.every(r => r.statuses.every(s => s.def !== undefined))).toBe(true);
    // Server stores DOCS.fight(wire) and re-wires it on GET: verify idempotence
    expect(JSON.stringify(fightWire(read))).toBe(JSON.stringify(wire));
  });

  test('keystone child statuses applied in a fight round-trip with their full def and take no room in wire defs', () => {
    const surgeTrigger = keystoneOf({ tier: 'mark', stat: 'pow' }, RULES).worn!.triggers![0]!.ops[0]!;
    const hobbledTrigger = keystoneOf({ tier: 'confluence', pair: 'agi+ctl' }, RULES).worn!.triggers![0]!.ops[0]!;
    const undyingOps = keystoneOf({ tier: 'apex', stat: 'vit' }, RULES).worn!.triggers![0]!.ops;
    if (surgeTrigger.op !== 'applyStatus' || hobbledTrigger.op !== 'applyStatus') throw new Error('expected applyStatus');
    const surgingOp = 'stack' in surgeTrigger.def && surgeTrigger.def.stack?.threshold?.ops[0];
    const mendingOp = undyingOps[1];
    if (!surgingOp || surgingOp.op !== 'applyStatus' || !mendingOp || mendingOp.op !== 'applyStatus') throw new Error('expected child applyStatus');

    const childStatus = (key: Status['key'], def: StatusDef, stacks?: number): Status =>
      statusOn(def, { key, source: { id: id('A'), tier: 5 }, until: null, since: tick(0), settledAt: tick(0) }, stacks);
    const base = play(add(row('A', 'party'), row('M', 'foe')), start(['A', 20], ['M', 10]));
    const withChildren = withBody(base, 'A', {
      statuses: [
        childStatus(surgeTrigger.key, surgeTrigger.def, 3),
        childStatus(surgingOp.key, surgingOp.def),
        childStatus(hobbledTrigger.key, hobbledTrigger.def, 2),
        childStatus(mendingOp.key, mendingOp.def),
      ],
    });
    // Also check after parseFight, which reorders `when` and `then` keys on these defs
    const reloaded = parseFight(JSON.parse(JSON.stringify(withChildren)), RULES)!;
    for (const f of [withChildren, reloaded]) {
      const doc = live(fightDoc(f, RULES, docCtx()));
      const wire = wireOf(f, RULES);
      expect(wire, 'child keystone defs omit wire.defs even after parseFight key reordering').not.toHaveProperty('defs');
      const read = live(DOCS.fight(wire) as FightDoc);
      expect(read).toEqual(doc);
      expect(JSON.stringify(fightWire(read))).toBe(JSON.stringify(wire));
    }
  });

  test('a GM override that changes a keystone\'s numbers still ships the full def in wire defs', () => {
    const altRound = withKeystones({ ...RULES, fight: { ...RULES.fight, round: 2000 } });
    const insHunter = hunterRow(mkHunter(1, 'Scout', { stats: statsOf({ ins: 70 }), rank: 'D' }), id('c1'), altRound);
    const f = reduce(null, { type: 'add', fightId: fightId('f-ov'), rows: [insHunter], openings: [] }, { rules: altRound }).fight!;
    const wire = wireOf(f, altRound) as { defs?: Record<string, StatusDef>; rows: { st?: Record<string, unknown>[] }[] };
    const read = roundTrip(f, altRound);
    expect(wire.defs && Object.keys(wire.defs), 'overridden round duration ships in wire.defs, not by key alone').toEqual(['read-the-opening']);
    const triggerOp = read.rows[0]!.statuses[0]!.def!.triggers![0]!.ops[0]!;
    expect(triggerOp.op === 'applyStatus' && triggerOp.duration).toBe(tick(2000));

    // A GM custom status under a keystone's key shadows the shipped keystone when it fits, and never borrows it when defs is full
    const gmMomentum: StatusDef = { label: 'Momentum', desc: 'GM custom version.', ops: [{ op: 'speed', pct: 50 }] };
    const shippedMomentum = keystoneOf({ tier: 'confluence', pair: 'str+agi' }, RULES).worn!;
    const momentumKey = freeStatusKey(shippedMomentum.label, () => false);
    const base = play(add(row('A', 'party'), row('B', 'party'), row('M', 'foe')), start(['A', 20], ['B', 15], ['M', 10]));
    const shadowed = withBody(withBody(base, 'A', { statuses: [statusOn(gmMomentum, { key: momentumKey, source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) })] }),
      'B', { statuses: [statusOn(shippedMomentum, { key: momentumKey, source: { id: id('B'), tier: 5 }, until: null, since: tick(0), settledAt: tick(0), worn: true })] });
    const shadowWire = wireOf(shadowed, RULES) as { defs?: Record<string, StatusDef> };
    const shadowRead = roundTrip(shadowed, RULES);
    expect(shadowWire.defs?.[momentumKey]).toEqual(gmMomentum);
    expect(rowIn(shadowRead, 'A').statuses[0]!.def).toEqual(gmMomentum);
    expect(rowIn(shadowRead, 'B').statuses[0]!.def, 'shadowed row carries inline label rather than the GM custom def').toBeUndefined();

    // When wire.defs is full (12 fillers of 496 bytes = 5,954 of 6,000), a GM custom status under a keystone key cannot fit, sends inline b, and reads with def === undefined
    const pad = (i: number): StatusDef => ({ label: `Fill ${String(i).padStart(2, '0')}`, desc: 'd'.repeat(450), ops: [] });
    const fillers = Array.from({ length: 12 }, (_, i): Status => statusOn(pad(i), { key: statusKey(`fill-${String(i).padStart(2, '0')}`), source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) }));
    const crowded = withBody(withBody(base, 'A', { statuses: fillers }),
      'B', { statuses: [statusOn(gmMomentum, { key: momentumKey, source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) })] });
    const crowdedWire = wireOf(crowded, RULES) as { defs?: Record<string, StatusDef> };
    expect(crowdedWire.defs && Object.hasOwn(crowdedWire.defs, momentumKey), 'gmMomentum overflowed wire.defs').toBe(false);
    const crowdedRead = roundTrip(crowded, RULES);
    expect(rowIn(crowdedRead, 'B').statuses[0]!.def, 'overflowed custom status never borrows the shipped keystone def').toBeUndefined();
    expect(rowIn(crowdedRead, 'B').statuses[0]!.label).toBe('Momentum');
  });
});

describe('dodge prompt in the fight doc', () => {
  const BLAST = abilityOf('blast', { id: abilityId('fireball'), name: 'Fireball' }, RULES);
  const blast = { ...BLAST, range: tiles(20), delivery: { kind: 'travel' as const, windup: tick(1200), speed: 'instant' as const } };

  test('round-trips through fightWire and DOCS.fight, and shows earlier dodger at its chosen tile for the next hunter', () => {
    const f0 = play(
      add(row('A', 'party', { place: place(5, 5) }), row('B', 'party', { place: place(6, 5) }), row('M', 'foe', { place: place(1, 5), abilities: [blast] })),
      start(['A', 1], ['B', 1], ['M', 20]),
    );
    const f1 = reduce(f0, { type: 'act', by: id('M'), ability: blast.id, aim: place(5, 5), rolls: { dice: { A: [4], B: [4] } as never, react: { A: 20, B: 20 } as never } }, ctx).fight!;
    const d1 = live(fightDoc(f1, RULES, docCtx()));
    expect(d1.dodge).toBeDefined();
    expect(d1.dodge!.n).toBe(1);
    expect(d1.dodge!.who).toBe(id('A'));
    expect(d1.dodge!.by).toBe(id('M'));
    expect(d1.dodge!.ability).toBe('Fireball');
    expect(d1.dodge!.mode).toBe('out');
    expect(d1.dodge!.reach).toBeGreaterThan(0);
    expect(d1.dodge!.left).toBeGreaterThan(0);
    const md1 = docDodge(d1)!;
    expect(md1.tiles.length).toBeGreaterThanOrEqual(2);
    const w1 = JSON.parse(JSON.stringify(fightWire(d1)));
    expect(DOCS.fight(w1)).toEqual(d1);

    // Hunter A picks its auto tile; Hunter B's doc now shows Hunter A at that chosen tile and excludes it from B's tiles
    const pickA = place(d1.dodge!.auto.x, d1.dodge!.auto.y);
    const f2 = reduce(f1, { type: 'dodge', id: id('A'), to: pickA }, ctx).fight!;
    const d2 = live(fightDoc(f2, RULES, docCtx()));
    expect(d2.dodge!.n).toBe(2);
    expect(d2.dodge!.who).toBe(id('B'));
    expect(rowIn(d2, 'A').place).toEqual({ x: pickA.x, y: pickA.y });
    const md2 = docDodge(d2)!;
    expect(md2.tiles.some(t => t.place.x === pickA.x && t.place.y === pickA.y)).toBe(false);
    expect(DOCS.fight(JSON.parse(JSON.stringify(fightWire(d2))))).toEqual(d2);
  });

  test('partyDodge and docDodge agree on offered tiles, mode, and auto on a fogged map with unlit terrain and hidden foes', () => {
    const w = 14, h = 10;
    const gridTiles: Terrain[] = Array.from({ length: w * h }, (_, i) => {
      const x = i % w, y = Math.floor(i / w);
      if (x === 7 && y >= 2 && y <= 7) return 'wall';
      if (x === 8 && y === 5) return 'pit';
      if (x === 6 && y === 4) return 'rough';
      return 'floor';
    });
    const grid: Grid = { w, h, tiles: gridTiles };
    const cloak = statusOn(
      { label: 'Hidden', desc: '', ops: [{ op: 'hidden', level: 3, start: 'anywhere', ends: { hurt: true, revealed: true, dealt: true } }] },
      { key: statusKey('cloak'), source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) },
    );
    const fog = { sight: tiles(4), seen: '0'.repeat(w * h) };
    const foeBlast = { ...blast, foesOnly: true };
    const f0 = play(
      {
        type: 'add', fightId: fightId('f-fog-dodge'), grid, fog, openings: [],
        rows: [
          row('A', 'party', { place: place(5, 5) }),
          row('M', 'foe', { place: place(2, 5), abilities: [foeBlast] }),
          row('H', 'foe', { place: place(4, 5), statuses: [cloak] }),
        ],
      },
      start(['A', 1], ['M', 20], ['H', 1]),
    );
    const f1 = reduce(f0, { type: 'act', by: id('M'), ability: foeBlast.id, aim: place(5, 5), rolls: { dice: { A: [4] } as never, react: { A: 20 } as never } }, ctx).fight!;
    const raw = live(fightDoc(f1, RULES, docCtx()));
    const d = DOCS.fight(JSON.parse(JSON.stringify(fightWire(raw)))) as Extract<FightDoc, { ended: false }>;
    expect(d.dodge).toBeDefined();
    const md = docDodge(d)!;
    const cover = {
      hit: tilesOfRuns(d.dodge!.hit, d.grid.w * d.grid.h).map(i => place(i % d.grid.w, Math.floor(i / d.grid.w))),
      ring: tilesOfRuns(d.dodge!.ring, d.grid.w * d.grid.h).map(i => place(i % d.grid.w, Math.floor(i / d.grid.w))),
    };
    const shared = docDodgeOptions(d.grid, d.rows, d.dodge!.who, tiles(d.dodge!.reach), cover)!;
    expect(d.dodge!.mode).toBe(shared.auto.avoid);
    expect(d.dodge!.auto).toEqual(shared.auto.place);
    expect(md.mode).toBe(d.dodge!.mode);
    expect(md.auto).toEqual(d.dodge!.auto);
    expect(md.tiles).toEqual(shared.tiles);
    // Unseen tiles behind the wall at x=7 are masked as UNSEEN ('?') in the doc grid (read as floor by gridOfDoc), so neither partyDodge nor docDodge leaks the unlit pit at (8,5)
    expect(d.grid.lit![5 * w + 8]).toBe('0');
    expect(d.grid.tiles![5 * w + 8]).toBe('?');
  });

  test('the largest shipped dodgeable blast fits hit and ring runs within DOC_DODGE_RUNS on a 40x40 grid without truncation', () => {
    // Check every dodgeable shipped mythic blast and every shipped monster blast at center of a 40x40 grid
    const bigGrid = openGrid(40, 40), center = place(20, 20);
    const blasts: { name: string; radius: number; outer: number | null }[] = [];
    for (const sid of MYTHIC_IDS) {
      for (const [, mv] of movesOf(mythicScriptOf(sid))) {
        if (mv.kind === 'blast' && !mv.sure && typeof mv.reach === 'number') blasts.push({ name: mv.name, radius: mv.reach, outer: mv.reach + 1 });
      }
    }
    for (const m of seedMonsters(RULES)) {
      for (const a of m.abilities) {
        if (a.delivery.kind === 'travel' && a.shape.kind === 'radius') blasts.push({ name: `${m.name}:${a.name}`, radius: a.shape.radius, outer: a.shape.ring?.outer ?? null });
      }
    }
    expect(blasts.length).toBeGreaterThan(0);
    const maxRadius = Math.max(...blasts.map(b => b.radius));
    expect(maxRadius).toBeGreaterThanOrEqual(4); // The First Breath (radius 4, ring 5)

    for (const b of blasts) {
      const shape = { kind: 'radius' as const, radius: tiles(b.radius), ring: b.outer === null ? null : { outer: tiles(b.outer), share: percent(50) } };
      const bigBlast = { ...blast, range: tiles(30), shape };
      const f0 = play(
        {
          type: 'add', fightId: fightId('f-big-blast'), grid: bigGrid, openings: [],
          rows: [row('A', 'party', { place: center }), row('M', 'foe', { place: place(5, 20), abilities: [bigBlast] })],
        },
        start(['A', 1], ['M', 20]),
      );
      const f1 = reduce(f0, { type: 'act', by: id('M'), ability: bigBlast.id, aim: center, rolls: { dice: { A: [4] } as never, react: { A: 20 } as never } }, ctx).fight!;
      const doc = live(fightDoc(f1, RULES, docCtx()));
      expect(doc.dodge, b.name).toBeDefined();
      const expected = tilesOf(shape, place(5, 20), center, bigGrid);
      expect(doc.dodge!.hit.length, `${b.name} hit runs fit DOC_DODGE_RUNS`).toBeLessThanOrEqual(DOC_DODGE_RUNS);
      expect(doc.dodge!.ring.length, `${b.name} ring runs fit DOC_DODGE_RUNS`).toBeLessThanOrEqual(DOC_DODGE_RUNS);
      expect(tilesOfRuns(doc.dodge!.hit, 1600).length, `${b.name} hit untruncated`).toBe(expected.hit.length);
      expect(tilesOfRuns(doc.dodge!.ring, 1600).length, `${b.name} ring untruncated`).toBe(expected.ring.length);
    }
  });
});
