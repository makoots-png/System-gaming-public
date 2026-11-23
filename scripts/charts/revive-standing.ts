// The charts of a hunter's revive ladder and System revive debt (src/core/hunter/revive-standing.ts `standingStep`, `debtStep`).
import { DEBT_STATES, REVIVE_STANDINGS, STANDING_EVENT_TYPES, debtState, debtStep, standingStep } from '../../src/core/hunter/revive-standing.ts';
import type { DebtEvent, DebtState, ReviveStanding, StandingEvent } from '../../src/core/hunter/revive-standing.ts';
import { RANKS, RULES } from '../../src/core/rules.ts';
import { isRefused } from '../../src/core/save-step.ts';
import { bfs, machine } from '../statecharts.ts';

const EVENTS: readonly StandingEvent[] = STANDING_EVENT_TYPES.map(type => ({ type }));
/** The words of docs/world/machines.md "Revive standing". */
const LABEL: { readonly [S in ReviveStanding]: string } = { free: 'Free revive left', debt: 'Debt revive left', none: 'Crystal or GM only' };
const STEP: { readonly [S in ReviveStanding]: string } = {
  free: 'the System raises the dead hunter for free',
  debt: 'the System raises the dead hunter on debt',
  none: '',
};

export const reviveStanding = machine<ReviveStanding, StandingEvent>({
  name: 'A hunter\'s revive ladder',
  walked: `Every standing reachable from a new hunter's (\`free\`) under the events of \`STANDING_EVENT_TYPES\` (${STANDING_EVENT_TYPES.join(', ')}), breadth first.`,
  walk: () => bfs<ReviveStanding, StandingEvent>(['free'], s => EVENTS.flatMap(event => { const to = standingStep(s, event); return isRefused(to) ? [] : [{ event, to }]; }), s => s),
  kinds: REVIVE_STANDINGS,
  kindsOf: s => [s],
  views: [{
    title: 'The System raises a dead hunter twice: once free, once on debt',
    note: 'World rule 6: "the first revive is free; after that, one revive on debt; after that none, unless the GM grants one or the hunter uses a revive item bought before death." The owner, Nov 22: the free revive and the revive on debt are a "System raise", with no GM button. Only a System raise moves the standing; the GM\'s Revive and a Resurrection Crystal raise the hunter and leave the standing as it is. In Crystal or GM only a raise is refused (`spent`).',
    hides: '',
    state: s => LABEL[s],
    step: (_e, from) => STEP[from],
  }],
  where: [
    ['The union', '`ReviveStanding`, `StandingEvent` and `REVIVE_STANDINGS` in `src/core/hunter/revive-standing.ts`; the standing is `Hunter.reviveLeft`, repaired to `free`'],
    ['What changes it', '`standingStep(standing, event)` and its `TABLE`; `canRaise(standing)` for a view'],
    ['Who calls it', '`systemRaise` in `src/core/hunter/grant.ts`, its one writer, which steps the standing, the life (`sheetEdit`, a revive by the System) and the debt (`raiseOwes`, `RULES.reviveDebtPrices[rank]` times `RULES.priceBase[rank]`) in one write; `api.systemRaise` and `offerRaise` in `src/views/hunter.js`, the window THE SYSTEM CAN REVIVE YOU on the dead hunter\'s own phone once no fight holds it'],
    ['The test to copy', '`tests/revive-standing.test.ts`'],
    ['The recipe', 'docs/guide/save-store.md, "A field of a saved thing"'],
  ],
});

const DEBT_EVENTS: readonly DebtEvent[] = [
  { type: 'incur', amount: 100 },
  { type: 'clearGold', gold: 100 },
  { type: 'clearGold', gold: 200 },
  { type: 'xp', xp: 40 },
];
const DEBT_LABEL: { readonly [S in DebtState]: string } = { clear: 'No debt', owing: 'Owing debt' };
const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;
const debtPct = pct(RULES.reviveDebtShare);
const burnPct = pct(RULES.reviveDebtBurn);
const keepPct = pct(1 - RULES.reviveDebtShare - RULES.reviveDebtBurn);
const xpPct = pct(RULES.reviveDebtXpRate);
const debtMults = RANKS.map(r => `${r} ${RULES.reviveDebtPrices[r]}`).join(', ');

