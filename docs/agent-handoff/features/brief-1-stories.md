# Brief: stories the GM runs (feature 1), the design first

the owner, Nov 18: "Ok something big is the story modes have to be active table by me. They should [move] entirely at
the GM pace and I should be able to make my own stories. This should be perfect. Architecturally sound, clean and easy
to use."

His goal: an arc that runs over several sessions (a chain of quests, a title that grows, a debt that comes due) is
something the GM turns on for the table, moves one step at a time when he says so, and writes himself. The problem:
the game has single feats that fire by themselves and quests the GM makes one at a time, and nothing that holds an arc.
The smallest change that meets it is what your design must find.

The lead's reading, which holds (`features/plan.md`, "Stories"): a story never starts by itself. The GM turns it on for
the table. Each step happens when the GM says so. The System may show the GM that a step is ready; it never takes the
step. The GM writes stories of his own in a maker. A single feat stays automatic and is not a story.

## This phase: design notes only

Write `docs/agent-handoff/features/notes-1-stories.md` and nothing else. No code, no test, no run of the test suite or
a browser (another helper is changing and testing the tree while you write). Commit the notes by path when a section
is whole, and once more at the end. Never push. No attribution lines in a commit message. Then stop and reply; the
lead reviews the design before any code.

Read first, in full: `.claude/skills/poteto-mode/SKILL.md` (you start no helpers; where it calls for `architect` or
`arena`, weigh the variants yourself on paper, three where the choice is real), `docs/agent-handoff/START-HERE.md`
(the owner's standing rules, "Everything explicit", "Every helper works in poteto mode"), `AGENTS.md` (the rows for a
feat, a fact, a quest, a reward, a room message, the recipes "A kind of custom content", "A room message", "A maker",
"A write to the save from a view", and "Machines and their charts"), `features/plan.md`, `features/notes-1-feats.md`
(sections 1, 5, 6, 12 and 17: its shape is the shape to copy), `features/ideas-2-imaginative.md` section 7 (thirteen
stories written chapter by chapter and a template for a GM's own), `docs/agent-handoff/copy-tasks.md` (Plain first),
the skills `statechart`, `principle-model-the-domain`, `principle-foundational-thinking`,
`principle-redesign-from-first-principles`, `principle-subtract-before-you-add`, `principle-experience-first`,
`principle-make-operations-idempotent`. Then the code a story will touch: `src/core/hunter/quests.ts`, `grant.ts`,
`rewards.ts`, `feats.ts`, `counts.ts`, `facts.ts`, `chronicle.ts`, `src/core/award.ts`, `src/core/protocol.ts`,
`src/core/library.ts`, `src/core/pack.ts`, `src/views/workshop.js`, `src/views/feat-maker.js`, `src/views/gm.js`.

## What the notes must answer

1. **The data shape, before anything else.** What a story is as content (its chapters, and what a chapter may hold:
   words for the players, a quest issued, a reward or a bundle given, a title given or changed, a status, a cost that
   comes due) and what a story is on a table (off, running at a chapter, ended; for the whole table or for chosen
   hunters). Every part of a chapter must be something the game already does in one step (`grant`, the quest offer, an
   award with its window's words): a chapter that needs a new capability names it and says which unit builds it or why
   it waits. Three shapes weighed for the content and for the table's state, one chosen.
2. **The machine**, drawn by the `statechart` skill before its `TABLE` is typed: states, events (turn on, advance,
   step back if you keep one, end, turn off), who may send each (the GM alone), and what each writes in one write.
   What a second tap, a reload between two parts, or the same step from two GM phones does (idempotence by an id, as
   the room's events are taken once).
3. **"Ready", without the System acting.** How a chapter says when it is ready (reuse a `FactCount` over a hunter's
   facts if it fits without bending it; say what "the table" means when hunters differ), where the GM sees it, and the
   proof that no path advances a story but the GM's tap. Weigh having no ready rule at all in the first build.
4. **The room.** Whose save holds the story (the GM's), what reaches a player's phone and how (each by AGENTS.md's
   recipe for a room message or a doc, with its bound against `DOC_MAX` or the event's size worked out), what a player
   sees of a story (its name and the chapters reached, or nothing until the GM shows it), a player who joins late, a
   hunter added or removed mid-story, a GM alone with hunters on one phone.
5. **The GM's use at 390 px, counted in taps.** Turn a story on, advance a chapter, see what the next chapter will do
   before doing it, end it. Where these live (the GM view, a hunter's card, the Workshop). The lead will count the taps
   in review: say the number for each.
6. **The maker** (by the recipe "A kind of custom content": parser, library list with its cap, pack, maker, Workshop
   section) and what is reused from the reward editor, the quest form and the feat maker rather than built again. What
   a GM with no time fills in for the shortest story that works.
7. **What ships built in.** the owner tabled the intro story and will write it himself after the features: no new story
   is written here. Weigh shipping none, or one or two short ones taken as they are from `ideas-2-imaginative.md`
   section 7 as examples to copy (the kits' "examples to copy" pattern), and say which chapters of those today's game
   can already run.
8. **Words.** Every label, hint and window body plain and literal (Plain first); names may be names. List them.
9. **The cut into units**, each whole with its tests and the app working after each, with what each deletes; the
   AGENTS.md rows; the chart; what goes in `for-the-owner.md` (each choice he might want otherwise, in one or two plain
   lines); questions only he can answer, with the default you take meanwhile.
10. **A decision trail** (`show-me-your-work`) and the principles you read with the choice each changed.

Reply with: the notes' commit, the design in ten lines, the tap counts, the choices you think are contested, and the
questions for the owner with your defaults.

## The build (added Nov 19, after the lead approved the design)

The design is `notes-1-stories.md`; its section 11 holds the lead's rulings, which win where they differ from the
sections before. Build one unit at a time, in the order of section 11, and hand back to the lead after each.

- The stories helper works in its own worktree, `/home/user/sg-stories`, on the local branch `stories` (another helper
  works in the main tree). Commit there, one commit a step with its tests, never push, no attribution lines. The lead
  merges the branch into the working branch after each unit; when the lead says the tree moved, merge
  `claude/nifty-keller-3nvune` into `stories` before the next unit.
- Read first what the design phase read (the list at the top of this brief), then the notes in full.
- Before a unit's code, add to the notes ("12. The build", a subsection a unit) anything the design left open for that
  unit and how you decided it; after it, what was built, the tests, and the measurement where the unit has one.
- Words: every label, hint and line through `humanizer` and `unslop`; the lead is the second reader.
- Checks before each hand-back: `bun run typecheck`; the whole `bun run test`; `bun run deps -- --write` and `bun run
  charts` when imports, the api, events, views or a machine changed (commit what they write); the browser files the
  unit touches or adds, and for a unit that changes a shared form or view, the files that drive it:
  `E2E_CHROMIUM=/opt/google/chrome/chrome E2E_PORT=3350 E2E_FEEL=skip bunx playwright test <files> --workers=2 --trace
  off --output=/tmp/pw-stories 2>&1 | grep -E "failed|passed|✘"`. Not the whole browser suite: the lead runs it on the
  public repository before the push. Never port 3218, 3233 or 3340. If `pgrep -f "[s]cripts/ci.ts"` prints a pid, wait
  until it does not before any test run. A test that fails once is a finding: name its cause from its trace.
- A new screen: look at it yourself in a screenshot at 360 and 390 px (a throwaway test under `tests/e2e/`, images
  under `/tmp`, deleted before the commit), and add its step to `scripts/ui-shots.ts` and its case to
  `tests/e2e/look.e2e.ts`.
- Reply after each unit with: its commits, what you decided that the design had not, the checks' last lines with their
  counts, the taps you counted on any new screen, and what you found outside the unit (not fixed).
