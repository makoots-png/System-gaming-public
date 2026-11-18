// onboard.js (U15): first-run System-window sequence + the "?" quick-start. Exposes app.api.onboard = { quickstart }.
// Its words (what the site is, what a room is, the next steps, the tips) are src/core/first-run.ts's.
import { CODE_LEN, parseRoomCode } from '../core/ids.ts';
import { tapWords } from '../core/sync/taps.ts';
import { starterStep } from './starter.js';
import { atSettings, both } from '../core/save-step.ts';
import { firstStep, onboardStep } from '../core/onboarding.ts';
import { ownSeed } from '../core/starter.ts';
import { onboarded } from '../core/settings.ts';
import { chooseMode } from '../core/role.ts';
import { ABOUT, LOADED, ROOM_IS, TIPS, createdLine, nextSteps } from '../core/first-run.ts';
import { available } from '../core/hunter/progress.ts';
import { buildsOn, mayPick } from '../core/hunter/build.ts';
import { enter } from './motion.ts';
import { closeWindow, openWindow, trapTab } from './ui.js';

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc, h } = ui;

  ui.css('onboard', `.ob-overlay,.ob-gone{position:fixed;inset:0;z-index:70;background:rgba(2,6,12,.96);display:flex;align-items:center;justify-content:center;padding:calc(16px + var(--sat)) calc(16px + var(--sar)) calc(16px + var(--sab)) calc(16px + var(--sal));overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
    .ob-win{position:relative;background:var(--panel-solid);border:1px solid var(--line-bright);box-shadow:0 0 40px rgba(63,192,255,.5), inset 0 0 40px rgba(20,80,130,.3);padding:26px 22px 22px;width:min(520px,100%);max-height:100%;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;text-align:center;margin:auto}
    .ob-win h2{font-size:24px;letter-spacing:.1em;text-transform:uppercase;margin:0 0 12px;color:var(--ice);text-shadow:0 0 18px rgba(77,216,255,.7)}
    .ob-win p{color:var(--cyan-dim);margin:0 0 14px;font-size:15px;line-height:1.45}
    .ob-win .n-tag{font-size:12px;letter-spacing:.3em;text-transform:uppercase;color:var(--cyan);margin-bottom:10px}
    .ob-act{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:14px}
    .ob-act button{min-height:46px;min-width:120px;flex:1 1 120px}
    .ob-no{text-decoration:line-through;opacity:.7}
    .ob-form{text-align:left;display:grid;gap:12px}
    .ob-form .field{display:block}.ob-form input,.ob-form select{width:100%;min-height:44px;box-sizing:border-box;font-size:16px}
    .ob-tips{text-align:left;margin:0 0 12px;padding-left:20px;color:var(--ice);font-size:14px;line-height:1.45}
    .ob-tips li{margin-bottom:6px}.ob-h3{text-align:left;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--gold);margin:12px 0 6px}
    .ob-err{color:var(--red);min-height:1.2em;font-size:13px}
    .ob-chip{display:flex;gap:14px;justify-content:center;margin:0 0 10px;font-family:var(--font-mono);font-size:32px;letter-spacing:.2em;color:var(--gold);line-height:1.1}
    .ob-chk{min-height:1.2em;margin:0 0 10px;font-size:13px;color:var(--cyan-dim)}.ob-form .ob-chk{margin:0}
    .ob-overlay.ob-with-about,.ob-gone.ob-with-about{flex-direction:column}.ob-with-about .ob-win{margin:auto auto 0}
    .ob-about{margin:14px auto auto;max-width:min(520px,100%);text-align:center;color:var(--ice);font-size:14px;line-height:1.45}
    .ob-next{list-style:none;padding-left:0}.ob-next li{display:flex;gap:8px}.ob-next .ob-mark{flex:none;width:1.2em;color:var(--cyan-dim)}.ob-next [data-done] .ob-mark{color:var(--green)}
    .ob-help{display:block;margin-top:4px;font-size:13px;color:var(--cyan-dim)}
    .ob-skip{background:none;border:0;color:var(--cyan-dim);text-decoration:underline;min-height:44px;margin-top:6px;font-size:13px}
    @media (max-height:500px){.ob-chip{font-size:24px;margin-bottom:4px}}
    @media (min-width:721px) and (max-width:1099px) and (max-height:500px){.ob-overlay{padding:calc(8px + var(--sat)) calc(8px + var(--sar)) calc(8px + var(--sab)) calc(8px + var(--sal))}.ob-win{padding:14px 20px 12px}.ob-win h2{font-size:20px;margin-bottom:8px}.ob-win p{margin-bottom:8px}.ob-act{margin-top:8px}}`);

  /** The first-run window: one overlay on the window stack (ui.js), its content swapped per step. */
  let root = null, me = null, onEsc = null;
  /** The window leaves as every window does (ui.js `closeWindow`); its leaving copy is no longer an `.ob-overlay`. */
  function close() {
    if (!root) return;
    const el = root; root = null; onEsc = null;
    el.classList.replace('ob-overlay', 'ob-gone');
    closeWindow(me); me = null;
  }
  function key(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const f = onEsc; if (f) f(); return; }
    if (e.key === 'Tab') trapTab(e, root);
  }
  // one overlay, content swapped per step; focus goes to [data-focus] or the first button. `about`: a plain line drawn
  // below the window on the backdrop, which the window names as its description.
  function step(html, esc_, about = '') {
    const fresh = !root;
    if (fresh) {
      const trigger = document.activeElement;
      me = openWindow('onboard', () => { root = h('<div class="ob-overlay" role="presentation"></div>'); root._trigger = trigger; document.body.appendChild(root); return { root, win: null }; }, key);
    }
    const id = 'ob' + Math.random().toString(36).slice(2, 7);
    root.innerHTML = `<div class="ob-win" role="dialog" aria-modal="true" aria-labelledby="${id}"${about ? ` aria-describedby="${id}a"` : ''}><span class="cb"></span>${html.replace('{id}', id)}</div>${about ? `<p class="ob-about" id="${id}a">${esc(about)}</p>` : ''}`;
    root.classList.toggle('ob-with-about', !!about);
    me.win = root.firstElementChild;
    // each step's window rises as every window does; the backdrop fades in once
    void enter(root.firstElementChild);
    if (fresh) void enter(root, 'fade');
    onEsc = esc_;
    const f = root.querySelector('[data-focus]') || root.querySelector('button');
    if (f) f.focus();
    return root.firstElementChild;
  }

  // the seed hunter a new install starts with becomes the player's own, neutral (no Wolf Slayer title, no canon items, skills or quest)
  const owned = (name, job = '') => s => ownSeed(s, name || 'Hunter', job);
  /** The step of first-run setup on screen (src/core/onboarding.ts), or null when setup is not running. */
  let at = null;
  /**
   * Sends `event` to the setup machine. `write` is what the choice changes; on the transition that leaves setup it is
   * written with the onboarded mark in one `store.apply`, so a reload sees both or neither. Answers the write's answer.
   */
  function go(event, write = null) {
    const t = at === null ? null : onboardStep(at, event);
    if (!t) return { ok: false, why: 'stale' };
    const change = t.marks ? (write ? both(write, atSettings(onboarded)) : atSettings(onboarded)) : write;
    if (change) { const r = store.apply(`onboard-${event}`, change); if (!r.ok) return r; }
    at = t.to;
    DRAW[at](event);
    return { ok: true };
  }
  /** What a failed check or join for room `code` says (src/core/sync/taps.ts). */
  const why = (kind, code = '') => tapWords(kind, code) ?? '';
  // an invite link was opened before onboarding finished and the player did not take the join path: offer it now
  const invited = () => app.api.sync.invite();
  const offerJoin = () => { const c = invited(), sy = app.api.sync; if (c && sy.conn() !== 'off' && sy.room() !== c) app.go('room'); };
  const skip = () => { go('skip', owned('Hunter')); offerJoin(); };

  /** This phone's facts now for `role`'s next steps (src/core/first-run.ts): read, never stored. `rooms`: false hides the room steps. */
  function facts(role, rooms = app.api.sync.conn() !== 'off') {
    const sy = app.api.sync, d = sy.detail();
    if (role === 'gm') return { role, rooms, room: d.conn === 'creating' ? null : sy.room(), players: sy.remoteSheets().length };
    const h = store.active(), R = app.rules();
    const path = !buildsOn(R) || !mayPick(R, 'player') ? 'closed' : h.build.path ? 'picked' : 'open';
    return { role, rooms, points: available(h, R), path, room: d.joining ? null : sy.room(), joining: d.joining };
  }
  /** The next steps as list items: a done step says so in words for a screen reader and with a mark for the eye. */
  const stepsHtml = f => nextSteps(f, app.rules()).map(s => `<li data-k="${s.key}"${s.done ? ' data-done' : ''}><span class="ob-mark" aria-hidden="true">${s.done ? '✓' : '○'}</span><span>${s.done ? '<span class="sr-only">Done: </span>' : ''}${esc(s.words)}</span></li>`).join('');
  const nextHtml = f => { const li = stepsHtml(f); return li ? `<div class="ob-h3">Next steps</div><ol class="ob-tips ob-next" data-obnext>${li}</ol>` : ''; };
  /** Whether Hunter created still offers Join a room: the join step is listed, not done and not under way. */
  const mayJoin = f => f.rooms && f.room === null && f.joining === null;
  // the open window's next steps follow the room as it changes (a join or a create under way, a player joining the GM's)
  function freshen() {
    const list = root && root.querySelector('[data-obnext]'); if (!list) return;
    const f = facts(list.closest('[data-role]').dataset.role, list.closest('[data-rooms]') ? list.closest('[data-rooms]').dataset.rooms === 'yes' : undefined);
    const li = stepsHtml(f); if (list.innerHTML !== li) list.innerHTML = li;
    const j = root.querySelector('[data-objoin]'); if (j) j.hidden = !mayJoin(f);
  }
  app.on('sync:room', freshen);
  app.on('sync:status', freshen);

  function welcome() {
    const w = step(`<div class="n-tag">! System</div><h2 id="{id}">Welcome</h2>
      <p>[SYSTEM] You have been chosen as a Player.<br>Accept?</p>
      <div class="ob-act"><button type="button" class="primary" data-focus data-yes>Yes</button>
      <button type="button" class="ob-no" data-no aria-label="No (the System does not allow it)">No</button></div>
      <p class="ob-err" role="status" data-msg></p>
      <button type="button" class="ob-skip" data-skip>Skip intro</button>`, skip, ABOUT);
    const no = w.querySelector('[data-no]'), msg = w.querySelector('[data-msg]'); let n = 0;
    const dodge = () => {
      n++; no.style.transform = `translate(${(n % 2 ? -1 : 1) * (6 + (n % 3) * 4)}px, ${(n % 3 - 1) * 4}px)`;
      msg.style.color = 'var(--gold)';
      msg.textContent = n < 3 ? '[SYSTEM] Declining is not an option.' : '[SYSTEM] The System does not accept "No".';
      if (n >= 4) go('accept'); // returns: the choice was never yours
    };
    no.addEventListener('click', dodge); no.addEventListener('pointerenter', () => { no.style.transform = `translate(${n % 2 ? 8 : -8}px, 0)`; });
    w.querySelector('[data-yes]').addEventListener('click', () => go('accept'));
    w.querySelector('[data-skip]').addEventListener('click', skip);
  }

  function role() {
    const w = step(`<div class="n-tag">! System</div><h2 id="{id}">Who are you?</h2>
      <p>Choose how you will use the System on this device.</p>${invited() && app.api.sync.conn() !== 'off' ? `<p class="ob-invite">You were invited to room <b>${esc(invited())}</b>. Choose <b>I'm a Player</b> to join it.</p>` : ''}
      <div class="ob-act"><button type="button" class="primary" data-focus data-player>I'm a Player</button><button type="button" data-gm>I'm the GM</button></div>
      <button type="button" class="ob-skip" data-skip>Skip</button>`, skip);
    w.querySelector('[data-player]').addEventListener('click', () => go('player'));
    w.querySelector('[data-gm]').addEventListener('click', () => go('gm'));
    w.querySelector('[data-skip]').addEventListener('click', skip);
  }

  // opened from an invite link on a new device: one field, nothing saved until the room is known to exist
  function invite() {
    const code = invited(), sy = app.api.sync; let failed = false;
    const w = step(`<div class="n-tag">! Invitation</div><h2 id="{id}">Join a room</h2>
      <p>[SYSTEM] You were invited to a room.</p>
      <div class="ob-chip" data-roomchip aria-label="Room code ${esc(code)}"><span>${esc(code.slice(0, 3))}</span><span>${esc(code.slice(3))}</span></div>
      <p class="ob-chk" role="status" data-check>Checking the room...</p>
      <div class="ob-form"><label class="field"><span class="lbl">Hunter name</span><input type="text" data-name data-focus maxlength="60" autocomplete="off" enterkeyhint="go" placeholder="Your hunter's name"></label>
        <div class="ob-err" role="alert" data-err></div></div>
      <div class="ob-act"><button type="button" class="primary" data-go>Join</button></div>
      <button type="button" class="ob-skip" data-obmore>other options</button>`, () => more());
    const q = s => w.querySelector(s), err = q('[data-err]'), nm = q('[data-name]'), joinBtn = q('[data-go]'), mo = q('[data-obmore]');
    const more = () => { if (failed) sy.dropInvite(); go('more'); };
    sy.check(code).then(r => { if (!w.isConnected) return; q('[data-check]').textContent = !r.ok ? why('net') : r.exists ? 'Room found.' : why('notfound', code); });
    const fail = msg => {
      err.textContent = msg; q('[data-check]').textContent = ''; joinBtn.disabled = false; joinBtn.removeAttribute('aria-busy');
      if (!failed) { failed = true; joinBtn.textContent = 'Try again'; mo.textContent = 'Continue without a room'; mo.className = ''; q('.ob-act').appendChild(mo); }
    };
    const run = async () => {
      const name = nm.value.trim();
      if (!name) { err.textContent = 'Enter a name for your hunter.'; nm.focus(); return; }
      if (joinBtn.disabled) return;
      err.textContent = ''; joinBtn.disabled = true; joinBtn.setAttribute('aria-busy', 'true');
      const r = await sy.check(code); if (!w.isConnected) return; // backed out while the check ran
      if (!r.ok) return fail(why('net'));
      if (!r.exists) return fail(why('notfound', code));
      if (!go('joined', owned(name)).ok) return;
      await joinBehind(code);
    };
    joinBtn.addEventListener('click', run);
    nm.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    mo.addEventListener('click', more);
  }

  function player() {
    const hasServer = app.api.sync.status() !== 'off';
    const w = step(`<div class="n-tag">! Player</div><h2 id="{id}">Name your hunter</h2>
      <div class="ob-form">
        <label class="field"><span class="lbl">Hunter name</span><input type="text" data-name data-focus maxlength="60" autocomplete="off" placeholder="Your hunter's name"></label>
        <label class="field"><span class="lbl">Starting job (optional)</span><select data-job><option value="">None yet</option>${app.RULES.jobs.map(j => `<option>${esc(j)}</option>`).join('')}</select></label>
        ${hasServer ? `<div class="field"><label><span class="lbl">Room code from your GM (optional)</span><input type="text" data-room autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC234" aria-describedby="ob-room-help"></label><small class="ob-help" id="ob-room-help">No code yet? Begin without one and join later with the room button at the top.</small><small class="ob-chk" role="status" data-check></small></div>` : ''}
        <div class="ob-err" role="alert" data-err></div>
      </div>
      <div class="ob-act"><button type="button" data-back>Back</button><button type="button" class="primary" data-go>Begin</button></div>
      <button type="button" class="ob-skip" data-skip>Skip</button>`, skip);
    const q = s => w.querySelector(s), err = q('[data-err]');
    const room = q('[data-room]'), chk = q('[data-check]'), sy = app.api.sync; let seq = 0, tm = 0;
    const codeIn = () => room.value.trim().toUpperCase();
    const show = () => { // check a valid code 300 ms after typing stops; late answers are dropped
      clearTimeout(tm); const n = ++seq, c = codeIn(); chk.textContent = '';
      if (parseRoomCode(c) !== null) tm = setTimeout(async () => { const r = await sy.check(c); if (n === seq) chk.textContent = !r.ok ? why('net') : r.exists ? 'Room found.' : why('notfound', c); }, 300);
    };
    if (room) room.addEventListener('input', e => {
      let v = room.value; if (!/^[A-Za-z0-9]{0,6}$/.test(v)) v = sy.parseInvite(v) || v;
      v = v.toUpperCase(); if (!e.isComposing && room.value !== v) { const a = room.selectionStart, z = room.selectionEnd, same = v.length === room.value.length; room.value = v; if (same && a != null) room.setSelectionRange(a, z); } show(); // keeps the caret
    });
    if (room && invited()) { room.value = invited(); show(); } // J01: opened from an invite link
    const begin = async () => {
      const name = q('[data-name]').value.trim();
      if (!name) { err.textContent = 'Enter a name for your hunter.'; q('[data-name]').focus(); return; }
      const b = q('[data-go]'); if (b.disabled) return;
      const code = room ? (sy.parseInvite(room.value) || codeIn()) : '';
      if (code && parseRoomCode(code) === null) { err.textContent = `Room codes are ${CODE_LEN} characters.`; room.focus(); return; }
      err.textContent = '';
      if (code) {
        b.disabled = true; b.setAttribute('aria-busy', 'true');
        const r = await sy.check(code), bad = !r.ok ? why('net') : r.exists ? '' : why('notfound', code);
        b.disabled = false; b.removeAttribute('aria-busy'); if (!w.isConnected) return; // backed out while the check ran
        if (bad) { err.textContent = bad + ' Or clear the room code to begin without a room.'; room.focus(); return; }
      }
      if (!go('begun', owned(name, q('[data-job]').value)).ok) return;
      if (code) await joinBehind(code);
    };
    q('[data-go]').addEventListener('click', begin);
    q('[data-name]').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); begin(); } });
    q('[data-back]').addEventListener('click', () => go('back'));
    q('[data-skip]').addEventListener('click', skip);
  }

  function gm() {
    const w = step(`<div class="n-tag">! GM</div><h2 id="{id}">Run the game</h2>
      <p>GM mode unlocks XP grants, free stat edits and GM tools on this device. How do you want to begin?</p>
      <div class="ob-act"><button type="button" class="primary" data-focus data-starter>Load starter campaign</button><button type="button" data-blank>Blank</button></div>
      <p class="ob-err" data-msg></p>
      <div class="ob-act"><button type="button" data-back>Back</button></div>
      <button type="button" class="ob-skip" data-skip>Skip</button>`, skip);
    const q = s => w.querySelector(s);
    q('[data-starter]').addEventListener('click', () => {
      if (!go('starter', starterStep(store, app)).ok) q('[data-msg]').textContent = 'Could not load the starter pack. Choose Blank instead.';
    });
    q('[data-blank]').addEventListener('click', () => { go('blank', both(owned('Hunter'), atSettings(st => chooseMode(st, 'gm')))); });
    q('[data-back]').addEventListener('click', () => go('back'));
    q('[data-skip]').addEventListener('click', skip);
  }

  // a join typed or invited during setup runs behind Hunter created: its list says Joining, then In room; a failed join
  // is a toast, and the join step stays not done with Join a room offered again. Nothing navigates under the window.
  async function joinBehind(code) {
    const sy = app.api.sync, joining = sy.joinRoom(code, { hunterId: store.active().id });
    freshen();
    try { await joining; } // rejects only with a tap's kind (src/edge/sync.ts)
    catch (e) { ui.toast('System', why(e && e.kind ? e.kind : 'net', code), { kind: 'warn' }); freshen(); return; }
    ui.toast('System', `Joined room ${code}.`, { kind: 'info' });
    freshen();
  }

  // the player's first step after setup: the save is already onboarded, so a reload here does not start over
  function hunterCreated() {
    const h = store.active(), f = facts('player');
    const w = step(`<div class="n-tag">! System</div><h2 id="{id}">Hunter created</h2>
      <p>${esc(createdLine(h.name, h.job))}</p>
      <div data-role="player">${nextHtml(f)}</div>
      <div class="ob-act"><button type="button" class="primary" data-focus data-obsheet>Open my sheet</button><button type="button" data-objoin${mayJoin(f) ? '' : ' hidden'}>Join a room</button></div>`, sheet);
    function sheet() { if (go('sheet').ok) app.go('status'); }
    w.querySelector('[data-obsheet]').addEventListener('click', sheet);
    w.querySelector('[data-objoin]').addEventListener('click', () => { if (go('join').ok) app.go('room'); });
  }

  // the GM's first step after setup, offering the room. With no room server, or an invite to join, there is nothing to
  // offer: it confirms the campaign and Continue ends setup.
  function campaignReady(event) {
    const sy = app.api.sync, offer = sy.conn() !== 'off' && !invited(), f = facts('gm', offer);
    const w = step(`<div class="n-tag">! GM</div><h2 id="{id}">Campaign ready</h2>
      <p>${esc(event === 'starter' ? LOADED.starter : LOADED.blank)}</p>
      ${offer ? `<p>${esc(ROOM_IS)}</p>` : ''}
      <div data-role="gm" data-rooms="${offer ? 'yes' : 'no'}">${nextHtml(f)}</div>
      <div class="ob-act">${offer ? '<button type="button" class="primary" data-focus data-obcreate>Create room</button><button type="button" data-oblater>Later</button>' : '<button type="button" class="primary" data-focus data-oblater>Continue</button>'}</div>
      <p class="ob-err" role="status" data-msg></p>`, later);
    function later() { if (go('later').ok) offerJoin(); }
    w.querySelector('[data-oblater]').addEventListener('click', later);
    const b = w.querySelector('[data-obcreate]');
    if (b) b.addEventListener('click', async () => {
      b.disabled = true; b.setAttribute('aria-busy', 'true');
      try { await sy.create(); }
      catch (e) { b.disabled = false; b.removeAttribute('aria-busy'); w.querySelector('[data-msg]').textContent = why(e && e.kind ? e.kind : 'net'); return; }
      if (go('created').ok) app.go('room');
    });
  }

  function quickstart() {
    if (root) return;
    const role = app.isGM() ? 'gm' : 'player';
    const w = step(`<div class="n-tag">! Quick start</div><h2 id="{id}">How it works</h2>
      <p>${esc(ABOUT)}</p>
      <div data-role="${role}">${nextHtml(facts(role))}</div>
      <div class="ob-h3">Tips</div><ol class="ob-tips">${TIPS[role].map(t => `<li>${esc(t)}</li>`).join('')}</ol>
      <div class="ob-act"><button type="button" class="primary" data-focus data-ok>Got it</button><button type="button" data-skip>Skip</button></div>`, closeQs);
    const back = root._trigger;
    function closeQs() { close(); if (back && back.isConnected && back.focus) back.focus(); }
    w.querySelector('[data-ok]').addEventListener('click', closeQs);
    w.querySelector('[data-skip]').addEventListener('click', closeQs);
  }

  /** Each step's window; `done` takes the window away. */
  const DRAW = { welcome, role, invite, player, gm, hunterCreated, campaignReady, done: () => { at = null; close(); } };
  app.api.onboard = { quickstart };
  app.on('ready', () => {
    if (store.get().settings.onboarded || root) return;
    at = firstStep({ invited: !!invited() && app.api.sync.conn() !== 'off' });
    DRAW[at]();
  });
}
