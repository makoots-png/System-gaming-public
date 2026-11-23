// rewards.ts: what a reward may hold, and `parseRewards`, its one reader from outside data: a save's quest, a bundle in
// the library, a room's award or quest, a form. Pure. A reward is given by `applyRewards` in src/views/hunter.js.
// A new kind of reward is a field of `Rewards`, its default in `newRewards`, its line in `parseRewards` and
// `rewardLines`, and a case in tests/rewards.test.ts.
import { titleKey } from './ids.ts';
import { isStatusKey } from './combat/effect-ops.ts';
import type { StatusDef, StatusKey } from './combat/effect-ops.ts';
import { parseStatusDef, statusTooLarge } from './combat/fight-parse.ts';
import { isStateChip } from './hunter/chips.ts';
import { debtPaidLine } from './hunter/revive-standing.ts';
import { parseItem } from './registry/items.ts';
import { parsePowers } from './registry/powers.ts';
import type { Powers } from './registry/powers.ts';
import type { ItemTemplate } from './registry/items.ts';
import { parseSkill } from './registry/skills.ts';
import type { SkillTemplate } from './registry/skills.ts';
import { BONUS_KEYS, RANKS, RULES } from './rules.ts';
import type { Rank, Rules } from './rules.ts';
import { refuse } from './save-step.ts';
import type { Refused } from './save-step.ts';
import type { BundleId } from './ids.ts';

/**
 * A title as a reward carries it: its bonus travels with it, so a title the receiving phone does not know still counts.
 * `key`: the rule title it copies (src/core/rules.ts `titles`), when it does, so one held under another name is not given twice.
 * `replaces`: the name of a title the hunter may hold that this one takes the place of (record.ts `giveTitle`: that title
 * becomes this one, its id and whether it is active kept); a hunter who does not hold it gets this title as a new one.
 * Its `Powers` (registry/powers.ts) are the held title's (hunter.ts `Title`): given in fights while it is the active title.
 * `band`: the rank whose budget it fits (`RULES.titleBudget`, item-budget.ts `titleSpend`); absent reads E (`bandOf`).
 */
export type RewardTitle = { name: string; desc: string; bonus: Record<string, number>; key?: string; replaces?: string; band?: Rank } & Powers;
/** A title's band read from outside data: a rank, or undefined (absent, or not a rank), which `bandOf` reads as E. */
export const parseBand = (v: unknown): Rank | undefined => RANKS.find(r => r === v);
/** The rank whose budget a title is weighed against: its band, E when it has none (item-stats 6.7). */
export const bandOf = (t: { readonly band?: Rank }): Rank => t.band ?? 'E';
/**
 * A status a reward puts on the hunter. `rounds: null` lasts until removed. `def` for a status the receiver may not know;
 * without it the receiver's rules name the key.
 */
export type RewardStatus = { key: StatusKey; rounds: number | null; def?: StatusDef };
/** What a reward's words read: the statuses a key names. */
export type RewardRules = { readonly conditions: Readonly<Record<string, StatusDef>> };
/** A text reward the GM honours at the table. The hunter keeps it until the player redeems it. */
export type BoonGrant = { name: string; text: string };
/**
 * What a reward gives. XP, gold and points may be negative: a GM may take away. `job` is the job's name as text. An item
 * or skill has no id until the hunter holds it.
 */
export type Rewards = {
  xp: number; points: number; gold: number; items: ItemTemplate[]; title: RewardTitle | null; job: string | null;
  skills: SkillTemplate[]; statuses: RewardStatus[]; boons: BoonGrant[];
};

export const newRewards = (): Rewards => ({ xp: 0, points: 0, gold: 0, items: [], title: null, job: null, skills: [], statuses: [], boons: [] });

/**
 * The bounds of every reward, wherever it comes from. XP and gold a billion either way, points 999 either way (a
 * level holds 3); 20 items as a room award has carried; 8 skills, statuses and boons, as the design gives them.
 */
export const REWARD_BOUNDS = {
  xp: 1e9, gold: 1e9, points: 999, items: 20, skills: 8, statuses: 8, boons: 8, rounds: 999,
  title: 60, titleDesc: 200, bonus: 999, job: 60, boonName: 60, boonText: 200,
} as const;

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const whole = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.trunc(v))) : d);
/** Trimmed text cut to `n`, or '' when it is not text. */
const line = (v: unknown, n: number): string => (typeof v === 'string' ? v.trim().slice(0, n) : '');
/** At most `n` entries of a list, each read by `read`; an entry it refuses (null) is dropped. Not a list: none. */
function listOf<T>(v: unknown, n: number, read: (x: unknown) => T | null): T[] {
  const out: T[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    if (out.length >= n) break;
    const x = read(raw);
    if (x !== null) out.push(x);
  }
  return out;
}

