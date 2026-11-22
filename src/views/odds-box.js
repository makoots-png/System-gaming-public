// odds-box.js: the one control that plays a fight out for its odds (src/core/combat/odds.ts) and draws the answer: the
// GM's fight screen (combat.js) and a player's solo gates (gates.js) mount it. Each box has a key; the engine plays on a
// worker thread (src/edge/odds-run.ts) while the box draws its count, then one line that is the "More info" control of
// its detail. Each box holds a fight with the rules it is played by (odds.ts `Weighed`): the GM's fight by this phone's
// rules, a solo gate's by the rules `soloFight` gave it. A fight or rules that change mark the answer stale and drop a
// run under way.
// It writes nothing: the run of each box is page memory, never the save. Every sentence is core's (`ODDS_WORDS`).
import { IDLE, ODDS_RUNS, ODDS_WORDS, oddsHint, oddsKey, oddsLine, oddsStep, progressOf, readOdds } from '../core/combat/odds.ts';
import { playAway } from '../edge/odds-run.ts';
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
   * Each box on screen by its key: the engine's run asked there (odds.ts: idle, running, done, stale), the worker playing
   * it and the count it last sent, the fight it is drawn for now with its rules, what its run was asked of (the fight's
   * `oddsKey` and the rules), who its words speak to (odds.ts `OddsVoice`), its element, and who waits for its answer
   * (`ask`). Page memory, never the save.
   * @type {Map<string, { run: import('../core/combat/odds.ts').OddsRun, away: { stop(): void } | null, count: import('../edge/odds-run.ts').OddsCount | null, weighed: import('../core/combat/odds.ts').Weighed | null, asked: { fight: string, R: import('../core/rules.ts').Rules } | null, voice: import('../core/combat/odds.ts').OddsVoice, el: HTMLElement | null, waiting: ((r: import('../core/combat/odds.ts').OddsRead | null) => void)[] }>}
   */
  const boxes = new Map();
  const boxOf = key => { let b = boxes.get(key); if (!b) { b = { run: IDLE, away: null, count: null, weighed: null, asked: null, voice: 'party', el: null, waiting: [] }; boxes.set(key, b); } return b; };
  /**
   * Whether box `b`'s run was asked of `weighed`: the same fight (`oddsKey`) by the same rules, the same object or alike
   * as JSON. Rules alike are kept as the newer object, so the next draw compares them by reference: this phone's rules
   * are a new object after each write of the save (edge/rules.ts), and a GM's library as JSON costs milliseconds a draw.
   */
  function askedOf(b, weighed) {
    if (!weighed || !b.asked || b.asked.fight !== oddsKey(weighed.fight)) return false;
    if (b.asked.R !== weighed.R && JSON.stringify(b.asked.R) !== JSON.stringify(weighed.R)) return false;
    b.asked = { fight: b.asked.fight, R: weighed.R };
    return true;
  }
  /** The rules box `b` plays by: its fight's, or this phone's when it has none. */
  const rulesOf = b => (b.weighed ? b.weighed.R : rules());
  /** Who waits for box `key`'s answer hears it once the run is done, or null when it stopped or the fight changed. */
  function answer(key) {
    const b = boxes.get(key); if (!b || b.run.state === 'running' || !b.waiting.length) return;
    const read = b.run.state === 'done' ? readOdds(b.run.odds) : null, waiting = b.waiting;
    b.waiting = [];
    for (const w of waiting) w(read);
  }

  /** The worker of box `b` ended: a run that stopped or changed since is no longer its. */
  function halt(b) {
    if (b.away) b.away.stop();
    b.away = null; b.count = null;
  }
  /** The box: the control, the count while it plays, or the line with its detail (and the mark when the fight changed). */
  function draw(key) {
    const b = boxes.get(key), box = b && b.el;
    if (!box) return;
    box.hidden = !b.weighed;
    if (box.hidden) return;
    const run = b.run, p = run.state === 'running' ? b.count ?? progressOf(run, b.weighed.R) : null, D = app.api.detail;
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
    const box = boxOf(key), w = box.weighed;
    if (!w) return;
    const seed = oddsSeed();
    halt(box);
    box.asked = { fight: oddsKey(w.fight), R: w.R };
    box.run = oddsStep(box.run, { type: 'ask', fight: w.fight, seed, of: ODDS_RUNS }, w.R);
    const away = playAway({ fight: w.fight, R: w.R, seed, of: ODDS_RUNS }, count => { box.count = count; }, run => {
      if (box.away !== away) return;
      box.away = null; box.count = null;
      box.run = run ?? IDLE;
      draw(key);
      answer(key);
    });
    box.away = away;
    draw(key);
    // the count is drawn once a frame at most, the newest the worker sent: a slow phone hears several between two frames
    const frame = shown => {
      if (box.away !== away) return;
      const count = box.count;
      if (count !== shown) draw(key);
      requestAnimationFrame(() => frame(count));
    };
    requestAnimationFrame(() => frame(null));
  }
  /** Ask (play it out) or Stop, pressed in a box. */
  function pressed(key, b) {
    if (b.hasAttribute('data-odds-ask')) play(key);
    else if (b.hasAttribute('data-odds-stop')) { const box = boxOf(key); halt(box); box.run = oddsStep(box.run, { type: 'cancel' }, rulesOf(box)); draw(key); answer(key); }
  }

  /**
   * Draws box `key` in `el` for `weighed`, a fight with the rules it plays by (null hides it), its words in `voice`.
   * @param {HTMLElement} el @param {string} key @param {import('../core/combat/odds.ts').Weighed | null} weighed @param {import('../core/combat/odds.ts').OddsVoice} voice
   */
  function show(el, key, weighed, voice) {
    const b = boxOf(key);
    b.voice = voice;
    if (b.el !== el) {
      b.el = el;
      el.classList.add('odds-box');
      el.addEventListener('click', e => { const t = e.target instanceof Element ? e.target.closest('[data-odds-ask],[data-odds-stop]') : null; if (t && el.contains(t)) pressed(key, t); });
    }
    // an answer for a fight or rules that changed since is marked stale, a run under way for them is dropped: the
    // machine compares fights only, so a change of either is told as a key no fight has
    if (b.run.state !== 'idle' && !askedOf(b, weighed)) b.run = oddsStep(b.run, { type: 'changed', from: '' }, rulesOf(b));
    b.weighed = weighed;
    if (b.run.state !== 'running') halt(b);
    draw(key);
    answer(key);
  }

  /** @type {import('../core/api.ts').OddsApi} */
  app.api.odds = {
    paint: (el, key, fight, voice) => show(el, key, fight ? { fight, R: rules() } : null, voice),
    paintSolo: (el, key, made) => show(el, key, made, 'alone'),
    ask(key) {
      const b = boxOf(key);
      if (b.run.state === 'done') return Promise.resolve(readOdds(b.run.odds));
      if (!b.weighed) return Promise.resolve(null);
      const heard = new Promise(resolve => { b.waiting.push(resolve); });
      if (b.run.state !== 'running') play(key);
      return heard;
    },
  };
}
