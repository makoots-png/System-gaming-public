import { describe, expect, test } from 'bun:test';
import {
  GUILD_ARCHETYPES,
  GUILD_GOLD_CUT_MAX,
  GUILD_TABLE_PERKS,
  GUILD_WORDS,
  allowedStandings,
  clearGoldLine,
  clearPreviewLine,
  effectiveCrystalShare,
  effectiveGoldCut,
  guildChip,
  guildGoldStep,
  guildSheetLine,
  guildStep,
  isStandingAllowed,
  parseGuild,
  setGuild,
  tableCrystalShare,
  tableGoldCut,
  takesGuildCut,
} from '../src/core/hunter/guild.ts';
import type { GuildMembership } from '../src/core/hunter/guild.ts';
import { buyerRate, buyerStatus, clearCrystalFor, defaultBuyer, sellCrystal, sellPlan } from '../src/core/hunter/crystal.ts';
import { grant } from '../src/core/hunter/grant.ts';
import { newHunter, parseSheetHunter } from '../src/core/hunter/hunter.ts';
import { roomRulesOf, withRoomRules } from '../src/core/hunter/build.ts';
import { newGate } from '../src/core/gates/gate.ts';
import { clearShares, settleClear } from '../src/core/gates/pay.ts';
import { parseOverrides } from '../src/core/overrides.ts';
import { DOCS, newEvent, parseEvent, parseSheet } from '../src/core/protocol.ts';
import { newRewards } from '../src/core/rewards.ts';
import { RANKS, RULES, priceBaseOf, rulesOf } from '../src/core/rules.ts';
import { crystalLines, guildLines, guildStandingRows, guildSummaryRows } from '../src/core/rules-text.ts';
import { freshSave, repairSave } from '../src/core/save.ts';
import { isRefused } from '../src/core/save-step.ts';
import { landAll } from '../src/edge/room-events.ts';
import type { SheetKey } from '../src/core/ids.ts';
import { day, dev, gid } from './fixtures/ids.ts';

const AT = '2026-11-23T20:00:00.000Z';
const DAY = { at: AT, today: day('2026-11-23'), R: RULES };
const ENV = { now: new Date(AT), newDeviceToken: () => 'tok-0123456789abcdef0123456789ab', newDeviceId: () => dev('d-test') };
const makeSave = () => freshSave(ENV, { onboarded: true });

