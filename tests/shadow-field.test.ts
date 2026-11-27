// Shadows rework (Wave 2 PR 1): ownership, field caps, ownerOut/shadowsIn guards, holdsSide, solo cap,
// local & remote shadowHp write-backs (idempotent through setShadowHp), and policy timed-summon counting.
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { newHunter, newSave } from '../src/core/save.ts';
import type { Save } from '../src/core/save.ts';
import { baseStats } from '../src/core/stats.ts';
import { kitGear } from '../src/core/hunter/derive.ts';
import { addShadow, newShadowOf, setShadowHp, stepShadow } from '../src/core/hunter/shadows.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { isRefused, refuse, TOLD } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import { abilityId, combatantId, hunterId } from '../src/core/combat/ability-types.ts';
import { isMinionOf, ownerOf, shadowId } from '../src/core/combat/effect-ops.ts';
import type { Body, Origin } from '../src/core/combat/effect-ops.ts';
import { MAX_FIELD_SHADOWS, reduce, shadowFieldCap } from '../src/core/combat/fight.ts';
import type { Command, Ctx, Fight, NewRow, Opening } from '../src/core/combat/fight.ts';
import { parseFight } from '../src/core/combat/fight-parse.ts';
import { fought } from '../src/core/combat/fight-save.ts';
import { holdsSide } from '../src/core/combat/fight-turn.ts';
import { hunterRow, monsterRows, remoteRow, remoteShadowRow, shadowRow, summonRow } from '../src/core/combat/rows.ts';
import { isUp, rowHp } from '../src/core/combat/row-hp.ts';
import { sensible } from '../src/core/combat/policy.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';
import { place, tiles } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { soloFight } from '../src/core/gates/solo.ts';
import type { SoloTarget } from '../src/core/gates/solo.ts';
import { newEvent, standsFor } from '../src/core/protocol.ts';
import { fightId, parseRoomCode, parseSheetKey, saveId } from '../src/core/ids.ts';
import type { DeviceId, SheetKey } from '../src/core/ids.ts';
import { landAll } from '../src/edge/room-events.ts';
import type { ApplyDeps } from '../src/edge/room-events.ts';
import { day } from './fixtures/ids.ts';

const ok = <T extends object>(v: T): Exclude<T, Refused> => { if (isRefused(v)) throw new Error(`refused: ${v.why}`); return v as Exclude<T, Refused>; };
const ctx: Ctx = { rules: RULES };
const cid = combatantId;
const sk = (s: string): SheetKey => parseSheetKey(s)!;
const fid = fightId('f-sh');
const ROOM = parseRoomCode('ABCD23')!;

const makeHunter = (o: { id?: string; name?: string; pre?: number } = {}) => {
  const h = newHunter(RULES);
  h.id = saveId('h', Number((o.id ?? 'h1').replace(/\D+/g, '') || 1));
  h.name = o.name ?? 'Mira';
  if (o.pre !== undefined) h.stats = { ...h.stats, pre: o.pre };
  return h;
};

const makeShadow = (n: number, name = `Shade ${n}`, summoned = true) => {
  const s = newShadowOf({ rank: 'D', archetype: 'brute', grade: 'Normal', monster: null, name }, saveId('sh', n), RULES);
  return { ...s, summoned };
};

const rat = () => monsterRows(seedMonsters(RULES)[0]!, [cid('m1')], RULES)[0]!;
const add = (...rows: NewRow[]): Command => ({ type: 'add', fightId: fid, rows, openings: [] });
const openings = (...rows: readonly { id: ReturnType<typeof cid> }[]): Opening[] => rows.map((r, i) => ({ id: r.id, d20: 20 - i, tie: i }));

function run(...cmds: Command[]): Fight {
  let f: Fight | null = null;
  for (const cmd of cmds) {
    const r = reduce(f, cmd, ctx);
    const no = r.effects.find(e => e.type === 'refused');
    if (no) throw new Error(`${cmd.type} refused: ${JSON.stringify(no)}`);
    f = r.fight;
  }
  return f!;
}

