// facts.ts: what a hunter did, as data (docs/agent-handoff/features/notes-1-feats.md section 1). Pure. A fact is made by
// the one function that does the thing it records, in that thing's write, and appended to the hunter's inbox
// (chronicle.ts `record`); the store's `noticed` takes it in the same write. Each kind has a field table, `FACT_FIELDS`,
// that the compiler holds against its type: the one reader of a fact (`parseFact`, for the save, the sheet push and a
// room message) and later the feat maker read it.
// A new kind is a member of `Fact`, its row in `FACT_FIELDS` and `KEPT`, its row in chronicle.ts's `TALLY` if it counts,
// its one writer, and a case in tests/chronicle.test.ts.
import { RANKS } from '../rules.ts';
import type { Rank } from '../rules.ts';
import { RARITIES } from '../registry/items.ts';
import type { Rarity } from '../registry/items.ts';
import { LIFE_STATES } from './vitals.ts';
import type { LifeNews, LifeState } from './vitals.ts';
import { parseDayKey } from '../day.ts';
import type { DayKey } from '../day.ts';
import type { QuestKind, QuestSource } from '../save.ts';
import type { RunOutcome } from '../combat/odds.ts';
import type { MonsterKind } from './derive.ts';

/**
 * Every member of `T`, once, as a list: the compiler refuses a list that leaves one out. For the lists this file cannot
 * import as values without a cycle (save.ts reads the chronicle at load, so its constants are not ready when this
 * module runs).
 */
const every = <T extends string>() => <const L extends readonly T[]>(l: L & ([Exclude<T, L[number]>] extends [never] ? unknown : never)): L => l;

/** How a hunter's life changed (the life machine's `lifeNews`): from a fight's totals, a revive by the GM or an item, or a hand edit. */
export type LifeHow = 'fight' | 'gm' | 'item' | 'hand';
export const LIFE_HOWS = every<LifeHow>()(['fight', 'gm', 'item', 'hand']);

