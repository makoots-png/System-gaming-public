import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { freshSave } from '../src/core/save.ts';
import { parseClassNodeId, parseSheetKey, sheetKeyOf } from '../src/core/ids.ts';
import type { ClassNodeId, SheetKey } from '../src/core/ids.ts';
import { isRefused } from '../src/core/save-step.ts';
import { parseClasses } from '../src/core/hunter/class-locker.ts';
import { buyClassNode, earnClass, flipClassFork, planForkFlip, setJob, swapClass } from '../src/core/hunter/classes.ts';
import { HOLDER_REFUSAL_WORDS, claimUniqueClass, holdersDocOf } from '../src/core/hunter/class-holders.ts';
import { removeHunter } from '../src/core/party.ts';
import { parseRoomCode } from '../src/core/ids.ts';
import {
  CLASS_UI_WORDS,
  forkFlipPreview,
  forkRefusalWords,
  lockerView,
  nodeGiftLines,
  nodeRefusalWords,
  pairLongLabel,
  pairShortLabel,
  registryView,
  swapCostLine,
  swapRefusalWords,
} from '../src/core/hunter/class-view.ts';
import type { ClassNodeDef, ClassTree } from '../src/core/registry/class-trees.ts';
import { buildSyntheticTree } from './class-trees.test.ts';
import { dev } from './fixtures/ids.ts';

const AT = '2026-11-25T14:00:00.000Z';
const env = { now: new Date(AT), newDeviceToken: () => 'tok-0123456789abcdef0123456789ab', newDeviceId: () => dev('d-ui1') };
const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;
const skey = (s: string): SheetKey => parseSheetKey(s)!;

describe('PR 3 unique class parsing and refusal copy', () => {
  test('parseClasses clears un-held Necromancer and Shadow Monarch', () => {
    expect(parseClasses(undefined, { job: 'Necromancer', jobDone: 'Necromancer', fallbackAt: AT })).toEqual({
      classes: {},
      job: null,
      jobDone: null,
    });
    expect(parseClasses(undefined, { job: 'Shadow Monarch', jobDone: 'Shadow Monarch', fallbackAt: AT })).toEqual({
      classes: {},
      job: null,
      jobDone: null,
    });
  });

  test('HOLDER_REFUSAL_WORDS covers all 9 GM registry refusal codes and follows voice.md', () => {
    expect(Object.keys(HOLDER_REFUSAL_WORDS).sort()).toEqual([
      'bad-target',
      'class-taken',
      'foreign-class',
      'held',
      'locker-full',
      'no-hunter',
      'not-held',
      'not-unique',
      'same-holder',
    ]);
    for (const s of Object.values(HOLDER_REFUSAL_WORDS)) {
      expect(s).not.toMatch(/[—;]/);
      expect(s).not.toMatch(/\bjust\b/i);
      expect(s).not.toMatch(/!/);
    }
  });

  test('dynamic gold refusal and cost helpers include exact numbers and follow voice.md', () => {
    expect(swapRefusalWords(25, 10).gold).toBe('Swapping classes costs 25 gold. You have 10.');
    expect(nodeRefusalWords(45000, 12000).gold).toBe('Buying this node costs 45,000 gold. You have 12,000.');
    expect(forkRefusalWords(18750, 5000).gold).toBe('Flipping this fork costs 18,750 gold. You have 5,000.');
    expect(swapCostLine({ cost: 0, freeWhy: 'gm' }, 0)).toBe('Class swaps are free in GM mode.');
    expect(swapCostLine({ cost: 0, freeWhy: 'before-first-fight' }, 0)).toBe('Class swaps are free before your first fight.');
    expect(swapCostLine({ cost: 25, freeWhy: null }, 10)).toBe('Swapping classes costs 25 gold. You have 10.');
    expect(pairShortLabel('vit+pow')).toBe('VIT + POW');
    expect(pairLongLabel('vit+pow')).toBe('Vitality and Power');

    for (const v of Object.values(CLASS_UI_WORDS)) {
      if (typeof v === 'string') {
        expect(v).not.toMatch(/[—;]/);
        expect(v).not.toMatch(/\bjust\b/i);
        expect(v).not.toMatch(/!/);
      }
    }
  });
});

