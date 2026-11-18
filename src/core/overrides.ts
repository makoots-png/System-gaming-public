// overrides.ts: the one reader of a GM's rule overrides (the save repair at load and the rules editor). Each value is read
// against the rule it replaces in RULES: a number, true or false, or text of the rule's type, an object key by key, and
// each list, each null and each entry of an open map by the reader of its rule in `READERS`, so an entry that is not the
// rule's shape is refused and the GM is told which (its path). rulesOf in rules.ts merges what is kept. Pure. Its own
// module because the readers of a reward's parts (rewards.ts) import the rules.
import { titleKey } from './ids.ts';
import { PERK_KEYS, RANKS, RULES, SOLO_BOUNDS } from './rules.ts';
import type { Perk } from './rules.ts';
import { REWARD_ENTRY } from './rewards.ts';

/**
 * Why an override was refused. `statuses`: a status is made in the Status dialog and kept in the library, not here.
 * `entry`: one entry of a list (or of an open map) is not the rule's shape; `length`: a list of a fixed length (a rank's
 * three DCs, a range's two ends) has another.
 */
export type OverrideReason = 'object' | 'unknown' | 'list' | 'number' | 'boolean' | 'text' | 'statuses' | 'entry' | 'length';
/** One refused override: where it was (a dotted path, '' for the whole value; an entry's index or key ends it) and why. */
export type OverrideRefusal = { path: string; reason: OverrideReason };

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
/** A reader of one rule: the value it keeps, or undefined after noting each refusal with `no`. */
type Reader = (v: unknown, path: string, no: (path: string, reason: OverrideReason) => undefined) => unknown;
/** An entry reader: the entry it keeps, or null when the entry is not the rule's shape. */
type Entry = (v: unknown) => unknown;

/** Text with something in it, as written. */
const text: Entry = v => (typeof v === 'string' && v.trim() ? v : null);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A perk: points on the bonus keys (PERK_KEYS), each a finite number; any other key refuses it. */
function perk(v: unknown): Perk | null {
  if (!isObj(v)) return null;
  const out: Perk = {};
  for (const [k, n] of Object.entries(v)) {
    const key = PERK_KEYS.find(x => x === k);
    if (!key || !finite(n)) return null;
    out[key] = n;
  }
  return out;
}
/** A daily objective: a label and a target above 0; its progress, when given, a number from 0 (a template starts at 0). */
function objective(v: unknown): { label: string; target: number; progress: number } | null {
  if (!isObj(v) || typeof v.label !== 'string' || !v.label.trim() || !finite(v.target) || v.target <= 0) return null;
  const progress = v.progress === undefined ? 0 : v.progress;
  return finite(progress) && progress >= 0 ? { label: v.label, target: v.target, progress } : null;
}
/** A title: a name, and when given a description and a bonus (a perk). */
function title(v: unknown): { key: string; name: string; desc: string; bonus: Perk; gmOnly?: true } | null {
  if (!isObj(v) || typeof v.name !== 'string' || !v.name.trim()) return null;
  const desc = v.desc === undefined ? '' : v.desc, bonus = v.bonus === undefined ? {} : perk(v.bonus);
  // its key as written, else one made from its name (an override that renames a title keeps the key it gives)
  const key = titleKey(v.key) ?? titleKey(v.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  return typeof desc === 'string' && bonus && key ? { key, name: v.name, desc, bonus, ...(v.gmOnly === true ? { gmOnly: true } : {}) } : null;
}
/** A path's tier: a list of perks. */
const tier: Entry = v => (Array.isArray(v) && v.every(p => perk(p) !== null) ? v.map(perk) : null);

/** A list whose entries `entry` reads; each entry it refuses is left out and told by its index. */
const entries = (entry: Entry): Reader => (v, path, no) => {
  if (!Array.isArray(v)) return no(path, 'list');
  return v.flatMap((x, i) => { const kept = entry(x); return kept === null ? (no(`${path}.${i}`, 'entry'), []) : [kept]; });
};
/** A list of exactly `n` finite numbers. */
const numbers = (n: number): Reader => (v, path, no) => {
  if (!Array.isArray(v)) return no(path, 'list');
  if (v.length !== n) return no(path, 'length');
  return v.every(finite) ? v : no(path, 'number');
};
/** A whole number from `lo` to `hi`: a rule a number outside of would break (0 hours between spawns spawns without end). */
const whole = (lo: number, hi: number): Reader => (v, path, no) => (finite(v) && Number.isInteger(v) && v >= lo && v <= hi ? v : no(path, 'number'));
/** Two whole numbers from `lo` to `hi`, the first at most the second (a range). */
const pair = (lo: number, hi: number): Reader => (v, path, no) => {
  if (!Array.isArray(v)) return no(path, 'list');
  if (v.length !== 2) return no(path, 'length');
  const [a, b] = v;
  return Number.isInteger(a) && Number.isInteger(b) && a >= lo && b <= hi && a <= b ? [a, b] : no(path, 'number');
};
/** A value whose rule is null until set: null, or what `entry` reads. */
const nullable = (entry: Entry): Reader => (v, path, no) => (v === null ? null : entry(v) ?? no(path, 'entry'));
/** A rarity: its color and its price factor above 0; a new one needs both, an override of a shipped one either. */
const rarity = (v: unknown, shipped: boolean): { color?: string; mult?: number } | null => {
  if (!isObj(v) || Object.keys(v).some(k => k !== 'color' && k !== 'mult')) return null;
  if ((v.color !== undefined || !shipped) && typeof v.color !== 'string') return null;
  if ((v.mult !== undefined || !shipped) && !(finite(v.mult) && v.mult > 0)) return null;
  const { color, mult } = v;
  return { ...(typeof color === 'string' ? { color } : {}), ...(finite(mult) ? { mult } : {}) };
};
/** The rarities: a map the GM may add entries to, each read as a rarity. */
const rarities: Reader = (v, path, no) => {
  if (!isObj(v)) return no(path, 'object');
  const out: Rec = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === '__proto__') { no(`${path}.${k}`, 'unknown'); continue; }
    const kept = rarity(x, Object.hasOwn(RULES.rarities, k));
    if (kept) out[k] = kept; else no(`${path}.${k}`, 'entry');
  }
  return out;
};

