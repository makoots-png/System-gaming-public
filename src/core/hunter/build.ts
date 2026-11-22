// build.ts: a hunter's build path (`hunter.build`: the path and the perk picked at each rank) and the GM's two switches
// for builds (`rulesOverrides.build`: builds on, players pick; a player's phone in a room plays by the room's instead,
// laid over its own by `withRoomRules` in src/edge/rules.ts, never written to its save, with the room's other rules:
// the personal gates' and the economy's). The Build panel and the GM's build menu (custom.js), and
// a reward's build part (hunter.js `applyRewards`) change them only here, as steps. Pure: the caller passes the rules,
// whether the phone is the GM's, and whether the hunter is in a fight. The paths, their perks and what they add are
// rules.ts (`pathOf`, `perkOf`, `tiersOpen`, `pathBonus`). The ability points a path's Auto spends are progress.ts's.
import { BONUS_KEYS, BONUS_LABELS, pathOf, perkOf, tiersOpen } from '../rules.ts';
import type { Perk, Rules } from '../rules.ts';
import type { Build, Hunter, Save } from '../save.ts';
import { eachRarity } from '../protocol.ts';
import type { BuildChange, RoomRules } from '../protocol.ts';
import { addGold } from './inventory.ts';
import { refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';

/** Who is changing the build: the GM's phone picks and respecs for free and whatever the players-pick switch says. */
export type BuildRole = 'gm' | 'player';
export type BuildWhy = 'no-path' | 'has-path' | 'off' | 'gm-picks' | 'not-next' | 'locked' | 'in-fight' | 'short';

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Whether builds are on (the GM's switch). */
export const buildsOn = (R: Rules): boolean => R.build.enabled !== false;
/** Whether `role` may pick a path and perks: the GM always, a player while the players-pick switch is on. */
export const mayPick = (R: Rules, role: BuildRole): boolean => role === 'gm' || R.build.playerPick !== false;
/** What a player's own respec costs: the rules' `respecGold` (5 when unreadable) times the level squared. */
export function respecCost(h: Pick<Hunter, 'level'>, R: Rules): number {
  const g = Number(R.build.respecGold);
  return (Number.isFinite(g) && g >= 0 ? Math.trunc(g) : 5) * h.level * h.level;
}
/** A perk's words: "STR +2, HP +5", or a dash for none. */
export const perkText = (b: Perk): string =>
  BONUS_KEYS.filter(k => isObj(b) && Number.isFinite(b[k]) && b[k]).map(k => `${BONUS_LABELS[k]} +${Math.trunc(b[k]!)}`).join(', ') || '—';

const withBuild = (h: Hunter, build: Build): Hunter => ({ ...h, build });

/** Path `id` chosen, with no perks yet. A hunter with a path keeps it unless `force` (the GM's Set path). */
export function choosePath(h: Hunter, id: string, R: Rules, force = false): Hunter | Refused<BuildWhy> {
  if (!pathOf(R, id)) return refuse('no-path');
  if (h.build.path && !force) return refuse('has-path');
  return withBuild(h, { path: id, picks: [] });
}

/** The perk `choice` (0 or 1) of rank tier `tier` picked: only the next tier, only one the hunter's rank has opened. */
export function pickPerk(h: Hunter, tier: number, choice: number, R: Rules, role: BuildRole): Hunter | Refused<BuildWhy> {
  const p = pathOf(R, h.build.path);
  if (!p) return refuse('no-path');
  if (!buildsOn(R)) return refuse('off');
  if (!mayPick(R, role)) return refuse('gm-picks');
  if (tier !== h.build.picks.length || (choice !== 0 && choice !== 1)) return refuse('not-next');
  if (tier >= tiersOpen(p, h.rank)) return refuse('locked');
  return withBuild(h, { path: h.build.path, picks: [...h.build.picks, choice] });
}

/** Why a player cannot buy a respec now, or null when they can. The GM's phone never asks. */
export function respecBlock(h: Hunter, R: Rules, inFight: boolean): BuildWhy | null {
  if (!h.build.path) return 'no-path';
  if (inFight) return 'in-fight';
  if (h.gold < respecCost(h, R)) return 'short';
  return null;
}
/**
 * The path and perks cleared. The GM's is free; a player's pays `respecCost` in gold (inventory.ts `addGold`) in the same step, and is refused
 * while builds are off, while only the GM picks, in a fight, or when short of gold. Ability points are not refunded.
 */
export function respec(h: Hunter, R: Rules, role: BuildRole, inFight: boolean): Hunter | Refused<BuildWhy> {
  if (role === 'gm') return withBuild(h, { path: null, picks: [] });
  if (!buildsOn(R)) return refuse('off');
  if (!mayPick(R, role)) return refuse('gm-picks');
  const why = respecBlock(h, R, inFight);
  if (why) return refuse(why);
  return addGold(withBuild(h, { path: null, picks: [] }), -respecCost(h, R));
}

/**
 * A reward's build part, from the GM (an award or a quest): a respec, a path set, or the next tier's perk picked for the
 * player (even with players-pick off). Answers the build and the reward line; a stale or repeated pick changes nothing.
 */
export function buildAward(h: Hunter, spec: BuildChange, R: Rules): { build: Build; line: string } {
  if (spec === 'respec') return { build: { path: null, picks: [] }, line: 'Path and perks cleared: choose a new path.' };
  if ('tier' in spec) {
    const p = pathOf(R, h.build.path), t = spec.tier, c = spec.pick;
    if (!buildsOn(R) || !p || !Number.isInteger(t) || t !== h.build.picks.length || t >= tiersOpen(p, h.rank) || (c !== 0 && c !== 1)) return { build: h.build, line: '' };
    return { build: { path: h.build.path, picks: [...h.build.picks, c] }, line: `Perk: ${perkText(perkOf(p, t, c))}` };
  }
  const p = pathOf(R, spec.path);
  if (!p) return { build: h.build, line: '' };
  return { build: { path: spec.path, picks: [] }, line: `Path assigned: ${p.name || spec.path}` };
}

// ── the GM's switches (rulesOverrides.build), published to the room as the `build` doc, which a player's rules follow ──
type Overrides = Save['rulesOverrides'];
/** The GM's switches set (`enabled`, `playerPick`), over whatever else the build override holds. */
export function withBuildRule(o: Overrides, patch: { enabled?: boolean; playerPick?: boolean }): Overrides {
  const b = isObj(o.build) ? o.build : {};
  return { ...o, build: { ...b, ...patch } };
}
/** The build and path overrides taken out: the default rules. */
export function withoutBuildRules(o: Overrides): Overrides {
  const { build: _b, paths: _p, ...rest } = o;
  return rest;
}
/** The save with the GM's build switches set (`withBuildRule`), as one step for `store.apply`. */
export const buildRuleSet = <S extends Pick<Save, 'rulesOverrides'>>(save: S, patch: { enabled?: boolean; playerPick?: boolean }): S => ({ ...save, rulesOverrides: withBuildRule(save.rulesOverrides, patch) });
/** The save back on the default build and path rules (`withoutBuildRules`), as one step for `store.apply`. */
export const buildRulesReset = <S extends Pick<Save, 'rulesOverrides'>>(save: S): S => ({ ...save, rulesOverrides: withoutBuildRules(save.rulesOverrides) });
/**
 * The rules a player's phone plays by while in a room: its own, with the room's (the GM's `rules` doc, `RoomRules`) over
 * them: the build switches, the personal gates' switch, hours and loot share, the feats' and trading's switches, and the economy, so a price is the GM's on
 * every phone. A rarity takes the room's rank and keeps the phone's color. Nothing is copied into the player's save, so
 * the player's own rules are theirs again once the room is left.
 */
export function withRoomRules(R: Rules, room: RoomRules | null): Rules {
  if (!room) return R;
  return {
    ...R,
    build: { ...R.build, ...room.build },
    solo: { ...R.solo, ...room.solo },
    feats: { ...R.feats, ...room.feats },
    trade: { ...R.trade, ...room.trade },
    rarities: { ...R.rarities, ...eachRarity(r => ({ ...R.rarities[r], rank: room.rarities[r].rank })) },
    gradeStep: room.gradeStep,
    saleShare: room.saleShare,
    usedUpShare: room.usedUpShare,
    reviveClears: room.reviveClears,
    reviveLevelShare: room.reviveLevelShare,
    gateParty: room.gateParty,
    loot: room.loot,
  };
}
/** The room's `rules` doc the GM's phone publishes from its own rules: what `withRoomRules` lays over a player's. */
export const roomRulesOf = (R: Rules): RoomRules => ({
  build: { enabled: R.build.enabled !== false, playerPick: R.build.playerPick !== false },
  solo: { personal: R.solo.personal, hours: R.solo.hours, lootShare: R.solo.lootShare },
  feats: { on: R.feats.on },
  trade: { on: R.trade.on },
  rarities: eachRarity(r => ({ rank: R.rarities[r].rank })),
  gradeStep: R.gradeStep,
  saleShare: R.saleShare,
  usedUpShare: R.usedUpShare,
  reviveClears: R.reviveClears,
  reviveLevelShare: R.reviveLevelShare,
  gateParty: R.gateParty,
  loot: R.loot,
});
