// effects.js: app.api.effects. Applies the ops of a skill to a hunter outside a fight (the step is src/core/hunter/use.ts
// `useOn`; this rolls its dice and writes it), and gives the views a status's and an item's words.
import { rules } from '../edge/rules.ts';
import { rollSettle } from '../edge/roll.ts';
import { describeStatus, freeStatusKey } from '../core/combat/effect-ops.ts';
import { parseStatusDef } from '../core/combat/fight-parse.ts';
import { describeItem } from '../core/effects.ts';
import { useDice, useOn } from '../core/hunter/use.ts';
import { atHunter, isRefused } from '../core/save-step.ts';

/** @param {import('./app.ts').App} app */
export function register(app) {
  const A = app;
  /** @type {import('../core/api.ts').EffectsApi['statusDef']} */
  function statusDef(x) {
    const key = typeof x === 'string' ? x : x && x.key, R = rules();
    if (x && typeof x === 'object' && x.def) return x.def;
    return (key && Object.hasOwn(R.conditions, key) && R.conditions[key]) || { label: String(key || '?'), desc: '', ops: [] };
  }
  /**
   * `ops` on hunter `hid`'s sheet, outside a fight, in one write (src/core/hunter/use.ts `useOn`): the dice rolled here
   * first. Answers the lines of what changed; none when nothing did, or when a fight holds the hunter's HP, mana and
   * fatigue (`hunter.fightOf`), where a use is the fight's.
   * @type {import('../core/api.ts').EffectsApi['applyOps']}
   */
  function applyOps(hid, ops, o) {
    const { store } = A, h = store.hunter(hid), R = rules();
    if (!h) return [];
    if (A.api.hunter.fightOf({ hid })) { A.ui.toast('System', `${o.label}: use it in the fight.`, { kind: 'warning' }); return []; }
    const rolls = useDice(ops, o.source.tier).map(d => rollSettle(d)), u = useOn(h, ops, o.source, rolls, R);
    if (isRefused(u)) return [];
    const w = store.apply('use', atHunter(hid, x => { const y = useOn(x, ops, o.source, rolls, R); return isRefused(y) ? y : y.hunter; }));
    return w.ok ? [...u.lines] : [];
  }

  app.api.effects = {
    applyOps, statusDef,
    sanitizeDef: def => parseStatusDef(def, rules()),
    describe: (def, tier = null) => describeStatus(def, tier, rules()),
    describeItem: (item, ops) => describeItem(rules(), item, ops),
    slug: (label, taken) => {
      const has = k => (taken instanceof Set ? taken.has(k) : !!taken && Object.hasOwn(taken, k)) || Object.hasOwn(rules().conditions, k);
      return freeStatusKey(label, has);
    },
  };
}
