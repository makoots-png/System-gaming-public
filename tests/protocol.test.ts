import { describe, expect, test } from 'bun:test';
import { DOCS, DOC_MAX, EVENTS, EVENT_TYPES, newEvent, onTurn, parseDocName, parseEvent, parseRoomState, parseSheet, SHEET_MAX, speaksFor, useRoute } from '../src/core/protocol.ts';
import type { EventType, SheetKey } from '../src/core/protocol.ts';
import { newHunter } from '../src/core/save.ts';
import { RULES } from '../src/core/rules.ts';
import { SHOP_ITEMS, parseItem } from '../src/core/registry/items.ts';
import { parseMonster, seedMonsters } from '../src/core/registry/monsters.ts';
import { soloDoc } from '../src/core/gates/solo.ts';
import { worldDoc } from '../src/core/gates/world.ts';
import { newGate } from '../src/core/gates/gate.ts';
import type { Gate, GateId } from '../src/core/gates/gate.ts';
import type { Monster } from '../src/core/registry/monsters.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import { DOC_AHEAD, DOC_DEFS_MAX, DOC_LOG, DOC_ROWS, DOC_STATUSES, DOC_TILES_MAX, DOC_ZONE_RUNS, fightWire, packBits } from '../src/core/combat/fight-doc.ts';
import { MAX_ZONES } from '../src/core/combat/zones.ts';
import { LOG_LINE_MAX, MAX_STATUSES } from '../src/core/combat/fight-types.ts';
import type { Fight } from '../src/core/combat/fight-types.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { parseFormula } from '../src/core/formula.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { abilityId } from '../src/core/combat/ability-types.ts';
import { NAME_MAX } from '../src/core/combat/fight-types.ts';

type Raw = Record<string, any>;

const KEY = 'd-player1:h1', OTHER = 'd-player2:h4';
const EID = 'd-gm1-mabc12xyz';
const BIG = 'x'.repeat(10 * 1024 * 1024);
const many = <T>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
/** The payload of `type` as the parser reads it, or null. */
const payload = (type: string, p: unknown): Raw | null => (parseEvent(type, p)?.payload as Raw | undefined) ?? null;
/** A sheet key, as a test may make one. */
const sk = (s: string): SheetKey => s as SheetKey;

/** A potion as gm.js sends it from the item library (without its id): the shop's, as parseItem reads it, two of them. */
const POTION = { ...copy(parseItem(SHOP_ITEMS.find(i => i.name === 'Health Potion')!)!), qty: 2 };
/** A burning status as the fight's def holds it: 2 magical damage at each turn start. */
const BURNING = { label: 'Burning', desc: 'On fire.', ops: [{ op: 'damage', type: 'magical', amount: { kind: 'number', value: 2 }, when: 'turn' }] };
/** A title as the GM's award carries it: its bonus travels with it. */
const WOLF = { name: 'Wolf Slayer', desc: 'Slew a pack leader of wolves.', bonus: { str: 2 } };
/** Who applied it: a C-rank monster's row (tier 2), as the fight keeps it. */
const SOURCE = { id: 'c-wolf', tier: 2 };
/** Burning as a hunter's sheet keeps it, with 3 rounds left. */
const BURN = { key: 'burning', def: BURNING, source: SOURCE, rounds: 3 };

/**
 * One valid payload per event type, as the senders write it today, and what the parser makes of it: the same values,
 * with each optional field the sender left out at its default.
 */
const VALID: Record<EventType, [Raw, Raw]> = {
  system: [
    { eid: EID, tag: '! Notification', title: 'A gate opens', body: 'Gather at the station.', kind: 'warning' },
    { eid: EID, tag: '! Notification', title: 'A gate opens', body: 'Gather at the station.', kind: 'warning' },
  ],
  award: [
    { eid: EID, to: [KEY], rewards: { xp: 50, gold: 10, points: 1, items: [POTION], title: WOLF }, bundle: { key: 'seed-held-the-mask', name: 'Held the Mask', window: { title: 'the mask held', line: 'You stayed.' } } },
    { eid: EID, to: [KEY], rewards: { xp: 50, gold: 10, points: 1, items: [POTION], title: WOLF, job: null, skills: [], statuses: [], boons: [] }, bundle: { key: 'seed-held-the-mask', name: 'Held the Mask', window: { title: 'THE MASK HELD', line: 'You stayed.' } } },
  ],
  quest: [
    { eid: EID, to: [KEY, OTHER], quest: { kind: 'main', title: 'Clear the den', desc: 'Goblins.', objectives: [{ label: 'Goblins', target: 3, progress: 0 }],
      rewards: { xp: 100, points: 0, gold: 5, items: [], title: null, job: null, skills: [], statuses: [], boons: [] }, dueAt: '2026-11-13T12:00:00.000Z', penaltyText: 'Lose a day.' } },
    { eid: EID, to: [KEY, OTHER], quest: { kind: 'main', title: 'Clear the den', desc: 'Goblins.', objectives: [{ label: 'Goblins', target: 3, progress: 0 }],
      rewards: { xp: 100, points: 0, gold: 5, items: [], title: null, job: null, skills: [], statuses: [], boons: [] }, dueAt: '2026-11-13T12:00:00.000Z', penaltyText: 'Lose a day.' } },
  ],
  hp: [
    { eid: EID, to: [KEY], hp: -7, reason: 'GM' },
    { eid: EID, to: [KEY], hp: -7, mana: 0, fatigue: 0, reason: 'GM' },
  ],
  vitals: [
    { eid: EID, to: [KEY], hp: 20, mana: 5, fatigue: 30, statuses: [BURN] },
    { eid: EID, to: [KEY], hp: 20, mana: 5, fatigue: 30, statuses: [BURN], reason: '' },
  ],
  spent: [
    { eid: EID, to: [KEY], item: 'i12' },
    { eid: EID, to: [KEY], item: 'i12' },
  ],
  revive: [
    { eid: EID, to: [KEY] },
    { eid: EID, to: [KEY] },
  ],
  status: [
    { eid: EID, to: [KEY], add: [BURN], reason: 'Fire bolt' },
    { eid: EID, to: [KEY], add: [BURN], remove: [], reason: 'Fire bolt' },
  ],
  roll: [
    { eid: EID, by: KEY, name: 'Kai', label: 'Strike', expr: '1d20+3', total: 17, rolls: [14], crit: false, fumble: false },
    { eid: EID, by: KEY, name: 'Kai', label: 'Strike', expr: '1d20+3', total: 17, rolls: [14], crit: false, fumble: false },
  ],
  questUpdate: [
    { eid: EID, by: KEY, name: 'Kai', questId: 'q7', title: 'Clear the den', kind: 'main', status: 'active', objectives: [{ label: 'Goblins', progress: 2, target: 3 }] },
    { eid: EID, by: KEY, name: 'Kai', questId: 'q7', title: 'Clear the den', kind: 'main', status: 'active', objectives: [{ label: 'Goblins', progress: 2, target: 3 }] },
  ],
  chain: [
    { eid: EID, to: [KEY], job: 'Ranger', kind: 'issue' },
    { eid: EID, to: [KEY], job: 'Ranger', kind: 'issue' },
  ],
  used: [
    { eid: EID, by: KEY, who: 'Mira', what: 'item', name: 'Flash Bomb', text: 'Blinds a foe.', target: 'other', tell: true },
    { eid: EID, by: KEY, who: 'Mira', what: 'item', name: 'Flash Bomb', text: 'Blinds a foe.', target: 'other', tell: true },
  ],
  step: [
    { eid: EID, by: KEY, place: { x: 3, y: 4 }, at: 2500 },
    { eid: EID, by: KEY, place: { x: 3, y: 4 }, at: 2500, dash: false },
  ],
  cast: [
    { eid: EID, by: KEY, ability: 'strike', aim: 'c2', at: 2500, dice: [4, 6] },
    { eid: EID, by: KEY, ability: 'strike', aim: 'c2', at: 2500, dice: [4, 6] },
  ],
  pass: [
    { eid: EID, by: KEY, at: 2500 },
    { eid: EID, by: KEY, at: 2500 },
  ],
  coinCall: [
    { eid: EID, by: KEY, roll: 'd-player1:r12', who: 'Kai', what: 'STR check', face: 20, call: 'heads' },
    { eid: EID, by: KEY, roll: 'd-player1:r12', who: 'Kai', what: 'STR check', face: 20, call: 'heads' },
  ],
  coinLand: [
    { eid: EID, roll: 'd-player1:r12', side: 'tails' },
    { eid: EID, roll: 'd-player1:r12', side: 'tails' },
  ],
  arm: [
    { eid: EID, by: KEY, ability: 'parry', on: null },
    { eid: EID, by: KEY, ability: 'parry', on: null },
  ],
  shadow: [
    { eid: EID, to: [KEY], shadow: { rank: 'C', archetype: 'brute', grade: 'Knight', monster: 'm7', name: 'Ice Bear' } },
    { eid: EID, to: [KEY], shadow: { rank: 'C', archetype: 'brute', grade: 'Knight', monster: 'm7', name: 'Ice Bear' } },
  ],
  soloRun: [
    { eid: EID, by: KEY, gate: 'g12', name: 'Kai', outcome: 'won', rounds: 4.5, life: 'up' },
    { eid: EID, by: KEY, gate: 'g12', name: 'Kai', outcome: 'won', rounds: 4.5, life: 'up' },
  ],
  soloAnswer: [
    { eid: EID, to: [KEY], run: 'd-p1-run1', gate: 'g12', name: 'Goblin Den', verdict: 'paid', rewards: { xp: 50, gold: 120 } },
    { eid: EID, to: [KEY], run: 'd-p1-run1', gate: 'g12', name: 'Goblin Den', verdict: 'paid', rewards: { xp: 50, gold: 120, points: 0, items: [], title: null, job: null, skills: [], statuses: [], boons: [] } },
  ],
};
const valid = (type: EventType): Raw => copy(VALID[type][0]);
/** A sheet as a player's phone pushes it (sync.ts `sendSheet`), and what the parser makes of it. */
const VALID_SHEET: [Raw, Raw] = [
  { hunter: { ...copy(newHunter()), id: 'h1', name: 'Kai' } },
  { hunter: { ...copy(newHunter()), id: 'h1', name: 'Kai' } },
];

