// What a save is at schema 6 (items by reference): an older save is refused at the schema boundary; a current save reads back as it was
// written; a damaged one is repaired.
// Expected numbers come from the rules by name: a new hunter has `statBase` in each of the eight stats, the creation
// points free, and the HP, mana and fatigue capacity of base stats at level 1, where every curve term of design 2.2 is 0
// (`hpBase`, `manaBase`, `fatigueBase`).
import { fightId } from '../src/core/ids.ts';
import { describe, expect, test } from 'bun:test';
import { RULES, TIERS } from '../src/core/rules.ts';
import { STAT_KEYS } from '../src/core/stats.ts';
import {
  RARITIES, SCHEMA, createHunter, exportedSave, fileKind, freshSave, keepPhone, loadSave, makeHunter, newHunter, newMonster, newRewards, newShadow, newSyncSettings, parseSave, parseSaveValue, parseSheetHunter, repairSave, SLOTS,
} from '../src/core/save.ts';
import type { Hunter, ParseEnv, Parsed, Save, SyncSettings } from '../src/core/save.ts';
import { KEYS_MAX } from '../src/core/sync/bind.ts';
import type { EventId, GmKey, RoomCode } from '../src/core/ids.ts';
import { newGate } from '../src/core/gates/gate.ts';
import { available } from '../src/core/hunter/progress.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import type { SheetHunter } from '../src/core/hunter/sheet.ts';
import { hunterRow, monsterRows, shadowRow } from '../src/core/combat/rows.ts';
import type { RowHunter, RowMonster, RowShadow } from '../src/core/combat/rows.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Command, Ctx, Fight } from '../src/core/combat/fight.ts';
import { MAX_STATUSES } from '../src/core/combat/fight-types.ts';
import { ITEM_BOUNDS, LOOT_ITEMS } from '../src/core/registry/items.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';
import { formulaOf, abilityOf } from '../src/core/registry/ability-kinds.ts';
import { parseFormula, printFormula } from '../src/core/formula.ts';
import { parseAbility, parseFight } from '../src/core/combat/fight-parse.ts';
import { cid, day, dev, gmKey, hid, iid, qid, rbid, room, shid, tid } from './fixtures/ids.ts';
import { dayKey } from '../src/core/day.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { bagOf } from '../src/core/hunter/inventory.ts';
import { DAGGER_DEF_ID, customId } from './fixtures/items.ts';

type Raw = Record<string, any>;

