// The mythics' scripts (src/core/registry/mythics.ts; notes-11-keystones.md, design B.3, B.4 and B.6). Every test here
// but the per-script ones loops over `MYTHICS`, so a new script is checked with no edit. A new mythic copies one of the
// per-script tests (at the end) to state its own shape from its own words, played on the reducer.
import { fightId } from '../src/core/ids.ts';
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import type { Rules } from '../src/core/rules.ts';
import { parseOverrides } from '../src/core/overrides.ts';
import { average } from '../src/core/formula.ts';
import { kitGear, monsterSheet, monsterStats, pointsAt, sheetOf, split } from '../src/core/hunter/derive.ts';
import { isStatusKey } from '../src/core/combat/effect-ops.ts';
import { formulaOf } from '../src/core/registry/ability-kinds.ts';
import { SAMPLE_WEARER } from '../src/core/registry/items.ts';
import { MYTHICS, MYTHIC_IDS, bandOf, movesOf, mythicScriptOf, omensOf } from '../src/core/registry/mythics.ts';
import type { MythicScriptId } from '../src/core/registry/mythics.ts';
import { mythicMove } from '../src/core/registry/mythic-moves.ts';
import type { MythicBody } from '../src/core/registry/mythic-moves.ts';
import { monsterScript, seedMonsters, statBlock, tweakOfMonster } from '../src/core/registry/monsters.ts';
import type { MoveKey, Omen, MythicMove, MythicScript, MythicStatus, OmenKey } from '../src/core/combat/mythic-types.ts';
import { ANSWERS, answerOutcome } from '../src/core/combat/mythic.ts';
import { abilityId, combatantId, hunterId } from '../src/core/combat/ability-types.ts';
import { modified, statusKey } from '../src/core/combat/effect-ops.ts';
import type { Body, Origin, Status } from '../src/core/combat/effect-ops.ts';
import { reduce, runningState } from '../src/core/combat/fight.ts';
import type { Command, Ctx, Effect, Fight, NewRow, Running } from '../src/core/combat/fight.ts';
import { omenMove, omenNeeds } from '../src/core/combat/fight-turn.ts';
import type { Rolls } from '../src/core/combat/resolve.ts';
import { isUp, rowHp } from '../src/core/combat/row-hp.ts';
import { monsterRows } from '../src/core/combat/rows.ts';
import { openGrid, place, tiles } from '../src/core/combat/space.ts';
import type { Place } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { baseStats } from '../src/core/stats.ts';

const SCRIPTS = MYTHIC_IDS.map(id => [id, mythicScriptOf(id)] as const);
const SEEDS = seedMonsters(RULES);
const B = RULES.fight.mythic.bounds;
const within = (n: number, [least, most]: readonly number[]): boolean => n >= least! && n <= most!;
/** Every omen a rotation of the script names: its phases' and its enraged one's. */
const beatsOf = (s: MythicScript) => [...s.phases.flatMap(p => p.rotation), ...s.enraged].flatMap(b => (b.kind === 'omen' ? [b.omen] : []));
const entryOf = (s: MythicScript, key: string): readonly [MoveKey, MythicMove] | undefined => movesOf(s).find(([k]) => k === key);
const moveOf = (s: MythicScript, key: string): MythicMove | undefined => entryOf(s, key)?.[1];

/**
 * Whether the party can answer an omen (design B.4): one of its interrupt, stagger or burst answers does something, or
 * its move can be walked out of (its reach is not the whole field) or dodged (it is not sure).
 */
function answerable(s: MythicScript, o: Omen): boolean {
  const full = moveOf(s, o.full)!;
  return ANSWERS.some(how => answerOutcome(o, how) !== 'none' && (how !== 'interrupt' || o.interrupt.by.length > 0))
    || full.reach !== 'field' || !full.sure;
}

