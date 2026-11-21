// rules-text.ts: the lines of the Rules page that state a rule the game plays elsewhere, worked out from the functions
// that play it, so the page cannot drift from the game (tests/rules-text.test.ts pins each one). Pure. The page itself
// is src/views/rulesref.js, which keeps its layout and calls these.
import type { Rank, Rules } from './rules.ts';
import { above } from './stats.ts';
import { statBonus } from './hunter/sheet.ts';
import { VERDICT_WORDS, verdict } from './coin.ts';
import { CAP_ROUNDS } from './combat/play.ts';
import { ODDS_RUNS } from './combat/odds.ts';
import { sellPrice, shopOpen } from './hunter/inventory.ts';
import { RARITIES, priceOf } from './registry/items.ts';
import type { PriceRules, Rarity } from './registry/items.ts';
import { shareEach } from './gates/pay.ts';
import { FUMBLE_FAILURES, REVIVE_HP, SAVES_TO_END, SAVE_FUMBLE, SAVE_SUCCESS, SAVE_UP, SAVE_UP_HP, WAYS_BACK } from './hunter/vitals.ts';
import { levelAfterRaising } from './hunter/progress.ts';
import { HIDE_LEVELS, ambushShare, asLevel } from './combat/standing.ts';
import type { Level } from './combat/standing.ts';
import { perceives } from './combat/sight.ts';
import { openGrid, place } from './combat/space.ts';
import { STEALTH_ENDS } from './combat/effect-ops.ts';
import type { StealthEnd } from './combat/effect-ops.ts';

const sign = (n: number): string => (n >= 0 ? '+' : '') + n;

/** The worked example of a check: a hunter of `rank` with `score` in a stat against the Standard DC of that rank. */
export interface CheckExample {
  readonly score: number;
  readonly rank: Rank;
  /** The effective points of the score above the base. */
  readonly above: number;
  /** The stat's part of the check bonus (`statBonus`, the one `checksOf` adds). */
  readonly stat: number;
  readonly rankBonus: number;
  readonly dc: number;
  /** The lowest d20 that meets the DC, at least 1. */
  readonly need: number;
}

export function checkExample(R: Rules): CheckExample {
  const score = 14, rank: Rank = 'E';
  const stat = statBonus(score, R.fight), rankBonus = R.rankBonus[rank], dc = R.rankTable[rank].dc[1]!;
  return { score, rank, above: above(score, R.fight), stat, rankBonus, dc, need: Math.max(1, dc - stat - rankBonus) };
}

const fmtX = (n: number): string => String(Math.round(n * 10) / 10);

/** What a stat adds to a check, stated for the worked example's own score. */
export function statBonusLine(R: Rules): string {
  const x = checkExample(R), base = R.fight.statBase;
  return `Near ${base} the effective points are close to the score minus ${base}, and half of them, rounded down, is the bonus: a score of ${x.score} has about ${fmtX(x.above)} points above ${base} and adds ${sign(x.stat)}.`;
}

/** The natural 20 and natural 1 of a check, and the coin they call outside a fight. Each word is the coin's own. */
export function naturalLines(): readonly string[] {
  const w = VERDICT_WORDS;
  return [
    'A natural 20 on the d20 succeeds whatever the total, and a natural 1 fails whatever the total.',
    `Outside a fight, a natural 1 or 20 on a check also calls the coin: you call heads or tails, and in a room the GM's phone picks the side. On a 1, a right call reads ${w[verdict(1, 'heads', 'heads')]} and a wrong one ${w[verdict(1, 'heads', 'tails')]}. On a 20, a right call reads ${w[verdict(20, 'heads', 'heads')]} and a wrong one ${w[verdict(20, 'heads', 'tails')]}. The coin changes no number: the GM rules what it means.`,
  ];
}

/** How a stat's points are spent and locked in. */
export function pointsLine(): string {
  return 'Spend points with + on a stat. − takes back a point you have not confirmed. Confirm locks the points in; until then they wait, also after you leave the Status view. The GM can edit any stat, and that edit is confirmed at once.';
}

/** The level of the down line's worked example of a raising: one where the share of the shipped rule takes two levels. */
const RAISED_EXAMPLE = 31;
/**
 * What happens at 0 HP, from the life machine's own numbers (vitals.ts), the ways back from dead (`WAYS_BACK`), what a
 * raising costs (`reviveLevelShare`, worked by progress.ts `levelAfterRaising` at level 31), and the shop's door for the
 * dead (inventory.ts `shopOpen`): the sentence is there only while the rule closes it. `R` is the rules the page plays
 * by.
 */