describe('lockerView, forkFlipPreview, and nodeGiftLines', () => {
  test('lockerView sorts earned classes, marks parked foreign uniques, and builds depth-grouped tree states', () => {
    const s = freshSave(env, { onboarded: true });
    let h = { ...s.hunters[0]!, gold: 500 };
    const e1 = earnClass(h, 'Fighter', { at: AT, activate: false, R: RULES });
    if (isRefused(e1)) throw new Error(e1.why);
    const e2 = earnClass(e1, 'Starforger', { at: AT, activate: false, registryId: 'reg-other', grantId: 'cg2', R: RULES });
    if (isRefused(e2)) throw new Error(e2.why);
    const e3 = earnClass(e2, 'Pyromancer', { at: AT, activate: true, R: RULES });
    if (isRefused(e3)) throw new Error(e3.why);

    const rareTree = buildSyntheticTree('Pyromancer', 'rare');
    const owned = ['root', 'a2', 'a3x', 'a3y', 'a4x', 'a4y', 'a5-l'].map(nid);
    const hWithNodes = {
      ...e3,
      classes: { ...e3.classes, Pyromancer: { ...e3.classes.Pyromancer!, nodes: owned } },
    };

    const vm = lockerView(hWithNodes, {
      role: 'player',
      held: false,
      R: RULES,
      activeRegistryId: 'reg-home',
      mySheetKey: sheetKeyOf(s.settings.deviceId, h.id),
      holdersDoc: { registryId: 'reg-home', at: AT, held: {} },
      trees: { Pyromancer: rareTree },
    });

    expect(vm.active.kind).toBe('earned');
    expect(vm.entries.map(e => e.name)).toEqual(['Pyromancer', 'Starforger', 'Fighter']);
    expect(vm.entries.find(e => e.name === 'Starforger')?.parked).toBe(true);
    expect(vm.entries.find(e => e.name === 'Fighter')?.pairChanges).toBe(true);
    expect(vm.treeMissing).toBe(false);
    expect(vm.tree?.ownedCount).toBe(7);
    expect(vm.tree?.buyableCap).toBe(16);
    expect(vm.tree?.capstoneReady).toBe(false);

    const allNodes = vm.tree!.depths.flatMap(d => d.nodes);
    expect(allNodes.find(n => n.id === nid('root'))?.status).toBe('owned');
    expect(allNodes.find(n => n.id === nid('b2'))?.status).toBe('buyable');
    expect(allNodes.find(n => n.id === nid('a6'))?.status).toBe('buyable');
    const capNode = allNodes.find(n => n.id === nid('cap'));
    expect(capNode?.status).toBe('locked');
    expect(capNode?.parentMode).toBe('any');
    expect(capNode?.missingParents).toEqual(['a6', 'b6']);
    const forkTwin = allNodes.find(n => n.id === nid('a5-r'));
    expect(forkTwin?.status).toBe('fork-taken');
    expect(forkTwin?.flipFromId).toBe(nid('a5-l'));
  });

  test('setJob refuses dead and held hunters, swapClass refuses holders-pending before first DOCS.holders, and node logs use node names', () => {
    const s0 = freshSave(env, { onboarded: true });
    const h0 = s0.hunters[0]!;
    expect(setJob(h0, 'Fighter', { held: true })).toEqual({ ok: false, why: 'held' });
    expect(setJob(h0, 'Fighter', { dead: true })).toEqual({ ok: false, why: 'dead' });

    const earned = earnClass({ ...h0, gold: 500 }, 'Hemomancer', { at: AT, activate: false, registryId: 'reg-1', grantId: 'cg1', R: RULES });
    if (isRefused(earned)) throw new Error(earned.why);
    const sPending = { ...s0, hunters: [earned] };
    expect(
      swapClass(sPending, h0.id, 'Hemomancer', {
        role: 'player',
        held: false,
        at: AT,
        room: parseRoomCode('ABC234')!,
        stamp: null,
        activeRegistryId: null,
        R: RULES,
      }),
    ).toEqual({ ok: false, why: 'holders-pending' });

    // Local buyClassNode & flipClassFork log human-readable node names (not raw ids)
    const rare = buildSyntheticTree('Pyromancer', 'rare');
    const namedRare: ClassTree = {
      ...rare,
      nodes: rare.nodes.map(n => (
        n.id === nid('root') ? { ...n, name: 'Ember Root' }
          : n.id === nid('a5-l') ? { ...n, name: 'Flame Left' }
            : n.id === nid('a5-r') ? { ...n, name: 'Flame Right' }
              : n
      )),
    };
    const pyro = earnClass({ ...h0, gold: 5000 }, 'Pyromancer', { at: AT, activate: true, R: RULES });
    if (isRefused(pyro)) throw new Error(pyro.why);
    const b = buyClassNode({ ...s0, hunters: [pyro] }, h0.id, nid('root'), {
      role: 'gm',
      held: false,
      at: AT,
      room: null,
      stamp: null,
      activeRegistryId: null,
      R: RULES,
      trees: { Pyromancer: namedRare },
    });
    if (isRefused(b)) throw new Error(b.why);
    expect(b.save.log[0]?.text).toContain('Ember Root');
    expect(b.save.log[0]?.text).not.toContain('bought root on');

    const beforeFork = ['root', 'a2', 'a3x', 'a3y', 'a4x', 'a4y', 'a5-l'].map(nid);
    const plan = planForkFlip(namedRare, beforeFork, nid('a5-l'), nid('a5-r'));
    expect(isRefused(plan)).toBe(false);
    const withFork = {
      ...s0,
      hunters: [{ ...pyro, classes: { Pyromancer: { ...pyro.classes.Pyromancer!, nodes: beforeFork } } }],
    };
    const fl = flipClassFork(withFork, h0.id, nid('a5-l'), nid('a5-r'), {
      role: 'gm',
      held: false,
      at: AT,
      room: null,
      stamp: null,
      activeRegistryId: null,
      R: RULES,
      trees: { Pyromancer: namedRare },
    });
    if (isRefused(fl)) throw new Error(fl.why);
    expect(fl.save.log[0]?.text).toContain('Flame Left');
    expect(fl.save.log[0]?.text).toContain('Flame Right');
  });

  test('lockerView sets treeMissing when active earned class has no tree in CLASS_TREES', () => {
    const s = freshSave(env, { onboarded: true });
    const h = earnClass(s.hunters[0]!, 'Fighter', { at: AT, activate: true, R: RULES });
    if (isRefused(h)) throw new Error(h.why);
    const vm = lockerView(h, {
      role: 'player',
      held: false,
      R: RULES,
      activeRegistryId: null,
      mySheetKey: null,
      holdersDoc: null,
      trees: {},
    });
    expect(vm.tree).toBeNull();
    expect(vm.treeMissing).toBe(true);
  });

  test('forkFlipPreview keeps post-fork convergence nodes and lists dropped exclusive dependents', () => {
    const base = buildSyntheticTree('Pyromancer', 'rare');
    const ownedConverged = ['root', 'a2', 'a3x', 'a3y', 'a4x', 'a4y', 'a5-l', 'a6'].map(nid);
    const keepConv = forkFlipPreview(base, ownedConverged, nid('a5-l'), nid('a5-r'));
    expect(keepConv?.dropped).toEqual([]);

    // Tree where a6 depends exclusively on a5-l (not a5-r): flipping a5-l -> a5-r drops a6.
    const exclTree: ClassTree = {
      ...base,
      nodes: base.nodes.map((n): ClassNodeDef =>
        n.id === nid('a6') ? { ...n, parents: [nid('a5-l')], parentMode: 'all' } : n),
    };
    const dropConv = forkFlipPreview(exclTree, ownedConverged, nid('a5-l'), nid('a5-r'));
    expect(dropConv?.dropped.map(n => n.id)).toEqual([nid('a6')]);
  });

  test('nodeGiftLines formats bonus and scaler gifts cleanly', () => {
    const lines = nodeGiftLines([
      { kind: 'bonus', bonus: { str: 4, vit: 2 } },
      { kind: 'scaler', scaler: { measure: 'target', dir: 'under', start: 0.5, scale: 0.3 } },
    ]);
    expect(lines).toEqual([
      '+4 STR, +2 VIT',
      'Bonus vs low-HP target (up to +30%)',
    ]);
  });
});

