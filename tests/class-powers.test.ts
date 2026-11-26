import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { parseClassNodeId } from '../src/core/ids.ts';
import type { ClassNodeId } from '../src/core/ids.ts';
import { abilityId } from '../src/core/combat/ability-types.ts';
import type { Ability } from '../src/core/combat/ability-types.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import type { StatusDef } from '../src/core/combat/effect-ops.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { tiles } from '../src/core/combat/space.ts';
import { CLASS_ACTIVES_MAX } from '../src/core/registry/class-trees.ts';
import type { ClassTree, ClassWorn } from '../src/core/registry/class-trees.ts';
import { classPowers, classStatusDef } from '../src/core/registry/class-powers.ts';
import type { ClassSignature } from '../src/core/registry/class-powers.ts';

const nid = (s: string): ClassNodeId => parseClassNodeId(s)!;

const mkAbility = (id: string, name: string): Ability =>
  abilityOf('blast', { id: abilityId(id), name, aim: 'foe', shape: { kind: 'touch', reach: tiles(1) }, range: tiles(4), effect: null }, RULES);

const mkWorn = (key: string, label: string): ClassWorn => ({
  key: statusKey(key),
  def: {
    label,
    desc: label,
    ops: [],
    triggers: [],
  },
});

describe('classPowers and classStatusDef', () => {
  const baseWorn = mkWorn('crimson-pact', 'Crimson Pact');
  const upgradedWorn = mkWorn('crimson-pact-ii', 'Crimson Pact II');
  const a1 = mkAbility('hemo-transfusion', 'Transfusion');
  const a1Up = mkAbility('hemo-transfusion', 'Transfusion II');
  const a2 = mkAbility('hemo-pool', 'Sanguine Pool');
  const a3 = mkAbility('hemo-tides', 'Tides of Blood');
  const a4 = mkAbility('hemo-plague', 'Hemoplague');
  const a5 = mkAbility('hemo-extra', 'Forbidden Fifth');

  const sig: ClassSignature = {
    className: 'Hemomancer',
    bonus: { drain: 25, manaMax: 10 },
    worn: baseWorn,
    // Even if a buggy signature passed 5 actives, classPowers clips at CLASS_ACTIVES_MAX (4).
    actives: [a1, a2, a3, a4, a5],
  };

  const tree: ClassTree = {
    className: 'Hemomancer',
    rarity: 'mythic',
    nodes: [
      {
        id: nid('root'),
        depth: 1,
        name: 'Blood Awakening',
        desc: '+5 drain and replace Transfusion',
        parents: [],
        gifts: [
          { kind: 'bonus', bonus: { drain: 5, pow: 2 } },
          { kind: 'replace-active', targetId: abilityId('hemo-transfusion'), active: a1Up },
        ],
      },
      {
        id: nid('pact-up'),
        depth: 2,
        name: 'Deep Pact',
        desc: 'Upgrades worn status and adds execute scaler',
        parents: [nid('root')],
        gifts: [
          { kind: 'replace-worn', targetKey: statusKey('crimson-pact'), worn: upgradedWorn },
          { kind: 'scaler', scaler: { measure: 'target', dir: 'under', start: 0.5, scale: 0.3 } },
          // Unmatched replace-active id is silently ignored and never adds a 5th active.
          { kind: 'replace-active', targetId: abilityId('does-not-exist'), active: a5 },
        ],
      },
    ],
  };

  const signatures = { Hemomancer: sig };
  const trees = { Hemomancer: tree };

  test('returns empty when job is null, unawakened, or missing from locker', () => {
    const empty = { bonus: {}, scalers: [], worn: null, actives: [] };
    expect(classPowers({ job: null, jobDone: null, classes: {} }, RULES, { signatures, trees })).toEqual(empty);
    expect(classPowers({ job: 'Hemomancer', jobDone: null, classes: { Hemomancer: { unlockedAt: '2026-01-01T00:00:00Z', nodes: [] } } }, RULES, { signatures, trees })).toEqual(empty);
    expect(classPowers({ job: 'Hemomancer', jobDone: 'Hemomancer', classes: {} }, RULES, { signatures, trees })).toEqual(empty);
  });

  test('folds bonuses, scalers, worn replacement, and active replacement in tree order, capped at 4 actives', () => {
    // Pass nodes in reverse order to verify folding runs in tree order (not purchase order).
    const res = classPowers(
      {
        job: 'Hemomancer',
        jobDone: 'Hemomancer',
        classes: { Hemomancer: { unlockedAt: '2026-01-01T00:00:00Z', nodes: [nid('pact-up'), nid('root')] } },
      },
      RULES,
      { signatures, trees },
    );
    expect(res.bonus).toEqual({ drain: 30, manaMax: 10, pow: 2 });
    expect(res.worn).toEqual(upgradedWorn);
    expect(res.scalers).toEqual([{ measure: 'target', dir: 'under', start: 0.5, scale: 0.3 }]);
    expect(res.actives.length).toBe(CLASS_ACTIVES_MAX);
    expect(res.actives.map(a => a.name)).toEqual(['Transfusion II', 'Sanguine Pool', 'Tides of Blood', 'Hemoplague']);
  });

  test('classStatusDef resolves both base signature worn status and tree replacement worn status by key', () => {
    expect(classStatusDef('crimson-pact', signatures, trees)).toEqual(baseWorn.def);
    expect(classStatusDef('crimson-pact-ii', signatures, trees)).toEqual(upgradedWorn.def);
    expect(classStatusDef('unknown-status', signatures, trees)).toBeNull();
  });

  test('an upgrade-status gift swaps the status every folded active applies, even one a later node in tree order supplies', () => {
    const burn: StatusDef = { label: 'Burn', desc: 'Burn', ops: [] };
    const burnUp: StatusDef = { label: 'Burn II', desc: 'Burn II', ops: [] };
    const withBurn = (a: Ability, stacks: number): Ability => ({
      ...a,
      ops: [{ op: 'applyStatus', key: statusKey('burn'), def: burn, duration: null, stacks }, { op: 'note', text: 'kept' }],
    });
    const lance = mkAbility('lance', 'Lance');
    const kindle = withBurn(mkAbility('lance', 'Kindle'), 2);
    const plain = mkAbility('pool', 'Pool');
    const upSig: ClassSignature = { className: 'Pyromancer', actives: [lance, plain] };
    const upTree: ClassTree = {
      className: 'Pyromancer',
      rarity: 'common',
      nodes: [
        // The upgrade sits before the node that brings in the burning active, so it must apply after the whole fold.
        { id: nid('up'), depth: 1, name: 'Furnace', desc: 'Furnace', parents: [], gifts: [{ kind: 'upgrade-status', targetKey: statusKey('burn'), key: statusKey('burn-ii'), def: burnUp }] },
        { id: nid('fork'), depth: 2, name: 'Kindle', desc: 'Kindle', parents: [nid('up')], gifts: [{ kind: 'replace-active', targetId: abilityId('lance'), active: kindle }] },
      ],
    };
    const fold = (nodes: readonly ClassNodeId[]) => classPowers(
      { job: 'Pyromancer', jobDone: 'Pyromancer', classes: { Pyromancer: { unlockedAt: '2026-01-01T00:00:00Z', nodes: [...nodes] } } },
      RULES,
      { signatures: { Pyromancer: upSig }, trees: { Pyromancer: upTree } },
    ).actives;

    const upgraded = fold([nid('fork'), nid('up')]);
    expect(upgraded[0]!.name).toBe('Kindle');
    expect(upgraded[0]!.ops).toEqual([
      { op: 'applyStatus', key: statusKey('burn-ii'), def: burnUp, duration: null, stacks: 2 },
      { op: 'note', text: 'kept' },
    ]);
    // An active without the status is passed through as the same object
    expect(upgraded[1]).toBe(plain);
    // With the upgrade alone, nothing applies Burn yet, so the lance is unchanged
    expect(fold([nid('up')])[0]).toBe(lance);
    expect(classStatusDef('burn-ii', { Pyromancer: upSig }, { Pyromancer: upTree })).toEqual(burnUp);
  });
});
