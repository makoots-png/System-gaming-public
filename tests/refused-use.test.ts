// Bug 1 proof: a refused use must never spend or end the turn, and must never change any resource, use count, cooldown,
// channel, or fight log. Covers every costed ability across all 36 classes (base signature actives and replace-active
// upgrades), weapon attack, consumable item abilities, costed reactions, and the GM-to-player sync refusal path.
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { baseStats } from '../src/core/stats.ts';
import { kitGear, NO_TWEAK } from '../src/core/hunter/derive.ts';
import { CLASS_SIGNATURES } from '../src/core/registry/class-powers.ts';
import { CLASS_TREES } from '../src/core/registry/class-trees.ts';
import { builtInItems } from '../src/core/registry/items.ts';
import { itemAbility, weaponAttack } from '../src/core/registry/abilities.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { abilityId, combatantId, hunterId } from '../src/core/combat/ability-types.ts';
import type { Ability, CombatantId, Price } from '../src/core/combat/ability-types.ts';
import { modified, statusKey } from '../src/core/combat/effect-ops.ts';
import type { Body, Origin, Status, StatusDef, StatusKey } from '../src/core/combat/effect-ops.ts';
import { openGrid, place, tiles } from '../src/core/combat/space.ts';
import type { Place, Side } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { zoneId } from '../src/core/combat/zones.ts';
import type { Zone } from '../src/core/combat/zones.ts';
import { affordCheck, costOf, hpPriceTotal } from '../src/core/combat/charge.ts';
import { chargeRefusalWords, TABLE_REFUSAL_WORDS } from '../src/core/combat/refusal-words.ts';
import { bodyCantAfford, docCantAfford } from '../src/core/combat/fight-view.ts';
import { fightDoc, fightWire } from '../src/core/combat/fight-doc.ts';
import { DOCS } from '../src/core/protocol.ts';
import { NOTHING_TOLD, toldAfter } from '../src/core/combat/table-news.ts';
import { TURN_FREE, turnHoldStep } from '../src/core/combat/hold.ts';
import { mayFire, react } from '../src/core/combat/fight-react.ts';
import { needs } from '../src/core/combat/resolve.ts';
import type { Aim, Rolls } from '../src/core/combat/resolve.ts';
import { reduce } from '../src/core/combat/fight.ts';
import type { Command, Ctx, Fight, NewRow, Opening, Running } from '../src/core/combat/fight.ts';
import { fightId, parseDeviceId, parseSheetKey, saveId } from '../src/core/ids.ts';
import { lifeAt } from './fixtures/life.ts';
import type { RowPatch } from './fixtures/life.ts';

const ctx: Ctx = { rules: RULES };
const id = combatantId;
const heroId = id('hero');
const allyId = id('ally');
const foeId = id('foe');

const heroOrigin: Origin = {
  kind: 'hunter',
  build: { stats: { ...baseStats(RULES.fight), vit: 60, pow: 100, ctl: 100, str: 40, agi: 40, dis: 40, pre: 40 }, level: 50, gear: kitGear('light', RULES), perks: {} },
};
const foeOrigin: Origin = {
  kind: 'monster', name: 'Cave Rat', rank: 'E', archetype: 'brute', monsterKind: 'normal', tweak: NO_TWEAK,
};

function makeStatus(key: StatusKey, stacks: number): Status {
  const base = {
    label: key.replace(/-/g, ' '),
    desc: '',
    ops: [] as const,
  };
  if (stacks > 1) {
    const def: StatusDef = {
      ...base,
      stack: { cap: Math.max(20, stacks + 5), leave: { kind: 'never' }, keep: 'fight', threshold: null },
    };
    return { key, def, source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0), stacks };
  }
  return { key, def: base, source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) };
}

