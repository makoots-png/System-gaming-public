// feats.ts (registry): the feats the app ships, the System noticing on its own (hunter/feats.ts). Each is an idea of
// features/ideas-feats-titles-rewards.md section 2 (its F number in the comment) whose rule a count of today's facts can
// say and whose reward exists today: a title written by value with the name, band and bonus the ideas' section 4 gives
// it, ability points, or a shipped item. Every title spends no more than its band's `titleBudget` (item-budget.ts
// `titleSpend`, tests/item-budget.test.ts); the ideas file read 10 max HP as a point, which the budget weighs at 16.7 at E
// (a Vitality point gives 0.6 max HP there), so Still Standing's +10 max HP is +1 Vitality and Marathoner's +2
// Vitality and +10 max HP is +3 Vitality. Names and window titles are the ideas file's; every
// line that describes (the condition, a title's line) is plain and literal (copy-tasks.md, "Plain first"). An idea whose reward was a hidden quest gives points instead,
// since a quest is the GM's to issue (the owner's Stories ruling, Nov 18). The GM edits or turns one off in the library
// (`library.feats` under its key), which `featsFor` lays over these.
// To add one: an entry here (a key no other holds), and `bun run test` (tests/feats.test.ts reads every one back).
import { newRewards } from '../rewards.ts';
import type { RewardTitle, Rewards } from '../rewards.ts';
import { RULES } from '../rules.ts';
import type { Perk, Rank } from '../rules.ts';
import { SHOP_ITEMS, itemOf } from './items.ts';
import type { FeatBook, FeatDef, Show } from '../hunter/feats.ts';
import type { FactCount, Test } from '../hunter/counts.ts';
import type { FactKind } from '../hunter/facts.ts';
import type { FeatKey } from '../ids.ts';

