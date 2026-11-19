// record.ts: what a hunter is called and holds beside its numbers: its name, job and rank, its titles and the active
// one, its boons. Pure. A view changes these only through a function here, in `store.apply` (src/core/save-step.ts).
// A change to the active title or a title's bonus changes the sheet: chain `fitted` (sheet.ts) after it.
// Ids and times are arguments: the store reserves an id (`store.id('t')`), the view reads the clock.
import { RANKS, jobOf } from '../save.ts';
import type { Boon, Rank, Title } from '../save.ts';
import type { StatusDef } from '../combat/effect-ops.ts';
import { oneOf } from '../one-of.ts';
import { titleKey } from '../ids.ts';
import { rankForLevel, rankIdx } from '../rules.ts';
import type { Rules } from '../rules.ts';
import { refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { record } from './chronicle.ts';
import type { Chronicle } from './chronicle.ts';

type Named = { name: string; job: string | null; rank: Rank; level: number };
type Titled = { titles: Title[]; titleId: string | null };
type Boons = { boons: Boon[] };
/** A hunter's chronicle: a new rank and a title given are facts of it (chronicle.ts `record`). */
type Chronicled = { readonly chronicle: Chronicle };
/** `h` with its rank set to `rank`, and the rank's fact when it moved. */
const ranked = <H extends Named & Chronicled>(h: H, rank: Rank): H => (rank === h.rank ? h : record({ ...h, rank }, { kind: 'rank', rank }));

/** A name as stored: spaces run together, at most 60 characters. */
export const cleanName = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);

/** A new name; one that is blank after cleaning is refused (`blank`). */
export function rename<H extends Named>(h: H, name: string): H | Refused<'blank'> {
  const n = cleanName(name);
  return n ? { ...h, name: n } : refuse('blank');
}
/** The job set to `job`, or to none (null) for a blank: a GM clears a job by clearing the field. */
export function setJob<H extends Named>(h: H, job: string | null): H {
  return { ...h, job: jobOf(job) };
}

/** The GM's choice of rank; a word that is not a rank keeps the rank. A new rank is a fact of the chronicle. */
export const setRank = <H extends Named & Chronicled>(h: H, rank: unknown): H => ranked(h, oneOf(rank, RANKS, h.rank));
/** The rank the hunter's level earns when it is above the rank held; else refused (`not-eligible`). */
export function reevaluate<H extends Named & Chronicled>(h: H, R: Rules): H | Refused<'not-eligible'> {
  const to = rankForLevel(R, h.level);
  return rankIdx(to) > rankIdx(h.rank) ? ranked(h, to) : refuse('not-eligible');
}

// ── titles ──
/**
 * What a title is given from: a rule title by its key (`{ key }`), a title written out (a reward's; with the key of the
 * rule title it copies, when it does, and the name of a title it takes the place of, `replaces`), or a bare name.
 */
export type TitleSpec = string | { key: string } | { name: string; desc?: string; bonus?: Title['bonus']; key?: string; replaces?: string; worn?: StatusDef };
/** A title of the rules (`R.titles`): its key is what a hunter's title records (`Title.seedKey`), never its name. */
export type SeedTitle = { key: string; name: string; desc?: string; bonus?: Title['bonus'] };
/** The rule title a spec names by its key, or null. */
const seedOf = (spec: TitleSpec, seeds: readonly SeedTitle[]): SeedTitle | null =>
  (typeof spec === 'object' && spec.key ? seeds.find(s => s.key === spec.key) : undefined) ?? null;
const specName = (spec: TitleSpec): string => String(typeof spec === 'string' ? spec : 'name' in spec ? spec.name : '').slice(0, 60);
/**
 * Whether the hunter holds the title: a rule title by the key its title recorded (a rename keeps it held), any other
 * by its name (implicit audit 3, H6: a rule title was found by its name).
 */
export const holdsTitle = (h: Titled, spec: TitleSpec, seeds: readonly SeedTitle[]): boolean => {
  const seed = seedOf(spec, seeds);
  return seed ? h.titles.some(t => t.seedKey === seed.key) : h.titles.some(t => !t.seedKey && t.name === specName(spec));
};
/**
 * The title a hunter holds under `name`, for a title given in its place: the rule title of that name by the key its
 * title recorded (so a renamed one is still found), else a title of that name. Undefined when the hunter holds neither.
 */
