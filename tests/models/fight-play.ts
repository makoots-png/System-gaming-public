// Random play of the reworked fight (src/core/combat/fight.ts): a mixed fight of two sides on a map with walls, the
// abilities they use, and random legal and illegal commands with every die drawn from the seed. Shared by the model test
// (tests/fight-model.test.ts) and the charts (scripts/charts/fight.ts and channel.ts), so all three play the same fights.
// Its seeded generator `rng` is the one every random test draws from.
import { RULES } from '../../src/core/rules.ts';
import { baseStats } from '../../src/core/stats.ts';
import type { StatKey } from '../../src/core/stats.ts';
import { kitGear, NO_TWEAK } from '../../src/core/hunter/derive.ts';
import type { Archetype, Kit, MonsterKind, Tweak } from '../../src/core/hunter/derive.ts';
import { diceOf, parseFormula } from '../../src/core/formula.ts';
import type { Dice } from '../../src/core/formula.ts';
import { place, tiles } from '../../src/core/combat/space.ts';
import type { Grid, Place, Terrain } from '../../src/core/combat/space.ts';
import { tick } from '../../src/core/combat/timeline.ts';
import { abilityId, combatantId, hunterId } from '../../src/core/combat/ability-types.ts';
import { fightId, parseSheetKey } from '../../src/core/ids.ts';
import type { Ability, AbilityKind, CombatantId } from '../../src/core/combat/ability-types.ts';
import { modified, shadowId, statusKey } from '../../src/core/combat/effect-ops.ts';
import { atTier } from '../../src/core/combat/op-amount.ts';
import type { LandOp, Op, Origin, StackDef, Status, StatusDef, UseOp } from '../../src/core/combat/effect-ops.ts';
import type { Trigger } from '../../src/core/combat/triggers.ts';
import { abilityOf } from '../../src/core/registry/ability-kinds.ts';
import { needs } from '../../src/core/combat/resolve.ts';
import type { Aim, Rolls } from '../../src/core/combat/resolve.ts';
import { dodgeAsk, pendingKey, runningState } from '../../src/core/combat/fight.ts';
import { omenMove, omenNeeds } from '../../src/core/combat/fight-turn.ts';
import { monsterRows } from '../../src/core/combat/rows.ts';
import { seedMonsters } from '../../src/core/registry/monsters.ts';
import type { Command, Ctx, Fight, NewRow, Opening, Running } from '../../src/core/combat/fight.ts';
import type { Body } from '../../src/core/combat/effect-ops.ts';
import { zoneId } from '../../src/core/combat/zones.ts';
import { EXTRACTION_OUTCOMES } from '../../src/core/combat/extraction.ts';
import type { Zone } from '../../src/core/combat/zones.ts';
import { TERRAINS } from '../../src/core/combat/space.ts';
import { isUp, rowHp } from '../../src/core/combat/row-hp.ts';
import { lifeAt } from '../fixtures/life.ts';
const sheetKey = (s: string) => parseSheetKey(s) ?? (() => { throw new Error(`not a sheet key: ${s}`); })();

// ── a seeded generator (mulberry32) ──
export type Rng = { next: () => number; int: (lo: number, hi: number) => number; pick: <T>(list: readonly T[]) => T; chance: (p: number) => boolean };
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));
  return { next, int, pick: list => { const x = list[int(0, list.length - 1)]; if (x === undefined) throw new Error('pick from an empty list'); return x; }, chance: p => next() < p };
}

export const ctx: Ctx = { rules: RULES };

// ── the map: the default 20 by 14 with a short wall between the lines ──
const WALLS = new Set(['6,5', '7,5', '8,5', '12,7', '12,8']);
export const GRID: Grid = {
  w: RULES.fight.grid.w, h: RULES.fight.grid.h,
  tiles: Array.from({ length: RULES.fight.grid.w * RULES.fight.grid.h }, (_, i): Terrain => WALLS.has(`${i % RULES.fight.grid.w},${Math.floor(i / RULES.fight.grid.w)}`) ? 'wall' : 'floor'),
};

// ── abilities ──
const f = (text: string) => { const p = parseFormula(text, RULES); if (!p.ok) throw new Error(p.error); return p.formula; };
const make = (kind: AbilityKind, name: string, o: Partial<Ability> = {}): Ability => ({ ...abilityOf(kind, { id: abilityId(name), name }, RULES), ...o });
const status = (key: string, duration: number | null, ...ops: Op[]): UseOp =>
  ({ op: 'applyStatus', key: statusKey(key), def: { label: key, desc: '', ops }, duration: duration === null ? null : tick(duration) });
const STRIKE = make('strike', 'strike', { range: tiles(2) });
const SHOT = make('shot', 'shot');
const BLAST = make('blast', 'blast', { cost: { fatigue: 0, mana: 4, time: 150 as never, cooldown: tick(0) },
  zone: { name: 'Embers', duration: tick(2500), ops: [{ op: 'damage', type: 'arcane', amount: f('1d4') }, { op: 'speed', pct: -20 }], endsWithOwner: true, around: null,
    grow: { step: tiles(1), cap: tiles(4) } } });
