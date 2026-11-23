// A reward the app would pay by itself, waiting for the GM (src/core/hunter/pending.ts; World rule 8, the owner, Nov 22:
// rule d, "Yes"). Every state against every event; where each seat sends the reward; a reward never lost nor paid twice.
import { describe, expect, test } from 'bun:test';
import { ALONE, ENDED_KEPT, PENDING_EVENTS, PENDING_STATES, PENDING_WORDS, ROUTE, askOf, parsePending, pendingApproved, pendingHeard, pendingOf, pendingRefused, pendingStep, rewardSeatOf, selfPaid, selfPay, waitingIn } from '../src/core/hunter/pending.ts';
import type { PendingEvent, PendingReward, PendingState, RewardSeat, SelfReward } from '../src/core/hunter/pending.ts';
import { freshSave, newHunter, newRewards } from '../src/core/save.ts';
import type { Save } from '../src/core/save.ts';
import { RULES } from '../src/core/rules.ts';
import { isRefused, refuse } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { parseEventId, sheetKeyOf } from '../src/core/ids.ts';
import type { EventId, SheetKey } from '../src/core/ids.ts';
import { parseEvent } from '../src/core/protocol.ts';
import { day, dev, gmKey, hid, room } from './fixtures/ids.ts';

const ok = <T>(r: T | Refused): T => { if (isRefused(r)) throw new Error(`refused: ${r.why}`); return r as T; };
const AT = '2026-11-22T10:00:00.000Z';
const ROOM = room('ABC234');
const H1 = hid('h1');
const ME = dev('d-me1');
const PLAYER: SheetKey = sheetKeyOf(dev('d-p1'), H1);
const eid = (s: string): EventId => parseEventId(s)!;
const save = (): Save => ({ ...freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => ME }, { onboarded: true }), hunters: [{ ...newHunter(RULES), id: H1, name: 'Mira', gold: 100 }] });
const GOLD = { ...newRewards(), gold: 40 };
const QUEST: SelfReward = { from: 'quest', what: 'Ten Beasts', seed: 'quest h1 q7', rewards: GOLD };
const ctx = (seat: RewardSeat) => ({ at: AT, today: day('2026-11-22'), R: RULES, seat });
const LOG = { at: AT, cap: RULES.logCap };
const ask = (id = 'd-p1-1abc-wxyz', rewards = GOLD) => ({ eid: eid(id), by: PLAYER, name: 'Mira', from: 'quest' as const, what: 'Ten Beasts', rewards });

const REC: PendingReward = { id: eid('d-p1-1abc-wxyz'), room: ROOM, to: PLAYER, name: 'Mira', from: 'quest', what: 'Ten Beasts', rewards: GOLD, heard: AT, at: 'waiting' };
const EDITED = { ...newRewards(), gold: 90 };
const EVENTS: { readonly [E in PendingEvent['type']]: Extract<PendingEvent, { type: E }> } = { edit: { type: 'edit', rewards: EDITED }, approve: { type: 'approve' }, refuse: { type: 'refuse' } };
const STATES: { readonly [S in PendingState]: PendingReward } = { waiting: REC, approved: { ...REC, at: 'approved' }, refused: { ...REC, at: 'refused' } };

