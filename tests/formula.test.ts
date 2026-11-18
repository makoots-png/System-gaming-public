import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { average, diceOf, diceModsOf, evaluate, EXPLODE_MAX, mean, meets, naturalOf, parseFormula, printFormula, REROLL_MAX, rolled, rollOf, withEdge } from '../src/core/formula.ts';
import type { Dice, Env, Formula, KitScope, Rolled, Scope } from '../src/core/formula.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import { SHEET_LABELS, share } from '../src/core/hunter/derive.ts';
import type { Sheet, SheetNumber } from '../src/core/hunter/derive.ts';
import { STAT_KEYS } from '../src/core/stats.ts';
import type { Stats } from '../src/core/stats.ts';
import { tiles } from '../src/core/combat/space.ts';

const LIMITS = { dice: { maxDice: 50, maxSides: 1000 } };

// A C bruiser using an ability on a C skirmisher, with the numbers of tables 2.3.C and 2.6 where the examples read them.
// Every other number is distinct, so a name that read the wrong field would show.
const sheet = (o: Partial<Sheet>): Sheet => ({
  hpMax: 95, manaMax: 10, fatigueMax: 114, carry: 43, weight: 18, speed: 100, move: 6, stride: tiles(3), armor: 39, resist: 5,
  pen: share(0.02), penFlat: 3, phys: 26.16, mag: 6, sup: 26.16, react: 10.5, aim: 11, will: 12, critFaces: 2, critSize: 1.5, opening: 1,
  tenacity: 17, potency: 14, threat: 1.46, hold: share(0.22), costCut: share(0.07), shadows: 8, ...o,
});
const stats = (o: Partial<Stats>): Stats => ({ str: 10, agi: 10, vit: 10, ins: 10, dis: 10, pre: 10, pow: 10, ctl: 10, ...o });
const SCOPE: Scope = {
  user: { stats: stats({ str: 63, vit: 33 }), sheet: sheet({ mag: 26.16 }) },
  target: { stats: stats({ agi: 40, str: 22 }), sheet: sheet({ hpMax: 48, armor: 10, speed: 138, phys: 10.92 }) },
  charge: 0,
};

const parse = (text: string): Formula => {
  const r = parseFormula(text, LIMITS);
  if (!r.ok) throw new Error(`${text}: ${r.error}`);
  return r.formula;
};
const value = (text: string, dice: number[] = [], over: Partial<Env> = {}): number => evaluate(parse(text), { ...SCOPE, dice, ...over });
const refusal = (text: string): string => {
  const r = parseFormula(text, LIMITS);
  if (r.ok) throw new Error(`${text} was read as ${printFormula(r.formula)}`);
  return r.error;
};

describe('what a formula may hold', () => {
  test('a number, whole or with a decimal point', () => {
    expect([value('7'), value('1.5'), value('.5'), value('  12  ')]).toEqual([7, 1.5, 0.5, 12]);
  });

  test('a dice term reads the total the edge rolled for it, in reading order', () => {
    expect(value('2d6', [9])).toBe(9);
    expect(value('1d8 + 3d6 * 2', [5, 11])).toBe(27);
  });

  test('a bare name reads the user, and target. reads the target', () => {
    expect(value('str')).toBe(63);
    expect(value('target.str')).toBe(22);
    expect(value('armor')).toBe(39);
    expect(value('target.armor')).toBe(10);
  });

  test('a name is read without regard to case', () => {
    expect([value('STR'), value('Target.HPMAX'), value('hpmax')]).toEqual([63, 48, 95]);
  });

  test('charge reads the use\'s charge', () => {
    expect(value('charge', [], { charge: 3 })).toBe(3);
  });

  test('min and max take two parts', () => {
    expect(value('min(3, 1d4)', [4])).toBe(3);
    expect(value('max(2, target.str)')).toBe(22);
    expect(value('max(min(1, 2), -5)')).toBe(1);
  });

  test('every stat and every sheet number is a name, so a new Sheet field is one with no change to the parser', () => {
    for (const key of STAT_KEYS) expect([key, value(key), value(`target.${key}`)]).toEqual([key, SCOPE.user.stats[key], SCOPE.target.stats[key]]);
    for (const key of Object.keys(SHEET_LABELS) as SheetNumber[]) {
      expect([key, value(key), value(`target.${key}`)]).toEqual([key, SCOPE.user.sheet[key], SCOPE.target.sheet[key]]);
    }
  });

  test('no two names are the same, and none is min, max or target, so a name has one meaning', () => {
    const names = [...STAT_KEYS, ...Object.keys(SHEET_LABELS), 'charge', 'min', 'max', 'target'].map(k => k.toLowerCase());
    expect(names.filter((k, i) => names.indexOf(k) !== i)).toEqual([]);
  });
});

