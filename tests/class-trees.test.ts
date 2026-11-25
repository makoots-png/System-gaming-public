import { describe, expect, test } from 'bun:test';
import { parseClassNodeId, CLASS_NODE_ID_MAX } from '../src/core/ids.ts';
import type { ClassNodeId } from '../src/core/ids.ts';
import {
  CLASS_LOCKER_CAP,
  CLASS_TREE_NODE_CAP,
  TREE_SHAPE,
  canBuyNode,
  canFlipFork,
  capstoneUnlocked,
  forkTwinOf,
  repairNodes,
  validateTree,
} from '../src/core/registry/class-trees.ts';
import { activeClass, parseClasses } from '../src/core/hunter/class-locker.ts';
import type { ClassNodeDef, ClassTree, TreeDepth } from '../src/core/registry/class-trees.ts';
import type { ClassName, ClassRarity } from '../src/core/registry/jobs.ts';

const nid = (s: string): ClassNodeId => {
  const id = parseClassNodeId(s);
  if (!id) throw new Error(`bad test node id: ${s}`);
  return id;
};

const mk = (
  id: string,
  depth: TreeDepth,
  parents: string[],
  extra?: Partial<Pick<ClassNodeDef, 'parentMode' | 'forkGroup' | 'capstone'>>,
): ClassNodeDef => ({
  id: nid(id),
  depth,
  name: id,
  desc: `Node ${id}`,
  parents: parents.map(nid),
  gifts: [{ kind: 'bonus', bonus: { str: 1 } }],
  ...extra,
});

/** Builds a structurally valid synthetic tree matching TREE_SHAPE for any rarity. */
export function buildSyntheticTree(className: ClassName, rarity: ClassRarity): ClassTree {
  const nodes: ClassNodeDef[] = [mk('root', 1, [])];
  if (rarity === 'common') {
    // 1, 2, 4, 4, 1 = 12 total / 12 buyable
    for (const b of ['a', 'b']) {
      nodes.push(mk(`${b}2`, 2, ['root']));
      nodes.push(mk(`${b}3x`, 3, [`${b}2`]), mk(`${b}3y`, 3, [`${b}2`]));
      nodes.push(mk(`${b}4x`, 4, [`${b}3x`]), mk(`${b}4y`, 4, [`${b}3y`]));
    }
    nodes.push(mk('cap', 5, ['a4x', 'a4y', 'b4x', 'b4y'], { parentMode: 'any', capstone: true }));
  } else if (rarity === 'rare') {
    // 1, 2, 4, 4, 2 forks (4), 2, 1 = 18 total / 16 buyable
    for (const b of ['a', 'b']) {
      nodes.push(mk(`${b}2`, 2, ['root']));
      nodes.push(mk(`${b}3x`, 3, [`${b}2`]), mk(`${b}3y`, 3, [`${b}2`]));
      nodes.push(mk(`${b}4x`, 4, [`${b}3x`]), mk(`${b}4y`, 4, [`${b}3y`]));
      nodes.push(
        mk(`${b}5-l`, 5, [`${b}4x`, `${b}4y`], { forkGroup: `${b}5` }),
        mk(`${b}5-r`, 5, [`${b}4x`, `${b}4y`], { forkGroup: `${b}5` }),
      );
      nodes.push(mk(`${b}6`, 6, [`${b}5-l`, `${b}5-r`], { parentMode: 'any' }));
    }
    nodes.push(mk('cap', 7, ['a6', 'b6'], { parentMode: 'any', capstone: true }));
  } else if (rarity === 'epic') {
    // 1, 3, 6, 6, 3 forks (6), 3, 1 = 26 total / 23 buyable
    for (const b of ['a', 'b', 'c']) {
      nodes.push(mk(`${b}2`, 2, ['root']));
      nodes.push(mk(`${b}3x`, 3, [`${b}2`]), mk(`${b}3y`, 3, [`${b}2`]));
      nodes.push(mk(`${b}4x`, 4, [`${b}3x`]), mk(`${b}4y`, 4, [`${b}3y`]));
      nodes.push(
        mk(`${b}5-l`, 5, [`${b}4x`, `${b}4y`], { forkGroup: `${b}5` }),
        mk(`${b}5-r`, 5, [`${b}4x`, `${b}4y`], { forkGroup: `${b}5` }),
      );
      nodes.push(mk(`${b}6`, 6, [`${b}5-l`, `${b}5-r`], { parentMode: 'any' }));
    }
    nodes.push(mk('cap', 7, ['a6', 'b6', 'c6'], { parentMode: 'any', capstone: true }));
  } else {
    // Mythic: 1, 3, 6, 6, 3 forks (6), 6, 3 forks (6), 3, 1 = 38 total / 32 buyable
    for (const b of ['a', 'b', 'c']) {
      nodes.push(mk(`${b}2`, 2, ['root']));
      nodes.push(mk(`${b}3x`, 3, [`${b}2`]), mk(`${b}3y`, 3, [`${b}2`]));
      nodes.push(mk(`${b}4x`, 4, [`${b}3x`]), mk(`${b}4y`, 4, [`${b}3y`]));
      nodes.push(
        mk(`${b}5-l`, 5, [`${b}4x`, `${b}4y`], { forkGroup: `${b}5` }),
        mk(`${b}5-r`, 5, [`${b}4x`, `${b}4y`], { forkGroup: `${b}5` }),
      );
      nodes.push(
        mk(`${b}6x`, 6, [`${b}5-l`, `${b}5-r`], { parentMode: 'any' }),
        mk(`${b}6y`, 6, [`${b}5-l`, `${b}5-r`], { parentMode: 'any' }),
      );
      nodes.push(
        mk(`${b}7-l`, 7, [`${b}6x`, `${b}6y`], { forkGroup: `${b}7` }),
        mk(`${b}7-r`, 7, [`${b}6x`, `${b}6y`], { forkGroup: `${b}7` }),
      );
      nodes.push(mk(`${b}8`, 8, [`${b}7-l`, `${b}7-r`], { parentMode: 'any' }));
    }
    nodes.push(mk('cap', 9, ['a8', 'b8', 'c8'], { parentMode: 'any', capstone: true }));
  }
  return { className, rarity, nodes };
}