const NOW = new Date('2026-11-12T12:00:00.000Z');
function env(): ParseEnv {
  let made = 0, tokens = 0;
  return { now: NOW, newDeviceId: () => dev(`d-test${++made}`), newDeviceToken: () => `token-${String(++tokens).padStart(26, '0')}` };
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const samplePlayer = (name = 'Mira Fixture'): Save => {
  const save = freshSave(env(), { onboarded: true });
  save.hunters[0]!.name = name;
  return save;
};

function saved(parsed: Parsed): Save {
  if (parsed.kind !== 'save') throw new Error(`expected a save, got ${JSON.stringify(parsed).slice(0, 200)}`);
  return parsed.save;
}
const parseRaw = (value: unknown): Save => saved(parseSaveValue(copy(value), env()));
/** A current save holding one hunter that has the given fields on top of the defaults. */
const withHunter = (fields: Raw): Raw => ({ schema: SCHEMA, hunters: [{ ...newHunter(), ...fields }] });
const onlyHunter = (save: Save): Hunter => {
  expect(save.hunters).toHaveLength(1);
  return save.hunters[0]!;
};
const BASE_STATS = Object.fromEntries(STAT_KEYS.map(k => [k, RULES.fight.statBase]));

/** A running fight as the fight's reducer stores it: a new hunter against a goblin, the hunter's turn first. */
const ctx: Ctx = { rules: RULES };
function runningFight(): Fight {
  const goblin = seedMonsters(RULES).find(m => m.name === 'Goblin')!;
  const h = newHunter();
  const commands: Command[] = [
    { type: 'add', fightId: fightId('f-1'), rows: [hunterRow(h, combatantId('c1'), RULES), ...monsterRows(goblin, [combatantId('c2')], RULES)], openings: [] },
    { type: 'start', openings: [{ id: combatantId('c1'), d20: 20, tie: 0 }, { id: combatantId('c2'), d20: 5, tie: 0 }] },
  ];
  let fight: Fight | null = null;
  for (const cmd of commands) fight = reduce(fight, cmd, ctx).fight;
  if (!fight || fight.phase !== 'running') throw new Error('the fight did not start');
  return fight;
}
/** A stored ad hoc bag line of `item` (a player's own item, by value), as a save holds one. */
const adhoc = (item: Raw, line: Raw = {}): Raw => ({ kind: 'adhoc', qty: 1, ...line, item });
/** A stored bag line by reference to the shipped Iron Dagger. */
const dagger = (id: string): Raw => ({ id, kind: 'ref', defId: DAGGER_DEF_ID, qty: 1 });
const POISONED = { key: 'poisoned', def: RULES.conditions.poisoned, source: { id: 'c3', tier: 3 }, rounds: 2.5 };
const SLOWED = { key: 'slowed', def: RULES.conditions.slowed, source: { id: null, tier: 0 }, rounds: null };

/** A campaign with a running fight, gates, a bestiary entry, a room link, a status on a hunter and a shadow, as the app keeps it. */
function campaign(): Save {
  const save = freshSave(env(), { onboarded: true });
  const h = save.hunters[0]!;
  h.conditions = copy([POISONED, SLOWED]) as Hunter['conditions'];
  h.shadows = [{ ...newShadow(), id: shid('sh150'), name: 'Igris', rank: 'B', archetype: 'skirmisher', grade: 'Knight', hp: 80, notes: 'Loyal.' }];
  h.titles.push({ id: tid('t151'), name: 'Gate Breaker', desc: '', bonus: { str: 2, manaMax: 3 } });
  h.manaAdj = 4; h.hpAdj = -3;
  h.life = { at: 'up', hp: 7 };
  save.monsters = seedMonsters(RULES).slice(0, 2);
  save.gates = [{ ...newGate(), id: 'g152' as Save['gates'][number]['id'], name: 'Den', status: 'cleared', clearedDay: 3, xpPaid: 120 }];
  save.fight = runningFight();
  save.codex = { 'goblin|E': { name: 'Goblin', rank: 'E', kills: 2, firstAt: 'a', lastAt: 'b', monsterId: null, room: true, info: { hpMax: 30, armor: 4, resist: 2, speed: 110, abilities: ['Shot'] } } };
  save.codexSeen = [cid('c2')];
  save.settings.sync = { room: room('ABCDEF'), cursor: 41, serverOk: true, gmKey: gmKey('k'.repeat(32)), gmKeys: { ABCDEF: gmKey('k'.repeat(32)) },
    lastRoom: { code: room('GHJKLM'), why: 'gone' }, boundHunterId: hid('h1'), deviceToken: 't'.repeat(32), joined: { room: room('ABCDEF'), at: '2026-11-10T12:00:00.000Z' },
    outbox: [{ id: 'tomb h111', room: 'ABCDEF' as RoomCode, letter: { kind: 'tomb', hid: hid('h111') }, key: null, at: 'refused', why: 'not your sheet' }], applied: ['d-gm1-mabc12xyz', 'd-gm1-mabc13xyz'] as EventId[] };
  save.seq = 160;
  return save;
}

describe('the schema boundary for older saves', () => {
  test('an integer schema below SCHEMA with a hunters list is refused as old; non-saves and bad schemas are not-a-save', () => {
    const raw = samplePlayer();
    expect(SCHEMA, 'items by reference are schema 6').toBe(6);
    for (const schema of [5, 4, 3, 2, 1]) expect(parseSaveValue({ ...copy(raw), schema }, env())).toEqual({ kind: 'invalid', reason: 'old' });
    for (const schema of [0, -1, undefined, '4', '5', 4.5, 5.5, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(parseSaveValue({ ...copy(raw), schema }, env())).toEqual({ kind: 'invalid', reason: 'not-a-save' });
    }
    for (const v of [{ schema: 4, foo: 1 }, { schema: 2, hunters: { h1: {} } }, { name: 'Solo' }, { stats: { str: 12 } }, { quests: [] }]) {
      expect(parseSaveValue(v, env())).toEqual({ kind: 'invalid', reason: 'not-a-save' });
    }
  });

  test('a schema 5 save, whose bags held items by value, is refused as old, its by-value items never read as references', () => {
    const v5 = { ...copy(samplePlayer()), schema: 5, hunters: [{ ...newHunter(), items: [{ id: 'i1', name: 'Iron Dagger', rar: 'common', type: 'weapon', slot: 'weapon', qty: 1, dice: '1d8', bonus: {}, desc: '', armor: 0, resist: 0 }] }] };
    expect(parseSaveValue(v5, env())).toEqual({ kind: 'invalid', reason: 'old' });
    expect(parseSave(JSON.stringify(v5), env())).toEqual({ kind: 'invalid', reason: 'old' });
  });
});

describe('what the app opens with, from the stored save key', () => {
  const current = (name: string): string => JSON.stringify(samplePlayer(name));
  const UNREADABLE = ['not json {name: Lost Hunter', '[]', '{"foo":1}', `{"schema":${SCHEMA},"hunters":{"h1":{"name":"Odd Shape Hunter"}}}`, JSON.stringify({ ...samplePlayer(), schema: SCHEMA - 1 })];

  test('a current save opens as it was stored, with no warning and nothing to back up', () => {
    const text = current('Stored Hunter');
    const loaded = loadSave(text, env());
    expect(loaded).toEqual({ save: JSON.parse(text), fresh: false, readOnly: false, backup: null, notice: null });
  });

  test('a save from a newer app opens read-only with the newer warning and its hunters', () => {
    const raw: Raw = copy(samplePlayer());
    raw.schema = 99;
    const loaded = loadSave(JSON.stringify(raw), env());
    expect(loaded).toMatchObject({ fresh: false, readOnly: true, backup: null, notice: null });
    expect(loaded.save.schema).toBe(99);
    expect(loaded.save.hunters[0]!.name).toBe('Mira Fixture');
  });

  test('a current save whose running fight is damaged opens without the fight, with the fight warning and the stored text to back up (implicit audit 3, FP1)', () => {
    const save = JSON.parse(current('Stored Hunter'));
    save.fight = { phase: 'running', rows: 'not rows' };
    const text = JSON.stringify(save);
    const loaded = loadSave(text, env());
    expect(loaded).toMatchObject({ fresh: false, readOnly: false, backup: { reason: 'a fight that could not be read', data: text }, notice: 'fight' });
    expect(loaded.save.fight).toBeNull();
    expect(loaded.save.hunters[0]!.name).toBe('Stored Hunter');
  });

  test('a library item whose effect holds a formula past its 200 parts opens without that effect, its name and other effects kept (notes-5-trade.md 12.3)', () => {
    const negated = (n: number): object => (n === 1 ? { kind: 'number', value: 1 } : { kind: 'negate', arg: negated(n - 1) });
    const kept = { op: 'shield', amount: { kind: 'number', value: 3 } };
    const save = JSON.parse(current('Stored Hunter'));
    const charm = customId('oddcharm');
    save.library.items = { [charm]: { name: 'Odd Charm', effects: [{ op: 'shield', amount: negated(201) }, kept] } };
    const loaded = loadSave(JSON.stringify(save), env());
    expect(Object.keys(loaded.save.library.items)).toEqual([charm]);
    expect(loaded.save.library.items[charm]).toMatchObject({ name: 'Odd Charm', effects: [kept] });
    expect(loaded.save.hunters[0]!.name).toBe('Stored Hunter');
  });

  for (const text of UNREADABLE) {
    test(`a stored text that reads ${text.slice(0, 24)} gives a starter hunter, the unreadable warning and the text to back up`, () => {
      const loaded = loadSave(text, env());
      expect(loaded).toMatchObject({ fresh: false, readOnly: false, backup: { reason: 'unreadable', data: text }, notice: 'unreadable' });
      expect(loaded.save).toEqual(freshSave(env(), { onboarded: true }));
    });
  }

  test('a phone with nothing stored gets a fresh starter hunter that has not been through the welcome, and no warning', () => {
    const loaded = loadSave(null, env());
    expect(loaded).toEqual({ save: freshSave(env(), { onboarded: false }), fresh: true, readOnly: false, backup: null, notice: null });
    expect(onlyHunter(loaded.save).name).toBe('Sung Jin-Woo');
  });
});

describe('a new hunter', () => {
  test('starts at level 1 with the base of each of the eight stats, its creation points free, and the full HP and mana of its sheet', () => {
    const h = newHunter();
    expect(h.stats).toEqual(BASE_STATS);
    expect(h.pending).toEqual({});
    expect(available(h, RULES)).toBe(RULES.fight.creationPoints);
    expect(h).toMatchObject({ level: 1, life: { at: 'up', hp: RULES.fight.hpBase }, mana: RULES.fight.manaBase, fatigue: 0, collapsed: false, hpAdj: 0, manaAdj: 0 });
    expect(hunterSheet(h, RULES).sheet).toMatchObject({ hpMax: RULES.fight.hpBase, manaMax: RULES.fight.manaBase, fatigueMax: RULES.fight.fatigueBase });
  });

  test('the starter hunter holds Sprint and Bloodlust, the Venom Fang and a Health Potion as the registries define them', () => {
    const h = onlyHunter(freshSave(env(), { onboarded: true }));
    expect(h.name).toBe('Sung Jin-Woo');
    expect(h.stats).toEqual(BASE_STATS);
    expect(available(h, RULES)).toBe(RULES.fight.creationPoints);
    expect(h.skills.map(k => [k.name, k.type, k.label])).toEqual([['Sprint', 'active', null], ['Bloodlust', 'passive', null]]);
    const [sprint, bloodlust] = h.skills;
    expect(sprint!.type === 'active' && sprint!.ability?.name).toBe('Sprint');
    expect(bloodlust!.type === 'passive' && bloodlust!.bonus).toEqual({ str: 1 });
    expect(h.items.every(i => i.kind === 'ref'), 'each a reference to its shipped def').toBe(true);
    expect(bagOf(h, RULES).map(i => [i.name, i.type, i.attack ?? null])).toEqual([["Kasaka's Venom Fang", 'weapon', 'strike'], ['Health Potion (E)', 'consumable', null]]);
    expect(new Set([...h.skills, ...h.items].map(x => x.id)).size).toBe(4);
  });
});

describe('a current save', () => {
  test('a new profile reads back exactly as it was written', () => {
    const save = freshSave(env(), { onboarded: false });
    expect(save.schema).toBe(SCHEMA);
    expect(save.settings.onboarded).toBe(false);
    expect(parseSaveValue(copy(save), env())).toEqual({ kind: 'save', save, fightLost: false });
    expect(parseSave(JSON.stringify(save), env())).toEqual({ kind: 'save', save, fightLost: false });
  });

  test('a campaign with a running fight, gates, monsters, statuses, a shadow and a room link reads back exactly as it was written', () => {
    const before = campaign();
    const written = copy(before);
    const save = saved(parseSaveValue(copy(before), env()));
    expect(save).toEqual(written);
    expect(save.fight).toEqual(written.fight);
    expect(save.fight!.phase).toBe('running');
  });

  test('the gate and the bestiary entries a running fight came from read back with it, and go when there is no fight', () => {
    const before = { ...campaign(), fightRefs: { gate: 'g7', monsters: { c2: 'seed:goblin' } } };
    expect(saved(parseSaveValue(copy(before), env())).fightRefs).toEqual({ gate: 'g7', monsters: { c2: 'seed:goblin' } });
    const junk = saved(parseSaveValue(copy({ ...before, fightRefs: { gate: 7, monsters: { c2: 5, c3: 'm9' } } }), env()));
    expect(junk.fightRefs).toEqual({ gate: null, monsters: { c3: 'm9' } });
    expect('fightRefs' in saved(parseSaveValue(copy({ ...before, fight: null }), env()))).toBe(false);
  });

  test('the rows the codex counted and a codex entry\'s monster read back as ids; what is not an id is dropped', () => {
    const before = { ...campaign(), codexSeen: ['c2', 'c3~400-1', 7, ''], codex: { 'goblin|E': { name: 'Goblin', rank: 'E', kills: 1, firstAt: 'a', lastAt: 'b', monsterId: 5 } } };
    const s = parseRaw(before);
    expect(s.codexSeen).toEqual([cid('c2'), cid('c3~400-1')]);
    expect(s.codex['goblin|E']!.monsterId).toBeNull();
  });

  test('repairing a campaign a second time changes nothing', () => {
    const save = repairSave(campaign(), env());
    const once = copy(save);
    expect(repairSave(save, env())).toBe(save);
    expect(save).toEqual(once);
  });

  test('a new install\'s hunter is the seed; a stored seed mark that is not true is dropped, and one that is stays', () => {
    const save = freshSave(env(), { onboarded: false });
    expect(save.hunters[0]!.seed).toBe(true);
    const odd = copy(save) as Save;
    (odd.hunters[0] as Raw).seed = 'yes';
    expect('seed' in repairSave(odd, env()).hunters[0]!).toBe(false);
    expect(repairSave(copy(save) as Save, env()).hunters[0]!.seed).toBe(true);
  });

  test('a repair keeps the same hunter objects, so a view that holds one sees the repaired hunter', () => {
    const save = freshSave(env(), { onboarded: true });
    const held = save.hunters[0]!;
    held.level = -4;
    repairSave(save, env());
    expect(save.hunters[0]).toBe(held);
    expect(held.level).toBe(1);
  });

  test('an update keeps the fight its reducer stored as it is and still repairs the rest; a load reads the fight again', () => {
    const save = repairSave(campaign(), env()), fight = save.fight;
    save.hunters[0]!.level = -4;
    repairSave(save, env(), 'kept');
    expect(save.fight).toBe(fight);
    expect(save.hunters[0]!.level).toBe(1);
    const stored = { ...save, fight: { phase: 'running', rows: 'not rows' } } as unknown as Save;
    expect(repairSave(stored, env()).fight).toBeNull();
  });

  test('old saves without capDisplay repair to null; valid capDisplay values round-trip and junk repairs to null', () => {
    const oldSave: Raw = copy(samplePlayer());
    delete oldSave.hunters[0].capDisplay;
    const repaired = parseRaw(oldSave);
    expect(repaired.hunters[0]!.capDisplay).toBeNull();

    for (const valid of ['E', 'D', 'C', 'B', 'A', 'S', 'none', null] as const) {
      const s: Raw = copy(samplePlayer());
      s.hunters[0].capDisplay = valid;
      expect(parseRaw(s).hunters[0]!.capDisplay).toBe(valid);
      expect(parseSheetHunter(s.hunters[0])?.capDisplay).toBe(valid);
    }

    for (const junk of ['', 'X', 9, true, {}]) {
      const s: Raw = copy(samplePlayer());
      s.hunters[0].capDisplay = junk;
      expect(parseRaw(s).hunters[0]!.capDisplay).toBeNull();
      expect(parseSheetHunter(s.hunters[0])?.capDisplay).toBeNull();
    }
  });
});

describe('text that is not a save', () => {
  const cases: [string, string, string][] = [
    ['text that is not JSON', '{"hunters": [', 'not-json'],
    ['an empty text', '', 'not-json'],
    ['a list', '[]', 'not-an-object'],
    ['a quoted text', '"text"', 'not-an-object'],
    ['a number', '42', 'not-an-object'],
    ['null', 'null', 'not-an-object'],
    ['an empty object', '{}', 'not-a-save'],
    ['an object of something else', '{"foo":1}', 'not-a-save'],
    ['an object whose hunters is not a list', '{"hunters":"many","settings":{}}', 'not-a-save'],
    ['an older schema save', `{"schema":${SCHEMA - 1},"hunters":[]}`, 'old'],
    ['a current save whose hunters is not a list', `{"schema":${SCHEMA},"hunters":{"h1":{"name":"Odd Shape Hunter","level":4}}}`, 'not-a-save'],
    ['a current save with no hunters list', `{"schema":${SCHEMA},"settings":{},"world":{"day":4}}`, 'not-a-save'],
  ];
  for (const [what, text, reason] of cases) {
    test(`${what} is refused as ${reason}`, () => {
      expect(parseSave(text, env())).toEqual({ kind: 'invalid', reason } as Parsed);
    });
  }
});

describe('a save written by a newer app', () => {
  test('is reported as newer with its schema number, and its hunters are still readable', () => {
    const raw: Raw = copy(samplePlayer());
    raw.schema = 99;
    const parsed = parseSaveValue(raw, env());
    expect(parsed).toMatchObject({ kind: 'newer', schema: 99 });
    if (parsed.kind !== 'newer') throw new Error('expected newer');
    expect(parsed.save.schema).toBe(99);
    expect(parsed.save.hunters[0]!.name).toBe('Mira Fixture');
  });
});

describe('a damaged or hostile save', () => {
  test('ten thousand junk entries in the hunters list leave only the entries that are objects', () => {
    const junk = [null, 3, 'x', [], true];
    const hunters = Array.from({ length: 10_000 }, (_, i) => (i % 2500 === 0 ? {} : junk[i % junk.length]));
    const save = parseRaw({ schema: SCHEMA, hunters });
    expect(save.hunters).toHaveLength(4);
    expect(new Set(save.hunters.map(h => h.id)).size).toBe(4);
    expect(save.hunters.every(h => h.name === 'Hunter' && h.level === 1)).toBe(true);
  });

  test('a save with no hunter, or a hunters list of null, a number and a text, opens with the starter hunter active', () => {
    for (const hunters of [[], [null, 3, 'x']]) {
      const save = parseRaw({ schema: SCHEMA, hunters, settings: { activeHunterId: 'h9' } });
      expect(save.hunters.map(h => [h.name, h.seed])).toEqual([['Sung Jin-Woo', true]]);
      expect(save.settings.activeHunterId).toBe(save.hunters[0]!.id);
      expect(repairSave(structuredClone(save), env())).toEqual(save);
    }
  });

  test('every other part of the save being the wrong kind of value does not throw', () => {
    const save = parseRaw({ schema: SCHEMA, seq: 'x', settings: 5, world: [], rulesOverrides: [], hunters: [null, 'x'], gates: 'g', monsters: 1,
      library: 'x', fight: 'x', log: {}, rolls: 7, savedAt: 12 });
    expect(save.hunters.map(h => h.name)).toEqual(['Sung Jin-Woo']);
    expect(save).toMatchObject({ savedAt: '', gates: [], monsters: [], library: { items: {} }, fight: null, log: [], rolls: [],
      rulesOverrides: {}, world: { day: 1 }, settings: { mode: 'player', deviceId: 'd-test1', sync: { room: null, cursor: 0, serverOk: false } } });
  });

  test('a hunter whose stats is a text gets the base stats', () => {
    const h = onlyHunter(parseRaw(withHunter({ stats: 'strong', pending: 'yes' })));
    expect(h.stats).toEqual(BASE_STATS);
    expect(h.pending).toEqual({});
  });

  test('__proto__ and constructor keys in a save and its hunter change no prototype', () => {
    const text = `{"schema":${SCHEMA},"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},
      "settings":{"__proto__":{"polluted":true}},"rulesOverrides":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}},
      "hunters":[{"name":"Proto","__proto__":{"polluted":true,"level":50},"constructor":"x","stats":{"__proto__":{"str":99}},
        "items":[{"kind":"adhoc","qty":1,"item":{"name":"Fang","bonus":{"__proto__":{"str":5}}}}],"titles":[{"name":"T","bonus":{"__proto__":{"str":5}}}]}]}`;
    const save = saved(parseSave(text, env()));
    const h = onlyHunter(save);
    expect(h.name).toBe('Proto');
    expect(h.level).toBe(1);
    expect(h.stats.str).toBe(RULES.fight.statBase);
    expect(Object.getPrototypeOf(save)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(h)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(save.settings)).toBe(Object.prototype);
    expect(({} as Raw).polluted).toBeUndefined();
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  });

  test('jobDone matches job only when that class is earned in classes', () => {
    expect(onlyHunter(parseRaw(withHunter({ job: 'Mage' }))).jobDone).toBeNull();
    expect(onlyHunter(parseRaw(withHunter({ job: 'Mage', jobDone: 'Mage' }))).jobDone).toBeNull();
    expect(onlyHunter(parseRaw(withHunter({ job: 'Mage', jobDone: 'Mage', classes: { Mage: { unlockedAt: NOW.toISOString(), nodes: [] } } }))).jobDone).toBe('Mage');
    expect(onlyHunter(parseRaw(withHunter({ jobDone: 7 }))).jobDone).toBeNull();
  });

  test('a name of 100,000 characters is cut to 60, and long notes and quest titles are cut too', () => {
    const long = 'n'.repeat(100_000);
    const h = onlyHunter(parseRaw(withHunter({ name: long, job: long, notes: long, quests: [{ title: long, desc: long, penaltyText: long }], items: [adhoc({ name: long })] })));
    expect(h.name).toHaveLength(60);
    expect(h.job).toHaveLength(60);
    expect(h.notes).toHaveLength(500);
    expect(h.quests[0]).toMatchObject({ title: 'n'.repeat(120), desc: 'n'.repeat(500), penaltyText: 'n'.repeat(300) });
    const line = h.items[0]!;
    expect(line.kind === 'adhoc' && line.item.name).toHaveLength(60);
  });

  test('NaN, Infinity and numbers written as text in number fields fall back to the defaults', () => {
    const base = newHunter();
    const h = onlyHunter(parseRaw(withHunter({ level: 'NaN', xp: 'Infinity', gold: '-5', mana: 'NaN', bonusPoints: '1e9', spent: 'NaN', peakLevel: 'Infinity',
      fatigue: '-Infinity', hpAdj: '7', manaAdj: 'x', stats: { ...BASE_STATS, str: 'NaN' } })));
    expect(h).toMatchObject({ level: 1, xp: 0, gold: 0, life: base.life, mana: base.mana, bonusPoints: 0, spent: {}, peakLevel: 1, fatigue: 0, hpAdj: 0, manaAdj: 0 });
    expect(h.stats.str).toBe(RULES.fight.statBase);
  });

  test('a number too large for JSON, negative numbers and fractions are clamped to whole numbers in their bounds', () => {
    const text = JSON.stringify(withHunter({ level: -3, xp: -10, gold: -1, mana: -4, fatigue: -2, spent: -4, stats: { ...BASE_STATS, agi: 14.6, vit: -3 } }))
      .replace('"gold":-1', '"gold":1e999');
    const h = onlyHunter(saved(parseSave(text, env())));
    expect(h).toMatchObject({ level: 1, xp: 0, gold: 0, mana: 0, fatigue: 0, spent: {} });
    expect(h.stats).toMatchObject({ agi: 15, vit: 0 });
  });

  test('entities that repeat an id get new ids, the first keeps its own, and seq ends above them all', () => {
    const save = parseRaw({ schema: SCHEMA, seq: 5, hunters: [
      { id: 'h7', name: 'First', items: [adhoc({ name: 'A' }, { id: 'i300' }), adhoc({ name: 'B' }, { id: 'i300' })] },
      { id: 'h7', name: 'Second', items: [adhoc({ name: 'C' }, { id: 'i300' }), adhoc({ name: 'D' }), adhoc({ name: 'E' }, { id: 'not an id' })] },
    ] });
    expect(save.hunters.map(h => h.name)).toEqual(['First', 'Second']);
    expect(save.hunters[0]!.id).toBe(hid('h7'));
    const ids = save.hunters.flatMap(h => [h.id, ...h.items.map(i => i.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(id => /^[a-z]+\d+$/.test(id))).toBe(true);
    expect(save.hunters[0]!.items.map(i => i.id)).toEqual(['i300', 'i301']);
    expect(save.hunters[1]!.items.map(i => i.id)).toEqual(['i302', 'i0', 'i303']);
    expect(save.hunters[1]!.id).toBe(hid('h304'));
    expect(save.seq).toBe(304);
  });

  test('two hunters that share an item id each keep their weapon equipped, through two repairs', () => {
    const sword = dagger('i50');
    const save = parseRaw({ schema: SCHEMA, hunters: [
      { id: 'h1', name: 'First', items: [sword], equipped: { weapon: 'i50' } },
      { id: 'h2', name: 'Second', items: [sword], equipped: { weapon: 'i50' } },
    ] });
    const weapons = (): [string | null, string][] => save.hunters.map(h => [h.equipped.weapon, h.items[0]!.id]);
    const [first, second] = weapons();
    expect(first).toEqual(['i50', 'i50']);
    expect(second![1]).not.toBe('i50');
    expect(second![0]).toBe(second![1]);
    repairSave(save, env());
    expect(weapons()).toEqual([first!, second!]);
  });

  test('a second repair changes nothing, whatever ids the hunters of a save share or garble', () => {
    let seed = 7;
    const rand = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
    const some = <T>(make: () => T): T[] => Array.from({ length: Math.floor(rand() * 3) }, make);
    const ITEMS = ['i1', 'i2', 'not an id', undefined], TITLES = ['t1', 't2', 'title'], QUESTS = ['q1', 'q2', 'quest'];
    const hunter = (): Raw => ({
      id: pick(['h1', 'h2']), items: some(() => ({ id: pick(ITEMS), kind: 'ref', defId: pick([DAGGER_DEF_ID, 'b:knights-aegis']), qty: 1 })),
      equipped: { weapon: pick(ITEMS), offhand: pick(ITEMS) },
      titles: some(() => ({ id: pick(TITLES), name: 'Brave' })), titleId: pick(TITLES),
      quests: some(() => ({ id: pick(QUESTS), kind: pick(['penalty', 'job']), status: pick(['active', 'failed']) })),
      penalty: { days: 1, questId: pick(QUESTS) },
      jobChain: { id: 'jc1', job: 'Mage', step: 1, status: 'active', questId: pick(QUESTS) },
      loadouts: some(() => ({ id: pick(['lo1', 'lo2']), name: 'Set', slots: { weapon: pick(ITEMS), offhand: pick(ITEMS) } })),
    });
    for (let n = 0; n < 300; n++) {
      const stored = { schema: SCHEMA, hunters: Array.from({ length: 1 + Math.floor(rand() * 3) }, hunter) };
      const save = parseRaw(stored);
      const once = copy(save);
      repairSave(save, env());
      expect(save, `the stored save was ${JSON.stringify(stored)}`).toEqual(once);
    }
  });

  test('an id ending in a number too large to count from is replaced, so new ids never repeat', () => {
    const save = parseRaw({ schema: SCHEMA, seq: 1e300, hunters: [{ id: 'h99999999999999999999999', name: 'Big' }, { name: 'Next' }, { name: 'Last' }] });
    const ids = save.hunters.map(h => h.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every(id => /^h\d{1,16}$/.test(id))).toBe(true);
    expect(Number.isSafeInteger(save.seq)).toBe(true);
    const again = copy(save);
    expect(repairSave(save, env())).toEqual(again);
  });

  test('an active hunter that does not exist becomes the first hunter', () => {
    const save = parseRaw({ schema: SCHEMA, settings: { activeHunterId: 'h999' }, hunters: [{ id: 'h3', name: 'A' }, { id: 'h4', name: 'B' }] });
    expect(save.settings.activeHunterId).toBe(hid('h3'));
  });

  test('the hunter a player\'s phone sends its room is one of the save\'s: one that is gone is dropped, and a save in a room sends its active hunter', () => {
    const two = [{ id: 'h3', name: 'A' }, { id: 'h4', name: 'B' }];
    const inRoom = parseRaw({ schema: SCHEMA, settings: { activeHunterId: 'h4', sync: { room: 'ABCDEF', boundHunterId: 'h999' } }, hunters: two });
    expect(inRoom.settings.sync.boundHunterId, 'a deleted hunter is never sent: the active one is').toBe(hid('h4'));
    const alone = parseRaw({ schema: SCHEMA, settings: { activeHunterId: 'h4', sync: { room: null, boundHunterId: 'h999' } }, hunters: two });
    expect('boundHunterId' in alone.settings.sync, 'out of a room no hunter is bound in its place').toBe(false);
    const kept = parseRaw({ schema: SCHEMA, settings: { activeHunterId: 'h4', sync: { room: 'ABCDEF', boundHunterId: 'h3' } }, hunters: two });
    expect(kept.settings.sync.boundHunterId, 'a hunter of the save stays bound while another is shown').toBe(hid('h3'));
  });

  test('oversized lists are cut to their caps', () => {
    const many = (n: number, make: (i: number) => Raw): Raw[] => Array.from({ length: n }, (_, i) => make(i));
    const heal = { op: 'heal', amount: { kind: 'number', value: 1 } };
    const save = parseRaw({ schema: SCHEMA,
      log: many(5000, i => ({ id: `l${i + 1}`, title: `entry ${i}` })), rolls: many(5000, i => ({ id: `r${i + 6000}` })),
      library: { items: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [customId(`stock${i}`), { name: 'Stock' }])) },
      hunters: [{ id: 'h1',
        items: [adhoc({ name: 'Wand', effects: many(100, () => heal) }, { id: 'i1' })],
        conditions: many(40, i => ({ ...SLOWED, key: `slowed-${i}` })),
        loadouts: many(100, i => ({ id: `lo${i + 30000}`, name: `Set ${i}` })) }] });
    expect(save.log).toHaveLength(RULES.logCap);
    expect(save.log[0]!.title).toBe('entry 0');
    expect(save.rolls).toHaveLength(RULES.rollCap);
    expect(Object.keys(save.library.items)).toHaveLength(200);
    const h = onlyHunter(save);
    expect(h.loadouts).toHaveLength(24);
    const wand = h.items[0]!;
    expect(wand.kind === 'adhoc' && wand.item.effects).toHaveLength(ITEM_BOUNDS.effects);
    expect(h.conditions).toHaveLength(MAX_STATUSES);
  });

  test('the log cap comes from the rules stored in the save itself', () => {
    const log = Array.from({ length: 10 }, (_, i) => ({ id: `l${i + 1}` }));
    expect(parseRaw({ schema: SCHEMA, hunters: [], rulesOverrides: { logCap: 3 }, log }).log).toHaveLength(3);
  });
});

describe('what a repair fixes', () => {
  test('a stored life keeps only the fields of its state, within bounds', () => {
    const life = (v: unknown) => onlyHunter(parseRaw(withHunter({ life: v }))).life;
    expect(life({ at: 'dying', successes: 1, failures: 2 }), 'a life from before death saves went away does not read').toEqual(life({ at: 'zombie' }));
    expect(life({ at: 'up', hp: 12.4 })).toEqual({ at: 'up', hp: 12 });
    expect(life({ at: 'dead', hp: 9 })).toEqual({ at: 'dead' });
    expect(life({ at: 'up', hp: 0 }), 'up means at least 1 HP').toEqual({ at: 'up', hp: 1 });
  });

  test('a life that does not read is up at the full HP of the hunter\'s own sheet', () => {
    // Base stats at level 1: hpBase; the GM's +5 to max HP adds to it.
    const h = onlyHunter(parseRaw(withHunter({ life: { at: 'zombie' }, hpAdj: 5 })));
    expect(h.life).toEqual({ at: 'up', hp: RULES.fight.hpBase + 5 });
  });

  test('a hunter\'s uses spent this rest keep each ability\'s count within the rules\' uses, and junk is none spent', () => {
    const used = (v: unknown) => onlyHunter(parseRaw(withHunter({ used: v }))).used;
    expect(used({ stormfront: 1, 'celestial-sea': 50, dash: 0, x: 'one' })).toEqual({ stormfront: 1, 'celestial-sea': RULES.fight.kit.fightUses });
    expect(used('lots')).toEqual({});
    expect(onlyHunter(parseRaw({ schema: SCHEMA, hunters: [newHunter()] })).used).toEqual({});
  });

  test('a hunter stored before the revive ladder, or with a standing that is none of the three, has its free System raise left', () => {
    const left = (v: unknown) => onlyHunter(parseRaw(withHunter({ reviveLeft: v }))).reviveLeft;
    expect([left('debt'), left('none'), left('free')]).toEqual(['debt', 'none', 'free']);
    expect([left('twice'), left(2), left(null)]).toEqual(['free', 'free', 'free']);
    const { reviveLeft: _, ...before } = newHunter();
    expect(onlyHunter(parseRaw({ schema: SCHEMA, hunters: [before] })).reviveLeft).toBe('free');
  });

  test('the peak level is never below the level, and non-object spent reads as empty', () => {
    const h = onlyHunter(parseRaw(withHunter({ level: 5, peakLevel: 2, spent: -4, bonusPoints: -2 })));
    expect(h).toMatchObject({ level: 5, peakLevel: 5, spent: {}, bonusPoints: -2 });
  });

  test('the count of sessions the GM started is kept, and a save without one starts at none', () => {
    expect(parseRaw({ schema: SCHEMA, hunters: [], world: { day: 9, session: 12 } }).world).toMatchObject({ day: 9, session: 12 });
    expect(parseRaw({ schema: SCHEMA, hunters: [], world: { day: 9 } }).world.session).toBe(0);
  });

  test('a value outside its list falls back to the default of that field', () => {
    const save = parseRaw({ schema: SCHEMA, settings: { mode: 'admin', dailyResetHour: 99 }, world: { day: -2, session: -3 },
      hunters: [{ id: 'h1', rank: 'Z', emblem: 'unicorn', color: 'red',
        quests: [{ id: 'q1', kind: 'weird', status: 'lost', from: 'nobody' }], skills: [{ id: 's1', name: 'Dash', type: 'aura' }],
        items: [adhoc({ name: 'Gun', rar: 'godly', type: 'gun', slot: 'tail' }, { id: 'i1' })],
        shadows: [{ id: 'sh1', rank: 'Q', grade: 'King', archetype: 'dragon', hp: -5 }] }],
      gates: [{ id: 'g1', rank: 'X', type: 'blue', status: 'open' }], monsters: [{ id: 'm1', rank: 'F' }],
      log: [{ id: 'l1', kind: 'gossip' }] });
    expect(save.settings).toMatchObject({ mode: 'player', dailyResetHour: 23 });
    expect(save.world).toMatchObject({ day: 1, session: 0 });
    const h = onlyHunter(save);
    expect(h).toMatchObject({ rank: 'E', emblem: '', color: '' });
    expect(h.quests[0]).toMatchObject({ kind: 'side', status: 'active', from: 'self' });
    expect(h.skills[0]).toMatchObject({ type: 'active' });
    expect(h.items[0]).toMatchObject({ kind: 'adhoc', qty: 1, item: { rar: 'common', type: 'misc', slot: null } });
    expect(h.shadows[0]).toMatchObject({ rank: 'E', grade: 'Normal', archetype: 'brute', hp: 0 });
    expect(save.gates[0]).toMatchObject({ rank: 'E', type: 'normal', status: 'detected' });
    expect(save.monsters[0]).toMatchObject({ rank: 'E' });
    expect(save.log[0]!.kind).toBe('system');
  });

  test('gear and a title that point at nothing are cleared, and a real one stays', () => {
    const h = onlyHunter(parseRaw(withHunter({ items: [dagger('i1')], equipped: { weapon: 'i1', head: 'i404' },
      titles: [{ id: 't1', name: 'Brave' }], titleId: 't404',
      loadouts: [{ id: 'lo1', name: '  Raid   set  ', slots: { weapon: 'i1', offhand: 'i1', head: 'i404' } }] })));
    expect(h.equipped.weapon).toBe(iid('i1'));
    expect(h.equipped.head).toBeNull();
    expect(h.titleId).toBeNull();
    expect(h.loadouts[0]).toMatchObject({ name: 'Raid set', slots: { weapon: 'i1' } });
    expect(Object.keys(h.loadouts[0]!.slots)).toEqual(['weapon']);
  });

  test('a title\'s bonus keeps each bonus key (a stat, max mana, speed, Lethality) with a number, and drops any other key', () => {
    const h = onlyHunter(parseRaw(withHunter({ titles: [{ id: 't1', name: 'Brave', bonus: { str: 2, manaMax: 3, hpMax: 'x', ac: 1, dex: 2, speed: 5, pre: 1, armorPenFlat: 4, weight: 3, phys: 2 } }] })));
    expect(h.titles[0]!.bonus).toEqual({ str: 2, manaMax: 3, speed: 5, pre: 1, armorPenFlat: 4 });
  });

  test('a title keeps the rule title\'s key it was given from, and a key that is not one is dropped', () => {
    const h = onlyHunter(parseRaw(withHunter({ titles: [{ id: 't1', name: 'Pack Breaker', seedKey: 'wolf-slayer' }, { id: 't2', name: 'Odd', seedKey: 'Not A Key!' }] })));
    expect(h.titles.map(t => t.seedKey)).toEqual(['wolf-slayer', undefined]);
  });

  test('spent keeps whole positive counts on stats that exist and reads a non-object as empty; signed pending clamps negative take-backs to -undoableOn', () => {
    const h = onlyHunter(parseRaw(withHunter({
      stats: { ...BASE_STATS, str: 14, vit: 3 },
      spent: { str: 4, vit: 5, agi: 0, ins: -2, pow: 'x', luck: 3, ctl: 1.6 },
      pending: { str: -10, vit: -10, agi: 2, dis: -3, pow: 'x', luck: 4, ctl: 1.6 },
    })));
    expect(h.spent).toEqual({ str: 4, vit: 5, ctl: 2 });
    // str undoableOn = min(4, 14 - 1) = 4; vit undoableOn = min(5, 3 - 1) = 2; dis spent 0 so -3 clamps to 0.
    expect(h.pending).toEqual({ str: -4, vit: -2, agi: 2, ctl: 2 });
    expect(onlyHunter(parseRaw(withHunter({ spent: 12 }))).spent).toEqual({});
  });

  test('an unknown hunter field survives round-trip untouched and grants no bonuses', () => {
    const extraField = { path: 'vanguard', picks: [0, 1, 0] };
    const save = parseRaw(withHunter({ build: extraField, skills: [{ id: 's9', name: 'Sprint' }] }));
    const h = onlyHunter(save);
    expect((h as unknown as Record<string, unknown>).build).toEqual(extraField);
    expect(h.skills.map(k => k.name)).toEqual(['Sprint']);
    const roundTripped = onlyHunter(parseRaw(JSON.parse(JSON.stringify(save))));
    expect((roundTripped as unknown as Record<string, unknown>).build).toEqual(extraField);
  });

  test('unknown rulesOverrides keys are dropped cleanly while keeping valid sibling overrides', () => {
    const save = parseRaw({
      schema: SCHEMA, hunters: [],
      rulesOverrides: { logCap: 42, build: { enabled: false, playerPick: false }, paths: { vanguard: { name: 'Custom' } } },
    });
    expect(save.rulesOverrides).toEqual({ logCap: 42 });
  });

  test('a condition keeps its key, def, source and rounds left; one that does not read, or a chip the hunter\'s state draws, is dropped', () => {
    const h = onlyHunter(parseRaw(withHunter({ conditions: [
      { ...POISONED, extra: 1 }, SLOWED,
      { ...POISONED, def: 'junk' }, { ...POISONED, source: { id: 'c3', tier: 12 } }, { ...POISONED, source: 'the GM' },
      { ...POISONED, rounds: -1 }, { ...POISONED, rounds: 'soon' }, { ...POISONED, key: undefined }, 'poisoned',
      { ...SLOWED, key: 'dead' }, { ...SLOWED, key: 'penalized' },
    ] })));
    expect(h.conditions).toEqual([POISONED, SLOWED] as unknown as Hunter['conditions']);
  });

  test('the bestiary\'s codex, its counted combatants and the GM\'s shop keep only entries of their shape', () => {
    const at = '2026-01-01T00:00:00.000Z';
    const save = parseRaw({ schema: SCHEMA, hunters: [],
      codex: { 'goblin|E': { name: 'Goblin', rank: 'Z', kills: 'x', firstAt: at, lastAt: at, monsterId: 4 }, junk: 5,
        'wolf|D': { name: 'Wolf', rank: 'D', kills: 2, firstAt: at, lastAt: at, monsterId: null, room: true,
          info: { hpMax: 90, armor: 'x', resist: -4, speed: 110, abilities: ['Bite', 3, 'Howl', 'Pounce', 'Rend', 'Five'] } } },
      codexSeen: ['c1', 2, 'c3'], shop: [DAGGER_DEF_ID, { name: 'Rope', type: 'gizmo', value: 5 }, 7, 'not an id', DAGGER_DEF_ID] });
    expect(save.codex).toEqual({
      'goblin|E': { name: 'Goblin', rank: 'E', kills: 1, firstAt: at, lastAt: at, monsterId: null },
      'wolf|D': { name: 'Wolf', rank: 'D', kills: 2, firstAt: at, lastAt: at, monsterId: null, room: true,
        info: { hpMax: 90, armor: 0, resist: 0, speed: 110, abilities: ['Bite', 'Howl', 'Pounce', 'Rend'] } },
    });
    expect(save.codexSeen).toEqual(['c1', 'c3']);
    expect(save.shop, 'the shop lists item ids, each once').toEqual([DAGGER_DEF_ID]);
    const empty = parseRaw({ schema: SCHEMA, hunters: [], codex: [], codexSeen: 'x', shop: 'x' });
    expect([empty.codex, empty.codexSeen, empty.shop]).toEqual([{}, [], null]);
  });

  test('a coin in the air and a call the GM has to answer survive a reload; a coin that is not one, or names no hunter, is dropped', () => {
    const inAir = { id: 'd-asha:r12', hunter: { kind: 'local', hunterId: 'h1' }, who: 'Asha', what: 'STR check', face: 20, at: 'called', call: 'heads' };
    const call = { id: 'd-kai:r3', hunter: { kind: 'remote', remote: 'd-kai:h2' }, who: 'Kai', what: 'd20', face: 1, at: 'called', call: 'tails' };
    const noHunter = { ...inAir, id: 'd-asha:r14', hunter: { kind: 'local', hunterId: 'Asha' } };
    const save = parseRaw({ schema: SCHEMA, hunters: [], coins: [inAir, { ...inAir, id: 'd-asha:r13', face: 7 }, 'x', noHunter], calls: [call, { ...call, at: 'landed' }] });
    expect(save.coins).toEqual([inAir]);
    expect(save.calls).toEqual([call]);
    const empty = parseRaw({ schema: SCHEMA, hunters: [], coins: 'x' });
    expect([empty.coins, empty.calls]).toEqual([[], []]);
  });

  test('a quest\'s status and the time it ended agree: an active quest has none, a done or failed one has one', () => {
    const quests = [
      { id: 'q1', status: 'active', issuedAt: '2026-01-01T00:00:00.000Z', doneAt: '2026-01-02T00:00:00.000Z' },
      { id: 'q2', status: 'done', issuedAt: '2026-01-01T00:00:00.000Z', doneAt: null },
      { id: 'q3', status: 'failed', issuedAt: '2026-01-01T00:00:00.000Z', doneAt: '2026-01-03T00:00:00.000Z' },
    ];
    const h = onlyHunter(parseRaw({ schema: SCHEMA, hunters: [{ id: 'h1', quests }] }));
    expect(h.quests.map(q => [q.id, q.status, q.doneAt])).toEqual([
      ['q1', 'active', null], ['q2', 'done', '2026-01-01T00:00:00.000Z'], ['q3', 'failed', '2026-01-03T00:00:00.000Z'],
    ]);
  });

  test('a hunter holds at most 50 boons: past that the oldest go; a boon without a name is dropped and its text is cut to 200', () => {
    const boons = [{ id: 'bn1', name: '  ', text: 'x' }, ...Array.from({ length: 60 }, (_, i) => ({ id: `bn${i + 2}`, name: `Boon ${i}`, text: 't'.repeat(300), at: '2026-11-13T00:00:00.000Z' }))];
    const h = onlyHunter(parseRaw({ schema: SCHEMA, hunters: [{ id: 'h1', boons }] }));
    expect(h.boons).toHaveLength(50);
    expect([h.boons[0]!.name, h.boons[49]!.name, h.boons[0]!.text.length]).toEqual(['Boon 10', 'Boon 59', 200]);
    expect(onlyHunter(parseRaw({ schema: SCHEMA, hunters: [{ id: 'h1', boons: 'x' }] })).boons).toEqual([]);
    const [favor] = onlyHunter(parseRaw({ schema: SCHEMA, hunters: [{ id: 'h1', boons: [{ name: 'Favor' }] }] })).boons;
    expect(favor).toMatchObject({ name: 'Favor', text: '', at: '' });
    expect(favor!.id).toMatch(/^bn\d+$/);
  });

  test('the GM\'s reward bundles: each named, its rewards read by parseRewards, an id each, at most 200', () => {
    const library = { rewards: [
      { id: 'rb1', name: ' Boss loot ', rewards: { xp: 500, boons: [{ name: 'Favor' }], fame: 3 } },
      { id: 'rb1', name: 'Same id', rewards: 'x' }, { name: '', rewards: { xp: 1 } }, 'junk',
    ] };
    const kept = parseRaw({ schema: SCHEMA, hunters: [], library }).library.rewards;
    expect(kept.map(b => b.name)).toEqual(['Boss loot', 'Same id']);
    expect(kept[0]).toMatchObject({ id: 'rb1', rewards: { xp: 500, boons: [{ name: 'Favor', text: '' }] } });
    expect(kept[0]!.rewards).not.toHaveProperty('fame');
    expect(kept[1]!.rewards).toEqual({ xp: 0, points: 0, gold: 0, crystal: 0, items: [], title: null, job: null, skills: [], statuses: [], boons: [] });
    expect(kept[1]!.id).not.toBe(rbid('rb1'));
    const many = Array.from({ length: 250 }, (_, i) => ({ id: `rb${i + 1}`, name: `B${i}`, rewards: {} }));
    expect(parseRaw({ schema: SCHEMA, hunters: [], library: { rewards: many } }).library.rewards).toHaveLength(200);
    expect(parseRaw({ schema: SCHEMA, hunters: [], library: {} }).library.rewards).toEqual([]);
  });

  test('the GM\'s battle maps: each named, read by parseBattleMap, an id each, at most 50', () => {
    const library = { maps: [{ id: 'mp1', name: ' Crypt ', w: 6, h: 4, tiles: '#'.repeat(24), fog: true, mood: 'grim' }, { name: '' }, 'junk', { name: 'Field' }] };
    const kept = parseRaw({ schema: SCHEMA, hunters: [], library }).library.maps;
    expect(kept.map(m => [m.name, m.w, m.h, m.fog])).toEqual([['Crypt', 6, 4, true], ['Field', RULES.fight.grid.w, RULES.fight.grid.h, false]]);
    expect(kept[0]).not.toHaveProperty('mood');
    expect(kept[1]!.id).toMatch(/^mp/);
    const many = Array.from({ length: 60 }, (_, i) => ({ id: `mp${i + 1}`, name: `M${i}` }));
    expect(parseRaw({ schema: SCHEMA, hunters: [], library: { maps: many } }).library.maps).toHaveLength(50);
    expect(parseRaw({ schema: SCHEMA, hunters: [], library: {} }).library.maps).toEqual([]);
  });

  test('the GM\'s stories: each read by parseStory (a name and a chapter with a window title), an id each, at most 30', () => {
    const chapter = { words: { title: 'The deep has noticed you', line: 'A voice offers strength.' }, rewards: { points: -1, fame: 3 }, secret: 1 };
    const library = { stories: [
      { id: 'st1', name: ' The deep ', for: 'hunters', chapters: [chapter, { name: 'No title' }] },
      { id: 'st1', name: 'Same id', chapters: [chapter] }, { name: '', chapters: [chapter] }, { name: 'No chapters', chapters: [{ name: 'x' }] }, 'junk',
    ] };
    const kept = parseRaw({ schema: SCHEMA, hunters: [], library }).library.stories;
    expect(kept.map(s => [s.name, s.for, s.chapters.length])).toEqual([['The deep', 'hunters', 1], ['Same id', 'table', 1]]);
    expect(kept[0]!.chapters[0]).toEqual({ name: '', words: { title: 'THE DEEP HAS NOTICED YOU', line: 'A voice offers strength.' }, rewards: { ...newRewards(), points: -1 }, quest: null, note: '' });
    const [first, second] = kept.map(s => String(s.id));
    expect(first).toBe('st1');
    expect(second).toMatch(/^st\d+$/);
    expect(second).not.toBe('st1');
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `st${i + 1}`, name: `S${i}`, chapters: [chapter] }));
    expect(parseRaw({ schema: SCHEMA, hunters: [], library: { stories: many } }).library.stories).toHaveLength(30);
    expect(parseRaw({ schema: SCHEMA, hunters: [], library: {} }).library.stories).toEqual([]);
  });

  test('the stories on the table: each read by parseStoryRun, an id each; every running one kept and the newest 12 ended', () => {
    const run = (id: string, at: string, chapter = 0) => ({ id, story: 'st1', name: 'The wager', who: { at: 'hunters', refs: [{ kind: 'local', hunterId: 'h1' }, { kind: 'x' }] }, state: { at, chapter, endedAt: '2026-11-19T10:00:00.000Z', session: 2 }, opens: 2, opened: [{ chapter: 0, to: [], at: '', session: 1 }, { chapter: 'x' }] });
    const kept = parseRaw({ schema: SCHEMA, hunters: [], storyRuns: [run('sr1', 'running', 1), { id: 'sr2', story: 'st1', state: { at: 'paused', chapter: 0 } }, 'junk'] }).storyRuns;
    expect(kept).toEqual([{ id: 'sr1', story: 'st1', name: 'The wager', who: { at: 'hunters', refs: [{ kind: 'local', hunterId: 'h1' }] }, state: { at: 'running', chapter: 1 }, opens: 2, opened: [{ chapter: 0, to: [], at: '', session: 1 }] }]);
    const ended = Array.from({ length: 14 }, (_, i) => run(`sr${i + 10}`, 'ended'));
    expect(parseRaw({ schema: SCHEMA, hunters: [], storyRuns: [run('sr1', 'running'), ...ended] }).storyRuns.map(r => String(r.id))).toEqual(['sr1', ...ended.slice(2).map(r => r.id)]);
    expect(parseRaw({ schema: SCHEMA, hunters: [], storyRuns: 'none' }).storyRuns).toEqual([]);
  });

  test('a quest\'s rewards are read by parseRewards: a wrong field takes its default and a list keeps its bound', () => {
    const rewards = { xp: 'lots', gold: -40, skills: Array.from({ length: 12 }, (_, i) => ({ name: `S${i}` })), boons: [{ name: '' }, { name: 'Favor', text: 'One free question.' }] };
    const q = onlyHunter(parseRaw({ schema: SCHEMA, hunters: [{ id: 'h1', quests: [{ id: 'q1', rewards }] }] })).quests[0]!;
    expect(q.rewards).toMatchObject({ xp: 0, gold: -40, statuses: [], boons: [{ name: 'Favor', text: 'One free question.' }] });
    expect(q.rewards.skills.map(s => s.name)).toEqual(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']);
  });

  test('a quest is read back secret only when it is from the GM and says true; a save from before the field reads not secret', () => {
    const quests = [
      { id: 'q1', from: 'gm', secret: true }, { id: 'q2', from: 'self', secret: true }, { id: 'q3', from: 'system', secret: true },
      { id: 'q4', from: 'gm', secret: 'yes' }, { id: 'q5', from: 'gm' },
    ];
    const h = onlyHunter(parseRaw({ schema: SCHEMA, hunters: [{ id: 'h1', quests }] }));
    expect(h.quests.map(q => [q.id, q.secret])).toEqual([['q1', true], ['q2', false], ['q3', false], ['q4', false], ['q5', false]]);
  });

  test('the offers a phone keeps are read back whole; one that does not read is dropped, and a giver\'s is never dropped for a count', () => {
    const offer = { id: 'd-p1-mabc12xyz', room: 'ABCDEF', at: '2026-11-12T12:00:00.000Z', by: 'd-p1:h1', to: 'd-p2:h3', names: { by: 'Brakk', to: 'Mira' },
      gives: { gold: 5, items: [] }, asks: { gold: 0, items: [{ id: 'i4', qty: 1, name: 'Iron Shield' }] } };
    const givers = Array.from({ length: 30 }, (_, i) => ({ side: 'giver', hid: 'h1', aside: { gold: 5, items: [] }, state: 'open', offer: { ...offer, id: `d-p1-m${i}` } }));
    const kept = [...givers, { side: 'taker', hid: 'h1', state: 'accepting-tried', aside: { gold: 0, items: [] }, offer }, { side: 'gm', state: 'stopping-queued', offer }];
    const junk = [{ side: 'giver', hid: 'h1', state: 'open', offer }, { side: 'taker', hid: 'h1', state: 'accepting-taken', offer: { ...offer, id: 'x-e' }, aside: { gold: 0, items: [] } },
      { side: 'taker', hid: 'h1', state: 'nowhere', offer }, { side: 'gm', state: 'open', offer: { ...offer, gives: { gold: 0, items: [] } } }, 7];
    const save = parseRaw({ schema: SCHEMA, hunters: [], settings: { sync: { offers: [...kept, ...junk] } } });
    expect(save.settings.sync.offers).toEqual(kept as never);
    expect(parseRaw({ schema: SCHEMA, hunters: [], settings: { sync: { offers: 'x' } } }).settings.sync.offers).toEqual([]);
  });

  test('an optional field of the wrong kind is removed and a nullable one becomes null', () => {
    const save = parseRaw({ schema: SCHEMA,
      settings: { sync: { room: 7, gmKey: 5, gmKeys: { ABCDEF: 'key', GHJKLM: 9 }, lastRoom: 'ABCDEF', boundHunterId: 3, deviceToken: {}, joined: 1,
        outbox: [{ room: 'ABCDEF', letter: { kind: 'tomb', hid: 'h1' }, at: 'sending' }, { room: 1 }, 'x', { room: 'ABCDEF', letter: { kind: 'event', event: { type: 'roll', payload: {} } } }], applied: 'd-gm1-e1' } },
      hunters: [{ id: 'h1', penalty: 'yes', titleId: 5, daily: { lastCheckedKey: 5 },
        quests: [{ id: 'q1', doneAt: 5, dueAt: {}, chainId: 1, rewards: { job: [], items: [adhoc({ name: 'Gem', effects: 'shiny' }), 3] } }],
        skills: [{ id: 's1', name: 'Dash', label: 9 }], shadows: [{ id: 'sh1', monster: 4 }] }],
      gates: [{ id: 'g1', bossId: 4, clearedDay: 'today', monsters: [{ monsterId: 'm1', count: 2 }, 5] }],
      log: [{ id: 'l1', hunterId: 9 }], rolls: [{ id: 'r1', natural: 'x', rolls: [3, 'x', 4] }] });
    expect(save.settings.sync).toEqual({ room: null, cursor: 0, serverOk: false, deviceToken: `token-${'1'.padStart(26, '0')}`, gmKeys: { ABCDEF: 'key' }, outbox: [{ id: 'tomb h1', room: 'ABCDEF', letter: { kind: 'tomb', hid: 'h1' }, key: null, at: 'sending' }] });
    expect(parseRaw({ schema: SCHEMA, hunters: [], settings: { sync: { applied: ['d-gm1-e1', 7, 'not an id', 'd-gm1-e2'] } } }).settings.sync.applied)
      .toEqual(['d-gm1-e1', 'd-gm1-e2']);
    const h = onlyHunter(save);
    expect([h.penalty, h.titleId, h.daily.lastCheckedKey]).toEqual([null, null, null]);
    const q = h.quests[0]!;
    expect(q).toMatchObject({ doneAt: null, dueAt: null, rewards: { job: null, items: [{ kind: 'adhoc', item: { name: 'Gem' } }] } });
    expect('chainId' in q).toBe(false);
    expect(h.skills[0]).toMatchObject({ name: 'Dash', label: null });
    expect(h.shadows[0]!.monster).toBeNull();
    expect(save.gates[0]).toMatchObject({ bossId: null, monsters: [{ monsterId: 'm1', count: 2 }] });
    expect('clearedDay' in save.gates[0]!, 'only a cleared gate has a cleared day').toBe(false);
    expect(save.log[0]!.hunterId).toBeNull();
    expect(save.rolls[0]).toMatchObject({ natural: null, rolls: [3, 4] });
  });

  test('a damaged rule override is dropped at load and a good one kept, so rulesOf never reads the damaged one', () => {
    const save = parseRaw({ schema: SCHEMA, hunters: [], rulesOverrides: { xpPerLevel: 'lots', logCap: 50, luck: 3, rest: { hp: 0.3, fatigue: null } } });
    expect(save.rulesOverrides).toEqual({ logCap: 50, rest: { hp: 0.3 } });
  });

  test('the status library drops a bad key, a hunter\'s state chip, a def without a name and what is not a def', () => {
    const def = { label: 'Fine', desc: '', ops: [] };
    const statuses = { fine: def, 'Bad Key': def, 'trailing-': def, ['x'.repeat(41)]: def, dead: def, penalized: def, nameless: { desc: 'x', ops: [] }, junk: 5 };
    const save = parseRaw({ schema: SCHEMA, hunters: [], library: { items: [], statuses } });
    expect(save.library.statuses).toEqual({ fine: def });
  });

  test('the status library holds at most 200 statuses', () => {
    const statuses = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`s-${i}`, { label: `S ${i}`, desc: '', ops: [] }]));
    expect(Object.keys(parseRaw({ schema: SCHEMA, hunters: [], library: { items: [], statuses } }).library.statuses)).toHaveLength(200);
  });

  test('the GM\'s skills are kept, each read by parseSkill with an id of its own, and one without a name is dropped', () => {
    const save = parseRaw({ schema: SCHEMA, seq: 10, hunters: [], library: { items: [], statuses: {}, skills: [
      { id: 's7', name: 'Iron Will', type: 'passive', bonus: { dis: 2 }, mpCost: 3 }, { id: 's8', type: 'passive' }, { name: 'Guard', glow: 1 }, 'x',
    ] } });
    expect(save.library.skills.map(k => [k.id, k.name])).toEqual([['s7', 'Iron Will'], ['s0', 'Guard']]);
    expect(save.library.skills[0]).toMatchObject({ type: 'passive', bonus: { dis: 2 } });
    expect(save.library.skills[0]).not.toHaveProperty('mpCost');
    expect(save.library.skills[1]).not.toHaveProperty('glow');
  });

  test('the skill library holds at most 200 skills, and a save without one has an empty list', () => {
    const skills = Array.from({ length: 300 }, (_, i) => ({ id: `s${i + 1}`, name: `Skill ${i}` }));
    expect(parseRaw({ schema: SCHEMA, hunters: [], library: { items: [], statuses: {}, skills } }).library.skills).toHaveLength(200);
    expect(parseRaw({ schema: SCHEMA, hunters: [], library: { items: [] } }).library.skills).toEqual([]);
  });

  test('a hunter\'s skill keeps only a skill\'s fields and needs a name: it is read by parseSkill', () => {
    const h = onlyHunter(parseRaw(withHunter({ skills: [{ id: 's1', name: 'Dash', aura: 'blue', perk: 'vanguard' }, { id: 's2', type: 'passive' }] })));
    expect(h.skills.map(k => k.name)).toEqual(['Dash']);
    expect(h.skills[0]).not.toHaveProperty('aura');
    expect(h.skills[0]).not.toHaveProperty('perk');
  });

  test('a shadow keeps an archetype from the list and HP of 0 or more as a whole number; its max HP is not stored', () => {
    const [shadow] = onlyHunter(parseRaw(withHunter({ shadows: [{ id: 'sh1', name: 'Igris', rank: 'B', grade: 'Knight', archetype: 'skirmisher', hp: 80.6 }] }))).shadows;
    expect(shadow).toEqual({ ...newShadow(), id: 'sh1', name: 'Igris', rank: 'B', grade: 'Knight', archetype: 'skirmisher', hp: 81 });
  });

  test('a last room without a valid reason reads as left', () => {
    const last = (lastRoom: unknown) => parseRaw({ schema: SCHEMA, hunters: [], settings: { sync: { lastRoom } } }).settings.sync.lastRoom;
    expect(last({ code: 'ABCDEF' })).toEqual({ code: 'ABCDEF', why: 'left' });
    expect(last({ code: 'ABCDEF', why: 'gone' })).toEqual({ code: 'ABCDEF', why: 'gone' });
    expect(last({ code: 'ABCDEF', why: 'removed' })).toEqual({ code: 'ABCDEF', why: 'removed' });
    expect(last({ code: 'ABCDEF', why: 'banished' })).toEqual({ code: 'ABCDEF', why: 'left' });
  });

  test('a penalty tied to one of the hunter\'s quests keeps its start and whole days, and a missing start is the time of the repair', () => {
    const zone = { id: 'q5', kind: 'penalty', title: 'Penalty Zone: Survive for 4 hours' };
    expect(onlyHunter(parseRaw(withHunter({ quests: [zone], penalty: { since: '2026-11-01T00:00:00.000Z', days: 2.4, questId: 'q5' } }))).penalty)
      .toEqual({ since: '2026-11-01T00:00:00.000Z', days: 2, questId: 'q5' });
    expect(onlyHunter(parseRaw(withHunter({ quests: [zone], penalty: { questId: 'q5' } }))).penalty).toEqual({ since: NOW.toISOString(), days: 1, questId: 'q5' });
  });

  test('a penalty whose quest is gone is dropped: nothing could lift it', () => {
    expect(onlyHunter(parseRaw(withHunter({ quests: [], penalty: { since: '2026-11-01T00:00:00.000Z', days: 2, questId: 'q5' } }))).penalty).toBeNull();
  });

  test('a Job Change chain on its open step\'s quest is kept; one whose quest was failed or deleted is failed at its step', () => {
    const chain = { id: 'c1', job: 'Mage', step: 2, status: 'active', questId: 'q2' };
    const step2 = { id: 'q2', kind: 'job', chainId: 'c1', title: 'Job Change 2/3: The Job Change Dungeon' };
    expect(onlyHunter(parseRaw(withHunter({ quests: [step2], jobChain: chain }))).jobChain).toEqual(chain);
    expect(onlyHunter(parseRaw(withHunter({ quests: [{ ...step2, status: 'failed' }], jobChain: chain }))).jobChain).toEqual({ ...chain, status: 'failed' });
    expect(onlyHunter(parseRaw(withHunter({ quests: [], jobChain: chain }))).jobChain).toEqual({ ...chain, status: 'failed' });
    expect(onlyHunter(parseRaw(withHunter({ quests: [step2], jobChain: { ...chain, job: 'Baker' } }))).jobChain).toBeNull();
  });

  test('a save with no device id gets one from the device, and one that has it keeps it', () => {
    expect(parseRaw({ schema: SCHEMA, hunters: [] }).settings.deviceId).toBe(dev('d-test1'));
    expect(parseRaw({ schema: SCHEMA, hunters: [], settings: { deviceId: 'd-mine' } }).settings.deviceId).toBe(dev('d-mine'));
  });

  test('a quest\'s due time that is no time opens as no due time, and one written another way opens as its time', () => {
    const dueOf = (dueAt: unknown): string | null => onlyHunter(parseRaw(withHunter({ quests: [{ id: 'q1', kind: 'urgent', dueAt }] }))).quests[0]!.dueAt;
    expect(dueOf('tomorrow-ish')).toBeNull();
    expect(dueOf('')).toBeNull();
    expect(dueOf('+275760-09-13T00:00:00.001Z')).toBeNull();
    expect(dueOf('2026-11-15T10:00:00+02:00')).toBe('2026-11-15T08:00:00.000Z');
    expect(dueOf('2026-11-15T08:00:00.000Z')).toBe('2026-11-15T08:00:00.000Z');
  });

  test('a save is given this phone\'s device token at load, beside its device id: one it holds is kept, a missing, short or wrong one is made', () => {
    const made = `token-${'1'.padStart(26, '0')}`;
    const tokenOf = (sync: Raw): string => parseRaw({ schema: SCHEMA, hunters: [], settings: { sync } }).settings.sync.deviceToken;
    expect(tokenOf({})).toBe(made);
    expect(tokenOf({ deviceToken: 'short' })).toBe(made);
    expect(tokenOf({ deviceToken: 42 })).toBe(made);
    expect(tokenOf({ deviceToken: 'k'.repeat(32) })).toBe('k'.repeat(32));
    const save = parseRaw({ schema: SCHEMA, hunters: [] });
    expect(repairSave(structuredClone(save), env()).settings.sync.deviceToken).toBe(save.settings.sync.deviceToken);
  });

  test('a running fight is kept as the fight\'s parser reads it, and one it refuses opens as no fight with the rest of the save kept', () => {
    const fight = runningFight();
    expect(parseRaw({ schema: SCHEMA, hunters: [], fight }).fight).toEqual(fight);
    const broken = parseRaw({ schema: SCHEMA, hunters: [{ id: 'h1', name: 'Kai' }], fight: { ...fight, rows: [...fight.rows, { id: 'c9', kind: 'dragon' }] } });
    expect(broken.fight).toBeNull();
    expect(onlyHunter(broken).name).toBe('Kai');
  });
});