describe('every event type', () => {
  test('the table has an entry for each of the sixteen room messages', () => {
    expect([...EVENT_TYPES].sort()).toEqual(['arm', 'award', 'cast', 'chain', 'coinCall', 'coinLand', 'hp', 'pass', 'quest', 'questUpdate', 'revive', 'roll', 'shadow', 'soloAnswer', 'soloRun', 'spent', 'status', 'step', 'system', 'used', 'vitals']);
  });

  test('only the GM may send what changes a hunter, speaks for the System or lands a coin; a player sends rolls, quest progress, uses, steps, casts, passes and coin calls', () => {
    const gmOnly = EVENT_TYPES.filter(t => EVENTS[t].gmOnly).sort();
    expect(gmOnly).toEqual(['award', 'chain', 'coinLand', 'hp', 'quest', 'revive', 'shadow', 'soloAnswer', 'spent', 'status', 'system', 'vitals']);
  });

  test('what a player sends speaks for one hunter: only that hunter\'s phone may send it', () => {
    expect(EVENT_TYPES.filter(t => EVENTS[t].ownSheet).sort()).toEqual(['arm', 'cast', 'coinCall', 'pass', 'questUpdate', 'roll', 'soloRun', 'step', 'used']);
    for (const t of ['roll', 'questUpdate', 'used', 'step', 'cast', 'pass', 'coinCall', 'arm', 'soloRun'] as const) expect(speaksFor(parseEvent(t, valid(t))!)).toBe(KEY as SheetKey);
    expect(speaksFor(parseEvent('award', valid('award'))!)).toBeNull();
  });

  for (const type of Object.keys(VALID) as EventType[]) {
    describe(type, () => {
      test('a payload a sender writes comes through with its values', () => {
        expect(parseEvent(type, valid(type))).toEqual({ type, payload: VALID[type][1] } as never);
      });

      test('a payload without an event id, or with a bad one, is refused', () => {
        const { eid: _, ...without } = valid(type);
        expect(parseEvent(type, without)).toBeNull();
        expect(parseEvent(type, { ...valid(type), eid: 12 })).toBeNull();
        expect(parseEvent(type, { ...valid(type), eid: 'e'.repeat(41) })).toBeNull();
        expect(parseEvent(type, { ...valid(type), eid: 'has space' })).toBeNull();
      });

      test('a payload that is not an object is refused', () => {
        for (const p of [null, undefined, 'award', 5, [valid(type)]]) expect(parseEvent(type, p)).toBeNull();
      });

      test('a __proto__ key is dropped and changes no prototype', () => {
        const p = JSON.parse(`{"__proto__": {"polluted": 1, "xp": 9999}, ${JSON.stringify(valid(type)).slice(1)}`);
        expect(payload(type, p)).toEqual(VALID[type][1]);
        expect(({} as Raw).polluted).toBeUndefined();
      });

      test('a field the type does not have is dropped, and the old v: 2 marker with it', () => {
        expect(payload(type, { ...valid(type), v: 2, stray: BIG })).toEqual(VALID[type][1]);
      });
    });
  }

  test('an unknown type, or a name Object.prototype has, is refused', () => {
    for (const type of ['nuke', '__proto__', 'toString', 'constructor', '', 7, null]) expect(parseEvent(type, valid('system'))).toBeNull();
  });
});

describe('a new event, as a phone sends one', () => {
  const stamp = { device: 'd-gm1', now: Date.parse('2026-11-12T12:00:00.000Z'), rand: 0.5 };
  const body = (type: EventType): Raw => { const { eid: _, ...rest } = VALID[type][1]; return rest; };

  for (const type of Object.keys(VALID) as EventType[]) {
    test(`a ${type} is what the server's parser reads it as, with an id made from the phone, the time and a random part`, () => {
      const ev = newEvent(type, body(type) as never, stamp)!;
      expect(ev.type).toBe(type);
      expect(ev.payload.eid).toMatch(/^d-gm1-[0-9a-z]+$/);
      expect(parseEvent(type, ev.payload)).toEqual(ev);
      expect(ev.payload).toEqual({ ...VALID[type][1], eid: ev.payload.eid } as never);
    });
  }

  test('two events from one phone in the same millisecond get different ids', () => {
    const a = newEvent('hp', body('hp') as never, { ...stamp, rand: 0.1 })!, b = newEvent('hp', body('hp') as never, { ...stamp, rand: 0.2 })!;
    expect(a.payload.eid).not.toBe(b.payload.eid);
  });

  test('an id the sender wrote is replaced by a new one', () => {
    expect(newEvent('hp', { ...body('hp'), eid: 'mine' } as never, stamp)!.payload.eid).not.toBe('mine' as never);
  });

  test('a phone with the longest device id still makes an id the server accepts', () => {
    const ev = newEvent('hp', body('hp') as never, { ...stamp, device: 'd'.repeat(40), rand: 0.999999 })!;
    expect(ev.payload.eid.length).toBeLessThanOrEqual(40);
    expect(parseEvent('hp', ev.payload)).toEqual(ev);
  });

  test('a body the server would refuse makes no event', () => {
    expect(newEvent('award', { to: [KEY], rewards: 'lots' } as never, stamp)).toBeNull();
    expect(newEvent('nuke' as EventType, {} as never, stamp)).toBeNull();
  });
});

describe('where a use goes', () => {
  const told = { tell: true, target: 'self' as const }, onOther = { tell: false, target: 'other' as const }, quiet = { tell: false, target: 'self' as const };
  test('a player\'s phone in a room sends the GM a told use and a use on another, and keeps a quiet use on oneself', () => {
    expect([told, onOther, quiet].map(u => useRoute('player', u))).toEqual(['post', 'post', 'none']);
  });
  test('a phone alone and the GM\'s own write a told use to their session log and send nothing', () => {
    for (const seat of ['alone', 'gm'] as const) expect([told, onOther, quiet].map(u => useRoute(seat, u))).toEqual(['log', 'none', 'none']);
  });
});

describe('a System window', () => {
  test('without a to list it is for every player; with one it is for those hunters', () => {
    expect(payload('system', valid('system'))!.to).toBeUndefined();
    expect(payload('system', { ...valid('system'), to: [KEY] })!.to).toEqual([KEY]);
  });

  test('a title is required and cut to 120 characters, the body to 1000', () => {
    expect(payload('system', { ...valid('system'), title: '' })).toBeNull();
    expect(payload('system', { ...valid('system'), title: 42 })).toBeNull();
    const p = payload('system', { ...valid('system'), title: BIG, body: BIG })!;
    expect([p.title.length, p.body.length]).toEqual([120, 1000]);
  });

  test('a style the app does not have is refused', () => {
    expect(payload('system', { ...valid('system'), kind: 'evil' })).toBeNull();
  });

  test('a to list keeps at most 24 sheet keys, drops a bad one, and an empty list is refused', () => {
    expect(payload('system', { ...valid('system'), to: many(10_000, i => `d-p${i}:h1`) })!.to).toHaveLength(24);
    expect(payload('system', { ...valid('system'), to: ['no colon', 5, KEY] })!.to).toEqual([KEY]);
    expect(payload('system', { ...valid('system'), to: [] })).toBeNull();
    expect(payload('system', { ...valid('system'), to: KEY })).toBeNull();
  });
});

describe('a revive', () => {
  test('names the hunters it raises: a revive for nobody, or for everyone without a to list, is refused', () => {
    const { to: _, ...without } = valid('revive');
    expect(payload('revive', without)).toBeNull();
    expect(payload('revive', { ...valid('revive'), to: [] })).toBeNull();
  });
});

describe('an award', () => {
  const award =(rewards: Raw) => payload('award', { ...valid('award'), rewards });

  test('XP and gold are clamped to a billion either way, ability points to 999', () => {
    expect(award({ xp: 1e12, gold: -1e12, points: 5000 })).toMatchObject({ rewards: { xp: 1e9, gold: -1e9, points: 999 } });
  });

  test('an amount that is not a number reads as 0, as parseRewards reads any wrong field', () => {
    expect(award({ xp: '50', gold: null, points: 2 })!.rewards).toMatchObject({ xp: 0, gold: 0, points: 2 });
  });

  test('missing amounts are 0 and missing lists are empty', () => {
    expect(award({})!.rewards).toEqual({ xp: 0, points: 0, gold: 0, items: [], title: null, job: null, skills: [], statuses: [], boons: [] });
  });

  test('at most 20 items; an item is read by parseItem: a wrong field takes its default, and one without a name is dropped', () => {
    expect(award({ items: many(10_000, () => POTION) })!.rewards.items).toHaveLength(20);
    expect(award({ items: [{ ...POTION, rar: 5 }, { ...POTION, qty: 'two' }, { name: '' }, POTION] })!.rewards.items)
      .toEqual([{ ...POTION, rar: 'common' }, { ...POTION, qty: 1 }, POTION]);
  });

  test('a skill it gives keeps an ability typed with advantage dice and a floor', () => {
    const p = parseFormula('2d20kh1 + floor(phys / 2)', RULES);
    if (!p.ok) throw new Error(p.error);
    const ability = abilityOf('strike', { id: abilityId('lucky'), name: 'Lucky Swing', effect: { type: 'physical', by: 'hand', formula: p.formula } }, RULES);
    expect(award({ skills: [{ name: 'Lucky Swing', type: 'active', ability: copy(ability) }] })!.rewards.skills[0].ability).toEqual(ability);
  });

  test('an item sent with only a name gets an item\'s defaults, and a huge name is cut to 60', () => {
    const plain = parseItem({ name: 'x' })!;
    expect(award({ items: [{ name: BIG }] })!.rewards.items).toEqual([{ ...plain, name: 'x'.repeat(60) }]);
  });

  test('an item bonus keeps the eight stats, max HP and max mana with numbers, clamped to 999, and drops an old key and a __proto__ key', () => {
    const bonus = JSON.parse('{"__proto__": 5, "str": 2, "vit": 5000, "agi": "3", "ac": 4, "dex": 1, "bad key": 1}');
    expect(award({ items: [{ ...POTION, bonus }] })!.rewards.items[0].bonus).toEqual({ str: 2, vit: 999 });
  });

  test('a build change is a respec, a path, or the pick of a tier', () => {
    expect(award({ build: 'respec' })!.rewards.build).toBe('respec');
    expect(award({ build: { path: 'vanguard' } })!.rewards.build).toEqual({ path: 'vanguard' });
    expect(award({ build: { tier: 1, pick: 0 } })!.rewards.build).toEqual({ tier: 1, pick: 0 });
    expect(award({ build: { tier: 1, pick: 2 } })).toBeNull();
    expect(award({ build: 'everything' })).toBeNull();
  });

  test('an award without rewards, or for no one, is refused', () => {
    const { rewards: _, ...without } = valid('award');
    expect(payload('award', without)).toBeNull();
    const { to: __, ...noOne } = valid('award');
    expect(payload('award', noOne)).toBeNull();
  });

  test('an award given from a bundle names it: a key and a name, and its window\'s words or none', () => {
    const given = (bundle: Raw) => payload('award', { ...valid('award'), bundle });
    expect(given({ key: 'rb12', name: 'In character', window: null })).toMatchObject({ bundle: { key: 'rb12', name: 'In character', window: null } });
    expect(given({ key: 'rb12', name: 'In character' })).toMatchObject({ bundle: { window: null } });
    expect(given({ key: '', name: 'In character' }), 'no key').toBeNull();
    expect(given({ key: 'rb12', name: ' ' }), 'no name').toBeNull();
    expect(given({ key: 'rb12', name: 'x', window: { title: '' } }), 'a window with no title').toBeNull();
    expect(given({ key: 'k'.repeat(200), name: 'x'.repeat(200) })).toMatchObject({ bundle: { key: 'k'.repeat(80), name: 'x'.repeat(60) } });
    const { bundle: _, ...plain } = valid('award');
    expect(payload('award', plain)).not.toHaveProperty('bundle');
  });
});

