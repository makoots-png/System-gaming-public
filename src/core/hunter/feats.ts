// feats.ts: a feat, what the System notices a hunter has done and rewards on its own (feature 1's notes section 5).
// Pure. A feat is a count (counts.ts) that earns it at `reach`, with up to `ALSO_MAX` tests of the hunter's state at
// that moment, a rule of when the player sees it before it is earned, its window's words and its reward. Each is
// earned once a hunter. The GM's own and the GM's edits of the built-ins are `library.feats` in the save, laid over the
// built-ins (registry/feats.ts) by `featsFor`, the one answer to which feats a phone checks; the GM's switch
// (`RULES.feats.on`, carried to the players by the room's `rules` doc) turns them all off. Nothing here issues a quest
// or moves a story: a feat rewards, and the GM's table moves at the GM's pace (the owner, Nov 18).
//
// A feat on a hunter, a machine (`TABLE`, `featStep`; its chart is scripts/charts/feat.ts):
//   hidden --counted [n >= reach and its state tests hold]--> earned
//   hidden --counted [shown at a count, n >= that count]----> shown
//   hidden --counted [otherwise]----------------------------> hidden (the count kept)
//   hidden --broke (a row's fact failed its tests)----------> hidden (n 0)
//   hidden --unlocked (the feat it waits on was earned)-----> shown
//   shown  --counted [n >= reach and its state tests hold]--> earned
//   shown  --counted [otherwise], broke, unlocked-----------> shown
//   earned --anything---------------------------------------> earned (nothing: null in the table)
import { RANKS, rankIdx } from '../rules.ts';
import type { Rules } from '../rules.ts';
import { grantLines, newRewards, parseRewards } from '../rewards.ts';
import type { RewardRules, Rewards } from '../rewards.ts';
import { parseFeatKey } from '../ids.ts';
import type { FeatKey } from '../ids.ts';
import { NO_COUNT, TEST_OPS, parseCount } from './counts.ts';
import type { FactCount, Counted, TestOp } from './counts.ts';
import { TALLY_KEYS } from './chronicle.ts';
import type { FeatState, Tally, TallyKey } from './chronicle.ts';
import { FACT_FIELDS } from './facts.ts';
import type { FieldSpec } from './facts.ts';

export type { FeatKey, FeatState };
/** What a feat may also ask of the hunter as it is earned: its level, its rank (E 0 to S 5), titles held, gold, or a lifetime number. */
export const STATE_OFS = ['level', 'rank', 'titles', 'gold', ...TALLY_KEYS] as const;
export type StateTest = { readonly of: 'level' | 'rank' | 'titles' | 'gold' | TallyKey; readonly op: TestOp; readonly value: number };
/** When the player sees a feat before it is earned: from the start, once its count reaches `n`, once another feat is earned, or never. */
export type Show = { readonly at: 'start' } | { readonly at: 'count'; readonly n: number } | { readonly at: 'feat'; readonly key: FeatKey } | { readonly at: 'never' };
export type FeatRule = FactCount & { readonly reach: number; readonly also: readonly StateTest[] };
export type FeatDef = {
  readonly name: string;
  /** The System window's title, in the System's voice ("YOU ARE STILL STANDING"). */
  readonly window: string;
  /** What the player reads once it is earned, and while it is shown. */
  readonly desc: string;
  readonly show: Show;
  readonly rule: FeatRule;
  readonly rewards: Rewards;
  /** A built-in the GM turned off: nothing counts toward it. Absent is on. */
  readonly off?: true;
};
/** The feats that apply on a phone, in the order they are checked: the built-ins in their order, then the library's by key. */
export type FeatBook = readonly (readonly [FeatKey, FeatDef])[];

export const FEAT_BOUNDS = { name: 60, window: 60, desc: 240, reach: 1e6, also: 3 } as const;

// ── the machine ──
export const FEAT_STATES = ['hidden', 'shown', 'earned'] as const;
export type FeatEvent =
  /** A fact its count takes moved it: the count after, and whether its state tests hold now. */
  | { readonly type: 'counted'; readonly count: Counted; readonly also: boolean }
  /** A fact of its kind failed its tests, for a count in a row. */
  | { readonly type: 'broke'; readonly count: Counted }
  /** The feat it waits on to be shown was earned. */
  | { readonly type: 'unlocked' };