function makeRow(name: string, side: Side, o: RowPatch<NewRow> = {}): NewRow {
  const { kind: k, hp, ...rest } = o;
  const origin = o.origin ?? heroOrigin;
  const hpMax = modified(origin, o.statuses ?? [], RULES).sheet.hpMax;
  const kind = k ?? (side === 'party' ? 'hunter' : 'monster');
  return {
    id: id(name),
    name,
    side,
    ...lifeAt(kind, hp ?? hpMax),
    origin,
    tier: 0,
    place: null,
    mana: 200,
    fatigue: 0,
    shield: null,
    stagger: null,
    channel: null,
    threat: kind === 'monster' ? {} : null,
    statuses: [],
    readyAt: {},
    abilities: [],
    intent: null,
    holder: kind === 'hunter' ? { kind: 'local', hunterId: hunterId(`h-${name}`) } : null,
    xp: 0,
    mythic: null,
    ...rest,
  } as NewRow;
}

function makeZone(name: string, at: Place, owner: CombatantId): Zone {
  return {
    id: zoneId(`z-${name}`),
    name,
    ground: { kind: 'tiles', tiles: [at] },
    owner,
    spares: null,
    tier: 0,
    until: tick(RULES.fight.round * 5),
    endsWithOwner: false,
    ops: [],
  };
}

function buildRunningFight(
  a: Ability,
  opts: {
    heroHp?: number;
    heroMana?: number;
    heroTier?: number;
    heroReadyAt?: Readonly<Record<string, ReturnType<typeof tick>>>;
    heroUsed?: Readonly<Record<string, number>>;
    heroStatuses?: readonly Status[];
    foeStatuses?: readonly Status[];
    allyStatuses?: readonly Status[];
    foeDead?: boolean;
    needMinion?: boolean;
    zones?: readonly Zone[];
  } = {},
): Running {
  const hero = makeRow('hero', 'party', {
    abilities: [a],
    ...(opts.heroHp !== undefined ? { hp: opts.heroHp } : {}),
    ...(opts.heroMana !== undefined ? { mana: opts.heroMana } : {}),
    ...(opts.heroTier !== undefined ? { tier: opts.heroTier } : {}),
    ...(opts.heroReadyAt ? { readyAt: opts.heroReadyAt } : {}),
    ...(opts.heroUsed ? { used: opts.heroUsed } : {}),
    ...(opts.heroStatuses ? { statuses: opts.heroStatuses } : {}),
  });
  const ally = opts.needMinion
    ? makeRow('ally', 'party', {
      kind: 'summon',
      origin: foeOrigin,
      owner: heroId,
      until: tick(RULES.fight.round * 5),
      holder: null,
      threat: null,
      abilities: [abilityOf('strike', { id: abilityId('ally-hit'), name: 'Hit' }, RULES)],
      ...(opts.allyStatuses ? { statuses: opts.allyStatuses } : {}),
    })
    : makeRow('ally', 'party', {
      abilities: [abilityOf('strike', { id: abilityId('ally-hit'), name: 'Hit' }, RULES)],
      ...(opts.allyStatuses ? { statuses: opts.allyStatuses } : {}),
    });
  const foe = makeRow('foe', 'foe', {
    kind: 'monster',
    origin: foeOrigin,
    abilities: [abilityOf('strike', { id: abilityId('foe-hit'), name: 'Hit' }, RULES)],
    ...(opts.foeStatuses ? { statuses: opts.foeStatuses } : {}),
  });
  const foe2 = makeRow('foe2', 'foe', {
    kind: 'monster',
    origin: foeOrigin,
    abilities: [abilityOf('strike', { id: abilityId('foe2-hit'), name: 'Hit' }, RULES)],
  });

  const openings: Opening[] = [
    { id: heroId, d20: 20, tie: 0 },
    { id: allyId, d20: 10, tie: 1 },
    { id: foeId, d20: 5, tie: 2 },
    ...(opts.foeDead ? [{ id: id('foe2'), d20: 4, tie: 3 }] : []),
  ];
  const initRows = opts.foeDead ? [hero, ally, foe, foe2] : [hero, ally, foe];
  const r1 = reduce(null, { type: 'add', fightId: fightId('f-refuse'), rows: initRows, openings: [] }, ctx);
  const r2 = reduce(r1.fight, { type: 'start', openings }, ctx);
  if (r2.fight?.phase !== 'running') throw new Error('Expected running fight');

  const f = r2.fight;
  const rows = f.rows.map(r => {
    if (r.id === heroId) return { ...r, place: place(2, 2), at: f.now, tie: 0 };
    if (r.id === allyId) return { ...r, place: place(2, 3), at: tick(f.now + 100), tie: 1 };
    if (r.id === foeId) {
      const base = { ...r, place: place(2, 1), at: tick(f.now + 200), tie: 2 };
      return opts.foeDead ? { ...base, life: { at: 'dead' as const } } : base;
    }
    if (r.id === id('foe2')) return { ...r, place: place(5, 5), at: tick(f.now + 300), tie: 3 };
    return r;
  });

  return {
    ...f,
    grid: openGrid(12, 12),
    currentId: heroId,
    rows,
    zones: opts.zones ? [...opts.zones] : [],
    log: [],
  };
}

