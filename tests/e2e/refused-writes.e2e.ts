// A write the save refuses, as a player and a GM meet it (audit 2026-11-19, the class "a view ignores a refusal from
// store.apply"; the lint "a view reads the answer of every write to the save"). A tab whose save a newer app wrote is
// read-only (src/core/store-life.ts): every write is refused, so each case here is a tap whose write is refused. What
// follows the write stops, and the player is told by the refusal's kind (ui.js `wrote`, its words `NOT_SAVED`).
import { freshSave } from '../../src/core/save.ts';
import { parseDeviceId } from '../../src/core/ids.ts';
import { test, expect, openApp, onboardPlayer, dismissAll, go, save, answerWindow, type Page } from './helpers.ts';

const V4 = 'hunter-system-v4';
const NOT_SAVED = 'Not saved: this tab cannot save right now. The banner at the top says why.';
const env = { now: new Date(), newDeviceId: () => parseDeviceId('d-e2e-readonly')!, newDeviceToken: () => 'test-device-token-0123456789abcd' };

/**
 * A save a newer app wrote, which this app opens read-only. Personal gates and feats are off, so no window of theirs
 * stands in front of the ones these tests wait for.
 */
function newerSave(o: { gm?: boolean; calls?: unknown[]; items?: unknown[]; personal?: boolean; edit?: (s: any) => void } = {}): string {
  const s: any = freshSave(env, { onboarded: true });
  s.rulesOverrides = { solo: { personal: !!o.personal }, feats: { on: false } };
  if (o.gm) s.settings.mode = 'gm';
  if (o.calls) s.calls = o.calls;
  if (o.items) s.library.items = o.items;
  o.edit?.(s);
  return JSON.stringify({ ...s, schema: 99 });
}
/** A quest of the hunter's own with one objective at 1 of 3, as the Quests view's form makes it. */
const ownQuest = (s: any, id: string, title: string, state: { status: 'active'; doneAt: null } | { status: 'failed'; doneAt: string }) => ({
  ...s.hunters[0].quests.find((q: any) => q.from === 'self'), id, title, objectives: [{ label: 'Goblins', target: 3, progress: 1 }], ...state,
});
async function openReadOnly(device: (label: string, o?: object) => Promise<{ page: Page }>, text: string): Promise<Page> {
  const { page } = await device('phone', { seed: { [V4]: text } });
  await openApp(page);
  await expect(page.locator('#banners .banner')).toContainText('newer version');
  return page;
}
const toast = (page: Page, text: string) => page.locator('.toast', { hasText: text });

test('a Fail quest this tab cannot save leaves the quest active, sends the GM nothing and tells the player', async ({ device }) => {
  // BUG-views-7: the old fail() read the refusal object as true and reported the quest failed to the GM
  const page = await openReadOnly(device, newerSave());
  await go(page, 'quests');
  const quest = page.locator('#view-quests [data-fail]').first();
  const id = await quest.getAttribute('data-fail');
  await quest.tap();
  await answerWindow(page, 'Fail quest?', 'Fail quest');
  await expect(toast(page, NOT_SAVED)).toHaveCount(1);
  const s = await save(page);
  expect(s.hunters[0].quests.find((q: any) => q.id === id).status).toBe('active');
  expect(s.settings.sync.outbox ?? []).toEqual([]);
});

