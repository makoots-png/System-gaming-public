// rules-text.ts: the lines of the Rules page that state a rule the game plays elsewhere, worked out from the functions
// that play it, so the page cannot drift from the game (tests/rules-text.test.ts pins each one). Pure. The page itself
// is src/views/rulesref.js, which keeps its layout and calls these.
import type { Rank, Rules } from './rules.ts';
import { STAT_KEYS, STAT_LABELS, STAT_SHORT, above } from './stats.ts';
import type { StatKey } from './stats.ts';
import { STAT_PAIRS, keystoneKeyId, statsOfPair } from './hunter/keystones.ts';
import type { KeystoneDiff, KeystoneKey, KeystoneTier, NearestKeystone } from './hunter/keystones.ts';
import { keystoneOf } from './registry/keystones.ts';
import type { Keystone, KeystoneRegistryRules } from './registry/keystones.ts';
import { BUILT_IN_JOBS, JOB_NAMES } from './registry/jobs.ts';
import type { JobName } from './registry/jobs.ts';
import { statBonus } from './hunter/sheet.ts';
import { VERDICT_WORDS, verdict } from './coin.ts';
import { CAP_ROUNDS } from './combat/play.ts';
import { ODDS_RUNS } from './combat/odds.ts';
import { sellPrice, shopOpen } from './hunter/inventory.ts';
import { borrowCap, debtTermsLine } from './hunter/revive-standing.ts';
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
    `Outside a fight, a natural 1 or 20 on a check also triggers a coin flip, and you call heads or tails. When playing alone, the app flips the coin. In a room, the GM decides how it lands and tells you at the table. You only see on your phone that it was flipped. On a 1, a right call is ${w[verdict(1, 'heads', 'heads')]} and a wrong call is ${w[verdict(1, 'heads', 'tails')]}. On a 20, a right call is ${w[verdict(20, 'heads', 'heads')]} and a wrong call is ${w[verdict(20, 'heads', 'tails')]}. The coin does not change any numbers. The GM decides what it means.`,
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
export function deathLine(R: Pick<Rules, 'reviveLevelShare' | 'reviveDebtClears' | 'reviveDebtShare' | 'reviveDebtBurn' | 'reviveDebtXpRate'>): string {
  const shop = shopOpen({ life: { at: 'dead' } }) ? '' : ' A dead hunter cannot buy or sell in the shop. The GM or another hunter can still give a dead hunter a Resurrection Crystal.';
  const pctNum = (n: number): number => Math.round(n * 10000) / 100;
  const pct = pctNum(R.reviveLevelShare), back = levelAfterRaising(RAISED_EXAMPLE, R);
  const cost = back < RAISED_EXAMPLE
    ? ` Reviving costs ${pct}% of the hunter's level, rounded up (at least 1 level, never below level 1). For example, a hunter who died at level ${RAISED_EXAMPLE} comes back at level ${back}.`
    : ' Reviving costs no levels.';
  const share = Math.min(1, Math.max(0, R.reviveDebtShare));
  const burn = Math.min(1 - share, Math.min(1, Math.max(0, R.reviveDebtBurn)));
  const keep = Math.max(0, 1 - share - burn);
  const xpRate = Math.min(1, Math.max(0, R.reviveDebtXpRate));
  const goldSplit = share > 0 && burn > 0
    ? ` While you owe debt, ${pctNum(share)}% of your gate clear gold goes to your debt, you get ${pctNum(keep)}%, and ${pctNum(burn)}% is lost to debt costs.`
    : share > 0
      ? ` While you owe debt, ${pctNum(share)}% of your gate clear gold goes to your debt, and you get ${pctNum(keep)}%.`
      : burn > 0
        ? ` While you owe debt, you get ${pctNum(keep)}% of your gate clear gold, and ${pctNum(burn)}% is lost to debt costs.`
        : '';
  const xpCut = xpRate < 1 ? ` You also earn ${pctNum(xpRate)}% XP from every source until your debt is paid off.` : '';
  const debt = ` A System revive on debt costs ${R.reviveDebtClears} same-rank gate clears.${goldSplit}${xpCut}`;
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
    `A solo run simulates the fight automatically using the game rules.${harder} Before you start, you can see the results of ${ODDS_RUNS} simulated fights. Your solo run is a separate fight and can turn out better or worse. Your remaining HP, mana, and fatigue carry over after the run, and your hunter can die. If neither side wins by round ${CAP_ROUNDS}, you retreat. Your spent HP, mana, and fatigue stay used, and the gate stays open.`,
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
/** How shop borrowing works (inventory.ts `buyPlan`, revive-standing.ts `borrowCap`), from the room's rules. */
export function borrowLine(R: Pick<Rules, 'borrowCapClears' | 'loot' | 'reviveDebtShare' | 'reviveDebtBurn' | 'reviveDebtXpRate'>): string {
  if (R.borrowCapClears <= 0) return 'Shop borrowing is off.';
  const clears = `${R.borrowCapClears} same-rank gate clear${R.borrowCapClears === 1 ? '' : 's'}`;
  if (R.reviveDebtShare <= 0) return `Shop borrowing is set to ${clears}, but borrowing is paused while debt payments from gate clears are at 0%.`;
  const capE = borrowCap('E', R).toLocaleString('en-US');
  const terms = debtTermsLine(R);
  return `You can borrow in the shop when short of gold, up to ${clears} of total System debt (for example, ${capE} gold at rank E). You spend your gold first, and the rest adds to your System debt.${terms ? ` ${terms}` : ''} A System revive ignores the borrow limit.`;
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

/** The GM's switch for keystones, shown in the Build panel. */
export const KEYSTONE_SWITCH_WORDS = {
  label: 'Keystones', on: 'On', off: 'Off',
  hint: 'When on, hunters earn keystones by focusing ability points in one or two stats.',
} as const;

/** Static labels and headings for keystone screens so views and browser tests share one word table. */
export const KEYSTONE_WORDS = {
  panelTitle: 'Keystones',
  codexTitle: 'Keystones',
  browseAll: 'Browse all 44 keystones',
  noneEarned: 'No keystones earned yet.',
  earnedBadge: 'Earned',
  awakenedBadge: 'Awakened',
  tierAll: 'All',
  tierMarks: 'Marks',
  tierConfluences: 'Confluences',
  tierApexes: 'Apexes',
  statFilterLabel: 'Stat',
  statAll: 'All stats',
  searchLabel: 'Search keystones',
  searchPlaceholder: 'Name, stat, or effect',
  noMatch: 'No keystones match that filter.',
  jobPairPrefix: 'Job pair: ',
  awakenedPrefix: 'Awakened (after Job Change): ',
  confirmAction: 'Confirm allocation',
} as const;

/** One entry of the Keystones codex view, built from the registry and rules. */
export type KeystoneCodexEntry = {
  readonly id: string;
  readonly key: KeystoneKey;
  readonly name: string;
  readonly line: string;
  readonly tierLabel: string;
  readonly requirement: string;
  readonly stats: readonly StatKey[];
  readonly jobs: readonly JobName[];
  readonly awakenedLine: string | null;
};

const joinAnd = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : items.length === 2 ? `${items[0]} and ${items[1]}` : `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;

/** Whole-percent share shown inside an allocation stat cell ("31% of points"). */
export const keystoneShareText = (share: number): string => `${Math.round(share * 100)}% of points`;
/** Full accessible description for a stat's share ("31% of your spent ability points"). */
export const keystoneShareAria = (share: number): string => `${Math.round(share * 100)}% of your spent ability points`;

/** Human-readable tier and stat label ("Mark of Strength", "Confluence of Strength and Discipline", "Apex of Strength"). */
export function keystoneTierLabel(key: KeystoneKey): string {
  if (key.tier === 'confluence') {
    const [a, b] = statsOfPair(key.pair);
    return `Confluence of ${STAT_LABELS[a]} and ${STAT_LABELS[b]}`;
  }
  return `${key.tier === 'mark' ? 'Mark' : 'Apex'} of ${STAT_LABELS[key.stat]}`;
}

/** Plain description of a confluence's awakened powers, or null when a keystone has none. */
export function keystoneAwakenedLine(k: Keystone): string | null {
  if (!k.awakened) return null;
  return k.awakened.worn?.desc || k.awakened.active?.name || null;
}

/** Confirm bar preview line naming keystones gained or lost by pending points; empty when unchanged or off. */
export function keystoneConfirmLine(diff: KeystoneDiff, R: KeystoneRegistryRules & Pick<Rules, 'fight'>): string {
  if (!R.fight.keystone.on) return '';
  const nameOf = (key: KeystoneKey): string => `${keystoneOf(key, R).name} (${keystoneTierLabel(key)})`;
  const earned = diff.earned.map(nameOf), lost = diff.lost.map(nameOf);
  if (!earned.length && !lost.length) return '';
  if (earned.length && lost.length) return `Tap ${KEYSTONE_WORDS.confirmAction} to earn ${joinAnd(earned)} and lose ${joinAnd(lost)}.`;
  return earned.length ? `Tap ${KEYSTONE_WORDS.confirmAction} to earn ${joinAnd(earned)}.` : `Tap ${KEYSTONE_WORDS.confirmAction} to lose ${joinAnd(lost)}.`;
}

/** The sheet's nearest-unearned keystone line, derived from `nearestKeystone` and the active rules. */
export function keystoneNextLine(nearest: NearestKeystone | null, R: KeystoneRegistryRules & Pick<Rules, 'fight'>, totalSpent: number): string {
  const K = R.fight.keystone;
  if (!K.on) return '';
  if (totalSpent === 0) return `Spend ability points to earn keystones. Put ${pct(K.markShare)} in one stat to earn its Mark at rank ${K.markRank}.`;
  if (!nearest) return '';
  if (nearest.kind === 'stat') {
    const { stat, current, next } = nearest, ks = keystoneOf(next.key, R);
    if (next.shareMet && !next.rankMet) return `Rank ${next.rank} opens your ${keystoneTierLabel(next.key)}: ${ks.name}.`;
    const cur = Math.round(current * 100), need = pct(next.share), cmp = next.key.tier === 'apex' ? `Over ${need}` : `At ${need}`;
    return next.rankMet
      ? `You have ${cur}% of your ability points in ${STAT_LABELS[stat]}. ${cmp}, you earn ${ks.name}.`
      : `You have ${cur}% of your ability points in ${STAT_LABELS[stat]}. ${cmp} and at rank ${next.rank}, you earn ${ks.name}.`;
  }
  const { reach } = nearest, ks = keystoneOf(reach.key, R), [a, b] = reach.stats, [sa, sb] = reach.shares;
  if (reach.shareMet && !reach.rankMet) return `Rank ${reach.rank} opens your ${keystoneTierLabel(reach.key)}: ${ks.name}.`;
  const need = pct(reach.share), curA = Math.round(sa * 100), curB = Math.round(sb * 100);
  if (reach.rankMet) {
    if (sa >= reach.share && sb < reach.share) return `You have ${curB}% of your ability points in ${STAT_LABELS[b]}. At ${need} alongside ${STAT_LABELS[a]}, you earn ${ks.name}.`;
    if (sb >= reach.share && sa < reach.share) return `You have ${curA}% of your ability points in ${STAT_LABELS[a]}. At ${need} alongside ${STAT_LABELS[b]}, you earn ${ks.name}.`;
    return `You have ${curA}% in ${STAT_LABELS[a]} and ${curB}% in ${STAT_LABELS[b]}. At ${need} in each, you earn ${ks.name}.`;
  }
  return `You have ${curA}% in ${STAT_LABELS[a]} and ${curB}% in ${STAT_LABELS[b]}. At ${need} in each and rank ${reach.rank}, you earn ${ks.name}.`;
}

/**
 * The Rules page lines for keystones (notes-11-keystones.md A.4, unit K6): empty while `fight.keystone.on` is off so no
 * player sees keystone words before the switch is on. Each share and rank is read live from `R.fight.keystone`.
 */
export function keystoneLines(R: Pick<Rules, 'fight'>): readonly string[] {
  const K = R.fight.keystone;
  if (!K.on) return [];
  return [
    'Spreading points across several stats is worth about as much as focusing on one on the sheet.',
    `Put ${pct(K.markShare)} of your spent ability points in one stat to earn its Mark at rank ${K.markRank}.`,
    `Put ${pct(K.pairShare)} in each of your two highest stats (or your job's pair) to earn their Confluence at rank ${K.pairRank}.`,
    `Put over ${pct(K.apexShare)} in one stat to earn its Apex at rank ${K.apexRank}.`,
  ];
}

/** Section header condition line for one tier in the Keystones codex view. */
export function keystoneTierCondition(tier: KeystoneTier, R: Pick<Rules, 'fight'>): string {
  const K = R.fight.keystone;
  if (tier === 'mark') return `Rank ${K.markRank} or higher, and ${pct(K.markShare)} of your spent ability points in one stat.`;
  if (tier === 'confluence') return `Rank ${K.pairRank} or higher, and ${pct(K.pairShare)} in each of your two highest stats (or your job's pair).`;
  return `Rank ${K.apexRank} or higher, and over ${pct(K.apexShare)} of your spent ability points in one stat.`;
}

/** Filtered count line for the Keystones codex view ("44 keystones" or "8 of 44 keystones"). */
export const keystoneCountLine = (shown: number, total: number): string =>
  shown === total ? `${total} keystone${total === 1 ? '' : 's'}` : `${shown} of ${total} keystones`;

/** All 44 keystones with their condition badge, job links, and awakened lines for the Keystones codex view. */
export function keystoneCodexEntries(R: KeystoneRegistryRules & Pick<Rules, 'fight'>): readonly KeystoneCodexEntry[] {
  const K = R.fight.keystone;
  const jobsFor = (pair: string): JobName[] => JOB_NAMES.filter(j => BUILT_IN_JOBS[j].pair === pair);
  const keys: KeystoneKey[] = [
    ...STAT_KEYS.map(stat => ({ tier: 'mark' as const, stat })),
    ...STAT_PAIRS.map(pair => ({ tier: 'confluence' as const, pair })),
    ...STAT_KEYS.map(stat => ({ tier: 'apex' as const, stat })),
  ];
  return keys.map(key => {
    const ks = keystoneOf(key, R);
    const stats = key.tier === 'confluence' ? statsOfPair(key.pair) : [key.stat];
    const requirement = key.tier === 'mark'
      ? `${STAT_SHORT[key.stat]} · ${pct(K.markShare)} · Rank ${K.markRank}`
      : key.tier === 'confluence'
        ? `${STAT_SHORT[stats[0]!]} + ${STAT_SHORT[stats[1]!]} · ${pct(K.pairShare)} each · Rank ${K.pairRank}`
        : `${STAT_SHORT[key.stat]} · over ${pct(K.apexShare)} · Rank ${K.apexRank}`;
    return {
      id: keystoneKeyId(key),
      key,
      name: ks.name,
      line: ks.line,
      tierLabel: keystoneTierLabel(key),
      requirement,
      stats,
      jobs: key.tier === 'confluence' ? jobsFor(key.pair) : [],
      awakenedLine: keystoneAwakenedLine(ks),
    };
  });
}
