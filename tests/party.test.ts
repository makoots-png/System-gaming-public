import { pickables, pickedRef, sheetName } from '../src/core/party.ts';
import { TAP_KINDS, tapWords } from '../src/core/sync/taps.ts';
import { parseSheetKey } from '../src/core/ids.ts';
import { describe, expect, test } from 'bun:test';
import { addHunter, removeHunter, setActive, untouched } from '../src/core/party.ts';
import { dropStatus, putStatus } from '../src/core/hunter/conditions.ts';
import { addSkill, editSkill, forgetSkill, giveSkill, learnSkill, levelUpSkill, SKILL_MAX_LEVEL } from '../src/core/hunter/skills-held.ts';
import { removeBundle, saveBundle, newRewards } from '../src/core/rewards.ts';
import type { RewardBundle } from '../src/core/rewards.ts';
import { RULES } from '../src/core/rules.ts';
import { VITAL_CHIPS } from '../src/core/hunter/vitals.ts';
import { STATUS_KEYS } from '../src/core/registry/statuses.ts';
import { freshSave, newHunter, newQuest } from '../src/core/save.ts';
import { parseItem } from '../src/core/registry/items.ts';
import type { Hunter, Save } from '../src/core/save.ts';
import type { SkillTemplate } from '../src/core/registry/skills.ts';
import { both, isRefused } from '../src/core/save-step.ts';
import { post } from '../src/core/sync/outbox.ts';
import type { RoomCode } from '../src/core/protocol.ts';
import type { Refused } from '../src/core/save-step.ts';
import { day, dev, hid, iid, qid, rbid } from './fixtures/ids.ts';

