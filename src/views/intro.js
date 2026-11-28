// intro.js: full-screen world-primer intro player (Units 1 to 3: solo replay, System window/type cards, GM pacing,
// player follow view, rejoin bar, Card 16 Answer, story-card-wins, wake lock, double-tap guard).
import {
  INTRO_ART_READY,
  INTRO_CARDS,
  INTRO_CITIES,
  INTRO_FOOD_ITEMS,
  INTRO_STORY_COUNT,
  introCardCounter,
  introHunterWindow,
  introImagePath,
  introShopRows,
  introSliceOf,
} from '../core/intro-cards.ts';
import { RANKS } from '../core/rules.ts';
import {
  INITIAL_INTRO_UI,
  canTapNext,
  introDismiss,
  introEnd,
  introMarkGmTap,
  introMarkLocalAnswer,
  introRecordAnswer,
  introRejoin,
  introStart,
  introStep,
  introSupersede,
  introViewFor,
  soloClose,
  soloOpen,
  soloStep,
} from '../core/intro.ts';
import { icon, sprite } from './icons.ts';
import { staggerReveal } from './motion.ts';
import { closeWindow, openWindow, trapTab } from './ui.js';

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { ui } = app;
  const { esc, h } = ui;
  sprite();

  /** Client-side intro player state (src/core/intro.ts), moved only through pure transitions. */
  let state = INITIAL_INTRO_UI;
  /** Open overlay DOM, window stack handle, focus-restore element, and Screen Wake Lock sentinel. */
  let refs = null;

  /** Renders one System window or type card (`cards 0, 5, 9, 10, 11, 12, 14, 16`). */
  function windowCardHtml(card, thumb) {
    const R = app.rules();
    const roleAttr = thumb ? ' aria-hidden="true"' : ` role="img" aria-label="${esc(card.alt)}"`;
    switch (card.window) {
      case 'title':
        return `<div class="sys-window k-info intro-win"${roleAttr}><span class="cb"></span>
          <div class="n-tag">! System</div>
          <h2 class="n-big sys-title">The Hunter System</h2>
          <p class="intro-win-sub">${esc(card.label)}</p>
        </div>`;
      case 'cities':
        return `<div class="intro-cities-card"${roleAttr}>
          <h2 class="intro-cities-head">${esc(card.label)}</h2>
          <ol class="intro-cities" data-intro-cities>
            ${INTRO_CITIES.map(city => `<li${thumb ? '' : ' data-intro-city'}>${esc(city)}</li>`).join('')}
          </ol>
        </div>`;
      case 'ranks':
        return `<div class="sys-window k-info intro-win"${roleAttr}><span class="cb"></span>
          <div class="n-tag">! System</div>
          <h2 class="n-big sys-title">${esc(card.label)}</h2>
          <div class="intro-rank-ladder">${RANKS.map(r => ui.rankBadge(r)).join('')}</div>
          <ul class="intro-win-rows">
            <li>Clear: gate closes</li>
            <li>Break: monsters come out</li>
          </ul>
        </div>`;
      case 'shop': {
        const rows = introShopRows(R);
        return `<div class="sys-window k-info intro-win"${roleAttr}><span class="cb"></span>
          <div class="n-tag">! System</div>
          <h2 class="n-big sys-title">${esc(card.label)}</h2>
          <div class="intro-shop-head"><span>Gold</span><span class="intro-shop-gold">1,250 gold</span></div>
          <ul class="intro-shop-list">
            ${rows.map(row => `<li>
              <span class="intro-shop-item">${icon(row.icon, `intro-ic rar-${row.rar}`)}<span>${esc(row.name)}</span></span>
              <span class="intro-shop-price">${esc(row.price.toLocaleString())} gold</span>
            </li>`).join('')}
          </ul>
        </div>`;
      }
      case 'resident':
        return `<div class="sys-window k-info intro-win"${roleAttr}><span class="cb"></span>
          <div class="n-tag">! System</div>
          <h2 class="n-big sys-title">${esc(card.label)}</h2>
          <p class="intro-win-sub">Level 0</p>
          <div class="intro-res-act"><button type="button" class="intro-res-btn" disabled>Shop</button></div>
        </div>`;
      case 'hunter': {
        const sample = introHunterWindow(R);
        return `<div class="sys-window k-info intro-win"${roleAttr}><span class="cb"></span>
          <div class="n-tag">! System</div>
          <h2 class="n-big sys-title">${esc(card.label)}</h2>
          <dl class="intro-kv">
            <div><dt>Level</dt><dd>${esc(sample.level)}</dd></div>
            <div><dt>Quests</dt><dd>${esc(sample.quests)}</dd></div>
            <div><dt>Rank</dt><dd>${ui.rankBadge(sample.rank)}</dd></div>
            <div><dt>Cap</dt><dd>${esc(sample.cap)}</dd></div>
          </dl>
        </div>`;
      }
      case 'food':
        return `<div class="intro-food-wrap"${roleAttr}>
          <div class="intro-food-sent">Gold sent</div>
          <div class="sys-window k-info intro-win"><span class="cb"></span>
            <div class="n-tag">! System</div>
            <h2 class="n-big sys-title">${esc(card.label)}</h2>
            <ul class="intro-win-rows">
              ${INTRO_FOOD_ITEMS.map(item => `<li>${esc(item)}</li>`).join('')}
            </ul>
          </div>
        </div>`;
      case 'call':
        return `<div class="sys-window k-info intro-win intro-call-win"${roleAttr}><span class="cb"></span>
          <div class="n-tag">! System</div>
          <h2 class="n-big sys-title">${esc(card.label)}</h2>
        </div>`;
    }
  }

  /** Renders the stage body for any card: type-only stand-in for art cards (Units 1 to 3), System window or city list for window/type cards. */
  function cardStageHtml(card, thumb = false) {
    if (card.kind !== 'art') return windowCardHtml(card, thumb);
    const imgPath = introImagePath(card);
    const imgAttr = imgPath ? ` data-intro-image="${esc(imgPath)}"` : '';
    const artReady = INTRO_ART_READY && imgPath ? ' data-art-ready="true"' : '';
    const roleAttr = thumb ? ' aria-hidden="true"' : ` role="img" aria-label="${esc(card.alt)}"`;
    return `<div class="intro-standin intro-acc-${card.accent}"${roleAttr}${imgAttr}${artReady}>
      <div class="intro-standin-label">${esc(card.label)}</div>
    </div>`;
  }

  /** Screen Wake Lock: request while open and re-request when returning to foreground. */
  function acquireWakeLock() {
    if (!refs || refs.wakeLock) return;
    if (typeof navigator === 'undefined' || !navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') return;
    navigator.wakeLock.request('screen').then(
      sentinel => {
        if (!refs) {
          sentinel.release().catch(() => { /* wake lock already released by browser */ });
          return;
        }
        refs.wakeLock = sentinel;
        sentinel.addEventListener('release', () => {
          if (refs && refs.wakeLock === sentinel) refs.wakeLock = null;
        });
      },
      () => { /* wake lock unsupported or denied on this browser */ },
    );
  }

  function releaseWakeLock() {
    if (!refs || !refs.wakeLock) return;
    const sentinel = refs.wakeLock;
    refs.wakeLock = null;
    sentinel.release().catch(() => { /* wake lock already released by browser */ });
  }

  const currentView = () => introViewFor(state, app.seat(), app.api.sync.doc('intro'));

  function handleKey(e) {
    if (!refs) return;
    if (e.key === 'Tab') { trapTab(e, refs.overlay); return; }
    const v = currentView();
    if (e.key === 'Escape') {
      if (v.kind === 'solo') { e.preventDefault(); e.stopPropagation(); closeSolo(); }
      else if (v.kind === 'player' && v.run) { e.preventDefault(); e.stopPropagation(); dismissPlayer(v.run); }
      return;
    }
    if (v.kind === 'solo') {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); stepSolo(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepSolo(-1); }
    }
  }

  function ensureOverlay() {
    if (refs) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = h('<div class="intro-overlay show" role="dialog" aria-modal="true" aria-label="World primer"></div>');
    const win = openWindow('intro', () => {
      document.body.appendChild(overlay);
      return { root: overlay, win: overlay };
    }, handleKey);
    refs = { overlay, win, returnFocus, wakeLock: null };
    acquireWakeLock();
    overlay.addEventListener('click', e => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;
      const v = currentView();
      if (t.closest('[data-intro-close]')) {
        if (v.kind === 'solo') closeSolo();
        else if (v.kind === 'player' && v.run) dismissPlayer(v.run);
        return;
      }
      if (t.closest('[data-intro-done]')) { closeSolo(); return; }
      if (t.closest('[data-intro-end]') || t.closest('[data-intro-end-primary]')) { void endTable(); return; }
      if (t.closest('[data-intro-next]')) { void stepGm(1); return; }
      if (t.closest('[data-intro-back]')) {
        if (v.kind === 'solo') stepSolo(-1);
        else if (v.kind === 'gm') void stepGm(-1);
        return;
      }
      if (t.closest('[data-intro-answer]')) { answerCall(); return; }
      if (t.closest('[data-intro-stage]') && !t.closest('button, a, input, select, textarea')) {
        if (v.kind === 'solo') stepSolo(1);
      }
    });
  }

  function teardownOverlay() {
    if (!refs) return;
    releaseWakeLock();
    const { win, returnFocus } = refs;
    refs = null;
    closeWindow(win);
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
  }

  function animateCard(container, card) {
    if (card.window === 'cities') {
      const rows = [...container.querySelectorAll('[data-intro-city]')];
      void staggerReveal(rows);
    }
  }

  /** The hunter this player phone speaks for in the room (bound hunter, falling back to active). */
  const roomHunter = () => app.api.sync.bound() || app.store.active();

  /** Whether the active hunter on this player phone has answered card 16 for `run`. */
  function playerHasAnswered(run, doc) {
    if (state.localAnsweredRun === run) return true;
    const h = roomHunter();
    if (!h || !doc?.intro) return false;
    const myKey = app.api.sync.myKey(h.id);
    return doc.intro.answered.some(a => a.key === myKey);
  }

  function answeredLine(doc) {
    const list = doc?.intro?.answered ?? [];
    if (!list.length) return 'No answers yet.';
    return `Answered (${list.length}): ${list.map(a => a.name).join(', ')}`;
  }

  function paintRejoin(v) {
    const bar = document.getElementById('intro-rejoin');
    if (!bar) return;
    if (!v.showRejoin) {
      bar.hidden = true;
      return;
    }
    if (!bar.querySelector('[data-intro-rejoin]')) {
      bar.innerHTML = '<span>Intro in progress</span><button type="button" class="primary" data-intro-rejoin>Rejoin</button>';
    }
    bar.hidden = false;
  }

  function paint() {
    const doc = app.api.sync.doc('intro');
    const v = introViewFor(state, app.seat(), doc);
    paintRejoin(v);
    if (v.kind === 'off') {
      if (state.renderedKey) state = { ...state, renderedKey: '' };
      teardownOverlay();
      return;
    }
    ensureOverlay();
    const card = INTRO_CARDS[v.card];
    const key = `${v.kind}:${v.run ?? ''}:${card.index}`;
    if (state.renderedKey === key) {
      // Update only Card 16 Answer UI without rebuilding the stage DOM on 1 s polls.
      if (card.index === INTRO_STORY_COUNT && v.kind === 'gm') {
        const box = refs.overlay.querySelector('[data-intro-answered]');
        const line = answeredLine(doc);
        if (box && box.textContent !== line) box.textContent = line;
      } else if (card.index === INTRO_STORY_COUNT && v.kind === 'player' && v.run) {
        const btn = refs.overlay.querySelector('[data-intro-answer]');
        if (btn instanceof HTMLButtonElement) {
          const done = playerHasAnswered(v.run, doc);
          btn.disabled = done;
          btn.textContent = done ? 'Answered' : 'Answer';
        }
      }
      return;
    }
    state = { ...state, renderedKey: key };
    const counter = introCardCounter(card.index);
    const isFirst = card.index === 0;
    const isLast = card.index === INTRO_STORY_COUNT;

    if (v.kind === 'solo') {
      const slice = introSliceOf(card.index);
      refs.overlay.innerHTML = `<div class="intro-shell intro-solo">
        <div class="intro-bar">
          <span class="intro-count" data-intro-count>${esc(counter)}</span>
          <div class="intro-bar-act">
            <button type="button" class="intro-btn" data-intro-back aria-label="Previous card"${isFirst ? ' disabled' : ''}>Back</button>
            ${isLast ? '<button type="button" class="intro-btn primary" data-intro-done>Done</button>' : ''}
            <button type="button" class="intro-btn" data-intro-close aria-label="Close intro">Close</button>
          </div>
        </div>
        <div class="intro-stage" data-intro-stage data-intro-card="${card.index}">
          ${cardStageHtml(card)}
        </div>
        ${slice ? `<div class="intro-caption" data-intro-caption><p>${esc(slice.current)}</p></div>` : ''}
      </div>`;
      animateCard(refs.overlay, card);
    } else if (v.kind === 'player') {
      const hasHunter = !!roomHunter();
      const answered = isLast && v.run ? playerHasAnswered(v.run, doc) : false;
      refs.overlay.innerHTML = `<div class="intro-shell intro-player">
        <div class="intro-bar intro-player-bar">
          <button type="button" class="intro-btn" data-intro-close aria-label="Close intro">Close</button>
        </div>
        <div class="intro-stage intro-player-stage" data-intro-stage data-intro-card="${card.index}">
          <div class="intro-stage-inner">
            ${cardStageHtml(card)}
            ${isLast && hasHunter ? `<div class="intro-call-act"><button type="button" class="primary intro-answer-btn" data-intro-answer${answered ? ' disabled' : ''}>${answered ? 'Answered' : 'Answer'}</button></div>` : ''}
          </div>
        </div>
      </div>`;
      animateCard(refs.overlay, card);
    } else {
      const slice = introSliceOf(card.index);
      const readHtml = slice
        ? `<p>${esc(slice.before)}<mark class="intro-hl">${esc(slice.raw)}</mark>${esc(slice.after)}</p>`
        : '<p class="intro-gm-note">Title card is up. Tap Next when everyone is ready.</p>';
      refs.overlay.innerHTML = `<div class="intro-shell intro-gm">
        <div class="intro-bar">
          <span class="intro-count" data-intro-count>${esc(counter)}</span>
          <div class="intro-bar-act">
            <button type="button" class="intro-btn" data-intro-end>End intro</button>
          </div>
        </div>
        <div class="intro-gm-preview" aria-label="Player preview">
          <div class="intro-thumb" data-intro-thumb data-intro-card="${card.index}">
            <div class="intro-thumb-scale">${cardStageHtml(card, true)}</div>
          </div>
          <div class="intro-gm-meta">
            <div class="intro-gm-label">${esc(card.label)}</div>
            ${isLast ? `<div class="intro-gm-answered" role="status" data-intro-answered>${esc(answeredLine(doc))}</div>` : ''}
          </div>
        </div>
        <div class="intro-gm-read" data-intro-read>${readHtml}</div>
        <div class="intro-gm-controls">
          <button type="button" class="intro-btn intro-gm-back" data-intro-back aria-label="Previous card"${isFirst ? ' disabled' : ''}>Back</button>
          ${isLast
            ? '<button type="button" class="primary intro-btn intro-gm-next" data-intro-end-primary>End intro</button>'
            : '<button type="button" class="primary intro-btn intro-gm-next" data-intro-next aria-label="Next card">Next</button>'}
        </div>
      </div>`;
    }

    if (!refs.overlay.contains(document.activeElement)) {
      const target = refs.overlay.querySelector('[data-intro-next], [data-intro-end-primary], [data-intro-close]');
      if (target instanceof HTMLElement) target.focus();
    }
  }

  function openSolo() {
    state = soloOpen(state, 0);
    paint();
  }

  function stepSolo(delta) {
    state = soloStep(state, delta);
    paint();
  }

  function closeSolo() {
    state = soloClose(state);
    paint();
  }

  function dismissPlayer(run) {
    state = introDismiss(state, run);
    paint();
  }

  async function startTable() {
    if (app.seat() !== 'gm') return;
    const st = app.api.sync.stamp();
    const run = `i-${st.device}-${st.now.toString(36)}-${Math.floor(st.rand * 1e6).toString(36)}`;
    state = soloClose(state);
    await app.api.sync.setIntro(introStart(run, new Date().toISOString()));
    paint();
  }

  async function stepGm(delta) {
    if (app.seat() !== 'gm') return;
    if (delta > 0) {
      const nowMs = Date.now();
      if (!canTapNext(state.lastGmTapAt, nowMs)) return;
      state = introMarkGmTap(state, nowMs);
    }
    const next = introStep(app.api.sync.doc('intro'), delta, new Date().toISOString());
    if (!next) return;
    await app.api.sync.setIntro(next);
    paint();
  }

  async function endTable() {
    if (app.seat() !== 'gm') return;
    await app.api.sync.setIntro(introEnd(new Date().toISOString()));
    paint();
  }

  function answerCall() {
    if (app.seat() !== 'player') return;
    const doc = app.api.sync.doc('intro');
    if (!doc?.intro || doc.intro.card !== INTRO_STORY_COUNT) return;
    const run = doc.intro.run;
    if (playerHasAnswered(run, doc)) return;
    const h = roomHunter();
    if (!h) return;
    state = introMarkLocalAnswer(state, run);
    const ev = app.api.sync.event('introAnswer', { by: app.api.sync.myKey(h.id), name: h.name, run });
    app.api.sync.post(ev);
    paint();
  }

  const rejoinBar = document.getElementById('intro-rejoin');
  if (rejoinBar) {
    rejoinBar.addEventListener('click', e => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t || !t.closest('[data-intro-rejoin]')) return;
      state = introRejoin(state);
      paint();
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && refs) acquireWakeLock();
  });

  app.on('sync:docs', paint);
  app.on('sync:room', paint);
  app.on('sync:status', paint);
  app.on('change', paint);
  app.on('sync:event', ({ event }) => {
    if (event.type === 'introAnswer' && app.seat() === 'gm') {
      const p = event.payload;
      const next = introRecordAnswer(app.api.sync.doc('intro'), { key: p.by, name: p.name }, p.run, new Date().toISOString());
      if (next) void app.api.sync.setIntro(next);
    } else if (event.type === 'chapter' && app.seat() === 'player') {
      const cur = app.api.sync.doc('intro');
      if (cur?.intro) {
        state = introSupersede(state, cur.intro.run);
        paint();
      }
    }
  });

  app.api.intro = {
    openSolo,
    startTable,
  };
}
