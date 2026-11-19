// coin.js: the coin call (src/core/coin.ts, docs/agent-handoff/later-phases/coin-notes.md). The one writer of the save's
// `coins` (the coins this phone's hunters called) and `calls` (on the GM's phone, the calls players sent).
// A player's phone: a check's natural 1 or 20 asks "Heads or tails?" in the coin card; the pick goes to the GM as
// `coinCall` and the coin stays in the air until the GM's `coinLand` arrives. Alone, or on the GM's own phone, a true flip
// from src/edge/roll.ts lands it at once.
// The GM's phone: each call waits in a System window, oldest first, until the GM rules Right, Wrong or Let the coin
// decide; the session log here records the ruling, and the landing carries only the side (`landingOf`).
// A send the room did not take is sent again after the next poll; a new page sends again each call still in the air,
// since it cannot know whether the last page's send arrived. Publishes app.api.coin.
import { flip } from '../edge/roll.ts';
import { notifyHidden } from '../edge/notify.ts';
import * as motion from './motion.ts';
import {
  SIDE_WORDS, callRuled, callTaken, coinCalled, coinLanded, coinOf, coinRolled, coinWords, decider, inAir, isCoinRoll, landingOf, newRollId, rollId, verdict,
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
@media (max-width:720px){.coin-card{bottom:calc(var(--nav-h) + var(--sab) + 8px)}}`;

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
   * Coins that landed while this page was open and are not closed yet: the card shows them with what they mean.
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
    landed(roll, side) {
      const c = coinOf(store.get().coins, roll); if (!c || c.at !== 'called') return;
      // before the update: the card draws on its `change`
      fresh.add(roll);
      if (!ui.wrote('! Coin', store.apply('coin', s => coinLanded(s, roll, side, stamp())))) fresh.delete(roll);
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
  const card = ui.h('<section class="coin-card" data-coin-card aria-label="Coin call" hidden><ul class="coin-list" role="status" aria-live="polite"></ul></section>');
  document.body.appendChild(card);
  const list = card.querySelector('ul');
  const shownCoins = () => store.get().coins.filter(c => c.at !== 'landed' || fresh.has(c.id));
  const coinFace = side => `<div class="coin-air"><div class="coin" data-coin-face${side ? ` data-side="${side}"` : ''}><span class="coin-h">${esc(SIDE_WORDS.heads)}</span><span class="coin-t">${esc(SIDE_WORDS.tails)}</span></div></div>`;
  function rowHtml(c) {
    const what = `<p class="coin-what">${esc(c.who)} · Natural ${c.face} · ${esc(c.what)}</p>`;
    if (c.at === 'uncalled') return `<div class="coin-row"><h2>${esc(coinWords(c))}</h2>${what}
      <div class="coin-pick"><button type="button" data-call="heads">${esc(SIDE_WORDS.heads)}</button><button type="button" data-call="tails">${esc(SIDE_WORDS.tails)}</button></div></div>`;
    if (c.at === 'called') return `<div class="coin-row">${coinFace(null)}<h2>You called ${esc(SIDE_WORDS[c.call])}</h2>${what}<p class="coin-words" data-words>${esc(coinWords(c))}</p></div>`;
    return `<div class="coin-row">${coinFace(c.side)}<h2>${esc(SIDE_WORDS[c.side])}</h2>${what}
      <p class="coin-words v-${verdict(c.face, c.call, c.side)}" data-words>${esc(coinWords(c))}</p>
      <button type="button" class="quiet coin-close" data-close>Close</button></div>`;
  }
  function draw() {
    const coins = shownCoins();
    card.hidden = !coins.length;
    /** @type {Set<string>} */
    const keep = new Set(coins.map(c => c.id));
    for (const li of [...list.children]) if (!keep.has(li.dataset.coin)) li.remove();
    coins.forEach((c, i) => {
      let li = [...list.children].find(x => x.dataset.coin === c.id);
      if (li && li.dataset.at === c.at) return;
      const was = li ? li.dataset.at : null;
      if (!li) { li = ui.h('<li></li>'); li.dataset.coin = c.id; }
      if (list.children[i] !== li) list.insertBefore(li, list.children[i] || null);
      li.dataset.at = c.at; li.innerHTML = rowHtml(c);
      const face = li.querySelector('[data-coin-face]');
      if (c.at === 'called') void motion.spin(face);
      else if (c.at === 'landed' && was !== 'landed') void motion.landOn(face, c.side);
      if (!was) void motion.enter(li);
    });
  }
  list.addEventListener('click', e => {
    const b = e.target.closest('button'), li = b && b.closest('[data-coin]'); if (!li) return;
    const id = rollId(li.dataset.coin); if (!id) return;
    if (b.dataset.call === 'heads' || b.dataset.call === 'tails') call(id, b.dataset.call);
    else if (b.hasAttribute('data-close')) { fresh.delete(id); draw(); }
  });
  app.on('change', draw);
  draw();

  // ── the GM's phone: the calls, one System window at a time, oldest first ──
  /** The roll whose window is open or queued; null when none. A window closed without an answer opens again. */
  let asking = null;
  function askNext() {
    if (asking || !app.isGM()) return;
    const c = inAir(store.get().calls).find(x => x.at === 'called'); if (!c) return;
    asking = c.id;
    ui.system({ tag: '! Coin call', title: `${c.who || 'A hunter'} called ${SIDE_WORDS[c.call]}`, kind: 'info',
      body: 'Was the call right? The player sees only where the coin lands.',
      lines: [`Rolled for: ${c.what || 'a check'}`, `Natural ${c.face}`, `Called: ${SIDE_WORDS[c.call]}`],
      actions: [{ label: 'Right', value: 'right' }, { label: 'Wrong', value: 'wrong' }, { label: 'Let the coin decide', value: 'coin' }] })
      .then(v => { asking = null; if ((v === 'right' || v === 'wrong' || v === 'coin') && !rule(c.id, v)) return; askNext(); });
  }
  /**
   * The GM's answer: the landing and the session log's ruling in one update, then the landing (only the side) is sent.
   * Answers whether it was written: a refused ruling sends nothing, and its call is asked again only after the save changes.
   */
  function rule(id, ruling) {
    const c = coinOf(store.get().calls, id); if (!c || c.at !== 'called') return false;
    const body = landingOf(c, ruling, flip());
    if (!ui.wrote('! Coin call', store.apply('coin-rule', s => callRuled(s, id, ruling, body.side, stamp())))) return false;
    sendLanding(body);
    return true;
  }
  app.on('sync:event', ({ event: ev }) => {
    if (!app.isGM() || ev.type !== 'coinCall') return;
    const p = ev.payload, held = coinOf(store.get().calls, p.roll);
    // a call already answered: its landing may have been lost, so the same side goes again
    if (held && held.at === 'landed') { sendLanding({ roll: held.id, side: held.side }); return; }
    if (held) return;
    // a call this tab cannot keep is not asked or notified: a read-only tab's banner says why
    if (!store.apply('coin-call', s => callTaken(s, { id: p.roll, hunter: { kind: 'remote', remote: p.by }, who: p.who, what: p.what, face: p.face, call: p.call })).ok) return;
    void notifyHidden(`${p.who || 'A hunter'} called ${SIDE_WORDS[p.call]}`, `Natural ${p.face} for ${p.what}.`, p.eid);
    askNext();
  });
  app.on('change', askNext);
  askNext();
}
