// inventory.js (U05): inventory, equipment, gold, shop and loot tables. Publishes app.api.inventory.
import { PERK_KEYS, PERK_LABELS, TIERS, rules } from '../edge/rules.ts';
import { ITEM_TYPES, SLOTS } from '../core/save.ts';
import { oneOf } from '../core/one-of.ts';
import { itemOps, itemSource } from '../core/effects.ts';
import { builtInItems, defaultShop, lootPool, parseItem, valueOf, weightOf } from '../core/registry/items.ts';
import { itemAbilityId } from '../core/registry/abilities.ts';
import { BUY_REFUSALS, BUY_WORDS, GEAR_WORDS, SHOP_CLOSED, addGold, buy, editItem, equip, putItem, removeItem, removeShopItem, sell, sellable, sellPrice as sellPriceOf, sellTotal, shopOpen, stackOf, unequip, wearMove, withShop, writeShopItem } from '../core/hunter/inventory.ts';
import { fitted } from '../core/hunter/sheet.ts';
import { USE_WORDS, spendItem, tooLowOf, usable, useDice, useItem, useWords } from '../core/hunter/use.ts';
import { atHunter, both, isRefused, refuse } from '../core/save-step.ts';
import { cryptoRandom, rollSettle } from '../edge/roll.ts';
import { rollLoot } from '../core/gates/spawn.ts';
import { postNews, reportWords } from '../core/sync/connection.ts';

const BONUS_KEYS = PERK_KEYS;
const SLOT_LABEL = { weapon: 'Weapon', offhand: 'Off-hand', head: 'Head', chest: 'Chest', hands: 'Hands', legs: 'Legs', feet: 'Feet', neck: 'Neck', ring1: 'Ring 1', ring2: 'Ring 2' };
const cap = s => s[0].toUpperCase() + s.slice(1);


