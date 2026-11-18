import { describe, expect, test } from 'bun:test';
import { MAX_LEVEL, STAT_MIN, addXp, allocated, atLevel, available, confirm, gainXp, grantPoints, hasPending, levelPoints, lower, newProgress, pendingTotal, raise, raiseMany, setLevel, setPoints, setStat, startingStats } from '../src/core/hunter/progress.ts';
import type { Allocating, Progress } from '../src/core/hunter/progress.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { STAT_KEYS } from '../src/core/stats.ts';
import type { StatKey } from '../src/core/stats.ts';
import { RULES } from '../src/core/rules.ts';
import type { Rules } from '../src/core/rules.ts';

/**
 * The rules these tests are worked out with, pinned here so a change to the shipped numbers does not move them:
 * a level costs 100 XP times the level (1 to 2 costs 100, 2 to 3 costs 200, 3 to 4 costs 300), each level above 1
 * holds 3 ability points, and reaching a new level refills HP and mana. The creation points of level 1 are 0 in `R`, so
 * the cases below count the points of the levels alone; `C12` has the shipped 12 and its own cases.
 */
const R: Rules = { ...RULES, xpPerLevel: 100, pointsPerLevel: 3, levelUpRestore: true, fight: { ...RULES.fight, creationPoints: 0 } };
const C12: Rules = { ...R, fight: { ...RULES.fight, creationPoints: 12 } };
const at = (fields: Partial<Progress>): Progress => ({ ...newProgress(), ...fields });
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const BASE = Object.fromEntries(STAT_KEYS.map(k => [k, 10])) as Record<StatKey, number>;
/** Puts `n` points on Strength and confirms them, or null when fewer than `n` are free: spending, as the sheet does it. */
const put = (p: Progress, n: number, rules: Rules = R): Progress | null => {
  const raised = raiseMany({ ...p, stats: { ...BASE } }, { str: n }, rules);
  if (isRefused(raised)) return null;
  const { stats: _stats, ...rest } = confirm(raised);
  return rest;
};

describe('XP and levels', () => {
  test('a new hunter is level 1 with no XP and no points', () => {
    expect(newProgress()).toEqual({ level: 1, xp: 0, peakLevel: 1, bonusPoints: 0, spent: 0, pending: {} });
    expect(available(newProgress(), R)).toBe(0);
  });

  test('+500 XP at level 1 reaches level 3 with 200 XP and 6 points', () => {
    // 500 - 100 (1 to 2) = 400; 400 - 200 (2 to 3) = 200; 200 is short of the 300 that 3 to 4 costs.
    // Levels 2 and 3 hold 3 points each: 6.
    const r = gainXp(newProgress(), 500, R);
    expect(r.progress).toEqual({ level: 3, xp: 200, peakLevel: 3, bonusPoints: 0, spent: 0, pending: {} });
    expect(r).toMatchObject({ from: 1, to: 3, points: 6, refill: true });
    expect(available(r.progress, R)).toBe(6);
  });

  test('XP that lands exactly on a level starts it at 0 XP', () => {
    expect(gainXp(newProgress(), 100, R).progress).toMatchObject({ level: 2, xp: 0 });
  });

  test('XP below the next level changes only the XP', () => {
    const r = gainXp(at({ level: 2, peakLevel: 2, xp: 50 }), 100, R);
    expect(r.progress).toMatchObject({ level: 2, xp: 150, peakLevel: 2 });
    expect(r).toMatchObject({ from: 2, to: 2, points: 0, refill: false });
  });

  test('-500 XP at level 3 with 200 XP goes back to level 1 with 0 XP and keeps the peak', () => {
    // 200 - 500 = -300; level 2 gives back its 200: -100; level 1 gives back its 100: 0.
    const r = gainXp(at({ level: 3, xp: 200, peakLevel: 3 }), -500, R);
    expect(r.progress).toEqual({ level: 1, xp: 0, peakLevel: 3, bonusPoints: 0, spent: 0, pending: {} });
    expect(r).toMatchObject({ from: 3, to: 1, points: -6, refill: false });
  });

  test('XP never goes below 0 at level 1', () => {
    expect(gainXp(at({ xp: 50 }), -500, R).progress).toMatchObject({ level: 1, xp: 0 });
  });

  test('an amount that is not a finite number changes nothing; a fraction is cut to a whole number', () => {
    const p = at({ level: 2, xp: 10, peakLevel: 2 });
    for (const bad of [NaN, Infinity, -Infinity]) expect(gainXp(p, bad, R).progress).toEqual(p);
    expect(gainXp(p, 20.9, R).progress.xp).toBe(30);
  });

  test('levels stop at MAX_LEVEL', () => {
    const r = gainXp(at({ level: MAX_LEVEL, peakLevel: MAX_LEVEL }), 1e9, R);
    expect(r.progress.level).toBe(MAX_LEVEL);
    expect(r.progress.xp).toBeLessThan(R.xpPerLevel * MAX_LEVEL);
  });

  test('the input is never changed', () => {
    const p = at({ level: 3, xp: 200, peakLevel: 3, bonusPoints: 2, spent: 4 }), before = copy(p);
    gainXp(p, 900, R); gainXp(p, -900, R); grantPoints(p, 3, R); setPoints(p, 9, R); setLevel(p, 7, 0, R);
    expect(p).toEqual(before);
  });
});