const CURSE = make('curse', 'curse', { ops: [status('burning', 2000, { op: 'damage', type: 'arcane', amount: f('1d4 + 1') }), status('slowed', 1500, { op: 'speed', pct: -30 })] });
const STUN = make('strike', 'stun', { range: tiles(3), ops: [status('stunned', 800, { op: 'hold' })] });
const ROOT = make('shot', 'snare', { ops: [status('rooted', 1200, { op: 'root' }), status('weakened', 3000, { op: 'stat', key: 'vit', amount: { kind: 'number', value: -20 } })] });
const TAUNT = make('curse', 'taunt', { effect: null, delivery: { kind: 'sure' }, range: tiles(12), shape: { kind: 'touch', reach: tiles(12) },
  ops: [status('taunted', 2000, { op: 'taunt' })] });
const SHIELD = make('support', 'shield');
/** An aura around its user (design 4.8) that heals its side and slows nobody: it moves with Mira. */
const WARD = make('support', 'ward', { aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null,
  zone: { name: 'Ward', duration: tick(3000), ops: [{ op: 'heal', amount: f('1d4') }, { op: 'heal', amount: f('2'), when: 'use' }], endsWithOwner: true, around: tiles(2), grow: null } });
const MEND = make('support', 'mend', { effect: { type: 'heal', by: 'hand', formula: f('1d6 + sup') }, ops: [status('regen', 3000, { op: 'heal', amount: f('4') }), status('hasted', 2000, { op: 'speed', pct: 25 })] });
const CHARGE = make('blast', 'charge', {
  cost: { fatigue: 0, mana: 3, time: 100 as never, cooldown: tick(0) }, range: tiles(14),
  effect: { type: 'arcane', by: 'hand', formula: f('(1d8 + mag) * (1 + 0.5 * charge)') }, channel: { growth: 'linear', max: 3 },
});
const BITE = make('strike', 'bite', { range: tiles(2), ops: [status('bleeding', 1500, { op: 'damage', type: 'physical', amount: f('2') })] });
const HOWL = make('curse', 'howl', { ops: [status('stunned', 600, { op: 'hold' })] });
/** Wolf A comes into the fight sick (design 4.8): its plague passes to whoever stands within 3 tiles once a round. */
const SICK = { key: statusKey('plague'), def: { label: 'plague', desc: '', ops: [{ op: 'damage', type: 'physical', amount: f('1') }, { op: 'spread', range: 3 }] as Op[] }, source: { id: null, tier: 1 }, until: null, since: tick(0), settledAt: tick(0) };
/** A bite whose sickness passes on to whoever stands next to its bearer (design 4.8). */
const PLAGUE = make('curse', 'plague-bite', { range: tiles(12), shape: { kind: 'touch', reach: tiles(12) }, ops: [status('plague', 4000, { op: 'damage', type: 'physical', amount: f('1d4') }, { op: 'spread', range: 1 })] });

// ── the kits' blocks (kits design 1 to 9): stacks and a threshold, triggers, prices and gates, a delayed effect, a zone
// with an upkeep and an end, a summon and limited uses, so random play reaches each machine of design section 2 ──
const stackDef = (label: string, cap: number, o: Partial<StackDef['stack']> = {}): StackDef => ({ label, desc: '', ops: [], stack: { cap, leave: { kind: 'never' }, keep: 'fight', threshold: null, ...o } });
/** Einar's Pain: a fight's count to 10 that never leaves. */
const PAIN = stackDef('Pain', 10);
const addTo = (key: string, def: StatusDef, n = 1, duration: number | null = null): UseOp & LandOp => ({ op: 'applyStatus', key: statusKey(key), def, duration: duration === null ? null : tick(duration), stacks: n });
const wornStatus = (key: string, label: string, ...triggers: Trigger[]): Status => ({ key: statusKey(key), def: { label, desc: '', ops: [], triggers }, source: { id: null, tier: 1 }, until: null, since: tick(0), settledAt: tick(0) });
/** Pain is Power: each hit its bearer deals adds a Pain. */
const PAIN_IS_POWER = wornStatus('pain-is-power', 'Pain is Power', { on: 'hitDealt', tag: null, to: 'self', limit: { kind: 'each' }, ops: [addTo('pain', PAIN)] });
/** Thorns: struck, its bearer hits back, once a round. */
const THORNS = wornStatus('thorns', 'Thorns', { on: 'struck', tag: null, to: 'other', limit: { kind: 'round' }, ops: [{ op: 'damage', type: 'physical', amount: f('2'), when: 'use' }] });
/** Retribution: a use it avoids, its bearer answers with a hit, twice a fight. */
const RETRIBUTION = wornStatus('retribution', 'Retribution', { on: 'avoided', tag: null, to: 'other', limit: { kind: 'fight', n: 2 }, ops: [{ op: 'damage', type: 'physical', amount: f('1d6'), when: 'use' }] });
/** Storage: a stack at each turn start, all gone when its bearer moves. */
const STORAGE = stackDef('Storage', 5, { leave: { kind: 'event', event: 'moved' } });
const EASEL = wornStatus('easel', 'Easel', { on: 'turnStart', to: 'self', limit: { kind: 'each' }, ops: [addTo('storage', STORAGE)] });
/** Resonance: three burst for a hit with an execute scaler (design 8.0), and are spent. */
const RESONANCE = stackDef('Resonance', 3, { threshold: { at: { kind: 'count', n: 3 }, to: { kind: 'bearer' }, then: 'spend',
  ops: [{ op: 'damage', type: 'arcane', amount: f('1.28 * (1d8 + mag) * (1 + max(0, min(1, (target.missing - 0.5) / 0.5)))'), when: 'use' }] } });
