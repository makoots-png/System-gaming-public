// Unit tests for GM-editable damage types (the owner's steers t123u-t125u and Fable's review).
import { describe, expect, test } from 'bun:test';
import { RULES, damageTypeSet, rulesOf } from '../src/core/rules.ts';
import { parseOverrides } from '../src/core/overrides.ts';
import { DAMAGE_TYPES, DAMAGE_TYPES_MAX, DAMAGE_WORD, defenceOf, effectWord, isDamage, parseDamageTypes, typed } from '../src/core/combat/damage-type.ts';
import { afterDefence, defenceLeft } from '../src/core/combat/land.ts';
import { inCover, resolve } from '../src/core/combat/resolve.ts';
import { reduce } from '../src/core/combat/fight.ts';
import { sensible } from '../src/core/combat/policy.ts';
import { eventsOf } from '../src/core/combat/triggers.ts';
import { abilityLines } from '../src/core/combat/fight-view.ts';
import { openGrid, place } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { hunterAbilities, hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import { abilityOf, averages, defaultTicks, formulaOf, gapOf, powerStat, recommended } from '../src/core/registry/ability-kinds.ts';
import { ARCHETYPE_ATTACKS, ATTACK_ID, SKILL_ABILITIES, itemAbility, weaponAttack } from '../src/core/registry/abilities.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';
import { MYTHICS } from '../src/core/registry/mythics.ts';
import { mythicMove } from '../src/core/registry/mythic-moves.ts';
import { keystoneOf } from '../src/core/registry/keystones.ts';
import { BUILT_IN_STATUSES } from '../src/core/registry/statuses.ts';
import { parseItem } from '../src/core/registry/items.ts';
import { abilityWorth } from '../src/core/registry/worth.ts';
import { BUILT_IN_ABILITY_DAMAGE_ROWS, KEYSTONE_DAMAGE_ROWS, statusDamageTypeOf, statusWithDamageType } from '../src/core/registry/damage-catalog.ts';
import { STAT_KEYS } from '../src/core/stats.ts';
import { STAT_PAIRS } from '../src/core/hunter/keystones.ts';
import type { StatusDef } from '../src/core/combat/effect-ops.ts';
import { printFormula } from '../src/core/formula.ts';
import { describeItem } from '../src/core/effects.ts';
import { newHunter } from '../src/core/save.ts';
import { fightId, saveId } from '../src/core/ids.ts';
import { roomRulesOf, withRoomRules } from '../src/core/hunter/build.ts';
import { DOCS } from '../src/core/protocol.ts';
import { putItem } from '../src/core/hunter/inventory.ts';
import { STARTER_SKILLS, skillOf } from '../src/core/registry/skills.ts';

const num = (value: number) => ({ kind: 'number', value }) as const;

describe('damage-type.ts core contract and penetration no-op', () => {
  test('unifies three damage types with isDamage, DAMAGE_WORD, and defenceOf', () => {
    expect([...DAMAGE_TYPES]).toEqual(['physical', 'arcane', 'true']);
    expect(DAMAGE_TYPES.every(t => isDamage(t))).toBe(true);
    expect([isDamage('heal'), isDamage('shield'), isDamage('magical'), isDamage(null)]).toEqual([false, false, false, false]);
    expect([defenceOf('physical'), defenceOf('arcane'), defenceOf('true')]).toEqual(['armor', 'resist', null]);
    expect([DAMAGE_WORD.physical, DAMAGE_WORD.arcane, DAMAGE_WORD.true]).toEqual(['Physical damage', 'Arcane damage', 'True damage']);
  });

  test('penetration has zero effect on true damage against high Armor and Resist', () => {
    const heavyPen = { armorPen: 80, resistPen: 80, armorPenFlat: 50, resistPenFlat: 50 };
    const noPen = { armorPen: 0, resistPen: 0, armorPenFlat: 0, resistPenFlat: 0 };
    const tank = { armor: 250, resist: 250 };
    expect(defenceLeft('true', heavyPen, tank)).toBe(0);
    expect(defenceLeft('true', noPen, tank)).toBe(0);
    expect(afterDefence(25, 'true', heavyPen, tank, RULES)).toBe(25);
    expect(afterDefence(25, 'true', noPen, tank, RULES)).toBe(25);
  });

  test('parseDamageTypes and parseOverrides accept valid AbilityIds and reserved keys, refuse attack, and cap entries', () => {
    const { overrides, refused } = parseOverrides({
      fight: {
        damageTypes: {
          'arc-bolt': 'true',
          'attack-unarmed': 'arcane',
          'keystone-seared': 'true',
          'keystone-cataclysm-zone': 'physical',
          attack: 'true',
          'bad-val': 'fire',
        },
      },
    });
    expect(overrides).toEqual({
      fight: {
        damageTypes: {
          'arc-bolt': 'true',
          'attack-unarmed': 'arcane',
          'keystone-seared': 'true',
          'keystone-cataclysm-zone': 'physical',
        },
      },
    });
    expect(refused).toEqual([
      { path: 'fight.damageTypes.attack', reason: 'unknown' },
      { path: 'fight.damageTypes.bad-val', reason: 'entry' },
    ]);

    const huge: Record<string, string> = {};
    for (let i = 0; i < DAMAGE_TYPES_MAX + 5; i++) huge[`ab-${i}`] = 'true';
    const bad: string[] = [];
    const parsed = parseDamageTypes(huge, k => bad.push(k))!;
    expect(Object.keys(parsed).length).toBe(DAMAGE_TYPES_MAX);
    expect(bad.length).toBe(5);
  });
});

describe('true-damage abilities across all combat resolution sites', () => {
  const trueBolt = abilityOf('curse', {
    id: abilityId('true-bolt'),
    name: 'True Bolt',
    effect: { type: 'true', by: 'hand', formula: num(20) },
    delivery: { kind: 'sure' },
  }, RULES);
  const trueShot = abilityOf('shot', {
    id: abilityId('true-shot'),
    name: 'True Shot',
    effect: { type: 'true', by: 'hand', formula: num(20) },
  }, RULES);

  test('true-damage abilities deal HP damage, respect shield, threat, stagger, cover, damageShare, tallies, triggers, policy, stealth, and labels', () => {
    const coverTiles = Array(100).fill('floor');
    coverTiles[2 * 10 + 3] = 'cover';
    expect(inCover(trueShot, place(3, 2), { w: 10, h: 10, tiles: coverTiles } as any)).toBe(true);

    const hRow = {
      ...hunterRow({ ...newHunter(RULES), id: 'h1', name: 'Hero' }, combatantId('c1'), RULES),
      place: place(2, 2),
      abilities: [trueBolt],
      statuses: [
        statusOn(BUILT_IN_STATUSES.stealth, { key: statusKey('stealth'), source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) }),
        statusOn({ label: 'Boost', desc: '', ops: [{ op: 'share', on: 'dealt', pct: 50 }] }, { key: statusKey('boost'), source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) }),
      ],
    };
    const boss = seedMonsters(RULES).find(m => m.kind === 'boss')!;
    const mRow = {
      ...monsterRows(boss, [combatantId('c2')], RULES)[0]!,
      place: place(3, 2),
      shield: { amount: 5, until: tick(5000) },
    };
    const setup = reduce(null, { type: 'add', fightId: fightId('f-true'), rows: [hRow, mRow], openings: [] }, { rules: RULES }).fight!;
    const running = reduce(setup, { type: 'start', openings: [{ id: combatantId('c1'), d20: 20, tie: 0 }, { id: combatantId('c2'), d20: 1, tie: 0 }] }, { rules: RULES }).fight!;
    if (running.phase !== 'running') throw new Error('expected running fight');

    // Policy scores true-damage ability > 0 and chooses it
    const choice = sensible(running, running.rows[0]!, RULES);
    expect(choice.type === 'act' && choice.ability.id).toBe(trueBolt.id);

    // Resolve and reduce: +50% dealt share + ambush bonus -> raw > 20, shield absorbs 5, rest deals HP damage, builds threat & stagger, breaks stealth, records tally & triggers
    const h0 = running.rows[0]!, m0 = running.rows[1]!;
    const r = resolve(trueBolt, h0, running.rows, m0.id, running.grid, { dice: { [m0.id]: [] }, react: {} }, running.now, RULES);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const o = r.outcomes[0]!;
    expect(o.type).toBe('true');
    expect(o.raw).toBeGreaterThan(20);
    expect(o.dealt).toBe(Math.round(o.raw));
    expect(o.absorbed).toBe(5);
    expect(o.threat).toBeGreaterThan(0);
    expect(o.stagger).toBeGreaterThan(0);
    const ev = eventsOf(trueBolt, h0.id, r.outcomes, running.rows, r.bodies).map(e => e.event);
    expect(ev).toContain('hitDealt');
    expect(ev).toContain('struck');

    const acted = reduce(running, { type: 'act', by: h0.id, ability: trueBolt.id, aim: m0.id, rolls: { dice: { [m0.id]: [] }, react: {} } }, { rules: RULES });
    const hAfter = acted.fight!.rows.find(x => x.id === h0.id)!;
    const mAfter = acted.fight!.rows.find(x => x.id === m0.id)!;
    expect(rowHp(m0) - rowHp(mAfter)).toBe(o.dealt - 5);
    expect(hAfter.statuses.some(s => s.key === 'stealth')).toBe(false);
    expect(hAfter.tally?.hits).toBe(1);
    expect(hAfter.tally?.dealt).toBe(o.dealt);

    // Labels and maker averages
    expect(abilityLines(trueBolt, RULES)[0]).toBe('True damage 20');
    expect(effectWord(trueBolt, RULES)).toBe('True damage');
    expect(averages(num(20), 'true', 'str', RULES).every(x => x.dealt === null)).toBe(true);
  });

  test('worth weighs true-damage abilities by the reference target defense ratio without crashing', () => {
    const phys = abilityOf('strike', { id: abilityId('p1'), name: 'P1' }, RULES);
    const tr = abilityOf('strike', { id: abilityId('t1'), name: 'T1', ticks: { ...defaultTicks('strike', 'true') } }, RULES);
    expect(abilityWorth(tr, RULES).worth).toBeGreaterThan(abilityWorth(phys, RULES).worth);
  });
});