describe('the level-up refill', () => {
  test('happens when a level above the peak is reached', () => {
    expect(gainXp(at({ level: 3, xp: 200, peakLevel: 3 }), 100, R)).toMatchObject({ to: 4, refill: true });
  });

  test('does not happen when a lost level is regained', () => {
    // Peak 3, back at level 1: +300 XP reaches level 3 again (100 + 200), not above the peak.
    const r = gainXp(at({ level: 1, peakLevel: 3 }), 300, R);
    expect(r).toMatchObject({ from: 1, to: 3, refill: false });
    expect(r.progress.peakLevel).toBe(3);
  });

  test('happens once the hunter passes the old peak, and the peak moves up', () => {
    // Peak 3, back at level 1: +600 XP is 100 + 200 + 300, level 4.
    const r = gainXp(at({ level: 1, peakLevel: 3 }), 600, R);
    expect(r).toMatchObject({ to: 4, refill: true });
    expect(r.progress.peakLevel).toBe(4);
  });

  test('never happens when the rules turn it off', () => {
    expect(gainXp(newProgress(), 500, { ...R, levelUpRestore: false }).refill).toBe(false);
  });
});

describe('ability points', () => {
  test('bug 1: gaining levels, spending their points, losing the levels and regaining them gives no new points', () => {
    const levelled = gainXp(newProgress(), 500, R).progress;
    const spentAll = put(levelled, 6)!;
    expect(available(spentAll, R)).toBe(0);
    const lost = gainXp(spentAll, -500, R);
    expect(lost.progress.level).toBe(1);
    expect(available(lost.progress, R)).toBe(0);
    const again = gainXp(lost.progress, 500, R);
    expect(again.progress.level).toBe(3);
    expect(available(again.progress, R)).toBe(0);
    expect(again).toMatchObject({ points: 0, refill: false });
  });

  test('losing levels with one point unspent leaves 0, and regaining them gives back only that one', () => {
    // Level 3 holds 6; 5 spent leaves 1. At level 1 the hunter holds 0 and has spent 5: 0 shown.
    // Back at level 3: 6 - 5 = 1.
    const five = put(gainXp(newProgress(), 500, R).progress, 5)!;
    const lost = gainXp(five, -500, R).progress;
    expect(available(lost, R)).toBe(0);
    expect(available(gainXp(lost, 500, R).progress, R)).toBe(1);
  });

  test('an overspent hunter gets points again once the levels held pass what was spent', () => {
    // Level 1, peak 3, 6 spent: level 3 holds 6 (0 free), level 4 holds 9 (3 free).
    const lost = at({ level: 1, peakLevel: 3, spent: 6 });
    const r = gainXp(lost, 600, R);
    expect(r.progress.level).toBe(4);
    expect(available(r.progress, R)).toBe(3);
    expect(r.points).toBe(3);
  });

  test('points follow the rule for points per level', () => {
    expect(available(at({ level: 5, peakLevel: 5 }), { ...R, pointsPerLevel: 5 })).toBe(20);
  });

  test('bonus points add to the points of the levels held', () => {
    // Level 2 holds 3, plus 2 from quests, less 1 spent: 4.
    expect(available(at({ level: 2, peakLevel: 2, bonusPoints: 2, spent: 1 }), R)).toBe(4);
  });

  test('spending takes points while there are enough, and is refused otherwise', () => {
    const p = at({ level: 2, peakLevel: 2 });
    expect(put(p, 2)).toMatchObject({ spent: 2 });
    expect(put(p, 4)).toBeNull();
    expect(put(p, 0)).toBeNull();
    expect(put(at({ level: 1, peakLevel: 3, spent: 6 }), 1)).toBeNull();
  });

  test('a reward of points adds them; a deduction takes at most what is free', () => {
    const p = at({ level: 1 });
    expect(available(grantPoints(p, 2, R), R)).toBe(2);
    // 1 free and a deduction of 3: 0 free, and the bonus goes down by the 1 that was free.
    const one = at({ bonusPoints: 1 });
    expect(grantPoints(one, -3, R)).toMatchObject({ bonusPoints: 0 });
    // Overspent by 6: a deduction finds nothing free and changes nothing.
    const over = at({ level: 1, peakLevel: 3, spent: 6 });
    expect(grantPoints(over, -3, R)).toEqual(over);
  });

  test('a reward of points to an overspent hunter goes to the debt first', () => {
    // Level 1, 6 spent, +2: 0 + 2 - 6 = -4, shown as 0.
    expect(available(grantPoints(at({ level: 1, peakLevel: 3, spent: 6 }), 2, R), R)).toBe(0);
  });

  test('the GM sets the points shown to any number of 0 or more', () => {
    expect(available(setPoints(at({ level: 3, peakLevel: 3, spent: 2 }), 7, R), R)).toBe(7);
    expect(available(setPoints(at({ level: 1, peakLevel: 3, spent: 6 }), 1, R), R)).toBe(1);
    expect(available(setPoints(at({ level: 3, peakLevel: 3 }), -4, R), R)).toBe(0);
  });
});