/**
 * The reader of each rule `against` cannot read from its shipped value: every list, every null and every open map. A
 * `*` stands for any one key (a rank, a path's id). tests/overrides.test.ts walks RULES and fails on such a rule with no
 * reader here.
 */
export const READERS: Readonly<Record<string, Reader>> = {
  'rankTable.*.dc': numbers(3),
  'dailyTemplate.objectives': entries(objective),
  'dailyTemplate.rewards.items': entries(v => REWARD_ENTRY.items(v)),
  'dailyTemplate.rewards.skills': entries(v => REWARD_ENTRY.skills(v)),
  'dailyTemplate.rewards.statuses': entries(v => REWARD_ENTRY.statuses(v)),
  'dailyTemplate.rewards.boons': entries(v => REWARD_ENTRY.boons(v)),
  'dailyTemplate.rewards.title': nullable(v => REWARD_ENTRY.title(v)),
  'dailyTemplate.rewards.job': nullable(text),
  jobs: entries(text),
  extractJobs: entries(text),
  titles: entries(title),
  slots: entries(text),
  'loot.*.gold': numbers(2),
  'gateSpawn.regulars.*': numbers(2),
  gateNames: entries(text),
  'paths.*.tiers': entries(tier),
  rarities,
  'solo.hours': whole(1, SOLO_BOUNDS.hours), 'solo.held': whole(1, SOLO_BOUNDS.held), 'solo.stays': whole(1, SOLO_BOUNDS.hours),
  'solo.ranks.*': whole(0, 100),
  'solo.pack': pair(1, SOLO_BOUNDS.pack),
};
const PATTERNS = Object.keys(READERS).map(k => ({ re: new RegExp(`^${k.replace(/\./g, '\\.').replace(/\*/g, '[^.]+')}$`), read: READERS[k]! }));
/** The reader of the rule at `path`, or null when its shipped value reads it. */
export const readerOf = (path: string): Reader | null => PATTERNS.find(p => p.re.test(path))?.read ?? null;

/** The roll tables' own lines (gm.js), not a rule: each table a list of text, `encounter` a list per rank. */
const GM_TABLE_LINE = 300, GM_TABLE_LINES = 200;
const tableLines = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, GM_TABLE_LINES).map(x => x.slice(0, GM_TABLE_LINE)) : null);
function gmTables(v: unknown): Rec | null {
  if (!isObj(v)) return null;
  const out: Rec = {};
  for (const [id, t] of Object.entries(v)) {
    if (id === 'encounter' && isObj(t)) {
      const byRank: Record<string, string[]> = {};
      for (const rank of RANKS) { const lines = Object.hasOwn(t, rank) ? tableLines(t[rank]) : null; if (lines) byRank[rank] = lines; }
      out[id] = byRank;
    } else { const lines = tableLines(t); if (lines && /^[\w-]{1,40}$/.test(id) && id !== '__proto__') out[id] = lines; }
  }
  return out;
}
/** `v` checked against the rule `base` it overrides at `path`: the value it keeps, or undefined after noting a refusal. */
function against(v: unknown, base: unknown, path: string, refused: OverrideRefusal[]): unknown {
  const no = (p: string, reason: OverrideReason): undefined => { refused.push({ path: p, reason }); return undefined; };
  const read = readerOf(path);
  if (read) return read(v, path, no);
  if (isObj(base)) {
    if (!isObj(v)) return no(path, 'object');
    const out: Rec = {};
    for (const [k, x] of Object.entries(v)) {
      const p = path ? `${path}.${k}` : k;
      if (!Object.hasOwn(base, k)) { no(p, 'unknown'); continue; }
      const kept = against(x, base[k], p, refused);
      if (kept !== undefined) out[k] = kept;
    }
    return out;
  }
  if (typeof base === 'number') return finite(v) ? v : no(path, 'number');
  if (typeof base === 'boolean') return typeof v === 'boolean' ? v : no(path, 'boolean');
  if (typeof base === 'string') return typeof v === 'string' ? v : no(path, 'text');
  return no(path, 'unknown');
}
/**
 * A GM's rule overrides read against the shape of RULES: the overrides it keeps, and what it refused. A key RULES does not
 * have, a value of another type than the rule's, or an entry of a list that is not the rule's shape is refused and left
 * out; the rest is kept. `conditions` is refused: statuses live in the save's `library.statuses`. `gmTables` (the roll
 * tables' lines) is kept beside the rules.
 */
export function parseOverrides(v: unknown): { overrides: Rec; refused: OverrideRefusal[] } {
  const refused: OverrideRefusal[] = [];
  if (!isObj(v)) return { overrides: {}, refused: [{ path: '', reason: 'object' }] };
  const { conditions, gmTables: tables, ...rest } = v;
  if (conditions !== undefined) refused.push({ path: 'conditions', reason: 'statuses' });
  const kept = against(rest, RULES, '', refused), overrides: Rec = isObj(kept) ? kept : {};
  if (tables !== undefined) { const t = gmTables(tables); if (t) overrides.gmTables = t; else refused.push({ path: 'gmTables', reason: 'object' }); }
  return { overrides, refused };
}
