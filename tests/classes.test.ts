import { describe, expect, test } from 'bun:test';
import { RULES, rulesOf } from '../src/core/rules.ts';
import { freshSave } from '../src/core/save.ts';
import { parseClassNodeId, parseSheetKey } from '../src/core/ids.ts';
import type { ClassNodeId, SheetKey } from '../src/core/ids.ts';
import { isRefused } from '../src/core/save-step.ts';
import { addGold } from '../src/core/hunter/inventory.ts';
import { finishQuest, grant, sheetEdit } from '../src/core/hunter/grant.ts';
import { newRewards } from '../src/core/rewards.ts';
import { issueQuest } from '../src/core/hunter/quests.ts';
import { setRank } from '../src/core/hunter/record.ts';
import { SHEET_MAX } from '../src/core/protocol.ts';
import { CLASS_LOCKER_CAP } from '../src/core/registry/class-trees.ts';
import {
  CLASS_REFUSAL_WORDS,
  backedRemoteHunter,
  buyClassNode,
  dropClass,
  earnClass,
  flipClassFork,
  forkFlipCost,
  nodeCost,
  parkClass,
  pushedClasses,
  setJob,
  swapClass,
  swapCost,
} from '../src/core/hunter/classes.ts';
import { buildSyntheticTree } from './class-trees.test.ts';
import { day, dev, qid, room } from './fixtures/ids.ts';

const AT = '2026-11-25T12:00:00.000Z';
const env = { now: new Date(AT), newDeviceToken: () => 'tok-0123456789abcdef0123456789ab', newDeviceId: () => dev('d-test') };
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;
const STAMP = { device: 'd-test', now: Date.parse(AT), rand: 0.42 };

function makeSave(opts?: { rank?: 'E' | 'D' | 'C' | 'B' | 'A' | 'S'; gold?: number; fought?: boolean }) {
  let s = freshSave(env, { onboarded: true });
  let h = s.hunters[0]!;
  if (opts?.rank && opts.rank !== 'E') h = setRank(h, opts.rank);
  if (opts?.gold) h = addGold(h, opts.gold);
  if (opts?.fought) h = { ...h, chronicle: { ...h.chronicle, tally: { ...h.chronicle.tally, fights: 1 } } };
  return { ...s, hunters: [h] };
}

