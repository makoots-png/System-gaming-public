// reward-rows.ts: the reward editor's form (src/views/reward-editor.js) as data: a reward opened into its number fields
// and one row per part, and the rows written back as the raw reward `parseRewards` reads. A row holds the fields the
// editor edits; a title row holds all of a title (its band and its active too), so a reward opened and saved unchanged
// is the reward it was.
import type { Ability } from './combat/ability-types.ts';
import type { StatusDef } from './combat/effect-ops.ts';
import type { ItemTemplate } from './registry/items.ts';
import type { SkillTemplate } from './registry/skills.ts';
import { REWARD_BOUNDS, titleReward } from './rewards.ts';
import type { RewardRules, RewardTitle, Rewards } from './rewards.ts';
import type { Rank, Rules } from './rules.ts';

/**
 * One row of the editor. A title's `pick` is the key of the rule title it copies ('' for a written one), `replaces` and
 * a status's `rounds` the text of their fields ('' for none), `worn` its worn status or null, `band` the rank whose budget
 * it fits (null: none written, which reads as E) and `active` the ability its holder may use in a fight, or null.
 */
export type RewardRow =
  | { kind: 'item'; item: ItemTemplate | null }
  | { kind: 'title'; pick: string; name: string; desc: string; replaces: string; bonus: Record<string, number>; worn: StatusDef | null; band: Rank | null; active: Ability | null }
  | { kind: 'skill'; skill: SkillTemplate | null }
  | { kind: 'status'; key: string; rounds: string; def: StatusDef | null }
  | { kind: 'boon'; name: string; text: string }
  | { kind: 'job'; job: string };
export type RewardRowKind = RewardRow['kind'];
/** Every kind of row, in the order the editor's Add chips offer them. */
export const ROW_KINDS = ['item', 'title', 'skill', 'status', 'boon', 'job'] as const satisfies readonly RewardRowKind[];
type TitleRow = Extract<RewardRow, { kind: 'title' }>;
/** The editor's whole form: the four number fields and the part rows, in the order the GM added them. */
export type RewardForm = { nums: { xp: number; gold: number; crystal: number; points: number }; rows: RewardRow[] };

/** A title opened into its row. */
function titleRow(t: RewardTitle): TitleRow {
  return { kind: 'title', pick: t.key ?? '', name: t.name, desc: t.desc, replaces: t.replaces ?? '', bonus: { ...t.bonus }, worn: t.worn ?? null, band: t.band ?? null, active: t.active ?? null };
}

/** A parsed reward opened into the editor's form. */
export function rewardForm(rw: Rewards): RewardForm {
  return {
    nums: { xp: rw.xp, gold: rw.gold, crystal: rw.crystal, points: rw.points },
    rows: [
      ...rw.items.map((item): RewardRow => ({ kind: 'item', item })),
      ...(rw.title ? [titleRow(rw.title)] : []),
      ...rw.skills.map((skill): RewardRow => ({ kind: 'skill', skill })),
      ...rw.statuses.map((s): RewardRow => ({ kind: 'status', key: s.key, rounds: s.rounds ? String(s.rounds) : '', def: s.def ?? null })),
      ...rw.boons.map((b): RewardRow => ({ kind: 'boon', name: b.name, text: b.text })),
      ...(rw.job ? [{ kind: 'job', job: rw.job } as const] : []),
    ],
  };
}

/** An empty row of `kind`, as the editor's Add chip gives it; a status row names the first of `statusKeys`. */
export function blankRow(kind: RewardRowKind, statusKeys: readonly string[]): RewardRow {
  if (kind === 'item') return { kind, item: null };
  if (kind === 'title') return { kind, pick: '', name: '', desc: '', replaces: '', bonus: {}, worn: null, band: null, active: null };
  if (kind === 'skill') return { kind, skill: null };
  if (kind === 'status') return { kind, key: statusKeys[0] ?? '', rounds: '3', def: null };
  if (kind === 'boon') return { kind, name: '', text: '' };
  return { kind, job: '' };
}

/**
 * The title row with the rule title `key` picked: its name, words, bonus, band and active taken from the rule title; a
 * key no rule title has is a new title, written from nothing. What it replaces and its worn status stay.
 */
export function pickTitle(r: TitleRow, R: Pick<Rules, 'titles'>, key: string): TitleRow {
  const seed = R.titles.find(t => t.key === key), t = seed ? titleReward(R, seed.name) : null;
  if (!seed || !t) return { ...r, pick: '', name: '', desc: '', bonus: {}, band: null, active: null };
  return { ...r, pick: seed.key, name: t.name, desc: t.desc, bonus: { ...t.bonus }, band: t.band ?? null, active: t.active ?? null };
}

const whole = (v: string): number => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : 0; };

/**
 * The form written back as the raw reward the parser reads: rows not filled in left out, a status without its own def
 * given the def `R` names. `floor` keeps the numbers at 0 or more (a quest's).
 */
export function rewardOfForm(f: RewardForm, R: RewardRules, floor = false) {
  const n = (x: number) => (floor ? Math.max(0, x) : x);
  const title = f.rows.find((r): r is TitleRow => r.kind === 'title'), job = f.rows.find(r => r.kind === 'job');
  const items: ItemTemplate[] = [], skills: SkillTemplate[] = [], statuses: { key: string; rounds: number | null; def: StatusDef | undefined }[] = [], boons: { name: string; text: string }[] = [];
  for (const r of f.rows) {
    if (r.kind === 'item' && r.item) items.push(r.item);
    else if (r.kind === 'skill' && r.skill) skills.push(r.skill);
    else if (r.kind === 'status' && r.key) { const k = whole(r.rounds); statuses.push({ key: r.key, rounds: k > 0 ? k : null, def: r.def ?? R.conditions[r.key] }); }
    else if (r.kind === 'boon' && r.name.trim()) boons.push({ name: r.name.trim(), text: r.text });
  }
  const name = title?.name.trim(), replaces = title?.replaces.trim();
  return {
    xp: n(f.nums.xp), points: n(f.nums.points), gold: n(f.nums.gold), crystal: n(f.nums.crystal), items,
    // a title in place of itself is that title (rewards.ts `title`)
    title: title && name ? { name, desc: title.desc, bonus: title.bonus, ...(title.pick ? { key: title.pick } : {}), ...(replaces && replaces !== name ? { replaces } : {}), ...(title.worn ? { worn: title.worn } : {}), ...(title.band ? { band: title.band } : {}), ...(title.active ? { active: title.active } : {}) } : null,
    job: job?.kind === 'job' && job.job.trim() ? job.job.trim() : null,
    skills, statuses, boons,
  };
}

/** Why a row cannot be saved yet, in the editor's words, or ''. */
export function rowError(r: RewardRow): string {
  if (r.kind === 'item' && !r.item) return 'Pick an item, or remove the row.';
  if (r.kind === 'skill' && !r.skill) return 'Pick a skill, or remove the row.';
  if (r.kind === 'title' && !r.name.trim()) return 'Name the title, or remove the row.';
  if (r.kind === 'boon' && !r.name.trim()) return 'Name the boon, or remove the row.';
  if (r.kind === 'job' && !r.job.trim()) return 'Name the job, or remove the row.';
  if (r.kind === 'status' && r.rounds.trim() !== '' && !(whole(r.rounds) >= 1 && whole(r.rounds) <= REWARD_BOUNDS.rounds)) return `Rounds must be between 1 and ${REWARD_BOUNDS.rounds}. Leave empty so it lasts until removed.`;
  return '';
}