describe('the order of operations', () => {
  test('* and / bind before + and -', () => {
    expect(value('2+3*4')).toBe(14);
    expect(value('(2+3)*4')).toBe(20);
    expect(value('20 - 6 / 2')).toBe(17);
  });

  test('+, -, * and / group from the left', () => {
    expect(value('10 - 4 - 3')).toBe(3);
    expect(value('100 / 10 / 2')).toBe(5);
  });

  test('^ groups from the right: 2^3^2 is 2^9', () => {
    expect(value('2^3^2')).toBe(512);
    expect(value('(2^3)^2')).toBe(64);
  });

  test('a leading minus applies to the whole power, so -2^2 is -4 as school arithmetic reads it', () => {
    expect(value('-2^2')).toBe(-4);
    expect(value('(-2)^2')).toBe(4);
    expect(value('-(2^2)')).toBe(-4);
    expect(value('2^-1')).toBe(0.5);
    expect(value('2^-1^2')).toBe(0.5);
  });

  test('^ binds before * and /', () => {
    expect(value('10 * 1.45 ^ 2')).toBeCloseTo(21.025, 10);
    expect(value('2 * 3 ^ 2')).toBe(18);
  });

  test('a minus sign may follow an operator or another minus', () => {
    expect([value('2*-3'), value('--3'), value('-3+5'), value('5 - -2')]).toEqual([-6, 3, 2, 7]);
  });
});

describe('a step that gives no number', () => {
  test('division by 0 is 0 (design 3.4), and so is 0 / 0', () => {
    expect([value('5/0'), value('0/0'), value('1 + 5 / (str - str)')]).toEqual([0, 0, 1]);
  });

  test('a root of a negative number or an overflow is 0, and the rest of the formula still counts', () => {
    expect(value('(-8)^0.5')).toBe(0);
    expect(value('3 + 10^400')).toBe(3);
  });
});

describe('the design\'s formulas', () => {
  test('3.A: Cleave, 1d8 + phys, by a C bruiser with a 6 on the die is 6 + 26.16', () => {
    expect(value('1d8 + phys', [6])).toBeCloseTo(32.16, 10);
  });

  test('3.C: Meteor, 3d8 + 1.5 * mag, averages 13.5 + 1.5 * 26.16', () => {
    expect(average(parse('3d8 + 1.5 * mag'), SCOPE)).toBeCloseTo(52.74, 10);
  });

  test('4.4: a support\'s shield, sup * 1.5, is 39.24 at C', () => {
    expect(value('sup * 1.5')).toBeCloseTo(39.24, 10);
  });

  test('4.1: a linear channel at charge 5 is 3.5 times its base, an exponential one 1.45 ^ 5 times', () => {
    expect(value('(3d8 + 1.5 * mag) * (1 + 0.5 * charge)', [12], { charge: 5 })).toBeCloseTo(51.24 * 3.5, 10);
    expect(value('(3d8 + 1.5 * mag) * 1.45 ^ charge', [12], { charge: 2 })).toBeCloseTo(51.24 * 2.1025, 10);
  });

  test('a formula is never refused for being strong', () => {
    expect(value('50d1000 * 1000 ^ 3 + target.hpMax', [50000])).toBe(50000 * 1e9 + 48);
  });
});

describe('what the parser refuses, naming what it could not read', () => {
  test('an unknown name, the user\'s or the target\'s', () => {
    expect(refusal('2 + luck')).toContain('"luck"');
    expect(refusal('target.luck * 2')).toContain('"target.luck"');
    expect(refusal('str.agi')).toContain('"str.agi"');
    expect(refusal('target')).toContain('"target"');
  });

  test('a die with no count is one die, as Roll20 reads /r d20+4', () => {
    expect(parse('d6 + 2')).toEqual(parse('1d6 + 2'));
  });

  test('the target\'s charge, which only the user has', () => {
    expect(refusal('target.charge')).toContain('"target.charge"');
  });

  test('a character a formula never uses', () => {
    expect(refusal('2 # 3')).toContain('"#" at character 3');
    expect(refusal('str . 2')).toContain('"."');
  });

  test('a formula that ends too soon, or is empty', () => {
    expect(refusal('2 +')).toContain('"+"');
    expect(refusal('')).toContain('empty');
    expect(refusal('   ')).toContain('empty');
  });

  test('a bracket left open, and min or max without their two parts', () => {
    expect(refusal('(2 + 3')).toContain('"(" at character 1');
    expect(refusal('min(2)')).toContain('min(a, b)');
    expect(refusal('max 2, 3')).toContain('max(a, b)');
  });

  test('two parts with nothing joining them', () => {
    expect(refusal('3 4')).toContain('"4" at character 3');
    expect(refusal('2phys')).toContain('"phys"');
    expect(refusal('(2))')).toContain('")" at character 4');
  });

  test('dice past the rules\' limits: 1 to 50 dice of 2 to 1000 sides', () => {
    expect(refusal('51d6')).toContain('"51d6"');
    expect(refusal('0d6')).toContain('"0d6"');
    expect(refusal('1d1001')).toContain('"1d1001"');
    expect(refusal('1d1')).toContain('"1d1"');
    expect(parseFormula('1d1001', { dice: { maxDice: 50, maxSides: 2000 } }).ok).toBe(true);
  });
});