describe('shadow ownership helpers (ownerOf / isMinionOf)', () => {
  test('ownerOf and isMinionOf unify shadows and summons and return null for hunters and monsters', () => {
    const h = makeHunter();
    const hRow = hunterRow(h, cid('c-h'), RULES);
    const sRow = shadowRow(makeShadow(1), h.id, cid('c-h'), cid('c-s'), RULES);
    const mRow = rat();
    const f = run(add(hRow, sRow, mRow));
    const hunter = f.rows.find(r => r.id === 'c-h')!;
    const shadow = f.rows.find(r => r.id === 'c-s')!;
    const monster = f.rows.find(r => r.id === 'm1')!;
    const sum = summonRow(hunter, { name: 'Sprite', archetype: 'skirmisher', rounds: 3, statuses: [] }, cid('c-u'), tick(0), RULES);
    const sumBody: Body = { ...sum, place: place(2, 2), stats: shadow.stats, sheet: shadow.sheet, speed: shadow.speed, at: tick(0), tie: 0 } as Body;

    expect([ownerOf(hunter), ownerOf(monster), ownerOf(shadow), ownerOf(sumBody)]).toEqual([null, null, cid('c-h'), cid('c-h')]);
    expect([isMinionOf(shadow, cid('c-h')), isMinionOf(sumBody, cid('c-h')), isMinionOf(shadow, cid('m1')), isMinionOf(hunter, cid('c-h'))]).toEqual([true, true, false, false]);
  });
});

describe('core shadow guards (ownerOut, shadowsIn, shadowCap)', () => {
  test('add refuses a shadow whose owning hunter row is not in the fight (ownerOut), and refuses a non-hunter owner', () => {
    const h = makeHunter();
    const s = shadowRow(makeShadow(1), h.id, cid('c-mira'), cid('c-s1'), RULES);
    expect(reduce(null, add(s, rat()), ctx).effects).toEqual([{ type: 'refused', reason: 'ownerOut' }]);

    const fWithMonster = run(add(rat()));
    const badOwner = shadowRow(makeShadow(2), h.id, cid('m1'), cid('c-s2'), RULES);
    expect(reduce(fWithMonster, add(badOwner), ctx).effects).toEqual([{ type: 'refused', reason: 'ownerOut' }]);
  });

  test('add enforces fielded shadows <= min(ownerRow.sheet.shadows, 4) (shadowCap)', () => {
    // Base pre 10 -> sheet.shadows = 2 (< 4)
    const lowPre = makeHunter({ pre: 10 });
    expect(hunterSheet(lowPre, RULES).sheet.shadows).toBe(2);
    expect(shadowFieldCap(2)).toBe(2);
    const fLow = run(add(hunterRow(lowPre, cid('c-low'), RULES), shadowRow(makeShadow(1), lowPre.id, cid('c-low'), cid('s1'), RULES), shadowRow(makeShadow(2), lowPre.id, cid('c-low'), cid('s2'), RULES)));
    expect(reduce(fLow, add(shadowRow(makeShadow(3), lowPre.id, cid('c-low'), cid('s3'), RULES)), ctx).effects).toEqual([{ type: 'refused', reason: 'shadowCap' }]);

    // High pre 50 -> sheet.shadows > 4, bounded by MAX_FIELD_SHADOWS (4)
    const highPre = makeHunter({ pre: 50 });
    expect(hunterSheet(highPre, RULES).sheet.shadows).toBeGreaterThan(MAX_FIELD_SHADOWS);
    expect(shadowFieldCap(hunterSheet(highPre, RULES).sheet.shadows)).toBe(4);
    const four = Array.from({ length: 4 }, (_, i) => shadowRow(makeShadow(i + 1), highPre.id, cid('c-hi'), cid(`sh-${i}`), RULES));
    const fHigh = run(add(hunterRow(highPre, cid('c-hi'), RULES), ...four));
    expect(reduce(fHigh, add(shadowRow(makeShadow(5), highPre.id, cid('c-hi'), cid('sh-4'), RULES)), ctx).effects).toEqual([{ type: 'refused', reason: 'shadowCap' }]);
  });

  test('remove refuses removing a hunter while any of their shadows remain (shadowsIn), then succeeds once shadows are removed', () => {
    const h = makeHunter();
    const rows = [hunterRow(h, cid('c-mira'), RULES), shadowRow(makeShadow(1), h.id, cid('c-mira'), cid('c-s1'), RULES), rat()];
    const inSetup = run(add(...rows));
    expect(reduce(inSetup, { type: 'remove', id: cid('c-mira') }, ctx).effects).toEqual([{ type: 'refused', reason: 'shadowsIn' }]);

    const inRun = run(add(...rows), { type: 'start', openings: openings(...rows) });
    expect(reduce(inRun, { type: 'remove', id: cid('c-mira') }, ctx).effects).toEqual([{ type: 'refused', reason: 'shadowsIn' }]);

    const afterShadowRemoved = run(add(...rows), { type: 'start', openings: openings(...rows) }, { type: 'remove', id: cid('c-s1') }, { type: 'remove', id: cid('c-mira') });
    expect(afterShadowRemoved.rows.some(r => r.id === 'c-mira')).toBe(false);
  });

  test('soloFight caps fielded shadows to min(sheet.shadows, 4) when a hunter has more than 4 summoned shadows', () => {
    let h = makeHunter({ pre: 60 });
    for (let i = 1; i <= 5; i++) {
      h = ok(addShadow(h, makeShadow(i, `Shade ${i}`, false), RULES));
      h = ok(stepShadow(h, saveId('sh', i), { kind: 'summon' }));
    }
    expect(h.shadows.filter(s => s.summoned)).toHaveLength(5);
    const target: SoloTarget = {
      gate: { kind: 'personal', id: saveId('pg', 1) }, name: 'Solo Den', rank: 'E', boss: false,
      monsters: [{ id: saveId('m', 1), monster: seedMonsters(RULES)[0]!, count: 1 }], statuses: {},
    };
    const sf = soloFight(h, target, RULES);
    expect(sf).not.toBeNull();
    const fielded = sf!.fight.rows.filter(r => r.kind === 'shadow');
    expect(fielded).toHaveLength(4);
    expect(fielded.every(r => r.kind === 'shadow' && r.owner === sf!.hunter)).toBe(true);
  });
});

