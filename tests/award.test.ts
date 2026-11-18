// What one of the GM view's actions writes (src/core/award.ts): its change, its posts and its log line in one answer.
import { describe, expect, test } from 'bun:test';
import { gmAward, sent } from '../src/core/award.ts';
import { newRewards } from '../src/core/rewards.ts';
import { RULES } from '../src/core/rules.ts';
import { freshSave, newHunter } from '../src/core/save.ts';
import type { ParseEnv, Save } from '../src/core/save.ts';
import { newEvent } from '../src/core/protocol.ts';
import { dev, day, hid, room } from './fixtures/ids.ts';

const AT = '2026-11-15T10:00:00.000Z', ROOM = room('ABCD23');
const ENV: ParseEnv = { now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-gm') };
const DAY = { at: AT, today: day('2026-11-15'), R: RULES };
/** The GM's save with two hunters of this phone, h1 (Mira) and h2 (Brakk). */
function gm(): Save {
  const s = freshSave(ENV, { onboarded: true });
  return { ...s, hunters: [{ ...s.hunters[0]!, id: hid('h1'), name: 'Mira' }, { ...newHunter(RULES), id: hid('h2'), name: 'Brakk' }] };
}
const award = (xp: number) => newEvent('award', { to: ['d-p1:h1' as never], rewards: { ...newRewards(), xp } }, { device: 'd-gm', now: 1, rand: 0.25 })!;
const said = [{ kind: 'award' as const, hunterId: null, title: 'GM award', text: '+50 XP → Mira, Brakk, Kai' }];

describe('the GM\'s Send award is one write', () => {
  test('every hunter of this phone gets the reward, the player\'s award waits in the outbox and the log has its line, in one save', () => {
    const r = gmAward(gm(), [{ hid: 'h1', vitals: 'sheet' }, { hid: 'h2', vitals: 'sheet' }], { ...newRewards(), xp: 50 }, { room: ROOM, events: [award(50)], said }, DAY);
    expect(r.save.hunters.map(h => h.xp)).toEqual([50, 50]);
    expect(r.granted.map(g => g.hid)).toEqual(['h1', 'h2']);
    expect((r.save.settings.sync.outbox ?? []).map(e => e.letter.kind === 'event' && e.letter.event.type)).toEqual(['award']);
    expect(r.save.log[0]).toMatchObject({ kind: 'award', title: 'GM award', text: said[0]!.text, hunterId: null });
  });

  test('a bundle given by hand is a fact of each hunter\'s chronicle, in the award\'s write, even when it gives nothing but its words', () => {
    const given = { key: 'seed-straight-face', name: 'Straight Face', window: { title: 'THE SYSTEM BELIEVED YOU TOO', line: 'A good lie.' } };
    const r = gmAward(gm(), [{ hid: 'h1', vitals: 'sheet' }], newRewards(), { room: null, events: [], said }, DAY, given);
    expect(r.save.hunters[0]!.chronicle.inbox).toEqual([{ kind: 'given', key: 'seed-straight-face', name: 'Straight Face' }]);
    expect(r.save.hunters[1]!.chronicle.inbox).toEqual([]);
    expect(gmAward(gm(), [{ hid: 'h1', vitals: 'sheet' }], newRewards(), { room: null, events: [], said }, DAY).save.hunters[0]!.chronicle.inbox, 'a plain award records nothing').toEqual([]);
  });

  test('a hunter no longer on this phone is left out and the rest is written', () => {
    const r = gmAward(gm(), [{ hid: 'h9', vitals: 'sheet' }, { hid: 'h2', vitals: 'sheet' }], { ...newRewards(), gold: 5 }, { room: null, events: [], said }, DAY);
    expect(r.granted.map(g => g.hid)).toEqual(['h2']);
    expect(r.save.log).toHaveLength(gm().log.length + 1);
  });

  test('outside a room nothing is queued; a post repeated is queued once', () => {
    const ev = award(10);
    expect(sent(gm(), { room: null, events: [ev], said: [] }, { at: AT, cap: RULES.logCap }).settings.sync.outbox ?? []).toEqual([]);
    const twice = sent(sent(gm(), { room: ROOM, events: [ev], said: [] }, { at: AT, cap: RULES.logCap }), { room: ROOM, events: [ev], said: [] }, { at: AT, cap: RULES.logCap });
    expect(twice.settings.sync.outbox).toHaveLength(1);
  });
});
