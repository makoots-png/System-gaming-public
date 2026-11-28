// refusal-words.ts: what a refused fight command says, to the GM and to a player. Pure; words only.
//
// Each table is keyed by its union, so a new `Refusal` (fight-types.ts) or `TableRefusal` (fight-doc.ts) does not
// typecheck until it has its words. Before, combat.js and table.js each kept a table of strings checked against
// neither, and the GM read a bare key ("noUses") for every reason the table lacked (implicit audit 3, C5).
import type { Refusal } from './fight-types.ts';
import type { TableRefusal } from './fight-doc.ts';
import type { ChargeFailure } from './charge.ts';

/** What the GM reads when the fight refused a command (combat.js). */
export const REFUSAL_WORDS: { readonly [R in Refusal]: string } = {
  taunted: 'Taunted. It must aim at its taunter.', cooldown: 'Not ready yet.', mana: 'Not enough mana.', range: 'Out of reach.',
  tooLow: 'Their rank is too high for that consumable. Use one of their rank or higher.',
  noTarget: 'Nobody there.', needsRoll: 'The dice did not match.', notNow: 'Not now.', notYourTurn: 'It is not their turn.', down: 'They are out of the fight.',
  needBothSides: 'Each side needs someone still fighting.', tooMany: 'Too many in the fight.', duplicate: 'Already in the fight.', noPlace: 'No free place on the map.',
  rooted: 'Rooted. Cannot move.', blocked: 'The way is blocked.', tooFar: 'Too far for one move.', noMove: 'Already there.', taken: 'That place is taken.',
  noChange: 'Nothing to change.', unknownAbility: 'They do not have that ability.', cutOff: 'Someone would be off the map.', noAttempts: 'No attempts left on this corpse.',
  gated: 'That cannot be used now.', noUses: 'No uses left.', hp: 'Not enough HP to pay for it.', stacks: 'Not enough stacks.',
  extra: 'Only one extra action a round.', zone: 'They have no field with that name.', seen: 'A foe sees them. They cannot hide.',
  offGrid: 'That is off the map.', unknown: 'Nobody by that name is in the fight.', noChannel: 'Nothing is being channeled.',
  notMonster: 'Only a monster can do that.', nothingDue: 'Nothing is due.', noIntent: 'No move was planned.',
  notExtractor: 'Only a hunter in the fight whose job allows extraction can try.',
  notHunter: 'Only a hunter can be refilled.',
  lifeCannot: 'Only a dead hunter or defeated combatant can be revived.',
  fudgeValue: 'Fudge must be a whole number, and a forced roll must be 1 or 20.',
  adjustValue: 'Roll adjustment must be a whole number, and a forced roll must be 1 or 20.',
  notMythic: 'Only a scripted mythic monster has phases and omens.', noOmen: 'No omen is active.',
  omenStands: 'An omen is already active. Resolve, cancel, or drop it first.', omenDue: 'Its omen is due. Resolve the omen move where it was aimed.',
  lastPhase: 'This is the last phase. It ends when HP reaches 0.', weakened: 'The omen is already weakened.',
  noDodge: 'No dodge is open.', dodging: 'Finish the dodge first.',
  ownerOut: 'Add the hunter first, then their shadows.',
  shadowsIn: 'Remove this hunter\'s shadows first.',
  shadowCap: 'This hunter already has the maximum shadows in the fight.',
  notNpc: 'Only an NPC has a play skill.',
  npcSkillValue: 'NPC play skill must be a whole number from 1 to 5.',
};

/** What a player reads when the GM's phone turned down their tap (table.js). */
export const TABLE_REFUSAL_WORDS: { readonly [R in TableRefusal]: string } = {
  range: 'Out of reach. Step closer first.', notYourTurn: 'It is not your turn.', cooldown: 'Not ready yet.', mana: 'Not enough mana.',
  taunted: 'You are taunted. Aim at your taunter.', noTarget: 'Nobody is there.', unknownAbility: 'You did not have that when the fight began.',
  down: 'You are out of the fight.', rooted: 'You are rooted and cannot move.', blocked: 'The way is blocked.', tooFar: 'Too far for one move.',
  noMove: 'You are already there.', offGrid: 'That is off the map.', taken: 'That place is taken.',
  gated: 'That cannot be used now.', noUses: 'No uses left.', hp: 'Not enough HP to pay for it.', stacks: 'Not enough stacks.',
  zone: 'You have no field to end.', extra: 'Only one extra action a round.', seen: 'A foe sees you. You cannot hide.',
  tooLow: 'Your rank is too high for that consumable. Use one of your rank or higher.',
  noDodge: 'That dodge is already over.', dodging: 'Finish the dodge first.',
  notNow: 'Not right now.', noChannel: 'Nothing is being channeled.',
};

/** Plain refusal reason with exact needed and held counts for a failed affordability check (charge.ts `affordCheck`). */
export function chargeRefusalWords(f: ChargeFailure, voice: 'player' | 'gm' = 'player'): string {
  const has = voice === 'gm' ? 'has' : 'you have';
  switch (f.reason) {
    case 'tooLow': return voice === 'gm' ? REFUSAL_WORDS.tooLow : TABLE_REFUSAL_WORDS.tooLow;
    case 'cooldown': return `Not ready yet. Ready in ${f.left} round${f.left === 1 ? '' : 's'}.`;
    case 'noUses': return 'No uses left.';
    case 'mana': return `Not enough mana. Needs ${f.need}, ${has} ${f.have}.`;
    case 'hp': return `Not enough HP. Needs ${f.need} (costs ${f.cost}), ${has} ${f.have}.`;
    case 'stacks': return `Not enough ${f.label}. Needs ${f.need}, ${has} ${f.have}.`;
    case 'zone': return f.name ? `No ${f.name} field to spend.` : 'No field to spend.';
    case 'gated':
      if (f.gate === 'inside') return `Must be inside ${voice === 'gm' ? 'their' : 'your'} ${f.zone}.`;
      return `Needs ${f.need} ${f.label}${f.on === 'target' ? ' on target' : ''}. ${f.on === 'target' ? 'Target has' : voice === 'gm' ? 'Has' : 'You have'} ${f.have}.`;
    default: return f satisfies never;
  }
}
