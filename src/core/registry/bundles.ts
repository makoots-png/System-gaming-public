// bundles.ts: the bundles the app ships for the GM to give at the table when a player roleplays well (the owner, Nov 18:
// "Give me some that I should administer on my own when I see instances of roleplay"). Each is a bundle with the words
// of its System window (rewards.ts `SystemWords`), given from a hunter's card (gm.js, Give…) and remembered by the
// hunter's chronicle as a `given` fact (docs/agent-handoff/features/notes-1-feats.md section 7). They are given as they
// are; the Workshop's Duplicate makes an editable copy in the library. Grouped by the moment that earns them: the first
// shelf's ten moments and the second ideas list's (features/ideas-2-imaginative.md section 3, the awards it marks
// BUILDABLE TODAY; its A numbers in each entry's comment), merged into one list.
//
// Sizes keep to the balance the idea shelves read from the code (features/ideas-feats-titles-rewards.md section 1): a
// title is worth 1 point at E rank, 2 at D and C, 3 at B, 4 at A (10 max HP counts as a point); a daily is 25 XP and 1
// ability point. Most are small, so a GM can give one every session without moving the game's numbers: a line the System
// says (no reward), a one-use boon (text the GM honors, such as a held reroll), 1 ability point, or an E-rank title. A
// title given twice is given once (`grant` gives a title only when it is new), so a bundle with a title is worth giving
// again for its window and its fact. A few are marked rare: one an arc, for a moment the table will retell.
// To add one: an entry here (a `seed-` key no other holds, its moment, a few words of when, why its size is what it is),
// and `bun run test` (tests/bundles.test.ts reads every one).
import { grantLines, newRewards } from '../rewards.ts';
import type { RewardRules, RewardTitle, Rewards, SystemWords } from '../rewards.ts';
import { BONUS_KEYS, BONUS_LABELS, RULES } from '../rules.ts';
import { SHOP_ITEMS, itemOf, parseItem } from './items.ts';
import type { ItemTemplate } from './items.ts';

/** The moments an award for roleplay is for, in the order the shelf lists them. */
export const MOMENTS = ['hard', 'sacrifice', 'lie', 'kindness', 'speech', 'silence', 'rivalry', 'joke', 'spotlight', 'mind', 'owned', 'comic', 'goodbye', 'secret', 'promise', 'mercy', 'fear', 'any'] as const;
export type Moment = (typeof MOMENTS)[number];
/** Each moment's words: the shelf's heading and its chip. */
export const MOMENT_WORDS: { readonly [M in Moment]: string } = {
  hard: 'Stayed in character',
  sacrifice: 'Gave something up',
  lie: 'Told a good lie',
  kindness: 'Was kind at a cost',
  speech: 'Gave a speech',
  silence: 'Stayed silent',
  rivalry: 'Played a rivalry with another hunter',
  joke: 'Brought back an old joke',
  spotlight: 'Helped another player\'s moment',
  mind: 'Changed the hunter\'s mind',
  owned: 'Owned a failure',
  comic: 'Was funny',
  goodbye: 'Said goodbye',
  secret: 'Kept a secret',
  promise: 'Made or kept a promise',
  mercy: 'Showed mercy',
  fear: 'Played the hunter\'s fear',
  any: 'Anything else',
};
/** Each moment's chip on the shelf: a few words that fit a chip at 360 px. */
export const MOMENT_CHIPS: { readonly [M in Moment]: string } = {
  hard: 'Stayed in character', sacrifice: 'Gave something up', lie: 'Told a good lie', kindness: 'Was kind at a cost', speech: 'Gave a speech', silence: 'Stayed silent', rivalry: 'Rivalry',
  joke: 'Old joke', spotlight: 'Helped another player', mind: 'Changed its mind', owned: 'Owned a failure', comic: 'Was funny', goodbye: 'Said goodbye',
  secret: 'Kept a secret', promise: 'Promise', mercy: 'Showed mercy', fear: 'Was afraid', any: 'Anything else',
};

/**
 * A built-in bundle: its key (`seed-`, what its `given` fact records), the moment it is for, when to give it (a few
 * words the shelf shows under its name), whether it is rare, its name, its reward and its window.
 */
export type BuiltInBundle = {
  readonly key: string; readonly moment: Moment; readonly when: string; readonly rare: boolean; readonly name: string; readonly rewards: Rewards; readonly window: SystemWords;
};

const words = (title: string, line: string): SystemWords => ({ title, line });
/** Nothing but the window: the System said something. */
const nothing = (): Rewards => newRewards();
const points = (n: number, extra: Partial<Rewards> = {}): Rewards => ({ ...newRewards(), ...extra, points: n });
const xp = (n: number): Rewards => ({ ...newRewards(), xp: n });
const boon = (name: string, text: string, extra: Partial<Rewards> = {}): Rewards => ({ ...newRewards(), ...extra, boons: [{ name, text }] });
const title = (t: RewardTitle, extra: Partial<Rewards> = {}): Rewards => ({ ...newRewards(), ...extra, title: t });
/** The held reroll of the shelf: a d20 rolled again, once, the second kept. */
const REROLL = 'Once, roll one of your d20s again and keep the second roll.';
const HEALTH_POTION: ItemTemplate = itemOf(RULES, SHOP_ITEMS.find(d => d.name === 'Health Potion')!);
/** A31's item: worn, a status that gives its bearer a shield of a quarter of its max HP as each fight begins (a status's `shield` op lands with it). */
const PUNCHLINE: ItemTemplate = parseItem({
  name: 'The Punchline', rar: 'legendary', type: 'accessory', slot: 'neck', value: 0,
  desc: 'Given for a long-running joke that mattered in a serious scene. Worn, it gives you a shield as each fight begins.',
  worn: { label: 'The Punchline', desc: 'A shield of a quarter of max HP as the fight begins.', ops: [{ op: 'shield', amount: { kind: 'binary', op: '/', left: { kind: 'sheet', whose: 'user', key: 'hpMax' }, right: { kind: 'number', value: 4 } } }] },
})!;
/** A46's item: a thing exchanged at a goodbye, worth nothing to the shop. */
const KEEPSAKE: ItemTemplate = parseItem({ name: 'Keepsake', rar: 'common', type: 'material', value: 0, desc: 'Something given at a goodbye. Name it and write what it is.' })!;

