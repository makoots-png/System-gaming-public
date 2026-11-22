// words.js: a private word to the GM on screen (notes-5-trade.md section 4). Publishes app.api.words: the Room view's
// "Word to the GM" section on a player's phone (the field, Send to the GM, this hunter's thread in the room) and the GM
// view's "Words from players" section (each word with Answer, its field and Send answer). Each write is one step of
// src/core/sync/word.ts through store.apply (`wordSent`, `wordAnswered`, `wordRead`, `wordsSeen`), then the outbox is
// sent. On the GM's phone it hears each word once (`wordHeard`, with a toast and a notification while the page is
// hidden) and another GM phone's answer (`wordBackHeard`). On a player's phone it opens the answer's window while the
// save owes it (`owedAnswer`): the word's life is its row in the save, and this view keeps none of it.
import { WORD_MAX } from '../core/protocol.ts';
import { WORD_WORDS, gmWords, mineThread, owedAnswer, shownOf, unseenWords, wordAnswered, wordBackHeard, wordHeard, wordRead, wordSent, wordsSeen } from '../core/sync/word.ts';
import { parseEventId } from '../core/ids.ts';
import { notifyHidden } from '../edge/notify.ts';

const W = WORD_WORDS, G = WORD_WORDS.gm;
const pad = n => String(n).padStart(2, '0');
/** An ISO time as this phone's clock shows it ("21:04"), or '' for one that does not read. */
const clock = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc } = ui;
  const A = () => app.api;
  // the word whose answer's window is on screen, so a change of the save opens it once (null while none is)
  let open = null;
  // the GM's word whose answer field is open under it (null for none)
  let answering = null;

  ui.css('words', `
.wd-box{display:flex;flex-direction:column;gap:10px}
.wd-box .field textarea{width:100%;box-sizing:border-box;resize:vertical;min-height:76px;font-family:var(--font-body);font-size:16px}
.wd-box .wd-hint{margin:0;font-size:13px;color:var(--muted)}
.wd-thread{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.wd-line{border:1px solid var(--line);background:rgba(10,26,46,.55);padding:8px 12px;display:flex;flex-direction:column;gap:4px;overflow-wrap:anywhere;min-width:0}
.wd-line p{margin:0;white-space:pre-wrap}
.wd-line .wd-who{font-size:12px;letter-spacing:.08em;color:var(--cyan-dim)}
.wd-line.wd-gm{border-color:var(--cyan-dim)}
.wd-line .wd-state{font-size:13px;color:var(--muted)}
.wd-line .acts{display:flex;gap:6px;flex-wrap:wrap}
.wd-line .acts button{min-height:var(--control-h)}
.wd-ans{display:flex;flex-direction:column;gap:8px;margin-top:4px}
`);

  // ── the player's section in the Room view ──
  /** The hunter this phone plays in its room, and the room; null when it plays none. */
  const playing = () => { const h = A().sync.bound(), room = A().sync.room(); return h && room && app.seat() === 'player' ? { h, room } : null; };
  function threadHtml(room, hid) {
    const box = store.get().settings.sync.outbox ?? [];
    const lines = mineThread(store.get(), room, hid).flatMap(w => {
      const state = W.shown[shownOf(w, box)];
      const me = `<li class="wd-line" data-word="${esc(w.id)}"><span class="wd-who">${esc(W.you(clock(w.at)))}</span><p>${esc(w.text)}</p>${state ? `<span class="wd-state">${esc(state)}</span>` : ''}</li>`;
      const a = 'answer' in w.state ? w.state.answer : null;
      return a ? [me, `<li class="wd-line wd-gm" data-answer="${esc(a.id)}"><span class="wd-who">${esc(W.gmAt(clock(a.at)))}</span><p>${esc(a.text)}</p></li>`] : [me];
    });
    return lines.length ? `<ol class="wd-thread" data-wd-thread>${lines.join('')}</ol>` : `<p class="wd-hint" data-wd-thread>${esc(W.none)}</p>`;
  }
  function send(box) {
    const p = playing(), field = box.querySelector('[data-wd-text]');
    if (!p || !field) return;
    const at = new Date().toISOString(), stamp = A().sync.stamp();
    const w = store.apply('word-sent', s => wordSent(s, { hid: p.h.id, text: field.value, at, stamp }));
    if (!ui.wrote(G.tag, w, W.refusals)) return;
    A().sync.flush();
    field.value = '';
  }
  /** Draws the player's section in `box`: the field once (never replaced while typed in), the thread when it changed. */
  function player(box) {
    const p = playing();
    if (!p) { box.hidden = true; return; }
    box.hidden = false;
    if (!box.dataset.wd) {
      box.dataset.wd = '1';
      box.innerHTML = `<div class="wd-box"><p class="wd-hint">${esc(W.privacy)}</p>
        ${ui.field(W.field, `<textarea data-wd-text rows="3" maxlength="${WORD_MAX}" autocomplete="off"></textarea>`)}
        <button type="button" class="primary" data-wd-send>${esc(W.send)}</button>
        <div data-wd-list></div></div>`;
      box.querySelector('[data-wd-send]').addEventListener('click', () => send(box));
    }
    const html = threadHtml(p.room, p.h.id), list = box.querySelector('[data-wd-list]');
    if (list.dataset.sig !== html) { list.dataset.sig = html; list.innerHTML = html; }
  }
  /** The answer's window, while the save owes one and none is on screen; its close reads it (`wordRead`). */
  async function owed() {
    const w = owedAnswer(store.get());
    if (!w || !('answer' in w.state) || open !== null) return;
    open = w.id;
    try { await ui.system({ tag: W.windowTag, title: W.windowTitle, body: w.state.answer.text, actions: [{ label: 'Close', value: null, cancel: true, primary: true }] }); }
    finally { open = null; }
    if (owedAnswer(store.get())?.id !== w.id) return;
    if (ui.wrote(W.windowTag, store.apply('word-read', s => wordRead(s, w.id)))) void owed();
  }
  app.on('change', () => { if (app.seat() === 'player') void owed(); });
  app.on('ready', () => { if (app.seat() === 'player') void owed(); });

  // ── the GM's section ──
  function gmLine(w) {
    const head = `<span class="wd-who">${esc(G.line(w.name, clock(w.at)))}</span><p>${esc(w.text)}</p>`;
    if (w.state.is === 'answered') {
      const a = w.state.answer;
      return `<li class="wd-line" data-word="${esc(w.id)}">${head}<span class="wd-who">${esc(W.you(clock(a.at)))}</span><p>${esc(a.text)}</p></li>`;
    }
    const form = answering === w.id ? `<div class="wd-ans">${ui.field(G.field, `<textarea data-wd-answer rows="3" maxlength="${WORD_MAX}" autocomplete="off"></textarea>`)}<button type="button" class="primary" data-wd-reply="${esc(w.id)}">${esc(G.send)}</button></div>`
      : `<div class="acts"><button type="button" data-wd-open="${esc(w.id)}" aria-label="${esc(`${G.answer}: ${w.name}`)}">${esc(G.answer)}</button></div>`;
    return `<li class="wd-line" data-word="${esc(w.id)}">${head}${form}</li>`;
  }
  function reply(box, id) {
    const room = A().sync.room(), w = room ? gmWords(store.get(), room).find(x => x.id === id) : null, field = box.querySelector('[data-wd-answer]'), msg = box.querySelector('[data-wd-msg]');
    if (!w || !field) return;
    const log = { at: new Date().toISOString(), cap: app.rules().logCap }, stamp = A().sync.stamp();
    msg.textContent = '';
    const r = store.apply('word-answer', s => wordAnswered(s, id, field.value, { stamp, log }));
    if (!ui.wrote(G.tag, r, G.refusals)) return;
    A().sync.flush();
    answering = null;
    msg.textContent = G.sent(w.name);
    paint(box);
  }
  function wireGm(box) {
    box.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !box.contains(b)) return;
      const opened = parseEventId(b.dataset.wdOpen), id = parseEventId(b.dataset.wdReply);
      if (opened) { answering = opened; box.querySelector('[data-wd-msg]').textContent = ''; paint(box); box.querySelector('[data-wd-answer]')?.focus(); }
      else if (id) reply(box, id);
    });
  }
  /** Draws the GM's section in `box`; answers its head summary ("2 new"). A typed answer is kept across a redraw. */
  function paint(box) {
    if (!box.dataset.wd) { box.dataset.wd = '1'; box.innerHTML = '<div class="wd-box"><p class="wd-hint" role="status" data-wd-msg></p><div data-wd-list></div></div>'; wireGm(box); }
    const room = A().sync.room(), words = room ? gmWords(store.get(), room) : [];
    if (answering !== null && !words.some(w => w.id === answering && w.state.is !== 'answered')) answering = null;
    const html = words.length ? `<ol class="wd-thread">${words.map(gmLine).join('')}</ol>` : `<p class="wd-hint">${esc(G.none)}</p>`;
    const list = box.querySelector('[data-wd-list]');
    if (list.dataset.sig !== html) {
      const typed = list.querySelector('[data-wd-answer]')?.value ?? '';
      list.dataset.sig = html; list.innerHTML = html;
      const field = list.querySelector('[data-wd-answer]'); if (field) field.value = typed;
    }
    return room ? G.summary(unseenWords(store.get(), room)) : '';
  }
  /** The GM opened or closed the section: its new words are seen. */
  function seen() {
    const room = A().sync.room();
    if (room && unseenWords(store.get(), room)) ui.wrote(G.tag, store.apply('words-seen', s => wordsSeen(s, room)));
  }

  // the GM's phone hears each word once (its log line in the same write), and another GM phone's answer
  app.on('sync:event', ({ event: ev }) => {
    const room = A().sync.room();
    if (app.seat() !== 'gm' || !room) return;
    if (ev.type === 'word') {
      const p = ev.payload, log = { at: new Date().toISOString(), cap: app.rules().logCap };
      if (!A().sync.once(p.eid, s => wordHeard(s, p, { room, log }))) return;
      const name = p.name || 'A hunter';
      ui.toast(G.tag, G.notify(name), { kind: 'info' });
      void notifyHidden(G.notify(name), G.notifyBody, p.eid);
    } else if (ev.type === 'wordBack') {
      const p = ev.payload;
      if (!A().sync.once(p.eid, s => wordBackHeard(s, p, new Date().toISOString()))) return;
      app.redraw();
    }
  });

  /** @type {import('../core/api.ts').WordsApi} */
  app.api.words = { player, paint, seen, unseen: () => { const room = A().sync.room(); return room ? unseenWords(store.get(), room) : 0; } };
}
