# The map's look: what the lead saw (do this as step 3a of brief-final.md, before the rest of step 3)

the owner asked "Is the map clean, intuitive, and well done?" The lead looked at the 390 GM shot, the 360 player shot, the 1280 aiming shot and the map maker. The structure is right. These are not yet good enough; fix each in `map.js`, `map-maker.js` or `map-view.ts` (a number of the scene in core, pixels in the view), look again, and say in the notes what changed.

1. **The map opens framed on nothing.** Tokens sit in two corners with most of the screen empty floor. On open, and on the double-tap fit, frame the bodies and the terrain that matters (walls, zones) with a margin, at a zoom where a token is at least 44 px, not the whole grid.
2. **A token is two letters.** "IW", "CA", "CB" tell a new player nothing. Show the name under the token when the zoom allows (a short label, the full name on select), keep sides readable without colour alone (shape already differs: keep that), and make the body whose turn it is unmistakable at a glance.
3. **The fog is dark on dark.** On the player's phone the unseen part is a slightly darker stair-step that reads as a rendering fault. Make seen-but-not-visible and never-seen two clearly different, soft-edged treatments (the outline is already computed), so "you cannot see there" is obvious without a legend.
4. **A zone is an unlabeled hatch.** Give a zone its name on the ground at a readable zoom and a tint by what it does (harms, helps, hinders); a tap on it says what it does and how long is left.
5. **Walls and cover.** Check they read as solid and as partial at phone size in the fight (in the maker a wall is a loud flat cyan bar and a start tile a dull red block; give the maker the same look as the fight so what the GM paints is what the table sees, with starts marked as starts by side).
6. **"Paint" and "Grid" look like captions.** They are controls: draw them as `.icon-btn` or small buttons at 44 px with a pressed state.
7. **Toasts cover the map's dock and hotbar.** During a fight in Map view a combat toast must not sit on Use, Cancel or the hotbar: the fight's own news belongs in the fight's log line over the map (one line, latest), not in stacked windows at the bottom.
8. **The player's first screen.** At 360 the hotbar is below the fold under the map. The map plus the hotbar must fit the first screen in portrait without a scroll (size the map to the space left).
9. **The intent line** (dashed, monster to target) is good; make sure its end says what is coming when revealed and that two lines do not hide each other.

Each is a look item: prove it with a shot you look at and, where a size is promised (44 px, fits the first screen, no toast over the dock), a case in `tests/e2e/look.e2e.ts` or `battle-map.e2e.ts`. Rerun the feel file after.
