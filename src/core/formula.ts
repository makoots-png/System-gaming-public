// formula.ts: an ability's damage, heal or shield formula, as data (docs/agent-handoff/rw/design.md section 3.4). A GM's
// text is parsed once, at the boundary, into a `Formula` tree; `evaluate` trusts the tree. The parser refuses only what it
// cannot read and a formula past `FORMULA_PARTS`, never a formula for being strong. A name is a stat key or a `Sheet` key, read from the user, or from the
// target after `target.`; adding a field to `Sheet` (with its label in `SHEET_LABELS`) makes it a name here. The kits'
// names (docs/agent-handoff/kits/design.md 1.5) read a snapshot of the fight a use takes at rule 6b (`KitScope`): a new
// one is a member of `Formula`, its name in `NAMES` (or `KEYED`), its bound in `RULES.fight.kit` and its value in the
// snapshot (resolve.ts `kitScope`).
//
// A dice term is Roll20's notation (the owner, combat-rework-notes "Dice typed the Roll20 way"), so one text works in the
// Dice view, a check and an ability's or status's formula; a leading `/r` or `/roll` is read as nothing. A term is `NdS`
// (N left out is 1; `d%` is a d100) with its modifiers written right after it, in any order, and applied in this one:
//   1. Reroll: `r n`, `r<n`, `r>n`, several at once (`r1r2`). A face that meets one is struck and the die rolled again,
//      up to REROLL_MAX times; then the face stands. `ro` rolls a die again at most once. `r` and `ro` do not mix.
//   2. Explode: `!` on the highest face, `!>n`, `!<n` or `!n`. A die whose face (after its rerolls) meets it adds a die,
//      which rerolls and explodes the same way; one die written adds at most EXPLODE_MAX dice.
//   3. Keep or drop, among every die that stands (an added die too): `kh n` or `k n` keeps the n highest, `kl n` the n
//      lowest, `dh n` drops the n highest, `dl n` or `d n` the n lowest. n is 1 to the dice written.
//   4. Successes: `>n`, `<n` or `=n`. The term is the count of its kept dice that meet it, not their sum.
// A point `>n` is n or more and `<n` is n or less (Roll20's meaning); `=n`, or a bare n after r or !, is exactly n. n
// is a face of the die. Advantage (kits design 8.2) is `2d20kh1` and disadvantage `2d20kl1`: one rule, not a second.
// Not checked against Roll20's reference (no web access when written; docs/agent-handoff/kits/notes-dice.md): the fixed
// order above, that an added die rerolls too, the caps, and n of keep and drop bounded by the dice written.
// Core rolls nothing: `rollOf` reads a term from faces the edge rolled (src/edge/roll.ts `rollTerm`) and says how many
// more it needs; `evaluate` reads one total per term, as it always has, and `rolled` lays the faces beside the total.

import { STAT_KEYS } from './stats.ts';
import type { StatKey, Stats } from './stats.ts';
import { SHEET_LABELS } from './hunter/derive.ts';
import type { Sheet, SheetNumber } from './hunter/derive.ts';
import type { StatusKey } from './combat/effect-ops.ts';

/** Whose numbers a name reads. */
export type Whose = 'user' | 'target';
export type BinaryOp = '+' | '-' | '*' | '/' | '^';

export type Formula =
  | { readonly kind: 'number'; readonly value: number }
  | ({ readonly kind: 'dice' } & Dice)
  | { readonly kind: 'stat'; readonly whose: Whose; readonly key: StatKey }
  | { readonly kind: 'sheet'; readonly whose: Whose; readonly key: SheetNumber }
  | { readonly kind: 'charge' }
  /** The stacks of a status on the user or the target (0 if none). */
  | { readonly kind: 'stacks'; readonly whose: Whose; readonly key: StatusKey }
  /** The stacks of a status on every body that is up. */
  | { readonly kind: 'field'; readonly key: StatusKey }
  /** The share of max HP the user or the target has lost, 0 to 1. */
  | { readonly kind: 'missing'; readonly whose: Whose }
  /** Rounds the user has held a status. */
  | { readonly kind: 'held'; readonly key: StatusKey }
  /** Bodies in the shape (`hits`), the user's kills this fight (`kills`), stacks this use's price took (`spent`). */
  | { readonly kind: 'count'; readonly name: CountName }
  | { readonly kind: 'negate'; readonly arg: Formula }
  | { readonly kind: 'binary'; readonly op: BinaryOp; readonly left: Formula; readonly right: Formula }
  | { readonly kind: 'min' | 'max'; readonly left: Formula; readonly right: Formula }
  | { readonly kind: 'fn'; readonly fn: Fn; readonly arg: Formula };

/** The functions of one part, as Roll20 has them: `round` is half up. */
export const FNS = ['floor', 'ceil', 'round', 'abs'] as const;
export type Fn = (typeof FNS)[number];

/** A compare point: `>` is n or more, `<` is n or less, `=` exactly n (Roll20's meaning). n is a face of the die. */
export type Compare = { readonly op: '>' | '<' | '='; readonly n: number };
/** Keep the n highest (`kh`) or lowest (`kl`) dice, or drop the n highest (`dh`) or lowest (`dl`); n is 1 to `count`. */
export type Cut = { readonly how: 'kh' | 'kl' | 'dh' | 'dl'; readonly n: number };
/** A dice term's modifiers (the header's four steps). A term without any has no `mods`, and none is ever `{}`. */
export type DiceMods = {
  /** The faces rolled again; `once` (`ro`) rolls a die again at most once, else up to REROLL_MAX times. */
  readonly reroll?: { readonly on: readonly Compare[]; readonly once: boolean };
  /** The faces that add a die. `!` alone is `= sides`. */
  readonly explode?: Compare;
  readonly cut?: Cut;
  /** The term counts its kept dice that meet this in place of summing their faces. */
  readonly success?: Compare;
};
/** Dice the edge rolls for a formula: `count` dice of `sides` faces, with Roll20's modifiers if any. */
export type Dice = { readonly count: number; readonly sides: number; readonly mods?: DiceMods };

