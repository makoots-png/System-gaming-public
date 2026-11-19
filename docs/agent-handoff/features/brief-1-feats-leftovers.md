# Brief: three things the feats review's helper found outside its points (Nov 19)

the owner's goal for feats: a maker that is architecturally sound, clean and easy to use, and everything explicit. The
problem: the review's helper found three faults it was not asked to fix. The smallest change: fix each at its cause with
a test that fails without it.

Read first: `.claude/skills/poteto-mode/SKILL.md` (you start no helpers), `docs/agent-handoff/START-HERE.md` ("Everything
explicit", "The problem, not the symptom"), `AGENTS.md` (the feat row, Tests, Rules), `docs/agent-handoff/copy-tasks.md`
(Plain first), `docs/agent-handoff/features/notes-1-feats.md` section 17.10.

1. **The feat maker offers "The total of" and "The highest" for a kind of fact with no number field.** The field list
   is then empty and the message a refused Save gives is wrong. Decide in core which measures a kind can take (beside
   `opsFor` and `MEASURES`, `src/core/hunter/counts.ts`), offer only those in `src/views/feat-maker.js`, and keep the
   choice valid when the GM changes "What happened". A unit case over every kind of `FACT_FIELDS`, and a browser step in
   the feat case of `tests/e2e/makers.e2e.ts`.
2. **A pack's merge of feats** (`mergeFeats`, `src/core/pack.ts`) writes entries itself: it carries `off` as it is and
   keeps a built-in's entry that equals the shipped feat, which `saveFeat` (`src/core/library.ts`) would drop. One rule,
   one place: the merge goes through the library's step (or the rule it holds), and a case in `tests/pack.test.ts`
   ("feats in a pack") shows a pack holding a built-in as shipped leaves no entry. Decide whether a pack carries `off`
   (a GM sharing a table's set-up would want a turned-off built-in to arrive off) and say why. Touch only the feats'
   lines of pack.ts: another helper is adding a new kind to that file in another worktree.
3. **About 15 doc comments in `src/core` sit over the wrong declaration** (`record.ts` `setJob`, `inventory.ts`
   `withShop`, `fight-view.ts` `timeOf`, `gate.ts` `MAX_FOUGHT` and others): a `/** ... */` block followed directly by
   another `/** ... */` block, so the first describes nothing. Build the lever first: a lint in `tests/lint.test.ts`
   ("a doc comment sits over what it describes": no doc comment block in `src/` or `server.ts` is followed, with only
   blank space between, by another doc comment block), run it to list every case, then move each comment back over its
   declaration (read the declaration to be sure whose it is; change no code). The lint's message says what to do.

Notes: add "17.11 Three leftovers" to `notes-1-feats.md`: for 1 and 2 the variants weighed and the one chosen, written
before the code. One commit a point, by path, with its tests. Never push. No attribution lines in a commit message.

Checks before you report: `bun run typecheck`; the whole `bun run test`; `bun run deps -- --write` if imports changed;
the browser files you touched and `tests/e2e/sharing.e2e.ts`, `tests/e2e/feats.e2e.ts`, `tests/e2e/look.e2e.ts`:
`E2E_CHROMIUM=/opt/google/chrome/chrome E2E_PORT=3340 E2E_FEEL=skip bunx playwright test <files> --workers=2 --trace off
--output=/tmp/pw-left 2>&1 | grep -E "failed|passed|✘"`. Not the whole browser suite: the lead runs it on the public
repository. If `pgrep -f "[s]cripts/ci.ts"` prints a pid, wait until it does not before any test run. A test that fails
once is a finding: name its cause from its trace.

Reply with each point's commit, what you decided and why in a line or two, the checks' last lines, and anything found
outside the points (not fixed).
