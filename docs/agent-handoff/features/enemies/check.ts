// check.ts: reads the enemy draft (docs/agent-handoff/features/enemies/draft.json and mythic.json) and
// fails on a row the bestiary could not take as written. Each row is a SEEDS row as an object with no tweak. A row is
// made into a monster the way `seedMonsters` makes a seed (its specs through `monsterAbility`), then read by
// `parseMonster`; the parser must give back exactly what went in. Run: bun docs/agent-handoff/features/enemies/check.ts
import { readFileSync } from 'node:fs';
import { RANKS, RULES } from '../../../../src/core/rules.ts';
import { ARCHETYPE_LIST, MONSTER_BOUNDS, MONSTER_KINDS, SEEDS, parseMonster } from '../../../../src/core/registry/monsters.ts';
import type { MonsterTemplate } from '../../../../src/core/registry/monsters.ts';
import { monsterAbility } from '../../../../src/core/registry/abilities.ts';
import type { MonsterSpec } from '../../../../src/core/registry/abilities.ts';
import { STATUS_KEYS } from '../../../../src/core/registry/statuses.ts';

const DIR = new URL('./', import.meta.url);
const ROW_KEYS = ['key', 'name', 'rank', 'type', 'archetype', 'kind', 'abilities', 'notes', 'desc'];
const MYTHIC_KEYS = [...ROW_KEYS, 'mythic', 'unbeatable'];
/** The keys each kind of spec may hold besides `kind` and `name` (`MonsterSpec`, abilities.ts). */
const SPEC_KEYS: Record<MonsterSpec['kind'], readonly string[]> = {
  strike: ['heavy', 'feet', 'applies'], shot: ['feet', 'type', 'applies'], curse: ['feet', 'type', 'applies'],
  blast: ['feet', 'type', 'applies', 'leaves'], shield: [],
};
type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStatus = (v: unknown): boolean => (STATUS_KEYS as readonly unknown[]).includes(v);
const isFeet = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 5;
const isRounds = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 1;
/** The same value with every object's keys in order, so two values compare by what they hold. */
const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted)
  : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;

/** What is wrong with one spec as written, or nothing. */
function specWrong(s: unknown): string[] {
  if (!isObj(s) || !Object.hasOwn(SPEC_KEYS, String(s.kind))) return ['an ability is not a spec of a known kind'];
  const kind = s.kind as MonsterSpec['kind'], bad: string[] = [];
  if (typeof s.name !== 'string' || !s.name.trim()) bad.push('an ability has no name');
  for (const k of Object.keys(s)) if (k !== 'kind' && k !== 'name' && !SPEC_KEYS[kind].includes(k)) bad.push(`${s.name}: a ${kind} holds no "${k}"`);
  if (s.heavy !== undefined && s.heavy !== true) bad.push(`${s.name}: heavy is true or absent`);
  if (kind === 'blast' ? !isFeet(s.feet) : s.feet !== undefined && !isFeet(s.feet)) bad.push(`${s.name}: feet`);
  if (s.type !== undefined && s.type !== 'physical' && s.type !== 'magical') bad.push(`${s.name}: type`);
  if (s.applies !== undefined && !(isObj(s.applies) && isStatus(s.applies.status) && (s.applies.rounds === undefined || isRounds(s.applies.rounds)))) bad.push(`${s.name}: applies`);
  if (s.leaves !== undefined && !(isObj(s.leaves) && typeof s.leaves.name === 'string' && isRounds(s.leaves.rounds) && isStatus(s.leaves.status))) bad.push(`${s.name}: leaves`);
  return bad;
}

