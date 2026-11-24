// Adversarial repros for clear-preset (git diff 2f36d5a2..HEAD).
// Each test asserts the behavior required by the intent and fails against the current code.
import { describe, expect, test } from 'bun:test';
import { PRESET_WORDS, gatePreset, parseClearPreset, presetStep } from '../src/core/gates/preset.ts';
import { parseGate } from '../src/core/gates/gate.ts';
import { settleClearPreset } from '../src/core/gates/pay.ts';
import type { Payee } from '../src/core/gates/pay.ts';
import { editGate } from '../src/core/gates/world.ts';
import { SOLO_REFUSAL_WORDS, soloAnswerBody, soloFight, soloKey, soloPlan, soloRan, soloReady, soloTaken } from '../src/core/gates/solo.ts';
import type { ReadyCtx, SoloGate, SoloRun } from '../src/core/gates/solo.ts';
import type { RunEnd } from '../src/core/combat/odds.ts';
import { parsePresetLineId, parseRoomCode, parseSheetKey, presetLineId } from '../src/core/ids.ts';
import type { GateId, HunterId, MonsterId } from '../src/core/ids.ts';
import { parseItem } from '../src/core/registry/items.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';
import { pendingOf, waitingIn } from '../src/core/hunter/pending.ts';
import { STASH_LINES, newEvent } from '../src/core/protocol.ts';
import { isEmptyReward } from '../src/core/rewards.ts';
import { RULES } from '../src/core/rules.ts';
import { freshSave } from '../src/core/save.ts';
import type { Save } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import type { Refused } from '../src/core/save-step.ts';
import type { DayKey } from '../src/core/day.ts';
import { den } from './models/gate-events.ts';
import { dev, gid } from './fixtures/ids.ts';

const ok = <T>(r: T | Refused): T => { if (isRefused(r)) throw new Error(`refused: ${r.why}`); return r as T; };
const AT = '2026-11-22T20:00:00.000Z';
const TODAY = '2026-11-22' as DayKey;
const DAY = { at: AT, today: TODAY, R: RULES };
const STAMP = { at: AT, cap: RULES.logCap };
const ROOM = parseRoomCode('ABC234')!;
const KAI = parseSheetKey('d-p1:h1')!;
const POTION = parseItem({ name: 'Health Potion', type: 'consumable', rar: 'common' })!;
const SWORD = parseItem({ name: 'Iron Blade', type: 'weapon', slot: 'weapon', dice: '1d8', rar: 'uncommon' })!;
const xpOf = (id: string): number => (id === 'm-goblin' ? 25 : id === 'm-hob' ? 75 : 0);

