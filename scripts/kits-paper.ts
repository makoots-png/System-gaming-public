// kits-paper.ts: every number in docs/agent-handoff/kits/design.md, printed under its section. Run: bun scripts/kits-paper.ts
// The design is on paper: nothing here is in src/ yet. `KIT` below is the block of rule numbers the design proposes for
// `RULES.fight.kit`, each with its reason; everything else comes from src/core (the sheets from derive.ts, the defence from
// resolve.ts, the statuses from registry/statuses.ts, the doc's bounds from fight-doc.ts and protocol.ts). What has no home
// in src/core yet (the reaction roll's expected value, a kit's closed form) is worked out here, as scripts/rw-paper.ts does.

import { RANKS, RULES } from '../src/core/rules.ts';
import type { Rank } from '../src/core/rules.ts';
import { TIER_BUDGET } from '../src/core/registry/paths.ts';
import type { StatKey, Stats } from '../src/core/stats.ts';
import { kitGear, monsterSheet, pointsAt, sheetOf, split } from '../src/core/hunter/derive.ts';
import type { Kit, MonsterKind, Sheet, StatusMod } from '../src/core/hunter/derive.ts';
import { afterDefence } from '../src/core/combat/resolve.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import { DOC_AHEAD, DOC_LOG, DOC_READY, DOC_ROWS, DOC_TILES_MAX, DOC_ZONE_RUNS } from '../src/core/combat/fight-doc.ts';
import { DOC_MAX } from '../src/core/protocol.ts';
import { LOG_LINE_MAX, MAX_ABILITIES } from '../src/core/combat/fight-types.ts';
import { MAX_ZONES } from '../src/core/combat/zones.ts';

const F = RULES.fight;

/**
 * The rule numbers the design proposes for `RULES.fight.kit` (design section 1, the caps table). Each comment is the reason.
 * The budget's tolerance is not here: section 3 works it out from the rules (`tolerance`), and the design writes the result
 * into the same block. Wave 2's numbers are `KIT2` and `SCALE` (section 8).
 */
const KIT = {
  stackCap: 20, // the most stacks a def may hold: twice the largest cap a sheet writes (Baangs 9, Cold's threshold 5), and two digits on a chip
  stackAdd: 3, // the most stacks one op adds: Anchor's "twice as fast" is 2; a third leaves room, a fourth is a threshold in one hit
  triggers: 4, // triggers on one status def: the most any kit item needs is 2 (Osteoporosis), and each one is a line the GM reads
  triggerOps: 6, // ops in one trigger, a threshold or an end: an item's effects list is 12, half of it is a full rule
  depth: 2, // a trigger's ops raise further triggers to this depth: Parry, then Retribution's hit, then Void Knight's stack is 2
  fires: 16, // trigger firings in one command, whatever the depth: 4 triggers on 4 statuses of the user is 16
  fightUses: 10, // the most uses an "n a fight" trigger or ability may have: a fight is 4 to 8 rounds, so 10 is "every turn"
  prices: 2, // extra costs on one ability: HP and a stack (Truth in Pain), or a stack and a zone (Soul Shatter)
  gates: 3, // conditions on one ability: a mode, stacks on the target and a use limit (Spirit Shackle)
  hpShare: 0.5, // an HP cost of at most half the max HP: past that one use is most of a life, and a heal must pay it back
  hpFlat: 999, // the bound of every flat number the parsers read (SKILL_BOUNDS.bonus)
  tags: 3, // tags on one ability: Hwei's painting type and "ultimate" are two
  tagLength: 20, // a tag is a word the GM types: "disaster", "ultimate", "sword"
  zonesPerOwner: 3, // zones one body holds at once: Einar starts at 3 boundaries; a fourth replaces the oldest
  zoneAge: 1, // rounds a zone must stand before ending it pays its end: placing and popping in one turn would be a free blast
  summons: 2, // timed summons one body holds at once: two sprites; past that the order of turns is the summoner's alone
  summonRounds: 5, // the longest a summon stays: a fight is 4 to 8 rounds, and a summon for the whole fight is a hunter
  fieldStacks: 60, // `field(key)` reads at most this: three bodies at the cap of 20
  kills: 10, // `kills` reads at most this: a pack is 3 to 6, a long fight 10
  held: 10, // `held(key)` reads at most this many rounds: past a long fight
  hits: 16, // `hits` reads at most this many bodies: every zone's worth of a crowd
} as const;

// ── printing ──
const out = (s = ''): void => { console.log(s); };
const section = (title: string): void => { out(); out(`## ${title}`); out(); };
const cell = (v: string | number): string => typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : v;
const table = (head: readonly string[], rows: readonly (readonly (string | number)[])[]): void => {
  out(`| ${head.join(' | ')} |`);
  out(`|${head.map(() => '---').join('|')}|`);
  for (const r of rows) out(`| ${r.map(cell).join(' | ')} |`);
  out();
};
const pct = (x: number): string => `${Math.round(x * 100)}%`;
const many = <T>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));

// ════════════════════════════════════════════════════════════════════════════
// 1. The blocks: the caps table and the room doc
// ════════════════════════════════════════════════════════════════════════════

/** The worst-case fight doc of tests/protocol.test.ts ("worst-case rows"), rebuilt from the same bounds. */
function worstDoc(rows: number, extra: { stacks: boolean; uses: boolean }): number {
  const six = Object.entries(BUILT_IN_STATUSES).sort((a, b) => b[1].label.length - a[1].label.length).slice(0, 6);
  const row = (i: number) => ({
    id: `m-${String(i).padStart(2, '0')}`, name: 'n'.repeat(60), side: 'foe', key: null, place: { x: 63, y: 63 }, at: 1234567, speed: 123.45, band: 'critical',
    statuses: six.map(([key, def]) => ({ key, label: def.label, left: 12.3, ...(extra.stacks ? { stacks: KIT.stackCap } : {}) })), shield: 99999, shieldLeft: 12.3,
    channel: { ability: 'a'.repeat(40), name: 'c'.repeat(60), charge: 99, max: 99, state: 'holding', factor: 99999.99 }, taunt: { by: 'm-31', left: 12.3 }, down: false,
    kind: 'monster', intent: { name: 'i'.repeat(60), target: { x: 63, y: 63 }, reveal: { lines: many(4, () => 'l'.repeat(80)), radius: 63, outer: 63 } },
    stagger: { fill: 12345, max: 99999, staggered: 1.5 }, suggest: 'm-31',
  });
  const doc = {
    ended: false, active: true, by: `d-${'a'.repeat(37)}`, id: `f-${'x'.repeat(20)}`, at: '2026-11-12T12:00:00.000Z', now: 1234567, currentId: 'm-00',
    ahead: many(DOC_AHEAD, i => `m-${String(i).padStart(2, '0')}`),
    grid: { w: 40, h: 40, tiles: '#'.repeat(DOC_TILES_MAX), lit: '1'.repeat(DOC_TILES_MAX) },
    zones: many(MAX_ZONES, i => ({ id: `z${String(i).padStart(39, '0')}`, name: 'z'.repeat(40), tiles: '1599+1,'.repeat(40).slice(0, DOC_ZONE_RUNS - 1) + '1', tone: 'hinder', left: 12345.6, anchor: `m-${String(i).padStart(2, '0')}` })),
    rows: many(rows, row), log: many(DOC_LOG, () => 'y'.repeat(LOG_LINE_MAX)),
    refused: { id: 'm-00', at: 1234567, reason: 'unknownAbility', n: 999999999 },
    ready: Object.fromEntries(many(DOC_READY, i => [`${'r'.repeat(38)}${String(i).padStart(2, '0')}`, 1234567])),
    ...(extra.uses ? { left: Object.fromEntries(many(MAX_ABILITIES, i => [`${'r'.repeat(38)}${String(i).padStart(2, '0')}`, KIT.fightUses])) } : {}),
  };
  return JSON.stringify(doc).length;
}

function part1(): void {
  section('1. The blocks');
  out('Table 1.1: the caps every parser of the blocks reads (proposed `RULES.fight.kit`), with what a value past one becomes.');
  out();
  const caps: [string, number | string, string][] = [
    ['stackCap', KIT.stackCap, 'A def\'s `cap` is clamped to 1 to 20'],
    ['stackAdd', KIT.stackAdd, 'An `applyStatus` op\'s `stacks` is clamped to 1 to 3'],
    ['triggers', KIT.triggers, 'A def keeps its first 4 triggers'],
    ['triggerOps', KIT.triggerOps, 'A trigger, a threshold or an end keeps its first 6 ops'],
    ['depth', KIT.depth, 'Not a parser bound: the reducer fires nothing past depth 2'],
    ['fires', KIT.fires, 'Not a parser bound: the reducer fires at most 16 triggers a command'],
    ['fightUses', KIT.fightUses, 'A limit of "n a fight" or "n a rest" is clamped to 1 to 10'],
    ['prices', KIT.prices, 'An ability keeps its first 2 prices'],
    ['gates', KIT.gates, 'An ability keeps its first 3 gates'],
    ['hpShare', KIT.hpShare, 'An HP price as a share is clamped to 0.01 to 0.5'],
    ['hpFlat', KIT.hpFlat, 'An HP price as a number is clamped to 1 to 999'],
    ['tags', KIT.tags, 'An ability keeps its first 3 tags; a tag is cut to 20 lower-case letters, digits or hyphens'],
    ['zonesPerOwner', KIT.zonesPerOwner, 'Not a parser bound: a fourth zone of one owner ends its oldest, with no payoff'],
    ['zoneAge', `${KIT.zoneAge} round`, 'Not a parser bound: a zone younger than a round ends with no payoff'],
    ['summons', KIT.summons, 'Not a parser bound: a third summon of one owner sends its oldest away'],
    ['summonRounds', KIT.summonRounds, 'A summon\'s rounds are clamped to 1 to 5'],
    ['fieldStacks', KIT.fieldStacks, '`field(key)` reads min(sum, 60)'],
    ['kills', KIT.kills, '`kills` reads min(kills, 10)'],
    ['held', KIT.held, '`held(key)` reads min(rounds, 10)'],
    ['hits', KIT.hits, '`hits` reads min(bodies, 16)'],
  ];
  table(['Rule', 'Value', 'What the parser or the reducer does with more'], caps);

  out('Table 1.2: the room doc. The worst case of tests/protocol.test.ts rebuilt here, then with a stack count on each of a row\'s six');
  out(`statuses (\`"stacks":${KIT.stackCap}\`) and the uses left of the current row's ${MAX_ABILITIES} abilities (\`left\`), against the cap of ${DOC_MAX} with an eighth`);
  out('to spare (the doc times 9/8 must be at most the cap).');
  out();
  const rowsTo = (n: number, stacks: boolean, uses: boolean): (string | number)[] => {
    const size = worstDoc(n, { stacks, uses });
    return [`${n} rows${stacks ? ', stacks' : ''}${uses ? ', uses left' : ''}`, size, Math.ceil(size * 9 / 8), size * 9 / 8 <= DOC_MAX ? 'fits' : 'too big'];
  };
  table(['Doc', 'Characters', 'Times 9/8', `Against ${DOC_MAX}`], [
    rowsTo(DOC_ROWS, false, false), rowsTo(DOC_ROWS, true, false), rowsTo(DOC_ROWS, true, true),
    rowsTo(DOC_ROWS - 1, true, true), rowsTo(DOC_ROWS - 2, true, true),
  ]);
  const perRow = worstDoc(2, { stacks: true, uses: false }) - worstDoc(1, { stacks: true, uses: false });
  out(`A worst-case row with stacks is ${perRow} characters, so each row the cap drops frees that many.`);
  out();
}

// ════════════════════════════════════════════════════════════════════════════
// 2. The state trees: each machine's table, the rows a `TABLE` will hold
// ════════════════════════════════════════════════════════════════════════════