const ok = <T extends object>(v: T): Exclude<T, Refused> => { if (isRefused(v)) throw new Error(`refused: ${v.why}`); return v as Exclude<T, Refused>; };
const env = { now: new Date('2026-11-14T10:00:00Z'), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-test') };
const named = (id: string, name: string): Hunter => ({ ...newHunter(RULES), id: hid(id), name });
const party = (): Save => {
  const save = freshSave(env, { onboarded: true });
  return { ...save, hunters: [named('h1', 'Ana')], settings: { ...save.settings, activeHunterId: hid('h1') } };
};

describe('the party', () => {
  test('round trip: a hunter added then deleted leaves the save as it was', () => {
    const save = party();
    const added = addHunter(save, named('h2', 'Bo'));
    expect(added.settings.activeHunterId).toBe(hid('h2'));
    expect(ok(removeHunter(added, 'h2', null))).toEqual({ ...save, settings: { ...save.settings, activeHunterId: 'h1' } });
  });

  test('round trip: switching to another hunter and back is where it started', () => {
    const save = addHunter(party(), named('h2', 'Bo'));
    expect(ok(setActive(ok(setActive(save, 'h1')), 'h2'))).toEqual(save);
    expect(setActive(save, 'h9')).toEqual({ ok: false, why: 'no-hunter' });
  });

  test('deleting the last hunter puts the fresh one in its place; without one it is refused', () => {
    expect(ok(removeHunter(party(), 'h1', named('h5', 'New'))).hunters.map(h => h.id)).toEqual(['h5']);
    expect(ok(removeHunter(party(), 'h1', named('h5', 'New'))).settings.activeHunterId).toBe(hid('h5'));
    expect(removeHunter(party(), 'h1', null)).toEqual({ ok: false, why: 'last' });
  });

  test('deleting the room\'s bound hunter binds the room to the hunter left active, as a rebind: its tombstone goes and the join keeps its time (SMX-sync-2.1)', () => {
    const base = addHunter(party(), named('h2', 'Bo'));
    const owed = post(post([], 'ABCDEF' as RoomCode, { kind: 'tomb', hid: hid('h1') }).box, 'ABCDEF' as RoomCode, { kind: 'tomb', hid: hid('h3') }).box;
    const joined = { room: 'ABCDEF' as RoomCode, at: '2026-11-14T09:00:00.000Z' };
    const bound = { ...base, settings: { ...base.settings, sync: { ...base.settings.sync, room: 'ABCDEF' as RoomCode, boundHunterId: hid('h2'), outbox: owed, joined } } };
    const next = ok(removeHunter(bound, 'h2', null));
    expect(next.settings.sync.boundHunterId).toBe(hid('h1'));
    expect(next.settings.sync.outbox!.map(e => e.id)).toEqual(['tomb h3']);
    expect(next.settings.sync.joined).toEqual(joined);
    expect(ok(removeHunter(bound, 'h1', null)).settings.sync, 'deleting a hunter that is not bound leaves the bind').toEqual(bound.settings.sync);
  });
});

describe('statuses on the sheet', () => {
  const key = STATUS_KEYS[0]!;
  test('round trip: a status put on then taken off leaves the hunter as it was', () => {
    const h = named('h1', 'Ana');
    const on = ok(putStatus(h, { key }, RULES.conditions));
    expect(on.conditions.map(c => c.key)).toEqual([key]);
    expect(ok(dropStatus(on, key))).toEqual(h);
  });
  test('a chip drawn from the state, a key with no def and a change that changes nothing are refused', () => {
    const h = named('h1', 'Ana');
    expect(putStatus(h, { key: VITAL_CHIPS[0] }, RULES.conditions)).toEqual({ ok: false, why: 'state-chip' });
    expect(putStatus(h, { key: 'nonsense' }, RULES.conditions)).toEqual({ ok: false, why: 'no-def' });
    const on = ok(putStatus(h, { key }, RULES.conditions));
    expect(putStatus(on, { key }, RULES.conditions)).toEqual({ ok: false, why: 'unchanged' });
    expect(dropStatus(h, key)).toEqual({ ok: false, why: 'unchanged' });
  });
});

describe('skills a hunter holds', () => {
  const k: SkillTemplate = { name: 'Iron Skin', type: 'passive', level: 1, label: 'Lv.1', desc: '', bonus: { vit: 1 } };
  test('round trip: a skill learned then forgotten leaves the hunter as it was', () => {
    const h = named('h1', 'Ana');
    expect(ok(forgetSkill(learnSkill(h, k, 's1'), 's1'))).toEqual(h);
  });
  test('a skill given replaces one of the same name and keeps its id', () => {
    const h = learnSkill(named('h1', 'Ana'), k, 's1');
    expect(giveSkill(h, { ...k, level: 3 }, 's2').skills).toEqual([{ ...k, level: 3, id: 's1' }]);
  });
  test('Add skill refuses a name already held, in any case, and an edit refuses another held skill\'s name', () => {
    const h = learnSkill(named('h1', 'Ana'), k, 's1');
    expect(addSkill(h, { ...k, name: ' iron skin ' }, 's2')).toEqual({ ok: false, why: 'held' });
    const two = ok(addSkill(h, { ...k, name: 'Stone Skin' }, 's2'));
    expect(two.skills.map(s => s.name)).toEqual(['Iron Skin', 'Stone Skin']);
    expect(editSkill(two, 's2', { ...k, name: 'IRON SKIN' })).toEqual({ ok: false, why: 'held' });
    expect(ok(editSkill(two, 's2', { ...k, name: 'Stone Skin', desc: 'x' })).skills[1]).toMatchObject({ id: 's2', desc: 'x' });
  });
  test('Lv + raises the level and stops at the top level; a label is the GM\'s words and stays as written, whatever they say', () => {
    const h = ok(levelUpSkill(learnSkill(named('h1', 'Ana'), { ...k, label: null }, 's1'), 's1'));
    expect(h.skills[0]).toMatchObject({ level: 2, label: null });
    expect(ok(levelUpSkill(learnSkill(named('h1', 'Ana'), { ...k, label: 'Lv.1' }, 's1'), 's1')).skills[0]).toMatchObject({ level: 2, label: 'Lv.1' });
    const top = learnSkill(named('h1', 'Ana'), { ...k, level: SKILL_MAX_LEVEL }, 's1');
    expect(levelUpSkill(top, 's1')).toEqual({ ok: false, why: 'max' });
    expect(ok(levelUpSkill(learnSkill(named('h1', 'Ana'), { ...k, label: 'Rank II' }, 's1'), 's1')).skills[0]!.label).toBe('Rank II');
  });
  test('an edit keeps the id (the library\'s skills: library.ts saveNamed, tests/library.test.ts)', () => {
    const h = learnSkill(named('h1', 'Ana'), k, 's1');
    expect(ok(editSkill(h, 's1', { ...k, desc: 'tough' })).skills[0]).toMatchObject({ id: 's1', desc: 'tough' });
  });
});

describe('reward bundles', () => {
  test('round trip: a bundle saved then deleted leaves the library as it was; an edit or a rename keeps its id', () => {
    const lib: { rewards: RewardBundle[] } = { rewards: [] };
    const saved = ok(saveBundle(lib, rbid('rb1'), ' Loot ', newRewards(), 10));
    expect(saved.rewards).toEqual([{ id: 'rb1', name: 'Loot', rewards: newRewards() }]);
    expect(ok(saveBundle(saved, 'rb1', 'Big loot', { ...newRewards(), xp: 5 }, 10)).rewards).toEqual([{ id: 'rb1', name: 'Big loot', rewards: { ...newRewards(), xp: 5 } }]);
    expect(ok(removeBundle(saved, 'rb1'))).toEqual(lib);
    expect(saveBundle(saved, 'rb2', 'More', newRewards(), 1)).toEqual({ ok: false, why: 'full' });
  });
  test('a rename onto another bundle\'s name is refused: neither bundle is lost or overwritten', () => {
    const two = ok(saveBundle(ok(saveBundle({ rewards: [] as RewardBundle[] }, 'rb1', 'Loot', newRewards(), 10)), 'rb2', 'Wolf hunt', { ...newRewards(), xp: 9 }, 10));
    expect(saveBundle(two, 'rb1', 'wolf HUNT', newRewards(), 10)).toEqual({ ok: false, why: 'taken' });
    expect(saveBundle(two, 'rb1', ' ', newRewards(), 10)).toEqual({ ok: false, why: 'blank' });
  });
});

describe('a hunter made for a join that then failed (sync.ts settleAttempt)', () => {
  test('added, then taken out with the hunter shown before shown again, is the save it was', () => {
    const save = freshSave({ now: new Date('2026-11-14T10:00:00Z'), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d') }, { onboarded: true });
    const prev = save.settings.activeHunterId, made = { ...newHunter(RULES), id: hid('h90'), name: 'Joiner' };
    const joined = addHunter(save, made);
    expect(joined.settings.activeHunterId).toBe(hid('h90'));
    const back = both<Save>(s => removeHunter(s, 'h90', null), s => setActive(s, prev))(joined);
    if (isRefused(back)) throw new Error(back.why);
    expect(back).toEqual(save);
  });
});

describe('a hunter nothing was played on', () => {
  const fresh = (): Hunter => ({ ...newHunter(RULES), id: hid('h7'), name: 'Kai' });
  const cases: [string, (h: Hunter) => Hunter, boolean][] = [
    ['as made, under any name', h => h, true],
    ['named Hunter', h => ({ ...h, name: 'Hunter' }), true],
    ['with an emblem, a color and a later change time', h => ({ ...h, emblem: 'W', color: '#f00', updatedAt: '2026-11-15T10:00:00Z' }), true],
    ['with the daily quest every new hunter gets', h => ({ ...h, quests: [{ ...newQuest(), id: qid('q9'), kind: 'daily' }], daily: { ...h.daily, lastCheckedKey: day('2026-11-15') } }), true],
    ['at level 2', h => ({ ...h, level: 2 }), false],
    ['with 10 XP', h => ({ ...h, xp: 10 }), false],
    ['with 5 gold', h => ({ ...h, gold: 5 }), false],
    ['with an item', h => ({ ...h, items: [{ ...parseItem({ name: 'Rope' })!, id: iid('i3') }] }), false],
    ['with a quest of its own', h => ({ ...h, quests: [{ ...newQuest(), id: qid('q9'), kind: 'side' }] }), false],
    ['with a daily streak', h => ({ ...h, daily: { ...h.daily, streak: 1 } }), false],
    ['with a job', h => ({ ...h, job: 'Ranger' }), false],
    ['with fatigue', h => ({ ...h, fatigue: 2 }), false],
    ['with notes', h => ({ ...h, notes: 'owes Brakk 5 gold' }), false],
  ];
  for (const [what, make, expected] of cases) {
    test(`a hunter ${what} is ${expected ? '' : 'not '}untouched`, () => expect(untouched(make(fresh()), RULES)).toBe(expected));
  }
  test('the key order a save was stored in does not matter', () => {
    const h = fresh();
    const reversed = Object.fromEntries(Object.entries(h).reverse()) as Hunter;
    expect(untouched(reversed, RULES)).toBe(true);
  });
});

describe('the hunters a picker offers', () => {
  const here = [{ id: hid('h1'), name: 'Mira' }], key = parseSheetKey('d-p2:h1')!, sheets = [{ key, data: { name: 'Kai' } }];
  test('this phone\'s hunters, then the players\', each read back from the id its control carries', () => {
    const list = pickables(here, sheets);
    expect(list.map(p => [p.id, p.name])).toEqual([['h1', 'Mira'], ['d-p2:h1', 'Kai']]);
    expect(pickedRef(list, 'h1')).toEqual({ kind: 'local', hunterId: 'h1' });
    expect(pickedRef(list, 'd-p2:h1')).toEqual({ kind: 'remote', remote: key });
    expect(pickedRef(list, 'r:d-p2:h1'), 'no prefix is read').toBeNull();
  });
  test('a player\'s name is the sheet\'s; a key with no sheet says the words it is given', () => {
    expect(sheetName(sheets, key, 'a player')).toBe('Kai');
    expect(sheetName(sheets, 'd-p9:h1', 'a player')).toBe('a player');
  });
});

describe('why a tap failed, in words (src/core/sync/taps.ts)', () => {
  test('every kind has its words, but a campaign replaced while it waited and a tap the person ended with Leave, which say nothing', () => {
    for (const k of TAP_KINDS) expect(tapWords(k, 'ABCD23') === null).toBe(k === 'replaced' || k === 'left');
    expect(tapWords('notfound', 'ABCD23')).toContain('ABCD23');
    // a key the GM typed does not match the room; a key this phone kept is no longer valid (V4: the two had one sentence)
    expect(tapWords('keyRefused', 'ABCD23', true)).toBe('That GM key does not match this room.');
    expect(tapWords('keyRefused', 'ABCD23')).toBe('The GM key for ABCD23 is no longer valid.');
  });
});