test('a share code added in a tab that cannot save says so and leaves the library as it was', async ({ device }) => {
  // BUG-views-5: the import read the report of a merge the store never ran, and threw
  const page = await openReadOnly(device, newerSave({ gm: true, items: [{ id: 'i900', name: 'Frost Charm', rar: 'rare' }] }));
  await go(page, 'data');
  await page.locator('#view-data [data-share]').tap();
  await answerWindow(page, 'Share custom content');
  await answerWindow(page, 'Share as', 'Show a code');
  const box = page.locator('.sys-overlay.show', { hasText: 'Share code' }).locator('[data-pack-code]');
  await expect(box).toHaveValue(/^HS1\./);
  const code = await box.inputValue();
  await answerWindow(page, 'Share code', 'Close');
  await page.locator('#view-data [data-paste]').fill(code);
  await page.locator('#view-data [data-read-code]').tap();
  await answerWindow(page, 'Import custom content', 'Add');
  await expect(toast(page, NOT_SAVED)).toHaveCount(1);
  await expect(toast(page, 'Custom content imported')).toHaveCount(0);
  expect((await save(page)).library.items.map((i: any) => i.name)).toEqual(['Frost Charm']);
  await expect(page.locator('#view-data [data-paste]')).toHaveValue(code);
});

test('a coin call the GM rules in a tab that cannot save is told once and not asked again', async ({ device }) => {
  // BUG-views-6: the ruling was refused, the landing was still posted, and the same call opened again at once
  const call = { id: 'd-e2e-player:r-1', hunter: { kind: 'remote', remote: 'd-e2e-player:h-1' }, who: 'Mira', what: 'STR check', face: 20, at: 'called', call: 'heads' };
  const page = await openReadOnly(device, newerSave({ gm: true, calls: [call] }));
  await answerWindow(page, 'Mira called Heads', 'Right');
  await expect(toast(page, NOT_SAVED)).toHaveCount(1);
  await expect(page.locator('.sys-overlay.show')).toHaveCount(0);
  const s = await save(page);
  expect(s.calls.map((c: any) => c.at)).toEqual(['called']);
  expect(s.settings.sync.outbox ?? []).toEqual([]);
});

test('a broadcast in a tab that cannot save is not shown as sent', async ({ device }) => {
  // BUG-views-19: the window showed before the write, which the store then refused
  const page = await openReadOnly(device, newerSave({ gm: true }));
  await go(page, 'gm');
  await page.locator('[data-tog="bcast"]').tap();
  await page.locator('#gm-b-title').fill('Storm warning');
  await page.locator('#gm-b-go').tap();
  await expect(toast(page, NOT_SAVED)).toHaveCount(1);
  await expect(page.locator('.sys-overlay.show')).toHaveCount(0);
  await expect(page.locator('#gm-b-msg')).toHaveText('');
});

test('a player who deletes their last hunter and cancels the new one\'s name keeps the hunter', async ({ device }) => {
  // BUG-views-10: the hunter was deleted, and a hunter named "Hunter" made, even on Cancel
  const { page } = await device('player');
  await onboardPlayer(page, 'Mira Test');
  await dismissAll(page, 4);
  await go(page, 'status');
  const row = page.locator('#view-status [data-panel="party"] li', { hasText: 'Mira Test' });
  await row.locator('[data-pdel]').tap();
  const win = page.locator('.sys-overlay.show');
  await expect(win).toContainText('Delete Mira Test?');
  await win.locator('input').fill('Mira Test');
  await win.locator('.sys-actions button.primary').tap();
  await expect(win).toContainText('Create a new hunter');
  await win.locator('.sys-actions button', { hasText: 'Cancel' }).tap();
  await expect(win).toHaveCount(0);
  await expect(row).toHaveCount(1);
  expect((await save(page)).hunters.map((h: any) => h.name)).toEqual(['Mira Test']);
});

test('a hunter picked in a tab that cannot save is not shown as the active one, and the player is told', async ({ device }) => {
  // NEW-sync-1: sync.switchTo dropped its write's refusal and answered true, so the picker showed one hunter and the app held another
  const page = await openReadOnly(device, newerSave({ edit: s => { s.hunters.push({ ...s.hunters[0], id: 'h2', name: 'Second One' }); } }));
  await page.locator('#hunter-sel').selectOption('h2');
  await expect(toast(page, NOT_SAVED)).toHaveCount(1);
  await expect(page.locator('#hunter-sel')).toHaveValue('h1');
  expect((await save(page)).settings.activeHunterId).toBe('h1');
});

