# Brief: the last unit, second half (the map's look, the phone test, a last look)

One helper (Opus, heavy-writer), in the main tree. The rules, reading list and "Why" of `docs/agent-handoff/final/brief-final.md` hold unchanged; read it, `brief-map-look.md` and `notes-final.md` (what the first helper did and measured) first. Another helper works in a separate worktree on auras and the map's size (`brief-auras.md`): it owns `src/core/combat/zones.ts` and the fight's reducer; you own `src/views/map.js`, `map-maker.js`'s look and `map-view.ts`'s scene. Keep out of zones.ts.

Steps, a commit after each, notes appended to `notes-final.md` as you go:

1. **The map's look.** `brief-map-look.md` items 1, 2, 3, 4, 5, 8 and 9 (6 and 7 are done). For item 7 the look case passes with the fix taken out: make it a case that fails without the fix. After each item take a shot and look at it; the bar is that a first-time player at 360 px understands the map without a legend. Rerun `feel.e2e.ts` alone at the end; the map's use frame must stay at or under 83 ms worst over twenty runs.
2. **The phone test.** Step 2 of `brief-final.md` as written (`tests/e2e/phone.e2e.ts`, the sweep, fix at the root).
3. **A last look.** Step 3 of `brief-final.md` as written, the map excluded (done in step 1).
4. **Three frames near their limits** (notes-final step 4): the list fight's turn (83.3 ms once, limit 100), a player watching the GM's turn (50 ms, at its limit), the maker's tap (81.4 ms, limit 83). Profile each once and take what is ours, as step 0 did. Also drive the app update's percentage once in a browser test (`pwa.e2e.ts` or `upgrade.e2e.ts`): a page with a waiting worker shows a number that rises to 100.
5. **Close.** Step 5 of `brief-final.md` as written.

If time runs short, the order above is the priority; say exactly what is left. Time: three hours. Reply in at most 250 words: the commit range, each check's last line, what broke and was fixed, what is left.