/** What is wrong with one row, or nothing. */
function rowWrong(row: unknown, keys: readonly string[]): string[] {
  if (!isObj(row)) return ['not an object'];
  const bad: string[] = [];
  for (const k of keys) if (!Object.hasOwn(row, k)) bad.push(`no "${k}"`);
  for (const k of Object.keys(row)) if (!keys.includes(k)) bad.push(`a key the shape does not have: "${k}"`);
  if (typeof row.key !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(row.key)) bad.push('the key is not a slug');
  if (!(RANKS as readonly unknown[]).includes(row.rank)) bad.push('rank');
  if (!(ARCHETYPE_LIST as readonly unknown[]).includes(row.archetype)) bad.push('archetype');
  if (!(MONSTER_KINDS as readonly unknown[]).includes(row.kind)) bad.push('kind');
  for (const k of ['name', 'type', 'desc']) if (typeof row[k] !== 'string' || !(row[k] as string).trim()) bad.push(`${k} is blank`);
  const specs = Array.isArray(row.abilities) ? row.abilities : null, notes = Array.isArray(row.notes) ? row.notes : null;
  if (!specs) bad.push('abilities is not a list');
  if (!notes || !notes.length) bad.push('notes is not a list of at least one line');
  bad.push(...(specs ?? []).flatMap(specWrong));
  if (bad.length || !specs) return bad;
  const names = specs.map(s => (s as MonsterSpec).name.toLowerCase());
  if (new Set(names).size !== names.length) bad.push('two abilities share a name');
  if (specs.length > MONSTER_BOUNDS.abilities) bad.push('too many abilities');
  // The monster as `seedMonsters` would make it, with every tweak at its default and its XP left to the rule.
  const made: MonsterTemplate = {
    name: row.name as string, rank: row.rank as MonsterTemplate['rank'], type: row.type as string,
    archetype: row.archetype as MonsterTemplate['archetype'], kind: row.kind as MonsterTemplate['kind'], tweak: {},
    abilities: (specs as MonsterSpec[]).map(s => monsterAbility(s, RULES)), notes: (notes as string[]).slice(), extractable: true,
    desc: row.desc as string, statuses: [], loot: { gold: 0, items: [] },
  };
  const read = parseMonster(JSON.parse(JSON.stringify(made)));
  if (!read) bad.push('the parser refuses it');
  else if (JSON.stringify(sorted(read)) !== JSON.stringify(sorted(JSON.parse(JSON.stringify(made))))) {
    const changed = Object.keys(made).filter(k => JSON.stringify(sorted((read as Rec)[k])) !== JSON.stringify(sorted(JSON.parse(JSON.stringify((made as Rec)[k])))));
    bad.push(`the parser changes: ${changed.join(', ')}`);
  }
  return bad;
}

const read = (file: string): unknown[] => {
  const v: unknown = JSON.parse(readFileSync(new URL(file, DIR).pathname, 'utf8'));
  if (!Array.isArray(v)) throw new Error(`${file} is not a list`);
  return v;
};
const draft = read('draft.json'), mythic = read('mythic.json');
const failures: string[] = [];
const keys = new Map<string, string>(SEEDS.map(s => [s[0], 'the shipped seeds']));
const names = new Map<string, string>(SEEDS.map(s => [s[1].toLowerCase(), 'the shipped seeds']));
for (const [file, rows, shape] of [['draft.json', draft, ROW_KEYS], ['mythic.json', mythic, MYTHIC_KEYS]] as const) {
  rows.forEach((row, i) => {
    const r = isObj(row) ? row : {}, where = `${file} row ${i + 1} (${String(r.key ?? '?')})`;
    for (const why of rowWrong(row, shape)) failures.push(`${where}: ${why}`);
    if (file === 'mythic.json') {
      if (r.mythic !== true) failures.push(`${where}: not marked mythic`);
      if (r.rank !== 'S') failures.push(`${where}: a mythic enemy is rank S`);
      if (typeof r.unbeatable !== 'string' || !r.unbeatable.trim() || r.unbeatable.includes('\n')) failures.push(`${where}: no one line on what makes it near unbeatable`);
    }
    const key = String(r.key), name = String(r.name).trim().toLowerCase();
    if (keys.has(key)) failures.push(`${where}: its key is also in ${keys.get(key)}`); else keys.set(key, where);
    if (names.has(name)) failures.push(`${where}: its name is also in ${names.get(name)}`); else names.set(name, where);
  });
}

const tally = (rows: unknown[], k: string): string => {
  const n = new Map<string, number>();
  for (const r of rows) if (isObj(r)) n.set(String(r[k]), (n.get(String(r[k])) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v, c]) => `${v} ${c}`).join(', ');
};
for (const [file, rows] of [['draft.json', draft], ['mythic.json', mythic]] as const) {
  console.log(`${file}: ${rows.length} rows`);
  for (const k of ['rank', 'archetype', 'kind', 'type']) console.log(`  ${k}: ${tally(rows, k)}`);
}
if (failures.length) { console.error(`\n${failures.length} failures:\n${failures.join('\n')}`); process.exit(1); }
console.log('\nEvery row is read back as written, and no key or name is held twice.');
