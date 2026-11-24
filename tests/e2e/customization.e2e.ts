import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, activeHunter, save, roomHeaders, type Page } from './helpers.ts';

const status = '#view-status ';
const win = '.sys-overlay.show';
const VIOLET = '199,155,255', CYAN = '77,216,255';

const cssVar = (p: Page, name: string) => p.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const tapWin = (p: Page, label: string) => p.locator(`${win} .sys-actions button`, { hasText: label }).first().tap();
const toasts = (p: Page) => p.locator('.toast');
const stat = async (p: Page, k: string): Promise<number> => (await activeHunter(p)).derived.stats[k];
const patchHunter = (p: Page, patch: Record<string, unknown>) => p.evaluate(x => hunterApp.store.update((d: any) => { Object.assign(d.hunters[0], x); }, 'test-setup'), patch);
const setRules = (p: Page, o: Record<string, unknown>) => p.evaluate(x => hunterApp.store.update((d: any) => { d.rulesOverrides = x; }, 'test-setup'), o);
/**
 * A running fight on this phone with one goblin in it and, unless `holds` is false, the active hunter's row, as the save
 * holds one (src/core/combat/fight-types.ts). Only a hunter a row holds is in the fight (fight-save.ts `fightHold`).
 */
async function startLocalFight(p: Page, holds = true): Promise<void> {
  await p.evaluate(holds => hunterApp.store.update((d: any) => {
    const h = d.hunters.find((x: any) => x.id === d.settings.activeHunterId) ?? d.hunters[0];
    const blank = { tier: 0, tie: 0, xp: 0, mana: 0, fatigue: 0, statuses: [], abilities: [], readyAt: {}, threat: {}, shield: null, stagger: null, channel: null, intent: null, mythic: null };
    const goblin = { ...blank, id: 'c900', name: 'Goblin', side: 'foe', kind: 'monster', at: 0, place: { x: 0, y: 0 }, holder: null, life: { at: 'up', hp: 7 },
      origin: { kind: 'monster', name: 'Monster', rank: 'E', archetype: 'skirmisher', monsterKind: 'normal', tweak: { hp: 1, stats: {}, traits: [] } } };
    const hunter = { ...blank, id: 'c901', name: h.name, side: 'party', kind: 'hunter', at: 1, place: { x: 1, y: 0 }, holder: { kind: 'local', hunterId: h.id }, life: { at: 'up', hp: 10 },
      origin: { kind: 'hunter', build: { stats: h.stats, level: h.level, gear: [], perks: {} } } };
    d.fight = { id: 'f900', phase: 'running', grid: { w: 16, h: 16, tiles: null }, log: [], banked: 0, now: 0, currentId: 'c900', pending: [], rows: holds ? [goblin, hunter] : [goblin] };
  }, 'test-setup'), holds);
  expect((await save(p)).fight?.phase, 'the save keeps the fight').toBe('running');
}
const endLocalFight = (p: Page) => p.evaluate(() => hunterApp.store.update((d: any) => { d.fight = null; }, 'test-setup'));
/** The free ability points the Attributes panel shows. */
const freePoints = async (p: Page): Promise<number> => { await go(p, 'status'); return Number(await p.locator(`${status}[data-ap]`).innerText()); };

async function openDevice(p: Page): Promise<void> {
  await go(p, 'status');
  await p.locator('#more-btn').tap();
  await p.locator(`${win} .sys-actions button`, { hasText: 'Device' }).first().tap();
  await expect(p.locator('#view-device')).toBeVisible();
}

async function openBuild(p: Page): Promise<void> {
  await go(p, 'status');
  await p.locator(`${status}[data-panel=build]`).scrollIntoViewIfNeeded();
}

