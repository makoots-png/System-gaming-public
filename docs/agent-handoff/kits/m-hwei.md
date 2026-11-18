# Maro and Hwei kits, and the Conditions tab

Source: Google Sheet "ToG - Act 3", tabs Maro, Hwei, Conditions. Read only. Row numbers are counted from the chunks read and may be off by one or two. Quotes are exact, spelling included.

---

## Maro

**Concept.** A Voidal cult leader and relic hunter. He fights with a sword and a field of Corruption around him, and he summons Sprites and Shinsuu barriers from a Lighthouse. Distinct: one enemy counter (Corruption) that drives his damage and his Aura income, plus relics he binds to himself.

**Tracked things**
- **Corruption** (on one enemy, "Condition Table" Maro!B98:C108). Gained: Aura of Corruption gives each enemy in the area 1 stack "every turn"; with Void Knight each sword hit gives 1 stack. Read by Purify (damage) and by Endless and Eternity (Aura Regen per stack on the field). Moved by The Cycle Continues. Cap and reset: none written.
- **Supress** (Y/N per enemy, same table). Set by the Void branch of Aura of Corruption. The Conditions tab spells it "Suppress": "Disables effects of Domain". "Domain" is never defined.
- **Aura of Corruption** (a zone on the ground, 60ft diameter, around him). Costs "20 Aura per Turn" in the ability list but "10 Aura per Turn" in the tree. Listed as used 1 time. Tree options: Null makes it Difficult Terrain; Void inflicts Suppress inside it. Neither is acquired.
- **Aura pool** also tracks "Total Energy Spent" (A85:D93).
- **Sprite** (a summon, 60ft movement per turn, directed by his will). Disperses when it takes a Negative Condition (Essence Transfer) or tanks an attack (Celestial Tether). Count and cap are not written.
- **Special Sprites** Pathorium, Luminorium and Memorium: once per day. Historium: once per week; "If the ability fails, you can cast it again the next day". Rows 77-81.
- **Fated Relics**: Relic Fated lets him set 3 equipment as Fated. Prophet of the Void lets him Doom them.
- **Relic grade counters**: Alrender shows "Relics Fed 1/?", Crimson Reliquary "Fingers 2/?", Underbrush "Doomed Relic". The meaning of the "?" is undefined.
- **Aegis barrier** (Shinsuu barrier, 10 HP per 20 Aura spent, 10 per 10 with Bastion). Not acquired.

**Abilities** (A44:O60 and A78:O81)
- Dash: free, 10 Stamina, self; +10ft movement per use.
- Disengage: free, 20 Stamina; leave melee with no opportunity attack.
- Parry: free, 30 Stamina, melee; takes 0.25x on success, 0.75x on failure.
- Transfer: free, 10 Aura, line of sight; gives an ally an action on his turn.
- React: free, 30 Aura; he acts before another combatant.
- Devour: no cost; consume beings or objects of great power for "a small portion of that arcane might". Effect undefined.
- Aura of Corruption: above.
- Purify: free, 30 Aura, 30ft in the list (60ft in the formula table). Damage scales with Corruption Stacks on the target (formula row 132).
- Doom: free, 100 Aura, 30ft; Paralyze one enemy inside his Aura until the start of its next turn; used 1.
- Sever: 1 AP; one extra sword attack; stacks with Smite.
- Smite: 2 AP; sword attacks deal massive damage in a 10ft AoE; "counts as an Ultimate". The formula table has a "Smite?" flag (I133:J133).
- Summon Sprite: free, 10 Aura (1 AP in the tree), 60ft.
- Essence Transfer: free, 20 Aura; Sprite takes one Negative Condition from him or an ally.
- Celestial Tether: free, 30 Aura; as a Reaction, pull a Sprite to himself or an ally to tank an attack.
- Weapon Attack: 2 AP, Power against Discipline, scales with Power.
- Tree-only: Aegis (1 AP), Ignite (2 AP, 30 Aura; ally within 100ft gets Reinforce or Harmonize), Beacon (1 AP, 20 Aura; ally within 100ft gets Inspire). Rows 345-380.

