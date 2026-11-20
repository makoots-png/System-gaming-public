// The odds engine (src/core/combat/odds.ts): a fight played to its end many times on the real reducer, every row on the
// general policy (policy.ts `sensible`), answered as the party's odds. The expected values come from the rule: a party
// that cannot lose wins nearly every run, one that cannot win nearly none, a fight nobody can hurt is a stalemate in
// every run, and the same inputs answer the same odds.
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { fightId, reduce } from '../src/core/combat/fight.ts';
import type { Fight, NewRow, Running, Setup } from '../src/core/combat/fight.ts';
import { IDLE, ODDS_EVENTS, ODDS_STATES, TABLE, oddsDetail, oddsKey, oddsLine, oddsStep, progressOf, readOdds, weighable } from '../src/core/combat/odds.ts';
import type { Odds, OddsRun, RowEnd, RunEnd } from '../src/core/combat/odds.ts';
import { playBegin, playOver, playStep } from '../src/core/combat/play.ts';
import type { Play } from '../src/core/combat/play.ts';
import { sensible } from '../src/core/combat/policy.ts';
import { hunter, monster } from './models/fight-sim.ts';
import { GRID, ROSTER, ctx, randomCommand, rng } from './models/fight-play.ts';
import { atHp } from './fixtures/life.ts';

const setupOf = (rows: readonly NewRow[], grid = undefined as typeof GRID | undefined): Setup => {
  const r = reduce(null, { type: 'add', fightId: fightId('f-odds'), rows, openings: [], ...(grid ? { grid } : {}) }, ctx);
  if (r.fight?.phase !== 'setup') throw new Error('no setup');
  return r.fight;
};
/** The whole run at once: asked, then stepped until it answers. */
function oddsOf(f: Setup | Running, seed: number, of: number): Odds {
  let run: OddsRun = oddsStep(IDLE, { type: 'ask', fight: f, seed, of }, RULES);
  for (let i = 0; run.state === 'running' && i < 1_000_000; i++) run = oddsStep(run, { type: 'step', commands: 50 }, RULES);
  if (run.state !== 'done') throw new Error(`the run did not answer: ${run.state}`);
  return run.odds;
}
const plain = (rows: readonly NewRow[]): NewRow[] => rows.map(r => ({ ...r }));
/** One played fight's end for a lone row `a`, written by hand: fatigue 5 and up unless the parts say otherwise. */
const end = (outcome: RunEnd['outcome'], rounds: number, row: Partial<RowEnd>): RunEnd => ({
  outcome, rounds, commands: 0, spent: [],
  party: { ['a' as never]: { hp: 0, mana: 0, fatigue: 5, statuses: [], used: {}, down: false, saves: [], life: 'up', ...row } },
});
const small = (): Setup => setupOf(plain([hunter('tank', 'C').row, hunter('cannon', 'C').row,
  monster('C', 'brute', 'normal', 'm1').row, monster('C', 'skirmisher', 'normal', 'm2').row, monster('C', 'caster', 'normal', 'm3').row]));

