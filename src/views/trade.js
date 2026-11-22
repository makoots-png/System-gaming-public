// trade.js: trading on screen. Publishes app.api.trade: the Give window (an offer to another player's hunter in the room,
// or a hand over to another hunter of this phone), the Bag's Offers tab, and the GM view's "Trades and stash" section (the
// trading switch, the open offers with Stop). Each write is one tap step of src/core/trade (offer.ts `offerPosted`,
// `offerAnswered`, `offerTakenBack`, `offerStopped`; goods.ts `handOver`) through store.apply, then the outbox is sent. An
// offer's life is its record's row in the save (offer.ts `GIVER`, `TAKER`, `WATCH`): this view reads it and keeps none.
// Words: src/core/trade/words.ts, offer.ts and goods.ts (notes-5-trade.md section 7).
import { GOODS_GOLD_MAX, OFFER_REFUSAL_WORDS, handOver, refusalWords } from '../core/trade/goods.ts';
import { TRADE_WORDS } from '../core/trade/words.ts';
import { GIVER, STATE_WORDS, TAKER, WATCH, asideOf, offerAnswered, offerPosted, offerStopped, offerTakenBack, offersOf, recordOf } from '../core/trade/offer.ts';
import { GIVE_HOLD_MS } from '../core/registry/bundles.ts';
import { tradeRuleSet } from '../core/rules.ts';
import { deviceOf, parseOfferId } from '../core/ids.ts';
import { oneOf } from '../core/one-of.ts';

