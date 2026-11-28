import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { saveId } from '../src/core/ids.ts';
import type { Ability } from '../src/core/combat/ability-types.ts';
import { abilityId } from '../src/core/combat/ability-types.ts';
import type { LandOp, Op, StatusDef, UseOp } from '../src/core/combat/effect-ops.ts';
import { opLines } from '../src/core/combat/effect-ops.ts';
import { parseAbility } from '../src/core/combat/fight-parse.ts';
import { hunterAbilities } from '../src/core/combat/rows.ts';
import { detailOf } from '../src/core/detail.ts';
import { newHunter } from '../src/core/save.ts';
import { abilityOf, describeAbility } from '../src/core/registry/ability-kinds.ts';
import { ARCHETYPE_ATTACKS, itemAbility, weaponAttack } from '../src/core/registry/abilities.ts';
import { CLASS_SIGNATURES } from '../src/core/registry/class-powers.ts';
import { CLASS_TREES } from '../src/core/registry/class-trees.ts';
import { BUILT_IN_ITEMS } from '../src/core/registry/items.ts';
import { KEYSTONES } from '../src/core/registry/keystones.ts';
import { exampleSkills } from '../src/core/registry/kit-examples.ts';

function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d+(?:\.\d+)?/g)].map(m => m[0]);
}

function addNumbersFrom(set: Set<string>, value: unknown): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const abs = Math.abs(value);
    set.add(String(abs));
    if (abs > 0 && abs <= 1) set.add(String(Math.round(abs * 100)));
    return;
  }
  if (typeof value === 'string') {
    for (const n of numbersIn(value)) set.add(n);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) addNumbersFrom(set, item);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) addNumbersFrom(set, v);
  }
}

/** Collects every number that legitimately exists on an ability, its generated lines, or its applied statuses. */
function realNumbersOf(a: Ability): Set<string> {
  const nums = new Set<string>();
  const roundTicks = RULES.fight.round;
  for (const line of describeAbility(a, RULES)) addNumbersFrom(nums, line);
  for (const line of opLines(a.ops, 0, RULES)) addNumbersFrom(nums, line);
  for (const line of opLines(a.ops, 5, RULES)) addNumbersFrom(nums, line);
  addNumbersFrom(nums, a.cost.fatigue);
  addNumbersFrom(nums, a.cost.mana);
  if (a.cost.cooldown > 0) addNumbersFrom(nums, Math.round(a.cost.cooldown / roundTicks));
  addNumbersFrom(nums, a.effect);
  addNumbersFrom(nums, a.range);
  addNumbersFrom(nums, a.shape);
  if (a.react) addNumbersFrom(nums, a.react.reach);
  if (a.channel) addNumbersFrom(nums, a.channel);
  if (a.summon) addNumbersFrom(nums, a.summon);
  if (a.raise) addNumbersFrom(nums, a.raise);
  if (a.usurp) addNumbersFrom(nums, a.usurp);
  if (a.zoneAct) addNumbersFrom(nums, a.zoneAct);
  if (a.gates) addNumbersFrom(nums, a.gates);
  if (a.prices) addNumbersFrom(nums, a.prices);
  if (a.zone) {
    if (a.zone.duration !== null) addNumbersFrom(nums, Math.round(a.zone.duration / roundTicks));
    addNumbersFrom(nums, a.zone.around);
    addNumbersFrom(nums, a.zone.grow);
    addNumbersFrom(nums, a.zone.ops);
    if (a.zone.end) addNumbersFrom(nums, a.zone.end);
  }
  const visitStatus = (def: StatusDef) => {
    addNumbersFrom(nums, def.desc);
    addNumbersFrom(nums, def.ops);
    if (def.stack) addNumbersFrom(nums, def.stack);
    if (def.triggers) {
      for (const tr of def.triggers) {
        addNumbersFrom(nums, tr.to);
        for (const op of tr.ops) visitOp(op);
      }
    }
    if (def.end) {
      for (const op of def.end.ops) visitOp(op);
    }
  };
  const visitOp = (op: UseOp | Op | LandOp) => {
    addNumbersFrom(nums, op);
    if (op.op === 'applyStatus') {
      if (op.duration !== null) addNumbersFrom(nums, Math.round(Number(op.duration) / roundTicks));
      visitStatus(op.def);
    }
  };
  for (const op of a.ops) visitOp(op);
  return nums;
}