/**
 * A die rolls again at most 10 times (`r`), and one die written adds at most 10 by exploding (`!`). Roll20 caps these
 * far higher; here the edge rolls a bounded number of faces, so a point every face meets (`1d6r<6`) still ends, and at
 * 10 a die that explodes on a d6's 6 has a 6^-10 chance (under one in 60 million) of reaching the cap.
 */
export const REROLL_MAX = 10;
export const EXPLODE_MAX = 10;

/**
 * The most parts a formula holds: each node of its tree is a part, and so is each face a dice term rolls again on (the
 * one list a node carries). Both readers keep it: `parseFormula` refuses past it, and the tree reader of outside data
 * (fight-parse.ts `formulaOf`) stops at the first part past it. It is the one bound of a formula's size: a maker's formula
 * field takes text of any length and the parser decides, so a field always holds what the app wrote in it (a rule formula
 * prints to 403 characters). The largest formula the app writes by rule is 89 parts. notes-5-trade.md 12.3 and 12.7.
 */
export const FORMULA_PARTS = 200;
/** A formula's parts, as `FORMULA_PARTS` counts them. */
export const partsOf = (f: Formula): number => {
  switch (f.kind) {
    case 'dice': return 1 + (f.mods?.reroll?.on.length ?? 0);
    case 'negate': case 'fn': return 1 + partsOf(f.arg);
    case 'binary': case 'min': case 'max': return 1 + partsOf(f.left) + partsOf(f.right);
    default: return 1;
  }
};

/** The dice limits a formula may name: the rules' `dice`. */
export type FormulaRules = { readonly dice: { readonly maxDice: number; readonly maxSides: number } };

/** One side of a use, as a formula reads it. */
export type FormulaBody = { readonly stats: Stats; readonly sheet: Sheet };
export const COUNT_NAMES = ['hits', 'kills', 'spent'] as const;
export type CountName = (typeof COUNT_NAMES)[number];
/**
 * What the kits' names read (kits design 1.5): a snapshot of the fight taken when a use's shape is known (rule 6b), so
 * every target of an area reads the same field and a use's own chain does not change its numbers. Each number is
 * already within its rule's bound (`RULES.fight.kit`); a key missing from a record reads 0.
 */
export type KitScope = {
  readonly stacks: { readonly user: Readonly<Record<StatusKey, number>>; readonly target: Readonly<Record<StatusKey, number>> };
  readonly field: Readonly<Record<StatusKey, number>>;
  readonly missing: { readonly user: number; readonly target: number };
  readonly held: Readonly<Record<StatusKey, number>>;
  readonly hits: number;
  readonly kills: number;
  readonly spent: number;
};
/** A snapshot of nothing: no stacks anywhere, full HP, no kills. What a formula read outside a fight's use sees. */
export const NO_KIT: KitScope = { stacks: { user: {}, target: {} }, field: {}, missing: { user: 0, target: 0 }, held: {}, hits: 0, kills: 0, spent: 0 };
/**
 * What a formula reads besides its dice. A use on oneself has the user as its target. `kit` is the kits' snapshot;
 * absent, every kit name reads as `NO_KIT` (the maker's preview, a status's shield as it lands).
 */
export type Scope = { readonly user: FormulaBody; readonly target: FormulaBody; readonly charge: number; readonly kit?: KitScope };
/** `dice` holds one number per dice term of the formula, in reading order: the total that term rolled. */
export type Env = Scope & { readonly dice: readonly number[] };

export type ParsedFormula = { readonly ok: true; readonly formula: Formula } | { readonly ok: false; readonly error: string };

/** Every name a formula may use, lower case, to what it reads. One table, so the parser has no list of its own. */
type Name =
  | { readonly kind: 'stat'; readonly key: StatKey } | { readonly kind: 'sheet'; readonly key: SheetNumber } | { readonly kind: 'charge' }
  | { readonly kind: 'missing' } | { readonly kind: 'count'; readonly name: CountName };
const NAMES: ReadonlyMap<string, Name> = new Map<string, Name>([
  ...STAT_KEYS.map(key => [key, { kind: 'stat', key }] as const),
  ...(Object.keys(SHEET_LABELS) as SheetNumber[]).map(key => [key.toLowerCase(), { kind: 'sheet', key }] as const),
  ['charge', { kind: 'charge' }],
  ['missing', { kind: 'missing' }],
  ...COUNT_NAMES.map(name => [name, { kind: 'count', name }] as const),
]);
/** The names that take a status's key in brackets, `stacks(pain)`; only `stacks` reads the target's too. */
const KEYED = ['stacks', 'field', 'held'] as const;
type Keyed = (typeof KEYED)[number];
/** The longest status key (effect-ops.ts `STATUS_KEY_RE`). */
const KEY_MAX = 40;
const NAME_HINT = `A name is a stat (${STAT_KEYS.join(', ')}), a sheet number such as phys, mag, sup, hpMax or armor, charge, missing, hits, kills or spent, or stacks(key), field(key) or held(key) of a status; target.name reads the target's.`;