function chooseAim(a: Ability, f: Running): Aim {
  const hero = f.rows.find(r => r.id === heroId)!;
  const ally = f.rows.find(r => r.id === allyId)!;
  const foe = f.rows.find(r => r.id === foeId)!;
  if (a.aim === 'self') return hero.id;
  if (a.aim === 'ally') return a.range === 0 ? hero.id : ally.id;
  if (a.aim === 'foe' || a.aim === 'corpse') return foe.id;
  if (a.range === 0) return hero.place;
  if (a.move?.kind === 'blink') return place(3, 2);
  return foe.place;
}

function makeRolls(a: Ability, f: Running, aim: Aim): Rolls {
  const hero = f.rows.find(r => r.id === heroId)!;
  const req = needs(a, hero, f.rows, aim, f.grid, f.now, RULES);
  const dice: Record<string, number[]> = {};
  const reactRolls: Record<string, number> = {};
  for (const [k, list] of Object.entries(req.dice)) {
    dice[k] = list.map(() => 1);
  }
  for (const k of req.react) reactRolls[k] = 1;
  return { dice: dice as Rolls['dice'], react: reactRolls as Rolls['react'] };
}

/** Builds a baseline Running fight where every gate, price, mana, HP, and target condition on `a` is met. */
function affordableSetup(a: Ability): {
  heroStatuses: Status[];
  foeStatuses: Status[];
  allyStatuses: Status[];
  zones: Zone[];
  heroMana: number;
  foeDead: boolean;
  needMinion: boolean;
} {
  const selfMap = new Map<StatusKey, number>();
  const targetMap = new Map<StatusKey, number>();
  const zoneNames = new Set<string>();

  for (const g of a.gates ?? []) {
    if (g.kind === 'holds') {
      const m = g.on === 'self' ? selfMap : targetMap;
      m.set(g.key, Math.max(m.get(g.key) ?? 0, g.atLeast));
    } else if (g.kind === 'inside') {
      zoneNames.add(g.zone);
    }
  }
  for (const p of a.prices ?? []) {
    if (p.kind === 'stacks' && p.from === 'self') {
      const need = p.take.kind === 'all' ? 2 : p.take.n;
      selfMap.set(p.key, (selfMap.get(p.key) ?? 0) + need);
    } else if (p.kind === 'zone') {
      zoneNames.add(p.name ?? 'Arcane Field');
    }
  }

  const heroStatuses = [...selfMap.entries()].map(([k, n]) => makeStatus(k, n));
  const targetStatuses = [...targetMap.entries()].map(([k, n]) => makeStatus(k, n));
  const zones = [...zoneNames].map(name => makeZone(name, place(2, 2), heroId));
  const heroMana = Math.max(50, a.cost.mana + 20);
  const foeDead = Boolean(a.raise);
  const needMinion = a.move?.kind === 'swap' && a.move.only === 'minion';
  return {
    heroStatuses,
    foeStatuses: a.aim === 'ally' ? [] : targetStatuses,
    allyStatuses: a.aim === 'ally' ? targetStatuses : [],
    zones,
    heroMana,
    foeDead,
    needMinion,
  };
}