test('a player picks an accent and text size on the Device view, keeps them after a reload, and they never travel with a campaign file', async ({ device }) => {
  const page = (await device('phone')).page;
  await onboardPlayer(page, 'Kai Test');
  await dismissAll(page);

  await test.step('Device is two taps from Status and the choices apply at once', async () => {
    await openDevice(page);
    await page.locator('[data-acc=violet]').tap();
    await expect.poll(() => cssVar(page, '--acc-rgb')).toBe(VIOLET);
    await page.locator('[data-seg=text] [data-v="1.3"]').tap();
    await expect.poll(() => cssVar(page, '--ts')).toBe('1.3');
    await expect(page.locator('[data-seg=text] [aria-pressed=true]')).toHaveText('Larger');
  });

  await test.step('the choices are still there after a reload', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.hunterApp && hunterApp.api.identity);
    await expect.poll(() => cssVar(page, '--acc-rgb')).toBe(VIOLET);
    await expect.poll(() => cssVar(page, '--ts')).toBe('1.3');
  });

  await test.step('a campaign file carries no device choice, and importing one on another phone leaves that phone alone', async () => {
    const exported = await page.evaluate(() => JSON.stringify(hunterApp.store.get()));
    expect(exported).not.toMatch(/violet/);
    const other = (await device('other phone')).page;
    await onboardPlayer(other, 'Mira Test');
    await dismissAll(other);
    await other.evaluate(t => { const r = hunterApp.store.read(t); if (!r.ok) throw new Error(r.error); hunterApp.store.importSave(r.save); }, exported);
    await go(other, 'status');
    expect(await cssVar(other, '--acc-rgb')).toBe(CYAN);
    expect(await cssVar(other, '--ts')).toBe('1');
  });
});

test('a phone whose stored device settings are garbage opens with the defaults and no console noise', async ({ device }) => {
  const junk = (await device('junk', { seed: { 'hunter-system-prefs': '{"accent":"<x>","text":9,"motion":3,"haptics":"y","junk":{}}' } })).page;
  await onboardPlayer(junk, 'Kai Test');
  await dismissAll(junk);
  expect(await cssVar(junk, '--acc-rgb')).toBe(CYAN);
  expect(await cssVar(junk, '--ts')).toBe('1');
  await openDevice(junk);
  await expect(junk.locator('[data-seg=text] [aria-pressed=true]')).toHaveText('Normal');
  await expect(junk.locator('[data-seg=motion] [aria-pressed=true]')).toHaveText('Follow device');

  const broken = (await device('broken', { seed: { 'hunter-system-prefs': 'not json{' } })).page;
  await onboardPlayer(broken, 'Mira Test');
  await dismissAll(broken);
  expect(await cssVar(broken, '--acc-rgb')).toBe(CYAN);
});

