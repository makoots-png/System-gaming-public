// keystones.ts: what every keystone does, once (docs/agent-handoff/features/notes-11-keystones.md, design A.3 and A.6).
// A keystone is a power a body earns when one stat, or two together, hold a large share of the points it spent; who
// earns which is src/core/hunter/keystones.ts (`keystonesOf`). Here each keystone is its name, the line a player reads,
// its stat bonus and its powers (`Powers`, the shape a title's and an item's are), and for a confluence the powers its
// job's Job Change adds (`awakened`). Pure, and nothing reads it in a fight until unit K4.
// Each keystone is made from the rules it is read under (`KeystoneMaker`), as the kits' examples are, so a round's ticks
// and a kind's costs are the room's. The three tables are `Record`s over the stats and the pairs: a new stat does not
// compile until it has its Mark, its Apex and its seven confluences.
// Its amounts are held by tests/keystones.test.ts ("every keystone spends within its tier's budget": item-budget.ts
// `powersSpend` at the tier's rank against `RULES.fight.keystone.budget`) and, for what that cannot weigh, by the sim's
// rows (unit K5). Each amount is A.6's unless its row says why it moved; a weighed one says beside it what it weighs.
// To change one: its row here, and `bun run test`.
import type { Rules } from '../rules.ts';
import type { StatKey } from '../stats.ts';
import type { StatPair } from '../hunter/keystones.ts';
import type { KeystoneKey } from '../hunter/keystones.ts';
import type { Bonus } from '../hunter/derive.ts';
import { parseFormula } from '../formula.ts';
import type { Formula } from '../formula.ts';
import { DAMAGE_WORD, damageTypeOf } from '../combat/damage-type.ts';
import { abilityId } from '../combat/ability-types.ts';
import type { Ability } from '../combat/ability-types.ts';
import { statusKey } from '../combat/effect-ops.ts';
import type { LandOp, Op, Reach, StackRule, StatusDef } from '../combat/effect-ops.ts';
import type { Limit, Trigger } from '../combat/triggers.ts';
import { tiles } from '../combat/space.ts';
import { tick } from '../combat/timeline.ts';
import type { Tick } from '../combat/timeline.ts';
import { abilityOf, CHANNEL_TAG, defaultTicks, KIND_TAG, recommended, SPELL_TAG } from './ability-kinds.ts';
import type { KindRules } from './ability-kinds.ts';
import type { Powers } from './powers.ts';

/** What a keystone is made under: the fight's numbers (a round's ticks, a kind's costs) and the dice a formula may hold. */
export type KeystoneRegistryRules = KindRules & Pick<Rules, 'dice'>;
/** A keystone: its powers, with the words a player reads and the bonus it puts on the sheet. */
export type Keystone = Powers & {
  /** What every screen calls it: "Follow Through". */
  readonly name: string;
  /** The one sentence a player reads, in plain words. The ops' own words come from `opLine`. */
  readonly line: string;
  /** Points on the sheet's numbers, added as the `keystone` source (unit K4); {} for none. */
  readonly bonus: Bonus;
  /** A confluence only: powers added when the hunter's job names this pair and its Job Change chain is done (A.5); null for none. */
  readonly awakened: Powers | null;
  /** Optional plain description of an awakened confluence's powers when its awakened power is an active ability. */
  readonly awakenedLine?: string;
};
/** One keystone, made under the rules it is read with. */
export type KeystoneMaker = (R: KeystoneRegistryRules) => Keystone;

// ── the parts every row is written with ──
const formula = (text: string, R: KeystoneRegistryRules): Formula => {
  const p = parseFormula(text, R);
  if ('error' in p) throw new Error(`A keystone's formula does not parse: ${text}: ${p.error}`);
  return p.formula;
};
const rounds = (n: number, R: KeystoneRegistryRules): Tick => tick(n * R.fight.round);
/** A keystone status's key: prefixed, so a GM's library status of the same name never merges with it on a row. */
const key = (name: string) => statusKey(`keystone-${name}`);
const EACH: Limit = { kind: 'each' }, ROUND: Limit = { kind: 'round' }, ONCE: Limit = { kind: 'fight', n: 1 };
/** What an ability is, as a trigger's tag (ability-kinds.ts `tagsOf`): every strike, every spell, every support. */
const STRIKE = KIND_TAG.strike, SUPPORT = KIND_TAG.support, SPELL = SPELL_TAG;
const area = (radius: number, on: 'allies' | 'foes'): Reach => ({ kind: 'area', radius: tiles(radius), on });
/** The worn status that carries a keystone's ops and triggers, labelled with its name and line. */
const worn = (name: string, line: string, ops: readonly Op[], triggers: readonly Trigger[] = []): StatusDef =>
  ({ label: name, desc: line, ops, ...(triggers.length ? { triggers } : {}) });
