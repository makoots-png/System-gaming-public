import { writeFile } from 'node:fs/promises';
import { test as base, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { STARTER_GEAR, parseItem } from '../../src/core/registry/items.ts';
import type { ItemDef } from '../../src/core/registry/items.ts';
import { STARTER_SKILLS, skillOf } from '../../src/core/registry/skills.ts';
import type { SkillDef } from '../../src/core/registry/skills.ts';
import { confirm, raiseMany } from '../../src/core/hunter/progress.ts';
import type { StatPoints } from '../../src/core/hunter/progress.ts';
import { setJob } from '../../src/core/hunter/classes.ts';
import { learnSkill } from '../../src/core/hunter/skills-held.ts';
import { equip, putItem } from '../../src/core/hunter/inventory.ts';
import { refill } from '../../src/core/hunter/vitals.ts';
import { hunterSheet } from '../../src/core/hunter/sheet.ts';
import { issueQuest } from '../../src/core/hunter/quests.ts';
import type { QuestDraft } from '../../src/core/hunter/quests.ts';
import { spawnGate } from '../../src/core/gates/world.ts';
import type { Gate, GateType } from '../../src/core/gates/gate.ts';
import { chooseMode } from '../../src/core/role.ts';
import { onboarded } from '../../src/core/settings.ts';
import { told } from '../../src/core/session-log.ts';
import type { Said, Stamp } from '../../src/core/session-log.ts';
import { isRefused } from '../../src/core/save-step.ts';
import { makeHunter, rulesOf } from '../../src/core/save.ts';
import type { Hunter, Monster, Rank, Save } from '../../src/core/save.ts';
import type { Rules } from '../../src/core/rules.ts';
import { saveId } from '../../src/core/ids.ts';
import type { IdOf } from '../../src/core/ids.ts';

export { expect };
export type { Page, BrowserContext };

/**
 * Test lever, off by default: `E2E_POPUP_DELAY=100` opens every System window and confirm dialog 100 ms late (src/views/ui.js).
 * A test that taps on before the window it expects is on screen then fails every time. This is the one place it is read.
 */
const POPUP_DELAY = Number(process.env.E2E_POPUP_DELAY) || 0;

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
export const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
export const PHONE = { width: 390, height: 844 }, SMALL_PHONE = { width: 360, height: 780 }, LANDSCAPE = { width: 844, height: 390 };
export const ROOM_CODE = /^[A-HJ-NP-Z2-9]{6}$/;

export type Device = { label: string; page: Page; ctx: BrowserContext; errors: string[] };

export type DeviceOptions = {
  viewport?: { width: number; height: number };
  /** localStorage entries written once, before the app first loads. */
  seed?: Record<string, string>;
  /** Freeze Date at this ISO time. Timers keep running. The phone reads it in UTC unless `timezoneId` says otherwise. */
  pinTo?: string;
  /** The zone this phone reads local time in. Default: `noonZone`'s for the test. A test about the day's clock names its own. */
  timezoneId?: string;
  /** Needed for page.route and setOffline to reach app requests. */
  blockServiceWorker?: boolean;
  /** Console lines this test expects. Anything else fails the test. */
  allowConsole?: RegExp[];
  /** A window driven with a mouse rather than a touch screen (a laptop), so the page's pointer is fine, not coarse. */
  mouse?: boolean;
  /** A touch phone's browser, by its user agent (default an iPhone's Safari). */
  userAgent?: string;
};

/**
 * The zone where the test's start is noon, local time. The day turns at the reset hour (midnight by default), so a phone on
 * the box's own zone that runs a test across midnight meets the rollover in the middle of it: a missed daily's PENALTY
 * window then sits in front of the window the test waits for (push 49's two award tests, 23:59:56 to 00:00:16 UTC). In
 * this zone the next midnight is at least eleven hours away, and the local date is the UTC date.
 */
export function noonZone(at: Date): string {
  const ahead = 12 - at.getUTCHours();
  return ahead === 0 ? 'UTC' : `Etc/GMT${ahead > 0 ? '-' : '+'}${Math.abs(ahead)}`;
}

/**
 * A local Date whose calendar date matches the UTC date `noonZone` gives Chromium, so `freshSave({ now: noonDate() })`
 * writes the same `lastDailyKey` and `lastCheckedKey` the browser sees regardless of Node's local time zone.
 */
export function noonDate(at: Date = new Date()): Date {
  return new Date(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 12);
}

type Fixtures = { device: (label: string, options?: DeviceOptions) => Promise<Device> };

/**
 * `device(label)` opens a fresh phone. Every device is closed after the test, and the test fails if any device
 * logged a console error, a console warning or an uncaught exception that the test did not allow.
 */
export const test = base.extend<Fixtures>({
  device: async ({ browser }, use, testInfo) => {
    const made: { device: Device; allow: RegExp[] }[] = [];
    const started = Date.now(), apiLog: string[] = [], zone = noonZone(new Date(started));
    const logApi = (label: string, method: string, url: string, outcome: string | number) => {
      const u = new URL(url);
      if (u.pathname.startsWith('/api/')) apiLog.push(`${((Date.now() - started) / 1000).toFixed(1)}s ${label} ${method} ${u.pathname}${u.search} -> ${outcome}`);
    };
    await use(async (label, options = {}) => {
      const allow = [...(options.allowConsole ?? [])];
      if (options.blockServiceWorker) allow.push(/Service Worker registration blocked by Playwright/);
      const ctx = await browser.newContext({
        viewport: options.viewport ?? PHONE, deviceScaleFactor: 2, isMobile: !options.mouse, hasTouch: !options.mouse, ...(options.mouse ? {} : { userAgent: options.userAgent ?? IPHONE_UA }),
        serviceWorkers: options.blockServiceWorker ? 'block' : 'allow',
        timezoneId: options.timezoneId ?? (options.pinTo ? 'UTC' : zone),
      });
      if (POPUP_DELAY) await ctx.addInitScript(ms => { (globalThis as any).__e2ePopupDelay = ms; }, POPUP_DELAY);
      if (options.seed) {
        await ctx.addInitScript(entries => {
          if (localStorage.getItem('__seeded') !== null) return;
          for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
          localStorage.setItem('__seeded', '1');
        }, options.seed);
      }
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
      page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
      page.on('response', r => logApi(label, r.request().method(), r.url(), r.status()));
      page.on('requestfailed', r => logApi(label, r.method(), r.url(), `FAILED ${r.failure()?.errorText ?? ''}`));
      if (options.pinTo) await page.clock.setFixedTime(new Date(options.pinTo));
      const device = { label, page, ctx, errors };
      made.push({ device, allow });
      return device;
    });
    const unexpected = made.flatMap(({ device, allow }) => device.errors.filter(e => !allow.some(re => re.test(e))).map(e => `${device.label}: ${e}`));
    for (const { device } of made) await device.ctx.close();
    if (testInfo.status !== testInfo.expectedStatus) {
      const file = testInfo.outputPath('api-requests.txt');
      await writeFile(file, apiLog.join('\n'));
      await testInfo.attach('api-requests', { path: file, contentType: 'text/plain' });
    }
    expect(unexpected, 'console errors, warnings or uncaught exceptions').toEqual([]);
  },
});

export async function openApp(page: Page, path = '/'): Promise<void> {
  await page.goto(path, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0, null, { timeout: 15_000 });
}

/** Headers for a room request a test sends itself (`page.request`). The server refuses a room request without the page's build id. */
export const roomHeaders = async (page: Page): Promise<Record<string, string>> => ({ 'X-Hunter-Build': await page.evaluate(() => hunterApp.build as string) });
/** `roomHeaders` with room `code`'s GM key from the GM phone `page`: a read of the room as its GM gets every sheet whole and every message (protocol.ts `servedTo`). */
export const gmRoomHeaders = async (page: Page, code: string): Promise<Record<string, string>> =>
  ({ ...(await roomHeaders(page)), 'X-GM-Key': await page.evaluate(c => hunterApp.store.get().settings.sync.gmKeys[c] as string, code) });

/** Tap the first match if it is on screen. Answers whether it tapped. */
export async function tapIfShown(page: Page, selector: string): Promise<boolean> {
  const target = page.locator(selector).first();
  if (!(await target.count()) || !(await target.isVisible())) return false;
  await target.tap();
  await page.waitForTimeout(300);
  return true;
}

/** Close System windows and the quick-start guide until none is left. */
export async function dismissAll(page: Page, max = 12): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await tapIfShown(page, '.sys-overlay.show .primary')) continue;
    if (await tapIfShown(page, '.sys-overlay.show button:not(.confirm-all):not(.danger):not([hidden])')) continue;
    if (await tapIfShown(page, '.sys-overlay.show button:not(.confirm-all):not([hidden])')) continue;
    if (await tapIfShown(page, '.ob-overlay [data-ok]')) continue;
    if (await tapIfShown(page, '.ob-overlay [data-obsheet]')) continue;
    if (await tapIfShown(page, '.ob-overlay [data-oblater]')) continue;
    if (await tapIfShown(page, '.ob-overlay [data-skip]')) continue;
    break;
  }
}

