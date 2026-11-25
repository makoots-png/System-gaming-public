// classes.js: player class locker, skill tree viewer/buyer, fork flip modal, GM unique-class registry, and GM room
// logging for classSwap/classNode (PR 3). Every save mutation delegates to src/core/hunter/classes.ts or
// src/core/hunter/class-holders.ts; every sentence comes from src/core/hunter/class-view.ts, classes.ts, or class-holders.ts.
import { parseClassNodeId, parseSaveId, parseSheetKey } from '../core/ids.ts';
import { oneOf } from '../core/one-of.ts';
import { CLASS_SIGNATURES } from '../core/registry/class-powers.ts';
import { CLASS_TREES, classTreeOf } from '../core/registry/class-trees.ts';
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
  setJob,
  swapClass,
  swapCost,
} from '../core/hunter/classes.ts';
import {
  HOLDER_REFUSAL_WORDS,
  claimUniqueClass,
  holderOf,
  reassignUniqueClass,
  releaseUniqueClass,
} from '../core/hunter/class-holders.ts';
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

const CSS = `
.cls-active{border:1px solid var(--line-bright);background:rgba(10,26,46,.65);padding:10px 12px;margin-bottom:10px}
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
.cls-starter>summary{cursor:pointer;min-height:var(--control-h);display:flex;align-items:center;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--cyan-dim)}
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
@media (max-width:720px){.cls-nodes,.cls-fork-grid{grid-template-columns:minmax(0,1fr)}.cls-row-acts button{flex:1 0 auto}}
`;

