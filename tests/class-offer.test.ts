// Unit tests for PR 6: first-mission & GM unique-class offer, DOCS.classOffer / classPick, pacing/chase,
// and grant.ts / gmAward / storyMove / pendingApproveAll unique rewards.job refusal routing.
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { exportedSave, freshSave, newHunter, repairSave } from '../src/core/save.ts';
import type { Save } from '../src/core/save.ts';
import type { EventId, FightId, GateId, GmKey, HunterId, RoomCode, SheetKey, StoryRunId } from '../src/core/ids.ts';
import { parseDeviceId, sheetKeyOf } from '../src/core/ids.ts';
import { STARTER_GATE, starterCampaign } from '../src/core/starter.ts';
import { newGate, parseGate, shownOf } from '../src/core/gates/gate.ts';
import { planEncounter, settleEncounter } from '../src/core/gates/pay.ts';
import { reduce as fightReduce } from '../src/core/combat/fight.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';
import { newRewards } from '../src/core/rewards.ts';
import { WAVE1_EPIC_OFFER, WAVE1_MYTHIC_OFFER, WAVE1_OFFER_POOL } from '../src/core/hunter/class-locker.ts';
import { claimUniqueClass, holderOf } from '../src/core/hunter/class-holders.ts';
import {
  OFFER_WORDS,
  bestFitClasses,
  classOfferDocOf,
  classOfferView,
  classTakenLine,
  closeClassOffer,
  openClassOffer,
  pickAnswered,
  pickClassFromOffer,
  pickRefusedLine,
} from '../src/core/hunter/class-offer.ts';
import { grant, uniqueJobRefusalText } from '../src/core/hunter/grant.ts';
import { gmAward } from '../src/core/award.ts';
import { storyMove } from '../src/core/story/run.ts';
import { pendingApproveAll, pendingEdited, pendingHeard } from '../src/core/hunter/pending.ts';
import { DOCS, classOfferFor, parseEvent, wireDocs } from '../src/core/protocol.ts';
import { boot, paceOf, reduce as linkReduce } from '../src/core/sync/link.ts';
import { isRefused } from '../src/core/save-step.ts';
import { day, dev, room } from './fixtures/ids.ts';

const AT = '2026-11-25T12:00:00.000Z';
const ENV = { now: new Date(AT), newDeviceId: () => dev('d-gm'), newDeviceToken: () => 'tok-gm-1234567890' };
const ROOM = room('ABCDEF');
const GM_KEY = 'gmkey-1234567890abcd' as GmKey;
let stampCounter = 1;
const nextStamp = () => ({ device: dev('d-gm'), now: 1732536000000 + (++stampCounter) * 1000, rand: 1234 + stampCounter });
const MIRA_DEV = parseDeviceId('d-mira')!;
const KAEL_DEV = parseDeviceId('d-kael')!;
const MIRA_KEY: SheetKey = sheetKeyOf(MIRA_DEV, 'h1' as HunterId);
const KAEL_KEY: SheetKey = sheetKeyOf(KAEL_DEV, 'h1' as HunterId);
const D3_KEY: SheetKey = sheetKeyOf(parseDeviceId('d-p3')!, 'h1' as HunterId);
const D4_KEY: SheetKey = sheetKeyOf(parseDeviceId('d-p4')!, 'h1' as HunterId);
const D5_KEY: SheetKey = sheetKeyOf(parseDeviceId('d-p5')!, 'h1' as HunterId);
const D6_KEY: SheetKey = sheetKeyOf(parseDeviceId('d-p6')!, 'h1' as HunterId);
const D7_KEY: SheetKey = sheetKeyOf(parseDeviceId('d-p7')!, 'h1' as HunterId);

function gmSave(): Save {
  const base = freshSave(ENV, { onboarded: true });
  const s = starterCampaign(base, { at: AT, cap: RULES.logCap }, RULES);
  if (isRefused(s)) throw new Error(`starterCampaign refused: ${s.why}`);
  return { ...s, settings: { ...s.settings, mode: 'gm', sync: { ...s.settings.sync, room: ROOM, gmKey: GM_KEY } } };
}

const holderCtx = (
  roomCode: RoomCode | null = ROOM,
  heldLocal: (hid: HunterId) => boolean = () => false,
  heldRemote: (key: SheetKey) => boolean = () => false,
) => ({
  at: AT,
  room: roomCode,
  stamp: roomCode ? nextStamp() : null,
  R: RULES,
  heldLocal,
  heldRemote,
});

