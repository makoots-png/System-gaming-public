// NPC builder unit 1 tests: template parsing, save repair (including legacy Schema 6 saves without library.npcs),
// power budget / worth, pack round-trip (with status rekeying), copying with a new id, library operations, and rules.
import { describe, expect, test } from 'bun:test';
import {
  ALLY_OVER_BUDGET_WARNING,
  NPC_BOUNDS,
  NPC_SIDES,
  NPC_SKILLS,
  NPC_SKILL_INFO,
  NPC_SKILL_NAMES,
  NPC_TIERS,
  copyNpc,
  newNpc,
  npcPresetOf,
  npcSheet,
  npcSkillReadout,
  npcTierPreset,
  npcWorth,
  parseNpc,
} from '../src/core/registry/npcs.ts';
import type { Npc, NpcTemplate } from '../src/core/registry/npcs.ts';
import { abilityId, tag } from '../src/core/combat/ability-types.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import type { StatusDef } from '../src/core/combat/effect-ops.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { newGate } from '../src/core/gates/gate.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { NO_TWEAK } from '../src/core/hunter/derive.ts';
import { parseNpcId, parseSaveId, saveId } from '../src/core/ids.ts';
import { copyName, duplicateEntry, removeEntry, saveEntry, savedWords } from '../src/core/library.ts';
import { parseOverrides } from '../src/core/overrides.ts';
import { PACK_CAP, mergePack, packCounts, packOf, parsePack } from '../src/core/pack.ts';
import { RANKS, RULES, rulesOf } from '../src/core/rules.ts';
import { LIMITS, SCHEMA, freshSave, newMonster, newSave, parseSaveValue, repairSave } from '../src/core/save.ts';
import type { ParseEnv, Save } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import { dev, mid, npcid } from './fixtures/ids.ts';
import { stampSeq } from './fixtures/items.ts';