const BLOODLETTING = make('curse', 'bloodletting', { effect: { type: 'arcane', by: 'hand', formula: f('0.7 * (1d8 + mag)') }, ops: [addTo('resonance', RESONANCE, 2)] });
/** Violence: spends all Pain for more damage, only with some. */
const VIOLENCE = make('strike', 'violence', { range: tiles(2), effect: { type: 'physical', by: 'hand', formula: f('(1d8 + phys) * (1 + 0.06 * spent)') },
  prices: [{ kind: 'stacks', key: statusKey('pain'), from: 'self', take: { kind: 'all' } }], gates: [{ kind: 'holds', key: statusKey('pain'), on: 'self', atLeast: 1 }] });
/** Crimson Pact: a mode for a tenth of max HP, until removed. */
const PACT = make('support', 'pact', { aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null, prices: [{ kind: 'hp', amount: { kind: 'share', share: 0.1 } }],
  ops: [addTo('crimson-pact', { label: 'Crimson Pact', desc: '', ops: [] }, 1)] });
/**
 * Hemoplague: a bleed and a delayed hit, only in the Pact, twice a fight. It lasts 200 ticks, a sixth of a round: random
 * play ends most fights inside their first round, and at 800 ticks its end landed in 4 of 2,500 seeds, then in none when
 * the stun's rule moved the seeds (Nov 22: 126 put on, 51 lost to a cleared fight, 7 to a removed row, none reached its end).
 */
const HEMOPLAGUE = make('curse', 'hemoplague', { gates: [{ kind: 'holds', key: statusKey('crimson-pact'), on: 'self', atLeast: 1 }, { kind: 'uses', per: 'fight', n: 2 }],
  ops: [addTo('hemoplague', { label: 'Hemoplague', desc: '', ops: [{ op: 'damage', type: 'arcane', amount: f('1d4') }], end: { ops: [{ op: 'damage', type: 'arcane', amount: f('1d8 + mag'), when: 'use' }], cleanse: 'cancel' } }, 1, 200)] });
/** A boundary around Mira until removed that costs 5 fatigue a round and heals a little, and hits who stands in it when it ends. */
const BOUNDARY = make('support', 'boundary', { aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null,
  zone: { name: 'Boundary', duration: null, ops: [{ op: 'heal', amount: f('1') }], endsWithOwner: true, around: tiles(1), grow: null, upkeep: { fatigue: 5, mana: 0 },
    end: [{ op: 'damage', type: 'arcane', amount: f('1d6'), when: 'use' }] } });
const SHATTER = make('support', 'shatter', { aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null, prices: [{ kind: 'zone', name: 'Boundary', take: 'all' }] });
/** A sprite for 2 rounds, once a gate. */
/** A stacking status already on a body as the fight starts, from the GM. */
const holding = (key: string, def: StackDef, stacks: number): Status => ({ key: statusKey(key), def, source: { id: null, tier: 1 }, until: null, since: tick(0), settledAt: tick(0), stacks } as Status);
const SPRITE = make('support', 'sprite', { aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null, gates: [{ kind: 'uses', per: 'gate', n: 1 }],
  summon: { name: 'Sprite', archetype: 'skirmisher', rounds: 2, statuses: [] } });

// ── wave 2's blocks (kits design 8.1 to 8.7): a reaction of each moment, an edge, a held die, a push and a pull, a blink,
// a swap, an extra action, a hasten, a hide, the wards, a moved count and a zone act, so random play reaches each
// machine of design 8.9 ──
const quick = make('shot', 'q').cost;
const PARRY = make('strike', 'parry', { effect: null, cost: { ...quick, fatigue: 0 }, react: { when: 'before', reach: tiles(1) }, ops: [{ op: 'guard', share: RULES.fight.kit.parry }] });
const STAND = make('support', 'stand', { aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null, cost: { ...quick, fatigue: 0 }, react: { when: 'lethal', reach: tiles(0) },
  ops: [status('stone', 1000, { op: 'invulnerable' })] });
const RIPOSTE = make('strike', 'riposte', { effect: { type: 'physical', by: 'hand', formula: f('1d4 + 1') }, cost: { ...quick, fatigue: 0 }, react: { when: 'after', reach: tiles(0) } });
const REACT = make('support', 'react', { aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null, cost: { ...quick, fatigue: 0 }, react: { when: 'turn', reach: tiles(0) } });
const FOCUS = make('support', 'focus', { aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null,
  ops: [addTo('focus', stackDef('Focus', 3, {}), 1, 3000), status('luck', 3000, { op: 'boost', side: 'attack', die: { kind: 'die', sides: 4 } })] });
