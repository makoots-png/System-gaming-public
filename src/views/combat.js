// combat.js: the GM's fight screen. Publishes app.api.combat; emits combat:turn / combat:defeated / combat:end.
// The fight is store.fight, and only `send` changes it: every change is a command to the reducer in
// src/core/combat/fight.ts, and this view carries out the effects it answers. It draws and sends only: every number it
// shows comes from src/core/combat/fight-view.ts (the order ahead, a card, the targets of a use, a step toward or away),
// every row from src/core/combat/rows.ts and every die from src/edge/roll.ts. The fight shows as a list or, by the
// device's choice, as the battle map (src/views/map.js, its scene from map-view.ts), which sends the same commands.
// `fightRefs` in the save holds what the fight came from (its gate, each monster row's bestiary entry); this view is its
// one writer.
import { pickables, pickedRef } from '../core/party.ts';
import { RANKS, rules } from '../edge/rules.ts';
import { stepTime } from '../core/day.ts';
import { isUp, rowHp } from '../core/combat/row-hp.ts';
import { can, owed, reduce, reduceAll, shadowFieldCap } from '../core/combat/fight.ts';
import { fightGateName, heldCommands, itemSpent } from '../core/combat/fight-save.ts';
import { gateFought } from '../core/gates/world.ts';
import { remoteFacts } from '../core/combat/fight-facts.ts';
import { attemptsLeft, UNTRIED } from '../core/combat/extraction.ts';
import { canRiseFor, canRiseInFight, riseBonus, riseDc } from '../core/combat/rise.ts';
import { isRisen } from '../core/combat/summons.ts';
import { needs } from '../core/combat/resolve.ts';
import { autoMonsterTurn } from '../core/combat/policy.ts';
import { WAIT_WORDS, aims, answersBy, cardOf, channelView, fudgeShown, mythicHand, mythicSeenOf, mythicStrip, omenBanner, order, readyIn, spotOf, statusGrant, stepAway, stepToward, timeOf, usesLeft, waitChoices } from '../core/combat/fight-view.ts';
import { omenMove, omenNeeds } from '../core/combat/fight-turn.ts';
import { runningState } from '../core/combat/fight.ts';
import { mythicScriptOf } from '../core/registry/mythics.ts';
import { mythicSwitched } from '../core/mythic-switch.ts';
import { MYTHIC_SWITCH_WORDS } from '../core/rules-text.ts';
import { MYTHIC_CSS, mythicBox } from './mythic-html.js';
import { EVERYTHING, eyesChoices, fightBodies, fightDodge, fightGround, pinKeyOf, viewAsOf } from '../core/combat/map-view.ts';
import { SCREEN, buildDrawer, mapSlot } from '../core/combat/map-mount.ts';
import { hunterRow, monsterRows, remoteRow, remoteShadowRow, shadowRow } from '../core/combat/rows.ts';
import { TABLE_REFUSALS, fightDoc, fightWire } from '../core/combat/fight-doc.ts';
import { REFUSAL_WORDS } from '../core/combat/refusal-words.ts';
import { combatantId } from '../core/combat/ability-types.ts';
import { tick } from '../core/combat/timeline.ts';
import { MAX_ZONES, zoneId } from '../core/combat/zones.ts';
import { statusGlance } from '../core/detail.ts';
import { MAP_BOUNDS, fightMapOf, openArena } from '../core/registry/maps.ts';
import { place } from '../core/combat/space.ts';
import { cryptoRandom, rollNeeds, rollOpenings, rollSettle } from '../edge/roll.ts';
import { openingWeights, settleWeights, weightsFor } from '../core/combat/fudge.ts';
import { weighable } from '../core/combat/odds.ts';
import { onDodge, onTurn } from '../core/protocol.ts';
import { fightId, parseSheetKey } from '../core/ids.ts';
import { LOOT_WORDS, dropDealt, dropLine, encounterAwards, lootMoreLine, lootOffered, planEncounter, pays, settleEncounter } from '../core/gates/pay.ts';
import { TOLD, WROTE, isRefused, refuse } from '../core/save-step.ts';
import { lifeWord, rowLifeTakes } from '../core/combat/row-life.ts';
import { ARCHETYPE_LIST, MONSTER_BOUNDS, MONSTER_KINDS, copiesOf, lootOf, monsterXp, statBlock } from '../core/registry/monsters.ts';
import { itemAbilityId, itemOfAbility } from '../core/registry/abilities.ts';
import { newRewards } from '../core/rewards.ts';
import { oneOf } from '../core/one-of.ts';
import { runsFight } from '../core/role.ts';
import { untouched } from '../core/party.ts';
import { postNews } from '../core/sync/connection.ts';
import * as motion from './motion.ts';
import { bind, keyed, prepended } from './patch.ts';
import { icon, sprite } from './icons.ts';
import { statusIcon } from '../core/registry/icon-defaults.ts';
import { rowIcon } from '../core/combat/row-icon.ts';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const int = (v, d = 0) => { v = Math.trunc(Number(v)); return Number.isFinite(v) ? v : d; };
/** @typedef {import('../core/combat/fight-types.ts').Fight} Fight */
/** @typedef {import('../core/combat/fight-types.ts').Running} Running */
/** @typedef {import('../core/combat/fight-types.ts').Command} Command */
/** @typedef {import('../core/combat/fight-types.ts').Effect} Effect */
/** @typedef {import('../core/combat/effect-ops.ts').Body} Body */
/** @typedef {import('../core/api.ts').JoinRow} JoinRow */


