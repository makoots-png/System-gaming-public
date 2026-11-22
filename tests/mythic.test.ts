// A mythic's standing in its script as a machine, and the readers of what follows from it (src/core/combat/mythic.ts;
// notes-11-keystones.md, design B.3 and B.4). Every expected value is read from B.3's table and from the scripts' own
// words in registry/mythics.ts: the Angel's First Breath begins at 65% of its max HP and its Note at 30%; its Trumpet
// Raised has a clock of 4 rounds and the rotation act, Weighed, act, Stars Fall; Zaratan's Dive is a clock phase of
// 4 rounds between the Shore and the Island Wakes, which begins at 55%.
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { isRefused } from '../src/core/save-step.ts';
import { baseStats } from '../src/core/stats.ts';
import { kitGear } from '../src/core/hunter/derive.ts';
import { combatantId, hunterId } from '../src/core/combat/ability-types.ts';
import type { CombatantId } from '../src/core/combat/ability-types.ts';
import type { Body, Status, StatusDef } from '../src/core/combat/effect-ops.ts';
import { statusKey } from '../src/core/combat/effect-ops.ts';
import { fightId, reduceAll } from '../src/core/combat/fight.ts';
import type { NewRow, Running } from '../src/core/combat/fight-types.ts';
import { openGrid, place } from '../src/core/combat/space.ts';
import type { Place, Side } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import type { Tick } from '../src/core/combat/timeline.ts';
import type { MoveKey, MythicMove, MythicStanding, Omen, OmenKey } from '../src/core/combat/mythic-types.ts';
import { mythicScriptOf } from '../src/core/registry/mythics.ts';
import type { MythicScriptId } from '../src/core/registry/mythics.ts';
import {
  MYTHIC_EVENTS, MYTHIC_STATES, answerBack, answerMet, beatOf, clockOut, enraged, gateOf, heldAtGate, landingMove, mythicCan, mythicStep, omenAim, phaseOver,
} from '../src/core/combat/mythic.ts';
import type { AimRow, AnswerRow, AnswerScene, MythicEvent, MythicEventType, MythicRefusal, MythicRow, MythicState } from '../src/core/combat/mythic.ts';
import { lifeAt } from './fixtures/life.ts';

const ROUND = RULES.fight.round;
const ANGEL: MythicScriptId = 'angel-of-the-last-trumpet', ZARATAN: MythicScriptId = 'zaratan-the-island-that-wakes';
const omenKey = (k: string): OmenKey => k as OmenKey;
const AIM = place(3, 3);
const calm = (script: MythicScriptId, phase: number, beat = 0, since = 0): MythicStanding => ({ at: 'calm', script, phase, beat, since: tick(since) });
const standing = (at: MythicState, script: MythicScriptId = ANGEL, phase = 0, beat = 1, since = 100): MythicStanding =>
  at === 'calm' ? calm(script, phase, beat, since) : { at, script, phase, beat, since: tick(since), omen: omenKey('stars'), aim: AIM, hpAt: 900, barAt: { fill: 20, max: 100 } };
/** A mythic row of 1000 max HP at `hp` HP. */
const row = (mythic: MythicStanding | null, hp: number, hpMax = 1000): MythicRow => ({ mythic, ...lifeAt('monster', hp), sheet: { hpMax } });

const EVENT: { readonly [T in MythicEventType]: Extract<MythicEvent, { type: T }> } = {
  next: { type: 'next', now: tick(500), by: 'gm' }, announce: { type: 'announce', omen: omenKey('weighed'), aim: combatantId('A'), hpAt: 700, barAt: { fill: 40, max: 100 } },
  beat: { type: 'beat' }, cancel: { type: 'cancel', how: 'interrupt', back: tick(30) }, weaken: { type: 'weaken', how: 'burst', back: tick(30) },
  land: { type: 'land' }, fizzle: { type: 'fizzle' }, drop: { type: 'drop' },
};

