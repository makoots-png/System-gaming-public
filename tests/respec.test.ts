import { describe, expect, test } from 'bun:test';
import { RULES, RANKS } from '../src/core/rules.ts';
import type { Rank, Rules } from '../src/core/rules.ts';
import { freshSave } from '../src/core/save.ts';
import type { Hunter, Save } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { hasFought, newTally } from '../src/core/hunter/chronicle.ts';
import { available, confirm, lower, raise, raiseMany, setLevel, setStat, spentTotal, takeAll } from '../src/core/hunter/progress.ts';
import { RESPEC_WORDS, confirmCostLine, confirmPoints, respecCost, respecRefusalWords, respecSaid, respecToast } from '../src/core/hunter/respec.ts';
import type { ConfirmCtx } from '../src/core/hunter/respec.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { hpOf } from '../src/core/hunter/vitals.ts';
import { warningFaults } from '../src/core/warning.ts';
import { isSealed, servedTo } from '../src/core/protocol.ts';
import type { RoomViewer } from '../src/core/protocol.ts';
import { dev, room } from './fixtures/ids.ts';

const AT = '2026-11-24T12:00:00.000Z';
const R = RULES as Rules;
const ok = <T>(v: T | Refused): T => { if (isRefused(v)) throw new Error(`refused: ${v.why}`); return v as T; };

function makeSave(patch?: (h: Hunter) => Hunter): Save {
  const s = freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-p1') }, { onboarded: true });
  const h = patch ? patch(s.hunters[0]!) : s.hunters[0]!;
  return { ...s, hunters: [h] };
}

const fought = (h: Hunter, kind: 'fights' | 'soloWon' | 'soloLost' | 'retreats' | 'gates' = 'fights'): Hunter => ({
  ...h,
  chronicle: { ...h.chronicle, tally: { ...h.chronicle.tally, [kind]: 1 } },
});

const spentHunter = (plan: Partial<Record<'str' | 'agi' | 'vit' | 'ins' | 'dis' | 'pre' | 'pow' | 'ctl', number>>, extra: Partial<Hunter> = {}): Save =>
  makeSave(h => {
    const built = confirm(ok(raiseMany({ ...h, ...extra }, plan, R)));
    const sheet = hunterSheet(built, R).sheet;
    return { ...built, life: extra.life ?? { at: 'up', hp: sheet.hpMax }, mana: sheet.manaMax };
  });

const baseCtx = (over: Partial<ConfirmCtx> = {}): ConfirmCtx => ({
  role: 'player',
  held: false,
  at: AT,
  room: null,
  stamp: null,
  R,
  ...over,
});

describe('hasFought on chronicle tally', () => {
  test('is false before combat and true once any fight, solo run, retreat, or gate clear lands', () => {
    expect(hasFought(newTally())).toBe(false);
    expect(hasFought({ ...newTally(), quests: 5, dailies: 7, bought: 3, rests: 2 })).toBe(false);
    for (const k of ['fights', 'soloWon', 'soloLost', 'retreats', 'gates'] as const) {
      expect(hasFought({ ...newTally(), [k]: 1 }), k).toBe(true);
    }
  });
});

