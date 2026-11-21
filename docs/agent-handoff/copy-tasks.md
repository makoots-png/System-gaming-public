# The app's words

Every sentence the app shows follows this file. The wording pass (`final/notes-wording.md`) read each one against it and removed the last `TODO(copy)` mark. The lint "no placeholder words are left marked" in `tests/lint.test.ts` keeps the mark out of `src`, `public` and `server.ts`.

## The voice

**Plain first (the owner, Nov 19).** Of an award's line that read "The scene pushed and the hunter did not move": "such ai slop garbage! Don't be clever. Cleverness in player or gm facing text is the devil." This rule outranks every other line of this file:

- Say what happened in the words you would use to a friend across the table. Who did what. "Stayed in character during a hard scene."
- Nothing figurative. No metaphor, no simile, nothing that is not literally true: a scene cannot push, a mask is not held, a wound is not carried.
- No wordplay, no puns, no wink, no line written to sound good. If a sentence is admired for how it is put, rewrite it.
- No contrast for effect ("not X, it is Y"), no closing one-liner, no saying.
- **A name may be clever; what describes it may not** (the owner, later the same day: "Ok feat names can be clever. The descriptions can not."). The name of a feat, an award, a title or a quest, and a System window's title, may be a good name ("Held the Mask"). Every line that says what it is, when it is given, what it does or what was seen is plain. A button, a heading, a chip and a label are plain.
- A System window's body says what was seen and what was given, and stops. "You stayed in character during a hard scene. You get 1 ability point."
- When in doubt between a plain line and a better-sounding one, the plain line.

Checked by two readers, never by the writer alone: the one who writes edits with `humanizer` and `unslop`, then a second reader who did not write it lists every line that breaks a bullet above, and the list is empty before the words are committed.


- A person at a table reads this on a phone in the middle of a game. Put the fact first, in the fewest plain words. Then say what to do, if there is something to do.
- Give numbers exactly: "Respec costs 200 gold. You have 150."
- Call one thing by one name everywhere. A button's label is the word the help line, the toast and the confirm use for it.
- The System's voice (`! TAG` windows, "ARISE", "REWARD RECEIVED") lives in a window's tag and title only. A body, an error, a refusal, a label and a hint are plain.
- A refusal says why and, where there is one, the way out. It blames nobody and never says "please" or "sorry". An error is not shouted.
- Use sentence case. No exclamation mark outside a System tag. No em dash, no semicolon between two clauses, no "(s)" plural (write both forms), no "successfully", "simply" or "just".
- A label fits its control at 360 px. The room pill is at most 96 px wide. The manifest's `short_name` is at most 12 characters.
- When the connection is the problem, stay calm, and say nothing is lost when that is true. Never say it when it is not.
- Spell American: "color", "defense", "center", "canceled".

## The glossary

