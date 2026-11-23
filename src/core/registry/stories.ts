// registry/stories.ts: the two stories a GM copies in the Workshop ("Stories to copy"), taken from the ideas file
// (docs/agent-handoff/features/ideas-2-imaginative.md section 7) as examples of what a story holds: a chapter of words
// alone, a chapter opened again, a cost that comes due, a branch as two chapters, a quest, a boon and a title. A story
// is never turned on as it ships: the GM copies one into the library (Duplicate) and changes it there. Where the ideas
// file asks the table a question ("take the bet or refuse"), the chapter's note tells the GM what to ask and which chapter
// to open after the answer. tests/story.test.ts reads every entry back through `parseStory`. To add one: an entry here.
import { newRewards } from '../rewards.ts';
import type { Rewards } from '../rewards.ts';
import type { Chapter, StoryTemplate } from '../story/story.ts';

const reward = (r: Partial<Rewards>): Rewards => ({ ...newRewards(), ...r });
const chapter = (c: Partial<Chapter> & Pick<Chapter, 'name' | 'words'>): Chapter => ({ rewards: newRewards(), quest: null, note: '', ...c });

/** A story to copy: a key no other holds, and the story as it is copied into the library. */
export type ExampleStory = { readonly key: string; readonly story: StoryTemplate };

export const EXAMPLE_STORIES: readonly ExampleStory[] = [
  // C08 The wager
  {
    key: 'wager',
    story: {
      name: 'The wager', when: 'The hunter brags, or wins a coin call they should have lost.', for: 'hunters',
      chapters: [
        chapter({
          name: 'The bet', words: { title: 'THE SYSTEM WILL TAKE THAT BET', line: 'The System bets that you will not win your next three solo runs.' },
          note: 'Ask the player to take the bet, with 1 ability point staked on each run, or to refuse. If they refuse, end the story.',
        }),
        chapter({
          name: 'The runs', words: { title: 'THE SYSTEM IS WATCHING THE NUMBERS', line: 'You lost a solo run. The System takes the stake.' },
          rewards: reward({ points: -1 }),
          note: 'Open this chapter after each solo run the hunter loses to remove 1 ability point. After three solo run wins, open chapter 3. After a loss, you may open chapter 4.',
        }),
        chapter({
          name: 'Won', words: { title: 'THE SYSTEM PAYS', line: 'You won three solo runs.' },
          rewards: reward({ points: 5, title: { name: 'Beat the House', desc: 'Won a bet against the System.', bonus: { ins: 2 } } }),
          note: 'Then end the story.',
        }),
        chapter({
          name: 'Lost', words: { title: 'THE HOUSE KEEPS THE STAKE. DOUBLE OR NOTHING', line: 'The System offers one more solo run for twice the stake.' },
          note: 'Ask the player if they want to run once more. If they win, send a System broadcast that says the System lost the bet. If they lose, open chapter 2 twice. Then end the story.',
        }),
      ],
    },
  },
  // C04 What was spared returns
  {
    key: 'spared',
    story: {
      name: 'What was spared returns', when: 'The hunter spares a foe that can speak.', for: 'hunters',
      chapters: [
        chapter({
          name: 'Let go', words: { title: 'IT WILL REMEMBER YOUR FACE', line: '' },
          note: 'Write down the foe. If it gave its name, put the name in this window\'s line.',
        }),
        chapter({
          name: 'Rumor', words: { title: 'SOMETHING YOU SPARED HAS BEEN SEEN', line: '' },
          quest: { kind: 'side', title: 'Find it', desc: '', objectives: [{ label: 'Find the foe you spared', target: 1, progress: 0 }], rewards: newRewards(), onFail: newRewards(), dueHours: null, penaltyText: '' },
          note: 'Put roughly where it was seen in this window\'s line.',
        }),
        chapter({
          name: 'The meeting', words: { title: 'IT IS HERE', line: 'The foe you spared is in this gate.' },
          note: 'Ask the hunter, in the scene, to fight, talk or leave. You decide what the foe wants. If it takes the hunter\'s side, open chapter 4. If the hunter lets it go again, open chapter 5.',
        }),
        chapter({
          name: 'An ally', words: { title: 'IT CHOSE YOUR SIDE', line: 'The foe you spared will help you once.' },
          rewards: reward({ boons: [{ name: 'A Monster\'s Favor', text: 'Once, monsters of the foe\'s type ignore you for one fight.' }] }),
        }),
        chapter({
          name: 'A second mercy', words: { title: 'YOU LET IT GO TWICE', line: 'The foe you spared is free again. Give it a name.' },
          rewards: reward({ title: { name: 'The Spared One\'s Shadow', desc: 'The GM may bring back a foe you spared in any gate. You cannot refuse to meet it.', bonus: { ins: 2 } } }),
        }),
      ],
    },
  },
];