**Passives, titles, items**
- Void Knight: sword attacks target Discipline and add 1 Corruption.
- Retribution: a successful Parry grants an Opportunity Attack.
- Deliverance: Advantage on defense when parrying.
- Rend: "When an enemy dies to your Sword Weapon Attack, regain all Action Points used in the killing blow".
- Sword Expert: Advantage on sword attacks. Sword Master: sword attacks cost 1 AP.
- Endless: +1 Aura Regen per Corruption stack on the field. Eternity: +2.
- The Cycle Continues: "When an enemy with Corruption Stacks dies, their Stacks get transferred to the highest Health enemy within your Aura".
- Relic Sense, Old Stories, Fated Meeting: relic detection and roll bonuses.
- Sacred Bond: on death, his soul enters a Fated Relic.
- Champion of the Forgotten: "burn relic for one last hoorah".
- Malignance, Hatefog: "Successfully using an ultimate ability creates a 10ft AOE scorched zone which applies a DOT curse to enemies, lasts 3 turns after the ultimate ends".
- Crimson Reliquary, Demoralize (active): "Frightened to all enemies within 60ft".
- Grasswhistle: 2 free Parries per combat.
- Underbrush, Nature's Corruption (active): 60ft field of thorny vines, damage each turn, Difficult Terrain, he is immune.
- Backlash: Shinsuu Barriers have 1 HP and Reflect the attack.
- Wingstalker: a Lighthouse that is invisible, with Nimble Escapist (double speed when returning).
- Alrender, Terminus Stage 1: the passive text is cut off.

---

## Hwei

**Concept.** A Visionary painter who makes emotions real as Paintings of three types, Disaster, Torment and Serenity. He builds marks, orbs and stacks from them. Distinct: the order of his paintings in a round triggers bonuses, and the stacks can be handed to allies.

**Tracked things**
- **Baang** (a summon or orb on self). Gained: Manifest Baang (1 AP, 60ft), 3 at a time, raised to 5 by Fifth Stroke (Seventh and Ninth not acquired). Easel of the Master: "two baangs for free every turn". Spent by Baang Release (damage by number of Baangs, or heal 10 HP each with Inkbound Grace) or Detonate Baang (30ft AoE, unmanifests).
- **Signature mark** (on one enemy). Put on by a Disaster or Torment hit, consumed by the next one, dealing 30ft AoE damage. Consuming with a Disaster gives Advantage on the next Attack Roll (Shattered Canvas). With a Torment it gives Advantage on the next Defend Roll (Cracks in the Frame).
- **Mood** (on self). "At the start of your turn your Mood changes to the type of Painting you did last". What a Mood does is undefined. The rows for Disaster, Torment and Serenity read "something about changing passive proc", "^" and "^^".
- **Energize, Kindle, Vitalize** (stack counters on self or an ally, Condition Table columns K:M). Gained: painting a Disaster gives Energize, a Torment gives Kindle, a Serenity gives Vitalize. Each stack is +10 Stamina, Aura or Health per the Conditions tab. Muses move any number to an ally within 100ft. Cap and reset: none written.
- **Stirring Lights** (3 flares on self or an ally): each is consumed for x1.3 damage.
- **Zones**: Molten Eruption (2 turns), Moonlit Reflection (2 turns, grants Fortify inside).
- **Gaze of the Abyss**: an invisible eyeball with a 30ft trigger.
- **Illusory Double** (from Golliptan Garb): an illusory double that disappears if attacked.
- **Swim With the Fishes** (from Sea of Shadows): a state for 3 turns, once per combat.

**Abilities** (A52:O80)
- Manifest Baang: 1 AP; no cost.
- Font of Inspiration: 1 AP, 5 Mana, melee; paint whatever you wish into reality. Needs the title Visionary.
- Signature of the Visionary: passive, 30ft AoE.
- Spiraling Despair: 5 AP, 40 Mana, 80ft, 50ft diameter; explodes. Marks created "for the next two rounds" are immediately consumed.
- Devastating Fire: 2 AP, 20 Aura, 60ft, 30ft AoE; damage by enemy Max HP; no roll.
- Severing Bolt: 2 AP, 20 Aura, 120ft, chains in 20ft; more damage on a hampered enemy.
- Molten Eruption: 2 AP, 20 Aura, 60ft, 50ft zone; Difficult Terrain and damage on entering or starting a turn; 2 turns.
- Gaze of the Abyss: Restrain.
- Crushing Maw: 80ft, 50ft; pulls enemies to the center.
- Grim Visage: Frighten.
- Inviting Allure: Charm.
- Fleeting Current: 100ft path; free movement and no Difficult Terrain.
- Moonlit Reflection: Fortify zone.
- Stirring Lights: 60ft; Stirring Lights.
- Reap what is Sown: Safeguard until the end of the target's next turn.
- All of Gaze through Reap cost 2 AP and 20 Aura. The sheet does not say which painting each belongs to.
- Baang Release and Detonate Baang: free, 60ft (rows 137-138).

