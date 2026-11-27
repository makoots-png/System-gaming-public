import type { Page } from '@playwright/test';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, openApp, activeHunter, noonDate, ROOM_CODE } from './helpers.ts';
import { ABOUT, LOADED, ROOM_IS, ROOM_PATH, TIPS, WORLD_PRIMER } from '../../src/core/first-run.ts';
import { PREGENS, STARTER_GATE, STARTER_STORY_NAME, STARTER_UNSPENT_HUNTER } from '../../src/core/starter.ts';
import { TAKEOVER_WORDS } from '../../src/core/store-life.ts';
import { freshSave } from '../../src/core/save.ts';
import { parseDeviceId } from '../../src/core/ids.ts';

const SAVE_KEY = 'hunter-system-v5';
const OB = '.ob-overlay';
const NO_ROOM = /no room/i;

/** A new install's save as a newer app wrote it: this app opens it read-only, and setup has not run. */
function newerFreshSave(): string {
  const env = { now: noonDate(), newDeviceId: () => parseDeviceId('d-e2e-readonly')!, newDeviceToken: () => 'test-device-token-0123456789abcd' };
  return JSON.stringify({ ...freshSave(env, { onboarded: false }), schema: 99 });
}

const rawSave = (page: Page) => page.evaluate((k: string) => localStorage.getItem(k), SAVE_KEY);

