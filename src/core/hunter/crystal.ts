// crystal.ts: mana crystal balance, gate crystal drops, and selling crystal for gold. Pure.
//
// One writer for `Hunter.crystal`: every live change to a hunter's mana crystal balance passes through `addCrystal`,
// `setCrystal`, or `sellCrystal` here (enforced by tests/lint.test.ts). Valuation is 1 mana crystal = 1 gold at Bureau
// assay (no dollars). System debt is gold-only: crystal never pays debt automatically and cannot be borrowed.
//
// Three buyers keep every choice meaningful on screen:
// - Helix clerk (90%): open to debt-free guild hunters.
// - Bureau exchange (85%): public counter, open to debt-free hunters and refused while you owe System debt.
// - Stair fence (70%): off-the-record buyer, open to any living hunter outside a fight, even while in System debt.
import type { GateType } from '../gates/gate.ts';
import type { HunterId, ItemId } from '../ids.ts';
import type { Item, Slot } from '../registry/items.ts';
import { RULES, priceBaseOf } from '../rules.ts';
import type { Rank, Rules } from '../rules.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { told } from '../session-log.ts';
import type { Said } from '../session-log.ts';
import type { Save } from '../save.ts';
import { effectiveCrystalShare } from './guild.ts';
import type { GuildMembership } from './guild.ts';
import { addGold, shopOpen } from './inventory.ts';
import type { Life } from './vitals.ts';

/** Bound for junk only, matching `DEBT_MAX` and `REWARD_BOUNDS.crystal`. */
export const CRYSTAL_MAX = 1_000_000_000;

/** The three crystal buyers, in display order from highest rate to lowest. */
export const CRYSTAL_BUYERS = ['helix', 'bureau', 'stair'] as const;
export type CrystalBuyer = (typeof CRYSTAL_BUYERS)[number];

/** Why a buyer is closed to a hunter right now. */
export type BuyerWhy = 'guild-only' | 'in-debt';
/** Why selling mana crystal may be refused. */
export type SellCrystalRefusal = 'missing' | 'dead' | 'in-fight' | 'bad-amount' | 'not-enough' | 'payout-zero' | BuyerWhy;

/** The rules read by gate crystal drop calculations. */
export type CrystalDropRules = Pick<Rules, 'priceBase' | 'gateParty' | 'crystal'> & Partial<Pick<Rules, 'guilds'>>;
/** The rules read by crystal selling calculations. */
export type CrystalExchangeRules = Pick<Rules, 'crystal'> & Partial<Pick<Rules, 'guilds'>>;

const fmtNum = (n: number): string => n.toLocaleString('en-US');
const pctOf = (rate: number): string => `${Math.round(rate * 1000) / 10}%`;

/**
 * Full distributable mana crystal pool of a world gate: `poolBase * priceBase` (4x), multiplied by `specialMult` (1.5x)
 * for Red and Double gates.
 */
export function gateCrystalPool(rank: Rank, type: GateType, R: Pick<Rules, 'priceBase' | 'crystal'>): number {
  const base = priceBaseOf(R, rank) * R.crystal.poolBase;
  const mult = type === 'red' || type === 'double' ? R.crystal.specialMult : 1;
  return Math.max(0, Math.floor(base * mult + 1e-9));
}

/**
 * Splits a party crystal pool among `n` payees for a gate sized for `party` hunters: mirrors `shareEach` without
 * dividing and multiplying back by `party` so non-power-of-two party sizes stay exact.
 */
export const splitPool = (partyPool: number, n: number, party: number): number =>
  (n <= 0 || partyPool <= 0 ? 0 : Math.floor(n <= party ? partyPool / n : (partyPool * party) / (n * n)));

/**
 * Each payee's mana crystal share from clearing a world gate without a guild contract: the gate pool multiplied by
 * `crystal.unsignedShare` (12% salvage), split among `n` payees with `splitPool`.
 */
export function clearCrystalEach(gate: { readonly rank: Rank; readonly type: GateType }, n: number, R: CrystalDropRules): number {
  const partyPool = Math.floor(gateCrystalPool(gate.rank, gate.type, R) * R.crystal.unsignedShare + 1e-9);
  return splitPool(partyPool, n, R.gateParty);
}

/**
 * One hunter's mana crystal share from clearing a world gate: uses the hunter's effective guild crystal share
 * (or `crystal.unsignedShare` when unsigned or unknown), split among `n` payees with `splitPool`.
 */
export function clearCrystalFor(
  gate: { readonly rank: Rank; readonly type: GateType },
  n: number,
  h: { readonly rank: Rank; readonly guild?: GuildMembership | null } | null,
  R: CrystalDropRules,
): number {
  const share = h ? effectiveCrystalShare(h, { crystal: R.crystal, guilds: R.guilds ?? RULES.guilds }) : R.crystal.unsignedShare;
  const partyPool = Math.floor(gateCrystalPool(gate.rank, gate.type, R) * share + 1e-9);
  return splitPool(partyPool, n, R.gateParty);
}

