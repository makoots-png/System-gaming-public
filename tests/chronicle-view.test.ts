// What the System remembers of a hunter, as a screen reads it (src/core/hunter/chronicle-view.ts): a sentence for every
// kind of fact, the Chronicle panel as data, the GM board's line. Each expected sentence is written by hand from the
// fact above it.
import { describe, expect, test } from 'bun:test';
import { RULES, rulesOf } from '../src/core/rules.ts';
import { dayKey, parseDayKey } from '../src/core/day.ts';
import { newChronicle, pushedChronicle } from '../src/core/hunter/chronicle.ts';
import type { Chronicle, FeatState } from '../src/core/hunter/chronicle.ts';
import { FACT_FIELDS, FACT_KINDS, parseFact } from '../src/core/hunter/facts.ts';
import type { Fact, FactKind, FactOf, Kept } from '../src/core/hunter/facts.ts';
import { CHRONICLE_WORDS, FACT_LINES, FEATS_SWITCH_WORDS, FIRST, SEEN_SHEETS_MAX, boardLine, chronicleView, factLine, factWhen, featsSeen } from '../src/core/hunter/chronicle-view.ts';
import { featsFor } from '../src/core/hunter/feats.ts';
import type { FeatBook } from '../src/core/hunter/feats.ts';
import { BUILT_IN_FEATS } from '../src/core/registry/feats.ts';

const FIGHT: FactOf<'fight'> = {
  kind: 'fight', outcome: 'won', rounds: 6, up: true, downs: 0, low: 12, endPct: 12, exactOne: false, struck: 4, hits: 5, crits: 1, critRun: 1, avoided: 0, dealt: 60, taken: 40,
  healed: 0, hexes: 0, kills: 2, bosses: 0, turnKills: 1, items: 0, allies: 1, alliesDown: 0, sideUp: 2, foes: 3, foeTop: 0, bossTop: null, gate: 'Goblin Den', names: '3 Goblins',
};
const SOLO: FactOf<'solo'> = { kind: 'solo', outcome: 'won', name: 'Ash Hollow', rank: 'E', above: 0, rounds: 5, endPct: 30, life: 'up', personal: true };
const LIFE: FactOf<'life'> = { kind: 'life', news: 'died', how: 'fight' };
const QUEST: FactOf<'quest'> = { kind: 'quest', end: 'done', qkind: 'side', from: 'gm', title: 'Find it' };

/** One fact of each kind, and the sentence it reads as. A kind added to facts.ts fails the typecheck here until it has both. */
const SAMPLES: { readonly [K in FactKind]: readonly [FactOf<K>, string] } = {
  fight: [FIGHT, 'Won a fight in Goblin Den against 3 Goblins in 6 rounds, at 12% HP.'],
  kill: [{ kind: 'kill', monster: 'Goblin Chief', rank: 'D', type: 'Goblin', mkind: 'boss', above: 1, hpPct: 40, payback: false, where: 'fight' }, 'Defeated Goblin Chief, a rank D boss, at 40% HP.'],
  solo: [SOLO, 'Won a solo run in Ash Hollow (rank E) in 5 rounds, at 30% HP.'],
  gate: [{ kind: 'gate', name: 'Goblin Den', rank: 'D', above: 1, toBreak: 2 }, 'Cleared Goblin Den, a rank D gate, 2 days before its break.'],
  closed: [{ kind: 'closed', name: 'Ash Hollow', rank: 'E' }, 'The personal gate Ash Hollow (rank E) closed when its time ran out.'],
  quest: [QUEST, 'Completed the side quest Find it.'],
  daily: [{ kind: 'daily', streak: 7 }, 'Finished the day\'s daily quests, 7 days in a row.'],
  streakLost: [{ kind: 'streakLost', streak: 7 }, 'Lost a daily streak of 7 days.'],
  penaltyIssued: [{ kind: 'penaltyIssued', days: 2 }, 'Got the daily penalty for 2 missed days.'],
  penaltyLifted: [{ kind: 'penaltyLifted', days: 2 }, 'The daily penalty ended after 2 days.'],
  life: [LIFE, 'Died in a fight.'],
  level: [{ kind: 'level', level: 5 }, 'Reached level 5.'],
  rank: [{ kind: 'rank', rank: 'C' }, 'Became rank C.'],
  title: [{ kind: 'title', name: 'Still Standing' }, 'Got the title Still Standing.'],
  feat: [{ kind: 'feat', key: 'threads-end', name: 'Thread\'s End', hidden: true }, 'Earned the hidden feat Thread\'s End.'],
  given: [{ kind: 'given', key: 'seed-held-the-mask', name: 'Held the Mask' }, 'The GM gave the award Held the Mask.'],
  chapter: [{ kind: 'chapter', title: 'THE DEEP IS PATIENT', line: 'Nothing is asked.' }, 'A story window: THE DEEP IS PATIENT. Nothing is asked.'],
  roll: [{ kind: 'roll', natural: 20 }, 'Rolled a natural 20 on a check.'],
  coin: [{ kind: 'coin', won: true }, 'Called the coin right.'],
  shop: [{ kind: 'shop', act: 'buy', item: 'Health Potion', rar: 'common', price: 40, goldAfter: 110 }, 'Bought Health Potion for 40 gold, with 110 gold left.'],
  rest: [{ kind: 'rest', long: true }, 'Took a long rest.'],
  used: [{ kind: 'used', item: 'Health Potion', rar: 'common' }, 'Used Health Potion.'],
  shadow: [{ kind: 'shadow', name: 'Wolf' }, 'The shadow Wolf joined the army.'],
};

