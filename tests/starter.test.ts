import { describe, expect, test } from 'bun:test';
import {
  PREGENS,
  STARTER_GATE,
  STARTER_STORY_NAME,
  STARTER_UNSPENT_HUNTER,
  ownSeed,
  seedOf,
  starterCampaign,
  starterStory,
} from '../src/core/starter.ts';
import { LIMITS, createHunter, freshSave, repairSave } from '../src/core/save.ts';
import type { ParseEnv, Save } from '../src/core/save.ts';
import { RULES } from '../src/core/rules.ts';
import { dayKey } from '../src/core/day.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { available, capDisplayChip } from '../src/core/hunter/progress.ts';
import { hpOf } from '../src/core/hunter/vitals.ts';
import { activeGateWave, hasGateWaves, parseGate, waveRoster } from '../src/core/gates/gate.ts';
import { CHAPTER_MAX, STORY_BOUNDS, chapterSize, parseStory } from '../src/core/story/story.ts';
import { REWARD_BOUNDS, WORDS_BOUNDS } from '../src/core/rewards.ts';
import { isRefused } from '../src/core/save-step.ts';
import { saveId, seedId } from '../src/core/ids.ts';
import { dev } from './fixtures/ids.ts';

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
      expect(h.items.map(x => x.name)).toEqual(p.items.map(x => x.name));
      expect(h.items.some(x => x.name === 'Health Potion (E)')).toBe(true);
      for (const item of h.items) {
        if (item.slot) expect(h.equipped[item.slot]).toBe(item.id);
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
    const shield = dolan.items.find(i => i.name === 'Dented Tower Shield')!;
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
    });
    expect(waveRoster(g, 2)).toEqual({
      monsters: [{ monsterId: seedId<'m'>('usher'), count: 2, wave: 2 }],
      bossId: seedId<'m'>('head-usher'),
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
    expect(story.chapters[0]!.rewards.items[0]).toMatchObject({ name: 'Health Potion (E)', qty: 2, rankCap: true });
    expect(story.chapters[0]!.quest?.title).toBe("Thursday's Gate");
    expect(story.chapters[0]!.quest?.rewards.xp).toBe(50);
    expect(story.chapters[1]!.quest?.title).toBe('Tidewall Cannery Gate');
    expect(story.chapters[1]!.quest?.rewards).toMatchObject({ xp: 100, points: 1 });
    expect(story.chapters[4]!.rewards.title).toMatchObject({ name: 'Guest', bonus: { dis: 1 } });
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

  test('a refusal writes nothing when the story library is full or already holds The Empty Seat', () => {
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
    expect(starterCampaign(alreadyLoaded, stamp, RULES)).toEqual({ ok: false, why: 'taken' });
    expect(JSON.stringify(alreadyLoaded)).toBe(snapLoaded);
  });
});