describe('a quest', () => {
  const quest = (fields: Raw) => payload('quest', { ...valid('quest'), quest: { ...valid('quest').quest, ...fields } });

  test('a quest needs a title and one of the quest kinds', () => {
    expect(quest({ title: '  ' })).toBeNull();
    expect(quest({ kind: 'epic' })).toBeNull();
  });

  test('at most 10 objectives; progress is never past the target', () => {
    expect(quest({ objectives: many(10_000, i => ({ label: `o${i}`, target: 1 })) })!.quest.objectives).toHaveLength(10);
    expect(quest({ objectives: [{ label: 'Run', target: 3, progress: 50 }] })!.quest.objectives).toEqual([{ label: 'Run', target: 3, progress: 3 }]);
  });

  test('a due time that is not a time is refused; none is null', () => {
    expect(quest({ dueAt: 'tomorrow-ish' })).toBeNull();
    expect(quest({ dueAt: null })!.quest.dueAt).toBeNull();
  });

  test('the GM screen leaves out the penalty and the due time: they read as none', () => {
    const { penaltyText: _, dueAt: __, ...gmQuest } = valid('quest').quest;
    expect(payload('quest', { ...valid('quest'), quest: { ...gmQuest, from: 'gm' } })!.quest).toMatchObject({ penaltyText: '', dueAt: null });
  });
});

describe('an HP change', () => {
  test('HP, mana and fatigue changes are clamped to 99999 either way', () => {
    expect(payload('hp', { ...valid('hp'), hp: -1e9, mana: 1e9, fatigue: 1e300 })).toMatchObject({ hp: -99999, mana: 99999, fatigue: 99999 });
  });

  test('a change that is not a number is refused', () => {
    expect(payload('hp', { ...valid('hp'), hp: '-7' })).toBeNull();
    expect(payload('hp', { ...valid('hp'), mana: null })).toBeNull();
  });

  test('the old mp field is dropped: mana is 0', () => {
    expect(payload('hp', { ...valid('hp'), mp: 5 })).toMatchObject({ mana: 0 });
  });
});

describe('the fight\'s totals for a hunter', () => {
  const vitals = (fields: Raw) => payload('vitals', { ...valid('vitals'), ...fields });

  test('HP, mana and fatigue are whole totals from 0 to a billion, clamped', () => {
    expect(vitals({ hp: -5, mana: 1e12, fatigue: 7.9 })).toMatchObject({ hp: 0, mana: 1e9, fatigue: 7 });
  });

  test('a total left out, or not a number, is refused: a total is never guessed', () => {
    for (const k of ['hp', 'mana', 'fatigue', 'statuses']) {
      const { [k]: _, ...without } = valid('vitals');
      expect(payload('vitals', without)).toBeNull();
    }
    expect(vitals({ hp: '20' })).toBeNull();
  });

  test('is for exactly one hunter', () => {
    expect(vitals({ to: [] })).toBeNull();
    expect(vitals({ to: [KEY, OTHER] })).toBeNull();
    expect(vitals({ to: [KEY, 'no colon'] })!.to).toEqual([KEY]);
  });

  test(`at most ${MAX_STATUSES} statuses, the fight row's own cap; one that does not read, or a chip the hunter's state draws, is dropped`, () => {
    expect(vitals({ statuses: many(100, i => ({ ...BURN, key: `s${i}` })) })!.statuses).toHaveLength(MAX_STATUSES);
    expect(vitals({ statuses: [{ ...BURN, def: null }, { ...BURN, key: 'down' }, { ...BURN, rounds: -1 }, BURN] })!.statuses).toEqual([BURN]);
  });
});

describe('an item the GM\'s fight took from a player', () => {
  const spent = (fields: Raw) => payload('spent', { ...valid('spent'), ...fields });

  test('is for exactly one hunter', () => {
    expect(spent({ to: [] })).toBeNull();
    expect(spent({ to: [KEY, OTHER] })).toBeNull();
  });

  test('names an item by a save id: anything else is refused, never guessed', () => {
    for (const item of [undefined, '', 'item-i12', 'i', 12, 'seed:x y']) expect(spent({ item })).toBeNull();
    expect(spent({ item: 'i3' })!.item).toBe('i3');
  });
});

describe('a solo run and its answer', () => {
  test('a run names a gate, an outcome and a life the tables hold; rounds within the time cap; a name cut to the fight\'s bound', () => {
    for (const f of [{ gate: '' }, { gate: 7 }, { outcome: 'draw' }, { life: 'ghost' }, { rounds: 'x' }, { by: 'nobody' }]) expect(payload('soloRun', { ...valid('soloRun'), ...f })).toBeNull();
    expect(payload('soloRun', { ...valid('soloRun'), rounds: 999 })!.rounds).toBe(41);
    expect(payload('soloRun', { ...valid('soloRun'), name: BIG })!.name).toHaveLength(NAME_MAX);
  });

  test('an answer is for exactly one hunter, names its run, and is paid with a reward or refused with why', () => {
    expect(payload('soloAnswer', { ...valid('soloAnswer'), to: [KEY, OTHER] })).toBeNull();
    expect(payload('soloAnswer', { ...valid('soloAnswer'), run: 'has space' })).toBeNull();
    expect(payload('soloAnswer', { ...valid('soloAnswer'), verdict: 'maybe' })).toBeNull();
    const refused = { ...valid('soloAnswer'), verdict: 'refused', why: 'taken' };
    expect(payload('soloAnswer', refused)).toEqual({ eid: EID, to: [KEY], run: 'd-p1-run1', gate: 'g12', name: 'Goblin Den', verdict: 'refused', why: 'taken' });
    expect(payload('soloAnswer', { ...refused, why: 'bored' })).toBeNull();
    expect(payload('soloAnswer', { ...valid('soloAnswer'), rewards: 'lots' })).toBeNull();
  });
});

describe('a shadow risen for a player\'s hunter', () => {
  const shadow = (fields: Raw) => payload('shadow', { ...valid('shadow'), shadow: { ...valid('shadow').shadow, ...fields } });

  test('is for exactly one hunter', () => {
    expect(payload('shadow', { ...valid('shadow'), to: [] })).toBeNull();
    expect(payload('shadow', { ...valid('shadow'), to: [KEY, OTHER] })).toBeNull();
  });

  test('names a rank, an archetype and a grade the tables hold, and a monster by its id or none; anything else is refused', () => {
    for (const f of [{ rank: 'Z' }, { archetype: 'dragon' }, { grade: 'King' }, { monster: '' }, { monster: 7 }, { rank: undefined }]) expect(shadow(f)).toBeNull();
    expect(shadow({ monster: null })!.shadow.monster).toBeNull();
  });

  test('a name is cut to the fight\'s name bound', () => {
    expect(shadow({ name: BIG })!.shadow.name).toHaveLength(NAME_MAX);
  });
});

describe('a status change', () => {
  const status = (fields: Raw) => payload('status', { ...valid('status'), ...fields });
  const grant = (fields: Raw) => ({ ...BURN, ...fields });

  test('at most 10 statuses added and 10 removed', () => {
    const p = status({ add: many(10_000, i => grant({ key: `s${i}` })), remove: many(10_000, i => `s${i}`) })!;
    expect([p.add.length, p.remove.length]).toEqual([10, 10]);
  });

  test('a status with a key that is empty or longer than 80 characters, rounds that are not a number, or no readable def is dropped', () => {
    const add = [grant({ key: '' }), grant({ key: 'k'.repeat(81) }), grant({ rounds: 'x' }), grant({ def: null }), grant({ def: { desc: 'no label', ops: [] } }), grant({})];
    expect(status({ add })!.add).toEqual([grant({})]);
    expect(status({ add: [grant({ key: 'k'.repeat(80) })] })!.add).toHaveLength(1);
  });

  test('Down, Dead, Exhausted and Penalized are drawn from a hunter\'s state, so adding or removing one is dropped', () => {
    const p = status({ add: [grant({ key: 'down' }), grant({ key: 'dead' }), grant({ key: 'exhausted' }), grant({ key: 'penalized' }), grant({})],
      remove: ['down', 'exhausted', 'dead', 'penalized', 'burning'] })!;
    expect(p.add).toEqual([grant({})]);
    expect(p.remove).toEqual(['burning']);
  });

  test('rounds left are 0 or more with their decimals, and none means until removed', () => {
    expect(status({ add: [grant({ rounds: 2.5 }), grant({ key: 'b', rounds: null }), grant({ key: 'c', rounds: -1 })] })!.add.map((s: Raw) => s.rounds)).toEqual([2.5, null]);
  });

  test('a status without a readable source is dropped: who applied it decides its numbers', () => {
    const add = [grant({ source: undefined }), grant({ source: null }), grant({ source: { ...SOURCE, tier: 6 } }), grant({ source: { ...SOURCE, tier: -1 } }),
      grant({ source: { ...SOURCE, tier: 2.5 } }), grant({ source: { ...SOURCE, id: 7 } }), grant({})];
    expect(status({ add })!.add).toEqual([grant({})]);
  });

  test('a source\'s tier is 0 to 5, and a source with no id is the GM\'s', () => {
    const tiers = status({ add: [grant({ source: { id: null, tier: 0 } }), grant({ key: 'b', source: { id: 'c-1', tier: 5 } })] })!.add.map((s: Raw) => s.source);
    expect(tiers).toEqual([{ id: null, tier: 0 }, { id: 'c-1', tier: 5 }]);
  });

  test('a def with a dice count past the shipped rules\' limit does not read, as every room message is read before any GM\'s rules', () => {
    const dice = (count: number) => grant({ def: { ...BURNING, ops: [{ op: 'damage', type: 'magical', amount: { kind: 'dice', count, sides: 6 } }] } });
    expect(status({ add: [dice(RULES.dice.maxDice)] })!.add).toHaveLength(1);
    expect(status({ add: [dice(RULES.dice.maxDice + 1)] })!.add).toEqual([]);
  });
});