/** How a fight ended for a hunter's side: won, lost, or the GM ended it with both sides up. */
export type FightOutcome = 'won' | 'lost' | 'ended';
export type Fact =
  /**
   * A hunter row's fight, at the fight's end (combat/fight-facts.ts `rowFacts`, from the row's tally): how it ended, its
   * rounds; the row up at the end, its falls, its lowest HP share while up and its share at the end (%), whether it stood
   * at exactly 1 HP; hits struck on it, its hits and crits and its most crits in a row, uses it avoided; HP dealt, taken
   * and healed on allies, statuses put on foes; foes it took down, bosses among them, its most in
   * one turn; consumables used; its side's other hunters, how many of them were down at the end, how many of its side
   * were up; the foes, the highest foe rank above the hunter's, the highest boss's (null: none); the gate the fight came
   * from ('' for none) and the foes' names.
   */
  | { readonly kind: 'fight'; readonly outcome: FightOutcome; readonly rounds: number; readonly up: boolean; readonly downs: number; readonly low: number;
      readonly endPct: number; readonly exactOne: boolean; readonly struck: number; readonly hits: number; readonly crits: number; readonly critRun: number;
      readonly avoided: number; readonly dealt: number; readonly taken: number; readonly healed: number; readonly hexes: number;
      readonly kills: number; readonly bosses: number; readonly turnKills: number; readonly items: number; readonly allies: number; readonly alliesDown: number;
      readonly sideUp: number; readonly foes: number; readonly foeTop: number; readonly bossTop: number | null; readonly gate: string; readonly names: string }
  /** A foe this hunter took down in a fight or a solo run: the monster's name, rank, type and kind, its rank above the hunter's, the hunter's HP share then (%), whether it had put the hunter down this fight. */
  | { readonly kind: 'kill'; readonly monster: string; readonly rank: Rank; readonly type: string; readonly mkind: MonsterKind; readonly above: number;
      readonly hpPct: number; readonly payback: boolean; readonly where: 'fight' | 'solo' }
  /** A solo run's end on this hunter (gates/solo.ts `soloRan`): its gate's name and rank, the rank above the hunter's (negative below), its rounds, the HP share left (%), the life after. */
  | { readonly kind: 'solo'; readonly outcome: RunOutcome; readonly name: string; readonly rank: Rank; readonly above: number; readonly rounds: number; readonly endPct: number; readonly life: LifeState; readonly personal: boolean }
  /** A gate cleared with this hunter among its payees (pay.ts `settleClear`, solo.ts for a personal gate). `toBreak`: world days left before it would have broken; null for a personal gate. */
  | { readonly kind: 'gate'; readonly name: string; readonly rank: Rank; readonly above: number; readonly toBreak: number | null }
  /** A personal gate that closed with its time (solo.ts `soloTick`). */
  | { readonly kind: 'closed'; readonly name: string; readonly rank: Rank }
  /** A quest's end (quests.ts `completeQuest`, `failQuest`). */
  | { readonly kind: 'quest'; readonly end: 'done' | 'failed'; readonly qkind: QuestKind; readonly from: QuestSource; readonly title: string }
  /** The day's dailies all done, and the streak it made (`completeQuest`). */
  | { readonly kind: 'daily'; readonly streak: number }
  /** The rollover took a streak of `streak` days (quests.ts `rollover`). */
  | { readonly kind: 'streakLost'; readonly streak: number }
  /** The daily penalty issued for `days` missed days (quests.ts `penalized`). */
  | { readonly kind: 'penaltyIssued'; readonly days: number }
  /** The daily penalty lifted after `days` (quests.ts `penalized`). */
  | { readonly kind: 'penaltyLifted'; readonly days: number }
  /** A change of life (grant.ts `sheetEdit`): what it was and how. */
  | { readonly kind: 'life'; readonly news: LifeNews['kind']; readonly how: LifeHow }
  /** A new level (grant.ts `levelled`). */
  | { readonly kind: 'level'; readonly level: number }
  /** A new rank (record.ts `setRank`, `reevaluate`). */
  | { readonly kind: 'rank'; readonly rank: Rank }
  /** A title given (record.ts `giveTitle`). */
  | { readonly kind: 'title'; readonly name: string }
  /** A feat this hunter earned (noticed.ts): its key, its name, and whether it was hidden until earned. */
  | { readonly kind: 'feat'; readonly key: string; readonly name: string; readonly hidden: boolean }
  /** A bundle the GM gave by hand (award.ts `gmAward`, a player's `landAward`): its key and name. */
  | { readonly kind: 'given'; readonly key: string; readonly name: string }
  /** A story's chapter the GM opened for this hunter (story/story.ts `chapterLanded`): its window's title and line. */
  | { readonly kind: 'chapter'; readonly title: string; readonly line: string }
  /** A d20 check's natural 1 or 20 (session-log.ts `rolled`). */
  | { readonly kind: 'roll'; readonly natural: number }
  /** A coin this hunter called landed (coin.ts): whether the call was right. */
  | { readonly kind: 'coin'; readonly won: boolean }
  /** A purchase or a sale at the shop (inventory.ts `buy`, `sell`): the item, its rarity, the gold paid or taken, the gold after. */
  | { readonly kind: 'shop'; readonly act: 'buy' | 'sell'; readonly item: string; readonly rar: Rarity; readonly price: number; readonly goldAfter: number }
  /** A rest (grant.ts `sheetEdit`). */
  | { readonly kind: 'rest'; readonly long: boolean }
  /** A consumable used up outside a fight (use.ts `useItem`). */
  | { readonly kind: 'used'; readonly item: string; readonly rar: Rarity }
  /** A shadow joined this hunter's army (shadows.ts `shadowRises`). */
  | { readonly kind: 'shadow'; readonly name: string };
export type FactKind = Fact['kind'];
export type FactOf<K extends FactKind> = Extract<Fact, { readonly kind: K }>;
/** When a fact happened: the write that noticed it (`noticed` stamps every fact of a write with that write's moment). */
export type FactStamp = { readonly at: string; readonly day: DayKey; readonly session: number };
/** A fact as the chronicle keeps it. */
export type Kept = Fact & FactStamp;

// ── the field tables ──
/** A number from `min` to `max`, whole; `none`: it may be none (null). */
type Num = { readonly t: 'num'; readonly label: string; readonly min: number; readonly max: number; readonly none?: true };
type Flag = { readonly t: 'flag'; readonly label: string };
type RankS = { readonly t: 'rank'; readonly label: string };
type PickS<V extends string> = { readonly t: 'pick'; readonly label: string; readonly of: readonly V[] };
type Text = { readonly t: 'text'; readonly label: string; readonly max: number };
/** The spec a field's type takes: a number, a number or none, a flag, a rank (ordered), a choice of a list, or text. */
type SpecOf<V> =
  [V] extends [boolean] ? Flag
  : [V] extends [number] ? Num
  : [V] extends [number | null] ? Num & { readonly none: true }
  : [V] extends [string] ? (string extends V ? Text : [V] extends [Rank] ? (Rank extends V ? RankS : PickS<V>) : PickS<V>)
  : never;
