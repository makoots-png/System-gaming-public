# Sync stall investigation (bug 2)

Tools: docs/agent-handoff/p3/stall/ (srv.ts = instrumented server wrapper on :3299, loop.mjs = two-phone loop with
page-side fetch/timer/visibility/SW instrumentation + context-level request events, beat.sh = box heartbeat).

## First observation (loop 1 of a 2-loop trial, 20:35)
- GM card arrived 2.6 s after join, then for 512 s NOTHING happened anywhere:
  - both renderers logged `MAIN-THREAD-GAP 512536` / `512526` (a 500 ms setInterval inside each page did not fire for 512 s),
  - all page timers fired late by ~512 s at the same instant (TIMEOUT-LATE, INTERVAL-LATE),
  - the Node test driver's next step (`page.evaluate(go status)` + fill) also only completed at 521 s,
  - the server on :3299 received no request for 513 s, then answered the next one in ~1 ms.
- So the stall is not a hung fetch, not pollP, not visibility, not push backoff: the page JS itself was not running.
  Both phones (two separate renderer processes) froze together.

## Conclusion (lead, Nov 12 01:10Z)
The helper's session ended before it wrote a conclusion. Its heartbeat (`beat.sh`, a plain shell loop that logs when 0.5 s sleeps take over 2 s) kept running and recorded nine gaps between 20:50 and 22:02 local (23:50Z to 01:02Z): 204 s, 393 s, 209 s, 720 s, 186 s, 731 s, 179 s, 265 s and 1071 s, with load average under 2 each time. A shell loop that stops for minutes at low load means the whole box is paused, not the app. Together with the first observation (both renderers, the node test driver and the server all stopped for 512 s and resumed at the same instant) this settles bug 2: it is the box freezing, not sync.js. No app change is needed for it.

What follows from it:
- A browser test that spans a freeze fails on a timeout through no fault of the code. The local CI script runs a heartbeat next to Playwright and reruns failed tests only when the heartbeat saw a gap during the run.
- The "API stream cut-offs" and helpers that seem to hang for an hour are probably the same freezes seen from the other side. Helper wall times in this session are not a measure of helper speed.
- The waits that helpers widened to 30 to 45 s do not help against a freeze of minutes and can go back to the default.