/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc } = ui;
  const A = () => app.api;
  sprite();
  const canRun = () => runsFight(app.seat()); // P01/F02: solo play runs its own fight; in a room only the GM does
  const inRoomAsGM = () => app.seat() === 'gm';
  /** @returns {Fight | null} */
  const fight = () => store.get().fight;
  /** @param {Fight | null} f @returns {f is Running} */
  const running = f => !!(f && f.phase === 'running');
  /** @param {Fight | null} f @param {string} id @returns {Body | null} */
  const rowOf = (f, id) => (f ? f.rows.find(r => r.id === id) || null : null);
  const cur = () => { const f = fight(); return running(f) ? rowOf(f, f.currentId) : null; };
  /** The fight's time: its `now`, or 0 before it starts. */
  const localHunter = r => (r && r.holder && r.holder.kind === 'local' ? store.hunter(r.holder.hunterId) : null);
  /** The room key of a hunter on another phone, or null. */
  const remoteKeyOf = r => (r && r.holder && r.holder.kind === 'remote' ? r.holder.remote : null);
  const isRemote = r => remoteKeyOf(r) !== null;
  /** The hunter a row holds: this phone's, or a player's as the room's parser read its sheet; null for a monster or a shadow. */
  const holderHunter = r => { const o = r.holder; return !o ? null : o.kind === 'local' ? store.hunter(o.hunterId) : o.kind === 'remote' ? (remoteList().find(x => x.key === o.remote) || {}).data || null : null; };
  const rankOf = r => RANKS[r.tier] || 'E';
  const refs = () => store.get().fightRefs || { gate: null, monsters: {} };
  const newId = () => combatantId(store.id('c'));
  /** @param {string} msg @param {import('../core/warning.ts').ToastKind} [kind] */
  const toast = (msg, kind = 'info') => ui.news(msg, kind);
  const ctx = () => ({ rules: rules() });
  /** The target each row's move control and use picker start on, by row id. */
  const picks = new Map();

  // ── the one writer of the fight ──
  /** What a command the store refused did: nothing (its refusal was told by its kind, `ui.wrote`). */
  const NOT_WRITTEN = /** @type {readonly Effect[]} */ ([{ type: 'refused', reason: 'notNow' }]);
  /**
   * What a refused fight write says beside a read-only tab's (`ui.wrote`): an item this phone's hunter no longer holds,
   * or a shadow risen for a player's hunter with no room to reach it (fight-save.ts `fought`). Any other kind is a bug.
   */
  const WRITE_WORDS = { 'no-item': REFUSAL_WORDS.notNow, 'no-room': REFUSAL_WORDS.notNow };
  /**
   * Sends one command to the reducer and writes what it answers in one `store.apply` (src/core/combat/fight-save.ts
   * `fought`): the fight, `links` (its gate, marked as fought with it, and the bestiary entry of new monster rows), each
   * write-back on this phone (a hunter's totals, a shadow's HP) and each player's totals in the outbox. Then what reaches
   * outside the save, in this order: (1) the outbox goes to the room (`flush`); (2) the news of this command (the events
   * other views hear, the toasts, the doc's burst, the motion); (3) the dice the fight still waits for (`payOwed`). 1 and 3
   * are read from the save, so a reload between any two steps finds them there and does them at its next look, once; 2 is
   * told once or not at all. Answers the reducer's effects. `also`: a step of another module the write carries.
   * @param {Command} cmd @param {import('../core/combat/fight-save.ts').Links | null} [links]
   * @param {import('../core/save-step.ts').Step<import('../core/save.ts').Save> | null} [also]
   * @param {import('../core/protocol.ts').RoomEvent | null} [risen]
   */
  function send(cmd, links = null, also = null, risen = null) { return sendAll([cmd], links, also, risen); }
  /**
   * `send` for several commands written as one (fight.ts `reduceAll`): all of them in one write, or none when the fight
   * refuses one. A grant's statuses and refill on the rows it pays (`held`).
   * @param {readonly Command[]} cmds @param {import('../core/combat/fight-save.ts').Links | null} [links]
   * @param {import('../core/save-step.ts').Step<import('../core/save.ts').Save> | null} [also]
   * @param {import('../core/protocol.ts').RoomEvent | null} [risen]
   */
  function sendAll(cmds, links = null, also = null, risen = null) {
    const effects = command(cmds, links, also, risen);
    if (!refused(effects)) payOwed();
    return effects;
  }
  /**
   * `sendAll` without (3): the write, the outbox and the news of its commands. `risen`: a shadow's message to a player (fight-save.ts `Beside`).
   * @param {readonly Command[]} cmds @param {import('../core/combat/fight-save.ts').Links | null} [links]
   * @param {import('../core/save-step.ts').Step<import('../core/save.ts').Save> | null} [also]
   * @param {import('../core/protocol.ts').RoomEvent | null} [risen]
   */
  function command(cmds, links = null, also = null, risen = null) {
    const c = ctx(), was = fight(), S = A().sync;
    // what the motion compares with: the fight's rows are written into in place (save-step.ts `writeInto`)
    const hpWas = new Map(was ? was.rows.map(r => [r.id, rowHp(r)]) : []), readyWas = new Set(was ? was.rows.filter(r => r.armed && !r.armed.spent).map(r => r.id) : []);
    const r = reduceAll(was, cmds, c), reason = String((r.fight && r.fight.log[0] && r.fight.log[0].text) || 'Fight').slice(0, 120);
    // the fight's totals for a hunter or shadow on another phone: one `vitals` or `shadowHp` message, kept in the outbox under what it stands for (fight-save.ts `fought`), so while the phone is away only the latest waits
    const rf = r.fight;
    const totals = rf ? r.effects.flatMap(fx => (
      fx.type === 'sendRemote'
        ? [S.event('vitals', { to: [fx.remote], fight: rf.id, life: { ...fx.life }, mana: fx.mana, fatigue: fx.fatigue, statuses: fx.statuses.map(s => ({ ...s })), reason })]
        : fx.type === 'sendRemoteShadow'
          ? [S.event('shadowHp', { to: [fx.remote], shadowId: fx.shadowId, hp: fx.hp })]
          : []
    )).flatMap(ev => (ev ? [ev] : [])) : [];
    // an item's use leaves the bag in the same write (fight-save.ts `itemSpent`): this phone's hunter's, or the player's by
    // `spent`. A use is one `act` sent alone; a batch is the GM's edits of rows (`held`), which spend no item
    const sole = cmds.length === 1 ? cmds[0] : undefined, sp = sole ? itemSpent(was, sole) : null, ev = sp && sp.kind === 'remote' ? S.event('spent', { to: [sp.remote], item: sp.item }) : null;
    const spent = !sp ? null : sp.kind === 'local' ? sp : ev ? { kind: /** @type {const} */ ('remote'), event: ev } : null;
    // the fight ended: what each player's hunter did in it goes to its phone as `noted`, in the same write (feature 1's notes 2.3)
    const endedFight = r.fight && r.fight.phase === 'ended' && r.effects.some(fx => fx.type === 'ended') ? r.fight : null;
    const rankOf = key => { const x = remoteList().find(sh => sh.key === key); return x ? x.data.rank : null; };
    const noted = endedFight ? remoteFacts(endedFight, rankOf, fightGateName(store.get())).flatMap(n => { const e = S.event('noted', { to: [n.to], facts: n.facts }); return e ? [e] : []; }) : [];
    // a command the fight refused writes nothing, and its reason is told below; a write the store refused is told by its kind
    const asked = !refused(r.effects), wrote = asked && ui.wrote(ui.FIGHT_TAG, store.apply(`combat-${cmds.map(x => x.type).join('+')}`, s => gateFought(s, r, { links, room: S.room(), totals, stamp: { at: new Date().toISOString(), cap: c.rules.logCap }, also, spent, risen, noted }, c.rules)), WRITE_WORDS);
    const effects = !asked || wrote ? r.effects : NOT_WRITTEN;
    if (wrote && (totals.length || ev || risen || noted.length)) S.flush();
    /** @template {Effect['type']} T @param {T} type @returns {Extract<Effect, { type: T }>[]} */
    const of = type => effects.filter(/** @returns {fx is Extract<Effect, { type: T }>} */ fx => fx.type === type);
    for (const fx of of('turnStarted')) app.emit('combat:turn', { hunterId: fx.hunterId });
    for (const fx of of('defeated')) { const b = rowOf(fight(), fx.id); if (b) app.emit('combat:defeated', { body: b }); }
    for (const fx of of('staggered')) { const b = rowOf(fight(), fx.id); if (b) toast(`${b.name} is staggered and loses the next turn.`, 'warning'); }
    for (const fx of of('omen')) { const b = rowOf(fight(), fx.id), o = b && b.mythic && mythicScriptOf(b.mythic.script).omens[fx.omen]; if (b && o) toast(`${b.name} readies ${o.name}.`, 'warning'); }
    for (const fx of of('phased')) { const b = rowOf(fight(), fx.id), p = b && b.mythic && mythicScriptOf(b.mythic.script).phases[fx.phase]; if (p) toast(`Phase ${fx.phase + 1}: ${p.name}.`); }
    for (const fx of of('omenAnswered')) toast(fx.line);
    for (const fx of asked ? [] : of('refused')) toast(refusalLine(fx.reason, was, cmds), 'warning');
    if (of('burst').length) lastBurst = { n: (lastBurst ? lastBurst.n : 0) + 1, ids: of('burst').map(x => x.id) };
    showEffects(effects, hpWas, readyWas);
    if (of('ended').length && !cmds.some(x => x.type === 'end')) toast('The fight is over. Tap End fight to see the summary.');
    return effects;
  }
  const refused = fx => fx.some(x => x.type === 'refused');
  /** Names the hunter when a shadow guard refuses a command, falling back to REFUSAL_WORDS. */
  function refusalLine(reason, was, cmds) {
    const first = cmds[0];
    if (reason === 'shadowsIn' && first && first.type === 'remove') {
      const who = rowOf(was, first.id);
      if (who) return `Remove ${who.name}'s shadows first.`;
    }
    if (reason === 'shadowCap' && first && first.type === 'add') {
      const sh = first.rows.find(x => x.kind === 'shadow');
      const who = sh ? rowOf(was, sh.owner) : null;
      if (who) {
        const cap = shadowFieldCap(who.sheet.shadows);
        return `${who.name} can field at most ${cap} shadow${cap === 1 ? '' : 's'} in a fight.`;
      }
    }
    return REFUSAL_WORDS[reason];
  }
  /**
   * What a member of `app.api.combat` answers for the effects of what it sent: written, or refused with the refusal told
   * already in the fight's news (`command`), so its caller's `ui.wrote` says nothing more.
   * @returns {import('../core/save-step.ts').Applied}
   */
  const answered = fx => (refused(fx) ? refuse(TOLD) : WROTE);
  /** A member's answer for a row the fight does not hold: the screen asked for a row that is not there, a bug `ui.wrote` reports. */
  const NO_ROW = refuse('no-row');
  /**
   * The dice the fight waits for (fight.ts `owed`), the first each time: a per-round op's or a sickness's dice (`settle`),
   * a broken channel going off at once at half its charge (design 4.1). The dice are this phone's, as for any use. Each
   * one paid leaves the fight's list, so a second look pays nothing more; a refusal stops it.
   */
  function payOwed() {
    if (!canRun()) return;
    for (let o = owed(fight())[0]; o; o = owed(fight())[0]) {
      const row = rowOf(fight(), o.id), release = o.kind === 'release' && row ? releaseCommand(row) : null;
      const fx = o.kind === 'settle' ? command([{ type: 'settle', id: o.id, key: o.key, dice: rollSettle(o.dice, cryptoRandom, settleWeights(fight(), o.id, o.key)) }]) : release ? command([release]) : NOT_WRITTEN;
      if (refused(fx)) return;
    }
  }
  // a fight stored with dice still owed (the page was left before they were rolled) is paid when the app opens
  app.on('ready', () => { payOwed(); void offerDrop(); });

  /**
   * What the fight just did, drawn in the frame after the one that shows it: a burst for a crit, a kill, a stagger and a
   * channel let go; one short shake for a crit and for a hunter going down. It never changes a result. The redraw is a
   * callback of the next frame, and a callback asked for now would run in that same frame after it and read the place of
   * what it just changed (a forced style and layout, 15 to 20 ms at 4x CPU); one frame later the page is laid out already.
   */
  function showEffects(effects, hpWas, readyWas) {
    afterFrame(() => {
      const box = root; if (!box) return;
      const at = id => box.querySelector(`.cmb-row:has([data-pick="${CSS.escape(id)}"])`);
      const card = id => box.querySelector(`.cmb-card[data-cid="${CSS.escape(id)}"]`);
      const tok = id => box.querySelector(`[data-mapbox] [data-tok="${CSS.escape(id)}"]`);
      const seen = n => n && n.getClientRects().length > 0 ? n : null;
      for (const fx of effects) {
        // a stacking status's threshold going off: mana motes thrown out, and the count on the card pops
        if (fx.type === 'burst') { const c = seen(card(fx.id)); for (const n of c ? c.querySelectorAll('.chip.stk') : []) motion.pop(n); }
        const kind = fx.type === 'crit' ? 'crit' : fx.type === 'defeated' ? 'kill' : fx.type === 'staggered' ? 'stagger' : fx.type === 'channel' && fx.state === 'fired' ? 'channel' : fx.type === 'burst' ? 'channel' : null;
        // on the map the token animates its own stagger and channel (map.js); elsewhere the card or the row does
        if ((kind === 'stagger' || kind === 'channel') && seen(tok(fx.id))) continue;
        const el = kind && (seen(tok(fx.id)) || seen(card(fx.id)) || at(fx.id));
        if (el) motion.burst(kind, el);
        // a token's own transform is its place on the map, so its disc shakes
        const shaken = el && (el.querySelector(':scope > .mp-disc') || el);
        if (shaken && (fx.type === 'crit' || kind === 'stagger')) motion.shake(shaken);
      }
      const f = fight();
      for (const r of f ? f.rows : []) if (r.kind === 'hunter' && hpWas.get(r.id) > 0 && !isUp(r)) for (const el of [at(r.id), card(r.id), tok(r.id)]) if (el) motion.shake(el.querySelector(':scope > .mp-disc') || el);
      // an armed reaction that fired (its row's armed turned spent): on the map its token plays it (map.js); elsewhere the card or the row
      for (const r of f ? f.rows : []) {
        if (!(r.armed && r.armed.spent && readyWas.has(r.id)) || seen(tok(r.id))) continue;
        const el = seen(card(r.id)) || at(r.id);
        if (el) motion.burst('stagger', el);
      }
    });
  }
  /** Runs `fn` in the frame after the next one: the next draws the command's result, so what only tells of it waits. */
  const afterFrame = fn => requestAnimationFrame(() => requestAnimationFrame(fn));

  // ── rows joining ──
  const remoteList = () => A().sync.remoteSheets(); // the players' sheets, on the room's GM phone only (sync.ts)
  const haveKeys = f => ({
    ids: new Set((f ? f.rows : []).flatMap(r => (r.holder && r.holder.kind === 'local' ? [r.holder.hunterId] : []))),
    rem: new Set((f ? f.rows : []).flatMap(r => (isRemote(r) ? [remoteKeyOf(r)] : []))),
  });
  /** @returns {JoinRow} */
  const hunterJoin = h => ({ row: hunterRow(h, newId(), rules()), monsterId: null });
  /** @returns {JoinRow} */
  const remoteJoin = r => ({ row: remoteRow(r.data, r.key, newId(), rules()), monsterId: null });
  /** @returns {JoinRow} */
  const shadowJoin = (s, hunter, ownerRowId) => ({ row: shadowRow(s, hunter, ownerRowId, newId(), rules()), monsterId: null });
  /** @returns {JoinRow} */
  const remoteShadowJoin = (s, key, ownerRowId) => ({ row: remoteShadowRow(s, key, ownerRowId, newId(), rules()), monsterId: null });

  // S06/F07: another GM device is already running the room's fight; replacing it needs a confirm.
  const otherGMRunning = () => { const d = inRoomAsGM() && A().sync.doc('fight'); const me = store.get().settings.deviceId; return !!(d && d.active && !d.ended && d.by && d.by !== me); };
  const otherGMLive = () => !fight() && otherGMRunning();
  const confirmReplace = () => ui.confirm({ title: 'Fight running on another device', body: 'Another GM device is running a fight. Replace it?', danger: true, confirmLabel: 'Replace fight' });

  /**
   * Rows join: a new fight in setup when there is none; while it runs each joins at its opening roll. `gate` links a new
   * fight to the gate it was started from. Answers how many joined.
   * @param {JoinRow[]} list @param {import('../core/ids.ts').GateId | null} [gate]
   */
  function add(list, gate) {
    if (!canRun()) return 0;
    const joins = (Array.isArray(list) ? list : [list]).filter(j => j && j.row);
    if (!joins.length) return 0;
    const f = fight(), monsters = Object.fromEntries(joins.flatMap(j => (j.monsterId ? [[j.row.id, j.monsterId]] : [])));
    // a new fight is fought on its gate's map, or on the open arena: one path for both (src/core/registry/maps.ts)
    const m = f ? null : mapOf(gate), rows = joins.map(j => j.row);
    const fx = send({ type: 'add', fightId: f ? f.id : fightId(store.id('f')), rows, openings: running(f) ? rollOpenings(rows.map(r => r.id), cryptoRandom, openingWeights(f, rows)) : [], ...(m ? fightMapOf(m) : {}) },
      { monsters, ...(gate ? { gate } : {}) });
    return refused(fx) ? 0 : rows.length;
  }
  /** The map a fight from `gate` is fought on: the one the gate names in the library, else the open arena. */
  function mapOf(gate) {
    const g = gate ? store.get().gates.find(x => x.id === gate) : null, id = g && g.mapId;
    return (id && store.get().library.maps.find(x => x.id === id)) || openArena(rules());
  }
  /** The side the GM marked surprised before the start (kits design 8.7.5): its first turns come a round later. */
  let surprised = /** @type {import('../core/combat/space.ts').Side | null} */ (null);
  /** Every row's opening roll, and the first turn. */
  function start() {
    const f = fight(); if (!f || f.phase !== 'setup') return;
    send({ type: 'start', openings: rollOpenings(f.rows.map(r => r.id), cryptoRandom, openingWeights(f, f.rows)), ...(surprised ? { surprised } : {}) });
    surprised = null;
  }
  /**
   * Row `r` arms reaction `ability`, or disarms with null (the fight's `arm`): the GM's card and a player's room `arm`
   * alike. A reaction before a turn names a row: `on`, else the one it waits for now, else the first of `waitChoices`
   * (fight-view.ts), which a player's phone offers first too.
   * @param {Body} r @param {import('../core/combat/ability-types.ts').AbilityId | null} ability @param {import('../core/combat/ability-types.ts').CombatantId | null} [on]
   */
  function armRow(r, ability, on = null) {
    const a = ability && r.abilities.find(x => x.id === ability), f = fight();
    if (!a || !a.react || a.react.when !== 'turn' || !f) return send({ type: 'arm', by: r.id, ability });
    const first = waitChoices(spots(f), r.id)[0];
    const named = on || (r.armed && r.armed.ability === a.id ? r.armed.on : null) || (first ? first.id : null);
    if (named) send({ type: 'arm', by: r.id, ability, on: named });
  }

  // ── the turn's actions ──
  /** The current row passes: a standard action's time, then the next turn. */
  function next() { const f = fight(); if (running(f)) send({ type: 'endTurn', by: f.currentId }); }
  /** What aims and steps read of each row (fight-view.ts `Spot`), with its name for the picker. @param {Fight} f @param {import('../core/combat/ability-types.ts').RiseSpec | null} [raise] */
  const spots = (f, raise = null) => f.rows.map(r => {
    const canRise = raise ? canRiseFor(r, f.rows, raise) : canRiseInFight(r, f.rows);
    return { ...spotOf(r), canRise, name: r.name };
  });
  /** The foes `row` may step toward or away from, nearest first, as its first foe ability aims (fight-view.ts `aims`). */
  function foesOf(f, row) {
    const a = row.abilities.find(x => x.aim === 'foe');
    return a ? aims(spots(f), row.id, a, f.grid) : [];
  }
  /** The foe the move control is on: the one picked, else the nearest. `foes` is `foesOf(f, row)`. */
  const pickedFoe = (row, foes) => { const id = picks.get(row.id); return (foes.find(x => x.target.id === id) || foes[0] || null); };
  /** The move control: a full stride or less toward or away from `foe` (fight-view.ts), or null when no tile is better. */
  function stepOf(f, row, dir, foe = pickedFoe(row, foesOf(f, row))) {
    if (!foe) return null;
    return (dir > 0 ? stepToward : stepAway)(spots(f), row.id, foe.target.id, row.sheet.stride, f.grid);
  }
  function walk(row, dir) {
    const f = fight(); if (!running(f)) return;
    const s = stepOf(f, row, dir); if (!s) return;
    send({ type: 'move', by: row.id, to: s.place });
  }
  /**
   * The abilities `row`'s card offers, each with its label. An item's (src/core/registry/abilities.ts `itemAbility`)
   * shows while the hunter of this phone still carries one, with the count; a player uses their own from their phone.
   */
  function shownAbilities(row) {
    const h = localHunter(row);
    return row.abilities.flatMap(a => {
      const iid = itemOfAbility(a); if (iid === null) return [{ a, label: a.name }];
      const it = h ? h.items.find(i => i.id === iid) : null;
      return it && it.qty > 0 ? [{ a, label: `${a.name} ×${it.qty}` }] : [];
    });
  }
  /**
   * `row` uses ability `aid`: the GM picks a target among those the use reaches (fight-view.ts `aims`), the edge rolls
   * what `needs` asks, and the fight's `act` does the rest. The outcome is the line the fight logs. The caller's button is
   * off while the picker is open, so a double tap cannot use it twice.
   */
  async function useAbility(row, aid, b) {
    const f = fight(); if (!running(f)) return;
    const a = row.abilities.find(x => x.id === aid); if (!a) return;
    let aim = row.id;
    if (a.aim === 'place' && a.range === 0) aim = row.place;
    else if (a.aim !== 'self') {
      const all = aims(spots(f, a.raise ?? null), row.id, a, f.grid);
      const list = all.filter(x => x.inRange && x.inShape);
      if (!list.length) {
        const msg = a.aim === 'corpse'
          ? (all.length ? `No fallen monsters in range of ${a.name}. Move closer to a fallen monster first.` : `No fallen monsters can be raised with ${a.name} right now.`)
          : `Nobody in range of ${a.name}. Move closer to ${a.aim === 'ally' ? 'an ally' : 'a foe'} first.`;
        toast(msg, 'warning'); return;
      }
      const first = picks.get(row.id), sorted = [...list.filter(x => x.target.id === first), ...list.filter(x => x.target.id !== first)];
      const R = rules();
      const body = a.aim === 'corpse' && a.raise
        ? (() => { const bn = riseBonus(row, a.raise, R); return `Presence check (${bn >= 0 ? `+${bn}` : `−${-bn}`}) to raise a fallen monster until the fight ends.`; })()
        : undefined;
      const labelOf = x => {
        const d = `${x.dist} tile${x.dist === 1 ? '' : 's'}`;
        if (a.aim === 'corpse' && a.raise) {
          const corpse = rowOf(f, x.target.id);
          if (corpse) return `${x.target.name} · ${d} · DC ${riseDc(row, corpse, R)}`;
        }
        return `${x.target.name} · ${d}`;
      };
      if (b) b.disabled = true;
      const id = await ui.system({ tag: '! Fight', title: `Use ${a.name} on…`, ...(body ? { body } : {}), layout: 'list',
        actions: [...sorted.map((x, i) => ({ label: labelOf(x), value: x.target.id, primary: i === 0 })), { label: 'Cancel', value: null, cancel: true }] });
      if (b) b.disabled = false;
      const t = id ? list.find(x => x.target.id === id) : null; if (!t) return;
      aim = a.aim === 'place' ? t.target.place : t.target.id;
    }
    useAt(row, a, aim);
  }
  /** The dice `n` asks for a use by row `by` of fight `f`, drawn on this phone with the fight's weights (fudge.ts `weightsFor`). */
  const drawnFor = (f, by, n) => rollNeeds(n, cryptoRandom, weightsFor(f, by, n));
  /** `row` uses `a` at `aim` (a row id or a tile): the dice `needs` asks for and the fight's `act` (an item leaves the bag in its write). */
  function useAt(row, a, aim) {
    const g = fight(), u = rowOf(g, row.id); if (!running(g) || !u) return;
    const risenWas = a.raise ? new Set(g.rows.filter(isRisen).map(x => x.id)) : null;
    const prevTop = g.log[0] ?? null;
    const fx = send({ type: 'act', by: u.id, ability: a.id, aim, rolls: drawnFor(g, u.id, needs(a, u, g.rows, aim, g.grid, g.now, rules())) });
    if (refused(fx)) return;
    const after = fight();
    const risenNow = risenWas && after ? after.rows.find(x => isRisen(x) && !risenWas.has(x.id)) : null;
    if (risenNow) afterFrame(() => {
      const box = root; if (!box) return;
      const el = box.querySelector(`[data-mapbox] [data-tok="${CSS.escape(risenNow.id)}"]`) || box.querySelector(`.cmb-row:has([data-pick="${CSS.escape(risenNow.id)}"])`);
      if (el) motion.burst('extract', el);
    });
    const added = after ? (() => { const idx = prevTop ? after.log.indexOf(prevTop) : -1; return idx >= 0 ? after.log.slice(0, idx) : after.log.slice(0, 8); })() : [];
    const targetId = typeof aim === 'string' ? rowOf(g, aim)?.id ?? null : null;
    const riseLine = a.raise && targetId
      ? added.find(l => l.rows.includes(u.id) && l.rows.includes(targetId))?.text ?? null
      : null;
    // the line the use logged, as the fight answers it, once the map or the card shows what it did
    for (const x of fx) if (x.type === 'used') { const said = riseLine || x.line; afterFrame(() => toast(said)); }
  }

  /** `row`'s channel goes off: a holding one on its turn at its charge, a broken one at once at half (design 4.1). */
  function releaseOf(row) {
    const cmd = releaseCommand(row);
    return cmd ? send(cmd) : [];
  }
  /** The `release` of `row`'s channel with the dice it asks for, or null when it holds none. @returns {Command | null} */
  function releaseCommand(row) {
    const g = fight(), u = rowOf(g, row.id), c = u && u.channel, a = c && u.abilities.find(x => x.id === c.ability);
    return running(g) && a ? { type: 'release', by: u.id, rolls: drawnFor(g, u.id, needs(a, u, g.rows, c.aim, g.grid, g.now, rules())) } : null;
  }

  /** Picks `to` (or the nearest tile when null) for the hunter currently dodging; `id` is null for the GM's override. */
  function dodgePick(id, to) {
    const fx = send({ type: 'dodge', id, to });
    if (refused(fx)) return fx;
    for (const x of fx) if (x.type === 'used') { const said = x.line; afterFrame(() => toast(said)); }
    return fx;
  }

  /**
   * Runs monster `by`'s current turn via `autoMonsterTurn` (`policy.ts`), rolling only the dice it requests through
   * `drawnFor` so fudge applies identically to hand rolls and dodge prompts pause as usual.
   * @param {import('../core/combat/ability-types.ts').CombatantId} by
   * @param {import('../core/combat/timeline.ts').Tick | undefined} at
   * @param {{ disabled: boolean } | null} [btn]
   */
  async function autoTurn(by, at, btn = null) {
    if (otherGMRunning()) {
      if (btn) btn.disabled = true;
      const ok = await confirmReplace();
      if (btn) btn.disabled = false;
      if (!ok) return;
    }
    const g = fight();
    const plan = autoMonsterTurn(g, by, rules(), at);
    if (plan.kind === 'refused') { toast(REFUSAL_WORDS[plan.reason], 'warning'); return; }
    if (!running(g)) return;
    const cmd = plan.kind === 'ready' ? plan.command : plan.command(drawnFor(g, plan.by, plan.needs));
    const fx = send(cmd);
    if (refused(fx) || fx.some(x => x.type === 'dodgeAsked')) return;
    const used = fx.filter(x => x.type === 'used');
    if (used.length) { for (const x of used) if (x.type === 'used') { const said = x.line; afterFrame(() => toast(said)); } }
    else if (plan.note) { const said = plan.note; afterFrame(() => toast(said)); }
  }

  // ── a player's tap from another phone (`step`, `cast`, `pass` and `dodge`) ──
  /**
   * The last player's tap this phone turned down, for the fight doc (fight-doc.ts `DocRefusal`): the player's phone shows
   * its reason, with a count raised at each one so each is news once. Its one writer is the handler below.
   * @type {import('../core/combat/fight-doc.ts').DocRefusal | null}
   */
  let tableRefusal = null;
  /**
   * The thresholds that went off in this phone's last command that set any off, for the fight doc (fight-doc.ts
   * `DocBurst`): a player's phone shows each once by its count, raised at each. Its one writer is `send`.
   * @type {import('../core/combat/fight-doc.ts').DocBurst | null}
   */
  let lastBurst = null;
  /** Puts the refusal `reason` of row `id`'s tap in the next fight doc, when it is one a player's tap can meet. */
  function turnDown(id, reason) {
    const f = fight(), r = oneOf(reason, TABLE_REFUSALS, null); if (!running(f) || !r) return;
    // no save write: sync.ts republishes the room's docs after it hands out a poll's events (`sync:event`), and the
    // fight doc it puts then carries this refusal
    tableRefusal = { id, at: f.now, reason: r, n: (tableRefusal ? tableRefusal.n : 0) + 1 };
  }
  // a player arms its hunter's reaction at any time (kits design 8.4.2): the room's `arm`, from that hunter's phone only
  // (`ownSheet`), is the fight's `arm` for that hunter's row
  app.on('sync:event', ({ event }) => {
    if (!event || event.type !== 'arm' || !inRoomAsGM()) return;
    const f = fight(), p = event.payload;
    const r = f && f.phase !== 'ended' ? f.rows.find(x => remoteKeyOf(x) === p.by) : null;
    if (r) armRow(r, p.ability, p.on ?? null);
  });
  app.on('sync:event', ({ event }) => {
    if (!event || event.type !== 'dodge' || !inRoomAsGM()) return;
    const f = fight(), p = event.payload;
    if (!running(f)) return;
    const id = onDodge(f, p);
    if (!id) return;
    const fx = dodgePick(id, place(p.place.x, p.place.y));
    const no = fx.find(x => x.type === 'refused');
    if (no && no.type === 'refused') turnDown(id, no.reason);
  });
  app.on('sync:event', ({ event }) => {
    if (!event || (event.type !== 'step' && event.type !== 'cast' && event.type !== 'pass') || !inRoomAsGM()) return;
    const f = fight(), p0 = event.payload;
    if (!running(f)) return;
    const id = onTurn(f, p0);
    if (!id) { const r = f.rows.find(x => remoteKeyOf(x) === p0.by); if (r) turnDown(r.id, 'notYourTurn'); return; }
    /** @param {readonly Effect[]} fx */
    const told = fx => { const no = fx.find(x => x.type === 'refused'); if (no && no.type === 'refused') turnDown(id, no.reason); };
    if (event.type === 'pass') { told(send({ type: 'endTurn', by: id })); return; }
    if (event.type === 'step') { const s = event.payload; told(send({ type: 'move', by: id, to: place(s.place.x, s.place.y), ...(s.dash ? { dash: true } : {}) })); return; }
    const p = event.payload;
    const u = rowOf(f, id), a = u && u.abilities.find(x => x.id === p.ability); if (!u || !a) { turnDown(id, 'unknownAbility'); return; }
    // a player's tap on the ability their channel holds is its Release (the hotbar's), at the charge it has
    if (u.channel && u.channel.state === 'holding' && u.channel.ability === a.id) { told(releaseOf(u)); return; }
    const aim = typeof p.aim === 'string' ? p.aim : place(p.aim.x, p.aim.y);
    const rolls = drawnFor(f, id, needs(a, u, f.rows, aim, f.grid, f.now, rules()));
    told(send({ type: 'act', by: id, ability: a.id, aim, rolls }));
  });

  // ── hand edits ──
  /** @param {Body} r @param {{ hp?: number; mana?: number; fatigue?: number }} d */
  const adjust = (r, d) => !refused(send({ type: 'adjust', id: r.id, ...d }));
  /**
   * Revive of a row (its card's, and the GM board's for a player's hunter this fight holds): the fight's `revive` command,
   * which stands only the dead up, at the life table's revive HP, with every status taken off. The fight holds every
   * row's life, a player's hunter's too, so the sheet hears it from the write-back: in the same write for this phone's
   * hunter (`vitals`), through the room's `vitals` message for a player's. False when it was refused.
   * @param {Body} r
   */
  const revive = r => answered(send({ type: 'revive', id: r.id }));
  // shared numeric HP entry: '7' damages, '+4' heals; forceHeal = the Heal button. inp = the field to keep focused (Enter path)
  function applyAmount(r, text, forceHeal, inp) {
    if (!r) return;
    const H = A().hunter, a = H.parseAmount(text);
    if (!a) { say(H.amountMsg(text)); toast(H.amountMsg(text), 'warning'); return; }
    const heal = forceHeal || a.heal, f0 = fight(), before = f0 ? cardOf(f0, r, rules()).hp : 0;
    if (!adjust(r, { hp: heal ? a.n : -a.n })) return;
    const f = fight(), x = rowOf(f, r.id), after = f && x ? cardOf(f, x, rules()).hp : before;
    amounts.delete(r.id); if (inp) { inp.value = ''; inp.focus(); }
    say(`${r.name} ${heal ? 'healed' : 'took'} ${Math.abs(after - before)} HP (entered ${a.n}). Current HP: ${after}.`);
  }
  const amounts = new Map();
  const $live = () => root && root.querySelector('[data-amtlive]');
  const say = m => { const l = $live(); if (l) l.textContent = m; };
  function removeRow(r) { send({ type: 'remove', id: r.id }); sel = null; }
  /** The Status window: a status put on `r` from the GM, at the tier the window picked (the target's rank by default). */
  async function addStatus(r) {
    const st = await A().forge.status({ mode: 'apply', title: `Status for ${r.name}`, target: r.name, rank: rankOf(r) });
    if (!st || !st.key) return;
    const def = rules().conditions[st.key] || st.def; if (!def) return;
    const tier = st.source && Number.isFinite(st.source.tier) ? st.source.tier : r.tier;
    send({ type: 'status', id: r.id, add: statusGrant(st.key, def, st.rounds ?? null, tier, rules()) });
  }

  // ── the end of a fight ──
  /** When a step happens: now, today's day key at the save's reset hour, and the rules (hunter.js `dayNow`). */
  const dayNow = () => ({ ...stepTime(store.get(), new Date()), R: rules() });
  /** A bestiary monster's XP, for a gate's roster. */
  const xpOf = id => { const m = A().bestiary.get(id); return m ? monsterXp(m, rules()) : 0; };
  /**
   * The summary: who went down, the XP and what the gate already paid, the rounds, the loot. Award XP or End without XP
   * end the fight (a fight that ended itself is over already), then settle it in one step (src/core/gates/pay.ts
   * `settleEncounter`): the gate paid, each hunter here given its share, each player's award in the outbox, the fight
   * cleared. A reload after the end and before the settle finds the fight over, and End fight settles it then.
   */
  async function endEncounter() {
    const f = fight(); if (!f) return;
    const over = f.phase === 'ended', shown = over ? f : reduce(f, { type: 'end' }, ctx()).fight;
    if (!shown || shown.phase !== 'ended') return;
    const R = rules(), links = refs();
    const plan = planEncounter(shown, links.gate, store.get(), R.gateParty, xpOf), nPart = plan.payees.length;
    const lines = plan.dead.length || shown.banked ? plan.dead.map(r => `${r.name}: ${ui.fmt(r.xp)} XP`) : ['No monsters were defeated.'];
    if (shown.banked) lines.push(`Monsters removed from the fight: ${ui.fmt(shown.banked)} XP`);
    lines.push(`Total XP: ${ui.fmt(plan.xp)}`);
    if (plan.covered) lines.push('The gate\'s XP has already been awarded.');
    else if (nPart) lines.push(`Each hunter receives ${ui.fmt(plan.each)} XP${plan.shared ? `, a share of the gate's XP for ${nPart} hunter${nPart === 1 ? '' : 's'}` : ''}.`);
    // what the defeated monsters drop (their bestiary entry's loot): listed here, given by the GM through the Award form
    const loot = lootOf(plan.dead.flatMap(r => { const mid = links.monsters[r.id], m = mid ? A().bestiary.get(mid) : null; return m ? [m.loot] : []; }));
    const lootLine = lootText(loot);
    if (lootLine) lines.push(`Loot: ${lootLine}`);
    const rested = shown.summary.rested ? Object.entries(shown.summary.rested) : [];
    if (rested.length) {
      const who = rested.map(([id, n]) => { const r = shown.rows.find(x => x.id === id); return `${r ? r.name : id} ${n}`; });
      lines.push(`Fatigue recovered: ${who.join(', ')}.`);
    }
    /** @type {import('./ui.js').SystemAction[]} */
    const actions = [over ? { label: 'Close', value: null, cancel: true } : { label: 'Keep fighting', value: null, cancel: true }];
    if (plan.award > 0 && nPart) actions.push({ label: 'Award XP to party', value: 'award', primary: true });
    actions.push({ label: 'End without XP', value: 'skip', primary: !(plan.award > 0 && nPart) });
    const body = `${plan.dead.length} defeated in ${plan.rounds} round${plan.rounds === 1 ? '' : 's'}.`;
    const v = await ui.system({ tag: '! Fight', title: 'Fight over', kind: 'quest', body, lines, actions });
    if (v !== 'award' && v !== 'skip') return;
    const curFight = fight();
    if (curFight && curFight.phase !== 'ended') send({ type: 'end' });
    const ended = fight(); if (!ended || ended.phase !== 'ended' || ended.id !== plan.fightId) return;
    // the plan again from the fight as it ended (the end the GM confirmed), then one step
    const done = planEncounter(ended, links.gate, store.get(), R.gateParty, xpOf), S = A().sync;
    const posts = { room: S.room(), events: encounterAwards(done, v).flatMap(b => { const e = S.event('award', b); return e ? [e] : []; }) };
    /** @type {{ settled: import('../core/gates/pay.ts').Settled | null }} */
    const out = { settled: null };
    if (!ui.wrote('! Fight', store.apply('combat-ended', sv => { const r = settleEncounter(sv, done, v, posts, dayNow(), loot); if (isRefused(r)) return r; out.settled = r; return r.save; }))) return;
    const settled = out.settled;
    if (!settled) return;
    S.flush();
    sel = null;
    // the rewards window is queued before combat:end, so a gate's "Encounter over" question comes after it
    const party = settled.granted.length ? showParty(settled.granted, { title: 'Fight rewards', body }) : null;
    app.emit('combat:end', { fight: ended, gateId: links.gate, offerClasses: settled.offerClasses ?? null });
    const remote = done.payees.filter(p => p.kind === 'remote');
    if (pays(done, v) && remote.length && !settled.granted.length) {
      const names = remote.map(x => x.name).join(', '), s = remote.length === 1 ? 's' : '';
      const news = postNews(posts.events.length ? { ok: true } : { ok: false, why: posts.room ? 'notEvent' : 'noRoom' }, S.conn());
      toast(news === 'sent' ? `XP sent to ${names}.` : news === 'waits' ? `Saved. ${names} will get the XP once the room server confirms it.`
        : news === 'noRoom' ? `${names} need${s} to be in a room to get XP. Use the room button at the top to create or reopen one.` : `Could not send XP to ${names}. The room server rejected the award.`, news === 'sent' || news === 'waits' ? 'info' : 'warning');
    }
    await party;
    await offerDrop();
  }
  /**
   * The oldest drop the GM has not dealt with (`Save.loot`, added to by each settle, pay.ts `lootOffered`): Award loot…
   * opens the Award form with it, whose send deals it; Set aside deals it and offers the next; Later keeps them all,
   * offered again when the app next opens or the next fight ends.
   */
  async function offerDrop() {
    for (;;) {
      const loot = store.get().loot, d = lootOffered(loot); if (!d || !app.isGM()) return;
      const more = loot.at === 'waiting' ? loot.drops.length - 1 : 0;
      const after = more ? ` ${lootMoreLine(more)}` : '';
      const give = await ui.system({ tag: '! Fight', title: 'Loot dropped', kind: 'quest', body: `Tap Award loot to open the Award form with this loot. Tap Set aside to skip awarding it.${after}`, lines: [lootText(d)],
        actions: [{ label: 'Later', value: null, cancel: true }, { label: 'Set aside', value: 'aside' }, { label: 'Award loot…', value: 'award', primary: true }] });
      // the Award form opens the drop this window offered, the oldest (gm.js `award.open`)
      if (give === 'award') return A().award.open({ ...newRewards(), gold: d.gold, items: d.items }, undefined, true);
      if (give !== 'aside' || !ui.wrote('! Fight', store.apply('drop-aside', s => dropDealt(s, d.fight)), LOOT_WORDS)) return;
    }
  }
  /** What a fight dropped, in one line: "50 gold, Frost Shard ×2"; '' for nothing. */
  const lootText = l => dropLine(l, ui.fmt);

  /**
   * ONE party summary window (B1) for rewards already given in one step: each hunter's lines (hunter.js `granted`, its
   * level-up window held back) and the level-ups, listed together.
   * @param {readonly { hid: string; g: import('../core/hunter/grant.ts').Granted }[]} granted
   * @param {{ title?: string; body?: string; lines?: string[] }} o
   */
  function showParty(granted, o = {}) {
    const lines = [...(o.lines || [])], ups = [];
    for (const { hid, g } of granted) {
      const h = store.hunter(hid); if (!h) continue;
      const r = A().hunter.granted(hid, g, { silent: true, popup: false });
      lines.push(`${h.name}: ${r.lines.join(', ') || 'no rewards'}`);
      const up = r.levelup && r.levelup.to ? r.levelup : null;
      if (up) ups.push(`${h.name}: LEVEL UP → Lv ${up.to}${up.points > 0 ? ` (+${up.points} ability point${up.points === 1 ? '' : 's'})` : ''}`);
    }
    return ui.system({ tag: '! Notification', kind: ups.length ? 'levelup' : 'quest', title: o.title || 'Party rewards', body: o.body || '', lines: [...lines, ...ups],
      actions: [{ label: 'Close', value: true, primary: true }] }).then(() => undefined);
  }

  // Start-encounter dialog: optional wave picker + party checkboxes (all checked) + "Start the fight now", on the maker shell.
  function partyDialog(o) {
    const hs = store.get().hunters;
    const wavesHtml = o.waves && o.waves.length
      ? `<fieldset class="cmb-party" data-wave-pick><legend>Fight wave</legend>${o.waves.map(w => `<label class="cmb-chk"><input type="radio" name="wave" value="${esc(w.id)}"${w.id === o.wave ? ' checked' : ''}> <span>${esc(w.label)}</span></label>`).join('')}</fieldset>`
      : '';
    return A().maker.open({
      tag: '! Fight', title: o.title, save: 'Start fight', cls: 'cmbd', focus: win => win.querySelector('[data-apply]'),
      build(el) {
        el.innerHTML = `${o.body ? `<p class="n-body">${esc(o.body)}</p>` : ''}
          ${wavesHtml}
          <fieldset class="cmb-party"><legend>Party</legend>${hs.length ? hs.map(h => `<label class="cmb-chk"><input type="checkbox" name="hid" value="${esc(h.id)}" checked> <span>${esc(h.name)}</span></label>`).join('') : '<p class="empty">No hunters yet.</p>'}</fieldset>
          <label class="cmb-chk"><input type="checkbox" name="roll" checked> <span>Start the fight now</span></label>`;
        return {
          save: () => ({
            hids: [...el.querySelectorAll('input[name=hid]:checked')].map(i => i.value),
            roll: Boolean(el.querySelector('input[name=roll]')?.checked),
            wave: el.querySelector('input[name=wave]:checked')?.value ?? null,
          }),
        };
      },
    });
  }
  // cs: rows to add (a gate's monsters). Resolves true once the fight is set up.
  async function startFlow(cs, o = {}) {
    if (!canRun()) return false;
    if (otherGMLive() && !(await confirmReplace())) return false;
    const pick = await partyDialog({ title: o.title || 'Start fight', body: o.body, waves: o.waves, wave: o.wave });
    if (!pick) return false;
    const have = haveKeys(fight()).ids;
    const hs = store.get().hunters.filter(h => pick.hids.includes(h.id) && !have.has(h.id)).map(hunterJoin);
    const pickedWave = o.waves && pick.wave ? o.waves.find(w => w.id === pick.wave) : null;
    const foes = pickedWave ? pickedWave.rows() : (cs || []);
    const joins = [...foes, ...hs];
    if (joins.length && !add(joins, o.gateId || null)) return false;
    if (pick.roll) start();
    app.go('combat');
    return true;
  }

  // ── the fight as the players' table shows it (the room's fight doc, kept by app.api.sync.publish) ──
  A().sync.publish('fight', () => {
    const S = A().sync;
    const doc = fightDoc(fight(), rules(), { by: store.get().settings.deviceId, at: new Date().toISOString(), was: S.doc('fight'), keyOf: hid => parseSheetKey(S.myKey(hid)), refused: tableRefusal, burst: lastBurst, hunterOf: holderHunter });
    // the room takes the doc in its wire shape (fight-doc.ts `fightWire`), which `DOCS.fight` reads back
    return doc && fightWire(doc);
  });

  A().combat = {
    status: (cid, c) => {
      const r = rowOf(fight(), cid); if (!r) return NO_ROW;
      const rk = c.remove ? r.statuses.find(s => s.key === c.remove)?.key : undefined;
      if (c.remove && !rk && !c.add) return WROTE;
      return answered(send({ type: 'status', id: r.id, ...(rk ? { remove: rk } : {}),
        ...(c.add ? { add: statusGrant(c.add.key, c.add.def, c.add.rounds ?? null, c.add.tier, rules()) } : {}) }));
    },
    // a grant's parts this fight holds (grant.ts `Granted.fight`) on their rows, written with the grant's step: all or none
    held: (parts, also) => answered(sendAll(heldCommands(parts, rules()), null, also)),
    adjust: (cid, d, also = null) => { const r = rowOf(fight(), cid); if (!r) return NO_ROW; return answered(send({ type: 'adjust', id: r.id, ...(d.hp ? { hp: int(d.hp) } : {}), ...(d.mana ? { mana: int(d.mana) } : {}), ...(d.fatigue ? { fatigue: int(d.fatigue) } : {}) }, null, also)); },
    revive: cid => { const r = rowOf(fight(), cid); return r ? revive(r) : NO_ROW; },
    spend: (cid, mana, also) => { const r = rowOf(fight(), cid); return r ? answered(send({ type: 'adjust', id: r.id, mana: -Math.abs(int(mana)), pay: true }, null, also)) : NO_ROW; },
    // an extraction's outcome on the corpse's row (the fight's `extract`), and a risen shadow's join in the same write
    extracted: (cid, by, outcome, rose) => answered(send({ type: 'extract', id: combatantId(cid), by: combatantId(by), outcome }, null,
      rose && rose.kind === 'local' ? rose.step : null, rose && rose.kind === 'remote' ? rose.event : null)),
    add: list => add(list), isActive: () => running(fight()),
    startFlow, showParty, okToReplace: async () => !otherGMLive() || confirmReplace(),
    removeRemote: key => {
      const f = fight(); if (!f) return 0;
      const rs = f.rows.filter(r => remoteKeyOf(r) === key), ids = new Set(rs.map(r => r.id));
      const shs = f.rows.filter(r => (r.holder && r.holder.kind === 'remoteShadow' && r.holder.remote === key) || (r.kind === 'shadow' && ids.has(r.owner)));
      shs.forEach(removeRow);
      rs.forEach(removeRow);
      return rs.length;
    }, // R01
    // A hunter of this phone in the running fight uses an item it took in as an ability: the card's use of it.
    useItem: (hid, itemId) => {
      const f = fight(), r = running(f) ? f.rows.find(x => x.holder && x.holder.kind === 'local' && x.holder.hunterId === hid) : null;
      const id = itemAbilityId(itemId);
      if (!r || !r.abilities.some(a => a.id === id)) return false;
      void useAbility(r, id);
      return true;
    },
  };

  // ── UI ──
  ui.css('mythic', MYTHIC_CSS);
  ui.css('combat', `
.cmb-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
.cmb-dodge{flex:1 0 100%;display:flex;flex-wrap:wrap;gap:8px;align-items:center;border:1px solid var(--gold);background:rgba(48,36,10,.45);padding:8px 12px}
.cmb-dodge[hidden]{display:none}
.cmb-dodge p{margin:0;flex:1 1 200px;min-width:0;color:var(--ice);font-size:14px;overflow-wrap:anywhere}
.cmb-dodge button{min-height:44px}
.cmb-head{font-family:var(--font-display);font-weight:700;font-size:18px;color:var(--ice);margin-right:auto;min-width:0;overflow-wrap:anywhere}
.cmb-head small{display:block;font-size:12px;font-weight:400;color:var(--muted);letter-spacing:.08em}
.cmb-main{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;margin-bottom:12px}
@media (min-width:900px){.cmb-main{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);align-items:start}.cmb-main > .cmb-list{order:1}}
.cmb-card{border:1px solid var(--line-bright);background:rgba(10,26,46,.7);padding:12px;display:flex;flex-direction:column;gap:10px;min-width:0}
.cmb-card.turn{box-shadow:0 0 14px rgba(77,216,255,.35)}
.cmb-card h3{margin:0;font-family:var(--font-display);font-size:19px;color:var(--ice);overflow-wrap:anywhere;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.cmb-tag{font-size:12px;letter-spacing:.12em;text-transform:uppercase;border:1px solid var(--line);padding:1px 7px;color:var(--cyan-dim);white-space:nowrap}
.cmb-tag.now{color:var(--cyan);border-color:var(--cyan)}.cmb-tag.lw{color:var(--life);border-color:var(--life)}
.cmb-line{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}
.cmb-line .field{flex:1 1 90px;min-width:0}
.cmb-line .field.sm{flex:0 0 80px}.cmb-line .field.sm .lbl{white-space:nowrap}
.cmb-quick{display:flex;flex-wrap:wrap;gap:6px}
.cmb-quick button{flex:1 1 44px}
.cmb-auto{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.cmb-auto button{min-height:var(--control-h)}
.cmb-stats{font-family:var(--font-mono);font-size:13px;color:var(--ice);display:flex;flex-wrap:wrap;gap:4px 14px}
.cmb-conds{display:flex;flex-wrap:wrap;gap:6px}
.cmb-fx{list-style:none;margin:4px 0 0;padding:0;font-size:13px;color:var(--cyan-dim);overflow-wrap:anywhere}
.cmb-conds .chip{border-color:rgba(199,155,255,.6);color:var(--purple)}
.cmb-ai{min-height:var(--control-h);font-size:13px}
.cmb-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.cmb-row button.cmb-pick{width:100%;display:flex;align-items:center;gap:8px;text-align:left;padding:4px 10px;min-width:0;font-weight:500}
.cmb-row.sel button.cmb-pick{border-color:var(--cyan);box-shadow:0 0 8px rgba(77,216,255,.3)}
.cmb-row.cur button.cmb-pick{border-left:4px solid var(--cyan)}
.cmb-row.down :is(.cmb-init,.cmb-nm,.cmb-cs,.cmb-mini){opacity:.6}.cmb-row.dead :is(.cmb-init,.cmb-nm,.cmb-cs,.cmb-mini){opacity:.45}.cmb-row.dead .cmb-nm{text-decoration:line-through}
.cmb-init{font-family:var(--font-mono);font-weight:700;color:var(--cyan);flex:0 0 28px;text-align:right}
.cmb-nm{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cmb-nm .ic{--ic:var(--icon-order);margin:0 5px 0 0;vertical-align:-3px}
.cmb-card h3 .ic{--ic:var(--icon-card)}
.cmb-mini{flex:0 0 76px;display:flex;flex-direction:column;gap:2px;font-family:var(--font-mono);font-size:12px;text-align:right}
.cmb-mini .bar{height:6px}
.cmb-cs{font-size:12px;color:var(--purple);flex:0 0 auto;max-width:34%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cmb-dn{flex:0 0 auto;padding:0 5px}
@media (max-width:899px){
  .cmb-list{gap:4px}
  .cmb-row.cur button.cmb-pick{background:rgba(77,216,255,.14)}
  .cmb-row.cur .cmb-nm{color:var(--cyan);font-weight:700}
  .cmb-mini{flex-basis:64px}
  .cmb-mini .bar{height:4px}
  .cmb-cs{max-width:30%}
}
.cmb-build summary{cursor:pointer;min-height:40px;display:flex;align-items:center;font-family:var(--font-display);font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan)}
.cmb-build fieldset{border:1px solid var(--line);margin:10px 0 0;padding:8px 10px 12px;min-width:0}
.cmb-build legend{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan-dim);padding:0 6px}
.cmb-log{list-style:none;margin:0;padding:0;max-height:240px;overflow-y:auto;font-size:13px;display:flex;flex-direction:column;gap:3px}
.cmb-log li{color:var(--cyan-dim);overflow-wrap:anywhere;border-bottom:1px solid rgba(27,74,110,.4);padding:2px 0}
.cmb-chk{display:flex;align-items:center;gap:8px;min-height:40px;font-size:13px}
.cmb-chk input{width:20px;height:20px}
.cmb-ab{min-height:40px;min-width:44px;padding:4px 10px;font-family:var(--font-mono);border-color:var(--cyan);color:var(--cyan)}
.cmb-qerr{color:var(--red);font-size:13px;margin:6px 0 0}
@media (min-width:1100px){
  #view-combat:has(> .view-main .cmb-ck):has(> .panels > [data-panel="table-feed"]):not([hidden]){display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:18px;align-items:start}
  #view-combat:has(> .view-main .cmb-ck) > .panels{order:0;position:sticky;top:12px;max-height:calc(100vh - 24px);overflow:auto;margin-top:0}
  #view-combat:has(> .view-main .cmb-ck) > .panels .tb-feed{max-height:none}
  .win.cmb-ck{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);grid-template-rows:auto auto auto auto auto 1fr auto;column-gap:14px;align-items:start}
  .win.cmb-ck > *, .win.cmb-ck .cmb-tools > *{grid-column:1/-1;min-width:0}
  .win.cmb-ck > [data-main], .win.cmb-ck .cmb-main{display:contents}
  .win.cmb-ck .cmb-main > div{grid-column:1;grid-row:4 / span 3;margin-bottom:12px;min-width:0}
  .win.cmb-ck .cmb-list{grid-column:2;grid-row:4;min-width:0}
  .win.cmb-ck [data-loglbl]{grid-column:2;grid-row:5}
  .win.cmb-ck [data-log]{grid-column:2;grid-row:6;max-height:200px}
  .win.cmb-ck [data-buildwrap]{grid-row:7}
  .win.cmb-ck > .hp-amt-msg{margin:0 0 6px}
  .cmb-card .cmb-line .field.sm{flex:0 0 120px}
  .cmb-bgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:18px;align-items:start}
  .cmb-bgrid > .cmb-wide{grid-column:1/-1}
}
@media (min-width:1500px){
  #view-combat:has(> .view-main .cmb-ck):has(> .panels > [data-panel="table-feed"]):not([hidden]){grid-template-columns:minmax(0,1fr) 380px}
  .win.cmb-ck{grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr)}
  .win.cmb-ck .cmb-main > div{grid-column:2}
  .win.cmb-ck .cmb-list, .win.cmb-ck [data-loglbl], .win.cmb-ck [data-log]{grid-column:1}
  .win.cmb-ck [data-log]{max-height:320px}
  .cmb-head small,.cmb-tag,.cmb-mini,.cmb-cs,.cmb-build legend{font-size:13px}
}
@media (pointer:coarse),(max-width:720px){.cmb-build summary{min-height:44px}.cmb-ab{min-height:44px}}
.cmb-view{flex:0 0 auto;flex-wrap:nowrap}.cmb-view>button{min-width:64px}
.cmb-hpwrap{position:relative}
.cmb-hpwrap .bar-shield{position:absolute;inset:0;background:transparent;border-color:transparent;--bar-c:color-mix(in srgb,var(--ice) 55%,transparent)}
.bar-stagger{--bar-c:var(--gold);height:8px}
.cmb-stg{color:var(--gold);font-family:var(--font-body);font-size:12px;letter-spacing:.06em;margin-right:6px}
.cmb-x{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px;color:var(--cyan-dim)}
.cmb-x b{color:var(--ice)}.cmb-x.intent,.cmb-x.intent b{color:var(--warm)}.cmb-x ul{margin:2px 0 0;padding-left:18px;flex-basis:100%;color:var(--ice)}
.cmb-pips{display:inline-flex;gap:4px}.cmb-pips i{width:9px;height:9px;border-radius:50%;background:color-mix(in srgb,var(--mp) 20%,var(--ground));box-shadow:0 0 0 1px color-mix(in srgb,var(--mp) 60%,transparent)}
.cmb-pips i.on{background:var(--mp);box-shadow:0 0 6px var(--mp)}
.cmb-threat summary{cursor:pointer;font-size:13px;color:var(--cyan-dim);min-height:32px;display:flex;align-items:center}
.cmb-threat ul{list-style:none;margin:0;padding:0;display:grid;gap:2px;font-size:13px}.cmb-threat li{display:flex;justify-content:space-between;gap:8px}
.cmb-tools{display:contents}
.cmb-toolshead{display:none}
.win.cmb-mapmode .cmb-tools:not(.open){display:none}
.win.cmb-mapmode .cmb-tools.open{display:flex;flex-direction:column;gap:10px;position:fixed;left:0;right:0;bottom:var(--nav-h,0px);max-height:78vh;overflow:auto;z-index:31;background:var(--ground);border-top:1px solid var(--line-bright);padding:10px 12px 14px;box-shadow:0 -8px 24px rgba(0,0,0,.5)}
.win.cmb-mapmode .cmb-tools.open > *{flex:0 0 auto}
.win.cmb-mapmode .cmb-tools.open .cmb-toolshead{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.cmb-toolshead b{font-family:var(--font-display);letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);margin-right:auto}
.cmb-size,.cmb-fgroup{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}.cmb-step{display:flex;flex-wrap:nowrap;gap:6px;align-items:center}.cmb-size b,.cmb-fgroup b{font-family:inherit;letter-spacing:0;color:inherit;margin:0;min-width:2.2em;text-align:center}
.cmb-size .icon-btn,.cmb-fgroup .icon-btn{min-width:var(--control-h);min-height:var(--control-h)}
.cmb-fudge{display:flex;flex-direction:column;gap:6px}.cmb-fudge[hidden]{display:none}.cmb-fudge .cmb-step{justify-content:space-between}.cmb-fudge .cmb-step .lbl{flex:1 1 auto;min-width:0}
.cmb-fdot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--gold);box-shadow:0 0 6px rgba(255,201,77,.7);margin-left:6px;vertical-align:middle}
.cmb-fz{display:flex;flex-direction:column;gap:6px}.cmb-fz .seg>button{min-width:0}
.cmb-eyes{display:flex;flex-direction:column;gap:4px}.cmb-eyes .seg>button{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.win.cmb-mapmode .cmb-log{max-height:none}
@media (min-width:900px){.win.cmb-mapmode .cmb-tools.open{left:auto;top:0;bottom:0;width:min(520px,100vw);max-height:none;border-top:none;border-left:1px solid var(--line-bright)}}
.cmb-sheetx{display:none}
.cmb-main.map{grid-template-columns:minmax(0,1fr)}
@media (max-width:899px){
  .cmb-main.map > .cmb-list,.cmb-main.map > [data-cardbox]:not(.sheet){display:none}
  .cmb-main.map > [data-cardbox].sheet{position:fixed;left:0;right:0;bottom:var(--nav-h,0px);max-height:55vh;overflow:auto;z-index:30;background:var(--ground);border-top:1px solid var(--line-bright);padding:6px 8px 10px;box-shadow:0 -8px 24px rgba(0,0,0,.5)}
  .cmb-main.map > [data-cardbox].sheet > .cmb-sheetx{display:flex;margin:0 0 4px auto}
}
@media (min-width:900px){.cmb-main.map{grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)}.cmb-main.map > [data-mapbox]{grid-row:1 / span 2}}
@media (min-width:1100px){
  .win.cmb-ck:has(.cmb-main.map){grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);grid-template-rows:auto auto auto auto auto auto 1fr auto}
  .win.cmb-ck .cmb-main.map > [data-mapbox]{grid-column:1;grid-row:4 / span 4}
  .win.cmb-ck .cmb-main.map > [data-cardbox]{grid-column:2;grid-row:4}
  .win.cmb-ck:has(.cmb-main.map) .cmb-list{grid-column:2;grid-row:5}
  .win.cmb-ck:has(.cmb-main.map) [data-loglbl]{grid-column:2;grid-row:6}
  .win.cmb-ck:has(.cmb-main.map) [data-log]{grid-column:2;grid-row:7}
  .win.cmb-ck:has(.cmb-main.map) [data-buildwrap]{grid-row:8}
}
`);

  let root = /** @type {HTMLElement | null} */ (null), sel = /** @type {string | null} */ (null), lastOrder = '', shownLog = /** @type {string[] | null} */ (null);
  /** Under 900 px the map hides the list and the card (the CSS's breakpoint for `.cmb-main.map`). */
  const NARROW = matchMedia('(max-width:899px)');
  /**
   * The map mounted in this screen's fight box, or null while the box shows none: the screen's handle on it, and so the
   * box's state (map-mount.ts `MapSlot`), written only by `slotTo`.
   */
  let mapView = /** @type {import('../core/api.ts').MapView | null} */ (null);
  /**
   * Gives the box event `e` (map-mount.ts `mapSlot`: it `shows` the fight on the map in `box`, or `hides` it) and carries
   * out what it answers: a hidden map is destroyed, not left listening (SMX-views-8.1).
   * @param {'shows' | 'hides'} e @param {HTMLElement | null} [box]
   */
  const slotTo = (e, box = null) => {
    for (const fx of mapSlot(mapView ? 'mounted' : 'empty', e).fx) {
      if (fx === 'mount' && box) mapView = A().map.mount(box, mapSource);
      else if (fx === 'draw' && mapView) mapView.draw();
      else if (fx === 'destroy' && mapView) { mapView.destroy(); mapView = null; }
    }
  };
  /**
   * What is open over the GM's map (audit row 44): nothing, the focused row's card (a phone's sheet), or the Fight tools
   * of fight `of` (Add to the fight, the log, End and Clear), which show while that fight runs in Map view. One writer,
   * `overTo`. Over the page they are the sheets `fightTools` and `rowCard` of src/core/windows.ts, which Escape on top or
   * a tab takes down (`shutOver`). And who opens and closes the Build drawer (map-mount.ts `BuildDrawer`): the screen
   * (`buildWanted`), or the GM's hand for the fight it was moved in. One writer, `drawerTo`.
   * @type {{ at: 'none' } | { at: 'card' } | { at: 'tools'; of: string }}
   */
  let over = { at: 'none' }, build = SCREEN;
  const drawerTo = e => { build = buildDrawer(build, e); };
  /** The fight the Build drawer's hand is for: the one on screen, null when none or it has ended. */
  const drawerFight = f => (f && f.phase !== 'ended' ? f.id : null);
  const overTo = next => { over = next; render(); };
  /** A sheet over the map is taken down by Escape or a tab (src/core/windows.ts `shut`): nothing is open over it after. */
  const shutOver = () => overTo({ at: 'none' });
  /** The Fight tools show over the fight they were opened on, while it runs in Map view. */
  const toolsShown = (f, mapMode) => mapMode && over.at === 'tools' && !!f && over.of === f.id;
  /** The screen's Build drawer: open, but on a desktop once a fight is under way (D02). */
  const buildWanted = f => !(f && f.phase !== 'setup' && f.rows.length && app.layout && app.layout.desktop());
  const FIGHT_VIEWS = /** @type {const} */ (['map', 'list']);
  const fightView = () => store.prefs().fightView;
  /**
   * Whose eyes the GM's map shows (map-view.ts `ViewAs`), kept in this tab with the fight's id: read back through
   * `viewAsOf`, so another fight, or a row gone from this one, reads as everything.
   */
  const eyesMemory = store.device('map-eyes', 'tab');
  const viewAs = f => viewAsOf(eyesMemory.read(), f);
  /**
   * The map's source (src/core/api.ts `MapSource`): this phone's fight seen through the eyes the GM picked, its current
   * row's kit, and the commands `send` takes.
   * @type {import('../core/api.ts').MapSource}
   */
  const mapSource = {
    over: () => {
      const f = fight();
      if (!running(f)) return '';
      const c = rowOf(f, f.currentId);
      const auto = c && c.kind === 'monster' && isUp(c) ? 1 : 0;
      return `${f.dodge ? `d:${f.dodge.n}` : ''}|a:${auto}`;
    },
    input: () => {
      const f = fight(); if (!f || f.phase === 'ended') return null;
      const R = rules(), c = cur(), dg = running(f) ? fightDodge(f, R) : null;
      const actor = !dg && c && !isRemote(c) && !cardOf(f, c, R).down ? c.id : null, as = viewAs(f);
      const eyes = as.kind === 'row' ? eyesChoices(f).find(x => x.id === as.id) || null : null;
      return { fight: f.id, bodies: fightBodies(f, R, () => false, as, holderHunter), grid: f.grid, currentId: running(f) ? f.currentId : null, actor, dodge: dg, eyes, ...fightGround(f, R, as) };
    },
    eyes: {
      choices: () => { const f = fight(); return f ? eyesChoices(f) : []; },
      now: () => { const f = fight(); return f ? viewAs(f) : EVERYTHING; },
      set: v => { const f = fight(); if (f) { eyesMemory.write(/** @type {import('../core/combat/map-view.ts').KeptEyes} */ ({ fight: f.id, as: v })); render(); } },
    },
    order: () => { const f = fight(); return running(f) ? order(f, 6, rules()).map(t => ({ id: t.row.id, name: t.row.name })) : []; },
    kit: () => {
      const f = fight(), c = cur(); if (!running(f) || f.dodge || !c || isRemote(c)) return null;
      const ch = channelView(c, rules());
      return {
        list: shownAbilities(c).map(x => x.a), readyAt: c.readyAt, now: f.now, costCut: c.sheet.costCut, pinKey: pinKeyOf(c), channel: ch && ch.state === 'holding' ? ch : null,
        armed: c.armed ? { ability: c.armed.ability, spent: c.armed.spent } : null, left: usesLeft(c, c.abilities.length),
        itemOf: id => (holderHunter(c)?.items ?? []).find(i => i.id === id) ?? null,
        answers: answersOn(f, shownAbilities(c).map(x => x.a)),
      };
    },
    arm: ability => { const c = cur(); if (c) armRow(c, ability); },
    release: () => { const c = cur(); if (c) releaseOf(c); },
    pass: null,
    // the GM's paint during a fight: a terrain is the fight's `paint`; more of a zone is a new zone like it, for what is left of it
    paint: (tiles, brush) => {
      const f = fight(); if (!f || f.phase === 'ended' || !tiles.length) return;
      let fx;
      if ('terrain' in brush) fx = send({ type: 'paint', tiles, terrain: brush.terrain });
      else {
        const z = f.zones.find(x => x.id === brush.zone); if (!z) return;
        fx = send({ type: 'zoneAdd', zone: { id: zoneId(store.id('z')), name: z.name, tiles, spares: z.spares, tier: z.tier, duration: z.until === null ? null : tick(Math.max(1, z.until - timeOf(f))), ops: z.ops } });
      }
      const no = fx.find(x => x.type === 'refused');
      if (no && no.type === 'refused') toast(no.reason === 'taken' ? 'Someone is standing on that tile.' : no.reason === 'tooMany' ? `A map can have at most ${MAX_ZONES} fields.` : 'Nothing to change there.');
    },
    move: (to, dash) => { const c = cur(); if (c) send({ type: 'move', by: c.id, to, ...(dash ? { dash: true } : {}) }); },
    place: (id, to) => { send({ type: 'place', id, to }); },
    use: (a, aim) => { const c = cur(); if (!c) return; if (aim === null) void useAbility(c, a.id, null); else useAt(c, a, aim); },
    dodge: to => { dodgePick(null, to); },
    offTurn: () => toast('It is not their turn.'),
    waiting: () => false,
    card: id => { sel = id; overTo({ at: 'card' }); },
  };
  const focusRow = f => (f ? (sel ? rowOf(f, sel) : null) || cur() || f.rows[0] || null : null);

  const share = (cur, max) => (max > 0 ? clamp(cur, 0, max) / max : 0);
  /** A bar and its number, bound to the card's fields `<key>`, `<key>Max` and `<key>F` (patch.ts), shown while `<key>F` is not null. */
  const bar = (cls, label, key) => `<div class="bar-row" data-show="${key}F"><div class="bar-head"><span class="lbl">${label}</span><span class="bar-nums"><span data-num="${key}"></span> / <span data-text="${key}Max"></span></span></div><div class="bar bar-${cls}" data-fill="${key}F">${motion.fillMarkup(0)}</div></div>`;
  const quick = n => `<button type="button" data-fk="q${n}" data-q="${n}" aria-label="${n < 0 ? 'Damage' : 'Heal'} ${Math.abs(n)}">${n < 0 ? '−' : '+'}${Math.abs(n)}</button>`;
  const roundsText = s => (s.rounds != null ? ` · ${s.rounds} round${s.rounds === 1 ? '' : 's'}` : '');

  /** The rows in the order their next turns come (fight-view.ts `order`), then those with no turn ahead; in setup as they joined. */
  function listOrder(f) {
    if (!running(f)) return f.rows;
    const seen = [], ids = new Set();
    for (const t of order(f, f.rows.length * 4, rules())) if (!ids.has(t.row.id)) { ids.add(t.row.id); seen.push(t.row); }
    return [...seen, ...f.rows.filter(r => !ids.has(r.id))];
  }

  // ── what the screen shows, as descriptions (src/views/patch.ts): drawn once per row and card, then updated in place ──
  /**
   * The card's template: the GM's (`ro` false) or the read-only one of a player's local fight. Its fields are `cardDesc`'s.
   * One card is drawn and shows the focused row, so a turn that moves the focus rewrites only what differs.
   */
  const cardTemplate = ro => `<div data-attr="class:cls data-cid:key">
      <h3 data-part="head"></h3>
      <div class="cmb-stats"><span>Speed <span data-text="speed"></span></span><span data-armor>Armor <span data-text="armor"></span></span><span>Resist <span data-text="resist"></span></span><span>Move per step <span data-text="stride"></span></span><span data-show="shield">Shield <span data-text="shield"></span> · <span data-text="shieldLeftText"></span></span></div>
      ${ro ? '' : '<div class="slot" data-part="fudgeLine"></div>'}
      <div class="bar-row"><div class="bar-head"><span class="lbl">HP</span><span class="bar-nums"><span data-num="hp"></span> / <span data-text="hpMax"></span></span></div>
        <div class="cmb-hpwrap"><div class="bar bar-hp" data-fill="hpF">${motion.fillMarkup(0)}</div><div class="bar bar-shield" data-show="shieldF" data-fill="shieldF" aria-hidden="true">${motion.fillMarkup(0)}</div></div></div>
      <div class="bar-row" data-show="staggerF"><div class="bar-head"><span class="lbl">Stagger</span><span class="bar-nums"><b class="cmb-stg" data-show="staggered">Staggered · loses <span data-text="staggeredText"></span></b><span data-num="staggerFill"></span> / <span data-text="staggerMax"></span></span></div><div class="bar bar-stagger" data-fill="staggerF">${motion.fillMarkup(0)}</div></div>
      ${ro ? '' : '<div class="slot" data-part="turnAct"></div>'}
      <div class="slot" data-part="xtra"></div>
      ${bar('mp', 'Mana', 'mana')}
      ${bar('fat', 'Fatigue', 'fatigue')}
      ${ro ? '<div class="lbl">Statuses</div><p data-text="condText"></p>' : `<div class="cmb-line">
        <label class="field sm"><span class="lbl" data-text="amtLabel">HP amount</span><input type="text" inputmode="numeric" enterkeyhint="done" autocomplete="off" spellcheck="false" placeholder="7 or +5" title="Press Enter to deal damage. Type +5 or press Shift+Enter to heal." aria-keyshortcuts="d" data-fk="amt" data-amt></label>
        <button type="button" class="danger" data-fk="dmg" data-dmg>Damage</button><button type="button" data-fk="heal" data-heal>Heal</button>
        <span class="slot" data-part="manaBtns"></span>
      </div>
      <div class="cmb-quick" aria-label="Quick damage and heal"><span class="lbl">Quick HP</span>${[-1, -5, -10, 5, 10].map(quick).join('')}</div>
      <div class="slot" data-part="actions"></div>
      <div class="lbl">Statuses</div><div class="cmb-conds" data-part="conds"></div><ul class="cmb-fx" data-part="fx" data-attr="hidden:noFx"></ul>
      <div class="cmb-line"><button type="button" data-fk="cforge" data-cforge title="Add status (S)" aria-keyshortcuts="s">+ Status</button></div>
      <div class="slot cmb-fz" data-part="fudgeBox"></div>
      <div class="cmb-line"><span class="slot" data-part="lifeAct"></span>
        <span class="slot" data-part="extract"></span>
        <button type="button" class="danger" data-fk="remove" data-remove data-attr="aria-label:removeLabel">Remove</button></div>`}
    </div>`;

  /**
   * The card's one control for `r`'s life, as its life's table takes it (row-life.ts `rowLifeTakes`): Mark defeated while
   * it is up, Revive once it is dead. A button the fight would refuse is not drawn (notes-dead-row.md section 7, ruling 3).
   * @param {Body} r
   */
  function lifeActHtml(r) {
    if (isUp(r)) return `<button type="button" data-fk="defeat" data-defeat>${r.kind === 'hunter' ? 'Mark dead' : 'Mark defeated'}</button>`;
    if (rowLifeTakes(r, 'revive')) return '<button type="button" class="primary" data-fk="revive" data-revive>Revive</button>';
    return '';
  }
  /**
   * What `r`'s card shows (`cardTemplate`): every number of fight-view.ts `cardOf` by its name (a new one needs only its
   * node in the template), the bars' shares, and the words and controls from this phone's state.
   */
  function cardDesc(f, r, ro) {
    const R = rules(), k = cardOf(f, r, R), now = k.turn, remote = isRemote(r), pic = rowIcon(r, holderHunter(r));
    // the row holds the life of every body, a player's hunter's too: its word is the row's (row-life.ts `lifeWord`)
    const word = lifeWord(r);
    const tag = word ? `<span class="cmb-tag lw" data-life-at="${r.life.at}">${esc(word)}</span>` : '';
    const base = {
      ...Object.fromEntries(Object.entries(k).filter(([, v]) => v === null || typeof v !== 'object')),
      key: r.id, cls: `cmb-card${now ? ' turn' : ''}`,
      head: `${pic ? icon(pic) : ''}${esc(r.name)} ${ui.rankBadge(rankOf(r))}
        ${now ? '<span class="cmb-tag now">Current turn</span>' : ''}<span class="cmb-tag">${esc(isRisen(r) ? 'risen' : r.kind)}</span>${remote ? '<span class="cmb-tag now">player phone</span>' : ''}${tag}`,
      staggerF: k.stagger ? share(k.stagger.fill, k.stagger.max) : null, staggerFill: k.stagger ? k.stagger.fill : 0, staggerMax: k.stagger ? k.stagger.max : 0,
      staggered: k.stagger ? k.stagger.staggered : null,
      staggeredText: k.stagger && k.stagger.staggered != null ? `${k.stagger.staggered} round${k.stagger.staggered === 1 ? '' : 's'}` : '',
      shieldF: k.shield !== null ? share(k.shield, k.hpMax) : null,
      shieldLeftText: k.shieldLeft != null ? `${k.shieldLeft} round${k.shieldLeft === 1 ? '' : 's'}` : '',
      amtLabel: k.manaMax > 0 ? 'HP / Mana' : 'HP amount',
      xtra: extrasHtml(f, r, k, ro),
      hpF: share(k.hp, k.hpMax), manaF: k.manaMax > 0 ? share(k.mana, k.manaMax) : null, fatigueF: k.fatigueMax > 0 ? share(k.fatigue, k.fatigueMax) : null,
    };
    if (ro) return { ...base, condText: k.statuses.map(s => s.def.label).join(', ') || 'None' };
    // what each status does while it holds, at a glance (detail.ts `statusGlance`); its cap, threshold, triggers and end are its detail's
    const glance = k.statuses.map(s => /** @type {[string, string[]]} */ ([s.def.label, statusGlance(s.def, s.source.tier, R, s.key)])).filter(([, L]) => L.length);
    let actions = '';
    if (now && !k.down) {
      if (remote) actions = `<p class="empty">${esc(r.name)} acts on their own phone.</p>`;
      else {
        const foes = foesOf(f, r), foe = pickedFoe(r, foes), toward = stepOf(f, r, 1, foe), away = stepOf(f, r, -1, foe);
        actions = `<div class="lbl">Abilities</div><div class="cmb-quick">${shownAbilities(r).map(({ a, label }) => {
          const left = readyIn(r.readyAt, a.id, f.now, R), wait = left > 0 ? `ready in ${left} round${left === 1 ? '' : 's'}` : '';
          return `<button type="button" class="cmb-ab" data-fk="ab-${esc(a.id)}" data-ab="${esc(a.id)}" aria-label="${wait ? `${esc(a.name)}, ${wait}` : `Use ${esc(a.name)}`}"${wait ? ' disabled' : ''}>${esc(label)}${wait ? `<small data-wait> · ${wait}</small>` : ''}</button>`;
        }).join('')}</div>
          ${foes.length ? `<div class="cmb-line"><label class="field row-full"><span class="lbl">Move</span><select data-fk="target" data-target>${foes.map(x => `<option value="${esc(x.target.id)}"${foe && foe.target.id === x.target.id ? ' selected' : ''}>${esc(x.target.name)} · ${x.dist} tile${x.dist === 1 ? '' : 's'}</option>`).join('')}</select></label>
          <button type="button" data-fk="toward" data-toward${toward ? '' : ' disabled'} aria-label="Step toward ${esc(foe ? foe.target.name : '')}">Step toward</button><button type="button" data-fk="away" data-away${away ? '' : ' disabled'} aria-label="Step away from ${esc(foe ? foe.target.name : '')}">Step away</button></div>` : ''}`;
      }
    }
    const monsterId = refs().monsters[r.id], entry = monsterId ? A().bestiary.get(monsterId) : null;
    // who may extract: each hunter the fight holds whose job may (rules' extractJobs), this phone's or a player's (its
    // sheet as the room holds it), not the active hunter
    const extractors = k.down && entry && entry.extractable !== false && attemptsLeft(r.extraction ?? UNTRIED, R.shadow.maxAttempts) > 0
      ? f.rows.flatMap(x => { const h = holderHunter(x); return h && A().shadows.canExtract(h) ? [{ row: x, h }] : []; }) : [];
    const waitDodge = running(f) && !!f.dodge;
    const turnAct = now && !k.down && r.kind === 'monster' && running(f)
      ? `<div class="cmb-auto"><button type="button" class="primary" data-fk="auto" data-auto="${esc(r.id)}" data-auto-at="${f.now}"${waitDodge ? ' disabled' : ''}>Auto turn</button></div>`
      : '';
    return {
      ...base,
      manaBtns: k.manaMax > 0 ? '<button type="button" data-fk="mam" data-mana="-1">Mana −</button><button type="button" data-fk="map" data-mana="1">Mana +</button>' : '',
      turnAct,
      actions,
      // a status opens what it does under the chips (app.api.detail); its x takes it off
      conds: k.statuses.map(s => `<span class="chip${s.stacks ? ' stk' : ''}" data-chip="${esc(s.key)}"><button type="button" class="c-info" data-fk="ci-${esc(s.key)}"${A().detail.control('gm-card', `${r.id}|${s.key}`)}><span class="c-ic">${icon(statusIcon(s.key, s.def))}</span>${esc(s.def.label)}${s.stacks ? ` <b class="c-n" data-stacks="${s.stacks}" data-sk="${esc(`${r.id}:${s.key}`)}">${s.stacks}</b>` : ''}${s.def.end && s.rounds != null ? ` · in ${s.rounds} round${s.rounds === 1 ? '' : 's'}` : roundsText(s)}</button><button type="button" data-fk="rc-${esc(s.key)}" data-rc="${esc(s.key)}" aria-label="Remove ${esc(s.def.label)}">✕</button></span>`
        + A().detail.panel('gm-card', `${r.id}|${s.key}`, () => ({ kind: 'status', key: s.key, label: s.def.label, def: s.def, tier: s.source.tier, ...(s.stacks ? { stacks: s.stacks } : {}), left: s.rounds }))).join('') || '<span class="empty">No statuses.</span>',
      fx: glance.map(([l, L]) => `<li><b>${esc(l)}</b>: ${esc(L.join(', '))}</li>`).join(''), noFx: !glance.length,
      lifeAct: lifeActHtml(r),
      extract: extractors.map(x => `<button type="button" data-fk="extract-${esc(x.row.id)}" data-extract="${esc(x.row.id)}">${extractors.length > 1 ? `Extract (${esc(x.h.name)})` : 'Extract'}</button>`).join(''),
      removeLabel: `Remove ${r.name} from the fight`,
      fudgeLine: fudgeLine(k), fudgeBox: fudgeCard(r, k),
    };
  }

  /**
   * The card's lines of design 4: a channel's pips and payoff, a taunt, a monster's intent (the GM sets it and reveals its
   * numbers here) or the target its threat suggests, and behind a tap its threat table with each share.
   */
  function extrasHtml(f, r, k, ro) {
    const name = id => (rowOf(f, id) || { name: 'someone' }).name;
    const at = t => (typeof t === 'string' ? name(t) : `(${t.x}, ${t.y})`);
    const out = [];
    const reacts = r.abilities.filter(a => a.react);
    if (!ro && reacts.length && !k.down) {
      const on = r.armed ? r.armed.ability : '', armedA = reacts.find(a => a.id === on), others = waitChoices(spots(f), r.id);
      const before = armedA && armedA.react.when === 'turn' && r.armed.on
        ? `<label class="field row-full"><span class="lbl">${esc(WAIT_WORDS.label)}</span><select data-fk="garm-on" data-garm-on>${others.map(x => `<option value="${esc(x.id)}"${x.id === r.armed.on ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : '';
      out.push(`<div class="cmb-x react"><span>Reaction</span><div class="seg" role="group" aria-label="Reaction of ${esc(r.name)}">${[{ id: '', name: 'No reaction' }, ...reacts].map(a => `<button type="button" data-fk="garm-${esc(a.id)}" data-garm="${esc(a.id)}" aria-pressed="${on === a.id}">${esc(a.name)}</button>`).join('')}</div>${r.armed ? `<b>${r.armed.spent ? 'Spent' : 'Ready'}</b>` : ''}${before}</div>`);
    }
    if (r.kind === 'summon') {
      const o = r.owner && rowOf(f, r.owner), left = k.summon;
      out.push(isRisen(r)
        ? `<div class="cmb-x summon">Raised by <b>${esc(o ? o.name : 'someone')}</b> · lasts until the fight ends</div>`
        : `<div class="cmb-x summon">Summoned by <b>${esc(o ? o.name : 'someone')}</b>${left !== null ? ` · ${left} round${left === 1 ? '' : 's'} left` : ''}</div>`);
    }
    const c = k.channel;
    if (c) out.push(`<div class="cmb-x chan">${c.state === 'broken' ? 'Channel broken' : 'Channeling'} <b>${esc(c.name)}</b><span class="cmb-pips" data-charge="${c.charge}" aria-label="Charge ${c.charge} of ${c.max}">${Array.from({ length: c.max }, (_, i) => `<i${i < c.charge ? ' class="on"' : ''}></i>`).join('')}</span><span>Power ×${c.factor}</span></div>`);
    if (k.taunt) out.push(`<div class="cmb-x taunt">Taunted by <b>${esc(name(k.taunt.by))}</b>${k.taunt.left !== null ? ` · ${k.taunt.left} round${k.taunt.left === 1 ? '' : 's'}` : ''}</div>`);
    if (r.kind === 'monster') {
      if (k.down && r.rose) out.push('<div class="cmb-x">Already raised in this fight.</div>');
      const i = k.intent;
      if (i && !i.channel) out.push(`<div class="cmb-x intent" data-intent>Intent: <b>${esc(i.name)}</b> at ${esc(at(i.target))}${i.revealed ? `<ul>${i.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ' <small>(numbers hidden from players)</small>'}</div>`);
      const t = k.threat;
      if (t && t.suggest && !i) out.push(`<div class="cmb-x suggest" data-suggest>Suggested target: <b>${esc(name(t.suggest))}</b></div>`);
      if (t && t.shares.length) out.push(`<details class="cmb-threat"><summary>Threat</summary><ul>${t.shares.map(x => `<li><span>${esc(name(x.id))}</span><b>${x.share}%</b></li>`).join('')}</ul></details>`);
      if (!ro && !k.down) out.push(`<div class="cmb-line"><button type="button" data-fk="intent" data-intent-set>Set intent…</button>${i && !i.channel && !i.revealed ? '<button type="button" data-fk="reveal" data-intent-reveal>Reveal</button>' : ''}</div>`);
      // its abilities, each opening what it does (app.api.detail): the GM reads a monster's kit on its card
      if (!ro && r.abilities.length) out.push(`<div class="cmb-x abil"><span>Abilities</span>${r.abilities.map(a => `<button type="button" class="cmb-ai" data-fk="ai-${esc(a.id)}"${A().detail.control('gm-abil', `${r.id}|${a.id}`)}>${esc(a.name)}</button>${A().detail.panel('gm-abil', `${r.id}|${a.id}`, () => ({ kind: 'ability', ability: a }))}`).join('')}</div>`);
    }
    return out.join('');
  }

  /** The GM announces `r`'s next action: an ability, then a target among the rows its side would aim at (fight-view.ts `aims`). */
  async function setIntent(r) {
    const f = fight(); if (!f) return;
    const aid = await ui.system({ tag: '! Fight', title: `${r.name} will use…`, layout: 'list',
      actions: [...r.abilities.map((a, i) => ({ label: a.name, value: a.id, primary: i === 0 })), { label: 'Cancel', value: null, cancel: true }] });
    const a = aid && r.abilities.find(x => x.id === aid); if (!a) return;
    let aim = r.id;
    if (a.aim === 'place' && a.range === 0) aim = r.place;
    else if (a.aim !== 'self') {
      const list = aims(spots(f), r.id, a, f.grid);
      if (!list.length) { toast('No valid targets.', 'warning'); return; }
      const id = await ui.system({ tag: '! Fight', title: `${a.name} at…`, layout: 'list',
        actions: [...list.map((x, i) => ({ label: `${x.target.name} · ${x.dist} tile${x.dist === 1 ? '' : 's'}`, value: x.target.id, primary: i === 0 })), { label: 'Cancel', value: null, cancel: true }] });
      const t = id ? list.find(x => x.target.id === id) : null; if (!t) return;
      aim = a.aim === 'place' ? t.target.place : t.target.id;
    }
    send({ type: 'setIntent', by: r.id, ability: a.id, aim });
  }

  /** A row of the order ahead: its fields are `rowDesc`'s. */
  const rowTemplate = id => `<li data-attr="class:cls"><button type="button" class="cmb-pick" data-fk="pick-${esc(id)}" data-pick="${esc(id)}" data-attr="aria-label:label">
      <span class="cmb-init" data-text="init"></span><span class="slot" data-part="lead"></span><span class="cmb-mini"><span data-text="hp"></span><span class="bar bar-hp" data-fill="f">${motion.fillMarkup(0)}</span></span></button></li>`;
  function rowDesc(f, r, i, fc) {
    const k = cardOf(f, r, rules()), now = k.turn, word = lifeWord(r);
    const cs = k.statuses.map(s => s.def.label).join(', ');
    // the hunter the row holds, this phone's or a player's sheet as the room's parser read it (N8: no guard of its own); a
    // player's row whose sheet left the room draws no badge
    const who = r.kind === 'hunter' ? holderHunter(r) : null, badge = who ? A().identity.badge(who, 'sm') : '';
    // a hunter's badge is its emblem in its colour; any other row's picture is its token's (row-icon.ts)
    const pic = rowIcon(r, who);
    return {
      cls: `cmb-row${now ? ' cur' : ''}${fc && r.id === fc.id ? ' sel' : ''}${k.down ? ` down ${r.life.at}` : ''}`,
      label: `Select ${r.name}${now ? ', current turn' : ''}${word ? `, ${word}` : ''}`,
      init: running(f) && !k.down ? String(i + 1) : '',
      lead: `<span class="cmb-nm">${now ? '▶ ' : ''}${badge || (pic ? icon(pic) : '')}${esc(r.name)}${isRemote(r) ? ' <small>(player phone)</small>' : ''}</span>${cs ? `<span class="cmb-cs">${esc(cs)}</span>` : ''}${word ? `<span class="cmb-dn lw" data-life-at="${r.life.at}">${esc(word)}</span>` : ''}`,
      hp: `${k.hp}/${k.hpMax}`, f: share(k.hp, k.hpMax),
    };
  }

  /** @param {HTMLElement} el */
  function mount(el) {
    root = el;
    A().detail.wire(el, render);
    el.innerHTML = `<section class="win" aria-label="Fight tracker"><span class="cb"></span><h2>Fight</h2>
      <div class="cmb-bar" data-bar><div class="slot" data-part="head"></div><div class="slot" data-part="acts"></div><div class="cmb-dodge" data-dodge role="status" hidden></div></div>
      <p class="hp-amt-msg" data-amtlive role="status" aria-live="polite"></p>
      <div class="myth" data-mythic aria-label="Mythic"></div>
      <div data-main></div>
      <div class="cmb-tools" data-tools aria-label="Fight tools"><div class="cmb-toolshead"><b>Fight tools</b><span class="slot" data-toolacts></span><button type="button" class="quiet" data-toolsx>Close</button></div>
      <div class="cmb-fudge" data-fudge hidden></div>
      <div class="cmb-mythsw" data-mythsw hidden></div>
      <div class="cmb-eyes" data-eyesrow hidden><span class="lbl" aria-hidden="true">View map as</span><div class="seg" role="group" aria-label="View map as" data-eyesseg></div></div>
      <div data-buildwrap><details class="cmb-build" data-build open><summary>Add to the fight</summary><div class="cmb-bgrid">
        <fieldset><legend>Party hunters</legend><div class="add-row flush">
          <label class="field grow"><span class="lbl">Hunter</span><select data-hsel></select></label>
          <button type="button" data-addh>Add hunter</button><button type="button" data-addparty>Add whole party</button></div></fieldset>
        <fieldset><legend>Monsters (bestiary)</legend><div class="add-row flush">
          <label class="field grow"><span class="lbl">Monster</span><select data-msel></select></label>
          <label class="field sm"><span class="lbl">Count</span><input type="number" min="1" max="${MONSTER_BOUNDS.copies}" value="1" inputmode="numeric" data-mcount></label>
          <button type="button" data-addm>Add monsters</button></div></fieldset>
        <fieldset><legend>Summoned shadows</legend><div class="add-row flush">
          <label class="field grow"><span class="lbl">Shadow</span><select data-ssel></select></label>
          <button type="button" data-adds>Add shadow</button></div></fieldset>
        <fieldset class="cmb-wide"><legend>Quick add</legend><form class="add-row flush" data-qform>
          <label class="field grow"><span class="lbl">Quick add (example: Goblin x3, E, skirmisher)</span><input type="text" maxlength="200" data-qline placeholder="Mantis Drone x3, C, skirmisher" autocomplete="off"></label>
          <button type="submit" class="primary" data-qadd>Add</button></form><p class="cmb-qerr" role="alert" data-qerr hidden></p></fieldset>
      </div></details></div>
      <div data-odds hidden></div>
      <div class="lbl sec" data-loglbl>Fight log</div><ul class="cmb-log" data-log aria-live="polite"></ul></div>
    </section>`;
    /** @param {string} s */
    const $q = s => el.querySelector(s);
    /** @param {string} s */
    const val = s => $q(s)?.value ?? '';

    el.addEventListener('keydown', ev => { // numeric HP entry: Enter = damage (a leading + heals), focus stays in the field
      if (ev.key !== 'Enter' || ev.isComposing || !ev.target.matches('[data-amt]') || !canRun()) return;
      ev.preventDefault(); applyAmount(focusRow(fight()), ev.target.value, ev.shiftKey, ev.target); // D02: Shift+Enter heals
    });
    el.addEventListener('input', ev => {
      if (ev.target.matches('[data-amt]')) { const r = focusRow(fight()); if (r) amounts.set(r.id, ev.target.value); }
    });
    el.addEventListener('change', ev => {
      const t = ev.target; if (!canRun()) return;
      if (t.matches('[data-target]')) { const r = focusRow(fight()); if (r) picks.set(r.id, t.value); render(); }
      if (t.matches('[data-garm-on]')) { const f = fight(), r = focusRow(f), target = rowOf(f, t.value); if (r && r.armed && target) armRow(r, r.armed.ability, target.id); }
    });
    el.addEventListener('submit', async ev => {
      if (!ev.target.matches('[data-qform]')) return; ev.preventDefault(); if (!canRun()) return;
      if (otherGMLive() && !(await confirmReplace())) return;
      const inp = $q('[data-qline]'), er = $q('[data-qerr]'); if (!inp || !er) return;
      const o = parseQuick(inp.value);
      if ('error' in o) { er.textContent = `Cannot read "${o.error}". Write it like this: Goblin x3, C, skirmisher.`; er.hidden = false; return; }
      er.hidden = true; er.textContent = '';
      const m = statBlock(rules(), o.rank, { name: o.name, archetype: o.archetype, kind: o.kind });
      const ids = Array.from({ length: o.count }, newId);
      const n = add(monsterRows(m, ids, rules()).map(row => ({ row, monsterId: null })));
      inp.value = ''; if (n) toast(`${n > 1 ? n + ' × ' : ''}${o.name} added.`);
    });
    el.addEventListener('click', async ev => {
      const b = ev.target.closest('button'); if (!b || !el.contains(b) || b.closest('[data-mapbox]')) return;
      const f = fight(), r = focusRow(f), amt = () => (r && amounts.get(r.id)) || '';
      if (b.dataset.fview) { store.setPrefs({ fightView: oneOf(b.dataset.fview, FIGHT_VIEWS, 'map') }); overTo({ at: 'none' }); return; }
      if (b.hasAttribute('data-sheetclose')) { overTo({ at: 'none' }); return; }
      if (b.hasAttribute('data-tools-open')) { overTo(over.at !== 'tools' && f ? { at: 'tools', of: f.id } : { at: 'none' }); return; }
      if (b.hasAttribute('data-toolsx')) { overTo({ at: 'none' }); return; }
      if (b.dataset.pick) { // A3: under 900 px the order sits above the card, so a pick brings the card into view
        sel = b.dataset.pick; overTo({ at: 'card' });
        const card = matchMedia('(max-width:899px)').matches && el.querySelector('.cmb-card');
        if (card) card.scrollIntoView({ block: 'start' });
        return;
      }
      if (b.hasAttribute('data-localdismiss')) { if (app.seat() !== 'player') return; send({ type: 'clear' }); sel = null; return render(); } // F02: local only, never published
      if (!canRun()) return; // P01: everything below is GM-only
      if (b.hasAttribute('data-dodge-auto')) { dodgePick(null, null); return; }
      if (b.hasAttribute('data-dodge-map')) { store.setPrefs({ fightView: 'map' }); overTo({ at: 'none' }); return; }
      if (b.hasAttribute('data-odds-ask') || b.hasAttribute('data-odds-stop')) return; // the odds box's own (odds-box.js)
      if (b.dataset.resize && f) { // the map's size in a fight under way (design 4.8): the fight refuses to cut anyone off
        const k = b.dataset.resize, d = Number(b.dataset.d), no = send({ type: 'resize', w: f.grid.w + (k === 'w' ? d : 0), h: f.grid.h + (k === 'h' ? d : 0) }).find(x => x.type === 'refused');
        if (no && no.type === 'refused') toast(no.reason === 'cutOff' ? 'Cannot shrink the map past a combatant or targeted tile.' : no.reason === 'offGrid' ? `Map sides must be between ${MAP_BOUNDS.size[0]} and ${MAP_BOUNDS.size[1]} tiles.` : 'Nothing to change.');
        return;
      }
      if (b.matches('[data-addh],[data-addparty],[data-addm],[data-adds]') && otherGMLive() && !(await confirmReplace())) return;
      if (b.dataset.fudgeSide !== undefined || b.dataset.fudgeRow !== undefined) {
        const to = Number(b.dataset.to), id = b.dataset.fudgeRow, side = oneOf(b.dataset.fudgeSide, /** @type {const} */ (['party', 'foe']), null);
        const target = id ? rowOf(f, id) : null;
        /** @type {import('../core/combat/fight-types.ts').FudgeScope | null} */
        const scope = side ? { kind: 'side', side } : target ? { kind: 'row', id: target.id } : null;
        if (Number.isInteger(to) && scope) send({ type: 'fudge', set: { kind: 'weight', scope, n: to } });
        return;
      }
      if (b.dataset.fudgeForce !== undefined) {
        const row = rowOf(f, b.dataset.fudgeForce), face = oneOf(b.dataset.face, /** @type {const} */ (['20', '1', '']), '');
        if (row) send({ type: 'fudge', set: { kind: 'force', id: row.id, face: face === '20' ? 20 : face === '1' ? 1 : null } });
        return;
      }
      if (b.hasAttribute('data-mythsw-btn')) { ui.wrote('GM', store.apply('gm-rules', st => mythicSwitched(st, !rules().fight.mythic.scripts))); return; }
      const mid = b.dataset.myland || b.dataset.mydrop || b.dataset.mynext, mrow = mid && rowOf(f, mid);
      if (mrow) {
        if (b.dataset.myland) return landOmenOf(mrow);
        if (b.dataset.mydrop) { send({ type: 'mythic', by: mrow.id, step: 'drop' }); return; }
        const seen = mythicSeenOf(mrow), nx = seen ? mythicHand(seen).next : null;
        if (nx && await ui.confirm({ title: nx.label, body: nx.ask, confirmLabel: nx.yes })) send({ type: 'mythic', by: mrow.id, step: 'next' });
        return;
      }
      if (b.hasAttribute('data-start')) return start();
      if (b.dataset.eyes !== undefined) {
        const eyes = mapSource.eyes; if (!eyes) return;
        const id = oneOf(b.dataset.eyes, eyes.choices().map(c => c.id), null);
        eyes.set(id ? { kind: 'row', id } : EVERYTHING); return;
      }
      if (b.dataset.surp !== undefined) { surprised = b.dataset.surp === 'party' || b.dataset.surp === 'foe' ? b.dataset.surp : null; return render(); }
      if (b.dataset.garm !== undefined && r) {
        const picked = b.dataset.garm ? r.abilities.find(x => x.id === b.dataset.garm)?.id ?? null : null;
        if (!b.dataset.garm || picked) armRow(r, picked);
        return;
      }
      if (b.hasAttribute('data-next')) return next();
      if (b.dataset.auto) {
        const rawAt = b.dataset.autoAt !== undefined ? Number(b.dataset.autoAt) : NaN;
        return autoTurn(combatantId(b.dataset.auto), Number.isFinite(rawAt) ? tick(rawAt) : undefined, b);
      }
      if (b.hasAttribute('data-end')) { overTo({ at: 'none' }); return endEncounter(); }
      if (b.hasAttribute('data-clear')) {
        if (await ui.confirm({ title: 'Clear the fight?', body: 'Clearing removes every combatant and empties the fight log. Nobody gets XP.', danger: true, confirmLabel: 'Clear fight' })) { send({ type: 'clear' }); sel = null; }
        return;
      }
      if (b.hasAttribute('data-addh')) {
        const ref = pickedRef(pickables(store.get().hunters, remoteList()), val('[data-hsel]')), have = haveKeys(f);
        const rm = ref && ref.kind === 'remote' ? remoteList().find(x => x.key === ref.remote) : null;
        if (rm) { if (!have.rem.has(rm.key)) add([remoteJoin(rm)]); return; }
        const h = ref && ref.kind === 'local' ? store.hunter(ref.hunterId) : null; if (h && !have.ids.has(h.id)) add([hunterJoin(h)]); return;
      }
      if (b.hasAttribute('data-addparty')) {
        const have = haveKeys(f);
        const rl = remoteList(), R = rules();
        const hs = store.get().hunters.filter(h => !have.ids.has(h.id) && !(rl.length && untouched(h, R))).map(hunterJoin), rs = rl.filter(x => !have.rem.has(x.key)).map(remoteJoin);
        if (hs.length + rs.length && add([...hs, ...rs])) { toast(`${hs.length + rs.length} hunter${hs.length + rs.length === 1 ? '' : 's'} added.`); }
        return;
      }
      if (b.hasAttribute('data-addm')) {
        const n = copiesOf(val('[data-mcount]')), cs = A().bestiary.toCombatant(val('[data-msel]'), n), first = cs[0]; if (!first) return;
        const o = first.row.origin;
        if (add(cs)) toast(`${n} × ${o.kind === 'monster' ? o.name : first.row.name} added.`); return;
      }
      if (b.hasAttribute('data-adds')) {
        const raw = val('[data-ssel]'), [kind, ownerKey, sid] = raw.split('|');
        if (!kind || !ownerKey || !sid) return;
        if (kind === 'local') {
          const h = store.hunter(ownerKey), s = h && h.shadows.find(x => x.id === sid);
          if (!h || !s) return;
          const ownerRow = f ? f.rows.find(x => x.holder && x.holder.kind === 'local' && x.holder.hunterId === h.id) : null;
          if (!ownerRow) { toast(`Add ${h.name} first, then ${h.name}'s shadows.`, 'warning'); return; }
          if (f && f.rows.some(x => x.holder && x.holder.kind === 'shadow' && x.holder.hunterId === h.id && x.holder.shadowId === s.id)) {
            toast(REFUSAL_WORDS.duplicate, 'warning'); return;
          }
          add([shadowJoin(s, h.id, ownerRow.id)]); return;
        }
        if (kind === 'remote') {
          const rm = remoteList().find(x => x.key === ownerKey), s = rm && (rm.data.shadows || []).find(x => x.id === sid);
          if (!rm || !s) return;
          const ownerRow = f ? f.rows.find(x => remoteKeyOf(x) === rm.key) : null;
          if (!ownerRow) { toast(`Add ${rm.data.name} first, then ${rm.data.name}'s shadows.`, 'warning'); return; }
          if (f && f.rows.some(x => x.holder && x.holder.kind === 'remoteShadow' && x.holder.remote === rm.key && x.holder.shadowId === s.id)) {
            toast(REFUSAL_WORDS.duplicate, 'warning'); return;
          }
          add([remoteShadowJoin(s, rm.key, ownerRow.id)]); return;
        }
        return;
      }
      if (!f || !r) return;
      if (b.hasAttribute('data-dmg') || b.hasAttribute('data-heal')) {
        const line = b.closest('.cmb-line'), inp = line ? line.querySelector('[data-amt]') : null;
        applyAmount(r, inp ? inp.value : amt(), b.hasAttribute('data-heal'), null); return;
      }
      if (b.dataset.q) { adjust(r, { hp: int(b.dataset.q) }); return; }
      if (b.dataset.mana) { const n = int((A().hunter.parseAmount(amt()) || { n: 1 }).n, 1) || 1; adjust(r, { mana: int(b.dataset.mana) * Math.abs(n) }); return; }
      if (b.dataset.rc) {
        const key = r.statuses.find(s => s.key === b.dataset.rc)?.key;
        if (key) send({ type: 'status', id: r.id, remove: key });
        return;
      }
      if (b.hasAttribute('data-cforge')) return addStatus(r);
      if (b.hasAttribute('data-defeat')) { adjust(r, { hp: -cardOf(f, r, rules()).hpMax }); return; }
      if (b.hasAttribute('data-revive')) { revive(r); return; }
      if (b.hasAttribute('data-remove')) { if (await ui.confirm({ title: 'Remove combatant?', body: r.name, danger: true, confirmLabel: 'Remove combatant' })) removeRow(r); return; }
      if (b.dataset.ab) return useAbility(r, b.dataset.ab, b);
      if (b.hasAttribute('data-intent-set')) return setIntent(r);
      if (b.hasAttribute('data-intent-reveal')) { send({ type: 'reveal', by: r.id }); return; }
      if (b.hasAttribute('data-toward')) return walk(r, 1);
      if (b.hasAttribute('data-away')) return walk(r, -1);
      if (b.hasAttribute('data-extract')) {
        const mid = refs().monsters[r.id], m = mid ? A().bestiary.get(mid) : null;
        const o = r.origin.kind === 'monster' ? r.origin : null;
        const exId = b.getAttribute('data-extract'), byRow = exId ? rowOf(f, exId) : null;
        if (!byRow || !byRow.holder || (byRow.holder.kind !== 'local' && byRow.holder.kind !== 'remote')) return;
        /** @type {import('../core/api.ts').ExtractTarget} */
        const corpse = { id: r.id, by: byRow.id, name: r.name, rank: rankOf(r), archetype: o ? o.archetype : 'brute', kind: o ? o.monsterKind : 'normal', monster: mid || null,
          down: cardOf(f, r, rules()).down, extractable: m ? m.extractable !== false : true, left: attemptsLeft(r.extraction ?? UNTRIED, rules().shadow.maxAttempts) };
        const made = await A().shadows.extract(byRow.holder, corpse);
        if (made) { const c = el.querySelector(`.cmb-card[data-cid="${CSS.escape(r.id)}"]`); if (c) motion.burst('extract', c); }
        if (rowOf(fight(), r.id)) toast(made ? `${r.name} rises as a shadow.` : `Extraction of ${r.name} failed.`);
      }
    });
    render();
  }

  /**
   * The quick line: "Mantis Drone x3, C, skirmisher". A count (`x3` or `3x`, 1 to `MONSTER_BOUNDS.copies`), a rank letter (`C`, `rank C`,
   * `C-rank`), an archetype and a kind (normal, elite, boss) in any order; the other words are the name.
   */
  function parseQuick(line) {
    const toks = String(line || '').split(/[,\s]+/).filter(Boolean);
    /** @type {{ names: string[]; count: number; rank: import('../core/rules.ts').Rank; archetype: import('../core/hunter/derive.ts').Archetype; kind: import('../core/hunter/derive.ts').MonsterKind }} */
    const o = { names: [], count: 1, rank: 'E', archetype: 'brute', kind: 'normal' };
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]; if (t === undefined) continue;
      const low = t.toLowerCase(); let m;
      if ((m = /^[x×](\d+)$/i.exec(t)) || (m = /^(\d+)[x×]$/i.exec(t))) { o.count = int(m[1], 1); if (o.count < 1 || o.count > MONSTER_BOUNDS.copies) return { error: t }; }
      else if (oneOf(t, RANKS, null)) o.rank = oneOf(t, RANKS, o.rank);
      else if ((m = /^rank[:=]?([SABCDE])?$/i.exec(t)) || (m = /^([SABCDE])-?rank$/i.exec(t))) { const rk = String(m[1] || toks[++i] || '').toUpperCase(); if (!oneOf(rk, RANKS, null)) return { error: rk || t }; o.rank = oneOf(rk, RANKS, o.rank); }
      else if (oneOf(low, ARCHETYPE_LIST, null)) o.archetype = oneOf(low, ARCHETYPE_LIST, o.archetype);
      else if (oneOf(low, MONSTER_KINDS, null)) o.kind = oneOf(low, MONSTER_KINDS, o.kind);
      else if (/^[\p{L}][\p{L}\p{N}'’.-]*$/u.test(t)) o.names.push(t);
      else return { error: t };
    }
    const name = o.names.join(' ').trim(); // parseMonster bounds the name; rows.ts cuts it to leave room for a pack's letter
    if (!name) return { error: String(line || '').trim() || 'name' };
    return { name, count: o.count, rank: o.rank, archetype: o.archetype, kind: o.kind };
  }

  function fillSelect(sel2, opts, emptyLabel) {
    const sig = JSON.stringify(opts);
    if (sel2.dataset.sig === sig) return;
    sel2.dataset.sig = sig;
    const keep = sel2.value;
    sel2.innerHTML = opts.length ? opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('') : `<option value="">${esc(emptyLabel)}</option>`;
    if (opts.some(([v]) => v === keep)) sel2.value = keep;
  }

  /**
   * The map's Width and Height in a fight under way, as the map maker's steppers (design 4.8): each tap sends `resize`.
   * Each stepper is kept whole on one row: the group wraps between steppers, never inside one.
   */
  const sizeSteps = f => `<span class="cmb-size" role="group" aria-label="Map size">${['w', 'h'].map(k => `<span class="cmb-step"><span class="lbl">${k === 'w' ? 'Width' : 'Height'}</span>`
    + `<button type="button" class="icon-btn" data-resize="${k}" data-d="-1" aria-label="Fewer ${k === 'w' ? 'columns' : 'rows'}">−</button><b data-mapsize="${k}">${f.grid[k]}</b>`
    + `<button type="button" class="icon-btn" data-resize="${k}" data-d="1" aria-label="More ${k === 'w' ? 'columns' : 'rows'}">+</button></span>`).join('')}</span>`;

  const signed = n => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
  /** A stepper of the GM's weight: `attrs` names what it sets, each tap sends the value it shows plus or minus one. */
  const weightStepper = (label, n, attrs, name) => `<span class="cmb-step"><span class="lbl">${esc(label)}</span>`
    + `<button type="button" class="icon-btn" ${attrs} data-to="${n - 1}" aria-label="Lower the fudge for ${esc(name)}">−</button><b>${signed(n)}</b>`
    + `<button type="button" class="icon-btn" ${attrs} data-to="${n + 1}" aria-label="Raise the fudge for ${esc(name)}">+</button></span>`;
  /**
   * The Fight tools' Fudge block (notes-8-fudge.md section 2): the hunters' weight and the foes', each `− n +`, with the gold
   * dot while any weight or forced roll is on. Read from the fight; a tap sends the `fudge` command. Empty where nobody sees it.
   */
  function fudgeBlock(f) {
    if (!f || f.phase === 'ended' || !f.rows.length) return '';
    return `<span class="lbl">Fudge on dice rolls${fudgeShown(f) ? '<i class="cmb-fdot" aria-hidden="true"></i><span class="sr-only"> on</span>' : ''}</span>`
      + `<div class="cmb-fgroup" role="group" aria-label="Fudge on dice rolls">${weightStepper('All hunters\' rolls', f.fudge.sides.party, 'data-fudge-side="party"', 'all hunters')}${weightStepper('All foes\' rolls', f.fudge.sides.foe, 'data-fudge-side="foe"', 'all foes')}</div>`;
  }
  /** The line at the top of a card while its row has a weight or a forced next roll: "Fudge +2", "Next d20 forced: 20". */
  const fudgeLine = k => (k.fudge !== 0 || k.forced !== null
    ? `<div class="cmb-x" data-fudgeline>${k.fudge !== 0 ? `<b>Fudge ${signed(k.fudge)}</b>` : ''}${k.forced !== null ? `<b>Next d20 forced: ${k.forced}</b>` : ''}</div>` : '');
  /** A card's own controls: the row's stepper and its Force next d20 choice. */
  function fudgeCard(r, k) {
    const face = [[20, 'Natural 20', '20'], [1, 'Natural 1', '1'], [null, 'Don\'t force', 'Off']];
    return `<div class="cmb-fgroup">${weightStepper(`Fudge on ${r.name}'s rolls`, k.fudgeOwn, `data-fudge-row="${esc(r.id)}"`, r.name)}</div>`
      + `<div class="cmb-x"><span>Force ${esc(r.name)}'s next d20</span><div class="seg" role="group" aria-label="Force ${esc(r.name)}'s next d20">${face.map(([v, l, fk]) =>
        `<button type="button" data-fk="fz-${fk}" data-fudge-force="${esc(r.id)}" data-face="${v ?? ''}" aria-pressed="${k.forced === v}">${l}</button>`).join('')}</div></div>`;
  }

  /**
   * The Fight tools' See as row (notes-7-stealth.md section 6): Everything, then each foe row whose eyes the map may show,
   * the one the map shows pressed (`mapSource.eyes`).
   */
  function eyesRow() {
    const e = mapSource.eyes; if (!e) return '';
    const now = e.now(), on = id => (now.kind === 'row' ? now.id === id : id === '');
    return [{ id: '', name: 'Everything' }, ...e.choices()].map(c => `<button type="button" data-fk="eyes-${esc(c.id)}" data-eyes="${esc(c.id)}" aria-pressed="${on(c.id)}">${esc(c.name)}</button>`).join('');
  }

  /** The GM's banner while the fight waits for a hunter to pick a dodge tile. */
  function dodgeBannerHtml(f, onMap) {
    if (!running(f) || !f.dodge) return '';
    const dg = fightDodge(f, rules()), who = dg ? rowOf(f, dg.who) : null;
    if (!dg || !who) return '';
    const remote = isRemote(who), ab = dg.ability || 'the blast', bank = `${dg.left} of ${dg.max} movement left`;
    const msg = dg.mode === 'caught'
      ? remote ? `Waiting for ${who.name} to pick a tile for ${ab} (no way clear, ${bank}).`
        : `${who.name} cannot clear ${ab} (${bank}). Pick any reachable tile or stay put.`
      : dg.mode === 'ring'
        ? remote ? `Waiting for ${who.name} to pick a tile for ${ab} (outer ring at best, ${bank}).`
          : `${who.name} can reach the outer ring of ${ab} (${bank}). Pick any reachable tile on the map.`
        : remote ? `Waiting for ${who.name} to dodge ${ab} (${bank}).`
          : `${who.name} dodges ${ab} (${bank}). Pick any reachable tile on the map.`;
    const stayAuto = dg.auto.x === who.place.x && dg.auto.y === who.place.y;
    const auto = dg.mode === 'caught' ? 'Stay put (full hit)'
      : dg.mode === 'ring' ? (stayAuto ? 'Stay in outer ring' : 'Use nearest ring tile')
        : 'Use nearest safe tile';
    const open = !onMap ? '<button type="button" class="primary" data-fk="dodge-map" data-dodge-map>Open map to dodge</button>' : '';
    return `<p>${esc(msg)}</p>${open}<button type="button" data-fk="dodge-auto" data-dodge-auto>${auto}</button>`;
  }

  /** The bar: what the fight is doing and the order ahead (`head`), then the GM's buttons for its state (`acts`). */
  function barDesc(f, gm, elsewhere, mapMode, tools) {
    const n = f ? f.rows.length : 0, act = running(f), turn = act ? order(f, 8, rules()) : [], firstTurn = turn[0], waitDodge = act && !!f.dodge;
    const head = act ? `Round ${firstTurn ? firstTurn.round : 1}<small>Turn: ${esc(firstTurn ? firstTurn.row.name : '-')}</small><small data-ahead>Next: ${turn.slice(1).map(t => esc(t.row.name)).join(' → ') || '-'}</small>`
      : f && f.phase === 'ended' ? 'Fight over<small>Tap End fight to see the summary</small>'
        : n ? 'Ready to fight<small>Tap Start fight to begin</small>' : 'No fight<small>Add hunters and monsters below</small>';
    if (!gm) return n ? { tools: '', head: `${elsewhere}<div class="cmb-head">${head}<small>View only: the GM runs the fight.</small></div>`, acts: '<button type="button" data-dismiss data-localdismiss>Dismiss this fight</button>' }
      : { tools: '', head: `${elsewhere}<p class="empty" data-idle>The GM is not running a fight.</p>`, acts: '' };
    const seg = n && f.phase !== 'ended' ? `<div class="seg cmb-view" role="group" aria-label="Fight view">${FIGHT_VIEWS.map(v => `<button type="button" data-fk="fv-${v}" data-fview="${v}" aria-pressed="${fightView() === v}">${v === 'map' ? 'Map' : 'List'}</button>`).join('')}</div>` : '';
    if (mapMode) {
      const c = act ? rowOf(f, f.currentId) : null;
      const autoBtn = c && c.kind === 'monster' && isUp(c)
        ? `<button type="button" data-fk="bar-auto" data-auto="${esc(c.id)}" data-auto-at="${f.now}"${waitDodge ? ' disabled' : ''}>Auto turn</button>`
        : '';
      return {
        head: `${elsewhere}<div class="cmb-head">Round ${firstTurn ? firstTurn.round : 1}</div>`,
        acts: `${seg}<button type="button" data-fk="tools" data-tools-open aria-expanded="${tools}"${fudgeShown(f) ? ' aria-label="Fight tools, fudge on"' : ''}>Fight tools${fudgeShown(f) ? '<i class="cmb-fdot" aria-hidden="true"></i>' : ''}</button>
        ${autoBtn}<button type="button" class="primary" data-fk="next" data-next aria-label="Next turn" title="Next turn (N)" aria-keyshortcuts="n"${waitDodge ? ' disabled' : ''}>Next ▶</button>`,
        tools: `${sizeSteps(f)}<button type="button" data-fk="end" data-end>End fight</button><button type="button" class="danger" data-fk="clear" data-clear aria-label="Clear the fight">Clear fight</button>`,
      };
    }
    return {
      tools: '',
      head: `${elsewhere}<div class="cmb-head">${head}</div>`,
      acts: `${seg}${f && f.phase === 'setup' && n ? `<div class="seg cmb-surp" role="group" aria-label="Surprised">${[['', 'No surprise'], ['party', 'Party surprised'], ['foe', 'Foes surprised']].map(([v, l]) => `<button type="button" data-fk="surp-${v || 'none'}" data-surp="${v}" aria-pressed="${(surprised || '') === v}">${l}</button>`).join('')}</div>` : ''}${f && f.phase === 'setup' ? `<button type="button" class="primary" data-fk="start" data-start${n ? '' : ' disabled'}>Start fight</button>` : ''}
      ${act ? `<button type="button" class="primary" data-fk="next" data-next aria-label="Next turn" title="Next turn (N)" aria-keyshortcuts="n"${waitDodge ? ' disabled' : ''}>Next ▶</button>` : ''}
      <button type="button" data-fk="end" data-end${n ? '' : ' disabled'}>End fight</button>
      <button type="button" class="danger" data-fk="clear" data-clear aria-label="Clear the fight"${f ? '' : ' disabled'}>Clear fight</button>`,
    };
  }

  /** The strip and omen banner of each mythic still up in the fight, as markup (mythic-html.js); the GM's phone adds its hand once the fight can take it (`can(f, 'mythic')`). */
  function mythicMarkup(f, gm) {
    if (!f || f.phase === 'ended') return '';
    const R = rules(), now = timeOf(f), state = f.phase === 'running' ? runningState(f) : null;
    if (f.phase === 'setup' && !R.fight.mythic.scripts) return '';
    const canHand = gm && can(f, 'mythic');
    return f.rows.filter(r => r.mythic && isUp(r)).flatMap(r => {
      const m = mythicSeenOf(r);
      return m ? [mythicBox({ id: r.id, strip: mythicStrip(m, now, R), banner: omenBanner(m, f.rows, now, R), you: null, hand: canHand ? mythicHand(m) : null, turn: !!state && state.at === 'landing' && state.id === r.id })] : [];
    }).join('');
  }
  /** What each of `list` does to the omen standing in `f`, by ability id (fight-view.ts `answersBy`). */
  function answersOn(f, list) {
    const out = {};
    for (const r of f.rows) { const m = r.mythic && isUp(r) ? mythicSeenOf(r) : null; if (m) for (const a of list) { const w = answersBy(a, m); if (w && !out[a.id]) out[a.id] = w; } }
    return out;
  }
  /** The GM lands the standing omen of mythic `row`: its move at its aim, with the dice any use asks for. */
  function landOmenOf(row) {
    const g = fight(), u = rowOf(g, row.id);
    if (!g || g.phase !== 'running' || !u) return;
    const m = omenMove(u, rules()), n = omenNeeds(g, u, rules());
    if (!m || !n) return;
    const fx = send({ type: 'act', by: u.id, ability: m.ability.id, aim: m.aim, rolls: drawnFor(g, u.id, n) });
    for (const x of fx) if (x.type === 'used') { const said = x.line; afterFrame(() => toast(said)); }
  }
  /** The GM's switch for mythic scripts, drawn in the Fight tools. */
  function mythicSwitchMarkup() {
    const on = rules().fight.mythic.scripts, W = MYTHIC_SWITCH_WORDS;
    return `<span class="lbl">${esc(W.label)}</span><button type="button" data-mythsw-btn aria-pressed="${on}">${on ? W.on : W.off}</button><p class="cmb-hint">${esc(W.hint)}</p>`;
  }

  /** The log, newest first: a line the fight added goes in at the top, and only a shorter log is drawn again (patch.ts `prepended`). */
  function drawLog(box, lines) {
    // the shown lines are a copy: the fight's log is written into in place (save-step.ts `writeInto`)
    const prev = shownLog;
    if (prev && lines.length === prev.length && lines.every((l, i) => l === prev[i])) return;
    const li = l => `<li>${esc(l)}</li>`;
    const k = prev && prev.length && lines.length ? prepended(prev, lines) : null;
    if (k === null) box.innerHTML = lines.length ? lines.map(li).join('') : '<li class="empty">Nothing has happened yet.</li>';
    else if (k) { box.insertAdjacentHTML('afterbegin', lines.slice(0, k).map(li).join('')); while (box.children.length > lines.length) box.lastElementChild?.remove(); }
    shownLog = [...lines];
  }

  /** The odds' box (src/views/odds-box.js): shown to the phone that runs the fight, for a fight with a row up on each side. */
  function paintOdds() {
    const box = root && root.querySelector('[data-odds]'), f = fight();
    if (box) A().odds.paint(box, 'fight', canRun() && weighable(f) ? f : null, 'party');
  }

  /**
   * Draws the fight in place (src/views/patch.ts): the bar and the log, then each row of the order ahead and the focused
   * row's card by its key, writing only what changed. When the order changes its rows slide to their new places.
   */
  function render() {
    const el = root; if (!el) return;
    /** @param {string} s */
    const $q = s => el.querySelector(s), f = fight();
    const s = store.get();
    const gm = canRun();
    const wrap = $q('[data-buildwrap]'), bld = $q('[data-build]'), logLbl = $q('[data-loglbl]'), logBox = $q('[data-log]');
    const barBox = $q('[data-bar]'), ta = $q('[data-toolacts]'), fz = $q('[data-fudge]'), sw = $q('[data-mythsw]');
    const my = $q('[data-mythic]'), er = $q('[data-eyesrow]'), es = $q('[data-eyesseg]'), win = $q('.win'), tl = $q('[data-tools]'), main = $q('[data-main]');
    if (!wrap || !bld || !logLbl || !logBox || !barBox || !ta || !fz || !sw || !my || !er || !es || !win || !tl || !main) return;
    wrap.hidden = !gm; // P01: players never get the encounter builder
    const act = running(f), wanted = buildWanted(f);
    drawerTo({ kind: 'drawn', fight: drawerFight(f) });
    if (build.at === 'screen' && bld.open !== wanted) bld.open = wanted;
    const n = f ? f.rows.length : 0, idle = !gm && !n; // a player with no local fight: the GM's HUD is the table, so no empty tracker body
    logLbl.hidden = idle; logBox.hidden = idle;
    const elsewhere = gm && !n && otherGMLive() ? '<p class="empty" data-elsewhere role="status">Another GM device is running a fight. Adding to a fight here replaces it.</p>' : '';
    // a focused control that a redraw replaced or moved (a part, a row, the card of another row) gets its focus back
    const ae = document.activeElement, fk = ae && el.contains(ae) ? ae.dataset.fk : null;
    const caret = fk && ae && ae.selectionStart !== undefined && ae.type !== 'number' ? ae.selectionStart : null;
    const mapMode = gm && !!f && running(f) && fightView() === 'map', tools = toolsShown(f, mapMode);
    // the builder's lists, while it shows (in Map view it is in the Fight tools sheet, which draws them when it opens)
    if (gm && (!mapMode || tools)) {
      const hsel = $q('[data-hsel]'), msel = $q('[data-msel]'), ssel = $q('[data-ssel]');
      if (hsel) fillSelect(hsel, pickables(s.hunters, remoteList()).map(p => [p.id, p.ref.kind === 'remote' ? `${p.name} (player phone)` : p.name]), 'No hunters');
      if (msel) fillSelect(msel, A().bestiary.list().map(m => [m.id, `${m.name} (${m.rank}${m.kind === 'normal' ? '' : ` ${m.kind}`})`]), 'No monsters');
      if (ssel) {
        const localOpts = s.hunters.flatMap(h => h.shadows.filter(x => x.summoned).map(x => [`local|${h.id}|${x.id}`, `${x.name} (${h.name})`]));
        const remoteOpts = remoteList().flatMap(rm => (rm.data.shadows || []).filter(x => x.summoned).map(x => [`remote|${rm.key}|${x.id}`, `${x.name} (${rm.data.name}, player phone)`]));
        fillSelect(ssel, [...localOpts, ...remoteOpts], 'No summoned shadows');
        // few jobs hold shadows: their block shows only while there is a summoned one to add
        const sfs = ssel.closest('fieldset'); if (sfs) sfs.hidden = !ssel.value;
      }
    }
    // an answer for a fight that has changed since is marked stale, a run under way for one is dropped (odds-box.js)
    paintOdds();
    const bd = barDesc(f, gm, elsewhere, mapMode, tools);
    bind(barBox, { head: bd.head, acts: bd.acts });
    const db = $q('[data-dodge]'), dh = gm ? dodgeBannerHtml(f, mapMode) : '';
    if (db) { db.hidden = !dh; if (db.dataset.sig !== dh) { db.dataset.sig = dh; db.innerHTML = dh; } }
    if (ta.innerHTML !== bd.tools) ta.innerHTML = bd.tools;
    const fh = gm ? fudgeBlock(f) : '';
    fz.hidden = !fh; if (fz.innerHTML !== fh) fz.innerHTML = fh;
    const swh = gm ? mythicSwitchMarkup() : '';
    sw.hidden = !swh; if (sw.innerHTML !== swh) sw.innerHTML = swh;
    const mh = mythicMarkup(f, gm);
    if (my.dataset.sig !== mh) {
      const omens = (html => [...html.querySelectorAll('[data-omen]')].map(x => x.dataset.omen).join('|'))(ui.h(`<div>${mh}</div>`));
      my.dataset.sig = mh; my.innerHTML = mh;
      if (omens && my.dataset.omens !== omens) { const o = my.querySelector('.myth-omen'); if (o) motion.pop(o); }
      my.dataset.omens = omens;
    }
    const eh = mapMode ? eyesRow() : '';
    er.hidden = !mapMode; if (es.dataset.sig !== eh) { es.dataset.sig = eh; es.innerHTML = eh; }
    win.classList.toggle('cmb-mapmode', mapMode);
    tl.classList.toggle('open', tools); ui.sheet('fightTools', tools, shutOver);
    if (tools !== tl.hasAttribute('role')) { if (tools) tl.setAttribute('role', 'dialog'); else tl.removeAttribute('role'); }
    drawLog(logBox, f ? f.log.map(l => l.text) : []);
    const mode = idle ? 'idle' : f && n ? 'fight' : 'empty';
    if (main.dataset.mode !== mode) {
      main.dataset.mode = mode;
      slotTo('hides');
      main.innerHTML = mode === 'fight' ? '<div class="cmb-main"><div data-mapbox></div><ul class="cmb-list" aria-label="Turn order"></ul><div data-cardbox><button type="button" class="quiet cmb-sheetx" data-sheetclose>Close</button></div></div>'
        : mode === 'empty' ? '<p class="empty">Add party hunters, monsters or shadows to begin.</p>' : '';
    }
    win.classList.toggle('cmb-ck', mode === 'fight'); // D02: desktop cockpit (CSS applies at >=1100 only)
    if (mode === 'fight' && f) {
      const fc = focusRow(f), list = main.querySelector('.cmb-list'), cardBox = main.querySelector('[data-cardbox]'), mainBox = main.querySelector('.cmb-main'), box = main.querySelector('[data-mapbox]');
      if (list && cardBox && mainBox && box) {
        const onMap = gm && fightView() === 'map';
        mainBox.classList.toggle('map', onMap);
        cardBox.classList.toggle('sheet', onMap && over.at === 'card');
        box.hidden = !onMap;
        slotTo(onMap ? 'shows' : 'hides', box);
        // on a phone the map hides the list, and the card until a token's is opened: what is hidden is not drawn
        const narrow = onMap && NARROW.matches, listShown = !narrow, cardShown = !narrow || over.at === 'card';
        const ordered = listShown ? listOrder(f) : [];
        const draw = () => {
          if (listShown) {
            const rows = keyed(list, ordered.map(r => r.id), id => ui.h(rowTemplate(id)));
            ordered.forEach((r, i) => { const rowEl = rows[i]; if (rowEl) bind(rowEl, rowDesc(f, r, i, fc)); });
          }
          if (!cardShown) return;
          const [card] = keyed(cardBox, fc ? [gm ? 'card' : 'card:ro'] : [], () => ui.h(cardTemplate(!gm)));
          if (!card || !fc) return;
          const amt = card.dataset.cid !== fc.id && card.querySelector('[data-amt]');
          if (amt) amt.value = amounts.get(fc.id) ?? '';
          const pipsWas = card.dataset.cid === fc.id ? Number(card.dataset.charge || -1) : -1;
          bind(card, cardDesc(f, fc, !gm));
          // a stacking status's count counts to its new value from the one shown last
          for (const n of card.querySelectorAll('[data-stacks]')) void motion.numberTo(n, Number(n.dataset.stacks), String, `stk:${n.dataset.sk}`);
          const pips = card.querySelector('.cmb-pips'), charge = pips ? Number(pips.dataset.charge) : -1;
          if (pips && pipsWas >= 0 && charge > pipsWas) { const on = pips.querySelectorAll('i.on'), pip = on[charge - 1]; if (pip) motion.pop(pip); }
          card.dataset.charge = String(charge);
        };
        // when time moves, the rows of the order slide to their new places
        const ids = act ? ordered.map(r => r.id).join() : '';
        motion.slideTo(list, () => list.children, node => node.dataset.key, draw, listShown && !!(ids && lastOrder && ids !== lastOrder));
        lastOrder = ids;
      }
    } else lastOrder = '';
    // the card is a sheet over the map where the map hides it (under 900 px); wider it stands beside the map
    ui.sheet('rowCard', mode === 'fight' && gm && fightView() === 'map' && over.at === 'card' && NARROW.matches, shutOver);
    if (fk && document.activeElement !== ae) { const node = [...el.querySelectorAll('[data-fk]')].find(x => x.dataset.fk === fk); if (node && !node.disabled) { node.focus(); if (caret !== null) node.setSelectionRange(caret, caret); } }
  }

  app.registerView({
    id: 'combat', label: 'Combat', icon: '⚔', order: 40,
    mount,
    update() { render(); },
  });
  // a toggle of the Build drawer: one to other than what the screen wants is the GM's hand, for this fight (map-mount.ts
  // `buildDrawer`)
  document.addEventListener('toggle', ev => {
    const t = ev.target; if (!(t && t.matches && t.matches('[data-build]'))) return;
    const f = fight();
    drawerTo({ kind: 'toggled', open: t.open, wanted: buildWanted(f), fight: drawerFight(f) });
  }, true);

  // ── D02: combat keys (B5). Registry ignores keys while typing, with a modal open, on repeat, or with Ctrl/Alt/Meta ──
  { // the GM's keyboard shortcuts, their helpers kept in a block of their own
    const G = 'Combat (GM)', inView = () => !!root && canRun();
    /** @param {string} s */
    const $r = s => (root ? root.querySelector(s) : null);
    const click = s => { const b = $r(s); if (b && !b.disabled) { b.click(); return true; } return false; };
    const moveSel = d => {
      const f = fight(); if (!f || !f.rows.length) return;
      const list = listOrder(f), r = focusRow(f), i = r ? Math.max(0, list.indexOf(r)) : 0, n = list.length, picked = list[(i + d + n) % n];
      if (picked) { sel = picked.id; render(); }
    };
    app.keys.add({ key: 'n', label: 'Next turn', group: G, view: 'combat', gmOnly: true, when: () => { const f = fight(); return inView() && running(f) && !f?.dodge; }, run: next });
    app.keys.add({ key: 'j', label: 'Select next combatant', group: G, view: 'combat', gmOnly: true, when: () => inView() && Boolean(fight()?.rows.length), run: () => moveSel(1) });
    app.keys.add({ key: 'k', label: 'Select previous combatant', group: G, view: 'combat', gmOnly: true, when: () => inView() && Boolean(fight()?.rows.length), run: () => moveSel(-1) });
    app.keys.add({ key: 'd', label: 'Damage / heal: focus HP amount (Enter damages, Shift+Enter heals)', group: G, view: 'combat', gmOnly: true, when: () => inView() && !!$r('[data-amt]'),
      run: () => { const a = $r('[data-amt]'); if (a) { a.focus(); a.select(); } } });
    app.keys.add({ key: 's', label: 'Add status to selected', group: G, view: 'combat', gmOnly: true, when: () => inView() && !!$r('[data-cforge]'), run: () => click('[data-cforge]') });
    app.keys.add({ key: 'a', label: 'Use the first ability of the current-turn combatant', group: G, view: 'combat', gmOnly: true, when: () => { const f = fight(); return inView() && running(f) && !f.dodge && !!cur(); },
      run: () => {
        const c = cur(); if (!c) return;
        if (sel !== c.id) { sel = c.id; render(); }
        click('.cmb-card.turn [data-ab]');
      } });
    app.keys.add({ key: 'q', label: 'Quick add: add combatants', group: G, view: 'combat', gmOnly: true, when: inView,
      run: () => { const b = $r('[data-build]'); if (b && !b.open) b.open = true; const i = $r('[data-qline]'); if (i) { i.focus(); i.scrollIntoView({ block: 'nearest' }); } } });
  }
}