describe('starter Tidewall Cannery Gate classOffer gate field & boss-fall trigger', () => {
  test('starter Tidewall Cannery Gate carries classOffer: true, new gates default false, and parseGate/shownOf handle it cleanly', () => {
    const s = gmSave();
    const den = s.gates.find(g => g.name === STARTER_GATE.name);
    expect(den?.classOffer).toBe(true);
    expect(den?.bossId).toBe(STARTER_GATE.bossId);
    expect(newGate().classOffer).toBe(false);

    const g0 = { ...newGate(), id: 'g99' as GateId, name: 'Custom Den', classOffer: true };
    expect(g0.classOffer).toBe(true);
    expect(parseGate(JSON.parse(JSON.stringify(g0)))?.classOffer).toBe(true);
    expect('classOffer' in shownOf(g0, 1)).toBe(false);
  });

  test('settleEncounter signals offerClasses only after the gate boss falls, openClassOffer fallback checks bossFell, and OFFER_WORDS copy is neutral', () => {
    const s0 = gmSave();
    const den = s0.gates.find(g => g.name === STARTER_GATE.name)!;
    const h0 = s0.hunters[0]!;
    const seeds = seedMonsters(RULES);
    const boss = seeds.find(m => m.id === den.bossId)!;
    const otherMob = seeds.find(m => m.id !== boss.id)!;
    const ctx = { rules: RULES };
    const rows1 = [
      hunterRow(h0, combatantId('c1'), RULES),
      ...monsterRows(otherMob, [combatantId('c2')], RULES),
    ];
    const f1Add = fightReduce(null, { type: 'add', fightId: 'f1' as FightId, rows: rows1, openings: [] }, ctx).fight!;
    const f1Start = fightReduce(f1Add, { type: 'start', openings: [{ id: combatantId('c1'), d20: 15, tie: 0 }, { id: combatantId('c2'), d20: 5, tie: 0 }] }, ctx).fight!;
    const f1End = fightReduce(f1Start, { type: 'end' }, ctx).fight!;
    if (f1End.phase !== 'ended') throw new Error('expected ended fight');
    const f1Ended = { ...f1End, summary: { ...f1End.summary, down: [combatantId('c2')] } };

    // Fight 1 defeats a non-boss monster: bossFell remains false and offerClasses is null.
    const sFight1: Save = { ...s0, fight: f1Ended, fightRefs: { gate: den.id, monsters: { [combatantId('c2')]: otherMob.id } } };
    const plan1 = planEncounter(f1Ended, den.id, sFight1, 3, () => 25);
    const settled1 = settleEncounter(
      sFight1,
      plan1,
      'skip',
      { room: null, events: [] },
      { at: AT, today: day('2026-11-25'), R: RULES },
      { gold: 0, items: [] },
    );
    expect(isRefused(settled1)).toBe(false);
    if (isRefused(settled1)) return;
    expect(settled1.save.gates.find(g => g.id === den.id)?.bossFell).toBe(false);
    expect(settled1.offerClasses).toBeNull();

    // Opening an ad-hoc offer (no gateId) after Fight 1 leaves den.classOffer intact because bossFell is still false.
    const adHoc = openClassOffer(settled1.save, { at: AT, room: ROOM, R: RULES });
    expect(adHoc.save.gates.find(g => g.id === den.id)?.classOffer).toBe(true);
    const adHocClosed = closeClassOffer(adHoc.save, { at: AT, R: RULES });
    if (isRefused(adHocClosed)) throw new Error(adHocClosed.why);

    // Fight 2 defeats the gate boss (Head Usher): bossFell flips true and offerClasses signals den.id.
    const rows2 = [
      hunterRow(h0, combatantId('c3'), RULES),
      ...monsterRows(boss, [combatantId('c4')], RULES),
    ];
    const f2Add = fightReduce(null, { type: 'add', fightId: 'f2' as FightId, rows: rows2, openings: [] }, ctx).fight!;
    const f2Start = fightReduce(f2Add, { type: 'start', openings: [{ id: combatantId('c3'), d20: 15, tie: 0 }, { id: combatantId('c4'), d20: 5, tie: 0 }] }, ctx).fight!;
    const f2End = fightReduce(f2Start, { type: 'end' }, ctx).fight!;
    if (f2End.phase !== 'ended') throw new Error('expected ended fight');
    const f2Ended = { ...f2End, summary: { ...f2End.summary, down: [combatantId('c4')] } };

    const sFight2: Save = { ...adHocClosed, fight: f2Ended, fightRefs: { gate: den.id, monsters: { [combatantId('c4')]: boss.id } } };
    const plan2 = planEncounter(f2Ended, den.id, sFight2, 3, () => 25);
    const settled2 = settleEncounter(
      sFight2,
      plan2,
      'skip',
      { room: null, events: [] },
      { at: AT, today: day('2026-11-25'), R: RULES },
      { gold: 0, items: [] },
    );
    expect(isRefused(settled2)).toBe(false);
    if (isRefused(settled2)) return;
    expect(settled2.save.gates.find(g => g.id === den.id)?.bossFell).toBe(true);
    expect(settled2.offerClasses).toBe(den.id);

    // Fallback openClassOffer (no gateId) clears den.classOffer once bossFell is true.
    const openedFallback = openClassOffer(settled2.save, { at: AT, room: ROOM, R: RULES });
    expect(openedFallback.save.gates.find(g => g.id === den.id)?.classOffer).toBe(false);

    // Opening with explicit gateId also clears classOffer so a repeat fight never re-prompts.
    const opened = openClassOffer(settled2.save, { at: AT, room: ROOM, R: RULES, gateId: den.id });
    expect(opened.save.gates.find(g => g.id === den.id)?.classOffer).toBe(false);

    const closed = closeClassOffer(opened.save, { at: AT, R: RULES });
    expect(isRefused(closed)).toBe(false);
    if (isRefused(closed)) return;

    const settled3 = settleEncounter(
      { ...closed, fight: f2Ended, fightRefs: { gate: den.id, monsters: { [combatantId('c4')]: boss.id } } },
      plan2,
      'skip',
      { room: null, events: [] },
      { at: AT, today: day('2026-11-25'), R: RULES },
      { gold: 0, items: [] },
    );
    expect(isRefused(settled3)).toBe(false);
    if (isRefused(settled3)) return;
    expect(settled3.offerClasses).toBeNull();

    // Shared OFFER_WORDS stays neutral (no carved altar prop) and names the real buttons.
    expect(OFFER_WORDS.gatePromptNote.toLowerCase()).not.toContain('altar');
    expect(OFFER_WORDS.openBody).toContain('Six classes are open.');
    expect(OFFER_WORDS.gmOfferRoomHint).toContain('Close offer');
    expect(OFFER_WORDS.gmOfferRoomHint).toContain('Clear gate');
  });
});

