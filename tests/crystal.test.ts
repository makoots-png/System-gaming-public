import { describe, expect, test } from 'bun:test';
import {
  CRYSTAL_BUYERS,
  CRYSTAL_MAX,
  CRYSTAL_WORDS,
  addCrystal,
  buyerStatus,
  clearCrystalEach,
  defaultBuyer,
  gateCrystalPool,
  personalCrystal,
  sellCrystal,
  sellCrystalStep,
  sellPayout,
  sellPlan,
  setCrystal,
  splitPool,
} from '../src/core/hunter/crystal.ts';
import { grant } from '../src/core/hunter/grant.ts';
import { newHunter } from '../src/core/hunter/hunter.ts';
import { roomRulesOf, withRoomRules } from '../src/core/hunter/build.ts';
import { newGate } from '../src/core/gates/gate.ts';
import { clearShares, settleClearPreset } from '../src/core/gates/pay.ts';
import { gatePreset, parseClearPreset } from '../src/core/gates/preset.ts';
import { recommendPreset } from '../src/core/gates/spawn.ts';
import { soloOwed, soloPlan, soloRan, soloTaken } from '../src/core/gates/solo.ts';
import { lootPool } from '../src/core/registry/items.ts';
import { DOCS, newEvent, parseSheet } from '../src/core/protocol.ts';
import { grantLines, isEmptyReward, newRewards, parseRewards, rewardLines } from '../src/core/rewards.ts';
import { RANKS, RULES, rulesOf } from '../src/core/rules.ts';
import { crystalLines, crystalRows } from '../src/core/rules-text.ts';
import { freshSave, repairSave } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { GateId, HunterId, RoomCode, SheetKey } from '../src/core/ids.ts';
import { day, dev, gid, hid } from './fixtures/ids.ts';

const AT = '2026-11-23T15:00:00.000Z';
const DAY = { at: AT, today: day('2026-11-23'), R: RULES };

const ENV = { now: new Date(AT), newDeviceToken: () => 'tok-0123456789abcdef0123456789ab', newDeviceId: () => dev('d-test') };
const makeSave = () => freshSave(ENV, { onboarded: true });

describe('mana crystal drop formulas', () => {
  test('world gate crystal pool is 4x priceBase (1.5x for Red and Double)', () => {
    const expectedNormal = { E: 400, D: 1300, C: 5000, B: 20000, A: 76000, S: 300000 };
    const expectedSpecial = { E: 600, D: 1950, C: 7500, B: 30000, A: 114000, S: 450000 };
    for (const rank of RANKS) {
      expect(gateCrystalPool(rank, 'normal', RULES)).toBe(expectedNormal[rank]);
      expect(gateCrystalPool(rank, 'break', RULES)).toBe(expectedNormal[rank]);
      expect(gateCrystalPool(rank, 'red', RULES)).toBe(expectedSpecial[rank]);
      expect(gateCrystalPool(rank, 'double', RULES)).toBe(expectedSpecial[rank]);
    }
  });

  test('unsigned party of 4 receives 12% salvage split evenly across ranks', () => {
    const expectedNormal = { E: 12, D: 39, C: 150, B: 600, A: 2280, S: 9000 };
    const expectedSpecial = { E: 18, D: 58, C: 225, B: 900, A: 3420, S: 13500 };
    for (const rank of RANKS) {
      expect(clearCrystalEach({ rank, type: 'normal' }, 4, RULES)).toBe(expectedNormal[rank]);
      expect(clearCrystalEach({ rank, type: 'red' }, 4, RULES)).toBe(expectedSpecial[rank]);
      expect(clearCrystalEach({ rank, type: 'double' }, 4, RULES)).toBe(expectedSpecial[rank]);
    }
  });

  test('party scaling gives smaller parties larger shares and crowds less', () => {
    // E-rank normal unsigned salvage pool is 48
    expect(clearCrystalEach({ rank: 'E', type: 'normal' }, 0, RULES)).toBe(0);
    expect(clearCrystalEach({ rank: 'E', type: 'normal' }, 1, RULES)).toBe(48);
    expect(clearCrystalEach({ rank: 'E', type: 'normal' }, 2, RULES)).toBe(24);
    expect(clearCrystalEach({ rank: 'E', type: 'normal' }, 4, RULES)).toBe(12);
    expect(clearCrystalEach({ rank: 'E', type: 'normal' }, 6, RULES)).toBe(Math.floor((48 * 4) / 36));
    expect(splitPool(100, 3, 3)).toBe(33);
  });

  test('personal gates yield 0.10x priceBase to the solo hunter', () => {
    const expected = { E: 10, D: 32, C: 125, B: 500, A: 1900, S: 7500 };
    for (const rank of RANKS) {
      expect(personalCrystal(rank, RULES)).toBe(expected[rank]);
    }
  });
});