export type FeatFx = 'earned' | 'shown' | null;
type Ctx = { readonly def: FeatDef; readonly now: string };
type Cell<E extends FeatEvent['type']> = ((s: FeatState & { at: 'hidden' | 'shown' }, e: Extract<FeatEvent, { type: E }>, c: Ctx) => { state: FeatState; fx: FeatFx }) | null;
const earnedOr = (s: { at: 'hidden' | 'shown' }, e: Extract<FeatEvent, { type: 'counted' }>, c: Ctx): { state: FeatState; fx: FeatFx } => {
  if (e.count.n >= c.def.rule.reach && e.also) return { state: { at: 'earned', on: c.now, name: c.def.name }, fx: 'earned' };
  const show = c.def.show, now = s.at === 'hidden' && show.at === 'count' && e.count.n >= show.n;
  return { state: { at: now ? 'shown' : s.at, ...e.count }, fx: now ? 'shown' : null };
};
/** Every cell of a feat's machine: a state by an event. */
export const TABLE: { readonly [S in (typeof FEAT_STATES)[number]]: { readonly [E in FeatEvent['type']]: Cell<E> } } = {
  hidden: {
    counted: earnedOr,
    broke: (s, e) => ({ state: { at: s.at, ...e.count, n: 0 }, fx: null }),
    unlocked: s => ({ state: { ...s, at: 'shown' }, fx: 'shown' }),
  },
  shown: {
    counted: earnedOr,
    broke: (s, e) => ({ state: { at: s.at, ...e.count, n: 0 }, fx: null }),
    unlocked: s => ({ state: s, fx: null }),
  },
  earned: { counted: null, broke: null, unlocked: null },
};
/** A feat's place on a hunter that has none yet: shown from the start, or hidden. */
export const startOf = (def: FeatDef): FeatState => ({ at: def.show.at === 'start' ? 'shown' : 'hidden', ...NO_COUNT });
/** A feat's place after `e`, and what to tell; an earned feat answers null (nothing moves it). */
export function featStep(s: FeatState, e: FeatEvent, def: FeatDef, now: string): { state: FeatState; fx: FeatFx } | null {
  if (s.at === 'earned') return null;
  const cell = TABLE[s.at][e.type] as Cell<FeatEvent['type']>;
  return cell ? cell(s, e as never, { def, now }) : null;
}

/** Whether a state test holds of a hunter. */
export function stateHolds(t: StateTest, h: { readonly level: number; readonly rank: string; readonly titles: readonly unknown[]; readonly gold: number; readonly chronicle: { readonly tally: Tally } }): boolean {
  const v = t.of === 'level' ? h.level : t.of === 'rank' ? rankIdx(h.rank) : t.of === 'titles' ? h.titles.length : t.of === 'gold' ? h.gold : h.chronicle.tally[t.of];
  return t.op === '>=' ? v >= t.value : t.op === '<=' ? v <= t.value : v === t.value;
}

// ── which feats apply ──
/**
 * The feats a phone checks: none when the GM's switch is off; else the built-ins in their order, each replaced by the
 * library's entry under its key (an edit, or turned off), then the library's own by key. A turned-off feat is left out.
 */
export function featsFor(R: Pick<Rules, 'feats'>, builtIns: FeatBook, library: Readonly<Record<string, FeatDef>>): FeatBook {
  if (!R.feats.on) return [];
  const own = Object.keys(library).filter(k => !builtIns.some(([b]) => b === k)).sort();
  const all: (readonly [FeatKey, FeatDef])[] = [...builtIns.map(([k, d]) => [k, library[k] ?? d] as const), ...own.map(k => [k as FeatKey, library[k]!] as const)];
  return all.filter(([, d]) => !d.off);
}

