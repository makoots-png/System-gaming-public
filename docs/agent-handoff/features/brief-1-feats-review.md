# Brief: the lead's review of feats units 4 and 5 (Nov 19)

the owner's goal: the System notices what a hunter does and rewards it without the GM's hand, and the GM makes feats of
his own in a maker that is "architecturally sound, clean and easy to use". The problem: units 4 and 5 (`21c88ff`) were
committed without a lead's review, and the review found the points below. The smallest change: fix each at its cause,
with a test that fails without the fix. No new capability beyond what a point names.

Read first, in full: `.claude/skills/poteto-mode/SKILL.md` (you start no helpers), `docs/agent-handoff/START-HERE.md`
("Everything explicit", "The problem, not the symptom", "Every helper works in poteto mode"), `AGENTS.md` (the feat and
maker rows, the recipes "A maker", "A write to the save from a view", "A screen's look", Tests),
`docs/agent-handoff/copy-tasks.md` (Plain first), `docs/agent-handoff/features/notes-1-feats.md` sections 5 and 17.9,
`.claude/skills/humanizer/SKILL.md` and `.claude/skills/unslop/SKILL.md` for every word a GM reads.

Files: `src/views/feat-maker.js`, `src/views/workshop.js`, `src/core/hunter/feats.ts`, `src/core/library.ts`,
`src/core/registry/feats.ts`, `src/core/gates/pay.ts`, `src/core/combat/fight-save.ts`, `src/core/combat/fight-facts.ts`,
`src/core/protocol.ts` (comments only), `src/views/gates.js`, `src/views/combat.js`, `scripts/ui-shots.ts`, their tests.
Not `src/edge/sync.ts`, `src/edge/store.ts` or `server.ts`; if a point seems to need one, stop and say so in your notes.

## The points

1. **A feat shown after another feat loses that on an edit.** `Show` has four arms; the maker offers three and draws
   `{ at: 'feat' }` as "Hidden until earned", and `raw()` then saves `{ at: 'never' }`. Seen at 390 px on the built-in
   Iron Routine (shown after Early Riser): Edit, Save, and it is hidden. Notes 17.9 says it is kept; it is not. Offer the
   fourth choice, "After another feat", with a choice of the feat (the built-ins and the library's, not itself, not one
   turned off; a key the list no longer holds stays chosen and is named by its key). The form must give back exactly
   what `parseFeat` reads, for all four arms.
2. **Turning a feat off and on is half built.** Today: only an unchanged built-in has Turn off; a changed built-in has
   none; nothing turns one on but Reset (which drops its edits) or an Edit and Save (which turns it on without saying
   so); Duplicate of a turned-off built-in makes the GM's own feat that is off and cannot be turned on. Make it two
   named steps in `src/core/library.ts` (off, on), with their round-trip case in `tests/library.test.ts` by the recipe
   "A control that undoes another": Turn off on any built-in, changed or not; Turn on on one that is off (a built-in
   whose entry then equals the shipped one may leave the library, so it is listed under Built-in feats again: decide and
   say why); the maker keeps `off` as it found it; Duplicate never copies `off`. Decide whether a GM's own feat can be
   turned off too (the type says "a built-in"); if not, the parser or the step refuses it, and say so.
3. **A test row is four stacked full-width controls** (about 330 px a test at 390 px, 1,300 px for four) with no label
   saying what the rows are. `.fm-test` and `.fm-row` have no style at all. Give the group a plain label and lay a row
   out so a test takes about half that height at 360 and 390 px, every control 44 px, no sideways scroll (tokens only,
   by "A screen's look"). Look at it yourself in a screenshot at both widths with one and with four tests.
4. **A refused Save shows nothing on screen.** At 390 px: New or Edit, Add a test, leave its value empty, Save. The
   window stays, the library is unchanged and no message is in view. Find where the shell's `[data-err]` sits and why
   it is not seen (this may hold for every maker: check one other, the status maker, the same way). Fix it where it
   starts. A browser case: the message is inside the viewport after the tap.
5. **The maker's two messages**, plain: "Finish each test: a value its field can hold." and "Name the feat and finish
   its tests." Say what to do in the words of the form's labels.
6. **Three doc comments sit over the wrong thing** since `21c88ff`: `settleClear`'s (now over `gateFact`, pay.ts),
   `foughtFacts`' (now over `fightGateName`, fight-save.ts), `SoloAnswerPayload`'s (now over `NOTED_MAX`, protocol.ts).
7. **The rank of a hunter whose sheet is not on the GM's phone is decided twice**: `?? 'E'` in `remoteFacts`
   (fight-facts.ts) and `|| { data: { rank: 'E' } }` in `gates.js`. One place in core, the view passes what it has.
8. **`freeFeatKey` casts to `FeatKey`** without the parser. A case in `tests/feats.test.ts`: for names of any
   characters and length, with taken keys, the answer reads back through `parseFeatKey` and is not taken. Fix what it finds.
9. **Small**: the title of In and Out says "Cleared a gate alone in three rounds." where its rule is a gate of the
   hunter's rank or higher in three rounds or fewer; Duplicate cuts a feat's name with a literal 60 where
   `FEAT_BOUNDS.name` is the bound; `scripts/ui-shots.ts` has no step for the Workshop's Feats or the feat maker (the
   recipe asks for one: add it, with a built-in's Edit open and a test row in it).

## How

- Before any code, write "17.10 The lead's review" in `notes-1-feats.md`: for points 1 to 4 the variants weighed (three
  where the choice is real) and the one chosen, the data shape first. Commit it, then go on without waiting.
- One commit a point (or two small ones together), by path, each with its tests. Never push. No attribution lines in a
  commit message.
- Checks before you report: `bun run typecheck`, the whole `bun run test`, `bun run deps -- --write` and `bun run
  charts` if they changed, and every browser file: `E2E_CHROMIUM=/opt/google/chrome/chrome E2E_PORT=3340 bunx
  playwright test --workers=2 --trace off --output=<a /tmp dir> 2>&1 | grep -E "failed|passed|flaky|✘"` with
  `E2E_FEEL=skip`. A test that fails once is a finding: name its cause from its trace (rerun it with `--trace on`).
  Never port 3218 or 3233. If `pgrep -f "[s]cripts/ci.ts"` prints a pid, wait until it does not before any test run.
- A test that looks for old words changes to the new words in the same commit. Test names say what a GM sees.
- Reply with: each point's commit, what you decided and why in one or two lines each, the checks' last lines, anything
  you found outside the points (do not fix it; name the file and the unit that should own it).
