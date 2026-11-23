// coin.js: the coin call (src/core/coin.ts, docs/agent-handoff/later-phases/coin-notes.md). The one writer of the save's
// `coins` (the coins this phone's hunters called) and `calls` (on the GM's phone, the calls players sent).
// A player's phone: a check's natural 1 or 20 asks "Heads or tails?" in the coin card; the pick goes to the GM as
// `coinCall` and the coin stays in the air until the GM's `coinLand` arrives; it carries no side, so the card says only
// that the coin was flipped and the GM says the outcome at the table. Alone, or on the GM's own phone, a true flip from
// src/edge/roll.ts lands it at once and the card shows the side.
// The GM's phone: each call is asked in a System window, oldest first, until the GM rules Right, Wrong or Let the coin
// decide; the session log and a toast here say the side and what it means, and the message sent holds only the roll
// (`landingOf`). A window closed
// with no ruling (Later, Escape, a tap beside it) puts the call off: the coin card offers it with Rule, and nothing asks
// it again until that tap (src/core/coin.ts `CoinPrompt`).
// A send the room did not take is sent again after the next poll; a new page sends again each call still in the air,
// since it cannot know whether the last page's send arrived. Publishes app.api.coin.
import { flip } from '../edge/roll.ts';
import { notifyHidden } from '../edge/notify.ts';
import * as motion from './motion.ts';
import {
  COIN_PROMPT_IDLE, SIDE_WORDS, callRuled, callTaken, coinCalled, coinOf, coinPromptPutOff, coinPromptStep, coinRolled, coinRuled, coinWords, decider,
  isCoinRoll, isSettled, landing, landingOf, newRollId, rollId, verdict,
} from '../core/coin.ts';

