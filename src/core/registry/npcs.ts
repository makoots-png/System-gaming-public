// npcs.ts: GM-built NPC templates (`save.library.npcs`). An NPC has a monster-shaped body (`rank`, `archetype`, `tier`
// of `normal` | `elite` | `boss`, and a `Tweak` for Support ally or custom edits), a default side (`party` or `foe`),
// a GM-only play skill (1 Sloppy to 5 Optimal, default 3 Steady), custom abilities by value (maker cap
// `RULES.fight.npc.abilities`, storage cap `NPC_BOUNDS.abilities`), starting statuses, an optional icon, and GM-only notes.
// `parseNpc` is the one reader of an NPC from outside data: the save, a pack, and the maker, always reading under shipped
// `RULES` and `NPC_BOUNDS` so GM rule overrides never prune saved data. `npcSheet` derives its combat sheet via
// `monsterSheet`; `npcWorth` computes its power ratio against a same-rank hunter and weighs each custom ability via
// `abilityWorth`. Pure.
import { RANKS, RULES } from '../rules.ts';
import type { Rank, Rules } from '../rules.ts';
import { STAT_KEYS } from '../stats.ts';
import type { StatKey } from '../stats.ts';
import { NO_TWEAK, monsterSheet } from '../hunter/derive.ts';
import type { Archetype, DeriveRules, MonsterTrait, Sheet, Tweak } from '../hunter/derive.ts';
import type { Ability } from '../combat/ability-types.ts';
import type { Side } from '../combat/space.ts';
import { isStatusKey } from '../combat/effect-ops.ts';
import { parseAbility } from '../combat/fight-parse.ts';
import { MAX_ABILITIES } from '../combat/fight-types.ts';
import { isStateChip } from '../hunter/chips.ts';
import type { NpcId } from '../ids.ts';
import { oneOf } from '../one-of.ts';
import { ARCHETYPE_LIST, MONSTER_TRAITS, xpOf } from './monsters.ts';
import type { StartStatus } from './monsters.ts';
import { isIconKey } from './icons.ts';
import type { IconKey } from './icons.ts';
import { abilityWorth, worthLine } from './worth.ts';
import type { Worth, WorthRules } from './worth.ts';

/** The combat tiers an NPC may use (reuses `RULES.fight.kinds` without `mythic`). */
export const NPC_TIERS = ['normal', 'elite', 'boss'] as const;
export type NpcTier = (typeof NPC_TIERS)[number];

/** The five steps of the GM-only "How well this NPC plays" slider (1 Sloppy to 5 Optimal). */
export const NPC_SKILLS = [1, 2, 3, 4, 5] as const;
export type NpcSkill = (typeof NPC_SKILLS)[number];

/** The two default sides an NPC may fight for. */
export const NPC_SIDES = ['party', 'foe'] as const satisfies readonly Side[];

/** The four tier presets in the NPC maker: Support ally (`normal` + `allyTweak`), Standard, Elite, and Boss. */
export const NPC_TIER_PRESETS = ['support', 'standard', 'elite', 'boss'] as const;
export type NpcTierPreset = (typeof NPC_TIER_PRESETS)[number];

/** Display label and slider readout for one NPC skill step. */
export type NpcSkillInfo = { readonly name: string; readonly readout: string };

/** Display name for each step of the "How well this NPC plays" slider (1 Sloppy to 5 Optimal). */
export const NPC_SKILL_NAMES: { readonly [S in NpcSkill]: string } = {
  1: 'Sloppy',
  2: 'Careless',
  3: 'Steady',
  4: 'Sharp',
  5: 'Optimal',
};

/**
 * Slider readout for one NPC skill step, built from `R.fight.npc.skill[step]` so GM overrides
 * to `skip` and `temp` show in the text.
 */
