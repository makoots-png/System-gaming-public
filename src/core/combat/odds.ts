// odds.ts: how hard a fight is. The engine plays the fight as it stands (in setup or running) `of` times on the real
// reducer (play.ts), every row on the general policy (policy.ts `sensible`), each run from its own seed, and answers
// the odds: every run's end kept (`Odds`), read into shares and spreads (`readOdds`), told in core's sentences
// (`oddsLine`, `oddsDetail`). It runs in steps the caller drives (`oddsStep`, a machine with its `TABLE`: idle, running
// with its count, done, stale), so a phone draws "37 of 100" between frames. It answers numbers only: nothing here
// writes a save, a room or a fight anyone plays. The seed comes from the edge (src/edge/roll.ts `oddsSeed`).
import { killsSeen } from './fight-facts.ts';
import type { KillSeen } from './fight-facts.ts';
import { tallyOf } from './row-tally.ts';
import type { Rules } from '../rules.ts';
import type { CombatantId } from './ability-types.ts';
import type { Fight, Running, Setup } from './fight-types.ts';
import { sheetTotals } from './fight-turn.ts';
import type { SheetTotals } from './fight-turn.ts';
import { CAP_ROUNDS, playBegin, playOver, playStep } from './play.ts';
import type { Limits, Play, UsedUp } from './play.ts';
import type { Life, LifeState } from '../hunter/vitals.ts';
import { sensible } from './policy.ts';
import { isUp } from './row-hp.ts';
import { fudgeShown } from './fight-view.ts';

/** How one played fight ended for the party: it won, it lost (the fight ended without its win), or the cap (a stalemate). */
export const RUN_OUTCOMES = ['won', 'lost', 'stalled'] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number];
/**
 * A party row at a played fight's end: what it leaves on its sheet (`sheetTotals`) and whether it is up or dead (a
 * shadow's dead is defeated). Nothing in a play stands a row up from 0 HP, so a row that went down is dead at the end.
 */
export type RowEnd = SheetTotals & {
  readonly life: LifeState;
  /** A hunter row's life as the fight left it (what a solo run writes back); null for a shadow. */
  readonly lifeLeft: Life | null;
  /** The monsters it took down (a solo run's kill facts, solo.ts). */ readonly kills: readonly KillSeen[];
};
/** One played fight: its outcome, its rounds, the commands it took, each party row's end by id, and the items used up. */
export type RunEnd = {
  readonly outcome: RunOutcome; readonly rounds: number; readonly commands: number; readonly party: Readonly<Record<CombatantId, RowEnd>>; readonly spent: readonly UsedUp[];
};
/** A party row the odds tell of: its id, its name and its maxima at the start. */
export type OddsRow = { readonly id: CombatantId; readonly name: string; readonly hpMax: number; readonly manaMax: number; readonly fatigueMax: number };
/**
 * The engine's answer: how many fights it played, the party's rows, every fight's end, and whether the GM's fudge was
 * on in the fight it played (`fudge`: the line says so, so an answer shown stale still names what it was worked out with).
 */
export type Odds = { readonly of: number; readonly rows: readonly OddsRow[]; readonly ends: readonly RunEnd[]; readonly fudge: boolean };

/** The fights a run plays: a share over 100 runs has a standard error of at most 5 points (notes-6-odds.md). */
export const ODDS_RUNS = 100;
/** The work a solo run's play (gates.js) does in one frame, in ms: under half of a 60 Hz frame (16.7 ms). The odds box plays on a worker (src/edge/odds-run.ts). */
export const ODDS_FRAME_MS = 6;
const LIMITS: Limits = { capRounds: CAP_ROUNDS, endAtRounds: null };

/** A fight the engine can weigh: in setup or running, with a row up on each side. */
export const weighable = (f: Fight | null): f is Setup | Running =>
  f !== null && f.phase !== 'ended' && f.rows.some(r => r.side === 'party' && isUp(r)) && f.rows.some(r => r.side === 'foe' && isUp(r));
