// Unit 3 tests for NPC combat rows, wire projection, parse validation, dodge auto-pick, holdsSide (Fork 3),
// fightRested, downOf, pay, kill/ally facts, and Auto turn.
import { describe, expect, test } from 'bun:test';
import { RULES } from '../src/core/rules.ts';
import { newHunter, newSave } from '../src/core/save.ts';
import { newNpc, npcTierPreset } from '../src/core/registry/npcs.ts';
import { xpOf, seedMonsters } from '../src/core/registry/monsters.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { abilityId, combatantId, hunterId } from '../src/core/combat/ability-types.ts';
import type { CombatantId } from '../src/core/combat/ability-types.ts';
import { fightId, parseSheetKey } from '../src/core/ids.ts';
import type { DeviceId, SheetKey } from '../src/core/ids.ts';
import { hunterRow, monsterRows, npcRows } from '../src/core/combat/rows.ts';
import { parseFight } from '../src/core/combat/fight-parse.ts';
import { dodgeAsk, reduce } from '../src/core/combat/fight.ts';
import type { Command, Ctx, Ended, Fight, NewRow, Running, Setup } from '../src/core/combat/fight.ts';
import { fightRested, holdsSide } from '../src/core/combat/fight-turn.ts';
import { rowHp } from '../src/core/combat/row-hp.ts';
import { rowIcon } from '../src/core/combat/row-icon.ts';
import { killsSeen, rowFacts } from '../src/core/combat/fight-facts.ts';
import { docSpots, onMap } from '../src/core/combat/fight-view.ts';
import { fightDoc, fightWire } from '../src/core/combat/fight-doc.ts';
import type { DocContext, FightDoc } from '../src/core/combat/fight-doc.ts';
import { EVERYTHING, docBodies, docDodge, fightBodies, mapScene } from '../src/core/combat/map-view.ts';
import { DOCS, DOC_MAX, onTurn } from '../src/core/protocol.ts';
import { openGrid, percent, place, tiles } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { autoTurnOf, isAutoRow, sensible } from '../src/core/combat/policy.ts';
import { playBegin, playOver, playStep } from '../src/core/combat/play.ts';
import type { Play } from '../src/core/combat/play.ts';
import { weighable } from '../src/core/combat/odds.ts';
import { planEncounter } from '../src/core/gates/pay.ts';
import { resolve } from '../src/core/combat/resolve.ts';
import { parseFormula } from '../src/core/formula.ts';

const ctx: Ctx = { rules: RULES };
const id = combatantId;
const ME = 'd-gm' as DeviceId;
const AT = '2026-11-27T01:00:00.000Z';
const docCtx = (o: Partial<DocContext> = {}): DocContext => ({
  by: ME, at: AT, was: null, keyOf: h => `${ME}:${h}` as SheetKey, ...o,
});
const f = (text: string) => {
  const p = parseFormula(text, RULES);
  if (!p.ok) throw new Error(p.error);
  return p.formula;
};
const KILL_HIT = {
  ...abilityOf('strike', { id: abilityId('kill-hit'), name: 'Finish' }, RULES),
  range: tiles(20),
  shape: { kind: 'touch' as const, reach: tiles(20) },
  effect: { type: 'physical' as const, by: 'hand' as const, formula: f('9999') },
};
const BLAST = abilityOf('blast', {
  id: abilityId('frost-nova'),
  name: 'Frost Nova',
  range: tiles(8),
  foesOnly: true,
  shape: { kind: 'radius', radius: tiles(1), ring: { outer: tiles(2), share: percent(50) } },
}, RULES);

const allyTpl = () => newNpc({
  name: 'Mira Scout',
  rank: 'E',
  archetype: 'skirmisher',
  defaultSide: 'party',
  skill: 4,
  icon: 'bow',
  notes: 'GM secret ally note.',
});

const foeTpl = (tier: 'normal' | 'elite' | 'boss' = 'elite') => newNpc({
  name: 'Rival Vance',
  rank: 'C',
  archetype: 'brute',
  ...npcTierPreset(tier === 'normal' ? 'standard' : tier),
  defaultSide: 'foe',
  skill: 2,
  icon: 'skull',
  notes: 'GM secret foe note.',
});

