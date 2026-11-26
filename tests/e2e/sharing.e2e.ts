// Sharing custom content (src/core/pack.ts, src/edge/pack-code.ts, the Data view and the Workshop): a code or a file
// made on one phone, read on another, merged with Add or Replace.
import { test, expect, setupGoblinDenGM, go, answerWindow, save, type Page } from './helpers.ts';

const FROSTBITE = { label: 'Frostbite', desc: 'Cold eats at you.', ops: [{ op: 'damage', type: 'arcane', amount: { kind: 'number', value: 3 } }] };
/** Frostbite for 2 rounds: a round is 1000 ticks of fight time (RULES.fight.round). */
const FROST_BOMB = {
  name: 'Frost Bomb', type: 'consumable', rar: 'rare', slot: null, qty: 2, dice: '', bonus: {}, value: 0, desc: '', weight: 0, armor: 0, resist: 0, target: 'other',
  effects: [{ op: 'applyStatus', key: 'frostbite', def: FROSTBITE, duration: 2000 }],
};
const ICE_SPIKE = { name: 'Ice Spike', type: 'active', level: 1, label: null, desc: 'A shard of ice.', ability: null };
const ICE_WARDEN = {
  name: 'Ice Warden', rank: 'C', type: '', archetype: 'brute', kind: 'normal', tweak: {}, abilities: [], notes: [], xp: 250, extractable: true, desc: '',
  statuses: [{ key: 'frostbite', rounds: null }], loot: { gold: 0, items: [] },
};
const WOLF_HUNT = { name: 'Wolf hunt', rewards: { xp: 100 } };

const win = (page: Page, title: string) => page.locator('.sys-overlay.show', { hasText: title });
const workshop = (page: Page, kind: string) => page.locator(`#view-workshop [data-ws="${kind}"]`);
/** What the library and the monsters hold, by name (a status by its label), and the status keys. */
const content = (page: Page) => page.evaluate(() => {
  const s = hunterApp.store.get();
  return {
    statuses: Object.keys(s.library.statuses), labels: Object.values(s.library.statuses).map((d: any) => d.label),
    items: s.library.items.map((i: any) => i.name), skills: s.library.skills.map((k: any) => k.name),
    rewards: s.library.rewards.map((b: any) => b.name), monsters: s.monsters.map((m: any) => m.name),
  };
});
type Content = Awaited<ReturnType<typeof content>>;
/** What a merge appended to each list (a merge adds at the end; the starter campaign may have made monsters for its gates). */
const added = (before: Content, after: Content): Content =>
  Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v.slice(before[k as keyof Content].length)])) as Content;
const ALL_FIVE = { statuses: ['frostbite'], labels: ['Frostbite'], items: ['Frost Bomb'], skills: ['Ice Spike'], rewards: ['Wolf hunt'], monsters: ['Ice Warden'] };

/** A GM's phone with one custom status, item, skill, enemy and reward bundle and nothing else custom (setup through the store; no gates, so no gate made a monster). */
async function gmWithContent(device: (label: string) => Promise<{ page: Page }>, label = 'gm'): Promise<Page> {
  const { page } = await device(label);
  await setupGoblinDenGM(page);
  await page.evaluate(([st, it, sk, mo, rb]) => hunterApp.store.update((d: any) => {
    d.library.statuses.frostbite = st;
    d.library.items.push({ ...it, id: 'i900' }); d.library.skills.push({ ...sk, id: 's900' });
    d.gates = []; d.monsters = [{ ...mo, id: 'm900' }]; d.library.rewards.push({ ...rb, id: 'rb900' });
  }, 'test-setup'), [FROSTBITE, FROST_BOMB, ICE_SPIKE, ICE_WARDEN, WOLF_HUNT] as const);
  return page;
}
/** A second phone: a GM with the starter campaign and no custom content. */
async function freshGM(device: (label: string) => Promise<{ page: Page }>, label = 'other'): Promise<Page> {
  const { page } = await device(label);
  await setupGoblinDenGM(page);
  return page;
}

/** Data, Share custom content, `what`, Show a code: answers the code the window shows. */
async function codeFor(page: Page, what: string | RegExp): Promise<string> {
  await go(page, 'data');
  await page.locator('#view-data [data-share]').tap();
  await answerWindow(page, 'Share custom content', typeof what === 'string' ? what : undefined);
  await answerWindow(page, 'Share as', 'Show a code');
  return readCodeWindow(page);
}
async function readCodeWindow(page: Page): Promise<string> {
  const box = win(page, 'Share code').locator('[data-pack-code]');
  await expect(box).toHaveValue(/^HS1\./);
  const code = await box.inputValue();
  await answerWindow(page, 'Share code', 'Close');
  return code;
}
/** Data, the code in "Paste a code", Read code: answers the preview window. */
async function paste(page: Page, code: string) {
  await go(page, 'data');
  await page.locator('#view-data [data-paste]').fill(code);
  await page.locator('#view-data [data-read-code]').tap();
}
async function previewLines(page: Page): Promise<string[]> {
  const w = win(page, 'Import custom content');
  await expect(w).toBeVisible();
  return w.locator('.sys-lines li').allInnerTexts();
}