const GUARDED: Status = { key: statusKey('guarded'), def: { label: 'Guarded', desc: '', ops: [{ op: 'edge', side: 'defend', keep: 'better', tag: null, spend: false }] }, source: { id: null, tier: 1 }, until: null, since: tick(0), settledAt: tick(0) };
const SHOVE = make('strike', 'shove', { range: tiles(2), ops: [{ op: 'shove', dir: 'away', from: 'user', tiles: 2 }] });
const GRASP = make('shot', 'grasp', { ops: [{ op: 'shove', dir: 'toward', from: 'user', tiles: 3 }] });
const BLINK = make('support', 'blink', { aim: 'place', shape: { kind: 'self' }, range: tiles(8), effect: null, move: { kind: 'blink' } });
const SWAP = make('support', 'swap', { aim: 'ally', effect: null, range: tiles(8), move: { kind: 'swap' } });
const SURGE = make('strike', 'surge', { range: tiles(2), ops: [{ op: 'extra' }] });
const TRANSFER = make('support', 'transfer', { aim: 'ally', effect: null, range: tiles(8), ops: [{ op: 'hasten', share: 1 }] });
const HIDE = make('support', 'hide', { aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null, ops: [status('hidden', 2000, { op: 'hidden', level: 1, start: 'unseen', ends: { hurt: true, revealed: true, dealt: true } })] });
const VEIL = make('support', 'veil', { aim: 'self', shape: { kind: 'self' }, range: tiles(0), effect: null, ops: [status('veil', 2000, { op: 'untargetable' }), status('aegis', 2000, { op: 'safeguard' })] });
const BRITTLE = make('curse', 'brittle', { ops: [status('brittle', 2000, { op: 'share', on: 'taken', pct: 25 }, { op: 'sheet', key: 'exposed', amount: 1 }, { op: 'sheet', key: 'armor', amount: { kind: 'number', value: -10 } })] });
const CLEANSE = make('support', 'cleanse', { effect: null, ops: [{ op: 'dispel', which: 'all' }, { op: 'move', key: 'harmful', take: 'all', from: 'target', as: null }] });
const PUSH_FIELD = make('blast', 'push-field', { cost: { fatigue: 0, mana: 2, time: 100 as never, cooldown: tick(0) }, effect: null, zoneAct: { act: 'shift', name: null, by: 4 } });
/** Kai's Boundary as the fight begins: around Kai, until removed, ending with Kai. */
const KAI_BOUNDARY: Zone = {
  id: zoneId('kai-boundary'), name: 'Boundary', ground: { kind: 'around', anchor: { kind: 'body', id: combatantId('c-kai'), status: null }, radius: tiles(1), grow: null },
  owner: combatantId('c-kai'), spares: null, tier: 1, until: null, endsWithOwner: true, ops: [{ op: 'heal', amount: f('1') }],
};
/** The reactions a row may arm, by row (the GM arms anyone's; a player its hunter's). */
export const REACTIONS: readonly Ability[] = [PARRY, STAND, RIPOSTE, REACT];

// ── the roster: three hunters of different builds, a shadow, three monsters (one with its seed's tweak) and a boss ──
const build = (main: StatKey, second: StatKey, kit: Kit): Origin => ({
  kind: 'hunter', build: { stats: { ...baseStats(RULES.fight), [main]: 30, [second]: 20 }, level: 5, gear: kitGear(kit, RULES), perks: {} },
});
const mon = (rank: 'C' | 'D', archetype: Archetype, monsterKind: MonsterKind, tweak: Tweak = NO_TWEAK): Origin => ({ kind: 'monster', name: 'Monster', rank, archetype, monsterKind, tweak });
function row(id: string, name: string, side: NewRow['side'], kind: NewRow['kind'], origin: Origin, abilities: Ability[], o: Partial<Omit<NewRow, 'kind' | 'life'>> = {}): NewRow {
  const sheet = modified(origin, [], RULES).sheet;
  return {
    id: combatantId(id), name, side, ...lifeAt(kind, sheet.hpMax), origin, tier: 1, place: null, mana: sheet.manaMax, fatigue: 0, shield: null,
    stagger: null, channel: null, threat: kind === 'monster' ? {} : null, statuses: [], readyAt: {}, abilities, intent: null,
    holder: null, xp: 0, mythic: null, ...o,
  } as NewRow;
}
export const ROSTER: readonly NewRow[] = [
  row('c-brakk', 'Brakk', 'party', 'hunter', build('str', 'vit', 'medium'), [STRIKE, STUN, TAUNT, VIOLENCE], { holder: { kind: 'local', hunterId: hunterId('h-brakk') }, statuses: [PAIN_IS_POWER, holding('pain', PAIN, 2)] }),
  row('c-sela', 'Sela', 'party', 'hunter', build('pow', 'ctl', 'light'), [BLAST, CURSE, CHARGE, SHOT, BLOODLETTING, PACT, HEMOPLAGUE], { holder: { kind: 'local', hunterId: hunterId('h-sela') }, statuses: [wornStatus('crimson-pact', 'Crimson Pact')] }),
  row('c-mira', 'Mira', 'party', 'hunter', build('pre', 'dis', 'light'), [SHIELD, MEND, ROOT, WARD, BOUNDARY, SHATTER, SPRITE], { holder: { kind: 'remote', remote: sheetKey('dev-mira:h1') } }),
  row('c-igris', 'Igris', 'party', 'shadow', mon('D', 'brute', 'normal'), [STRIKE, BITE],
    { owner: combatantId('c-sela'), holder: { kind: 'shadow', hunterId: hunterId('h-sela'), shadowId: shadowId('s-igris') }, statuses: [EASEL] }),
  row('c-w1', 'Wolf A', 'foe', 'monster', mon('D', 'skirmisher', 'normal'), [BITE, HOWL], { xp: 50, statuses: [SICK, holding('resonance', RESONANCE, 1)] }),
  row('c-w2', 'Wolf B', 'foe', 'monster', mon('D', 'skirmisher', 'normal'), [BITE, PLAGUE], { xp: 50, statuses: [RETRIBUTION] }),
  row('c-imp', 'Imp', 'foe', 'monster', mon('D', 'caster', 'normal', { hp: 0.7, dealt: 1, stats: { ins: 8 }, traits: [] }), [CURSE, SHOT, SPRITE], { place: place(15, 11), xp: 40 }),
  // wave 2's blocks on two rows of their own, so the blocks above keep the share of random play they had
  row('c-kai', 'Kai', 'party', 'hunter', build('agi', 'str', 'light'), [BOUNDARY, SHATTER, HEMOPLAGUE, PARRY, SURGE, SHOVE, TRANSFER, BLINK, REACT],
    { holder: { kind: 'local', hunterId: hunterId('h-kai') }, statuses: [wornStatus('crimson-pact', 'Crimson Pact')] }),
  row('c-shade', 'Shade', 'foe', 'monster', mon('D', 'skirmisher', 'elite'), [BITE, HIDE, RIPOSTE, FOCUS, BRITTLE, VEIL, GRASP, CLEANSE, SWAP, STAND, BLAST, PUSH_FIELD], { xp: 80, statuses: [GUARDED] }),
  row('c-ogre', 'Ogre', 'foe', 'monster', mon('C', 'brute', 'boss'), [STRIKE, HOWL, CHARGE],
    { stagger: { fill: 0, max: 30, hit: 25 }, xp: 300, statuses: [THORNS, holding('resonance', RESONANCE, 1)] }),
];