/**
 * Wait for the System window whose text holds `title`, tap its button `label` (default: its primary, danger, or only
 * visible button), and wait for it to close. Use it after a tap that opens a window: the window comes a moment after
 * the tap, so a look that finds nothing on screen yet does not mean none is coming.
 */
export async function answerWindow(page: Page, title: string | RegExp, label?: string): Promise<void> {
  const win = page.locator('.sys-overlay.show', { hasText: title });
  await expect(win).toBeVisible();
  const id = await win.locator('.sys-window').first().getAttribute('aria-labelledby');
  if (label) {
    await win.locator('.sys-actions button', { hasText: label }).first().tap();
  } else {
    const primary = win.locator('.sys-actions button.primary');
    const danger = win.locator('.sys-actions button.danger');
    const target = (await primary.count()) > 0
      ? primary
      : (await danger.count()) > 0
        ? danger
        : win.locator('.sys-actions button:not(.confirm-all):not([hidden])');
    await target.first().tap();
  }
  await expect(id ? page.locator(`.sys-overlay.show .sys-window[aria-labelledby="${id}"]`) : win).toHaveCount(0);
}

/** First run as a GM with the starter campaign, answering Later on Campaign ready. */
export async function onboardGM(page: Page, path = '/'): Promise<void> {
  await openApp(page, path);
  for (const step of ['[data-yes]', '[data-gm]', '[data-starter]']) await tapIfShown(page, `.ob-overlay ${step}`);
  const ready = page.locator('.ob-overlay', { has: page.locator('h2', { hasText: 'Campaign ready' }) });
  await expect(ready).toBeVisible();
  await ready.locator('[data-oblater]').tap();
  await expect(page.locator('.ob-overlay')).toHaveCount(0);
  await page.waitForTimeout(500);
  await dismissAll(page);
}

