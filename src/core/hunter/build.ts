// build.ts: the GM's keystone switch (`rulesOverrides.fight.keystone.on`) and the room's `rules` doc (`roomRulesOf`,
// `withRoomRules`) laid over a player's own rules by src/edge/rules.ts while in a room, never written to the save. Pure.
import { withStatuses } from '../rules.ts';
import type { Rules } from '../rules.ts';
import type { Save } from '../save.ts';
import type { StatusDef } from '../combat/effect-ops.ts';
import { BUILT_IN_STATUSES, STATUS_KEYS } from '../registry/statuses.ts';
import { eachRarity } from '../protocol.ts';
import type { RoomRules } from '../protocol.ts';

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The save with the GM's keystone switch (`fight.keystone.on`) set to `on`, keeping all other overrides. */
export function keystoneSwitched<S extends Pick<Save, 'rulesOverrides'>>(save: S, on: boolean): S {
  const ov = isObj(save.rulesOverrides) ? save.rulesOverrides : {};
  const fight = isObj(ov.fight) ? ov.fight : {};
  const ks = isObj(fight.keystone) ? fight.keystone : {};
  return { ...save, rulesOverrides: { ...ov, fight: { ...fight, keystone: { ...ks, on } } } };
}

/** The fight rules a room carries over the phone's own: mythic scripts, keystone earning rules, and GM damage-type overrides. */
const fightOver = (R: Rules, room: RoomRules) => ({
  mythic: { ...R.fight.mythic, ...room.mythic },
  keystone: { ...R.fight.keystone, ...room.keystone },
  damageTypes: room.damageTypes,
});

/** Built-in status defs in `R.conditions` that differ from `BUILT_IN_STATUSES` (at most 16 entries, empty when none are overridden). */
function overriddenBuiltInStatuses(R: Rules): Record<string, StatusDef> {
  const out: Record<string, StatusDef> = {};
  for (const key of STATUS_KEYS) {
    const cur = R.conditions[key], shipped = BUILT_IN_STATUSES[key];
    if (cur && JSON.stringify(cur) !== JSON.stringify(shipped)) out[key] = cur;
  }
  return out;
}

/**
 * The rules a player's phone plays by while in a room: its own, with the room's (the GM's `rules` doc, `RoomRules`) over
 * them: personal gates' switch, hours and loot share, feats', trading's, mythic, keystone, damage-type overrides,
 * GM-edited built-in statuses, and the economy, so a price and damage type are the GM's on every phone. A rarity takes
 * the room's rank and keeps the phone's color. Nothing is copied into the player's save, so the player's own rules are
 * theirs again once the room is left.
 */
export function withRoomRules(R: Rules, room: RoomRules | null): Rules {
  if (!room) return R;
  const merged: Rules = {
    ...R,
    solo: { ...R.solo, ...room.solo },
    feats: { ...R.feats, ...room.feats },
    trade: { ...R.trade, ...room.trade },
    fight: { ...R.fight, ...fightOver(R, room) },
    shadow: { ...R.shadow, summonMp: room.shadow.summonMp },
    rarities: { ...R.rarities, ...eachRarity(r => ({ ...R.rarities[r], rank: room.rarities[r].rank })) },
    priceBase: room.priceBase,
    gradeStep: room.gradeStep,
    saleShare: room.saleShare,
    usedUpShare: room.usedUpShare,
    elixirPrices: room.elixirPrices,
    revivePrices: room.revivePrices,
    respecPrices: room.respecPrices,
    reviveDebtPrices: room.reviveDebtPrices,
    reviveDebtShare: room.reviveDebtShare,
    reviveDebtBurn: room.reviveDebtBurn,
    reviveDebtXpRate: room.reviveDebtXpRate,
    borrowCapPrices: room.borrowCapPrices,
    reviveLevelShare: room.reviveLevelShare,
    gateParty: room.gateParty,
    crystal: room.crystal,
    guilds: room.guilds,
    loot: room.loot,
  };
  return withStatuses(merged, room.statuses);
}

/** The room's `rules` doc the GM's phone publishes from its own rules: what `withRoomRules` lays over a player's. */
export const roomRulesOf = (R: Rules): RoomRules => ({
  solo: { personal: R.solo.personal, hours: R.solo.hours, lootShare: R.solo.lootShare },
  feats: { on: R.feats.on },
  trade: { on: R.trade.on },
  mythic: { scripts: R.fight.mythic.scripts },
  keystone: {
    on: R.fight.keystone.on,
    markShare: R.fight.keystone.markShare,
    pairShare: R.fight.keystone.pairShare,
    apexShare: R.fight.keystone.apexShare,
    markRank: R.fight.keystone.markRank,
    pairRank: R.fight.keystone.pairRank,
    apexRank: R.fight.keystone.apexRank,
  },
  damageTypes: R.fight.damageTypes,
  statuses: overriddenBuiltInStatuses(R),
  shadow: { summonMp: R.shadow.summonMp },
  rarities: eachRarity(r => ({ rank: R.rarities[r].rank })),
  priceBase: R.priceBase,
  gradeStep: R.gradeStep,
  saleShare: R.saleShare,
  usedUpShare: R.usedUpShare,
  elixirPrices: R.elixirPrices,
  revivePrices: R.revivePrices,
  respecPrices: R.respecPrices,
  reviveDebtPrices: R.reviveDebtPrices,
  reviveDebtShare: R.reviveDebtShare,
  reviveDebtBurn: R.reviveDebtBurn,
  reviveDebtXpRate: R.reviveDebtXpRate,
  borrowCapPrices: R.borrowCapPrices,
  reviveLevelShare: R.reviveLevelShare,
  gateParty: R.gateParty,
  crystal: R.crystal,
  guilds: R.guilds,
  loot: R.loot,
});
