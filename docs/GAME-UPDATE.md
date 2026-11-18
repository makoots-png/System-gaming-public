# The Hunter System: game update (Sun Oct 18 2026)

For the owner. Live site: https://hunter-main-production.up.railway.app

## TL;DR
I played a full session as GM (laptop) and as a player (phone) in one Campaign Room, then had the director play it independently. We both reached the same verdict. The app had two good halves, a character sheet and a GM tracker, but they were joined by a thin one-way pipe that carried only broadcasts, awards and quests. Your core loop ("I run combat scenarios, players live them on their phones") was not connected, and almost everything custom was just a name plus a text label.

Today's run shipped 10 units as separate PRs. Each one was reviewed by the director, QA'd before merge, and re-verified on production after merge. Together they connect that loop:
- Players are now in your fights.
- Statuses and items do real things.
- You can invent a status, an item or a monster in a few taps.
- Quests carry their full window and report progress back to you.
- Gates are shared with the room.

Existing saves and rooms are untouched. Every change is additive: no field was renamed or removed, and older event types still work.

**Evening update (Oct 18, 6 PM to 3 AM):** 17 more PRs (#15–#30), all on production, with joining and cross-device sync as the top priority:
- one-tap join by invite link, and a GM board that shows who is really online;
- your GM key survives Leave and rejoin;
- offline changes are re-sent automatically;
- one synced hunter per device, with no ghost cards;
- a second GM device no longer wipes the world;
- hunters can be deleted, the GM can remove players, and quests can be assigned to room hunters.

Claude (Opus) reviewed everything built during the 6:06–7:21 PM credit outage after the fact, and its findings were fixed in follow-up PRs. See "Evening" at the end.


## What the review found
These were the gaps, ranked by impact on play. The full review is in hunter-ops/GAME-REVIEW.md (both reviews), with screenshots in shots/game-mgr/.
1. **Players couldn't be in your fights.** Combat only listed hunters on the GM device. Remote players showed up as "read-only" cards. You couldn't damage a player, put a status on them, or include them in initiative. Their phone showed nothing during a fight.
2. **Custom loot was a stub.** A "Custom item" arrived as a bare "misc" item with name and rarity only. A consumable you made in the shop never appeared in the Award list. No item could apply or cure a status.
3. **Custom statuses needed JSON and did nothing.** You had to type a 114-character JSON override. Even built-in "−2 AC" or "1d4 per turn" were text only, with no mechanics.
4. **Monster abilities disappeared in combat.** The Bestiary held them, but combat cards never showed them. The quick custom combatant had no attack at all.
5. **The quest flow was one-way and split.** The GM-tab form allowed one objective and no item or title rewards. The rich form only reached hunters on the GM device. Nothing came back when a player progressed, and the quest popup showed only the title.
6. **The world wasn't shared.** Gates you spawned never reached players.
7. **Running the game from a phone was rough.** There was no GM tab in the phone nav, and the GM page was 4,166 px tall.
8. **Players saw GM-ish tools.** At the table, a player's phone showed its own empty encounter builder.

## What changed, and how to use it

### 1. GM → player state (G02, PR #3)
- **GM:** Data → **Create room as GM**, then read the code out. Open the **GM tab** → Party board. Every remote player card now has **−5 −1 +1 +5** HP buttons, a **Status** button, and status chips (tap ✕ to remove one). Each send shows a confirmation line, for example "Sent −5 HP to Kai".
- **Broadcasts** have a **Send to: Everyone / Selected hunters** toggle, so you can whisper to one player.
- **Issue quest** has a **Penalty on failure** field.
- **Player:** HP changes arrive as a toast, statuses arrive as a System window with their effects listed, and quests arrive as a full window with Goal, Objectives, Reward, **PENALTY** and the due time. Reloading never re-applies anything.

### 2. Statuses with real mechanics (G01, PR #2)
- Built-in statuses now work. Slowed (−2 AC), Hasted (+2 AC), Poisoned and Frightened (−2 to checks), Prone, Blinded and Restrained change the numbers on the sheet automatically. Burning and Bleeding tick damage at the start of the bearer's turn in combat (G03).
- Tap any status chip to read what it does.

### 3. Status Forge: invent a status mid-fight (G05, PR #8)
- **GM:** on a remote player's card (or a combat card), tap **Status**. Type a name such as "Ember Mark", tap effect chips (**AC −2**, **Checks −2**, **Attack ±2**, **1d4 dmg/turn**, **1d4 heal/turn**…), set Rounds, then **Apply**. That's 4 taps plus typing. It's saved to your library, so next time it's **Status → tap the saved chip**: 2 taps.
- Manage saved statuses under GM tab → **Status library** (New, Edit, Delete). Deleting a status only removes it from the pickers; anything already applied keeps working.
- **Player:** gets a System window ("EMBER MARK · AC −2 · 1d4 damage at turn start · 3 rounds") and the sheet numbers change.

### 4. Loot Forge: custom items and consumables with effects (G06, PR #4)
- **GM:** GM tab → Award, tick the hunter(s), then in Item choose **Custom item…**.
- Type a name, tap a Type chip, and add effect chips: heal or damage dice, apply or cure a status, +attack, +damage or ±AC while equipped, or a free-text note. Tap **Save item** (saved to your library by default), then **Send award**.
- Example: "Mantis Antivenom": consumable, heal 2d4+2, cure Poisoned.
- To re-award, pick the item from the **Library** group in the Item select. GM tab → **Item library** lets you edit, duplicate or delete.
- **Player:** the item arrives intact. **Use** a consumable from Inventory: it heals, cures and applies exactly as written and lists the result in a System window. Equipping gear applies its bonuses.

### 5. Players in your fights (G03, PR #6)
- **GM:** Combat → add monsters → **Add whole party**, which includes remote players such as "Kai Mizuno (remote)" → **Roll initiative**.
- On a monster's turn, pick the target (remote players are listed), tap **Attack**, then **Apply N damage**. The player's phone HP drops within a few seconds.
- Statuses on a player's card reach their phone. Per-turn damage ticks at their turn start.
- **End encounter** awards XP to remote players too.

### 6. Player combat HUD + roll feed (G04, PR #7)
- **Player:** when your GM starts a fight, the Combat view shows a live HUD: round, turn order, monsters with HP bars, and your HP, MP and statuses. You get a **YOUR TURN** System window on your turn. Your dice and skill rolls are sent to the GM automatically.
- **GM:** a **Table feed** panel lists player rolls and quest updates. On a damage roll, pick the target and tap **Apply N →**.

### 7. Improvised encounters and live monster abilities (G07, PR #9)
- **GM, quick monster:** in Combat → **Quick line**, type `Mantis Drone x3, HP 30, AC 13, +5, 1d8+2` and tap Add. That gives three drones with attacks.
- The **Custom combatant** form now has attack, damage, abilities and "Save to Bestiary".
- **Ability text is live** on combat cards. Dice like `2d10+4` and bonuses like `+6` are tappable to roll, and status names inside an ability ("…or Poisoned for 3 rounds") become **Apply Poisoned** chips that land on the selected target, including a remote player's phone.

### 8. Quest flow v2 (G08, PR #5)
- **GM:** Quests → **+ New quest**. Add a title and as many objectives as you like ("+ Add objective"). Rewards can be XP, gold, points, an item (including Custom…) and a title. Set a penalty and due hours, tick players (or All) and Save. It reaches remote players.
- **Job Change:** tap **Job Change** and type any job (e.g. Shadow Monarch).
- **Player:** tap + on objectives and Complete. **You** get a toast and a log entry, and GM → **Party quests** shows everyone's progress.

### 9. System portal: shared world + GM on a phone (G09, PR #10)
- **GM:** GM tab → **Gates and world day** → rank, type, name → Spawn. Players get **A GATE HAS APPEARED** within about 5 s, and their Gates tab shows it with its countdown. Advancing the day until it breaks sends **GATE BREAK**.
- **On a phone,** the GM tab is in the bottom nav when you're in GM mode. Only the Party section starts open. Picking targets in Award shows "To: …" in the header.
- Custom monsters in your Bestiary are used when gates auto-fill.

### 10. Table polish (G10, PR #11)
- **GM:** **Add whole party** skips the blank placeholder "Hunter" when remote players are present. You can still pick it from the select.
- A player at 0 HP shows a **Down** tag and stays in the list.
- The Quick line accepts names like "Acid Slime" and "Ace".
- A bad damage dice in the Custom form shows an error before the monster is added.
- During a fight the **Table feed** stays pinned at the bottom of the screen.
- Each player roll makes exactly one feed row, and heal rolls never offer "Apply damage".
- **Player:** while your GM's encounter is live, the Combat tab shows only the HUD. Otherwise it reads "No active encounter from your GM", with solo tools tucked below.

## PRs
| Unit | PR |
|---|---|
| G01 Effects core + save additions | https://github.com/the-owner/systemgaming/pull/2 |
| G02 Room protocol v2 + GM→player state | https://github.com/the-owner/systemgaming/pull/3 |
| G08 Quest flow v2 | https://github.com/the-owner/systemgaming/pull/5 |
| G06 Loot Forge + item library + effectful consumables | https://github.com/the-owner/systemgaming/pull/4 |
| G03 Room-linked combat | https://github.com/the-owner/systemgaming/pull/6 |
| G04 Player table HUD + roll feed | https://github.com/the-owner/systemgaming/pull/7 |
| G05 Status Forge | https://github.com/the-owner/systemgaming/pull/8 |
| G07 Improvised encounters + live abilities | https://github.com/the-owner/systemgaming/pull/9 |
| G09 System portal: shared world + GM on phone | https://github.com/the-owner/systemgaming/pull/10 |
| G10 Table polish | https://github.com/the-owner/systemgaming/pull/11 |
| This document | https://github.com/the-owner/systemgaming/pull/12 |

Each PR was reviewed by the director, passed local QA (159 checks plus the unit's own GM + phone script), and was re-checked on production after merge. Nothing needed a revert.

## Decisions I made for you
- **Fewer new room messages.** The director cut new event types to four: `hp` and `status` (GM→player), `roll` and `questUpdate` (player→GM). Live state (the encounter, the gate list) travels as "room docs", so a player who joins mid-fight sees the current state, and old clients never see these docs.
- **No save version bump.** Every save change is an optional field with a default. Old item fields (heal, MP, fatigue, bonus) keep their meaning; effects are read alongside them.
- **Monster abilities stay free text.** Instead of a structured ability editor, the text itself became tappable (dice, to-hit, status names). You keep writing abilities the way you think.
- **Rooms have no login.** The room code is the key, so you can switch GM devices freely.
- **Units are built in parallel and shipped one at a time.** Wave 2 and wave 3 units were built side by side on disjoint files, then merged one PR at a time, with production QA (159 checks) after each.
- **One transient prod QA failure was not treated as breakage.** After G03, a page-load timeout hit the 134th check. A rerun passed 159/0, so nothing was reverted.
- **The flaky QA "goblins" check was relaxed.** Gate contents are random, so it now accepts "has monsters".

## Deferred (deliberately not today)
- **Player lockdown** ("GM controls progression": players can't self-add skills or items or edit HP). It touches 5 modules, and table trust holds socially for now.
- **GM approval of quest completion.** It needs a revoke flow. You see completions live and can correct with award or HP.
- **Skill effects** (skills applying statuses). Skill rolls already reach your feed.
- **Weapon on-hit automation.** Use a note on the item plus a 2-tap status reapply.
- **Saving-throw prompts, status stacks or icons, item charges, take or revoke item.**
- **Shadow extraction by a remote Necromancer** (needs shadow storage on the phone).
- **The Blank-GM placeholder "Hunter"** still exists on the GM device, but G10 keeps it out of fights.
- **Shared bestiary or library sync to phones.** Items and statuses already travel with full definitions.
- **WebSocket push.** A 3 s poll during combat meets the latency targets.

## Cost and process
Model spend for the day run was about $26 against a ~$60 guide. The director (Opus, high effort) planned and reviewed every unit. Builders (Sonnet) built one unit per branch. I verified, merged and checked production after each merge.
State lives in /workspace/hunter-ops: QUEUE.md, LEDGER.md, decisions.tsv, program2/.

## Known small follow-ups (from the director's reviews; none block play)
- Item heal rows in the feed show the amount actually healed after clamping, not the raw dice total.
- On a 390 px GM phone the pinned feed strip takes about 14% of the screen during a fight.
- A player who joins after gates exist sees them in the Gates tab but gets no popup for them.
- Forging an item or status with the same name as a library entry replaces that entry without a warning.

## Try it in 5 minutes
1. **Laptop:** open the site → Yes → **I'm the GM** → Blank → Data → **Create room as GM**.
2. **Phone:** open the site → Yes → **I'm a Player** → name + code → Begin.
3. **Laptop:** Combat → Quick line `Crimson Mantis, HP 60, AC 14, +6, 2d8+3` → Add → **Add whole party** → Roll initiative. Attack your player. Watch their phone HP drop and get **YOUR TURN**.
4. **Laptop:** on the player's card → Status → "Mantis Venom", **1d4 dmg/turn**, **Checks −2** → Apply.
5. **Laptop:** GM tab → Award → tick the player → Item **Custom item…** → "Antivenom", consumable, cure Mantis Venom, heal 2d4 → Save item → Send award. **Phone:** Inventory → Use.

---

## Desktop pass (evening, Oct 18)
the owner: "It doesn't have to be just phones. Make sure it's good for PC too."

### What the desktop play-test found
I played GM + player on 1280×800, 1440×900 and 1920×1080, plus GM-on-PC/player-on-phone and the reverse. The director did the same independently. Details are in hunter-ops/program3/MGR-DESKTOP-NOTES.md and PROGRAM3.md, with screenshots in shots/desk-mgr/ and shots/desk-director/.
- **Desktop was the phone layout, centred.** Content was capped at 1120 px (about 800 px of empty space at 1920), the base font was 15 px, and most views were one long column.
- **The GM has no "cockpit".** During a fight the tracker, the Build form and the Table feed stack into a 1,900 px column, and the Party board is on a different tab.
- **A desktop player has to leave Combat to act.** Skills and consumables are on the Status tab.
- **Forges and System windows are phone-sized on a monitor.** They are fixed at 480 px wide, and the Status Forge stretches to full screen height.
- **There were no keyboard shortcuts and very few hover hints.** Enter and Esc already worked, and the focus ring is visible.
- **What already worked:** mixed devices, the YOUR TURN alert on desktop, no horizontal scroll and no console errors anywhere.

### Shipped
**D01, Desktop shell (PR #13, https://github.com/the-owner/systemgaming/pull/13):**
- Content widens to 1,360 px at ≥1,100 px screens and 1,680 px at ≥1,500 px. Text steps up to 16 px at 1920.
- Status and other views lay out in 2–3 columns on wide screens.
- Shared desktop dialog sizing.
- Phone and tablet layouts are unchanged; a pixel-parity check compared them against the old build.

**Keyboard shortcuts (desktop):**
- **?** opens the shortcut list.
- **1–9** jump to tabs. The tab tooltips show the number, e.g. "Combat (4)".
- **Esc** closes windows and dialogs, and focus returns to where you were.
- Shortcuts never fire while you're typing in a field or while a System window is open.

### Desktop pass, continued: shipped after the credit outage
- **P01, GM-only combat and typed damage/heal** (PR #15). New rooms get a secret GM key, stored hashed on the server. Only the key holder can send HP, status, award, quest or gate events, or change the encounter. Every HP spot has a number box: `7` + Enter damages, `+5` heals. HP clamps to 0..max, and the quick buttons stay.
- **B01, Bestiary codex** (PR #16). Monsters are added as they are beaten: kill count, first defeat, and **MONSTER INFO UNLOCKED** on every device in the room. Players see only what they've beaten. The GM can edit, merge and remove entries.
- **D02, GM combat cockpit** (PR #17). On desktop, turn order, the active card and the table feed sit side by side, and Build collapses mid-fight. Keys: `n p j k d s a q`.
- **D04, GM desk** (PR #18). The GM tab is in columns, the forges are wide and short, and the quest form has two columns.
- **D03, player "Your kit"** (PR #19). Skills, consumables and d20 sit next to the combat HUD, and the browser tab title shows "▶ Your turn".
- **D05, desktop QA suite** (`hunter-ops/verify/qa-desktop.mjs`, 43 checks). It now gates every ship.

---

## Evening: rooms, joining and sync, plus Claude's catch-up review (Oct 18, 6 PM to late)

### How this part was built
- **No Claude, 6:06 to 7:21 PM.** The Claude account ran out of credit at 6:06 PM, and the owner said to keep going without it. In that window I wrote and self-reviewed P01, B01 (the builder had already written it), D02, D04, D03, J01 and R01. The rule stayed the same: one PR per unit, QA before and after each merge.
- **Claude back from 7:21 PM.** Claude returned on the owner's subscription. Since then every unit follows the pstack flow:
  - a Sonnet builder writes it;
  - Opus (high effort) reviews it;
  - it merges one at a time;
  - prod QA runs after every merge.
- **Catch-up review.** Opus did a thorough after-the-fact review of everything built without it:
  - **AUDIT-A** covered join and cross-device sync, plus J01 and R01 before they merged. It ran 2–6 browser stress tests: refresh, a hidden page, 40 s offline, a second GM device, 6 players, and GM and player editing at the same moment.
  - **AUDIT-B** covered P01, B01, D02, D04 and D03 after they had merged. It tried to break the GM key gating and checked every HP field and the desktop layouts.
  - D01 had already been reviewed and approved by Opus before the outage.

**Which units Claude reviewed, and when**

| Unit | Built by | Claude review |
|---|---|---|
| D01 desktop shell | Sonnet | Opus before merge: APPROVE |
| P01 GM authority + typed HP | operator (no Claude) | Opus after the fact (AUDIT-B): NEEDS-FOLLOWUP, fixed by F02, F03, F04, S01 |
| B01 bestiary codex | Sonnet builder, unreviewed at the time | Opus after the fact (AUDIT-B): NEEDS-FOLLOWUP, fixed by F02 |
| D02 / D04 / D03 desktop GM cockpit, GM desk, player kit | operator (no Claude) | Opus after the fact (AUDIT-B): OK, minor polish left |
| J01 easy join | operator (no Claude) | Opus before merge (AUDIT-A): APPROVE-WITH-FOLLOWUPS |
| R01 delete hunter, GM remove, quest assign | operator (no Claude) | Opus before merge: REQUEST_CHANGES, then fixed, then APPROVE |

### What Claude's review found
**AUDIT-A (join and sync)** ran stress tests and timed the main paths:
- **Joining.** A player shows up on the GM board ~2–3 s after joining (6 at once: ~2 s).
- **HP changes.** GM damage reaches the phone in ~1.8 s.
- **Simultaneous edits.** GM and player editing HP, statuses and items at the same moment **lost nothing** (changes are deltas, so they add up).
- **Recovery.** Refresh, a hidden page, 40 s offline and GM refresh all recover.

The problems it found:
- **GM key lost (A-02).** Pressing Leave and then rejoining your own room, or opening a friend's invite on the GM device, silently destroyed the GM key. You were then a player in your own room. *Fixed in S01.*
- **Offline changes lost (A-03).** A change the player made offline or while the phone slept never reached the GM unless they changed something else later. *Fixed in S02.*
- **Second GM device (A-04).** Rejoining as GM on a second device wiped everyone's gates and reset the day. *Fixed in S06.*
- **Ghost cards (A-06).** Switching your active hunter left a ghost card on the GM board, and GM damage to it went nowhere visible. *Fixed in S03.*
- **R01 kick (A-01, A-05).** Removing a stale card could kick the player's live hunter, and a player let straight back in was re-kicked for 2 minutes. *Fixed in R01 before it merged.*
- **Presence dot (A-07).** The "connected" dot was always green. It now shows real presence (green / idle / last seen). *S04.*
- **Not done tonight (lower priority):**
  - optimistic GM board updates (A-08);
  - per-room sheet caps and lean polling (A-09, A-13);
  - device tokens so players can't overwrite each other's sheets (A-10, A-19);
  - securing legacy keyless rooms (A-11);
  - a GM outbox for actions sent while offline (A-12).

**AUDIT-B (P01, B01, D02, D04, D03 after the fact).** The server-side GM gating held up against every forgery tried: no key, wrong key, header casing, replay, `_` docs and oversized bodies. The key is stored hashed and compared in constant time.

The problems it found:
- **Solo combat and bestiary broken (A2).** P01 broke solo play: a player with no room lost the combat tracker. B01 showed solo players an empty bestiary. *Fixed in F02.*
- **Player could add combatants (A3).** In a room, a player could still use "Add to combat" from the Bestiary. *Fixed in F02.*
- **Key in exports (A4).** The GM key was written in plain text into "Export campaign". *Fixed in F03.*
- **Shift+Enter (A5).** It healed on combat cards but damaged everywhere else. *Fixed in F04, along with full-width digits and 0 or huge amounts (A10).*
- **Codex credited the wrong monster (A6).** A group-label prefix such as "Goblin" on a Goblin Shaman recorded the kill as plain Goblin. *Fixed in F02.*
- **D02, D04 and D03 desktop work:** OK. Small polish is left over (F08).

### What changed for you tonight (rooms, joining and sync)
- **Inviting players (J01).** The GM tab shows the room code in large type, a **Copy invite link** button (`…/?room=CODE`; on phones it opens the share sheet) and the list of connected players.
  - A new player opens the link, names a hunter and is in.
  - A returning player gets a Join dialog to pick or create a hunter.
  - Anyone not in a room sees a **Join a room** pill in the header.
  - The link never carries the GM key.
- **Presence (S04).** The player list shows who is really there: green = online, amber = idle, grey = last seen. Players see "Room ABC · live".
- **Your GM key is safe (S01).** Leave, rejoin, or open a friend's invite, and you stay GM of your own rooms. **Data → Your GM rooms → Rejoin as GM** is one tap.
- **Nothing gets lost offline (S02).** Changes made offline or while the phone sleeps are re-sent on reconnect, with backoff.
- **One synced hunter per device (S03).** Switching hunters asks "Play as X?". There are no more ghost cards, and the GM's damage always lands on the hunter whose card they see.
- **Second GM device (S06).** A second GM device (e.g. a phone at the table) merges the gates and day instead of wiping them, and it warns before replacing a fight another GM device is running.
- **Delete hunters (R01).** Use **Delete** in the Party list or **Delete hunter…** on the sheet. You confirm by typing the name, and a backup is saved first. Deleting your last hunter starts a fresh one.
- **Remove a player (R01).** The GM can remove a player's hunter from the room and from combat (the server checks the GM key). Their device keeps the hunter and is unbound.
- **Assign quests (R01).** The Quests tab has **Assign to**: local hunters, every room hunter, and **Whole party**. Players get a System notice. Completing the quest pays XP, gold and loot on *their* hunter, and the GM log shows "X COMPLETED …". Players can't assign quests.
- **Fixes from the review:**
  - Solo play is back: the tracker and the full bestiary (F02).
  - The GM key stays out of exported campaign files unless you tick the box (F03).
  - Shift+Enter heals in every HP box (F04).

### Prod QA after every merge (two-browser where it matters)
Every merge ran the full suite against production:
- smoke test;
- `qa-all` (159 regression checks);
- `qa-desktop` (43);
- `qa-authority` (61);
- `qa-codex`;
- `qa-join` (58 after S01);
- `qa-room` (51 after S03; GM + 2 players: delete, remove, quest assignment and rewards);
- **`qa-prod-sync`** (42; a new GM + phone + desktop suite on prod: invite join, live player list, HP/status/loot both ways, quest assign and complete, refresh and rejoin, GM removal, 30 s offline);
- **`qa-sync-resilience`** (15; offline, 413 and 503 storms).

All were green after each merge. Three timing flakes under heavy box load were investigated and the harness was hardened (T01, harness only; see decisions.tsv). Nothing was reverted.

### Cost
The Claude runs after the outage were 2 Opus audits, 10 Sonnet builds, 9 Sonnet fix rounds and 20 Opus reviews. They went through the owner's Claude Code subscription; the CLI reports about $37 of notional usage. The out-of-credit API key was not used.

### Left over (designed and specced by the reviewer, not built tonight)
These are in `hunter-ops/reviews/AUDIT-A.md` and `AUDIT-B.md`, in priority order:
- **S05:** instant GM-board feedback. Today the GM's own card can lag ~6–8 s after a hit.
- **S10:** a GM outbox, so GM actions sent while offline aren't lost, plus idempotent events.
- **S08:** leaner polling (players don't download every sheet).
- ~~**S07/F05:** device tokens~~ shipped Oct 19 (see below).
- **S09 / F07-legacy:** secure or migrate old keyless rooms. Until then, rooms made before P01 stay "open" by design.
- ~~**S11:** kick polish~~ shipped Oct 19 (see below).
- **S06(c):** a one-tap "GM device link".
- **F08:** small desktop polish (focus after `s`, `q` auto-collapse, HUD input width, POST /rooms body cap).

### Evening PRs (all merged one at a time, each followed by prod QA)
| PR | Unit | What | Claude review |
|---|---|---|---|
| [#15](https://github.com/the-owner/systemgaming/pull/15) | P01 | GM-only combat + typed damage/heal | after the fact (AUDIT-B) |
| [#16](https://github.com/the-owner/systemgaming/pull/16) | B01 | Bestiary codex | after the fact (AUDIT-B) |
| [#17](https://github.com/the-owner/systemgaming/pull/17) | D02 | GM combat cockpit + keys | after the fact (AUDIT-B) |
| [#18](https://github.com/the-owner/systemgaming/pull/18) | D04 | GM desk | after the fact (AUDIT-B) |
| [#19](https://github.com/the-owner/systemgaming/pull/19) | D03 | Player "Your kit" + tab title | after the fact (AUDIT-B) |
| [#20](https://github.com/the-owner/systemgaming/pull/20) | J01 | Easy join: invite link, Join pill, room code, player list | before merge (AUDIT-A): approve with follow-ups |
| [#21](https://github.com/the-owner/systemgaming/pull/21) | R01 | Delete hunters, GM removes player, quest Assign to | before merge: r1 changes, r2 approve |
| [#22](https://github.com/the-owner/systemgaming/pull/22) | F02 | Solo combat/bestiary restored, player add hole closed, codex dedupe | Opus approve |
| [#23](https://github.com/the-owner/systemgaming/pull/23) | F03 | GM key out of exports | r1 changes, r2 approve |
| [#24](https://github.com/the-owner/systemgaming/pull/24) | F04 | One HP-entry key rule | Opus approve |
| [#25](https://github.com/the-owner/systemgaming/pull/25) | S01 | GM key ring (never lose GM) | r1/r2 changes, r3 approve |
| [#26](https://github.com/the-owner/systemgaming/pull/26) | S02 | Reliable push + reconnect | r1 changes, r2 approve |
| [#27](https://github.com/the-owner/systemgaming/pull/27) | S03 | Bound hunter, no ghost cards | r1 changes, r2 approve |
| [#28](https://github.com/the-owner/systemgaming/pull/28) | S06 | Second GM device safe | r1/r2 changes, r3 approve |
| [#29](https://github.com/the-owner/systemgaming/pull/29) | S04 | Real presence on the GM board | r1 changes, r2 approve |
| [#30](https://github.com/the-owner/systemgaming/pull/30) | S12 | Join polish (invite after Skip, share sheet, Remove placement) | Opus approve |

## Oct 19: hunter ownership and "Allow back"
Built the same way as the evening: Sonnet builders, an Opus (high) reviewer, one unit per PR, merged one at a time, full prod QA after each merge. S09 (old keyless rooms) was skipped on purpose; those rooms stay open.

### What changed for you
- **Nobody can overwrite your hunter (S07/F05, [#32](https://github.com/the-owner/systemgaming/pull/32)).** Each device quietly claims its own hunter the first time it syncs. After that the server refuses anyone else who tries to write it, delete it, or send rolls and quest updates as that device. The GM key always passes, so GM edits, HP and status in combat, awards and quest rewards work as before. Rooms hold up to 24 hunters; a hunter sheet is capped at 32 KB.
  - **New phone:** Data → Export campaign, then on the new phone Data → Import → Replace campaign. The new phone carries the same claim. Or just join fresh and Remove the old card.
  - **"HUNTER LOCKED TO ANOTHER DEVICE":** tap **Release** next to that player on the GM party board. Their phone takes the hunter back within about 30 s. Remove also frees the claim.
- **Allow back (S11, [#33](https://github.com/the-owner/systemgaming/pull/33)).** After you Remove a player, the GM room list shows them under **Recently removed** with **Allow back**. Tap it and they can rejoin at once; their removed window has **Rejoin when the GM allows**, which says "not yet" until you allow it. Removal times use the server clock, so a phone with a wrong clock can't slip past a removal.

### What review found
- **S07:** approved on the first round. The reviewer ran 37 raw API probes (spoofed writes, forged deletes, events posted as another device, caps, no token leaks) and an 18-step UI run (second device via export/import, lock then Release). All passed.
- **S11:** round 1 asked for changes. A player whose phone clock ran 5 minutes fast could not be removed, and the "Rejoin" button let a removed player back in without the GM. Both were fixed, and round 2 approved. After S07 merged, the merge into S11 was reviewed again (round 3, approved). QA had caught two braces lost in that merge, and they were fixed before the review.

### Prod QA
| Suite | After S07 (#32) | After S11 (#33) |
|---|---|---|
| qa-all | 159/0 | 159/0 |
| qa-desktop | 43/0 | 43/0 |
| qa-authority | 61/0 | 61/0 |
| qa-codex | all pass | all pass |
| qa-join | 74/0 | 74/0 |
| qa-room | 51/0 | 69/0 (18 new S11 checks) |
| qa-prod-sync (two browsers) | 42/0 | 42/0 (re-run after a test-only fix, see below) |
| qa-sync-resilience | 15/0 | 15/0 |
| qa-ownership (new, three browsers + API) | 42/42 | 42/42 |
| qa-api-sec (new, raw API) | 11/0 | 11/0 |

There were two test-only fixes, and no product code changed for either. qa-prod-sync's "not back on the board" check now looks only at the players list, because the room panel now also shows the removed player under "Recently removed". One qa-room wait went from 10 s to 20 s after a single timeout under box load; the same check passed on a standalone re-run.

### Left over (small, not blocking)
- A "reclaim code" so a new phone can take over a hunter without the GM or a full-save import.
- Tell the player when the room is full or their sheet is too big (today the sheet just doesn't reach the GM).
- The sync pill still says "live" while a hunter is locked.
- Joining by typing the code or opening the invite link still gets past a removal once the 20 s server window ends. "Rejoin" checks with the GM, but those two paths don't.
- Copy and indent polish on the "Recently removed" list.
- Not built, per the owner: S05, S08, S09, S10, S06c, F08.
