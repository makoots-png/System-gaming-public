// intro-cards.ts: the 17 world-primer intro cards (title + 16 story cards) and the pure primer text cutter.
// WORLD_PRIMER in src/core/first-run.ts stays the single source of every read-aloud sentence: each story card names
// its 1-based paragraph and verbatim opening phrase, and slicePrimer cuts the paragraph at those openings.
import { WORLD_PRIMER } from './first-run.ts';
import { builtInItemId } from './ids.ts';
import type { ItemDefId } from './ids.ts';
import type { Rank, Rules } from './rules.ts';
import { capDisplayLevel } from './hunter/progress.ts';
import { resolveDef } from './registry/item-book.ts';
import { valueOf } from './registry/items.ts';
import { itemIcon } from './registry/icon-defaults.ts';

export type IntroCardKind = 'title' | 'art' | 'type' | 'window';
export type IntroAccent = 'red' | 'blue' | 'none';
export type IntroWindowId = 'title' | 'cities' | 'ranks' | 'shop' | 'resident' | 'hunter' | 'food' | 'call';

export type IntroCard =
  | {
      readonly index: 0;
      readonly paragraph: null;
      readonly opening: null;
      readonly kind: 'title';
      readonly window: 'title';
      readonly label: string;
      readonly accent: 'blue';
      readonly image: null;
      readonly alt: string;
    }
  | {
      readonly index: number;
      readonly paragraph: number;
      readonly opening: string;
      readonly kind: 'art';
      readonly window: null;
      readonly label: string;
      readonly accent: IntroAccent;
      readonly image: string;
      readonly alt: string;
    }
  | {
      readonly index: number;
      readonly paragraph: number;
      readonly opening: string;
      readonly kind: 'type' | 'window';
      readonly window: Exclude<IntroWindowId, 'title'>;
      readonly label: string;
      readonly accent: IntroAccent;
      readonly image: null;
      readonly alt: string;
    };

export type IntroSlice = {
  readonly paragraph: number;
  readonly before: string;
  readonly current: string;
  readonly raw: string;
  readonly after: string;
};

/** Relative static path under public/ where the 9 WebP art cards live (2,156,104 bytes total, ~2.06 MiB; each under 250 KiB). */
export const INTRO_IMAGE_DIR = 'intro/primer/';
/** True once the 9 WebP art cards are in public/intro/primer/; art cards render images over their type-only stand-in fallback. */
export const INTRO_ART_READY = true;

