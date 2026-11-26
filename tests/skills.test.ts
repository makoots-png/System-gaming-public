// Every built-in and starter skill in src/core/registry/skills.ts must pass these. A new skill is checked here with no new test.
import { describe as group, expect, test } from 'bun:test';
import { BONUS_KEYS, RULES } from '../src/core/rules.ts';
import { SKILL_ABILITIES } from '../src/core/registry/abilities.ts';
import { SKILL_BOUNDS, SKILL_SEEDS, STARTER_SKILLS, parseSkill, skillOf } from '../src/core/registry/skills.ts';
import type { SkillDef, SkillTemplate } from '../src/core/registry/skills.ts';
import { parseStatusDef } from '../src/core/combat/fight-parse.ts';

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const LISTS: [string, readonly SkillDef[]][] = [['built-in', SKILL_SEEDS], ['starter', Object.values(STARTER_SKILLS)]];
const ability = (name: keyof typeof SKILL_ABILITIES) => SKILL_ABILITIES[name](RULES);

for (const [list, defs] of LISTS) {
  for (const def of defs) {
    const skill = skillOf(def, RULES);
    group(`the ${list} skill ${def.name}`, () => {
      test('has a name the Skills panel keeps whole (60 characters) and a description', () => {
        expect(def.name.trim()).toBe(def.name);
        expect(def.name.length).toBeGreaterThan(0);
        expect(def.name.length).toBeLessThanOrEqual(SKILL_BOUNDS.name);
        expect(def.desc.trim()).not.toBe('');
        expect(def.desc.length).toBeLessThanOrEqual(SKILL_BOUNDS.desc);
      });

      test('reads back unchanged through parseSkill, the reader the save, a sheet, a form and a reward use, its ability too', () => {
        expect(parseSkill(copy(skill))).toEqual(skill);
      });

      test('an active one is used in a fight as its entry in the built-in abilities', () => {
        if (def.type === 'active') expect(skill).toMatchObject({ type: 'active', ability: SKILL_ABILITIES[def.name](RULES) });
      });

      test('a passive one\'s bonus is whole numbers on one of the eight stats, max HP or max mana, none of them zero', () => {
        if (skill.type !== 'passive') return;
        for (const [k, v] of Object.entries(skill.bonus)) {
          expect(BONUS_KEYS as readonly string[]).toContain(k);
          expect(Number.isInteger(v) && v !== 0).toBe(true);
        }
      });
    });
  }
}

