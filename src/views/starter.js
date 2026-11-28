// starter.js: the starter campaign's view half. `starterStep` is the one step that writes the whole starter campaign
// (src/core/starter.ts `starterCampaign`), used by first-run onboarding and by `loadStarterCampaign`, which the GM's
// Stories section and Room lobby entry points call after setup.
import {
  STARTER_REFUSAL_WORDS,
  STARTER_WORDS,
  starterCampaign,
  starterConfirmBody,
  starterLoadedMessage,
  starterMissing,
} from '../core/starter.ts';

const STYLE = `
.st-load-opt{text-align:left;margin:4px 0 6px}
.st-load-check{display:flex;align-items:center;gap:10px;min-height:44px;padding:8px 12px;box-sizing:border-box;border:1px solid var(--line);background:rgba(10,26,46,.45);color:var(--ice);font-size:14px;line-height:1.35;cursor:pointer}
.st-load-check input{width:20px;height:20px;min-height:20px;margin:0;flex:none;accent-color:var(--cyan)}
.st-load-help{display:block;margin-top:4px;font-size:13px;color:var(--cyan-dim)}
`;

/**
 * The step that loads the starter campaign, for `store.apply`.
 * @param {import('./app.ts').App} app
 * @param {import('../core/starter.ts').StarterOptions} [options]
 * @returns {import('../core/save-step.ts').Step<import('../core/save.ts').Save>}
 */
export function starterStep(app, options) {
  const R = app.rules();
  return s => starterCampaign(s, { at: new Date().toISOString(), cap: R.logCap }, R, options);
}

/**
 * Prompts a GM who already finished setup to load missing starter campaign pieces (with the optional 4 sample hunters
 * checkbox), then applies `starterStep` in one write and tells what was added or why nothing changed.
 * @param {import('./app.ts').App} app
 * @returns {Promise<boolean>}
 */
export async function loadStarterCampaign(app) {
  const { store, ui } = app;
  const { esc } = ui;
  ui.css('starter', STYLE);

  const missingAll = starterMissing(store.get(), { includePregens: true });
  if (!missingAll.story && !missingAll.gate && missingAll.pregens.length === 0) {
    const r = store.apply('starter-load', starterStep(app, { includePregens: true }));
    return ui.wrote('Starter campaign', r, STARTER_REFUSAL_WORDS);
  }

  const choice = { includePregens: missingAll.pregens.length > 0 };
  const html = choice.includePregens
    ? `<div class="st-load-opt">
        <label class="st-load-check"><input type="checkbox" data-starter-pregens checked aria-describedby="st-load-pregens-help"><span>${esc(STARTER_WORDS.pregensLabel)}</span></label>
        <small class="st-load-help" id="st-load-pregens-help">${esc(STARTER_WORDS.pregensHelp)}</small>
      </div>`
    : '';
  const go = await ui.system({
    tag: STARTER_WORDS.tag,
    title: STARTER_WORDS.title,
    body: starterConfirmBody(missingAll),
    ...(html ? { html } : {}),
    drawn: win => {
      const box = win.querySelector('[data-starter-pregens]');
      if (box instanceof HTMLInputElement) {
        choice.includePregens = box.checked;
        box.addEventListener('change', () => { choice.includePregens = box.checked; });
      }
    },
    actions: [
      { label: STARTER_WORDS.cancel, value: false, cancel: true },
      { label: STARTER_WORDS.button, value: true, primary: true },
    ],
  });
  if (go !== true) return false;

  const missing = starterMissing(store.get(), { includePregens: choice.includePregens });
  const r = store.apply('starter-load', starterStep(app, { includePregens: choice.includePregens }));
  if (!ui.wrote('Starter campaign', r, STARTER_REFUSAL_WORDS)) return false;
  ui.toast('Starter campaign', starterLoadedMessage(missing), { kind: 'info' });
  return true;
}