/** Solo mana crystal drop from clearing a personal gate: `personalShare * priceBase` (10%), kept in full. */
export function personalCrystal(rank: Rank, R: Pick<Rules, 'priceBase' | 'crystal'>): number {
  return Math.max(0, Math.floor(priceBaseOf(R, rank) * R.crystal.personalShare + 1e-9));
}

/** Whole gold paid for selling `amount` mana crystal at `rate`, rounded down with IEEE-754 guard. */
export function sellPayout(amount: number, rate: number): number {
  const n = Math.trunc(amount);
  if (!Number.isFinite(amount) || n <= 0 || !Number.isFinite(rate) || rate <= 0) return 0;
  return Math.max(0, Math.floor(n * rate + 1e-9));
}

/** Effective gold-per-crystal exchange rate for `buyer` under `R`. */
export const buyerRate = (_h: { readonly guild?: GuildMembership | null }, buyer: CrystalBuyer, R: CrystalExchangeRules): number =>
  R.crystal.rates[buyer];

/** Whether `buyer` will buy mana crystal from hunter `h`, or why not. */
export function buyerStatus(
  h: { readonly debt: number; readonly guild?: GuildMembership | null },
  buyer: CrystalBuyer,
): { readonly open: true } | { readonly open: false; readonly why: BuyerWhy } {
  if (buyer === 'helix') {
    if (!h.guild) return { open: false, why: 'guild-only' };
    if (h.debt > 0) return { open: false, why: 'in-debt' };
    return { open: true };
  }
  if (buyer === 'bureau' && h.debt > 0) return { open: false, why: 'in-debt' };
  return { open: true };
}

/** Default open buyer for hunter `h`: Helix clerk for debt-free guild hunters, Bureau for debt-free unsigned, Stair while in debt. */
export const defaultBuyer = (h: { readonly debt: number; readonly guild?: GuildMembership | null }): CrystalBuyer =>
  (h.debt > 0 ? 'stair' : h.guild ? 'helix' : 'bureau');

/** Planned crystal sale: validated amount, buyer, rate, gold paid, and remaining crystal balance. */
export type SellCrystalPlan = {
  readonly ok: true;
  readonly amount: number;
  readonly buyer: CrystalBuyer;
  readonly rate: number;
  readonly gold: number;
  readonly crystalAfter: number;
};

/** Checks whether hunter `h` can sell `amount` mana crystal to `buyer` under `R`. */
export function sellPlan(
  h: { readonly crystal: number; readonly debt: number; readonly life: Pick<Life, 'at'>; readonly guild?: GuildMembership | null },
  amount: number,
  buyer: CrystalBuyer,
  R: CrystalExchangeRules,
  inFight = false,
): SellCrystalPlan | Refused<SellCrystalRefusal> {
  if (!shopOpen(h)) return refuse('dead');
  if (inFight) return refuse('in-fight');
  const status = buyerStatus(h, buyer);
  if (status.open === false) return refuse(status.why);
  const amt = Math.trunc(amount);
  if (!Number.isFinite(amount) || amt <= 0) return refuse('bad-amount');
  if (amt > h.crystal) return refuse('not-enough');
  const rate = buyerRate(h, buyer, R);
  const gold = sellPayout(amt, rate);
  if (gold < 1) return refuse('payout-zero');
  return { ok: true, amount: amt, buyer, rate, gold, crystalAfter: h.crystal - amt };
}

/** Adds whole `delta` mana crystal (or removes when negative), clamped to `0..CRYSTAL_MAX`. */
export const addCrystal = <H extends { crystal: number }>(h: H, delta: number): H => ({
  ...h,
  crystal: Math.max(0, Math.min(CRYSTAL_MAX, h.crystal + (Math.trunc(delta) || 0))),
});

/** Sets mana crystal to a whole amount, clamped to `0..CRYSTAL_MAX` (for GM sheet edits). */
export const setCrystal = <H extends { crystal: number }>(h: H, amount: number): H => ({
  ...h,
  crystal: Math.max(0, Math.min(CRYSTAL_MAX, Math.trunc(amount) || 0)),
});

type ExchangeHunter = {
  readonly id: HunterId;
  readonly name: string;
  crystal: number;
  gold: number;
  readonly debt: number;
  readonly life: Pick<Life, 'at'>;
  readonly guild?: GuildMembership | null;
  items: Item[];
  equipped: Record<Slot, ItemId | null>;
};

/** Result of selling mana crystal on one hunter. */
export type SoldCrystal<H> = {
  readonly hunter: H;
  readonly amount: number;
  readonly buyer: CrystalBuyer;
  readonly rate: number;
  readonly gold: number;
  readonly line: Said;
};

/**
 * Sells `amount` mana crystal to `buyer` for gold in one pure transition: validates via `sellPlan`, deducts crystal,
 * adds gold through `addGold` (leaving System debt untouched), and builds the session log entry.
 */