describe('openClassOffer, closeClassOffer, save repair & export', () => {
  test('opens Wave 1 pool (3 Mythics + 3 Epics), repairs cleanly on GM, clears on player, and strips on export', () => {
    const s0 = gmSave();
    const { save: s1, offer } = openClassOffer(s0, { at: AT, room: ROOM, R: RULES });
    expect(offer.pool).toEqual(WAVE1_OFFER_POOL);
    expect(offer.pool.slice(0, 3)).toEqual(WAVE1_MYTHIC_OFFER);
    expect(offer.pool.slice(3)).toEqual(WAVE1_EPIC_OFFER);
    expect(s1.classOffer).toEqual(offer);

    // Repair preserves valid offer on GM and floors save.seq above co<seq>.
    const repaired = repairSave({ ...JSON.parse(JSON.stringify(s1)), seq: 1 }, ENV);
    expect(repaired.classOffer).toEqual(offer);
    expect(repaired.seq).toBeGreaterThanOrEqual(s1.seq);

    // Repair strips classOffer on non-GM saves.
    const playerRepaired = repairSave({ ...JSON.parse(JSON.stringify(s1)), settings: { ...s1.settings, mode: 'player', sync: { ...s1.settings.sync, gmKey: null } } }, ENV);
    expect(playerRepaired.classOffer).toBeNull();

    // Export strips active classOffer.
    const exp = exportedSave(s1, true) as { classOffer: unknown };
    expect(exp.classOffer).toBeNull();

    // Closing removes classOffer and refuses a second close.
    const closed = closeClassOffer(s1, { at: AT, R: RULES });
    expect(isRefused(closed)).toBe(false);
    if (!isRefused(closed)) {
      expect(closed.classOffer).toBeNull();
      expect(closeClassOffer(closed, { at: AT, R: RULES })).toEqual({ ok: false, why: 'no-offer' });
    }
  });
});

describe('classOfferDocOf, DOCS.classOffer, classOfferFor & wire redaction', () => {
  test('derives taken in canonical pool order, omits classes outside pool, redacts NPC names, and scopes to room', () => {
    let s = gmSave();
    const c1 = claimUniqueClass(s, 'Bladefiend', { kind: 'npc', name: 'Secret Monarch Boss' }, holderCtx());
    expect(isRefused(c1)).toBe(false);
    if (isRefused(c1)) return;
    s = c1.save;

    const c2 = claimUniqueClass(s, 'Necromancer', { kind: 'remote', sheetKey: MIRA_KEY, name: 'Mira' }, holderCtx());
    expect(isRefused(c2)).toBe(false);
    if (isRefused(c2)) return;
    s = c2.save;

    const c3 = claimUniqueClass(s, 'Seraph', { kind: 'remote', sheetKey: KAEL_KEY, name: 'Kael' }, holderCtx());
    expect(isRefused(c3)).toBe(false);
    if (isRefused(c3)) return;
    s = c3.save;

    const { save: sOpen } = openClassOffer(s, { at: AT, room: ROOM, R: RULES, hunters: [MIRA_KEY, KAEL_KEY] });
    const doc = classOfferDocOf(sOpen, AT, new Map([[KAEL_KEY, 'Kael Fresh']]));
    expect(doc.active).toBe(true);
    if (!doc.active) return;

    // Canonical pool order, no Necromancer leak, NPC name redacted to ''.
    expect(Object.keys(doc.taken)).toEqual(['Bladefiend', 'Seraph']);
    expect(doc.taken.Bladefiend).toEqual({ who: 'gm', name: '' });
    expect(doc.taken.Seraph).toEqual({ who: KAEL_KEY, name: 'Kael Fresh' });
    expect('Necromancer' in doc.taken).toBe(false);

    // Protocol validation + classOfferFor scoping.
    const parsed = DOCS.classOffer(JSON.parse(JSON.stringify(doc)))!;
    expect(parsed).toEqual(doc);
    expect(classOfferFor(parsed, { kind: 'anyone' })).toBeNull();
    expect(classOfferFor(parsed, { kind: 'gm' })).toEqual(parsed);
    expect(classOfferFor(parsed, { kind: 'phone', device: MIRA_DEV })).toEqual({ ...parsed, hunters: [MIRA_KEY] });
    expect(classOfferFor(parsed, { kind: 'phone', device: parseDeviceId('d-other')! })).toBeNull();
    expect(wireDocs({ classOffer: { from: dev('d-gm'), data: parsed, at: AT } }, { kind: 'anyone' })).toEqual({});

    // Different room hides the offer.
    const otherRoom: Save = { ...sOpen, settings: { ...sOpen.settings, sync: { ...sOpen.settings.sync, room: room('ZZZZZZ') } } };
    expect(classOfferDocOf(otherRoom, AT)).toEqual({ active: false, at: AT });
  });

  test('combined Lift cap and offer classes atomically sets capDisplay to none for local hunters and queues capSet for remote hunters', () => {
    const s0 = gmSave();
    const den = s0.gates.find(g => g.name === STARTER_GATE.name)!;
    const capped: Save = {
      ...s0,
      hunters: s0.hunters.map(h => ({ ...h, capDisplay: 'E' as const })),
    };

    // Opening from GM panel (no gateId, no liftCap) leaves capDisplay untouched and posts no capSet.
    const plain = openClassOffer(capped, { at: AT, room: ROOM, R: RULES, remoteKeys: [MIRA_KEY, KAEL_KEY], stamp: nextStamp() });
    expect(plain.capPosted).toBe(false);
    expect(plain.save.hunters.every(h => h.capDisplay === 'E')).toBe(true);
    expect((plain.save.settings.sync.outbox ?? []).some(e => e.letter.kind === 'event' && e.letter.event.type === 'capSet')).toBe(false);

    // Opening from a gate (gateId set) atomically sets local hunters to 'none' and queues one capSet for remote hunters.
    const lifted = openClassOffer(capped, {
      at: AT,
      room: ROOM,
      R: RULES,
      gateId: den.id,
      remoteKeys: [MIRA_KEY, KAEL_KEY, MIRA_KEY],
      stamp: nextStamp(),
    });
    expect(lifted.capPosted).toBe(true);
    expect(lifted.save.classOffer?.id).toBe(lifted.offer.id);
    expect(lifted.save.hunters.every(h => h.capDisplay === 'none')).toBe(true);
    const capEvents = (lifted.save.settings.sync.outbox ?? []).filter(e => e.letter.kind === 'event' && e.letter.event.type === 'capSet');
    expect(capEvents).toHaveLength(1);
    const ev = capEvents[0]!.letter;
    expect(ev.kind === 'event' && ev.event.type === 'capSet' ? ev.event.payload : null).toMatchObject({
      to: [MIRA_KEY, KAEL_KEY],
      cap: 'none',
    });
  });
});

