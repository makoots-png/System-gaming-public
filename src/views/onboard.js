// onboard.js (U15): first-run System-window sequence + the "?" quick-start. Exposes app.api.onboard = { quickstart }.
// Its words (what the site is, what a room is, the next steps, the tips) are src/core/first-run.ts's.
import { CODE_LEN, parseRoomCode } from '../core/ids.ts';
import { tapWords } from '../core/sync/taps.ts';
import { starterStep } from './starter.js';
import { atSettings, both } from '../core/save-step.ts';
import { createShows, joinShows, onboardStep } from '../core/onboarding.ts';
import { ownSeed } from '../core/starter.ts';
import { onboarded } from '../core/settings.ts';
import { READ_ONLY } from '../core/store-life.ts';
import { chooseMode } from '../core/role.ts';
import { ABOUT, LOADED, ROOM_IS, TIPS, WORLD_PRIMER, createdLine, nextSteps, showsPrimer } from '../core/first-run.ts';
import { available } from '../core/hunter/progress.ts';
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
    .ob-opt{text-align:left;margin:0 0 12px}
    .ob-check{display:flex;align-items:center;gap:10px;min-height:44px;padding:8px 12px;box-sizing:border-box;border:1px solid var(--line);background:rgba(10,26,46,.45);color:var(--ice);font-size:14px;line-height:1.35;cursor:pointer}
    .ob-check input{width:20px;height:20px;min-height:20px;margin:0;flex:none;accent-color:var(--cyan)}
    .ob-steps{text-align:left;margin:0 0 12px}
    .ob-steps p{color:var(--ice);font-size:14px;line-height:1.45;margin:0 0 6px}
    .ob-primer{text-align:left;margin:12px 0;border:1px solid var(--line);background:rgba(10,26,46,.45)}
    .ob-primer summary{display:flex;align-items:center;gap:8px;min-height:44px;padding:8px 12px;box-sizing:border-box;cursor:pointer;font-size:14px;font-weight:600;color:var(--gold);list-style:none}
    .ob-primer summary::-webkit-details-marker{display:none}
    .ob-primer summary::before{content:'▸';flex:none;color:var(--cyan)}
    .ob-primer[open] summary::before{content:'▾'}
    .ob-primer-body{padding:4px 12px 12px;border-top:1px solid var(--line)}
    .ob-primer-body p{color:var(--ice);font-size:14px;line-height:1.5;margin:10px 0 0}
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
  let root = null, me = null;
  /** The window leaves as every window does (ui.js `closeWindow`); its leaving copy is no longer an `.ob-overlay`. */
  function close() {
    if (!root) return;
    const el = root; root = null;
    el.classList.replace('ob-overlay', 'ob-gone');
    closeWindow(me); me = null;
  }
  function key(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ESC[at.at](); return; }
    if (e.key === 'Tab') trapTab(e, root);
  }
  // one overlay, content swapped per step; focus goes to [data-focus] or the first button. `about`: a plain line drawn
  // below the window on the backdrop, which the window names as its description.
  function step(html, about = '') {
    const fresh = !root;
    if (fresh) me = openWindow('onboard', () => { root = h('<div class="ob-overlay" role="presentation"></div>'); document.body.appendChild(root); return { root, win: null }; }, key);
    const id = 'ob' + Math.random().toString(36).slice(2, 7);
    root.innerHTML = `<div class="ob-win" role="dialog" aria-modal="true" aria-labelledby="${id}"${about ? ` aria-describedby="${id}a"` : ''}><span class="cb"></span>${html.replace('{id}', id)}</div>${about ? `<p class="ob-about" id="${id}a">${esc(about)}</p>` : ''}`;
    root.classList.toggle('ob-with-about', !!about);
    me.win = root.firstElementChild;
    // each step's window rises as every window does; the backdrop fades in once
    void enter(root.firstElementChild);
    if (fresh) void enter(root, 'fade');
    const f = root.querySelector('[data-focus]') || root.querySelector('button');
    if (f) f.focus();
    return root.firstElementChild;
  }

  // the seed hunter a new install starts with becomes the player's own, neutral (no Wolf Slayer title, no canon items, skills or quest)
  const owned = (name, job = '') => s => ownSeed(s, name || 'Hunter', job);
  /** The window on screen: its step, what the step's tap has under way, the ? guide (src/core/onboarding.ts), moved only by `go`. @type {import('../core/onboarding.ts').OnboardingAt<Element>} */
  let at = { at: 'shut' };
  /**
   * Sends `e` to the window's machine. `write` is what the tap changes; on the transition that leaves setup it is written
   * with the onboarded mark in one `store.apply`, so a reload sees both or neither. A write the save refused is told
   * (ui.js `wrote`) and sent as `refused`: the step stays, and a check under way goes back to how it was before the tap.
   * Answers the write's answer, or `stale` where `e` does not apply (a late answer, a second tap).
   */
  function go(e, write = null) {
    const t = onboardStep(at, e);
    if (!t) return { ok: false, why: 'stale' };
    const change = t.marks ? (write ? both(write, atSettings(onboarded)) : atSettings(onboarded)) : write;
    if (change) {
      const r = store.apply(`onboard-${e.type}`, change);
      if (!ui.wrote('System', r)) { const back = onboardStep(at, { type: 'refused' }); if (back) moved(back, 'refused'); return r; }
    }
    moved(t, e.type);
    return { ok: true };
  }
  /** Takes the transition: a new step draws its window, every state paints its tap's progress, then the effects run. */
  function moved(t, event) {
    const was = at.at;
    at = t.to;
    if (at.at !== was) DRAW[at.at](event);
    paint();
    for (const fx of t.fx) {
      if (fx.type === 'dropInvite') app.api.sync.dropInvite();
      else if (fx.type === 'cancelCreate') app.api.sync.leave();
      else if (fx.back instanceof HTMLElement && fx.back.isConnected) fx.back.focus();
    }
  }
  const busy = (b, on) => { b.disabled = on; if (on) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy'); };
  /** Paints what the step's tap has under way on the window drawn for the step: a check or a create out, a failure. */
  function paint() {
    if (at.at === 'player') busy(root.querySelector('[data-go]'), at.begin === 'checking');
    else if (at.at === 'invite') {
      const v = joinShows(at.join), q = s => root.querySelector(s), b = q('[data-go]'), mo = q('[data-obmore]');
      busy(b, v.busy); b.textContent = v.tried ? 'Try again' : 'Join';
      if (v.busy) q('[data-err]').textContent = '';
      if (v.why) { q('[data-err]').textContent = why(v.why, invited()); q('[data-check]').textContent = ''; }
      if (v.tried && mo.className) { mo.textContent = 'Continue without a room'; mo.className = ''; q('.ob-act').appendChild(mo); }
    } else if (at.at === 'campaignReady') {
      const v = createShows(at.create), b = root.querySelector('[data-obcreate]');
      if (b) busy(b, v.busy);
      root.querySelector('[data-msg]').textContent = v.why ? why(v.why) : '';
    }
  }
  /** What a failed check or join for room `code` says (src/core/sync/taps.ts). */
  const why = (kind, code = '') => tapWords(kind, code) ?? '';
  // an invite link was opened before onboarding finished and the player did not take the join path: offer it now
  const invited = () => app.api.sync.invite();
  const offerJoin = () => { const c = invited(), sy = app.api.sync; if (c && sy.conn() !== 'off' && sy.room() !== c) app.go('room'); };
  // each one's Escape too (ESC below); Skip goes on to the invite's room only once its write is saved
  const skip = () => { if (go({ type: 'skip' }, owned('Hunter')).ok) offerJoin(); };
  const more = () => { go({ type: 'more' }); };
  const sheet = () => { if (go({ type: 'sheet' }).ok) app.go('status'); };
  const later = () => { if (go({ type: 'later' }).ok) offerJoin(); };
  const gotIt = () => { go({ type: 'gotIt' }); };

  /** This phone's facts now for `role`'s next steps (src/core/first-run.ts): read, never stored. `rooms`: false hides the room steps. */
  function facts(role, rooms = app.api.sync.conn() !== 'off') {
    const sy = app.api.sync, d = sy.detail();
    if (role === 'gm') return { role, rooms, room: d.conn === 'creating' ? null : sy.room(), players: sy.remoteSheets().length };
    const h = store.active(), R = app.rules();
    return { role, rooms, points: available(h, R), room: d.joining ? null : sy.room(), joining: d.joining };
  }
  /** The next steps as list items: a done step says so in words for a screen reader and with a mark for the eye. */
  const stepsHtml = f => nextSteps(f, app.rules()).map(s => `<li data-k="${s.key}"${s.done ? ' data-done' : ''}><span class="ob-mark" aria-hidden="true">${s.done ? '✓' : '○'}</span><span>${s.done ? '<span class="sr-only">Done: </span>' : ''}${esc(s.words)}</span></li>`).join('');
  const nextHtml = f => { const li = stepsHtml(f); return li ? `<div class="ob-h3">Next steps</div><ol class="ob-tips ob-next" data-obnext>${li}</ol>` : ''; };
  /** Whether Hunter created still offers Join a room: the join step is listed, not done and not under way. */
  const mayJoin = f => f.rooms && f.room === null && f.joining === null;
  // the open window's next steps and primer drawer follow the room as it changes
  function freshen() {
    const list = root && root.querySelector('[data-obnext]');
    if (list) {
      const f = facts(list.closest('[data-role]').dataset.role, list.closest('[data-rooms]') ? list.closest('[data-rooms]').dataset.rooms === 'yes' : undefined);
      const li = stepsHtml(f); if (list.innerHTML !== li) list.innerHTML = li;
      const j = root.querySelector('[data-objoin]'); if (j) j.hidden = !mayJoin(f);
    }
    syncPrimer();
  }
  app.on('sync:room', freshen);
  app.on('sync:status', freshen);
  app.on('sync:docs', freshen);
  app.on('change', freshen);

  /** Collapsible 3-minute San Francisco primer read aloud before Session 1 (src/core/first-run.ts `WORLD_PRIMER`). */
  const primerHtml = () => `<details class="ob-primer" data-primer><summary>Read aloud: San Francisco primer</summary><div class="ob-primer-body">${WORLD_PRIMER.map(p => `<p>${esc(p)}</p>`).join('')}</div></details>`;
  /** Shows or hides the primer drawer inside an open ? Quick Start window based on seat and room rules. */
  function syncPrimer() {
    const slot = root && root.querySelector('[data-primer-slot]');
    if (!slot) return;
    const show = showsPrimer(app.seat(), app.api.sync.doc('rules'));
    slot.hidden = !show;
    const has = !!slot.querySelector('[data-primer]');
    if (show && !has) slot.innerHTML = primerHtml();
    else if (!show && has) slot.innerHTML = '';
  }

  function welcome() {
    const w = step(`<div class="n-tag">! System</div><h2 id="{id}">Window active</h2>
      <p>Every person has had a System window since Day Zero. Choose whether you are a player or the GM for this table.</p>
      <div class="ob-act"><button type="button" class="primary" data-focus data-yes>Set up</button><button type="button" data-skip>Skip setup</button></div>`, ABOUT);
    w.querySelector('[data-yes]').addEventListener('click', () => go({ type: 'accept' }));
    w.querySelector('[data-skip]').addEventListener('click', skip);
  }

  function role() {
    const w = step(`<div class="n-tag">! System</div><h2 id="{id}">Who are you?</h2>
      <p>Choose how you will use the System on this device.</p>${invited() && app.api.sync.conn() !== 'off' ? `<p class="ob-invite">You were invited to room <b>${esc(invited())}</b>. Choose <b>I'm a Player</b> to join it.</p>` : ''}
      <div class="ob-act"><button type="button" class="primary" data-focus data-player>I'm a Player</button><button type="button" data-gm>I'm the GM</button></div>
      <button type="button" class="ob-skip" data-skip>Skip</button>`);
    w.querySelector('[data-player]').addEventListener('click', () => go({ type: 'player' }));
    w.querySelector('[data-gm]').addEventListener('click', () => go({ type: 'gm' }));
    w.querySelector('[data-skip]').addEventListener('click', skip);
  }

  // opened from an invite link on a new device: one field, nothing saved until the room is known to exist
  function invite() {
    const code = invited(), sy = app.api.sync;
    const w = step(`<div class="n-tag">! Invitation</div><h2 id="{id}">Join a room</h2>
      <p>[SYSTEM] You were invited to a room.</p>
      <div class="ob-chip" data-roomchip aria-label="Room code ${esc(code)}"><span>${esc(code.slice(0, 3))}</span><span>${esc(code.slice(3))}</span></div>
      <p class="ob-chk" role="status" data-check>Checking the room...</p>
      <div class="ob-form"><label class="field"><span class="lbl">Hunter name</span><input type="text" data-name data-focus maxlength="60" autocomplete="off" enterkeyhint="go" placeholder="Your hunter's name"></label>
        <div class="ob-err" role="alert" data-err></div></div>
      <div class="ob-act"><button type="button" class="primary" data-go>Join</button></div>
      <button type="button" class="ob-skip" data-obmore>Other options</button>`);
    const q = s => w.querySelector(s), err = q('[data-err]'), nm = q('[data-name]');
    sy.check(code).then(r => { if (!w.isConnected) return; q('[data-check]').textContent = !r.ok ? why('net') : r.exists ? 'Room found.' : why('notfound', code); });
    // a check that answers after other options, or a second tap while one is out, is stale (onboarding.ts)
    const run = async () => {
      const name = nm.value.trim();
      if (!name) { err.textContent = 'Enter a name for your hunter.'; nm.focus(); return; }
      if (!go({ type: 'try' }).ok) return;
      const r = await sy.check(code);
      if (!r.ok) { go({ type: 'missed', why: 'net' }); return; }
      if (!r.exists) { go({ type: 'missed', why: 'notfound' }); return; }
      if (go({ type: 'joined' }, owned(name)).ok) await joinBehind(code);
    };
    q('[data-go]').addEventListener('click', run);
    nm.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    q('[data-obmore]').addEventListener('click', more);
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
      <button type="button" class="ob-skip" data-skip>Skip</button>`);
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
      const code = room ? (sy.parseInvite(room.value) || codeIn()) : '';
      if (code && parseRoomCode(code) === null) { err.textContent = `Room codes are ${CODE_LEN} characters.`; room.focus(); return; }
      err.textContent = '';
      // a check that answers after Back or Skip, or a second Begin while one is out, is stale (onboarding.ts)
      if (code) {
        if (!go({ type: 'try' }).ok) return;
        const r = await sy.check(code);
        if (!r.ok || !r.exists) {
          if (go({ type: 'missed', why: r.ok ? 'notfound' : 'net' }).ok) { err.textContent = `${r.ok ? why('notfound', code) : why('net')} Or clear the room code to begin without a room.`; room.focus(); }
          return;
        }
      }
      if (!go({ type: 'begun' }, owned(name, q('[data-job]').value)).ok) return;
      if (code) await joinBehind(code);
    };
    q('[data-go]').addEventListener('click', begin);
    q('[data-name]').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); begin(); } });
    q('[data-back]').addEventListener('click', () => go({ type: 'back' }));
    q('[data-skip]').addEventListener('click', skip);
  }

  function gm() {
    const w = step(`<div class="n-tag">! GM</div><h2 id="{id}">Run the game</h2>
      <p>GM mode unlocks XP grants, free stat edits, and GM tools on this device. How do you want to start?</p>
      <div class="ob-opt">
        <label class="ob-check"><input type="checkbox" data-pregens checked aria-describedby="ob-pregens-help"><span>Include 4 sample hunters</span></label>
        <small class="ob-help" id="ob-pregens-help">Uncheck if players will make hunters on their phones.</small>
      </div>
      <div class="ob-act"><button type="button" class="primary" data-focus data-starter>Load starter campaign</button><button type="button" data-blank>Start blank</button></div>
      <p class="ob-err" data-msg></p>
      <div class="ob-act"><button type="button" data-back>Back</button></div>
      <button type="button" class="ob-skip" data-skip>Skip</button>`);
    const q = s => w.querySelector(s);
    q('[data-starter]').addEventListener('click', () => {
      // a read-only tab's refusal is told by go; any other is the starter pack's own
      const includePregens = !!q('[data-pregens]').checked;
      const g = go({ type: 'starter' }, starterStep(app, { includePregens }));
      if ('why' in g && g.why !== READ_ONLY) q('[data-msg]').textContent = 'Could not load the starter campaign. Choose Start blank instead.';
    });
    q('[data-blank]').addEventListener('click', () => { go({ type: 'blank' }, both(owned('Hunter'), atSettings(st => chooseMode(st, 'gm')))); });
    q('[data-back]').addEventListener('click', () => go({ type: 'back' }));
    q('[data-skip]').addEventListener('click', skip);
  }

  // a join typed or invited during setup runs behind Hunter created: its list says Joining, then In room; a failed join
  // is a toast, and the join step stays not done with Join a room offered again. Nothing navigates under the window.
  async function joinBehind(code) {
    const sy = app.api.sync, joining = sy.joinRoom(code, { hunterId: store.active().id });
    freshen();
    try { await joining; } // rejects only with a tap's kind (src/edge/sync.ts)
    catch (e) { ui.toast('System', why(e && e.kind ? e.kind : 'net', code), { kind: 'warning' }); freshen(); return; }
    ui.toast('System', `Joined room ${code}.`, { kind: 'info' });
    freshen();
  }

  // the player's first step after setup: the save is already onboarded, so a reload here does not start over
  function hunterCreated() {
    const h = store.active(), f = facts('player');
    const w = step(`<div class="n-tag">! System</div><h2 id="{id}">Hunter created</h2>
      <p>${esc(createdLine(h.name, h.job))}</p>
      <div data-role="player">${nextHtml(f)}</div>
      <div class="ob-act"><button type="button" class="primary" data-focus data-obsheet>Open my sheet</button><button type="button" data-objoin${mayJoin(f) ? '' : ' hidden'}>Join a room</button></div>`);
    w.querySelector('[data-obsheet]').addEventListener('click', sheet);
    w.querySelector('[data-objoin]').addEventListener('click', () => { if (go({ type: 'join' }).ok) app.go('room'); });
  }

  // the GM's first step after setup, offering the room. With no room server, or an invite to join, there is nothing to
  // offer: it confirms the campaign and Continue ends setup.
  function campaignReady(event) {
    const sy = app.api.sync, offer = sy.conn() !== 'off' && !invited(), f = facts('gm', offer);
    const loaded = (event === 'starter' ? LOADED.starter : LOADED.blank).split('\n');
    const loadedHtml = loaded.length > 1
      ? `<p>${esc(loaded[0])}</p><div class="ob-steps">${loaded.slice(1).map(l => `<p>${esc(l)}</p>`).join('')}</div>`
      : `<p>${esc(loaded[0])}</p>`;
    const w = step(`<div class="n-tag">! GM</div><h2 id="{id}">Campaign ready</h2>
      ${loadedHtml}
      ${primerHtml()}
      ${offer ? `<p>${esc(ROOM_IS)}</p>` : ''}
      <div data-role="gm" data-rooms="${offer ? 'yes' : 'no'}">${nextHtml(f)}</div>
      <div class="ob-act">${offer ? '<button type="button" class="primary" data-focus data-obcreate>Create room</button><button type="button" data-oblater>Later</button>' : '<button type="button" class="primary" data-focus data-oblater>Continue</button>'}</div>
      <p class="ob-err" role="status" data-msg></p>`);
    w.querySelector('[data-oblater]').addEventListener('click', later);
    // Later or Escape while the create is out cancels it, and its late answer is stale (onboarding.ts)
    const b = w.querySelector('[data-obcreate]');
    if (b) b.addEventListener('click', async () => {
      if (!go({ type: 'create' }).ok) return;
      try { await sy.create(); }
      catch (e) { go({ type: 'createFailed', why: e && e.kind ? e.kind : 'net' }); return; }
      if (go({ type: 'created' }).ok) app.go('room');
    });
  }

  // the ? guide: it opens over no other window, and gives the focus back to what had it (onboarding.ts `quickstart`)
  function quickstart() {
    const role = app.isGM() ? 'gm' : 'player';
    const w = step(`<div class="n-tag">! Quick start</div><h2 id="{id}">How it works</h2>
      <p>${esc(ABOUT)}</p>
      <div data-role="${role}">${nextHtml(facts(role))}</div>
      <div class="ob-h3">Tips</div><ol class="ob-tips">${TIPS[role].map(t => `<li>${esc(t)}</li>`).join('')}</ol>
      <div data-primer-slot></div>
      <div class="ob-act"><button type="button" class="primary" data-focus data-ok>Close</button></div>`);
    syncPrimer();
    w.querySelector('[data-ok]').addEventListener('click', gotIt);
  }

  /** Each state's window; `shut` takes the window away. */
  const DRAW = { shut: close, quickstart, welcome, role, invite, player, gm, hunterCreated, campaignReady };
  /** What Escape does on each window: a setup step's Skip, the invite's other options, the confirmation's first way out, the guide's Got it. */
  const ESC = { shut: () => {}, quickstart: gotIt, welcome: skip, role: skip, invite: more, player: skip, gm: skip, hunterCreated: sheet, campaignReady: later };
  app.api.onboard = { quickstart: () => { go({ type: 'help', back: document.activeElement }); } };
  app.on('ready', () => {
    if (!store.get().settings.onboarded && !store.readOnly) go({ type: 'start', invited: !!invited() && app.api.sync.conn() !== 'off' });
  });
}