const sellPrice = i => sellPriceOf(i, rules());
const bonusText = b => BONUS_KEYS.filter(k => b?.[k]).map(k => `${b[k] > 0 ? '+' : ''}${b[k]} ${PERK_LABELS[k]}`).join(', ');

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc, fmt } = ui;

  /** Whether hunter `hid` is in a fight: inventory.ts refuses every change of what is worn there (`TABLE`). */
  const inFight = hid => app.api.loadouts.inFight(hid);
  /**
   * Whether `event` on item `itemId` is refused now (inventory.ts `wearMove`), after the toast that says why: the Bag asks
   * before it opens a confirm or the item maker, so a worn item in a fight is refused at the tap.
   */
  const wearRefused = (h, itemId, event) => {
    const to = wearMove(h, itemId, event, inFight(h.id));
    if (!isRefused(to)) return false;
    ui.wrote('System', to, GEAR_WORDS);
    return true;
  };

  // ── the rules are src/core/hunter/inventory.ts; each write is store.apply of one of them ──
  const shopList = () => store.get().shop ?? defaultShop(rules());
  /** The GM's shop after `f` changes the list shown: it becomes the GM's own at its first edit. */
  const shopEdit = f => store.apply('shop-edit', s => withShop(s, f(shopList())));
  /**
   * A change to one hunter's bag. What is worn is on the sheet, and taking a worn thing away (selling it, removing it,
   * using up the last) lowers its maxima as unequipping does, so HP, mana and fatigue are fitted after every change.
   */
  const onBag = (hid, why, step) => store.apply(why, atHunter(hid, both(step, x => fitted(x, rules()))));

  /**
   * A consumable used by a hunter whose HP, mana and fatigue a fight holds (`hunter.fightOf`) is the item's ability
   * (src/core/registry/abilities.ts `itemAbility`), never a write to the sheet beside the fight. On this phone's fight the
   * hunter's card uses it (`combat.useItem`, a target asked for when it goes to another); on a player's phone it is a
   * `cast` on the hunter's turn. Either way it leaves the bag in the write where the fight takes it (fight-save.ts
   * `itemSpent`; on a player's phone the room's `spent`), so a use the fight refuses costs nothing. Answers whether the
   * use went to the fight.
   * @param {{ at: 'row'; cid: string } | { at: 'gm' }} at
   */
  function useInFight(h, it, at) {
    if (at.at === 'gm') { void throwOnTable(h, it); return true; }
    if (app.api.combat.useItem(h.id, it.id)) return true;
    if (!app.api.combat.isActive()) ui.toast('System', `Use ${it.name} once the fight has started.`, { kind: 'warning' });
    else ui.toast('System', `${it.name} was not in ${h.name}'s bag when the fight began.`, { kind: 'warning' });
    return false;
  }
  /**
   * A consumable whose effects go to another, out of a fight: one leaves the bag and what it does is said for the GM to
   * rule on (app.api.uses), in one write. The user is not touched.
   */
  function useOnOther(h, it, ops) {
    const said = app.api.effects.describeItem(it, ops).join(', '), R = rules();
    const w = app.api.uses.told(h.id, 'item-use', x => spendItem(x, it.id, R), { what: 'item', name: it.name, text: [it.desc, said].filter(Boolean).join(' · '), target: 'other', tell: !!it.tell });
    if (!ui.wrote('System', w, useWords(it.name))) return false;
    ui.toast('System', `${it.name} used.${said ? ` On the target: ${said}.` : ''}${w.sent ? ` ${reportWords(app.api.sync.conn())}` : ''}`);
    return true;
  }
  /**
   * A player's item used in the GM's fight: the `cast` is posted through the turn's hold as a use from the bag (nothing
   * sent while the turn waits on a command), and the item stays in the bag until the GM's fight takes it.
   */
  async function throwOnTable(h, it) {
    const p = await app.api.uses.cast(h.id, itemAbilityId(it.id), undefined, 'bag');
    if (p && p.ok) ui.toast('System', postNews(p, app.api.sync.conn()) === 'sent' ? `${it.name}: sent to the GM.` : `${it.name}: goes to the GM when the room answers.`);
  }
  /** Consumable `it` used by hunter `h` on itself outside a fight: its ops, the item spent and the report, in one write. */
  function useOnSelf(h, it, ops) {
    const R = rules(), rolls = useDice(ops, itemSource(it).tier).map(d => rollSettle(d)), u = useItem(h, it.id, rolls, R);
    if (isRefused(u)) { ui.toast('System', USE_WORDS[u.why](it.name, tooLowOf(it, h, R)), { kind: 'warning' }); return false; }
    const said = u.lines.join(', ');
    const w = app.api.uses.told(h.id, 'item-use', x => { const y = useItem(x, it.id, rolls, R); return isRefused(y) ? y : y.hunter; },
      it.tell ? { what: 'item', name: it.name, text: [it.desc, said].filter(Boolean).join(' · '), target: 'self', tell: true } : null);
    if (!ui.wrote('System', w, useWords(it.name, tooLowOf(it, h, R)))) return false;
    ui.toast('System', `${it.name} used: ${said}.`);
    return true;
  }

  const api = app.api.inventory = {
    itemTemplates: () => builtInItems(rules()),
    shop: () => shopList().map(t => ({ ...t, bonus: { ...t.bonus } })),
    addItem(hid, item) {
      const h = store.hunter(hid), it = parseItem(item); if (!h || !it) return null;
      const into = stackOf(h, it), id = into ? into.id : store.id('i');
      if (!ui.wrote('System', onBag(hid, 'item-add', x => putItem(x, it, id)))) return null;
      const added = store.hunter(hid).items.find(i => i.id === id);
      return added ? { ...added } : null;
    },
    addGold(hid, n) { ui.wrote('System', onBag(hid, 'gold', x => addGold(x, n))); },
    rollLoot: (rank, { boss = false, share = 1 } = {}) => rollLoot(rules(), rank, { boss, share }, lootPool(rules()), cryptoRandom),
    equip(hid, itemId) {
      const h = store.hunter(hid), it = h?.items.find(i => i.id === itemId);
      if (!it || !it.slot) return false;
      const splitId = it.qty > 1 ? store.id('i') : it.id;
      return ui.wrote('System', onBag(hid, 'equip', x => equip(x, itemId, splitId, inFight(hid))), GEAR_WORDS);
    },
    unequip(hid, slot) { ui.wrote('System', onBag(hid, 'unequip', x => unequip(x, slot, inFight(hid))), GEAR_WORDS); },
    use(hid, itemId) {
      const h = store.hunter(hid), it = h ? usable(h, itemId) : null;
      if (!it) return false;
      // an item that revives is never the fight's: a dead hunter's row stays in the fight until it ends (use.ts)
      if (it.revive && app.api.hunter.fightOf({ hid })) { ui.toast('System', USE_WORDS.fight(it.name), { kind: 'warning' }); return false; }
      if (it.revive) return useOnSelf(h, it, itemOps(it, 'use'));
      const ops = itemOps(it, 'use'), at = ops.length ? app.api.hunter.fightOf({ hid }) : null;
      if (at) return useInFight(h, it, at);
      if (it.target === 'other' && ops.length) return useOnOther(h, it, ops);
      return useOnSelf(h, it, ops);
    },
    buy(hid, tpl) {
      const h = store.hunter(hid), c = parseItem(tpl);
      if (!h) return refuse('no-hunter');
      if (!c) return refuse('no-item');
      const into = stackOf(h, c);
      const id = into ? into.id : store.id('i');
      return onBag(hid, 'buy', x => buy(x, c, id, rules()));
    },
    sell(hid, itemId, n = 1) {
      const h = store.hunter(hid), it = h?.items.find(i => i.id === itemId);
      if (!it) return 0;
      const got = sellTotal(it, n, rules());
      return ui.wrote('System', onBag(hid, 'sell', x => sell(x, itemId, n, rules(), inFight(hid))), GEAR_WORDS) ? got : 0;
    },
  };

  // ── UI ──
  ui.css('inventory', `
.inv-gold{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.inv-gold .g{font-family:var(--font-mono);font-size:20px;color:var(--gold)}
.inv-tabs{margin-bottom:10px}
.inv-bar{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px}
.inv-card{border:1px solid var(--line);background:rgba(10,26,46,.55);padding:9px 12px;display:flex;flex-direction:column;gap:6px}
.inv-card .top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.inv-card .i-name{flex:1 1 140px;min-width:0;overflow-wrap:anywhere;font-weight:600}
.inv-card button.i-name{min-height:var(--control-h);border:0;background:none;padding:0;text-align:left;color:inherit;font:inherit;font-weight:600}
.inv-card .meta{font-size:13px;color:var(--cyan-dim);overflow-wrap:anywhere}
.inv-slots{display:flex;flex-direction:column;gap:8px}
.inv-card .acts{display:flex;gap:6px;flex-wrap:wrap}
.inv-card.eq{border-color:var(--line-bright)}
.inv-qty{font-family:var(--font-mono);font-size:13px;color:var(--ice)}
.eq-slot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border:1px solid var(--line);background:rgba(10,26,46,.55);padding:8px 12px}
.eq-slot .sl{flex:0 0 74px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan-dim)}
.eq-slot .nm{flex:1 1 130px;min-width:0;overflow-wrap:anywhere}
.eq-slot .nm.none{color:var(--muted);font-style:italic}
`);

  const chip = r => `<span class="rar rar-${esc(r)}">${esc(r)}</span>`;
  const metaLine = i => [i.type, i.slot ? `slot: ${SLOT_LABEL[i.slot] || i.slot}` : '', i.dice ? `${i.dice}${i.attack ? ` ${i.attack}` : ''}` : '', bonusText(i.bonus),
    weightOf(i) ? `weight ${weightOf(i)}` : '', i.armor ? `armor ${i.armor}` : '', i.resist ? `resist ${i.resist}` : ''].filter(Boolean).map(esc).join(' · ');
  /** An item's name, which opens what it does and its description (app.api.detail) under its line. */
  const nameBtn = (list, key, i) => `<button type="button" class="i-name"${app.api.detail.control(list, key)}>${esc(i.name)}</button>`;
  const itemDetail = (list, key, i) => app.api.detail.panel(list, key, () => ({ kind: 'item', item: i }));

  // Equipment panel
  app.registerPanel({
    view: 'status', id: 'equipment', order: 45, title: 'Gear', jump: 'Gear',
    mount(el) {
      el.innerHTML = '<div class="inv-slots" data-slots></div><p class="empty" data-eqsum></p>';
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-unequip]'); if (b) api.unequip(store.active().id, oneOf(b.dataset.unequip, SLOTS, null));
      });
    },
    update(el) {
      const h = store.active();
      el.querySelector('[data-slots]').innerHTML = rules().slots.map(s => {
        const it = h.items.find(i => i.id === h.equipped[s]);
        return `<div class="eq-slot" data-slot="${esc(s)}"><span class="sl">${esc(SLOT_LABEL[s] || s)}</span>
          ${it ? `<span class="nm">${esc(it.name)}<br><span class="meta note">${metaLine(it)}</span></span>${chip(it.rar)}
            <button type="button" data-unequip="${esc(s)}" aria-label="Unequip ${esc(it.name)}">Unequip</button>` : '<span class="nm none">empty</span>'}</div>`;
      }).join('');
      const { sheet } = app.api.hunter.sheet(h);
      el.querySelector('[data-eqsum]').textContent = `Gear weight ${fmt(sheet.weight)} of ${fmt(sheet.carry)} carry · Armor ${fmt(sheet.armor)} · Resist ${fmt(sheet.resist)}`;
    },
  });

  // Inventory panel (Items | Shop)
  let tab = 'items';
  app.registerPanel({
    view: 'status', id: 'inventory', order: 50, title: 'Bag', jump: 'Bag',
    mount(el) {
      el.innerHTML = `
        <div class="inv-gold"><span class="lbl">Gold</span><span class="g" data-gold>0</span><button type="button" class="gm-only" data-gold-adj hidden>Adjust gold</button></div>
        <div class="inv-tabs seg" role="tablist" aria-label="Bag sections">
          <button type="button" role="tab" data-tab="items" aria-selected="true">Items</button>
          <button type="button" role="tab" data-tab="shop" aria-selected="false">Shop</button>
        </div>
        <div data-pane="items">
          <div class="inv-bar">${ui.field('Filter by type', `<select name="filter"><option value="all">All types</option>${ITEM_TYPES.map(t => `<option value="${t}">${cap(t)}</option>`).join('')}</select>`)}</div>
          <ul class="plain" data-list></ul>
          <form class="add-row" data-form>
            <span class="grow">${ui.field('Item name', '<input type="text" name="name" maxlength="60" placeholder="e.g. Iron Dagger" autocomplete="off">')}</span>
            <span class="md">${ui.field('Rarity', `<select name="rar">${TIERS.map(t => `<option value="${t}">${cap(t)}</option>`).join('')}</select>`)}</span>
            <button type="submit" class="primary">Store</button>
          </form>
        </div>
        <div data-pane="shop" hidden>
          <div class="inv-bar"><button type="button" class="gm-only" data-shop-add hidden>Add shop item</button><button type="button" class="gm-only" data-shop-reset hidden>Reset shop</button></div>
          <p class="empty" role="note" data-shop-closed hidden></p>
          <ul class="plain" data-shoplist></ul>
        </div>
        <div class="inv-bar"><button type="button" data-additem>New item…</button></div>`;
      const $q = s => el.querySelector(s);
      /** The item maker for a held item (`inv`) or a shop item; Save writes it where it came from. */
      const openForm = async (target, item) => {
        const editId = item ? item.id || item.name : null;
        const it = await app.api.loot.item({ initial: item || undefined, library: false });
        if (!it) return;
        if (target === 'shop') ui.wrote('System', shopEdit(shown => writeShopItem(shown, editId, it)));
        else if (editId) { const hid = store.active().id; ui.wrote('System', onBag(hid, 'item-edit', x => editItem(x, editId, it, inFight(hid))), GEAR_WORDS); }
        else api.addItem(store.active().id, it);
      };

      const setTab = t => {
        tab = t;
        el.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
        el.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== t; });
        renderInvBody(el);
      };
      app.api.detail.wire(el, () => renderInvBody(el));
      el.querySelector('[role=tablist]').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
      el.querySelector('[name=filter]').addEventListener('change', () => renderInvBody(el));

      $q('[data-form]').addEventListener('submit', e => {
        e.preventDefault();
        const f = e.target, name = f.name.value.trim(); if (!name) return;
        api.addItem(store.active().id, { name: name.slice(0, 60), rar: f.rar.value });
        f.name.value = '';
      });

      el.addEventListener('click', async e => {
        const b = e.target.closest('button'); if (!b) return;
        const h = store.active(), id = h.id, d = b.dataset;
        if (b.hasAttribute('data-gold-adj')) {
          const n = await ui.promptNum({ title: 'Adjust gold', label: `Add or remove gold (current ${fmt(h.gold)})`, value: 0, min: -1e9, max: 1e9 });
          if (n) api.addGold(id, n);
        } else if (d.use) api.use(id, d.use);
        else if (d.equip) api.equip(id, d.equip);
        else if (d.unequipItem) { const s = SLOTS.find(k => h.equipped[k] === d.unequipItem); if (s) api.unequip(id, s); }
        else if (d.sell) {
          const it = h.items.find(x => x.id === d.sell); if (!it || wearRefused(h, it.id, 'remove')) return;
          let n = 1;
          if (it.qty > 1) { n = await ui.promptNum({ title: `Sell ${it.name}`, label: `Quantity to sell (${fmt(sellPrice(it))} gold each)`, value: 1, min: 1, max: it.qty }); if (!n) return; }
          else if (!(await ui.confirm({ title: 'Sell item?', body: `${it.name} for ${fmt(sellPrice(it))} gold`, confirmLabel: 'Sell' }))) return;
          const got = api.sell(id, it.id, n);
          if (got) ui.toast('System', `Sold ${it.name} for ${fmt(got)} gold.`);
        } else if (d.del) {
          const it = h.items.find(x => x.id === d.del);
          if (!it || wearRefused(h, it.id, 'remove')) return;
          if (await ui.confirm({ title: 'Remove item?', body: it.name, danger: true, confirmLabel: 'Remove' })) ui.wrote('System', onBag(h.id, 'item-del', x => removeItem(x, it.id, inFight(h.id))), GEAR_WORDS);
        } else if (d.editItem) { const it = h.items.find(x => x.id === d.editItem); if (it && !wearRefused(h, it.id, 'edit')) openForm('inv', it); }
        else if (d.buy !== undefined) {
          const tpl = shopList()[Number(d.buy)]; if (!tpl) return;
          const words = Object.fromEntries(BUY_REFUSALS.map(w => [w, BUY_WORDS[w](tpl.name)]));
          if (ui.wrote('System', api.buy(id, tpl), words)) ui.toast('System', `Purchased ${tpl.name}.`);
        } else if (d.shopEdit !== undefined) { const tpl = shopList()[Number(d.shopEdit)]; if (tpl) openForm('shop', tpl); }
        else if (d.shopDel !== undefined) {
          const tpl = shopList()[Number(d.shopDel)];
          if (tpl && await ui.confirm({ title: 'Remove from shop?', body: tpl.name, danger: true, confirmLabel: 'Remove' })) ui.wrote('System', shopEdit(shown => removeShopItem(shown, Number(d.shopDel))));
        } else if (b.hasAttribute('data-shop-add')) openForm('shop', null);
        else if (b.hasAttribute('data-additem')) openForm('inv', null);
        else if (b.hasAttribute('data-shop-reset')) {
          if (await ui.confirm({ title: 'Reset shop?', body: 'Restore the default shop list.', danger: true, confirmLabel: 'Reset' })) ui.wrote('System', store.apply('shop-edit', s => withShop(s, null)));
        }
      });
    },
    update(el) { renderInvBody(el); },
  });
  function renderInvBody(el) {
      const h = store.active(), gm = app.isGM(), open = shopOpen(h);
      el.querySelector('[data-gold]').textContent = fmt(h.gold);
      el.querySelectorAll('.gm-only').forEach(b => { b.hidden = !gm || (b.hasAttribute('data-shop-add') || b.hasAttribute('data-shop-reset') ? tab !== 'shop' : false); });
      const equippedIds = new Set(Object.values(h.equipped).filter(Boolean));
      const filter = el.querySelector('[name=filter]').value;
      if (tab === 'items') {
        const list = h.items.filter(i => filter === 'all' || i.type === filter);
        el.querySelector('[data-list]').innerHTML = list.length ? list.map(i => {
          const eq = equippedIds.has(i.id);
          return `<li class="inv-card${eq ? ' eq' : ''}" data-item="${esc(i.id)}"><div class="top">${nameBtn('inv-items', i.id, i)}${chip(i.rar)}${i.qty > 1 ? `<span class="inv-qty">×${esc(i.qty)}</span>` : ''}${eq ? '<span class="inv-qty">equipped</span>' : ''}</div>
            ${itemDetail('inv-items', i.id, i)}${metaLine(i) ? `<div class="meta">${metaLine(i)}</div>` : ''}
            <div class="acts">
              ${i.type === 'consumable' ? `<button type="button" data-use="${esc(i.id)}" aria-label="Use ${esc(i.name)}">Use</button>` : ''}
              ${i.slot ? (eq ? `<button type="button" data-unequip-item="${esc(i.id)}" aria-label="Unequip ${esc(i.name)}">Unequip</button>` : `<button type="button" data-equip="${esc(i.id)}" aria-label="Equip ${esc(i.name)}">Equip</button>`) : ''}
              <button type="button" data-edit-item="${esc(i.id)}" aria-label="Edit ${esc(i.name)}">Edit</button>
              ${sellable(i) && open ? `<button type="button" data-sell="${esc(i.id)}" aria-label="Sell ${esc(i.name)}">Sell ${fmt(sellPrice(i))}g</button>` : ''}
              <button type="button" class="icon-btn danger" data-del="${esc(i.id)}" aria-label="Remove item ${esc(i.name)}">&times;</button>
            </div></li>`;
        }).join('') : `<li class="empty">${h.items.length ? 'No items of that type.' : 'Inventory is empty.'}</li>`;
      } else {
        const closed = el.querySelector('[data-shop-closed]');
        closed.hidden = open;
        closed.textContent = open ? '' : SHOP_CLOSED;
        el.querySelector('[data-shoplist]').innerHTML = shopList().map((t, n) => {
          const price = valueOf(t, rules()), poor = h.gold < price;
          return `<li class="inv-card" data-shopitem="${esc(t.name)}"><div class="top">${nameBtn('inv-shop', String(n), t)}${chip(t.rar)}<span class="inv-qty">${fmt(price)} g</span></div>
            ${itemDetail('inv-shop', String(n), t)}${metaLine(t) ? `<div class="meta">${metaLine(t)}</div>` : ''}
            <div class="acts">${open ? `<button type="button" data-buy="${n}" aria-label="Buy ${esc(t.name)} for ${esc(price)} gold"${poor ? ' aria-disabled="true"' : ''}>Buy</button>` : ''}
              ${gm ? `<button type="button" data-shop-edit="${n}" aria-label="Edit shop item ${esc(t.name)}">Edit</button><button type="button" class="icon-btn danger" data-shop-del="${n}" aria-label="Remove ${esc(t.name)} from shop">&times;</button>` : ''}</div></li>`;
        }).join('') || '<li class="empty">The shop is empty.</li>';
      }
  }
}