describe('the odds of a fight', () => {
  test('the same fight, rules, seed and count answer the same odds', () => {
    const f = small();
    expect(oddsOf(f, 7, 12)).toEqual(oddsOf(f, 7, 12));
    expect(oddsOf(f, 7, 12)).not.toEqual(oddsOf(f, 8, 12));
  });

  test('a party that cannot lose wins nearly every run', () => {
    const f = setupOf(plain([hunter('bruiser', 'S', 'a').row, hunter('tank', 'S', 'b').row, monster('E', 'brute', 'normal', 'm').row]));
    const r = readOdds(oddsOf(f, 1, 40));
    expect(r.won).toBeGreaterThanOrEqual(0.95);
    expect(r.party.every(p => p.down === 0)).toBe(true);
  });

  test('a party that cannot win wins nearly no run', () => {
    const f = setupOf(plain([hunter('cannon', 'E', 'a').row, monster('S', 'brute', 'boss', 'b1').row, monster('S', 'brute', 'boss', 'b2').row]));
    const r = readOdds(oddsOf(f, 2, 40));
    expect(r.won).toBeLessThanOrEqual(0.05);
    expect(r.party[0]!.down).toBeGreaterThanOrEqual(0.95);
  });

  test('a fight nobody can hurt ends at the cap as a stalemate, never a win or a loss', () => {
    const f = setupOf(plain([{ ...hunter('tank', 'C', 'a').row, abilities: [] }, { ...monster('C', 'brute', 'normal', 'm').row, abilities: [] }]));
    const r = readOdds(oddsOf(f, 3, 5));
    expect([r.stalled, r.won, r.lost]).toEqual([1, 0, 0]);
    expect(r.rounds.mid).toBeGreaterThanOrEqual(40);
    expect(oddsDetail(r, 'party')).toContain('No winner by round 40 in 100%.');
  });

  test('a fight already running is played from where it stands', () => {
    let f: Fight = small();
    f = reduce(f, { type: 'start', openings: f.rows.map((r, i) => ({ id: r.id, d20: 10, tie: i })) }, ctx).fight!;
    expect(f.phase).toBe('running');
    const odds = oddsOf(f as Running, 4, 6);
    expect(odds.ends.length).toBe(6);
    expect(odds.rows.map(r => r.id)).toEqual(['tank', 'cannon'] as never);
  });

  test('the line says the chance, who goes down most and the rounds; the detail each hunter\'s end', () => {
    const r = readOdds({
      of: 4, rows: [{ id: 'a' as never, name: 'Mira', hpMax: 40, manaMax: 20, fatigueMax: 100 }],
      ends: [
        end('won', 5, { hp: 30, mana: 10 }),
        end('won', 5.5, { hp: 20, mana: 8 }),
        end('won', 6.25, { hp: 10, mana: 6 }),
        end('lost', 7, { hp: 0, mana: 0, down: true, saves: [5, 3, 2], life: 'dead' }),
      ],
    });
    expect(oddsLine(r, 'party')).toBe('The party wins 75% of 4 fights. Mira is most likely to go down (25%). About 6 rounds.');
    expect(oddsDetail(r, 'party')).toEqual([
      'Rounds: 5 to 7, most often about 6.',
      'The party loses 25%.',
      'Mira: down in 25%, dead in 25%. Ends with 0 to 30 of 40 HP, 0 to 10 of 20 mana, 5 of 100 fatigue.',
    ]);
  });

  test('a hunter alone reads the same numbers as its own chance: to clear, to go down and to die, never "the party"', () => {
    const r = readOdds({
      of: 4, rows: [{ id: 'a' as never, name: 'Mira', hpMax: 40, manaMax: 20, fatigueMax: 100 }],
      ends: [
        end('won', 5, { hp: 30, mana: 10 }),
        end('lost', 7, { hp: 0, mana: 0, down: true, saves: [5, 3, 2], life: 'dead' }),
        end('lost', 7, { hp: 0, mana: 0, down: true, saves: [15, 13, 12], life: 'stable' }),
        end('lost', 7, { hp: 0, mana: 0, down: true, saves: [20], life: 'up' }),
      ],
    });
    expect(oddsLine(r, 'alone')).toBe('You clear it in 25% of 4 plays. Down in 75%, dead in 25%. About 7 rounds.');
    expect(oddsDetail(r, 'alone')[1]).toBe('The run fails in 75%.');
    expect([oddsLine(r, 'alone'), ...oddsDetail(r, 'alone')].join(' ')).not.toContain('party');
    const never = readOdds({ of: 1, rows: r.party, ends: [end('won', 3, { hp: 30, mana: 20 })] });
    expect(oddsLine(never, 'alone')).toBe('You clear it in 100% of 1 plays. Never down in these plays. About 3 rounds.');
  });
});

describe('who dies after a played fight (lead-look-6-odds.md, finding 1)', () => {
  // A table stabilizes a downed hunter when the party won and an ally stands; alone, or when the fight is lost, nobody
  // can, and the death saves run to their end (notes-2-solo.md 1.1).
  test('a won fight leaves a downed hunter down and not dead while another hunter stands', () => {
    const f = setupOf(plain([hunter('bruiser', 'S', 'a').row, atHp(hunter('tank', 'E', 'b').row, 0), monster('E', 'brute', 'normal', 'm').row]));
    const odds = oddsOf(f, 11, 40), b = 'b' as never;
    expect(odds.ends.filter(e => e.outcome === 'won').length).toBeGreaterThanOrEqual(38);
    for (const e of odds.ends.filter(x => x.outcome === 'won')) expect([e.party[b]!.down, e.party[b]!.saves, e.party[b]!.life]).toEqual([true, [], 'dying']);
    expect(readOdds(odds).party.find(p => p.id === b)!.dead).toBe(0);
  });

  test('alone, a downed hunter\'s death saves run to their end', () => {
    const f = setupOf(plain([hunter('cannon', 'E', 'a').row, monster('S', 'brute', 'boss', 'b1').row, monster('S', 'brute', 'boss', 'b2').row]));
    const ends = oddsOf(f, 2, 40).ends.map(e => e.party['a' as never]!).filter(e => e.down && e.hp === 0);
    expect(ends.length).toBeGreaterThanOrEqual(38);
    for (const e of ends) {
      expect(e.saves.length).toBeGreaterThanOrEqual(1);
      expect(['stable', 'dead', 'up']).toContain(e.life);
    }
    expect(ends.some(e => e.life === 'dead')).toBe(true);
  });
});