function play(...commands: Command[]): Fight {
  let fight: Fight | null = null;
  for (const cmd of commands) {
    const r = reduce(fight, cmd, ctx);
    const no = r.effects.find(e => e.type === 'refused');
    if (no) throw new Error(`${cmd.type} refused: ${JSON.stringify(no)}`);
    fight = r.fight;
  }
  return fight!;
}

const add = (...rows: NewRow[]): Command => ({ type: 'add', fightId: fightId('f-npc'), rows, openings: [] });
const start = (...list: [CombatantId, number][]): Command => ({
  type: 'start',
  openings: list.map(([rid, d20]) => ({ id: rid, d20, tie: 0 })),
});

const localHunter = (name: string, cid: string) => {
  const h = { ...newHunter(RULES), id: hunterId(`h-${cid}`), name };
  return { hunter: h, row: hunterRow(h, id(cid), RULES) };
};

describe('npcRows and rowIcon', () => {
  test('builds hunter rows with holder null, npc.skill, monster origin, auto-lettering, and tier XP only for foes', () => {
    const ally = npcRows(allyTpl(), [id('a1')], RULES)[0]!;
    expect(ally.kind).toBe('hunter');
    expect(ally.side).toBe('party');
    expect(ally.holder).toBeNull();
    expect(ally.xp).toBe(0);
    expect(ally.npc).toEqual({ skill: 4 });
    expect(ally.origin.kind).toBe('monster');
    expect(ally.abilities[0]?.id).toBe(abilityId('attack'));
    expect(rowIcon(ally, null)).toBe('bow');

    const squad = npcRows(foeTpl('elite'), [id('f1'), id('f2'), id('f3')], RULES);
    expect(squad.map(r => r.name)).toEqual(['Rival Vance A', 'Rival Vance B', 'Rival Vance C']);
    const eliteXp = xpOf(RULES, 'C', 'elite');
    expect(squad.every(r => r.kind === 'hunter' && r.side === 'foe' && r.holder === null && r.xp === eliteXp)).toBe(true);
    expect(squad[0]?.npc).toEqual({ skill: 2 });
    expect(rowIcon(squad[0]!, null)).toBe('skull');

    // Side and skill overrides work per fight.
    const flipped = npcRows(allyTpl(), [id('x1')], RULES, { side: 'foe', skill: 5 })[0]!;
    expect(flipped.side).toBe('foe');
    expect(flipped.npc).toEqual({ skill: 5 });
    expect(flipped.xp).toBe(xpOf(RULES, 'E', 'normal'));

    // Normal, elite, boss XP scale 1x, 1.5x, 3x.
    const normalRow = npcRows(foeTpl('normal'), [id('n1')], RULES)[0]!;
    const bossRow = npcRows(foeTpl('boss'), [id('b1')], RULES)[0]!;
    expect(normalRow.xp).toBe(xpOf(RULES, 'C', 'normal'));
    expect(bossRow.xp).toBe(xpOf(RULES, 'C', 'boss'));
    expect(bossRow.xp).toBeGreaterThan(squad[0]!.xp);
    expect(squad[0]!.xp).toBeGreaterThan(normalRow.xp);
  });

  test('rowIcon falls back to archetype icon when NPC has no custom icon', () => {
    const plain = newNpc({ name: 'Mage Ally', archetype: 'caster', defaultSide: 'party' });
    const r = npcRows(plain, [id('m1')], RULES)[0]!;
    expect(rowIcon(r, null)).not.toBeNull();
  });
});