const NOW = new Date('2026-11-27T00:00:00.000Z');
const env = (): ParseEnv => {
  let d = 0;
  let t = 0;
  return {
    now: NOW,
    newDeviceId: () => dev(`d-npc${++d}`),
    newDeviceToken: () => `token-${String(++t).padStart(26, '0')}`,
  };
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const ab = (id: string, name: string, kind: 'strike' | 'shot' | 'blast' | 'curse' | 'support' = 'strike') =>
  abilityOf(kind, { id: abilityId(id), name }, RULES);

describe('NPC rules and ids', () => {
  test('RULES.fight.npc holds the spec defaults, ability cap, Support ally tweak, and 5-step skill curve', () => {
    const N = RULES.fight.npc;
    expect(N.defaultSkill).toBe(3);
    expect(N.abilities).toBe(4);
    expect(N.allyTweak).toEqual({ hp: 1.08, dealt: 0.93 });
    expect(N.skill).toEqual({
      1: { skip: 0.65, temp: 0.85 },
      2: { skip: 0.42, temp: 0.45 },
      3: { skip: 0.2, temp: 0.22 },
      4: { skip: 0, temp: 0.08 },
      5: { skip: 0, temp: 0 },
    });
    expect(NPC_SKILLS.map(s => NPC_SKILL_INFO[s].name)).toEqual(['Sloppy', 'Careless', 'Steady', 'Sharp', 'Optimal']);
    expect(NPC_SKILLS.map(s => NPC_SKILL_NAMES[s])).toEqual(['Sloppy', 'Careless', 'Steady', 'Sharp', 'Optimal']);
    expect(NPC_TIERS).toEqual(['normal', 'elite', 'boss']);
    expect(NPC_SIDES).toEqual(['party', 'foe']);
  });

  test('npcSkillReadout builds text from live R so GM overrides to skip and temp show in the slider readout', () => {
    for (const s of NPC_SKILLS) {
      expect(npcSkillReadout(s, RULES)).toBe(NPC_SKILL_INFO[s].readout);
    }
    expect(npcSkillReadout(1, RULES)).toContain('65% chance');
    expect(npcSkillReadout(2, RULES)).toContain('42% chance');
    expect(npcSkillReadout(3, RULES)).toContain('20% chance');
    expect(npcSkillReadout(4, RULES)).toContain('never skips');
    expect(npcSkillReadout(5, RULES)).toBe('Optimal: always picks the strongest move.');

    const ov = parseOverrides({
      fight: {
        npc: {
          skill: {
            1: { skip: 0.3 },
            2: { skip: 1, temp: 0 },
            4: { skip: 0.2 },
            5: { skip: 0, temp: 0.5 },
          },
        },
      },
    });
    expect(ov.refused).toEqual([]);
    const R = rulesOf(ov.overrides);
    expect(npcSkillReadout(1, R)).toContain('30% chance');
    expect(npcSkillReadout(1, R)).not.toContain('65%');
    expect(npcSkillReadout(2, R)).toContain('always skips');
    expect(npcSkillReadout(2, R)).toContain('strongest attack');
    expect(npcSkillReadout(4, R)).toContain('20% chance');
    expect(npcSkillReadout(4, R)).not.toContain('never skips');
    expect(npcSkillReadout(5, R)).toContain('never skips');
    expect(npcSkillReadout(5, R)).toContain('often picks a weaker attack');
    expect(npcSkillReadout(3, R)).toBe(npcSkillReadout(3, RULES));
  });

  test('GM overrides validate fight.npc bounds and keep sibling defaults', () => {
    const ok = parseOverrides({
      fight: {
        npc: {
          defaultSkill: 4,
          abilities: 6,
          allyTweak: { hp: 1.2, dealt: 0.9 },
          skill: { 3: { skip: 0.15, temp: 0.18 } },
        },
      },
    });
    expect(ok.refused).toEqual([]);
    const R = rulesOf(ok.overrides);
    expect(R.fight.npc.defaultSkill).toBe(4);
    expect(R.fight.npc.abilities).toBe(6);
    expect(R.fight.npc.allyTweak).toEqual({ hp: 1.2, dealt: 0.9 });
    expect(R.fight.npc.skill[3]).toEqual({ skip: 0.15, temp: 0.18 });
    expect(R.fight.npc.skill[1]).toEqual(RULES.fight.npc.skill[1]);

    const bad = parseOverrides({
      fight: {
        npc: {
          defaultSkill: 6,
          abilities: 20,
          allyTweak: { hp: 0, dealt: 25 },
          skill: { 2: { skip: 1.5, temp: -1 } },
        },
      },
    });
    expect(bad.refused.map(r => [r.path, r.reason])).toEqual([
      ['fight.npc.defaultSkill', 'range'],
      ['fight.npc.abilities', 'range'],
      ['fight.npc.allyTweak.hp', 'range'],
      ['fight.npc.allyTweak.dealt', 'range'],
      ['fight.npc.skill.2.skip', 'range'],
      ['fight.npc.skill.2.temp', 'range'],
    ]);
  });

  test('NpcId uses the npc_ prefix and round-trips through saveId and parseNpcId', () => {
    const id = saveId('npc_', 42);
    expect(String(id)).toBe('npc_42');
    expect(parseSaveId<'npc_'>(id)).toBe(id);
    expect(parseNpcId(id)).toBe(id);
    expect(npcid('npc_42')).toBe(id);
    expect(parseNpcId('m42')).toBeNull();
    expect(parseNpcId('npc_')).toBeNull();
    expect(parseNpcId('bad-id')).toBeNull();
    expect(() => npcid('m42')).toThrow();
    expect(() => npcid('npc_')).toThrow();
    expect(() => npcid('bad-id')).toThrow();
  });
});

describe('parseNpc and presets', () => {
  test('refuses non-objects and blank names', () => {
    for (const bad of [null, undefined, 'Sera', 42, [], {}, { name: '' }, { name: '   ' }]) {
      expect(parseNpc(bad)).toBeNull();
    }
  });

  test('fills defaults for minimal valid input and drops unknown keys', () => {
    const parsed = parseNpc({ name: '  Mira Vance  ', extra: 'drop-me', id: 'npc_9' });
    expect(parsed).toEqual({
      name: 'Mira Vance',
      rank: 'E',
      archetype: 'brute',
      tier: 'normal',
      tweak: NO_TWEAK,
      defaultSide: 'party',
      skill: 3,
      abilities: [],
      statuses: [],
      notes: '',
    });
    expect(parsed).not.toHaveProperty('extra');
    expect(parsed).not.toHaveProperty('id');
  });

  test(`validates enums, clamps numbers, caps abilities at ${NPC_BOUNDS.abilities} and statuses at ${NPC_BOUNDS.statuses}, and drops invalid icons/chips`, () => {
    const parsed = parseNpc({
      name: 'X'.repeat(90),
      rank: 'Z',
      archetype: 'dragon',
      tier: 'mythic',
      defaultSide: 'enemy',
      skill: 99,
      tweak: {
        hp: 50,
        dealt: -3,
        stats: { str: 1200, vit: -1200, agi: 0, luck: 50 },
        traits: ['warded', 'fast', 'fast', 'giant'],
      },
      abilities: [
        ab('a1', 'Move 1'),
        ab('a2', 'Move 2', 'shot'),
        'not-an-ability',
        ...Array.from({ length: NPC_BOUNDS.abilities }, (_, i) => ab(`a${i + 3}`, `Move ${i + 3}`, i % 2 === 0 ? 'curse' : 'support')),
      ],
      statuses: [
        { key: 'burning', rounds: 2, stacks: 4 },
        { key: 'burning', rounds: 5 },
        { key: 'dead', rounds: null },
        { key: 'Bad Key!', rounds: 2 },
        { key: 'poisoned', rounds: null, stacks: 1 },
        { key: 'slowed', rounds: 0 },
        { key: 'hasted', rounds: 5000, stacks: 999 },
        { key: 'bleeding', rounds: 2 },
        { key: 'prone', rounds: 1 },
        { key: 'blinded', rounds: 2 },
        { key: 'frightened', rounds: 2 },
        { key: 'marked', rounds: 2 },
        { key: 'stunned', rounds: 1 },
      ],
      icon: 'not-a-real-icon',
      notes: 'N'.repeat(700),
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toHaveLength(NPC_BOUNDS.name);
    expect(parsed!.rank).toBe('E');
    expect(parsed!.archetype).toBe('brute');
    expect(parsed!.tier).toBe('normal');
    expect(parsed!.defaultSide).toBe('party');
    expect(parsed!.skill).toBe(5);
    expect(parsed!.tweak).toEqual({
      hp: NPC_BOUNDS.tweakMax,
      dealt: NO_TWEAK.dealt,
      stats: { str: NPC_BOUNDS.stat, vit: -NPC_BOUNDS.stat },
      traits: ['fast', 'warded'],
    });
    expect(parsed!.abilities).toHaveLength(NPC_BOUNDS.abilities);
    expect(parsed!.abilities.map(a => a.name)).toEqual(Array.from({ length: NPC_BOUNDS.abilities }, (_, i) => `Move ${i + 1}`));
    expect(parsed!.statuses).toHaveLength(NPC_BOUNDS.statuses);
    expect(parsed!.statuses[0]).toEqual({ key: 'burning', rounds: 2, stacks: 4 });
    expect(parsed!.statuses[1]).toEqual({ key: 'poisoned', rounds: null });
    expect(parsed!.statuses[2]).toEqual({ key: 'slowed', rounds: 1 });
    expect(parsed!.statuses[3]).toEqual({ key: 'hasted', rounds: NPC_BOUNDS.rounds, stacks: RULES.fight.kit.stackCap });
    expect(parsed).not.toHaveProperty('icon');
    expect(parsed!.notes).toHaveLength(NPC_BOUNDS.notes);

    expect(parseNpc({ name: 'Low Skill', skill: 0 })!.skill).toBe(1);
    expect(parseNpc({ name: 'Bad Skill', skill: 'sharp' })!.skill).toBe(3);
    expect(parseNpc({ name: 'With Icon', icon: 'shield' })!.icon).toBe('shield');
    expect(parseNpc({ name: 'Tiny Factor', tweak: { hp: 0.01, dealt: 0.01 } })!.tweak).toMatchObject({
      hp: NPC_BOUNDS.tweakMin,
      dealt: NPC_BOUNDS.tweakMin,
    });
  });

  test('newNpc defaults party to Support ally preset and foe to Standard preset', () => {
    const ally = newNpc({ name: 'Sera' });
    expect(ally.defaultSide).toBe('party');
    expect(ally.tier).toBe('normal');
    expect(ally.tweak).toEqual({ hp: 1.08, dealt: 0.93, stats: {}, traits: [] });
    expect(ally.skill).toBe(3);
    expect(npcPresetOf(ally)).toBe('support');

    const foe = newNpc({ name: 'Bandit', defaultSide: 'foe' });
    expect(foe.tier).toBe('normal');
    expect(foe.tweak).toEqual(NO_TWEAK);
    expect(npcPresetOf(foe)).toBe('standard');

    expect(npcPresetOf({ ...ally, ...npcTierPreset('elite') })).toBe('elite');
    expect(npcPresetOf({ ...ally, ...npcTierPreset('boss') })).toBe('boss');

    // Explicit tier on party side uses NO_TWEAK instead of baking allyTweak into it.
    const eliteAlly = newNpc({ name: 'Ace', tier: 'elite' });
    expect(eliteAlly.defaultSide).toBe('party');
    expect(eliteAlly.tier).toBe('elite');
    expect(eliteAlly.tweak).toEqual(NO_TWEAK);
    expect(npcPresetOf(eliteAlly)).toBe('elite');

    const bossAlly = newNpc({ name: 'Monarch', tier: 'boss' });
    expect(bossAlly.tier).toBe('boss');
    expect(bossAlly.tweak).toEqual(NO_TWEAK);

    const standardAlly = newNpc({ name: 'Guard', tier: 'normal' });
    expect(standardAlly.tier).toBe('normal');
    expect(standardAlly.tweak).toEqual(NO_TWEAK);
    expect(npcPresetOf(standardAlly)).toBe('standard');
  });
});

describe('save repair and legacy Schema 6 compatibility', () => {
  test('an old Schema 6 save without library.npcs loads cleanly with an empty npcs list', () => {
    const legacy = clone(freshSave(env(), { onboarded: true })) as Record<string, unknown>;
    delete (legacy.library as Record<string, unknown>).npcs;
    expect((legacy.library as Record<string, unknown>).npcs).toBeUndefined();

    const parsed = parseSaveValue(legacy, env());
    expect(parsed.kind).toBe('save');
    if (parsed.kind !== 'save') return;
    expect(parsed.save.schema).toBe(SCHEMA);
    expect(parsed.save.library.npcs).toEqual([]);
  });

  test('repair keeps valid npc_ ids, replaces missing/bad/duplicate ids, advances seq, drops blank names, and enforces the 100 cap', () => {
    const base = freshSave(env(), { onboarded: true });
    base.seq = 50;
    const raw = clone(base) as unknown as { seq: number; library: { npcs: unknown[] } };
    raw.library.npcs = [
      { id: 'npc_200', name: 'Kept NPC', rank: 'C', defaultSide: 'party', skill: 4 },
      { id: 'npc_200', name: 'Duplicate Id' },
      { id: 'bad-id', name: 'Bad Id' },
      { name: 'Missing Id' },
      { id: 'npc_201', name: '' },
      'junk',
    ];
    const parsed = parseSaveValue(raw, env());
    expect(parsed.kind).toBe('save');
    if (parsed.kind !== 'save') return;
    const list = parsed.save.library.npcs;
    expect(list.map(n => n.name)).toEqual(['Kept NPC', 'Duplicate Id', 'Bad Id', 'Missing Id']);
    expect(list[0]!.id).toBe(npcid('npc_200'));
    expect(list[1]!.id).toBe(npcid('npc_201'));
    expect(list[2]!.id).toBe(npcid('npc_202'));
    expect(list[3]!.id).toBe(npcid('npc_203'));
    expect(new Set(list.map(n => n.id)).size).toBe(4);
    expect(parsed.save.seq).toBeGreaterThanOrEqual(203);

    // Running repairSave a second time changes nothing.
    const snapshot = JSON.stringify(parsed.save.library.npcs);
    repairSave(parsed.save, env());
    expect(JSON.stringify(parsed.save.library.npcs)).toBe(snapshot);

    // Cap at LIMITS.libraryNpcs (100).
    const over = clone(base) as unknown as { library: { npcs: unknown[] } };
    over.library.npcs = Array.from({ length: LIMITS.libraryNpcs + 15 }, (_, i) => ({
      id: `npc_${i + 1}`,
      name: `Guard ${i + 1}`,
    }));
    const capped = parseSaveValue(over, env());
    expect(capped.kind).toBe('save');
    if (capped.kind === 'save') {
      expect(capped.save.library.npcs).toHaveLength(LIMITS.libraryNpcs);
    }
  });

  test('repair blanks an NPC id of another kind (such as m7) so monsters and gate rosters keep their ids', () => {
    const base = freshSave(env(), { onboarded: true });
    base.seq = 300;
    const monster = { ...newMonster(), id: mid('m7'), name: 'Ash Hound' };
    const gate = {
      ...newGate(),
      name: 'Ash Gate',
      rank: 'C' as const,
      id: saveId('g', 5),
      monsters: [{ monsterId: mid('m7'), count: 2 }],
      bossId: mid('m7'),
    };
    const raw = clone({
      ...base,
      monsters: [monster],
      gates: [gate],
      library: {
        ...base.library,
        npcs: [{ id: 'm7', name: 'Misplaced Id NPC' }],
      },
    });
    const parsed = parseSaveValue(raw, env());
    expect(parsed.kind).toBe('save');
    if (parsed.kind !== 'save') return;
    expect(parsed.save.library.npcs).toHaveLength(1);
    expect(parseNpcId(parsed.save.library.npcs[0]!.id)).toBe(parsed.save.library.npcs[0]!.id);
    expect(String(parsed.save.library.npcs[0]!.id)).toBe('npc_301');
    expect(parsed.save.monsters[0]!.id).toBe(mid('m7'));
    expect(parsed.save.gates[0]!.monsters).toEqual([{ monsterId: mid('m7'), count: 2 }]);
    expect(parsed.save.gates[0]!.bossId).toBe(mid('m7'));
  });

  test('lowering GM rule overrides never prunes saved NPC abilities, tags, stacks, or default skill on reload or pack round-trip', () => {
    const base = freshSave(env(), { onboarded: true });
    const taggedAbility = {
      ...ab('ab-tagged', 'Cinder Burst', 'blast'),
      tags: [tag('fire'), tag('aoe'), tag('boss')],
    };
    const sixAbilities = [
      taggedAbility,
      ab('ab-2', 'Cut', 'strike'),
      ab('ab-3', 'Bolt', 'shot'),
      ab('ab-4', 'Hex', 'curse'),
      ab('ab-5', 'Mend', 'support'),
      ab('ab-6', 'Finisher', 'strike'),
    ];
    const savedNpc: Npc = {
      ...newNpc({
        name: 'Veteran Aria',
        rank: 'A',
        archetype: 'caster',
        tier: 'elite',
        abilities: sixAbilities,
        statuses: [{ key: 'burning', rounds: 3, stacks: 4 }],
      }),
      id: npcid('npc_12'),
    };
    const lowered = parseOverrides({
      fight: {
        npc: { abilities: 0, defaultSkill: 5 },
        kit: { stackCap: 1, tags: 0 },
      },
    });
    expect(lowered.refused).toEqual([]);

    const raw = clone({
      ...base,
      rulesOverrides: lowered.overrides,
      library: {
        ...base.library,
        npcs: [savedNpc, { id: 'npc_13', name: 'Missing Skill NPC' }],
      },
    });
    delete (raw.library.npcs[1] as Record<string, unknown>).skill;

    const reloaded = parseSaveValue(raw, env());
    expect(reloaded.kind).toBe('save');
    if (reloaded.kind !== 'save') return;

    const after = reloaded.save.library.npcs[0]!;
    expect(after.abilities).toHaveLength(6);
    expect(after.abilities[0]!.tags).toEqual([tag('fire'), tag('aoe'), tag('boss')]);
    expect(after.statuses).toEqual([{ key: 'burning', rounds: 3, stacks: 4 }]);
    expect(after).toEqual(savedNpc);
    // Missing skill uses shipped defaultSkill (3), not the GM override (5).
    expect(reloaded.save.library.npcs[1]!.skill).toBe(3);

    // Pack round-trip preserves the exact same 6 abilities, tags, and stacks.
    const doc = packOf(reloaded.save, '2026-11-27T00:00:00.000Z', 'npcs', savedNpc.id);
    const read = parsePack(clone(doc));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const { id: _id, ...expectedTpl } = savedNpc;
    expect(read.pack.npcs[0]).toEqual(expectedTpl);
    const landed = mergePack(newSave(dev('d-dst')), read.pack, 'add', stampSeq('ov'));
    expect(landed.save.library.npcs[0]!.abilities).toHaveLength(6);
    expect(landed.save.library.npcs[0]!.statuses).toEqual([{ key: 'burning', rounds: 3, stacks: 4 }]);
  });
});

describe('NPC sheet and power budget (npcWorth)', () => {
  test('Support ally lands at about 0.65x a same-rank hunter across ranks and archetypes with no ally warning', () => {
    for (const rank of RANKS) {
      for (const archetype of ['brute', 'skirmisher', 'caster'] as const) {
        const npc = newNpc({ name: `${rank} ${archetype}`, rank, archetype, defaultSide: 'party' });
        const w = npcWorth(npc, RULES);
        expect(w.sheet).toEqual(npcSheet(npc, RULES));
        expect(w.ratio, `${rank} ${archetype}`).toBeGreaterThanOrEqual(0.62);
        expect(w.ratio, `${rank} ${archetype}`).toBeLessThanOrEqual(0.68);
        expect(w.overAllyBudget).toBe(false);
        expect(w.warning).toBeNull();
      }
    }
    const eAlly = npcWorth(newNpc({ name: 'Rookie', rank: 'E', archetype: 'brute', defaultSide: 'party' }), RULES);
    expect(eAlly.summary).toBe(
      `About ${eAlly.ratio.toFixed(2)} times a rank E hunter (HP ${eAlly.sheet.hpMax}, Armor ${eAlly.sheet.armor}, Resist ${eAlly.sheet.resist}, Speed ${eAlly.sheet.speed}).`,
    );
    expect(eAlly.summary).toContain('About 0.65 times a rank E hunter');
  });

  test('Elite and Boss allies exceed 1.0x and carry the ally budget warning; foes do not warn', () => {
    const eliteAlly = npcWorth(newNpc({ name: 'Ace Ally', rank: 'C', ...npcTierPreset('elite'), defaultSide: 'party' }), RULES);
    expect(eliteAlly.ratio).toBeGreaterThan(1);
    expect(eliteAlly.overAllyBudget).toBe(true);
    expect(eliteAlly.warning).toBe(ALLY_OVER_BUDGET_WARNING);

    const bossAlly = npcWorth(newNpc({ name: 'Sovereign Ally', rank: 'C', ...npcTierPreset('boss'), defaultSide: 'party' }), RULES);
    expect(bossAlly.ratio).toBeGreaterThan(eliteAlly.ratio);
    expect(bossAlly.overAllyBudget).toBe(true);
    expect(bossAlly.warning).toBe(ALLY_OVER_BUDGET_WARNING);

    const bossFoe = npcWorth(newNpc({ name: 'Rival Captain', rank: 'C', ...npcTierPreset('boss'), defaultSide: 'foe' }), RULES);
    expect(bossFoe.ratio).toBeGreaterThan(1);
    expect(bossFoe.overAllyBudget).toBe(false);
    expect(bossFoe.warning).toBeNull();
  });

  test('lopsided ally builds warn when either hpRatio or damageRatio exceeds 1 even if combined ratio is under 1', () => {
    const tankAlly = npcWorth(newNpc({
      name: 'Meat Shield',
      rank: 'C',
      archetype: 'brute',
      tier: 'normal',
      tweak: { hp: 10, dealt: 0.1, stats: {}, traits: [] },
      defaultSide: 'party',
    }), RULES);
    expect(tankAlly.ratio).toBeLessThan(1);
    expect(tankAlly.hpRatio).toBeGreaterThan(1);
    expect(tankAlly.damageRatio).toBeLessThan(1);
    expect(tankAlly.overAllyBudget).toBe(true);
    expect(tankAlly.warning).toBe(ALLY_OVER_BUDGET_WARNING);

    const glassAlly = npcWorth(newNpc({
      name: 'Glass Cannon',
      rank: 'C',
      archetype: 'brute',
      tier: 'normal',
      tweak: { hp: 0.1, dealt: 10, stats: {}, traits: [] },
      defaultSide: 'party',
    }), RULES);
    expect(glassAlly.ratio).toBeLessThan(1);
    expect(glassAlly.hpRatio).toBeLessThan(1);
    expect(glassAlly.damageRatio).toBeGreaterThan(1);
    expect(glassAlly.overAllyBudget).toBe(true);
    expect(glassAlly.warning).toBe(ALLY_OVER_BUDGET_WARNING);

    const lopsidedFoe = npcWorth(newNpc({
      name: 'Wall Foe',
      rank: 'C',
      archetype: 'brute',
      tier: 'normal',
      tweak: { hp: 10, dealt: 0.1, stats: {}, traits: [] },
      defaultSide: 'foe',
    }), RULES);
    expect(lopsidedFoe.overAllyBudget).toBe(false);
    expect(lopsidedFoe.warning).toBeNull();
  });

  test('stat tweaks and traits raise power ratio and custom abilities get abilityWorth + worthLine', () => {
    const base = newNpc({ name: 'Scout', rank: 'C', archetype: 'skirmisher', defaultSide: 'party' });
    const buffed = {
      ...base,
      tweak: { ...base.tweak, stats: { agi: 12 }, traits: ['tough', 'armored', 'fast'] as const },
      abilities: [ab('ab-1', 'Quick Cut'), ab('ab-2', 'Field Aid', 'support')],
    };
    const wBase = npcWorth(base, RULES);
    const wBuffed = npcWorth(buffed, RULES);
    expect(wBuffed.ratio).toBeGreaterThan(wBase.ratio);
    expect(wBuffed.abilities).toHaveLength(2);
    expect(wBuffed.abilities[0]!.line).toContain('Power rating:');
    expect(wBuffed.abilities[1]!.line).toContain('Power rating:');
  });
});

describe('NPC copy and library operations', () => {
  test('copyNpc gives the copy a new id and deep-clones nested tweak, abilities, and statuses', () => {
    const orig: Npc = {
      ...newNpc({
        name: 'Sera',
        rank: 'C',
        archetype: 'caster',
        tweak: { hp: 1.08, dealt: 0.93, stats: { pow: 4 }, traits: ['warded'] },
        abilities: [ab('ab-orig', 'Arc Spark', 'curse')],
        statuses: [{ key: 'hasted', rounds: 2 }],
        icon: 'orb',
        notes: 'Guild medic.',
      }),
      id: npcid('npc_1'),
    };
    const copied = copyNpc(orig, npcid('npc_2'), 'Sera (copy)');
    expect(copied.id).toBe(npcid('npc_2'));
    expect(copied.id).not.toBe(orig.id);
    expect(copied.name).toBe('Sera (copy)');
    expect({ ...copied, id: orig.id, name: orig.name }).toEqual(orig);

    // Mutating nested fields on the copy must not affect the original.
    copied.abilities.push(ab('ab-extra', 'Bonus'));
    copied.statuses[0]!.rounds = 9;
    (copied.tweak.stats as Record<string, number>).pow = 99;
    expect(orig.abilities).toHaveLength(1);
    expect(orig.statuses[0]!.rounds).toBe(2);
    expect(orig.tweak.stats.pow).toBe(4);
  });

  test('library saveEntry, duplicateEntry, removeEntry, and savedWords work for npcs up to LIMITS.libraryNpcs', () => {
    const start = newSave(dev('d')).library;
    const sera: Npc = {
      ...newNpc({ name: 'Sera', abilities: [ab('ab-s', 'Mend', 'support')] }),
      id: npcid('npc_1'),
    };
    const s1 = saveEntry(start, 'npcs', sera);
    expect(isRefused(s1)).toBe(false);
    if (isRefused(s1)) return;
    expect(s1.npcs).toEqual([sera]);

    // Case-insensitive duplicate name refused.
    expect(saveEntry(s1, 'npcs', { ...sera, id: npcid('npc_2'), name: 'SERA' })).toEqual({ ok: false, why: 'taken' });
    expect(savedWords('npc', 'Sera').taken).toContain('an NPC named "Sera"');

    // Duplicate entry gets a new id and deep-clones nested data.
    const dupName = copyName(sera.name, s1.npcs.map(n => n.name), NPC_BOUNDS.name);
    const s2 = duplicateEntry(s1, 'npcs', sera.id, { newId: npcid('npc_2'), name: dupName });
    expect(isRefused(s2)).toBe(false);
    if (isRefused(s2)) return;
    expect(s2.npcs.map(n => [n.id, n.name])).toEqual([['npc_1', 'Sera'], ['npc_2', 'Sera (copy)']]);
    s2.npcs[1]!.abilities.push(ab('ab-new', 'Spark'));
    expect(s2.npcs[0]!.abilities).toHaveLength(1);

    // Removing the copy leaves the original.
    const s3 = removeEntry(s2, 'npcs', npcid('npc_2'));
    expect(isRefused(s3)).toBe(false);
    if (!isRefused(s3)) expect(s3.npcs).toEqual([sera]);

    // Cap enforcement at LIMITS.libraryNpcs (100).
    const full = {
      ...start,
      npcs: Array.from({ length: LIMITS.libraryNpcs }, (_, i): Npc => ({
        ...newNpc({ name: `Ally ${i}` }),
        id: saveId('npc_', i + 1),
      })),
    };
    expect(saveEntry(full, 'npcs', { ...sera, id: saveId('npc_', 999), name: 'One More' })).toEqual({ ok: false, why: 'full' });
    expect(duplicateEntry(full, 'npcs', 'npc_1', { newId: 'npc_999', name: 'Ally 0 (copy)' })).toEqual({ ok: false, why: 'full' });
  });
});

describe('NPC pack round-trip', () => {
  const CHILL: StatusDef = { label: 'Rime', desc: 'Slows the target.', ops: [{ op: 'speed', pct: -15 }] };
  const rimeOp = (key = 'rime') => ({ op: 'applyStatus' as const, key: statusKey(key), def: CHILL, duration: tick(2 * RULES.fight.round) });

  test('one NPC packs without its id, brings referenced library statuses, rekeys on Add collision, and Replace is idempotent', () => {
    const from: Save = newSave(dev('d1'));
    from.seq = 10;
    from.library.statuses = { rime: clone(CHILL) };
    const rimeShot = abilityOf('shot', { id: abilityId('ab-rime'), name: 'Rime Shot', ops: [rimeOp()] }, RULES);
    const tpl: NpcTemplate = newNpc({
      name: 'Warden Kael',
      rank: 'B',
      archetype: 'skirmisher',
      tier: 'elite',
      tweak: { hp: 1.1, dealt: 0.95, stats: { agi: 4 }, traits: ['fast'] },
      defaultSide: 'foe',
      skill: 4,
      abilities: [rimeShot],
      statuses: [{ key: 'rime', rounds: 3 }],
      icon: 'bow',
      notes: 'Holds the north bridge.',
    });
    const kael: Npc = { ...tpl, id: npcid('npc_7') };
    from.library.npcs = [kael];

    const doc = packOf(from, '2026-11-27T00:00:00.000Z', 'npcs', kael.id);
    expect(Object.keys(doc.library).sort()).toEqual(['npcs', 'statuses']);
    expect(doc.library.statuses).toEqual({ rime: CHILL });
    expect(JSON.stringify(doc.library.npcs)).not.toContain('npc_7');

    const read = parsePack(clone(doc));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(packCounts(read.pack).npcs).toBe(1);
    expect(read.pack.npcs[0]).toEqual(tpl);

    // Merge onto empty save gets a fresh npc_ id.
    const empty = newSave(dev('d2'));
    empty.seq = 20;
    const landed = mergePack(empty, read.pack, 'add', stampSeq('a'));
    expect(landed.save.library.npcs).toHaveLength(1);
    expect(landed.save.library.npcs[0]!.id).toBe(npcid('npc_21'));
    const { id: _lid, ...landedTpl } = landed.save.library.npcs[0]!;
    expect(landedTpl).toEqual(tpl);
    expect(landed.save.library.statuses.rime).toEqual(CHILL);

    // Add onto a save that already holds both Warden Kael and rime renames both and rekeys the NPC's status refs.
    const added = mergePack(from, read.pack, 'add', stampSeq('b'));
    expect(added.report.npcs).toEqual({ added: 1, renamed: 1, replaced: 0, full: 0 });
    expect(added.save.library.npcs.map(n => n.name)).toEqual(['Warden Kael', 'Warden Kael 2']);
    expect(added.save.library.npcs[1]!.id).not.toBe(kael.id);
    expect(added.save.library.npcs[1]!.statuses).toEqual([{ key: 'rime-2', rounds: 3 }]);
    expect(added.save.library.npcs[1]!.abilities[0]!.ops).toEqual([rimeOp('rime-2')]);

    // Replace updates in place, keeps id, and is idempotent on repeat.
    const editedPack = { ...read.pack, npcs: [{ ...read.pack.npcs[0]!, notes: 'Updated notes.' }] };
    const rep1 = mergePack(from, editedPack, 'replace', stampSeq('c'));
    expect(rep1.report.npcs).toEqual({ added: 0, renamed: 0, replaced: 1, full: 0 });
    expect(rep1.save.library.npcs).toEqual([{ ...kael, notes: 'Updated notes.' }]);
    const rep2 = mergePack(rep1.save, editedPack, 'replace', stampSeq('d'));
    expect(rep2.save.library.npcs).toEqual(rep1.save.library.npcs);
  });

  test(`pack cap enforces at most ${PACK_CAP.npcs} NPCs`, () => {
    const raw = {
      schema: SCHEMA,
      kind: 'library',
      library: {
        npcs: Array.from({ length: PACK_CAP.npcs + 10 }, (_, i) => ({ name: `NPC ${i}` })),
      },
    };
    const read = parsePack(raw);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.counts.npcs).toEqual({ kept: PACK_CAP.npcs, unreadable: 0, over: 10 });
  });
});