describe('the machine', () => {
  test('a mythic\'s standing as a machine: every state against every event', () => {
    // From phase 0 at beat 1, its phase begun at 100: the next phase starts at beat 0 with its clock from the event's
    // 500; an answer, a landing, a fizzle or a drop ends the omen and goes on to beat 2; a weaken keeps the omen weakened.
    // An answer (a cancel or a weaken) winds the phase's clock back by its event's 30, so the phase begun at 100 reads
    // as begun at 130 (decision 40); a landing, a fizzle and a drop leave the clock as it was.
    const nextPhase = calm(ANGEL, 1, 0, 500), onward = calm(ANGEL, 0, 2, 100), answered = calm(ANGEL, 0, 2, 130);
    const faltering: MythicStanding = { ...standing('faltering'), since: tick(130) };
    const announced: MythicStanding = { at: 'omen', script: ANGEL, phase: 0, beat: 1, since: tick(100), omen: omenKey('weighed'), aim: combatantId('A'), hpAt: 700, barAt: { fill: 40, max: 100 } };
    const EXPECTED: { readonly [S in MythicState]: { readonly [T in MythicEventType]: MythicStanding | MythicRefusal } } = {
      calm: { next: nextPhase, announce: announced, beat: onward, cancel: 'noOmen', weaken: 'noOmen', land: 'noOmen', fizzle: 'noOmen', drop: 'noOmen' },
      omen: { next: nextPhase, announce: 'omenStands', beat: 'omenStands', cancel: answered, weaken: faltering, land: onward, fizzle: onward, drop: onward },
      faltering: { next: nextPhase, announce: 'omenStands', beat: 'omenStands', cancel: answered, weaken: 'weakened', land: onward, fizzle: onward, drop: onward },
    };
    expect([...MYTHIC_STATES].sort()).toEqual(['calm', 'faltering', 'omen']);
    expect([...MYTHIC_EVENTS].sort()).toEqual(['announce', 'beat', 'cancel', 'drop', 'fizzle', 'land', 'next', 'weaken']);
    for (const s of MYTHIC_STATES) for (const type of MYTHIC_EVENTS) {
      const got = mythicStep(standing(s), EVENT[type]);
      expect([s, type, isRefused(got) ? got.why : got]).toEqual([s, type, EXPECTED[s][type]]);
      expect([s, type, mythicCan(standing(s), type)]).toEqual([s, type, !isRefused(got)]);
    }
  });

  test('next is refused in the last phase', () => {
    // The Angel's three phases: from its Note (index 2) no next leaves, by its turn or by the GM, omen or none.
    for (const at of MYTHIC_STATES) for (const by of ['turn', 'gm'] as const) {
      const got = mythicStep(standing(at, ANGEL, 2), { type: 'next', now: tick(9000), by });
      expect([at, by, isRefused(got) ? got.why : got.at]).toEqual([at, by, 'lastPhase']);
      expect(mythicCan(standing(at, ANGEL, 2), 'next')).toBe(false);
    }
    expect(mythicStep(standing('calm', ANGEL, 1), EVENT.next)).toEqual(calm(ANGEL, 2, 0, 500));
    const plain = mythicStep(calm('plain', 0), EVENT.next);
    expect(isRefused(plain) && plain.why).toBe('lastPhase');
  });

  test('a weakened omen takes no second weaken', () => {
    const weakened = mythicStep(standing('omen'), { ...EVENT.weaken, back: tick(0) });
    expect(weakened).toEqual(standing('faltering'));
    const again = mythicStep(standing('faltering'), { type: 'weaken', how: 'stagger', back: tick(0) });
    expect(isRefused(again) && again.why).toBe('weakened');
    expect(mythicCan(standing('faltering'), 'weaken')).toBe(false);
    expect(mythicStep(standing('faltering'), { type: 'cancel', how: 'stagger', back: tick(0) })).toEqual(calm(ANGEL, 0, 2, 100));
  });
});

