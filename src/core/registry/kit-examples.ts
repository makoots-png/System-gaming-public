// kit-examples.ts: the kits' built-ins a GM opens and copies in the Workshop (docs/agent-handoff/kits/design.md sections
// 5.2 and 8.12): a stacking status with a threshold, a trigger passive, an ability with an HP cost and a scaler, a
// delayed curse, a mark and its detonation, a reaction and a summon, from Glas's, Einar's and Hwei's kits, and a shadow's
// and a seer's stealth (docs/agent-handoff/features/notes-7-stealth.md section 5's two examples). They are not
// in a hunter's list or the status pickers: a GM copies one into the library (the Workshop's Duplicate) and changes it
// there. Their numbers are the simulation's (`RULES.fight.kit.examples`, tests/models/fight-sim.ts), so each stays inside
// its budget; tests/kit-examples.test.ts checks every entry parses and is not past the tolerance. To add one: an entry
// here, and `bun run test`.
import { abilityId } from '../combat/ability-types.ts';
import type { Ability } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { StackDef, StatusDef, UseOp } from '../combat/effect-ops.ts';
import { tiles } from '../combat/space.ts';
import { tick } from '../combat/timeline.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import type { Rules } from '../rules.ts';
import { abilityOf, suggestedScaler } from './ability-kinds.ts';
import type { AbilityInput } from './ability-kinds.ts';
import type { SkillTemplate } from './skills.ts';

const formula = (text: string, R: Rules): Formula => {
  const p = parseFormula(text, R);
  if ('error' in p) throw new Error(`A kit example's formula does not parse: ${text}: ${p.error}`);
  return p.formula;
};
/** An ability of `kind`, as the skill maker writes it. */
const make = (kind: Ability['kind'], name: string, o: Omit<AbilityInput, 'id' | 'name'>, R: Rules): Ability =>
  abilityOf(kind, { id: abilityId(name.toLowerCase().replace(/[^a-z0-9]+/g, '-')), name, ...o }, R);
const rounds = (n: number, R: Rules) => tick(n * R.fight.round);

/** The example statuses by key, in the order the Workshop lists them. */
export function exampleStatuses(R: Rules): Record<string, StatusDef> {
  const K = R.fight.kit.examples;
  const resonance: StackDef = {
    label: 'Resonance', desc: 'At 3 stacks, all stacks are spent and the bearer takes arcane damage. The lower the bearer\'s HP, the more damage it takes.', ops: [],
    stack: { cap: 3, leave: { kind: 'never' }, keep: 'fight', threshold: {
      at: { kind: 'count', n: 3 }, to: { kind: 'bearer' }, then: 'spend',
      // the burst with the suggested execute (design 8.0): from half HP, up to +100%, the base cut to 0.8
      ops: [{ op: 'damage', type: 'arcane', when: 'use', amount: formula(`(2d6 + mag) * ${K.blood.burst * K.blood.base} * (1 + 1 * max(0, min(1, (target.missing - 0.5) / 0.5)))`, R) }],
    } },
  };
  const signature: StackDef = {
    label: 'Signature', desc: 'At 2 stacks, both are spent, and the bearer and its allies within 2 tiles take arcane damage.', ops: [],
    stack: { cap: 2, leave: { kind: 'never' }, keep: 'fight', threshold: {
      at: { kind: 'count', n: 2 }, to: { kind: 'area', radius: tiles(2), on: 'allies' }, then: 'spend',
      ops: [{ op: 'damage', type: 'arcane', when: 'use', amount: formula(`${K.mark.burst} * (2d6 + mag)`, R) }],
    } },
  };
  const pain: StackDef = { label: 'Pain', desc: 'Each hit you deal adds a stack. Violence spends all of them.', ops: [], stack: { cap: 10, leave: { kind: 'never' }, keep: 'fight', threshold: null } };
  return {
    resonance, signature, pain,
    'crimson-pact': { label: 'Crimson Pact', desc: 'While you have it, you can use Hemoplague.', ops: [] },
    hemoplague: {
      label: 'Hemoplague', desc: 'When it ends, the bearer takes arcane damage. Removing it early cancels the damage.', ops: [],
      end: { ops: [{ op: 'damage', type: 'arcane', when: 'use', amount: formula(`${K.hemo.end} * (1d8 + mag)`, R) }], cleanse: 'cancel' },
    },
    // Hidden even in a foe's sight, at a level that follows the user's rank E to S (section 5, example 1).
    vanished: {
      label: 'Vanished', desc: 'Hidden even in plain view. Being hurt, being revealed or dealing damage ends it.',
      ops: [{ op: 'hidden', level: [0, 0, 1, 1, 2, 2], start: 'anywhere', ends: { hurt: true, revealed: true, dealt: true } }],
    },
  };
}

