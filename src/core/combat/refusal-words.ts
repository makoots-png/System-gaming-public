// refusal-words.ts: what a refused fight command says, to the GM and to a player. Pure; words only.
//
// Each table is keyed by its union, so a new `Refusal` (fight-types.ts) or `TableRefusal` (fight-doc.ts) does not
// typecheck until it has its words. Before, combat.js and table.js each kept a table of strings checked against
// neither, and the GM read a bare key ("noUses") for every reason the table lacked (implicit audit 3, C5).
import type { Refusal } from './fight-types.ts';
import type { TableRefusal } from './fight-doc.ts';

/** What the GM reads when the fight refused a command (combat.js). */
export const REFUSAL_WORDS: { readonly [R in Refusal]: string } = {
  taunted: 'Taunted: it must aim at its taunter.', cooldown: 'Not ready yet.', mana: 'Not enough mana.', range: 'Out of reach.',
  noTarget: 'Nobody there.', needsRoll: 'The dice did not match.', notNow: 'Not now.', notYourTurn: 'It is not their turn.', down: 'They are down.',
  needBothSides: 'A fight needs someone up on each side.', tooMany: 'Too many in the fight.', duplicate: 'Already in the fight.', noPlace: 'No free place on the map.',
  rooted: 'Rooted: cannot move.', blocked: 'The way is blocked.', tooFar: 'Too far for one move.', noMove: 'Already there.', taken: 'That place is taken.',
  noChange: 'Nothing to change.', unknownAbility: 'They do not have that ability.', cutOff: 'Someone would be off the map.', noAttempts: 'No attempts left on this corpse.',
  gated: 'That cannot be used now.', noUses: 'No uses left.', hp: 'Not enough HP to pay for it.', stacks: 'Not enough stacks.',
  extra: 'Only one extra action a round.', zone: 'They hold no field of that name.', seen: 'A foe sees them: they cannot hide.',
  offGrid: 'That is off the map.', unknown: 'Nobody by that name is in the fight.', noChannel: 'Nothing is being channeled.',
  notMonster: 'Only a monster can do that.', nothingDue: 'Nothing is due.', noIntent: 'No move was planned.',
  notExtractor: 'Only a hunter in the fight whose job may extract can try.',
  notHunter: 'Only a hunter\'s row can be refilled.',
};

/** What a player reads when the GM's phone turned down their tap (table.js). */
export const TABLE_REFUSAL_WORDS: { readonly [R in TableRefusal]: string } = {
  range: 'Out of reach. Step closer first.', notYourTurn: 'It is not your turn.', cooldown: 'Not ready yet.', mana: 'Not enough mana.',
  taunted: 'You are taunted: aim at your taunter.', noTarget: 'Nobody is there.', unknownAbility: 'You did not have that when the fight began.',
  down: 'You are down.', rooted: 'You are rooted and cannot move.', blocked: 'The way is blocked.', tooFar: 'Too far for one move.',
  noMove: 'You are already there.', offGrid: 'That is off the map.', taken: 'That place is taken.',
  gated: 'That cannot be used now.', noUses: 'No uses left.', hp: 'Not enough HP to pay for it.', stacks: 'Not enough stacks.',
  zone: 'You have no field to end.', extra: 'Only one extra action a round.', seen: 'A foe sees you: you cannot hide.',
};
