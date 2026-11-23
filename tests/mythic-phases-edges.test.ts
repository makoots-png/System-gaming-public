// Adversarial probes for mythic-phases-on (bb36a784..HEAD).
import { describe, expect, test } from 'bun:test';
import { RULES, rulesOf } from '../src/core/rules.ts';
import { DOCS } from '../src/core/protocol.ts';
import { roomRulesOf, withRoomRules } from '../src/core/hunter/build.ts';
import { parseSave, newSave } from '../src/core/save.ts';
import { parseFight } from '../src/core/combat/fight-parse.ts';
import { reduce, fightId } from '../src/core/combat/fight.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import type { RowHunter } from '../src/core/combat/rows.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import { place } from '../src/core/combat/space.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';
import { MYTHICS } from '../src/core/registry/mythics.ts';
import { mythicSeenOf, omenBanner, omenOnYou } from '../src/core/combat/fight-view.ts';
import { mythicStep } from '../src/core/combat/mythic.ts';
import { mythicSwitched } from '../src/core/mythic-switch.ts';
import { tick } from '../src/core/combat/timeline.ts';
import type { OmenKey } from '../src/core/combat/mythic-types.ts';

const ENV = {
  now: new Date('2026-11-22T12:00:00Z'),
  newDeviceId: () => 'd-test-device-1' as any,
  newDeviceToken: () => 'tok-1234567890abcdef',
};

const ANGEL = seedMonsters(RULES).find(m => m.script === 'angel-of-the-last-trumpet')!;
const HUNTER: RowHunter = {
  id: 'h1', name: 'Kai',
  stats: { str: 14, agi: 12, vit: 12, ins: 10, dis: 10, pre: 10, pow: 10, ctl: 10 },
  level: 1, rank: 'E', life: { at: 'up', hp: 30 }, mana: 20, fatigue: 0,
  penalty: null, hpAdj: 0, manaAdj: 0, titleId: null,
  items: [], equipped: {}, skills: [], titles: [], conditions: [],
  build: { path: null, picks: [] },
};

