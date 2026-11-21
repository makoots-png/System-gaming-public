import { describe, expect, test } from 'bun:test';
import { SCHEMA, parseSaveValue } from '../src/core/save.ts';
import { dev } from './fixtures/ids.ts';
import { ICON_GROUPS, ICON_KEYS, ICON_KEY_MAX, iconDef, iconsOf, isIconKey } from '../src/core/registry/icons.ts';
import type { IconGroup, IconKey } from '../src/core/registry/icons.ts';
import { abilityIcon, itemIcon, monsterIcon, opIcon, statusIcon } from '../src/core/registry/icon-defaults.ts';
import { RULES } from '../src/core/rules.ts';
import { ATTACKS, ITEM_TYPES, SLOTS, builtInItems } from '../src/core/registry/items.ts';
import type { ItemType, Slot } from '../src/core/registry/items.ts';
import { ARCHETYPE_LIST, SEEDS } from '../src/core/registry/monsters.ts';
import { BUILT_IN_STATUSES, STATUS_KEYS } from '../src/core/registry/statuses.ts';
import type { BuiltInStatus } from '../src/core/registry/statuses.ts';
import { OP_KINDS, statusKey } from '../src/core/combat/effect-ops.ts';
import type { Op, OpKind, StatusDef } from '../src/core/combat/effect-ops.ts';
import type { AbilityKind } from '../src/core/combat/ability-types.ts';
import type { Archetype } from '../src/core/hunter/derive.ts';
import type { Formula } from '../src/core/formula.ts';
import { tick } from '../src/core/combat/timeline.ts';
import type { ItemId } from '../src/core/ids.ts';
import { rowIcon } from '../src/core/combat/row-icon.ts';
import type { CombatantKind, Origin } from '../src/core/combat/effect-ops.ts';
import { baseStats } from '../src/core/stats.ts';
import { kitGear } from '../src/core/hunter/derive.ts';

/** The twelve emblem keys a hunter could pick before the registry, in their order. A saved key is never renamed. */
const EMBLEM_KEYS = ['star', 'crown', 'moon', 'flame', 'shield', 'blade', 'eye', 'bolt', 'skull', 'wing', 'diamond', 'fang'];

/** The arguments each path command takes. */
const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/**
 * The points a path reaches (an arc by its end), relative commands walked from the current point, each to a millionth
 * (a walk of one-decimal steps adds up float error, 2 reads as 1.9999999999999982). Throws on a path that does not read.
 */