describe('a roll', () => {
  test('a roll needs a numeric total and the sheet key of the hunter who rolled', () => {
    const { total: _, ...noTotal } = valid('roll');
    expect(payload('roll', noTotal)).toBeNull();
    expect(payload('roll', { ...valid('roll'), total: '17' })).toBeNull();
    expect(payload('roll', { ...valid('roll'), by: 'h1' })).toBeNull();
  });

  test('at most 50 dice; a flag that is not true or false is refused', () => {
    expect(payload('roll', { ...valid('roll'), rolls: many(10_000, () => 3) })!.rolls).toHaveLength(50);
    expect(payload('roll', { ...valid('roll'), crit: 'yes' })).toBeNull();
  });

  test('the old item and skill kinds are gone: a kind field is dropped (a use travels as used)', () => {
    expect(payload('roll', { ...valid('roll'), kind: 'skill' })).toEqual(VALID.roll[1]);
  });

  test('a total past a million either way is clamped', () => {
    expect(payload('roll', { ...valid('roll'), total: -1e15 })!.total).toBe(-1e6);
  });
});

describe('quest progress', () => {
  test('progress needs the quest id and a quest status', () => {
    const { questId: _, ...noId } = valid('questUpdate');
    expect(payload('questUpdate', noId)).toBeNull();
    expect(payload('questUpdate', { ...valid('questUpdate'), status: 'won' })).toBeNull();
  });

  test('the reader cuts a sent quest to its bounds, so the sender sends it as it is: a name to 60, a title to 120, 10 objectives, a label to 100', () => {
    const p = payload('questUpdate', { ...valid('questUpdate'), name: BIG, title: BIG, objectives: many(30, () => ({ label: BIG, progress: 1, target: 2 })) })!;
    expect([p.name.length, p.title.length, p.objectives.length, p.objectives[0]!.label.length]).toEqual([60, 120, 10, 100]);
  });
});

describe('a Job Change chain', () => {
  const chain = (fields: Raw) => payload('chain', { ...valid('chain'), ...fields });

  test('names a job the jobs table has, and one of issue, reissue or abandon', () => {
    expect(chain({ job: 'Pirate' })).toBeNull();
    expect(chain({ job: 'ranger' })).toBeNull();
    expect(chain({ job: 7 })).toBeNull();
    expect(chain({ kind: 'finish' })).toBeNull();
    for (const kind of ['issue', 'reissue', 'abandon']) expect(chain({ kind })!.kind).toBe(kind);
  });

  test('is for at least one hunter, at most 24', () => {
    expect(chain({ to: [] })).toBeNull();
    expect(chain({ to: many(100, i => `d-p${i}:h1`) })!.to).toHaveLength(24);
  });
});

describe('a use', () => {
  const used = (fields: Raw) => payload('used', { ...valid('used'), ...fields });

  test('a use needs the sheet key of the hunter, what was used and its name', () => {
    expect(used({ by: 'h1' })).toBeNull();
    expect(used({ what: 'spell' })).toBeNull();
    expect(used({ name: '   ' })).toBeNull();
  });

  test('a target that is not self or other, or a tell that is not true or false, is refused; left out they are self and false', () => {
    expect(used({ target: 'everyone' })).toBeNull();
    expect(used({ tell: 'yes' })).toBeNull();
    const { target: _, tell: __, ...plain } = valid('used');
    expect(payload('used', plain)).toMatchObject({ target: 'self', tell: false });
  });

  test('the hunter\'s and the thing\'s names are cut to 60 characters, the text to 200', () => {
    const p = used({ who: BIG, name: BIG, text: BIG })!;
    expect([p.who.length, p.name.length, p.text.length]).toEqual([60, 60, 200]);
  });

  test('a use is a report: the outcomes the old app rolled are dropped, a use in a fight is a cast', () => {
    expect(used({ outcomes: [{ kind: 'damage', n: 7 }] })).toEqual(VALID.used[1]);
  });
});

describe('a step', () => {
  const step = (fields: Raw) => payload('step', { ...valid('step'), ...fields });

  test('a tile is x and y, each a whole number from 0 to 63; anything else is refused, never moved to another tile', () => {
    expect(step({ place: { x: 0, y: 63 } })!.place).toEqual({ x: 0, y: 63 });
    for (const place of [{ x: 64, y: 0 }, { x: -1, y: 0 }, { x: 2.5, y: 0 }, { x: '3', y: 4 }, { x: 3 }, [3, 4], null]) expect(step({ place })).toBeNull();
  });

  test('the time the player saw is a whole tick from 0, clamped to a billion; without it the step is refused', () => {
    expect(step({ at: 1e12 })!.at).toBe(1e9);
    expect(step({ at: -5 })!.at).toBe(0);
    const { at: _, ...without } = valid('step');
    expect(payload('step', without)).toBeNull();
  });

  test('a dash is a yes or no, no by default; anything else refuses the step', () => {
    expect([step({ dash: true })!.dash, step({})!.dash]).toEqual([true, false]);
    expect(step({ dash: 'yes' })).toBeNull();
  });

  test('a step speaks for one hunter, by its sheet key', () => {
    expect(step({ by: 'h1' })).toBeNull();
  });
});

describe('a coin call', () => {
  const call = (fields: Raw) => payload('coinCall', { ...valid('coinCall'), ...fields });

  test('a call needs the hunter\'s sheet key, the roll\'s id, a natural 1 or 20 and heads or tails', () => {
    expect(call({ by: 'h1' })).toBeNull();
    for (const roll of ['', 'has space', 'r'.repeat(81), 12, null]) expect(call({ roll })).toBeNull();
    for (const face of [2, 19, '20', 0, null]) expect(call({ face })).toBeNull();
    expect(call({ face: 1 })!.face).toBe(1);
    for (const c of ['edge', 'Heads', '', null]) expect(call({ call: c })).toBeNull();
    expect(call({ call: 'tails' })!.call).toBe('tails');
  });

  test('a roll id of 80 characters comes through whole', () => {
    expect(call({ roll: 'r'.repeat(80) })!.roll).toBe('r'.repeat(80));
  });

  test('the hunter\'s name and what the roll was for are cut to 60 characters, and left out they are empty', () => {
    const p = call({ who: BIG, what: BIG })!;
    expect([p.who.length, p.what.length]).toEqual([60, 60]);
    const { who: _, what: __, ...plain } = valid('coinCall');
    expect(payload('coinCall', plain)).toMatchObject({ who: '', what: '' });
  });
});

describe('a coin\'s landing', () => {
  const land = (fields: Raw) => payload('coinLand', { ...valid('coinLand'), ...fields });

  test('a landing needs the roll\'s id and heads or tails', () => {
    for (const roll of ['', 'has space', 'r'.repeat(81), 12, null]) expect(land({ roll })).toBeNull();
    for (const side of ['edge', 'Tails', '', null]) expect(land({ side })).toBeNull();
    expect(land({ side: 'heads' })!.side).toBe('heads');
  });

  test('a landing holds the roll and the side and nothing that says how the side was chosen', () => {
    expect(land({ ruling: 'right', flip: true, by: KEY, call: 'heads' })).toEqual(VALID.coinLand[1]);
    expect(Object.keys(VALID.coinLand[1]).sort()).toEqual(['eid', 'roll', 'side']);
  });
});

describe('a cast', () => {
  const cast = (fields: Raw) => payload('cast', { ...valid('cast'), ...fields });

  test('the ability is an id of 1 to 40 characters, never cut', () => {
    expect(cast({ ability: 'a'.repeat(40) })!.ability).toBe('a'.repeat(40));
    for (const ability of ['', 'a'.repeat(41), 7, null]) expect(cast({ ability })).toBeNull();
  });

  test('the aim is a row of the fight (an id of at most 80 characters) or a tile', () => {
    expect(cast({ aim: { x: 10, y: 5 } })!.aim).toEqual({ x: 10, y: 5 });
    expect(cast({ aim: 'c'.repeat(80) })!.aim).toBe('c'.repeat(80));
    for (const aim of ['', 'c'.repeat(81), { x: 64, y: 0 }, 5, null]) expect(cast({ aim })).toBeNull();
  });

  test('at most 8 dice, each a whole face from 0 to 999; left out there are none', () => {
    expect(cast({ dice: many(100, () => 3) })!.dice).toHaveLength(8);
    expect(cast({ dice: [1e6, -2, 4.7, 'six', 5] })!.dice).toEqual([999, 0, 4, 5]);
    const { dice: _, ...without } = valid('cast');
    expect(payload('cast', without)!.dice).toEqual([]);
  });

  test('a cast without the time the player saw is refused', () => {
    const { at: _, ...without } = valid('cast');
    expect(payload('cast', without)).toBeNull();
  });
});

