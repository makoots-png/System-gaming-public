// guild.js: GM guild assignment and per-hunter override dialog. Publishes app.api.guild.
import {
  GUILD_ARCHETYPES,
  GUILD_GOLD_CUT_MAX,
  GUILD_NAMES,
  GUILD_NAME_MAX,
  GUILD_STANDINGS,
  GUILD_STANDING_LABELS,
  GUILD_WORDS,
  guildStep,
  isStandingAllowed,
  tableCrystalShare,
  tableGoldCut,
} from '../core/hunter/guild.ts';
import { sent } from '../core/award.ts';
import { oneOf } from '../core/one-of.ts';
import { standsFor } from '../core/protocol.ts';
import { postNews } from '../core/sync/connection.ts';

const CSS = `
.gd-form{display:flex;flex-direction:column;gap:10px;text-align:left}
.gd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px 10px}
.gd-form input,.gd-form select{width:100%;box-sizing:border-box}
.gd-preview{margin:0;font-size:14px;color:var(--ice);overflow-wrap:anywhere}
.gd-preview.bad{color:#ff8a96}
`;

const pctInputVal = rate => (rate === undefined ? '' : String(Math.round(rate * 1000) / 10));

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc } = ui;
  const A = () => app.api;
  ui.css('guild', CSS);

  /** @param {import('../core/ids.ts').HunterRef} who @param {import('../core/save.ts').Hunter | null} sheet */
  async function edit(who, sheet) {
    if (!app.isGM()) return;
    const h = who.kind === 'local' ? store.hunter(who.hunterId) : sheet;
    if (!h) return;
    const R = app.rules();
    const cur = h.guild;
    const archOpts = `<option value="">${esc(GUILD_WORDS.unsignedOption)}</option>`
      + GUILD_ARCHETYPES.map(a => `<option value="${esc(a)}"${cur && cur.archetype === a ? ' selected' : ''}>${esc(GUILD_NAMES[a])}</option>`).join('');
    const standOpts = GUILD_STANDINGS.map(s => `<option value="${esc(s)}"${(cur ? cur.standing : 'core') === s ? ' selected' : ''}>${esc(GUILD_STANDING_LABELS[s])}</option>`).join('');
    const html = `<div class="gd-form">
      <div class="gd-grid">
        ${ui.field(GUILD_WORDS.archetypeLabel, `<select data-gd-arch>${archOpts}</select>`)}
        <span data-gd-signed>${ui.field(GUILD_WORDS.standingLabel, `<select data-gd-stand>${standOpts}</select>`)}</span>
      </div>
      <div data-gd-signed>${ui.field(GUILD_WORDS.customNameLabel, `<input type="text" data-gd-name maxlength="${GUILD_NAME_MAX}" autocomplete="off" value="${esc(cur?.name ?? '')}">`)}</div>
      <div class="gd-grid" data-gd-signed>
        ${ui.field(GUILD_WORDS.goldCutLabel, `<input type="number" data-gd-gold min="0" max="${Math.round(GUILD_GOLD_CUT_MAX * 100)}" step="0.5" inputmode="decimal" value="${esc(pctInputVal(cur?.goldCut))}">`)}
        ${ui.field(GUILD_WORDS.crystalShareLabel, `<input type="number" data-gd-crys min="0" max="100" step="0.5" inputmode="decimal" value="${esc(pctInputVal(cur?.crystalShare))}">`)}
      </div>
      <p class="gd-preview" data-gd-preview aria-live="polite"></p>
    </div>`;

    const pick = {
      /** @type {import('../core/hunter/guild.ts').GuildMembership | null} */
      guild: cur ? { ...cur } : null,
      valid: true,
    };

    const yes = await ui.system({
      tag: '! Guild',
      title: GUILD_WORDS.modalTitle(h.name),
      html,
      size: 'form',
      actions: [
        { label: GUILD_WORDS.cancel, value: false, cancel: true },
        { label: GUILD_WORDS.save, value: true, primary: true },
      ],
      drawn(win) {
        const archEl = win.querySelector('[data-gd-arch]');
        const standEl = win.querySelector('[data-gd-stand]');
        const nameEl = win.querySelector('[data-gd-name]');
        const goldEl = win.querySelector('[data-gd-gold]');
        const crysEl = win.querySelector('[data-gd-crys]');
        const prevEl = win.querySelector('[data-gd-preview]');
        const okBtn = win.querySelector('.sys-actions button.primary');
        const signedEls = win.querySelectorAll('[data-gd-signed]');

        const parsePct = (raw, maxPct) => {
          const s = raw.trim();
          if (!s) return { ok: true, value: undefined };
          const n = Number(s);
          if (!Number.isFinite(n) || n < 0 || n > maxPct) return { ok: false, value: undefined };
          return { ok: true, value: Math.round(n * 100) / 10000 };
        };

        const sync = () => {
          const arch = oneOf(archEl.value, GUILD_ARCHETYPES, null);
          signedEls.forEach(n => { n.hidden = !arch; });
          if (!arch) {
            pick.guild = null;
            pick.valid = true;
            prevEl.textContent = GUILD_WORDS.previewUnsigned(R.crystal.unsignedShare);
            prevEl.classList.remove('bad');
            okBtn.disabled = false;
            return;
          }
          const standing = oneOf(standEl.value, GUILD_STANDINGS, 'core');
          nameEl.setAttribute('placeholder', GUILD_WORDS.customNamePlaceholder(GUILD_NAMES[arch]));
          if (!isStandingAllowed(arch, standing, R)) {
            goldEl.setAttribute('placeholder', '');
            crysEl.setAttribute('placeholder', '');
            pick.valid = false;
            prevEl.textContent = GUILD_WORDS.standingUnavailable(arch, standing, R);
            prevEl.classList.add('bad');
            okBtn.disabled = true;
            return;
          }
          const defGold = tableGoldCut(arch, standing, h.rank, R) ?? 0;
          const defCrystal = tableCrystalShare(arch, standing, R) ?? R.crystal.unsignedShare;
          goldEl.setAttribute('placeholder', GUILD_WORDS.tableDefaultPlaceholder(defGold));
          crysEl.setAttribute('placeholder', GUILD_WORDS.tableDefaultPlaceholder(defCrystal));
          const gc = parsePct(goldEl.value, Math.round(GUILD_GOLD_CUT_MAX * 100));
          const cs = parsePct(crysEl.value, 100);
          if (!gc.ok) {
            pick.valid = false;
            prevEl.textContent = GUILD_WORDS.badGoldCut;
            prevEl.classList.add('bad');
            okBtn.disabled = true;
            return;
          }
          if (!cs.ok) {
            pick.valid = false;
            prevEl.textContent = GUILD_WORDS.badCrystalShare;
            prevEl.classList.add('bad');
            okBtn.disabled = true;
            return;
          }
          const customName = nameEl.value.replace(/\s+/g, ' ').trim().slice(0, GUILD_NAME_MAX);
          const next = {
            archetype: arch,
            standing,
            ...(customName ? { name: customName } : {}),
            ...(gc.value !== undefined ? { goldCut: gc.value } : {}),
            ...(cs.value !== undefined ? { crystalShare: cs.value } : {}),
          };
          pick.guild = next;
          pick.valid = true;
          prevEl.textContent = GUILD_WORDS.previewSigned(next, h.rank, R);
          prevEl.classList.remove('bad');
          okBtn.disabled = false;
        };

        archEl.addEventListener('change', sync);
        standEl.addEventListener('change', sync);
        nameEl.addEventListener('input', sync);
        goldEl.addEventListener('input', sync);
        crysEl.addEventListener('input', sync);
        sync();
      },
    });
    if (yes !== true || !pick.valid) return;
    const stamp = { at: new Date().toISOString(), cap: app.rules().logCap };
    if (who.kind === 'local') {
      const words = pick.guild
        ? { 'standing-unavailable': GUILD_WORDS.standingUnavailable(pick.guild.archetype, pick.guild.standing, R) }
        : undefined;
      if (ui.wrote('GM', store.apply('gm-guild', s => {
        const r = guildStep(s, who.hunterId, pick.guild, stamp, R);
        return 'ok' in r ? r : r.save;
      }), words)) {
        ui.toast('GM', GUILD_WORDS.savedLocal(h.name, pick.guild));
      }
      return;
    }
    const sy = A().sync, code = sy.room();
    const ev = sy.event('guild', { to: [who.remote], guild: pick.guild });
    if (!code || !ev) {
      ui.toast('GM', 'Not sent. Create or reopen a room to update a player hunter\'s guild.', { kind: 'warning' });
      return;
    }
    const said = [{ kind: /** @type {const} */ ('system'), hunterId: null, title: GUILD_WORDS.logTitle, text: GUILD_WORDS.savedLocal(h.name, pick.guild) }];
    if (!ui.wrote('GM', store.apply('gm-guild', s => sent(s, { room: code, events: [{ key: standsFor(ev), event: ev }], said }, stamp)))) return;
    sy.flush();
    ui.toast('GM', GUILD_WORDS.sentRemote(h.name, pick.guild, postNews({ ok: true }, sy.conn()) === 'sent'));
  }

  app.api.guild = { edit };
}
