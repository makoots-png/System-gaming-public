// guild.js: GM guild assignment and per-hunter override dialog. Publishes app.api.guild.
import {
  GUILD_ARCHETYPES,
  GUILD_GOLD_CUT_MAX,
  GUILD_NAMES,
  GUILD_NAME_MAX,
  GUILD_STANDINGS,
  GUILD_STANDING_LABELS,
  GUILD_WORDS,
  guildFromForm,
  guildStep,
  guildToForm,
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
    const init = guildToForm(cur);
    const archOpts = `<option value="">${esc(GUILD_WORDS.unsignedOption)}</option>`
      + GUILD_ARCHETYPES.map(a => `<option value="${esc(a)}"${init.archetype === a ? ' selected' : ''}>${esc(GUILD_NAMES[a])}</option>`).join('');
    const standOpts = GUILD_STANDINGS.map(s => `<option value="${esc(s)}"${init.standing === s ? ' selected' : ''}>${esc(GUILD_STANDING_LABELS[s])}</option>`).join('');
    const html = `<div class="gd-form">
      <div class="gd-grid">
        ${ui.field(GUILD_WORDS.archetypeLabel, `<select data-gd-arch>${archOpts}</select>`)}
        <span data-gd-signed>${ui.field(GUILD_WORDS.standingLabel, `<select data-gd-stand>${standOpts}</select>`)}</span>
      </div>
      <div data-gd-signed>${ui.field(GUILD_WORDS.customNameLabel, `<input type="text" data-gd-name maxlength="${GUILD_NAME_MAX}" autocomplete="off" value="${esc(init.name)}">`)}</div>
      <div class="gd-grid" data-gd-signed>
        ${ui.field(GUILD_WORDS.goldCutLabel, `<input type="number" data-gd-gold min="0" max="${Math.round(GUILD_GOLD_CUT_MAX * 100)}" step="any" inputmode="decimal" value="${esc(init.goldCut)}">`)}
        ${ui.field(GUILD_WORDS.crystalShareLabel, `<input type="number" data-gd-crys min="0" max="100" step="any" inputmode="decimal" value="${esc(init.crystalShare)}">`)}
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

        const sync = () => {
          const arch = oneOf(archEl.value, GUILD_ARCHETYPES, null);
          signedEls.forEach(n => { n.hidden = !arch; });
          const res = guildFromForm({
            archetype: archEl.value,
            standing: standEl.value,
            name: nameEl.value,
            goldCut: goldEl.value,
            crystalShare: crysEl.value,
          }, R);
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
          if ('why' in res) {
            pick.valid = false;
            prevEl.textContent = res.why === 'bad-gold-cut' ? GUILD_WORDS.badGoldCut : GUILD_WORDS.badCrystalShare;
            prevEl.classList.add('bad');
            okBtn.disabled = true;
            return;
          }
          pick.guild = res.guild;
          pick.valid = true;
          prevEl.textContent = GUILD_WORDS.previewSigned(res.guild, h.rank, R);
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
