// npc-maker.js: the GM's NPC builder (src/core/registry/npcs.ts) on the maker shell (maker.js), opened from the
// Workshop's NPCs section. Creates, copies, edits, and deletes NPC templates in `save.library.npcs` via `saveEntry`
// and `removeEntry`. Above the fold: Name + Roll a name, Fights for (Hunters (ally) / Foes), Rank, Tier presets
// (Support ally, Standard, Elite, Boss), Fighting style, the GM-only "How well this NPC plays" 1 to 5 slider
// (difficulty-control.js), and the live power readout (`npcWorth`, warning when an ally exceeds 1.0x a same-rank
// hunter). Below the fold (`data-later`): Abilities (up to `RULES.fight.npc.abilities`, each with `worthLine`),
// Starting statuses, Stat tweaks (HP/damage multipliers, traits, stat adjustments), Icon (`iconField`), GM notes,
// and preview. Exposes `app.api.npcs`.
import { RANKS, rankIdx } from '../edge/rules.ts';
import { pick } from '../edge/roll.ts';
import { oneOf } from '../core/one-of.ts';
import { STAT_KEYS, STAT_LABELS } from '../core/stats.ts';
import { ARCHETYPE_ATTACKS } from '../core/registry/abilities.ts';
import { ARCHETYPE_LIST, MONSTER_TRAITS, TRAIT_LABEL } from '../core/registry/monsters.ts';
import { SKILL_SEEDS, parseSkill, skillOf } from '../core/registry/skills.ts';
import { isStateChip } from '../core/hunter/chips.ts';
import { copyName, removeEntry, saveEntry, savedWords } from '../core/library.ts';
import { atLibrary } from '../core/save-step.ts';
import {
  NPC_BOUNDS,
  NPC_NAME_SEEDS,
  NPC_SIDES,
  NPC_SKILL_INFO,
  NPC_TIER_PRESETS,
  clampNpcSkill,
  copyNpc,
  newNpc,
  npcPresetOf,
  npcTierPreset,
  npcWorth,
  parseNpc,
} from '../core/registry/npcs.ts';
import { npcDeleteConfirmBody } from '../core/gates/gate.ts';
import { iconField } from './maker.js';
import { npcSkillSliderHtml, wireNpcSkillLive } from './difficulty-control.js';

const SIDE_CHOICES = [['party', 'Hunters (ally)'], ['foe', 'Foes']];
const PRESET_CHOICES = [['support', 'Support ally'], ['standard', 'Standard'], ['elite', 'Elite'], ['boss', 'Boss']];
const ARCH_LABEL = { brute: 'Brute', skirmisher: 'Skirmisher', caster: 'Caster' };