describe('a pass', () => {
  test('names the hunter and the time the player saw, and nothing else', () => {
    expect(Object.keys(payload('pass', { ...valid('pass'), dice: [3] })!).sort()).toEqual(['at', 'by', 'eid']);
  });

  test('a pass without the time the player saw is refused', () => {
    const { at: _, ...without } = valid('pass');
    expect(payload('pass', without)).toBeNull();
  });
});

describe('a player\'s step or cast on the GM\'s phone', () => {
  /** A running fight at `now`, the turn of row c1, held by the hunter of `KEY` on another phone; row c2 is a monster. */
  const fight = (o: { now?: number; currentId?: string; phase?: string; holder?: Raw | null } = {}): Fight => ({
    phase: o.phase ?? 'running', now: tick(o.now ?? 2500), currentId: o.currentId ?? 'c1',
    rows: [{ id: 'c1', holder: o.holder === undefined ? { kind: 'remote', remote: KEY } : o.holder }, { id: 'c2', holder: null }],
  }) as unknown as Fight;
  const sent = (at = 2500, by = KEY) => ({ by: by as SheetKey, at: tick(at) });

  test('moves the row of the sender\'s hunter on its turn, at the time the player saw', () => {
    expect(onTurn(fight(), sent())).toBe('c1' as never);
  });

  test('changes nothing once time has moved on: a replay, or a tap on a stale view', () => {
    expect(onTurn(fight({ now: 3700 }), sent())).toBeNull();
  });

  test('changes nothing on another row\'s turn, for another player\'s hunter, a hunter on the GM\'s phone, or outside a running fight', () => {
    expect(onTurn(fight({ currentId: 'c2' }), sent())).toBeNull();
    expect(onTurn(fight(), sent(2500, OTHER))).toBeNull();
    expect(onTurn(fight({ holder: { kind: 'local', hunterId: 'h1' } }), sent())).toBeNull();
    expect(onTurn(fight({ phase: 'setup' }), sent())).toBeNull();
    expect(onTurn(null, sent())).toBeNull();
  });

  test('moves a summon on its turn for the phone of the hunter that owns it, and for no other (kits design 1.9.2)', () => {
    const withSummon = (owner: string): Fight => ({
      phase: 'running', now: tick(2500), currentId: 's1',
      rows: [{ id: 'c1', holder: { kind: 'remote', remote: KEY } }, { id: 'c3', holder: { kind: 'remote', remote: OTHER } }, { id: 's1', kind: 'summon', owner, holder: null }],
    }) as unknown as Fight;
    expect(onTurn(withSummon('c1'), sent())).toBe('s1' as never);
    expect(onTurn(withSummon('c3'), sent())).toBeNull();
  });
});

