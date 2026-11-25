// A reward the app would pay by itself, waiting for the GM (src/core/hunter/pending.ts; World rule 8, the owner, Nov 22:
// rule d, "Yes"). Every state against every event; where each seat sends the reward; a reward never lost nor paid twice.
import { describe, expect, test } from 'bun:test';
import { ALONE, ENDED_KEPT, PENDING_EVENTS, PENDING_STATES, PENDING_WORDS, REWARD_ROUTE, ROUTE, askOf, parsePending, pendingApproveAll, pendingApproved, pendingAwardEvent, pendingHeard, pendingOf, pendingRefused, pendingStep, rewardSeatOf, routeFor, selfPaid, selfPay, waitingIn } from '../src/core/hunter/pending.ts';
import type { PendingEvent, PendingReward, PendingState, RewardSeat, SelfReward } from '../src/core/hunter/pending.ts';
import { gmAward } from '../src/core/award.ts';
import { freshSave, newHunter, newRewards } from '../src/core/save.ts';
import type { Save } from '../src/core/save.ts';
import { RULES } from '../src/core/rules.ts';
import { isRefused, refuse } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { approvalIdOf, parseEventId, sheetKeyOf } from '../src/core/ids.ts';
import type { EventId, SheetKey } from '../src/core/ids.ts';
import { approvalEvent, newEvent, parseEvent } from '../src/core/protocol.ts';
import { OUTBOX_MAX, atOutbox, post } from '../src/core/sync/outbox.ts';
import { memoryStore } from '../server.ts';
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

  test('solo clear selfPay splits clear gold three ways and cuts XP alone, waits untouched in a room, and gmAward applies debt on approved clears', () => {
    const owing: Save = { ...save(), hunters: save().hunters.map(h => ({ ...h, gold: 100, xp: 0, debt: 200, reviveLeft: 'none' as const })) };
    const solo: SelfReward = { from: 'solo', what: 'Goblin Warren', seed: 'personal h1 p1', rewards: { ...newRewards(), gold: 60, xp: 40 } };

    // Alone: solo clear splits 60 gold into 30 debt, 15 kept, 15 burned; XP cut to 25% (10 XP)
    const soloAlone = ok(selfPay(owing, H1, solo, ctx(ALONE)));
    expect([soloAlone.save.hunters[0]!.gold, soloAlone.save.hunters[0]!.xp, soloAlone.save.hunters[0]!.debt]).toEqual([115, 10, 170]);
    expect(soloAlone.granted?.debtPaid).toEqual({ total: 60, paid: 30, burn: 15, kept: 15, left: 170 });
    expect(soloAlone.granted?.debtXp).toEqual({ base: 40, xp: 10, rate: 0.25, left: 170 });

    // Alone: quest does not split gold, but still cuts XP while in debt (50 -> 13 XP)
    const questWithXp: SelfReward = { ...QUEST, rewards: { ...GOLD, xp: 50 } };
    const questAlone = ok(selfPay(owing, H1, questWithXp, ctx(ALONE)));
    expect([questAlone.save.hunters[0]!.gold, questAlone.save.hunters[0]!.xp, questAlone.save.hunters[0]!.debt]).toEqual([140, 13, 200]);
    expect(questAlone.granted?.debtPaid).toBeNull();
    expect(questAlone.granted?.debtXp).toEqual({ base: 50, xp: 13, rate: 0.25, left: 200 });

    // In a room as GM: pending waits without touching debt; refusing keeps debt; approving edited gold splits on the edited amount
    const waiting = ok(selfPay(owing, H1, solo, ctx({ seat: 'gm', room: ROOM }))).save;
    expect([waiting.hunters[0]!.gold, waiting.hunters[0]!.debt]).toEqual([100, 200]);
    const rec = waitingIn(waiting, ROOM)[0]!;

    const refused = ok(pendingRefused(waiting, rec.id, { stamp: { device: ME, now: Date.parse(AT), rand: 0.5 }, log: LOG }));
    expect(refused.hunters[0]!.debt).toBe(200);

    const editedGold = { ...newRewards(), gold: 120, xp: 40 };
    const awarded = gmAward(waiting, [{ hid: H1, vitals: 'sheet' }], editedGold, { room: ROOM, events: [], said: [] }, { at: AT, today: day('2026-11-22'), R: RULES }, null, rec.from);
    const approved = ok(pendingApproved(awarded.save, rec.id, editedGold));
    expect([approved.hunters[0]!.gold, approved.hunters[0]!.xp, approved.hunters[0]!.debt]).toEqual([130, 10, 140]);
    expect(awarded.granted[0]!.g.debtPaid).toEqual({ total: 120, paid: 60, burn: 30, kept: 30, left: 140 });
    expect(awarded.granted[0]!.g.debtXp).toEqual({ base: 40, xp: 10, rate: 0.25, left: 140 });

    // Manual GM award (from = null) leaves gold untouched, but still cuts XP while in debt
    const manual = gmAward(owing, [{ hid: H1, vitals: 'sheet' }], editedGold, { room: ROOM, events: [], said: [] }, { at: AT, today: day('2026-11-22'), R: RULES });
    expect([manual.save.hunters[0]!.gold, manual.save.hunters[0]!.xp, manual.save.hunters[0]!.debt]).toEqual([220, 10, 200]);
  });

  test('REWARD_ROUTE and routeFor: clear pays directly on alone and gm; solo, quest, and feat stay on ROUTE', () => {
    expect(REWARD_ROUTE).toEqual({
      solo: { alone: 'pay', player: 'ask', gm: 'wait' },
      quest: { alone: 'pay', player: 'ask', gm: 'wait' },
      feat: { alone: 'pay', player: 'ask', gm: 'wait' },
      clear: { alone: 'pay', player: 'ask', gm: 'pay' },
    });
    expect(routeFor('gm', 'clear')).toBe('pay');
    expect(routeFor('alone', 'clear')).toBe('pay');
    expect(routeFor('player', 'clear')).toBe('ask');
    expect(routeFor('gm', 'solo')).toBe('wait');
    expect(routeFor('gm', 'quest')).toBe('wait');
    expect(routeFor('gm', 'feat')).toBe('wait');
  });

  test('approvalIdOf and approvalEvent produce deterministic, valid, non-end EventIds including 40-char inputs', () => {
    const std = eid('d-p1-1abc-wxyz');
    expect(approvalIdOf(std)).toBe('d-p1-1abc-wxyz-a' as EventId);
    expect(parseEventId(approvalIdOf(std))).toBe(approvalIdOf(std));

    const max40 = eid('a'.repeat(40));
    const max40b = eid(`${'a'.repeat(39)}b`);
    const idA = approvalIdOf(max40);
    const idB = approvalIdOf(max40b);
    expect(idA.length).toBeLessThanOrEqual(40);
    expect(parseEventId(idA)).toBe(idA);
    expect(idA.endsWith('-a')).toBe(true);
    expect(idA).not.toBe(idB);
    expect(approvalIdOf(max40)).toBe(idA);

    const ev = approvalEvent(max40, { to: [PLAYER], rewards: GOLD, earned: { from: 'quest', what: 'Long id' } });
    expect(ev?.type).toBe('award');
    expect(ev?.payload.eid).toBe(idA);
  });

  test('pendingApproveAll approves local and remote waiting rewards in one atomic step, preserves debt rules, and is idempotent on double tap', () => {
    const dayCtx = { at: AT, today: day('2026-11-22'), R: RULES };
    const OTHER_ROOM = room('XYZ789');
    const P2: SheetKey = sheetKeyOf(dev('d-p2'), hid('h2'));
    let s: Save = { ...save(), hunters: save().hunters.map(h => ({ ...h, gold: 100, xp: 0, debt: 200, reviveLeft: 'none' as const })) };
    // Local solo reward (splits clear gold 50/25/25 toward debt) + remote quest + remote feat + another room's waiting reward
    s = pendingHeard(s, { eid: eid('d-me1-s1-aaaa'), by: sheetKeyOf(ME, H1), name: 'Mira', from: 'solo', what: 'Goblin Den', rewards: { ...newRewards(), gold: 60, xp: 40 } }, ROOM, LOG);
    s = pendingHeard(s, { eid: eid('d-p1-q1-bbbb'), by: PLAYER, name: 'Kai', from: 'quest', what: 'Ten Beasts', rewards: { ...newRewards(), gold: 40 } }, ROOM, LOG);
    s = pendingHeard(s, { eid: eid('d-p2-f1-cccc'), by: P2, name: 'Sera', from: 'feat', what: 'First Clear', rewards: { ...newRewards(), points: 1 } }, ROOM, LOG);
    s = pendingHeard(s, { eid: eid('d-p1-o1-dddd'), by: PLAYER, name: 'Kai', from: 'quest', what: 'Other Room', rewards: GOLD }, OTHER_ROOM, LOG);

    const res = ok(pendingApproveAll(s, ROOM, { day: dayCtx }));
    expect(res.approved.map(r => r.id)).toEqual([eid('d-me1-s1-aaaa'), eid('d-p1-q1-bbbb'), eid('d-p2-f1-cccc')]);
    expect(res.remaining).toBe(0);
    expect(waitingIn(res.save, ROOM)).toEqual([]);
    expect(waitingIn(res.save, OTHER_ROOM)).toHaveLength(1);

    // Local hunter received solo clear with 3-way debt split (60 -> 30 debt, 15 burn, 15 kept) and 25% XP (10 XP)
    expect([res.save.hunters[0]!.gold, res.save.hunters[0]!.xp, res.save.hunters[0]!.debt]).toEqual([115, 10, 170]);
    expect(res.granted).toHaveLength(1);

    // Remote hunters each got one deterministic award event in outbox
    const outbox = (res.save.settings.sync.outbox ?? []).map(e => (e.letter.kind === 'event' ? e.letter.event : null));
    expect(outbox.map(e => [e?.type, e?.payload.eid, e?.type === 'award' ? e.payload.to : null, e?.type === 'award' ? e.payload.earned : null])).toEqual([
      ['award', approvalIdOf(eid('d-p1-q1-bbbb')), [PLAYER], { from: 'quest', what: 'Ten Beasts' }],
      ['award', approvalIdOf(eid('d-p2-f1-cccc')), [P2], { from: 'feat', what: 'First Clear' }],
    ]);

    // Double tap is a clean refusal and changes nothing
    expect(pendingApproveAll(res.save, ROOM, { day: dayCtx })).toEqual({ ok: false, why: 'no-reward' });
  });

  test('pendingApproveAll across two GM devices produces identical EventIds that the room server deduplicates', async () => {
    const dayCtx = { at: AT, today: day('2026-11-22'), R: RULES };
    const GM2 = dev('d-gm2');
    const recInput = { eid: eid('d-p1-q9-zzzz'), by: PLAYER, name: 'Kai', from: 'quest' as const, what: 'Daily', rewards: GOLD };
    const gm1Save = pendingHeard(save(), recInput, ROOM, LOG);
    const gm2Base: Save = { ...freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => GM2 }, { onboarded: true }) };
    const gm2Save = pendingHeard(gm2Base, recInput, ROOM, LOG);

    const a1 = ok(pendingApproveAll(gm1Save, ROOM, { day: dayCtx }));
    const a2 = ok(pendingApproveAll(gm2Save, ROOM, { day: dayCtx }));
    const ev1 = a1.save.settings.sync.outbox![0]!.letter;
    const ev2 = a2.save.settings.sync.outbox![0]!.letter;
    expect(ev1.kind === 'event' && ev2.kind === 'event' && ev1.event.payload.eid === ev2.event.payload.eid).toBe(true);

    const st = memoryStore();
    await st.create(ROOM, gmKey('gm-key-test-0123456789abcdef'), Date.now());
    const seq1 = await st.addEvent(ROOM, ME, (ev1 as Extract<typeof ev1, { kind: 'event' }>).event, 1000);
    const seq2 = await st.addEvent(ROOM, GM2, (ev2 as Extract<typeof ev2, { kind: 'event' }>).event, 1005);
    expect(seq1).toBe(1);
    expect(seq2).toBe(1);
    expect((await st.events(ROOM, 0)).events).toHaveLength(1);
  });

  test('single-row approve and approve-all of the same record produce the same EventId and deduplicate on the server', async () => {
    const dayCtx = { at: AT, today: day('2026-11-22'), R: RULES };
    const GM2 = dev('d-gm2');
    const recInput = { eid: eid('d-p1-r1-same'), by: PLAYER, name: 'Mira', from: 'quest' as const, what: 'Ten Beasts', rewards: GOLD };
    const gm1Save = pendingHeard(save(), recInput, ROOM, LOG);
    const gm2Save = pendingHeard({ ...freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => GM2 }, { onboarded: true }) }, recInput, ROOM, LOG);

    const rec = waitingIn(gm1Save, ROOM)[0]!;
    const singleEv = pendingAwardEvent(rec, rec.rewards)!;
    const allRes = ok(pendingApproveAll(gm2Save, ROOM, { day: dayCtx }));
    const allLetter = allRes.save.settings.sync.outbox![0]!.letter;
    expect(allLetter.kind).toBe('event');
    const allEv = (allLetter as Extract<typeof allLetter, { kind: 'event' }>).event;

    expect(singleEv.payload.eid).toBe(approvalIdOf(rec.id));
    expect(singleEv.payload.eid).toBe(allEv.payload.eid);
    expect(singleEv).toEqual(allEv);

    const st = memoryStore();
    await st.create(ROOM, gmKey('gm-key-test-0123456789abcdef'), Date.now());
    expect(await st.addEvent(ROOM, ME, singleEv, 1000)).toBe(1);
    expect(await st.addEvent(ROOM, GM2, allEv, 1005)).toBe(1);
    expect((await st.events(ROOM, 0)).events).toHaveLength(1);

    const editedEv = pendingAwardEvent(rec, EDITED)!;
    expect(editedEv.payload.eid).toBe(allEv.payload.eid);
    expect(await st.addEvent(ROOM, GM2, editedEv, 1010)).toBe('idTaken');
    expect((await st.events(ROOM, 0)).events).toHaveLength(1);
  });

  test('pendingApproveAll respects OUTBOX_MAX without dropping queued letters, refuses outbox-full at 0 free slots, and handles deleted local hunters', () => {
    const dayCtx = { at: AT, today: day('2026-11-22'), R: RULES };
    let full = save();
    for (let i = 0; i < OUTBOX_MAX - 1; i++) {
      const ev = newEvent('hp', { to: [PLAYER], hp: -1, mana: 0, fatigue: 0, reason: 'q' }, { device: ME, now: 1000, rand: 0.5, seq: i })!;
      full = atOutbox(b => post(b, ROOM, { kind: 'event', event: ev }).box)(full);
    }
    full = pendingHeard(full, ask('d-p1-cap1-aaaa'), ROOM, LOG);
    full = pendingHeard(full, ask('d-p1-cap2-bbbb'), ROOM, LOG);

    // 1 slot free: approves first remote, leaves second waiting, drops 0 queued messages
    const partial = ok(pendingApproveAll(full, ROOM, { day: dayCtx }));
    expect(partial.approved.map(r => r.id)).toEqual([eid('d-p1-cap1-aaaa')]);
    expect(partial.remaining).toBe(1);
    expect(waitingIn(partial.save, ROOM).map(r => r.id)).toEqual([eid('d-p1-cap2-bbbb')]);
    expect(partial.save.settings.sync.outbox).toHaveLength(OUTBOX_MAX);
    expect(partial.save.settings.sync.outbox![0]!.letter.kind === 'event' && partial.save.settings.sync.outbox![0]!.letter.event.type).toBe('hp');

    // Now 0 slots free: refuses outbox-full atomically without touching the remaining waiting reward
    expect(pendingApproveAll(partial.save, ROOM, { day: dayCtx })).toEqual({ ok: false, why: 'outbox-full' });

    // Deleted local hunter still marks approved and does not wedge the list
    const missingKey = sheetKeyOf(ME, hid('h999'));
    const ghostSave = pendingHeard(save(), { eid: eid('d-me1-ghst-aaaa'), by: missingKey, name: 'Ghost', from: 'quest', what: 'Old', rewards: GOLD }, ROOM, LOG);
    const clearedGhost = ok(pendingApproveAll(ghostSave, ROOM, { day: dayCtx }));
    expect(clearedGhost.approved).toHaveLength(1);
    expect(clearedGhost.granted).toEqual([]);
    expect(waitingIn(clearedGhost.save, ROOM)).toEqual([]);
  });
});