const baseSave = (): Save => {
  const s = freshSave({ now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-gm') }, { onboarded: true });
  const h0 = s.hunters[0]!;
  const h1 = { ...h0, id: 'h2' as HunterId, name: 'Brakk' };
  return { ...s, hunters: [h0, h1], gates: [den('detected')] };
};

const fullStash = () => ({
  gold: 0,
  items: Array.from({ length: STASH_LINES }, (_, i) => ({
    ...parseItem({ name: `Token ${i}`, type: 'misc' })!,
    id: `i${900 + i}` as never,
    qty: 1,
  })),
});

describe('clear-preset adversarial repros', () => {
  test('F1: settleClearPreset throws (matching noted, never silently skipping a remote payee) when newEventId returns null', () => {
    const s0 = baseSave();
    const s1 = ok(gatePreset(s0, gid('g-den'), {
      type: 'recommend', xp: 220, gold: 120,
      items: [{ id: presetLineId(1), item: POTION, checked: true, to: null }],
    }));
    const payees: Payee[] = [{ kind: 'remote', key: KAI, name: 'Kai' }];
    // Invalid device char ':' causes newEventId() to return null
    const badRoom = { code: ROOM, stamp: { device: 'bad:dev', now: 1000, rand: 0.25 }, ranks: new Map([[KAI, 'E' as const]]) };
    expect(() => settleClearPreset(s1, gid('g-den'), xpOf, payees, badRoom, DAY)).toThrow();
    expect(s1.gates[0]!.status).toBe('detected');
    expect(s1.gates[0]!.preset.at).toBe('recommended');
  });

  test('F1b: settleClearPreset must not drop second remote payee or collide EventIds when stamp.now is MAX_SAFE_INTEGER', () => {
    const s0 = baseSave();
    const h0 = s0.hunters[0]!, h1 = s0.hunters[1]!;
    const SERA = parseSheetKey('d-p2:h1')!;
    const s1 = ok(gatePreset(s0, gid('g-den'), {
      type: 'recommend', xp: 220, gold: 120, items: [],
    }));
    const payees: Payee[] = [
      { kind: 'local', hid: h0.id, name: h0.name },
      { kind: 'local', hid: h1.id, name: h1.name },
      { kind: 'remote', key: KAI, name: 'Kai' },
      { kind: 'remote', key: SERA, name: 'Sera' },
    ];
    // Number.MAX_SAFE_INTEGER + 2 === Number.MAX_SAFE_INTEGER + 3 in float64 -> seq separates EventIds cleanly
    const room = { code: ROOM, stamp: { device: 'd-gm', now: Number.MAX_SAFE_INTEGER, rand: 0.25 }, ranks: new Map([[KAI, 'E' as const], [SERA, 'D' as const]]) };
    const res = ok(settleClearPreset(s1, gid('g-den'), xpOf, payees, room, DAY));

    const outboxEvents = (res.save.settings.sync.outbox ?? []).flatMap(e => (e.letter.kind === 'event' ? [e.letter.event] : []));
    expect({
      grantedIds: res.granted.map(g => g.hid),
      remotePaid: res.remotePaid.map(r => r.name),
      outboxTypes: outboxEvents.map(e => e.type),
      distinctEids: new Set(outboxEvents.map(e => e.payload.eid)).size,
      savedWaiting: waitingIn(res.save, ROOM),
    }).toEqual({
      grantedIds: [h0.id, h1.id],
      remotePaid: ['Kai', 'Sera'],
      outboxTypes: ['award', 'noted', 'award', 'noted'],
      distinctEids: 4,
      savedWaiting: [],
    });
  });

  test('F2: clearing a preset gate with no hunters selected still stashes checked items, marks preset paid, and says nobody got XP or gold', () => {
    const s0 = baseSave();
    const s1 = ok(gatePreset(s0, gid('g-den'), {
      type: 'recommend', xp: 220, gold: 120,
      items: [{ id: presetLineId(1), item: POTION, checked: true, to: null }],
    }));
    const out = ok(settleClearPreset(s1, gid('g-den'), xpOf, [], null, DAY));
    const paidPreset = out.save.gates[0]!.preset;

    expect({
      granted: out.granted.length,
      stashed: out.stashed.length,
      xpPaid: out.save.gates[0]!.xpPaid,
      presetAt: paidPreset.at,
      log: out.save.log.find(l => l.kind === 'gate')!.text,
      summary: paidPreset.at === 'paid' ? PRESET_WORDS.summary(paidPreset, true, String) : '',
    }).toEqual({
      granted: 0,
      stashed: 1,
      xpPaid: 0,
      presetAt: 'paid',
      log: 'E-rank gate "Goblin Den" cleared. No one rewarded: +0 XP, 0 gold, Health Potion.',
      summary: 'Clear rewards given: nobody got XP or gold, 1 item, 1 to the stash',
    });
  });

  test('F3: reopening a paid-preset gate in Edit must not allow soloRan to roll loot and pay a second time', () => {
    const goblin = seedMonsters(RULES).find(m => m.name === 'Goblin')!.id as MonsterId;
    const s0 = baseSave();
    const h = s0.hunters[0]!;
    const soloGate = { ...den('detected'), solo: true, monsters: [{ monsterId: goblin, count: 1 }], bossId: null };
    const withPreset = ok(gatePreset({ ...s0, gates: [soloGate] }, soloGate.id, {
      type: 'recommend', xp: 200, gold: 100,
      items: [{ id: presetLineId(1), item: SWORD, checked: true, to: { kind: 'local', hunterId: h.id } }],
    }));

    const first = ok(settleClearPreset(withPreset, soloGate.id, xpOf, [{ kind: 'local', hid: h.id, name: h.name }], null, DAY));
    const goldAfterFirst = first.save.hunters[0]!.gold;
    const itemsAfterFirst = first.save.hunters[0]!.items.length;

    const reopened = ok(editGate(first.save, soloGate.id, {
      name: soloGate.name, rank: soloGate.rank, type: soloGate.type, breakDay: soloGate.breakDay,
      monsters: soloGate.monsters, bossId: soloGate.bossId, notes: soloGate.notes, mapId: soloGate.mapId,
      status: 'detected', solo: true,
    }, STAMP));

    const targetGate: SoloGate = { kind: 'world', id: soloGate.id };
    const readyCtx: ReadyCtx = { R: RULES, route: 'local', held: false, nowMs: Date.parse(AT) };
    const ready = ok(soloReady(reopened, h.id, targetGate, readyCtx));
    const fight = soloFight(ready.h, ready.target, RULES)!;
    const end: RunEnd = {
      outcome: 'won', rounds: 2, commands: 4, spent: [],
      party: { [fight.hunter]: { hp: 20, mana: 5, fatigue: 0, statuses: [], used: {}, life: 'up', lifeLeft: { at: 'up', hp: 20 }, kills: [] } },
    };
    const run: SoloRun = { end, hunter: fight.hunter, shadows: fight.shadows, from: soloKey(ready.h), route: 'local' };
    const second = soloRan(reopened, h.id, targetGate, run, { gold: 500, items: [POTION] }, { day: DAY, ready: readyCtx });

    if (!isRefused(second)) {
      const hAfter = second.save.hunters[0]!;
      expect({
        extraGoldPaid: hAfter.gold - goldAfterFirst,
        extraItemsPaid: hAfter.items.length - itemsAfterFirst,
      }).toEqual({ extraGoldPaid: 0, extraItemsPaid: 0 });
    }
  });

  test('F3b: reopening a paid-preset gate in Edit must not allow soloTaken to roll loot and queue a second reward', () => {
    const goblin = seedMonsters(RULES).find(m => m.name === 'Goblin')!.id as MonsterId;
    const s0 = baseSave();
    const h = s0.hunters[0]!;
    const soloGate = { ...den('detected'), solo: true, monsters: [{ monsterId: goblin, count: 1 }], bossId: null };
    const withPreset = ok(gatePreset({ ...s0, gates: [soloGate] }, soloGate.id, {
      type: 'recommend', xp: 200, gold: 100, items: [],
    }));
    const first = ok(settleClearPreset(withPreset, soloGate.id, xpOf, [{ kind: 'local', hid: h.id, name: h.name }], null, DAY));
    const reopened = ok(editGate(first.save, soloGate.id, {
      name: soloGate.name, rank: soloGate.rank, type: soloGate.type, breakDay: soloGate.breakDay,
      monsters: soloGate.monsters, bossId: soloGate.bossId, notes: soloGate.notes, mapId: soloGate.mapId,
      status: 'detected', solo: true,
    }, STAMP));

    const paidRun = { eid: 'd-p1-run2' as never, by: KAI, gate: soloGate.id as GateId, name: 'Kai', outcome: 'won' as const, rounds: 3, life: 'up' as const };
    const plan = soloPlan(reopened, paidRun, RULES);
    const body = soloAnswerBody(reopened, paidRun.eid, paidRun, plan);
    const answer = body ? newEvent('soloAnswer', body, { device: 'd-gm', now: 2000, rand: 0.2 }) : null;
    const res = soloTaken(reopened, paidRun, plan, answer, { gold: 400, items: [POTION] }, {
      day: DAY, room: { code: ROOM, stamp: { device: 'd-gm', now: 2000, rand: 0.5 } }, rank: 'E',
    });

    if (!isRefused(res)) {
      expect(waitingIn(res, ROOM).map(p => ({ gold: p.rewards.gold, items: p.rewards.items.map(i => i.name) }))).toEqual([]);
    }
  });

  test('F4: soloRan stash-full refusal has user-facing words in SOLO_REFUSAL_WORDS (gates.js ui.wrote)', () => {
    const goblin = seedMonsters(RULES).find(m => m.name === 'Goblin')!.id as MonsterId;
    const s0 = baseSave();
    const h = s0.hunters[0]!;
    const soloGate = { ...den('detected'), solo: true, monsters: [{ monsterId: goblin, count: 1 }], bossId: null };
    const withPreset = ok(gatePreset({ ...s0, gates: [soloGate], stash: fullStash() }, soloGate.id, {
      type: 'recommend', xp: 200, gold: 100,
      items: [{ id: presetLineId(1), item: POTION, checked: true, to: null }],
    }));

    const targetGate: SoloGate = { kind: 'world', id: soloGate.id };
    const readyCtx: ReadyCtx = { R: RULES, route: 'local', held: false, nowMs: Date.parse(AT) };
    const ready = ok(soloReady(withPreset, h.id, targetGate, readyCtx));
    const fight = soloFight(ready.h, ready.target, RULES)!;
    const end: RunEnd = {
      outcome: 'won', rounds: 2, commands: 4, spent: [],
      party: { [fight.hunter]: { hp: 20, mana: 5, fatigue: 0, statuses: [], used: {}, life: 'up', lifeLeft: { at: 'up', hp: 20 }, kills: [] } },
    };
    const run: SoloRun = { end, hunter: fight.hunter, shadows: fight.shadows, from: soloKey(ready.h), route: 'local' };
    const res = soloRan(withPreset, h.id, targetGate, run, { gold: 0, items: [] }, { day: DAY, ready: readyCtx });

    expect(res).toEqual({ ok: false, why: 'stash-full' });
    expect((SOLO_REFUSAL_WORDS as Record<string, string>)['stash-full']).toBeDefined();
  });

  test('F4b: soloTaken on a preset gate when stash is full refuses with no soloAnswer (stranding the player in waiting)', () => {
    const goblin = seedMonsters(RULES).find(m => m.name === 'Goblin')!.id as MonsterId;
    const s0 = baseSave();
    const soloGate = { ...den('detected'), solo: true, monsters: [{ monsterId: goblin, count: 1 }], bossId: null };
    const withPreset = ok(gatePreset({ ...s0, gates: [soloGate], stash: fullStash() }, soloGate.id, {
      type: 'recommend', xp: 200, gold: 100,
      items: [{ id: presetLineId(1), item: POTION, checked: true, to: null }],
    }));

    const paidRun = { eid: 'd-p1-run-full' as never, by: KAI, gate: soloGate.id as GateId, name: 'Kai', outcome: 'won' as const, rounds: 3, life: 'up' as const };
    const plan = soloPlan(withPreset, paidRun, RULES);
    const body = soloAnswerBody(withPreset, paidRun.eid, paidRun, plan)!;
    const answer = newEvent('soloAnswer', body, { device: 'd-gm', now: 2500, rand: 0.2 })!;
    const res = soloTaken(withPreset, paidRun, plan, answer, { gold: 0, items: [] }, {
      day: DAY, room: { code: ROOM, stamp: { device: 'd-gm', now: 2500, rand: 0.5 } }, rank: 'E',
    });

    // Returning Refused inside sync().once() leaves no soloAnswer in outbox and advances the GM poll cursor past paidRun
    expect(isRefused(res)).toBe(false);
  });

  test('F5: soloTaken with empty personal share (0 XP, 0 gold, item only to stash) must not queue an un-approvable empty PendingReward', () => {
    const goblin = seedMonsters(RULES).find(m => m.name === 'Goblin')!.id as MonsterId;
    const s0 = baseSave();
    const soloGate = { ...den('detected'), solo: true, monsters: [{ monsterId: goblin, count: 1 }], bossId: null };
    const withPreset = ok(gatePreset({ ...s0, gates: [soloGate] }, soloGate.id, {
      type: 'recommend', xp: 0, gold: 0,
      items: [{ id: presetLineId(1), item: POTION, checked: true, to: null }],
    }));

    const paidRun = { eid: 'd-p1-run3' as never, by: KAI, gate: soloGate.id as GateId, name: 'Kai', outcome: 'won' as const, rounds: 3, life: 'up' as const };
    const plan = soloPlan(withPreset, paidRun, RULES);
    const body = soloAnswerBody(withPreset, paidRun.eid, paidRun, plan)!;
    const answer = newEvent('soloAnswer', body, { device: 'd-gm', now: 3000, rand: 0.2 })!;
    const out = ok(soloTaken(withPreset, paidRun, plan, answer, { gold: 0, items: [] }, {
      day: DAY, room: { code: ROOM, stamp: { device: 'd-gm', now: 3000, rand: 0.5 } }, rank: 'E',
    }));

    expect(out.stash.items.map(i => i.name)).toEqual(['Health Potion']);
    expect(pendingOf(out).filter(r => isEmptyReward(r.rewards))).toEqual([]);
  });

  test('F6: addItem on a parsed preset holding max valid 6-digit id pl999999 must produce a parseable PresetLineId that survives save/reload', () => {
    const rawGate = {
      ...den('detected'),
      preset: {
        at: 'edited', xp: 100, gold: 50,
        items: [{ id: 'pl999999', item: POTION, checked: true, to: null }],
      },
    };
    const parsed = parseGate(rawGate)!;
    expect(parsed.preset.at === 'edited' && parsed.preset.items.map(i => i.id)).toEqual(['pl999999']);

    const added = presetStep(parsed.preset, { type: 'addItem', item: SWORD, to: null })!;
    expect(added.at === 'edited' && added.items).toHaveLength(2);
    const newId = added.at === 'edited' ? added.items[1]!.id : '';
    const reloaded = parseClearPreset(JSON.parse(JSON.stringify(added)));

    expect({
      mintedId: newId,
      parsedBack: parsePresetLineId(newId),
      reloadedItems: reloaded.at === 'edited' ? reloaded.items.map(i => i.item.name) : [],
    }).toEqual({
      mintedId: newId,
      parsedBack: newId,
      reloadedItems: ['Health Potion', 'Iron Blade'],
    });
  });

  test('F7: paid preset summary and item record must reflect Party stash when assigned hunter was not picked at Clear', () => {
    const s0 = baseSave();
    const mira = s0.hunters[0]!, brakk = s0.hunters[1]!;
    const s1 = ok(gatePreset(s0, gid('g-den'), {
      type: 'recommend', xp: 200, gold: 100,
      items: [{ id: presetLineId(1), item: SWORD, checked: true, to: { kind: 'local', hunterId: brakk.id } }],
    }));

    // Clear with only Mira selected; Brakk is NOT picked, so Iron Blade goes to Party stash
    const out = ok(settleClearPreset(s1, gid('g-den'), xpOf, [{ kind: 'local', hid: mira.id, name: mira.name }], null, DAY));
    expect(out.stashed.map(i => i.name)).toEqual(['Iron Blade']);
    expect(out.save.hunters.find(x => x.id === brakk.id)!.items.map(i => i.name)).not.toContain('Iron Blade');

    const paidPreset = out.save.gates[0]!.preset;
    expect(paidPreset.at).toBe('paid');
    if (paidPreset.at === 'paid') {
      expect({
        recordedTo: paidPreset.items[0]!.to,
        summary: PRESET_WORDS.summary(paidPreset, true, String),
      }).toEqual({
        recordedTo: null,
        summary: 'Clear rewards given: 200 XP, 100 gold, 1 item, 1 to the stash',
      });
    }
  });
});
