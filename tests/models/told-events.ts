// One hunter's feat and one room's gate, each the piece "x" of the campaign's told memory (src/core/told.ts), and the
// events that move them. The state chart (scripts/charts/told.ts) walks these.
import { dayKey } from '../../src/core/day.ts';
import { newHunter } from '../../src/core/hunter/hunter.ts';
import type { HunterId } from '../../src/core/ids.ts';
import type { ToldEvent, ToldHunter, ToldMemory, ToldTopic } from '../../src/core/told.ts';
import { gid } from './gate-events.ts';

export const PIECE = 'x';
export const FEAT: ToldTopic = { of: 'feat', hunter: 'h1' };
export const ROOM: ToldTopic = { of: 'room', room: 'ABCD' };

/** Hunter h1, holding feat "x" earned when `earned`. */
export function hunterH1(earned: boolean): ToldHunter {
  const h = newHunter();
  const feats = earned ? { [PIECE]: { at: 'earned' as const, on: '2026-11-01T10:00:00.000Z', day: dayKey(new Date('2026-11-01T10:00:00.000Z'), 0), name: PIECE } } : {};
  return { ...h, id: 'h1' as HunterId, chronicle: { ...h.chronicle, feats } };
}
/** Gate "x" as a room's world doc shows it. */
const shown = (status: 'detected' | 'broken') => ({ id: gid(PIECE), name: PIECE, rank: 'E' as const, type: 'normal' as const, breakDay: 5, status });

/** The other campaign's token: a replace always starts a campaign other than the one the record holds. */
export const otherCampaign = (m: ToldMemory): string => (m.campaign === 'c1' ? 'c2' : 'c1');

/** Every event from record `m`: the room looked at (showing gate x, or none), each piece answered in this campaign and the one before, the campaign replaced. */
export function toldEvents(m: ToldMemory): ToldEvent[] {
  const before = otherCampaign(m);
  return [
    { type: 'looked', room: 'ABCD', gates: [shown('detected')] },
    { type: 'looked', room: 'ABCD', gates: [] },
    ...[FEAT, ROOM].flatMap((topic): ToldEvent[] => [
      { type: 'answered', campaign: m.campaign, topic, id: PIECE },
      { type: 'answered', campaign: before, topic, id: PIECE },
    ]),
    { type: 'replaced', campaign: before, hunters: [hunterH1(false)] },
    { type: 'replaced', campaign: before, hunters: [hunterH1(true)] },
  ];
}
