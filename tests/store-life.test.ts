import { afterEach, describe, expect, test } from 'bun:test';
import { READ_ONLY, READ_ONLY_WHYS, STORE_STATES, TABLE, TAKEOVER_WORDS, canTakeOver, dailyBackupDue, isReadOnlyWhy, mayChange, noticesOf, opened, storeStep } from '../src/core/store-life.ts';
import type { StoreEffect, StoreEvent, StoreLife, Theirs } from '../src/core/store-life.ts';
import { STARTS, WALK_EVENTS } from './models/store-events.ts';

const at = (l: StoreLife, ...events: StoreEvent[]): { life: StoreLife; effects: StoreEffect[] } => {
  let life = l; const effects: StoreEffect[] = [];
  for (const e of events) { const r = storeStep(life, e); life = r.life; effects.push(...r.effects); }
  return { life, effects };
};
const READY = opened({ storage: 'ok', newer: false, backup: 'none' });
const clean: StoreLife = { at: 'ready', write: 'clean' };
const changed: StoreEvent = { type: 'changed' }, due: StoreEvent = { type: 'due' }, leaving: StoreEvent = { type: 'leaving' };
const wrote: StoreEvent = { type: 'wrote' }, failed: StoreEvent = { type: 'writeFailed' };
const other = (theirs: Theirs): StoreEvent => ({ type: 'otherTab', theirs });

