# combat-turns.e2e.ts notes
- 7 tests ported from game-check-b checks 5, 6a, 6b, 7, 8, 9, 11. All pass (3 runs in a row, 7 passed ~34s). No fixme.
- helpers.ts: appended `startGoblinDenFight(page, hunters)`. It sets e.turn/e.round/e.log and combatant init directly in setup; update that one place when the turn tracker is rewritten.
- Still read from the store: Brakk's hp, combatant ids/xp, bestiary kill count (codex kills, test 8). Everything else is on screen.
- Roll line text has no space between "dis" and the name, so the check uses /\bdis(?![a-z])/ not /\bdis\b/.
- First full run had 6a fail once, then pass on three later runs (box was heavily loaded, runs took 2+ min). Cause not seen; watch for flake.
- tsc: errors currently come from another helper's gates-quests-dailies.e2e.ts (in progress), none from my files.