describe('the loot waiting for the GM (SMX-gates-1)', () => {
  const shard = { kind: 'ref', defId: LOOT_ITEMS[0]!.defId, qty: 1 };
  const loot = (drops: unknown, at: unknown = 'waiting'): Save['loot'] => parseRaw({ schema: SCHEMA, hunters: [], loot: { at, drops } }).loot;

  test('loot waiting reads back whole, in the order the fights dropped it', () => {
    const drops = [{ fight: 'f-1', gold: 900, items: [] }, { fight: 'f-2', gold: 0, items: [shard] }];
    expect(loot(drops)).toEqual({ at: 'waiting', drops: drops as never });
  });

  test('what is not waiting loot reads as none: no loot, none, an empty list, a state it does not know', () => {
    expect(parseRaw({ schema: SCHEMA, hunters: [] }).loot).toEqual({ at: 'none' });
    expect(loot([], 'waiting')).toEqual({ at: 'none' });
    expect(loot([{ fight: 'f-1', gold: 5, items: [] }], 'none')).toEqual({ at: 'none' });
    expect(loot([{ fight: 'f-1', gold: 5, items: [] }], 'later')).toEqual({ at: 'none' });
  });

  test('a drop that does not read is left out and the rest kept: no fight, gold not a whole number from 0, items not a list, nothing in it, a second drop of one fight', () => {
    const good = { fight: 'f-9', gold: 40, items: [] };
    const bad = [{ gold: 5, items: [] }, { fight: '', gold: 5, items: [] }, { fight: 'f-2', gold: 2.5, items: [] }, { fight: 'f-3', gold: -1, items: [] },
      { fight: 'f-4', gold: '5', items: [] }, { fight: 'f-5', gold: 5, items: 'Orb' }, { fight: 'f-6', gold: 0, items: [] }, 'f-7', { ...good, gold: 41 }];
    expect(loot([good, ...bad])).toEqual({ at: 'waiting', drops: [good as never] });
    expect(loot(bad.slice(0, -1))).toEqual({ at: 'none' });
  });

  test('an item of a drop is a grant read by parseItemGrant: one it refuses is left out of the drop', () => {
    expect(loot([{ fight: 'f-1', gold: 5, items: [shard, { qty: 1 }, { name: 'Orb', qty: 1 }, { ...shard, defId: 'nope' }] }])).toEqual({ at: 'waiting', drops: [{ fight: 'f-1', gold: 5, items: [shard] }] as never });
  });
});

