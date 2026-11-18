// The no-dead-end rule of the link and push machines, shared by tests/sync-model.test.ts (one phone, every reachable
// state) and tests/room-system-model.test.ts (several phones and the real server). A phone in a state that waits for
// something must have that something set or out, or it waits for a tap the UI does not offer.
import type { Link } from '../../src/core/sync/link.ts';
import type { Push } from '../../src/core/sync/push.ts';

const LINK_REQS = ['health', 'poll', 'create', 'peek', 'head'];

/** What breaks the rule, or null. `out` is the requests the phone still waits on (`req` is the call's name, or 'sheet'). */
export function deadEnd(link: Link, push: Push, timers: { poll?: number; push?: number }, out: { req: string }[]): string | null {
  const linkOut = out.filter(r => LINK_REQS.includes(r.req)).length, sheets = out.filter(r => r.req === 'sheet').length;
  if (linkOut > 1) return `${linkOut} link requests are out`;
  if (sheets > 1) return `${sheets} sheet sends are out`;
  if (link.at === 'idle' || link.at === 'live') {
    if (link.next === 'timer' && timers.poll === undefined) return `${link.at} waits for a poll timer that is not set`;
    if (link.next === 'polling' && linkOut !== 1) return `${link.at} waits for a poll that is not out`;
  } else if (link.at === 'creating' || link.at === 'joining') {
    if (linkOut !== 1) return `${link.at} has no request out`;
  } else if (timers.poll !== undefined) return `${link.at} has a poll timer`;
  if (push.at === 'waiting' || push.at === 'backoff' || push.at === 'locked') {
    const ms = timers.push;
    if (ms === undefined) return `push ${push.at} has no timer`;
  } else if (timers.push !== undefined) return `push ${push.at} has a timer`;
  if (push.at === 'sending' && sheets !== 1) return 'push sending with no send out';
  if (push.at !== 'sending' && sheets !== 0) return `push ${push.at} with a send out`;
  const playerLive = link.at === 'live' && link.key === null;
  if (playerLive !== (push.at !== 'off')) return `link ${link.at} with push ${push.at}`;
  if (push.at !== 'off' && push.gen !== link.gen) return 'the push is on another gen than the link';
  return null;
}
