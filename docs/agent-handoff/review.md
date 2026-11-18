**Short version:** the direction is sound, but I'd change the order, trim three things, and ship phases 1–2 first. I reviewed against the brief's summary of poteto's thesis; I have not read the posts or the newly added skills.

## What I'd change

1. **Merge and deploy phases 1–2 before phase 3 starts.** The room flow has never run on a real phone, and phase 3 rewrites `sync.js` on top of it. It also keeps the PR reviewable; there are 54 commits waiting already.
2. **Split phase 3 around phase 4.** Status scaling only needs the committed tests, the TypeScript setup and the combat reducer. Do those, then phase 4, ship, then the rest. That gets you the feature you actually asked for days sooner.
3. **Skip TLA+; model-check the real reducer instead.** Once the link is a pure `reduce(state, event)`, a bun test can walk every event interleaving to depth N and assert the invariants. That checks the code itself, runs in CI, needs no Java and cannot drift from a hand-written spec. Combat is sequential and needs no formal model.
4. **Strict TypeScript for the core only.** That means the state machines, store, protocol and server. Forcing the dense DOM view modules (`gm.js`, `room.js`, `hunter.js`) through `strict` + `noUncheckedIndexedAccess` is many hours of churn with real regression risk and little payoff. Leave them as JS under `allowJs` until a rewrite touches them.
5. **Serving `.ts` to the browser ends the "works from a static host with no server" mode.** The server would transpile on request, and `sw.js` and the Railway inliner need checking. This is fine if you accept the loss, but it should be a decision, not a side effect.
6. **Don't port all 70 scripts.** Most are one-off fix checks tied to implementation, and almost all are browser scripts because the logic is tangled with the DOM. Port about 15 behaviour checks as the safety net; pure tests arrive with each reducer.
7. **`@playwright/test` runs under node, not `bun test`.** There will be two runners. Pushing `.github/workflows` also needs a token with `workflow` scope, which may fail here.
8. **Put CI and the version handshake early, not last.** Old cached clients will meet a server that rejects their messages, so the handshake must land before the wire format breaks. Test it with the real `main` build and guard against reload loops.
9. **Keep players' hunters across the save change.** A one-way migration at load is cheap and is the "parse at boundaries" idea anyway. Drop in-flight encounters and rooms freely.
10. **Design details:**
    - A monster "Down" at full HP is a table feature (fled, surrendered); keep it GM-settable.
    - `locked` and `removed` belong to the push/membership machine, not the link.
    - For gates, try "one payer" before building a payout ledger.
    - Use `readonly` types in place of regex lint where possible.
11. **Decide effect stacking and the default source in the combat model, not in phase 4.** The state shape depends on it. Snapshot the source tier when the effect is applied, and default the source to the current turn's combatant so the GM gets no extra taps.
12. **Run the copy pass after phases 3–4.** Otherwise it conflicts with every rewritten file.
13. **Fold the 14 deferred sync findings into the link-machine tests.**

Phase 4's brief itself is good. I'd add one small simulation test comparing a status build with a direct-damage build at three tiers.

## Suggested order

1. Ship phases 1–2.
2. Safety-net tests and CI.
3. TypeScript setup, store types, single GM role.
4. Combat reducer.
5. Gates.
6. Phase 4, then ship.
7. Protocol types, server validation, handshake.
8. Sync link machine.
9. Hunter down/dying, penalty, job chain.
10. `AGENTS.md` and report.

## Estimates (run time, rough, based on phase 2's pace)

- **Phase 3 as written:** 45–65 h, plus 20–30% for stream cut-offs.
- **Phase 3 with the trims above:** 30–40 h, of which about 12–15 h comes before phase 4.
- **Phase 4:** 8–12 h.
- **Verify, PR, deploy:** 2–3 h per ship.

VERDICT: PUSHBACK
