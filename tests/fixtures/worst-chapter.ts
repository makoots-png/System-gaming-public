// worst-chapter.ts: the largest chapter a GM can save (story.ts `chapterSize` at exactly `CHAPTER_MAX`), every text in a
// script of three bytes a character, and the `chapter` message it makes for 24 players' hunters of 40-character keys,
// the room's most (notes-1-stories.md 4.2). tests/protocol.test.ts prints it by part and reads it back; tests/
// server-rooms.test.ts posts it through the server's handler.
import { CHAPTER_MAX, chapterBody, chapterSize, parseStory } from '../../src/core/story/story.ts';
import type { Chapter } from '../../src/core/story/story.ts';
import { ROOM_SHEETS } from '../../src/core/protocol.ts';
import { ITEM_BOUNDS, parseItem } from '../../src/core/registry/items.ts';
import { adhocGrant, itemDefDataOf } from '../../src/core/registry/item-book.ts';
import { REWARD_BOUNDS, WORDS_BOUNDS } from '../../src/core/rewards.ts';

/** `n` characters of three bytes each in UTF-8. */
export const wide = (n: number): string => 'ࠀ'.repeat(n);
/**
 * The heaviest item the reader takes, what makes a reward heavy: its texts at their bounds in three-byte characters and
 * as many notes of 200 such characters as its size in bytes allows (size.ts `THING_MAX.item`; one more and `parseItem`
 * refuses it whole).
 */
const fat = (notes: number) => parseItem({ name: wide(ITEM_BOUNDS.name), desc: wide(ITEM_BOUNDS.desc), effects: Array(notes).fill({ op: 'note', text: wide(200) }) });
// a reward gives an item as a grant (item sync PR 2): the heaviest is a player's own (ad hoc) item carried whole
const FAT = adhocGrant(itemDefDataOf(Array.from({ length: ITEM_BOUNDS.effects + 1 }, (_, i) => fat(ITEM_BOUNDS.effects - i)).find(it => it !== null)!));
/** A plain item with a description of 500 one-byte characters, for the bytes the heavy ones leave. */
const PLAIN = adhocGrant(itemDefDataOf(parseItem({ name: 'Pad', desc: 'a'.repeat(ITEM_BOUNDS.desc) })!));

/** The chapter with `items` split between its reward and its quest's reward, and a quest description of `desc`. */
function chapterOf(items: readonly unknown[], desc: string): Chapter {
  const n = REWARD_BOUNDS.items;
  const story = parseStory({ name: 'Worst', chapters: [{
    name: wide(60), note: wide(300), words: { title: wide(WORDS_BOUNDS.title), line: wide(WORDS_BOUNDS.line) },
    rewards: { xp: -1e9, gold: -1e9, points: -999, items: items.slice(0, n), title: { name: wide(60), desc: wide(200), bonus: {} } },
    quest: {
      kind: 'urgent', title: wide(120), desc, objectives: Array.from({ length: 10 }, () => ({ label: wide(80), target: 99999 })),
      rewards: { items: items.slice(n, 2 * n) }, dueHours: 999, penaltyText: wide(300),
    },
  }] });
  return story!.chapters[0]!;
}

/**
 * The worst chapter: heavy items while they fit, then plain ones, then the quest's description made of three-byte and
 * one-byte characters to the byte, so `chapterSize` is exactly `CHAPTER_MAX`.
 */
export function worstChapter(): Chapter {
  const items: unknown[] = [];
  for (const it of [FAT, PLAIN]) while (items.length < 2 * REWARD_BOUNDS.items && chapterSize(chapterOf([...items, it], '')) <= CHAPTER_MAX) items.push(it);
  const gap = CHAPTER_MAX - chapterSize(chapterOf(items, '')), w = Math.min(500, Math.floor(gap / 3));
  const c = chapterOf(items, wide(w) + 'a'.repeat(gap - 3 * w));
  if (chapterSize(c) !== CHAPTER_MAX) throw new Error(`the worst chapter is ${chapterSize(c)} bytes, not ${CHAPTER_MAX}`);
  return c;
}

/** The room's most sheet keys, each of 40 characters, the longest a key may be. */
export const KEYS = Array.from({ length: ROOM_SHEETS }, (_, i) => `d-${String(i).padStart(2, '0')}`.padEnd(30, 'p') + ':h99999999');
/** The worst chapter's message body for every key, opened at `at`. */
export const worstBody = (at: string) => ({ to: KEYS, ...chapterBody(worstChapter(), at) });