describe('fields the types do not know', () => {
  const extras = (): Raw => ({ schema: SCHEMA, futureThing: { a: [1, 2] }, settings: { theme: 'dark', sync: { relay: 'x' } }, world: { weather: 'rain' },
    hunters: [{ id: 'h1', name: 'Kai', petName: 'Rex', stats: { luck: 3 }, items: [adhoc({ name: 'Orb' }, { id: 'i1' })],
      quests: [{ id: 'q1', title: 'Go', objectives: [{ label: 'Walk', target: 2, progress: 1, hint: 'north' }], rewards: { xp: 2 } }] }],
    monsters: [{ id: 'm1', name: 'Wolf' }], library: { shelf: 2, items: {} } });

  test('unknown keys on the save, a hunter and what a hunter holds survive a parse', () => {
    const save = parseRaw(extras());
    expect(save).toMatchObject(extras());
  });

  test('a monster keeps only a monster\'s fields: it is read by parseMonster', () => {
    const save = parseRaw({ schema: SCHEMA, hunters: [], monsters: [{ id: 'm1', name: 'Wolf', lair: 'cave' }] });
    expect(save.monsters[0]).toMatchObject({ id: 'm1', name: 'Wolf' });
    expect(save.monsters[0]).not.toHaveProperty('lair');
  });

  test('an item keeps only an item\'s fields: it is read by parseItem, wherever it is kept, and a bag line or grant keeps only its own', () => {
    const item = { name: 'Orb', glow: true }, orb = customId('orb');
    const save = parseRaw({ schema: SCHEMA, hunters: [{ id: 'h1', items: [adhoc(item, { id: 'i1', shine: 1 })], quests: [{ id: 'q1', rewards: { items: [adhoc(item, { shine: 1 })] } }] }],
      library: { items: { [orb]: item } } });
    const h = onlyHunter(save), line = h.items[0]!, grant = h.quests[0]!.rewards.items[0]!;
    for (const kept of [line.kind === 'adhoc' ? line.item : null, grant.kind === 'adhoc' ? grant.item : null, save.library.items[orb]]) {
      expect(kept).toMatchObject({ name: 'Orb' });
      expect(kept).not.toHaveProperty('glow');
      expect(kept).not.toHaveProperty('id');
    }
    for (const kept of [line, grant]) expect(kept).not.toHaveProperty('shine');
  });

  test('a quest\'s reward keeps only a reward\'s fields: it is read by parseRewards', () => {
    const h = onlyHunter(parseRaw({ schema: SCHEMA, hunters: [{ id: 'h1', quests: [{ id: 'q1', rewards: { xp: 2, fame: 2, titleName: 'Wolf Slayer' } }] }] }));
    expect(h.quests[0]!.rewards).toMatchObject({ xp: 2, title: null });
    expect(h.quests[0]!.rewards).not.toHaveProperty('fame');
    expect(h.quests[0]!.rewards).not.toHaveProperty('titleName');
  });
});