describe('pickClassFromOffer: races, 4+ Epics, 7th all-taken, stat fit, and copy', () => {
  test('first player wins Hemomancer, second gets class-taken with exact the owner copy, and picks another', () => {
    const { save: s0, offer } = openClassOffer(gmSave(), { at: AT, room: ROOM, R: RULES });
    const p1 = pickClassFromOffer(s0, { kind: 'remote', sheetKey: MIRA_KEY, name: 'Mira' }, 'Hemomancer', offer.id, holderCtx());
    expect(isRefused(p1)).toBe(false);
    if (isRefused(p1)) return;

    // Second player racing Hemomancer is refused with class-taken.
    const p2 = pickClassFromOffer(p1.save, { kind: 'remote', sheetKey: KAEL_KEY, name: 'Kael' }, 'Hemomancer', offer.id, holderCtx());
    expect(p2).toEqual({ ok: false, why: 'class-taken' });
    expect(classTakenLine('Hemomancer', holderOf(p1.save, 'Hemomancer')?.name)).toBe('Hemomancer is taken. Mira holds it. Pick another.');
    expect(classTakenLine('Hemomancer', '')).toBe('Hemomancer is taken. Pick another.');

    // Mira cannot pick a second class from the same offer.
    const p1Again = pickClassFromOffer(p1.save, { kind: 'remote', sheetKey: MIRA_KEY, name: 'Mira' }, 'Bladefiend', offer.id, holderCtx());
    expect(p1Again).toEqual({ ok: false, why: 'already-picked' });

    // Kael picks Bladefiend.
    const p2Alt = pickClassFromOffer(p1.save, { kind: 'remote', sheetKey: KAEL_KEY, name: 'Kael' }, 'Bladefiend', offer.id, holderCtx());
    expect(isRefused(p2Alt)).toBe(false);
    if (isRefused(p2Alt)) return;
    expect(holderOf(p2Alt.save, 'Bladefiend')?.name).toBe('Kael');

    // Wrong offer id, non-pool class, and mid-fight hunter are refused.
    expect(pickClassFromOffer(p2Alt.save, { kind: 'remote', sheetKey: D3_KEY, name: 'P3' }, 'Rifthunter', 'co999-0', holderCtx())).toEqual({ ok: false, why: 'wrong-offer' });
    expect(pickClassFromOffer(p2Alt.save, { kind: 'remote', sheetKey: D3_KEY, name: 'P3' }, 'Necromancer', offer.id, holderCtx())).toEqual({ ok: false, why: 'not-in-pool' });
    expect(pickClassFromOffer(p2Alt.save, { kind: 'remote', sheetKey: D3_KEY, name: 'P3' }, 'Rifthunter', offer.id, holderCtx(ROOM, () => false, k => k === D3_KEY))).toEqual({ ok: false, why: 'held' });
  });

  test('party of 4+ picks Epics, keeps Epic if later granted a Mythic, and 7th player sees allTaken plain notice', () => {
    let { save: s, offer } = openClassOffer(gmSave(), { at: AT, room: ROOM, R: RULES });
    const picks: [SheetKey, string, (typeof WAVE1_OFFER_POOL)[number]][] = [
      [MIRA_KEY, 'Mira', 'Hemomancer'],
      [KAEL_KEY, 'Kael', 'Bladefiend'],
      [D3_KEY, 'Sora', 'Rifthunter'],
      [D4_KEY, 'Bram', 'Seraph'],
      [D5_KEY, 'Tali', 'Ironclad'],
      [D6_KEY, 'Vex', 'Stormcaller'],
    ];
    for (const [key, name, cls] of picks) {
      const r = pickClassFromOffer(s, { kind: 'remote', sheetKey: key, name }, cls, offer.id, holderCtx());
      expect(isRefused(r)).toBe(false);
      if (isRefused(r)) return;
      s = r.save;
    }

    // 7th player sees allTaken with 0 open and plain notice.
    const doc = classOfferDocOf(s, AT);
    expect(doc.active).toBe(true);
    if (!doc.active) return;
    const vm = classOfferView(doc, { hunter: newHunter(RULES), myWho: D7_KEY });
    expect(vm.allTaken).toBe(true);
    expect(vm.openCount).toBe(0);
    expect(vm.mythics.map(c => c.className)).toEqual([...WAVE1_MYTHIC_OFFER]);
    expect(vm.epics.map(c => c.className)).toEqual([...WAVE1_EPIC_OFFER]);
    expect(OFFER_WORDS.allTakenNotice).toContain('GM');

    // Local hunter who picked an Epic keeps it when later granted a Mythic.
    const sLoc = openClassOffer(gmSave(), { at: AT, room: null, R: RULES }).save;
    const h0 = sLoc.hunters[0]!;
    const epicPick = pickClassFromOffer(sLoc, { kind: 'local', hunterId: h0.id }, 'Ironclad', sLoc.classOffer!.id, holderCtx(null));
    expect(isRefused(epicPick)).toBe(false);
    if (isRefused(epicPick)) return;
    const mythicGrant = claimUniqueClass(epicPick.save, 'Hemomancer', { kind: 'local', hunterId: h0.id }, holderCtx(null));
    expect(isRefused(mythicGrant)).toBe(false);
    if (isRefused(mythicGrant)) return;
    const afterH = mythicGrant.save.hunters.find(h => h.id === h0.id)!;
    expect(Object.keys(afterH.classes).sort()).toEqual(['Hemomancer', 'Ironclad']);
  });

  test('bestFitClasses tags best stat pair and returns empty set for flat stats', () => {
    const flat = newHunter(RULES);
    expect(bestFitClasses(flat, WAVE1_OFFER_POOL, {}).size).toBe(0);

    const vitPow = { ...flat, stats: { ...flat.stats, vit: 18, pow: 18 } };
    expect([...bestFitClasses(vitPow, WAVE1_OFFER_POOL, {})]).toEqual(['Hemomancer']);
    expect(bestFitClasses(vitPow, WAVE1_OFFER_POOL, { Hemomancer: { who: 'gm', name: 'Mira' } }).has('Hemomancer')).toBe(false);
  });
});