/** The body a script's moves are sized on: each seed that plays it, and `plain` on the bare S mythic brute. */
function bodiesOf(id: MythicScriptId): MythicBody[] {
  const seeds = SEEDS.filter(m => monsterScript(m) === id).map(m => ({ rank: m.rank, archetype: m.archetype, kind: m.kind, tweak: tweakOfMonster(m.tweak) }));
  const bare = statBlock(RULES, 'S', { kind: 'mythic' });
  return seeds.length ? seeds : [{ rank: bare.rank, archetype: bare.archetype, kind: bare.kind, tweak: tweakOfMonster(bare.tweak) }];
}

test('every script\'s phases fall in HP from full', () => {
  for (const [id, s] of SCRIPTS) {
    const bands = s.phases.map((_, i) => bandOf(s, i));
    expect([id, bands[0]!.from], 'the first phase begins at full HP').toEqual([id, 1]);
    for (const [i, b] of bands.entries()) {
      expect([id, i, b.gate <= b.from], 'a phase is held at or under where it began').toEqual([id, i, true]);
      if (i > 0) expect([id, i, b.from === bands[i - 1]!.gate], 'each phase begins at the gate of the one before').toEqual([id, i, true]);
    }
    const froms = s.phases.flatMap(p => (p.ends === 'gate' ? [p.from] : []));
    expect([id, froms.every((f, i) => i === 0 || f < froms[i - 1]!)], 'each gate phase begins lower than the one before').toEqual([id, true]);
  }
});

test('a clock phase holds no band of HP', () => {
  for (const [id, s] of SCRIPTS) for (const [i, p] of s.phases.entries()) {
    if (p.ends !== 'clock') continue;
    const b = bandOf(s, i);
    expect([id, p.name, 'from' in p, b.from === b.gate], 'it writes no start of its own and begins at its gate').toEqual([id, p.name, false, true]);
  }
  const zaratan = mythicScriptOf('zaratan-the-island-that-wakes');
  expect(zaratan.phases[1]!.name).toBe('The Dive');
  expect(bandOf(zaratan, 1), 'the Dive stays where the Shore was held, 55% of its max HP').toEqual({ from: 0.55, gate: 0.55 });
});

test('the last phase ends at 0 HP', () => {
  for (const [id, s] of SCRIPTS) {
    const last = s.phases.length - 1;
    expect([id, s.phases[last]!.ends, bandOf(s, last).gate]).toEqual([id, 'gate', 0]);
  }
});

test('every omen lands moves its script holds', () => {
  for (const [id, s] of SCRIPTS) {
    const moves = movesOf(s).map(([k]) => k), omens = omensOf(s).map(([k]) => k as string);
    for (const [key, o] of omensOf(s)) expect([id, key, moves.includes(o.full), o.weak === null || moves.includes(o.weak)]).toEqual([id, key, true, true]);
    for (const named of beatsOf(s)) expect([id, named, omens.includes(named)], 'each omen beat names an omen of the script').toEqual([id, named, true]);
  }
});

test('an omen that can be weakened has a weak move', () => {
  for (const [id, s] of SCRIPTS) for (const [key, o] of omensOf(s)) {
    const weakens = ANSWERS.some(how => answerOutcome(o, how) === 'weaken');
    if (weakens) expect([id, key, o.weak !== null]).toEqual([id, key, true]);
  }
});

test('only an omen that lands a blast at a hunter\'s tile is answered by leaving the tile (decision 43)', () => {
  // a curse aims at its hunter, not the tile it stood on; an omen aimed at the mythic itself the type holds at none
  for (const [id, s] of SCRIPTS) for (const [key, o] of omensOf(s)) {
    if (o.step !== 'none') expect([id, key, moveOf(s, o.full)!.kind]).toEqual([id, key, 'blast']);
  }
});

test('every omen in a phase can be answered, and only a doom cannot', () => {
  const unanswerable = (s: MythicScript): OmenKey[] => omensOf(s).filter(([, o]) => !answerable(s, o)).map(([k]) => k);
  expect(unanswerable(MYTHICS.plain), 'plain\'s Overwhelm is a field move that is sure and has no answer: the check sees a doom').toEqual(['overwhelm' as OmenKey]);
  for (const [id, s] of SCRIPTS) {
    const dooms = unanswerable(s);
    for (const [i, p] of s.phases.entries()) for (const b of p.rotation) {
      if (b.kind === 'omen') expect([id, i, b.omen, dooms.includes(b.omen)]).toEqual([id, i, b.omen, false]);
    }
  }
});