export function npcSkillReadout(step: NpcSkill, R: Pick<Rules, 'fight'> = RULES): string {
  const name = NPC_SKILL_NAMES[step];
  const { skip, temp } = R.fight.npc.skill[step];
  if (skip <= 0 && temp <= 0) return `${name}: always picks the strongest move.`;
  const skipClause = skip <= 0
    ? 'never skips heals or omen answers'
    : skip >= 1
      ? 'always skips heals or omen answers'
      : `${Math.max(1, Math.min(99, Math.round(skip * 100)))}% chance to skip heals or omen answers`;
  const pickClause = temp <= 0
    ? 'otherwise picks the strongest attack'
    : temp <= 0.12
      ? 'rarely picks a weaker attack or off-target'
      : temp <= 0.35
        ? 'sometimes picks a weaker attack or off-target'
        : 'often picks a weaker attack or off-target';
  return `${name}: ${skipClause}, and ${pickClause}.`;
}

/** Shipped words for each step of the "How well this NPC plays" slider; call `npcSkillReadout(step, R)` for live rules. */
export const NPC_SKILL_INFO: { readonly [S in NpcSkill]: NpcSkillInfo } = {
  1: { name: NPC_SKILL_NAMES[1], readout: npcSkillReadout(1, RULES) },
  2: { name: NPC_SKILL_NAMES[2], readout: npcSkillReadout(2, RULES) },
  3: { name: NPC_SKILL_NAMES[3], readout: npcSkillReadout(3, RULES) },
  4: { name: NPC_SKILL_NAMES[4], readout: npcSkillReadout(4, RULES) },
  5: { name: NPC_SKILL_NAMES[5], readout: npcSkillReadout(5, RULES) },
};

/** Default hunter names for the NPC maker's "Roll a name" button (mirrors the GM's NPC name roll table). */
export const NPC_NAME_SEEDS: readonly string[] = [
  'Han Seo-jun', 'Choi Min-gi', 'Kang Tae-shik', 'Yoo Ji-ho', 'Baek Do-yun', 'Seo Hae-rin', 'Min Byung-chul', 'Ahn Soo-ah',
  'Tanaka Ryo', 'Kuroda Shin', 'Hoshino Aya', 'Sakamoto Ren', 'Akiyama Haruto', 'Mori Kaito', 'Yamashiro Rei', 'Fujiwara Mio',
];

/**
 * A GM-built NPC template in `save.library.npcs`. Its body is derived from `(rank, archetype, tier, tweak)` via
 * `monsterSheet`. `skill` and `notes` are GM-only and never sent to player phones.
 */
export type Npc = {
  id: NpcId;
  name: string;
  rank: Rank;
  archetype: Archetype;
  tier: NpcTier;
  tweak: Tweak;
  defaultSide: Side;
  skill: NpcSkill;
  abilities: Ability[];
  statuses: StartStatus[];
  icon?: IconKey;
  notes: string;
};

/** An NPC as the parser returns it and a pack carries it, before it has an id. */
export type NpcTemplate = Omit<Npc, 'id'>;

/** The bounds of every NPC template the GM keeps. A fight row holds 12 abilities, one of them the archetype's attack. */
export const NPC_BOUNDS = {
  name: 60,
  notes: 500,
  stat: 999,
  tweakMin: 0.1,
  tweakMax: 10,
  abilities: MAX_ABILITIES - 1,
  statuses: 8,
  rounds: 999,
  /** Copies of one NPC that may be added to a fight at once (1 to 4). */
  copies: 4,
} as const;

const cloneTweak = (t: Tweak): Tweak => ({ hp: t.hp, dealt: t.dealt, stats: { ...t.stats }, traits: [...t.traits] });

/** The `(tier, tweak)` pair for one of the four maker presets (`Support ally`, `Standard`, `Elite`, `Boss`). */
export function npcTierPreset(preset: NpcTierPreset, R: Pick<Rules, 'fight'> = RULES): { readonly tier: NpcTier; readonly tweak: Tweak } {
  if (preset === 'support') {
    return { tier: 'normal', tweak: { hp: R.fight.npc.allyTweak.hp, dealt: R.fight.npc.allyTweak.dealt, stats: {}, traits: [] } };
  }
  const tier: NpcTier = preset === 'standard' ? 'normal' : preset;
  return { tier, tweak: cloneTweak(NO_TWEAK) };
}