describe('fight-parse OWN.hunter with npc and xp', () => {
  test('round-trips ally and foe NPC rows and rejects malformed npc, holder, or xp', () => {
    const ally = npcRows(allyTpl(), [id('a1')], RULES)[0]!;
    const foe = npcRows(foeTpl('boss'), [id('f1')], RULES)[0]!;
    const h = localHunter('Brakk', 'h1').row;
    const fought = play(add(h, ally, foe), start([id('h1'), 20], [id('a1'), 15], [id('f1'), 10]));
    const raw = JSON.parse(JSON.stringify(fought));
    const parsed = parseFight(raw, RULES);
    expect(parsed).not.toBeNull();
    expect(parsed!.rows.find(r => r.id === id('a1'))?.npc).toEqual({ skill: 4 });
    expect(parsed!.rows.find(r => r.id === id('f1'))?.xp).toBe(foe.xp);

    // Non-null holder on an NPC row is refused.
    const badHolder = JSON.parse(JSON.stringify(fought));
    badHolder.rows[1].holder = { kind: 'local', hunterId: 'h-1' };
    expect(parseFight(badHolder, RULES)).toBeNull();

    // Skill out of 1..5 is refused.
    for (const badSkill of [0, 6, 2.5, '3', null, undefined]) {
      const bad = JSON.parse(JSON.stringify(fought));
      bad.rows[1].npc = { skill: badSkill };
      expect(parseFight(bad, RULES), `skill=${String(badSkill)}`).toBeNull();
    }

    // Non-object npc is refused.
    const badNpc = JSON.parse(JSON.stringify(fought));
    badNpc.rows[1].npc = true;
    expect(parseFight(badNpc, RULES)).toBeNull();

    // Negative or fractional XP on NPC is refused.
    for (const badXp of [-1, 1.5]) {
      const bad = JSON.parse(JSON.stringify(fought));
      bad.rows[2].xp = badXp;
      expect(parseFight(bad, RULES), `xp=${badXp}`).toBeNull();
    }

    // Non-zero XP on a non-NPC hunter is refused.
    const hunterWithXp = JSON.parse(JSON.stringify(fought));
    hunterWithXp.rows[0].xp = 40;
    expect(parseFight(hunterWithXp, RULES)).toBeNull();

    // Monster carrying npc is refused.
    const gob = monsterRows(seedMonsters(RULES)[0]!, [id('m1')], RULES)[0]!;
    const mf = play(add(h, gob));
    const monNpc = JSON.parse(JSON.stringify(mf));
    monNpc.rows[1].npc = { skill: 3 };
    expect(parseFight(monNpc, RULES)).toBeNull();
  });
});

