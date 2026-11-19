import type { Locator, Page } from '@playwright/test';
import { test, expect, PHONE, type Device, type DeviceOptions, SMALL_PHONE, onboardGM, onboardPlayer, createRoom, dismissAll, go, gmRoomHeaders, fightRow, chooseList } from './helpers.ts';

const HUNTER = 'Kai Test', MONSTER = 'Cave Rat';

const combat = (page: Page) => page.locator('#view-combat');
const gmRound = (gm: Page) => combat(gm).locator('.cmb-head').first();
const gmRow = (gm: Page, name: string) => combat(gm).locator('.cmb-row', { hasText: name });
const gmCard = (gm: Page) => combat(gm).locator('.cmb-card');
const gmLog = (gm: Page) => combat(gm).locator('[data-log] li');
const sheetHp = (player: Page) => player.locator('#view-status [data-bar="hp"] [data-cur]');
const sheetChip = (player: Page, label: string) => player.locator('#view-status [data-chips] [data-chip]', { hasText: label });
const banner = (player: Page) => player.locator('#view-status .tb-banner');
const hudRow = (player: Page, name: string) => combat(player).locator('.tb-row', { hasText: name });

async function tapCombat(page: Page, selector: string) {
  const target = combat(page).locator(selector).first();
  await target.evaluate((el: any) => el.scrollIntoView({ block: 'center' }));
  await target.tap();
}

const numberIn = async (target: Locator) => Number(((await target.innerText()).match(/\d+/) ?? ['NaN'])[0]);

/** Whose turn the GM's round header names. */
async function gmCurrentName(gm: Page) {
  return (await gmRound(gm).locator('small').first().innerText()).replace(/^Turn:\s*/i, '').trim();
}

async function gmTurnMarker(gm: Page) {
  return (await gmRound(gm).innerText()).replace(/\s+/g, ' ').trim();
}

async function nextTurn(gm: Page) {
  const before = await gmTurnMarker(gm);
  await tapCombat(gm, '[data-next]');
  await expect.poll(() => gmTurnMarker(gm)).not.toBe(before);
}

/** The GM selects a combatant in the turn order so its card shows. */
async function gmSelect(gm: Page, name: string) {
  const row = gmRow(gm, name).first();
  await row.locator('[data-pick]').evaluate((el: any) => el.scrollIntoView({ block: 'center' }));
  await row.locator('[data-pick]').tap();
  await expect(gmCard(gm).locator('h3')).toContainText(name);
}

/**
 * The GM opens the Status window on the selected combatant and taps a built-in status: on for 3 rounds at the target's
 * rank, or until removed.
 */
async function gmApplyStatus(gm: Page, key: string, untilRemoved = false) {
  await tapCombat(gm, '.cmb-card [data-cforge]');
  const dialog = gm.locator('.fg-overlay');
  if (untilRemoved) await dialog.locator('[data-inf]').tap();
  await dialog.locator(`[data-existing] [data-chip="${key}"]`).tap();
  await expect(dialog).toHaveCount(0);
}

/** Close the System windows a player phone raised, once the named one has shown. */
/** A notice a player only has to read: a toast, with nothing over the screen (A4). */
async function playerIsTold(player: Page, text: string | RegExp) {
  await expect(player.locator('#toasts .toast', { hasText: text }).first()).toBeVisible();
  await expect(player.locator('.sys-overlay.show')).toHaveCount(0);
}

