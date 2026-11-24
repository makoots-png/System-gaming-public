import { describe, expect, test } from 'bun:test';
import { ARC, PREGENS, STARTER_GATES, ownSeed, seedOf, starterCampaign } from '../src/core/starter.ts';
import { freshSave, newMonster } from '../src/core/save.ts';
import type { ParseEnv, Save } from '../src/core/save.ts';
import { RULES } from '../src/core/rules.ts';
import { dayKey } from '../src/core/day.ts';
import { hunterSheet } from '../src/core/hunter/sheet.ts';
import { hpOf } from '../src/core/hunter/vitals.ts';
import { isRefused } from '../src/core/save-step.ts';
import { den, gid, mid } from './models/gate-events.ts';
import { dev } from './fixtures/ids.ts';

const NOW = new Date('2026-11-12T12:00:00.000Z');
const env = (): ParseEnv => ({ now: NOW, newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-test') });
const stamp = { at: NOW.toISOString(), cap: RULES.logCap };
/** A new install's save, before first-run setup. */
const install = (): Save => freshSave(env(), { onboarded: false });
/** The rolled starter gates handed to `starterCampaign`. */
function made(save: Save) {
  const gates = STARTER_GATES.map((g, i) => ({ gate: { ...den('detected'), id: gid(`g-s${i}`), name: g.name, rank: g.rank, type: g.type }, monsters: [{ ...newMonster(), id: mid(`m-s${i}`) }] }));
  return { save, gates };
}
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

describe('the starter campaign, one step', () => {
  const { save, gates } = made(install());
  const s = ok(starterCampaign(save, { gates }, stamp, RULES));

  test('the seed leaves and the three pregens are the party, the first active, and this phone is the GM\'s', () => {
    expect(s.hunters.map(h => h.name)).toEqual(PREGENS.map(p => p.name));
    expect(seedOf(s)).toBeNull();
    expect(s.settings.activeHunterId).toBe(s.hunters[0]!.id);
    expect(s.settings.mode).toBe('gm');
  });
  test('each pregen has its job, its creation stats, its two skills, its gear worn and full HP and mana', () => {
    for (const [i, p] of PREGENS.entries()) {
      const h = s.hunters[i]!, sheet = hunterSheet(h, RULES).sheet;
      expect(h.job).toBe(p.job);
      for (const [k, v] of Object.entries(p.stats)) expect(h.stats[k as keyof typeof h.stats]).toBe(v);
      expect(h.skills.map(k => k.name)).toEqual(p.skills.map(k => k.name));
      expect(h.items.map(x => x.name)).toEqual([p.item.name]);
      if (h.items[0]!.slot) expect(h.equipped[h.items[0]!.slot]).toBe(h.items[0]!.id);
      expect(hpOf(h.life, sheet.hpMax)).toBe(sheet.hpMax);
      expect(h.mana).toBe(sheet.manaMax);
    }
  });
  test('each pregen holds the three sessions of the arc beside its daily, and the gates and their monsters are in the save', () => {
    for (const h of s.hunters) {
      expect(h.quests.filter(q => q.kind === 'daily')).toHaveLength(1);
      expect(h.daily.lastCheckedKey).toBe(dayKey(NOW, save.settings.dailyResetHour));
      expect(h.quests.filter(q => q.kind !== 'daily').map(q => q.title)).toEqual(ARC.map(q => q.title));
    }
    expect(s.gates.map(g => g.name).sort()).toEqual(STARTER_GATES.map(g => g.name).sort());
    expect(s.monsters.map(m => m.id).sort()).toEqual(['m-s0', 'm-s1']);
  });
  test('every id is new and the log ends with the campaign\'s line', () => {
    const ids = [...s.hunters.flatMap(h => [h.id, ...h.skills.map(k => k.id), ...h.items.map(x => x.id), ...h.quests.map(q => q.id)]), ...s.log.map(l => l.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(s.log[0]!.title).toBe('Campaign begun');
  });
  test('handed the wrong number of gates, it is refused and nothing is written', () => {
    expect(starterCampaign(save, { gates: gates.slice(1) }, stamp, RULES)).toEqual({ ok: false, why: 'made' });
  });
});