/** A stacking rule: `cap` stacks that leave as `leave` says, the fight's alone, with no threshold unless one is given. */
const stacking = (cap: number, leave: StackRule['leave'], threshold: StackRule['threshold'] = null): StackRule => ({ cap, leave, keep: 'fight', threshold });
const apply = (k: string, def: StatusDef, duration: Tick | null): LandOp => ({ op: 'applyStatus', key: key(k), def, duration });
/** A keystone with no awakened powers. */
const plain = (name: string, line: string, powers: Powers, bonus: Bonus = {}): Keystone => ({ name, line, bonus, ...powers, awakened: null });

// ── Marks (rank D, a stat at 30% of the points spent) ──
const MARK: { readonly [S in StatKey]: KeystoneMaker } = {
  str: () => {
    const line = 'When your strike defeats a foe, you get half your turn back (once a round).';
    return plain('Follow Through', line, { worn: worn('Follow Through', line, [], [
      { on: 'kill', tag: STRIKE, to: 'self', limit: ROUND, ops: [{ op: 'refund', pct: 50 }] },
    ]) });
  },
  agi: () => {
    const line = 'When a foe\'s attack misses you, your next turn comes 33% sooner (once a round).';
    // A.6's quarter weighs 6.5, under the band: a third, 8.6.
    return plain('Slip Away', line, { worn: worn('Slip Away', line, [], [
      { on: 'avoided', tag: null, to: 'self', limit: ROUND, ops: [{ op: 'hasten', share: 0.33 }] },
    ]) });
  },
  vit: R => {
    const line = 'The first time you fall under 30% HP in a fight, you gain a shield of 35% of your max HP.';
    // A.6's 25% weighs 7.3 since a shield op is weighed (an HP of shield as an HP healed), under the band: 35%, 10.2.
    return plain('Second Wind', line, { worn: worn('Second Wind', line, [], [
      { on: 'lowHp', to: 'self', limit: ONCE, ops: [{ op: 'shield', amount: formula('0.35 * hpmax', R) }] },
    ]) });
  },
  ins: R => {
    const line = 'A foe you hit is Read for 1 round. Everyone crits against it on one more die face.';
    const read = worn('Read', 'Attacks against it crit on one more die face.', [{ op: 'sheet', key: 'exposed', amount: 1 }]);
    return plain('Read the Opening', line, { worn: worn('Read the Opening', line, [], [
      { on: 'hitDealt', tag: null, to: 'other', limit: EACH, ops: [apply('read', read, rounds(1, R))] },
    ]) });
  },
  dis: () => {
    const line = 'Hits cannot break your channels, and control statuses last less time on you.';
    // A point of tenacity is 2.3 points at D (item-budget.ts, fed by Strength and Discipline): A.6's 15 was 35, so 4
    // (9.2) and the guard, which is not weighed.
    return plain('Unbroken Focus', line, { worn: worn('Unbroken Focus', line, [{ op: 'channel', mode: 'protect' }]) }, { tenacity: 4 });
  },
  pre: () => {
    const line = 'When you use a support ability, allies within 2 tiles get their next turn 15% sooner.';
    return plain('Rally', line, { worn: worn('Rally', line, [], [
      { on: 'used', tag: SUPPORT, to: area(2, 'allies'), limit: EACH, ops: [{ op: 'hasten', share: 0.15 }] },
    ]) });
  },
  pow: () => {
    const line = 'Each spell hit gives you 1 Surge (up to 5). At 5, your next hit deals 30% more damage.';
    const surging = worn('Surging', 'Its next hit deals 30% more damage.', [{ op: 'share', on: 'dealt', pct: 30 }]);
    // Surging goes with the next hit by its own trigger, not by a stack's leave: a leave on a hit dealt would take it
    // with the very hit whose fifth Surge put it on (triggers.ts `fire` runs the leaves after that event's triggers).
    const spent: StatusDef = { ...surging, triggers: [{ on: 'hitDealt', tag: null, to: 'self', limit: EACH, ops: [{ op: 'cureStatus', key: key('surging') }] }] };
    const surge: StatusDef = {
      label: 'Surge', desc: 'At 5 stacks, all stacks are spent and the next hit deals 30% more damage.', ops: [],
      stack: stacking(5, { kind: 'never' }, { at: { kind: 'count', n: 5 }, to: { kind: 'bearer' }, then: 'spend', ops: [apply('surging', spent, null)] }),
    };
    return plain('Arcane Surge', line, { worn: worn('Arcane Surge', line, [], [
      { on: 'hitDealt', tag: SPELL, to: 'self', limit: EACH, ops: [apply('surge', surge, null)] },
    ]) });
  },
  ctl: R => {
    const line = 'When you apply a harmful status to a foe, its next turn is delayed by 20% of a round (once a round).';
    return plain('Lockdown', line, { worn: worn('Lockdown', line, [], [
      { on: 'imposed', tag: null, to: 'other', limit: ROUND, ops: [{ op: 'delay', ticks: tick(Math.round(0.2 * R.fight.round)) }] },
    ]) });
  },
};

