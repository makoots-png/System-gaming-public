// The revive ladder as a machine (src/core/hunter/revive-standing.ts). World rule 6: "the first revive is free; after
// that, one revive on debt; after that none, unless the GM grants one or the hunter uses a revive item bought before
// death." The owner, Nov 22: the free revive and the revive on debt are a "System raise". Every expected standing is read
// from those words: a raise from free leaves the one on debt, a raise on debt leaves none, and none is raised no more.
import { describe, expect, test } from 'bun:test';
import { DEBT_EVENT_TYPES, DEBT_STATES, REVIVE_STANDINGS, STANDING_EVENT_TYPES, borrowCap, canRaise, debtChip, debtLine, debtPaidLine, debtPaidLog, debtPayoffClears, debtPreviewLine, debtState, debtStep, debtTermsLine, debtXpClearedLine, debtXpLine, paysDebt, raiseLine, raiseOffer, raiseOwes, raisedSaid, rankAfterRaising, standingStep } from '../src/core/hunter/revive-standing.ts';
import type { DebtEvent, DebtEventType, DebtPaid, DebtState, DebtXpCut, ReviveStanding, StandingEventType } from '../src/core/hunter/revive-standing.ts';
import { grant, raisedLine, sheetEdit, systemRaise } from '../src/core/hunter/grant.ts';
import { buy, putItem, sell } from '../src/core/hunter/inventory.ts';
import { received } from '../src/core/trade/goods.ts';
import { REWARD_FROM } from '../src/core/protocol.ts';
import { newRewards } from '../src/core/rewards.ts';
import { parseItem } from '../src/core/registry/items.ts';
import { REVIVE_HP } from '../src/core/hunter/vitals.ts';
import { gmSource } from '../src/core/effects.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import { RANKS, RULES, priceBaseOf } from '../src/core/rules.ts';
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