test('no two built-in or starter skills share a name', () => {
  for (const [, defs] of LISTS) {
    const names = defs.map(s => s.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  }
  const distinct = [...new Set(LISTS.flatMap(([, defs]) => defs))];
  const names = distinct.map(s => s.name.toLowerCase());
  expect(new Set(names).size).toBe(names.length);
});

group('the skills as plan section 3.5 restates them', () => {
  test('Bloodlust adds Strength 1; Iron Skin\'s old AC 1 is Vitality 2; Trailsense and Mana Sense add nothing', () => {
    const bonus = (d: SkillDef) => { const s = skillOf(d, RULES); return s.type === 'passive' ? s.bonus : null; };
    expect(bonus(SKILL_SEEDS.find(s => s.name === 'Bloodlust')!)).toEqual({ str: 1 });
    expect([STARTER_SKILLS.ironSkin, STARTER_SKILLS.trailsense, STARTER_SKILLS.manaSense].map(bonus)).toEqual([{ vit: 2 }, {}, {}]);
  });

  test('Dagger Rush and Shield Wall are used as their abilities; Arise has none in a fight', () => {
    const of = (d: SkillDef) => { const s = skillOf(d, RULES); return s.type === 'active' ? s.ability : undefined; };
    expect(of(SKILL_SEEDS.find(s => s.name === 'Dagger Rush')!)).toEqual(ability('Dagger Rush'));
    expect(of(STARTER_SKILLS.shieldWall)).toEqual(ability('Shield Wall'));
    expect(of(SKILL_SEEDS.find(s => s.name === 'Arise')!)).toBeNull();
  });

  test('a GM\'s edited Hasted reaches the Sprint a hunter adds', () => {
    const hasted = { label: 'Hasted', desc: 'Quick.', ops: [] };
    const s = skillOf(SKILL_SEEDS.find(x => x.name === 'Sprint')!, { ...RULES, conditions: { ...RULES.conditions, hasted } });
    expect(s.type === 'active' && s.ability?.ops[0]).toMatchObject({ op: 'applyStatus', def: hasted });
  });
});

group('reading a skill from outside data', () => {
  const blank: SkillTemplate = { name: 'Sprint', type: 'active', level: 1, label: null, desc: '', ability: null };

  test('what is not an object, or has no name, is not a skill', () => {
    for (const v of [null, undefined, 3, 'Sprint', [], [{ name: 'Sprint' }], {}, { name: '' }, { name: '   ' }, { name: 7 }]) expect(parseSkill(v)).toBeNull();
  });

  test('a skill with only a name is an active skill of that name with no fight ability', () => {
    expect(parseSkill({ name: '  Sprint ' })).toEqual(blank);
  });

  test('a level is a whole number from 1 to 10', () => {
    expect([40, 0, 2.9].map(level => parseSkill({ name: 'X', level })!.level)).toEqual([10, 1, 2]);
  });

  test('a name is 60 characters, a label 12 (blank is none) and a description 500', () => {
    const s = parseSkill({ name: 'n'.repeat(80), label: '  Lv.3 of many levels ', desc: 'd'.repeat(900) });
    expect(s).toMatchObject({ name: 'n'.repeat(60), label: 'Lv.3 of many', desc: 'd'.repeat(500) });
    expect(parseSkill({ name: 'X', label: '   ' })!.label).toBeNull();
  });

  test('a field of the wrong type or value takes the default', () => {
    expect(parseSkill({ name: 'Sprint', type: 'aura', level: 'high', label: 4, desc: 4, ability: 'run' })).toEqual(blank);
  });

  test('the old fields are dropped: MP cost, cooldown and its count, dice, effects, target, a roll to hit, the path mark and a grade', () => {
    const old = { name: 'Sprint', mpCost: 2, cooldown: 3, cdLeft: 1, dice: '1d6', effects: [{ op: 'note', text: 'x' }], target: 'other', attack: true, perk: 'vanguard', grade: 'D', id: 's4' };
    expect(parseSkill(old)).toEqual(blank);
  });

  test('an active skill\'s ability is read by the fight\'s reader: a whole one is kept, a broken one is none', () => {
    const rush = ability('Dagger Rush')!;
    expect(parseSkill({ name: 'Rush', ability: copy(rush) })).toMatchObject({ type: 'active', ability: rush });
    expect(parseSkill({ name: 'Rush', ability: { ...copy(rush), kind: 'laser' } })).toMatchObject({ type: 'active', ability: null });
    expect(parseSkill({ name: 'Rush', ability: { ...copy(rush), cost: { ...rush.cost, time: 0 } } })).toMatchObject({ ability: null });
  });

  test('a passive skill keeps the ten bonus keys that are not 0, as whole numbers inside 999, and no ability', () => {
    const s = parseSkill({ name: 'X', type: 'passive', ability: copy(ability('Mutilation')), bonus: { str: 2, luck: 5, hpMax: 5000, vit: -1.5, agi: 0, ins: 'two', ac: 1, con: 3, manaMax: 3 } });
    expect(s).toEqual({ name: 'X', type: 'passive', level: 1, label: null, desc: '', bonus: { str: 2, hpMax: 999, vit: -1, manaMax: 3 } });
  });

  test('an active skill has no bonus, whatever was written', () => {
    expect(parseSkill({ name: 'X', bonus: { str: 2 } })).not.toHaveProperty('bonus');
  });

  test('a passive skill keeps the status it wears into a fight as the status reader reads it; a broken one is none, an active one has none', () => {
    const worn = { label: 'Pain is Power', desc: 'Each hit taken adds Pain.', ops: [],
      triggers: [{ on: 'struck', tag: null, to: 'self', limit: { kind: 'each' }, ops: [{ op: 'note', text: 'Pain' }] }] };
    const s = parseSkill({ name: 'Pain is Power', type: 'passive', worn: copy(worn) });
    expect(s).toEqual({ name: 'Pain is Power', type: 'passive', level: 1, label: null, desc: '', bonus: {}, worn: parseStatusDef(worn, RULES)! });
    expect(parseSkill(copy(s))).toEqual(s);
    expect(parseSkill({ name: 'X', type: 'passive', worn: { desc: 'no label' } })).not.toHaveProperty('worn');
    expect(parseSkill({ name: 'X', type: 'passive', worn: 'Pain' })).not.toHaveProperty('worn');
    expect(parseSkill({ name: 'X', worn: copy(worn) })).not.toHaveProperty('worn');
  });
});
