Goal: a story (an arc over several sessions, such as a chain of quests, a title that grows or a debt that comes due) is something the GM turns on for the table or for chosen hunters, moves one chapter at a time when he says so, and writes himself. Problem: the game has feats that fire by themselves and quests the GM issues one at a time, and nothing that holds an arc or remembers where the table is in it. Smallest change that meets it: a story as one more kind of custom content (a list of chapters, each chapter only parts the game already gives in one step: a System window's words, a `Rewards` given by `grant`, a quest issued from the GM), a run of a story kept on the GM's save and moved by one machine whose only events are the GM's taps (turn on, open a chapter, end), and one GM-only room message that lands a chapter on a player's phone once.

# Notes: feature 1, stories the GM runs

Status: design for the lead's review. No code. Written while another helper changes the tree, so nothing was run here.

## 0. What I read, and what the code says today

Read in full: the brief (`brief-1-stories.md`), `.claude/skills/poteto-mode/SKILL.md`, `docs/agent-handoff/START-HERE.md`, `docs/agent-handoff/helper-rules.md` (the system prompt names `/workspace/sg-tools/helper-rules.md`, which does not exist on this machine; START-HERE says those paths now live under `docs/agent-handoff/`), `AGENTS.md` (all of it, the rows and recipes the brief names among them), `features/plan.md`, `features/notes-1-feats.md` (all of it; sections 1, 5, 6, 12 and 17 are the shape copied here), `features/ideas-2-imaginative.md` sections 1 and 7 to 9, `copy-tasks.md`, the skills `statechart`, `principle-model-the-domain`, `principle-foundational-thinking`, `principle-redesign-from-first-principles`, `principle-subtract-before-you-add`, `principle-experience-first`, `principle-make-operations-idempotent`, `show-me-your-work`, `unslop`, and `humanizer` (its sections A and B and the word list). The code, read at a88b73b0: `src/core/hunter/quests.ts`, `grant.ts`, `record.ts`, `counts.ts`, `feats.ts`, `facts.ts`, `chronicle.ts`, `noticed.ts` (its first half), `job-chain.ts` (its head), `quest-rights.ts`, `src/core/rewards.ts`, `award.ts`, `save.ts` (types, limits), `protocol.ts` (payloads, `DEFS`, docs, `DOC_MAX`), `library.ts` and `pack.ts` (their exports), `src/core/registry/bundles.ts` (its head), `src/edge/room-events.ts` (the appliers of `award` and `quest`), `src/views/workshop.js`, `feat-maker.js`, `gm.js` (the board, `sendAward`, `giveFrom`, Issue quest, the section list), `quests.js` (the quest form).

What the code holds that a story will use, and what it lacks:

- **Words in a System window.** `SystemWords` (`rewards.ts`): a title in the System's voice, upper-cased by `parseWords`, and one plain line, bounded 60 and 200. A bundle given by hand opens its window in these words (`landAward`, gm.js `sendAward`).
- **A reward in one step.** `grant(save, hid, rewards, build, day & vitals)` gives XP, points, gold, items, a title (only when new), a job, skills, statuses and boons in one answer, and hands back what a fight holds. XP, gold and points may be negative ("a GM may take away"), so a cost that comes due is a reward with negative numbers or a status. `gmAward` grants this phone's hunters, posts the players' `award` and logs, in one write; `hunter.grantWrite` puts a held hunter's parts on its fight row in that write.
- **A quest from the GM.** `issueQuest(h, draft, id, at)` (quests.ts) on this phone; the room's `quest` message (`QuestOffer`, gmOnly) on a player's phone, landed once by its id and issued `from: 'gm'`, so the player may not edit or delete it (`mayChangeQuest`) and its progress and end are reported to the GM (`reportsProgress`, `questUpdate`). A quest's completion runs `finishQuest`; nothing in it knows of any arc. `QuestOffer.dueAt` is an absolute time: a quest written ahead needs its due time as hours from when it is issued, as the quest form's `dueHours` and gm.js's Issue quest already take.
- **Titles.** `giveTitle` adds a title when it is not held; `removeTitle`, `writeTitle` and `toggleTitle` are the GM's hand edits. No reward can change or replace a title the hunter holds: "a title that grows" has no one-step capability today (1.5).
- **The only chain the game has**, the Job Change chain (job-chain.ts), moves by itself: completing a step's quest opens the next step (`stepCompleted`). A story must not copy that, by the owner's ruling.
- **A count of facts.** `FactCount` and `countStep` (counts.ts) move only on the hunter's own phone, inside `noticed`, from the inbox of facts each write records. The GM's phone holds a player's hunter only as its pushed sheet: the whole lifetime tally, the newest 8 kept facts and none of the kinds that are not kept (kills, rolls, coins, the shop, rests, consumables). This decides section 3.
- **Custom content.** The recipe "A kind of custom content": a parser that defaults a wrong field and refuses only what has no name, a library list with a cap, a pack kind, a maker through `app.api.maker.open`, a Workshop section. `library.ts` has generic steps for id-and-name lists (`LIBRARY_LISTS`: items, skills, maps; `saveEntry`, `removeEntry`, `duplicateEntry`, `copyName`).
- **The GM view** (gm.js) is a stack of collapsible sections (`section(id, title, body, open, hsum)`), in `ORDER`, two or three columns from 1100 px. The Make row holds five buttons, the most a 390 px row takes at 44 px (notes-1-feats 17.9).
- **Feats and stories are separate by ruling.** `feats.ts` says in its header that nothing there issues a quest or moves a story; unit 3 of feats removed the feat's issued quest for this reason. Units 6 to 8 of feats (Give… on the fight card, the Chronicle panel, counted quests and titles with worn statuses) are not built. Nothing below waits on them.

## 1. The data shape

### 1.1 What a chapter may hold, each part against the step that gives it today

| A chapter's part (the brief's list) | The step that does it today | Built here? |
|---|---|---|
| Words for the players | `SystemWords`, shown as a System window (`landAward`'s window, `ui.system`) | Reused as it is |
| A quest issued | `issueQuest` on this phone; the `quest` message's `QuestOffer` on a player's | Reused; the chapter keeps its due time as hours (`dueHours`) and makes the offer's `dueAt` when it opens |
| A reward or a bundle given | `grant` with a `Rewards`; a saved bundle fills the reward editor by value (its bundle select) | Reused as it is |
| A title given | `Rewards.title`, given by `grant` when it is new | Reused as it is |
| A title changed ("a title that grows") | none: a reward only adds a title | New: `RewardTitle.replaces`, unit 5 (1.5) |
| A status | `Rewards.statuses`, through `grant` (on the row while a fight holds the hunter) | Reused as it is |
| A cost that comes due | `Rewards` with negative XP, gold or points, or a status | Reused as it is. Taking an item or a title away is N11 of the ideas file and waits: the chapter's note tells the GM to do it by hand |
| A choice put to the players ("accept or refuse") | the GM at the table | The chapter's note (only the GM reads it), and the GM opens the chapter that follows the answer (2.1). No new capability |
| A ready sign | none that the GM's phone can count exactly (3.1) | Not in the first build. Unit 6, separable, from what the GM's phone holds whole |

Every part but the title change and the ready sign is something the game does in one step now. A chapter is those parts, given in one write, to the hunters the GM picks.

### 1.2 Three shapes for a story as content

| | (a) Chapters that carry their parts by value | (b) Chapters that point at library entries | (c) A chapter as a script of actions |
|---|---|---|---|
| What a chapter is | Words, a `Rewards`, a quest or none, a note for the GM | Words, a bundle id, a quest template id (a new library kind), a note | An ordered list of actions: say, give, title, status, cost, quest, each its own member of a union |
| What it reuses | `SystemWords`, `parseRewards`, the quest form's fields, the reward editor (whose bundle select copies a bundle in) | Bundles as they are | Each action's step, one by one |
| What it adds | One parser, `parseStory` | A quest library (a second new kind), a dangling id when a bundle is deleted, packs that must follow the ids | A small language: give, title, status and cost all repeat what `Rewards` already is, and the maker becomes a list builder |
| An edit of a bundle | Does not reach a story (by value, as every reward is today) | Reaches every story that names it | As (a) |
| A player's phone needs | Only the chapter it is sent | The bundle and the template, by value, anyway | As (a) |

(c) has two ways to give a title (an action and a reward), the design red flag "two ways to do one task". (b) adds a kind and a class of broken links to save one copy. **Picked (a).** A chapter is exactly the steps the brief allows, held as the values those steps read, so `grant` and `issueQuest` take them without a change.

### 1.3 Three shapes for a story on a table

| | (a) A run on the GM's save | (b) On each hunter, as the Job Change chain | (c) Worked out from facts |
|---|---|---|---|
| Where the position lives | `save.stories`, a list of runs, each its story's id, who it is for, the chapter it is at and the chapters it has opened | `hunter.story`, a copy on every hunter in it | The newest `chapter` fact on each hunter |
| A story for the whole table | One record | One copy a hunter, on as many phones as there are players, written only by room messages; two copies can disagree | As many guesses as hunters |
| Who writes it | The GM's tap, on the GM's phone | The GM's phone for its own hunters, the room for the rest | Nobody: it is inferred |
| Survives | Everything the save survives | A player's reset loses its copy | 40 kept facts, 8 of them on the GM's phone |

(c) is the implicit state the owner ruled out ("everything explicit"). (b) splits one table-wide thing across phones that only the room joins, and gives a player's phone a part of the GM's plan. **Picked (a).** A player's phone holds what it was told (the chapter's window, its reward, its quest, a `chapter` fact) and nothing about what comes next.

### 1.4 The types

