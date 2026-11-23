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
import { REVIVE_HP, WAYS_BACK } from './hunter/vitals.ts';
import { levelAfterRaising } from './hunter/progress.ts';
import { ambushShare } from './combat/standing.ts';
import { LEVELS, asLevel } from './combat/sight-levels.ts';
import type { Level } from './combat/sight-levels.ts';
import { perceives } from './combat/sight.ts';
import { openGrid, place } from './combat/space.ts';
import { STEALTH_ENDS } from './combat/effect-ops.ts';
import type { MythicScript } from './combat/mythic-types.ts';
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
  return `Near ${base}, effective points are close to the score minus ${base}. The check bonus is half of that, rounded down. For example, a score of ${x.score} has about ${fmtX(x.above)} points above ${base} and adds ${sign(x.stat)}.`;
}

/** The natural 20 and natural 1 of a check, and the coin they call outside a fight. Each word is the coin's own. */
export function naturalLines(): readonly string[] {
  const w = VERDICT_WORDS;
  return [
    'A natural 20 on the d20 succeeds whatever the total, and a natural 1 fails whatever the total.',
    `Outside a fight, a natural 1 or 20 on a check also triggers a coin flip, and you call heads or tails. When playing alone, the app flips the coin. In a room, the GM decides how it lands and tells you at the table, while your phone only shows that it was flipped. On a 1, a right call is ${w[verdict(1, 'heads', 'heads')]} and a wrong call is ${w[verdict(1, 'heads', 'tails')]}. On a 20, a right call is ${w[verdict(20, 'heads', 'heads')]} and a wrong call is ${w[verdict(20, 'heads', 'tails')]}. The coin does not change any numbers. The GM decides what it means.`,
  ];
}

/** How a stat's points are spent and locked in. */
export function pointsLine(): string {
  return 'Tap + on a stat to spend a point. Tap − to take back an unconfirmed point. Tap Confirm allocation to lock your points in. Until you confirm, they stay unconfirmed even if you leave the Status view. The GM can edit any stat, and those edits lock in right away.';
}

/** The level of the death line's worked example of a raising: one where the share of the shipped rule takes two levels. */
const RAISED_EXAMPLE = 31;
/**
 * The Rules page's lines about a rest (rests.ts, vitals.ts `rest` and `cleared`), from the room's rules: what a rest
 * gives back, how many a gate, what a Clear gives back, and that the dead and a fight take none.
 */
export function restLines(R: Pick<Rules, 'rest' | 'fatigue'>): string[] {
  const pct = (share: number): string => `${Math.round(share * 10000) / 100}%`, n = R.rest.perGate;
  return [
    `Resting restores ${pct(R.rest.hp)} of your max HP and ${pct(R.rest.mana)} of your max mana, up to your maximum. It also removes ${pct(R.rest.fatigue)} of your fatigue. Exhausted ends once your remaining fatigue drops below ${R.fatigue.collapseAt}% of your capacity.`,
    `You get ${n} rest${n === 1 ? '' : 's'} per gate. Clearing a gate restores full HP and mana, clears your fatigue, resets per-gate uses, and resets your rests. Finishing a solo run also resets your rests.`,
    `A dead hunter cannot rest and gains nothing from clearing a gate. ${WAYS_BACK} brings you back. You cannot rest during a fight.`,
  ];
}
/**
 * What happens at 0 HP, from the life machine's own numbers (vitals.ts), the ways back from dead (`WAYS_BACK`), what a
 * raising costs (`reviveLevelShare`, worked by progress.ts `levelAfterRaising` at level 31), and the shop's door for the
 * dead (inventory.ts `shopOpen`): the sentence is there only while the rule closes it. `R` is the rules the page plays
 * by.
 */
