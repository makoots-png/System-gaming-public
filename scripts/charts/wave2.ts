// The charts of wave 2's six machines (kits design 8.9): a reaction (src/core/combat/fight-react.ts `reactStep`), an edge
// or a held die, stealth and a ward (src/core/combat/standing.ts), a push or a pull (src/core/combat/space.ts
// `shoveStep`) and a body's turn extras (src/core/combat/timeline.ts), each walked with the events of
// tests/models/wave2-events.ts.
import { REACT_STATES, reactStep } from '../../src/core/combat/fight-react.ts';
import type { ReactEvent, ReactState } from '../../src/core/combat/fight-react.ts';
import { EDGE_STATES, edgeStep, STEALTH_STATES, stealthStep, WARD_STATES, wardStep } from '../../src/core/combat/standing.ts';
import type { EdgeEvent, EdgeHold, Stealth, StealthEvent, WardEvent, WardState } from '../../src/core/combat/standing.ts';
import { SHOVE_STATES, shoveStep } from '../../src/core/combat/space.ts';
import type { ShoveEvent, Shoved } from '../../src/core/combat/space.ts';
import { EXTRA_STATES, extraStep, HASTE_STATES, hasteStep } from '../../src/core/combat/timeline.ts';
import type { ExtraEvent, ExtraState, HasteEvent, HasteState } from '../../src/core/combat/timeline.ts';
import { EDGE_WALK, EXTRA_WALK, HASTE_WALK, REACT_WALK, SHOVE_WALK, STEALTH_WALK, WARD_WALK } from '../../tests/models/wave2-events.ts';
import { bfs, machine } from '../statecharts.ts';

const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

export const reaction = machine<ReactState, ReactEvent>({
  name: 'A reaction',
  walked: `Every state reachable from unarmed under the ${REACT_WALK.length} events of tests/models/wave2-events.ts, breadth first.`,
  walk: () => bfs(['unarmed' as ReactState], s => REACT_WALK.map(event => ({ event, to: reactStep(s, event) })), s => s),
  kinds: REACT_STATES,
  kindsOf: s => [s],
  views: [{
    title: 'A reaction on its reactor, from armed to spent',
    note: 'A player arms one of its hunter\'s reactions with the room\'s `arm`, the GM anyone\'s with the fight\'s. It fires by rule at its moment: before a foe\'s use lands on its reactor or an ally within reach, before a hit takes one of them to 0, after a foe\'s use landed on one, or before a named body\'s turn. It fires when its reactor is up, not held, its ability ready and paid for; otherwise it stays armed and says nothing. Its time comes off its reactor\'s next turn. A use sets off at most 4. Never written to a sheet. Two rows wait on a ruling and are drawn as the app behaves today: a reactor who is down arms (rules-4.3a), and a reaction fires at an aim already down (rules-4.2).',
    hides: 'arming another while armed, and a moment while spent, change nothing and are not drawn',
    state: s => (s === 'unarmed' ? 'Unarmed' : s === 'armed' ? 'Armed' : s === 'fired' ? 'Firing' : 'Spent'),
    step: (e, from, to) => {
      if (from === to) return null;
      switch (e.type) {
        case 'arm': return 'armed (the room\'s arm, the GM\'s arm; by a reactor down too, today)';
        case 'disarm': return 'disarmed';
        case 'moment': return 'its moment, and it may fire (at an aim down too, today)';
        case 'resolves': return 'its use resolves: its time comes off its next turn';
        case 'turnStart': return 'its turn starts (a turn reaction: the named body\'s)';
        case 'down': return 'its reactor goes down, or the fight ends';
      }
    },
  }],
  where: [
    ['The union', '`ReactState`, `ReactEvent` and `REACT_STATES` in `src/core/combat/fight-react.ts`; the row\'s `armed` in `Body` (`effect-ops.ts`)'],
    ['What changes it', '`reactStep(state, event)` and its `TABLE`; `react` fires one at every moment, `restored` restores them'],
    ['Who calls it', '`act` and `arm` in `src/core/combat/fight.ts` (rules 7c and 19c), `resolve` in `resolve.ts` (rule 13b, `Answers.lethal`), `startTurn` (`turnReaction`) and `consequences` in `fight-turn.ts`'],
    ['The test to copy', '`tests/fight.test.ts` ("a reaction"); the walk\'s events are in `tests/models/wave2-events.ts`'],
    ['The recipe', 'docs/guide/combat.md, "A reaction moment"'],
  ],
});