export function downLine(R: Pick<Rules, 'reviveLevelShare'>): string {
  const shop = shopOpen({ life: { at: 'dead' } }) ? '' : ' The shop is closed to a dead hunter, who can neither buy nor sell. The GM or another hunter can still give a dead hunter a Resurrection Crystal.';
  const pct = Math.round(R.reviveLevelShare * 10000) / 100, back = levelAfterRaising(RAISED_EXAMPLE, R);
  const cost = back < RAISED_EXAMPLE
    ? ` A raising costs levels: ${pct}% of the hunter's level, rounded up, at least one and never below level 1, so a hunter who died at level ${RAISED_EXAMPLE} comes back at level ${back}.`
    : ' A raising costs no levels.';
  return `At 0 HP a hunter is down and makes death saves: a d20, ${SAVE_SUCCESS} or higher succeeds. ${SAVES_TO_END} successes make the hunter stable (still down, no more saves) and ${SAVES_TO_END} failures are fatal. A ${SAVE_UP} gets up at ${SAVE_UP_HP} HP, and a ${SAVE_FUMBLE} counts as ${FUMBLE_FAILURES} failures. The GM can stabilize a hunter. Healing and rest do not raise the dead: ${WAYS_BACK} from the bag does, at ${REVIVE_HP} HP, outside a fight.${cost}${shop}`;
}

/**
 * What a solo run is (gates/solo.ts): one play of the fight on the rules, the cost it leaves kept, a death possible,
 * the time cap a retreat; and the System's personal gates from `RULES.solo`, the first of them the even gate (`soloTick`),
 * and the share of a world gate's loot a cleared one pays (`solo.lootShare`, spawn.ts `lootShareOf`).
 */
export function soloLines(R: Pick<Rules, 'solo'>): readonly string[] {
  const S = R.solo;
  return [
    `A solo run plays one fight to its end on the rules. Before it, the odds show how ${ODDS_RUNS} plays of that fight went; the run is one more play and can go better or worse. What it leaves of HP, mana and fatigue stays. A hunter can die alone. A run with no winner by round ${CAP_ROUNDS} is a retreat: its cost stays and the gate stays open.`,
    ...(S.personal
      ? [`The System opens a personal gate every ${S.hours} hours, at most ${S.held} at once. Each closes ${S.stays} hours after it opens, cleared or not.`,
        `The first gate after personal gates start for a hunter (a new hunter, one revived, or personal gates turned back on) holds one monster of the hunter's own rank. The rest hold ${S.pack[0]} to ${S.pack[1]}, one rank below the hunter's to one above.`,
        `A cleared personal gate pays ${pct(S.lootShare)} of the loot a world gate of its rank rolls: ${pct(S.lootShare)} of the gold, rounded down, and an item ${pct(S.lootShare)} of the time. A world gate run alone pays as a world gate.`]
      : ['Personal gates are off.']),
  ];
}

/** Each event that may end a hide, in words (effect-ops.ts `STEALTH_ENDS`; the owner's rulings 2 and 6). */
const HIDE_END_WORDS: { readonly [E in StealthEnd]: string } = {
  hurt: 'its bearer loses HP',
  revealed: 'it is revealed, by a reveal such as a Flare\'s or by a hit from an area or from a use aimed at a place',
  dealt: 'its bearer\'s own use or reaction deals damage to a foe (not a field or a status it left earlier)',
};
/** The highest stealth level a foe of `sight` sees, by the one sight rule (sight.ts `perceives`), or null when it sees no hide. */
const seenUpTo = (sight: Level): Level | null => {
  const sees = (level: Level) => perceives({ place: place(0, 0), side: 'foe', up: true, sight }, { place: place(1, 0), side: 'party', stealth: level }, openGrid(2, 1), { kind: 'whole' });
  return HIDE_LEVELS.filter(sees).at(-1) ?? null;
};
/** The sight level of the line's example of a foe that sees some hides (Hunter's Eye's, kit-examples.ts). */
const SIGHT_EXAMPLE: Level = 2;
/**
 * Who sees a hidden body (sight.ts `perceives`, from everyone's `stealth.sightBase`), what a hit from hiding deals
 * (standing.ts `ambushShare` of a user and a target with no statuses), and what ends a hide (`STEALTH_ENDS`).
 */