test('no act shares a name with a move', () => {
  for (const [id, s] of SCRIPTS) {
    const moves = new Set(movesOf(s).map(([, m]) => m.name));
    const acts = s.phases.flatMap(p => (p.acts === 'every' ? [] : p.acts));
    expect([id, acts.filter(a => moves.has(a))]).toEqual([id, []]);
    for (const m of SEEDS.filter(x => monsterScript(x) === id)) {
      expect([m.name, m.abilities.filter(a => moves.has(a.name)).map(a => a.name)], 'a seed lists a move of its script only as the script\'s').toEqual([m.name, []]);
    }
  }
});

test('no seed\'s ability id starts as a move\'s does, so a move is never mistaken for one', () => {
  expect(SEEDS.flatMap(m => m.abilities.map(a => a.id)).filter(a => a.startsWith('mythic-'))).toEqual([]);
});

test('every script is within the mythic bounds', () => {
  const statuses = (s: MythicScript): MythicStatus[] => [...s.phases.flatMap(p => p.worn), ...movesOf(s).flatMap(([, m]) => (m.self ? [m.self] : []))];
  for (const [id, s] of SCRIPTS) {
    expect([id, 'phases', within(s.phases.length, B.phases)]).toEqual([id, 'phases', true]);
    for (const p of s.phases) expect([id, p.name, 'clock', within(p.clock, B.clock), p.bar > 0]).toEqual([id, p.name, 'clock', true, true]);
    for (const [key, m] of movesOf(s)) expect([id, key, 'hits', within(m.hits, B.hits)]).toEqual([id, key, 'hits', true]);
    expect([id, s.hp > 0]).toEqual([id, true]);
    for (const st of statuses(s)) expect([id, st.key, isStatusKey(st.key) && st.key.startsWith('mythic-')], 'a status of a script has a key no hunter\'s cure names by chance').toEqual([id, st.key, true]);
  }
});

test('each move deals its share of an S hunter\'s HP', () => {
  // The sample S hunter: the item maker's sample wearer (2:1 Agility and Strength, the medium kit) at rank S's first level.
  const level = RULES.rankLevels.S, stats = split(SAMPLE_WEARER.main, SAMPLE_WEARER.second, pointsAt(level, RULES), RULES);
  const hpS = sheetOf({ stats, level, gear: kitGear(SAMPLE_WEARER.kit, RULES), perks: {} }, RULES).hpMax;
  for (const id of MYTHIC_IDS) for (const body of bodiesOf(id)) for (const [key, m] of movesOf(mythicScriptOf(id))) {
    const a = mythicMove(key, m, body, RULES);
    if (m.hits === 0) { expect([id, key, a.effect]).toEqual([id, key, null]); continue; }
    const self = { stats: monsterStats(body.rank, body.archetype, RULES, body.tweak), sheet: monsterSheet(body.rank, body.archetype, body.kind, RULES, [], body.tweak) };
    const mean = average(formulaOf(a, RULES)!, { user: self, target: self, charge: 0 });
    expect([id, body.archetype, key, Math.abs(mean / (m.hits * hpS) - 1) <= 0.1], `${m.name}: ${mean} against ${m.hits} of ${hpS}`).toEqual([id, body.archetype, key, true]);
  }
});