test('a GM runs a fight with a status on a player\'s hunter and both phones show the same HP and conditions', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page, player = (await device('player', { viewport: SMALL_PHONE })).page;
  const poisonLine = gmLog(gm).filter({ hasText: new RegExp(`^R\\d+: ${HUNTER}: Poisoned settles\\.$`) });
  const kaiHp = async () => (await fightRow(gm, HUNTER)).hp as number;
  let startHp = 0;

  await test.step('the GM creates a room and the player joins with the code', async () => {
    await onboardGM(gm);
    await chooseList(gm);
    const code = await createRoom(gm);
    await onboardPlayer(player, HUNTER, code);
    await chooseList(player);
    await dismissAll(player, 4);
    await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
    await go(player, 'status');
    await expect(sheetHp(player)).toHaveText(/^\d+$/);
    startHp = await numberIn(sheetHp(player));
    expect(startHp).toBeGreaterThan(8);
  });

  await test.step('the GM builds an encounter with the player\'s hunter and two monsters', async () => {
    await go(gm, 'combat');
    const pick = combat(gm).locator('[data-hsel]');
    await expect(pick.locator('option', { hasText: `${HUNTER} (remote)` })).toHaveCount(1);
    await pick.selectOption({ label: `${HUNTER} (remote)` });
    await tapCombat(gm, '[data-addh]');
    await expect(gmRow(gm, HUNTER)).toHaveCount(1);
    await combat(gm).locator('[data-qline]').fill(`${MONSTER} x2, E, brute`);
    await tapCombat(gm, '[data-qadd]');
    await expect(gmRow(gm, MONSTER)).toHaveCount(2);
    await expect(gmRow(gm, HUNTER)).toContainText(`${startHp}/`);
  });

  await test.step('the GM poisons the hunter and the Poisoned chip shows on the player\'s sheet', async () => {
    await gmSelect(gm, HUNTER);
    await gmApplyStatus(gm, 'poisoned');
    await expect(gmCard(gm).locator('.cmb-conds')).toContainText('Poisoned');
    await playerIsTold(player, /^! Status\s*Poisoned:/);
    await expect(sheetChip(player, 'Poisoned')).toContainText('Poisoned');
    await gmApplyStatus(gm, 'slowed', true);
    await playerIsTold(player, /^! Status\s*Slowed:/);
    await expect(sheetChip(player, 'Slowed')).toContainText('Slowed');
    await expect(sheetHp(player)).toHaveText(String(startHp));
  });

  await test.step('the GM puts Bleeding on a monster', async () => {
    await gmSelect(gm, `${MONSTER} A`);
    await gmApplyStatus(gm, 'bleeding');
    await expect(gmCard(gm).locator('.cmb-conds')).toContainText('Bleeding');
    await expect(gmRow(gm, `${MONSTER} A`)).toContainText('Bleeding');
  });

  await test.step('the GM starts the fight and the player\'s phone shows the fight and whose turn it is', async () => {
    await tapCombat(gm, '[data-start]');
    await expect(gmRound(gm)).toContainText('Round 1');
    const current = await gmCurrentName(gm);
    await expect(banner(player)).toContainText(current === HUNTER ? '▶ Your turn · Round 1' : `In a fight · Round 1 · ${current}'s turn`);
    await go(player, 'combat');
    await expect(combat(player).locator('.tb-round')).toHaveText('ROUND 1');
    await expect(combat(player).locator('.tb-row')).toHaveCount(3);
    await expect(combat(player).locator('.tb-row.cur .tb-name')).toContainText(current);
    await expect(hudRow(player, HUNTER).locator('.tb-you')).toHaveText('YOU');
    await expect(hudRow(player, `${MONSTER} A`).locator('.tb-conds')).toContainText('Bleeding');
    await go(player, 'status');
  });

  await test.step('the hunter\'s turn starts after a round, poison settles, and both phones show the same HP', async () => {
    // Poisoned is paid at its bearer's turn start for the share of a round since it was last paid (design 1.3).
    // Slowed, the hunter waits 1.25 rounds between turns, so its first turn after round 1 is in round 2 or 3 by its opening.
    const gmRoundNo = async () => numberIn(gmRound(gm));
    while (await gmRoundNo() < 2 || await gmCurrentName(gm) !== HUNTER) await nextTurn(gm);
    await playerIsTold(player, `Your turn. Round ${await gmRoundNo()}.`);
    await expect(banner(player)).toContainText('Your turn');
    await go(player, 'combat');
    await expect(combat(player).locator('.tb-mine')).toHaveText(/YOUR TURN/);
    await expect(player.locator('.sys-overlay.show')).toHaveCount(0);
    await go(player, 'status');
    await expect(poisonLine.first()).toBeVisible();
    const hp = await kaiHp();
    expect(hp).toBeLessThan(startHp);
    await gmSelect(gm, HUNTER);
    await expect(gmCard(gm).locator('.bar-nums').first()).toHaveText(new RegExp(`^${hp} / \\d+$`));
    await expect(gmRow(gm, HUNTER).locator('.cmb-mini')).toContainText(`${hp}/`);
    await expect(sheetHp(player)).toHaveText(String(hp));
    await go(player, 'combat');
    await expect(hudRow(player, HUNTER)).toHaveClass(/\bcur\b/);
    await expect(hudRow(player, HUNTER).locator('.tb-band')).toContainText(`${hp}/`);
    await expect(hudRow(player, HUNTER).locator('.tb-conds')).toContainText('Poisoned');
    await go(player, 'status');
  });

  await test.step('the GM removes Poisoned and the chip leaves the player\'s sheet', async () => {
    const remove = gmCard(gm).locator('.cmb-conds').getByRole('button', { name: 'Remove Poisoned' });
    await remove.evaluate((el: any) => el.scrollIntoView({ block: 'center' }));
    await remove.tap();
    await expect(gmCard(gm).locator('.cmb-conds')).not.toContainText('Poisoned');
    await expect(sheetChip(player, 'Poisoned')).toHaveCount(0);
    await expect(sheetChip(player, 'Slowed')).toHaveCount(1);
  });

  await test.step('after another round both phones agree on the hunter\'s HP and conditions', async () => {
    const hp = await kaiHp();
    // every row waits more than a round between turns (Slowed, a brute's speed), so a round can pass with no turn in it
    while (await numberIn(gmRound(gm)) < 3) await nextTurn(gm);
    const round = await numberIn(gmRound(gm));
    expect(await kaiHp()).toBe(hp);
    await gmSelect(gm, HUNTER);
    await expect(gmCard(gm).locator('.bar-nums').first()).toHaveText(new RegExp(`^${hp} / \\d+$`));
    await expect(gmCard(gm).locator('.cmb-conds .c-info')).toHaveText([/^Slowed/]);
    await expect(sheetHp(player)).toHaveText(String(hp));
    await expect(player.locator('#view-status [data-chips] [data-chip]')).toHaveText([/^Slowed/]);
    await expect(banner(player)).toContainText(`Round ${round}`);
    await go(player, 'combat');
    await expect(combat(player).locator('.tb-round')).toHaveText(`ROUND ${round}`);
    await expect(hudRow(player, HUNTER).locator('.tb-band')).toContainText(`${hp}/`);
    await expect(hudRow(player, HUNTER).locator('.tb-conds')).toHaveText('Slowed');
    await go(player, 'status');
    await dismissAll(player, 4);
  });

  await test.step('the GM ends the encounter and the fight leaves the player\'s phone', async () => {
    const hp = await kaiHp();
    await tapCombat(gm, '[data-end]');
    await expect(gm.locator('.sys-overlay.show .sys-window').first()).toContainText('Fight over');
    await gm.locator('.sys-overlay.show .sys-actions button', { hasText: 'End without XP' }).tap();
    await expect(gmRound(gm)).toContainText('No fight');
    await expect(banner(player)).toHaveCount(0);
    await expect(sheetHp(player)).toHaveText(String(hp));
    await expect(sheetChip(player, 'Slowed')).toHaveCount(1);
    await go(player, 'combat');
    await expect(combat(player).locator('.tb-row')).toHaveCount(0);
    await expect(combat(player).locator('[data-idle]')).toHaveText('The GM is not running a fight.');
  });
});