// ── the words ──
const specOf = (kind: string, name: string): FieldSpec | null => (FACT_FIELDS as unknown as Record<string, Record<string, FieldSpec>>)[kind]?.[name] ?? null;
/** "Monsters defeated: 37 of 100.": a shown feat's progress, from its count's own words. */
export function progressLine(def: FeatDef, s: FeatState): string {
  if (s.at === 'earned') return `Earned ${s.on.slice(0, 10)}.`;
  const m = def.rule.measure, label = m.of === 'facts' ? `${KIND_WORDS[def.rule.on] ?? 'Counted'}` : `${specOf(def.rule.on, m.field)?.label ?? m.field}`;
  return `${label}: ${s.n.toLocaleString('en-US')} of ${def.rule.reach.toLocaleString('en-US')}.`;
}
/** What a count of each kind counts, for a progress line. */
const KIND_WORDS: { readonly [K in keyof typeof FACT_FIELDS]: string } = {
  fight: 'Fights', kill: 'Monsters defeated', solo: 'Solo runs', gate: 'Gates cleared', closed: 'Personal gates closed', quest: 'Quests', daily: 'Dailies',
  streakLost: 'Streaks lost', penaltyIssued: 'Penalties', penaltyLifted: 'Penalties lifted', life: 'Life events', level: 'Levels', rank: 'Ranks', title: 'Titles',
  feat: 'Feats', given: 'Awards', roll: 'Rolls', coin: 'Coin calls', shop: 'Trades', rest: 'Rests', used: 'Consumables used', shadow: 'Shadows',
};
/** The window of a feat earned: its title, the line under it, the reward's lines. */
export const featWindow = (def: FeatDef, R: RewardRules): { readonly title: string; readonly body: string; readonly lines: string[] } =>
  ({ title: def.window, body: def.desc, lines: grantLines(R, def.rewards) });

/** The earned feats of a hunter its player has not been told of (device memory: the keys told), oldest first. */
export function featNews(feats: Readonly<Record<string, FeatState>>, told: readonly string[]): string[] {
  return Object.entries(feats).filter(([k, s]) => s.at === 'earned' && !told.includes(k))
    .sort(([, a], [, b]) => ((a as { on: string }).on < (b as { on: string }).on ? -1 : 1)).map(([k]) => k);
}

// ── the boundary ──
type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const line = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function showOf(v: unknown): Show {
  if (!isObj(v)) return { at: 'never' };
  if (v.at === 'start') return { at: 'start' };
  if (v.at === 'count' && typeof v.n === 'number' && v.n >= 1) return { at: 'count', n: Math.min(FEAT_BOUNDS.reach, Math.round(v.n)) };
  const key = v.at === 'feat' ? parseFeatKey(v.key) : null;
  return key ? { at: 'feat', key } : { at: 'never' };
}
/**
 * A feat from outside data (the library, a pack, the room's doc), or null. A feat with no name, or whose count does not
 * read (`parseCount`), is refused; a state test that does not read refuses it too, since dropping one would earn the feat
 * where its maker did not mean it. The words, the reward and the show rule take their defaults; numbers are cut to
 * their bounds.
 */
export function parseFeat(v: unknown): FeatDef | null {
  if (!isObj(v) || !isObj(v.rule)) return null;
  const name = line(v.name, FEAT_BOUNDS.name), count = parseCount(v.rule);
  if (!name || !count) return null;
  const reach = typeof v.rule.reach === 'number' && Number.isFinite(v.rule.reach) ? Math.max(1, Math.min(FEAT_BOUNDS.reach, Math.round(v.rule.reach))) : 1;
  const rawAlso = Array.isArray(v.rule.also) ? v.rule.also : [];
  if (rawAlso.length > FEAT_BOUNDS.also) return null;
  const also: StateTest[] = [];
  for (const t of rawAlso) {
    const of = isObj(t) ? STATE_OFS.find(o => o === t.of) : undefined, op = isObj(t) ? TEST_OPS.find(o => o === t.op) : undefined;
    const value = isObj(t) && typeof t.value === 'number' && Number.isFinite(t.value) ? Math.round(t.value) : null;
    if (!of || !op || value === null) return null;
    also.push({ of, op, value: of === 'rank' ? Math.max(0, Math.min(RANKS.length - 1, value)) : value });
  }
  const rewards = parseRewards(v.rewards) ?? newRewards();
  return {
    name, window: line(v.window, FEAT_BOUNDS.window).toUpperCase() || name.toUpperCase(), desc: line(v.desc, FEAT_BOUNDS.desc),
    show: showOf(v.show), rule: { ...count, reach, also }, rewards, ...(v.off === true ? { off: true as const } : {}),
  };
}
/** A library's feats from outside data: each under a key that reads as a feat's, each read by `parseFeat`, at most `cap`. */
export function parseFeats(v: unknown, cap: number): Record<string, FeatDef> {
  if (!isObj(v)) return {};
  const out: Record<string, FeatDef> = {};
  for (const [k, x] of Object.entries(v)) {
    if (Object.keys(out).length >= cap) break;
    const d = parseFeatKey(k) && parseFeat(x);
    if (d) out[k] = d;
  }
  return out;
}
