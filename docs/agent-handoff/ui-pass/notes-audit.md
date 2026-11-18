# Notes: the UI and UX audit

## Step 1, the script

`scripts/ui-shots.ts` runs two passes, each a GM and a player in one room on a server the caller starts.

- Pass 1: the GM at 1280 by 800 with a mouse (`gm-1280-*`), and the player on a 360 by 780 touch phone with the iPhone user agent (`player-360-*`). Only this pass shoots the player.
- Pass 2: the same GM screens at 390 by 844 with touch (`gm-390-*`). Its player only joins, takes the award and redeems the boon so the GM has a use to see.

Every shot is the screen at `deviceScaleFactor: 1`. Animations and transitions are off by a style added at each load, and Math.random is seeded per phone.

Three things I learned while making it run:

- Playwright's `page.clock.setFixedTime` also fakes `performance`, so the navigation entry loses the server's `Server-Timing: hunter-api` tag and the app decides it has no room server (no Create room button). The script replaces `Date` in an init script instead: it starts at 2026-11-13 18:30 UTC on each load and runs from there.
- One seed for both phones gave both the same device id (`deviceId()` draws from Math.random), and the player ignored every GM event as its own. The seed is now taken from the phone's file prefix.
- A defeated monster sends "MONSTER INFO UNLOCKED" to the player a few seconds later. The script waits for it before it taps on the player's sheet.

A step whose selector is missing is printed as FAILED, its shots are skipped but their numbers are kept (so the other names do not shift), and the script exits 1 at the end. `--debug DIR` writes a screenshot of each failed step and prints what the player's hunter holds after the award, the quests and the fight.

What the script does not reach, and why:

- The player's Shadows view: it only shows for a GM or a hunter whose job can extract. The GM's Shadows view is shot (`gm-*-38-shadows`).
- The Workshop under More for a player: GM only.
- A toast in the GM's makers: saving a maker shows no toast. Toasts are in `player-360-04-status-live-room` ("Joined room"), `gm-*-31-gm-view-use-toast` and `player-360-09-sheet-boon`.
- Desktop has no More menu; `gm-1280-41-more-menu-not-shown` is the screen at that point.
- A status window "opened scrolled down in landscape" (handoff section 5) needs a landscape phone; the script has none. The status dialog is shot at 390 and 1280.
- The dying, dead and Penalized states are set through the store (`shot-setup`), not reached by play, because play would take many taps of no interest to the audit.

### Two runs

Two runs against `PORT=3261 bun server.ts` wrote the same 117 file names, both exit 0. 66 of the 117 files differ in bytes. The cause is the room code: the server draws a new one each run, and it is in the header pill of every GM screen after the room is made and every player screen in the room (0.3 to 1.4 per cent of pixels, the pill and the Room view's code and QR). The Share code differs because it holds new ids. One file differed for a second reason: the skill maker was shot before its last row settled, so its scroll position moved (11 per cent). It now waits a frame and scrolls to the preview as the other makers do. Screens before the room exists (onboarding, the GM view without a room) are byte for byte the same; the player's Room view after leaving still names the last room, so it differs too.

## Step 2, the before set

`bun scripts/ui-shots.ts --url http://localhost:3261 --out docs/agent-handoff/ui-pass/before` wrote 117 images (13 MB), exit 0.

## Step 3, looking

I read about 35 of the 117 images, those of the makers, the Workshop, the sheet, quests, the fight on both sides, the Award form, the More menu and the desktop views, and the views' code for what an image cannot show. The rest (gates, bestiary, data, room, device, rules at both sizes) I looked at only where a finding needed them. A later pass could read `gm-*-18` to `-21` and `-35` to `-40` and `player-360-22` to `-28` for findings of their own.

Artefacts of the script, not findings: a toast often shows in several shots in a row because the script moves faster than the toast's 3.2 s; the first tap-target measure of the item and enemy makers read 40 px because the window was still in its opening scale.

Principle that changed a choice: `principle-build-the-lever`. The measurements are a throwaway script (tap targets and input fonts per screen) rather than reading CSS by hand; it showed the phase 1 touch rules hold everywhere, so the audit spends no lines on tap sizes.