/** Returns active class trees: production `CLASS_TREES` always takes precedence over Playwright test fixtures. */
const activeTrees = () => {
  const injected = /** @type {import('../core/registry/class-trees.ts').ClassTreeMap | undefined} */ (
    /** @type {any} */ (globalThis).__e2eClassTrees
  );
  return injected ? { ...injected, ...CLASS_TREES } : CLASS_TREES;
};

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc } = ui;
  const A = () => app.api;
  ui.css('classes', CSS);

  /** Last drawn `DOCS.holders` snapshot so `sync:docs` redraws only when holders actually changed. */
  let holdersSig = '';

  /** Whether a local (`{ hid }`) or remote (`{ key }`) hunter is currently held in a fight on save `s` (shared via `hunter.heldIn`). */
  const heldIn = (s, who) => A().hunter.heldIn(s, who) !== null;

  /** Campaign registry id active on this phone: the room's `DOCS.holders` for a player, the local save's for a GM, else null. */
  const activeRegistryId = () => {
    const seat = app.seat();
    if (seat === 'player') return A().sync.doc('holders')?.registryId ?? null;
    if (app.isGM()) return store.get().classHolders.registryId;
    return null;
  };

  /** Builds a `ClassStepCtx` for `swapClass`, `buyClassNode`, or `flipClassFork` inside `store.apply`. */
  const classCtx = (s, hid) => {
    const role = /** @type {import('../core/role.ts').Role} */ (app.isGM() ? 'gm' : 'player');
    const room = role === 'player' ? A().sync.room() : null;
    return {
      role,
      held: heldIn(s, { hid }),
      at: new Date().toISOString(),
      room,
      stamp: room ? A().sync.stamp() : null,
      R: app.rules(),
      activeRegistryId: activeRegistryId(),
      trees: activeTrees(),
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
      heldLocal: hid => heldIn(s, { hid }),
      heldRemote: key => heldIn(s, { key }),
    };
  };

  // ── Player actions: setJob, swapClass, buyClassNode, flipClassFork ──

  function applyJob(hid, raw) {
    const clean = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, CLASS_NAME_MAX);
    const w = store.apply('class-job', s => atHunter(hid, h => setJob(h, clean || null, { held: heldIn(s, { hid }), dead: h.life.at === 'dead' }))(s));
    if (!ui.wrote('! Class', w, CLASS_REFUSAL_WORDS)) return;
    ui.toast('! Class', W.jobSetToast(store.hunter(hid)?.job ?? null), { kind: 'info' });
  }

  async function doSwap(hid, targetClass) {
    const h = store.hunter(hid);
    if (!h) return;
    const R = app.rules(), role = app.isGM() ? 'gm' : 'player';
    const plan = swapCost(h, role, R);
    const regId = activeRegistryId();
    const entry = Object.hasOwn(h.classes, targetClass) ? h.classes[targetClass] : null;
    const parked = isUniqueClass(targetClass) && !!regId && !!entry?.registryId && entry.registryId !== regId;
    const holdersPending = isUniqueClass(targetClass) && app.seat() === 'player' && !!entry?.registryId && !regId;
    const isHeld = heldIn(store.get(), { hid });
    const targetDef = classDefOf(targetClass);
    const curDef = classDefOf(h.job);
    const pairChanged = !!targetDef && !!curDef && targetDef.pair !== curDef.pair;

    if (plan.cost > 0 && h.life.at !== 'dead' && !isHeld && !parked && !holdersPending && h.gold >= plan.cost) {
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
    const R = app.rules(), role = app.isGM() ? 'gm' : 'player', trees = activeTrees();
    const tree = classTreeOf(h.job, trees);
    const node = tree ? tree.nodes.find(n => n.id === nodeId) : null;
    const priced = nodeCost(h, h.job, nodeId, role, R, trees);
    const cost = isRefused(priced) ? 0 : priced.cost;
    const isHeld = heldIn(store.get(), { hid });

    if (cost > 0 && node && h.job && h.life.at !== 'dead' && !isHeld && h.gold >= cost) {
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
    const R = app.rules(), role = app.isGM() ? 'gm' : 'player', trees = activeTrees();
    const tree = classTreeOf(h.job, trees);
    const entry = h.job && Object.hasOwn(h.classes, h.job) ? h.classes[h.job] : null;
    const plan = forkFlipCost(h, role, R);
    const isHeld = heldIn(store.get(), { hid });
    const prev = tree && entry ? forkFlipPreview(tree, entry.nodes, fromId, toId) : null;

    if (prev && h.life.at !== 'dead' && !isHeld && h.gold >= plan.cost) {
      const lines = prev.dropped.length ? [W.flipDroppedLine(prev.dropped.map(n => n.name))] : [];
      const ok = await ui.warn({
        tag: W.flipWarnTag,
        title: W.flipWarnTitle(prev.from.name, prev.to.name),
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

  // ── Player panel on Status view ──

  function renderLockerPanel(el) {
    const h = store.active(), s = store.get(), R = app.rules();
    const role = /** @type {import('../core/role.ts').Role} */ (app.isGM() ? 'gm' : 'player');
    const holdersDoc = A().sync.doc('holders');
    const vm = lockerView(h, {
      role,
      held: heldIn(s, { hid: h.id }),
      R,
      activeRegistryId: activeRegistryId(),
      mySheetKey: A().sync.myKey(h.id),
      holdersDoc,
      trees: activeTrees(),
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
          ${vm.activePairLabel ? `<p class="cls-meta">Stat pair: ${esc(vm.activePairLabel)}${vm.activeRecRank ? ` · Recommended rank: ${esc(vm.activeRecRank)}` : ''}</p>` : ''}
        </div>`;

    const lockerRows = vm.entries.length
      ? `<ul class="cls-list" data-cls-locker>${vm.entries.map(e => {
          const progress = e.nodesCap ? `${e.nodesBought}/${e.nodesCap} nodes` : `${e.nodesBought} nodes`;
          const meta = [e.pairLabel, progress, e.recRank ? `Rank ${e.recRank}` : null].filter(Boolean).join(' · ');
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
          <div class="cls-depth-h">Depth ${esc(g.depth)}${g.depth === 1 ? ' (Root)' : g.nodes.some(n => n.capstone) ? ' (Capstone)' : ''}</div>
          <div class="cls-nodes">${depthNodesHtml(g.nodes)}</div>
        </div>`).join('')}
      </details>`
      : vm.treeMissing
        ? `<div class="lbl dv-sub">${esc(W.treeHeading)}</div><p class="empty" data-cls-tree-empty>${esc(W.treeEmpty)}</p>`
        : vm.entries.length > 0
          ? `<div class="lbl dv-sub">${esc(W.treeHeading)}</div><p class="empty" data-cls-tree-empty>${esc(W.treeNoActive)}</p>`
          : '';

    const html = `${activeHtml}
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
        if ('clsJobSet' in b.dataset) {
          const inp = el.querySelector('[data-cls-job]');
          applyJob(h.id, inp ? inp.value : '');
          return;
        }
        if ('clsJobClear' in b.dataset) { applyJob(h.id, ''); return; }
      });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.matches('[data-cls-job]')) {
          e.preventDefault();
          applyJob(store.active().id, e.target.value);
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
      const held = heldIn(s, { hid: h.id });
      out.push({
        value: h.id,
        label: `${h.name} (${h.rank}-rank, ${W.gmLocalKind})${held ? ' (in fight)' : ''}`,
        held,
        target: { kind: 'local', hunterId: h.id },
      });
    }
    for (const r of A().sync.remoteSheets()) {
      if (exclude && exclude.kind === 'remote' && exclude.sheetKey === r.key) continue;
      const held = heldIn(s, { key: r.key });
      out.push({
        value: r.key,
        label: `${r.data.name} (${r.data.rank}-rank, ${W.gmRemoteKind})${held ? ' (in fight)' : ''}`,
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
    const currentHeld = currentHolder
      ? (currentHolder.kind === 'local' ? heldIn(s, { hid: currentHolder.hunterId }) : currentHolder.kind === 'remote' ? heldIn(s, { key: currentHolder.sheetKey }) : false)
      : false;

    const hunterOpts = hunters.length
      ? hunters.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')
      : `<option value="">${esc(W.gmNoHunters)}</option>`;
    const monsterOpts = `<option value="">${esc(W.gmNpcMonsterNone)}</option>`
      + monsters.map(m => `<option value="${esc(m.id)}">${esc(m.name)} (${esc(m.rank)}-rank)</option>`).join('');

    const hasKit = Boolean(CLASS_SIGNATURES[cls] || activeTrees()[cls]);
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
      <p class="cls-gm-warn" data-cg-warn${currentHeld ? '' : ' hidden'}>${currentHeld ? esc(W.gmHeldWarning) : ''}</p>
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
          const showHeld = currentHeld || (pick.kind === 'hunter' && !!selOpt?.held);
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
    const sk = parseSheetKey(pick.hunterVal);
    if (sk) return { kind: /** @type {const} */ ('remote'), sheetKey: sk, name: 'Hunter' };
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
    const isHeld = cur.kind === 'local' ? heldIn(s0, { hid: cur.hunterId }) : cur.kind === 'remote' ? heldIn(s0, { key: cur.sheetKey }) : false;
    // Skip confirm when holder is in a fight so the core step's plain-words 'held' refusal fires in one tap.
    if (!isHeld) {
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
    const cur = holderOf(store.get(), cls);
    if (!cur) return;
    const nextTarget = await pickHolderTarget(cls, cur);
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
    });
    box.addEventListener('input', e => {
      if (e.target instanceof HTMLInputElement && e.target.matches('[data-cg-q]')) applyGmFilter(box);
    });
  }

  /** Draws the GM's Unique classes section in `box`; returns the section header summary. */
  function paint(box) {
    if (!box.dataset.cg) {
      box.dataset.cg = '1';
      box.innerHTML = `<p class="empty">${esc(W.gmHint)}</p>
        <div class="cls-gm-ctrl">
          <div class="seg" role="group" aria-label="Filter unique classes" data-cg-filter>
            <button type="button" data-f="all" aria-pressed="true">${esc(W.gmFilterAll)}</button>
            <button type="button" data-f="mythic" aria-pressed="false">${esc(W.gmFilterMythic)}</button>
            <button type="button" data-f="epic" aria-pressed="false">${esc(W.gmFilterEpic)}</button>
            <button type="button" data-f="held" aria-pressed="false">${esc(W.gmFilterHeld)}</button>
            <button type="button" data-f="open" aria-pressed="false">${esc(W.gmFilterOpen)}</button>
          </div>
          <span class="cls-gm-q">${ui.field('Search classes', '<input type="text" data-cg-q maxlength="60" autocomplete="off">')}</span>
        </div>
        <div class="gm-msg" data-cg-msg role="status" aria-live="polite"></div>
        <ul class="cls-gm-list" data-cg-list aria-label="Unique classes"></ul>`;
      wireGm(box);
    }

    const s = store.get();
    const inRoom = app.seat() === 'gm';
    const remotes = A().sync.remoteSheets().map(r => ({ key: r.key, name: r.data.name }));
    const vm = registryView(s, {
      inRoom,
      holdersDoc: inRoom ? A().sync.doc('holders') : null,
      heldLocal: hid => heldIn(s, { hid }),
      heldRemote: key => heldIn(s, { key }),
      remotes,
      trees: activeTrees(),
    });

    const listHtml = vm.rows.map(r => {
      const search = [r.className, r.rarityLabel, r.pairLabel, r.holderName || W.gmUnclaimed].join(' ').toLowerCase();
      const holderLine = r.holder && r.holderName
        ? `Held by ${r.holderName} (${r.holderKindLabel})`
        : W.gmUnclaimed;
      const syncTag = r.synced === true
        ? `<span class="cls-tag ok" data-cg-sync="synced">${esc(W.syncedBadge)}</span>`
        : r.synced === false
          ? `<span class="cls-tag" data-cg-sync="syncing">${esc(W.syncingBadge)}</span>`
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
              <span class="cls-tag">Rank ${esc(r.recRank)}</span>
              ${kitTag}
              ${r.inFight ? `<span class="cls-tag warn">${esc(W.inFightBadge)}</span>` : ''}
              ${syncTag}
            </span>
          </div>
          <div class="cls-meta">${esc(r.pairLabel)} · ${esc(holderLine)}</div>
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

  // ── Room sync listeners: redraw only when DOCS.holders changed + log player classSwap / classNode on GM phone ──

  app.on('sync:docs', () => {
    const sig = JSON.stringify(A().sync.doc('holders'));
    if (sig !== holdersSig) {
      holdersSig = sig;
      app.redraw();
    }
  });

  app.on('sync:event', ({ event: ev }) => {
    if (!app.isGM()) return;
    const R = app.rules();
    if (ev.type === 'classSwap') {
      const p = ev.payload;
      const said = classSwapSaid(p.name || 'Hunter', p.fromClass, p.toClass, p.cost);
      if (!A().sync.once(p.eid, logged(logLine(store.id('l'), new Date().toISOString(), 'system', null, said.title, said.text), R))) return;
      ui.toast('! Class', said.text, { kind: 'info' });
    } else if (ev.type === 'classNode') {
      const p = ev.payload;
      const tree = classTreeOf(p.className, activeTrees());
      const nameOf = id => tree?.nodes.find(n => n.id === id)?.name ?? id;
      const said = p.act === 'flip' && p.fromId
        ? classForkSaid(p.name || 'Hunter', p.className, nameOf(p.fromId), nameOf(p.nodeId), p.cost)
        : classNodeSaid(p.name || 'Hunter', p.className, nameOf(p.nodeId), p.cost);
      // Log node buys and fork flips quietly without toast spam during multi-node spending.
      A().sync.once(p.eid, logged(logLine(store.id('l'), new Date().toISOString(), 'system', null, said.title, said.text), R));
    }
  });

  app.api.classUi = { paint };
}
