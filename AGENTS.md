# The Hunter System: guide for coding agents

A phone-first tabletop RPG companion. A GM phone and player phones share a room. Served by `bun server.ts`.

This file is the index of the guide. It is loaded into every session, so it stays at most 150 lines. The long parts are in `docs/guide/`, one file for each area.

## Who owns this

the owner (Nov 19): "You own the repo, same as the other one. They're yours and will be maintained by you for a long time." Both repositories, `the-owner/systemgaming` (private, the working one) and `the-owner/System-gaming-public` (the public clean copy, where the browser tests run), are owned and managed by Claude sessions from now on. Change whatever they need as you see fit. Two things stay his: only the clean copy that `scripts/ci-public.sh` makes ever goes to the public repository, and the skills in `.claude/skills/` are not edited. His standing rules are in `docs/agent-handoff/START-HERE.md`.

## Set up once

```
bun install
bunx playwright install chromium
git config core.hooksPath .githooks
```

The last line turns on the pre-push hook. Without it, pushes are not checked.

On a machine that ships its own Chromium (a cloud box), skip the Playwright install and set `E2E_CHROMIUM` to that browser's path for every Playwright or CI run. Set it also where Playwright's default headless shell refuses notifications (`tests/e2e/used.e2e.ts`, "a GM who allowed notifications", then reads "Blocked in this browser's settings"): point it at a full browser, the machine's own (`/opt/google/chrome/chrome` on the cloud box) or the Chromium Playwright installed beside the shell (`~/.cache/ms-playwright/chromium-*/chrome-linux/chrome`).

## Run, test, check

| What | Command |
|---|---|
| Run the app | `bun start` (port 3000). The server bundles the app once at start, so restart it after a change |
| Build for a static host | `bun run build` (writes `dist/`) |
| Typecheck | `bun run typecheck` |
| Typecheck, unit tests (four workers) and lint checks | `bun run test` |
| One browser test file | `bunx playwright test tests/e2e/<file> --workers=1 --output=/tmp/pw-<name>` (starts its own server on 3217; set `E2E_PORT` when two runs overlap) |
| Everything a push must pass | `bun run ci`. The unit and browser passes may instead be taken from a green run on the public repository: `CI_UNIT_REMOTE=<tree> CI_BROWSER_REMOTE=<tree> git push` (steps in `docs/guide/tests-ci.md`) |
| The room API against Postgres, the store the deploy uses | `DATABASE_URL=postgres://... bun test tests/server-rooms.test.ts tests/server-handshake.test.ts` (an empty database; without the variable the same tests use the memory store) |
| Redraw the state charts | `bun run charts` (writes `docs/state-machines.md`) |

## Layout

```
src/app.js     entry: view registry, routing, header. Lists every module it registers
src/core/      pure logic. No DOM, no storage, no network, no imports from edge or views
src/edge/      the store (localStorage), the room link (network), edge/rules.ts (the current rules for views), edge/roll.ts (every die a fight asks for)
src/views/     DOM modules: one per screen or panel, and the room pill in the header
src/sw.js      service worker source
public/        files served as they are (index.html, app.css, manifest, icons)
scripts/build.ts   bundles src/ and public/. The build id is a hash of the inputs
server.ts      serves the built files and the room API
```

## Finding what depends on what

`AppEvents` in `src/core/events.ts` and `AppApi` in `src/core/api.ts` are the two typed tables between modules. `tsconfig.views.json` checks the views as loose JavaScript against the `App` of `src/views/app.ts` (no null checks); a choice read from the page goes through `oneOf` in `src/core/one-of.ts`. `docs/dependency-map.md` lists each file's imports, API members, events, save keys, views and panels; `bun run deps -- <name>` prints one entry (a file, an API, a member such as `combat.add`, or an event). The map follows literal event names and `app.api.<name>.<member>` or a declared alias (`const A = () => app.api`).

## Where to look

Read only the guide file for the area a change touches. Each has "Where things live" (a question, the one place that answers it, a test to copy) and "Recipes" (the steps to add one kind of thing).