/** Asserts that attempting `a` on `fight` is refused with `expectedReason`, leaves every fight field untouched, and gives a plain reason. */
function assertRefusedNoOp(fight: Running, a: Ability, expectedReason: string, label: string): string {
  const aim = chooseAim(a, fight);
  const cmd: Command = { type: 'act', by: heroId, ability: a.id, aim, rolls: makeRolls(a, fight, aim) };
  const snapshot = JSON.stringify(fight);
  const res = reduce(fight, cmd, ctx);

  expect(res.effects, `${label}: should produce refusal effect`).toContainEqual({ type: 'refused', reason: expectedReason });
  expect(res.effects.some(e => e.type === 'turnStarted'), `${label}: must not start another turn`).toBe(false);
  expect(res.fight, `${label}: refused act must return unchanged fight`).toBe(fight);
  expect(JSON.stringify(res.fight), `${label}: fight state deeply unchanged`).toBe(snapshot);

  const hero = fight.rows.find(r => r.id === heroId)!;
  const msg = bodyCantAfford(fight, hero, a, aim, RULES, 'player');
  expect(msg, `${label}: bodyCantAfford must explain refusal`).not.toBeNull();
  expect(msg!.includes('\u2014'), `${label}: no em dashes in refusal copy`).toBe(false);
  return msg!;
}

/** Collects all 36 classes' base signature actives and replace-active tree upgrades. */
function collectAllClassAbilities(): { classCount: number; actives: { cls: string; source: string; ability: Ability }[]; reactions: { cls: string; source: string; ability: Ability }[] } {
  const actives: { cls: string; source: string; ability: Ability }[] = [];
  const reactions: { cls: string; source: string; ability: Ability }[] = [];
  const entries = Object.entries(CLASS_SIGNATURES);
  for (const [cls, sig] of entries) {
    for (const a of sig.actives ?? []) {
      (a.react ? reactions : actives).push({ cls, source: `${cls} base:${a.name}`, ability: a });
    }
    const tree = CLASS_TREES[cls as keyof typeof CLASS_TREES];
    if (tree) {
      for (const node of tree.nodes) {
        for (const g of node.gifts) {
          if (g.kind === 'replace-active') {
            (g.active.react ? reactions : actives).push({ cls, source: `${cls} ${node.id}:${g.active.name}`, ability: g.active });
          }
        }
      }
    }
  }
  return { classCount: entries.length, actives, reactions };
}

