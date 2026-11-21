// feats.ts (registry): the feats the app ships, the System noticing on its own (hunter/feats.ts). Each is an idea of
// features/ideas-feats-titles-rewards.md section 2 (its F number in the comment) whose rule a count of today's facts can
// say and whose reward exists today: a title written by value with the name and bonus the ideas' section 4 gives it (an
// E-rank title worth 1 point), ability points, or a shipped item. Names and window titles are the ideas file's; every
// line that describes (the condition, a title's line) is plain and literal (copy-tasks.md, "Plain first"). An idea whose reward was a hidden quest gives points instead,
// since a quest is the GM's to issue (the owner's Stories ruling, Nov 18). The GM edits or turns one off in the library
// (`library.feats` under its key), which `featsFor` lays over these.
// To add one: an entry here (a key no other holds), and `bun run test` (tests/feats.test.ts reads every one back).
import { newRewards } from '../rewards.ts';
import type { RewardTitle, Rewards } from '../rewards.ts';
import { RULES } from '../rules.ts';
import { SHOP_ITEMS, itemOf } from './items.ts';
import type { FeatBook, FeatDef, Show } from '../hunter/feats.ts';
import type { FactCount, Test } from '../hunter/counts.ts';
import type { FactKind } from '../hunter/facts.ts';
import type { FeatKey } from '../ids.ts';

const title = (name: string, desc: string, bonus: Record<string, number>, extra: Partial<Rewards> = {}): Rewards => ({ ...newRewards(), ...extra, title: { name, desc, bonus } as RewardTitle });
const points = (n: number): Rewards => ({ ...newRewards(), points: n });
const item = (name: string, qty = 1) => ({ ...itemOf(RULES, SHOP_ITEMS.find(d => d.name === name)!), qty });
const is = (field: string, value: number | string | boolean): Test => ({ field, op: '=', value });
const atLeast = (field: string, value: number): Test => ({ field, op: '>=', value });
const atMost = (field: string, value: number): Test => ({ field, op: '<=', value });
const facts = (on: FactKind, where: Test[], within: FactCount['within'] = 'ever'): FactCount => ({ on, where, measure: { of: 'facts' }, within });
const sum = (on: FactKind, field: string): FactCount => ({ on, where: [], measure: { of: 'sum', field }, within: 'ever' });
const HIDDEN: Show = { at: 'never' }, SHOWN: Show = { at: 'start' };
const after = (key: string): Show => ({ at: 'feat', key: key as FeatKey });
const feat = (name: string, window: string, desc: string, show: Show, count: FactCount, reach: number, rewards: Rewards): FeatDef =>
  ({ name, window, desc, show, rule: { ...count, reach, also: [] }, rewards });
const WON = is('outcome', 'won');

