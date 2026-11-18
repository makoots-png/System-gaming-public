# Notes: the coin call

Worktree branch `worktree-agent-aeb00fb9f3ead22c2`, from e9a4330.

## Step 1: the machine

`src/core/coin.ts`: `Side`, `Face` (1 or 20), `Ruling`, a branded `RollId` (made only by `rollId`), `isCoinRoll`, `decider`, the `TABLE` of a coin (uncalled, called, landed; events `call` and `land`), `landing`, `landingOf`, `verdict` and `VERDICT_WORDS`, and the list helpers `addCoin`, `stepCoin`, `inAir` with `parseCoin` and `parseCoins`. Chart in `scripts/charts/coin.ts`, walk events in `tests/models/coin-events.ts`.

Choices:

- The notes name three states (no call, called, landed). "No call" is a coin too (`uncalled`): the roll showed its natural and the player has not picked, so a reload keeps the "Heads or tails?" question.
- A roll's kind is `check` (a stat check), `die` (a Dice view button or expression) or `other` (a death save, an extraction, the fight's d20, anything a rule rolls). `other` is the default in `dice.roll`, so a caller that says nothing never calls the coin. A `die` roll calls it only when it is one d20 and flat numbers.
- `decider`: a player's phone in a room waits for the GM; alone, or on the GM's own phone, the coin flips (nobody else is there to rule).
- Model-the-domain changed one choice: one `Coin` type and one table serve both phones. The player's phone keeps its own coins, the GM's phone keeps the calls it was sent, in two lists, so a phone that was a player and later becomes a GM never shows its own coin as a call to answer.
- Type-system-discipline: the roll id is branded and parsed once (`rollId`); a face is `1 | 20`, so `verdict` has no other case.

## Step 3: the player's side

Taken over after a machine restart. The last helper's uncommitted work was sound and kept: the save's `coins` and `calls` with their parser line and test, `rollDie` and `flip` in `src/edge/roll.ts`, and the coin's moves in `motion.ts`. One change to the moves: the landing's first frame was overwritten by the spin's computed matrix (`play` takes a move over from where it is), so the browser blended two matrices and the coin came down with no turn. Both moves now have `from: null` and every frame is `translateY() rotateY()`, so the angle itself is animated.

`src/views/coin.js` (new, after `uses` in `MODULES`) is the one writer of `coins` and `calls` (a lint test in `tests/lint.test.ts` holds it). `app.api.coin`: `rolled`, `landed`, `of`.

Every place a check's d20 is rolled, and what each does now:

- `dice.roll` (src/views/dice.js) is the one roller of the tray. It takes `kind` and `hid`; a logged roll is offered to `coin.rolled`, which asks `isCoinRoll`. The default kind is `other`, so a caller that says nothing never calls the coin.
- `dice.check` (the Dice view's quick checks and the sheet's stat buttons in hunter.js): kind `check`.
- The Dice view's and the quick sheet's die buttons and expression: kind `die` (only one d20 with flat numbers calls it).
- The death save (hunter.js), the extraction (shadows.js) and the table's "Roll d20" (table.js, shown only in the GM's fight): kind `other`, unchanged. table.js is not touched.
- The fight's reaction d20 and openings are rolled by roll.ts for the fight; never offered.

"In a running fight": this phone's fight is running and has a row for the hunter (`combat.rowFor`), or the room's fight doc has the hunter's row (`uses.onTable`).

Where the state lives: in the save (`coins`, `calls`), not derived from the room's events. A player alone has no room, a room's events are cut to the newest by the server, and a phone that leaves a room still has to show its coin. A field with a parser line (`parseCoins`) and a case in `tests/save.test.ts`.

A natural that calls the coin no longer toasts "Critical hit!" in the tray, and the tray's flag reads the coin's words (`coinWords`) instead; the sheet's check toast says "(natural 20)". `dice.js` now rolls its dice with `rollDie` from roll.ts, still read from `Math.random` at each roll so the browser tests seed it as before; it left the lint test's list of views that roll their own.

## Step 4: the GM's side

In `src/views/coin.js`. A `coinCall` from `sync:event` on the GM's phone is kept once per roll (`takeCall`) in the save's `calls`, notified when the page is hidden (`notifyHidden`, tagged with the event id) and asked in a System window: "Asha called Heads", the roll's label, "Natural 20", the side called, and Right, Wrong, Let the coin decide. No button is primary: none of the three is the action the window exists for.