const title = (name: string, band: Rank, desc: string, bonus: Perk, extra: Partial<Rewards> = {}): Rewards => ({ ...newRewards(), ...extra, title: { name, desc, bonus, band } });
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
  ['threads-end', feat('Thread\'s End', 'YOU ARE STILL STANDING', 'Win a fight with 5% of max HP or less left without dying.', HIDDEN,
    facts('fight', [WON, is('up', true), atMost('endPct', 5), is('downs', 0)]), 1, title('Still Standing', 'E', 'Won a fight with 5% of max HP or less left.', { vit: 1 }))],
  // F03: three foes down in one of its turns
  ['three-in-a-breath', feat('Three in a Breath', 'THE ROOM WENT QUIET', 'Defeat three monsters in one turn.', HIDDEN,
    facts('fight', [atLeast('turnKills', 3)]), 1, title('Swarm Breaker', 'C', 'Defeated three monsters in one turn.', { pow: 2 }, { points: 1 }))],
  // F04: the monster that put it down, defeated in the same fight
  ['payback', feat('Payback', 'DEBT COLLECTED', 'Defeat the monster that killed you in the same fight.', HIDDEN,
    facts('kill', [is('payback', true)]), 1, title('Debt Collector', 'D', 'Defeated the monster that killed you in the same fight.', { str: 2 }))],
  // F07: a monster above its rank (its hidden quest left to the GM)
  ['uphill', feat('Uphill', 'A HIGHER RANK HAS FALLEN', 'Defeat a monster above your rank.', SHOWN, facts('kill', [atLeast('above', 1)]), 1, points(1))],
  // F13: a won fight of twenty rounds
  ['the-long-round', feat('The Long Round', 'YOU OUTLASTED IT', 'Win a fight lasting 20 rounds or more.', HIDDEN,
    facts('fight', [WON, atLeast('rounds', 20)]), 1, title('Outlasted', 'C', 'Won a fight lasting 20 rounds or more.', { vit: 2 }, { items: [item('Stamina Tonic', 2)] }))],
  // F17
  ['ratcatcher', feat('Ratcatcher', 'SOMEONE HAS TO', 'Defeat 50 E-rank monsters.', SHOWN, facts('kill', [is('rank', 'E')]), 50,
    title('Ratcatcher', 'E', 'Defeated fifty E-rank monsters.', { ins: 1 }))],
  // F19 (counted on the boss's fall, not on standing at the end)
  ['red-ledger', feat('Red Ledger', 'TEN NAMES CROSSED OUT', 'Defeat 10 bosses.', SHOWN, facts('kill', [{ field: 'mkind', op: '>=', value: 'boss' }]), 10,
    title('Red Ledger', 'B', 'Defeated ten bosses.', { str: 3 }))],
  // F20
  ['sharp-eye', feat('Sharp Eye', 'YOU SEE WHERE IT IS SOFT', 'Land 100 critical hits.', SHOWN, sum('fight', 'crits'), 100, title('Sharp Eye', 'C', 'Landed a hundred critical hits.', { ctl: 2 }))],
  // F21
  ['cold-reader', feat('Cold Reader', 'YOU SAW IT COMING', 'Avoid 100 attacks.', SHOWN, sum('fight', 'avoided'), 100, title('Cold Reader', 'C', 'Avoided a hundred attacks.', { agi: 2 }))],
  // F22
  ['hex-ledger', feat('Hex Ledger', 'EVERY CURSE IS COUNTED', 'Apply 100 statuses to foes.', SHOWN, sum('fight', 'hexes'), 100,
    title('Hex Ledger', 'C', 'Put a hundred statuses on foes.', { ctl: 1, pow: 1 }))],
  // F23
  ['field-medic', feat('Field Medic', 'THEY WALKED OUT BECAUSE OF YOU', 'Heal allies for 500 HP in fights.', SHOWN, sum('fight', 'healed'), 500,
    title('Field Medic', 'D', 'Healed 500 HP on allies in fights.', { pre: 2 }))],
  // F26
  ['the-anvil', feat('The Anvil', 'THEY WON OVER YOUR BODY', 'Die in five fights that your party wins.', HIDDEN, facts('fight', [WON, atLeast('downs', 1)]), 5,
    title('The Anvil', 'B', 'Died in five fights the party won.', { vit: 3 }))],
  // F27: ten won fights in a row without going down (a lost fight, or one it went down in, starts the row again)
  ['clean-sheet', feat('Clean Sheet', 'TEN FIGHTS, NO FALLS', 'Win ten fights in a row without dying.', HIDDEN, facts('fight', [WON, is('downs', 0)], 'row'), 10,
    title('Clean Sheet', 'C', 'Won ten fights in a row without dying.', { agi: 2 }))],
  // F28: shown after a hundred
  ['four-figures', feat('Four Figures', 'ONE THOUSAND', 'Defeat 1,000 monsters.', { at: 'count', n: 100 }, facts('kill', []), 1000,
    title('Four Figures', 'A', 'Defeated a thousand monsters.', { str: 2, ctl: 2 }, { points: 3 }))],
  // F31 (its hidden quest left to the GM)
  ['field-naturalist', feat('Field Naturalist', 'THE SYSTEM IS TAKING NOTES', 'Defeat monsters of five different types.', HIDDEN,
    { on: 'kill', where: [], measure: { of: 'distinct', field: 'type' }, within: 'ever' }, 5, points(1))],
  // F33: the rule title by its key
  ['alone-once', feat('Alone, Once', 'NO PARTY WAS NEEDED', 'Clear a gate alone.', SHOWN, facts('solo', [WON]), 1,
    { ...newRewards(), title: { ...RULES.titles.find(t => t.key === 'hunts-alone')!, key: 'hunts-alone' } as RewardTitle })],
  // F34
  ['quiet-entry', feat('Quiet Entry', 'NOBODY SAW YOU GO IN', 'Clear three gates alone.', SHOWN, facts('solo', [WON]), 3, title('Quiet Entry', 'D', 'Cleared three gates alone.', { ins: 2 }))],
  // F35: three won runs between two rests
  ['marathoner', feat('Marathoner', 'THREE GATES, NO SLEEP', 'Clear three gates alone with no rest between them.', HIDDEN, facts('solo', [WON], 'rest'), 3,
    title('Marathoner', 'C', 'Cleared three gates alone without a rest.', { vit: 3 }))],
  // F37
  ['in-and-out', feat('In and Out', 'THE GATE BARELY OPENED', 'Clear a gate of your rank or higher alone in three rounds or fewer.', HIDDEN,
    facts('solo', [WON, atMost('rounds', 3), atLeast('above', 0)]), 1, title('In and Out', 'C', 'Cleared a gate of your rank or higher alone in three rounds or fewer.', { agi: 2 }))],
  // F38
  ['by-a-thread', feat('By a Thread', 'YOU WALKED OUT. BARELY', 'Clear a gate alone with 5% of max HP or less left.', HIDDEN,
    facts('solo', [WON, is('life', 'up'), atMost('endPct', 5)]), 1, { ...newRewards(), points: 1, items: [item('Greater Health Potion')] })],
  // F40
  ['trespasser', feat('Trespasser', 'YOU WERE NOT INVITED', 'Clear a gate above your rank alone.', HIDDEN, facts('solo', [WON, atLeast('above', 1)]), 1,
    title('Trespasser', 'C', 'Cleared a gate above your rank alone.', { ins: 1, agi: 1 }))],
  // F42
  ['regular', feat('Regular', 'THEY KNOW YOU AT THE GATE', 'Clear 10 gates.', SHOWN, facts('gate', []), 10, title('Regular', 'D', 'Cleared ten gates.', { ins: 1 }))],
  // F43: shown after ten
  ['gate-closer', feat('Gate Closer', 'ONE HUNDRED GATES', 'Clear 100 gates.', { at: 'count', n: 10 }, facts('gate', []), 100, title('Gate Closer', 'A', 'Cleared a hundred gates.', { ins: 4 }))],
  // F49 (its hidden quest left to the GM)
  ['early-riser', feat('Early Riser', 'SEVEN DAYS', 'Finish the daily quest seven days in a row.', SHOWN, facts('daily', [atLeast('streak', 7)]), 1,
    title('Early Riser', 'E', 'Finished the daily quest seven days in a row.', { dis: 1 }))],
  // F50: shown once Early Riser is earned
  ['iron-routine', feat('Iron Routine', 'THIRTY DAYS', 'Finish the daily quest 30 days in a row.', after('early-riser'), facts('daily', [atLeast('streak', 30)]), 1,
    title('Iron Routine', 'D', 'Finished the daily quest 30 days in a row.', { dis: 2 }))],
  // F79: three natural 1s in one session
  ['dice-are-watching', feat('The Dice Are Watching', 'THE DICE ARE WATCHING', 'Roll three natural 1s in one session.', HIDDEN, facts('roll', [is('natural', 1)], 'session'), 3, points(1))],
  // the brief's own: three awards for roleplay in one session
  ['commended', feat('Commended', 'THE SYSTEM HAS NOTICED', 'Receive three roleplay awards in one session.', HIDDEN, facts('given', [], 'session'), 3,
    title('Commended', 'E', 'Received three roleplay awards in one session.', { pre: 1 }))],
];

/** The built-in feats, in the order they are checked. */
export const BUILT_IN_FEATS: FeatBook = ENTRIES.map(([k, d]) => [k as FeatKey, d] as const);