describe('ClassNodeId and TREE_SHAPE', () => {
  test('parseClassNodeId enforces 1..32 lowercase slug characters', () => {
    expect(parseClassNodeId('crimson-root-1') as string | null).toBe('crimson-root-1');
    expect(parseClassNodeId('a'.repeat(CLASS_NODE_ID_MAX)) as string | null).toBe('a'.repeat(CLASS_NODE_ID_MAX));
    expect(parseClassNodeId('a'.repeat(CLASS_NODE_ID_MAX + 1))).toBeNull();
    expect(parseClassNodeId('')).toBeNull();
    expect(parseClassNodeId('UpperCase')).toBeNull();
    expect(parseClassNodeId('-leading-dash')).toBeNull();
    expect(parseClassNodeId('has space')).toBeNull();
  });

  test('TREE_SHAPE matches settled.md exact counts for all four rarities', () => {
    expect(TREE_SHAPE.common).toEqual({ depths: 5, branches: 2, buyable: 12, total: 12, forkDepths: [] });
    expect(TREE_SHAPE.rare).toEqual({ depths: 7, branches: 2, buyable: 16, total: 18, forkDepths: [5] });
    expect(TREE_SHAPE.epic).toEqual({ depths: 7, branches: 3, buyable: 23, total: 26, forkDepths: [5] });
    expect(TREE_SHAPE.mythic).toEqual({ depths: 9, branches: 3, buyable: 32, total: 38, forkDepths: [5, 7] });
  });

  test('validateTree accepts valid synthetic trees of all four rarities', () => {
    expect(validateTree(buildSyntheticTree('Fighter', 'common'))).toEqual([]);
    expect(validateTree(buildSyntheticTree('Berserker', 'rare'))).toEqual([]);
    expect(validateTree(buildSyntheticTree('Chronokeeper', 'epic'))).toEqual([]);
    expect(validateTree(buildSyntheticTree('Hemomancer', 'mythic'))).toEqual([]);
  });

  test('validateTree rejects broken topology, fork mismatches, and node cap overflow', () => {
    const mythic = buildSyntheticTree('Hemomancer', 'mythic');
    // Post-fork node with parentMode: 'all'
    const badConverge: ClassTree = {
      ...mythic,
      nodes: mythic.nodes.map(n => (n.id === 'a6x' ? { ...n, parentMode: 'all' } : n)),
    };
    expect(validateTree(badConverge).some(e => e.includes('parentMode'))).toBe(true);

    // Node cap overflow (> 64)
    const tooMany: ClassTree = {
      ...mythic,
      nodes: [
        ...mythic.nodes,
        ...Array.from({ length: CLASS_TREE_NODE_CAP }, (_, i) => mk(`extra-${i}`, 2, ['root'])),
      ],
    };
    expect(validateTree(tooMany).some(e => e.includes('exceeds cap'))).toBe(true);
  });
});