describe('holdsSide and fight termination with shadows (TLA+ rule 9)', () => {
  test('shadows do not hold a side: when the last living hunter falls, the fight ends even if shadows remain up', () => {
    const h = makeHunter();
    const rows = [hunterRow(h, cid('c-mira'), RULES), shadowRow(makeShadow(1), h.id, cid('c-mira'), cid('c-s1'), RULES), rat()];
    const f = run(add(...rows), { type: 'start', openings: openings(...rows) });
    const shadow = f.rows.find(r => r.id === 'c-s1')!;
    expect(holdsSide(shadow, f.rows)).toBe(false);
    expect(holdsSide(f.rows.find(r => r.id === 'c-mira')!, f.rows)).toBe(true);

    const killed = reduce(f, { type: 'adjust', id: cid('c-mira'), hp: -9999 }, ctx);
    expect(killed.fight?.phase).toBe('ended');
    if (killed.fight?.phase === 'ended') {
      expect(killed.fight.summary.winner).toBe('foe');
      expect(isUp(killed.fight.rows.find(r => r.id === 'c-s1')!)).toBe(true);
    }
  });

  test('a shadow keeps fighting if its own hunter falls while another hunter is still up', () => {
    const h1 = makeHunter({ id: 'h1', name: 'Mira' });
    const h2 = makeHunter({ id: 'h2', name: 'Brakk' });
    const rows = [hunterRow(h1, cid('c-mira'), RULES), hunterRow(h2, cid('c-brakk'), RULES), shadowRow(makeShadow(1), h1.id, cid('c-mira'), cid('c-s1'), RULES), rat()];
    const f = run(add(...rows), { type: 'start', openings: openings(...rows) }, { type: 'adjust', id: cid('c-mira'), hp: -9999 });
    expect(f.phase).toBe('running');
    expect(isUp(f.rows.find(r => r.id === 'c-s1')!)).toBe(true);
  });

  test('start refuses a fight where the party has only a dead hunter and a living shadow', () => {
    const dead = makeHunter();
    dead.life = { at: 'dead' };
    const rows = [hunterRow(dead, cid('c-mira'), RULES), shadowRow(makeShadow(1), dead.id, cid('c-mira'), cid('c-s1'), RULES), rat()];
    const setup = run(add(...rows));
    expect(reduce(setup, { type: 'start', openings: openings(...rows) }, ctx).effects).toEqual([{ type: 'refused', reason: 'needBothSides' }]);
  });
});

