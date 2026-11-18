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
    const blank = { tier: 0, tie: 0, xp: 0, mana: 0, fatigue: 0, statuses: [], abilities: [], readyAt: {}, threat: {}, shield: null, stagger: null, channel: null, intent: null };
    const goblin = { ...blank, id: 'c900', name: 'Goblin', side: 'foe', kind: 'monster', at: 0, place: { x: 0, y: 0 }, holder: null, hp: 7,
      origin: { kind: 'monster', name: 'Monster', rank: 'E', archetype: 'skirmisher', monsterKind: 'normal', tweak: { hp: 1, stats: {} } } };
    const hunter = { ...blank, id: 'c901', name: h.name, side: 'party', kind: 'hunter', at: 1, place: { x: 1, y: 0 }, holder: { kind: 'local', hunterId: h.id }, hp: 10,
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

  await page.evaluate(() => hunterApp.store.update((d: any) => { const n = hunterApp.store.newHunter('Mira'); n.emblem = 'moon'; n.color = '#c79bff'; d.hunters.push(n); }, 'test-setup'));
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
    await expect(page.locator(`${panel} [data-losave]`)).toContainText('Full (2)');
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
    await expect(page.locator(`${panel} [data-lofight]`)).toHaveText('Gear cannot change during a fight.');
    await chip('Tank').tap();
    await expect(toasts(page).filter({ hasText: 'Gear cannot change during a fight.' })).toHaveCount(1);
    expect(await equipped()).toMatchObject({ weapon: gear.spear, chest: gear.robe });
    await page.locator(`${status}[data-panel=equipment] [data-unequip="weapon"]`).tap();
    await expect(toasts(page).filter({ hasText: 'Gear cannot change during a fight.' })).toHaveCount(2);
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

test('a player chooses a path and perks, sees the stat change, finds locked ranks locked, and pays gold to respec', async ({ device }) => {
  const page = (await device('phone')).page;
  await onboardPlayer(page, 'Kai Test');
  await dismissAll(page);
  // Level 22 holds the 12 creation points and 21 x 3 = 63 more, 75; with 72 spent, 3 are free.
  await patchHunter(page, { level: 22, peakLevel: 22, spent: 72, rank: 'C', gold: 5000 });
  const level = 22, cost = 5 * level * level;
  const str0 = await stat(page, 'str');
  const tier = (i: number, c: number) => page.locator(`${status}[data-bdtier="${i}"][data-bdc="${c}"]`);

  await test.step('a path is chosen from its preview window and grants nothing until a perk is taken', async () => {
    await openBuild(page);
    await page.locator(`${status}[data-bdpath=vanguard]`).tap();
    await tapWin(page, 'Choose path');
    await expect(tier(0, 0)).toBeEnabled();
    expect(await stat(page, 'str')).toBe(str0);
  });

  await test.step('the perk window shows before and after, and taking it adds the number to the sheet', async () => {
    await tier(0, 0).tap();
    await expect(page.locator(`${win} .bd-pv`)).toContainText('→');
    await tapWin(page, 'Take perk');
    await expect(tier(0, 0)).toHaveAttribute('aria-pressed', 'true');
    expect(await stat(page, 'str')).toBe(str0 + 2);
  });

  await test.step('rank C opens three ranks and the rank B perks stay locked', async () => {
    const vit0 = await stat(page, 'vit');
    await tier(1, 1).tap();
    await tapWin(page, 'Take perk');
    await tier(2, 0).tap();
    await tapWin(page, 'Take perk');
    await expect(page.locator(`${status}.bd-head`)).toContainText('3/6 perks');
    expect(await stat(page, 'str')).toBe(str0 + 5);
    expect(await stat(page, 'vit')).toBe(vit0 + 2);
    await expect(tier(3, 0)).toBeDisabled();
    await expect(tier(3, 1)).toBeDisabled();
  });

  // Vanguard weighs Strength 2 and Vitality 1; each point goes to the stat with the fewest placed for its weight, a tie
  // to the first stat: Strength, Vitality, Strength.
  await test.step('Auto-place spends the free points by the path weights', async () => {
    const before = await activeHunter(page);
    await page.locator(`${status}[data-bdauto]`).tap();
    await tapWin(page, 'Place points');
    await expect.poll(() => freePoints(page)).toBe(0);
    const after = await activeHunter(page);
    expect(after.derived.stats.str).toBe(before.derived.stats.str + 2);
    expect(after.derived.stats.vit).toBe(before.derived.stats.vit + 1);
  });

  await test.step('respec states its price and is refused when gold is short', async () => {
    await expect(page.locator(`${status}[data-bdbuy]`)).toContainText(`${cost.toLocaleString('en-US')}`);
    await patchHunter(page, { gold: cost - 1 });
    await page.locator(`${status}[data-bdbuy]`).tap();
    await expect(toasts(page).filter({ hasText: `You have ${(cost - 1).toLocaleString('en-US')}` })).toHaveCount(1);
    await expect(page.locator(win)).toHaveCount(0);
    expect((await activeHunter(page)).gold).toBe(cost - 1);
    expect((await activeHunter(page)).build.path).toBe('vanguard');
  });

  await test.step('respec is refused during a fight', async () => {
    await patchHunter(page, { gold: 5000 });
    await startLocalFight(page);
    await page.locator(`${status}[data-bdbuy]`).tap();
    await expect(toasts(page).filter({ hasText: /fight/ })).toHaveCount(1);
    expect((await activeHunter(page)).gold).toBe(5000);
    await endLocalFight(page);
  });

  await test.step('paying clears the path and perks, keeps stats and points, and takes the gold', async () => {
    const before = await activeHunter(page), points = await freePoints(page);
    await page.locator(`${status}[data-bdbuy]`).tap();
    await expect(page.locator(win)).toContainText(`${cost.toLocaleString('en-US')} gold`);
    expect((await activeHunter(page)).gold).toBe(5000);
    await tapWin(page, 'Pay');
    await expect(page.locator(`${status}[data-bdpath=vanguard]`)).toBeVisible();
    const after = await activeHunter(page);
    expect(after.gold).toBe(5000 - cost);
    expect(after.stats).toEqual(before.stats);
    expect(await freePoints(page)).toBe(points);
    expect(after.derived.stats.str, 'the stat as placed, confirmed or pending, without the perks').toBe(before.stats.str + (before.pending.str ?? 0));
  });

  await test.step('a GM rule can retune the respec price or hand perk choices to the GM', async () => {
    await page.evaluate(id => hunterApp.api.build.setPath(id, 'vanguard'), await page.evaluate(() => hunterApp.store.active().id as string));
    await setRules(page, { build: { respecGold: 1 } });
    await expect(page.locator(`${status}[data-bdbuy]`)).toContainText('484');
    await setRules(page, { build: { playerPick: false } });
    await expect(page.locator(`${status}[data-bdbuy]`)).toHaveCount(0);
    await expect(tier(0, 0)).toBeDisabled();
    await expect(page.locator(`${status}[data-panel=build]`)).toContainText('The GM picks perks');
  });
});

test('a GM on their own hunter switches builds off and on, retunes a path, and respecs for free', async ({ device }) => {
  const gm = (await device('gm')).page;
  await onboardGM(gm);
  // Level 22 holds the 12 creation points and 21 x 3 = 63 more, 75, all spent.
  await patchHunter(gm, { level: 22, peakLevel: 22, spent: 75, rank: 'C', gold: 0 });
  const hid = await gm.evaluate(() => hunterApp.store.active().id as string);
  await gm.evaluate(id => { const B = hunterApp.api.build; B.setPath(id, 'vanguard'); B.pick(id, 0, 0); B.pick(id, 1, 1); B.pick(id, 2, 0); }, hid);
  const str0 = (await activeHunter(gm)).stats.str;
  await openBuild(gm);

  await test.step('turning builds off removes the bonus and the chooser, and turning them on brings both back', async () => {
    expect(await stat(gm, 'str')).toBe(str0 + 5);
    await gm.locator(`${status}[data-bdtoggle]`).tap();
    await expect(gm.locator(`${status}.bd-off`)).toBeVisible();
    await expect.poll(() => stat(gm, 'str')).toBe(str0);
    await gm.locator(`${status}[data-bdtoggle]`).tap();
    await expect(gm.locator(`${status}.bd-off`)).toHaveCount(0);
    await expect.poll(() => stat(gm, 'str')).toBe(str0 + 5);
    await expect(gm.locator(`${status}.bd-head`)).toContainText('3/6 perks');
  });

  await test.step('Players pick: no shows the GM-picks note, and Reset build rules restores it', async () => {
    await gm.locator(`${status}[data-bdpp]`).tap();
    await expect(gm.locator(`${status}[data-bdpp]`)).toContainText('Players pick: no');
    await gm.locator(`${status}[data-bdreset]`).tap();
    await expect(gm.locator(`${status}[data-bdpp]`)).toContainText('Players pick: yes');
  });

  await test.step('a GM path override renames the path and changes the number on the sheet, and Reset build rules drops it', async () => {
    await setRules(gm, { paths: { vanguard: { name: 'Bulwark', tiers: [[{ str: 4 }, { hpMax: 20 }], [{ str: 1, vit: 1 }, { vit: 2 }], [{ str: 3 }, { hpMax: 30 }]] } } });
    await expect(gm.locator(`${status}.bd-head`)).toContainText('Bulwark');
    expect(await stat(gm, 'str')).toBe(str0 + 7);
    await gm.locator(`${status}[data-bdreset]`).tap();
    await expect(gm.locator(`${status}.bd-head`)).toContainText('Vanguard');
    expect(await stat(gm, 'str')).toBe(str0 + 5);
  });

  await test.step('the GM respec costs no gold even in a fight, and ability points are not refunded', async () => {
    await startLocalFight(gm);
    await gm.locator(`${status}[data-bdrespec]`).tap();
    await tapWin(gm, 'Respec');
    await expect(gm.locator(`${status}[data-bdpath=vanguard]`)).toBeVisible();
    const after = await activeHunter(gm);
    expect(after.gold).toBe(0);
    expect(await freePoints(gm)).toBe(0);
    expect(after.derived.stats.str).toBe(str0);
    await endLocalFight(gm);
  });
});

test('a GM sets a path and picks a perk for a player from the party board and the player sheet changes', async ({ device }) => {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Kai Test', code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await go(gm, 'gm');
  const card = gm.locator('#gm-board .gm-card.remote', { hasText: 'Kai Test' });
  await expect(card).toHaveCount(1);
  const str0 = await stat(player, 'str');

  await test.step('the GM assigns a path through the Build menu and the player and the card both show it', async () => {
    await card.locator('[data-hbuild]').tap();
    await tapWin(gm, 'Set path: Vanguard');
    await expect.poll(async () => (await activeHunter(player)).build.path).toBe('vanguard');
    await openBuild(player);
    await expect(player.locator(`${status}.bd-head`)).toContainText('Vanguard');
    await expect(card.locator('[data-gmpath]')).toHaveText('Vanguard 0/6');
  });

  await test.step('with players not allowed to pick, the GM picks the first perk and the player gains the number', async () => {
    await gm.evaluate(() => hunterApp.api.build.setRule({ playerPick: false }));
    await expect(player.locator(`${status}[data-panel=build]`)).toContainText('The GM picks perks');
    await card.locator('[data-hbuild]').tap();
    await gm.locator(`${win} .sys-actions button`, { hasText: /^Rank E:/ }).first().tap();
    await expect.poll(() => stat(player, 'str')).toBe(str0 + 2);
    await expect(player.locator(`${status}.bd-head`)).toContainText('1/6 perks');
    await expect(card.locator('[data-gmpath]')).toHaveText('Vanguard 1/6');
  });

  await test.step('a GM respec empties the path on the player sheet', async () => {
    await card.locator('[data-hbuild]').tap();
    await tapWin(gm, 'Respec');
    await expect.poll(async () => (await activeHunter(player)).build.path).toBeNull();
  });
});

test('build switches a GM sets reach the room, a player plays by them while their own stay as they were, and leaving the room gives the player their own back', async ({ device }) => {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await onboardPlayer(player, 'Kai Test', code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  const roomBuild = async () => (await (await gm.request.get(`/api/rooms/${code}?after=999999999`, { headers: await roomHeaders(gm) })).json()).docs?.rules?.data?.build ?? null;
  const own = { build: { playerPick: false } };
  await setRules(player, own);

  await test.step('a room made with default rules lists builds on and player picks on', async () => {
    await expect.poll(roomBuild).toMatchObject({ enabled: true, playerPick: true });
  });

  await test.step('in the room the player may choose a path, though on their own the GM picks', async () => {
    await openBuild(player);
    await expect(player.locator(`${status}[data-bdpath=vanguard]`)).toBeEnabled();
  });

  await test.step("the GM turns builds off and the player is told the GM turned them off; the player's own switches are not written", async () => {
    await openBuild(gm);
    await gm.locator(`${status}[data-bdtoggle]`).tap();
    await expect.poll(roomBuild).toMatchObject({ enabled: false });
    await openBuild(player);
    await expect(player.locator(`${status}.bd-off`)).toBeVisible();
    expect((await save(player)).rulesOverrides).toEqual(own);
  });

  await test.step('after leaving the room the player has their own switches back, and the GM keeps their own switch after leaving', async () => {
    await go(player, 'room');
    await player.locator('#view-room [data-leave]').tap();
    await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBeNull();
    await openBuild(player);
    await expect(player.locator(`${status}.bd-off`)).toHaveCount(0);
    await expect(player.locator(`${status}[data-bdpath=vanguard]`)).toBeDisabled();
    expect((await save(player)).rulesOverrides).toEqual(own);

    await go(gm, 'room');
    await gm.locator('#view-room [data-leave]').tap();
    await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.room())).toBeNull();
    await openBuild(gm);
    await expect(gm.locator(`${status}[data-bdtoggle]`)).toContainText('Builds: off');
    expect((await save(gm)).rulesOverrides.build.enabled).toBe(false);
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