describe('the creation points of level 1', () => {
  test('a new hunter has 12 points to spend', () => {
    expect(available(newProgress(), C12)).toBe(12);
    expect(levelPoints(C12, 1)).toBe(12);
  });
  test('each level above 1 adds its 3: level 3 holds 12 + 6', () => {
    expect(levelPoints(C12, 3)).toBe(18);
    expect(gainXp(newProgress(), 500, C12)).toMatchObject({ to: 3, points: 6 });
  });
  test('losing every level keeps the creation points: 12 spent at level 3, back at level 1, nothing is owed', () => {
    const spent = put(gainXp(newProgress(), 500, C12).progress, 12, C12)!;
    const lost = gainXp(spent, -500, C12).progress;
    expect(lost.level).toBe(1);
    expect(available(lost, C12)).toBe(0);
    expect(available(gainXp(lost, 500, C12).progress, C12)).toBe(6);
  });
  test('the GM sets the points shown with the creation points counted', () => {
    expect(available(setPoints(newProgress(), 5, C12), C12)).toBe(5);
  });
});

describe('the GM sets a level and XP', () => {
  test('a higher level brings the points of that level and moves the peak, as XP would', () => {
    // Level 5 holds 4 x 3 = 12 points.
    const r = setLevel(at({ level: 3, xp: 200, peakLevel: 3 }), 5, 50, R);
    expect(r.progress).toEqual({ level: 5, xp: 50, peakLevel: 5, bonusPoints: 0, spent: 0, pending: {} });
    expect(r).toMatchObject({ from: 3, to: 5, points: 6 });
  });

  test('XP is kept inside the level: level 2 holds at most 199', () => {
    expect(setLevel(at({ level: 2, peakLevel: 2 }), 2, 999, R).progress).toMatchObject({ level: 2, xp: 199 });
    expect(setLevel(at({ level: 2, peakLevel: 2 }), 2, -5, R).progress).toMatchObject({ level: 2, xp: 0 });
  });

  test('a lower level keeps the peak', () => {
    expect(setLevel(at({ level: 4, peakLevel: 4 }), 1, 0, R).progress).toMatchObject({ level: 1, peakLevel: 4 });
  });

  test('a level beyond MAX_LEVEL or below 1 stops at the bound', () => {
    expect(setLevel(newProgress(), 1e9, 0, R).progress.level).toBe(MAX_LEVEL);
    expect(setLevel(at({ level: 3, peakLevel: 3 }), -2, 0, R).progress.level).toBe(1);
  });
});

