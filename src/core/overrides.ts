// overrides.ts: the one reader of a GM's rule overrides (the save repair at load and the rules editor). Each value is read
// against the rule it replaces in RULES: a number in the rule's domain (`domainOf`, declared beside the rule), true or
// false, or text of the rule's type, an object key by key, and each list, each null and each entry of an open map by the
// reader of its rule in `READERS`, so an entry that is not the rule's shape is refused and the GM is told which (its
// path) and, for a number out of its domain, its bounds (`refusalWords`). A refused value is left out, so the rule keeps
// its default: a save that holds one loads with the default. rulesOf in rules.ts merges what is kept. Pure. Its own
// module because the readers of a reward's parts (rewards.ts) import the rules.
import { titleKey } from './ids.ts';
import { OBJECTIVE_TARGET, PERK_KEYS, PERK_POINTS, RANKS, RULES, domainOf, inDomain } from './rules.ts';
import type { Domain, Perk } from './rules.ts';
import { REWARD_ENTRY } from './rewards.ts';

/**
 * Why an override was refused. `statuses`: a status is made in the Status dialog and kept in the library, not here.
 * `entry`: one entry of a list (or of an open map) is not the rule's shape; `length`: a list of a fixed length (a rank's
 * three DCs, a range's two ends) has another; `order`: a range's ends go high to low; `range`: a number out of its
 * rule's domain.
 */
export type OverrideReason = 'object' | 'unknown' | 'list' | 'number' | 'boolean' | 'text' | 'statuses' | 'entry' | 'length' | 'order' | 'range';
/** Every reason but `range`, which carries the domain the number was out of. */
type PlainReason = Exclude<OverrideReason, 'range'>;
/**
 * One refused override: where it was (a dotted path, '' for the whole value; an entry's index or key ends it) and why;
 * a number out of its rule's domain carries the domain, so the editor names its bounds.
 */
export type OverrideRefusal = { path: string; reason: PlainReason } | { path: string; reason: 'range'; domain: Domain };

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
/** Notes a refusal at `path`: a reason, or the domain a number was out of. */
type No = (path: string, why: PlainReason | Domain) => undefined;
/** A reader of one rule: the value it keeps, or undefined after noting each refusal with `no`. */
type Reader = (v: unknown, path: string, no: No) => unknown;
/** An entry reader: the entry it keeps, or null when the entry is not the rule's shape. */
type Entry = (v: unknown) => unknown;