describe('respecCost: sole cost owner across ranks, counts, roles, and rules', () => {
  const foughtOf = (rank: Rank) => ({ rank, chronicle: { tally: { ...newTally(), fights: 1 } } });
  const freshOf = (rank: Rank) => ({ rank, chronicle: { tally: newTally() } });

  test('matches the exact rank price table (0.5x priceBase full, 1/10th per point, capped at full)', () => {
    const table: readonly [Rank, number, number][] = [
      ['E', 5, 50],
      ['D', 16, 163],
      ['C', 63, 625],
      ['B', 250, 2500],
      ['A', 950, 9500],
      ['S', 3750, 37500],
    ];
    for (const [rank, per, full] of table) {
      expect(respecCost(foughtOf(rank), 1, 'player', R)).toEqual({ count: 1, cost: per, freeWhy: null });
      expect(respecCost(foughtOf(rank), 5, 'player', R)).toEqual({ count: 5, cost: Math.min(full, 5 * per), freeWhy: null });
      expect(respecCost(foughtOf(rank), 11, 'player', R)).toEqual({ count: 11, cost: full, freeWhy: null });
      expect(respecCost(foughtOf(rank), 30, 'player', R)).toEqual({ count: 30, cost: full, freeWhy: null });
    }
    // D rank: 10 points = 160, 11 points = 163 (capped). C rank: 9 points = 567, 10 points = 625 (capped).
    expect(respecCost(foughtOf('D'), 10, 'player', R).cost).toBe(160);
    expect(respecCost(foughtOf('D'), 11, 'player', R).cost).toBe(163);
    expect(respecCost(foughtOf('C'), 9, 'player', R).cost).toBe(567);
    expect(respecCost(foughtOf('C'), 10, 'player', R).cost).toBe(625);
  });

  test('is free before first fight, in GM mode, and when RULES.respecPrices is 0', () => {
    for (const rank of RANKS) {
      expect(respecCost(freshOf(rank), 12, 'player', R)).toEqual({ count: 12, cost: 0, freeWhy: 'before-first-fight' });
      expect(respecCost(foughtOf(rank), 12, 'gm', R)).toEqual({ count: 12, cost: 0, freeWhy: 'gm' });
      expect(respecCost(foughtOf(rank), 12, 'player', { ...R, respecPrices: 0 })).toEqual({ count: 12, cost: 0, freeWhy: 'rules' });
    }
    expect(respecCost(foughtOf('E'), 0, 'player', R)).toEqual({ count: 0, cost: 0, freeWhy: null });
  });

  test('follows overrides to respecPrices and priceBase', () => {
    const custom = { ...R, respecPrices: 1, priceBase: { ...R.priceBase, E: 200 } };
    expect(respecCost(foughtOf('E'), 1, 'player', custom).cost).toBe(20);
    expect(respecCost(foughtOf('E'), 10, 'player', custom).cost).toBe(200);
  });
});