test('a mythic of any body plays plain with no gap in its guard: its armor and resist are each the mean of the two', () => {
  // A brute's medium kit and Vitality split its guard; a mythic's guard is one, so bolts and blades meet the same wall.
  const ON: Rules = { ...RULES, fight: { ...RULES.fight, mythic: { ...RULES.fight.mythic, scripts: true } } };
  for (const archetype of ['brute', 'caster', 'skirmisher'] as const) {
    const bare = monsterSheet('S', archetype, 'mythic', RULES), mean = (bare.armor + bare.resist) / 2;
    const row = monsterRows({ name: 'A Mythic', rank: 'S', archetype, kind: 'mythic', tweak: {}, abilities: [], statuses: [], script: 'plain' }, [combatantId('m')], ON)[0]!;
    const { sheet } = modified(row.origin, row.statuses, ON);
    expect([archetype, Math.abs(sheet.armor - mean) <= 0.5, Math.abs(sheet.resist - mean) <= 0.5], `armor ${sheet.armor}, resist ${sheet.resist}, bare ${bare.armor} and ${bare.resist}`).toEqual([archetype, true, true]);
  }
  // Zaratan, a brute, wears Even Guard under its Shell (+15 armor, +15 resist): both sit 15 above the bare mean
  const zaratan = SEEDS.find(m => m.script === 'zaratan-the-island-that-wakes')!, bare = monsterSheet('S', zaratan.archetype, 'mythic', RULES, [], tweakOfMonster(zaratan.tweak));
  const row = monsterRows(zaratan, [combatantId('z')], ON)[0]!;
  const zSheet = modified(row.origin, row.statuses, ON).sheet, zTarget = (bare.armor + bare.resist) / 2 + 15;
  expect([Math.abs(zSheet.armor - zTarget) <= 0.5, Math.abs(zSheet.resist - zTarget) <= 0.5]).toEqual([true, true]);
});

test('a move\'s ability is named for its key, cannot be avoided when sure, never lands on its own side and applies its status', () => {
  const [body] = bodiesOf('angel-of-the-last-trumpet'), angel = mythicScriptOf('angel-of-the-last-trumpet');
  const note = mythicMove(...entryOf(angel, 'final-note')!, body!, RULES);
  expect([note.id, note.name, note.delivery, note.foesOnly]).toEqual(['mythic-final-note', 'The Final Note', { kind: 'sure' }, true]);
  expect(note.ops.map(o => (o.op === 'applyStatus' ? [o.key, o.duration] : o.op))).toEqual([['stunned', RULES.fight.round]]);
  const [starsKey, starsMove] = entryOf(angel, 'stars-fall')!;
  const stars = mythicMove(starsKey, starsMove, body!, RULES);
  expect([starsMove.sure, stars.delivery.kind, stars.range, stars.shape.kind === 'radius' && stars.shape.radius, stars.zone?.name]).toEqual([true, 'sure', 12, 2, 'Fallen stars']);
});

test('a GM\'s turn pace for a mythic is one of the paces, and a script bound runs low to high', () => {
  expect(parseOverrides({ fight: { mythic: { turnPace: 'heavy', bounds: { clock: [3, 12] } } } })).toEqual({ overrides: { fight: { mythic: { turnPace: 'heavy', bounds: { clock: [3, 12] } } } }, refused: [] });
  expect(parseOverrides({ fight: { mythic: { turnPace: 'slow', bounds: { clock: [12, 3] } } } }).refused).toEqual([
    { path: 'fight.mythic.turnPace', reason: 'entry' }, { path: 'fight.mythic.bounds.clock', reason: 'order' },
  ]);
});