describe('canBuyNode, canFlipFork, capstoneUnlocked, repairNodes', () => {
  const mythic = buildSyntheticTree('Hemomancer', 'mythic');

  test('root buy, parallel branches, exclusive forks, post-fork convergence, and early capstone unlock', () => {
    expect(canBuyNode(mythic, [], nid('root')).ok).toBe(true);
    expect(canBuyNode(mythic, [], nid('a2'))).toEqual({ ok: false, why: 'locked' });
    expect(canBuyNode(mythic, [nid('root')], nid('root'))).toEqual({ ok: false, why: 'owned' });
    expect(canBuyNode(mythic, [], nid('nope'))).toEqual({ ok: false, why: 'unknown-node' });

    // Parallel branches a2, b2, c2 are all buyable once root is owned
    expect(canBuyNode(mythic, [nid('root'), nid('a2')], nid('b2')).ok).toBe(true);

    // Reaching D5 fork on branch A
    const beforeFork = ['root', 'a2', 'a3x', 'a3y', 'a4x', 'a4y'].map(nid);
    expect(canBuyNode(mythic, beforeFork, nid('a5-l')).ok).toBe(true);
    expect(forkTwinOf(mythic, nid('a5-l'))?.id).toBe(nid('a5-r'));

    // Buying left locks right
    const afterLeft = [...beforeFork, nid('a5-l')];
    expect(canBuyNode(mythic, afterLeft, nid('a5-r'))).toEqual({ ok: false, why: 'fork-taken' });
    // Post-fork D6 unlocks with either fork owned
    expect(canBuyNode(mythic, afterLeft, nid('a6x')).ok).toBe(true);

    // Finishing branch A down to D8 unlocks Capstone early (branches B and C untouched)
    const branchADone = [...afterLeft, 'a6x', 'a6y', 'a7-l', 'a8'].map(nid);
    expect(capstoneUnlocked(mythic, branchADone)).toBe(true);
    expect(canBuyNode(mythic, branchADone, nid('cap')).ok).toBe(true);
    // Still able to backfill branches B and C after buying Capstone
    expect(canBuyNode(mythic, [...branchADone, nid('cap')], nid('b2')).ok).toBe(true);
  });

  test('canFlipFork checks fork pair membership and ownership', () => {
    const owned = ['root', 'a2', 'a3x', 'a3y', 'a4x', 'a4y', 'a5-l'].map(nid);
    expect(canFlipFork(mythic, owned, nid('a5-l'), nid('a5-r')).ok).toBe(true);
    expect(canFlipFork(mythic, owned, nid('a5-r'), nid('a5-l'))).toEqual({ ok: false, why: 'not-owned' });
    expect(canFlipFork(mythic, owned, nid('a5-l'), nid('a7-l'))).toEqual({ ok: false, why: 'not-fork-pair' });
    expect(canFlipFork(mythic, owned, nid('a5-l'), nid('nope'))).toEqual({ ok: false, why: 'unknown-node' });
  });

  test('repairNodes deduplicates, resolves fork collisions (first wins), and drops orphans preserving purchase order', () => {
    // Out-of-order full valid set survives in original order
    const reversed = ['a8', 'a7-l', 'a6y', 'a6x', 'a5-l', 'a4y', 'a4x', 'a3y', 'a3x', 'a2', 'root'].map(nid);
    expect(repairNodes(mythic, reversed)).toEqual(reversed);

    // Missing a2 orphans everything below root
    const orphaned = reversed.filter(x => x !== nid('a2'));
    expect(repairNodes(mythic, orphaned)).toEqual([nid('root')]);

    // Both fork halves present: first wins, duplicates stripped
    const bothForks = ['root', 'a2', 'a3x', 'a3y', 'a4x', 'a4y', 'a5-r', 'a5-l', 'a5-r', 'a6x'].map(nid);
    expect(repairNodes(mythic, bothForks)).toEqual(['root', 'a2', 'a3x', 'a3y', 'a4x', 'a4y', 'a5-r', 'a6x'].map(nid));

    // Null tree (custom GM job) drops all nodes
    expect(repairNodes(null, [nid('root')])).toEqual([]);
  });
});

