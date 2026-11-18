// chronicle.ts: what the System remembers of a hunter (docs/agent-handoff/features/notes-1-feats.md section 1). Pure.
// `record` is the one writer of a hunter's inbox: the one function that does a thing appends its fact in that thing's
// write. `noticed` (noticed.ts) is the one reader that empties it, in the same write: it stamps each fact, folds it into
// the lifetime tally (`TALLY`) and keeps the last `CHRONICLE_MAX` facts worth reading (facts.ts `KEPT`). The sheet push
// carries a cut of it (`pushedChronicle`). A lint keeps both writers: tests/lint.test.ts.
import { parseCounted } from './counts.ts';
import type { Counted } from './counts.ts';
import { parseFeatKey } from '../ids.ts';
import { parseFact, parseKept } from './facts.ts';
import type { Fact, Kept } from './facts.ts';

/**
 * The lifetime numbers, each the fold of every fact ever noticed by its row of `TALLY`. A new key is a member here and
 * its row in `TALLY` (the typecheck asks).
 */
export const TALLY_KEYS = [
  'fights', 'won', 'kills', 'bosses', 'crits', 'struck', 'avoided', 'healed', 'gates', 'soloWon', 'soloLost', 'retreats', 'quests', 'questsFailed', 'dailies', 'streaksLost', 'penalties', 'penaltyDays',
  'fell', 'died', 'revived', 'levels', 'titles', 'feats', 'hiddenFeats', 'given', 'shadows', 'coinsWon', 'coinsLost', 'nat20', 'nat1', 'longRests',
  'bought', 'sold', 'used',
] as const;
export type TallyKey = (typeof TALLY_KEYS)[number];
export type Tally = { readonly [K in TallyKey]: number };

/** What one fact adds to each lifetime number. */
export const TALLY: { readonly [K in TallyKey]: (f: Fact) => number } = {
  fights: f => (f.kind === 'fight' ? 1 : 0),
  won: f => (f.kind === 'fight' && f.outcome === 'won' ? 1 : 0),
  kills: f => (f.kind === 'kill' ? 1 : 0),
  bosses: f => (f.kind === 'kill' && f.mkind === 'boss' ? 1 : 0),
  crits: f => (f.kind === 'fight' ? f.crits : 0),
  struck: f => (f.kind === 'fight' ? f.struck : 0),
  avoided: f => (f.kind === 'fight' ? f.avoided : 0),
  healed: f => (f.kind === 'fight' ? f.healed : 0),
  gates: f => (f.kind === 'gate' ? 1 : 0),
  soloWon: f => (f.kind === 'solo' && f.outcome === 'won' ? 1 : 0),
  soloLost: f => (f.kind === 'solo' && f.outcome === 'lost' ? 1 : 0),
  retreats: f => (f.kind === 'solo' && f.outcome === 'stalled' ? 1 : 0),
  quests: f => (f.kind === 'quest' && f.end === 'done' ? 1 : 0),
  questsFailed: f => (f.kind === 'quest' && f.end === 'failed' ? 1 : 0),
  dailies: f => (f.kind === 'daily' ? 1 : 0),
  streaksLost: f => (f.kind === 'streakLost' ? 1 : 0),
  penalties: f => (f.kind === 'penaltyIssued' ? 1 : 0),
  penaltyDays: f => (f.kind === 'penaltyIssued' ? f.days : 0),
  fell: f => (f.kind === 'life' && f.news === 'fell' ? 1 : 0),
  died: f => (f.kind === 'life' && f.news === 'died' ? 1 : 0),
  revived: f => (f.kind === 'life' && f.news === 'raised' && (f.how === 'gm' || f.how === 'item') ? 1 : 0),
  levels: f => (f.kind === 'level' ? 1 : 0),
  titles: f => (f.kind === 'title' ? 1 : 0),
  feats: f => (f.kind === 'feat' ? 1 : 0),
  hiddenFeats: f => (f.kind === 'feat' && f.hidden ? 1 : 0),
  given: f => (f.kind === 'given' ? 1 : 0),
  shadows: f => (f.kind === 'shadow' ? 1 : 0),
  coinsWon: f => (f.kind === 'coin' && f.won ? 1 : 0),
  coinsLost: f => (f.kind === 'coin' && !f.won ? 1 : 0),
  nat20: f => (f.kind === 'roll' && f.natural === 20 ? 1 : 0),
  nat1: f => (f.kind === 'roll' && f.natural === 1 ? 1 : 0),
  longRests: f => (f.kind === 'rest' && f.long ? 1 : 0),
  bought: f => (f.kind === 'shop' && f.act === 'buy' ? 1 : 0),
  sold: f => (f.kind === 'shop' && f.act === 'sell' ? 1 : 0),
  used: f => (f.kind === 'used' ? 1 : 0),
};

