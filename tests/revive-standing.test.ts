// The revive ladder as a machine (src/core/hunter/revive-standing.ts). World rule 6: "the first revive is free; after
// that, one revive on debt; after that none, unless the GM grants one or the hunter uses a revive item bought before
// death." The owner, Nov 22: the free revive and the revive on debt are a "System raise". Every expected standing is read
// from those words: a raise from free leaves the one on debt, a raise on debt leaves none, and none is raised no more.
import { describe, expect, test } from 'bun:test';
import { DEBT_EVENT_TYPES, DEBT_STATES, REVIVE_STANDINGS, STANDING_EVENT_TYPES, canRaise, debtChip, debtLine, debtPaidLine, debtPaidLog, debtPreviewLine, debtState, debtStep, paysDebt, raiseLine, raiseOffer, raisedSaid, standingStep } from '../src/core/hunter/revive-standing.ts';
import type { DebtEvent, DebtEventType, DebtState, ReviveStanding, StandingEventType } from '../src/core/hunter/revive-standing.ts';
import { grant, raisedLine, sheetEdit, systemRaise } from '../src/core/hunter/grant.ts';
import { putItem, sell } from '../src/core/hunter/inventory.ts';
import { received } from '../src/core/trade/goods.ts';
import { REWARD_FROM } from '../src/core/protocol.ts';
import { newRewards } from '../src/core/rewards.ts';
import { parseItem } from '../src/core/registry/items.ts';
import { REVIVE_HP } from '../src/core/hunter/vitals.ts';
import { gmSource } from '../src/core/effects.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import { RULES, clearOf } from '../src/core/rules.ts';
import type { Rank } from '../src/core/rules.ts';
import { freshSave, newHunter } from '../src/core/save.ts';
import type { Hunter, ParseEnv, Save } from '../src/core/save.ts';
import type { RoomCode } from '../src/core/protocol.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { day, dev, hid, iid, room } from './fixtures/ids.ts';

describe('the revive ladder, as a machine: every standing against every event', () => {
  const EXPECTED: Record<ReviveStanding, Record<StandingEventType, ReviveStanding | 'spent'>> = {
    free: { raise: 'debt' },
    debt: { raise: 'none' },
    none: { raise: 'spent' },
  };
  for (const s of REVIVE_STANDINGS) {
    for (const type of STANDING_EVENT_TYPES) {
      test(`${s} + ${type} -> ${EXPECTED[s][type]}`, () => {
        const to = standingStep(s, { type });
        expect(isRefused(to) ? to.why : to).toBe(EXPECTED[s][type]);
      });
    }
  }

  test('the System raises while a free raise or the one on debt is left, never after both are spent', () => {
    expect(REVIVE_STANDINGS.map(s => [s, canRaise(s)])).toEqual([['free', true], ['debt', true], ['none', false]]);
  });

  test('a new hunter has its free raise left, and two raises spend the ladder', () => {
    let s: ReviveStanding = newHunter().reviveLeft;
    expect(s).toBe('free');
    for (const want of ['debt', 'none'] as const) {
      const to = standingStep(s, { type: 'raise' });
      if (isRefused(to)) throw new Error(`refused: ${to.why}`);
      expect(to).toBe(want);
      s = to;
    }
    expect(canRaise(s)).toBe(false);
  });
});

