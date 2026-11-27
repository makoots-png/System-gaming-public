# Writing for players and GMs

Use this guide for every word a player or GM sees in The Hunter System. Read this file before you write or change any UI string, rule description, toast, or prompt. Use the glossary in `docs/agent-handoff/copy-tasks.md` for exact game terms.

## 0. Nobody should have to guess (the top rule)

the owner, Nov 22: "I shouldn't have to guess what menu options mean. What the fuck is own -0+". This rule outranks every other rule in this file.

Every label, button, chip, menu option, segmented control, tooltip and description says what it does in plain words that a first-time player or GM understands without guessing. Read each one cold, as someone who opened the app today. If you would have to tap it to find out what it means, rewrite it.

- No one-word jargon labels ("Own", "Weight", "Tie", "Pot", "Fold"). Name the thing and whose it is.
- No bare symbols. A stepper or a set of options ("− 0 +", "20 / 1 / Off") has a visible label that says what it changes.
- One name for one thing everywhere, the plainest one.

- Bad (`src/views/gm.js` weightCard): a stepper labeled "Own" with "− 0 +", under a board line "Dice weight / Hunters". It is the GM's hidden fudge on one hunter's rolls, added to the fudge on every hunter.
- Good: "Fudge on Teo's rolls: −  0  +", and on the GM board "Fudge on all hunters' rolls: −  0  +". Call it Fudge everywhere, never Weight.
- Bad (`src/core/registry/bundles.ts` SHELF_WORDS): a Give shelf chip "Yours" / "own".
- Good: "Bundles you saved".
- Bad (`src/views/combat.js`): a control "Next roll" with options "20", "1", "Off".
- Good: "Force this hunter's next d20: Natural 20 / Natural 1 / Don't force".

## 1. Who reads this

A person at a table reads this app on a phone in the middle of a game. Put the most important fact first. Say what to do next only when the reader has an action to take.

- Bad: "In order to view the fight summary after combat has concluded, you can tap the End fight button."
- Good: "The fight is over. Tap End fight to see the summary."

## 2. Write like a person talking

Write plain, direct American English. Aim for sentences under 20 words, with one idea per sentence.

- **Use "you" and direct commands.** Wikipedia avoids second person because an encyclopedia is not a how-to guide. This app is a tool people use mid-game, so follow plainlanguage.gov. Address the reader as "you" and write instructions as commands ("Tap Approve", "Select a hunter").
- **Use active voice and present tense.** Name who acts. Use passive voice only when no person acts or the actor does not matter.
- **Use common words and real verbs.** Cut hidden verbs ("Confirm your points", not "Confirmation of your points"). Keep articles ("a", "the") and verbs so readers do not decode clipped fragments.

## 3. Banned patterns

### Personified UI elements and objects

A person, the GM, the player, or "you" acts. Buttons, panels, rooms, and dice do not give, keep, hold, wait, show, say, decide, or answer. Check the code when a line describes network or game state so you state the literal fact.

- Bad (`src/core/hunter/pending.ts`): "Approve gives it to Mira; fold Award to leave it waiting."
- Good: "Tap Approve to give it to Mira. Close Award to leave it waiting."
- Bad (`src/views/combat.js`): "The fight is over. End fight shows the summary."
- Good: "The fight is over. Tap End fight to see the summary."
- Bad (`src/core/sync/connection.ts`, `src/views/gm.js`): "It reaches the GM when the room answers."
- Good: "Saved. The GM gets it when your phone reconnects to the room server." (In code, `postNews` returns `waits` while the phone is reconnecting, connecting, or waiting on a poll. Use "once the room server confirms it" when the phone is still polling an earlier send.)
- Bad (`src/core/rules.ts`): "past 30 the die decides no DC"
- Good: "above 30, a d20 roll no longer changes whether the check passes"

### Clever lines, figures of speech, and clichés

If a literal reading makes no sense in context, rewrite the sentence. Cut metaphors, idioms, wordplay, puns, contrast for effect ("not X, it is Y"), closing one-liners, and rhetorical questions.

- Bad (rejected award text): "The scene pushed and the hunter did not move."
- Good: "You stayed in character during a hard scene."
- Bad (`src/core/rules-text.ts`): "the run is one more play and can go better or worse"
- Good: "Your solo run is a separate fight and can turn out better or worse."
- Bad (`src/core/rules.ts`): "ten rounds is past any fight's patience"
- Good: "more than ten rounds is longer than a fight lasts"

### Semicolons joining clauses

Write two sentences instead of joining clauses with a semicolon.

- Bad (`src/views/rulesref.js`): "A hidden second dungeon; the GM reveals it."
- Good: "A hidden second dungeon. The GM reveals it."

### Em dashes and dash substitutes