describe('registryView', () => {
  test('lists all 18 unique classes (10 Mythic then 8 Epic), flags inFight, and compares against DOCS.holders', () => {
    const base = freshSave(env, { onboarded: true });
    const h0 = base.hunters[0]!;
    const remoteKey = skey('d-pl1:h1');
    const ctx = {
      at: AT,
      room: null,
      stamp: null,
      R: RULES,
      heldLocal: () => false,
      heldRemote: () => false,
    };
    const c1 = claimUniqueClass(base, 'Hemomancer', { kind: 'remote', sheetKey: remoteKey, name: 'Mira' }, ctx);
    if (isRefused(c1)) throw new Error(c1.why);
    const c2 = claimUniqueClass(c1.save, 'Seraph', { kind: 'local', hunterId: h0.id }, ctx);
    if (isRefused(c2)) throw new Error(c2.why);
    const c3 = claimUniqueClass(c2.save, 'Ironclad', { kind: 'npc', name: 'Archon' }, ctx);
    if (isRefused(c3)) throw new Error(c3.why);

    const doc = holdersDocOf(c3.save, AT);
    const vm = registryView(c3.save, {
      inRoom: true,
      holdersDoc: doc,
      heldLocal: id => id === h0.id,
      heldRemote: k => k === remoteKey,
      remotes: [{ key: remoteKey, name: 'Mira Renamed' }],
      trees: { Hemomancer: buildSyntheticTree('Hemomancer', 'mythic') },
    });

    expect(vm.total).toBe(18);
    expect(vm.heldCount).toBe(3);
    expect(vm.summary).toBe('3 of 18 held');
    expect(vm.rows.slice(0, 10).every(r => r.rarity === 'mythic')).toBe(true);
    expect(vm.rows.slice(10).every(r => r.rarity === 'epic')).toBe(true);

    const hemo = vm.rows.find(r => r.className === 'Hemomancer')!;
    expect(hemo.hasKit).toBe(true);
    expect(hemo.holderName).toBe('Mira Renamed');
    expect(hemo.holderKindLabel).toBe('Player phone');
    expect(hemo.inFight).toBe(true);
    expect(hemo.synced).toBe(true);

    const seraph = vm.rows.find(r => r.className === 'Seraph')!;
    expect(seraph.hasKit).toBe(false);
    expect(seraph.holderName).toBe(h0.name);
    expect(seraph.holderKindLabel).toBe('Local');
    expect(seraph.inFight).toBe(true);
    expect(seraph.synced).toBe(true);

    const iron = vm.rows.find(r => r.className === 'Ironclad')!;
    expect(iron.holderKindLabel).toBe('NPC');
    expect(iron.inFight).toBe(false);
    expect(iron.synced).toBe(true);

    // Deleted local holder is flagged with "(removed)" while staying held per t135u
    const removedSave = removeHunter({ ...c3.save, hunters: [...c3.save.hunters, { ...h0, id: 'h999' as typeof h0.id, name: 'Spare' }] }, h0.id, null);
    if (!isRefused(removedSave)) {
      const remVm = registryView(removedSave, {
        inRoom: false,
        holdersDoc: null,
        heldLocal: () => false,
        heldRemote: () => false,
      });
      const remSeraph = remVm.rows.find(r => r.className === 'Seraph')!;
      expect(remSeraph.holderRemoved).toBe(true);
      expect(remSeraph.holderName).toBe(`${h0.name} (removed)`);
    }

    // Out-of-date room doc marks claimed class as syncing (false)
    const staleVm = registryView(c3.save, {
      inRoom: true,
      holdersDoc: { registryId: c3.save.classHolders.registryId, at: AT, held: {} },
      heldLocal: () => false,
      heldRemote: () => false,
    });
    expect(staleVm.rows.find(r => r.className === 'Hemomancer')?.synced).toBe(false);
    expect(staleVm.rows.find(r => r.className === 'Bladefiend')?.synced).toBe(true);
  });
});