describe('link.ts pacing & chase for classOffer / classPick', () => {
  test('GM polls at 1s while classOffer is active, and player classPick chases classOffer/holders until either advances', () => {
    expect(paceOf(null, true, 'd-gm', false)).toBe('table');
    expect(paceOf(null, true, 'd-gm', true)).toBe('turn');
    expect(paceOf(null, false, 'd-p1', true)).toBe('table');

    const booted = boot({ server: true, room: { code: ROOM, key: null, cursor: 0 }, last: null });
    const gen = booted.state.gen;
    const live = linkReduce(booted.state, { type: 'polled', gen, cursor: 0, pace: 'table', fightAt: null, offerAt: 't1|h1', more: false }).state;
    const chasing = linkReduce(live, { type: 'sent', from: 't1|h1', kind: 'offer' }).state;
    expect(chasing.at === 'live' && chasing.chase?.kind).toBe('offer');

    // Poll with unchanged offerAt keeps chasing; firing timer and advancing offerAt clears chase.
    const still = linkReduce(chasing, { type: 'polled', gen, cursor: 0, pace: 'table', fightAt: null, offerAt: 't1|h1', more: false }).state;
    expect(still.at === 'live' && still.chase?.kind).toBe('offer');
    const pollingAgain = linkReduce(still, { type: 'timerFired', name: 'poll' }).state;
    const done = linkReduce(pollingAgain, { type: 'polled', gen, cursor: 1, pace: 'table', fightAt: null, offerAt: 't2|h1', more: false }).state;
    expect(done.at === 'live' && done.chase).toBeNull();
  });

  test('parseEvent accepts valid classPick and rejects non-unique class or missing offerId', () => {
    expect(parseEvent('classPick', { eid: 'd-mira-e1', by: MIRA_KEY, name: 'Mira', className: 'Hemomancer', offerId: 'co1-abc' })).not.toBeNull();
    expect(parseEvent('classPick', { eid: 'd-mira-e1', by: MIRA_KEY, name: 'Mira', className: 'Fighter', offerId: 'co1-abc' })).toBeNull();
    expect(parseEvent('classPick', { eid: 'd-mira-e1', by: MIRA_KEY, name: 'Mira', className: 'Hemomancer', offerId: '' })).toBeNull();
  });
});