type Token =
  | { readonly t: 'number'; readonly value: number; readonly at: number; readonly text: string }
  /** A dice term with its modifiers' text (`mods`), read once the parser knows the rules' limits. */
  | { readonly t: 'dice'; readonly count: number; readonly sides: number; readonly mods: string; readonly at: number; readonly text: string }
  | { readonly t: 'word'; readonly at: number; readonly text: string }
  /** A keyed name with its status key read whole, so `stacks(hemo-plague)` is not a subtraction. */
  | { readonly t: 'keyed'; readonly name: Keyed; readonly target: boolean; readonly key: string; readonly at: number; readonly text: string }
  | { readonly t: 'sym'; readonly at: number; readonly text: string };

const TOKEN = String.raw`((?:target\.)?(?:stacks|field|held))\s*\(\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*\)|(\d*)[dD](\d+|%)([A-Za-z\d!<>=]*)|(\d+(?:\.\d+)?|\.\d+)|([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)|([-+*/^(),])`;
/** Roll20's chat command, read as nothing so a GM may paste `/r 2d20kh1`. */
const COMMAND = /^\s*\/(?:roll|r)(?=\s|$)/i;

/** The text read into tokens, or the first character it cannot read. Positions count from 1, as a GM counts. */
function tokenize(text: string): Token[] | string {
  const re = new RegExp(TOKEN, 'y'), tokens: Token[] = [];
  let i = COMMAND.exec(text)?.[0].length ?? 0;
  for (;;) {
    while (i < text.length && /\s/.test(text[i]!)) i++;
    if (i >= text.length) return tokens;
    re.lastIndex = i;
    const m = re.exec(text);
    if (!m) return `Cannot read "${text[i]}" at character ${i + 1}. A formula uses numbers, dice such as 2d6 or 2d20kh1, names, + - * / ^, min, max, floor, ceil, round, abs and brackets.`;
    const at = i + 1, word = m[0];
    if (m[1] !== undefined && m[2] !== undefined) {
      const target = m[1].startsWith('target.'), name = (target ? m[1].slice('target.'.length) : m[1]) as Keyed;
      tokens.push({ t: 'keyed', name, target, key: m[2], at, text: word });
    } else if (m[3] !== undefined && m[4] !== undefined && m[5] !== undefined) {
      tokens.push({ t: 'dice', count: m[3] === '' ? 1 : Number(m[3]), sides: m[4] === '%' ? 100 : Number(m[4]), mods: m[5], at, text: word });
    } else if (m[6] !== undefined) tokens.push({ t: 'number', value: Number(m[6]), at, text: word });
    else if (m[7] !== undefined) tokens.push({ t: 'word', at, text: word });
    else tokens.push({ t: 'sym', at, text: word });
    i = re.lastIndex;
  }
}

const MOD = /kh|kl|dh|dl|k|d|ro|r|!|[<>=]/iy;
const POINT = /([<>=]?)(\d+)/y;
const WHOLE = /\d+/y;
const CUT_EXAMPLE: Readonly<Record<Cut['how'], string>> = { kh: '2d20kh1', kl: '2d20kl1', dh: '4d6dh1', dl: '4d6dl1' };
const MODS_HINT = 'After the dice come kh, kl, k, dh, dl or d (keep and drop), r or ro (roll again), ! (explode) and >, < or = (count successes), as in 10d20kh4.';

/** Whether `face` meets the point. */
export const meets = (face: number, c: Compare): boolean => c.op === '>' ? face >= c.n : c.op === '<' ? face <= c.n : face === c.n;
const pointText = (c: Compare): string => `${c.op === '=' ? '' : c.op}${c.n}`;

/**
 * The modifiers written after a dice term (`mods`, the text after `NdS`), or a sentence saying what is wrong. `term` is
 * the whole term as written, for the sentence.
 */
function readMods(term: string, mods: string, count: number, sides: number): DiceMods | string {
  let i = 0, explode: Compare | undefined, cut: Cut | undefined, success: Compare | undefined, once: boolean | undefined;
  const on: Compare[] = [];
  const point = (what: string): Compare | string | null => {
    POINT.lastIndex = i;
    const m = POINT.exec(mods);
    if (!m) return null;
    i = POINT.lastIndex;
    const c: Compare = { op: (m[1] || '=') as Compare['op'], n: Number(m[2]) };
    return c.n >= 1 && c.n <= sides ? c : `"${term}": ${what}${pointText(c)} is not a face of a d${sides}; a face is 1 to ${sides}.`;
  };
  while (i < mods.length) {
    MOD.lastIndex = i;
    const m = MOD.exec(mods);
    if (!m) return `Cannot read "${mods.slice(i)}" in "${term}". ${MODS_HINT}`;
    i = MOD.lastIndex;
    const name = m[0].toLowerCase();
    if (name === 'r' || name === 'ro') {
      if (once !== undefined && once !== (name === 'ro')) return `"${term}" mixes r and ro: roll a die again every time (r) or once (ro), not both.`;
      once = name === 'ro';
      const c = point(name);
      if (c === null) return `${name} needs a face: 2d8${name}1 or 2d8${name}<2.`;
      if (typeof c === 'string') return c;
      if (!on.some(x => x.op === c.op && x.n === c.n)) on.push(c);
    } else if (name === '!') {
      if (mods[i] === '!') return `"${term}": !! (compounding) is not read here; write ! to explode, as in 3d6!.`;
      if (explode) return `"${term}" explodes twice; write one !, as in 3d6! or 3d6!>5.`;
      const c = point('!');
      if (typeof c === 'string') return c;
      explode = c ?? { op: '=', n: sides };
    } else if (name === '>' || name === '<' || name === '=') {
      if (success) return `"${term}" counts successes twice; write one, as in 3d6>5.`;
      WHOLE.lastIndex = i;
      const n = WHOLE.exec(mods);
      if (!n) return `${name} needs a number: 3d6${name}5.`;
      i = WHOLE.lastIndex;
      success = { op: name, n: Number(n[0]) };
      if (success.n < 1 || success.n > sides) return `"${term}": ${name}${success.n} is not a face of a d${sides}; a face is 1 to ${sides}.`;
    } else {
      const how: Cut['how'] = name === 'k' ? 'kh' : name === 'd' ? 'dl' : name as Cut['how'];
      if (cut) return `"${term}" keeps or drops twice; a term keeps or drops once, as in 4d6kh3.`;
      WHOLE.lastIndex = i;
      const n = WHOLE.exec(mods);
      if (!n) return `${name} needs a number: ${CUT_EXAMPLE[how]}.`;
      i = WHOLE.lastIndex;
      cut = { how, n: Number(n[0]) };
      if (cut.n < 1 || cut.n > count) return `"${term}": ${name}${cut.n} ${how[0] === 'k' ? 'keeps' : 'drops'} ${cut.n} of ${count} dice; write 1 to ${count}.`;
    }
  }
  const out: { -readonly [K in keyof DiceMods]: DiceMods[K] } = {};
  if (once !== undefined) out.reroll = { on, once };
  if (explode) out.explode = explode;
  if (cut) out.cut = cut;
  if (success) out.success = success;
  return out;
}