test('a GM\'s HP change to a player\'s hunter in a fight stays on the GM\'s card through a sheet the player pushed before it arrived', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page, player = (await device('player', { viewport: SMALL_PHONE, blockServiceWorker: true })).page;
  let code = '', startHp = 0, release = () => {}, held = false;
  const sheetOnServer = async () => {
    const room = await (await gm.request.get(`/api/rooms/${code}?after=0`, { headers: await gmRoomHeaders(gm, code) })).json();
    return Object.values(room.sheets as Record<string, any>).map(s => s.data.hunter)[0];
  };
  const gmSees = () => gm.evaluate(() => hunterApp.api.sync.remoteSheets()[0]?.data);

  await test.step('the GM builds a fight with the player\'s hunter', async () => {
    await onboardGM(gm);
    await chooseList(gm);
    code = await createRoom(gm);
    await onboardPlayer(player, HUNTER, code);
    await chooseList(player);
    await dismissAll(player, 4);
    await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
    await go(player, 'status');
    await expect(sheetHp(player)).toHaveText(/^\d+$/);
    startHp = await numberIn(sheetHp(player));
    expect(startHp).toBeGreaterThan(5);
    await go(gm, 'combat');
    const pick = combat(gm).locator('[data-hsel]');
    await expect(pick.locator('option', { hasText: `${HUNTER} (remote)` })).toHaveCount(1);
    await pick.selectOption({ label: `${HUNTER} (remote)` });
    await tapCombat(gm, '[data-addh]');
    await expect(gmRow(gm, HUNTER)).toContainText(`${startHp}/`);
    await gmSelect(gm, HUNTER);
  });

  await test.step('while the player\'s phone cannot read the room, the GM deals 5 damage and the player\'s phone pushes its sheet without it', async () => {
    const wait = new Promise<void>(r => { release = r; });
    await player.route(u => u.pathname === `/api/rooms/${code}`, async route => { held = true; await wait; await route.continue().catch(() => {}); });
    await expect.poll(() => held).toBe(true);
    await tapCombat(gm, '.cmb-card [data-q="-5"]');
    await expect(gmCard(gm).locator('.bar-nums').first()).toHaveText(new RegExp(`^${startHp - 5} / \\d+$`));
    await player.evaluate(() => hunterApp.store.update((d: any) => { d.hunters.find((h: any) => h.name === 'Kai Test').gold = 77; }, 'test-setup'));
    await expect.poll(async () => (await sheetOnServer())?.gold).toBe(77);
    expect((await sheetOnServer()).life).toEqual({ at: 'up', hp: startHp });
    await expect.poll(async () => (await gmSees())?.gold).toBe(77);
    await expect(gmCard(gm).locator('.bar-nums').first()).toHaveText(new RegExp(`^${startHp - 5} / \\d+$`));
    await expect(gmRow(gm, HUNTER)).toContainText(`${startHp - 5}/`);
  });

  await test.step('the player\'s phone reads the room again and shows the damage, and its next sheet agrees with the GM\'s card', async () => {
    release();
    await player.unrouteAll({ behavior: 'wait' });
    await expect(sheetHp(player)).toHaveText(String(startHp - 5));
    await expect.poll(async () => (await gmSees())?.life).toEqual({ at: 'up', hp: startHp - 5 });
    await expect(gmCard(gm).locator('.bar-nums').first()).toHaveText(new RegExp(`^${startHp - 5} / \\d+$`));
  });
});