describe('parseClasses', () => {
  const mythic = buildSyntheticTree('Hemomancer', 'mythic');
  const trees = { Hemomancer: mythic };
  const AT = '2026-11-25T12:00:00.000Z';

  test('reads legacy 0-to-5 upgrades field as empty node list and never maps tiers', () => {
    const res = parseClasses(
      { Hemomancer: { unlockedAt: AT, upgrades: 5 } },
      { job: 'Hemomancer', jobDone: 'Hemomancer', fallbackAt: AT, trees },
    );
    expect(res.classes.Hemomancer).toEqual({ unlockedAt: AT, nodes: [] });
  });

  test('parseClasses clears un-held unique classes (gating legacy Necromancer/Shadow Monarch on enforceUnique until PR 3 UI)', () => {
    // Post-PR-3 (enforceUnique: true): legacy Necromancer and Shadow Monarch clear cleanly
    const strictNecro = parseClasses(undefined, { job: 'Necromancer', jobDone: 'Necromancer', fallbackAt: AT, trees, enforceUnique: true });
    expect(strictNecro).toEqual({ classes: {}, job: null, jobDone: null });
    const strictAlias = parseClasses(undefined, { job: 'Shadow Monarch', jobDone: 'Shadow Monarch', fallbackAt: AT, trees, enforceUnique: true });
    expect(strictAlias).toEqual({ classes: {}, job: null, jobDone: null });

    // Standalone PR 1 (enforceUnique: false): legacy Necromancer/Shadow Monarch keep 'Necromancer' label (no classes entry)
    // so shadow extraction stays reachable before PR 3's GM Claim UI, while brand-new uniques still clear to null.
    const legacyNecro = parseClasses(undefined, { job: 'Necromancer', jobDone: 'Necromancer', fallbackAt: AT, trees, enforceUnique: false });
    expect(legacyNecro).toEqual({ classes: {}, job: 'Necromancer', jobDone: null });
    const legacyAlias = parseClasses(undefined, { job: 'Shadow Monarch', jobDone: 'Shadow Monarch', fallbackAt: AT, trees, enforceUnique: false });
    expect(legacyAlias).toEqual({ classes: {}, job: 'Necromancer', jobDone: null });
    const unheldHemo = parseClasses(undefined, { job: 'Hemomancer', jobDone: 'Hemomancer', fallbackAt: AT, trees, enforceUnique: false });
    expect(unheldHemo).toEqual({ classes: {}, job: null, jobDone: null });
  });

  test('explicitly earned Necromancer entry stays active and awakened and preserves registryId and grantId', () => {
    const res = parseClasses(
      { Necromancer: { unlockedAt: AT, nodes: [], registryId: 'reg-1', grantId: 'cg7' } },
      { job: 'Necromancer', jobDone: 'Necromancer', fallbackAt: AT, trees },
    );
    expect(res.classes.Necromancer).toEqual({ unlockedAt: AT, nodes: [], registryId: 'reg-1', grantId: 'cg7' });
    expect(res.job).toBe('Necromancer');
    expect(res.jobDone).toBe('Necromancer');
  });

  test('non-unique awakened legacy job seeds locker from jobDone even if job is a different label, while unawakened starter stays outside locker', () => {
    const awakened = parseClasses(undefined, { job: 'Fighter', jobDone: 'Fighter', fallbackAt: AT, trees });
    expect(awakened.classes.Fighter).toEqual({ unlockedAt: AT, nodes: [] });
    expect(awakened.job).toBe('Fighter');
    expect(awakened.jobDone).toBe('Fighter');

    // jobDone-only seeding when active job is a custom label: Fighter enters locker, jobDone clears to match active label
    const split = parseClasses(undefined, { job: 'Wanderer', jobDone: 'Fighter', fallbackAt: AT, trees });
    expect(split.classes.Fighter).toEqual({ unlockedAt: AT, nodes: [] });
    expect(split.job).toBe('Wanderer');
    expect(split.jobDone).toBeNull();

    const unawakened = parseClasses(undefined, { job: 'Fighter', jobDone: null, fallbackAt: AT, trees });
    expect(unawakened.classes).toEqual({});
    expect(unawakened.job).toBe('Fighter');
    expect(unawakened.jobDone).toBeNull();
  });

  test('activeClass reports none, label, and earned states cleanly', () => {
    expect(activeClass({ job: null, jobDone: null, classes: {} })).toEqual({ kind: 'none' });
    expect(activeClass({ job: 'Fighter', jobDone: null, classes: {} })).toEqual({ kind: 'label', name: 'Fighter' });
    const entry = { unlockedAt: AT, nodes: [nid('root')] };
    expect(activeClass({ job: 'Fighter', jobDone: 'Fighter', classes: { Fighter: entry } })).toEqual({
      kind: 'earned',
      name: 'Fighter',
      entry,
    });
  });

  test('enforces CLASS_LOCKER_CAP (48) entries', () => {
    const raw: Record<string, { unlockedAt: string; nodes: string[] }> = {};
    for (let i = 0; i < 60; i++) raw[`Custom${i}`] = { unlockedAt: AT, nodes: [] };
    const res = parseClasses(raw, { job: null, jobDone: null, fallbackAt: AT, trees });
    expect(Object.keys(res.classes).length).toBe(CLASS_LOCKER_CAP);
  });
});
