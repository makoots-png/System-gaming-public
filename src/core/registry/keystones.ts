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
import { abilityId } from '../combat/ability-types.ts';
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
    const line = 'When your strike downs a foe, you get half your turn back (once a round).';
    return plain('Follow Through', line, { worn: worn('Follow Through', line, [], [
      { on: 'kill', tag: STRIKE, to: 'self', limit: ROUND, ops: [{ op: 'refund', pct: 50 }] },
    ]) });
  },
  agi: () => {
    const line = 'When a foe\'s attack misses you, your next turn comes a third sooner (once a round).';
    // A.6's quarter weighs 6.5, under the band: a third, 8.6.
    return plain('Slip Away', line, { worn: worn('Slip Away', line, [], [
      { on: 'avoided', tag: null, to: 'self', limit: ROUND, ops: [{ op: 'hasten', share: 0.33 }] },
    ]) });
  },
  vit: R => {
    const line = 'The first time you fall under 30% HP in a fight, you gain a shield of 25% of your max HP.';
    return plain('Second Wind', line, { worn: worn('Second Wind', line, [], [
      { on: 'lowHp', to: 'self', limit: ONCE, ops: [{ op: 'shield', amount: formula('0.25 * hpmax', R) }] },
    ]) });
  },
  ins: R => {
    const line = 'A foe you hit is Read for a round: everyone\'s crits against it come on one more face.';
    const read = worn('Read', 'Crits against it come on one more face.', [{ op: 'sheet', key: 'exposed', amount: 1 }]);
    return plain('Read the Opening', line, { worn: worn('Read the Opening', line, [], [
      { on: 'hitDealt', tag: null, to: 'other', limit: EACH, ops: [apply('read', read, rounds(1, R))] },
    ]) });
  },
  dis: () => {
    const line = 'Hits cannot break your channels, and control on you is shorter.';
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
    const line = 'Each hit of a spell gives a Surge (up to 5). At 5, your next hit deals 30% more.';
    const surging = worn('Surging', 'Its next hit deals 30% more.', [{ op: 'share', on: 'dealt', pct: 30 }]);
    // Surging goes with the next hit by its own trigger, not by a stack's leave: a leave on a hit dealt would take it
    // with the very hit whose fifth Surge put it on (triggers.ts `fire` runs the leaves after that event's triggers).
    const spent: StatusDef = { ...surging, triggers: [{ on: 'hitDealt', tag: null, to: 'self', limit: EACH, ops: [{ op: 'cureStatus', key: key('surging') }] }] };
    const surge: StatusDef = {
      label: 'Surge', desc: 'At 5, all are spent and the next hit deals 30% more.', ops: [],
      stack: stacking(5, { kind: 'never' }, { at: { kind: 'count', n: 5 }, to: { kind: 'bearer' }, then: 'spend', ops: [apply('surging', spent, null)] }),
    };
    return plain('Arcane Surge', line, { worn: worn('Arcane Surge', line, [], [
      { on: 'hitDealt', tag: SPELL, to: 'self', limit: EACH, ops: [apply('surge', surge, null)] },
    ]) });
  },
  ctl: R => {
    const line = 'When you put a harmful status on a foe, its next turn is pushed back a fifth of a round (once a round).';
    return plain('Lockdown', line, { worn: worn('Lockdown', line, [], [
      { on: 'imposed', tag: null, to: 'other', limit: ROUND, ops: [{ op: 'delay', ticks: tick(Math.round(0.2 * R.fight.round)) }] },
    ]) });
  },
};