// The System raise (grant.ts `systemRaise`). The debt is per-rank `RULES.reviveDebtPrices[rank]` times
// `RULES.priceBase[rank]` (E 500, D 1,625, C 6,250, B 30,000, A 133,000, S 525,000 gold; calibrated to about 5 clears
// at every rank under gold table B and the 1/2 debt split).
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

  test('the second raise owes reviveDebtPrices[rank] times the hunter\'s rank base price and leaves no System raise (loot gold edits do not move it)', () => {
    const second = ok(raise(die(ok(raise(deadSave())).save)));
    expect([hunterOf(second.save).reviveLeft, hunterOf(second.save).debt, second.raise, second.owes]).toEqual(['none', 500, 'debt', 500]);
    expect(RULES.reviveDebtPrices.E * priceBaseOf(RULES, 'E'), 'the rule: 5 times E base price 100').toBe(500);
    expect(RANKS.map(r => raiseOwes('debt', r, RULES)), 'per-rank debt gold E to S').toEqual([500, 1625, 6250, 30000, 133000, 525000]);
    expect(ok(raise(deadSave('debt', 'C'))).owes, 'a C hunter: 5 times C base price 1,250').toBe(6250);
    expect(raiseOwes('debt', 'E', { ...RULES, priceBase: RULES.priceBase }), 'decoupled from loot gold').toBe(500);
    expect(ok(raise(deadSave('debt'))).save.hunters[0]!.life, 'raised all the same').toEqual({ at: 'up', hp: REVIVE_HP });
  });

  test('systemRaise ignores borrowCapPrices and stacks revive debt onto existing shop debt', () => {
    const base = deadSave('debt', 'E');
    const withShopDebt: Save = { ...base, hunters: [{ ...hunterOf(base), debt: 150 }] };
    const r = ok(systemRaise(withShopDebt, H, { at: AT, room: null, R: { ...RULES, borrowCapPrices: 0, reviveDebtShare: 0 }, held: false }));
    expect([hunterOf(r.save).life, hunterOf(r.save).reviveLeft, hunterOf(r.save).debt, r.owes]).toEqual([{ at: 'up', hp: REVIVE_HP }, 'none', 650, 500]);
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
    expect(letter.event.payload).toMatchObject({ by: 'd-player1:h1', name: hunterOf(deadSave()).name, raise: 'debt', owes: 500 });
    expect(ok(raise(deadSave())).save.settings.sync.outbox ?? []).toEqual([]);
  });

  test('a System raise on debt bills at the rank after the raise (up.rank), matching rankAfterRaising, raiseOffer, and raiseLine across every rank, level, and rankBy', () => {
    const base = freshSave(ENV, { onboarded: true });
    const makeDead = (rank: Rank, level: number, rankBy: 'level' | 'gm'): Save => ({
      ...base,
      hunters: [{ ...base.hunters[0]!, id: H, rank, rankBy, level, peakLevel: level, life: { at: 'dead' }, reviveLeft: 'debt' }],
    });

    // All five rank-crossing boundaries for level-ranked hunters bill the dropped rank (including room outbox event).
    const BOUNDARIES: readonly (readonly [Rank, number, Rank, number, number])[] = [
      ['D', 10, 'E', 9, 500],
      ['C', 20, 'D', 19, 1625],
      ['B', 35, 'C', 33, 6250],
      ['A', 50, 'B', 48, 30000],
      ['S', 70, 'A', 67, 133000],
    ];
    for (const [fromRank, fromLv, toRank, toLv, wantOwes] of BOUNDARIES) {
      const s = makeDead(fromRank, fromLv, 'level');
      const h = hunterOf(s);
      expect(rankAfterRaising(h, RULES)).toBe(toRank);
      const offer = raiseOffer(h, RULES)!;
      expect(offer.lines[0]).toBe(`You will owe ${wantOwes.toLocaleString('en-US')} gold, about 5 rank ${toRank} gate clears to pay off.`);
      expect(offer.lines[1]).toContain(`, dropping to rank ${toRank})`);
      expect(offer.rise).toBe(`Revive on debt (${wantOwes.toLocaleString('en-US')} gold)`);
      expect(raiseLine(h, RULES, false)).toBe(`The System can revive you once more for ${wantOwes.toLocaleString('en-US')} gold debt.`);
      const r = ok(raise(s, ROOM));
      const up = hunterOf(r.save);
      expect([up.rank, up.level, up.debt, r.owes]).toEqual([toRank, toLv, wantOwes, wantOwes]);
      const letter = r.save.settings.sync.outbox![0]!.letter;
      expect(letter.kind === 'event' && letter.event.type === 'systemRaise' && letter.event.payload.owes).toBe(wantOwes);
    }

    // GM-set rank keeps its rank on level loss (SMX-rules-7.2) and bills the kept rank in preview and write alike.
    const gmSet = makeDead('B', 35, 'gm');
    const gmRaised = ok(raise(gmSet));
    expect([rankAfterRaising(hunterOf(gmSet), RULES), hunterOf(gmRaised.save).rank, gmRaised.owes]).toEqual(['B', 'B', 30000]);
    expect(raiseOffer(hunterOf(gmSet), RULES)!.lines[1]).not.toContain('dropping to rank');
    expect(raiseLine(hunterOf(gmSet), RULES, false)).toContain('30,000 gold debt');

    // Behind-level hunter (e.g. rank C at level 35 -> 33) keeps C and bills C.
    const behind = makeDead('C', 35, 'level');
    const behindRaised = ok(raise(behind));
    expect([rankAfterRaising(hunterOf(behind), RULES), hunterOf(behindRaised.save).rank, behindRaised.owes]).toEqual(['C', 'C', 6250]);

    // Exhaustive parity: every rank x every level 1..100 x both rankBy values agrees between preview and write.
    for (const rank of RANKS) {
      for (const rankBy of ['level', 'gm'] as const) {
        for (let level = 1; level <= 100; level++) {
          const s = makeDead(rank, level, rankBy);
          const h = hunterOf(s);
          const predRank = rankAfterRaising(h, RULES);
          const predOwes = raiseOwes('debt', predRank, RULES);
          const r = ok(raise(s));
          const up = hunterOf(r.save);
          expect(predRank, `${rank} lv${level} ${rankBy} rank`).toBe(up.rank);
          expect(r.owes, `${rank} lv${level} ${rankBy} owes`).toBe(predOwes);
          expect(raiseOffer(h, RULES)!.rise, `${rank} lv${level} ${rankBy} button`).toBe(`Revive on debt (${predOwes.toLocaleString('en-US')} gold)`);
          expect(raiseLine(h, RULES, false), `${rank} lv${level} ${rankBy} line`).toBe(`The System can revive you once more for ${predOwes.toLocaleString('en-US')} gold debt.`);
        }
      }
    }
  });
});

