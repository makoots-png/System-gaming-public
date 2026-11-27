// Shared Act 1 "The Empty Seat" simulation helpers (imported by tests/fight-sim.test.ts and tests/npc-sim.test.ts).
import { RULES } from '../../src/core/rules.ts';
import { monsterRows, hunterRow } from '../../src/core/combat/rows.ts';
import { seedMonsters } from '../../src/core/registry/monsters.ts';
import { combatantId } from '../../src/core/combat/ability-types.ts';
import { rowHp } from '../../src/core/combat/row-hp.ts';
import { freshSave, makeHunter } from '../../src/core/save.ts';
import type { Hunter } from '../../src/core/save.ts';
import { starterCampaign } from '../../src/core/starter.ts';
import { confirm, gainXp, raiseMany } from '../../src/core/hunter/progress.ts';
import type { StatPoints } from '../../src/core/hunter/progress.ts';
import { learnSkill } from '../../src/core/hunter/skills-held.ts';
import { equip, putItem } from '../../src/core/hunter/inventory.ts';
import { refill } from '../../src/core/hunter/vitals.ts';
import { hunterSheet } from '../../src/core/hunter/sheet.ts';
import { SHOP_ITEMS, STARTER_GEAR } from '../../src/core/registry/items.ts';
import { refGrant } from '../../src/core/registry/item-book.ts';
import { STARTER_SKILLS, skillOf } from '../../src/core/registry/skills.ts';
import { sensible } from '../../src/core/combat/policy.ts';
import { usable as canUse } from '../../src/core/combat/resolve.ts';
import { isRefused } from '../../src/core/save-step.ts';
import { builtInItemId, saveId, seedId } from '../../src/core/ids.ts';
import type { NewRow } from '../../src/core/combat/fight-types.ts';
import type { Policy, SimRow } from '../models/fight-sim.ts';
import { dev } from './ids.ts';

export const ACT1_AT = '2026-11-26T12:00:00.000Z';
export const HEALTH_POTION_E = SHOP_ITEMS.find(i => i.defId === builtInItemId('health-potion-e'))!;
const ACT1_MONSTERS = seedMonsters(RULES);

export const seedMonster = (slug: string) => {
  const m = ACT1_MONSTERS.find(x => x.id === seedId<'m'>(slug));
  if (!m) throw new Error(`missing seed monster ${slug}`);
  return m;
};

const sensiblePolicy: Policy = (f, me, _plan, R) => sensible(f, me, R);

/** Wraps `sensible` so a Healer holding Mending Aura activates its healing aura when any ally is injured. */
export const missionPolicy: Policy = (f, me, _plan, R) => {
  const aura = me.abilities.find(a => a.id === 'mending-aura');
  const hasOwnZone = f.zones.some(z => z.owner === me.id && (z.until === null || z.until > f.now));
  const anyHurt = f.rows.some(r => r.side === me.side && rowHp(r) > 0 && rowHp(r) < 0.85 * r.sheet.hpMax);
  if (aura && !hasOwnZone && anyHurt && canUse(aura, me, f.rows, me.id, f.grid, f.now, R, f.fog)) {
    return { type: 'act', ability: aura, aim: me.id };
  }
  return sensible(f, me, R);
};

/** Attaches each bag consumable's exact `qty` as a per-fight uses gate so `playFight` never grants infinite potions. */
export function withBagUses(h: Hunter, row: NewRow): NewRow {
  const qtyByItem = new Map(h.items.map(i => [i.id as string, i.qty]));
  return {
    ...row,
    abilities: row.abilities.map(a => {
      const qty = a.item ? qtyByItem.get(a.item as string) : undefined;
      return qty !== undefined ? { ...a, gates: [...(a.gates ?? []), { kind: 'uses' as const, per: 'fight' as const, n: qty }] } : a;
    }),
  };
}

/** Levels `h` to `level` via `gainXp`, spends `extra` ability points, and refills vitals. */
export function advanceHunter(h: Hunter, level: number, extra: StatPoints): Hunter {
  let cur = h;
  while (cur.level < level) {
    const step = gainXp(cur, 1000, RULES);
    cur = { ...cur, ...step.progress };
  }
  if (Object.keys(extra).length > 0) {
    const raised = raiseMany(cur, extra, RULES);
    if (isRefused(raised)) throw new Error(`raiseMany refused for ${cur.name}: ${raised.why}`);
    cur = confirm(raised);
  }
  return { ...cur, ...refill(cur, hunterSheet(cur, RULES).sheet) };
}

/** Gives `h` `qty` copies of Health Potion (E) in its bag. */
export function givePotions(h: Hunter, qty: number, idNum: number): Hunter {
  return putItem(h, refGrant(HEALTH_POTION_E.defId, qty), saveId('i', idNum), RULES);
}

/** Wave 1 (Cannery Tunnels) or Wave 2 (Stone Hall) monsters per the table-scaling rules for `players` hunters. */
export function act1WaveFoes(wave: 1 | 2, players: number): SimRow[] {
  const specs: readonly (readonly [string, number])[] = wave === 1
    ? players <= 2
      ? [['goblin', 1], ['goblin-chief', 1]]
      : players <= 4
        ? [['goblin', 1], ['goblin-shaman', 1], ['goblin-chief', 1]]
        : [['goblin', 2], ['goblin-shaman', 1], ['goblin-chief', 1]]
    : players <= 2
      ? [['head-usher', 1], ['usher', 1]]
      : players <= 4
        ? [['head-usher', 1], ['usher', 2]]
        : [['head-usher', 1], ['usher', 3]];
  const out: SimRow[] = [];
  for (const [slug, count] of specs) {
    const ids = Array.from({ length: count }, (_, i) => combatantId(`${slug}-${i + 1}`));
    for (const row of monsterRows(seedMonster(slug), ids, RULES)) out.push({ row, policy: sensiblePolicy });
  }
  return out;
}

