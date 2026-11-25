import { describe, expect, test } from 'bun:test';
import { RULES, rulesOf } from '../src/core/rules.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import { RECIPE_ITEMS, itemOf, parseItem } from '../src/core/registry/items.ts';
import { parseSkill } from '../src/core/registry/skills.ts';
import { parsePowers } from '../src/core/registry/powers.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import { addSheetStatus, applyStatus, describeStatus, opLines, owedOf, settle, sheetStatuses, statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
import type { StatusDef } from '../src/core/combat/effect-ops.ts';
import { parseAbility, parseOp, parseStatusDef } from '../src/core/combat/fight-parse.ts';
import { healShare } from '../src/core/combat/standing.ts';
import { monsterRows, summonRow } from '../src/core/combat/rows.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Command, Ctx, Fight } from '../src/core/combat/fight.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { place } from '../src/core/combat/space.ts';
import { fightId } from '../src/core/ids.ts';
import { DOC_DEFS_MAX, fightWire } from '../src/core/combat/fight-doc.ts';
import type { DocStatus, FightDoc } from '../src/core/combat/fight-doc.ts';
import { DOCS, DOC_MAX, parseDeviceId, parseEvent } from '../src/core/protocol.ts';
import { roomRulesOf, withRoomRules } from '../src/core/hunter/build.ts';
import { rewardForm, rewardOfForm } from '../src/core/reward-rows.ts';
import { newRewards } from '../src/core/rewards.ts';
import { abilityWorth, defWorth } from '../src/core/registry/worth.ts';
import { itemSpend } from '../src/core/registry/item-budget.ts';
import { detailOf } from '../src/core/detail.ts';
import {
  DEFAULT_GRIEVOUS_PCT,
  clampGrievousCut,
  grievousCapPct,
  grievousCutAt,
  grievousCutOf,
  hasTieredGrievousCut,
  parseGrievousCut,
  withGrievousCut,
} from '../src/core/combat/grievous.ts';

const GW = statusKey('grievous');
const gwDef = (pct: number): StatusDef => withGrievousCut(BUILT_IN_STATUSES.grievous, pct);
const thornDef = RECIPE_ITEMS.find(d => d.name === 'Thornmail')!;

