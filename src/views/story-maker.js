// story-maker.js: the GM's story maker (notes-1-stories.md section 6), opened from the Workshop's Stories. One form
// through `app.api.maker.open`: the story's name, when to turn it on, who it is for, then its chapters as a list with one
// chapter open at a time under its line: its name, its window's title and line, the GM's note, its reward (the reward
// editor) and, when "Issues a quest" is ticked, its quest (the one quest form, app.api.quests.fields). The chapters are
// held as data; opening another chapter reads the open one into the list first, so the page has one chapter's editors
// at a time, and a chapter does not close while its reward editor would drop a row (`mayClose`). Save runs `parseStory` and writes what it gives back (`saveEntry`); the maker refuses first what the parser
// would drop (a chapter without a window title, a quest without a title) and a chapter too large to send. No rule of the
// game is here.
import { esc, field, wrote } from './ui.js';
import { CHAPTERS_MAX, CHAPTER_MAX, STORY_BOUNDS, chapterSize, parseStory, storyLines } from '../core/story/story.ts';
import { UNFINISHED_ROWS, WORDS_BOUNDS, newRewards } from '../core/rewards.ts';
import { saveEntry, savedWords } from '../core/library.ts';
import { atLibrary } from '../core/save-step.ts';

const FOR = [['table', 'The table'], ['hunters', 'Chosen hunters']];
const CSS = `
.stm-chs{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.stm-ch{border:1px solid var(--line);background:rgba(10,26,46,.55);min-width:0}
.stm-ch.open{border-color:var(--line-bright)}
.stm-line{width:100%;min-height:var(--control-h);text-align:left;justify-content:flex-start;background:none;border:0;box-shadow:none;padding:8px 12px;font:inherit;letter-spacing:normal;text-transform:none;color:inherit;overflow-wrap:anywhere}
.stm-line::before{content:'▸ ';color:var(--cyan)}.stm-ch.open .stm-line::before{content:'▾ '}
.stm-chb{display:flex;flex-direction:column;gap:10px;padding:0 10px 10px;min-width:0}
.stm-chb textarea{width:100%;box-sizing:border-box;resize:vertical;min-height:60px}
.stm-hint{margin:0;font-size:13px;color:var(--cyan-dim)}
.stm-acts{display:flex;gap:6px;flex-wrap:wrap}.stm-acts button{flex:1 1 auto;min-height:var(--control-h)}
`;

/** A new chapter: a window title to write and nothing else. */
const blankChapter = () => ({ name: '', words: { title: '', line: '' }, rewards: newRewards(), quest: null, note: '' });
/** A new chapter quest: the quest form's fields, empty. */
const blankQuest = () => ({ kind: 'side', title: '', desc: '', objectives: [], rewards: newRewards(), dueHours: null, penaltyText: '' });
/** A chapter's quest as the quest form answers it, with the fields a chapter keeps. */
const chapterQuestOf = v => ({ kind: v.kind, title: v.title, desc: v.desc, objectives: v.objectives, rewards: v.rewards, dueHours: v.dueHours, penaltyText: v.penaltyText });

/**
 * The story maker for library story `story`, or a new one when null. Answers the id it saved under, or null.
 * @param {import('./app.ts').App} app @param {import('../core/story/story.ts').Story | null} story
 */