describe('POWER keyed by stat and built-in formula invariance on retype', () => {
  test('retyping any built-in skill, monster ability, archetype attack, or mythic move preserves its printed formula', () => {
    const allToTrue: Record<string, 'true'> = {
      'attack-unarmed': 'true',
      'attack-brute': 'true',
      'attack-skirmisher': 'true',
      'attack-caster': 'true',
    };
    for (const row of BUILT_IN_ABILITY_DAMAGE_ROWS) allToTrue[row.id] = 'true';
    const R = rulesOf({ fight: { damageTypes: allToTrue } });

    for (const make of Object.values(SKILL_ABILITIES)) {
      const a0 = make(RULES), a1 = make(R);
      if (!a0?.effect || !a1?.effect || !isDamage(a0.effect.type)) continue;
      expect(a1.effect.type, a0.id).toBe('true');
      expect(printFormula(formulaOf(a1, R)!), a0.id).toBe(printFormula(formulaOf(a0, RULES)!));
    }

    for (const arch of ['brute', 'skirmisher', 'caster'] as const) {
      const a0 = ARCHETYPE_ATTACKS[arch](RULES), a1 = ARCHETYPE_ATTACKS[arch](R);
      expect(a1.effect?.type, arch).toBe('true');
      expect(printFormula(formulaOf(a1, R)!), arch).toBe(printFormula(formulaOf(a0, RULES)!));
    }

    const baseMonsters = seedMonsters(RULES), retypedMonsters = seedMonsters(R);
    for (let i = 0; i < baseMonsters.length; i++) {
      for (let j = 0; j < baseMonsters[i]!.abilities.length; j++) {
        const a0 = baseMonsters[i]!.abilities[j]!, a1 = retypedMonsters[i]!.abilities[j]!;
        if (!a0.effect || !isDamage(a0.effect.type)) continue;
        expect(a1.effect?.type, a0.id).toBe('true');
        expect(printFormula(formulaOf(a1, R)!), a0.id).toBe(printFormula(formulaOf(a0, RULES)!));
      }
    }

    const body = { rank: 'S' as const, archetype: 'caster' as const, kind: 'mythic' as const, tweak: { hp: 1, dealt: 1, stats: {}, traits: [] } };
    for (const sc of Object.values(MYTHICS)) {
      for (const [mvKey, mv] of Object.entries(sc.moves)) {
        const a0 = mythicMove(mvKey as any, mv, body, RULES);
        const a1 = mythicMove(mvKey as any, mv, body, R);
        if (!a0.effect || !isDamage(a0.effect.type)) continue;
        expect(a1.effect?.type, a0.id).toBe('true');
        expect(printFormula(formulaOf(a1, R)!), a0.id).toBe(printFormula(formulaOf(a0, RULES)!));
      }
    }

    // Power keyed by stat: str -> phys, pow -> mag, pre -> sup, ins -> curve
    expect(recommended('strike', { ...defaultTicks('strike', 'true'), scale: 'str' }, RULES).text).toBe('1d8 + phys');
    expect(recommended('strike', { ...defaultTicks('strike', 'true'), scale: 'pow' }, RULES).text).toBe('1d8 + mag');
    expect(recommended('strike', { ...defaultTicks('strike', 'true'), scale: 'pre' }, RULES).text).toBe('1d8 + sup');
    expect(recommended('strike', { ...defaultTicks('strike', 'true'), scale: 'ins' }, RULES).text).toContain('ins');
    expect([powerStat('true', 'strike'), powerStat('true', 'curse')]).toEqual(['str', 'pow']);
    expect([gapOf('true', 'strike').mine, gapOf('true', 'curse').mine]).toEqual(['str', 'pow']);
  });
});

