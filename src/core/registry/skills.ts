// skills.ts: the built-in skills a hunter can add from the Skills panel's list, and the starter hunters' skills, one typed
// table each. To add a skill: add an entry to SKILL_SEEDS (an active one also to SKILL_ABILITIES in ./abilities.ts; the
// typecheck asks) and run `bun run test` (tests/skills.test.ts checks every entry). The GM's own skills live in the save
// (`library.skills`), a hunter's on its sheet.
// `parseSkill` is the one reader of a skill from outside data: a save, a sheet, a form, a reward. The `Skill` type lives
// here; save.ts re-exports it.
import type { Ability } from '../combat/ability-types.ts';
import type { StatusDef } from '../combat/effect-ops.ts';
import { abilityTooLarge, parseAbility, parseStatusDef, statusTooLarge } from '../combat/fight-parse.ts';
import { BONUS_KEYS, RULES } from '../rules.ts';
import type { BonusKey } from '../rules.ts';
import { oneOf } from '../one-of.ts';
import type { SkillId } from '../ids.ts';
import { SKILL_ABILITIES } from './abilities.ts';
import type { BuiltInSkill, SkillRules } from './abilities.ts';

// The skill enum lives here, beside the one parser that reads it; save.ts re-exports it.
export const SKILL_TYPES = ['active', 'passive'] as const;
export type SkillType = (typeof SKILL_TYPES)[number];

/** What a passive skill adds while the hunter has it: points on a stat, max HP or max mana. */
export type SkillBonus = Partial<Record<BonusKey, number>>;
/**
 * A skill as a hunter or the library holds it, before it has an id. `label`: the GM's words on its badge, kept as
 * written; null (no words) shows its level, "Lv.n", which follows Lv +. An active one is used in a fight as its `ability`
 * (null: it has none in a fight yet, as Arise, whose use is the extraction on the Shadows panel). A passive one adds its
 * `bonus` to the sheet (src/core/hunter/sheet.ts), and its `worn` status, when it has one, is on its hunter's row in
 * every fight (kits design 1.3.2: how a passive reacts to hits, kills and turns). Absent `worn` is none.
 */
export type SkillTemplate = { name: string; level: number; label: string | null; desc: string }
  & ({ type: 'active'; ability: Ability | null } | { type: 'passive'; bonus: SkillBonus; worn?: StatusDef });
export type Skill = SkillTemplate & { id: SkillId };

/** A built-in skill. An active one's ability is its entry in SKILL_ABILITIES, by its name. */
export type SkillDef =
  | { name: BuiltInSkill; type: 'active'; desc: string }
  | { name: string; type: 'passive'; desc: string; bonus: SkillBonus };

// Restated by docs/agent-handoff/rw/m2-plan.md section 3.5: a passive's old bonus maps by the stat map (an old AC of N is
// Vitality 2N); an active's MP cost, dice and cooldown are its ability's now.
export const SKILL_SEEDS: readonly SkillDef[] = [
  { name: 'Sprint', type: 'active', desc: 'You are Hasted for a round.' },
  { name: 'Bloodlust', type: 'passive', desc: 'Adds 1 Strength.', bonus: { str: 1 } },
  { name: 'Dagger Rush', type: 'active', desc: 'A quick dagger strike that rolls 2d4.' },
  { name: 'Stealth', type: 'active', desc: 'Hide out of sight. Attacks from hiding deal 1.5 times damage. Taking damage, dealing damage, or being revealed ends it.' },
  { name: 'Mutilation', type: 'active', desc: 'A strike that rolls 2d6.' },
  { name: 'Taunt', type: 'active', desc: 'Force one foe within 6 tiles (30 ft) to target you for 2 rounds.' },
  { name: 'Stun', type: 'active', desc: 'Stun one foe for 1 round if they fail to resist. Interrupts channeling and mythic omens.' },
  { name: "Ruler's Authority", type: 'active', desc: 'Crush and push a foe up to 3 tiles away within 6 tiles (30 ft) with telekinetic force.' },
  { name: 'Shadow Exchange', type: 'active', desc: 'Swap places with one of your shadows.' },
  { name: 'Arise', type: 'active', desc: 'Raise a defeated monster as one of your shadows.' },
  { name: 'Mending Aura', type: 'active', desc: 'For three rounds, you and every ally near you heal each round. The area moves with you.' },
];

