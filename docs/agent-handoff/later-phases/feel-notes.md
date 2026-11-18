# Feel: motion, loading and responsiveness (the owner, Nov 13, in the rework lead's session)

## What the owner said

"I want top tier animations. I love percentages when things are loading. I don't want them to be laggy, this site should not be laggy. Everything should be satisfying on UI. Nothing over the top, but I want to emphasize FEEL. Do your best on design I'm told you have good taste and I want you to show me it. Remember that everything must be architecturally sound and in line with poteto's teachings"

This replaces the lead's earlier line under "The map" in `combat-rework-notes.md`, "no animation beyond a token sliding and a splash flashing". Restraint stays ("nothing over the top"); the bar for quality goes up.

The owner, after hearing the plan below and the particles: "Good. I trust you with design decisions."

## The lead's answer (what gets built unless he says otherwise)

**The rule for every motion: it says what just happened, it never makes anyone wait, and it never drops a frame.**

- **One motion system, not animations per screen.** Motion tokens in `public/app.css` (three durations, about 120, 200 and 320 ms; two easings; one spring-like overshoot for a pop) and one module, `src/views/motion.ts`, with a small set of named moves a view calls: enter, leave, press, pop, shake, flash, slide along a path, count a number to its new value, fill a bar. A view never writes a duration or a keyframe of its own. A lint test holds that: no `transition` or `animation` with a literal time outside the tokens, no `setTimeout` used to wait for an animation.
- **Never laggy, held by a test.** Only `transform` and `opacity` are animated (the compositor does them; layout does not run). Input is never blocked: a tap during an animation works and the animation yields. `prefers-reduced-motion` turns moves into cuts. A Playwright check with the CPU slowed four times plays a fight turn, opens a maker and scrolls the sheet, and fails if any frame is longer than 50 ms or a tap takes more than 100 ms to show a response. The numbers and their reasons go beside the test (explain-the-number). No animation library: the dependency rule stands, and CSS with the Web Animations API is enough.
- **Percentages only where something real is being counted.** the owner loves a percentage while things load. The app is local-first, so little truly loads; a made-up progress bar is a lie the player can feel. Real ones: the app update downloading (the service worker knows bytes), a campaign file being read or written, a phone catching up on a room's events (n of m), a channel charging (charge of max), a stagger bar, XP to the next level ticking up as a percentage when XP lands, HP as the bar drains. Where the app cannot know a fraction (waiting on the room), it shows what it is waiting for in words and a quiet pulse, not a number.
- **Where the feel goes, in the order a player meets it**: a press that answers under the thumb (a slight sink, at once); a window that rises and settles; a toast that slides; HP that drains with a pale trail behind it so the size of the hit is seen; the damage number counting to its value; "Your turn" arriving once, clearly, then still; the turn order sliding as time moves; a die that tumbles its numerals for under half a second and lands; a status chip that pops on and fades off; XP filling its bar with the percentage counting, and a level-up that takes its moment. On the map: a token sliding along its path, the reach and splash areas breathing in, a blast's ring expanding to its radius, a zone settling onto the ground.
- **Not built unless he asks**: sound; screen shake on every hit (one short shake for a crit or a hunter going down); particle effects; anything that plays longer than about 400 ms outside a level-up or a fight's end.
- **Order of work.** The motion system and the frame test come first, right after the wiring wave lands, so the map and the extras are built on it from their first line (scaffold first). The screens that already exist get it in one pass then. A last feel pass comes before the phone test, on the whole product. No before and after clips are made for him (his word, Nov 13); a screen is looked at only when judging it needs eyes.
- **Architecture (his reminder).** Motion is a view concern only: core and the fight know nothing of it. The fight's effects (`moved`, `staggered`, `channel`, outcomes) are the events a view animates from, so an animation can never change a result or delay a command. One home (`motion.ts`), tokens as the single source of every time, a lint test and a frame test as the guards.

## Particles (his next message)

"Idk can you tastefully make particles?" Yes, with a budget that keeps them tasteful and fast. This moves particles out of "not built unless he asks".

- **Only on earned moments**: a crit, a kill, a level-up, a channel released, a shadow extracted, a boss staggered. Never on an ordinary hit, a button or a screen change. If everything sparkles nothing does.
- **Each one means something**: embers rise off a Burning target for a beat when it ticks; shards break away from a monster that goes down; blue motes gather into a channel as it charges and burst when it fires; a level-up draws the System's blue light up the sheet.
- **A budget, held by the frame test**: at most about 24 particles in a burst, gone in 600 ms, drawn on one pooled layer (a single canvas or transformed elements reused from a pool, never created per burst), `transform` and `opacity` only. `prefers-reduced-motion` removes them. The frame test plays a crit and a kill with the CPU slowed four times.
- **One home**: a `burst(kind, at)` move in `src/views/motion.ts`, with the kinds in one table (colour, count, spread, life), so a new one is a row.

## More info on anything (the owner, Nov 14)

He asked "For all things how does it currently display what each thing does?" and then: "Ok maybe there should be a drop down option where it shows more info? Only necessary stuff. Push back if this is dumb".

The lead's answer, to build as one unit after the kit blocks' sentences exist: one pattern everywhere, two levels. A thing always shows its one line (name and the one fact that matters now). A tap on it opens its detail in place: the sentences core already writes (`describeStatus`, `describeAbility`, `describeItem`, a zone's ops), nothing else. One component in the views (`app.api.detail` or the like), used by a status chip, an ability on the hotbar (press and hold, since a tap picks it), an item, a zone, a monster's ability, and a number on the sheet (its breakdown from `derive.ts`: base, gear, statuses). No second window, no scrolling list of everything; closed by default; what is open is a device pref only where it helps.