describe('each script\'s shape, played on the reducer (design B.6, "The test to copy")', () => {
  // A new mythic copies one of these: its seed in a fight with the switch on, played turn by turn, and its shape stated
  // from its own words in registry/mythics.ts.
  const ON: Rules = { ...RULES, fight: { ...RULES.fight, mythic: { ...RULES.fight.mythic, scripts: true } } };
  const ctx: Ctx = { rules: ON };
  const id = combatantId;
  const seedOf = (script: MythicScriptId) => SEEDS.find(m => m.script === script)!;
  const mythic = (script: MythicScriptId, at: Place): NewRow => ({ ...monsterRows(seedOf(script), [id('X')], ON)[0]!, place: at });
  const plate = (n: number): Status => ({ key: statusKey('plate'), def: { label: 'Plate', desc: '', ops: [{ op: 'sheet', key: 'armor', amount: { kind: 'number', value: n } }, { op: 'sheet', key: 'resist', amount: { kind: 'number', value: n } }] }, source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) });
  const KILL = { ...abilityOf('strike', { id: abilityId('kill'), name: 'Kill' }, RULES), range: tiles(40), shape: { kind: 'touch', reach: tiles(40) }, delivery: { kind: 'sure' }, effect: { type: 'physical', by: 'hand', formula: { kind: 'number', value: 99999 } } } as const;
  /** A hunter of base stats in a light kit at `at`, at `share` of its max HP, behind plate of `armor` armor and resist and a shield of `shield`. */
  function hunter(name: string, at: Place, share = 1, armor = 5000, shield = 0): NewRow {
    const origin: Origin = { kind: 'hunter', build: { stats: baseStats(RULES.fight), level: 1, gear: kitGear('light', RULES), perks: {} } };
    const statuses = [plate(armor)], hpMax = modified(origin, statuses, RULES).sheet.hpMax;
    return {
      id: id(name), name, side: 'party', kind: 'hunter', life: { at: 'up', hp: Math.round(hpMax * share) }, origin, tier: 0, place: at, mana: 10, fatigue: 0,
      shield: shield ? { amount: shield, until: tick(100 * RULES.fight.round) } : null,
      stagger: null, channel: null, threat: null, statuses, readyAt: {}, abilities: [KILL], intent: null, holder: { kind: 'local', hunterId: hunterId(`h-${name}`) }, xp: 0, mythic: null,
    } as NewRow;
  }
  function go(fight: Fight | null, cmd: Command): { fight: Running; effects: readonly Effect[] } {
    const r = reduce(fight, cmd, ctx), no = r.effects.find(e => e.type === 'refused');
    if (no || r.fight?.phase !== 'running') throw new Error(`${cmd.type}: ${JSON.stringify(no ?? r.fight?.phase)}; ${r.fight?.log.slice(0, 8).map(l => l.text).reverse().join(' | ')}`);
    return { fight: r.fight, effects: r.effects };
  }
  function started(...rows: NewRow[]): Running {
    const set = reduce(null, { type: 'add', fightId: fightId('f-s'), rows, openings: [], grid: openGrid(30, 12) }, ctx).fight;
    return go(set, { type: 'start', openings: rows.map(r => ({ id: r.id, d20: r.id === 'X' ? 20 : 1, tie: 0 })) }).fight;
  }
  const standing = (f: Fight) => f.rows.find(r => r.id === 'X')!.mythic!;
  const body = (f: Fight, name: string): Body => f.rows.find(r => r.id === name)!;
  /** The landing of X's omen with every die it asks for at its middle face. */
  function landing(f: Running): Command {
    const u = body(f, 'X'), m = omenMove(u, ON)!, n = omenNeeds(f, u, ON)!;
    const dice = Object.fromEntries(Object.entries(n.dice).map(([k, ds]) => [k, ds.map(d => Math.ceil(d.sides / 2))]));
    return { type: 'act', by: id('X'), ability: m.ability.id, aim: m.aim, rolls: { dice, react: Object.fromEntries(n.react.map(r => [r, 10])) } as Rolls };
  }
  /** The fight's turns played from `f`: each of X's landing turns landed when `land` holds of the fight, else dropped by the GM, every other turn passed; the lines each command logged. */
  function* turns(f0: Running, land: (f: Running) => boolean): Generator<{ fight: Running; said: string[]; effects: readonly Effect[] }> {
    let f = f0;
    for (let i = 0; i < 200; i++) {
      const cmd: Command = runningState(f).at === 'landing' ? (land(f) ? landing(f) : { type: 'mythic', by: id('X'), step: 'drop' }) : { type: 'endTurn', by: f.currentId };
      // the lines above the last command's newest (the log keeps its last 100, so its length stops growing)
      const r = go(f, cmd), top = f.log[0] ? r.fight.log.indexOf(f.log[0]) : r.fight.log.length;
      const said = r.fight.log.slice(0, top < 0 ? r.fight.log.length : top).map(l => l.text.replace(/^R\d+: /, '')).reverse();
      f = r.fight;
      yield { fight: f, said, effects: r.effects };
    }
  }

  test('Zaratan\'s Dive cannot be hurt and ends after 4 rounds', () => {
    const f0 = go(started(mythic('zaratan-the-island-that-wakes', place(5, 5)), hunter('A', place(8, 5))), { type: 'mythic', by: id('X'), step: 'next' }).fight;
    const dive = MYTHICS['zaratan-the-island-that-wakes'].phases[1]!, since = standing(f0).since, hp = rowHp(body(f0, 'X'));
    expect(dive.name).toBe('The Dive');
    expect(hp, 'it dives at 55% of its max HP').toBe(Math.ceil(0.55 * body(f0, 'X').sheet.hpMax));
    let hits = 0;
    for (const t of turns(f0, () => false)) {
      if (t.said.includes('Zaratan, the Island That Wakes enters The Island Wakes.')) {
        expect(t.fight.now, 'it surfaces at its first turn once 4 rounds have passed').toBeGreaterThanOrEqual(since + 4 * RULES.fight.round);
        expect(standing(t.fight)).toMatchObject({ phase: 2, at: 'calm' });
        expect(hits, 'the party struck it in the Dive').toBeGreaterThan(0);
        return;
      }
      expect(standing(t.fight).phase, `still diving at ${t.fight.now}`).toBe(1);
      if (t.fight.currentId === 'A') {
        const hit = go(t.fight, { type: 'act', by: id('A'), ability: KILL.id, aim: id('X'), rolls: { dice: {}, react: {} } });
        expect(rowHp(body(hit.fight, 'X')), 'no damage reaches it under the waves').toBe(hp);
        expect([body(hit.fight, 'X').stagger?.fill, hit.effects.some(e => e.type === 'staggered')], 'nor fills its bar').toEqual([0, false]);
        hits++;
      }
    }
    throw new Error('it never surfaced');
  });

  test('the Angel\'s Final Note comes every other turn once a clock runs out', () => {
    // shields no Note breaks, so the party stands to hear it again
    const f0 = started(mythic('angel-of-the-last-trumpet', place(5, 5)), hunter('A', place(8, 5), 1, 5000, 1e6), hunter('B', place(9, 7), 1, 5000, 1e6));
    const clock = MYTHICS['angel-of-the-last-trumpet'].phases[0].clock * RULES.fight.round, mine: string[] = [];
    for (const t of turns(f0, f => f.now >= clock)) {
      for (const l of t.said.filter(x => x.includes('The Final Note') && t.fight.now >= clock)) {
        mine.push(l.startsWith('The Angel of the Last Trumpet is enraged and readies The Final Note') ? 'readies' : l.startsWith('The Angel of the Last Trumpet uses The Final Note') ? 'lands' : l);
      }
      if (mine.length >= 4) break;
    }
    expect(mine.slice(0, 4)).toEqual(['readies', 'lands', 'readies', 'lands']);
  });

  test('the Fourth Rider names the hunter lowest on HP', () => {
    const f0 = started(mythic('the-fourth-rider', place(5, 5)), hunter('A', place(8, 5), 0.9, 0), hunter('B', place(9, 7), 0.3, 0));
    for (const t of turns(f0, () => true)) {
      if (t.said.includes('The Fourth Rider readies Named in the Book. It lands on its next turn.')) {
        expect(standing(t.fight)).toMatchObject({ omen: 'named', aim: id('B') });
      }
      if (t.effects.some(e => e.type === 'used' && e.by === 'X' && e.ability === 'mythic-named')) {
        expect(isUp(body(t.fight, 'B')), 'the one he names dies').toBe(false);
        expect(isUp(body(t.fight, 'A'))).toBe(true);
        return;
      }
    }
    throw new Error('no name was ever read');
  });
});
