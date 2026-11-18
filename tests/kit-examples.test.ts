// Every kit example in src/core/registry/kit-examples.ts must pass these. A new example is checked here with no new test.
import { describe as group, expect, test } from 'bun:test';
import { formulaOf } from '../src/core/registry/ability-kinds.ts';
import { RULES } from '../src/core/rules.ts';
import { exampleSkills, exampleStatuses } from '../src/core/registry/kit-examples.ts';
import { parseSkill } from '../src/core/registry/skills.ts';
import { parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { STATUS_KEY_RE } from '../src/core/combat/effect-ops.ts';
import { abilityWorth, gateCredit, wornWorth } from '../src/core/registry/worth.ts';
import { printFormula } from '../src/core/formula.ts';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

for (const [key, def] of Object.entries(exampleStatuses(RULES))) {
  group(`the example status ${def.label}`, () => {
    test('has a key the library keeps and reads back unchanged through the status reader', () => {
      expect(key).toMatch(STATUS_KEY_RE);
      expect(parseStatusDef(copy(def), RULES)).toEqual(def);
    });
  });
}

const exampleAbilities = exampleSkills(RULES).flatMap(s => (s.type === 'active' && s.ability ? [s.ability] : []));
for (const skill of exampleSkills(RULES)) {
  group(`the example skill ${skill.name}`, () => {
    test('reads back unchanged through parseSkill, as the Workshop\'s Duplicate saves it', () => {
      expect(parseSkill(copy(skill))).toEqual(skill);
    });
    test('is inside its budget, with the credit of the mode that opens it among the examples: the maker shows no warning on it (design 3, the tolerance)', () => {
      const w = skill.type === 'active' ? (skill.ability ? abilityWorth(skill.ability, RULES, { credit: gateCredit(skill.ability, exampleAbilities, RULES) }) : null) : skill.worn ? wornWorth(skill.worn, RULES) : null;
      expect(w).not.toBeNull();
      expect(w!.over).toBe(false);
    });
  });
}

test('the examples carry the simulation\'s numbers: Bloodletting and Disaster Stroke are the shares of Arc Bolt the kits\' rows play', () => {
  const K = RULES.fight.kit.examples, by = (name: string) => formulaOf(exampleAbilities.find(a => a.name === name)!, RULES)!;
  expect(printFormula(by('Bloodletting'))).toBe(`${K.blood.share} * (2d6 + mag)`);
  expect(printFormula(by('Disaster Stroke'))).toBe(`${K.mark.share} * (2d6 + mag)`);
});

test('the examples hold every block the brief names: a stacking status with a threshold, a trigger passive, an HP cost with a scaler, a delayed curse, a mark that detonates, a reaction and a summon', () => {
  const S = Object.values(exampleStatuses(RULES)), K = exampleSkills(RULES);
  const abilities = K.flatMap(k => (k.type === 'active' && k.ability ? [k.ability] : []));
  expect(S.some(d => d.stack?.threshold && d.stack.threshold.to.kind === 'bearer')).toBe(true);
  expect(S.some(d => d.stack?.threshold && d.stack.threshold.to.kind === 'area')).toBe(true);
  expect(S.some(d => d.end)).toBe(true);
  expect(K.some(k => k.type === 'passive' && k.worn?.triggers?.length)).toBe(true);
  expect(abilities.some(a => a.prices?.some(p => p.kind === 'hp') && a.effect && printFormula(formulaOf(a, RULES)!).includes('target.missing'))).toBe(true);
  expect(abilities.some(a => a.react)).toBe(true);
  expect(abilities.some(a => a.summon)).toBe(true);
  expect(abilities.some(a => a.gates?.some(g => g.kind === 'holds'))).toBe(true);
});
