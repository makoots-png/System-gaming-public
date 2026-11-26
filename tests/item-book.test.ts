import { describe, expect, test } from 'bun:test';
import {
  ITEM_DEF_ID_MAX,
  builtInItemId,
  catalogOfItemDefId,
  customItemDefId,
  isBuiltInItemId,
  isCustomItemDefId,
  parseCatalogId,
  parseCatalogKey,
  parseDeviceId,
  parseItemDefId,
  saveId,
} from '../src/core/ids.ts';
import { EMPTY_ITEM_BOOK, RULES, rulesOf, withItems } from '../src/core/rules.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import {
  BUNDLE_ITEMS,
  BUILT_IN_ITEMS,
  BUILT_IN_ITEM_IDS,
  LOOT_ITEMS,
  RECIPE_ITEMS,
  SHOP_ITEMS,
  STARTER_GEAR,
  itemOf,
  parseItem,
  valueOf,
} from '../src/core/registry/items.ts';
import {
  builtInDefData,
  isShippedItemDef,
  itemDefDataOf,
  parseHeldItem,
  parseItemDef,
  parseItemGrant,
  resolveDef,
  resolveGrant,
  resolveItem,
  sameItemDef,
  unknownItem,
} from '../src/core/registry/item-book.ts';
import { opLines, statusKey } from '../src/core/combat/effect-ops.ts';
import type { StatusDef } from '../src/core/combat/effect-ops.ts';
import { grievousCutOf, withGrievousCut } from '../src/core/combat/grievous.ts';
import { parseOp } from '../src/core/combat/fight-parse.ts';
import { liveAbility, liveOp, liveStatusDef } from '../src/core/combat/live-status.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import type { RowHunter } from '../src/core/combat/rows.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';
import { detailOf } from '../src/core/detail.ts';
import { useItem } from '../src/core/hunter/use.ts';
import { newSave, starterHunter } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import { namedIn, rekeyed, item as walkItem } from '../src/core/status-refs.ts';
import {
  ADHOC_CHARM_DEF,
  CUSTOM_BLADE_DEF,
  CUSTOM_BLADE_ID,
  CUSTOM_FLASK_FOLLOW_DEF,
  CUSTOM_FLASK_FOLLOW_ID,
  CUSTOM_FLASK_PINNED_DEF,
  CUSTOM_FLASK_PINNED_ID,
  DAGGER_DEF_ID,
  FOREIGN_CHARM_DEF,
  FOREIGN_CHARM_ID,
  GM_CATALOG_ID,
  KEEPSAKE_DEF_ID,
  OTHER_CATALOG_ID,
  PUNCHLINE_DEF_ID,
  THORNMAIL_DEF_ID,
  grantAdhoc,
  grantRef,
  heldAdhoc,
  heldRef,
  itemIdN,
} from './fixtures/items.ts';

const GW = statusKey('grievous');
const gwDef = (pct: number): StatusDef => withGrievousCut(BUILT_IN_STATUSES.grievous, pct);

describe('CatalogId, CatalogKey, and ItemDefId parsers and predicates', () => {
  test('parses valid catalog and item def ids and refuses malformed or colliding shapes', () => {
    expect(parseCatalogId('cat-abc123')).toBe('cat-abc123' as never);
    expect(parseCatalogId('cat-0123456789abcdef012345')).toBe('cat-0123456789abcdef012345' as never);
    for (const bad of ['', 'cat-short', 'cat-UPPER123', 'd-abc123', 'cat-abc_123', 'cat-' + 'a'.repeat(25), 42, null]) {
      expect(parseCatalogId(bad), String(bad)).toBeNull();
    }

    expect(parseCatalogKey('k'.repeat(16))).toBe('k'.repeat(16) as never);
    expect(parseCatalogKey('ck_ABC-123_def-456')).toBe('ck_ABC-123_def-456' as never);
    for (const bad of ['', 'short', 'k'.repeat(81), 'bad space inside key!!', null]) {
      expect(parseCatalogKey(bad), String(bad)).toBeNull();
    }

    expect(parseItemDefId('b:thornmail')).toBe(THORNMAIL_DEF_ID);
    expect(parseItemDefId(CUSTOM_BLADE_ID)).toBe(CUSTOM_BLADE_ID);
    // Disjoint from ItemId forms (`i12`, `seed:thornmail`) and invalid prefixes
    for (const bad of ['', 'i12', 'seed:thornmail', 'b:', 'b:-bad', 'b:UPPER', 'c:cat-gm1234567890:1', 'c:badcat:abcd1234', 'x:foo', 'b:' + 'a'.repeat(41), 'c:cat-' + 'a'.repeat(24) + ':' + 'b'.repeat(40)]) {
      expect(parseItemDefId(bad), String(bad)).toBeNull();
    }
    expect(CUSTOM_BLADE_ID.length).toBeLessThanOrEqual(ITEM_DEF_ID_MAX);

    expect(isBuiltInItemId(THORNMAIL_DEF_ID)).toBe(true);
    expect(isCustomItemDefId(THORNMAIL_DEF_ID)).toBe(false);
    expect(catalogOfItemDefId(THORNMAIL_DEF_ID)).toBeNull();

    expect(isBuiltInItemId(CUSTOM_BLADE_ID)).toBe(false);
    expect(isCustomItemDefId(CUSTOM_BLADE_ID)).toBe(true);
    expect(catalogOfItemDefId(CUSTOM_BLADE_ID)).toBe(GM_CATALOG_ID);

    expect(() => builtInItemId('Bad Slug')).toThrow();
    expect(() => customItemDefId(GM_CATALOG_ID, 'x')).toThrow();
  });
});

