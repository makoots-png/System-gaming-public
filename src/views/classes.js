// classes.js: player class locker, skill tree viewer/buyer, fork flip modal, GM unique-class registry, first-mission
// & GM class offer modal/banner, and GM room logging for classSwap/classNode/classPick. Every save mutation delegates to
// src/core/hunter/classes.ts, class-holders.ts, or class-offer.ts; every sentence comes from core.
import { parseClassNodeId, parseSaveId } from '../core/ids.ts';
import { oneOf } from '../core/one-of.ts';
import { CLASS_SIGNATURES } from '../core/registry/class-powers.ts';
import { CLASS_LOCKER_CAP, classTreeOf } from '../core/registry/class-trees.ts';
import { activeClassTrees } from '../edge/store.ts';
import { classDefOf, isUniqueClass } from '../core/registry/jobs.ts';
import { CLASS_NAME_MAX } from '../core/hunter/class-locker.ts';
import {
  CLASS_REFUSAL_WORDS,
  buyClassNode,
  classForkSaid,
  classNodeSaid,
  classSwapSaid,
  flipClassFork,
  forkFlipCost,
  nodeCost,
  removeBloodVessel,
  setJob,
  swapClass,
  swapCost,
} from '../core/hunter/classes.ts';
import {
  HOLDER_REFUSAL_WORDS,
  claimUniqueClass,
  classesHeldBy,
  holderOf,
  reassignUniqueClass,
  grantRefused,
  grantRefusedLine,
  releaseUniqueClass,
} from '../core/hunter/class-holders.ts';
import {
  OFFER_REFUSAL_WORDS,
  OFFER_WORDS,
  classOfferDocOf,
  classOfferView,
  classTakenLine,
  closeClassOffer,
  openClassOffer,
  pickAnswered,
  pickClassFromOffer,
  pickRefusedLine,
} from '../core/hunter/class-offer.ts';
import {
  CLASS_UI_WORDS as W,
  forkFlipPreview,
  forkRefusalWords,
  lockerView,
  nodeCostLabel,
  nodeRefusalWords,
  registryView,
  swapCostLabel,
  swapRefusalWords,
} from '../core/hunter/class-view.ts';
import { undoableTotal } from '../core/hunter/progress.ts';
import { atHunter, isRefused } from '../core/save-step.ts';
import { logLine, logged } from '../core/session-log.ts';
import { enter } from './motion.ts';
import { closeWindow, openWindow, trapTab } from './ui.js';

