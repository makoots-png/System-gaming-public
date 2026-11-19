// chronicle-view.ts: what the System remembers of a hunter, as a screen reads it (feature 1's notes 17.12). Pure:
// sentences and plain data, nothing written. `factLine` is one plain sentence a kind of fact, with its numbers
// (`FACT_LINES`: the typecheck asks for a line when a kind is added to facts.ts). `chronicleView` is the whole panel as
// data: the lifetime numbers, the feats earned (newest first) and the ones shown with their progress (closest first),
// the kept facts (newest first). The sheet's Chronicle panel and the GM's read-only window (src/views/chronicle.js)
// draw the same value, the GM's from a player's pushed sheet (chronicle.ts `pushedChronicle`: no feat in progress
// travels, so that list is empty there). `boardLine` is the GM board's line of a hunter's feats.
import type { Rules } from '../rules.ts';
import { grantLines } from '../rewards.ts';
import type { RewardRules } from '../rewards.ts';
import { PUSHED_FACTS, PUSHED_FEATS } from './chronicle.ts';
import type { Chronicle, TallyKey } from './chronicle.ts';
import type { Fact, FactKind, FactOf, Kept } from './facts.ts';
import { progressLine, startOf } from './feats.ts';
import type { FeatBook } from './feats.ts';
import type { LifeHow } from './facts.ts';
import type { LifeState } from './vitals.ts';
import type { QuestKind } from '../save.ts';

// ── one sentence a kind of fact ──
const n = (v: number): string => v.toLocaleString('en-US');
/** "1 round", "6 rounds". */
const count = (v: number, one: string, many = `${one}s`): string => `${n(v)} ${v === 1 ? one : many}`;
const QUEST_WORDS: { readonly [K in QuestKind]: string } = { daily: 'daily', main: 'main', side: 'side', job: 'Job Change', urgent: 'urgent', penalty: 'penalty' };
/** How a change of life came about, after its verb. */
const HOW_WORDS: { readonly [H in LifeHow]: string } = {
  fight: ' in a fight', save: ' on a death save', gm: ' by the GM', item: ' with an item', rest: ' with a rest', hand: ' after a change by hand',
};
/** How a hunter came out of a lost solo run. */
const AFTER_WORDS: { readonly [L in LifeState]: string } = { up: 'was up at its end', dying: 'was down at its end', stable: 'was down and stable at its end', dead: 'died' };
const failed = (v: number): string => (v ? `, after ${count(v, 'failed death save')}` : '');
/** A fight's foes and where it was: " in Goblin Den against 3 Goblins", each part left out when the fact has none. */
const against = (f: FactOf<'fight'>): string => `${f.gate ? ` in ${f.gate}` : ''}${f.names ? ` against ${f.names}` : ''}`;
/** How a hunter's row ended a fight: its HP share, or down. */
const ended = (f: FactOf<'fight'>): string => (f.up ? `at ${n(f.endPct)}% HP` : 'down at the end');