describe('the fight doc', () => {
  const st = (key: string, label = key) => ({ key, label, left: 2.5, tier: 0 });
  const KAI_ROW = {
    id: 'c1', name: 'Kai', side: 'party', key: KEY, place: { x: 2, y: 3 }, at: 1500, speed: 100, band: 'wounded', statuses: [st('burning', 'Burning')],
    shield: 12, shieldLeft: 1.5, channel: null, taunt: null, down: false, kind: 'hunter', hp: 20, hpMax: 30, stride: 3, move: 6,
  };
  const GOBLIN_ROW = {
    id: 'c2', name: 'Goblin', side: 'foe', key: null, place: { x: 2, y: 11 }, at: 1800, speed: 110, band: 'bloodied', statuses: [], shield: null, shieldLeft: null,
    channel: { ability: 'hex-bolt', name: 'Hex Bolt', charge: 2, max: 5, state: 'holding', factor: 2.1 }, taunt: { by: 'c1', left: 1.2 }, down: false,
    kind: 'monster', intent: { name: 'Shortbow', target: 'c1', reveal: null }, stagger: { fill: 3, max: 40, staggered: null }, suggest: 'c1',
  };
  /** A running fight as fightDoc (src/core/combat/fight-doc.ts) makes it; `parse` puts it on the wire (`fightWire`) and reads it back. */
  const LIVE = {
    ended: false, active: true, by: 'd-gm1', id: 'f5', at: '2026-11-12T12:00:00.000Z', now: 1500, currentId: 'c1', ahead: ['c1', 'c2'],
    grid: { w: 20, h: 14, tiles: null, lit: null }, zones: [], rows: [KAI_ROW, GOBLIN_ROW], log: ['Kai moves.'], refused: null, ready: {},
  };
  const parse = (fields: Raw = {}) => DOCS.fight(copy(fightWire({ ...copy(LIVE), ...fields } as never))) as Raw | null;
  const rowsOf = (rows: Raw[]) => parse({ rows })!.rows as Raw[];
  /** `LIVE` on the wire with top-level fields as given, for what only a broken wire can hold. */
  const onWire = (fields: Raw) => DOCS.fight({ ...fightWire(copy(LIVE) as never), ...fields }) as Raw | null;

  test('a running fight comes through as published', () => {
    expect(parse()).toEqual(LIVE);
  });

  test('an ended fight keeps only its id and when it ended', () => {
    expect(DOCS.fight({ id: 'f5', active: false, ended: true, at: '2026-11-12T12:00:00.000Z', rows: [KAI_ROW] })).toEqual({ ended: true, active: false, id: 'f5', at: '2026-11-12T12:00:00.000Z' });
  });

  test('players never get a monster\'s HP, and a hunter\'s HP is never past its maximum', () => {
    expect(rowsOf([{ ...GOBLIN_ROW, hp: 7, hpMax: 9 }, { ...KAI_ROW, hp: 500 }])).toEqual([GOBLIN_ROW, { ...KAI_ROW, hp: 30 }]);
  });

  test('a hunter\'s stride is a whole number of tiles from 0 to 64, and a row without one is dropped', () => {
    expect(rowsOf([{ ...KAI_ROW, stride: 0 }, { ...KAI_ROW, id: 'c3', stride: 500 }, { ...KAI_ROW, id: 'c4', stride: -2 }]).map(r => r.stride)).toEqual([0, 64, 0]);
    const { stride: _, ...noStride } = KAI_ROW;
    expect(rowsOf([noStride, GOBLIN_ROW])).toEqual([GOBLIN_ROW]);
  });

  test('a hunter\'s move (how far a dash runs) is a whole number of tiles from 0 to 64, and a row without one is dropped', () => {
    expect(rowsOf([{ ...KAI_ROW, move: 0 }, { ...KAI_ROW, id: 'c3', move: 500 }, { ...KAI_ROW, id: 'c4', move: -2 }]).map(r => 'move' in r && r.move)).toEqual([0, 64, 0]);
    const { move: _, ...noMove } = KAI_ROW;
    expect(rowsOf([noMove, GOBLIN_ROW])).toEqual([GOBLIN_ROW]);
  });

  test(`at most ${DOC_ROWS} rows, ${DOC_STATUSES} statuses a row, ${DOC_AHEAD} turns ahead and ${DOC_LOG} log lines of at most ${LOG_LINE_MAX} characters`, () => {
    // Ten times the bound, not BIG: `parse` copies the doc through JSON, and 50 lines of 10 MB are half a gigabyte of it.
    const long = 'x'.repeat(LOG_LINE_MAX * 10);
    const doc = parse({ rows: many(100, i => ({ ...GOBLIN_ROW, id: `c${i}`, statuses: many(50, j => st(`s${j}`)) })), ahead: many(50, i => `c${i}`), log: many(50, () => long) })!;
    expect([doc.rows.length, doc.rows[0].statuses.length, doc.ahead.length, doc.log.length, doc.log[0].length]).toEqual([DOC_ROWS, DOC_STATUSES, DOC_AHEAD, DOC_LOG, LOG_LINE_MAX]);
  });

  test('a row with a band, side or kind the table does not have, or a place off the biggest grid, is dropped', () => {
    const bad = [{ ...GOBLIN_ROW, band: 'fine' }, { ...GOBLIN_ROW, side: 'neutral' }, { ...GOBLIN_ROW, kind: 'boss' }, { ...GOBLIN_ROW, place: { x: 64, y: 0 } }];
    expect(rowsOf([...bad, KAI_ROW])).toEqual([KAI_ROW]);
  });

  test('a monster\'s intent names a row or a tile, and none is null; stagger is whole numbers', () => {
    const [aimed, none] = rowsOf([{ ...GOBLIN_ROW, intent: { name: 'Fire Breath', target: { x: 4, y: 5 }, reveal: null }, stagger: { fill: 3.7, max: 40, staggered: 1.5 } }, { ...GOBLIN_ROW, id: 'c3', intent: null, stagger: null }]);
    expect([aimed!.intent, aimed!.stagger, none!.intent, none!.stagger]).toEqual([{ name: 'Fire Breath', target: { x: 4, y: 5 }, reveal: null }, { fill: 3, max: 40, staggered: 1.5 }, null, null]);
  });

  test('a revealed intent carries at most four lines of its numbers, each cut to 80 characters, and its area\'s radius and ring; an unrevealed one carries none', () => {
    const reveal = { lines: ['Magical damage 2d8 + power', 'Radius 3 tiles, ring to 4 at 50%', 'Range 10 tiles', 'Slow to land: a quick body can move out', 'a fifth line'], radius: 3, outer: 4 };
    const [shown, hidden] = rowsOf([{ ...GOBLIN_ROW, intent: { name: 'Hellfire', target: 'c1', reveal: { ...reveal, lines: [...reveal.lines.slice(0, 4), 'x'.repeat(200)] } } }, { ...GOBLIN_ROW, id: 'c3' }]);
    expect(shown!.intent.reveal).toEqual({ lines: reveal.lines.slice(0, 4), radius: 3, outer: 4 });
    expect(rowsOf([{ ...GOBLIN_ROW, intent: { name: 'Hellfire', target: 'c1', reveal: { ...reveal, lines: ['x'.repeat(200)] } } }])[0]!.intent.reveal.lines).toEqual(['x'.repeat(80)]);
    expect(hidden!.intent.reveal).toBeNull();
  });

  test('a channel\'s charge and max are whole numbers up to 99 and a bad state drops the row; a taunt names its row; a missing extra is none', () => {
    const [c] = rowsOf([{ ...GOBLIN_ROW, channel: { ...GOBLIN_ROW.channel, charge: 2.6, max: 500 } }]);
    expect(c!.channel).toEqual({ ability: 'hex-bolt', name: 'Hex Bolt', charge: 2, max: 99, state: 'holding', factor: 2.1 });
    expect(rowsOf([{ ...GOBLIN_ROW, channel: { ...GOBLIN_ROW.channel, state: 'sleeping' } }, KAI_ROW])).toEqual([KAI_ROW]);
    const { channel: _c, taunt: _t, suggest: _s, shieldLeft: _l, ...bare } = GOBLIN_ROW;
    expect(rowsOf([bare])[0]).toMatchObject({ channel: null, taunt: null, suggest: null, shieldLeft: null });
  });

  test('the GM\'s refusal of a player\'s tap comes through with its row, time, reason and count; a bad one is dropped alone', () => {
    const refused = { id: 'c1', at: 1500, reason: 'cooldown', n: 3 };
    expect(parse({ refused })!.refused).toEqual(refused);
    expect(parse({ refused: undefined })!.refused).toBeNull();
    for (const bad of [{ ...refused, reason: 'needsRoll' }, { ...refused, reason: 'sleepy' }, { ...refused, id: '' }, { ...refused, n: 'many' }, 'cooldown']) {
      expect(parse({ refused: bad })).toMatchObject({ rows: LIVE.rows, refused: null });
    }
  });

  test('the current row\'s cooldowns come through; past 12, a bad id or a bad time, an entry is dropped alone', () => {
    expect(parse({ ready: { 'dagger-rush': 4500 } })!.ready).toEqual({ 'dagger-rush': 4500 });
    const many13 = Object.fromEntries(many(13, i => [`a${i}`, 100 + i]));
    expect(Object.keys(parse({ ready: many13 })!.ready as Raw)).toEqual(many(12, i => `a${i}`));
    expect(parse({ ready: { ['x'.repeat(41)]: 1, ok: 'soon', fine: 7 } })!.ready).toEqual({ fine: 7 });
    expect(parse({ ready: 'soon' })).toMatchObject({ rows: LIVE.rows, ready: {} });
  });

  test('a running fight without its GM phone, its rows or its grid is refused', () => {
    expect(onWire({ by: undefined })).toBeNull();
    expect(onWire({ rows: 'none' })).toBeNull();
    expect(onWire({ grid: undefined })).toBeNull();
  });

  test('a map comes as one character a tile and a lit line as long; a wrong length, an unknown character or past 1,600 tiles drops the doc', () => {
    const map = { w: 4, h: 2, tiles: '#.o?~_..', lit: '01100110' };
    expect(parse({ grid: map })!.grid).toEqual(map);
    expect(onWire({ grid: { w: 4, h: 2 } })!.grid).toEqual({ w: 4, h: 2, tiles: null, lit: null });
    for (const bad of [{ ...map, tiles: '#.o' }, { ...map, tiles: '#.o?~_.X' }]) expect(parse({ grid: bad })).toBeNull();
    const litOf = (lit: string) => onWire({ grid: { w: 4, h: 2, lit } });
    expect(litOf(packBits('01100110'))!.grid.lit).toBe('01100110');
    for (const bad of ['01100110', 'G', 'G!', '']) expect(litOf(bad), `a lit line packed as ${JSON.stringify(bad)}`).toBeNull();
    expect(parse({ grid: { w: 41, h: 40, tiles: '.'.repeat(1640), lit: null } })).toBeNull();
    expect(parse({ grid: { w: 40, h: 40, tiles: '.'.repeat(DOC_TILES_MAX), lit: '1'.repeat(DOC_TILES_MAX) } })!.grid).toMatchObject({ w: 40, h: 40 });
  });

  test('a stacking status comes with its count (one past the cap reads as the cap), a summon with the row that owns it, and the current row\'s uses left (kits design 1.11)', () => {
    const stacked = { ...KAI_ROW, statuses: [{ ...st('pain', 'Pain'), stacks: 7 }] };
    expect(parse({ rows: [stacked] })!.rows[0]!.statuses).toEqual([{ ...st('pain', 'Pain'), stacks: 7 }]);
    expect(parse({ rows: [{ ...KAI_ROW, statuses: [{ ...st('pain', 'Pain'), stacks: 21 }] }] })!.rows[0]!.statuses).toEqual([{ ...st('pain', 'Pain'), stacks: RULES.fight.kit.stackCap }]);
    const sprite = { ...KAI_ROW, id: 's1', key: null, kind: 'summon', owner: 'c1', left: 1.5 };
    expect(parse({ rows: [sprite] })!.rows).toEqual([sprite]);
    expect(parse({ rows: [{ ...sprite, left: undefined }] })!.rows).toEqual([{ ...sprite, left: null }]);
    expect(parse({ rows: [{ ...sprite, owner: undefined }] })!.rows).toEqual([]);
    expect(parse({ left: { daily: 1, twice: 0 } })!).toMatchObject({ left: { daily: 1, twice: 0 } });
    expect(parse({ left: { daily: 99, twice: 'x' } })!).toMatchObject({ left: { daily: RULES.fight.kit.fightUses } });
    expect('left' in parse({})!).toBe(false);
  });

  test('a zone comes with its id, name, runs of tiles, tone and rounds left; a bad one is dropped alone, and past 16 the rest are dropped', () => {
    const fire = { id: 'z1', name: 'Fire', tiles: '45+3,65+5', tone: 'harm', left: 1.5, anchor: null };
    expect(parse({ zones: [fire] })!.zones).toEqual([fire]);
    expect(parse({ zones: [{ ...fire, anchor: 'c-mira' }] })!.zones).toEqual([{ ...fire, anchor: 'c-mira' }]);
    expect(parse({ zones: [{ ...fire, anchor: undefined }] })!.zones).toEqual([fire]);
    expect(onWire({ zones: undefined })!.zones).toEqual([]);
    for (const bad of [{ ...fire, tiles: '45-3' }, { ...fire, tone: 'hot' }, { ...fire, id: '' }, { ...fire, tiles: 7 }, { ...fire, anchor: 7 }, { ...fire, anchor: 'a'.repeat(81) }]) expect(parse({ zones: [bad, fire] })!.zones).toEqual([fire]);
    expect(parse({ zones: many(20, i => ({ ...fire, id: `z${i}` })) })!.zones).toHaveLength(MAX_ZONES);
  });

  test('the party\'s rows with a ready reaction: at most 12 row ids; a bad one is dropped; absent is none (kits design 8.4.8)', () => {
    expect(parse({ armed: many(20, i => `c${i}`) })!.armed).toHaveLength(RULES.fight.kit.doArmed);
    expect(parse({ armed: ['c1', 7, '', 'c2'] })!.armed).toEqual(['c1', 'c2']);
    expect(parse({})!.armed).toBeUndefined();
  });

  test('the party\'s rows with a spent reaction read as the ready ones do (kits table 8.9.1)', () => {
    expect(parse({ spent: many(20, i => `c${i}`) })!.spent).toHaveLength(RULES.fight.kit.doArmed);
    expect(parse({ spent: ['c1', 7, '', 'c2'] })!.spent).toEqual(['c1', 'c2']);
    expect(parse({})!.spent).toBeUndefined();
  });

  test('the thresholds of the GM\'s last command that set any off: a count and at most 12 bearers; a bad burst is none', () => {
    expect(parse({ burst: { n: 3, ids: ['c1', 7, 'c2'] } })!.burst).toEqual({ n: 3, ids: ['c1', 'c2'] });
    expect(parse({ burst: { n: 3, ids: many(20, i => `c${i}`) } })!.burst!.ids).toHaveLength(RULES.fight.kit.doArmed);
    for (const bad of [undefined, null, 7, { n: 'x', ids: [] }, { ids: [] }]) expect(parse({ burst: bad })!.burst).toBeUndefined();
  });

  /**
   * The worst case of the doc on the wire (protocol.ts `DOC_MAX`'s arithmetic), as the design sizes it: ${DOC_ROWS} monster
   * rows, each with a 60-character name, the six longest built-in statuses at tier S with their counts, a shield, a stagger
   * with its stagger, a taunt, a channel and a revealed intent of four 80-character lines; a full log, a 40 by 40 map with
   * its fog, 16 zones, and every list of ids at its bound. `table` is the second shape it can take: the doc's table of defs
   * at `DOC_DEFS_MAX`, and every other status named inline because its def is not the table's.
   */
  function worstDoc(table: boolean) {
    const six = Object.entries(BUILT_IN_STATUSES).sort((a, b) => b[1].label.length - a[1].label.length).slice(0, 6);
    const id = (i: number) => `m-${String(i).padStart(2, '0')}`;
    /** A GM's own def of about `n` characters under a built-in's name, so it fills the table: its longest description and ops of a damage of 1. */
    const op = { op: 'damage', type: 'magical', amount: { kind: 'number', value: 1 } };
    const big = (label: string, n: number) => {
      const ops = many(Math.min(12, Math.floor((n - 100) / (JSON.stringify(op).length + 1))), () => op), bare = { label, desc: '', ops };
      return { label, desc: 'd'.repeat(Math.max(0, Math.min(500, n - JSON.stringify(bare).length))), ops };
    };
    const fill = Math.floor((DOC_DEFS_MAX - 2) / 6) - 16;
    const worst = (i: number) => ({
      ...GOBLIN_ROW, id: id(i), name: 'n'.repeat(60), place: { x: 63, y: 63 }, at: 1234567, speed: 123.45, band: 'critical',
      statuses: six.map(([key, def]) => ({ key, label: def.label, left: 12.3, stacks: RULES.fight.kit.stackCap, tier: 5, def: table && i === 0 ? big(def.label, fill) : def })),
      shield: 99999, shieldLeft: 12.3,
      channel: { ability: 'a'.repeat(40), name: 'c'.repeat(60), charge: 99, max: 99, state: 'holding', factor: 99999.99 }, taunt: { by: 'm-31', left: 12.3 },
      intent: { name: 'i'.repeat(60), target: { x: 63, y: 63 }, reveal: { lines: many(4, () => 'l'.repeat(80)), radius: 63, outer: 63 } },
      stagger: { fill: 12345, max: 99999, staggered: 1.5 }, suggest: 'm-31',
    });
    return {
      ...LIVE, by: `d-${'a'.repeat(37)}`, id: `f-${'x'.repeat(20)}`, now: 1234567, currentId: 'm-00', ahead: many(DOC_AHEAD, id),
      grid: { w: 40, h: 40, tiles: '#'.repeat(DOC_TILES_MAX), lit: '1'.repeat(DOC_TILES_MAX) },
      zones: many(MAX_ZONES, i => ({ id: `z${String(i).padStart(39, '0')}`, name: 'z'.repeat(40), tiles: '1599+1,'.repeat(40).slice(0, DOC_ZONE_RUNS - 1) + '1', tone: 'hinder', left: 12345.6, anchor: id(i) })),
      rows: many(DOC_ROWS, worst), log: many(DOC_LOG, () => 'y'.repeat(LOG_LINE_MAX)),
      refused: { id: 'm-00', at: 1234567, reason: 'unknownAbility', n: 999999999 },
      ready: Object.fromEntries(many(12, i => [`${'r'.repeat(38)}${String(i).padStart(2, '0')}`, 1234567])),
      left: Object.fromEntries(many(12, i => [`${'r'.repeat(38)}${String(i).padStart(2, '0')}`, RULES.fight.kit.fightUses])),
      armed: many(RULES.fight.kit.doArmed, id), spent: many(RULES.fight.kit.doArmed, i => id(i + 12)),
      reacts: Object.fromEntries([...many(RULES.fight.kit.doArmed, id), ...many(RULES.fight.kit.doArmed, i => id(i + 12))].map(r => [r, 'a'.repeat(40)])),
      burst: { n: 999999999, ids: many(RULES.fight.kit.doArmed, id) },
    };
  }
  /** The characters of each part of a doc on the wire, and of each part of its first row. */
  function byPart(wire: Raw): string {
    const len = (v: unknown) => JSON.stringify(v).length;
    const row = wire.rows[0] as Raw;
    return [`total ${len(wire)}`, ...Object.keys(wire).map(k => `  ${k} ${len(wire[k])}`), `  a row ${len(row)}:`, ...Object.keys(row).map(k => `    ${k} ${len(row[k])}`)].join('\n');
  }

  test(`the worst-case doc on the wire, in either shape, is at most eight ninths of the room's ${DOC_MAX}-character cap, and reads back whole`, () => {
    for (const table of [false, true]) {
      const doc = worstDoc(table), wire = copy(fightWire(doc as never)) as Raw;
      console.info(`the worst-case fight doc ${table ? 'with a full table of defs' : 'of built-in statuses'}, by part:\n${byPart(wire)}`);
      const read = DOCS.fight(wire) as Raw;
      if (table) {
        expect(read.rows[0].statuses.map((s: Raw) => s.def), 'the current row\'s defs are in the table').toEqual(doc.rows[0]!.statuses.map(s => s.def));
        expect(read.rows[1].statuses.every((s: Raw) => s.def === undefined), 'a status whose def is not the table\'s is named inline').toBe(true);
      } else expect(read).toEqual(doc as never);
      expect(JSON.stringify(wire.defs ?? {}).length).toBeLessThanOrEqual(DOC_DEFS_MAX);
      expect(JSON.stringify(wire).length).toBeLessThanOrEqual(DOC_MAX * 8 / 9);
    }
    const row = worstDoc(false).rows[0]!, wireRow = (r: Raw) => JSON.stringify((fightWire({ ...worstDoc(false), rows: [r] } as never) as Raw).rows[0]).length;
    const hunter = { ...row, kind: 'hunter', key: KEY, intent: undefined, stagger: undefined, suggest: undefined, hp: 99999, hpMax: 99999, stride: 64, move: 64 };
    expect(wireRow(hunter), 'a worst-case hunter row is no longer than the worst-case monster row').toBeLessThanOrEqual(wireRow(row));
    const summon = { ...hunter, kind: 'summon', key: null, owner: 'm-31', left: 12345.6 };
    expect(wireRow(summon), 'a worst-case summon row is no longer than the worst-case monster row').toBeLessThanOrEqual(wireRow(row));
  });

});