- One window at a time, the oldest call in the air first (`askNext`, on every store change and at start). A window closed without an answer (Escape, a tap on the backdrop) opens again at once, because ui.js lets every window be dismissed and the brief says it stays until answered. A reload opens it again from the save.
- The ruling: `landingOf(call, ruling, flip())` and, in one store update, the call landed and the session log line "Ruled Right: the coin landed Heads." Then `coinLand` with the roll and the side. A flip is rolled for every ruling, so Right and Wrong do the same work as the coin.
- A send the room did not take is sent again after the next poll (`sync:sheets`, which sync.ts emits after each poll it applies). A new player page sends each call in the air again; the GM's phone takes a call it holds as nothing, and answers a call it already landed with the same landing (a lost landing). This is what `tests/models/room-world.ts` models (`callOne`, `resendCoins`).

How the secrecy is held:

- `coinLand` is `{ eid, roll, side }` (protocol.ts reads no other field) and the same message is made for every ruling.
- The ruling is written only in the GM's session log, which never leaves the GM's phone (no room doc carries the log).
- The player's phone stores the coin as its table makes it (`id, who, what, face, at, call, side`) and logs "The coin landed Heads: Critical success." for any landing.
- Timing: a flip on the GM's phone is a local `crypto.getRandomValues`, rolled for Right and Wrong too, so no path is slower. The only timing is the GM's own tap.
- A coin never lands by a timer (coin-notes: a timer's ruling would be a lie about who ruled).

## Step 5: browser tests

`tests/e2e/coin.e2e.ts`, seven tests, passed on the first run. The die is seeded the way the tests already seed the tray: `Math.random` answers 0.99 (a 20) or 0 (a 1) during the tap of the Dice view's STR check. The flip is seeded through `crypto.getRandomValues`, as `table-turn.e2e.ts` seeds the fight's dice. A test of a ruling sets the GM's flip to the side the ruling must not give, so a phone that flipped instead of ruling fails it. No new seam.

## Step 6: checks and docs

`AGENTS.md`: a "Where things live" row for the coin call, the coin in the list of charted machines, and the coin calls in the list of one-writer rules. `docs/agent-handoff/copy-tasks.md`: a section with the new words. The last test of `coin.e2e.ts` also checks the card at 360 px (Heads and Tails side by side, each at least 44 px tall), so no step was added to `look.e2e.ts` or `scripts/ui-shots.ts`; the lead may want a ui-shots step for the card.

`docs/dependency-map.md` was regenerated in the worktree (`bun run deps -- --write`) so `bun run test` could pass, and is left uncommitted as the brief asks.

Files outside the brief's list that I touched: `src/views/hunter.js` (one line, the sheet's check toast), `src/app.js` (the module), `src/core/api.ts`, `tests/lint.test.ts` (the coin's one-writer rule; dice.js left the list of views that roll their own). Nothing in combat.js, table.js, maker.js, ui.js, fight-view.ts or feel.e2e.ts.

Open points for the lead:

- The coin card is fixed above the bottom nav, at z-index 46 (over the dice sheet at 45, under windows at 50). It is not modal: the player can keep playing while a coin is in the air.
- A player who leaves the room with a coin in the air keeps it in the air; it is sent again only while the phone is in a room. A coin never lands by a timer.
- A GM's own hunters (on the GM's phone) flip at once (`decider`), as do the checks of a phone alone in GM mode. The GM's Dice view rolls with no hunter (`who: 'GM'`) do not call the coin.
- A closed GM window opens again at once; there is no way to put a call aside. If the owner wants one, it is a "Later" button that stops `askNext` until the next change.
- The roll feed the GM sees (`roll`, table.js) still marks the natural as a crit. The GM knows the face anyway.

Checks on the last commit's tree: `bun run test` 2257 pass, 0 fail (with the map regenerated); `coin.e2e.ts` 7 passed, `room-sync.e2e.ts` 1 passed, `table-session.e2e.ts` 7 passed, `look.e2e.ts` 9 passed (it covers the quick dice sheet), `character.e2e.ts` 20 passed (its death saves roll through the tray's new `rollDie`). Every file passed on its first run.
