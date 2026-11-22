// Every kit example in src/core/registry/kit-examples.ts must pass these. A new example is checked here with no new test.
import { describe as group, expect, test } from 'bun:test';
import { formulaOf } from '../src/core/registry/ability-kinds.ts';
import { RANKS, RULES } from '../src/core/rules.ts';
import { exampleSkills, exampleStatuses } from '../src/core/registry/kit-examples.ts';
import { parseSkill } from '../src/core/registry/skills.ts';
import { parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { STATUS_KEY_RE } from '../src/core/combat/effect-ops.ts';
import { abilityWorth, gateCredit, wornWorth } from '../src/core/registry/worth.ts';
import { printFormula } from '../src/core/formula.ts';
import { baseStats } from '../src/core/stats.ts';
import { modified, statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
import type { Origin, StatusDef } from '../src/core/combat/effect-ops.ts';
import { hideOf, stealthOf } from '../src/core/combat/standing.ts';
import { perceives } from '../src/core/combat/sight.ts';
import { openGrid, place } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';

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

group('the stealth examples (notes-7-stealth.md section 5)', () => {
  const K = exampleSkills(RULES), by = (name: string) => K.find(k => k.name === name)!;
  const worn = (name: string): StatusDef => { const k = by(name); if (k.type !== 'passive' || !k.worn) throw new Error(name); return k.worn; };
  const ability = (name: string) => { const k = by(name); if (k.type !== 'active' || !k.ability) throw new Error(name); return k.ability; };
  const on = (key: string, def: StatusDef, tier = 0) => statusOn(def, { key: statusKey(key), source: { id: null, tier }, until: null, since: tick(0), settledAt: tick(0) });
  const HUNTER: Origin = { kind: 'hunter', build: { stats: baseStats(RULES.fight), level: 1, gear: [], perks: {} } };
  const vanished = exampleStatuses(RULES).vanished!;

  test('Vanish puts Vanished on its user for 2 rounds, ready again 5 rounds later, and hides it in the open at 0, 0, 1, 1, 2, 2 by rank', () => {
    const a = ability('Vanish');
    expect([a.aim, a.effect, a.cost.cooldown]).toEqual(['self', null, 5 * RULES.fight.round]);
    expect(a.ops).toEqual([{ op: 'applyStatus', key: statusKey('vanished'), def: vanished, duration: 2 * RULES.fight.round }]);
    expect(vanished.ops).toEqual([{ op: 'hidden', level: [0, 0, 1, 1, 2, 2], start: 'anywhere', ends: { hurt: true, revealed: true, dealt: true } }]);
  });

  test('Unseen Blade keeps its bearer hidden when it deals damage, and only then', () => {
    expect([...stealthOf({ statuses: [on('unseen-blade', worn('Unseen Blade'))] }).kept]).toEqual(['dealt']);
  });

  test('a foe with Hunter\'s Eye sees a Vanished hunter of rank E to B (level 0 or 1) and not one of rank A or S (level 2: stealth beats sight at the same level)', () => {
    const sight = modified(HUNTER, [on('hunters-eye', worn('Hunter\'s Eye'))], RULES).sheet.sight;
    expect(sight).toBe(2);
    const sees = RANKS.map((_, t) => perceives({ place: place(0, 0), side: 'foe', up: true, sight }, { place: place(5, 0), side: 'party', stealth: hideOf(statusKey('vanished'), vanished, t)!.level },
      openGrid(20, 14), { kind: 'whole' }));
    expect(sees).toEqual([true, true, true, true, false, false]);
  });

  test('Flare is a blast at a place that deals nothing and reveals each body it lands on', () => {
    const a = ability('Flare');
    expect([a.kind, a.aim, a.effect, a.ops]).toEqual(['blast', 'place', null, [{ op: 'reveal' }]]);
  });
});