describe('wire format, band-only foe NPC, dead tile parity, secrecy, and DOC_MAX', () => {
  test('ally NPC sends exact HP; foe NPC omits h/hm/r/m on wire, renders band-only, keeps dead tile, and hides skill/notes', () => {
    const h = localHunter('Brakk', 'h1').row;
    const ally = npcRows(allyTpl(), [id('a1')], RULES)[0]!;
    const foe = npcRows(foeTpl('elite'), [id('f1')], RULES)[0]!;
    const running = play(
      add(h, ally, foe),
      start([id('h1'), 20], [id('a1'), 15], [id('f1'), 10]),
      { type: 'adjust', id: id('f1'), hp: -Math.floor(foe.life.at === 'up' ? foe.life.hp * 0.4 : 10) },
    );

    const doc = fightDoc(running, RULES, docCtx())!;
    expect(doc.ended).toBe(false);
    if (doc.ended) return;

    const allyDoc = doc.rows.find(r => r.id === id('a1'))!;
    expect(allyDoc.kind).toBe('hunter');
    expect(allyDoc.key).toBeNull();
    expect(allyDoc.side).toBe('party');
    if (allyDoc.kind !== 'hunter') throw new Error('expected hunter');
    expect(allyDoc.hp).toBeGreaterThan(0);
    expect(allyDoc.hpMax).toBeGreaterThan(0);
    expect(allyDoc.icon).toBe('bow');

    const foeDoc = doc.rows.find(r => r.id === id('f1'))!;
    expect(foeDoc.kind).toBe('hunter');
    expect(foeDoc.key).toBeNull();
    expect(foeDoc.side).toBe('foe');
    expect(foeDoc.band).toBe('wounded');
    expect(foeDoc.icon).toBe('skull');
    expect('hp' in foeDoc).toBe(false);
    expect('hpMax' in foeDoc).toBe(false);
    expect('stride' in foeDoc).toBe(false);
    expect('move' in foeDoc).toBe(false);

    // Wire omits h, hm, r, m on foe hunter and never carries skill or notes.
    const wire = fightWire(doc) as { rows: Record<string, unknown>[] };
    const wireJson = JSON.stringify(wire);
    expect(wireJson).not.toContain('skill');
    expect(wireJson).not.toContain('GM secret');
    expect(wireJson).not.toContain('"npc"');
    const foeWire = wire.rows.find(r => r.i === 'f1')!;
    expect(foeWire.q).toBe('hunter');
    expect(foeWire.h).toBeUndefined();
    expect(foeWire.hm).toBeUndefined();
    expect(foeWire.r).toBeUndefined();
    expect(foeWire.m).toBeUndefined();

    // Round-trip through DOCS.fight matches doc.
    const read = DOCS.fight(JSON.parse(wireJson)) as FightDoc;
    expect(read).toEqual(doc);

    // Protocol drops a foe hunter carrying h/hm and drops a party hunter omitting h/hm.
    const smuggled = JSON.parse(wireJson);
    smuggled.rows.find((r: Record<string, unknown>) => r.i === 'f1').h = 10;
    smuggled.rows.find((r: Record<string, unknown>) => r.i === 'f1').hm = 20;
    const smuggledDoc = DOCS.fight(smuggled) as FightDoc;
    expect(smuggledDoc && !smuggledDoc.ended && smuggledDoc.rows.find(r => r.id === id('f1'))).toBeUndefined();

    const missingAllyHp = JSON.parse(wireJson);
    const allyW = missingAllyHp.rows.find((r: Record<string, unknown>) => r.i === 'a1');
    delete allyW.h; delete allyW.hm; delete allyW.r; delete allyW.m;
    const missingDoc = DOCS.fight(missingAllyHp) as FightDoc;
    expect(missingDoc && !missingDoc.ended && missingDoc.rows.find(r => r.id === id('a1'))).toBeUndefined();

    // map-view docBodies draws exact bars for ally NPC and band-only (no bars) for foe NPC.
    const bodies = docBodies(doc.rows, () => false, openGrid(doc.grid.w, doc.grid.h));
    const allyBody = bodies.find(b => b.id === id('a1'))!;
    const foeBody = bodies.find(b => b.id === id('f1'))!;
    expect(allyBody.bars).not.toBeNull();
    expect(allyBody.ring.band).toBeNull();
    expect(foeBody.bars).toBeNull();
    expect(foeBody.ring.band).toBe('wounded');

    // Dead foe NPC stays on the map and blocks movement on both phones (GM reducer refuses `taken`, player map omits the tile).
    const withDeadFoe = play(
      add(
        { ...h, place: place(2, 2) },
        { ...foe, place: place(2, 3) },
        { ...npcRows(foeTpl('normal'), [id('f2')], RULES)[0]!, place: place(6, 6) },
      ),
      start([id('h1'), 20], [id('f1'), 15], [id('f2'), 10]),
      { type: 'adjust', id: id('f1'), hp: -9999 },
    );
    const deadDoc = fightDoc(withDeadFoe, RULES, docCtx())!;
    if (deadDoc.ended) throw new Error('expected live fight');
    const deadSpot = docSpots(deadDoc.rows).find(s => s.id === id('f1'))!;
    expect(deadSpot.down).toBe(true);
    expect(deadSpot.kind).toBe('hunter');
    expect(onMap(deadSpot)).toBe(true);
    const blocked = reduce(withDeadFoe, { type: 'move', by: id('h1'), to: place(2, 3) }, ctx);
    expect(blocked.effects).toEqual([{ type: 'refused', reason: 'taken' }]);
    expect(blocked.fight?.rows.find(r => r.id === id('h1'))?.place).toEqual(place(2, 2));
    const playerScene = mapScene(
      { bodies: docBodies(deadDoc.rows, r => r.id === id('h1'), openGrid(deadDoc.grid.w, deadDoc.grid.h)), grid: openGrid(deadDoc.grid.w, deadDoc.grid.h), currentId: id('h1'), actor: id('h1') },
      { kind: 'none' },
      RULES,
    );
    expect(playerScene.focus.kind).toBe('move');
    if (playerScene.focus.kind === 'move') {
      expect(playerScene.focus.stride.some(p => p.x === 2 && p.y === 3)).toBe(false);
      expect(playerScene.focus.dash.some(p => p.x === 2 && p.y === 3)).toBe(false);
    }
  });

  test('fightWire(fightDoc(f)) is byte-identical for the same fight at skill 1 and skill 5', () => {
    const build = (skill: 1 | 5, notes: string) => {
      const h = localHunter('Brakk', 'h1').row;
      const aTpl = { ...allyTpl(), skill, notes };
      const fTpl = { ...foeTpl('elite'), skill, notes };
      const ally = npcRows(aTpl, [id('a1')], RULES)[0]!;
      const foe = npcRows(fTpl, [id('f1')], RULES)[0]!;
      return play(
        add({ ...h, place: place(2, 2) }, { ...ally, place: place(2, 1) }, { ...foe, place: place(4, 2) }),
        start([id('h1'), 20], [id('a1'), 15], [id('f1'), 10]),
        { type: 'adjust', id: id('f1'), hp: -5 },
      );
    };
    const w1 = JSON.stringify(fightWire(fightDoc(build(1, 'GM secret one'), RULES, docCtx())!));
    const w5 = JSON.stringify(fightWire(fightDoc(build(5, 'GM secret five'), RULES, docCtx())!));
    expect(w1).toBe(w5);
  });

  test('lettered NPC copies are told apart by corner letter and name plate on both GM and player maps', () => {
    const h = localHunter('Brakk Ironhide', 'h1').row;
    const squad = npcRows(foeTpl('elite'), [id('f1'), id('f2'), id('f3')], RULES);
    const live = play(
      add(
        { ...h, place: place(1, 1) },
        { ...squad[0]!, place: place(3, 1) },
        { ...squad[1]!, place: place(5, 1) },
        { ...squad[2]!, place: place(7, 1) },
      ),
      start([id('h1'), 20], [id('f1'), 15], [id('f2'), 10], [id('f3'), 5]),
    );
    const grid = live.grid;
    const gmTokens = mapScene(
      { bodies: fightBodies(live, RULES, b => b.id === id('h1'), EVERYTHING), grid, currentId: id('h1'), actor: id('h1') },
      { kind: 'none' },
      RULES,
    ).tokens;
    const doc = DOCS.fight(JSON.parse(JSON.stringify(fightWire(fightDoc(live, RULES, docCtx())!)))) as Extract<FightDoc, { ended: false }>;
    const playerTokens = mapScene(
      { bodies: docBodies(doc.rows, r => r.id === id('h1'), openGrid(doc.grid.w, doc.grid.h)), grid: openGrid(doc.grid.w, doc.grid.h), currentId: id('h1'), actor: id('h1') },
      { kind: 'none' },
      RULES,
    ).tokens;

    const summary = (tokens: typeof gmTokens) => tokens.map(t => [t.id, t.letter, t.plate?.text ?? null]);
    const expected = [
      ['h1', null, 'Brakk'],
      ['f1', 'A', 'Vance A'],
      ['f2', 'B', 'Vance B'],
      ['f3', 'C', 'Vance C'],
    ];
    expect(summary(gmTokens)).toEqual(expected);
    expect(summary(playerTokens)).toEqual(expected);
  });

  test('30 NPC rows (mix of ally and foe) stay well below eight ninths of DOC_MAX', () => {
    const allies = npcRows(allyTpl(), Array.from({ length: 15 }, (_, i) => id(`a${i}`)), RULES);
    const foes = npcRows(foeTpl('boss'), Array.from({ length: 15 }, (_, i) => id(`f${i}`)), RULES);
    const fight = play(add(...allies, ...foes));
    const wire = fightWire(fightDoc(fight, RULES, docCtx())!);
    expect(JSON.stringify(wire).length).toBeLessThan(Math.floor(DOC_MAX * 8 / 9));
  });

  test('onTurn refuses player taps when an NPC holds the current turn', () => {
    const ally = npcRows(allyTpl(), [id('a1')], RULES)[0]!;
    const foe = npcRows(foeTpl('normal'), [id('f1')], RULES)[0]!;
    const running = play(add(ally, foe), start([id('a1'), 20], [id('f1'), 10])) as Running;
    expect(running.currentId).toBe(id('a1'));
    expect(onTurn(running, { by: parseSheetKey('d-p1:h1')!, at: running.now })).toBeNull();
  });
});