describe('variable Grievous Wounds helpers, bounds, and number-free prose', () => {
  test('built-in Grievous Wounds defaults to 40%, keeps number-free prose, and preserves tiered shares', () => {
    expect(grievousCutOf(BUILT_IN_STATUSES.grievous)).toBe(DEFAULT_GRIEVOUS_PCT);
    expect(BUILT_IN_STATUSES.grievous.desc).toBe('Receives less healing.');
    expect(grievousCapPct(RULES)).toBe(50);
    expect(grievousCapPct(rulesOf({ fight: { kit: { shareCap: 0.8 } } }))).toBe(80);
    expect(grievousCapPct(rulesOf({ fight: { kit: { shareCap: 0.455 } } }))).toBe(45);
    expect(grievousCapPct(rulesOf({ fight: { kit: { shareCap: 0.29 } } }))).toBe(29);
    expect(grievousCapPct(rulesOf({ fight: { kit: { shareCap: 0 } } }))).toBe(1);

    const at25 = withGrievousCut(BUILT_IN_STATUSES.grievous, 25);
    expect(grievousCutOf(at25)).toBe(25);
    expect(at25.ops).toEqual([{ op: 'share', on: 'healed', pct: -25 }]);
    expect(at25.desc).toBe('Receives less healing.');

    expect(clampGrievousCut(NaN)).toBeNull();
    expect(clampGrievousCut(Infinity)).toBeNull();
    expect(clampGrievousCut(0)).toBe(1);
    expect(clampGrievousCut(150)).toBe(100);
    expect(withGrievousCut(at25, NaN)).toBe(at25);

    const tiered: StatusDef = { label: 'Tiered Rot', desc: 'Gets worse.', ops: [{ op: 'share', on: 'healed', pct: [-10, -20, -30, -40, -50, -60] }] };
    expect(hasTieredGrievousCut(tiered)).toBe(true);
    expect(hasTieredGrievousCut(BUILT_IN_STATUSES.grievous)).toBe(false);
    expect(grievousCutAt(tiered, 2)).toBe(30);
    expect(withGrievousCut(tiered, 25)).toEqual(tiered);

    expect(parseGrievousCut(1)).toBe(1);
    expect(parseGrievousCut(100)).toBe(100);
    expect(parseGrievousCut(0)).toBeNull();
    expect(parseGrievousCut(101)).toBeNull();
    expect(parseGrievousCut(40.5)).toBeNull();
    expect(grievousCutAt(BUILT_IN_STATUSES.burning, 0)).toBeNull();
  });

  test('Thornmail prose stays number-free and itemOf builds Thornmail from R.conditions.grievous', () => {
    const defThorn = itemOf(RULES, thornDef);
    expect(defThorn.desc).toBe('Heavy chest armor. When a foe strikes you, it takes magic damage equal to 3% of your armor and gets Grievous Wounds for 2 rounds.');
    expect(defThorn.worn?.desc).toBe('Foes that strike you take magic damage and get Grievous Wounds.');

    const R25 = rulesOf({}, { grievous: gwDef(25) });
    const thorn25 = itemOf(R25, thornDef);
    const trig = thorn25.worn?.triggers?.[0]?.ops[1];
    expect(trig?.op === 'applyStatus' ? grievousCutOf(trig.def) : null).toBe(25);
    const thorn25Lines = detailOf({ kind: 'item', item: thorn25 }, R25).lines.join('\n');
    expect(thorn25Lines).toContain('In a fight: ');
    expect(thorn25Lines).toContain('Healing received −25%');
  });

  test('legacy saves with old Grievous Wounds desc ("Receives 40% less healing.") are repaired on parse, including old Thornmails', () => {
    const legacyDef = { label: 'Grievous Wounds', desc: 'Receives 40% less healing.', ops: [{ op: 'share', on: 'healed', pct: -40 }] };
    const repaired = parseStatusDef(legacyDef, RULES)!;
    expect(repaired.desc).toBe('Receives less healing.');
    expect(grievousCutOf(repaired)).toBe(40);

    // Other labels or custom descriptions are untouched
    const custom = parseStatusDef({ label: 'Rot', desc: 'Receives 40% less healing.', ops: [{ op: 'share', on: 'healed', pct: -40 }] }, RULES)!;
    expect(custom.desc).toBe('Receives 40% less healing.');

    // Old saved Thornmail carrying the legacy embedded Grievous Wounds desc repairs on parseItem and uses compact h on the wire
    const oldThornRaw = JSON.parse(JSON.stringify(itemOf(RULES, thornDef)));
    oldThornRaw.worn.triggers[0].ops[1].def.desc = 'Receives 40% less healing.';
    const parsedThorn = parseItem(oldThornRaw)!;
    const thornOp = parsedThorn.worn?.triggers?.[0]?.ops[1];
    expect(thornOp?.op === 'applyStatus' ? thornOp.def.desc : null).toBe('Receives less healing.');
    const repairedDef = thornOp?.op === 'applyStatus' ? thornOp.def : gwDef(40);

    const doc: FightDoc = {
      ended: false, active: true, by: parseDeviceId('d-gm')!, id: fightId('f-legacy'), at: '2026-11-25T12:00:00.000Z',
      now: tick(0), currentId: combatantId('c1'), ahead: [],
      grid: { w: 10, h: 10, tiles: null, lit: null }, zones: [], log: [], refused: null, ready: {},
      rows: [
        {
          id: combatantId('c1'), name: 'Kai', side: 'party', key: null, place: { x: 1, y: 1 }, at: tick(0), speed: 100, band: 'healthy',
          statuses: [{ key: GW, label: 'Grievous Wounds', left: 2, tier: 0, def: repairedDef }],
          shield: null, shieldLeft: null, channel: null, taunt: null, icon: null, life: { at: 'up' }, kind: 'hunter', hp: 100, hpMax: 100, stride: 1, move: 6,
        },
        {
          id: combatantId('c2'), name: 'Goblin', side: 'foe', key: null, place: { x: 2, y: 1 }, at: tick(10), speed: 100, band: 'healthy',
          statuses: [{ key: GW, label: 'Grievous Wounds', left: 2, tier: 0, def: gwDef(25) }],
          shield: null, shieldLeft: null, channel: null, taunt: null, icon: null, life: { at: 'up' }, kind: 'monster', intent: null, stagger: null, suggest: null,
        },
      ],
    };
    const wire = fightWire(doc) as { rows: { st: Record<string, unknown>[] }[] };
    expect(wire.rows[1]?.st[0]?.h).toBe(25);
    expect(wire.rows[1]?.st[0]?.b).toBeUndefined();
    const read = DOCS.fight(JSON.parse(JSON.stringify(wire)));
    expect(read && !read.ended ? read.rows.map(r => grievousCutOf(r.statuses[0]?.def)) : null).toEqual([40, 25]);
  });

  test('R.conditions readers (monster start status, summon status, reward row without def) follow library.statuses.grievous', () => {
    const R30 = rulesOf({}, { grievous: gwDef(30) });
    const seed = seedMonsters(R30)[0]!;
    const mRow = monsterRows({ ...seed, statuses: [{ key: 'grievous', rounds: 2 }] }, [combatantId('m1')], R30)[0]!;
    expect(grievousCutOf(mRow.statuses[0]?.def)).toBe(30);

    const sRow = summonRow(
      { id: combatantId('c1'), side: 'party', tier: 1 },
      { name: 'Wisp', archetype: 'caster', rounds: 2, statuses: [{ key: GW, rounds: 2 }] },
      combatantId('s1'),
      tick(0),
      R30,
    );
    expect(grievousCutOf(sRow.statuses[0]?.def)).toBe(30);

    const form = rewardForm(newRewards());
    form.rows.push({ kind: 'status', key: 'grievous', rounds: '2', def: null });
    const raw = rewardOfForm(form, R30);
    expect(grievousCutOf(raw.statuses[0]?.def)).toBe(30);
  });
});