describe('the readers', () => {
  test('a phase\'s gate is the next phase\'s start', () => {
    // The Angel at 1000 max HP: held at 650 in the Trumpet Raised, at 300 in the First Breath, never in the Note.
    expect([0, 1, 2].map(p => gateOf(row(calm(ANGEL, p), 1000)))).toEqual([650, 300, 0]);
    // A share is rounded up: 65% of 999 is 649.35, held at 650.
    expect(gateOf(row(calm(ANGEL, 0), 999, 999))).toBe(650);
    // Zaratan: the Shore's gate is the Island Wakes' 55%, past the Dive, which holds no band and begins there.
    expect([0, 1, 2].map(p => gateOf(row(calm(ZARATAN, p), 1000)))).toEqual([550, 550, 0]);
    expect(gateOf(row(null, 1000))).toBe(0);
    expect([650, 651].map(hp => heldAtGate(row(calm(ANGEL, 0), hp)))).toEqual([true, false]);
    // The Dive ends by its clock and the last phase only at 0 HP: neither is held.
    expect(heldAtGate(row(calm(ZARATAN, 1), 550))).toBe(false);
    expect(heldAtGate(row(calm(ANGEL, 2), 1))).toBe(false);
    expect(heldAtGate(row(null, 1))).toBe(false);
  });

  test('a gate phase past its clock is enraged and a clock phase is over', () => {
    const raised = calm(ANGEL, 0, 1, 2000), at = (rounds: number): Tick => tick(2000 + rounds * ROUND);
    expect([clockOut(raised, tick(at(4) - 1), RULES), enraged(raised, tick(at(4) - 1), RULES)]).toEqual([false, false]);
    expect([clockOut(raised, at(4), RULES), enraged(raised, at(4), RULES)]).toEqual([true, true]);
    // Enraged, a gate phase still ends only at its gate.
    expect(phaseOver(row(raised, 900), at(4), RULES)).toBe(false);
    expect(phaseOver(row(raised, 650), tick(2000), RULES)).toBe(true);
    const dive = calm(ZARATAN, 1, 1, 2000);
    expect([phaseOver(row(dive, 550), tick(at(4) - 1), RULES), phaseOver(row(dive, 550), at(4), RULES)]).toEqual([false, true]);
    // Before its first turn in a phase (beat 0, no omen announced) neither its gate nor its clock ends it (row B2).
    expect([phaseOver(row(calm(ANGEL, 0, 0, 2000), 650), at(9), RULES), phaseOver(row(calm(ZARATAN, 1, 0, 2000), 550), at(9), RULES)]).toEqual([false, false]);
    expect(phaseOver(row(standing('omen', ANGEL, 0, 0, 2000), 650), at(9), RULES), 'an omen announced is a turn taken').toBe(true);
    expect(enraged(dive, at(10), RULES)).toBe(false);
    expect(phaseOver(row(null, 1), at(10), RULES)).toBe(false);
  });

  test('an answer winds a gate phase\'s clock back by its rounds, never past the phase\'s start, and a clock phase\'s not at all', () => {
    // Decision 40, read from the rule: a cancel winds it back `answerTime.cancel` rounds, a weaken `answerTime.weaken`.
    const T = RULES.fight.mythic.answerTime, raised = calm(ANGEL, 0, 1, 2000), late = tick(2000 + 9 * ROUND);
    expect([answerBack(raised, 'cancel', late, RULES), answerBack(raised, 'weaken', late, RULES)]).toEqual([tick(T.cancel * ROUND), tick(T.weaken * ROUND)]);
    // Half a round into the phase, the clock is wound back to the phase's start and no further: it never holds more than its 4 rounds.
    const early = tick(2000 + ROUND / 2);
    expect(answerBack(raised, 'cancel', early, RULES)).toBe(tick(Math.min(T.cancel * ROUND, ROUND / 2)));
    // An enraged phase answered is no longer past its clock once its clock is wound back past now.
    const enragedAt = tick(2000 + 4 * ROUND), back = answerBack(raised, 'cancel', enragedAt, RULES);
    expect([enraged(raised, enragedAt, RULES), enraged({ ...raised, since: tick(raised.since + back) }, enragedAt, RULES)]).toEqual([true, T.cancel === 0]);
    // Zaratan's Dive is a clock to survive: an answer there buys no time.
    expect(answerBack(calm(ZARATAN, 1, 1, 2000), 'cancel', late, RULES)).toBe(tick(0));
  });

  test('a beat is read modulo its rotation', () => {
    const act = { kind: 'act' }, omen = (k: string) => ({ kind: 'omen', omen: k });
    // The Trumpet Raised: act, Weighed, act, Stars Fall.
    expect([0, 1, 2, 3, 5, 7, 8].map(b => beatOf(calm(ANGEL, 0, b), tick(0), RULES)))
      .toEqual([act, omen('weighed'), act, omen('stars'), omen('weighed'), omen('stars'), act]);
    // The First Breath opens on its omen: Breath, act, Weighed, act.
    expect([0, 4, 6].map(b => beatOf(calm(ANGEL, 1, b), tick(0), RULES))).toEqual([omen('breath'), omen('breath'), omen('weighed')]);
    // Past its 4 rounds the enraged rotation, the Final Note alone, at any beat.
    expect([0, 1, 5].map(b => beatOf(calm(ANGEL, 0, b), tick(4 * ROUND), RULES))).toEqual([omen('note'), omen('note'), omen('note')]);
  });

  test('the landing move is the omen\'s whole move, its weak one while it falters, none when calm', () => {
    const omened = (at: 'omen' | 'faltering', omen: string): MythicStanding => ({ ...standing(at), omen: omenKey(omen) }) as MythicStanding;
    expect(landingMove(omened('omen', 'weighed'))?.key).toBe('weighed' as MoveKey);
    expect(landingMove(omened('faltering', 'weighed'))?.key).toBe('found-wanting' as MoveKey);
    expect(landingMove(omened('faltering', 'weighed'))?.move.name).toBe('Found Wanting');
    expect(landingMove(calm(ANGEL, 0))).toBeNull();
  });
});