const COMPARE_OPS: readonly Compare['op'][] = ['>', '<', '='];
const CUTS: readonly Cut['how'][] = ['kh', 'kl', 'dh', 'dl'];
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A stored term's modifiers (a save or a room message holds the tree), within the bounds the parser gives one: points
 * are faces of the die, keep and drop take 1 to `count`, rerolls name 1 to 3 × `sides` points (each op at each face).
 * `undefined` when there are none, null when they cannot be read. fight-parse.ts `formulaOf` is its caller to be.
 */
export function diceModsOf(v: unknown, count: number, sides: number): DiceMods | undefined | null {
  if (v === undefined) return undefined;
  if (!isRecord(v)) return null;
  const point = (x: unknown): Compare | null => {
    if (!isRecord(x)) return null;
    const op = COMPARE_OPS.find(o => o === x.op), n = x.n;
    return op && typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= sides ? { op, n } : null;
  };
  const out: { -readonly [K in keyof DiceMods]: DiceMods[K] } = {};
  if (v.reroll !== undefined) {
    const r = v.reroll;
    if (!isRecord(r) || typeof r.once !== 'boolean' || !Array.isArray(r.on) || r.on.length < 1 || r.on.length > 3 * sides) return null;
    const on = r.on.map(point);
    if (on.some(c => c === null)) return null;
    out.reroll = { on: on as Compare[], once: r.once };
  }
  if (v.explode !== undefined) { const c = point(v.explode); if (!c) return null; out.explode = c; }
  if (v.cut !== undefined) {
    const c = v.cut, how = isRecord(c) ? CUTS.find(h => h === c.how) : undefined, n = isRecord(c) ? c.n : undefined;
    if (!how || typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > count) return null;
    out.cut = { how, n };
  }
  if (v.success !== undefined) { const c = point(v.success); if (!c) return null; out.success = c; }
  return Object.keys(out).length ? out : undefined;
}

class Refusal { constructor(readonly error: string) {} }

/** The refusal of a formula past `FORMULA_PARTS`, before the read (its tokens) and after it (the faces rolled again too). */
const TOO_MANY_PARTS = `The formula has more than ${FORMULA_PARTS} parts, and a formula has at most ${FORMULA_PARTS}. Each number, die, name, sign and face rolled again is a part.`;
/**
 * Why a text is too big to read, before it is read, or null. Each token but a bracket and a comma becomes one part of the
 * tree, so more than `FORMULA_PARTS` of them is a formula past the bound; and the brackets of a formula of that many parts
 * nest at most that deep, one for each part on the way down (what `printFormula` writes). So whatever a field holds, the
 * reader below walks at most `FORMULA_PARTS` levels of each, and a long text pasted into a field is refused, not walked.
 * The parts of rolling a face again are counted after the read (`partsOf`).
 */
function tooBig(tokens: readonly Token[]): string | null {
  let parts = 0, depth = 0;
  for (const t of tokens) {
    if (t.t === 'sym' && (t.text === '(' || t.text === ')' || t.text === ',')) {
      depth += t.text === '(' ? 1 : t.text === ')' ? -1 : 0;
      if (depth > FORMULA_PARTS) return `The brackets at character ${t.at} are ${depth} deep. A formula has at most ${FORMULA_PARTS} parts, so it needs at most ${FORMULA_PARTS} brackets inside each other.`;
    } else if (++parts > FORMULA_PARTS) return TOO_MANY_PARTS;
  }
  return null;
}

/**
 * A GM's formula read into a tree, or what could not be read. Grammar (design 3.4):
 *
 *   expr  = term (("+" | "-") term)*
 *   term  = unary (("*" | "/") unary)*
 *   unary = "-" unary | power
 *   power = atom ("^" unary)?             right to left
 *   atom  = number | dice | name | "target." name | ("min" | "max") "(" expr "," expr ")"
 *         | ("floor" | "ceil" | "round" | "abs") "(" expr ")" | "(" expr ")"
 *   dice  = count? "d" (sides | "%") modifier*     the header's four steps, written with no space
 *
 * So `-2^2` is -(2^2), as school arithmetic reads it, `2^-1` is a half and `2^3^2` is 2^9. Names, dice and their
 * modifiers are read without regard to case.
 */