describe('maker round-trips (status, skill/ability, item, keystone powers)', () => {
  test('variable Grievous Wounds round-trips through Status, Skill/Ability, Item, and Keystone power parsers', () => {
    const status70 = gwDef(70);
    expect(parseStatusDef(JSON.parse(JSON.stringify(status70)), RULES)).toEqual(status70);

    const ability = {
      ...abilityOf('curse', { id: abilityId('wither-cut'), name: 'Wither Cut' }, RULES),
      ops: [{ op: 'applyStatus' as const, key: GW, def: gwDef(65), duration: tick(2 * RULES.fight.round) }],
    };
    const parsedAbility = parseAbility(JSON.parse(JSON.stringify(ability)), RULES)!;
    expect(parsedAbility).toEqual(ability);
    expect(grievousCutOf(parsedAbility.ops[0]?.op === 'applyStatus' ? parsedAbility.ops[0].def : null)).toBe(65);

    const skill = parseSkill({ name: 'Wither Cut', type: 'active', ability })!;
    expect(skill.type === 'active' && skill.ability?.ops[0]?.op === 'applyStatus' ? grievousCutOf(skill.ability.ops[0].def) : null).toBe(65);

    const elixir = parseItem({
      name: 'Blight Vial', rar: 'rare', type: 'consumable', target: 'other',
      effects: [{ op: 'applyStatus', key: GW, def: gwDef(35), duration: tick(3 * RULES.fight.round) }],
    })!;
    expect(elixir.effects?.[0]?.op === 'applyStatus' ? grievousCutOf(elixir.effects[0].def) : null).toBe(35);

    const customThorn = parseItem({
      ...itemOf(RULES, thornDef),
      worn: {
        ...itemOf(RULES, thornDef).worn!,
        triggers: [{
          on: 'struck', tag: null, to: 'other', limit: { kind: 'each' },
          ops: [{ op: 'applyStatus', key: GW, def: gwDef(25), duration: tick(2 * RULES.fight.round) }],
        }],
      },
    })!;
    const triggerGw = customThorn.worn?.triggers?.[0]?.ops[0];
    expect(triggerGw?.op === 'applyStatus' ? grievousCutOf(triggerGw.def) : null).toBe(25);

    const keystonePowers = parsePowers({
      worn: {
        label: 'Reaper Mark', desc: 'Hits inflict a healing cut.', ops: [],
        triggers: [{
          on: 'hitDealt', tag: null, to: 'other', limit: { kind: 'each' },
          ops: [{ op: 'applyStatus', key: GW, def: gwDef(45), duration: tick(2 * RULES.fight.round) }],
        }],
      },
    })!;
    const ksOp = keystonePowers.worn?.triggers?.[0]?.ops[0];
    expect(ksOp?.op === 'applyStatus' ? grievousCutOf(ksOp.def) : null).toBe(45);

    const standaloneOp = parseOp({ op: 'applyStatus', key: GW, def: gwDef(35), duration: tick(RULES.fight.round) }, RULES)!;
    expect(standaloneOp.op === 'applyStatus' ? grievousCutOf(standaloneOp.def) : null).toBe(35);
  });
});