async function gmWithRoom(device: (label: string) => Promise<{ page: Page }>): Promise<{ gm: Page; code: string }> {
  const gm = (await device('gm')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  return { gm, code };
}

async function openInvite(page: Page, code: string): Promise<void> {
  await openApp(page, `/?room=${code}`);
  await expect(page.locator(`${OB} [data-roomchip]`)).toHaveText(code);
}

async function toPlayerStep(page: Page): Promise<void> {
  await page.locator(`${OB} [data-yes]`).tap();
  await page.locator(`${OB} [data-player]`).tap();
}

/** The setup window titled `title`, once it is on screen. */
async function windowTitled(page: Page, title: string) {
  const win = page.locator(OB, { has: page.locator('h2', { hasText: title }) });
  await expect(win).toBeVisible();
  return win;
}

/** The next steps a window lists, each as its words and whether it is marked done. */
const nextOf = (page: Page): Promise<{ text: string; done: boolean }[]> => page.locator(`${OB} [data-obnext] li`).evaluateAll(lis => lis.map(li => ({ text: (li.lastElementChild?.textContent ?? '').trim(), done: li.hasAttribute('data-done') })));

test('opening an invite link shows a one-field join window and joins the room with the typed name', async ({ device }) => {
  const { gm, code } = await gmWithRoom(device);
  const phone = (await device('phone')).page;

  await test.step('the window shows the code, finds the room and has no welcome question', async () => {
    await openInvite(phone, code);
    await expect(phone.locator(`${OB} [data-yes]`)).toHaveCount(0);
    await expect(phone.locator(`${OB} [data-check]`)).toContainText(/found/i);
  });

  await test.step('joining with a name shows Hunter created, and Open my sheet lands on the status tab with that one hunter', async () => {
    await phone.locator(`${OB} [data-name]`).fill('Mira Vale');
    await phone.locator(`${OB} [data-go]`).tap();
    const win = await windowTitled(phone, 'Hunter created');
    await expect(win.locator('[data-obnext] [data-k=join] > span:last-child')).toHaveText(`Done: In room ${code}.`);
    await win.locator('[data-obsheet]').tap();
    await expect(phone.locator(OB)).toHaveCount(0);
    await expect(phone).toHaveURL(/#\/status$/);
    await expect(phone.locator('#view-status')).toBeVisible();
    expect((await activeHunter(phone)).name).toBe('Mira Vale');
    expect(await phone.evaluate(() => hunterApp.store.get().hunters.length)).toBe(1);
  });

  await test.step('the GM party board shows the player', async () => {
    await go(gm, 'gm');
    await expect(gm.locator('#gm-board .gm-card.remote', { hasText: 'Mira Vale' })).toHaveCount(1);
  });
});

test('an invite link to a room that does not exist says so, keeps the name, and lets the player go on without a room', async ({ device }) => {
  const phone = (await device('phone')).page;
  await openApp(phone, '/?room=ZZZZ99');
  const before = await rawSave(phone);

  await test.step('the window says there is no such room and Join shows the error', async () => {
    await expect(phone.locator(`${OB} [data-check]`)).toHaveText(NO_ROOM);
    await phone.locator(`${OB} [data-name]`).fill('Nobody');
    await phone.locator(`${OB} [data-go]`).tap();
    await expect(phone.locator(`${OB} [data-err]`)).toHaveText(NO_ROOM);
    await expect(phone.locator(`${OB} [data-name]`)).toHaveValue('Nobody');
    await expect(phone.locator(`${OB} [data-go]`)).toHaveText('Try again');
    await expect(phone.locator(`${OB} [data-obmore]`)).toHaveText('Continue without a room');
    expect(await rawSave(phone)).toBe(before);
  });

  await test.step('continuing without a room reaches the welcome window and a solo hunter can be made', async () => {
    await phone.locator(`${OB} [data-obmore]`).tap();
    await phone.locator(`${OB} [data-yes]`).tap();
    await phone.locator(`${OB} [data-player]`).tap();
    await expect(phone.locator(`${OB} [data-room]`)).toHaveValue('');
    await phone.locator(`${OB} [data-name]`).fill('Solo');
    await phone.locator(`${OB} [data-go]`).tap();
    await (await windowTitled(phone, 'Hunter created')).locator('[data-obsheet]').tap();
    await expect(phone.locator(OB)).toHaveCount(0);
    expect((await activeHunter(phone)).name).toBe('Solo');
  });
});

test('typing or pasting a room code while naming a hunter finds the room and joins it', async ({ device }) => {
  const { gm, code } = await gmWithRoom(device);
  const phone = (await device('phone')).page;

  await openApp(phone);
  await toPlayerStep(phone);
  const field = phone.locator(`${OB} [data-room]`);

  await test.step('a pasted invite link leaves only the code and the window says the room was found', async () => {
    await phone.locator(`${OB} [data-name]`).fill('Typed Code');
    await field.fill(`Join here: http://localhost:3217/?room=${code.toLowerCase()} thanks`);
    await expect(field).toHaveValue(code);
    await expect(phone.locator(`${OB} [data-check]`)).toContainText(/found/i);
  });

  await test.step('Begin joins the room behind Hunter created and the GM board shows the hunter', async () => {
    await phone.locator(`${OB} [data-go]`).tap();
    await windowTitled(phone, 'Hunter created');
    await expect(phone.locator('#view-room')).toBeHidden();
    await go(gm, 'gm');
    await expect(gm.locator('#gm-board .gm-card.remote', { hasText: 'Typed Code' })).toHaveCount(1);
  });
});

test('a wrong room code during onboarding shows an error and saves nothing, and clearing the field finishes without a room', async ({ device }) => {
  const phone = (await device('phone')).page;
  await openApp(phone);
  await toPlayerStep(phone);
  await phone.locator(`${OB} [data-name]`).fill('Wrong');
  const before = await rawSave(phone);

  await test.step('the error shows, the window stays and the save is untouched', async () => {
    await phone.locator(`${OB} [data-room]`).fill('ZZZZ99');
    await phone.locator(`${OB} [data-go]`).tap();
    await expect(phone.locator(`${OB} [data-err]`)).toContainText(NO_ROOM);
    await expect(phone.locator(`${OB} [data-room]`)).toBeFocused();
    expect(await rawSave(phone)).toBe(before);
  });

  await test.step('an empty room field begins with the typed name and no room', async () => {
    await phone.locator(`${OB} [data-room]`).fill('');
    await phone.locator(`${OB} [data-go]`).tap();
    await windowTitled(phone, 'Hunter created');
    expect((await activeHunter(phone)).name).toBe('Wrong');
  });
});

test('backing out of an invite through other options leaves the player outside the room', async ({ device }) => {
  const { gm, code } = await gmWithRoom(device);
  const phone = (await device('phone')).page;

  await test.step('other options leads to the welcome window and the player step offers the invited code', async () => {
    await openInvite(phone, code);
    await phone.locator(`${OB} [data-obmore]`).tap();
    await toPlayerStep(phone);
    await expect(phone.locator(`${OB} [data-room]`)).toHaveValue(code);
  });

  await test.step('Back returns to the role question and the invite is still mentioned', async () => {
    await phone.locator(`${OB} [data-back]`).tap();
    await expect(phone.locator(`${OB} .ob-invite`)).toContainText(code);
    await phone.locator(`${OB} [data-player]`).tap();
  });

  await test.step('clearing the code and beginning keeps the hunter out of the GM board', async () => {
    await phone.locator(`${OB} [data-name]`).fill('Outsider');
    await phone.locator(`${OB} [data-room]`).fill('');
    await phone.locator(`${OB} [data-go]`).tap();
    await (await windowTitled(phone, 'Hunter created')).locator('[data-obsheet]').tap();
    await expect(phone.locator(OB)).toHaveCount(0);
    expect((await activeHunter(phone)).name).toBe('Outsider');
    await go(gm, 'gm');
    await expect(gm.locator('#gm-board .gm-card.remote')).toHaveCount(0);
    await expect(gm.locator('[data-gmroomcode]')).toHaveText(ROOM_CODE);
  });
});

test('a GM who left a room can open it again from the GM tab and the players are still there', async ({ device }) => {
  const { gm, code } = await gmWithRoom(device);
  const player = (await device('player')).page;
  const card = gm.locator('#gm-board .gm-card.remote', { hasText: 'Pia Strip' });

  await test.step('a player joins and shows on the GM board', async () => {
    await onboardPlayer(player, 'Pia Strip', code);
    await dismissAll(player, 4);
    await go(gm, 'gm');
    await expect(card).toHaveCount(1);
  });

  await test.step('after leaving, the GM tab offers to open the same room as GM, not to make a new one first', async () => {
    await gm.evaluate(() => hunterApp.api.sync.leave());
    const reopen = gm.locator('#gm-room [data-gmrejoin]');
    await expect(reopen).toContainText(code);
    await expect(reopen).toHaveClass(/primary/);
    await expect(gm.locator('#gm-room [data-gmcreate]')).toHaveText('New room');
  });

  await test.step('opening it shows the same code and the player card again', async () => {
    await gm.locator('#gm-room [data-gmrejoin]').tap();
    await expect(gm.locator('#gm-room [data-gmroomcode]')).toHaveText(code);
    await expect(card).toHaveCount(1);
  });
});

test('the Welcome window shows first-gate copy and what the site is below the window, without scrolling on a small phone', async ({ device }) => {
  const phone = (await device('phone', { viewport: { width: 360, height: 640 } })).page;
  await openApp(phone);
  const win = await windowTitled(phone, 'Window active');
  await expect(win).toContainText('Every person has had a System window since the night the first gate opened. Choose whether you are a player or the GM for this table.');
  await expect(win.locator('[data-yes]')).toHaveText('Set up');
  await expect(win.locator('[data-skip]')).toHaveText('Skip setup');
  await expect(win.locator('[data-no]')).toHaveCount(0);
  const about = phone.locator(`${OB} .ob-about`);
  await expect(about).toHaveText(ABOUT);
  await expect(win.locator('[role=dialog]')).toHaveAttribute('aria-describedby', (await about.getAttribute('id')) ?? 'none');
  const dialog = await win.locator('[role=dialog]').boundingBox(), line = await about.boundingBox();
  expect(dialog && line && line.y >= dialog.y + dialog.height).toBe(true);
  expect(line && line.y + line.height <= 640).toBe(true);
  expect(await phone.locator(OB).evaluate(o => o.scrollHeight <= o.clientHeight)).toBe(true);
  expect(await about.evaluate(p => parseFloat(getComputedStyle(p).fontSize))).toBeGreaterThanOrEqual(12);

  await test.step('only the Welcome step shows it', async () => {
    await phone.locator(`${OB} [data-yes]`).tap();
    await windowTitled(phone, 'Who are you?');
    await expect(phone.locator(`${OB} .ob-about`)).toHaveCount(0);
  });
});

test('a new player who names a hunter sees Hunter created with two next steps, and Open my sheet lands on Status', async ({ device }) => {
  const phone = (await device('phone')).page;
  await openApp(phone);
  await toPlayerStep(phone);
  await expect(phone.locator(`${OB} label`, { hasText: 'Room code from your GM (optional)' })).toBeVisible();
  await expect(phone.locator(`${OB} .ob-help`)).toHaveText('No code yet? Begin without one and join later with the room button at the top.');
  await phone.locator(`${OB} [data-name]`).fill('Nova Reed');
  await phone.locator(`${OB} [data-go]`).tap();

  const win = await windowTitled(phone, 'Hunter created');
  await expect(win).toContainText('Your hunter Nova Reed is ready.');
  const steps = await nextOf(phone);
  expect(steps.map(s => s.done)).toEqual([false, false]);
  expect(steps[0]!.text).toMatch(/^Spend your \d+ ability points?\. On the Status tab, tap \+ on a stat, then tap Confirm allocation\.$/);
  expect(steps.slice(1).map(s => s.text)).toEqual(['Join your GM\'s room. Ask the GM for the room code or an invite link.']);
  await expect(win.locator('[data-objoin]')).toBeVisible();

  await win.locator('[data-obsheet]').tap();
  await expect(phone.locator(OB)).toHaveCount(0);
  await expect(phone).toHaveURL(/#\/status$/);
  expect(await phone.evaluate(() => hunterApp.store.get().settings.onboarded)).toBe(true);
});

test('a player who typed the GM\'s room code sees the join step done with the code, and no Join a room button', async ({ device }) => {
  const { code } = await gmWithRoom(device);
  const phone = (await device('phone')).page;
  await openApp(phone);
  await toPlayerStep(phone);
  await phone.locator(`${OB} [data-name]`).fill('Coded');
  await phone.locator(`${OB} [data-room]`).fill(code);
  await expect(phone.locator(`${OB} [data-check]`)).toContainText(/found/i);
  await phone.locator(`${OB} [data-go]`).tap();

  const win = await windowTitled(phone, 'Hunter created');
  await expect(win.locator('[data-obnext] [data-k=join] > span:last-child')).toHaveText(`Done: In room ${code}.`);
  await expect(win.locator('[data-obnext] [data-k=join]')).toHaveAttribute('data-done', '');
  await expect(win.locator('[data-objoin]')).toBeHidden();
});

test('a new GM sees Campaign ready, taps Create room and lands on the room\'s invite with its code, QR code and link', async ({ device }) => {
  const gm = (await device('gm')).page;
  await openApp(gm);
  for (const b of ['[data-yes]', '[data-gm]', '[data-starter]']) await gm.locator(`${OB} ${b}`).tap();

  const win = await windowTitled(gm, 'Campaign ready');
  await expect(win).toContainText(LOADED.starter.split('\n')[0]!);
  await expect(win).toContainText(STARTER_STORY_NAME);
  await expect(win).toContainText(STARTER_UNSPENT_HUNTER);
  await expect(win).toContainText('Read aloud: World primer');
  await expect(win).toContainText('Start a story');
  await expect(win).toContainText(ROOM_IS);
  expect(await nextOf(gm)).toEqual([
    { text: 'Create a room.', done: false },
    { text: 'Invite your players. Share the room code, link, or QR code.', done: false },
  ]);
  await win.locator('[data-obcreate]').tap();

  await expect(gm.locator(OB)).toHaveCount(0);
  await expect(gm).toHaveURL(/#\/room$/);
  await expect(gm.locator('#view-room [data-roomcode]')).toHaveText(ROOM_CODE);
  await expect(gm.locator('#view-room [data-qr]')).toBeVisible();
  const code = (await gm.evaluate(() => hunterApp.api.sync.room())) as string;
  await expect(gm.locator('#view-room [data-link]')).toContainText(`room=${code}`);
});

test('the ? guide lists this role\'s next steps and tips only: a player\'s, then a GM\'s', async ({ device }) => {
  const player = (await device('player')).page, gm = (await device('gm')).page;

  await test.step('a player reads what the site is, the player\'s next steps and no GM tip', async () => {
    await onboardPlayer(player, 'Guide Reader');
    await player.locator('#help-btn').tap();
    const win = await windowTitled(player, 'How it works');
    await expect(win).toContainText(ABOUT);
    expect((await nextOf(player)).map(s => s.text.replace(/^Done: /, '').split('.')[0])).toEqual([expect.stringMatching(/^Spend your \d+ ability points?$/), 'Join your GM\'s room']);
    for (const t of TIPS.player) await expect(win).toContainText(t);
    for (const t of TIPS.gm) await expect(win).not.toContainText(t);
  });

  await test.step('a GM reads the GM\'s next steps and no player tip', async () => {
    await onboardGM(gm);
    await gm.locator('#help-btn').tap();
    const win = await windowTitled(gm, 'How it works');
    await expect(win).toContainText(ABOUT);
    expect((await nextOf(gm)).map(s => s.text)).toEqual(['Create a room.', 'Invite your players. Share the room code, link, or QR code.']);
    for (const t of TIPS.gm) await expect(win).toContainText(t);
    for (const t of TIPS.player) await expect(win).not.toContainText(t);
  });
});

test('a player who did not join taps Join a room and lands on the Room page, which says what a room is and offers Join first', async ({ device }) => {
  const phone = (await device('phone')).page;
  await openApp(phone);
  await toPlayerStep(phone);
  await phone.locator(`${OB} [data-name]`).fill('Late Joiner');
  await phone.locator(`${OB} [data-go]`).tap();
  await (await windowTitled(phone, 'Hunter created')).locator('[data-objoin]').tap();

  await expect(phone.locator(OB)).toHaveCount(0);
  await expect(phone).toHaveURL(/#\/room$/);
  const lobby = phone.locator('#view-room [data-lobby]');
  await expect(lobby.locator('[data-roomis]')).toHaveText(ROOM_IS);
  const first = lobby.locator('section:visible').first();
  await expect(first.locator('h2')).toHaveText('Join a room');
  await expect(first).toContainText(ROOM_PATH.player);
  const create = lobby.locator('[data-s=create]');
  await expect(create.locator('h2')).toHaveText('Create a room');
  await expect(create).toContainText('Only the GM creates a room. Creating one sets this device as the GM.');
  await expect(create.locator('[data-create]')).toHaveText('Create room as GM');
});

test('the button at the top says Join room on a player\'s phone and Create room on a GM\'s, and the Data page has no room panel', async ({ device }) => {
  const player = (await device('player')).page, gm = (await device('gm')).page;
  await onboardPlayer(player, 'Pill Reader');
  await onboardGM(gm);
  const pill = (page: Page) => page.locator('#sync-pill [data-roompill]');
  await expect(pill(player)).toHaveText('Join room');
  await expect(pill(player)).toHaveAttribute('aria-label', 'Join a room');
  await expect(pill(gm)).toHaveText('Create room');
  await expect(pill(gm)).toHaveAttribute('aria-label', 'Create a room');

  await test.step('the GM\'s button leads to the Room page, whose first section creates a room', async () => {
    await pill(gm).tap();
    await expect(gm).toHaveURL(/#\/room$/);
    const first = gm.locator('#view-room [data-lobby] section:visible').first();
    await expect(first.locator('h2')).toHaveText('Create a room');
    await expect(first).toContainText(ROOM_PATH.gm);
  });

  await test.step('the Data page has no room panel', async () => {
    for (const page of [player, gm]) {
      await go(page, 'data');
      await expect(page.locator('#view-data')).toBeVisible();
      await expect(page.locator('#view-data [data-panel="sync"]')).toHaveCount(0);
      await expect(page.locator('#view-data')).not.toContainText('Campaign Room');
    }
  });
});

test('in a tab that cannot save, opening an invite link shows the blocking takeover screen instead of onboarding and keeps storage untouched', async ({ device }) => {
  const { code } = await gmWithRoom(device);
  const seeded = newerFreshSave();
  const phone = (await device('phone', { seed: { [SAVE_KEY]: seeded }, viewport: { width: 390, height: 844 } })).page;
  await openApp(phone, `/?room=${code}`);
  const win = phone.locator('.tk-overlay.show .tk-win');
  await expect(win).toBeVisible();
  await expect(win).toContainText(TAKEOVER_WORDS.causes.newer.heading);
  await expect(win.getByRole('button', { name: TAKEOVER_WORDS.takeOver })).toHaveCount(0);
  await expect(phone.locator(OB)).toHaveCount(0);
  expect(await phone.evaluate(() => hunterApp.store.get().settings.onboarded)).toBe(false);
  expect(await rawSave(phone)).toBe(seeded);
  const box = await win.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
  expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

/**
 * A GM on Campaign ready whose Create room the server has answered, but whose answer reaches the phone only once
 * `release` is called. `made` is the code of the room the server made; `answered` settles once the answer was handed on
 * (or refused, the page having dropped the request).
 */
async function campaignReadyWithHeldCreate(device: (label: string, o?: object) => Promise<{ page: Page }>) {
  const gm = (await device('gm', { blockServiceWorker: true })).page;
  let release = () => {}, madeIt = (_: string) => {}, handedOn = () => {};
  const held = new Promise<void>(r => { release = r; }), made = new Promise<string>(r => { madeIt = r; }), answered = new Promise<void>(r => { handedOn = r; });
  await gm.route('**/api/rooms', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const answer = await route.fetch();
    madeIt(String((await answer.json()).code));
    await held;
    try { await route.fulfill({ response: answer }); } finally { handedOn(); }
  });
  await openApp(gm);
  for (const b of ['[data-yes]', '[data-gm]', '[data-starter]']) await gm.locator(`${OB} ${b}`).tap();
  const win = await windowTitled(gm, 'Campaign ready');
  await win.locator('[data-obcreate]').tap();
  await expect(win.locator('[data-obcreate]')).toHaveAttribute('aria-busy', 'true');
  return { gm, release, made, answered };
}

test('a GM who taps Later while Create room is under way closes the window and stays on the page when the create answers', async ({ device }) => {
  const { gm, release } = await campaignReadyWithHeldCreate(device);
  const url = gm.url();
  await gm.locator(`${OB} [data-oblater]`).tap();
  await expect(gm.locator(OB)).toHaveCount(0);
  release();
  await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.detail().conn)).not.toBe('creating');
  expect(gm.url()).toBe(url);
  await expect(gm.locator('#view-room')).toBeHidden();
  await expect(gm.locator(OB)).toHaveCount(0);
});

test('a GM who taps Later while Create room is under way is in no room once the server answers, and keeps nothing of the room it made', async ({ device }) => {
  const { gm, release, made, answered } = await campaignReadyWithHeldCreate(device);
  const code = await made;
  await gm.locator(`${OB} [data-oblater]`).tap();
  release();
  await answered;
  await expect.poll(() => gm.evaluate(() => hunterApp.api.sync.detail().conn)).not.toBe('creating');
  expect(await gm.evaluate(() => [hunterApp.api.sync.room(), hunterApp.seat()])).toEqual([null, 'alone']);
  expect(await rawSave(gm), 'neither the room\'s code nor its GM key is in the save').not.toContain(code);
});

test('the ? guide closes with Escape and gives the focus back to the ? button', async ({ device }) => {
  const phone = (await device('phone')).page;
  await onboardPlayer(phone, 'Focus Back');
  await phone.locator('#help-btn').focus();
  await phone.locator('#help-btn').tap();
  await windowTitled(phone, 'How it works');
  await phone.keyboard.press('Escape');
  await expect(phone.locator(OB)).toHaveCount(0);
  await expect(phone.locator('#help-btn')).toBeFocused();
});

test('GM setup includes 4 sample hunters by default and lets a live table uncheck them before loading the starter campaign', async ({ device }) => {
  const gm = (await device('gm', { viewport: { width: 360, height: 640 } })).page;
  await openApp(gm);
  await gm.locator(`${OB} [data-yes]`).tap();
  await gm.locator(`${OB} [data-gm]`).tap();
  const win = await windowTitled(gm, 'Run the game');

  const toggle = win.getByRole('checkbox', { name: 'Include 4 sample hunters' });
  await expect(toggle).toBeChecked();
  const labelBox = await win.locator('label.ob-check').boundingBox();
  expect(labelBox && labelBox.height >= 44).toBe(true);

  await win.locator('label.ob-check').tap();
  await expect(toggle).not.toBeChecked();
  await win.locator('[data-starter]').tap();

  const ready = await windowTitled(gm, 'Campaign ready');
  await ready.locator('[data-oblater]').tap();
  await expect(gm.locator(OB)).toHaveCount(0);

  const state = await gm.evaluate(() => {
    const s = hunterApp.store.get();
    return {
      hunters: s.hunters.map((h: any) => h.name),
      activeValid: s.hunters.some((h: any) => h.id === s.settings.activeHunterId),
      gates: s.gates.map((g: any) => g.name),
      stories: s.library.stories.map((st: any) => st.name),
      mode: s.settings.mode,
    };
  });
  expect(state.mode).toBe('gm');
  expect(state.activeValid).toBe(true);
  expect(state.hunters).toEqual(['Hunter']);
  for (const p of PREGENS) expect(state.hunters).not.toContain(p.name);
  expect(state.gates).toEqual([STARTER_GATE.name]);
  expect(state.stories).toContain(STARTER_STORY_NAME);
});

test('Read aloud: World primer is collapsible inside Campaign ready and the ? Quick Start guide', async ({ device }) => {
  const gm = (await device('gm', { viewport: { width: 360, height: 640 } })).page;
  await openApp(gm);
  for (const b of ['[data-yes]', '[data-gm]', '[data-starter]']) await gm.locator(`${OB} ${b}`).tap();

  await test.step('Campaign ready renders the primer collapsed by default and opens it on tap', async () => {
    const ready = await windowTitled(gm, 'Campaign ready');
    const drawer = ready.locator('[data-primer]');
    const summary = drawer.locator('summary');
    await expect(summary).toHaveText('Read aloud: World primer');
    await expect(drawer).not.toHaveAttribute('open', '');
    const box = await summary.boundingBox();
    expect(box && box.height >= 44).toBe(true);
    await summary.tap();
    await expect(drawer).toHaveAttribute('open', '');
    for (const para of WORLD_PRIMER) await expect(drawer).toContainText(para);
    await ready.locator('[data-oblater]').tap();
    await expect(gm.locator(OB)).toHaveCount(0);
  });

  await test.step('? Quick Start also renders the primer collapsed by default and opens it on tap', async () => {
    await gm.locator('#help-btn').tap();
    const guide = await windowTitled(gm, 'How it works');
    const drawer = guide.locator('[data-primer]');
    const summary = drawer.locator('summary');
    await expect(summary).toHaveText('Read aloud: World primer');
    await expect(drawer).not.toHaveAttribute('open', '');
    await summary.tap();
    await expect(drawer).toHaveAttribute('open', '');
    for (const para of WORLD_PRIMER) await expect(drawer).toContainText(para);
    await guide.locator('[data-ok]').tap();
    await expect(gm.locator(OB)).toHaveCount(0);
  });
});