describe('what a played fight spends (lead-look-6-odds.md, findings 2 and 3)', () => {
  test('the detail gives fatigue of its capacity, as the sheet does', () => {
    const r = readOdds({ of: 1, rows: [{ id: 'a' as never, name: 'Mira', hpMax: 40, manaMax: 20, fatigueMax: 60 }], ends: [end('won', 3, { hp: 30, mana: 20, fatigue: 30 })] });
    expect(oddsDetail(r, 'party').at(-1)).toBe('Mira: never down. Ends with 30 of 40 HP, 20 of 20 mana, 30 of 60 fatigue.');
  });

  // The starters hold no ability that costs mana (only the blast kind does), so their mana stays full; a hunter that
  // holds a blast spends it.
  test('a hunter holding a blast ends a fight it used it in with less mana', () => {
    const f = setupOf(plain([hunter('cannon', 'C', 'a').row, monster('C', 'brute', 'normal', 'm1').row, monster('C', 'brute', 'normal', 'm2').row, monster('C', 'brute', 'normal', 'm3').row]));
    const r = readOdds(oddsOf(f, 9, 20)), a = r.party[0]!;
    expect(a.mana.low).toBeLessThan(a.manaMax);
  });

  test('a single play counts its moves and its round as it goes', () => {
    let run = oddsStep(IDLE, { type: 'ask', fight: small(), seed: 3, of: 1 }, RULES);
    const counts: number[] = [];
    while (run.state === 'running') { const p = progressOf(run, RULES)!; counts.push(p.commands); expect(p.of).toBe(1); run = oddsStep(run, { type: 'step', commands: 1 }, RULES); }
    expect(run.state).toBe('done');
    const moves = counts.filter((c, i) => i === 0 || c !== counts[i - 1]);
    expect(moves.slice(0, 3)).toEqual([0, 1, 2]);
    expect(run.state === 'done' && run.odds.ends[0]!.commands).toBe(Math.max(...counts));
  });
});

describe('a run of the engine', () => {
  test('every state answers every event in the table', () => {
    for (const s of ODDS_STATES) for (const e of ODDS_EVENTS) expect(TABLE[s][e] === null || typeof TABLE[s][e] === 'function').toBe(true);
  });

  test('a run counts its fights as it goes, then answers', () => {
    const f = small();
    let run = oddsStep(IDLE, { type: 'ask', fight: f, seed: 5, of: 3 }, RULES);
    expect(progressOf(run, RULES)).toEqual({ done: 0, of: 3, commands: 0, round: 0 });
    const seen: number[] = [];
    while (run.state === 'running') { seen.push(progressOf(run, RULES)!.done); run = oddsStep(run, { type: 'step', commands: 10 }, RULES); }
    expect(run.state).toBe('done');
    expect([...new Set(seen)]).toEqual([0, 1, 2]);
  });

  // The view's frame budget can stop only between steps, so the ask plays nothing and a fight's begin is a step of its
  // own: a cold first begin in the tap's task stacked with the first command was the odds' dropped frame (unit 6b).
  test('the ask plays nothing: each fight is begun by a step, then played a command a step', () => {
    const f = small();
    const asked = oddsStep(IDLE, { type: 'ask', fight: f, seed: 5, of: 1 }, RULES);
    expect(asked.state === 'running' && asked.play).toBe(null);
    const begun = oddsStep(asked, { type: 'step', commands: 1 }, RULES);
    expect(begun.state === 'running' && begun.play && begun.play.steps).toBe(0);
    const played = oddsStep(begun, { type: 'step', commands: 1 }, RULES);
    expect(played.state === 'running' && played.play && played.play.steps).toBe(1);
  });

  test('an answer is marked stale when the fight changes, and a run under way is dropped', () => {
    const f = small(), other = setupOf(plain([hunter('tank', 'C').row, monster('C', 'brute', 'normal', 'm1').row]));
    const done = { state: 'done', from: oddsKey(f), odds: oddsOf(f, 1, 2) } as const;
    expect(oddsStep(done, { type: 'changed', from: oddsKey(f) }, RULES)).toBe(done);
    expect(oddsStep(done, { type: 'changed', from: oddsKey(other) }, RULES)).toEqual({ state: 'stale', odds: done.odds });
    const running = oddsStep(IDLE, { type: 'ask', fight: f, seed: 1, of: 2 }, RULES);
    expect(oddsStep(running, { type: 'changed', from: oddsKey(f) }, RULES)).toBe(running);
    expect(oddsStep(running, { type: 'changed', from: oddsKey(other) }, RULES)).toEqual(IDLE);
    expect(oddsStep(running, { type: 'cancel' }, RULES)).toEqual(IDLE);
  });

  test('a fight with nobody on one side is not weighed', () => {
    expect(weighable(setupOf(plain([hunter('tank', 'C').row])))).toBe(false);
    expect(weighable(small())).toBe(true);
    expect(weighable(null)).toBe(false);
  });
});