**Passives, titles, items**
- Colors of Frustration: Disaster then Torment as the first two paintings gives Animate until the end of the next turn. If already Animated, he rises to the top of the Initiative Order.
- Colors of Nostalgia: Torment then Serenity gives Alert (range 60ft if already Alert).
- Colors of Resilience: Serenity then Disaster gives Roused (bonus 2d6 if already Roused).
- Visionary title: Font of Inspiration, "+5% to Charisma & Control". The title table adds +2 and +2.
- Slime Crown: +3 on defence rolls against AoE.
- Billowing Robes: Animated for 1 turn at combat start.
- Mercy's Cape: any attack may be made non-lethal, even after its result.
- Sea of Shadows: once per combat, almost untargetable and CC Dispelled for 3 turns.
- Imagined Reverie: "Envisioner's Legacy - ???".

---

## Conditions

Layout (A2:AF168). Each row is a condition. Columns B:X are one cell per target (Enemy 1-10, Ally 1-5 and the named PCs). Then Sum, Stats Affected, Extra Notes/Effects, Add. Conditions and Mult. Conditions.

Families:
- Standard toggle conditions (rows 4-34), written "N" or "Y" per target. Positive: Alert, Rouse, Inspire, Animate, Reinforce, Harmonize, Fortify, Bless, Invulnerable, Safeguard, Proliferate. Negative: Prone, Blind, Deaf, Halt, Grapple, Restrain, Frighten, Charm, Berserk, Madness, Shackle, Suppress, Stun, Paralyze, Curse, Petrify, Negate, Infectious. Removers: Dispel, Purge.
- Unique player standard conditions (rows 38-46): Celestial Sea, Brutalize, Carnage, Continuum Shift and others. Several have a starred companion row for the secondary effect.
- Injuries (rows 50-55): Fractured and Broken Leg, Arm and Rib.
- Temporary boons (rows 59-65): Well Rested, Blessed, Heroic, Exalted, Mini-Boss, Boss, Wither.
- Stacking conditions (rows 69-92), numeric counts instead of N/Y. Positive: Strong, Hardy, Fast, Rejuvinate, Cure, Stealth, Fury, Haste, Sacred, Vitalize, Energize, Kindle. Negative: Weak, Fragile, Slow, Poison, Bleed, Chill, Root, Decay, Sanctify, Waste, Fatigue, Sap.
- Unique player stacking (rows 96-158): Ruin, Confrontation, Corruption, a Celestial Cycle of eight moon phases and others.
- Environmental (rows 162-166): Cold, Heat, Hunger, Thirst, Exhaustion.

Stacking and duration. A stack is a number in the target's cell. "Add. Conditions" is a per-stack additive amount and "Mult. Conditions" is a per-stack multiplier, with no units given. The rows for the single-stack conditions in the Maro and Hwei kits carry Sum 0 or 1. Duration has no column. It appears only in notes ("for 1 turn") and in the ability text. Environmental stacks have a threshold: "Upon reaching 5 Stacks of Cold you gain the Deaf condition, this can only be cleansed through reducing Cold Stacks".

Five examples, exact:
1. Dispel: "Removes first active Negative Condition applied (applies to all stacks of a stacking condition). Cannot Dispel Petrify".
2. Safeguard: "No additional negative status conditions can be applied for 1 turn".
3. Proliferate: "Spread next postitive condition to one ally within 10ft of you (includes all stacks applied in that instance, does not spread Invulnerable)".
4. Rouse: "Gain a D6 dice you can add to any roll, must declare before you roll, Removed after use".
5. Paralyze: "Cannot use Energy, all Attack Rolls against you automatically crit".

---

## Building blocks