function allClassAbilities(): { source: string; ability: Ability; isUpgrade: boolean }[] {
  const out: { source: string; ability: Ability; isUpgrade: boolean }[] = [];
  for (const [cls, sig] of Object.entries(CLASS_SIGNATURES)) {
    for (const a of sig?.actives ?? []) out.push({ source: `${cls} signature: ${a.name}`, ability: a, isUpgrade: false });
  }
  for (const [cls, tree] of Object.entries(CLASS_TREES)) {
    for (const node of tree?.nodes ?? []) {
      for (const gift of node.gifts) {
        if (gift.kind === 'replace-active') {
          out.push({ source: `${cls} tree (${node.name}): ${gift.active.name}`, ability: gift.active, isUpgrade: true });
        }
      }
    }
  }
  return out;
}

function allKeystoneActives(): { source: string; ability: Ability }[] {
  const out: { source: string; ability: Ability }[] = [];
  for (const group of [KEYSTONES.mark, KEYSTONES.apex, KEYSTONES.confluence]) {
    for (const maker of Object.values(group)) {
      const ks = maker(RULES);
      if (ks.active) out.push({ source: `keystone ${ks.name}`, ability: ks.active });
      if (ks.awakened?.active) out.push({ source: `keystone awakened ${ks.name}`, ability: ks.awakened.active });
    }
  }
  return out;
}