type Entry = Omit<BuiltInBundle, 'rare'> & { readonly rare?: true };
const ENTRIES: readonly Entry[] = [
  // ── stayed in character ──
  // 1 ability point: a daily's worth, for staying in character in a hard scene
  { key: 'seed-held-the-mask', moment: 'hard', when: 'Stayed in character during a hard scene', name: 'Held the Mask', rewards: points(1), window: words('THE MASK HELD', 'You stayed in character during a hard scene. You get 1 ability point.') },
  // a held reroll: a boon spent once, at the player's choosing
  { key: 'seed-steady-under-weight', moment: 'hard', when: 'Stayed in character when things went badly for the hunter', name: 'Steady Under Weight', rewards: boon('Steady Under Weight', REROLL), window: words('THE SYSTEM SAW YOU STAY', 'You stayed in character when things went badly for your hunter. You get one reroll of a d20.') },
  // an E-rank title: 1 point (+1 Discipline)
  { key: 'seed-scar-tissue', moment: 'hard', when: 'Stayed in character through a very hard scene', name: 'Scar Tissue', rewards: title({ name: 'Scar Tissue', desc: 'Stayed in character through a very hard scene.', bonus: { dis: 1 } }), window: words('SOMETHING HARDENED', 'You stayed in character through a very hard scene. You get the title Scar Tissue.') },
  // A01 a one-use boon, a check passed once: small, and only against fear or despair
  { key: 'seed-no-seam', moment: 'hard', when: 'Played the hunter\'s fear, grief or pride for a whole scene', name: 'No Seam', rewards: boon('No Seam', 'Once, pass one check of fear or despair without rolling.'), window: words('THE SYSTEM COULD NOT FIND THE SEAM', 'You played your hunter\'s fear, grief or pride for a whole scene. Once, you may pass a check of fear or despair without rolling.') },
  // A02 1 ability point
  { key: 'seed-brought-it-home', moment: 'hard', when: 'Brought up a painful part of the hunter\'s past without being asked', name: 'Brought It Home', rewards: points(1), window: words('IT CAME WITH YOU', 'You brought up a painful part of your hunter\'s past without being asked. You get 1 ability point.') },
  // A03 an E-rank title: 1 point (+1 Instinct)
  { key: 'seed-second-skin', moment: 'hard', when: 'Chose what the hunter would do over what was best for the player', name: 'Second Skin', rewards: title({ name: 'Second Skin', desc: 'Chose what the hunter would do over what was best for the player.', bonus: { ins: 1 } }), window: words('WHICH OF YOU IS SPEAKING', 'You chose what your hunter would do over what was best for you. You get the title Second Skin.') },
  // A04 RARE: an A-rank title (4 points: +2 Discipline, +2 Presence), and the GM's skill for the trait (a boon he honors once)
  { key: 'seed-worn-smooth', moment: 'hard', rare: true, when: 'Played one trait for a whole arc, even when it cost the hunter', name: 'Worn Smooth', rewards: title({ name: 'Worn Smooth', desc: 'Played one trait for a whole arc, even when it cost the hunter.', bonus: { dis: 2, pre: 2 } }, { boons: [{ name: 'Your Trait', text: 'The GM writes a passive skill for the trait you played, and gives it to you.' }] }), window: words('THE ROLE HAS BECOME THE HUNTER', 'You played one trait for a whole arc, even when it cost your hunter. You get the title Worn Smooth, and the GM will write you a passive skill for that trait.') },

  // ── gave something up ──
  // 1 ability point
  { key: 'seed-took-the-cost', moment: 'sacrifice', when: 'Gave up something the hunter wanted so someone else could have it', name: 'Took the Cost', rewards: points(1), window: words('THE PRICE WAS NOTED', 'You gave up something your hunter wanted so someone else could have it. You get 1 ability point.') },
  // a one-use boon the GM honors: a favor, worth what the table makes of it, no number moves
  { key: 'seed-owed-one', moment: 'sacrifice', when: 'Did something for someone at a cost to the hunter', name: 'Owed One', rewards: boon('Owed One', 'The GM owes you one favor. Ask for it once, when you choose.'), window: words('A DEBT IS OPEN', 'You did something for someone at a cost to your hunter. The GM owes you one favor.') },
  // A05 a one-use boon: first pick of one loot roll
  { key: 'seed-weight-moved', moment: 'sacrifice', when: 'Gave an item or a share of loot to someone else', name: 'Weight Moved', rewards: boon('First Pick', 'At the next loot roll for your party, take one item before anyone else.'), window: words('THE SCALES MOVED', 'You gave an item or your share of loot to someone else. At the next loot roll, you pick one item first.') },
  // A06 a one-use boon: a shield of twice the level at one fight's start, which the GM puts on
  { key: 'seed-the-door', moment: 'sacrifice', when: 'Stayed behind to fight so the others could escape', name: 'The Door', rewards: boon('Doorframe', 'In your next fight, the GM gives you a shield of twice your level at its start.'), window: words('SOMEONE HAS TO BE THE DOOR', 'You stayed behind so the others could escape. In your next fight, the GM gives you a shield of twice your level at the start.') },
  // A07 1 ability point and a one-use boon: a consequence softened once
  { key: 'seed-paid-in-advance', moment: 'sacrifice', when: 'Chose a worse outcome for the hunter because it made a better story', name: 'Paid in Advance', rewards: points(1, { boons: [{ name: 'Credit', text: 'Once, ask the GM to soften one consequence, and he must.' }] }), window: words('PAYMENT RECEIVED BEFORE DELIVERY', 'You chose a worse outcome for your hunter because it made a better story. You get 1 ability point, and once you may ask the GM to soften one consequence.') },
  // RARE: 3 ability points and a B-rank title (3 points: +3 Vitality). One a campaign, for a sacrifice that changed it
  { key: 'seed-spent-for-others', moment: 'sacrifice', rare: true, when: 'Gave up something big that changed the campaign', name: 'Spent for Others', rewards: title({ name: 'Spent for Others', desc: 'Gave up something that could not be given back, for the others.', bonus: { vit: 3 } }, { points: 3 }), window: words('THE SYSTEM WILL NOT FORGET THIS', 'You gave up something that changed the campaign. You get 3 ability points and the title Spent for Others.') },
  // A08 RARE: a B-rank title (3 points: +2 Vitality, +1 Presence) and a Revive the GM promises (the Revive stays his, as the ruling says)
  { key: 'seed-ash-on-the-hands', moment: 'sacrifice', rare: true, when: 'Stayed behind at the risk of death so the others could get away', name: 'Ash on the Hands', rewards: title({ name: 'Ash on the Hands', desc: 'Stayed behind at the risk of its life so the others could get away.', bonus: { vit: 2, pre: 1 } }, { boons: [{ name: 'One Return', text: 'The GM will Revive you once, without a Resurrection Crystal.' }] }), window: words('THE SYSTEM WILL CARRY THIS ONE', 'You stayed behind at the risk of your life so the others could get away. You get the title Ash on the Hands, and the GM will Revive you once without a Resurrection Crystal.') },

  // ── told a good lie ──
  // nothing but the line: the lie was its own reward
  { key: 'seed-straight-face', moment: 'lie', when: 'Told a lie in character that the others believed', name: 'Straight Face', rewards: nothing(), window: words('THE SYSTEM BELIEVED YOU TOO', 'You told a lie in character, and the others believed it.') },
  // an E-rank title: 1 point (+1 Presence)
  { key: 'seed-silver-tongue', moment: 'lie', when: 'Told a lie in character that the whole table enjoyed', name: 'Silver Tongue', rewards: title({ name: 'Silver Tongue', desc: 'Told a lie that the whole table enjoyed.', bonus: { pre: 1 } }), window: words('THEY BOUGHT IT', 'You told a lie that the whole table enjoyed. You get the title Silver Tongue.') },
  // a one-use boon: a story kept alive once, no number moves
  { key: 'seed-second-story', moment: 'lie', when: 'Told a lie the hunter will have to keep telling', name: 'Second Story', rewards: boon('Second Story', 'Once, when a lie of yours is found out, one listener of your choice still believes it.'), window: words('THE STORY HOLDS', 'You told a lie your hunter will have to keep telling. Once, when one of your lies is found out, one listener of your choice still believes it.') },
  // A09 a one-use boon: a round bought from a monster that speaks
  { key: 'seed-two-versions', moment: 'lie', when: 'Told a lie that fooled a stranger and half the table', name: 'Two Versions', rewards: boon('Stalling Tongue', 'Once, a lie told to a monster that speaks makes it wait one round before it acts.'), window: words('THE SYSTEM LOGGED TWO VERSIONS', 'You told a lie that fooled a stranger and half the table. Once, a lie you tell a monster that speaks makes it wait one round before it acts.') },
  // A10 an E-rank title: 1 point (+1 Agility)
  { key: 'seed-borrowed-face', moment: 'lie', when: 'Pretended to be someone else for a whole scene', name: 'Borrowed Face', rewards: title({ name: 'Borrowed Face', desc: 'Pretended to be someone else for a whole scene, and nobody noticed.', bonus: { agi: 1 } }), window: words('IDENTITY UNCONFIRMED', 'You pretended to be someone else for a whole scene. You get the title Borrowed Face.') },
  // A11 1 ability point
  { key: 'seed-every-word-true', moment: 'lie', when: 'Misled someone using only true statements', name: 'Every Word True', rewards: points(1), window: words('EVERY WORD WAS TRUE', 'You said nothing false, and they still believed the wrong thing. You get 1 ability point.') },
  // A12 1 ability point, and a clause the GM holds: the lie comes true once, at the worst time
  { key: 'seed-interest-accrues', moment: 'lie', when: 'Told a big lie that the GM may bring back later', name: 'Interest Accrues', rewards: points(1, { boons: [{ name: 'Interest', text: 'Once, the GM may make that lie come true at a bad time for you.' }] }), window: words('THE LIE IS STILL OUT THERE', 'You told a big lie. You get 1 ability point. Once, the GM may make that lie come true at a bad time for you.') },

  // ── was kind at a cost ──
  // 1 ability point
  { key: 'seed-bread-shared', moment: 'kindness', when: 'Was kind to someone when it cost the hunter something', name: 'Bread Shared', rewards: points(1), window: words('THE SYSTEM COUNTED A KINDNESS', 'You were kind to someone when it cost your hunter something. You get 1 ability point.') },
  // an E-rank title: 1 point (+10 max HP)
  { key: 'seed-soft-spot', moment: 'kindness', when: 'Was kind to someone when it cost the hunter a lot', name: 'Soft Spot', rewards: title({ name: 'Soft Spot', desc: 'Was kind to someone when it cost a lot.', bonus: { hpMax: 10 } }), window: words('A SOFT SPOT', 'You were kind to someone when it cost your hunter a lot. You get the title Soft Spot.') },
  // A13 a one-use boon: someone helped returns with one piece of help the GM picks (it took the place of the first shelf's "Remembered", the same gift)
  { key: 'seed-a-strangers-lamp', moment: 'kindness', when: 'Helped someone who could give nothing back', name: 'A Stranger\'s Lamp', rewards: boon('A Stranger\'s Lamp', 'Once in a gate, someone you helped appears with one piece of help the GM picks.'), window: words('A STRANGER HAS YOUR NAME', 'You helped someone who could give nothing back. Once in a gate, someone you helped will appear with help the GM picks.') },
  // A14 1 ability point and a Health Potion: what the kindness cost, put back
  { key: 'seed-mended', moment: 'kindness', when: 'Used the hunter\'s own rest, gold or potion on someone else', name: 'Mended', rewards: points(1, { items: [HEALTH_POTION] }), window: words('THE SYSTEM PAID YOU BACK', 'You used your own rest, gold or potion on someone else. You get 1 ability point and a Health Potion.') },
  // A15 an E-rank title: 1 point (+1 Presence)
  { key: 'seed-kindling', moment: 'kindness', when: 'Looked after the others and went without', name: 'Kindling', rewards: title({ name: 'Kindling', desc: 'Looked after the others and went without.', bonus: { pre: 1 } }), window: words('YOU GAVE MORE THAN YOU HAD', 'You looked after the others and went without. You get the title Kindling.') },

  // ── gave a speech ──
  // 1 ability point
  { key: 'seed-room-went-quiet', moment: 'speech', when: 'Gave a speech that the whole table listened to', name: 'The Room Went Quiet', rewards: points(1), window: words('EVERYONE WAS LISTENING', 'You gave a speech, and the whole table listened. You get 1 ability point.') },
  // a held reroll given to an ally: the same size as the shelf's own reroll
  { key: 'seed-rallying-words', moment: 'speech', when: 'Said something that encouraged the others', name: 'Rallying Words', rewards: boon('Rallying Words', 'Once, after you speak, one ally of your choice rolls a d20 again and keeps the second roll.'), window: words('THEY WILL FOLLOW THAT', 'You said something that encouraged the others. Once, after you speak, one ally of your choice may roll a d20 again and keep the second roll.') },
  // RARE: 2 ability points and a C-rank title (3 points: +2 Presence, +1 Instinct). For the speech the campaign turns on
  { key: 'seed-voice-of-the-gate', moment: 'speech', rare: true, when: 'Gave a speech that changed what happened in the campaign', name: 'Voice of the Gate', rewards: title({ name: 'Voice of the Gate', desc: 'Gave a speech that changed what happened in the campaign.', bonus: { pre: 2, ins: 1 } }, { points: 2 }), window: words('THE GATE HEARD YOU', 'Your speech changed what happened in the campaign. You get 2 ability points and the title Voice of the Gate.') },
  // A17 a one-use boon: the speech quoted back later, no number moves
  { key: 'seed-quoted-back', moment: 'speech', when: 'Gave a speech that the players kept quoting', name: 'Quoted Back', rewards: boon('Quoted', 'In a later session, someone the GM picks quotes your speech back to you.'), window: words('SOMEONE WILL REMEMBER THIS', 'You gave a speech that the players kept quoting. In a later session, someone the GM picks will quote it back to you.') },
  // A18 a one-use boon: one fight's allies start Hasted for a round, which the GM puts on
  { key: 'seed-banner', moment: 'speech', when: 'Gave a speech before a fight', name: 'Banner', rewards: boon('Banner', 'In that fight, every ally starts Hasted for 1 round. The GM puts it on.'), window: words('THEY WILL MARCH ON THAT', 'You gave a speech before a fight. In that fight, every ally starts Hasted for 1 round.') },
  // A19 an E-rank title: 1 point (+1 Discipline)
  { key: 'seed-eulogist', moment: 'speech', when: 'Gave a speech for someone who died', name: 'Eulogist', rewards: title({ name: 'Eulogist', desc: 'Gave a speech for someone who died.', bonus: { dis: 1 } }), window: words('THE DEAD WERE LISTENING', 'You gave a speech for someone who died. You get the title Eulogist.') },

  // ── stayed silent ──
  // nothing but the line
  { key: 'seed-said-nothing', moment: 'silence', when: 'Said nothing at a moment when that was the best choice', name: 'Said Nothing', rewards: nothing(), window: words('SILENCE NOTED', 'You said nothing, and that was the best choice in that scene.') },
  // an E-rank title: 1 point (+1 Discipline)
  { key: 'seed-still-water', moment: 'silence', when: 'Knew when to say nothing', name: 'Still Water', rewards: title({ name: 'Still Water', desc: 'Knew when to say nothing.', bonus: { dis: 1 } }), window: words('THE QUIET WAS YOURS', 'You knew when to say nothing. You get the title Still Water.') },
  // a one-use boon of information, which costs the game's numbers nothing
  { key: 'seed-unasked', moment: 'silence', when: 'Listened instead of speaking', name: 'Unasked', rewards: boon('Unasked', 'Once, ask the GM what one person in the scene is thinking. The answer is true.'), window: words('YOU HEARD WHAT WAS NOT SAID', 'You listened instead of speaking. Once, you may ask the GM what one person in the scene is thinking, and the answer is true.') },
  // A21 a one-use boon: a question refused in character, no number moves
  { key: 'seed-withheld', moment: 'silence', when: 'Refused to answer a question, and the refusal told the others a lot', name: 'Withheld', rewards: boon('Withheld', 'Once, refuse a question in character, and no check may make you answer.'), window: words('THE SYSTEM RECEIVED NO INPUT', 'You refused to answer, and that told the others a lot. Once, you may refuse a question in character, and no check can make you answer.') },
  // A22 1 ability point
  { key: 'seed-enough', moment: 'silence', when: 'Answered with a look instead of words', name: 'Enough', rewards: points(1), window: words('A LOOK WAS ENOUGH', 'You answered with a look instead of words. You get 1 ability point.') },
  // A23 an E-rank title: 1 point (+1 Instinct)
  { key: 'seed-the-unanswered', moment: 'silence', when: 'Said nothing when asked a painful question', name: 'The Unanswered', rewards: title({ name: 'The Unanswered', desc: 'Said nothing when asked a painful question.', bonus: { ins: 1 } }), window: words('THE QUESTION IS STILL IN THE ROOM', 'You said nothing when asked a painful question. You get the title The Unanswered.') },

  // ── played a rivalry with another hunter ──
  // A24 a one-use boon, given to each rival: try what the rival just did, at once
  { key: 'seed-measured-against', moment: 'rivalry', when: 'Played a rivalry with another hunter openly (give it to both)', name: 'Measured Against', rewards: boon('Answer', 'Once, when your rival succeeds at something, try the same thing at once.'), window: words('THE SYSTEM HAS STARTED A SECOND COLUMN', 'You played your rivalry with another hunter openly. Once, when your rival succeeds at something, you may try the same thing at once.') },
  // A25 1 ability point
  { key: 'seed-second-place', moment: 'rivalry', when: 'Lost to the rival and showed that the hunter was upset', name: 'Second Place', rewards: points(1), window: words('SECOND PLACE', 'You lost to your rival and showed that your hunter was upset. You get 1 ability point.') },
  // A26 an E-rank title: 1 point (+1 Strength) to each rival; its link to the rival waits for a title that names another hunter
  { key: 'seed-two-edges', moment: 'rivalry', when: 'Kept a rivalry that made both hunters try harder (give it to both)', name: 'Two Edges', rewards: title({ name: 'Two Edges', desc: 'Tried harder because of a rival.', bonus: { str: 1 } }), window: words('ONE BLADE SHARPENS THE OTHER', 'Your rivalry made both of you try harder. You get the title Two Edges.') },
  // A27 RARE: a C-rank title (3 points: +2 Presence, +1 Strength) and 2 ability points, to both
  { key: 'seed-settled-account', moment: 'rivalry', rare: true, when: 'Ended a rivalry face to face in a scene (give it to both)', name: 'Settled Account', rewards: title({ name: 'Settled Account', desc: 'Ended a rivalry face to face.', bonus: { pre: 2, str: 1 } }, { points: 2 }), window: words('THE RIVALRY IS SETTLED', 'You ended your rivalry face to face. You get 2 ability points and the title Settled Account.') },

  // ── brought back an old joke ──
  // A28 1 ability point
  { key: 'seed-callback', moment: 'joke', when: 'Brought back a joke from an earlier session at the right moment', name: 'Callback', rewards: points(1), window: words('THE SYSTEM REMEMBERED THE SETUP', 'You brought back a joke from an earlier session at the right moment. You get 1 ability point.') },
  // A30 a one-use boon: a title the other players name, with no bonus (the GM writes it)
  { key: 'seed-running-gag', moment: 'joke', when: 'Kept one joke about the hunter going for weeks', name: 'Running Gag', rewards: boon('Running Gag', 'The other players name a title for you. The GM writes it, with no bonus.'), window: words('THE SYSTEM HAS BEEN FORCED TO ACKNOWLEDGE THIS', 'A joke about your hunter has gone on for weeks. The other players name a title for you, and the GM writes it, with no bonus.') },
  // A31 RARE: a legendary accessory whose worn status shields a quarter of max HP as each fight begins
  { key: 'seed-the-punchline', moment: 'joke', rare: true, when: 'Made a long-running joke matter in a serious scene', name: 'The Punchline', rewards: { ...newRewards(), items: [PUNCHLINE] }, window: words('THE JOKE PAID OFF', 'Your long-running joke mattered in a serious scene. You get The Punchline, a necklace that gives you a shield as each fight begins.') },

  // ── helped another player's moment ──
  // 1 ability point
  { key: 'seed-set-the-stage', moment: 'spotlight', when: 'Helped another player have a bigger moment', name: 'Set the Stage', rewards: points(1), window: words('YOU GAVE THEM THE SCENE', 'You helped another player have a bigger moment. You get 1 ability point.') },
  // a held reroll to give away: the same size as the shelf's own reroll
  { key: 'seed-in-your-corner', moment: 'spotlight', when: 'Supported another hunter during its moment', name: 'In Your Corner', rewards: boon('In Your Corner', 'Once, when another hunter rolls a d20, let them roll it again and keep the second roll.'), window: words('SOMEONE HAS YOUR BACK', 'You supported another hunter during its moment. Once, when another hunter rolls a d20, you may let them roll it again and keep the second roll.') },
  // RARE: 2 ability points and a C-rank title (2 points: +2 Presence). For the player who made the table's favorite scene someone else's
  { key: 'seed-the-best-second', moment: 'spotlight', rare: true, when: 'Set up the table\'s favorite scene for another player', name: 'The Best Second', rewards: title({ name: 'The Best Second', desc: 'Set up the table\'s favorite scene for another player.', bonus: { pre: 2 } }, { points: 2 }), window: words('THE SYSTEM SAW WHO HELD THE LIGHT', 'You set up the table\'s favorite scene for another player. You get 2 ability points and the title The Best Second.') },
  // A32 a one-use boon: a near miss of another hunter's turned into a success, once
  { key: 'seed-feed-line', moment: 'spotlight', when: 'Set up a moment for another hunter, then let it act', name: 'Feed Line', rewards: boon('Feed Line', 'Once, describe how another hunter succeeds at a roll that missed by 2 or less.'), window: words('THE SYSTEM CREDITS THE ASSIST', 'You set up a moment for another hunter and let it act. Once, when another hunter misses a roll by 2 or less, you may describe how it succeeds.') },
  // A33 1 ability point
  { key: 'seed-gave-the-kill', moment: 'spotlight', when: 'Set up another hunter\'s finishing blow, in character', name: 'Gave the Kill', rewards: points(1), window: words('TWO NAMES ON ONE KILL', 'Another hunter landed the finishing blow because you set it up. You get 1 ability point.') },
  // A34 a held reroll
  { key: 'seed-lent-the-floor', moment: 'spotlight', when: 'Gave up a turn to talk so another player could finish a scene', name: 'Lent the Floor', rewards: boon('Lent the Floor', REROLL), window: words('YOU GAVE UP YOUR TURN', 'You gave up your turn to talk so another player could finish. You get one reroll of a d20.') },
  // A35 a one-use boon of information between players, no number moves
  { key: 'seed-asked-the-question', moment: 'spotlight', when: 'Asked a question that brought out another hunter\'s past', name: 'Asked the Question', rewards: boon('Confidant', 'Once, the other hunter\'s player tells you one secret of its past, privately.'), window: words('THE RIGHT QUESTION', 'You asked a question that brought out another hunter\'s past. Once, that hunter\'s player tells you one secret of its past, privately.') },

  // ── changed the hunter's mind ──
  // A36 1 ability point
  { key: 'seed-file-updated', moment: 'mind', when: 'Changed a belief the hunter held, for a reason the table saw', name: 'File Updated', rewards: points(1), window: words('THE SYSTEM HAS UPDATED YOUR FILE', 'Your hunter changed a belief, and the table saw why. You get 1 ability point.') },
  // A37 a one-use boon: a respec at no gold, before the next session
  { key: 'seed-new-shape', moment: 'mind', when: 'Changed the hunter\'s mind in a way that changes how it fights', name: 'New Shape', rewards: boon('New Shape', 'One respec at no gold, taken before the next session or lost.'), window: words('THE OLD SHAPE NO LONGER FITS', 'Your hunter changed its mind in a way that changes how it fights. You get one respec at no gold. Take it before the next session or lose it.') },

  // ── owned a failure ──
  // 1 ability point
  { key: 'seed-owned-it', moment: 'owned', when: 'Played out a failure as fully as a success', name: 'Owned It', rewards: points(1), window: words('THE FAILURE IS YOURS', 'You played out a failure as fully as a success. You get 1 ability point.') },
  // an E-rank title: 1 point (+1 Instinct)
  { key: 'seed-honest-ledger', moment: 'owned', when: 'Accepted a failure without arguing and played it out', name: 'Honest Ledger', rewards: title({ name: 'Honest Ledger', desc: 'Accepted a failure without arguing and played it out.', bonus: { ins: 1 } }), window: words('THE LEDGER IS HONEST', 'You accepted a failure without arguing and played it out. You get the title Honest Ledger.') },
  // 50 XP: two dailies' worth of XP, and no ability point
  { key: 'seed-hard-lesson', moment: 'owned', when: 'Had the hunter learn from a failure in front of the table', name: 'Hard Lesson', rewards: xp(50), window: words('THE SYSTEM LOGGED A LESSON', 'Your hunter learned from a failure in front of the table. You get 50 XP.') },
  // A39 a one-use boon: one check of the same kind rolled twice, the better kept
  { key: 'seed-fell-forward', moment: 'owned', when: 'Used a failure in the story instead of hiding it', name: 'Fell Forward', rewards: boon('Lesson Kept', 'On your next check of the same kind, roll twice and keep the better.'), window: words('THE SYSTEM KEEPS THE LESSON ON FILE', 'You used a failure in the story instead of hiding it. On your next check of the same kind, roll twice and keep the better roll.') },
  // A40 an E-rank title: 1 point (+1 Agility)
  { key: 'seed-scuffed', moment: 'owned', when: 'Described a failure so well the table asked to hear it again', name: 'Scuffed', rewards: title({ name: 'Scuffed', desc: 'Described a failure so well the table asked to hear it again.', bonus: { agi: 1 } }), window: words('THE SYSTEM REQUESTS A REPLAY', 'You described a failure so well the table asked to hear it again. You get the title Scuffed.') },
  // A41 1 ability point
  { key: 'seed-worse-than-rolled', moment: 'owned', when: 'Described a failure as worse than the dice made it', name: 'Worse Than Rolled', rewards: points(1), window: words('THE SYSTEM DID NOT ASK FOR THIS', 'You described a failure as worse than the dice made it. You get 1 ability point.') },

  // ── was funny ──
  // nothing but the line
  { key: 'seed-perfect-timing', moment: 'comic', when: 'Said a funny line at exactly the right time', name: 'Perfect Timing', rewards: nothing(), window: words('THE SYSTEM DOES NOT LAUGH', 'You said a funny line at exactly the right time.') },
  // an E-rank title: 1 point (+1 Agility)
  { key: 'seed-table-wit', moment: 'comic', when: 'Made the whole table laugh', name: 'Table Wit', rewards: title({ name: 'Table Wit', desc: 'Made the whole table laugh.', bonus: { agi: 1 } }), window: words('THAT LANDED', 'You made the whole table laugh. You get the title Table Wit.') },
  // a one-use boon: a joke made true for a scene, the GM's to shape, no number moves
  { key: 'seed-encore', moment: 'comic', when: 'Made a joke the GM wants to make true in the game', name: 'Encore', rewards: boon('Encore', 'Once, the GM makes a joke of yours true in the world for one scene.'), window: words('THE SYSTEM WANTS AN ENCORE', 'You made a joke the GM wants to make true. Once, the GM will make a joke of yours true in the world for one scene.') },
  // A43 a one-use boon: a natural 1 played for laughs costs nothing, once
  { key: 'seed-pratfall-clause', moment: 'comic', when: 'Played a natural 1 for laughs', name: 'Pratfall Clause', rewards: boon('Pratfall Clause', 'Once, after a natural 1, describe a funny failure and the GM makes it cost nothing.'), window: words('THE FALL WAS INSURED', 'You played a natural 1 for laughs. Once, after a natural 1, describe a funny failure and the GM makes it cost nothing.') },
  // A44 an E-rank title: 1 point (+1 Instinct)
  { key: 'seed-deadpan', moment: 'comic', when: 'Told a joke without smiling', name: 'Deadpan', rewards: title({ name: 'Deadpan', desc: 'Told a joke without smiling.', bonus: { ins: 1 } }), window: words('THE SYSTEM ALSO KEEPS A STRAIGHT FACE', 'You told a joke without smiling. You get the title Deadpan.') },

  // ── said goodbye ──
  // 1 ability point
  { key: 'seed-said-goodbye', moment: 'goodbye', when: 'Said goodbye to someone in character', name: 'Said Goodbye', rewards: points(1), window: words('YOU SAID GOODBYE', 'You said goodbye in character. You get 1 ability point.') },
  // a D-rank title: 2 points (+2 Discipline), for a goodbye the hunter carries on
  { key: 'seed-carries-a-name', moment: 'goodbye', when: 'Said goodbye to someone who died and kept going', name: 'Carries a Name', rewards: title({ name: 'Carries a Name', desc: 'Said goodbye to someone who died and kept going.', bonus: { dis: 2 } }), window: words('A NAME GOES WITH YOU', 'You said goodbye to someone who died and kept going. You get the title Carries a Name.') },
  // RARE: 3 ability points and a B-rank title (3 points: +2 Presence, +10 max HP). For the goodbye to a fallen hunter, or a player leaving the campaign
  { key: 'seed-keeper-of-the-last-word', moment: 'goodbye', rare: true, when: 'Said goodbye to a dead hunter or a player leaving the game', name: 'Keeper of the Last Word', rewards: title({ name: 'Keeper of the Last Word', desc: 'Said goodbye to a dead hunter or a player leaving the game.', bonus: { pre: 2, hpMax: 10 } }, { points: 3 }), window: words('THE SYSTEM KEPT THE LAST WORD', 'You said goodbye to a dead hunter or a player leaving the game. You get 3 ability points and the title Keeper of the Last Word.') },
  // A45 a one-use boon: one scene back in a place left behind
  { key: 'seed-way-back-marked', moment: 'goodbye', when: 'Said goodbye to a place or a person the hunter will not see again', name: 'Way Back Marked', rewards: boon('Way Back', 'Once, ask the GM for one scene back in a place you left.'), window: words('THE PATH BACK IS MARKED', 'You said goodbye to a place or a person. Once, you may ask the GM for one scene back in a place you left.') },
  // A46 a common material worth nothing to the shop, which the player names
  { key: 'seed-keepsake', moment: 'goodbye', when: 'Gave or got something to keep at a goodbye', name: 'Keepsake', rewards: { ...newRewards(), items: [KEEPSAKE] }, window: words('THE SYSTEM WILL NOT APPRAISE THIS', 'You gave or got something to keep at a goodbye. You get a Keepsake. Name it and write what it is.') },

  // ── kept a secret ──
  // A48 a one-use boon: either answer pays 1 ability point, which the GM gives
  { key: 'seed-locked-box', moment: 'secret', when: 'Kept a secret when others tried to learn it', name: 'Locked Box', rewards: boon('Locked Box', 'Once, the GM asks you privately whether to reveal it. Either answer pays 1 ability point.'), window: words('THE SYSTEM SEES ONLY THE LOCK', 'You kept a secret when others tried to learn it. Once, the GM will ask you privately whether to reveal it. Either answer pays 1 ability point.') },
  // A49 1 ability point
  { key: 'seed-knew-and-did-not-know', moment: 'secret', when: 'Played as if the hunter did not know what the player knew', name: 'Knew and Did Not Know', rewards: points(1), window: words('YOU KNEW. YOUR HUNTER DID NOT', 'You knew something your hunter did not, and you played as if you did not know it. You get 1 ability point.') },
  // A50 an E-rank title: 1 point (+1 Instinct)
  { key: 'seed-second-ledger', moment: 'secret', when: 'Kept a secret for more than three sessions', name: 'Second Ledger', rewards: title({ name: 'Second Ledger', desc: 'Kept a secret for more than three sessions.', bonus: { ins: 1 } }), window: words('THE SYSTEM KEEPS A SECOND COPY', 'You kept a secret for more than three sessions. You get the title Second Ledger.') },

  // ── made or kept a promise ──
  // A52 a one-use boon, given to both: a hit taken for the other, once, while the promise stands
  { key: 'seed-hand-on-it', moment: 'promise', when: 'Made a promise with another hunter (give it to both)', name: 'Hand on It', rewards: boon('Bond Held', 'While the promise stands, once, either of you may take a hit meant for the other.'), window: words('THE PROMISE IS ON FILE', 'You and another hunter made a promise to each other. While it stands, once, either of you may take a hit meant for the other.') },
  // A53 RARE: 3 ability points and a B-rank title (3 points: +2 Discipline, +1 Presence)
  { key: 'seed-late-but-true', moment: 'promise', rare: true, when: 'Kept a promise made many sessions ago', name: 'Late but True', rewards: title({ name: 'Late but True', desc: 'Kept a promise made many sessions ago.', bonus: { dis: 2, pre: 1 } }, { points: 3 }), window: words('THE SYSTEM HAD STOPPED WAITING', 'You kept a promise made many sessions ago. You get 3 ability points and the title Late but True.') },

  // ── showed mercy ──
  // A54 a clause the GM holds: the one spared returns once, to help or to harm
  { key: 'seed-spared-one', moment: 'mercy', when: 'Let a defeated foe live', name: 'Spared One', rewards: boon('Spared One', 'The one you spared comes back once, at a time the GM picks. It may help you or hurt you.'), window: words('IT WILL REMEMBER YOUR FACE', 'You let a defeated foe live. It will come back once, at a time the GM picks, and it may help you or hurt you.') },
  // A55 1 ability point: less than the XP the mercy gave up, which the window says
  { key: 'seed-mercy-pays-odd', moment: 'mercy', when: 'Spared a foe, and the party lost the XP for it', name: 'Mercy Pays Odd', rewards: points(1), window: words('THE SYSTEM DID NOT REQUIRE THAT', 'You spared a foe and lost its XP. You get 1 ability point.') },
  // A56 RARE: an A-rank title (4 points: +3 Presence, +1 Discipline); the spared boss's life after is the GM's
  { key: 'seed-open-palm', moment: 'mercy', rare: true, when: 'Spared a boss', name: 'Open Palm', rewards: title({ name: 'Open Palm', desc: 'Spared a boss that everyone expected it to kill.', bonus: { pre: 3, dis: 1 } }), window: words('THE SYSTEM HAS NO CATEGORY FOR THIS', 'You spared a boss, and it is still alive in the world. You get the title Open Palm.') },

  // ── played the hunter's fear ──
  // A57 a one-use boon: the first check against fear in the next fight rolls twice
  { key: 'seed-shaking-hands', moment: 'fear', when: 'Played the hunter\'s fear before a fight', name: 'Shaking Hands', rewards: boon('Courage Owed', 'In the next fight, the first check against fear rolls twice and keeps the better.'), window: words('THE SYSTEM NOTED YOUR FEAR', 'You played your hunter\'s fear before a fight. In the next fight, your first check against fear rolls twice and keeps the better roll.') },
  // A58 1 ability point
  { key: 'seed-came-back', moment: 'fear', when: 'Ran away, then came back', name: 'Came Back', rewards: points(1), window: words('YOU CAME BACK', 'You ran away, then came back. You get 1 ability point.') },
  // A59 an E-rank title: 1 point (+1 Discipline)
  { key: 'seed-said-its-name', moment: 'fear', when: 'Said out loud what the hunter fears most', name: 'Said Its Name', rewards: title({ name: 'Knows Its Name', desc: 'Said out loud what it fears most.', bonus: { dis: 1 } }), window: words('THE FEAR HAS A NAME NOW', 'You said out loud what your hunter fears most. You get the title Knows Its Name.') },
  // A60 RARE: a B-rank title (3 points: +2 Discipline, +1 Vitality) and 2 ability points
  { key: 'seed-walked-in-anyway', moment: 'fear', rare: true, when: 'Entered the gate the hunter feared most', name: 'Walked In Anyway', rewards: title({ name: 'Walked In Anyway', desc: 'Entered the gate it feared most.', bonus: { dis: 2, vit: 1 } }, { points: 2 }), window: words('YOU WENT IN', 'You entered the gate you feared most. You get 2 ability points and the title Walked In Anyway.') },

  // ── anything else ──
  // A62 nothing but the window: the window is the reward
  { key: 'seed-seen', moment: 'any', when: 'Did something small, and has had no award lately', name: 'Seen', rewards: nothing(), window: words('THE SYSTEM SAW THAT', '') },
];

