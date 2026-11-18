// skills-held.ts: the skills a hunter holds, and the GM's library of skills. Pure. A view changes them only through a
// function here, in `store.apply` (src/core/save-step.ts). A skill from outside data is read by `parseSkill`
// (registry/skills.ts) before it comes here. A passive's bonus is on the sheet: chain `fitted` (sheet.ts) after a
// change. Ids are arguments: the store reserves one (`store.id('s')`).
import type { Skill, SkillTemplate } from '../registry/skills.ts';
import { refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';

type Skilled = { skills: Skill[] };
/** The highest level a skill reaches with Lv +. */
export const SKILL_MAX_LEVEL = 10;

/** A copy of `k` learned under `id`. */
export const learnSkill = <H extends Skilled>(h: H, k: SkillTemplate, id: string): H => ({ ...h, skills: [...h.skills, { ...k, id }] });
/** Whether `h` holds a skill of this name (any case, spaces at the ends aside) other than the one `but` names. */
const holdsName = (h: Skilled, name: string, but: string | null = null): boolean => {
  const n = name.trim().toLowerCase();
  return h.skills.some(s => s.id !== but && s.name.trim().toLowerCase() === n);
};
/** Add skill on the sheet: learned under `id`, refused when one of the same name is held (`held`): two skills of one name cannot be told apart on a card or a hotbar. */
export const addSkill = <H extends Skilled>(h: H, k: SkillTemplate, id: string): H | Refused<'held'> => (holdsName(h, k.name) ? refuse('held') : learnSkill(h, k, id));
/** A skill given (a reward, Give to…): one of the same name is replaced and keeps its id; else learned under `id`. */
export function giveSkill<H extends Skilled>(h: H, k: SkillTemplate, id: string): H {
  if (!holdsName(h, k.name)) return learnSkill(h, k, id);
  const n = k.name.trim().toLowerCase();
  return { ...h, skills: h.skills.map(s => (s.name.trim().toLowerCase() === n ? { ...s, ...k, id: s.id } : s)) };
}
/** Lv +: one level up (a badge with no label shows it; a label is the GM's words and stays). Refused at `SKILL_MAX_LEVEL` (`max`) and for a skill not held (`no-skill`). */
export function levelUpSkill<H extends Skilled>(h: H, id: string): H | Refused<'no-skill' | 'max'> {
  const k = h.skills.find(s => s.id === id);
  if (!k) return refuse('no-skill');
  if (k.level >= SKILL_MAX_LEVEL) return refuse('max');
  return { ...h, skills: h.skills.map(s => (s.id === id ? { ...s, level: k.level + 1 } : s)) };
}
/** The skill maker's edit of a held skill: its fields replaced, its id kept. Refused when the new name is another held skill's (`held`). */
export function editSkill<H extends Skilled>(h: H, id: string, k: SkillTemplate): H | Refused<'no-skill' | 'held'> {
  if (!h.skills.some(s => s.id === id)) return refuse('no-skill');
  return holdsName(h, k.name, id) ? refuse('held') : { ...h, skills: h.skills.map(s => (s.id === id ? { ...k, id } : s)) };
}
/** A skill forgotten. */
export function forgetSkill<H extends Skilled>(h: H, id: string): H | Refused<'no-skill'> {
  return h.skills.some(s => s.id === id) ? { ...h, skills: h.skills.filter(s => s.id !== id) } : refuse('no-skill');
}