describe('the dice to roll and the average', () => {
  test('diceOf lists every dice term in reading order, inside min, max and brackets too', () => {
    expect(diceOf(parse('2d6 + 1d20 - 3'))).toEqual([{ count: 2, sides: 6 }, { count: 1, sides: 20 }]);
    expect(diceOf(parse('max(1d4, (2d8)) * -1d6'))).toEqual([{ count: 1, sides: 4 }, { count: 2, sides: 8 }, { count: 1, sides: 6 }]);
    expect(diceOf(parse('phys * 2'))).toEqual([]);
  });

  test('average puts each dice term at its mean, count * (sides + 1) / 2', () => {
    expect(average(parse('2d6 + 1d20 - 3'), SCOPE)).toBe(14.5);
    expect(average(parse('min(1d4, 1d6)'), SCOPE)).toBe(2.5);
  });
});

describe('a formula printed', () => {
  test('keeps only the brackets it needs', () => {
    const printed = (text: string): string => printFormula(parse(text));
    expect(printed('(2*3)+4')).toBe('2 * 3 + 4');
    expect(printed('2*(3+4)')).toBe('2 * (3 + 4)');
    expect(printed('10-(4-3)')).toBe('10 - (4 - 3)');
    expect(printed('2^(3^2)')).toBe('2^3^2');
    expect(printed('(2^3)^2')).toBe('(2^3)^2');
    expect(printed('(-2)^2')).toBe('(-2)^2');
    expect(printed('-(2^2)')).toBe('-2^2');
    expect(printed('2^(-1)')).toBe('2^-1');
    expect(printed('TARGET.Str+MIN(1d4,charge)')).toBe('target.str + min(1d4, charge)');
  });

  test('reads back as the same tree', () => {
    for (const text of ['1d8 + phys', '3d8 + 1.5 * mag', '(3d8 + 1.5 * mag) * 1.45 ^ charge', '-2^2', '(-2)^2', '-(2^2)', '2^-1^2', '10 - (4 - 3) - 2',
      '100 / (10 / 2)', 'max(min(1d4, target.armor), -str) / --3', '2 * -(3 + 4)', '.5 * hold * target.hpMax']) {
      const tree = parse(text);
      expect([text, parse(printFormula(tree))]).toEqual([text, tree]);
    }
  });
});