```ts
// src/core/ids.ts
export type StoryId = Id<'Story'>;          // a library story, 'st' (store.id('st'))
export type StoryRunId = Id<'StoryRun'>;    // a story on the table, 'sr'

// src/core/story/story.ts: a story as content. Pure. Its one reader is `parseStory`.
/** A chapter's quest as the GM writes it ahead: the quest form's fields, with its due time in hours from when the chapter opens. */
export type ChapterQuest = {
  readonly kind: (typeof GM_QUEST_KINDS)[number]; readonly title: string; readonly desc: string;
  readonly objectives: readonly Objective[]; readonly rewards: Rewards; readonly dueHours: number | null; readonly penaltyText: string;
};
export type Chapter = {
  /** Only the GM reads it ("The offer"); blank reads "Chapter 2". */
  readonly name: string;
  /** The window each hunter it opens for sees: its title in the System's voice, one plain line. A chapter needs a title. */
  readonly words: SystemWords;
  /** Given to each hunter it opens for, by `grant`. Empty: nothing. Negative XP, gold or points take away. */
  readonly rewards: Rewards;
  /** Issued to each hunter it opens for, from the GM, or none. Completing it opens nothing. */
  readonly quest: ChapterQuest | null;
  /** Only the GM reads it: what to ask the table, or when the GM thinks the chapter is done. */
  readonly note: string;
};
export type Story = {
  readonly id: StoryId; readonly name: string;
  /** Only the GM reads it: when to turn it on ("When a hunter spares a foe that can speak"). */
  readonly when: string;
  /** Who the turn-on window picks first: the whole table, or hunters the GM chooses. */
  readonly for: 'table' | 'hunters';
  /** 1 to CHAPTERS_MAX, in order. */
  readonly chapters: readonly Chapter[];
};
// on the save: library.stories: Story[]   (LIMITS.libraryStories, a repair line, LIBRARY_LISTS.stories)

// src/core/story/run.ts: a story on the table. Pure. Its machine is `runStep` and its TABLE (section 2).
/** Who a run is for: whoever is at the table when a chapter opens, or the hunters chosen. */
export type Who = { readonly at: 'table' } | { readonly at: 'hunters'; readonly refs: readonly HunterRef[] };
/** A chapter opened: which, for whom, when, in which session. */
export type Opened = { readonly chapter: number; readonly to: readonly HunterRef[]; readonly at: string; readonly session: number };
export type RunState =
  | { readonly at: 'running'; readonly chapter: number }                                   // the chapter last opened, 0-based
  | { readonly at: 'ended'; readonly chapter: number; readonly endedAt: string; readonly session: number };
export type StoryRun = {
  readonly id: StoryRunId; readonly story: StoryId;
  /** The story's name when it was turned on, so a run whose story was deleted still reads. */
  readonly name: string;
  readonly who: Who; readonly state: RunState;
  /** Newest last, at most OPENED_MAX. */
  readonly opened: readonly Opened[];
};
// on the save: stories: StoryRun[]   (a default of [], a repair line: RUNNING_MAX running, ENDED_KEPT ended, newest kept)
```

A run names its story by id and reads it at each open, so an edit in the maker reaches the chapters not yet opened ("rewritten mid-way", ideas section 7). A story with a running run is not deleted (the Workshop says to end it first). A run past a story's last chapter after an edit offers only End.