describe('pricing tables and free rules', () => {
  test('swap fees match 0.25x priceBase across E through S, and follow all free cases', () => {
    const expected = { E: 25, D: 81, C: 313, B: 1250, A: 4750, S: 18750 } as const;
    for (const [rank, want] of Object.entries(expected) as [keyof typeof expected, number][]) {
      const h = makeSave({ rank, fought: true }).hunters[0]!;
      expect(swapCost(h, 'player', RULES)).toEqual({ cost: want, freeWhy: null });
      expect(forkFlipCost(h, 'player', RULES)).toEqual({ cost: want, freeWhy: null });
    }
    const unfought = makeSave({ rank: 'S', fought: false }).hunters[0]!;
    expect(swapCost(unfought, 'player', RULES)).toEqual({ cost: 0, freeWhy: 'before-first-fight' });
    expect(forkFlipCost(unfought, 'player', RULES)).toEqual({ cost: 0, freeWhy: 'before-first-fight' });

    const fought = makeSave({ rank: 'S', fought: true }).hunters[0]!;
    expect(swapCost(fought, 'gm', RULES)).toEqual({ cost: 0, freeWhy: 'gm' });
    expect(swapCost(fought, 'player', rulesOf({ classSwapPrices: 0 }))).toEqual({ cost: 0, freeWhy: 'rules' });
  });

  test('tree node pricing totals match settled.md at S rank and are never free before first fight', () => {
    const common = buildSyntheticTree('Fighter', 'common');
    const rare = buildSyntheticTree('Berserker', 'rare');
    const epic = buildSyntheticTree('Chronokeeper', 'epic');
    const mythic = buildSyntheticTree('Hemomancer', 'mythic');
    const trees = { Fighter: common, Berserker: rare, Chronokeeper: epic, Hemomancer: mythic };
    const hS = makeSave({ rank: 'S', fought: false }).hunters[0]!;

    const buyableTotal = (cls: keyof typeof trees) => {
      const t = trees[cls];
      const seenFork = new Set<string>();
      let sum = 0;
      for (const n of t.nodes) {
        if (n.forkGroup) {
          if (seenFork.has(n.forkGroup)) continue;
          seenFork.add(n.forkGroup);
        }
        const c = nodeCost(hS, cls, n.id, 'player', RULES, trees);
        if (isRefused(c)) throw new Error(c.why);
        sum += c.cost;
      }
      return sum;
    };

    expect(buyableTotal('Fighter')).toBe(208_125);
    expect(buyableTotal('Berserker')).toBe(813_750);
    expect(buyableTotal('Chronokeeper')).toBe(2_295_000);
    expect(buyableTotal('Hemomancer')).toBe(10_140_000);

    // Specific Mythic S-rank anchor nodes (D1, D8, D9) — never free before first fight!
    expect(nodeCost(hS, 'Hemomancer', nid('root'), 'player', RULES, trees)).toEqual({ cost: 45_000, freeWhy: null });
    expect(nodeCost(hS, 'Hemomancer', nid('a8'), 'player', RULES, trees)).toEqual({ cost: 750_000, freeWhy: null });
    expect(nodeCost(hS, 'Hemomancer', nid('cap'), 'player', RULES, trees)).toEqual({ cost: 1_050_000, freeWhy: null });

    // Free on GM phone or when rule multipliers are 0
    expect(nodeCost(hS, 'Hemomancer', nid('cap'), 'gm', RULES, trees)).toEqual({ cost: 0, freeWhy: 'gm' });
    expect(nodeCost(hS, 'Hemomancer', nid('cap'), 'player', rulesOf({ classTreeRarityMult: { mythic: 0 } }), trees)).toEqual({ cost: 0, freeWhy: 'rules' });
  });
});