describe('the kits\' names (kits design 1.5)', () => {
  const kit: KitScope = {
    stacks: { user: { [statusKey('pain')]: 7 }, target: { [statusKey('hemo-plague')]: 3 } }, field: { [statusKey('corruption')]: 11 },
    missing: { user: 0.25, target: 0.6 }, held: { [statusKey('crimson-pact')]: 2 }, hits: 4, kills: 2, spent: 5,
  };
  const value = (text: string): number => evaluate(parse(text), { ...SCOPE, kit, dice: [] });
  const bare = (text: string): number => evaluate(parse(text), { ...SCOPE, dice: [] });

  test('each reads its number of the snapshot: stacks on the user or the target, the field, the lost share, rounds held, bodies hit, kills, stacks spent', () => {
    expect(['stacks(pain)', 'target.stacks(hemo-plague)', 'field(corruption)', 'missing', 'target.missing', 'held(crimson-pact)', 'hits', 'kills', 'spent'].map(t => value(t)))
      .toEqual([7, 3, 11, 0.25, 0.6, 2, 4, 2, 5]);
  });

  test('a status the snapshot does not hold reads 0, and with no snapshot every kit name reads as nothing: no stacks, full HP', () => {
    expect([value('stacks(rot)'), value('target.stacks(pain)'), value('field(rot)')]).toEqual([0, 0, 0]);
    expect([bare('stacks(pain)'), bare('target.missing'), bare('spent')]).toEqual([0, 0, 0]);
  });

  test('a key with hyphens is one key, not a subtraction, and the names mix with the rest: Violence is (1d8 + phys) * (1 + 0.06 * spent)', () => {
    expect(parse('target.stacks(hemo-plague)')).toEqual({ kind: 'stacks', whose: 'target', key: 'hemo-plague' });
    expect(evaluate(parse('(1d8 + phys) * (1 + 0.06 * spent)'), { ...SCOPE, kit, dice: [5] })).toBeCloseTo((5 + 26.16) * 1.3, 10);
  });

  test('what only the user or the fight has is refused on the target, and a keyed name needs its key', () => {
    for (const text of ['target.field(pain)', 'target.held(pain)', 'target.hits', 'target.kills', 'target.spent', 'stacks', 'stacks(Pain)', 'field()']) {
      expect([text, parseFormula(text, LIMITS).ok]).toEqual([text, false]);
    }
    const r = parseFormula('stacks', LIMITS);
    expect(r.ok ? '' : r.error).toContain('stacks(key)');
  });

  test('roll no dice, and read back as the same tree', () => {
    for (const text of ['stacks(pain) * 2', 'target.stacks(hemo-plague) + field(corruption)', '1 - target.missing', 'held(crimson-pact) * hits + kills - spent']) {
      const tree = parse(text);
      expect([text, diceOf(tree), parse(printFormula(tree))]).toEqual([text, [], tree]);
    }
  });
});

// ── Roll20's dice (the owner, combat-rework-notes "Dice typed the Roll20 way"; the rules in formula.ts's header) ──

/** Each dice term of `text` read from its own list of faces; a term short of faces fails the test. */
const rollText = (text: string, faces: readonly (readonly number[])[]): Rolled => {
  const f = parse(text);
  const terms = diceOf(f).map((d, i) => {
    const r = rollOf(d, faces[i] ?? []);
    if ('more' in r) throw new Error(`${text}: term ${i + 1} needs ${r.more} more faces`);
    return r;
  });
  return rolled(f, SCOPE, terms);
};

describe('advantage is a dice term (kits design 8.2)', () => {
  test('2d20kh1 keeps the higher d20 and 2d20kl1 the lower, for every pair of faces', () => {
    for (let a = 1; a <= 20; a++) for (let b = 1; b <= 20; b++) {
      expect([a, b, rollText('2d20kh1', [[a, b]]).total, rollText('2d20kl1', [[a, b]]).total]).toEqual([a, b, Math.max(a, b), Math.min(a, b)]);
    }
  });

  test('the edge\'s die averages 13.825 and its opposite 7.175, the means of the higher and the lower of two d20s', () => {
    // P(higher of two >= f) = 1 - ((f - 1) / 20)^2 and P(lower >= f) = ((21 - f) / 20)^2; a mean is the sum of those over f.
    let edge = 0, opposite = 0;
    for (let f = 1; f <= 20; f++) { edge += 1 - ((f - 1) / 20) ** 2; opposite += ((21 - f) / 20) ** 2; }
    expect(edge).toBeCloseTo(13.825, 12);
    expect(opposite).toBeCloseTo(7.175, 12);
    expect(mean(diceOf(parse('2d20kh1'))[0]!)).toBeCloseTo(edge, 12);
    expect(mean(diceOf(parse('2d20kl1'))[0]!)).toBeCloseTo(opposite, 12);
  });

  test('a natural 20 on the kept die comes 39 times in 400 with the edge and once in 400 against it', () => {
    let high = 0, low = 0;
    for (let a = 1; a <= 20; a++) for (let b = 1; b <= 20; b++) {
      if (rollText('2d20kh1', [[a, b]]).total === 20) high++;
      if (rollText('2d20kl1', [[a, b]]).total === 20) low++;
    }
    expect([high, low]).toEqual([39, 1]);
  });
});

/** A face's fate as one word, so a row of the table reads as the Dice view would strike it: `r` rerolled, `x` dropped, `k` kept, `s` a success, `!` after a face that exploded. */
const fates = (r: Rolled): string[][] => r.terms.map(t => t.faces.map(f => `${f.face}${f.fate === 'rerolled' ? 'r' : f.fate === 'dropped' ? 'x' : f.fate === 'kept' ? 'k' : 's'}${f.fate !== 'rerolled' && f.exploded ? '!' : ''}`));