export const edge = machine<EdgeHold, EdgeEvent>({
  name: 'An edge or a held die',
  walked: `Every state reachable from absent under the ${EDGE_WALK.length} events of tests/models/wave2-events.ts, to 2 stacks, breadth first.`,
  walk: () => bfs([{ at: 'absent' } as EdgeHold], s => EDGE_WALK.map(event => ({ event, to: edgeStep(s, event) })).filter(x => x.to.at === 'absent' || x.to.n <= 2), s => JSON.stringify(s)),
  kinds: EDGE_STATES,
  kindsOf: s => [s.at],
  views: [{
    title: 'An edge on its bearer',
    note: 'An edge is advantage on a reaction d20: the attacker\'s keeps the target\'s lower face, the defender\'s its higher, read through the dice notation\'s `2d20kl1` and `2d20kh1`. An edge and its opposite on one die cancel and both spend; two of one kind do not add. One with Spends loses a stack after the first use whose die it reached, once a use; a worn one holds. A held die moves the face and always spends.',
    hides: 'a worn edge reached stays as it was and is not drawn',
    state: s => (s.at === 'absent' ? 'Absent' : `Held ${s.n}`),
    step: (e, from, to) => (JSON.stringify(from) === JSON.stringify(to) ? null : e.type === 'lands' ? 'a status with it lands' : e.type === 'reached' ? 'a die it reaches, and it spends' : 'its time ends, a cure, the fight\'s end'),
  }],
  where: [
    ['The union', '`EdgeHold`, `EdgeEvent` and `EDGE_STATES` in `src/core/combat/standing.ts`; the ops `edge` and `boost` in `effect-ops.ts`'],
    ['What changes it', '`edgeStep` and its `EDGE_TABLE`; `edgeOn` and `boostsOn` read a die\'s edge'],
    ['Who calls it', 'rule 7b (`keptFace`, `spendEdges`) in `src/core/combat/resolve.ts`; `needs` asks the second d20 and the held dice'],
    ['The test to copy', '`tests/resolve.test.ts` ("advantage and held dice")'],
    ['The recipe', 'docs/guide/combat.md, "A status op"'],
  ],
});

export const shove = machine<Shoved, ShoveEvent>({
  name: 'A push or a pull',
  walked: `Every state reachable from standing under the ${SHOVE_WALK.length} events of tests/models/wave2-events.ts, breadth first.`,
  walk: () => bfs([{ at: 'standing' } as Shoved], s => SHOVE_WALK.map(event => ({ event, to: shoveStep(s, event) })), s => JSON.stringify(s)),
  kinds: SHOVE_STATES,
  kindsOf: s => [s.at],
  views: [{
    title: 'A body pushed or pulled',
    note: 'A shove lands at rule 18 on a target the use caught: a dodge is not a push. It moves its tiles times the target\'s control factor, rounded down (none when rooted), tile by tile on the centre line from its anchor, and stops before a wall, a pit, the map\'s edge or a body; a pull stops next to its anchor. A stop deals nothing. Rough ground costs two of its steps. A forced entry into a zone pays no on-entry part.',
    hides: 'a push of 0 leaves the body standing and is not drawn',
    state: s => (s.at === 'moving' ? `Moving ${s.k}` : cap(s.at)),
    step: (e, from, to) => {
      if (JSON.stringify(from) === JSON.stringify(to)) return null;
      switch (e.type) {
        case 'lands': return `a shove of ${e.k} lands on it caught`;
        case 'tile': return e.free ? `a free tile costing ${e.cost}` : 'a wall, a pit, the edge or a body';
        case 'anchor': return 'a pull reaches its anchor';
        case 'settles': return 'zoneSync: its holds open and close';
      }
    },
  }],
  where: [
    ['The union', '`Shoved`, `ShoveEvent` and `SHOVE_STATES` in `src/core/combat/space.ts`; the op `shove` in `effect-ops.ts`'],
    ['What changes it', '`shoveStep` and its `SHOVE_TABLE`, stepped by `shovePath`'],
    ['Who calls it', 'rule 18c (`pushed`) in `src/core/combat/resolve.ts`; `after` passes the bodies it moved to `zoneSync` (`forced`)'],
    ['The test to copy', '`tests/space.test.ts` ("a push or a pull"), `tests/fight.test.ts` ("forced movement")'],
    ['The recipe', 'docs/guide/combat.md, "A status op"'],
  ],
});