// ── Test-only legacy Goblin Den fixture ──
// Decouples combat, gate, maker, and room E2E tests from `src/core/starter.ts` and onboarding copy so starter
// campaign changes do not break unrelated browser tests. Kept here (non-matcher literals) so `tests/e2e-copy.test.ts`
// recognizes fixture names (`Brakk Ironhide`, `Mira Vale`, `Eldrin Voss`, `Goblin Den`) as test-written data.
const LEGACY_PREGENS: readonly { name: string; job: string; stats: StatPoints; skills: readonly SkillDef[]; item: ItemDef }[] = [
  { name: 'Brakk Ironhide', job: 'Tanker', stats: { vit: 8, str: 4 }, skills: [STARTER_SKILLS.shieldWall, STARTER_SKILLS.ironSkin], item: STARTER_GEAR.towerShield },
  { name: 'Mira Vale', job: 'Ranger', stats: { agi: 8, ctl: 4 }, skills: [STARTER_SKILLS.markedShot, STARTER_SKILLS.trailsense], item: STARTER_GEAR.huntingBow },
  { name: 'Eldrin Voss', job: 'Mage', stats: { pow: 8, ctl: 4 }, skills: [STARTER_SKILLS.arcBolt, STARTER_SKILLS.manaSense], item: STARTER_GEAR.manaPotion },
];

const LEGACY_GATES: readonly { name: string; rank: Rank; type: GateType; classOffer?: true }[] = [
  { name: 'Goblin Den', rank: 'E', type: 'normal', classOffer: true },
  { name: 'Double Dungeon (hidden)', rank: 'D', type: 'double' },
];