/** Whether the GM's fudge is on in a fight the engine weighs (any side's or row's weight, or a forced roll): the line's clause. */
export const fudgeOn = (f: Setup | Running): boolean => fudgeShown(f);
/** What the odds were worked out from, as one string: the fight without its log. Another string means another fight. */
export const oddsKey = (f: Fight): string => JSON.stringify({ ...f, log: null });
/** The seed of fight `i` of a run of seed `seed`. */
const seedOf = (seed: number, i: number): number => (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;

const partyRows = (f: Fight): OddsRow[] => f.rows.filter(r => r.side === 'party' && r.kind !== 'summon')
  .map(r => ({ id: r.id, name: r.name, hpMax: r.sheet.hpMax, manaMax: r.sheet.manaMax, fatigueMax: r.sheet.fatigueMax }));
/** A played fight's end: its outcome, and each party row of `rows` as the play left it (notes-2-solo.md section 2). */
export function endOf(p: Play & { readonly fight: { readonly phase: 'ended' } }, rows: readonly OddsRow[], R: Rules): RunEnd {
  const f = p.fight;
  const outcome: RunOutcome = p.capped ? 'stalled' : f.summary.winner === 'party' ? 'won' : 'lost';
  const party: Record<CombatantId, RowEnd> = {};
  for (const { id } of rows) {
    const r = f.rows.find(x => x.id === id);
    if (!r) continue;
    party[id] = { ...sheetTotals(r, f.now, R), life: isUp(r) ? 'up' : 'dead', lifeLeft: r.kind === 'hunter' ? r.life : null, kills: killsSeen(tallyOf(r), f.rows) };
  }
  return { outcome, rounds: f.summary.rounds, commands: p.steps, party, spent: p.spent };
}

// ── the run's machine ──
/**
 * A run of the engine: none asked (`idle`); playing fight `ends.length + 1` of `of` (`running`, `play` the one under way,
 * null before it is begun, `from` the key of the fight asked of); answered (`done`); answered for a fight that has
 * changed since (`stale`).
 */
export type OddsRun =
  | { readonly state: 'idle' }
  | { readonly state: 'running'; readonly from: string; readonly fight: Setup | Running; readonly seed: number; readonly rows: readonly OddsRow[]; readonly of: number; readonly ends: readonly RunEnd[]; readonly play: Play | null }
  | { readonly state: 'done'; readonly from: string; readonly odds: Odds }
  | { readonly state: 'stale'; readonly odds: Odds };
export type OddsState = OddsRun['state'];
/** Asked of a fight; `commands` more commands played; the fight on screen now has key `from`; the GM stopped it. */
export type OddsEvent =
  | { readonly type: 'ask'; readonly fight: Setup | Running; readonly seed: number; readonly of: number }
  | { readonly type: 'step'; readonly commands: number }
  | { readonly type: 'changed'; readonly from: string }
  | { readonly type: 'cancel' };
/**
 * A fight and the rules it is played by, as one value: what a caller hands the engine (the odds box, a solo run). A
 * solo fight's rules are not the phone's (gates/solo.ts `soloFight` lays the room's statuses over them), so the two
 * travel together and the odds of a fight cannot be played by rules other than its run's.
 */
export type Weighed = { readonly fight: Setup | Running; readonly R: Rules };
export const ODDS_STATES: readonly OddsState[] = ['idle', 'running', 'done', 'stale'];
export const ODDS_EVENTS: readonly OddsEvent['type'][] = ['ask', 'step', 'changed', 'cancel'];

export const IDLE: OddsRun = { state: 'idle' };
type In<S extends OddsState> = Extract<OddsRun, { readonly state: S }>;
type Cell<S extends OddsState, E extends OddsEvent['type']> = ((r: In<S>, e: Extract<OddsEvent, { readonly type: E }>, R: Rules) => OddsRun) | null;
type Table = { readonly [S in OddsState]: { readonly [E in OddsEvent['type']]: Cell<S, E> } };

/**
 * A run started on `fight`, its first fight not yet begun: a begin runs the reducer, so it is a step the caller's
 * budget counts, never part of the ask (notes-6-odds.md, unit 6b).
 */
const asked = (_r: OddsRun, e: Extract<OddsEvent, { readonly type: 'ask' }>): OddsRun => ({
  state: 'running', from: oddsKey(e.fight), fight: e.fight, seed: e.seed, rows: partyRows(e.fight), of: Math.max(1, Math.floor(e.of)), ends: [], play: null,
});
/**
 * `commands` more steps of the run, each one piece the caller's budget can stop after: the next fight begun, one
 * command of the fight under way, or a finished fight's end kept; done at the last end.
 */
function stepped(r: In<'running'>, e: Extract<OddsEvent, { readonly type: 'step' }>, R: Rules): OddsRun {
  let play = r.play, ends = r.ends;
  for (let n = 0; n < e.commands; n++) {
    if (play === null) play = playBegin(r.fight, seedOf(r.seed, ends.length), R).play;
    else if (playOver(play)) {
      ends = [...ends, endOf(play, r.rows, R)];
      if (ends.length >= r.of) return { state: 'done', from: r.from, odds: { of: r.of, rows: r.rows, ends, fudge: fudgeOn(r.fight) } };
      play = null;
    } else play = playStep(play as Play & { readonly fight: Running }, () => sensible, LIMITS, R).play;
  }
  return { ...r, play, ends };
}
const same = <S extends OddsState>(r: In<S>): OddsRun => r;

/** Each state's answer to each event; null where the event does not apply. */
export const TABLE: Table = {
  idle: { ask: asked, step: null, changed: same, cancel: null },
  running: { ask: asked, step: stepped, changed: (r, e) => (e.from === r.from ? r : IDLE), cancel: () => IDLE },
  done: { ask: asked, step: null, changed: (r, e) => (e.from === r.from ? r : { state: 'stale', odds: r.odds }), cancel: null },
  stale: { ask: asked, step: null, changed: same, cancel: null },
};
/** The run after `e`: the table's cell, or the run as it was where the event does not apply. */
export function oddsStep(r: OddsRun, e: OddsEvent, R: Rules): OddsRun {
  const cell = TABLE[r.state][e.type] as ((r: OddsRun, e: OddsEvent, R: Rules) => OddsRun) | null;
  return cell ? cell(r, e, R) : r;
}
/**
 * How far a run has got: fights finished and fights asked for, and of the fight under way the commands played and the
 * round it is in (0 before it is begun). Null when it is not running. A run of one fight cannot know its length, so its
 * count is the moves and the round, never a share (notes-2-solo.md 1.4).
 */
export const progressOf = (r: OddsRun, R: Rules): { readonly done: number; readonly of: number; readonly commands: number; readonly round: number } | null =>
  r.state === 'running'
    ? { done: r.ends.length, of: r.of, commands: r.play?.steps ?? 0, round: r.play ? Math.floor(r.play.fight.now / R.fight.round) + 1 : 0 }
    : null;

// ── reading the odds ──
/** A spread over the runs: the 10th, 50th and 90th percentile (nearest rank). */
export type Percentiles = { readonly low: number; readonly mid: number; readonly high: number };
/** A party row's spread: `dead` the share of runs it ended dead (a shadow defeated). */
export type RowRead = OddsRow & { readonly dead: number; readonly hp: Percentiles; readonly mana: Percentiles; readonly fatigue: Percentiles };
/** The odds read: the share of runs won, lost and stalled, the rounds, each party row's spread, and whether the fudge was on (`fudge`). */
export type OddsRead = { readonly of: number; readonly fudge: boolean; readonly won: number; readonly lost: number; readonly stalled: number; readonly rounds: Percentiles; readonly party: readonly RowRead[] };

/** The nearest-rank percentiles: the smallest value with at least that share of the runs at or below it. */
export function spreadOf(values: readonly number[]): Percentiles {
  const s = [...values].sort((a, b) => a - b), at = (q: number): number => s[Math.max(0, Math.ceil(q * s.length) - 1)] ?? 0;
  return { low: at(0.1), mid: at(0.5), high: at(0.9) };
}
export function readOdds(o: Odds): OddsRead {
  const n = o.ends.length || 1, share = (k: number): number => k / n;
  const count = (p: (e: RunEnd) => boolean): number => o.ends.filter(p).length;
  return {
    of: o.ends.length, fudge: o.fudge,
    won: share(count(e => e.outcome === 'won')), lost: share(count(e => e.outcome === 'lost')), stalled: share(count(e => e.outcome === 'stalled')),
    rounds: spreadOf(o.ends.map(e => e.rounds)),
    party: o.rows.map(row => {
      const ends = o.ends.flatMap(e => (e.party[row.id] ? [e.party[row.id]!] : []));
      return {
        ...row, dead: share(ends.filter(x => x.life === 'dead').length),
        hp: spreadOf(ends.map(x => x.hp)), mana: spreadOf(ends.map(x => x.mana)), fatigue: spreadOf(ends.map(x => x.fatigue)),
      };
    }),
  };
}

// ── the words ──
const pct = (share: number): string => `${Math.round(100 * share)}%`;
/** A spread in whole numbers: a fight's rounds are fight time over a round, so a share of one (summary.rounds). */
const range = (s: Percentiles): string => { const low = Math.round(s.low), high = Math.round(s.high); return low === high ? `${low}` : `${low} to ${high}`; };
/** About how many rounds: the median, whole, and at least 1. */
const about = (s: Percentiles): number => Math.max(1, Math.round(s.mid));
/** The row most likely to die, null when there is none. */
const mostDead = (r: OddsRead): RowRead | null => [...r.party].sort((a, b) => b.dead - a.dead)[0] ?? null;

/**
 * Who the odds speak to: the GM weighing a party's fight (`party`), or a player weighing a solo gate for one hunter
 * (`alone`; lead-look-2-solo.md, finding 3: one hunter is not a party). The numbers are the same read either way.
 */
export type OddsVoice = 'party' | 'alone';
/** What the GM's line adds while the fudge was on: the number is the fight's as weighted, not the fight's as dealt. */
const FUDGE_CLAUSE = ' (with your fudge)';
/** The words that differ by voice: the share won, the share lost, and the control's hint. */
const VOICE: { readonly [V in OddsVoice]: { readonly won: (r: OddsRead) => string; readonly lost: (share: number) => string; readonly hint: string } } = {
  party: {
    won: r => `The party wins ${pct(r.won)} of ${r.of} fights${r.fudge ? FUDGE_CLAUSE : ''}.`,
    lost: share => `The party loses ${pct(share)}.`,
    hint: `Plays this fight to the end ${ODDS_RUNS} times by the rules and shows how often the party wins.`,
  },
  alone: {
    won: r => `You clear it in ${pct(r.won)} of ${r.of} plays.`,
    lost: share => `The run fails in ${pct(share)}.`,
    hint: `Plays this gate to the end ${ODDS_RUNS} times by the rules and shows how often you clear it.`,
  },
};
/** The share of fights won, in `voice`'s words: the first sentence of the line and of a solo run's confirm. */
export const wonLine = (r: OddsRead, voice: OddsVoice): string => VOICE[voice].won(r);
/** One row's chance to die, as a sentence: what a hunter alone reads after its chance to clear. */
export const fateLine = (row: RowRead): string => (row.dead > 0 ? `Dead in ${pct(row.dead)}.` : 'Never dead in these plays.');
/** The control's hint under its button, in `voice`'s words. */
export const oddsHint = (voice: OddsVoice): string => VOICE[voice].hint;

/**
 * The one line acted on: the chance to win, then for a party who is most likely to die, for a hunter alone its chance
 * to die; about how many rounds.
 */
export function oddsLine(r: OddsRead, voice: OddsVoice): string {
  const worst = mostDead(r);
  const who = voice === 'alone' && worst ? fateLine(worst) : worst && worst.dead > 0 ? `${worst.name} is most likely to die (${pct(worst.dead)}).` : 'Nobody died.';
  return `${wonLine(r, voice)} ${who} About ${about(r.rounds)} round${about(r.rounds) === 1 ? '' : 's'}.`;
}
/** The detail under the line: the rounds, the losses, the stalemates, each party row's end. */
export function oddsDetail(r: OddsRead, voice: OddsVoice): string[] {
  const out = [`Rounds: ${range(r.rounds)}, most often about ${about(r.rounds)}.`];
  if (r.lost > 0) out.push(VOICE[voice].lost(r.lost));
  if (r.stalled > 0) out.push(`No winner by round ${CAP_ROUNDS} in ${pct(r.stalled)}.`);
  for (const p of r.party) {
    const fate = p.dead > 0 ? `dead in ${pct(p.dead)}` : 'never dead';
    out.push(`${p.name}: ${fate}. Ends with ${range(p.hp)} of ${p.hpMax} HP, ${range(p.mana)} of ${p.manaMax} mana, ${range(p.fatigue)} of ${p.fatigueMax} fatigue.`);
  }
  return out;
}
/** What the control says: its label, the count while it runs, the mark on an answer for a fight that changed since. */
export const ODDS_WORDS = {
  ask: `Play it out ${ODDS_RUNS} times`,
  again: 'Play it out again',
  stop: 'Stop',
  running: (done: number, of: number): string => `Playing ${done} of ${of}`,
  stale: 'The fight changed since these odds. Play it out again to update them.',
} as const;
