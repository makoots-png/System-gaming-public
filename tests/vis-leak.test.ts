import { describe, expect, test } from 'bun:test';
import { buildApp } from '../scripts/build.ts';
import { handler } from '../server.ts';
import { RULES } from '../src/core/rules.ts';
import { JOB_NAMES } from '../src/core/registry/jobs.ts';
import { fightDoc, fightWire } from '../src/core/combat/fight-doc.ts';
import { reduce } from '../src/core/combat/fight.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import { fightId } from '../src/core/combat/fight-types.ts';
import { hunterRow, monsterRows } from '../src/core/combat/rows.ts';
import { newHunter } from '../src/core/hunter/hunter.ts';
import { seedMonsters } from '../src/core/registry/monsters.ts';
import { chapterBody } from '../src/core/story/story.ts';
import { newRewards } from '../src/core/rewards.ts';
import { parseDeviceId } from '../src/core/protocol.ts';
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
});
