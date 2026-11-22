// The GM's table weight on a player's own rolls outside a fight (src/views/dice.js, src/core/table-weight.ts,
// docs/agent-handoff/features/notes-8-fudge.md section 5 unit 9 and "What a player sees of a weighted roll"). The GM's
// phone sets the weight on its Party board; the player's phone rolls a quick check in the Dice view, on a 390 px phone.
// The tray reads the page's Math.random at each die, so a test fixes the drawn faces: a d20 draws 1 + floor(r x 20), so
// r = (f - 0.5) / 20 draws f. A weighted face is the drawn one moved by the weight and kept on the die; a forced face is
// every d20 of the roll.
import type { Page } from '@playwright/test';
import { test, expect, onboardGM, onboardPlayer, createRoom, dismissAll, go, save } from './helpers.ts';

const HUNTER = 'Kai Test';
type Mode = '' | 'adv' | 'dis';

/** The face a drawn `f` shows under a weight of `w`: moved by `w`, kept on the d20. */
const weighed = (f: number, w: number): number => Math.min(20, Math.max(1, f + w));
/** What the tray shows of a kept face and the check's bonus: "14 + 3 = 17". */
const sumLine = (kept: number, bonus: number): string => `${kept} ${bonus < 0 ? '−' : '+'} ${Math.abs(bonus)} = ${kept + bonus}`;

/**
 * A GM and a player in one room, the player's Dice view open. `before` runs on the GM's Party board before the player
 * joins. Answers the player's sheet key and the STR check's bonus, read from the hunter's sheet.
 */
async function table(device: (label: string) => Promise<{ page: Page }>, before?: (gm: Page) => Promise<void>): Promise<{ gm: Page; player: Page; key: string; bonus: number }> {
  const gm = (await device('gm')).page, player = (await device('player')).page;
  await onboardGM(gm);
  const code = await createRoom(gm);
  await go(gm, 'gm');
  if (before) await before(gm);
  await onboardPlayer(player, HUNTER, code);
  await expect.poll(() => player.evaluate(() => hunterApp.api.sync.room())).toBe(code);
  await dismissAll(player, 4);
  await expect(gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER })).toHaveCount(1);
  const { key, bonus } = await player.evaluate(() => {
    const h = hunterApp.store.active();
    return { key: hunterApp.api.sync.myKey(h.id) as string, bonus: hunterApp.api.hunter.sheet(h).checks.bonus.str as number };
  });
  await expect.poll(() => held(player), { message: 'the weight the GM\'s phone sent at the join' }).toEqual(before ? { total: 2, force: null } : { total: 0, force: null });
  await go(player, 'dice');
  return { gm, player, key, bonus };
}

/** The weight the player's phone holds for its hunter. */
const held = (player: Page): Promise<unknown> => player.evaluate(() => {
  const s = hunterApp.store.get(), w = s.settings.sync.weights;
  return w ? w.hunters[hunterApp.store.active().id] ?? null : null;
});

/** Taps the GM's Party board "Hunters" stepper until it reads `n`. */
async function setHunters(gm: Page, n: number): Promise<void> {
  const box = gm.locator('#gm-weight');
  const shown = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');
  for (let at = 0; at < 40; at++) {
    const text = (await box.locator('b').textContent()) ?? '0', v = Number(text.replace('−', '-').replace('+', ''));
    if (v === n) return;
    await box.locator(`[data-weigh-scope="hunters"][aria-label^="${v < n ? 'Raise' : 'Lower'}"]`).tap();
    await expect(box.locator('b')).toHaveText(shown(v < n ? v + 1 : v - 1));
  }
}

/** Taps the GM's Next roll choice on the player's card: 20, 1, or off. */
async function force(gm: Page, key: string, face: 20 | 1 | null): Promise<void> {
  await gm.locator(`[data-weigh-force="${key}"][data-face="${face ?? ''}"]`).tap();
  await expect(gm.locator(`[data-weigh-force="${key}"][data-face="${face ?? ''}"]`)).toHaveAttribute('aria-pressed', 'true');
}

/**
 * Rolls the STR quick check in `mode` while the dice draw `faces`, and waits for it in the roll log. A natural 1 or 20
 * before it leaves the coin's card (coin.js) over the checks, so the check is then clicked where it is.
 */