function points(path: string): [number, number][] {
  if (!/^[MLHVCSQTAZmlhvcsqtaz0-9.,\s-]+$/.test(path)) throw new Error('a character that is not path data');
  const out: [number, number][] = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  for (const [, cmd, rest] of path.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const up = cmd!.toUpperCase(), rel = cmd !== up, n = ARGS[up]!;
    const nums = (rest!.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    if (n === 0 ? nums.length > 0 : nums.length === 0 || nums.length % n !== 0) throw new Error(`${cmd} has ${nums.length} numbers`);
    for (let i = 0; n > 0 && i < nums.length; i += n) {
      const a = nums.slice(i, i + n);
      if (up === 'A' && !(a[3] === 0 || a[3] === 1) ) throw new Error('arc flag');
      const ex = a[n - 2]!, ey = a[n - 1]!;
      if (up === 'H') x = (rel ? x : 0) + a[0]!;
      else if (up === 'V') y = (rel ? y : 0) + a[0]!;
      else { x = (rel ? x : 0) + ex; y = (rel ? y : 0) + ey; }
      out.push([Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]);
      if (up === 'M') { sx = x; sy = y; }
    }
    if (up === 'Z') { x = sx; y = sy; }
  }
  return out;
}

describe('every icon of the registry', () => {
  test('has a key of lowercase letters and hyphens within the limit, a known group, a label and a path that reads inside 0 to 24', () => {
    expect(ICON_KEYS.length).toBeGreaterThan(0);
    for (const k of ICON_KEYS) {
      const d = iconDef(k);
      expect(k, k).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(k.length, k).toBeLessThanOrEqual(ICON_KEY_MAX);
      expect(ICON_GROUPS, k).toContain(d.group);
      expect(d.label.trim(), k).not.toBe('');
      expect(d.path.length, k).toBeLessThanOrEqual(400);
      for (const [px, py] of points(d.path)) {
        expect(px, `${k} x`).toBeGreaterThanOrEqual(0); expect(px, `${k} x`).toBeLessThanOrEqual(24);
        expect(py, `${k} y`).toBeGreaterThanOrEqual(0); expect(py, `${k} y`).toBeLessThanOrEqual(24);
      }
    }
  });

  test('the path check itself refuses a path that does not read or leaves the grid', () => {
    expect(() => points('M1 1L2')).toThrow();
    expect(() => points('M1 1<script>')).toThrow();
    expect(points('M1 1h30').some(([px]) => px > 24)).toBe(true);
    expect(points('M2 2l3 3z')).toEqual([[2, 2], [5, 5]]);
  });
});

describe('the emblems', () => {
  test('every emblem key a hunter could save before the registry is still found, in the group emblem, in its old order', () => {
    for (const k of EMBLEM_KEYS) { expect(isIconKey(k), k).toBe(true); expect(iconDef(k as never).group, k).toBe('emblem'); }
    expect(iconsOf('emblem')).toEqual(EMBLEM_KEYS);
  });

  test('keep their old drawings', () => {
    expect(iconDef('star' as never).path).toBe('M12 2l3 7h7l-5.5 4.5 2 7.5L12 17l-6.5 4 2-7.5L2 9h7z');
    expect(iconDef('fang' as never).path).toBe('M4 3h16l-3 8-5 11-5-11z');
  });
});

describe('a key that is not in the registry', () => {
  test('is refused, whatever it is', () => {
    for (const v of ['', 'unicorn', 'Star', 'toString', '__proto__', 'constructor', 'hasOwnProperty', 3, null, undefined, {}, ['star']]) {
      expect(isIconKey(v), String(v)).toBe(false);
    }
  });
});

describe('a saved hunter\'s emblem', () => {
  const env = { now: new Date('2026-11-14T10:00:00Z'), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-test') };
  const emblemAfterLoad = (emblem: unknown): unknown => {
    const p = parseSaveValue({ schema: SCHEMA, hunters: [{ id: 'h1', emblem }] }, env);
    if (p.kind !== 'save') throw new Error(p.kind);
    return p.save.hunters[0]!.emblem;
  };

  test('every key of an old save reads as it was saved', () => {
    for (const k of EMBLEM_KEYS) expect(emblemAfterLoad(k), k).toBe(k);
  });

  test('a key the registry does not hold reads as no emblem (the initial)', () => {
    for (const v of ['unicorn', 'toString', '__proto__', 7, null]) expect(emblemAfterLoad(v), String(v)).toBe('');
  });
});

/** The first set, by group, as docs/agent-handoff/features/icons/design.md section 2 lists it: 83 new drawings beside the 12 emblems. */
const FIRST_SET: Readonly<Record<Exclude<IconGroup, 'emblem'>, readonly string[]>> = {
  foe: ['wolf', 'beetle', 'golem', 'horns', 'ghost', 'warrior', 'dragon', 'giant', 'vine', 'vortex', 'butterfly', 'fish', 'tentacle',
    'slime', 'halo', 'claw', 'orb', 'spider', 'serpent', 'bat', 'raven', 'rat', 'bear', 'goblin', 'tree', 'mushroom', 'scorpion',
    'shark', 'mimic'],
  item: ['sword', 'dagger', 'axe', 'hammer', 'spear', 'staff', 'bow', 'helm', 'chestplate', 'gauntlet', 'greaves', 'boots', 'cloak',
    'amulet', 'ring', 'potion', 'crystal', 'herb', 'scroll', 'bomb', 'ore', 'gem', 'key', 'pouch'],
  status: ['blood', 'poison', 'dizzy', 'fear', 'blind', 'snail', 'faded', 'fallen', 'chain', 'hood', 'rage', 'heal', 'plague',
    'slash', 'spark', 'mana', 'weary', 'cure', 'up', 'down', 'taunt', 'ward', 'timer', 'push', 'status'],
  ability: ['strike', 'arrow', 'burst', 'hex', 'aid'],
};

describe('the first set', () => {
  test('lists each group\'s icons in the order of the design, 95 in all with the emblems', () => {
    for (const [group, keys] of Object.entries(FIRST_SET)) expect(iconsOf(group as IconGroup), group).toEqual([...keys]);
    expect(Object.values(FIRST_SET).flat()).toHaveLength(83);
    expect(ICON_KEYS).toHaveLength(95);
  });

  test('every icon is drawn inside the style\'s box, 2 to 22, so two icons side by side look one size', () => {
    for (const k of ICON_KEYS) {
      for (const [px, py] of points(iconDef(k).path)) {
        expect(px, `${k} x`).toBeGreaterThanOrEqual(2); expect(px, `${k} x`).toBeLessThanOrEqual(22);
        expect(py, `${k} y`).toBeGreaterThanOrEqual(2); expect(py, `${k} y`).toBeLessThanOrEqual(22);
      }
    }
  });
});

describe('the credit file beside the registry', () => {
  test('names who drew every icon of the first set, as the set\'s licence asks', async () => {
    const credit = await Bun.file(`${import.meta.dir}/../src/core/registry/icons-credit.md`).text();
    for (const k of Object.values(FIRST_SET).flat()) expect(credit, k).toMatch(new RegExp(`^\\| ${k} \\| (Lorc|Delapouite|drawn here)`, 'm'));
  });
});

// The default rule of design section 3: the expected pictures are the design's words, cell by cell.
/** An enemy type's picture (Undead is the emblem skull). */
const TYPE_PICTURE: Readonly<Record<string, IconKey>> = {
  Beast: 'wolf', Undead: 'skull', Insect: 'beetle', Construct: 'golem', Demon: 'horns', Spirit: 'ghost', Humanoid: 'warrior',
  Dragon: 'dragon', Giant: 'giant', Plant: 'vine', Elemental: 'vortex', Fey: 'butterfly', Aquatic: 'fish', Aberration: 'tentacle',
  Ooze: 'slime', Celestial: 'halo',
};
/** An archetype's picture, for a type that is none of the sixteen (a skirmisher's is the item dagger). */
const ARCHETYPE_PICTURE: Readonly<Record<Archetype, IconKey>> = { brute: 'claw', caster: 'orb', skirmisher: 'dagger' };

describe('an enemy\'s default icon', () => {
  test('is its type\'s picture for each of the sixteen types, whatever its archetype, its case or the spaces around it', () => {
    for (const [type, icon] of Object.entries(TYPE_PICTURE)) {
      for (const archetype of ARCHETYPE_LIST) {
        expect(monsterIcon({ type, archetype }), type).toBe(icon);
        expect(monsterIcon({ type: ` ${type.toUpperCase()}  `, archetype }), type).toBe(icon);
      }
    }
  });

  test('is its archetype\'s picture when the GM typed another type, none, or a word every object has', () => {
    for (const archetype of ARCHETYPE_LIST) {
      for (const type of ['Slime-thing', '', '   ', 'constructor', 'toString', '__proto__', undefined]) {
        expect(monsterIcon({ archetype, ...(type === undefined ? {} : { type }) }), `${archetype} ${String(type)}`).toBe(ARCHETYPE_PICTURE[archetype]);
      }
    }
  });

  test('is the icon the GM picked when it has one', () => {
    expect(monsterIcon({ type: 'Beast', archetype: 'brute', icon: 'raven' })).toBe('raven');
  });

  test('of every built-in monster is its type\'s picture', () => {
    for (const [slug, , , type, archetype] of SEEDS) expect(monsterIcon({ type, archetype }), slug).toBe(TYPE_PICTURE[type]!);
  });
});

/** A bag item with only what its default reads. */
const item = (type: ItemType, slot: Slot | null, more: { attack?: 'strike' | 'shot'; revive?: true } = {}) => ({ type, slot, ...more });

describe('an item\'s default icon', () => {
  test('is a weapon\'s attack: a bow for a shot, a sword for a strike or none', () => {
    expect(itemIcon(item('weapon', 'weapon', { attack: 'shot' }))).toBe('bow');
    expect(itemIcon(item('weapon', 'weapon', { attack: 'strike' }))).toBe('sword');
    expect(itemIcon(item('weapon', 'weapon'))).toBe('sword');
  });

  test('is armour\'s or an accessory\'s slot, and its type\'s when it has none', () => {
    const bySlot: Readonly<Record<Exclude<Slot, 'weapon'>, IconKey>> = {
      offhand: 'shield', head: 'helm', chest: 'chestplate', hands: 'gauntlet', legs: 'greaves', feet: 'boots', neck: 'amulet', ring1: 'ring', ring2: 'ring',
    };
    for (const [slot, icon] of Object.entries(bySlot)) {
      const type = slot === 'neck' || slot.startsWith('ring') ? 'accessory' : 'armor';
      expect(itemIcon(item(type, slot as Slot)), slot).toBe(icon);
    }
    expect(itemIcon(item('armor', null))).toBe('chestplate');
    expect(itemIcon(item('accessory', null))).toBe('ring');
  });

  test('is a potion for a consumable, a crystal for one that revives, ore, a key or a pouch for the rest', () => {
    expect(itemIcon(item('consumable', null))).toBe('potion');
    expect(itemIcon(item('consumable', null, { revive: true }))).toBe('crystal');
    expect(itemIcon(item('material', null))).toBe('ore');
    expect(itemIcon(item('key', null))).toBe('key');
    expect(itemIcon(item('misc', null))).toBe('pouch');
  });

  test('is the icon the GM picked when it has one', () => {
    expect(itemIcon({ ...item('weapon', 'weapon', { attack: 'shot' }), icon: 'axe' })).toBe('axe');
  });

  test('is an icon of the registry for every type, slot, attack and revive, and for every built-in item', () => {
    for (const type of ITEM_TYPES) for (const slot of [...SLOTS, null]) for (const attack of [...ATTACKS, undefined]) for (const revive of [true as const, undefined]) {
      expect(isIconKey(itemIcon({ type, slot, ...(attack ? { attack } : {}), ...(revive ? { revive } : {}) })), `${type} ${slot} ${attack} ${revive}`).toBe(true);
    }
    const built = builtInItems(RULES);
    for (const i of built) expect(isIconKey(itemIcon(i)), i.name).toBe(true);
    expect(itemIcon(built.find(i => i.name === 'Goblin Shortbow')!)).toBe('bow');
    const crystals = built.filter(i => i.type === 'consumable' && i.revive);
    expect(crystals.length).toBeGreaterThan(0);
    for (const c of crystals) expect(itemIcon(c), c.name).toBe('crystal');
  });
});

/** Each built-in status's own picture (design section 3: blood to plague, with the emblems flame, bolt and wing). */
const BUILT_IN_PICTURE: Readonly<Record<BuiltInStatus, IconKey>> = {
  bleeding: 'blood', burning: 'flame', poisoned: 'poison', paralyzed: 'bolt', stunned: 'dizzy', frightened: 'fear', blinded: 'blind',
  slowed: 'snail', hasted: 'wing', invisible: 'faded', prone: 'fallen', restrained: 'chain', stealth: 'hood', bloodlust: 'rage',
  regenerating: 'heal', plague: 'plague',
};
const num = (value: number): Formula => ({ kind: 'number', value });
const PLAIN: StatusDef = { label: 'Plain', desc: '', ops: [] };
/** One op of every kind, the sign of each signed one up, its damage physical. The typecheck asks for a new kind here. */
const SAMPLE: { readonly [K in OpKind]: Extract<Op, { readonly op: K }> } = {
  damage: { op: 'damage', type: 'physical', amount: num(3) }, heal: { op: 'heal', amount: num(3) }, mana: { op: 'mana', amount: num(3) },
  fatigue: { op: 'fatigue', amount: num(1) }, applyStatus: { op: 'applyStatus', key: statusKey('plain'), def: PLAIN, duration: null },
  cureStatus: { op: 'cureStatus', key: statusKey('plain') }, note: { op: 'note', text: 'A note' }, speed: { op: 'speed', pct: 20 },
  delay: { op: 'delay', ticks: tick(10) }, hold: { op: 'hold' }, root: { op: 'root' }, taunt: { op: 'taunt' }, threat: { op: 'threat', amount: 5 },
  shield: { op: 'shield', amount: num(5) }, channel: { op: 'channel', mode: 'protect' }, staggerRate: { op: 'staggerRate', pct: 10 },
  stat: { op: 'stat', key: 'str', amount: { kind: 'number', value: 4 } }, refund: { op: 'refund', pct: 50, chance: 25 }, aura: { op: 'aura', radius: 1, on: 'all' },
  spread: { op: 'spread', range: 1 }, sheet: { op: 'sheet', key: 'armor', amount: { kind: 'number', value: 2 } }, share: { op: 'share', on: 'dealt', pct: 10 },
  untargetable: { op: 'untargetable' }, invulnerable: { op: 'invulnerable' }, safeguard: { op: 'safeguard' },
  edge: { op: 'edge', side: 'attack', keep: 'better', tag: null, spend: false }, boost: { op: 'boost', side: 'attack', die: { kind: 'die', sides: 4 } },
  hidden: { op: 'hidden', level: 1, start: 'unseen', ends: { hurt: true, revealed: true, dealt: true } }, stayHidden: { op: 'stayHidden', on: 'hurt' }, alert: { op: 'alert' }, shove: { op: 'shove', dir: 'away', from: 'user', tiles: 1 },
  move: { op: 'move', key: 'harmful', take: 1, from: 'user', as: null }, hasten: { op: 'hasten', share: 0.5 }, extra: { op: 'extra' },
  guard: { op: 'guard', share: 0.5 }, negate: { op: 'negate' }, dispel: { op: 'dispel', which: 'first' }, reveal: { op: 'reveal' },
};
/** The design's picture for each sample: the kinds it names, and `status` for the rest. */
const OP_PICTURE: Readonly<Record<OpKind, IconKey>> = {
  damage: 'slash', heal: 'heal', mana: 'mana', fatigue: 'weary', speed: 'wing', stat: 'up', hold: 'dizzy', root: 'chain', shield: 'shield',
  hidden: 'hood', stayHidden: 'hood', spread: 'plague', cureStatus: 'cure', dispel: 'cure', taunt: 'taunt', threat: 'taunt', untargetable: 'ward',
  invulnerable: 'ward', safeguard: 'ward', delay: 'timer', refund: 'timer', shove: 'push', move: 'push', reveal: 'eye',
  applyStatus: 'status', note: 'status', channel: 'status', staggerRate: 'status', aura: 'status', sheet: 'status', share: 'status',
  edge: 'status', boost: 'status', alert: 'status', hasten: 'status', extra: 'status', guard: 'status', negate: 'status',
};

describe('a status\'s default icon', () => {
  test('of each built-in is its own picture', () => {
    expect(Object.keys(BUILT_IN_PICTURE).sort()).toEqual([...STATUS_KEYS].sort());
    for (const k of STATUS_KEYS) expect(statusIcon(k, BUILT_IN_STATUSES[k]), k).toBe(BUILT_IN_PICTURE[k]);
  });

  test('of a GM\'s status under a built-in\'s key is the built-in\'s picture, whatever its ops', () => {
    expect(statusIcon('stunned', { ...PLAIN, ops: [SAMPLE.heal] })).toBe('dizzy');
  });

  test('of a GM\'s status is its first op\'s picture, for every kind of op', () => {
    expect([...OP_KINDS].sort()).toEqual(Object.keys(SAMPLE).sort());
    for (const kind of OP_KINDS) {
      expect(opIcon(SAMPLE[kind]), kind).toBe(OP_PICTURE[kind]);
      expect(statusIcon('a-gm-status', { ...PLAIN, ops: [SAMPLE[kind], SAMPLE.heal] }), kind).toBe(OP_PICTURE[kind]);
    }
  });

  test('of a damage op is by its type, of a speed or stat op by the sign of its E value', () => {
    expect(opIcon({ op: 'damage', type: 'magical', amount: num(3) })).toBe('spark');
    expect(opIcon({ op: 'speed', pct: -20 })).toBe('snail');
    expect(opIcon({ op: 'speed', pct: [10, -20, -20, -20, -20, -20] })).toBe('wing');
    expect(opIcon({ op: 'stat', key: 'ctl', amount: { kind: 'number', value: -4 } })).toBe('down');
    expect(opIcon({ op: 'stat', key: 'ctl', amount: [{ kind: 'number', value: -8 }, { kind: 'number', value: -12 }, { kind: 'number', value: -16 }, { kind: 'number', value: -20 }, { kind: 'number', value: -24 }, { kind: 'number', value: -32 }] })).toBe('down');
    expect(opIcon({ op: 'stat', key: 'ctl', amount: { kind: 'number', value: 0 } })).toBe('up');
  });

  test('of a GM\'s status with no ops is a timer when it has an end, else the plain status', () => {
    expect(statusIcon('a-gm-status', { ...PLAIN, end: { ops: [SAMPLE.heal], cleanse: 'cancel' } })).toBe('timer');
    expect(statusIcon('a-gm-status', PLAIN)).toBe('status');
  });

  test('is the icon the GM picked when it has one, a built-in\'s key too', () => {
    expect(statusIcon('a-gm-status', { ...PLAIN, ops: [SAMPLE.heal], icon: 'raven' })).toBe('raven');
    expect(statusIcon('stunned', { ...BUILT_IN_STATUSES.stunned, icon: 'raven' })).toBe('raven');
  });

  test('of a key every object has is not a built-in\'s', () => {
    for (const key of ['constructor', 'toString', '__proto__']) expect(statusIcon(key, PLAIN), key).toBe('status');
  });
});

describe('an ability\'s icon', () => {
  const KIND_PICTURE: Readonly<Record<AbilityKind, IconKey>> = { strike: 'strike', shot: 'arrow', blast: 'burst', curse: 'hex', support: 'aid' };
  const potion = 'i-potion' as ItemId;
  const bag = (id: ItemId) => (id === potion ? item('consumable', null) : null);

  test('is its kind\'s picture', () => {
    for (const [kind, icon] of Object.entries(KIND_PICTURE)) expect(abilityIcon({ kind: kind as AbilityKind }, bag), kind).toBe(icon);
  });

  test('of a bag item\'s use is the item\'s icon, and its kind\'s when the bag no longer holds it', () => {
    expect(abilityIcon({ kind: 'support', item: potion }, bag)).toBe('potion');
    expect(abilityIcon({ kind: 'support', item: 'i-gone' as ItemId }, bag)).toBe('aid');
  });
});

describe('a fight row\'s icon (row-icon.ts), the one answer the map token, the card, the turn order and the fight doc draw', () => {
  const monster = (o: { icon?: IconKey; type?: string; archetype?: Archetype } = {}): Origin =>
    ({ kind: 'monster', name: 'Rat', rank: 'E', archetype: o.archetype ?? 'brute', monsterKind: 'normal', tweak: { hp: 1, stats: {} }, ...(o.type ? { type: o.type } : {}), ...(o.icon ? { icon: o.icon } : {}) });
  const build: Origin = { kind: 'hunter', build: { stats: baseStats(RULES.fight), level: 1, gear: kitGear('light', RULES), perks: {} } };
  /** Each row as the design and ruling 1 say it is drawn: [what it is, its kind, its origin, the sheet behind it, its picture]. */
  const TABLE: readonly (readonly [string, CombatantKind, Origin, { emblem: string } | null, IconKey | null])[] = [
    ['a monster its GM gave a raven', 'monster', monster({ icon: 'raven', type: 'Beast' }), null, 'raven'],
    ['a Beast', 'monster', monster({ type: 'Beast' }), null, 'wolf'],
    ['an Undead, its type typed in any case with spaces around', 'monster', monster({ type: '  undead ' }), null, 'skull'],
    ['a caster of a type the table lacks', 'monster', monster({ type: 'Swamp thing', archetype: 'caster' }), null, 'orb'],
    ['a skirmisher with no type', 'monster', monster({ archetype: 'skirmisher' }), null, 'dagger'],
    ['a shadow (its monster\'s archetype, no type)', 'shadow', monster({ archetype: 'brute' }), null, 'claw'],
    ['a summon its maker gave a picture', 'summon', monster({ icon: 'bat' }), null, 'bat'],
    ['a hunter with a crown', 'hunter', build, { emblem: 'crown' }, 'crown'],
    ['a hunter who picked no emblem: its initials show', 'hunter', build, { emblem: '' }, null],
    ['a hunter whose saved emblem this build lacks', 'hunter', build, { emblem: 'no-such-icon' }, null],
    ['a hunter whose sheet is not on this phone', 'hunter', build, null, null],
    ['a monster stood on a hunter\'s build (a test\'s row)', 'monster', build, null, null],
  ];
  for (const [what, kind, origin, hunter, icon] of TABLE) {
    test(`${what}: ${icon ?? 'none'}`, () => expect(rowIcon({ kind, origin }, hunter)).toBe(icon));
  }
});
