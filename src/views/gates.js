// gates.js: U08. Gates and dungeons: world day, spawn, break, encounter hand-off, clear + loot.
// The world day and the gates change only through the steps of src/core/gates/world.ts (a gate's status through `transition`).
import { GATE_STATUSES, GATE_TYPES, SPAWN_TYPES, can, countdown, gateXp as rosterXp, monsterId, newGate, parseGate, xpDue } from '../core/gates/gate.ts';
import { RANKS } from '../core/save.ts';
import { cryptoRandom } from '../edge/roll.ts';
import { clearGoldEach, clearShares, settleClear, shareEach } from '../core/gates/pay.ts';
import { newRewards, parseRewards } from '../core/rewards.ts';
import { isRefused } from '../core/save-step.ts';
import { oneOf } from '../core/one-of.ts';
import { lootShareOf, placeholderName, rollGate } from '../core/gates/spawn.ts';
import { MONSTER_BOUNDS, copiesOf, monsterSheetOf, monsterXp } from '../core/registry/monsters.ts';
import { advanceDay as advanceWorld, closeGate, deleteGate, editGate, enterGate, mergeWorld as mergeDoc, sessionStarted, spawnGate, worldDoc as worldDocOf, worldDocUnmerged, worldEmptyWords } from '../core/gates/world.ts';
import { gateNews, gateTold, hunterNews } from '../core/told.ts';
import { stepTime } from '../core/day.ts';
import { OUTCOME_WORDS, SOLO_REFUSAL_WORDS, SOLO_WORDS, closesIn, personalNews, runCostLines, soloAnswerBody, soloConfirmLines, soloDoc, soloFight, soloKey, soloPlan, soloRan, soloReady, soloRoute, soloRuleSet, soloRunBody, soloTaken, soloTargets, soloTick, takenLine } from '../core/gates/solo.ts';
import { byClosing } from '../core/gates/personal.ts';
import { STOP_WAITING, askDismissed, mayDismiss, shownOf, waitWords, waitingGates } from '../core/sync/asked.ts';
import { NO_RUN, mayEnter, playingOn, runPhaseStep } from '../core/gates/solo-run.ts';
import { IDLE, ODDS_FRAME_MS, oddsStep, progressOf } from '../core/combat/odds.ts';
import { oddsSeed } from '../edge/roll.ts';
import * as motion from './motion.ts';
import { DOC_MAX } from '../core/protocol.ts';
const STATUS_LABEL = { detected: 'Detected', raiding: 'Raiding', cleared: 'Cleared', broken: 'DUNGEON BREAK', closed: 'Closed' };
/** A gate still to be cleared: detected, raiding or broken. The rest are listed under Finished gates. */
const active = g => can(g, 'clear');

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc } = ui;
  const api = app.api;

  const day = () => store.get().world.day;
  const gate = id => store.get().gates.find(g => g.id === id) || null;
  /** When a world step writes its log line, and how many lines the log keeps (session-log.ts). */
  const stamp = () => ({ at: new Date().toISOString(), cap: app.rules().logCap });
  /** When a step happens: now, today's day key at the save's reset hour, and the rules (hunter.js `dayNow`). */
  const dayNow = () => ({ ...stepTime(store.get(), new Date()), R: app.rules() });
  /** What makes the id of a message a write here posts unique (protocol.ts `newEvent`): this phone, now, a random part. */
  const stampNow = () => ({ device: store.get().settings.deviceId, now: Date.now(), rand: cryptoRandom() });
  const monsterOf = id => api.bestiary.get(id);
  const xpOf = id => { const m = monsterOf(id); return m ? monsterXp(m, app.rules()) : 0; };

  // ── spawn ──
  /** @type {import('../core/api.ts').GatesApi['spawn']} */
  function spawn(o = {}) {
    const { gate, monsters } = roll(o);
    return ui.wrote('! Gate', store.apply('gate-spawn', s => spawnGate(s, gate, monsters, stamp()))) ? gate : null;
  }
  /** @type {import('../core/api.ts').GatesApi['roll']} */
  function roll({ rank, type, name } = {}) {
    const R = app.rules();
    const roll = rollGate(R, { rank: RANKS.includes(rank) ? rank : undefined, type: oneOf(type, SPAWN_TYPES, undefined), name }, api.bestiary.list(), cryptoRandom);
    // a rank with no monsters in the bestiary gets generated ones, so a gate always has monsters and a boss
    const made = [];
    const make = boss => {
      const m = { ...api.bestiary.statBlock(roll.rank, { boss, name: placeholderName(roll.rank, boss), type: 'Gate' }), placeholder: /** @type {const} */ (true), id: store.id('m') };
      made.push(m); return m.id;
    };
    const today = day();
    /** @type {import('../core/gates/gate.ts').Gate} */
    const g = parseGate({ ...newGate(), id: store.id('g'), name: roll.name, rank: roll.rank, type: roll.type, breakDay: today + roll.breakDays,
      monsters: roll.pack.map(p => ({ monsterId: p.monsterId ?? make(false), count: p.count })), bossId: roll.bossId ?? make(true), notes: '', createdDay: today });
    return { gate: g, monsters: made };
  }

  // ── day advance: gates reaching breakDay become broken ──
  /**
   * A move of the world day written (`step`: world.ts `advanceDay` or `sessionStarted`), then a window for each gate it
   * broke. Answers what the step did without the save, or why nothing moved.
   */
  function moveDay(reason, step) {
    let moved = null;
    const r = store.apply(reason, s => { const m = step(s); if (isRefused(m)) return m; moved = m; return m.save; });
    if (!r.ok) return r;
    const { save: _written, ...did } = moved, broke = did.broke.map(g => ({ ...g }));
    (async () => {
      for (const g of broke) {
        const pick = await ui.system({ tag: '! Warning', kind: 'warning', title: 'Dungeon Break',
          body: `${g.rank}-rank gate has broken: ${g.name}`, lines: ['Its monsters are coming out of the gate.'],
          actions: [{ label: 'Later', value: null, cancel: true }, ...(app.isGM() ? [{ label: 'Start fight', value: 'start', primary: true }] : [{ label: 'Understood', value: null, primary: true }])] });
        // the next break's window waits until this one's party picker is answered (SMX-gates-7.3b)
        if (pick === 'start') await startEncounter(g.id);
      }
    })();
    return { ok: true, ...did, broke };
  }
  /** @type {import('../core/api.ts').GatesApi['advanceDay']} */
  const advanceDay = (n = 1) => moveDay('advance-day', s => advanceWorld(s, Number(n), stamp()));
  /** @type {import('../core/api.ts').GatesApi['startSession']} */
  const startSession = backup => moveDay('session-start', s => sessionStarted(s, backup, stamp()));

  // ── encounter hand-off ──
  async function startEncounter(id) {
    const g = gate(id); if (!g) return false;
    const cs = [];
    for (const m of g.monsters) cs.push(...api.bestiary.toCombatant(m.monsterId, m.count));
    if (g.bossId) cs.push(...api.bestiary.toCombatant(g.bossId, 1));
    if (!cs.length) { ui.toast('Gates', 'This gate has no monsters.', { kind: 'warning' }); return false; }
    // the combat view links the fight to the gate and marks the gate as fought in the same write (fight-save.ts `fought`)
    return api.combat.startFlow(cs, { gateId: g.id, title: `Start fight: ${g.name}`, body: `${cs.length} monster${cs.length === 1 ? '' : 's'} from this ${g.rank}-rank gate. Choose who fights.` });
  }

  function enter(id) {
    ui.wrote('! Gate', store.apply('gate-enter', s => enterGate(s, id, stamp())));
  }

  // ── rewards: the gate's XP and what it still owes (src/core/gates/gate.ts). Its Clear pays what it owes. ──
  const gateXp = g => rosterXp(g, xpOf);
  const dueXp = g => xpDue(g, xpOf);

  // room players (GM device): remoteSheets() entries keyed '<deviceId>:<hunterId>', the key award events take in 'to'
  const remotes = () => api.sync.remoteSheets();
  /** The hunters in a fight: local hunter ids and remote keys, the values the clear panel's checkboxes use. */
  const fighterIds = f => new Set(f.rows.flatMap(r => (r.holder && r.holder.kind === 'local' ? [r.holder.hunterId] : r.holder && r.holder.kind === 'remote' ? [r.holder.remote] : [])));
  /**
   * Gate `id` cleared and its payees paid, in one step (src/core/gates/pay.ts `settleClear`): the gate's XP still due and
   * the rolled gold shared as the gate's pot by `clearShares`, the items to `toId`, each hunter here given its share, each player's award put
   * in the outbox. Then the one window. `hids`: local hunter ids and/or remote keys; each is paid once.
   */
  async function clearGate(id, hids, toId) {
    const g = gate(id); if (!g) return false;
    hids = [...new Set(hids)];
    const hunters = hids.map(store.hunter).filter(Boolean), rem = remotes().filter(r => hids.includes(r.key));
    /** @type {import('../core/gates/pay.ts').Payee[]} */
    const payees = [...hunters.map(h => ({ kind: 'local', hid: h.id, name: h.name })), ...rem.map(r => ({ kind: 'remote', key: r.key, name: r.data.name }))];
    const dropped = api.inventory.rollLoot(g.rank, { boss: true }) || [];
    const gold = dropped.reduce((n, e) => n + (e.kind === 'gold' ? e.gold : 0), 0), items = dropped.flatMap(e => (e.kind === 'item' ? [e.item] : []));
    const plan = clearShares(store.get(), id, xpOf, gold, items, payees, toId ?? null, app.rules().gateParty); if (!plan) return false;
    const share = plan.shares[0] || { xp: plan.due, gold, items: [] }, taker = plan.shares.find(x => x.items.length);
    const S = api.sync;
    // the player's device assigns its own item ids
    const bare = list => list.map(i => { const c = { ...i }; delete c.id; return c; });
    // each player paid: its award, and its rank as its pushed sheet says, which its gate fact is measured against (pay.ts `settleClear`)
    const players = plan.shares.flatMap(x => {
      if (x.payee.kind !== 'remote') return [];
      const key = x.payee.key, pays = S.event('award', { to: [key], rewards: { ...newRewards(), xp: x.xp, gold: x.gold, items: bare(x.items) } });
      return pays ? [{ key, rank: rem.find(r => r.key === key)?.data.rank ?? null, pays }] : [];
    });
    const code = S.room(), inRoom = code ? { code, stamp: stampNow(), players } : null;
    const locals = plan.shares.flatMap(x => (x.payee.kind === 'local' ? [{ hid: x.payee.hid, rewards: parseRewards({ xp: x.xp, gold: x.gold, items: x.items }) ?? newRewards() }] : []));
    const pay = { due: plan.due, xp: share.xp, gold: share.gold, items: items.map(i => i.name), payees: payees.map(p => p.name) };
    const done = { settled: null };
    if (!ui.wrote('! Gate', store.apply('gate-clear', s => { const r = settleClear(s, id, pay, locals, inRoom, dayNow()); if (isRefused(r)) return r; done.settled = r; return r.save; }))) return false;
    const settled = done.settled;
    S.flush();
    const all = plan.shares.length > 1, rewards = [`${ui.fmt(share.xp)} XP${all ? ' each' : ''}`];
    if (share.gold) rewards.push(`${ui.fmt(share.gold)} gold${all ? ' each' : ''}`);
    for (const it of items) rewards.push(`${it.name} → ${taker ? taker.payee.name : 'nobody'}`);
    const body = `${g.rank}-rank gate cleared: ${g.name}`;
    const rlines = plan.shares.filter(x => x.payee.kind === 'remote').map(x => `${x.payee.name}: ${[x.xp && `+${ui.fmt(x.xp)} XP`, x.gold && `${ui.fmt(x.gold)} gold`, ...x.items.map(i => i.name)].filter(Boolean).join(', ') || 'no rewards'}`);
    if (settled.granted.length) { await api.combat.showParty(settled.granted, { title: 'Gate Cleared', body, lines: rlines }); return true; }
    await ui.system({ tag: '! Notification', kind: 'quest', title: 'Gate Cleared', body,
      lines: payees.length ? [`Rewarded: ${payees.map(p => p.name).join(', ')}`] : ['No hunters were selected, so no rewards were paid.'], rewards });
    return true;
  }

  // ── shared world (_world doc, B3): GM publishes, players read + get System windows ──
  const sync = () => api.sync;
  const room = () => sync().room();
  /** The room's solo doc (gates/solo.ts `soloDoc`): what a player's phone plays the gates open to solo runs from, within the room's bound. */
  const soloShared = () => soloDoc(store.get(), app.rules(), DOC_MAX);
  // the world doc marks solo only the gates the solo doc holds, so a player never sees Enter alone on a gate it cannot play
  const worldDoc = () => worldDocOf(store.get(), day(), new Set(soloShared().doc.gates.map(g => g.id)), store.get().world.session);
  sync().publish('world', worldDoc); // sync.ts puts it after a merge below, never before
  sync().publish('solo', () => soloShared().doc);
  let merged = { code: null, last: null }; // the room's world doc this GM phone merged last (world.ts `WorldDocStamp`)
  // S06: when another GM device wrote the room's world last, upsert it (never delete).
  function mergeWorld(docs) {
    const code = room(); if (app.seat() !== 'gm' || !code) return;
    if (merged.code !== code) merged = { code, last: null };
    const raw = docs && docs.world, w = raw && raw.data;
    if (w && raw.from !== store.get().settings.deviceId && worldDocUnmerged({ at: raw.at, from: raw.from }, merged.last)) {
      const remoteDay = w.day, local = new Map(store.get().gates.map(g => [g.id, g])), clean = w.gates;
      const same = (a, b) => a.name === b.name && a.rank === b.rank && a.type === b.type && a.status === b.status && a.breakDay === b.breakDay;
      const changes = clean.some(g => !local.has(g.id) || !same(local.get(g.id), g));
      // a world this tab could not write is merged again with the next doc: a read-only tab's banner says why
      if (changes || remoteDay > day()) {
        if (!store.apply('gate-import', s => mergeDoc(s, { day: remoteDay, gates: clean }, (g, today) => parseGate({ ...g, createdDay: today }), stamp())).ok) return;
        refreshView();
      }
      merged = { code, last: { at: raw.at, from: raw.from } };
    }
  }
  app.on('sync:docs', ({ docs }) => { if (app.seat() === 'player') onWorld(); else mergeWorld(docs); });

  /** The room's world as the GM published it, on a player's phone. */
  const sharedWorld = () => (app.seat() === 'player' ? sync().doc('world') : null);
  /** The gate news windows asked for and not answered yet, by room, kind and gate: told when answered, asked once meanwhile. */
  const asking = new Set();
  /**
   * The room's gates on a player's phone: what to tell (told.ts `gateNews`, every piece at once), each in a System window
   * (ui.system shows them one at a time), told in the campaign's told memory when the player answers it (`gateTold`),
   * so a reload while it waits shows it. The room's first look takes its gates as told, so joining replays none.
   */
  function onWorld() {
    const code = room(), w = sharedWorld(); if (!code) return;
    const gates = w ? w.gates : [];
    store.tell({ type: 'looked', room: code, gates });
    const told = store.told(), ok = [{ label: 'Understood', value: null, primary: true }];
    for (const n of gateNews(told, code, gates)) {
      const key = `${code}|${n.kind}|${n.gate.id}`, g = n.gate; if (asking.has(key)) continue;
      asking.add(key);
      const shown = n.kind === 'appeared'
        ? ui.system({ tag: '! Gate', kind: 'warning', title: 'A GATE HAS APPEARED', body: g.name, lines: [`Rank: ${g.rank}`, `Type: ${g.type} gate`, `Breaks on day ${g.breakDay}`], actions: ok })
        : ui.system({ tag: '! Warning', kind: 'warning', title: 'GATE BREAK', body: `${g.rank}-rank gate has broken: ${g.name}`, lines: ['Its monsters are coming out of the gate.'], actions: ok });
      void shown.then(() => { asking.delete(key); store.tell(gateTold(told.campaign, code, n)); });
    }
    refreshView();
  }
  /**
   * The mounted Gates view's redraw and its paint of the solo run in flight (both set by its `mount`, null before), and a
   * panel another view asked it to open (`asked`, read and put down by the next draw, so the view opens it whether it
   * was mounted already or not).
   */
  const mounted = { render: null, paintRun: null, asked: null };
  const refreshView = () => { if (mounted.render) mounted.render(); };

  // ── solo runs (src/core/gates/solo.ts, personal.ts, sync/asked.ts; notes-2-solo.md) ──
  /**
   * Each personal gate not told yet gets its window ("A GATE HAS APPEARED"), told in the campaign's told memory when
   * answered (told.ts `hunterNews`), so a reload while it waits shows it.
   */
  function tellPersonal() {
    const many = store.get().hunters.length > 1, ok = [{ label: 'Understood', value: null, primary: true }];
    for (const h of store.get().hunters) {
      const told = store.told(), topic = { of: /** @type {const} */ ('personal'), hunter: h.id }, news = hunterNews(told, h, 'personal');
      for (const g of h.solo.gates) {
        const key = `personal|${h.id}|${g.id}`; if (!news.includes(g.id) || asking.has(key)) continue;
        asking.add(key);
        void ui.system({ tag: '! Gate', kind: 'warning', title: 'A GATE HAS APPEARED', body: `${many ? `${h.name}: ` : ''}${g.name}`, lines: personalNews(g, Date.now()), actions: ok })
          .then(() => { asking.delete(key); store.tell({ type: 'answered', campaign: told.campaign, topic, id: g.id }); });
      }
    }
  }
  /** @type {import('../core/api.ts').GatesApi['tick']} */
  function tick() {
    if (store.readOnly) return;
    store.apply('solo-tick', s => { const r = soloTick(s, { now: new Date(), R: app.rules(), gm: app.isGM(), seed: oddsSeed() }); return isRefused(r) ? r : r.save; });
    tellPersonal();
    refreshView();
  }

  /** The room's solo gates as this phone plays them: from the room's docs on a player's phone. */
  const roomTargets = () => (app.seat() === 'player' ? soloTargets(sync().doc('world'), sync().doc('solo')) : []);
  /** What `soloReady` reads of the phone now, for hunter `hid`: where a world gate's run settles now (`soloRoute`) among it. */
  function readyCtx(hid) {
    const seat = app.seat(), code = room(), bound = sync().bound(), route = soloRoute(seat, code);
    return { R: app.rules(), route, held: !!api.hunter.fightOf({ hid }), nowMs: Date.now(), bound: bound ? bound.id : null,
      room: route !== 'local' ? { targets: roomTargets(), waiting: waitingGates(store.get(), route.room, hid) } : null };
  }
  /** The key of a solo gate's odds box: one per gate and hunter. */
  const oddsKeyOf = (gate, hid) => `solo:${gate.kind}:${gate.id}:${hid}`;
  /**
   * The loot a Clear of `rank` rolls (a boss's when `boss`) at the share a gate of `kind` pays (spawn.ts `lootShareOf`: a
   * personal gate `solo.lootShare`, a world gate all of it), as `soloRan` and `soloTaken` take it.
   */
  const lootOf = (rank, boss, kind) => {
    const dropped = api.inventory.rollLoot(rank, { boss, share: lootShareOf(app.rules(), kind) }) || [];
    // the player's device assigns its own item ids
    return { gold: dropped.reduce((n, e) => n + (e.kind === 'gold' ? e.gold : 0), 0), items: dropped.flatMap(e => (e.kind === 'item' ? [e.item] : [])) };
  };

  let runPhase = NO_RUN; // this phone's solo run (core gates/solo-run.ts), moved only by `runMoved`; the solo panel draws from it
  /**
   * The run after `e` (gates/solo-run.ts `runPhaseStep`), drawn: a change of phase redraws the view, so every Enter alone
   * and the run's card follow it; a new round or move count paints the run's card. False when `e` changed nothing.
   */
  function runMoved(e) {
    const next = runPhaseStep(runPhase, e);
    if (next === runPhase) return false;
    const phase = next.at !== runPhase.at;
    runPhase = next;
    if (phase) refreshView(); else if (mounted.paintRun) mounted.paintRun();
    return true;
  }

  /**
   * Hunter `hid` enters `gate` alone, unless a run is in flight on this phone (then the tap changes nothing). The run's
   * phase is `runPhase` from the tap until its window closes, whichever way it ends (`done`).
   */
  async function enterAlone(gate, hid) {
    if (!runMoved({ type: 'enter', gate, hid })) return;
    try { await runAlone(gate, hid); } finally { runMoved({ type: 'done' }); }
  }
  /**
   * The run itself: the odds read first (played out if they are not), the one question with their numbers, then one play
   * of the engine with its count on the card, then the one write (`soloRan`) and its window. Nothing is stored before the
   * write, and nothing on screen during the play tells how it goes.
   */
  async function runAlone(gate, hid) {
    const first = soloReady(store.get(), hid, gate, readyCtx(hid));
    if (isRefused(first)) { ui.toast('! Gate', SOLO_REFUSAL_WORDS[first.why], { kind: 'warn' }); return; }
    const read = await api.odds.ask(oddsKeyOf(gate, hid));
    if (!read) return;
    const go = await ui.system({ tag: '! Gate', kind: 'warning', title: SOLO_WORDS.confirm, body: first.target.name, lines: soloConfirmLines(read),
      actions: [{ label: SOLO_WORDS.notNow, value: null, cancel: true }, { label: SOLO_WORDS.enter, value: 'go', primary: true }] });
    if (go !== 'go') return;
    const at = readyCtx(hid), ready = soloReady(store.get(), hid, gate, at);
    if (isRefused(ready)) { ui.toast('! Gate', SOLO_REFUSAL_WORDS[ready.why], { kind: 'warn' }); return; }
    const made = soloFight(ready.h, ready.target, app.rules()); if (!made) return;
    // the hunter it plays and where it settles, as they stand at the start: the write is refused if either moved
    const from = soloKey(ready.h), route = at.route;
    runMoved({ type: 'go' });
    // one play: the odds' machine asked for one fight, a few commands a frame, with the round and the moves as its count
    const end = await new Promise(resolve => {
      let run = oddsStep(IDLE, { type: 'ask', fight: made.fight, seed: oddsSeed(), of: 1 }, made.R);
      const frame = () => {
        const until = performance.now() + ODDS_FRAME_MS;
        while (run.state === 'running' && performance.now() < until) run = oddsStep(run, { type: 'step', commands: 1 }, made.R);
        const p = progressOf(run, made.R);
        if (p) runMoved({ type: 'played', round: p.round, moves: p.commands });
        if (run.state === 'running') requestAnimationFrame(frame); else resolve(run.state === 'done' ? run.odds.ends[0] : null);
      };
      requestAnimationFrame(frame);
    });
    if (!end) return;
    const runOf = { end, hunter: made.hunter, shadows: made.shadows, from, route }, R = app.rules();
    const toRoom = gate.kind === 'world' && route !== 'local';
    // a cleared gate's loot, rolled before the write as a Clear's is; the GM's phone rolls a room's gate's
    const loot = end.outcome === 'won' && !toRoom ? lootOf(ready.target.rank, ready.target.boss, gate.kind) : { gold: 0, items: [] };
    const body = toRoom ? soloRunBody(ready.h, runOf, ready.target, sync().myKey(hid), R) : null, event = body ? sync().event('soloRun', body) : null;
    const done = { ran: null };
    const w = store.apply('solo-run', s => { const r = soloRan(s, hid, gate, runOf, loot, { day: dayNow(), ready: readyCtx(hid), event }); if (isRefused(r)) return r; done.ran = r; return r.save; });
    if (!ui.wrote('! Gate', w, SOLO_REFUSAL_WORDS)) return;
    const ran = done.ran;
    if (toRoom) sync().flush();
    runMoved({ type: 'wrote' });
    const h = store.hunter(hid), m = h ? api.hunter.sheet(h).sheet : { hpMax: 0, manaMax: 0, fatigueMax: 0 };
    const sy = store.get().settings.sync, waiting = event && (sy.asked || []).find(x => x.id === event.payload.eid);
    await ui.system({ tag: '! Gate', kind: ran.outcome === 'won' ? 'quest' : 'warning', title: OUTCOME_WORDS[ran.outcome].title,
      body: waiting ? `${ready.target.name}. ${waitWords(waiting, sy.outbox || [])}` : ready.target.name,
      lines: runCostLines(ran.before, ran.after, m), rewards: ran.granted ? ran.granted.lines : [] });
    if (ran.granted) api.hunter.granted(hid, ran.granted, { popup: false });
  }

  // the GM's phone takes a player's run of the room's solo gate once by its id: pays a won run as the gate's Clear for
  // that hunter, or answers it taken, closed or gone; a lost run enters the gate (gates/solo.ts `soloTaken`)
  app.on('sync:event', ({ event: ev }) => {
    if (app.seat() !== 'gm' || ev.type !== 'soloRun') return;
    const p = ev.payload, s = store.get(), plan = soloPlan(s, p, app.rules()), g = gate(p.gate);
    const loot = plan.kind === 'paid' && g ? lootOf(g.rank, true, 'world') : { gold: 0, items: [] };
    const body = soloAnswerBody(s, p.eid, p, plan, loot), answer = body ? sync().event('soloAnswer', body) : null;
    const code = room(), rank = sync().remoteSheets().find(r => r.key === p.by)?.data.rank ?? null;
    if (!sync().once(p.eid, x => soloTaken(x, p, plan, answer, loot, { day: dayNow(), room: code ? { code, stamp: stampNow() } : null, rank }))) return;
    sync().flush();
    refreshView();
    ui.toast('! Gate', takenLine(s, p, plan).text, { kind: 'info' });
  });

  // ── view ──
  ui.css('gates', `
.gt-top{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.gt-day{font-family:var(--font-display);font-weight:700;font-size:26px;letter-spacing:.12em;text-transform:uppercase;color:var(--ice);text-shadow:0 0 16px rgba(77,216,255,.6);margin-right:auto}
.gt-gm{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}
.gt-spawn{margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}
.gt-list{display:flex;flex-direction:column;gap:14px;margin-top:14px}
.gate{position:relative;border:1px solid var(--line-bright);background:rgba(10,26,46,.7);padding:14px 16px;box-shadow:0 0 14px rgba(63,192,255,.18)}
.gate.t-red{border-color:var(--red);background:linear-gradient(180deg,rgba(90,14,26,.55),rgba(30,8,14,.7));box-shadow:0 0 22px rgba(255,77,94,.4)}
.gate.t-double{border-color:var(--purple);box-shadow:0 0 14px rgba(199,155,255,.3)}
.gate.s-broken{border-color:var(--red);box-shadow:0 0 18px rgba(255,77,94,.45)}
.gate.s-cleared,.gate.s-closed{opacity:.7}
.gt-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.gt-name{font-family:var(--font-display);font-weight:700;font-size:18px;letter-spacing:.06em;color:var(--ice);overflow-wrap:anywhere;flex:1 1 140px;min-width:0}
.gt-chip{font-size:12px;letter-spacing:.14em;text-transform:uppercase;border:1px solid currentColor;padding:2px 7px;white-space:nowrap}
.gt-chip.st-detected{color:var(--cyan)}.gt-chip.st-raiding{color:var(--green)}.gt-chip.st-broken{color:var(--red);font-weight:700}
.gt-chip.st-cleared{color:var(--gold)}.gt-chip.st-closed{color:var(--muted)}.gt-chip.ty-red{color:var(--red)}.gt-chip.ty-double{color:var(--purple)}.gt-chip.ty-normal{color:var(--cyan-dim)}
.gt-red-banner{margin:10px 0 0;padding:8px 12px;border:1px solid var(--red);background:rgba(255,77,94,.15);color:#ff9aa5;font-weight:600;font-size:13px;letter-spacing:.04em}
.gt-timer{margin:8px 0 0;font-family:var(--font-mono);font-size:13px;color:var(--cyan-dim)}
.gt-timer.soon{color:var(--gold)}.gt-timer.over{color:var(--red)}
.gt-mons{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:4px;font-size:14px}
.gt-mons li{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.gt-mons .cnt{font-family:var(--font-mono);color:var(--cyan)}
.gt-mons .boss{color:var(--gold);font-weight:600}
.gt-mons .mx{font-family:var(--font-mono);font-size:12px;color:var(--muted)}
.gt-notes{margin:8px 0 0;font-size:13px;color:var(--cyan-dim);overflow-wrap:anywhere}
.gt-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.gt-panel{margin-top:12px;border-top:1px dashed var(--line);padding-top:10px;display:flex;flex-direction:column;gap:10px}
.gt-panel .grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
.gt-chk{display:flex;align-items:center;gap:10px;min-height:44px;min-width:0;overflow-wrap:anywhere;padding:0 10px;border:1px solid var(--line);background:rgba(6,14,26,.7);cursor:pointer}
.gt-chk input{width:20px;height:20px;flex:0 0 auto}
.gt-mrow{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap}
.gt-mrow .field:first-child{flex:1 1 160px}.gt-mrow .field.n{flex:0 0 80px}
.gt-switch{margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}
.gt-solo{margin-top:14px;display:flex;flex-direction:column;gap:14px}
.gt-solo h3{margin:0;font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:var(--cyan)}
.gt-solo [data-solorun]{margin-top:10px}
.gt-done{margin-top:18px}.gt-done summary{cursor:pointer;color:var(--cyan-dim);min-height:40px;display:flex;align-items:center}
@media (pointer:coarse),(max-width:720px){.gt-done summary{min-height:44px}}
`);

  app.registerView({
    id: 'gates', label: 'Gates', icon: '◎', order: 30,
    mount(el) {
      const opts = list => list.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
      el.innerHTML = `<section class="win"><span class="cb"></span><h2>Gates</h2>
        <div class="gt-top"><div class="gt-day" id="gt-day" aria-live="polite"></div>
          <div class="gt-gm" data-gm><button type="button" data-act="day" data-n="-1" aria-label="Go back one day">◀ −1 day</button>
            <button type="button" data-act="day" data-n="1">+1 day ▶</button>
            <button type="button" data-act="day-n">Advance…</button></div></div>
        <div class="gt-switch" data-gm><span class="lbl">${esc(SOLO_WORDS.switch)}</span>
          <div class="seg" role="group" aria-label="${esc(SOLO_WORDS.switch)}"><button type="button" data-act="solo-on">On</button><button type="button" data-act="solo-off">Off</button></div>
          ${ui.field(SOLO_WORDS.every, `<select name="solohours" data-solohours>${opts([2, 4, 6, 8, 12, 24].map(n => [String(n), `${n} hours`]))}</select>`)}</div>
        <form class="gt-spawn" data-gm>${ui.field('Gate rank', `<select name="rank">${opts([['', 'Random'], ...RANKS.map(r => [r, r + '-rank'])])}</select>`)}
          ${ui.field('Gate type', `<select name="type">${opts([['', 'Random'], ...SPAWN_TYPES.map(t => [t, t[0].toUpperCase() + t.slice(1)])])}</select>`)}
          <button type="submit" class="primary">Spawn gate</button></form>
        <section class="gt-solo" id="gt-solo" aria-label="${esc(SOLO_WORDS.room)}" hidden></section>
        <div class="gt-list" id="gt-list"></div>
        <details class="gt-done" id="gt-done"><summary>Finished gates (<span id="gt-done-n">0</span>)</summary><div class="gt-list" id="gt-done-list"></div></details>
      </section>`;
      const cards = new Map(), openPanel = new Map();
      const q = s => el.querySelector(s);
      app.api.detail.wire(el, () => render());

      /** The gates open to solo runs that the room's solo doc cannot hold (gates/solo.ts `soloDoc`), on the room's GM phone. */
      const soloLeft = () => (app.seat() === 'gm' ? soloShared().left : []);
      const sigOf = g => JSON.stringify([g, day(), app.isGM(), (g.monsters || []).map(m => monsterOf(m.monsterId)?.name), monsterOf(g.bossId)?.name, soloLeft().includes(g.id)]);
      // the one countdown (gate.ts `countdown`), as a player's card reads it; a red gate open still adds its inside time
      const timer = g => { const c = countdown(g, day()); return g.type === 'red' && active(g) && g.status !== 'broken' ? `${c.words} · inside time ×10` : c.words; };
      const timerCls = g => countdown(g, day()).tone ?? '';

      function cardHtml(g) {
        const gm = app.isGM();
        const mons = g.monsters.map(m => { const mo = monsterOf(m.monsterId); return `<li><span class="cnt">×${esc(m.count)}</span><span>${esc(mo ? mo.name : 'Unknown monster')}</span>${mo ? `<span class="mx">${ui.fmt(monsterXp(mo, app.rules()))} XP · HP ${ui.fmt(monsterSheetOf(mo, app.rules()).hpMax)}</span>` : ''}</li>`; }).join('');
        const boss = g.bossId ? monsterOf(g.bossId) : null;
        const acts = !gm ? '' : [
          can(g, 'enter') ? '<button type="button" data-act="enter" class="primary">Enter</button>' : '',
          can(g, 'fightStarted') ? '<button type="button" data-act="encounter">Start fight</button>' : '',
          can(g, 'clear') ? '<button type="button" data-act="clear" class="primary">Clear</button>' : '',
          '<button type="button" data-act="edit">Edit</button>',
          can(g, 'close') ? '<button type="button" data-act="close">Close</button>' : '',
          '<button type="button" data-act="delete" class="danger">Delete</button>',
        ].join('');
        const cfg = app.rules().gateSpawn;
        return `<article class="gate t-${esc(g.type)} s-${esc(g.status)}" data-id="${esc(g.id)}" aria-label="${esc(g.rank)}-rank ${esc(g.type)} gate ${esc(g.name)}">
          <div class="gt-head">${ui.rankBadge(g.rank)}<span class="gt-name">${esc(g.name)}</span>
            <span class="gt-chip ty-${esc(g.type)}">${esc(g.type)} gate</span><span class="gt-chip st-${esc(g.status)}">${esc(STATUS_LABEL[g.status] || g.status)}</span></div>
          ${g.type === 'red' ? `<div class="gt-red-banner" role="note">No exit until the boss falls · DCs +${esc(cfg.redDcBonus)}</div>` : ''}
          ${g.type === 'double' && gm ? '<div class="gt-notes">Double gate: it holds a hidden second dungeon, which the GM reveals.</div>' : ''}
          <div class="gt-timer ${timerCls(g)}">${esc(timer(g))}</div>
          <ul class="gt-mons" aria-label="Monsters">${mons || '<li class="empty">No regular monsters.</li>'}
            ${g.bossId ? `<li class="boss"><span>★ Boss</span><span>${esc(boss ? boss.name : 'Unknown boss')}</span>${boss ? `<span class="mx">${ui.fmt(monsterXp(boss, app.rules()))} XP · HP ${ui.fmt(monsterSheetOf(boss, app.rules()).hpMax)}</span>` : ''}</li>` : ''}</ul>
          <div class="gt-notes">Total XP per hunter: ${ui.fmt(gateXp(g))}</div>
          ${gm && g.mapId && api.maps.get(g.mapId) ? `<div class="gt-notes">Battle map: ${esc(api.maps.get(g.mapId).name)}</div>` : ''}
          ${g.notes ? `<div class="gt-notes">${esc(g.notes)}</div>` : ''}
          ${gm && g.solo ? `<div class="gt-notes">${esc(SOLO_WORDS.open)}${soloLeft().includes(g.id) ? `. ${esc(SOLO_WORDS.tooBig)}` : ''}</div>` : ''}
          ${acts ? `<div class="gt-acts">${acts}</div>` : ''}
          <div class="gt-panel-slot"></div></article>`;
      }

      function build(g) {
        const node = ui.h(cardHtml(g));
        node._sig = sigOf(g);
        return node;
      }
      function reopen(node, id) {
        const mode = openPanel.get(id), slot = node.querySelector('.gt-panel-slot');
        if (!mode || !slot) return;
        const g = gate(id);
        slot.replaceChildren(ui.h(mode === 'clear' ? clearPanel(g) : editPanel(g)));
      }
      // local hunters, then room players; value = hunter id or remote key
      const payees = () => [...store.get().hunters.map(h => ({ id: h.id, name: h.name })), ...remotes().map(r => ({ id: r.key, name: r.data.name }))];
      const hunterOpts = sel => payees().map(h => `<option value="${esc(h.id)}"${h.id === sel ? ' selected' : ''}>${esc(h.name)}</option>`).join('');
      // who fought this gate: the live fight started from it, else its last settled one (the gate's `fought`); none -> the active hunter only
      const fighters = g => {
        const s = store.get();
        if (s.fight && s.fightRefs && s.fightRefs.gate === g.id) return fighterIds(s.fight);
        return g.fought.length ? new Set(g.fought) : new Set([store.active().id]);
      };
      // the shares that pay (pay.ts `shareEach`, read by `clearShares`): no hunter picked gets nothing
      const xpEach = (g, n) => ui.fmt(shareEach(dueXp(g), n, app.rules().gateParty));
      const goldEach = (g, n) => { const e = clearGoldEach(app.rules(), g.rank, n); return e.low === e.high ? ui.fmt(e.low) : `${ui.fmt(e.low)} to ${ui.fmt(e.high)}`; };
      function clearPanel(g) {
        const on = fighters(g), list = payees(), n = list.filter(h => on.has(h.id)).length;
        return `<form class="gt-panel" data-form="clear" aria-label="Clear gate">
          <div class="lbl">Award to</div>
          <div class="grid2">${list.map(h => `<label class="gt-chk"><input type="checkbox" name="hid" value="${esc(h.id)}"${on.has(h.id) ? ' checked' : ''}><span>${esc(h.name)}</span></label>`).join('')}</div>
          ${ui.field('Loot item goes to', `<select name="to"><option value="">First selected hunter</option>${hunterOpts('')}</select>`)}
          <div class="gt-notes">Each selected hunter gets <span data-clearxp>${xpEach(g, n)}</span> XP and <span data-cleargold>${goldEach(g, n)}</span> gold. The gate's XP and gold are shared: the fewer hunters, the more each${g.xpPaid > 0 ? `. Its fights already paid ${ui.fmt(g.xpPaid)} XP of the gate's XP` : ''}. Loot is rolled for a ${esc(g.rank)}-rank gate with a boss.</div>
          <div class="gt-acts"><button type="button" data-act="cancel-panel">Cancel</button><button type="submit" class="primary">Confirm clear</button></div></form>`;
      }
      function editPanel(g) {
        const all = api.bestiary.list();
        const mopt = sel => all.map(m => `<option value="${esc(m.id)}"${m.id === sel ? ' selected' : ''}>${esc(m.name)} (${esc(m.rank)}${m.kind === 'normal' ? '' : `, ${m.kind}`})</option>`).join('');
        const row = m => `<div class="gt-mrow" data-mrow>${ui.field('Monster', `<select name="mid">${mopt(m.monsterId)}</select>`)}${ui.field('Count', `<input type="number" name="cnt" min="1" max="${MONSTER_BOUNDS.copies}" inputmode="numeric" value="${esc(m.count)}">`).replace('class="field"', 'class="field n"')}<button type="button" class="danger" data-act="rm-row" aria-label="Remove this monster">Remove</button></div>`;
        const sOpt = (list, sel) => list.map(v => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
        return `<form class="gt-panel" data-form="edit" aria-label="Edit gate">
          <div class="grid2">${ui.field('Name', `<input type="text" name="name" maxlength="60" value="${esc(g.name)}">`)}
            ${ui.field('Rank', `<select name="rank">${sOpt(RANKS, g.rank)}</select>`)}
            ${ui.field('Type', `<select name="type">${sOpt(GATE_TYPES, g.type)}</select>`)}
            ${ui.field('Status', `<select name="status">${sOpt(Object.keys(STATUS_LABEL), g.status)}</select>`)}
            ${ui.field('Breaks on day', `<input type="number" name="breakDay" min="1" inputmode="numeric" value="${esc(g.breakDay)}">`)}</div>
          <div class="lbl">Monsters</div><div data-rows>${g.monsters.map(row).join('')}</div>
          <div><button type="button" data-act="add-row">+ Add monster</button></div>
          ${ui.field('Boss', `<select name="boss"><option value="">No boss</option>${mopt(g.bossId)}</select>`)}
          ${ui.field('Battle map', `<select name="map"><option value="">Open arena</option>${api.maps.list().map(m => `<option value="${esc(m.id)}"${m.id === g.mapId ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select>`)}
          ${ui.field('Notes', `<textarea name="notes" rows="2" maxlength="500">${esc(g.notes)}</textarea>`)}
          <label class="gt-chk"><input type="checkbox" name="solo"${g.solo ? ' checked' : ''}><span>${esc(SOLO_WORDS.open)}</span></label>
          <template data-row-tpl>${row({ monsterId: all[0]?.id || '', count: 1 })}</template>
          <div class="dlg-actions"><button type="button" data-act="cancel-panel">Cancel</button><button type="submit" class="primary">Save gate</button></div></form>`;
      }

      function sharedCard(g, d) {
        const c = countdown(g, d), t = c.words, cls = c.tone ?? '';
        return `<article class="gate t-${esc(g.type)} s-${esc(g.status)}" data-id="${esc(g.id)}" aria-label="${esc(g.rank)}-rank ${esc(g.type)} gate ${esc(g.name)}">
          <div class="gt-head">${ui.rankBadge(g.rank)}<span class="gt-name">${esc(g.name)}</span>
            <span class="gt-chip ty-${esc(g.type)}">${esc(g.type)} gate</span><span class="gt-chip st-${esc(g.status)}">${esc(STATUS_LABEL[g.status] || g.status)}</span></div>
          ${g.type === 'red' ? '<div class="gt-red-banner" role="note">Red gate: no exit until the boss is defeated</div>' : ''}
          <div class="gt-timer ${cls}">${esc(t)}</div></article>`;
      }
      function renderShared(w, soloShown) {
        q('#gt-day').textContent = `World Day ${w.day}`;
        const act = w.gates.filter(active), fin = w.gates.filter(g => !active(g));
        const put = (box, list, msg) => { const html = list.map(g => sharedCard(g, w.day)).join('') || `<p class="empty">${esc(msg)}</p>`; if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; } };
        put(q('#gt-list'), act, worldEmptyWords(false, soloShown));
        put(q('#gt-done-list'), fin, 'Nothing here yet.');
        q('#gt-done-n').textContent = fin.length; q('#gt-done').hidden = !fin.length;
      }
      /** One solo gate's card for hunter `h`: its monsters, its time, its odds, Enter alone, or why not; a run waiting for the GM. */
      function soloCard(gate, h, name, rank, sub) {
        const ready = soloReady(store.get(), h.id, gate, readyCtx(h.id)), R = app.rules();
        const target = isRefused(ready) ? null : ready.target, made = isRefused(ready) ? null : soloFight(ready.h, ready.target, R);
        const sy = store.get().settings.sync, code = room();
        const waiting = gate.kind === 'world' && code ? (sy.asked || []).find(x => x.kind === 'solo' && x.room === code && x.hid === h.id && x.gate === gate.id) : null;
        const away = waiting && mayDismiss(waiting, sy.outbox || []);
        const mons = target ? target.monsters.map(m => `<li><span class="cnt">×${esc(m.count)}</span><span>${esc(m.monster.name)}</span></li>`).join('') : '';
        const line = waiting ? waitWords(waiting, sy.outbox || []) : isRefused(ready) ? SOLO_REFUSAL_WORDS[ready.why] : '';
        const acts = away ? `<button type="button" data-solo-dismiss="${esc(waiting.id)}">${esc(SOLO_WORDS.dismiss)}</button>`
          : target ? `<button type="button" class="primary" data-solo-enter${mayEnter(runPhase) ? '' : ' disabled'}>${esc(SOLO_WORDS.enter)}</button>` : '';
        return { key: oddsKeyOf(gate, h.id), made, html: `<article class="gate solo" data-solo="${esc(gate.kind)}:${esc(gate.id)}" aria-label="${esc(rank)}-rank solo gate ${esc(name)}">
          <div class="gt-head">${ui.rankBadge(rank)}<span class="gt-name">${esc(name)}</span><span class="gt-chip st-detected">${esc(gate.kind === 'personal' ? 'Personal' : 'Solo')}</span></div>
          ${sub ? `<div class="gt-timer">${esc(sub)}</div>` : ''}
          ${mons ? `<ul class="gt-mons" aria-label="Monsters">${mons}</ul>` : ''}
          <div data-odds hidden></div><div data-solorun${playingOn(runPhase, gate, h.id) ? '' : ' hidden'}></div>
          ${line ? `<div class="gt-notes" role="status">${esc(line)}</div>` : ''}
          ${acts ? `<div class="gt-acts">${acts}</div>` : ''}</article>` };
      }
      /** The solo gates first: the active hunter's personal ones with their time left, then the world's (or the room's) open to solo runs. Answers whether the section shows. */
      function renderSolo() {
        const box = q('#gt-solo'), h = store.active(), R = app.rules(), now = Date.now();
        if (!box || !h) return false;
        const personal = R.solo.personal ? byClosing(h.solo.gates).map(g => soloCard({ kind: 'personal', id: g.id }, h, g.name, g.rank, closesIn(g, now))) : [];
        const world = app.seat() === 'player' ? roomTargets().map(t => soloCard(t.gate, h, t.name, t.rank, ''))
          : store.get().gates.filter(g => g.solo && active(g)).map(g => soloCard({ kind: 'world', id: g.id }, h, g.name, g.rank, countdown(g, day()).words));
        const html = `${R.solo.personal ? `<h3>${esc(SOLO_WORDS.personal)}</h3>${personal.map(c => c.html).join('') || `<p class="empty">${esc(SOLO_WORDS.none)}</p>`}` : ''}`
          + `${world.length ? `<h3>${esc(SOLO_WORDS.room)}</h3>${world.map(c => c.html).join('')}` : ''}`;
        box.hidden = !html;
        if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; }
        const all = [...personal, ...world], boxes = box.querySelectorAll('[data-odds]');
        all.forEach((c, i) => { if (boxes[i]) api.odds.paintSolo(/** @type {HTMLElement} */ (boxes[i]), c.key, c.made); });
        paintRun();
        return !box.hidden;
      }
      /** The run in flight (`runPhase`) painted on its card as the panel holds it now: its round and moves. */
      function paintRun() {
        const h = store.active(), box = q('#gt-solo'), run = runPhase;
        if (!h || !box || run.at !== 'playing') return;
        const at = playingOn(run, run.gate, h.id), card = at && [...box.querySelectorAll('[data-solo]')].find(c => c.dataset.solo === `${run.gate.kind}:${run.gate.id}`);
        const el = card && card.querySelector('[data-solorun]');
        if (el) motion.progress(el, null, SOLO_WORDS.running(at.round, at.moves));
      }
      function render() {
        const gm = app.isGM();
        el.querySelectorAll('[data-gm]').forEach(n => { n.hidden = !gm; });
        const S = app.rules().solo;
        el.querySelectorAll('[data-act=solo-on],[data-act=solo-off]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.act === 'solo-on') === S.personal)));
        const hours = q('[data-solohours]'); if (hours && hours.value !== String(S.hours)) { if (![...hours.options].some(o => o.value === String(S.hours))) hours.append(new Option(`${S.hours} hours`, String(S.hours))); hours.value = String(S.hours); }
        const soloShown = renderSolo();
        const w = sharedWorld();
        if (w) { cards.clear(); renderShared(w, soloShown); return; }
        for (const k of ['#gt-list', '#gt-done-list']) { const b = q(k); if (b.dataset.sig) { delete b.dataset.sig; b.replaceChildren(); } }
        q('#gt-day').textContent = `World Day ${day()}`;
        const gates = store.get().gates;
        // a panel asked for from another view (the fight's end): open, its card drawn again with it
        const ask = mounted.asked; mounted.asked = null;
        if (ask && gates.some(g => g.id === ask.id)) { openPanel.set(ask.id, ask.mode); cards.delete(ask.id); }
        // a Clear panel stays open only while its gate can still be cleared (gate.ts `can`): a gate a player's run, another
        // GM phone or this phone's own Clear has cleared or closed draws its card again, without the panel
        for (const g of gates) if (openPanel.get(g.id) === 'clear' && !can(g, 'clear')) openPanel.delete(g.id);
        const act = gates.filter(active), fin = gates.filter(g => !active(g));
        const fill = (box, list, emptyMsg) => {
          const els = list.map(g => {
            let node = cards.get(g.id);
            if (!node || (node._sig !== sigOf(g) && !openPanel.has(g.id))) { node = build(g); cards.set(g.id, node); reopen(node, g.id); }
            return node;
          });
          if (!els.length) { box.replaceChildren(ui.h(`<p class="empty">${esc(emptyMsg)}</p>`)); return; }
          if (els.length !== box.children.length || els.some((n, i) => box.children[i] !== n)) box.replaceChildren(...els);
        };
        fill(q('#gt-list'), act, worldEmptyWords(gm, soloShown));
        fill(q('#gt-done-list'), fin, 'Nothing here yet.');
        q('#gt-done-n').textContent = fin.length;
        q('#gt-done').hidden = !fin.length;
        for (const id of [...cards.keys()]) if (!gates.some(g => g.id === id)) { cards.delete(id); openPanel.delete(id); }
      }
      const refresh = id => { const g = gate(id); if (!g) return; const n = build(g); cards.set(id, n); reopen(n, id); render(); };
      mounted.render = render;
      mounted.paintRun = paintRun;

      /** Run `id` put away: a taken one only after the question, since it gives up the GM's pay (sync/asked.ts `STOP_WAITING`). */
      async function dismissRun(id) {
        const sy = store.get().settings.sync, w = (sy.asked || []).find(x => x.id === id);
        if (w && shownOf(w, sy.outbox || []).state === 'taken'
          && !await ui.confirm({ title: STOP_WAITING.title, body: STOP_WAITING.body, danger: true, confirmLabel: STOP_WAITING.confirm })) return;
        if (ui.wrote('! Gate', store.apply('solo-dismiss', s => askDismissed(s, id)))) render();
      }

      el.addEventListener('click', async e => {
        const solo = e.target.closest('[data-solo-enter],[data-solo-dismiss]');
        if (solo) {
          const card = solo.closest('[data-solo]'), [kind, id] = card.dataset.solo.split(':'), h = store.active();
          if (solo.hasAttribute('data-solo-dismiss')) { await dismissRun(solo.dataset.soloDismiss); return; }
          if (h) await enterAlone(kind === 'personal' ? { kind: 'personal', id } : { kind: 'world', id }, h.id);
          return;
        }
        const b = e.target.closest('[data-act]'); if (!b) return;
        const act = b.dataset.act, card = b.closest('.gate'), id = card && card.dataset.id;
        if (!app.isGM()) return;
        if (act === 'solo-on' || act === 'solo-off') { ui.wrote('Gates', store.apply('gm-rules', s => soloRuleSet(s, { personal: act === 'solo-on' }))); return; }
        if (act === 'day') ui.wrote('Gates', advanceDay(Number(b.dataset.n)));
        else if (act === 'day-n') { const n = await ui.promptNum({ title: 'Advance world day', label: 'Days (negative goes back)', value: 5, min: -30, max: 365 }); if (n) ui.wrote('Gates', advanceDay(n)); }
        else if (act === 'enter') enter(id);
        else if (act === 'encounter') startEncounter(id);
        else if (act === 'clear' || act === 'edit') { openPanel.set(id, act); refresh(id); cards.get(id)?.querySelector('.gt-panel input,.gt-panel select')?.focus(); }
        else if (act === 'cancel-panel') { openPanel.delete(id); refresh(id); }
        else if (act === 'close') { if (await ui.confirm({ title: 'Close this gate?', body: 'A closed gate can no longer break.', confirmLabel: 'Close gate' })) ui.wrote('! Gate', store.apply('gate-close', s => closeGate(s, id, stamp()))); }
        else if (act === 'delete') { if (await ui.confirm({ title: 'Delete this gate?', body: 'This cannot be undone.', danger: true, confirmLabel: 'Delete' })) ui.wrote('! Gate', store.apply('gate-delete', s => deleteGate(s, id))); }
        else if (act === 'add-row') { const f = b.closest('form'); f.querySelector('[data-rows]').appendChild(ui.h(f.querySelector('[data-row-tpl]').innerHTML)); }
        else if (act === 'rm-row') b.closest('[data-mrow]').remove();
      });

      el.addEventListener('change', e => {
        // a refused change draws the select back from the rules (render)
        if (e.target.matches('[data-solohours]') && app.isGM()) { if (!ui.wrote('Gates', store.apply('gm-rules', s => soloRuleSet(s, { hours: Number(e.target.value) })))) render(); return; }
        const f = e.target.closest('form[data-form=clear]'), x = f && f.querySelector('[data-clearxp]'), gd = f && f.querySelector('[data-cleargold]'), g = f && gate(f.closest('.gate').dataset.id);
        if (x && gd && g) { const n = f.querySelectorAll('input[name=hid]:checked').length; x.textContent = xpEach(g, n); gd.textContent = goldEach(g, n); }
      });
      el.addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target;
        if (!app.isGM()) return;
        if (f.classList.contains('gt-spawn')) {
          const g = spawn({ rank: oneOf(f.rank.value, RANKS, undefined), type: oneOf(f.type.value, SPAWN_TYPES, undefined) });
          if (!g) return;
          ui.toast('Gates', `${g.rank}-rank ${g.type} gate detected: ${g.name}`);
          return;
        }
        const id = f.closest('.gate').dataset.id, kind = f.dataset.form;
        if (kind === 'clear') {
          const hids = [...f.querySelectorAll('input[name=hid]:checked')].map(i => i.value);
          if (!hids.length && !(await ui.confirm({ title: 'Clear with no rewards?', body: 'No hunters are selected, so nobody is paid.', confirmLabel: 'Clear anyway' }))) return;
          // the panel closes before the write, so the redraw the write makes draws no Clear on a cleared gate; a refused Clear opens it again
          openPanel.delete(id);
          if (!(await clearGate(id, hids, f.to.value))) { openPanel.set(id, 'clear'); return; }
        } else if (kind === 'edit') {
          const rows = [...f.querySelectorAll('[data-mrow]')].map(r => ({ monsterId: monsterId(r.querySelector('[name=mid]').value), count: copiesOf(r.querySelector('[name=cnt]').value) })).filter(r => r.monsterId);
          openPanel.delete(id);
          const g = gate(id);
          // a refused edit keeps the panel open with what was typed: nothing redraws it
          if (g && !ui.wrote('! Gate', store.apply('gate-edit', s => editGate(s, id, { name: f.name.value, rank: oneOf(f.rank.value, RANKS, g.rank), type: oneOf(f.type.value, GATE_TYPES, g.type),
            breakDay: Number(f.breakDay.value), monsters: rows, bossId: monsterId(f.boss.value), notes: f.notes.value, mapId: f.map.value || null, status: oneOf(f.status.value, GATE_STATUSES, g.status), solo: f.solo ? f.solo.checked : g.solo }, stamp())))) { openPanel.set(id, 'edit'); return; }
        }
        refresh(id);
      });
      render();
    },
    update() { refreshView(); },
  });

  // ── combat:end with a gateId offers to mark the gate cleared (GM only) ──
  app.on('combat:end', async ({ fight, gateId }) => {
    const g = gateId ? gate(gateId) : null;
    if (!g || !can(g, 'clear') || !app.isGM()) return;
    const pick = await ui.system({ tag: '! Notification', kind: 'quest', title: 'Gate cleared?', body: `Was "${g.name}" (${g.rank}-rank) cleared?`,
      actions: [{ label: 'Not yet', value: null, cancel: true }, { label: 'Mark gate cleared', value: 'clear', primary: true }] });
    if (pick !== 'clear') return;
    mounted.asked = { id: g.id, mode: 'clear' };
    app.go('gates');
    refreshView();
  });

  app.api.gates = { spawn, roll, advanceDay, startSession, tick };
}