export type FieldSpec = Num | Flag | RankS | PickS<string> | Text;
type FieldsOf<K extends FactKind> = { readonly [F in Exclude<keyof FactOf<K>, 'kind'>]-?: SpecOf<FactOf<K>[F]> };

/** The bounds of a fact's numbers and text: for junk only, every real writer stays inside them. */
const N = 1e9, NAME = 60, RANK_SPAN = RANKS.length - 1;
const num = (label: string, min: number, max: number): Num => ({ t: 'num', label, min, max });
const flag = (label: string): Flag => ({ t: 'flag', label });
const rank = (label: string): RankS => ({ t: 'rank', label });
const text = (label: string, max = NAME): Text => ({ t: 'text', label, max });
const pick = <V extends string>(label: string, of: readonly V[]): PickS<V> => ({ t: 'pick', label, of });
const above = num('Ranks above the hunter\'s', -RANK_SPAN, RANK_SPAN);

/** Each kind's fields: its spec and the words a maker and a rule's line use. */
export const FACT_FIELDS: { readonly [K in FactKind]: FieldsOf<K> } = {
  fight: {
    outcome: pick('Outcome', every<FightOutcome>()(['won', 'lost', 'ended'])), rounds: num('Rounds', 0, 1000), up: flag('Up at the end'), downs: num('Times down', 0, N),
    low: num('Lowest HP while up (%)', 0, 100), endPct: num('HP at the end (%)', 0, 100), exactOne: flag('At exactly 1 HP'), struck: num('Times struck', 0, N),
    hits: num('Hits', 0, N), crits: num('Crits', 0, N), critRun: num('Crits in a row', 0, N), avoided: num('Uses avoided', 0, N), dealt: num('Damage dealt', 0, N),
    taken: num('Damage taken', 0, N), healed: num('HP healed on allies', 0, N), hexes: num('Statuses put on foes', 0, N),
    kills: num('Foes defeated', 0, N), bosses: num('Bosses defeated', 0, N), turnKills: num('Most defeated in one turn', 0, N), items: num('Consumables used', 0, N),
    allies: num('Other hunters', 0, N), alliesDown: num('Other hunters down at the end', 0, N), sideUp: num('Its side up at the end', 0, N), foes: num('Foes', 0, N),
    foeTop: num('Highest foe rank above the hunter\'s', -RANK_SPAN, RANK_SPAN), bossTop: { ...num('Highest boss rank above the hunter\'s', -RANK_SPAN, RANK_SPAN), none: true },
    gate: text('Gate'), names: text('Foes', 80),
  },
  kill: {
    monster: text('Monster'), rank: rank('Monster rank'), type: text('Monster type', 40), mkind: pick('Kind', every<MonsterKind>()(['normal', 'elite', 'boss', 'mythic'])), above,
    hpPct: num('HP left (%)', 0, 100), payback: flag('It had put the hunter down'), where: pick('Where', every<'fight' | 'solo'>()(['fight', 'solo'])),
  },
  solo: {
    outcome: pick('Outcome', every<RunOutcome>()(['won', 'lost', 'stalled'])), name: text('Gate'), rank: rank('Gate rank'), above,
    rounds: num('Rounds', 0, 1000), endPct: num('HP left (%)', 0, 100), life: pick('Life after', LIFE_STATES), personal: flag('A personal gate'),
  },
  gate: { name: text('Gate'), rank: rank('Gate rank'), above, toBreak: { ...num('Days before its break', 0, N), none: true } },
  closed: { name: text('Gate'), rank: rank('Gate rank') },
  quest: {
    end: pick('End', every<'done' | 'failed'>()(['done', 'failed'])), qkind: pick('Kind', every<QuestKind>()(['daily', 'main', 'side', 'job', 'urgent', 'penalty'])),
    from: pick('From', every<QuestSource>()(['gm', 'system', 'self'])), title: text('Title', 120),
  },
  daily: { streak: num('Streak', 0, N) },
  streakLost: { streak: num('Streak lost', 0, N) },
  penaltyIssued: { days: num('Days missed', 0, N) },
  penaltyLifted: { days: num('Days it held', 0, N) },
  life: {
    news: pick('What happened', every<LifeNews['kind']>()(['died', 'raised'])), how: pick('How', LIFE_HOWS),
  },
  level: { level: num('Level', 1, N) },
  rank: { rank: rank('Rank') },
  title: { name: text('Title') },
  feat: { key: text('Feat key', 40), name: text('Feat'), hidden: flag('Hidden until earned') },
  given: { key: text('Bundle key', 80), name: text('Bundle') },
  chapter: { title: text('Window title', 60), line: text('What the players read', 200) },
  roll: { natural: num('Natural', 1, 20) },
  coin: { won: flag('Called right') },
  shop: {
    act: pick('Act', every<'buy' | 'sell'>()(['buy', 'sell'])), item: text('Item'), rar: pick('Rarity', RARITIES), price: num('Gold', 0, N), goldAfter: num('Gold after', 0, N),
  },
  rest: { long: flag('A long rest') },
  used: { item: text('Item'), rar: pick('Rarity', RARITIES) },
  shadow: { name: text('Shadow') },
};
export const FACT_KINDS = Object.keys(FACT_FIELDS) as readonly FactKind[];