export const stealth = machine<Stealth, StealthEvent>({
  name: 'Stealth',
  walked: `Every state reachable from seen under the ${STEALTH_WALK.length} events of tests/models/wave2-events.ts, breadth first.`,
  walk: () => bfs(['seen' as Stealth], s => STEALTH_WALK.map(event => ({ event, to: stealthStep(s, event) })), s => s),
  kinds: STEALTH_STATES,
  kindsOf: s => [s],
  views: [{
    title: 'Stealth on its bearer',
    note: 'Hiding is a use that puts a status with `hidden` on its user, refused (`seen`) while a foe that is up sees its tile. Hidden, the other side cannot aim at it nor catch it, and a hidden foe is not in the room\'s doc. Its next attack has the attacker\'s edge. A body seen again may hide again at once if no foe sees it.',
    hides: 'a hide while seen is refused and is not drawn',
    state: s => cap(s),
    step: (e, from, to) => {
      if (from === to) return null;
      switch (e.type) {
        case 'hide': return 'hides, and no foe that is up sees its tile';
        case 'acts': return 'uses an ability on a foe or a place';
        case 'foeNear': return 'a foe that is up stands within 1 tile';
        case 'hurt': return 'it takes HP damage';
        case 'time': return 'its time ends';
        case 'settles': return 'the status is gone';
      }
    },
  }],
  where: [
    ['The union', '`Stealth`, `StealthEvent` and `STEALTH_STATES` in `src/core/combat/standing.ts`; the op `hidden` in `effect-ops.ts`'],
    ['What changes it', '`stealthStep` and its `STEALTH_TABLE`'],
    ['Who calls it', '`act` in `src/core/combat/fight.ts` (the hide\'s `seen`, acting on a foe), `revealed` in `fight-turn.ts`, `catchable` in `resolve.ts`, `inView` in `fight-doc.ts`'],
    ['The test to copy', '`tests/fight.test.ts` ("wards and stealth"), `tests/fight-doc.test.ts` ("a hidden foe")'],
    ['The recipe', 'docs/guide/combat.md, "A status op"'],
  ],
});