describe('what the System says of its raise', () => {
  const at = (reviveLeft: ReviveStanding, rank: Rank = 'E', level = 31) => ({ reviveLeft, rank, level });

  test('the free raise costs nothing and says where the hunter rises; the raise on debt names its gold and rough clears to pay off', () => {
    // ruling 9: a thirtieth of level 31, rounded up, is 2 levels
    expect(raiseOffer(at('free'), RULES)).toEqual({
      body: 'You have died. The System can revive you once for free.',
      lines: ['Cost: Free (one-time free revive).', `You revive at ${REVIVE_HP} HP and level 29 (2 levels lost), with all statuses cleared.`],
      rise: 'Revive for free',
    });
    const debt = raiseOffer(at('debt', 'C', 1), RULES)!;
    expect(debt.lines).toEqual([
      'You will owe 6,250 gold, about 5 rank C gate clears to pay off.',
      `You revive at ${REVIVE_HP} HP, with all statuses cleared.`,
      'After this, only a Resurrection Crystal or the GM can revive you.',
      debtTermsLine(RULES),
    ]);
    expect(debt.rise).toBe('Revive on debt (6,250 gold)');
    expect(raiseOffer(at('debt', 'E', 1), { ...RULES, reviveDebtShare: 0 })!.lines[0]).toBe('You will owe 500 gold.');
    expect(RANKS.map(r => debtPayoffClears(raiseOwes('debt', r, RULES), r, RULES)), 'every rank promises about 5 clears').toEqual([5, 5, 5, 5, 5, 5]);
    expect(debtPayoffClears(500, 'E', { ...RULES, reviveDebtShare: 0 })).toBeNull();
    expect(raiseOffer(at('none'), RULES)).toBeNull();
  });

  test('the sheet says what is left, and that a fight holding the hunter ends first', () => {
    expect(raiseLine(at('free'), RULES, false)).toBe('The System can revive you once for free.');
    expect(raiseLine(at('debt'), RULES, true)).toBe('Once the fight ends, the System can revive you once more for 500 gold debt.');
    expect(raiseLine(at('none'), RULES, false)).toBe('You have used all your System revives.');
  });

  test('the GM\'s log, popup, preview, and bag say who was raised, how gold splits, how XP is cut, and what is owed', () => {
    expect(raisedSaid('Mira', 'debt', 1000)).toEqual({ title: 'System revive: Mira', text: 'The System revived Mira for 1,000 gold debt. No System revives left.' });
    expect([debtLine(0), debtLine(1000)]).toEqual([null, 'Debt owed to the System: 1,000 gold.']);
    expect(borrowCap('C', RULES)).toBe(1875);
    expect(debtTermsLine(RULES)).toBe('While you owe debt, 50% of your gate clear gold goes to your debt, 25% is lost to debt costs, and you get 25%. You also earn 25% XP from every source until your debt is paid off.');

    const split: DebtPaid = { total: 200, paid: 100, burn: 50, kept: 50, left: 850 };
    const paidOff: DebtPaid = { total: 200, paid: 40, burn: 20, kept: 140, left: 0 };
    const noBurn: DebtPaid = { total: 200, paid: 100, burn: 0, kept: 100, left: 850 };
    const nonePaid: DebtPaid = { total: 200, paid: 0, burn: 0, kept: 200, left: 0 };
    const xpCut: DebtXpCut = { base: 48, xp: 12, rate: 0.25, left: 850 };

    expect(debtPaidLine(nonePaid)).toBeNull();
    expect(debtPaidLine(split)).toBe('Gate clear: 200 gold. 100 went to your System debt, you got 50, and 50 was lost to debt costs. You owe 850 more.');
    expect(debtPaidLine(paidOff)).toBe('Gate clear: 200 gold. 40 went to your System debt, you got 140, and 20 was lost to debt costs. You paid off your System debt.');
    expect(debtPaidLine(noBurn)).toBe('Gate clear: 200 gold. 100 went to your System debt, and you got 100. You owe 850 more.');

    expect(debtXpLine(xpCut)).toBe('XP is reduced to 25% while you owe 850 gold: +12 XP (from 48 XP).');
    expect(debtXpClearedLine(100)).toBe('+100 XP (you paid off your System debt, so you got full XP).');

    expect(debtPreviewLine(nonePaid, null)).toBeNull();
    expect(debtPreviewLine(split, xpCut)).toBe('Gate clear: 200 gold. 100 goes to System debt, hunter gets 50, and 50 is lost to debt costs. 850 gold left. XP reduced to 25% while owing 850 gold: +12 XP (from 48 XP).');
    expect(debtPreviewLine(paidOff, null)).toBe('Gate clear: 200 gold. 40 goes to System debt, hunter gets 140, and 20 is lost to debt costs. Debt paid off.');

    expect([debtChip(0), debtChip(950)]).toEqual([null, 'System debt: 950 gold']);

    expect(debtPaidLog('Mira', nonePaid, null)).toBeNull();
    expect(debtPaidLog('Mira', split, xpCut)).toEqual({
      kind: 'award',
      hunterId: null,
      title: 'Debt payment: Mira',
      text: 'Mira cleared a gate for 200 gold: 100 went to System debt, Mira got 50, and 50 was lost to debt costs. Mira owes 850 more. XP was reduced to 25%: +12 XP (from 48 XP).',
    });
    expect(debtPaidLog('Mira', paidOff, null, 100)).toEqual({
      kind: 'award',
      hunterId: null,
      title: 'Debt payment: Mira',
      text: 'Mira cleared a gate for 200 gold: 40 went to System debt, Mira got 140, and 20 was lost to debt costs. Mira paid off their System debt. Full XP applied: +100 XP.',
    });
    expect(debtPaidLog('Mira', null, xpCut)).toEqual({
      kind: 'award',
      hunterId: null,
      title: 'Debt XP cut: Mira',
      text: 'Mira got +12 XP (reduced to 25% from 48 XP while owing 850 gold to the System).',
    });
  });
});