| Thing | The word | Not |
|---|---|---|
| A battle, from Start fight to its end | fight (Start fight, End fight, Fight over, Fight log) | encounter. The tab keeps its name, Combat |
| A monster taken out of a fight | defeated | down |
| A hunter at 0 HP | Dying while the death saves run, Stable once stabilized, Dead after three failures (the owner's ruling, Nov 20: every phone, never Down); `lifeWord` in `src/core/combat/row-life.ts` | down, defeated |
| The pool spent on abilities | mana | MP |
| The shared session between phones | room | campaign room |
| The header's room control | the room button at the top | the room button in the header, the pill |
| Starting a room, getting into one | a GM creates a room (Create room), a player joins one (Join room); a GM reopens one it holds (Open ABC234 as GM) | open a room, run a room |
| A player's character | hunter | character |
| What a hunter carries | bag (the Bag panel) | inventory |
| What a hunter wears | gear (the Gear panel, Gear weight) | equipment, kit |
| A status on a body | status | condition |
| What a hunter learns | skill (the Skills panel) | |
| Anything a body uses in a fight: an attack, a skill, an item's use | ability | kit |
| Points spent on stats | ability points | points, stat points |
| The person running the game | GM | Game Master |
| A creature of the GM's | monster (the monster maker) | enemy |
| The other side in a fight | foe, and ally for one's own side | enemy |
| A lasting effect on the ground | field (New field, Field name) | zone |
| A reward saved to give again | bundle (the Workshop's Bundles, New bundle) | reward, reward bundle |
| A saved set of gear | loadout | gear set |
| The item that brings a dead hunter back | Resurrection Crystal (with the GM's Revive, `WAYS_BACK`) | resurrection, revive item |
| A fight's map | map; the default one is the open arena | battle map |
| A GM's arc over several sessions | story (a chapter, open a chapter, Stories to copy) | arc, campaign, saga |
| What the System remembers of a hunter | Chronicle (the Chronicle panel; one line of it is an entry) | record, history, log |

Two words keep a second meaning on purpose. "Condition" in the ability form's Only when group means a requirement on a use ("Add a condition"), not a status. "Kit" names a weight class of gear in the rules reference's tables and the design docs, never a label a player taps.

## Where the words live

- The room pill's words are `PILL_ROOM` and `render` in `src/edge/room-pill.ts`. The Room view's state words and connection lines are `STATE` in `src/views/room.js`. A new link state gets a line in both.
- What the site is, what a room is, each role's way to one, the next steps after setup and the ? guide's tips are `src/core/first-run.ts` (`ABOUT`, `ROOM_IS`, `ROOM_PATH`, `nextSteps`, `TIPS`, `createdLine`, `LOADED`). The Welcome window, Hunter created, Campaign ready, the ? guide and the Room view read them; say a room's idea there once, not again in a view. `tests/first-run.test.ts` checks that `ABOUT`, `ROOM_IS` and `ROOM_PATH` are one sentence each and that no line of the file has an em dash, an exclamation mark or a semicolon.
- A failed Create or Join says `tapWords` (`src/core/sync/taps.ts`).
- A life that is not up says `lifeWord` (`src/core/combat/row-life.ts`): Dying, Stable, Dead for a hunter, Defeated for a monster, shadow or summon. The sheet's death panel and chip, the GM's card, order and board, a player's own card and the party's faces, and a token's label read it there.
- A refused fight command says `REFUSAL_WORDS` to the GM and `TABLE_REFUSAL_WORDS` to a player (`src/core/combat/refusal-words.ts`).
- A reward reads `rewardLines` on the quest card and `grantLines` in the reward window (`src/core/rewards.ts`).
- A status reads `describeStatus` and `opLine` (`src/core/combat/effect-ops.ts`); an ability reads `describeAbility` (`src/core/registry/ability-kinds.ts`).
- A sentence goes in core, never in the view (AGENTS.md). A view that still builds one is listed in `final/notes-wording.md`.

## How to check a new sentence

the owner, Nov 19: "I hate the ai-isms in the text", naming "it's not X, it's Y" and a hint that read "It is given at once". So every sentence a player or GM reads, and every story or list written for him, is edited by `.claude/skills/humanizer/SKILL.md` (a public skill, MIT, added that day; its patterns 1 to 5 justify an edit on one sighting) and `.claude/skills/unslop/SKILL.md` before it is committed. A helper's brief names both. The usual tells in this app's words: a contrast that only adds weight ("not X, it is Y"), a one-line closer, a stiff passive hint under a title ("It is given at once" for "One tap gives it"), three of everything, a sentence about the sentence.


1. Read it where it shows: run `bun scripts/ui-shots.ts --serve <port> --out <dir>` and open the shot, or follow the code path.
2. Check it against the voice and the glossary above. Every name in it is the glossary's word.
3. Before you change a label, search `tests/` and `scripts/ui-shots.ts` for it. A test that looks for the old words changes to the new words in the same commit, and nothing else in it changes.
4. A word you are unsure of goes to `docs/agent-handoff/for-the-owner.md` with what he would say to change it. It never ships as a marked placeholder.

## Open copy issues

From the dead-row unit 3 (notes-dead-row.md section 10), for the copy pass:

- The life still says "down" in sentences: `FELL_WORDS` ("HP has reached 0. You are down.", vitals.ts), the fight log line "Mira Test is down." (the fight's log), `CHIP_REFUSAL` ("Down and Dead follow HP and death saves.", chips.ts), the status registry's `down` chip label "Down" and its description (registry/statuses.ts, shown where the chip's card is opened), and `refusal-words.ts` `lifeCannot` ("Stabilize and death saves for the dying"). The chip's label on a hunter already reads Dying or Stable.
- A monster at 0 HP now reads Defeated in the GM's order and on a player's list and token card, where it said Down; its card already said Defeated. The players' list hides a defeated monster's band word (Down) for the same reason.
- The GM board's toast after Stabilize is "Stabilized Mira Test." (gm.js); after Revive it is "Revived Mira Test in the fight." Two shapes for one kind of line.
- (Nov 21, stealth unit 8) The Stealth skill's description in `src/core/registry/skills.ts` still says "advantage on Stealth checks": hiding gives no advantage now, a hit from hiding deals 1.5 times (the owner's ruling 3).
