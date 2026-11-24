// What one of the GM view's actions writes (src/core/award.ts): its change, its posts and its log line in one answer.
import { describe, expect, test } from 'bun:test';
import { AWARD_DRAFT_EVENTS, AWARD_DRAFT_STATES, BLANK_DRAFT, draftStep, gmAward, sendApproves, sendDeals, sendGives, sent } from '../src/core/award.ts';
import type { AwardDraft, AwardDraftEvent } from '../src/core/award.ts';
import { dropDealt } from '../src/core/gates/pay.ts';
import { isRefused } from '../src/core/save-step.ts';
import { newRewards } from '../src/core/rewards.ts';
import { RULES } from '../src/core/rules.ts';
import { freshSave, newHunter } from '../src/core/save.ts';
import type { ParseEnv, Save } from '../src/core/save.ts';
import { newEvent } from '../src/core/protocol.ts';
import { dev, day, hid, room } from './fixtures/ids.ts';
import { fightId, parseEventId } from '../src/core/ids.ts';

const AT = '2026-11-15T10:00:00.000Z', ROOM = room('ABCD23');
const ENV: ParseEnv = { now: new Date(AT), newDeviceToken: () => 'test-device-token-0123456789abcd', newDeviceId: () => dev('d-gm') };
const DAY = { at: AT, today: day('2026-11-15'), R: RULES };
/** The GM's save with two hunters of this phone, h1 (Mira) and h2 (Brakk). */
function gm(): Save {
  const s = freshSave(ENV, { onboarded: true });
  return { ...s, hunters: [{ ...s.hunters[0]!, id: hid('h1'), name: 'Mira' }, { ...newHunter(RULES), id: hid('h2'), name: 'Brakk' }] };
}
const award = (xp: number) => newEvent('award', { to: ['d-p1:h1' as never], rewards: { ...newRewards(), xp } }, { device: 'd-gm', now: 1, rand: 0.25 })!;
const said = [{ kind: 'award' as const, hunterId: null, title: 'GM award', text: '+50 XP → Mira, Brakk, Kai' }];

describe('the GM\'s Send award is one write', () => {
  test('every hunter of this phone gets the reward, the player\'s award waits in the outbox and the log has its line, in one save', () => {
    const r = gmAward(gm(), [{ hid: 'h1', vitals: 'sheet' }, { hid: 'h2', vitals: 'sheet' }], { ...newRewards(), xp: 50 }, { room: ROOM, events: [award(50)], said }, DAY);
    expect(r.save.hunters.map(h => h.xp)).toEqual([50, 50]);
    expect(r.granted.map(g => g.hid)).toEqual(['h1', 'h2']);
    expect((r.save.settings.sync.outbox ?? []).map(e => e.letter.kind === 'event' && e.letter.event.type)).toEqual(['award']);
    expect(r.save.log[0]).toMatchObject({ kind: 'award', title: 'GM award', text: said[0]!.text, hunterId: null });
  });

  test('a bundle given by hand is a fact of each hunter\'s chronicle, in the award\'s write, even when it gives nothing but its words', () => {
    const given = { key: 'seed-straight-face', name: 'Straight Face', window: { title: 'THE SYSTEM BELIEVED YOU TOO', line: 'A good lie.' } };
    const r = gmAward(gm(), [{ hid: 'h1', vitals: 'sheet' }], newRewards(), { room: null, events: [], said }, DAY, given);
    expect(r.save.hunters[0]!.chronicle.inbox).toEqual([{ kind: 'given', key: 'seed-straight-face', name: 'Straight Face' }]);
    expect(r.save.hunters[1]!.chronicle.inbox).toEqual([]);
    expect(gmAward(gm(), [{ hid: 'h1', vitals: 'sheet' }], newRewards(), { room: null, events: [], said }, DAY).save.hunters[0]!.chronicle.inbox, 'a plain award records nothing').toEqual([]);
  });

  test('a hunter no longer on this phone is left out and the rest is written', () => {
    const r = gmAward(gm(), [{ hid: 'h9', vitals: 'sheet' }, { hid: 'h2', vitals: 'sheet' }], { ...newRewards(), gold: 5 }, { room: null, events: [], said }, DAY);
    expect(r.granted.map(g => g.hid)).toEqual(['h2']);
    expect(r.save.log).toHaveLength(gm().log.length + 1);
  });

  test('outside a room nothing is queued; a post repeated is queued once', () => {
    const ev = award(10);
    expect(sent(gm(), { room: null, events: [ev], said: [] }, { at: AT, cap: RULES.logCap }).settings.sync.outbox ?? []).toEqual([]);
    const twice = sent(sent(gm(), { room: ROOM, events: [ev], said: [] }, { at: AT, cap: RULES.logCap }), { room: ROOM, events: [ev], said: [] }, { at: AT, cap: RULES.logCap });
    expect(twice.settings.sync.outbox).toHaveLength(1);
  });
});