/** One plain sentence for each kind of fact, saying what happened with its numbers. */
export const FACT_LINES: { readonly [K in FactKind]: (f: FactOf<K>) => string } = {
  fight: f => (f.outcome === 'ended' ? `The GM ended a fight${against(f)} after ${count(f.rounds, 'round')}, ${ended(f)}.`
    : `${f.outcome === 'won' ? 'Won' : 'Lost'} a fight${against(f)} in ${count(f.rounds, 'round')}, ${ended(f)}.`),
  kill: f => `Defeated ${f.monster}, a rank ${f.rank} ${f.mkind === 'normal' ? 'monster' : f.mkind}, at ${n(f.hpPct)}% HP.`,
  solo: f => {
    const where = `a solo run in ${f.name} (rank ${f.rank})`;
    if (f.outcome === 'won') return `Won ${where} in ${count(f.rounds, 'round')}, at ${n(f.endPct)}% HP.`;
    if (f.outcome === 'stalled') return `Retreated from ${where} after ${count(f.rounds, 'round')}, at ${n(f.endPct)}% HP.`;
    return `Lost ${where} in ${count(f.rounds, 'round')} and ${AFTER_WORDS[f.life]}.`;
  },
  gate: f => `Cleared ${f.name}, a rank ${f.rank} gate${f.toBreak === null ? '' : `, ${count(f.toBreak, 'day')} before its break`}.`,
  closed: f => `The personal gate ${f.name} (rank ${f.rank}) closed when its time ran out.`,
  quest: f => `${f.end === 'done' ? 'Completed' : 'Failed'} the ${QUEST_WORDS[f.qkind]} quest ${f.title}.`,
  daily: f => `Finished the day's daily quests, ${count(f.streak, 'day')} in a row.`,
  streakLost: f => `Lost a daily streak of ${count(f.streak, 'day')}.`,
  penaltyIssued: f => `Got the daily penalty for ${count(f.days, 'missed day')}.`,
  penaltyLifted: f => `The daily penalty ended after ${count(f.days, 'day')}.`,
  life: f => {
    switch (f.news) {
      case 'fell': return `Went down${HOW_WORDS[f.how]}.`;
      case 'raised': return f.how === 'gm' || f.how === 'item' ? `Revived${HOW_WORDS[f.how]}.` : `Got back up${HOW_WORDS[f.how]}.`;
      case 'stable': return `Became stable${f.failures ? ` after ${count(f.failures, 'failed death save')}` : ''}.`;
      case 'died': return `Died${HOW_WORDS[f.how]}${failed(f.failures)}.`;
      case 'saved': return `Passed a death save, with ${n(f.failures)} failed before it.`;
      case 'failed': return `Failed a death save, with ${n(f.failures)} failed before it.`;
    }
  },
  level: f => `Reached level ${n(f.level)}.`,
  rank: f => `Became rank ${f.rank}.`,
  title: f => `Got the title ${f.name}.`,
  feat: f => `Earned the ${f.hidden ? 'hidden ' : ''}feat ${f.name}.`,
  given: f => `The GM gave the award ${f.name}.`,
  chapter: f => `A story window: ${f.title}.${f.line ? ` ${f.line}` : ''}`,
  roll: f => `Rolled a natural ${n(f.natural)} on a check.`,
  coin: f => `Called the coin ${f.won ? 'right' : 'wrong'}.`,
  shop: f => `${f.act === 'buy' ? 'Bought' : 'Sold'} ${f.item} for ${n(f.price)} gold, with ${n(f.goldAfter)} gold left.`,
  rest: f => `Took a ${f.long ? 'long' : 'short'} rest.`,
  used: f => `Used ${f.item}.`,
  shadow: f => `The shadow ${f.name} joined the army.`,
};
/** The sentence of fact `f`. */
export const factLine = (f: Fact): string => (FACT_LINES[f.kind] as (x: Fact) => string)(f);
/** When a kept fact happened, as a screen says it: its session once the GM has started one, else its day. */
export const factWhen = (f: Pick<Kept, 'session' | 'day'>): string => (f.session >= 1 ? `Session ${n(f.session)}` : f.day);

// ── the panel as data ──
/** The lifetime numbers a screen shows, in order, each a key of the tally with its label. */
export const NUMBERS: readonly (readonly [TallyKey, string])[] = [
  ['won', 'Fights won'], ['kills', 'Monsters defeated'], ['gates', 'Gates cleared'], ['fell', 'Times down'], ['feats', 'Feats'],
];
/** How many rows of each list the panel shows before "Show all". */
export const FIRST = { earned: 3, shown: 3, facts: 5 } as const;
export type ChronicleView = {
  readonly numbers: readonly { readonly label: string; readonly n: number }[];
  /** The feats earned, newest first: the name it was earned under, whether it was hidden until then, its description, when, and its reward's lines. */
  readonly earned: readonly { readonly key: string; readonly name: string; readonly hidden: boolean; readonly desc: string; readonly when: string; readonly gave: readonly string[] }[];
  /** The feats shown and not earned, the closest to done first: its name, its description and its progress line. */
  readonly shown: readonly { readonly key: string; readonly name: string; readonly desc: string; readonly progress: string }[];
  /** The kept facts, newest first. */
  readonly facts: readonly { readonly when: string; readonly line: string }[];
  /** The GM's switch is off: nothing counts toward a feat, and none is in progress. */
  readonly featsOff: boolean;
};
/**
 * Chronicle `c` as a screen reads it, against the feats that apply on this phone (`book`, feats.ts `featsFor`). An
 * earned feat reads by the name it was earned under; its description and what it gave come from the book, and are
 * empty for a feat the book no longer holds. Whether it was hidden: the book's rule, else its `feat` fact while the
 * chronicle still keeps it. A feat hidden and not earned is left out, and so is its count. `from`: the hunter's own
 * chronicle (`sheet`), or the cut a player's phone pushed (`push`), which carries no count of a feat in progress, so
 * none is listed: a count read as 0 there would be false.
 */