export function parseFormula(text: string, rules: FormulaRules): ParsedFormula {
  const tokens = tokenize(text);
  if (typeof tokens === 'string') return { ok: false, error: tokens };
  if (!tokens.length) return { ok: false, error: 'The formula is empty. Write a number, dice such as 1d8, or a name such as phys.' };
  const big = tooBig(tokens);
  if (big) return { ok: false, error: big };
  let k = 0;
  const peek = (): Token | undefined => tokens[k];
  const isSym = (s: string): boolean => { const p = peek(); return p !== undefined && p.t === 'sym' && p.text === s; };
  const refuse = (error: string): never => { throw new Refusal(error); };
  const after = (): string => { const prev = tokens[k - 1]; return prev ? ` after "${prev.text}"` : ''; };
  const need = (s: string, why: string): void => {
    const p = peek();
    if (isSym(s)) { k++; return; }
    refuse(p ? `Expected "${s}" at character ${p.at}, found "${p.text}". ${why}` : `The formula ends${after()}. ${why}`);
  };

  const expr = (): Formula => {
    let left = term();
    while (isSym('+') || isSym('-')) { const op = tokens[k++]!.text as BinaryOp; left = { kind: 'binary', op, left, right: term() }; }
    return left;
  };
  const term = (): Formula => {
    let left = unary();
    while (isSym('*') || isSym('/')) { const op = tokens[k++]!.text as BinaryOp; left = { kind: 'binary', op, left, right: unary() }; }
    return left;
  };
  const unary = (): Formula => {
    if (isSym('-')) { k++; return { kind: 'negate', arg: unary() }; }
    return power();
  };
  const power = (): Formula => {
    const left = atom();
    if (!isSym('^')) return left;
    k++;
    return { kind: 'binary', op: '^', left, right: unary() };
  };
  const atom = (): Formula => {
    const tok = peek();
    if (!tok) return refuse(`The formula ends${after()}. Write a number, dice or a name to finish it.`);
    k++;
    switch (tok.t) {
      case 'number': return { kind: 'number', value: tok.value };
      case 'dice': {
        const { maxDice, maxSides } = rules.dice;
        if (tok.count < 1 || tok.count > maxDice) refuse(`"${tok.text}" rolls ${tok.count} dice; a formula rolls 1 to ${maxDice} at once.`);
        if (tok.sides < 2 || tok.sides > maxSides) refuse(`"${tok.text}" has dice of ${tok.sides} sides; a die has 2 to ${maxSides}.`);
        const mods = readMods(tok.text, tok.mods, tok.count, tok.sides);
        if (typeof mods === 'string') return refuse(mods);
        const dice = { kind: 'dice', count: tok.count, sides: tok.sides } as const;
        return Object.keys(mods).length ? { ...dice, mods } : dice;
      }
      case 'word': return word(tok);
      case 'keyed': {
        if (tok.target && tok.name !== 'stacks') refuse(`"${tok.text}" at character ${tok.at}: ${tok.name} is read for the whole fight or the user; write ${tok.name}(${tok.key}).`);
        if (tok.key.length > KEY_MAX) refuse(`"${tok.key}" at character ${tok.at} is longer than a status's key (${KEY_MAX} characters).`);
        const key = tok.key as StatusKey;
        if (tok.name === 'stacks') return { kind: 'stacks', whose: tok.target ? 'target' : 'user', key };
        return tok.name === 'field' ? { kind: 'field', key } : { kind: 'held', key };
      }
      case 'sym': {
        if (tok.text === '(') { const inner = expr(); need(')', `The "(" at character ${tok.at} needs its ")".`); return inner; }
        return refuse(`Cannot read "${tok.text}" at character ${tok.at}. Write a number, dice or a name before it.`);
      }
      default: return tok satisfies never;
    }
  };
  const word = (tok: Token & { t: 'word' }): Formula => {
    const lower = tok.text.toLowerCase();
    const fn = FNS.find(f => f === lower);
    if (fn) {
      need('(', `Write ${fn} as ${fn}(a).`);
      const arg = expr();
      need(')', `Write ${fn} as ${fn}(a), with one part in the brackets.`);
      return { kind: 'fn', fn, arg };
    }
    if (lower === 'min' || lower === 'max') {
      need('(', `Write ${lower} as ${lower}(a, b).`);
      const left = expr();
      need(',', `Write ${lower} as ${lower}(a, b), with a comma between the two parts.`);
      const right = expr();
      need(')', `Write ${lower} as ${lower}(a, b).`);
      return { kind: lower, left, right };
    }
    const [head, tail] = lower.split('.') as [string, string | undefined];
    const whose: Whose = tail !== undefined && head === 'target' ? 'target' : 'user';
    const name = whose === 'target' ? tail! : tail === undefined ? head : null;
    const found = name === null ? undefined : NAMES.get(name);
    if (found === undefined) {
      const keyed = (KEYED as readonly string[]).includes(name ?? '') ? `Write ${name}(key), the key of a status in brackets.` : null;
      const hint = keyed ?? NAME_HINT;
      return refuse(`Unknown name "${tok.text}" at character ${tok.at}. ${hint}`);
    }
    if (found.kind === 'charge') {
      if (whose === 'target') refuse(`"${tok.text}" at character ${tok.at}: charge is the user's own channel; write charge.`);
      return { kind: 'charge' };
    }
    if (found.kind === 'missing') return { kind: 'missing', whose };
    if (found.kind === 'count') {
      if (whose === 'target') refuse(`"${tok.text}" at character ${tok.at}: ${found.name} is the use's own count; write ${found.name}.`);
      return { kind: 'count', name: found.name };
    }
    return found.kind === 'stat' ? { kind: 'stat', whose, key: found.key } : { kind: 'sheet', whose, key: found.key };
  };

  try {
    const formula = expr();
    const rest = peek();
    if (rest && rest.text === ')') return { ok: false, error: `The ")" at character ${rest.at} has no "(" to close.` };
    if (rest) return { ok: false, error: `Cannot read "${rest.text}" at character ${rest.at}. Join it to what comes before with + - * / or ^.` };
    if (partsOf(formula) > FORMULA_PARTS) return { ok: false, error: TOO_MANY_PARTS };
    return { ok: true, formula };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, error: e.error };
    throw e;
  }
}