describe('NPC dodge resolution (auto-pick, no prompt)', () => {
  test('blast hitting an NPC resolves with opts.auto without opening a dodge prompt, while still prompting a player hunter', () => {
    const h = localHunter('Brakk', 'h1').row;
    const ally = npcRows(allyTpl(), [id('a1')], RULES)[0]!;
    const foe = npcRows(foeTpl('normal'), [id('f1')], RULES)[0]!;
    const setup = play(
      add(
        { ...h, place: place(4, 7) },
        { ...ally, place: place(4, 4) },
        { ...foe, place: place(4, 1), abilities: [BLAST] },
      ),
      start([id('f1'), 20], [id('h1'), 10], [id('a1'), 5]),
    ) as Running;
    const fRow = setup.rows.find(r => r.id === id('f1'))!;
    // Resolve blast aimed at ally NPC's tile with picks object enabled (interactive path).
    const res = resolve(BLAST, fRow, setup.rows, place(4, 4), setup.grid, { dice: { [id('a1')]: [1, 1] }, react: { [id('a1')]: 20 } }, setup.now, RULES, null, {});
    expect('ask' in res).toBe(false);
    expect('ok' in res && res.ok).toBe(true);

    // Same blast aimed at player hunter opens a DodgeAsked prompt.
    const resHunter = resolve(BLAST, fRow, setup.rows, place(4, 7), setup.grid, { dice: { [id('h1')]: [1, 1] }, react: { [id('h1')]: 20 } }, setup.now, RULES, null, {});
    expect('ask' in resHunter && resHunter.ask).toBe(true);
  });

  test('when an ally NPC auto-dodges before a player hunter in the same blast, fightDoc and fightBodies show its pass-1 tile so player dodge options never diverge', () => {
    const slowBlast = { ...BLAST, range: tiles(20), delivery: { kind: 'travel' as const, windup: tick(1200), speed: 'instant' as const } };
    const h = localHunter('Brakk', 'h1').row;
    const ally = npcRows(allyTpl(), [id('a1')], RULES)[0]!;
    const foe = npcRows(foeTpl('normal'), [id('f1')], RULES)[0]!;
    // Ally NPC sits before player hunter in `rows`, so pass 1 auto-dodges `a1` before pausing to prompt `h1`.
    const running = play(
      add(
        { ...ally, place: place(5, 5) },
        { ...h, place: place(5, 6) },
        { ...foe, place: place(1, 5), abilities: [slowBlast] },
      ),
      start([id('f1'), 20], [id('a1'), 10], [id('h1'), 5]),
    ) as Running;
    const paused = reduce(running, {
      type: 'act',
      by: id('f1'),
      ability: slowBlast.id,
      aim: place(5, 5),
      rolls: { dice: { [id('a1')]: [1, 1], [id('h1')]: [1, 1] }, react: { [id('a1')]: 20, [id('h1')]: 20 } },
    }, ctx).fight as Running;
    expect(paused.dodge).toBeDefined();
    expect(paused.dodge!.to).toEqual({});

    const ask = dodgeAsk(paused, RULES)!;
    expect(ask.who).toBe(id('h1'));
    const allyAfter = ask.bodies.find(b => b.id === id('a1'))!.place;
    expect(allyAfter).not.toEqual(place(5, 5));

    // Both fightDoc (player phone) and fightBodies (GM phone) render the auto-dodged ally at its pass-1 tile.
    const doc = fightDoc(paused, RULES, docCtx()) as Extract<FightDoc, { ended: false }>;
    expect(doc.rows.find(r => r.id === id('a1'))!.place).toEqual({ x: allyAfter.x, y: allyAfter.y });
    const gmBody = fightBodies(paused, RULES, b => b.id === id('h1'), EVERYTHING).find(b => b.id === id('a1'))!;
    expect(gmBody.place).toEqual(allyAfter);

    // Player phone's docDodge excludes the ally's pass-1 tile and matches GM ask tiles; every offered tile is accepted by the GM.
    const md = docDodge(doc)!;
    expect(md.tiles.some(t => t.place.x === allyAfter.x && t.place.y === allyAfter.y)).toBe(false);
    expect(md.tiles.map(t => t.place)).toEqual(ask.tiles.map(t => t.place));
    for (const tile of md.tiles) {
      const picked = reduce(paused, { type: 'dodge', id: id('h1'), to: tile.place }, ctx);
      expect(picked.effects.find(e => e.type === 'refused')).toBeUndefined();
    }
  });
});