describe('room sync, wire letter h, and DOC_MAX', () => {
  test('fightWire emits compact h (not g) and DOCS.fight reconstructs differing Grievous Wounds cuts within DOC_MAX', () => {
    const makeDoc = (cut1: number, cut2: number): FightDoc => ({
      ended: false, active: true, by: parseDeviceId('d-gm')!, id: fightId('f1'), at: '2026-11-25T12:00:00.000Z',
      now: tick(0), currentId: combatantId('c1'), ahead: [],
      grid: { w: 10, h: 10, tiles: null, lit: null }, zones: [], log: [], refused: null, ready: {},
      rows: [
        {
          id: combatantId('c1'), name: 'Kai', side: 'party', key: null, place: { x: 1, y: 1 }, at: tick(0), speed: 100, band: 'healthy',
          statuses: [{ key: GW, label: 'Grievous Wounds', left: 2, tier: 0, def: gwDef(cut1) }],
          shield: null, shieldLeft: null, channel: null, taunt: null, icon: null, life: { at: 'up' }, kind: 'hunter', hp: 100, hpMax: 100, stride: 1, move: 6,
        },
        {
          id: combatantId('c2'), name: 'Goblin', side: 'foe', key: null, place: { x: 2, y: 1 }, at: tick(10), speed: 100, band: 'healthy',
          statuses: [{ key: GW, label: 'Grievous Wounds', left: 2, tier: 0, def: gwDef(cut2) }],
          shield: null, shieldLeft: null, channel: null, taunt: null, icon: null, life: { at: 'up' }, kind: 'monster', intent: null, stagger: null, suggest: null,
        },
      ],
    });

    for (const [c1, c2] of [[40, 25], [70, 25]] as const) {
      const wire = fightWire(makeDoc(c1, c2)) as { rows: { st: Record<string, unknown>[] }[] };
      expect(wire.rows[1]?.st[0]?.h).toBe(c2);
      expect(wire.rows[1]?.st[0]?.g).toBeUndefined();
      expect(wire.rows[1]?.st[0]?.b).toBeUndefined();
      expect(JSON.stringify(wire).length).toBeLessThan(DOC_MAX);
      const read = DOCS.fight(JSON.parse(JSON.stringify(wire)));
      expect(read && !read.ended ? read.rows.map(r => grievousCutOf(r.statuses[0]?.def)) : null).toEqual([c1, c2]);
      expect(read && !read.ended ? read.rows.map(r => r.statuses[0]?.def?.desc) : null).toEqual(['Receives less healing.', 'Receives less healing.']);
    }
  });

  test('RoomRules.statuses carries GM Grievous Wounds edits to players and new Thornmails follow it', () => {
    const gmRules = rulesOf({}, { grievous: gwDef(25) });
    const wire = JSON.parse(JSON.stringify(roomRulesOf(gmRules)));
    const parsed = DOCS.rules(wire)!;
    expect(parsed).not.toBeNull();
    expect(grievousCutOf(parsed.statuses.grievous)).toBe(25);

    const playerRules = withRoomRules(RULES, parsed);
    expect(grievousCutOf(playerRules.conditions.grievous)).toBe(25);
    const playerThorn = itemOf(playerRules, thornDef);
    const trigOp = playerThorn.worn?.triggers?.[0]?.ops[1];
    expect(trigOp?.op === 'applyStatus' ? grievousCutOf(trigOp.def) : null).toBe(25);

    // Status and award room events carry variable-cut grievous defs intact
    const stEv = parseEvent('status', { eid: 'd-gm-s1', to: ['d-p1:h1'], add: [{ key: 'grievous', def: gwDef(35), source: { id: null, tier: 1 }, rounds: 2 }] });
    expect(stEv?.type === 'status' && stEv.payload.add ? grievousCutOf(stEv.payload.add[0]?.def) : null).toBe(35);
    const awEv = parseEvent('award', { eid: 'd-gm-a1', to: ['d-p1:h1'], rewards: { items: [playerThorn] } });
    const awOp = awEv?.type === 'award' ? awEv.payload.rewards.items[0]?.worn?.triggers?.[0]?.ops[1] : null;
    expect(awOp?.op === 'applyStatus' ? grievousCutOf(awOp.def) : null).toBe(25);
  });

  test('RoomRules carries fight.kit.shareCap so player cards match GM combat cap (and older docs default cleanly)', () => {
    const gmRules = rulesOf({ fight: { kit: { shareCap: 0.8 } } }, { grievous: gwDef(70) });
    const wire = JSON.parse(JSON.stringify(roomRulesOf(gmRules)));
    const parsed = DOCS.rules(wire)!;
    expect(parsed.shareCap).toBe(0.8);

    const playerRules = withRoomRules(RULES, parsed);
    expect(playerRules.fight.kit.shareCap).toBe(0.8);
    expect(playerRules.fight.kit.stackCap).toBe(RULES.fight.kit.stackCap);
    const card = detailOf({ kind: 'status', label: 'Grievous Wounds', def: gwDef(70), tier: 0, left: 2 }, playerRules);
    expect(card.lines).toContain('Healing received −70%');

    // Older room doc without shareCap defaults to shipped shareCap (0.5)
    const { shareCap: _omitted, ...older } = wire;
    expect(DOCS.rules(older)!.shareCap).toBe(RULES.fight.kit.shareCap);

    // Invalid shareCap refuses the rules doc
    expect(DOCS.rules({ ...wire, shareCap: '0.8' })).toBeNull();
  });

  test('fightWire falls back to b when h does not apply, and DOCS.fight refuses malformed or invalid h', () => {
    const baseFight = (st1: readonly DocStatus[], st2: readonly DocStatus[]): FightDoc => ({
      ended: false, active: true, by: parseDeviceId('d-gm')!, id: fightId('f-fb'), at: '2026-11-25T12:00:00.000Z',
      now: tick(0), currentId: combatantId('c1'), ahead: [],
      grid: { w: 10, h: 10, tiles: null, lit: null }, zones: [], log: [], refused: null, ready: {},
      rows: [
        {
          id: combatantId('c1'), name: 'Kai', side: 'party', key: null, place: { x: 1, y: 1 }, at: tick(0), speed: 100, band: 'healthy',
          statuses: st1, shield: null, shieldLeft: null, channel: null, taunt: null, icon: null, life: { at: 'up' }, kind: 'hunter', hp: 100, hpMax: 100, stride: 1, move: 6,
        },
        {
          id: combatantId('c2'), name: 'Goblin', side: 'foe', key: null, place: { x: 2, y: 1 }, at: tick(10), speed: 100, band: 'healthy',
          statuses: st2, shield: null, shieldLeft: null, channel: null, taunt: null, icon: null, life: { at: 'up' }, kind: 'monster', intent: null, stagger: null, suggest: null,
        },
      ],
    });

    // 1. Different desc, fractional cut, and tiered cut each fall back to b (no h)
    const customDescDef: StatusDef = { ...gwDef(25), desc: 'Custom prose.' };
    const fracDef: StatusDef = { ...BUILT_IN_STATUSES.grievous, ops: [{ op: 'share', on: 'healed', pct: -12.5 }] };
    const tieredDef: StatusDef = { ...BUILT_IN_STATUSES.grievous, ops: [{ op: 'share', on: 'healed', pct: [-10, -20, -30, -40, -50, -60] }] };
    for (const other of [customDescDef, fracDef, tieredDef]) {
      const wire = fightWire(baseFight(
        [{ key: GW, label: 'Grievous Wounds', left: 2, tier: 0, def: gwDef(40) }],
        [{ key: GW, label: 'Grievous Wounds', left: 2, tier: 0, def: other }],
      )) as { rows: { st: Record<string, unknown>[] }[] };
      expect(wire.rows[1]?.st[0]?.h).toBeUndefined();
      expect(wire.rows[1]?.st[0]?.b).toBe('Grievous Wounds');
    }

    // 2. A def that does not fit in wire.defs falls back to b
    const bigOps = Array.from({ length: 8 }, () => ({ op: 'note' as const, text: 'x'.repeat(180) }));
    const fillers: DocStatus[] = [];
    let used = 2;
    for (let i = 0; i < 12; i++) {
      const key = statusKey(`pad-${i}`);
      const def: StatusDef = { label: `Pad ${i}`, desc: 'y'.repeat(400), ops: bigOps };
      const size = JSON.stringify(key).length + JSON.stringify(def).length + 2;
      if (used + size <= DOC_DEFS_MAX) {
        fillers.push({ key, label: def.label, left: 2, tier: 0, def });
        used += size;
      } else {
        // Pack the remainder tightly so gwDef(25) (~110 chars) cannot fit either
        while (DOC_DEFS_MAX - used > 80) {
          const tk = statusKey(`top-${fillers.length}`);
          const baseDef: StatusDef = { label: 'Top', desc: '', ops: [] };
          const baseCost = JSON.stringify(tk).length + JSON.stringify(baseDef).length + 2;
          const padLen = Math.min(480, Math.max(0, DOC_DEFS_MAX - used - baseCost - 10));
          const topDef: StatusDef = { label: 'Top', desc: 'z'.repeat(padLen), ops: [] };
          fillers.push({ key: tk, label: 'Top', left: 2, tier: 0, def: topDef });
          used += JSON.stringify(tk).length + JSON.stringify(topDef).length + 2;
        }
        break;
      }
    }
    const fullWire = fightWire(baseFight(
      fillers,
      [{ key: GW, label: 'Grievous Wounds', left: 2, tier: 0, def: gwDef(25) }],
    )) as { defs?: Record<string, unknown>; rows: { st: Record<string, unknown>[] }[] };
    expect(fullWire.defs?.grievous).toBeUndefined();
    expect(fullWire.rows[1]?.st[0]?.b).toBe('Grievous Wounds');
    expect(fullWire.rows[1]?.st[0]?.h).toBeUndefined();
    const readFull = DOCS.fight(JSON.parse(JSON.stringify(fullWire)));
    expect(readFull && !readFull.ended ? readFull.rows[1]?.statuses[0]?.def : 'bad').toBeUndefined();

    // 3. DOCS.fight refuses (drops via listOf) bad h values (0, 101, string, fractional), h alongside b, and h on non-flat-cut base defs
    const validWire = fightWire(baseFight(
      [{ key: GW, label: 'Grievous Wounds', left: 2, tier: 0, def: gwDef(40) }],
      [{ key: GW, label: 'Grievous Wounds', left: 2, tier: 0, def: gwDef(25) }],
    )) as { defs: Record<string, unknown>; rows: { st: Record<string, unknown>[] }[] };
    for (const badH of [0, 101, '40', 25.5, -10]) {
      const w = JSON.parse(JSON.stringify(validWire));
      w.rows[1].st[0].h = badH;
      const r = DOCS.fight(w);
      expect(r && !r.ended ? r.rows[1]?.statuses : null, `bad h ${JSON.stringify(badH)}`).toEqual([]);
    }
    const bothHB = JSON.parse(JSON.stringify(validWire));
    bothHB.rows[1].st[0] = { k: 'grievous', b: 'Grievous Wounds', h: 25, l: 2 };
    const rBoth = DOCS.fight(bothHB);
    expect(rBoth && !rBoth.ended ? rBoth.rows[1]?.statuses : null, 'h alongside b').toEqual([]);

    const burnWire = fightWire(baseFight(
      [{ key: statusKey('burning'), label: 'Burning', left: 2, tier: 0, def: BUILT_IN_STATUSES.burning }],
      [],
    )) as { defs: Record<string, unknown>; rows: { st: Record<string, unknown>[] }[] };
    const badBurn = JSON.parse(JSON.stringify(burnWire));
    badBurn.rows[0].st[0].h = 25;
    const rBurn = DOCS.fight(badBurn);
    expect(rBurn && !rBurn.ended ? rBurn.rows[0]?.statuses : null, 'h on non-healing-cut def').toEqual([]);

    const tieredWire = fightWire(baseFight(
      [{ key: GW, label: 'Grievous Wounds', left: 2, tier: 0, def: tieredDef }],
      [],
    )) as { defs: Record<string, unknown>; rows: { st: Record<string, unknown>[] }[] };
    const badTiered = JSON.parse(JSON.stringify(tieredWire));
    badTiered.rows[0].st[0].h = 25;
    const rTiered = DOCS.fight(badTiered);
    expect(rTiered && !rTiered.ended ? rTiered.rows[0]?.statuses : null, 'h on tiered healing-cut def').toEqual([]);
  });
});