describe('BUILT_IN_ITEMS registry and value: 0 preservation', () => {
  test('every built-in item across shop, loot, recipes, starter gear, and bundles has a unique valid b:* defId', () => {
    const all = [...SHOP_ITEMS, ...LOOT_ITEMS, ...Object.values(STARTER_GEAR), ...Object.values(BUNDLE_ITEMS)];
    expect(BUILT_IN_ITEMS.size).toBe(all.length);
    expect(BUILT_IN_ITEM_IDS.length).toBe(all.length);
    for (const d of all) {
      expect(parseItemDefId(d.defId), d.name).toBe(d.defId);
      expect(isBuiltInItemId(d.defId), d.name).toBe(true);
      expect(BUILT_IN_ITEMS.get(d.defId), d.name).toBe(d);
    }
    // Starter Mana Potion and ranked shop Mana Potion (E) have distinct stable ids
    expect(STARTER_GEAR.manaPotion.defId).not.toBe(SHOP_ITEMS.find(d => d.name === 'Mana Potion (E)')!.defId);
    expect(BUILT_IN_ITEMS.has(PUNCHLINE_DEF_ID)).toBe(true);
    expect(BUILT_IN_ITEMS.has(KEEPSAKE_DEF_ID)).toBe(true);
    expect(RECIPE_ITEMS.every(d => BUILT_IN_ITEMS.get(d.defId) === d)).toBe(true);
  });

  test('itemOf preserves explicit value: 0 on The Punchline and Keepsake', () => {
    const punchline = itemOf(RULES, BUNDLE_ITEMS.punchline);
    const keepsake = itemOf(RULES, BUNDLE_ITEMS.keepsake);
    expect(punchline.value).toBe(0);
    expect(valueOf(punchline, RULES)).toBe(0);
    expect(keepsake.value).toBe(0);
    expect(valueOf(keepsake, RULES)).toBe(0);
    expect(parseItem(JSON.parse(JSON.stringify(punchline)))).toEqual(punchline);
    expect(parseItem(JSON.parse(JSON.stringify(keepsake)))).toEqual(keepsake);
  });
});