describe('the revive debt machine: every state against every event, three-way split, XP cut, rounding, and bounds', () => {
  const START: { readonly [S in DebtState]: number } = { clear: 0, owing: 100 };
  const EVENTS: { readonly [E in DebtEventType]: Extract<DebtEvent, { type: E }> } = {
    incur: { type: 'incur', amount: 250 },
    clearGold: { type: 'clearGold', gold: 80 },
    xp: { type: 'xp', xp: 40 },
  };
  const EXPECTED: { readonly [S in DebtState]: { readonly [E in DebtEventType]: { debt: number; paid: number; burn: number; kept: number; xp: number; state: DebtState } } } = {
    clear: {
      incur: { debt: 250, paid: 0, burn: 0, kept: 0, xp: 0, state: 'owing' },
      clearGold: { debt: 0, paid: 0, burn: 0, kept: 80, xp: 0, state: 'clear' },
      xp: { debt: 0, paid: 0, burn: 0, kept: 0, xp: 40, state: 'clear' },
    },
    owing: {
      incur: { debt: 350, paid: 0, burn: 0, kept: 0, xp: 0, state: 'owing' },
      clearGold: { debt: 60, paid: 40, burn: 20, kept: 20, xp: 0, state: 'owing' },
      xp: { debt: 100, paid: 0, burn: 0, kept: 0, xp: 10, state: 'owing' },
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

  test('three-way split, Math.round rounding, proportional burn on final payoff, edge shares, and XP scaling', () => {
    expect(debtStep(950, { type: 'clearGold', gold: 200 }, RULES), 'the owner example: 100 debt, 50 kept, 50 lost').toEqual({ debt: 850, paid: 100, burn: 50, kept: 50, xp: 0 });
    expect(debtStep(1000, { type: 'clearGold', gold: 101 }, RULES), '101 gold: 51 debt, 25 burn, 25 kept').toEqual({ debt: 949, paid: 51, burn: 25, kept: 25, xp: 0 });
    expect(debtStep(1000, { type: 'clearGold', gold: 1 }, RULES), '1 gold: 1 debt, 0 burn, 0 kept').toEqual({ debt: 999, paid: 1, burn: 0, kept: 0, xp: 0 });
    expect(debtStep(1000, { type: 'clearGold', gold: 3 }, RULES), '3 gold: 2 debt, 1 burn, 0 kept').toEqual({ debt: 998, paid: 2, burn: 1, kept: 0, xp: 0 });
    expect(debtStep(40, { type: 'clearGold', gold: 200 }, RULES), 'final payoff: burn applies in proportion to debt paid (20), rest (140) goes to hunter').toEqual({ debt: 0, paid: 40, burn: 20, kept: 140, xp: 0 });
    expect(debtStep(100, { type: 'clearGold', gold: 200 }, RULES), 'exact payoff transitions to clear with full burn').toEqual({ debt: 0, paid: 100, burn: 50, kept: 50, xp: 0 });
    expect(debtStep(1000, { type: 'clearGold', gold: 100 }, { reviveDebtShare: 0, reviveDebtBurn: 0, reviveDebtXpRate: 0.25 }), '0% share and 0% burn takes nothing').toEqual({ debt: 1000, paid: 0, burn: 0, kept: 100, xp: 0 });
    expect(debtStep(1000, { type: 'clearGold', gold: 100 }, { reviveDebtShare: 0, reviveDebtBurn: 0.25, reviveDebtXpRate: 0.25 }), '0% share with 25% burn burns 25 and leaves debt').toEqual({ debt: 1000, paid: 0, burn: 25, kept: 75, xp: 0 });
    expect(debtStep(1000, { type: 'clearGold', gold: 100 }, { reviveDebtShare: 1, reviveDebtBurn: 0, reviveDebtXpRate: 0.25 }), '100% share with 0% burn takes all gold to debt').toEqual({ debt: 900, paid: 100, burn: 0, kept: 0, xp: 0 });
    expect(debtStep(1000, { type: 'clearGold', gold: 100 }, { reviveDebtShare: 0.8, reviveDebtBurn: 0.5, reviveDebtXpRate: 0.25 }), 'defense in depth clamps burn to 1 - share').toEqual({ debt: 920, paid: 80, burn: 20, kept: 0, xp: 0 });
    expect(debtStep(1000, { type: 'clearGold', gold: -50 }, RULES), 'negative gold is untouched').toEqual({ debt: 1000, paid: 0, burn: 0, kept: -50, xp: 0 });
    expect(debtStep(0, { type: 'incur', amount: 0 }, RULES), 'incurring 0 stays clear').toEqual({ debt: 0, paid: 0, burn: 0, kept: 0, xp: 0 });
    expect(debtStep(500, { type: 'xp', xp: 50 }, RULES), '50 * 0.25 = 12.5 rounds to 13').toEqual({ debt: 500, paid: 0, burn: 0, kept: 0, xp: 13 });
    expect(debtStep(500, { type: 'xp', xp: 1 }, RULES), '1 * 0.25 rounds to 0').toEqual({ debt: 500, paid: 0, burn: 0, kept: 0, xp: 0 });
    expect(debtStep(500, { type: 'xp', xp: -20 }, RULES), 'negative XP is untouched').toEqual({ debt: 500, paid: 0, burn: 0, kept: 0, xp: -20 });
  });

  test('only gate clear and solo clear reward sources pay down debt', () => {
    expect(REWARD_FROM.map(f => [f, paysDebt(f)])).toEqual([['solo', true], ['quest', false], ['feat', false], ['clear', true]]);
    expect([paysDebt(null), paysDebt(undefined)]).toEqual([false, false]);
  });

  test('grant applies three-way clear gold split, cuts XP from every source while owing, gives full XP on the payoff clear, and handles level-ups near the threshold', () => {
    const AT = '2026-11-23T12:00:00.000Z';
    const ENV: ParseEnv = { now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-player1') };
    const H = hid('h1'), DAY = { at: AT, today: day('2026-11-23'), R: RULES, vitals: 'sheet' as const };
    const base0 = freshSave(ENV, { onboarded: true });
    const withDebt = (debt: number, gold = 10, xp = 0): Save => ({
      ...base0,
      hunters: [{ ...base0.hunters[0]!, id: H, name: 'Mira', gold, xp, level: 1, peakLevel: 1, debt, reviveLeft: 'none' }],
    });
    const ok = <T>(r: T | Refused): T => { if (isRefused(r)) throw new Error(`refused: ${r.why}`); return r as T; };

    // clear reward: 3-way gold split (200 -> 100 debt, 50 kept, 50 lost) and 0.25x XP (48 -> 12)
    const partial = ok(grant(withDebt(950), H, { ...newRewards(), gold: 200, xp: 48 }, null, { ...DAY, from: 'clear' }));
    expect([partial.save.hunters[0]!.gold, partial.save.hunters[0]!.xp, partial.save.hunters[0]!.debt, partial.save.hunters[0]!.reviveLeft]).toEqual([60, 12, 850, 'none']);
    expect(partial.debtPaid).toEqual({ total: 200, paid: 100, burn: 50, kept: 50, left: 850 });
    expect(partial.debtXp).toEqual({ base: 48, xp: 12, rate: 0.25, left: 850 });
    expect(partial.lines).toEqual([
      'XP is reduced to 25% while you owe 850 gold: +12 XP (from 48 XP).',
      'Gate clear: 200 gold. 100 went to your System debt, you got 50, and 50 was lost to debt costs. You owe 850 more.',
    ]);
    expect(partial.save.log[0]).toMatchObject({
      title: 'Debt payment: Mira',
      text: 'Mira cleared a gate for 200 gold: 100 went to System debt, Mira got 50, and 50 was lost to debt costs. Mira owes 850 more. XP was reduced to 25%: +12 XP (from 48 XP).',
    });

    // solo clear: final payoff (debt 40 on 200 gold -> 40 debt, 20 proportional burn, 140 kept) finishes debt first, so full XP applies
    const paidOff = ok(grant(withDebt(40), H, { ...newRewards(), gold: 200, xp: 60 }, null, { ...DAY, from: 'solo' }));
    expect([paidOff.save.hunters[0]!.gold, paidOff.save.hunters[0]!.xp, paidOff.save.hunters[0]!.debt, paidOff.save.hunters[0]!.reviveLeft]).toEqual([150, 60, 0, 'none']);
    expect(paidOff.debtPaid).toEqual({ total: 200, paid: 40, burn: 20, kept: 140, left: 0 });
    expect(paidOff.debtXp).toBeNull();
    expect(paidOff.lines).toEqual([
      '+60 XP (you paid off your System debt, so you got full XP).',
      'Gate clear: 200 gold. 40 went to your System debt, you got 140, and 20 was lost to debt costs. You paid off your System debt.',
    ]);

    // non-clear rewards leave gold untouched, but still cut positive XP from every source (quest, feat, GM award, fight/story)
    for (const from of ['quest', 'feat', null, undefined] as const) {
      const g = ok(grant(withDebt(100), H, { ...newRewards(), gold: 60, xp: 40 }, null, { ...DAY, from }));
      expect([g.save.hunters[0]!.gold, g.save.hunters[0]!.xp, g.save.hunters[0]!.debt, g.debtPaid], `from=${String(from)}`).toEqual([70, 10, 100, null]);
      expect(g.debtXp, `from=${String(from)}`).toEqual({ base: 40, xp: 10, rate: 0.25, left: 100 });
      expect(g.lines).toEqual(['XP is reduced to 25% while you owe 100 gold: +10 XP (from 40 XP).', '+60 gold']);
      expect(g.save.log[0]).toMatchObject({ title: 'Debt XP cut: Mira' });
    }

    // XP rounding to 0 (rate 0 or tiny XP) still reports the reduction line without adding XP
    const zeroXp = ok(grant(withDebt(100), H, { ...newRewards(), xp: 1 }, null, { ...DAY, from: 'quest' }));
    expect([zeroXp.save.hunters[0]!.xp, zeroXp.debtXp]).toEqual([0, { base: 1, xp: 0, rate: 0.25, left: 100 }]);
    expect(zeroXp.lines).toEqual(['XP is reduced to 25% while you owe 100 gold: +0 XP (from 1 XP).']);

    // negative XP is never reduced while in debt
    const negXp = ok(grant(withDebt(100, 10, 50), H, { ...newRewards(), xp: -20 }, null, { ...DAY, from: null }));
    expect([negXp.save.hunters[0]!.xp, negXp.debtXp]).toEqual([30, null]);
    expect(negXp.lines).toEqual(['Loses 20 XP']);

    // level-up near threshold (level 1 needs 100 XP): 90 + 20 base would level at full XP, but 0.25x gives +5 (95, no level-up); 40 base gives +10 (level 2!)
    const noLevel = ok(grant(withDebt(500, 10, 90), H, { ...newRewards(), xp: 20 }, null, { ...DAY, from: 'quest' }));
    expect([noLevel.save.hunters[0]!.level, noLevel.save.hunters[0]!.xp, noLevel.levelup]).toEqual([1, 95, null]);
    const leveled = ok(grant(withDebt(500, 10, 90), H, { ...newRewards(), xp: 40 }, null, { ...DAY, from: 'quest' }));
    expect([leveled.save.hunters[0]!.level, leveled.save.hunters[0]!.xp, leveled.levelup?.to]).toEqual([2, 0, 2]);

    // trade and shop sell leave debt untouched
    const h0 = withDebt(100).hunters[0]!;
    const traded = received(h0, { gold: 80, items: [] }, () => iid('i99'));
    expect([traded.gold, traded.debt]).toEqual([90, 100]);
    const potion = parseItem({ name: 'Health Potion', rar: 'common', type: 'consumable', value: 40 })!;
    const sold = ok(sell(putItem(h0, potion, iid('i1')), iid('i1'), 1, RULES));
    expect([sold.gold, sold.debt]).toEqual([20, 100]);

    // shop-borrowed debt pays off through the exact same gate clear split and 0.25x XP rule
    const borrowed = ok(buy({ ...withDebt(0, 10, 0).hunters[0]!, reviveLeft: 'free' as const }, parseItem({ name: 'Steel Longsword', rar: 'common', type: 'weapon', slot: 'weapon', value: 67 })!, iid('i2'), RULES));
    expect([borrowed.gold, borrowed.debt, borrowed.reviveLeft]).toEqual([0, 57, 'free']);
    const afterClear1 = ok(grant({ ...base0, hunters: [borrowed] }, H, { ...newRewards(), gold: 100, xp: 40 }, null, { ...DAY, from: 'clear' }));
    expect([afterClear1.save.hunters[0]!.gold, afterClear1.save.hunters[0]!.debt, afterClear1.save.hunters[0]!.xp, afterClear1.save.hunters[0]!.reviveLeft]).toEqual([25, 7, 10, 'free']);
    const afterClear2 = ok(grant(afterClear1.save, H, { ...newRewards(), gold: 100, xp: 40 }, null, { ...DAY, from: 'clear' }));
    expect([afterClear2.save.hunters[0]!.gold, afterClear2.save.hunters[0]!.debt, afterClear2.save.hunters[0]!.xp, afterClear2.save.hunters[0]!.reviveLeft]).toEqual([114, 0, 50, 'free']);
  });

  test('raiseOffer includes debtTermsLine on debt revive and omits it on free revive', () => {
    const terms = debtTermsLine(RULES);
    expect(terms.length).toBeGreaterThan(0);
    const debtOffer = raiseOffer({ reviveLeft: 'debt', rank: 'E', level: 10 }, RULES);
    expect(debtOffer?.lines).toContain(terms);
    const freeOffer = raiseOffer({ reviveLeft: 'free', rank: 'E', level: 10 }, RULES);
    expect(freeOffer?.lines).not.toContain(terms);
  });
});