test('a status the GM puts on a remote hunter in a fight shows the same scaled numbers on the player\'s phone as on the GM\'s card', async ({ device }) => {
  const gm = (await device('gm', { viewport: PHONE })).page, player = (await device('player', { viewport: SMALL_PHONE })).page;
  // Burning deals 1d6, 2d6, 3d8, 4d10, 5d12, 7d12 magical damage a round by rank E to S (statuses.ts): 4d10 at B.
  const atB = '4d10 magical damage a round';

  await test.step('the GM opens a room, the player joins, and the fight has the player\'s hunter and a monster', async () => {
    await onboardGM(gm);
    await chooseList(gm);
    const code = await createRoom(gm);
    await onboardPlayer(player, HUNTER, code);
    await chooseList(player);
    await dismissAll(player, 4);
    await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
    await go(gm, 'combat');
    await combat(gm).locator('[data-hsel]').selectOption({ label: `${HUNTER} (remote)` });
    await tapCombat(gm, '[data-addh]');
    await combat(gm).locator('[data-qline]').fill(`${MONSTER}, B, brute`);
    await tapCombat(gm, '[data-qadd]');
    await expect(gmRow(gm, MONSTER)).toHaveCount(1);
    await go(player, 'status');
  });

  await test.step('the GM puts Burning at strength B on the hunter, and the card says what it does at B', async () => {
    await gmSelect(gm, HUNTER);
    await tapCombat(gm, '.cmb-card [data-cforge]');
    const dialog = gm.locator('.fg-overlay');
    await dialog.locator('[data-chips="strength"] [data-chip="B"]').tap();
    await dialog.locator('[data-existing] [data-chip="burning"]').tap();
    await expect(dialog).toHaveCount(0);
    await gmCard(gm).locator('[data-chip="burning"] [data-dt-key]').tap();
    await expect(gmCard(gm).locator('.cmb-conds .dt')).toContainText(atB);
  });

  await test.step('the player\'s phone shows the same 4d10 in its toast and on the Burning chip', async () => {
    await playerIsTold(player, new RegExp(`^! Status\\s*Burning: ${atB}`));
    await sheetChip(player, 'Burning').locator('[data-dt-key]').tap();
    await expect(player.locator('#view-status [data-chips] .dt')).toContainText(atB);
  });
});

