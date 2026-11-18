# Notes: generated state charts (M8, unit 2)

Principles that changed a choice:
- principle-build-the-lever: the charts come from a walker (`scripts/statecharts.ts`), not by hand, and the test reruns it.
- principle-minimize-reader-load: the model alphabets moved into `tests/models/` so the test and the chart read one list. No second alphabet.
- principle-experience-first: after rendering, I dropped nested parent boxes that Mermaid drew wrong (see step 5).

## Shared alphabets

- `tests/models/sync-world.ts`: the world, `TAPS`, `REPLIES`, `moves`, `key`, `BOOTS` from `tests/sync-model.test.ts`. A `Move` now also carries its `events`. The test keeps its rules and search, same counts (12716 states, 304484 transitions).
- `tests/models/fight-play.ts`: `rng`, `PARTY`, `world`, `randomCommand`, `SEEDS`, `lengthOf` from `tests/encounter-model.test.ts`.
- `tests/models/gate-events.ts`: `den`, `fields`, `WALK_EVENTS` from `tests/gate.test.ts`.

## Step 5: what I changed after looking at each chart (Mermaid 11.17.2, in a scratch folder outside the repo, Chromium at /opt/pw-browsers)

- All charts: Mermaid's default layout pulls a state out of its box when an arrow crosses into the box from outside (Live and Ready to join were drawn outside their boxes; a composite arrow even threw "No such shape: roundedWithTitle"). The walker now draws an arrow that crosses a box's edge at the box itself, and declares each arrow inside the box that holds both ends. That replaced a cleverer collapse rule.
- Gate: parent boxes "Still to be cleared" and "Finished" rendered Clear and Close labels on top of each other. The gate chart is flat now (5 states, 11 arrows).
- Link: three levels of boxes were unreadable. Now "Opening or joining a room" is one state, only "Out of a room" and "In a room" are boxes, and the update arrow is drawn from In a room only (it was 4 to 5 arrows).
- Link and push: "Changes to send" was drawn outside the push's box because the start arrow pointed into the box; starts now point at the box. "Play as another hunter" (4 arrows) is hidden, and "it" in two labels became "the room".
- Fight: nothing changed after looking; 3 states, 6 arrows.

## Things for the lead

- The fight's random play never removes every combatant from a running fight, so "Fighting -> Building the encounter" (the reducer's `remove` of the last one) is not on the chart, and the model test's invariants never see that step either. A longer play or a targeted seed would cover it; I did not change the alphabet.
- No machine exports a runtime list of its states except the gate (`GATE_STATUSES`). The link, push and fight views list them in a record keyed by the union (`LinkAt`, `PushAt`, `Encounter['phase']`), which makes a new state fail the typecheck. A `LINK_STATES` array in `link.ts` would be the cleaner source.
- The link model lets "No room server" tap Create or Join. The chart shows it because the reducer allows it.
- Hidden steps are named under each chart in the doc.

## Log

- Commit 1: shared model modules, the walker, the views, `bun run charts`.
- Commit 2 (ab9d2d7): docs/state-machines.md and tests/statecharts.test.ts.
- Commit 3 (0d2a959): AGENTS.md section and recipe steps, these notes.