/** Which maker tier preset an NPC matches (`support` when `normal` with `allyTweak` multipliers, else its tier). */
export function npcPresetOf(npc: Pick<NpcTemplate, 'tier' | 'tweak'>, R: Pick<Rules, 'fight'> = RULES): NpcTierPreset {
  const ally = R.fight.npc.allyTweak;
  if (npc.tier === 'normal' && Math.abs(npc.tweak.hp - ally.hp) < 1e-6 && Math.abs(npc.tweak.dealt - ally.dealt) < 1e-6) return 'support';
  return npc.tier === 'normal' ? 'standard' : npc.tier;
}

/** Clamps a skill step to a valid `NpcSkill` (1 to 5), falling back to `fallback`. */
export function clampNpcSkill(v: unknown, fallback: NpcSkill = RULES.fight.npc.defaultSkill as NpcSkill): NpcSkill {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const n = Math.max(1, Math.min(5, Math.trunc(v)));
  return n as NpcSkill;
}

/**
 * A fresh NPC template with sensible defaults: when no `tier` is given, `party` starts on the `Support ally` preset
 * (`normal` + `allyTweak`) and `foe` starts on `Standard` (`normal`, `NO_TWEAK`); when `tier` is given, `tweak`
 * defaults to `NO_TWEAK`. Skill defaults to `R.fight.npc.defaultSkill` (3 Steady).
 */
export function newNpc(o: Partial<NpcTemplate> = {}, R: Pick<Rules, 'fight'> = RULES): NpcTemplate {
  const defaultSide = o.defaultSide ?? 'party';
  const preset = o.tier === undefined
    ? npcTierPreset(defaultSide === 'party' ? 'support' : 'standard', R)
    : { tier: o.tier, tweak: cloneTweak(NO_TWEAK) };
  return {
    name: o.name ?? '',
    rank: o.rank ?? 'E',
    archetype: o.archetype ?? 'brute',
    tier: preset.tier,
    tweak: o.tweak ? cloneTweak(o.tweak) : preset.tweak,
    defaultSide,
    skill: o.skill ?? clampNpcSkill(R.fight.npc.defaultSkill, 3),
    abilities: o.abilities ? JSON.parse(JSON.stringify(o.abilities)) as Ability[] : [],
    statuses: o.statuses ? o.statuses.map(s => ({ ...s })) : [],
    ...(o.icon !== undefined ? { icon: o.icon } : {}),
    notes: o.notes ?? '',
  };
}

/** A deep copy of `npc` under `newId` (and optional `name`), so edits to the copy never share nested objects. */
export function copyNpc(npc: Npc, newId: NpcId, name?: string): Npc {
  const cloned = JSON.parse(JSON.stringify(npc)) as Npc;
  return { ...cloned, id: newId, ...(name !== undefined ? { name } : {}) };
}

// ── the one parser ──
type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const whole = (v: unknown, lo: number, hi: number, d: number): number =>
  (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.trunc(v))) : d);
const factor = (v: unknown, d: number): number =>
  (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.max(NPC_BOUNDS.tweakMin, Math.min(NPC_BOUNDS.tweakMax, v)) : d);
const text = (v: unknown, n: number): string => (typeof v === 'string' ? v.trim().slice(0, n) : '');

function parseNpcTweak(v: unknown): Tweak {
  const t = isObj(v) ? v : {};
  const hp = factor(t.hp, NO_TWEAK.hp);
  const dealt = factor(t.dealt, NO_TWEAK.dealt);
  const raw = isObj(t.stats) ? t.stats : {};
  const stats: Partial<Record<StatKey, number>> = {};
  for (const k of STAT_KEYS) {
    const n = whole(Object.hasOwn(raw, k) ? raw[k] : 0, -NPC_BOUNDS.stat, NPC_BOUNDS.stat, 0);
    if (n) stats[k] = n;
  }
  const named = Array.isArray(t.traits) ? t.traits : [];
  const traits: MonsterTrait[] = MONSTER_TRAITS.filter(k => named.includes(k));
  return { hp, dealt, stats, traits };
}