/** The example skills, as a hunter or the library holds them (no id), in the order the Workshop lists them. */
export function exampleSkills(R: Rules): SkillTemplate[] {
  const K = R.fight.kit.examples, S = exampleStatuses(R);
  const apply = (key: string, n: number | null, stacks?: number): Extract<UseOp, { op: 'applyStatus' }> =>
    ({ op: 'applyStatus', key: statusKey(key), def: S[key]!, duration: n === null ? null : rounds(n, R), ...(stacks ? { stacks } : {}) });
  const active = (name: string, desc: string, ability: Ability): SkillTemplate => ({ name, level: 1, label: null, desc, type: 'active', ability });
  const execute = suggestedScaler('strike', 'execute', R);
  const vanish = make('support', 'Vanish', { desc: 'Gain Vanished for 2 rounds to hide even in plain sight.', aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null, ops: [apply('vanished', 2)] }, R);
  const parryPct = Math.round(R.fight.kit.parry * 100);
  const hpSharePct = Math.round(R.fight.kit.hpShare * 100);
  const sumRounds = R.fight.kit.summonRounds;
  return [
    active('Bloodletting', 'A curse that deals arcane damage and adds a Resonance stack to the target.',
      make('curse', 'Bloodletting', { desc: 'Deal arcane damage and apply Resonance for 2 rounds.', effect: { type: 'arcane', by: 'hand', formula: formula(`${K.blood.share} * (2d6 + mag)`, R) }, ops: [apply('resonance', 2)] }, R)),
    active('Fester', 'A curse that deals more damage for each Resonance stack on the target, then adds one more stack.',
      make('curse', 'Fester', { desc: 'Deal arcane damage that scales with Resonance stacks on the target, then apply Resonance for 2 rounds.', effect: { type: 'arcane', by: 'hand', formula: formula('0.6 * (2d6 + mag) * (1 + 0.15 * target.stacks(resonance))', R) }, ops: [apply('resonance', 2)] }, R)),
    active('Crimson Pact', 'Costs half your max HP. You get Crimson Pact for 3 rounds.',
      { ...make('support', 'Crimson Pact', { desc: `Pay ${hpSharePct}% of your max HP to gain Crimson Pact for 3 rounds.`, aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null, ops: [apply('crimson-pact', 3)] }, R),
        prices: [{ kind: 'hp', amount: { kind: 'share', share: R.fight.kit.hpShare } }] }),
    active('Hemoplague', 'Usable only while you have Crimson Pact. A curse that puts Hemoplague on the target, which deals its damage 3 rounds later.',
      { ...make('curse', 'Hemoplague', { desc: 'Requires Crimson Pact. Apply Hemoplague for 3 rounds. It deals arcane damage when it ends.', effect: null, ops: [apply('hemoplague', 3)] }, R), gates: [{ kind: 'holds', key: statusKey('crimson-pact'), on: 'self', atLeast: 1 }] }),
    active('Executioner\'s Cut', 'Costs 5% of your max HP. The lower the target\'s HP, the more damage it deals.',
      { ...make('strike', 'Executioner\'s Cut', { desc: 'Pay 5% of your max HP to strike a foe. Deals more damage the lower the target\'s HP.', ticks: { scalers: [execute] } }, R), prices: [{ kind: 'hp', amount: { kind: 'share', share: 0.05 } }] }),
    active('Disaster Stroke', 'A curse that adds 1 Signature stack to the target. At 2 stacks, Signature deals its damage.',
      make('curse', 'Disaster Stroke', { desc: 'Deal arcane damage and apply Signature for 2 rounds. At 2 stacks, Signature bursts in an area.', effect: { type: 'arcane', by: 'hand', formula: formula(`${K.mark.share} * (2d6 + mag)`, R) }, ops: [apply('signature', 2)] }, R)),
    active('Violence', 'A strike that spends all your Pain stacks and deals 6% more damage for each one.',
      { ...make('strike', 'Violence', { desc: 'Spend all your Pain stacks to strike a foe, dealing bonus physical damage for each stack spent.', effect: { type: 'physical', by: 'hand', formula: formula(`(1d8 + phys) * (1 + ${K.pain.perStack} * spent)`, R) } }, R),
        prices: [{ kind: 'stacks', key: statusKey('pain'), from: 'self', take: { kind: 'all' } }] }),
    { name: 'Pain is Power', level: 1, label: null, desc: 'Each hit you deal adds 1 Pain stack.', type: 'passive', bonus: {},
      worn: { label: 'Pain is Power', desc: 'Each hit you deal adds a Pain stack.', ops: [], triggers: [{ on: 'hitDealt', tag: null, to: 'self', limit: { kind: 'each' }, ops: [apply('pain', null)] }] } },
    active('Parry', 'Use as a reaction before a strike hits you to reduce its damage. Its action time delays your next turn.',
      { ...make('strike', 'Parry', { desc: `Arm as a reaction before a strike hits you to cut its damage by ${parryPct}%.`, effect: null, ops: [{ op: 'guard', share: R.fight.kit.parry }] }, R), cost: { ...make('shot', 'q', {}, R).cost, fatigue: 0 }, react: { when: 'before', reach: tiles(0) } }),
    active('Call Sprite', 'Once a fight, summon a Sprite, a skirmisher that fights on your side for a few rounds.',
      { ...make('support', 'Call Sprite', { desc: `Once per fight, summon a Sprite skirmisher for ${sumRounds} round${sumRounds === 1 ? '' : 's'}.`, aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null }, R), gates: [{ kind: 'uses', per: 'fight', n: 1 }],
        summon: { name: 'Sprite', archetype: 'skirmisher', rounds: sumRounds, statuses: [] } }),
    active('Vanish', 'You become Vanished for 2 rounds, hiding even in a foe\'s sight. Your stealth level rises with your rank.', { ...vanish, cost: { ...vanish.cost, cooldown: rounds(5, R) } }),
    { name: 'Unseen Blade', level: 1, label: null, desc: 'Dealing damage does not end your hiding, so each hit from hiding is an ambush until you are hurt or revealed.', type: 'passive', bonus: {},
      worn: { label: 'Unseen Blade', desc: 'Dealing damage does not end your hiding.', ops: [{ op: 'stayHidden', on: 'dealt' }] } },
    { name: 'Hunter\'s Eye', level: 1, label: null, desc: 'Your sight level is 2. You can see foes hidden at stealth level 1 or lower.', type: 'passive', bonus: {},
      worn: { label: 'Hunter\'s Eye', desc: 'Adds 2 to your sight level, letting you see hidden foes at stealth level 1 or lower.', ops: [{ op: 'sheet', key: 'sight', amount: 2 }] } },
    active('Flare', 'A blast that reveals everyone in the area. Any stealth that ends when revealed ends, regardless of your sight level.',
      make('blast', 'Flare', { desc: 'Reveal every hidden combatant in the blast area.', effect: null, ops: [{ op: 'reveal' }] }, R)),
  ];
}
