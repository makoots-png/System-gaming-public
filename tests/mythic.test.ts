// A mythic's standing in its script as a machine, and the readers of what follows from it (src/core/combat/mythic.ts;
// notes-11-keystones.md, design B.3 and B.4). Every expected value is read from B.3's table and from the scripts' own
// words in registry/mythics.ts: the Angel's First Breath begins at 65% of its max HP and its Note at 30%; its Trumpet
// Raised has a clock of 5 rounds and the rotation act, Stars Fall, act, Weighed; Zaratan's Dive is a clock phase of
// 3 rounds between the Shore and the Island Wakes, which begins at 55%.
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
  MYTHIC_EVENTS, MYTHIC_STATES, answerMet, beatOf, clockOut, enraged, gateOf, heldAtGate, landingMove, mythicCan, mythicStep, omenAim, phaseOver,
} from '../src/core/combat/mythic.ts';
import type { AnswerRow, MythicEvent, MythicEventType, MythicRefusal, MythicRow, MythicState } from '../src/core/combat/mythic.ts';
import { lifeAt } from './fixtures/life.ts';

const ROUND = RULES.fight.round;
const ANGEL: MythicScriptId = 'angel-of-the-last-trumpet', ZARATAN: MythicScriptId = 'zaratan-the-island-that-wakes';
const omenKey = (k: string): OmenKey => k as OmenKey;
const AIM = place(3, 3);
const calm = (script: MythicScriptId, phase: number, beat = 0, since = 0): MythicStanding => ({ at: 'calm', script, phase, beat, since: tick(since) });
const standing = (at: MythicState, script: MythicScriptId = ANGEL, phase = 0, beat = 1, since = 100): MythicStanding =>
  at === 'calm' ? calm(script, phase, beat, since) : { at, script, phase, beat, since: tick(since), omen: omenKey('stars'), aim: AIM, hpAt: 900 };
/** A mythic row of 1000 max HP at `hp` HP. */
const row = (mythic: MythicStanding | null, hp: number, hpMax = 1000): MythicRow => ({ mythic, ...lifeAt('monster', hp), sheet: { hpMax } });

const EVENT: { readonly [T in MythicEventType]: Extract<MythicEvent, { type: T }> } = {
  next: { type: 'next', now: tick(500), by: 'gm' }, announce: { type: 'announce', omen: omenKey('weighed'), aim: combatantId('A'), hpAt: 700 },
  beat: { type: 'beat' }, cancel: { type: 'cancel', how: 'interrupt' }, weaken: { type: 'weaken', how: 'burst' },
  land: { type: 'land' }, fizzle: { type: 'fizzle' }, drop: { type: 'drop' },
};