function parseStartStatuses(v: unknown): StartStatus[] {
  const out: StartStatus[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    if (out.length >= NPC_BOUNDS.statuses) break;
    if (!isObj(raw) || !isStatusKey(raw.key) || isStateChip(raw.key) || out.some(s => s.key === raw.key)) continue;
    const stacks = whole(raw.stacks, 1, RULES.fight.kit.stackCap, 1);
    out.push({ key: raw.key, rounds: raw.rounds === null ? null : whole(raw.rounds, 1, NPC_BOUNDS.rounds, 1), ...(stacks > 1 ? { stacks } : {}) });
  }
  return out;
}

/**
 * An NPC template read from outside data under shipped `RULES` and fixed `NPC_BOUNDS` (GM overrides never prune saved
 * data; the maker enforces `R.fight.npc.abilities`). Returns null when it is not an object or has no name. Each field
 * of the wrong type or value takes its default (`rank` E, `archetype` brute, `tier` normal, `defaultSide` party, `skill`
 * `RULES.fight.npc.defaultSkill` = 3, `tweak` `NO_TWEAK`). Custom abilities are read by `parseAbility` under shipped
 * `RULES` (oversized or unreadable entries dropped, capped at `NPC_BOUNDS.abilities` = 11). Starting statuses keep valid
 * non-chip keys (each once, cap 8, stacks clamped to shipped `RULES.fight.kit.stackCap`). `icon` is kept only when valid
 * in the icon registry. Every unknown key is dropped.
 */
export function parseNpc(v: unknown): NpcTemplate | null {
  if (!isObj(v)) return null;
  const B = NPC_BOUNDS;
  const name = text(v.name, B.name);
  if (!name) return null;
  const defaultSkill = clampNpcSkill(RULES.fight.npc.defaultSkill, 3);
  const abilities = (Array.isArray(v.abilities) ? v.abilities : [])
    .flatMap(a => parseAbility(a, RULES) ?? [])
    .slice(0, B.abilities);
  const out: NpcTemplate = {
    name,
    rank: oneOf(v.rank, RANKS, 'E'),
    archetype: oneOf(v.archetype, ARCHETYPE_LIST, 'brute'),
    tier: oneOf(v.tier, NPC_TIERS, 'normal'),
    tweak: parseNpcTweak(v.tweak),
    defaultSide: oneOf(v.defaultSide, NPC_SIDES, 'party'),
    skill: clampNpcSkill(v.skill, defaultSkill),
    abilities,
    statuses: parseStartStatuses(v.statuses),
    notes: typeof v.notes === 'string' ? v.notes.slice(0, B.notes) : '',
  };
  if (isIconKey(v.icon)) out.icon = v.icon;
  return out;
}

// ── derived sheet & power budget ──
/** An NPC's derived combat sheet from `(rank, archetype, tier, tweak)` via `monsterSheet`. */
export const npcSheet = (npc: Pick<NpcTemplate, 'rank' | 'archetype' | 'tier' | 'tweak'>, R: DeriveRules): Sheet =>
  monsterSheet(npc.rank, npc.archetype, npc.tier, R, [], npc.tweak);

/** A foe NPC's XP: its tier's XP from the rules (`xpOf`: normal 1x, elite 1.5x, boss 3x), including any body traits. */
export const npcXp = (npc: Pick<NpcTemplate, 'rank' | 'tier' | 'tweak'>, R: Pick<Rules, 'rankTable' | 'fight'>): number =>
  xpOf(R, npc.rank, npc.tier, npc.tweak.traits);

