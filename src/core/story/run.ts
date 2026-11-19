// story/run.ts: a story on the table, the GM's run of a library story (docs/agent-handoff/features/notes-1-stories.md,
// sections 2 and 11). Pure. A run lives on the GM's save only (`save.storyRuns`); a player's phone holds what each chapter
// gave it and nothing of the run. Its machine is `runStep` and its `TABLE` (no run, running at a chapter, ended), and its
// three events are the GM's taps: turn on (which opens chapter 1), open a chapter (the next, another, the same again,
// for some hunters), end. No event comes from a clock, a count, a fact, a quest's end or a room message, and this file
// is the one writer of a run (a lint: "only src/core/story/run.ts writes a story run"); `storyMove`, the one write of a
// move, is called only by the taps of the views' stories.js (the lint "a story moves only from stories.js").
// A stale tap is refused by the count of opens (`opens`, ruling 1): the window carries the count it was drawn with
// (`seen`), so the same open sent twice, or an end held under Undo while the story was opened again, writes nothing.
import { GIVE_HOLD_MS } from '../registry/bundles.ts';
import { parseHunterRef, parseSaveId } from '../ids.ts';
import type { HunterId, HunterRef, StoryId, StoryRunId } from '../ids.ts';
import type { Day, VitalsAt } from '../hunter/grant.ts';
import type { Save } from '../save.ts';
import { isRefused, refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import type { Said } from '../session-log.ts';
import { sent } from '../award.ts';
import { pickables, sheetName } from '../party.ts';
import type { Pickable } from '../party.ts';
import { newEvent } from '../protocol.ts';
import type { EventStamp, RoomCode, RoomEvent, SheetKey } from '../protocol.ts';
import { newRewards } from '../rewards.ts';
import { playerHeld } from '../combat/fight-save.ts';
import type { HeldFor } from '../combat/fight-save.ts';
import type { Rank } from '../rules.ts';
import { CHAPTER_MAX, chapterBody, chapterLanded, chapterSize } from './story.ts';
import type { Chapter, ChapterBody, ChapterGiven, Story } from './story.ts';

// ── what a run is ──
/** Who a run is for: whoever is at the table when a chapter opens, or the hunters chosen. */
export type Who = { readonly at: 'table' } | { readonly at: 'hunters'; readonly refs: readonly HunterRef[] };
/** A chapter opened: which (0-based), for whom (the hunters who got it), when, in which session. */
export type ChapterOpened = { readonly chapter: number; readonly to: readonly HunterRef[]; readonly at: string; readonly session: number };
export const RUN_STATES = ['none', 'running', 'ended'] as const;
export type RunState =
  /** At the chapter last opened, 0-based. */
  | { readonly at: 'running'; readonly chapter: number }
  | { readonly at: 'ended'; readonly chapter: number; readonly endedAt: string; readonly session: number };
export type StoryRun = {
  readonly id: StoryRunId; readonly story: StoryId;
  /** The story's name when it was turned on, so a run whose story was deleted still reads. */
  readonly name: string;
  readonly who: Who; readonly state: RunState;
  /** Every open since the turn-on (the turn-on's own is 1). It only grows and is never cut with `opened`: the stale-tap guard. */
  readonly opens: number;
  /** The newest `OPENED_MAX` opens, oldest first. */
  readonly opened: readonly ChapterOpened[];
};

/**
 * The bounds of the runs on a save. A table runs a few stories at once: 12 running at most (a turn-on past it is refused,
 * `full`, so nothing running is ever cut), the newest 12 ended kept for the fold, and the newest 40 opens a run (a
 * story's chapter opened again each session for a year is under it, and a run stays near 6 KB).
 */
export const RUNNING_MAX = 12, ENDED_KEPT = 12, OPENED_MAX = 40;
/** How long End is held under Undo before it is written: Give…'s hold (bundles.ts `GIVE_HOLD_MS`). */
export const END_HOLD_MS = GIVE_HOLD_MS;

// ── the machine ──
export type RunEvent =
  /** Turned on for `who`; opens chapter 1 for `to` (the hunters at the table it goes to now). */
  | { readonly type: 'turnOn'; readonly id: StoryRunId; readonly story: StoryId; readonly who: Who; readonly to: readonly HunterRef[]; readonly at: string; readonly session: number }
  /** Chapter `chapter` (0-based) opened for `to`. `seen`: the run's `opens` when the window was drawn. */
  | { readonly type: 'open'; readonly chapter: number; readonly seen: number; readonly to: readonly HunterRef[]; readonly at: string; readonly session: number }
  /** Ended. `seen`: the run's `opens` when End was tapped. */
  | { readonly type: 'end'; readonly seen: number; readonly at: string; readonly session: number };
/**
 * Why a move was refused. `running`: that run is already on. `ended`: it has ended. `no-run`: there is no such run.
 * `moved`: it was opened since the window or the tap was drawn. `no-chapter`: the story has no such chapter now.
 * `nobody`: no hunter at the table to give it to. `no-story`: the story is no longer in the library. `full`: `RUNNING_MAX`
 * stories run already. `too-large`: the chapter is past `CHAPTER_MAX` and a player's hunter would be sent it.
 */
export type RunRefusal = 'running' | 'ended' | 'no-run' | 'moved' | 'no-chapter' | 'nobody' | 'no-story' | 'full' | 'too-large';
/** What the app must do after a step: give chapter `chapter` to `to`. */
export type RunFx = { readonly type: 'deliver'; readonly chapter: number; readonly to: readonly HunterRef[] } | null;
type Stepped = { readonly run: StoryRun; readonly fx: RunFx };
type Cell<E extends RunEvent['type']> = ((run: StoryRun | null, e: Extract<RunEvent, { type: E }>, story: Story | null) => Stepped | Refused<RunRefusal>) | null;

/** The same hunter: this phone's by its id, a player's by its sheet key. */
export const sameRef = (a: HunterRef, b: HunterRef): boolean =>
  a.kind === 'local' ? b.kind === 'local' && a.hunterId === b.hunterId : b.kind === 'remote' && a.remote === b.remote;
const opening = (e: { chapter: number; to: readonly HunterRef[]; at: string; session: number }): ChapterOpened => ({ chapter: e.chapter, to: e.to, at: e.at, session: e.session });

/** Every cell of a run's machine: a state by an event. A null cell is refused with the state's own reason (`runStep`). */
export const TABLE: { readonly [S in (typeof RUN_STATES)[number]]: { readonly [E in RunEvent['type']]: Cell<E> } } = {
  none: {
    turnOn: (_run, e, story) => {
      if (!story || story.id !== e.story) return refuse('no-story');
      if (!e.to.length) return refuse('nobody');
      const run: StoryRun = { id: e.id, story: story.id, name: story.name, who: e.who, state: { at: 'running', chapter: 0 }, opens: 1, opened: [opening({ ...e, chapter: 0 })] };
      return { run, fx: { type: 'deliver', chapter: 0, to: e.to } };
    },
    open: null,
    end: null,
  },
  running: {
    turnOn: null,
    open: (run, e, story) => {
      const r = run!;
      if (e.seen !== r.opens) return refuse('moved');
      if (!story) return refuse('no-story');
      if (!Number.isInteger(e.chapter) || e.chapter < 0 || e.chapter >= story.chapters.length) return refuse('no-chapter');
      if (!e.to.length) return refuse('nobody');
      // a hunter ticked who is not one of a chosen run's joins it, so the next chapters preselect it too
      const was = r.who, who: Who = was.at === 'table' ? was : { at: 'hunters', refs: [...was.refs, ...e.to.filter(t => !was.refs.some(x => sameRef(x, t)))] };
      const next: StoryRun = { ...r, who, state: { at: 'running', chapter: e.chapter }, opens: r.opens + 1, opened: [...r.opened, opening(e)].slice(-OPENED_MAX) };
      return { run: next, fx: { type: 'deliver', chapter: e.chapter, to: e.to } };
    },
    end: (run, e) => {
      const r = run!;
      if (e.seen !== r.opens) return refuse('moved');
      return { run: { ...r, state: { at: 'ended', chapter: r.state.chapter, endedAt: e.at, session: e.session } }, fx: null };
    },
  },
  ended: { turnOn: null, open: null, end: null },
};
/** Why a state refuses an event it has no cell for. */
const NO_CELL: { readonly [S in (typeof RUN_STATES)[number]]: RunRefusal } = { none: 'no-run', running: 'running', ended: 'ended' };

/** Run `run` (null: no run yet) after `e`, with the story as the library holds it now, and what to deliver; or why not. */
export function runStep(run: StoryRun | null, e: RunEvent, story: Story | null): Stepped | Refused<RunRefusal> {
  const state = run ? run.state.at : 'none';
  const cell = TABLE[state][e.type] as Cell<RunEvent['type']>;
  return cell ? cell(run, e as never, story) : refuse(NO_CELL[state]);
}

// ── reading a run ──
/** Whether `ref` has had chapter `chapter` of `run`. */
export const hadChapter = (run: StoryRun, chapter: number, ref: HunterRef): boolean =>
  run.opened.some(o => o.chapter === chapter && o.to.some(t => sameRef(t, ref)));
/**
 * Who the open window ticks first for chapter `chapter`: the run's hunters at the table (`atTable`; for the table,
 * everyone there; for chosen hunters, those of them there) who have not had it, so a late joiner is ticked alone. When
 * every one of them has had it (a chapter opened again), all of them.
 */
export function whoFor(run: StoryRun, chapter: number, atTable: readonly HunterRef[]): HunterRef[] {
  const who = run.who, pool = who.at === 'table' ? [...atTable] : atTable.filter(r => who.refs.some(x => sameRef(x, r)));
  const fresh = pool.filter(r => !hadChapter(run, chapter, r));
  return fresh.length ? fresh : pool;
}
/** The chapter after the run's (0-based), or null when the run is at the story's last chapter. */
export const nextChapter = (run: StoryRun, story: Pick<Story, 'chapters'>): number | null =>
  run.state.chapter + 1 < story.chapters.length ? run.state.chapter + 1 : null;
/** The runs that are running. */
export const running = (runs: readonly StoryRun[]): StoryRun[] => runs.filter(r => r.state.at === 'running');
/** Whether a run of story `id` is running: the Workshop's tag, and Delete's guard (library.ts `removeStory`). */
export const isRunning = (runs: readonly StoryRun[], id: StoryId): boolean => runs.some(r => r.story === id && r.state.at === 'running');
/** The runs a save keeps: every running one (at most `RUNNING_MAX`, which a turn-on refuses past) and the newest `ENDED_KEPT` ended, in order. */
export function keptRuns(runs: readonly StoryRun[]): StoryRun[] {
  const ended = runs.filter(r => r.state.at === 'ended'), drop = new Set(ended.slice(0, Math.max(0, ended.length - ENDED_KEPT)));
  const live = runs.filter(r => r.state.at === 'running').slice(0, RUNNING_MAX);
  return runs.filter(r => !drop.has(r) && (r.state.at === 'ended' || live.includes(r)));
}

// ── the one write of a move ──
/** A player's hunter as the GM's phone holds it: the room's sheet of it, by its key (its name, and its rank for a status put on its row). */
export type PlayerSheet = { readonly key: SheetKey; readonly data: { readonly name: string; readonly rank: Rank } };
/**
 * The room a move sends to: its code, the players' sheets the GM's phone holds (the players' hunters at the table),
 * whether this phone's fight holds a player's hunter on a row, and the stamp of the message's id, made once by the tap.
 */
export type MoveRoom = { readonly code: RoomCode; readonly sheets: readonly PlayerSheet[]; readonly onRow: (key: SheetKey) => boolean; readonly stamp: EventStamp };
/**
 * What a move needs beside the save: the moment and rules (`Day`), where each of this phone's hunters keeps its vitals
 * now, and the room (null: no room, so no player's hunter is at the table).
 */
export type MoveCtx = { readonly day: Day; readonly vitals: (hid: HunterId) => VitalsAt; readonly room: MoveRoom | null };
/**
 * What a move did: the save after it, the run, each of this phone's hunters given the chapter, the hunters skipped (not at
 * the table), the players' hunters it was posted to, and for each of those whose row this phone's fight holds, what the
 * chapter hands to that row (fight-save.ts `playerHeld`: its statuses; its message carries the rest).
 */
export type StoryMoved = {
  readonly save: Save; readonly run: StoryRun; readonly granted: readonly { readonly hid: HunterId; readonly g: ChapterGiven }[]; readonly skipped: readonly HunterRef[];
  readonly posted: readonly SheetKey[]; readonly onRow: readonly HeldFor[];
};

/** The hunters at the table: this phone's, then the players' of the room's sheets the GM's phone holds. */
export const atTable = (save: Pick<Save, 'hunters'>, sheets: readonly PlayerSheet[]): Pickable[] => pickables(save.hunters, sheets);

/**
 * Run `runId` moved by `e`, as one step on the save: the run written (a new one added, `keptRuns` applied), the chapter
 * given to each hunter of `e.to` this phone holds (`chapterLanded`, with its vitals where a fight holds them), its
 * `chapter` message posted to the outbox for the players' hunters of `e.to` (two messages when this phone's fight holds
 * some of them on a row: theirs without the statuses, which go on the rows), and one line of the session log. All of it,
 * or a refusal and nothing. A hunter of `e.to` not at the table is skipped and said; when none is left, `nobody`. A
 * chapter past `CHAPTER_MAX` opened for a player's hunter is `too-large`. A turn-on past `RUNNING_MAX` running is `full`.
 */
export function storyMove(save: Save, runId: StoryRunId, e: RunEvent, ctx: MoveCtx): StoryMoved | Refused<RunRefusal> {
  const run = save.storyRuns.find(r => r.id === runId) ?? null;
  if (e.type === 'turnOn' && !run && running(save.storyRuns).length >= RUNNING_MAX) return refuse('full');
  const storyId = run ? run.story : e.type === 'turnOn' ? e.story : null;
  const story = save.library.stories.find(s => s.id === storyId) ?? null;
  const sheets = ctx.room ? ctx.room.sheets : [], here = atTable(save, sheets), present = (r: HunterRef) => here.some(x => sameRef(x.ref, r));
  const skipped = 'to' in e ? e.to.filter(r => !present(r)) : [];
  const ev: RunEvent = 'to' in e ? { ...e, to: e.to.filter(present) } : e;
  const stepped = runStep(run, ev, story);
  if (isRefused(stepped)) return stepped;
  const r = stepped.run, fx = stepped.fx;
  const chapter = fx && story ? story.chapters[fx.chapter] : undefined;
  const players = fx ? fx.to.flatMap(x => (x.kind === 'remote' ? [x.remote] : [])) : [];
  if (chapter && players.length && chapterSize(chapter) > CHAPTER_MAX) return refuse('too-large');
  let next: Save = { ...save, storyRuns: keptRuns(run ? save.storyRuns.map(x => (x.id === r.id ? r : x)) : [...save.storyRuns, r]) };
  const granted: { hid: HunterId; g: ChapterGiven }[] = [], events: RoomEvent[] = [];
  let onRow: StoryMoved['onRow'] = [];
  if (fx && chapter) {
    const body = chapterBody(chapter, ctx.day.at);
    for (const ref of fx.to) {
      if (ref.kind !== 'local') continue;
      const g = chapterLanded(next, ref.hunterId, body, { ...ctx.day, vitals: ctx.vitals(ref.hunterId) });
      if (isRefused(g)) continue;
      next = g.save; granted.push({ hid: ref.hunterId, g });
    }
    const room = ctx.room;
    if (room && players.length) {
      const held = body.rewards.statuses.length ? players.filter(room.onRow) : [], free = players.filter(k => !held.includes(k));
      const { statuses: _onRow, ...kept } = body.rewards, rest: ChapterBody = { ...body, rewards: { ...newRewards(), ...kept } };
      const groups = [{ to: free, body }, { to: held, body: rest }].filter(g => g.to.length);
      groups.forEach((g, i) => {
        const made = newEvent('chapter', { to: g.to, ...g.body }, { ...room.stamp, now: room.stamp.now + i });
        if (!made) throw new Error('the room would refuse a chapter the library holds');
        events.push(made);
      });
      onRow = playerHeld(room.sheets, held, body.rewards.statuses);
    }
  }
  const names = (refs: readonly HunterRef[]) => refs.map(x => nameOf(save, sheets, x));
  const said = moveLine(r, ev, chapter ?? null, names);
  return { save: sent(next, { room: ctx.room ? ctx.room.code : null, events, said: [said] }, { at: ctx.day.at, cap: ctx.day.R.logCap }), run: r, granted, skipped, posted: players, onRow };
}

/** A hunter's name for the GM's words: this phone's by its id; a player's by its sheet in the room. */
export const nameOf = (save: Pick<Save, 'hunters'>, sheets: readonly PlayerSheet[], ref: HunterRef): string =>
  ref.kind === 'local' ? save.hunters.find(h => h.id === ref.hunterId)?.name ?? 'a hunter no longer here' : sheetName(sheets, ref.remote, "a player's hunter");

// ── the boundary ──
type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const whole = (v: unknown, lo: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= lo ? v : null);
const timeText = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 40) : '');
const refs = (v: unknown): HunterRef[] => (Array.isArray(v) ? v : []).flatMap(x => parseHunterRef(x) ?? []).slice(0, 64);
function parseOpened(v: unknown): ChapterOpened | null {
  if (!isObj(v)) return null;
  const chapter = whole(v.chapter, 0), session = whole(v.session, 0) ?? 0;
  return chapter === null ? null : { chapter, to: refs(v.to), at: timeText(v.at), session };
}
/**
 * A stored run, without its id (the save's repair gives it its own), or null when it names no story or no state. A
 * count of opens below the opens kept is raised to it; an end's time and session take their defaults.
 */