Do not use em dashes, spaced en dashes, or `" -- "` as a dash. Use a period, comma, colon, or parentheses. For a number range in prose, write "to".

- Bad (`src/views/rulesref.js`): "Skill levels run 1–10; level 10 shows MAX."
- Good: "Skill levels run from 1 to 10. Level 10 shows MAX."

### Possessive chains

Do not stack possessives like "the fight's weight's" or "the gate's Clear's pot". Rewrite with "of" or split into two sentences.

- Bad (`src/core/rules.ts`): "a grade's factor on its tier's price"
- Good: "the price multiplier for a grade within its tier"

### Filler and polite padding

Cut "just", "simply", "successfully", "please", and "sorry". Also cut AI-ism and marketing filler: "seamlessly", "effortlessly", "dive in", "empower", "tapestry", and "streamline". Use a plain, literal verb or noun instead.

- Bad (`src/core/dc-pick.ts`): "No DC (just roll)"
- Good: "No DC (roll only)"
- Bad (`src/core/combat/fight-view.ts`): "fires just before the turn of the one you pick."
- Good: "fires right before that target's turn."

### British spellings

Use American spelling everywhere: color, center, defense, armor, harbor, canceled, gray, judgment.

- Bad (`src/core/combat/fight-view.ts`): "Put a shield on a hunter standing on its centre tile"
- Good: "Put a shield on a hunter standing on its center tile"
- Bad (`src/core/registry/keystones.ts`): "Advantage on its next defence roll."
- Good: "Advantage on its next defense roll."
- Bad (`src/core/combat/fight-turn.ts`): "is cancelled"
- Good: "is canceled"

### Slogans and coined labels

Do not invent a clever noun for something that already has a plain name. Call each thing by its one glossary word in `docs/agent-handoff/copy-tasks.md` ("fight" not "encounter", "mana" not "MP", "bag" not "inventory", "room" not "campaign room").

- Bad (`src/views/rulesref.js`): "share the gate's XP as its pot"
- Good: "split the gate's XP among the hunters who fought"
- Bad (`src/core/registry/bundles.ts`): "Soft Spot for Mira, from the shelf. Edit it here; Give holds it under Undo."
- Good: "Soft Spot for Mira. Edit it here. Tap Give to send it. You can undo it right after."

### Exclamation marks

Do not use exclamation marks outside a System window tag or title.

- Bad: "Saved!"
- Good: "Saved."

## 4. What may have voice

Feat, award, title, quest, and item names may have style, and a System window's tag and title may keep the System voice (`! Notification`, `LEVEL UP!`, `ARISE`, `REWARD RECEIVED`). Everything that explains what the thing does, when it happens, or what the player sees stays plain.

- Allowed name: "Held the Mask"
- Required description: "You stayed in character during a hard scene. You get 1 ability point."

In-world flavor (System messages, item lore, monster descriptions) may carry tone, as long as it stays literal, clear, and spelled in American English. No riddles or aphorisms. For example, rename `Jaws Like a Harbour` (`src/core/registry/monsters.ts`) to `Jaws Like a Harbor`. The read-aloud world primer (`WORLD_PRIMER` in `src/core/first-run.ts`) is the owner's in-world speech and is exempt from the UI voice rules. The drawer labels and tips around it follow this guide.

## 5. Buttons, labels, headings, and chips

Write each button, label, heading, or chip as a short verb or noun in sentence case. It must fit on a 360 px screen (the room button stays at most 96 px wide, and `short_name` stays at most 12 characters).

When a hint refers to a button, use the exact words on that button. If the button says `Send award`, write `Tap Send award`, not `Send the reward`. Never write `(s)` plurals. Write singular and plural forms explicitly.

## 6. Refusals and errors

State what is wrong and what to do next. Blame nobody, stay calm, and never shout. When a connection drops, stay calm and say nothing is lost only when the app has saved the data.

- Bad: "Sorry, please select a hunter first!"
- Good: "Select at least one hunter."

## 7. Numbers

Give exact numbers instead of vague complaints.

- Bad: "You do not have enough gold to respec."
- Good: "Respec costs 200 gold. You have 150."

## 8. How these rules are enforced

Lint tests in `tests/lint.test.ts` enforce the mechanical rules, with one test named for each rule: em dashes, semicolons between clauses, the word "just", AI-ism filler words ("seamlessly", "effortlessly", "dive in", "empower", "tapestry", "streamline"), American spellings, and personified UI elements or objects.

Human review checks the rules that require judgment: subtle personification outside the lint pattern, cleverness and idioms, possessive chains, coined labels, and matching button names. Read this file before you write any player- or GM-facing string, and review new copy with `.claude/skills/humanizer/SKILL.md` and `.claude/skills/unslop/SKILL.md` before you commit.
