# The lead's look at feature 6 on a screen (Nov 17)

A throwaway Playwright script at 390 px (not committed): the box idle, running, done, its detail, stale, and in the Fight tools of a running fight. The layout holds at every state: the bar, its percentage, the count and Stop on one line; the line and its detail inside the page's width; the stale words above a dimmed line.

Findings, for the solo helper's engine step (feature 2 reads the same numbers):

1. **"Dead" in a fight the party wins.** Three hunters against three goblins read "The party wins 100% of 100 fights" and "Brakk Ironhide: down in 43%, dead in 20%". Cause: `playDead` (`play.ts`) rolls a downed hunter's death saves to their end after the fight, alone, whatever the outcome. In a fight the party won, allies stand beside the hunter and the GM's Stabilize or a heal is one tap, so 20% dead overstates what a table would see and a GM will mistrust the line. In a lost fight, or alone on a solo run, nobody helps and the saves to the end are right. To settle in the notes, variants weighed: a won fight leaves a downed hunter down and not dead (dead is counted only when the side lost or stalled); or the words say what was rolled ("dies if nobody reaches them"). The first matches the table.
2. **Fatigue reads without its scale.** "Ends with 19 to 45 of 45 HP, 10 of 10 mana, 30 to 48 fatigue": HP and mana say "of", fatigue does not, so a reader cannot tell left from spent. Give it the same form as the sheet's fatigue.
3. Mana never moved for the starter party (10 of 10, 14 of 14 in every fight). Check whether the starter hunters hold any ability that costs mana and `sensible` never picks it, or hold none: say which in the notes.
