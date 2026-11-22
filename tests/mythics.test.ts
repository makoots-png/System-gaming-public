// The mythics' scripts (src/core/registry/mythics.ts; notes-11-keystones.md, design B.3, B.4 and B.6). Every test here
// but the per-script ones loops over `MYTHICS`, so a new script is checked with no edit. A new mythic copies one of the
// per-script tests (unit MY4 adds them) to state its own shape from its own words.
import { expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
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
  return (o.interrupt.by.length > 0 && o.interrupt.outcome !== 'none') || o.stagger !== 'none' || (o.burst !== null && o.burst.outcome !== 'none')
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
    const weakens = o.interrupt.outcome === 'weaken' || o.stagger === 'weaken' || o.burst?.outcome === 'weaken';
    if (weakens) expect([id, key, o.weak !== null]).toEqual([id, key, true]);
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
    for (const [key, o] of omensOf(s)) if (o.burst) expect([id, key, 'burst', within(o.burst.share, B.burst)]).toEqual([id, key, 'burst', true]);
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

test('a move\'s ability is named for its key, cannot be avoided when sure, never lands on its own side and applies its status', () => {
  const [body] = bodiesOf('angel-of-the-last-trumpet'), angel = mythicScriptOf('angel-of-the-last-trumpet');
  const note = mythicMove(...entryOf(angel, 'final-note')!, body!, RULES);
  expect([note.id, note.name, note.delivery, note.foesOnly]).toEqual(['mythic-final-note', 'The Final Note', { kind: 'sure' }, true]);
  expect(note.ops.map(o => (o.op === 'applyStatus' ? [o.key, o.duration] : o.op))).toEqual([['stunned', RULES.fight.round]]);
  const stars = mythicMove(...entryOf(angel, 'stars-fall')!, body!, RULES);
  expect([stars.delivery.kind, stars.range, stars.shape.kind === 'radius' && stars.shape.radius, stars.zone?.name]).toEqual(['travel', 12, 2, 'Fallen stars']);
});

test('a GM\'s turn pace for a mythic is one of the paces, and a script bound runs low to high', () => {
  expect(parseOverrides({ fight: { mythic: { turnPace: 'heavy', bounds: { clock: [3, 12] } } } })).toEqual({ overrides: { fight: { mythic: { turnPace: 'heavy', bounds: { clock: [3, 12] } } } }, refused: [] });
  expect(parseOverrides({ fight: { mythic: { turnPace: 'slow', bounds: { clock: [12, 3] } } } }).refused).toEqual([
    { path: 'fight.mythic.turnPace', reason: 'entry' }, { path: 'fight.mythic.bounds.clock', reason: 'order' },
  ]);
});