describe('dice typed the Roll20 way', () => {
  test('the shipped rules let a term roll 100 dice and no more', () => {
    expect(parseFormula('100d6kh1', RULES).ok).toBe(true);
    expect(parseFormula('101d6', RULES).ok).toBe(false);
  });

  // [text, the faces each term rolled, the total, each face's fate]. The total is worked out by hand from the rule.
  const TABLE: [string, number[][], number, string[][]][] = [
    ['/r d20+4', [[13]], 17, [['13k']]],
    ['/r 2d20kh1', [[7, 15]], 15, [['7x', '15k']]],
    ['/r 10d20kh4', [[3, 18, 7, 20, 1, 11, 18, 5, 9, 14]], 20 + 18 + 18 + 14, [['3x', '18k', '7x', '20k', '1x', '11x', '18k', '5x', '9x', '14k']]],
    ['/roll 2d20kl1', [[7, 15]], 7, [['7k', '15x']]],
    ['4d6k3', [[3, 1, 6, 1]], 3 + 6 + 1, [['3k', '1k', '6k', '1x']]],
    ['4d6dl1', [[3, 1, 6, 1]], 3 + 6 + 1, [['3k', '1k', '6k', '1x']]],
    ['4d6d1', [[3, 1, 6, 1]], 3 + 6 + 1, [['3k', '1k', '6k', '1x']]],
    ['4d6dh1', [[3, 1, 6, 1]], 3 + 1 + 1, [['3k', '1k', '6x', '1k']]],
    ['3d6!', [[6, 4, 2, 6, 6, 1]], 25, [['6k!', '4k', '2k', '6k!', '6k!', '1k']]],
    ['3d6!>5', [[5, 6, 1, 2, 3]], 17, [['5k!', '6k!', '1k', '2k', '3k']]],
    ['2d6!<1', [[1, 3, 2]], 6, [['1k!', '3k', '2k']]],
    ['2d8r<2', [[1, 2, 5, 8]], 13, [['1r', '2r', '5k', '8k']]],
    ['2d8r1r3', [[3, 1, 4, 7]], 11, [['3r', '1r', '4k', '7k']]],
    ['2d10ro<2', [[1, 1, 10]], 11, [['1r', '1k', '10k']]],
    ['1d6!r1', [[6, 1, 3]], 9, [['6k!', '1r', '3k']]],
    ['10d6>5', [[5, 6, 1, 2, 3, 4, 5, 6, 6, 2]], 5, [['5s', '6s', '1k', '2k', '3k', '4k', '5s', '6s', '6s', '2k']]],
    ['3d6<2', [[1, 2, 3]], 2, [['1s', '2s', '3k']]],
    ['3d6=6', [[6, 6, 5]], 2, [['6s', '6s', '5k']]],
    ['3d6kl2>5', [[6, 1, 2]], 0, [['6x', '1k', '2k']]],
    ['4d6kh3>4', [[4, 1, 6, 4]], 3, [['4s', '1x', '6s', '4s']]],
    ['d% + 2d4', [[100], [1, 4]], 105, [['100k'], ['1k', '4k']]],
    ['floor(1d6 / 2) + ceil(1.2) + round(2.5) + abs(-3)', [[5]], 2 + 2 + 3 + 3, [['5k']]],
    ['2D20KH1 + STR', [[2, 9]], 9 + 63, [['2x', '9k']]],
  ];
  for (const [text, faces, total, fate] of TABLE) {
    test(`${text} with faces ${faces.map(f => f.join(' ')).join(' | ')} is ${total}`, () => {
      const r = rollText(text, faces);
      expect([r.total, fates(r)]).toEqual([total, fate]);
    });
  }

  test('a die that explodes adds at most 10 dice: the 11th six stands', () => {
    const r = rollText('1d6!', [Array(11).fill(6)]);
    expect([r.total, fates(r)[0]]).toEqual([66, [...Array(EXPLODE_MAX).fill('6k!'), '6k']]);
  });

  test('a die rolls again at most 10 times: the 11th one stands', () => {
    const r = rollText('1d6r1', [Array(11).fill(1)]);
    expect([r.total, fates(r)[0]]).toEqual([1, [...Array(REROLL_MAX).fill('1r'), '1k']]);
  });

  test('a term short of faces says how many more it needs at least, one for each die written that has not stood', () => {
    const d = (text: string): Dice => diceOf(parse(text))[0]!;
    expect(rollOf(d('3d6'), [])).toEqual({ more: 3 });
    expect(rollOf(d('3d6'), [4])).toEqual({ more: 2 });
    expect(rollOf(d('1d6!'), [6])).toEqual({ more: 1 });
    expect(rollOf(d('2d8r1'), [1])).toEqual({ more: 2 });
    expect(rollOf(d('2d8r1'), [1, 5])).toEqual({ more: 1 });
  });

  test('a term reads the same faces the same way however many extra are given', () => {
    const d = diceOf(parse('3d6!r1kh2'))[0]!, faces = [6, 1, 3, 2, 6, 6, 4, 5, 5, 5];
    expect(rollOf(d, faces.slice(0, 7))).toEqual(rollOf(d, faces));
  });
});