export function parseStoryRun(v: unknown): Omit<StoryRun, 'id'> | null {
  if (!isObj(v) || !isObj(v.state)) return null;
  const story = parseSaveId<'st'>(v.story), chapter = whole(v.state.chapter, 0);
  if (!story || chapter === null) return null;
  const state: RunState | null = v.state.at === 'running' ? { at: 'running', chapter }
    : v.state.at === 'ended' ? { at: 'ended', chapter, endedAt: timeText(v.state.endedAt), session: whole(v.state.session, 0) ?? 0 } : null;
  if (!state) return null;
  const who: Who = isObj(v.who) && v.who.at === 'hunters' ? { at: 'hunters', refs: refs(v.who.refs) } : { at: 'table' };
  const opened = (Array.isArray(v.opened) ? v.opened : []).flatMap(o => parseOpened(o) ?? []).slice(-OPENED_MAX);
  return { story, name: typeof v.name === 'string' ? v.name.slice(0, 60) : '', who, state, opens: Math.max(whole(v.opens, 0) ?? 0, opened.length), opened };
}

// ── the words (notes section 8) ──
/** "Mira", "Mira and Brakk", "Mira, Brakk and Eldrin". */
export const andList = (names: readonly string[]): string => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
/** A chapter by its number and its name for the GM: "chapter 2 (The runs)", or "chapter 2" when it has none. */
const chapterName = (i: number, c: Pick<Chapter, 'name'> | null): string => `chapter ${i + 1}${c && c.name ? ` (${c.name})` : ''}`;
const upper = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The session log's line of a move: its title the story's name, its text what the GM did. */
function moveLine(run: StoryRun, e: RunEvent, c: Chapter | null, names: (refs: readonly HunterRef[]) => string[]): Said {
  const to = 'to' in e ? andList(names(e.to)) : '';
  const text = e.type === 'turnOn'
    ? `Turned on for ${run.who.at === 'table' ? 'the table' : andList(names(run.who.refs))}. ${upper(chapterName(0, c))} opened for ${to}.`
    : e.type === 'open' ? `${upper(chapterName(e.chapter, c))} opened for ${to}.` : `Ended at chapter ${run.state.chapter + 1}.`;
  return { kind: 'story', hunterId: null, title: run.name, text };
}