const ENTRIES: readonly (readonly [string, FeatDef])[] = [
  // F01: a won fight ended up at 5% of max HP or less, never down in it
  ['threads-end', feat('Thread\'s End', 'YOU ARE STILL STANDING', 'A fight won with 5% of max HP or less left, without going down in it.', HIDDEN,
    facts('fight', [WON, is('up', true), atMost('endPct', 5), is('downs', 0)]), 1, title('Still Standing', 'Won a fight with 5% of max HP or less left.', { hpMax: 10 }))],
  // F03: three foes down in one of its turns
  ['three-in-a-breath', feat('Three in a Breath', 'THE ROOM WENT QUIET', 'Three monsters defeated in one turn.', HIDDEN,
    facts('fight', [atLeast('turnKills', 3)]), 1, title('Swarm Breaker', 'Defeated three monsters in one turn.', { pow: 2 }, { points: 1 }))],
  // F04: the monster that put it down, defeated in the same fight
  ['payback', feat('Payback', 'DEBT COLLECTED', 'The monster that put you down, defeated by you in the same fight.', HIDDEN,
    facts('kill', [is('payback', true)]), 1, title('Debt Collector', 'Defeated the monster that put you down, in the same fight.', { str: 2 }))],
  // F07: a monster above its rank (its hidden quest left to the GM)
  ['uphill', feat('Uphill', 'A HIGHER RANK HAS FALLEN', 'A monster above your rank, defeated.', SHOWN, facts('kill', [atLeast('above', 1)]), 1, points(1))],
  // F13: a won fight of twenty rounds
  ['the-long-round', feat('The Long Round', 'YOU OUTLASTED IT', 'A fight of twenty rounds or more, won.', HIDDEN,
    facts('fight', [WON, atLeast('rounds', 20)]), 1, title('Outlasted', 'Won a fight that ran twenty rounds.', { vit: 2 }, { items: [item('Stamina Tonic', 2)] }))],
  // F17
  ['ratcatcher', feat('Ratcatcher', 'SOMEONE HAS TO', 'Fifty E-rank monsters defeated.', SHOWN, facts('kill', [is('rank', 'E')]), 50,
    title('Ratcatcher', 'Defeated fifty E-rank monsters.', { ins: 1 }))],
  // F19 (counted on the boss's fall, not on standing at the end)
  ['red-ledger', feat('Red Ledger', 'TEN NAMES CROSSED OUT', 'Ten bosses defeated.', SHOWN, facts('kill', [is('mkind', 'boss')]), 10,
    title('Red Ledger', 'Defeated ten bosses.', { str: 3 }))],
  // F20
  ['sharp-eye', feat('Sharp Eye', 'YOU SEE WHERE IT IS SOFT', 'A hundred critical hits landed.', SHOWN, sum('fight', 'crits'), 100, title('Sharp Eye', 'Landed a hundred critical hits.', { ctl: 2 }))],
  // F21
  ['cold-reader', feat('Cold Reader', 'YOU SAW IT COMING', 'A hundred attacks avoided.', SHOWN, sum('fight', 'avoided'), 100, title('Cold Reader', 'Avoided a hundred attacks.', { agi: 2 }))],
  // F22
  ['hex-ledger', feat('Hex Ledger', 'EVERY CURSE IS COUNTED', 'A hundred statuses put on foes.', SHOWN, sum('fight', 'hexes'), 100,
    title('Hex Ledger', 'Put a hundred statuses on foes.', { ctl: 1, pow: 1 }))],
  // F23
  ['field-medic', feat('Field Medic', 'THEY WALKED OUT BECAUSE OF YOU', '500 HP healed on allies in fights.', SHOWN, sum('fight', 'healed'), 500,
    title('Field Medic', 'Healed 500 HP on allies in fights.', { pre: 2 }))],
  // F26
  ['the-anvil', feat('The Anvil', 'THEY WON OVER YOUR BODY', 'Five fights your side won in which you went down.', HIDDEN, facts('fight', [WON, atLeast('downs', 1)]), 5,
    title('The Anvil', 'Went down in five fights the party won.', { vit: 3 }))],
  // F27: ten won fights in a row without going down (a lost fight, or one it went down in, starts the row again)
  ['clean-sheet', feat('Clean Sheet', 'TEN FIGHTS, NO FALLS', 'Ten fights won in a row without going down.', HIDDEN, facts('fight', [WON, is('downs', 0)], 'row'), 10,
    title('Clean Sheet', 'Won ten fights in a row without going down.', { agi: 2 }))],
  // F28: shown after a hundred
  ['four-figures', feat('Four Figures', 'ONE THOUSAND', 'A thousand monsters defeated.', { at: 'count', n: 100 }, facts('kill', []), 1000,
    title('Four Figures', 'Defeated a thousand monsters.', { str: 2, ctl: 2 }, { points: 3 }))],
  // F31 (its hidden quest left to the GM)
  ['field-naturalist', feat('Field Naturalist', 'THE SYSTEM IS TAKING NOTES', 'Monsters of five different types defeated.', HIDDEN,
    { on: 'kill', where: [], measure: { of: 'distinct', field: 'type' }, within: 'ever' }, 5, points(1))],
  // F33: the rule title by its key
  ['alone-once', feat('Alone, Once', 'NO PARTY WAS NEEDED', 'A gate cleared alone.', SHOWN, facts('solo', [WON]), 1,
    { ...newRewards(), title: { ...RULES.titles.find(t => t.key === 'hunts-alone')!, key: 'hunts-alone' } as RewardTitle })],
  // F34
  ['quiet-entry', feat('Quiet Entry', 'NOBODY SAW YOU GO IN', 'Three gates cleared alone.', SHOWN, facts('solo', [WON]), 3, title('Quiet Entry', 'Cleared three gates alone.', { ins: 2 }))],
  // F35: three won runs between two long rests
  ['marathoner', feat('Marathoner', 'THREE GATES, NO SLEEP', 'Three gates cleared alone with no long rest between them.', HIDDEN, facts('solo', [WON], 'rest'), 3,
    title('Marathoner', 'Cleared three gates alone without a long rest.', { vit: 2, hpMax: 10 }))],
  // F37
  ['in-and-out', feat('In and Out', 'THE GATE BARELY OPENED', 'A gate of your rank or higher cleared alone in three rounds or fewer.', HIDDEN,
    facts('solo', [WON, atMost('rounds', 3), atLeast('above', 0)]), 1, title('In and Out', 'Cleared a gate of your rank or higher alone in three rounds or fewer.', { agi: 2 }))],
  // F38
  ['by-a-thread', feat('By a Thread', 'YOU WALKED OUT. BARELY', 'A gate cleared alone with 5% of max HP or less left.', HIDDEN,
    facts('solo', [WON, is('life', 'up'), atMost('endPct', 5)]), 1, { ...newRewards(), points: 1, items: [item('Greater Health Potion')] })],
  // F40
  ['trespasser', feat('Trespasser', 'YOU WERE NOT INVITED', 'A gate above your rank cleared alone.', HIDDEN, facts('solo', [WON, atLeast('above', 1)]), 1,
    title('Trespasser', 'Cleared a gate above your rank, alone.', { ins: 1, agi: 1 }))],
  // F42
  ['regular', feat('Regular', 'THEY KNOW YOU AT THE GATE', 'Ten gates cleared.', SHOWN, facts('gate', []), 10, title('Regular', 'Cleared ten gates.', { ins: 1 }))],
  // F43: shown after ten
  ['gate-closer', feat('Gate Closer', 'ONE HUNDRED GATES', 'A hundred gates cleared.', { at: 'count', n: 10 }, facts('gate', []), 100, title('Gate Closer', 'Cleared a hundred gates.', { ins: 4 }))],
  // F49 (its hidden quest left to the GM)
  ['early-riser', feat('Early Riser', 'SEVEN DAYS', 'The daily quest finished seven days running.', SHOWN, facts('daily', [atLeast('streak', 7)]), 1,
    title('Early Riser', 'Finished the daily quest seven days running.', { dis: 1 }))],
  // F50: shown once Early Riser is earned
  ['iron-routine', feat('Iron Routine', 'THIRTY DAYS', 'The daily quest finished thirty days running.', after('early-riser'), facts('daily', [atLeast('streak', 30)]), 1,
    title('Iron Routine', 'Finished the daily quest thirty days running.', { dis: 2 }))],
  // F79: three natural 1s in one session
  ['dice-are-watching', feat('The Dice Are Watching', 'THE DICE ARE WATCHING', 'Three natural 1s rolled in one session.', HIDDEN, facts('roll', [is('natural', 1)], 'session'), 3, points(1))],
  // the brief's own: three awards for roleplay in one session
  ['commended', feat('Commended', 'THE SYSTEM HAS NOTICED', 'Three awards for roleplay given to you in one session.', HIDDEN, facts('given', [], 'session'), 3,
    title('Commended', 'Was given three awards for roleplay in one session.', { pre: 1 }))],
];

/** The built-in feats, in the order they are checked. */
export const BUILT_IN_FEATS: FeatBook = ENTRIES.map(([k, d]) => [k as FeatKey, d] as const);