/** The skills the starter campaign's three hunters begin with (src/views/starter.js), two each. */
export const STARTER_SKILLS = {
  shieldWall: { name: 'Shield Wall', type: 'active', desc: 'Put a shield equal to 25% of your max HP on one ally in range.' },
  ironSkin: { name: 'Iron Skin', type: 'passive', desc: 'Adds 2 Vitality.', bonus: { vit: 2 } },
  markedShot: { name: 'Marked Shot', type: 'active', desc: 'Fire a quick 1d10 shot that marks the target for 2 rounds (+15% damage taken).' },
  trailsense: { name: 'Trailsense', type: 'passive', desc: 'You notice tracks and signs others miss, and a gate never surprises you.', bonus: {} },
  arcBolt: { name: 'Arc Bolt', type: 'active', desc: 'Fire a bolt of mana at one foe in range.' },
  manaSense: { name: 'Mana Sense', type: 'passive', desc: 'You can sense mana near you, which lets you find hidden gates.', bonus: {} },
} as const satisfies Record<string, SkillDef>;

/** A built-in skill as a hunter holds it (no id yet): level 1, no label, an active one with its ability under `R`. */
export function skillOf(def: SkillDef, R: SkillRules): SkillTemplate {
  const base = { name: def.name, level: 1, label: null, desc: def.desc };
  return def.type === 'passive' ? { ...base, type: 'passive', bonus: { ...def.bonus } } : { ...base, type: 'active', ability: SKILL_ABILITIES[def.name](R) };
}

// ── the one parser ──
/** The bounds of every skill, wherever it comes from. */
export const SKILL_BOUNDS = { name: 60, label: 12, desc: 500, level: 10, bonus: 999 } as const;
type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
/** A finite number cut to a whole one and clamped, or `d` when the value is not a number. */
const whole = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.trunc(v))) : d);

/**
 * A skill read from outside data, without its id, or null when it is not an object or has no name. Each field of the
 * wrong type or value takes the default a new skill has; a number is cut to a whole one inside `SKILL_BOUNDS`. An active
 * skill's ability is read by the fight's ability reader with the shipped rules' limits (as a reward is), and is null when
 * that refuses it. A passive one's bonus keeps the ten bonus keys (the eight stats, `hpMax`, `manaMax`) that are not 0,
 * and its `worn` status is read by the status reader (one it refuses is none). Every other key is dropped. A skill whose
 * ability or worn status is past its size (size.ts `THING_MAX`) is refused whole: null.
 */
export function parseSkill(v: unknown): SkillTemplate | null {
  if (!isObj(v)) return null;
  const B = SKILL_BOUNDS;
  const name = typeof v.name === 'string' ? v.name.trim().slice(0, B.name) : '';
  if (!name) return null;
  const base = {
    name, level: whole(v.level, 1, B.level, 1), label: typeof v.label === 'string' ? v.label.trim().slice(0, B.label) || null : null,
    desc: typeof v.desc === 'string' ? v.desc.slice(0, B.desc) : '',
  };
  // refused whole for its size: a skill without the ability or the worn status it was made with is another skill
  if (abilityTooLarge(v.ability, RULES) || statusTooLarge(v.worn, RULES)) return null;
  if (oneOf(v.type, SKILL_TYPES, 'active') === 'active') return { ...base, type: 'active', ability: parseAbility(v.ability, RULES) };
  const bonus: SkillBonus = {};
  const rawBonus = isObj(v.bonus) ? v.bonus : {};
  for (const k of BONUS_KEYS) { const n = whole(Object.hasOwn(rawBonus, k) ? rawBonus[k] : 0, -B.bonus, B.bonus, 0); if (n) bonus[k] = n; }
  const worn = v.worn === undefined ? null : parseStatusDef(v.worn, RULES);
  return worn ? { ...base, type: 'passive', bonus, worn } : { ...base, type: 'passive', bonus };
}