- `docs/guide/combat.md`: the fight reducer and its commands, abilities, statuses and their ops, formulas and dice, rules and numbers, the battle map, the fight doc, odds and the balance simulation, the kits.
- `docs/guide/room-sync.md`: room messages and their appliers, the outbox, the room server, the link and its pill, seats and roles, trades and offers, what each phone gets, the build handshake.
- `docs/guide/hunters.md`: stats, the sheet, level and points, vitals, inventory, shadows, quests, the day's clock, the session log, the coin call, first-run setup, identity and settings.
- `docs/guide/gates-solo.md`: gates and the world day, what a fight's end pays, loot, solo runs, personal gates, a world gate opened to solo runs.
- `docs/guide/feats-stories.md`: facts, feats and the Chronicle, awards for roleplay, stories and chapters.
- `docs/guide/makers.md`: the Workshop, the makers and their kit parts, rewards, packs, the library, the codex, views, windows, motion, more info, failures, a view's write to the save.
- `docs/guide/save-store.md`: what a save holds, the store and its life, device memory, imports and exports, the app update, ids, saves and roles.
- `docs/guide/tests-ci.md`: test conventions, the local CI and the push hook, screen looks, copy and words.
- `docs/guide/machines.md`: the list of every state machine and how its chart is drawn.
- `docs/audit/2026-11-19-neon-audit.md`: architecture, implicit state-machine and bug audit of `a11b6a5d` (154 findings, ordered by importance).

## Rules and what enforces them

When a mistake is made, apply `.claude/skills/correct/SKILL.md` (the owner's standing rule) and add its row here. A rule with nothing in the right column is a repeat waiting to happen.

| Rule | What enforces it |
|---|---|
| A helper's launch names its model (a lead runs on Fable; a helper must not inherit it) | `.claude/hooks/agent-model.py`, a hook that refuses an `Agent` call with no `model` and says which to name |
| A session reads the handoff only from a checkout that is up to date | `.claude/hooks/session-start.sh`, which fetches the branch as a session starts and says how far behind it is |
| The server's Postgres path is tested, not only the memory store | the public repository's unit job with a Postgres beside it (`.github/workflows/ci.yml`, being added: `docs/agent-handoff/audit/brief-ci-remote.md`) |
| A lead hands over when it is due (40 turns, or a compaction) | `.claude/hooks/handoff-due.py`: from 40 turns every turn is told the hand-off is due; from 80 a launch of a new helper is refused until the next lead; after a compaction the first turn is told to hand over |
| A push's tested tree is the pushed commit's, not the checkout's | `testedTree` in `scripts/ci-plan.ts`, fed `CI_PUSHED` by `.githooks/pre-push`; its cases in `tests/ci-plan.test.ts` |
| No AI attribution lines in a commit (the owner's rule; a harness may ask for them, and the Nov 20 lead added one) | `.githooks/commit-msg`, which refuses a message with `Co-Authored-By:` or `Claude-Session:` and says to remove it |
| Every other rule of the code | its test in `tests/lint.test.ts`, named for the rule |

## Rules

- Dev dependencies are `typescript` and `@playwright/test` only. No CDN, no `@types/*`; ambient types are in `types/`.
- TypeScript is strict. New core code is `.ts`.
- The lint rules are the tests in `tests/lint.test.ts`: each test's name is the rule, and its comment or message says why and what to do instead. They keep `src/core` pure (no edge or view imports, no browser API, no module-level `let`), give each piece of state one writer (the role, a gate's status, the fight, a combatant's place, HP, shield, stagger, channel, threat and statuses, room event ids, the save's room fields, a hunter's progress, vitals, penalty and chain, a quest's end time, the coin calls, a story run, which only a tap of `src/views/stories.js` moves), give an item and a monster one parser each, keep the GM's statuses out of the rule overrides, keep the fight's numbers in core (a view rolls no fight die and computes no fight number; a balance number is a rule in `RULES.fight`, not a literal), keep the deleted old fight deleted, keep every module of `src/edge` to the state the lint names with what it holds (sync.ts's at its top too), let a view write the save only through `store.apply` with a step from core, keep the day's clock in `src/core/day.ts`, name each timer a view sets with its reason, let a view ask `app.seat()` whether the phone is in a room and as what, let only `src/edge/upgrade.ts` listen to the service worker, keep the browser's storage in `src/edge/store.ts` (`store.device` for a view's memory), keep `server.ts` without room state of its own and without `any`, let no catch in `src/` or `server.ts` swallow its error, name each `let` and each Map, Set, list or object a view keeps for the page (none holds a row's, a hunter's or a saved thing's state), give each exported type name one meaning (no list of exceptions), and keep each doc comment directly over what it describes. When a bug class shows up twice, add a test there.