test('a player picks an emblem and color for the hunter and sees the badge on the sheet and in the party list', async ({ device }) => {
  const page = (await device('phone')).page;
  await onboardPlayer(page, 'Kai Test');
  await dismissAll(page);
  await go(page, 'status');
  await page.locator(`${status}[data-emblem]`).tap();
  await expect(page.locator(`${win} .cz-pick`)).toBeVisible();
  await page.locator(`${win} [data-pe=crown]`).tap();
  await page.locator(`${win} [data-pc="#ffc94d"]`).tap();
  await expect(page.locator(`${win} .cz-prev .hb`)).toHaveAttribute('style', /#ffc94d/);
  await tapWin(page, 'Save');
  await expect(page.locator(`${status}[data-emb] .hb path`)).toHaveCount(1);
  await expect(page.locator(`${status}[data-emb] .hb`)).toHaveAttribute('style', /#ffc94d/);

  await page.evaluate(() => hunterApp.store.update((d: any) => { d.hunters.push({ name: 'Mira', emblem: 'moon', color: '#c79bff', daily: { lastCheckedKey: d.world.lastDailyKey } }); }, 'test-setup'));
  await expect(page.locator(`${status}[data-plist] .hb`)).toHaveCount(2);
});

test('a player saves gear sets, swaps them in one tap, keeps them when the GM lowers the cap, and in a fight no gear changes', async ({ device }) => {
  const page = (await device('phone')).page;
  await onboardPlayer(page, 'Kai Test');
  await dismissAll(page);
  const hid = await page.evaluate(() => hunterApp.store.active().id as string);
  const gear = await page.evaluate(id => {
    const add = (it: any) => hunterApp.api.inventory.addItem(id, { rar: 'common', qty: 1, ...it }).id as string;
    const ids = {
      sword: add({ name: 'Iron Sword', type: 'weapon', slot: 'weapon', attack: 'strike', dice: '1d8', weight: 2, bonus: { str: 1 } }),
      shield: add({ name: 'Oak Shield', type: 'armor', slot: 'offhand', weight: 2, armor: 3, resist: 1 }),
      mail: add({ name: 'Chain Mail', type: 'armor', slot: 'chest', weight: 6, armor: 6, resist: 2 }),
      spear: add({ name: 'Long Spear', type: 'weapon', slot: 'weapon', attack: 'strike', dice: '1d10', weight: 2, bonus: { str: 2 } }),
      robe: add({ name: 'Silk Robe', type: 'armor', slot: 'chest', weight: 1, resist: 3, bonus: { pow: 1 } }),
    };
    for (const k of ['sword', 'shield', 'mail'] as const) hunterApp.api.inventory.equip(id, ids[k]);
    return ids;
  }, hid);
  const base = await activeHunter(page);
  // Worn armor adds its armor to the sheet's (design 2.3): the shield's 3 and the mail's 6.
  const strBare = base.derived.stats.str - 1, armorBare = base.derived.armor - 9, powBare = base.derived.stats.pow;
  const panel = `${status}[data-panel=loadouts]`;
  const chip = (name: string) => page.locator(`${panel} [data-loswap]`, { hasText: name });
  const equipped = async () => (await activeHunter(page)).equipped;

  await test.step('Save current gear names a set, and a second set is saved after changing gear', async () => {
    await go(page, 'status');
    await page.locator(`${panel} [data-losave]`).scrollIntoViewIfNeeded();
    await page.locator(`${panel} [data-losave]`).tap();
    await page.locator(`${win} input`).fill('Duelist');
    await tapWin(page, 'Confirm');
    await expect(chip('Duelist')).toBeVisible();
    await page.evaluate(([id, g]) => { const I = hunterApp.api.inventory; I.equip(id, g.spear); I.equip(id, g.robe); I.unequip(id, 'offhand'); }, [hid, gear] as const);
    await page.locator(`${panel} [data-losave]`).tap();
    await page.locator(`${win} input`).fill('Caster');
    await tapWin(page, 'Confirm');
    await expect(chip('Caster')).toBeVisible();
    await expect(chip('Caster')).toHaveAttribute('aria-pressed', 'true');
  });

  await test.step('one tap on a set swaps all of its gear and the sheet numbers follow', async () => {
    await chip('Duelist').tap();
    await expect(chip('Duelist')).toHaveAttribute('aria-pressed', 'true');
    expect(await equipped()).toMatchObject({ weapon: gear.sword, offhand: gear.shield, chest: gear.mail });
    expect(await stat(page, 'str')).toBe(strBare + 1);
    expect((await activeHunter(page)).derived.armor).toBe(armorBare + 9);
    await chip('Caster').tap();
    expect((await equipped()).weapon).toBe(gear.spear);
    expect((await equipped()).offhand).toBeNull();
    expect(await stat(page, 'str')).toBe(strBare + 2);
    expect(await stat(page, 'pow')).toBe(powBare + 1);
    expect((await activeHunter(page)).derived.armor).toBe(armorBare);
  });

  await test.step('a set can be renamed from its manage window', async () => {
    await page.locator(`${panel} [data-lomore]`).first().tap();
    await tapWin(page, 'Rename');
    await page.locator(`${win} input`).fill('Tank');
    await tapWin(page, 'Confirm');
    await expect(chip('Tank')).toBeVisible();
  });

  await test.step('a GM rule that lowers the cap keeps every saved set and only blocks new ones', async () => {
    await setRules(page, { loadoutCap: 2 });
    await expect(page.locator(`${panel} [data-losave]`)).toBeDisabled();
    await expect(page.locator(`${panel} [data-losave]`)).toContainText('Loadouts full (2)');
    await setRules(page, { loadoutCap: 1 });
    await expect(page.locator(`${panel} [data-loswap]`)).toHaveCount(2);
    await chip('Tank').tap();
    expect((await equipped()).weapon).toBe(gear.sword);
    await setRules(page, {});
    await expect(page.locator(`${panel} [data-losave]`)).toBeEnabled();
  });

  await test.step('a set holding an item that can no longer be worn skips it and says which one', async () => {
    await page.evaluate(([id, g]) => hunterApp.store.update((d: any) => { d.hunters.find((x: any) => x.id === id).items.find((i: any) => i.id === g.spear).slot = null; }, 'test-setup'), [hid, gear] as const);
    await page.evaluate(([id, g]) => { hunterApp.api.inventory.equip(id, g.sword); hunterApp.api.inventory.equip(id, g.robe); }, [hid, gear] as const);
    await chip('Caster').tap();
    await expect(toasts(page).filter({ hasText: 'No longer in the bag: Long Spear' })).toHaveCount(1);
    expect((await equipped()).weapon).toBe(gear.sword);
  });

  await test.step('during a fight a set does not swap and Unequip changes nothing, because the fight keeps the sheet it started with', async () => {
    await page.evaluate(([id, g]) => hunterApp.store.update((d: any) => {
      const x = d.hunters.find((h: any) => h.id === id);
      x.items.find((i: any) => i.id === g.spear).slot = 'weapon'; x.equipped.weapon = g.spear; x.equipped.chest = g.robe;
    }, 'test-setup'), [hid, gear] as const);
    await startLocalFight(page);
    await go(page, 'status');
    await page.locator(`${panel} [data-lofight]`).scrollIntoViewIfNeeded();
    await expect(page.locator(`${panel} [data-lofight]`)).toHaveText('You cannot change gear during a fight.');
    await chip('Tank').tap();
    await expect(toasts(page).filter({ hasText: 'You cannot change gear during a fight.' })).toHaveCount(1);
    expect(await equipped()).toMatchObject({ weapon: gear.spear, chest: gear.robe });
    await page.locator(`${status}[data-panel=equipment] [data-unequip="weapon"]`).tap();
    await expect(toasts(page).filter({ hasText: 'Gear cannot change during a fight.' })).toHaveCount(1);
    expect((await equipped()).weapon).toBe(gear.spear);
    await endLocalFight(page);
    // a fight on this phone that holds no row of this hunter leaves its gear free (V10 CU1: it was refused)
    await startLocalFight(page, false);
    await expect(page.locator(`${panel} [data-lofight]`)).toBeHidden();
    await chip('Caster').tap();
    await expect.poll(async () => (await equipped()).weapon).toBe(gear.spear);
    await endLocalFight(page);
    await chip('Tank').tap();
    await expect.poll(async () => (await equipped()).weapon).toBe(gear.sword);
  });
});

test('a player has no Build panel and uses Auto-allocate with a stat-focus picker before Job Change', async ({ device }) => {
  const page = (await device('phone')).page;
  await onboardPlayer(page, 'Kai Test');
  await dismissAll(page);
  await go(page, 'status');

  await test.step('players see no Build panel or Build jump chip, and Auto-allocate shows when points are free', async () => {
    await expect(page.locator(`${status}[data-panel=build]`)).toBeHidden();
    await expect(page.locator(`${status}[data-jump=build]`)).toHaveCount(0);
    await expect(page.locator(`${status}[data-auto-alloc]`)).toBeVisible();
  });

  await test.step('the picker lets a player pick a job preset or custom stats, previews the split, and remembers focus across reloads', async () => {
    const str0 = await stat(page, 'str'), vit0 = await stat(page, 'vit');
    const agi0 = await stat(page, 'agi'), ins0 = await stat(page, 'ins');
    await page.locator(`${status}[data-auto-alloc]`).tap();
    await expect(page.locator(`${win} .af-pick`)).toBeVisible();

    // Tap Fighter preset -> Strength + Vitality (2:1)
    await page.locator(`${win} [data-af-job="Fighter"]`).tap();
    await expect(page.locator(`${win} [data-af-main]`)).toHaveValue('str');
    await expect(page.locator(`${win} [data-af-second]`)).toHaveValue('vit');
    await expect(page.locator(`${win} [data-af-match]`)).toHaveText('Matches Fighter focus.');
    await expect(page.locator(`${win} [data-af-pv]`)).toContainText(`Strength (STR)`);
    await expect(page.locator(`${win} [data-af-pv]`)).toContainText(`Vitality (VIT)`);

    // Switch to Agility + Instinct -> matches Assassin focus, then place 12 creation points (8 AGI, 4 INS)
    await page.locator(`${win} [data-af-main]`).selectOption('agi');
    await page.locator(`${win} [data-af-second]`).selectOption('ins');
    await expect(page.locator(`${win} [data-af-match]`)).toHaveText('Matches Assassin focus.');
    await tapWin(page, 'Place ability points');

    await expect.poll(() => freePoints(page)).toBe(0);
    expect(await stat(page, 'agi')).toBe(agi0 + 8);
    expect(await stat(page, 'ins')).toBe(ins0 + 4);
    expect(await stat(page, 'str')).toBe(str0);
    expect(await stat(page, 'vit')).toBe(vit0);

    // Points stay undoable until confirmed
    await page.locator(`${status}.stat[data-k=agi] [data-dir="-1"]`).tap();
    await expect.poll(() => freePoints(page)).toBe(1);
    await page.locator(`${status}[data-confirm]`).tap();

    // Reload and reopen Auto-allocate: remembers Agility + Instinct
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.hunterApp && hunterApp.api.hunter);
    await go(page, 'status');
    await page.locator(`${status}[data-auto-alloc]`).tap();
    await expect(page.locator(`${win} [data-af-main]`)).toHaveValue('agi');
    await expect(page.locator(`${win} [data-af-second]`)).toHaveValue('ins');
    await tapWin(page, 'Cancel');
  });

  await test.step('a hunter with a built-in job gets their job focus pre-selected in Auto-allocate', async () => {
    await patchHunter(page, { job: 'Necromancer', bonusPoints: 3 });
    await go(page, 'status');
    const pre0 = await stat(page, 'pre'), pow0 = await stat(page, 'pow');
    await page.locator(`${status}[data-auto-alloc]`).tap();
    await expect(page.locator(`${win} [data-af-main]`)).toHaveValue('pre');
    await expect(page.locator(`${win} [data-af-second]`)).toHaveValue('pow');
    await expect(page.locator(`${win} [data-af-job="Necromancer"]`)).toHaveAttribute('aria-pressed', 'true');
    await tapWin(page, 'Place ability points');
    await expect.poll(() => stat(page, 'pre')).toBe(pre0 + 3);
    expect(await stat(page, 'pow')).toBe(pow0 + 1);
  });
});

test('a GM room rule switch reaches players without writing their overrides, and GM cards have no Build menu', async ({ device }) => {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Kai Test', code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);

  await test.step('the GM party board shows no path label or Build button', async () => {
    await go(gm, 'gm');
    const card = gm.locator('#gm-board .gm-card.remote', { hasText: 'Kai Test' });
    await expect(card).toHaveCount(1);
    await expect(card.locator('[data-hbuild]')).toHaveCount(0);
    await expect(card.locator('[data-gmpath]')).toHaveCount(0);
  });

  const roomKeystone = async () => (await (await gm.request.get(`/api/rooms/${code}?after=999999999`, { headers: await roomHeaders(gm) })).json()).docs?.rules?.data?.keystone?.on ?? null;
  const own = { logCap: 50 };
  await setRules(player, own);

  await test.step('the GM turns Keystones on in the room, the player sees them, and leaving restores the player\'s own rules', async () => {
    await openBuild(gm);
    await gm.locator(`${status}[data-kstoggle]`).tap();
    await expect.poll(roomKeystone).toBe(true);
    await go(player, 'status');
    await expect(player.locator(`${status}[data-panel=keystones]`)).toBeVisible();
    expect((await save(player)).rulesOverrides).toEqual(own);

    await go(player, 'room');
    await player.locator('#view-room [data-leave]').tap();
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBeNull();
    await go(player, 'status');
    await expect(player.locator(`${status}[data-panel=keystones]`)).toBeHidden();
    expect((await save(player)).rulesOverrides).toEqual(own);
  });
});

test('alone, a player switches to GM mode and back from the header pill, adds a hunter from the picker and switches back to the first', async ({ device }) => {
  const page = (await device('phone')).page;
  await onboardPlayer(page, 'Kai Test');
  await dismissAll(page);
  const first = (await activeHunter(page)).id;

  await test.step('GM mode and back', async () => {
    await page.locator('#mode-pill').tap();
    await tapWin(page, 'Enter GM mode');
    await expect(page.locator('#mode-pill')).toHaveText('GM');
    expect((await save(page)).settings.mode).toBe('gm');
    await page.locator('#mode-pill').tap();
    await tapWin(page, 'Enter Player mode');
    await expect(page.locator('#mode-pill')).toHaveText('PLAYER');
    expect((await save(page)).settings.mode).toBe('player');
  });

  await test.step('a new hunter is added and shown; picking the first shows it again', async () => {
    await page.locator('#hunter-sel').selectOption('__new');
    await page.locator(`${win} input`).fill('Second Hunter');
    await tapWin(page, 'Confirm');
    await expect.poll(async () => (await activeHunter(page)).name).toBe('Second Hunter');
    expect((await save(page)).hunters.map((h: { name: string }) => h.name)).toContain('Kai Test');
    await page.locator('#hunter-sel').selectOption(first);
    await expect.poll(async () => (await activeHunter(page)).id).toBe(first);
  });
});

test('10 gear slots allow 6 active at once, show Swap on occupied slots, and lock Off hand under a two-handed weapon', async ({ device }) => {
  const page = (await device('phone')).page;
  await onboardPlayer(page, 'Kai Gear');
  await dismissAll(page);
  const hid = await page.evaluate(() => hunterApp.store.active().id as string);
  const ids = await page.evaluate(id => {
    const add = (it: any) => hunterApp.api.inventory.addItem(id, { rar: 'rare', qty: 1, ...it }).id as string;
    const out = {
      bow: add({ name: 'Frost Longbow', type: 'weapon', slot: 'weapon', attack: 'shot', dice: '1d8', twoHanded: true, bonus: { agi: 2 } }),
      helm: add({ name: 'Steel Helm', type: 'armor', slot: 'head', armor: 4 }),
      armor: add({ name: 'Shadow Plate', type: 'armor', slot: 'chest', armor: 10 }),
      neck: add({ name: 'Mana Charm', type: 'accessory', slot: 'neck', bonus: { manaMax: 2 } }),
      pants: add({ name: 'Wind Greaves', type: 'armor', slot: 'legs', armor: 4 }),
      orb: add({ name: 'Avarice Orb', type: 'accessory', slot: 'orb', bonus: { pow: 3 } }),
      boots: add({ name: 'Swift Boots', type: 'armor', slot: 'feet', armor: 2 }),
      crown: add({ name: 'Iron Crown', type: 'armor', slot: 'head', armor: 5 }),
    };
    for (const k of ['bow', 'helm', 'armor', 'neck', 'pants', 'orb'] as const) hunterApp.api.inventory.equip(id, out[k]);
    return out;
  }, hid);

  await go(page, 'status');
  const eq = page.locator(`${status}[data-panel=equipment]`);
  await eq.scrollIntoViewIfNeeded();
  await expect(eq.locator('[data-eqcap]')).toHaveText('Equipped: 6 of 6');
  await expect(eq.locator('[data-slot]')).toHaveCount(10);
  await expect(eq.locator('[data-slot="offhand"]')).toContainText('Held by Frost Longbow (2H)');
  await expect(eq.locator('[data-slot="feet"]')).toContainText('Full (6 of 6)');

  // 7th empty slot is refused with plain words
  const inv = page.locator(`${status}[data-panel=inventory]`);
  const equipBoots = inv.locator(`[data-equip="${ids.boots}"]`);
  await equipBoots.scrollIntoViewIfNeeded();
  await expect(equipBoots).toHaveText('Equip');
  await equipBoots.tap();
  await expect(toasts(page).filter({ hasText: 'You are already wearing 6 of 6 items. Unequip an item first.' })).toHaveCount(1);

  // Occupied slot shows Swap and replaces cleanly at 6 of 6
  const swapCrown = inv.locator(`[data-equip="${ids.crown}"]`);
  await expect(swapCrown).toHaveText('Swap');
  await swapCrown.tap();
  await expect.poll(async () => (await activeHunter(page)).equipped.head).toBe(ids.crown);

  // Tapping Unequip on the locked Off hand row unequips the two-handed weapon
  const offUnequip = eq.locator('[data-slot="offhand"] [data-unequip="weapon"]');
  await offUnequip.scrollIntoViewIfNeeded();
  await offUnequip.tap();
  await expect(eq.locator('[data-eqcap]')).toHaveText('Equipped: 5 of 6');
  await expect.poll(async () => (await activeHunter(page)).equipped.weapon).toBeNull();
});
