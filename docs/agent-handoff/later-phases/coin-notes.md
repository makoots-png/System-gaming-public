# The coin call: heads or tails on a natural 1 or 20 (the owner, Nov 14, in the rework lead's session)

## What the owner said

"Ok there's also a mechanic I have. It's heads or tails on a 1 or a 20. It should inform me of the players decision (heads or tails) and I pick if they were correct or not (this is hidden to the player) unless it's combat. In combat it's just the true roll 1 or 20."

## How the lead reads it (what gets built; each line is his to change)

- **When.** A hunter rolls a d20 for a check outside a fight and the die shows a natural 1 or a natural 20. A check is a stat check from the Dice view or the sheet, and any plain d20 the player rolls there. Not in a fight: a hunter with a row in a running fight gets the true roll and no coin. The reworked fight has no attack roll anyway; its d20 is the target's reaction die, rolled on the GM's phone, and it stays a true roll. A death save and a shadow extraction are true rolls too (a death save happens in a fight; an extraction has its own rule).
- **The player** is asked "Heads or tails?" and picks one. The coin goes up and stays in the air on their phone.
- **The GM** is told at once, in a window that stays until answered: who, what they rolled for, the natural 1 or 20, and the side they called. The GM taps **Right** or **Wrong**, or **Let the coin decide** for a true flip.
- **Hidden from the player.** The player's phone is only ever told which side the coin landed on. It cannot tell a GM's ruling from a true flip, because the message is the same: the GM's phone works out the side (the called side if Right, the other if Wrong, a real flip otherwise) and sends that. Nothing on the player's phone, in the room's messages or in the session log a player can see says who decided.
- **What it means.** The app shows the coin's side and whether the call was right, in these words, and the GM narrates the rest: on a 20, right is "Critical success" and wrong is "Success"; on a 1, right is "Saved" and wrong is "Critical failure". The app changes no number by it.
- **Alone, with no GM in a room**, the coin is a true flip, since nobody is there to rule.
- **If the GM does not answer**, the coin stays in the air. It does not settle itself: a ruling made by a timer would be a lie about who ruled, and the owner wants to make the call.

## Where it lives (architecture)

- One small explicit machine in core, `src/core/coin.ts`: no call, called (waiting for the GM), landed. A `TABLE` the typecheck checks, a chart in `docs/state-machines.md`, tests in `tests/coin.test.ts`. The rule "is this roll a coin roll" is one pure function there (a natural 1 or 20, a check, the hunter not in a running fight).
- Two room messages by the recipe "A room message": the player's call (who, the roll's id, the face, the side called) and the GM's landing (the roll's id and the side, GM only). Both idempotent by the roll's id; a landing for a roll that already landed is ignored. The landing message has no field that says how the side was chosen.
- The die and a true flip are rolled in `src/edge/roll.ts`. The coin's flight is a move of `src/views/motion.ts`.
- The GM's side of the session log records the ruling (Right, Wrong or the coin); the line a player's phone can see records only the side.