export const titleNamed = (h: Titled, name: string, seeds: readonly SeedTitle[]): Title | undefined => {
  const seed = seeds.find(s => s.name === name);
  return (seed && h.titles.find(t => t.seedKey === seed.key)) ?? h.titles.find(t => t.name === name);
};
/**
 * Gives a title under `id`; one already held is kept as it is. A rule title records its key; by its key alone it takes the
 * rule's words and bonus. A title that names another (`replaces`, found by `titleNamed`) takes its place: that title
 * becomes this one where it stands, its id kept, so an active title stays active under its new name and bonus, and `id`
 * is not used; when the hunter does not hold the named title, this one is given as new. A title given, as new or in
 * another's place, is a fact of the chronicle.
 */
export function giveTitle<H extends Titled & Chronicled>(h: H, spec: TitleSpec, id: string, seeds: readonly SeedTitle[]): H {
  const seed = seedOf(spec, seeds), written = typeof spec === 'object' && 'name' in spec ? spec : null;
  const name = written || !seed ? specName(spec) : seed.name;
  if (!name || holdsTitle(h, spec, seeds)) return h;
  // a reward's title keeps the words it was sent with; a rule title by its key alone takes the rule's
  const src: { desc?: string; bonus?: Title['bonus'] } = written ?? seed ?? {};
  const old = written?.replaces ? titleNamed(h, written.replaces, seeds) : undefined;
  // a written title's worn status goes with it, also in another's place (the old one's goes with the old title)
  const made = (at: string) => ({ id: at, name, desc: String(src.desc ?? '').slice(0, 500), bonus: { ...(src.bonus ?? {}) }, ...(seed ? { seedKey: seed.key } : {}), ...(written?.worn ? { worn: written.worn } : {}) });
  return record({ ...h, titles: old ? h.titles.map(t => (t === old ? made(old.id) : t)) : [...h.titles, made(id)] }, { kind: 'title', name });
}
/** Set active, or unset when it is the active one. A title the hunter does not hold is refused (`no-title`). */
export function toggleTitle<H extends Titled>(h: H, id: string): H | Refused<'no-title'> {
  if (!h.titles.some(t => t.id === id)) return refuse('no-title');
  return { ...h, titleId: h.titleId === id ? null : id };
}
/** Takes a title away; the active one leaves nothing active. */
export function removeTitle<H extends Titled>(h: H, id: string): H | Refused<'no-title'> {
  if (!h.titles.some(t => t.id === id)) return refuse('no-title');
  return { ...h, titles: h.titles.filter(t => t.id !== id), titleId: h.titleId === id ? null : h.titleId };
}
/** The GM's title form: a new title under `id`, or the words and bonus of the title `id` names. A blank name is refused. */
export function writeTitle<H extends Titled>(h: H, id: string, fields: { name: string; desc: string; bonus: Title['bonus'] }): H | Refused<'blank'> {
  const name = cleanName(fields.name), desc = String(fields.desc ?? '').slice(0, 200);
  if (!name) return refuse('blank');
  const have = h.titles.some(t => t.id === id);
  const titles = have ? h.titles.map(t => (t.id === id ? { ...t, name, desc, bonus: { ...fields.bonus } } : t)) : [...h.titles, { id, name, desc, bonus: { ...fields.bonus } }];
  return { ...h, titles };
}
/**
 * The identity form's title box: blank leaves no title active; a name renames the active title, or with none active
 * makes a bare title under `id` and sets it active.
 */
export function nameActiveTitle<H extends Titled>(h: H, name: string, id: string): H {
  const n = cleanName(name);
  if (!n) return { ...h, titleId: null };
  if (h.titles.some(t => t.id === h.titleId)) return { ...h, titles: h.titles.map(t => (t.id === h.titleId ? { ...t, name: n } : t)) };
  return { ...h, titles: [...h.titles, { id, name: n, desc: '', bonus: {} }], titleId: id };
}

// ── boons ──
/** Boons given, each under its id, at `at`. */
export const giveBoons = <H extends Boons>(h: H, boons: readonly { id: string; name: string; text: string }[], at: string): H =>
  boons.length ? { ...h, boons: [...h.boons, ...boons.map(b => ({ id: b.id, name: b.name, text: b.text, at }))] } : h;
/** A boon redeemed or taken back: it leaves the hunter. One the hunter does not hold is refused (`no-boon`). */
export function dropBoon<H extends Boons>(h: H, id: string): H | Refused<'no-boon'> {
  return h.boons.some(b => b.id === id) ? { ...h, boons: h.boons.filter(b => b.id !== id) } : refuse('no-boon');
}