describe('mana crystal exchange and buyer availability', () => {
  test('sellPayout handles IEEE-754 boundary multiples cleanly', () => {
    expect(sellPayout(70, 0.7)).toBe(49);
    expect(sellPayout(140, 0.7)).toBe(98);
    expect(sellPayout(100, 0.9)).toBe(90);
    expect(sellPayout(100, 0.85)).toBe(85);
    expect(sellPayout(12, 0.9)).toBe(10);
    expect(sellPayout(12, 0.85)).toBe(10);
    expect(sellPayout(12, 0.7)).toBe(8);
    expect(sellPayout(1, 0.7)).toBe(0);
    expect(sellPayout(0, 0.85)).toBe(0);
    expect(sellPayout(-10, 0.85)).toBe(0);
  });

  test('buyer availability keeps every shown buyer meaningful', () => {
    const debtFree = newHunter(RULES);
    const inDebt = { ...newHunter(RULES), debt: 100 };

    expect(buyerStatus(debtFree, 'helix')).toEqual({ open: false, why: 'guild-only' });
    expect(buyerStatus(debtFree, 'bureau')).toEqual({ open: true });
    expect(buyerStatus(debtFree, 'stair')).toEqual({ open: true });
    expect(defaultBuyer(debtFree)).toBe('bureau');

    expect(buyerStatus(inDebt, 'helix')).toEqual({ open: false, why: 'guild-only' });
    expect(buyerStatus(inDebt, 'bureau')).toEqual({ open: false, why: 'in-debt' });
    expect(buyerStatus(inDebt, 'stair')).toEqual({ open: true });
    expect(defaultBuyer(inDebt)).toBe('stair');
    expect(CRYSTAL_BUYERS).toEqual(['helix', 'bureau', 'stair']);
  });

  test('addCrystal and setCrystal clamp to whole numbers in 0..CRYSTAL_MAX', () => {
    const h0 = newHunter(RULES);
    const h1 = addCrystal(h0, 50.9);
    expect(h1.crystal).toBe(50);
    expect(addCrystal(h1, -80).crystal).toBe(0);
    expect(addCrystal(h1, CRYSTAL_MAX * 2).crystal).toBe(CRYSTAL_MAX);
    expect(setCrystal(h1, -10).crystal).toBe(0);
    expect(setCrystal(h1, 250.7).crystal).toBe(250);
    expect(setCrystal(h1, CRYSTAL_MAX + 50).crystal).toBe(CRYSTAL_MAX);
  });

  test('sellCrystal deducts crystal, adds gold without touching debt, and refuses invalid states', () => {
    const h = addCrystal(newHunter(RULES), 100);
    const sold = sellCrystal(h, 40, 'bureau', RULES, false);
    expect(isRefused(sold)).toBe(false);
    if (!isRefused(sold)) {
      expect(sold.hunter.crystal).toBe(60);
      expect(sold.hunter.gold).toBe(34);
      expect(sold.gold).toBe(34);
      expect(sold.line.text).toContain('40 mana crystal');
      expect(sold.line.text).toContain('Bureau exchange');
      expect(sold.line.text).toContain('34 gold');
    }

    // Helix is guild-only
    expect(sellPlan(h, 40, 'helix', RULES, false)).toEqual({ ok: false, why: 'guild-only' });
    // Dead hunter refused for every buyer
    const dead = { ...h, life: { at: 'dead' as const } };
    expect(sellCrystal(dead, 40, 'bureau', RULES, false)).toEqual({ ok: false, why: 'dead' });
    expect(sellCrystal(dead, 40, 'stair', RULES, false)).toEqual({ ok: false, why: 'dead' });
    // In-fight refused
    expect(sellCrystal(h, 40, 'bureau', RULES, true)).toEqual({ ok: false, why: 'in-fight' });
    // Bad amount / not enough / payout zero
    expect(sellCrystal(h, 0, 'bureau', RULES, false)).toEqual({ ok: false, why: 'bad-amount' });
    expect(sellCrystal(h, 101, 'bureau', RULES, false)).toEqual({ ok: false, why: 'not-enough' });
    expect(sellCrystal(h, 1, 'bureau', RULES, false)).toEqual({ ok: false, why: 'payout-zero' });

    // In System debt: Bureau refused, Stair allowed, debt untouched
    const indebted = { ...h, debt: 500 };
    expect(sellCrystal(indebted, 50, 'bureau', RULES, false)).toEqual({ ok: false, why: 'in-debt' });
    const fenced = sellCrystal(indebted, 50, 'stair', RULES, false);
    expect(isRefused(fenced)).toBe(false);
    if (!isRefused(fenced)) {
      expect(fenced.hunter.crystal).toBe(50);
      expect(fenced.hunter.gold).toBe(35);
      expect(fenced.hunter.debt).toBe(500);
    }
  });

  test('sellCrystalStep updates save and appends session log atomically', () => {
    const s0 = makeSave();
    const h0 = s0.hunters[0]!;
    const s1 = { ...s0, hunters: [addCrystal(h0, 100)] };
    const res = sellCrystalStep(s1, h0.id, 70, 'stair', { at: AT, R: RULES, inFight: false });
    expect(isRefused(res)).toBe(false);
    if (!isRefused(res)) {
      expect(res.sold.gold).toBe(49);
      expect(res.save.hunters[0]!.crystal).toBe(30);
      expect(res.save.hunters[0]!.gold).toBe(49);
      expect(res.save.log[0]!.title).toBe(CRYSTAL_WORDS.logTitle);
      expect(res.save.log[0]!.text).toContain('49 gold');
    }
    expect(sellCrystalStep(s1, 'h-none', 10, 'bureau', { at: AT, R: RULES })).toEqual({ ok: false, why: 'missing' });
  });
});