const LEGACY_ARC: readonly QuestDraft[] = [
  { title: 'Session 1: Goblins at the Gate', desc: 'Reports of goblins raiding a nearby market. Find and clear the Goblin Den.', objectives: [{ label: 'Enter the Goblin Den', target: 1 }, { label: 'Defeat the Goblin Chief', target: 1 }], rewards: { xp: 100, gold: 50 } },
  { title: 'Session 2: The Strange Altar', desc: 'The chief guarded a carved altar that does not belong in an E-rank gate. Someone has been here before.', objectives: [{ label: 'Examine the altar', target: 1 }, { label: 'Question the survivors', target: 3 }], rewards: { xp: 150, points: 1 } },
  { title: 'Session 3: Double Dungeon', desc: 'The altar opens a hidden second dungeon. Descend, and keep your party alive.', objectives: [{ label: 'Find the hidden entrance', target: 1 }, { label: 'Survive the Double Dungeon', target: 1 }], rewards: { xp: 300, gold: 150, title: { name: 'Survivor', desc: '', bonus: {} } } },
].map(q => ({ ...q, kind: 'side', from: 'gm' }));

function buildLegacyGoblinDenSave(
  base: Save,
  made: readonly { gate: Gate; monsters: readonly Monster[] }[],
  stamp: Stamp,
  R: Rules,
): Save {
  let seq = base.seq;
  const next = <P extends string>(prefix: P): IdOf<P> => saveId(prefix, ++seq);
  const now = new Date(stamp.at);
  const browserDayKey = base.hunters[0]?.daily.lastCheckedKey ?? base.world.lastDailyKey;
  const said: Said[] = [];
  const pregens: Hunter[] = [];
  for (const p of LEGACY_PREGENS) {
    const created = makeHunter({ seq, settings: base.settings }, p.name, R, now);
    seq = created.seq;
    const jobbed = setJob(created.hunter, p.job, { held: false, dead: false });
    const item = parseItem(p.item);
    if (isRefused(jobbed) || !item) throw new Error(`legacy Goblin Den fixture pregen failed: ${p.name}`);
    const raised = raiseMany(jobbed, p.stats, R);
    if (isRefused(raised)) throw new Error(`legacy Goblin Den fixture raiseMany failed: ${p.name}`);
    let h = confirm(raised);
    if (browserDayKey) h = { ...h, daily: { ...h.daily, lastCheckedKey: browserDayKey } };
    for (const k of p.skills) h = learnSkill(h, { ...skillOf(k, R), label: 'Lv.1' }, next('s'));
    const itemId = next('i');
    h = putItem(h, item, itemId);
    if (item.slot) {
      const worn = equip(h, itemId, itemId);
      if (isRefused(worn)) throw new Error(`legacy Goblin Den fixture equip failed: ${p.name}`);
      h = worn;
    }
    h = { ...h, ...refill(h, hunterSheet(h, R).sheet) };
    for (const d of LEGACY_ARC) {
      const t = issueQuest(h, d, next('q'), stamp.at);
      h = t.hunter;
      said.push(...t.said);
    }
    pregens.push(h);
  }
  const seed = base.hunters.find(h => h.seed === true) ?? null;
  let s: Save = {
    ...base,
    seq,
    hunters: [...base.hunters.filter(h => h !== seed), ...pregens],
    settings: onboarded(chooseMode({ ...base.settings, activeHunterId: pregens[0]!.id }, 'gm')),
  };
  for (let i = 0; i < made.length; i++) {
    const g = made[i]!;
    const gate: Gate = { ...g.gate, classOffer: LEGACY_GATES[i]?.classOffer === true };
    s = spawnGate(s, gate, g.monsters, stamp);
  }
  return told(s, stamp, ...said, {
    kind: 'system',
    hunterId: null,
    title: 'Campaign begun',
    text: 'Starter campaign loaded with 3 hunters, the Goblin Den (E), a hidden Double Dungeon (D), and 3 linked quests.',
  });
}

/**
 * Sets up a GM device with the test-only legacy Goblin Den fixture (Brakk Ironhide, Mira Vale, Eldrin Voss, Goblin
 * Den, Double Dungeon (hidden), and the 3 legacy ARC quests, with an empty story library) without depending on
 * `src/core/starter.ts` or clicking through onboarding. Lands on `#/status` when `path` names no hash.
 */