describe('the other room docs', () => {
  test('every doc the GM publishes has a parser, and no other name does', () => {
    expect(Object.keys(DOCS).sort()).toEqual(['codex', 'fight', 'kicked', 'rules', 'solo', 'world']);
    for (const name of ['nope', '__proto__', 'toString']) expect(parseDocName(name)).toBeNull();
  });

  test('the removed list keeps sheet keys with a time, and drops anything else', () => {
    const keys = JSON.parse(`{"__proto__": "2026-11-12T12:00:00.000Z", "${KEY}": "2026-11-12T12:00:00.000Z", "${OTHER}": "soon", "h1": "2026-11-12T12:00:00.000Z"}`);
    expect(DOCS.kicked({ v: 1, keys, names: { [KEY]: 'Kai' } })).toEqual({ keys: { [sk(KEY)]: '2026-11-12T12:00:00.000Z' }, names: { [sk(KEY)]: 'Kai' } });
  });

  test('the room\'s rules: the build switches and the personal gates\' switch true or false, its hours whole within their bounds', () => {
    const rules = { build: { enabled: false, playerPick: true }, solo: { personal: false, hours: 4 }, feats: { on: false } };
    expect(DOCS.rules(rules)).toEqual(rules);
    const { feats: _none, ...older } = rules;
    expect(DOCS.rules(older)!.feats, 'a doc without the feats switch reads as on').toEqual({ on: true });
    expect(DOCS.rules({ ...rules, build: { enabled: 'no', playerPick: true } })).toBeNull();
    expect(DOCS.rules({ ...rules, solo: { personal: 'yes', hours: 4 } })).toBeNull();
    expect(DOCS.rules({ ...rules, solo: { personal: true, hours: 0 } })!.solo.hours).toBe(1);
    expect(DOCS.rules({ ...rules, solo: { personal: true, hours: 1e6 } })!.solo.hours).toBe(168);
    expect(DOCS.rules({ enabled: true, playerPick: true }), 'the old build doc is not read').toBeNull();
  });

  test('a world gate open to solo runs says so, and only then', () => {
    const gate = { id: 'g1', name: 'Den', rank: 'E', type: 'normal', status: 'detected', breakDay: 5 };
    expect(DOCS.world({ day: 3, gates: [{ ...gate, solo: true }, { ...gate, id: 'g2', solo: false }] })).toEqual({ day: 3, session: 0, gates: [{ ...gate, solo: true }, { ...gate, id: 'g2' }] });
    expect(DOCS.world({ day: 3, gates: [{ ...gate, solo: 'yes' }] })).toEqual({ day: 3, session: 0, gates: [] });
  });

  test('the solo doc reads each monster by the monster parser and each status by the status parser; a bad entry is dropped', () => {
    const goblin = parseMonster({ name: 'Goblin', rank: 'E', archetype: 'skirmisher' })!;
    const doc = { gates: [{ id: 'g1', name: 'Den', rank: 'E', boss: false, lines: [{ m: 'seed:goblin', n: 2 }] }], monsters: { 'seed:goblin': goblin }, statuses: { burning: BURNING } };
    const read = DOCS.solo(copy(doc))!;
    expect(read.gates).toEqual(doc.gates);
    expect(read.monsters['seed:goblin']).toEqual(goblin);
    expect(read.statuses.burning!.label).toBe('Burning');
    expect(DOCS.solo({ ...copy(doc), monsters: { 'seed:goblin': 'a goblin', ok: goblin } })!.monsters).toEqual({ ok: goblin });
    expect(DOCS.solo({ ...copy(doc), gates: [{ ...doc.gates[0], lines: [{ m: 'x', n: 0 }] }] })!.gates[0]!.lines).toEqual([{ m: 'x', n: 1 }]);
    expect(DOCS.solo({ ...copy(doc), pad: 'x'.repeat(DOC_MAX) }), 'past the room\'s bound').toBeNull();
  });

  test('the world keeps at most 40 gates and drops a gate with a status gates do not have', () => {
    const gate = { id: 'g1', name: 'Den', rank: 'E', type: 'normal', status: 'detected', breakDay: 5 };
    expect(DOCS.world({ v: 1, day: 3, gates: [gate, { ...gate, status: 'gone' }] })).toEqual({ day: 3, session: 0, gates: [gate] });
    expect(DOCS.world({ day: 3, gates: many(10_000, i => ({ ...gate, id: `g${i}` })) })!.gates).toHaveLength(40);
  });

  test('a cleared gate in the world carries the day it was cleared; one without it does not read', () => {
    const cleared = { id: 'g1', name: 'Den', rank: 'E', type: 'normal', status: 'cleared', breakDay: 5, clearedDay: 4 };
    expect(DOCS.world({ day: 6, gates: [cleared] })).toEqual({ day: 6, session: 0, gates: [cleared] });
    const { clearedDay: _gone, ...bare } = cleared;
    expect(DOCS.world({ day: 6, gates: [bare] })).toEqual({ day: 6, session: 0, gates: [] });
  });

  // The solo doc's arithmetic is the comment above SOLO_DOC in protocol.ts: built within DOC_MAX, every built-in monster
  // fits with room to spare, and a gate of a GM's monsters at their bounds can pass DOC_MAX alone and is left out.
  test('the worst-case solo doc on the wire: every built-in monster in solo gates, read back whole; a gate past the bound left out and not marked', () => {
    const seeds = seedMonsters(RULES), gate = (i: number, lines: Gate['monsters'], boss: string | null = null): Gate =>
      ({ ...newGate(), id: `g${i + 1}` as GateId, name: 'N'.repeat(80), rank: 'E', monsters: lines, bossId: boss as never, solo: true });
    const gates = many(40, i => gate(i, [0, 1, 2].map(k => ({ monsterId: seeds[(3 * i + k) % seeds.length]!.id, count: 26 })), seeds[i % seeds.length]!.id));
    const built = soloDoc({ gates, monsters: [] }, RULES, DOC_MAX), wire = JSON.stringify(built.doc);
    console.log(`the worst-case solo doc of built-in monsters: ${wire.length} characters (gates ${JSON.stringify(built.doc.gates).length}, monsters ${JSON.stringify(built.doc.monsters).length}, ${Object.keys(built.doc.monsters).length} of them; the largest ${Math.max(...Object.values(built.doc.monsters).map(m => JSON.stringify(m).length))})`);
    expect(built.left).toEqual([]);
    expect(wire.length).toBeLessThanOrEqual(DOC_MAX / 2);
    expect(DOCS.solo(JSON.parse(wire))).toEqual(built.doc);
    const hex = seeds.find(m => m.abilities.length)!.abilities[0]!;
    const heavy = (i: number): Monster => ({ ...seeds[0]!, id: `m${i + 1}` as never, name: 'H'.repeat(60), abilities: many(11, k => ({ ...hex, id: `a${k}` as never, name: 'A'.repeat(60) })) });
    const custom = many(50, heavy), big = gate(40, custom.map(m => ({ monsterId: m.id, count: 1 })));
    const withBig = soloDoc({ gates: [big, ...gates.slice(0, 2)], monsters: custom }, RULES, DOC_MAX);
    expect(withBig.left).toEqual([big.id]);
    expect(withBig.doc.gates.map(g => g.id)).toEqual(['g1', 'g2']);
    const world = worldDoc({ gates: [big, ...gates.slice(0, 2)] }, 1, new Set(withBig.doc.gates.map(g => g.id)), 0);
    expect(world.gates.map(g => [g.id, g.solo ?? false])).toEqual([['g41', false], ['g1', true], ['g2', true]]);
  });

  test('the shared bestiary keeps at most 200 monsters', () => {
    const entry = { key: 'goblin|E', name: 'Goblin', rank: 'E', hpMax: 38, armor: 4, resist: 5, speed: 110, abilities: ['Shortbow'], kills: 2, firstAt: '2026-11-12T12:00:00.000Z' };
    expect(DOCS.codex({ v: 1, at: '2026-11-12T12:00:00.000Z', entries: [entry] })).toEqual({ at: '2026-11-12T12:00:00.000Z', entries: [entry] });
    expect(DOCS.codex({ at: '', entries: many(10_000, i => ({ ...entry, key: `m${i}|E` })) })!.entries).toHaveLength(200);
  });
});