export function storyMaker(app, story) {
  const A = app.api, store = app.store;
  app.ui.css('story-maker', CSS);
  return A.maker.open({
    tag: 'Workshop', title: story ? `Edit ${story.name}` : 'New story', save: 'Save story', cls: 'stm',
    build(body, shell) {
      /** @type {any[]} the chapters as the form holds them, in order; the open one is read from its fields by `current` */
      const chapters = story ? story.chapters.map(c => ({ ...c })) : [blankChapter()];
      /** the open chapter's place in `chapters`, or -1 when every chapter is folded */
      let open = 0;
      /** @type {import('../core/api.ts').RewardEditor | null} the open chapter's reward editor */
      let rewards = null;
      /** @type {import('../core/api.ts').QuestFields | null} the open chapter's quest form, while "Issues a quest" is ticked */
      let quest = null;
      body.innerHTML = `${field('Name', `<input type="text" id="stm-name" maxlength="${STORY_BOUNDS.name}" autocomplete="off" value="${esc(story ? story.name : '')}">`)}
        ${field('When to turn it on (only you see this)', `<input type="text" id="stm-when" maxlength="${STORY_BOUNDS.when}" autocomplete="off" value="${esc(story ? story.when : '')}">`)}
        <div class="lbl">For</div>${A.maker.chips('for', FOR, story ? story.for : 'table', { label: 'For' })}
        <div class="lbl">Chapters</div><ol class="stm-chs" data-chs></ol>
        <button type="button" data-chadd>Add a chapter</button>`;
      const $ = sel => body.querySelector(sel);

      /** A chapter's line: its number, its name and its window title. */
      const lineOf = (c, i) => `${i + 1}. ${[c.name.trim(), c.words.title.trim().toUpperCase()].filter(Boolean).join(' · ') || 'No window title yet'}`;
      function chapterHtml(c, i) {
        const on = i === open;
        return `<li class="stm-ch${on ? ' open' : ''}" data-ch="${i}"><button type="button" class="stm-line" data-chopen="${i}" aria-expanded="${on}">${esc(lineOf(c, i))}</button>${on ? `<div class="stm-chb">
          ${field('Chapter name (only you see this)', `<input type="text" id="stm-cname" maxlength="${STORY_BOUNDS.chapterName}" autocomplete="off" value="${esc(c.name)}">`)}
          ${field('Window title', `<input type="text" id="stm-wtitle" maxlength="${WORDS_BOUNDS.title}" autocomplete="off" value="${esc(c.words.title)}">`)}
          ${field('What the players read', `<input type="text" id="stm-wline" maxlength="${WORDS_BOUNDS.line}" autocomplete="off" value="${esc(c.words.line)}">`)}
          ${field('Note for you (only you see this)', `<textarea id="stm-note" rows="2" maxlength="${STORY_BOUNDS.note}">${esc(c.note)}</textarea>`)}
          <p class="stm-hint">What to ask the table, or when you think this chapter is done.</p>
          <div class="lbl">Reward</div><div data-stm-rw></div>
          <label class="field chk"><input type="checkbox" id="stm-hasq"${c.quest ? ' checked' : ''}><span>Issues a quest</span></label>
          <div data-stm-q></div>
          <div class="stm-acts"><button type="button" data-chup${i === 0 ? ' disabled' : ''}>Move up</button><button type="button" data-chdown${i === chapters.length - 1 ? ' disabled' : ''}>Move down</button>
            <button type="button" class="danger" data-chrm${chapters.length === 1 ? ' disabled' : ''}>Remove</button></div></div>` : ''}</li>`;
      }
      /** The open chapter as its fields hold it now. */
      function current() {
        const c = chapters[open];
        return {
          name: $('#stm-cname').value, words: { title: $('#stm-wtitle').value, line: $('#stm-wline').value }, note: $('#stm-note').value,
          rewards: rewards ? rewards.value() : c.rewards, quest: $('#stm-hasq').checked ? (quest ? chapterQuestOf(quest.value()) : c.quest || blankQuest()) : null,
        };
      }
      /** The chapters with the open one read from its fields. */
      const allChapters = () => chapters.map((c, i) => (i === open ? current() : c));
      /** The open chapter read into the list, before the list is drawn again. */
      const keep = () => { if (open >= 0) chapters[open] = current(); };
      function draw(focus) {
        $('[data-chs]').innerHTML = chapters.map(chapterHtml).join('');
        rewards = null; quest = null;
        if (open >= 0) {
          const c = chapters[open];
          rewards = A.maker.rewards($('[data-stm-rw]'), { id: 'stm', initial: c.rewards });
          if (c.quest) quest = A.quests.fields($('[data-stm-q]'), { id: 'stq', use: 'chapter', role: 'gm', initial: c.quest });
        }
        $('[data-chadd]').disabled = chapters.length >= CHAPTERS_MAX;
        shell.error('');
        if (focus) { const f = $(focus); if (f) f.focus(); }
        shell.changed();
      }
      /** The form as raw data, for the parser. */
      const raw = () => ({ name: $('#stm-name').value, when: $('#stm-when').value, for: A.maker.picked(body, 'for') || 'table', chapters: allChapters() });
      /** What stops a save, in the maker's words, and the chapter it is about; null when nothing does. */
      function problem(r) {
        if (!r.name.trim()) return { why: 'Name the story.', at: -1 };
        for (const [i, c] of r.chapters.entries()) {
          if (!c.words.title.trim()) return { why: `Give chapter ${i + 1} a window title.`, at: i };
          if (c.quest && !c.quest.title.trim()) return { why: `Give chapter ${i + 1}'s quest a title.`, at: i };
        }
        const read = parseStory(r);
        const big = read ? read.chapters.findIndex(c => chapterSize(c) > CHAPTER_MAX) : -1;
        return big >= 0 ? { why: `Chapter ${big + 1} is too large to send to players' phones. Give it fewer items.`, at: big } : null;
      }

      /**
       * Whether the open chapter may close (another chapter opened, its own line folded, a chapter added or moved): not
       * while its reward editor or its quest's would drop a row (`blocked()`, the editor's own answer), which the maker
       * says, so a half-written row is never lost without the GM being told. Remove drops the whole chapter on purpose.
       */
      function mayClose() {
        const unfinished = !!(rewards && rewards.blocked()) || !!(quest && quest.rewards && quest.rewards.blocked());
        if (unfinished) shell.error(UNFINISHED_ROWS);
        return !unfinished;
      }

      body.addEventListener('click', e => {
        const b = /** @type {Element} */ (e.target).closest('button'); if (!b || !body.contains(b) || b.closest('[data-stm-rw], [data-stm-q]')) return;
        if (b.hasAttribute('data-chrm') && chapters.length > 1) { chapters.splice(open, 1); open = -1; draw(); return; }
        const to = b.hasAttribute('data-chup') ? open - 1 : b.hasAttribute('data-chdown') ? open + 1 : null;
        const moves = b.hasAttribute('data-chopen') || (b.hasAttribute('data-chadd') && chapters.length < CHAPTERS_MAX) || (to !== null && to >= 0 && to < chapters.length);
        if (!moves || !mayClose()) return;
        keep();
        if (b.hasAttribute('data-chopen')) { const i = Number(b.dataset.chopen); open = open === i ? -1 : i; draw(open >= 0 ? '#stm-wtitle' : null); return; }
        if (b.hasAttribute('data-chadd')) { chapters.push(blankChapter()); open = chapters.length - 1; draw('#stm-wtitle'); return; }
        if (to !== null) { [chapters[open], chapters[to]] = [chapters[to], chapters[open]]; open = to; draw(); }
      });
      // the box draws or takes away the quest form alone: the chapter's reward editor, and what it holds, stay as they are
      body.addEventListener('change', e => {
        const t = /** @type {Element} */ (e.target); if (t.id !== 'stm-hasq') return;
        const box = $('[data-stm-q]');
        if ($('#stm-hasq').checked) { quest = A.quests.fields(box, { id: 'stq', use: 'chapter', role: 'gm', initial: chapters[open].quest || blankQuest() }); const f = $('[data-stm-q] [name=title]'); if (f) f.focus(); }
        else { quest = null; box.replaceChildren(); }
        shell.changed();
      });
      body.addEventListener('input', e => {
        const t = /** @type {Element} */ (e.target);
        if (open >= 0 && (t.id === 'stm-cname' || t.id === 'stm-wtitle')) { const l = $(`[data-chopen="${open}"]`); if (l) l.textContent = lineOf(current(), open); }
      });
      draw();
      $('[data-chs]').setAttribute('data-later', '');
      return {
        blocked: () => !!(rewards && rewards.blocked()) || !!(quest && quest.rewards && quest.rewards.blocked()),
        preview() { const r = raw(), p = problem(r); return p ? [p.why] : storyLines(/** @type {any} */ (parseStory(r)), app.rules()); },
        save() {
          keep();
          const r = raw(), p = problem(r);
          if (p) { if (p.at >= 0 && p.at !== open) { open = p.at; draw(); } shell.error(p.why); return undefined; }
          const why = quest ? quest.check() : '';
          if (why) { shell.error(`Chapter ${open + 1}'s quest: ${why}`); return undefined; }
          const t = /** @type {import('../core/story/story.ts').StoryTemplate} */ (parseStory(r)), id = story ? story.id : store.id('st');
          if (!wrote('Workshop', store.apply('library-story', atLibrary(l => saveEntry(l, 'stories', { ...t, id }))), savedWords('story', t.name))) return undefined;
          return id;
        },
      };
    },
  });
}