describe('Bug 1: refused uses never end or spend the turn', () => {
  test('every costed/gated/cooldown active across all 36 classes is a full no-op when unaffordable (0 and need-1) and succeeds when affordable', () => {
    const { classCount, actives } = collectAllClassAbilities();
    expect(classCount).toBe(36);

    let costedChecked = 0;
    let manaChecks = 0;
    let hpChecks = 0;
    let stackChecks = 0;
    let zoneChecks = 0;
    let gateChecks = 0;
    let useLimitChecks = 0;
    let cooldownChecks = 0;
    let succeededCount = 0;

    for (const { source, ability: a } of actives) {
      const base = affordableSetup(a);
      const okFight = buildRunningFight(a, base);
      const hero = okFight.rows.find(r => r.id === heroId)!;
      const manaNeed = costOf(a, hero.sheet.costCut).mana;
      const hpCost = hpPriceTotal(a, hero.sheet.hpMax);
      const selfStackPrices = (a.prices ?? []).filter((p): p is Extract<Price, { kind: 'stacks' }> => p.kind === 'stacks' && p.from === 'self');
      const zonePrices = (a.prices ?? []).filter((p): p is Extract<Price, { kind: 'zone' }> => p.kind === 'zone');
      const holdsGates = (a.gates ?? []).filter(g => g.kind === 'holds');
      const insideGates = (a.gates ?? []).filter(g => g.kind === 'inside');
      const usesGates = (a.gates ?? []).filter(g => g.kind === 'uses');
      const hasAnyCostOrGate = manaNeed > 0 || hpCost > 0 || selfStackPrices.length > 0 || zonePrices.length > 0
        || holdsGates.length > 0 || insideGates.length > 0 || usesGates.length > 0 || a.cost.cooldown > 0;

      if (!hasAnyCostOrGate) continue;
      costedChecked++;

      // 1. Mana: 0 and need - 1
      if (manaNeed > 0) {
        for (const mana of [0, manaNeed - 1]) {
          const f = buildRunningFight(a, { ...base, heroMana: mana });
          const msg = assertRefusedNoOp(f, a, 'mana', `${source} mana=${mana}`);
          expect(msg).toContain(`Needs ${manaNeed}`);
          expect(msg).toContain(`you have ${mana}`);
          manaChecks++;
        }
      }

      // 2. HP / Hemomancer blood cost: minimal alive HP (1) and exact cost (= need - 1, since paying cost cannot drop HP to 0)
      if (hpCost > 0) {
        const need = hpCost + 1;
        for (const hp of [1, hpCost]) {
          const f = buildRunningFight(a, { ...base, heroHp: hp });
          const msg = assertRefusedNoOp(f, a, 'hp', `${source} hp=${hp}`);
          expect(msg).toContain(`Needs ${need}`);
          expect(msg).toContain(`costs ${hpCost}`);
          expect(msg).toContain(`you have ${hp}`);
          hpChecks++;
        }
      }

      // 3. Self stack prices: 0 and need - 1
      for (const p of selfStackPrices) {
        const need = p.take.kind === 'all' ? 1 : p.take.n;
        for (const have of [0, need - 1]) {
          const statuses = base.heroStatuses.filter(s => s.key !== p.key);
          if (have > 0) statuses.push(makeStatus(p.key, have));
          const gatedFirst = holdsGates.some(g => g.on === 'self' && g.key === p.key && have < g.atLeast);
          const f = buildRunningFight(a, { ...base, heroStatuses: statuses });
          const msg = assertRefusedNoOp(f, a, gatedFirst ? 'gated' : 'stacks', `${source} stacks(${p.key})=${have}`);
          expect(msg.length).toBeGreaterThan(0);
          if (!gatedFirst) {
            expect(msg).toContain(`Needs ${need}`);
            expect(msg).toContain(`you have ${have}`);
          }
          stackChecks++;
        }
      }

      // 4. Zone prices: no zone on the field
      if (zonePrices.length > 0) {
        const f = buildRunningFight(a, { ...base, zones: [] });
        const msg = assertRefusedNoOp(f, a, 'zone', `${source} zone`);
        expect(msg.length).toBeGreaterThan(0);
        zoneChecks++;
      }

      // 5. Holds gates: 0 and atLeast - 1
      for (const g of holdsGates) {
        for (const have of [0, g.atLeast - 1]) {
          const patch = g.on === 'self'
            ? { heroStatuses: [...base.heroStatuses.filter(s => s.key !== g.key), ...(have > 0 ? [makeStatus(g.key, have)] : [])] }
            : a.aim === 'ally'
              ? { allyStatuses: [...base.allyStatuses.filter(s => s.key !== g.key), ...(have > 0 ? [makeStatus(g.key, have)] : [])] }
              : { foeStatuses: [...base.foeStatuses.filter(s => s.key !== g.key), ...(have > 0 ? [makeStatus(g.key, have)] : [])] };
          const f = buildRunningFight(a, { ...base, ...patch });
          const msg = assertRefusedNoOp(f, a, 'gated', `${source} gate(${g.key})=${have}`);
          expect(msg.length).toBeGreaterThan(0);
          gateChecks++;
        }
      }

      // 6. Inside-zone gates: no matching zone
      if (insideGates.length > 0) {
        const f = buildRunningFight(a, { ...base, zones: [] });
        const msg = assertRefusedNoOp(f, a, 'gated', `${source} inside-zone`);
        expect(msg.length).toBeGreaterThan(0);
        gateChecks++;
      }

      // 7. Uses-per-fight / uses-per-gate limit: 0 uses left
      for (const g of usesGates) {
        const f = buildRunningFight(a, { ...base, heroUsed: { [a.id]: g.n } });
        const msg = assertRefusedNoOp(f, a, 'noUses', `${source} uses=spent`);
        expect(msg).toContain('No uses left');
        useLimitChecks++;
      }

      // 8. Cooldown: not ready yet
      if (a.cost.cooldown > 0) {
        const f = buildRunningFight(a, { ...base, heroReadyAt: { [a.id]: tick(okFight.now + RULES.fight.round) } });
        const msg = assertRefusedNoOp(f, a, 'cooldown', `${source} on-cooldown`);
        expect(msg).toContain('Ready in 1 round');
        cooldownChecks++;
      }

      // 9. Sanity check: the exact same ability SUCCEEDS when affordable (cannot pass by refusing everything)
      const aim = chooseAim(a, okFight);
      const okRes = reduce(okFight, { type: 'act', by: heroId, ability: a.id, aim, rolls: makeRolls(a, okFight, aim) }, ctx);
      expect(okRes.effects.find(e => e.type === 'refused'), `${source}: must succeed when affordable`).toBeUndefined();
      expect(okRes.fight).not.toBe(okFight);
      succeededCount++;
    }

    expect(costedChecked).toBeGreaterThanOrEqual(200);
    expect(succeededCount).toBe(costedChecked);
    expect(manaChecks).toBeGreaterThan(0);
    expect(hpChecks).toBeGreaterThan(0);
    expect(stackChecks).toBeGreaterThan(0);
    expect(cooldownChecks).toBeGreaterThan(0);
    expect(gateChecks + useLimitChecks + zoneChecks).toBeGreaterThan(0);
  });

  test('every costed reaction across all 36 classes refuses cleanly when unaffordable (0 and need-1) and fires when affordable', () => {
    const { reactions } = collectAllClassAbilities();
    expect(reactions.length).toBeGreaterThan(0);

    let reactionCostChecks = 0;
    let reactionsFired = 0;

    for (const { source, ability: a } of reactions) {
      const base = affordableSetup(a);
      const okFight = buildRunningFight(a, base);
      const heroBase = okFight.rows.find(r => r.id === heroId)!;
      const foeBase = okFight.rows.find(r => r.id === foeId)!;
      const armedHero: Body = { ...heroBase, armed: { ability: a.id, on: heroId, spent: false } };
      const manaNeed = costOf(a, heroBase.sheet.costCut).mana;
      const hpCost = hpPriceTotal(a, heroBase.sheet.hpMax);

      const assertReactionRefused = (mutatedHero: Body, label: string) => {
        const rows = new Map<CombatantId, Body>([[heroId, mutatedHero], [foeId, foeBase]]);
        const snap = JSON.stringify([...rows.entries()]);
        expect(mayFire(rows, mutatedHero, foeId, okFight.now, RULES), `${label}: mayFire must be false`).toBe(false);
        const out = react(rows, heroId, foeId, okFight.now, RULES);
        expect(out, `${label}: react must return null`).toBeNull();
        expect(JSON.stringify([...rows.entries()]), `${label}: rows unchanged`).toBe(snap);
        reactionCostChecks++;
      };

      if (manaNeed > 0) {
        for (const mana of [0, manaNeed - 1]) {
          assertReactionRefused({ ...armedHero, mana }, `${source} react mana=${mana}`);
        }
      }
      if (hpCost > 0) {
        for (const hp of [1, hpCost]) {
          assertReactionRefused({ ...armedHero, life: { at: 'up', hp } } as Body, `${source} react hp=${hp}`);
        }
      }
      if (a.cost.cooldown > 0) {
        assertReactionRefused({ ...armedHero, readyAt: { [a.id]: tick(okFight.now + RULES.fight.round) } }, `${source} react cooldown`);
      }

      // Affordable reaction fires
      const okRows = new Map<CombatantId, Body>([[heroId, armedHero], [foeId, foeBase]]);
      expect(mayFire(okRows, armedHero, foeId, okFight.now, RULES), `${source}: affordable reaction mayFire`).toBe(true);
      const fired = react(okRows, heroId, foeId, okFight.now, RULES);
      expect(fired, `${source}: affordable reaction fires`).not.toBeNull();
      reactionsFired++;
    }

    expect(reactionCostChecks).toBeGreaterThan(0);
    expect(reactionsFired).toBe(reactions.length);
  });

  test('weapon attack and consumable item abilities refuse without ending the turn when gated/cooldown/tooLow and succeed when valid', () => {
    const sword = weaponAttack({ name: 'Iron Blade', dice: '1d8', attack: 'strike' }, RULES);
    const swordWithCd: Ability = { ...sword, cost: { ...sword.cost, cooldown: tick(RULES.fight.round) } };

    // On cooldown -> refused no-op
    const cdFight = buildRunningFight(swordWithCd, { heroReadyAt: { [swordWithCd.id]: tick(RULES.fight.round) } });
    assertRefusedNoOp(cdFight, swordWithCd, 'cooldown', 'weapon attack cooldown');

    // Affordable weapon attack -> succeeds
    const okWeaponFight = buildRunningFight(sword);
    const wAim = chooseAim(sword, okWeaponFight);
    const wRes = reduce(okWeaponFight, { type: 'act', by: heroId, ability: sword.id, aim: wAim, rolls: makeRolls(sword, okWeaponFight, wAim) }, ctx);
    expect(wRes.effects.find(e => e.type === 'refused')).toBeUndefined();

    // Consumable item abilities from builtInItems (rank-capped healing potions + offensive consumables)
    const consumables = builtInItems(RULES)
      .filter(it => it.type === 'consumable' && it.effects && it.effects.length > 0)
      .map((it, idx) => ({ name: it.name, ability: itemAbility({ id: saveId('i', idx + 1), name: it.name, rar: it.rar, ...(it.target ? { target: it.target } : {}), ...(it.effects ? { effects: it.effects } : {}), ...(it.rankCap ? { rankCap: it.rankCap } : {}) }, RULES) }))
      .filter((x): x is { name: string; ability: Ability } => x.ability !== null);
    expect(consumables.length).toBeGreaterThan(0);

    let tooLowChecked = 0;
    for (const { name, ability: itemAb } of consumables) {
      // Rank-capped consumable refuses when hunter tier exceeds maxTier
      if (itemAb.maxTier !== undefined) {
        const highTierFight = buildRunningFight(itemAb, { heroTier: itemAb.maxTier + 1 });
        const msg = assertRefusedNoOp(highTierFight, itemAb, 'tooLow', `item ${name} tooLow`);
        expect(msg).toContain('Your rank is too high for that consumable');
        tooLowChecked++;
      }
      // Cooldown refusal on consumable
      const cdItemFight = buildRunningFight(itemAb, { heroTier: 0, heroReadyAt: { [itemAb.id]: tick(RULES.fight.round) } });
      assertRefusedNoOp(cdItemFight, itemAb, 'cooldown', `item ${name} cooldown`);

      // Valid consumable succeeds
      const okItemFight = buildRunningFight(itemAb, { heroTier: 0, heroHp: 50 });
      const aim = chooseAim(itemAb, okItemFight);
      const res = reduce(okItemFight, { type: 'act', by: heroId, ability: itemAb.id, aim, rolls: makeRolls(itemAb, okItemFight, aim) }, ctx);
      expect(res.effects.find(e => e.type === 'refused'), `item ${name}: succeeds when valid`).toBeUndefined();
    }
    expect(tooLowChecked).toBeGreaterThan(0);
  });

  test('sync refusal path carries exact reason text over wire, keeps the turn, and releases TurnHold', () => {
    const hemoPool = CLASS_SIGNATURES.Hemomancer!.actives!.find(a => a.name === 'Sanguine Pool')!;
    const f = buildRunningFight(hemoPool, { heroHp: 12 });
    const hero = f.rows.find(r => r.id === heroId)!;
    const hpCost = hpPriceTotal(hemoPool, hero.sheet.hpMax);
    const exactText = chargeRefusalWords(
      affordCheck(hemoPool, {
        hp: 12, hpMax: hero.sheet.hpMax, mana: hero.mana, costCut: hero.sheet.costCut, tier: hero.tier,
        readyAt: hero.readyAt, statuses: [],
      }, f.now, RULES)!,
      'player',
    );
    expect(exactText).toBe(`Not enough HP. Needs ${hpCost + 1} (costs ${hpCost}), you have 12.`);

    // GM builds fightDoc with refusal + exact text, sends over wire, player parses it
    const sk = parseSheetKey('dev-1:h-hero')!;
    const remoteFight: Running = {
      ...f,
      rows: f.rows.map(r => (r.id === heroId && r.kind === 'hunter' ? { ...r, holder: { kind: 'remote' as const, remote: sk } } : r)),
    };
    const docCtx = { by: parseDeviceId('dev-gm')!, at: '2026-11-28T00:00:00Z', was: null, keyOf: (h: string) => parseSheetKey(`dev-1:${h}`) };
    const doc1 = fightDoc(remoteFight, RULES, { ...docCtx, refused: null })!;
    const doc2 = fightDoc(remoteFight, RULES, { ...docCtx, refused: { id: heroId, at: f.now, reason: 'hp', n: 1, text: exactText } })!;
    const wire = fightWire(doc2);
    const parsed = DOCS.fight(wire);
    expect(parsed && !parsed.ended).toBe(true);
    if (!parsed || parsed.ended) throw new Error('expected active doc');

    // Exact text survives wire round-trip and turn stays on hero
    expect(parsed.currentId).toBe(heroId);
    expect(parsed.now).toBe(f.now);
    expect(parsed.refused?.text).toBe(exactText);

    // Table news surfaces the exact text
    const afterDoc1 = toldAfter(doc1, NOTHING_TOLD, { turn: 'h-hero', refused: false });
    const afterDoc2 = toldAfter(parsed, afterDoc1.told, { turn: 'h-hero', refused: true });
    expect(afterDoc2.news).toContainEqual({ kind: 'refused', reason: 'hp', text: exactText });

    // Player's TurnHold releases back to 'free' when the refusal doc arrives with a new updatedAt
    const picking = turnHoldStep(TURN_FREE, { kind: 'tap', via: 'turn' }).hold;
    const sentHold = turnHoldStep(picking, { kind: 'posted', from: '2026-11-28T00:00:00Z', id: 'ev-1' }).hold;
    expect(sentHold.at).toBe('sent');
    const afterRefusal = turnHoldStep(sentHold, { kind: 'doc', at: '2026-11-28T00:00:01Z' }).hold;
    expect(afterRefusal.at).toBe('free');

    // Player-side docCantAfford detects the shortfall upfront before sending anything
    const me = parsed.rows.find(r => r.id === heroId)!;
    const pre = docCantAfford(parsed, me, 'E', { mana: 100, sheet: { costCut: 0 } }, hemoPool, RULES);
    expect(pre).toBe(exactText);
    expect(TABLE_REFUSAL_WORDS.notNow.length).toBeGreaterThan(0);
    expect(TABLE_REFUSAL_WORDS.noChannel.length).toBeGreaterThan(0);

    // The doc has no mana field. A short sheet must not block a use (Arise in adjust-roll-hidden) whose cost the
    // GM's fight row can still pay; the GM refuses a real shortfall without ending the turn.
    const cheapMana = { ...hemoPool, cost: { ...hemoPool.cost, mana: 15 } };
    expect(docCantAfford(parsed, me, 'E', { mana: 0, sheet: { costCut: 0 } }, cheapMana, RULES)).toBeNull();
  });
});