export function stealthLines(R: Pick<Rules, 'fight'>): readonly string[] {
  const base = asLevel(R.fight.stealth.sightBase), atBase = seenUpTo(base), atExample = seenUpTo(SIGHT_EXAMPLE);
  const ambush = Math.round(ambushShare({ statuses: [] }, { statuses: [] }, R) * 100) / 100;
  const ends = STEALTH_ENDS.map(e => HIDE_END_WORDS[e]);
  return [
    `A hidden body is hidden from each foe whose sight level is lower than its stealth level. Everyone's sight level starts at ${base}, so a foe with no sight from a skill, an item or a status sees ${atBase === null ? 'no hidden body' : `a body hidden at level ${atBase} or lower`}; a foe with sight level ${SIGHT_EXAMPLE} sees ${atExample === null ? 'no hidden body' : `a body hidden at level ${atExample} or lower`}. Its own side always sees it.`,
    'A foe cannot aim at a hidden body it does not see. An area, or a use aimed at a place, still catches it, and that hit reveals it.',
    `A hit from hiding on a foe that does not see you deals ×${ambush} damage. It does not add to another damage increase: only the larger counts.`,
    `A hide ends when its time runs out, when a cure removes it, or on any of these its status names: ${ends.slice(0, -1).join('; ')}; or ${ends.at(-1)}.`,
  ];
}

/** One tier of the sale table: the price an unpriced item of it has (`priceOf`) and what the Bag pays for it (`sellPrice`). */
export interface SaleRow { readonly rar: Rarity; readonly price: number; readonly sell: number }

/** The sale table of the Loot section: a row for each rarity an item can carry, each figure from the function the game pays with. */
export function saleRows(R: PriceRules & Pick<Rules, 'saleShare'>): readonly SaleRow[] {
  return RARITIES.map(rar => ({ rar, price: priceOf(R, rar), sell: sellPrice({ rar, type: 'misc' }, R) }));
}

const pct = (share: number): string => `${Math.round(share * 1000) / 10}%`;
/** How an item that sets no price is priced and sold: the rank that prices each rarity, and the shares of `usedUpShare` and `saleShare`. */
export function saleLine(R: Pick<Rules, 'rarities' | 'usedUpShare' | 'saleShare'>): string {
  const ranks = RARITIES.map(rar => `${rar} ${R.rarities[rar].rank}`).join(', ');
  return `An item that sets no price costs one Clear of its tier's rank, the middle of that rank's gate-clear gold in the table below (${ranks}); a consumable costs ${pct(R.usedUpShare)} of that, rounded. The Association buys an item back at ${pct(R.saleShare)} of its price, rounded down, at least 1 gold.`;
}

/** What completing every daily gives: the daily quest's own points (the template a new hunter's daily is made from), and the streak's. */
export function dailyPointsLine(R: Pick<Rules, 'dailyTemplate' | 'streakBonusEvery'>): string {
  return `Completing every daily in a cycle grants +${R.dailyTemplate.rewards.points}, and every ${R.streakBonusEvery}-day streak grants +1 more.`;
}

/** The percent of a hit's size a body of `armor` takes off, before the flat part: what `afterDefence` (combat/land.ts) does with `armorK`. */
export const armorCutPct = (R: Pick<Rules, 'fight'>, armor: number): number => Math.round(100 - 100 * R.fight.armorK / (R.fight.armorK + armor));

/**
 * How a world gate pays (gates/pay.ts `shareEach`, design 4.1): its gold roll and its XP one pot of `gateParty` shares
 * among the hunters it pays; each one's share of 100 from 1 hunter to two past the party; a fight from a gate shared the
 * same way and one from no gate whole to each; a solo run of a world gate a party of one.
 */
export function gatePayLines(R: Pick<Rules, 'gateParty'>): readonly string[] {
  const P = R.gateParty, n = Array.from({ length: P + 2 }, (_, i) => i + 1);
  return [
    `A world gate is made for a party of ${P}. What it pays, its gold roll and its XP alike, is a pot of ${P} shares split evenly among the hunters it pays, rounded down: the fewer hunters, the more each, and past ${P} hunters the pot itself shrinks.`,
    `Each hunter's share of 100: ${n.map(k => `${shareEach(100, k, P)} ${k === 1 ? 'alone' : `of ${k}`}`).join(', ')}.`,
    'A fight started from a gate pays its XP the same way, out of the gate\'s XP; its Clear pays the rest. A fight started from no gate pays each hunter the whole XP of what went down.',
    `A solo run of a world gate is a party of one: ${P} times the gold roll and ${P} times the XP.`,
  ];
}

/**
 * Who drew the game's icons and where they come from (game-icons.net, CC BY 3.0, which asks for a mention); the authors
 * are the ones icons-credit.md names, which tests/rules-text.test.ts holds to this list.
 */
export const ICON_CREDIT = {
  authors: ['Lorc', 'Delapouite'],
  site: { text: 'game-icons.net', url: 'https://game-icons.net' },
  licence: { text: 'CC BY 3.0', url: 'https://creativecommons.org/licenses/by/3.0/' },
} as const;

/** The line at the Rules page's foot that credits the icons, as plain words. */
export const iconCreditLine = (): string =>
  `Icons made by ${ICON_CREDIT.authors.join(' and ')}, from ${ICON_CREDIT.site.text}, under ${ICON_CREDIT.licence.text}.`;
