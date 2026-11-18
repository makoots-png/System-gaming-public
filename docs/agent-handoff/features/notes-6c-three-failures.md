# Notes: three browser tests that failed once in the push of feature 6

Goal: three browser tests failed once each in the hook's CI on 182dabb. For each, name the cause from the kept traces, reproduce it by hand, and fix it where it starts. The smallest change expected: one fix per cause, in the app if the app is wrong, in the test only where the trace and a hand run show the test's own race.

Evidence: the lead's `fail49/` folder (read-only), unpacked into my scratchpad `helper7/`. A trace's snapshots are diffs; `helper7/snap.py` renders one by name (the Playwright renderer's node references, rewritten in Python). Hand runs use a scratch Playwright config (`helper7/e2e/pw.config.ts`) that imports `tests/e2e/helpers.ts` by path, so nothing scratch lands in the repo.

Principles read and applied: `principle-fix-root-causes` (reproduce first; ask whether the state is legitimate before choosing where to fix).

## 1. `map-extras.e2e.ts:286`, the hotbar hold

Cause: the test's own race. `kitsFight` adds Parry to the player's hunter with `store.update`; the app redraws on the next animation frame (`scheduleUpdate`, app.js). The test measured the first slot's box before that frame. With Strike alone, the slots share the width, so Strike's centre was (195, 736.5). The frame then drew Strike, Parry and More, and the press at (195, 736.5) landed on Parry, the middle slot. The app showed Parry's detail, which is the slot under the finger. The test then read the first slot's name, Strike.

Evidence from the trace (player is `1-trace`):
- `after@call@14526` (760057 ms, the `boundingBox` call): `data-sig="ab:attack"`, one slot.
- `after@call@14532` (760067 ms, the mouse move): `data-sig="ab:attack,ab:parry,more"`.
- The player made no request between 759749 and 762756 ms, so the redraw came from its own setup write at 760045 ms, not from the room.
- `mouseMove {x: 195, y: 736.5}`: the centre of one slot that fills the bar.

Why it began after the look-fixes unit: before it, slots had a fixed width and sat at the left, so the first slot's centre was the same with one slot or three. Since the slots share the width, a slot's place depends on how many there are. The earlier failure in that unit (no trace) fits this cause; that is inferred, not shown.

Reproduced by hand (`helper7/e2e/hold.e2e.ts`, case "repro"): the setup write and the box read in one task give `{"name":"Strike","x":195,"y":736.5,"slots":1}`; after the frame the first slot's centre is x 81 with 3 slots; a press at (195, 736.5) opens Parry's detail while the first slot reads Strike. Every run gives this.

Is the app wrong under a finger? Probed by hand (case "probe"): press Strike, add Parry while the finger is down. After the redraw the finger is over Parry, and the detail that opens is Strike's. The gesture keeps the control's key from the press (`press.control` in `gesture.ts`), so a slot that moves under a finger does not change what the hold or the tap picks. No app change.

Fix: `kitsFight` waits until the player's bar shows the Parry slot it added (`[data-arm="parry"]`) before it hands the fight to a test. That is the setup's end as a player sees it. Sweep: every `boundingBox()` in `tests/e2e` (24); only this one measures right after a setup write that changes what it measures.

## 2 and 3. `reward-room.e2e.ts:130` and `rewards.e2e.ts:25`, REWARD RECEIVED never shown

One cause for both. The two tests ran side by side across midnight UTC (the server's `now` runs from 23:59:55 to 00:00:17 in both request logs), and the box's zone is UTC with the default reset hour 0. The player's daily rolled over in the middle of the test: its hunter, made at 23:59:56, had not done the day's daily, so the rollover gave it the missed-daily penalty and its PENALTY window. The award landed, and its REWARD RECEIVED window waited behind the PENALTY window, as the window queue in `ui.js` says it should. The tests wait only for the reward window.

Evidence from the traces:
- The award reached the room and the player's poll returned it. rewards: POST `events` answered `{"seq":1}` at 975833 ms; the player's `after=0` poll at 976803 ms carried the award; its sheet PUT at 979814 ms already held Gatebreaker and Hasted. reward-room: the second POST answered 200 at 197647 ms; the player's sheet in the room shows `xp` 25 from 202647 ms.
- From those same sheets on, the player's hunter holds a quest `Penalty Zone: Survive for 4 hours`.
- The player's last snapshot in each trace: the top window is `PENALTY` ("You have failed to complete the Daily Quest."), with `Confirm all (1)`, the one window queued behind it.
- No stall: both phones polled every 5 s through the test (rewards: player 976803, 981814, 986819; GM 980066, 985075, 990079), and every request took 1 to 6 ms.
- Feature 6 is not on the path: the award goes `post`, the outbox, the room, the player's poll, the `award` applier, `grant`, `hunter.granted`. No die is drawn and no fight runs, so `roll.ts`, `draws.ts` and `combat.js` are not called.

Reproduced by hand (`helper7/e2e/award.e2e.ts`): the rewards test's room, then on the player's phone the stored day keys moved back one day (the state the reset leaves: the stored day is behind today's), then the GM's award. With the day turned: the award lands, the top window is PENALTY and `Confirm all (1)`; the reward window is not visible. Without: the top window is REWARD RECEIVED. Each ran once and gave this.

Cause, in one sentence: every browser phone read local time in the box's own zone, so a test's outcome depended on the hour the box ran it, and a test that ran across the reset hour met the day's rollover. The app did what its rule says; the test did not own the time of day it ran in.

Fix: `device()` in `tests/e2e/helpers.ts` opens every phone of a test in one zone where the test's start is noon (`noonZone`: `Etc/GMT-12` to `Etc/GMT+11`, `UTC` at 12 UTC). The next midnight is then at least eleven hours away, and the local date is the UTC date. A phone pinned to a time (`pinTo`) reads it in UTC, as on the box before, so a pinned test's local time is its own and not the hour's. A test about the day's clock names its zone (`DeviceOptions.timezoneId`): the dailies tests opened New York by a CDP call after the page was made, which Chromium refuses once the context has a zone ("Timezone override is already in effect", tried by hand), so they now open their phones with `newYorkPhone(device, label, start)`. Checked by hand (`helper7/e2e/zones.e2e.ts`): for each hour of a UTC day, a test that starts at h:59:50 reads 12:59:50 on the same date in Chromium.

Left for the lead (a product rule, not changed): a hunter made seconds before the reset gets the missed-daily PENALTY at the reset. The rule (`rollover`, `missedDays`) counts the day it was made in. A player who starts at 23:59 meets this.

Residual: `save.e2e.ts:184` builds a save in the test's own process with `new Date()`, so its stored day is the box's local date. On a box whose zone is not UTC, near its midnight, that date can differ from the phone's (the UTC date). On the CI box (UTC) they agree.

## Close

- `bun run test` (typecheck, then bun test): `Ran 3537 tests across 93 files.`, 0 fail.
- Every browser file one at a time except `feel.e2e.ts`, `E2E_PORT=3260`: all passed; no `failed` or `flaky` line (the lines that hold the word are test names).
- `map-extras.e2e.ts`, `reward-room.e2e.ts` and `rewards.e2e.ts` five times each: `10 passed`, `3 passed`, `5 passed` every time.
- No `bun server.ts` left running.

Principles: `principle-fix-root-causes` decided both fixes. In 1 it led to probing the app under a finger before blaming the test. In 2 and 3 it ruled out a guard in the tests (dismissing a PENALTY window before waiting) and put the fix where the hidden input comes in, the fixture that opens every phone.
