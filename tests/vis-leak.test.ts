import { fightId } from '../src/core/ids.ts';
import { describe, expect, test } from 'bun:test';
import { buildApp } from '../scripts/build.ts';
import { handler } from '../server.ts';
import { RULES } from '../src/core/rules.ts';
import { JOB_NAMES } from '../src/core/registry/jobs.ts';
import { fightDoc, fightWire } from '../src/core/combat/fight-doc.ts';
import { dodgeAsk, reduce } from '../src/core/combat/fight.ts';
import { abilityId, combatantId } from '../src/core/combat/ability-types.ts';
import { abilityOf } from '../src/core/registry/ability-kinds.ts';
import { statusKey, statusOn } from '../src/core/combat/effect-ops.ts';
import { openGrid, place, tiles } from '../src/core/combat/space.ts';
import { tick } from '../src/core/combat/timeline.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import { newHunter } from '../src/core/hunter/hunter.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';
import { chapterBody } from '../src/core/story/story.ts';
import { newRewards } from '../src/core/rewards.ts';
import { parseDeviceId, parseRoomState } from '../src/core/protocol.ts';
import type { StoredEvent } from '../src/core/protocol.ts';

type Reply = { status: number; body: Record<string, any> };

const { build } = await buildApp();

const MIRA_DEV = 'd-mira1';
const KAI_DEV = 'd-kai2';
const MIRA_KEY = `${MIRA_DEV}:h1`;
const KAI_KEY = `${KAI_DEV}:h1`;

const token = (dev: string) => ({ 'x-device-token': dev.padEnd(16, 'x') });