describe('GM overrides, weapons, keystones, running fight snapshots, and RoomRules', () => {
  test('learned by-value skills follow RULES.fight.damageTypes via distinct() and effectWord()', () => {
    const h = { ...newHunter(RULES), skills: [{ ...skillOf(STARTER_SKILLS.arcBolt, RULES), id: saveId('s', 1) }] };
    const R = rulesOf({ fight: { damageTypes: { 'arc-bolt': 'true' } } });
    const ab = hunterAbilities(h, R).find(a => a.id === abilityId('arc-bolt'))!;
    expect(ab.effect?.type).toBe('true');
    expect(effectWord(h.skills[0]!.type === 'active' ? h.skills[0]!.ability! : ab, R)).toBe('True damage');
    expect(typed(h.skills[0]!.type === 'active' ? h.skills[0]!.ability! : ab, R).effect?.type).toBe('true');
  });

  test('weapons carry Item.damageType through parseItem, RowItem, hunterAbilities, weaponAttack, inventory stacking, and describeItem', () => {
    const blade = parseItem({ name: 'Void Edge', type: 'weapon', slot: 'weapon', dice: '1d8', attack: 'strike', damageType: 'true' })!;
    const physBlade = parseItem({ name: 'Void Edge', type: 'weapon', slot: 'weapon', dice: '1d8', attack: 'strike' })!;
    expect(blade.damageType).toBe('true');
    expect(describeItem(RULES, blade)).toContain('True damage');
    expect(describeItem(RULES, physBlade)).not.toContain('Physical damage');
    const atk = weaponAttack({ name: blade.name, dice: blade.dice, attack: blade.attack!, ...(blade.damageType ? { damageType: blade.damageType } : {}) }, RULES);
    expect(atk.effect?.type).toBe('true');
    expect(printFormula(formulaOf(atk, RULES)!)).toBe('1d8 + phys');

    let h = newHunter(RULES);
    h = putItem(h, blade, saveId('i', 1));
    h = putItem(h, physBlade, saveId('i', 2));
    expect(h.items.length).toBe(2);
    h = { ...h, equipped: { ...h.equipped, weapon: saveId('i', 1) } };
    const rowAtk = hunterAbilities(h, RULES).find(a => a.id === ATTACK_ID)!;
    expect(rowAtk.effect?.type).toBe('true');

    // Thrown true-damage consumable produces a true-damage itemAbility
    const bomb = parseItem({ name: 'Void Bomb', type: 'consumable', target: 'other', effects: [{ op: 'damage', type: 'true', amount: num(12), when: 'use' }] })!;
    const bombAb = itemAbility({ id: saveId('i', 9), name: bomb.name, rar: bomb.rar, ...(bomb.target ? { target: bomb.target } : {}), ...(bomb.effects ? { effects: bomb.effects } : {}) }, RULES)!;
    expect(bombAb.effect).toEqual({ type: 'true', by: 'hand', formula: num(12) });
  });

  test('Seared, Cataclysm zone, Executioner, Spellblade, and Riposte follow reserved keys in RULES.fight.damageTypes and build words from their type', () => {
    const baseSeared = keystoneOf({ tier: 'confluence', pair: 'ins+pow' }, RULES);
    expect(baseSeared.line).toContain('arcane damage');
    expect(baseSeared.line).not.toContain('magic damage');

    const baseExec = keystoneOf({ tier: 'confluence', pair: 'str+ins' }, RULES);
    expect(baseExec.line).toContain('physical damage');
    const baseBlade = keystoneOf({ tier: 'confluence', pair: 'str+pow' }, RULES);
    expect(baseBlade.line).toContain('arcane damage');
    const baseRiposte = keystoneOf({ tier: 'confluence', pair: 'agi+ins' }, RULES);
    expect(baseRiposte.line).toContain('physical damage');
    expect(baseRiposte.awakened!.worn!.desc).toContain('physical damage');

    const R = rulesOf({
      fight: {
        damageTypes: {
          'keystone-seared': 'true',
          'keystone-cataclysm-zone': 'physical',
          'keystone-executioner': 'true',
          'keystone-spellblade': 'physical',
          'keystone-riposte': 'arcane',
        },
      },
    });
    const searedKs = keystoneOf({ tier: 'confluence', pair: 'ins+pow' }, R);
    expect(searedKs.line).toContain('true damage');
    const applyOp = searedKs.worn!.triggers![0]!.ops[0]!;
    expect(applyOp.op === 'applyStatus' && applyOp.def.desc).toBe('Takes true damage each round.');
    expect(applyOp.op === 'applyStatus' && applyOp.def.ops[0]!.op === 'damage' && applyOp.def.ops[0]!.type).toBe('true');

    const cataKs = keystoneOf({ tier: 'apex', stat: 'pow' }, R);
    expect(cataKs.active!.zone!.ops[0]!.op === 'damage' && cataKs.active!.zone!.ops[0]!.type).toBe('physical');

    const execKs = keystoneOf({ tier: 'confluence', pair: 'str+ins' }, R);
    expect(execKs.line).toContain('true damage');
    const execOp = execKs.worn!.triggers![0]!.ops[0]!;
    expect(execOp.op === 'damage' && execOp.type).toBe('true');

    const bladeKs = keystoneOf({ tier: 'confluence', pair: 'str+pow' }, R);
    expect(bladeKs.line).toContain('physical damage');
    const chargedOp = bladeKs.worn!.triggers![0]!.ops[0]!;
    expect(chargedOp.op === 'applyStatus' && chargedOp.def.desc).toBe('Its next strike adds physical damage.');
    const bladeDmg = chargedOp.op === 'applyStatus' ? chargedOp.def.triggers![0]!.ops[0]! : null;
    expect(bladeDmg?.op === 'damage' && bladeDmg.type).toBe('physical');

    const riposteKs = keystoneOf({ tier: 'confluence', pair: 'agi+ins' }, R);
    expect(riposteKs.line).toContain('arcane damage');
    expect(riposteKs.awakened!.worn!.desc).toContain('arcane damage');
    const riposteBaseOp = riposteKs.worn!.triggers![0]!.ops[0]!;
    const riposteAwakeOp = riposteKs.awakened!.worn!.triggers![0]!.ops[0]!;
    expect(riposteBaseOp.op === 'damage' && riposteBaseOp.type).toBe('arcane');
    expect(riposteAwakeOp.op === 'damage' && riposteAwakeOp.type).toBe('arcane');
  });

  test('every damaging keystone or Confluence op and active ability is GM-editable through RULES.fight.damageTypes', () => {
    const allTrue: Record<string, 'true'> = {};
    for (const r of KEYSTONE_DAMAGE_ROWS) allTrue[r.key] = 'true';
    for (const r of BUILT_IN_ABILITY_DAMAGE_ROWS) if (r.group === 'Keystone') allTrue[r.id] = 'true';
    const R = rulesOf({ fight: { damageTypes: allTrue } });

    const nonTrue: string[] = [];
    const scanDef = (where: string, def: StatusDef | undefined): void => {
      if (!def) return;
      for (const o of def.ops) if (o.op === 'damage' && o.type !== 'true') nonTrue.push(`${where}.ops:${o.type}`);
      for (const tr of def.triggers ?? []) {
        for (const o of tr.ops) {
          if (o.op === 'damage' && o.type !== 'true') nonTrue.push(`${where}.trigger(${tr.on}):${o.type}`);
          if (o.op === 'applyStatus') scanDef(`${where}->${o.key}`, o.def);
        }
      }
      if ('stack' in def && def.stack?.threshold) {
        for (const o of def.stack.threshold.ops) {
          if (o.op === 'damage' && o.type !== 'true') nonTrue.push(`${where}.threshold:${o.type}`);
          if (o.op === 'applyStatus') scanDef(`${where}.threshold->${o.key}`, o.def);
        }
      }
      if (def.end) {
        for (const o of def.end.ops) {
          if (o.op === 'damage' && o.type !== 'true') nonTrue.push(`${where}.end:${o.type}`);
          if (o.op === 'applyStatus') scanDef(`${where}.end->${o.key}`, o.def);
        }
      }
    };
    const keys = [
      ...STAT_KEYS.map(stat => ({ tier: 'mark', stat }) as const),
      ...STAT_KEYS.map(stat => ({ tier: 'apex', stat }) as const),
      ...STAT_PAIRS.map(pair => ({ tier: 'confluence', pair }) as const),
    ];
    for (const k of keys) {
      const ks = keystoneOf(k, R);
      scanDef(ks.name, ks.worn);
      scanDef(`${ks.name} (awakened)`, ks.awakened?.worn);
      for (const ab of [ks.active, ks.awakened?.active]) {
        if (!ab) continue;
        if (ab.effect && isDamage(ab.effect.type) && ab.effect.type !== 'true') nonTrue.push(`${ks.name}.${ab.id}.effect:${ab.effect.type}`);
        for (const o of ab.zone?.ops ?? []) if (o.op === 'damage' && o.type !== 'true') nonTrue.push(`${ks.name}.${ab.id}.zone:${o.type}`);
      }
    }
    expect(nonTrue).toEqual([]);
  });

  test('running fights snapshot abilities and statuses: changing rules mid-fight does not alter rows already in the fight', () => {
    const h = { ...newHunter(RULES), skills: [{ ...skillOf(STARTER_SKILLS.arcBolt, RULES), id: saveId('s', 1) }] };
    const hRow = hunterRow(h, combatantId('c1'), RULES);
    const mRow = monsterRows(seedMonsters(RULES)[0]!, [combatantId('c2')], RULES)[0]!;
    const setup = reduce(null, { type: 'add', fightId: fightId('f-snap'), rows: [hRow, mRow], openings: [] }, { rules: RULES }).fight!;
    const running = reduce(setup, { type: 'start', openings: [{ id: combatantId('c1'), d20: 20, tie: 0 }, { id: combatantId('c2'), d20: 1, tie: 0 }] }, { rules: RULES }).fight!;
    if (running.phase !== 'running') throw new Error('expected running fight');

    const laterRules = rulesOf({ fight: { damageTypes: { 'arc-bolt': 'true' } } });
    const boltInFight = running.rows[0]!.abilities.find(a => a.id === abilityId('arc-bolt'))!;
    expect(boltInFight.effect?.type).toBe('arcane');
    const r = resolve(boltInFight, running.rows[0]!, running.rows, running.rows[1]!.id, running.grid, { dice: { [running.rows[1]!.id]: [3, 3] }, react: { [running.rows[1]!.id]: 1 } }, running.now, laterRules);
    expect(r.ok && r.outcomes[0]!.type).toBe('arcane');
  });

  test('RoomRules carries damageTypes and GM-overridden built-in statuses cleanly across the wire', () => {
    const arcanePoison = statusWithDamageType(BUILT_IN_STATUSES.poisoned, 'arcane');
    const gmRules = rulesOf(
      damageTypeSet({}, 'arc-bolt', 'true'),
      { poisoned: arcanePoison, 'custom-gm': { label: 'Custom', desc: '', ops: [] } },
    );
    const wire = JSON.parse(JSON.stringify(roomRulesOf(gmRules)));
    expect(wire.damageTypes).toEqual({ 'arc-bolt': 'true' });
    expect(Object.keys(wire.statuses)).toEqual(['poisoned']);
    expect(statusDamageTypeOf(wire.statuses.poisoned)).toBe('arcane');

    const parsed = DOCS.rules(wire)!;
    expect(parsed).not.toBeNull();
    const playerRules = withRoomRules(RULES, parsed);
    expect(playerRules.fight.damageTypes).toEqual({ 'arc-bolt': 'true' });
    expect(statusDamageTypeOf(playerRules.conditions.poisoned)).toBe('arcane');

    // Missing damageTypes/statuses or invalid keys refuse the doc
    const { damageTypes: _d, statuses: _s, ...partial } = wire;
    expect(DOCS.rules(partial)).toBeNull();
    expect(DOCS.rules({ ...wire, damageTypes: { attack: 'true' } })).toBeNull();
    expect(DOCS.rules({ ...wire, statuses: { 'not-built-in': arcanePoison } })).toBeNull();
  });
});