const W = TRADE_WORDS;

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc } = ui;
  const A = () => app.api;

  ui.css('trade', `
.tr-give{display:flex;flex-direction:column;gap:8px;text-align:left}
.tr-give .tr-have{margin:0;font-size:13px;color:var(--cyan-dim)}
.tr-to,.tr-bag{display:flex;flex-wrap:wrap;gap:6px}
.tr-to>button,.tr-bag>button{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;min-height:var(--control-h);min-width:0;max-width:100%;padding:4px 12px;text-align:left;overflow-wrap:anywhere}
.tr-to>button small{font-size:12px;color:var(--cyan-dim);font-weight:400}
.tr-to>button[aria-checked=true],.tr-bag>button[aria-pressed=true]{background:var(--cyan);border-color:var(--cyan);color:var(--ground);box-shadow:none}
.tr-to>button[aria-checked=true] small{color:var(--ground)}
.tr-ask summary{min-height:var(--control-h);display:flex;align-items:center;cursor:pointer;color:var(--cyan)}
.tr-ask[open]>div{display:flex;flex-direction:column;gap:8px;padding:0 0 4px}
.tr-hint{margin:0;font-size:13px;color:var(--cyan-dim)}
.tr-offers{margin-bottom:10px}
.tr-offers h3{margin:12px 0 6px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan-dim)}
.tr-offers h3:first-child{margin-top:0}
.tr-offer{border:1px solid var(--line);background:rgba(10,26,46,.55);padding:9px 12px;display:flex;flex-direction:column;gap:6px;overflow-wrap:anywhere}
.tr-offer p{margin:0}
.tr-offer .tr-state{font-size:13px;color:var(--cyan-dim)}
.tr-offer .acts{display:flex;gap:6px;flex-wrap:wrap}
.tr-offer .acts button{min-height:var(--control-h)}
.tr-gm .tr-offer{flex-direction:row;align-items:center;justify-content:space-between;flex-wrap:wrap}
.tr-gm .tr-offer span{flex:1 1 180px;min-width:0}
`);

  /** What a refused tap says, by its kind (goods.ts `refusalWords`); none for a read-only tab's refusal, which `ui.wrote` tells. */
  const wordsOf = w => ('why' in w && Object.hasOwn(OFFER_REFUSAL_WORDS, w.why) ? { [w.why]: refusalWords(w) } : {});
  /** What the tap steps take from the screen: the table's switch as this phone last read it, and whether a fight holds hunter `hid`. */
  const gateOf = hid => ({ on: app.rules().trade.on, held: A().hunter.fightOf({ hid }) !== null });

  // ── the Give window ──
  /**
   * Whom hunter `hid` can give to: the other players' hunters in the room (faces, `sync.faces`) while this phone plays
   * there and trading is on, and the other hunters of this phone.
   */
  function targetsOf(hid) {
    const me = store.get().settings.deviceId, room = app.seat() === 'player' && app.rules().trade.on ? A().sync.faces().filter(f => deviceOf(f.key) !== me) : [];
    return [...room.map(f => ({ kind: 'room', key: f.key, name: f.name, bag: f.bag ?? [] })),
      ...store.get().hunters.filter(x => x.id !== hid).map(x => ({ kind: 'phone', hid: x.id, name: x.name }))];
  }
  function giveHtml(h, it, targets) {
    const count = it ? (it.qty > 1 ? `${ui.field(W.howMany, `<input type="number" data-tr-n min="1" max="${esc(it.qty)}" step="1" inputmode="numeric" value="1">`)}<p class="tr-have">${esc(W.have(it.qty))}</p>` : '')
      : `${ui.field(W.gold, `<input type="number" data-tr-n min="1" max="${esc(h.gold)}" step="1" inputmode="numeric">`)}<p class="tr-have">${esc(W.haveGold(h.gold))}</p>`;
    const off = app.seat() === 'player' && !app.rules().trade.on ? `<p class="tr-hint">${esc(OFFER_REFUSAL_WORDS.off({ name: '', have: 0, need: 0 }))}</p>` : '';
    const chips = targets.map((t, n) => `<button type="button" role="radio" aria-checked="false" data-tr-to="${n}"><b>${esc(t.name)}</b><small>${esc(t.kind === 'room' ? W.inRoom : W.onPhone)}</small></button>`).join('');
    return `<div class="tr-give">${count}<div class="lbl" id="tr-to-l">${esc(W.to)}</div>
      ${chips ? `<div class="tr-to" role="radiogroup" aria-labelledby="tr-to-l">${chips}</div>` : `<p class="tr-hint">${esc(W.nobody)}</p>`}${off}
      <details class="tr-ask" hidden><summary>${esc(W.ask)}</summary><div>${ui.field(W.gold, `<input type="number" data-tr-askgold min="0" max="${GOODS_GOLD_MAX}" step="1" inputmode="numeric">`)}<div data-tr-bag></div></div></details>
      <p class="tr-hint" data-tr-hint hidden></p></div>`;
  }
  /** A whole number typed in `input`, or null when it is not one from `least` to `most` (an empty field is `empty`). */
  const typed = (input, least, most, empty = null) => {
    if (!input) return empty;
    const v = input.value.trim(), n = Number(v);
    return v === '' ? empty : Number.isInteger(n) && n >= least && n <= most ? n : null;
  };
  /**
   * What the Give window holds now: the hunter picked (`to`, an index of `targets`, or null), how many or how much, and the
   * gold and bag lines asked back. Read from the window each time, so nothing of it is kept beside the window.
   */
  function picked(win, it) {
    const chip = win.querySelector('[data-tr-to][aria-checked=true]'), to = chip ? Number(chip.dataset.trTo) : null;
    const n = it ? (it.qty > 1 ? typed(win.querySelector('[data-tr-n]'), 1, it.qty) : 1) : typed(win.querySelector('[data-tr-n]'), 1, Number(win.querySelector('[data-tr-n]').max));
    const askGold = typed(win.querySelector('[data-tr-askgold]'), 0, GOODS_GOLD_MAX, 0);
    const asked = [...win.querySelectorAll('[data-tr-ask][aria-pressed=true]')].map(b => ({ id: b.dataset.trAsk, qty: 1, name: b.dataset.trName }));
    return { to, n, askGold, asked };
  }
  /** The window drawn again from what it holds: the picked chip, Ask in return for a room hunter, the hint and the action's label. */
  function shown(win, it, targets) {
    const p = picked(win, it), t = p.to === null ? null : targets[p.to];
    const ask = win.querySelector('.tr-ask'), hint = win.querySelector('[data-tr-hint]'), go = win.querySelector('.sys-actions button.primary');
    ask.hidden = !t || t.kind !== 'room';
    if (t && t.kind === 'room' && ask.dataset.for !== t.key) {
      ask.dataset.for = t.key;
      win.querySelector('[data-tr-bag]').innerHTML = t.bag.length ? `<div class="lbl">${esc(W.fromBag(t.name))}</div><div class="tr-bag">${t.bag.map(l =>
        `<button type="button" aria-pressed="false" data-tr-ask="${esc(l.id)}" data-tr-name="${esc(l.name)}">${esc(l.qty > 1 ? `${l.name}\u00a0×\u00a0${l.qty}` : l.name)}</button>`).join('')}</div>` : '';
    }
    hint.hidden = !t || t.kind !== 'room';
    hint.textContent = t && t.kind === 'room' ? W.hint(t.name) : '';
    go.textContent = !t ? W.give : t.kind === 'room' ? W.offerTo(t.name) : W.giveTo(t.name);
    go.disabled = !t || p.n === null || (t.kind === 'room' && p.askGold === null);
  }
  function wireGive(win, it, targets) {
    win.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !win.contains(b)) return;
      if (b.dataset.trTo !== undefined) win.querySelectorAll('[data-tr-to]').forEach(c => c.setAttribute('aria-checked', String(c === b)));
      else if (b.dataset.trAsk !== undefined) b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
      else return;
      shown(win, it, targets);
    });
    win.addEventListener('input', () => shown(win, it, targets));
    shown(win, it, targets);
  }

  /** Hunter `hid` offers the room's hunter `t` what `pick` takes, asking `asks` back: one write, then the outbox is sent. */
  function offer(hid, t, pick, asks) {
    const at = new Date().toISOString(), stamp = A().sync.stamp(), gate = gateOf(hid);
    const w = store.apply('trade-offer', s => offerPosted(s, { hid, to: t.key, toName: t.name, gives: pick, asks, at, stamp, ...gate }));
    if (!ui.wrote(W.tag, w, wordsOf(w))) return;
    A().sync.flush();
    ui.toast(W.tag, W.offered(t.name, pick));
  }
  /** Hunter `hid` hands what `pick` takes to hunter `t` of this phone: one write, no message (goods.ts `handOver`). */
  function handTo(hid, t, pick) {
    const from = store.hunter(hid), ids = pick.items.map(() => store.id('i'));
    const w = store.apply('trade-hand', s => handOver(s, hid, t.hid, pick, { held: gateOf(hid).held }, () => ids.shift()));
    if (!ui.wrote(W.tag, w, wordsOf(w))) return;
    ui.toast(W.tag, W.handed(from ? from.name : '', t.name, pick));
  }

  async function give(hid, itemId) {
    const h = store.hunter(hid), it = itemId === null ? null : h && h.items.find(i => i.id === itemId);
    if (!h || it === undefined) return;
    const targets = targetsOf(hid), held = { win: null };
    const v = await ui.system({ tag: W.tag, title: it ? W.title(it.name) : W.titleGold, html: giveHtml(h, it, targets),
      actions: [{ label: W.cancel, value: null, cancel: true }, { label: W.give, value: 'give', primary: true }],
      drawn: win => { held.win = win; wireGive(win, it, targets); } });
    if (v !== 'give' || !held.win) return;
    const p = picked(held.win, it), t = p.to === null ? null : targets[p.to];
    if (!t || p.n === null) return;
    const pick = it ? { gold: 0, items: [{ id: it.id, qty: p.n, name: it.name }] } : { gold: p.n, items: [] };
    if (t.kind === 'room') offer(hid, t, pick, { gold: p.askGold ?? 0, items: p.asked });
    else handTo(hid, t, pick);
  }

  // ── the Bag's Offers tab ──
  function offerHtml(r) {
    const o = r.offer, id = esc(o.id);
    if (r.side === 'taker') {
      const acts = TAKER[r.state].accept !== null ? `<button type="button" class="primary" data-tr-accept="${id}">${esc(W.accept)}</button><button type="button" data-tr-refuse="${id}">${esc(W.refuse)}</button>`
        : TAKER[r.state].takeBack !== null ? `<button type="button" data-tr-back="${id}">${esc(W.takeBack)}</button>` : '';
      return `<li class="tr-offer" data-offer="${id}"><p>${esc(STATE_WORDS.taker.offered(o))}</p>${TAKER[r.state].accept !== null ? '' : `<p class="tr-state">${esc(STATE_WORDS.taker[r.state](o))}</p>`}${acts ? `<div class="acts">${acts}</div>` : ''}</li>`;
    }
    const back = GIVER[r.state].takeBack !== null ? `<div class="acts"><button type="button" data-tr-back="${id}">${esc(W.takeBack)}</button></div>` : '';
    return `<li class="tr-offer" data-offer="${id}"><p>${esc(W.yourLine(o))}</p><p class="tr-state">${esc(STATE_WORDS.giver[r.state](o))}</p>${back}</li>`;
  }
  /** Accept of offer `id`: one that asks something back is held under Undo first, since it gives that away; a gift is written at once. */
  function accept(hid, id) {
    const r = recordOf(store.get(), id, 'taker'); if (!r) return;
    if (!r.offer.asks.items.length && !r.offer.asks.gold) return void answer(hid, id, 'accept');
    ui.toast(W.tag, W.exchange(r.offer), { hold: { what: { kind: 'accept', offer: id }, ms: GIVE_HOLD_MS, undo: W.undo, act: () => answer(hid, id, 'accept') } });
  }
  function answer(hid, id, how) {
    const w = store.apply(`trade-${how}`, s => offerAnswered(s, id, how, gateOf(hid)));
    if (!ui.wrote(W.tag, w, wordsOf(w))) return;
    A().sync.flush();
  }
  /** Take back of offer `id`: a stranded record only after the window that says what the app cannot know. */
  async function takeBack(id) {
    const r = recordOf(store.get(), id, 'giver') ?? recordOf(store.get(), id, 'taker'); if (!r) return;
    if (r.state === 'stranded') {
      const body = r.side === 'giver' ? W.strandedGiver(r.offer) : W.strandedTaker(r.offer, asideOf(r));
      const yes = await ui.system({ tag: W.tag, title: W.strandedTitle, body, actions: [{ label: W.cancel, value: false, cancel: true }, { label: W.takeBack, value: true, primary: true }] });
      if (yes !== true) return;
    }
    const w = store.apply('trade-take-back', s => offerTakenBack(s, id));
    if (!ui.wrote(W.tag, w, wordsOf(w))) return;
    A().sync.flush();
  }
  function wireOffers(box) {
    box.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !box.contains(b)) return;
      const hid = box.dataset.hid, d = b.dataset, id = parseOfferId(d.trAccept ?? d.trRefuse ?? d.trBack);
      if (!id) return;
      if (d.trAccept !== undefined) accept(hid, id);
      else if (d.trRefuse !== undefined) answer(hid, id, 'refuse');
      else void takeBack(id);
    });
  }

  // ── the GM view's "Trades and stash" section ──
  function gmHtml() {
    const on = app.rules().trade.on, watched = offersOf(store.get()).filter(r => r.side === 'gm');
    const lines = watched.map(r => `<li class="tr-offer" data-offer="${esc(r.offer.id)}"><span>${esc(W.gmLine(r.offer))}</span>${WATCH[r.state].stop !== null
      ? `<button type="button" class="danger" data-tr-stop="${esc(r.offer.id)}" aria-label="${esc(`${W.stop}: ${W.gmLine(r.offer)}`)}">${esc(W.stop)}</button>` : `<span class="tr-state">${esc(W.stopping)}</span>`}</li>`).join('');
    return `<div class="gm-switch"><span class="lbl" id="tr-sw-l">${esc(W.trading)}</span>
        <div class="seg" role="group" aria-labelledby="tr-sw-l"><button type="button" data-tr-on="on" aria-pressed="${on}">${esc(W.on)}</button><button type="button" data-tr-on="off" aria-pressed="${!on}">${esc(W.off)}</button></div></div>
      <div class="lbl">${esc(W.open)}</div><ul class="plain tr-offers">${lines || `<li class="empty">${esc(W.noOpen)}</li>`}</ul>`;
  }
  /** Stop of offer `id`, held under Undo, then the GM's stop posted. */
  function stop(id) {
    const r = recordOf(store.get(), id, 'gm'); if (!r) return;
    ui.toast(W.tag, W.stopped(r.offer), { hold: { what: { kind: 'stop', offer: id }, ms: GIVE_HOLD_MS, undo: W.undo, act: () => {
      const w = store.apply('trade-stop', s => offerStopped(s, id));
      if (!ui.wrote(W.tag, w, wordsOf(w))) return;
      A().sync.flush();
    } } });
  }
  function wireGm(box) {
    box.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !box.contains(b)) return;
      const turn = oneOf(b.dataset.trOn, ['on', 'off'], null);
      if (turn) {
        const on = turn === 'on';
        if (app.rules().trade.on !== on) ui.wrote(W.tag, store.apply('gm-rules', s => tradeRuleSet(s, on)));
        return;
      }
      const id = parseOfferId(b.dataset.trStop);
      if (id) stop(id);
    });
  }

  /** @type {import('../core/api.ts').TradeApi} */
  app.api.trade = {
    give,
    offers(box, hid) {
      if (!box.dataset.tr) { box.dataset.tr = '1'; wireOffers(box); }
      box.dataset.hid = hid;
      const mine = offersOf(store.get()).filter(r => r.side !== 'gm' && r.hid === hid);
      const list = side => { const rs = mine.filter(r => r.side === side); return rs.length ? rs.map(offerHtml).join('') : `<li class="empty">${esc(W.none)}</li>`; };
      const html = `<div class="tr-offers"><h3>${esc(W.toYou)}</h3><ul class="plain" data-tr-list="to">${list('taker')}</ul><h3>${esc(W.yours)}</h3><ul class="plain" data-tr-list="yours">${list('giver')}</ul></div>`;
      if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; }
    },
    waiting: hid => offersOf(store.get()).filter(r => r.side === 'taker' && r.hid === hid && r.state === 'offered').length,
    paint(box) {
      if (!box.dataset.tr) { box.dataset.tr = '1'; box.classList.add('tr-gm'); wireGm(box); }
      const html = gmHtml();
      if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; }
      return W.summary(offersOf(store.get()).filter(r => r.side === 'gm').length);
    },
    removeLine: (key, name) => (offersOf(store.get()).some(r => r.side === 'gm' && r.offer.by === key) ? W.removeLine(name) : ''),
  };
}