/**
 * A mythic playing the Fourth Rider's script (design B.6), at rank D so it fits the roster's fights: its second turn
 * names a hunter, its third lands the name; Brakk's stun and Mira's snare cancel it, a hit of 5% of its HP weakens it.
 * Made under the shipped rules (scripts are on by default); the reducer plays any row that holds a standing. It is
 * not in `ROSTER`, and joins a third of the random fights, chosen by the fight's id so the seeds of the others draw as
 * they did.
 */
export const MYTHIC: NewRow = monsterRows({ ...seedMonsters(RULES).find(m => m.script === 'the-fourth-rider')!, rank: 'D' }, [combatantId('c-rider')], RULES)[0]!;
/** Whether the random fight of id `id` holds the mythic: a third of them, by the id's characters. */
const holdsMythic = (id: string): boolean => [...id].reduce((n, c) => n + c.charCodeAt(0), 0) % 3 === 0;

// ── dice from the seed ──
const roll = (g: Rng, d: Dice): number => Array.from({ length: d.count }, () => g.int(1, d.sides)).reduce((a, b) => a + b, 0);
/** The dice `needs` asks for (`asked`, when given: a landing's), rolled; now and then one is left out, so the reducer must refuse. */
function rollsFor(g: Rng, fight: Fight, by: CombatantId, a: Ability, aim: Aim, asked?: ReturnType<typeof needs>): Rolls {
  if (fight.phase !== 'running') return { dice: {}, react: {} };
  const user = fight.rows.find(r => r.id === by);
  if (!user) return { dice: {}, react: {} };
  const n = asked ?? needs(a, user, fight.rows, aim, fight.grid, fight.now, RULES);
  const dice = Object.fromEntries(Object.entries(n.dice).map(([id, ds]) => [id, (ds as readonly Dice[]).map(d => roll(g, d))]));
  const react = Object.fromEntries(n.react.map(id => [id, g.int(1, 20)]));
  const second = n.second?.length ? Object.fromEntries(n.second.map(id => [id, g.int(1, 20)])) : null;
  const boost = n.boost?.length ? Object.fromEntries(n.boost.map(b => [b.id, g.int(1, b.sides)])) : null;
  const out: Rolls = { dice, react, ...(n.refund ? { refund: g.int(1, 20) } : {}), ...(second ? { second } : {}), ...(boost ? { boost } : {}) };
  if (g.chance(0.04) && n.react.length) return { ...out, react: {} };
  return out;
}