describe('a save file brought in from the Data view', () => {
  const file = (sync: Raw, extra: Raw = {}): Save => parseRaw({ schema: SCHEMA, hunters: [{ id: 'h1', name: 'Imported' }], settings: { sync }, ...extra });
  test('a file of one hunter is told from a campaign by its kind', () => {
    expect(fileKind(file({}, { kind: 'hunter' }))).toBe('hunter');
    expect(fileKind(file({}))).toBe('campaign');
    expect(fileKind(file({}, { kind: 'library' }))).toBe('campaign');
  });
});

describe('gates', () => {
  test('a stored gate is read by the gate parser: a cleared one keeps its day and what it paid, another status loses its day', () => {
    const save = parseRaw({ schema: SCHEMA, hunters: [], gates: [
      { id: 'g1', name: 'Den', status: 'cleared', clearedDay: 4, xpPaid: 150, createdDay: 2 },
      { id: 'g2', name: 'Pit', status: 'raiding', clearedDay: 4 },
      { id: 'g3', name: 'Cave', status: 'cleared', createdDay: 6 },
    ] });
    expect(save.gates[0]).toMatchObject({ id: 'g1', status: 'cleared', clearedDay: 4, xpPaid: 150 });
    expect(save.gates[1]).toMatchObject({ id: 'g2', status: 'raiding' });
    expect('clearedDay' in save.gates[1]!).toBe(false);
    // No stored day: the day the gate was created.
    expect(save.gates[2]).toMatchObject({ status: 'cleared', clearedDay: 6 });
  });

  test('a gate names a battle map by an id of 1 to 40 characters, or none', () => {
    const gates = parseRaw({ schema: SCHEMA, hunters: [], gates: [{ id: 'g1', mapId: 'mp3' }, { id: 'g2', mapId: 'x'.repeat(41) }, { id: 'g3', mapId: 7 }] }).gates;
    expect(gates.map(g => g.mapId)).toEqual(['mp3', null, null]);
  });

  test('a gate keeps only the fields a gate has', () => {
    expect(parseRaw({ schema: SCHEMA, hunters: [], gates: [{ id: 'g1', mood: 'grim' }] }).gates).toEqual([{ ...newGate(), id: 'g1' }]);
  });

  test('a gate with no id or a repeated one gets a new id, and seq ends above it', () => {
    const save = parseRaw({ schema: SCHEMA, hunters: [{ id: 'h1' }], seq: 20, gates: [{ id: 'g5', name: 'A' }, { id: 'g5', name: 'B' }, { name: 'C' }, { id: 9, name: 'D' }] });
    // 'C' and 'D' take the default id g0; the second of them repeats it, as 'B' repeats g5. Repeats count up from seq 20.
    expect(save.gates.map(g => [g.name, g.id])).toEqual([['A', 'g5'], ['B', 'g21'], ['C', 'g0'], ['D', 'g22']]);
    expect(save.seq).toBe(22);
  });
});