describe('one sentence a kind of fact', () => {
  test('every kind of fact the System records has a line, and its sample is a fact the reader takes', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...FACT_KINDS].sort());
    expect(Object.keys(FACT_LINES).sort()).toEqual(Object.keys(FACT_FIELDS).sort());
    for (const kind of FACT_KINDS) {
      const [fact, line] = SAMPLES[kind] as readonly [Fact, string];
      expect(parseFact(fact), `${kind}: the sample is a whole fact`).toEqual(fact);
      expect(factLine(fact), kind).toBe(line);
    }
  });

  test('a fight says how it ended, where, against whom, in how many rounds and at what HP', () => {
    expect(factLine({ ...FIGHT, outcome: 'lost', gate: '', names: 'Hobgoblin', rounds: 4, up: false, endPct: 0 })).toBe('Lost a fight against Hobgoblin in 4 rounds, down at the end.');
    expect(factLine({ ...FIGHT, outcome: 'ended', gate: '', names: '2 Wolves', rounds: 3, endPct: 80 })).toBe('The GM ended a fight against 2 Wolves after 3 rounds, at 80% HP.');
    expect(factLine({ ...FIGHT, gate: '', names: '', rounds: 1, endPct: 100 }), 'no gate and no names, one round').toBe('Won a fight in 1 round, at 100% HP.');
  });

  test('a solo run says its gate, its rounds and how the hunter came out of it', () => {
    expect(factLine({ ...SOLO, outcome: 'lost', life: 'up' })).toBe('Lost a solo run in Ash Hollow (rank E) in 5 rounds and was up at its end.');
    expect(factLine({ ...SOLO, outcome: 'lost', life: 'dead' })).toBe('Lost a solo run in Ash Hollow (rank E) in 5 rounds and died.');
    expect(factLine({ ...SOLO, outcome: 'stalled', rounds: 30 })).toBe('Retreated from a solo run in Ash Hollow (rank E) after 30 rounds, at 30% HP.');
  });

  test('a change of life says what happened and how', () => {
    const life = (o: Partial<FactOf<'life'>>) => factLine({ ...LIFE, ...o });
    expect(life({ news: 'raised', how: 'gm' })).toBe('Revived by the GM.');
    expect(life({ news: 'raised', how: 'item' })).toBe('Revived with an item.');
    expect(life({ news: 'died', how: 'hand' })).toBe('Died after a change by hand.');
    expect(life({ news: 'died', how: 'fight' })).toBe('Died in a fight.');
  });

  test('the other kinds in their other forms: one of a thing is singular, a cost and a failure are said', () => {
    expect(factLine({ kind: 'gate', name: 'Ash Hollow', rank: 'E', above: 0, toBreak: null })).toBe('Cleared Ash Hollow, a rank E gate.');
    expect(factLine({ kind: 'gate', name: 'Goblin Den', rank: 'D', above: 1, toBreak: 1 })).toBe('Cleared Goblin Den, a rank D gate, 1 day before its break.');
    expect(factLine({ ...QUEST, end: 'failed', qkind: 'urgent', title: 'Hold the door' })).toBe('Failed the urgent quest Hold the door.');
    expect(factLine({ ...QUEST, qkind: 'job', title: 'Step 1' })).toBe('Completed the Job Change quest Step 1.');
    expect(factLine({ kind: 'daily', streak: 1 })).toBe('Finished the day\'s daily quests, 1 day in a row.');
    expect(factLine({ kind: 'penaltyIssued', days: 1 })).toBe('Got the daily penalty for 1 missed day.');
    expect(factLine({ kind: 'kill', monster: 'Rat', rank: 'E', type: 'Beast', mkind: 'normal', above: 0, hpPct: 100, payback: false, where: 'solo' })).toBe('Defeated Rat, a rank E monster, at 100% HP.');
    expect(factLine({ kind: 'feat', key: 'uphill', name: 'Uphill', hidden: false })).toBe('Earned the feat Uphill.');
    expect(factLine({ kind: 'chapter', title: 'IT WILL REMEMBER YOUR FACE', line: '' }), 'a window with no line').toBe('A story window: IT WILL REMEMBER YOUR FACE.');
    expect(factLine({ kind: 'coin', won: false })).toBe('Called the coin wrong.');
    expect(factLine({ kind: 'shop', act: 'sell', item: 'Iron Sword', rar: 'common', price: 60, goldAfter: 1170 })).toBe('Sold Iron Sword for 60 gold, with 1,170 gold left.');
    expect(factLine({ kind: 'rest', long: false })).toBe('Took a short rest.');
  });

  test('no line is written for effect: no dash, no semicolon, no exclamation mark, and each ends as a sentence', () => {
    const lines = [...FACT_KINDS.map(k => factLine((SAMPLES[k] as readonly [Fact, string])[0])), ...Object.values(CHRONICLE_WORDS).filter(w => typeof w === 'string'), FEATS_SWITCH_WORDS.hint, FEATS_SWITCH_WORDS.workshopOff, FEATS_SWITCH_WORDS.logLine(true), FEATS_SWITCH_WORDS.logLine(false)];
    for (const l of lines) expect(l, l).not.toMatch(/[—–;!]| - /);
    for (const k of FACT_KINDS) expect(factLine((SAMPLES[k] as readonly [Fact, string])[0]), k).toMatch(/^[A-Z].*\.$/);
  });

  test('a fact is dated by its session once the GM has started one, else by its day', () => {
    const day = dayKey(new Date('2026-11-19T12:00:00.000Z'), 0);
    expect(factWhen({ session: 4, day })).toBe('Session 4');
    expect(factWhen({ session: 0, day })).toBe(String(day));
  });
});