// ── Apexes (rank B, a stat over 55% of the points spent) ──
const APEX: { readonly [S in StatKey]: KeystoneMaker } = {
  str: R => {
    const line = 'Once every 6 rounds, you can use Shatter to strike a foe for 15% more damage and fill 15% of its stagger bar.';
    // Row 32 (unit row-32): `effect: null` with 0.5 stagger on a 4-round cooldown dealt nothing in packs or duels and
    // hurt win rates on bosses (-19.7pp at difficulty 5) and mythics (-5.3pp mean). Restoring 1.15x strike damage with
    // 0.15 stagger on a 6-round cooldown weighs 27.4 points at rank B (within the 25 ± 20% apex budget), beats Strike
    // and Mutilation in packs (+1.8% faster) and duels (+1.2pp), and sits inside the other apexes' band on difficulty-5
    // bosses (+12.7pp, under Sovereign's +15.3pp) and mythics (+2.9pp mean, under Undying's +5.4pp and Sovereign's +8.9pp).
    const strike = recommended('strike', defaultTicks('strike'), R).text;
    const a = abilityOf('strike', {
      id: abilityId('keystone-shatter'), name: 'Shatter',
      effect: { type: 'physical', by: 'hand', formula: formula(`1.15 * (${strike})`, R) },
      ops: [{ op: 'stagger', share: 0.15 }],
    }, R);
    return plain('Worldbreaker', line, { active: { ...a, cost: { ...a.cost, cooldown: rounds(6, R) } } });
  },
  agi: R => {
    const line = 'You take 20% more turns. When you avoid a hit, foes cannot aim at you until you act.';
    const after = worn('Afterimage', 'Foes cannot aim at it until it acts.', [{ op: 'untargetable' }]);
    return plain('Afterimage', line, { worn: worn('Afterimage', line, [{ op: 'speed', pct: 20 }], [
      { on: 'avoided', tag: null, to: 'self', limit: EACH, ops: [apply('afterimage', after, rounds(1, R))] },
    ]) });
  },
  vit: R => {
    const line = 'Once a fight, if you drop under 30% HP, you cannot drop below 1 HP until your next turn ends. You also heal 10% of max HP each round for 3 rounds.';
    const undying = worn('Undying', 'Cannot drop below 1 HP.', [{ op: 'invulnerable' }]);
    const mending = worn('Mending', 'Heals 10% of max HP each round.', [{ op: 'heal', when: 'turn', amount: formula('0.1 * hpmax', R) }]);
    return plain('Undying', line, { worn: worn('Undying', line, [], [
      { on: 'lowHp', to: 'self', limit: ONCE, ops: [apply('undying', undying, rounds(1, R)), apply('mending', mending, rounds(3, R))] },
    ]) });
  },
  ins: R => {
    const line = 'You are never surprised. At the start of each turn, you gain advantage on your next defense roll.';
    const foresight: StatusDef = { label: 'Foresight', desc: 'Advantage on its next defense roll.', ops: [{ op: 'edge', side: 'defend', keep: 'better', tag: null, spend: true }], stack: stacking(1, { kind: 'never' }) };
    return plain('Foresight', line, { worn: worn('Foresight', line, [{ op: 'alert' }], [
      { on: 'turnStart', to: 'self', limit: EACH, ops: [apply('foresight', foresight, rounds(1, R))] },
    ]) });
  },
  dis: () => {
    const line = 'At the start of each turn, your oldest harmful status ends. Control statuses last much less time on you.';
    // A point of tenacity is 2.6 points at B: A.6's 40 was 103, so 9 (23); the dispel is not weighed.
    return plain('Mind Fortress', line, { worn: worn('Mind Fortress', line, [], [
      { on: 'turnStart', to: 'self', limit: EACH, ops: [{ op: 'dispel', which: 'first' }] },
    ]) }, { tenacity: 9 });
  },
  pre: () => {
    const line = 'Allies within 3 tiles of you deal 10% more damage. You can lead one more shadow.';
    return plain('Sovereign', line, { worn: worn('Sovereign', line, [{ op: 'aura', radius: 3, on: 'allies' }, { op: 'share', on: 'dealt', pct: 10 }]) }, { shadows: 1 });
  },
  pow: R => {
    const line = 'Once a fight, you can cast a 3-tile magic blast that burns the ground for 2 rounds.';
    const blast = recommended('blast', defaultTicks('blast'), R).text;
    const zoneType = damageTypeOf('keystone-cataclysm-zone', 'arcane', R);
    const a = abilityOf('blast', {
      id: abilityId('keystone-cataclysm'), name: 'Cataclysm', shape: { kind: 'radius', radius: tiles(3), ring: null },
      effect: { type: 'arcane', by: 'hand', formula: formula(blast, R) },
      zone: { name: 'Cataclysm', duration: rounds(2, R), ops: [{ op: 'damage', type: zoneType, when: 'turn', amount: formula('0.2 * mag', R) }], endsWithOwner: false, around: null, grow: null },
    }, R);
    return plain('Cataclysm', line, { active: { ...a, gates: [{ kind: 'uses', per: 'fight', n: 1 }] } });
  },
  ctl: () => {
    const line = 'When you put a harmful status on a foe, it also lands on the foe nearest to it, within 2 tiles (once a round).';
    return plain('Puppeteer', line, { worn: worn('Puppeteer', line, [], [
      { on: 'imposed', tag: null, to: 'other', limit: ROUND, ops: [{ op: 'echo', radius: 2 }] },
    ]) });
  },
};