describe('ItemDefData, HeldItem, and ItemGrant parsing & structural equality', () => {
  test('parseItemDef delegates to parseItem and strips qty', () => {
    const def = parseItemDef({ name: 'Test Blade', rar: 'rare', type: 'weapon', slot: 'weapon', dice: '1d8', attack: 'strike', qty: 5 });
    expect(def).not.toBeNull();
    expect('qty' in def!).toBe(false);
    expect(def!.name).toBe('Test Blade');
    expect(parseItemDef({ name: '' })).toBeNull();
    expect(parseItemDef(null)).toBeNull();
  });

  test('parseHeldItem and parseItemGrant validate ref and adhoc variants strictly', () => {
    const ref = heldRef(1, THORNMAIL_DEF_ID, 2);
    expect(parseHeldItem(JSON.parse(JSON.stringify(ref)))).toEqual(ref);
    const adhoc = heldAdhoc(2, ADHOC_CHARM_DEF, 3);
    expect(parseHeldItem(JSON.parse(JSON.stringify(adhoc)))).toEqual(adhoc);

    for (const bad of [
      null,
      { kind: 'ref', id: 'bad-id', defId: THORNMAIL_DEF_ID, qty: 1 },
      { kind: 'ref', id: 'i1', defId: 'not-a-def-id', qty: 1 },
      { kind: 'ref', id: 'i1', defId: THORNMAIL_DEF_ID, qty: 0 },
      { kind: 'ref', id: 'i1', defId: THORNMAIL_DEF_ID, qty: 1.5 },
      { kind: 'adhoc', id: 'i2', qty: 1, item: { name: '' } },
      { kind: 'other', id: 'i3', qty: 1 },
    ]) {
      expect(parseHeldItem(bad), JSON.stringify(bad)).toBeNull();
    }

    const gRef = grantRef(CUSTOM_BLADE_ID, 1, CUSTOM_BLADE_DEF);
    expect(parseItemGrant(JSON.parse(JSON.stringify(gRef)))).toEqual(gRef);
    const gRefBare = grantRef(DAGGER_DEF_ID, 4);
    expect(parseItemGrant(JSON.parse(JSON.stringify(gRefBare)))).toEqual(gRefBare);
    const gAdhoc = grantAdhoc(ADHOC_CHARM_DEF, 2);
    expect(parseItemGrant(JSON.parse(JSON.stringify(gAdhoc)))).toEqual(gAdhoc);

    // Malformed optional `def` on a ref grant is rejected rather than silently accepted
    expect(parseItemGrant({ kind: 'ref', defId: CUSTOM_BLADE_ID, qty: 1, def: { name: '' } })).toBeNull();
    expect(parseItemGrant({ kind: 'ref', defId: 'bad', qty: 1 })).toBeNull();
    expect(parseItemGrant({ kind: 'adhoc', qty: 0, item: ADHOC_CHARM_DEF })).toBeNull();
  });

  test('sameItemDef is key-order independent and isShippedItemDef detects no-op built-in overrides', () => {
    const shipped = builtInDefData(DAGGER_DEF_ID, RULES)!;
    const reordered = parseItemDef({
      desc: shipped.desc, attack: shipped.attack, dice: shipped.dice, finesse: shipped.finesse,
      slot: shipped.slot, type: shipped.type, grade: shipped.grade, rar: shipped.rar, name: shipped.name,
      armor: shipped.armor, resist: shipped.resist, bonus: {},
    })!;
    expect(sameItemDef(shipped, reordered)).toBe(true);
    expect(isShippedItemDef(DAGGER_DEF_ID, reordered, RULES)).toBe(true);
    expect(isShippedItemDef(DAGGER_DEF_ID, { ...shipped, dice: '2d6' }, RULES)).toBe(false);
    expect(isShippedItemDef(CUSTOM_BLADE_ID, CUSTOM_BLADE_DEF, RULES)).toBe(false);
  });
});