describe('the machine', () => {
  test('a mythic\'s standing as a machine: every state against every event', () => {
    // From phase 0 at beat 1, its phase begun at 100: the next phase starts at beat 0 with its clock from the event's
    // 500; an answer, a landing, a fizzle or a drop ends the omen and goes on to beat 2; a weaken keeps the omen weakened.
    const nextPhase = calm(ANGEL, 1, 0, 500), onward = calm(ANGEL, 0, 2, 100);
    const announced: MythicStanding = { at: 'omen', script: ANGEL, phase: 0, beat: 1, since: tick(100), omen: omenKey('weighed'), aim: combatantId('A'), hpAt: 700 };
    const EXPECTED: { readonly [S in MythicState]: { readonly [T in MythicEventType]: MythicStanding | MythicRefusal } } = {
      calm: { next: nextPhase, announce: announced, beat: onward, cancel: 'noOmen', weaken: 'noOmen', land: 'noOmen', fizzle: 'noOmen', drop: 'noOmen' },
      omen: { next: nextPhase, announce: 'omenStands', beat: 'omenStands', cancel: onward, weaken: standing('faltering'), land: onward, fizzle: onward, drop: onward },
      faltering: { next: nextPhase, announce: 'omenStands', beat: 'omenStands', cancel: onward, weaken: 'weakened', land: onward, fizzle: onward, drop: onward },
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
    const weakened = mythicStep(standing('omen'), EVENT.weaken);
    expect(weakened).toEqual(standing('faltering'));
    const again = mythicStep(standing('faltering'), { type: 'weaken', how: 'stagger' });
    expect(isRefused(again) && again.why).toBe('weakened');
    expect(mythicCan(standing('faltering'), 'weaken')).toBe(false);
    expect(mythicStep(standing('faltering'), { type: 'cancel', how: 'stagger' })).toEqual(calm(ANGEL, 0, 2, 100));
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
    const raised = calm(ANGEL, 0, 0, 2000), at = (rounds: number): Tick => tick(2000 + rounds * ROUND);
    expect([clockOut(raised, tick(at(5) - 1), RULES), enraged(raised, tick(at(5) - 1), RULES)]).toEqual([false, false]);
    expect([clockOut(raised, at(5), RULES), enraged(raised, at(5), RULES)]).toEqual([true, true]);
    // Enraged, a gate phase still ends only at its gate.
    expect(phaseOver(row(raised, 900), at(5), RULES)).toBe(false);
    expect(phaseOver(row(raised, 650), tick(2000), RULES)).toBe(true);
    const dive = calm(ZARATAN, 1, 0, 2000);
    expect([phaseOver(row(dive, 550), tick(at(3) - 1), RULES), phaseOver(row(dive, 550), at(3), RULES)]).toEqual([false, true]);
    expect(enraged(dive, at(10), RULES)).toBe(false);
    expect(phaseOver(row(null, 1), at(10), RULES)).toBe(false);
  });

  test('a beat is read modulo its rotation', () => {
    const act = { kind: 'act' }, omen = (k: string) => ({ kind: 'omen', omen: k });
    // The Trumpet Raised: act, Stars Fall, act, Weighed.
    expect([0, 1, 2, 3, 5, 7, 8].map(b => beatOf(calm(ANGEL, 0, b), tick(0), RULES)))
      .toEqual([act, omen('stars'), act, omen('weighed'), omen('stars'), omen('weighed'), act]);
    // The First Breath opens on its omen: Breath, act, Weighed, act.
    expect([0, 4, 6].map(b => beatOf(calm(ANGEL, 1, b), tick(0), RULES))).toEqual([omen('breath'), omen('breath'), omen('weighed')]);
    // Past its 5 rounds the enraged rotation, the Final Note alone, at any beat.
    expect([0, 1, 5].map(b => beatOf(calm(ANGEL, 0, b), tick(5 * ROUND), RULES))).toEqual([omen('note'), omen('note'), omen('note')]);
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
    holder: kind === 'hunter' ? { kind: 'local', hunterId: hunterId(`h-${name}`) } : null, xp: 0,
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
    expect(omenAim('weakest', CURSE, m1, hurt, RULES)).toBe(combatantId('B'));
    // farthest: A 3 tiles away, B and C 8; B first. A blast aims at the tile, so stepping off it answers.
    const { f: far, me: m2 } = fight([body('A', 'party', place(10, 7)), body('B', 'party', place(10, 18)), body('C', 'party', place(18, 10))]);
    expect(omenAim('farthest', CURSE, m2, far, RULES)).toBe(combatantId('B'));
    expect(omenAim('farthest', TRENCH, m2, far, RULES)).toEqual(place(10, 18));
    // threat: the table's highest; with no entry every foe ties, so the first.
    const trio = [body('A', 'party', place(10, 4)), body('B', 'party', place(4, 10)), body('C', 'party', place(16, 10))];
    const { f: hated, me: m3 } = fight(trio, { C: 5, B: 9 });
    expect(omenAim('threat', CURSE, m3, hated, RULES)).toBe(combatantId('B'));
    const { f: cold, me: m4 } = fight(trio);
    expect(omenAim('threat', CURSE, m4, cold, RULES)).toBe(combatantId('A'));
    // crowd: A alone; B and C two tiles apart, each one's tile catches both in a reach of 2; B first.
    const { f: crowd, me: m5 } = fight([body('A', 'party', place(2, 2)), body('B', 'party', place(15, 15)), body('C', 'party', place(17, 15))]);
    expect(omenAim('crowd', BLAST, m5, crowd, RULES)).toEqual(place(15, 15));
    // self and all: its own tile.
    expect(omenAim('self', BLAST, m5, crowd, RULES)).toEqual(place(10, 10));
    expect(omenAim('all', BLAST, m5, crowd, RULES)).toEqual(place(10, 10));
  });

  test('with no foe up to pick, an omen aims at its own tile', () => {
    const { f, me } = fight([body('A', 'party', place(10, 4))]);
    const down: Running = { ...f, rows: f.rows.map(b => (b.id === 'A' ? { ...b, ...lifeAt('hunter', 0) } as Body : b)) };
    expect(omenAim('weakest', CURSE, me, down, RULES)).toEqual(place(10, 10));
  });
});

describe('the answers a change met', () => {
  const ANGEL_OMENS = mythicScriptOf(ANGEL).omens as Readonly<Record<string, Omen>>;
  /** Weighed: a hold or root cancels; 5% of max HP taken weakens. The Breath: a hold weakens, its bar broken cancels. */
  const WEIGHED = ANGEL_OMENS['weighed']!, BREATH = ANGEL_OMENS['breath']!, STARS = ANGEL_OMENS['stars']!;
  const STUN: StatusDef = { label: 'Stunned', desc: '', ops: [{ op: 'hold' }] };
  const stunned: Status = { key: statusKey('stunned'), def: STUN, source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) } as Status;
  const at = (hp: number, o: { statuses?: Status[]; bar?: number } = {}) =>
    ({ ...lifeAt('monster', hp), sheet: { hpMax: 1000 }, statuses: o.statuses ?? [], stagger: { fill: 0, max: o.bar ?? 100, hit: 0 } }) as AnswerRow;

  test('a stun and 50 HP taken on Weighed: the cancel comes first, then the weaken', () => {
    expect(answerMet(WEIGHED, 900, at(900), at(850, { statuses: [stunned] }))).toEqual([
      { how: 'interrupt', outcome: 'cancel' }, { how: 'burst', outcome: 'weaken' },
    ]);
  });

  test('49 HP is short of Weighed\'s 5%, a heal counts against it, and a stun it already had is no answer', () => {
    expect(answerMet(WEIGHED, 900, at(900), at(851))).toEqual([]);
    expect(answerMet(WEIGHED, 900, at(900, { statuses: [stunned] }), at(900, { statuses: [stunned] }))).toEqual([]);
    expect(answerMet(WEIGHED, 900, at(820), at(860))).toEqual([]);
  });

  test('a bar broken on the Breath cancels it, and an answer whose outcome is none is not met', () => {
    expect(answerMet(BREATH, 900, at(900), at(900, { bar: 150 }))).toEqual([{ how: 'stagger', outcome: 'cancel' }]);
    expect(answerMet(STARS, 900, at(900), at(400, { statuses: [stunned] }))).toEqual([]);
  });
});