const SAMPLE_L2_POINTS: readonly StatPoints[] = [
  { vit: 2, str: 1 }, // Dolan Kestrel
  { agi: 2, ctl: 1 }, // Nadia Cho
  { pre: 2, dis: 1 }, // Bram Halstead
  { pow: 2, ctl: 1 }, // Tessa Corbin
  { str: 2, vit: 1 }, // 5th sample hunter (Bruiser)
  { agi: 2, str: 1 }, // 6th sample hunter (Ranger)
];

/** Builds 1..6 sample hunters from `starterCampaign` (with Tessa's 12 points spent and Chapter 1's 2 potions). */
export function act1SampleParty(players: number, level: 1 | 2 = 1): SimRow[] {
  const env = { now: new Date(ACT1_AT), newDeviceId: () => dev('d-act1'), newDeviceToken: () => 'tok-act1-1234567890' };
  const s = starterCampaign(freshSave(env, { onboarded: true }), { at: ACT1_AT, cap: RULES.logCap }, RULES);
  if (isRefused(s)) throw new Error(`starterCampaign refused: ${s.why}`);
  let seq = s.seq + 100;
  const base: Hunter[] = s.hunters.map(h => {
    let cur = h;
    if (cur.name === 'Tessa Corbin') {
      const raised = raiseMany(cur, { pow: 8, ctl: 4 }, RULES);
      if (isRefused(raised)) throw new Error(`Tessa raiseMany refused: ${raised.why}`);
      cur = confirm(raised);
      cur = { ...cur, ...refill(cur, hunterSheet(cur, RULES).sheet) };
    }
    return givePotions(cur, 2, ++seq);
  });

  // 5th and 6th hunters for 5-6 player tables.
  const extras: readonly { name: string; stats: StatPoints; skill: typeof STARTER_SKILLS.markedShot | null; bow: boolean }[] = [
    { name: 'Kira Sol', stats: { str: 8, vit: 4 }, skill: null, bow: false },
    { name: 'Orin Vale', stats: { agi: 8, str: 4 }, skill: STARTER_SKILLS.markedShot, bow: true },
  ];
  for (const ex of extras) {
    const made = makeHunter({ seq: ++seq, settings: s.settings }, ex.name, RULES, new Date(ACT1_AT));
    seq = made.seq;
    const raised = raiseMany(made.hunter, ex.stats, RULES);
    if (isRefused(raised)) throw new Error(`extra raiseMany refused: ${raised.why}`);
    let h = confirm(raised);
    if (ex.skill) h = learnSkill(h, { ...skillOf(ex.skill, RULES), label: 'Lv.1' }, saveId('s', ++seq));
    if (ex.bow) {
      const bowId = saveId('i', ++seq);
      h = putItem(h, refGrant(STARTER_GEAR.huntingBow.defId), bowId, RULES);
      const eq = equip(h, bowId, bowId, false, RULES);
      if (!isRefused(eq)) h = eq;
    }
    h = givePotions(h, 3, ++seq);
    h = { ...h, ...refill(h, hunterSheet(h, RULES).sheet) };
    base.push(h);
  }

  // For 1p sample solo testing, pick Nadia (balanced starter damage); for 2..6p take in party order.
  const picked = players === 1 ? [base[1]!] : base.slice(0, players);
  return picked.map((h0, idx) => {
    const l2Idx = players === 1 ? 1 : idx;
    const h = level === 2 ? advanceHunter(h0, 2, SAMPLE_L2_POINTS[l2Idx]!) : h0;
    return { row: withBagUses(h, hunterRow(h, combatantId(`sample-${idx + 1}`), RULES)), policy: missionPolicy };
  });
}

const BARE_BUILDS: readonly { readonly l1: StatPoints; readonly l2: StatPoints }[] = [
  { l1: { str: 8, vit: 4 }, l2: { str: 2, vit: 1 } },
  { l1: { vit: 8, str: 4 }, l2: { str: 2, vit: 1 } },
  { l1: { str: 6, vit: 6 }, l2: { str: 2, vit: 1 } },
  { l1: { str: 8, agi: 4 }, l2: { str: 2, agi: 1 } },
  { l1: { vit: 6, str: 6 }, l2: { str: 2, vit: 1 } },
  { l1: { str: 8, dis: 4 }, l2: { str: 2, dis: 1 } },
];

/** Builds 1..6 bare player-made hunters (no gear, no skills) with creation points spent and Chapter 1's 2 Health Potions (E). */
export function act1BareParty(players: number, level: 1 | 2 = 1): SimRow[] {
  const env = { now: new Date(ACT1_AT), newDeviceId: () => dev('d-bare'), newDeviceToken: () => 'tok-bare-1234567890' };
  const s = freshSave(env, { onboarded: true });
  let seq = s.seq + 200;
  return Array.from({ length: players }, (_, i) => {
    const spec = BARE_BUILDS[i]!;
    const made = makeHunter({ seq: ++seq, settings: s.settings }, `Player ${i + 1}`, RULES, new Date(ACT1_AT));
    seq = made.seq;
    const raised = raiseMany(made.hunter, spec.l1, RULES);
    if (isRefused(raised)) throw new Error(`bare raiseMany refused: ${raised.why}`);
    let h = confirm(raised);
    h = givePotions(h, 2, ++seq);
    h = { ...h, ...refill(h, hunterSheet(h, RULES).sheet) };
    if (level === 2) h = advanceHunter(h, 2, spec.l2);
    return { row: withBagUses(h, hunterRow(h, combatantId(`bare-${i + 1}`), RULES)), policy: missionPolicy };
  });
}
