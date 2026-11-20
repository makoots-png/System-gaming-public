// Every number of the shipped rules by its dotted path, a list of numbers as one entry. The statuses (`conditions`) are
// left out: they are the library's, and an override of them is refused whole (src/core/overrides.ts).
import { RULES } from '../../src/core/rules.ts';

export type RuleNumberAt = { readonly path: string; readonly value: number | readonly number[] };

function walk(v: unknown, path: string, out: RuleNumberAt[]): RuleNumberAt[] {
  if (path === 'conditions') return out;
  if (typeof v === 'number') out.push({ path, value: v });
  else if (Array.isArray(v)) { if (v.some(x => typeof x === 'number')) out.push({ path, value: v as number[] }); }
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, out);
  return out;
}
/** Every number of RULES. */
export const ruleNumbers = (): RuleNumberAt[] => walk(RULES, '', []);