describe('a d20 with an edge, and the natural a roll shows', () => {
  test('advantage rolls a check\'s one plain d20 as 2d20kh1, disadvantage as 2d20kl1, and leaves any other roll as it is', () => {
    expect(printFormula(withEdge(parse('1d20 + 5'), 'kh'))).toBe('2d20kh1 + 5');
    expect(printFormula(withEdge(parse('d20 - 1 + 1d4'), 'kl'))).toBe('2d20kl1 - 1 + 1d4');
    for (const text of ['2d6 + 3', '1d20 + 1d20', '2d20', '1d20!', '1d20kh1']) expect([text, withEdge(parse(text), 'kh')]).toEqual([text, parse(text)]);
  });

  test('the natural is the one face the only d20 term keeps, and none when there is no such face', () => {
    expect(naturalOf(rollText('1d20 + 4', [[20]]))).toBe(20);
    expect(naturalOf(rollText('2d20kh1', [[1, 14]]))).toBe(14);
    expect(naturalOf(rollText('2d20kl1 + 1d6', [[1, 14], [6]]))).toBe(1);
    expect(naturalOf(rollText('2d6', [[6, 6]]))).toBeNull();
    expect(naturalOf(rollText('2d20', [[3, 4]]))).toBeNull();
    expect(naturalOf(rollText('1d20 + 1d20', [[3], [4]]))).toBeNull();
    expect(naturalOf(rollText('1d20!', [[20, 5]]))).toBeNull();
    expect(naturalOf(rollText('1d20>10', [[15]]))).toBeNull();
  });
});

describe('what the parser refuses in a dice term, with what to write instead', () => {
  const CASES: [string, string][] = [
    ['2d20kh', 'kh needs a number: 2d20kh1'],
    ['2d20kl', 'kl needs a number: 2d20kl1'],
    ['2d20k', 'k needs a number: 2d20kh1'],
    ['4d6dh', 'dh needs a number: 4d6dh1'],
    ['4d6dl', 'dl needs a number: 4d6dl1'],
    ['4d6d', 'd needs a number: 4d6dl1'],
    ['2d8r', 'r needs a face: 2d8r1 or 2d8r<2'],
    ['2d8ro', 'ro needs a face: 2d8ro1 or 2d8ro<2'],
    ['3d6>', '> needs a number: 3d6>5'],
    ['3d6<', '< needs a number: 3d6<5'],
    ['3d6=', '= needs a number: 3d6=5'],
    ['2d20kh3', 'keeps 3 of 2 dice; write 1 to 2'],
    ['4d6dl0', 'drops 0 of 4 dice; write 1 to 4'],
    ['1d6r7', 'r7 is not a face of a d6'],
    ['1d6!>7', '!>7 is not a face of a d6'],
    ['3d6>0', '>0 is not a face of a d6'],
    ['2d8r1ro2', 'mixes r and ro'],
    ['3d6!!', '!! (compounding) is not read here'],
    ['3d6!>5!', 'explodes twice'],
    ['4d6kh3dl1', 'keeps or drops twice'],
    ['3d6>4>5', 'counts successes twice'],
    ['3d6x', 'Cannot read "x" in "3d6x"'],
    ['3d6!p', 'Cannot read "p" in "3d6!p"'],
    ['2d6 >3', 'Cannot read ">" at character 5'],
    ['/rd20', 'Cannot read "/" at character 1'],
    ['/r', 'empty'],
    ['floor 2', 'floor(a)'],
    ['round(2, 3)', 'round(a)'],
  ];
  for (const [text, error] of CASES) test(`${text}: "${error}"`, () => expect(refusal(text)).toContain(error));

  test('the rules\' dice limits hold for a term with modifiers and for d%: 1 to 50 dice of 2 to 1000 sides', () => {
    expect(refusal('51d20kh1')).toContain('"51d20kh1" rolls 51 dice');
    expect(refusal('d1001!')).toContain('a die has 2 to 1000');
    expect(parseFormula('50d%kh1', LIMITS).ok).toBe(true);
    expect(parseFormula('d%', { dice: { maxDice: 50, maxSides: 99 } }).ok).toBe(false);
  });
});