export function chronicleView(c: Chronicle, book: FeatBook, R: RewardRules & Pick<Rules, 'feats'>, from: 'sheet' | 'push' = 'sheet'): ChronicleView {
  const defOf = (key: string) => book.find(([k]) => k === key)?.[1];
  const earned = Object.entries(c.feats).flatMap(([key, st]) => (st.at === 'earned' ? [{ key, st }] : []))
    .sort((a, b) => (a.st.on < b.st.on ? 1 : a.st.on > b.st.on ? -1 : 0))
    .map(({ key, st }) => {
      const def = defOf(key);
      const hidden = def ? def.show.at === 'never' : c.facts.some(f => f.kind === 'feat' && f.key === key && f.hidden);
      return { key, name: st.name, hidden, desc: def?.desc ?? '', when: def ? progressLine(def, st) : `Earned ${st.on.slice(0, 10)}.`, gave: def ? grantLines(R, def.rewards) : [] };
    });
  const shown = (from === 'push' ? [] : book).flatMap(([key, def], at) => {
    const st = c.feats[key] ?? startOf(def);
    return st.at === 'shown' ? [{ key, name: def.name, desc: def.desc, progress: progressLine(def, st), share: st.n / def.rule.reach, at }] : [];
  }).sort((a, b) => b.share - a.share || a.at - b.at).map(({ key, name, desc, progress }) => ({ key, name, desc, progress }));
  return {
    numbers: NUMBERS.map(([k, label]) => ({ label, n: c.tally[k] })),
    earned, shown,
    facts: [...c.facts].reverse().map(f => ({ when: factWhen(f), line: factLine(f) })),
    featsOff: !R.feats.on,
  };
}

// ── the words ──
/** What the "Show all" button names: each list that holds more rows than the panel shows first. */
const more = (v: ChronicleView): string[] => [
  v.earned.length > FIRST.earned ? count(v.earned.length, 'feat') : '',
  v.shown.length > FIRST.shown ? `${n(v.shown.length)} in progress` : '',
  v.facts.length > FIRST.facts ? count(v.facts.length, 'entry', 'entries') : '',
].filter(Boolean);
export const CHRONICLE_WORDS = {
  title: 'Chronicle',
  feats: 'Feats', shown: 'In progress', facts: 'What happened', hidden: 'Hidden',
  noFeats: 'No feats earned yet.',
  hiddenNote: 'Some feats stay hidden until earned.',
  featsOff: 'Feats are turned off. Nothing counts toward a feat until they are on again.',
  noFacts: 'Nothing yet. The System writes what this hunter does here.',
  /** The button's label while the panel is short, or '' when every list is shown whole. */
  showAll: (v: ChronicleView): string => { const m = more(v); return m.length ? `Show all: ${m.join(', ')}` : ''; },
  showLess: 'Show less',
  pushed: `From the player's phone: its lifetime numbers, its ${PUSHED_FEATS} newest feats and its last ${PUSHED_FACTS} entries.`,
  close: 'Close',
} as const;
/** The GM board's line of a hunter's feats: how many it earned and the newest by name. */
export function boardLine(c: Pick<Chronicle, 'feats'>): string {
  const earned = Object.values(c.feats).flatMap(st => (st.at === 'earned' ? [st] : [])).sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0));
  const newest = earned[0];
  if (!newest) return `${CHRONICLE_WORDS.title}: no feats yet`;
  return earned.length === 1 ? `${CHRONICLE_WORDS.title}: 1 feat, ${newest.name}` : `${CHRONICLE_WORDS.title}: ${n(earned.length)} feats, newest ${newest.name}`;
}
/** The GM's switch for every feat, its words, and the session log's line when it moves. */
export const FEATS_SWITCH_WORDS = {
  label: 'The System notices feats', on: 'On', off: 'Off',
  hint: 'While this is off, no hunter at this table earns a feat and nothing counts toward one. Earned feats stay.',
  logTitle: 'Feats', logLine: (on: boolean): string => `Feats turned ${on ? 'on' : 'off'} for the table.`,
  workshopOff: 'Feats are turned off for the table. Turn them on in the GM view, under Rules editor.',
} as const;