test('a GM copies the code for everything; on a second phone it shows what it holds, Add brings all five to the Workshop, and the item\'s card there says what its status does', async ({ device }) => {
  const gm = await gmWithContent(device);
  let code = '';
  await test.step('the GM copies the code for everything', async () => {
    await gm.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await go(gm, 'data');
    await gm.locator('#view-data [data-share]').tap();
    await answerWindow(gm, 'Share custom content', 'Everything (5)');
    await answerWindow(gm, 'Share as', 'Show a code');
    const w = win(gm, 'Share code');
    await expect(w).toContainText('This code contains 1 status, 1 item, 1 skill, 1 monster and 1 bundle.');
    await w.locator('[data-pack-copy]').tap();
    await expect(w.locator('[data-pack-copy]')).toHaveText('Copied');
    code = await gm.evaluate(() => navigator.clipboard.readText());
    expect(code).toBe(await w.locator('[data-pack-code]').inputValue());
    expect(code).toMatch(/^HS1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
    await answerWindow(gm, 'Share code', 'Close');
  });

  const other = await freshGM(device);
  const before = await content(other);
  await test.step('the second phone pastes it and sees one of each kind', async () => {
    await paste(other, code);
    expect(await previewLines(other)).toEqual(['Statuses: 1', 'Items: 1', 'Skills: 1', 'Monsters: 1', 'Bundles: 1']);
    await answerWindow(other, 'Import custom content', 'Add');
    await expect(other.locator('#view-data [data-paste]')).toHaveValue('');
    expect(await other.evaluate(() => hunterApp.store.backups()[0].reason)).toBe('pre-import');
  });

  await test.step('its Workshop lists all five', async () => {
    await go(other, 'workshop');
    await expect(workshop(other, 'status').locator('.ws-list li', { hasText: 'Frostbite' })).toHaveCount(1);
    await expect(workshop(other, 'item').locator('li', { hasText: 'Frost Bomb' })).toHaveCount(1);
    await expect(workshop(other, 'skill').locator('li', { hasText: 'Ice Spike' })).toHaveCount(1);
    await expect(workshop(other, 'monster').locator('li', { hasText: 'Ice Warden' })).toContainText('C-rank normal brute');
    await expect(workshop(other, 'bundle').locator('li', { hasText: 'Wolf hunt' })).toContainText('+100 XP');
    expect(added(before, await content(other))).toEqual(ALL_FIVE);
  });

  await test.step('the Frost Bomb\'s row says it applies the Frostbite it came with: 3 arcane damage a round for 2 rounds', async () => {
    await expect(workshop(other, 'item').locator('li', { hasText: 'Frost Bomb' })).toContainText('Applies Frostbite (2 rounds): 3 arcane damage a round');
  });
});

test('pasting the same code again with Add makes "… 2" copies, and with Replace makes none', async ({ device }) => {
  const gm = await gmWithContent(device);
  const code = await codeFor(gm, 'Everything (5)');
  await test.step('Add: each of the five arrives again numbered, and the copied item applies the copied status', async () => {
    await paste(gm, code);
    await answerWindow(gm, 'Import custom content', 'Add');
    expect(await content(gm)).toEqual({
      statuses: ['frostbite', 'frostbite-2'], labels: ['Frostbite', 'Frostbite 2'], items: ['Frost Bomb', 'Frost Bomb 2'], skills: ['Ice Spike', 'Ice Spike 2'],
      rewards: ['Wolf hunt', 'Wolf hunt 2'], monsters: ['Ice Warden', 'Ice Warden 2'],
    });
    const s = await save(gm);
    expect(s.library.items[1].effects).toMatchObject([{ op: 'applyStatus', key: 'frostbite-2', duration: 2000 }]);
    expect(s.monsters[1].statuses).toEqual([{ key: 'frostbite-2', rounds: null }]);
  });
  await test.step('Replace: nothing new arrives', async () => {
    const before = await content(gm);
    await paste(gm, code);
    await answerWindow(gm, 'Import custom content', 'Replace');
    expect(await content(gm)).toEqual(before);
  });
});

test('a code with one damaged character is refused with a message, and nothing changes', async ({ device }) => {
  const gm = await gmWithContent(device);
  const code = await codeFor(gm, 'Everything (5)');
  const at = Math.floor(code.length / 2), bad = code.slice(0, at) + (code[at] === 'A' ? 'B' : 'A') + code.slice(at + 1);
  const before = JSON.stringify((await save(gm)).library), backups = await gm.evaluate(() => hunterApp.store.backups().length);
  await paste(gm, bad);
  const w = win(gm, 'Code not read');
  await expect(w).toContainText('This code is damaged or cut short. Copy the whole code again.');
  await answerWindow(gm, 'Code not read');
  expect(JSON.stringify((await save(gm)).library)).toBe(before);
  expect(await gm.evaluate(() => hunterApp.store.backups().length)).toBe(backups);
  await expect(gm.locator('#view-data [data-paste]')).toHaveValue(bad);
});

test('one item shared from the Workshop arrives alone with the status it applies', async ({ device }) => {
  const gm = await gmWithContent(device);
  await go(gm, 'workshop');
  await workshop(gm, 'item').locator('li', { hasText: 'Frost Bomb' }).locator('[data-act="more"]').tap();
  await gm.locator('.sys-overlay.show', { hasText: 'Frost Bomb' }).locator('.sys-actions button', { hasText: 'Share' }).tap();
  await expect(win(gm, 'Share code')).toContainText('This code contains 1 status and 1 item.');
  const code = await readCodeWindow(gm);

  const other = await freshGM(device);
  const before = await content(other);
  await paste(other, code);
  expect(await previewLines(other)).toEqual(['Statuses: 1', 'Items: 1']);
  await answerWindow(other, 'Import custom content', 'Add');
  expect(added(before, await content(other))).toEqual({ statuses: ['frostbite'], labels: ['Frostbite'], items: ['Frost Bomb'], skills: [], rewards: [], monsters: [] });
});

test('a library file saved from the Workshop imports through the Data view\'s file picker the same way', async ({ device }) => {
  const gm = await gmWithContent(device);
  await go(gm, 'workshop');
  await gm.locator('#view-workshop [data-share-all]').tap();
  await answerWindow(gm, 'Share custom content', 'Everything (5)');
  const download = gm.waitForEvent('download');
  await answerWindow(gm, 'Share as', 'Save a file');
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^hunter-library-\d{4}-\d{2}-\d{2}\.json$/);
  const path = (await file.path()) ?? '';

  const other = await freshGM(device);
  const before = await content(other);
  await go(other, 'data');
  await other.locator('#view-data [data-import]').setInputFiles(path);
  expect(await previewLines(other)).toEqual(['Statuses: 1', 'Items: 1', 'Skills: 1', 'Monsters: 1', 'Bundles: 1']);
  await answerWindow(other, 'Import custom content', 'Add');
  expect(added(before, await content(other))).toEqual(ALL_FIVE);
});