async function check(player: Page, mode: Mode, faces: number[], underCoin = false): Promise<void> {
  const view = player.locator('#view-dice [data-roller]');
  await view.locator(`[data-m="${mode}"]`).tap();
  const n = (await save(player)).rolls.length;
  await player.evaluate(fs => {
    const rs = fs.map(f => (f - 0.5) / 20);
    (window as any).__r = Math.random; Math.random = () => rs.shift() ?? 0.5;
  }, faces);
  const str = view.locator('[data-checks] [data-st="str"]');
  try { if (underCoin) await str.dispatchEvent('click'); else await str.tap(); } finally { await player.evaluate(() => { Math.random = (window as any).__r; }); }
  await expect.poll(() => save(player).then(s => s.rolls.length)).toBe(n + 1);
}

/** What the tray shows of the last roll: its sum line, its faces and its total, once the total has landed. */
async function shown(player: Page): Promise<{ sum: string; faces: number[]; total: string }> {
  const view = player.locator('#view-dice [data-roller]'), id = (await save(player)).rolls[0].id as string;
  await expect(view.locator(`[data-total][data-rid="${id}"]`)).toHaveCount(1);
  await expect(view.locator('[data-sum]')).toBeVisible();
  const faces = ((await view.locator('.dx-faces').textContent()) ?? '').replace(/[[\]!]/g, '').split(',').map(x => Number(x.trim()));
  return { sum: (await view.locator('[data-sum]').textContent()) ?? '', faces, total: (await view.locator('[data-total]').textContent()) ?? '' };
}

/** Rolls and reads one weighted check: each face on the die, the kept one with the bonus adding to the total. */
async function expectRoll(player: Page, mode: Mode, drawn: number[], faces: number[], bonus: number, underCoin = false): Promise<void> {
  await check(player, mode, drawn, underCoin);
  const kept = mode === 'adv' ? Math.max(...faces) : mode === 'dis' ? Math.min(...faces) : faces[0]!;
  const s = await shown(player);
  expect(s.faces, 'every face is on the d20, already weighted').toEqual(faces);
  for (const f of s.faces) expect(f >= 1 && f <= 20, `face ${f} is on the d20`).toBe(true);
  expect([s.sum, s.total]).toEqual([sumLine(kept, bonus), String(kept + bonus)]);
}

/**
 * The three weights of each shape's test: up 2, down 2, then a force on top of the weight down, last, since its natural
 * 1 or 20 calls the coin.
 */
async function threeWeights(device: (label: string) => Promise<{ page: Page }>, mode: Mode, drawn: number[], face: 20 | 1): Promise<void> {
  const { gm, player, key, bonus } = await table(device);
  await test.step('a weight up of 2 moves each die up 2 faces', async () => {
    await setHunters(gm, 2);
    await expect.poll(() => held(player)).toEqual({ total: 2, force: null });
    await expectRoll(player, mode, drawn, drawn.map(f => weighed(f, 2)), bonus);
  });
  await test.step('a weight down of 2 moves each die down 2 faces, never below 1', async () => {
    await setHunters(gm, -2);
    await expect.poll(() => held(player)).toEqual({ total: -2, force: null });
    await expectRoll(player, mode, drawn, drawn.map(f => weighed(f, -2)), bonus);
  });
  await test.step(`a forced ${face} is every d20 of the roll`, async () => {
    await force(gm, key, face);
    await expect.poll(() => held(player)).toEqual({ total: -2, force: face });
    await expectRoll(player, mode, drawn, drawn.map(() => face), bonus);
  });
}

test('a plain check weighted up, down and forced shows face + bonus = total, each face on the die', async ({ device }) => {
  await threeWeights(device, '', [5], 20);
});

test('an advantage check weighted up, down and forced shows both dice weighted and keeps the higher: face + bonus = total', async ({ device }) => {
  await threeWeights(device, 'adv', [15, 2], 20);
});

test('a disadvantage check weighted up, down and forced shows both dice weighted and keeps the lower: face + bonus = total', async ({ device }) => {
  await threeWeights(device, 'dis', [19, 6], 1);
});

