import { describe, expect, test } from 'bun:test';
import {
  PREGENS,
  STARTER_GATE,
  STARTER_REFUSAL_WORDS,
  STARTER_STORY_NAME,
  STARTER_UNSPENT_HUNTER,
  STARTER_WORDS,
  ownSeed,
  seedOf,
  starterCampaign,
  starterConfirmBody,
  starterLoadedMessage,
  starterMissing,
  starterStory,
} from '../src/core/starter.ts';
import { LIMITS, createHunter, freshSave, repairSave } from '../src/core/save.ts';
import type { ParseEnv, Save } from '../src/core/save.ts';
import { RULES, clearOf, priceBaseOf } from '../src/core/rules.ts';
import type { Rules } from '../src/core/rules.ts';
import { dayKey } from '../src/core/day.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { available, capDisplayChip, capDisplayLevel } from '../src/core/hunter/progress.ts';
import { debtPayoffClears, raiseOwes } from '../src/core/hunter/revive-standing.ts';
import { hpOf } from '../src/core/hunter/vitals.ts';
import { bagOf, wornOf } from '../src/core/hunter/inventory.ts';
import { resolveGrant } from '../src/core/registry/item-book.ts';
import { activeGateWave, hasGateWaves, parseGate, waveRoster } from '../src/core/gates/gate.ts';
import { clearGoldEach } from '../src/core/gates/pay.ts';
import { CHAPTER_MAX, STORY_BOUNDS, chapterSize, parseStory } from '../src/core/story/story.ts';
import { missingRequired, runStep } from '../src/core/story/run.ts';
import { REWARD_BOUNDS, WORDS_BOUNDS } from '../src/core/rewards.ts';
import { isRefused } from '../src/core/save-step.ts';
import { saveId, seedId } from '../src/core/ids.ts';
import { dev, hid, srid, stid } from './fixtures/ids.ts';