export async function setupGoblinDenGM(page: Page, path = '/'): Promise<void> {
  await openApp(page, path);
  const { base, gates, nowIso } = await page.evaluate(specs => {
    const rolled = specs.map(g => hunterApp.api.gates.roll(g));
    return {
      base: JSON.parse(JSON.stringify(hunterApp.store.get())) as Save,
      gates: JSON.parse(JSON.stringify(rolled)) as { gate: Gate; monsters: Monster[] }[],
      nowIso: new Date().toISOString(),
    };
  }, LEGACY_GATES);
  const R = rulesOf(base.rulesOverrides, base.library.statuses);
  const built = buildLegacyGoblinDenSave(base, gates, { at: nowIso, cap: R.logCap }, R);
  await page.evaluate(([next, setHash]) => {
    localStorage.setItem('hunter-system-v5', JSON.stringify(next));
    localStorage.removeItem('hunter-system-told');
    if (setHash) location.hash = '#/status';
  }, [built, !path.includes('#')] as const);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.hunterApp && document.querySelectorAll('#nav-top a').length > 0, null, { timeout: 15_000 });
}

/**
 * First run as a player with one new hunter, answering Open my sheet on Hunter created and Understood on the first
 * personal gate's window. With a room code the player joins that room.
 */
export async function onboardPlayer(page: Page, name: string, roomCode = ''): Promise<void> {
  await openApp(page);
  await tapIfShown(page, '.ob-overlay [data-yes]');
  await tapIfShown(page, '.ob-overlay [data-player]');
  await page.fill('.ob-overlay [data-name]', name);
  if (roomCode) await page.fill('.ob-overlay [data-room]', roomCode);
  await page.locator('.ob-overlay [data-go]').tap();
  const created = page.locator('.ob-overlay', { has: page.locator('h2', { hasText: 'Hunter created' }) });
  await expect(created).toBeVisible();
  await created.locator('[data-obsheet]').tap();
  await expect(page.locator('.ob-overlay')).toHaveCount(0);
  // the System opens the new hunter's first personal gate at once (src/core/gates/solo.ts `soloTick`), and says so
  await answerWindow(page, 'A GATE HAS APPEARED');
  await page.waitForTimeout(500);
}

export async function go(page: Page, view: string): Promise<void> {
  await page.evaluate(v => hunterApp.go(v), view);
  await page.waitForTimeout(300);
}

/**
 * The GM's "Waiting for you" row of a reward for `name` (gm.js, hunter/pending.ts): the GM view shown and its section
 * opened, the row there once the GM's phone has heard of the reward.
 */
export async function waitingRow(gm: Page, name: string): Promise<Locator> {
  await go(gm, 'gm');
  const row = gm.locator('#gm-pw [data-pw]', { hasText: name }).first();
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  const tog = gm.locator('[data-tog="waiting"]');
  if ((await tog.getAttribute('aria-expanded')) !== 'true') await tog.tap();
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}
/** The GM approves the reward waiting for `name` as it stands (its row's Approve). */
export async function approveWaiting(gm: Page, name: string): Promise<void> {
  const row = await waitingRow(gm, name), id = await row.getAttribute('data-pw');
  await row.locator('[data-pw-approve]').tap();
  await expect(gm.locator(`#gm-pw [data-pw="${id}"]`), 'an approved reward leaves the list').toHaveCount(0);
}

/** The sheet shows name, job and title as text: Edit opens the inputs, a change saves, Done closes them. */
export async function editIdentity(page: Page, field: 'name' | 'job' | 'title', value: string): Promise<void> {
  await page.locator('#view-status [data-idedit]').tap();
  const input = page.locator(`#view-status [data-idform] [data-f="${field}"]`);
  await input.fill(value);
  await input.press('Enter');
  await page.locator('#view-status [data-iddone]').tap();
}

/** The whole save as the app holds it. */
export const save = (page: Page): Promise<any> => page.evaluate(() => JSON.parse(JSON.stringify(hunterApp.store.get())));

/** The active hunter, with HP and mana as its sheet shows them and `derived`: its sheet's numbers and its stats after perks and conditions. */
export const activeHunter = (page: Page): Promise<any> => page.evaluate(() => {
  const h = hunterApp.store.active(), s = hunterApp.api.hunter.sheet(h);
  return { ...JSON.parse(JSON.stringify(h)), hp: s.hp, mana: s.mana, derived: { ...s.sheet, stats: s.stats } };
});

/** The GM creates a room from the GM tab and gets its code. */
export async function createRoom(gm: Page): Promise<string> {
  await go(gm, 'gm');
  await gm.locator('[data-gmcreate]').tap();
  const shown = gm.locator('[data-gmroomcode]');
  await expect(shown).toHaveText(ROOM_CODE);
  return ((await shown.textContent()) ?? '').trim();
}