describe('grant.ts, gmAward, storyMove, and pendingApproveAll unique rewards.job refusal routing', () => {
  test('local GM grant() claims unique rewards.job via claimUniqueClass and refuses cleanly when taken, held, or non-GM', () => {
    const s0 = gmSave();
    const [h1, h2] = s0.hunters;
    const d = { at: AT, today: day('2026-11-25'), R: RULES, vitals: 'sheet' as const };

    // 1. Open unique class on GM save -> claimed through claimUniqueClass, seq stays disjoint with XP/gold.
    const r1 = grant(s0, h1!.id, { ...newRewards(), xp: 50, gold: 40, job: 'Hemomancer' }, d);
    expect(isRefused(r1)).toBe(false);
    if (isRefused(r1)) return;
    expect(r1.job).toBe('Hemomancer');
    expect(r1.jobRefused).toBeNull();
    expect(holderOf(r1.save, 'Hemomancer')).toMatchObject({ kind: 'local', hunterId: h1!.id });
    expect(r1.save.hunters.find(h => h.id === h1!.id)?.classes.Hemomancer?.grantId).toBeTruthy();

    // 2. Second hunter awarded Hemomancer -> refused with class-taken, gold/XP still granted, holder untouched!
    const r2 = grant(r1.save, h2!.id, { ...newRewards(), gold: 75, job: 'Hemomancer' }, d);
    expect(isRefused(r2)).toBe(false);
    if (isRefused(r2)) return;
    expect(r2.job).toBeNull();
    expect(r2.jobRefused).toEqual({ className: 'Hemomancer', why: 'class-taken', holderName: h1!.name });
    expect(uniqueJobRefusalText(r2.jobRefused!, h2!.name)).toBe(`Hemomancer was not granted to ${h2!.name}. ${h1!.name} holds it. Release or reassign it first.`);
    expect(r2.save.hunters.find(h => h.id === h2!.id)?.gold).toBe(h2!.gold + 75);
    expect(holderOf(r2.save, 'Hemomancer')).toMatchObject({ kind: 'local', hunterId: h1!.id });

    // 3. Mid-fight hunter awarded open unique class -> refused with held, gold still granted.
    const rHeld = grant(r1.save, h2!.id, { ...newRewards(), gold: 30, job: 'Bladefiend' }, { ...d, vitals: 'fight' });
    expect(isRefused(rHeld)).toBe(false);
    if (isRefused(rHeld)) return;
    expect(rHeld.job).toBeNull();
    expect(rHeld.jobRefused).toEqual({ className: 'Bladefiend', why: 'held', holderName: null });
    expect(holderOf(rHeld.save, 'Bladefiend')).toBeNull();

    // 4. Non-GM save cannot grant a unique class through rewards.job.
    const playerSave: Save = { ...s0, settings: { ...s0.settings, mode: 'player', sync: { ...s0.settings.sync, gmKey: null } } };
    const rPlayer = grant(playerSave, h1!.id, { ...newRewards(), gold: 10, job: 'Hemomancer' }, d);
    expect(isRefused(rPlayer)).toBe(false);
    if (isRefused(rPlayer)) return;
    expect(rPlayer.job).toBeNull();
    expect(rPlayer.jobRefused).toEqual({ className: 'Hemomancer', why: 'not-gm', holderName: null });
    expect(rPlayer.save.hunters.find(h => h.id === h1!.id)?.classes.Hemomancer).toBeUndefined();
  });

  test('gmAward claims open remote unique job and returns remoteJobRefused when taken', () => {
    const s0 = gmSave();
    const d = { at: AT, today: day('2026-11-25'), R: RULES };
    const res = gmAward(
      s0,
      [],
      { ...newRewards(), gold: 25, job: 'Hemomancer' },
      { room: ROOM, events: [], said: [] },
      d,
      null,
      null,
      {
        targets: [
          { key: MIRA_KEY, name: 'Mira' },
          { key: KAEL_KEY, name: 'Kael' },
        ],
        heldRemote: () => false,
        stamp: nextStamp(),
      },
    );
    // Mira wins, Kael is refused in the same batch!
    expect(res.remoteClaimed).toEqual([MIRA_KEY]);
    expect(res.remoteJobRefused).toEqual([
      { key: KAEL_KEY, name: 'Kael', refusal: { className: 'Hemomancer', why: 'class-taken', holderName: 'Mira' } },
    ]);
    expect(holderOf(res.save, 'Hemomancer')).toMatchObject({ kind: 'remote', sheetKey: MIRA_KEY });
  });

  test('storyMove claims remote unique job with disjoint eid and strips job from chapter payload', () => {
    let s = gmSave();
    const story = {
      id: 'st1' as never,
      name: 'Blood Altar',
      notes: '',
      chapters: [
        {
          n: 1,
          words: { title: 'THE ALTAR', line: 'Blood answers.' },
          note: '',
          rewards: { ...newRewards(), gold: 10, job: 'Hemomancer' },
          quest: null,
        },
      ],
    };
    s = { ...s, library: { ...s.library, stories: [story as never] } };
    const sheets = [
      { key: MIRA_KEY, data: { ...newHunter(RULES), name: 'Mira' }, updatedAt: AT },
      { key: KAEL_KEY, data: { ...newHunter(RULES), name: 'Kael' }, updatedAt: AT },
    ] as never;
    const refs = [{ kind: 'remote' as const, remote: MIRA_KEY }, { kind: 'remote' as const, remote: KAEL_KEY }];

    const out = storyMove(
      s,
      'sr1' as StoryRunId,
      {
        type: 'turnOn',
        id: 'sr1' as StoryRunId,
        story: story.id,
        who: { at: 'hunters', refs },
        to: refs,
        at: AT,
        session: 1,
      },
      {
        day: { at: AT, today: day('2026-11-25'), R: RULES },
        vitals: () => 'sheet',
        room: { code: ROOM, sheets, onRow: () => false, stamp: nextStamp() },
      },
    );
    expect(isRefused(out)).toBe(false);
    if (isRefused(out)) return;
    expect(out.remoteClaimed).toEqual([MIRA_KEY]);
    expect(out.remoteJobRefused).toHaveLength(1);
    expect(out.remoteJobRefused[0]?.refusal.why).toBe('class-taken');
    // Every chapter wire event has job stripped to null, and all outbox eids are unique.
    const outbox = out.save.settings.sync.outbox ?? [];
    const eids = outbox.map(e => e.id);
    expect(new Set(eids).size).toBe(eids.length);
    const chapters = outbox.filter(e => e.letter.kind === 'event' && e.letter.event.type === 'chapter');
    expect(chapters.every(e => e.letter.kind === 'event' && e.letter.event.type === 'chapter' && e.letter.event.payload.rewards.job === null)).toBe(true);
  });

  test('pendingApproveAll claims open remote unique job and keeps refused job-only pending rewards waiting', () => {
    let s = gmSave();
    const c = claimUniqueClass(s, 'Hemomancer', { kind: 'remote', sheetKey: MIRA_KEY, name: 'Mira' }, holderCtx());
    expect(isRefused(c)).toBe(false);
    if (isRefused(c)) return;
    s = c.save;

    const logStamp = { at: AT, cap: RULES.logCap };
    const h1 = pendingHeard(s, {
      eid: 'd-kael-e1' as EventId,
      by: KAEL_KEY,
      name: 'Kael',
      from: 'quest',
      what: 'Blood Trial',
      rewards: { ...newRewards(), job: 'Hemomancer' },
    }, ROOM, logStamp);
    const h2 = pendingHeard(h1, {
      eid: 'd-kael-e2' as EventId,
      by: KAEL_KEY,
      name: 'Kael',
      from: 'quest',
      what: 'Blade Trial',
      rewards: { ...newRewards(), job: 'Bladefiend' },
    }, ROOM, logStamp);

    const res = pendingApproveAll(h2, ROOM, {
      day: { at: AT, today: day('2026-11-25'), R: RULES },
      stamp: nextStamp(),
    });
    expect(isRefused(res)).toBe(false);
    if (isRefused(res)) return;
    expect(res.remoteClaimed).toEqual([KAEL_KEY]);
    expect(res.remoteJobRefused).toHaveLength(1);
    expect(res.remoteJobRefused[0]?.refusal).toEqual({ className: 'Hemomancer', why: 'class-taken', holderName: 'Mira' });
    // Job-only refused pending reward stays waiting; Bladefiend claim is approved & cleared.
    const waiting = (res.save.settings.sync.pending ?? []).filter(p => p.at === 'waiting');
    expect(waiting.map(p => p.id)).toEqual(['d-kael-e1' as EventId]);
    expect(holderOf(res.save, 'Bladefiend')).toMatchObject({ kind: 'remote', sheetKey: KAEL_KEY });
  });

  test('pendingApproveAll local branch keeps refused unique-job-only and held/down plain-job-only rewards pending without logging or outbox-full', () => {
    let s = gmSave();
    const h0 = s.hunters[0]!;
    const localKey = `${s.settings.deviceId}:${h0.id}` as SheetKey;
    const c = claimUniqueClass(s, 'Hemomancer', { kind: 'remote', sheetKey: MIRA_KEY, name: 'Mira' }, holderCtx());
    if (isRefused(c)) throw new Error(c.why);
    s = c.save;

    const logStamp = { at: AT, cap: RULES.logCap };
    // 1. Local unique-job-only (taken) -> stays pending, no granted entry, no log, no outbox-full
    const onlyTaken = pendingHeard(s, {
      eid: 'd-gm-loc1' as EventId,
      by: localKey,
      name: h0.name,
      from: 'quest',
      what: 'Blood Trial',
      rewards: { ...newRewards(), job: 'Hemomancer' },
    }, ROOM, logStamp);
    const res1 = pendingApproveAll(onlyTaken, ROOM, { day: { at: AT, today: day('2026-11-25'), R: RULES }, stamp: nextStamp() });
    expect(isRefused(res1)).toBe(false);
    if (isRefused(res1)) return;
    expect(res1.approved).toHaveLength(0);
    expect(res1.granted).toHaveLength(0);
    expect(res1.localJobRefused).toEqual([{ hid: h0.id, name: h0.name, refusal: { className: 'Hemomancer', why: 'class-taken', holderName: 'Mira' } }]);
    expect((res1.save.settings.sync.pending ?? []).filter(p => p.at === 'waiting').map(p => p.id)).toEqual(['d-gm-loc1' as EventId]);
    expect(res1.save.log.length).toBe(onlyTaken.log.length);

    // 2. Local plain-job-only while held in a fight -> stays pending, populates localJobHeld, no log; mixed gold + plain job approves gold without logging Job:
    const withPlainAndMixed = pendingHeard(
      pendingHeard(s, {
        eid: 'd-gm-loc2' as EventId,
        by: localKey,
        name: h0.name,
        from: 'quest',
        what: 'Fighter Trial',
        rewards: { ...newRewards(), job: 'Fighter' },
      }, ROOM, logStamp),
      {
        eid: 'd-gm-loc3' as EventId,
        by: localKey,
        name: h0.name,
        from: 'quest',
        what: 'Mixed Trial',
        rewards: { ...newRewards(), gold: 25, job: 'Fighter' },
      },
      ROOM,
      logStamp,
    );
    const res2 = pendingApproveAll(withPlainAndMixed, ROOM, {
      day: { at: AT, today: day('2026-11-25'), R: RULES },
      heldLocals: new Set([h0.id]),
      stamp: nextStamp(),
    });
    expect(isRefused(res2)).toBe(false);
    if (isRefused(res2)) return;
    expect(res2.approved.map(p => p.id)).toEqual(['d-gm-loc3' as EventId]);
    expect(res2.granted.map(g => g.rec.id)).toEqual(['d-gm-loc3' as EventId]);
    expect(res2.localJobHeld).toEqual([{ hid: h0.id, name: h0.name, job: 'Fighter', why: 'held' }]);
    expect((res2.save.settings.sync.pending ?? []).filter(p => p.at === 'waiting').map(p => p.id)).toEqual(['d-gm-loc2' as EventId]);
    expect(res2.save.log[0]?.text).toBe(`Quest complete: Mixed Trial: +25 gold → ${h0.name}`);

    // 3. pendingEdited saves GM edits on a waiting record without consuming it
    const edited = pendingEdited(onlyTaken, 'd-gm-loc1' as EventId, { ...newRewards(), job: 'Bladefiend' });
    expect(isRefused(edited)).toBe(false);
    if (isRefused(edited)) return;
    const rec = (edited.settings.sync.pending ?? []).find(p => p.id === ('d-gm-loc1' as EventId));
    expect(rec?.at).toBe('waiting');
    expect(rec?.rewards.job).toBe('Bladefiend');
  });
});