describe('setJob, earnClass, swapClass, buyClassNode, flipClassFork, pushedClasses', () => {
  const mythic = buildSyntheticTree('Hemomancer', 'mythic');
  const common = buildSyntheticTree('Fighter', 'common');
  const trees = { Hemomancer: mythic, Fighter: common };

  test('setJob refuses all 18 unique names, Shadow Monarch alias, unearned Rare names, earned non-active classes, held, and dead hunters', () => {
    const h = makeSave().hunters[0]!;
    const free = { held: false, dead: false };
    expect(setJob(h, 'Fighter', { held: true, dead: false })).toEqual({ ok: false, why: 'held' });
    expect(setJob(h, 'Fighter', { held: false, dead: true })).toEqual({ ok: false, why: 'dead' });
    expect(setJob(h, 'Necromancer', free)).toEqual({ ok: false, why: 'unique-class' });
    expect(setJob(h, 'Shadow Monarch', free)).toEqual({ ok: false, why: 'unique-class' });
    expect(setJob(h, '  shadow   monarch  ', free)).toEqual({ ok: false, why: 'unique-class' });
    expect(setJob(h, '  hemomancer  ', free)).toEqual({ ok: false, why: 'unique-class' });
    expect(setJob(h, 'CHRONOKEEPER', free)).toEqual({ ok: false, why: 'unique-class' });
    // Unearned Rare built-in classes are refused so free text never grants their keystone stat pair
    expect(setJob(h, 'Berserker', free)).toEqual({ ok: false, why: 'not-earned' });
    expect(setJob(h, 'Pyromancer', free)).toEqual({ ok: false, why: 'not-earned' });

    const ok = setJob(h, 'Fighter', free);
    expect(isRefused(ok)).toBe(false);
    if (!isRefused(ok)) {
      expect(ok.job).toBe('Fighter');
      expect(ok.jobDone).toBeNull();
    }
    const custom = setJob(h, 'Rune Chef', free);
    expect(isRefused(custom)).toBe(false);

    // Earned non-active class must go through swapClass, never free-text setJob
    const withTwo1 = earnClass(h, 'Fighter', { at: AT, R: RULES });
    if (isRefused(withTwo1)) throw new Error(withTwo1.why);
    const withTwo2 = earnClass(withTwo1, 'Mage', { at: AT, R: RULES });
    if (isRefused(withTwo2)) throw new Error(withTwo2.why);
    expect(setJob(withTwo2, 'Fighter', free)).toEqual({ ok: false, why: 'earned-class' });
    // Re-typing the already active earned class is a safe no-op that preserves jobDone
    const same = setJob(withTwo2, 'Mage', free);
    expect(same).toBe(withTwo2);
  });

  test('parkClass preserves bought nodes while clearing active pointer, and swapClass refuses foreign-registry uniques', () => {
    let s = makeSave({ rank: 'E', gold: 5000, fought: true });
    const e1 = earnClass(s.hunters[0]!, 'Fighter', { at: AT, R: RULES });
    if (isRefused(e1)) throw new Error(e1.why);
    const e2 = earnClass(e1, 'Hemomancer', { at: AT, registryId: 'reg-home', grantId: 'cg1', R: RULES });
    if (isRefused(e2)) throw new Error(e2.why);
    const withNode = {
      ...e2,
      classes: { ...e2.classes, Hemomancer: { ...e2.classes.Hemomancer!, nodes: [nid('root')] } },
    };

    const parked = parkClass(withNode, 'Hemomancer', RULES);
    expect(parked.job).toBeNull();
    expect(parked.jobDone).toBeNull();
    expect(parked.classes.Hemomancer).toEqual({ unlockedAt: AT, nodes: [nid('root')], registryId: 'reg-home', grantId: 'cg1' });

    s = { ...s, hunters: [parked] };
    // In a different room (reg-guest), swapping into foreign unique Hemomancer is refused
    expect(
      swapClass(s, parked.id, 'Hemomancer', {
        role: 'player',
        held: false,
        at: AT,
        room: null,
        stamp: null,
        activeRegistryId: 'reg-guest',
        R: RULES,
      }),
    ).toEqual({ ok: false, why: 'foreign-class' });

    // Non-unique Fighter can still be swapped into freely in reg-guest
    const okFighter = swapClass(s, parked.id, 'Fighter', {
      role: 'player',
      held: false,
      at: AT,
      room: null,
      stamp: null,
      activeRegistryId: 'reg-guest',
      R: RULES,
    });
    expect(isRefused(okFighter)).toBe(false);

    // Back in reg-home, Hemomancer can be swapped back into with nodes intact
    const okHome = swapClass(s, parked.id, 'Hemomancer', {
      role: 'player',
      held: false,
      at: AT,
      room: null,
      stamp: null,
      activeRegistryId: 'reg-home',
      R: RULES,
    });
    expect(isRefused(okHome)).toBe(false);
    if (!isRefused(okHome)) expect(okHome.save.hunters[0]!.classes.Hemomancer?.nodes).toEqual([nid('root')]);
  });

  test('swapClass deducts carried gold, preserves nodes across swaps, posts room event, and refuses dead/held/gold', () => {
    let s = makeSave({ rank: 'C', gold: 500, fought: true });
    let h = s.hunters[0]!;
    const e1 = earnClass(h, 'Fighter', { at: AT, R: RULES });
    if (isRefused(e1)) throw new Error(e1.why);
    const e2 = earnClass(e1, 'Hemomancer', { at: AT, R: RULES });
    if (isRefused(e2)) throw new Error(e2.why);
    s = { ...s, hunters: [e2] };

    // Mid-fight swap refused
    expect(swapClass(s, h.id, 'Fighter', { role: 'player', held: true, at: AT, room: null, stamp: null, activeRegistryId: null, R: RULES })).toEqual({ ok: false, why: 'held' });
    // Un-earned class refused
    expect(swapClass(s, h.id, 'Mage', { role: 'player', held: false, at: AT, room: null, stamp: null, activeRegistryId: null, R: RULES })).toEqual({ ok: false, why: 'not-earned' });
    // Same active class refused
    expect(swapClass(s, h.id, 'Hemomancer', { role: 'player', held: false, at: AT, room: null, stamp: null, activeRegistryId: null, R: RULES })).toEqual({ ok: false, why: 'same-class' });

    // Valid swap at C costs 313 gold, posts sealed classSwap event in a room
    const r = swapClass(s, h.id, 'Fighter', { role: 'player', held: false, at: AT, room: room('ABC234'), stamp: STAMP, activeRegistryId: null, R: RULES });
    if (isRefused(r)) throw new Error(r.why);
    expect(r.cost).toBe(313);
    expect(r.save.hunters[0]!.job).toBe('Fighter');
    expect(r.save.hunters[0]!.gold).toBe(187);
    expect(r.save.settings.sync.outbox?.some(i => i.letter.kind === 'event' && i.letter.event.type === 'classSwap')).toBe(true);

    // Insufficient carried gold refused (187 < 313), never borrowed
    expect(swapClass(r.save, h.id, 'Hemomancer', { role: 'player', held: false, at: AT, room: null, stamp: null, activeRegistryId: null, R: RULES })).toEqual({ ok: false, why: 'gold' });

    // Dead hunter refused
    const dead = sheetEdit(r.save.hunters[0]!, { type: 'life', event: { type: 'damage', amount: 9999 } }, RULES);
    if (isRefused(dead)) throw new Error(dead.why);
    const deadSave = { ...r.save, hunters: [addGold(dead, 10_000)] };
    expect(swapClass(deadSave, h.id, 'Hemomancer', { role: 'player', held: false, at: AT, room: null, stamp: null, activeRegistryId: null, R: RULES })).toEqual({ ok: false, why: 'dead' });
  });

  test('buyClassNode and flipClassFork preserve convergence nodes, drop exclusive dependents, and refuse custom no-tree jobs', () => {
    let s = makeSave({ rank: 'E', gold: 50_000, fought: true });
    const earned = earnClass(s.hunters[0]!, 'Hemomancer', { at: AT, R: RULES });
    if (isRefused(earned)) throw new Error(earned.why);
    s = { ...s, hunters: [earned] };
    const hid = s.hunters[0]!.id;
    const ctx = { role: 'player' as const, held: false, at: AT, room: room('ABC234'), stamp: STAMP, activeRegistryId: null, R: RULES, trees };

    // Mid-fight buy refused
    expect(buyClassNode(s, hid, nid('root'), { ...ctx, held: true })).toEqual({ ok: false, why: 'held' });

    // Buy down branch A past D5 fork into D6 convergence
    let seq = 1;
    for (const id of ['root', 'a2', 'a3x', 'a3y', 'a4x', 'a4y', 'a5-l', 'a6x']) {
      const b = buyClassNode(s, hid, nid(id), { ...ctx, stamp: { ...STAMP, seq: seq++ } });
      if (isRefused(b)) throw new Error(`buy ${id} failed: ${b.why}`);
      s = b.save;
    }
    expect(s.hunters[0]!.classes.Hemomancer!.nodes).toEqual(['root', 'a2', 'a3x', 'a3y', 'a4x', 'a4y', 'a5-l', 'a6x'].map(nid));
    // Twin is locked
    expect(buyClassNode(s, hid, nid('a5-r'), { ...ctx, stamp: { ...STAMP, seq: seq++ } })).toEqual({ ok: false, why: 'fork-taken' });

    // Flip fork outside combat for swap fee (E = 25), no refund, preserves a6x convergence node
    const goldBeforeFlip = s.hunters[0]!.gold;
    const flipped = flipClassFork(s, hid, nid('a5-l'), nid('a5-r'), { ...ctx, stamp: { ...STAMP, seq: seq++ } });
    if (isRefused(flipped)) throw new Error(flipped.why);
    expect(flipped.cost).toBe(25);
    expect(flipped.dropped).toEqual([]);
    expect(flipped.save.hunters[0]!.gold).toBe(goldBeforeFlip - 25);
    expect(flipped.save.hunters[0]!.classes.Hemomancer!.nodes).toEqual(['root', 'a2', 'a3x', 'a3y', 'a4x', 'a4y', 'a5-r', 'a6x'].map(nid));

    // Swap away and back keeps tree progress intact
    const withF = earnClass(flipped.save.hunters[0]!, 'Fighter', { at: AT, R: RULES });
    if (isRefused(withF)) throw new Error(withF.why);
    const back = swapClass({ ...flipped.save, hunters: [withF] }, hid, 'Hemomancer', { ...ctx, stamp: { ...STAMP, seq: seq++ } });
    if (isRefused(back)) throw new Error(back.why);
    expect(back.save.hunters[0]!.classes.Hemomancer!.nodes).toEqual(['root', 'a2', 'a3x', 'a3y', 'a4x', 'a4y', 'a5-r', 'a6x'].map(nid));

    // Custom GM job with no tree refuses no-tree
    const withCustom = earnClass(back.save.hunters[0]!, 'Baker', { at: AT, R: RULES });
    if (isRefused(withCustom)) throw new Error(withCustom.why);
    expect(buyClassNode({ ...back.save, hunters: [withCustom] }, hid, nid('root'), ctx)).toEqual({ ok: false, why: 'no-tree' });
  });

  test('earnClass enforces CLASS_LOCKER_CAP (48) and dropClass removes entry with no refund', () => {
    let h = makeSave().hunters[0]!;
    for (let i = 0; i < CLASS_LOCKER_CAP; i++) {
      const next = earnClass(h, `Custom${i}`, { at: AT, R: RULES });
      if (isRefused(next)) throw new Error(next.why);
      h = next;
    }
    expect(earnClass(h, 'OverflowClass', { at: AT, R: RULES })).toEqual({ ok: false, why: 'locker-full' });
    const dropped = dropClass(h, 'Custom47', RULES);
    expect(dropped.job).toBeNull();
    expect(dropped.jobDone).toBeNull();
    expect(Object.keys(dropped.classes)).toHaveLength(CLASS_LOCKER_CAP - 1);
  });

  test('pushedClasses trims a full 48-class locker to active class only and stays well under SHEET_MAX', () => {
    let h = makeSave().hunters[0]!;
    const bigClasses: Record<string, { unlockedAt: string; nodes: ClassNodeId[] }> = {};
    for (let i = 0; i < CLASS_LOCKER_CAP; i++) {
      bigClasses[`Class${i}`] = {
        unlockedAt: AT,
        nodes: Array.from({ length: 32 }, (_, j) => nid(`c${i}-long-node-slug-${j}`)),
      };
    }
    const full = { ...h, job: 'Class0', jobDone: 'Class0', classes: bigClasses };
    const trimmed = pushedClasses(full);
    expect(Object.keys(trimmed.classes)).toEqual(['Class0']);
    expect(new TextEncoder().encode(JSON.stringify({ hunter: trimmed })).length).toBeLessThan(SHEET_MAX);
  });

  test('CLASS_REFUSAL_WORDS follow voice.md rules', () => {
    for (const s of Object.values(CLASS_REFUSAL_WORDS)) {
      expect(s).not.toMatch(/[—;]/);
      expect(s).not.toMatch(/\bjust\b/i);
    }
  });

  test('grant and finishQuest null out refused unique or earned reward jobs instead of announcing them granted', () => {
    let s = makeSave();
    const h = s.hunters[0]!;
    const badReward = { ...newRewards(), xp: 50, job: 'Necromancer' };
    const g = grant(s, h.id, badReward, { at: AT, today: day('2026-11-25'), R: RULES, vitals: 'sheet' });
    if (isRefused(g)) throw new Error(g.why);
    expect(g.job).toBeNull();
    expect(g.lines.some(l => l.includes('Necromancer'))).toBe(false);
    expect(g.save.hunters[0]!.job).toBeNull();

    // Job quest whose reward names a unique class finishes without announcing "JOB CHANGE COMPLETE"
    const issued = issueQuest(h, {
      kind: 'job',
      title: 'Rise of Shadows',
      desc: '',
      objectives: [{ label: 'Trial', target: 1, progress: 1 }],
      rewards: badReward,
      onFail: newRewards(),
      dueAt: null,
      from: 'gm',
      penaltyText: '',
      secret: false,
    }, qid('q900'), AT);
    const qSave = { ...s, hunters: [issued.hunter] };
    const fin = finishQuest(qSave, h.id, qid('q900'), { at: AT, today: day('2026-11-25'), R: RULES, vitals: 'sheet' });
    if (isRefused(fin)) throw new Error(fin.why);
    expect(fin.job).toBeNull();
    expect(fin.granted.job).toBeNull();
    expect(fin.granted.lines.some(l => l.includes('Necromancer'))).toBe(false);
  });

  test('grant tells the player when a job reward is not taken because a fight holds them or they are down', () => {
    const s = makeSave();
    const h = s.hunters[0]!;
    const r = { ...newRewards(), xp: 5, job: 'Fighter' };
    const held = grant(s, h.id, r, { at: AT, today: day('2026-11-25'), R: RULES, vitals: 'fight' });
    if (isRefused(held)) throw new Error(held.why);
    expect(held.job).toBeNull();
    expect(held.lines).toContain('Job not taken: Fighter (you are in a fight)');
    const downSave = { ...s, hunters: s.hunters.map(x => (x.id === h.id ? { ...x, life: { at: 'dead' as const } } : x)) };
    const down = grant(downSave, h.id, r, { at: AT, today: day('2026-11-25'), R: RULES, vitals: 'sheet' });
    if (isRefused(down)) throw new Error(down.why);
    expect(down.job).toBeNull();
    expect(down.lines).toContain('Job not taken: Fighter (you are down)');
    const free = grant(s, h.id, r, { at: AT, today: day('2026-11-25'), R: RULES, vitals: 'sheet' });
    if (isRefused(free)) throw new Error(free.why);
    expect(free.lines.some(l => l.startsWith('Job not taken'))).toBe(false);
  });

  test('backedRemoteHunter strips spoofed unique classes from pushed sheets while keeping GM-backed claims', () => {
    const k1 = parseSheetKey('d-pl1:h1') as SheetKey;
    const k2 = parseSheetKey('d-pl2:h1') as SheetKey;
    const h = makeSave().hunters[0]!;
    const spoofed = earnClass(h, 'Necromancer', { at: AT, registryId: 'reg-1', grantId: 'cg1', R: RULES });
    if (isRefused(spoofed)) throw new Error(spoofed.why);
    const holders = {
      registryId: 'reg-1',
      held: { Necromancer: { kind: 'remote' as const, sheetKey: k1, name: 'Jin', grantId: 'cg1', claimedAt: AT } },
    };

    // Backed holder k1 keeps Necromancer untouched
    expect(backedRemoteHunter(spoofed, k1, holders)).toBe(spoofed);
    // Unbacked phone k2 has Necromancer stripped from classes and job cleared
    const stripped = backedRemoteHunter(spoofed, k2, holders);
    expect(stripped.job).toBeNull();
    expect(stripped.jobDone).toBeNull();
    expect(stripped.classes.Necromancer).toBeUndefined();

    // Unbacked Necromancer label (even with no classes entry) is always stripped
    const unbackedLabel = { ...h, job: 'Necromancer', jobDone: null, classes: {} };
    expect(backedRemoteHunter(unbackedLabel, k2, { registryId: 'reg-1', held: {} }).job).toBeNull();
  });
});