describe('remote shadow write-back (sendRemoteShadow -> shadowHp -> setShadowHp)', () => {
  test('remoteShadowRow round-trips through parseFight and emits sendRemoteShadow on join, damage, and defeat', () => {
    const dev: DeviceId = 'd-p1' as DeviceId;
    const key = sk(`${dev}:h1`);
    const h = makeHunter({ id: 'h1', name: 'Mira' });
    const sh = makeShadow(1, 'Igris', true);
    const rHunter = remoteRow(h, key, cid('c-mira'), RULES);
    const rShadow = remoteShadowRow(sh, key, cid('c-mira'), cid('c-igris'), RULES);

    const joined = reduce(null, add(rHunter, rShadow, rat()), ctx);
    expect(joined.effects).toContainEqual({ type: 'sendRemoteShadow', remote: key, shadowId: sh.id, hp: sh.hp });
    expect(parseFight(JSON.parse(JSON.stringify(joined.fight)), RULES)).toEqual(joined.fight);

    const started = reduce(joined.fight, { type: 'start', openings: openings(rHunter, rShadow, rat()) }, ctx).fight!;
    const damaged = reduce(started, { type: 'adjust', id: cid('c-igris'), hp: -5 }, ctx);
    expect(damaged.effects).toContainEqual({ type: 'sendRemoteShadow', remote: key, shadowId: sh.id, hp: sh.hp - 5 });

    const fell = reduce(damaged.fight, { type: 'adjust', id: cid('c-igris'), hp: -999 }, ctx);
    expect(fell.effects).toContainEqual({ type: 'sendRemoteShadow', remote: key, shadowId: sh.id, hp: 0 });

    // fight-save.ts posts shadowHp totals under standsFor so a newer HP supersedes an older waiting entry in the outbox.
    const save0 = newSave('d-gm' as DeviceId);
    const ev1 = newEvent('shadowHp', { to: [key], shadowId: sh.id, hp: sh.hp - 5 }, { device: 'd-gm', now: 100, rand: 0.1 })!;
    const ev2 = newEvent('shadowHp', { to: [key], shadowId: sh.id, hp: 0 }, { device: 'd-gm', now: 101, rand: 0.2 })!;
    expect(standsFor(ev1)).toBe(`shadowHp ${key} ${sh.id}`);
    const s1 = ok(fought(save0, damaged, { links: null, room: ROOM, totals: [ev1] }, RULES));
    const s2 = ok(fought(s1, fell, { links: null, room: ROOM, totals: [ev2] }, RULES));
    const queued = (s2.settings.sync.outbox ?? []).filter(e => e.key === `shadowHp ${key} ${sh.id}`);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.letter.kind === 'event' && queued[0]!.letter.event.type === 'shadowHp' && queued[0]!.letter.event.payload.hp).toBe(0);

    // Player phone lands shadowHp idempotently through room-events.ts -> setShadowHp.
    let playerSave: Save = newSave(dev);
    let ph = ok(addShadow(h, makeShadow(1, 'Igris', false), RULES));
    ph = ok(stepShadow(ph, sh.id, { kind: 'summon' }));
    playerSave = { ...playerSave, hunters: [ph] };
    const deps: ApplyDeps = {
      store: { get: () => playerSave },
      once: () => true,
      rules: () => RULES,
      now: () => '2026-11-26T00:00:00.000Z',
      today: () => day('2026-11-26'),
      toast: () => undefined,
      system: () => undefined,
      warn: () => undefined,
      hunter: { fightOf: () => null, granted: () => ({ lines: [], levelup: null, popup: null }), gmHolds: () => refuse(TOLD) },
      stepsDone: () => undefined,
      coinRuled: () => undefined,
    };
    const afterDmg = landAll(playerSave, [], [ev1], deps).save;
    expect(afterDmg.hunters[0]!.shadows[0]).toMatchObject({ id: sh.id, hp: sh.hp - 5, summoned: true });
    // Repeating the same shadowHp with a new event id is idempotent.
    const ev1Copy = newEvent('shadowHp', { to: [key], shadowId: sh.id, hp: sh.hp - 5 }, { device: 'd-gm', now: 102, rand: 0.3 })!;
    expect(landAll(afterDmg, [], [ev1Copy], deps).save.hunters[0]!.shadows[0]).toEqual(afterDmg.hunters[0]!.shadows[0]);

    const afterFall = landAll(afterDmg, [], [ev2], deps).save;
    expect(afterFall.hunters[0]!.shadows[0]).toMatchObject({ id: sh.id, hp: 0, summoned: false });
    const ev2Copy = newEvent('shadowHp', { to: [key], shadowId: sh.id, hp: 0 }, { device: 'd-gm', now: 103, rand: 0.4 })!;
    expect(landAll(afterFall, [], [ev2Copy], deps).save.hunters[0]!.shadows[0]).toEqual(afterFall.hunters[0]!.shadows[0]);
    // Local setShadowHp matches the same contract.
    expect(ok(setShadowHp(ok(setShadowHp(ph, sh.id, 0)), sh.id, 0)).shadows[0]).toMatchObject({ hp: 0, summoned: false });
  });
});

