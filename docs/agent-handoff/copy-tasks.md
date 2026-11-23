# The app's words

Every sentence the app shows follows this file. The wording pass (`final/notes-wording.md`) read each one against it and removed the last `TODO(copy)` mark. The lint "no placeholder words are left marked" in `tests/lint.test.ts` keeps the mark out of `src`, `public` and `server.ts`.

## The voice

`docs/guide/voice.md` is the main style guide for every player- and GM-facing word. Read it first, and keep using the glossary below for exact game terms.

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
| A hunter's goods handed to another through the room | offer (Offer to Mira, Accept, Refuse, Take back) | trade request, proposal |
| The party's shared goods | the stash, the party stash (Put in the stash, Take) | vault, bank, shared inventory |
| A player's private message to the GM | a word to the GM (Send to the GM, Words from players) | message, DM, whisper |
| A quest only its hunter and the GM see | a secret quest (Secret) | hidden quest |

Two words keep a second meaning on purpose. "Condition" in the ability form's Only when group means a requirement on a use ("Add a condition"), not a status. "Kit" names a weight class of gear in the rules reference's tables and the design docs, never a label a player taps.

## Where the words live

- The room pill's words are `PILL_ROOM` and `render` in `src/edge/room-pill.ts`. The Room view's state words and connection lines are `STATE` in `src/views/room.js`. A new link state gets a line in both.
- What the site is, what a room is, each role's way to one, the next steps after setup and the ? guide's tips are `src/core/first-run.ts` (`ABOUT`, `ROOM_IS`, `ROOM_PATH`, `nextSteps`, `TIPS`, `createdLine`, `LOADED`). The Welcome window, Hunter created, Campaign ready, the ? guide and the Room view read them; say a room's idea there once, not again in a view. `tests/first-run.test.ts` checks that `ABOUT`, `ROOM_IS` and `ROOM_PATH` are one sentence each and that no line of the file has an em dash, an exclamation mark or a semicolon.
- A failed Create or Join says `tapWords` (`src/core/sync/taps.ts`).
- A life that is not up says `lifeWord` (`src/core/combat/row-life.ts`): Dead for a hunter, Defeated for a monster, shadow or summon. The sheet's death panel and chip, the GM's card, order and board, a player's own card and the party's faces, and a token's label read it there.
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

- The life still says "down" in the fight log line "Mira Test is down." (the fight's log). (The rest of this bullet went with the death saves, Nov 21.)
- A monster at 0 HP now reads Defeated in the GM's order and on a player's list and token card, where it said Down; its card already said Defeated. The players' list hides a defeated monster's band word (Down) for the same reason.
- The GM board's toast after Revive is "Revived Mira Test in the fight." in a fight and "Sent Revive to Mira Test." for a hunter no fight holds (gm.js). Two shapes for one kind of line.
- (Nov 21, stealth unit 8) The Stealth skill's description in `src/core/registry/skills.ts` still says "advantage on Stealth checks": hiding gives no advantage now, a hit from hiding deals 1.5 times (the owner's ruling 3).
- (Nov 21, item-stats unit 5) A trigger's line on a card reads "struck: Heal: 1d4 on the other": two colons and a lower-case event. Wants one sentence ("When struck, heals the other 1d4").
- (Nov 21, coin-noside) The words a player's phone shows once the GM ruled a coin in a room: "Flipped" under "You called Heads", then "The GM tells you how it landed." (`coinWords` in `src/core/coin.ts`, `rowHtml` in `src/views/coin.js`; the second line is built in the view). The Dice view's flag reads "Flipped" too. The log line is "Natural 20 for STR check. The GM flipped the coin." though the GM may have ruled by hand; "flipped" was kept as the owner's word. The GM's window body now reads "Was the call right? The player's phone shows only that the coin was flipped. Tell them how it landed.", and the GM's toast after a ruling "Kai called Heads. It landed Heads: Critical success." Both want a read for length on a 390 px phone. The Rules page sentence (`naturalLines` in `src/core/rules-text.ts`) was changed to say the phone shows only that it was flipped; it is long.

