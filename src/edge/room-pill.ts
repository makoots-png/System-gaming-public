// room-pill.ts: the room button at the top, the one door to the Room view (#/room), where a room is created, joined
// and shared. It draws `app.api.sync.conn()` (what `connection()` in src/core/sync/connection.ts answers) with the room
// code and the role, after each `sync:status` and change: out of a room it says what this phone would do there (a
// player joins, a GM creates), in one the room's code. It keeps no state of its own.
import type { App } from '../views/app.ts';
import type { Connection } from '../core/sync/connection.ts';
import { onUpdate, updateNow } from './upgrade.ts';

const CSS = `.sync-pill{font-size:12px;padding:4px 9px;white-space:nowrap;display:inline-flex;align-items:center;gap:5px;cursor:pointer}#sync-pill .sp-txt{white-space:nowrap}
    .sync-pill[data-conn=ready]{border-color:var(--gold);color:var(--gold)}.sync-pill[data-conn=unreachable],.sync-pill[data-conn=reconnecting],.sync-pill[data-conn=notSent],.sync-pill[data-conn=locked],.sync-pill[data-conn=tooBig],.sync-pill[data-conn=sheetTooBig]{border-color:#ff9d4d;color:#ff9d4d}.sync-pill[data-conn=live],.sync-pill[data-conn=waiting],.sync-pill[data-conn=connecting],.sync-pill[data-conn=creating],.sync-pill[data-conn=joining],.sync-pill[data-conn=upgrading]{color:var(--cyan,#4dd8ff)}
    .sp-mark{flex:0 0 auto;width:9px;height:9px;border-radius:50%;box-sizing:border-box;font-weight:700;line-height:1}[data-conn=ready] .sp-mark{display:none}[data-conn=connecting] .sp-mark,[data-conn=waiting] .sp-mark,[data-conn=creating] .sp-mark,[data-conn=joining] .sp-mark,[data-conn=upgrading] .sp-mark{border:2px solid currentColor}[data-conn=live] .sp-mark{background:currentColor;box-shadow:0 0 6px currentColor}[data-conn=unreachable] .sp-mark,[data-conn=reconnecting] .sp-mark,[data-conn=notSent] .sp-mark,[data-conn=locked] .sp-mark,[data-conn=tooBig] .sp-mark,[data-conn=sheetTooBig] .sp-mark{width:auto;height:auto;border-radius:0}`;
/** The words after "Room CODE:" for a connection with a room. */
const PILL_ROOM: Partial<Record<Connection, string>> = {
  live: 'live', connecting: 'connecting', reconnecting: 'reconnecting, changes are kept on this device',
  notSent: 'live, your sheet is not sent yet', locked: 'live, your hunter is claimed by another device',
  tooBig: 'live, the fight is too big to share', sheetTooBig: 'live, your sheet is too big for the room',
  waiting: 'live, sending what you did',
};

/** The pill, its tap and its CSS. Registered after src/edge/sync.ts, whose API it reads. */
export function register(app: App): void {
  const { ui } = app, { esc } = ui, sync = app.api.sync!;
  ui.css('sync', CSS);
  document.addEventListener('click', e => { const t = e.target as Element | null; if (t?.closest?.('[data-roompill],[data-joinpill]')) app.go('room'); });
  // While the app updates, the pill says where the update is (src/core/upgrade.ts, run by src/edge/upgrade.ts): the
  // share of the files the new worker has cached. The pill is an edge module, so the number is its text, not a bar of motion.ts.
  onUpdate(render);
  const updating = (): [string, string] => {
    const u = updateNow();
    if (u.at === 'installing' && u.count) return [`Updating ${Math.floor(u.count.done / u.count.of * 100)}%`, `Updating the app: ${u.count.done} of ${u.count.of} files`];
    if (u.at === 'ready') return ['Updating 100%', 'Updating the app: every file is ready'];
    if (u.at === 'reloading') return ['Reloading', 'Reloading into the new version of the app'];
    if (u.at === 'stuck') return ['Out of date', 'This app is out of date and could not update itself'];
    return ['Updating', 'Updating the app'];
  };

  // ── the pill: one button for every state; the mark (none, ring, dot, "!") differs in shape so the state never rests on colour alone ──
  function render(): void {
    const el = document.getElementById('sync-pill'); if (!el) return;
    const c = sync.conn(), code = sync.room() || '';
    const [txt, aria]: [string, string] | [] = c === 'off' ? []
      : c === 'ready' ? (app.isGM() ? ['Create room', 'Create a room'] : ['Join room', 'Join a room'])
      : c === 'unreachable' ? ['Offline', 'Offline: the server does not answer, so you play on this device']
      : c === 'upgrading' ? updating()
      : (c === 'creating' || c === 'joining') && !code ? [c === 'creating' ? 'Creating' : 'Joining', c === 'creating' ? 'Creating a room' : 'Joining a room']
      : [code, `Room ${code}: ${PILL_ROOM[c] ?? (c === 'creating' ? 'creating a new room' : 'joining another room')}`];
    const waiting = c === 'connecting' || c === 'waiting' || c === 'creating' || c === 'joining' || (c === 'upgrading' && updateNow().at !== 'stuck'); // the Motion block's quiet pulse
    const mark = c === 'unreachable' || c === 'reconnecting' || c === 'notSent' || c === 'locked' || c === 'tooBig' || c === 'sheetTooBig' ? '!' : '';
    const html = txt ? `<button type="button" class="pill sync-pill" data-roompill data-conn="${c}"${code ? '' : ' data-joinpill'} aria-label="${esc(aria)}"><span class="sp-mark${waiting ? ' m-waiting' : ''}" aria-hidden="true">${mark}</span><span class="sp-txt">${esc(txt)}</span></button>` : '';
    const first = el.firstElementChild as (Element & { _sig?: string }) | null;
    if (html && first && first._sig === html) return; // unchanged: a focused pill keeps focus
    el.innerHTML = html;
    if (html) (el.firstElementChild as Element & { _sig?: string })._sig = html;
  }

  app.on('sync:status', render);
  app.on('change', render); // out of a room the pill says Join room or Create room by role
  render();
}