describe('a downed hunter takes no unique class (statechart rule 2)', () => {
  test('the GM\'s local offer pick for a downed hunter is refused "dead", and so is a reward\'s unique job', () => {
    const s0 = openClassOffer(gmSave(), { at: AT, room: null, R: RULES }).save;
    const h0 = s0.hunters[0]!;
    const s: Save = { ...s0, hunters: s0.hunters.map(h => (h.id === h0.id ? { ...h, life: { at: 'dead' as const } } : h)) };
    expect(pickClassFromOffer(s, { kind: 'local', hunterId: h0.id }, 'Ironclad', s.classOffer!.id, holderCtx(null))).toEqual({ ok: false, why: 'dead' });
    const g = grant(s, h0.id, { ...newRewards(), gold: 5, job: 'Hemomancer' }, { at: AT, today: day('2026-11-25'), R: RULES, vitals: 'sheet' });
    if (isRefused(g)) throw new Error(g.why);
    expect([g.job, g.jobRefused, holderOf(g.save, 'Hemomancer')]).toEqual([null, { className: 'Hemomancer', why: 'dead', holderName: null }, null]);
    expect(uniqueJobRefusalText(g.jobRefused!, h0.name)).toBe(`Hemomancer was not granted to ${h0.name}. That hunter is down. Revive them before giving them a unique class.`);
  });
});