export function sellCrystal<H extends ExchangeHunter>(
  h: H,
  amount: number,
  buyer: CrystalBuyer,
  R: CrystalExchangeRules,
  inFight = false,
): SoldCrystal<H> | Refused<SellCrystalRefusal> {
  const plan = sellPlan(h, amount, buyer, R, inFight);
  if (isRefused(plan)) return plan;
  const hunter = addGold({ ...h, crystal: plan.crystalAfter }, plan.gold);
  const buyerName = CRYSTAL_WORDS.buyers[buyer].name;
  const line: Said = {
    kind: 'award',
    hunterId: h.id,
    title: CRYSTAL_WORDS.logTitle,
    text: `${h.name} sold ${fmtNum(plan.amount)} mana crystal at ${buyerName} (${pctOf(plan.rate)}) for ${fmtNum(plan.gold)} gold.`,
  };
  return { hunter, amount: plan.amount, buyer, rate: plan.rate, gold: plan.gold, line };
}

/** Atomic save step: sells `amount` mana crystal for hunter `hid` and appends the session log entry. */
export function sellCrystalStep(
  save: Save,
  hid: string,
  amount: number,
  buyer: CrystalBuyer,
  ctx: { readonly at: string; readonly R: Pick<Rules, 'crystal' | 'logCap'> & Partial<Pick<Rules, 'guilds'>>; readonly inFight?: boolean },
): { readonly save: Save; readonly sold: SoldCrystal<Save['hunters'][number]> } | Refused<SellCrystalRefusal> {
  const at = save.hunters.findIndex(h => h.id === hid);
  if (at < 0) return refuse('missing');
  const res = sellCrystal(save.hunters[at]!, amount, buyer, ctx.R, !!ctx.inFight);
  if (isRefused(res)) return res;
  const hunters = save.hunters.map((x, i) => (i === at ? res.hunter : x));
  const next = told({ ...save, hunters }, { at: ctx.at, cap: ctx.R.logCap }, res.line);
  return { save: next, sold: res };
}

/** Plain-language words for mana crystal UI, exchange dialog, logs, and refusals. */
export const CRYSTAL_WORDS = {
  label: 'Mana crystal',
  sellButton: 'Sell crystal',
  adjustButton: 'Adjust crystal',
  adjustTitle: 'Adjust mana crystal',
  adjustLabel: (have: number): string => `Add or remove mana crystal (current ${fmtNum(have)})`,
  modalTitle: 'Sell mana crystal',
  balanceLine: (have: number): string => `You have ${fmtNum(have)} mana crystal. 1 mana crystal equals 1 gold at Bureau assay.`,
  amountLabel: 'Amount to sell',
  buyerLabel: 'Buyer',
  logTitle: 'Crystal exchange',
  confirmBtn: (gold: number): string => `Sell for ${fmtNum(gold)} gold`,
  confirmDisabled: 'Sell crystal',
  cancel: 'Cancel',
  preview: (amount: number, buyer: CrystalBuyer, rate: number, gold: number): string =>
    `You sell ${fmtNum(amount)} mana crystal at ${CRYSTAL_WORDS.buyers[buyer].name} (${pctOf(rate)}) for ${fmtNum(gold)} gold.`,
  soldToast: (amount: number, buyer: CrystalBuyer, gold: number): string =>
    `You sold ${fmtNum(amount)} mana crystal at ${CRYSTAL_WORDS.buyers[buyer].name} for ${fmtNum(gold)} gold.`,
  debtNote: 'Gold from selling mana crystal stays in your bag. It does not pay System debt automatically.',
  unavailableTag: 'Unavailable',
  buyers: {
    helix: {
      name: 'Helix clerk',
      note: 'Open to debt-free guild hunters.',
    },
    bureau: {
      name: 'Bureau exchange',
      note: 'Public counter for debt-free hunters.',
    },
    stair: {
      name: 'Stair fence',
      note: 'Off the record. Open even while you owe System debt.',
    },
  },
  buyerLocked: {
    'guild-only': 'Open to guild hunters only.',
    'in-debt': 'Closed while you owe System debt. Pay off your debt or use a Stair fence.',
  },
  refusals: {
    missing: 'This hunter no longer exists.',
    dead: 'You cannot sell mana crystal while you are dead.',
    'in-fight': 'You cannot sell mana crystal during a fight.',
    'bad-amount': 'Enter a whole number greater than 0.',
    'not-enough': 'You do not have that much mana crystal.',
    'payout-zero': 'That amount pays 0 gold at this rate. Sell more mana crystal or pick a higher rate.',
    'guild-only': 'Helix clerks serve guild hunters only.',
    'in-debt': 'Closed while you owe System debt. Use a Stair fence instead.',
  } as Readonly<Record<SellCrystalRefusal, string>>,
} as const;
