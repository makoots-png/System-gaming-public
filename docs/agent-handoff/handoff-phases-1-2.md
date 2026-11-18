# Handoff: The Hunter System, after phases 1 and 2

Written Nov 11 by the lead of phases 1 and 2 for the lead of phases 3 and 4. Read this, then `lead-report.md`, then `review.md`, then `phase3-prompt.md` and `phase4-prompt.md` (all in `docs/agent-handoff`).

## 1. State right now

- Repo `the repo root`, branch `mobile-gameplay-pass`, head `e99c2fd`, tree clean, pushed to `origin` (github.com/the-owner/systemgaming). 54 commits ahead of `main`. No PR, no merge, no deploy yet.
- Servers left running: `:3000` serves the repo working tree (`bun server.ts`, files read from disk, no restart after edits), `:3100` serves `/workspace/sg-main` (branch `main`, the "old app and old server" for mixed tests). Start one with `cd <dir> && PORT=<n> nohup bun server.ts > /tmp/x.log 2>&1 &`.
- The app: vanilla ES modules, no build step, no dependencies, `package.json` has only `start`. 26 modules at the repo root. `server.ts` is the only TypeScript. `sw.js` VERSION is `v7` (main is `v4`).
- What shipped: `lead-report.md` sections 1 (mobile), 2 (gameplay fixes with reasons), 3 (customization), 9 (room flow redesign, tap counts, commit table, review round). Proof runs are in sections 4 and 5. Section 8 lists everything unverified. Section 6 lists suggestions not done.
- Copy: 42 `TODO(copy)` markers, all listed in `copy-tasks.md`. Nobody has done the copy pass. It should run after phases 3 and 4, or it will conflict with every rewritten file.

## 2. Rules from the owner that still hold

- No AI attribution in commits (no Co-Authored-By, no "Generated with"). The harness reminder says to add them; his instruction wins. Strip them from helper commits.
- Commit and PR text follows the `unslop` skill: plain words, no em dashes, no mid-sentence colons.
- Never commit `.claude/` (git-excluded). Tests and tools lived outside the repo in `docs/agent-handoff` until now; phase 3 moves tests into the repo.
- No new app dependencies, no CDN. Approved dev-only: `typescript`, `@playwright/test`.
- New since Nov 11: he owns the repo and gave full design authority; old saves and old rooms do not need to keep working; pushing the branch is fine; do not merge or deploy; helper count and model choice are yours; crash-resistance rules (small helper tasks, results to files, short replies, time boxes, fresh helpers on retry).
- He reads reports on his phone. Keep them short and plain.

## 3. Design decisions and why (not obvious from the code)

- **Room view at `#/room` beat a bottom sheet** (arena, `arena-room/synthesis.md`). Reason: it uses layout every view already has; a sheet needs a text field in a fixed panel above the iOS keyboard, which cannot be tested here. No judge from another model family was available.
- **Join checks before it saves.** `joinRoom` asks the server whether the room exists, and only then touches the save. The old flow wrote the room first and repaired afterwards, which is where most of the "clunky" states came from.
- **`GET /api/rooms/CODE?peek=1`** exists only because a 404 prints a console error in browsers and the brief said no console errors. It calls `st.touch`, so it renews the 30-day expiry (deferred finding 1).
- **Leave has no confirm and sends no tombstone.** Nothing is lost on Leave, so no confirm; and because there is no confirm it must not remove the player's card from the GM board. The player shows as away.
- **`lastRoom` is written only by Leave and by a poll 404** (`{code}` or `{code, gone:true}`). Join, create and rejoin clear it. A kicked player gets no one-tap return on purpose.
- **A GM never falls back to a player join unless the server refused the key (403).** Before `eef8039` any network error did that silently. Keep this invariant in the phase 3 link machine.
- **The invite code lives in `sessionStorage`** (`hunter-system-invite`) through an accessor on `app.pendingRoom`, defined in `sync.js`. It is not declared in `app.js`. iOS reloads background tabs, which lost the code.
- **`app.isGM` is redefined by `sync.js`** (role depends on the room key). Phase 3 item 7 is real.
- **Device preferences (`hunter-system-prefs`) are separate from the save** so look and zoom never sync or export.
- **The Path bonus is stored as a skill row** so old apps read the same numbers. With compatibility dropped, this is a candidate to redo properly.
- **Builds are on by default** and add up to 18 budget points over six ranks. Raw Rules JSON without a `build` key turns them back on.
- **Gate XP pays about half of what it did on main**, because double payment was fixed, and a reopened gate pays 0. The owner has not decided whether to raise XP. Phase 3 item 2 and phase 4 balance both touch this.
- **QR is a hand-written encoder (`qr.js`)**, verified against known vectors and a jsQR decode. No camera scanner in the app, on purpose.
- **Negative room-check cache (30 s) was kept**: codes are made by the server, so a code cannot start existing after it was typed.