One more fact kind, by the recipe "A fact the System remembers": `{ kind: 'chapter'; title: string; line: string }` (the window's words, text 60 and 200), kept, no tally row, one writer (`chapterLanded`, 2.3). The player rereads it in the Chronicle panel when feats' unit 7 draws kept facts; a GM's feat could count it.

### 1.5 What a chapter needs that the game cannot do in one step

1. **A title in another's place** ("a title that grows": Unlit, then Ember; Owed to the Deep, then Square; Foretold, then Fulfilled or False Prophecy). Variants: (a) `RewardTitle.replaces?: string`, the name of a held title this one takes the place of: `grant` rewrites that title in place (its id kept, so an active title stays active, the sheet refitted) and records the `title` fact; when the named title is not held, the title is given as new; when the new one is already held, nothing. (b) A chapter field `retitle: { from, to }` outside `Rewards`. (c) None: the chapter gives the new title beside the old and its note tells the GM to remove the old one by hand. (a) is one more reward field by the recipe "A reward field", so a bundle, a quest's reward and a feat can grow a title too, through the one `grant`. (b) is a second way to give a title. **Picked (a), unit 5.** Until it lands, (c) is how a chapter does it.
2. **A ready sign** the GM's phone can show. Section 3, unit 6, separable.
3. Not built, each the GM's by hand and said in the chapter's note: taking an item or a title away (N11), an heir (N16), a different quest for each hunter in one chapter (C12's pieces: one run per hunter, or the quest form), a refusal the System records (N18).

## 2. The machine of a story on the table

### 2.1 The chart, drawn before the table

The `statechart` skill runs TLC, which it installs from the network, and this phase runs nothing; so the chart is drawn by hand with every cell, as notes-1-feats did, and `bun run charts` draws it from the real step in unit 3 (`scripts/charts/story.ts`, walk events in `tests/models/story-events.ts`, an entry in `MACHINES`). The reader is the GM. Every arrow is a tap of the GM's on the GM's phone. No arrow comes from a clock, a count, a fact, a quest's end or a room message.

```
                 the GM turns it on (picks who; opens chapter 1 in the same tap)
   (no run) ----------------------------------------------------------------> Running at chapter 1
                                                                                  |   ^
                                    the GM opens a chapter (the next one, or      |   |
                                    any other, again for some hunters included)   +---+  Running at chapter k
                                                                                  |
                                    the GM ends it                                v
                                                                               Ended at chapter k
                                                                               (nothing leaves it; Turn on makes a new run)
```

Three states (no run, running at a chapter, ended), three events (turn on, open, end). No pause: a running story waits for the GM by its nature, so a pause state would be a second name for "running". No step back (2.5).

A branch ("3a. Fulfilled" or "3b. False") is two chapters; the GM opens the one the table earned and then ends the story, or opens the other later. A chapter opened again (C08's line after each run, C01's collection each session, C12's count rising) is the same event with an earlier or the same chapter. One event covers next, branch, repeat and catch-up, so the machine has no branch graph to keep in sync with the chapters.

### 2.2 The table

```ts
export const RUN_STATES = ['none', 'running', 'ended'] as const;
export type RunEvent =
  /** Turned on for `who`; opens chapter 0 for `to` (who is at the table now, or the hunters chosen). */
  | { readonly type: 'turnOn'; readonly id: StoryRunId; readonly story: Story; readonly who: Who; readonly to: readonly HunterRef[]; readonly at: string; readonly session: number }
  /** Chapter `chapter` opened for `to`. `from`: the chapter the GM's window showed as the last opened, so a stale tap is refused. */
  | { readonly type: 'open'; readonly chapter: number; readonly from: number; readonly to: readonly HunterRef[]; readonly at: string; readonly session: number }
  | { readonly type: 'end'; readonly at: string; readonly session: number };
export type RunRefusal = 'running' | 'ended' | 'moved' | 'no-chapter' | 'nobody' | 'no-story';
/** What the app must do after a step: deliver chapter `chapter` to `to` (2.3). */
export type RunFx = { readonly type: 'deliver'; readonly chapter: number; readonly to: readonly HunterRef[] } | null;
type Cell<E extends RunEvent['type']> = ((run: StoryRun | null, e: Extract<RunEvent, { type: E }>, story: Story | null) => { run: StoryRun; fx: RunFx } | Refused<RunRefusal>) | null;
export const TABLE: { readonly [S in (typeof RUN_STATES)[number]]: { readonly [E in RunEvent['type']]: Cell<E> } };
export function runStep(run: StoryRun | null, e: RunEvent, story: Story | null): { run: StoryRun; fx: RunFx } | Refused<RunRefusal>;
```

| State | turnOn | open | end |
|---|---|---|---|
| none | running at 0, `opened` [chapter 0 for `to`], fx deliver 0. Refused `nobody` when `to` is empty, `no-story` when the story has no chapter | null (refused `no-story`: there is no run) | null |
| running at k | null (refused `running`: this id runs; another run of the same story is a new id) | running at c, `opened` + {c, to}, fx deliver c. Refused `moved` when `from` is not k, `no-chapter` when c is not a chapter of the story as it is now, `nobody` when `to` is empty, `no-story` when the story was deleted. For a run for chosen hunters, a hunter in `to` that is not in `who.refs` joins `who.refs` | ended at k, fx null |
| ended at k | null | null (refused `ended`) | null |

The words of each refusal are `RUN_REFUSAL_WORDS`, keyed by the union (the typecheck asks), section 8.

### 2.3 What each event writes, in one write

One step on the whole save, `storyMove(save, runId, e, ctx)` (run.ts), the shape of `gmAward`: it answers the next save and each local hunter's grant, and the view writes it through `hunter.grantWrite`, so what this phone's fight holds goes on the rows in the same `store.apply`.

- **turnOn** and **open**: `runStep`; the run written into `save.stories` (a new run first, an existing one in place); for `deliver`, each hunter of `to` that this phone holds gets `chapterLanded(save, hid, body, day & vitals)` (below) and each player's hunter is in the `chapter` message posted to the outbox (section 4), split as `sendAward` splits an award when this phone's fight holds a player's hunter (the statuses go on its row, the message carries the rest); one session log line of the new kind `story` ("The wager, chapter 2 (The runs), opened for Brakk."). All of it, or nothing.
- **end**: the run ended in place; one log line ("The wager ended at chapter 3."). Nothing is posted and no hunter changes.

`chapterLanded` (story.ts, one writer of the `chapter` fact) is the one step that gives a chapter to one hunter, on any phone: `grant(rewards)`, then `issueQuest` of the chapter's quest made into a `QuestOffer` (`from: 'gm'`, its `dueAt` from `dueHours` and the open's time), then `record(h, { kind: 'chapter', title, line })`. The GM's phone runs it for its own hunters inside `storyMove`; a player's phone runs it in `APPLIERS.chapter`. The window is `chapterWindow(words, granted lines, quest)` (story.ts): tag "! Story", the chapter's title, its line, the reward's lines, and "Quest: <title>" when it issues one. The GM's open window previews with the same function, so what the GM reads before the tap is what the player will see.

### 2.4 A second tap, a reload between two parts, the same step from two GM phones

By `principle-make-operations-idempotent`: each step reads the run as it is and applies only the difference.

- **A second tap on Open.** The open window closes on the first tap, and the card under it is redrawn from the save, so a second tap meets the card's next button, which now names the chapter after. A tap from a window drawn before the first write still carries `from` = the chapter it showed; the run is now at another, so it is refused `moved` and nothing is written ("This story moved on while the window was open. It is at chapter 3 now."). The guard is the run's own position, a compare and set, so no list of tap ids is kept.
- **A reload between two parts.** There are no two parts. The run, every local hunter's grant, quest and fact, the outbox's posts and the log line are one `store.apply`. The outbox sends each post until the room takes its event id once (`addEvent`), and a player's phone lands the `chapter` message once by that id (`sync.once`, `appliedOnce`); a land whose applier throws is held and tried again (`hold`). A reload after the write and before the send sends from the outbox; nothing is sent twice.
- **The same step from two GM phones.** A run lives on the save of the GM phone that turned it on. A second phone holding the same GM key has no such run, so it cannot open that run's chapters. If both phones turn on the same story, they are two runs and the players get both. Nothing here merges them: gates have a world doc that a second GM phone merges, and stories could get a doc the same way later, but the owner runs one GM phone at a time and moves a campaign by its file (which carries the runs). for-the-owner line and question 4.
- **A player's phone told twice.** Only by two opens, each its own event id and each a deliberate tap. That is the C12 count rising, which is wanted.

### 2.5 Why there is no step back

A step back would have to take back what a chapter gave: a title and its window on a player's phone, an XP level-up and its refill, a quest the player may have started. A reward's undo is not exact (notes-1-feats 7.2 and 17.3 found the same for awards). So the run keeps no step back. The GM may open an earlier chapter again, which moves the run's position there and gives that chapter again to whoever the GM picks; the open window says "They have had this chapter. It is given again." beside each hunter who has. A stray tap on End is held two seconds under Undo (section 5); a stray tap on Open cannot happen without the window that previews it.

## 3. "Ready", without the System acting

### 3.1 Four ways, weighed

The ideas file's signs, read one by one (section 7): sessions since a chapter opened (C01 ch2, C02 ch3b), the chapter's own quest done (C03 ch2, C10 ch4, C12 ch2 and 3, C01 ch3 and 5 near enough), a number on the record that rose (C09's ten dailies, C08's solo runs won and lost, C01's gate of the hunter's rank as "a gate cleared"), a rank reached (C05), and a few that need facts no count holds (C02's "the deed's fact", C07's "no kill for two sessions", C13's "an unusual choice").

| | (a) A `FactCount` counted on each hunter's phone | (b) Worked out on the GM's phone from what it holds whole | (c) The GM's phone counts the facts it sees arrive | (d) No ready rule in the first build |
|---|---|---|---|---|
| How | The open chapter's rule goes to the player's phone, `noticed` counts it as it counts a feat, and a message tells the GM's phone when it is reached | Three signs: the chapter's quest is done (each hunter's copy, found by a back-reference on the quest); N sessions have started since the chapter opened (`world.session` against `Opened.session`); a lifetime number (`Tally`) rose by N since the chapter opened (the run keeps each hunter's number at the open) | The GM's phone watches each pushed sheet's newest 8 facts and counts the new ones into the run | The card shows "Opened in session 12, 3 sessions ago" and the GM's own note ("Ready when a solo run of the hunter's rank is won") |
| Exact? | Yes | Yes for what it can say: a tally is the fold of every fact ever, pushed whole; a quest's status is in the pushed sheet; the session count is the GM's own | No: kills, rolls, coins, the shop, rests and consumables are never kept, a burst of more than 8 kept facts between two pushes is lost, and a GM phone that was closed missed them | Nothing to be wrong |
| What it costs | A rule of the GM's plan on the player's phone, a new state on the hunter, a new message, `noticed` bent to count something that is not a feat | One optional field a chapter, a number a hunter at each open, one optional field on a quest, one pure function | A stored counter fed by watching, which is the implicit state the owner ruled out | Nothing |
| Says "a solo run of the hunter's rank" | Yes | No (soloWon rose by 1, of any rank) | No | The GM's note says it |

(c) is out on both counts. (a) bends the feat machinery and puts the GM's plan where a player can read it, for the precision of filters the GM's own eyes supply at the table. **Picked (d) for the first build (units 1 to 4), and (b) as unit 6, separable and last**, so the lead or the owner can drop it. (b) never needs a count to be stored: the sign is a function of the save and the pushed sheets, worked out when the GM view draws and never written.

`FactCount` does not fit without bending: it moves only in `noticed`, from the inbox of the hunter's own phone, and the GM's phone never sees that inbox. A ready sign on the GM's phone counted from facts would be (c).

Unit 6's types:

```ts
// story.ts
export type Ready =
  | { readonly on: 'quest' }                                     // this chapter's quest is done
  | { readonly on: 'sessions'; readonly n: number }              // n sessions started since the chapter opened
  | { readonly on: 'tally'; readonly key: TallyKey; readonly n: number };   // the number rose by n since the chapter opened
// Chapter gains: readonly ready: Ready | null
// run.ts: Opened gains base?: Readonly<Record<string, number>>   (by ref key: the tally key's value at the open; absent when the sheet was not on the GM's phone)
// save.ts and protocol.ts: Quest and QuestOffer gain story?: { run: StoryRunId; chapter: number }   (a back-reference only, as chainId)
/** For each hunter the open chapter went to: ready, not yet, or unknown (its sheet is not on this phone, or it had no number at the open). Never stored. */
export function readyOf(run: StoryRun, story: Story, hunters: ReadyHunters, session: number): readonly { ref: HunterRef; at: 'ready' | 'not-yet' | 'unknown' }[];
```

### 3.2 What "the table" means when hunters differ

A sign is per hunter: each hunter the open chapter went to is ready, not yet, or unknown. The card lists them ("Ready for Brakk and Mira. Not yet: Eldrin."). The System does not choose between "any" and "all": the GM reads the names and decides, and a setting for it would be a second rule of when to move, which is the GM's alone. The sessions sign is the same for everyone and reads once ("Ready: 3 sessions have started since chapter 2 opened.").

### 3.3 Where the GM sees it

On the run's card in the GM view's Stories section, one line under the chapter, and in the section's head summary ("2 running, 1 ready"). Never on a player's phone: `readyOf` runs only in the GM view, from the GM's save and the players' pushed sheets, and nothing it answers is posted. No toast and no notification in the first build of unit 6: a toast would need a "told" memory and pulls the GM's eye during play; the head summary is seen when the GM looks.

### 3.4 The proof that nothing but the GM's tap moves a story

1. A run lives only on the GM's save (`save.stories`). A player's phone holds no run: the `chapter` applier lands content on a hunter and touches no run.
2. `save.stories` has one writer, `runStep` through `storyMove` (run.ts). A lint, beside the other one-writer rules: "only src/core/story/run.ts writes a story run".
3. `storyMove` is called from one module, `src/views/stories.js`, inside its tap handlers. A lint: "a story moves only from src/views/stories.js": no other file under `src/` names `storyMove` or `runStep` (tests aside). So `noticed`, the store, sync.ts, the room's appliers, the quest steps, the feats, the gates and the one timer (`nextWake`) cannot move one; none of them imports run.ts.
4. Every event of the machine is a tap: turn on, open and end, each from a button in stories.js. The table has no event a clock, a fact, a count, a quest's end or a message could raise.
5. The ready sign is a return value for drawing (`readyOf` answers a list, never a save), so it cannot be a write.
6. `finishQuest` and `completeQuest` know nothing of stories: a chapter's quest completed changes the quest and pays its reward, and the story stays where it was. A test in unit 4: "the player completes the chapter's quest; the GM's card still says chapter 2, and the next chapter opens only on the GM's tap".
7. A test in unit 3, "a running story stays where it is through everything but the GM's tap": a save with a running run goes through the steps that write when no GM taps (the notice step with facts that earn a feat, a quest completed and failed, the daily rollover, a personal gate's tick, a fight's end, and the land of every applier in `APPLIERS` with a valid payload from `VALID` in `tests/protocol.test.ts`), and `save.stories` is the same object after each. The lints of points 2 and 3 hold the rest, since a write that is not listed here still cannot reach run.ts.

## 4. The room

### 4.1 Whose save holds the story

The GM's. The library's stories and the runs are on the GM's save (1.3). A player's phone gets each chapter it is sent, by value, when the GM opens it, and nothing of the chapters after. The same reason the feats notes gave for asking the owner whether hidden feats should sit on players' phones (their question 1) holds harder here: a story's later chapters are the GM's plan, and a player who reads the phone's storage would read them.

### 4.2 What reaches a player's phone, and how

Variants:

1. **The messages that exist**: an `award` with the chapter's words as its bundle's window, a `quest`, and a `system` window for a chapter of words alone. A chapter of words, a reward and a quest is then two or three windows. The `award` records a `given` fact, which the roleplay feats count ("three awards for roleplay given to you in one session" would count a story's chapters), and a chapter of words alone records nothing, because `system` writes nothing.
2. **One new message, `chapter`** (picked): its words, its reward and its quest, landed once by its id through `chapterLanded`, the step the GM's phone runs for its own hunters. One window, one fact of its own kind, nothing counted as an award.
3. **A `stories` doc** the GM's phone publishes, holding the running stories and their chapters, which the players' phones read and land. A doc is the latest state and is read again and again, so landing a reward once would need a told memory per chapter, and the doc would carry the chapters to every player in the room, whoever they are for.

By the recipe "A room message":

```ts
// protocol.ts
/** A chapter of a story the GM opened (story.ts `chapterLanded`): its window's words, its reward, its quest. Landed once by its id. */
export type ChapterPayload = Base & { to: SheetKey[]; words: SystemWords; rewards: Rewards; quest: QuestOffer | null };
// DEFS.chapter: { gmOnly: true, ownSheet: false, read: words by parseWords (refused without a title), rewards by `rewards`,
//   quest by the `quest` message's own reader `questOffer` or null }
// room-events.ts: APPLIERS.chapter = { once: true, land: landChapter }
//   landChapter: for each hunter of `to` this phone holds: chapterLanded with its vitals where the GM's fight holds them
//   (a reward's statuses are then refused with `gmHolds`, as landAward does); tell: one window a hunter (`chapterWindow`).
```

The payload carries no story name, no run id and no chapter number (4.3). Unit 6 adds `quest.story` for the ready sign.

**Its size.** The server refuses a body over `MAX_BODY`, 65,536 bytes. The parts:

- The wrapper and `to`: 24 sheet keys (`ROOM_SHEETS`) of at most 40 characters, quoted, with commas: 1,032; the event's type, id and keys: about 120.
- `words`: a title of 60 and a line of 200, with keys: 290.
- `rewards`: `REWARD_BOUNDS` lets 20 items, 8 skills and 8 statuses each carry a def. notes-1-feats measured 100 feats each with 20 items at 56,579 characters for 8 of them, about 7,000 a reward, and estimated a reward of items with worn statuses past 30,000.
- `quest`: a title of 120, a description of 500, 10 objectives of about 130, a penalty text of 300 and a due time: about 2,300, and its own reward, as large again.

Two worst rewards and the rest come to about 64,000 characters, and a name in a script of three bytes a character triples a text field's bytes. So the chapter is bounded where it is made: `CHAPTER_MAX` = 49,152 bytes (48 KiB) of the payload's JSON in UTF-8, measured by `chapterSize(chapter)` (story.ts, a pure count of UTF-8 bytes, so core touches no browser API), leaving 16 KiB for the wrapper and `to`. The maker blocks Save of a chapter past it ("This chapter is too large to send to players' phones. Give fewer items."), the Workshop marks a story with such a chapter (one that came in a pack), and `storyMove` refuses to open it for a player's hunter (`too-large`, a refusal of unit 4; a local hunter still gets it). A typical chapter (a title with a bonus, a point, a quest of one objective) is about 1,000 bytes. Unit 4's test builds a chapter of exactly `CHAPTER_MAX` with 24 keys in `to`, posts it through the server's handler (`tests/server-rooms.test.ts`) and reads it back whole, and prints it by part as the doc tests do.

### 4.3 What a player sees of a story

Variants: (a) nothing of the story; each chapter's window as it opens, the reward and the quest where they always appear, and a `chapter` fact in the chronicle (its title and line), so the player can reread what the System said; (b) the story's name and the chapters reached, on a Stories line of the sheet; (c) as (b), but only once the GM shows it (a per-story switch).

(b) and (c) need the story's name and position on the player's phone (a doc or more fields on every message), and a GM's name for his own use ("Debt trap") is often a spoiler. The ideas file has the GM write the window's title in the System's voice for the players; that is the part written for them. **Picked (a).** The player sees what the GM wrote for players, when the GM opens it, and nothing until then. for-the-owner line; question 1.

### 4.4 A late joiner, a hunter added or removed, a GM alone

- **Who "the table" is.** For a run `{ at: 'table' }`, the hunters at the table when a chapter opens: this phone's hunters and the players' sheets the GM's phone holds (`pickables`), the same list the Award form offers. A run for chosen hunters names them by `HunterRef`.
- **A player who joins late** gets every chapter opened after the join (a table run picks them up at the next open). To catch them up, the GM opens the current chapter again: the open window preselects only the hunters at the table who have not had that chapter (`whoFor(run, chapter, atTable)`, run.ts, from the run's `opened` list), so a late joiner is the one ticked. Three taps (section 5).
- **A hunter added mid-story.** A table run: as a late joiner. A run for chosen hunters: the open window lists everyone at the table with the run's hunters ticked; ticking another sends it this chapter, and the open adds that hunter to the run (2.2), so later chapters preselect it too.
- **A hunter removed mid-story** (deleted on this phone, or a player who left or was removed from the room): skipped at each open; the window shows the name greyed with "not at the table" for a chosen hunter, and the open's message says who was skipped. The run keeps the ref, so a player who comes back is ticked again.
- **A player offline** at the open: the message waits in the room and lands when the phone polls again, as every message does. The GM's line says "Brakk gets it when the room answers." (`postNews`, the words `sendAward` uses).
- **A GM alone with hunters on one phone.** Every hunter is local: the open is `chapterLanded` for each in the one write, and each shows its window on this phone, one a hunter, queued, as an award to several local hunters does today. The run, the machine and the taps are the same; only the delivery has no message.
- **A GM phone with no room** and players' hunters picked: their part is refused with the award's words ("Brakk needs a room: open one with the room button at the top."), and the local hunters' part is written. Alone at the table there is nobody remote to pick.

## 5. The GM's use at 390 px, counted in taps

### 5.1 Where it lives

Variants: (a) a Stories section in the GM view, beside the Party board; (b) a view of its own in the More menu; (c) on each hunter's card of the board. The GM is in the GM view during play, with the board and Give… there; a view of its own is a navigation away at the moment a chapter is due; a table story belongs to no one hunter's card. **Picked (a)**: a section `stories` in gm.js's `ORDER` right after `party` (in the party column at 1100 and 1500 px), open by default while a story runs, its head summary "2 running" (unit 6 adds ", 1 ready"). Its body is drawn by a new module, `src/views/stories.js` (`app.api.stories`: `paint(box)` for the section, `turnOn(storyId | null)` for the Workshop's row), so gm.js gains a section shell and a call, and the story's view code is in one file the story lints can name. The content lives in the Workshop (section 6). The Make row stays five buttons.

The section, top to bottom:

- "Turn on a story" (a button), or with an empty library "You have no stories yet. Make one in the Workshop." and "New story".
- One card a running run: its name; "For the table", "For Brakk" or "For Brakk and Mira"; "Chapter 2 of 5: The quiet. Opened in session 12, 3 sessions ago."; the GM's note of that chapter, when it has one ("Your note: Ask whether Brakk takes the bet."); "Next: 3. The first ask. THE DEEP ASKS FOR A GATE. Gives a quest."; then a row of two buttons, "Open chapter 3" (`.primary`) and "⋯" (`.icon-btn`, "More for The deep keeps accounts"). When every chapter has been opened the next line reads "All 5 chapters are open." and the row's primary button is "End story".
- "⋯" opens a list window (`ui.system` with `layout: 'list'`, as the Workshop's "⋯"): "Open a chapter…", "End story", "Cancel".
- Folded at the end: "Ended (3)", each a line ("The wager · for Brakk · ended at chapter 3 in session 14").

The open window (stories.js, through the window stack as the give shelf is): tag "Stories", title "Open chapter 3"; "What the players see": the window as the player will see it, drawn from `chapterWindow` (its tag, title, line, the reward's lines, "Quest: …"); "Your note"; "Chapter": a `.seg` row of the story's chapter numbers when there are 8 or fewer, else a select, preset to the next chapter (or the current one when every chapter is open), each opened one marked; "Who": a chip a hunter at the table, preset by `whoFor`, a hunter who has had that chapter marked "has it", a chosen hunter who is away shown greyed "not at the table"; `.dlg-actions`: Cancel left, "Open chapter 3" right (its number follows the choice). The window is a column whose head and actions stay put while the middle scrolls, as the shelf's (notes-1-feats 17.3, point 5).

The turn-on window: tag "Stories", title "Turn on a story"; the library's stories as rows (name; "5 chapters · for one hunter"; the story's "when" line). A tap on a row turns the window to "Turn on The wager": "Who" (a `.seg` of "The table" and "Chosen hunters", preset from the story's `for`, then the hunters' chips when chosen), "Already running for Brakk." when it is, the first chapter's preview as in the open window, and the action "Turn on and open chapter 1".

### 5.2 The counts

The GM view is open and the Stories section is open (one tap more when the GM has folded it). Typing is not counted; scrolling is not a tap.

| Task | Taps | The taps |
|---|---|---|
| Turn a story on for the table | 3 | Turn on a story; the story's row; Turn on and open chapter 1 |
| Turn a story on for one hunter | 4 | Turn on a story; the story's row; the hunter's chip (which switches Who to Chosen hunters); Turn on and open chapter 1. 3 when the story is written "for one hunter" and one hunter is at the table |
| Turn on from the Workshop | 2 or 3 | Turn on… on the story's row; (the hunter's chip); Turn on and open chapter 1 |
| Advance a chapter | 2 | Open chapter 3 on the card; Open chapter 3 in the window |
| See what the next chapter will do | 0 or 1 | 0: the card's next line names it, its window title and what it gives ("Gives a quest."). 1: Open chapter 3 shows the whole of it as the player will see it, with the note; Cancel leaves without writing |
| End a story | 2, or 1 | ⋯; End story. When every chapter is open, End story is the card's button: 1. Either way the end is held two seconds under Undo (`ui.toast`'s `hold`, the recipe "A write a stray tap should be able to stop") and written when the toast ends |
| Open a branch or an earlier chapter | 3 | Open chapter 3 on the card; the other chapter's number; Open. From "⋯" it is 4 (⋯, Open a chapter…, the number, Open), the way when every chapter is open and the card's button is End story |
| Catch up a late joiner | 3 | Open chapter 3 on the card; the current chapter's number (only the hunters who have not had it stay ticked); Open chapter 2. 4 when every chapter is open (through "⋯") |

The open's confirmation is its window, which shows what will be sent and to whom; it is not held under Undo, since a window that previews the whole of it is already the second look. End sends nothing to anyone and keeps the run in Ended, so the held toast is enough and asks for no third tap. Weighed for End: a confirm (3 taps mid-story), the held toast (picked), nothing (a stray tap loses the position).

The section, the windows and the Workshop's row are a step each in `scripts/ui-shots.ts` and a case each in `tests/e2e/look.e2e.ts` at 360 and 390 px (every control 44 px, no sideways scroll of the page or a window, the open window's actions on screen with the list scrolled to its end).

## 6. The maker

### 6.1 By the recipe "A kind of custom content"

- **Parser**: `parseStory(v)` (story.ts). A wrong field takes its default; a number past its bound is cut; text is cut to its bound. A chapter without a window title is dropped; a story with no name, or with no chapter left, is refused (null). The chapter's reward through `parseRewards`, its words through `parseWords`, its quest through `parseChapterQuest` (story.ts: the kind among `GM_QUEST_KINDS`, objectives through `cleanObjectives`, the reward through `parseRewards`, `dueHours` 1 to 720 or null, the quest refused without a title). Run at load (the library's repair), by the maker and by a pack.
- **Library list**: `library.stories: Story[]`, an id-and-name list, so it joins `LIBRARY_LISTS` and takes `saveEntry` (a name another story holds is refused, `taken`), `duplicateEntry` and `copyName` as they are; `removeStory(save, id)` is a step on the whole save, since it refuses a story a running run names (`running`). Cap `LIMITS.libraryStories`.
- **Pack**: `stories` in `PACK_KINDS`, `Pack`, `PACK_CAP`, `packOf` (with the library statuses its chapters' rewards and quests name, as a feat's reward does), `parsePack` through `parseStory`, `mergePack` as the other lists (Add: a numbered copy; Replace: the same name). A case in `tests/pack.test.ts`.
- **Maker**: `storyMaker(app, story | null)` in a new `src/views/story-maker.js`, through `app.api.maker.open`. Copied from `feat-maker.js` in its shape: `raw()` reads the form, Save runs `parseStory` and writes what it gives back, the preview is core's words.
- **Workshop**: a Stories section (New story, a row a story: its name, "running" as the row's tag while it runs, "5 chapters · for one hunter" as its meta; a tap edits; Turn on… beside it, as a bundle's Award…; Duplicate, Share and Delete behind "⋯"), and the examples' fold (section 7).

### 6.2 The form

Top: Name; "When to turn it on (only you see this)"; "For" (a `.seg`: The table, Chosen hunters). Then "Chapters": one line a chapter ("1. The offer · THE DEEP HAS NOTICED YOU") with one chapter open at a time under its line. The open chapter: "Chapter name (only you see this)", "Window title", "What the players read", "Note for you (only you see this)" with its hint "What to ask the table, or when you think this chapter is done.", "Reward" (the reward editor), "Issues a quest" (a box that, ticked, draws the quest's fields), and its row of Move up, Move down, Remove. Under the list, "Add a chapter" (up to `CHAPTERS_MAX`). Opening another chapter's line reads the open chapter's fields into the form's list of chapters (held as data) and draws the other's, so a story of 16 chapters has one reward editor in the page. The part below the first chapter is `data-later`, so the window opens in the tap's frame.

The preview, from core (`storyLines(story, R)`): a line a chapter, "Chapter 1, The offer: THE DEEP HAS NOTICED YOU. Title: Owed to the Deep." and "Quest: …" when it issues one. Under a chapter past `CHAPTER_MAX`, the maker's error, and Save is blocked.

### 6.3 Reused, not built again

- **The reward editor**, `app.api.maker.rewards(box, { initial, bundles: true })`, as the Award form, the quest form, the bundle maker and the feat maker use it. Its bundle select copies a saved bundle into the chapter by value, which is how "a bundle given" is written.
- **The quest form's fields.** quests.js draws its form inline (`openForm`, `addObjRow`, `submitForm`: kind, title, description, objectives with targets, the reward editor, hours to complete, penalty text). Unit 2 moves the fields into one builder, `app.api.quests.fields(box, { initial, role })`, answering `{ value(), blocked() }` (the draft as `parseChapterQuest` and `questOf` read it). The Quests view's form and the story maker both call it. gm.js's Issue quest section is a third, smaller form of the same fields (XP, gold and points only, one objective); it moves onto the builder in the same unit, which deletes its own fields and gives it the full reward. If the lead keeps gm.js's form as it is, the unit says so and why.
- **The maker shell** (`app.api.maker.open`, `chips` for each `.seg`, `data-later`, `shell.changed`, `shell.error`), as the feat maker uses it.
- **The Workshop row** (`rowHtml`, `ACTS`, the "⋯" list), with one inline action, `turnOn: 'Turn on…'`, as `give` and `award` are.
- Nothing from the feat maker's test rows: a chapter counts nothing (section 3).

### 6.4 The shortest story a GM with no time writes

A name and one chapter's window title. New story opens with chapter 1 open and the cursor in Name: type the name, tap Window title, type it, Save. A story of one chapter, turned on, is a System window the GM sends when he chooses (the ideas file 8.1 says the same). Everything else may be empty: a chapter with no reward and no quest is words.

## 7. What ships built in

the owner tabled the intro story and will write it himself, so no story is written here. Weighed:

1. **None.** The Workshop's Stories section opens empty with its one line of what a story is. A GM meets the maker's fields with no example of a filled one.
2. **One or two short ones from `ideas-2-imaginative.md` section 7, as examples to copy** (picked), the pattern of the kits' examples and the roleplay awards: listed in the Workshop under "Stories to copy (2)", each with Duplicate, which puts an editable copy in the library. A run always names a library story, so an example is never turned on as it is.
3. **All thirteen.** Five of them need a capability no unit builds (the heir, N16; a refusal the System records, N18; a quest that differs for each hunter in one chapter) and would ship half-working.

The two: **C08 The wager** and **C04 What was spared returns**. Both are for one hunter, short (four and five chapters), and run whole on today's game, so they run the day the machine lands (unit 3); between them they show a chapter of words alone, a chapter opened again (C08's stake taken after each lost run), a cost that comes due (the stake, -1 ability point), a branch (C08's 3a and 3b, C04's 4a and 4b), a quest (C04's "find it"), a boon (C04's A Monster's Favor) and a title (C08's Beat the House, C04's The Spared One's Shadow). They are taken as the ideas file writes them, with one change of form that every story with a choice needs: "Asks: take the bet or refuse" becomes the chapter's note for the GM, and the answer is the chapter the GM opens next (or End). Their words then go through the plain pass with a second reader (`copy-tasks.md`): the window titles are names in the System's voice and stay; each line that describes is made plain where it is not.

`src/core/registry/stories.ts`, `EXAMPLE_STORIES` (each a key, a story without its id, and a comment with its C number), read by `tests/story.test.ts`: each comes back whole through `parseStory`, each chapter is under `CHAPTER_MAX`, and no line has an em dash, a semicolon or an exclamation mark (the check `tests/first-run.test.ts` makes of its lines).

Which chapters of the thirteen today's game can run, and with what:

| Story | Runs today | Waits for |
|---|---|---|
| C01 The deep keeps accounts | All but one: the offer and its answer, the title Owed to the Deep (str +4, pre -2), the quiet, the first ask (a quest ticked by hand), the clause, the collection (a chapter opened again each session with -1 ability point and its quest) | Unit 5 for "Square" in the place of Owed to the Deep; before it, the chapter gives Square and its note says to remove the old title |
| C02 The foretold | The naming (title and quest), the waiting | Unit 5 for Fulfilled or False Prophecy in Foretold's place |
| C03 Carry the name | The empty place (Witness to the hunters the GM picks), the last gate (a quest each; "every hunter may count toward it" is one count a hunter), the letter | N16 for the heir's inheritance |
| C04 What was spared returns | All five | Nothing |
| C05 The second name | Unweighed, the name | Unit 5 for the title growing a stat each chapter (the GM picks the stat); N18 for the refusal kept as a fact |
| C06 Seven doors | All nine, with the gates placed by the GM by hand and each door's quest ticked by hand | Nothing; feats' counted quests (feats unit 8) would count some doors |
| C07 The one behind you | All four, the rival played by the GM | Nothing |
| C08 The wager | All of it | Nothing |
| C09 The quiet year | Unlit, the kept room (the GM's gate by hand, Naming Rights as a boon) | Unit 5 for Ember, Brand and Beacon in Unlit's place |
| C10 The heir | The naming (In Their Place), done | N16 for the objects and the quests passed on |
| C11 The mirror gate | All of it with the gate made by hand; 3a's drawback title taken off by hand | N11 for 3a to take the title itself |
| C12 The unfinished map | The pieces fit (opened again as each piece is done), the gate | A different quest for each hunter in chapter 1: one run per hunter, or the quest form |
| C13 The System grows curious | All the questions, the test, filed | A player's answer kept as a fact (no capability names it) |

## 8. Words

Every label, hint and window body below is plain and literal (`copy-tasks.md`, Plain first). Names may be names: a story's, a chapter's and a window title written by the GM or an example. The glossary's words are used: GM, hunter, room, quest, reward, bundle, status. "Story" and "chapter" are new words for the glossary (`copy-tasks.md` gains their row in unit 2: "A GM's arc over several sessions: story (a chapter, open a chapter); not arc, campaign, saga").

Each is read by humanizer and unslop by the unit that adds it, then by a second reader, before its commit.

| Where | Words |
|---|---|
| GM view, the section | "Stories"; head summary "2 running" (unit 6: "2 running, 1 ready") |
| The section, empty library | "You have no stories yet. Make one in the Workshop." and the button "New story" |
| The section, nothing running | "No story is running." and the button "Turn on a story" |
| A run's card | "For the table" / "For Brakk" / "For Brakk and Mira"; "Chapter 2 of 5: The quiet. Opened in session 12, 3 sessions ago." (session 0 or the same session: "Opened this session."); "Your note: …"; "Next: 3. The first ask. THE DEEP ASKS FOR A GATE." then what it gives: "Gives a reward.", "Gives a quest.", "Gives a reward and a quest.", "Shows a window only."; "All 5 chapters are open."; buttons "Open chapter 3", "End story", "⋯" (aria "More for The wager") |
| The card, a story deleted from the Workshop | "This story is no longer in your Workshop. You can end it." |
| "⋯" list | "Open a chapter…", "End story", "Cancel" |
| Ended fold | "Ended (3)"; a line "The wager · for Brakk · ended at chapter 3 in session 14" |
| End's toast | tag "Stories", "Ended The wager." with "Undo" |
| The open window | tag "Stories"; title "Open chapter 3"; "What the players see"; "Your note"; "Chapter"; "Who"; a chip's marks "has it" and "not at the table"; the line beside a hunter who has it "They have had this chapter. It is given again."; buttons "Cancel", "Open chapter 3" |
| The turn-on window | tag "Stories"; title "Turn on a story", then "Turn on The wager"; a row's meta "5 chapters · for one hunter" / "for the table"; "Who" with "The table" and "Chosen hunters"; "Already running for Brakk."; button "Turn on and open chapter 1" |
| After an open (under the card) | "Opened chapter 3 for Brakk and Mira."; "Brakk gets it when the room answers."; "Brakk needs a room: open one with the room button at the top."; "Skipped Eldrin: not at the table." |
| Refusals (`RUN_REFUSAL_WORDS`) | moved: "This story moved on while the window was open. It is at chapter 3 now."; no-chapter: "This story has no chapter 6 now. It was changed in the Workshop."; nobody: "Pick at least one hunter."; ended: "This story has ended."; no-story: "This story is no longer in your Workshop. You can end it."; too-large: "Chapter 3 is too large to send to players' phones. Give it fewer items in the Workshop." |
| The session log (kind `story`) | "The wager, chapter 2 (The runs), opened for Brakk."; "The wager turned on for the table."; "The wager ended at chapter 3." |
| The player's window | tag "! Story"; title: the chapter's window title; body: its line; lines: the reward's lines (`grantLines`), then "Quest: Find it" |
| Workshop, the section | "Stories"; "A story is a set of chapters that you open one at a time over several sessions. A chapter can show the players a window, give a reward and issue a quest. Nothing in a story happens until you open its chapter."; "New story"; a row's tag "running"; its meta "5 chapters · for one hunter"; inline "Turn on…"; "Stories to copy (2)" |
| Workshop, delete | "Delete The wager?" / "Chapters already opened stay with the hunters."; a running story: "End The wager in the GM view before you delete it." |
| The maker | tag "Workshop"; title "New story" / "Edit The wager"; "Save story"; "Name"; "When to turn it on (only you see this)"; "For" with "The table" and "Chosen hunters"; "Chapters"; a chapter's line "1. The offer · THE DEEP HAS NOTICED YOU"; "Chapter name (only you see this)"; "Window title"; "What the players read"; "Note for you (only you see this)" with "What to ask the table, or when you think this chapter is done."; "Reward"; "Issues a quest"; "Move up", "Move down", "Remove"; "Add a chapter" |
| The maker's errors | "Name the story."; "Give chapter 2 a window title."; "This chapter is too large to send to players' phones. Give fewer items."; "A story has at most 16 chapters."; "You have 30 stories, the most the Workshop holds."; "Another story is named The wager." |
| The maker's preview (`storyLines`) | "Chapter 1, The offer: THE DEEP HAS NOTICED YOU. Title: Owed to the Deep." and "Quest: …" |
| A player's chronicle (feats unit 7's `factLine`) | "A story window: THE DEEP IS PATIENT. Nothing is asked." (the title, then the line) |
| Unit 6, the card | "Ready for Brakk and Mira. Not yet: Eldrin."; "Ready: 3 sessions have started since chapter 2 opened."; "Not known for Eldrin: the GM's phone does not have its sheet."; the maker's "Show me when it may be ready": "Never", "When its quest is done", "After some sessions", "When a number on the hunter's record goes up" |
| Unit 5, the reward editor's title row | "In place of" (a title's name, optional) with the hint "The hunter's title of this name becomes this one. Leave it empty to give a new title." |