- (Nov 21, items-9) The item maker's labels "Its wearer can use" and "Grows with": plain enough? Read them in the copy pass.
- (Nov 21, no-death-saves) Death saves are gone: at 0 HP a hunter is dead, and a revive takes off every status. New or changed words to read: `DIED_WORDS` ("HP has reached 0. You are dead. The GM's Revive or a Resurrection Crystal brings you back.", vitals.ts) and the room's toast "You are dead. {reason} The GM's Revive or a Resurrection Crystal brings you back." (room-events.ts `diedTold`; the reason is the fight's own sentence, so it reads as three sentences); the sheet's death panel note "... brings you back, with every status gone." (hunter.js) and the Dead chip's card "HP reached 0. ... brings the hunter back, with every status gone." (registry/statuses.ts); the HUD line beside Dead in a fight (table.js `deathHtml`, built in the view); `CHIP_REFUSAL.dead` "Dead follows HP and ends with a revive."; `lifeCannot` "Not in this state: Revive is for the dead."; the odds' "Dead in 30%." / "Never dead in these plays." / "Mira is most likely to die (30%)." / "Nobody died." (odds.ts), which also speak of a shadow in the party as dead; the Chronicle's number "Deaths" (was "Times down"); the Rules page's `deathLine`. The feats and the fight log still say "down" for a hunter at 0 HP ("Thread's End: without going down", "The Anvil: in which you went down", "Clean Sheet", the log's "is down."): with no getting up, "down" now means died.

- (Nov 21, fudge unit 7) The GM's fudge words in Fight tools and on a card (`fudgeBlock`, `fudgeCard`, `fudgeLine` in `src/views/combat.js`): the block heading "Fudge" with steppers "Hunters" and "Foes"; a card's stepper "Fudge", its choice "Next roll" with "20", "1" and "Off" (the notes say "off"; the Reaction choice beside it says "None"); the line "Fudge +2" and "Next roll 20"; the screen-reader name "Fight tools, fudge on". Read them in the copy pass.
- (Nov 22, trade unit 4) Words of trading on screen that notes-5-trade.md section 7 did not give, all in `src/core/trade/words.ts` (`TRADE_WORDS`): the Give window's action before a hunter is picked, "Give" (disabled); "No other hunter to give to." when the window has no one to list; the toast after an offer "You offered Mira 1 Healing Potion. See your Bag, under Offers." and after a hand over "Brakk gave Eldrin 1 Healing Potion."; the giver's own line on the Offers tab "You offer Mira 1 Healing Potion for 20 gold."; the GM's line while a stop waits for the room "Stopped. Waiting for the room."; the head summary "1 open" (the stash's part is unit 5's). The stranded giver's window reads "If Mira did, Mira has 1 Healing Potion too." where the notes had "If she did, she has the Healing Potion too.": the app does not know a hunter's pronoun. The taker's offered line (offer.ts `STATE_WORDS`) reads "for your 20 gold" and "for your 1 Iron Shield" where the notes had " for 20 gold." and " for your Iron Shield.". An item the Give window asks for is asked one at a time ("From Mira's bag" chips ask 1 each).
- (Nov 22, the lead's look at 390 px) GM Party board, a player's hunter card: the row −5, −1, +1, +5, Status, Build is too tight; "Status" is clipped by "Build".
- (Nov 22, trade unit 6) Words of the word to the GM that notes-5-trade.md section 7 did not give, all in `WORD_WORDS` (`src/core/sync/word.ts`): a lost word's line "The room did not take this word."; the refusals "This hunter is no longer on this phone.", "Only the hunter you play in this room can send a word.", the GM's "This word is no longer on this phone.", "This word has an answer already.", "Answers go in the room the word came from. Go back to that room first."; the notification's body "Open the GM view to read it." (the word itself is left off a lock screen); the toast tag "Word" on the GM's phone; the session log titles "Word to the GM" and "Answer to a word". The GM's switch still reads "Notify me when a player uses a reward" and "On: a reward use shows a notification while this page is hidden." though a word notifies too (gm.js `NOTIFY_WORDS`; `used.e2e.ts` reads them).
- (Nov 22, trade unit 7) Words of the secret quest that notes-5-trade.md section 7 did not give, all in `SECRET_WORDS` (`src/core/hunter/quest-secret.ts`): the quest's window on the player's phone gains the line "SECRET: Only you and the GM see this quest.", in the style of its "PENALTY FOR FAILURE:" and "DUE:" lines; the GM's Table feed marks the line too ("Mira · Quest \"Unmask the traitor\" (secret) active"). The refusal "A secret quest goes to one hunter." shows in the line under Issue quest, not beside the box or the hunter list (Award section), which are far apart on a phone.