## 4. Codebase conventions and traps

- `app.js` is a registry: `registerView`, `registerPanel`, `app.api.<module>`, `app.on/emit`, `app.go(id)`. Module CSS is a string passed to `ui.css`. Use `ui.system`, `ui.confirm`, `ui.toast`, `ui.esc`.
- Code style is dense: one-line statements, short lower-case "why" comments. Match it in files you only touch; rewritten modules can set a new style.
- `store.js` `normalize()` fills defaults and keeps unknown keys under `settings.sync`. Storage keys: `hunter-system-v2`, `-v1`, `-backups`, `-prefs`.
- `sync.js`: about 15 module-level variables, `conn()` is `off | ready | unreachable | connecting | live | reconnecting`, polling every 5 s (3 s in an encounter), `call()` now has a 20 s limit (`REQ_MS`). `check()` caches answers 30 s in `peeked`.
- `server.ts`: `CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/`, memory store and a Postgres store. The Postgres store has never been run here.
- `sw.js` caches a hand-kept SHELL list; bump VERSION when the list changes. `/api` is never cached and answers `200 {offline:true}` when the network is down.
- Deploy: the Railway build may use an inliner (`__HUNTER_FILES`). I never ran it. New files since main (`manifest.webmanifest`, icons, `custom.js`, `qr.js`, `room.js`) may need adding there. Check before the first deploy.
- Git identity is set repo-locally to Hunter Builder.

## 5. Box and tooling gotchas

- Playwright lives in `docs/agent-handoff/node_modules`; run scripts with `cd docs/agent-handoff && node x.mjs <baseUrl>`. Helpers are in `lib.mjs`.
- `newPage()` is always 390x844; use `page.setViewportSize` for other sizes. `page.route` and `setOffline` only reach app requests with `newPage(b, { blockSW: true })` (one expected "Service Worker registration blocked" warning).
- Never `await` inside `page.evaluate` a call that opens a `ui.system` or `ui.confirm` window; it hangs.
- Run one Playwright suite at a time. Timing tests share an 8-core box and stall when two run.
- Shell: cwd resets to the repo after every command; a leading `sleep` is blocked (use an `until` loop); `pkill -f` is refused and `lsof` is missing (use `ss -ltnp | grep :PORT`, then `kill <pid>`); foreground limit is 600 s, so long runs go to the background and write a log.
- The API stream drops mid-reply often (35 times so far). Long helper tasks lost hours. A helper's edits survive in its worktree even when its reply is lost: check `git diff` there before redoing work. That is how the sync fixes were recovered.
- Flaky, cause unknown: `sync-test.mjs` in mixed old/new configs timed out a few times with both devices silent for minutes (reads as a machine stall); `rv-ui.mjs` F10 once hit `locator.focus` timeout; `s-api.mjs` step 7a failed once and passed alone.

## 6. sg-tools: what to keep

Worth porting into the repo as behaviour tests:
- `sync-test.mjs` (GM creates, player joins, sheet reaches GM, award and damage reach player).
- `save-compat.mjs` (load, migrate, import, export, restore). Compatibility is no longer required, so rewrite it around the new format.
- `game-check-a.mjs`, `game-check-b.mjs`, `ga-level-hole.mjs` (combat, gates, leveling rules).
- `encounter-compat.mjs`, `fix3-build-doc-room.mjs` (encounter and build rules shared through a room).
- `room/s-api.mjs`, `room/rv-sync.mjs`, `room/rv-ui.mjs`, `room/r-view.mjs`, `room/og-onboard.mjs`, `room/og-gm.mjs` (the room contract and every reviewed bug).
- `custom-check.mjs`, `arena/prefs-leak.mjs`, `qr-check.mjs`, `pwa-check.mjs`.