// ── a fight to aim in: an open 20 by 20 map, the mythic M on the foes' side at (10, 10) ──
function body(name: string, side: Side, at: Place, hp?: number): NewRow {
  const kind = side === 'party' ? 'hunter' : 'monster';
  const origin = { kind: 'hunter', build: { stats: baseStats(RULES.fight), level: 1, gear: kitGear('light', RULES), perks: {} } } as const;
  return {
    id: combatantId(name), name, side, ...lifeAt(kind, hp ?? 100), origin, tier: 0, place: at, mana: 10, fatigue: 0, shield: null, stagger: null, channel: null,
    threat: kind === 'monster' ? {} : null, statuses: [], readyAt: {}, abilities: [], intent: null,
    holder: kind === 'hunter' ? { kind: 'local', hunterId: hunterId(`h-${name}`) } : null, xp: 0, mythic: null,
  } as unknown as NewRow;
}
/** A running fight of M and the party `rows`, with M's threat table `threat`. */
function fight(rows: NewRow[], threat: Record<string, number> = {}): { f: Running; me: Body } {
  const all = [body('M', 'foe', place(10, 10)), ...rows];
  const r = reduceAll(null, [
    { type: 'add', fightId: fightId('f-mythic'), rows: all, openings: [], grid: openGrid(20, 20) },
    { type: 'start', openings: all.map((b, i) => ({ id: b.id, d20: 10, tie: i })) },
  ], { rules: RULES });
  if (r.fight?.phase !== 'running') throw new Error(`not running: ${JSON.stringify(r.effects.find(e => e.type === 'refused'))}`);
  const f: Running = { ...r.fight, rows: r.fight.rows.map(b => (b.id === 'M' && b.kind === 'monster' ? { ...b, threat: threat as Record<CombatantId, number> } : b)) };
  return { f, me: f.rows.find(b => b.id === 'M')! };
}
const ANGEL_MOVES = mythicScriptOf(ANGEL).moves as Readonly<Record<string, MythicMove>>;
const ZARATAN_MOVES = mythicScriptOf(ZARATAN).moves as Readonly<Record<string, MythicMove>>;
/** A blast of reach 2 (the Angel's Stars Fall) and a curse (its Weighed and Found Wanting). */
const BLAST = ANGEL_MOVES['stars-fall']!, CURSE = ANGEL_MOVES['weighed']!, TRENCH = ZARATAN_MOVES['trench']!;

describe('where an omen aims', () => {
  test('each omen aim picks its body, ties to row order', () => {
    const { f: hurt, me: m1 } = fight([body('A', 'party', place(10, 4)), body('B', 'party', place(4, 10), 30), body('C', 'party', place(16, 10), 30)]);
    // weakest: B and C each at 30 of 100, B first.
    expect(omenAim('weakest', CURSE, m1, hurt)).toBe(combatantId('B'));
    // farthest: A 3 tiles away, B and C 8; B first. A blast aims at the tile, so stepping off it answers.
    const { f: far, me: m2 } = fight([body('A', 'party', place(10, 7)), body('B', 'party', place(10, 18)), body('C', 'party', place(18, 10))]);
    expect(omenAim('farthest', CURSE, m2, far)).toBe(combatantId('B'));
    expect(omenAim('farthest', TRENCH, m2, far)).toEqual(place(10, 18));
    // threat: the table's highest; with no entry every foe ties, so the first.
    const trio = [body('A', 'party', place(10, 4)), body('B', 'party', place(4, 10)), body('C', 'party', place(16, 10))];
    const { f: hated, me: m3 } = fight(trio, { C: 5, B: 9 });
    expect(omenAim('threat', CURSE, m3, hated)).toBe(combatantId('B'));
    const { f: cold, me: m4 } = fight(trio);
    expect(omenAim('threat', CURSE, m4, cold)).toBe(combatantId('A'));
    // crowd: A alone; B and C two tiles apart, each one's tile catches both in a reach of 2; B first.
    const { f: crowd, me: m5 } = fight([body('A', 'party', place(2, 2)), body('B', 'party', place(15, 15)), body('C', 'party', place(17, 15))]);
    expect(omenAim('crowd', BLAST, m5, crowd)).toEqual(place(15, 15));
    // self and all: itself, so the area moves with it.
    expect(omenAim('self', BLAST, m5, crowd)).toBe(m5.id);
    expect(omenAim('all', BLAST, m5, crowd)).toBe(m5.id);
  });

  test('with no foe up to pick, an omen aims at itself', () => {
    const { f, me } = fight([body('A', 'party', place(10, 4))]);
    const down: Running = { ...f, rows: f.rows.map(b => (b.id === 'A' ? { ...b, ...lifeAt('hunter', 0) } as Body : b)) };
    expect(omenAim('weakest', CURSE, me, down)).toBe(me.id);
  });
});