describe('a reward waiting for the GM', () => {
  test('every state answers every event: waiting takes an edit, an approve or a refuse; approved and refused are ends', () => {
    const table = Object.fromEntries(PENDING_STATES.map(s => [s, Object.fromEntries(PENDING_EVENTS.map(e => [e, pendingStep(STATES[s], EVENTS[e])]))]));
    expect(table).toEqual({
      waiting: { edit: { ...REC, rewards: EDITED }, approve: { ...REC, at: 'approved' }, refuse: { ...REC, at: 'refused' } },
      approved: { edit: null, approve: null, refuse: null },
      refused: { edit: null, approve: null, refuse: null },
    });
  });

  test('alone the reward is paid at once (no GM to ask); a player\'s phone asks the GM and pays nothing; the GM\'s phone keeps it waiting and pays nothing', () => {
    expect(ROUTE).toEqual({ alone: 'pay', player: 'ask', gm: 'wait' });
    const alone = ok(selfPaid(save(), H1, QUEST, ctx({ seat: 'alone' })));
    expect(alone.hunters[0]!.gold).toBe(140);
    expect(alone.settings.sync.outbox ?? []).toEqual([]);
    expect(pendingOf(alone)).toEqual([]);

    const player = ok(selfPaid(save(), H1, QUEST, ctx({ seat: 'player', room: ROOM })));
    expect(player.hunters[0]!.gold).toBe(100);
    const letters = (player.settings.sync.outbox ?? []).map(e => (e.letter.kind === 'event' ? e.letter.event : null));
    expect(letters.map(e => e?.type)).toEqual(['rewardAsk']);
    expect(letters[0]!.payload).toMatchObject({ by: sheetKeyOf(ME, H1), name: 'Mira', from: 'quest', what: 'Ten Beasts', rewards: GOLD });
    expect(pendingOf(player)).toEqual([]);

    const gm = ok(selfPaid(save(), H1, QUEST, ctx({ seat: 'gm', room: ROOM })));
    expect(gm.hunters[0]!.gold).toBe(100);
    expect(gm.settings.sync.outbox ?? []).toEqual([]);
    expect(waitingIn(gm, ROOM).map(p => [p.to, p.from, p.what, p.rewards.gold])).toEqual([[sheetKeyOf(ME, H1), 'quest', 'Ten Beasts', 40]]);
  });

  test('the same reward earned again in one write is one ask and one record; an empty reward goes nowhere', () => {
    const player = ok(selfPaid(ok(selfPaid(save(), H1, QUEST, ctx({ seat: 'player', room: ROOM }))), H1, QUEST, ctx({ seat: 'player', room: ROOM })));
    expect(player.settings.sync.outbox ?? []).toHaveLength(1);
    const gm = ok(selfPaid(ok(selfPaid(save(), H1, QUEST, ctx({ seat: 'gm', room: ROOM }))), H1, QUEST, ctx({ seat: 'gm', room: ROOM })));
    expect(pendingOf(gm)).toHaveLength(1);
    const empty = { ...QUEST, rewards: newRewards() };
    for (const seat of [{ seat: 'alone' }, { seat: 'player', room: ROOM }, { seat: 'gm', room: ROOM }] as const) expect(ok(selfPaid(save(), H1, empty, ctx(seat)))).toEqual(save());
  });

  test('a player\'s ask heard twice is one record, with one log line', () => {
    const once = pendingHeard(save(), ask(), ROOM, LOG);
    expect(pendingHeard(once, ask(), ROOM, LOG)).toBe(once);
    expect(waitingIn(once, ROOM).map(p => p.id)).toEqual(['d-p1-1abc-wxyz']);
    expect(once.log[0]).toMatchObject({ kind: 'award', title: PENDING_WORDS.logTitle, text: 'Mira: Quest complete: Ten Beasts' });
  });

  test('the GM approves an edited reward once: the record keeps what was approved, and a second approve or a refuse after it is refused', () => {
    const heard = pendingHeard(save(), ask(), ROOM, LOG);
    const approved = ok(pendingApproved(heard, 'd-p1-1abc-wxyz', EDITED));
    expect(pendingOf(approved)).toEqual([{ ...REC, rewards: EDITED, at: 'approved' }]);
    expect(waitingIn(approved, ROOM)).toEqual([]);
    expect(pendingApproved(approved, 'd-p1-1abc-wxyz', EDITED)).toEqual({ ok: false, why: 'answered' });
    expect(pendingRefused(approved, 'd-p1-1abc-wxyz', { stamp: { device: ME, now: Date.parse(AT), rand: 0.5 }, log: LOG })).toEqual({ ok: false, why: 'answered' });
    expect(pendingApproved(heard, 'd-p9-1abc-wxyz', EDITED)).toEqual({ ok: false, why: 'no-reward' });
  });

  test('a refused reward tells the player\'s phone in a window sealed to that hunter; the GM\'s own hunter is told nothing in the room', () => {
    const c = { stamp: { device: ME, now: Date.parse(AT), rand: 0.5 }, log: LOG };
    const refused = ok(pendingRefused(pendingHeard(save(), ask(), ROOM, LOG), 'd-p1-1abc-wxyz', c));
    expect(pendingOf(refused)[0]!.at).toBe('refused');
    const sent = (refused.settings.sync.outbox ?? []).map(e => (e.letter.kind === 'event' ? e.letter.event : null));
    expect(sent.map(e => e?.type)).toEqual(['system']);
    expect(sent[0]!.payload).toMatchObject({ to: [PLAYER], title: 'REWARD REFUSED' });
    expect(refused.log[0]).toMatchObject({ title: 'Reward refused', text: 'Mira: Quest complete: Ten Beasts' });

    const own = ok(selfPaid(save(), H1, QUEST, ctx({ seat: 'gm', room: ROOM })));
    const ownRefused = ok(pendingRefused(own, pendingOf(own)[0]!.id, c));
    expect(ownRefused.settings.sync.outbox ?? []).toEqual([]);
    expect(ownRefused.hunters[0]!.gold).toBe(100);
  });

  test('the records survive a reload: read back whole; a broken one is dropped; past the waiting ones only the newest ended are kept', () => {
    const heard = pendingHeard(pendingHeard(save(), ask(), ROOM, LOG), ask('d-p1-1abd-wxyz'), ROOM, LOG);
    const approved = ok(pendingApproved(heard, 'd-p1-1abc-wxyz', EDITED));
    expect(parsePending(JSON.parse(JSON.stringify([...pendingOf(approved), { id: 'nope' }])))).toEqual([...pendingOf(approved)]);
    let s = save();
    for (let i = 0; i < ENDED_KEPT + 3; i++) {
      const id = `d-p1-1a${i.toString(36).padStart(2, '0')}-wxyz`;
      s = ok(pendingApproved(pendingHeard(s, ask(id), ROOM, LOG), id, GOLD));
    }
    s = pendingHeard(s, ask('d-p1-1zzz-wxyz'), ROOM, LOG);
    expect(pendingOf(s)).toHaveLength(ENDED_KEPT + 1);
    expect(waitingIn(s, ROOM).map(p => p.id)).toEqual(['d-p1-1zzz-wxyz']);
  });

  test('an ask the room carries is read back as it was sent: what earned it and its reward', () => {
    const ev = askOf(save(), H1, QUEST, AT)!;
    expect(parseEvent('rewardAsk', JSON.parse(JSON.stringify(ev.payload)))).toEqual(ev);
    expect(parseEvent('rewardAsk', { ...ev.payload, from: 'shelf' }), 'only a solo clear, a quest and a feat ask').toBeNull();
    expect(parseEvent('rewardAsk', { ...ev.payload, from: 'clear' }), 'a player phone never asks a table clear').toBeNull();
  });

  test('a clear preset pending record keeps from: clear through parsePending and formats its earned words', () => {
    const clearAsk = { ...ask('d-gm-1abc-wxyz', GOLD), from: 'clear' as const, what: 'Goblin Den' };
    const s = pendingHeard(save(), clearAsk, ROOM, LOG);
    expect(waitingIn(s, ROOM)[0]!.from).toBe('clear');
    expect(s.log[0]!.text).toBe('Mira: Gate clear: Goblin Den');
    expect(parsePending(JSON.parse(JSON.stringify(pendingOf(s))))).toEqual([...pendingOf(s)]);
  });

  test('rewardSeatOf reads alone, player and gm from the save; selfPay returns granted only when paid alone', () => {
    const base = save();
    expect(rewardSeatOf(base)).toEqual(ALONE);
    const asPlayer: Save = { ...base, settings: { ...base.settings, sync: { ...base.settings.sync, room: ROOM, gmKey: null } } };
    expect(rewardSeatOf(asPlayer)).toEqual({ seat: 'player', room: ROOM });
    const asGm: Save = { ...base, settings: { ...base.settings, sync: { ...base.settings.sync, room: ROOM, gmKey: gmKey('gm-key-test-0123456789abcdef') } } };
    expect(rewardSeatOf(asGm)).toEqual({ seat: 'gm', room: ROOM });

    const paidAlone = ok(selfPay(base, H1, QUEST, ctx(ALONE)));
    expect(paidAlone.granted?.lines).toContain('+40 gold');
    expect(paidAlone.save.hunters[0]!.gold).toBe(140);

    const paidPlayer = ok(selfPay(asPlayer, H1, QUEST, ctx({ seat: 'player', room: ROOM })));
    expect(paidPlayer.granted).toBeNull();
    expect(paidPlayer.save.hunters[0]!.gold).toBe(100);

    const paidGm = ok(selfPay(asGm, H1, QUEST, ctx({ seat: 'gm', room: ROOM })));
    expect(paidGm.granted).toBeNull();
    expect(paidGm.save.hunters[0]!.gold).toBe(100);
  });

  test('selfPay and selfPaid hand back a refused grant or absent hunter instead of silently keeping the save', () => {
    const missing = hid('h9');
    for (const seat of [ALONE, { seat: 'player', room: ROOM }, { seat: 'gm', room: ROOM }] as const) {
      expect(selfPay(save(), missing, QUEST, ctx(seat))).toEqual({ ok: false, why: 'no-hunter' });
      expect(selfPaid(save(), missing, QUEST, ctx(seat))).toEqual({ ok: false, why: 'no-hunter' });
    }
    const refusedGrant = selfPay(save(), H1, QUEST, { ...ctx(ALONE), grant: () => refuse('no-hunter') });
    expect(refusedGrant).toEqual({ ok: false, why: 'no-hunter' });
  });
});