describe('confirmPoints: atomic step, guards, debt isolation, and room wire', () => {
  test('plain positive allocation confirms unguarded even when dead, held, or broke', () => {
    const s = makeSave(h => ok(raise({ ...h, life: { at: 'dead' }, gold: 0 }, 'str', 'player', R)));
    const r = ok(confirmPoints(s, s.hunters[0]!.id, baseCtx({ held: true })));
    expect([r.count, r.cost, r.returned]).toEqual([0, 0, 0]);
    expect(r.save.hunters[0]!.stats.str).toBe(11);
    expect(r.save.hunters[0]!.spent).toEqual({ str: 1 });
    expect(r.save.hunters[0]!.pending).toEqual({});
  });

  test('refuses no-hunter, dead, held, and insufficient carried gold without mutating save or borrowing debt', () => {
    const s0 = spentHunter({ vit: 8, str: 4 }, { gold: 40 });
    const hid = s0.hunters[0]!.id;
    const foughtStaged = { ...s0, hunters: [ok(takeAll(fought(s0.hunters[0]!)))] };

    expect(confirmPoints(foughtStaged, 'h999', baseCtx())).toEqual({ ok: false, why: 'no-hunter' });
    expect(confirmPoints(foughtStaged, hid, baseCtx({ held: true }))).toEqual({ ok: false, why: 'held' });
    expect(confirmPoints({ ...foughtStaged, hunters: [{ ...foughtStaged.hunters[0]!, life: { at: 'dead' } }] }, hid, baseCtx())).toEqual({ ok: false, why: 'dead' });
    // Full E-rank reset costs 50 gold, hunter carries 40: refuses gold and never touches debt.
    expect(confirmPoints(foughtStaged, hid, baseCtx())).toEqual({ ok: false, why: 'gold' });
    expect(foughtStaged.hunters[0]!.debt).toBe(0);
    expect(foughtStaged.hunters[0]!.gold).toBe(40);
  });

  test('pays carried gold once on Confirm, fits HP/mana/fatigue down, and logs locally when solo', () => {
    const s0 = spentHunter({ vit: 8, str: 4 }, { gold: 120 });
    const h0 = fought(s0.hunters[0]!);
    const maxHpBefore = hunterSheet(h0, R).sheet.hpMax;
    const staged = ok(takeAll(h0));
    expect(available(staged, R), 'staged take-back is not free before Confirm').toBe(0);

    const res = ok(confirmPoints({ ...s0, hunters: [staged] }, h0.id, baseCtx()));
    expect([res.count, res.cost, res.returned]).toEqual([12, 50, 12]);
    const h1 = res.save.hunters[0]!;
    expect(h1.gold).toBe(70);
    expect(h1.debt).toBe(0);
    expect(h1.spent).toEqual({});
    expect(h1.pending).toEqual({});
    expect(available(h1, R)).toBe(12);
    const maxHpAfter = hunterSheet(h1, R).sheet.hpMax;
    expect(maxHpAfter).toBeLessThan(maxHpBefore);
    expect(hpOf(h1.life, maxHpAfter)).toBe(maxHpAfter);
    expect(res.save.log[0]).toMatchObject({ title: 'Points reset', text: `${h0.name} took back 12 points for 50 gold.` });
    expect(res.save.settings.sync.outbox ?? []).toEqual([]);
  });

  test('before first fight is free even with 0 gold', () => {
    const s0 = spentHunter({ str: 6, agi: 6 }, { gold: 0 });
    const h0 = s0.hunters[0]!;
    const staged = ok(lower(ok(lower(h0, 'str', 'player')), 'str', 'player'));
    const res = ok(confirmPoints({ ...s0, hunters: [staged] }, h0.id, baseCtx()));
    expect([res.count, res.cost, res.returned]).toEqual([2, 0, 2]);
    expect(res.save.hunters[0]!.gold).toBe(0);
    expect(res.save.hunters[0]!.spent).toEqual({ str: 4, agi: 6 });
  });

  test('overspent hunter after losing levels reports only net newly available points in returned', () => {
    // Level 3 holds 12 + 6 = 18 points. Spend all 18, drop to level 1 (holds 12, overspent by 6).
    // Taking back 8 points frees only 2 (6 absorbed by point debt).
    const s0 = makeSave(h => {
      const lv3 = { ...h, ...setLevel(h, 3, 0, R).progress, gold: 200 };
      const full = confirm(ok(raiseMany(lv3, { str: 10, agi: 8 }, R)));
      const dropped = { ...full, ...setLevel(full, 1, 0, R).progress };
      return ok(lower(ok(lower(ok(lower(ok(lower(ok(lower(ok(lower(ok(lower(ok(lower(fought(dropped), 'agi', 'player')), 'agi', 'player')), 'agi', 'player')), 'agi', 'player')), 'agi', 'player')), 'agi', 'player')), 'agi', 'player')), 'agi', 'player'));
    });
    const res = ok(confirmPoints(s0, s0.hunters[0]!.id, baseCtx()));
    expect(res.count).toBe(8);
    expect(res.returned).toBe(2);
    expect(available(res.save.hunters[0]!, R)).toBe(2);
  });

  test('GM setStat below 10 + spent never mints free points on takeAll + confirmPoints', () => {
    const s0 = spentHunter({ str: 5, agi: 7 }, { gold: 200 });
    const h0 = fought(setStat(s0.hunters[0]!, 'str', 3));
    const staged = ok(takeAll(h0));
    // str undoable = min(5, 3 - 1) = 2; agi undoable = 7 -> total 9.
    const res = ok(confirmPoints({ ...s0, hunters: [staged] }, h0.id, baseCtx()));
    expect(res.count).toBe(9);
    expect(res.returned).toBe(9);
    expect(spentTotal(res.save.hunters[0]!)).toBe(3);
    expect(available(res.save.hunters[0]!, R)).toBe(9);
  });

  test('GM local hunter is free, writes to local log, posts no room event, and still refuses held in a fight', () => {
    const s0 = spentHunter({ vit: 8, str: 4 }, { gold: 0 });
    const h0 = fought(s0.hunters[0]!);
    const staged = { ...s0, hunters: [ok(takeAll(h0))] };
    const code = room('ABCDEF');
    const stamp = { device: 'd-p1', now: Date.parse(AT), rand: 0.25 };
    expect(confirmPoints(staged, h0.id, baseCtx({ role: 'gm', held: true, room: code, stamp }))).toEqual({ ok: false, why: 'held' });
    const res = ok(confirmPoints(staged, h0.id, baseCtx({ role: 'gm', room: code, stamp })));
    expect([res.count, res.cost, res.returned]).toEqual([12, 0, 12]);
    expect(res.save.settings.sync.outbox ?? []).toEqual([]);
    expect(res.save.log[0]).toMatchObject({ title: 'Points reset', text: `${h0.name} took back 12 points for free.` });
  });

  test('room player posts one sealed respec event per Confirm using stamp, and rapid confirms get distinct eids', () => {
    const s0 = spentHunter({ str: 4, agi: 4 }, { gold: 100 });
    const h0 = fought(s0.hunters[0]!);
    const code = room('ABCDEF');
    const st1 = { device: 'd-p1', now: Date.parse(AT), rand: 0.25 };
    const st2 = { device: 'd-p1', now: Date.parse(AT) + 1, rand: 0.25 };

    const r1 = ok(confirmPoints({ ...s0, hunters: [ok(lower(h0, 'str', 'player'))] }, h0.id, baseCtx({ room: code, stamp: st1 })));
    const r2 = ok(confirmPoints({ ...r1.save, hunters: [ok(lower(r1.save.hunters[0]!, 'str', 'player'))] }, h0.id, baseCtx({ room: code, stamp: st2 })));
    const box = r2.save.settings.sync.outbox ?? [];
    expect(box).toHaveLength(2);
    const ev1 = box[0]!.letter.kind === 'event' ? box[0]!.letter.event : null;
    const ev2 = box[1]!.letter.kind === 'event' ? box[1]!.letter.event : null;
    expect(ev1?.type).toBe('respec');
    expect(ev2?.type).toBe('respec');
    expect(ev1?.payload.eid).not.toBe(ev2?.payload.eid);
    expect(ev1?.payload).toMatchObject({ name: h0.name, count: 1, cost: 5 });
    expect(isSealed(ev1!)).toBe(true);
    const viewers: RoomViewer[] = [{ kind: 'gm' }, { kind: 'phone', device: dev('d-p1') }, { kind: 'phone', device: dev('d-other') }, { kind: 'anyone' }];
    expect(viewers.map(v => servedTo(ev1!, v))).toEqual([true, true, false, false]);
  });
});