## 9. The cut into units, the guide's rows, the chart, and the owner's part

Each unit is whole with its tests and leaves the app working; each closes with its AGENTS.md rows, `bun run deps -- --write`, and `bun run charts` where a machine changed. The order lets a GM alone use stories after unit 3 and a room after unit 4; units 5 and 6 are separate and either may be dropped.

### Unit 1: a story as content

- Files: new `src/core/story/story.ts` (`Story`, `Chapter`, `ChapterQuest`, `parseStory`, `parseChapterQuest`, `STORY_BOUNDS`, `CHAPTERS_MAX`, `CHAPTER_MAX`, `chapterSize`, `chapterWindow`, `storyLines`), `src/core/ids.ts` (`StoryId`, `StoryRunId` with their prefixes in `SaveIds`), `save.ts` (`library.stories`, `LIMITS.libraryStories`, a repair line), `library.ts` (`LIBRARY_LISTS.stories`, `removeStory`), `pack.ts` (the `stories` kind).
- Tests: `tests/story.test.ts` (each field's default and bound; a chapter without a window title dropped; a story with no name or no chapter refused; `chapterSize` of a chapter of known bytes, an emoji and a three-byte script among them; `chapterWindow`'s lines from the rule), `tests/save.test.ts`, `tests/library.test.ts` (a story a running run names is not deleted: the step takes the save), `tests/pack.test.ts` ("stories in a pack", Add and Replace).
- Measures, before it lands: the repair's cost a write with the library at its cap of typical stories (8 chapters of about 1,000 bytes: 30 x 8 x 1 KB, about 240 KB), a bun script as notes-1-feats 17.2's. Written before it runs: if a write's repair grows by more than 2 ms on this box, `LIMITS.libraryStories` and `CHAPTERS_MAX` come down and the notes say to what.
- Deletes: nothing.