describe('the answers a change met', () => {
  const ANGEL_OMENS = mythicScriptOf(ANGEL).omens as Readonly<Record<string, Omen>>;
  /** Weighed: a shield on the hunter it names cancels it. Stars: leaving its tile cancels it. */
  const WEIGHED = ANGEL_OMENS['weighed']!, STARS = ANGEL_OMENS['stars']!;
  /**
   * Decision 43 left no script's omen answered by a hit, so the stagger and burst rule is read on an omen of its own:
   * Weighed with a hold or root cancelling it, its stagger answer cancelling it and its burst weakening it.
   */
  const HITS: Omen = { ...WEIGHED, interrupt: { by: ['hold', 'root'], outcome: 'cancel' }, stagger: 'cancel', burst: 'weaken' };
  const STUN: StatusDef = { label: 'Stunned', desc: '', ops: [{ op: 'hold' }] };
  const stunned: Status = { key: statusKey('stunned'), def: STUN, source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) } as Status;
  /** A bar of 100 whose same-rank hit is 10. */
  const HIT = 10;
  const NOW = tick(500), A = combatantId('A');
  /** The mythic at `hp` of 1000, with `rows` of the party (none by default). */
  const at = (hp: number, o: { statuses?: Status[]; fill?: number; max?: number } = {}, rows: readonly AimRow[] = []): AnswerScene =>
    ({ row: { ...lifeAt('monster', hp), side: 'foe', sheet: { hpMax: 1000 }, statuses: o.statuses ?? [], stagger: { fill: o.fill ?? 0, max: o.max ?? 100, hit: HIT } } as AnswerRow, rows });
  /** Decision 42, read from the rule: the HP of 1000 a burst answer asks after the announce, and the bar's fill a stagger answer asks. */
  const REACH = RULES.fight.mythic.answerReach, BURST = Math.ceil(REACH.burst * 1000), STAGGER = REACH.stagger * HIT;
  const found = (hpAt: number, fill = 0, max = 100, aim: Place | CombatantId = A) => ({ hpAt, barAt: { fill, max }, aim });
  /** Hunter A at `p`, with a shield of `amount` to `until` (none at 0). */
  const hunterAt = (p: Place, amount = 0, until = 900): AimRow => ({ id: A, side: 'party', place: p, shield: amount ? { amount, until: tick(until) } : null });

  test('a stun and the burst\'s HP taken: the cancel comes first, then the weaken', () => {
    expect(answerMet(HITS, found(900), at(900), at(900 - BURST, { statuses: [stunned] }), NOW, RULES)).toEqual([
      { how: 'interrupt', outcome: 'cancel' }, { how: 'burst', outcome: 'weaken' },
    ]);
  });

  test('one HP short of the burst is no answer, a heal counts against it, and a stun it already had is no answer', () => {
    expect(answerMet(HITS, found(900), at(900), at(901 - BURST), NOW, RULES)).toEqual([]);
    expect(answerMet(HITS, found(900), at(900, { statuses: [stunned] }), at(900, { statuses: [stunned] }), NOW, RULES)).toEqual([]);
    expect(answerMet(HITS, found(900), at(800), at(960 - BURST), NOW, RULES)).toEqual([]);
  });

  test('at a reach of 0 any hit after the announce answers, and a change that lands nothing does not', () => {
    // decision 42's undo, "ordinary hits answer a warning": the rule at 0
    const ZERO = { fight: { mythic: { answerReach: { stagger: 0, burst: 0 } } } };
    expect(answerMet(HITS, found(900, 10), at(900, { fill: 10 }), at(899, { fill: 11 }), NOW, ZERO)).toEqual([{ how: 'stagger', outcome: 'cancel' }, { how: 'burst', outcome: 'weaken' }]);
    expect(answerMet(HITS, found(900, 10), at(900, { fill: 10 }), at(900, { fill: 10 }), NOW, ZERO)).toEqual([]);
  });

  test('HP lost before the announce is no burst answer: only what lands after it counts', () => {
    // the mythic lost the burst's HP and more before the omen, and nothing since
    expect(answerMet(HITS, found(900 - 2 * BURST), at(900 - 2 * BURST), at(900 - 2 * BURST), NOW, RULES)).toEqual([]);
  });

  test('the stagger answer\'s fill landed after the announce cancels, and no script\'s omen today is answered by a hit', () => {
    expect(answerMet(HITS, found(900, 0), at(900), at(900, { fill: STAGGER }), NOW, RULES)).toEqual([{ how: 'stagger', outcome: 'cancel' }]);
    expect(answerMet(HITS, found(900, 0), at(900), at(900, { fill: STAGGER - 1 }), NOW, RULES)).toEqual([]);
    expect(answerMet(WEIGHED, found(900, 0), at(900), at(900 - BURST, { fill: STAGGER }), NOW, RULES)).toEqual([]);
  });

  test('a bar nearly full at the announce and broken by one hit after it is no stagger answer', () => {
    // 95 of 100 at the announce: the break takes 5 of fill, and the bar is 175 after it, empty
    expect(answerMet(HITS, found(900, 95), at(900, { fill: 95 }), at(900, { fill: 0, max: 175 }), NOW, RULES)).toEqual([]);
  });

  test('a break counts the whole bar it emptied: the fill to the break and the fill after it', () => {
    // half the answer's fill to the break, then the other half on the new bar of 175
    const before = 100 - STAGGER / 2, after = STAGGER / 2;
    expect(answerMet(HITS, found(900, before), at(900, { fill: before }), at(900, { fill: after, max: 175 }), NOW, RULES)).toEqual([{ how: 'stagger', outcome: 'cancel' }]);
    expect(answerMet(HITS, found(900, before), at(900, { fill: before }), at(900, { fill: after - 1, max: 175 }), NOW, RULES)).toEqual([]);
  });

  test('a shield landing on the hunter Weighed names cancels it; one it already held, or one on another hunter, does not', () => {
    const here = place(4, 4);
    expect(answerMet(WEIGHED, found(900), at(900, {}, [hunterAt(here)]), at(900, {}, [hunterAt(here, 9)]), NOW, RULES)).toEqual([{ how: 'shield', outcome: 'cancel' }]);
    expect(answerMet(WEIGHED, found(900), at(900, {}, [hunterAt(here, 9)]), at(900, {}, [hunterAt(here, 9)]), NOW, RULES)).toEqual([]);
    expect(answerMet(WEIGHED, found(900, 0, 100, combatantId('B')), at(900, {}, [hunterAt(here)]), at(900, {}, [hunterAt(here, 9)]), NOW, RULES)).toEqual([]);
    // a shield past its end is none, so one put on again is new
    expect(answerMet(WEIGHED, found(900), at(900, {}, [hunterAt(here, 9, 400)]), at(900, {}, [hunterAt(here, 9)]), NOW, RULES)).toEqual([{ how: 'shield', outcome: 'cancel' }]);
  });

  test('Stars Fall\'s tile left by the hunter on it cancels it; a hunter that stays, or a tile it does not aim at, is no answer', () => {
    const tile = place(4, 4), off = place(5, 4);
    expect(answerMet(STARS, found(900, 0, 100, tile), at(900, {}, [hunterAt(tile)]), at(900, {}, [hunterAt(off)]), NOW, RULES)).toEqual([{ how: 'step', outcome: 'cancel' }]);
    expect(answerMet(STARS, found(900, 0, 100, tile), at(900, {}, [hunterAt(tile)]), at(900, {}, [hunterAt(tile)]), NOW, RULES)).toEqual([]);
    expect(answerMet(STARS, found(900, 0, 100, off), at(900, {}, [hunterAt(tile)]), at(900, {}, [hunterAt(place(3, 4))]), NOW, RULES)).toEqual([]);
    // Weighed names a hunter, not a tile: its step outcome is none, so a hunter walking off is no answer
    expect(answerMet(WEIGHED, found(900), at(900, {}, [hunterAt(tile)]), at(900, {}, [hunterAt(off)]), NOW, RULES)).toEqual([]);
  });
});