describe('the Chronicle panel as data', () => {
  const DAY = dayKey(new Date('2026-11-19T12:00:00.000Z'), 0);
  const at = (i: number): string => new Date(Date.parse('2026-11-01T10:00:00.000Z') + i * 3_600_000).toISOString();
  const keptAt = (f: Fact, i: number, session = 3): Kept => ({ ...f, at: at(i), day: DAY, session });
  const earned = (i: number, name: string): FeatState => ({ at: 'earned', on: at(i), day: parseDayKey('2026-11-01')!, name });
  const shown = (n: number): FeatState => ({ at: 'shown', n, seen: [] } as unknown as FeatState);
  const BOOK: FeatBook = featsFor(RULES, BUILT_IN_FEATS, {});
  const def = (key: string) => BOOK.find(([k]) => k === key)![1];
  /** Forty kept facts, the oldest first: levels 2 to 41. */
  const FORTY: Kept[] = Array.from({ length: 40 }, (_, i) => keptAt({ kind: 'level', level: i + 2 }, i));
  const mira = (o: Partial<Chronicle> = {}): Chronicle => ({ ...newChronicle(), ...o });

  test('the lifetime numbers are the tally\'s, in the order the panel shows them', () => {
    const c = mira({ tally: { ...newChronicle().tally, won: 12, kills: 48, gates: 5, died: 3, feats: 7, fights: 20 } });
    expect(chronicleView(c, BOOK, RULES).numbers).toEqual([
      { label: 'Fights won', n: 12 }, { label: 'Monsters defeated', n: 48 }, { label: 'Gates cleared', n: 5 }, { label: 'Deaths', n: 3 }, { label: 'Feats', n: 7 },
    ]);
  });

  test('a hunter with 40 kept facts: the newest is first, each with its session and its sentence', () => {
    const v = chronicleView(mira({ facts: FORTY }), BOOK, RULES);
    expect(v.facts).toHaveLength(40);
    expect(v.facts.slice(0, 2)).toEqual([{ when: 'Session 3', line: 'Reached level 41.' }, { when: 'Session 3', line: 'Reached level 40.' }]);
    expect(v.facts.at(-1)).toEqual({ when: 'Session 3', line: 'Reached level 2.' });
    expect(CHRONICLE_WORDS.showAll(chronicleView(mira({ facts: FORTY }), [], RULES)), 'with no feat in progress, only the entries are named').toBe('Show all: 40 entries');
  });

  test('earned feats are newest first, each with its description, its date and what it gave; a hidden one is marked', () => {
    const c = mira({ feats: { uphill: earned(1, 'Uphill'), 'threads-end': earned(5, 'Thread\'s End') } });
    const v = chronicleView(c, BOOK, RULES);
    expect(v.earned).toEqual([
      { key: 'threads-end', name: 'Thread\'s End', hidden: true, desc: 'A fight won with 5% of max HP or less left, without going down in it.', when: 'Earned 2026-11-01.', gave: ['Title acquired: Still Standing'] },
      { key: 'uphill', name: 'Uphill', hidden: false, desc: 'A monster above your rank, defeated.', when: 'Earned 2026-11-01.', gave: ['+1 ability point'] },
    ]);
  });

  test('a feat earned and since deleted still reads, by the name it was earned under; its fact says whether it was hidden', () => {
    const c = mira({ feats: { 'gone-feat': earned(2, 'Old Glory') }, facts: [keptAt({ kind: 'feat', key: 'gone-feat', name: 'Old Glory', hidden: true }, 2)] });
    expect(chronicleView(c, BOOK, RULES).earned).toEqual([{ key: 'gone-feat', name: 'Old Glory', hidden: true, desc: '', when: 'Earned 2026-11-01.', gave: [] }]);
    expect(chronicleView({ ...c, facts: [] }, BOOK, RULES).earned[0]!.hidden, 'the fact has left the chronicle, so nothing says it was hidden').toBe(false);
  });

  test('feats in progress are the shown ones, the closest to done first; a hidden feat not earned is left out', () => {
    // Ratcatcher needs 50, Red Ledger 10, Sharp Eye 100: 25 of 50 is half, 9 of 10 is nine tenths, 10 of 100 is a tenth
    const c = mira({ feats: { ratcatcher: shown(25), 'red-ledger': shown(9), 'sharp-eye': shown(10) } });
    const v = chronicleView(c, BOOK, RULES);
    expect(v.shown.slice(0, 3)).toEqual([
      { key: 'red-ledger', name: 'Red Ledger', desc: 'Ten bosses defeated.', progress: 'Monsters defeated: 9 of 10.' },
      { key: 'ratcatcher', name: 'Ratcatcher', desc: 'Fifty E-rank monsters defeated.', progress: 'Monsters defeated: 25 of 50.' },
      { key: 'sharp-eye', name: 'Sharp Eye', desc: 'A hundred critical hits landed.', progress: 'Crits: 10 of 100.' },
    ]);
    const startShown = BOOK.filter(([, d]) => d.show.at === 'start').map(([k]) => k);
    expect(v.shown.map(s => s.key).sort(), 'every feat shown from the start is listed, at 0 too').toEqual([...startShown].sort());
    expect(def('threads-end').show.at).toBe('never');
    expect(v.shown.some(s => s.key === 'threads-end')).toBe(false);
    expect(v.earned).toEqual([]);
  });

  test('with the GM\'s switch off nothing is in progress and earned feats stay', () => {
    const off = rulesOf({ feats: { on: false } });
    const v = chronicleView(mira({ feats: { uphill: earned(1, 'Uphill'), ratcatcher: shown(25) } }), featsFor(off, BUILT_IN_FEATS, {}), off);
    expect([v.featsOff, v.shown, v.earned.map(e => e.name)]).toEqual([true, [], ['Uphill']]);
    expect(chronicleView(mira(), BOOK, RULES).featsOff).toBe(false);
  });

  test('the GM reads a player\'s pushed sheet: its numbers, its earned feats and its last 8 entries, and no feat in progress', () => {
    const whole = mira({ facts: FORTY, tally: { ...newChronicle().tally, won: 4 }, feats: { uphill: earned(1, 'Uphill'), ratcatcher: shown(25) } });
    const v = chronicleView(pushedChronicle(whole), BOOK, RULES, 'push');
    expect(v.facts.map(f => f.line)).toEqual([41, 40, 39, 38, 37, 36, 35, 34].map(l => `Reached level ${l}.`));
    expect(v.earned.map(e => e.name)).toEqual(['Uphill']);
    expect(v.numbers[0]).toEqual({ label: 'Fights won', n: 4 });
    expect(v.shown, 'a count does not travel, and 0 of 50 would be false').toEqual([]);
    expect(chronicleView(whole, BOOK, RULES).shown.find(s => s.key === 'ratcatcher')?.progress, 'the hunter\'s own phone has the count').toBe('Monsters defeated: 25 of 50.');
  });

  test('the Show all button names each list that holds more than the panel shows first, and is not there when none does', () => {
    const feats = Object.fromEntries(['a', 'b', 'c', 'd'].map((k, i) => [`own-${k}`, earned(i, `Feat ${k}`)]));
    const v = chronicleView(mira({ facts: FORTY.slice(0, 6), feats }), BOOK, RULES);
    expect(v.shown.length).toBeGreaterThan(FIRST.shown);
    expect(CHRONICLE_WORDS.showAll(v)).toBe(`Show all: 4 feats, ${v.shown.length} in progress, 6 entries`);
    expect(CHRONICLE_WORDS.showAll(chronicleView(mira({ facts: FORTY.slice(0, 5) }), [], RULES))).toBe('');
  });

  test('the GM board\'s line counts a hunter\'s feats and names the newest', () => {
    expect(boardLine(mira())).toBe('Chronicle: no feats yet');
    expect(boardLine(mira({ feats: { uphill: earned(1, 'Uphill'), ratcatcher: shown(25) } }))).toBe('Chronicle: 1 feat, Uphill');
    const seven = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`f${i}`, earned(i, i === 6 ? 'Thread\'s End' : `Feat ${i}`)]));
    expect(boardLine(mira({ feats: seven }))).toBe('Chronicle: 7 feats, newest Thread\'s End');
  });
});