/** The 17 intro cards in table order: card 0 (title) followed by 16 story cards covering WORLD_PRIMER paragraphs 1 to 10. */
export const INTRO_CARDS: readonly IntroCard[] = [
  {
    index: 0,
    paragraph: null,
    opening: null,
    kind: 'title',
    window: 'title',
    label: 'World primer',
    accent: 'blue',
    image: null,
    alt: 'The Hunter System: World primer',
  },
  {
    index: 1,
    paragraph: 1,
    opening: 'About twenty years ago',
    kind: 'art',
    window: null,
    label: 'London',
    accent: 'red',
    image: 'p1-london-gate.webp',
    alt: 'An enormous black gate with a red glowing rim standing over London while people on a bridge look up.',
  },
  {
    index: 2,
    paragraph: 1,
    opening: 'The governments of the world',
    kind: 'art',
    window: null,
    label: 'First teams in',
    accent: 'red',
    image: 'p1-teams.webp',
    alt: 'Eight soldiers in heavy gear walking toward the towering black London gate past dead robots and a fallen camera.',
  },
  {
    index: 3,
    paragraph: 2,
    opening: 'Seven days later',
    kind: 'art',
    window: null,
    label: 'Day 7',
    accent: 'red',
    image: 'p2-break.webp',
    alt: 'A titanic wingless land dragon climbing out of the red-rimmed London gate above the skyscrapers.',
  },
  {
    index: 4,
    paragraph: 2,
    opening: 'Over the next five days',
    kind: 'art',
    window: null,
    label: '97%',
    accent: 'red',
    image: 'p2-boats.webp',
    alt: 'Crowded ferry passengers looking back across the river at a burning London skyline and the distant dragon.',
  },
  {
    index: 5,
    paragraph: 3,
    opening: 'Then gates started opening elsewhere.',
    kind: 'type',
    window: 'cities',
    label: '7 days',
    accent: 'none',
    image: null,
    alt: '7 days: Shanghai, San Francisco, Tokyo, Melbourne, Madrid.',
  },
  {
    index: 6,
    paragraph: 3,
    opening: 'We tried to fight',
    kind: 'art',
    window: null,
    label: 'New York',
    accent: 'none',
    image: 'p3-flash.webp',
    alt: 'People at a highway guardrail watching a huge white blast rise behind a distant coastal city.',
  },
  {
    index: 7,
    paragraph: 4,
    opening: 'Around that same time',
    kind: 'art',
    window: null,
    label: 'Three days',
    accent: 'blue',
    image: 'p4-fever.webp',
    alt: 'A person sitting on an unmade bed at dawn with a faint blue glow along their back and arms.',
  },
  {
    index: 8,
    paragraph: 4,
    opening: 'It still happens',
    kind: 'art',
    window: null,
    label: '1 in 500',
    accent: 'blue',
    image: 'p4-fight.webp',
    alt: 'A hunter from behind holding a glowing blue blade facing a truck-sized monster in a ruined street.',
  },
  {
    index: 9,
    paragraph: 5,
    opening: 'New gates are still popping up',
    kind: 'window',
    window: 'ranks',
    label: 'Gate ranks',
    accent: 'blue',
    image: null,
    alt: 'System window for gate ranks E through S.',
  },
  {
    index: 10,
    paragraph: 6,
    opening: "There's something people call the System",
    kind: 'window',
    window: 'shop',
    label: 'Shop',
    accent: 'blue',
    image: null,
    alt: 'System shop window listing Health Potion and Resurrection Crystal.',
  },
  {
    index: 11,
    paragraph: 7,
    opening: 'Regular people have the System too.',
    kind: 'window',
    window: 'resident',
    label: 'Resident',
    accent: 'blue',
    image: null,
    alt: 'System window for a level 0 resident with a Shop button.',
  },
  {
    index: 12,
    paragraph: 7,
    opening: "A hunter's window lists",
    kind: 'window',
    window: 'hunter',
    label: 'Hunter',
    accent: 'blue',
    image: null,
    alt: 'System window for a hunter listing level, quests, rank, and cap.',
  },
  {
    index: 13,
    paragraph: 8,
    opening: 'Like I said, these days',
    kind: 'art',
    window: null,
    label: 'Today',
    accent: 'blue',
    image: 'p8-city.webp',
    alt: 'A busy night street lit by blue crystal street lamps and a passing tram while people walk calmly.',
  },
  {
    index: 14,
    paragraph: 8,
    opening: 'At this point',
    kind: 'window',
    window: 'food',
    label: 'Shop',
    accent: 'blue',
    image: null,
    alt: 'System shop window listing fresh veggies, cup noodles, and a gourmet meal.',
  },
  {
    index: 15,
    paragraph: 9,
    opening: 'Guilds control most of the gates',
    kind: 'art',
    window: null,
    label: 'Guild gate',
    accent: 'blue',
    image: 'p9-cordon.webp',
    alt: 'A small blue-rimmed gate inside a fenced industrial lot with two guards and a lone figure lifting the fence.',
  },
  {
    index: 16,
    paragraph: 10,
    opening: 'You just got the call',
    kind: 'window',
    window: 'call',
    label: 'The call',
    accent: 'blue',
    image: null,
    alt: 'System window titled The call.',
  },
];

export const INTRO_CARD_COUNT = INTRO_CARDS.length;
export const INTRO_STORY_COUNT = INTRO_CARD_COUNT - 1;

/** Display counter for card `index`: "Title" on card 0, "N / 16" on cards 1 to 16. */
export const introCardCounter = (index: number): string =>
  (index <= 0 ? 'Title' : `${index} / ${INTRO_STORY_COUNT}`);

/** Relative static path for an art card's image, or null for non-art cards. */
export const introImagePath = (card: IntroCard): string | null =>
  (card.image === null ? null : `${INTRO_IMAGE_DIR}${card.image}`);

