// notify.ts: the browser's notifications, for a GM's phone whose page is hidden when a player uses a told thing. The one
// module that touches the Notification API. A notification goes through the service worker's registration
// (`showNotification`), tagged with the room event id so a repeat shows once; src/sw.js focuses the app on a tap.
// No push service: a phone with its screen locked gets nothing until it is opened (docs/agent-handoff/cz/design.md).

import { reported } from './report.ts';

/** What the GM view shows: allowed, refused, not asked yet, or a browser without notifications. */
export type NotifyState = 'granted' | 'denied' | 'default' | 'unsupported';

const supported = (): boolean => typeof Notification !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

export const notifyState = (): NotifyState => (supported() ? Notification.permission : 'unsupported');
/** Notifications are allowed: sync.ts lets a GM's hidden page poll (`hiddenWait` in src/core/sync/link.ts). */
export const notifying = (): boolean => notifyState() === 'granted';

/** Asks the browser for permission (it shows its own prompt once); answers the state after. */
export async function askToNotify(): Promise<NotifyState> {
  if (!supported()) return 'unsupported';
  try { return await Notification.requestPermission(); } catch (e) { reported('notify', e); return notifyState(); } // the switch shows the state as it is
}

/**
 * Shows a notification when the page is hidden and notifications are allowed; answers whether it asked for one. `tag`
 * (the event id) makes a second one with the same tag replace the first instead of showing twice.
 */
export async function notifyHidden(title: string, body: string, tag: string): Promise<boolean> {
  if (!notifying() || document.visibilityState !== 'hidden') return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, { body, tag, icon: 'icons/icon-192.png' });
    return true;
  } catch (e) { reported('notify', e); return false; } // the page still shows the news when it is next opened
}