describe('strongest-wins rule, stacking guard, equal-cut owed tie-break, and lifecycle', () => {
  const mkStatus = (key: string, cut: number, tier: number, untilRounds: number, extra: Partial<StatusDef> = {}) =>
    statusOn({ ...gwDef(cut), ...extra }, { key: statusKey(key), source: { id: combatantId(`c${tier}`), tier }, since: tick(0), settledAt: tick(0), until: tick(untilRounds * RULES.fight.round) }, 1);

  test('same key: stronger active cut wins regardless of tier, keeping the later end (long weak extends short strong)', () => {
    const strongThenWeak = applyStatus(applyStatus([], mkStatus('grievous', 50, 0, 1)), mkStatus('grievous', 20, 3, 4));
    expect(grievousCutOf(strongThenWeak[0]?.def)).toBe(50);
    expect(strongThenWeak[0]?.until).toBe(tick(4 * RULES.fight.round));

    const weakThenStrong = applyStatus(applyStatus([], mkStatus('grievous', 20, 3, 4)), mkStatus('grievous', 50, 0, 1));
    expect(grievousCutOf(weakThenStrong[0]?.def)).toBe(50);
    expect(weakThenStrong[0]?.until).toBe(tick(4 * RULES.fight.round));
  });

  test('same key: until-removed weak cut does not make a short strong cut permanent, and a no-cut higher-tier variant cannot replace an active cut', () => {
    const mkPerm = (cut: number, tier: number) =>
      statusOn(gwDef(cut), { key: GW, source: { id: combatantId(`p${tier}`), tier }, since: tick(0), settledAt: tick(0), until: null }, 1);
    const shortStrong = mkStatus('grievous', 50, 0, 1);
    const permWeak = mkPerm(20, 3);
    const permStrong = mkPerm(50, 0);
    const shortWeak = mkStatus('grievous', 20, 3, 1);

    // Weak until-removed + strong 1-round (either order) keeps strong with its 1-round end
    const a = applyStatus(applyStatus([], permWeak), shortStrong);
    expect([grievousCutOf(a[0]?.def), a[0]?.until]).toEqual([50, tick(RULES.fight.round)]);
    const b = applyStatus(applyStatus([], shortStrong), permWeak);
    expect([grievousCutOf(b[0]?.def), b[0]?.until]).toEqual([50, tick(RULES.fight.round)]);

    // Strong until-removed + weak 1-round (either order) keeps strong until removed
    const c = applyStatus(applyStatus([], permStrong), shortWeak);
    expect([grievousCutOf(c[0]?.def), c[0]?.until]).toEqual([50, null]);
    const d = applyStatus(applyStatus([], shortWeak), permStrong);
    expect([grievousCutOf(d[0]?.def), d[0]?.until]).toEqual([50, null]);

    // Same on sheet statuses (rounds: null)
    const sh = addSheetStatus(
      addSheetStatus([], { key: GW, def: gwDef(20), source: { id: null, tier: 3 }, rounds: null }),
      { key: GW, def: gwDef(50), source: { id: null, tier: 0 }, rounds: 1 },
    );
    expect([grievousCutOf(sh[0]?.def), sh[0]?.rounds]).toEqual([50, 1]);

    // Higher-tier variant with no healing cut (null counts as 0) cannot replace an active 50% cut
    const noCutHighTier = statusOn(
      { label: 'Grievous Wounds', desc: 'No healing cut.', ops: [] },
      { key: GW, source: { id: combatantId('c4'), tier: 4 }, since: tick(0), settledAt: tick(0), until: tick(3 * RULES.fight.round) },
      1,
    );
    const kept = applyStatus([mkStatus('grievous', 50, 0, 2)], noCutHighTier);
    expect(grievousCutOf(kept[0]?.def)).toBe(50);
    expect(kept[0]?.source.tier).toBe(0);
  });

  test('same key: expired owed yields to a different active cut, while equal-cut owed keeps the tier rule', () => {
    const owedStrong = owedOf(mkStatus('grievous', 50, 3, 0) as never);
    const diffActive = applyStatus([owedStrong], mkStatus('grievous', 25, 0, 2));
    expect(grievousCutOf(diffActive[0]?.def)).toBe(25);
    expect(diffActive[0]?.source.tier).toBe(0);

    const owedSame = owedOf(mkStatus('grievous', 40, 3, 0) as never);
    const sameActive = applyStatus([owedSame], mkStatus('grievous', 40, 0, 2));
    expect(grievousCutOf(sameActive[0]?.def)).toBe(40);
    expect(sameActive[0]?.source.tier).toBe(3);
  });

  test('stacking healing-cut statuses skip the cut branch and follow the tier rule', () => {
    const stack = { cap: 5, leave: { kind: 'round' as const }, keep: 'fight' as const, threshold: null };
    const lowTierStrong = mkStatus('rot', 30, 0, 2, { label: 'Rot', stack });
    const highTierWeak = mkStatus('rot', 10, 3, 2, { label: 'Rot', stack });
    const merged = applyStatus(applyStatus([], lowTierStrong), highTierWeak);
    expect(grievousCutOf(merged[0]?.def)).toBe(10);
    expect(merged[0]?.source.tier).toBe(3);
  });

  test('sheet round-trip (sheetStatuses + addSheetStatus), settle, and owed preserve custom cut', () => {
    const s25 = mkStatus('grievous', 25, 0, 2);
    const settled = settle([s25], tick(RULES.fight.round), RULES);
    expect(grievousCutOf(settled.statuses[0]?.def)).toBe(25);
    const asOwed = owedOf(s25 as never);
    expect(grievousCutOf(asOwed.def)).toBe(25);

    const back = sheetStatuses([s25], tick(0), RULES);
    expect(grievousCutOf(back[0]?.def)).toBe(25);
    const merged = addSheetStatus(
      addSheetStatus([], { key: GW, def: gwDef(50), source: { id: null, tier: 0 }, rounds: 2 }),
      { key: GW, def: gwDef(20), source: { id: null, tier: 4 }, rounds: 3 },
    );
    expect(grievousCutOf(merged[0]?.def)).toBe(50);
    expect(merged[0]?.rounds).toBe(3);
  });

  test('combat lifecycle: custom cut survives move, echo, and spread in a real fight', () => {
    const ctx: Ctx = { rules: RULES };
    const seed = seedMonsters(RULES)[0]!;
    const a = combatantId('a'), b = combatantId('b'), c = combatantId('c'), d = combatantId('d');
    const [mA, mB, mC, mD] = monsterRows(seed, [a, b, c, d], RULES);
    const moveAb = {
      ...abilityOf('curse', { id: abilityId('ab-shift-gw'), name: 'Shift Cut', delivery: { kind: 'sure' } }, RULES),
      effect: null,
      ops: [{ op: 'move' as const, key: GW, take: 1 as const, from: 'user' as const, as: null }],
    };
    const echoDef: StatusDef = {
      label: 'Echoer', desc: '', ops: [],
      triggers: [{ on: 'statusGained', key: GW, to: 'self', limit: { kind: 'each' }, ops: [{ op: 'echo', radius: 2 }] }],
    };
    const putSpreadAb = {
      ...abilityOf('curse', { id: abilityId('ab-put-gw'), name: 'Spread Cut', delivery: { kind: 'sure' } }, RULES),
      effect: null,
      ops: [{ op: 'applyStatus' as const, key: GW, def: { ...gwDef(25), ops: [...gwDef(25).ops, { op: 'spread' as const, range: 4 }] }, duration: tick(3 * RULES.fight.round) }],
    };
    const run = (f: Fight | null, cmd: Command): Fight => reduce(f, cmd, ctx).fight!;

    // 1. Move preserves custom 25% cut from user -> target
    let fMove: Fight | null = null;
    fMove = run(fMove, {
      type: 'add', fightId: fightId('f-move'), openings: [],
      rows: [
        { ...mA!, side: 'party', place: place(1, 1), abilities: [moveAb], statuses: [mkStatus('grievous', 25, 0, 3)] },
        { ...mB!, side: 'foe', place: place(2, 1), statuses: [] },
      ],
    });
    fMove = run(fMove, { type: 'start', openings: [{ id: a, d20: 20, tie: 0 }, { id: b, d20: 10, tie: 0 }] });
    fMove = run(fMove, { type: 'act', by: a, ability: moveAb.id, aim: b, rolls: { dice: {}, react: {} } });
    expect(grievousCutOf(fMove.rows.find(r => r.id === b)!.statuses.find(s => s.key === GW)?.def)).toBe(25);

    // 2. Echo copies custom 25% cut onto nearest ally c; spread puts pending spread at 25% and lands 25% on d
    let fEcho: Fight | null = null;
    fEcho = run(fEcho, {
      type: 'add', fightId: fightId('f-echo'), openings: [],
      rows: [
        { ...mA!, side: 'party', place: place(1, 1), abilities: [putSpreadAb], statuses: [] },
        { ...mB!, side: 'foe', place: place(2, 1), statuses: [statusOn(echoDef, { key: statusKey('echoer'), source: { id: b, tier: 0 }, since: tick(0), settledAt: tick(0), until: null }, 1)] },
        { ...mC!, side: 'foe', place: place(3, 1), statuses: [] },
        { ...mD!, side: 'foe', place: place(5, 1), statuses: [] },
      ],
    });
    fEcho = run(fEcho, { type: 'start', openings: [{ id: a, d20: 20, tie: 0 }, { id: b, d20: 15, tie: 0 }, { id: c, d20: 10, tie: 0 }, { id: d, d20: 5, tie: 0 }] });
    fEcho = run(fEcho, { type: 'act', by: a, ability: putSpreadAb.id, aim: b, rolls: { dice: {}, react: {} } });
    expect(grievousCutOf(fEcho.rows.find(r => r.id === b)!.statuses.find(s => s.key === GW)?.def)).toBe(25);
    expect(grievousCutOf(fEcho.rows.find(r => r.id === c)!.statuses.find(s => s.key === GW)?.def)).toBe(25);
    // Advance turns until b settles a full round and queues a spread pass, then resolve it so d catches 25%
    for (let guard = 0; guard < 20 && fEcho.phase === 'running' && !fEcho.pending.some(p => 'spread' in p); guard++) {
      fEcho = run(fEcho, { type: 'endTurn', by: fEcho.currentId });
    }
    const sp = fEcho.phase === 'running' ? fEcho.pending.find(p => 'spread' in p) : undefined;
    expect(sp).toBeDefined();
    expect(sp && 'spread' in sp ? grievousCutOf(sp.spread.def) : null).toBe(25);
    if (sp && 'spread' in sp) {
      fEcho = run(fEcho, { type: 'settle', id: sp.id, key: sp.spread.key, dice: sp.spread.targets.map(() => 1) });
    }
    expect(grievousCutOf(fEcho.rows.find(r => r.id === d)!.statuses.find(s => s.key === GW)?.def)).toBe(25);
  });

  test('distinct status keys: healShare applies only the strongest cut (never stacked), capped by kit.shareCap', () => {
    const two = [mkStatus('grievous', 25, 0, 2), mkStatus('blight', 45, 0, 2)];
    expect(healShare({ statuses: two }, RULES)).toBeCloseTo(0.55, 9);

    const capped = [mkStatus('grievous', 70, 0, 2), mkStatus('blight', 40, 0, 2)];
    expect(healShare({ statuses: capped }, RULES)).toBeCloseTo(1 - RULES.fight.kit.shareCap, 9);

    const R80 = rulesOf({ fight: { kit: { shareCap: 0.8 } } });
    expect(healShare({ statuses: capped }, R80)).toBeCloseTo(0.3, 9);
  });
});

