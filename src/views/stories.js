// stories.js: the GM's stories on the table (notes-1-stories.md section 5), app.api.stories. The GM view's Stories
// section (`paint`: a card a running story, with its chapter, the GM's note, what the next chapter gives, Open chapter N
// or End story and "⋯"; the ended ones folded), the turn-on window (`turnOn`: the library's stories, then who it is for
// and the first chapter as the players will see it), the open window (a chapter, who gets it, the window the players
// will see and the GM's note) and End held two seconds under Undo. Every move is one tap's `storyMove` (src/core/story/
// run.ts) in one write through `hunter.grantWrite`, so a fight's parts go on the rows in the same write; this module is
// the one place a story moves (the lint "a story moves only from src/views/stories.js"). Each window reads the save when
// it opens and carries the count of opens it was drawn with, so a stale tap is refused and writes nothing. Every
// sentence is core's (`STORY_WORDS`, `RUN_REFUSAL_WORDS`). The hunters at the table are this phone's and, in the GM's
// room, the players' (their sheets), to whom a move posts the chapter's message in the same write.
import { closeWindow, css, esc, h, openWindow, trapTab } from './ui.js';
import { enter } from './motion.ts';
import { END_HOLD_MS, RUN_REFUSAL_WORDS, STORY_WORDS as W, atTable, givesLine, hadChapter, nameOf, nextChapter, openedLine, running, sameRef, storyMove, whoFor } from '../core/story/run.ts';
import { chapterWindow, storyMeta, whoseLine } from '../core/story/story.ts';
import { grantLines, isEmptyReward } from '../core/rewards.ts';
import { stepTime } from '../core/day.ts';
import { gmSource } from '../core/effects.ts';
import { postNews } from '../core/sync/connection.ts';
import { cryptoRandom } from '../edge/roll.ts';
import { isRefused } from '../core/save-step.ts';
import { storyMaker } from './story-maker.js';

css('stories', `
.st{display:flex;flex-direction:column;gap:10px}
.st p{margin:0;overflow-wrap:anywhere}
.st-empty{color:var(--cyan-dim)}
.st-top{display:flex;flex-wrap:wrap;gap:8px}.st-top button{min-height:var(--control-h)}
.st-card{border:1px solid var(--line);background:rgba(10,26,46,.55);padding:10px 12px;display:flex;flex-direction:column;gap:6px;min-width:0}
.st-card h3{margin:0;font-size:calc(17px*var(--ts));color:var(--ice);overflow-wrap:anywhere}
.st-who,.st-at{font-size:calc(14px*var(--ts));color:var(--cyan-dim)}
.st-note{font-size:calc(14px*var(--ts));color:var(--ice)}
.st-next{font-size:calc(14px*var(--ts));color:var(--gold)}
.st-acts{display:flex;gap:8px}.st-acts button.primary{flex:1 1 auto;min-height:var(--control-h)}.st-acts .icon-btn{min-width:var(--control-h);min-height:var(--control-h)}
.st-ended summary{min-height:var(--control-h);display:flex;align-items:center;cursor:pointer;color:var(--cyan)}
.st-ended ul{margin:0;padding-left:18px;font-size:calc(14px*var(--ts));color:var(--cyan-dim)}
.st-ov{align-items:stretch}
.st-win.sys-window{display:flex;flex-direction:column;overflow:visible;text-align:left;padding:14px 14px 0;max-height:calc(100dvh - 32px - var(--sat) - var(--sab));margin:auto}
.st-win .n-big.st-title{font-size:calc(20px*var(--ts));letter-spacing:.1em;margin:0 0 8px;overflow-wrap:anywhere}
.st-mid{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:10px;padding:2px 2px 10px}
.st-mid .lbl{margin:0}
.st-mid p{margin:0;overflow-wrap:anywhere}
.st-prev{border:1px solid var(--line-bright);padding:10px 12px;display:flex;flex-direction:column;gap:4px}
.st-prev .n-big{font-size:calc(17px*var(--ts));margin:0;overflow-wrap:anywhere}.st-prev .n-body{margin:0}.st-prev ul{margin:0;padding-left:18px}
.st-chips{display:flex;flex-wrap:wrap;gap:6px}.st-chips button{min-height:var(--control-h);text-transform:none;letter-spacing:normal}
.st-chips button:disabled{opacity:.5}
.st-chs.seg>button{min-height:var(--control-h);min-width:var(--control-h);flex:0 0 auto}
.st-chs>button.st-had{text-decoration:underline;text-underline-offset:4px}
.st-chs select{min-height:var(--control-h);width:100%}
.st-rows{display:flex;flex-direction:column;gap:6px}
button.st-row{display:flex;flex-direction:column;align-items:stretch;gap:2px;width:100%;text-align:left;padding:8px 12px;min-height:var(--control-h);text-transform:none;letter-spacing:normal;font-weight:400}
.st-row .st-nm{font-weight:600;color:var(--ice);overflow-wrap:anywhere}.st-row .st-meta{font-size:calc(13px*var(--ts));color:var(--cyan-dim);overflow-wrap:anywhere}
.st-err{min-height:0}
.st-win .st-actions{flex:0 0 auto;margin:0 -14px;padding:10px 14px calc(10px + var(--sab));border-top:1px solid var(--line)}
`);