/**
 * The formula's value. A step whose result is not a finite number (a division by 0, a root of a negative number, an
 * overflow) counts as 0: design 3.4 says division by 0 is 0, and one rule covers every such step.
 */
export function evaluate(formula: Formula, env: Env): number {
  let die = 0;
  const kit = env.kit ?? NO_KIT;
  const finite = (n: number): number => Number.isFinite(n) ? n : 0;
  const ev = (f: Formula): number => {
    switch (f.kind) {
      case 'number': return f.value;
      case 'dice': return env.dice[die++] ?? 0;
      case 'stat': return env[f.whose].stats[f.key];
      case 'sheet': return env[f.whose].sheet[f.key];
      case 'charge': return env.charge;
      case 'stacks': return kit.stacks[f.whose][f.key] ?? 0;
      case 'field': return kit.field[f.key] ?? 0;
      case 'missing': return kit.missing[f.whose];
      case 'held': return kit.held[f.key] ?? 0;
      case 'count': return kit[f.name];
      case 'negate': return -ev(f.arg);
      case 'min': return Math.min(ev(f.left), ev(f.right));
      case 'max': return Math.max(ev(f.left), ev(f.right));
      case 'fn': {
        const a = ev(f.arg);
        switch (f.fn) {
          case 'floor': return Math.floor(a);
          case 'ceil': return Math.ceil(a);
          case 'round': return Math.round(a);
          case 'abs': return Math.abs(a);
          default: return f.fn satisfies never;
        }
      }
      case 'binary': {
        const a = ev(f.left), b = ev(f.right);
        switch (f.op) {
          case '+': return finite(a + b);
          case '-': return finite(a - b);
          case '*': return finite(a * b);
          case '/': return finite(a / b);
          case '^': return finite(Math.pow(a, b));
          default: return f.op satisfies never;
        }
      }
      default: return f satisfies never;
    }
  };
  return finite(ev(formula));
}

/** The dice the edge rolls for one use of the formula, in reading order. */
export function diceOf(formula: Formula): Dice[] {
  switch (formula.kind) {
    case 'dice': { const { kind: _, ...dice } = formula; return [dice]; }
    case 'number': case 'stat': case 'sheet': case 'charge': case 'stacks': case 'field': case 'missing': case 'held': case 'count': return [];
    case 'negate': case 'fn': return diceOf(formula.arg);
    case 'binary': case 'min': case 'max': return [...diceOf(formula.left), ...diceOf(formula.right)];
    default: return formula satisfies never;
  }
}

// ── a dice term rolled ──

/**
 * One face a term rolled and what became of it. A `rerolled` face was rolled again and counts for nothing; an
 * `exploded` one added a die. In a term that counts successes a `success` face counts 1 and a `kept` one 0; in any
 * other a `kept` face counts its value. A `dropped` face counts for nothing.
 */
export type Face =
  | { readonly face: number; readonly fate: 'rerolled' }
  | { readonly face: number; readonly fate: 'kept' | 'dropped' | 'success'; readonly exploded: boolean };
/** A dice term rolled: every face in the order it was rolled, and the term's total. */
export type TermRoll = { readonly faces: readonly Face[]; readonly total: number };
/** The term needs at least `more` faces past those given: one for each die written that has not stood yet. */
export type More = { readonly more: number };

/**
 * For each standing face, whether the cut keeps it. Of two equal faces the one rolled first ranks higher, so `4d6kh3`
 * and `4d6dl1` strike the same die.
 */
function keptOf(faces: readonly number[], cut: Cut | undefined): boolean[] {
  if (!cut) return faces.map(() => true);
  const high = cut.how === 'kh' || cut.how === 'dh', keeps = cut.how === 'kh' || cut.how === 'kl';
  const above = (a: number, b: number): number => faces[b]! - faces[a]! || a - b;
  const order = faces.map((_, i) => i).sort((a, b) => high ? above(a, b) : above(b, a));
  const picked = new Set(order.slice(0, cut.n));
  return faces.map((_, i) => picked.has(i) === keeps);
}

/**
 * The term `d` read from `faces`, the edge's dice in the order it rolled them (each 1 to `d.sides`), by the header's four
 * steps: each die written rolls, rolls again while its face calls for it, and adds a die while its face explodes, before
 * the next die written rolls. If the faces run out first, how many more the term needs at least; the edge rolls them and
 * asks again with the longer list, which reads the same faces the same way. Pure: the same faces give the same roll.
 */
