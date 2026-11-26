// What one of the GM view's actions writes (src/core/award.ts): its change, its posts and its log line in one answer.
import { describe, expect, test } from 'bun:test';
import { AWARD_DRAFT_EVENTS, AWARD_DRAFT_STATES, BLANK_DRAFT, awardKeepsPending, awardSaid, draftStep, gmAward, sendApproves, sendDeals, sendGives, sent } from '../src/core/award.ts';
import type { AwardDraft, AwardDraftEvent } from '../src/core/award.ts';
import { dropDealt } from '../src/core/gates/pay.ts';
import { isRefused } from '../src/core/save-step.ts';
import { newRewards } from '../src/core/rewards.ts';
import type { Rewards } from '../src/core/rewards.ts';
import { claimUniqueClass } from '../src/core/hunter/class-holders.ts';
import { grant } from '../src/core/hunter/grant.ts';
import { CLASS_LOCKER_CAP } from '../src/core/registry/class-trees.ts';
import type { SheetKey } from '../src/core/ids.ts';
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

describe('the award\'s log line says the job that landed (statechart rule 3)', () => {
  const KAI = 'd-p1:h1' as SheetKey;
  /** The GM's save alone (mode gm), h1 Mira and h2 Brakk; `edit` changes it first. */
  const gmAlone = (edit: (s: Save) => Save = s => s): Save => { const s = gm(); return edit({ ...s, settings: { ...s.settings, mode: 'gm' } }); };
  const names = { local: (h: string) => (h === 'h1' ? 'Mira' : 'Brakk'), remote: () => 'Kai' };
  const line = (bits: string, to: readonly string[]) => ({ kind: 'award' as const, hunterId: null, title: 'GM award', text: `${bits} → ${to.join(', ')}` });
  /** Send award of `rewards` to `local` and `remote` with the builder the GM view uses; answers the award lines written. */
  function sendJob(s: Save, local: { hid: string; vitals: 'sheet' | 'fight' }[], remote: SheetKey[], rewards: Rewards, heldRemote = false) {
    const said = awardSaid({ R: RULES, rewards, bundle: null, to: { local: local.map(l => l.hid), remote }, names, line });
    const r = gmAward(s, local, rewards, { room: null, events: [], said }, DAY, null, null,
      remote.length ? { targets: remote.map(key => ({ key, name: 'Kai' })), heldRemote: () => heldRemote, stamp: null } : null);
    return r.save.log.filter(l => l.kind === 'award').map(l => l.text).slice(0, r.save.log.length - s.log.length);
  }
  const down = (s: Save): Save => ({ ...s, hunters: s.hunters.map(h => (h.id === 'h1' ? { ...h, life: { at: 'dead' as const } } : h)) });
  const full = (s: Save): Save => ({ ...s, hunters: s.hunters.map(h => (h.id === 'h1' ? { ...h, classes: Object.fromEntries(Array.from({ length: CLASS_LOCKER_CAP }, (_, i) => [`Filler ${i}`, { unlockedAt: AT, nodes: [] }])) } : h)) });
  const taken = (s: Save): Save => { const c = claimUniqueClass(s, 'Seraph', { kind: 'npc', name: 'Warden' }, { at: AT, room: null, stamp: null, R: RULES, heldLocal: () => false, heldRemote: () => false }); if (isRefused(c)) throw new Error(c.why); return c.save; };
  const SERAPH = { ...newRewards(), gold: 10, job: 'Seraph' };

  for (const [why, s, vitals] of [['held', gmAlone(), 'fight'], ['locker-full', gmAlone(full), 'sheet'], ['class-taken', gmAlone(taken), 'sheet'], ['dead', gmAlone(down), 'sheet']] as const) {
    test(`a unique job refused "${why}" to this phone's hunter leaves no "Job:" in the log`, () => {
      expect(sendJob(s, [{ hid: 'h1', vitals }], [], SERAPH)).toEqual(['+10 gold → Mira']);
    });
  }
  for (const [why, s, held] of [['held', gmAlone(), true], ['class-taken', gmAlone(taken), false]] as const) {
    test(`a unique job refused "${why}" to a player leaves no "Job:" in the log`, () => {
      expect(sendJob(s, [], [KAI], SERAPH, held)).toEqual(['+10 gold → Kai']);
    });
  }

  test('one of two taking the job logs the reward without it to both and "Job: X" to the one; both taking it logs today\'s line', () => {
    expect(sendJob(gmAlone(), [{ hid: 'h1', vitals: 'fight' }, { hid: 'h2', vitals: 'sheet' }], [], SERAPH)).toEqual(['Job: Seraph → Brakk', '+10 gold → Mira, Brakk']);
    expect(sendJob(gmAlone(), [{ hid: 'h1', vitals: 'sheet' }, { hid: 'h2', vitals: 'sheet' }], [], { ...newRewards(), gold: 10, job: 'Fighter' })).toEqual(['+10 gold, Job: Fighter → Mira, Brakk']);
    expect(sendJob(gmAlone(), [{ hid: 'h1', vitals: 'sheet' }], [KAI], { ...newRewards(), gold: 10, job: 'Fighter' })).toEqual(['+10 gold, Job: Fighter → Mira, Kai']);
  });

  test('a job-only award that every recipient refused writes no award line', () => {
    expect(sendJob(gmAlone(), [{ hid: 'h1', vitals: 'fight' }], [], { ...newRewards(), job: 'Seraph' })).toEqual([]);
    expect(sendJob(gmAlone(), [], [KAI], { ...newRewards(), job: 'Seraph' }, true)).toEqual([]);
  });

  test('a job-only bundle logs no "GM gave" line when nobody took the job, and logs only "Job: X" when one of two took it', () => {
    const sendBundle = (s: Save, local: { hid: string; vitals: 'sheet' | 'fight' }[], remote: SheetKey[], rewards: Rewards, bundle: string, heldRemote = false) => {
      const said = awardSaid({
        R: RULES, rewards, bundle, to: { local: local.map(l => l.hid), remote }, names,
        line: (bits, to) => ({ kind: 'award' as const, hunterId: null, title: 'GM gave', text: `${bits} → ${to.join(', ')}` }),
      });
      const r = gmAward(s, local, rewards, { room: null, events: [], said }, DAY, { key: 'b1', name: bundle, window: null }, null,
        remote.length ? { targets: remote.map(key => ({ key, name: 'Kai' })), heldRemote: () => heldRemote, stamp: null } : null);
      return r.save.log.filter(l => l.kind === 'award').map(l => `${l.title}: ${l.text}`).slice(0, r.save.log.length - s.log.length);
    };
    const jobOnly = { ...newRewards(), job: 'Seraph' };
    // Job-only bundle where every recipient refuses: writes no GM gave line at all
    expect(sendBundle(gmAlone(), [{ hid: 'h1', vitals: 'fight' }], [], jobOnly, 'Seraph Gift')).toEqual([]);
    expect(sendBundle(gmAlone(down), [{ hid: 'h1', vitals: 'sheet' }], [], jobOnly, 'Seraph Gift')).toEqual([]);
    expect(sendBundle(gmAlone(taken), [{ hid: 'h1', vitals: 'sheet' }], [], jobOnly, 'Seraph Gift')).toEqual([]);
    expect(sendBundle(gmAlone(full), [{ hid: 'h1', vitals: 'sheet' }], [], jobOnly, 'Seraph Gift')).toEqual([]);
    expect(sendBundle(gmAlone(), [], [KAI], jobOnly, 'Seraph Gift', true)).toEqual([]);
    // Job-only bundle where 1 of 2 takes it: logs only "Job: Seraph → Brakk", not the bundle to both
    expect(sendBundle(gmAlone(), [{ hid: 'h1', vitals: 'fight' }, { hid: 'h2', vitals: 'sheet' }], [], jobOnly, 'Seraph Gift')).toEqual(['GM gave: Job: Seraph → Brakk']);
    // Bundle with non-job reward + refused job: still logs the bundle for the landed reward
    expect(sendBundle(gmAlone(), [{ hid: 'h1', vitals: 'fight' }], [], SERAPH, 'Seraph Pack')).toEqual(['GM gave: Seraph Pack → Mira']);
    // Flavor-only bundle with no job: still logs the bundle name
    expect(sendBundle(gmAlone(), [{ hid: 'h1', vitals: 'sheet' }], [], newRewards(), 'Straight Face')).toEqual(['GM gave: Straight Face → Mira']);
  });

  test('awardKeepsPending keeps a unique-job-only waiting reward pending when local or remote claims are all refused', () => {
    const jobOnly = { ...newRewards(), job: 'Seraph' };
    const plainJob = { ...newRewards(), job: 'Fighter' };
    const runLocal = (s: Save, vitals: 'sheet' | 'fight', rewards: Rewards) =>
      gmAward(s, [{ hid: 'h1', vitals }], rewards, { room: null, events: [], said: [] }, DAY);
    const runRemote = (s: Save, heldRemote: boolean, rewards: Rewards) =>
      gmAward(s, [], rewards, { room: null, events: [], said: [] }, DAY, null, null, { targets: [{ key: KAI, name: 'Kai' }], heldRemote: () => heldRemote, stamp: null });

    // Local unique-job-only refusals stay pending
    expect(awardKeepsPending(jobOnly, runLocal(gmAlone(down), 'sheet', jobOnly))).toBe(true);
    expect(awardKeepsPending(jobOnly, runLocal(gmAlone(), 'fight', jobOnly))).toBe(true);
    expect(awardKeepsPending(jobOnly, runLocal(gmAlone(full), 'sheet', jobOnly))).toBe(true);
    expect(awardKeepsPending(jobOnly, runLocal(gmAlone(taken), 'sheet', jobOnly))).toBe(true);
    // Remote unique-job-only refusals stay pending
    expect(awardKeepsPending(jobOnly, runRemote(gmAlone(), true, jobOnly))).toBe(true);
    expect(awardKeepsPending(jobOnly, runRemote(gmAlone(taken), false, jobOnly))).toBe(true);
    // Taken unique-job-only reward is approved (not kept pending)
    expect(awardKeepsPending(jobOnly, runLocal(gmAlone(), 'sheet', jobOnly))).toBe(false);
    expect(awardKeepsPending(jobOnly, runRemote(gmAlone(), false, jobOnly))).toBe(false);
    // Reward with gold + refused unique job is approved (gold landed)
    expect(awardKeepsPending(SERAPH, runLocal(gmAlone(down), 'sheet', SERAPH))).toBe(false);
    // Plain (non-unique) job-only reward is not held pending by unique-job refusal
    expect(awardKeepsPending(plainJob, runLocal(gmAlone(down), 'sheet', plainJob))).toBe(false);
    // Bundle give is never treated as a waiting reward approval
    expect(awardKeepsPending(jobOnly, runLocal(gmAlone(down), 'sheet', jobOnly), { key: 'b1', name: 'Seraph Gift', window: null })).toBe(false);
  });

  test('a unique job granted to a downed hunter answers its refusal "dead"', () => {
    const g = grant(gmAlone(down), 'h1', SERAPH, { ...DAY, vitals: 'sheet' });
    if (isRefused(g)) throw new Error(g.why);
    expect(g.job).toBeNull();
    expect(g.jobRefused?.why).toBe('dead');
    expect(g.save.classHolders ?? {}).toEqual(gmAlone(down).classHolders ?? {});
  });

  test('a list of lines is still taken as it is', () => {
    const r = gmAward(gmAlone(), [{ hid: 'h1', vitals: 'fight' }], SERAPH, { room: null, events: [], said }, DAY);
    expect(r.save.log[0]!.text).toBe(said[0]!.text);
  });
});