Keep as tools, not tests: `shots.mjs` (`node shots.mjs <baseUrl> <outDir> [w h]`, outputs in `the repo root-shots/after`, `after-360`, `after-landscape`; existing names must stay), `audit-mobile.mjs` (tap targets, font sizes, overflow at one size; fixed for the new onboarding step but not rerun), `final.sh <baseUrl> <log>` (the whole battery, about 45 commands, well over an hour), `wrap-run.sh` (the 16-command subset that last ran green on the final head).

One-offs, safe to ignore: `fix1*`, `fix2*`, `w1*`, `w2w3*`, `hwa-*`, `hwb-*`, `m1-check`, `m2-*`, `attr-check`, `room-walk*.mjs`, `room/smoke*`, `room/qr-measure.mjs`, everything under `arena*/`, and the brief files.

Stale worktrees, safe to delete, none pushed: `/workspace/room-fix`, `room-fix-sync`, `room-og`, `int-a`, `int-b`, `arena-a`, `arena-b`, `sg-custom`, `sg-ga`, `sg-gb`. Keep `/workspace/sg-main` while mixed tests exist.

## 7. Deferred sync findings

Full list: `lead-report.md` section 9, "Deferred sync findings" (14 items, each with severity, repro, cause). Source reviews: `room/review-sync.md`, `room/review-ui.md`. My priorities:

1. Item 3: any 404 on the room GET evicts the device and saves "room gone". Check `e.reason === 'no such room'`. A proxy 404 during a Railway redeploy would empty every room.
2. Item 4: a GM key answered with 403 turns into a quiet player join. Give it its own error kind.
3. Items 2 and 5: both come from `failing` being set in some failure paths and not others. They disappear if the link is one state machine; do not patch them separately.
4. Item 6: the 20 s limit applies to every request. Unmeasured on slow links.
5. Item 1: make the peek read-only on the server.

Turn each into a test of the phase 3 link reducer.

## 8. From the plan review (`review.md`, verdict PUSHBACK)

the owner may or may not have accepted these; check the phase 3 prompt for his answer before acting.

- Merge and deploy phases 1 and 2 first. The room flow has never run on a real phone and phase 3 rewrites `sync.js`.
- Split phase 3 around phase 4: tests, TypeScript setup, combat reducer, gates; then status scaling; ship; then protocol, link machine, hunter states.
- Model-check the real link reducer with a breadth-first walk in a bun test instead of TLA+ (checks the code, runs in CI, no spec drift).
- Strict TypeScript for the core (state machines, store, protocol, server); leave dense view modules as JS under `allowJs` until a rewrite touches them.
- Serving `.ts` to the browser ends the "works from a static host" mode and touches `sw.js` and the deploy inliner. Make it a decision.
- `@playwright/test` runs under node, not `bun test`. Pushing `.github/workflows` needs a token with `workflow` scope; untested here.
- The version handshake must land before the wire format breaks, and be tested against the real `main` build on `:3100`.
- Keep players' hunters across the save change with a one-way migration at load.
- A monster "down" at full HP is a table feature. `locked` and `removed` belong to the push or membership machine, not the link.
- Decide effect stacking and the default effect source in the combat model, snapshot the source tier when an effect is applied.
- Estimates: phase 3 as written 45 to 65 h of run time, 30 to 40 h with the trims; phase 4 8 to 12 h.

## 9. Open questions

- Did the owner accept the review's order and trims?
- Is `gh` authenticated, and does the token have `workflow` scope?
- How does the Railway deploy build the app (inliner or plain files), and does it use Postgres?
- Gate XP pacing: keep the halved rate or raise it?
- Are there real saves on players' phones worth migrating?
- Nothing has been checked on a real iPhone or Android phone (list in `lead-report.md` section 8).
- The full `final.sh` battery never completed on `e99c2fd`; the three mobile audits are from `b12cdda`.
