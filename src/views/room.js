// room.js: the Room view (#/room). Join, create, share and manage the campaign room. Talks to sync.ts only through app.api.sync.
// DOM is built once in mount and updated in place; inputs the user may be typing in are never replaced.
import { CODE_LEFT_OUT, CODE_LEN, parseRoomCode } from '../core/ids.ts';
import { tapWords } from '../core/sync/taps.ts';
import * as motion from './motion.ts';
import { qrSvg } from '../core/qr.js';
import { ROOM_IS, ROOM_PATH } from '../core/first-run.ts';
import { LOBBY_START, checkAnswer, checkAsking, lobbyStep, seatBusy } from '../core/sync/lobby.ts';
/** Whether `v` is a room code (src/core/ids.ts `parseRoomCode`). */
const isCode = v => parseRoomCode(v) !== null;
const STYLE = `
.rm-lobby,.rm-card,.rm-l,.rm-r{display:flex;flex-direction:column;gap:18px;min-width:0}
#view-room .win{margin:0}#view-room .win p{margin:0 0 10px}
#view-room [hidden]{display:none!important}
.rm-wide{width:100%}.rm-row{display:flex;gap:8px;align-items:stretch}.rm-row input{flex:1 1 0;min-width:0}
.rm-row button{flex:0 0 auto}
.rm-mono,.rm-code,#view-room input[data-code],#view-room input[data-rcode]{font-family:var(--font-mono)}
#view-room input[data-code]{font-size:20px;letter-spacing:.14em;text-transform:uppercase}
.rm-chk{min-height:20px;font-size:13px;color:var(--muted);margin:6px 0!important}
.rm-chk[data-k=ok]{color:var(--green)}.rm-chk[data-k=bad]{color:var(--red)}
.rm-sub,.rm-hint{font-size:13px;color:var(--muted)}.rm-is{margin:0;line-height:1.45}
.rm-state{display:flex;align-items:center;gap:8px;font-weight:600;letter-spacing:.06em}
.rm-mark{flex:none;width:11px;height:11px;border-radius:50%;box-sizing:border-box}
[data-conn=live] .rm-mark{background:var(--cyan);box-shadow:0 0 6px var(--cyan)}[data-conn=connecting] .rm-mark,[data-conn=joining] .rm-mark,[data-conn=creating] .rm-mark{border:2px solid var(--cyan)}
[data-conn=reconnecting] .rm-mark,[data-conn=notSent] .rm-mark,[data-conn=sheetTooBig] .rm-mark,[data-conn=locked] .rm-mark{border-radius:0;width:0;height:0;border:6px solid transparent;border-bottom:10px solid #ff9d4d;border-top:0}
[data-conn=reconnecting],[data-conn=notSent],[data-conn=sheetTooBig],[data-conn=locked]{color:#ff9d4d}
.rm-codeline{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:10px 0}
.rm-code{display:flex;gap:.45em;font-size:34px;font-weight:700;letter-spacing:.1em;color:var(--ice)}
.rm-big{font-size:30px;margin:6px 0}
.rm-share{display:flex;flex-direction:column;gap:10px;align-items:flex-start;min-width:0}
.rm-qr{background:#fff!important;border:0;padding:0;line-height:0;display:block;align-self:center;cursor:zoom-in}
.rm-qr:hover{box-shadow:0 0 0 2px var(--cyan)}.rm-qr svg{display:block}
.rm-btns{display:flex;gap:8px;flex-wrap:wrap;width:100%}.rm-btns button{flex:1 1 120px}
.rm-link{font-family:var(--font-mono);font-size:13px;word-break:break-all;user-select:text;margin:0!important}
.rm-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.rm-p{border-bottom:1px solid rgba(27,74,110,.5)}
.rm-prow{display:flex;align-items:center;gap:10px;min-height:52px}
.rm-pi{flex:1;min-width:0;display:flex;flex-direction:column}.rm-pi b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rm-pi small{color:var(--muted);font-size:12px}
.rm-pm{flex:none;width:10px;height:10px;border-radius:50%;box-sizing:border-box}
.rm-pm[data-st=online]{background:var(--green)}.rm-pm[data-st=away]{border:2px solid var(--muted)}.rm-pm[data-st=unknown]{border-radius:0;height:2px;background:var(--muted)}
.rm-pact{display:flex;flex-direction:column;gap:8px;padding:0 0 10px}
.rm-kick{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:52px}
.rm-gr{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:52px}.rm-gr .rm-mono{flex:1 1 7ch;font-size:18px}
#view-room details.win>summary{cursor:pointer;color:var(--cyan);display:flex;align-items:center}
#view-room details.win[open]>summary{margin-bottom:10px}#view-room details.win>summary::after{content:"\\25be";margin-left:auto;padding-left:8px}#view-room details.win[open]>summary::after{content:"\\25b4"}
#view-room .sys-err:empty{min-height:0;margin:0}
.rm-fields{display:flex;flex-direction:column;gap:10px}.rm-fields .rm-row{align-items:flex-end}
.rm-sec h3{margin:0 0 6px;font-size:13px;letter-spacing:.14em;color:var(--cyan-dim);text-transform:uppercase}
#view-room input[type=password]{font-family:var(--font-body);font-size:16px;color:var(--ice);background:rgba(6,14,26,.9);border:1px solid var(--edge);padding:6px 9px;min-width:0}
#view-room input[type=password]:focus{outline:none;border-color:var(--cyan)}
.rm-sys-qr{display:flex;justify-content:center}
@media (max-height:500px){.sys-window:has(.rm-sys-qr) .n-tag{display:none}}
@media (min-width:721px) and (max-width:1099px) and (max-height:500px),(pointer:coarse),(max-width:720px){#view-room button,#view-room summary,#view-room select,#view-room input{min-height:44px;min-width:44px}#view-room select,#view-room input{font-size:16px}#view-room input[data-code]{font-size:20px}}
@media (min-width:721px) and (max-width:1099px) and (max-height:500px){.rm-card{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start}.rm-l{width:300px}}
@media (min-width:1100px){.rm-card{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start}.rm-l{width:340px}.rm-lobby{max-width:640px}}
`;

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app, { esc, h } = ui, Y = () => app.api.sync, sy = () => store.get().settings.sync;
  ui.css('room', STYLE);
  let el, root, q, raf = 0;
  // the lobby (src/core/sync/lobby.ts, moved only by lobbyDo), the timer of its code check's pause, the hunter picked under Play as
  let lobbyNow = LOBBY_START, pause = 0, picked = null;
  /** The roster rows whose Manage is open. */
  const open = new Set();
  // the room card's state line and connection line, by conn() (src/core/sync/connection.ts)
  const STATE = {
    live: ['Live', 'Live.'], connecting: ['Connecting', 'Connecting to the room.'], reconnecting: ['Reconnecting', 'Reconnecting. Waiting for the room server to respond.'],
    notSent: ['Live', 'Live. Your latest sheet has not been saved to the room server yet.'], sheetTooBig: ['Live', 'Live. Your sheet is too large for the room, so the GM cannot see your changes.'], locked: ['Live', 'Live. Your hunter is claimed by another device.'],
    tooBig: ['Live', 'Live. The fight is too large to share with players.'], waiting: ['Live', 'Live. Sending your changes to the room server.'],
    joining: ['Switching rooms', 'Joining another room.'], creating: ['Creating a room', 'Creating a new room.'],
  };
  const set = (n, t) => { if (n.textContent !== t) n.textContent = t; };
  // while the phone waits on the room there is no number to show: the line says what it waits for, with a quiet pulse
  const WAITING = new Set(['connecting', 'reconnecting', 'joining', 'creating']);
  const waitLine = (n, wait, t) => {
    if (wait) return motion.progress(n, null, t);
    if (n.dataset.prog) { delete n.dataset.prog; n.classList.remove('m-prog'); n.removeAttribute('role'); n.textContent = ''; }
    set(n, t);
  };
  const vis = () => !!root && !root.hidden;
  const sched = () => { if (raf || !vis()) return; raf = requestAnimationFrame(() => { raf = 0; render(); }); };
  const flash = (b, t) => { if (!b.dataset.lbl) b.dataset.lbl = b.textContent; b.textContent = t; clearTimeout(b._t); b._t = setTimeout(() => { b.textContent = b.dataset.lbl; }, 2000); };
  const setCode = (n, c) => { if (n.dataset.c === c) return; n.dataset.c = c; n.innerHTML = c ? `<span>${esc(c.slice(0, 3))}</span><span>${esc(c.slice(3))}</span>` : ''; };
  // a code checked as it is typed says what a failed join for it would (src/core/sync/taps.ts)
  const chk = (r, code) => !r ? ['', 'Checking...'] : !r.ok ? ['bad', `✗ ${tapWords('net', code)}`] : !r.exists ? ['bad', `✗ ${tapWords('notfound', code)}`] : r.gm ? ['ok', '✓ You are the GM of this room. You will rejoin as GM.'] : ['ok', '✓ Room found.'];
  const upper = (n, v) => { if (n.value === v) return; const a = n.selectionStart, e = n.selectionEnd, same = v.length === n.value.length; n.value = v; if (same && a != null) n.setSelectionRange(a, e); }; // keeps the caret when a letter is upper-cased mid-code
  const ERRS = ['err', 'lerr', 'cerr', 'gerr', 'kerr', 'ierr'], clearErrs = () => { for (const k of ERRS) q[k].textContent = ''; };
  const ago = ms => { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? `${s} sec ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} hr ago`; };

  const TPL = `
  <section class="win" data-invite hidden><span class="cb"></span><h2>Invite</h2>
    <div class="rm-code" data-invcode></div>
    <p class="rm-chk" role="status" data-invcheck></p><p class="rm-sub" data-invnote hidden></p>
    <div data-pahost="i"></div>
    <div class="sys-err" role="alert" data-ierr></div>
    <div class="rm-fields"><button type="button" class="primary rm-wide" data-joininvite>Join room</button><button type="button" class="rm-wide" data-notthis>Not this room</button></div>
  </section>
  <div class="rm-lobby" data-lobby>
    <p class="rm-is" data-roomis>${esc(ROOM_IS)}</p>
    <section class="win" data-s="last" hidden><span class="cb"></span><h2>Last room</h2>
      <div data-lastok><p class="rm-mono" data-lastcode></p><button type="button" class="primary rm-wide" data-rejoinlast></button></div>
      <div data-lastgone hidden><p data-gonetext></p><button type="button" class="rm-wide" data-forgetlast>Dismiss</button></div>
      <div class="sys-err" role="alert" data-lerr></div>
    </section>
    <section class="win" data-s="join"><span class="cb"></span><h2>Join a room</h2>
      <p class="rm-sub" data-path="player">${esc(ROOM_PATH.player)}</p>
      <div class="rm-row"><input type="text" data-code aria-label="Room code" placeholder="ABC234" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="go"><button type="button" class="primary" data-join disabled>Join</button></div>
      <p class="rm-chk" role="status" data-check></p>
      <div data-pahost="j"></div>
      <div class="sys-err" role="alert" data-err></div>
    </section>
    <section class="win" data-s="create"><span class="cb"></span><h2>Create a room</h2>
      <p class="rm-sub" data-path="gm">${esc(ROOM_PATH.gm)}</p><p class="rm-sub" data-gmonly>Only the GM creates a room. Creating one sets this device as the GM.</p>
      <button type="button" class="primary rm-wide" data-create>Create room</button><div class="sys-err" role="alert" data-cerr></div>
    </section>
    <section class="win" data-s="rooms" hidden><span class="cb"></span><h2>Your rooms</h2><div data-roomshost="l"></div></section>
    <details class="win" data-s="key"><summary>Rejoin as GM with a key</summary>
      <div class="rm-fields">
        <label class="field"><span class="lbl">Room code</span><input type="text" data-rcode placeholder="ABC234" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false"></label>
        <label class="field"><span class="lbl">GM key</span><input type="password" data-rkey autocomplete="off" spellcheck="false"></label>
        <button type="button" data-rejoingm>Rejoin as GM</button><div class="sys-err" role="alert" data-kerr></div>
      </div>
    </details>
  </div>
  <div class="rm-card" data-card hidden>
    <div class="rm-l">
      <section class="win"><span class="cb"></span><h2>Room</h2>
        <p class="rm-state" role="status" data-state><span class="rm-mark" aria-hidden="true"></span><span data-statetxt></span></p>
        <div class="rm-codeline"><div class="rm-code" data-roomcode></div><button type="button" data-copycode>Copy code</button></div>
        <div data-pahost="c"></div>
        <div class="rm-sec" data-invitebox><h3>Invite players</h3><p class="rm-sub">Players can join with this code, the link, or the QR code.</p><div data-sharehost="g"></div></div>
      </section>
    </div>
    <div class="rm-r">
      <section class="win" data-who><span class="cb"></span><h2>Who is here</h2>
        <p class="rm-sub" data-count></p><ul class="rm-list" data-roster></ul>
        <div class="rm-sec" data-kickbox hidden><h3>Recently removed</h3><ul class="rm-list" data-kicks></ul></div>
      </section>
      <section class="win" data-wordsec hidden><span class="cb"></span><h2>Word to the GM</h2><div data-words></div></section>
      <section class="win" data-conncard><span class="cb"></span><h2>Connection</h2>
        <p data-conntext></p><p class="rm-sub" data-ago></p>
        <p class="rm-sub" data-cl="off" hidden>This device is offline.</p><p class="rm-sub" data-cl="kept" hidden>Your changes are saved on this device and will send once you are back online.</p>
        <p class="rm-sub" data-cl="unsent" hidden>Your sheet is waiting to send.</p><p class="rm-sub" data-cl="locked" hidden>This hunter is claimed by another device. Ask the GM to release it.</p>
        <button type="button" data-retry hidden>Reconnect now</button>
      </section>
      <details class="win" data-tools><summary>GM tools</summary>
        <div class="rm-fields">
          <div class="rm-row" data-keyrow hidden><label class="field row-full"><span class="lbl">GM key (keep it private)</span><input type="password" data-gmkey readonly aria-label="GM key" autocomplete="off" spellcheck="false"></label><button type="button" data-showkey aria-pressed="false">Show</button><button type="button" data-copykey>Copy</button></div>
          <div data-roomshost="c"></div>
        </div>
      </details>
      <details class="win" data-invitedet><summary>Invite a friend</summary><div data-sharehost="p"></div></details>
      <button type="button" class="rm-wide" data-leave>Leave room</button>
    </div>
  </div>
  <label class="field" data-playas hidden><span class="lbl" data-palbl>Play as</span><select data-hunter></select></label>
  <label class="field" data-newf hidden><span class="lbl">New hunter name</span><input type="text" data-newname maxlength="60" autocomplete="off" placeholder="Your hunter's name"></label>
  <div class="rm-share" data-sharebox>
    <button type="button" class="rm-qr" data-qr aria-label="Enlarge QR code" hidden></button>
    <p class="rm-hint">Players scan this or open the link.</p>
    <div class="rm-btns"><button type="button" data-share hidden>Share invite</button><button type="button" class="primary" data-copyinvite>Copy link</button></div>
    <p class="rm-link" data-link></p><p class="rm-hint" data-local hidden>This link points to this device (localhost). A phone cannot open it. Open the app by its network address instead.</p>
  </div>
  <div class="rm-sec" data-roomsbox><h3>Your rooms</h3><ul class="rm-list" data-gmlist></ul><div class="sys-err" role="alert" data-gerr></div></div>`;

  function mount(m) {
    el = m; root = m.closest('.view'); m.innerHTML = TPL;
    const $ = s => m.querySelector(s); q = new Proxy({}, { get: (c, k) => { const n = String(k); return c[n] || (c[n] = $(n.includes('_') ? `[data-${n.split('_')[0]}="${n.split('_')[1]}"]` : `[data-${n}]`)); } });
    on();
    const p = Y().invite(); if (p) lobbyDo({ type: 'asked', code: p }); // an invite comes only with the page's address, before the view is drawn
    setInterval(() => { if (vis() && q.card && !q.card.hidden) { const d = Y().detail(); set(q.ago, d.lastOk ? `Last sync ${ago(d.lastOk)}.` : 'No sync yet.'); } }, 1000);
    window.addEventListener('resize', sched);
  }

  const hunters = () => store.get().hunters;
  /** A create or a join is under way, from this view or any other window: the link's state, never a copy of it. */
  const busy = () => { const c = Y().conn(); return c === 'creating' || c === 'joining'; };
  /** The hunter this phone plays in its room (sync.ts `bound`), or '' when none is bound. */
  const bound = () => { const b = Y().bound(); return b ? b.id : ''; };
  /** The hunter a join is for unless the player picks another: the one last played in a room, else the one shown. */
  const joinPick = () => bound() || store.get().settings.activeHunterId;
  function who(r) { // join options from the Play as row
    const hs = hunters();
    if (r && r.gm) return {};
    if (app.seat() !== 'alone') return { hunterId: bound() }; // switching rooms from an invite: the hunter already bound
    if (hs.length > 1 && q.hunter.value === '__new') return { name: q.newname.value.trim() };
    return { hunterId: hs.length > 1 ? q.hunter.value : (hs[0] || {}).id };
  }
  /** A tap the campaign's replacement ended (import, restore, reset): the new campaign is the answer, so no error shows. */
  const replaced = e => !!e && e.kind === 'replaced';
  /** What a failed tap for room `code` says (src/core/sync/taps.ts): nothing for a campaign replaced while it waited. */
  const said = (e, code, typed = false) => tapWords(e && e.kind ? e.kind : 'net', code, typed) ?? '';
  /** The lobby's one writer: steps it (src/core/sync/lobby.ts) and carries out what the step answers. */
  function lobbyDo(e) {
    const r = lobbyStep(lobbyNow, e); lobbyNow = r.state;
    for (const x of r.effects) {
      if (x.type === 'setTimer') pause = setTimeout(() => lobbyDo({ type: 'paused', code: x.code }), x.ms);
      else if (x.type === 'clearTimer') clearTimeout(pause);
      else if (x.type === 'ask') Y().check(x.code).then(answer => lobbyDo({ type: 'answered', of: x.of, code: x.code, answer }));
      else if (x.type === 'confirm') {
        ui.confirm({ title: `Remove ${x.name}?`, body: [`${x.name} will be removed from the party board and any active fight. Their device keeps their hunter but stops syncing with this room.`, app.api.trade.removeLine(x.key, x.name)].filter(Boolean).join(' '), danger: true, confirmLabel: 'Remove from room' })
          .then(yes => lobbyDo({ type: 'confirmed', key: x.key, room: x.room, yes: !!yes }));
      } else if (x.type === 'send') {
        // the room first: a removal the server did not take leaves the hunter in the fight as in the room
        const A = Y(), asked = x.act === 'remove' ? A.kick(x.key) : x.act === 'release' ? A.release(x.key) : A.allowBack(x.key);
        asked.then(call => lobbyDo({ type: 'seatAnswered', act: x.act, key: x.key, room: x.room, call }));
      } else if (x.type === 'told') told(x);
    }
    sched();
  }
  // the "as GM" buttons: the stored key or nothing (a refused key must not turn into a player join)
  async function asGM(code, errEl) {
    if (!Y().gmRooms().some(r => r.code === code) || busy()) return;
    errEl.textContent = ''; lobbyDo({ type: 'joinTapped' });
    try { await Y().rejoinGM(code); ui.toast('System', `Rejoined ${code} as GM.`, { kind: 'info' }); window.scrollTo(0, 0); }
    catch (e) { errEl.textContent = said(e, code); }
  }
  async function doJoin(kind, code, o, errEl, field) {
    if (busy()) return;
    errEl.textContent = '';
    if (o.name === '') { errEl.textContent = 'Name your new hunter.'; q.newname.focus(); return; }
    try {
      lobbyDo({ type: 'joinTapped' });
      const role = await Y().joinRoom(code, o);
      ui.toast('System', role === 'gm' ? `Rejoined ${code} as GM.` : `Joined room ${code}.`, { kind: 'info' });
      lobbyDo({ type: 'joined' }); picked = null; q.newname.value = ''; q.code.value = ''; window.scrollTo(0, 0);
    } catch (e) {
      if (replaced(e)) return;
      const k = e && e.kind; errEl.textContent = said(e, code);
      if (k === 'notfound') { if (kind === 'join' || kind === 'invite') lobbyDo({ type: 'notFound', of: kind, code }); else errEl.textContent = ''; }
      if (field) { field.focus(); field.select(); }
    } finally { render(); }
  }

  function on() {
    q.code.addEventListener('input', e => {
      let v = q.code.value;
      if (!/^[A-Za-z0-9]{0,6}$/.test(v)) { const c = Y().parseInvite(v); if (c) v = c; }
      v = v.toUpperCase(); if (!e.isComposing) upper(q.code, v); else v = q.code.value.toUpperCase();
      q.err.textContent = ''; lobbyDo({ type: 'typed', code: parseRoomCode(v) });
      render();
    });
    q.code.addEventListener('keydown', e => { if (e.key === 'Enter' && !q.join.disabled) { e.preventDefault(); q.join.click(); } });
    q.join.addEventListener('click', () => { const v = q.code.value; if (isCode(v)) doJoin('join', v, who(checkAnswer(lobbyNow.join, v)), q.err, q.code); });
    q.hunter.addEventListener('change', async () => {
      if (app.seat() !== 'alone') { await Y().switchTo(q.hunter.value); q.hunter.value = bound(); render(); return; }
      picked = q.hunter.value; render(); if (picked === '__new') q.newname.focus();
    });
    q.joininvite.addEventListener('click', () => { const c = Y().invite(); if (c) doJoin('invite', c, who(checkAnswer(lobbyNow.invite, c)), q.ierr, null); });
    q.notthis.addEventListener('click', () => { Y().dropInvite(); lobbyDo({ type: 'dropped' }); q.ierr.textContent = ''; render(); });
    q.rejoinlast.addEventListener('click', () => { const l = Y().lastRoom(); if (!l) return; if (l.gm) asGM(l.code, q.lerr); else doJoin('last', l.code, { hunterId: joinPick() }, q.lerr, null); });
    q.forgetlast.addEventListener('click', () => { q.lerr.textContent = ''; Y().forgetLast(); });
    q.create.addEventListener('click', async () => {
      q.cerr.textContent = ''; if (busy()) return; lobbyDo({ type: 'joinTapped' });
      try { await Y().create(); } catch (e) { q.cerr.textContent = said(e, ''); }
    });
    q.rcode.addEventListener('input', e => { if (!e.isComposing) upper(e.target, e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); });
    q.rejoingm.addEventListener('click', async () => {
      if (busy()) return; q.kerr.textContent = ''; const code = q.rcode.value.trim().toUpperCase(), key = q.rkey.value.trim();
      if (!isCode(code) || !key) { q.kerr.textContent = `Enter the ${CODE_LEN}-character room code and the GM key.`; return; }
      lobbyDo({ type: 'joinTapped' });
      try { await Y().rejoinGM(code, key); q.rkey.value = ''; ui.toast('System', `Rejoined ${code} as GM.`, { kind: 'info' }); window.scrollTo(0, 0); }
      catch (x) { q.kerr.textContent = said(x, code, !!key); }
    });
    q.gmlist.addEventListener('click', async e => {
      const b = e.target.closest('button[data-gr]'); if (!b) return; q.gerr.textContent = '';
      const code = b.dataset.code; if (!Y().gmRooms().some(r => r.code === code)) return;
      if (b.dataset.gr === 'rejoin') asGM(code, q.gerr);
      else if (await ui.confirm({ title: `Forget GM key for ${code}?`, body: (code === sy().room ? 'You will stop being GM of this room. ' : '') + 'This device will no longer be able to rejoin that room as GM unless you have the key saved elsewhere. The room itself is not deleted.', danger: true, confirmLabel: 'Forget key' })) {
        Y().forgetKey(code);
      }
    });
    // card
    q.copycode.addEventListener('click', async e => { try { await navigator.clipboard.writeText(Y().room()); flash(e.currentTarget, 'Copied'); } catch { flash(e.currentTarget, 'Select the code'); } }); // the browser refused the clipboard: the button tells the GM to copy by hand
    q.copyinvite.addEventListener('click', async e => {
      const b = e.currentTarget, link = Y().inviteLink();
      try { await navigator.clipboard.writeText(link); flash(b, 'Copied'); }
      catch { const r = document.createRange(); r.selectNodeContents(q.link); const s = getSelection(); s.removeAllRanges(); s.addRange(r); flash(b, 'Select and copy'); } // the browser refused the clipboard: the link is selected for the GM to copy
    });
    q.share.addEventListener('click', async e => {
      const b = e.currentTarget;
      try { await navigator.share({ title: 'The Hunter System', text: 'Join my room', url: Y().inviteLink() }); }
      catch (x) { if (!(x instanceof DOMException && x.name === 'AbortError')) flash(b, 'Use Copy link'); } // AbortError: the share sheet was closed, nothing to say
    });
    q.qr.addEventListener('click', () => {
      const link = Y().inviteLink(), svg = qrSvg(link, { quiet: 4 }); if (!svg) return;
      const s = +/viewBox="0 0 (\d+)/.exec(svg)[1], px0 = s * 2;
      // once the window is on the page, grow the code to what it can hold without scrolling: its width, and its height limit less everything else in it
      const drawn = win => {
        const box = win.querySelector('.rm-sys-qr'), sv = box.firstElementChild;
        const maxH = parseFloat(getComputedStyle(win).maxHeight) || innerHeight - 32, room = Math.min(box.clientWidth, maxH - (win.scrollHeight - px0) - 8, 560), px = s * Math.max(2, Math.floor(room / s));
        sv.setAttribute('width', px); sv.setAttribute('height', px);
      };
      ui.system({ tag: '! System', title: `ROOM ${Y().room() || ''}`, size: 'form', html: `<div class="rm-sys-qr">${sized(svg, px0)}</div>`, actions: [{ label: 'Close', value: null, cancel: true, primary: true }], drawn });
    });
    q.retry.addEventListener('click', async e => { const b = e.currentTarget; b.disabled = true; try { await Y().retry(); } finally { b.disabled = false; render(); } });
    q.showkey.addEventListener('click', e => { const i = q.gmkey, on = i.type !== 'text'; i.type = on ? 'text' : 'password'; e.currentTarget.textContent = on ? 'Hide' : 'Show'; e.currentTarget.setAttribute('aria-pressed', String(on)); });
    q.copykey.addEventListener('click', async e => {
      const k = sy().gmKey; if (!k) return;
      try { await navigator.clipboard.writeText(k); flash(e.currentTarget, 'Copied'); } catch { q.gmkey.type = 'text'; q.gmkey.select(); flash(e.currentTarget, 'Select and copy'); } // the browser refused the clipboard: the key is shown and selected
    });
    q.leave.addEventListener('click', () => { Y().leave(); window.scrollTo(0, 0); });
    // roster actions
    el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.manage) { const k = b.dataset.manage; open.has(k) ? open.delete(k) : open.add(k); render(); const nb = [...q.roster.querySelectorAll('button[data-manage]')].find(x => x.dataset.manage === k); if (nb) nb.focus(); }
      else if (b.dataset.gmkick) seat('remove', b.dataset.gmkick);
      else if (b.dataset.gmrelease) seat('release', b.dataset.gmrelease);
      else if (b.dataset.gmallow) seat('allow', b.dataset.gmallow);
    });
    // the server back: its old errors go and what it could not check is checked again; another room: its old errors go
    app.on('sync:status', e => { if (e.serverBack) { clearErrs(); lobbyDo({ type: 'serverBack', invite: Y().invite() }); } sched(); });
    app.on('sync:room', e => { clearErrs(); lobbyDo({ type: 'room', code: e.to }); sched(); });
    app.on('sync:sheets', sched); app.on('sync:docs', sched); app.on('change', sched);
  }
  const whyNot = c => (c.why === 'offline' ? 'could not reach the server. Check your connection and try again' : c.why === 'refused' ? `the room server rejected it (${c.reason})` : 'the server returned an error. Try again');
  /** A GM's tap on a seat action; the lobby sends it once, in the room it was tapped in. */
  function seat(act, key) {
    const r = act === 'allow' ? Y().recentKicks().find(x => x.key === key) : Y().roster().find(x => x.key === key);
    lobbyDo({ type: 'seatTapped', act, key, name: r ? r.name : act === 'allow' ? 'the player' : 'this hunter', room: Y().room() });
  }
  /** A seat action's answer, told in the room it was sent in (the lobby drops one from a room the phone left). */
  function told(x) {
    const c = x.call, ok = c.ok === true, n = x.name;
    if (x.act === 'remove') {
      const out = ok ? app.api.combat.removeRemote(x.key) : 0; open.delete(x.key);
      ui.toast('System', ok ? `Removed ${n} from the room${out ? ' and the fight' : ''}.` : `Could not remove ${n}: ${whyNot(c)}.`, { kind: ok ? 'info' : 'warn' });
    } else if (x.act === 'release') ui.toast('System', ok ? 'Released. The player can now claim this hunter on a new device.' : `Could not release: ${whyNot(c)}.`, { kind: ok ? 'info' : 'warn' });
    else ui.toast('System', ok ? `${n} can rejoin now.` : `Could not allow ${n} back: ${whyNot(c)}.`, { kind: ok ? 'info' : 'warn' });
  }
  const sized = (svg, px) => svg.replace('<svg ', `<svg width="${px}" height="${px}" `);

  function place(node, host) { if (node.parentNode !== host) host.append(node); }
  function render() {
    if (!el || !q || !Y()) return;
    const A = Y(), c = A.conn(), code = A.room(), seat = app.seat(), hs = hunters();
    if (c === 'off') return;
    // the invite lasts until it is joined or dropped; the link spends it once live in its room (sync.ts `spendInvite`)
    const pend = A.invite(), ia = pend ? checkAnswer(lobbyNow.invite, pend) : null, toward = A.detail().joining;
    // invite card
    q.invite.hidden = !pend;
    if (pend) {
      setCode(q.invcode, pend);
      const [k, t] = chk(ia, pend); q.invcheck.dataset.k = k; set(q.invcheck, t);
      q.invnote.hidden = !code; set(q.invnote, code ? `You are in room ${code}. Joining ${pend} will leave your current room.` : '');
      set(q.joininvite, code ? `Switch to ${pend}` : 'Join room');
      q.joininvite.disabled = busy(); q.joininvite.setAttribute('aria-busy', String(toward === pend));
    }
    // Play as row: one node, moved to wherever it is needed
    const inRoom = !!code, jr = pend ? ia : checkAnswer(lobbyNow.join, q.code.value);
    const host = pend ? q.pahost_i : inRoom ? q.pahost_c : q.pahost_j;
    const showPA = hs.length > 1 && (inRoom ? seat === 'player' && !pend : !(jr && jr.ok === true && jr.gm));
    q.playas.hidden = !showPA; place(q.playas, host); place(q.newf, host);
    set(q.palbl, inRoom ? 'Playing as' : 'Play as');
    const psig = (inRoom ? 'r' : 'l') + hs.map(x => x.id + x.name + x.level).join('|');
    if (q.hunter.dataset.sig !== psig) { q.hunter.dataset.sig = psig; q.hunter.innerHTML = hs.map(x => `<option value="${esc(x.id)}">${esc(x.name)} (Lv ${esc(x.level || 1)})</option>`).join('') + (inRoom ? '' : '<option value="__new">+ New hunter</option>'); }
    if (document.activeElement !== q.hunter) { const want = inRoom ? bound() : picked && (picked === '__new' || hs.some(x => x.id === picked)) ? picked : joinPick(); if (q.hunter.value !== want) q.hunter.value = want; }
    q.newf.hidden = !(showPA && !inRoom && q.hunter.value === '__new');
    // lobby / card
    q.lobby.hidden = inRoom; q.card.hidden = !inRoom;
    if (!inRoom) lobby(c, app.isGM(), toward); else card(c, code, seat === 'gm');
    q.sharebox.hidden = !inRoom;
  }

  function lobby(c, gm, toward) {
    const A = Y(), nodes = { last: q.lobby.querySelector('[data-s=last]'), join: q.lobby.querySelector('[data-s=join]'), create: q.lobby.querySelector('[data-s=create]'), rooms: q.lobby.querySelector('[data-s=rooms]'), key: q.lobby.querySelector('[data-s=key]') };
    const order = gm ? ['last', 'create', 'rooms', 'join', 'key'] : ['last', 'join', 'create', 'key'], sig = order.join();
    if (q.lobby.dataset.o !== sig) { q.lobby.dataset.o = sig; q.lobby.append(...order.map(k => nodes[k])); }
    // last room
    const l = A.lastRoom(); nodes.last.hidden = !l; q.lastok.hidden = !l || l.gone; q.lastgone.hidden = !l || !l.gone;
    if (l) { set(q.lastcode, l.code); set(q.rejoinlast, `Rejoin ${l.code}${l.gm ? ' as GM' : ''}`); set(q.gonetext, `Room ${l.code} no longer exists.`); }
    q.rejoinlast.disabled = busy(); q.rejoinlast.setAttribute('aria-busy', String(!!l && toward === l.code));
    // join
    const v = q.code.value, ok = isCode(v), ja = checkAnswer(lobbyNow.join, v);
    q.join.disabled = !ok || busy(); q.join.setAttribute('aria-busy', String(ok && toward === v));
    const [k, t] = !v ? ['', ''] : ok ? (ja ? chk(ja, v) : checkAsking(lobbyNow.join, v) ? chk(null, v) : ['', '']) : v.length >= 6 ? ['bad', `Codes have ${CODE_LEN} letters or digits (no ${CODE_LEFT_OUT.slice(0, -1).join(', ')} or ${CODE_LEFT_OUT.at(-1)}).`] : ['', ''];
    q.check.dataset.k = k; set(q.check, t);
    nodes.join.querySelector('[data-path]').hidden = gm; q.create.parentNode.querySelector('[data-gmonly]').hidden = gm; nodes.create.querySelector('[data-path]').hidden = !gm;
    q.create.disabled = busy(); q.create.setAttribute('aria-busy', String(c === 'creating')); set(q.create, gm ? 'Create room' : 'Create room as GM');
    const rc = q.rcode.value.trim().toUpperCase(); q.rejoingm.disabled = busy(); q.rejoingm.setAttribute('aria-busy', String(isCode(rc) && toward === rc));
    // your rooms
    const rows = A.gmRooms().filter(r => !r.current);
    place(q.roomsbox, q.roomshost_l); nodes.rooms.hidden = !gm || !rows.length; roomsRows(rows);
  }
  function roomsRows(rows) {
    q.roomsbox.hidden = !rows.length;
    const sig = rows.map(r => r.code).join();
    if (q.gmlist.dataset.sig !== sig) { q.gmlist.dataset.sig = sig; q.gmlist.innerHTML = rows.map(r => `<li class="rm-gr"><span class="rm-mono">${esc(r.code)}</span><button type="button" data-gr="rejoin" data-code="${esc(r.code)}" aria-label="Open ${esc(r.code)} as GM">Open as GM</button><button type="button" class="danger" data-gr="forget" data-code="${esc(r.code)}" aria-label="Forget GM key for ${esc(r.code)}">Forget</button></li>`).join(''); }
  }

  function card(c, code, gm) {
    const A = Y(), d = A.detail();
    q.card.dataset.gm = gm ? '1' : '0';
    q.state.dataset.conn = c; set(q.statetxt, (STATE[c] || STATE.reconnecting)[0]);
    setCode(q.roomcode, code);
    q.who.hidden = !gm; q.tools.hidden = !gm; q.invitedet.hidden = gm; q.invitebox.hidden = !gm;
    place(q.sharebox, gm ? q.sharehost_g : q.sharehost_p);
    place(q.roomsbox, q.roomshost_c);
    // connection
    waitLine(q.conntext, WAITING.has(c), (STATE[c] || STATE.reconnecting)[1]);
    set(q.ago, d.lastOk ? `Last sync ${ago(d.lastOk)}.` : 'No sync yet.');
    q.retry.hidden = !(c === 'reconnecting' || c === 'unreachable' || c === 'notSent');
    q.card.querySelector('[data-cl=off]').hidden = d.online; q.card.querySelector('[data-cl=kept]').hidden = c !== 'reconnecting';
    q.card.querySelector('[data-cl=unsent]').hidden = !d.unsent; q.card.querySelector('[data-cl=locked]').hidden = !d.locked;
    // share
    const link = A.inviteLink();
    set(q.link, link); q.local.hidden = !/^(localhost|127\.|\[::1\])/.test(location.hostname); q.share.hidden = !navigator.share;
    drawQr(link);
    // a player's word to the GM (src/views/words.js): the section shows while this phone plays a hunter in the room
    q.wordsec.hidden = gm; if (!gm) { app.api.words.player(q.words); q.wordsec.hidden = q.words.hidden; }
    if (!gm) return;
    // roster
    const rs = A.roster(), on = rs.filter(r => r.state === 'online').length, away = rs.filter(r => r.state === 'away').length;
    for (const k of [...open]) if (!rs.some(r => r.key === k)) open.delete(k);
    set(q.count, !rs.length ? 'No players yet. Share the code or the link.' : rs.some(r => r.state !== 'unknown') ? `${rs.length} here: ${on} online${away ? `, ${away} away` : ''}` : `${rs.length} here`);
    // a key whose seat action is out has its buttons wait (src/core/sync/lobby.ts `seatBusy`)
    const waits = k => (seatBusy(lobbyNow.seats, k, code) ? ' disabled aria-busy="true"' : ''), sig = JSON.stringify(rs) + [...open].join() + '|' + rs.map(r => waits(r.key)).join();
    if (q.roster.dataset.sig !== sig) {
      q.roster.dataset.sig = sig;
      const st = r => r.state === 'online' ? 'online' : r.state === 'away' ? (r.seen === 'now' || !r.seen ? 'away' : `away ${r.seen}`) : r.seen ? `last sync ${r.seen === 'now' ? 'a moment ago' : r.seen + ' ago'}` : '';
      q.roster.innerHTML = rs.map(r => { const o = open.has(r.key); return `<li class="rm-p"><div class="rm-prow"><span class="rm-pm" data-st="${r.state}" aria-hidden="true"></span><div class="rm-pi"><b>${esc(r.name)}</b><small>Lv ${esc(r.level)}${r.job ? ' · ' + esc(r.job) : ''}${st(r) ? ' · ' + esc(st(r)) : ''}</small></div><button type="button" data-manage="${esc(r.key)}" aria-expanded="${o}" aria-label="Manage ${esc(r.name)}">Manage</button></div>${o ? `<div class="rm-pact"><button type="button" class="danger" data-gmkick="${esc(r.key)}"${waits(r.key)}>Remove from room</button><button type="button" data-gmrelease="${esc(r.key)}"${waits(r.key)}>Release to a new device</button></div>` : ''}</li>`; }).join('');
    }
    const ks = A.recentKicks().filter(k => !rs.some(r => r.key === k.key)), ksig = JSON.stringify(ks) + '|' + ks.map(k => waits(k.key)).join();
    q.kickbox.hidden = !ks.length;
    if (q.kicks.dataset.sig !== ksig) { q.kicks.dataset.sig = ksig; q.kicks.innerHTML = ks.map(k => `<li class="rm-kick"><b>${esc(k.name)}</b><button type="button" class="primary" data-gmallow="${esc(k.key)}"${waits(k.key)} aria-label="Allow ${esc(k.name)} back into the room">Allow back</button></li>`).join(''); }
    // GM tools
    const key = sy().gmKey; q.keyrow.hidden = !key; if (key && q.gmkey.value !== key) q.gmkey.value = key;
    roomsRows(A.gmRooms().filter(r => !r.current));
  }
  function drawQr(link) {
    const svg = link ? qrSvg(link, { quiet: 4 }) : null;
    q.qr.hidden = !svg; if (!svg) return;
    const s = +/viewBox="0 0 (\d+)/.exec(svg)[1], max = innerHeight < 500 ? 190 : 240, px = s * Math.max(1, Math.floor(max / s)), sig = link + px;
    if (q.qr.dataset.sig === sig) return; q.qr.dataset.sig = sig; q.qr.innerHTML = sized(svg, px);
  }

  app.registerView({ id: 'room', label: 'Room', icon: '◉', order: 99, when: () => !!Y() && Y().conn() !== 'off', mount, update: () => render() });
}