export const BUILT_IN_BUNDLES: readonly BuiltInBundle[] = ENTRIES.map(e => ({ ...e, rare: e.rare === true }));

/** The built-in bundle of key `key`, or null. */
export const builtInBundle = (key: string): BuiltInBundle | null => BUILT_IN_BUNDLES.find(b => b.key === key) ?? null;

/** How long a give waits for Undo before it is written (the shelf's held toast, gm.js): long enough to catch a stray tap. */
export const GIVE_HOLD_MS = 2000;
/** How many of the last bundles given the shelf keeps at its top. */
export const RECENT_GIVES = 4;
/** The keys of the last bundles given, newest first, read from this phone's memory (anything else reads as none). */
export const readRecent = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= 80))].slice(0, RECENT_GIVES) : []);
/** The last bundles given after `key` is given: it first, once, the oldest past `RECENT_GIVES` dropped. */
export const recentGives = (v: unknown, key: string): string[] => [key, ...readRecent(v).filter(k => k !== key)].slice(0, RECENT_GIVES);

/** The shelf's words (src/views/give-shelf.js and gm.js's Give…): its title, the headings of its parts, the held toast. */
export const SHELF_WORDS = {
  tag: '! Award',
  title: (name: string): string => `GIVE TO ${name.toUpperCase()}`,
  all: 'All',
  recent: 'Last given',
  own: 'Yours',
  ownWhen: 'A bundle you saved',
  rare: 'Rare',
  guide: 'How to use these',
  chips: 'Show the awards for',
  cancel: 'Cancel',
  toastTag: 'Award',
  given: (award: string, name: string): string => `Given: ${award} to ${name}.`,
  undo: 'Undo',
} as const;