describe('mythic-phases-on adversarial probes', () => {
  test('probe: old save with no mythic field in rulesOverrides loads with scripts on', () => {
    const raw = JSON.parse(JSON.stringify(newSave('d-old-1' as any)));
    raw.rulesOverrides = { fight: { armorK: 55 } };
    const loaded = parseSave(JSON.stringify(raw), ENV);
    expect(loaded.kind).toBe('save');
    if (loaded.kind !== 'save') throw new Error('expected save');
    const R = rulesOf(loaded.save.rulesOverrides, loaded.save.library.statuses);
    expect(R.fight.mythic.scripts).toBe(true);
    expect(R.fight.armorK).toBe(55);
  });

  test('probe: old save with a fight whose rows lack the mythic field drops the whole fight', () => {
    const rows = [
      hunterRow(HUNTER, combatantId('c1'), RULES),
      ...monsterRows(ANGEL, [combatantId('m1')], RULES),
    ];
    const setup = reduce(null, { type: 'add', fightId: fightId('f1'), rows, openings: [] }, { rules: RULES }).fight!;
    const legacy = JSON.parse(JSON.stringify(setup));
    for (const r of legacy.rows) delete r.mythic;
    // Note: this was already true at base bb36a784; verify actual behavior
    expect(parseFight(legacy, RULES)).toBeNull();
  });

  test('probe: old room rules doc without mythic field reads as scripts off and overrides player default', () => {
    const full = roomRulesOf(RULES);
    expect(full.mythic).toEqual({ scripts: true });
    const { mythic: _drop, ...oldDoc } = full;
    const parsed = DOCS.rules(JSON.parse(JSON.stringify(oldDoc)))!;
    expect(parsed.mythic).toEqual({ scripts: false });
    expect(withRoomRules(RULES, parsed).fight.mythic.scripts).toBe(false);
  });

  test('probe: setup fight with mythic added before flipping switch off still starts with phases on', () => {
    const rows = [
      hunterRow(HUNTER, combatantId('c1'), RULES),
      ...monsterRows(ANGEL, [combatantId('m1')], RULES),
    ];
    const setup = reduce(null, { type: 'add', fightId: fightId('f1'), rows, openings: [] }, { rules: RULES }).fight!;
    // GM flips switch off while fight is still in setup (not running)
    const offSave = mythicSwitched({ rulesOverrides: {} }, false);
    const offRules = rulesOf(offSave.rulesOverrides, {});
    expect(offRules.fight.mythic.scripts).toBe(false);
    // Start the fight under offRules
    const started = reduce(setup, {
      type: 'start',
      openings: [{ id: combatantId('c1'), d20: 15, tie: 0 }, { id: combatantId('m1'), d20: 10, tie: 0 }],
    }, { rules: offRules }).fight!;
    const angel = started.rows.find(r => r.id === combatantId('m1'))!;
    // Intent: switch hint says "A fight already running keeps the way it began." Setup is not running, yet mythic standing remains!
    expect(angel.mythic).toBeNull();
  });

  test('probe: setup fight refuses mythic next phase with notNow even though combat.js renders Next phase button', () => {
    const rows = [
      hunterRow(HUNTER, combatantId('c1'), RULES),
      ...monsterRows(ANGEL, [combatantId('m1')], RULES),
    ];
    const setup = reduce(null, { type: 'add', fightId: fightId('f1'), rows, openings: [] }, { rules: RULES }).fight!;
    const res = reduce(setup, { type: 'mythic', by: combatantId('m1'), step: 'next' }, { rules: RULES });
    expect(res.effects).toEqual([{ type: 'refused', reason: 'notNow' }]);
  });

  test('probe: omenOnYou fails to warn a player standing in The First Breath (self-aimed blast) tiles', () => {
    const rows = [
      hunterRow(HUNTER, combatantId('c1'), RULES),
      ...monsterRows(ANGEL, [combatantId('m1')], RULES).map(r => ({ ...r, place: place(4, 2) })),
    ];
    const setup = reduce(null, { type: 'add', fightId: fightId('f1'), rows, openings: [] }, { rules: RULES }).fight!;
    const angel = setup.rows.find(r => r.id === combatantId('m1'))!;
    if (angel.kind !== 'monster') throw new Error('expected monster');
    const standing = mythicStep(angel.mythic!, {
      type: 'announce', omen: 'breath' as OmenKey, aim: angel.id, hpAt: 100, barAt: null,
    });
    if ('ok' in standing) throw new Error('announce refused');
    const seen = mythicSeenOf({ ...angel, mythic: standing })!;
    // Hunter is at (3, 2), Angel is at (4, 2) -> distance 1 <= reach 4
    const msg = omenOnYou(seen, combatantId('c1'), { x: 3, y: 2 }, RULES);
    expect(msg).toBe('You are in the marked tiles.');
  });

  // plain-copy lane owns the words
  test.todo('probe: omenBanner for Stars Fall uses British spelling "centre" instead of "center" (plain-copy lane owns the words)', () => {
    const rows = [
      hunterRow(HUNTER, combatantId('c1'), RULES),
      ...monsterRows(ANGEL, [combatantId('m1')], RULES),
    ];
    const setup = reduce(null, { type: 'add', fightId: fightId('f1'), rows, openings: [] }, { rules: RULES }).fight!;
    const angel = setup.rows.find(r => r.id === combatantId('m1'))!;
    if (angel.kind !== 'monster') throw new Error('expected monster');
    const standing = mythicStep(angel.mythic!, {
      type: 'announce', omen: 'stars' as OmenKey, aim: place(3, 2), hpAt: 100, barAt: null,
    });
    if ('ok' in standing) throw new Error('announce refused');
    const seen = mythicSeenOf({ ...angel, mythic: standing })!;
    const banner = omenBanner(seen, setup.rows, tick(0), RULES)!;
    expect(banner.answers.join('\n')).not.toContain('centre');
  });
});