1. **A counter on an enemy that abilities add to and read.** Corruption: Aura of Corruption, Void Knight, Purify, Endless, Eternity, The Cycle Continues (Maro!B98:C108, rows 53, 54, 132, 306-320). Hwei's Signature mark is a one-shot form (rows 54, 136).
2. **A mark that is consumed by the next matching hit and then detonates in an area.** Signature of the Visionary, Spiraling Despair, Shattered Canvas, Cracks in the Frame (Hwei rows 54, 55, 136, ~340-346).
3. **A trigger on kill.** The Cycle Continues, Rend (Maro ~320-340).
4. **A trigger on a successful Parry.** Retribution, Deliverance (Maro ~330).
5. **Stacks on self or an ally that are gained from an event and handed to an ally.** Energize, Kindle, Vitalize with the Muses (Hwei K98:M121, rows ~341-352).
6. **A trigger on the order of the first two abilities used in a round.** Colors of Frustration, Nostalgia, Resilience (Hwei ~346-350).
7. **A mode that changes from the last painting used.** Mood Swings (Hwei C64).
8. **An ability whose cost is an amount per turn that keeps a zone going.** Aura of Corruption: a zone around the caster with a per-turn payoff and options that add terrain or a condition (Maro row 53, tree R302:T309).
9. **A summon with its own movement, a one-use reaction role, and a use limit per day or week.** Sprite, Special Sprites, Essence Transfer, Celestial Tether (Maro rows 58-60, 77-81).
10. **A resource holder on self with a cap that perks raise.** Baang (3, 5, 7, 9) and its two spend modes, damage or heal 10 per Baang (Hwei rows 52, 137-138, ~351-358).
11. **A zone that lasts a set number of turns and acts on entering or starting a turn.** Molten Eruption, Moonlit Reflection, Hatefog, Underbrush (Hwei rows 71, 78).
12. **Damage that scales with a state of the target.** Max HP percent (Devastating Fire), "Enemy CC'd?" (Severing Bolt), stack count (Purify) (Hwei rows 132-133, Maro row 132).
13. **A cost paid in Aura, Mana, Stamina or AP, and an extra attack that costs extra AP.** Sever and Smite (Maro rows 56-57).
14. **A flag naming an ability "an Ultimate" that other items react to.** Smite and Malignance's Hatefog (Maro row 57, item rows ~189).
15. **Once per day or once per combat limits.** Special Sprites, Swim With the Fishes (Maro rows 78-81, Hwei item rows).
16. **An item with an active ability and a passive with a trigger.** Crimson Reliquary, Underbrush, Billowing Robes, Mercy's Cape (item tables).
17. **A fixed number of free uses per combat.** Grasswhistle's 2 free Parries.
18. **A tree of perks with prerequisites and points, where a perk grants an ability or modifies one.** Maro A325:O380, Hwei ~A330:O360.
19. **A shield/barrier whose HP is derived from the Aura spent.** Aegis, Bastion (Maro ~R363:T380).
20. **A toggle that lets a player choose non-lethal damage after the roll.** Mercy's Cape.
21. **A conditions table where each condition is a named record: per-target value (toggle or stacks), stats it changes, an additive and a multiplicative amount, and a text note.** Conditions A2:AF168.
22. **Conditions that grant other conditions at a stack threshold.** Cold, Heat, Hunger, Thirst, Exhaustion (rows 162-166).
23. **A condition that spreads to a nearby ally.** Proliferate, Infectious (rows 16, 34).

**Undefined or blank in the sheet**
- Maro: Devour's effect; what Domain is; the Terminus stage meaning; "Relics Fed 1/?", "Fingers 2/?"; Aegis cost "XX Aura"; the cap and reset of Corruption; how many Sprites at once; Will of the Ancients (no text); Aura of Corruption cost 20 or 10; Purify range 30ft or 60ft; Bless is written "Action Points -2" like Curse. The Notes section (row ~470) is empty. A "TWEAK A LIL BIT" note sits beside the tree.
- Hwei: what a Mood does; the effect of Disaster, Torment and Serenity; "Envisioner's Legacy - ???"; the painting group of each ability; the prerequisites "Colors of Impotence" and "Tools of the Artist", which are not listed as perks; caps and resets of Energize, Kindle and Vitalize; Molten Eruption area (50ft diameter versus 40ft long, 20ft wide); the blank row 72 with 2 AP and 20 Aura. The Notes section is empty.
- Conditions: no unit for Add. and Mult.; no duration column; Celestial Sea, Brutalize, Hemoplague, Sanguine Resonance, Celestial Rot, Clockwork Madness and Rising Moon have no notes; "Accumulation" has a #REF! error in the Ori-3 cell.