/** Relative static path for the card immediately after `index` when it is an art card and art is ready, for preloading. */
export function introNextImagePath(index: number): string | null {
  if (!INTRO_ART_READY) return null;
  const next = INTRO_CARDS[index + 1];
  return next ? introImagePath(next) : null;
}

/**
 * Cuts `primer` paragraphs at each story card's `opening` phrase, returning a map from card index to its slice.
 * Throws if any opening phrase is missing, out of order, or fails to start a paragraph at index 0.
 */
export function slicePrimer(
  cards: readonly IntroCard[] = INTRO_CARDS,
  primer: readonly string[] = WORLD_PRIMER,
): ReadonlyMap<number, IntroSlice> {
  const byPara = new Map<number, Extract<IntroCard, { paragraph: number }>[]>();
  for (const card of cards) {
    if (card.paragraph === null) continue;
    const list = byPara.get(card.paragraph) ?? [];
    list.push(card);
    byPara.set(card.paragraph, list);
  }
  const out = new Map<number, IntroSlice>();
  for (const [para, group] of byPara) {
    const full = primer[para - 1];
    if (full === undefined) throw new Error(`intro-cards: paragraph ${para} is out of range`);
    const starts: number[] = [];
    for (let i = 0; i < group.length; i++) {
      const card = group[i]!;
      const from = i === 0 ? 0 : starts[i - 1]! + 1;
      const at = full.indexOf(card.opening, from);
      if (at < 0) throw new Error(`intro-cards: opening not found for card ${card.index}: "${card.opening}"`);
      if (i === 0 && at !== 0) throw new Error(`intro-cards: first card ${card.index} of paragraph ${para} must start at index 0`);
      starts.push(at);
    }
    for (let i = 0; i < group.length; i++) {
      const card = group[i]!;
      const start = starts[i]!;
      const end = i + 1 < group.length ? starts[i + 1]! : full.length;
      const raw = full.slice(start, end);
      out.set(card.index, {
        paragraph: para,
        before: full.slice(0, start),
        current: raw.trim(),
        raw,
        after: full.slice(end),
      });
    }
  }
  return out;
}

const PRIMER_SLICES = slicePrimer();

/** The WORLD_PRIMER slice for card `index`, or null for card 0 (title). */
export const introSliceOf = (index: number): IntroSlice | null => PRIMER_SLICES.get(index) ?? null;

/** Cities listed on Card 5 in primer order. */
export const INTRO_CITIES = ['Shanghai', 'San Francisco', 'Tokyo', 'Melbourne', 'Madrid'] as const;

/** Built-in shop items shown on Card 10, resolved live against the active rules. */
export const INTRO_SHOP_ITEM_IDS: readonly ItemDefId[] = [
  builtInItemId('health-potion-e'),
  builtInItemId('resurrection-crystal-e'),
];

/** Food examples shown on Card 14. */
export const INTRO_FOOD_ITEMS = ['Fresh veggies', 'Cup noodles', 'Gourmet meal'] as const;

export type IntroShopRow = {
  readonly defId: ItemDefId;
  readonly name: string;
  readonly icon: ReturnType<typeof itemIcon>;
  readonly rar: string;
  readonly price: number;
};

/** Resolves the real app shop item names, icons, and prices for Card 10 under `R`. */
export function introShopRows(R: Rules): IntroShopRow[] {
  const rows: IntroShopRow[] = [];
  for (const defId of INTRO_SHOP_ITEM_IDS) {
    const def = resolveDef(defId, R);
    if (!def) continue;
    rows.push({
      defId,
      name: def.name,
      icon: itemIcon(def),
      rar: def.rar,
      price: valueOf(def, R),
    });
  }
  return rows;
}

export type IntroHunterSample = {
  readonly level: number;
  readonly quests: string;
  readonly rank: Rank;
  readonly cap: number;
};

/** Beat 1 default values for Card 12's Hunter System window under `R`. */
export const introHunterWindow = (R: Rules): IntroHunterSample => ({
  level: 1,
  quests: '1 active',
  rank: 'E',
  cap: capDisplayLevel('E', R) ?? 9,
});