describe('the Award form\'s tie to a fight\'s drop (SMX-gates-1, SMX-views-11)', () => {
  const F = fightId('f-a'), LOOT = { ...newRewards(), gold: 900 }, XP = { ...newRewards(), xp: 25 };
  const STATES: { readonly [S in AwardDraft['at']]: Extract<AwardDraft, { at: S }> } = {
    blank: BLANK_DRAFT, opening: { at: 'opening', rewards: LOOT, bundle: null, tie: { kind: 'drop', fight: F } }, tied: { at: 'tied', tie: { kind: 'drop', fight: F } },
  };
  const EVENTS: { readonly [E in AwardDraftEvent['type']]: Extract<AwardDraftEvent, { type: E }> } = {
    open: { type: 'open', rewards: XP, bundle: 'rb1', tie: null }, drawn: { type: 'drawn' }, bundle: { type: 'bundle' },
    fold: { type: 'fold' }, gone: { type: 'gone' }, sent: { type: 'sent' },
  };
  const keep = { do: 'keep' } as const, clear = { do: 'clear' } as const;
  const opened = { draft: { at: 'opening', rewards: XP, bundle: 'rb1', tie: null }, form: keep };
  /** The GM's save with drop F of 900 gold waiting. */
  const waiting = (): Save => ({ ...gm(), loot: { at: 'waiting', drops: [{ fight: F, gold: 900, items: [] }] } });

  test('every state answers every event: an open waits for the view to fill the form; a drop\'s form is untied by a bundle, a fold, the drop leaving or the send', () => {
    const table = Object.fromEntries(AWARD_DRAFT_STATES.map(s => [s, Object.fromEntries(AWARD_DRAFT_EVENTS.map(e => [e, draftStep(STATES[s], EVENTS[e])]))]));
    expect(table).toEqual({
      blank: { open: opened, drawn: null, bundle: { draft: BLANK_DRAFT, form: keep }, fold: { draft: BLANK_DRAFT, form: keep }, gone: null, sent: { draft: BLANK_DRAFT, form: keep } },
      opening: { open: opened, drawn: { draft: STATES.tied, form: { do: 'fill', rewards: LOOT, bundle: null } }, bundle: null, fold: null, gone: null, sent: null },
      tied: { open: opened, drawn: null, bundle: { draft: BLANK_DRAFT, form: keep }, fold: { draft: BLANK_DRAFT, form: clear }, gone: { draft: BLANK_DRAFT, form: clear }, sent: { draft: BLANK_DRAFT, form: keep } },
    });
    expect(draftStep(opened.draft as AwardDraft, EVENTS.drawn), 'a bundle from the Workshop fills the form tied to nothing')
      .toEqual({ draft: BLANK_DRAFT, form: { do: 'fill', rewards: XP, bundle: 'rb1' } });
  });

  test('a send from the loot\'s form deals that drop, in the award\'s write; a send from a blank form deals none', () => {
    expect(sendDeals(STATES.tied, 0)).toEqual({ deals: F });
    expect(sendDeals(BLANK_DRAFT, 0)).toEqual({ deals: null });
    const dealt = dropDealt(waiting(), F);
    expect(isRefused(dealt) ? dealt : dealt.loot).toEqual({ at: 'none' });
  });

  test('the GM opens Award loot…, folds Award, later sends +25 XP: the loot still waits (SMX-views-11.1)', () => {
    const folded = draftStep(draftStep(STATES.opening, EVENTS.drawn)!.draft, EVENTS.fold)!;
    expect(folded).toEqual({ draft: BLANK_DRAFT, form: clear });
    expect(sendDeals(folded.draft, 0)).toEqual({ deals: null });
  });

  test('the GM opens the loot in the form and picks another bundle there: its send deals no loot (SMX-gates-1.2)', () => {
    expect(sendDeals(draftStep(STATES.tied, EVENTS.bundle)!.draft, 0)).toEqual({ deals: null });
  });

  test('the GM opens a waiting reward with Edit: its send approves that reward and deals no loot; folded, the reward still waits (ruling 20)', () => {
    const ID = parseEventId('d-p1-1abc-wxyz')!;
    const tied = draftStep(draftStep(BLANK_DRAFT, { type: 'open', rewards: LOOT, bundle: null, tie: { kind: 'pending', id: ID } })!.draft, EVENTS.drawn)!;
    expect(tied).toEqual({ draft: { at: 'tied', tie: { kind: 'pending', id: ID } }, form: { do: 'fill', rewards: LOOT, bundle: null } });
    expect(sendApproves(tied.draft)).toBe(ID);
    expect(sendDeals(tied.draft, 1), 'a reward reaches whom it reaches').toEqual({ deals: null });
    expect(sendApproves(draftStep(tied.draft, EVENTS.fold)!.draft)).toBeNull();
    expect(sendApproves(STATES.tied), 'the loot\'s form approves nothing').toBeNull();
  });

  test('in a room an award picked on Give…\'s shelf opens in the form tied to its bundle and hunter: its send gives it as that bundle; folded, nothing is given (ruling 20, SMX-gates-5.2)', () => {
    const given = { key: 'seed-held-the-mask', name: 'Held the Mask', window: null }, tie = { kind: 'shelf', given, to: 'd-p1:h1' } as const;
    const tied = draftStep(draftStep(BLANK_DRAFT, { type: 'open', rewards: XP, bundle: null, tie })!.draft, EVENTS.drawn)!;
    expect(tied).toEqual({ draft: { at: 'tied', tie }, form: { do: 'fill', rewards: XP, bundle: null } });
    expect(sendGives(tied.draft)).toEqual(tie);
    expect([sendApproves(tied.draft), sendDeals(tied.draft, 1)]).toEqual([null, { deals: null }]);
    expect(sendGives(draftStep(tied.draft, EVENTS.fold)!.draft)).toBeNull();
    expect(sendGives(draftStep(tied.draft, EVENTS.bundle)!.draft), 'another bundle picked in the form is an award of its own').toBeNull();
  });

  test('a send of the loot that would leave a picked player without it (no room) is refused whole, so nothing is written and the loot waits (SMX-gates-1.1)', () => {
    expect(sendDeals(STATES.tied, 1)).toEqual({ ok: false, why: 'unreached' });
    expect(sendDeals(BLANK_DRAFT, 1), 'an award that is not the loot goes to whom it reaches, as before').toEqual({ deals: null });
  });
});