describe('every short sequence keeps the rules', () => {
  // Each step is an XP change or spending every free point. The test tracks the highest level reached itself and
  // checks the result against the rule: XP inside the level, the peak is the highest level held, a refill exactly
  // when a level above the old peak is reached, and points free = max(0, 3 per level above 1 - spent).
  type Step = { label: string; run: (p: Progress) => { progress: Progress; refill: boolean } };
  const xp = (n: number): Step => ({ label: `${n > 0 ? '+' : ''}${n} XP`, run: p => gainXp(p, n, R) });
  const spendAll: Step = { label: 'spend all', run: p => ({ progress: put(p, available(p, R)) ?? p, refill: false }) };
  const steps = [xp(500), xp(-500), xp(150), xp(-80), spendAll];
  const walks: Step[][] = [[]];
  for (let n = 0; n < 5; n++) for (const w of walks.filter(w => w.length === n)) for (const s of steps) walks.push([...w, s]);

  test(`${walks.length} walks of up to 5 steps`, () => {
    const bad: string[] = [];
    for (const walk of walks) {
      let p = newProgress(), peak = 1;
      for (const step of walk) {
        const r = step.run(p);
        const want = r.progress.level > peak;
        peak = Math.max(peak, r.progress.level);
        p = r.progress;
        const free = Math.max(0, 3 * (p.level - 1) - p.spent);
        const ok = p.xp >= 0 && p.xp < 100 * p.level && p.peakLevel === peak && r.refill === want && available(p, R) === free;
        if (!ok) { bad.push(`${walk.map(s => s.label).join(', ')}: ${JSON.stringify(p)} refill ${r.refill}`); break; }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('the allocation: points put on stats, pending until Confirm', () => {
  // A level 3 hunter under `R`: 6 points free, every stat 10.
  const fresh = (): Allocating => ({ ...at({ level: 3, peakLevel: 3 }), stats: { ...BASE } });
  const ok = <T extends object>(v: T): Exclude<T, Refused> => { if (isRefused(v)) throw new Error(`refused: ${v.why}`); return v as Exclude<T, Refused>; };

  test('+ puts a free point on the stat, pending: the sheet shows it, the points free drop by one, nothing is spent yet', () => {
    const h = ok(raise(fresh(), 'str', 'player', R));
    expect(h.pending).toEqual({ str: 1 });
    expect(allocated(h).str).toBe(11);
    expect(h.stats.str).toBe(10);
    expect(available(h, R)).toBe(5);
    expect(h.spent).toBe(0);
  });

  test('the owner\'s bug: + then − before Confirm gives the point back, on a player\'s phone and on the GM\'s', () => {
    for (const role of ['player', 'gm'] as const) {
      const h = fresh();
      const back = ok(lower(ok(raise(h, 'agi', role, R)), 'agi', role));
      expect(back).toEqual(h);
      expect(available(back, R)).toBe(6);
    }
  });

  test('Confirm moves the pending points into the stats and into spent, and the points free do not change', () => {
    const h = ok(raiseMany(fresh(), { str: 2, vit: 1 }, R));
    const done = confirm(h);
    expect(done.stats).toMatchObject({ str: 12, vit: 11 });
    expect(done.pending).toEqual({});
    expect(done.spent).toBe(3);
    expect(available(done, R)).toBe(available(h, R));
    expect(hasPending(h)).toBe(true);
    expect(hasPending(done)).toBe(false);
  });

  test('after Confirm a player\'s − is refused on every stat; with no point free a player\'s + is refused', () => {
    const done = confirm(ok(raise(fresh(), 'str', 'player', R)));
    for (const k of STAT_KEYS) expect(lower(done, k, 'player')).toEqual({ ok: false, why: 'confirmed' });
    const broke = ok(raiseMany(fresh(), { pow: 6 }, R));
    expect(raise(broke, 'str', 'player', R)).toEqual({ ok: false, why: 'no-points' });
  });

  test('the GM with no point free edits the stat itself: + and − change the stat and confirm it, and no point is made or lost', () => {
    const broke = ok(raiseMany(fresh(), { str: 2, pow: 4 }, R));
    const up = ok(raise(broke, 'str', 'gm', R));
    expect(allocated(up).str).toBe(13);
    expect(up.pending).toEqual({ pow: 4 });
    expect(up.stats.str).toBe(13);
    expect(available(up, R)).toBe(0);
    const down = ok(lower(up, 'str', 'gm'));
    expect(allocated(down)).toEqual(allocated(broke));
    expect(available(down, R)).toBe(0);
  });

  test('the GM\'s − stops at the lowest stat, and the GM\'s edit to a number confirms that stat', () => {
    const h = setStat(fresh(), 'str', STAT_MIN);
    expect(h.stats.str).toBe(STAT_MIN);
    expect(lower(h, 'str', 'gm')).toEqual({ ok: false, why: 'at-min' });
    expect(setStat(fresh(), 'str', -4).stats.str).toBe(STAT_MIN);
    const pendingOnStr = ok(raiseMany(fresh(), { str: 2 }, R));
    const edited = setStat(pendingOnStr, 'str', 15);
    expect(edited).toMatchObject({ stats: { str: 15 }, pending: {}, spent: 2 });
    expect(available(edited, R)).toBe(available(pendingOnStr, R));
  });

  test('Auto puts its whole plan on the stats, pending, or nothing when the plan holds more than is free', () => {
    expect(ok(raiseMany(fresh(), { str: 4, agi: 2 }, R)).pending).toEqual({ str: 4, agi: 2 });
    expect(raiseMany(fresh(), { str: 7 }, R)).toEqual({ ok: false, why: 'no-points' });
    expect(raiseMany(fresh(), {}, R)).toEqual({ ok: false, why: 'no-points' });
  });

  test('starting stats are set and confirmed, the points untouched', () => {
    const h = startingStats(ok(raise(fresh(), 'str', 'player', R)), { vit: 18, str: 14 });
    expect(h.stats).toMatchObject({ vit: 18, str: 14, agi: 10 });
    expect(h.pending).toEqual({});
    expect(available(h, R)).toBe(6);
  });

  test('the points held count what is pending: the GM\'s set points and a deduction see the pending points', () => {
    const h = ok(raiseMany(fresh(), { str: 2 }, R));
    expect(available(setPoints(h, 9, R), R)).toBe(9);
    expect(available(grantPoints(h, -10, R), R)).toBe(0);
  });

  test('a random walk of +, −, Auto and Confirm on either phone keeps every rule of the allocation', () => {
    // Deterministic: a fixed seed, so a failure names a walk that can be replayed.
    let seed = 7;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const bad: string[] = [];
    for (let walk = 0; walk < 300; walk++) {
      const role = walk % 2 ? 'gm' : 'player';
      let h: Allocating = { ...at({ level: 1 + rand(4), peakLevel: 4, bonusPoints: rand(3) }), stats: { ...BASE } };
      const held = levelPoints(R, h.level) + h.bonusPoints;
      const trail: string[] = [];
      for (let i = 0; i < 40; i++) {
        const k = STAT_KEYS[rand(STAT_KEYS.length)]!, move = rand(4);
        const before = h;
        const next = move === 0 ? raise(h, k, role, R) : move === 1 ? lower(h, k, role) : move === 2 ? confirm(h) : raiseMany(h, { [k]: 1 + rand(2) }, R);
        trail.push(`${['+', '-', 'confirm', 'auto'][move]}${move === 2 ? '' : ' ' + k}`);
        if (!isRefused(next)) h = next;
        const fail = (why: string) => bad.push(`${role} walk ${walk} (${trail.join(', ')}): ${why}`);
        if (available(h, R) + h.spent + pendingTotal(h) !== held) { fail('points held changed'); break; }
        if (Object.values(h.pending).some(n => !Number.isInteger(n) || n! < 1)) { fail(`pending ${JSON.stringify(h.pending)}`); break; }
        if (role === 'player' && move !== 2 && STAT_KEYS.some(s => h.stats[s] !== before.stats[s])) { fail('a player changed a confirmed stat without Confirm'); break; }
        if (STAT_KEYS.some(s => allocated(h)[s] < Math.min(STAT_MIN, BASE[s]))) { fail('a stat under the lowest'); break; }
        const up = raise(h, k, role, R);
        if (!isRefused(up)) {
          const back = lower(up, k, role);
          const exact = role === 'player' || available(h, R) >= 1;
          if (isRefused(back)) { fail('− refused right after +'); break; }
          if (exact ? JSON.stringify(back) !== JSON.stringify(h) : JSON.stringify(allocated(back)) !== JSON.stringify(allocated(h)) || available(back, R) !== available(h, R)) { fail('+ then − did not give back the hunter'); break; }
        }
        if (role === 'player' && STAT_KEYS.some(s => !isRefused(lower(confirm(h), s, role)))) { fail('− after Confirm changed something'); break; }
      }
    }
    expect(bad).toEqual([]);
  });

  test('the allocation functions never change their input', () => {
    const h = ok(raiseMany(fresh(), { str: 1 }, R)), before = copy(h);
    raise(h, 'str', 'player', R); raise(h, 'agi', 'gm', R); lower(h, 'str', 'player'); lower(h, 'agi', 'gm'); confirm(h); setStat(h, 'str', 3); raiseMany(h, { vit: 2 }, R); startingStats(h, { str: 1 });
    expect(h).toEqual(before);
  });
});

describe('the GM\'s give and take back of XP, points and levels', () => {
  test('round trip: XP given then taken back gives back the level and the XP; the peak stays, so the level is not paid twice', () => {
    const p = at({ level: 2, peakLevel: 2, xp: 50, bonusPoints: 1, spent: 2 });
    const back = addXp(addXp(p, 400, R), -400, R);
    expect({ ...back, peakLevel: p.peakLevel }).toEqual(p);
    expect(back.peakLevel).toBe(gainXp(p, 400, R).to);
  });
  test('round trip: points given then taken back is where it started, while the points free cover the deduction', () => {
    const p = at({ level: 3, peakLevel: 3, bonusPoints: 1, spent: 2 });
    expect(grantPoints(grantPoints(p, 4, R), -4, R)).toEqual(p);
    expect(setPoints(setPoints(p, 9, R), available(p, R), R)).toEqual(p);
  });
  test('round trip: the GM\'s level set up then back down gives back the level and XP; the peak stays', () => {
    const p = at({ level: 2, peakLevel: 2, xp: 30 });
    const back = atLevel(atLevel(p, 6, 0, R), 2, 30, R);
    expect({ ...back, peakLevel: 2 }).toEqual(p);
    expect(back.peakLevel).toBe(6);
  });
});