/**
 * A title read from outside data: a name, or null; its bonus keys inside the bound; its band a rank or none; its powers
 * by `parsePowers`, a title whose worn status or active is past its size refused whole (null), as a skill is.
 */
function title(v: unknown): RewardTitle | null {
  if (!isObj(v)) return null;
  const B = REWARD_BOUNDS, name = line(v.name, B.title), powers = parsePowers(v);
  if (!name || powers === null) return null;
  const raw = isObj(v.bonus) ? v.bonus : {}, bonus: Record<string, number> = {};
  for (const k of BONUS_KEYS) { const n = whole(Object.hasOwn(raw, k) ? raw[k] : 0, -B.bonus, B.bonus, 0); if (n) bonus[k] = n; }
  const key = titleKey(v.key), replaces = line(v.replaces, B.title), band = parseBand(v.band);
  // a title in place of itself is that title
  return { name, desc: typeof v.desc === 'string' ? v.desc.slice(0, B.titleDesc) : '', bonus, ...(key ? { key } : {}), ...(replaces && replaces !== name ? { replaces } : {}), ...(band ? { band } : {}), ...powers };
}
/**
 * A status a reward gives: a key a status may have that is not a chip drawn from a hunter's state. Its def is read by
 * `parseStatusDef` with the shipped rules' dice limits, as every reward is read before any GM's rules are known.
 */
function status(v: unknown): RewardStatus | null {
  if (!isObj(v) || !isStatusKey(v.key) || isStateChip(v.key)) return null;
  const out: RewardStatus = { key: v.key, rounds: v.rounds === null || v.rounds === undefined ? null : whole(v.rounds, 1, REWARD_BOUNDS.rounds, 1) };
  const def = parseStatusDef(v.def, RULES);
  // refused whole for its def's size: the key without the def it came with would name another status, or none
  if (!def && statusTooLarge(v.def, RULES)) return null;
  if (def) out.def = def;
  return out;
}
function boon(v: unknown): BoonGrant | null {
  if (!isObj(v)) return null;
  const name = line(v.name, REWARD_BOUNDS.boonName);
  return name ? { name, text: typeof v.text === 'string' ? v.text.slice(0, REWARD_BOUNDS.boonText) : '' } : null;
}

/** The reader of one entry of each part of a reward, an entry it refuses null: also the rule overrides' (overrides.ts). */
export const REWARD_ENTRY = { items: parseItem, skills: parseSkill, statuses: status, boons: boon, title } as const;

/**
 * A reward read from outside data, or null when it is not an object. Each field of the wrong type takes the default an
 * empty reward has; a number is cut to a whole one inside `REWARD_BOUNDS`; each list keeps its first entries up to its
 * bound, each read by its kind's parser (`parseItem`, `parseSkill`), an entry it refuses dropped. A title or boon needs a
 * name. Every other key is dropped.
 */
export function parseRewards(v: unknown): Rewards | null {
  if (!isObj(v)) return null;
  const B = REWARD_BOUNDS;
  return {
    xp: whole(v.xp, -B.xp, B.xp, 0), points: whole(v.points, -B.points, B.points, 0), gold: whole(v.gold, -B.gold, B.gold, 0),
    items: listOf(v.items, B.items, parseItem), title: title(v.title), job: line(v.job, B.job) || null,
    skills: listOf(v.skills, B.skills, parseSkill), statuses: listOf(v.statuses, B.statuses, status), boons: listOf(v.boons, B.boons, boon),
  };
}

/**
 * The title named `name` as a reward carries it: a built-in title of the sender's rules brings its description, bonus
 * and band, any other name is a title without a bonus. Null for a blank name.
 */
export function titleReward(R: Pick<Rules, 'titles'>, name: string): RewardTitle | null {
  const n = name.trim().slice(0, REWARD_BOUNDS.title);
  if (!n) return null;
  const seed = R.titles.find(t => t.name === n);
  return title({ name: n, desc: seed?.desc ?? '', bonus: seed?.bonus ?? {}, key: seed?.key, band: seed?.band });
}