type Cell = readonly [from: string, event: string, to: string, what: string];
/** Each machine of design section 2, as the cells its `TABLE` will hold. A missing (state, event) pair is "nothing happens". */
const MACHINES: readonly { readonly name: string; readonly where: string; readonly cells: readonly Cell[] }[] = [
  {
    name: '2.1 A stacking status on one bearer', where: 'effect-ops.ts `stackStep`', cells: [
      ['absent', 'apply k', 'held min(k, cap)', 'Source, end and `since` as `applyStatus` sets them today; then the threshold check'],
      ['held n', 'apply k', 'held min(n + k, cap)', 'The later end, the higher tier\'s source and def; then the threshold check'],
      ['held n', 'crossing (n before < N <= n after)', 'firing', 'N is the threshold\'s count, or its formula over the bearer, clamped 1 to cap'],
      ['firing', 'then spend', 'held n - N, or absent at 0', 'The threshold\'s ops land on the bearer (or its area) once, from the status\'s source'],
      ['firing', 'then keep', 'held n', 'Fires again only after the count falls below N and climbs back'],
      ['held n', 'a whole round (leave: round)', 'held n - 1, or absent at 0', 'Counted at the bearer\'s settle from `since`, as a spread counts its rounds'],
      ['held n', 'the named event (leave: event)', 'absent', 'All stacks leave: the bearer crits, is struck, moves'],
      ['held n', 'a price takes m', 'held n - m, or absent at 0', 'Going down never fires a threshold'],
      ['held n', 'time ends', 'absent', 'Its end lands if it has one (2.2)'],
      ['held n', 'cure (a cleanse, the GM)', 'absent', 'All stacks at once, as the sheet\'s Dispel says'],
      ['held n', 'the fight ends (keep: fight)', 'absent', 'Not written to the sheet: Pain, Baangs, Haste are a fight\'s count'],
      ['held n', 'the fight ends (keep: sheet)', 'held n on the sheet', 'Written back with its stacks and rounds left: Mercy, Cold'],
    ],
  },
  {
    name: '2.2 A delayed effect (a status with an end)', where: 'effect-ops.ts `settle` and `endOf`', cells: [
      ['absent', 'apply', 'armed', 'Its `until` is the applying op\'s duration'],
      ['armed', 'apply again', 'armed', 'The later end: a second Hemoplague pushes the hit back, and a stacking one grows it'],
      ['armed', 'the bearer\'s settle at or after `until`', 'landed', 'The end\'s ops land on the bearer from the source, at their average, times the stacks'],
      ['armed', 'cure, end: cancel', 'cancelled', 'Nothing lands (the default: a cleanse saves you)'],
      ['armed', 'cure, end: land', 'landed', 'It lands at once (a detonation: Ceremony, a rend)'],
      ['armed', 'a price spends it to 0', 'cancelled', 'Spent is not ended'],
      ['armed', 'the bearer goes down', 'void', 'Nothing lands; a hunter at 0 keeps it (it is dying, not gone)'],
      ['armed', 'the fight ends', 'void', 'Dropped, never written to a sheet'],
    ],
  },
  {
    name: '2.3 A limited use (an ability with uses a fight or a rest)', where: 'resolve.ts rule 3b, the row\'s `used`', cells: [
      ['ready k left', 'used', 'ready k - 1, or spent at 0', 'Counted when the use resolves, not when it is refused'],
      ['spent', 'used', 'spent', 'Refused: `noUses`'],
      ['ready or spent (per fight)', 'the fight ends', 'ready n', 'The row is gone; the next fight\'s row starts at n'],
      ['ready or spent (per rest)', 'the fight ends', 'the sheet keeps k', 'Written back with `vitals` (`Vitals.used`)'],
      ['ready or spent (per rest)', 'a long rest', 'ready n', 'vitals.ts `rest` clears `used`'],
      ['any', 'the GM sets it', 'ready k', 'The fight\'s `adjust` gains `used`'],
    ],
  },
  {
    name: '2.4 A timed summon', where: 'fight-turn.ts `startTurn`, resolve.ts rule 18d', cells: [
      ['absent', 'a use with `summon`', 'present until now + rounds', 'A new row on the user\'s side, `at = now + interval`, owned by the user'],
      ['present', 'its turn starts before `until`', 'present', 'Its owner\'s phone commands it (the GM\'s for a monster\'s)'],
      ['present', 'its turn starts at or after `until`', 'gone', 'Removed before it acts: a summon of 2 rounds acts in 2 rounds of time'],
      ['present', 'its owner goes down or leaves', 'gone', 'A sprite with nobody to will it'],
      ['present', 'HP 0', 'gone', 'As a monster at 0'],
      ['present', 'a third summon of the same owner', 'gone (the oldest)', 'Two at once (`summons`)'],
      ['present', 'the fight ends', 'gone', 'Never written to a sheet'],
    ],
  },
  {
    name: '2.5 A trigger\'s limit (one trigger of one status on one bearer)', where: 'the row\'s `trips`, fight-turn.ts `fire`', cells: [
      ['ready', 'its event (limit: each)', 'ready', 'Its ops land; counted against `fires` and `depth`'],
      ['ready', 'its event (limit: once a round)', 'tripped this round', 'The round is `floor(now / round)`'],
      ['tripped this round', 'its event, same round', 'tripped this round', 'Nothing'],
      ['tripped this round', 'its event, a later round', 'tripped this round', 'Fires: the round moved on'],
      ['ready (k of n a fight)', 'its event', 'ready k + 1, or spent at n', 'The count lives on the row, so a cure and a new copy of the status do not reset it'],
      ['any', 'past depth 2 or 16 firings', 'unchanged', 'Skipped, not counted'],
    ],
  },
  {
    name: '2.6 A zone with an upkeep', where: 'zones.ts `zoneSync`, fight-turn.ts `startTurn`', cells: [
      ['laid', 'its owner\'s turn starts', 'laid', 'The owner pays the upkeep for the time since it last paid, as a per-round op pays'],
      ['laid', 'the owner cannot pay', 'lapsed', 'Gone at once, no end payoff'],
      ['laid', 'a fourth zone of the owner', 'evicted (the oldest)', 'Gone, no end payoff'],
      ['laid', 'a price ends it, at least a round old', 'ended', 'Its end ops land on whoever stands in it'],
      ['laid', 'a price ends it, younger', 'ended', 'Nothing lands (`zoneAge`)'],
      ['laid', '`until` passes', 'ended', 'Its end ops land (Harmony\'s stun)'],
      ['laid', 'its owner goes down (ends with owner)', 'ended', 'Nothing lands: the owner is not there to close it'],
    ],
  },
];