describe('the GM\'s news of a feat a player earned', () => {
  const won = (name: string): FeatState => ({ at: 'earned', on: '2026-11-19T10:00:00.000Z', day: parseDayKey('2026-11-19')!, name });
  const mira = (feats: Record<string, FeatState>) => ({ key: 'dev-a:h1', name: 'Mira', feats });
  test('a sheet seen for the first time tells nothing, however many feats it shows earned', () => {
    const r = featsSeen({}, [mira({ 'threads-end': won('Thread\'s End'), uphill: won('Uphill'), ratcatcher: { at: 'shown', n: 3, mark: '' } })]);
    expect(r.told).toEqual([]);
    expect(r.seen).toEqual({ 'dev-a:h1': ['threads-end', 'uphill'] });
    expect(featsSeen('not a memory', [mira({ uphill: won('Uphill') })]).told, 'a memory that does not read is a first sight').toEqual([]);
  });
  test('a feat the sheet shows earned after it was seen is told once, by the hunter\'s name and the feat\'s', () => {
    const first = featsSeen({}, [mira({ uphill: won('Uphill') })]);
    const next = featsSeen(first.seen, [mira({ uphill: won('Uphill'), 'threads-end': won('Thread\'s End') })]);
    expect(next.told).toEqual([{ key: 'dev-a:h1', feat: 'threads-end', line: 'Mira earned the feat Thread\'s End.' }]);
    expect(featsSeen(next.seen, [mira({ uphill: won('Uphill'), 'threads-end': won('Thread\'s End') })]).told).toEqual([]);
  });
  test('a sheet missing from one poll keeps what was seen of it, so a feat it earned meanwhile is told when it is back (SMX-gates-6.2)', () => {
    const first = featsSeen({}, [mira({ uphill: won('Uphill') })]);
    const gone = featsSeen(first.seen, []);
    expect(gone.seen).toEqual({ 'dev-a:h1': ['uphill'] });
    expect(featsSeen(gone.seen, [mira({ uphill: won('Uphill'), x: won('X') })]).told).toEqual([{ key: 'dev-a:h1', feat: 'x', line: 'Mira earned the feat X.' }]);
  });
  test('the memory holds at most SEEN_SHEETS_MAX sheets: the ones in the room first, then the newest of those away', () => {
    const away = Object.fromEntries(Array.from({ length: SEEN_SHEETS_MAX }, (_, i) => [`dev-${String(i).padStart(3, '0')}:h1`, []]));
    const r = featsSeen(away, [mira({ uphill: won('Uphill') })]);
    expect(Object.keys(r.seen)).toHaveLength(SEEN_SHEETS_MAX);
    expect(Object.keys(r.seen)[0]).toBe('dev-a:h1');
    expect(Object.keys(r.seen).at(-1)).toBe(`dev-${String(SEEN_SHEETS_MAX - 2).padStart(3, '0')}:h1`);
  });
});