describe('the store\'s life', () => {
  test('a tab opens ready and writes its save at once; a newer app\'s save opens read-only; no storage plays in memory', () => {
    expect(READY).toEqual({ life: { at: 'ready', write: 'dirty' }, effects: ['write'] });
    expect(opened({ storage: 'ok', newer: false, backup: 'kept' })).toEqual(READY);
    expect(opened({ storage: 'ok', newer: true, backup: 'none' })).toEqual({ life: { at: 'readOnly', why: 'newer' }, effects: [] });
    expect(opened({ storage: 'blocked', newer: false, backup: 'none' })).toEqual({ life: { at: 'noStorage' }, effects: [] });
    expect(opened({ storage: 'blocked', newer: true, backup: 'none' }).life).toEqual({ at: 'noStorage' });
  });

  test('a stored text the app cannot open, which storage was too full to back up, is never written over: the tab opens read-only and says so', () => {
    for (const lost of ['unreadable', 'old'] as const) {
      const r = opened({ storage: 'ok', newer: false, backup: { unkept: lost } });
      expect(r).toEqual({ life: { at: 'readOnly', why: 'loadUnkept' }, effects: [] });
      expect(mayChange(r.life)).toBe(false);
      expect(noticesOf(r.life, 'kept')).toEqual(['loadUnkept']);
      expect(at(r.life, changed, due, leaving).effects).toEqual([]);
      expect(at(r.life, { type: 'replaced' })).toEqual({ life: { at: 'ready', write: 'dirty' }, effects: ['write'] });
    }
  });

  test('a save that opened whole but for its running fight, which storage was too full to back up, says that, not that the save could not be opened (SMX-sync-9.2)', () => {
    const r = opened({ storage: 'ok', newer: false, backup: { unkept: 'fight' } });
    expect(r).toEqual({ life: { at: 'readOnly', why: 'fightUnkept' }, effects: [] });
    expect(mayChange(r.life)).toBe(false);
    expect(noticesOf(r.life, 'kept')).toEqual(['fightUnkept']);
    expect(at(r.life, { type: 'replaced' })).toEqual({ life: { at: 'ready', write: 'dirty' }, effects: ['write'] });
  });

  test('a change is written in the frame after it, once however many changes come before it', () => {
    expect(at(clean, changed)).toEqual({ life: { at: 'ready', write: 'dirty' }, effects: ['schedule'] });
    expect(at(clean, changed, changed, changed).effects).toEqual(['schedule']);
    expect(at(clean, changed, changed, due)).toEqual({ life: { at: 'ready', write: 'dirty' }, effects: ['schedule', 'write'] });
    expect(at(clean, changed, due, wrote).life).toEqual(clean);
    expect(at(clean, due, leaving).effects).toEqual([]);
  });

  test('the page hidden or left between a change and its frame writes the change at once', () => {
    expect(at(clean, changed, leaving)).toEqual({ life: { at: 'ready', write: 'dirty' }, effects: ['schedule', 'write'] });
    expect(at(clean, changed, leaving, wrote, due).life).toEqual(clean);
  });

  test('storage full on a write: the player is told, and told until a later write lands', () => {
    const full = at(clean, changed, due, failed).life;
    expect(full).toEqual({ at: 'ready', write: 'failing' });
    expect(noticesOf(full, 'kept')).toEqual(['saveFailed']);
    const again = at(full, changed);
    expect(again).toEqual({ life: { at: 'ready', write: 'retrying' }, effects: ['schedule'] });
    expect(noticesOf(again.life, 'kept')).toEqual(['saveFailed']);
    expect(at(again.life, due, failed).life).toEqual(full);
    expect(at(again.life, due, wrote).life).toEqual(clean);
    expect(noticesOf(clean, 'kept')).toEqual([]);
  });

  test('a failing tab tries its write again when the page is hidden or left, with no new change', () => {
    expect(at({ at: 'ready', write: 'failing' }, leaving).effects).toEqual(['write']);
    expect(at({ at: 'ready', write: 'failing' }, due).effects).toEqual([]);
  });

  test('another tab\'s save is taken while this tab is clean; a newer app\'s turns this tab read-only', () => {
    expect(at(clean, other('save'))).toEqual({ life: clean, effects: ['take'] });
    expect(at(clean, other('newer'))).toEqual({ life: { at: 'readOnly', why: 'newer' }, effects: ['take'] });
  });

  test('another tab saving while this tab holds a change not yet stored: this tab\'s save goes to the backups and it turns read-only, told so', () => {
    for (const behind of [at(clean, changed).life, at(clean, changed, due, failed).life, at(clean, changed, due, failed, changed).life]) {
      for (const theirs of ['save', 'newer'] as const) {
        expect(at(behind, other(theirs))).toEqual({ life: { at: 'keeping', theirs }, effects: ['keepMine'] });
        const r = at(behind, other(theirs), { type: 'kept' });
        expect(r).toEqual({ life: { at: 'readOnly', why: 'otherTab' }, effects: ['keepMine', 'take'] });
        expect(noticesOf(r.life, 'kept')).toEqual(['otherTab']);
      }
      expect(at(behind, other('unreadable'), { type: 'kept' })).toEqual({ life: { at: 'readOnly', why: 'otherTab' }, effects: ['keepMine'] });
    }
  });

  test('another tab saving while storage is too full to keep this tab\'s unsaved save: the tab keeps showing its own, refuses changes and tells the player to export it', () => {
    for (const theirs of ['save', 'newer', 'unreadable'] as const) {
      const r = at(at(clean, changed).life, other(theirs), { type: 'keepFailed' });
      expect(r).toEqual({ life: { at: 'readOnly', why: 'mineUnkept' }, effects: ['keepMine'] });
      expect(mayChange(r.life)).toBe(false);
      expect(noticesOf(r.life, 'kept')).toEqual(['mineUnkept']);
    }
  });

  test('while its save goes to the backups the tab takes no change and no other event moves it', () => {
    const l: StoreLife = { at: 'keeping', theirs: 'save' };
    expect(mayChange(l)).toBe(false);
    expect(at(l, changed, due, leaving, wrote, failed, other('newer'), { type: 'replaced' })).toEqual({ life: l, effects: [] });
  });

  test('another tab storing a text this app cannot read keeps this tab\'s save in the backups and stops this tab writing over it', () => {
    expect(at(clean, other('unreadable'), { type: 'kept' })).toEqual({ life: { at: 'readOnly', why: 'otherTab' }, effects: ['keepMine'] });
  });

  test('a read-only tab refuses every change, never writes, and says why', () => {
    for (const why of ['newer', 'otherTab', 'mineUnkept', 'loadUnkept', 'fightUnkept'] as const) {
      const l: StoreLife = { at: 'readOnly', why };
      expect(mayChange(l)).toBe(false);
      expect(at(l, changed, due, leaving, wrote, failed, other('save'), other('newer'), other('unreadable'), { type: 'kept' }, { type: 'keepFailed' })).toEqual({ life: l, effects: [] });
      expect(noticesOf(l, 'kept')).toEqual([why]);
    }
    expect(READ_ONLY).toBe('read-only');
    expect(mayChange(clean)).toBe(true);
    expect(mayChange({ at: 'noStorage' })).toBe(true);
  });

  test('a restore, an import or a reset makes a read-only tab ready and writes at once; a failing tab stays told until it lands', () => {
    expect(at({ at: 'readOnly', why: 'newer' }, { type: 'replaced' })).toEqual({ life: { at: 'ready', write: 'dirty' }, effects: ['write'] });
    expect(at(clean, { type: 'replaced' })).toEqual({ life: { at: 'ready', write: 'dirty' }, effects: ['write'] });
    expect(at({ at: 'ready', write: 'failing' }, { type: 'replaced' })).toEqual({ life: { at: 'ready', write: 'retrying' }, effects: ['write'] });
  });

  test('Take over here makes otherTab and mineUnkept writable and refuses newer, loadUnkept and fightUnkept', () => {
    for (const why of ['otherTab', 'mineUnkept'] as const) {
      expect(canTakeOver(why)).toBe(true);
      expect(at({ at: 'readOnly', why }, { type: 'takeOver' })).toEqual({ life: { at: 'ready', write: 'dirty' }, effects: ['write'] });
    }
    for (const why of ['newer', 'loadUnkept', 'fightUnkept'] as const) {
      expect(canTakeOver(why)).toBe(false);
      const l: StoreLife = { at: 'readOnly', why };
      expect(at(l, { type: 'takeOver' })).toEqual({ life: l, effects: [] });
    }
    expect(at(clean, { type: 'takeOver' })).toEqual({ life: clean, effects: [] });
  });

  test('another tab taking over locks a clean tab as otherTab and backs up a tab with unsaved changes first', () => {
    expect(at(clean, { type: 'takenOver' })).toEqual({ life: { at: 'readOnly', why: 'otherTab' }, effects: [] });
    for (const behind of [at(clean, changed).life, at(clean, changed, due, failed).life, at(clean, changed, due, failed, changed).life]) {
      expect(at(behind, { type: 'takenOver' })).toEqual({ life: { at: 'keeping', theirs: 'save' }, effects: ['keepMine'] });
      expect(at(behind, { type: 'takenOver' }, { type: 'kept' })).toEqual({ life: { at: 'readOnly', why: 'otherTab' }, effects: ['keepMine', 'take'] });
      expect(at(behind, { type: 'takenOver' }, { type: 'keepFailed' })).toEqual({ life: { at: 'readOnly', why: 'mineUnkept' }, effects: ['keepMine'] });
    }
  });

  test('every read-only cause is recognized by isReadOnlyWhy and has takeover copy', () => {
    for (const why of READ_ONLY_WHYS) {
      expect(isReadOnlyWhy(why)).toBe(true);
      const copy = TAKEOVER_WORDS.causes[why];
      expect(copy.heading.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
      expect(copy.exportNote.length).toBeGreaterThan(0);
    }
    expect(isReadOnlyWhy('saveFailed')).toBe(false);
    expect(isReadOnlyWhy('noStorage')).toBe(false);
  });

  test('with no storage the tab plays in memory, writes nothing and says so the whole time', () => {
    const l: StoreLife = { at: 'noStorage' };
    expect(at(l, ...WALK_EVENTS)).toEqual({ life: l, effects: [] });
    expect(noticesOf(l, 'kept')).toEqual(['noStorage']);
    expect(noticesOf(l, 'failing')).toEqual(['noStorage']);
  });

  test('a failed write of this phone\'s own memory is told beside the save\'s state', () => {
    expect(noticesOf(clean, 'failing')).toEqual(['deviceFailed']);
    expect(noticesOf({ at: 'ready', write: 'failing' }, 'failing')).toEqual(['saveFailed', 'deviceFailed']);
  });

  test('every state answers every event (the table is whole)', () => {
    for (const s of STORE_STATES) for (const e of WALK_EVENTS) expect(typeof TABLE[s][e.type]).toBe('function');
  });

  test('over any order of events and any storage, nothing the tab holds is lost without a word', () => {
    // A model tab: `mem` is what it shows, `disk` what storage holds, `kept` what the backups hold. Storage may fill up
    // and free again between events; another tab may store its own save. After every event: a clean tab shows what
    // storage holds; a tab whose save storage does not hold has a write coming or a banner; a save a tab loses from
    // view is in the backups; a tab that may not write never writes.
    type World = { life: StoreLife; mem: string; disk: string; kept: string[]; full: boolean; n: number };
    const MOVES = ['change', 'due', 'leave', 'fill', 'free', 'theirs', 'newer', 'junk', 'replace', 'takeOver', 'takenOver'] as const;
    let seed = 7;
    const rand = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const play = (w: World, move: (typeof MOVES)[number]): void => {
      const before = w.mem, diskBefore = w.disk, owned = w.life.at === 'ready';
      const fire = (e: StoreEvent, theirs?: string): void => {
        const queue: StoreEvent[] = [e];
        for (let ev = queue.shift(); ev; ev = queue.shift()) {
          const r = storeStep(w.life, ev);
          w.life = r.life;
          for (const fx of r.effects) {
            if (fx === 'write') {
              expect(w.life.at).toBe('ready');
              if (w.full) queue.push(failed); else { w.disk = w.mem; queue.push(wrote); }
            } else if (fx === 'keepMine') {
              if (w.full) queue.push({ type: 'keepFailed' }); else { w.kept.push(before); queue.push({ type: 'kept' }); }
            }
            else if (fx === 'take' && theirs !== undefined) w.mem = theirs;
          }
        }
      };
      switch (move) {
        case 'change': if (mayChange(w.life)) { w.mem = `mine${++w.n}`; fire(changed); } break;
        case 'due': fire(due); break;
        case 'leave': fire(leaving); break;
        case 'fill': w.full = true; break;
        case 'free': w.full = false; break;
        case 'theirs': if (w.life.at !== 'noStorage') { w.disk = `theirs${++w.n}`; fire(other('save'), w.disk); } break;
        case 'newer': if (w.life.at !== 'noStorage') { w.disk = `newer${++w.n}`; fire(other('newer'), w.disk); } break;
        case 'junk': if (w.life.at !== 'noStorage') { w.disk = `junk${++w.n}`; fire(other('unreadable')); } break;
        case 'replace': w.mem = `restored${++w.n}`; fire({ type: 'replaced' }); break;
        case 'takeOver': fire({ type: 'takeOver' }); break;
        case 'takenOver': if (w.life.at !== 'noStorage') { w.disk = `taken${++w.n}`; fire({ type: 'takenOver' }, w.disk); } break;
      }
      const overwritten = (move === 'theirs' || move === 'newer' || move === 'junk' || move === 'takenOver') && owned;
      const keptOrShown = (): boolean => w.kept.includes(before) || (w.mem === before && noticesOf(w.life, 'kept').includes('mineUnkept'));
      if (overwritten && before !== diskBefore) expect(keptOrShown(), `a change of this tab storage did not hold, overwritten by another tab (${move}), is in the backups or still shown with a banner`).toBe(true);
      if (move === 'junk' && owned) expect(keptOrShown(), 'a save this tab wrote, overwritten by a text no app reads, is in the backups or still shown with a banner').toBe(true);
      if (w.life.at === 'ready' && w.life.write === 'clean') expect(w.mem, `a clean tab shows what storage holds (after ${move})`).toBe(w.disk);
      const writeComing = w.life.at === 'ready' && (w.life.write === 'dirty' || w.life.write === 'retrying');
      if (w.mem !== w.disk && !writeComing) expect(noticesOf(w.life, 'kept').length, `a save storage does not hold is told (after ${move})`).toBeGreaterThan(0);
    };
    for (let run = 0; run < 400; run++) {
      const start = STARTS[run % STARTS.length]!;
      const w: World = { life: start, mem: 'loaded', disk: 'loaded', kept: [], full: false, n: 0 };
      if (start.at === 'ready') w.life = storeStep(start, wrote).life;
      for (let i = 0; i < 40; i++) play(w, MOVES[rand(MOVES.length)]!);
    }
  });
});

describe('the day\'s backup', () => {
  const ZONE = process.env.TZ;
  afterEach(() => { process.env.TZ = ZONE ?? 'Etc/UTC'; });
  test('the first load of a local day backs up, unless the newest backup is from that day; with none it always does', () => {
    process.env.TZ = 'America/New_York';
    const now = new Date('2026-11-15T03:30:00Z'); // 22:30 on the 14th in New York
    expect(dailyBackupDue(null, now)).toBe(true);
    expect(dailyBackupDue('2026-11-14T05:00:00Z', now)).toBe(false); // 00:00 on the 14th there
    expect(dailyBackupDue('2026-11-14T04:59:00Z', now)).toBe(true); // 23:59 on the 13th there
    expect(dailyBackupDue('not a time', now)).toBe(true);
  });
});

describe('the save\'s write after a change, on the page (src/edge/store.ts)', () => {
  /** A page with a clock of its own: its timers and frames run only when the test moves the clock or draws a frame. */
  type Due = { id: number; at: number; fn: () => void };
  const page = { now: 0, ids: 0, timers: [] as Due[], frames: [] as { id: number; fn: () => void }[], writes: [] as string[] };
  const disk = new Map<string, string>();
  const storage = {
    getItem: (k: string): string | null => disk.get(k) ?? null,
    setItem: (k: string, v: string): void => { disk.set(k, v); if (k === 'hunter-system-v4') page.writes.push(v); },
    removeItem: (k: string): void => { disk.delete(k); },
    key: (i: number): string | null => [...disk.keys()][i] ?? null,
    get length(): number { return disk.size; },
  };
  const g = globalThis as unknown as Record<string, unknown>;
  const real = { setTimeout: g.setTimeout, clearTimeout: g.clearTimeout };
  /** Moves the clock to `t`, running each timer that falls due on the way, in order. */
  const advance = (t: number): void => {
    for (;;) {
      const next = page.timers.filter(d => d.at <= t).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      page.timers = page.timers.filter(d => d !== next);
      page.now = next.at; next.fn();
    }
    page.now = t;
  };
  /** The browser draws a frame: each frame callback asked for runs, then the tasks it set for now. */
  const drawFrame = (): void => { const fs = page.frames; page.frames = []; fs.forEach(f => f.fn()); advance(page.now); };

  test('a change is written once, after the frame that shows it; a wait left from an earlier change never writes a later one before its frame (SMX-sync-9.1)', async () => {
    Object.assign(g, {
      localStorage: storage, sessionStorage: storage,
      document: { visibilityState: 'visible', addEventListener: () => {} },
      addEventListener: () => {},
      requestAnimationFrame: (fn: () => void): number => { const id = ++page.ids; page.frames.push({ id, fn }); return id; },
      cancelAnimationFrame: (id: number): void => { page.frames = page.frames.filter(f => f.id !== id); },
      setTimeout: (fn: () => void, ms = 0): number => { const id = ++page.ids; page.timers.push({ id, at: page.now + ms, fn }); return id; },
      clearTimeout: (id: number): void => { page.timers = page.timers.filter(d => d.id !== id); },
    });
    try {
      const { store } = await import('../src/edge/store.ts');
      expect(page.writes.length, 'a ready tab writes its save as it opens').toBe(1);
      const edit = (name: string): void => store.update(s => { s.hunters[0]!.name = name; });
      const written = (): string | undefined => page.writes.length ? JSON.parse(page.writes[page.writes.length - 1]!).hunters[0].name : undefined;

      edit('First');
      expect(page.writes.length, 'nothing is written in the tap\'s own task').toBe(1);
      drawFrame();
      expect(page.writes.length).toBe(2);
      expect(written()).toBe('First');

      advance(995);
      edit('Second');
      advance(1000);
      expect(page.writes.length, 'the first change\'s second-long fallback is gone with its write: the second change waits for its frame').toBe(2);
      drawFrame();
      expect(page.writes.length).toBe(3);
      expect(written()).toBe('Second');

      advance(5000);
      expect(page.writes.length, 'nothing is left to write once the change is written').toBe(3);
      expect(page.timers).toEqual([]);

      edit('Hidden');
      advance(6000);
      expect(page.writes.length, 'a page that draws no frame writes a second after the change').toBe(4);
      expect(written()).toBe('Hidden');
      drawFrame();
      expect(page.writes.length, 'and the frame that comes later writes nothing more').toBe(4);
      expect(store.life()).toEqual({ at: 'ready', write: 'clean' });
    } finally {
      Object.assign(g, real);
    }
  });
});