const CSS = `
.cls-active{border:1px solid var(--line-bright);background:rgba(10,26,46,.65);padding:10px 12px;margin-bottom:10px}
.cls-vessels{border:1px solid var(--line);background:rgba(36,10,18,.45);padding:10px 12px;margin-bottom:10px}
.cls-vessels .cls-list{margin:8px 0 0}
.cls-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap}
.cls-name{font-family:var(--font-display);font-weight:700;font-size:18px;color:var(--ice);overflow-wrap:anywhere}
.cls-badges{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.cls-tag{font-size:12px;letter-spacing:.1em;text-transform:uppercase;padding:2px 7px;border:1px solid var(--line);color:var(--cyan-dim)}
.cls-tag.r-common{border-color:#9fb6c9;color:#9fb6c9}
.cls-tag.r-rare{border-color:#4dd8ff;color:#4dd8ff}
.cls-tag.r-epic{border-color:#c79bff;color:#c79bff}
.cls-tag.r-mythic{border-color:#ff6b3d;color:#ff6b3d}
.cls-tag.warn{border-color:var(--red);color:#ff8a96}
.cls-tag.ok{border-color:var(--green);color:var(--green)}
.cls-meta{margin:4px 0 0;font-size:13px;color:var(--cyan-dim);overflow-wrap:anywhere}
.cls-list{list-style:none;margin:0 0 10px;padding:0;display:flex;flex-direction:column;gap:8px}
.cls-row{border:1px solid var(--line);background:rgba(10,26,46,.55);padding:8px 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cls-row.on{border-color:var(--line-bright);box-shadow:0 0 10px rgba(77,216,255,.2)}
.cls-row.parked{border-style:dashed;opacity:.85}
.cls-row-main{flex:1 1 160px;min-width:0;overflow-wrap:anywhere}
.cls-row-acts{display:flex;gap:6px;flex-wrap:wrap}
.cls-row-acts button{min-height:var(--control-h)}
.cls-starter{border:1px solid var(--line);background:rgba(10,26,46,.4);padding:8px 10px;margin:8px 0}
.cls-job-row{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-top:6px}
.cls-job-row .field{flex:1 1 150px;min-width:0}
.cls-job-row input{width:100%;box-sizing:border-box}
.cls-job-row button{min-height:var(--control-h)}
.cls-tree-fold{border:1px solid var(--line);background:rgba(10,26,46,.35);padding:8px 10px;margin-top:10px}
.cls-tree-fold>summary{cursor:pointer;min-height:var(--control-h);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--cyan-dim)}
.cls-tree-fold[open]>summary{margin-bottom:8px}
.cls-depth{margin:0 0 10px}
.cls-depth-h{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--cyan-dim);margin:0 0 6px}
.cls-nodes{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
.cls-fork-pair{grid-column:1/-1;border:1px dashed var(--line-bright);background:rgba(10,26,46,.35);padding:8px;display:flex;flex-direction:column;gap:6px}
.cls-fork-h{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--gold)}
.cls-fork-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px}
.cls-node{border:1px solid var(--line);background:rgba(10,26,46,.5);padding:8px 10px;display:flex;flex-direction:column;gap:4px;min-width:0}
.cls-node.owned{border-color:var(--green);background:rgba(14,48,46,.45)}
.cls-node.buyable{border-color:var(--line-bright)}
.cls-node.fork-taken{border-style:dashed;opacity:.9}
.cls-node.locked{opacity:.72}
.cls-node-h{display:flex;align-items:baseline;justify-content:space-between;gap:6px;flex-wrap:wrap}
.cls-node-name{font-weight:600;color:var(--ice);overflow-wrap:anywhere}
.cls-node-desc{margin:0;font-size:13px;color:var(--cyan-dim);overflow-wrap:anywhere}
.cls-node-req{margin:0;font-size:12px;color:var(--muted);overflow-wrap:anywhere}
.cls-node-gifts{list-style:none;margin:2px 0 0;padding:0 0 0 8px;border-left:2px solid var(--line);font-size:12px;color:var(--ice)}
.cls-node-foot{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;margin-top:auto;padding-top:6px}
.cls-node-foot button{min-height:var(--control-h)}
.cls-gm-ctrl{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin:6px 0 10px}
.cls-gm-ctrl .seg{margin:0}
.cls-gm-ctrl .seg button{min-height:var(--control-h)}
.cls-gm-q{flex:1 1 150px;min-width:0}
.cls-gm-q input{width:100%;box-sizing:border-box}
.cls-gm-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.cls-gm-form{display:flex;flex-direction:column;gap:10px;text-align:left}
.cls-gm-form input,.cls-gm-form select{width:100%;box-sizing:border-box}
.cls-gm-warn{margin:0;font-size:13px;color:#ff8a96;overflow-wrap:anywhere}
.cls-gm-warn[hidden]{display:none}
.co-banner{border:1px solid var(--line-bright);background:rgba(10,36,64,.7);padding:10px 12px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.co-banner-main{flex:1 1 180px;min-width:0}
.co-banner button{min-height:var(--control-h)}
.co-gm-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 10px}
.co-gm-bar button{min-height:var(--control-h)}
.co-ov{align-items:stretch}
.co-win.sys-window{display:flex;flex-direction:column;overflow:visible;text-align:left;padding:14px 14px 0;max-height:calc(100dvh - 32px - var(--sat) - var(--sab));width:min(620px,100%);margin:auto}
.co-win .n-big.co-title{font-size:20px;letter-spacing:.1em;margin:0 0 6px;overflow-wrap:anywhere}
.co-mid{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:10px;padding:2px 2px 10px}
.co-mid p{margin:0;overflow-wrap:anywhere}
.co-sec-h{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--cyan-dim);margin:2px 0 0}
.co-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}
.co-card{border:1px solid var(--line);background:rgba(10,26,46,.6);padding:10px 12px;display:flex;flex-direction:column;gap:6px;min-width:0}
.co-card.r-mythic{border-color:rgba(255,107,61,.55)}
.co-card.r-epic{border-color:rgba(199,155,255,.45)}
.co-card.taken{opacity:.72;border-style:dashed}
.co-card.mine{border-color:var(--green);background:rgba(14,48,46,.5)}
.co-card-foot{margin-top:auto;padding-top:4px;display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap}
.co-card-foot button{min-height:var(--control-h);width:100%}
.co-msg{border:1px solid var(--red);background:rgba(70,16,24,.55);color:#ffb3bc;padding:8px 10px;font-size:13px;overflow-wrap:anywhere}
.co-msg.good{border-color:var(--green);background:rgba(14,48,46,.55);color:var(--green)}
.co-notice{border:1px solid var(--line-bright);background:rgba(10,26,46,.55);padding:10px 12px;font-size:13px;color:var(--ice);overflow-wrap:anywhere}
.co-local-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}
.co-local-bar .field{flex:1 1 200px;min-width:0}
.co-local-bar select{width:100%;min-height:var(--control-h);box-sizing:border-box}
.co-actions{flex:0 0 auto;margin:0 -14px;padding:10px 14px calc(10px + var(--sab));border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
.co-actions button{min-height:var(--control-h)}
@media (max-width:720px){.cls-nodes,.cls-fork-grid,.co-grid{grid-template-columns:minmax(0,1fr)}.cls-row-acts button{flex:1 0 auto}}
`;

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc } = ui;
  const A = () => app.api;
  ui.css('classes', CSS);

  /** Last drawn `DOCS.holders` + `DOCS.classOffer` snapshot so `sync:docs` redraws only on change. */
  let holdersSig = '';
  /** Live class-offer window while open (GM or player): overlay handle, mode and focus trigger. */
  let offerWin = null;
  /** Ephemeral class-offer screen state in this tab: auto-open id, pending pick, inline notice, GM local pick and last room. */
  let offerUi = {
    seenId: '',
    /** @type {{ offerId: string; className: string; outboxId: string; by: import('../core/ids.ts').SheetKey } | null} */
    pending: null,
    notice: '',
    localHid: '',
    lastRoom: '',
  };

  /** Whether a local (`{ hid }`) or remote (`{ key }`) hunter is currently held in a fight on save `s` (shared via `hunter.heldIn`). */
  const isHeld = (s, who) => A().hunter.heldIn(s, who) !== null;

  /** Whether a unique-class holder (local hunter, remote sheet, or NPC) is currently held in a fight on save `s`. */
  const holderInFight = (s, holder) =>
    holder.kind === 'local' ? isHeld(s, { hid: holder.hunterId }) : holder.kind === 'remote' ? isHeld(s, { key: holder.sheetKey }) : false;

  /** Campaign registry id active on this phone: the room's `DOCS.holders` for a player, `s`'s for a GM, else null. */
  const activeRegistryId = s => {
    const seat = app.seat();
    if (seat === 'player') return A().sync.doc('holders')?.registryId ?? null;
    if (app.isGM()) return s.classHolders.registryId;
    return null;
  };

  /** Builds a `ClassStepCtx` for `swapClass`, `buyClassNode`, or `flipClassFork` inside `store.apply`. */
  const classCtx = (s, hid) => {
    const role = /** @type {import('../core/role.ts').Role} */ (app.isGM() ? 'gm' : 'player');
    const room = role === 'player' ? A().sync.room() : null;
    return {
      role,
      held: isHeld(s, { hid }),
      at: new Date().toISOString(),
      room,
      stamp: room ? A().sync.stamp() : null,
      R: app.rules(),
      activeRegistryId: activeRegistryId(s),
      trees: activeClassTrees(),
    };
  };

  /** Builds a `HolderStepCtx` for GM unique-class mutations inside `store.apply`. */
  const holderCtx = s => {
    const room = app.seat() === 'gm' ? A().sync.room() : null;
    return {
      at: new Date().toISOString(),
      room,
      stamp: room ? A().sync.stamp() : null,
      R: app.rules(),
      heldLocal: hid => isHeld(s, { hid }),
      heldRemote: key => isHeld(s, { key }),
    };
  };

  // ── Player actions: setJob, swapClass, buyClassNode, flipClassFork ──

  function applyJob(hid, raw) {
    const clean = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, CLASS_NAME_MAX);
    const w = store.apply('class-job', s => atHunter(hid, h => setJob(h, clean || null, { held: isHeld(s, { hid }), dead: h.life.at === 'dead' }))(s));
    if (!ui.wrote('! Class', w, CLASS_REFUSAL_WORDS)) return;
    ui.toast('! Class', W.jobSetToast(store.hunter(hid)?.job ?? null), { kind: 'info' });
  }

  async function doSwap(hid, targetClass) {
    const s0 = store.get();
    const h = store.hunter(hid);
    if (!h) return;
    const R = app.rules(), role = app.isGM() ? 'gm' : 'player';
    const plan = swapCost(h, role, R);
    const regId = activeRegistryId(s0);
    const entry = Object.hasOwn(h.classes, targetClass) ? h.classes[targetClass] : null;
    const parked = isUniqueClass(targetClass) && !!regId && !!entry?.registryId && entry.registryId !== regId;
    const holdersPending = isUniqueClass(targetClass) && app.seat() === 'player' && !!entry?.registryId && !regId;
    const held = isHeld(s0, { hid });
    const targetDef = classDefOf(targetClass);
    const curDef = classDefOf(h.job);
    const pairChanged = !!targetDef && !!curDef && targetDef.pair !== curDef.pair;

    if (plan.cost > 0 && h.life.at !== 'dead' && !held && !parked && !holdersPending && h.gold >= plan.cost) {
      const ok = await ui.warn({
        tag: W.swapWarnTag,
        title: W.swapWarnTitle(targetClass),
        body: W.swapWarnBody(targetClass, plan.cost, h.gold),
        ...(pairChanged && targetDef ? { lines: [W.swapPairNote(targetDef.pair)] } : {}),
        actions: [
          { label: W.payAction(plan.cost), value: true, primary: true },
          { label: 'Cancel', value: false, cancel: true },
        ],
      });
      if (ok !== true) return;
    }

    const cur = store.hunter(hid);
    const curPlan = cur ? swapCost(cur, role, app.rules()) : plan;
    const curGold = cur ? cur.gold : h.gold;
    const out = {
      /** @type {import('../core/hunter/classes.ts').SwappedClass | null} */
      res: null,
      /** @type {import('../core/ids.ts').RoomCode | null} */
      code: null,
    };
    const w = store.apply('class-swap', s => {
      const ctx = classCtx(s, hid);
      out.code = ctx.room;
      const r = swapClass(s, hid, targetClass, ctx);
      if (isRefused(r)) return r;
      out.res = r;
      return r.save;
    });
    if (!ui.wrote('! Class', w, swapRefusalWords(curPlan.cost, curGold))) return;
    if (out.code) A().sync.flush();
    if (out.res) {
      const after = store.hunter(hid);
      const askRespec = pairChanged && !!after && undoableTotal(after) > 0;
      ui.toast('! Class', W.swappedToast(out.res.to, out.res.cost, askRespec), { kind: 'good' });
    }
  }

  async function doBuyNode(hid, rawNodeId) {
    const nodeId = parseClassNodeId(rawNodeId);
    const h = store.hunter(hid);
    if (!h || !nodeId) return;
    const R = app.rules(), role = app.isGM() ? 'gm' : 'player', trees = activeClassTrees();
    const tree = classTreeOf(h.job, trees);
    const node = tree ? tree.nodes.find(n => n.id === nodeId) : null;
    const priced = nodeCost(h, h.job, nodeId, role, R, trees);
    const cost = isRefused(priced) ? 0 : priced.cost;
    const held = isHeld(store.get(), { hid });

    if (cost > 0 && node && h.job && h.life.at !== 'dead' && !held && h.gold >= cost) {
      const ok = await ui.warn({
        tag: W.nodeWarnTag,
        title: W.nodeWarnTitle(node.name),
        body: W.nodeWarnBody(node.name, h.job, cost, h.gold),
        actions: [
          { label: W.payAction(cost), value: true, primary: true },
          { label: 'Cancel', value: false, cancel: true },
        ],
      });
      if (ok !== true) return;
    }

    const cur = store.hunter(hid);
    const curPriced = cur ? nodeCost(cur, cur.job, nodeId, role, app.rules(), trees) : priced;
    const curCost = isRefused(curPriced) ? cost : curPriced.cost;
    const curGold = cur ? cur.gold : h.gold;
    const out = {
      /** @type {import('../core/hunter/classes.ts').BoughtClassNode | null} */
      res: null,
      /** @type {import('../core/ids.ts').RoomCode | null} */
      code: null,
    };
    const w = store.apply('class-node', s => {
      const ctx = classCtx(s, hid);
      out.code = ctx.room;
      const r = buyClassNode(s, hid, nodeId, ctx);
      if (isRefused(r)) return r;
      out.res = r;
      return r.save;
    });
    if (!ui.wrote('! Class', w, nodeRefusalWords(curCost, curGold))) return;
    if (out.code) A().sync.flush();
    if (out.res) ui.toast('! Class', W.boughtToast(node ? node.name : out.res.nodeId, out.res.cost), { kind: 'good' });
  }

  async function doFlipFork(hid, rawFromId, rawToId) {
    const fromId = parseClassNodeId(rawFromId), toId = parseClassNodeId(rawToId);
    const h = store.hunter(hid);
    if (!h || !fromId || !toId) return;
    const R = app.rules(), role = app.isGM() ? 'gm' : 'player', trees = activeClassTrees();
    const tree = classTreeOf(h.job, trees);
    const entry = h.job && Object.hasOwn(h.classes, h.job) ? h.classes[h.job] : null;
    const plan = forkFlipCost(h, role, R);
    const held = isHeld(store.get(), { hid });
    const prev = tree && entry ? forkFlipPreview(tree, entry.nodes, fromId, toId) : null;

    if (prev && h.life.at !== 'dead' && !held && h.gold >= plan.cost) {
      const lines = prev.dropped.length ? [W.flipDroppedLine(prev.dropped.map(n => n.name))] : [];
      const ok = await ui.warn({
        tag: W.flipWarnTag,
        title: W.flipWarnTitle(prev.to.name),
        body: W.flipWarnBody(prev.from.name, prev.to.name, plan, h.gold),
        ...(lines.length ? { lines } : {}),
        actions: [
          { label: plan.cost > 0 ? W.payAction(plan.cost) : W.flipConfirmFree, value: true, primary: true },
          { label: 'Cancel', value: false, cancel: true },
        ],
      });
      if (ok !== true) return;
    }

    const cur = store.hunter(hid);
    const curPlan = cur ? forkFlipCost(cur, role, app.rules()) : plan;
    const curGold = cur ? cur.gold : h.gold;
    const out = {
      /** @type {import('../core/hunter/classes.ts').FlippedClassFork | null} */
      res: null,
      /** @type {import('../core/ids.ts').RoomCode | null} */
      code: null,
    };
    const w = store.apply('class-fork', s => {
      const ctx = classCtx(s, hid);
      out.code = ctx.room;
      const r = flipClassFork(s, hid, fromId, toId, ctx);
      if (isRefused(r)) return r;
      out.res = r;
      return r.save;
    });
    if (!ui.wrote('! Class', w, forkRefusalWords(curPlan.cost, curGold))) return;
    if (out.code) A().sync.flush();
    if (out.res) ui.toast('! Class', W.flippedToast(prev ? prev.to.name : out.res.toId, out.res.cost, out.res.dropped.length), { kind: 'good' });
  }

  async function doRemoveVessel(hid, rawIndex) {
    const idx = Number(rawIndex);
    const h = store.hunter(hid);
    const active = h && h.job && h.jobDone === h.job && Object.hasOwn(h.classes, h.job) ? h.classes[h.job] : null;
    const item = active && active.vessels && Number.isInteger(idx) ? active.vessels[idx] : null;
    if (!h || !item) return;
    const ok = await ui.confirm({
      title: W.vesselRemoveTitle,
      body: W.vesselRemoveBody(item.name, item.rank, item.kind),
      danger: true,
      confirmLabel: W.vesselRemoveConfirm,
    });
    if (!ok) return;
    const out = {
      /** @type {import('../core/hunter/classes.ts').RemovedBloodVessel | null} */
      res: null,
    };
    const w = store.apply('class-vessel-remove', s => {
      const r = removeBloodVessel(s, hid, idx, classCtx(s, hid));
      if (isRefused(r)) return r;
      out.res = r;
      return r.save;
    });
    if (!ui.wrote('! Class', w, CLASS_REFUSAL_WORDS)) return;
    if (out.res) ui.toast('! Class', W.vesselRemovedToast(out.res.removed.name), { kind: 'info' });
  }

  // ── Player panel on Status view ──

  function renderLockerPanel(el) {
    const h = store.active(), s = store.get(), R = app.rules();
    const role = /** @type {import('../core/role.ts').Role} */ (app.isGM() ? 'gm' : 'player');
    const vm = lockerView(h, {
      role,
      held: isHeld(s, { hid: h.id }),
      R,
      activeRegistryId: activeRegistryId(s),
      trees: activeClassTrees(),
    });

    const activeHtml = vm.active.kind === 'none'
      ? `<div class="cls-active" data-cls-active><div class="lbl">${esc(W.activeLabel)}</div><p class="empty">${esc(W.noActive)}</p></div>`
      : `<div class="cls-active" data-cls-active>
          <div class="cls-head">
            <span class="cls-name">${esc(vm.active.name)}</span>
            <span class="cls-badges">
              ${vm.activeRarityLabel ? `<span class="cls-tag${vm.activeRarity ? ` r-${esc(vm.activeRarity)}` : ''}">${esc(vm.activeRarityLabel)}</span>` : ''}
              ${vm.active.kind === 'earned' ? `<span class="tag-on">${esc(W.awakenedBadge)}</span>` : `<span class="cls-tag">${esc(W.labelBadge)}</span>`}
              ${vm.activeUnique ? `<span class="cls-tag">${esc(W.uniqueBadge)}</span>` : ''}
              ${vm.held ? `<span class="cls-tag warn">${esc(W.inFightBadge)}</span>` : ''}
            </span>
          </div>
          ${vm.activePairLabel ? `<p class="cls-meta">${esc(W.statPairPrefix)}${esc(vm.activePairLabel)}${vm.activeRecRank ? ` · ${esc(W.recRankPrefix)}${esc(vm.activeRecRank)}` : ''}</p>` : ''}
        </div>`;

    const lockerRows = vm.entries.length
      ? `<ul class="cls-list" data-cls-locker>${vm.entries.map(e => {
          const progress = W.nodesProgress(e.nodesBought, e.nodesCap);
          const meta = [e.pairLabel, progress, e.recRank ? `${W.recRankPrefix}${e.recRank}` : null].filter(Boolean).join(' · ');
          const badges = [
            `<span class="cls-tag${e.rarity ? ` r-${esc(e.rarity)}` : ''}">${esc(e.rarityLabel)}</span>`,
            e.unique ? `<span class="cls-tag">${esc(W.uniqueBadge)}</span>` : '',
            e.active ? `<span class="tag-on">${esc(W.activeAction)}</span>` : '',
            e.parked ? `<span class="cls-tag warn">${esc(W.parkedBadge)}</span>` : '',
          ].join('');
          const btn = e.active
            ? `<button type="button" disabled>${esc(W.activeAction)}</button>`
            : `<button type="button" data-cls-swap="${esc(e.name)}">${esc(W.swapAction)} (${esc(swapCostLabel(vm.swapPlan))})</button>`;
          return `<li class="cls-row${e.active ? ' on' : ''}${e.parked ? ' parked' : ''}" data-cls-entry="${esc(e.name)}">
            <div class="cls-row-main">
              <div class="cls-head"><span class="r-name">${esc(e.name)}</span><span class="cls-badges">${badges}</span></div>
              <div class="cls-meta">${esc(meta)}${e.parked ? ` · ${esc(CLASS_REFUSAL_WORDS['foreign-class'])}` : ''}</div>
            </div>
            <div class="cls-row-acts">${btn}</div>
          </li>`;
        }).join('')}</ul>`
      : `<p class="empty" data-cls-locker-empty>${esc(W.lockerEmpty)}</p>`;

    const starterHtml = vm.entries.length === 0
      ? `<div class="cls-starter" data-cls-starter>
          <div class="cls-job-row">
            ${ui.field(W.starterFieldLabel, `<input type="text" data-cls-job maxlength="${CLASS_NAME_MAX}" list="cls-job-list" autocomplete="off" spellcheck="false" value="${esc(h.job ?? '')}">`)}
            <datalist id="cls-job-list">${R.jobs.map(j => `<option value="${esc(j)}"></option>`).join('')}</datalist>
            <button type="button" data-cls-job-set>${esc(W.starterApply)}</button>
            ${h.job ? `<button type="button" data-cls-job-clear>${esc(W.starterClear)}</button>` : ''}
          </div>
          <p class="cls-meta">${esc(W.starterHint)}</p>
        </div>`
      : '';

    const nodeCardHtml = n => {
      const stateBadge = n.status === 'owned'
        ? `<span class="cls-tag ok">${esc(W.nodeOwned)}</span>`
        : n.status === 'fork-taken'
          ? `<span class="cls-tag warn">${esc(W.nodeOtherFork)}</span>`
          : n.status === 'locked'
            ? `<span class="cls-tag">${esc(W.nodeLocked)}</span>`
            : '';
      const reqLine = n.status === 'locked' && n.missingParents.length
        ? `<p class="cls-node-req">${esc(n.parentMode === 'any' ? W.needsAnyPrefix : W.needsAllPrefix)}${esc(n.missingParents.join(', '))}</p>`
        : '';
      const actionBtn = n.status === 'buyable' && n.costPlan
        ? `<button type="button" class="primary" data-cls-buy="${esc(n.id)}">${esc(W.nodeBuy)} (${esc(nodeCostLabel(n.costPlan))})</button>`
        : n.status === 'fork-taken' && n.flipFromId && n.flipCostPlan
          ? `<button type="button" data-cls-flip-from="${esc(n.flipFromId)}" data-cls-flip-to="${esc(n.id)}">${esc(W.flipForkAction)} (${esc(swapCostLabel(n.flipCostPlan))})</button>`
          : n.status === 'locked' && n.costPlan
            ? `<span class="cls-meta">${esc(nodeCostLabel(n.costPlan))}</span>`
            : '';
      const gifts = n.gifts.length ? `<ul class="cls-node-gifts">${n.gifts.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '';
      return `<article class="cls-node ${esc(n.status)}" data-cls-node="${esc(n.id)}" data-cls-status="${esc(n.status)}">
        <div class="cls-node-h"><span class="cls-node-name">${esc(n.name)}</span>${stateBadge}</div>
        <p class="cls-node-desc">${esc(n.desc)}</p>
        ${reqLine}
        ${gifts}
        <div class="cls-node-foot">${actionBtn}</div>
      </article>`;
    };

    const depthNodesHtml = nodes => {
      const seenForks = new Set();
      return nodes.map(n => {
        if (!n.forkGroup) return nodeCardHtml(n);
        if (seenForks.has(n.forkGroup)) return '';
        seenForks.add(n.forkGroup);
        const pair = nodes.filter(x => x.forkGroup === n.forkGroup);
        return `<div class="cls-fork-pair" data-cls-fork="${esc(n.forkGroup)}">
          <div class="cls-fork-h">${esc(W.forkPickOne)}</div>
          <div class="cls-fork-grid">${pair.map(nodeCardHtml).join('')}</div>
        </div>`;
      }).join('');
    };

    const treeHtml = vm.tree
      ? `<details class="cls-tree-fold" data-cls-tree-fold data-cls-tree="${esc(vm.tree.className)}">
        <summary>
          <span>${esc(W.treeHeading)}: ${esc(vm.tree.className)} (${esc(`${vm.tree.ownedCount}/${vm.tree.buyableCap}`)})</span>
          ${vm.tree.capstoneReady ? `<span class="cls-tag ok" data-cls-capstone-ready>${esc(W.capstoneReady)}</span>` : ''}
        </summary>
        ${vm.tree.depths.map(g => `<div class="cls-depth" data-cls-depth="${esc(g.depth)}">
          <div class="cls-depth-h">${esc(W.depthHeading(g.depth, g.nodes.some(n => n.capstone)))}</div>
          <div class="cls-nodes">${depthNodesHtml(g.nodes)}</div>
        </div>`).join('')}
      </details>`
      : vm.treeMissing
        ? `<div class="lbl dv-sub">${esc(W.treeHeading)}</div><p class="empty" data-cls-tree-empty>${esc(W.treeEmpty)}</p>`
        : vm.entries.length > 0
          ? `<div class="lbl dv-sub">${esc(W.treeHeading)}</div><p class="empty" data-cls-tree-empty>${esc(W.treeNoActive)}</p>`
          : '';

    const offerState = playerOfferState();
    const offerBannerHtml = offerState
      ? `<div class="co-banner" data-co-banner>
          <div class="co-banner-main">
            <div class="r-name">${esc(OFFER_WORDS.playerBannerTitle)}</div>
            <div class="cls-meta">${esc(
              offerState.vm.myPicked
                ? OFFER_WORDS.alreadyPickedLine(offerState.vm.myPicked)
                : offerState.vm.allTaken
                  ? OFFER_WORDS.allTakenNotice
                  : OFFER_WORDS.openBody,
            )}</div>
          </div>
          <button type="button"${offerState.vm.myPicked || offerState.vm.allTaken ? '' : ' class="primary"'} data-co-open>${esc(
            offerState.vm.myPicked || offerState.vm.allTaken ? 'View offer' : OFFER_WORDS.playerBannerAction,
          )}</button>
        </div>`
      : '';

    const vesselsHtml = vm.vessels
      ? `<div class="cls-vessels" data-cls-vessels>
          <div class="cls-head"><span class="r-name">${esc(W.vesselsHeading(vm.vessels.count, vm.vessels.cap))}</span></div>
          <p class="cls-meta">${esc(W.vesselsHint(vm.vessels.className))}</p>
          ${vm.vessels.count > 0 ? `<p class="cls-meta" data-cls-vessels-bonus>${esc(W.vesselsBonusLine(vm.vessels.bonus, vm.vessels.totalPower))}</p>` : ''}
          ${vm.vessels.items.length
            ? `<ul class="cls-list" data-cls-vessel-list>${vm.vessels.items.map(v => `<li class="cls-row" data-cls-vessel="${v.index}">
                <div class="cls-row-main">
                  <div class="cls-head"><span class="r-name">${esc(v.name)}</span><span class="cls-badges">${ui.rankBadge(v.rank)}${v.kind !== 'normal' ? `<span class="cls-tag">${esc(v.kind)}</span>` : ''}<span class="cls-tag">Power ${v.power}</span></span></div>
                </div>
                <div class="cls-row-acts"><button type="button" class="danger" data-cls-vessel-del="${v.index}" aria-label="Remove ${esc(v.name)} Crimson Vessel">${esc(W.vesselRemoveAction)}</button></div>
              </li>`).join('')}</ul>`
            : `<p class="empty" data-cls-vessels-empty>${esc(W.vesselsEmpty)}</p>`}
        </div>`
      : '';

    const html = `${offerBannerHtml}${activeHtml}${vesselsHtml}
      <div class="lbl dv-sub">${esc(W.lockerHeading)}</div>
      <p class="cls-meta" data-cls-swap-line>${esc(vm.swapLine)}</p>
      ${lockerRows}
      ${starterHtml}
      ${treeHtml}`;

    const typing = document.activeElement instanceof HTMLInputElement && el.contains(document.activeElement);
    if (el.dataset.sig !== html && !typing) {
      const treeWasOpen = el.querySelector('[data-cls-tree-fold]')?.hasAttribute('open');
      el.dataset.sig = html;
      el.innerHTML = html;
      const treeFold = el.querySelector('[data-cls-tree-fold]');
      if (treeFold && treeWasOpen) treeFold.setAttribute('open', '');
    }
  }

  app.registerPanel({
    view: 'status',
    id: 'classes',
    order: 13.5,
    title: W.panelTitle,
    mount(el) {
      el.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b || !el.contains(b)) return;
        const h = store.active();
        if (!h) return;
        if (b.dataset.clsSwap) { void doSwap(h.id, b.dataset.clsSwap); return; }
        if (b.dataset.clsBuy) { void doBuyNode(h.id, b.dataset.clsBuy); return; }
        if (b.dataset.clsFlipFrom && b.dataset.clsFlipTo) { void doFlipFork(h.id, b.dataset.clsFlipFrom, b.dataset.clsFlipTo); return; }
        if (b.dataset.clsVesselDel !== undefined) { void doRemoveVessel(h.id, b.dataset.clsVesselDel); return; }
        if ('coOpen' in b.dataset) { offerUi.notice = ''; openOfferModal('player'); return; }
        if ('clsJobSet' in b.dataset) {
          const inp = el.querySelector('[data-cls-job]');
          if (inp instanceof HTMLElement) inp.blur();
          applyJob(h.id, inp ? inp.value : '');
          return;
        }
        if ('clsJobClear' in b.dataset) {
          const inp = el.querySelector('[data-cls-job]');
          if (inp instanceof HTMLElement) inp.blur();
          applyJob(h.id, '');
          return;
        }
      });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.matches('[data-cls-job]')) {
          e.preventDefault();
          e.target.blur();
          const h = store.active();
          if (h) applyJob(h.id, e.target.value);
        }
      });
    },
    update: renderLockerPanel,
  });

  // ── GM Unique-Class Registry (mounted inside gm.js section `classes`) ──

  /** Collects selectable local and remote hunters for GM Grant / Reassign modals. */
  function gmTargetOptions(s, exclude) {
    /** @type {{ value: string; label: string; held: boolean; target: import('../core/hunter/class-holders.ts').HolderTarget }[]} */
    const out = [];
    for (const h of s.hunters) {
      if (exclude && exclude.kind === 'local' && exclude.hunterId === h.id) continue;
      const held = isHeld(s, { hid: h.id });
      out.push({
        value: h.id,
        label: `${h.name} (${h.rank}-rank, ${W.gmLocalKind})${held ? W.inFightSuffix : ''}`,
        held,
        target: { kind: 'local', hunterId: h.id },
      });
    }
    for (const r of A().sync.remoteSheets()) {
      if (exclude && exclude.kind === 'remote' && exclude.sheetKey === r.key) continue;
      const held = isHeld(s, { key: r.key });
      out.push({
        value: r.key,
        label: `${r.data.name} (${r.data.rank}-rank, ${W.gmRemoteKind})${held ? W.inFightSuffix : ''}`,
        held,
        target: { kind: 'remote', sheetKey: r.key, name: r.data.name },
      });
    }
    return out;
  }

  /**
   * Opens the GM Grant or Reassign modal and returns the chosen `HolderTarget`, or null on Cancel.
   * @returns {Promise<import('../core/hunter/class-holders.ts').HolderTarget | null>}
   */
  async function pickHolderTarget(cls, currentHolder) {
    const s = store.get();
    const hunters = gmTargetOptions(s, currentHolder);
    const monsters = s.monsters;
    const defaultKind = hunters.length > 0 ? 'hunter' : 'npc';

    const hunterOpts = hunters.length
      ? hunters.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')
      : `<option value="">${esc(W.gmNoHunters)}</option>`;
    const monsterOpts = `<option value="">${esc(W.gmNpcMonsterNone)}</option>`
      + monsters.map(m => `<option value="${esc(m.id)}">${esc(m.name)} (${esc(m.rank)}-rank)</option>`).join('');

    const hasKit = Boolean(CLASS_SIGNATURES[cls] || activeClassTrees()[cls]);
    const html = `<div class="cls-gm-form">
      ${!hasKit ? `<p class="cls-meta" data-cg-nokit>${esc(W.noKitNote)}</p>` : ''}
      ${currentHolder ? `<p class="cls-meta">${esc(W.gmReassignBody(cls, currentHolder.name))}</p>` : ''}
      <div class="seg" role="group" aria-label="${esc(W.gmTargetKindLabel)}" data-cg-kind>
        <button type="button" data-kind="hunter" aria-pressed="${defaultKind === 'hunter'}">${esc(W.gmTargetHunter)}</button>
        <button type="button" data-kind="npc" aria-pressed="${defaultKind === 'npc'}">${esc(W.gmTargetNpc)}</button>
      </div>
      <div data-cg-hunter${defaultKind === 'hunter' ? '' : ' hidden'}>
        ${ui.field(W.gmSelectHunterLabel, `<select data-cg-hsel>${hunterOpts}</select>`)}
      </div>
      <div data-cg-npc${defaultKind === 'npc' ? '' : ' hidden'}>
        ${ui.field(W.gmNpcNameLabel, `<input type="text" data-cg-npc-name maxlength="${CLASS_NAME_MAX}" autocomplete="off">`)}
        ${ui.field(W.gmNpcMonsterLabel, `<select data-cg-npc-mon>${monsterOpts}</select>`)}
      </div>
      <p class="cls-gm-warn" data-cg-warn hidden></p>
    </div>`;

    const pick = {
      kind: /** @type {'hunter' | 'npc'} */ (defaultKind),
      hunterVal: hunters[0]?.value ?? '',
      npcName: '',
      monsterId: '',
    };

    const ok = await ui.system({
      tag: '! Class',
      title: currentHolder ? W.gmReassignTitle(cls) : W.gmGrantTitle(cls),
      html,
      size: 'form',
      actions: [
        { label: 'Cancel', value: false, cancel: true },
        { label: currentHolder ? W.gmReassignConfirm : W.gmGrantConfirm, value: true, primary: true },
      ],
      drawn(win) {
        const kindBox = win.querySelector('[data-cg-kind]');
        const hWrap = win.querySelector('[data-cg-hunter]');
        const nWrap = win.querySelector('[data-cg-npc]');
        const hSel = win.querySelector('[data-cg-hsel]');
        const nInp = win.querySelector('[data-cg-npc-name]');
        const mSel = win.querySelector('[data-cg-npc-mon]');
        const warnEl = win.querySelector('[data-cg-warn]');

        const sync = () => {
          hWrap.hidden = pick.kind !== 'hunter';
          nWrap.hidden = pick.kind !== 'npc';
          for (const b of kindBox.querySelectorAll('button[data-kind]')) {
            b.setAttribute('aria-pressed', String(b.dataset.kind === pick.kind));
          }
          const selOpt = hunters.find(x => x.value === pick.hunterVal);
          const showHeld = (pick.kind === 'hunter' && !!selOpt?.held);
          warnEl.hidden = !showHeld;
          warnEl.textContent = showHeld ? W.gmHeldWarning : '';
        };

        kindBox.addEventListener('click', e => {
          const b = e.target.closest('button[data-kind]');
          if (!b) return;
          pick.kind = oneOf(b.dataset.kind, ['hunter', 'npc'], 'hunter');
          sync();
        });
        hSel.addEventListener('change', () => { pick.hunterVal = hSel.value; sync(); });
        nInp.addEventListener('input', () => { pick.npcName = nInp.value; });
        mSel.addEventListener('change', () => {
          pick.monsterId = mSel.value;
          if (mSel.value && !nInp.value.trim()) {
            const mon = monsters.find(x => x.id === mSel.value);
            if (mon) { nInp.value = mon.name; pick.npcName = mon.name; }
          }
        });
        sync();
      },
    });
    if (ok !== true) return null;

    if (pick.kind === 'npc') {
      const rawMid = pick.monsterId ? parseSaveId(pick.monsterId) : null;
      const mid = /** @type {import('../core/ids.ts').MonsterId | null} */ (rawMid && rawMid.startsWith('m') ? rawMid : null);
      return { kind: /** @type {const} */ ('npc'), name: pick.npcName, ...(mid ? { monsterId: mid } : {}) };
    }
    const found = hunters.find(x => x.value === pick.hunterVal);
    if (found) return found.target;
    return { kind: /** @type {const} */ ('npc'), name: '' }; // triggers HOLDER_REFUSAL_WORDS['bad-target'] cleanly
  }

  const sayGm = (box, text, bad = false) => {
    const msg = box.querySelector('[data-cg-msg]');
    if (!msg) return;
    msg.textContent = text;
    msg.classList.toggle('bad', !!bad);
  };

  async function gmClaim(box, cls) {
    if (!app.isGM() || !isUniqueClass(cls)) return;
    const target = await pickHolderTarget(cls, null);
    if (!target) return;
    const out = {
      /** @type {import('../core/hunter/class-locker.ts').ClassHolder | null} */
      holder: null,
      /** @type {import('../core/ids.ts').RoomCode | null} */
      code: null,
    };
    const w = store.apply('gm-class-claim', s => {
      const ctx = holderCtx(s);
      out.code = ctx.room;
      const r = claimUniqueClass(s, cls, target, ctx);
      if (isRefused(r)) return r;
      out.holder = r.holder;
      return r.save;
    });
    if (!ui.wrote('GM', w, HOLDER_REFUSAL_WORDS)) {
      if ('why' in w && Object.hasOwn(HOLDER_REFUSAL_WORDS, w.why)) sayGm(box, HOLDER_REFUSAL_WORDS[w.why], true);
      return;
    }
    if (out.code) A().sync.flush();
    if (out.holder) {
      const line = W.gmClaimedToast(cls, out.holder.name);
      sayGm(box, line, false);
      ui.toast('GM', line, { kind: 'good' });
    }
  }

  async function gmRelease(box, cls) {
    if (!app.isGM() || !isUniqueClass(cls)) return;
    const s0 = store.get();
    const cur = holderOf(s0, cls);
    if (!cur) return;
    const curHeld = holderInFight(s0, cur);
    // Skip confirm when holder is in a fight so the core step's plain-words 'held' refusal fires in one tap.
    if (!curHeld) {
      const ok = await ui.confirm({
        title: W.gmReleaseTitle(cls),
        body: W.gmReleaseBody(cls, cur.name),
        danger: true,
        confirmLabel: W.gmReleaseConfirm,
      });
      if (!ok) return;
    }
    const out = {
      /** @type {import('../core/hunter/class-locker.ts').ClassHolder | null} */
      released: null,
      /** @type {import('../core/ids.ts').RoomCode | null} */
      code: null,
    };
    const w = store.apply('gm-class-release', s => {
      const ctx = holderCtx(s);
      out.code = ctx.room;
      const r = releaseUniqueClass(s, cls, ctx);
      if (isRefused(r)) return r;
      out.released = r.released;
      return r.save;
    });
    if (!ui.wrote('GM', w, HOLDER_REFUSAL_WORDS)) {
      if ('why' in w && Object.hasOwn(HOLDER_REFUSAL_WORDS, w.why)) sayGm(box, HOLDER_REFUSAL_WORDS[w.why], true);
      return;
    }
    if (out.code) A().sync.flush();
    if (out.released) {
      const line = W.gmReleasedToast(cls, out.released.name);
      sayGm(box, line, false);
      ui.toast('GM', line, { kind: 'info' });
    }
  }

  async function gmReassign(box, cls) {
    if (!app.isGM() || !isUniqueClass(cls)) return;
    const s0 = store.get();
    const cur = holderOf(s0, cls);
    if (!cur) return;
    // Skip the form when the current holder is in a fight so core's plain-words 'held' refusal fires in one tap, matching gmRelease.
    const nextTarget = holderInFight(s0, cur) ? { kind: /** @type {const} */ ('npc'), name: '' } : await pickHolderTarget(cls, cur);
    if (!nextTarget) return;
    const out = {
      /** @type {{ from: import('../core/hunter/class-locker.ts').ClassHolder; to: import('../core/hunter/class-locker.ts').ClassHolder } | null} */
      res: null,
      /** @type {import('../core/ids.ts').RoomCode | null} */
      code: null,
    };
    const w = store.apply('gm-class-reassign', s => {
      const ctx = holderCtx(s);
      out.code = ctx.room;
      const r = reassignUniqueClass(s, cls, nextTarget, ctx);
      if (isRefused(r)) return r;
      out.res = { from: r.from, to: r.to };
      return r.save;
    });
    if (!ui.wrote('GM', w, HOLDER_REFUSAL_WORDS)) {
      if ('why' in w && Object.hasOwn(HOLDER_REFUSAL_WORDS, w.why)) sayGm(box, HOLDER_REFUSAL_WORDS[w.why], true);
      return;
    }
    if (out.code) A().sync.flush();
    if (out.res) {
      const line = W.gmReassignedToast(cls, out.res.from.name, out.res.to.name);
      sayGm(box, line, false);
      ui.toast('GM', line, { kind: 'good' });
    }
  }

  function applyGmFilter(box) {
    const activeBtn = box.querySelector('[data-cg-filter] button[aria-pressed="true"]');
    const filter = activeBtn ? activeBtn.dataset.f : 'all';
    const q = (box.querySelector('[data-cg-q]')?.value || '').trim().toLowerCase();
    for (const row of box.querySelectorAll('[data-cg-row]')) {
      const okFilter = filter === 'all'
        || (filter === 'mythic' && row.dataset.rarity === 'mythic')
        || (filter === 'epic' && row.dataset.rarity === 'epic')
        || (filter === 'held' && row.dataset.held === '1')
        || (filter === 'open' && row.dataset.held === '0');
      const okQ = !q || (row.dataset.search || '').includes(q);
      row.hidden = !(okFilter && okQ);
    }
  }

  function wireGm(box) {
    box.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || !box.contains(b)) return;
      if (b.dataset.f && b.closest('[data-cg-filter]')) {
        for (const x of box.querySelectorAll('[data-cg-filter] button[data-f]')) x.setAttribute('aria-pressed', String(x === b));
        applyGmFilter(box);
        return;
      }
      if (b.dataset.cgGrant) { void gmClaim(box, b.dataset.cgGrant); return; }
      if (b.dataset.cgReassign) { void gmReassign(box, b.dataset.cgReassign); return; }
      if (b.dataset.cgRelease) { void gmRelease(box, b.dataset.cgRelease); return; }
      if ('cgOfferOpen' in b.dataset) { openOffer(null); return; }
      if ('cgOfferClose' in b.dataset) { closeOfferAction(); return; }
    });
    box.addEventListener('input', e => {
      if (e.target instanceof HTMLInputElement && e.target.matches('[data-cg-q]')) applyGmFilter(box);
    });
  }

  // ── First-mission & GM class offer modal (live for GM pass-and-play and room players) ──

  /** Returns the active player class-offer state if this phone is an eligible player in a room with an open offer. */
  function playerOfferState() {
    if (app.seat() !== 'player') return null;
    const doc = A().sync.doc('classOffer');
    if (!doc || !doc.active) return null;
    const h = store.active();
    if (!h) return null;
    const myKey = A().sync.myKey(h.id);
    if (doc.hunters.length > 0 && (!myKey || !doc.hunters.includes(myKey))) return null;
    // the hunter's pick is read from the offer doc, never the locker (class-offer.ts `classOfferView`)
    const vm = classOfferView(doc, {
      hunter: h,
      myWho: myKey,
      trees: activeClassTrees(),
    });
    return { doc, h, myKey, myPicked: vm.myPicked, vm };
  }

  /** Closes the live class-offer window if open and restores focus. */
  function closeOfferModal() {
    if (!offerWin) return;
    const cur = offerWin;
    offerWin = null;
    closeWindow(cur.win);
    if (cur.trigger instanceof HTMLElement && cur.trigger.isConnected) cur.trigger.focus();
  }

  /** Closes the GM's active class offer in the save. */
  function closeOfferAction() {
    if (!app.isGM() || !store.get().classOffer) return;
    const w = store.apply('class-offer-close', s => closeClassOffer(s, { at: new Date().toISOString(), R: app.rules() }));
    if (!ui.wrote('GM', w, OFFER_REFUSAL_WORDS)) return;
    ui.toast('GM', OFFER_WORDS.gmClosedToast, { kind: 'info' });
    if (offerWin?.kind === 'gm') closeOfferModal();
  }

  /** Opens the class offer (creating `save.classOffer` if none is open for the current room) and shows the live GM modal. */
  function openOffer(gateId = null) {
    if (!app.isGM()) return;
    const room = app.seat() === 'gm' ? A().sync.room() : null;
    const cur = store.get().classOffer;
    if (!cur || cur.room !== room) {
      const liftCap = Boolean(gateId);
      const remoteKeys = liftCap && room ? A().sync.remoteSheets().map(r => r.key) : [];
      const stamp = liftCap && room && remoteKeys.length ? A().sync.stamp() : null;
      const out = { capPosted: false };
      const w = store.apply('class-offer-open', s => {
        const r = openClassOffer(s, {
          at: new Date().toISOString(),
          room,
          R: app.rules(),
          gateId: gateId ?? null,
          liftCap,
          remoteKeys,
          stamp,
        });
        out.capPosted = r.capPosted;
        return r.save;
      });
      if (!ui.wrote('GM', w)) return;
      if (out.capPosted && room) A().sync.flush();
      ui.toast('GM', liftCap ? OFFER_WORDS.gmLiftAndOpenedToast : OFFER_WORDS.gmOpenedToast, { kind: 'good' });
    }
    offerUi.notice = '';
    openOfferModal('gm');
  }

  /** Handles one local GM pick inside the live GM offer modal. */
  function gmPickLocal(cls) {
    const s0 = store.get();
    const offer = s0.classOffer;
    const hid = s0.hunters.find(x => x.id === offerUi.localHid)?.id ?? null;
    if (!app.isGM() || !offer || !hid) return;
    const out = {
      /** @type {import('../core/hunter/class-locker.ts').ClassHolder | null} */
      holder: null,
      /** @type {import('../core/ids.ts').RoomCode | null} */
      code: null,
    };
    const w = store.apply('class-offer-pick', s => {
      const ctx = holderCtx(s);
      out.code = ctx.room;
      const r = pickClassFromOffer(s, { kind: 'local', hunterId: hid }, cls, offer.id, ctx);
      if (isRefused(r)) return r;
      out.holder = r.holder;
      return r.save;
    });
    if (!ui.wrote('GM', w, OFFER_REFUSAL_WORDS)) {
      if ('why' in w) {
        offerUi.notice = w.why === 'class-taken'
          ? classTakenLine(cls, holderOf(store.get(), cls)?.name)
          : (OFFER_REFUSAL_WORDS[w.why] ?? OFFER_WORDS.sendFailed);
      }
      drawOfferModal();
      return;
    }
    offerUi.notice = '';
    if (out.code) A().sync.flush();
    if (out.holder) ui.toast('GM', W.gmClaimedToast(cls, out.holder.name), { kind: 'good' });
    drawOfferModal();
  }

  /** Handles one player phone pick inside the live Player offer modal. */
  function playerPickClass(cls) {
    const state = playerOfferState();
    if (!state || offerUi.pending) return;
    const s = store.get();
    const { doc, h, myKey, myPicked } = state;
    if (!isUniqueClass(cls) || !myKey) { offerUi.notice = OFFER_WORDS.sendFailed; drawOfferModal(); return; }
    if (h.life.at === 'dead') { offerUi.notice = CLASS_REFUSAL_WORDS.dead; drawOfferModal(); return; }
    if (isHeld(s, { hid: h.id })) { offerUi.notice = HOLDER_REFUSAL_WORDS.held; drawOfferModal(); return; }
    if (myPicked) { offerUi.notice = OFFER_REFUSAL_WORDS['already-picked']; drawOfferModal(); return; }
    const regId = activeRegistryId(s);
    const existing = Object.hasOwn(h.classes, cls) ? h.classes[cls] : null;
    if (existing?.registryId && regId && existing.registryId !== regId) {
      offerUi.notice = HOLDER_REFUSAL_WORDS['foreign-class'];
      drawOfferModal();
      return;
    }
    if (!existing && Object.keys(h.classes).length >= CLASS_LOCKER_CAP) {
      offerUi.notice = HOLDER_REFUSAL_WORDS['locker-full'];
      drawOfferModal();
      return;
    }
    const ev = A().sync.event('classPick', { by: myKey, name: h.name, className: cls, offerId: doc.id });
    if (!ev) { offerUi.notice = OFFER_WORDS.sendFailed; drawOfferModal(); return; }
    offerUi.notice = '';
    offerUi.pending = { offerId: doc.id, className: cls, outboxId: ev.payload.eid, by: myKey };
    drawOfferModal();
    A().sync.post(ev);
    A().sync.flush();
  }

  /** Renders one class card for either the GM or player live offer modal. */
  function offerCardHtml(c, mode, opts) {
    const gmHolderName = mode === 'gm' && c.takenAnonymous ? (opts.gmHolderNameOf(c.className) ?? null) : c.takenBy;
    const isPendingThis = mode === 'player' && offerUi.pending?.className === c.className;
    const badges = [
      `<span class="cls-tag r-${esc(c.rarity)}">${esc(c.rarityLabel)}</span>`,
      c.fitsStats ? `<span class="cls-tag ok" data-co-fits>${esc(OFFER_WORDS.fitsBadge)}</span>` : '',
      !c.hasKit ? `<span class="cls-tag" data-co-nokit>${esc(W.noKitBadge)}</span>` : '',
      c.heldByMe ? `<span class="tag-on">${esc(OFFER_WORDS.pickedBadge)}</span>` : '',
    ].join('');
    const foot = c.heldByMe
      ? `<span class="cls-tag ok" data-co-yours>${esc(OFFER_WORDS.pickedBadge)}</span>`
      : !c.open
        ? `<span class="cls-tag" data-co-taken="${esc(c.className)}">${esc(OFFER_WORDS.takenBadge(gmHolderName))}</span>`
        : isPendingThis
          ? `<button type="button" class="primary" disabled aria-busy="true" data-co-picking="${esc(c.className)}">${esc(OFFER_WORDS.pickingAction(c.className))}</button>`
          : mode === 'player'
            ? `<button type="button" class="primary" data-co-pick="${esc(c.className)}"${opts.myPicked || offerUi.pending ? ' disabled' : ''}>${esc(OFFER_WORDS.pickAction)}</button>`
            : `<button type="button" class="primary" data-co-pick="${esc(c.className)}"${!opts.canPickLocal ? ' disabled' : ''}>${esc(OFFER_WORDS.pickAction)}</button>`;
    return `<article class="co-card r-${esc(c.rarity)}${!c.open && !c.heldByMe ? ' taken' : ''}${c.heldByMe ? ' mine' : ''}" data-co-card="${esc(c.className)}" data-co-rarity="${esc(c.rarity)}">
      <div class="cls-head"><span class="r-name">${esc(c.className)}</span><span class="cls-badges">${badges}</span></div>
      <div class="cls-meta">Stat pair: ${esc(c.pairLabel)}</div>
      <div class="co-card-foot">${foot}</div>
    </article>`;
  }

  /** Redraws the live class-offer window body in place (preserving scroll position). */
  function drawOfferModal() {
    if (!offerWin) return;
    const win = offerWin.el.querySelector('.co-win');
    if (!win) return;
    const prevMid = win.querySelector('.co-mid');
    const scrollTop = prevMid ? prevMid.scrollTop : 0;

    if (offerWin.kind === 'player') {
      const state = playerOfferState();
      if (!state) { closeOfferModal(); return; }
      const { vm } = state;
      const msgHtml = offerUi.notice
        ? `<div class="co-msg" data-co-msg role="alert">${esc(offerUi.notice)}</div>`
        : vm.myPicked
          ? `<div class="co-msg good" data-co-picked role="status">${esc(OFFER_WORDS.alreadyPickedLine(vm.myPicked))}</div>`
          : '';
      const allTakenHtml = !vm.myPicked && vm.allTaken
        ? `<div class="co-notice" data-co-all-taken>${esc(OFFER_WORDS.allTakenNotice)}</div>`
        : '';
      const cardOpts = { myPicked: vm.myPicked, canPickLocal: false, gmHolderNameOf: () => null };
      win.innerHTML = `<span class="cb"></span>
        <div class="n-tag">${esc(OFFER_WORDS.tag)}</div>
        <h2 class="n-big co-title" id="co-modal-title">${esc(OFFER_WORDS.title)}</h2>
        <div class="co-mid">
          <p class="cls-meta">${esc(OFFER_WORDS.openBody)}</p>
          ${msgHtml}
          ${allTakenHtml}
          ${vm.mythics.length ? `<div class="co-sec-h">${esc(OFFER_WORDS.mythicHeading)}</div><div class="co-grid" data-co-mythics>${vm.mythics.map(c => offerCardHtml(c, 'player', cardOpts)).join('')}</div>` : ''}
          ${vm.epics.length ? `<div class="co-sec-h">${esc(OFFER_WORDS.epicHeading)}</div><p class="cls-meta" data-co-epic-note>${esc(OFFER_WORDS.epicKeepNote)}</p><div class="co-grid" data-co-epics>${vm.epics.map(c => offerCardHtml(c, 'player', cardOpts)).join('')}</div>` : ''}
        </div>
        <div class="co-actions">
          <button type="button" class="primary" data-co-dismiss>${esc(vm.myPicked || vm.allTaken ? 'Done' : 'Later')}</button>
        </div>`;
    } else {
      const s = store.get();
      const offer = s.classOffer;
      if (!offer) { closeOfferModal(); return; }
      const remotes = new Map(A().sync.remoteSheets().map(r => [r.key, r.data.name]));
      const rawDoc = classOfferDocOf(s, offer.at, remotes);
      const doc = rawDoc.active ? rawDoc : {
        active: /** @type {const} */ (true),
        id: offer.id,
        at: offer.at,
        pool: [...offer.pool],
        hunters: [],
        taken: {},
      };
      const eligibleLocal = s.hunters.filter(h => !classesHeldBy(s, { kind: 'local', hunterId: h.id }).some(c => offer.pool.includes(c)));
      if (!eligibleLocal.some(h => h.id === offerUi.localHid)) offerUi.localHid = eligibleLocal[0]?.id ?? '';
      const selectedLocal = eligibleLocal.find(h => h.id === offerUi.localHid) ?? null;
      const vm = classOfferView(doc, {
        hunter: selectedLocal,
        myWho: 'gm',
        trees: activeClassTrees(),
      });
      const inRoom = app.seat() === 'gm';
      const localBarHtml = s.hunters.length
        ? `<div class="co-local-bar">
            ${eligibleLocal.length
              ? ui.field(OFFER_WORDS.gmPickForLabel, `<select data-co-local>${eligibleLocal.map(h => `<option value="${esc(h.id)}"${h.id === offerUi.localHid ? ' selected' : ''}>${esc(h.name)} (${esc(h.rank)}-rank)</option>`).join('')}</select>`)
              : `<p class="cls-meta">${esc(OFFER_WORDS.gmNoLocalHunters)}</p>`}
          </div>`
        : '';
      const msgHtml = offerUi.notice ? `<div class="co-msg" data-co-msg role="alert">${esc(offerUi.notice)}</div>` : '';
      const allTakenHtml = vm.allTaken ? `<div class="co-notice" data-co-all-taken>${esc(OFFER_WORDS.allTakenNotice)}</div>` : '';
      const cardOpts = {
        myPicked: null,
        canPickLocal: !!selectedLocal,
        gmHolderNameOf: cls => holderOf(s, cls)?.name ?? null,
      };
      win.innerHTML = `<span class="cb"></span>
        <div class="n-tag">${esc(OFFER_WORDS.tag)}</div>
        <h2 class="n-big co-title" id="co-modal-title">${esc(OFFER_WORDS.gmOfferTitle)} (${esc(vm.openCount)}/${esc(vm.totalCount)} open)</h2>
        <div class="co-mid">
          <p class="cls-meta">${esc(inRoom ? OFFER_WORDS.gmOfferRoomHint : OFFER_WORDS.gmOfferLocalHint)}</p>
          ${localBarHtml}
          ${msgHtml}
          ${allTakenHtml}
          ${vm.mythics.length ? `<div class="co-sec-h">${esc(OFFER_WORDS.mythicHeading)}</div><div class="co-grid" data-co-mythics>${vm.mythics.map(c => offerCardHtml(c, 'gm', cardOpts)).join('')}</div>` : ''}
          ${vm.epics.length ? `<div class="co-sec-h">${esc(OFFER_WORDS.epicHeading)}</div><p class="cls-meta" data-co-epic-note>${esc(OFFER_WORDS.epicKeepNote)}</p><div class="co-grid" data-co-epics>${vm.epics.map(c => offerCardHtml(c, 'gm', cardOpts)).join('')}</div>` : ''}
        </div>
        <div class="co-actions">
          <button type="button" class="danger" data-co-close-offer>${esc(OFFER_WORDS.gmCloseButton)}</button>
          <button type="button" class="primary" data-co-dismiss>Done</button>
        </div>`;
    }

    const nextMid = win.querySelector('.co-mid');
    if (nextMid && scrollTop > 0) nextMid.scrollTop = scrollTop;
  }

  /** Opens the live GM or Player class-offer overlay window on the shared window stack. */
  function openOfferModal(kind) {
    if (offerWin) {
      if (offerWin.kind === kind) { drawOfferModal(); return; }
      closeOfferModal();
    }
    if (kind === 'player' && !playerOfferState()) return;
    if (kind === 'gm' && !store.get().classOffer) return;
    const trigger = document.activeElement;
    const el = ui.h('<div class="overlay co-ov show" data-co-modal><div class="sys-window co-win" role="dialog" aria-modal="true" aria-labelledby="co-modal-title"></div></div>');
    const winEl = el.firstElementChild;
    const win = openWindow(
      'shelf',
      () => { document.body.appendChild(el); return { root: el, win: winEl }; },
      e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeOfferModal(); }
        else if (e.key === 'Tab') trapTab(e, winEl);
      },
    );
    offerWin = { win, el, kind, trigger };
    el.addEventListener('click', e => {
      if (e.target === el) { closeOfferModal(); return; }
      const b = e.target.closest('button');
      if (!b || !el.contains(b)) return;
      if ('coDismiss' in b.dataset) { closeOfferModal(); return; }
      if ('coCloseOffer' in b.dataset) { closeOfferAction(); return; }
      if (b.dataset.coPick) {
        if (offerWin?.kind === 'gm') gmPickLocal(b.dataset.coPick);
        else playerPickClass(b.dataset.coPick);
      }
    });
    el.addEventListener('change', e => {
      if (e.target instanceof HTMLSelectElement && e.target.matches('[data-co-local]')) {
        offerUi.localHid = e.target.value;
        offerUi.notice = '';
        drawOfferModal();
      }
    });
    drawOfferModal();
    void enter(el, 'fade');
    void enter(winEl);
    const focusEl = winEl.querySelector('button:not([disabled]), select:not([disabled])');
    if (focusEl instanceof HTMLElement) focusEl.focus();
  }

  /** Reconciles player pending picks, auto-open on new offers, room switches, and live modal redraws. */
  function reconcileOfferUi() {
    const curRoom = A().sync.room() ?? '';
    if (curRoom !== offerUi.lastRoom) {
      offerUi = { seenId: '', pending: null, notice: '', localHid: '', lastRoom: curRoom };
      if (offerWin?.kind === 'player') closeOfferModal();
    }

    const state = playerOfferState();
    const p = offerUi.pending;
    if (p) {
      if (!state || state.doc.id !== p.offerId) {
        offerUi.pending = null;
      } else {
        const taken = state.doc.taken[p.className];
        if (taken && taken.who !== p.by) {
          offerUi.pending = null;
          offerUi.notice = classTakenLine(p.className, taken.name);
        } else if (taken && taken.who === p.by) {
          offerUi.pending = null;
          offerUi.notice = '';
          if (state.myKey === p.by) ui.toast('! Class', OFFER_WORDS.alreadyPickedLine(p.className), { kind: 'good' });
        } else if (state.myKey === p.by && state.myPicked && state.myPicked !== p.className) {
          offerUi.pending = null;
        } else if (state.myKey === p.by && isHeld(store.get(), { hid: state.h.id })) {
          offerUi.pending = null;
          offerUi.notice = HOLDER_REFUSAL_WORDS.held;
        }
      }
    }

    if (state && offerUi.seenId !== state.doc.id) {
      offerUi.seenId = state.doc.id;
      offerUi.notice = '';
      if (!state.myPicked && !offerWin) openOfferModal('player');
    }

    if (offerWin) {
      if (offerWin.kind === 'player' && !state) closeOfferModal();
      else if (offerWin.kind === 'gm' && !store.get().classOffer) closeOfferModal();
      else drawOfferModal();
    }
  }

  /** Draws the GM's Unique classes section in `box`; returns the section header summary. */
  function paint(box) {
    if (!box.dataset.cg) {
      box.dataset.cg = '1';
      box.innerHTML = `<div class="co-gm-bar" data-cg-offer-bar></div>
        <p class="empty">${esc(W.gmHint)}</p>
        <div class="cls-gm-ctrl">
          <div class="seg" role="group" aria-label="${esc(W.gmFilterAria)}" data-cg-filter>
            <button type="button" data-f="all" aria-pressed="true">${esc(W.gmFilterAll)}</button>
            <button type="button" data-f="mythic" aria-pressed="false">${esc(W.gmFilterMythic)}</button>
            <button type="button" data-f="epic" aria-pressed="false">${esc(W.gmFilterEpic)}</button>
            <button type="button" data-f="held" aria-pressed="false">${esc(W.gmFilterHeld)}</button>
            <button type="button" data-f="open" aria-pressed="false">${esc(W.gmFilterOpen)}</button>
          </div>
          <span class="cls-gm-q">${ui.field(W.gmSearchLabel, '<input type="text" data-cg-q maxlength="60" autocomplete="off">')}</span>
        </div>
        <div class="gm-msg" data-cg-msg role="status" aria-live="polite"></div>
        <ul class="cls-gm-list" data-cg-list aria-label="${esc(W.gmListAria)}"></ul>`;
      wireGm(box);
    }

    const s = store.get();
    const offerBar = box.querySelector('[data-cg-offer-bar]');
    if (offerBar) {
      const offerHtml = s.classOffer
        ? `<button type="button" class="primary" data-cg-offer-open>${esc(OFFER_WORDS.gmManageButton)}</button>
           <button type="button" class="danger" data-cg-offer-close>${esc(OFFER_WORDS.gmCloseButton)}</button>
           <span class="tag-on" data-cg-offer-live>${esc(OFFER_WORDS.gmOfferOpenBadge)}</span>`
        : `<button type="button" class="primary" data-cg-offer-open>${esc(OFFER_WORDS.gmOpenButton)}</button>`;
      if (offerBar.dataset.sig !== offerHtml) {
        offerBar.dataset.sig = offerHtml;
        offerBar.innerHTML = offerHtml;
      }
    }
    const inRoom = app.seat() === 'gm';
    const remotes = A().sync.remoteSheets().map(r => ({ key: r.key, name: r.data.name }));
    const vm = registryView(s, {
      inRoom,
      holdersDoc: inRoom ? A().sync.doc('holders') : null,
      heldLocal: hid => isHeld(s, { hid }),
      heldRemote: key => isHeld(s, { key }),
      remotes,
      trees: activeClassTrees(),
    });

    const listHtml = vm.rows.map(r => {
      const search = [r.className, r.rarityLabel, r.pairLabel, r.holderName || W.gmUnclaimed].join(' ').toLowerCase();
      const holderLine = r.holder && r.holderName && r.holderKindLabel
        ? W.gmHeldBy(r.holderName, r.holderKindLabel)
        : W.gmUnclaimed;
      const syncTag = r.synced === false
        ? `<span class="cls-tag" data-cg-sync="syncing">${esc(W.syncingBadge)}</span>`
        : r.synced === true && r.holder
          ? `<span class="cls-tag ok" data-cg-sync="synced">${esc(W.syncedBadge)}</span>`
          : '';
      const kitTag = !r.hasKit ? `<span class="cls-tag" data-cg-nokit>${esc(W.noKitBadge)}</span>` : '';
      const actions = r.holder
        ? `<button type="button" data-cg-reassign="${esc(r.className)}">${esc(W.gmReassignAction)}</button>
           <button type="button" class="danger" data-cg-release="${esc(r.className)}">${esc(W.gmReleaseAction)}</button>`
        : `<button type="button" class="primary" data-cg-grant="${esc(r.className)}">${esc(W.gmGrantAction)}</button>`;
      return `<li class="cls-row${r.holder ? ' on' : ''}" data-cg-row="${esc(r.className)}" data-rarity="${esc(r.rarity)}" data-held="${r.holder ? '1' : '0'}" data-search="${esc(search)}">
        <div class="cls-row-main">
          <div class="cls-head">
            <span class="r-name">${esc(r.className)}</span>
            <span class="cls-badges">
              <span class="cls-tag r-${esc(r.rarity)}">${esc(r.rarityLabel)}</span>
              ${kitTag}
              ${r.inFight ? `<span class="cls-tag warn">${esc(W.inFightBadge)}</span>` : ''}
              ${syncTag}
            </span>
          </div>
          <div class="cls-meta">${esc(r.pairLabel)} · ${esc(`${W.recRankPrefix}${r.recRank}`)} · ${esc(holderLine)}</div>
        </div>
        <div class="cls-row-acts">${actions}</div>
      </li>`;
    }).join('');

    const ul = box.querySelector('[data-cg-list]');
    if (ul.dataset.sig !== listHtml) {
      ul.dataset.sig = listHtml;
      ul.innerHTML = listHtml;
      applyGmFilter(box);
    }
    return vm.summary;
  }

  // ── Room sync listeners: redraw only when DOCS.holders/classOffer changed + handle classSwap/classNode/classPick ──

  app.on('sync:docs', () => {
    const sig = JSON.stringify([A().sync.doc('holders'), A().sync.doc('classOffer')]);
    reconcileOfferUi();
    if (sig !== holdersSig) {
      holdersSig = sig;
      app.redraw();
    }
  });

  app.on('change', () => {
    reconcileOfferUi();
  });

  app.on('sync:room', () => {
    reconcileOfferUi();
  });

  app.on('sync:outbox', msg => {
    if (offerUi.pending && msg.id === offerUi.pending.outboxId && (msg.at === 'refused' || msg.at === 'dropped')) {
      offerUi.pending = null;
      offerUi.notice = OFFER_WORDS.sendFailed;
      drawOfferModal();
    }
  });

  app.on('sync:event', ({ event: ev }) => {
    // a player's phone: the GM refused its pick, or let go of the class it was claiming (statechart rule 5)
    if (app.seat() === 'player') {
      const p = offerUi.pending;
      if (!p) return;
      if (ev.type === 'classPickRefused' && ev.payload.pick === p.outboxId) {
        // a class another hunter took is told with the holder's name from the offer doc; a doc not yet showing it settles
        // the pick itself when it lands (reconcileOfferUi), with the name
        const doc = A().sync.doc('classOffer'), taken = doc && doc.active ? doc.taken[p.className] : undefined;
        if (ev.payload.why === 'class-taken' && !taken) return;
        offerUi.pending = null;
        offerUi.notice = ev.payload.why === 'class-taken' && taken ? classTakenLine(p.className, taken.name) : pickRefusedLine(ev.payload.why, p.className);
        drawOfferModal();
      } else if (ev.type === 'classRevoke' && ev.payload.className === p.className) {
        if (!ev.payload.to.includes(p.by)) return;
        offerUi.pending = null;
        offerUi.notice = OFFER_WORDS.releasedNotice(p.className);
        drawOfferModal();
      }
      return;
    }
    if (app.seat() !== 'gm') return;
    const R = app.rules();
    if (ev.type === 'classSwap') {
      const p = ev.payload;
      const said = classSwapSaid(p.name || 'Hunter', p.fromClass, p.toClass, p.cost);
      if (!A().sync.once(p.eid, logged(logLine(store.id('l'), new Date().toISOString(), 'system', null, said.title, said.text), R))) return;
      ui.toast('! Class', said.text, { kind: 'info' });
    } else if (ev.type === 'classNode') {
      const p = ev.payload;
      const tree = classTreeOf(p.className, activeClassTrees());
      const nameOf = id => tree?.nodes.find(n => n.id === id)?.name ?? id;
      const said = p.act === 'flip' && p.fromId
        ? classForkSaid(p.name || 'Hunter', p.className, nameOf(p.fromId), nameOf(p.nodeId), p.cost)
        : classNodeSaid(p.name || 'Hunter', p.className, nameOf(p.nodeId), p.cost);
      // Log node buys and fork flips quietly without toast spam during multi-node spending.
      A().sync.once(p.eid, logged(logLine(store.id('l'), new Date().toISOString(), 'system', null, said.title, said.text), R));
    } else if (ev.type === 'classPick') {
      const p = ev.payload;
      const out = {
        /** @type {import('../core/hunter/class-locker.ts').ClassHolder | null} */
        holder: null,
        /** @type {import('../core/ids.ts').RoomCode | null} */
        code: null,
      };
      // the pick and, on a refusal, its answer to the player's phone in one write (class-offer.ts `pickAnswered`)
      const applied = A().sync.once(p.eid, s => {
        const ctx = holderCtx(s);
        out.code = ctx.room;
        const r = pickAnswered(s, { sheetKey: p.by, name: p.name || 'Hunter' }, p.className, p.offerId, p.eid, ctx);
        out.holder = r.holder;
        return r.save;
      });
      if (applied && out.code) A().sync.flush();
      if (applied && out.holder) {
        ui.toast('! Class', OFFER_WORDS.gmPlayerClaimedToast(out.holder.name, p.className), { kind: 'good' });
        if (offerWin?.kind === 'gm') drawOfferModal();
      }
    } else if (ev.type === 'classGrantRefused') {
      // a player's phone could not take a unique class: the registry lets it go (class-holders.ts `grantRefused`)
      const p = ev.payload;
      const out = {
        /** @type {import('../core/hunter/class-locker.ts').ClassHolder | null} */
        released: null,
        /** @type {import('../core/ids.ts').RoomCode | null} */
        code: null,
      };
      const applied = A().sync.once(p.eid, s => {
        const ctx = holderCtx(s);
        out.code = ctx.room;
        const r = grantRefused(s, p, ctx);
        if (isRefused(r)) return s;
        out.released = r.released;
        return r.save;
      });
      if (applied && out.released) {
        if (out.code) A().sync.flush();
        ui.toast('Class', grantRefusedLine(out.released.name, p.className, p.why), { kind: 'warning' });
        if (offerWin?.kind === 'gm') drawOfferModal();
      }
    }
  });

  app.api.classUi = { paint, openOffer };
}