// ── random commands ──
// ── the GM's Status window and hand edits ──
const def = (label: string, ...ops: Op[]): StatusDef => ({ label, desc: '', ops });
const GM_STATUSES: readonly [string, StatusDef][] = [
  ['stunned', def('Stunned', { op: 'hold' })], ['slowed', def('Slowed', { op: 'speed', pct: -30 })],
  ['burning', def('Burning', { op: 'damage', type: 'arcane', amount: f('1d6') })], ['weakened', def('Weakened', { op: 'stat', key: 'vit', amount: { kind: 'number', value: -20 } })],
  ['sickness', def('Radiating sickness', { op: 'damage', type: 'arcane', amount: f('2') }, { op: 'speed', pct: -10 }, { op: 'aura', radius: 2, on: 'all' })],
  ['plague', def('Plague', { op: 'damage', type: 'physical', amount: f('1d4') }, { op: 'spread', range: 2 })],
];
function gmStatus(g: Rng, id: CombatantId): Command {
  const [key, d] = g.pick(GM_STATUSES), add = { key: statusKey(key), def: d, duration: g.chance(0.2) ? null : tick(g.int(1, 4) * 500), tier: g.int(0, 5) };
  const remove = statusKey(g.pick(GM_STATUSES)[0]);
  return g.chance(0.3) ? { type: 'status', id, remove } : g.chance(0.2) ? { type: 'status', id, remove, add } : { type: 'status', id, add };
}
/** The GM's fudge (notes-8-fudge.md section 2): a side's or a row's weight, now and then one that is not whole, or a row's forced next roll. */
function gmFudge(g: Rng, id: CombatantId): Command {
  if (g.chance(0.3)) return { type: 'fudge', set: { kind: 'force', id, face: g.pick([1, 20, null] as const) } };
  const scope = g.chance(0.5) ? { kind: 'side', side: g.pick(['party', 'foe'] as const) } as const : { kind: 'row', id } as const;
  return { type: 'fudge', set: { kind: 'weight', scope, n: g.chance(0.05) ? 1.5 : g.int(-3, 3) } };
}
/** The GM's hand on the mythic's script (design B.4): mostly on the mythic, now and then on another row, which is refused. */
const gmMythic = (g: Rng, mythic: Body, anyId: () => CombatantId): Command => ({ type: 'mythic', by: g.chance(0.9) ? mythic.id : anyId(), step: g.pick(['drop', 'next'] as const) });
/** The mythic's landing turn: its omen's move at its aim (fight-turn.ts `omenMove`), with the dice it asks for. */
function landing(g: Rng, fight: Running, u: Body): Command | null {
  const m = omenMove(u, RULES), n = omenNeeds(fight, u, RULES);
  return m && n && { type: 'act', by: u.id, ability: m.ability.id, aim: m.aim, rolls: rollsFor(g, fight, u.id, m.ability, m.aim, n) };
}
const gmAdjust = (g: Rng, id: CombatantId): Command => ({
  type: 'adjust', id, ...(g.chance(0.8) ? { hp: g.int(-60, 30) } : {}), ...(g.chance(0.3) ? { mana: g.int(-5, 5) } : {}),
  ...(g.chance(0.3) ? { fatigue: g.int(-30, 30) } : {}),
  // the GM sets a limited ability's uses (kits table 2.3); an ability with none is refused
  ...(g.chance(0.1) ? { used: { ability: g.pick([HEMOPLAGUE.id, SPRITE.id, STRIKE.id]), spent: g.int(0, 2) } } : {}),
});

/** The GM's Revive, mostly of a row that is dead so most land; on any other row the fight refuses it. */
function gmRevive(g: Rng, fight: Fight, anyId: () => CombatantId): Command {
  const down = fight.rows.filter(r => !isUp(r));
  return { type: 'revive', id: down.length && g.chance(0.8) ? g.pick(down).id : anyId() };
}

// ── the GM's ground: paint and zones ──
const ZONE_OPS: readonly (readonly Op[])[] = [
  [{ op: 'damage', type: 'arcane', amount: f('3') }], [{ op: 'damage', type: 'physical', amount: f('1d6'), when: 'use' }],
  [{ op: 'speed', pct: -40 }, { op: 'heal', amount: f('2') }], [{ op: 'root' }], [{ op: 'stat', key: 'agi', amount: { kind: 'number', value: -10 } }, { op: 'damage', type: 'arcane', amount: f('2'), when: 'use' }],
];
function ground(g: Rng, fight: Fight, anyRow: () => Place): Command {
  const k = g.int(0, 3);
  // the GM's map size (design 4.8): mostly a step of one either way, sometimes out of bounds
  if (k === 3) return { type: 'resize', w: fight.grid.w + g.int(-2, 2), h: fight.grid.h + (g.chance(0.05) ? 40 : g.int(-2, 2)) };
  if (k === 0) return { type: 'paint', tiles: Array.from({ length: g.int(1, 4) }, () => g.chance(0.5) ? near(g, anyRow(), 1) : anyPlace(g)), terrain: g.pick(TERRAINS) };
  if (k === 1 || !fight.zones.length) {
    const at = g.chance(0.7) ? anyRow() : anyPlace(g), n = g.int(1, 3);
    return { type: 'zoneAdd', zone: {
      id: zoneId(`g${g.int(1, 30)}`), name: 'Mire', tiles: Array.from({ length: n }, () => near(g, at, 1)), spares: g.chance(0.3) ? g.pick(['party', 'foe'] as const) : null,
      tier: g.int(0, 5), duration: g.chance(0.3) ? null : tick(g.int(1, 6) * 500), ops: g.pick(ZONE_OPS),
    } };
  }
  return { type: 'zoneRemove', id: g.chance(0.9) ? g.pick(fight.zones).id : zoneId('z-ghost') };
}

const openingsOf = (g: Rng, rows: readonly { id: CombatantId }[]): Opening[] => rows.map(r => ({ id: r.id, d20: g.int(1, 20), tie: g.int(1, 1000) }));
const near = (g: Rng, p: Place, by: number): Place => place(p.x + g.int(-by, by), p.y + g.int(-by, by));
const anyPlace = (g: Rng): Place => place(g.int(-1, GRID.w), g.int(-1, GRID.h));