describe('ItemBook on Rules and resolveDef / resolveItem / resolveGrant', () => {
  test('EMPTY_ITEM_BOOK is frozen and rulesOf / withItems layer overrides without mutating RULES', () => {
    expect(Object.isFrozen(EMPTY_ITEM_BOOK)).toBe(true);
    expect(RULES.items).toEqual({});
    const editedDagger = { ...builtInDefData(DAGGER_DEF_ID, RULES)!, name: 'Honed Iron Dagger', dice: '1d10' };
    const R = rulesOf({}, {}, { [DAGGER_DEF_ID]: editedDagger, [CUSTOM_BLADE_ID]: CUSTOM_BLADE_DEF });
    expect(RULES.items).toEqual({});
    expect(R.items[DAGGER_DEF_ID]?.name).toBe('Honed Iron Dagger');
    expect(R.items[CUSTOM_BLADE_ID]?.name).toBe('Rift Fang');
    expect(withItems(R, {})).toBe(R);
  });

  test('resolveDef precedence: R.items > BUILT_IN_ITEMS > extraDefs (remote cannot spoof built-ins or active catalog items)', () => {
    const shippedDagger = builtInDefData(DAGGER_DEF_ID, RULES)!;
    const spoofedDagger = { ...shippedDagger, name: 'Spoofed Dagger', dice: '9d12' };
    const staleBlade = { ...CUSTOM_BLADE_DEF, name: 'Old Rift Fang', dice: '1d4' };

    // 1. Unedited built-in reads shipped def even if remote extraDefs tries to spoof b:iron-dagger
    expect(resolveDef(DAGGER_DEF_ID, RULES, { [DAGGER_DEF_ID]: spoofedDagger })?.name).toBe('Iron Dagger');

    // 2. Unedited built-in armor still reacts to armor kit rule overrides in R.fight.kits
    const Rheavy = rulesOf({ fight: { kits: { heavy: { armor: 100 } } } });
    expect(resolveDef(THORNMAIL_DEF_ID, Rheavy)!.armor).toBeGreaterThan(resolveDef(THORNMAIL_DEF_ID, RULES)!.armor);

    // 3. R.items override wins over both shipped built-in and stale remote extraDefs
    const R = rulesOf({}, {}, {
      [DAGGER_DEF_ID]: { ...shippedDagger, name: 'Guild Iron Dagger' },
      [CUSTOM_BLADE_ID]: CUSTOM_BLADE_DEF,
    });
    expect(resolveDef(DAGGER_DEF_ID, R, { [DAGGER_DEF_ID]: spoofedDagger })?.name).toBe('Guild Iron Dagger');
    expect(resolveDef(CUSTOM_BLADE_ID, R, { [CUSTOM_BLADE_ID]: staleBlade })?.name).toBe('Rift Fang');

    // 4. Custom def missing from R.items (foreign GM or deleted custom item) resolves from extraDefs
    expect(resolveDef(FOREIGN_CHARM_ID, R, { [FOREIGN_CHARM_ID]: FOREIGN_CHARM_DEF })?.name).toBe('Stranger\'s Coin');

    // 5. Missing everywhere resolves to null / unknownItem placeholder
    const missingId = customItemDefId(OTHER_CATALOG_ID, 'gone9999');
    expect(resolveDef(missingId, R)).toBeNull();
    expect(resolveItem(heldRef(9, missingId, 2), R)).toEqual(unknownItem(itemIdN(9), 2, missingId));
  });

  test('resolveItem and resolveGrant handle ref, adhoc, fallback def, and unknown cleanly', () => {
    const R = rulesOf({}, {}, { [CUSTOM_BLADE_ID]: CUSTOM_BLADE_DEF });
    const resolvedRef = resolveItem(heldRef(1, CUSTOM_BLADE_ID, 1), R);
    expect(resolvedRef).toMatchObject({ id: itemIdN(1), defId: CUSTOM_BLADE_ID, name: 'Rift Fang', qty: 1 });
    expect(resolvedRef.adhoc).toBeUndefined();
    expect(resolvedRef.unknown).toBeUndefined();

    const resolvedAdhoc = resolveItem(heldAdhoc(2, ADHOC_CHARM_DEF, 3), R);
    expect(resolvedAdhoc).toMatchObject({ id: itemIdN(2), adhoc: true, name: 'Lucky Pebble', qty: 3 });

    // Grant with inline fallback resolves even when receiver does not have FOREIGN_CHARM_ID in R.items
    const resolvedForeignGrant = resolveGrant(grantRef(FOREIGN_CHARM_ID, 2, FOREIGN_CHARM_DEF), R);
    expect(resolvedForeignGrant).toMatchObject({ defId: FOREIGN_CHARM_ID, name: 'Stranger\'s Coin', qty: 2 });

    // Grant whose defId IS in R.items prefers live R.items over stale inline grant.def
    const staleInline = { ...CUSTOM_BLADE_DEF, name: 'Stale Name' };
    expect(resolveGrant(grantRef(CUSTOM_BLADE_ID, 1, staleInline), R).name).toBe('Rift Fang');

    // Grant with missing defId and no inline def resolves to unknown placeholder
    const gone = customItemDefId(OTHER_CATALOG_ID, 'miss1234');
    expect(resolveGrant(grantRef(gone, 1), R).unknown).toBe(true);
    expect(resolveGrant(grantAdhoc(ADHOC_CHARM_DEF, 2), R)).toMatchObject({ adhoc: true, name: 'Lucky Pebble', qty: 2 });
  });
});

