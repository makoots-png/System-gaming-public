// difficulty-control.js: stateless HTML builders, live readout wiring, and edit-form event reader for gate and boss
// difficulty sliders. Keeps zero module-level state.
import {
  DIFFICULTY_DEFAULT,
  DIFFICULTY_MAX,
  DIFFICULTY_MIN,
  DIFFICULTY_WORDS,
  parseDifficultyLevel,
} from '../core/gates/difficulty.ts';

/** Normalizes a rule or form number to a valid `DifficultyLevel`. */
const safeLevel = (v, R) =>
  parseDifficultyLevel(Number(v)) ?? parseDifficultyLevel(R.fight.difficulty.default) ?? DIFFICULTY_DEFAULT;

/** Escapes HTML attribute and text content. */
function escHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders one gate difficulty slider with a full self-explaining readout and an optional Reset-to-default button
 * (included when `isSet` is a boolean, i.e., in the Edit panel).
 * @param {{ idPrefix: string; inputId?: string; name: string; label: string; level: number; isSet?: boolean; R: import('../core/rules.ts').Rules }} o
 */
export function difficultySliderHtml({ idPrefix, inputId, name, label, level, isSet, R }) {
  const lvl = safeLevel(level, R);
  const id = inputId || `${idPrefix}-diff`;
  const outId = `${id}-out`;
  const text = DIFFICULTY_WORDS.gateReadout(lvl, R);
  const resetBtn = isSet !== undefined
    ? `<button type="button" class="diff-reset" data-diff-reset${isSet ? '' : ' hidden'}>${escHtml(DIFFICULTY_WORDS.resetLabel(R))}</button>`
    : '';
  return `<div class="diff-ctl" data-diff-ctl="gate" data-diff-set="${isSet ? '1' : '0'}">
    <div class="diff-head"><label class="lbl" for="${escHtml(id)}">${escHtml(label)}</label>${resetBtn}</div>
    <input type="range" id="${escHtml(id)}" name="${escHtml(name)}" min="${DIFFICULTY_MIN}" max="${DIFFICULTY_MAX}" step="1" value="${lvl}" aria-describedby="${escHtml(outId)}" aria-valuetext="${escHtml(text)}" data-diff-range="gate">
    <output class="diff-read" id="${escHtml(outId)}" for="${escHtml(id)}" data-diff-out="gate">${escHtml(text)}</output>
  </div>`;
}

/**
 * Renders the boss difficulty override checkbox, conditional boss range slider, and live readout for the Edit panel.
 * @param {{ idPrefix: string; gateLevel: import('../core/gates/difficulty.ts').DifficultyLevel; bossTrack: import('../core/gates/difficulty.ts').BossTrack; hasBoss: boolean; R: import('../core/rules.ts').Rules }} o
 */
export function bossDifficultyHtml({ idPrefix, gateLevel, bossTrack, hasBoss, R }) {
  const own = bossTrack.at === 'own';
  const bossLevel = own ? bossTrack.level : gateLevel;
  const chkId = `${idPrefix}-bdiff-on`;
  const rangeId = `${idPrefix}-bdiff`;
  const outId = `${rangeId}-out`;
  const ownText = DIFFICULTY_WORDS.bossOwnReadout(bossLevel, R);
  const readout = own ? ownText : DIFFICULTY_WORDS.bossFollowReadout(gateLevel, R);
  return `<div class="diff-ctl diff-boss" data-diff-ctl="boss"${hasBoss ? '' : ' hidden'}>
    <label class="gt-chk diff-chk" for="${escHtml(chkId)}"><input type="checkbox" id="${escHtml(chkId)}" name="bossDifficultyOn" data-diff-boss-on${own ? ' checked' : ''}><span>${escHtml(DIFFICULTY_WORDS.bossToggle)}</span></label>
    <div class="diff-boss-body" data-diff-boss-body${own ? '' : ' hidden'}>
      <label class="lbl" for="${escHtml(rangeId)}">${escHtml(DIFFICULTY_WORDS.bossLabel)}</label>
      <input type="range" id="${escHtml(rangeId)}" name="bossDifficulty" min="${DIFFICULTY_MIN}" max="${DIFFICULTY_MAX}" step="1" value="${bossLevel}" aria-describedby="${escHtml(outId)}" aria-valuetext="${escHtml(ownText)}" data-diff-range="boss">
    </div>
    <output class="diff-read" id="${escHtml(outId)}" data-diff-out="boss">${escHtml(readout)}</output>
  </div>`;
}

/**
 * Attaches delegated live input/change/click handlers on `root` so difficulty sliders, boss override toggles, reset
 * buttons, and boss select switches update their readouts immediately.
 * @param {HTMLElement} root
 * @param {() => import('../core/rules.ts').Rules} rulesOf
 */
