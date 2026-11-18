// odds-box.js: the one control that plays a fight out for its odds (src/core/combat/odds.ts) and draws the answer: the
// GM's fight screen (combat.js) and a player's solo gates (gates.js) mount it. Each box has a key; the engine plays a few
// commands a frame for `ODDS_FRAME_MS` (read from the clock here, as core has none) with its real count, then one line
// that is the "More info" control of its detail. A fight that changes marks the answer stale and drops a run under way.
// It writes nothing: the run of each box is page memory, never the save. Every sentence is core's (`ODDS_WORDS`).
import { IDLE, ODDS_FRAME_MS, ODDS_RUNS, ODDS_WORDS, oddsHint, oddsKey, oddsLine, oddsStep, progressOf, readOdds } from '../core/combat/odds.ts';
import { oddsSeed } from '../edge/roll.ts';
import { rules } from '../edge/rules.ts';
import * as motion from './motion.ts';

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { ui } = app, esc = ui.esc;
  ui.css('odds-box', `
.odds-box{margin:12px 0 0;display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-width:0}
.odds-box .hint,.odds-stale{font-size:13px;color:var(--cyan-dim);margin:0}
.odds-line{text-align:left;white-space:normal;min-height:var(--control-h);max-width:100%;overflow-wrap:anywhere}
.odds-line.stale{opacity:.6}
.odds-run{display:flex;align-items:center;gap:10px;width:100%;min-width:0}
.odds-run [data-oddsprog]{flex:1;min-width:0}
`);
  /**
   * Each box on screen by its key: the engine's run asked there (odds.ts: idle, running with its count, done, stale), the
   * fight it is drawn for now, who its words speak to (odds.ts `OddsVoice`), its element, and who waits for its answer
   * (`ask`). Page memory, never the save.
   * @type {Map<string, { run: import('../core/combat/odds.ts').OddsRun, fight: import('../core/combat/fight-types.ts').Setup | import('../core/combat/fight-types.ts').Running | null, voice: import('../core/combat/odds.ts').OddsVoice, el: HTMLElement | null, waiting: ((r: import('../core/combat/odds.ts').OddsRead | null) => void)[] }>}
   */
  const boxes = new Map();
  const boxOf = key => { let b = boxes.get(key); if (!b) { b = { run: IDLE, fight: null, voice: 'party', el: null, waiting: [] }; boxes.set(key, b); } return b; };
  /** Who waits for box `key`'s answer hears it once the run is done, or null when it stopped or the fight changed. */
  function answer(key) {
    const b = boxes.get(key); if (!b || b.run.state === 'running' || !b.waiting.length) return;
    const read = b.run.state === 'done' ? readOdds(b.run.odds) : null, waiting = b.waiting;
    b.waiting = [];
    for (const w of waiting) w(read);
  }

  /** A few commands of the engine this frame, `ODDS_FRAME_MS` of it, until it answers; then the next frame. */
  function frame(key) {
    const b = boxes.get(key);
    if (!b || b.run.state !== 'running') return;
    const until = performance.now() + ODDS_FRAME_MS;
    while (b.run.state === 'running' && performance.now() < until) b.run = oddsStep(b.run, { type: 'step', commands: 1 }, rules());
    draw(key);
    if (b.run.state === 'running') requestAnimationFrame(() => frame(key)); else answer(key);
  }
  /** The box: the control, the count while it plays, or the line with its detail (and the mark when the fight changed). */
  function draw(key) {
    const b = boxes.get(key), box = b && b.el;
    if (!box) return;
    box.hidden = !b.fight;
    if (box.hidden) return;
    const run = b.run, p = progressOf(run, rules()), D = app.api.detail;
    if (p) {
      if (box.dataset.state !== 'running') { box.dataset.state = 'running'; box.innerHTML = `<div class="odds-run"><div data-oddsprog></div><button type="button" class="quiet" data-fk="odds-stop" data-odds-stop>${esc(ODDS_WORDS.stop)}</button></div>`; }
      motion.progress(box.querySelector('[data-oddsprog]'), p.done / p.of, ODDS_WORDS.running(p.done, p.of));
      return;
    }
    const read = run.state === 'done' || run.state === 'stale' ? readOdds(run.odds) : null;
    const html = !read ? `<button type="button" data-fk="odds-ask" data-odds-ask>${esc(ODDS_WORDS.ask)}</button><p class="hint">${esc(oddsHint(b.voice))}</p>`
      : `${run.state === 'stale' ? `<p class="odds-stale" role="status">${esc(ODDS_WORDS.stale)}</p>` : ''}<button type="button" class="odds-line${run.state === 'stale' ? ' stale' : ''}" data-oddsline ${D.control('odds', key)}>${esc(oddsLine(read, b.voice))}</button>`
        + `${D.panel('odds', key, { kind: 'odds', odds: read, voice: b.voice })}<button type="button" data-fk="odds-ask" data-odds-ask>${esc(ODDS_WORDS.again)}</button>`;
    if (box.dataset.state !== run.state || box.dataset.sig !== html) { box.dataset.state = run.state; box.dataset.sig = html; box.innerHTML = html; }
  }
  /** Plays box `key`'s fight out from the start. */
  function play(key) {
    const box = boxOf(key);
    if (!box.fight) return;
    box.run = oddsStep(box.run, { type: 'ask', fight: box.fight, seed: oddsSeed(), of: ODDS_RUNS }, rules());
    draw(key);
    requestAnimationFrame(() => frame(key));
  }
  /** Ask (play it out) or Stop, pressed in a box. */
  function pressed(key, b) {
    if (b.hasAttribute('data-odds-ask')) play(key);
    else if (b.hasAttribute('data-odds-stop')) { const box = boxOf(key); box.run = oddsStep(box.run, { type: 'cancel' }, rules()); draw(key); answer(key); }
  }

  /** @type {import('../core/api.ts').OddsApi} */
  app.api.odds = {
    paint(el, key, fight, voice) {
      const b = boxOf(key);
      b.voice = voice;
      if (b.el !== el) {
        b.el = el;
        el.classList.add('odds-box');
        el.addEventListener('click', e => { const t = e.target instanceof Element ? e.target.closest('[data-odds-ask],[data-odds-stop]') : null; if (t && el.contains(t)) pressed(key, t); });
      }
      b.fight = fight;
      // an answer for a fight that has changed since is marked stale, a run under way for one is dropped
      if (b.run.state !== 'idle') b.run = oddsStep(b.run, { type: 'changed', from: fight ? oddsKey(fight) : '' }, rules());
      draw(key);
      answer(key);
    },
    ask(key) {
      const b = boxOf(key);
      if (b.run.state === 'done') return Promise.resolve(readOdds(b.run.odds));
      if (!b.fight) return Promise.resolve(null);
      const heard = new Promise(resolve => { b.waiting.push(resolve); });
      if (b.run.state !== 'running') play(key);
      return heard;
    },
  };
}
