// The chart of a mythic's standing in its script (src/core/combat/mythic.ts `mythicStep`), walked breadth first over
// every event of its table with the Angel of the Last Trumpet's three phases, one box for each phase.
import { MYTHIC_STATES, mythicStep, scriptOf } from '../../src/core/combat/mythic.ts';
import type { MythicEvent, MythicEventType, MythicState } from '../../src/core/combat/mythic.ts';
import type { MythicStanding, OmenKey } from '../../src/core/combat/mythic-types.ts';
import { combatantId } from '../../src/core/combat/ability-types.ts';
import { tick } from '../../src/core/combat/timeline.ts';
import { mythicScriptOf } from '../../src/core/registry/mythics.ts';
import type { MythicScriptId } from '../../src/core/registry/mythics.ts';
import { RULES } from '../../src/core/rules.ts';
import { isRefused } from '../../src/core/save-step.ts';
import { bfs, machine } from '../statecharts.ts';

const ANGEL: MythicScriptId = 'angel-of-the-last-trumpet';
/** Every event, the next phase both ways: by its turn and by the GM's hand. */
const EVENTS: readonly MythicEvent[] = [
  { type: 'next', now: tick(RULES.fight.round), by: 'turn' }, { type: 'next', now: tick(RULES.fight.round), by: 'gm' },
  { type: 'announce', omen: 'weighed' as OmenKey, aim: combatantId('c-hunter'), hpAt: 1, barAt: null }, { type: 'beat' },
  { type: 'cancel', how: 'interrupt', back: tick(RULES.fight.round) }, { type: 'weaken', how: 'burst', back: tick(RULES.fight.round) }, { type: 'land' }, { type: 'fizzle' }, { type: 'drop' },
];
/** The words of the mythic's card. */
const LABEL: { readonly [S in MythicState]: string } = { calm: 'In its phase', omen: 'Omen announced', faltering: 'Omen weakened' };

const STEP: { readonly [T in MythicEventType]: (e: Extract<MythicEvent, { type: T }>) => string } = {
  next: e => (e.by === 'turn' ? 'its turn starts held at its gate, or past a clock phase\'s clock' : 'the GM\'s Next phase'),
  announce: () => 'its turn starts on an omen beat: it announces the omen',
  beat: () => 'its turn starts on an act beat',
  cancel: () => 'an answer that cancels it: nothing lands, and its phase\'s clock goes back',
  weaken: () => 'an answer that weakens it: its phase\'s clock goes back',
  land: () => 'its next turn: the move lands',
  fizzle: () => 'its next turn: its aim is gone or out of range',
  drop: () => 'the GM drops the omen',
};
const stepWords = (e: MythicEvent): string => (STEP[e.type] as (e: MythicEvent) => string)(e);

export const mythic = machine<MythicStanding, MythicEvent>({
  name: 'A mythic\'s standing in its script',
  walked: `Every standing reachable from the first phase's first beat under the ${EVENTS.length} events (the next phase by its turn and by the GM), with the Angel of the Last Trumpet's ${mythicScriptOf(ANGEL).phases.length} phases, breadth first; standings that differ only in their beat or the time their phase began are one.`,
  walk: () => bfs<MythicStanding, MythicEvent>(
    [{ at: 'calm', script: ANGEL, phase: 0, beat: 0, since: tick(0) }],
    s => EVENTS.flatMap(event => { const to = mythicStep(s, event); return isRefused(to) ? [] : [{ event, to }]; }),
    s => `${s.at}/${s.phase}`,
  ),
  kinds: MYTHIC_STATES,
  kindsOf: s => [s.at],
  views: [{
    title: 'A mythic in its phases, its omens and their answers',
    note: 'One box for each of the Angel\'s phases, with the mythic\'s card inside. Its turn start raises the event: in its phase, the next phase when the phase is over (held at its gate, or a clock phase past its clock), else an omen beat announces and an act beat plays as any monster\'s turn. A standing omen lands on its next turn, or fizzles when its aim is gone or out of range. Between the two the party answers: an answer\'s outcome, read from the omen, cancels it or weakens it, and a second weaken does nothing. A stagger or a burst answer counts only what lands on its bar or its HP after the announce, which the omen keeps (`barAt`, `hpAt`), and asks more than ordinary turns land in that time (`mythic.answerReach`, decision 42); either winds a gate phase\'s clock back (`answerBack`: `mythic.answerTime` rounds, never past the phase\'s start), so answering buys the party time. The next phase from a standing omen loses the omen, so pushing it to its gate is an answer too. The last phase has no next phase: it ends at 0 HP, which is its life\'s (row-life.ts), not the script\'s. Whether it is held at its gate or enraged past a gate phase\'s clock is read from the standing, the script, its HP and the time (mythic.ts), never stored.',
    hides: '',
    state: s => [scriptOf(s).phases[s.phase]?.name ?? `Phase ${s.phase + 1}`, LABEL[s.at]],
    step: stepWords,
  }],
  where: [
    ['The union', '`MythicStanding` in `src/core/combat/mythic-types.ts`; `MythicState`, `MythicEvent` and `MythicRefusal` in `src/core/combat/mythic.ts`'],
    ['What changes it', '`mythicStep(standing, event)` and its `MYTHIC_TABLE`; `mythicCan` answers a view before it shows a button'],
    ['What is read from it', '`gateOf`, `heldAtGate`, `clockOut`, `answerBack`, `phaseOver`, `enraged`, `beatOf`, `landingMove`, `omenAim`, `barLanded` and `answerMet` in `src/core/combat/mythic.ts`'],
    ['Who calls it', 'Nothing yet: the fight\'s turn start, `consequences` and the gate in `row-life.ts` (unit MY3) and the landing (MY4)'],
    ['The test to copy', '`tests/mythic.test.ts`, "a mythic\'s standing as a machine: every state against every event"'],
    ['The recipe', 'A new event is a member of `MythicEvent` and its cell in every row of `MYTHIC_TABLE`; a new mythic is a row of `MYTHICS` (`src/core/registry/mythics.ts`)'],
  ],
});