export const ward = machine<WardState, WardEvent>({
  name: 'A ward',
  walked: `Every state reachable from never under the ${WARD_WALK.length} events of tests/models/wave2-events.ts, breadth first.`,
  walk: () => bfs(['never' as WardState], s => WARD_WALK.map(event => ({ event, to: wardStep(s, event) })), s => s),
  kinds: WARD_STATES,
  kindsOf: s => [s],
  views: [{
    title: 'Untargetable or invulnerable on its bearer, once a fight',
    note: 'Untargetable keeps a foe from aiming at its bearer or catching it, and ends when its bearer acts on a foe or a place; invulnerable keeps HP damage from taking it under 1, past a shield. Each lasts a round at most and reaches a body once a fight: the row keeps `warded`. A safeguard lasts a round and stops a harmful status from the other side.',
    hides: 'a ward landing on a warded body, and a hit held at 1, change no state and are not drawn',
    state: s => (s === 'never' ? 'Never had' : s === 'warded' ? 'Warded' : 'Spent for the fight'),
    step: (e, from, to) => (from === to ? null : e.type === 'lands' ? 'a status with it lands' : e.type === 'acts' ? 'untargetable: its bearer acts on a foe' : 'a round passes, or a cure'),
  }],
  where: [
    ['The union', '`WardState`, `WardEvent` and `WARD_STATES` in `src/core/combat/standing.ts`; the row\'s `warded` in `Body`'],
    ['What changes it', '`wardStep` and its `WARD_TABLE`; `admitted` and `markWards`'],
    ['Who calls it', 'rule 18 in `src/core/combat/resolve.ts` and `landOne` in `land.ts` (a status lands), `wardedDamage` (rules 13 and 14), `uncovered` in `fight-turn.ts`'],
    ['The test to copy', '`tests/fight.test.ts` ("wards and stealth")'],
    ['The recipe', 'docs/guide/combat.md, "A status op"'],
  ],
});

type Extras = { readonly extra: ExtraState; readonly haste: HasteState };
type ExtrasEvent = { readonly kind: 'extra'; readonly e: ExtraEvent } | { readonly kind: 'haste'; readonly e: HasteEvent };
export const extras = machine<Extras, ExtrasEvent>({
  name: 'A body\'s turn extras',
  walked: `Every pair of states reachable from plain and waiting under the ${EXTRA_WALK.length + HASTE_WALK.length} events of tests/models/wave2-events.ts, breadth first.`,
  walk: () => bfs([{ extra: 'plain', haste: 'waiting' } as Extras], s => [
    ...EXTRA_WALK.map(e => ({ event: { kind: 'extra', e } as ExtrasEvent, to: { ...s, extra: extraStep(s.extra, e).to } })),
    ...HASTE_WALK.map(e => ({ event: { kind: 'haste', e } as ExtrasEvent, to: { ...s, haste: hasteStep(s.haste, e).to } })),
  ], s => `${s.extra}|${s.haste}`),
  kinds: [...EXTRA_STATES, ...HASTE_STATES],
  kindsOf: s => [s.extra, s.haste],
  views: [{
    title: 'An extra action and a hasten',
    note: 'An extra action makes its user\'s next turn the next tick, one a round of fight time (`extraPerRound`); a second is refused (`extra`). A hasten brings another body\'s next turn earlier by a share of the giver\'s standard action, never before the next tick, once between two of its turns. No turn is ever set before the next tick.',
    hides: 'a refused extra and a second hasten change nothing and are not drawn',
    state: s => ({ 'Extra actions': s.extra === 'plain' ? 'None this round' : 'Taken this round', Hastes: s.haste === 'waiting' ? 'Waiting' : 'Hastened' }),
    step: (ev, from, to) => {
      if (ev.kind === 'extra') return { 'Extra actions': from.extra === to.extra ? null : ev.e.type === 'extra' ? 'an extra action' : 'a later round', Hastes: null };
      return { 'Extra actions': null, Hastes: from.haste === to.haste ? null : ev.e.type === 'hastened' ? 'hastened by another' : 'its turn starts' };
    },
  }],
  where: [
    ['The union', '`ExtraState`, `ExtraEvent`, `HasteState`, `HasteEvent` in `src/core/combat/timeline.ts`; the row\'s `extras` and `hastened`'],
    ['What changes it', '`extraStep` and `hasteStep` and their tables; `extraNow` and `hastened` move the turn'],
    ['Who calls it', '`resolve` in `src/core/combat/resolve.ts` (`extraTaken`, `userTime`, the `hasten` op), `startTurn` in `fight-turn.ts`'],
    ['The test to copy', '`tests/timeline.test.ts` ("turn economy"), `tests/fight.test.ts` ("turn economy")'],
    ['The recipe', 'docs/guide/combat.md, "A status op"'],
  ],
});