// ── Apexes (rank B, a stat over 55% of the points spent) ──
const APEX: { readonly [S in StatKey]: KeystoneMaker } = {
  str: R => {
    const line = 'Once every 4 rounds, Shatter: a blow that fills half a stagger bar.';
    // A.6's double strike with the half bar weighs 82: a use is 2 SA of damage and 0.75 of a break (worth.ts
    // `breakWorth`). The half bar is the apex (A.7 built its op), so the damage goes: 0.75 SA a quarter of the rounds.
    const a = abilityOf('strike', { id: abilityId('keystone-shatter'), name: 'Shatter', effect: null, ops: [{ op: 'stagger', share: 0.5 }] }, R);
    return plain('Worldbreaker', line, { active: { ...a, cost: { ...a.cost, cooldown: rounds(4, R) } } });
  },
  agi: R => {
    const line = 'You take 20% more turns. When you avoid a hit, foes cannot aim at you until you act.';
    const after = worn('Afterimage', 'Foes cannot aim at it until it acts.', [{ op: 'untargetable' }]);
    return plain('Afterimage', line, { worn: worn('Afterimage', line, [{ op: 'speed', pct: 20 }], [
      { on: 'avoided', tag: null, to: 'self', limit: EACH, ops: [apply('afterimage', after, rounds(1, R))] },
    ]) });
  },
  vit: R => {
    const line = 'Once a fight, when you fall under 30% HP, you cannot drop below 1 HP until your next turn ends, and you heal 10% of max HP each round for 3 rounds.';
    const undying = worn('Undying', 'Cannot drop below 1 HP.', [{ op: 'invulnerable' }]);
    const mending = worn('Mending', 'Heals 10% of max HP each round.', [{ op: 'heal', when: 'turn', amount: formula('0.1 * hpmax', R) }]);
    return plain('Undying', line, { worn: worn('Undying', line, [], [
      { on: 'lowHp', to: 'self', limit: ONCE, ops: [apply('undying', undying, rounds(1, R)), apply('mending', mending, rounds(3, R))] },
    ]) });
  },
  ins: R => {
    const line = 'You are never surprised. At the start of each of your turns you gain advantage on your next defence roll.';
    const foresight: StatusDef = { label: 'Foresight', desc: 'Advantage on its next defence roll.', ops: [{ op: 'edge', side: 'defend', keep: 'better', tag: null, spend: true }], stack: stacking(1, { kind: 'never' }) };
    return plain('Foresight', line, { worn: worn('Foresight', line, [{ op: 'alert' }], [
      { on: 'turnStart', to: 'self', limit: EACH, ops: [apply('foresight', foresight, rounds(1, R))] },
    ]) });
  },
  dis: () => {
    const line = 'At the start of each of your turns your oldest harmful status ends. Control on you is much shorter.';
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
    const line = 'Once a fight: a 3-tile blast of magic, and the ground burns for 2 rounds.';
    const blast = recommended('blast', defaultTicks('blast'), R).text;
    const a = abilityOf('blast', {
      id: abilityId('keystone-cataclysm'), name: 'Cataclysm', shape: { kind: 'radius', radius: tiles(3), ring: null },
      effect: { type: 'magical', by: 'hand', formula: formula(blast, R) },
      zone: { name: 'Cataclysm', duration: rounds(2, R), ops: [{ op: 'damage', type: 'magical', when: 'turn', amount: formula('0.2 * mag', R) }], endsWithOwner: false, around: null, grow: null },
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
const awake = (k: Keystone, awakened: Powers): Keystone => ({ ...k, awakened });
const CONFLUENCE: { readonly [P in StatPair]: KeystoneMaker } = {
  'str+agi': () => {
    const line = 'Each move gives Momentum (up to 3). Your next hit deals 10% more for each, then it is spent.';
    const momentum: StatusDef = { label: 'Momentum', desc: 'Each stack: 10% more damage on its next hit.', ops: [{ op: 'share', on: 'dealt', pct: 10 }], stack: stacking(3, { kind: 'event', event: 'hitDealt' }) };
    return plain('Momentum', line, { worn: worn('Momentum', line, [], [
      { on: 'moved', to: 'self', limit: EACH, ops: [apply('momentum', momentum, null)] },
    ]) });
  },
  'str+vit': R => {
    const line = 'You take 10% less damage. Once you fall under 30% HP you deal 20% more for the rest of the fight.';
    const rage = worn('Rage', 'Deals 20% more damage.', [{ op: 'share', on: 'dealt', pct: 20 }]);
    const fed = 'When you down a foe, you heal 14% of your max HP.';
    return awake(plain('Juggernaut', line, { worn: worn('Juggernaut', line, [{ op: 'share', on: 'taken', pct: -10 }], [
      { on: 'lowHp', to: 'self', limit: ONCE, ops: [apply('rage', rage, null)] },
    ]) }), { worn: worn('Juggernaut, awakened', fed, [], [
      { on: 'kill', tag: null, to: 'self', limit: EACH, ops: [{ op: 'heal', amount: formula('0.14 * hpmax', R) }] },
    ]) });
  },
  'str+ins': R => {
    const line = 'Your strikes deal more the lower the foe\'s HP: up to 40% of your physical power more on a foe near death.';
    return plain('Executioner', line, { worn: worn('Executioner', line, [], [
      { on: 'hitDealt', tag: STRIKE, to: 'other', limit: EACH, ops: [{ op: 'damage', type: 'physical', amount: formula('0.2 * phys * 1 * (1 + 1 * max(0, min(1, (target.missing - 0.5) / 0.5)))', R) }] },
    ]) });
  },
  'str+dis': () => {
    const line = 'Each hit you take gives Resolve (up to 5): 8% more damage and 2 Discipline each. Your next hit spends it all.';
    const resolve: StatusDef = {
      label: 'Resolve', desc: 'Each stack: 8% more damage and 2 Discipline, until its next hit.',
      ops: [{ op: 'share', on: 'dealt', pct: 8 }, { op: 'stat', key: 'dis', amount: { kind: 'number', value: 2 } }], stack: stacking(5, { kind: 'event', event: 'hitDealt' }),
    };
    return plain('Unyielding Vow', line, { worn: worn('Unyielding Vow', line, [], [
      { on: 'struck', tag: null, to: 'self', limit: EACH, ops: [apply('resolve', resolve, null)] },
    ]) });
  },
  'str+pre': R => {
    const line = 'When you down a foe, allies within 3 tiles deal 15% more damage for 2 rounds.';
    const warcry = worn('Warcry', 'Deals 15% more damage.', [{ op: 'share', on: 'dealt', pct: 15 }]);
    return plain('Warlord', line, { worn: worn('Warlord', line, [], [
      { on: 'kill', tag: null, to: area(3, 'allies'), limit: EACH, ops: [apply('warcry', warcry, rounds(2, R))] },
    ]) });
  },
  'str+pow': R => {
    const line = 'After you cast a spell, your next strike adds magic damage of an eighth of your magic power.';
    // A.6's half of Power (31 at C, a whole strike) weighs 171. The bar counts Charged's strike for both its rounds,
    // where the cure ends it at the first: an eighth of magic power weighs 18 and plays about half that (K5).
    // Charged goes with the strike by its own trigger, not a stack's leave, so a spell's hit does not spend it.
    const charged: StatusDef = {
      label: 'Charged', desc: 'Its next strike adds magic damage.', ops: [], triggers: [
        { on: 'hitDealt', tag: STRIKE, to: 'other', limit: EACH, ops: [{ op: 'damage', type: 'magical', amount: formula('0.125 * mag', R) }] },
        { on: 'hitDealt', tag: STRIKE, to: 'self', limit: EACH, ops: [{ op: 'cureStatus', key: key('charged') }] },
      ],
    };
    return plain('Spellblade', line, { worn: worn('Spellblade', line, [], [
      { on: 'used', tag: SPELL, to: 'self', limit: EACH, ops: [apply('charged', charged, rounds(2, R))] },
    ]) });
  },
  'str+ctl': R => {
    const line = 'Your critical strikes break armor: the target loses 15 armor for 3 rounds, stacking twice.';
    const broken: StatusDef = { label: 'Broken', desc: 'Each stack: 15 less armor.', ops: [{ op: 'sheet', key: 'armor', amount: { kind: 'number', value: -15 } }], stack: stacking(2, { kind: 'never' }) };
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
    const line = 'When a foe\'s attack misses you, you strike back for 40% of your physical power (once a round).';
    const cut = 'Your crits strike again for 4 times your physical power.';
    return awake(plain('Riposte', line, { worn: worn('Riposte', line, [], [
      { on: 'avoided', tag: null, to: 'other', limit: ROUND, ops: [{ op: 'damage', type: 'physical', amount: formula('0.4 * phys', R) }] },
    ]) }), { worn: worn('Riposte, awakened', cut, [], [
      { on: 'critDealt', tag: null, to: 'other', limit: EACH, ops: [{ op: 'damage', type: 'physical', amount: formula('4 * phys', R) }] },
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
    const quick: StatusDef = { label: 'Quickened', desc: 'Each stack: 10% faster. One fades each round.', ops: [{ op: 'speed', pct: 10 }], stack: stacking(3, { kind: 'round' }) };
    return plain('Quickcast', line, { worn: worn('Quickcast', line, [], [
      { on: 'used', tag: SPELL, to: 'self', limit: EACH, ops: [apply('quickened', quick, null)] },
    ]) });
  },
  'agi+ctl': R => {
    const line = 'Your hits slow a foe 15% for a round. A foe slowed three times is rooted.';
    const rooted = worn('Rooted', 'Cannot move.', [{ op: 'root' }]);
    const hobbled: StatusDef = {
      label: 'Hobbled', desc: 'Each stack: 15% slower. At 3, it is rooted for a round.', ops: [{ op: 'speed', pct: -15 }],
      stack: stacking(3, { kind: 'never' }, { at: { kind: 'count', n: 3 }, to: { kind: 'bearer' }, then: 'spend', ops: [apply('rooted', rooted, rounds(1, R))] }),
    };
    const pinned = 'Your hits push the foe\'s next turn back a fifth of a round (once a round).';
    return awake(plain('Hamstring', line, { worn: worn('Hamstring', line, [], [
      { on: 'hitDealt', tag: null, to: 'other', limit: EACH, ops: [apply('hobbled', hobbled, rounds(1, R))] },
    ]) }), { worn: worn('Hamstring, awakened', pinned, [], [
      { on: 'hitDealt', tag: null, to: 'other', limit: ROUND, ops: [{ op: 'delay', ticks: tick(Math.round(0.2 * R.fight.round)) }] },
    ]) });
  },
  'vit+ins': R => {
    const line = 'You are never surprised. When you fall under 30% HP you gain a shield of 20% of max HP and advantage on your next defence roll.';
    const braced: StatusDef = { label: 'Braced', desc: 'Advantage on its next defence roll.', ops: [{ op: 'edge', side: 'defend', keep: 'better', tag: null, spend: true }], stack: stacking(1, { kind: 'never' }) };
    return plain('Danger Sense', line, { worn: worn('Danger Sense', line, [{ op: 'alert' }], [
      { on: 'lowHp', to: 'self', limit: ONCE, ops: [{ op: 'shield', amount: formula('0.2 * hpmax', R) }, apply('braced', braced, null)] },
    ]) });
  },
  'vit+dis': R => {
    const line = 'You take 10% less damage. Each round, the first hit you take gives you a shield of 5% of max HP.';
    // Tanker. A taunt is not weighed (worth.ts); the sim holds it.
    const taunted = worn('Taunted', 'Must aim at the one who taunted it.', [{ op: 'taunt' }]);
    const hold = 'A foe that hits you is taunted to you for a round (once a round).';
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
  'vit+pow': () => plain('Blood Magic', 'You heal 10% of the damage you deal, and you have 5 more mana.', {}, { drain: 10, manaMax: 5 }),
  'vit+ctl': R => {
    const line = 'A foe that hits you is slowed 20% for a round.';
    const slowed = worn('Briar', '20% slower.', [{ op: 'speed', pct: -20 }]);
    return plain('Briar', line, { worn: worn('Briar', line, [], [
      { on: 'struck', tag: null, to: 'other', limit: EACH, ops: [apply('briar', slowed, rounds(1, R))] },
    ]) });
  },
  'ins+dis': () => {
    const line = 'At the end of each turn you gain Stillness: advantage on your next attack. Moving ends it.';
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
    const line = 'Your spells set the target burning: magic damage of a tenth of your magic power each round for 2 rounds.';
    // On a crit (0.05 a round) A.6's burn weighs 1.4: on every spell's hit, at half the burn.
    const seared = worn('Seared', 'Takes magic damage each round.', [{ op: 'damage', type: 'magical', when: 'turn', amount: formula('0.1 * mag', R) }]);
    return plain('Searing Insight', line, { worn: worn('Searing Insight', line, [], [
      { on: 'hitDealt', tag: SPELL, to: 'other', limit: EACH, ops: [apply('seared', seared, rounds(2, R))] },
    ]) });
  },
  'ins+ctl': () => {
    const line = 'Your ranged abilities reach 2 tiles further, and you crit on one more face.';
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
    const line = 'Hits cannot break your channels, and after you release a channel your next hit deals 20% more.';
    const gathered: StatusDef = { label: 'Gathered', desc: 'Its next hit deals 20% more.', ops: [{ op: 'share', on: 'dealt', pct: 20 }], stack: stacking(1, { kind: 'event', event: 'hitDealt' }) };
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
    const line = 'Your heals and shields are 20% stronger, and each support ability you use gives you 10 mana.';
    const drink = 'When you down a foe, allies within 3 tiles heal 14% of your max HP.';
    return awake(plain('Conduit', line, { worn: worn('Conduit', line, [], [
      { on: 'used', tag: SUPPORT, to: 'self', limit: EACH, ops: [{ op: 'mana', amount: formula('10', R) }] },
    ]) }, { healPower: 20 }), { worn: worn('Conduit, awakened', drink, [], [
      { on: 'kill', tag: null, to: area(3, 'allies'), limit: EACH, ops: [{ op: 'heal', amount: formula('0.14 * hpmax', R) }] },
    ]) });
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
    const line = 'Your spells ignore 15% of resist and cost 5% less.';
    const flow = 'When your spell downs a foe, you get half your turn back (once a round).';
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
