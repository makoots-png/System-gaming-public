import { describe, expect, test } from 'bun:test';
import { RULES, RANKS } from '../src/core/rules.ts';
import type { Rank } from '../src/core/rules.ts';
import { freshSave, newHunter } from '../src/core/save.ts';
import type { Hunter, ParseEnv, Save } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import {
  BLOOD_REFUSAL_WORDS,
  VESSEL_CAP,
  VESSEL_KINDS,
  addVesselToList,
  bloodExtractDc,
  parseBloodVessel,
  parseBloodVessels,
  vesselBonus,
  vesselPower,
  vesselTotalPower,
  vesselUpgradePlan,
  weakestVesselIndex,
} from '../src/core/hunter/blood-vessels.ts';
import type { BloodVessel, VesselKind } from '../src/core/hunter/blood-vessels.ts';
import { parseClasses } from '../src/core/hunter/class-locker.ts';
import {
  addBloodVessel,
  dropClass,
  earnClass,
  pushedClasses,
  removeBloodVessel,
  swapClass,
} from '../src/core/hunter/classes.ts';
import { claimUniqueClass, releaseUniqueClass } from '../src/core/hunter/class-holders.ts';
import { classExtractOf, classPowers } from '../src/core/registry/class-powers.ts';
import type { ClassExtractSpec, ClassSignature, ClassSignatureMap } from '../src/core/registry/class-powers.ts';
import { lockerView } from '../src/core/hunter/class-view.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { bloodExtractionCheck, extractDiceLabel } from '../src/core/combat/roll-adjust.ts';
import { parseEvent, parseSheetKey } from '../src/core/protocol.ts';
import { landAll } from '../src/edge/room-events.ts';
import type { ApplyDeps } from '../src/edge/room-events.ts';
import { dev, hid, day } from './fixtures/ids.ts';

