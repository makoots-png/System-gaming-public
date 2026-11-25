# The Hunter System

A Solo Leveling-inspired, system-based D&D hybrid for a GM and their players. Blue System windows, daily quests and penalties, ranks E to S, gates and dungeons, levelling and stat allocation, skills, shadows and loot. Built for phones at the table. No runtime dependencies and no CDN: Bun bundles the app when the server starts.

## GM quick start

1. Open the site. First launch shows the System welcome: choose **I'm the GM**, then **Load starter campaign** (3 pre-gen hunters, a Goblin Den E-gate, a hidden D-rank Double Dungeon and a 3-session quest arc) or **Blank**. Tap **?** in the header any time for the quick-start guide.
2. **GM tab** has the cheat-sheet (DC, XP, loot odds, conditions), award tools, System broadcast presets, Issue Quest, roll tables, a Rules editor and the session log. **Start session** backs up the save, advances the world day and logs it.
3. **Gates**: spawn a gate, **Start encounter** (pick the party, roll initiative), run it in **Combat**, then End encounter to award XP in one summary window, and **Clear** the gate for XP and loot.
4. **Quests**: issue quests, or **Issue Job Change Quest** (3-step chain; the final step sets the job, and Necromancers can extract shadows from defeated monsters in Combat).
5. Players join from their phones with the room code (Data tab) so your broadcasts and awards reach them. Players never see GM controls.

## Run locally

```
bun install
bun start          # app and campaign rooms on http://localhost:3000 (PORT=8000 to change)
```

The server bundles `src/` and `public/` in memory when it starts, so restart it after a change. `AGENTS.md` has the test and CI commands.

## Deploy to Railway

1. Create a service from this repo. `railway.json` sets the start command (`bun server.ts`) and the health check (`/api/health`).
2. Optional: add the Postgres plugin and set `DATABASE_URL` on the service. Without it rooms live in memory and reset when the server restarts.

`GET /healthz` and `GET /api/health` report liveness.

## Static host

`bun run build` writes the app to `dist/`. Any static host can serve that folder. There are no campaign rooms without the server, and everything else works.

## Campaign rooms

The GM opens Data, then Campaign Room, then **Create room as GM** and shares the 6-character code. Players open the same panel, enter the code and **Join** (pick which hunter this phone controls). The header pill shows the room, or "Offline: local only" if the server is unreachable.

- Each player's phone owns its hunter sheet and uploads the active hunter a few seconds after changes, keyed `<deviceId>:<hunterId>` so two phones that both have `h1` never collide. The GM sees these read-only (`remoteSheets()` gives each one a `key`). Events target `all`, a bare hunter id, or a sheet `key` (only that phone).
- The GM sends events: `system` messages, `award`s and `quest`s, aimed at `all` or specific hunter ids. Phones poll every 5 s while visible and apply each event exactly once.
- Localstorage stays the source of truth. If the server dies, the app keeps working and reconnects by itself.
- The room code is the only secret (no accounts). Rooms expire after 30 days idle.

API: `GET /api/health`, `POST /api/rooms`, `GET /api/rooms/:code?after=N`, `POST /api/rooms/:code/events`, `PUT /api/rooms/:code/sheets/:hunterId`. Bodies are limited to 64 KB.

## Saves and backups

Your game is saved in this browser under `hunter-system-v5` (schema 5). Older saves are not carried over. The Data view exports and imports the whole save as JSON, refuses files from older or newer schemas before changing your campaign, and keeps the last 8 automatic backups (daily, imports, restores and resets). Export a copy before clearing browser data, and when switching phones.

## Features

First-run onboarding and starter campaign; status window with HP/MP/fatigue, levels and ranks; stat allocation; daily quests, penalties and streaks; quests; skills; inventory and equipment; titles; dice roller and rules reference; bestiary; gates; combat tracker; shadow army; GM tools (cheat-sheet, broadcast presets, session start, job-change quest chain); System-style windows with a Confirm-all queue, optional chime and reduced-motion support; export, import and backups; optional campaign rooms; offline use through a service worker after the first visit on a web address.