describe('the Hunter type', () => {
  test('a hunter missing a field does not compile', () => {
    const { gold, ...noGold } = newHunter();
    // @ts-expect-error
    const broken: Hunter = noGold;
    const whole: Hunter = { ...noGold, gold };
    expect(Object.keys(whole)).toHaveLength(Object.keys(broken).length + 1);
  });

  test('a hunter, a shadow and a monster of the save are what the sheet and the fight\'s rows read, with no change', () => {
    const h: SheetHunter & RowHunter = newHunter();
    const shadow: RowShadow = { ...newShadow(), id: 'sh1' };
    const monster: RowMonster = newMonster();
    expect(rowHp(hunterRow(h, combatantId('c1'), RULES))).toBe(RULES.fight.hpBase);
    expect(shadowRow(shadow, 'h1', combatantId('c1'), combatantId('c2'), RULES).kind).toBe('shadow');
    expect(monsterRows(monster, [combatantId('c3')], RULES)).toHaveLength(1);
  });
});

describe('the lists save.ts repeats from rules.ts', () => {
  test('rarities match the rules', () => {
    expect([...RARITIES]).toEqual(TIERS);
  });
});

describe('an ability\'s effect, by the rule or by hand (implicit audit 3, M2)', () => {
  const swing = abilityOf('strike', { id: abilityId('swing'), name: 'Swing' }, RULES);
  const library = (ability: unknown) => parseRaw({ schema: SCHEMA, hunters: [], library: { items: [], statuses: {}, skills: [{ id: 's1', name: 'Swing', type: 'active', ability }] } }).library.skills[0]!;

  test('one by the rule is saved as its ticks, not as a formula, and reads back the same', () => {
    expect(JSON.parse(JSON.stringify(swing.effect))).toEqual({ type: 'physical', by: 'rule', ticks: { scale: 'str', gap: null, scalers: [] } });
    const kept = library(copy(swing));
    expect(kept.type === 'active' ? kept.ability : null).toEqual(swing);
  });

  test('an ability effect requires an explicit `by` of rule or hand; missing or unknown `by` drops it', () => {
    const formula = formulaOf(swing, RULES)!;
    const missing = library({ ...copy(swing), effect: { type: 'physical', formula: copy(formula) } });
    expect(missing.type === 'active' ? missing.ability : 'not active').toBeNull();
    const odd = library({ ...copy(swing), effect: { type: 'physical', by: 'luck', formula: copy(formula) } });
    expect(odd.type === 'active' ? odd.ability : 'not active').toBeNull();
  });
});