/** Canonical JSON with sorted object keys, used to verify form output matches `parseNpc`. */
const canon = v => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
  : x));

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc } = ui;
  const list = () => store.get().library.npcs;
  const get = id => list().find(n => n.id === id) || null;
  const remove = id => ui.wrote('Workshop', store.apply('library-npc-del', atLibrary(l => removeEntry(l, 'npcs', id))));

  ui.css('npc-maker', `
.npcm-win{max-width:560px;width:100%}
.npcm-name-row{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}
.npcm-name-row>.field{flex:1 1 180px;min-width:0}
.npcm-roll{flex:0 0 auto;min-height:var(--control-h)}
.npcm-power{border:1px solid var(--line);background:rgba(10,26,46,.55);padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.npcm-power.over{border-color:var(--gold);background:rgba(245,194,75,.09)}
.npcm-power-line{margin:0;font-size:14px;color:var(--ice);overflow-wrap:anywhere}
.npcm-power-warn{margin:0;font-size:13px;font-weight:600;color:var(--gold);overflow-wrap:anywhere}
.npcm-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.npcm-list li{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;border:1px solid var(--line);background:rgba(10,26,46,.55);padding:6px 8px}
.npcm-list .nm{flex:1 1 120px;min-width:0;font-weight:600;overflow-wrap:anywhere}
.npcm-list .meta{flex:1 1 100%;order:3;font-size:13px;color:var(--cyan-dim);overflow-wrap:anywhere}
.npcm-list .worth{flex:1 1 100%;order:4;font-size:12px;color:var(--muted);overflow-wrap:anywhere}
.npcm-list .worth.over{color:var(--gold)}
.npcm-rounds{flex:1 1 100%;order:3;display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.npcm-rounds input{flex:0 0 110px;width:110px}
.npcm-rounds .unit{font-size:13px;color:var(--cyan-dim)}
.npcm-tweak-mults{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
.npcm-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.npcm-edit-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.npcm-edit-acts button{flex:1 1 130px;min-height:var(--control-h)}
@media (min-width:460px){.npcm-tweak-mults{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width:520px){.npcm-stats{grid-template-columns:repeat(4,minmax(0,1fr))}}
`);

  /** Rolls an NPC name from the GM's custom NPC name table (if set) or `NPC_NAME_SEEDS`, avoiding the current name when possible. */
  function rollNpcName(current) {
    const ov = store.get().rulesOverrides;
    const tabs = /** @type {{ npc?: unknown }} */ (ov && typeof ov === 'object' && !Array.isArray(ov) && ov.gmTables && typeof ov.gmTables === 'object' ? ov.gmTables : {});
    const raw = Array.isArray(tabs.npc) ? tabs.npc.filter(x => typeof x === 'string' && x.trim()) : [];
    const pool = raw.length ? raw : NPC_NAME_SEEDS;
    const trimmed = String(current || '').trim().toLowerCase();
    const fresh = pool.length > 1 ? pool.filter(n => n.trim().toLowerCase() !== trimmed) : pool;
    return pick(fresh.length ? fresh : pool) || NPC_NAME_SEEDS[0];
  }

  const statusLabel = key => { const c = app.rules().conditions[key]; return String((c && c.label) || key); };
  const stackCap = key => { const c = app.rules().conditions[key]; return c && c.stack ? c.stack.cap : 1; };
  const abilityLines = (a, rank) => app.api.skills.lines({ name: a.name, level: 1, label: null, desc: '', type: 'active', ability: a }, { id: null, tier: rankIdx(rank) });

  /**
   * Opens the NPC maker for `existing` (null: a new NPC). Answers the saved NPC, or null on Cancel or Delete.
   * Copy NPC saves unsaved edits into a new copy (leaving `existing` untouched) and resolves with that copy under its
   * new id, so callers must not assume the returned id matches `existing.id`.
   * @param {import('../core/registry/npcs.ts').Npc | null} existing
   */
  function make(existing) {
    const M = app.api.maker, B = NPC_BOUNDS, R0 = app.rules();
    const own = !!(existing && get(existing.id));
    const start = existing ? parseNpc(existing) || newNpc({}, R0) : newNpc({}, R0);
    const cur = {
      defaultSide: start.defaultSide,
      npcRank: start.rank,
      archetype: start.archetype,
      tier: start.tier,
      tierPreset: npcPresetOf(start, R0),
      skill: start.skill,
      autoPreset: !own,
    };
    const abilities = start.abilities.map(a => JSON.parse(JSON.stringify(a)));
    const statuses = start.statuses.map(st => ({ ...st }));

    return M.open({
      tag: 'Workshop',
      title: own ? 'Edit NPC' : 'New NPC',
      save: 'Save NPC',
      cls: 'npcm',
      build(el, shell) {
        const abilityCap = app.rules().fight.npc.abilities;
        el.innerHTML = `
          <div class="npcm-name-row">
            ${ui.field('Name', `<input type="text" id="npcm-name" maxlength="${B.name}" autocomplete="off" placeholder="e.g. Han Seo-jun" value="${esc(start.name)}">`)}
            <button type="button" class="npcm-roll" data-roll-name>Roll a name</button>
          </div>
          <div class="lbl">Fights for</div>
          ${M.chips('side', SIDE_CHOICES, cur.defaultSide, { label: 'Fights for' })}
          <div class="lbl">Rank</div>
          ${M.chips('rank', RANKS.map(r => [r, r]), cur.npcRank, { label: 'Rank' })}
          <div class="lbl">Tier</div>
          ${M.chips('preset', PRESET_CHOICES, cur.tierPreset, { label: 'Tier' })}
          <div class="lbl">Fighting style</div>
          ${M.chips('archetype', ARCHETYPE_LIST.map(a => [a, ARCH_LABEL[a]]), cur.archetype, { label: 'Fighting style' })}
          ${npcSkillSliderHtml({ id: 'npcm-skill', name: 'skill', skill: cur.skill, R: R0 })}
          <div class="npcm-power" data-power aria-live="polite">
            <p class="npcm-power-line" data-power-summary></p>
            <p class="npcm-power-warn" data-power-warn role="alert" hidden></p>
          </div>
          <div class="slot" data-later>
            <div class="lbl">Abilities (up to ${abilityCap})</div>
            <ul class="npcm-list" data-abilities></ul>
            <div data-ability-add></div>
            <div class="lbl">Starting statuses</div>
            <ul class="npcm-list" data-statuses></ul>
            <div data-status-add></div>
            <details class="mk-group" data-group="tweaks">
              <summary data-sum="tweaks">Stat tweaks</summary>
              <div class="mk-group-body">
                <div class="npcm-tweak-mults">
                  ${ui.field('HP multiplier', `<input type="number" inputmode="decimal" id="npcm-hp" min="${B.tweakMin}" max="${B.tweakMax}" step="0.01" placeholder="1" value="${esc(start.tweak.hp)}">`)}
                  ${ui.field('Damage multiplier', `<input type="number" inputmode="decimal" id="npcm-dealt" min="${B.tweakMin}" max="${B.tweakMax}" step="0.01" placeholder="1" value="${esc(start.tweak.dealt)}">`)}
                </div>
                <div class="lbl">Traits</div>
                ${M.chips('traits', MONSTER_TRAITS.map(t => [t, TRAIT_LABEL[t]]), [...(start.tweak.traits || [])], { many: true, label: 'Traits' })}
                <div class="lbl">Stat adjustments</div>
                <div class="npcm-stats">
                  ${STAT_KEYS.map(k => ui.field(STAT_LABELS[k], `<input type="number" inputmode="numeric" step="1" min="${-B.stat}" max="${B.stat}" data-stat="${k}" placeholder="0" value="${start.tweak.stats && start.tweak.stats[k] ? esc(start.tweak.stats[k]) : ''}">`)).join('')}
                </div>
              </div>
            </details>
            <div data-icon></div>
            ${ui.field('GM notes (only you see these)', `<textarea id="npcm-notes" maxlength="${B.notes}" placeholder="Tactics, personality, or story notes">${esc(start.notes)}</textarea>`)}
            <div data-mk-preview></div>
          </div>
          ${own ? '<div class="npcm-edit-acts"><button type="button" data-copy-npc>Copy NPC</button><button type="button" class="danger" data-del-npc>Delete NPC</button></div>' : ''}`;

        const $ = sel => el.querySelector(sel);
        const int = (v, lo, hi, d) => { const t = String(v).trim(), n = Math.trunc(Number(t)); return t === '' || !Number.isFinite(n) ? d : Math.max(lo, Math.min(hi, n)); };
        const mult = (v, d) => { const t = String(v).trim(), n = Number(t); return t === '' || !Number.isFinite(n) || n <= 0 ? d : Math.max(B.tweakMin, Math.min(B.tweakMax, n)); };
        const row = (label, i, kind, extra = '') => `<li><span class="nm">${esc(label)}</span>${extra}<button type="button" class="icon-btn" data-rm="${kind}" data-i="${i}" aria-label="Remove ${esc(label)}">&times;</button></li>`;
        const opt = (v, l) => `<option value="${esc(v)}">${esc(l)}</option>`;

        /** Presses `val` in chip group `name` when programmatic preset sync changes the active chip. */
        const syncChips = (name, val) => {
          el.querySelectorAll(`[data-chips="${name}"] [data-chip]`).forEach(b => {
            b.setAttribute('aria-pressed', String(b.dataset.chip === val));
          });
        };

        /** Reads the current `Tweak` from the Stat tweaks inputs and trait chips. */
        function tweakOf() {
          const hp = mult($('#npcm-hp').value, 1);
          const dealt = mult($('#npcm-dealt').value, 1);
          const stats = {};
          for (const k of STAT_KEYS) {
            const inp = $(`[data-stat="${k}"]`), n = inp ? int(inp.value, -B.stat, B.stat, 0) : 0;
            if (n) stats[k] = n;
          }
          const pickedTraits = /** @type {string[]} */ (M.picked(el, 'traits') || []);
          const traits = MONSTER_TRAITS.filter(k => pickedTraits.includes(k));
          return { hp, dealt, stats, traits };
        }

        /** Applies tier preset `nextPreset`, updating `tier`, HP/damage multipliers, and the Tier chips. */
        function applyPreset(nextPreset) {
          const p = npcTierPreset(nextPreset, app.rules());
          cur.tierPreset = nextPreset;
          cur.tier = p.tier;
          $('#npcm-hp').value = String(p.tweak.hp);
          $('#npcm-dealt').value = String(p.tweak.dealt);
          syncChips('preset', cur.tierPreset);
        }

        /** The NPC template the form holds now, before `icon` is attached. */
        const formNpc = () => ({
          name: $('#npcm-name').value.trim().slice(0, B.name),
          rank: cur.npcRank,
          archetype: cur.archetype,
          tier: cur.tier,
          tweak: tweakOf(),
          defaultSide: cur.defaultSide,
          skill: cur.skill,
          abilities: abilities.map(a => JSON.parse(JSON.stringify(a))),
          statuses: statuses.map(st => ({ ...st })),
          notes: $('#npcm-notes').value.slice(0, B.notes),
        });

        /** Refreshes the abilities and starting statuses lists and their add selects. */
        function lists() {
          const R = app.rules(), cap = R.fight.npc.abilities;
          const worth = npcWorth(formNpc(), R);
          $('[data-abilities]').innerHTML = abilities.map((a, i) => {
            const aw = worth.abilities[i];
            return row(a.name, i, 'ability',
              `<span class="meta">${esc(abilityLines(a, cur.npcRank).join(', '))}</span>`
              + (aw ? `<span class="worth${aw.worth.over ? ' over' : ''}">${esc(aw.line)}</span>` : '')
              + `<button type="button" class="quiet" data-edit-ability="${i}" aria-label="Edit ${esc(a.name)}">Edit</button>`);
          }).join('');
          $('[data-statuses]').innerHTML = statuses.map((st, i) => row(statusLabel(st.key), i, 'status',
            `<span class="npcm-rounds"><input type="number" min="1" max="${B.rounds}" inputmode="numeric" data-rounds="${i}" aria-label="Rounds of ${esc(statusLabel(st.key))}" placeholder="Until removed" value="${st.rounds ?? ''}"><span class="unit">rounds</span>${stackCap(st.key) > 1
              ? `<input type="number" min="1" max="${stackCap(st.key)}" inputmode="numeric" data-stacks="${i}" aria-label="Stacks of ${esc(statusLabel(st.key))}" placeholder="1" value="${st.stacks ?? ''}"><span class="unit">stacks</span>` : ''}</span>`)).join('');
          const lib = store.get().library, have = new Set(abilities.map(a => a.name.toLowerCase()));
          const fullA = abilities.length >= cap, fullS = statuses.length >= B.statuses;
          const activeSkill = k => k.type === 'active' && !have.has(k.name.toLowerCase());
          $('[data-ability-add]').innerHTML = `<select data-add="ability" data-pick aria-label="Add an ability from a skill"${fullA ? ' disabled' : ''}><option value="">${fullA ? `Add an ability (max ${cap})` : 'Add an ability…'}</option>
            <optgroup label="Built-in">${SKILL_SEEDS.filter(activeSkill).map(k => opt(`seed:${k.name}`, k.name)).join('')}</optgroup>
            ${lib.skills.some(activeSkill) ? `<optgroup label="Library">${lib.skills.filter(activeSkill).map(k => opt(`lib:${k.id}`, k.name)).join('')}</optgroup>` : ''}
            <option value="new">New skill…</option></select>`;
          const conds = Object.keys(R.conditions).filter(k => !isStateChip(k) && !statuses.some(st => st.key === k));
          $('[data-status-add]').innerHTML = `<select data-add="status" data-pick aria-label="Add a starting status"${fullS ? ' disabled' : ''}><option value="">${fullS ? `Add a status (max ${B.statuses})` : 'Add a status…'}</option>${conds.map(k => opt(k, statusLabel(k))).join('')}</select>`;
        }

        /** Updates the live power readout, ally over-budget warning, and Stat tweaks summary line. */
        function paintPower() {
          const R = app.rules(), draft = formNpc(), w = npcWorth(draft, R);
          const box = $('[data-power]');
          $('[data-power-summary]').textContent = w.summary;
          const warnEl = $('[data-power-warn]');
          warnEl.hidden = !w.warning;
          warnEl.textContent = w.warning || '';
          box.classList.toggle('over', w.overAllyBudget);
          const base = npcTierPreset(npcPresetOf(draft, R), R).tweak;
          const parts = [];
          if (Math.abs(draft.tweak.hp - base.hp) >= 1e-6) parts.push(`HP ×${draft.tweak.hp}`);
          if (Math.abs(draft.tweak.dealt - base.dealt) >= 1e-6) parts.push(`damage ×${draft.tweak.dealt}`);
          for (const k of STAT_KEYS) if (draft.tweak.stats[k]) parts.push(`${draft.tweak.stats[k] > 0 ? '+' : ''}${draft.tweak.stats[k]} ${k.toUpperCase()}`);
          if (draft.tweak.traits.length) parts.push(draft.tweak.traits.map(t => TRAIT_LABEL[t]).join(', '));
          $('[data-sum="tweaks"]').textContent = parts.length ? `Stat tweaks: ${parts.join(', ')}` : 'Stat tweaks: default';
        }

        /** Builds the live preview lines shown at the bottom of the maker. */
        function previewLines() {
          const R = app.rules(), draft = formNpc(), w = npcWorth(draft, R), sk = NPC_SKILL_INFO[draft.skill];
          const attacks = [ARCHETYPE_ATTACKS[draft.archetype](R), ...draft.abilities];
          return [
            w.summary,
            w.warning || '',
            `Fights for ${draft.defaultSide === 'party' ? 'hunters (ally)' : 'foes'} · Plays ${sk.name.toLowerCase()} (${draft.skill} of 5)`,
            ...attacks.map(a => `${a.name}: ${abilityLines(a, draft.rank).join(', ')}`),
            draft.statuses.length ? `Starts with: ${draft.statuses.map(st => `${st.stacks ? `${st.stacks} ` : ''}${statusLabel(st.key)} (${st.rounds === null ? 'until removed' : `${st.rounds} round${st.rounds === 1 ? '' : 's'}`})`).join(', ')}` : '',
          ].filter(Boolean);
        }

        const iconRow = iconField($('[data-icon]'), shell.el, {
          thing: 'monster',
          pick: start.icon || null,
          subject: () => ({ thing: 'monster', monster: { archetype: cur.archetype } }),
        });

        wireNpcSkillLive(el, () => app.rules(), step => {
          cur.skill = step;
          shell.changed();
        });

        lists();
        paintPower();

        /** Reads and validates the current form through `parseNpc`; shows an error and returns null on missing name. */
        function readParsed() {
          const pickIcon = iconRow.pick();
          const form = { ...formNpc(), ...(pickIcon ? { icon: pickIcon } : {}) };
          if (!form.name) { shell.error('Give the NPC a name.'); $('#npcm-name').focus(); return null; }
          const out = parseNpc(form);
          if (!out) { shell.error('Give the NPC a name.'); $('#npcm-name').focus(); return null; }
          if (canon(out) !== canon(form)) console.error('The NPC maker wrote an NPC its parser reads differently', form, out);
          return out;
        }

        el.addEventListener('click', async e => {
          const t = e.target.closest('button'); if (!t) return;
          if (t.hasAttribute('data-roll-name')) {
            const inp = $('#npcm-name');
            inp.value = rollNpcName(inp.value);
            shell.error('');
            shell.changed();
            return;
          }
          if (t.closest('[data-chips="side"]')) {
            const nextSide = oneOf(M.picked(el, 'side'), NPC_SIDES, cur.defaultSide);
            if (nextSide !== cur.defaultSide) {
              cur.defaultSide = nextSide;
              // On a new NPC whose tier preset has not been manually chosen or tweaked, follow the side's default preset.
              if (cur.autoPreset) applyPreset(cur.defaultSide === 'foe' ? 'standard' : 'support');
            }
          } else if (t.closest('[data-chips="rank"]')) {
            cur.npcRank = oneOf(M.picked(el, 'rank'), RANKS, cur.npcRank);
            lists();
          } else if (t.closest('[data-chips="preset"]')) {
            const picked = oneOf(M.picked(el, 'preset'), NPC_TIER_PRESETS, cur.tierPreset);
            cur.autoPreset = false;
            if (picked !== cur.tierPreset) applyPreset(picked);
          } else if (t.closest('[data-chips="archetype"]')) {
            cur.archetype = oneOf(M.picked(el, 'archetype'), ARCHETYPE_LIST, cur.archetype);
          } else if (t.dataset.editAbility !== undefined) {
            const i = Number(t.dataset.editAbility), was = abilities[i];
            const k = await app.api.skills.make({ initial: { name: was.name, level: 1, label: null, desc: '', type: 'active', ability: was }, library: false });
            if (k && k.type === 'active' && k.ability) { abilities[i] = { ...k.ability, id: was.id }; lists(); paintPower(); shell.changed(); }
            return;
          } else if (t.dataset.rm) {
            const target = t.dataset.rm === 'ability' ? abilities : statuses;
            target.splice(Number(t.dataset.i), 1);
            lists();
          } else if (t.hasAttribute('data-copy-npc') && own && existing) {
            const out = readParsed(); if (!out) return;
            const existingNames = list().map(x => x.name);
            const name = existingNames.some(x => x.toLowerCase() === out.name.toLowerCase())
              ? copyName(out.name, existingNames, B.name)
              : out.name;
            const copied = copyNpc({ ...out, id: existing.id }, store.id('npc_'), name);
            if (!ui.wrote('Workshop', store.apply('library-npc-copy', atLibrary(l => saveEntry(l, 'npcs', copied))), savedWords('npc', name))) return;
            ui.toast('Workshop', `${copied.name} added to your NPCs.`);
            shell.done(copied);
            return;
          } else if (t.hasAttribute('data-del-npc') && own && existing) {
            const ok = await ui.confirm({
              title: `Delete ${existing.name}?`,
              body: npcDeleteConfirmBody(existing.id, store.get().gates),
              danger: true,
              confirmLabel: 'Delete NPC',
            });
            if (ok && remove(existing.id)) {
              ui.toast('Workshop', `${existing.name} deleted.`);
              shell.done(null);
            }
            return;
          }
          paintPower();
          shell.changed();
        });

        el.addEventListener('input', e => {
          const t = e.target;
          if (t.id === 'npcm-hp' || t.id === 'npcm-dealt') {
            cur.autoPreset = false;
            cur.tierPreset = npcPresetOf({ tier: cur.tier, tweak: tweakOf() }, app.rules());
            syncChips('preset', cur.tierPreset);
            paintPower();
          } else if (t.dataset && t.dataset.stat !== undefined) {
            paintPower();
          } else if (t.dataset && t.dataset.rounds !== undefined) {
            const st = statuses[Number(t.dataset.rounds)];
            if (st) st.rounds = t.value.trim() === '' ? null : int(t.value, 1, B.rounds, 1);
          } else if (t.dataset && t.dataset.stacks !== undefined) {
            const st = statuses[Number(t.dataset.stacks)], n = int(t.value, 1, stackCap(st ? st.key : ''), 1);
            if (st) { if (n > 1) st.stacks = n; else delete st.stacks; }
          }
        });

        el.addEventListener('change', async e => {
          const t = e.target; if (!t.dataset || !t.dataset.add) return;
          const v = t.value; t.value = ''; if (!v) return;
          const lib = store.get().library, cap = app.rules().fight.npc.abilities;
          if (t.dataset.add === 'ability') {
            const seed = SKILL_SEEDS.find(k => `seed:${k.name}` === v);
            const mine = lib.skills.find(k => `lib:${k.id}` === v);
            const k = v === 'new' ? await app.api.skills.make({}) : seed ? skillOf(seed, app.rules()) : mine ? parseSkill(mine) : null;
            const a = k && k.type === 'active' ? k.ability : null;
            if (a && abilities.length < cap && !abilities.some(x => x.id === a.id)) abilities.push(a);
          } else if (t.dataset.add === 'status') {
            if (statuses.length < B.statuses) statuses.push({ key: v, rounds: 3 });
          }
          lists();
          paintPower();
          shell.changed();
        });

        return {
          preview: previewLines,
          save() {
            const out = readParsed();
            if (!out) return undefined;
            const npc = { ...out, id: own && existing ? existing.id : store.id('npc_') };
            if (!ui.wrote('Workshop', store.apply('library-npc', atLibrary(l => saveEntry(l, 'npcs', npc))), savedWords('npc', npc.name))) return undefined;
            return npc;
          },
        };
      },
    });
  }

  app.api.npcs = { list, get, make, remove };
}