/** What each refusal says, with the chapter the run is at (1-based) where it names one. */
export const RUN_REFUSAL_WORDS: { readonly [K in RunRefusal]: (chapter: number) => string } = {
  running: () => 'This story is already running.',
  ended: () => 'This story has ended.',
  'no-run': () => 'This story is not running.',
  moved: n => `This story was opened again meanwhile. It is at chapter ${n} now.`,
  'no-chapter': n => `This story has no chapter ${n} now. It was changed in the Workshop.`,
  nobody: () => 'Pick at least one hunter.',
  'no-story': () => 'This story is no longer in your Workshop. You can end it.',
  full: () => `${RUNNING_MAX} stories are running, the most at once. End one first.`,
  'too-large': n => `Chapter ${n} is too large to send to players' phones. Open it for this phone's hunters only, or give it fewer items in the Workshop.`,
};

/** What a chapter gives, for the card's next line. */
export const givesLine = (c: Pick<Chapter, 'rewards' | 'quest'>, empty: boolean): string =>
  !empty && c.quest ? 'Gives a reward and a quest.' : !empty ? 'Gives a reward.' : c.quest ? 'Gives a quest.' : 'Shows a window only.';
/** When the chapter the run is at opened: "Opened this session.", "Opened in session 12, 3 sessions ago." */
export function openedLine(opened: ChapterOpened | undefined, session: number): string {
  if (!opened || opened.session >= session) return 'Opened this session.';
  const ago = session - opened.session;
  return `Opened in session ${opened.session}, ${ago} session${ago === 1 ? '' : 's'} ago.`;
}