describe('the offer view reads the offer doc, never the locker (statechart rule 7)', () => {
  const doc = (taken: Partial<Record<'Hemomancer' | 'Seraph', { who: SheetKey | 'gm'; name: string }>>) => ({
    active: true as const, id: 'co1-abc', at: AT, pool: [...WAVE1_OFFER_POOL], hunters: [], taken,
  });
  const withHemo = (registryId: string) => {
    const h = newHunter(RULES);
    return { ...h, classes: { Hemomancer: { unlockedAt: AT, nodes: [], registryId, grantId: 'cg1' } } };
  };

  test('Hemomancer in the locker while the doc names another hunter is not mine, and every other card can be picked', () => {
    const vm = classOfferView(doc({ Hemomancer: { who: KAEL_KEY, name: 'Kael' } }), { hunter: withHemo('reg-1'), myWho: MIRA_KEY });
    expect(vm.myPicked).toBeNull();
    expect(vm.mythics.find(c => c.className === 'Hemomancer')).toMatchObject({ heldByMe: false, open: false, takenBy: 'Kael' });
  });

  test('the doc naming me makes the card mine, whatever the locker holds yet', () => {
    const vm = classOfferView(doc({ Seraph: { who: MIRA_KEY, name: 'Mira' } }), { hunter: newHunter(RULES), myWho: MIRA_KEY });
    expect(vm.myPicked).toBe('Seraph');
    expect(vm.epics.find(c => c.className === 'Seraph')?.heldByMe).toBe(true);
  });

  test('a parked copy of a pool class from another campaign is not mine and blocks no pick', () => {
    const vm = classOfferView(doc({}), { hunter: withHemo('reg-old'), myWho: MIRA_KEY });
    expect(vm.myPicked).toBeNull();
    expect(vm.mythics.find(c => c.className === 'Hemomancer')).toMatchObject({ heldByMe: false, open: true });
  });
});

describe('the GM answers a pick it refuses (statechart rule 5)', () => {
  const PICK = 'd-mira-cp1' as EventId;
  const opened = () => openClassOffer(gmSave(), { at: AT, room: ROOM, R: RULES });
  const answers = (s: Save) => (s.settings.sync.outbox ?? []).flatMap(e => (e.letter.kind === 'event' && e.letter.event.type === 'classPickRefused' ? [e.letter.event.payload] : []));

  test('a refused pick queues classPickRefused to that phone with the pick\'s id and why, in the same write', () => {
    const { save, offer } = opened();
    const r = pickAnswered(save, { sheetKey: MIRA_KEY, name: 'Mira' }, 'Hemomancer', offer.id, PICK, holderCtx(ROOM, () => false, k => k === MIRA_KEY));
    expect([r.holder, r.why]).toEqual([null, 'held']);
    expect(holderOf(r.save, 'Hemomancer')).toBeNull();
    expect(answers(r.save)).toHaveLength(1);
    expect(answers(r.save)[0]).toMatchObject({ to: [MIRA_KEY], pick: PICK, className: 'Hemomancer', why: 'held' });
    expect(pickRefusedLine('held', 'Hemomancer')).toBe('Your hunter is in the GM\'s fight. Pick a class after the fight ends.');
    const late = pickAnswered(save, { sheetKey: MIRA_KEY, name: 'Mira' }, 'Hemomancer', 'co9-old', PICK, holderCtx());
    expect(answers(late.save).map(a => a.why)).toEqual(['wrong-offer']);
  });

  test('an accepted pick queues no answer, and nothing is queued without a room', () => {
    const { save, offer } = opened();
    const ok = pickAnswered(save, { sheetKey: MIRA_KEY, name: 'Mira' }, 'Hemomancer', offer.id, PICK, holderCtx());
    expect(ok.why).toBeNull();
    expect(ok.holder).toMatchObject({ kind: 'remote', sheetKey: MIRA_KEY });
    expect(answers(ok.save)).toEqual([]);
    const alone = pickAnswered(save, { sheetKey: MIRA_KEY, name: 'Mira' }, 'Hemomancer', 'co9-old', PICK, holderCtx(null));
    expect(alone.why).toBe('wrong-offer');
    expect(alone.save).toBe(save);
  });

  test('every refusal has words for the player', () => {
    for (const why of ['no-offer', 'wrong-offer', 'not-in-pool', 'not-eligible', 'already-picked', 'not-unique', 'class-taken', 'no-hunter', 'locker-full', 'bad-target', 'held', 'dead', 'foreign-class'] as const) {
      expect(pickRefusedLine(why, 'Seraph')).toMatch(/\.$/);
    }
  });
});