describe('pricing scales with healing-cut amount through antiHealWorth (capped by shareCap)', () => {
  test('status, ability, and Thornmail worth scale linearly with cut up to kit.shareCap', () => {
    const w20 = defWorth(gwDef(20), RULES).worth;
    const w40 = defWorth(gwDef(40), RULES).worth;
    const w50 = defWorth(gwDef(50), RULES).worth;
    const w70 = defWorth(gwDef(70), RULES).worth;
    expect(w40).toBeCloseTo(w20 * 2, 9);
    expect(w50).toBeGreaterThan(w40);
    expect(w70).toBeCloseTo(w50, 9);

    const R80 = rulesOf({ fight: { kit: { shareCap: 0.8 } } });
    expect(defWorth(gwDef(70), R80).worth).toBeGreaterThan(defWorth(gwDef(50), R80).worth);
    expect(defWorth(gwDef(90), R80).worth).toBeCloseTo(defWorth(gwDef(80), R80).worth, 9);

    const mkAb = (pct: number) => ({
      ...abilityOf('curse', { id: abilityId(`gw-${pct}`), name: `Cut ${pct}` }, RULES),
      ops: [{ op: 'applyStatus' as const, key: GW, def: gwDef(pct), duration: tick(2 * RULES.fight.round) }],
    });
    expect(abilityWorth(mkAb(40), RULES)!.worth).toBeGreaterThan(abilityWorth(mkAb(20), RULES)!.worth);
    expect(abilityWorth(mkAb(50), RULES)!.worth).toBeGreaterThan(abilityWorth(mkAb(40), RULES)!.worth);
    expect(abilityWorth(mkAb(70), RULES)!.worth).toBeCloseTo(abilityWorth(mkAb(50), RULES)!.worth, 9);

    const thorn20 = itemOf(rulesOf({}, { grievous: gwDef(20) }), thornDef);
    const thorn40 = itemOf(RULES, thornDef);
    const thorn50 = itemOf(rulesOf({}, { grievous: gwDef(50) }), thornDef);
    const thorn70 = itemOf(rulesOf({}, { grievous: gwDef(70) }), thornDef);
    expect(itemSpend(thorn40, RULES)!.points).toBeGreaterThan(itemSpend(thorn20, RULES)!.points);
    expect(itemSpend(thorn50, RULES)!.points).toBeGreaterThan(itemSpend(thorn40, RULES)!.points);
    expect(itemSpend(thorn70, RULES)!.points).toBeCloseTo(itemSpend(thorn50, RULES)!.points, 9);
  });
});