/** A GM phone in a fight with one monster, its Status dialog open. */
async function gmStatusDialog(device: (label: string, options?: DeviceOptions) => Promise<Device>) {
  const gm = (await device('gm', { viewport: PHONE })).page;
  await onboardGM(gm);
  await chooseList(gm);
  await go(gm, 'combat');
  await combat(gm).locator('[data-qline]').fill(`${MONSTER}, E, brute`);
  await tapCombat(gm, '[data-qadd]');
  await gmSelect(gm, MONSTER);
  await tapCombat(gm, '.cmb-card [data-cforge]');
  await expect(gm.locator('.fg-overlay .fg-win')).toBeVisible();
  return gm;
}
const customStatusKeys = (gm: Page) => gm.evaluate(() => Object.keys(hunterApp.store.get().library.statuses));

test('on a phone one tap on a built-in status in the Status dialog applies it, and the card says what it does', async ({ device }) => {
  const gm = await gmStatusDialog(device);
  const chip = gm.locator('.fg-overlay [data-existing] [data-chip="poisoned"]');
  await chip.scrollIntoViewIfNeeded();
  await expect(gmCard(gm).locator('.cmb-conds')).not.toContainText('Poisoned');
  await chip.tap();
  await expect(gm.locator('.fg-overlay')).toHaveCount(0);
  await expect(gmCard(gm).locator('.cmb-conds')).toContainText('Poisoned');
  // Poisoned at an E-rank target's strength (statuses.ts): 1d4 magical damage a round, Control −8
  await gmCard(gm).locator('[data-chip="poisoned"] [data-dt-key]').tap();
  await expect(gmCard(gm).locator('.cmb-conds .dt')).toContainText('1d4 magical damage a round');
  await expect(gmCard(gm).locator('.cmb-conds .dt')).toContainText('Control −8');
});

test('typing the name of a built-in status with no effects applies that status, not a copy', async ({ device }) => {
  const gm = await gmStatusDialog(device);
  await gm.locator('.fg-overlay [data-name]').fill('  poisoned ');
  await gm.locator('.fg-overlay [data-apply]').tap();
  await expect(gm.locator('.fg-overlay')).toHaveCount(0);
  await expect(gmCard(gm).locator('.cmb-conds')).toContainText('Poisoned');
  expect(await customStatusKeys(gm)).toEqual([]);
  expect(await gm.evaluate(() => hunterApp.store.get().fight.rows.find((c: any) => c.kind === 'monster').statuses.map((c: any) => c.key))).toEqual(['poisoned']);
});

test('typing the name of a built-in status with an effect chosen makes a new status', async ({ device }) => {
  const gm = await gmStatusDialog(device);
  await gm.locator('.fg-overlay [data-name]').fill('Poisoned');
  await gm.locator('.fg-overlay [data-q="d6"]').tap();
  await gm.locator('.fg-overlay [data-apply]').tap();
  await expect(gm.locator('.fg-overlay')).toHaveCount(0);
  await expect(gmCard(gm).locator('.cmb-conds')).toContainText('Poisoned');
  expect(await customStatusKeys(gm)).toEqual(['poisoned-2']);
});