export function deathLine(R: Pick<Rules, 'reviveLevelShare' | 'reviveDebtClears' | 'reviveDebtShare'>): string {
  const shop = shopOpen({ life: { at: 'dead' } }) ? '' : ' A dead hunter cannot buy or sell in the shop. The GM or another hunter can still give a dead hunter a Resurrection Crystal.';
  const pct = Math.round(R.reviveLevelShare * 10000) / 100, back = levelAfterRaising(RAISED_EXAMPLE, R);
  const cost = back < RAISED_EXAMPLE
    ? ` Reviving costs ${pct}% of the hunter's level, rounded up (at least 1 level, never below level 1). For example, a hunter who died at level ${RAISED_EXAMPLE} comes back at level ${back}.`
    : ' Reviving costs no levels.';
  const debtPct = Math.round(R.reviveDebtShare * 10000) / 100;
  const debt = R.reviveDebtShare > 0
    ? ` A System revive on debt costs ${R.reviveDebtClears} same-rank gate clears. ${debtPct}% of your gate clear gold goes toward that debt until it is paid off.`
    : ` A System revive on debt costs ${R.reviveDebtClears} same-rank gate clears.`;
  return `At 0 HP, a hunter is dead. Healing and resting cannot revive a dead hunter. ${WAYS_BACK} revives them with ${REVIVE_HP} HP and removes every status, so poison does not kill them again. Use a Resurrection Crystal from your bag outside a fight.${cost}${debt}${shop}`;
}

/**
 * What a solo run is (gates/solo.ts): one play of the fight on the rules, the cost it leaves kept, a death possible,
 * the time cap a retreat; and the System's personal gates from `RULES.solo`, the first of them the even gate (`soloTick`),
 * and the share of a world gate's loot a cleared one pays (`solo.lootShare`, spawn.ts `lootShareOf`); how much harder
 * its foes are (`solo.autoHarder`, the square root of it on their HP and on their damage, solo.ts `soloFight`).
 */
export function soloLines(R: Pick<Rules, 'solo'>): readonly string[] {
  const S = R.solo, root = Math.round(Math.sqrt(S.autoHarder) * 100) / 100;
  const harder = S.autoHarder > 1 ? ` Foes in a solo run are ${pct(S.autoHarder - 1)} stronger than in table play. Each has ${root} times its normal HP and deals ${root} times its normal damage.` : '';
  return [
    `A solo run simulates the fight automatically using the game rules.${harder} Before you start, the odds show the results of ${ODDS_RUNS} simulated fights. Your solo run is a separate fight and can turn out better or worse. Your remaining HP, mana, and fatigue carry over after the run, and your hunter can die. If neither side wins by round ${CAP_ROUNDS}, you retreat. Your spent HP, mana, and fatigue stay used, and the gate stays open.`,
    ...(S.personal
      ? [`The System opens a personal gate every ${S.hours} hours, up to ${S.held} at a time. Each gate closes ${S.stays} hours after opening, whether cleared or not.`,
        `Your first personal gate (as a new hunter, after reviving, or after personal gates turn back on) has one monster of your rank. Later personal gates have ${S.pack[0]} to ${S.pack[1]} monsters, ranging from one rank below yours to one rank above.`,
        `Clearing a personal gate gives ${pct(S.lootShare)} of the loot of a same-rank world gate. You get ${pct(S.lootShare)} of the gold, rounded down, and a ${pct(S.lootShare)} chance for an item. Running a world gate solo gives full world-gate loot.`]
      : ['Personal gates are off.']),
  ];
}

/** Each event that may end a hide, in words (effect-ops.ts `STEALTH_ENDS`; the owner's rulings 2 and 6). */
const HIDE_END_WORDS: { readonly [E in StealthEnd]: string } = {
  hurt: 'the hidden target loses HP',
  revealed: 'a reveal ability (like Flare), an area effect, or a targeted tile hit reveals it',
  dealt: 'the hidden target deals damage to a foe with an ability or reaction (not from an earlier field or status)',
};
/** The highest stealth level a foe of `sight` sees, by the one sight rule (sight.ts `perceives`), or null when it sees no hide. */
const seenUpTo = (sight: Level): Level | null => {
  const sees = (level: Level) => perceives({ place: place(0, 0), side: 'foe', up: true, sight }, { place: place(1, 0), side: 'party', stealth: level }, openGrid(2, 1), { kind: 'whole' });
  return LEVELS.filter(sees).at(-1) ?? null;
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
    `A foe cannot see a hidden target if the foe's sight level is equal to or lower than the target's stealth level. Everyone starts at sight level ${base}. A foe with no extra sight from skills, items, or statuses sees ${atBase === null ? 'no hidden targets' : `targets hidden at level ${atBase} or lower`}. A foe with sight level ${SIGHT_EXAMPLE} sees ${atExample === null ? 'no hidden targets' : `targets hidden at level ${atExample} or lower`}. Allies always see hidden allies.`,
    'A foe cannot target a hidden hunter or monster it cannot see. Area attacks and abilities aimed at a tile still hit it and reveal it.',
    `Hitting a foe that cannot see you from hiding deals ×${ambush} damage. This does not stack with other damage multipliers. Only the largest multiplier applies.`,
    `Hiding ends when its duration runs out, when a cure removes it, or when one of its status triggers happens: ${ends.slice(0, -1).join(', ')}, or ${ends.at(-1)}.`,
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
  return `An item with no custom price costs the middle gold value of a gate clear for its rarity's rank (${ranks}). A consumable costs ${pct(R.usedUpShare)} of that amount, rounded. You can sell items back to the Association for ${pct(R.saleShare)} of their price, rounded down, with a minimum of 1 gold.`;
}