const AT = '2026-11-26T12:00:00.000Z';
const STAMP = { at: AT, cap: RULES.logCap };
const ENV: ParseEnv = { now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-test') };
const ok = <T>(r: T | Refused): T => { if (isRefused(r)) throw new Error(`unexpected refusal: ${r.why}`); return r as T; };

const BLOOD_SPEC: ClassExtractSpec = {
  kind: 'blood',
  stat: 'vit',
  cap: VESSEL_CAP,
  phase: 'ended',
  label: 'Extract blood',
};

const TEST_SIGNATURES: ClassSignatureMap = {
  Hemomancer: {
    className: 'Hemomancer',
    bonus: { drain: 10 },
    extract: BLOOD_SPEC,
  },
  Fighter: {
    className: 'Fighter',
    bonus: { str: 2 },
  },
};

const mkVessel = (name: string, rank: Rank, kind: VesselKind, at = AT): BloodVessel => ({ name, rank, kind, at });

function saveWithHunter(patch?: (h: Hunter) => Hunter): Save {
  const s = freshSave(ENV, { onboarded: true });
  const h0 = s.hunters[0]!;
  const h = patch ? patch(h0) : h0;
  return { ...s, hunters: [h] };
}

describe('Crimson Vessels math, DCs, and upgrade rules (blood-vessels.ts)', () => {
  test('bloodExtractDc reads RULES.rankTable[rank].dc[0|1|2] across every rank and kind', () => {
    expect(RANKS.map(r => VESSEL_KINDS.map(k => bloodExtractDc(r, k, RULES)))).toEqual([
      [10, 13, 16],
      [14, 17, 20],
      [20, 24, 28],
      [27, 31, 35],
      [35, 40, 45],
      [45, 50, 55],
    ]);
  });

  test('vesselPower spans 1 (E normal) through 8 (S boss), and total power spans 0 to 24 across 3 vessels', () => {
    expect(vesselPower('E', 'normal')).toBe(1);
    expect(vesselPower('E', 'elite')).toBe(2);
    expect(vesselPower('E', 'boss')).toBe(3);
    expect(vesselPower('C', 'normal')).toBe(3);
    expect(vesselPower('A', 'boss')).toBe(7);
    expect(vesselPower('S', 'normal')).toBe(6);
    expect(vesselPower('S', 'elite')).toBe(7);
    expect(vesselPower('S', 'boss')).toBe(8);

    expect(vesselTotalPower([])).toBe(0);
    expect(vesselTotalPower([mkVessel('A', 'S', 'boss'), mkVessel('B', 'S', 'boss'), mkVessel('C', 'S', 'boss')])).toBe(24);
    // Caps at VESSEL_CAP even if a longer array is passed
    expect(vesselTotalPower([mkVessel('A', 'S', 'boss'), mkVessel('B', 'S', 'boss'), mkVessel('C', 'S', 'boss'), mkVessel('D', 'S', 'boss')])).toBe(24);
  });

  test('vesselBonus gives +0..6 pow, +0..6 resistPenFlat, +0..6 haste with zero drain, vit, or hpMax', () => {
    expect(vesselBonus(undefined)).toEqual({});
    expect(vesselBonus([])).toEqual({});
    // T = 1: immediate +1 pow on first extraction
    expect(vesselBonus([mkVessel('Goblin', 'E', 'normal')])).toEqual({ pow: 1 });
    // T = 2: +1 pow, +1 resistPenFlat
    expect(vesselBonus([mkVessel('Hobgoblin', 'E', 'elite')])).toEqual({ pow: 1, resistPenFlat: 1 });
    // T = 3: +1 pow, +1 resistPenFlat, +1 haste
    expect(vesselBonus([mkVessel('Goblin Chief', 'E', 'boss')])).toEqual({ pow: 1, resistPenFlat: 1, haste: 1 });
    // T = 12 (three C elites, power 4 each): +3 / +3 / +3
    expect(vesselBonus([mkVessel('A', 'C', 'elite'), mkVessel('B', 'C', 'elite'), mkVessel('C', 'C', 'elite')])).toEqual({ pow: 3, resistPenFlat: 3, haste: 3 });
    // T = 18 (three S normals, power 6 each): +5 / +5 / +4
    expect(vesselBonus([mkVessel('A', 'S', 'normal'), mkVessel('B', 'S', 'normal'), mkVessel('C', 'S', 'normal')])).toEqual({ pow: 5, resistPenFlat: 5, haste: 4 });
    // T = 24 (three S bosses, power 8 each): +6 / +6 / +6
    const maxBonus = vesselBonus([mkVessel('A', 'S', 'boss'), mkVessel('B', 'S', 'boss'), mkVessel('C', 'S', 'boss')]);
    expect(maxBonus).toEqual({ pow: 6, resistPenFlat: 6, haste: 6 });
    expect(maxBonus.drain).toBeUndefined();
    expect(maxBonus.vit).toBeUndefined();
    expect(maxBonus.hpMax).toBeUndefined();
  });

  test('upgrade plan fills open slots below 3, strictly replaces the weakest at 3/3, and refuses equal or weaker monsters', () => {
    const eNorm = mkVessel('Goblin', 'E', 'normal'); // 1
    const cBoss = mkVessel('Orc Chief', 'C', 'boss'); // 5
    const aElite = mkVessel('High Orc', 'A', 'elite'); // 6
    const sBoss = mkVessel('Ant King', 'S', 'boss'); // 8

    expect(vesselUpgradePlan([], 'E', 'normal')).toEqual({ ok: true, replaces: null, replaceIndex: null, power: 1 });
    const full = [cBoss, eNorm, aElite];
    expect(weakestVesselIndex(full)).toBe(1);

    // Equal or weaker than weakest (power 1) is refused
    expect(vesselUpgradePlan(full, 'E', 'normal')).toEqual({ ok: false, why: 'stronger-held' });
    expect(addVesselToList(full, eNorm)).toEqual({ ok: false, why: 'stronger-held' });

    // Strictly stronger replaces weakest in place
    const plan = ok(vesselUpgradePlan(full, 'S', 'boss'));
    expect(plan).toEqual({ ok: true, replaces: eNorm, replaceIndex: 1, power: 8 });
    const next = ok(addVesselToList(full, sBoss));
    expect(next.replaced).toEqual(eNorm);
    expect(next.vessels).toEqual([cBoss, sBoss, aElite]);

    // At 3 S-bosses (max power 8), nothing can replace
    const maxed = [sBoss, sBoss, sBoss];
    expect(vesselUpgradePlan(maxed, 'S', 'boss')).toEqual({ ok: false, why: 'stronger-held' });
  });

  test('parseBloodVessel and parseClasses validate fields, reject mythic and bad timestamps on wire, and cap at 3', () => {
    expect(parseBloodVessel(mkVessel('Igris', 'A', 'boss'))).toEqual(mkVessel('Igris', 'A', 'boss'));
    // Wire parsing (no fallbackAt) refuses missing/invalid timestamp, mythic kind, blank name, bad rank
    expect(parseBloodVessel({ name: 'Igris', rank: 'A', kind: 'boss' })).toBeNull();
    expect(parseBloodVessel({ name: 'Igris', rank: 'A', kind: 'boss', at: 'not-a-date' })).toBeNull();
    expect(parseBloodVessel({ name: 'Dragon', rank: 'S', kind: 'mythic', at: AT })).toBeNull();
    expect(parseBloodVessel({ name: '   ', rank: 'E', kind: 'normal', at: AT })).toBeNull();
    expect(parseBloodVessel({ name: 'Goblin', rank: 'Z', kind: 'normal', at: AT })).toBeNull();
    // Save repair provides fallbackAt and caps at 3
    expect(parseBloodVessel({ name: 'Goblin', rank: 'E', kind: 'normal', at: 'bad' }, AT)).toEqual(mkVessel('Goblin', 'E', 'normal', AT));
    const four = [mkVessel('V1', 'E', 'normal'), mkVessel('V2', 'D', 'normal'), mkVessel('V3', 'C', 'normal'), mkVessel('V4', 'S', 'boss')];
    expect(parseBloodVessels(four, AT)).toHaveLength(3);
    expect(parseBloodVessels([], AT)).toBeUndefined();

    const parsed = parseClasses({
      Hemomancer: {
        unlockedAt: AT,
        nodes: [],
        vessels: [mkVessel('Igris', 'A', 'boss'), { name: 'Bad', rank: 'S', kind: 'mythic', at: AT }],
      },
    }, { job: 'Hemomancer', fallbackAt: AT });
    expect(parsed.classes.Hemomancer?.vessels).toEqual([mkVessel('Igris', 'A', 'boss')]);
  });

  test('bloodExtractionCheck obeys nat 20 pass, nat 1 fail, and adjust matrix; extractDiceLabel formats blood labels', () => {
    for (let face = 1; face <= 20; face++) {
      for (const adj of [-10, 0, 10]) {
        const res = bloodExtractionCheck({ natural: face, bonus: 30, dc: 45 }, adj);
        expect(res.total).toBe(face + 30 + adj);
        if (face === 1) expect(res.passed).toBe(false);
        else if (face === 20) expect(res.passed).toBe(true);
        else expect(res.passed).toBe(face + 30 + adj >= 45);
      }
    }
    expect(extractDiceLabel('blood', 'Igris', 0)).toBe('Extract blood: Igris');
    expect(extractDiceLabel('blood', 'Igris', 2)).toBe('Extract blood: Igris (GM +2)');
    expect(extractDiceLabel('blood', 'Igris', -3)).toBe('Extract blood: Igris (GM -3)');
  });
});

describe('ClassSignature.extract seam, lifecycle, and sheet folding', () => {
  test('classPowers folds vesselBonus only while an awakened class with extract.kind === "blood" is active', () => {
    const vessels = [mkVessel('Igris', 'A', 'boss'), mkVessel('Beru', 'S', 'boss')]; // power 7 + 8 = 15 -> pow +4, resistPenFlat +4, haste +4
    const h = {
      job: 'Hemomancer',
      jobDone: 'Hemomancer',
      classes: { Hemomancer: { unlockedAt: AT, nodes: [], vessels } },
    };

    // With extract spec wired (as in PR C): vessels fold into classPowers.bonus
    expect(classExtractOf(h, TEST_SIGNATURES)).toEqual(BLOOD_SPEC);
    const activeRes = classPowers(h, RULES, { signatures: TEST_SIGNATURES });
    expect(activeRes.bonus).toEqual({ drain: 10, pow: 4, resistPenFlat: 4, haste: 4 });

    // Without extract spec (shipped PR B before PR C): vessels do not alter Hemomancer bonuses yet
    expect(classExtractOf(h)).toBeNull();
    const unshippedRes = classPowers(h, RULES, { signatures: { Hemomancer: { className: 'Hemomancer', bonus: { drain: 10 } } } });
    expect(unshippedRes.bonus).toEqual({ drain: 10 });

    // Swapped to another class or unawakened: vessel bonus turns off while vessels stay stored in locker
    const swapped = { ...h, job: 'Fighter', jobDone: 'Fighter', classes: { ...h.classes, Fighter: { unlockedAt: AT, nodes: [] } } };
    expect(classExtractOf(swapped, TEST_SIGNATURES)).toBeNull();
    expect(classPowers(swapped, RULES, { signatures: TEST_SIGNATURES }).bonus).toEqual({ str: 2 });
    expect(swapped.classes.Hemomancer?.vessels).toEqual(vessels);
  });

  test('addBloodVessel, removeBloodVessel, swapClass, GM revoke, fresh grantId, and pushedClasses obey the vessel lifecycle', () => {
    let s = saveWithHunter(h => {
      let x = ok(earnClass(h, 'Fighter', { at: AT, activate: false, awaken: true, R: RULES }));
      x = ok(earnClass(x, 'Hemomancer', { at: AT, activate: true, awaken: true, registryId: 'reg1', grantId: 'g1', R: RULES }));
      return x;
    });
    const hunterId = s.hunters[0]!.id;

    // Add 3 vessels and verify 4th upgrades weakest
    const v1 = mkVessel('Goblin', 'E', 'normal');
    const v2 = mkVessel('Orc', 'C', 'normal');
    const v3 = mkVessel('High Orc', 'A', 'elite');
    const v4 = mkVessel('Igris', 'A', 'boss');
    s = ok(addBloodVessel(s, hunterId, v1, STAMP, RULES, { signatures: TEST_SIGNATURES })).save;
    s = ok(addBloodVessel(s, hunterId, v2, STAMP, RULES, { signatures: TEST_SIGNATURES })).save;
    s = ok(addBloodVessel(s, hunterId, v3, STAMP, RULES, { signatures: TEST_SIGNATURES })).save;
    expect(s.hunters[0]!.classes.Hemomancer?.vessels).toEqual([v1, v2, v3]);

    // Weaker than weakest is refused
    expect(addBloodVessel(s, hunterId, mkVessel('Rat', 'E', 'normal'), STAMP, RULES, { signatures: TEST_SIGNATURES })).toEqual({ ok: false, why: 'stronger-held' });

    // Stronger replaces weakest (v1)
    const up = ok(addBloodVessel(s, hunterId, v4, STAMP, RULES, { signatures: TEST_SIGNATURES }));
    expect(up.replaced).toEqual(v1);
    s = up.save;
    expect(s.hunters[0]!.classes.Hemomancer?.vessels).toEqual([v4, v2, v3]);

    // pushedClasses keeps active class's vessels on the wire
    const wire = pushedClasses(s.hunters[0]!);
    expect(Object.keys(wire.classes)).toEqual(['Hemomancer']);
    expect(wire.classes.Hemomancer?.vessels).toEqual([v4, v2, v3]);

    // removeBloodVessel refuses while held or dead, succeeds outside fight
    expect(removeBloodVessel(s, hunterId, 1, { held: true, at: AT, R: RULES })).toEqual({ ok: false, why: 'held' });
    expect(removeBloodVessel(s, hunterId, 99, { held: false, at: AT, R: RULES })).toEqual({ ok: false, why: 'no-vessel' });
    const rem = ok(removeBloodVessel(s, hunterId, 1, { held: false, at: AT, R: RULES }));
    expect(rem.removed).toEqual(v2);
    s = rem.save;
    expect(s.hunters[0]!.classes.Hemomancer?.vessels).toEqual([v4, v3]);

    // Swapping to Fighter preserves Hemomancer's vessels in the locker
    const swapped = ok(swapClass(s, hunterId, 'Fighter', {
      role: 'gm', held: false, at: AT, room: null, stamp: null, R: RULES, activeRegistryId: null,
    }));
    expect(swapped.save.hunters[0]!.classes.Hemomancer?.vessels).toEqual([v4, v3]);

    // Fresh grantId (resetNodes: true) clears vessels; same grantId restore (resetNodes: false) preserves them
    const kept = ok(earnClass(s.hunters[0]!, 'Hemomancer', { at: AT, registryId: 'reg1', grantId: 'g1', resetNodes: false, R: RULES }));
    expect(kept.classes.Hemomancer?.vessels).toEqual([v4, v3]);
    const reset = ok(earnClass(s.hunters[0]!, 'Hemomancer', { at: AT, registryId: 'reg1', grantId: 'g2', resetNodes: true, R: RULES }));
    expect(reset.classes.Hemomancer?.vessels).toBeUndefined();

    // GM revoke (dropClass & releaseUniqueClass) clears vessels
    const dropped = dropClass(s.hunters[0]!, 'Hemomancer', RULES);
    expect(dropped.classes.Hemomancer).toBeUndefined();

    const claimed = ok(claimUniqueClass(saveWithHunter(), 'Hemomancer', { kind: 'local', hunterId: hid('h1') }, {
      at: AT, room: null, stamp: null, R: RULES, heldLocal: () => false, heldRemote: () => false,
    })).save;
    const withBlood = ok(addBloodVessel(claimed, claimed.hunters[0]!.id, v4, STAMP, RULES, { signatures: TEST_SIGNATURES })).save;
    expect(withBlood.hunters[0]!.classes.Hemomancer?.vessels).toEqual([v4]);
    const released = ok(releaseUniqueClass(withBlood, 'Hemomancer', {
      at: AT, room: null, stamp: null, R: RULES, heldLocal: () => false, heldRemote: () => false,
    })).save;
    expect(released.hunters[0]!.classes.Hemomancer).toBeUndefined();
  });

  test('lockerView shows Crimson Vessels section for blood-extracting active class and hides it when absent', () => {
    const plain = newHunter(RULES);
    const vmPlain = lockerView(plain, { role: 'player', held: false, R: RULES, activeRegistryId: null, signatures: TEST_SIGNATURES });
    expect(vmPlain.vessels).toBeNull();

    let hemo = ok(earnClass(plain, 'Hemomancer', { at: AT, activate: true, awaken: true, R: RULES }));
    const vmEmpty = lockerView(hemo, { role: 'player', held: false, R: RULES, activeRegistryId: null, signatures: TEST_SIGNATURES });
    expect(vmEmpty.vessels).toEqual({ className: 'Hemomancer', count: 0, cap: 3, totalPower: 0, bonus: {}, items: [] });

    const s = ok(addBloodVessel(saveWithHunter(() => hemo), hemo.id, mkVessel('Igris', 'A', 'boss'), STAMP, RULES, { signatures: TEST_SIGNATURES })).save;
    const vmFilled = lockerView(s.hunters[0]!, { role: 'player', held: false, R: RULES, activeRegistryId: null, signatures: TEST_SIGNATURES });
    expect(vmFilled.vessels).toEqual({
      className: 'Hemomancer',
      count: 1,
      cap: 3,
      totalPower: 7,
      bonus: { pow: 2, resistPenFlat: 2, haste: 2 },
      items: [{ index: 0, name: 'Igris', rank: 'A', kind: 'boss', power: 7 }],
    });
  });

  test('room-events landAll applies bloodExtract once via appliedOnce and warns when 3 stronger vessels are held', () => {
    const s0 = saveWithHunter(h => ok(earnClass(h, 'Hemomancer', { at: AT, activate: true, awaken: true, R: RULES })));
    const hId = s0.hunters[0]!.id;
    const key = parseSheetKey(`${s0.settings.deviceId}:${hId}`)!;
    const toasts: { tag: string; text: string; kind?: string }[] = [];
    const deps: ApplyDeps = {
      store: { get: () => s0 },
      once: () => true,
      rules: () => RULES,
      now: () => AT,
      today: () => day('2026-11-26'),
      toast: (tag, text, o) => { toasts.push({ tag, text, ...(o ? { kind: o.kind } : {}) }); },
      system: () => undefined,
      warn: () => undefined,
      hunter: { fightOf: () => null, granted: () => ({ lines: [], levelup: null, popup: null }), gmHolds: () => ({ ok: false, why: 'told' as never }) },
      stepsDone: () => undefined,
      coinRuled: () => undefined,
    };

    const ev1 = parseEvent('bloodExtract', { eid: 'd-gm-b1', to: [key], vessel: mkVessel('Igris', 'A', 'boss') })!;
    const landed1 = landAll(s0, [], [ev1], deps);
    for (const t of landed1.tells) t();
    expect(landed1.save.hunters[0]!.classes.Hemomancer?.vessels).toEqual([mkVessel('Igris', 'A', 'boss')]);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.text).toContain('Igris (A-rank boss) fills a Crimson Vessel');

    // Replaying the same event id is a no-op (appliedOnce)
    const landedReplay = landAll(landed1.save, [], [ev1], deps);
    expect(landedReplay.save.hunters[0]!.classes.Hemomancer?.vessels).toEqual([mkVessel('Igris', 'A', 'boss')]);
    expect(landedReplay.tells).toEqual([]);

    // Fill to 3 S-bosses, then send a weaker E-normal bloodExtract -> refused with warning toast
    const sFull = [
      mkVessel('Ant King', 'S', 'boss'),
      mkVessel('Ice Monarch', 'S', 'boss'),
      mkVessel('Beast Monarch', 'S', 'boss'),
    ].reduce((acc, v) => ok(addBloodVessel(acc, hId, v, STAMP, RULES)).save, s0);
    const evWeak = parseEvent('bloodExtract', { eid: 'd-gm-b2', to: [key], vessel: mkVessel('Goblin', 'E', 'normal') })!;
    toasts.length = 0;
    const landedWeak = landAll(sFull, [], [evWeak], deps);
    for (const t of landedWeak.tells) t();
    expect(landedWeak.save.hunters[0]!.classes.Hemomancer?.vessels).toHaveLength(3);
    expect(toasts).toEqual([{ tag: 'Blood extraction', text: BLOOD_REFUSAL_WORDS['stronger-held'], kind: 'warning' }]);
  });

  test('hunterSheet reflects zero change when no blood extract spec is wired yet (PR B isolation)', () => {
    const base = ok(earnClass(newHunter(RULES), 'Hemomancer', { at: AT, activate: true, awaken: true, R: RULES }));
    const withV = ok(addBloodVessel(saveWithHunter(() => base), base.id, mkVessel('Ant King', 'S', 'boss'), STAMP, RULES)).save.hunters[0]!;
    // Since PR C has not wired HEMOMANCER_SIGNATURE.extract yet, live hunterSheet stats remain identical
    expect(hunterSheet(withV, RULES)).toEqual(hunterSheet(base, RULES));
  });
});