test('adding the hunters of a campaign file also offers its custom content, and Add brings it', async ({ device }) => {
  const gm = await gmWithContent(device);
  await go(gm, 'data');
  const download = gm.waitForEvent('download');
  await gm.locator('#view-data [data-export]').tap();
  const path = (await (await download).path()) ?? '';

  const other = await freshGM(device);
  const hunters = (await save(other)).hunters.length, before = await content(other);
  await go(other, 'data');
  await other.locator('#view-data [data-import]').setInputFiles(path);
  await expect(win(other, 'Import preview')).toContainText('Custom content: 1 status, 1 item, 1 skill, 1 monster and 1 bundle');
  await answerWindow(other, 'Import preview', 'Add hunters to party');
  const offer = win(other, 'Bring its custom content too?');
  await expect(offer.locator('.sys-lines li')).toHaveText(['Statuses: 1', 'Items: 1', 'Skills: 1', 'Monsters: 1', 'Bundles: 1']);
  await answerWindow(other, 'Bring its custom content too?', 'Add');
  expect(added(before, await content(other))).toEqual(ALL_FIVE);
  expect((await save(other)).hunters.length).toBeGreaterThan(hunters);
});

test('a GM with a feat of their own and a story shares everything: the list names Feats and Stories, and Add on a second phone brings both', async ({ device }) => {
  const gm = await freshGM(device, 'gm-story');
  await gm.evaluate(() => hunterApp.store.update((d: any) => {
    d.library.feats['frost-ward'] = { name: 'Frost Ward', window: 'COLD HANDS', desc: 'Ten wolves defeated.', show: { at: 'start' }, rule: { on: 'kill', where: [], reach: 10 }, rewards: { xp: 50 } };
    d.library.stories.push({ id: 'st900', name: 'The wager', chapters: [{ words: { title: 'The house offers a bet', line: 'Win a solo run of your rank.' }, rewards: { points: -1 } }] });
  }, 'test-setup'));

  const code = await test.step('Share custom content lists Feats (1) and Stories (1); Everything makes a code', async () => {
    await go(gm, 'data');
    await gm.locator('#view-data [data-share]').tap();
    const list = win(gm, 'Share custom content');
    for (const label of ['Feats (1)', 'Stories (1)']) await expect(list.locator('.sys-actions button', { hasText: label })).toHaveCount(1);
    await answerWindow(gm, 'Share custom content');
    await answerWindow(gm, 'Share as', 'Show a code');
    return readCodeWindow(gm);
  });

  await test.step('the second phone sees a feat and a story in the code, and Add brings them', async () => {
    const other = await freshGM(device, 'other-story');
    await paste(other, code);
    expect(await previewLines(other)).toEqual(expect.arrayContaining(['Feats: 1', 'Stories: 1']));
    await answerWindow(other, 'Import custom content', 'Add');
    const lib = await other.evaluate(() => { const l = hunterApp.store.get().library; return { feats: Object.keys(l.feats), stories: l.stories.map((s: any) => [s.name, s.chapters[0].words.title, s.chapters[0].rewards.points]) }; });
    expect(lib).toEqual({ feats: ['frost-ward'], stories: [['The wager', 'THE HOUSE OFFERS A BET', -1]] });
  });
});