/** A hunter's id on a chip: this phone's hunter id, or a player's sheet key. */
const idOf = ref => (ref.kind === 'local' ? ref.hunterId : ref.remote);

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const A = () => app.api, S = () => store.get();
  const storyOf = run => S().library.stories.find(s => s.id === run.story) || null;
  /** The players' sheets this phone holds as the room's GM (none outside a room), and the hunters at the table with them. */
  const sheets = () => A().sync.remoteSheets(), here = () => atTable(S(), sheets()).map(p => p.ref);
  const nameFor = r => nameOf(S(), sheets(), r), namesOf = refs => refs.map(nameFor);
  const forWho = run => W.forWho(run.who, run.who.at === 'hunters' ? namesOf(run.who.refs.filter(r => here().some(x => sameRef(x, r)))) : []);
  const words = (why, n) => (RUN_REFUSAL_WORDS[why] ? RUN_REFUSAL_WORDS[why](n) : W.notSaved);

  /**
   * One tap's move: `make` builds the event at the write's moment and session, `storyMove` writes it with what a fight
   * holds on the rows (`grantWrite`), then each of this phone's hunters is shown the chapter's window. Answers what the
   * move did, or its refusal; nothing is written on a refusal.
   * @param {import('../core/ids.ts').StoryRunId} runId @param {(at: string, session: number) => import('../core/story/run.ts').RunEvent} make
   */
  function move(runId, make) {
    const day = { ...stepTime(S(), new Date()), R: app.rules() }, e = make(day.at, S().world.session), code = A().sync.room(), players = sheets();
    const onRow = key => { const at = A().hunter.fightOf({ key }); return !!at && at.at === 'row'; };
    /** @type {import('../core/story/run.ts').MoveRoom | null} the stamp of the message's id is made once, so the step read twice posts the same message */
    const room = app.seat() === 'gm' && code !== null ? { code, sheets: players, onRow, stamp: { device: S().settings.deviceId, now: Date.now(), rand: cryptoRandom() } } : null;
    const ctx = { day, vitals: hid => (A().hunter.fightOf({ hid }) ? 'fight' : 'sheet'), room };
    const rankOf = key => (players.find(x => x.key === key) || { data: { rank: 'E' } }).data.rank;
    // a player's hunter on a row of this phone's fight: the chapter's statuses go on its row in the same write, as Award's do (gm.js `sendAward`)
    const rowParts = m => m.onRow.map(({ key, statuses }) => ({ who: { key }, statuses: statuses.map(st => ({ key: st.key, rounds: st.rounds ?? null, source: gmSource(rankOf(key)), ...(st.def ? { def: st.def } : {}) })), refill: false }));
    const out = A().hunter.grantWrite(`story-${e.type}`, s => {
      const m = storyMove(s, runId, e, ctx);
      return isRefused(m) ? m : { ...m, held: [...m.granted.map(({ hid, g }) => ({ who: { hid }, ...g.fight })), ...rowParts(m)] };
    });
    if (isRefused(out)) return out;
    if (out.posted.length) A().sync.flush();
    for (const { hid, g } of out.granted) A().hunter.granted(hid, { ...g, lines: g.window.lines }, { tag: g.window.tag, title: g.window.title, body: whoseLine(g.window.body, S().hunters, hid), kind: 'quest' });
    return out;
  }
  /** What the GM is told after a move: who got the chapter, who gets it when the room answers, and who was skipped. */
  const told = (first, out) => {
    const waits = out.posted.length && postNews({ ok: true }, A().sync.conn()) !== 'sent' ? W.waits(out.posted.map(key => nameFor({ kind: 'remote', remote: key }))) : '';
    ui.toast(W.tag, [first, waits, out.skipped.length ? W.skipped(namesOf(out.skipped)) : ''].filter(Boolean).join(' '));
  };

  // ── a window of the stack: its head, a middle that scrolls, the error line and Cancel and the action ──
  /**
   * @param {string} title @param {string} go the action's label
   * @param {{ click: (b: HTMLElement) => void; change?: (t: HTMLElement) => void; act: () => boolean }} on `act` answers whether the window may close
   */
  function storyWindow(title, go, on) {
    const trigger = document.activeElement, uid = 'stw' + Math.random().toString(36).slice(2, 7);
    const el = h(`<div class="overlay sys-overlay show st-ov">
      <div class="sys-window k-quest st-win" role="dialog" aria-modal="true" aria-labelledby="${uid}-t"><span class="cb"></span>
        <div class="n-tag">${esc(W.tag)}</div><h2 class="n-big st-title" id="${uid}-t">${esc(title)}</h2>
        <div class="st-mid" data-st-mid></div>
        <div class="sys-err st-err" role="alert" data-st-err></div>
        <div class="sys-actions dlg-actions st-actions"><button type="button" data-st-cancel>${esc(W.cancel)}</button><button type="button" class="primary" data-st-go>${esc(go)}</button></div>
      </div></div>`);
    const win = el.firstElementChild;
    const w = {
      mid: win.querySelector('[data-st-mid]'), err: win.querySelector('[data-st-err]'), go: win.querySelector('[data-st-go]'), title: win.querySelector(`#${uid}-t`),
      close() { closeWindow(me); if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus(); },
    };
    const me = openWindow('story', () => { document.body.appendChild(el); return { root: el, win }; }, e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); w.close(); return; }
      if (e.key === 'Tab') trapTab(e, win);
    });
    el.addEventListener('click', e => {
      if (e.target === el) return w.close();
      const b = e.target.closest('button'); if (!b || !win.contains(b)) return;
      if (b.hasAttribute('data-st-cancel')) return w.close();
      if (b.hasAttribute('data-st-go')) { if (on.act()) w.close(); return; }
      on.click(b);
    });
    if (on.change) el.addEventListener('change', e => on.change(e.target));
    void enter(win); void enter(el, 'fade');
    return w;
  }
  /** The window a chapter opens for the players, as they will see it (`chapterWindow` with the reward editor's lines), and the GM's note. */
  function previewHtml(c) {
    const p = chapterWindow(c.words, grantLines(app.rules(), c.rewards), c.quest);
    return `<div class="lbl">${esc(W.playersSee)}</div><div class="st-prev k-quest"><div class="n-tag">${esc(p.tag)}</div><h3 class="n-big">${esc(p.title)}</h3>
      ${p.body ? `<p class="n-body">${esc(p.body)}</p>` : ''}${p.lines.length ? `<ul>${p.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}</div>
      ${c.note ? `<div class="lbl">${esc(W.yourNote)}</div><p>${esc(c.note)}</p>` : ''}`;
  }
  /** The hunters' chips: each at the table, pressed when picked, marked when it has had the chapter; a chosen hunter away greyed. */
  const chipsHtml = (refs, picked, has, away) => `<div class="st-chips" role="group" aria-label="${esc(W.who)}">${refs.map(r => `<button type="button" class="mk-chip" data-st-who="${esc(idOf(r))}" aria-pressed="${picked.has(idOf(r))}">${esc(nameFor(r))}${has(r) ? ` · ${esc(W.hasIt)}` : ''}</button>`).join('')}${
    away.map(r => `<button type="button" class="mk-chip" disabled>${esc(nameFor(r))} · ${esc(W.notHere)}</button>`).join('')}</div>`;

  // ── the open window ──
  /** Opens the window that opens a chapter of run `runId`, at the next chapter (the run's own when it is at the last). */
  function openChapter(runId) {
    const run = S().storyRuns.find(r => r.id === runId), story = run && storyOf(run);
    if (!run || !story) return;
    const table = here(), seen = run.opens, next = nextChapter(run, story);
    const away = run.who.at === 'hunters' ? run.who.refs.filter(r => !table.some(x => sameRef(x, r))) : [];
    const st = { chapter: next ?? Math.min(run.state.chapter, story.chapters.length - 1), picked: new Set() };
    const preset = () => { st.picked = new Set(whoFor(run, st.chapter, table).map(idOf)); };
    preset();
    const w = storyWindow(W.open(st.chapter), W.open(st.chapter), {
      click(b) {
        if (b.dataset.stCh !== undefined) { st.chapter = Number(b.dataset.stCh); preset(); draw(); return; }
        if (b.dataset.stWho !== undefined) { const id = b.dataset.stWho; if (st.picked.has(id)) st.picked.delete(id); else st.picked.add(id); draw(); }
      },
      change(t) { if (t instanceof HTMLSelectElement && t.matches('[data-st-chsel]')) { st.chapter = Number(t.value); preset(); draw(); } },
      act() {
        const to = table.filter(r => st.picked.has(idOf(r)));
        const out = move(runId, (at, session) => ({ type: 'open', chapter: st.chapter, seen, to, at, session }));
        if (isRefused(out)) { const now = S().storyRuns.find(r => r.id === runId); w.err.textContent = words(out.why, out.why === 'no-chapter' || out.why === 'too-large' || !now ? st.chapter + 1 : now.state.chapter + 1); return false; }
        told(W.opened(st.chapter, namesOf(out.run.opened.at(-1).to)), out);
        return true;
      },
    });
    function draw() {
      const c = story.chapters[st.chapter], had = story.chapters.map((_, i) => run.opened.some(o => o.chapter === i));
      const chs = story.chapters.length <= 8
        ? `<div class="st-chs seg" role="group" aria-label="${esc(W.chapter)}">${story.chapters.map((_, i) => `<button type="button" data-st-ch="${i}" aria-pressed="${i === st.chapter}"${had[i] ? ` class="st-had" aria-label="${i + 1}, ${esc(W.openedMark)}"` : ''}>${i + 1}</button>`).join('')}</div>`
        : `<div class="st-chs"><select data-st-chsel aria-label="${esc(W.chapter)}">${story.chapters.map((_, i) => `<option value="${i}"${i === st.chapter ? ' selected' : ''}>${i + 1}${had[i] ? ` (${esc(W.openedMark)})` : ''}</option>`).join('')}</select></div>`;
      const again = table.filter(r => st.picked.has(idOf(r)) && hadChapter(run, st.chapter, r));
      w.mid.innerHTML = `${previewHtml(c)}<div class="lbl">${esc(W.chapter)}</div>${chs}
        <div class="lbl">${esc(W.who)}</div>${chipsHtml(table, st.picked, r => hadChapter(run, st.chapter, r), away)}
        ${again.length ? `<p>${esc(W.again(namesOf(again)))}</p>` : ''}`;
      w.title.textContent = W.open(st.chapter); w.go.textContent = W.open(st.chapter); w.err.textContent = '';
    }
    draw();
  }

  // ── the turn-on window ──
  /** Opens the turn-on window: the library's stories, or story `id`'s step at once. */
  function turnOnWindow(id) {
    const lib = () => S().library.stories, table = here();
    const st = { story: id ? lib().find(s => s.id === id) || null : null, table: true, picked: new Set() };
    const pick = s => { st.story = s; st.table = s.for === 'table'; st.picked = new Set(!st.table && table.length === 1 ? [idOf(table[0])] : []); };
    if (st.story) pick(st.story);
    const w = storyWindow(st.story ? W.turnOnStory(st.story.name) : W.turnOnTitle, W.turnOnGo, {
      click(b) {
        if (b.dataset.stStory !== undefined) { const s = lib().find(x => x.id === b.dataset.stStory); if (s) { pick(s); draw(); } return; }
        if (b.dataset.stFor !== undefined) { st.table = b.dataset.stFor === 'table'; if (st.table) st.picked.clear(); draw(); return; }
        if (b.dataset.stWho !== undefined) { const i = b.dataset.stWho; st.table = false; if (st.picked.has(i)) st.picked.delete(i); else st.picked.add(i); draw(); }
      },
      act() {
        const s = st.story; if (!s) return false;
        const to = st.table ? table : table.filter(r => st.picked.has(idOf(r))), runId = store.id('sr');
        /** @type {import('../core/story/run.ts').Who} */
        const who = st.table ? { at: 'table' } : { at: 'hunters', refs: to };
        const out = move(runId, (at, session) => ({ type: 'turnOn', id: runId, story: s.id, who, to, at, session }));
        if (isRefused(out)) { w.err.textContent = words(out.why, 1); return false; }
        told(W.turnedOn(s.name, namesOf(out.run.opened[0].to)), out);
        return true;
      },
    });
    function draw() {
      const s = st.story;
      w.go.hidden = !s; w.err.textContent = '';
      if (!s) {
        w.title.textContent = W.turnOnTitle;
        w.mid.innerHTML = `<div class="st-rows">${lib().map(x => `<button type="button" class="st-row" data-st-story="${esc(x.id)}"><span class="st-nm">${esc(x.name)}</span><span class="st-meta">${esc(storyMeta(x))}</span>${x.when ? `<span class="st-meta">${esc(x.when)}</span>` : ''}</button>`).join('')}</div>`;
        return;
      }
      const runs = running(S().storyRuns).filter(r => r.story === s.id);
      w.title.textContent = W.turnOnStory(s.name);
      w.mid.innerHTML = `<div class="lbl">${esc(W.who)}</div>
        <div class="seg" role="group" aria-label="${esc(W.who)}"><button type="button" data-st-for="table" aria-pressed="${st.table}">${esc(W.table)}</button><button type="button" data-st-for="hunters" aria-pressed="${!st.table}">${esc(W.chosen)}</button></div>
        ${chipsHtml(table, st.picked, () => false, [])}
        ${runs.length ? `<p>${esc(W.already(runs.map(forWho)))}</p>` : ''}
        ${previewHtml(s.chapters[0])}`;
    }
    draw();
  }

  // ── End, held under Undo ──
  /** End of run `runId` held `END_HOLD_MS` under Undo, then written with the count of opens of the tap: a story opened meanwhile is not ended. */
  function endStory(runId) {
    const run = S().storyRuns.find(r => r.id === runId); if (!run) return;
    const seen = run.opens;
    ui.toast(W.tag, W.endedToast(run.name), { hold: { ms: END_HOLD_MS, undo: W.undo, act: () => {
      const out = move(runId, (at, session) => ({ type: 'end', seen, at, session }));
      if (isRefused(out)) { const now = S().storyRuns.find(r => r.id === runId); ui.toast(W.tag, words(out.why, now ? now.state.chapter + 1 : 1), { kind: 'warning' }); }
    } } });
  }
  /** The "⋯" list of a running story's card. */
  async function more(runId) {
    const run = S().storyRuns.find(r => r.id === runId); if (!run) return;
    const a = await ui.system({ tag: W.tag, title: run.name, layout: 'list', actions: [
      ...(storyOf(run) ? [{ label: W.openOther, value: 'open' }] : []), { label: W.end, value: 'end', danger: true }, { label: W.cancel, value: null, cancel: true }] });
    if (a === 'open') openChapter(runId);
    if (a === 'end') endStory(runId);
  }

  // ── the section ──
  /** A running story's card. */
  function cardHtml(run) {
    const story = storyOf(run), name = esc(run.name), at = run.state.chapter;
    if (!story) return `<article class="st-card" data-run="${esc(run.id)}"><h3>${name}</h3><p class="st-who">${esc(forWho(run))}</p><p>${esc(W.gone)}</p>
      <div class="st-acts"><button type="button" class="primary" data-st-end>${esc(W.end)}</button></div></article>`;
    const c = story.chapters[at] || null, next = nextChapter(run, story), n = next === null ? null : story.chapters[next];
    const opened = [...run.opened].reverse().find(o => o.chapter === at);
    return `<article class="st-card" data-run="${esc(run.id)}"><h3>${name}</h3><p class="st-who">${esc(forWho(run))}</p>
      <p class="st-at">${esc(W.at(at, story.chapters.length, c))} ${esc(openedLine(opened, S().world.session))}</p>
      ${c && c.note ? `<p class="st-note">${esc(W.note(c.note))}</p>` : ''}
      <p class="st-next">${n ? `${esc(W.next(next, n))} ${esc(givesLine(n, isEmptyReward(n.rewards)))}` : esc(W.last(story.chapters.length - 1))}</p>
      <div class="st-acts">${n ? `<button type="button" class="primary" data-st-open>${esc(W.open(next))}</button>` : `<button type="button" class="primary" data-st-end>${esc(W.end)}</button>`}
        <button type="button" class="icon-btn" data-st-more aria-label="${esc(W.more(run.name))}" aria-haspopup="dialog">⋯</button></div></article>`;
  }
  function bodyHtml() {
    const s = S(), live = running(s.storyRuns), ended = s.storyRuns.filter(r => r.state.at === 'ended').reverse();
    if (!s.library.stories.length && !s.storyRuns.length) return `<p class="st-empty">${esc(W.noStories)}</p><div class="st-top"><button type="button" class="primary" data-st-new>${esc(W.newStory)}</button></div>`;
    return `${s.library.stories.length ? `<div class="st-top"><button type="button"${live.length ? '' : ' class="primary"'} data-st-turnon>${esc(W.turnOnButton)}</button></div>` : ''}
      ${live.length ? live.map(cardHtml).join('') : `<p class="st-empty">${esc(W.noneRunning)}</p>`}
      ${ended.length ? `<details class="st-ended"><summary>${esc(W.ended(ended.length))}</summary><ul>${ended.map(r => `<li>${esc(W.endedLine(r.name, forWho(r), r.state.chapter, r.state.at === 'ended' ? r.state.session : 0))}</li>`).join('')}</ul></details>` : ''}`;
  }
  /** Wires a section box's taps, once. */
  function wire(box) {
    box.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !box.contains(b)) return;
      const runId = b.closest('[data-run]') ? b.closest('[data-run]').dataset.run : null;
      if (b.hasAttribute('data-st-new')) return void storyMaker(app, null);
      if (b.hasAttribute('data-st-turnon')) return turnOnWindow(null);
      if (!runId) return;
      if (b.hasAttribute('data-st-open')) return openChapter(runId);
      if (b.hasAttribute('data-st-end')) return endStory(runId);
      if (b.hasAttribute('data-st-more')) return void more(runId);
    });
  }

  /** @type {import('../core/api.ts').StoriesApi} */
  app.api.stories = {
    paint(box) {
      if (!box.dataset.st) { box.dataset.st = '1'; box.classList.add('st'); wire(box); }
      const html = bodyHtml();
      if (box.dataset.sig !== html) {
        const fold = box.querySelector('.st-ended'), was = !!fold && fold.hasAttribute('open');
        box.dataset.sig = html; box.innerHTML = html;
        const now = box.querySelector('.st-ended'); if (now && was) now.setAttribute('open', '');
      }
      return W.summary(running(S().storyRuns).length);
    },
    async turnOn(id) { turnOnWindow(id); },
  };
}