test('a forced 20 shows on both dice of an advantage roll and is gone on the next roll, on both phones', async ({ device }) => {
  const { gm, player, key, bonus } = await table(device);
  const card = gm.locator('#gm-board .gm-card.remote', { hasText: HUNTER });
  await force(gm, key, 20);
  await expect(card.locator('[data-weightline]')).toHaveText('Next roll 20');
  await expect.poll(() => held(player)).toEqual({ total: 0, force: 20 });
  await test.step('the advantage roll reads 20 on both dice', async () => {
    await expectRoll(player, 'adv', [3, 8], [20, 20], bonus);
    await expect(player.locator('[data-coin-card]'), 'a forced 20 counts as a natural 20').toContainText('Natural 20');
  });
  await test.step('the force is gone on the player\'s phone, and the GM\'s card no longer says Next roll', async () => {
    expect(await held(player)).toEqual({ total: 0, force: null });
    await expect(card.locator('[data-weightline]')).toHaveCount(0);
    await expect(gm.locator(`[data-weigh-force="${key}"][data-face=""]`)).toHaveAttribute('aria-pressed', 'true');
  });
  await test.step('the next roll falls as drawn', async () => {
    await expectRoll(player, 'adv', [3, 8], [3, 8], bonus, true);
  });
});

test('a hunter whose phone joins after the GM set the weight rolls with it', async ({ device }) => {
  const { player, bonus } = await table(device, gm => setHunters(gm, 2));
  await expectRoll(player, '', [12], [14], bonus);
});

test('what the player\'s phone holds and receives for a weighted roll has the shape of an unweighted one', async ({ device }) => {
  const { gm, player, bonus } = await table(device);
  const rolls: Record<string, unknown>[] = [], weighs: Record<string, unknown>[] = [];
  player.on('request', r => {
    const b = r.method() === 'POST' && /\/events$/.test(new URL(r.url()).pathname) ? JSON.parse(r.postData() ?? '{}') : null;
    if (b && b.type === 'roll') rolls.push(b.payload);
  });
  player.on('response', async r => {
    if (r.request().method() !== 'GET' || !/^\/api\/rooms\/[^/]+$/.test(new URL(r.url()).pathname)) return;
    const body = await r.json().catch(() => null) as { events?: { type: string; payload: Record<string, unknown> }[] } | null;
    for (const ev of body?.events ?? []) if (ev.type === 'weigh') weighs.push(ev.payload);
  });
  const entry = async () => (await save(player)).rolls[0] as Record<string, unknown>;

  await check(player, '', [17]);
  const plain = { entry: await entry(), line: (await shown(player)).sum };
  await setHunters(gm, 2);
  await expect.poll(() => weighs.length, { message: 'the player\'s phone received the weigh' }).toBeGreaterThan(0);
  await check(player, '', [15]);
  const heavy = { entry: await entry(), line: (await shown(player)).sum };
  await expect.poll(() => rolls.length, { message: 'both rolls went to the room' }).toBe(2);

  expect(Object.keys(rolls[1]!).sort(), 'the roll message\'s keys').toEqual(Object.keys(rolls[0]!).sort());
  expect(Object.keys(heavy.entry).sort(), 'the roll log entry\'s keys').toEqual(Object.keys(plain.entry).sort());
  expect([heavy.line, plain.line], 'the shown line').toEqual([sumLine(17, bonus), sumLine(17, bonus)]);
  expect(Object.keys(weighs.at(-1)!).sort(), 'the weigh of a weighted hunter has the keys of the 0 every hunter hears at its join')
    .toEqual(['eid', 'force', 'to', 'total']);
});

test('the player\'s page names no weight: its text for a weighted roll equals its text for an unweighted roll of the same faces', async ({ device }) => {
  const { gm, player } = await table(device);
  const text = () => player.evaluate(() => {
    const view = document.querySelector('#view-dice')!, roller = view.querySelector('[data-roller]') as HTMLElement, newest = view.querySelector('[data-hist] li') as HTMLElement;
    return { roller: roller.innerText, newest: newest.innerText.replace(/\d\d:\d\d$/, '') };
  });
  await check(player, '', [17]);
  await shown(player);
  const plain = await text();
  await setHunters(gm, 2);
  await expect.poll(() => held(player)).toEqual({ total: 2, force: null });
  await check(player, '', [15]);
  await shown(player);
  const heavy = await text();
  expect(heavy).toEqual(plain);
  expect(await player.evaluate(() => (document.querySelector('#view-dice') as HTMLElement).innerText.split('\n').filter(l => /weigh/i.test(l)))).toEqual([]);
});