/**
 * What a reward gives, in one line for the shelf: its parts as the reward window says them, a title with its bonus and a
 * boon with what it lets the player do (a boon's name is often the award's own), or that it is the System's line alone.
 */
export function givesLine(r: Rewards, R: RewardRules): string {
  const bonus = (b: Record<string, number>): string => BONUS_KEYS.filter(k => b[k]).map(k => `${b[k]! > 0 ? '+' : ''}${b[k]} ${BONUS_LABELS[k]}`).join(', ');
  const parts = grantLines(R, { ...r, title: null, boons: [] }).map(l => l.replace(/^(Item|Skill) acquired: /, '$1: '));
  if (r.title) { const b = bonus(r.title.bonus); parts.push(`Title: ${r.title.name}${b ? ` (${b})` : ''}`); }
  for (const b of r.boons) parts.push(`Boon: ${b.text}`);
  return parts.length ? parts.join(' · ') : 'Only the System\'s line.';
}

/** "How to use these", from the shelf: when and how to give an award for roleplay (features/ideas-2-imaginative.md 3.19). */
export const GIVING_GUIDE: readonly string[] = [
  'Give each player about one small award a session. If you give fewer, players stop looking for them. If you give many more, they mean less.',
  'Across the whole table, give about one rare award every five or six sessions.',
  'Give an award right after the moment happens.',
  'Quiet players have fewer moments than loud players. Give a quiet player an award for one moment, and a loud player an award for their best one. Staying silent and keeping a secret are often what a quiet player does.',
  'When you give one, say what the player did, for example "the lie you told the guard". Saying "you are good at this" does not tell them what they did.',
  'Do not tell players ahead of time what an award is for. If a player does something only to get an award, give nothing for it.',
  'Give a boon or a window more often than ability points or a title. Sometimes give Seen, which shows a window and gives nothing.',
  'Give awards for helping another player\'s moment as often as for the moment itself.',
  'If you are not sure which award to give, give the smallest one.',
];