/** What completing every daily gives: the daily quest's own points (the template a new hunter's daily is made from), and the streak's. */
export function dailyPointsLine(R: Pick<Rules, 'dailyTemplate' | 'streakBonusEvery'>): string {
  return `Completing all daily quests in a cycle gives +${R.dailyTemplate.rewards.points} ability point${R.dailyTemplate.rewards.points === 1 ? '' : 's'}, and every ${R.streakBonusEvery}-day streak gives +1 more.`;
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
    `A world gate is sized for a party of ${P}. Its total gold and XP equal ${P} shares split evenly among the hunters in the gate, rounded down. Fewer hunters get more each. With more than ${P} hunters, the total reward shrinks.`,
    `Each hunter's share of 100: ${n.map(k => `${shareEach(100, k, P)} ${k === 1 ? 'alone' : `of ${k}`}`).join(', ')}.`,
    'A fight inside a gate splits monster XP the same way from the gate total, and clearing the gate awards the rest. A fight outside a gate gives each hunter the full XP for every defeated monster.',
    `Running a world gate solo counts as a party of one, giving ${P} times the gold roll and ${P} times the XP.`,
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

/**
 * How a mythic fights, as the Rules page states it (notes-11-keystones.md B.5, unit MY7): phases that each hold part of its
 * HP, the omen it announces a turn ahead, the three answers that are not a hit (a stun or root, a shield on the hunter it
 * names, a step off the tile it marks) and what an answer buys, and the enraged phase past its clock. Each number is a rule.
 */
export function mythicLines(R: Pick<Rules, 'fight'>): readonly string[] {
  const M = R.fight.mythic, t = M.answerTime, rounds = (n: number): string => `${n} round${n === 1 ? '' : 's'}`;
  return [
    'A mythic monster fights in phases. Each phase has its own HP pool. Extra damage past a phase break does not carry over, and the next phase starts on the mythic\'s next turn. A Dive phase has no HP pool and ends when its timer runs out.',
    'Before its biggest moves, a mythic announces an omen one turn ahead. The omen banner lists the move, its targets or tiles, and how you can answer it.',
    `A single ordinary hit does not answer an omen. Depending on the omen, you can cancel or weaken it by applying a control status (such as stun, root, or taunt), shielding the targeted hunter, stepping off the targeted tile, filling its stagger bar, or dealing heavy burst damage. Answering an omen extends the phase timer by ${rounds(t.cancel)} if canceled or ${rounds(t.weaken)} if weakened, up to the phase's starting limit.`,
    'If a phase runs past its timer, the mythic becomes enraged and uses its doom move on the schedule shown in the status bar.',
  ];
}

/** The line a mythic's codex entry adds: what kind of fight it is, then each phase by number, name and line. */
export function mythicCodexLines(script: MythicScript): readonly string[] {
  return [`The fight: ${script.shape}`, ...script.phases.map((p, i) => `Phase ${i + 1}: ${p.name}. ${p.line}`)];
}

/** The GM's switch for mythic scripts, its words, and the session log's line when it moves. */
export const MYTHIC_SWITCH_WORDS = {
  label: 'Mythics fight in phases', on: 'On', off: 'Off',
  hint: 'When off, mythic monsters fight like normal monsters. Fights already in progress do not change.',
} as const;