/**
 * Whether the chronicle keeps a fact once it is counted. Kills, rolls, coins, the shop, rests and consumables are many
 * and small: they count (the tally) and are dropped; a kill lives on in its fight's `kills`, `bosses` and `names`.
 */
export const KEPT: { readonly [K in FactKind]: (f: FactOf<K>) => boolean } = {
  fight: () => true, kill: () => false, solo: () => true, gate: () => true, closed: () => true, quest: () => true, daily: () => true, streakLost: () => true, penaltyIssued: () => true, penaltyLifted: () => true,
  life: () => true, level: () => true, rank: () => true, title: () => true, feat: () => true, given: () => true, chapter: () => true,
  roll: () => false, coin: () => false, shop: () => false, rest: () => false, used: () => false, shadow: () => true,
};
/** Whether the chronicle keeps `f`. */
export const kept = (f: Fact): boolean => (KEPT[f.kind] as (x: Fact) => boolean)(f);

// ── the boundary ──
type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const isKind = (v: unknown): v is FactKind => typeof v === 'string' && Object.hasOwn(FACT_FIELDS, v);
/** A field's value read by its spec, or undefined when it cannot be read. A number is whole and within its bounds; text is cut. */
function field(spec: FieldSpec, v: unknown): unknown {
  switch (spec.t) {
    case 'num':
      if (v === null && spec.none) return null;
      return typeof v === 'number' && Number.isFinite(v) ? Math.min(spec.max, Math.max(spec.min, Math.round(v))) : undefined;
    case 'flag': return typeof v === 'boolean' ? v : undefined;
    case 'rank': return (RANKS as readonly unknown[]).includes(v) ? v : undefined;
    case 'pick': return (spec.of as readonly unknown[]).includes(v) ? v : undefined;
    case 'text': return typeof v === 'string' ? v.slice(0, spec.max) : undefined;
  }
}
/**
 * A fact from outside data (a save, a sheet, a room message), or null. Each field is read by its kind's spec; a field
 * that does not read refuses the fact whole, since a fact with a guessed field would count as something it was not.
 */
export function parseFact(v: unknown): Fact | null {
  if (!isObj(v) || !isKind(v.kind)) return null;
  const out: Rec = { kind: v.kind };
  for (const [k, spec] of Object.entries(FACT_FIELDS[v.kind]) as [string, FieldSpec][]) {
    const x = field(spec, v[k]);
    if (x === undefined) return null;
    out[k] = x;
  }
  // every field of the kind was read by its spec above, so `out` is that kind's fact
  return out as Fact;
}
/** The longest `at` a kept fact holds (an ISO time is 24). */
const AT_MAX = 40;
/** A kept fact from outside data: a fact and its stamp, or null when either does not read. */
export function parseKept(v: unknown): Kept | null {
  const f = parseFact(v);
  if (!f || !isObj(v)) return null;
  const day = parseDayKey(v.day), at = typeof v.at === 'string' && v.at ? v.at.slice(0, AT_MAX) : null;
  const session = typeof v.session === 'number' && Number.isFinite(v.session) ? Math.max(0, Math.min(N, Math.round(v.session))) : null;
  return day && at !== null && session !== null ? { ...f, at, day, session } : null;
}