/**
 * A System window's words: its title, in the System's voice ("THE SYSTEM TOOK NOTE"), and one plain line. A bundle given
 * by hand opens with them (the GM's awards for roleplay, src/core/registry/bundles.ts).
 */
export type SystemWords = { readonly title: string; readonly line: string };
/** The bounds of a window's words: a title as a feat's or a title's, a line as a boon's text. */
export const WORDS_BOUNDS = { title: 60, line: 200 } as const;
/** A window's words from outside data, or null when it has no title. The title is cut and upper case (the System's voice). */
export function parseWords(v: unknown): SystemWords | null {
  if (!isObj(v)) return null;
  const title = line(v.title, WORDS_BOUNDS.title).toUpperCase();
  return title ? { title, line: line(v.line, WORDS_BOUNDS.line) } : null;
}

/** A named reward the GM saved to give again (`library.rewards`). `window`: the words it is given with; absent is "REWARD RECEIVED". */
export type RewardBundle = { id: BundleId; name: string; rewards: Rewards; window?: SystemWords };
export const BUNDLE_NAME = 60;

/**
 * The GM saves a reward bundle by its id (the library's `rewards`): the bundle with that id takes the name and the reward
 * (an edit, a rename: one write), else a new bundle under `id`, refused past `cap` (`full`). A blank name is refused
 * (`blank`), and so is a name another bundle holds in any case (`taken`), so a rename never deletes one bundle and
 * overwrites another (implicit audit 3, R1).
 */
export function saveBundle<L extends { rewards: RewardBundle[] }>(lib: L, id: string, name: string, rewards: Rewards, cap: number, window: SystemWords | null = null): L | Refused<'blank' | 'full' | 'taken'> {
  const n = String(name ?? '').trim().slice(0, BUNDLE_NAME);
  if (!n) return refuse('blank');
  if (lib.rewards.some(b => b.id !== id && b.name.toLowerCase() === n.toLowerCase())) return refuse('taken');
  const made = (bid: string) => ({ id: bid, name: n, rewards, ...(window ? { window } : {}) });
  if (lib.rewards.some(b => b.id === id)) return { ...lib, rewards: lib.rewards.map(b => (b.id === id ? { ...made(id), id: b.id } : b)) };
  return lib.rewards.length >= cap ? refuse('full') : { ...lib, rewards: [...lib.rewards, made(id)] };
}
/** A saved bundle deleted. One that is not there is refused (`no-bundle`). */
export function removeBundle<L extends { rewards: RewardBundle[] }>(lib: L, id: string): L | Refused<'no-bundle'> {
  return lib.rewards.some(b => b.id === id) ? { ...lib, rewards: lib.rewards.filter(b => b.id !== id) } : refuse('no-bundle');
}
/** A bundle read from outside data, without its id, or null when it is not an object or has no name. Its rewards are read by `parseRewards`. */
export function parseBundle(v: unknown): Omit<RewardBundle, 'id'> | null {
  if (!isObj(v)) return null;
  const name = line(v.name, BUNDLE_NAME), window = parseWords(v.window);
  return name ? { name, rewards: parseRewards(v.rewards) ?? newRewards(), ...(window ? { window } : {}) } : null;
}

/**
 * What a form that holds the reward editor says when the editor would drop a row (`blocked()`: a row without its item,
 * skill or name, or rounds out of range): the Award form, the quest form, and the story maker before it closes a chapter.
 */
export const UNFINISHED_ROWS = 'Finish or remove the reward rows marked in red.';

/** Whether a reward gives anything at all. */
export const isEmptyReward = (r: Rewards): boolean =>
  !r.xp && !r.points && !r.gold && !r.items.length && !r.title && !r.job && !r.skills.length && !r.statuses.length && !r.boons.length;

/**
 * An amount of XP, gold or points in words, the one rule for how a reward says a gain and a cost, on the quest card, in
 * the log and in the window: "+50 XP", "Loses 40 gold", "Loses 1 ability point".
 */