const NOW = new Date('2026-11-12T12:00:00.000Z');
const env = (): ParseEnv => ({ now: NOW, newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-test') });
const stamp = { at: NOW.toISOString(), cap: RULES.logCap };
/** A new install's save, before first-run setup. */
const install = (): Save => freshSave(env(), { onboarded: false });
const ok = (v: Save | { ok: false; why: string }): Save => { if (isRefused(v)) throw new Error(v.why); return v; };

describe('the seed hunter', () => {
  test('a new install starts with one hunter marked as the seed', () => {
    const s = install();
    expect(s.hunters.length).toBe(1);
    expect(seedOf(s)?.id).toBe(s.hunters[0]!.id);
  });

  test('made the player\'s own, it is named, neutral and no longer the seed', () => {
    const s = ownSeed(install(), 'Aria', 'Ranger');
    const h = s.hunters[0]!;
    expect([h.name, h.job, h.titles.length, h.items.length, h.skills.length]).toEqual(['Aria', 'Ranger', 0, 0, 0]);
    expect(h.quests.every(q => q.kind === 'daily')).toBe(true);
    expect(seedOf(s)).toBeNull();
    expect(ownSeed(s, 'Other')).toBe(s);
  });
});

describe('the starter campaign, one atomic step', () => {
  const save = install();
  const s = ok(starterCampaign(save, stamp, RULES));

  test('replaces the seed with the 4 zero-collision sample hunters, sets the first active, and enters GM mode', () => {
    expect(s.hunters.map(h => h.name)).toEqual(['Dolan Kestrel', 'Nadia Cho', 'Bram Halstead', 'Tessa Corbin']);
    expect(s.hunters.map(h => h.name)).toEqual(PREGENS.map(p => p.name));
    expect(seedOf(s)).toBeNull();
    expect(s.settings.activeHunterId).toBe(s.hunters[0]!.id);
    expect(s.settings.mode).toBe('gm');
  });

  test('builds Dolan, Nadia, and Bram combat-ready while leaving Tessa Corbin with 12 unspent creation points, all at Cap: 9', () => {
    for (const [i, p] of PREGENS.entries()) {
      const h = s.hunters[i]!, sheet = hunterSheet(h, RULES).sheet;
      expect(h.job).toBe(p.job);
      expect(h.capDisplay).toBe('E');
      expect(capDisplayChip(h.capDisplay, RULES)).toBe('Cap: 9');
      expect(h.skills.map(k => k.name)).toEqual(p.skills.map(k => k.name));
      const bag = bagOf(h, RULES);
      expect(bag.map(x => [x.name, x.defId])).toEqual(p.items.map(x => [x.name, x.defId]));
      expect(bag.some(x => x.name === 'Health Potion (E)')).toBe(true);
      const worn = wornOf(h, RULES);
      for (const item of bag) {
        if (item.slot) expect(worn[item.slot]).toBe(item.id);
      }
      expect(hpOf(h.life, sheet.hpMax)).toBe(sheet.hpMax);
      expect(h.mana).toBe(sheet.manaMax);

      if (p.name === STARTER_UNSPENT_HUNTER) {
        expect(h.spent).toEqual({});
        expect(h.pending).toEqual({});
        expect(available(h, RULES)).toBe(RULES.fight.creationPoints);
      } else {
        for (const [k, v] of Object.entries(p.stats)) {
          expect(h.stats[k as keyof typeof h.stats]).toBe(RULES.fight.statBase + v);
        }
        expect(h.spent).toEqual(p.stats);
        expect(available(h, RULES)).toBe(0);
      }
    }
    const dolan = s.hunters[0]!;
    const shield = bagOf(dolan, RULES).find(i => i.name === 'Dented Tower Shield')!;
    expect(shield.armor).toBeGreaterThan(0);
    const bram = s.hunters.find(h => h.name === 'Bram Halstead')!;
    expect(bram.skills.map(k => k.name)).toContain('Mending Aura');
  });

  test('issues zero non-daily quests at load (only each hunter\'s daily quest)', () => {
    for (const h of s.hunters) {
      expect(h.quests).toHaveLength(1);
      expect(h.quests[0]!.kind).toBe('daily');
      expect(h.daily.lastCheckedKey).toBe(dayKey(NOW, save.settings.dailyResetHour));
    }
  });

  test('spawns exactly 1 deterministic two-wave Tidewall Cannery Gate with classOffer: true and no placeholder monsters', () => {
    expect(s.gates).toHaveLength(1);
    expect(s.monsters).toHaveLength(0);
    const g = s.gates[0]!;
    expect(g.name).toBe(STARTER_GATE.name);
    expect(g.rank).toBe('E');
    expect(g.type).toBe('normal');
    expect(g.status).toBe('detected');
    expect(g.createdDay).toBe(save.world.day);
    expect(g.breakDay).toBe(save.world.day + 1);
    expect(g.classOffer).toBe(true);
    expect(g.bossFell).toBe(false);
    expect(g.bossId).toBe(seedId<'m'>('head-usher'));
    expect(hasGateWaves(g)).toBe(true);
    expect(activeGateWave(g)).toBe(1);
    expect(waveRoster(g, 1)).toEqual({
      monsters: [
        { monsterId: seedId<'m'>('goblin'), count: 1, wave: 1 },
        { monsterId: seedId<'m'>('goblin-shaman'), count: 1, wave: 1 },
        { monsterId: seedId<'m'>('goblin-chief'), count: 1, wave: 1 },
      ],
      bossId: null,
      npcs: [],
    });
    expect(waveRoster(g, 2)).toEqual({
      monsters: [{ monsterId: seedId<'m'>('usher'), count: 2, wave: 2 }],
      bossId: seedId<'m'>('head-usher'),
      npcs: [],
    });
    expect(parseGate(JSON.parse(JSON.stringify(g)))).toEqual(g);

    // Deterministic across runs.
    const s2 = ok(starterCampaign(install(), stamp, RULES));
    expect(s2.gates[0]).toEqual(g);
  });

  test('stores the 5-chapter The Empty Seat Story in save.library.stories with no auto-started run and passes parseStory and STORY_BOUNDS', () => {
    expect(s.storyRuns).toHaveLength(0);
    expect(s.library.stories).toHaveLength(1);
    const story = s.library.stories[0]!;
    expect(story.name).toBe(STARTER_STORY_NAME);
    expect(story.for).toBe('table');
    expect(story.chapters).toHaveLength(5);

    // Raw template passes parseStory identically without truncation.
    const template = starterStory(RULES);
    expect(template.name.length).toBeLessThanOrEqual(STORY_BOUNDS.name);
    expect(template.when.length).toBeLessThanOrEqual(STORY_BOUNDS.when);
    for (const c of template.chapters) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.name.length).toBeLessThanOrEqual(STORY_BOUNDS.chapterName);
      expect(c.words.title.length).toBeGreaterThan(0);
      expect(c.words.title.length).toBeLessThanOrEqual(WORDS_BOUNDS.title);
      expect(c.words.title).toBe(c.words.title.toUpperCase());
      expect(c.words.line.length).toBeGreaterThan(0);
      expect(c.words.line.length).toBeLessThanOrEqual(WORDS_BOUNDS.line);
      expect(c.note.length).toBeGreaterThan(0);
      expect(c.note.length).toBeLessThanOrEqual(STORY_BOUNDS.note);
      expect(chapterSize(c)).toBeLessThanOrEqual(CHAPTER_MAX);
      if (c.quest) {
        expect(c.quest.title.length).toBeLessThanOrEqual(STORY_BOUNDS.questTitle);
        expect(c.quest.desc.length).toBeLessThanOrEqual(STORY_BOUNDS.questDesc);
        expect(c.quest.objectives.length).toBeLessThanOrEqual(STORY_BOUNDS.objectives);
      }
      if (c.rewards.title) {
        expect(c.rewards.title.name.length).toBeLessThanOrEqual(REWARD_BOUNDS.title);
        expect(c.rewards.title.desc.length).toBeLessThanOrEqual(REWARD_BOUNDS.titleDesc);
      }
    }
    expect(parseStory(JSON.parse(JSON.stringify(template)))).toEqual(template);
    const { id: _id, ...storedWithoutId } = story;
    expect(storedWithoutId).toEqual(template);

    // Chapter 1 gives 2 Health Potions (E) and Quest 1; Chapter 2 issues Quest 2; Chapter 5 gives Guest (+1 dis).
    expect(story.chapters[0]!.rewards.items).toHaveLength(1);
    expect(resolveGrant(story.chapters[0]!.rewards.items[0]!, RULES)).toMatchObject({ name: 'Health Potion (E)', qty: 2, rankCap: true });
    expect(story.chapters[0]!.quest?.title).toBe("Thursday's Gate");
    expect(story.chapters[0]!.quest?.rewards.xp).toBe(50);
    expect(story.chapters[1]!.quest?.title).toBe('Tidewall Cannery Gate');
    expect(story.chapters[1]!.quest?.rewards).toMatchObject({ xp: 100, points: 1 });
    expect(story.chapters[4]!.rewards.title).toMatchObject({ name: 'Guest', bonus: { dis: 1 } });
  });

  test('Pim\'s Beat 1 card is required, bridges from awakening to the Bureau seat, and stays pinned to RULES for wages, poverty, revive ladder, and level cap', () => {
    const story = { ...starterStory(RULES), id: stid('st1') };
    const beat1 = story.chapters[0]!;
    expect(beat1.required).toBe(true);
    expect(beat1.note).toContain('Required (do not skip).');

    // Starting the story always opens Beat 1 first, and an unopened required Beat 1 blocks skipping straight to Chapter 2.
    const ref = { kind: 'local' as const, hunterId: hid('h1') };
    const started = runStep(null, { type: 'turnOn', id: srid('sr1'), story: story.id, who: { at: 'table' }, to: [ref], at: stamp.at, session: 1 }, story);
    expect(isRefused(started)).toBe(false);
    if (!isRefused(started)) {
      expect(started.run.state).toEqual({ at: 'running', chapter: 0 });
      expect(started.fx).toEqual({ type: 'deliver', chapter: 0, to: [ref] });
      expect(missingRequired(started.run, story, 1)).toBeNull();
    }
    const withoutBeat1 = { id: srid('sr1'), story: story.id, name: story.name, who: { at: 'table' as const }, state: { at: 'running' as const, chapter: 0 }, opens: 1, opened: [] };
    expect(missingRequired(withoutBeat1, story, 1)).toBe(0);
    expect(runStep(withoutBeat1, { type: 'open', chapter: 1, seen: 1, to: [ref], at: stamp.at, session: 1 }, story)).toEqual({ ok: false, why: 'required' });

    // Awakening-to-Bureau-seat bridge (Item E).
    expect(beat1.note).toContain('three-day fever');
    expect(beat1.note).toContain("San Francisco's Bureau hall");
    expect(beat1.note).toContain('public board');

    // Wages, why most hunters stay poor, revive ladder, and level cap pinned to default RULES.
    const eCap = capDisplayLevel('E', RULES)!;
    const eGold = clearGoldEach(RULES, 'E', RULES.gateParty);
    const eMid = Math.round(clearOf(RULES, 'E'));
    const eBase = priceBaseOf(RULES, 'E');
    const laborerDay = Math.round(eBase * 0.12);
    const entryFee = Math.round(eBase * 0.1);
    const eDebt = raiseOwes('debt', 'E', RULES);
    const eClears = debtPayoffClears(eDebt, 'E', RULES)!;
    const eCrystal = Math.round(RULES.revivePrices * eBase);

    expect(beat1.words.line).toContain(`Cap: ${eCap}.`);
    expect(beat1.quest?.desc).toContain(`${entryFee}-gold entry fee`);
    expect(beat1.quest?.desc).toContain(`${eGold.low} to ${eGold.high} gold`);
    expect(beat1.quest?.desc).toContain(`${laborerDay} gold a day`);
    expect(beat1.note).toContain(`a laborer earns ${laborerDay} gold a day`);
    expect(beat1.note).toContain(`${eGold.low} to ${eGold.high} gold per hunter (average ${eMid})`);
    expect(beat1.note).toContain('most stay poor');
    expect(beat1.note).toContain('first return within an hour is free');
    expect(beat1.note).toContain(`${eDebt.toLocaleString('en-US')} gold in debt (about ${eClears} E-rank clears to pay off)`);
    expect(beat1.note).toContain(`${eCrystal.toLocaleString('en-US')}-gold Resurrection Crystal`);
    expect(beat1.note).toContain('None of it works on anyone who never awakened.');
    expect(beat1.note).toContain(`stops at level ${eCap} (Cap: ${eCap})`);

    // Rules-drift check: custom RULES numbers flow straight into Beat 1 without truncation.
    const custom: Rules = {
      ...RULES,
      rankLevels: { ...RULES.rankLevels, D: 13 },
      priceBase: { ...RULES.priceBase, E: 200 },
      loot: { ...RULES.loot, E: { ...RULES.loot.E, gold: [300, 700] } },
      reviveDebtPrices: { ...RULES.reviveDebtPrices, E: 6 },
      revivePrices: 15,
    };
    const customStory = starterStory(custom);
    const customBeat1 = customStory.chapters[0]!;
    expect(parseStory(JSON.parse(JSON.stringify(customStory)))).toEqual(customStory);
    expect(customBeat1.words.line).toContain('Cap: 12.');
    expect(customBeat1.quest?.desc).toContain('20-gold entry fee');
    expect(customBeat1.quest?.desc).toContain('300 to 700 gold');
    expect(customBeat1.quest?.desc).toContain('24 gold a day');
    expect(customBeat1.note).toContain('a laborer earns 24 gold a day');
    expect(customBeat1.note).toContain('300 to 700 gold per hunter (average 500)');
    expect(customBeat1.note).toContain('1,200 gold in debt (about 5 E-rank clears to pay off)');
    expect(customBeat1.note).toContain('3,000-gold Resurrection Crystal');
    expect(customBeat1.note).toContain('stops at level 12 (Cap: 12)');
  });

  test('every generated id is unique and the log begins with Campaign begun', () => {
    const ids = [
      ...s.hunters.flatMap(h => [h.id, ...h.skills.map(k => k.id), ...h.items.map(x => x.id), ...h.quests.map(q => q.id)]),
      ...s.gates.map(g => g.id),
      ...s.library.stories.map(st => st.id),
      ...s.log.map(l => l.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(s.log[0]!.title).toBe('Campaign begun');
  });
});

describe('includePregens: false and refusals', () => {
  test('includePregens: false skips sample hunters, removes the canon seed, leaves a valid activeHunterId, and survives repairSave', () => {
    const base = install();
    const s = ok(starterCampaign(base, stamp, RULES, { includePregens: false }));
    expect(seedOf(s)).toBeNull();
    expect(s.hunters).toHaveLength(1);
    expect(s.hunters[0]!.name).toBe('Hunter');
    expect(s.hunters[0]!.items).toHaveLength(0);
    expect(s.hunters[0]!.skills).toHaveLength(0);
    expect(s.hunters[0]!.quests.every(q => q.kind === 'daily')).toBe(true);
    expect(s.hunters.some(h => h.id === s.settings.activeHunterId)).toBe(true);
    expect(s.settings.mode).toBe('gm');
    expect(s.gates.map(g => g.name)).toEqual([STARTER_GATE.name]);
    expect(s.library.stories.map(st => st.name)).toEqual([STARTER_STORY_NAME]);

    // Running repairSave must keep the neutral hunter and never respawn Sung Jin-Woo.
    const repaired = repairSave(JSON.parse(JSON.stringify(s)), env());
    expect(seedOf(repaired)).toBeNull();
    expect(repaired.hunters.map(h => h.name)).toEqual(['Hunter']);
    expect(repaired.settings.activeHunterId).toBe(repaired.hunters[0]!.id);
  });

  test('includePregens: false preserves existing custom hunters and keeps activeHunterId valid', () => {
    const { save: withCustom, hunter } = createHunter(install(), 'Kira Sol', RULES, NOW);
    const s = ok(starterCampaign(withCustom, stamp, RULES, { includePregens: false }));
    expect(seedOf(s)).toBeNull();
    expect(s.hunters.map(h => h.name)).toEqual(['Kira Sol']);
    expect(s.settings.activeHunterId).toBe(hunter.id);
  });

  test('a refusal writes nothing when the story library is full or the starter campaign is already loaded', () => {
    const base = install();
    const template = starterStory(RULES);
    const fullStories = Array.from({ length: LIMITS.libraryStories }, (_, i) => ({
      ...template,
      id: saveId('st', i + 1),
      name: `Story ${i + 1}`,
    }));
    const fullSave: Save = { ...base, library: { ...base.library, stories: fullStories } };
    const snapFull = JSON.stringify(fullSave);
    expect(starterCampaign(fullSave, stamp, RULES)).toEqual({ ok: false, why: 'full' });
    expect(JSON.stringify(fullSave)).toBe(snapFull);

    const alreadyLoaded = ok(starterCampaign(base, stamp, RULES));
    const snapLoaded = JSON.stringify(alreadyLoaded);
    expect(starterCampaign(alreadyLoaded, stamp, RULES)).toEqual({ ok: false, why: 'already' });
    expect(starterCampaign(alreadyLoaded, stamp, RULES, { includePregens: false })).toEqual({ ok: false, why: 'already' });
    expect(JSON.stringify(alreadyLoaded)).toBe(snapLoaded);
    expect(alreadyLoaded.seq).toBe(JSON.parse(snapLoaded).seq);
    expect(alreadyLoaded.log).toHaveLength(JSON.parse(snapLoaded).log.length);
  });
});

describe('idempotent reload after setup', () => {
  const blankGmSave = (): Save => {
    const owned = ownSeed(install(), 'Hunter');
    return { ...owned, settings: { ...owned.settings, mode: 'gm', onboarded: true } };
  };

  test('a blank GM save gains The Empty Seat and Tidewall Cannery Gate without wiping existing hunters', () => {
    const blank = blankGmSave();
    const withoutPregens = ok(starterCampaign(blank, stamp, RULES, { includePregens: false }));
    expect(withoutPregens.hunters.map(h => h.name)).toEqual(['Hunter']);
    expect(withoutPregens.library.stories.map(st => st.name)).toEqual([STARTER_STORY_NAME]);
    expect(withoutPregens.gates.map(g => g.name)).toEqual([STARTER_GATE.name]);
    expect(withoutPregens.storyRuns).toHaveLength(0);

    const withPregens = ok(starterCampaign(blank, stamp, RULES, { includePregens: true }));
    expect(withPregens.hunters.map(h => h.name)).toEqual(['Hunter', ...PREGENS.map(p => p.name)]);
    expect(withPregens.settings.activeHunterId).toBe(blank.settings.activeHunterId);
    expect(withPregens.library.stories.map(st => st.name)).toEqual([STARTER_STORY_NAME]);
    expect(withPregens.gates.map(g => g.name)).toEqual([STARTER_GATE.name]);
  });

  test('reloading with includePregens: false after loading without sample hunters refuses with already, while includePregens: true adds only the missing sample hunters', () => {
    const base = ok(starterCampaign(blankGmSave(), stamp, RULES, { includePregens: false }));
    const snap = JSON.stringify(base);
    expect(starterCampaign(base, stamp, RULES, { includePregens: false })).toEqual({ ok: false, why: 'already' });
    expect(JSON.stringify(base)).toBe(snap);

    const addedPregens = ok(starterCampaign(base, stamp, RULES, { includePregens: true }));
    expect(addedPregens.library.stories).toHaveLength(1);
    expect(addedPregens.gates).toHaveLength(1);
    expect(addedPregens.hunters.map(h => h.name)).toEqual(['Hunter', ...PREGENS.map(p => p.name)]);
    expect(starterCampaign(addedPregens, stamp, RULES, { includePregens: true })).toEqual({ ok: false, why: 'already' });
  });

  test('preserves edits to The Empty Seat, keeps custom hunters, and adds only missing pieces in one atomic step', () => {
    const loaded = ok(starterCampaign(install(), stamp, RULES));
    const { save: withCustom } = createHunter(loaded, 'Kira Sol', RULES, NOW);
    const editedStory = {
      ...withCustom.library.stories[0]!,
      when: 'Custom GM note on The Empty Seat.',
    };
    const partial: Save = {
      ...withCustom,
      library: { ...withCustom.library, stories: [editedStory] },
      gates: [],
      hunters: withCustom.hunters.filter(h => h.name !== STARTER_UNSPENT_HUNTER),
    };

    const missing = starterMissing(partial, { includePregens: true });
    expect(missing.story).toBe(false);
    expect(missing.gate).toBe(true);
    expect(missing.pregens.map(p => p.name)).toEqual([STARTER_UNSPENT_HUNTER]);
    expect(starterConfirmBody(missing)).toContain(STARTER_GATE.name);
    expect(starterLoadedMessage(missing)).toContain(STARTER_GATE.name);
    expect(starterLoadedMessage(missing)).toContain('1 sample hunter');

    const repaired = ok(starterCampaign(partial, stamp, RULES, { includePregens: true }));
    expect(repaired.library.stories).toHaveLength(1);
    expect(repaired.library.stories[0]!.when).toBe('Custom GM note on The Empty Seat.');
    expect(repaired.gates.map(g => g.name)).toEqual([STARTER_GATE.name]);
    expect(repaired.hunters.map(h => h.name)).toEqual([
      'Dolan Kestrel',
      'Nadia Cho',
      'Bram Halstead',
      'Kira Sol',
      STARTER_UNSPENT_HUNTER,
    ]);
    expect(starterCampaign(repaired, stamp, RULES, { includePregens: true })).toEqual({ ok: false, why: 'already' });
  });

  test('does not delete or neutralize an existing hunter when the starter story already exists', () => {
    const base = install();
    const template = starterStory(RULES);
    const withStoryOnly: Save = {
      ...base,
      library: { ...base.library, stories: [{ ...template, id: saveId('st', 99) }] },
    };
    const after = ok(starterCampaign(withStoryOnly, stamp, RULES, { includePregens: false }));
    expect(after.hunters.map(h => h.id)).toEqual(base.hunters.map(h => h.id));
    expect(after.gates.map(g => g.name)).toEqual([STARTER_GATE.name]);
    expect(after.library.stories).toHaveLength(1);
  });

  test('exports plain wording tables for reload dialog and refusals', () => {
    expect(STARTER_WORDS.button).toBe('Load starter campaign');
    expect(STARTER_WORDS.pregensLabel).toBe('Include 4 sample hunters');
    expect(STARTER_REFUSAL_WORDS.already).toContain(STARTER_STORY_NAME);
    expect(STARTER_REFUSAL_WORDS.full).toContain('Workshop');
  });
});
