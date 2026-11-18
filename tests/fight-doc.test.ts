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
import { place, tiles } from '../src/core/combat/space.ts';
import type { Side } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { abilityId, combatantId, hunterId } from '../src/core/combat/ability-types.ts';
import { parseSheetKey } from '../src/core/ids.ts';
import { modified, shadowId, statusKey } from '../src/core/combat/effect-ops.ts';
import type { Body, Origin, StackDef, Status } from '../src/core/combat/effect-ops.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { fightId, line, reduce } from '../src/core/combat/fight.ts';
import type { Command, Ctx, Fight, NewRow } from '../src/core/combat/fight.ts';
import { DOC_ROWS, TABLE_REFUSALS, band, fightDoc, fightWire } from '../src/core/combat/fight-doc.ts';
import type { DocContext, FightDoc, FightDocRow } from '../src/core/combat/fight-doc.ts';
import type { DeviceId, SheetKey } from '../src/core/ids.ts';
const sheetKey = (s: string) => parseSheetKey(s) ?? (() => { throw new Error(`not a sheet key: ${s}`); })();

const ctx: Ctx = { rules: RULES, life: () => null };
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

function row(name: string, side: Side, o: Partial<NewRow> = {}): NewRow {
  const kind = o.kind ?? (side === 'party' ? 'hunter' : 'monster');
  return {
    id: id(name), name, side, kind, origin, tier: 0, place: null, hp: HP_MAX, mana: 10, fatigue: 0, shield: null, stagger: null, channel: null,
    threat: kind === 'monster' ? {} : null, statuses: [], readyAt: {}, abilities: [HIT, SLAM], intent: null,
    holder: kind === 'hunter' ? { kind: 'local', hunterId: hunterId(`h-${name}`) } : null, xp: 0, ...o,
  };
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
const withBody = (fight: Fight, name: string, change: Partial<Body>): Fight => ({ ...fight, rows: fight.rows.map(r => r.id === name ? { ...r, ...change } : r) });

describe('the band a player sees for HP they may not see', () => {
  test('above 75% is healthy, above 50% wounded, above 25% bloodied, any HP left critical, and 0 down', () => {
    const at = [100, 76, 75, 51, 50, 26, 25, 1, 0].map(hp => band(hp, 100));
    expect(at).toEqual(['healthy', 'healthy', 'wounded', 'wounded', 'bloodied', 'bloodied', 'critical', 'critical', 'down']);
  });

  test('a hunter and a shadow show their exact HP; a monster shows only its band', () => {
    const shadow = row('S', 'party', { kind: 'shadow', hp: 10, holder: { kind: 'shadow', hunterId: hunterId('h-A'), shadowId: shadowId('s-1') } });
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
    expect(rowIn(doc, 'M')).toMatchObject({ at: 500, speed: 100, down: false });
    expect(rowIn(doc, 'B')).toMatchObject({ band: 'down', down: true });
  });

  test('a row shows its live statuses with the rounds left to one decimal, at most 12, and a live shield\'s amount', () => {
    const many = Array.from({ length: 13 }, (_, i) => st(`s${i}`, null));
    const fight = play(add(row('A', 'party'), row('M', 'foe')), start(['A', 20], ['M', 10]));
    const timed = withBody(fight, 'A', { statuses: [st('burning', 2500, 'Burning'), st('marked', null, 'Marked'), st('gone', 0)], shield: { amount: 12, until: tick(2000) } });
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
    const shadow = row('S', 'party', { kind: 'shadow', holder: { kind: 'shadow', hunterId: hunterId('h-A'), shadowId: shadowId('s-1') } });
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
      ...Array.from({ length: 4 }, (_, i) => named(`shadow-${i}`, 'party', { kind: 'shadow', holder: { kind: 'shadow', hunterId: hunterId('h-1'), shadowId: shadowId(`s-${i}`) } })),
      ...Array.from({ length: 12 }, (_, i) => named(`monster-${i}`, 'foe', { stagger: { fill: 123.456, max: 987.654, hit: 35 } })),
    ];
    const fight = play(add(...rows), start(...rows.map(r => [r.id, 10] as [string, number])));
    const full = {
      ...fight, log: Array.from({ length: 5 }, () => line('y'.repeat(300))),
      rows: fight.rows.map(r => ({ ...r, shield: { amount: 99999, until: tick(99999) }, intent: r.kind === 'monster' ? { ability: SLAM.id, aim: place(19, 13), revealed: true } : null })),
    };
    const doc = live(fightDoc(full, RULES, docCtx()));
    expect(doc.rows).toHaveLength(20);
    expect(doc.rows.every(r => r.statuses.length === 6)).toBe(true);
    expect(JSON.stringify(doc).length).toBeLessThan(DOC_MAX / 2);
  });
});

describe('the party\'s view: a fog of war (design 5.3)', () => {
  // A wall down the middle with a gap at the bottom; Kai on the left, a Ghoul behind the wall with burning ground under it.
  const ROOM = ['.....#....', '.....#....', '.....#....', '.....#....', '..........'];
  const grid = { w: 10, h: 5, tiles: ROOM.join('').split('').map(c => (c === '#' ? 'wall' : 'floor') as 'wall' | 'floor') };
  const fog = { sight: tiles(25), seen: '0'.repeat(50) };
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
    const veil: Status = { key: statusKey('hide'), def: { label: 'Hidden', desc: '', ops: [{ op: 'hidden' }] }, source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) };
    const fight = play(add(row('A', 'party'), row('Sly', 'foe')), start(['A', 20], ['Sly', 10]));
    const hid = withBody(fight, 'Sly', { statuses: [veil] });
    expect(live(fightDoc(hid, RULES, docCtx())).rows.map(r => r.id)).toEqual(['A']);
    expect(live(fightDoc(fight, RULES, docCtx())).rows.map(r => r.id)).toEqual(['A', 'Sly']);
  });

  test('a log line is left out by the rows it is about, not by its words: a hidden Rat hides its own lines, not Ratatoskr\'s', () => {
    const veil: Status = { key: statusKey('hide'), def: { label: 'Hidden', desc: '', ops: [{ op: 'hidden' }] }, source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) };
    const fight = play(add(row('A', 'party'), row('Rat', 'foe'), row('Ratatoskr', 'foe')), start(['A', 20], ['Rat', 10], ['Ratatoskr', 5]));
    const hid = { ...withBody(fight, 'Rat', { statuses: [veil] }), log: [line('Ratatoskr swings.', [id('Ratatoskr')]), line('The blast hits 2.', [id('Rat'), id('A')])] };
    expect(live(fightDoc(hid, RULES, docCtx())).log).toEqual(['Ratatoskr swings.']);
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