// ── Confluences (rank C, the two highest stats at 25% each) ──
/** A confluence with the powers its job's Job Change adds. */
const awake = (k: Keystone, awakened: Powers, awakenedLine?: string): Keystone =>
  ({ ...k, awakened, ...(awakenedLine ? { awakenedLine } : {}) });
const CONFLUENCE: { readonly [P in StatPair]: KeystoneMaker } = {
  'str+agi': () => {
    const line = 'Each move gives you 1 Momentum (up to 3). Your next hit deals 10% more damage per stack, then all stacks are spent.';
    const momentum: StatusDef = { label: 'Momentum', desc: 'Each stack adds 10% damage to its next hit.', ops: [{ op: 'share', on: 'dealt', pct: 10 }], stack: stacking(3, { kind: 'event', event: 'hitDealt' }) };
    return plain('Momentum', line, { worn: worn('Momentum', line, [], [
      { on: 'moved', to: 'self', limit: EACH, ops: [apply('momentum', momentum, null)] },
    ]) });
  },
  'str+vit': R => {
    const line = 'You take 10% less damage. Once you fall under 30% HP, you deal 20% more damage for the rest of the fight.';
    const rage = worn('Rage', 'Deals 20% more damage.', [{ op: 'share', on: 'dealt', pct: 20 }]);
    const fed = 'When you defeat a foe, you heal 14% of your max HP.';
    return awake(plain('Juggernaut', line, { worn: worn('Juggernaut', line, [{ op: 'share', on: 'taken', pct: -10 }], [
      { on: 'lowHp', to: 'self', limit: ONCE, ops: [apply('rage', rage, null)] },
    ]) }), { worn: worn('Juggernaut, awakened', fed, [], [
      { on: 'kill', tag: null, to: 'self', limit: EACH, ops: [{ op: 'heal', amount: formula('0.14 * hpmax', R) }] },
    ]) });
  },
  'str+ins': R => {
    const execType = damageTypeOf('keystone-executioner', 'physical', R);
    const line = `Your strikes deal extra ${DAMAGE_WORD[execType].toLowerCase()} equal to 20% of your physical power, rising up to 40% as the foe nears 0 HP.`;
    return plain('Executioner', line, { worn: worn('Executioner', line, [], [
      { on: 'hitDealt', tag: STRIKE, to: 'other', limit: EACH, ops: [{ op: 'damage', type: execType, amount: formula('0.2 * phys * 1 * (1 + 1 * max(0, min(1, (target.missing - 0.5) / 0.5)))', R) }] },
    ]) });
  },
  'str+dis': () => {
    const line = 'Each hit you take gives you 1 Resolve (up to 5). Each stack adds 8% damage and 2 Discipline until your next hit spends them.';
    const resolve: StatusDef = {
      label: 'Resolve', desc: 'Each stack adds 8% damage and 2 Discipline until its next hit.',
      ops: [{ op: 'share', on: 'dealt', pct: 8 }, { op: 'stat', key: 'dis', amount: { kind: 'number', value: 2 } }], stack: stacking(5, { kind: 'event', event: 'hitDealt' }),
    };
    return plain('Unyielding Vow', line, { worn: worn('Unyielding Vow', line, [], [
      { on: 'struck', tag: null, to: 'self', limit: EACH, ops: [apply('resolve', resolve, null)] },
    ]) });
  },
  'str+pre': R => {
    const line = 'When you defeat a foe, allies within 3 tiles deal 15% more damage for 2 rounds.';
    const warcry = worn('Warcry', 'Deals 15% more damage.', [{ op: 'share', on: 'dealt', pct: 15 }]);
    return plain('Warlord', line, { worn: worn('Warlord', line, [], [
      { on: 'kill', tag: null, to: area(3, 'allies'), limit: EACH, ops: [apply('warcry', warcry, rounds(2, R))] },
    ]) });
  },
  'str+pow': R => {
    const bladeType = damageTypeOf('keystone-spellblade', 'arcane', R);
    const word = DAMAGE_WORD[bladeType].toLowerCase();
    const line = `After you cast a spell, your next strike deals extra ${word} equal to 12.5% of your magic power.`;
    // A.6's half of Power (31 at C, a whole strike) weighs 171. The bar counts Charged's strike for both its rounds,
    // where the cure ends it at the first: an eighth of magic power weighs 18 and plays about half that (K5).
    // Charged goes with the strike by its own trigger, not a stack's leave, so a spell's hit does not spend it.
    const charged: StatusDef = {
      label: 'Charged', desc: `Its next strike adds ${word}.`, ops: [], triggers: [
        { on: 'hitDealt', tag: STRIKE, to: 'other', limit: EACH, ops: [{ op: 'damage', type: bladeType, amount: formula('0.125 * mag', R) }] },
        { on: 'hitDealt', tag: STRIKE, to: 'self', limit: EACH, ops: [{ op: 'cureStatus', key: key('charged') }] },
      ],
    };
    return plain('Spellblade', line, { worn: worn('Spellblade', line, [], [
      { on: 'used', tag: SPELL, to: 'self', limit: EACH, ops: [apply('charged', charged, rounds(2, R))] },
    ]) });
  },
  'str+ctl': R => {
    const line = 'Your critical strikes reduce the target\'s armor by 15 for 3 rounds. This stacks up to 2 times.';
    const broken: StatusDef = { label: 'Broken', desc: 'Each stack reduces armor by 15.', ops: [{ op: 'sheet', key: 'armor', amount: { kind: 'number', value: -15 } }], stack: stacking(2, { kind: 'never' }) };
    return plain('Bonebreaker', line, { worn: worn('Bonebreaker', line, [], [
      { on: 'critDealt', tag: STRIKE, to: 'other', limit: EACH, ops: [apply('broken', broken, rounds(3, R))] },
    ]) });
  },
  'agi+vit': R => {
    const line = 'The first time you move each round, you heal 4% of your max HP.';
    return plain('Endless Stride', line, { worn: worn('Endless Stride', line, [], [
      { on: 'moved', to: 'self', limit: ROUND, ops: [{ op: 'heal', amount: formula('0.04 * hpmax', R) }] },
    ]) });
  },
  'agi+ins': R => {
    const riposteType = damageTypeOf('keystone-riposte', 'physical', R);
    const word = DAMAGE_WORD[riposteType].toLowerCase();
    const line = `When a foe's attack misses you, you strike back for ${word} equal to 40% of your finesse power (once a round).`;
    const cut = `Your crits strike again for ${word} equal to 4 times your finesse power.`;
    return awake(plain('Riposte', line, { worn: worn('Riposte', line, [], [
      { on: 'avoided', tag: null, to: 'other', limit: ROUND, ops: [{ op: 'damage', type: riposteType, amount: formula('0.4 * finesse', R) }] },
    ]) }), { worn: worn('Riposte, awakened', cut, [], [
      { on: 'critDealt', tag: null, to: 'other', limit: EACH, ops: [{ op: 'damage', type: riposteType, amount: formula('4 * finesse', R) }] },
    ]) });
  },
  'agi+dis': () => {
    const line = 'The first time you move each round, your oldest harmful status ends.';
    return plain('Flowing Water', line, { worn: worn('Flowing Water', line, [], [
      { on: 'moved', to: 'self', limit: ROUND, ops: [{ op: 'dispel', which: 'first' }] },
    ]) });
  },
  'agi+pre': () => {
    const line = 'When you move, allies next to you get their next turn 20% sooner (once a round).';
    return plain('Vanguard', line, { worn: worn('Vanguard', line, [], [
      { on: 'moved', to: area(1, 'allies'), limit: ROUND, ops: [{ op: 'hasten', share: 0.2 }] },
    ]) });
  },
  'agi+pow': () => {
    const line = 'Each spell you cast makes you 10% faster, up to 30%. One stack fades each round.';
    const quick: StatusDef = { label: 'Quickened', desc: 'Each stack adds 10% speed. One stack fades each round.', ops: [{ op: 'speed', pct: 10 }], stack: stacking(3, { kind: 'round' }) };
    return plain('Quickcast', line, { worn: worn('Quickcast', line, [], [
      { on: 'used', tag: SPELL, to: 'self', limit: EACH, ops: [apply('quickened', quick, null)] },
    ]) });
  },
  'agi+ctl': R => {
    const line = 'Your hits slow a foe 15% for a round. A foe slowed three times is rooted.';
    const rooted = worn('Rooted', 'Cannot move.', [{ op: 'root' }]);
    const hobbled: StatusDef = {
      label: 'Hobbled', desc: 'Each stack reduces speed by 15%. At 3 stacks, the target is rooted for 1 round.', ops: [{ op: 'speed', pct: -15 }],
      stack: stacking(3, { kind: 'never' }, { at: { kind: 'count', n: 3 }, to: { kind: 'bearer' }, then: 'spend', ops: [apply('rooted', rooted, rounds(1, R))] }),
    };
    const pinned = 'Your hits delay the foe\'s next turn by 20% of a round (once a round).';
    return awake(plain('Hamstring', line, { worn: worn('Hamstring', line, [], [
      { on: 'hitDealt', tag: null, to: 'other', limit: EACH, ops: [apply('hobbled', hobbled, rounds(1, R))] },
    ]) }), { worn: worn('Hamstring, awakened', pinned, [], [
      { on: 'hitDealt', tag: null, to: 'other', limit: ROUND, ops: [{ op: 'delay', ticks: tick(Math.round(0.2 * R.fight.round)) }] },
    ]) });
  },
  'vit+ins': R => {
    const line = 'You are never surprised. When you fall under 30% HP, you gain a shield of 20% of max HP and advantage on your next defense roll.';
    const braced: StatusDef = { label: 'Braced', desc: 'Advantage on its next defense roll.', ops: [{ op: 'edge', side: 'defend', keep: 'better', tag: null, spend: true }], stack: stacking(1, { kind: 'never' }) };
    return plain('Danger Sense', line, { worn: worn('Danger Sense', line, [{ op: 'alert' }], [
      { on: 'lowHp', to: 'self', limit: ONCE, ops: [{ op: 'shield', amount: formula('0.2 * hpmax', R) }, apply('braced', braced, null)] },
    ]) });
  },
  'vit+dis': R => {
    const line = 'You take 10% less damage. Each round, the first hit you take gives you a shield of 5% of max HP.';
    // Tanker. A taunt is not weighed (worth.ts); the sim holds it.
    const taunted = worn('Taunted', 'Must aim at the one who taunted it.', [{ op: 'taunt' }]);
    const hold = 'A foe that hits you is taunted by you for 1 round (once a round).';
    return awake(plain('Stonewall', line, { worn: worn('Stonewall', line, [{ op: 'share', on: 'taken', pct: -10 }], [
      { on: 'struck', tag: null, to: 'self', limit: ROUND, ops: [{ op: 'shield', amount: formula('0.05 * hpmax', R) }] },
    ]) }), { worn: worn('Stonewall, awakened', hold, [], [
      { on: 'struck', tag: null, to: 'other', limit: ROUND, ops: [apply('taunted', taunted, rounds(1, R))] },
    ]) });
  },
  'vit+pre': () => {
    const line = 'Allies next to you take 15% less damage.';
    return plain('Guardian', line, { worn: worn('Guardian', line, [{ op: 'aura', radius: 1, on: 'allies' }, { op: 'share', on: 'taken', pct: -15 }]) });
  },
  // Lifesteal is rare: a confluence is one of the few ways to get it (A.6). A point of it is 0.45 points at C
  // (item-budget.ts `drainCost`) and one of max mana 2: A.6's 20 mana was 40, so 5 (14.5 with the drain).
  'vit+pow': () => plain('Blood Magic', 'You heal 10% of the damage you deal, and you gain 5 max mana.', {}, { drain: 10, manaMax: 5 }),
  'vit+ctl': R => {
    const line = 'A foe that hits you is slowed 20% for a round.';
    const slowed = worn('Briar', 'Speed reduced by 20%.', [{ op: 'speed', pct: -20 }]);
    return plain('Briar', line, { worn: worn('Briar', line, [], [
      { on: 'struck', tag: null, to: 'other', limit: EACH, ops: [apply('briar', slowed, rounds(1, R))] },
    ]) });
  },
  'ins+dis': () => {
    const line = 'At the end of each turn, you gain Stillness, which gives advantage on your next attack. Moving ends it.';
    const still: StatusDef = { label: 'Stillness', desc: 'Advantage on its next attack. Moving ends it.', ops: [{ op: 'edge', side: 'attack', keep: 'better', tag: null, spend: true }], stack: stacking(1, { kind: 'event', event: 'moved' }) };
    return plain('Stillness', line, { worn: worn('Stillness', line, [], [
      { on: 'turnEnd', to: 'self', limit: EACH, ops: [apply('stillness', still, null)] },
    ]) });
  },
  'ins+pre': () => {
    const line = 'When you hit, allies within 3 tiles get their next turn 15% sooner (once a round).';
    // On a crit (0.05 a round) even a whole turn sooner weighs 4, a third of the band: on a hit, A.6's 15%.
    return plain('Tactician', line, { worn: worn('Tactician', line, [], [
      { on: 'hitDealt', tag: null, to: area(3, 'allies'), limit: ROUND, ops: [{ op: 'hasten', share: 0.15 }] },
    ]) });
  },
  'ins+pow': R => {
    const searedType = damageTypeOf('keystone-seared', 'arcane', R);
    const word = DAMAGE_WORD[searedType].toLowerCase();
    const line = `Your spells burn the target for 2 rounds. It takes ${word} equal to 10% of your magic power each round.`;
    // On a crit (0.05 a round) A.6's burn weighs 1.4: on every spell's hit, at half the burn.
    const seared = worn('Seared', `Takes ${word} each round.`, [{ op: 'damage', type: searedType, when: 'turn', amount: formula('0.1 * mag', R) }]);
    return plain('Searing Insight', line, { worn: worn('Searing Insight', line, [], [
      { on: 'hitDealt', tag: SPELL, to: 'other', limit: EACH, ops: [apply('seared', seared, rounds(2, R))] },
    ]) });
  },
  'ins+ctl': () => {
    const line = 'Your ranged abilities reach 2 tiles farther, and you crit on one more die face.';
    return plain('Deadeye', line, { worn: worn('Deadeye', line, [{ op: 'sheet', key: 'range', amount: 2 }, { op: 'sheet', key: 'critFaces', amount: { kind: 'number', value: 1 } }]) });
  },
  'dis+pre': () => {
    const line = 'Allies within 2 tiles of you have 10 more Discipline.';
    // Healer. A dispel is not weighed (worth.ts); the sim holds it.
    const cleanse = 'Once a round, your support ability also ends the oldest harmful status of each ally within 2 tiles.';
    return awake(plain('Oathkeeper', line, { worn: worn('Oathkeeper', line, [{ op: 'aura', radius: 2, on: 'allies' }, { op: 'stat', key: 'dis', amount: { kind: 'number', value: 10 } }]) }),
      { worn: worn('Oathkeeper, awakened', cleanse, [], [{ on: 'used', tag: SUPPORT, to: area(2, 'allies'), limit: ROUND, ops: [{ op: 'dispel', which: 'first' }] }]) });
  },
  'dis+pow': () => {
    const line = 'Hits cannot break your channels. After you release a channel, your next hit deals 20% more damage.';
    const gathered: StatusDef = { label: 'Gathered', desc: 'Its next hit deals 20% more damage.', ops: [{ op: 'share', on: 'dealt', pct: 20 }], stack: stacking(1, { kind: 'event', event: 'hitDealt' }) };
    return plain('Channeler', line, { worn: worn('Channeler', line, [{ op: 'channel', mode: 'protect' }], [
      { on: 'used', tag: CHANNEL_TAG, to: 'self', limit: EACH, ops: [apply('gathered', gathered, null)] },
    ]) });
  },
  'dis+ctl': () => {
    const line = 'When you put a harmful status on a foe, your oldest harmful status ends (once a round).';
    return plain('Inquisitor', line, { worn: worn('Inquisitor', line, [], [
      { on: 'imposed', tag: null, to: 'self', limit: ROUND, ops: [{ op: 'dispel', which: 'first' }] },
    ]) });
  },
  'pre+pow': R => {
    const line = 'You can lead 1 more shadow and gain 5 max mana. When you defeat a foe, you recover 4 mana (once a round).';
    const summonRounds = R.fight.kit.summonRounds;
    const callLine = `Once a fight, you can use Call Shadow to summon a same-rank Shadow Soldier for ${summonRounds} round${summonRounds === 1 ? '' : 's'}.`;
    const callBase = abilityOf('support', {
      id: abilityId('keystone-call-shadow'), name: 'Call Shadow', aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null,
    }, R);
    const callShadow: Ability = {
      ...callBase,
      cost: { ...callBase.cost, mana: 0 },
      gates: [{ kind: 'uses', per: 'fight', n: 1 }],
      summon: { name: 'Shadow Soldier', archetype: 'brute', rounds: summonRounds, statuses: [] },
    };
    return awake(plain('Shadowbound', line, { worn: worn('Shadowbound', line, [], [
      { on: 'kill', tag: null, to: 'self', limit: ROUND, ops: [{ op: 'mana', amount: formula('4', R) }] },
    ]) }, { shadows: 1, manaMax: 5 }), { active: callShadow }, callLine);
  },
  'pre+ctl': R => {
    const line = 'A foe you put a harmful status on takes 10% more damage from everyone for a round.';
    const marked = worn('Marked', 'Takes 10% more damage.', [{ op: 'share', on: 'taken', pct: 10 }]);
    return plain('Commander', line, { worn: worn('Commander', line, [], [
      { on: 'imposed', tag: null, to: 'other', limit: EACH, ops: [apply('marked', marked, rounds(1, R))] },
    ]) });
  },
  'pow+ctl': () => {
    // A hundredth of cost cut is 2.6 points at C: A.6's 15% was 38, so 5% (13), with the resist pen's 1.8.
    const line = 'Your magic ignores 15% of resist, and your abilities cost 5% less mana and fatigue.';
    const flow = 'When your spell defeats a foe, you get half your turn back (once a round).';
    return awake(plain('Archmage', line, { worn: worn('Archmage', line, [{ op: 'sheet', key: 'resistPen', amount: { kind: 'number', value: 15 } }, { op: 'sheet', key: 'costCut', amount: { kind: 'number', value: 0.05 } }]) }),
      { worn: worn('Archmage, awakened', flow, [], [{ on: 'kill', tag: SPELL, to: 'self', limit: ROUND, ops: [{ op: 'refund', pct: 50 }] }]) });
  },
};

/** Every keystone, by tier and by its stat or pair: the typecheck asks for each stat's Mark and Apex and every pair's Confluence. */
export const KEYSTONES: {
  readonly mark: { readonly [S in StatKey]: KeystoneMaker };
  readonly apex: { readonly [S in StatKey]: KeystoneMaker };
  readonly confluence: { readonly [P in StatPair]: KeystoneMaker };
} = { mark: MARK, apex: APEX, confluence: CONFLUENCE };

/** The keystone `k` names, made under `R`. */
export function keystoneOf(k: KeystoneKey, R: KeystoneRegistryRules): Keystone {
  return k.tier === 'confluence' ? KEYSTONES.confluence[k.pair](R) : KEYSTONES[k.tier][k.stat](R);
}