const amount = (n: number, what: string): string => `${n < 0 ? 'Loses ' : '+'}${Math.abs(n).toLocaleString('en-US')} ${what}`;
const points = (n: number): string => `ability point${Math.abs(n) === 1 ? '' : 's'}`;
const rounds = (n: number | null): string => (n ? ` (${n} round${n === 1 ? '' : 's'})` : '');
/** A reward's title in words: its name, and the title it takes the place of when it names one ("Square (in place of Owed to the Deep)"). */
const titleWords = (t: RewardTitle): string => `${t.replaces ? `${t.name} (in place of ${t.replaces})` : t.name}${t.worn ? `, ${WORN_WORDS.line(t.worn.label)}` : ''}`;
/** The reward editor's words for a title's worn status, and the reward line's. */
export const WORN_WORDS = {
  label: 'Passive status in fights', none: 'None',
  hint: 'While this is the hunter\'s active title, the status is on the hunter in every fight.',
  line: (status: string): string => `grants status in fights: ${status}`,
} as const;
/** The reward editor's words for a title's active: an ability of the library the hunter may use in a fight. */
export const ACTIVE_WORDS = {
  label: 'Usable in fights', none: 'None',
  hint: 'While this is the hunter\'s active title, they can use this ability in a fight. Editing the skill in your library later will not change this reward.',
} as const;
/** The reward editor's words for a title given in another's place. */
export const REPLACES_WORDS = {
  label: 'Replaces title (optional)',
  hint: 'Replaces the hunter\'s existing title with this name. If they do not have it, or if this field is empty, they get a new title.',
} as const;
/** A reward status's label: its own def's, else the rules' status of its key, else the key. */
const labelOf = (R: RewardRules, s: RewardStatus): string => s.def?.label ?? R.conditions[s.key]?.label ?? s.key;
/** A reward in words, one line a part: "+50 XP", "Loses 40 gold", "Item: Potion ×2", "Title: Wolf Slayer", "Title: Square (in place of Owed to the Deep)", "Status: Hasted (3 rounds)", "Boon: ...". */
export function rewardLines(R: RewardRules, r: Rewards): string[] {
  const out: string[] = [];
  if (r.xp) out.push(amount(r.xp, 'XP'));
  if (r.points) out.push(amount(r.points, points(r.points)));
  if (r.gold) out.push(amount(r.gold, 'gold'));
  for (const i of r.items) out.push(`Item: ${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}`);
  if (r.title) out.push(`Title: ${titleWords(r.title)}`);
  if (r.job) out.push(`Job: ${r.job}`);
  for (const s of r.skills) out.push(`Skill: ${s.name}`);
  for (const s of r.statuses) out.push(`Status: ${labelOf(R, s)}${rounds(s.rounds)}`);
  for (const b of r.boons) out.push(`Boon: ${b.name}`);
  return out;
}

/** What a grant did beside the reward's own parts: a build change's line, the level before and after its XP, and any gold that went toward System revive debt. */
export type GrantMore = {
  readonly build?: string;
  readonly level?: { readonly from: number; readonly to: number };
  readonly debt?: { readonly paid: number; readonly left: number };
};

/**
 * The reward window's lines, as the player sees them when a reward arrives (`applyRewards` in src/views/hunter.js shows
 * them; the reward editor's preview draws them): "+100 XP", "+50 gold", "Loses 1 ability point", "Item acquired: Potion
 * ×2", "Title acquired: ...", "Skill acquired: ...", "Status: Hasted (3 rounds)", "Boon: ...". `more.build` is a build
 * change's line, shown after the items. A level lost to an XP cost is said after the XP ("Loses 1 level: now level 2");
 * a level gained has a window of its own (`levelup`). `more.debt` adds the debt payment line after the kept gold.
 */
export function grantLines(R: RewardRules, r: Rewards, more: GrantMore = {}): string[] {
  const out: string[] = [];
  if (r.xp) out.push(amount(r.xp, 'XP'));
  const lost = more.level ? more.level.from - more.level.to : 0;
  if (more.level && lost > 0) out.push(`Loses ${lost} level${lost === 1 ? '' : 's'} (now level ${more.level.to})`);
  if (r.gold) out.push(amount(r.gold, 'gold'));
  const paid = more.debt ? debtPaidLine(more.debt.paid, more.debt.left) : null;
  if (paid) out.push(paid);
  if (r.points) out.push(amount(r.points, points(r.points)));
  for (const i of r.items) out.push(`Item acquired: ${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}`);
  if (more.build) out.push(more.build);
  if (r.title) out.push(`Title acquired: ${titleWords(r.title)}`);
  if (r.job) out.push(`Job: ${r.job}`);
  for (const s of r.skills) out.push(`Skill acquired: ${s.name}`);
  for (const s of r.statuses) out.push(`Status: ${labelOf(R, s)}${rounds(s.rounds)}`);
  for (const b of r.boons) out.push(`Boon: ${b.name}`);
  return out;
}
