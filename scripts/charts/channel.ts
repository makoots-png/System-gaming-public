// The chart of a channel (src/core/combat/fight-channel.ts), walked breadth first over its table with a channel of max 3.
import { CHANNEL_STATES, channelState, channelStep } from '../../src/core/combat/fight-channel.ts';
import type { ChannelEvent, ChannelState } from '../../src/core/combat/fight-channel.ts';
import type { Channel } from '../../src/core/combat/effect-ops.ts';
import { abilityId, combatantId } from '../../src/core/combat/ability-types.ts';
import { RULES } from '../../src/core/rules.ts';
import { bfs, machine } from '../statecharts.ts';

/** Every event, with a channel ability of max 3 aimed at one foe and the rules' break share. */
const EVENTS: readonly ChannelEvent[] = [
  { type: 'begin', ability: abilityId('charge'), aim: combatantId('c-ogre'), spent: 0 }, { type: 'grow', max: 3 }, { type: 'release' },
  { type: 'interrupt', share: RULES.fight.breakShare }, { type: 'drop' },
];
/** The words of the channeler's card. */
const LABEL: { readonly [S in ChannelState]: string } = { none: 'Not channeling', holding: 'Channeling', broken: 'Broken, goes off at once', fired: 'Gone off' };

function step(e: ChannelEvent, from: Channel | null): string {
  switch (e.type) {
    case 'begin': return 'it uses a channel ability, paying its cost';
    case 'grow': return 'its turn starts: one more charge';
    case 'release': return from?.state === 'broken' ? 'the GM sends its dice: it goes off' : 'it releases, or it is full';
    case 'interrupt': return 'a hit of its hold, or a hold, root or taunt: half the charge';
    case 'drop': return 'it acts, moves or goes down';
  }
}

export const channel = machine<Channel | null, ChannelEvent>({
  name: 'A channel',
  walked: 'Every channel reachable from none under the five events of its table, with a channel ability of max 3, breadth first.',
  walk: () => bfs<Channel | null, ChannelEvent>([null], c => EVENTS.map(event => ({ event, to: channelStep(c, event) })), c => JSON.stringify(c)),
  kinds: CHANNEL_STATES,
  kindsOf: c => [channelState(c)],
  views: [{
    title: 'A channel, from its start to going off',
    note: 'The chart shows the channel on its user\'s card. Its charge grows one a turn to its max and stays in Channeling. At its max the user releases it or loses it on a pass. A broken channel waits for the GM\'s release, which resolves it at once at its halved charge and costs its user no time out of its turn. What a release costs is read from the state it went off from (`released`); a channel broken as its user\'s own turn starts costs that turn today, a row that waits on a ruling (rules-3.1).',
    hides: '',
    state: c => LABEL[channelState(c)],
    step,
  }],
  where: [
    ['The union', '`Channel` in `src/core/combat/effect-ops.ts`, `ChannelEvent` in `src/core/combat/fight-channel.ts`'],
    ['What changes it', '`channelStep(channel, event)` and its `TABLE` in `src/core/combat/fight-channel.ts`, called by the fight\'s reducer and, for every break, by `broken` in `src/core/combat/land.ts`; what a release costs is `released` and its `RELEASE` table'],
    ['Who calls it', '`src/core/combat/fight.ts`, `fight-turn.ts` and `land.ts`'],
    ['The test to copy', '`tests/fight.test.ts`, "a channel (4.1)"'],
    ['The recipe', 'A new event is a member of `ChannelEvent` and its cell in every row of `TABLE`'],
  ],
});
