// payloads.ts: one valid payload per room event type, as the senders write it today, and what the parser makes of it
// (src/core/protocol.ts). tests/protocol.test.ts reads each through the parser; tests/run.test.ts lands each on a save
// that holds a running story, to show no message moves it.
import { SHOP_ITEMS, parseItem } from '../../src/core/registry/items.ts';
import type { EventType } from '../../src/core/protocol.ts';

type Raw = Record<string, any>;
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export const KEY = 'd-player1:h1', OTHER = 'd-player2:h4';
export const EID = 'd-gm1-mabc12xyz';
/** An offer's id, and the one id every end of it carries. */
export const OFFER = 'd-player1-mabc12xyz', END = `${OFFER}-e`;

/** A potion as gm.js sends it from the item library (without its id): the shop's, as parseItem reads it, two of them. */
export const POTION = { ...copy(parseItem(SHOP_ITEMS.find(i => i.name === 'Health Potion')!)!), qty: 2 };
/** A burning status as the fight's def holds it: 2 magical damage at each turn start. */
export const BURNING = { label: 'Burning', desc: 'On fire.', ops: [{ op: 'damage', type: 'magical', amount: { kind: 'number', value: 2 }, when: 'turn' }] };
/** A title as the GM's award carries it: its bonus travels with it. */
export const WOLF = { name: 'Wolf Slayer', desc: 'Slew a pack leader of wolves.', bonus: { str: 2 } };
/** Who applied it: a C-rank monster's row (tier 2), as the fight keeps it. */
export const SOURCE = { id: 'c-wolf', tier: 2 };
/** Burning as a hunter's sheet keeps it, with 3 rounds left. */
export const BURN = { key: 'burning', def: BURNING, source: SOURCE, rounds: 3 };

/**
 * One valid payload per event type, as the senders write it today, and what the parser makes of it: the same values,
 * with each optional field the sender left out at its default.
 */