describe('guild rule tables and invariants', () => {
  test('tables match Finding 5: anchored at 25% Ironwake E Rookie, monotonic in standing and rank, flat standing crystal share, and no Ninth Hour Rookie row', () => {
    expect(RULES.guilds.baseGoldCut).toBe(0.25);
    expect(tableGoldCut('ironwake', 'rookie', 'E', RULES)).toBe(RULES.guilds.baseGoldCut);
    expect(isStandingAllowed('ninth-hour', 'rookie', RULES)).toBe(false);
    expect(allowedStandings('ninth-hour', RULES)).toEqual(['core', 'ace']);
    expect(tableGoldCut('ninth-hour', 'rookie', 'E', RULES)).toBeNull();
    expect(tableCrystalShare('ninth-hour', 'rookie', RULES)).toBeNull();
    expect('rookie' in RULES.guilds.archetypes['ninth-hour'].goldCut).toBe(false);
    expect('rookie' in RULES.guilds.archetypes['ninth-hour'].crystalShare).toBe(false);

    for (const a of GUILD_ARCHETYPES) {
      const standings = allowedStandings(a, RULES);
      for (const s of standings) {
        const share = tableCrystalShare(a, s, RULES)!;
        expect(share).toBeGreaterThanOrEqual(0.1);
        expect(share).toBeLessThanOrEqual(0.4);
        for (let i = 1; i < RANKS.length; i++) {
          const prev = RANKS[i - 1]!, cur = RANKS[i]!;
          expect(tableGoldCut(a, s, cur, RULES)!).toBeLessThanOrEqual(tableGoldCut(a, s, prev, RULES)!);
        }
      }
      for (let i = 1; i < standings.length; i++) {
        const lo = standings[i - 1]!, hi = standings[i]!;
        expect(tableCrystalShare(a, hi, RULES)!).toBeGreaterThanOrEqual(tableCrystalShare(a, lo, RULES)!);
        for (const r of RANKS) {
          expect(tableGoldCut(a, lo, r, RULES)!).toBeGreaterThan(tableGoldCut(a, hi, r, RULES)!);
        }
      }
      expect(GUILD_TABLE_PERKS[a].summary.length).toBeGreaterThan(10);
    }
  });

  test('Ninth Hour Rookie is refused in plain words by parseGuild, guildStep, parseEvent, and parseOverrides', () => {
    const s0 = makeSave();
    expect(parseGuild({ archetype: 'ninth-hour', standing: 'rookie' })).toBeNull();
    expect(guildStep(s0, s0.hunters[0]!.id, { archetype: 'ninth-hour', standing: 'rookie' }, { at: AT, cap: 200 })).toEqual({
      ok: false,
      why: 'standing-unavailable',
    });
    expect(GUILD_WORDS.standingUnavailable('ninth-hour', 'rookie', RULES)).toBe(
      'Ninth Hour has no Rookie standing. Pick Core or Ace.',
    );

    const key = `${s0.settings.deviceId}:${s0.hunters[0]!.id}` as SheetKey;
    expect(parseEvent('guild', { eid: 'e-1', to: [key], guild: { archetype: 'ninth-hour', standing: 'rookie' } })).toBeNull();

    const badOv = parseOverrides({ guilds: { archetypes: { 'ninth-hour': { goldCut: { rookie: { E: 0.25 } } } } } });
    expect(badOv.refused.length).toBe(1);
  });

  test('effective rates auto-scale on rank-up when unset and pin when GM overrides are set', () => {
    const hE = setGuild({ ...newHunter(RULES), rank: 'E' as const }, { archetype: 'ironwake', standing: 'core' });
    const hA = { ...hE, rank: 'A' as const };
    expect(effectiveGoldCut(hE, RULES)).toBe(0.18);
    expect(effectiveGoldCut(hA, RULES)).toBe(0.1);
    expect(effectiveCrystalShare(hE, RULES)).toBe(0.18);
    expect(effectiveCrystalShare(hA, RULES)).toBe(0.18);

    const pinned = setGuild(hE, { archetype: 'ironwake', standing: 'core', goldCut: 0.1, crystalShare: 0.35 });
    expect(effectiveGoldCut(pinned, RULES)).toBe(0.1);
    expect(effectiveGoldCut({ ...pinned, rank: 'S' as const }, RULES)).toBe(0.1);
    expect(effectiveCrystalShare(pinned, RULES)).toBe(0.35);
    expect(guildSheetLine(pinned, RULES)).toContain('(custom)');
  });
});