describe('an ability typed with Roll20 dice', () => {
  // Advantage and a floor are a GM's text read once by parseFormula; the tree is what a save and a room message hold.
  const formula = (text: string) => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };
  const ability = abilityOf('strike', { id: abilityId('lucky'), name: 'Lucky Swing', effect: { type: 'physical', by: 'hand', formula: formula('2d20kh1 + floor(phys / 2)') } }, RULES);

  test('keeps its keep-highest dice and its floor through the GM\'s skill library', () => {
    const save = parseRaw({ schema: SCHEMA, hunters: [], library: { items: [], statuses: {}, skills: [{ id: 's1', name: 'Lucky Swing', type: 'active', ability }] } });
    const kept = save.library.skills[0]!;
    expect(kept.type === 'active' ? kept.ability : null).toEqual(ability);
    expect(printFormula(formulaOf(ability, RULES)!)).toBe('2d20kh1 + floor(phys / 2)');
  });

  test('keeps them on a fight row of a stored fight', () => {
    const fight = runningFight(), withLucky = { ...fight, rows: fight.rows.map((r, i) => i === 0 ? { ...r, abilities: [...r.abilities, ability] } : r) };
    expect(parseFight(copy(withLucky), RULES)?.rows[0]!.abilities.at(-1)).toEqual(ability);
  });

  test('a stored term with a keep past its dice is not read', () => {
    const bad = copy(ability) as unknown as { effect: { formula: { left: { mods: { cut: { n: number } } } } } };
    bad.effect.formula.left.mods.cut.n = 3;
    expect(parseAbility(bad, RULES)).toBeNull();
  });
});

describe('the ids a save keeps are read at load (audit row 87)', () => {
  test('a room code, GM key, last room or device id that is not one is not kept', () => {
    const s = parseRaw({ schema: SCHEMA, hunters: [], settings: { deviceId: 'not an id', sync: {
      room: 'abcdef', gmKey: 'two words', gmKeys: { ABCDEF: 'k'.repeat(32), nope: 'k'.repeat(32), GHJKLM: 'bad key!' }, lastRoom: { code: 'ABC', why: 'left' },
    } } });
    expect(s.settings.deviceId, 'a device id with a space is made again').toBe(dev('d-test1'));
    expect(s.settings.sync.room).toBeNull();
    expect('gmKey' in s.settings.sync).toBe(false);
    expect(s.settings.sync.gmKeys).toEqual({ ABCDEF: gmKey('k'.repeat(32)) });
    expect('lastRoom' in s.settings.sync).toBe(false);
  });

  test('a room code, GM key and last room that read are kept as they were', () => {
    const s = parseRaw({ schema: SCHEMA, hunters: [], settings: { deviceId: 'd-mine', sync: { room: 'ABCDEF', gmKey: 'k'.repeat(32), lastRoom: { code: 'GHJKLM', why: 'removed' } } } });
    expect([s.settings.deviceId, s.settings.sync.room, s.settings.sync.gmKey, s.settings.sync.lastRoom]).toEqual([dev('d-mine'), room('ABCDEF'), gmKey('k'.repeat(32)), { code: room('GHJKLM'), why: 'removed' }]);
  });

  test('a log line names a hunter only by a save id; anything else is a line about the campaign', () => {
    const s = parseRaw({ schema: SCHEMA, hunters: [], log: [{ id: 'l1', hunterId: 'h1' }, { id: 'l2', hunterId: 'Ana' }, { id: 'l3', hunterId: 4 }] });
    expect(s.log.map(l => l.hunterId)).toEqual([hid('h1'), null, null]);
  });

  test('a Job Change chain whose quest id is not a save id is no chain', () => {
    const chain = { id: 'c1', job: 'Ranger', step: 1, status: 'active' };
    expect(onlyHunter(parseRaw(withHunter({ jobChain: { ...chain, questId: 'quest one' } }))).jobChain).toBeNull();
    expect(onlyHunter(parseRaw(withHunter({ quests: [{ id: 'q5' }], jobChain: { ...chain, questId: 'q5' } }))).jobChain).toMatchObject({ questId: qid('q5'), status: 'active' });
  });
});

describe('where this phone stopped reading a room is read at load (notes-5-trade.md 11)', () => {
  test('a place younger than a room\'s 30 days is kept; an older one, and one that is not a code with a seq and a time, is dropped', () => {
    const day = 24 * 3600 * 1000, ago = (days: number) => new Date(NOW.getTime() - days * day).toISOString();
    const s = parseRaw({ schema: SCHEMA, hunters: [], settings: { sync: { seen: { ABCDE2: { seq: 41, at: ago(29) }, BCDEF3: { seq: 7, at: ago(31) }, nope: { seq: 1, at: ago(1) }, CDEFG4: { seq: 'x', at: ago(1) } } } } });
    expect(s.settings.sync.seen).toEqual({ ABCDE2: { seq: 41, at: ago(29) } } as never);
  });
});