/** Every other sentence of the Stories section and its windows. */
export const STORY_WORDS = {
  tag: 'Stories',
  noStories: 'You have no stories yet. Make one in the Workshop.',
  newStory: 'New story',
  noneRunning: 'No story is running.',
  turnOnButton: 'Turn on a story',
  summary: (n: number) => (n ? `${n} running` : ''),
  forWho: (who: Who, names: readonly string[]) => (who.at === 'table' ? 'For the table' : (names.length ? `For ${andList(names)}` : 'For hunters not at the table')),
  at: (i: number, of: number, c: Pick<Chapter, 'name'> | null) => `Chapter ${i + 1} of ${of}${c && c.name ? `: ${c.name}` : ''}.`,
  note: (note: string) => `Your note: ${note}`,
  next: (i: number, c: Pick<Chapter, 'name' | 'words'>) => `Next: ${i + 1}. ${c.name ? `${c.name}. ` : ''}${c.words.title}.`,
  last: (i: number) => `Chapter ${i + 1} is the last.`,
  open: (i: number) => `Open chapter ${i + 1}`,
  end: 'End story',
  more: (name: string) => `More for ${name}`,
  openOther: 'Open a chapter…',
  cancel: 'Cancel',
  gone: 'This story is no longer in your Workshop. You can end it.',
  ended: (n: number) => `Ended (${n})`,
  endedLine: (name: string, forWho: string, chapter: number, session: number) => `${name} · ${forWho.charAt(0).toLowerCase()}${forWho.slice(1)} · ended at chapter ${chapter + 1} in session ${session}`,
  endedToast: (name: string) => `Ended ${name}.`,
  undo: 'Undo',
  playersSee: 'What the players see',
  yourNote: 'Your note',
  chapter: 'Chapter',
  who: 'Who',
  hasIt: 'has it',
  notHere: 'not at the table',
  again: (names: readonly string[]) => `${andList(names)} ${names.length === 1 ? 'has' : 'have'} had this chapter. Opening it gives it again.`,
  turnOnTitle: 'Turn on a story',
  turnOnStory: (name: string) => `Turn on ${name}`,
  table: 'The table',
  chosen: 'Chosen hunters',
  already: (forWhos: readonly string[]) => `Already running ${andList(forWhos.map(f => f.charAt(0).toLowerCase() + f.slice(1)))}.`,
  turnOnGo: 'Turn on and open chapter 1',
  opened: (i: number, names: readonly string[]) => `Opened chapter ${i + 1} for ${andList(names)}.`,
  turnedOn: (name: string, names: readonly string[]) => `Turned on ${name}. Opened chapter 1 for ${andList(names)}.`,
  skipped: (names: readonly string[]) => `Skipped ${andList(names)}: not at the table.`,
  waits: (names: readonly string[]) => `${andList(names)} ${names.length === 1 ? 'gets' : 'get'} it when the room answers.`,
  running: 'running',
  openedMark: 'opened',
  notSaved: 'Not saved. Nothing was given.',
  deleteRunning: (name: string) => `End ${name} in the GM view before you delete it.`,
};