export const reviveDebt = machine<number, DebtEvent>({
  name: 'A hunter\'s revive debt',
  walked: 'Both debt states (`clear` at 0 and `owing` above 0) walked from 0 under `incur`, `clearGold` (partial and full payoff), and `xp` with the shipped rules, breadth first.',
  walk: () => bfs<number, DebtEvent>(
    [0],
    d => DEBT_EVENTS.map(event => ({ event, to: debtStep(d, event, RULES).debt })),
    d => debtState(d),
  ),
  kinds: DEBT_STATES,
  kindsOf: d => [debtState(d)],
  views: [{
    title: 'System debt (revive on debt or shop borrowing) splits clear gold three ways and cuts XP until debt reaches 0',
    note: `the owner (Nov 23), qd rows 72 and 73: a System revive from the debt standing adds \`raiseOwes\` gold (\`reviveDebtPrices[rank]\` times \`priceBase[rank]\`, default \`${debtMults}\`) to \`Hunter.debt\` (ignoring \`borrowCapPrices\`), and shop borrowing adds an allowed shortfall up to \`borrowCap(rank, R)\` (\`borrowCapPrices\`, default \`${RULES.borrowCapPrices}\` times \`priceBase[rank]\`, blocked when \`borrowCapPrices <= 0\` or \`reviveDebtShare <= 0\`). While \`Hunter.debt\` is above 0, gate clear gold splits three ways: \`reviveDebtShare\` (${debtPct}) goes to debt, \`reviveDebtBurn\` (${burnPct}) is lost to debt costs, and the hunter gets the rest (${keepPct}). On the final clear when remaining debt is smaller than the debt share, debt costs apply in proportion to the debt paid and the hunter gets the extra. Positive XP from every source is multiplied by \`reviveDebtXpRate\` (${xpPct}, rounded with Math.round) until debt reaches 0; gold pays debt first, so a clear that finishes the debt earns full XP. Non-clear gold, trades, stash withdrawals, shop sales, and manual GM gold edits do not touch debt. Paying the debt to 0 leaves \`Hunter.reviveLeft\` unchanged.`,
    hides: '',
    state: d => DEBT_LABEL[debtState(d)],
    step: (e, from, to) => {
      if (e.type === 'incur') return from === 0 ? 'System revive on debt or shop borrow adds gold owed' : 'more debt added (revive or shop borrow)';
      if (e.type === 'xp') return from === 0 ? 'earned XP kept at 100% (no debt)' : `earned XP cut to ${xpPct} while owing debt`;
      if (from === 0) return 'gate clear gold kept in full (no debt)';
      return to === 0 ? 'gate clear gold pays off the rest of the debt (proportional debt costs)' : `gate clear gold splits ${debtPct} debt / ${keepPct} hunter / ${burnPct} lost`;
    },
  }],
  where: [
    ['The union', '`DebtState`, `DebtEvent`, `DebtStep`, and `DEBT_STATES` in `src/core/hunter/revive-standing.ts`; the balance is `Hunter.debt`, repaired to 0 or above'],
    ['What changes it', '`debtStep(debt, event, R)`, `DEBT_TABLE`, `borrowCap(rank, R)`, and `paysDebt(from)`'],
    ['Who calls it', '`systemRaise` (`incur`) and `grant` (`clearGold` when `paysDebt(from)` holds, and `xp` for positive earned XP from every source) in `src/core/hunter/grant.ts`, and `buy` (`incur` within `borrowCap`) in `src/core/hunter/inventory.ts`'],
    ['The test to copy', '`tests/revive-standing.test.ts`'],
    ['The recipe', 'docs/guide/save-store.md, "A field of a saved thing"'],
  ],
});