describe('Order C debt + guild stacking and grant scope', () => {
  test('guildGoldStep always leaves at least 1 gold kept even at 90% GM override', () => {
    const h = setGuild(newHunter(RULES), { archetype: 'aurelian', standing: 'rookie', goldCut: GUILD_GOLD_CUT_MAX });
    for (const gold of [1, 2, 5, 19, 25, 100, 1_000_000]) {
      const cut = guildGoldStep(gold, h, RULES)!;
      expect(cut.kept).toBeGreaterThanOrEqual(1);
      expect(cut.taken + cut.kept).toBe(gold);
    }
  });

  test('Order C splits debt first then applies guild cut to kept gold across all ranks, never 0 gold', () => {
    for (const rank of RANKS) {
      const s0 = makeSave();
      const debt = 5 * priceBaseOf(RULES, rank);
      const h = setGuild({ ...s0.hunters[0]!, rank, gold: 0, debt }, { archetype: 'ironwake', standing: 'core' });
      const s1 = { ...s0, hunters: [h] };
      const minRoll = RULES.loot[rank].gold[0]!;
      const g = grant(s1, h.id, { ...newRewards(), gold: minRoll }, null, { ...DAY, vitals: 'sheet', from: 'clear' });
      expect(isRefused(g)).toBe(false);
      if (isRefused(g)) continue;
      expect(g.debtPaid).not.toBeNull();
      expect(g.guildCut).not.toBeNull();
      expect(g.save.hunters[0]!.gold).toBeGreaterThanOrEqual(1);
      expect(g.debtPaid!.paid + g.debtPaid!.burn + g.guildCut!.taken + g.guildCut!.kept).toBe(minRoll);
      expect(g.lines.join(' ')).toContain('Ironwake');
      expect(g.lines.join(' ')).toContain('System debt');
    }
  });

  test('guild gold cut applies only on from === "clear", never solo, quest, feat, or manual awards', () => {
    expect(takesGuildCut('clear')).toBe(true);
    expect(takesGuildCut('solo')).toBe(false);
    expect(takesGuildCut('quest')).toBe(false);
    expect(takesGuildCut('feat')).toBe(false);
    expect(takesGuildCut(null)).toBe(false);

    const s0 = makeSave();
    const h = setGuild({ ...s0.hunters[0]!, rank: 'C' as const, gold: 0, debt: 0 }, { archetype: 'ironwake', standing: 'core' });
    const s1 = { ...s0, hunters: [h] };
    for (const from of ['solo', 'quest', 'feat', null] as const) {
      const g = grant(s1, h.id, { ...newRewards(), gold: 1000 }, null, { ...DAY, vitals: 'sheet', from });
      expect(isRefused(g)).toBe(false);
      if (!isRefused(g)) {
        expect(g.guildCut).toBeNull();
        expect(g.save.hunters[0]!.gold).toBe(1000);
      }
    }

    // settleClear with from: 'solo' pays debt without guild cut
    const gate = { ...newGate(), id: gid('g-w'), name: 'Solo World', rank: 'E' as const, createdDay: 1, breakDay: 7 };
    const indebted = setGuild({ ...s0.hunters[0]!, rank: 'E' as const, gold: 0, debt: 500 }, { archetype: 'ironwake', standing: 'core' });
    const settled = settleClear(
      { ...s0, hunters: [indebted], gates: [gate] },
      gate.id,
      { due: 100, xp: 100, gold: 200, crystal: 48, items: [], payees: [indebted.name] },
      [{ hid: indebted.id, rewards: { ...newRewards(), xp: 100, gold: 200, crystal: 48 } }],
      null,
      DAY,
      'solo',
    );
    expect(isRefused(settled)).toBe(false);
    if (!isRefused(settled)) {
      expect(settled.granted[0]!.g.debtPaid!.paid).toBe(100);
      expect(settled.granted[0]!.g.guildCut).toBeNull();
      expect(settled.save.hunters[0]!.gold).toBe(50);
    }
  });
});