/** The primary attack power of an archetype's sheet (`phys` for brute, `finesse` for skirmisher, `mag` for caster). */
function archetypePower(sheet: Sheet, archetype: Archetype): number {
  if (archetype === 'skirmisher') return sheet.finesse;
  if (archetype === 'caster') return sheet.mag;
  return sheet.phys;
}

/** Effective toughness of a sheet: max HP scaled by mean physical/arcane defense multiplier. */
const toughness = (sheet: Sheet, armorK: number): number =>
  sheet.hpMax * (1 + (sheet.armor + sheet.resist) / (2 * armorK));

/** Worth and budget readout for one NPC template: body ratio vs a same-rank hunter, ability worths, and ally warning. */
export type NpcWorth = {
  readonly sheet: Sheet;
  /** Combined combat power ratio relative to a same-rank hunter (1.0 = parity; Support ally is ~0.65). */
  readonly ratio: number;
  /** Effective toughness ratio relative to a same-rank hunter. */
  readonly hpRatio: number;
  /** Effective damage output ratio relative to a same-rank hunter. */
  readonly damageRatio: number;
  /** Worth readout of each custom ability at `npc.rank`, in order. */
  readonly abilities: readonly { readonly ability: Ability; readonly worth: Worth; readonly line: string }[];
  /** True when this NPC defaults to `party` and its body ratio, HP ratio, or damage ratio exceeds 1.0x a same-rank hunter. */
  readonly overAllyBudget: boolean;
  /** Preview line shown in the NPC maker. */
  readonly summary: string;
  /** Warning shown for allies stronger than a player hunter of the same rank, or null. */
  readonly warning: string | null;
};

/** Warning text shown when an ally NPC exceeds 1.0x a same-rank player hunter. */
export const ALLY_OVER_BUDGET_WARNING = 'Stronger than a player hunter of this rank.';

/**
 * Evaluates an NPC's combat power relative to a 1.0x same-rank hunter body of the same archetype, plus `abilityWorth`
 * and `worthLine` for each custom ability. Support ally (`normal` + `allyTweak`) lands at ~0.65x; allies above 1.0x
 * carry `ALLY_OVER_BUDGET_WARNING`.
 */
export function npcWorth(
  npc: Pick<NpcTemplate, 'rank' | 'archetype' | 'tier' | 'tweak' | 'defaultSide' | 'abilities'>,
  R: WorthRules,
): NpcWorth {
  const sheet = npcSheet(npc, R);
  const normalKind = R.fight.kinds.normal;
  const normalSheet = monsterSheet(npc.rank, npc.archetype, 'normal', R, [], NO_TWEAK);
  // Undo normal's hp/power factors to obtain the 1.0x same-rank archetype baseline.
  const baseToughness = toughness(normalSheet, R.fight.armorK) / normalKind.hp;
  const basePower = archetypePower(normalSheet, npc.archetype) / normalKind.power;
  const hpRatio = toughness(sheet, R.fight.armorK) / Math.max(1, baseToughness);
  const damageRatio = (archetypePower(sheet, npc.archetype) * npc.tweak.dealt / Math.max(1, basePower)) * (sheet.speed / Math.max(1, normalSheet.speed));
  const ratio = Math.sqrt(Math.max(0, hpRatio * damageRatio));
  const abilities = npc.abilities.map(ability => {
    const worth = abilityWorth(ability, R, { rank: npc.rank });
    return { ability, worth, line: worthLine(worth) };
  });
  const overAllyBudget = npc.defaultSide === 'party' && (ratio > 1 + 1e-9 || hpRatio > 1 + 1e-9 || damageRatio > 1 + 1e-9);
  const summary = `About ${ratio.toFixed(2)} times a rank ${npc.rank} hunter (HP ${sheet.hpMax}, Armor ${sheet.armor}, Resist ${sheet.resist}, Speed ${sheet.speed}).`;
  return {
    sheet,
    ratio,
    hpRatio,
    damageRatio,
    abilities,
    overAllyBudget,
    summary,
    warning: overAllyBudget ? ALLY_OVER_BUDGET_WARNING : null,
  };
}