// The System raise (grant.ts `systemRaise`). The debt is economy.md section 13's "ten Clears of their rank", one Clear
// the middle of the rank's loot gold (section 1: an E Clear is 100), so an E hunter owes 1,000 and a C hunter 12,500,
// the price of a crystal of the rank in section 13's table.
describe('the System raise: the life, the standing and the debt in one write', () => {
  const AT = '2026-11-22T12:00:00.000Z', ROOM = room('ABC234');
  const ENV: ParseEnv = { now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-player1') };
  const H = hid('h1');
  const ok = <T>(r: T | Refused): T => { if (isRefused(r)) throw new Error(`refused: ${r.why}`); return r as T; };
  /** A save of one hunter (h1) of `rank`, dead and burning, at level 31 with its revive standing at `left`. */
  function deadSave(left: ReviveStanding = 'free', rank: Rank = 'E'): Save {
    const s = freshSave(ENV, { onboarded: true });
    const burning = { key: statusKey('burning'), def: RULES.conditions.burning!, rounds: 3, source: gmSource(rank) };
    return { ...s, hunters: [{ ...s.hunters[0]!, id: H, rank, rankBy: 'gm', level: 31, peakLevel: 31, life: { at: 'dead' }, reviveLeft: left, conditions: [burning] }] };
  }
  const raise = (s: Save, room: RoomCode | null = null, held = false) => systemRaise(s, H, { at: AT, room, R: RULES, held });
  const hunterOf = (s: Save): Hunter => s.hunters[0]!;
  const die = (s: Save): Save => ({ ...s, hunters: s.hunters.map(h => ({ ...h, life: { at: 'dead' as const } })) });

  test('the first raise is free: up at the revive HP, every status off, its levels lost, the raise on debt left', () => {
    const r = ok(raise(deadSave()));
    const h = hunterOf(r.save);
    expect([h.life, h.conditions, h.reviveLeft, h.debt]).toEqual([{ at: 'up', hp: REVIVE_HP }, [], 'debt', 0]);
    // ruling 9: a raising takes a thirtieth of the level, rounded up: 31 / 30 is 1.03, so two levels
    expect([r.raise, r.owes, r.from, r.to]).toEqual(['free', 0, 31, 29]);
    expect(raisedLine(r.from, r.to)).toBe(`Revived at ${REVIVE_HP} HP and level 29 (2 levels lost)`);
  });

  test('the second raise owes ten Clears of the hunter\'s rank and leaves no System raise', () => {
    const second = ok(raise(die(ok(raise(deadSave())).save)));
    expect([hunterOf(second.save).reviveLeft, hunterOf(second.save).debt, second.raise, second.owes]).toEqual(['none', 1000, 'debt', 1000]);
    expect(RULES.reviveDebtClears * clearOf(RULES, 'E'), 'the rule: ten E Clears of 100').toBe(1000);
    expect(ok(raise(deadSave('debt', 'C'))).owes, 'a C hunter: ten C Clears of 1,250').toBe(12500);
    expect(ok(raise(deadSave('debt'))).save.hunters[0]!.life, 'raised all the same').toEqual({ at: 'up', hp: REVIVE_HP });
  });

  test('past the ladder the System raises no more: refused, so the save stays as it was', () => {
    expect(raise(deadSave('none'))).toEqual({ ok: false, why: 'spent' });
  });

  test('a hunter who is up is not raised, nor one this save does not hold', () => {
    const s = deadSave(), up = { ...s, hunters: [{ ...hunterOf(s), life: { at: 'up' as const, hp: 5 } }] };
    expect(raise(up)).toEqual({ ok: false, why: 'cannot' });
    expect(systemRaise(s, 'h9', { at: AT, room: null, R: RULES, held: false })).toEqual({ ok: false, why: 'no-hunter' });
  });

  // section 21: the System's raise is offered only once no fight holds the hunter; a fight's dead row is the GM's to revive
  test('while a fight holds the hunter the System does not raise it: refused held, in a room or alone, and the save stays as it was', () => {
    const TABLE: readonly (readonly [ReviveStanding, 'dead' | 'up', string])[] = [
      ['free', 'dead', 'held'],
      ['debt', 'dead', 'held'],
      ['none', 'dead', 'spent'],
      ['free', 'up', 'cannot'],
    ];
    for (const [left, life, why] of TABLE) {
      const s = deadSave(left), at = life === 'up' ? { ...s, hunters: [{ ...hunterOf(s), life: { at: 'up' as const, hp: 5 } }] } : s;
      expect(raise(at, null, true), `${left}, ${life}`).toEqual({ ok: false, why });
      expect(raise(at, ROOM, true), `${left}, ${life}, in a room`).toEqual({ ok: false, why });
    }
  });

  test('the GM\'s Revive and a Resurrection Crystal raise the hunter and leave the System\'s raises as they were', () => {
    const dead = hunterOf(deadSave('debt'));
    const gm = ok(sheetEdit(dead, { type: 'life', event: { type: 'revive' } }, RULES));
    const crystal = ok(sheetEdit(dead, { type: 'life', event: { type: 'revive' }, by: 'item' }, RULES));
    expect([gm.life.at, gm.reviveLeft, gm.debt, crystal.life.at, crystal.reviveLeft, crystal.debt]).toEqual(['up', 'debt', 0, 'up', 'debt', 0]);
  });

  test('the Chronicle says the System raised the hunter', () => {
    const h = hunterOf(ok(raise(deadSave())).save);
    expect([...h.chronicle.inbox, ...h.chronicle.facts].filter(f => f.kind === 'life').map(f => (f.kind === 'life' ? [f.news, f.how] : null))).toEqual([['raised', 'system']]);
  });

  test('in a room the GM hears the raise in the same write, once, by the hunter\'s own phone; alone nothing is posted', () => {
    const r = ok(raise(deadSave('debt'), ROOM));
    const box = r.save.settings.sync.outbox ?? [];
    expect(box).toHaveLength(1);
    const letter = box[0]!.letter as { kind: 'event'; event: { type: string; payload: Record<string, unknown> } };
    expect(letter.event.type).toBe('systemRaise');
    expect(letter.event.payload).toMatchObject({ by: 'd-player1:h1', name: hunterOf(deadSave()).name, raise: 'debt', owes: 1000 });
    expect(ok(raise(deadSave())).save.settings.sync.outbox ?? []).toEqual([]);
  });
});

describe('what the System says of its raise', () => {
  const at = (reviveLeft: ReviveStanding, rank: Rank = 'E', level = 31) => ({ reviveLeft, rank, level });

  test('the free raise costs nothing and says where the hunter rises; the raise on debt names its gold and Clears on its button', () => {
    // ruling 9: a thirtieth of level 31, rounded up, is 2 levels
    expect(raiseOffer(at('free'), RULES)).toEqual({
      body: 'You have died. The System can revive you once for free.',
      lines: ['Cost: Free (one-time free revive).', `You revive at ${REVIVE_HP} HP and level 29 (2 levels lost), with all statuses cleared.`],
      rise: 'Revive for free',
    });
    const debt = raiseOffer(at('debt', 'C', 1), RULES)!;
    expect(debt.lines).toEqual(['Cost: 12,500 gold debt (10 rank C gate clears).', `You revive at ${REVIVE_HP} HP, with all statuses cleared.`, 'After this, only a Resurrection Crystal or the GM can revive you.']);
    expect(debt.rise).toBe('Revive on debt (12,500 gold)');
    expect(raiseOffer(at('none'), RULES)).toBeNull();
  });

  test('the sheet says what is left, and that a fight holding the hunter ends first', () => {
    expect(raiseLine(at('free'), RULES, false)).toBe('The System can revive you once for free.');
    expect(raiseLine(at('debt'), RULES, true)).toBe('Once the fight ends, the System can revive you once more for 1,000 gold debt.');
    expect(raiseLine(at('none'), RULES, false)).toBe('You have used all your System revives.');
  });

  test('the GM\'s log and the bag say who was raised and what is owed', () => {
    expect(raisedSaid('Mira', 'debt', 1000)).toEqual({ title: 'System revive: Mira', text: 'The System revived Mira for 1,000 gold debt. No System revives left.' });
    expect([debtLine(0), debtLine(1000)]).toEqual([null, 'Debt owed to the System for reviving: 1,000 gold.']);
    expect([debtPaidLine(0, 0), debtPaidLine(50, 950), debtPaidLine(30, 0)]).toEqual([
      null,
      '50 gold went to System revive debt (950 gold left).',
      '30 gold paid off System revive debt.',
    ]);
    expect([debtPreviewLine(0, 0), debtPreviewLine(50, 950), debtPreviewLine(30, 0)]).toEqual([
      null,
      '50 gold goes to System revive debt (950 gold left).',
      '30 gold pays off System revive debt.',
    ]);
    expect([debtChip(0), debtChip(950)]).toEqual([null, 'System debt: 950 gold']);
    expect(debtPaidLog('Mira', 0, 0)).toBeNull();
    expect(debtPaidLog('Mira', 50, 950)).toEqual({ kind: 'award', hunterId: null, title: 'Debt payment: Mira', text: 'Mira paid 50 gold toward System revive debt (950 gold left).' });
    expect(debtPaidLog('Mira', 30, 0)).toEqual({ kind: 'award', hunterId: null, title: 'Debt payment: Mira', text: 'Mira paid 30 gold and cleared their System revive debt.' });
  });
});

describe('the revive debt machine: every state against every event, rounding, bounds, and eligible sources', () => {
  const START: { readonly [S in DebtState]: number } = { clear: 0, owing: 100 };
  const EVENTS: { readonly [E in DebtEventType]: Extract<DebtEvent, { type: E }> } = {
    incur: { type: 'incur', amount: 250 },
    clearGold: { type: 'clearGold', gold: 80 },
  };
  const EXPECTED: { readonly [S in DebtState]: { readonly [E in DebtEventType]: { debt: number; paid: number; kept: number; state: DebtState } } } = {
    clear: {
      incur: { debt: 250, paid: 0, kept: 0, state: 'owing' },
      clearGold: { debt: 0, paid: 0, kept: 80, state: 'clear' },
    },
    owing: {
      incur: { debt: 350, paid: 0, kept: 0, state: 'owing' },
      clearGold: { debt: 60, paid: 40, kept: 40, state: 'owing' },
    },
  };
  for (const s of DEBT_STATES) {
    for (const e of DEBT_EVENT_TYPES) {
      test(`${s} + ${e} -> ${EXPECTED[s][e].state}`, () => {
        const res = debtStep(START[s], EVENTS[e], RULES);
        expect({ ...res, state: debtState(res.debt) }).toEqual(EXPECTED[s][e]);
      });
    }
  }

  test('Math.round rounding, 0% and 100% shares, overpayment clamping, 0 debt, and negative gold', () => {
    expect(debtStep(1000, { type: 'clearGold', gold: 101 }, RULES), 'half of 101 rounds up to 51').toEqual({ debt: 949, paid: 51, kept: 50 });
    expect(debtStep(1000, { type: 'clearGold', gold: 1 }, RULES), 'half of 1 rounds up to 1').toEqual({ debt: 999, paid: 1, kept: 0 });
    expect(debtStep(1000, { type: 'clearGold', gold: 1 }, { reviveDebtShare: 0.25 }), 'quarter of 1 rounds down to 0').toEqual({ debt: 1000, paid: 0, kept: 1 });
    expect(debtStep(1000, { type: 'clearGold', gold: 100 }, { reviveDebtShare: 0 }), '0% share takes nothing').toEqual({ debt: 1000, paid: 0, kept: 100 });
    expect(debtStep(1000, { type: 'clearGold', gold: 100 }, { reviveDebtShare: 1 }), '100% share takes all gold').toEqual({ debt: 900, paid: 100, kept: 0 });
    expect(debtStep(30, { type: 'clearGold', gold: 100 }, RULES), 'never takes more than remaining debt; excess stays with hunter').toEqual({ debt: 0, paid: 30, kept: 70 });
    expect(debtStep(50, { type: 'clearGold', gold: 100 }, RULES), 'exact payoff transitions to clear').toEqual({ debt: 0, paid: 50, kept: 50 });
    expect(debtStep(1000, { type: 'clearGold', gold: -50 }, RULES), 'negative gold is untouched').toEqual({ debt: 1000, paid: 0, kept: -50 });
    expect(debtStep(0, { type: 'incur', amount: 0 }, RULES), 'incurring 0 stays clear').toEqual({ debt: 0, paid: 0, kept: 0 });
  });

  test('only gate clear and solo clear reward sources pay down debt', () => {
    expect(REWARD_FROM.map(f => [f, paysDebt(f)])).toEqual([['solo', true], ['quest', false], ['feat', false], ['clear', true]]);
    expect([paysDebt(null), paysDebt(undefined)]).toEqual([false, false]);
  });

  test('grant collects debt only on clear and solo rewards, leaves reviveLeft at none at 0 debt, and ignores quests, feats, GM gifts, trades, and shop sales', () => {
    const AT = '2026-11-23T12:00:00.000Z';
    const ENV: ParseEnv = { now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-player1') };
    const H = hid('h1'), DAY = { at: AT, today: day('2026-11-23'), R: RULES, vitals: 'sheet' as const };
    const base0 = freshSave(ENV, { onboarded: true });
    const withDebt = (debt: number, gold = 10): Save => ({
      ...base0,
      hunters: [{ ...base0.hunters[0]!, id: H, name: 'Mira', gold, debt, reviveLeft: 'none' }],
    });
    const ok = <T>(r: T | Refused): T => { if (isRefused(r)) throw new Error(`refused: ${r.why}`); return r as T; };

    // clear reward: partial payoff
    const partial = ok(grant(withDebt(100), H, { ...newRewards(), gold: 60 }, null, { ...DAY, from: 'clear' }));
    expect([partial.save.hunters[0]!.gold, partial.save.hunters[0]!.debt, partial.save.hunters[0]!.reviveLeft]).toEqual([40, 70, 'none']);
    expect(partial.debtPaid).toEqual({ paid: 30, left: 70 });
    expect(partial.lines).toEqual(['+30 gold', '30 gold went to System revive debt (70 gold left).']);
    expect(partial.save.log[0]).toMatchObject({ title: 'Debt payment: Mira', text: 'Mira paid 30 gold toward System revive debt (70 gold left).' });

    // solo clear: final payoff leaves reviveLeft at none and keeps excess gold
    const paidOff = ok(grant(withDebt(30), H, { ...newRewards(), gold: 100 }, null, { ...DAY, from: 'solo' }));
    expect([paidOff.save.hunters[0]!.gold, paidOff.save.hunters[0]!.debt, paidOff.save.hunters[0]!.reviveLeft]).toEqual([80, 0, 'none']);
    expect(paidOff.debtPaid).toEqual({ paid: 30, left: 0 });
    expect(paidOff.lines).toEqual(['+70 gold', '30 gold paid off System revive debt.']);

    // 100% share omits "+0 gold" line
    const allDebt = ok(grant(withDebt(500), H, { ...newRewards(), gold: 100 }, null, { ...DAY, R: { ...RULES, reviveDebtShare: 1 }, from: 'clear' }));
    expect([allDebt.save.hunters[0]!.gold, allDebt.save.hunters[0]!.debt]).toEqual([10, 400]);
    expect(allDebt.lines).toEqual(['100 gold went to System revive debt (400 gold left).']);

    // non-clear rewards leave debt untouched
    for (const from of ['quest', 'feat', null, undefined] as const) {
      const g = ok(grant(withDebt(100), H, { ...newRewards(), gold: 60 }, null, { ...DAY, from }));
      expect([g.save.hunters[0]!.gold, g.save.hunters[0]!.debt, g.debtPaid], `from=${String(from)}`).toEqual([70, 100, null]);
      expect(g.lines).toEqual(['+60 gold']);
    }

    // trade and shop sell leave debt untouched
    const h0 = withDebt(100).hunters[0]!;
    const traded = received(h0, { gold: 80, items: [] }, () => iid('i99'));
    expect([traded.gold, traded.debt]).toEqual([90, 100]);
    const potion = parseItem({ name: 'Health Potion', rar: 'common', type: 'consumable', value: 40 })!;
    const sold = ok(sell(putItem(h0, potion, iid('i1')), iid('i1'), 1, RULES));
    expect([sold.gold, sold.debt]).toEqual([20, 100]);
  });
});