describe('policy.ts timed-summon check with shadows', () => {
  test('a hunter with an active shadow still casts a timed summon, up to kit.summons', () => {
    const callHound = {
      ...abilityOf('support', {
        id: abilityId('call-hound'), name: 'Call Hound', aim: 'self', range: tiles(0), shape: { kind: 'self' },
        effect: null, ops: [],
      }, RULES),
      summon: { name: 'Hound', archetype: 'brute' as const, rounds: 4, statuses: [] },
    };
    const strike = abilityOf('strike', { id: abilityId('strike'), name: 'Strike' }, RULES);
    const origin: Origin = { kind: 'hunter', build: { stats: { ...baseStats(RULES.fight), pre: 15 }, level: 1, gear: kitGear('light', RULES), perks: {} } };
    const h = makeHunter({ pre: 15 });
    const hRow: NewRow = { ...hunterRow(h, cid('c-h'), RULES), origin, abilities: [strike, callHound], mana: 50, place: place(2, 2) };
    const sRow: NewRow = { ...shadowRow(makeShadow(1), h.id, cid('c-h'), cid('c-s1'), RULES), place: place(2, 3) };
    const mRow: NewRow = { ...rat(), place: place(6, 2) };
    const f0 = run(add(hRow, sRow, mRow), { type: 'start', openings: [{ id: cid('c-h'), d20: 20, tie: 0 }, { id: cid('c-s1'), d20: 10, tie: 1 }, { id: cid('m1'), d20: 5, tie: 2 }] });
    expect(f0.phase).toBe('running');
    if (f0.phase !== 'running') return;

    // Shadow is owned by c-h, yet sensible still picks Call Hound because timed summons = 0 < kit.summons (2).
    const c1 = sensible(f0, f0.rows.find(r => r.id === 'c-h')!, RULES);
    expect(c1).toEqual({ type: 'act', ability: callHound, aim: cid('c-h') });

    // After casting 1 timed summon, sensible still casts a 2nd because 1 < kit.summons (2).
    const f1 = run(add(hRow, sRow, mRow), { type: 'start', openings: [{ id: cid('c-h'), d20: 20, tie: 0 }, { id: cid('c-s1'), d20: 10, tie: 1 }, { id: cid('m1'), d20: 5, tie: 2 }] },
      { type: 'act', by: cid('c-h'), ability: callHound.id, aim: cid('c-h'), rolls: { dice: {}, react: {} } });
    if (f1.phase !== 'running') return;
    expect(f1.rows.filter(r => r.kind === 'summon')).toHaveLength(1);
    const c2 = sensible(f1, f1.rows.find(r => r.id === 'c-h')!, RULES);
    expect(c2).toEqual({ type: 'act', ability: callHound, aim: cid('c-h') });
  });
});