test('an Enter alone this tab cannot save tells the player, and the gate stays', async ({ device }) => {
  // NEW-gates-1: runAlone told a refused run only in the solo run's own words, which have none for a read-only tab
  const now = Date.now();
  const page = await openReadOnly(device, newerSave({ personal: true, edit: s => {
    const h = s.hunters[0];
    for (const k of Object.keys(h.stats)) h.stats[k] = 60;
    h.solo = { clock: { at: 'off' }, gates: [{ id: 'pg900', name: 'Goblin Hole', rank: 'E', monsters: [{ monsterId: 'seed:goblin', count: 1 }],
      at: new Date(now).toISOString(), closesAt: new Date(now + 20 * 3_600_000).toISOString() }] };
  } }));
  await go(page, 'gates');
  await page.locator('#view-gates .gate.solo [data-solo-enter]').tap();
  const ask = page.locator('.sys-overlay.show', { hasText: 'ENTER ALONE?' });
  await expect(ask).toBeVisible({ timeout: 60_000 });
  await ask.locator('.sys-actions button', { hasText: 'Enter alone' }).tap();
  await expect(toast(page, NOT_SAVED)).toHaveCount(1, { timeout: 30_000 });
  expect((await save(page)).hunters[0].solo.gates.map((g: any) => g.id)).toEqual(['pg900']);
});

test('an objective raised in a tab that cannot save keeps its count, and the player is told', async ({ device }) => {
  // NEW-views-2: the objective's plus and minus stopped at a refused write and said nothing
  const page = await openReadOnly(device, newerSave({ edit: s => { s.hunters[0].quests = [ownQuest(s, 'q900', 'Clear the den', { status: 'active', doneAt: null })]; } }));
  await go(page, 'quests');
  await page.locator('#view-quests [data-oi="q900"]').tap();
  await expect(toast(page, NOT_SAVED)).toHaveCount(1);
  await expect(page.locator('#view-quests [data-os="q900"]')).toHaveText('1/3');
});

test('a failed quest reopened in a tab that cannot save stays failed, and the player is told', async ({ device }) => {
  // NEW-views-2: Reopen read only the refusal "past due" and said nothing of any other
  const failed = new Date(Date.now() - 3_600_000).toISOString();
  const page = await openReadOnly(device, newerSave({ edit: s => { s.hunters[0].quests = [ownQuest(s, 'q901', 'Clear the den', { status: 'failed', doneAt: failed })]; } }));
  await go(page, 'quests');
  await page.locator('#view-quests [data-tab="failed"]').tap();
  await page.locator('#view-quests [data-reopen="q901"]').tap();
  await expect(toast(page, NOT_SAVED)).toHaveCount(1);
  expect((await save(page)).hunters[0].quests.find((q: any) => q.id === 'q901').status).toBe('failed');
});

test('a shadow summoned in a tab that cannot save is told as not saved, never as too little mana', async ({ device }) => {
  test.fixme(true, 'open: hunter.spendMana answers a boolean (HunterApi in src/core/api.ts), so shadows.js cannot tell a read-only refusal from too little mana; the fix answers the Applied and tells it in shadows.js, files outside this unit (tests/lint.test.ts `open`)');
  // the leftover of AW-views-1: hunter.spendMana answered false for a refused write, and the Shadows view read it as too little mana
  const page = await openReadOnly(device, newerSave({ edit: s => {
    s.hunters[0].shadows = [{ id: 'sh900', name: 'Igris', rank: 'E', archetype: 'brute', grade: 'Normal', monster: null, hp: 10, summoned: false, notes: '' }];
  } }));
  await go(page, 'shadows');
  await page.locator('#view-shadows [data-sid="sh900"] [data-act="summon"]').tap();
  await expect(toast(page, NOT_SAVED)).toHaveCount(1);
  await expect(toast(page, 'Not enough mana')).toHaveCount(0);
  expect((await save(page)).hunters[0].shadows[0].summoned).toBe(false);
});
