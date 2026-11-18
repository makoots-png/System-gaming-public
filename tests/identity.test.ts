import { describe, expect, test } from 'bun:test';
import { neutralSeed, withBadge } from '../src/core/hunter/identity.ts';
import { withImportedHunters } from '../src/core/hunter/imported.ts';
import { onboarded, withResetHour, withSound } from '../src/core/settings.ts';
import { SCHEMA, freshSave, newSettings, parseSaveValue } from '../src/core/save.ts';
import type { Hunter } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import { dev, hid, iid, qid, tid } from './fixtures/ids.ts';

const env = { now: new Date('2026-11-14T10:00:00Z'), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-test') };
/** The starter save's hunter: the canon seed, with a title, items, skills and the daily quest. */
/** A hunter as an imported file holds it: read by `parseSaveValue`, as io.js reads the file. */
const fileHunter = (raw: Record<string, unknown>): Hunter => {
  const p = parseSaveValue({ schema: SCHEMA, hunters: [raw] }, env);
  if (p.kind !== 'save') throw new Error(p.kind);
  return p.save.hunters[0]!;
};
const seed = (): Hunter => structuredClone(freshSave(env, { onboarded: false }).hunters[0]!);

describe('the emblem and colour', () => {
  test('picked and put back is the hunter it was', () => {
    const h = seed(), picked = withBadge(h, 'wolf', '#ffc94d');
    expect(picked).toMatchObject({ emblem: 'wolf', color: '#ffc94d' });
    expect(withBadge(picked, h.emblem, h.color)).toEqual(h);
  });
});

describe('the canon seed made neutral', () => {
  test('keeps only the dailies, drops titles, items, skills and gear, and takes the name and job', () => {
    const h = neutralSeed(seed(), 'Ana', 'Mage');
    expect(h).toMatchObject({ name: 'Ana', job: 'Mage', titles: [], titleId: null, items: [], skills: [] });
    expect(Object.values(h.equipped).every(v => v === null)).toBe(true);
    expect(h.quests.every(q => q.kind === 'daily')).toBe(true);
    expect(h.quests.length).toBe(seed().quests.filter(q => q.kind === 'daily').length);
  });
  test('no name is "Hunter"; no job keeps the job', () => {
    expect(neutralSeed(seed(), '').name).toBe('Hunter');
    expect(neutralSeed(seed(), 'Ana').job).toBe(seed().job);
  });
});

describe('the settings a person picks', () => {
  const s = newSettings(dev('d-test'));
  test('the reset hour is a whole hour from 0 to 23; an empty or unreadable field keeps the old one', () => {
    expect(withResetHour(s, '6.6').dailyResetHour).toBe(7);
    expect(withResetHour(s, '40').dailyResetHour).toBe(23);
    expect(withResetHour(s, '-3').dailyResetHour).toBe(0);
    expect(withResetHour({ ...s, dailyResetHour: 5 }, '')).toEqual({ ...s, dailyResetHour: 5 });
    expect(withResetHour({ ...s, dailyResetHour: 5 }, 'abc').dailyResetHour).toBe(5);
  });
  test('sound on then off is the settings they were', () => {
    expect(withSound(withSound(s, true), false)).toEqual(s);
  });
  test('onboarding done stays done', () => {
    expect(onboarded({ ...s, onboarded: false }).onboarded).toBe(true);
  });
});

describe('hunters added from another campaign\'s file', () => {
  test('each hunter and each entry gets a fresh id, and what it wears follows its entries', () => {
    const save = { ...freshSave(env, { onboarded: true }), seq: 200 };
    const file = fileHunter({
      id: 'h1', name: 'Bo', titleId: 't5', titles: [{ id: 't5', name: 'X' }], items: [{ id: 'i3', name: 'Sword', type: 'weapon', slot: 'weapon' }, { id: 'i4', name: 'Hat', type: 'armor', slot: 'head' }],
      equipped: { weapon: 'i3', head: 'i4' }, loadouts: [{ id: 'lo1', name: 'Set', slots: { weapon: 'i3', head: 'i4' } }],
    });
    const next = withImportedHunters(save, [file]), h = next.hunters.at(-1)!;
    expect(next.hunters).toHaveLength(save.hunters.length + 1);
    expect(h.titles[0]!.id).toBe(tid('t201'));
    expect(h.items.map(i => i.id)).toEqual([iid('i202'), iid('i203')]);
    expect(h.titleId).toBe(tid('t201'));
    expect(h.equipped).toMatchObject({ weapon: iid('i202'), head: iid('i203') });
    expect(h.loadouts[0]).toMatchObject({ id: 'lo204', slots: { weapon: iid('i202'), head: iid('i203') } });
    expect(h.id).toBe(hid('h205'));
    expect(next.seq).toBe(205);
    expect(next.settings.activeHunterId).toBe(hid('h205'));
    expect(file.id).toBe(hid('h1'));
  });
  test('a penalty and a Job Change chain keep their quests under the quests\' new ids', () => {
    const save = { ...freshSave(env, { onboarded: true }), seq: 300 };
    const file = fileHunter({
      id: 'h1', quests: [{ id: 'q7', kind: 'penalty' }, { id: 'q8', kind: 'job', chainId: 'c1' }],
      penalty: { since: '2026-11-13', days: 1, questId: 'q7' }, jobChain: { id: 'c1', job: 'Ranger', step: 1, status: 'active', questId: 'q8' },
    });
    expect([file.penalty?.questId, file.jobChain?.questId], 'the file holds both').toEqual([qid('q7'), qid('q8')]);
    const h = withImportedHunters(save, [file]).hunters.at(-1)!;
    expect(h.quests.map(q => q.id)).toEqual([qid('q301'), qid('q302')]);
    expect(h.penalty).toMatchObject({ questId: qid('q301') });
    expect(h.jobChain).toMatchObject({ questId: qid('q302'), status: 'active' });
  });
  test('no hunters leaves the save as it was', () => {
    const save = freshSave(env, { onboarded: true });
    expect(withImportedHunters(save, [])).toBe(save);
  });
});