describe('follow: true live status resolution across items, skills, details, out-of-combat use, and combat rows', () => {
  test('parseOp preserves follow: true and omits it when absent or non-true; status-refs preserves follow across rekeying', () => {
    const rawFollow = { op: 'applyStatus', key: 'grievous', def: BUILT_IN_STATUSES.grievous, duration: tick(2 * RULES.fight.round), follow: true };
    const parsedFollow = parseOp(rawFollow, RULES);
    expect(parsedFollow?.op === 'applyStatus' ? parsedFollow.follow : null).toBe(true);

    const rawPinned = { op: 'applyStatus', key: 'grievous', def: gwDef(25), duration: tick(2 * RULES.fight.round) };
    const parsedPinned = parseOp(rawPinned, RULES);
    expect(parsedPinned?.op === 'applyStatus' ? parsedPinned.follow : 'bad').toBeUndefined();
    expect(parseOp({ ...rawPinned, follow: false }, RULES)).toEqual(parsedPinned);

    const tpl = { ...CUSTOM_FLASK_FOLLOW_DEF, qty: 1 };
    const keys = new Set<ReturnType<typeof statusKey>>();
    namedIn(walkItem, tpl, keys);
    expect(keys.has(GW)).toBe(true);
    const renamed = rekeyed(walkItem, tpl, new Map([['grievous', statusKey('grievous-2')]]));
    const op = renamed.effects?.[0];
    expect(op?.op === 'applyStatus' ? [op.key, op.follow] : null).toEqual([statusKey('grievous-2'), true]);
  });

  test('unedited Thornmail, edited Thornmail, and custom follow:true items all track GM Rules edits to Grievous Wounds, while pinned items stay fixed', () => {
    const R75 = rulesOf({}, { grievous: gwDef(75) }, {
      [CUSTOM_FLASK_FOLLOW_ID]: CUSTOM_FLASK_FOLLOW_DEF,
      [CUSTOM_FLASK_PINNED_ID]: CUSTOM_FLASK_PINNED_DEF,
    });

    // 1. Unedited Thornmail follows 75%
    const uneditedThorn = resolveItem(heldRef(1, THORNMAIL_DEF_ID, 1), R75);
    const uOp = uneditedThorn.worn?.triggers?.[0]?.ops[1];
    expect(uOp?.op === 'applyStatus' ? [uOp.follow, grievousCutOf(uOp.def)] : null).toEqual([true, 75]);

    // 2. Edited Thornmail (custom name + bonus in R.items, keeping follow: true) ALSO follows 75%
    const editedThornDef = { ...builtInDefData(THORNMAIL_DEF_ID, RULES)!, name: 'Spiked Thornmail', bonus: { vit: 2 } };
    const R75Edited = withItems(R75, { [THORNMAIL_DEF_ID]: editedThornDef });
    const editedThorn = resolveItem(heldRef(2, THORNMAIL_DEF_ID, 1), R75Edited);
    const eOp = editedThorn.worn?.triggers?.[0]?.ops[1];
    expect(editedThorn.name).toBe('Spiked Thornmail');
    expect(eOp?.op === 'applyStatus' ? [eOp.follow, grievousCutOf(eOp.def)] : null).toEqual([true, 75]);

    // 3. Custom follow:true flask follows 75%, while pinned 25% flask stays 25%
    const liveFlask = resolveItem(heldRef(3, CUSTOM_FLASK_FOLLOW_ID, 1), R75);
    const pinnedFlask = resolveItem(heldRef(4, CUSTOM_FLASK_PINNED_ID, 1), R75);
    expect(liveFlask.effects?.[0]?.op === 'applyStatus' ? grievousCutOf(liveFlask.effects[0].def) : null).toBe(75);
    expect(pinnedFlask.effects?.[0]?.op === 'applyStatus' ? grievousCutOf(pinnedFlask.effects[0].def) : null).toBe(25);
  });

  test('opLines, detailOf, useItem, and combat rows (skills, passive skills, worn items, monsters) honor follow: true', () => {
    const R80 = rulesOf({}, { grievous: gwDef(80) });
    const followOp = { op: 'applyStatus' as const, key: GW, def: gwDef(40), duration: tick(2 * RULES.fight.round), follow: true as const };
    const pinnedOp = { op: 'applyStatus' as const, key: GW, def: gwDef(25), duration: tick(2 * RULES.fight.round) };

    // opLines and detailOf show live 80% for follow:true even on a stale-def skill copy, and 25% for pinned
    expect(opLines([followOp], 0, R80)[0]).toContain('Healing received −80%');
    expect(opLines([pinnedOp], 0, R80)[0]).toContain('Healing received −25%');

    const followAbility = { ...abilityOf('curse', { id: abilityId('live-cut'), name: 'Live Cut' }, RULES), ops: [followOp] };
    const pinnedAbility = { ...abilityOf('curse', { id: abilityId('fixed-cut'), name: 'Fixed Cut' }, RULES), ops: [pinnedOp] };
    expect(detailOf({ kind: 'ability', ability: followAbility }, R80).lines.join('\n')).toContain('Healing received −80%');
    expect(detailOf({ kind: 'ability', ability: pinnedAbility }, R80).lines.join('\n')).toContain('Healing received −25%');

    // Out-of-combat useItem applies live 80% def when follow: true
    const dev = parseDeviceId('d-test1')!;
    const save = newSave(dev);
    const h0 = starterHunter(save, { now: new Date('2026-11-25T12:00:00.000Z'), newDeviceId: () => dev, newDeviceToken: () => 't'.repeat(32) });
    const { target: _other, ...selfDef } = CUSTOM_FLASK_FOLLOW_DEF;
    const selfFlask = { ...selfDef, id: itemIdN(50), qty: 1 };
    const hWith = { ...h0, items: [...h0.items, selfFlask] };
    const used = useItem(hWith, selfFlask.id, [[]], R80);
    expect(isRefused(used)).toBe(false);
    if (!isRefused(used)) {
      const cond = used.hunter.conditions.find(c => c.key === GW);
      expect(grievousCutOf(cond?.def)).toBe(80);
    }

    // Combat rows resolve follow: true on active skills, passive worn statuses, worn items, and monsters
    const staleThorn = { ...itemOf(RULES, RECIPE_ITEMS.find(d => d.defId === THORNMAIL_DEF_ID)!), id: itemIdN(60), qty: 1 };
    const passiveWorn: StatusDef = {
      label: 'Cursed Aura', desc: '', ops: [],
      triggers: [{ on: 'hitDealt', tag: null, to: 'other', limit: { kind: 'each' }, ops: [followOp] }],
    };
    const rh: RowHunter = {
      ...h0,
      items: [staleThorn],
      equipped: { chest: staleThorn.id },
      skills: [
        { type: 'active', ability: followAbility },
        { type: 'active', ability: pinnedAbility },
        { type: 'passive', bonus: {}, worn: passiveWorn },
      ],
    };
    const row = hunterRow(rh, combatantId('c1'), R80);
    const liveAb = row.abilities.find(a => a.id === followAbility.id)!;
    const pinAb = row.abilities.find(a => a.id === pinnedAbility.id)!;
    expect(liveAb.ops[0]?.op === 'applyStatus' ? grievousCutOf(liveAb.ops[0].def) : null).toBe(80);
    expect(pinAb.ops[0]?.op === 'applyStatus' ? grievousCutOf(pinAb.ops[0].def) : null).toBe(25);

    const thornWorn = row.statuses.find(s => s.def.label === 'Thornmail')!;
    const thornTrigOp = thornWorn.def.triggers?.[0]?.ops[1];
    expect(thornTrigOp?.op === 'applyStatus' ? grievousCutOf(thornTrigOp.def) : null).toBe(80);

    const passiveRowStatus = row.statuses.find(s => s.def.label === 'Cursed Aura')!;
    const passiveTrigOp = passiveRowStatus.def.triggers?.[0]?.ops[0];
    expect(passiveTrigOp?.op === 'applyStatus' ? grievousCutOf(passiveTrigOp.def) : null).toBe(80);

    // Monster ability with follow: true also resolves live
    const seed = seedMonsters(RULES)[0]!;
    const mRow = monsterRows({ ...seed, abilities: [followAbility] }, [combatantId('m1')], R80)[0]!;
    const mAb = mRow.abilities.find(a => a.id === followAbility.id)!;
    expect(mAb.ops[0]?.op === 'applyStatus' ? grievousCutOf(mAb.ops[0].def) : null).toBe(80);

    // Preserves identity when nothing changes (no unnecessary allocations)
    expect(liveOp(pinnedOp, R80.conditions)).toBe(pinnedOp);
    expect(liveStatusDef(BUILT_IN_STATUSES.burning, R80.conditions)).toBe(BUILT_IN_STATUSES.burning);
    expect(liveAbility(pinnedAbility, R80.conditions)).toBe(pinnedAbility);
    expect(itemDefDataOf({ ...CUSTOM_BLADE_DEF, qty: 1 })).toEqual(CUSTOM_BLADE_DEF);
  });
});