export function rollOf(d: Dice, faces: readonly number[]): TermRoll | More {
  const m = d.mods ?? {}, r = m.reroll, cap = r ? (r.once ? 1 : REROLL_MAX) : 0;
  const again = (face: number): boolean => r !== undefined && r.on.some(c => meets(face, c));
  const rolled: { face: number; stood: boolean; exploded: boolean }[] = [];
  let k = 0;
  for (let die = 0; die < d.count; die++) {
    for (let added = 0; ; added++) {
      let face = faces[k++];
      for (let tries = 0; face !== undefined && tries < cap && again(face); tries++) {
        rolled.push({ face, stood: false, exploded: false });
        face = faces[k++];
      }
      if (face === undefined) return { more: d.count - die };
      const exploded = m.explode !== undefined && added < EXPLODE_MAX && meets(face, m.explode);
      rolled.push({ face, stood: true, exploded });
      if (!exploded) break;
    }
  }
  const standing = rolled.filter(x => x.stood), kept = keptOf(standing.map(x => x.face), m.cut);
  let at = 0, total = 0;
  const out = rolled.map((x): Face => {
    if (!x.stood) return { face: x.face, fate: 'rerolled' };
    const fate = !kept[at++] ? 'dropped' : m.success && meets(x.face, m.success) ? 'success' : 'kept';
    total += fate === 'success' ? 1 : fate === 'kept' && !m.success ? x.face : 0;
    return { face: x.face, fate, exploded: x.exploded };
  });
  return { faces: out, total };
}

/** A formula rolled: its total, and each dice term with its faces, in reading order. */
export type Rolled = { readonly total: number; readonly terms: readonly (TermRoll & { readonly dice: Dice })[] };
/** The formula's total from its terms as rolled (one per `diceOf` term, in order), with the terms beside it. */
export function rolled(formula: Formula, scope: Scope, terms: readonly TermRoll[]): Rolled {
  const dice = diceOf(formula);
  return { total: evaluate(formula, { ...scope, dice: terms.map(t => t.total) }), terms: terms.map((t, i) => ({ ...t, dice: dice[i]! })) };
}

/** `f` with each dice term replaced by what `to` makes of it. */
function mapDice(f: Formula, to: (d: Formula & { kind: 'dice' }) => Formula): Formula {
  switch (f.kind) {
    case 'dice': return to(f);
    case 'number': case 'stat': case 'sheet': case 'charge': case 'stacks': case 'field': case 'missing': case 'held': case 'count': return f;
    case 'negate': case 'fn': return { ...f, arg: mapDice(f.arg, to) };
    case 'binary': case 'min': case 'max': return { ...f, left: mapDice(f.left, to), right: mapDice(f.right, to) };
    default: return f satisfies never;
  }
}

/**
 * A roll's d20 with an edge (kits design 8.2): the formula's one plain `1d20` rolled as `2d20kh1` (`kh`, advantage) or
 * `2d20kl1` (`kl`, disadvantage). A formula with no d20 term, more than one, or one that is not a plain `1d20` is left
 * as it is, as the Dice view's adv and dis have always done.
 */
export function withEdge(f: Formula, keep: 'kh' | 'kl'): Formula {
  const d20 = diceOf(f).filter(d => d.sides === 20), only = d20[0];
  if (d20.length !== 1 || !only || only.count !== 1 || only.mods) return f;
  return mapDice(f, d => d.sides === 20 ? { kind: 'dice', count: 2, sides: 20, mods: { cut: { how: keep, n: 1 } } } : d);
}

/**
 * A roll's natural d20, which a crit, a fumble and the coin call read: the one face its only d20 term keeps (`1d20`,
 * `2d20kh1`, `2d20kl1`), or null when the roll has no d20 term, more than one, or one that keeps more than one face or
 * counts successes.
 */
export function naturalOf(r: Rolled): number | null {
  const d20 = r.terms.filter(t => t.dice.sides === 20), only = d20[0];
  if (d20.length !== 1 || !only || only.dice.mods?.success) return null;
  const kept = only.faces.filter(f => f.fate === 'kept');
  return kept.length === 1 ? kept[0]!.face : null;
}

// ── a dice term's expected value ──

/** The chance a die stands on each face, 1 to `sides` (index 0 is face 1), after its rerolls. */
function standOdds(d: Dice): number[] {
  const r = d.mods?.reroll, s = d.sides, cap = r ? (r.once ? 1 : REROLL_MAX) : 0;
  const again = (face: number): boolean => r !== undefined && r.on.some(c => meets(face, c));
  const faces = Array.from({ length: s }, (_, i) => i + 1), q = faces.filter(again).length / s;
  // A face that is not rolled again stands at try 0 to `cap`; one that is stands only at try `cap`, when no try is left.
  let free = 0;
  for (let t = 0; t <= cap; t++) free += q ** t / s;
  return faces.map(f => again(f) ? q ** cap / s : free);
}

/**
 * How many dice of one written die's chain (the die and those its explosions add) fall in a set: index j is the chance
 * of j. `inE` and `outE` are the chances a die's face is in the set and explodes or not; `inStop` and `outStop` the same
 * for a face that does not explode. The chain's last die (EXPLODE_MAX added) adds none whatever its face.
 */
function chainIn(inE: number, outE: number, inStop: number, outStop: number): number[] {
  const done = new Array<number>(EXPLODE_MAX + 2).fill(0);
  let alive = [1];
  for (let j = 0; j <= EXPLODE_MAX; j++) {
    const last = j === EXPLODE_MAX, next = new Array<number>(alive.length + 1).fill(0);
    alive.forEach((p, n) => {
      if (last) { done[n + 1]! += p * (inE + inStop); done[n]! += p * (outE + outStop); return; }
      next[n + 1]! += p * inE; next[n]! += p * outE; done[n + 1]! += p * inStop; done[n]! += p * outStop;
    });
    alive = next;
  }
  return done;
}