describe('Helix clerk opening, mixed-party crystal shares, and protocol sync', () => {
  test('Helix opens at 90% for debt-free guild hunters, closes in debt and for unsigned', () => {
    const unsigned = newHunter(RULES);
    const iwFree = setGuild({ ...newHunter(RULES), crystal: 100, debt: 0 }, { archetype: 'ironwake', standing: 'core' });
    const iwDebt = { ...iwFree, debt: 100 };
    const rlFree = setGuild({ ...newHunter(RULES), crystal: 100, debt: 0 }, { archetype: 'redline', standing: 'core' });

    expect(buyerStatus(unsigned, 'helix')).toEqual({ open: false, why: 'guild-only' });
    expect(defaultBuyer(unsigned)).toBe('bureau');

    expect(buyerStatus(iwFree, 'helix')).toEqual({ open: true });
    expect(defaultBuyer(iwFree)).toBe('helix');
    expect(buyerRate(iwFree, 'helix', RULES)).toBe(0.9);
    const soldIw = sellCrystal(iwFree, 100, 'helix', RULES);
    expect(isRefused(soldIw)).toBe(false);
    if (!isRefused(soldIw)) expect(soldIw.gold).toBe(90);

    expect(buyerStatus(rlFree, 'helix')).toEqual({ open: true });
    expect(buyerRate(rlFree, 'helix', RULES)).toBe(0.9);
    const soldRl = sellCrystal(rlFree, 100, 'helix', RULES);
    expect(isRefused(soldRl)).toBe(false);
    if (!isRefused(soldRl)) expect(soldRl.gold).toBe(90);

    expect(buyerStatus(iwDebt, 'helix')).toEqual({ open: false, why: 'in-debt' });
    expect(buyerStatus(iwDebt, 'bureau')).toEqual({ open: false, why: 'in-debt' });
    expect(buyerStatus(iwDebt, 'stair')).toEqual({ open: true });
    expect(defaultBuyer(iwDebt)).toBe('stair');
    expect(sellPlan(iwDebt, 50, 'helix', RULES)).toEqual({ ok: false, why: 'in-debt' });
  });

  test('clearShares pays each hunter their own guild crystal share in a mixed party (local + remote)', () => {
    const s0 = makeSave();
    const hLocal = setGuild({ ...s0.hunters[0]!, rank: 'C' as const }, { archetype: 'ironwake', standing: 'core' });
    const g = { ...newGate(), id: gid('g-mix'), name: 'Mixed Gate', rank: 'C' as const, type: 'normal' as const, createdDay: 1, breakDay: 6 };
    const rKey1 = 'd-p2:h1' as SheetKey, rKey2 = 'd-p3:h1' as SheetKey, rKey3 = 'd-p4:h1' as SheetKey;
    const remotes = new Map<SheetKey, { rank: 'C'; guild: GuildMembership | null }>([
      [rKey1, { rank: 'C', guild: { archetype: 'redline', standing: 'ace' } }],
      [rKey2, { rank: 'C', guild: null }],
      [rKey3, { rank: 'C', guild: { archetype: 'lantern', standing: 'core', crystalShare: 0.4 } }],
    ]);
    const payees = [
      { kind: 'local' as const, hid: hLocal.id, name: hLocal.name },
      { kind: 'remote' as const, key: rKey1, name: 'Ace Merc' },
      { kind: 'remote' as const, key: rKey2, name: 'Solo Freelancer' },
      { kind: 'remote' as const, key: rKey3, name: 'Custom Coop' },
    ];
    const plan = clearShares({ gates: [g], hunters: [hLocal] }, g.id, () => 0, 3000, [], payees, null, 4, RULES, remotes)!;
    // C normal pool = 5000, split by 4: Ironwake Core (18%)=225, Redline Ace (40%)=500, Unsigned (12%)=150, Custom (40%)=500
    expect(plan.shares.map(x => x.crystal)).toEqual([225, 500, 150, 500]);
    expect(clearCrystalFor(g, 4, hLocal, RULES)).toBe(225);
  });

  test('parseGuild, RoomRules.guilds, parseOverrides, guild event, and landAll round-trip cleanly', () => {
    expect(parseGuild({ archetype: 'bogus', standing: 'core' })).toBeNull();
    expect(parseGuild({ archetype: 'ironwake', standing: 'core', name: '  Watch  ', goldCut: 2, crystalShare: -1 })).toEqual({
      archetype: 'ironwake',
      standing: 'core',
      name: 'Watch',
      goldCut: GUILD_GOLD_CUT_MAX,
      crystalShare: 0,
    });

    const ov = parseOverrides({ guilds: { archetypes: { ironwake: { goldCut: { core: { C: 0.2 } } } } } });
    expect(ov.refused).toEqual([]);
    const customR = rulesOf(ov.overrides);
    expect(tableGoldCut('ironwake', 'core', 'C', customR)).toBe(0.2);

    const badOv = parseOverrides({ guilds: { archetypes: { ironwake: { goldCut: { core: { C: 0.99 } } } } } });
    expect(badOv.refused.length).toBe(1);

    const wire = DOCS.rules(roomRulesOf(customR));
    expect(wire).not.toBeNull();
    expect(withRoomRules(RULES, wire).guilds.archetypes.ironwake.goldCut.core.C).toBe(0.2);

    // Backwards compatibility: RoomRules without guilds falls back to shipped defaults
    const legacy = { ...roomRulesOf(RULES) } as Record<string, unknown>;
    delete legacy.guilds;
    const parsedLegacy = DOCS.rules(legacy);
    expect(parsedLegacy).not.toBeNull();
    expect(parsedLegacy!.guilds).toEqual(RULES.guilds);

    // Save + Sheet round-trip
    const s0 = makeSave();
    const key = `${s0.settings.deviceId}:${s0.hunters[0]!.id}` as SheetKey;
    const step = guildStep(s0, s0.hunters[0]!.id, { archetype: 'lantern', standing: 'ace', name: 'East Lantern' }, { at: AT, cap: 200 });
    expect(isRefused(step)).toBe(false);
    if (!isRefused(step)) {
      expect(step.changed).toBe(true);
      expect(guildChip(step.hunter.guild)).toBe('East Lantern · Ace');
      const rep = repairSave(JSON.parse(JSON.stringify(step.save)), ENV);
      expect(rep.hunters[0]!.guild).toEqual(step.hunter.guild);
      const sheet = parseSheet(key, { hunter: JSON.parse(JSON.stringify(step.hunter)) });
      expect(sheet && 'hunter' in sheet && sheet.hunter.guild).toEqual(step.hunter.guild);
      expect(parseSheetHunter(JSON.parse(JSON.stringify(step.hunter)))?.guild).toEqual(step.hunter.guild);
    }

    // Room event `guild` parsing and player-side landing via landAll
    const ev = newEvent('guild', { to: [key], guild: { archetype: 'redline', standing: 'core', goldCut: 0.08 } }, { device: dev('d-gm'), now: 1700000000000, rand: 0.4 })!;
    expect(parseEvent('guild', ev.payload)).toEqual(ev);
    expect(parseEvent('guild', { eid: ev.payload.eid, to: [key], guild: { archetype: 'nope', standing: 'core' } })).toBeNull();
    const toasts: string[] = [];
    const landed = landAll(s0, [], [ev], {
      store: { get: () => s0 },
      once: () => true,
      rules: () => RULES,
      now: () => AT,
      today: () => day('2026-11-23'),
      toast: (_t, msg) => toasts.push(msg),
      system: () => undefined,
      hunter: { fightOf: () => null, granted: () => ({ lines: [], levelup: null, popup: null }), gmHolds: () => ({ ok: false, why: 'told' as never }) },
      stepsDone: () => undefined,
      coinRuled: () => undefined,
    });
    expect(landed.save.hunters[0]!.guild).toEqual({ archetype: 'redline', standing: 'core', goldCut: 0.08 });
    for (const tell of landed.tells) tell();
    expect(toasts[0]).toBe(GUILD_WORDS.playerToast({ archetype: 'redline', standing: 'core', goldCut: 0.08 }));
  });

  test('rules-text guild helpers and clearGoldLine / clearPreviewLine render live rule numbers', () => {
    expect(crystalLines(RULES).join(' ')).toContain('Helix clerks (90%) serve debt-free guild hunters.');
    expect(guildLines(RULES).join(' ')).toContain('25%');
    expect(guildLines(RULES).join(' ')).toContain('Ninth Hour recruits Core and Ace hunters only');
    expect(guildLines(RULES).join(' ')).toContain('GM-run table perks');
    expect(guildSummaryRows(RULES).length).toBe(5);
    expect(guildStandingRows('ironwake', RULES).length).toBe(3);
    expect(guildStandingRows('ninth-hour', RULES).map(r => r.standing)).toEqual(['core', 'ace']);

    const cut = guildGoldStep(1000, setGuild({ ...newHunter(RULES), rank: 'E' as const }, { archetype: 'ironwake', standing: 'rookie' }), RULES)!;
    expect(clearGoldLine(null, cut)).toContain('250 went to Ironwake (25%), and you got 750.');
    expect(clearPreviewLine(null, cut, null)).toContain('250 goes to Ironwake (25%), and hunter gets 750.');
  });
});
