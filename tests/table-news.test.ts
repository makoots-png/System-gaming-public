// What a player's phone tells of the GM's fight, once each (src/core/combat/table-news.ts, implicit audit 3, T2): a doc
// read again tells nothing new, a reload reads the record back, and "Encounter cleared" is told only for a fight seen running.
import { describe, expect, test } from 'bun:test';
import { NOTHING_TOLD, parseTold, toldAfter } from '../src/core/combat/table-news.ts';
import type { TableNews, TableTold } from '../src/core/combat/table-news.ts';
import type { FightDoc } from '../src/core/combat/fight-doc.ts';
import { fightId } from '../src/core/combat/fight-types.ts';
import { combatantId } from '../src/core/combat/ability-types.ts';
import { tick } from '../src/core/combat/timeline.ts';

const F = fightId('f-1');
const live = (o: Record<string, unknown> = {}) => ({ ended: false, active: true, id: F, now: tick(1000), currentId: combatantId('c1'), refused: null, ...o }) as unknown as FightDoc;
const over = { ended: true, active: false, id: F, at: '2026-11-15T10:00:00.000Z' } as FightDoc;
const none = { turn: null, refused: false };
/** The news of each doc in turn, with the record carried from one to the next as device memory would. */
function play(docs: { doc: FightDoc; mine?: { turn: string | null; refused: boolean } }[], start: TableTold = NOTHING_TOLD): TableNews['kind'][][] {
  let told = start;
  return docs.map(({ doc, mine }) => { const r = toldAfter(doc, told, mine ?? none); told = parseTold(JSON.parse(JSON.stringify(r.told))); return r.news.map(n => n.kind); });
}

describe('a player\'s fight news', () => {
  test('a turn of this player is told once per turn: the same doc again, or after a reload, tells nothing; the next turn tells again', () => {
    const mine = { turn: 'h1', refused: false };
    expect(play([{ doc: live(), mine }, { doc: live(), mine }, { doc: live({ now: tick(2000) }), mine }])).toEqual([['turn'], [], ['turn']]);
  });
  test('a refusal of this player\'s move and a burst are told once each, by their counts', () => {
    const no = { id: combatantId('c1'), at: tick(1000), reason: 'notYourTurn', n: 1 };
    expect(play([
      { doc: live({ refused: no, burst: { n: 3, ids: [combatantId('c2')] } }), mine: { turn: null, refused: true } },
      { doc: live({ refused: no, burst: { n: 3, ids: [combatantId('c2')] } }), mine: { turn: null, refused: true } },
      { doc: live({ refused: { ...no, n: 2 }, burst: { n: 4, ids: [] } }), mine: { turn: null, refused: true } },
    ])).toEqual([['burst', 'refused'], [], ['burst', 'refused']]);
  });
  test('the end is told once, and only for a fight this phone saw running', () => {
    expect(play([{ doc: live() }, { doc: over }, { doc: over }])).toEqual([[], ['ended'], []]);
    expect(play([{ doc: over }])).toEqual([[]]);
  });
  test('a stored record that is not one reads as nothing told', () => {
    expect([parseTold(null), parseTold('x'), parseTold({ turn: { fight: 7 } })]).toEqual([NOTHING_TOLD, NOTHING_TOLD, NOTHING_TOLD]);
  });
});