function part2(): void {
  section('2. The state trees');
  for (const m of MACHINES) {
    out(`Table ${m.name} (\`TABLE\` in ${m.where}).`);
    out();
    table(['From', 'Event', 'To', 'What happens'], m.cells);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 3. The budget
// ════════════════════════════════════════════════════════════════════════════

type Build = 'speed' | 'tank' | 'cannon' | 'bruiser' | 'support';
const BUILD: { readonly [B in Build]: { readonly main: StatKey; readonly second: StatKey; readonly kit: Kit } } = {
  speed: { main: 'agi', second: 'str', kit: 'light' }, tank: { main: 'vit', second: 'str', kit: 'heavy' },
  cannon: { main: 'pow', second: 'ctl', kit: 'light' }, bruiser: { main: 'str', second: 'vit', kit: 'medium' },
  support: { main: 'pre', second: 'dis', kit: 'light' },
};
const SIM: readonly Rank[] = ['E', 'C', 'S'];
const perkPoints = (rank: Rank): number => TIER_BUDGET.slice(0, RANKS.indexOf(rank) + 1).reduce((s, v) => s + v, 0);
function statsOf(b: Build, rank: Rank): Stats {
  const { main, second } = BUILD[b], st = split(main, second, pointsAt(RULES.rankLevels[rank], RULES), RULES);
  return { ...st, [main]: st[main] + perkPoints(rank) };
}
/** A paper build's sheet (design 2.3's five), under `mods` (a mode's stat bonus). */
const sheet = (b: Build, rank: Rank, mods: readonly StatusMod[] = []): Sheet =>
  sheetOf({ stats: statsOf(b, rank), level: RULES.rankLevels[rank], gear: kitGear(BUILD[b].kit, RULES), perks: {} }, RULES, mods);
const brute = (rank: Rank, kind: MonsterKind): Sheet => monsterSheet(rank, 'brute', kind, RULES);

type Type = 'physical' | 'magical';
const edge = (mine: number, theirs: number): number => Math.max(-F.reactCap, Math.min(F.reactCap, Math.round(F.reactK * (mine - theirs))));
const FACES = many(20, i => i + 1);
const dealt = (raw: number, type: Type, u: Sheet, t: Sheet): number => afterDefence(raw, type, u, t, RULES);
/** A standard action's budget: the recommended standard formula's average, `1d8 + power` (registry/ability-kinds.ts). */
const SA = (u: Sheet, type: Type): number => 4.5 + (type === 'physical' ? u.phys : u.mag);
/**
 * One use's expected outcome on `t` over its 20 faces: a touch or travel use that lands after `land` rounds (it is out
 * when the target walks a tile), or a direct use that Will resists for half. `caught` is the share that applies a status.
 */
function use(raw: number, type: Type, u: Sheet, t: Sheet, how: { kind: 'travel'; land: number } | { kind: 'direct' } | { kind: 'sure' }): { dealt: number; caught: number } {
  if (how.kind === 'sure') return { dealt: dealt(raw, type, u, t), caught: 1 };
  let sum = 0, caught = 0;
  for (const f of FACES) {
    if (how.kind === 'direct') {
      if (f === 20 || f + edge(t.will, u.aim) >= F.resistDc) { sum += dealt(raw * F.resistedShare, type, u, t); continue; }
    } else if (Math.floor(t.move * how.land * Math.max(0, Math.min(1, (f + edge(t.react, u.aim)) / 20))) >= 1) continue;
    caught++;
    sum += dealt(f <= u.critFaces ? raw * u.critSize : raw, type, u, t);
  }
  return { dealt: sum / 20, caught: caught / 20 };
}
const STRIKE = { kind: 'travel', land: F.abilityKinds.strike.windup / F.round } as const;
const CURSE = { kind: 'direct' } as const;
/** Standard actions a round at `speed`. */
const perRound = (u: Sheet, cost: number = F.cost.standard): number => u.speed / 100 * F.cost.standard / cost;

// The paper's default attacks of design table 6.1 (scripts/rw-paper.ts), to measure the triangle's closest margin.
type Attack = { raw: (s: Sheet) => number; type: Type; cost: number; land: number };
const ATTACK: { readonly [B in Build]: Attack } = {
  speed: { raw: s => 3.5 + 0.7 * s.phys, type: 'physical', cost: F.cost.quick, land: 0.2 },
  tank: { raw: s => 4.5 + s.phys, type: 'physical', cost: F.cost.standard, land: 0.1 },
  cannon: { raw: s => 4.5 + s.mag, type: 'magical', cost: F.cost.standard, land: 0.25 },
  bruiser: { raw: s => 4.5 + s.phys, type: 'physical', cost: F.cost.standard, land: 0.1 },
  support: { raw: s => 3.5 + s.sup, type: 'magical', cost: F.cost.standard, land: 0 },
};
const BLAST: Attack = { raw: s => 13.5 + 1.5 * s.mag, type: 'magical', cost: F.cost.heavy, land: 0.6 };
const FIGHT_ROUNDS = 6; // the reference fight of design 6 (rw-paper's PAPER.FIGHT_ROUNDS)
const exp = (a: Attack, u: Sheet, t: Sheet): number => use(a.raw(u), a.type, u, t, { kind: 'travel', land: a.land }).dealt;
function dps(b: Build, u: Sheet, t: Sheet): number {
  const a = ATTACK[b], base = exp(a, u, t) * perRound(u, a.cost), casts = Math.floor(u.manaMax / F.abilityKinds.blast.mana);
  if (!casts) return base;
  return base + Math.max(0, casts * (exp(BLAST, u, t) - exp(a, u, t) * F.cost.heavy / a.cost)) / FIGHT_ROUNDS;
}
/** The rounds each side of a duel needs to kill the other, and the loser's over the winner's. */
function margin(a: Build, b: Build, rank: Rank): number {
  const x = sheet(a, rank), y = sheet(b, rank), ta = y.hpMax / dps(a, x, y), tb = x.hpMax / dps(b, y, x);
  return Math.max(ta, tb) / Math.min(ta, tb);
}
/** The smallest margin of the triangle at C and S: a kit may add less than this, or it can flip a row by itself. */
const TRIANGLE: readonly [Build, Build][] = [['speed', 'cannon'], ['tank', 'speed'], ['cannon', 'tank']];
const tolerance = (): number => Math.min(...TRIANGLE.flatMap(([a, b]) => (['C', 'S'] as const).map(r => margin(a, b, r)))) - 1;

/** The party of design 6.2 against a pack of three normal brutes or a boss: the rounds to clear it, on paper. */
function partyRounds(rank: Rank, kind: 'normal' | 'boss'): number {
  const m = brute(rank, kind), n = kind === 'normal' ? 3 : 1;
  const d = (['tank', 'bruiser', 'cannon'] as const).reduce((s, b) => s + dps(b, sheet(b, rank), m), 0);
  return m.hpMax * n / d;
}
/** A same-rank support's heal or shield in one standard action: `1.5 * sup` (registry/ability-kinds.ts, the support kind). */
const heal = (rank: Rank): number => 1.5 * sheet('support', rank).sup;
/** What one HP of a price is worth in SA: the share of a same-rank support's action that heals it back. */
const hpRate = (rank: Rank): number => 1 / heal(rank);

/** Expected events a round for a build at C against one same-rank normal brute: what the maker multiplies a trigger by. */
function eventRates(rank: Rank): (string | number)[][] {
  const m = brute(rank, 'normal');
  return (Object.keys(BUILD) as Build[]).map(b => {
    const u = sheet(b, rank), a = ATTACK[b], hit = use(a.raw(u), a.type, u, m, { kind: 'travel', land: a.land });
    const turns = perRound(u, a.cost), struck = perRound(m) * use(4.5 + m.phys, 'physical', m, u, STRIKE).caught;
    return [b, turns, turns * hit.caught, struck, u.critFaces / 20 * turns * hit.caught, dps(b, u, m) / m.hpMax];
  });
}

// ── the three example kits, each against its plain build ──
type KitName = 'blood' | 'mark' | 'pain';
type KitRow = { readonly kit: KitName; readonly label: string; readonly user: Build; readonly type: Type };
const KITS: readonly KitRow[] = [
  { kit: 'blood', label: 'Blood stacker (Glas)', user: 'cannon', type: 'magical' },
  { kit: 'mark', label: 'Signature (Hwei)', user: 'cannon', type: 'magical' },
  { kit: 'pain', label: 'Pain (Einar)', user: 'bruiser', type: 'physical' },
];
/**
 * Each kit's fixed shape, and the one lever `lever` searches. Blood stacker: Bloodletting is `share` of a standard curse
 * and adds a Resonance stack when it is not resisted; at `at` stacks Resonance bursts for the lever in SA.
 * Signature: Disaster Stroke is `share` of a standard curse and adds a mark; at `at` marks it bursts for the lever in SA
 * on every foe within 2 tiles. Pain: every hit dealt adds a Pain stack (to `cap`); Violence, used at `at` stacks, is a
 * standard strike times `1 + lever * spent`.
 */
const SHAPE = { blood: { share: 0.7, at: 3 }, mark: { share: 0.75, at: 2 }, pain: { at: 5, cap: 10 } } as const;
/** `n` choose `k`, for the binomial below. */
const choose = (n: number, k: number): number => { let c = 1; for (let i = 1; i <= k; i++) c = c * (n - k + i) / i; return c; };
/** Expected whole firings of a threshold of `at` stacks after `n` uses that each add one stack with chance `p`. */
const firings = (n: number, p: number, at: number): number => many(n + 1, k => choose(n, k) * p ** k * (1 - p) ** (n - k) * Math.floor(k / at)).reduce((s, x) => s + x, 0);
/**
 * Expected damage over `rounds` of the kit (with `lever`) and of its plain build on `t`, by closed form: the whole actions
 * the user's speed gives, each one's expected dealt, and each payoff counted as whole firings of a binomial count of
 * stacks. `extra` foes stand within the Signature's burst. `best` is the largest single use: a payoff with its hit.
 */
function kitDamage(k: KitRow, lever: number, rank: Rank, t: Sheet, rounds: number, extra = 0): { kit: number; plain: number; best: number } {
  const u = sheet(k.user, rank), sa = SA(u, k.type), acts = Math.floor(rounds * perRound(u) + 1e-9);
  if (k.kit === 'pain') {
    const L = SHAPE.pain, strike = use(sa, 'physical', u, t, STRIKE);
    const cycle = L.at + 1, cycles = Math.floor(acts / cycle), spent = Math.min(L.cap, cycle * strike.caught);
    const more = cycles * (use(sa * (1 + lever * spent), 'physical', u, t, STRIKE).dealt - strike.dealt);
    return { kit: acts * strike.dealt + more, plain: acts * strike.dealt, best: use(sa * (1 + lever * L.cap), 'physical', u, t, STRIKE).dealt };
  }
  const L = SHAPE[k.kit], plain = use(sa, 'magical', u, t, CURSE), hit = use(L.share * sa, 'magical', u, t, CURSE);
  const burst = dealt(lever * sa, 'magical', u, t), n = firings(acts, hit.caught, L.at);
  return { kit: acts * hit.dealt + n * burst * (1 + extra), plain: acts * plain.dealt, best: hit.dealt + burst };
}
/** The targets a kit is measured on: the triangle's three builds. */
const TARGETS: readonly Build[] = ['speed', 'tank', 'cannon'];
/** The largest lever, in steps of 0.01, that keeps the kit within 1 + the tolerance of its plain build at 6 rounds on every rank and target. */
function lever(k: KitRow, tol: number): number {
  const ok = (x: number): boolean => SIM.every(r => TARGETS.every(b => { const d = kitDamage(k, x, r, sheet(b, r), FIGHT_ROUNDS); return d.kit <= d.plain * (1 + tol); }));
  let x = 0;
  while (ok(Math.round((x + 0.01) * 100) / 100) && x < 10) x = Math.round((x + 0.01) * 100) / 100;
  return x;
}

/**
 * A mode (Crimson Pact): a standard action and `hp` of max HP enter it for `rounds`; while it holds, the abilities it gates
 * may be worth more than their pace's budget by the price spread over the uses the mode lasts.
 */
const PACT = { rounds: 3, hp: 0.1 } as const;
function pactCredit(rank: Rank): { price: number; uses: number; credit: number } {
  const u = sheet('cannon', rank), price = 1 + PACT.hp * u.hpMax * hpRate(rank), uses = PACT.rounds * perRound(u);
  return { price, uses, credit: price / uses };
}

function part3(): void {
  section('3. The budget');
  out('The unit is the standard action (SA): the average of the recommended standard formula, `1d8 + power` (registry/ability-kinds.ts');
  out('`recommended`), read by the user. A quick ability is worth 0.7 SA and a heavy one 1.5 (`RULES.fight.cost`). Every block below is');
  out('priced in SA, so the maker can add a made ability\'s or status\'s parts and show the sum against its pace\'s budget.');
  out();
  const tol = tolerance();
  out('Table 3.1: the triangle\'s margins on paper (design table 6.1\'s closed form). The tolerance is the smallest at C and S, less 1:');
  out('a kit that adds more than that to its plain build can flip the closest row by itself.');
  out();
  table(['Row', 'C', 'S'], TRIANGLE.map(([a, b]) => [`${a} over ${b}`, margin(a, b, 'C'), margin(a, b, 'S')]));
  out(`Tolerance: ${tol.toFixed(3)}, so the maker warns past ${(1 + tol).toFixed(2)} times its pace's budget.`);
  out();

  out('Table 3.2: the rounds the party of table 6.2 takes to kill a pack of three and a boss on paper, which weigh the reference dungeon');
  out('of section 8.0. (Until the owner\'s word of Nov 14 this table chose an execute share that killed outright; there is no instant kill:');
  out('an execute is a scaler on damage, section 8.0.)');
  out();
  table(['Rank', 'Pack, rounds', 'Boss, rounds'], SIM.map(r => [r, partyRounds(r, 'normal'), partyRounds(r, 'boss')]));

  out('Table 3.3: events a round, at each rank, for each build against one same-rank normal brute: what the maker multiplies a');
  out('trigger\'s worth by. Turns a round at its default attack; hits it deals (caught); times it is struck by one brute; crits it deals;');
  out('the brutes it kills a round (its damage over a brute\'s HP).');
  out();
  for (const r of SIM) table([`${r} build`, 'Turns', 'Hits dealt', 'Struck', 'Crits dealt', 'Kills'], eventRates(r));

  out('Table 3.4: what one of each block is worth, in SA of a C cannon and a C bruiser against a C normal brute (after defence).');
  out();
  const c = sheet('cannon', 'C'), b = sheet('bruiser', 'C'), m = brute('C', 'normal');
  const saC = dealt(SA(c, 'magical'), 'magical', c, m), saB = dealt(SA(b, 'physical'), 'physical', b, m);
  const rate = hpRate('C');
  table(['Block', 'Rule for its worth', 'Cannon', 'Bruiser'], [
    ['One stack of a status that deals d a round per stack', 'd x rounds held / SA, at the cap for a per-round op (the maker shows it at the cap)', 'per op', 'per op'],
    ['A threshold payoff of x SA at N stacks', 'x / N per stack applied, times the share of uses that land a stack', '0.2 per stack at x = 1, N = 5', 'same'],
    ['A trigger firing whose ops are worth x SA', 'x times its event\'s rate a round (table 3.3), against a passive\'s budget of tolerance SA a round', 'x times the rate', 'x times the rate'],
    ['10% of max HP paid as a price', 'HP / a same-rank support\'s heal in one action (1.5 sup)', (0.1 * c.hpMax * rate).toFixed(2), (0.1 * b.hpMax * rate).toFixed(2)],
    ['A delayed hit of x SA', 'x: no discount for the wait, so the warning comes early rather than late', 'x', 'x'],
    ['A same-rank standard action, after defence', 'the yardstick, in HP', saC.toFixed(1), saB.toFixed(1)],
  ]);
  out(`One HP paid is worth ${rate.toFixed(3)} SA at C (a C support heals ${heal('C').toFixed(1)} in one action); at E ${hpRate('E').toFixed(3)}, at S ${hpRate('S').toFixed(3)}.`);
  out();

  out(`Table 3.5: a mode, Crimson Pact: a standard action and ${PACT.hp * 100}% of max HP enter it for ${PACT.rounds} rounds. The price, in SA, spread over`);
  out('the cannon\'s uses in those rounds, is what each ability the mode gates may be worth above its pace\'s budget.');
  out();
  table(['Rank', 'Price (SA)', 'Uses in the mode', 'Credit per gated use (SA)'], SIM.map(r => { const p = pactCredit(r); return [r, p.price, p.uses, p.credit]; }));

  out('Table 3.6: the three example kits against the plain build of the same body, expected damage over 4, 6 and 8 rounds on each');
  out('target build. The bound: within the tolerance of the plain build at 6 rounds (design 6\'s reference fight), and the best single');
  out('use (a payoff with its hit) under 60% of a same-rank tank\'s max HP.');
  out();
  const levers = Object.fromEntries(KITS.map(k => [k.kit, lever(k, tol)])) as Record<KitName, number>;
  out(`The lever each kit was searched on, the largest that keeps it inside: Resonance's burst ${levers.blood} SA at ${SHAPE.blood.at} stacks; the mark's burst ${levers.mark} SA`);
  out(`at ${SHAPE.mark.at} marks; Violence's ${levers.pain} a spent stack (at ${SHAPE.pain.at} stacks, cap ${SHAPE.pain.cap}).`);
  out();
  const rows: (string | number)[][] = [];
  for (const k of KITS) for (const r of SIM) for (const tb of TARGETS) {
    const t = sheet(tb, r), at = (n: number) => kitDamage(k, levers[k.kit], r, t, n);
    const six = at(FIGHT_ROUNDS), ratio = six.kit / six.plain;
    rows.push([k.label, r, tb, `${at(4).kit.toFixed(0)} / ${at(4).plain.toFixed(0)}`, `${six.kit.toFixed(0)} / ${six.plain.toFixed(0)}`, `${at(8).kit.toFixed(0)} / ${at(8).plain.toFixed(0)}`,
      ratio, Math.abs(ratio - 1) <= tol ? 'inside' : ratio > 1 ? 'over' : 'under']);
  }
  table(['Kit', 'Rank', 'Target', '4 rounds (kit / plain)', '6 rounds', '8 rounds', 'Kit over plain at 6', 'Bound'], rows);
  table(['Kit', 'Rank', 'Best single use on a tank', 'Tank max HP', 'Share', 'Under 60%'], KITS.flatMap(k => SIM.map(r => {
    const t = sheet('tank', r), best = kitDamage(k, levers[k.kit], r, t, FIGHT_ROUNDS).best;
    return [k.label, r, best.toFixed(1), t.hpMax, pct(best / t.hpMax), best / t.hpMax <= 0.6 ? 'yes' : 'no'];
  })));
  out('Table 3.7: Signature in a pack: two more normal brutes within the burst\'s 2 tiles, against the same single-target plain curse. A');
  out(`blast (heavy, ${F.cost.heavy / F.cost.standard} SA) on three bodies is worth ${3 * F.cost.heavy / F.cost.standard} SA for ${F.cost.heavy / F.cost.standard} actions\' time, ${3} SA a standard action: the area kind's own budget.`);
  out();
  table(['Rank', 'Kit over plain at 6, alone', 'With two more in the burst'], SIM.map(r => {
    const t = brute(r, 'normal'), a = kitDamage(KITS[1]!, levers.mark, r, t, FIGHT_ROUNDS), b = kitDamage(KITS[1]!, levers.mark, r, t, FIGHT_ROUNDS, 2);
    return [r, a.kit / a.plain, b.kit / b.plain];
  }));
}

// ════════════════════════════════════════════════════════════════════════════
// 4. The mapping: every ability of the summaries, the blocks that make it
// ════════════════════════════════════════════════════════════════════════════

/**
 * How an ability is made: with the blocks named (`make`), with them but a named difference from the sheet (`part`), with
 * what the app has today (`today`), not now (`not`, the reason given), or not defined in the sheet (`undef`). Blocks are
 * design section 1's numbers: 1 stacks, 2 threshold, 3 trigger, 4 price or gate, 5 formula input, 6 delayed, 7 mode,
 * 8 zone additions, 9 summon.
 */
type Verdict = 'make' | 'part' | 'today' | 'not' | 'undef';
type Entry = readonly [ability: string, verdict: Verdict, blocks: readonly number[], note: string];
const MAPPING: Readonly<Record<string, readonly Entry[]>> = {
  'Shared (Nikolas, Einar, Maro)': [
    ['Dash', 'today', [], 'a self ability giving a speed status for a round'],
    ['Disengage', 'not', [], 'the fight has no opportunity attack to avoid'],
    ['Parry', 'not', [], 'a reaction on another\'s turn; its follow-up (Retribution) is a trigger on avoid'],
    ['Transfer', 'not', [], 'giving one\'s turn to an ally'],
    ['React', 'not', [], 'acting before another combatant, out of turn'],
  ],
  'Glas (from the brief)': [
    ['Resonance', 'make', [1, 2], 'stacks on a target, a threshold that bursts, its damage with an execute scaler (8.0)'],
    ['Rot', 'make', [1], 'stacks with per-round damage per stack'],
    ['Vision', 'make', [1], 'stacks on self, a stat per stack'],
    ['Crimson Pact', 'make', [4, 7], 'a mode for 10% of max HP'],
    ['Hemoplague', 'make', [1, 6], 'per-round damage and an end'],
    ['Delayed damage', 'make', [6], 'a status with no ops and an end'],
    ['The execute', 'make', [2], 'an execute scaler on a threshold\'s damage (8.0)'],
  ],
  Nikolas: [
    ['Inertial Storage', 'part', [1, 3, 7], 'a stack a turn start, all leave on a move; its armor is read as Vitality (no armor op)'],
    ['Momentum\'s Edge', 'part', [1, 3, 7], 'a stack on each move; "all your movement" is read as any move'],
    ['Anchor, Unbound', 'make', [1, 3], 'a 3-round status whose turn-start trigger adds a second stack'],
    ['Paradox of Motion', 'not', [], 'an op that sets one status\'s stacks from another\'s'],
    ['Baangs, Manifest Baang', 'make', [1], 'stacks on self, cap 9 (the GM raises the def\'s cap with each Body title)'],
    ['Detonate', 'make', [4], 'a blast with a price of one Baang'],
    ['Baang Release', 'undef', [], 'a damage row and no ability row'],
    ['Supernova', 'not', [], 'a trigger that reads where its bearer stands'],
    ['Starcaller\'s Wrath', 'part', [4, 8], 'a zone, one use; its end when every foe has left is not now'],
    ['Orbital Laser', 'not', [], 'moving a zone'],
    ['Constellations, Zodiac, Cosmic Creator', 'not', [], 'collectable sets'],
    ['Gathering Storm, Rising Moon', 'undef', [], 'columns with no rule'],
    ['Brutalize', 'part', [], 'today\'s stat ops; healing -50% and damage taken +33% have no op'],
    ['Gravity Surge', 'make', [1, 4, 7], 'two abilities, each gated on one aura held, applying Weak or Fragile'],
    ['Trick, Cunning', 'not', [], 'a bonus to a check outside the fight'],
    ['Hover, Earthbound', 'not', [], 'flight'],
    ['Create Portal, Blink, Rendwalk', 'not', [], 'teleports and portals'],
    ['Death\'s Grasp', 'not', [], 'forced movement (a pull)'],
    ['Dimensional Cascade, Folded Tether, Split Fold, Zero Zone', 'undef', [], 'no outcome or no text'],
    ['Singularity', 'not', [], 'a cost of all remaining mana'],
    ['Starry Sky', 'today', [], 'a zone'],
    ['Cataclysm', 'part', [8], 'a zone whose end lands after a round; its scaling by constellations is not now'],
    ['Kneel', 'today', [], 'a note: what a body at 0 does is the GM\'s'],
    ['Vector Strike', 'not', [], 'a reroll'],
    ['Proximity Fold, Zone Stretch', 'not', [], 'an op on another rule\'s range or size'],
    ['Distortion World', 'part', [1, 3], 'a stack of Gathering Storm a round; its cost change is not now'],
    ['Eclipse', 'part', [1, 3], 'a stack a hit that leaves at the turn\'s end, as a stat; "on a single enemy" is not read'],
    ['Loveblight', 'not', [], 'an op on the crit size'],
    ['Fateshaper (Lifebound)', 'not', [], 'a trigger whose amount is the hit it answers'],
    ['Stormfront', 'make', [4, 8], 'a zone, one use a rest'],
    ['Heartstone Amulet', 'make', [4], 'a heal with an HP price, one a round'],
    ['Agnet of Focus', 'part', [4], 'one use a fight of a quick self ability giving Haste; a whole extra action is not an op'],
    ['Permafrost', 'make', [1, 3], 'a weapon-tagged hit adds a Cold stack'],
    ['Weighted Step, Spatial Awareness, Crush', 'not', [], 'knockback and surprise are not rules of the fight; Crush is a formula on Power today'],
    ['Titles that give an ability', 'today', [], 'the GM gives the skill'],
  ],
  Einar: [
    ['Boundaries', 'make', [8], 'zones, three an owner (3 to 5 with the perks)'],
    ['Moving, doubling, boundless', 'not', [], 'moving or resizing a zone'],
    ['Hyperbole', 'not', [], 'hours of downtime outside the fight'],
    ['Vacuum', 'today', [], 'a zone with a note'],
    ['Confrontation', 'part', [1, 8], 'stacks with damage a round per stack; "highest base stat" is read as a named stat'],
    ['Harmony', 'make', [1, 3, 8], 'a stack a turn inside the zone (its trigger), a stun as its end'],
    ['Ceremony', 'not', [], 'a cost change'],
    ['Stack of Pain', 'make', [1, 3], 'a stack on each hit dealt'],
    ['Fuel the Flesh', 'make', [1, 4], 'a price of 2 Pain for fatigue back'],
    ['Sustained through Suffering', 'not', [], 'an extra action from an ability'],
    ['Violence Begets Violence', 'part', [1, 3], 'struck: one Pain off, a stat down on the striker (no armor op)'],
    ['Lesson in Pain', 'undef', [], 'Suppress is not defined'],
    ['Truth in Pain', 'make', [1, 4], 'a gate of 10 Pain, a price of all, a hold'],
    ['All Shall Suffer', 'part', [4, 5], 'damage by field(pain), a price of the user\'s own; the others\' stacks stay'],
    ['Reveal, Spirit Archer', 'make', [1], 'the bow\'s ops add a stack'],
    ['Spirit Shackle', 'make', [1, 4], 'a price of 5 Reveal on the target, a root'],
    ['Certain Death', 'part', [5], 'target.stacks(reveal) as damage; "+1 to the roll" has no roll to add to'],
    ['Mercy', 'make', [1, 3], 'a kill by an Eternal Peace-tagged use adds a stack (keep: sheet)'],
    ['Lamb\'s Respite', 'not', [], 'a reaction, and invulnerable'],
    ['Ruthless, Diplomacy (stacks)', 'make', [1, 3], 'stacks from kills or hits'],
    ['Wolf\'s Hunt, Severance, Vicious', 'undef', [], 'named, no rule'],
    ['Haste', 'make', [1, 3], 'Limber starts it at 1 (worn), Savage adds one on a crit, speed per stack'],
    ['Stealth stacks, Shade Step', 'not', [], 'stealth, passing through objects, reactions'],
    ['Silentum Perpetuum', 'not', [], 'a permanent loss from a fight (a GM reward line)'],
    ['Soul Shatter', 'make', [4, 8], 'a price of all zones, each zone\'s end lands'],
    ['Mourning\'s Light, Diplomacy (check), Guidance', 'not', [], 'checks and death saves outside the fight\'s rules'],
    ['Eternal Peace', 'today', [], '`target.hpMax * 1d20 / 100`'],
    ['Abyssal Whirlpool, Overcome, Catastrophe, Corroded, Dissolved', 'undef', [], 'Corroded, Negate and Ruin are not defined ("FIX")'],
    ['Draconic Avatar', 'part', [9], 'a summon; its Dissolved on contact is not defined'],
    ['Shinsuu Reversal', 'not', [], 'a reaction that negates a spell'],
    ['Pact Redux Silver', 'make', [4, 5, 8], 'a price of one zone, one a fight, a heal of `target.missing * target.hpMax / 4`'],
    ['Pact Redux Bronze, Gold, Platinum', 'not', [], 'a terrain change, a cure of every harmful status, invulnerable'],
    ['Soul-Eye, Bow Master, Spectral Shot', 'today', [], 'a direct bow, a quick bow, a bow with a cost'],
    ['Bow Expert, Mythical, Assassination, Crown of Dusk', 'not', [], 'advantage, a natural 20, surprise and invisibility'],
    ['Ceaseless Pursuit', 'not', [], 'a chain of rolls against a rising DC'],
    ['Speaker of the Land, Puzzlebox', 'not', [], 'an extra action and a cost change'],
    ['Pain\'s Whip Tail', 'part', [3], 'a hit roots the target; the advantage is not now'],
    ['Celestial Sea', 'make', [4, 8], 'a healing zone, one use a rest'],
    ['Harmonious Reverberance', 'not', [], 'nobody may attack: a rule over the turn'],
    ['Osteoporosis', 'part', [1, 2, 3], 'three hits a fracture, three a break (threshold); the rib on a miss is not now'],
    ['Echoes of the Fallen, Orb of Draconic Might, Villainous Robes, Ring of Mosaic', 'undef', [], 'no rule, or a permanent gain (a GM reward line)'],
  ],
  Maro: [
    ['Corruption', 'make', [1, 3, 8], 'stacks; the aura\'s hold adds one at each turn start inside'],
    ['Aura of Corruption', 'make', [8], 'an aura with an upkeep of 20 (the list; the tree says 10)'],
    ['Void Knight', 'make', [1, 3], 'a sword-tagged hit adds a stack'],
    ['Purify', 'make', [5], 'damage by target.stacks(corruption)'],
    ['Endless, Eternity', 'make', [5], 'a worn status: fatigue back a round by field(corruption)'],
    ['The Cycle Continues', 'not', [], 'a kill that moves a count to the foe with the most HP'],
    ['Supress, Devour, Alrender, relic counters, Aegis', 'undef', [], 'Domain, the effect, the "?" and the cost are not written'],
    ['Doom', 'part', [], 'a hold today; "inside his Aura" as a gate is not now'],
    ['Sever, Sword Master, Weapon Attack', 'today', [], 'a quick strike, a strike'],
    ['Smite', 'make', [3], 'a blast tagged "ultimate" for Hatefog'],
    ['Summon Sprite', 'make', [9], 'a summon of 2 rounds'],
    ['Special Sprites', 'part', [4, 9], 'summons, one a rest; once a week is not now'],
    ['Essence Transfer, Celestial Tether', 'not', [], 'moving a status between bodies; a reaction'],
    ['Ignite, Beacon, Demoralize', 'today', [], 'a support or curse giving a status'],
    ['Retribution', 'make', [3], 'on avoid, a hit on the other'],
    ['Deliverance, Sword Expert, Grasswhistle', 'not', [], 'advantage and free parries'],
    ['Rend', 'make', [3], 'a sword-tagged kill refunds the turn (once a round)'],
    ['Malignance (Hatefog)', 'part', [3], 'used "ultimate": a 3-round status with an aura of damage; it moves with Maro'],
    ['Nature\'s Corruption', 'today', [], 'a zone that spares its owner'],
    ['Relic Sense, Old Stories, Fated Meeting, Sacred Bond, Champion, Backlash, Wingstalker', 'not', [], 'outside the fight, or barriers that reflect'],
  ],
  Hwei: [
    ['Baang, Manifest Baang', 'make', [1], 'stacks on self, cap 3 then 5'],
    ['Easel of the Master', 'make', [1, 3], 'two stacks at each turn start'],
    ['Baang Release', 'make', [4, 5], 'a price of all Baangs, damage or a heal by spent'],
    ['Detonate Baang', 'make', [4], 'a blast with a price of Baangs'],
    ['Signature of the Visionary', 'make', [1, 2], 'a mark that bursts in an area at 2'],
    ['Shattered Canvas, Cracks in the Frame', 'not', [], 'advantage on the next roll'],
    ['Mood', 'undef', [3, 7], 'a mode the last tag sets (makeable); what a mood does is not written'],
    ['Energize, Kindle, Vitalize', 'make', [1, 3], 'a painting\'s tag adds a stack'],
    ['The Muses', 'not', [], 'moving stacks to an ally'],
    ['Stirring Lights', 'part', [1, 4], 'flares spent by an ability; "the next attack" is not read'],
    ['Molten Eruption, Moonlit Reflection', 'today', [], 'zones'],
    ['Gaze of the Abyss, Grim Visage, Inviting Allure', 'today', [], 'curses with a status'],
    ['Crushing Maw, Fleeting Current', 'not', [], 'a pull, a terrain change'],
    ['Reap what is Sown', 'not', [], 'an op that blocks statuses'],
    ['Spiraling Despair', 'part', [], 'a blast; its two rounds of marks bursting at once are not now'],
    ['Devastating Fire', 'today', [], 'a sure use of `target.hpMax`'],
    ['Severing Bolt', 'part', [5], 'more damage by target.stacks of a named control; the chain is not now'],
    ['Font of Inspiration', 'not', [], 'painting anything into reality is the GM\'s'],
    ['Colors of Frustration, Nostalgia, Resilience', 'not', [], 'a trigger on the order of abilities'],
    ['Billowing Robes', 'make', [3], 'a turn start, once a fight: Animated for a round'],
    ['Sea of Shadows', 'part', [4], 'one a fight; untargetable is not now'],
    ['Illusory Double', 'make', [3, 9], 'a summon whose worn status ends it when struck'],
    ['Slime Crown, Mercy\'s Cape, Imagined Reverie', 'not', [], 'a defence against areas, non-lethal by choice, "???"'],
  ],
};
const VERDICT: { readonly [V in Verdict]: string } = { make: 'Made by the blocks', part: 'Made, with a named difference', today: 'Makeable today', not: 'Not now', undef: 'Undefined in the sheet' };
/** An entry naming several abilities ("Anchor, Unbound") counts each. */
const countOf = (e: Entry): number => e[0].split(', ').length;

function part4(): void {
  section('4. The mapping');
  out('Table 4.1: every ability, tracker, passive and item of the summaries, by kit and verdict, with the blocks that make it.');
  out();
  const rows: string[][] = [];
  for (const [kit, list] of Object.entries(MAPPING)) for (const v of Object.keys(VERDICT) as Verdict[]) {
    const of = list.filter(e => e[1] === v);
    if (of.length) rows.push([kit, VERDICT[v], of.map(e => `${e[0]}${e[2].length ? ` (${e[2].join(', ')})` : ''}: ${e[3]}`).join('; ')]);
  }
  table(['Kit', 'Verdict', 'Abilities (blocks): how'], rows);
  const all = Object.values(MAPPING).flat();
  const n = (v: Verdict): number => all.filter(e => e[1] === v).reduce((s, e) => s + countOf(e), 0);
  const total = all.reduce((s, e) => s + countOf(e), 0), defined = total - n('undef');
  out('Table 4.2: the count. Each name counts once, so "Anchor, Unbound" is two.');
  out();
  table(['Verdict', 'Names', 'Share of all', 'Share of those the sheet defines'],
    (Object.keys(VERDICT) as Verdict[]).map(v => [VERDICT[v], n(v), pct(n(v) / total), v === 'undef' ? '' : pct(n(v) / defined)]));
  const makeable = n('make') + n('part') + n('today');
  out(`Makeable: ${makeable} of ${total} (${pct(makeable / total)}); of the ${defined} the sheet defines, ${pct(makeable / defined)}. With the blocks and no difference: ${n('make')}.`);
  out();
  out('Table 4.3: how many made abilities use each block (made, or made with a difference).');
  out();
  const BLOCKS = ['stacks', 'threshold', 'trigger', 'price or gate', 'formula input', 'delayed', 'mode', 'zone additions', 'summon'];
  table(['Block', 'Name', 'Abilities that use it'], BLOCKS.map((name, i) => {
    const users = all.filter(e => (e[1] === 'make' || e[1] === 'part') && e[2].includes(i + 1));
    return [i + 1, name, `${users.reduce((s, e) => s + countOf(e), 0)}: ${users.map(e => e[0]).join('; ')}`];
  }));
}

// ════════════════════════════════════════════════════════════════════════════
// 8. The second wave (design section 8): what the first design left as "not now"
// ════════════════════════════════════════════════════════════════════════════

/**
 * The rule numbers wave 2 proposes, to join `RULES.fight.kit`. Each comment is the reason; section 8 of the design says
 * what each bounds. The scalers' numbers (`SCALE`) are apart, since section 8.0 works the suggestions out from them.
 */
const KIT2 = {
  shareCap: 0.5, // the product of a user's damage-dealt and a target's damage-taken shares stays in 0.5 to 1.5: Brutalize's -50% healing is the sheet's largest share
  armorOp: 60, // a status moves armor or resist by at most a suit of plate's 60 (`kits.heavy`)
  critFacesMax: 6, // crit faces plus a target's exposed faces stay at most 6: design 2.2's 30%, never the 1 in 3
  critSizeMax: 2, // crit size stays at most 2: design 2.2's "never more than double the dice"
  manaCutMax: 0.25, // a cost cut on mana stays at `costCutCap`: mana is the dungeon's brake on blasts (design 6)
  fatigueCutMax: 0.5, // a cost cut on fatigue may reach half: fatigue is a fight's brake, and a status that halves it lasts a fight at most
  rangeAdd: 3, // tiles a status adds to its bearer's ranges of 2 or more: a curse's 8 to 11, still under a shot's 12
  wardRounds: 1, // untargetable, invulnerable and safeguard last a round at most, and the first two reach a body once a fight
  boostSides: 20, // a held die is at most a d20 (Expected Outcome)
  shoveMax: 3, // tiles one push or pull moves a body: half a round's walk at move 6
  blinkMax: 8, // the longest blink: a curse's range, the gap between the default lines
  reactionsPerUse: 4, // reactions one use may set off: four targets of an area, one each
  zoneMove: 6, // tiles one use moves a zone: a round's walk
  zoneGrow: 2, // tiles of radius one use adds to a zone, to `fieldRadiusMax`
  extraPerRound: 1, // extra actions (a refund to now, or a hasten on self) one body takes in a round of fight time
  hideReveal: 1, // a hidden body is revealed by a foe within this many tiles: adjacent
  surprise: 1, // rounds a surprised row's opening is pushed back
  doArmed: 12, // party rows whose armed reaction the doc names: 4 hunters, 4 shadows, 4 summons
} as const;

// ── 8.0 the conditional scalers that replace the execute ──
type Measure = 'target' | 'user' | 'max' | 'now';
type Dir = 'below' | 'above';
type ScalerRow = { readonly name: string; readonly measure: Measure; readonly dir: Dir; readonly words: string };
/** The closed family (design 8.0): what is compared, and which way. A pair is the target's part of the two, `T / (T + U)`. */
const SCALERS: readonly ScalerRow[] = [
  { name: 'Execute', measure: 'target', dir: 'below', words: 'against a target under {s} of its HP' },
  { name: 'Opener', measure: 'target', dir: 'above', words: 'against a target over {s} of its HP' },
  { name: 'Desperate', measure: 'user', dir: 'below', words: 'while you are under {s} of your HP' },
  { name: 'Steady', measure: 'user', dir: 'above', words: 'while you are over {s} of your HP' },
  { name: 'Giant slayer', measure: 'max', dir: 'above', words: 'against a target with more max HP than yours' },
  { name: 'Cull', measure: 'max', dir: 'below', words: 'against a target with less max HP than yours' },
  { name: 'Underdog', measure: 'now', dir: 'above', words: 'against a target with more HP left than you' },
  { name: 'Bully', measure: 'now', dir: 'below', words: 'against a target with less HP left than you' },
];
/**
 * The scalers' rules. `start` is where every suggested scaler activates: half of an HP share, or two equal bodies of a
 * pair. `pairFull` is the ratio at which a pair's bonus is whole: 4, past a same-rank boss over a hunter (table 8.0.1), so
 * a giant slayer is not at its extreme against every boss. `scaleCap` is the most bonus: double, a crit's largest size.
 * `bound` is design 6's single-use bound (60% of a same-rank tank).
 */
const SCALE = { start: 0.5, pairFull: 4, scaleCap: 1, step: 0.05, scalers: 2, bound: 0.6 } as const;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const endOf = (m: Measure, d: Dir): number => m === 'target' || m === 'user' ? (d === 'below' ? 0 : 1) : d === 'below' ? 1 / (1 + SCALE.pairFull) : SCALE.pairFull / (1 + SCALE.pairFull);
/** The bonus at measure `x`: 0 at the start, `scale` at the end, linear between. */
const bonusAt = (r: ScalerRow, start: number, scale: number, x: number): number => scale * clamp01((x - start) / (endOf(r.measure, r.dir) - start));
const GRID = many(21, i => i / 20);
/**
 * The scaler's mean bonus over a fight against `foes` (each the foe's sheet; `u` the user's). A share is uniform over 0 to
 * 1: a body takes about equal hits over its life, and design 6's boss fight takes the tank near 0 at its end. A max-HP pair
 * is fixed by the two bodies; a current-HP pair is the mean over both shares uniform. Against several foes, the largest.
 */
function meanBonus(r: ScalerRow, start: number, scale: number, u: Sheet, foes: readonly Sheet[]): number {
  if (r.measure === 'target' || r.measure === 'user') return scale * Math.abs(start - endOf(r.measure, r.dir)) / 2;
  return Math.max(...foes.map(t => {
    if (r.measure === 'max') return bonusAt(r, start, scale, t.hpMax / (t.hpMax + u.hpMax));
    const xs = GRID.slice(1);
    return xs.reduce((s, a) => s + xs.reduce((q, b) => q + bonusAt(r, start, scale, a * t.hpMax / (a * t.hpMax + b * u.hpMax)), 0), 0) / xs.length ** 2;
  }));
}
type KindRow = { readonly kind: 'strike' | 'shot' | 'curse' | 'blast'; readonly user: Build; readonly type: Type; readonly share: number; readonly how: (u: Sheet) => Parameters<typeof use>[4] };
/** Each damaging kind with the paper build that uses it, its pace's share of the budget and how it reaches a tank 8 tiles off. */
const DAMAGE_KINDS: readonly KindRow[] = [
  { kind: 'strike', user: 'bruiser', type: 'physical', share: 1, how: () => STRIKE },
  { kind: 'shot', user: 'speed', type: 'physical', share: F.cost.quick / F.cost.standard, how: () => ({ kind: 'travel', land: F.abilityKinds.shot.windup / F.round + F.lineGap / F.abilityKinds.shot.travel }) },
  { kind: 'curse', user: 'cannon', type: 'magical', share: 1, how: () => CURSE },
  { kind: 'blast', user: 'cannon', type: 'magical', share: F.cost.heavy / F.cost.standard, how: () => ({ kind: 'travel', land: F.abilityKinds.blast.windup / F.round }) },
];
/**
 * The most of a same-rank tank's max HP one use of the kind removes with the scaler, its base cut to `1 / (1 + mean)`:
 * at each HP share x of the tank it removes min(x, dealt / max), the bonus read at x (a target share), at its whole (a
 * user share, the user at its extreme), at the tank's pair with the user (max HP), or at the worst pair (current HP).
 */
function bestUse(k: KindRow, r: ScalerRow, start: number, scale: number, rank: Rank, base: number): number {
  const u = sheet(k.user, rank), t = sheet('tank', rank), raw = k.share * SA(u, k.type);
  const removed = (b: number, x: number): number => Math.min(x, use(raw * base * (1 + b), k.type, u, t, k.how(u)).dealt / t.hpMax);
  if (r.measure === 'target') return Math.max(...GRID.map(x => removed(bonusAt(r, start, scale, x), x)));
  if (r.measure === 'user') return removed(scale, 1);
  if (r.measure === 'max') return removed(bonusAt(r, start, scale, t.hpMax / (t.hpMax + u.hpMax)), 1);
  return Math.max(...GRID.slice(1).map(a => removed(Math.max(...GRID.slice(1).map(b => bonusAt(r, start, scale, a * t.hpMax / (a * t.hpMax + b * u.hpMax)))), a)));
}
/** The reference foes a pair scaler's mean is taken over: a same-rank normal brute and a same-rank boss. */
const refFoes = (rank: Rank): Sheet[] => [brute(rank, 'normal'), brute(rank, 'boss')];
/**
 * The mean bonus over the reference dungeon: a pack fight and a boss fight (design 6), each weighted by the rounds the
 * party of table 6.2 takes to win it on paper, so a bonus that only a boss gives counts for the boss fight's share of time.
 */
function dungeonMean(r: ScalerRow, start: number, scale: number, u: Sheet, rank: Rank): { mean: number; normal: number; boss: number } {
  const tp = partyRounds(rank, 'normal'), tb = partyRounds(rank, 'boss');
  const normal = meanBonus(r, start, scale, u, [brute(rank, 'normal')]), boss = meanBonus(r, start, scale, u, [brute(rank, 'boss')]);
  return { mean: (tp * normal + tb * boss) / (tp + tb), normal, boss };
}
/**
 * The suggested scale for a kind and a scaler at a rank (design 8.0): the base is cut to `1 / (1 + mean)` over the
 * reference dungeon, so the ability is worth its plain budget over it; the scale is the largest in steps of 0.05, at most
 * `scaleCap`, with which the ability against each reference foe alone stays within the tolerance of its plain use, and
 * its best use on a same-rank tank under the bound (or under the plain use's own best, if that is already over it).
 */
function suggestScale(k: KindRow, r: ScalerRow, rank: Rank, tol: number): { scale: number; mean: number; base: number; vsNormal: number; vsBoss: number; best: number } {
  const u = sheet(k.user, rank);
  const at = (s: number) => {
    const d = dungeonMean(r, SCALE.start, s, u, rank), base = 1 / (1 + d.mean);
    return { scale: s, mean: d.mean, base, vsNormal: base * (1 + d.normal), vsBoss: base * (1 + d.boss), best: bestUse(k, r, SCALE.start, s, rank, base) };
  };
  const limit = Math.max(SCALE.bound, at(0).best);
  let pick = at(0);
  for (let s = SCALE.step; s <= SCALE.scaleCap + 1e-9; s = Math.round((s + SCALE.step) * 100) / 100) {
    const x = at(s);
    if (x.best <= limit + 1e-9 && x.vsNormal <= 1 + tol + 1e-9 && x.vsBoss <= 1 + tol + 1e-9) pick = x;
  }
  return pick;
}

// ── the room doc with an armed reaction ──
function worstDoc2(rows: number, armed: 'none' | 'ids' | 'names'): number {
  const base = worstDoc(rows, { stacks: true, uses: true });
  const ids = many(KIT2.doArmed, i => `m-${String(i).padStart(2, '0')}`);
  if (armed === 'none') return base;
  const extra = armed === 'ids' ? { armed: ids } : { armed: Object.fromEntries(ids.map(id => [id, 'r'.repeat(40)])) };
  return base + JSON.stringify(extra).length - 1; // the object's own braces less the comma it adds to the doc
}

function part8a(): void {
  section('8. The second wave');
  out('Table 8.0.1: the pairs a scaler reads, at each rank: a same-rank normal brute and boss over each paper build (max HP), and');
  out(`the target's part of the pair, T / (T + U). The pair's bonus is whole at ${SCALE.pairFull} to 1 (${(SCALE.pairFull / (1 + SCALE.pairFull)).toFixed(2)}) and nothing at 1 to 1 (0.50).`);
  out();
  table(['Rank', 'Build', 'Normal brute over it', 'Its part', 'Boss over it', 'Its part'], SIM.flatMap(r => (['speed', 'tank', 'cannon', 'bruiser'] as const).map(b => {
    const u = sheet(b, r), n = brute(r, 'normal'), x = brute(r, 'boss');
    return [r, b, n.hpMax / u.hpMax, n.hpMax / (n.hpMax + u.hpMax), x.hpMax / u.hpMax, x.hpMax / (x.hpMax + u.hpMax)];
  })));
  const tol = tolerance();
  out(`Table 8.0.2: the suggested scale of each scaler on each damaging kind, starting at ${SCALE.start} (half the HP, or two equal bodies). The`);
  out('base is cut to 1 / (1 + mean), the mean bonus over the reference dungeon (a pack fight and a boss fight weighted by their rounds),');
  out(`so the use is worth its plain budget over it. For each rank, the largest scale (steps of 0.05, at most 1) with which the use against`);
  out(`a normal brute alone and against a boss alone stays within the tolerance (${(1 + tol).toFixed(2)} of plain), and its best use on a same-rank tank`);
  out('under 60% of its max HP. The suggestion is the smallest of the three ranks; the other columns are at C with it.');
  out();
  const rows: (string | number)[][] = [];
  for (const k of DAMAGE_KINDS) for (const r of SCALERS) {
    const by = SIM.map(rank => suggestScale(k, r, rank, tol)), s = Math.min(...by.map(x => x.scale));
    const u = sheet(k.user, 'C'), d = dungeonMean(r, SCALE.start, s, u, 'C'), base = 1 / (1 + d.mean);
    rows.push([k.kind, r.name, ...by.map(x => x.scale), s, d.mean, base, base * (1 + d.normal), base * (1 + d.boss), bestUse(k, r, SCALE.start, s, 'C', base)]);
  }
  table(['Kind', 'Scaler', 'E', 'C', 'S', 'Suggested', 'Mean (C)', 'Base (C)', 'Against packs', 'Against a boss', 'Best use on a C tank'], rows);
  out('The closed form for a share (target\'s or user\'s HP), uniform over 0 to 1: mean = scale x w / 2, w the window (the start for');
  out('"under", 1 - start for "over"), so at start 0.5 the mean is scale / 4 and the base 1 / (1 + scale / 4): 0.8 at scale 1. It is the');
  out('same against every foe, a boss too, so it is neutral against each and the tolerance never binds it. A pair is fixed by the two');
  out('bodies, so the tolerance against the foe it favours is what bounds its scale.');
  out();

  out('Table 8.1: the caps wave 2 adds to `RULES.fight.kit`, and what a value past one becomes.');
  out();
  table(['Rule', 'Value', 'What the parser or the reducer does with more'], [
    ['shareCap', KIT2.shareCap, 'The product of the user\'s dealt share and the target\'s taken share is clamped to 0.5 to 1.5'],
    ['armorOp', KIT2.armorOp, 'A `sheet` op on armor or resist is clamped to -60 to 60'],
    ['critFacesMax', KIT2.critFacesMax, 'Crit faces plus the target\'s exposed faces are read as at most 6'],
    ['critSizeMax', KIT2.critSizeMax, 'Crit size after a `sheet` op is read as 1.5 to 2'],
    ['manaCutMax', KIT2.manaCutMax, 'The cost cut on mana is read as at most 0.25 (`costCutCap`)'],
    ['fatigueCutMax', KIT2.fatigueCutMax, 'The cost cut on fatigue is read as at most 0.5'],
    ['rangeAdd', KIT2.rangeAdd, 'A `sheet` op on range is clamped to -3 to 3; a range of 1 is never changed'],
    ['wardRounds', KIT2.wardRounds, 'An untargetable, invulnerable or safeguard status lasts at most a round'],
    ['boostSides', KIT2.boostSides, 'A held die is clamped to d2 to d20'],
    ['shoveMax', KIT2.shoveMax, 'A push or pull is clamped to 1 to 3 tiles'],
    ['blinkMax', KIT2.blinkMax, 'A blink\'s range is clamped to 1 to 8'],
    ['reactionsPerUse', KIT2.reactionsPerUse, 'Not a parser bound: a use sets off at most 4 reactions, in outcome order'],
    ['zoneMove', KIT2.zoneMove, 'A zone shift is clamped to 1 to 6 tiles'],
    ['zoneGrow', KIT2.zoneGrow, 'A zone growth is clamped to 1 to 2 tiles, the radius to `fieldRadiusMax`'],
    ['extraPerRound', KIT2.extraPerRound, 'Not a parser bound: a second extra action in a round is refused (`extra`)'],
    ['hideReveal', KIT2.hideReveal, 'Not a parser bound: a foe within 1 tile reveals a hidden body'],
    ['surprise', `${KIT2.surprise} round`, 'Not a parser bound: a surprised row\'s opening is a round later'],
    ['scaleCap', SCALE.scaleCap, 'A scaler\'s scale is clamped to 0 to 1; its start to the open range between its ends'],
    ['scalers', SCALE.scalers, 'A formula keeps its first 2 scalers'],
    ['pairFull', SCALE.pairFull, 'Not a parser bound: a pair scaler is whole at 4 to 1'],
  ]);
  out('Table 8.2: the room doc at 30 rows (wave 1\'s stacks and uses left), with the party\'s armed reactions as row ids or as ids with');
  out(`the ability's id (${KIT2.doArmed} at most), against ${DOC_MAX} with an eighth to spare.`);
  out();
  table(['Doc', 'Characters', 'Times 9/8', `Against ${DOC_MAX}`], (['none', 'ids', 'names'] as const).map(a => {
    const n = worstDoc2(DOC_ROWS - 2, a);
    return [`30 rows, armed: ${a}`, n, Math.ceil(n * 9 / 8), n * 9 / 8 <= DOC_MAX ? 'fits' : 'too big'];
  }));
}

/** Wave 2's machines (design 8.9), as the cells each `TABLE` will hold. A missing (state, event) pair changes nothing. */
const MACHINES2: readonly { readonly name: string; readonly where: string; readonly cells: readonly Cell[] }[] = [
  {
    name: '8.9.1 A reaction on its reactor', where: 'fight-react.ts `reactStep`, the row\'s `armed` and `reacted`', cells: [
      ['unarmed', 'arm (the player\'s `arm`, the GM\'s command)', 'armed', 'One a row; arming another replaces it'],
      ['armed', 'its moment, and it may fire', 'fired', 'Up, not held, ready, paid, not fired since its last turn began; at most 4 a use'],
      ['armed', 'its moment, and it may not', 'armed', 'Nothing; the log says why only when the GM armed it'],
      ['fired', 'its use resolves', 'spent', 'Its time comes off its next turn: `at += interval(cost)`'],
      ['spent', 'its moment again', 'spent', 'Nothing: one between two of its turns'],
      ['spent', 'its turn starts', 'armed', 'Restored'],
      ['armed or spent', 'disarm (`arm` with null)', 'unarmed', ''],
      ['any', 'it goes down, or the fight ends', 'unarmed', 'Never written to a sheet'],
    ],
  },
  {
    name: '8.9.2 An edge or a held die on its bearer', where: 'effect-ops.ts, resolve.ts rule 7b', cells: [
      ['absent', 'a status with `edge` or `boost` lands', 'held n', 'n is its stacks, 1 for a plain status'],
      ['held n', 'a die it reaches is rolled, and it cancels with none', 'used', 'The kept face is the better or the worse; a boost moves the face'],
      ['held n', 'a die it reaches is rolled, against an opposite edge', 'used', 'The two cancel: one die, both spend'],
      ['used', '`spend`, n > 1', 'held n - 1', 'One a use, however many targets'],
      ['used', '`spend`, n = 1', 'absent', ''],
      ['used', 'no `spend` (a worn edge)', 'held n', 'Bow Expert, Sword Expert'],
      ['held n', 'its time ends, a cure, the fight ends', 'absent', 'As any status (2.1)'],
    ],
  },
  {
    name: '8.9.3 A pushed or pulled body', where: 'resolve.ts rule 18 `shoved`, space.ts `shovePath`', cells: [
      ['standing', 'a shove lands on it caught', 'moving k', 'k is the tiles, times the kind\'s control factor, rounded down; 0 if rooted'],
      ['standing', 'the use missed it (out, ring, resisted)', 'standing', 'A dodge is not a push'],
      ['moving k', 'the next tile is free floor', 'moving k - 1', 'Rough ground costs its `enter`, as a walk'],
      ['moving k', 'the next tile is a wall, a pit, the edge or a body', 'landed', 'No damage for the stop'],
      ['moving k', 'a pull reaches its anchor\'s side', 'landed', ''],
      ['moving 0', '', 'landed', ''],
      ['landed', '`zoneSync`', 'standing', 'Holds open and close; a forced entry pays no on-entry part; a channel breaks if it moved'],
    ],
  },
  {
    name: '8.9.4 Stealth on its bearer', where: 'fight-turn.ts `revealed`, resolve.ts', cells: [
      ['seen', 'hide, and no foe that is up sees its tile', 'hidden', 'Foes cannot aim at it; a hidden foe leaves the doc'],
      ['seen', 'hide, and a foe sees its tile', 'seen', 'Refused: `seen`'],
      ['hidden', 'it uses an ability against a foe or a place', 'revealed', 'After that use, which had the attack\'s advantage'],
      ['hidden', 'a foe that is up stands within 1 tile after a move', 'revealed', 'Its move or the foe\'s'],
      ['hidden', 'it takes HP damage (an area, a status)', 'revealed', ''],
      ['hidden', 'its time ends', 'revealed', ''],
      ['revealed', '', 'seen', 'The status is gone; it may hide again'],
    ],
  },
  {
    name: '8.9.5 A ward (untargetable or invulnerable) on its bearer', where: 'effect-ops.ts, the fight\'s `warded`', cells: [
      ['never', 'a status with the ward lands', 'warded', 'For a round at most; the fight marks the body on `warded`'],
      ['warded', 'the bearer acts against a foe (untargetable)', 'spent', ''],
      ['warded', 'a hit would take it under 1 (invulnerable)', 'warded', 'It stays at 1'],
      ['warded', 'a round passes, a cure', 'spent', ''],
      ['spent', 'the same ward lands again', 'spent', 'Nothing, a log line: once a fight'],
    ],
  },
  {
    name: '8.9.6 A body\'s turn extras', where: 'timeline.ts, the row\'s `extraRound` and `hastened`', cells: [
      ['plain', 'a refund to now (an extra action) in a round with none', 'extra taken', '`at = now + 1`; the row keeps the round'],
      ['extra taken', 'a second in the same round', 'extra taken', 'Refused: `extra`'],
      ['extra taken', 'a later round', 'plain', ''],
      ['waiting', 'hastened by another', 'hastened', '`at` earlier by the giver\'s interval times the share, never before `now + 1`'],
      ['hastened', 'hastened again', 'hastened', 'Nothing: once between two of its turns'],
      ['hastened', 'its turn starts', 'waiting', ''],
    ],
  },
];

function part8b(): void {
  out('## 8.9 The state trees of wave 2');
  out();
  for (const m of MACHINES2) {
    out(`Table ${m.name} (\`TABLE\` in ${m.where}).`);
    out();
    table(['From', 'Event', 'To', 'What happens'], m.cells);
  }
}

// ── 8.10 the budget of wave 2 ──
/** A face of the target's die with its chance, and what a held die adds to it (negative on the attack side). */
type Face = { readonly f: number; readonly add: number; readonly p: number };
const ONE: readonly Face[] = FACES.map(f => ({ f, add: 0, p: 1 / 20 }));
/** Two d20s, the higher kept (`better` for the target: the defending side's advantage) or the lower. */
const TWO = (higher: boolean): Face[] => FACES.map(f => ({ f, add: 0, p: higher ? (f * f - (f - 1) * (f - 1)) / 400 : ((21 - f) ** 2 - (20 - f) ** 2) / 400 }));
/** One d20 with a held die of `sides` added (sign +1, the defender's) or taken off (-1, the attacker's). */
const HELD = (sides: number, sign: 1 | -1): Face[] => FACES.flatMap(f => many(sides, i => ({ f, add: sign * (i + 1), p: 1 / 20 / sides })));
/** `use` over a face distribution: the face kept within 1 to 20 is read by rules 8 and 9 alike (design 8.2). */
function useBy(raw: number, type: Type, u: Sheet, t: Sheet, how: Parameters<typeof use>[4], faces: readonly Face[]): number {
  let sum = 0;
  for (const { f: nat, add, p } of faces) {
    const f = Math.max(1, Math.min(20, nat + add));
    if (how.kind === 'sure') { sum += p * dealt(raw, type, u, t); continue; }
    if (how.kind === 'direct') {
      if (f === 20 || f + edge(t.will, u.aim) >= F.resistDc) { sum += p * dealt(raw * F.resistedShare, type, u, t); continue; }
    } else if (Math.floor(t.move * how.land * Math.max(0, Math.min(1, (f + edge(t.react, u.aim)) / 20))) >= 1) continue;
    sum += p * dealt(f <= u.critFaces ? raw * u.critSize : raw, type, u, t);
  }
  return sum;
}
/**
 * Each kind's target in table 8.10.2: the triangle's opponent that dodges or resists it most, of those it can catch at all
 * (the paper's speed build always leaves a blast, so a blast's is the tank); a tank for a strike, which nothing dodges.
 */
const EDGE_TARGET: { readonly [K in KindRow['kind']]: Build } = { strike: 'tank', shot: 'cannon', curse: 'speed', blast: 'tank' };

/**
 * Parry (design 8.4) armed by `x` all fight against `y`: a guard of `g` on the hits it parries, one between two of its own
 * turns, each costing a quick action's time. Its time-to-kill margin over `y`, against the same without it.
 */
function parried(x: Build, y: Build, rank: Rank, g: number): number {
  const X = sheet(x, rank), Y = sheet(y, rank), ax = ATTACK[x], ay = ATTACK[y];
  const h = perRound(Y, ay.cost) * use(ay.raw(Y), ay.type, Y, X, { kind: 'travel', land: ay.land }).caught;
  const ia = ax.cost / X.speed, ip = F.cost.quick / X.speed;
  const full = h * (ia + ip) >= 1, cycle = full ? ia + ip : ia / (1 - h * ip), q = full ? 1 : h * cycle;
  const out = ia / cycle, taken = 1 - g * q / (h * cycle);
  const plain = (X.hpMax / dps(y, Y, X)) / (Y.hpMax / dps(x, X, Y));
  return (X.hpMax / (dps(y, Y, X) * taken)) / (Y.hpMax / (dps(x, X, Y) * out)) / plain;
}
/** Parry answers a strike only (the sheet: "melee"), so its duels are every build against the two that strike. */
const DUELS: readonly [Build, Build][] = (['speed', 'tank', 'cannon', 'bruiser'] as const).flatMap(a => (['tank', 'bruiser'] as const).filter(b => b !== a).map(b => [a, b] as [Build, Build]));
/** The largest guard share, in steps of 0.05, with which no build armed with Parry all fight improves a duel's margin by more than the tolerance. */
function guardLever(tol: number): number {
  let g = 0;
  for (let x = 0.05; x <= 1 + 1e-9; x = Math.round((x + 0.05) * 100) / 100) if (DUELS.every(([a, b]) => (['C', 'S'] as const).every(r => parried(a, b, r, x) <= 1 + tol + 1e-9))) g = x;
  return g;
}

function part8c(): void {
  const tol = tolerance();
  out('## 8.10 The budget of wave 2');
  out();
  out(`Table 8.10.1: the damage-taken loop. The party of table 6.2 with every use at the share cap (${1 + KIT2.shareCap} times) the whole fight, against a pack`);
  out('of three and a boss, with and without the kind factor on the part above 1 (a boss 0.5), against design 6\'s floors (2 and 4 rounds).');
  out();
  table(['Rank', 'Pack, plain', 'Pack at the cap', 'Boss, plain', 'Boss at the cap, no factor', 'Boss at the cap, with the factor'], SIM.map(r => {
    const p = partyRounds(r, 'normal'), b = partyRounds(r, 'boss'), fb = F.kinds.boss.control;
    return [r, p, p / (1 + KIT2.shareCap), b, b / (1 + KIT2.shareCap), b / (1 + KIT2.shareCap * fb)];
  }));
  out('Table 8.10.2: one use with an edge, as a share of the same use with one die, on the triangle opponent that dodges or resists the');
  out('kind most (a tank for a strike, which nothing dodges). Attack: the target keeps the lower of two. Defend: it keeps the higher. A held');
  out('d6 moves the face by its roll. The worth in SA is the change times the pace\'s share of the budget.');
  out();
  table(['Kind', 'Rank', 'Target', 'Attack edge', 'Defend edge', 'Attack d6', 'Defend d6', 'Attack edge, in SA'], DAMAGE_KINDS.flatMap(k => SIM.map(r => {
    const u = sheet(k.user, r), t = sheet(EDGE_TARGET[k.kind], r), raw = k.share * SA(u, k.type), how = k.how(u);
    const one = useBy(raw, k.type, u, t, how, ONE), at = (fs: readonly Face[]) => useBy(raw, k.type, u, t, how, fs) / one;
    return [k.kind, r, EDGE_TARGET[k.kind], at(TWO(false)), at(TWO(true)), at(HELD(6, -1)), at(HELD(6, 1)), (at(TWO(false)) - 1) * k.share];
  })));
  const best = (r: Rank): number => {
    const u = { ...sheet('bruiser', r), critFaces: KIT2.critFacesMax, critSize: KIT2.critSizeMax }, t = sheet('tank', r);
    return useBy(F.cost.heavy / F.cost.standard * SA(u, 'physical'), 'physical', u, t, STRIKE, TWO(false)) / t.hpMax;
  };
  out(`Table 8.10.2b: advantage with crit stacks. A heavy strike (1.5 SA) by a bruiser at the crit caps (${KIT2.critFacesMax} faces, size ${KIT2.critSizeMax}) with the attack's`);
  out('edge, on a same-rank tank: its expected share of the tank\'s max HP, against design 6\'s 60%.');
  out();
  table(['Rank', 'Share of a tank', 'Under 60%'], SIM.map(r => [r, pct(best(r)), best(r) <= 0.6 ? 'yes' : 'no']));
  const g = guardLever(tol);
  out(`Table 8.10.3: Parry, a quick reaction armed all fight, one between two of its own turns. The guard share searched: the largest with`);
  out(`which no build's duel margin against a build that strikes (tank, bruiser) improves by more than the tolerance at C and S. Found: ${g}. The sheet's`);
  out('own Parry (0.25 of the hit on a success, 0.75 on a fail) is 0.5 of the hit at parity. Margin with Parry over without:');
  out();
  table(['Parrier', 'Against', `C, guard ${g}`, `S, guard ${g}`, 'C, guard 0.5', 'S, guard 0.5'], DUELS.map(([a, b]) => [a, b, parried(a, b, 'C', g), parried(a, b, 'S', g), parried(a, b, 'C', 0.5), parried(a, b, 'S', 0.5)]));
  out('Table 8.10.4: turns. The fastest paper build\'s turns between two of the slowest\'s (the tank in plate), plain and with an extra');
  out('action every round (the most `extraPerRound` allows); design 2.2: never four. Then the clamp\'s ends (250 and 40).');
  out();
  table(['Rank', 'Fastest speed', 'Tank speed', 'Plain', 'With an extra action a round', 'Under 4'], SIM.map(r => {
    const fast = Math.max(...(Object.keys(BUILD) as Build[]).map(b => sheet(b, r).speed)), slow = sheet('tank', r).speed;
    const plain = fast / slow, more = (fast / 100 + KIT2.extraPerRound) * 100 / slow;
    return [r, fast, slow, plain, more, more < 4 ? 'yes' : 'no'];
  }));
  out(`At the clamp (${F.speedMax} against ${F.speedMin}): ${(F.speedMax / F.speedMin).toFixed(2)} plain, ${((F.speedMax / 100 + 1) * 100 / F.speedMin).toFixed(2)} with an extra action a round. Statuses already widen the`);
  out('builds\' 2.5 to the clamp (design 2.2); the extra action widens it by one turn a round, never more.');
  out();
  out('Table 8.10.5: forced movement and a blink in actions of time. A body pushed n tiles spends n / 6 of a standard action walking back');
  out('(`moveCost`); a blink of r tiles saves the r / 6 actions a walk would take, less its own cost.');
  out();
  table(['Tiles', 'A push costs its target (actions)', 'On an elite (0.75)', 'On a boss (0.5)', 'A quick blink saves (actions)', 'A standard blink saves'], many(KIT2.blinkMax, i => i + 1).map(n => [
    n, n <= KIT2.shoveMax ? n * F.moveCost / 100 : '', n <= KIT2.shoveMax ? Math.floor(n * F.kinds.elite.control) * F.moveCost / 100 : '',
    n <= KIT2.shoveMax ? Math.floor(n * F.kinds.boss.control) * F.moveCost / 100 : '', n * F.moveCost / 100 - F.cost.quick / 100, n * F.moveCost / 100 - F.cost.standard / 100,
  ]));
  out('Table 8.10.6: a ward is worth the hits it turns away: one round of being struck (table 3.3: about once a round by one brute), as');
  out('a share of the bearer\'s max HP at C. Once a fight, so this is its whole worth.');
  out();
  table(['Build', 'A normal brute\'s hit, after defence', 'Max HP', 'Share'], (Object.keys(BUILD) as Build[]).map(b => {
    const u = sheet(b, 'C'), m = brute('C', 'normal'), hit = use(4.5 + m.phys, 'physical', m, u, STRIKE).dealt;
    return [b, hit, u.hpMax, pct(hit / u.hpMax)];
  }));
}

// ── 8.11 the mapping again ──
/**
 * Wave 2's verdicts: an entry of `MAPPING` (kit, then its name) and what replaces it. A group may split, keeping its names.
 * Blocks 10 to 18 are design 8.0 to 8.8: 10 scalers, 11 ops, 12 advantage and held dice, 13 forced movement, 14 reactions,
 * 15 moving counts and zones, 16 turn economy, 17 stealth and surprise, 18 a condition on where.
 */
const WAVE2: Readonly<Record<string, Readonly<Record<string, readonly Entry[]>>>> = {
  'Shared (Nikolas, Einar, Maro)': {
    Parry: [['Parry', 'part', [14], 'a before reaction taking 0.35 off a strike (the sheet: 0.25 or 0.75 of it by a roll)']],
    Transfer: [['Transfer', 'make', [16], 'an ally ability with hasten 1: the giver\'s action for the ally\'s']],
    React: [['React', 'make', [14, 16], 'a turn reaction: the reactor goes just before the body it named']],
  },
  'Glas (from the brief)': {
    Resonance: [['Resonance', 'make', [1, 2, 10], 'stacks on a target, a threshold that bursts, its damage with an execute scaler']],
    'The execute': [['The execute', 'make', [2, 10], 'an execute scaler: more damage the lower the target\'s HP, no kill']],
  },
  Nikolas: {
    'Inertial Storage': [['Inertial Storage', 'make', [1, 3, 7, 11, 13], 'armor and resist a stack (a sheet op), all leave on a move; its pull is a turn-start shove']],
    'Momentum\'s Edge': [['Momentum\'s Edge', 'part', [1, 3, 7, 11], 'resist pen a stack (a sheet op); "all your movement" is read as any move']],
    'Paradox of Motion': [['Paradox of Motion', 'make', [4, 15], 'a move with `as`, Inertial Storage into Momentum\'s Edge, once a fight']],
    Supernova: [['Supernova', 'make', [1, 3, 5, 18], 'a turn-start trigger that needs Starcaller\'s Wrath: damage by stacks(baang)']],
    'Orbital Laser': [['Orbital Laser', 'make', [15], 'a shift of Starcaller\'s Wrath']],
    Brutalize: [['Brutalize', 'part', [11], 'healed -50% and taken +33% (share ops); its -25% armor is a flat number by rank']],
    'Create Portal, Blink, Rendwalk': [
      ['Blink', 'make', [4, 13, 14, 18], 'a blink of 8 tiles, and a before reaction; its swap is gated inside Domain'],
      ['Create Portal, Rendwalk', 'not', [], 'portals that last and link'],
    ],
    'Death\'s Grasp': [['Death\'s Grasp', 'make', [13], 'a pull toward the user in a line']],
    'Vector Strike': [['Vector Strike', 'part', [12], 'a reroll read as the attack\'s edge on one use']],
    'Proximity Fold, Zone Stretch': [['Proximity Fold, Zone Stretch', 'not', [], 'a reach of 12 and a larger radius: no status changes them (8.1)']],
    'Distortion World': [['Distortion World', 'part', [1, 3, 11], 'a Gathering Storm stack a round; its cost cut is on every cost, not a blink\'s alone']],
    Loveblight: [['Loveblight', 'part', [11], 'crit size x1.5 read as +0.5, to 2 at most']],
    'Fateshaper (Lifebound)': [['Fateshaper (Lifebound)', 'part', [3, 11], 'a hitDealt trigger hurting its bearer by dealt / 3; any hit, not only on Nikolas']],
    'Agnet of Focus': [['Agnet of Focus', 'make', [4, 16], 'an extra action, one use a fight']],
    'Weighted Step, Spatial Awareness, Crush': [
      ['Spatial Awareness', 'make', [17], 'an alert op: never surprised'],
      ['Crush', 'today', [], 'a formula on Power'],
      ['Weighted Step', 'not', [], 'resisting a push is a kind\'s factor and a root, nothing a hunter wears'],
    ],
  },
  Einar: {
    'Moving, doubling, boundless': [['Moving, doubling', 'make', [15], 'a zone shift and a zone grow'], ['boundless', 'not', [], 'a zone of the whole map']],
    Ceremony: [['Ceremony', 'make', [8, 11], 'a zone whose hold cuts costs (a sheet op on costCut)']],
    'Sustained through Suffering': [['Sustained through Suffering', 'make', [1, 4, 16], 'an extra action for a price of 5 Pain']],
    'Violence Begets Violence': [['Violence Begets Violence', 'make', [1, 3, 11, 15], 'struck: one Pain moved to the striker, as armor and resist down']],
    'Lamb\'s Respite': [['Lamb\'s Respite', 'make', [1, 4, 11, 14], 'a lethal reaction: invulnerable for a round, a price of 1 Mercy, 2 uses a fight']],
    'Stealth stacks, Shade Step': [['Stealth stacks, Shade Step', 'part', [13, 14, 17], 'a hide and a before blink; passing through objects is not now']],
    'Shinsuu Reversal': [['Shinsuu Reversal', 'make', [14], 'a before reaction that negates the use']],
    'Pact Redux Bronze, Gold, Platinum': [
      ['Pact Redux Gold, Platinum', 'make', [4, 8, 11], 'a cure of every harmful status, invulnerable for a round; each ends a zone'],
      ['Pact Redux Bronze', 'not', [], 'a change of terrain is the GM\'s paint'],
    ],
    'Bow Expert, Mythical, Assassination, Crown of Dusk': [
      ['Bow Expert', 'make', [12], 'a worn attack edge on uses tagged bow (the maker warns: table 8.10.2)'],
      ['Mythical', 'make', [4, 12], 'a held die fixed at 20 on the attack, for 50 mana'],
      ['Assassination, Crown of Dusk', 'part', [12, 17], 'the attack from hiding and the surprise round; "6 seconds undetected" is a hide'],
    ],
    'Speaker of the Land, Puzzlebox': [['Speaker of the Land, Puzzlebox', 'part', [3], 'a worn speed op for +1 AP; a once-a-fight refund of a set cost (wave 1, read again)']],
    'Pain\'s Whip Tail': [['Pain\'s Whip Tail', 'make', [3, 12], 'a hit roots, and the rooted has the defence\'s disadvantage']],
  },
  Maro: {
    'The Cycle Continues': [['The Cycle Continues', 'make', [1, 3, 15], 'Corruption\'s down trigger moves all of it to the foe with the most HP in the aura']],
    'Essence Transfer, Celestial Tether': [
      ['Essence Transfer', 'make', [9, 15], 'a move of the first harmful status from an ally to the sprite'],
      ['Celestial Tether', 'not', [], 'a redirect of a use already aimed'],
    ],
    'Deliverance, Sword Expert, Grasswhistle': [['Deliverance, Sword Expert, Grasswhistle', 'make', [4, 12, 14], 'a defence edge while parrying, a worn sword edge, 2 free parries a fight']],
    Doom: [['Doom', 'make', [18], 'a hold gated inside his Aura']],
  },
  Hwei: {
    'Shattered Canvas, Cracks in the Frame': [['Shattered Canvas, Cracks in the Frame', 'part', [2, 3, 12, 18], 'an edge after the mark bursts; the painting that burst it is read from the mood']],
    'The Muses': [['The Muses', 'make', [15], 'a move of any number of a painting\'s stacks to an ally']],
    'Crushing Maw, Fleeting Current': [['Crushing Maw', 'make', [13], 'a pull to an area\'s centre'], ['Fleeting Current', 'not', [], 'a path free of rough ground: a terrain change']],
    'Reap what is Sown': [['Reap what is Sown', 'make', [11], 'a safeguard for a round']],
    'Colors of Frustration, Nostalgia, Resilience': [['Colors of Frustration, Nostalgia, Resilience', 'part', [3, 7, 16, 18], 'a painting while in another\'s mood; not "the first two in a round"']],
    'Sea of Shadows': [['Sea of Shadows', 'part', [4, 11], 'untargetable and a cure of harmful statuses, one a fight; a round, not 3 turns']],
  },
};
const MAPPING2: Readonly<Record<string, readonly Entry[]>> = Object.fromEntries(Object.entries(MAPPING).map(([kit, list]) =>
  [kit, list.flatMap(e => WAVE2[kit]?.[e[0]] ?? [e])]));
/** Glas from his summary (`kits/glas.md`), outside the 200: what both waves make of his sheet. */
const GLAS: readonly Entry[] = [
  ['Sanguine Resonance', 'make', [1, 2, 3, 10, 11], 'a stack a hit; it heals by dealt (11); its threshold is a formula over Vitality, its burst with an execute scaler'],
  ['Celestial Rot', 'make', [1, 3], 'a stack a hit, Vitality down and damage a round per stack'],
  ['Vision', 'make', [1, 3, 11], '0.5 exposed faces a stack, all leave on the bearer\'s crit taken'],
  ['Sine Sanguis, Descecrate', 'not', [], 'doubling the stacks he imparts: stacks add, never multiply (3.1)'],
  ['Fester', 'make', [1, 5], 'damage by target.stacks(resonance), adds one'],
  ['Blood Rift', 'make', [1], 'a stack of Vision'],
  ['Eye of Carnage', 'part', [1, 12], 'Vision to all foes in an area and a defence edge; 3 stacks a use, not 8'],
  ['Children of the Grave', 'part', [1, 3], 'Vision a hit; raising the cursed dead as a ghost needs a trigger that summons'],
  ['Wrath of the Aspect', 'make', [5], 'damage by field(rot)'],
  ['Tides of Blood', 'part', [4, 5], 'a channel with an HP price, by stacks(resonance); the price once, not each turn'],
  ['Hemoplague', 'part', [4, 5, 6], 'stats by hits, a heal, an end that lands Rot by hits; stats per enemy hit read as one status'],
  ['Crimson Pact', 'make', [4, 7], 'half max HP (the price cap), a mode with stats'],
  ['Minor Ascension', 'part', [5, 8], 'an aura draining by missing HP; "until a turn passes with no enemy in range" is a time'],
  ['Vamp title, Transfusion, Sanguine Siphon', 'make', [3, 11], 'a hitDealt trigger healing by dealt (times missing for the title)'],
  ['Everbleed', 'part', [7, 12], 'a mode; auto-hit read as the attack\'s edge, minimum 1 damage is today\'s'],
  ['Carnage tiers', 'undef', [], 'not defined in the sheet'],
  ['Chronobreak, Recursion', 'not', [], 'a rewind and a retried action (the owner: not for now)'],
  ['Second Impact', 'not', [], 'a third of the turn\'s damage again needs a turn\'s tally'],
  ['Temporal Flux', 'make', [12], 'the attack\'s edge for a round'],
  ['Continuum Shift', 'part', [11, 13], 'untargetable for a round and a blink back; the sheet says two turns'],
  ['Expected Outcome', 'part', [12], 'a held d20 fixed when it lands, once a rest; the sheet says a session'],
  ['Consume, stats from kills', 'not', [], 'permanent growth: a reward line the GM gives'],
  ['Heal on a kill', 'make', [3, 5], 'a kill trigger healing target.hpmax * 0.15'],
  ['Five attacks give penetration', 'part', [1, 2, 11], 'a threshold at 5 lowers the target\'s resist (a sheet op), not the user\'s pen'],
  ['Stored damage', 'part', [3, 6, 11], 'struck: a status paying taken / 3 a round for 3; its amount is fixed at the hit'],
  ['Marked for the day', 'not', [], 'a mark across a day is outside the fight'],
];
const n2 = (list: readonly Entry[], v: Verdict): number => list.filter(e => e[1] === v).reduce((s, e) => s + countOf(e), 0);

function part8d(): void {
  out('## 8.11 The mapping again');
  out();
  const before = Object.values(MAPPING).flat(), after = Object.values(MAPPING2).flat();
  out('Table 8.11.1: every entry wave 2 changes, kit by kit: its wave-1 verdict and its new one, with the blocks.');
  out();
  const rows: string[][] = [];
  for (const [kit, list] of Object.entries(MAPPING)) for (const e of list) {
    const to = WAVE2[kit]?.[e[0]];
    if (to) for (const x of to) rows.push([kit, x[0], VERDICT[e[1]], VERDICT[x[1]], x[2].join(', '), x[3]]);
  }
  table(['Kit', 'Name', 'Wave 1', 'Wave 2', 'Blocks', 'How'], rows);
  out('Table 8.11.2: the count over the 200 names, after wave 1 and after both waves.');
  out();
  const total = after.reduce((s, e) => s + countOf(e), 0), defined = total - n2(after, 'undef');
  table(['Verdict', 'Wave 1', 'Both waves'], (Object.keys(VERDICT) as Verdict[]).map(v => [VERDICT[v], n2(before, v), n2(after, v)]));
  const mk = (l: readonly Entry[]) => n2(l, 'make') + n2(l, 'part') + n2(l, 'today');
  out(`Makeable: ${mk(before)} of ${total} after wave 1, ${mk(after)} after both (${pct(mk(after) / total)}); of the ${defined} the sheet defines, ${pct(mk(after) / defined)}. With the blocks and no difference: ${n2(after, 'make')}.`);
  out();
  out('Table 8.11.3: how many made names use each wave-2 block.');
  out();
  const NAMES = ['scalers', 'ops', 'advantage and held dice', 'forced movement', 'reactions', 'moving counts and zones', 'turn economy', 'stealth and surprise', 'a condition on where'];
  table(['Block', 'Name', 'Names that use it'], NAMES.map((name, i) => {
    const users = [...after, ...GLAS].filter(e => (e[1] === 'make' || e[1] === 'part') && e[2].includes(10 + i));
    return [10 + i, name, `${users.reduce((s, e) => s + countOf(e), 0)}: ${users.map(e => e[0]).join('; ')}`];
  }));
  out('Table 8.11.4: what is still not now, after both waves.');
  out();
  table(['Kit', 'Names: why'], Object.entries(MAPPING2).map(([kit, list]) => [kit, list.filter(e => e[1] === 'not').map(e => `${e[0]}: ${e[3]}`).join('; ')]).filter(r => r[1]));
  out('Table 8.11.5: Glas from his summary (`kits/glas.md`), outside the 200.');
  out();
  table(['Name', 'Verdict', 'Blocks', 'How'], GLAS.map(e => [e[0], VERDICT[e[1]], e[2].join(', '), e[3]]));
  const gt = GLAS.reduce((s, e) => s + countOf(e), 0), gd = gt - n2(GLAS, 'undef');
  out(`Glas: ${mk(GLAS)} of ${gt} names makeable (${pct(mk(GLAS) / gd)} of the ${gd} his sheet defines); ${n2(GLAS, 'make')} with no difference.`);
}

part1();
part2();
part3();
part4();
part8a();
part8b();
part8c();
part8d();
