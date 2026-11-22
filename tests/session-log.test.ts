import { describe, expect, test } from 'bun:test';
import { logLine, logged, questUpdateSaid } from '../src/core/session-log.ts';
import { freshSave, repairSave } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import { dev, hid, lid } from './fixtures/ids.ts';

const env = { now: new Date('2026-11-14T10:00:00Z'), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-test') };

test('a line goes on top of the session log, and the oldest falls off past the cap', () => {
  const save = { ...freshSave(env, { onboarded: true }), log: [logLine(lid('l1'), 'a', 'system', null, 'one', ''), logLine(lid('l2'), 'b', 'system', null, 'two', '')] };
  const next = logged(logLine(lid('l3'), 'c', 'rank', hid('h1'), 'three', 'text'), { logCap: 2 })(save);
  if (isRefused(next)) throw new Error('refused');
  expect(next.log.map(l => l.id)).toEqual(['l3', 'l1']);
  expect(next.log[0]).toEqual({ id: 'l3', at: 'c', kind: 'rank', hunterId: 'h1', title: 'three', text: 'text' });
  expect(save.log).toHaveLength(2);
});

describe('a player\'s quest progress in the GM\'s log', () => {
  test('names no hunter of the GM\'s phone, and says who and how far', () => {
    const objectives = [{ label: 'Wolves', progress: 2, target: 3 }, { label: 'Den', progress: 0, target: 1 }];
    expect(questUpdateSaid({ name: 'Mira', title: 'Wolf Hunt', status: 'active', objectives, secret: false })).toEqual({ kind: 'quest', hunterId: null, title: 'Quest progress', text: 'Mira · Wolf Hunt 2/4' });
    expect(questUpdateSaid({ name: 'Mira', title: 'Wolf Hunt', status: 'done', objectives, secret: false })).toEqual({ kind: 'quest', hunterId: null, title: 'Quest completed', text: 'Mira COMPLETED Wolf Hunt' });
  });
  test('marks a secret quest\'s progress and end "(secret)", so the GM knows not to say it aloud', () => {
    const objectives = [{ label: 'Find the traitor', progress: 1, target: 2 }];
    expect(questUpdateSaid({ name: 'Mira', title: 'The traitor', status: 'active', objectives, secret: true }).text).toBe('Mira · The traitor (secret) 1/2');
    expect(questUpdateSaid({ name: 'Mira', title: 'The traitor', status: 'failed', objectives, secret: true }).text).toBe('Mira FAILED The traitor (secret)');
  });
});
