import { readdir } from 'node:fs/promises';
import { describe, expect, test } from 'bun:test';
import { WORLD_PRIMER } from '../src/core/first-run.ts';
import { INTRO_CARD_MAX } from '../src/core/protocol.ts';
import { RULES, RANKS } from '../src/core/rules.ts';
import { capDisplayLevel } from '../src/core/hunter/progress.ts';
import {
  INTRO_ART_READY,
  INTRO_CARDS,
  INTRO_CARD_COUNT,
  INTRO_CITIES,
  INTRO_FOOD_ITEMS,
  INTRO_IMAGE_DIR,
  INTRO_STORY_COUNT,
  introCardCounter,
  introHunterWindow,
  introImagePath,
  introNextImagePath,
  introShopRows,
  introSliceOf,
  slicePrimer,
} from '../src/core/intro-cards.ts';
import { INITIAL_INTRO_UI, clampIntroCard, soloClose, soloOpen, soloStep } from '../src/core/intro.ts';

const LOCKED_ART_FILES = [
  'p1-london-gate.webp',
  'p1-teams.webp',
  'p2-break.webp',
  'p2-boats.webp',
  'p3-flash.webp',
  'p4-fever.webp',
  'p4-fight.webp',
  'p8-city.webp',
  'p9-cordon.webp',
];