/** Σ over j below `n` of (n - j) times the chance that `count` chains hold j dice of the set: the sum's law, cut at n. */
function shortOf(chain: readonly number[], count: number, n: number): number {
  let law = new Array<number>(n).fill(0);
  law[0] = 1;
  for (let i = 0; i < count; i++) {
    const next = new Array<number>(n).fill(0);
    law.forEach((p, a) => { if (p) chain.forEach((c, j) => { if (a + j < n) next[a + j]! += p * c; }); });
    law = next;
  }
  return law.reduce((sum, p, j) => sum + (n - j) * p, 0);
}

/**
 * The expected total of `d`. A plain term is count × (sides + 1) / 2. A term with modifiers sums, over each face value f,
 * the expected number of kept dice at f or above (a sum of faces is Σ_f #{faces ≥ f}; a count of successes is the kept
 * dice in its range). With no keep or drop that number is closed form: count × the chain's expected length × P(face ≥ f).
 * With one it needs the chance of each number of dice at f or above (or below f) among all chains below n, a convolution
 * cut at n: count × n × 12 steps for each f, at most 50 × 50 × 12 × 1000 under the rules' dice limits. Exact, in floats.
 */
export function mean(d: Dice): number {
  const m = d.mods;
  if (!m) return d.count * (d.sides + 1) / 2;
  const s = d.sides, odds = standOdds(d), explodes = (f: number): boolean => m.explode !== undefined && meets(f, m.explode);
  const pE = odds.reduce((sum, p, i) => sum + (explodes(i + 1) ? p : 0), 0);
  let length = 0;
  for (let j = 0; j <= EXPLODE_MAX; j++) length += pE ** j;
  /** The chain's law over faces at `f` or above (`above`) or below `f`. */
  const chain = (f: number, above: boolean): number[] => {
    let inE = 0, outE = 0, inStop = 0, outStop = 0;
    odds.forEach((p, i) => {
      const inside = (i + 1 >= f) === above;
      if (explodes(i + 1)) { if (inside) inE += p; else outE += p; } else if (inside) inStop += p; else outStop += p;
    });
    return chainIn(inE, outE, inStop, outStop);
  };
  const atLeast = (f: number): number => odds.reduce((sum, p, i) => sum + (i + 1 >= f ? p : 0), 0);
  /** The expected number of kept dice with a face of `f` or more. */
  const kept = (f: number): number => {
    if (f > s) return 0;
    const all = d.count * length * atLeast(f), cut = m.cut;
    if (!cut) return all;
    switch (cut.how) {
      case 'kh': return cut.n - shortOf(chain(f, true), d.count, cut.n);
      case 'dh': return all - cut.n + shortOf(chain(f, true), d.count, cut.n);
      case 'kl': return shortOf(chain(f, false), d.count, cut.n);
      case 'dl': return all - shortOf(chain(f, false), d.count, cut.n);
      default: return cut.how satisfies never;
    }
  };
  if (m.success) {
    const { op, n } = m.success, lo = op === '<' ? 1 : n, hi = op === '>' ? s : n;
    return kept(lo) - kept(hi + 1);
  }
  let total = 0;
  for (let f = 1; f <= s; f++) total += kept(f);
  return total;
}

/** The formula's value with every dice term at its mean: the maker's preview and the paper check. */
export const average = (formula: Formula, scope: Scope): number => evaluate(formula, { ...scope, dice: diceOf(formula).map(mean) });

// Binding strength of each node, low to high, as the grammar has it: a sum, a product, a negation, a power, an atom.
const level = (f: Formula): number => {
  if (f.kind === 'binary') return f.op === '+' || f.op === '-' ? 1 : f.op === '*' || f.op === '/' ? 2 : 4;
  return f.kind === 'negate' ? 3 : 5;
};

/**
 * A term's modifiers in the order they apply. `!` is bare on the highest face unless a success point follows, which a
 * bare `!` would read as its own (`1d6!>4` explodes on 4 or more).
 */
function printMods(m: DiceMods, sides: number): string {
  const r = m.reroll, reroll = r ? r.on.map(c => `${r.once ? 'ro' : 'r'}${pointText(c)}`).join('') : '';
  const bare = m.explode && m.explode.op === '=' && m.explode.n === sides && !m.success;
  const explode = m.explode ? `!${bare ? '' : pointText(m.explode)}` : '';
  const cut = m.cut ? `${m.cut.how}${m.cut.n}` : '';
  const success = m.success ? `${m.success.op}${m.success.n}` : '';
  return reroll + explode + cut + success;
}

/** The formula as text a GM reads, with only the brackets it needs; parsing it again gives the same tree. */
export function printFormula(f: Formula): string {
  const p = (x: Formula, min: number): string => level(x) < min ? `(${printFormula(x)})` : printFormula(x);
  switch (f.kind) {
    case 'number': return String(f.value);
    case 'dice': return `${f.count}d${f.sides}${f.mods ? printMods(f.mods, f.sides) : ''}`;
    case 'stat': case 'sheet': return f.whose === 'target' ? `target.${f.key}` : f.key;
    case 'charge': return 'charge';
    case 'stacks': return `${f.whose === 'target' ? 'target.' : ''}stacks(${f.key})`;
    case 'field': case 'held': return `${f.kind}(${f.key})`;
    case 'missing': return f.whose === 'target' ? 'target.missing' : 'missing';
    case 'count': return f.name;
    case 'negate': return `-${p(f.arg, 3)}`;
    case 'min': case 'max': return `${f.kind}(${printFormula(f.left)}, ${printFormula(f.right)})`;
    case 'fn': return `${f.fn}(${printFormula(f.arg)})`;
    case 'binary': {
      const l = level(f);
      return f.op === '^' ? `${p(f.left, 5)}^${p(f.right, 3)}` : `${p(f.left, l)} ${f.op} ${p(f.right, l + 1)}`;
    }
    default: return f satisfies never;
  }
}