describe('a stored term\'s modifiers, read back as the parser gives them', () => {
  test('what the parser made reads back the same, and a term with none reads as none', () => {
    for (const text of ['2d20kh1', '2d8r<2r8', '2d10ro<2', '3d6!>5>4', '4d6dl1=6', '1d6']) {
      const d: Dice = diceOf(parse(text))[0]!;
      expect([text, diceModsOf(JSON.parse(JSON.stringify(d.mods ?? null)) ?? undefined, d.count, d.sides)]).toEqual([text, d.mods]);
    }
  });

  test('a point off the die, a cut past the dice, an unknown op or a reroll with no point is unreadable', () => {
    for (const mods of [{ explode: { op: '>', n: 7 } }, { success: { op: '=', n: 0 } }, { cut: { how: 'kh', n: 3 } }, { cut: { how: 'kx', n: 1 } },
      { reroll: { on: [], once: false } }, { reroll: { on: [{ op: '=', n: 1 }] } }, { explode: { op: '>=', n: 3 } }, { cut: { how: 'dl', n: 1.5 } }, 'kh1', null]) {
      expect([mods, diceModsOf(mods, 2, 6)]).toEqual([mods, null]);
    }
    expect(diceModsOf({}, 2, 6)).toBeUndefined();
  });
});

describe('a dice term\'s mean, which the makers\' budget reads through average', () => {
  const meanOf = (text: string): number => mean(diceOf(parse(text))[0]!);
  /** The exact mean by walking every list of faces the term can read, each with its chance: (1 / sides) per face. */
  const walked = (text: string): number => {
    const d = diceOf(parse(text))[0]!;
    let sum = 0;
    const walk = (faces: number[], p: number): void => {
      const r = rollOf(d, faces);
      if (!('more' in r)) { sum += p * r.total; return; }
      for (let f = 1; f <= d.sides; f++) walk([...faces, f], p / d.sides);
    };
    walk([], 1);
    return sum;
  };

  test('worked by hand: 4d6dl1, 1d6ro1, 10d6>5, 3d6! and 2d8r<2', () => {
    // 4d6 drop the lowest: 15869 / 1296 (the sum over all 1296 rolls of the best three, a known count).
    expect(meanOf('4d6dl1')).toBeCloseTo(15869 / 1296, 12);
    // A 1 is rolled again once: (2 + 3 + 4 + 5 + 6) / 6 + 3.5 / 6.
    expect(meanOf('1d6ro1')).toBeCloseTo(20 / 6 + 3.5 / 6, 12);
    // Each die is a success on a 5 or 6.
    expect(meanOf('10d6>5')).toBeCloseTo(10 * 2 / 6, 12);
    // Each die written is a chain of 1 to 11 dice, die j there with chance 6^-j, each worth 3.5 on average.
    let chain = 0;
    for (let j = 0; j <= EXPLODE_MAX; j++) chain += 6 ** -j;
    expect(meanOf('3d6!')).toBeCloseTo(3 * 3.5 * chain, 12);
    // A face of 3 to 8 stands at any of 11 tries, a 1 or 2 only at the last: P(3..8) = Σ_t (1/4)^t / 8, P(1 or 2) = (1/4)^10 / 8.
    let free = 0;
    for (let t = 0; t <= REROLL_MAX; t++) free += 0.25 ** t / 8;
    expect(meanOf('2d8r<2')).toBeCloseTo(2 * ((3 + 4 + 5 + 6 + 7 + 8) * free + (1 + 2) * 0.25 ** 10 / 8), 12);
  });

  test('every modifier alone and together matches the mean of walking every roll the term can read', () => {
    for (const text of ['3d4kh2', '3d4kl1', '3d4dh1', '3d4dl2', '3d4r1kh2', '2d4!kh1', '2d4!kl1', '2d4!dh1', '2d4!dl1', '1d4!ro1', '2d4!>4>3',
      '3d4kh2>3', '3d4kl2<2', '3d4dl1=4', '2d4!kh1=4', '2d6ro<3', '3d3r>3kl2']) {
      expect([text, meanOf(text).toFixed(10)]).toEqual([text, walked(text).toFixed(10)]);
    }
  });

  test('a plain term is still count × (sides + 1) / 2, and average puts each term at its mean', () => {
    expect(meanOf('3d8')).toBe(13.5);
    expect(average(parse('2d20kh1 + 4'), SCOPE)).toBeCloseTo(17.825, 12);
  });
});