describe('holdsSide (Fork 3), fightRested, downOf, pay, and fight-facts', () => {
  test('Fork 3: when all player hunters fall while an ally NPC stands, the fight ends immediately in defeat; NPC-only fights and foe NPCs still hold their side', () => {
    const h = localHunter('Brakk', 'h1').row;
    const ally = npcRows(allyTpl(), [id('a1')], RULES)[0]!;
    const foe = npcRows(foeTpl('normal'), [id('f1')], RULES)[0]!;

    const live = play(add(h, ally, foe), start([id('h1'), 20], [id('a1'), 15], [id('f1'), 10])) as Running;
    expect(holdsSide(live.rows.find(r => r.id === id('h1'))!, live.rows)).toBe(true);
    expect(holdsSide(live.rows.find(r => r.id === id('a1'))!, live.rows)).toBe(false);
    expect(holdsSide(live.rows.find(r => r.id === id('f1'))!, live.rows)).toBe(true);

    // Killing the only player hunter ends the fight immediately with winner 'foe'.
    const wiped = reduce(live, { type: 'adjust', id: id('h1'), hp: -9999 }, ctx).fight!;
    expect(wiped.phase).toBe('ended');
    if (wiped.phase === 'ended') expect(wiped.summary.winner).toBe('foe');

    // Setup with a dead player hunter + live ally NPC refuses start and is not weighable.
    const deadSetup = play(add({ ...h, life: { at: 'dead' } }, ally, foe)) as Setup;
    expect(weighable(deadSetup)).toBe(false);
    const badStart = reduce(deadSetup, start([id('h1'), 20], [id('a1'), 15], [id('f1'), 10]), ctx);
    expect(badStart.effects).toEqual([{ type: 'refused', reason: 'needBothSides' }]);

    // NPC-only fight (no player hunter in rows): ally NPC holds party side and fight starts and runs!
    const npcOnly = play(add(ally, foe), start([id('a1'), 20], [id('f1'), 10])) as Running;
    expect(holdsSide(npcOnly.rows.find(r => r.id === id('a1'))!, npcOnly.rows)).toBe(true);
    expect(weighable(npcOnly)).toBe(true);
  });

  test('fightRested skips ally and foe NPCs while recovering living non-NPC hunters', () => {
    const h = localHunter('Brakk', 'h1').row;
    const ally = npcRows(allyTpl(), [id('a1')], RULES)[0]!;
    const foe = npcRows(foeTpl('normal'), [id('f1')], RULES)[0]!;
    const live = play(
      add({ ...h, fatigue: 15 }, { ...ally, fatigue: 15 }, { ...foe, fatigue: 15 }),
      start([id('h1'), 20], [id('a1'), 15], [id('f1'), 10]),
    ) as Running;
    const res = fightRested(live.rows, RULES);
    expect(Object.keys(res.rested)).toEqual([id('h1')]);
    expect(res.rows.find(r => r.id === id('a1'))!.fatigue).toBe(15);
    expect(res.rows.find(r => r.id === id('f1'))!.fatigue).toBe(15);
  });

  test('play.ts downOf tracks only downed party hunters, never dead foe NPCs', () => {
    const h = localHunter('Brakk', 'h1').row;
    const weakFoe = npcRows(newNpc({ name: 'Frail Foe', rank: 'E', archetype: 'skirmisher', tier: 'normal', tweak: { hp: 0.1, dealt: 0.1, stats: {}, traits: [] }, defaultSide: 'foe' }), [id('f1')], RULES)[0]!;
    const setup = play(add({ ...h, place: place(2, 2), abilities: [KILL_HIT] }, { ...weakFoe, place: place(2, 3) })) as Setup;
    let p: Play = playBegin(setup, 1, RULES).play;
    for (let i = 0; !playOver(p) && i < 200; i++) {
      p = playStep(p as Play & { readonly fight: Running }, () => sensible, { capRounds: 40, endAtRounds: null }, RULES).play;
    }
    expect(playOver(p)).toBe(true);
    expect(p.fight.phase === 'ended' && p.fight.summary.winner).toBe('party');
    expect(p.down).toEqual([]);
  });

  test('pay: ally NPC takes no XP share; defeated foe NPC pays its tier XP', () => {
    const save = newSave(ME);
    const { hunter, row: hRow } = localHunter('Brakk', 'h1');
    save.hunters = [hunter];
    const ally = npcRows(allyTpl(), [id('a1')], RULES)[0]!;
    const foe = npcRows(foeTpl('elite'), [id('f1')], RULES)[0]!;
    const ended = play(
      add(hRow, ally, foe),
      start([id('h1'), 20], [id('a1'), 15], [id('f1'), 10]),
      { type: 'adjust', id: id('f1'), hp: -9999 },
    ) as Ended;
    expect(ended.phase).toBe('ended');
    expect(ended.summary.xp).toBe(foe.xp);

    const plan = planEncounter(ended, null, save, RULES.gateParty, () => 0);
    expect(plan.payees).toEqual([{ kind: 'local', hid: hunter.id, name: 'Brakk' }]);
    expect(plan.xp).toBe(foe.xp);
    expect(plan.each).toBe(foe.xp);
    expect(plan.dead).toEqual([{ id: id('f1'), name: 'Rival Vance', xp: foe.xp, monsterId: null }]);
  });

  test('fight-facts: foe NPCs are not counted as monsters (no kill fact, no bossTop/foeTop), and rowFacts excludes ally NPCs from allies/alliesDown', () => {
    const h = localHunter('Brakk', 'h1').row;
    const ally = npcRows(allyTpl(), [id('a1')], RULES)[0]!;
    const foe = npcRows(foeTpl('boss'), [id('f1')], RULES)[0]!;
    const gob = monsterRows(seedMonsters(RULES)[0]!, [id('m1')], RULES)[0]!;
    const live = play(
      add({ ...h, abilities: [KILL_HIT] }, ally, foe, gob),
      start([id('h1'), 20], [id('a1'), 1], [id('f1'), 1], [id('m1'), 1]),
      { type: 'adjust', id: id('a1'), hp: -9999 },
      { type: 'act', by: id('h1'), ability: KILL_HIT.id, aim: id('f1'), rolls: { dice: {}, react: { [id('f1')]: 10 } } },
      { type: 'act', by: id('h1'), ability: KILL_HIT.id, aim: id('m1'), rolls: { dice: {}, react: { [id('m1')]: 10 } }, force: true },
    ) as Ended;
    expect(live.phase).toBe('ended');

    const brakk = live.rows.find(r => r.id === id('h1'))!;
    const seen = killsSeen({ ...brakk.tally!, kills: brakk.tally!.kills!, downedBy: [] } as never, live.rows);
    expect(seen.map(k => k.monster)).toEqual(['Goblin']);

    const facts = rowFacts(live, id('h1'), 'E', '');
    const fightFact = facts.find(x => x.kind === 'fight')!;
    const killFacts = facts.filter(x => x.kind === 'kill');
    expect(killFacts.map(k => k.monster)).toEqual(['Goblin']);
    expect(fightFact).toMatchObject({
      kind: 'fight',
      allies: 0,
      alliesDown: 0,
      foes: 2,
      kills: 2,
      bosses: 0,
      foeTop: 0,
      bossTop: null,
      names: 'Rival Vance, Goblin',
    });
  });
});