describe('rewards, grant, debt, saves, room rules, and gate clears', () => {
  test('grant applies crystal directly and never splits crystal toward System debt', () => {
    const s0 = makeSave();
    const h0 = { ...s0.hunters[0]!, debt: 600 };
    const s1 = { ...s0, hunters: [h0] };
    const rw = { ...newRewards(), gold: 200, crystal: 39 };
    const g = grant(s1, h0.id, rw, null, { ...DAY, vitals: 'sheet', from: 'clear' });
    expect(isRefused(g)).toBe(false);
    if (!isRefused(g)) {
      // Gold splits 50% debt (100), 25% burn (50), 25% kept (50); crystal lands 100% untouched
      expect(g.save.hunters[0]!.gold).toBe(50);
      expect(g.save.hunters[0]!.debt).toBe(500);
      expect(g.save.hunters[0]!.crystal).toBe(39);
      expect(g.lines).toContain('+39 mana crystal');
    }

    // Negative crystal clamps to 0 and reports actual loss
    const s2 = { ...s0, hunters: [addCrystal(s0.hunters[0]!, 10)] };
    const loss = grant(s2, h0.id, { ...newRewards(), crystal: -25 }, null, { ...DAY, vitals: 'sheet' });
    expect(isRefused(loss)).toBe(false);
    if (!isRefused(loss)) {
      expect(loss.save.hunters[0]!.crystal).toBe(0);
      expect(loss.lines).toContain('Loses 10 mana crystal');
    }
  });

  test('Rewards parser, lines, and empty check include crystal', () => {
    expect(isEmptyReward(newRewards())).toBe(true);
    const rw = parseRewards({ crystal: 25 })!;
    expect(isEmptyReward(rw)).toBe(false);
    expect(rewardLines(RULES, rw)).toEqual(['+25 mana crystal']);
    expect(grantLines(RULES, rw)).toEqual(['+25 mana crystal']);
  });

  test('old schema-4 save and room sheet without crystal load at 0', () => {
    const s0 = makeSave();
    const raw = JSON.parse(JSON.stringify(s0));
    delete raw.hunters[0].crystal;
    const repaired = repairSave(raw, ENV);
    expect(repaired.hunters[0]!.crystal).toBe(0);

    const sheetRaw = JSON.parse(JSON.stringify({ hunter: s0.hunters[0] }));
    delete sheetRaw.hunter.crystal;
    const key = `${s0.settings.deviceId}:${s0.hunters[0]!.id}` as SheetKey;
    const parsed = parseSheet(key, sheetRaw);
    expect(parsed && 'hunter' in parsed ? parsed.hunter.crystal : -1).toBe(0);
  });

  test('RoomRules round-trips crystal rules and defaults missing crystal to RULES.crystal', () => {
    const custom = rulesOf({ crystal: { unsignedShare: 0.25, rates: { bureau: 0.88 } } });
    const rr = roomRulesOf(custom);
    const parsed = DOCS.rules(rr);
    expect(parsed).not.toBeNull();
    expect(parsed!.crystal.unsignedShare).toBe(0.25);
    expect(parsed!.crystal.rates.bureau).toBe(0.88);
    expect(withRoomRules(RULES, parsed).crystal.rates.bureau).toBe(0.88);

    // Missing crystal field falls back to shipped defaults
    const legacy = JSON.parse(JSON.stringify(rr));
    delete legacy.crystal;
    const parsedLegacy = DOCS.rules(legacy);
    expect(parsedLegacy).not.toBeNull();
    expect(parsedLegacy!.crystal).toEqual(RULES.crystal);
  });

  test('clearShares, recommendPreset, parseClearPreset, and settleClearPreset handle mana crystal', () => {
    const s0 = makeSave();
    const g = { ...newGate(), id: gid('g1'), name: 'Red Cavern', rank: 'D' as const, type: 'red' as const, createdDay: 1, breakDay: 7 };
    const s1 = { ...s0, gates: [g] };
    const payees = [
      { kind: 'local' as const, hid: s0.hunters[0]!.id, name: s0.hunters[0]!.name },
      { kind: 'remote' as const, key: 'd-p2:h1' as SheetKey, name: 'P2' },
      { kind: 'remote' as const, key: 'd-p3:h1' as SheetKey, name: 'P3' },
      { kind: 'remote' as const, key: 'd-p4:h1' as SheetKey, name: 'P4' },
    ];
    const plan = clearShares(s1, g.id, () => 0, 500, [], payees, null, RULES.gateParty, RULES)!;
    // D-rank Red gate: pool 1950, 12% = 234, party of 4 = 58 each
    expect(plan.shares[0]!.crystal).toBe(58);

    // Preset recommendation & edit & settle
    const rec = recommendPreset(g, 4, () => 0, RULES, lootPool(RULES), () => 0);
    expect(rec.crystal).toBe(58);
    const withRec = gatePreset(s1, g.id, rec);
    expect(isRefused(withRec)).toBe(false);
    if (!isRefused(withRec)) {
      const edited = gatePreset(withRec, g.id, { type: 'setCrystal', crystal: 75 });
      expect(isRefused(edited)).toBe(false);
      if (!isRefused(edited)) {
        const settled = settleClearPreset(edited, g.id, () => 0, [payees[0]!], null, DAY);
        expect(isRefused(settled)).toBe(false);
        if (!isRefused(settled)) {
          expect(settled.save.hunters[0]!.crystal).toBe(75);
          expect(settled.save.log.find(l => l.title === 'GATE CLEARED')!.text).toContain('75 mana crystal');
        }
      }
    }

    // Old saved preset without crystal parses cleanly at 0
    const oldPreset = parseClearPreset({ at: 'edited', xp: 100, gold: 50, items: [] });
    expect(oldPreset.at === 'edited' && oldPreset.crystal).toBe(0);
  });

  test('solo world-gate plan and owed rewards include solo mana crystal salvage', () => {
    const s0 = makeSave();
    const g = { ...newGate(), id: gid('g-solo'), name: 'Solo Pit', rank: 'E' as const, type: 'normal' as const, solo: true, createdDay: 1, breakDay: 7 };
    const s1 = { ...s0, gates: [g] };
    const run = { eid: 'e-1' as never, by: 'd-p1:h1' as SheetKey, gate: g.id as GateId, name: 'Soloist', outcome: 'won' as const, rounds: 3, life: 'up' as const };
    const plan = soloPlan(s1, run, RULES);
    expect(plan.kind).toBe('paid');
    if (plan.kind === 'paid') {
      // Solo clearer gets whole unsigned party salvage (48 at E normal)
      expect(plan.crystal).toBe(48);
      const owed = soloOwed(plan, { gold: 100, items: [] });
      expect(owed.crystal).toBe(48);
      const ans = newEvent('soloAnswer', { to: [run.by], run: run.eid, gate: g.id, name: g.name, verdict: 'cleared' }, { device: dev('d-test'), now: 1700000000000, rand: 0.2 })!;
      const taken = soloTaken(s1, run, plan, ans, { gold: 100, items: [] }, {
        day: DAY,
        room: { code: 'ROOM1' as RoomCode, stamp: { device: dev('d-test'), now: 1700000000001, rand: 0.3 } },
        rank: 'E',
      });
      expect(isRefused(taken)).toBe(false);
      if (!isRefused(taken)) {
        expect(taken.settings.sync.pending?.[0]?.rewards.crystal).toBe(48);
      }
    }
  });

  test('rules-text crystalLines and crystalRows reflect RULES overrides', () => {
    const rows = crystalRows(RULES);
    expect(rows.find(r => r.rank === 'E')).toEqual({ rank: 'E', pool: 400, normal: 12, special: 18, personal: 10 });
    expect(rows.find(r => r.rank === 'C')).toEqual({ rank: 'C', pool: 5000, normal: 150, special: 225, personal: 125 });

    const lines = crystalLines(RULES).join(' ');
    expect(lines).toContain('only sell mana crystal for gold');
    expect(lines).toContain('Resurrection Crystals');
    expect(lines).toContain('85%');
    expect(lines).toContain('70%');
    expect(lines).toContain('90%');

    const custom = rulesOf({ crystal: { rates: { bureau: 0.88 } } });
    expect(crystalLines(custom).join(' ')).toContain('88%');
  });
});