describe('shipped combat ability descriptions', () => {
  test('every class signature active and replace-active upgrade has a non-empty trimmed desc', () => {
    const all = allClassAbilities();
    const base = all.filter(x => !x.isUpgrade);
    const upgrades = all.filter(x => x.isUpgrade);
    expect(base.length).toBe(102);
    expect(upgrades.length).toBeGreaterThan(0);
    const missing = all.filter(x => !x.ability.desc?.trim()).map(x => x.source);
    expect(missing).toEqual([]);
  });

  test('weaponAttack forms and archetype attacks have non-empty trimmed descs', () => {
    const unarmed = weaponAttack(null, RULES);
    const sword = weaponAttack({ name: 'Iron Sword', dice: '1d8', attack: 'strike' }, RULES);
    const bow = weaponAttack({ name: 'Longbow', dice: '1d8', attack: 'shot' }, RULES);
    const archetypes = Object.values(ARCHETYPE_ATTACKS).map(fn => fn(RULES));
    for (const a of [unarmed, sword, bow, ...archetypes]) {
      expect(a.desc?.trim(), `${a.name} desc`).toBeTruthy();
    }
  });

  test('every consumable itemAbility() carries the item description', () => {
    const consumables = [...BUILT_IN_ITEMS.values()].filter(
      (i): i is Extract<typeof i, { type: 'consumable' }> => i.type === 'consumable' && i.effects.length > 0,
    );
    expect(consumables.length).toBeGreaterThanOrEqual(25);
    for (const item of consumables) {
      const target = 'target' in item && (item.target === 'self' || item.target === 'other') ? item.target : undefined;
      const a = itemAbility({
        id: `it-${item.name}` as never,
        name: item.name,
        desc: item.desc,
        rar: item.rar,
        effects: item.effects,
        ...(target ? { target } : {}),
      }, RULES);
      expect(a, `${item.name} ability`).not.toBeNull();
      expect(a!.desc).toBe(item.desc.trim());
    }
  });

  test('every kit-example active ability and the three formerly empty worn statuses have non-empty descs', () => {
    const skills = exampleSkills(RULES);
    const actives = skills.flatMap(s => (s.type === 'active' && s.ability ? [{ name: s.name, ability: s.ability }] : []));
    const wornByName = new Map(skills.flatMap(s => (s.type === 'passive' && s.worn ? [[s.worn.label, s.worn.desc] as const] : [])));
    expect(actives.length).toBe(11);
    for (const { name, ability } of actives) {
      expect(ability.desc?.trim(), `${name} active desc`).toBeTruthy();
    }
    for (const label of ['Pain is Power', 'Unseen Blade', "Hunter's Eye"]) {
      expect(wornByName.get(label)?.trim(), `${label} worn desc`).toBeTruthy();
    }
  });

  test('shipped item actives and keystone actives have non-empty descs', () => {
    const itemActives = [...BUILT_IN_ITEMS.values()].flatMap(i => ('active' in i && i.active ? [{ name: i.name, ability: i.active }] : []));
    expect(itemActives.length).toBeGreaterThan(0);
    for (const { name, ability } of itemActives) expect(ability.desc?.trim(), `${name} active`).toBeTruthy();
    const ksActives = allKeystoneActives();
    expect(ksActives.length).toBeGreaterThan(0);
    for (const { source, ability } of ksActives) expect(ability.desc?.trim(), source).toBeTruthy();
  });

  test('every digit in an authored shipped ability desc matches a real number on that ability', () => {
    const checked: { source: string; ability: Ability }[] = [
      ...allClassAbilities(),
      { source: 'weaponAttack unarmed', ability: weaponAttack(null, RULES) },
      { source: 'weaponAttack sword', ability: weaponAttack({ name: 'Iron Sword', dice: '1d8', attack: 'strike' }, RULES) },
      { source: 'weaponAttack bow', ability: weaponAttack({ name: 'Longbow', dice: '1d8', attack: 'shot' }, RULES) },
      ...Object.entries(ARCHETYPE_ATTACKS).map(([k, fn]) => ({ source: `archetype ${k}`, ability: fn(RULES) })),
      ...exampleSkills(RULES).flatMap(s => (s.type === 'active' && s.ability ? [{ source: `kit-example ${s.name}`, ability: s.ability }] : [])),
      ...[...BUILT_IN_ITEMS.values()].flatMap(i => ('active' in i && i.active ? [{ source: `item ${i.name}`, ability: i.active }] : [])),
      ...allKeystoneActives(),
    ];
    const mismatches: string[] = [];
    for (const { source, ability } of checked) {
      const desc = ability.desc?.trim() ?? '';
      const real = realNumbersOf(ability);
      for (const num of numbersIn(desc)) {
        if (!real.has(num)) mismatches.push(`${source}: "${num}" in "${desc}"`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe('ability desc parsing, skill fallback, and detailOf', () => {
  test('parseAbility keeps a present desc, stays valid without one, and rejects invalid desc values', () => {
    const base = abilityOf('strike', { id: abilityId('test-slash'), name: 'Test Slash', desc: 'Strike a nearby foe.' }, RULES);
    const kept = parseAbility(base, RULES);
    expect(kept?.desc).toBe('Strike a nearby foe.');

    const { desc: _drop, ...withoutDesc } = base;
    const legacy = parseAbility(withoutDesc, RULES);
    expect(legacy).not.toBeNull();
    expect(legacy?.desc).toBeUndefined();

    const blank = parseAbility({ ...base, desc: '   ' }, RULES);
    expect(blank).not.toBeNull();
    expect(blank?.desc).toBeUndefined();

    expect(parseAbility({ ...base, desc: 42 }, RULES)).toBeNull();
    expect(parseAbility({ ...base, desc: 'x'.repeat(501) }, RULES)).toBeNull();
  });

  test('hunterAbilities copies skill.desc onto an active ability that has no desc', () => {
    const h = newHunter(RULES);
    const noDesc = abilityOf('curse', { id: abilityId('custom-hex'), name: 'Custom Hex' }, RULES);
    const withDesc = abilityOf('curse', { id: abilityId('authored-hex'), name: 'Authored Hex', desc: 'Authored line.' }, RULES);
    const [potionDefId, samplePotion] = [...BUILT_IN_ITEMS.entries()].find(
      (entry): entry is [typeof entry[0], Extract<typeof entry[1], { type: 'consumable' }>] => entry[1].type === 'consumable' && entry[1].effects.length > 0,
    )!;
    const abilities = hunterAbilities({
      ...h,
      skills: [
        { type: 'active', desc: 'From the skill card.', ability: noDesc },
        { type: 'active', desc: 'Ignored skill line.', ability: withDesc },
      ],
      items: [{
        kind: 'ref',
        id: saveId('i', 1),
        defId: potionDefId,
        qty: 1,
      }],
    }, RULES);
    expect(abilities.find(a => a.id === 'custom-hex')?.desc).toBe('From the skill card.');
    expect(abilities.find(a => a.id === 'authored-hex')?.desc).toBe('Authored line.');
    expect(abilities.find(a => a.name === samplePotion.name)?.desc).toBe(samplePotion.desc.trim());
  });

  test('detailOf shows trimmed ability desc in about, base cooldown, and live fight limits when passed', () => {
    const base = abilityOf('strike', { id: abilityId('live-test'), name: 'Live Test', desc: '  Hit hard and step back.  ' }, RULES);
    const withCd: Ability = { ...base, cost: { ...base.cost, cooldown: (2 * RULES.fight.round) as Ability['cost']['cooldown'] } };
    const plain = detailOf({ kind: 'ability', ability: withCd }, RULES);
    expect(plain.about).toBe('Hit hard and step back.');
    expect(plain.lines).toContain('Cooldown: 2 rounds.');

    const live = detailOf({
      kind: 'ability',
      ability: withCd,
      live: { wait: 2, left: 1, react: 'armed', cost: { fatigue: 3, mana: 0 } },
    }, RULES);
    expect(live.lines).toContain('Ready in 2 rounds.');
    expect(live.lines).toContain('1 use left.');
    expect(live.lines).toContain('Armed.');
    expect(live.lines).toContain('Costs 3 fatigue.');

    const noDesc = abilityOf('strike', { id: abilityId('no-desc'), name: 'Plain Move' }, RULES);
    expect(detailOf({ kind: 'ability', ability: noDesc }, RULES).about).toBe('');
  });
});