describe('autoTurnOf admits monsters and NPCs, refuses player hunters', () => {
  test('builds legal turns for ally and foe NPCs while still refusing non-NPC hunters', () => {
    const h = localHunter('Brakk', 'h1').row;
    const ally = npcRows(allyTpl(), [id('a1')], RULES)[0]!;
    const foe = npcRows(foeTpl('normal'), [id('f1')], RULES)[0]!;

    const onAlly = play(add(h, ally, foe), start([id('a1'), 20], [id('h1'), 10], [id('f1'), 5])) as Running;
    expect(isAutoRow(onAlly.rows.find(r => r.id === id('a1'))!)).toBe(true);
    expect(isAutoRow(onAlly.rows.find(r => r.id === id('f1'))!)).toBe(true);
    expect(isAutoRow(onAlly.rows.find(r => r.id === id('h1'))!)).toBe(false);

    const allyPlan = autoTurnOf(onAlly, id('a1'), RULES, onAlly.now);
    expect(allyPlan.kind).not.toBe('refused');

    const onFoe = play(add(h, ally, foe), start([id('f1'), 20], [id('h1'), 10], [id('a1'), 5])) as Running;
    const foePlan = autoTurnOf(onFoe, id('f1'), RULES, onFoe.now);
    expect(foePlan.kind).not.toBe('refused');

    const onHunter = play(add(h, ally, foe), start([id('h1'), 20], [id('a1'), 10], [id('f1'), 5])) as Running;
    expect(autoTurnOf(onHunter, id('h1'), RULES, onHunter.now)).toEqual({ kind: 'refused', reason: 'notMonster' });
    expect(autoTurnOf(onAlly, id('a1'), RULES, tick(onAlly.now + 1))).toEqual({ kind: 'refused', reason: 'notYourTurn' });
  });
});