export function wireDifficultyLive(root, rulesOf) {
  const levelOf = (input, R) => safeLevel(input?.value, R);

  const syncBoss = (scope, R) => {
    const bossCtl = scope && scope.querySelector('[data-diff-ctl="boss"]');
    if (!bossCtl) return;
    const chk = bossCtl.querySelector('[data-diff-boss-on]');
    const body = bossCtl.querySelector('[data-diff-boss-body]');
    const bRange = bossCtl.querySelector('[data-diff-range="boss"]');
    const bOut = bossCtl.querySelector('[data-diff-out="boss"]');
    const gRange = scope.querySelector('[data-diff-range="gate"]');
    const gateLevel = levelOf(gRange, R);
    const own = !!(chk && chk.checked);
    if (body) body.hidden = !own;
    if (!own && bRange) bRange.value = String(gateLevel);
    const bossLevel = own ? levelOf(bRange, R) : gateLevel;
    const ownText = DIFFICULTY_WORDS.bossOwnReadout(bossLevel, R);
    if (bRange) bRange.setAttribute('aria-valuetext', ownText);
    if (bOut) bOut.textContent = own ? ownText : DIFFICULTY_WORDS.bossFollowReadout(gateLevel, R);
  };

  const onGateMove = (input, markSet) => {
    const R = rulesOf();
    const ctl = input.closest('[data-diff-ctl="gate"]');
    const level = levelOf(input, R);
    const text = DIFFICULTY_WORDS.gateReadout(level, R);
    input.setAttribute('aria-valuetext', text);
    const out = ctl && ctl.querySelector('[data-diff-out="gate"]');
    if (out) out.textContent = text;
    if (ctl && markSet) {
      ctl.dataset.diffSet = '1';
      const reset = ctl.querySelector('[data-diff-reset]');
      if (reset) reset.hidden = false;
    }
    syncBoss(input.closest('form') || ctl?.parentElement, R);
  };

  root.addEventListener('input', e => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (t.dataset.diffRange === 'gate') onGateMove(t, true);
    else if (t.dataset.diffRange === 'boss') syncBoss(t.closest('form') || t.closest('[data-diff-ctl="boss"]')?.parentElement, rulesOf());
  });

  root.addEventListener('change', e => {
    const t = e.target;
    if (t instanceof HTMLInputElement) {
      if (t.dataset.diffRange === 'gate') onGateMove(t, true);
      else if (t.dataset.diffRange === 'boss' || t.dataset.diffBossOn !== undefined) {
        syncBoss(t.closest('form') || t.closest('[data-diff-ctl="boss"]')?.parentElement, rulesOf());
      }
      return;
    }
    if (t instanceof HTMLSelectElement && t.name === 'boss') {
      const form = t.closest('form');
      const bossCtl = form && form.querySelector('[data-diff-ctl="boss"]');
      if (!bossCtl) return;
      const hasBoss = !!t.value;
      bossCtl.hidden = !hasBoss;
      if (!hasBoss) {
        const chk = bossCtl.querySelector('[data-diff-boss-on]');
        if (chk) chk.checked = false;
      }
      syncBoss(form, rulesOf());
    }
  });

  root.addEventListener('click', e => {
    const btn = e.target instanceof Element ? e.target.closest('[data-diff-reset]') : null;
    if (!btn) return;
    const ctl = btn.closest('[data-diff-ctl="gate"]');
    const input = ctl && ctl.querySelector('[data-diff-range="gate"]');
    if (!input) return;
    const R = rulesOf();
    input.value = String(R.fight.difficulty.default);
    ctl.dataset.diffSet = '0';
    btn.hidden = true;
    onGateMove(input, false);
  });
}

/**
 * Translates an Edit form's difficulty controls into ordered `DifficultyEvent`s relative to `current`.
 * @param {{ querySelector: ParentNode['querySelector']; boss?: { value?: string } }} form
 * @param {import('../core/gates/difficulty.ts').GateDifficulty} current
 * @param {import('../core/rules.ts').Rules} R
 * @returns {import('../core/gates/difficulty.ts').DifficultyEvent[]}
 */
export function readEditDifficultyEvents(form, current, R) {
  /** @type {import('../core/gates/difficulty.ts').DifficultyEvent[]} */
  const events = [];
  const gateCtl = form.querySelector('[data-diff-ctl="gate"]');
  const gateInput = form.querySelector('[data-diff-range="gate"]');
  if (gateCtl && gateInput) {
    if (gateCtl.dataset.diffSet === '0') {
      if (current.gate.at === 'set') events.push({ type: 'resetGate' });
    } else {
      const level = safeLevel(gateInput.value, R);
      if (current.gate.at !== 'set' || current.gate.level !== level) {
        events.push({ type: 'setGate', level });
      }
    }
  }
  const hasBoss = !!(form.boss && form.boss.value);
  if (hasBoss) {
    const chk = form.querySelector('[data-diff-boss-on]');
    const bossInput = form.querySelector('[data-diff-range="boss"]');
    if (chk && chk.checked) {
      const level = safeLevel(bossInput?.value, R);
      if (current.boss.at !== 'own' || current.boss.level !== level) {
        events.push({ type: 'setBoss', level });
      }
    } else if (current.boss.at === 'own') {
      events.push({ type: 'followGate' });
    }
  }
  return events;
}