/** A gate on the GM's Gates tab, by name: its id and the base gate XP its card shows. */
export async function gateByName(page: Page, name: string): Promise<{ id: string; xp: number }> {
  await go(page, 'gates');
  const card = page.locator('#view-gates .gate').filter({ has: page.locator('.gt-name').getByText(name, { exact: true }) });
  const id = (await card.getAttribute('data-id')) ?? '';
  const xp = Number((await card.locator('[data-xp-val]').innerText()).replace(/\D/g, ''));
  return { id, xp };
}

/**
 * The legacy Goblin Den fixture's fight (`setupGoblinDenGM`), started from the Gates tab, with the turn order set to: a
 * monster, then the named hunters, then the rest. The start rolls the openings; this setup then gives each row a turn
 * time one tick after the one before it, so the order does not depend on the dice. Answers the gate's id and XP.
 */
export async function startGoblinDenFight(page: Page, hunters: string[] = ['Brakk Ironhide', 'Mira Vale']): Promise<{ id: string; xp: number }> {
  const gate = await gateByName(page, 'Goblin Den');
  await page.locator(`#view-gates .gate[data-id="${gate.id}"] [data-act=encounter]`).tap();
  await page.locator('[aria-modal="true"] [data-apply]').tap();
  await expect(page.locator('#view-combat .cmb-row.cur')).toHaveCount(1);
  await page.evaluate(names => hunterApp.store.update((d: any) => {
    const f = d.fight, ms = f.rows.filter((r: any) => r.kind !== 'hunter');
    const picked = names.map((n: string) => f.rows.find((r: any) => r.name === n));
    const rest = f.rows.filter((r: any) => r.kind === 'hunter' && !names.includes(r.name));
    [ms[0], ...picked, ...ms.slice(1), ...rest].forEach((r: any, i: number) => { r.at = f.now + i; r.tie = 0; });
    f.currentId = ms[0].id; f.log = [];
  }, 'test-setup'), hunters);
  await expect(page.locator('#view-combat .cmb-row.cur .cmb-nm').first()).toContainText(await page.evaluate(() => {
    const f = hunterApp.store.get().fight;
    return f.rows.find((r: any) => r.id === f.currentId).name;
  }));
  return gate;
}

/**
 * This phone shows the fight as a list: the map is the default view, and a test that drives the list's rows, card or kit
 * chooses it first. A device preference, set as setup before the fight screen draws.
 */
export async function chooseList(...pages: Page[]): Promise<void> {
  for (const p of pages) await p.evaluate(() => hunterApp.store.setPrefs({ fightView: 'list' }));
}

/** The fight's row named `name`, as the save holds it, with `hp`: its HP as `rowHp` reads it from its life (up has its HP, any other state 0). */
export const fightRow = (page: Page, name: string): Promise<any> =>
  page.evaluate(n => JSON.parse(JSON.stringify(hunterApp.store.get().fight.rows.find((r: any) => r.name === n) ?? null)), name)
    .then(r => r && { ...r, hp: r.life.at === 'up' ? r.life.hp : 0 });

/** Under 1100 px the GM's Table feed in Combat is one line: open it so its rows show. */
export async function openFeed(page: Page): Promise<void> {
  const toggle = page.locator('#view-combat [data-tb-open]');
  await expect(toggle).toBeAttached();
  if (await toggle.isVisible() && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.tap();
}

/** Flip a device that onboarded as GM into player mode (setup only) and reload so the player view shows. */
export async function switchToPlayerMode(page: Page): Promise<void> {
  await page.evaluate(() => hunterApp.store.update((s: any) => { s.settings.mode = 'player'; }, 'test-mode'));
  await openApp(page);
  await dismissAll(page, 4);
}

/**
 * Waits until the player's phone holds the fight doc of a test's setup: the row named `name` at `place`. The doc of the
 * fight's start may already call that hunter's turn from where the fight first stood it, so "YOUR TURN" alone lets a
 * tap through that was worked out from the older doc, and the GM's phone refuses it (too far).
 */
export async function setupDoc(player: Page, name: string, place: { x: number; y: number }): Promise<void> {
  await expect.poll(() => player.evaluate(n => (hunterApp.api.sync.doc('fight') as any)?.rows.find((r: any) => r.name === n)?.place ?? null, name)).toEqual(place);
}