async function call(method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Reply> {
  const init: RequestInit = { method, headers: { 'content-type': 'application/json', 'x-hunter-build': build, ...opts.headers } };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await handler(new Request('http://test' + path, init));
  return { status: res.status, body: await res.json() };
}

/** Create a room with GM plus two authenticated player phones (Mira and Kai). */
async function setupRoom() {
  const made = await call('POST', '/api/rooms');
  expect(made.status).toBe(200);
  const code: string = made.body.code;
  const gm = { 'x-gm-key': made.body.gmKey as string };
  for (const [dev, key, name] of [
    [MIRA_DEV, MIRA_KEY, 'Mira'],
    [KAI_DEV, KAI_KEY, 'Kai'],
  ] as const) {
    const put = await call('PUT', `/api/rooms/${code}/sheets/${encodeURIComponent(key)}`, {
      headers: token(dev),
      body: {
        from: dev,
        data: {
          hunter: {
            id: 'h1',
            name,
            quests: [{ id: 'q-secret', kind: 'side', title: 'Hidden Agenda', status: 'active', secret: true }],
            boons: [{ id: 'b-secret', name: 'Secret Patron', text: 'Only Mira and the GM may read this.' }],
          },
        },
      },
    });
    expect(put.status).toBe(200);
  }
  const postGm = async (type: string, payload: Record<string, unknown>) => {
    const r = await call('POST', `/api/rooms/${code}/events`, { headers: gm, body: { from: 'd-gm', type, payload } });
    expect(r.status).toBe(200);
    return r.body.seq as number;
  };
  const postPlayer = async (dev: string, type: string, payload: Record<string, unknown>) => {
    const r = await call('POST', `/api/rooms/${code}/events`, { headers: token(dev), body: { from: dev, type, payload } });
    expect(r.status).toBe(200);
    return r.body.seq as number;
  };
  const pollAs = async (dev: string, after = 0) => {
    const r = await call('GET', `/api/rooms/${code}?after=${after}&d=${dev}`, { headers: token(dev) });
    expect(r.status).toBe(200);
    return r.body as { events: StoredEvent[]; next: number; sheets: Record<string, any>; docs: Record<string, any>; presence?: unknown };
  };
  return { code, gm, postGm, postPlayer, pollAs };
}

describe('a player phone does not get another player\'s room events', () => {
  test('a secret quest reward approval does not reach another player phone', async () => {
    const { postGm, postPlayer, pollAs } = await setupRoom();
    const secretTitle = 'Assassinate the Guildmaster';

    // Step 1: GM sends secret quest to Mira (sealed).
    await postGm('quest', {
      eid: 'd-gm-e1',
      to: [MIRA_KEY],
      quest: { kind: 'side', title: secretTitle, secret: true, rewards: { gold: 500 } },
    });
    // Step 2: Mira completes the secret quest and sends rewardAsk (sealed).
    await postPlayer(MIRA_DEV, 'rewardAsk', {
      eid: 'd-mira1-e1',
      by: MIRA_KEY,
      name: 'Mira',
      from: 'quest',
      what: secretTitle,
      rewards: { gold: 500 },
    });

    const beforeApproval = await pollAs(KAI_DEV, 0);
    expect(beforeApproval.events).toEqual([]);

    // Step 3: GM approves Mira's pending reward via award (unsealed today).
    await postGm('award', {
      eid: 'd-gm-e2',
      to: [MIRA_KEY],
      rewards: { gold: 500 },
      earned: { from: 'quest', what: secretTitle },
    });

    const afterApproval = await pollAs(KAI_DEV, beforeApproval.next);
    expect(afterApproval.events).toEqual([]);
  });

  test('a GM award with a bundle window and boon does not reach another player phone', async () => {
    const { postGm, pollAs } = await setupRoom();
    await postGm('award', {
      eid: 'd-gm-b1',
      to: [MIRA_KEY],
      rewards: { boons: [{ name: 'Monarch Pact', text: 'Secretly revive once with full HP.' }] },
      bundle: {
        key: 'b-secret',
        name: 'Monarch Pact',
        window: { title: 'THE MONARCH CHOSE YOU', line: 'Keep this hidden from the party.' },
      },
    });

    const kai = await pollAs(KAI_DEV, 0);
    expect(kai.events).toEqual([]);
  });

  test('targeted GM status, hp, vitals, spent, revive, chain, shadow, noted, and soloAnswer events do not reach another player phone', async () => {
    const { postGm, pollAs } = await setupRoom();
    const job = JOB_NAMES[0]!;

    await postGm('status', {
      eid: 'd-gm-st1',
      to: [MIRA_KEY],
      add: [{ key: 'monarch-mark', def: { label: 'Monarch Mark', desc: 'Secretly marked by the boss', ops: [] }, source: { tier: 1 } }],
      remove: [],
      reason: 'Secretly marked by the Monarch',
    });
    await postGm('hp', { eid: 'd-gm-hp1', to: [MIRA_KEY], hp: -15, mana: 0, fatigue: 0, reason: 'Blood pact cost' });
    await postGm('vitals', {
      eid: 'd-gm-vt1',
      to: [MIRA_KEY],
      fight: 'f1',
      life: { at: 'up', hp: 12 },
      mana: 3,
      fatigue: 20,
      statuses: [],
      reason: 'Hidden ambush',
    });
    await postGm('spent', { eid: 'd-gm-sp1', to: [MIRA_KEY], item: 'i1' });
    await postGm('revive', { eid: 'd-gm-rv1', to: [MIRA_KEY] });
    await postGm('chain', { eid: 'd-gm-ch1', to: [MIRA_KEY], job, kind: 'issue' });
    await postGm('shadow', {
      eid: 'd-gm-sh1',
      to: [MIRA_KEY],
      shadow: { rank: 'E', archetype: 'brute', grade: 'Normal', monster: null, name: 'Igris' },
    });
    await postGm('noted', {
      eid: 'd-gm-nt1',
      to: [MIRA_KEY],
      facts: [{ kind: 'kill', monster: 'Secret Boss', rank: 'S', type: 'Undead', mkind: 'boss', above: 2, hpPct: 50, payback: false, where: 'fight' }],
    });
    await postGm('soloAnswer', {
      eid: 'd-gm-sa1',
      to: [MIRA_KEY],
      run: 'd-mira1-e9',
      gate: 'g1',
      name: 'Hidden Dungeon',
      verdict: 'cleared',
    });

    const kai = await pollAs(KAI_DEV, 0);
    expect(kai.events.map(e => e.type)).toEqual([]);
  });

  test('player-to-GM reports (used, roll, coinCall, soloRun, systemRaise, arm) do not reach another player phone', async () => {
    const { postPlayer, pollAs } = await setupRoom();

    await postPlayer(MIRA_DEV, 'used', {
      eid: 'd-mira1-u1',
      by: MIRA_KEY,
      who: 'Mira',
      what: 'boon',
      name: 'Hidden Patron',
      text: 'Secretly negate one death.',
      target: 'self',
      tell: true,
    });
    await postPlayer(MIRA_DEV, 'roll', {
      eid: 'd-mira1-r1',
      by: MIRA_KEY,
      name: 'Mira',
      label: 'Stealth check',
      expr: '1d20+5',
      total: 25,
      rolls: [20],
      crit: true,
      fumble: false,
    });
    await postPlayer(MIRA_DEV, 'coinCall', {
      eid: 'd-mira1-c1',
      by: MIRA_KEY,
      roll: `${MIRA_DEV}:r1`,
      who: 'Mira',
      what: 'Stealth check',
      face: 20,
      call: 'heads',
    });
    await postPlayer(MIRA_DEV, 'soloRun', {
      eid: 'd-mira1-s1',
      by: MIRA_KEY,
      gate: 'g1',
      name: 'Mira',
      outcome: 'won',
      rounds: 3,
      life: 'up',
    });
    await postPlayer(MIRA_DEV, 'systemRaise', {
      eid: 'd-mira1-sr1',
      by: MIRA_KEY,
      name: 'Mira',
      raise: 'debt',
      owes: 500,
    });
    await postPlayer(MIRA_DEV, 'arm', {
      eid: 'd-mira1-a1',
      by: MIRA_KEY,
      ability: 'parry',
      on: null,
    });

    const kai = await pollAs(KAI_DEV, 0);
    expect(kai.events.map(e => e.type)).toEqual([]);
  });

  test('a chapter quest progress update does not reach another player phone', async () => {
    const { postGm, postPlayer, pollAs } = await setupRoom();
    const body = chapterBody(
      {
        words: { title: 'THE WHISPER', line: 'Meet the informant alone.' },
        rewards: newRewards(),
        quest: {
          kind: 'side',
          title: 'Meet the Informant Alone',
          desc: 'Do not tell the party.',
          objectives: [{ label: 'Reach the alley', target: 1, progress: 0 }],
          rewards: newRewards(),
          onFail: newRewards(),
          penaltyText: '',
          dueHours: null,
        },
      },
      '2026-11-23T12:00:00.000Z',
    );

    // Chapter itself is sealed.
    await postGm('chapter', { eid: 'd-gm-chap1', to: [MIRA_KEY], ...body });
    const afterChapter = await pollAs(KAI_DEV, 0);
    expect(afterChapter.events).toEqual([]);

    // Mira updates progress on that quest using the secret flag from chapterBody (false).
    await postPlayer(MIRA_DEV, 'questUpdate', {
      eid: 'd-mira1-qu1',
      by: MIRA_KEY,
      name: 'Mira',
      questId: 'q1',
      title: body.quest!.title,
      kind: body.quest!.kind,
      status: 'active',
      objectives: [{ label: 'Reach the alley', target: 1, progress: 1 }],
      secret: body.quest!.secret,
    });

    const afterUpdate = await pollAs(KAI_DEV, afterChapter.next);
    expect(afterUpdate.events).toEqual([]);
  });

  test('classGrant, classRevoke, classSwap, classNode, and the holders doc never leak another player\'s or GM\'s unique classes', async () => {
    const { code, gm, postGm, postPlayer, pollAs } = await setupRoom();
    const AT = '2026-11-25T12:00:00.000Z';

    await postGm('classGrant', { eid: 'd-gm-cg1', to: [MIRA_KEY], className: 'Hemomancer', at: AT });
    await postGm('classRevoke', { eid: 'd-gm-cr1', to: [MIRA_KEY], className: 'Hemomancer', at: AT });
    await postPlayer(MIRA_DEV, 'classSwap', { eid: 'd-mira1-cs1', by: MIRA_KEY, name: 'Mira', fromClass: 'Fighter', toClass: 'Hemomancer', cost: 25 });
    await postPlayer(MIRA_DEV, 'classNode', { eid: 'd-mira1-cn1', by: MIRA_KEY, name: 'Mira', className: 'Hemomancer', act: 'buy', nodeId: 'crimson-root', cost: 45000 });

    const putHolders = await call('PUT', `/api/rooms/${code}/sheets/_holders`, {
      headers: gm,
      body: {
        from: 'd-gm',
        data: {
          registryId: 'reg-1',
          at: AT,
          held: {
            Hemomancer: { who: MIRA_KEY, grantId: 'cg1' },
            Chronokeeper: { who: KAI_KEY, grantId: 'cg2' },
            Necromancer: { who: 'gm', grantId: 'cg3' },
          },
        },
      },
    });
    expect(putHolders.status).toBe(200);

    // Non-GM cannot PUT _holders
    const badPut = await call('PUT', `/api/rooms/${code}/sheets/_holders`, {
      body: { from: KAI_DEV, data: { registryId: 'reg-1', at: AT, held: {} } },
    });
    expect(badPut.status).toBe(403);

    const kai = await pollAs(KAI_DEV, 0);
    expect(kai.events.map(e => e.type)).toEqual([]);
    expect(kai.docs.holders?.data).toEqual({ registryId: 'reg-1', at: AT, held: { Chronokeeper: { who: KAI_KEY, grantId: 'cg2' } } });

    const mira = await pollAs(MIRA_DEV, 0);
    expect(mira.docs.holders?.data).toEqual({ registryId: 'reg-1', at: AT, held: { Hemomancer: { who: MIRA_KEY, grantId: 'cg1' } } });

    const gmRes = await call('GET', `/api/rooms/${code}?after=0&d=d-gm`, { headers: gm });
    expect(gmRes.status).toBe(200);
    const gmState = parseRoomState(gmRes.body)!;
    expect(gmState.docs.holders?.data).toEqual({
      registryId: 'reg-1',
      at: AT,
      held: {
        Hemomancer: { who: MIRA_KEY, grantId: 'cg1' },
        Chronokeeper: { who: KAI_KEY, grantId: 'cg2' },
        Necromancer: { who: 'gm', grantId: 'cg3' },
      },
    });

    // Unproven viewer (anyone, no device token or GM key) has holders omitted completely so rejoining phones never wipe
    const anonRes = await call('GET', `/api/rooms/${code}?after=0`);
    expect(anonRes.status).toBe(200);
    const anonState = parseRoomState(anonRes.body)!;
    expect(anonState.docs.holders).toBeUndefined();
  });
});

describe('sealed events and room projections hide GM-only data', () => {
  test('a player phone does not get sealed events, coinLand sides, other sheets, presence, or monster HP and fudge', async () => {
    const { code, gm, postGm, postPlayer, pollAs } = await setupRoom();

    await postGm('system', { eid: 'd-gm-w1', to: [MIRA_KEY], title: 'GM Whisper', body: 'Eyes only.' });
    await postPlayer(MIRA_DEV, 'word', { eid: 'd-mira1-w1', by: MIRA_KEY, name: 'Mira', text: 'Private note to GM' });
    await postGm('wordBack', { eid: 'd-gm-wb1', to: [MIRA_KEY], re: 'd-mira1-w1', text: 'Private GM reply' });
    await postGm('weigh', { eid: 'd-gm-wg1', to: [MIRA_KEY], total: -3, force: 1 });
    await postPlayer(MIRA_DEV, 'stashAsk', { eid: 'd-mira1-sa1', by: MIRA_KEY, name: 'Mira', ask: { kind: 'gold', gold: 10 } });
    await postGm('stashAnswer', { eid: 'd-gm-st2', to: [MIRA_KEY], ask: 'd-mira1-sa1', verdict: 'kept' });
    await postGm('coinLand', { eid: 'd-gm-cl1', roll: `${MIRA_DEV}:r1`, side: 'heads', ruling: 'secret' });

    // Publish a fight doc with a party row, a monster, and active GM fudge.
    const ctx = { rules: RULES };
    const hero = hunterRow(newHunter(), combatantId('p1'), RULES);
    const foe = monsterRows(seedMonsters(RULES)[0]!, [combatantId('m1')], RULES)[0]!;
    const added = reduce(null, { type: 'add', fightId: fightId('f-vis'), rows: [hero, foe], openings: [] }, ctx);
    expect(added.fight).not.toBeNull();
    const fudged = reduce(added.fight, { type: 'fudge', set: { kind: 'weight', scope: { kind: 'side', side: 'foe' }, n: 5 } }, ctx);
    expect(fudged.fight).not.toBeNull();
    const doc = fightDoc(fudged.fight, RULES, {
      by: parseDeviceId('d-gm')!,
      at: '2026-11-23T12:00:00.000Z',
      was: null,
      keyOf: () => null,
    });
    expect(doc).not.toBeNull();
    const putDoc = await call('PUT', `/api/rooms/${code}/sheets/_fight`, { headers: gm, body: { from: 'd-gm', data: fightWire(doc!) } });
    expect(putDoc.status).toBe(200);

    const kai = await pollAs(KAI_DEV, 0);

    // Only coinLand arrives, and side/ruling were stripped by parseEvent.
    expect(kai.events.map(e => e.type)).toEqual(['coinLand']);
    expect(Object.keys(kai.events[0]!.payload).sort()).toEqual(['eid', 'roll']);

    // Presence is GM-only.
    expect(kai.presence).toBeUndefined();

    // Mira's sheet is reduced to HunterFace (no quests, boons, statuses).
    expect(Object.keys(kai.sheets[MIRA_KEY]!.data)).toEqual(['face']);
    expect(JSON.stringify(kai.sheets[MIRA_KEY]!.data)).not.toContain('Hidden Agenda');
    expect(JSON.stringify(kai.sheets[MIRA_KEY]!.data)).not.toContain('Secret Patron');

    // Fight doc hides exact monster HP and GM fudge.
    const wireFight = kai.docs.fight?.data;
    expect(wireFight).toBeDefined();
    const monsterWire = wireFight.rows.find((r: any) => r.i === 'm1');
    expect(monsterWire).toBeDefined();
    expect(monsterWire.b).toBe(0);
    expect(monsterWire.h).toBeUndefined();
    expect(monsterWire.hm).toBeUndefined();
    expect(wireFight.fudge).toBeUndefined();
  });

  test('a hidden foe in dodge reach leaves no hole in FightDoc.dodge, a hidden attacker is redacted, and dodge events stay sealed', async () => {
    const { postPlayer, pollAs } = await setupRoom();
    // 1. Sealed event check: Mira's dodge event never reaches Kai's phone
    await postPlayer(MIRA_DEV, 'dodge', { eid: 'd-mira1-dg1', by: MIRA_KEY, n: 1, place: { x: 4, y: 5 } });
    const kaiPoll = await pollAs(KAI_DEV, 0);
    expect(kaiPoll.events).toEqual([]);

    // 2. Hidden foe standing on a dodge tile: FightDoc is byte-identical to the same fight without that hidden foe
    const ctx = { rules: RULES };
    const blast = { ...abilityOf('blast', { id: abilityId('fireball'), name: 'Fireball' }, RULES), range: tiles(20), delivery: { kind: 'travel' as const, windup: tick(1200), speed: 'instant' as const } };
    const cloak = statusOn(
      { label: 'Hidden', desc: '', ops: [{ op: 'hidden', level: 3, start: 'anywhere', ends: { hurt: true, revealed: true, dealt: true } }] },
      { key: statusKey('cloak'), source: { id: null, tier: 0 }, until: null, since: tick(0), settledAt: tick(0) },
    );
    const hero = { ...hunterRow(newHunter(), combatantId('p1'), RULES), place: place(5, 5) };
    const casterBase = monsterRows(seedMonsters(RULES)[0]!, [combatantId('m1')], RULES)[0]!;
    const caster = { ...casterBase, place: place(1, 5), abilities: [blast] };
    const docOpts = { by: parseDeviceId('d-gm')!, at: '2026-11-24T00:00:00.000Z', was: null, keyOf: () => null };

    const makeOpen = (extra: readonly (typeof casterBase)[]) => {
      const rows = [hero, caster, ...extra];
      const f0 = reduce(null, { type: 'add', fightId: fightId('f-leak'), rows, openings: [], grid: openGrid(14, 14) }, ctx).fight!;
      const f1 = reduce(f0, { type: 'start', openings: rows.map(r => ({ id: r.id, d20: r.id === caster.id ? 20 : 1, tie: 0 })) }, ctx).fight!;
      return reduce(f1, { type: 'act', by: caster.id, ability: blast.id, aim: place(5, 5), rolls: { dice: { p1: [4] } as never, react: { p1: 20 } as never } }, ctx).fight!;
    };

    const plainFight = makeOpen([]);
    const askPlain = dodgeAsk(plainFight as Extract<typeof plainFight, { phase: 'running' }>, RULES)!;
    // Place hidden foe directly on the hunter's nearest auto dodge tile!
    const sneak = { ...monsterRows(seedMonsters(RULES)[0]!, [combatantId('m-hid')], RULES)[0]!, place: askPlain.auto.place, statuses: [cloak] };
    const hiddenFight = makeOpen([sneak]);
    const askHidden = dodgeAsk(hiddenFight as Extract<typeof hiddenFight, { phase: 'running' }>, RULES)!;
    // Sanity check: the GM's real legal tiles DO exclude sneak's tile, whereas the player doc MUST NOT
    expect(askHidden.tiles.map(t => t.place)).not.toContainEqual(sneak.place);
    const plainDoc = fightDoc(plainFight, RULES, docOpts)!;
    const hiddenDoc = fightDoc(hiddenFight, RULES, docOpts)!;
    expect(JSON.stringify(fightWire(hiddenDoc).dodge)).toBe(JSON.stringify(fightWire(plainDoc).dodge));
    expect(hiddenDoc.ended === false && plainDoc.ended === false && hiddenDoc.dodge).toEqual(plainDoc.ended === false ? plainDoc.dodge : undefined);

    // 3. Hidden attacker: by, ability, hit, and ring are all redacted on the player doc
    const hiddenCaster = { ...caster, statuses: [cloak] };
    const fH0 = reduce(null, { type: 'add', fightId: fightId('f-ambush'), rows: [hero, hiddenCaster], openings: [], grid: openGrid(14, 14) }, ctx).fight!;
    const fH1 = reduce(fH0, { type: 'start', openings: [{ id: hero.id, d20: 1, tie: 0 }, { id: hiddenCaster.id, d20: 20, tie: 0 }] }, ctx).fight!;
    const fH2 = reduce(fH1, { type: 'act', by: hiddenCaster.id, ability: blast.id, aim: place(5, 5), rolls: { dice: { p1: [4] } as never, react: { p1: 20 } as never } }, ctx).fight!;
    const ambushDoc = fightDoc(fH2, RULES, docOpts)!;
    expect(ambushDoc.ended).toBe(false);
    if (!ambushDoc.ended) {
      expect(ambushDoc.dodge).toBeDefined();
      expect(ambushDoc.dodge!.by).toBeNull();
      expect(ambushDoc.dodge!.ability).toBeNull();
      expect(ambushDoc.dodge!.hit).toBe('');
      expect(ambushDoc.dodge!.ring).toBe('');
      expect(ambushDoc.dodge!.reach).toBeGreaterThan(0);
      expect(ambushDoc.dodge!.left).toBeGreaterThan(0);
    }
  });

  test('classPick stays sealed to the GM and DOCS.classOffer omits for anyone, hides targeted offers from other phones, and strips other devices\' keys', async () => {
    const { code, gm, postPlayer, pollAs } = await setupRoom();
    // 1. Sealed event: Mira's classPick never reaches Kai's phone.
    await postPlayer(MIRA_DEV, 'classPick', {
      eid: 'd-mira1-cp1',
      by: MIRA_KEY,
      name: 'Mira',
      className: 'Hemomancer',
      offerId: 'co1-abc',
    });
    const kaiEv = await pollAs(KAI_DEV, 0);
    expect(kaiEv.events).toEqual([]);

    // 2. Targeted classOffer doc: Mira sees it with only her own key in hunters; Kai sees { active: false }; unauthenticated poll omits it.
    const offerWire = {
      active: true,
      id: 'co1-abc',
      at: '2026-11-25T12:00:00.000Z',
      pool: ['Hemomancer', 'Bladefiend', 'Rifthunter', 'Seraph', 'Ironclad', 'Stormcaller'],
      hunters: [MIRA_KEY],
      taken: {
        Hemomancer: { who: MIRA_KEY, name: 'Mira' },
        Seraph: { who: 'gm', name: '' },
      },
    };
    const put = await call('PUT', `/api/rooms/${code}/sheets/_classOffer`, { headers: gm, body: { from: 'gm', data: offerWire } });
    expect(put.status).toBe(200);

    const miraPoll = await pollAs(MIRA_DEV, 0);
    expect(miraPoll.docs.classOffer?.data).toEqual(offerWire);

    const kaiPoll = await pollAs(KAI_DEV, 0);
    expect(kaiPoll.docs.classOffer).toBeUndefined();

    const anonPoll = await call('GET', `/api/rooms/${code}`);
    expect(anonPoll.body.docs.classOffer).toBeUndefined();

    // 3. Multi-target offer strips other devices' keys from `hunters`.
    const bothWire = { ...offerWire, hunters: [MIRA_KEY, KAI_KEY] };
    expect((await call('PUT', `/api/rooms/${code}/sheets/_classOffer`, { headers: gm, body: { from: 'gm', data: bothWire } })).status).toBe(200);
    const miraBoth = await pollAs(MIRA_DEV, 0);
    const kaiBoth = await pollAs(KAI_DEV, 0);
    expect(miraBoth.docs.classOffer?.data.hunters).toEqual([MIRA_KEY]);
    expect(kaiBoth.docs.classOffer?.data.hunters).toEqual([KAI_KEY]);
  });
});
