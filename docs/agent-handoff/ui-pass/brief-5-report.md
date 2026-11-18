# Brief, unit 5: the UI and UX report

One helper (Sonnet, writer), in the main tree. No other helper writes while you work. You change no app code and no test. You write docs. Commit after each numbered step (name the files, plain messages, no AI attribution, no Co-Authored-By; this overrides "do not commit" in your built-in text). Do not push. Do not start helpers of your own. Never edit anything under `.claude/skills`.

Read first: `.claude/skills/unslop/SKILL.md` (every sentence you write follows it), `AGENTS.md`, `docs/agent-handoff/ui-pass/design.md`, `docs/agent-handoff/ui-pass/audit.md` (the "before"), every `docs/agent-handoff/ui-pass/notes-*.md` (the "now"; `notes-4-fight-desktop.md` ends with a table of every finding with its before and after image), the rows of `docs/agent-handoff/decisions.tsv` whose second column is `ui`, and `docs/agent-handoff/lead-report.md` section 12 (the style and length to match).

## Why (the owner's goal)

the owner asked for a run that makes the app "clearly nicer and easier to use for both players (mostly on phones) and the GM". He reads the report on his phone. He does not read code. He wants to know what looks and works differently, what his table will notice, and what was decided for him that he could change.

## Steps

1. **`lead-report.md` section 13, "UI and UX"**, in this order, each short:
   - "In short": four or five sentences. What a player notices first, what a GM notices first.
   - "The audit": how it was done (the script, 117 screens, three sizes), the count of findings by severity, and the table of all 33 with a last column "fixed", "partly" or "left", each with the unit that did it.
   - "What changed", one subsection per unit (the shared look; the creation flows; a player's screens; the GM's fight on a phone and the desktop). For each change: one line on what a person now sees, and the before and after image as markdown images side by side in a two-column table (`![before](ui-pass/before/<file>)` and `![after](ui-pass/after/<file>)`; the same file name in both folders). Use at most 14 pairs in the whole section: pick the ones where the difference is plain at a glance. Look at each pair with the Read tool before you include it, and drop a pair whose after image does not show the change.
   - "Taps": a table of the common actions with before and after, from the audit's table and the notes (run counts name their test).
   - "The shared set": the tokens and classes unit 1 made, one line each, and where a new screen should reach for them.
   - "What a table will notice": every behaviour change a player or GM would see, one line each, from the notes and the trail. Do not leave one out because it is small.
   - "Things the owner can choose": every decision of `design.md` under "Decisions" that he might want otherwise, and what the helpers were unsure of, each with what he would say to change it.
   - "Left on purpose": from `design.md` and the notes.
   - "Numbers": bun tests and browser tests before the run (1,657 and 148) and after (the last `push-N` row of the trail), the units and their durations from the trail.
   Every number comes from a notes file, the trail or a test name. Where you cannot find one, write "not measured" and say where you looked.
2. **`AGENTS.md`**: add one recipe, "A screen's look": which tokens and classes to use for a button (the four kinds), a one-of-n choice, an icon button, a long form's action bar, a toast, and that a colour or a control height goes through a token; that `scripts/ui-shots.ts` shoots every screen and a new screen gets a step there. Check each name with `grep` in `public/app.css` and `src/views/`. In "Where things live" add a row for "How a screen looks at each size" pointing at `scripts/ui-shots.ts` and `tests/e2e/look.e2e.ts`. Keep the file about the size it is.
3. **`docs/agent-handoff/copy-tasks.md`**: check every string the run's notes sent there is present, grouped under one "UI and UX run" heading.
4. `bun run deps -- --write`, `bun run charts`, `bun run test` (the docs tests fail when a generated file is stale). Commit.

## Rules

- Plain whole sentences. No long dashes. Lead with the answer. Tables over prose.
- Facts only, each with its source. If two notes disagree, the later one wins and you say so in your notes.
- Do not describe anything as working that a test does not check: name the test.
- Notes file: `docs/agent-handoff/ui-pass/notes-5-report.md`.

## Time

40 minutes. Reply in at most 150 words: the commits, the pairs you chose, anything you could not source.