describe('a hunter sheet', () => {
  const kai = (fields: Raw = {}): Raw => ({ ...copy(newHunter()), id: 'h1', name: 'Kai', ...fields });
  /** A sheet as a player's phone pushes it: the hunter. */
  const sheet = (fields: Raw = {}): Raw => ({ hunter: kai(fields) });
  const hunterOf = (s: unknown): Raw => (s as { hunter: Raw }).hunter;

  test('the sheet a phone pushes comes through as it is: its hunter', () => {
    expect(parseSheet(sk(KEY), copy(VALID_SHEET[0]))).toEqual(VALID_SHEET[1] as never);
  });

  test('a deleted hunter\'s tombstone comes through as a tombstone', () => {
    expect(parseSheet(sk(KEY), { deleted: true })).toEqual({ deleted: true });
  });

  test('a sheet stored under another hunter\'s key, or that is not a hunter, is refused', () => {
    expect(parseSheet(sk(KEY), sheet({ id: 'h2' }))).toBeNull();
    expect(parseSheet(sk(KEY), sheet({ id: undefined }))).toBeNull();
    expect(parseSheet(sk(KEY), { hunter: 'Kai' })).toBeNull();
    expect(parseSheet(sk(KEY), {})).toBeNull();
    expect(parseSheet(sk(KEY), kai())).toBeNull();
    expect(parseSheet(sk(KEY), 'Kai')).toBeNull();
    expect(parseSheet(sk(KEY), [sheet()])).toBeNull();
  });

  test('a sheet is repaired as a save repairs a hunter: a huge name is cut to 60, a level that is not a number is 1', () => {
    expect(hunterOf(parseSheet(sk(KEY), sheet({ name: BIG, level: 'max' })))).toMatchObject({ name: 'x'.repeat(60), level: 1 });
  });

  test('each list on a sheet keeps at most 100 entries', () => {
    const items = many(10_000, i => ({ ...parseItem({ name: 'Pebble' })!, id: `i${i + 1}` }));
    expect(hunterOf(parseSheet(sk(KEY), sheet({ items }))).items).toHaveLength(100);
  });

  test('a __proto__ key on a sheet or its hunter is dropped', () => {
    const raw = JSON.parse(`{"__proto__": {"admin": true}, "hunter": {"__proto__": {"admin": true}, ${JSON.stringify(kai()).slice(1)}}`);
    const parsed = parseSheet(sk(KEY), raw) as Raw;
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(parsed.hunter)).toBe(Object.prototype);
    expect(parsed.admin).toBeUndefined();
    expect(parsed.hunter.admin).toBeUndefined();
  });

  // A hunter's personal gates travel with its sheet (notes-2-solo.md 10): read with their bounds, at most 10 gates of at
  // most 3 roster lines each. The worst case, every field at its bound, is 5,105 characters, under a sixth of SHEET_MAX.
  test('a sheet\'s personal gates are read with their bounds: at most 10, the newest, each with at most 3 roster lines', () => {
    const gate = (i: number) => ({
      id: `pg${i + 1}`, name: 'N'.repeat(500), rank: 'Q', at: '2026-11-18T10:00:00.000Z', closesAt: '2026-11-19T10:00:00.000Z',
      monsters: many(9, k => ({ monsterId: `seed:monster-${k}`, count: 999 })),
    });
    const solo = hunterOf(parseSheet(sk(KEY), sheet({ solo: { clock: { at: 'on', next: 'soon' }, gates: many(15, gate) } }))).solo as { clock: unknown; gates: Raw[] };
    expect(solo.clock).toEqual({ at: 'off' });
    expect(solo.gates.map(g => g.id)).toEqual(many(10, i => `pg${i + 6}`));
    expect(solo.gates[0]).toMatchObject({ name: 'N'.repeat(60), rank: 'E' });
    expect(solo.gates[0]!.monsters).toEqual(many(3, k => ({ monsterId: `seed:monster-${k}`, count: 12 })));
  });

  test('the worst-case personal gates on a sheet are under a sixth of what the room takes', () => {
    const worst = { clock: { at: 'on', next: '2026-11-18T10:00:00.000Z' }, gates: many(10, i => ({
      id: `pg${1e15 + i}`, name: 'N'.repeat(60), rank: 'E', at: '2026-11-18T10:00:00.000Z', closesAt: '2026-11-19T10:00:00.000Z',
      monsters: many(3, k => ({ monsterId: `seed:${'m'.repeat(70)}${k}`, count: 12 })),
    })) };
    const read = hunterOf(parseSheet(sk(KEY), sheet({ solo: worst }))).solo;
    expect(read).toEqual(worst);
    expect(JSON.stringify(read).length).toBe(5105);
    expect(JSON.stringify(read).length).toBeLessThan(SHEET_MAX / 6);
  });

  test('the build path is kept as the phone sent it, even one the default rules do not have', () => {
    expect(hunterOf(parseSheet(sk(KEY), sheet({ build: { path: 'house-path', picks: [0, 1] } })))).toMatchObject({ build: { path: 'house-path', picks: [0, 1] } });
  });
});

describe('the poll answer', () => {
  const event = (seq: number, type: EventType = 'roll') => ({ seq, at: '2026-11-12T12:00:00.000Z', from: 'd-player1', type, payload: valid(type) });
  const ANSWER = {
    gm: false, now: '2026-11-12T12:00:00.000Z', events: [event(1), event(2, 'questUpdate')], next: 2, more: false,
    sheets: { [KEY]: { at: '2026-11-12T12:00:00.000Z', from: 'd-player1', data: copy(VALID_SHEET[1]) } },
    docs: { rules: { at: '2026-11-12T12:00:00.000Z', from: 'd-gm1', data: { build: { enabled: true, playerPick: false }, solo: { personal: true, hours: 8 }, feats: { on: true } } } },
  };
  const parse = (fields: Raw = {}) => parseRoomState({ ...copy(ANSWER), ...fields }) as Raw | null;

  test('an answer comes through with typed events, sheets and docs', () => {
    expect(parse()).toEqual({ ...ANSWER, events: [{ ...event(1), payload: VALID.roll[1] }, { ...event(2, 'questUpdate'), payload: VALID.questUpdate[1] }] } as never);
  });

  test('a bad event, sheet or doc is dropped and the cursor still moves past it', () => {
    const state = parse({
      events: [event(1), { ...event(2), payload: { eid: EID } }], next: 2,
      sheets: { ...ANSWER.sheets, [OTHER]: { at: '', from: 'd-player2', data: { hunter: { name: 'not h4' } } } },
      docs: { rules: { at: '', from: 'd-gm1', data: { build: { enabled: 'yes' } } }, nope: { at: '', from: 'd-gm1', data: {} } },
    })!;
    expect(state.events.map((e: Raw) => e.seq)).toEqual([1]);
    expect(state.next).toBe(2);
    expect(Object.keys(state.sheets)).toEqual([KEY]);
    expect(state.docs).toEqual({});
  });

  test('at most one page of 200 events', () => {
    expect(parse({ events: many(10_000, i => event(i + 1)) })!.events).toHaveLength(200);
  });

  test('presence is there only when the server sent it', () => {
    expect(parse()!.presence).toBeUndefined();
    expect(parse({ gm: true, presence: { 'd-player1': '2026-11-12T12:00:00.000Z', 'bad id!': 'x' } })!.presence).toEqual({ 'd-player1': '2026-11-12T12:00:00.000Z' });
  });

  test('an answer missing its cursor, or that is not an object, is refused', () => {
    expect(parse({ next: undefined })).toBeNull();
    expect(parseRoomState('{"gm":true}')).toBeNull();
  });
});

describe('an armed reaction (kits design 8.4.2)', () => {
  test('a player arms a reaction or disarms with null; a turn reaction names a row', () => {
    expect(payload('arm', { eid: EID, by: KEY, ability: null })).toEqual({ eid: EID, by: KEY, ability: null, on: null });
    expect(payload('arm', { eid: EID, by: KEY, ability: 'react', on: 'c4' })).toEqual({ eid: EID, by: KEY, ability: 'react', on: 'c4' });
  });

  test('an ability id past 40 characters, an empty one or a number is refused, and so is a row that is not an id', () => {
    for (const ability of ['x'.repeat(41), '', 7]) expect(payload('arm', { eid: EID, by: KEY, ability })).toBeNull();
    expect(payload('arm', { eid: EID, by: KEY, ability: 'parry', on: 5 })).toBeNull();
  });
});