describe('a roll in the roll log keeps who rolled it, what for, and a check\'s result (audit rows 23, 24, 79)', () => {
  test('a stored roll keeps its hunter id, kind and check', () => {
    const s = parseRaw({ schema: SCHEMA, hunters: [], rolls: [{ id: 'r1', hid: 'h4', who: 'Ana', kind: 'check', check: { dc: 15, success: true } }] });
    expect(s.rolls[0]).toMatchObject({ hid: hid('h4'), who: 'Ana', kind: 'check', check: { dc: 15, success: true } });
  });

  test('a hunter id that is not one is the GM\'s roll, a kind not in the list a rule\'s own, and only a check holds a result', () => {
    const s = parseRaw({ schema: SCHEMA, hunters: [], rolls: [
      { id: 'r1', hid: 'Ana', kind: 'damage', check: { dc: 15, success: true } },
      { id: 'r2', kind: 'check', check: { dc: 'high', success: true } },
      { id: 'r3' },
    ] });
    expect(s.rolls.map(r => [r.hid, r.kind, r.check])).toEqual([[null, 'other', null], [null, 'check', null], [null, 'other', null]]);
  });
});

describe('a day key is read at load (U5 left it to U14)', () => {
  test('a stored day key that is not a date is none; the world\'s last daily day is then the day the save is read on', () => {
    const s = parseRaw({ schema: SCHEMA, hunters: [{ id: 'h1', daily: { streak: 2, lastCompleteKey: 'yesterday', lastCheckedKey: '2026-11-11' } }], world: { lastDailyKey: 'Tuesday' } });
    expect([s.hunters[0]!.daily.lastCompleteKey, s.hunters[0]!.daily.lastCheckedKey]).toEqual([null, day('2026-11-11')]);
    expect(s.world.lastDailyKey).toBe(dayKey(NOW, 0));
  });
});

describe('this phone\'s identity stays on this phone (IO1)', () => {
  const mine = freshSave({ now: new Date(0), newDeviceToken: () => 'mine-token-0123456789abcdefghijkl', newDeviceId: () => dev('d-mine') }, { onboarded: true });
  const theirs = freshSave({ now: new Date(0), newDeviceToken: () => 'their-token-0123456789abcdefghijk', newDeviceId: () => dev('d-theirs') }, { onboarded: true });
  const keyed = { ...mine, settings: { ...mine.settings, sync: { ...mine.settings.sync, gmKey: gmKey('gm-key-1'), gmKeys: { ABCD23: gmKey('gm-key-1') } } } };

  test('an exported campaign carries no device id and no device token, and its GM keys only when asked', () => {
    const file = JSON.parse(JSON.stringify(exportedSave(keyed, false)));
    expect([file.settings.deviceId, file.settings.sync.deviceToken, file.settings.sync.gmKey, file.settings.sync.gmKeys]).toEqual([undefined, undefined, undefined, undefined]);
    const withKeys = JSON.parse(JSON.stringify(exportedSave(keyed, true)));
    expect([withKeys.settings.sync.gmKey, withKeys.settings.sync.deviceToken]).toEqual(['gm-key-1', undefined]);
    expect(file.hunters).toEqual(JSON.parse(JSON.stringify(keyed.hunters)));
  });

  test('a campaign swapped in keeps this phone\'s device id and token, whatever it held', () => {
    const next = keepPhone(theirs, mine);
    expect([next.settings.deviceId as string, next.settings.sync.deviceToken]).toEqual(['d-mine', 'mine-token-0123456789abcdefghijkl']);
    expect(next.hunters).toEqual(theirs.hunters);
  });

  test('round trip: a file read back on another phone is that phone to the room', () => {
    const read = parseSave(JSON.stringify(exportedSave(keyed, false)), { now: new Date(0), newDeviceToken: () => 'fresh-token-0123456789abcdefghijk', newDeviceId: () => dev('d-fresh') });
    if (read.kind !== 'save') throw new Error(`read as ${read.kind}`);
    expect(keepPhone(read.save, theirs).settings.deviceId).toBe(dev('d-theirs'));
  });
});

describe('the phone\'s sync fields and the campaign\'s (audit BUG-sync-3)', () => {
  const kA = gmKey('a'.repeat(32)), kB = gmKey('b'.repeat(32)), kC = gmKey('c'.repeat(32)), kX = gmKey('x'.repeat(32));
  /** Every field of the sync settings, each holding a value marked with whose save it came from. */
  const syncOf = (tag: string, at: RoomCode, keys: Record<string, GmKey>): SyncSettings => ({
    room: at, cursor: tag === 'mine' ? 40 : 7, serverOk: tag === 'mine', deviceToken: `${tag}-token-0123456789abcdefghij`,
    gmKey: keys[at] ?? null, gmKeys: keys, lastRoom: { code: at, why: 'left' }, boundHunterId: hid(tag === 'mine' ? 'h1' : 'h2'),
    joined: { room: at, at: `${tag}-joined` }, outbox: [`${tag}-letter`] as never, held: [`${tag}-held`] as never, applied: [`${tag}-applied`] as never,
    asked: [`${tag}-run`] as never, offers: [`${tag}-offer`] as never, seen: { [`${tag}`]: { seq: 1, at: 'then' } } as never,
    weights: { room: at, hunters: { [hid(tag === 'mine' ? 'h1' : 'h2')]: { total: tag === 'mine' ? 3 : -2, force: 20 } } },
  });
  const saveOf = (tag: string, sync: SyncSettings): Save => {
    const s = freshSave({ now: NOW, newDeviceToken: () => sync.deviceToken, newDeviceId: () => dev(`d-${tag}`) }, { onboarded: true });
    return { ...s, settings: { ...s.settings, sync } };
  };
  const mine = saveOf('mine', syncOf('mine', room('AAAAAA'), { AAAAAA: kA, BBBBBB: kB }));
  const theirs = saveOf('theirs', syncOf('theirs', room('CCCCCC'), { CCCCCC: kC, AAAAAA: kX }));
  const phoneFields = (tag: string) => ({
    serverOk: tag === 'mine', deviceToken: `${tag}-token-0123456789abcdefghij`, joined: { room: tag === 'mine' ? 'AAAAAA' : 'CCCCCC', at: `${tag}-joined` }, outbox: [`${tag}-letter`], held: [`${tag}-held`],
    applied: [`${tag}-applied`], asked: [`${tag}-run`], offers: [`${tag}-offer`], seen: { [tag]: { seq: 1, at: 'then' } },
    weights: { room: tag === 'mine' ? 'AAAAAA' : 'CCCCCC', hunters: { [tag === 'mine' ? 'h1' : 'h2']: { total: tag === 'mine' ? 3 : -2, force: 20 } } },
  });

  test('a campaign file holds its room, its place there and its bound hunter, and nothing of this phone\'s dealings with rooms', () => {
    const file = JSON.parse(JSON.stringify(exportedSave(mine, false)));
    expect(file.settings.sync).toEqual({ room: 'AAAAAA', cursor: 40, lastRoom: { code: 'AAAAAA', why: 'left' }, boundHunterId: 'h1' });
    const keyed = JSON.parse(JSON.stringify(exportedSave(mine, true)));
    expect(keyed.settings.sync).toEqual({ room: 'AAAAAA', cursor: 40, lastRoom: { code: 'AAAAAA', why: 'left' }, boundHunterId: 'h1', gmKey: kA, gmKeys: { AAAAAA: kA, BBBBBB: kB } });
  });

  test('no file holds the table weight: a player\'s weights are in no campaign file, with or without keys, nor in a hunter\'s file, and stay on the phone through a swap', () => {
    for (const withKeys of [false, true]) {
      const text = JSON.stringify(exportedSave(mine, withKeys));
      expect([text.includes('"weights"'), JSON.parse(text).tableWeight], `exported ${withKeys ? 'with' : 'without'} keys`).toEqual([false, mine.tableWeight]);
    }
    const hunterFile = JSON.stringify({ schema: SCHEMA, kind: 'hunter', savedAt: NOW.toISOString(), hunters: [mine.hunters[0]] });
    expect(hunterFile.includes('"weights"') || hunterFile.includes('"total"'), 'the Data view\'s hunter file holds the hunter alone').toBe(false);
    expect(keepPhone(theirs, mine).settings.sync.weights).toEqual(mine.settings.sync.weights);
  });

  test('a save swapped in keeps every one of this phone\'s sync fields and takes the campaign\'s room, place and bound hunter', () => {
    const { gmKey: _key, gmKeys: _ring, ...sync } = keepPhone(theirs, mine).settings.sync;
    expect(sync).toEqual({ room: room('CCCCCC'), cursor: 7, lastRoom: { code: room('CCCCCC'), why: 'left' }, boundHunterId: hid('h2'), ...phoneFields('mine') } as never);
  });

  test('a file of another room adds its GM keys to this phone\'s ring: the phone keeps its own key for a room both hold', () => {
    const sync = keepPhone(theirs, mine).settings.sync;
    expect(sync.gmKeys).toEqual({ AAAAAA: kA, BBBBBB: kB, CCCCCC: kC });
    expect(sync.gmKey).toBe(kC);
  });

  test('a file of another room exported without keys leaves this phone\'s ring whole, and the phone is GM of a room it holds the key of', () => {
    const plain = (code: string): Save => JSON.parse(JSON.stringify(exportedSave(saveOf('theirs', syncOf('theirs', room(code), {})), false)));
    const other = keepPhone(plain('CCCCCC'), mine).settings.sync;
    expect([other.gmKeys, other.gmKey]).toEqual([{ AAAAAA: kA, BBBBBB: kB }, null]);
    const held = keepPhone(plain('BBBBBB'), mine).settings.sync;
    expect([held.gmKeys, held.gmKey]).toEqual([{ AAAAAA: kA, BBBBBB: kB }, kB]);
    const same = keepPhone(plain('AAAAAA'), mine).settings.sync;
    expect([same.gmKeys, same.gmKey]).toEqual([{ AAAAAA: kA, BBBBBB: kB }, kA]);
  });

  test('a ring at its cap keeps every key of this phone\'s own when a file brings more', () => {
    const codes = ['AAAAAB', 'AAAAAC', 'AAAAAD', 'AAAAAE', 'AAAAAF', 'AAAAAG', 'AAAAAH', 'AAAAAJ', 'AAAAAK', 'AAAAAL'];
    expect(codes.length).toBe(KEYS_MAX);
    const full = Object.fromEntries(codes.map(c => [c, kA]));
    const sync = keepPhone(theirs, saveOf('mine', syncOf('mine', room('AAAAAB'), full))).settings.sync;
    expect(sync.gmKeys).toEqual(full);
    expect(sync.gmKey).toBe(kC);
  });
});

describe('a hunter\'s job as the save keeps it (H9)', () => {
  test('a job is kept as its name; un-held unique names, blanks, non-strings and "None" read as null', () => {
    const read = (job: unknown) => parseSheetHunter({ ...newHunter(RULES), id: 'h1', job })?.job;
    expect([read('Mage'), read('  Blade   Dancer '), read('  Shadow   Monarch '), read('Hemomancer'), read(''), read('None'), read(7), read(null)]).toEqual(['Mage', 'Blade Dancer', null, null, null, null, null, null]);
  });
});

describe('creating a hunter purely inside a save step (createHunter, makeHunter)', () => {
  test('createHunter advances seq by 2, assigns hunter and daily quest ids, sets activeHunterId, and does not mutate the input save', () => {
    const base = freshSave({ now: NOW, newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-test') }, { onboarded: true });
    const snapshot = JSON.stringify(base);
    const { save, hunter } = createHunter(base, 'Aria', RULES, NOW);
    expect(JSON.stringify(base)).toBe(snapshot);
    expect(save.seq).toBe(base.seq + 2);
    expect(hunter.id).toBe(hid(`h${base.seq + 1}`));
    expect(hunter.name).toBe('Aria');
    expect(hunter.quests).toHaveLength(1);
    expect([hunter.quests[0]!.id, hunter.quests[0]!.kind]).toEqual([qid(`q${base.seq + 2}`), 'daily']);
    expect(hunter.daily.lastCheckedKey).toBe(dayKey(NOW, base.settings.dailyResetHour));
    expect(save.settings.activeHunterId).toBe(hunter.id);
    expect(save.hunters.at(-1)).toEqual(hunter);
  });

  test('makeHunter defaults blank names to Hunter and cuts long names to 60 characters', () => {
    const base = freshSave({ now: NOW, newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-test') }, { onboarded: true });
    expect(makeHunter(base, '', RULES, NOW).hunter.name).toBe('Hunter');
    expect(makeHunter(base, 'x'.repeat(80), RULES, NOW).hunter.name).toHaveLength(60);
  });
});