describe('player-facing text shows the real number and respects DescribeRules.shareCap', () => {
  test('status card, item card, and ability text show 40% by default, clamp to shareCap when capped, and show 70% when shareCap allows it', () => {
    const st40 = detailOf({ kind: 'status', label: 'Grievous Wounds', def: BUILT_IN_STATUSES.grievous, tier: 0, left: 2 }, RULES);
    expect(st40.about).toBe('Receives less healing.');
    expect(st40.lines).toContain('Healing received −40%');

    // Stored 70% under default 50% shareCap displays −50% so the card never lies against combat
    const st70Capped = detailOf({ kind: 'status', label: 'Grievous Wounds', def: gwDef(70), tier: 0, left: 2 }, RULES);
    expect(st70Capped.lines).toContain('Healing received −50%');

    // With shareCap raised to 0.8, 70% displays −70% across status, item, and ability text
    const R80 = rulesOf({ fight: { kit: { shareCap: 0.8 } } }, { grievous: gwDef(70) });
    const st70 = detailOf({ kind: 'status', label: 'Grievous Wounds', def: gwDef(70), tier: 0, left: 2 }, R80);
    expect(st70.about).toBe('Receives less healing.');
    expect(st70.lines).toContain('Healing received −70%');

    const thorn40Detail = detailOf({ kind: 'item', item: itemOf(RULES, thornDef) }, RULES);
    expect(thorn40Detail.lines.join('\n')).toContain('Healing received −40%');

    const thorn70Detail = detailOf({ kind: 'item', item: itemOf(R80, thornDef) }, R80);
    expect(thorn70Detail.lines.join('\n')).toContain('Healing received −70%');

    const ab70 = {
      ...abilityOf('curse', { id: abilityId('sever-70'), name: 'Sever' }, R80),
      ops: [{ op: 'applyStatus' as const, key: GW, def: gwDef(70), duration: tick(2 * R80.fight.round) }],
    };
    const abDetail = detailOf({ kind: 'ability', ability: ab70 }, R80);
    expect(abDetail.lines.join('\n')).toContain('Healing received −70%');
    expect(opLines(ab70.ops, 0, R80).join('\n')).toContain('Healing received −70%');
    expect(describeStatus(gwDef(70), 0, R80)).toEqual(['Healing received −70%']);

    // opLine uses floored grievousCapPct (0.455 -> −45%, 0 -> −1%, never +0%) and clamps tiered healing cuts
    const R455 = rulesOf({ fight: { kit: { shareCap: 0.455 } } });
    expect(describeStatus(gwDef(70), 0, R455)).toEqual(['Healing received −45%']);
    const R0 = rulesOf({ fight: { kit: { shareCap: 0 } } });
    expect(describeStatus(gwDef(70), 0, R0)).toEqual(['Healing received −1%']);

    const tieredOp = [{ op: 'share' as const, on: 'healed' as const, pct: [-10, -30, -50, -60, -70, -80] as const }];
    expect(opLines(tieredOp, null, RULES)).toEqual(['Healing received −10% / −30% / −50% / −50% / −50% / −50%, by rank E to S']);
    expect(opLines(tieredOp, 5, RULES)).toEqual(['Healing received −50%']);
    expect(opLines(tieredOp, 5, R80)).toEqual(['Healing received −80%']);
  });
});