export const VALID: Record<EventType, [Raw, Raw]> = {
  offer: [
    { eid: OFFER, by: KEY, to: [OTHER], names: { by: 'Brakk', to: 'Mira' }, gives: { gold: 0, items: [{ from: 'i3', item: POTION }] }, asks: { gold: 20, items: [{ id: 'i7', qty: 1, name: 'Iron Shield' }] } },
    { eid: OFFER, by: KEY, to: [OTHER], names: { by: 'Brakk', to: 'Mira' }, gives: { gold: 0, items: [{ from: 'i3', item: POTION }] }, asks: { gold: 20, items: [{ id: 'i7', qty: 1, name: 'Iron Shield' }] } },
  ],
  offerEnd: [
    { eid: END, by: KEY, to: [OTHER], offer: OFFER, how: 'withdraw', gives: { gold: 0, items: [] } },
    { eid: END, by: KEY, to: [OTHER], offer: OFFER, how: 'withdraw', gives: { gold: 0, items: [] } },
  ],
  offerStop: [
    { eid: END, to: [KEY, OTHER], offer: OFFER },
    { eid: END, to: [KEY, OTHER], offer: OFFER },
  ],
  system: [
    { eid: EID, tag: '! Notification', title: 'A gate opens', body: 'Gather at the station.', kind: 'warning' },
    { eid: EID, tag: '! Notification', title: 'A gate opens', body: 'Gather at the station.', kind: 'warning' },
  ],
  award: [
    { eid: EID, to: [KEY], rewards: { xp: 50, gold: 10, points: 1, items: [POTION], title: WOLF }, bundle: { key: 'seed-held-the-mask', name: 'Held the Mask', window: { title: 'the mask held', line: 'You stayed.' } } },
    { eid: EID, to: [KEY], rewards: { xp: 50, gold: 10, points: 1, items: [POTION], title: WOLF, job: null, skills: [], statuses: [], boons: [] }, bundle: { key: 'seed-held-the-mask', name: 'Held the Mask', window: { title: 'THE MASK HELD', line: 'You stayed.' } } },
  ],
  quest: [
    { eid: EID, to: [KEY, OTHER], quest: { kind: 'main', title: 'Clear the den', desc: 'Goblins.', objectives: [{ label: 'Goblins', target: 3, progress: 0 }],
      rewards: { xp: 100, points: 0, gold: 5, items: [], title: null, job: null, skills: [], statuses: [], boons: [] }, dueAt: '2026-11-13T12:00:00.000Z', penaltyText: 'Lose a day.',
      onFail: { xp: 0, points: 0, gold: -10, items: [], title: null, job: null, skills: [], statuses: [], boons: [] } } },
    { eid: EID, to: [KEY, OTHER], quest: { kind: 'main', title: 'Clear the den', desc: 'Goblins.', objectives: [{ label: 'Goblins', target: 3, progress: 0 }],
      rewards: { xp: 100, points: 0, gold: 5, items: [], title: null, job: null, skills: [], statuses: [], boons: [] }, dueAt: '2026-11-13T12:00:00.000Z', penaltyText: 'Lose a day.',
      onFail: { xp: 0, points: 0, gold: -10, items: [], title: null, job: null, skills: [], statuses: [], boons: [] } } },
  ],
  hp: [
    { eid: EID, to: [KEY], hp: -7, reason: 'GM' },
    { eid: EID, to: [KEY], hp: -7, mana: 0, fatigue: 0, reason: 'GM' },
  ],
  vitals: [
    { eid: EID, to: [KEY], hp: 20, mana: 5, fatigue: 30, statuses: [BURN] },
    { eid: EID, to: [KEY], hp: 20, mana: 5, fatigue: 30, statuses: [BURN], reason: '' },
  ],
  spent: [
    { eid: EID, to: [KEY], item: 'i12' },
    { eid: EID, to: [KEY], item: 'i12' },
  ],
  revive: [
    { eid: EID, to: [KEY] },
    { eid: EID, to: [KEY] },
  ],
  status: [
    { eid: EID, to: [KEY], add: [BURN], reason: 'Fire bolt' },
    { eid: EID, to: [KEY], add: [BURN], remove: [], reason: 'Fire bolt' },
  ],
  roll: [
    { eid: EID, by: KEY, name: 'Kai', label: 'Strike', expr: '1d20+3', total: 17, rolls: [14], crit: false, fumble: false },
    { eid: EID, by: KEY, name: 'Kai', label: 'Strike', expr: '1d20+3', total: 17, rolls: [14], crit: false, fumble: false },
  ],
  questUpdate: [
    { eid: EID, by: KEY, name: 'Kai', questId: 'q7', title: 'Clear the den', kind: 'main', status: 'active', objectives: [{ label: 'Goblins', progress: 2, target: 3 }] },
    { eid: EID, by: KEY, name: 'Kai', questId: 'q7', title: 'Clear the den', kind: 'main', status: 'active', objectives: [{ label: 'Goblins', progress: 2, target: 3 }] },
  ],
  chain: [
    { eid: EID, to: [KEY], job: 'Ranger', kind: 'issue' },
    { eid: EID, to: [KEY], job: 'Ranger', kind: 'issue' },
  ],
  used: [
    { eid: EID, by: KEY, who: 'Mira', what: 'item', name: 'Flash Bomb', text: 'Blinds a foe.', target: 'other', tell: true },
    { eid: EID, by: KEY, who: 'Mira', what: 'item', name: 'Flash Bomb', text: 'Blinds a foe.', target: 'other', tell: true },
  ],
  step: [
    { eid: EID, by: KEY, place: { x: 3, y: 4 }, at: 2500 },
    { eid: EID, by: KEY, place: { x: 3, y: 4 }, at: 2500, dash: false },
  ],
  cast: [
    { eid: EID, by: KEY, ability: 'strike', aim: 'c2', at: 2500, dice: [4, 6] },
    { eid: EID, by: KEY, ability: 'strike', aim: 'c2', at: 2500, dice: [4, 6] },
  ],
  pass: [
    { eid: EID, by: KEY, at: 2500 },
    { eid: EID, by: KEY, at: 2500 },
  ],
  coinCall: [
    { eid: EID, by: KEY, roll: 'd-player1:r12', who: 'Kai', what: 'STR check', face: 20, call: 'heads' },
    { eid: EID, by: KEY, roll: 'd-player1:r12', who: 'Kai', what: 'STR check', face: 20, call: 'heads' },
  ],
  coinLand: [
    { eid: EID, roll: 'd-player1:r12', side: 'tails' },
    { eid: EID, roll: 'd-player1:r12', side: 'tails' },
  ],
  arm: [
    { eid: EID, by: KEY, ability: 'parry', on: null },
    { eid: EID, by: KEY, ability: 'parry', on: null },
  ],
  shadow: [
    { eid: EID, to: [KEY], shadow: { rank: 'C', archetype: 'brute', grade: 'Knight', monster: 'm7', name: 'Ice Bear' } },
    { eid: EID, to: [KEY], shadow: { rank: 'C', archetype: 'brute', grade: 'Knight', monster: 'm7', name: 'Ice Bear' } },
  ],
  soloRun: [
    { eid: EID, by: KEY, gate: 'g12', name: 'Kai', outcome: 'won', rounds: 4.5, life: 'up' },
    { eid: EID, by: KEY, gate: 'g12', name: 'Kai', outcome: 'won', rounds: 4.5, life: 'up' },
  ],
  soloAnswer: [
    { eid: EID, to: [KEY], run: 'd-p1-run1', gate: 'g12', name: 'Goblin Den', verdict: 'paid', rewards: { xp: 50, gold: 120 } },
    { eid: EID, to: [KEY], run: 'd-p1-run1', gate: 'g12', name: 'Goblin Den', verdict: 'paid', rewards: { xp: 50, gold: 120, points: 0, items: [], title: null, job: null, skills: [], statuses: [], boons: [] } },
  ],
  noted: [
    { eid: EID, to: [KEY], facts: [{ kind: 'gate', name: 'Goblin Den', rank: 'E', above: 0, toBreak: 3 }, { kind: 'junk' }] },
    { eid: EID, to: [KEY], facts: [{ kind: 'gate', name: 'Goblin Den', rank: 'E', above: 0, toBreak: 3 }] },
  ],
  chapter: [
    { eid: EID, to: [KEY, OTHER], words: { title: 'the deep asks for a gate', line: 'Any gate of your rank.' }, rewards: { points: -1 },
      quest: { kind: 'urgent', title: 'Clear a gate for the Deep', desc: '', objectives: [{ label: 'Gate cleared', target: 1, progress: 0 }], rewards: { gold: 100 }, dueAt: '2026-11-21T10:00:00.000Z', penaltyText: 'The Deep collects.' } },
    { eid: EID, to: [KEY, OTHER], words: { title: 'THE DEEP ASKS FOR A GATE', line: 'Any gate of your rank.' }, rewards: { xp: 0, points: -1, gold: 0, items: [], title: null, job: null, skills: [], statuses: [], boons: [] },
      quest: { kind: 'urgent', title: 'Clear a gate for the Deep', desc: '', objectives: [{ label: 'Gate cleared', target: 1, progress: 0 }],
        rewards: { xp: 0, points: 0, gold: 100, items: [], title: null, job: null, skills: [], statuses: [], boons: [] }, dueAt: '2026-11-21T10:00:00.000Z', penaltyText: 'The Deep collects.',
        onFail: { xp: 0, points: 0, gold: 0, items: [], title: null, job: null, skills: [], statuses: [], boons: [] } } },
  ],
};