const CSS = `
.coin-card{position:fixed;left:0;right:0;margin:0 auto;bottom:calc(84px + var(--sab));z-index:46;width:min(380px,calc(100vw - 28px));max-height:calc(100dvh - 120px);overflow:auto;overscroll-behavior:contain;
  background:var(--panel-solid);border:1px solid var(--line-bright);box-shadow:0 0 26px rgba(20,100,160,.55);padding:12px 14px}
.coin-card[hidden]{display:none}
.coin-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
.coin-list>li+li{border-top:1px solid var(--line);padding-top:12px}
.coin-row{text-align:center}
.coin-row h2{margin:2px 0 4px;font-size:20px;letter-spacing:.08em;color:var(--ice)}
.coin-what{margin:0;font-size:13px;color:var(--cyan-dim)}
.coin-pick{display:flex;gap:10px;margin-top:10px}
.coin-pick button{flex:1 1 0;min-height:calc(var(--control-h) * 1.6);font-size:20px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
.coin-air{perspective:400px;height:96px;display:flex;align-items:flex-end;justify-content:center}
.coin{position:relative;width:64px;height:64px;transform-style:preserve-3d}
.coin[data-side=tails]{transform:rotateY(180deg)}
.coin>span{position:absolute;inset:0;border-radius:50%;display:flex;align-items:center;justify-content:center;backface-visibility:hidden;-webkit-backface-visibility:hidden;
  border:3px solid var(--gold);background:var(--panel-solid);color:var(--gold);font-weight:700;font-size:13px;letter-spacing:.1em;text-transform:uppercase}
.coin>.coin-t{transform:rotateY(180deg)}
.coin-words{margin:6px 0 0;font-size:18px;font-weight:700;letter-spacing:.06em;color:var(--ice)}
.coin-words.v-critSuccess{color:var(--gold)}.coin-words.v-success,.coin-words.v-saved{color:var(--green)}.coin-words.v-critFailure{color:var(--red)}
.coin-row .coin-close{margin-top:8px}
.coin-later{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.coin-list:not(:empty)+.coin-later:not(:empty){border-top:1px solid var(--line);margin-top:12px;padding-top:12px}
.coin-later li{display:flex;align-items:center;gap:10px}
.coin-later p{flex:1 1 auto;min-width:0;margin:0;font-size:13px;color:var(--cyan-dim)}
.coin-later b{display:block;font-size:15px;color:var(--ice)}
.coin-later button{flex:0 0 auto;min-height:44px;min-width:72px}
@media (max-width:720px){.coin-card{bottom:calc(var(--nav-h) + var(--sab) + 8px)}}
[data-coin-slot]:empty{display:none}
[data-coin-slot] .coin-card{position:static;width:min(380px,100%);max-height:none;margin:10px auto 0;box-shadow:none}`;

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc } = ui;
  ui.css('coin', CSS);

  const sync = () => app.api.sync;
  const deviceId = () => store.get().settings.deviceId;
  /** A hunter a fight holds (core/combat/fight-save.ts `fightHold`, through the hunter api): such a hunter's roll is the true roll. */
  const inFight = hid => app.api.hunter.fightOf({ hid }) !== null;
  /** When a coin step writes its session log line, and how many lines the log keeps. */
  const stamp = () => ({ at: new Date().toISOString(), cap: app.rules().logCap });

  // ── what goes to the room: the outbox keeps it until the room takes it (src/core/sync/outbox.ts), one message per roll ──
  /** The sheet key of the hunter that called `c`, as the coin holds it. The server checks only the device. */
  const byOf = c => (c.hunter.kind === 'local' ? sync().myKey(c.hunter.hunterId) : c.hunter.remote);
  /** Only a player's phone in a room calls (`decider`), so the room is there. */
  function sendCall(c) {
    const S = sync();
    S.post(S.event('coinCall', { by: byOf(c), roll: c.id, who: c.who, what: c.what, face: c.face, call: c.call }), { key: `coin ${c.id}` });
  }
  function sendLanding(body) {
    const S = sync();
    if (!S || !S.post(S.event('coinLand', body), { key: `coin ${body.roll}` }).ok) ui.toast('Sync', 'Not in a room: the coin was not sent.', { kind: 'warn' });
  }

  // ── a player's coins ──
  /**
   * Coins that landed or were ruled while this page was open and are not closed yet: the card shows them until Close.
   * @type {Set<string>}
   */
  const fresh = new Set();
  /** @type {import('../core/api.ts').CoinApi} */
  app.api.coin = {
    rolled(o) {
      const h = store.hunter(o.hid);
      if (!h || !isCoinRoll({ kind: o.kind, expr: o.expr, natural: o.natural, inFight: inFight(h.id) })) return false;
      const id = newRollId(deviceId(), o.roll); if (!id) return false;
      const face = o.natural === 1 ? 1 : 20;
      return ui.wrote('! Coin', store.apply('coin', s => coinRolled(s, { id, hunter: { kind: 'local', hunterId: h.id }, who: h.name.slice(0, 60), what: (o.label || o.expr).slice(0, 60), face, at: 'uncalled' })));
    },
    ruled(roll) {
      const c = coinOf(store.get().coins, roll); if (!c || c.at !== 'called') return;
      // before the update: the card draws on its `change`
      fresh.add(roll);
      if (!ui.wrote('! Coin', store.apply('coin', s => coinRuled(s, roll, stamp())))) fresh.delete(roll);
    },
    of: roll => { const id = newRollId(deviceId(), roll); return id ? coinOf(store.get().coins, id) : null; },
  };

  /** The player picks a side: the GM is told, or alone a true flip lands the coin in the same update. */
  function call(id, side) {
    const c = coinOf(store.get().coins, id); if (!c || c.at !== 'uncalled') return;
    const who = decider(app.seat()), landOn = who === 'flip' ? flip() : null;
    if (landOn) fresh.add(id);
    if (!ui.wrote('! Coin', store.apply('coin', s => coinCalled(s, id, side, landOn, stamp())))) { fresh.delete(id); return; }
    if (landOn) return;
    const now = coinOf(store.get().coins, id); if (now && now.at === 'called') sendCall(now);
  }

  // ── the coin card (a player's phone, and any phone whose hunter rolled) ──
  const card = ui.h(`<section class="coin-card" data-coin-card aria-label="Coin call" hidden><ul class="coin-list" role="status" aria-live="polite"></ul>
    <ul class="coin-later" aria-label="Coin calls put off"></ul></section>`);
  document.body.appendChild(card);
  /** The open dice tray's slot when the quick roll sheet or Dice view is on screen, else null (the card floats fixed on body). */
  function slot() {
    const diceSheet = document.getElementById('dice-sheet');
    if (diceSheet && !diceSheet.hidden && !diceSheet.inert) return diceSheet.querySelector('[data-coin-slot]');
    const view = document.getElementById('view-dice');
    if (view && !view.hidden) return view.querySelector('[data-coin-slot]');
    return null;
  }
  /** Moves the card into the active dice tray's flow, or back to body when no tray is open; keeps a spinning coin turning. */
  function place() {
    const host = slot() || document.body;
    if (card.parentNode === host) return false;
    host.appendChild(card);
    for (const face of list.querySelectorAll('[data-at="called"] [data-coin-face]')) void motion.spin(face);
    return true;
  }
  /** When docked in a dice tray, brings the card into view on the next frame (after the tray's own redraw). */
  function reveal() {
    if (card.hidden || card.parentNode === document.body) return;
    requestAnimationFrame(() => { if (!card.hidden && card.parentNode !== document.body) card.scrollIntoView({ block: 'nearest' }); });
  }
  const list = card.querySelector('.coin-list'), laterList = card.querySelector('.coin-later');
  const shownCoins = () => store.get().coins.filter(c => !isSettled(c) || fresh.has(c.id));
  const coinFace = side => `<div class="coin-air"><div class="coin" data-coin-face${side ? ` data-side="${side}"` : ''}><span class="coin-h">${esc(SIDE_WORDS.heads)}</span><span class="coin-t">${esc(SIDE_WORDS.tails)}</span></div></div>`;
  function rowHtml(c) {
    const what = `<p class="coin-what">${esc(c.who)} · Natural ${c.face} · ${esc(c.what)}</p>`;
    if (c.at === 'uncalled') return `<div class="coin-row"><h2>${esc(coinWords(c))}</h2>${what}
      <div class="coin-pick"><button type="button" data-call="heads">${esc(SIDE_WORDS.heads)}</button><button type="button" data-call="tails">${esc(SIDE_WORDS.tails)}</button></div></div>`;
    if (c.at === 'called') return `<div class="coin-row">${coinFace(null)}<h2>You called ${esc(SIDE_WORDS[c.call])}</h2>${what}<p class="coin-words" data-words>${esc(coinWords(c))}</p></div>`;
    // no coin face: a face at rest shows a side
    if (c.at === 'ruled') return `<div class="coin-row"><h2>You called ${esc(SIDE_WORDS[c.call])}</h2>${what}<p class="coin-words" data-words>${esc(coinWords(c))}</p>
      <p class="coin-what">The GM tells you how it landed.</p><button type="button" class="quiet coin-close" data-close>Close</button></div>`;
    return `<div class="coin-row">${coinFace(c.side)}<h2>${esc(SIDE_WORDS[c.side])}</h2>${what}
      <p class="coin-words v-${verdict(c.face, c.call, c.side)}" data-words>${esc(coinWords(c))}</p>
      <button type="button" class="quiet coin-close" data-close>Close</button></div>`;
  }
  /** The GM's calls put off and still to rule, as the card offers them. */
  const putOffCalls = () => coinPromptPutOff(prompt).map(id => coinOf(store.get().calls, id)).filter(c => c && c.at === 'called');
  function drawLater(calls) {
    const html = calls.map(c => `<li data-put-off="${esc(c.id)}"><p><b>${esc(c.who || 'A hunter')} called ${esc(SIDE_WORDS[c.call])}</b>Natural ${c.face} · ${esc(c.what || 'a check')}</p>
      <button type="button" class="primary" data-rule>Rule</button></li>`).join('');
    if (laterList.innerHTML !== html) laterList.innerHTML = html;
  }
  function draw() {
    const coins = shownCoins(), later = putOffCalls(), wasHidden = card.hidden;
    const moved = place();
    card.hidden = !coins.length && !later.length;
    const laterBefore = laterList.innerHTML;
    drawLater(later);
    const laterChanged = laterList.innerHTML !== laterBefore;
    /** @type {Set<string>} */
    const keep = new Set(coins.map(c => c.id));
    const gone = [...list.children].filter(li => !keep.has(li.dataset.coin));
    for (const li of gone) li.remove();
    const rewritten = coins.filter((c, i) => {
      let li = [...list.children].find(x => x.dataset.coin === c.id);
      if (li && li.dataset.at === c.at) return false;
      const was = li ? li.dataset.at : null;
      if (!li) { li = ui.h('<li></li>'); li.dataset.coin = c.id; }
      if (list.children[i] !== li) list.insertBefore(li, list.children[i] || null);
      li.dataset.at = c.at; li.innerHTML = rowHtml(c);
      const face = li.querySelector('[data-coin-face]');
      if (c.at === 'called') void motion.spin(face);
      else if (c.at === 'landed' && was !== 'landed') void motion.landOn(face, c.side);
      if (!was) void motion.enter(li);
      return true;
    }).length;
    if (!card.hidden && (wasHidden || moved || laterChanged || gone.length || rewritten)) reveal();
  }
  list.addEventListener('click', e => {
    const b = e.target.closest('button'), li = b && b.closest('[data-coin]'); if (!li) return;
    const id = rollId(li.dataset.coin); if (!id) return;
    if (b.dataset.call === 'heads' || b.dataset.call === 'tails') call(id, b.dataset.call);
    else if (b.hasAttribute('data-close')) { fresh.delete(id); draw(); }
  });
  laterList.addEventListener('click', e => {
    const li = e.target.closest('[data-rule]') && e.target.closest('[data-put-off]'); if (!li) return;
    const id = rollId(li.dataset.putOff); if (id) prompted({ type: 'reopen', id });
  });
  app.on('change', draw);
  app.on('view', () => { if (place()) reveal(); });
  const diceSheet = document.getElementById('dice-sheet');
  if (diceSheet) new MutationObserver(() => { if (place()) reveal(); }).observe(diceSheet, { attributes: true, attributeFilter: ['hidden', 'inert'] });

  // ── the GM's phone: the calls, one System window at a time, oldest first ──
  /** The GM's window for the calls: the call it asks and the calls put off (src/core/coin.ts `CoinPrompt`), moved only by `prompted`. */
  let prompt = COIN_PROMPT_IDLE;
  /** The prompt after `e`: a window opens when it starts asking, and the card draws the calls put off. */
  function prompted(e) {
    const was = prompt;
    prompt = coinPromptStep(prompt, e);
    if (prompt === was) return;
    if (prompt.at === 'asking' && was.at !== 'asking') ask(prompt.id);
    draw();
  }
  /** The save changed: the calls still to rule on the GM's phone, none on any other. */
  const seen = () => prompted({ type: 'seen', open: app.isGM() ? store.get().calls.filter(c => c.at === 'called').map(c => c.id) : [] });
  /**
   * The window of call `id`. `seen` picks it from the calls in the air and the card offers only those, so it is one; were
   * it not, the prompt puts it off and the next `seen` lets it go, so no window is waited for that never opened.
   */
  function ask(id) {
    const c = coinOf(store.get().calls, id);
    if (!c || c.at !== 'called') { prompted({ type: 'putOff' }); seen(); return; }
    ui.system({ tag: '! Coin call', title: `${c.who || 'A hunter'} called ${SIDE_WORDS[c.call]}`, kind: 'info',
      body: 'Was the call right? The player\'s phone shows only that the coin was flipped. Tell them how it landed.',
      lines: [`Rolled for: ${c.what || 'a check'}`, `Natural ${c.face}`, `Called: ${SIDE_WORDS[c.call]}`],
      actions: [{ label: 'Right', value: 'right' }, { label: 'Wrong', value: 'wrong' }, { label: 'Let the coin decide', value: 'coin' }, { label: 'Later', value: null, cancel: true }] })
      .then(v => {
        const ruled = (v === 'right' || v === 'wrong' || v === 'coin') && rule(id, v);
        prompted({ type: ruled ? 'ruled' : 'putOff' });
        seen();
      });
  }
  /**
   * The GM's answer: the landing and the session log's ruling in one update, a toast of the side and what it means for
   * the GM to say, then the message (only the roll) is sent. Answers whether it was written: a refused ruling sends
   * nothing, and its call is put off.
   */
  function rule(id, ruling) {
    const c = coinOf(store.get().calls, id); if (!c || c.at !== 'called') return false;
    const side = landing(c.call, ruling, flip());
    if (!ui.wrote('! Coin call', store.apply('coin-rule', s => callRuled(s, id, ruling, side, stamp())))) return false;
    const now = coinOf(store.get().calls, id);
    if (now && now.at === 'landed') ui.toast('! Coin call', `${now.who || 'A hunter'} called ${SIDE_WORDS[now.call]}. It landed ${SIDE_WORDS[now.side]}: ${coinWords(now)}.`, { kind: 'info' });
    sendLanding(landingOf(c));
    return true;
  }
  app.on('sync:event', ({ event: ev }) => {
    if (!app.isGM() || ev.type !== 'coinCall') return;
    const p = ev.payload, held = coinOf(store.get().calls, p.roll);
    // a call already answered: its message may have been lost, so it goes again
    if (held && held.at === 'landed') { sendLanding(landingOf(held)); return; }
    if (held) return;
    // a call this tab cannot keep is not asked or notified: a read-only tab's banner says why
    if (!store.apply('coin-call', s => callTaken(s, { id: p.roll, hunter: { kind: 'remote', remote: p.by }, who: p.who, what: p.what, face: p.face, call: p.call })).ok) return;
    void notifyHidden(`${p.who || 'A hunter'} called ${SIDE_WORDS[p.call]}`, `Natural ${p.face} for ${p.what}.`, p.eid);
  });
  app.on('change', seen);
  seen();
  draw();
}