describe('intro card list and WORLD_PRIMER slicing', () => {
  test('has 17 cards indexed 0..16 with title first and 9 locked art filenames', () => {
    expect(INTRO_CARD_COUNT).toBe(17);
    expect(INTRO_STORY_COUNT).toBe(16);
    expect(INTRO_CARDS.map(c => c.index)).toEqual(Array.from({ length: 17 }, (_, i) => i));
    expect(INTRO_CARDS[0]?.kind).toBe('title');
    expect(INTRO_CARDS[0]?.paragraph).toBeNull();
    expect(INTRO_CARDS[0]?.opening).toBeNull();
    expect(INTRO_ART_READY).toBe(true);

    const artCards = INTRO_CARDS.filter(c => c.kind === 'art');
    expect(artCards.map(c => c.image)).toEqual(LOCKED_ART_FILES);
    for (const c of artCards) {
      expect(introImagePath(c)).toBe(`${INTRO_IMAGE_DIR}${c.image}`);
      expect(c.alt.trim().length).toBeGreaterThan(10);
    }
    for (const c of INTRO_CARDS) {
      if (c.kind !== 'art') {
        expect(c.image).toBeNull();
        expect(introImagePath(c)).toBeNull();
        expect(c.window).not.toBeNull();
      }
      expect(c.label.trim().length).toBeGreaterThan(0);
      expect(c.alt.trim().length).toBeGreaterThan(0);
    }
  });

  test('every WORLD_PRIMER paragraph is covered and each paragraph slices join back identically', () => {
    const slices = slicePrimer(INTRO_CARDS, WORLD_PRIMER);
    expect(slices.size).toBe(INTRO_STORY_COUNT);
    expect(introSliceOf(0)).toBeNull();

    const byPara = new Map<number, string[]>();
    for (const card of INTRO_CARDS) {
      if (card.paragraph === null) continue;
      const slice = slices.get(card.index);
      expect(slice).toBeDefined();
      expect(slice!.paragraph).toBe(card.paragraph);
      expect(slice!.current.startsWith(card.opening)).toBe(true);
      expect(`${slice!.before}${slice!.raw}${slice!.after}`).toBe(WORLD_PRIMER[card.paragraph - 1]!);
      const parts = byPara.get(card.paragraph) ?? [];
      parts.push(slice!.raw);
      byPara.set(card.paragraph, parts);
    }

    expect([...byPara.keys()].sort((a, b) => a - b)).toEqual(
      Array.from({ length: WORLD_PRIMER.length }, (_, i) => i + 1),
    );
    for (let p = 1; p <= WORLD_PRIMER.length; p++) {
      expect(byPara.get(p)!.join('')).toBe(WORLD_PRIMER[p - 1]!);
    }
  });

  test('slicePrimer fails loudly if a primer edit breaks an opening phrase', () => {
    const edited = [...WORLD_PRIMER];
    edited[0] = edited[0]!.replace('The governments of the world', 'World leaders');
    expect(() => slicePrimer(INTRO_CARDS, edited)).toThrow(/opening not found/);
  });

  test('counter reads Title on card 0 and N / 16 on cards 1 to 16', () => {
    expect(introCardCounter(0)).toBe('Title');
    expect(introCardCounter(1)).toBe('1 / 16');
    expect(introCardCounter(5)).toBe('5 / 16');
    expect(introCardCounter(16)).toBe('16 / 16');
  });

  test('solo state transitions open, step within bounds, and close past card 16', () => {
    expect(INTRO_CARD_MAX).toBe(INTRO_STORY_COUNT);
    let s = soloOpen(INITIAL_INTRO_UI);
    expect(s.kind).toBe('solo');
    expect(s.soloCard).toBe(0);
    s = soloStep(s, -1);
    expect(s.soloCard).toBe(0);
    s = soloStep(s, 1);
    expect(s.soloCard).toBe(1);
    s = soloOpen(s, 16);
    expect(s.soloCard).toBe(16);
    s = soloStep(s, 1);
    expect(s.kind).toBe('off');
    expect(soloClose(soloOpen(INITIAL_INTRO_UI, 4)).kind).toBe('off');
    expect(clampIntroCard(-5)).toBe(0);
    expect(clampIntroCard(99)).toBe(16);
  });

  test('window and type card data pull real ranks, shop items, icons, prices, and Beat 1 hunter defaults', () => {
    expect(INTRO_CITIES).toEqual(['Shanghai', 'San Francisco', 'Tokyo', 'Melbourne', 'Madrid']);
    expect(INTRO_FOOD_ITEMS).toEqual(['Fresh veggies', 'Cup noodles', 'Gourmet meal']);
    expect(RANKS).toEqual(['E', 'D', 'C', 'B', 'A', 'S']);

    const shop = introShopRows(RULES);
    expect(shop.map(r => r.name)).toEqual(['Health Potion (E)', 'Resurrection Crystal (E)']);
    expect(shop.map(r => r.icon)).toEqual(['potion', 'crystal']);
    for (const r of shop) expect(r.price).toBeGreaterThan(0);

    const hunter = introHunterWindow(RULES);
    expect(hunter).toEqual({
      level: 1,
      quests: '1 active',
      rank: 'E',
      cap: capDisplayLevel('E', RULES),
    });
    expect(hunter.cap).toBe(9);
  });

  test('all nine art WebPs exist in public/intro/primer/, match the card list, and stay under 250 KiB each', async () => {
    const dir = `${import.meta.dir}/../public/${INTRO_IMAGE_DIR}`;
    const files = (await readdir(dir)).filter(f => !f.startsWith('.')).sort();
    expect(files).toEqual([...LOCKED_ART_FILES].sort());

    const artCards = INTRO_CARDS.filter(c => c.kind === 'art');
    expect(artCards.map(c => c.image)).toEqual(LOCKED_ART_FILES);

    let totalBytes = 0;
    for (const card of artCards) {
      const path = `${import.meta.dir}/../public/${introImagePath(card)}`;
      const file = Bun.file(path);
      expect(await file.exists(), `missing art file ${path}`).toBe(true);
      const size = file.size;
      expect(size, `${card.image} must be non-empty`).toBeGreaterThan(0);
      expect(size, `${card.image} must stay under 250 KiB`).toBeLessThan(250 * 1024);
      totalBytes += size;
    }
    expect(totalBytes).toBeGreaterThan(1_000_000);
    expect(totalBytes).toBeLessThan(250 * 1024 * LOCKED_ART_FILES.length);
  });

  test('introNextImagePath returns the next card image only when the next card is an art card', () => {
    expect(introNextImagePath(0)).toBe('intro/primer/p1-london-gate.webp');
    expect(introNextImagePath(1)).toBe('intro/primer/p1-teams.webp');
    expect(introNextImagePath(4)).toBeNull(); // Card 5 is cities (type)
    expect(introNextImagePath(5)).toBe('intro/primer/p3-flash.webp');
    expect(introNextImagePath(8)).toBeNull(); // Card 9 is ranks (window)
    expect(introNextImagePath(12)).toBe('intro/primer/p8-city.webp');
    expect(introNextImagePath(14)).toBe('intro/primer/p9-cordon.webp');
    expect(introNextImagePath(15)).toBeNull(); // Card 16 is call (window)
    expect(introNextImagePath(16)).toBeNull(); // Past last card
  });

  test('type-only fallback markup and reduced-motion no-drift CSS rules stay intact', async () => {
    const introJs = await Bun.file(`${import.meta.dir}/../src/views/intro.js`).text();
    const css = await Bun.file(`${import.meta.dir}/../public/app.css`).text();
    expect(introJs).toContain('class="intro-standin');
    expect(introJs).toContain('data-art-state="fallback"');
    expect(introJs).toContain("addEventListener('error'");
    expect(css).toContain('.intro-art{position:absolute;inset:0;overflow:hidden;background:#111111;opacity:0;');
    expect(css).toContain('.intro-standin.is-loaded .intro-art{opacity:1}');
    expect(css).toContain('@keyframes m-intro-drift{from{transform:');
    expect(css).toContain('@media (prefers-reduced-motion:reduce)');
    expect(css).toContain('animation:none!important;transition:none!important');
  });
});