### Unit 2: the maker, the Workshop's Stories, the examples, one quest form

- Files: new `src/views/story-maker.js`, `src/views/workshop.js` (Stories, its fold of examples), new `src/core/registry/stories.ts` (`EXAMPLE_STORIES`: C08 and C04 after the plain pass), `src/views/quests.js` (its form's fields moved into `app.api.quests.fields`), `src/views/gm.js` (Issue quest on the same builder), `src/core/api.ts` (the builder's type), `scripts/ui-shots.ts` (the Workshop's Stories, the maker with a chapter open), `copy-tasks.md` (story and chapter in the glossary).
- Tests: `tests/story.test.ts` (each example reads back whole, under `CHAPTER_MAX`, in plain punctuation), `tests/e2e/makers.e2e.ts` ("a GM makes a story of two chapters in the Workshop, the second with a quest, and edits the first"; "the shortest story is a name and a window title"), `tests/e2e/look.e2e.ts` at 360 and 390 (the maker with four chapters scrolls only up and down; the open chapter's controls are 44 px), the existing quest cases of `tests/e2e/gates-quests-dailies.e2e.ts` and `tests/e2e/reward-room.e2e.ts` pass unchanged on the moved form.
- Deletes: gm.js's own Issue quest fields (one quest form, three callers).

### Unit 3: the machine, and a chapter opened for this phone's hunters

- Files: new `src/core/story/run.ts` (`StoryRun`, `Who`, `Opened`, `RunEvent`, `TABLE`, `runStep`, `storyMove`, `whoFor`, `RUN_REFUSAL_WORDS`), `story.ts` (`chapterLanded`), `facts.ts` (the `chapter` fact, `KEPT`), `save.ts` (`stories`, its repair: `RUNNING_MAX`, `ENDED_KEPT`, `OPENED_MAX`; `LOG_KINDS` gains `story`), new `src/views/stories.js` (`app.api.stories`: the section, the turn-on window, the open window, End's held toast) in `MODULES`, `gm.js` (the section shell in `ORDER`, `PLAN2`, `PLAN3`, its head summary), `workshop.js` (Turn on…), `scripts/charts/story.ts`, `tests/models/story-events.ts`, `MACHINES`, `scripts/ui-shots.ts` (the section, both windows).
- In this unit Who offers this phone's hunters only; players' hunters arrive with unit 4.
- Tests: `tests/run.test.ts` (every cell of the table; `moved` for a stale `from`; `whoFor` for a late joiner and a removed hunter; a hunter added to a chosen run; "a running story stays where it is through everything but the GM's tap", 3.4 point 7), `tests/story.test.ts` (`chapterLanded`: the reward, the quest with its due time from its hours, the fact, in one step; a hunter a fight holds gets its statuses handed back), `tests/chronicle.test.ts` (the `chapter` fact's writer), `tests/lint.test.ts` (the two rules of 3.4), `tests/statecharts.test.ts`, `tests/e2e/stories.e2e.ts` ("a GM alone turns on The wager for one hunter and sees its first window; opens chapter 2 twice, and the hunter loses a point each time; ends it, undoes the end, ends it again"; "a second tap from a window left open is refused and the story stays at its chapter").
- Deletes: nothing.

### Unit 4: the room

- Files: `protocol.ts` (`ChapterPayload`, `DEFS.chapter`), `room-events.ts` (`APPLIERS.chapter`, `landChapter`), `run.ts` (`storyMove` posts the message; `too-large`), `stories.js` (players' hunters in Who; the open's message lines), `tests/models/room-world.ts` (the GM's open as a move).
- Tests: `tests/protocol.test.ts` (the payload in `VALID`, a case per bound, the worst chapter by part), `tests/server-rooms.test.ts` ("a player cannot post a chapter"; a chapter at `CHAPTER_MAX` with 24 keys is taken), `tests/applied.test.ts` ("a chapter the GM opened lands whole, once": the reward, the quest from the GM, the fact; a replay writes nothing), `tests/e2e/stories-room.e2e.ts` ("the GM opens chapter 1 for a player's hunter; the player sees the window once, the quest is in Quests and cannot be deleted, the reward is on the sheet"; "the player completes the chapter's quest and the GM's card still says chapter 1"; "a player who joins after chapter 1 gets chapter 2, then chapter 1 when the GM catches them up, ticked alone").
- Deletes: nothing.

### Unit 5: a title in another's place

- Files: `rewards.ts` (`RewardTitle.replaces`, its reader and bound, `rewardLines` and `grantLines`: "Title: Square (in place of Owed to the Deep)"), `record.ts` (`giveTitle` takes the place of the named title, its id and active state kept, its `title` fact), `grant.ts` (through `giveTitle` as today), `reward-editor.js` (the title row's "In place of").
- Tests: `tests/rewards.test.ts`, `tests/record.test.ts` (a title given in place of the active one keeps its id and stays active; a named title the hunter does not hold gives the new one beside the rest; a new title already held gives nothing), a browser step in `tests/e2e/rewards.e2e.ts`.
- Deletes: nothing. It is a reward field, so bundles, quests and feats can use it too.

### Unit 6: the ready sign (separable)

- Files: `story.ts` (`Ready`, `Chapter.ready`, its reader), `run.ts` (`Opened.base` at each open; `readyOf`), `save.ts` and `protocol.ts` (`Quest.story` and `QuestOffer.story`, a back-reference), `room-events.ts` (the land keeps it), `quests.ts` (`issueQuest` keeps it), `stories.js` (the card's line, the head summary), `story-maker.js` (Show me when it may be ready).
- Tests: `tests/run.test.ts` (each sign from the rule: a quest done on one hunter of two; three sessions; a tally that rose; unknown without a sheet; `readyOf` answers no save), `tests/e2e/stories-room.e2e.ts` (the line turns to ready when the player completes the chapter's quest, and the story does not move).
- Deletes: nothing.

What the units simplify: one quest form (unit 2); one step that gives a chapter to a hunter on any phone (`chapterLanded`, units 3 and 4). What they do not touch, with reasons: the Job Change chain keeps moving itself (it is the game's, not the GM's, and the owner's ruling is about stories); feats stay automatic (the owner's ruling); the `system` broadcast stays the GM's free-form window.

### The rows for AGENTS.md

| Question | The one place | Test to copy |
|---|---|---|
| A story as content: its chapters and what a chapter may hold (a window's words, a reward, a quest written ahead with its hours, a note for the GM), its bounds and size against the room's body, its words; the examples to copy | `src/core/story/story.ts` (`Story`, `Chapter`, `ChapterQuest`, `parseStory`, `CHAPTER_MAX`, `chapterSize`, `chapterWindow`, `storyLines`); `library.stories` (`LIMITS.libraryStories`, `LIBRARY_LISTS`, `removeStory`); `EXAMPLE_STORIES` (`src/core/registry/stories.ts`); the maker `storyMaker` (`src/views/story-maker.js`), opened from the Workshop's Stories; a pack's `stories` | `tests/story.test.ts`, `tests/pack.test.ts`, the story case of `tests/e2e/makers.e2e.ts` |
| A story on the table: turned on, a chapter opened (the next, another, again, for some hunters), ended; who it is for and who has had a chapter; the one write of an open; only the GM's tap moves it | the machine in `src/core/story/run.ts` (`StoryRun`, `Who`, `RunEvent`, `TABLE`, `runStep`, `storyMove`, `whoFor`, `RUN_REFUSAL_WORDS`), the save's `stories`; `chapterLanded` (story.ts), the one writer of the `chapter` fact; the GM view's Stories section, its turn-on and open windows and End's held toast, `src/views/stories.js` (`app.api.stories`); the lints "only src/core/story/run.ts writes a story run" and "a story moves only from src/views/stories.js" | `tests/run.test.ts`, `tests/e2e/stories.e2e.ts` |
| A chapter on a player's phone | the `chapter` message (`ChapterPayload`, `DEFS.chapter`, gmOnly), `APPLIERS.chapter` (`landChapter`, room-events.ts) through `chapterLanded`; its window `chapterWindow` | `tests/applied.test.ts`, `tests/protocol.test.ts`, `tests/server-rooms.test.ts`, `tests/e2e/stories-room.e2e.ts` |
| A title in another's place (unit 5) | `RewardTitle.replaces` (`rewards.ts`), `giveTitle` (`record.ts`) | `tests/rewards.test.ts`, `tests/record.test.ts` |
| A chapter's ready sign, shown to the GM and never acted on (unit 6) | `Ready`, `readyOf` (run.ts), `Opened.base`, `Quest.story` | `tests/run.test.ts` |

A recipe, "A part of a chapter": a field of `Chapter` and its reader in `parseStory` (a wrong value takes its default), its words in `chapterWindow` and `storyLines`, what it gives in `chapterLanded` (the one step, on every phone), its field in `ChapterPayload` and `DEFS.chapter`'s reader with the size arithmetic above `CHAPTER_MAX`, its control in `story-maker.js`, a case in `tests/story.test.ts` and in `tests/applied.test.ts`. A part that is not one step the game already does is a capability of its own first (as unit 5 is).

The machines' list gains "a story on the table (`story/run.ts`)"; the Rules lint list gains the two rules above.

### The chart

Section 2.1 drawn by hand; unit 3's `scripts/charts/story.ts` draws it from `runStep` with the walk's events (turn on for the table and for one hunter, open the next, open an earlier one, open with nobody, a stale open, end, an open after the end), into `docs/state-machines.md`. Its states: no run, running at a chapter, ended. Its arrows: "the GM turns it on", "the GM opens a chapter", "the GM ends it". Refused steps stay in their state and are not drawn.

### For `for-the-owner.md` (each written by the unit that lands it)

- Turning a story on opens its first chapter in the same tap. He would say "turn on first, open later" to have a story wait at chapter 0 until he opens it.
- A story never moves by itself: a chapter's quest completed opens nothing, and no clock or count moves it. Only his tap does.
- There is no step back: what a chapter gave stays given. He can open an earlier chapter again, which gives it again to whoever he picks.
- Players see each chapter's window when he opens it, and nothing of the story's name or what comes next. He would say "show the players the story's name" to have it on their sheets.
- A story runs on the GM phone or PC that turned it on. Another GM device in the same room does not see it. He would say "share stories between my devices" to have a doc that carries them.
- The two stories to copy are The wager and What was spared returns from the ideas list. He would say "none" or name others.
- A chapter gives every hunter it opens for the same thing. A different quest for each hunter (the unfinished map) is one story run for each hunter, or the quest form.
- Ending a story is held two seconds under Undo, with no confirm.
- (Unit 6) The ready line shows him, per hunter, when a chapter's quest is done, when some sessions have passed, or when a number on the hunter's record went up. It never moves the story and never tells the players.

### Questions only he can answer, with the default taken meanwhile

1. Should players see a story's name, and how far it has got, on their phones? Default: no. They see each chapter's window and keep it in their record.
2. Do you want the ready line at all (unit 6)? Default: it is built last and can be dropped.
3. Ship The wager and What was spared returns as stories to copy? Default: yes, with their words made plain.
4. Will you run the GM side from two devices at once (a phone and the PC)? Default: no, a story runs on the device that turned it on, and the campaign file carries it to another.

## 10. Decision trail, and the principles read

### 10.1 Decision trail (`show-me-your-work`, kept here as the feats notes keep theirs, since this phase writes one file)

| # | Decision | Why | Evidence |
|---|---|---|---|
| 1 | A chapter holds only parts the game gives in one step: words, a `Rewards`, a quest written ahead, a note | The brief's rule; each part then needs no new giving code | 1.1; `grant.ts`, `quests.ts` `issueQuest`, `rewards.ts` `SystemWords` |
| 2 | Chapters carry their parts by value | References add a kind (a quest library) and broken links; a script repeats `Rewards` | 1.2 |
| 3 | A run lives on the GM's save only | One record a table; nothing of the GM's plan on a player's phone; explicit | 1.3, 4.1 |
| 4 | A chapter's quest keeps hours, and the open makes its due time | `QuestOffer.dueAt` is a time; a quest written ahead cannot know it | `protocol.ts` `QuestOffer`, quests.js `dueHours` |
| 5 | A title in another's place is a reward field, unit 5 | One `grant` for every title; usable by bundles, quests, feats | 1.5 |
| 6 | Three events (turn on, open, end); no pause, no step back | A story waits by nature; a reward's undo is not exact | 2.1, 2.5 |
| 7 | One "open" event covers next, branch, repeat and catch-up | No branch graph to keep in sync with chapters | 2.1 |
| 8 | Turning on opens chapter 1 in the same tap | The moment to start is the moment to show the first window; a waiting state would be a fourth state for one use | 2.1; for-the-owner |
| 9 | A stale open is refused by the run's position (`from`), not a list of tap ids | Compare and set on the state itself converges; nothing to keep or expire | 2.4 |
| 10 | Two GM phones do not share runs | Each save is its own; the owner runs one GM device; a doc can come later | 2.4; question 4 |
| 11 | No ready rule in units 1 to 4; unit 6 adds signs worked out from what the GM's phone holds whole (quest done, sessions, a tally that rose) | `FactCount` moves only in the hunter's own `noticed`; counting pushed facts is lossy and implicit | 3.1, `counts.ts`, `chronicle.ts` `pushedChronicle` |
| 12 | A sign is per hunter; the System never picks "any" or "all" | Choosing is the GM's; a setting would be a rule of when to move | 3.2 |
| 13 | Two lints: one writer of a run, one caller of its step | The proof that only the GM's tap moves a story is then held by tests | 3.4 |
| 14 | A new GM-only message, `chapter`, landed once through the same step as on the GM's phone | The award would count as a roleplay award (`given`), and words alone would record nothing | 4.2; `room-events.ts` `landAward` |
| 15 | `CHAPTER_MAX` 48 KiB of UTF-8, checked where a chapter is made and at the open | Two worst rewards pass the server's 64 KiB body | 4.2; `server.ts` `MAX_BODY` |
| 16 | Players see each chapter's window and nothing of the story's name | The GM's name is his; the window is what he wrote for them | 4.3; question 1 |
| 17 | The Stories section in the GM view, drawn by its own module | The GM is there during play; one file for the lints to name | 5.1 |
| 18 | The open's window is its confirmation; End is held under Undo | Each write is looked at once before it is made, with the fewest taps | 5.2 |
| 19 | One quest form, moved into a builder for three callers | The maker needs it, and gm.js's Issue quest was a smaller copy | 6.3 |
| 20 | Two examples to copy, C08 and C04 | Both run whole today and show every part; the owner writes the rest | 7 |
| 21 | Units: content, maker, machine (alone), room, title in place, ready | A GM alone has stories after unit 3; 5 and 6 can be dropped | 9 |

### 10.2 Principles read, and the choice each changed

- `principle-model-the-domain`: a story on the table is a machine with a `TABLE` (no run, running at a chapter, ended) instead of flags; who it is for is a union (`Who`); a refusal is a union with its words keyed by it; one `open` event replaced the four I first listed (next, branch, repeat, catch up).
- `principle-foundational-thinking`: the data shapes come first (sections 1 and 2) and unit 1 is content alone; "what happens if another actor modifies this concurrently" decided 2.4 (a compare and set on the run's position) and 1.3 (one table-wide record, never a copy a phone).
- `principle-redesign-from-first-principles`: as if arcs had been in the game from the start, a chapter is given to a hunter by one step on every phone (`chapterLanded`), the quest form is one builder, and a title that grows is a reward field every reward can use.
- `principle-subtract-before-you-add`: no pause, no step back, no branch graph, no ready rule in the first four units, no story doc, no story name on players' phones, no toast for a ready sign, no Make-row button; the units delete gm.js's second quest form.
- `principle-experience-first`: the open's window shows what the player will see, from the same function that draws the player's window; a late joiner is the only hunter ticked when the GM catches them up; the card names the next chapter and what it gives, so a preview costs no tap; End is one or two taps with Undo.
- `principle-make-operations-idempotent`: the open reads the run and refuses a stale `from`; the write is one `store.apply`; the message lands once by its id; the ready sign is worked out and never stored, so there is nothing to repair after a crash.
- `statechart`: its TLC run needs the network and this phase runs nothing, so 2.1 is drawn by hand and checked cell by cell in 2.2; unit 3 draws it from the real step.
- `show-me-your-work`: the trail above.
- `unslop` and `humanizer`: these notes and every word in section 8, written plain; section 8's words still need the second reader `copy-tasks.md` asks for, in the unit that adds them.
- `poteto-mode`: the first line, the data shape first, variants weighed on paper (three where the choice was real: 1.2, 1.3, 1.5, 3.1 with four, 4.2, 4.3, 5.1, 7), contested choices flagged in the reply.

## 11. The lead's rulings (Nov 19)

The design is approved: a chapter holds its parts by value (1.2 a), a run lives on the GM's save (1.3 a), three states and three taps (2.1), no step back (2.5), turning on opens chapter 1, one new `chapter` message landed through `chapterLanded` (4.2), players see each chapter's window and nothing else (4.3), the Stories section in the GM view drawn by `stories.js` (5.1), the tap counts of 5.2, the maker by the recipe (6), The wager and What was spared returns as stories to copy (7). The four questions keep their defaults and go to the owner in `for-the-owner.md`; none blocks a unit.

Changes and additions, each to be built as written here:

1. **The stale-tap guard counts opens, not the chapter.** 2.2 refuses an open whose `from` is not the run's chapter. A chapter opened again (the wager's stake, a collection each session) leaves the run at the same chapter, so a second tap from a window drawn before the first write passes the guard and gives the chapter twice. The run keeps `opens: number`, the count of every open since it was turned on (it only grows, and is not cut with `opened` at `OPENED_MAX`); the event carries the count the window was drawn with (`seen`), and the step refuses `moved` when it differs. `tests/run.test.ts`: the same open sent twice, for the next chapter and for the same chapter again, writes once. End takes `seen` the same way, so an End held under Undo does not end a story that was opened further meanwhile.
2. **A cost in a reward.** 1.1 says a chapter takes XP, gold or points away with a negative number "as it is". Unit 1 proves it before anything is built on it: a case in `tests/rewards.test.ts` that `parseRewards` keeps a negative XP, gold and points, that `grant` takes them without passing zero (or says what it does at zero), and that `grantLines` says it in plain words ("Loses 1 ability point."). If any of the three does not hold today, that is unit 1's first step, by the recipe "A reward field", and the reward editor's fields take a minus.
3. **The order of work**: story units 1, 2, 3, 4, 5; then feats' unit 7 (the screens, which draw the `chapter` fact's line) and unit 8; then story unit 6 (the ready sign), which stays in the plan.
4. **Unit 2's one quest form** is taken, gm.js's Issue quest included. The quest cases of the browser tests pass unchanged, and the Issue quest section is looked at in a screenshot at 390 px before and after: it must not take more taps for the quest a GM issues today.
5. **Words.** The examples' lines and every label of section 8 go through humanizer and unslop by the unit that adds them; the lead is the second reader before each push.
6. **Each unit hands back to the lead** with its commits before the next starts. Unit 1's measurement (the repair's cost with the library at its cap) is written into these notes with its numbers before unit 2.

## 12. The build

### 12.1 Unit 1: a story as content

What the design left open for this unit, and how it was decided (written before the unit's code):

1. **Ruling 2 first.** A test of a cost in a reward is written and run before any story code: `parseRewards` keeps a negative XP, gold and points; `grant` takes them and never passes 0; the window's lines say what was lost. What it found is in 12.1.1.
2. **The window says what reached the sheet.** `grant` already lists a title only when it is new and a status only when the sheet took it. A cost follows the same rule: the line says the amount actually taken (a hunter with 20 gold given -50 loses 20, and the line says 20), and a cost that takes nothing has no line. The words are "Loses 20 gold", "Loses 50 XP", "Loses 1 ability point", with no full stop, as the other lines of the window ("+100 XP") have none.
3. **`removeStory` waits for unit 3.** Its only rule beyond `removeEntry` is "a story a running run names is not deleted", and runs (`save.stories`) arrive in unit 3. A step with no rule of its own is a wrapper with one caller and nothing to test, so unit 1 lists stories in `LIBRARY_LISTS` and they take `removeEntry` as items and maps do; unit 3 adds `removeStory(save, id)` with its guard, moves the Workshop's Delete onto it, and the library case "a story a running run names is not deleted" moves to unit 3 with it.
4. **`parseStory` answers a story without its id** (`StoryTemplate`), as `parseBundle` does: the save's repair gives it its id (`refill` with the prefix `st`), a pack carries stories without ids, and the maker (unit 2) adds the id it reserved. A chapter's quest without a title is no quest (the chapter keeps its words and reward); a chapter without a window title is dropped; a story with no name or no chapter left is refused.
5. **The bounds** (`STORY_BOUNDS`): a story's name 60 (as a bundle's), its "when" line 200 (as a window's line), a chapter's name 60, its note 300 (as a quest's penalty text), `CHAPTERS_MAX` 16 (section 8's error "A story has at most 16 chapters"), `LIMITS.libraryStories` 30 (section 8's "You have 30 stories"). A chapter quest's title 120, description 500 and penalty text 300 are the quest's own; at most 10 objectives, the room's `MAX_OBJECTIVES`, each read by `cleanObjectives` with its progress 0.
6. **`dueHours` takes the quest form's bound, not 1 to 720.** The form's "Due in hours" takes any number above 0 up to 999 (`step="any"`), and unit 2 moves that form into the builder the story maker uses; a parser narrower than the form would cut what the GM typed. So: a number above 0, cut to 999, fractions kept; 0, a negative or no number is no due time (`null`), as `dueAt` in `day.ts` answers for those.
7. **`chapterSize` measures the chapter as it is written**: the UTF-8 bytes of the JSON of its words, reward and quest (the parts a player's phone is sent; the name and the note stay on the GM's phone). The message of unit 4 carries the quest's `dueAt` (a 24-character time) where the chapter holds `dueHours` (at most 3 digits and a fraction): about 30 bytes more, inside the 16 KiB `CHAPTER_MAX` leaves. The count is a pure loop over code points, so core needs no `TextEncoder`.
8. **A pack's stories** carry the library statuses their chapters' rewards and quests' rewards name, as a bundle's and a feat's do, and are renamed on Add and matched by name on Replace (`mergeNamed`), with the statuses a merge renamed rekeyed in every chapter.
9. **One cycle of imports is new**: `save.ts` reads stories through `story.ts`, which reads objectives through `hunter/quests.ts`, which imports `save.ts`. Every use is inside a function, as with the cycles through `job-chain.ts` and `penalty.ts` today; the bun tests and the build run it.

#### 12.1.1 Ruling 2: what the test found, and the fix

The cases (`tests/rewards.test.ts`, "a cost a reward takes away") were written from the rule and run on the code as it was. One of six held: `parseRewards` kept -50 XP, -40 gold and -1 point. `grant` already stopped at 0 (`addGold` floors the gold, `grantPoints` takes at most the points free, `gainXp` stops at level 1 with 0 XP and takes a level away below a level's start), so the sheet was right. The window was not, in two ways:

- It said a cost as a signed number, "-1 ability point", where the ruling asks for words.
- It said what the reward asked, not what was taken: a hunter with 25 gold given -40 read "-40 gold", and a hunter with nothing to lose read three lines of losses that never happened.

The fix, by the recipe "A reward field" for its words and its grant: `gainXp` answers the XP it moved (`XpChange.xp`, the amount less what level 1 or the top level kept back); `grant` hands `grantLines` the XP, gold and points that reached the sheet; `grantLines` says a loss as "Loses 20 gold", "Loses 50 XP", "Loses 1 ability point". The reward editor's number fields already took a minus (no `min`, except a quest's, which keeps its floor at 0). Its browser step, in `tests/e2e/reward-room.e2e.ts`: a GM alone types -50 gold and more points than the hunter holds; the preview says "Loses 50 gold"; the window says what was lost; the sheet shows 0 and 0. `rewardLines` (the quest card, the session log) keeps its signed "-40 gold", which reads as a quest's terms rather than news of a loss.

#### 12.1.2 The measurement: the repair's cost with the library at its cap (ruling 6)

Written before the runs. Every write repairs the whole live save (`store.update` and `store.apply` call `repairSave`), and the repair now reads every story through `parseStory`, each chapter's reward and its quest's reward through `parseRewards`. The result that changes a decision: the repair of a save holding 30 typical stories of 8 chapters each taking more than 2 ms longer a write than the same save with none, on this box; then `LIMITS.libraryStories` and `CHAPTERS_MAX` come down until it does not, and these notes say to what. What could fake it: the box's swings in speed and another helper's tests on the same 4 cores (so the two saves are timed in turn, twice, each 7 runs of 200 calls, and the load is written down); a story the parser refuses, which would cost nothing (so the script prints how many were kept and a chapter's size); and the first repair, which rebuilds each story where the later ones read it again (so 50 calls are thrown away before the timing, and each timed call repairs the live save again as a write does).

The runs (`bench.ts` in the scratchpad: the save's own `repairSave` on the live save, as each write calls it, and `JSON.stringify` of it, as the write after the frame does; 7 runs of 200 calls after 50 thrown away, the two saves in turn, two rounds; load 1.40 to 1.53 on 4 shared cores; each chapter 993 bytes by `chapterSize`, all 30 stories kept):

| | Round 1 median (range), µs | Round 2 median (range), µs |
|---|---|---|
| repair, no stories (save 4,014 characters) | 99.7 (56.5 to 154.2) | 59.2 (53.7 to 88.9) |
| repair, 30 stories of 8 chapters (285,584 characters) | 352.6 (344.1 to 481.6) | 354.5 (335.1 to 379.5) |
| repair, 30 stories of 16 chapters (563,984 characters) | 660.7 (602.9 to 761.0) | 637.3 (601.0 to 700.2) |
| stringify, no stories | 26.4 | 23.6 |
| stringify, 30 x 8 | 766.9 | 804.4 |
| stringify, 30 x 16 | 1,584.4 | 1,682.1 |

The repair grows by 0.25 to 0.30 ms a write with the library at its cap of typical stories, and by 0.56 to 0.58 ms with every story at `CHAPTERS_MAX`: under the 2 ms that would have cut the caps, so `LIMITS.libraryStories` stays 30 and `CHAPTERS_MAX` 16. Why not double: the cost is linear in chapters read (240 chapters, 0.27 ms; 480, 0.57 ms; about 1.2 µs a chapter, two `parseRewards` and a quest each), and the no-story repair's own spread (54 to 154 µs) is a third of the effect, so the effect is not noise. At the lag test's 4x a typical full library costs the tap's task about 1.2 ms.

Two numbers outside the rule, for the lead. The write's `JSON.stringify` grows more than the repair (0.8 ms typical, 1.6 ms at 16 chapters), but it runs in a task after the frame (`schedule` in `store.ts`), so it does not hold the tap's frame. And the size: a full library of typical stories adds about 0.28 million characters to the save, and the store keeps the save and up to 8 backups (`backupCap`), so about 2.6 million characters in storage, 5.1 million with every story at 16 chapters, near what a browser's storage holds for a site. No GM is near that today, and the storage meter (`store.used()`) and the `failing` banner say so when it happens; whether the cap should answer to storage rather than to time is the lead's call (12.1.4).

#### 12.1.3 What unit 1 built, and its tests

- `src/core/story/story.ts` (new): `Story`, `Chapter`, `ChapterQuest`, `StoryTemplate`, `STORY_FOR`, `parseStory`, `parseChapterQuest`, `STORY_BOUNDS`, `CHAPTERS_MAX` 16, `CHAPTER_MAX` 49,152, `chapterSize`, `chapterWindow`, `storyLines`. `src/core/ids.ts`: `StoryId` (`st`) and `StoryRunId` (`sr`) in `SaveIds`, named `Id<'StoryId'>` and `Id<'StoryRunId'>` as every other id is (the design wrote `Id<'Story'>`).
- `src/core/save.ts`: `library.stories`, `LIMITS.libraryStories` 30, the repair line (each story through `parseStory`, its id kept or made with `st`). `src/core/library.ts`: `LIBRARY_LISTS.stories`, so `saveEntry`, `duplicateEntry` and `removeEntry` take stories.
- `src/core/pack.ts`: the `stories` kind beside the others, the feats' lines left as they were. `PACK_WORDS` (new, keyed by `PackKind`) holds each kind's words for the Share list and the import preview, which `src/views/io.js` had as its own list without feats: Share and the import preview threw for a library holding a feat. With the words keyed by the kind, the typecheck asks for a new kind's.
- Ruling 2: `src/core/hunter/progress.ts` (`XpChange.xp`), `src/core/hunter/grant.ts` (the lines from what moved), `src/core/rewards.ts` (`grantLines` says "Loses").
- Tests, each expected value from the rule: `tests/story.test.ts` (22 cases: a story read back whole and read twice, what is refused and what takes its default, each bound, `chapterSize` against the UTF-8 rule with é, 日 and an emoji, the name and note not counted, the window and the preview), `tests/rewards.test.ts` (6 cases of a cost), `tests/save.test.ts` (the repair of stored stories), `tests/library.test.ts` (3 cases: saved by id, the cap, a duplicate and its delete), `tests/pack.test.ts` (4 cases of stories in a pack, and the counts of every kind), `tests/e2e/reward-room.e2e.ts` (a cost typed with a minus in the Award form) and `tests/e2e/sharing.e2e.ts` (a feat and a story shared by code and added on a second phone; it failed on the old `io.js`, with the exception the console caught).
- AGENTS.md: the row "A story as content", the reward row's costs, `PACK_WORDS` in the recipe "A kind of custom content". `docs/dependency-map.md` rewritten. No machine changed, so no chart.

#### 12.1.4 For the lead

- A level lost to an XP cost has no line of its own: the window says "Loses 50 XP" and the sheet shows the lower level. A level gained has its window (`levelup`); a level lost has none. Not changed here.
- Storage, measured in 12.1.2: 30 typical stories put about 0.28 million characters in the save and in each of 8 backups. The cap held against the time rule; against storage it is a question for the lead.
- `rewardLines` (the quest card, the Award log line) still writes a cost as "-40 gold". `grantLines` is the window's; the quest card states terms. Say if the card should read "Loses" too.

#### 12.1.5 The principles read for this unit, and the choice each changed

- `principle-sequence-verifiable-units`: ruling 2's cases ran on the old code first (five of six failed, 12.1.1), then the fix; each step is its own commit with its checks green.
- `principle-test-behavior-not-implementation`: a cost's cases assert the sheet and the window's lines worked out from the rule (level 3 with 10 XP less 50 is level 2 with 160), not from a run; the sharing case was run against the old `io.js` and failed before it was kept.
- `principle-type-system-discipline`: `PACK_WORDS` is keyed by `PackKind`, so a kind without words no longer compiles (the feats' missing words were that bug); `StoryId` and `StoryRunId` are ids of their own.
- `principle-explain-the-number`: the decision and what could fake the number were written before the run (12.1.2); the limiter (about 1.2 µs a chapter read) and the spread are beside it.
- `principle-laziness-protocol` and `principle-subtract-before-you-add`: no `removeStory` until it has a rule; io.js's own list of kind words deleted rather than given a line for stories.