/** A command for `fight`: mostly what a table would send on the current turn, sometimes something it must refuse. */
export function randomCommand(g: Rng, fight: Fight | null, fresh: () => string): Command {
  if (!fight) {
    if (g.chance(0.9)) {
      const rows = g.chance(0.2) ? ROSTER.filter(() => g.chance(0.5)) : ROSTER;
      const fog = g.chance(0.3) ? { sight: tiles(g.int(3, 25)), seen: '0'.repeat(GRID.w * GRID.h) } : null;
      // Kai comes in holding a Boundary (kits design 1.8), so its zone price meets one as often as the blocks of eleven rows allow
      const zones = rows.some(r => r.id === 'c-kai') ? [KAI_BOUNDARY] : [], id = fresh();
      return { type: 'add', fightId: fightId(id), rows: holdsMythic(id) ? [...rows, MYTHIC] : rows, openings: [], grid: GRID, fog, zones };
    }
    return g.pick<Command>([{ type: 'end' }, { type: 'clear' }, { type: 'start', openings: [] }]);
  }
  const ids = fight.rows.map(r => r.id);
  const anyId = (): CombatantId => ids.length && !g.chance(0.05) ? g.pick(ids) : combatantId('c-ghost');
  // the GM's hand on a mythic takes every other fudge of a fight that holds one, by its log's length, so no draw moves elsewhere
  const mythic = fight.rows.find(r => r.mythic), fudge = (): Command => (mythic && fight.log.length % 2 === 0 ? gmMythic(g, mythic, anyId) : gmFudge(g, anyId()));
  const monster = (): NewRow => {
    const id = fresh();
    return row(id, `Wolf ${id}`, 'foe', 'monster', mon('D', 'skirmisher', 'normal'), [BITE], { xp: 50, ...(g.chance(0.3) ? { place: anyPlace(g) } : {}) });
  };
  // after the end, an extraction attempt on a fallen monster, as the GM's Extract button sits only on its card (any row
  // when none fell, which is refused). Its outcome follows the log's length, so a seed whose ended fights hold no fallen
  // monster draws as it did. Aimed at any row, random play reached one extraction in 2,500 seeds, and lost it to drift; now the GM fells a
  // monster before most ends (case 'end' below) and tries its corpse in 7 of 10 ended fights that hold one (Nov 22: 80 seeds of 2,500)
  if (fight.phase === 'ended') {
    const fallen = fight.rows.filter(r => r.kind === 'monster' && !isUp(r)).map(r => r.id);
    const corpse = (): CombatantId => (fallen.length ? g.pick(fallen) : anyId());
    const rolls = [{ natural: 5, bonus: 0, dc: 15 }, { natural: 1, bonus: 0, dc: 15 }, { natural: 20, bonus: 0, dc: 15 }] as const;
    return g.chance(fallen.length ? 0.3 : 0.8) ? { type: 'clear' } : g.pick<Command>([{ type: 'end' }, { type: 'extract', what: fight.log.length % 2 === 0 ? 'shadow' : 'blood', id: corpse(), by: fight.rows.find(r => r.kind === 'hunter')?.id ?? combatantId('c-ghost'), roll: rolls[fight.log.length % rolls.length]! }]);
  }
  if (fight.phase === 'setup') {
    const kind = g.pick(['start', 'start', 'start', 'add', 'remove', 'place', 'intent', 'reveal', 'end', 'act', 'adjust', 'refill', 'revive', 'status', 'ground', 'fudge'] as const);
    switch (kind) {
      case 'start': return { type: 'start', openings: openingsOf(g, g.chance(0.9) ? fight.rows : fight.rows.slice(1)) };
      case 'add': return { type: 'add', fightId: fightId(fresh()), rows: [monster()], openings: [] };
      case 'remove': return { type: 'remove', id: anyId() };
      case 'place': return { type: 'place', id: anyId(), to: anyPlace(g) };
      case 'intent': return { type: 'setIntent', by: anyId(), ability: abilityId('bite'), aim: anyId() };
      case 'reveal': return { type: 'reveal', by: anyId() };
      case 'end': return { type: 'end' };
      case 'act': return { type: 'act', by: anyId(), ability: abilityId('strike'), aim: anyId(), rolls: { dice: {}, react: {} } };
      case 'adjust': return gmAdjust(g, anyId());
      case 'refill': return { type: 'refill', id: anyId() };
      case 'revive': return gmRevive(g, fight, anyId);
      case 'status': return gmStatus(g, anyId());
      case 'ground': return ground(g, fight, () => fight.rows.length ? g.pick(fight.rows).place : anyPlace(g));
      case 'fudge': return fudge();
    }
  }
  const cur = fight.rows.find(r => r.id === fight.currentId)!;
  if (fight.dodge) {
    const ask = dodgeAsk(fight, RULES);
    if (ask && g.chance(0.75)) {
      const r = g.int(0, 2);
      if (r === 0) return { type: 'dodge', id: null, to: null };
      if (r === 1) return { type: 'dodge', id: ask.who, to: g.pick(ask.tiles).place };
      return { type: 'dodge', id: null, to: g.pick(ask.tiles).place };
    }
    if (g.chance(0.4)) return { type: 'dodge', id: g.chance(0.5) ? anyId() : null, to: g.chance(0.5) ? anyPlace(g) : g.pick(fight.rows).place };
    if (g.chance(0.2)) return g.chance(0.5) ? { type: 'end' } : { type: 'clear' };
    return { type: 'endTurn', by: cur.id };
  }
  const by = g.chance(0.9) ? cur.id : anyId();
  const user = fight.rows.find(r => r.id === by) ?? cur;
  const kind = g.pick([
    'act', 'act', 'act', 'act', 'act', 'act', 'move', 'move', 'pass', 'pass', 'release', 'settle', 'settle', 'intent', 'reveal', 'place', 'add',
    'remove', 'end', 'force', 'adjust', 'refill', 'revive', 'status', 'ground', 'ground', 'arm', 'fudge',
  ] as const);
  switch (kind) {
    case 'act': case 'force': {
      // a mythic's landing turn takes only its omen's move (design B.3): mostly that, now and then any of its abilities
      const lands = runningState(fight).at === 'landing' && by === cur.id && g.chance(0.85) ? landing(g, fight, cur) : null;
      if (lands) return lands;
      const a = user.abilities.length && !g.chance(0.03) ? g.pick(user.abilities) : STRIKE;
      const foes = fight.rows.filter(r => r.side !== user.side && rowHp(r) > 0), allies = fight.rows.filter(r => r.side === user.side && rowHp(r) > 0);
      const aim: Aim = a.aim === 'place' ? (foes.length && g.chance(0.8) ? near(g, g.pick(foes).place, 1) : anyPlace(g))
        : a.aim === 'ally' ? (allies.length ? g.pick(allies).id : anyId())
          : a.aim === 'self' ? user.id : foes.length && g.chance(0.85) ? g.pick(foes).id : anyId();
      return { type: 'act', by, ability: a.id, aim, rolls: rollsFor(g, fight, by, a, aim), ...(kind === 'force' ? { force: true } : {}) };
    }
    case 'move': return g.chance(0.3) ? { type: 'move', by, to: near(g, user.place, 6), dash: true } : { type: 'move', by, to: near(g, user.place, g.chance(0.8) ? 3 : 5) };
    case 'pass': return { type: 'endTurn', by };
    case 'release': {
      const c = fight.rows.find(r => r.channel && r.channel.state !== 'fired' && rowHp(r) > 0) ?? user;
      const a = c.abilities.find(x => x.id === c.channel?.ability);
      return { type: 'release', by: c.id, rolls: a && c.channel ? rollsFor(g, fight, c.id, a, c.channel.aim) : { dice: {}, react: {} } };
    }
    case 'settle': {
      const p = fight.pending.length ? g.pick(fight.pending) : null;
      if (!p) return { type: 'settle', id: anyId(), key: statusKey('burning'), dice: [3] };
      const dice = 'due' in p ? diceOf(atTier(p.due.op.amount, p.due.tier)).map(d => roll(g, d)) : p.spread.targets.map(() => g.int(1, 20));
      return { type: 'settle', id: p.id, key: pendingKey(p), dice: g.chance(0.1) ? [] : dice };
    }
    case 'intent': {
      const m = fight.rows.filter(r => r.kind === 'monster');
      const who = m.length && g.chance(0.85) ? g.pick(m) : user;
      return { type: 'setIntent', by: who.id, ability: who.abilities[0]?.id ?? abilityId('bite'), aim: anyId() };
    }
    case 'reveal': return { type: 'reveal', by: g.chance(0.8) ? fight.rows.find(r => r.intent)?.id ?? anyId() : anyId() };
    case 'place': return { type: 'place', id: anyId(), to: g.chance(0.5) ? near(g, fight.rows.find(r => r.id === anyId())?.place ?? place(0, 0), 2) : anyPlace(g) };
    case 'add': { const m = monster(); return { type: 'add', fightId: fightId(fresh()), rows: [m], openings: g.chance(0.9) ? openingsOf(g, [m]) : [] }; }
    case 'remove': return { type: 'remove', id: anyId() };
    case 'end': {
      // a monster falls before the GM ends the fight, as one did at a table; hits alone left one fallen in 43 of 2,500 seeds
      const standing = fight.rows.find(r => r.kind === 'monster' && isUp(r));
      if (standing && !fight.rows.some(r => r.kind === 'monster' && !isUp(r)) && g.chance(0.6)) return { type: 'adjust', id: standing.id, hp: -rowHp(standing) };
      return g.chance(0.5) ? { type: 'end' } : { type: 'clear' };
    }
    case 'adjust': return gmAdjust(g, anyId());
    case 'refill': return { type: 'refill', id: anyId() };
    case 'revive': return gmRevive(g, fight, anyId);
    case 'status': return gmStatus(g, g.chance(0.3) ? cur.id : anyId());
    case 'ground': return ground(g, fight, () => g.pick(fight.rows).place);
    case 'fudge': return fudge();
    // the GM's arm, or a player's through the room (kits design 8.4.2): one of the row's reactions, another ability, or none
    case 'arm': {
      const who = g.chance(0.9) ? g.pick(fight.rows) : user, mine = who.abilities.filter(a => a.react);
      const a = mine.length && g.chance(0.85) ? g.pick(mine) : g.chance(0.5) ? null : g.pick(REACTIONS);
      return { type: 'arm', by: who.id, ability: a ? a.id : null, ...(a?.react?.when === 'turn' || g.chance(0.1) ? { on: anyId() } : {}) };
    }
  }
}

/** The seeds and lengths the model test plays: seed n plays 10 + (n mod 40) commands. */
export const SEEDS = 2500;
export const lengthOf = (seed: number): number => 10 + (seed % 40);
