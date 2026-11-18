// A fight set up through the store for a player's phone waits for that setup's doc on the player's phone.
// The doc of the fight's start may already call the hunter's turn from where the fight first stood it, so a wait for
// "YOUR TURN" alone lets a tap through that was worked out from the older doc. This one race refused five pushes
// (table-turn, phone, used, maps, map-extras, and table-turn's inline setups), each time in a file nobody had looked at.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';

/** Files whose setups place a hunter for a phone that then waits another way, each with its reason. */
const OTHER_WAIT: Record<string, string> = {
  'battle-map.e2e.ts': 'its fight helper waits for the hunter\'s token at its set place on both phones (placeOf)',
  'look.e2e.ts': 'its fights are on the GM\'s phone alone: no player\'s phone reads a doc',
};

test('a browser test that places a hunter in a fight through the store waits for that doc on the player\'s phone (setupDoc)', () => {
  const short: string[] = [];
  for (const f of readdirSync('tests/e2e').filter(n => n.endsWith('.e2e.ts'))) {
    if (f in OTHER_WAIT) continue;
    const text = readFileSync(`tests/e2e/${f}`, 'utf8');
    if (!/\bplayer\b/.test(text)) continue;
    // one setup places the hunter once: `kai.place = ...` or `me.place = ...` inside a store.update on the GM's phone
    // a setup whose test is driven on the GM's phone alone says so on its line
    const placed = text.split('\n').filter(l => /\b(?:kai|me)\.place = /.test(l) && !l.includes("the GM's phone only")).length;
    const waited = (text.match(/\bsetupDoc\(/g) ?? []).length;
    if (waited < placed) short.push(`${f}: ${placed} setups place the hunter, ${waited} wait with setupDoc`);
  }
  expect(short, 'after the store.update that places the hunter, call setupDoc(player, name, place) from tests/e2e/helpers.ts before the player taps; or name the file in OTHER_WAIT with how it waits').toEqual([]);
});