describe('random formulas from the grammar with random dice', () => {
  // A small seeded generator (mulberry32), so a failure replays.
  const seeded = (seed: number) => () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const SIDES = [2, 3, 4, 6, 8, 10, 12, 20, 100];

  test('the total is the signed sum of its terms and numbers, a term is its kept faces or its successes, and the kept count is the cut\'s', () => {
    const random = seeded(2026), int = (lo: number, hi: number): number => lo + Math.floor(random() * (hi - lo + 1));
    const point = (sides: number): string => `${['', '>', '<', '='][int(0, 3)]}${int(1, sides)}`.replace(/^=/, '');
    for (let n = 0; n < 2000; n++) {
      const parts: { text: string; sign: number }[] = [];
      for (let p = int(1, 3); p > 0; p--) {
        const sign = random() < 0.3 ? -1 : 1;
        if (random() < 0.25) { parts.push({ text: String(int(0, 30)), sign }); continue; }
        const count = int(1, 6), sides = SIDES[int(0, SIDES.length - 1)]!;
        let mods = '';
        if (random() < 0.4) mods += random() < 0.5 ? `r${point(sides)}` : `ro${point(sides)}`;
        if (random() < 0.4) mods += `!${random() < 0.5 ? '' : `${int(0, 1) ? '>' : '<'}${int(1, sides)}`}`;
        if (random() < 0.5) mods += `${['kh', 'kl', 'dh', 'dl', 'k', 'd'][int(0, 5)]}${int(1, count)}`;
        if (random() < 0.3) mods += `${['>', '<', '='][int(0, 2)]}${int(1, sides)}`;
        parts.push({ text: `${random() < 0.2 && count === 1 ? '' : count}d${sides === 100 && random() < 0.5 ? '%' : sides}${mods}`, sign });
      }
      const text = parts.map((x, i) => `${x.sign < 0 ? '-' : i ? '+' : ''} ${x.text}`).join(' ');
      const f = parse(text), dice = diceOf(f);
      const terms = dice.map(d => {
        const faces: number[] = [];
        for (;;) {
          const r = rollOf(d, faces);
          if (!('more' in r)) return r;
          for (let i = 0; i < r.more; i++) faces.push(int(1, d.sides));
        }
      });
      const r = rolled(f, SCOPE, terms);
      let k = 0;
      const want = parts.reduce((sum, x) => sum + x.sign * (/d/.test(x.text) ? terms[k++]!.total : Number(x.text)), 0);
      expect([text, r.total + 0]).toEqual([text, want + 0]);
      dice.forEach((d, i) => {
        const t = terms[i]!, m = d.mods ?? {}, standing = t.faces.filter(x => x.fate !== 'rerolled');
        const kept = standing.filter(x => x.fate !== 'dropped');
        const sum = m.success ? kept.filter(x => x.fate === 'success').length : kept.reduce((s, x) => s + x.face, 0);
        const cut = m.cut, keeps = cut === undefined ? standing.length : cut.how[0] === 'k' ? Math.min(cut.n, standing.length) : Math.max(0, standing.length - cut.n);
        expect([text, i, t.total, kept.length]).toEqual([text, i, sum, keeps]);
        expect(t.faces.every(x => Number.isInteger(x.face) && x.face >= 1 && x.face <= d.sides)).toBe(true);
        expect(t.faces.every(x => x.fate === 'rerolled' ? m.reroll!.on.some(c => meets(x.face, c)) : !x.exploded || meets(x.face, m.explode!))).toBe(true);
      });
    }
  });

  test('any text of dice characters is read or refused, never thrown', () => {
    const random = seeded(7), alphabet = 'd0123456789khlro!<>=%+-*/(). /rDK';
    for (let n = 0; n < 5000; n++) {
      let text = '';
      for (let len = Math.floor(random() * 14); len > 0; len--) text += alphabet[Math.floor(random() * alphabet.length)];
      const r = parseFormula(text, LIMITS);
      if (r.ok) expect(parse(printFormula(r.formula))).toEqual(r.formula);
      else expect(r.error.length).toBeGreaterThan(0);
    }
  });

  test('a term with modifiers prints as text that reads back as the same tree', () => {
    for (const text of ['2d20kh1', '10d20kh4', '2d8r<2', '2d8r1r3', '2d10ro<2', '3d6!', '3d6!>5', '1d6!>4', '3d6!6>4', '4d6d1', '10d6>5', '3d6=6',
      'floor(1d6 / 2) + abs(-ceil(phys))', 'round(2d20kl1 * 1.5)', 'd%!kh1']) {
      const tree = parse(text);
      expect([text, parse(printFormula(tree))]).toEqual([text, tree]);
    }
  });
});