export type Chronicle = {
  /**
   * Facts this write recorded and `noticed` has not taken yet. Between writes it is empty, or holds the facts of a
   * hunter a fight holds until the fight lets it go (noticed.ts).
   */
  readonly inbox: readonly Fact[];
  /** The last `CHRONICLE_MAX` kept facts, stamped, oldest first. */
  readonly facts: readonly Kept[];
  readonly tally: Tally;
  /** This hunter's place on each feat that has moved for it, by the feat's key (feats.ts `featStep`); absent is the feat's start. */
  readonly feats: Readonly<Record<string, FeatState>>;
};
/**
 * A hunter's place on one feat (feats.ts, its machine `featStep`): hidden or shown with its count, or earned, with when
 * and the feat's name as it was then (a feat deleted since still reads).
 */
export type FeatState = ({ readonly at: 'hidden' | 'shown' } & Counted) | { readonly at: 'earned'; readonly on: string; readonly name: string };
/** The most feats a chronicle holds a place on, a bound for junk: the built-ins and a full library. */
export const FEAT_STATES_MAX = 400;
/** The earned feats the sheet push carries, the newest (notes-1-feats.md 1.6). */
export const PUSHED_FEATS = 40;

/**
 * The facts a chronicle keeps: 40 is a quiet month of dailies, or about three sessions of a table (about 12 kept facts a
 * session), what a player scrolls and a recap reads (notes-1-feats.md 1.6).
 */
export const CHRONICLE_MAX = 40;
/** The facts the sheet push carries: a session's fights and its level, for the GM's board (notes-1-feats.md 1.6). */
export const PUSHED_FACTS = 8;
/** A bound for junk: an inbox holds a write's facts, or a held hunter's few (a fall, a roll, a coin). */
export const INBOX_MAX = 200;
/** A tally number's bound, for junk. */
const TALLY_MAX = 1e9;

export const newTally = (): Tally => Object.fromEntries(TALLY_KEYS.map(k => [k, 0])) as { [K in TallyKey]: number };
export const newChronicle = (): Chronicle => ({ inbox: [], facts: [], tally: newTally(), feats: {} });

/** The one writer of the inbox: `facts` appended, the oldest dropped past `INBOX_MAX`. */
export const record = <H extends { readonly chronicle: Chronicle }>(h: H, ...facts: readonly Fact[]): H =>
  (facts.length ? { ...h, chronicle: { ...h.chronicle, inbox: [...h.chronicle.inbox, ...facts].slice(-INBOX_MAX) } } : h);

/** The tally after fact `f`. */
export const tallyAfter = (t: Tally, f: Fact): Tally => {
  const out = { ...t } as { [K in TallyKey]: number };
  for (const k of TALLY_KEYS) { const n = TALLY[k](f); if (n) out[k] = Math.min(TALLY_MAX, out[k] + n); }
  return out;
};

/** What the sheet push carries of a chronicle: the tally and the last `PUSHED_FACTS` kept facts, an empty inbox. */
export const pushedChronicle = (c: Chronicle): Chronicle => {
  const earned = Object.entries(c.feats).filter(([, st]) => st.at === 'earned').sort(([, a], [, b]) => ((a as { on: string }).on < (b as { on: string }).on ? -1 : 1)).slice(-PUSHED_FEATS);
  return { inbox: [], facts: c.facts.slice(-PUSHED_FACTS), tally: c.tally, feats: Object.fromEntries(earned) };
};

// ── the boundary ──
type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/**
 * A chronicle from outside data (a save, a sheet), or an empty one. A fact or kept fact that does not read is dropped;
 * the newest are kept to their bounds; a tally number is whole, from 0 to its bound, and 0 when it does not read.
 */
export function parseChronicle(v: unknown): Chronicle {
  if (!isObj(v)) return newChronicle();
  const t = isObj(v.tally) ? v.tally : {};
  const tally = Object.fromEntries(TALLY_KEYS.map(k => {
    const n = t[k];
    return [k, typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(TALLY_MAX, Math.round(n))) : 0];
  })) as { [K in TallyKey]: number };
  return {
    inbox: list(v.inbox).flatMap(f => parseFact(f) ?? []).slice(-INBOX_MAX),
    facts: list(v.facts).flatMap(f => parseKept(f) ?? []).slice(-CHRONICLE_MAX),
    tally,
    feats: featStates(v.feats),
  };
}

/** A feat state from outside data, or null: earned with its time and name, or hidden or shown with its count. */
function featState(v: unknown): FeatState | null {
  if (!isObj(v)) return null;
  if (v.at === 'earned') return typeof v.on === 'string' && typeof v.name === 'string' ? { at: 'earned', on: v.on.slice(0, 40), name: v.name.slice(0, 60) } : null;
  return v.at === 'hidden' || v.at === 'shown' ? { at: v.at, ...parseCounted(v) } : null;
}
/** The feat states of a chronicle: each under a key that reads as a feat's, at most `FEAT_STATES_MAX`. */
function featStates(v: unknown): Record<string, FeatState> {
  if (!isObj(v)) return {};
  const out: Record<string, FeatState> = {};
  for (const [k, x] of Object.entries(v).slice(0, FEAT_STATES_MAX)) { const st = parseFeatKey(k) && featState(x); if (st) out[k] = st; }
  return out;
}