describe('respec copy and Variant 1 warning contract', () => {
  test('confirmCostLine, respecRefusalWords, respecSaid, and respecToast follow voice rules and exact numbers', () => {
    expect(confirmCostLine({ count: 0, cost: 0, freeWhy: null }, 0)).toBe('');
    expect(confirmCostLine({ count: 2, cost: 0, freeWhy: 'before-first-fight' }, 0)).toBe('Taking back 2 points. Free before your first fight. Tap Confirm allocation to apply.');
    expect(confirmCostLine({ count: 1, cost: 0, freeWhy: 'gm' }, 0)).toBe('Taking back 1 point. Free in GM mode. Tap Confirm allocation to apply.');
    expect(confirmCostLine({ count: 3, cost: 0, freeWhy: 'rules' }, 0)).toBe('Taking back 3 points. Free under current rules. Tap Confirm allocation to apply.');
    expect(confirmCostLine({ count: 4, cost: 200, freeWhy: null }, 150)).toBe('Taking back 4 points. Respec costs 200 gold. You have 150.');
    expect(confirmCostLine({ count: 4, cost: 200, freeWhy: null }, 250)).toBe('Taking back 4 points costs 200 gold. Tap Confirm allocation to pay.');
    expect(respecRefusalWords(200, 150).gold).toBe('Respec costs 200 gold. You have 150.');
    expect(respecSaid('Mira', 4, 20).text).toBe('Mira took back 4 points for 20 gold.');
    expect(respecSaid('Mira', 1, 0).text).toBe('Mira took back 1 point for free.');
    expect(respecToast(2, 4, 20)).toBe('Took back 4 points for 20 gold (2 available).');
    expect(respecToast(4, 4, 0)).toBe('Took back 4 points.');
  });

  test('paid respec warning window has zero Variant 1 faults', () => {
    const faults = warningFaults({
      tag: RESPEC_WORDS.warnTag,
      title: RESPEC_WORDS.warnTitle,
      body: RESPEC_WORDS.warnBody(4, 20, 100),
      actions: [
        { label: RESPEC_WORDS.payAction(20), value: true, primary: true },
        { label: 'Cancel', value: false, cancel: true },
      ],
    });
    expect(faults).toEqual([]);
  });
});