describe('the general policy', () => {
  // Random fights with the kits (tests/models/fight-play.ts' roster on its walled map): a random side of each, some
  // random commands first so statuses, zones, stacks and channels are under way, then played out on `sensible`.
  // play.ts throws on any refusal, so a run that ends is a run in which the policy chose nothing the reducer refused.
  // One test per seed, as tests/fight-sim.test.ts does per row: all 120 fights in one test outran bun's 5 s timer on a
  // two-core runner (the public repository's unit job, Nov 20), and a failure now names its seed.
  const SEEDS = Array.from({ length: 120 }, (_, i) => i + 1);
  const walked = (seed: number): Fight | null => {
    const g = rng(seed);
    const party = ROSTER.filter(r => r.side === 'party' && g.chance(0.6)), foes = ROSTER.filter(r => r.side === 'foe' && g.chance(0.6));
    const rows = [...(party.length ? party : [ROSTER[0]!]), ...(foes.length ? foes : [ROSTER[4]!])];
    let f: Fight | null = reduce(null, { type: 'add', fightId: fightId('f-walk'), rows, openings: [], grid: GRID }, ctx).fight;
    let n = 0;
    for (let i = 0; i < g.int(0, 30); i++) {
      const r = reduce(f, randomCommand(g, f, () => `x${n++}`), ctx);
      if (!r.effects.some(e => e.type === 'refused') && r.fight && (r.fight.phase === 'setup' || r.fight.phase === 'running')) f = r.fight;
    }
    return f;
  };
  test('at least 100 of the random fights can be played to their end', () => {
    expect(SEEDS.filter(seed => weighable(walked(seed))).length).toBeGreaterThanOrEqual(100);
  });
  for (const seed of SEEDS) test(`never chooses what the reducer refuses, in the random fight of seed ${seed}`, () => {
    const f = walked(seed);
    if (!weighable(f)) return;
    let p: Play = playBegin(f, seed, RULES).play;
    for (let k = 0; !playOver(p) && k < 6000; k++) p = playStep(p as Play & { readonly fight: Running }, () => sensible, { capRounds: 40, endAtRounds: null }, RULES).play;
    expect(playOver(p)).toBe(true);
  });
});

describe('the odds change nothing', () => {
  // The engine answers numbers only: it imports no module that writes a save, sends a room message or keeps a fight
  // anyone plays, and core imports nothing from the edge or the views (tests/lint.test.ts), so it cannot reach storage.
  test('the engine, its loop and its policy import nothing that writes', async () => {
    const writes = /from '[^']*(save-step|fight-save|save|store|sync\/|protocol|outbox|session-log)(\.ts)?'/;
    for (const file of ['odds.ts', 'play.ts', 'policy.ts']) {
      const text = await Bun.file(`${import.meta.dir}/../src/core/combat/${file}`).text();
      expect(text.split('\n').filter(l => l.startsWith('import') && writes.test(l)), file).toEqual([]);
    }
    expect(writes.test("import { fought } from './fight-save.ts';"), 'the rule sees a writer').toBe(true);
  });
});