/** Text with something in it, as written. */
const text: Entry = v => (typeof v === 'string' && v.trim() ? v : null);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A perk: points on the bonus keys (PERK_KEYS), each in PERK_POINTS; any other key refuses it. */
function perk(v: unknown): Perk | null {
  if (!isObj(v)) return null;
  const out: Perk = {};
  for (const [k, n] of Object.entries(v)) {
    const key = PERK_KEYS.find(x => x === k);
    if (!key || !finite(n) || !inDomain(n, PERK_POINTS)) return null;
    out[key] = n;
  }
  return out;
}
/** A daily objective: a label and a target in OBJECTIVE_TARGET; its progress, when given, a number from 0 (a template starts at 0). */
function objective(v: unknown): { label: string; target: number; progress: number } | null {
  if (!isObj(v) || typeof v.label !== 'string' || !v.label.trim() || !finite(v.target) || !inDomain(v.target, OBJECTIVE_TARGET)) return null;
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
/** A number of the rule at `path`, in its domain: the number, or undefined after noting it. No domain there: unknown. */
const numberAt = (v: unknown, path: string, no: No, d: Domain | null = domainOf(path)): number | undefined => {
  if (!d) return no(path, 'unknown'); // never: a lint of tests/lint.test.ts holds that every number of RULES has a domain
  if (!finite(v)) return no(path, 'number');
  return inDomain(v, d) ? v : no(path, d);
};
/** A list of exactly `n` numbers, each in the domain of the rule at `path`; an entry out of it is told by its index. */
const numbers = (n: number): Reader => (v, path, no) => {
  if (!Array.isArray(v)) return no(path, 'list');
  if (v.length !== n) return no(path, 'length');
  const read = v.map((x, i) => numberAt(x, `${path}.${i}`, no, domainOf(path)));
  return read.every(x => x !== undefined) ? read : undefined;
};
/** A range: two numbers in the domain of the rule at `path`, the first at most the second. */
const lowToHigh: Reader = (v, path, no) => {
  const ends = numbers(2)(v, path, no);
  if (!Array.isArray(ends)) return undefined;
  return ends[0] <= ends[1] ? ends : no(path, 'order');
};
/** A value whose rule is null until set: null, or what `entry` reads. */
const nullable = (entry: Entry): Reader => (v, path, no) => (v === null ? null : entry(v) ?? no(path, 'entry'));
/** A rarity: its color and the rank whose Clear prices it; a new one needs both, an override of a shipped one either. */
const rarity = (v: unknown, shipped: boolean): { color?: string; rank?: unknown } | null => {
  if (!isObj(v)) return null;
  if ((v.color !== undefined || !shipped) && typeof v.color !== 'string') return null;
  if (v.rank === undefined && !shipped) return null;
  const { color, rank } = v;
  return { ...(typeof color === 'string' ? { color } : {}), ...(rank !== undefined ? { rank } : {}) };
};
/** The rarities: a map the GM may add entries to, each read as a rarity, its rank one of `RANKS`. */
const rarities: Reader = (v, path, no) => {
  if (!isObj(v)) return no(path, 'object');
  const out: Rec = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === '__proto__') { no(`${path}.${k}`, 'unknown'); continue; }
    const kept = rarity(x, Object.hasOwn(RULES.rarities, k));
    if (!kept) { no(`${path}.${k}`, 'entry'); continue; }
    if (isObj(x)) for (const f of Object.keys(x)) if (f !== 'color' && f !== 'rank') no(`${path}.${k}.${f}`, 'unknown');
    if (kept.rank === undefined) { out[k] = kept; continue; }
    const rank = RANKS.find(r => r === kept.rank);
    if (rank) out[k] = { ...kept, rank }; else no(`${path}.${k}.rank`, 'entry');
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
  'loot.*.gold': lowToHigh,
  'gateSpawn.regulars.*': lowToHigh,
  gateNames: entries(text),
  'paths.*.tiers': entries(tier),
  rarities,
  'solo.pack': lowToHigh,
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
  const no: No = (p, why) => { refused.push(typeof why === 'string' ? { path: p, reason: why } : { path: p, reason: 'range', domain: why }); return undefined; };
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
  if (typeof base === 'number') return numberAt(v, path, no);
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

/** What the Rules editor says of each reason an override was refused, after the rule's path. */
export const OVERRIDE_REFUSAL_WORDS: Readonly<Record<Exclude<PlainReason, 'unknown'>, string>> = {
  object: 'must be an object', list: 'must be a list', number: 'must be a number', boolean: 'must be true or false', text: 'must be text',
  statuses: 'statuses are made in the Workshop', entry: 'is not in the shape this rule\'s entries have', length: 'has the wrong number of entries',
  order: 'must go from low to high',
};
/**
 * The Rules editor's sentence for a refused override. A number out of its domain names the bounds and why they are
 * there: "fight.round: must be a whole number from 100 to 10000. Ticks in a round: ...".
 */
export function refusalWords(r: OverrideRefusal): string {
  if (r.reason === 'unknown') return `Unknown rule: ${r.path}`;
  if (!r.path) return 'Overrides must be a JSON object.';
  if (r.reason !== 'range') return `${r.path}: ${OVERRIDE_REFUSAL_WORDS[r.reason]}.`;
  const d = r.domain;
  return `${r.path}: must be ${d.whole ? 'a whole number' : 'a number'} from ${d.least} to ${d.most}. ${d.why.charAt(0).toUpperCase()}${d.why.slice(1)}.`;
}
