// Lint-style checks. Each test is one rule that a past bug or a design decision produced. AGENTS.md names them.
// To add a rule: add a test here that reads the source and fails with the file, the line and what to do instead.

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { GATE_STATUSES } from '../src/core/gates/gate.ts';
import { PACK_KINDS } from '../src/core/pack.ts';
import { domainOf, inDomain } from '../src/core/rules.ts';
import { E2E_MAKER_IDS, MAKER_OPEN_EXEMPTIONS, ROUNDTRIP_REGISTRY, UNIT_MAKER_IDS } from './fixtures/maker-registry.ts';
import type { MakerRegistryEntry } from './fixtures/maker-registry.ts';
import { ruleNumbers } from './fixtures/rule-numbers.ts';

const ROOT = import.meta.dir + '/..';

type Line = { file: string; line: number; text: string };

async function sourceLines(dir: string): Promise<Line[]> {
  const names = (await readdir(`${ROOT}/${dir}`, { recursive: true })).filter(name => /\.(ts|js)$/.test(name)).sort();
  const lines: Line[] = [];
  for (const name of names) {
    const text = await Bun.file(`${ROOT}/${dir}/${name}`).text();
    text.split('\n').forEach((text, i) => lines.push({ file: `${dir}/${name}`, line: i + 1, text }));
  }
  return lines;
}

const isComment = (text: string) => /^\s*(\/\/|\*|\/\*)/.test(text);
const report = (hits: Line[]) => hits.map(hit => `${hit.file}:${hit.line}: ${hit.text.trim().slice(0, 120)}`);

test('src/core has source files to check', async () => {
  expect((await sourceLines('src/core')).length).toBeGreaterThan(0);
});

test('src/core imports nothing from src/edge or src/views', async () => {
  const hits = (await sourceLines('src/core')).filter(({ text }) => /\b(from|import)\b.*['"][^'"]*\/(edge|views)\//.test(text));
  expect(report(hits), 'core is the pure part. Move the shared code into src/core, or pass the value in as an argument.').toEqual([]);
});

test('src/core does not touch the browser, storage or the network', async () => {
  const banned = /\b(document|window|localStorage|sessionStorage|navigator|location)\s*\.|\bfetch\s*\(|\baddEventListener\s*\(/;
  const hits = (await sourceLines('src/core')).filter(({ text }) => !isComment(text) && banned.test(text));
  expect(report(hits), 'core is pure. Do this in src/edge and pass the result into core.').toEqual([]);
});

test('only src/core/role.ts decides the role', async () => {
  // save.ts and store.ts were permitted long after neither read the mode (implicit audit 2, step 3): a permit that
  // permits nothing is room for a new reader, so each one must still match a line
  const mayRead = ['src/core/role.ts'];
  const reads = /\bsettings\.mode\b(?!\s*=(?!=))|\.mode\s*[!=]==?\s*['"](gm|player)['"]/;
  const all = (await sourceLines('src')).filter(line => !isComment(line.text) && reads.test(line.text));
  expect(mayRead.filter(f => !all.some(l => l.file === f)), 'a permit that permits nothing leaves the list').toEqual([]);
  const hits = all.filter(line => !mayRead.includes(line.file));
  expect(report(hits), 'settings.mode is only what the phone chose while alone. Ask roleOf or seatOf from src/core/role.ts, or app.isGM() or app.seat() in a view.').toEqual([]);
});

test('a view asks app.seat() whether this phone is in a room, and as what', async () => {
  // The seat (alone, the room's GM, a player in it) was worked out in a dozen views by their own test: `app.isGM()` beside
  // `sync.room()`, `sync.isGM()`, a try that answered false. One that differed showed a control to the wrong phone.
  // `seatOf` (src/core/role.ts) is the one answer, `app.seat()` asks it, and a rule that differs by seat takes it as an
  // argument in core (`runsFight`, `mayChangeQuest`, `decider`). `sync.room()` is the room's code, never a yes or no.
  const room = String.raw`\w*[rR]oom\(\)`; // sync.room() and a view's own inRoom()
  const roomAsTruth = new RegExp(String.raw`(?:!|&&|\|\||\bif\s*\()\s*\(?\s*(?:[\w$]+(?:\(\))?\??\.)*${room}(?!\s*[!=]=)|\b${room}\s*(?:\?(?![.?])|&&|\|\|(?!\s*(?:null|'')))`);
  const roleWithRoom = /\bisGM\(.*[rR]oom\(|[rR]oom\(.*\bisGM\(/;
  const asks = (text: string) => roomAsTruth.test(text) || roleWithRoom.test(text);
  const old = [
    "  const canRun = () => { try { return !inRoom() || !!app.isGM(); } catch { return false; } };",
    "  const inRoom = () => { try { const S = A().sync; return !!(S && S.room && S.room()); } catch { return false; } };",
    "  const deciderNow = () => decider({ inRoom: !!(sync() && sync().room()), gm: app.isGM() });",
    "    const S = app.api.sync; if (!S || !S.room() || app.isGM()) return null;",
    "    const S = A().sync, d = S.room() ? S.doc('fight') : null;",
    "    if (Y().room()) return { hunterId: bound() };",
  ];
  for (const text of old) expect(asks(text), `the rule sees ${text.trim()}`).toBe(true);
  for (const text of ["title: `ROOM ${Y().room() || ''}`", "if (c && sy.conn() !== 'off' && sy.room() !== c) app.go('room');", "const posts = { room: S.room(), events };"])
    expect(asks(text), `the room's code passes: ${text}`).toBe(false);
  const owner = 'src/edge/sync.ts'; // the link's owner: it answers room() from the link itself
  const lines = [...await sourceLines('src/views'), ...await sourceLines('src/edge')];
  const hits = lines.filter(line => line.file !== owner && !isComment(line.text) && asks(line.text));
  expect(report(hits), 'ask app.seat() (alone, gm or player), or pass it to the core rule that differs by seat').toEqual([]);
});

test('a view redraws with the app\'s redraw, never by going to the view shown', async () => {
  // app.go sets the address: a redraw through it, landing between a tab's tap and its hashchange, undoes the tap
  const lines = [...await sourceLines('src/views'), ...await sourceLines('src/edge')];
  const hits = lines.filter(({ text }) => !isComment(text) && /\bapp\.go\((?!'[\w-]+'\))/.test(text));
  expect(report(hits), 'app.go takes the literal id of the view a tap or a flow goes to. To draw the shown view again, call app.redraw().').toEqual([]);
});

test('src/core has no module-level let', async () => {
  const hits = (await sourceLines('src/core')).filter(line => /^(export\s+)?(let|var)\s/.test(line.text));
  expect(report(hits), 'a module-level let in core is hidden state. Take the value as an argument or return it.').toEqual([]);
});

test('only the combat dispatcher writes the fight, in one step with what the command writes beside it', async () => {
  // The patterns the old tracker used: assigning the save's fight or a field of it, changing its lists in place, the
  // `en` of its mut() callbacks, and a store.update that reaches into the fight on one line. Audit row 13: the dispatcher
  // itself was `d.fight = r.fight;` in a store.update, with the hunters' totals written by a nested apply; now the fight
  // and its write-backs are one core step (src/core/combat/fight-save.ts `fought`), which send() hands to store.apply.
  const save = String.raw`(\b(d|s|save|state)|store\.get\(\))\.(encounter|fight)\b`, assign = String.raw`\s*([-+*/]?=(?![=>])|\+\+|--)`;
  const writes = [
    new RegExp(`${save}(\\.\\w+|\\[[^\\]]*\\])*${assign}`),
    new RegExp(`\\ben(\\.\\w+|\\[[^\\]]*\\])+${assign}`),
    new RegExp(`(${save}|\\ben)(\\.\\w+)*\\.(push|splice|sort|unshift|pop|shift|reverse)\\(`),
    /store\.update\(.*\b(encounter|fight)\b/,
  ];
  expect(writes.some(re => re.test('      d.fight = r.fight;')), 'the rule sees the old dispatcher').toBe(true);
  const lines = [...await sourceLines('src/views'), ...await sourceLines('src/edge')];
  const hits = lines.filter(line => !isComment(line.text) && writes.some(re => re.test(line.text)));
  expect(report(hits), 'a fight changes only through send() in src/views/combat.js. Add a command to src/core/combat/fight.ts (see docs/guide/combat.md) and send it.').toEqual([]);
  const steps = (await sourceLines('src')).filter(line => !isComment(line.text) && /\bfought\(/.test(line.text) && !/^export function fought\(/.test(line.text));
  expect(steps.map(line => `${line.file}: ${/store\.apply\(/.test(line.text) ? 'in store.apply' : 'outside store.apply'}`), 'send() in combat.js writes the fight with fight-save.ts `fought`, in one store.apply').toEqual(['src/views/combat.js: in store.apply']);
});

test('only src/core/gates/gate.ts changes a gate\'s status, cleared day or XP paid', async () => {
  // Three bugs came from views writing these by hand: the fight's End guessed "paid" from the status, and the edit form
  // kept a cleared day on a gate it moved back. `clearedDay` and `xpPaid` belong to gates only, so they are checked
  // everywhere. `status` is also a quest's, so it is checked in the view and edge files that read the save's gates.
  const assign = String.raw`\s*([-+*/]?=(?![=>])|\+\+|--)`;
  const gateOnly = new RegExp(String.raw`\b(clearedDay|xpPaid)${assign}|[{,]\s*(clearedDay|xpPaid)\s*:`);
  const status = new RegExp(String.raw`\.status${assign}|[{,]\s*status\s*:\s*['"](${GATE_STATUSES.join('|')})['"]`);
  const owner = 'src/core/gates/gate.ts';
  const src = (await sourceLines('src')).filter(line => line.file !== owner && !isComment(line.text));
  const readsGates = new Set(src.filter(line => /\.gates\b/.test(line.text)).map(line => line.file));
  const ui = (line: Line) => /^src\/(views|edge)\//.test(line.file) && readsGates.has(line.file);
  const hits = src.filter(line => gateOnly.test(line.text) || (ui(line) && status.test(line.text)));
  expect([...readsGates].filter(file => file.startsWith('src/views/')).length, 'the views that read gates are found').toBeGreaterThan(1);
  expect(report(hits), 'a gate changes only through transition() in src/core/gates/gate.ts. Add an event to its table (see docs/guide/gates-solo.md) and send it.').toEqual([]);
});

test('only src/core/gates/preset.ts writes a gate\'s preset', async () => {
  // A gate's clear preset is an explicit machine (`presetStep`, `gatePreset`, `payGatePreset`). No view, edge or other
  // core module writes `preset` on a gate directly; `gate.ts` only supplies `NO_PRESET` in `newGate` and reads it with
  // `parseClearPreset` in `parseGate`.
  const assign = String.raw`\s*([-+*/]?=(?![=>])|\+\+|--)`;
  const write = new RegExp(String.raw`\.preset${assign}|[{,]\s*preset\s*:`);
  const owners = ['src/core/gates/preset.ts', 'src/core/gates/gate.ts'];
  expect(write.test('g.preset = { at: "none" };'), 'the rule sees a dot write').toBe(true);
  expect(write.test('{ ...g, preset: next }'), 'the rule sees a spread write').toBe(true);
  expect(write.test('if (g.preset.at === "edited") return;'), 'and not a read').toBe(false);
  const hits = (await sourceLines('src')).filter(line => !owners.includes(line.file) && !isComment(line.text) && write.test(line.text));
  expect(report(hits), 'change a gate\'s preset only through gatePreset or payGatePreset in src/core/gates/preset.ts.').toEqual([]);
});

test('only src/core/gates/difficulty.ts writes a gate\'s difficulty', async () => {
  // A gate's difficulty is an explicit two-region machine (`difficultyStep`, `withDifficulty`, `gateDifficulty`). No view,
  // edge or other core module writes `difficulty` on a gate directly; `gate.ts` only supplies `DEFAULT_DIFFICULTY` in
  // `newGate`, copies it in `fieldsOf`, and reads it with `parseGateDifficulty` in `parseGate`.
  const assign = String.raw`\s*([-+*/]?=(?![=>])|\+\+|--)`;
  const dotWrite = new RegExp(String.raw`\.difficulty${assign}`);
  const spreadWrite = /\{\s*\.\.\.[^,{}]+,[^{}]*(?<![.\w$])difficulty\s*[:,}]/;
  const writes = (text: string) => dotWrite.test(text) || spreadWrite.test(text);
  const owners = ['src/core/gates/difficulty.ts', 'src/core/gates/gate.ts'];
  expect(writes('g.difficulty = { gate: { at: "default" }, boss: { at: "follows" } };'), 'the rule sees a dot write').toBe(true);
  expect(writes('{ ...g, difficulty: next }'), 'the rule sees a spread write').toBe(true);
  expect(writes('if (g.difficulty.boss.at === "own") return;'), 'and not a read').toBe(false);
  const hits = (await sourceLines('src')).filter(line => !owners.includes(line.file) && !isComment(line.text) && writes(line.text));
  expect(report(hits), 'change a gate\'s difficulty only through withDifficulty or gateDifficulty in src/core/gates/difficulty.ts.').toEqual([]);
});

test('a view sends a room event made by the constructor, never a type name and a payload of its own', async () => {
  // Each view used to build its payload and its event id by hand, so the server, the senders and the appliers drifted.
  const raw = /\.send\(\s*['"`]/;
  const hits = (await sourceLines('src/views')).filter(line => !isComment(line.text) && raw.test(line.text));
  expect(report(hits), 'post a built event: app.api.sync.post(app.api.sync.event(type, body)). The event is newEvent in src/core/protocol.ts.').toEqual([]);
});

test('only src/core/protocol.ts makes a room event id', async () => {
  // In TypeScript only a cast makes an EventId (ids.ts casts in its parser). In JavaScript: an eid written into a body,
  // or an eid maker.
  const cast = /\bas\s+EventId\b/, inJs = [/[{,]\s*eid\s*[:,}]/, /\beid\s*=\s*\(\)\s*=>/];
  const owners = ['src/core/protocol.ts', 'src/core/ids.ts'];
  const makes = (line: Line) => cast.test(line.text) || (line.file.endsWith('.js') && inJs.some(re => re.test(line.text)));
  const hits = (await sourceLines('src')).filter(line => !owners.includes(line.file) && !isComment(line.text) && makes(line));
  expect(report(hits), 'newEvent in src/core/protocol.ts makes the id of every event it builds. Build the event with it.').toEqual([]);
});

test('every module of src/edge names the state it keeps for the page: each let and each Map or Set, with what it holds', async () => {
  // sync.js had about 15 module-level variables; four of them made the pill, and create, join, rejoin and leave each
  // reset a different subset. Now the link and the push hold the state, and the rest is the edge's own, named at the
  // top of sync.ts and in docs/agent-handoff/p3/notes-link.md. The list named three files; the rules' source and cache,
  // the store's save, life, prefs and device, and report.ts's seen errors were in none, so a new flag in store.ts or
  // rules.ts passed every lint (implicit audit 2, N15). Every file of src/edge is read now.
  const named: Record<string, string> = {
    'sync.ts link': 'the link machine\'s state (src/core/sync/link.ts)', 'sync.ts push': 'the push machine\'s state (src/core/sync/push.ts)',
    'sync.ts attempt': 'the Create or Join tap machine\'s state (src/core/sync/attempt.ts)', 'sync.ts shown': 'what the room showed at the last poll',
    'sync.ts srvSkew': 'the server clock\'s distance from this one', 'sync.ts lastOk': 'when a request last came back',
    'sync.ts sheetText': 'the bound sheet as the push last sent it', 'sync.ts invited': 'the invite this tab holds', 'sync.ts boundSeen': 'the bound hunter as the push was last told of it', 'sync.ts removal': 'the REMOVED FROM ROOM notice (src/core/sync/bind.ts)',
    'sync.ts running': 'whether the outbox\'s flush is running', 'sync.ts stamped': 'the time in the id of the last event this page made',
    'upgrade.ts update': 'the update machine\'s state (src/core/upgrade.ts)', 'upgrade.ts quiet': 'the timer of the quiet reload',
    'rules.ts sourceOf': 'the store\'s save, bound at start (`bindSave`)', 'rules.ts roomRulesOf': 'the room\'s rules doc (its build and personal gates\' switches and the economy\'s rules), bound by sync.ts (`bindRoom`)',
    'rules.ts made': 'the rules in force and the overrides, statuses and room rules they were made from',
    'store.ts prefs': 'this phone\'s prefs as read and written', 'store.ts device': 'whether this phone\'s memory is kept or failing',
    'store.ts state': 'the save', 'store.ts flushTimer': 'the one wait for the save\'s next write: none, the next frame with a second\'s fallback, or the task after that frame (FlushTimer)', 'store.ts life': 'the store\'s life machine\'s state (src/core/store-life.ts)',
    'sync.ts FIGHT_MOVES': 'a constant: the room messages that are a player\'s own moves in the GM\'s fight',
    'sync.ts inflight': 'the open requests of each gen, so the link\'s `abort` drops them', 'sync.ts timers': 'the poll\'s and the push\'s one timer each, set by their machines\' effects',
    'sync.ts publishers': 'what builds each doc the GM\'s phone publishes',
    'sync.ts publishing': 'each room doc\'s publish machine\'s state (src/core/sync/publish.ts)', 'sync.ts peeked': 'the Room view\'s code checks, reused for 30 s',
    'upgrade.ts watchers': 'what is told of the update machine\'s state (the pill)',
    'store.ts subs': 'the store\'s subscribers', 'store.ts noticeOf': 'the notice step\'s session and fight hold, bound by sync.ts (`bindNotice`)', 'report.ts seen': 'each error already reported, by place and message, so each is logged once',
  };
  const container = /^(?:new\s+(?:Weak)?(?:Map|Set)\b)/;
  const old = "const subs = new Set<(change: Change) => void>();\nlet state: Save = loaded.save;\nexport function register(app) {\n  let link = 1;\n  function f() { let local = 0; }\n}";
  expect(pageLets(old).map(l => l.text.split(/[\s:=]/)[0]), 'the rule sees the store\'s save, a register\'s let, and not a function\'s own').toEqual(['state', 'link']);
  const found: string[] = [];
  for (const name of (await readdir(`${ROOT}/src/edge`)).filter(n => /\.ts$/.test(n)).sort()) {
    const text = await Bun.file(`${ROOT}/src/edge/${name}`).text();
    for (const d of pageLets(text)) for (const p of splitTop(d.text)) found.push(`${name} ${/^\s*([\w$]+)/.exec(p)?.[1] ?? p}`);
    for (const d of pageLets(text, 'const')) for (const p of splitTop(d.text)) { const m = /^([\w$]+)\s*(?::[^=]*)?=\s*([\s\S]*)$/.exec(p); if (m && container.test(m[2]!.trim())) found.push(`${name} ${m[1]}`); }
  }
  expect(found.filter(k => !(k in named)), 'new link or push state goes in src/core/sync/link.ts or push.ts; edge state of its own is named here with what it holds (and at the top of its file)').toEqual([]);
  expect(Object.keys(named).filter(k => !found.includes(k)), 'a state that is gone leaves the list').toEqual([]);
});

test('a Create or Join tap moves only through attemptDo in src/edge/sync.ts, with a step of src/core/sync/attempt.ts', async () => {
  // The tap was an object of nullable fields that begin, settleAttempt and notice each wrote, and a second tap got the
  // first tap's promise (audit SM-sync-2). Its one state is now moved by one function, with what attemptStep answers.
  const writes = /\battempt\s*(=(?![=>])|\.\w+\s*=(?!=))/;
  expect(writes.test('if (attempt) attempt.notice = id;') && writes.test('attempt = null;'), 'the rule sees the old writes').toBe(true);
  const lines = (await sourceLines('src/edge')).filter(line => !isComment(line.text) && writes.test(line.text));
  const hits = lines.filter(line => !(line.file === 'src/edge/sync.ts' && /^\s*attempt = r\.state;$/.test(line.text)));
  expect(lines.length - hits.length, 'the one write, in attemptDo, is found').toBe(1);
  expect(report(hits), 'raise an event of src/core/sync/attempt.ts through attemptDo, and add its cell to the table there (docs/guide/room-sync.md).').toEqual([]);
});

test('only src/edge/sync.ts writes the room, cursor, last room and GM key of the save', async () => {
  // The link's `save` effect writes them; a view that wrote one put the save and the link in two different rooms.
  const owners = ['src/edge/sync.ts', 'src/core/save.ts'];
  const writes = /\.(room|cursor|lastRoom|gmKey)\s*=(?!=)|Object\.assign\([^,]*\.sync\b/;
  const lines = [...await sourceLines('src/views'), ...await sourceLines('src/edge'), ...(await sourceLines('src')).filter(l => l.file === 'src/app.js')];
  const hits = lines.filter(line => !owners.includes(line.file) && !isComment(line.text) && writes.test(line.text));
  expect(report(hits), 'ask the link: app.api.sync.joinRoom, rejoinGM, create, leave, forgetLast or forgetKey. The link saves what changes.').toEqual([]);
});

test('only src/core/coin.ts writes the save\'s coins and calls', async () => {
  // A coin's side is written by its table (src/core/coin.ts) from one place, so nothing else can store how a side was chosen.
  // The lint named coin.js and saw only `.coins =`, while the writer is coin.ts by spread (`{ ...save, coins: ... }`),
  // so it held nothing (implicit audit 2, step 3): it names the writer and sees a field in an object literal too.
  const owners = ['src/core/coin.ts', 'src/core/save.ts'];
  const writes = /\.(coins|calls)\s*=(?!=)|[{,]\s*(coins|calls)\s*:/;
  expect(writes.test('export const coinRolled = <S extends CoinSave>(save: S, coin: Coin): S => ({ ...save, coins: addCoin(save.coins, coin) });'), 'the rule sees a spread write').toBe(true);
  const hits = (await sourceLines('src')).filter(line => !owners.includes(line.file) && !isComment(line.text) && writes.test(line.text));
  expect(report(hits), 'ask app.api.coin, or add the change as a step of src/core/coin.ts through the coin\'s table.').toEqual([]);
});

test('only src/core/hunter/progress.ts changes a hunter\'s level, XP, peak level or ability points', async () => {
  // Bug 1: every writer kept a points counter in step by hand, and nothing recorded which levels had paid, so a lost
  // level regained paid its points and its HP refill twice. A view assigns what a progress function answers
  // (`Object.assign(h, gainXp(h, n, rules()).progress)`). `level` is also a skill's and a shadow's: those two are allowed.
  const assign = String.raw`\s*([-+*/]?=(?![=>])|\+\+|--)`;
  const field = new RegExp(String.raw`\.(xp|peakLevel|bonusPoints|spent|points)${assign}`);
  const level = new RegExp(String.raw`(\w+)\.level${assign}`);
  // a skill's (`k`) and a shadow's (`s`) level were permitted in skills.js and shadows.js long after neither wrote one
  // (implicit audit 2, step 3); a level write anywhere else is a hunter's
  const owners = ['src/core/hunter/progress.ts', 'src/core/hunter/hunter.ts'];
  const writes = (line: Line) => field.test(line.text) || level.test(line.text);
  const old: Line = { file: 'src/views/hunter.js', line: 0, text: 'h.level++; h.points = Math.max(0, h.points + pts);' };
  expect(writes(old), 'the rule sees the old counter').toBe(true);
  const hits = (await sourceLines('src')).filter(line => !owners.includes(line.file) && !isComment(line.text) && writes(line));
  expect(report(hits), 'level, XP and points change only through src/core/hunter/progress.ts (gainXp, setLevel, spend, refund, grantPoints, setPoints). Assign what it answers.').toEqual([]);
});

test('only src/core/hunter/progress.ts changes a hunter\'s stats or the points pending on them', async () => {
  // the owner: a point put on a stat and taken off before Confirm did not come back (ab79803). The allocation was two
  // full stat lists a view compared, with three writers and a GM branch. Now `stats` are the confirmed stats and
  // `pending` the points not yet confirmed, and raise, lower, confirm, raiseMany, setStat and startingStats own them.
  // A monster's or a fight row's stats are not a hunter's: the fight's modules and the monster maker are left out.
  const writes = /(?<![\w$])(h|x|hunter|p)\.(stats|pending)\b\s*(\[[^\]]*\]\s*)?([-+*/]?=(?![=>])|\+\+|--)|\b(h|x|hunter)\.(stats|pending)\s*=/;
  const owners = ['src/core/hunter/progress.ts', 'src/core/hunter/hunter.ts'];
  const old: Line = { file: 'src/views/hunter.js', line: 0, text: 'if (paid) { Object.assign(h, paid); h.stats[k]++; } else if (gm) { h.stats[k]++; h.statsLocked[k] = h.stats[k]; }' };
  expect(writes.test(old.text), 'the rule sees the old stat write').toBe(true);
  expect(writes.test('const h = startingStats(x, p.stats); h.pending[k] -= 1;'), 'and a pending write').toBe(true);
  const hits = (await sourceLines('src')).filter(line => !owners.includes(line.file) && !isComment(line.text) && writes.test(line.text));
  expect(report(hits), 'change stats and pending points only through src/core/hunter/progress.ts (raise, lower, confirm, raiseMany, setStat, startingStats), in store.apply.').toEqual([]);
});

test('only src/core/hunter/vitals.ts changes a hunter\'s HP, mana, fatigue, life or collapse, and nothing names the chips drawn from them', async () => {
  // A hunter's HP, its Down chip and its death saves were three stores that `settle()` re-synced after every
  // change, and a "dead" hunter stood up on any heal. Now `life` is one state with one event table. A view assigns what
  // a vitals function answers (`Object.assign(h, hit(h, event, maxima))`) and reads HP through `app.api.hunter.sheet(h).hp`.
  // A shadow (`s`) is not a hunter: its HP is written by core shadows.ts (the fight's shadowHp effect, the Shadows panel).
  const assign = String.raw`\s*([-+*/]?=(?![=>])|\+\+|--|\|\|=)`;
  const field = new RegExp(String.raw`(\w+)\.(hp|mana|fatigue|life|collapsed|deathSaves)${assign}`, 'g');
  // `down` is a plain word elsewhere (a body, a pointer, a database), so it counts only as a key or a chip's argument.
  const chip = /['"]exhausted['"]|(?:addC|key|chip|Chip)\W[^'"\n]*['"]down['"]/;
  const owners = ['src/core/hunter/vitals.ts', 'src/core/hunter/hunter.ts'];
  // chips.ts draws the chips: it is the one place that may name one (the chip at 0 HP reads the life's word there).
  const chipNamers = [...owners, 'src/core/hunter/chips.ts', 'src/core/registry/statuses.ts'];
  const writes = (line: Line) => [...line.text.matchAll(field)].length > 0;
  const old: Line = { file: 'src/views/hunter.js', line: 0, text: "if (h.hp <= 0) { if (addC(h, 'down')) h.deathSaves ||= { s: 0, f: 0, stable: false }; } else h.hp = 1;" };
  expect(writes(old), 'the rule sees the old HP write').toBe(true);
  expect(chip.test(old.text), 'the rule sees the old chip').toBe(true);
  const lines = (await sourceLines('src')).filter(line => !isComment(line.text));
  const hits = lines.filter(line => (!owners.includes(line.file) && writes(line)) || (!chipNamers.includes(line.file) && chip.test(line.text)));
  expect(report(hits), 'HP, mana, fatigue, life and collapse change only through src/core/hunter/vitals.ts (hit, changeMana, setMana, changeFatigue, setFatigue, rest, refill, fitMaxima). Assign what it answers; draw the chips with chipsOf.').toEqual([]);
});

test('only grant.ts sheetEdit changes a hunter\'s rests taken in a gate, through rests.ts restStep', async () => {
  // the owner, Nov 22: two rests a gate, and everything back at its Clear. The count moves with the rest's vitals or the
  // Clear's in one answer (grant.ts `edited`); a second writer could count a rest whose vitals were never given.
  const writes = /\.restsTaken\s*([-+*/]?=(?![=>])|\+\+|--)|\brestsTaken\s*:/;
  expect(writes.test('h.restsTaken += 1;') && writes.test('({ ...h, restsTaken: 0 })'), 'the rule sees a write').toBe(true);
  const owners = ['src/core/hunter/grant.ts', 'src/core/hunter/hunter.ts'];
  const hits = (await sourceLines('src')).filter(line => !owners.includes(line.file) && !isComment(line.text) && writes.test(line.text));
  expect(report(hits), 'change a hunter\'s rests only through sheetEdit (grant.ts) with a rest, a Clear or a gate left (rests.ts restStep).').toEqual([]);
});

test('only grant.ts changes a hunter\'s revive standing, and only grant.ts and inventory.ts change debt, through standingStep and debtStep', async () => {
  // World rule 6 and the owner's System raise (Nov 22): the standing, the life and the debt move in one write in
  // `systemRaise`, gate clear gold pays down debt in `grant`, and shop borrowing adds debt in `inventory.ts` `buy`,
  // all through `standingStep` and `debtStep`. A second writer could spend a raise the hunter never took, bypass the
  // borrow cap, or collect debt on non-clear gold.
  const reviveWrites = /\.reviveLeft\s*([-+*/]?=(?![=>])|\+\+|--)|\breviveLeft\s*:(?!\s*ReviveStanding\b)/;
  const debtWrites = /\.debt\s*([-+*/]?=(?![=>])|\+\+|--)|\bdebt\s*:(?!\s*number\b)/;
  expect(reviveWrites.test('h.reviveLeft = \'debt\';') && debtWrites.test('({ ...h, debt: h.debt + 1000 })'), 'the rule sees a write').toBe(true);
  expect(debtWrites.test('  debt: number;'), 'and not the type').toBe(false);
  const reviveOwners = ['src/core/hunter/grant.ts', 'src/core/hunter/hunter.ts'];
  // revive-standing.ts keys its tables by the standing, whose name `debt` is the field's
  const debtOwners = ['src/core/hunter/grant.ts', 'src/core/hunter/inventory.ts', 'src/core/hunter/hunter.ts', 'src/core/hunter/revive-standing.ts'];
  const lines = (await sourceLines('src')).filter(line => !isComment(line.text));
  const reviveHits = lines.filter(line => !reviveOwners.includes(line.file) && reviveWrites.test(line.text));
  const debtHits = lines.filter(line => !debtOwners.includes(line.file) && debtWrites.test(line.text));
  expect(report(reviveHits), 'change a hunter\'s revive standing only through grant.ts (`systemRaise`), which steps revive-standing.ts `standingStep`.').toEqual([]);
  expect(report(debtHits), 'change a hunter\'s debt only through grant.ts (`systemRaise` and `grant`) or inventory.ts (`buy`), which step revive-standing.ts `debtStep`.').toEqual([]);
});

test('only src/core/hunter/penalty.ts changes a hunter\'s penalty, and nothing else names the Penalized chip', async () => {
  // A missed daily was stored three ways (the penalty, a Penalized condition and an active quest of kind penalty) and
  // three writers kept them in step by hand, so a cure, a combat card or a GM edit left them disagreeing. Now the
  // penalty is tied to its quest by id: a view assigns what `penaltyAfter` answers, and the chip is drawn by chipsOf.
  const writes = /\.penalty\s*([-+*/]?=(?![=>])|\|\|=)|\bpenalty\s*:\s*\{/;
  const chip = /['"]penalized['"]/;
  const owners = ['src/core/hunter/penalty.ts', 'src/core/hunter/hunter.ts'];
  const old: Line = { file: 'src/views/quests.js', line: 0, text: "h.penalty = h.penalty ? { since: h.penalty.since, days } : { since: iso(), days }; h.conditions.push({ key: 'penalized', rounds: null });" };
  expect(writes.test(old.text), 'the rule sees the old penalty write').toBe(true);
  expect(chip.test(old.text), 'the rule sees the old condition').toBe(true);
  const hits = (await sourceLines('src')).filter(line => !owners.includes(line.file) && !isComment(line.text) && (writes.test(line.text) || chip.test(line.text)));
  expect(report(hits), 'the penalty changes only through src/core/hunter/penalty.ts (penaltyAfter). Assign what it answers; draw the chip with chipsOf.').toEqual([]);
});

test('only src/core/hunter/job-chain.ts changes a hunter\'s Job Change chain, and nothing writes a quest\'s chain fields', async () => {
  // The chain was smeared across three quest fields (chainId, step, chainJob) and advanced by a `change` listener that
  // wrote the store behind a `syncing` flag, with no failed state. Now `jobChain` on the hunter is the chain: a view
  // assigns what `chainAfter` answers, and the step quests come from its `issueQuest` effect (stepQuest sets chainId).
  const writes = /\.jobChain\s*([-+*/]?=(?![=>])|\|\|=)|\bjobChain\s*:\s*\{|\.(chainId|step|chainJob)\s*=(?![=>])|\bchainJob\b|\bchainId\s*:/;
  const owners = ['src/core/hunter/job-chain.ts', 'src/core/hunter/hunter.ts'];
  const old: Line = { file: 'src/views/quests.js', line: 0, text: 'if (partial.chainId) { q.chainId = String(partial.chainId).slice(0, 40); q.step = clampInt(partial.step, 1, 99) || 1; }' };
  expect(writes.test(old.text), 'the rule sees the old quest chain write').toBe(true);
  const hits = (await sourceLines('src')).filter(line => !owners.includes(line.file) && !isComment(line.text) && writes.test(line.text));
  expect(report(hits), 'the Job Change chain changes only through src/core/hunter/job-chain.ts (chainAfter). Assign what it answers; push the quest its issueQuest effect carries.').toEqual([]);
});

test('only src/core/hunter/inventory.ts changes what a hunter wears', async () => {
  // What one item is to a hunter (in the bag, worn, gone) is one machine, the wear's `TABLE` and `wearMove` in
  // inventory.ts, and `equipped` is its stored half: `wearIn`, `emptySlot` and `unwear` there are its writes, and the
  // save's repair (`fixRefs` in hunter.ts) reads a stored one through `parseWorn`. A second writer could wear an item
  // in a slot it does not fit, wear one item twice, or change gear in a fight. Loadouts and the views go through them.
  const owners = ['src/core/hunter/inventory.ts', 'src/core/hunter/hunter.ts'];
  // Not a change of wear: a seed made neutral has no items, so nothing worn; hunters added from a file keep what they
  // wear under the ids they are given.
  const notWear: Record<string, string> = { 'src/core/hunter/identity.ts': 'equipped: newEquipped()', 'src/core/hunter/imported.ts': 'h.equipped[slot] = moved(items, h.equipped[slot])' };
  const write = /\.equipped\s*(\[[^\]]*\]\s*)?(?:[-+*/]?=(?![=>])|\?\?=|\|\|=)|[{,]\s*equipped\s*:/;
  for (const text of ['if (h.equipped[s] === id) h.equipped[s] = null;', 'return { ...h, equipped: { ...h.equipped, [slot]: id } };']) expect(write.test(text), `the rule sees ${text}`).toBe(true);
  expect(write.test('const w = h.items.find(i => i.id === h.equipped[\'weapon\']);'), 'and not a read').toBe(false);
  const all = (await sourceLines('src')).filter(line => !owners.includes(line.file) && !isComment(line.text) && write.test(line.text));
  const permitted = (line: Line) => notWear[line.file] !== undefined && line.text.includes(notWear[line.file]!);
  expect(Object.keys(notWear).filter(f => !all.some(l => l.file === f && permitted(l))), 'a permit that permits nothing leaves the list').toEqual([]);
  expect(report(all.filter(line => !permitted(line))), 'what a hunter wears changes only through src/core/hunter/inventory.ts (equip, unequip, editItem, removeItem, sell; wearIn and emptySlot for a loadout), each asking the wear\'s TABLE first. Assign what it answers.').toEqual([]);
});

test('only src/core/hunter/shadows.ts changes a shadow\'s summoned and HP, through stepShadow', async () => {
  // A shadow's place (resting, summoned, released) and its HP are one machine (`stepShadow` and its `TABLE`, rules-10):
  // a released shadow refuses a heal and the fight's write-back, and a summon is refused while it is out. A second
  // writer of `summoned` or of a shadow's `hp` would go around the table. hunter.ts holds the type, its default and the
  // save's repair; a hunter's own HP is the life machine's (the vitals rule above).
  const owners = ['src/core/hunter/shadows.ts', 'src/core/hunter/hunter.ts'];
  const summoned = /\.summoned\s*(?:=(?![=>])|\?\?=|\|\|=)|[{,]\s*summoned\s*:/;
  // A shadow's HP is told apart from a hunter's or a row's by the file: one that reads a hunter's shadows.
  const hpWrite = /[\w$)\]!]\.hp\s*(?:[-+*/]?=(?![=>])|\?\?=|\|\|=)|\{\s*\.\.\.[^,{}]+,[^{}]*(?<![.\w$])hp\s*:/;
  for (const text of ['s.summoned = !s.summoned;', 'h.shadows = h.shadows.map(x => x.id === sid ? { ...x, summoned: true } : x);']) expect(summoned.test(text), `the rule sees ${text}`).toBe(true);
  for (const text of ['s.hp = Math.max(0, e.hp);', 'h.shadows = h.shadows.map(x => x.id === sid ? { ...x, hp: full } : x);']) expect(hpWrite.test(text), `the rule sees ${text}`).toBe(true);
  expect(summoned.test('const out = h.shadows.filter(x => x.summoned);') || hpWrite.test('const left = s.hp > 0;'), 'and not a read').toBe(false);
  const lines = (await sourceLines('src')).filter(line => !owners.includes(line.file) && !isComment(line.text));
  const readsShadows = new Set(lines.filter(line => /\.shadows\b/.test(line.text)).map(line => line.file));
  const hits = lines.filter(line => summoned.test(line.text) || (readsShadows.has(line.file) && hpWrite.test(line.text)));
  expect(report(hits), 'a shadow is summoned, dismissed, released, healed or left at a fight\'s HP only by stepShadow in src/core/hunter/shadows.ts (setShadowHp, healShadow). Assign what it answers.').toEqual([]);
});

test('only src/core/hunter/record.ts changes a hunter\'s rank', async () => {
  // A rank moves by the rank's machine (`rankStep`, `RANK_TABLE`, U11): the GM's choice, Re-evaluate when it is behind
  // the level, kept when the level moves; a new rank is a fact of the chronicle in the same step. hunter.ts holds the
  // type and the save's repair. A second writer would skip the fact or re-evaluate a rank that is not behind.
  const owners = ['src/core/hunter/record.ts', 'src/core/hunter/hunter.ts'];
  // Not a hunter's rank: a gate's (its edit, a roll), a rarity's in the room's rules, a rule override's entry, the
  // codex's filter, and the rank typed for a monster in the GM's quick add.
  const notHunters: Record<string, string> = {
    'src/core/gates/world.ts': 'rank: g.rank', 'src/views/gates.js': 'rank: roll.rank', 'src/core/hunter/build.ts': 'room.rarities[r].rank',
    'src/core/overrides.ts': '{ ...kept, rank }', 'src/views/bestiary.js': 'f.rank', 'src/views/combat.js': 'o.rank',
  };
  const write = /[\w$)\]!]\.rank\s*(?:=(?![=>])|\?\?=|\|\|=)|\{\s*\.\.\.[^,{}]+,[^{}]*(?<![.\w$])rank\s*[:,}]/;
  for (const text of ['h.rank = rankForLevel(rules(), h.level);', 'return { ...h, rank: e.rank };', 'store.update(s => ({ ...h, rank }));']) expect(write.test(text), `the rule sees ${text}`).toBe(true);
  expect(write.test('const r = rankStanding(h, rules()); if (h.rank === r.earns) return;'), 'and not a read').toBe(false);
  const all = (await sourceLines('src')).filter(line => !owners.includes(line.file) && !isComment(line.text) && write.test(line.text));
  const permitted = (line: Line) => notHunters[line.file] !== undefined && line.text.includes(notHunters[line.file]!);
  expect(Object.keys(notHunters).filter(f => !all.some(l => l.file === f && permitted(l))), 'a permit that permits nothing leaves the list').toEqual([]);
  expect(report(all.filter(line => !permitted(line))), 'a hunter\'s rank changes only through rankStep in src/core/hunter/record.ts (setRank, reevaluate; grant.ts `levelled` gives it levelMoved). Assign what it answers; a rank that is not a hunter\'s goes in this rule\'s list with what it is.').toEqual([]);
});

test('only src/views/dice.js moves the quick check\'s DC, and only by dcPickStep', async () => {
  // The Dice view's quick check DC is one machine (src/core/dc-pick.ts, SMX-views-13): it opens on one default for every
  // hunter (`DC_START`) and a pick makes it the player's (`dcPickStep`). The view keeps one `dc`; a second value or a write
  // that is not a step would drop the player's pick at a redraw, or hold a number the GM's rank table no longer gives.
  const owners = ['src/core/dc-pick.ts', 'src/views/dice.js'];
  const names = /\b(dcPickStep|DC_START)\b/;
  const lines = (await sourceLines('src')).filter(line => !isComment(line.text));
  expect(report(lines.filter(line => !owners.includes(line.file) && names.test(line.text))), 'the quick check\'s DC is the Dice view\'s: move it in src/views/dice.js through dcPickStep').toEqual([]);
  const assign = /(?<![\w$.])dc\s*=(?![=>])/, stepped = /=\s*(quickChecks \? )?(dcPickStep\(|DC_START\b)/;
  expect(assign.test('dc = { at: \'chosen\', key };') && !stepped.test('dc = { at: \'chosen\', key };'), 'the rule sees a write by hand').toBe(true);
  const dice = lines.filter(line => line.file === 'src/views/dice.js' && assign.test(line.text));
  expect(dice.length, 'the rule finds dice.js\'s dc').toBeGreaterThan(0);
  expect(report(dice.filter(line => !stepped.test(line.text))), 'set the DC only to what dcPickStep answers (or DC_START, as the view opens)').toEqual([]);
});

test('a choice from a list is read with the one oneOf in src/core/one-of.ts', async () => {
  // save.ts, gate.ts, spawn.ts, protocol.ts and store.ts each kept a private copy, with three different signatures.
  const lines = [...await sourceLines('src/core'), ...await sourceLines('src/edge'), ...await sourceLines('src/views')];
  const hits = lines.filter(({ file, text }) => file !== 'src/core/one-of.ts' && /\b(const|function)\s+oneOf\b/.test(text));
  expect(report(hits), 'import { oneOf } from src/core/one-of.ts').toEqual([]);
});

test('a time is shown in rounds only through roundsOf in src/core/combat/timeline.ts', async () => {
  // Ticks to rounds with one decimal was written a dozen times with two roundings: the GM's card rounded up, a player's table to nearest.
  const lines = [...await sourceLines('src/core'), ...await sourceLines('src/edge'), ...await sourceLines('src/views')];
  const hits = lines.filter(({ file, text }) => file !== 'src/core/combat/timeline.ts' && !isComment(text) && /\/\s*[\w.()]*round\s*\*\s*10\b/.test(text));
  expect(report(hits), "roundsOf(ticks, R, 'near') for a length, 'up' for what is left of something running").toEqual([]);
});

test('a quest\'s status and end time are set together by questState', async () => {
  // A status beside a date: five writers in quests.js set both by hand. One call sets both, so they cannot disagree.
  const lines = [...await sourceLines('src/core'), ...await sourceLines('src/edge'), ...await sourceLines('src/views')];
  const hits = lines.filter(({ text }) => !isComment(text) && /\.doneAt\s*=[^=]/.test(text));
  expect(report(hits), 'Object.assign(q, questState(status, at)) from src/core/hunter/hunter.ts').toEqual([]);
});

test('no browser code uses AbortSignal.timeout or AbortSignal.any, which iOS 15 lacks', async () => {
  const lines = [...await sourceLines('src/core'), ...await sourceLines('src/edge'), ...await sourceLines('src/views')];
  const hits = lines.filter(({ text }) => !isComment(text) && /AbortSignal\.(timeout|any)\b/.test(text));
  expect(report(hits), 'time a request out with setTimeout and an AbortController').toEqual([]);
});

test('a view never scrolls on a timer: the page moves in answer to an event, not some ms after one', async () => {
  // maker.js scrolled a focused field to the middle 250 ms after focus, standing in for "the keyboard has opened". A tap
  // made inside those 250 ms landed after the form jumped under the finger (push 26: the name chip's tap went 295 px off).
  const timed = /setTimeout\(/, moves = /\.scroll(IntoView|To|By)?\(|scrollTop\s*=/;
  const old: Line = { file: 'src/views/maker.js', line: 0, text: "el.addEventListener('focusin', e => { setTimeout(() => { e.target.scrollIntoView({ block: 'center' }); }, 250); });" };
  expect(timed.test(old.text) && moves.test(old.text), 'the rule sees the old delayed scroll').toBe(true);
  const hits = (await sourceLines('src/views')).filter(({ text }) => !isComment(text) && timed.test(text) && moves.test(text));
  expect(report(hits), 'scroll on the event that moves the page (the visual viewport\'s resize for the keyboard: `fit` in maker.js)').toEqual([]);
});

test('a window opens on the one window stack of src/views/ui.js: a view that draws aria-modal calls openWindow, and only ui.js keeps Tab in a window', async () => {
  // Three window systems (the System queue, the maker's own stack, onboarding's overlay) each had a document keydown
  // listener: Escape on a question over a maker closed both, and "is a window open" was two DOM selectors that disagreed.
  const trap = /querySelectorAll\(FOCUSABLE\)|document\.addEventListener\('keydown'/;
  const old: Line = { file: 'src/views/onboard.js', line: 0, text: "const f = [...root.querySelectorAll(FOCUSABLE)]; document.addEventListener('keydown', key, true);" };
  expect(trap.test(old.text), 'the rule sees the old trap').toBe(true);
  const lines = await sourceLines('src/views');
  const traps = lines.filter(({ file, text }) => file !== 'src/views/ui.js' && !isComment(text) && trap.test(text) && /FOCUSABLE|'Tab'|Escape|key,/.test(text));
  expect(report(traps), 'open the window with openWindow (ui.js): the stack hands its key handler the keys, and trapTab keeps Tab in it').toEqual([]);
  const files = (re: RegExp) => new Set(lines.filter(({ text }) => !isComment(text) && re.test(text)).map(l => l.file));
  const opens = files(/\bopenWindow\(/), modal = [...files(/aria-modal="true"/)].filter(f => f !== 'src/views/ui.js' && !opens.has(f));
  expect(modal, 'a modal window goes on the stack with openWindow, or is a System window (ui.system)').toEqual([]);
});

test('the seed hunter is told by its seed mark, never by its name or its starting fields', async () => {
  // starter.js told the seed by `h.name === 'Sung Jin-Woo' && h.level === 1 && h.titleId === 't1' && h.items.length === 2`:
  // a rename of the canon data or a tweak of its kit made the seed a player's hunter. `seedOf` (src/core/starter.ts) reads `seed`.
  const byName = /['"]Sung Jin-Woo['"]/;
  const old: Line = { file: 'src/views/starter.js', line: 0, text: "export const isPristineSeed = h => !!h && h.name === 'Sung Jin-Woo' && h.level === 1;" };
  expect(byName.test(old.text), 'the rule sees the old test').toBe(true);
  const lines = [...await sourceLines('src/core'), ...await sourceLines('src/edge'), ...await sourceLines('src/views')];
  const hits = lines.filter(({ file, text }) => !isComment(text) && byName.test(text) && !(file === 'src/core/save.ts' && /h\.name = /.test(text)));
  expect(report(hits), 'ask seedOf(save) (src/core/starter.ts); only starterHunter in save.ts names the seed').toEqual([]);
});

test('a view never keeps the time of its own send to judge room data by', async () => {
  // combat.js kept `lastSent.set(remote, Date.now())` and ignored a player's sheets for 12 s after, standing in for "has
  // this sheet seen my change?". A slow phone's stale sheet then overwrote the GM's change. Now a fight row's numbers
  // have one writer, the fight, and a player's sheet never overwrites them, so there is nothing to wait for.
  const time = /\bDate\.now\(\)/, send = /sent|send/i;
  const old: Line = { file: 'src/views/combat.js', line: 0, text: 'if (remote) lastSent.set(remote, Date.now());' };
  expect(time.test(old.text) && send.test(old.text), 'the rule sees the old grace stamp').toBe(true);
  const hits = (await sourceLines('src/views')).filter(({ text }) => !isComment(text) && time.test(text) && send.test(text));
  expect(report(hits), 'a fight row\'s numbers have one writer, the fight (combat.js `send`); a player\'s sheet only joins a row, never overwrites one').toEqual([]);
});

test('only parseItem builds an item from outside data, and only parseMonster a monster', async () => {
  // An item had four readers with four sets of bounds (fixItem in save.ts, givenItem in protocol.ts, clean in
  // inventory.js, cleanItem in quests.js), and a monster two (clean in bestiary.js and the save repair), so the same item
  // held 999 or 9999 depending on how it arrived. Each kind now has one parser, run by every path.
  const names = 'clean|cleanItem|fixItem|givenItem|stripItem|cleanMonster|fixMonster';
  const defines = new RegExp(String.raw`\bfunction\s+(${names})\s*\(|\b(const|let)\s+(${names})\s*=\s*(\(|\w+\s*=>|function\b)`);
  const old: Line[] = [
    { file: 'src/views/inventory.js', line: 0, text: 'function clean(raw) {' },
    { file: 'src/views/quests.js', line: 0, text: '  const cleanItem = it => {' },
    { file: 'src/views/bestiary.js', line: 0, text: '  const clean = (m, id) => ({' },
  ];
  for (const line of old) expect(defines.test(line.text), `the rule sees ${line.text.trim()}`).toBe(true);
  const hits = (await sourceLines('src')).filter(line => !isComment(line.text) && defines.test(line.text));
  expect(report(hits), 'read an item with parseItem (src/core/registry/items.ts) and a monster with parseMonster (src/core/registry/monsters.ts); add a bound there, once').toEqual([]);
});

test('no view or edge module reads statuses from the rule overrides', async () => {
  // The GM's statuses were kept in rulesOverrides.conditions with a `custom: true` mark, beside the rule numbers, and the
  // rules editor saved anything under that key unchecked. They live in library.statuses now; the save moves old ones at load.
  const reads = /rulesOverrides\b[\w\s|{}()?.]*?\.conditions\b|\bov\(\)\.conditions\b/;
  const old: Line = { file: 'src/views/forge.js', line: 0, text: "const c = (store().get().rulesOverrides || {}).conditions; return c;" };
  expect(reads.test(old.text), 'the rule sees the old library read').toBe(true);
  const lines = [...await sourceLines('src/edge'), ...await sourceLines('src/views')];
  const hits = lines.filter(line => !isComment(line.text) && reads.test(line.text));
  expect(report(hits), 'read and write the GM\'s statuses in store.get().library.statuses; rules().conditions has them merged over the built-ins').toEqual([]);
});

// ── the fight's boundaries (milestone 2): the views draw and send, the fight's modules own every fight number ──

/** Each source file of `dir` with its whole text, for a rule that reads across lines. */
async function sourceTexts(dir: string): Promise<{ file: string; text: string }[]> {
  const names = (await readdir(`${ROOT}/${dir}`, { recursive: true })).filter(name => /\.(ts|js)$/.test(name)).sort();
  return Promise.all(names.map(async name => ({ file: `${dir}/${name}`, text: await Bun.file(`${ROOT}/${dir}/${name}`).text() })));
}

test('a view or core rolls nothing of its own: every die, every pick and every random draw comes from src/edge/roll.ts', async () => {
  // The old combat.js rolled initiative, the hit, the damage and each status tick with Math.random of its own, and a
  // player's card rolled again its own way, so one use rolled differently on two phones. Every die of a fight is rolled
  // by src/edge/roll.ts (a seeded source in tests) and the numbers go to core. Implicit audit row 86: the GM's roll
  // tables and the loot roll drew with Math.random in the view, where no test can seed them; they draw from roll.ts
  // (`pick`, `cryptoRandom`) too.
  const rolls = /\bMath\.random\b|\bcrypto\.getRandomValues\b/;
  const anId = /Math\.random\(\)\.toString\(36\)/g; // an element or editor id, not a roll
  const rolled = (line: Line) => !isComment(line.text) && rolls.test(line.text.replace(anId, ''));
  const old: Line[] = [
    { file: 'src/views/combat.js', line: 0, text: 'const d20 = 1 + Math.floor(Math.random() * 20), tie = Math.random();' },
    { file: 'src/views/gm.js', line: 0, text: '      const pickLine = list[Math.floor(Math.random() * list.length)];' },
  ];
  expect(old.map(rolled), 'the rule sees the old initiative roll and the old roll table').toEqual([true, true]);
  expect(rolled({ ...old[0]!, text: "const uid = 'mk' + Math.random().toString(36).slice(2, 7);" }), 'an id is not a roll').toBe(false);
  const hits = [...await sourceLines('src/views'), ...await sourceLines('src/core')].filter(rolled);
  expect(report(hits), 'draw from src/edge/roll.ts: a fight\'s dice with rollNeeds, rollOpenings, rollSettle or rollDice, a table\'s line with pick, any other draw from cryptoRandom.').toEqual([]);
});

test('a view computes no fight number: from the modules that work one out it imports only names, constructors and the dice a use needs', async () => {
  // The old views each kept a copy of a rule: combat.js its to-hit and AC, hunter.js its derived(), skills.js its MP cost
  // and cooldown, table.js its HP band, so one number came out differently on two screens. A view now asks core for what
  // it shows: a fight screen's numbers from src/core/combat/fight-view.ts, a sheet's from src/core/hunter/sheet.ts
  // (app.api.hunter.sheet), a room row's from the fight doc (fight-doc.ts).
  const mayImport: Record<string, readonly string[]> = {
    // a formula's text, read and printed; a typed roll's edge and its natural (the Dice view); why a formula cannot be a lasting change, in words (the status maker); an amount in words (`amountWords`, the maker's words line)
    'src/core/formula.ts': ['parseFormula', 'printFormula', 'withEdge', 'naturalOf', 'bareRefusal', 'amountWords'],
    'src/core/hunter/derive.ts': ['SHEET_LABELS'],
    'src/core/combat/resolve.ts': ['needs'], // which dice a use asks for, rolled in src/edge/roll.ts
    // TERRAIN and TERRAINS: the map maker paints a terrain by its character; whether a body may stand there is the parser's
    'src/core/combat/space.ts': ['place', 'tiles', 'percent', 'openGrid', 'TERRAIN', 'TERRAINS'],
    'src/core/combat/timeline.ts': ['tick', 'roundOf', 'roundsOf'],
    'src/core/stats.ts': ['STAT_KEYS', 'STAT_LABELS', 'STAT_SHORT', 'above'], // `above`: the rules reference draws the curve it explains
    'src/core/combat/effect-ops.ts': ['healsFully', 'reactionMayHold', 'OP_KINDS', 'describeStatus', 'freeStatusKey', 'opLines', 'opsOffered'],
    // the move an omen lands and the dice it asks for: the GM's Land button rolls them as any use's (`needs` above)
    'src/core/combat/fight-turn.ts': ['omenMove', 'omenNeeds'],
    'src/core/combat/fight-channel.ts': [],
  };
  const named = /\bimport\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  const whole = /\bimport\s*(?:\*\s*as\s+\w+\s+from\s*|\(\s*)['"]([^'"]+)['"]/g; // `import * as` and `import(...)` take everything
  const banned = (file: string, text: string): string[] => [
    ...[...text.matchAll(named)].flatMap(m => {
      const from = join(file, '..', m[2]!), allowed = mayImport[from];
      if (!allowed) return [];
      return m[1]!.split(',').map(n => n.trim().split(/\s+as\s+/)[0]!).filter(n => n && !allowed.includes(n)).map(n => `${file}: ${n} from ${from}`);
    }),
    ...[...text.matchAll(whole)].map(m => join(file, '..', m[1]!)).filter(from => from in mayImport).map(from => `${file}: all of ${from}`),
  ];
  expect(banned('src/views/combat.js', "import { needs, resolve } from '../core/combat/resolve.ts';\nimport {\n  sheetOf,\n} from '../core/hunter/derive.ts';"), 'the rule sees the old view\'s own numbers')
    .toEqual(['src/views/combat.js: resolve from src/core/combat/resolve.ts', 'src/views/combat.js: sheetOf from src/core/hunter/derive.ts']);
  // A JSDoc type (`{import('...').Sheet}`) is in a comment and names a type, not a number.
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');
  const hits = (await sourceTexts('src/views')).flatMap(({ file, text }) => banned(file, code(text)));
  expect(hits, 'ask core for the number (fight-view.ts, sheet.ts through app.api.hunter.sheet, the fight doc) and draw it. A name or constructor a view needs goes in mayImport here.').toEqual([]);
});

test('the map view imports no rule module but the scene\'s: it draws src/core/combat/map-view.ts and converts tiles to pixels', async () => {
  // the owner's map is a second view of the same fight: if map.js worked out a reach, a path or a legality itself, the map
  // and the list could disagree. What the map shows comes from the scene (map-view.ts); what a tap or a gesture does from
  // the map's machines (`choose` in map-view.ts, gesture.ts), and when it frames from its life on the page
  // (map-mount.ts); `place` makes a tile from a tap.
  const allowed: Record<string, readonly string[]> = {
    'src/core/combat/map-view.ts': ['hotbar', 'mapScene', 'NO_CHOICE', 'choose'],
    'src/core/combat/gesture.ts': ['IDLE', 'MAX_ZOOM', 'gesture', 'zoomAbout'],
    'src/core/combat/map-mount.ts': ['BLANK', 'mapMount'],
    'src/core/combat/space.ts': ['place'],
  };
  const imports = (file: string, text: string): string[] => [...text.matchAll(/\bimport\s*(?:\{([^}]*)\}|\*\s*as\s+\w+)\s*from\s*['"]([^'"]+)['"]/g)].flatMap(m => {
    const from = join(file, '..', m[2]!);
    if (!from.startsWith('src/core/')) return [];
    const names = m[1] === undefined ? ['*'] : m[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0]!).filter(Boolean);
    return names.filter(n => !(allowed[from] ?? []).includes(n)).map(n => `${file}: ${n} from ${from}`);
  });
  expect(imports('src/views/map.js', "import { dist } from '../core/combat/space.ts';\nimport * as R from '../core/combat/resolve.ts';"), 'the rule sees a rule imported by the map')
    .toEqual(['src/views/map.js: dist from src/core/combat/space.ts', 'src/views/map.js: * from src/core/combat/resolve.ts']);
  const text = await Bun.file(`${ROOT}/src/views/map.js`).text();
  expect(imports('src/views/map.js', text), 'ask the scene (map-view.ts) for it: a new thing the map draws is a field of MapScene').toEqual([]);
});

test('only the fight changes a combatant\'s place, shield, stagger, channel, threat or statuses', async () => {
  // The old fight kept a hunter's fight state in two homes (the row and the sheet) and combat.js patched a row in place
  // (`c.hp = ...`), so the GM's screen, the save and the room disagreed. A row now changes only in the fight's modules,
  // by a command the GM's send() in combat.js gives the reducer; core elsewhere makes new rows (rows.ts) but changes none.
  // A row's HP is its life's, which has a rule of its own below ("a row's life changes only in row-life.ts").
  const owners = /^src\/core\/combat\/(fight[\w-]*|resolve|charge|effect-ops|land|triggers)\.ts$/;
  const fields = 'place|shield|stagger|channel|threat|statuses';
  const assign = new RegExp(String.raw`(\w+)\.(${fields})(\s*([-+*/]?=(?![=>])|\+\+|--|\|\|=|\?\?=)|(\.\w+)*\.(push|splice|sort|unshift|pop|shift|reverse)\()`, 'g');
  const copy = new RegExp(String.raw`\{\s*\.\.\.[^,{}]+,[^{}]*\b(${fields})\s*:`);
  // Not a combatant: a shadow a hunter's repair fixes (`x`, src/core/hunter/hunter.ts; shadows.js's `s`, permitted after it stopped writing one, is gone), the GM's status library (`library.statuses`, and its copies in library.ts), a room
  // payload or doc row that protocol.ts reads, a saved shadow healed by src/core/hunter/shadows.ts, and the statuses of a
  // reward given (src/core/hunter/grant.ts), which are a sheet's, never a row's.
  const notRows: Record<string, string[]> = { 'src/core/hunter/hunter.ts': ['x'] };
  const notCopies = ['src/core/protocol.ts', 'src/core/library.ts', 'src/core/hunter/shadows.ts', 'src/core/hunter/grant.ts'];
  const writes = (line: Line) => [...line.text.matchAll(assign)].some(m => m[1] !== 'library' && !(notRows[line.file] ?? []).includes(m[1]!))
    || (!notCopies.includes(line.file) && copy.test(line.text));
  const old: Line[] = [
    { file: 'src/views/combat.js', line: 0, text: 'c.statuses.push({ key, rounds });' },
    { file: 'src/views/table.js', line: 0, text: 'rows = rows.map(r => r.id === id ? { ...r, place: to } : r);' },
  ];
  for (const line of old) expect(writes(line), `the rule sees ${line.text}`).toBe(true);
  const hits = (await sourceLines('src')).filter(line => !owners.test(line.file) && !isComment(line.text) && writes(line));
  expect(report(hits), 'a combatant changes only in src/core/combat/fight.ts and the rule modules it calls (resolve.ts, charge.ts, effect-ops.ts, fight-turn.ts, fight-channel.ts, and the kits\' land.ts and triggers.ts). Send a command (adjust, status, move, act) through send() in combat.js.').toEqual([]);
});

test('what a fight row\'s sheet hears is read once a command, by reduce: only sheetBacks makes a vitals, sendRemote or shadowHp', async () => {
  // Each step once called the write-back itself (`consequences`, a GM's edit in setup, a join), so a path that changed a
  // row and skipped it left the sheet behind: a turn reaction's mana and fatigue reached neither the hunter's sheet nor
  // the player's phone (BUG-rules-5). `reduce` now reads it from the fight the command found and the one it left.
  const maker = 'src/core/combat/fight-turn.ts', caller = 'src/core/combat/fight.ts';
  const builds = /\{\s*type:\s*'(vitals|sendRemote|shadowHp)'/, calls = /\bsheetBacks\s*\(/;
  const lines = (await sourceLines('src')).filter(line => !isComment(line.text));
  const built = lines.filter(line => builds.test(line.text));
  expect(built.length, 'the rule sees the write-backs sheetBacks makes').toBeGreaterThan(0);
  expect(report(built.filter(line => line.file !== maker)), 'a write-back to a sheet is made only in fight-turn.ts, by sheetBacks, which reduce calls for every command. Change the row; reduce tells its sheet.').toEqual([]);
  const called = lines.filter(line => calls.test(line.text) && !/\bfunction sheetBacks\b/.test(line.text));
  expect(report(called.filter(line => line.file !== caller || !line.text.includes('sheetBacks(f, g, ctx)'))), 'only reduce in fight.ts calls sheetBacks, once a command, from the fight it found to the one it left.').toEqual([]);
  expect(called.length, 'reduce calls sheetBacks').toBe(1);
});

test('a row\'s life changes only in row-life.ts', async () => {
  // A hunter's life in a fight had two homes, the row's HP and the sheet's life, and each rule that changed HP ran its own
  // clamp, so a heal raised a dead hunter's row while its sheet stayed dead (docs/agent-handoff/audit/notes-dead-row.md).
  // A row now holds its life (`Body.life`), and `rowLifeAfter` in src/core/combat/row-life.ts is its one writer, through
  // the hunter's life machine or the foe table. rows.ts and fight-parse.ts make whole new rows, which this rule does not
  // see. A hunter's own life on its sheet (src/core/hunter) is the life machine's, written by vitals.ts.
  const mayWrite = ['src/core/combat/row-life.ts'];
  // Not a row: a played row's end (`RowEnd`), whose `life` is the state the fight left it in, up or dead.
  const notRows: Record<string, string> = { 'src/core/combat/odds.ts': "life: isUp(r) ? 'up' : 'dead'" };
  // Not a row either: the fight doc's row (fight-doc.ts `docRow` makes it from a row, protocol.ts `fightRow` reads it off
  // the wire), whose `life` is a copy of the row's life's state for the players' table to read, never written back.
  const docRows = ['src/core/combat/fight-doc.ts', 'src/core/protocol.ts'];
  const assign = /[\w$)\]!]\.life\s*(?:[-+*/]?=(?![=>])|\?\?=|\|\|=)/;
  const copy = /\{\s*\.\.\.[^,{}]+,[^{}]*(?<![.\w$])life\s*[:,}]/;
  const writes = (text: string) => assign.test(text) || copy.test(text);
  for (const text of ['const row = { ...u, hp: 3, life: { at: \'up\', hp: 10 } };', 'r.life = { at: \'dead\' };', 'd.fight.rows[0]!.life = up;', 'return { ...b, mana, life };']) {
    expect(writes(text), `the rule sees ${text}`).toBe(true);
  }
  expect(writes('const told = { ...was, at: r.life.at };'), 'a read of a life is no write').toBe(false);
  const all = (await sourceLines('src')).filter(line => !line.file.startsWith('src/core/hunter/') && !isComment(line.text) && writes(line.text));
  const permitted = (line: Line) => mayWrite.includes(line.file) || docRows.includes(line.file) || (notRows[line.file] !== undefined && line.text.includes(notRows[line.file]!));
  expect([...mayWrite, ...docRows, ...Object.keys(notRows)].filter(f => !all.some(l => l.file === f && permitted(l))), 'a permit that permits nothing leaves the list').toEqual([]);
  expect(report(all.filter(line => !permitted(line))), 'a row\'s life changes only through rowLifeAfter (src/core/combat/row-life.ts), so no heal, hit or edit goes around the life machine. Call it with the life event, or send the fight\'s `revive` or `adjust` command.').toEqual([]);
});

test('only withThreat in src/core/combat/effect-ops.ts writes a fight row\'s threat table', async () => {
  // A row holds a threat table only by its kind (a monster, a foe's summon; `OWN` in fight-parse.ts, U4): `withThreat`
  // is the one writer, and it leaves a row of another kind as it is. The fight's own rule (above) keeps threat in the
  // fight's modules; this one keeps it in that function, so no rule writes a table onto a hunter's or a shadow's row.
  // rows.ts and fight-parse.ts make whole new rows, which this rule does not see.
  const owners = ['src/core/combat/effect-ops.ts'];
  const assign = /[\w$)\]!]\.threat(\[[^\]]*\])?\s*(?:[-+*/]?=(?![=>])|\?\?=|\|\|=|\+\+|--)/;
  const copy = /\{\s*\.\.\.[^,{}]+,[^{}]*(?<![.\w$])threat\s*[:,}]/;
  const writes = (text: string) => assign.test(text) || copy.test(text);
  for (const text of ['b.threat[from] = (b.threat[from] ?? 0) + amount;', 'return { ...t, threat: { ...t.threat, [from]: n } };']) expect(writes(text), `the rule sees ${text}`).toBe(true);
  expect(writes('const top = r.threat && Object.keys(r.threat)[0];'), 'and not a read').toBe(false);
  const hits = (await sourceLines('src')).filter(line => !owners.includes(line.file) && !isComment(line.text) && writes(line.text));
  expect(report(hits), 'change a row\'s threat table with withThreat(row, change) (src/core/combat/effect-ops.ts), which writes it only on a row whose kind holds one').toEqual([]);
});

test('a mythic\'s standing has one writer', async () => {
  // A mythic row's place in its script (`Body.mythic`, notes-11-keystones.md design B.3) moves only by its machine, so no
  // rule can skip a phase, stand a second omen or move a clock its table does not name. src/core/combat/mythic.ts is the
  // one writer: `mythicStep` moves a standing, `mythicStart` makes a new row's (rows.ts) and `mythicJoined` moves a
  // joining row's clock (fight.ts `joined`). Elsewhere a row's `mythic` is null or one of those two's answer. fight-parse.ts
  // reads a stored standing field by field (shorthand), which this rule does not see.
  const owner = 'src/core/combat/mythic.ts';
  const assign = /[\w$)\]!]\.mythic(\.\w+)?\s*(?:[-+*/]?=(?![=>])|\?\?=|\|\|=|\+\+|--)/;
  const built = /(?<!readonly\s+)\bat:\s*'(calm|omen|faltering)'/;
  const put = /(?<![.\w$'"-])mythic\s*:(?!\s*(null\b|(mythicStart|mythicJoined)\())/;
  const copy = /\{\s*\.\.\.[^,{}]+,[^{}]*(?<![.\w$'"-])mythic\s*:/;
  const isType = /\breadonly\s+mythic\s*\??:/;
  // A row is built and copied only in src/core (a view sends commands), and a key `mythic` elsewhere names a kind or a rarity.
  const writes = (line: Line) => assign.test(line.text) || built.test(line.text) || copy.test(line.text)
    || (line.file.startsWith('src/core/combat/') && put.test(line.text) && !isType.test(line.text));
  const at = (text: string): Line => ({ file: 'src/core/combat/fight.ts', line: 0, text });
  for (const text of ['return { ...b, mythic: next };', 'b.mythic = s;', "const s = { at: 'omen', script, phase, beat, since, omen, aim, hpAt };", 'mythic: { ...nr.mythic, since: now },']) {
    expect(writes(at(text)), `the rule sees ${text}`).toBe(true);
  }
  for (const text of ['mythic: null,', 'mythic: mythicStart(script, now),', 'const g = r.mythic && gateOf(r);', "type Calm = Extract<MythicStanding, { readonly at: 'calm' }>;"]) {
    expect(writes(at(text)), `and not ${text}`).toBe(false);
  }
  const hits = (await sourceLines('src')).filter(line => line.file !== owner && !isComment(line.text) && writes(line));
  expect(report(hits), 'a mythic\'s standing changes only in src/core/combat/mythic.ts: move it with mythicStep, make a new row\'s with mythicStart, move a joining row\'s clock with mythicJoined; a row of no mythic holds `mythic: null`').toEqual([]);
});

test('only the fight\'s fudge command writes a fight\'s fudge', async () => {
  // The GM's hidden weight on the fight's dice (docs/agent-handoff/features/notes-8-fudge.md section 2) is one piece of
  // state with one writer: `fudgeStep` in src/core/combat/fudge.ts, which fight.ts calls for the `fudge` command, for a
  // row that leaves and for the forces a command's dice read (`spent`). A second writer could set a weight no command
  // sent, or carry one past the fight's end, where `Ended` holds none. fight-parse.ts makes whole new fights, which this rule does not see.
  const owner = 'src/core/combat/fudge.ts', caller = 'src/core/combat/fight.ts';
  const copy = /\{\s*\.\.\.[^,{}]+,[^{}]*(?<![.\w$])fudge\s*[:,}]/;
  const assign = /[\w$)\]!]\.fudge(\.(sides|rows|forced))?(\[[^\]]*\])?\s*(?:[-+*/]?=(?![=>])|\?\?=|\|\|=|\+\+|--)/;
  const spread = /\.\.\.[\w$.!]*\.fudge\b/;
  const writes = (text: string) => copy.test(text) || assign.test(text) || spread.test(text);
  for (const text of ['return { ...f, fudge: { ...f.fudge, rows: {} } };', 'f.fudge = NO_FUDGE;', 'fight.fudge.rows[id] = 2;', 'const g = { ...f, rows, fudge };']) {
    expect(writes(text), `the rule sees ${text}`).toBe(true);
  }
  expect(writes('const w = f.fudge.rows[id] ?? 0;'), 'a read of a fudge is no write').toBe(false);
  const lines = (await sourceLines('src')).filter(line => !isComment(line.text));
  const hits = lines.filter(line => line.file !== owner && writes(line.text));
  const permitted = (line: Line) => line.file === caller && /(?<![.\w$])fudge:\s*fudgeStep\(/.test(line.text);
  expect(hits.filter(permitted).length, 'the rule sees the fudge command\'s write, a leaving row\'s and the spent forces\'').toBe(3);
  expect(report(hits.filter(line => !permitted(line))), 'a fight\'s fudge changes only as `fudge: fudgeStep(f.fudge, event)` in src/core/combat/fight.ts. Send the GM\'s `fudge` command through send() in combat.js.').toEqual([]);
  const calls = lines.filter(line => /\bfudgeStep\s*\(/.test(line.text) && line.file !== owner);
  expect(report(calls.filter(line => line.file !== caller)), 'only fight.ts calls fudgeStep').toEqual([]);
});

test('nothing a player\'s phone receives in a fight names the fight\'s fudge', async () => {
  // The GM's weight on a fight's dice stays on the GM's phone (docs/agent-handoff/features/notes-8-fudge.md section 3):
  // a player's phone gets the fight as the doc (fight-doc.ts, read back by protocol.ts), the room's messages and their
  // sync (protocol.ts, sync.ts), and draws it with table.js and uses.js. None of them may name the fudge, so nothing can
  // carry a weight, a force or a word about one to a player's screen. The table weight outside a fight is named
  // `weight`, never `fudge`, so this rule stays one word.
  const RECEIVED = ['src/core/combat/fight-doc.ts', 'src/core/protocol.ts', 'src/edge/sync.ts', 'src/views/table.js', 'src/views/uses.js'];
  const names = (text: string) => /fudge/i.test(text);
  expect(names('const w = f.fudge.rows[id];') && names('// the Fudge block'), 'the rule sees a fudge in code and in words').toBe(true);
  const lines: Line[] = [];
  for (const file of RECEIVED) (await Bun.file(`${ROOT}/${file}`).text()).split('\n').forEach((text, i) => lines.push({ file, line: i + 1, text }));
  expect(lines.length, 'every file the rule reads is there').toBeGreaterThan(RECEIVED.length);
  expect(report(lines.filter(line => names(line.text))), 'what a player\'s phone receives carries outcomes only: read the fudge in src/core/combat/fudge.ts on the GM\'s phone (the draws), never in the doc, a room message or a player\'s view').toEqual([]);
});

test('nothing imports a module deleted with the old fight', async () => {
  // Milestone 2 deleted the old fight whole, so nothing was left beside the new one. Each entry says where its job went.
  const DELETED: Record<string, string> = {
    'src/core/combat/encounter.ts': 'src/core/combat/fight.ts',
    'src/core/combat/encounter-types.ts': 'src/core/combat/fight-types.ts',
    'src/core/combat/encounter-parse.ts': 'src/core/combat/fight-parse.ts',
    'src/core/combat/use.ts': 'a use is the fight\'s act or a player\'s cast; its Outcome is in ability-types.ts',
    'src/core/combat/status.ts': 'src/core/combat/effect-ops.ts',
    'src/core/combat/ability.ts': 'typed abilities: ability-types.ts, registry/ability-kinds.ts, registry/abilities.ts',
    'scripts/charts/fight2.ts': 'scripts/charts/fight.ts',
    'tests/models/fight2-play.ts': 'tests/models/fight-play.ts',
  };
  for (const file of Object.keys(DELETED)) expect([file, await Bun.file(`${ROOT}/${file}`).exists()]).toEqual([file, false]);
  const bare = (p: string) => p.replace(/\.(ts|js)$/, '');
  const gone = new Map(Object.keys(DELETED).map(file => [bare(file), file]));
  const spec = /\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;
  const imports = (line: Line): string[] => [...line.text.matchAll(spec)].map(m => gone.get(bare(join(line.file, '..', m[1]!)))).filter((f): f is string => !!f);
  expect(imports({ file: 'tests/x.test.ts', line: 0, text: "import { reduce } from '../src/core/combat/encounter.ts';" }), 'the rule sees an old import').toEqual(['src/core/combat/encounter.ts']);
  // This file names the deleted paths as data, not as imports.
  const lines = [...await sourceLines('src'), ...await sourceLines('scripts'), ...await sourceLines('tests')].filter(l => l.file !== 'tests/lint.test.ts');
  (await Bun.file(`${ROOT}/server.ts`).text()).split('\n').forEach((text, i) => lines.push({ file: 'server.ts', line: i + 1, text }));
  const hits = lines.filter(line => !isComment(line.text) && imports(line).length);
  expect(report(hits).map((h, i) => `${h} (now ${DELETED[imports(hits[i]!)[0]!]})`), 'import what replaced it, named after each hit').toEqual([]);
});

test('no balance number is a literal in the fight\'s rule modules: it is a rule in RULES.fight', async () => {
  // Every number of the fight was tuned on paper and in the simulation (design section 6, tests/fight-sim.test.ts), and a
  // GM may type over any of them. A number written into the code is one the sim, the paper tables and the GM cannot see.
  // The modules: the fight (fight*.ts), what one use does (resolve.ts), statuses (effect-ops.ts), places (space.ts) and
  // the sheet (derive.ts, sheet.ts). fight-parse.ts is left out: its numbers bound outside data (a name's length, a
  // stat's range) and decide no fight. timeline.ts reads a d20 it calls `roll`, and rows.ts letters a pack A to Z.
  const ruled = /^src\/core\/(combat\/(fight[\w-]*|resolve|effect-ops|space)|hunter\/(derive|sheet))\.ts$/;
  const cap = /^\s*(export\s+)?const\s+[A-Z][A-Z0-9_]*\s*[:=]/; // a named cap of data, which its name and comment explain
  const notBalance = new Set(['0', '1', '2', '100']); // nothing, one, a half or a pair, a percent
  const literal = /(?<![\w.$#])(?<!\w-)\d+(?:\.\d+)?(?:e\d+)?(?!\w)/g;
  const numbers = (text: string): string[] => {
    let t = text.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''").replace(/\s\/\/.*$/, '');
    t = t.replace(/\*\s*10\)\s*\/\s*10\b/g, ''); // rounded to one decimal place
    if (/\bd20\b/.test(t)) t = t.replace(/\b20\b/g, ''); // a d20's faces
    return [...t.matchAll(literal)].map(m => m[0]).filter(n => !notBalance.has(n));
  };
  expect(numbers('t *= 0.9; const bar = { fill: 0, max: hit * 4 }; // 4 hits'), 'the rule sees a decay and a bar written in').toEqual(['0.9', '4']);
  expect(numbers('const share = clamp((d20 + edge) / 20, 0, 1), left = Math.round(n / R.fight.round * 10) / 10;'), 'a d20 and one decimal are not balance').toEqual([]);
  const lines = (await sourceLines('src/core')).filter(l => ruled.test(l.file) && l.file !== 'src/core/combat/fight-parse.ts');
  expect(new Set(lines.map(l => l.file)).size, 'the fight\'s rule modules are found').toBeGreaterThan(5);
  const hits = lines.filter(l => !isComment(l.text) && !cap.test(l.text) && numbers(l.text).length);
  expect(report(hits), 'put the number in RULES.fight (src/core/rules.ts) with its reason as a comment and its domain (whole(), real() or of()), and read it as R.fight.<name>. A cap on data that decides no fight is a named UPPER_CASE constant.').toEqual([]);
});

test('every rule number has its domain beside it in RULES, and its shipped value is inside it', () => {
  // A GM's override took any finite number: 0 XP a level sent a hunter to level 9999, a stat base of 0 made every sheet
  // not a number, dice of a billion sides ate the phone's memory (audit BUG-rules-1). overrides.ts now refuses a number
  // out of its rule's domain, so a rule declared as a bare number would take any override again.
  const numbers = ruleNumbers();
  expect(numbers.length, 'the walk finds the rule numbers').toBeGreaterThan(300);
  expect(numbers.filter(n => !domainOf(n.path)).map(n => n.path), 'declare the rule in src/core/rules.ts with whole(value, least, most, why), real(...) or of(value, a shared domain)').toEqual([]);
  const outside = numbers.filter(n => { const d = domainOf(n.path)!; return ![n.value].flat().every(x => inDomain(x, d)) || d.least > d.most || !d.why.trim(); });
  expect(outside.map(n => [n.path, n.value, domainOf(n.path)]), 'a shipped number inside its domain, least at most most, and a why').toEqual([]);
});

// ── motion (src/views/motion.ts and the Motion block of public/app.css) ──
// Before the motion system each screen timed its own: a bar's width over 450 ms, a button's `transition: all` over 150,
// a window's title typed on with clip-path, a warning glitched with a filter, a broken gate pulsed its box-shadow forever.
// Some animated layout (a frame per change on a slow phone) and no two agreed on a time.

const appCss = (await Bun.file(`${ROOT}/public/app.css`).text()).split('\n').map((text, i): Line => ({ file: 'public/app.css', line: i + 1, text }));
/** The CSS and JS a page runs: public/app.css, and every view and edge file (module CSS is a string in them). */
const styledSources = async (): Promise<Line[]> => [...appCss, ...await sourceLines('src/views'), ...await sourceLines('src/edge')];
/** A line of public/app.css inside the Motion block, which motion.ts owns. */
const inMotionBlock = (line: Line): boolean => {
  const start = appCss.findIndex(l => l.text.startsWith('/* ── Motion:')), end = appCss.findIndex(l => l.text.startsWith('/* ── end of Motion'));
  return line.file === 'public/app.css' && start >= 0 && end > start && line.line > start && line.line <= end + 1;
};
/** Each `transition…` or `animation…` declaration (CSS `prop: value` or JS `.prop = value` / `prop: 'value'`) on a line. */
const declarations = (text: string, prop: 'transition' | 'animation'): { name: string; value: string }[] =>
  [...text.matchAll(new RegExp(`(?<![\\w-])(${prop}(?:-[a-z]+)?)\\s*(?::|=(?!=))\\s*['"\`]?([^;}'"\`]*)`, 'gi'))].map(m => ({ name: m[1]!, value: m[2]! }));
const literalTime = /(?<![\w.-])(?:\d*\.\d+|[1-9]\d*)m?s\b/;

test('no transition or animation is timed by a literal: only the motion tokens (--t-fast, --t-base, --t-slow)', async () => {
  const timed = (text: string) => (['transition', 'animation'] as const).some(p => declarations(text, p).some(d => literalTime.test(d.value)));
  expect(timed('button{transition:all .15s ease}') && timed('.x{animation:pulse 2.4s infinite}') && timed("el.style.transition = 'opacity 200ms'"), 'the rule sees a literal time').toBe(true);
  expect(timed('b{transition:transform var(--t-fast) var(--ease-arrive)}') || timed('a:active{transition-duration:0s}') || timed('import { transition } from x'), 'a token, a zero or a name is not a literal time').toBe(false);
  const hits = (await styledSources()).filter(l => !isComment(l.text) && timed(l.text));
  expect(report(hits), 'a time is a token on :root in public/app.css (--t-fast, --t-base, --t-slow), so every motion of the app agrees. Use a move from src/views/motion.ts, or var(--t-…) in CSS.').toEqual([]);
});

test('no @keyframes and no .animate( outside src/views/motion.ts and the Motion block of public/app.css', async () => {
  const draws = /@keyframes\b|\.animate\s*\(/;
  const owner = (l: Line) => l.file === 'src/views/motion.ts' || inMotionBlock(l);
  const lines = await styledSources();
  expect(lines.some(l => owner(l) && l.file === 'public/app.css' && /@keyframes/.test(l.text)), 'the Motion block is found').toBe(true);
  const hits = lines.filter(l => !owner(l) && !isComment(l.text) && draws.test(l.text));
  expect(report(hits), 'a move is a function in src/views/motion.ts (or a class in the Motion block it owns), so takeover and reduced motion hold for it. Call the move; add one there if none fits.').toEqual([]);
});

test('a transition moves only transform or opacity, never layout or paint (width, height, top, margin, box-shadow, all)', async () => {
  const allowed = new Set(['transform', 'opacity']);
  const moved = (value: string): string[] => value.split(',').map(part => part.trim().split(/\s+/)[0] ?? '').filter(Boolean);
  const bad = (text: string): string[] => declarations(text, 'transition').flatMap(d => {
    if (/^transition-(duration|delay|timing-function|behavior)$/i.test(d.name) || /^(none|inherit|initial|unset)$/.test(d.value.replace('!important', '').trim())) return [];
    const props = moved(d.value);
    return props.filter(p => !allowed.has(p.toLowerCase())).concat(props.length ? [] : ['all']);
  });
  expect(bad('.bar>i{transition:width .45s ease}'), 'the rule sees a width').toEqual(['width']);
  expect(bad('button{transition:all var(--t-fast)}'), 'the rule sees all').toEqual(['all']);
  expect(bad('b{transition:transform var(--t-fast),opacity var(--t-base)}'), 'transform and opacity pass').toEqual([]);
  const hits = (await styledSources()).filter(l => !isComment(l.text) && bad(l.text).length);
  expect(report(hits), 'width, height, top, left, margin, padding and box-shadow run layout or paint on every frame, and drop frames on a slow phone. Move it with transform (a bar is fillTo, scaleX) or opacity, through src/views/motion.ts.').toEqual([]);
});

test('src/core and src/edge do not import src/views/motion.ts: motion is a view concern', async () => {
  const imports = /\b(from|import)\b.*['"][^'"]*views\/motion(\.ts)?['"]/;
  const hits = [...await sourceLines('src/core'), ...await sourceLines('src/edge')].filter(l => imports.test(l.text));
  expect(report(hits), 'a fight or a link knows nothing of how a change is shown. Emit the effect or event; the view that draws it calls the move.').toEqual([]);
});

test('a hunter\'s HP, mana, fatigue, life and statuses are written only inside a call of vitalsEdit in hunter.js, which sends them to the fight\'s row while there is one', async () => {
  // In a fight the row holds them and the fight's next `vitals` writes the row over the sheet. A reward's status, a
  // level-up's refill and Revive each wrote the sheet beside a running fight and were lost or undone (notes-m2-vitals.md).
  // `vitalsEdit` asks `fightOf` where they live and sends the change to the row (`combat.adjust`, `combat.status`), refuses
  // it on a player's phone in the GM's fight, or writes the sheet; a grant's go through `grantWrite`. The fight's own write-back is
  // core's (src/core/combat/fight-save.ts); `lifeEvent` and `fit` are the helpers vitalsEdit's callers name.
  const call = /(?<![.\w$])(hit|lifeAfter|changeMana|setMana|setFatigue|changeFatigue|refill|rest|restOf|fitMaxima|lifeEvent|addC|delC)\(/g;
  const methodDef = /^\s*\w+\((?:[^()]|\([^()]*\))*\)\s*\{/; // `rest(kind, hid = store.active().id) {`: an API member's own name, not a call
  const statusWrite = /(?<![.\w$])addSheetStatus\(|\.conditions\s*(=(?![=>])|\.(push|splice|unshift|pop|shift)\()/;
  const owner = 'src/views/hunter.js';
  /** From each match to the bracket that closes the bracket it ends on. */
  const spans = (text: string, re: RegExp): [number, number][] => [...text.matchAll(re)].map(m => {
    let i = m.index! + m[0].length - 1, depth = 0;
    for (; i < text.length; i++) {
      const c = text[i]!;
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c) && --depth === 0) break;
    }
    return [m.index!, i];
  });
  const lineOf = (text: string, at: number) => text.slice(text.lastIndexOf('\n', at - 1) + 1, text.indexOf('\n', at) === -1 ? undefined : text.indexOf('\n', at));
  const allowedIn = (text: string): [number, number][] => [
    ...spans(text, /(?<![.\w$])(vitalsEdit|handEdit)\(/g),
    ...[...text.matchAll(/^ {2}const (lifeEvent|fit) = .*$/gm)].map((m): [number, number] => [m.index!, m.index! + m[0].length]),
  ];
  const isMethodDef = (text: string, at: number) => {
    const start = text.lastIndexOf('\n', at - 1) + 1;
    return /^\s*$/.test(text.slice(start, at)) && methodDef.test(lineOf(text, at));
  };
  const outside = (text: string) => {
    const allowed = allowedIn(text);
    return [...text.matchAll(call)].filter(m => !allowed.some(([a, b]) => m.index! >= a && m.index! < b) && !isMethodDef(text, m.index!))
      .map(m => text.slice(0, m.index!).split('\n').length);
  };
  const old = "    addCondition(hid, status) { let r = false; store.update(() => { const h = store.hunter(hid); if (h) r = addC(h, status); }, 'condition'); return r; },";
  expect(outside(old), 'the rule sees a sheet write beside vitalsEdit').toEqual([1]);
  expect(outside("    addCondition(hid, status) { return vitalsEdit(hid, 'condition', h => addC(h, status), cid => statusToRow(cid, status)); },"), 'and lets one inside it pass').toEqual([]);
  const text = await Bun.file(`${ROOT}/${owner}`).text();
  expect(allowedIn(text).length, 'the calls of vitalsEdit in hunter.js are found').toBeGreaterThan(8);
  const lines = [...await sourceLines('src/views'), ...await sourceLines('src/edge')];
  const others = lines.filter(l => l.file !== owner && !isComment(l.text) && ([...l.text.matchAll(call)].length > 0 || statusWrite.test(l.text)));
  const inHunter = outside(text).map(n => `${owner}:${n}: ${text.split('\n')[n - 1]!.trim().slice(0, 120)}`);
  expect([...report(others), ...inHunter], 'write a hunter\'s HP, mana, fatigue, life or statuses through app.api.hunter (damage, heal, changeMana, changeFatigue, life, refill, rest, addCondition, removeCondition); in hunter.js, inside a call of vitalsEdit, which asks fightOf where they live.').toEqual([]);
});

test('a view writes the save only through store.apply, with a step from core', async () => {
  // the owner: "Ok everything must be explicit. Everything." A rule written inside a view's update callback had no name,
  // no test and no undo: a stat point raised then lowered did not come back (ab79803). A view now asks a pure core
  // function for the next save (src/core/save-step.ts) and hands it to `store.apply(reason, step)`; it does not call
  // `store.update` or change anything it read from the store. The lists below are the views not yet converted, with
  // their count of writes; a list shrinks as its views are converted, and an entry must match its file exactly.
  const helperA: Record<string, number> = {};
  const helperB: Record<string, number> = {};
  const draft = String.raw`(?<![.\w$])(h|hunter|save|draft)`;
  const write = new RegExp([
    String.raw`\b(app\.)?store\.update\(`,
    String.raw`${draft}\.[\w$.\[\]'"]*?\s*([-+*/]?=(?![=>])|\+\+|--)`,
    String.raw`${draft}\.[\w$.]+\.(push|splice|pop|shift|unshift|sort)\(`,
    String.raw`\bdelete\s+(h|hunter|save|draft)\.`,
  ].join('|'), 'g');
  expect([..."store.update(() => { h.stats[k]++; h.items.push(it); delete h.x; });".matchAll(write)].length, 'the rule sees an update and its writes').toBe(4);
  expect([..."q.hunter.value = x; store.apply('equip', atHunter(hid, h => equip(h, id)));".matchAll(write)].length, 'and lets a field and an apply pass').toBe(0);
  const counts: Record<string, number> = {};
  for (const line of await sourceLines('src/views')) {
    if (isComment(line.text)) continue;
    const n = [...line.text.matchAll(write)].length;
    if (n) counts[line.file] = (counts[line.file] ?? 0) + n;
  }
  expect(counts, 'write the save with store.apply(reason, step), the step a pure function in the core module that owns that state (docs/guide/makers.md). A converted view leaves its list.').toEqual({ ...helperA, ...helperB });
  // Implicit audit 3, I3: the pattern saw assignments and `store.update`, not a step written in place as a spread
  // (`store.apply('shop-edit', s => ({ ...s, shop: null }))`), a rule with no name or test (the class row 13 closed).
  const inline = /store\.apply\([^,]+,\s*\(?\w+\)?\s*=>\s*\(\{\s*\.\.\./;
  const old = ["          if (await ui.confirm({ title: 'Reset shop?', body: 'Restore the default shop list.', danger: true, confirmLabel: 'Reset' })) store.apply('shop-edit', s => ({ ...s, shop: null }));", "      store.apply('gm-rules', s => ({ ...s, rulesOverrides: withBuildRule(s.rulesOverrides, patch) }));"];
  expect(old.map(t => inline.test(t)), 'the rule sees each old spread step').toEqual([true, true]);
  const spreads = (await sourceLines('src/views')).filter(l => !isComment(l.text) && inline.test(l.text));
  expect(report(spreads), 'name the step in the core module that owns the field (inventory.ts withShop, build.ts buildRuleSet) and test it').toEqual([]);
});

test('a view draws without changing anything: its render, update, draw and paint functions write no save, pref, invite or storage', async () => {
  // Audit row 67: the Room view's render dropped the invite and toasted "already in room" whenever it redrew, so the
  // toast came from a redraw, not from anything the player did. A change belongs to a tap, an event or the module that
  // owns the state (the link spends the invite, sync.ts `spendInvite`); drawing reads.
  const head = /(?:\bfunction\s+(?:render|update|draw|paint)\w*\s*\([^)]*\)\s*\{)|(?:^[ \t]*(?:render|update|draw|paint)\w*\s*\([^)]*\)\s*\{)/gm;
  const write = /\bstore\.(apply|update)\(|\.setPrefs\(|\.dropInvite\(|\b(local|session)Storage\.(setItem|removeItem|clear)\(|\.write\(/;
  /** The lines of each drawing function's body that write, as `line: text`. */
  const writesIn = (text: string): { at: number; text: string }[] => [...text.matchAll(head)].flatMap(m => {
    let i = m.index! + m[0].length - 1, depth = 0;
    for (; i < text.length; i++) {
      const c = text[i]!;
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c) && --depth === 0) break;
    }
    const first = text.slice(0, m.index!).split('\n').length;
    return text.slice(m.index!, i).split('\n').flatMap((l, k) => (write.test(l) && !isComment(l) ? [{ at: first + k, text: l }] : []));
  });
  const old = "  function render() {\n    let pend = A.invite();\n    if (pend && pend === code) { A.dropInvite(); if (!S.busy) ui.toast('System', 'already'); pend = null; }\n  }";
  expect(writesIn(old).map(w => w.at), 'the rule sees the old Room view drop the invite while drawing').toEqual([3]);
  expect(writesIn("  function render() { q.x.hidden = !Y().invite(); }\n  q.no.addEventListener('click', () => Y().dropInvite());"), 'and lets a tap do it').toEqual([]);
  // audit row 51: the Table feed's paint marked its rows seen in device memory while drawing
  expect(writesIn("  function paintFeed() {\n    if (shown()) { feed.forEach(f => { f.seen = true; }); feedMemory.write(feed); }\n  }").map(w => w.at), 'the rule sees a device memory written while drawing').toEqual([2]);
  const names = (await readdir(`${ROOT}/src/views`)).filter(n => /\.(js|ts)$/.test(n)).sort();
  let bodies = 0;
  const hits: string[] = [];
  for (const name of names) {
    const text = await Bun.file(`${ROOT}/src/views/${name}`).text();
    bodies += [...text.matchAll(head)].length;
    for (const w of writesIn(text)) hits.push(`src/views/${name}:${w.at}: ${w.text.trim().slice(0, 120)}`);
  }
  expect(bodies, 'the drawing functions of the views are found').toBeGreaterThan(20);
  expect(hits, 'draw from the state as it is; change it in a tap, an event handler, or the module that owns it (docs/guide, "Where things live")').toEqual([]);
});

test('a view or the edge cuts nothing by a size of its own: a size is a named bound of core', async () => {
  // Implicit audit row 76: bestiary.js cut the players' codex doc at a literal 15,500 characters while the room takes
  // DOC_MAX (62,000), so players saw a quarter of the entries the room could carry. A length checked against a number
  // written in place is a second copy of a bound core owns (protocol.ts DOC_MAX, a parser's cap), and drifts from it.
  const cuts = /\.length\s*[<>]=?\s*\d{4,}\b|\b\d{4,}\s*[<>]=?\s*[\w.()]*\.length\b/;
  const old: Line = { file: 'src/views/bestiary.js', line: 0, text: '    while (JSON.stringify(doc).length > 15500 && arr.length > 1) {' };
  expect(cuts.test(old.text), 'the rule sees the old codex cut').toBe(true);
  expect(cuts.test('    const body = JSON.stringify(data); if (body.length > DOC_MAX) return \'tooBig\';'), 'a named bound passes').toBe(false);
  const lines = [...await sourceLines('src/views'), ...await sourceLines('src/edge')];
  const hits = lines.filter(line => !isComment(line.text) && cuts.test(line.text));
  expect(report(hits), 'compare with the bound core names (protocol.ts DOC_MAX, a parser\'s cap), or build the thing in core within it (bestiary.ts codexDoc).').toEqual([]);
});

test('a view reads a bound core names, never writes its number: copies, item quantity, zones, map size, pins', async () => {
  // Implicit audit 3, B5, R2, C4, P1: a monster's copies (26) were written nine times in three views, an item's quantity
  // (9999) beside ITEM_BOUNDS.qty, the map's 16 zones and 4 to 40 tiles in the GM's words, and the hotbar's 4 pins in
  // map.js. A changed bound then differed between the box, its clamp and the words. Read MONSTER_BOUNDS.copies
  // (copiesOf), ITEM_BOUNDS.qty, MAX_ZONES, MAP_BOUNDS.size and the hotbar's `full`.
  const copy = /\bmax="(26|9999)"|Math\.min\((26|9999)\b|, 1, 26\)|> 26\b|\b\d+ fields at most\b|\b\d+ to \d+ tiles\b|\bpinned\.length >= \d/;
  const old = [
    '    n = Math.max(1, Math.min(26, Math.trunc(num(n, 1))));',
    "        const n = clamp(int(val('[data-mcount]'), 1), 1, 26), cs = A().bestiary.toCombatant(val('[data-msel]'), n); if (!cs.length) return;",
    '        <div class="rw-two">${field(\'Qty\', `<input type="number" min="1" max="9999" step="1" inputmode="numeric" data-f="qty" value="${esc(r.item.qty)}">`)}',
    "      if (no && no.type === 'refused') toast(no.reason === 'tooMany' ? 'The map holds 16 fields at most.' : 'Nothing to change there.');",
    "        if (no && no.type === 'refused') toast(no.reason === 'offGrid' ? 'A map is 4 to 40 tiles a side.' : 'Nothing to change.');",
    '      const pinned = h.bar.filter(s => s.pinned), full = pinned.length >= 4;',
  ];
  expect(old.map(t => copy.test(t)), 'the rule sees each old copy').toEqual(old.map(() => true));
  const hits = (await sourceLines('src/views')).filter(line => !isComment(line.text) && copy.test(line.text));
  expect(report(hits), 'read the bound from core (MONSTER_BOUNDS.copies and copiesOf, ITEM_BOUNDS.qty, MAX_ZONES, MAP_BOUNDS.size, hotbar\'s full)').toEqual([]);
});

test('a hunter\'s level is bounded once, in src/core/hunter/level.ts', async () => {
  // BUG-rules-18 and AW-rules-11: the fight's reader took a hunter row's level only up to 200 while the hunter's own
  // reader took 9999, so a running fight with a hunter above 200 was deleted on reload. The game has no top level
  // (the owner, Nov 20); the bound outside data is read within is MIN_LEVEL to MAX_LEVEL, and a reader asks parseLevel
  // (refuses) or levelOf (mends). A level read against numbers written in place is a second definition of a level.
  const bound = /\blevel\w*\s*,\s*\d+\s*,\s*\d|\blevel\w*\s*[:=]\s*[\w.]+\(\s*\d|Math\.(?:max|min)\(\s*\d+\s*,\s*(?:Math\.\w+\(\s*)?level\b/i;
  const old = [
    '  const level = whole(b.level, 1, 200);',
    '  h.level = int(h.level, 1, 1, MAX_LEVEL); h.xp = Math.max(0, h.xp); h.gold = Math.max(0, h.gold);',
    "const LEVEL = wholeIn(1, 9999, 'a level a hunter can reach: 1 to progress.ts MAX_LEVEL');",
    "    return { face: { name: text(NAME_MAX)(own(f, 'name')), level: int(1, MAX_LEVEL)(own(f, 'level')), job: null } };",
    '  const to = Math.min(MAX_LEVEL, Math.max(1, Math.trunc(level) || 1));',
    'export const xpToNext = (R: Rules, level: number): number => R.xpPerLevel * Math.max(1, level);',
  ];
  expect(old.map(t => bound.test(t)), 'the rule sees each old bound').toEqual(old.map(() => true));
  const lines = [...await sourceLines('src'), ...(await Bun.file(`${ROOT}/server.ts`).text()).split('\n').map((text, i) => ({ file: 'server.ts', line: i + 1, text }))];
  const hits = lines.filter(line => !isComment(line.text) && bound.test(line.text));
  expect(report(hits), 'read a level with parseLevel or levelOf, or name MIN_LEVEL and MAX_LEVEL (src/core/hunter/level.ts)').toEqual([]);
});

test('a view sends a room message as it is: the room\'s reader cuts each field to its bound', async () => {
  // quests.js cut a progress message's objective labels at 80 while the room's reader (protocol.ts) keeps 100, and
  // uses.js and quests.js cut names and titles at the reader's own numbers: two homes for one bound, already apart.
  const cut = /\.event\(\s*'[^']+'.*\.slice\(0,/;
  const old = "    const event = S.event('questUpdate', { by: S.myKey(hid), name: String(h.name).slice(0, 60), questId: q.id, title: q.title.slice(0, 120), kind: q.kind, status,";
  expect(cut.test(old), 'the rule sees the old progress message').toBe(true);
  const hits = (await sourceLines('src/views')).filter(line => !isComment(line.text) && cut.test(line.text));
  expect(report(hits), 'send the field as it is; its bound is the reader\'s in DEFS (src/core/protocol.ts)').toEqual([]);
});

test('whether a formula follows the rule is its effect\'s arm, never its text compared with the recommendation', async () => {
  // Implicit audit 3, M2: the maker marked a formula "edited" when its text differed from `recommended(...)`, and
  // ticksOf found an ability's ticks by printing every stat's recommendation and comparing text; after a GM changed a rule
  // the recommendation reads, every saved ability read as edited. An effect is `by: 'rule'` (its ticks) or `by: 'hand'`.
  const compare = /(?:!==|===)\s*rec\(\)\.text|recommended\([^)]*\)\.text\s*(?:===|!==)/;
  const old = ["    if (t.matches('[data-formula]')) { text = input.value; edited = text.trim() !== rec().text; draw(); return; }", '    if (recommended(kind, ticks, R).text === text) return ticks;'];
  expect(old.map(t => compare.test(t)), 'the rule sees the old compares').toEqual([true, true]);
  const hits = [...await sourceLines('src/core'), ...await sourceLines('src/views')].filter(l => !isComment(l.text) && compare.test(l.text));
  expect(report(hits), 'read the effect\'s `by`: typing makes it the GM\'s, Reset gives it back to the rule').toEqual([]);
});

/** What a function that writes the save answers: `store.apply`'s `Applied` (an object, so a refusal reads as true) or whether it wrote. */
type WriteAnswer = 'applied' | 'wrote';
/** The index after the `)` that closes the call whose `(` is at `open`. A string or a template is skipped whole. */
function callEnd(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (c === '"' || c === "'" || c === '`') { for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++; continue; }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i + 1;
  }
  return src.length;
}
/**
 * `head` with the parameter list it ends with (before a return type and `=>`) read as `()`, so a TypeScript function
 * whose typed parameters hold parentheses is named as a plain one is.
 */
function plainParams(head: string): string {
  const m = head.match(/\)(\s*:\s*[^(){};=]+)?(\s*=>)?$/); if (!m) return head;
  let depth = 0, i = head.length - m[0].length;
  for (; i >= 0; i--) { if (head[i] === ')') depth++; else if (head[i] === '(' && --depth === 0) break; }
  return i < 0 ? head : `${head.slice(0, i)}()${m[2] ?? ''}`;
}
/** What holds the call at `at`: a function of a name (its answer goes to the calls of that name), an api member (to another module), or an unnamed function (to no one). */
function holderOf(text: string, at: number): { kind: 'named'; name: string } | { kind: 'member' | 'unnamed' } {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (text[i] === '}') depth++;
    else if (text[i] === '{' && depth > 0) depth--;
    else if (text[i] === '{') {
      const head = plainParams(text.slice(Math.max(0, i - 300), i).trimEnd());
      const fn = head.match(/function\s+([\w$]+)\s*\([^()]*\)(?:\s*:\s*[^{}();=]+)?$/) ?? head.match(/(?:const|let|,)\s*([\w$]+)\s*=\s*(?:async\s+)?(?:\([^()]*\)|[\w$]+)(?:\s*:\s*[^{}();=]+)?\s*=>$/);
      if (fn) return { kind: 'named', name: fn[1]! };
      if (/(?:^|[\s,{])(?!(?:if|for|while|switch|catch|function)\b)[\w$]+\s*\([^()]*\)$/.test(head) || /[\w$]+\s*:\s*(?:async\s+)?(?:\([^()]*\)|[\w$]+)\s*=>$/.test(head)) return { kind: 'member' };
      if (/=>$|function\s*\([^()]*\)$/.test(head)) return { kind: 'unnamed' };
    }
  }
  return { kind: 'unnamed' };
}
/** The index of the `}` that closes the block the index `at` is in (the end of `src` when none does). */
function blockEnd(src: string, at: number): number {
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    const c = src[i]!;
    if (c === '"' || c === "'") { for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth < 0) return i;
  }
  return src.length;
}
/**
 * The writes of `src` whose refusal is not told. A writer is `store.apply`, a function `named` gives with what it
 * answers, or a function of a name whose body answers a writer's call (`const f = (...) => store.apply(...)`, `return`
 * of one, or `return` of the name that holds one): it answers what that call answers, or whether it wrote when it
 * reads `.ok`, and its own calls are checked the same way. An answer is told when it goes to `ui.wrote`, which says a
 * read-only tab's refusal as NOT_SAVED and a step's by the words its core module gives. It is handed on whole when it
 * is assigned to a name, handed to a function, the body of an unnamed arrow (a callback: the function it is handed to
 * reads it), or answered by an api member (its module's caller reads it). Four ways lose it. A call that stands as a
 * statement, or follows `void` or `return` in an unnamed function, drops it. An `Applied` tested as true or false (`!`,
 * `if (`, `&&`, `?`) reads a refusal as done. `.ok` or `.why` read by hand, on the call or on the name that holds it,
 * loses the refusal's kind: a read-only tab's refusal is then said as a step's ("Not enough mana") or not at all. And
 * a refusal answered as a `why` of other words (`if (!write()) return { ok: false, why: 'noRoom' }`) says what did not
 * happen.
 */
function unreadWrites(src: string, named: Record<string, WriteAnswer>): { line: number; call: string; why: string }[] {
  const text = src.split('\n').map(l => isComment(l) ? ' '.repeat(l.length) : l.replace(/(^|\s)\/\/[^'"`]*$/, '$1')).join('\n');
  const writers = new Map<string, WriteAnswer>([['store\\.apply', 'applied'], ['store\\(\\)\\.apply', 'applied'], ...Object.entries(named)]);
  const calls = () => [...writers].flatMap(([name, answer]) => [...text.matchAll(new RegExp(String.raw`(?<![\w$.])${name}\(`, 'g'))]
    .map(m => {
      const at = m.index, end = callEnd(text, at + m[0].length - 1);
      return { at, end, answer, call: text.slice(at, end), before: text.slice(Math.max(0, at - 200), at).trimEnd(), after: text.slice(end, end + 60) };
    }).filter(c => !/\bfunction$/.test(c.before)));
  const arrow = /(?:const|let|,)\s*([\w$]+)\s*=\s*(?:async\s+)?(?:\([^()]*\)|[\w$]+)(?:\s*:\s*[^{}();=]+)?\s*=>$/, member = /[\w$]+\s*:\s*(?:async\s+)?(?:\([^()]*\)|[\w$]+)\s*=>$/;
  const holds = /(?:const|let|,)\s*([\w$]+)\s*=$/;
  /** The name a call's answer is passed up to, with what it then answers; null when it is not passed up by name. */
  const passed = (c: ReturnType<typeof calls>[number]): [string, WriteAnswer] | null => {
    const answer: WriteAnswer = /^\s*\.ok\b/.test(c.after) ? 'wrote' : c.answer;
    const a = plainParams(c.before).match(arrow); if (a) return [a[1]!, answer];
    const held = c.before.match(holds)?.[1];
    const scope = held ? text.slice(c.end, blockEnd(text, c.end)) : '';
    if (held && (!new RegExp(String.raw`\breturn\s+${held.replace('$', '\\$')}\s*;`).test(scope) || new RegExp(String.raw`\bwrote\([^,()]*,\s*${held.replace('$', '\\$')}\b`).test(scope))) return null;
    if (!held && !/\breturn$/.test(c.before)) return null;
    const h = holderOf(text, c.at);
    return h.kind === 'named' ? [h.name, answer] : null;
  };
  for (let size = -1; size !== writers.size;) {
    size = writers.size;
    for (const c of calls()) { const p = passed(c); if (p && !writers.has(p[0])) writers.set(p[0], p[1]); }
  }
  const out: { line: number; call: string; why: string }[] = [];
  const hit = (c: { at: number; call: string }, at: number, why: string) => out.push({ line: text.slice(0, at).split('\n').length, call: c.call.replace(/\s+/g, ' '), why });
  const BY_HAND = 'its refusal is read by hand (.ok or .why), so a read-only tab\'s is said as a step\'s or not at all';
  for (const c of calls()) {
    if (/^\s*\.(ok|why)\b/.test(c.after)) { hit(c, c.at, BY_HAND); continue; }
    const held = c.before.match(holds)?.[1];
    if (held) {
      const from = c.end, rest = text.slice(from, blockEnd(text, from));
      // an answer ui.wrote told may then be read for its kind: what follows a refusal can differ by it
      if (new RegExp(String.raw`\bwrote\([^,()]*,\s*${held.replace('$', '\\$')}\b`).test(rest)) continue;
      const name = held.replace('$', '\\$'), whole = new RegExp(String.raw`^\s*(?:\?[^:;]*:|\)\s*return)\s*${name}\b`);
      for (const m of rest.matchAll(new RegExp(String.raw`(?<![\w$.])${name}\.(?:ok|why)\b`, 'g'))) if (!whole.test(rest.slice(m.index + m[0].length))) hit(c, from + m.index, BY_HAND);
    }
    if (/!$/.test(c.before) && /^\s*\)\s*return\s*\{\s*ok:\s*false\s*,\s*why:/.test(c.after)) { hit(c, c.at, 'its refusal is answered as a why of other words'); continue; }
    if (passed(c) || member.test(plainParams(c.before))) continue;
    if (/(?<![=!<>])=$/.test(c.before) || /[(,]$/.test(c.before)) continue;
    if (/\breturn$/.test(c.before) && holderOf(text, c.at).kind === 'member') continue;
    const dropped = c.before === '' || /(?:[;{})]|\belse|\bvoid|\breturn)$/.test(c.before);
    const truth = c.answer === 'applied' && /(?:!|&&|\|\||\?|:)$/.test(c.before);
    if (dropped || truth) hit(c, c.at, dropped ? 'its answer is dropped' : 'a refusal is an object, so it reads as done');
  }
  return out.sort((a, b) => a.line - b.line);
}

test('a view reads the answer of every write to the save: a refused write never goes on as done', async () => {
  // Audit 2026-11-19, AW-views-1 and the class "views ignore a refusal from store.apply" (BUG-views-5, -6, -7, -10, -19,
  // -20, -21): `store.apply` refuses in a read-only tab (another tab took over, a newer app's save) and a step refuses
  // what its rule does not allow, and a view that dropped the answer went on as if it wrote. A refused quest fail was
  // still reported to the GM (quests.js tested the refusal object as true), a refused coin ruling was still sent to the
  // room and asked again, a refused import read a report it never got. Implicit audit 3, M1 was the same class in the
  // makers. Read the answer: stop what follows the write, and tell the player by the refusal's kind (`ui.wrote`
  // tells a read-only tab's refusal; a step's own refusal has its words in the core module that refused it).
  // Re-audit 2026-11-20 (NEW-sync-1, NEW-gates-1, NEW-views-2, and spendMana and postLetter): four got past this rule,
  // which took `.ok` and `.why` as reading the answer and did not read src/edge. A solo run read `.why` against its own
  // words only, so a read-only tab's refusal said nothing; an objective tap stopped at `!...ok` and said nothing; the
  // sheet's write became a boolean (`toSheet`), so hunter.spendMana's caller said "Not enough mana"; sync.switchTo
  // dropped its write and answered true, and postLetter answered a refused write as "no room". Now only ui.wrote, or
  // the Applied handed on whole, reads an answer, and src/edge is read too.
  const named: Record<string, WriteAnswer> = { gmWrite: 'wrote', grantWrite: 'applied', questApply: 'applied' };
  const old = [
    "  function fail(hid, qid) {\n    if (!questApply('quest-fail', hid, x => failQuest(x, qid))) return false;\n    sendUpdate(hid, q, 'failed');\n  }\n  function questApply(reason, hid, f) {\n    const r = store.apply(reason, s => s);\n    return 'why' in r ? r : out;\n  }",
    "    store.apply('coin-rule', s => callRuled(s, id, ruling, body.side, stamp()));\n    sendLanding(body);",
    "  const onBag = (hid, why, step) => store.apply(why, atHunter(hid, step));\n  if (await ui.confirm(x)) onBag(h.id, 'item-del', x => removeItem(x, it.id));",
    "  const addLog = (kind, title) => gmWrite('gm-log', null, [], [line(kind, title)]);\n  addLog('system', 'Broadcast');",
    // NEW-views-2, NEW-gates-1: read by `.ok` and `.why`, a read-only tab's refusal said nothing
    "    if (!store.apply('quest-progress', atHunter(hid, x => progressSet(x, qid, i, value))).ok) return;",
    "    const w = store.apply('solo-run', s => s);\n    if (!w.ok || !ran) { if (!w.ok && 'why' in w && SOLO_REFUSAL_WORDS[w.why]) ui.toast('! Gate', SOLO_REFUSAL_WORDS[w.why]); return; }",
    // the spendMana leftover: the kind lost where a sheet write became whether it wrote, so the Shadows view said "Not enough mana"
    "  const onHunter = (hid, why, step) => store.apply(why, atHunter(hid, step));\n  const toSheet = (hid, why, write) => onHunter(hid, why, write).ok;\n  if (!toSheet(hid, 'mana', w)) return false;",
    // NEW-sync-1 in src/edge/sync.ts, and postLetter's read-only refusal answered as "no room"
    "  async function switchTo(hid: string): Promise<boolean> {\n    const act = (): void => { store.apply('switch-hunter', s => setActive(s, to.id)); };\n    act(); return true;\n  }",
    "  const boxDo = (reason: string, f: Step) => store.apply(reason, f).ok;\n  function flush(reason: string, first: Step): boolean {\n    const wrote = boxDo(reason, first);\n    return wrote;\n  }\n  function postLetter(letter: Letter): Posting {\n    if (!flush('outbox-post', b => b)) return { ok: false, why: 'noRoom' };\n  }",
  ];
  expect(old.map(src => unreadWrites(src, named).map(h => h.line)), 'the rule sees the old quest fail, coin ruling, bag removal, log line, objective, solo run, mana, hunter switch and post').toEqual([[2], [1], [2], [2], [1], [2, 2, 2, 2], [2], [2], [1, 7]]);
  const kept = [
    "  if (!ui.wrote('! Quest', store.apply('x', s => s))) return;\n  const w = store.apply('y', s => s);\n  if (!ui.wrote('! Gate', w, SOLO_REFUSAL_WORDS)) return;",
    "  const onHunter = (hid, why, step) => store.apply(why, atHunter(hid, step));\n  const toSheet = (hid, why, write) => onHunter(hid, why, write);\n  if (!ui.wrote('System', toSheet(hid, 'hp', w))) return;",
    "  if (!gmWrite('gm-hp', null, [ev], said)) return;\n  function gmWrite(why, change) { const w = store.apply(why, change); if (!ui.wrote('GM', w)) return false; return true; }",
    "  function questApply(reason, hid, f) {\n    const r = store.apply(reason, s => s);\n    return r.ok ? out : r;\n  }",
  ];
  expect(kept.map(src => unreadWrites(src, named)), 'and lets a told answer, or one handed on whole, pass').toEqual([[], [], [], []]);
  // A write whose refusal needs nothing: the list names each with why. A key is the file and the call's start.
  const ROOM = 'a room message or doc landing, which no one tapped: a read-only tab\'s banner says it cannot save, nothing after it reads the write as done, and the next landing tries again';
  const OUTBOX = 'the outbox\'s machine after a room\'s answer, a poll or a page load, which no one tapped: a message is sent only after a written step (flush), so a refused one stays in the box as it was';
  const ignored: Record<string, string> = {
    "src/views/gates.js: store.apply('solo-tick', s => { const r = soloTi": 'the System\'s clock on its timer: its one refusal is `unchanged` (soloTick: nothing fell due), a read-only tab never ticks (store.readOnly above it), and the news told after it reads the save as it is',
    'src/views/gm.js: addLog(\'system\', `Roll: ${t.label}`, text)': 'the roll table\'s line in the session log: gmWrite tells a refused write, the roll is shown either way, and nothing follows it',
    "src/views/gm.js: setOv(o => featsSwitched(o, on), [line('system',": 'the GM\'s switch for every feat: gmWrite tells a refused write, nothing follows it, and the switch is drawn from the rules',
    "src/views/gates.js: store.apply('gate-import', s => mergeDoc(s, { da": ROOM,
    "src/views/quests.js: store.apply('quest-update', s => told(s, stamp()": ROOM,
    "src/views/coin.js: store.apply('coin-call', s => callTaken(s, { id:": ROOM,
    "src/views/bestiary.js: store.apply('codex-room', s => codexFromRoom(s, ": ROOM,
    "src/views/bestiary.js: store.apply('codex-record', s => recordDefeatSte": 'a defeat counted on the fight\'s events, which follow only a fight write the store took (combat.js `command`, `combat-ended`), so a read-only tab never gets here; its one refusal, `counted`, is a row counted already (the end counts every row down), which needs no word',
    "src/edge/sync.ts: store.apply('sync-status', atSync(serverSeen))": 'the mark that a server answered, for the next boot\'s probe: refused, the next boot probes from the page as before',
    "src/edge/sync.ts: store.apply('noticed', s => released(s, noticeHe": 'the facts a fight held, released when the room\'s fight doc lets them go: refused, they wait in the inbox for the next release',
    "src/edge/sync.ts: boxDo('outbox-gone', b => roomGone(b, code), s =": OUTBOX,
    'src/edge/sync.ts: flush()': OUTBOX,
    "src/edge/sync.ts: boxDo('outbox-failed', b => outStep(b, e.id, ev)": OUTBOX,
    "src/edge/sync.ts: flush(`outbox-${ev.type}`, b => outStep(b, e.id,": OUTBOX,
    "src/edge/sync.ts: boxDo('outbox-reload', reloaded)": OUTBOX,
  };
  // A write whose refusal is lost today, in a file outside the unit that made this rule stricter (audit 2026-11-20,
  // NEW-sync-1). Each names what its fix needs. Fix one and its line leaves the list; a new one never joins it.
  const ANSWERS = 'an api member answers whether it wrote (its type in src/core/api.ts), so its caller cannot say a read-only tab\'s refusal: answer the Applied and let the caller tell it with ui.wrote';
  const open: Record<string, string> = {
    "src/edge/sync.ts: store.apply(reason, s => atOutbox(f)(heard ? hea": 'boxDo, under flush: answers whether it wrote, so postLetter cannot tell a read-only tab\'s refusal from no room',
    "src/edge/sync.ts: flush('outbox-post', b => { const r = postIn(b, ": 'postLetter answers a read-only tab\'s refusal as noRoom: `Posting` (src/core/api.ts) and `PostAnswer` (src/core/sync/connection.ts) need its own why, and the views that read it',
    "src/edge/sync.ts: store.apply('sync-link', s => linkWritten(s, fie": 'BUG-sync-7: a read-only tab\'s link moves on while its save does not',
    "src/edge/sync.ts: store.apply('sync-page', s => { const at = curso": 'BUG-sync-7: a read-only tab\'s poll cursor moves past events it could not land',
    "src/edge/sync.ts: store.apply('sync-applied', appliedOnce(eid, wri": `BUG-sync-7: once, ${ANSWERS}`,
    "src/edge/sync.ts: store.apply('sync-join', s => boundTo(addHunter(": 'bindJoin: a Join in a read-only tab binds no hunter and says nothing',
    "src/edge/sync.ts: store.apply('sync-join', s => boundTo(s, binds.h": 'bindJoin: a Join in a read-only tab binds no hunter and says nothing',
    "src/edge/sync.ts: store.apply('gmkeys-forget', atSync(s => ringGon": 'forgetKey: a Forget in a read-only tab keeps the key and says nothing',
  };
  // src/edge writes the save too (sync.ts switches the active hunter and fills the outbox); store.ts is the writer itself
  const files = [...await sourceTexts('src/views'), { file: 'src/app.js', text: await Bun.file(`${ROOT}/src/app.js`).text() },
    ...(await sourceTexts('src/edge')).filter(f => f.file !== 'src/edge/store.ts')];
  expect(Object.keys(named).filter(name => !files.some(f => new RegExp(String.raw`function ${name}\(`).test(f.text))), 'each named writer is a function of a view').toEqual([]);
  const hits = files.flatMap(({ file, text }) => unreadWrites(text, named).map(h => ({ key: `${file}: ${h.call.slice(0, 48)}`, at: `${file}:${h.line}: ${h.call.slice(0, 100)} (${h.why})` })));
  expect(hits.filter(h => !(h.key in ignored) && !(h.key in open)).map(h => h.at), 'read the answer of the write: tell a refusal by its kind with ui.wrote (src/views/ui.js; it answers whether it wrote) or hand the Applied on whole, or name the call in `ignored` with why its refusal needs nothing').toEqual([]);
  expect([...Object.keys(ignored), ...Object.keys(open)].filter(key => !hits.some(h => h.key === key)), 'a write that is gone or fixed leaves its list').toEqual([]);
});

test('a view reads another module\'s api without a guard: a registered name is always there', async () => {
  // Implicit audit 3, H8: `app.api.identity ?`, `A().build ?`, `app.api.combat?.isActive?.()`, `app.keys && app.keys.add`
  // read as if a module may be absent, but the api table throws for a name read before or without its register
  // (src/edge/api-table.ts), so the guard is never false, and hunter.js's fallback `setActive` beside `sync.switchTo` was
  // dead code that read as a second way to switch hunter.
  const guard = /\b(?:app\.api|A\(\))\.\w+\s*(?:\?\.|\?(?![?.])|&&)|\bapp\.keys\s*&&|\b(?:sync|A)\(\)\?\./;
  const old = [
    "        if (d.pset) return app.api.sync?.switchTo ? app.api.sync.switchTo(h.id) : store.apply('switch-hunter', s => setActive(s, h.id)); // S03",
    "    const hid = esc(remote ? key : h.id), path = A().build ? A().build.label(h) : '';",
    '    const live = !!(app.api.combat?.isActive?.());',
    '  if (app.keys && app.keys.add) {',
    "  const encounter = () => sync()?.doc?.('fight') ?? null;",
  ];
  expect(old.map(t => guard.test(t)), 'the rule sees each old guard').toEqual(old.map(() => true));
  expect(guard.test("    const c = app.api.sync.room() ? 1 : 0;"), 'a member read after the name passes').toBe(false);
  const hits = (await sourceLines('src/views')).filter(l => !isComment(l.text) && guard.test(l.text));
  expect(report(hits), 'read app.api.<name> as it is: the api table throws for a name no module registered').toEqual([]);
});

test('a view posts a room message through the outbox, never sends it once', async () => {
  // Implicit audit rows 19 and 20: an award, a use or a roll for the room was one POST with no record; a phone offline
  // at that moment lost it, and a toast (or nothing) said so. `app.api.sync.post` keeps it in the save's outbox
  // (src/core/sync/outbox.ts) until the room takes it, once. The GM view's awards, HP, statuses, broadcasts and quests
  // were the last to move (U10).
  const sendsOnce = /\.send\(\s*[\w.()]*?\bevent\(/;
  const old: Line[] = [
    { file: 'src/views/uses.js', line: 0, text: "      const seq = await sy.send(sy.event('used', { by: sy.myKey(hid), who: h.name.slice(0, 60)," },
    { file: 'src/views/gm.js', line: 0, text: '  const roomSend = (type, body) => { const sy = A().sync; return sy.send(sy.event(type, body)); };' },
  ];
  expect(old.map(line => sendsOnce.test(line.text)), 'the rule sees the old sends').toEqual([true, true]);
  const lines = (await sourceLines('src/views')).filter(line => !isComment(line.text) && sendsOnce.test(line.text));
  expect(report(lines), 'post it: app.api.sync.post(app.api.sync.event(type, body)). The outbox sends it after each good poll until the room takes it.').toEqual([]);
});

test('only src/edge/sync.ts writes the save\'s outbox, with the steps of src/core/sync/outbox.ts', async () => {
  // The outbox is one machine per message (docs/state-machines.md, "A message to the room"). A second writer would
  // move a message past its table: a message marked sent that never went, or one sent twice from two places.
  // bind.ts: the bind of a player's hunter drops its tombstone with outbox.ts `rebound`, as party.ts does at a delete
  const owners = ['src/edge/sync.ts', 'src/core/sync/outbox.ts', 'src/core/save.ts', 'src/core/party.ts', 'src/core/sync/bind.ts'];
  const writes = /\boutbox\s*=(?![=>])|\boutbox\s*:\s*(?!Outbox\b)/;
  const hits = (await sourceLines('src')).filter(line => !owners.includes(line.file) && !isComment(line.text) && writes.test(line.text));
  expect(report(hits), 'post with app.api.sync.post; the box changes only in sync.ts through outbox.ts (post, step, reloaded, roomGone, rebound).').toEqual([]);
});

test('a room event id is recorded only by appliedOnce, in the same write as the change it records', async () => {
  // Implicit audit row 17: sync.ts recorded an event's id in a store update of its own (`once(eid, () => {})`), then the
  // applier changed the hunter in later updates, so an award that threw part way was marked applied and never came
  // again. `appliedOnce` (src/core/applied.ts) records the id inside the step that makes the change; sync.ts `once`
  // writes that step with `store.apply`. Nothing else writes the ring.
  const owners = ['src/core/applied.ts', 'src/core/save.ts'];
  const writes = /\bsync\.applied\s*=(?![=>])|\bsync\s*:\s*\{[^}]*\bapplied\s*:/;
  const old: Line = { file: 'src/edge/sync.ts', line: 0, text: '    d.settings.sync.applied = ring;' };
  expect(writes.test(old.text), 'the rule sees the old ring write').toBe(true);
  const hits = (await sourceLines('src')).filter(line => !owners.includes(line.file) && !isComment(line.text) && writes.test(line.text));
  expect(report(hits), 'record a room event with app.api.sync.once(eid, step): the step is the change, and appliedOnce adds the id to it.').toEqual([]);
});

test('a hunter\'s level moves only in src/core/hunter/grant.ts, which tells the Job Change chain in the same step', async () => {
  // Implicit audit row 66: the chain's level step heard a level change only through a `level` event that two writers in
  // hunter.js emitted after their own write, so a new writer, an import or a throw between left the step behind. Every
  // step that moves a level is in grant.ts (`grant`, `levelEdit`), and each runs `levelled`.
  const owners = ['src/core/hunter/progress.ts', 'src/core/hunter/grant.ts'];
  const moves = /(?<![.\w$])(addXp|atLevel|setLevel|gainXp|raisedLevels)\(/;
  const old: Line = { file: 'src/views/hunter.js', line: 0, text: "    onHunter(hid, 'xp', both(x => addXp(x, n, rules()), fit));" };
  expect(moves.test(old.text), 'the rule sees the old XP write').toBe(true);
  const hits = (await sourceLines('src')).filter(line => !owners.includes(line.file) && !isComment(line.text) && moves.test(line.text));
  expect(report(hits), 'give XP with app.api.hunter.gainXP or applyRewards (grant.ts `grant`), and the GM\'s level edit with grant.ts `levelEdit`.').toEqual([]);
});

test('the day\'s clock is src/core/day.ts: no view or edge module works out a reset, a due time or whether a quest is overdue', async () => {
  // Implicit audit rows 58, 62 and 65: the countdown set the local hour in quests.js while core's dayKey subtracted
  // hours, an hour apart on a day the clocks change; a due time from hours and "overdue" were worked out in two views
  // each. day.ts (`dayKey`, `nextReset`, `dueAt`) and quests.ts (`overdue`, `pastDue`, `nextWake`) answer them.
  const works = /\.set(FullYear|Month|Date|Hours)\(|\bgetTimezoneOffset\(|\b(3600e3|86400e3|36e5|864e5)\b|Date\.parse\([^)]*dueAt\b/;
  const old: Line[] = [
    { file: 'src/views/quests.js', line: 0, text: '    if (r <= n) r.setDate(r.getDate() + 1);' },
    { file: 'src/views/quests.js', line: 0, text: "if (q0 && q0.kind === 'urgent' && q0.dueAt && Date.parse(q0.dueAt) <= Date.now()) {" },
  ];
  expect(old.map(line => works.test(line.text)), 'the rule sees the old countdown and the old Reopen guard').toEqual([true, true]);
  const lines = [...await sourceLines('src/views'), ...await sourceLines('src/edge')];
  const hits = lines.filter(line => !isComment(line.text) && works.test(line.text));
  expect(report(hits), 'ask src/core/day.ts (dayKey, nextReset, dueAt) or src/core/hunter/quests.ts (overdue, pastDue, nextWake) with the time.').toEqual([]);
});

test('a view waits on a timer only where this list names it with its reason', async () => {
  // Implicit audit kind 8 (row 64): the daily rollover ran from a 1 s tick, a 60 s interval and the page shown, none set
  // for the moment anything was due. A timer stands for an event; wait on the event (a store change, the page shown, a
  // machine's setTimer effect) or for the moment a rule in core names (`nextWake`). Each file's count is what it holds.
  const named: Record<string, { count: number; why: string }> = {
    'src/views/quests.js': { count: 2, why: 'the rollover\'s one timer (nextWake); the countdown drawn each second' },
    'src/views/ui.js': { count: 4, why: 'a toast\'s life, new and added up (two, kept in `toasts`); a System window opened late under E2E_POPUP_DELAY; the next waiting window opened a task after one closes (the `next` effect of src/core/windows.ts; `LATE`, 0 outside tests), so the closed one\'s leave runs first' },
    'src/views/room.js': { count: 3, why: 'a copied button\'s label put back; "Last sync" aged each second; a typed code checked after a pause' },
    'src/views/onboard.js': { count: 1, why: 'a typed code checked after a pause' },
    'src/views/map.js': { count: 2, why: 'the gesture\'s hold timer, whose end is the `hold` event (a GM\'s token lifted, a hotbar slot\'s detail; U9, row 48); the news line\'s life' },
    'src/views/gm.js': { count: 1, why: 'the room\'s presence ages drawn every 5 s' },
    'src/views/io.js': { count: 2, why: 'a download\'s URL revoked; a button\'s label put back' },
  };
  const timer = /\bset(Timeout|Interval)\(/g;
  const old: Line = { file: 'src/views/quests.js', line: 0, text: '  setInterval(checkDaily, 60000);' };
  expect(old.text.match(timer)?.length, 'the rule sees the old 60 s rollover clock').toBe(1);
  const counts = new Map<string, number>();
  for (const line of await sourceLines('src/views')) {
    if (line.file === 'src/views/motion.ts' || isComment(line.text)) continue;
    const n = line.text.match(timer)?.length ?? 0;
    if (n) counts.set(line.file, (counts.get(line.file) ?? 0) + n);
  }
  // a count is the file's own, not a ceiling: a count above what a file holds was room for new timers with no reason
  // read (implicit audit 2, step 3: quests.js, maker.js and onboard.js named timers they no longer had)
  const off = [...new Set([...counts.keys(), ...Object.keys(named)])].filter(file => (counts.get(file) ?? 0) !== (named[file]?.count ?? 0))
    .map(file => `${file}: ${counts.get(file) ?? 0} timers, ${named[file]?.count ?? 0} named`);
  expect(off, 'wait on the event the timer stands for, or name the timer here with its reason; a timer that is gone lowers its count').toEqual([]);
});

test('a view hangs state on an element only where this list names it with its reason', async () => {
  // Audit SM-views-1: a toast kept its timer and its held write as `t._t` and `t._act` on its element, where no list
  // named them, and each way a toast went (its time, Undo, a third toast, the page hidden) cleared them by hand. A view
  // keeps such state in a named Map (ui.js `toasts`) or a machine of core; a property hung on an element is named here
  // with what it holds, and each file's count is what it holds.
  const named: Record<string, { count: number; why: string }> = {
    'src/views/chronicle.js': { count: 1, why: 'the markup a box drew last (`_h`), so only a change is drawn' },
    'src/views/custom.js': { count: 1, why: 'the markup a box drew last (`_h`), so only a change is drawn' },
    'src/views/hunter.js': { count: 2, why: 'the markup a box and a select drew last (`_h`), so only a change is drawn' },
    'src/views/gates.js': { count: 1, why: 'what a gate card was drawn from (`_sig`), so only a changed card is drawn again' },
    'src/views/room.js': { count: 1, why: 'a copied button\'s timer that puts its label back (`_t`)' },
    'src/views/io.js': { count: 1, why: 'a button\'s timer that puts its label back (`_t`)' },
  };
  const hung = /\b[\w$]+\._[\w$]+\s*=(?!=)/g;
  const old: Line = { file: 'src/views/ui.js', line: 0, text: "  if (hold) { t._act = hold.act; t.dataset.held = ''; }" };
  expect(old.text.match(hung)?.length, 'the rule sees the old held write on the toast').toBe(1);
  const counts = new Map<string, number>();
  for (const line of await sourceLines('src/views')) {
    if (isComment(line.text)) continue;
    const n = line.text.match(hung)?.length ?? 0;
    if (n) counts.set(line.file, (counts.get(line.file) ?? 0) + n);
  }
  const off = [...new Set([...counts.keys(), ...Object.keys(named)])].filter(file => (counts.get(file) ?? 0) !== (named[file]?.count ?? 0))
    .map(file => `${file}: ${counts.get(file) ?? 0} properties on elements, ${named[file]?.count ?? 0} named`);
  expect(off, 'keep the state in a named Map of the view or a machine of core, or name the property here with its reason; one that is gone lowers its count').toEqual([]);
});

test('a view keeps no machine in flags: its closure state is counted per file, and two booleans in one let fail', async () => {
  // Implicit audit kind 1 (rows 47, 48): the battle map's gestures were `g.kind`, `quiet`, `pts` and a timer, and its choice
  // `sel`, `picked`, `before` and `drawer`, each a `let` in the map's closure, so the states they made together were
  // nowhere written down. A thing with states is a machine in core with its table (gesture.ts, `choose` in map-view.ts);
  // a view keeps the one value it feeds and the UI values no rule reads. A `let` at the top of a module, of `register` or
  // of a component's `mount` (four spaces in or less) is counted, and each file's count is what it holds.
  const named: Record<string, { count: number; why: string }> = {
    'src/views/map.js': { count: 16, why: 'the count of maps mounted, for each one\'s detail list (mounts); the three machines\' values (choice, g, life: map-mount.ts holds what was framed and the words over the frame), the scene and what the last frame drew (areaSig, along, draws, zonesWas, far, seen), the resize waiting for a frame (sized), the frame\'s place under a finger, the hold timer, the paint brush, the news line\'s timer; the open detail is detail.js\'s' },
    'src/views/maker.js': { count: 16, why: 'the makers\' window stack and form (body, me, draft, previewEl), the formula field (ticks, type, gapOn, text, kind), an effect row\'s amount and value, the field\'s end editor (zendFx), the ability form\'s kind, the Icon row\'s machine (picker, src/core/icon-pick.ts, moved only by iconPickStep) and its window while up (sheetWin)' },
    'src/views/combat.js': { count: 9, why: 'the GM\'s fight screen: the side marked surprised, the doc\'s last refusal and burst, what is open over the map (over), the root and the map\'s handle, and locals of three functions (aim twice, actions); the odds\' run is odds-box.js\'s' },
    'src/views/gm.js': { count: 8, why: 'the root, the Award editor\'s and Issue quest\'s handles, the reward the Award form opens with, and locals of a tool\'s form (n, msg, text, parsed)' },
    'src/views/quests.js': { count: 6, why: 'the rollover\'s timer (wake), the tab on screen, the quest form\'s state (form, quest-form.ts), whether the title is the one the form made (autoTitle), the view\'s handle, and a function\'s local (out)' },
    'src/views/uses.js': { count: 1, why: 'the turn held from a command\'s tap on any screen (src/core/combat/hold.ts, moved only by turnHoldStep through holdTo)' },
    'src/views/table.js': { count: 6, why: 'a player\'s fight HUD: the tab\'s title, the open card, the doc drawn last, the bursts to draw, the GM\'s Table feed and its handle' },
    'src/views/dice.js': { count: 4, why: 'the last typed rolls, the quick check\'s DC (src/core/dc-pick.ts, moved only by dcPickStep), the view\'s handle, whether the tray is open' },
    'src/views/ui.js': { count: 5, why: 'the audio context, a style element and the toast box (locals of two functions), the windows (src/core/windows.ts, moved only by `move`), the count of windows made, for their ids' },
    'src/views/reward-editor.js': { count: 4, why: 'the reward editor\'s rows, the numbers typed and the line it says, and a draw\'s locals (body, head)' },
    'src/views/hunter.js': { count: 4, why: 'the hunter and level the sheet drew last, the title being edited and the hunter it was for, the hunter the System raise window last opened for, and a function\'s local (grantWrite\'s out)' },
    'src/views/io.js': { count: 3, why: 'the Data view\'s redraw (refresh), set by its mount, and locals of two functions (report, raw)' },
    'src/views/bestiary.js': { count: 2, why: 'the enemy maker\'s rank, archetype and kind on screen, and a draw\'s locals (pool, unknown)' },
    'src/views/forge.js': { count: 2, why: 'the app, set by register for the module\'s helpers; the status maker\'s colour and whether it lasts until removed' },
    'src/views/gates.js': { count: 3, why: 'the room\'s world doc this GM phone merged last, the solo run machine\'s value (runPhase, its states are core gates/solo-run.ts), and a function\'s local (moved)' },
    'src/views/kit-parts.js': { count: 2, why: 'the count of blocks made, for their ids; a threshold\'s and an end\'s effects editors, drawn when first ticked' },
    'src/views/onboard.js': { count: 2, why: 'first-run setup\'s window and its step (its steps are core onboarding.ts)' },
    'src/views/skills.js': { count: 2, why: 'the skill maker\'s type and kind on screen' },
    'src/views/coin.js': { count: 1, why: 'the GM\'s window for the coin calls: the call it asks and the calls put off (src/core/coin.ts CoinPrompt, moved only by coinPromptStep); lost on a reload by design' },
    'src/views/custom.js': { count: 1, why: 'the HP last felt, so a buzz follows only a change' },
    'src/views/inventory.js': { count: 1, why: 'the bag\'s tab on screen' },
    'src/views/loot.js': { count: 1, why: 'the item maker\'s type on screen and whether its slot was set by hand' },
    'src/views/map-maker.js': { count: 1, why: 'the map maker\'s brush' },
    'src/views/words.js': { count: 2, why: 'the word whose answer\'s window is on screen (the save owes the window, src/core/sync/word.ts `owedAnswer`; this keeps a change of the save from opening it twice) and the GM\'s word whose answer field is open, a choice on screen' },
    'src/views/room.js': { count: 2, why: 'one line of handles: the element, the root, the query, the frame a redraw waits for; the lobby\'s value (src/core/sync/lobby.ts, moved only by lobbyDo), its code check\'s pause timer and the hunter picked under Play as' },
    'src/views/rulesref.js': { count: 1, why: 'a draw\'s count of the rows it showed' },
    'src/views/motion.ts': { count: 8, why: 'the motion system\'s running moves' },
    'src/views/patch.ts': { count: 4, why: 'the patch system\'s bindings' },
  };
  const closure = /^ {0,4}let\s/;
  const twoFlags = /^\s*let\s+\w+\s*=\s*(true|false)\s*,\s*\w+\s*=\s*(true|false)\b/;
  const old = ['    let g = null, quiet = false;', '    let fitted = \'\', actorWas = null, drawer = false, areaSig = \'\', lastWay = null;'];
  expect(old.every(t => closure.test(t)), 'the rule sees the map\'s old gesture and choice values').toBe(true);
  expect(twoFlags.test('    let dragging = false, quiet = true;'), 'the rule sees two flags declared together').toBe(true);
  const lines = await sourceLines('src/views');
  const counts = new Map<string, number>();
  for (const line of lines) if (closure.test(line.text)) counts.set(line.file, (counts.get(line.file) ?? 0) + 1);
  // a count is the file's own, not a ceiling: eleven files were named above what they held, room for one to three new
  // lets each with no reason read (implicit audit 2, step 3)
  const off = [...new Set([...counts.keys(), ...Object.keys(named)])].filter(file => (counts.get(file) ?? 0) !== (named[file]?.count ?? 0))
    .map(file => `${file}: ${counts.get(file) ?? 0} closure lets, ${named[file]?.count ?? 0} named`);
  expect(off, 'a value with states is a machine in core (its table, its chart); a UI value no rule reads is named here with what it holds, and a let that is gone lowers its count').toEqual([]);
  expect(report(lines.filter(l => twoFlags.test(l.text))), 'two booleans that change together are a machine: a union in core').toEqual([]);
});

// ── the room server (server.ts) ──
const serverText = (): Promise<string> => Bun.file(`${ROOT}/server.ts`).text();
const serverLines = async (): Promise<Line[]> => (await serverText()).split('\n').map((text, i) => ({ file: 'server.ts', line: i + 1, text }));

test('server.ts keeps no room state of its own: no module-level let, Map or Set; a room\'s state lives in its store', async () => {
  // The removals kept in a module Map (`KICKS`) beside the room's `_kicked` doc were lost at a restart, and the
  // presence Map (`lastSeen`) kept every room it saw for the life of the process (audit rows 34 and 37). A module-level
  // value outlives every room and every request; what a room holds goes in the `Store`, which sweeps it with the room.
  const moduleState = /^(export\s+)?(let|var)\s|^(export\s+)?const\s.*=\s*new\s+(Map|Set|WeakMap)\b/;
  const old = ['let storeP: Promise<Store> | null = null;', 'const lastSeen = new Map<string, Map<string, number>>();', 'const KICK_MS = 20_000, KICKS = new Map<string, number>();'];
  expect(old.filter(t => moduleState.test(t)), 'the rule sees the old module state').toEqual(old);
  const hits = (await serverLines()).filter(l => moduleState.test(l.text));
  expect(report(hits), 'keep it in the Store or in a closure made per database; a rule of the server is a constant in src/core/room-server.ts').toEqual([]);
});

test('server.ts swallows no error: a catch rethrows, answers the request, or is a state the health route shows', async () => {
  // A Postgres that failed at start was one console line and a memory store, and every room vanished at the next
  // restart (audit row 33). A catch here either throws again, answers with `J(...)` (a refused request or the 500),
  // or is named below with the state it puts the error in.
  const named: Record<string, string> = {
    "event({ type: 'failed'": 'the database is down (src/core/room-server.ts): /api/health says since when and why, the log says it at each try',
  };
  const blocks = (src: string): { line: number; body: string }[] => [...src.matchAll(/\bcatch\b\s*(\([^)]*\))?\s*\{/g)].map(m => {
    const start = m.index! + m[0].length;
    let depth = 1, i = start;
    for (; i < src.length && depth > 0; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; }
    return { line: src.slice(0, m.index).split('\n').length, body: src.slice(start, i - 1) };
  });
  const handled = (body: string) => /\bthrow\b|\breturn\s+J\(/.test(body) || Object.keys(named).some(k => body.includes(k));
  const old = "if (url) { try { return await postgresStore(url); } catch (e: any) { console.warn('[server] Postgres unavailable, using memory:', e?.message); } }";
  expect(blocks(old).filter(b => !handled(b.body)).length, 'the rule sees the old fallback').toBe(1);
  const text = await serverText();
  expect(blocks(text).length, 'the catches of server.ts are found').toBeGreaterThan(4);
  expect(blocks(text).filter(b => !handled(b.body)).map(b => `server.ts:${b.line}: catch {${b.body.trim().slice(0, 100)}}`), 'throw it again, answer the request with J(...), or make it a state the health route shows and name it here').toEqual([]);
  for (const k of Object.keys(named)) expect([k, text.includes(k)]).toEqual([k, true]);
});

test('server.ts has no any: a row, an error and a request body are read as unknown and parsed', async () => {
  // The store took plain strings and Postgres rows were `any` (audit row 36), so a row no parser of this build reads
  // reached the players as it was. The store takes RoomCode, SheetKey and DeviceId; rows go through src/core/protocol.ts.
  const any = /(:\s*any\b|\bas\s+any\b|<any>)/;
  expect(['const db: any = new Bun.SQL(url);', '} catch (e: any) {', 'rows.map((r: any): Ev => ('].filter(t => any.test(t)).length, 'the rule sees the old anys').toBe(3);
  const hits = (await serverLines()).filter(l => !isComment(l.text) && any.test(l.text));
  expect(report(hits), 'read it as unknown and parse it (src/core/protocol.ts, src/core/ids.ts)').toEqual([]);
});

// ── the app update (src/core/upgrade.ts) ──
test('the browser\'s storage is read and written only in src/edge/store.ts, beside the note the edge keeps before it', async () => {
  // Audit row 52: device memory sat beside the store in four views, each with its own try and its own swallowed failure,
  // so a full storage lost a gate's "already told" mark or the Table feed's Apply without a word. A view keeps its own
  // memory with `store.device(name)` (this phone, or `'tab'`), whose failed write is a banner as a failed save is
  // (src/core/store-life.ts `deviceFailed`). The list names each file that still reads storage itself, and why.
  const storage = /\b(localStorage|sessionStorage)\b/;
  expect(storage.test('let seen = null; try { seen = JSON.parse(localStorage.getItem(seenKey(code))); } catch { /* fresh */ }'), 'the rule sees a view reading storage').toBe(true);
  const allowed: Record<string, string> = {
    'src/edge/store.ts': 'the store',
    'src/edge/upgrade.ts': 'the note that this tab reloaded for a build, so it never reloads twice for one',
  };
  const lines = (await sourceLines('src')).filter(l => !isComment(l.text) && storage.test(l.text));
  expect(report(lines.filter(l => !(l.file in allowed))), 'keep a view\'s memory with store.device(name) (src/edge/store.ts), never with localStorage or sessionStorage').toEqual([]);
  expect(Object.keys(allowed).filter(file => !lines.some(l => l.file === file)), 'a file that no longer reads storage leaves the list').toEqual([]);
});

test('only src/edge/upgrade.ts listens to the service worker: the app update has one writer', async () => {
  // The pill listened to the worker's count on its own while upgrade.ts waited for its takeover on a 4 s timer, so the
  // two halves of one update did not know of each other (audit row 30). The update's state is the machine in
  // src/core/upgrade.ts; src/edge/upgrade.ts sends it every word of the worker, and a view reads `updateNow`.
  const listens = /serviceWorker\.(addEventListener|onmessage|oncontrollerchange)\b|\bworkers\.addEventListener\b/;
  const old = "  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {";
  expect(listens.test(old), 'the rule sees the pill\'s old listener').toBe(true);
  const lines = [...await sourceLines('src/edge'), ...await sourceLines('src/views'), ...(await sourceLines('src')).filter(l => l.file === 'src/app.js')];
  expect(lines.filter(l => l.file === 'src/edge/upgrade.ts' && listens.test(l.text)).length, 'the update\'s own listeners are found').toBeGreaterThan(0);
  const hits = lines.filter(l => l.file !== 'src/edge/upgrade.ts' && !isComment(l.text) && listens.test(l.text));
  expect(report(hits), 'a word of the worker is an event of the update (UpdateEvent in src/core/upgrade.ts), sent by src/edge/upgrade.ts; read the state with updateNow and onUpdate').toEqual([]);
});

// ── a view's own state (audit kind 1: a machine written as flags) ──
/**
 * The `let` (or `const`) statements a module keeps for the page: at its top, or at the top of its `register` function,
 * each as its line and its text after the keyword up to its `;`. Strings, templates, comments and regex literals are
 * stepped over, so a brace inside one does not count.
 */
function pageLets(src: string, kw: 'let' | 'const' = 'let'): { line: number; text: string }[] {
  const kwRe = new RegExp(`^${kw}\\s`);
  const out: { line: number; text: string }[] = [];
  const tpl: number[] = [];
  let depth = 0, inRegister = false, i = 0, line = 1, prev = '';
  const skipString = (q: string): void => { for (i++; i < src.length && src[i] !== q; i++) { if (src[i] === '\\') i++; else if (src[i] === '\n') line++; } i++; };
  const skipTemplate = (): void => {
    for (; i < src.length; i++) {
      if (src[i] === '\\') { i++; continue; }
      if (src[i] === '\n') line++;
      if (src[i] === '`') { i++; return; }
      if (src[i] === '$' && src[i + 1] === '{') { depth++; tpl.push(depth); i += 2; return; }
    }
  };
  while (i < src.length) {
    const c = src[i]!, two = src.slice(i, i + 2);
    if (c === '\n') { line++; i++; continue; }
    if (two === '//') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (two === '/*') { const e = src.indexOf('*/', i + 2); line += src.slice(i, e).split('\n').length - 1; i = e + 2; continue; }
    if (c === "'" || c === '"') { skipString(c); prev = 'x'; continue; }
    if (c === '`') { i++; skipTemplate(); prev = 'x'; continue; }
    if (c === '}' && tpl.length && tpl[tpl.length - 1] === depth) { tpl.pop(); depth--; i++; skipTemplate(); prev = 'x'; continue; }
    if (c === '/' && /^[(,=:[!&|?{};]?$/.test(prev)) {
      let cls = false;
      for (i++; i < src.length && (src[i] !== '/' || cls); i++) { if (src[i] === '\\') i++; else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; }
      i++; prev = 'x'; continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) inRegister = false; }
    else if (depth === 0 && /^export\s+function\s+register\s*\(/.test(src.slice(i, i + 40))) inRegister = true;
    else if ((depth === 0 || (depth === 1 && inRegister)) && kwRe.test(src.slice(i, i + kw.length + 1)) && !/[\w$.]/.test(src[i - 1] ?? '')) {
      out.push({ line, text: src.slice(i + kw.length + 1, src.indexOf(';', i)).replace(/\/\/.*$/gm, '').trim() });
    }
    if (!/\s/.test(c)) prev = /[\w$)\]]/.test(c) ? 'x' : c;
    i++;
  }
  return out;
}
/** The parts of a declaration list, split at its top-level commas. */
function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { parts.push(text.slice(from, i)); from = i + 1; }
  }
  parts.push(text.slice(from));
  return parts.map(p => p.trim()).filter(Boolean);
}

test('every let a view keeps for the page is named here with what it holds, and no two flags are declared together', async () => {
  // Flags set side by side became machines nobody drew: the room view's `wasRoom, wasGM`, a maker's open and edited, a
  // gesture's pressed and moved (audit kind 1, notes-implicit-U8.md). A `let` at a view module's top or in its
  // `register` lives as long as the page: each is named below with what it holds, so a new one is a choice someone
  // read. A state with more than two values, or two flags that change together, is a union or a machine in core
  // (a `TABLE`, docs/guide/machines.md), never two lets.
  const what = {
    handle: 'a handle on what the view drew or the browser gave, not a state of the game',
    drawn: 'what was drawn last, so only a change is drawn again',
    shown: 'a choice on screen in this tab, one control\'s, lost on a reload by design',
  };
  const named: Record<string, string> = {
    'bestiary.js lastHtml': what.drawn,
    'coin.js prompt': 'the GM\'s window for the coin calls: the call it asks and the calls put off (src/core/coin.ts CoinPrompt, moved only by coinPromptStep); lost on a reload by design',
    'combat.js surprised': 'the side the GM marked surprised before the start; the fight takes it at its start',
    'combat.js tableRefusal': 'the last refusal of a player\'s move for the fight doc, its count inside it (`n`), so a repeat is told again',
    'combat.js lastBurst': 'the last threshold burst for the fight doc, its count inside it (`n`), so a repeat is drawn again',
    'combat.js root': what.handle, 'combat.js sel': what.shown, 'combat.js over': 'what is open over the map: nothing, a row\'s card or the Fight tools; one union, so two cannot be open at once', 'combat.js build': 'who holds the Build drawer (map-mount.ts BuildDrawer): the screen, or the GM\'s hand for one fight; moved only by drawerTo', 'map.js mounts': 'the count of maps mounted, for each one\'s own detail list',
    'combat.js lastOrder': what.drawn, 'combat.js shownLog': what.drawn,
 'combat.js mapView': what.handle,
    'custom.js hpSeen': 'the HP last felt, so a buzz follows only a change',
    'dice.js recent': 'the last typed rolls, kept with store.device',
    'dice.js viewInst': what.handle, 'dice.js sheetInst': what.handle, 'dice.js isOpen': what.shown,
    'forge.js A': 'the app, set by register for the module\'s helpers',
    'gates.js merged': 'the room\'s world doc this GM phone merged last',
    'gates.js runPhase': 'this phone\'s solo run from the tap on Enter alone until its window closes (src/core/gates/solo-run.ts, one machine, moved only by `runMoved`); page memory, as nothing of a run is stored before its one write',
    'gm.js root': what.handle, 'gm.js editor': what.handle,
    'gm.js awardDraft': 'the Award form\'s draft (award.ts AwardDraft), stepped only by draftStep', 'gm.js questForm': what.handle,
    'hunter.js shownHunter': what.drawn, 'hunter.js shownLevel': 'the level drawn last, so a rise is drawn as a level-up',
    'hunter.js editingTitle': what.shown, 'hunter.js lastHid': what.drawn,
    'hunter.js raiseOffered': 'the hunter the System raise window last opened for by itself, so one death opens it once; lost on a reload by design, which offers it again',
    'inventory.js tab': what.shown,
    'io.js refresh': 'the Data view\'s redraw, set by its mount',
    'motion.ts tokens': 'the motion tokens read once from the page\'s CSS', 'motion.ts osReduce': what.handle,
    'motion.ts layerEl': what.handle, 'motion.ts bits': what.handle,
    'onboard.js root': what.handle, 'onboard.js me': what.handle,
    'onboard.js at': 'the first-run window: its step, what the step\'s tap has under way and the ? guide (src/core/onboarding.ts), moved only by go',
    'quests.js wake': 'the one timer\'s id, set for nextWake (src/core/hunter/quests.ts)',
    'quests.js tab': what.shown, 'quests.js form': 'the quest form\'s state (src/core/hunter/quest-form.ts), moved only by questFormStep through formMoved',
    'quests.js autoTitle': 'whether the quest form\'s title is still the one it made, so a pick may replace it',
    'quests.js questForm': what.handle, 'quests.js viewEl': what.handle,
    'room.js el': what.handle, 'room.js root': what.handle, 'room.js q': what.handle, 'room.js raf': 'the frame a redraw waits for',
    'room.js lobbyNow': 'the Room view\'s two code checks and the GM\'s seat actions out (src/core/sync/lobby.ts, one value, moved only by lobbyDo)',
    'room.js pause': 'the typed code\'s pause timer, set and cleared only by the lobby\'s setTimer and clearTimer effects', 'room.js picked': what.shown,
    'words.js open': 'the word whose answer\'s window is on screen, so each change of the save does not open it again; the save owes the window until it closes (src/core/sync/word.ts `owedAnswer`)',
    'words.js answering': what.shown,
    'uses.js hold': 'the turn held from a command\'s tap on any screen until the room answers, refuses or drops it, or the phone leaves the room (src/core/combat/hold.ts, moved only by turnHoldStep; `command`)',
    'table.js titled': 'whether the tab\'s title says it is the player\'s turn',
    'table.js cardId': what.shown, 'table.js mapView': what.handle,
    'table.js lastDoc': what.drawn,
    'table.js pendingBursts': 'the bearers whose stacks went off in the doc just taken, drawn once the HUD shows it',
    'table.js feed': 'the GM\'s Table feed, kept in this tab with store.device',
    'table.js feedEl': what.handle, 'table.js feedSig': what.drawn, 'table.js feedOpen': what.shown,
    'ui.js actx': what.handle, 'ui.js windows': 'the windows on screen, waiting and going: the one value of src/core/windows.ts, moved only by `move`',
    'ui.js made': 'the count of windows made, for their ids',
  };
  type Let = { key: string; at: string; flags: number };
  const found: Let[] = [];
  const dir = 'src/views';
  for (const name of (await readdir(`${ROOT}/${dir}`)).filter(n => /\.(js|ts)$/.test(n)).sort()) {
    for (const { line, text } of pageLets(await Bun.file(`${ROOT}/${dir}/${name}`).text())) {
      const parts = splitTop(text), flags = parts.filter(p => /=\s*(true|false|!)/.test(p)).length;
      for (const p of parts) found.push({ key: `${name} ${/^\s*([\w$]+)/.exec(p)?.[1] ?? p}`, at: `${dir}/${name}:${line}`, flags });
    }
  }
  const sample = "export function register(app) {\n  ui.css('x', `.a{b:c} ${x ? '}' : '{'}`);\n  let open = false, edited = !x;\n  const f = () => { let inner = 1; };\n  let room = null; // } a brace\n}\nlet top = 0;\nfunction other() {\n  let local = 0;\n}";
  expect(pageLets(sample).map(l => [l.line, splitTop(l.text).length]), 'the rule sees a page let and two flags together, and not a function\'s own').toEqual([[3, 2], [5, 1], [7, 1]]);
  expect(found.length, 'the lets of the views are found').toBe(Object.keys(named).length);
  expect(found.filter(l => !(l.key in named)).map(l => `${l.at}: ${l.key}`), 'name this let below with what it holds, or make the state a union or a machine in core').toEqual([]);
  expect(Object.keys(named).filter(k => !found.some(l => l.key === k)), 'a let that is gone leaves the list').toEqual([]);
  expect([...new Set(found.filter(l => l.flags > 1).map(l => l.at))], 'two flags declared together are a machine: one union of their states, or a TABLE in core').toEqual([]);
});

test('every Map, Set, list or object a view keeps for the page is named here with what it holds, and none holds a fight row\'s, hunter\'s or other saved thing\'s state', async () => {
  // A fallen monster's extraction attempts were `const tried = new Map()` in combat.js's register, keyed by the fight
  // row's id: a reload gave every corpse its tries back (audit row 39, notes-implicit-U4-combat.md). State of a row, a
  // hunter or anything the save holds lives in the save, written by a step of core. A container a view keeps for the
  // page holds only what the screen shows, so each is named below with what it holds and why it may die with the page.
  const what = {
    shown: 'a choice on screen in this tab, one control\'s, lost on a reload by design',
    drawn: 'what was drawn last, so a change is drawn as a change (a drawing cache)',
    handle: 'handles on what the view drew or the browser gave, not a state of the game',
  };
  const named: Record<string, string> = {
    'bestiary.js f': 'the codex filters on screen (rank, type, search, encountered only): ' + what.shown,
    'combat.js mapSource': 'what the GM\'s map is given: the fight\'s readers and the commands this phone sends (`MapSource`): ' + what.handle,
    'custom.js pick': 'the open identity picker\'s emblem, colour and hunter: ' + what.shown,
    'gates.js mounted': 'the Gates view\'s redraw, its paint of the solo run in flight and its open request, set by its mount: ' + what.handle,
    'odds-box.js boxes': 'each odds box on screen by its key: the engine\'s run asked there (src/core/combat/odds.ts, one machine), the fight it is drawn for, its element and who waits for its answer; never in the save: ' + what.shown,
    'room.js open': 'the roster rows whose Manage is open: ' + what.shown,
    'table.js hud': 'whether the HUD is drawn, the order and the line it drew last: ' + what.drawn,
    'table.js mapSource': 'what a player\'s map is given: the doc\'s readers and the moves this phone posts (`MapSource`): ' + what.handle,
    'bestiary.js counts': 'the number of copies typed beside each monster card, by monster id, until Add is tapped: ' + what.shown,
    'coin.js fresh': 'the coins that landed while this page was open and whose result card is not closed: ' + what.shown,
    'combat.js picks': 'the target each row\'s move control and use picker start on, by row id: ' + what.shown,
    'combat.js amounts': 'the HP amount typed on a row\'s card before Damage or Heal is tapped, by row id: ' + what.shown,
    'detail.js open': 'the open detail of each list, list name to its state of src/core/detail-open.ts, the one place it is kept: ' + what.shown,
    'dice.js shown': 'the faces of the latest 20 rolls with their fates, by roll id (the log keeps the faces): ' + what.drawn,
    'gates.js asking': 'the gate news windows asked for and not answered yet, by room, kind and gate (told when answered): ' + what.shown,
    'feats.js asking': 'the feat windows asked for and not answered yet, by hunter and key (told when answered): ' + what.shown,
    'quests.js telling': 'the windows of quests the System completed, asked for and not answered yet, by hunter and quest (told when answered): ' + what.shown,
    'gm.js sel': 'the hunters ticked in the Award form: ' + what.shown,
    'motion.ts running': 'the animation running on each element: ' + what.handle,
    'motion.ts marks': 'where each element was drawn before a layout change, for the move animation: ' + what.drawn,
    'motion.ts counting': 'the number an element is counting up to: ' + what.drawn,
    'motion.ts lastShown': 'the number last shown under a key, so a change counts from it: ' + what.drawn,
    'motion.ts lastShownOf': 'the number last shown in an element: ' + what.drawn,
    'motion.ts fillsOf': 'the fill a bar showed last: ' + what.drawn,
    'patch.ts bound': 'the nodes a patched list drew and what they drew: ' + what.drawn,
    'quests.js barsWas': 'what each objective\'s bar showed last, by quest id and objective: ' + what.drawn,
    'room.js WAITING': 'a constant: the link states the line pulses for',
    'ui.js newsLines': 'the maps\' news lines that take the fight\'s news while they show a fight: ' + what.handle,
    'ui.js parts': 'each window\'s parts on the page by its id (its overlay, its key handler; a System window\'s words, answer and Confirm all), kept until src/core/windows.ts says to forget it: ' + what.handle,
    'ui.js toasts': 'each toast on screen by its element, until it goes: its timer and the write a held toast makes as it ends, so the write runs once and no timer outlives it: ' + what.handle,
  };
  // Implicit audit 3, X1: page state kept in a const object with fields (room.js's `S`: two server checks, a pick, open
  // rows and a timer) escaped both page-state lints, so an object literal with fields is a container too.
  const container = /^(?:new\s+(?:Weak)?(?:Map|Set)\b|\{\s*\}|\[\s*\]|\{\s*[\w$]+\s*:)/;
  expect(container.test("{ jc: null, ic: null, hid: null, open: new Set(), t: 0 }"), 'the rule sees room.js\'s old page object').toBe(true);
  /** The containers a module keeps for the page: a const at its top or its register's top made as an empty or new Map, Set, list or object, or an object with fields. */
  const containersIn = (src: string): { line: number; name: string }[] => pageLets(src, 'const').flatMap(d => splitTop(d.text).flatMap(p => {
    const m = /^([\w$]+)\s*(?::[^=]*)?=\s*([\s\S]*)$/.exec(p);
    // an UPPER_CASE object is a constant table of words or values (KIND_LABEL), never written; any other name with fields is state
    const fields = /^\{\s*[\w$]+\s*:/.test(m?.[2]!.trim() ?? '');
    return m && container.test(m[2]!.trim()) && !(fields && /^[A-Z][A-Z0-9_]*$/.test(m[1]!)) ? [{ line: d.line, name: m[1]! }] : [];
  }));
  const old = "export function register(app) {\n  const { store, ui } = app;\n  /** Extraction attempts on a fallen monster by row id. */\n  const tried = new Map();\n  const picks = new Map();\n  function f() { const local = new Set(); }\n}\nconst top = {};";
  expect(containersIn(old).map(c => `${c.line} ${c.name}`), 'the rule sees the old Map of attempts, and not a function\'s own').toEqual(['4 tried', '5 picks', '8 top']);
  const found: { key: string; at: string }[] = [];
  const dir = 'src/views';
  for (const name of (await readdir(`${ROOT}/${dir}`)).filter(n => /\.(js|ts)$/.test(n)).sort()) {
    for (const c of containersIn(await Bun.file(`${ROOT}/${dir}/${name}`).text())) found.push({ key: `${name} ${c.name}`, at: `${dir}/${name}:${c.line}` });
  }
  expect(found.length, 'the containers of the views are found').toBe(Object.keys(named).length);
  expect(found.filter(c => !(c.key in named)).map(c => `${c.at}: ${c.key}`), 'state of a row, a hunter or a saved thing goes in the save through a step of core; a container for the screen only is named here with what it holds').toEqual([]);
  expect(Object.keys(named).filter(k => !found.some(c => c.key === k)), 'a container that is gone leaves the list').toEqual([]);
});

// ── swallowed errors (audit kind 7, unit U12) ──
type Catch = { file: string; line: number; text: string; ok: boolean };
/**
 * Each catch in a source text: a `catch` block (its binding and its body, braces matched) or a `.catch(...)` call (its
 * handler), and whether it reads its error, throws again, or gives a reason in a comment from it to the end of the
 * line where it ends.
 */
function catchesIn(file: string, src: string): Catch[] {
  const close = (from: number, open: string, shut: string): number => {
    let depth = 1, i = from;
    for (; i < src.length && depth > 0; i++) { if (src[i] === open) depth++; else if (src[i] === shut) depth--; }
    return i;
  };
  const lineOf = (at: number): number => src.slice(0, at).split('\n').length;
  const toEol = (at: number): string => { const e = src.indexOf('\n', at); return src.slice(at, e < 0 ? src.length : e); };
  /** A reason: a comment of four words or more, so `ignore`, `optional` or `gone` alone is not one. */
  const reasoned = (text: string): boolean => [...text.matchAll(/\/\/(.*)$|\/\*([\s\S]*?)\*\//gm)].some(m => (m[1] ?? m[2] ?? '').trim().split(/\s+/).filter(Boolean).length >= 4);
  const uses = (name: string | undefined, body: string): boolean => !!name && new RegExp(`\\b${name}\\b`).test(body);
  const shown = (from: number, to: number): string => src.slice(from, Math.min(to, from + 100)).replace(/\s+/g, ' ');
  const out: Catch[] = [];
  for (const m of src.matchAll(/(?<![.\w])catch\s*(?:\(\s*(\w+)[^)]*\))?\s*\{/g)) {
    const start = m.index + m[0].length, end = close(start, '{', '}'), body = src.slice(start, end - 1);
    const ok = uses(m[1], body) || /\bthrow\b/.test(body) || reasoned(src.slice(m.index, end) + toEol(end));
    out.push({ file, line: lineOf(m.index), text: shown(m.index, end), ok });
  }
  for (const m of src.matchAll(/\.catch\(/g)) {
    const start = m.index + m[0].length, end = close(start, '(', ')'), handler = src.slice(start, end - 1);
    const param = /^\s*(?:\(\s*(\w+)\s*(?::[^)]*)?\)|(\w+))\s*=>/.exec(handler), name = param?.[1] ?? param?.[2];
    const ok = (!!param && uses(name, handler.slice(param[0].length))) || reasoned(src.slice(m.index, end) + toEol(end));
    out.push({ file, line: lineOf(m.index), text: shown(m.index, end), ok });
  }
  return out;
}

test('no error is swallowed: a catch reads its error, throws it again, or says why it need not', async () => {
  // About thirty calls of another module's api answered an empty list, null or false on any throw, a death save rolled
  // its own die, `safe()` turned a throwing `when` into a default, and the worker's register and the worker's install
  // were `.catch(() => {})`: a bug looked like an empty screen, and a worker missing a file took over, with no word in
  // the console (audit rows 1, 9, 29, 80, 82). A catch in src/ or server.ts reads its error (logs it with `reported`,
  // src/edge/report.ts, or tells the player by its kind), throws it again, or carries a comment of four words or more
  // saying why the error itself is not needed (a fallback the browser forces, a typed failure the player is told).
  // Deleting the try is often the fix: app.js draws the failed part and logs it.
  const old = [
    "  const shopItems = () => { try { return app.api.inventory.shop() || []; } catch { return []; } };",
    "    try { const r = app.api.dice.roll('1d20', { label: 'Death save', who: h.name }); nat = r.natural ?? r.total; } catch { nat = rollDice({ count: 1, sides: 20 }); }",
    "const safe = (fn, dflt = true) => { try { return fn(); } catch { return dflt; } };",
    "    addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });",
    "  } catch { /* ignore */ }",
    "    await Promise.all(SHELL.map(u => c.add(u).catch(() => {}).then(() => { done++; tell(); })));",
    "    if (actx && actx.state === 'suspended') actx.resume().catch(() => {}); } catch { actx = null; }",
  ];
  expect(old.map(t => catchesIn('old', t).filter(c => !c.ok).length), 'the rule sees each old swallow').toEqual([1, 1, 1, 1, 1, 1, 2]);
  const fine = [
    "  } catch (e) { reported('sync', e); return 'server'; }",
    "    try { a = await fetchApi(); } catch (e) { if (e instanceof NoAnswer) return null; throw e; }",
    "  try { area(where).setItem(key, text); return true; } catch { return false; } // full or blocked: the caller's step says so",
    "    register().catch(e => reported('sync:worker', e));",
  ];
  expect(fine.map(t => catchesIn('fine', t).every(c => c.ok)), 'the rule passes each way of handling').toEqual([true, true, true, true]);
  const files = [...new Set((await sourceLines('src')).map(l => l.file))];
  const found = [...(await Promise.all(files.map(async f => catchesIn(f, await Bun.file(`${ROOT}/${f}`).text())))).flat(), ...catchesIn('server.ts', await serverText())];
  expect(found.length, 'the catches of src/ and server.ts are found').toBeGreaterThan(40);
  /** Catches another unit still owns, by file and line, each with its reason. Empty: none is left. */
  const allowed: Record<string, string> = {};
  const hits = found.filter(c => !c.ok && !(`${c.file}:${c.line}` in allowed)).map(c => `${c.file}:${c.line}: ${c.text}`);
  expect(hits, 'read the error (reported(where, e) in src/edge/report.ts, or tell the player by its kind), throw it again, delete the try so app.js shows the failure, or say in a comment of four words or more why the error is not needed').toEqual([]);
});

// ── kind 5 of the implicit audit: an id, a kind or a result carried as a bare string or guessed from words (U14) ──

test('a hunter is found by its id, never by its name', async () => {
  // A roll and a coin call named their hunter by `who`, its name, and the edge found the hunter by name: two hunters of
  // one name, or a renamed one, sent under the wrong hunter's key (audit row 23). The roll entry and the coin hold the
  // hunter's id (`hid`, `HunterRef`); `who` is only the words shown.
  const byName = /\b(?:hunters|monsters|rows|remotes\(\)|list\(\))\.(?:find|filter|some|findIndex)\([^)]*\.name\s*===/;
  const old = [
    '    const h = (entry?.who && store.get().hunters.find(x => x.name === entry.who)) || store.active();',
    '  const byOf = c => sync().myKey((store.get().hunters.find(h => h.name === c.who) || store.active()).id);',
  ];
  expect(old.map(t => byName.test(t)), 'the rule sees each old lookup').toEqual([true, true]);
  const hits = (await sourceLines('src')).filter(l => !isComment(l.text) && byName.test(l.text));
  expect(report(hits), 'find the hunter by the id the thing holds (a roll entry\'s `hid`, a coin\'s `hunter`, a sheet key\'s `hunterIdOf`)').toEqual([]);
});

test('no behaviour is decided by a regex on a label: a kind is set where the thing is made', async () => {
  // Whether a player's roll was damage (the feed's "Apply") was a regex on its label, and whether a monster was a gate's
  // placeholder a regex on its name: a damage roll labelled "Hit" offered nothing, and an extraction of a monster named
  // "Strike Wolf" offered damage (audit row 24, and the sweep). A roll's `kind` is set by the dice tray; a placeholder
  // carries `placeholder: true` from the spawn. A skill's badge followed the level when its label read "Lv.n": a label
  // is now the GM's words, and no label shows the level.
  const onLabel = /\.test\([\w.?]*\b(?:label|name|title|who)\b/;
  const old = [
    '    const dmg = !HEAL.test(label) && /damage|dmg|attack|strike/i.test(label);',
    "  const own = (m: SpawnMonster) => !!m.custom && !(m.type === 'Gate' && PLACEHOLDER.test(m.name));",
    "  const level = k.level + 1, label = k.label && /^lv\\.?\\s*\\d+$/i.test(k.label) ? `Lv.${level}` : k.label;",
  ];
  expect(old.map(t => onLabel.test(t)), 'the rule sees each old guess').toEqual([true, true, true]);
  const hits = [...await sourceLines('src/core'), ...await sourceLines('src/edge'), ...await sourceLines('src/views')]
    .filter(l => !isComment(l.text) && onLabel.test(l.text));
  expect(report(hits), 'store the fact where the thing is made (a kind, a mark) and read that').toEqual([]);
  // A use's toast was the fight log's line found by its words (`l.includes(\`${u.name} uses ${a.name}\`)`, audit 2 N5): a
  // reworded line toasted nothing. The fight answers the line it logged (the `used` effect); nothing finds a line by text.
  const byText = /\.(?:find|some|filter)\(\s*\w+\s*=>\s*\w+(?:\.text)?\.includes\(`/;
  expect(byText.test("    const line = newLines(before, fight()).find(l => l.includes(`${u.name} uses ${a.name}`));"), 'the rule sees the old toast').toBe(true);
  const found = [...await sourceLines('src/core'), ...await sourceLines('src/edge'), ...await sourceLines('src/views')].filter(l => !isComment(l.text) && byText.test(l.text));
  expect(report(found), 'answer the line from the step that writes it, as the fight\'s `used` effect does').toEqual([]);
  // Implicit audit 3, K1: which errors kit-parts.js showed again in a group's bottom line was a regex on their words
  // (`/^(Pick|HP|A share|...)/.test(e)`): the copy pass rewording "Pick a status." would show it twice, and a new error
  // starting "HP" was hidden. An error carries where it is shown (`{ text, at: 'row' | 'group' }`).
  const onWords = /\/\^\((?:[A-Z][\w ]*\|)+[A-Z][\w ]*\)\/\.test\(|\.test\([\w.?]*\b(?:err|errs|error|message|msg)\b/;
  expect(onWords.test("    if (err) err.textContent = errs.filter(e => !/^(Pick|HP|A share|Stacks|At least|Uses|Write the field|Rounds go)/.test(e))[0] || '';"), 'the rule sees the old bottom line').toBe(true);
  const worded = [...await sourceLines('src/core'), ...await sourceLines('src/edge'), ...await sourceLines('src/views')].filter(l => !isComment(l.text) && onWords.test(l.text));
  expect(report(worded), 'carry the fact with the error where it is made (where it is shown, its kind), never its words').toEqual([]);
});

test('no as never outside the line where a core table calls its step', async () => {
  // `sync.event(type: string, body: unknown)` cast both `as never`, so a wrong type or body compiled and was null at run
  // time (audit row 27). A table's dispatch (`step(state, event as never)`) is the one place the compiler cannot pair a
  // row's step with its event; anywhere else the type is fixed instead.
  const dispatch = /\(\s*\w+(?: as never)?,\s*(?:event|e|cmd) as never\b/;
  const old = "  const event = (type: string, body: unknown): RoomEvent | null => newEvent(type as never, body as never, { device: deviceId(), now: Date.now(), rand: Math.random() });";
  expect([/\bas never\b/.test(old) && !dispatch.test(old), dispatch.test('  return step ? step(coin, event as never) : coin;')], 'the rule sees the old cast and passes a dispatch').toEqual([true, true]);
  const hits = [...await sourceLines('src/core'), ...await sourceLines('src/edge')].filter(l => !isComment(l.text) && /\bas never\b/.test(l.text) && !dispatch.test(l.text));
  expect(report(hits), 'type the call: a generic over the table\'s key (as `event<K>(type: K, body: EventBody<K>)`), or a parser at the boundary').toEqual([]);
});

test('no any in src/core and src/edge', async () => {
  // The GM's overrides were merged by `merge(base: any, ...): any` (audit row 90): nothing checked what came out.
  // `MakerApi.open` answered `Promise<any>` and `KitFields` was `any`: open is generic over its body's answer, and the
  // kits fields are a type of their own.
  const anyType = /:\s*any\b|<any>|\bas any\b|\bany\[\]|\btype\s+\w+\s*=\s*any\b/;
  const old = [
    'const merge = (base: any, ov: Record<string, unknown>): any => {',
    '  open(o: { tag: string; title: string; build(body: HTMLElement, shell: MakerShell): MakerBody }): Promise<any>;',
    'export type KitFields = any;',
  ];
  expect(old.map(t => anyType.test(t)), 'the rule sees the old merge, the maker\'s answer and the kits fields').toEqual([true, true, true]);
  const hits = [...await sourceLines('src/core'), ...await sourceLines('src/edge')].filter(l => !isComment(l.text) && anyType.test(l.text));
  expect(report(hits), 'read the value as unknown and parse it, or name its type').toEqual([]);
});

test('one brand: only src/core/ids.ts declares the brand, and each branded name is used once', async () => {
  // Thirteen modules declared a brand symbol of their own, and `RemoteKey` and `SheetKey` were one id under two names
  // (audit row 87). A branded type is `Id<'Name'>` or `Brand<T, 'Name'>` from ids.ts; two types with one name would be
  // one type, so each name is used once.
  const lines = await sourceLines('src');
  const declares = lines.filter(l => /declare const brand\b/.test(l.text) && l.file !== 'src/core/ids.ts');
  expect(report(declares), 'import Id or Brand from src/core/ids.ts').toEqual([]);
  const names = lines.filter(l => !isComment(l.text)).flatMap(l => [...l.text.matchAll(/\b(?:Id<|Brand<[^,<>]+(?:<[^<>]*>)?,\s*)'(\w+)'>/g)].map(m => ({ name: m[1]!, at: `${l.file}:${l.line}` })));
  expect(names.length, 'the branded types are found').toBeGreaterThan(15);
  const twice = names.filter((n, i) => names.findIndex(x => x.name === n.name) !== i).map(n => `${n.at}: ${n.name}`);
  expect(twice, 'a branded name is one kind of value: use the type that has it').toEqual([]);
});

test('two stored times are compared with compareTimes, never as text', async () => {
  // The GM's unseen uses and the codex's newest entry compared ISO strings (audit row 59): right only while every time
  // is written the same way. `compareTimes` (src/core/day.ts) compares them as instants. The fight's `at` is a tick, a
  // number, so src/core/combat is not read.
  const stamp = String.raw`\.(?:at|[a-z]+At)\b`;
  const asText = new RegExp(String.raw`${stamp}\s*[<>]=?\s*[\w.]*(?:${stamp}|\bseen\b)|${stamp}[^;]*localeCompare|At\]\.filter\(Boolean\)\.sort\(\)`);
  const old = [
    "  const unseenUses = () => { const seen = store.prefs().usesSeen; return S().log.filter(l => l.kind === 'use' && l.at > seen).length; };",
    "  const own = Object.entries(codex).filter(([, r]) => !r.room).sort(([, a], [, b]) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));",
    "      lastAt: [o2.lastAt, s.lastAt].filter(Boolean).sort().pop()!, monsterId: m.dst.id,",
    "      const fin = qs.filter(q => q.status !== 'active').sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || ''))).slice(0, 3);",
  ];
  expect(old.map(t => asText.test(t)), 'the rule sees each old comparison').toEqual([true, true, true, true]);
  const hits = (await sourceLines('src')).filter(l => !l.file.startsWith('src/core/combat/') && !isComment(l.text) && asText.test(l.text));
  expect(report(hits), 'compare two stored times with compareTimes (src/core/day.ts)').toEqual([]);
});

test('a type name is exported by one module, unless this list names both with what each is', async () => {
  // Two modules exported `StatusKey` (a status's key, and a built-in's key) and two `SheetKey` (a room's key for a
  // hunter's sheet, and a number of a sheet), and two `Rank` and two `Random` stood for one thing kept twice (audit
  // row 88 and the sweep). A name now means one thing: two things have two names, and one thing is exported once.
  const lines = [...await sourceLines('src/core'), ...await sourceLines('src/edge')];
  const exported = lines.flatMap(l => { const m = /^export type ([A-Z]\w*)\b/.exec(l.text); return m ? [{ name: m[1]!, file: l.file }] : []; });
  expect(exported.length, 'the exported types are found').toBeGreaterThan(200);
  /** Names two modules export for two different things, with what each is. Empty: each such pair was renamed for what it is (notes-leftovers.md row 9). */
  const twoThings: Record<string, string> = {};
  const filesOf = (es: { name: string; file: string }[]): Map<string, string[]> => {
    const m = new Map<string, string[]>();
    for (const e of es) m.set(e.name, [...(m.get(e.name) ?? []), e.file]);
    return m;
  };
  const twiceIn = (es: { name: string; file: string }[]): string[] =>
    [...filesOf(es)].filter(([name, files]) => files.length > 1 && !(name in twoThings)).map(([name, files]) => `${name}: ${files.join(', ')}`);
  const old = [{ name: 'StatusKey', file: 'src/core/combat/effect-ops.ts' }, { name: 'StatusKey', file: 'src/core/registry/statuses.ts' }];
  expect(twiceIn(old), 'the rule sees the old pair').toEqual(['StatusKey: src/core/combat/effect-ops.ts, src/core/registry/statuses.ts']);
  const byName = filesOf(exported);
  expect(twiceIn(exported), 'give one of them another name, or import the one type from where it is defined').toEqual([]);
  const stale = Object.keys(twoThings).filter(name => (byName.get(name)?.length ?? 0) < 2);
  expect(stale, 'a name the list keeps that only one module exports now: take it off the list').toEqual([]);
});

test('a picker carries a hunter by its id or sheet key, never by a prefixed string it cuts off again', async () => {
  // Implicit audit row 57: the Job Change picker, the skill giver and the GM's fight select wrote 'l:' or 'r:' before an
  // id and sliced it off again, three readings of one fact. src/core/party.ts `pickables` lists the hunters with the id a
  // control carries (a hunter id or a sheet key, which never look alike), and `pickedRef` reads a control back.
  const prefixed = /(['"`])[rl]:\1\s*\+|`[rl]:\$\{|startsWith\(\s*['"][rl]:['"]\s*\)/;
  const old = ["value: 'r:' + r.key", 'pair(`l:${h.id}`, h.name)', "if (v.startsWith('r:')) { remote.push(v.slice(2)); continue; }"];
  expect(old.map(t => prefixed.test(t)), 'the rule sees the old prefixes').toEqual([true, true, true]);
  const hits = (await sourceLines('src/views')).filter(line => !isComment(line.text) && prefixed.test(line.text));
  expect(report(hits), 'list the hunters with pickables (src/core/party.ts) and read a control back with pickedRef').toEqual([]);
});

test('a view reads a player\'s sheet as the room\'s parser left it: no default or cut of its own on its name', async () => {
  // Implicit audit 2, N8: a player's sheet is parsed at the boundary as a Hunter (a name of 1 to 60 characters), yet
  // eleven reads guarded it again with their own default and cut, so one player was "Hunter" on one screen and "Player"
  // on another. A view reads `r.data.name`; a key with no sheet at all is party.ts `sheetName`, with its words.
  const guard = /\bdata\.name\)?\s*(\|\||\?\?)/;
  const old = ["n: String(r.data.name ?? 'Hunter').slice(0, 60)", "name: String(r.data.name || 'Hunter').slice(0, 40)", "return String((r && r.data.name) || 'hunter').slice(0, 60);"];
  expect(old.map(t => guard.test(t)), 'the rule sees the old guards').toEqual([true, true, true]);
  const hits = [...await sourceLines('src/views'), ...await sourceLines('src/edge')].filter(line => !isComment(line.text) && guard.test(line.text));
  expect(report(hits), 'read the parsed sheet\'s name as it is (src/core/protocol.ts parseSheet); a key with no sheet is party.ts sheetName').toEqual([]);
});

test('a step\'s day is day.ts stepTime: no view or edge module works out a day key from the reset hour itself', async () => {
  // Implicit audit 2, N13: "now, and today's day key at the save's reset hour" was written four times in views and the
  // link, each with a `|| 0` the save's repair already holds, so a fifth copy that differed would date a step another day.
  const own = /\bdayKey\(/;
  expect(own.test("today: dayKey(now, store.get().settings.dailyResetHour || 0), R: rules()"), 'the rule sees the old copies').toBe(true);
  const lines = [...await sourceLines('src/views'), ...await sourceLines('src/edge')];
  const hits = lines.filter(line => !isComment(line.text) && own.test(line.text));
  expect(report(hits), 'date a step with stepTime(save, now) from src/core/day.ts').toEqual([]);
});

test('"no job" is null: nothing compares a hunter\'s job with a word', async () => {
  // Implicit audit 3, H9: "no job" was the string 'None', compared in three views and the roster, so a job a GM typed as
  // "None" read as none and a rename of the default would show on every sheet. save.ts `jobOf` reads a job; null is none.
  const word = /\bjob\s*[!=]==?\s*['"]None['"]/;
  expect(word.test("[h.job !== 'None' ? h.job : '', t ? t.name : '']"), 'the rule sees the old compare').toBe(true);
  const hits = (await sourceLines('src')).filter(line => !isComment(line.text) && word.test(line.text));
  expect(report(hits), 'a hunter with no job holds null (save.ts jobOf); show the job when it is not null').toEqual([]);
});

test('no placeholder words are left marked', async () => {
  // Units left their words as placeholders marked TODO(copy), about 200 of them, and the wording pass read each once
  // against one glossary and voice (docs/agent-handoff/copy-tasks.md). A marked line ships words nobody has read. Write
  // the final words now, by that file's voice and glossary; a question for the owner goes in docs/agent-handoff/for-the-owner.md.
  const mark = /TODO\(copy\)/;
  expect(mark.test("      if (!sent.ok) ui.toast('Warning', 'Not sent.'); // TODO(copy): a skill given while this phone is in no room"), 'the rule sees a marked line').toBe(true);
  const text = /\.(ts|js|html|css|json|webmanifest|svg|txt)$/;
  const files = [...(await readdir(`${ROOT}/src`, { recursive: true })).map(n => `src/${n}`), ...(await readdir(`${ROOT}/public`, { recursive: true })).map(n => `public/${n}`), 'server.ts']
    .filter(f => text.test(f)).sort();
  const hits: Line[] = [];
  for (const file of files) (await Bun.file(`${ROOT}/${file}`).text()).split('\n').forEach((t, i) => { if (mark.test(t)) hits.push({ file, line: i + 1, text: t }); });
  expect(files.length, 'the rule reads the app\'s files').toBeGreaterThan(50);
  expect(report(hits), 'write the final words by the voice and the glossary in docs/agent-handoff/copy-tasks.md, and delete the mark').toEqual([]);
});

test('only chronicle.ts\'s record writes a hunter\'s inbox of facts, and only the notice step empties it', async () => {
  // A fact is recorded by the one function that does its thing, in that thing's write, and taken by the store's notice
  // step in the same write (docs/agent-handoff/features/notes-1-feats.md 4.1). A second writer of the inbox would record
  // a fact twice or drop one; a second reader would count one twice. Record a fact with `record(h, fact)`.
  const write = /\binbox\s*(:|[-+]?=(?!=))|\.inbox\.(push|splice|pop|shift|length\s*=)/;
  expect(write.test("return { ...h, chronicle: { ...h.chronicle, inbox: [...h.chronicle.inbox, f] } };"), 'the rule sees an inbox written').toBe(true);
  expect(write.test("if (!h.chronicle.inbox.length || c.held(save, h.id)) return h;"), 'and not one read').toBe(false);
  const owners = ['src/core/hunter/chronicle.ts', 'src/core/hunter/noticed.ts'];
  const hits = (await sourceLines('src')).filter(line => !owners.includes(line.file) && !isComment(line.text) && write.test(line.text));
  expect(report(hits), 'record a fact with chronicle.ts `record`; the store\'s `noticed` takes it').toEqual([]);
});

test('only src/core/hunter/crystal.ts writes a hunter\'s mana crystal balance', async () => {
  // Single writer for Hunter.crystal (economy unit 3): every live balance change goes through crystal.ts (`addCrystal`,
  // `setCrystal`, `sellCrystal`). hunter.ts holds the default (`newHunter`) and boundary repair (`fixHunter`).
  const owners = ['src/core/hunter/crystal.ts', 'src/core/hunter/hunter.ts'];
  const write = /\bh\.crystal\s*[-+]?=(?!=)|\{\s*\.\.\.(?:h|x|hunter)\b[^}]*\bcrystal\s*:/;
  expect(write.test('h.crystal = 50;'), 'the rule sees a direct write on h.crystal').toBe(true);
  expect(write.test('return { ...h, crystal: h.crystal + 10 };'), 'the rule sees a spread write on h.crystal').toBe(true);
  expect(write.test('if (h.crystal > 0) return h.crystal;'), 'and ignores reads').toBe(false);
  const hits = (await sourceLines('src')).filter(line => !owners.includes(line.file) && !isComment(line.text) && write.test(line.text));
  expect(report(hits), 'change a hunter\'s mana crystal only through src/core/hunter/crystal.ts (addCrystal, setCrystal, sellCrystal)').toEqual([]);
});

test('only src/core/hunter/guild.ts writes a hunter\'s guild membership', async () => {
  // Single writer for Hunter.guild (economy unit 4): every live membership change goes through guild.ts (`setGuild`,
  // `guildStep`). hunter.ts holds the default (`newHunter`) and boundary repair (`fixHunter`).
  const owners = ['src/core/hunter/guild.ts', 'src/core/hunter/hunter.ts'];
  const write = /\bh\.guild\s*=(?!=)|\{\s*\.\.\.(?:h|x|hunter)\b[^}]*\bguild\s*:/;
  expect(write.test('h.guild = null;'), 'the rule sees a direct write on h.guild').toBe(true);
  expect(write.test('return { ...h, guild: null };'), 'the rule sees a spread write on h.guild').toBe(true);
  expect(write.test('if (h.guild) return h.guild.archetype;'), 'and ignores reads').toBe(false);
  const hits = (await sourceLines('src')).filter(line => !owners.includes(line.file) && !isComment(line.text) && write.test(line.text));
  expect(report(hits), 'change a hunter\'s guild only through src/core/hunter/guild.ts (setGuild, guildStep)').toEqual([]);
});

test('only src/core/story/run.ts writes a story run', async () => {
  // A story moves only when the GM taps (notes-1-stories.md 3.4): its run on the GM's save has one writer, the machine's
  // `storyMove` in run.ts, so no notice step, quest, timer, room message or view can move it. save.ts holds the field's
  // type, its default and its repair. Move a story with a tap in src/views/stories.js, through `storyMove`.
  const owners = ['src/core/story/run.ts', 'src/core/save.ts'];
  const write = /\bstoryRuns\s*(:|=(?!=))|\.storyRuns\.(push|splice|pop|shift|unshift|length\s*=)/;
  expect(write.test('return { ...save, storyRuns: [...save.storyRuns, run] };'), 'the rule sees a run written by spread').toBe(true);
  expect(write.test("const live = save.storyRuns.filter(r => r.state.at === 'running');"), 'and not one read').toBe(false);
  const hits = (await sourceLines('src')).filter(line => !owners.includes(line.file) && !isComment(line.text) && write.test(line.text));
  expect(report(hits), 'a run changes only through storyMove in src/core/story/run.ts, called from a tap in src/views/stories.js').toEqual([]);
});

test('a story moves only from src/views/stories.js', async () => {
  // Every event of a story's machine is a tap of the GM's (notes-1-stories.md 3.4): its step is named only where it is
  // written (run.ts) and where a tap calls it (stories.js), so the store, the room's appliers, the quests, the feats, the
  // gates and the one timer cannot move a story, since none of them can reach its step.
  const owners = ['src/core/story/run.ts', 'src/views/stories.js'];
  const names = /\b(storyMove|runStep)\b/;
  const hits = (await sourceLines('src')).filter(line => !owners.includes(line.file) && !isComment(line.text) && names.test(line.text));
  expect(report(hits), 'a story moves only on the GM\'s tap: call storyMove from a button of src/views/stories.js').toEqual([]);
});

test('a doc comment sits over what it describes', async () => {
  // About fifteen doc comments in src/core sat over another doc comment, left behind when a declaration moved or a new one
  // was put between a comment and its own (notes-1-feats.md 17.10). An editor shows such a comment on nothing, and a reader
  // takes it for the next declaration's. A doc comment is followed by its declaration, never by another doc comment. A
  // JSDoc `@typedef` block is a declaration itself and describes nothing under it, so a run of them is fine.
  const stacked = /\/\*\*(?:[^*]|\*(?!\/))*\*\/(?=\s*\/\*\*)/g;
  expect('/** One. */\n\n/** Two. */\nconst two = 2;'.match(stacked), 'the rule sees a doc comment over another').toEqual(['/** One. */']);
  expect('/** One. */\nconst one = 1;\n/** Two. */\nconst two = 2;'.match(stacked), 'and not two over their own').toBeNull();
  expect('/** One. */\nconst one = /** @type {number} */ (1);\n/** Two. */\nconst two = 2;'.match(stacked), 'nor a cast before a doc comment that has its own').toBeNull();
  const describes = (block: string) => !/@typedef\b/.test(block);
  expect(['/** @typedef {number} N */', '/**\n * A count.\n * @typedef {number} N\n */', '/** One. */'].map(describes), 'a typedef block describes nothing under it').toEqual([false, false, true]);
  const files = [...(await readdir(`${ROOT}/src`, { recursive: true })).map(n => `src/${n}`), 'server.ts'].filter(f => /\.(ts|js)$/.test(f)).sort();
  const hits: Line[] = [];
  for (const file of files) {
    const text = await Bun.file(`${ROOT}/${file}`).text();
    for (const m of text.matchAll(stacked)) if (describes(m[0])) hits.push({ file, line: text.slice(0, m.index).split('\n').length, text: m[0].split('\n')[0]! });
  }
  expect(files.length, 'the rule reads the app\'s files').toBeGreaterThan(50);
  expect(report(hits), 'this doc comment describes nothing: the next thing under it is another doc comment. Read the declarations near it, move it to sit right over the one it describes, and change no code').toEqual([]);
});

test('AGENTS.md is an index of at most 150 lines that names every file of docs/guide/ and only files that exist', async () => {
  const text = await Bun.file(`${ROOT}/AGENTS.md`).text();
  const lines = text.replace(/\n$/, '').split('\n').length;
  const named = [...new Set([...text.matchAll(/docs\/guide\/[a-z-]+\.md/g)].map(m => m[0]))];
  const files = (await readdir(`${ROOT}/docs/guide`)).filter(name => name.endsWith('.md')).map(name => `docs/guide/${name}`);
  const missing = named.filter(path => !files.includes(path));
  const unnamed = files.filter(path => !named.includes(path));
  expect(lines, 'AGENTS.md is loaded into every session. Move the long part into the docs/guide file of its area and leave one line for it in "Where to look".').toBeLessThanOrEqual(150);
  expect(missing, 'AGENTS.md names a guide file that does not exist. Fix the path or add the file.').toEqual([]);
  expect(unnamed, 'a guide file is not named in AGENTS.md "Where to look". Add one line that names it and says what is in it.').toEqual([]);
});

test('no test opens a file under docs/agent-handoff/', async () => {
  // A push of only the lead's notes runs the typecheck and no unit test (`planOf`, scripts/ci-plan.ts). That holds only
  // while no test can read a note: here, no file of tests/ or scripts/ nor server.ts names the folder outside a comment,
  // and none lists docs/ as a whole, except `tests/qd-rows.test.ts` reading `docs/agent-handoff/questionable-decisions.md`
  // (excluded from `isNotes` in scripts/ci-plan.ts so edits to it run unit tests). src/ is left out: core touches no file
  // and the views run in a browser. To read another note from a test, move what the test needs into docs/guide/ or
  // tests/fixtures/, or take it out of `isNotes` in `planOf`.
  const NAMES_IT: Readonly<Record<string, string>> = {
    'scripts/ci-plan.ts': 'tells a push of notes by its paths; it opens nothing',
    'tests/ci-plan.test.ts': 'gives the plan paths as text; it opens nothing',
    'tests/lint.test.ts': 'this rule, and a message that tells a person where the glossary is',
  };
  const lines = [...await sourceLines('scripts'), ...await sourceLines('tests')];
  (await Bun.file(`${ROOT}/server.ts`).text()).split('\n').forEach((text, i) => lines.push({ file: 'server.ts', line: i + 1, text }));
  const code = lines.filter(line => !isComment(line.text));
  const names = (text: string) => /agent-handoff/.test(text);
  const opens = (text: string) => /\b(Bun\.file|readFile\w*|readdir\w*|import|require|fetch|open\w*|createReadStream)\s*\(|\bfrom\s+['"]/.test(text);
  const wholeDocs = (text: string) => /readdir\w*\([^)]*\bdocs\/?['"`]/.test(text);
  const readsQd = (line: Line) => line.file === 'tests/qd-rows.test.ts' && /docs\/agent-handoff\/questionable-decisions\.md/.test(line.text) && !wholeDocs(line.text);
  expect(opens("const t = await Bun.file(`${ROOT}/docs/agent-handoff/handoff.md`).text();") && names('docs/agent-handoff/handoff.md'), 'the rule sees a read').toBe(true);
  expect(wholeDocs("await readdir(`${ROOT}/docs`, { recursive: true })"), 'the rule sees docs/ listed whole').toBe(true);
  expect(wholeDocs("await readdir(`${ROOT}/docs/guide`)"), 'the rule lets a named folder of docs/ be listed').toBe(false);
  const outside = code.filter(line => names(line.text) && !(line.file in NAMES_IT) && !readsQd(line));
  const reads = code.filter(line => line.file !== 'tests/lint.test.ts' && !readsQd(line) && ((names(line.text) && opens(line.text)) || wholeDocs(line.text)));
  expect(report(outside), 'this file names docs/agent-handoff/ outside a comment. If it opens nothing there, add it to NAMES_IT with why; if it reads a note, see the comment above').toEqual([]);
  expect(report(reads), 'a test or a script reads the notes, so a push of notes could change a test: see the comment above').toEqual([]);
});

test('a view that mounts the battle map destroys it when it takes the map\'s box off the page', async () => {
  // A map mounted in a box listens to the window's resize, the hotbar's observer and the news line, and nothing tells it
  // that the box left the page: a player's switch between list and map left a map behind each time, still listening
  // (audit BUG-views-8). The screen that mounts it keeps the map it mounted and calls its `destroy` (map-mount.ts `gone`)
  // where it replaces the box's markup.
  const lines = (await sourceLines('src/views')).filter(line => !isComment(line.text));
  const mounting = [...new Set(lines.filter(line => /\bmap\.mount\(/.test(line.text)).map(line => line.file))];
  expect(mounting.length, 'the map is mounted somewhere').toBeGreaterThan(0);
  const keeping = new Set(lines.filter(line => /\.destroy\(\)/.test(line.text)).map(line => line.file));
  expect(mounting.filter(file => !keeping.has(file)), 'call the map view\'s destroy() before replacing its box').toEqual([]);
});

test('the Gates view makes a solo fight only by soloFight: the odds a card shows and the run play the one fight', async () => {
  // A run's foes are harder than the table's by `RULES.solo.autoHarder`, which soloFight (src/core/gates/solo.ts) applies.
  // A row built or a fight added in the view would be a second builder: its odds could be of one fight and its run of another.
  const lines = (await sourceLines('src/views')).filter(line => line.file === 'src/views/gates.js' && !isComment(line.text));
  expect(lines.filter(line => /\bsoloFight\s*\(/.test(line.text)).length, 'the rule sees the card\'s soloFight and the run\'s').toBe(2);
  const built = lines.filter(line => /\b(hunterRow|monsterRows|shadowRow|remoteRow)\s*\(|(?<![.\w$])reduce\s*\(|type:\s*'add'/.test(line.text));
  expect(report(built), 'build a solo run\'s fight with soloFight in src/core/gates/solo.ts, for the odds box and for the run').toEqual([]);
});

test('a solo run\'s odds and its run are played by the rules soloFight gave its fight, never by other rules', async () => {
  // soloFight answers the fight with its rules (`made.R`: the phone's with the room's statuses laid over them). The odds
  // box once played a solo gate by the phone's own rules and the run by `made.R`: a status on a row at the start rides in
  // the fight, but one read as the fight plays (a summon's) split them on a world gate whose GM edited it. The card hands the box
  // soloFight's answer whole (`OddsApi.paintSolo`, which takes no rules), and the run plays every step by `made.R`.
  const lines = (await sourceLines('src/views')).filter(line => line.file === 'src/views/gates.js' && !isComment(line.text));
  const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length;
  const table = lines.filter(line => /\.odds\.paint\s*\(/.test(line.text));
  expect(report(table), 'give a solo gate\'s odds box soloFight\'s answer by app.api.odds.paintSolo: paint plays by the phone\'s rules').toEqual([]);
  const solo = lines.filter(line => /\.odds\.paintSolo\s*\(/.test(line.text));
  expect(solo.length, 'the rule sees the card\'s paintSolo').toBe(1);
  expect(report(solo.filter(line => !/\.odds\.paintSolo\s*\([^;]*,\s*[\w.]*\bmade\s*\)/.test(line.text))), 'hand paintSolo the card\'s soloFight answer as it came').toEqual([]);
  const plays = lines.filter(line => /\b(oddsStep|progressOf)\s*\(/.test(line.text));
  expect(plays.length, 'the rule sees the run\'s play').toBeGreaterThan(0);
  const other = plays.filter(line => count(line.text, /\b(oddsStep|progressOf)\s*\(/g) !== count(line.text, /,\s*made\.R\s*\)/g));
  expect(report(other), 'play a solo run by made.R, the rules soloFight gave its fight').toEqual([]);
});

// A rule that a fight forbids an act (the System's raise, a crystal's revive, a trade) held only by a view's own check
// is past the first time two room messages arrive in the other order: on Nov 22 the System's raise window opened, and
// Rise raised the hunter, while the GM's fight held it (public run 45072456140), because only src/views/hunter.js asked
// `fightOf` and the step `systemRaise` did not. So the step in core refuses (`held`), with its table test, and a view
// asks `fightOf` only to draw or to pick a route. Each file's count of calls is listed; a change that adds a call fails
// here until the refusal is in the step and the number is raised in the same commit, naming the step's test.
const FIGHT_ASKS: Readonly<Record<string, number>> = {
  'src/views/quests.js': 3, 'src/views/custom.js': 1, 'src/views/coin.js': 1, 'src/views/trade.js': 1, 'src/views/effects.js': 1,
  'src/views/hunter.js': 6, 'src/views/stories.js': 2, 'src/views/gates.js': 1, 'src/views/inventory.js': 2, 'src/views/gm.js': 3,
};
test('a view adds no new question of whether a fight holds a hunter: the step in core refuses, and the view only draws it', async () => {
  const counts: Record<string, number> = {};
  for (const line of await sourceLines('src/views')) {
    if (isComment(line.text)) continue;
    const n = line.text.split('fightOf(').length - 1;
    if (n) counts[line.file] = (counts[line.file] ?? 0) + n;
  }
  const over = Object.entries(counts).filter(([file, n]) => n > (FIGHT_ASKS[file] ?? 0))
    .map(([file, n]) => `${file}: ${n} calls of fightOf, ${FIGHT_ASKS[file] ?? 0} listed. If the new call allows or refuses a write, put the refusal in the core step it guards (as grant.ts systemRaise refuses 'held', tested in tests/revive-standing.test.ts) and then raise this file's number in FIGHT_ASKS.`);
  expect(over).toEqual([]);
});

// The voice rules a machine can check (docs/guide/voice.md, the owner, Nov 22: "I shouldn't have to guess", "Don't be clever").
// Each reads the words of every string and template literal in src/views, src/core, src/edge and src/app.js that reads as
// prose, never comments or code. Subtle judgment calls (clever lines, idioms, unclear labels) stay in voice.md.
type Words = { file: string; line: number; text: string; part?: number };

/** The string and template-literal text of a source file, with the line each starts on. A regex literal is skipped. */
function literalsOf(file: string, src: string): Words[] {
  const out: Words[] = [];
  let i = 0, line = 1, prev = '', word = '', depth = 0;
  const holes: number[] = []; // the brace depth at each open ${ of a template
  const step = () => { if (src[i] === '\n') line++; i++; };
  /** Reads template text from i (past the backtick or the closing brace of a hole) to the end of the template or the next hole. */
  let part = 0;
  const templateText = () => {
    const start = line, at = part++; let buf = '';
    while (i < src.length) {
      const c = src[i]!;
      if (c === '\\') { buf += src[i + 1] ?? ''; step(); step(); continue; }
      if (c === '`') { step(); part = 0; break; }
      if (c === '$' && src[i + 1] === '{') { step(); step(); holes.push(depth); depth++; break; }
      buf += c; step();
    }
    out.push({ file, line: start, text: buf, part: at });
  };
  while (i < src.length) {
    const c = src[i]!, n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') step(); continue; }
    if (c === '/' && n === '*') { step(); step(); while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) step(); step(); step(); continue; }
    if (c === '"' || c === "'") {
      const start = line; let buf = ''; step();
      while (i < src.length && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') { buf += src[i + 1] ?? ''; step(); step(); continue; } buf += src[i]; step(); }
      step(); out.push({ file, line: start, text: buf, part: holes.length ? 1 : 0 }); prev = 'x'; word = ''; continue;
    }
    if (c === '`') { step(); if (!holes.length) part = 0; templateText(); prev = 'x'; word = ''; continue; }
    if (c === '/' && (prev === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || /^(return|typeof|case|in|of|void|yield|await)$/.test(word))) {
      step(); let cls = false;
      while (i < src.length && src[i] !== '\n') { const d = src[i]; if (d === '\\') { step(); step(); continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; step(); }
      step(); prev = 'x'; word = ''; continue;
    }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (holes.length && holes[holes.length - 1] === depth) { holes.pop(); step(); templateText(); prev = 'x'; word = ''; continue; }
    }
    if (/[A-Za-z_$0-9]/.test(c)) word = /[A-Za-z_$0-9]/.test(prev) ? word + c : c;
    if (!/\s/.test(c)) prev = c;
    step();
  }
  return out;
}

const looksLikeProse = (t: string): boolean => {
  const s = t.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;|&#\d+;/g, ' ').trim();
  if (!/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(s)) return false;
  if (/[{}]|(^|[\s;])[a-z-]+:\s*[^\s;]+;/.test(s)) return false; // a style sheet or a style attribute
  if (/=>|\bfunction\b|\bconst\b|\breturn\b|===/.test(s)) return false; // code inside a string
  return true;
};

/**
 * String and template literals of a source file with each template's static parts joined across `${...}` holes.
 * A hole after a word stem (`fight${s}`) attaches with no space, a hole before `-` (`${n}-day`) puts `2`, and any other
 * hole puts ` 2 `, so multi-word rules see the full clause while nested quoted strings inside holes are still emitted.
 * Templates starting with a console tag (`[sync]`, `[server]`) are skipped along with strings nested inside them.
 */
function joinedLiteralsOf(file: string, src: string): Words[] {
  const out: Words[] = [];
  let i = 0, line = 1, prev = '', word = '', depth = 0;
  const holes: { depth: number; start: number; buf: string; tagged: boolean }[] = [];
  const step = () => { if (src[i] === '\n') line++; i++; };
  const templateChunk = (tpl: { depth: number; start: number; buf: string; tagged: boolean }, isFirst: boolean) => {
    let buf = '', ended = false;
    while (i < src.length) {
      const c = src[i]!;
      if (c === '\\') { buf += src[i + 1] ?? ''; step(); step(); continue; }
      if (c === '`') { step(); ended = true; break; }
      if (c === '$' && src[i + 1] === '{') { step(); step(); break; }
      buf += c; step();
    }
    if (isFirst) tpl.tagged = /^\[\w+\]/.test(buf);
    if (!isFirst && tpl.buf.length > 0) {
      if (/[A-Za-z]$/.test(tpl.buf)) tpl.buf += '';
      else if (/^-/.test(buf)) tpl.buf += '2';
      else tpl.buf += ' 2 ';
    }
    tpl.buf += buf;
    if (ended) {
      if (!tpl.tagged) out.push({ file, line: tpl.start, text: tpl.buf, part: holes.length ? 1 : 0 });
    } else {
      holes.push(tpl);
      depth++;
    }
  };
  while (i < src.length) {
    const c = src[i]!, n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') step(); continue; }
    if (c === '/' && n === '*') { step(); step(); while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) step(); step(); step(); continue; }
    if (c === '"' || c === "'") {
      const start = line; let buf = ''; step();
      while (i < src.length && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') { buf += src[i + 1] ?? ''; step(); step(); continue; } buf += src[i]; step(); }
      step();
      if (!holes.length || !holes[holes.length - 1]!.tagged) out.push({ file, line: start, text: buf, part: holes.length ? 1 : 0 });
      prev = 'x'; word = ''; continue;
    }
    if (c === '`') { step(); templateChunk({ depth, start: line, buf: '', tagged: false }, true); prev = 'x'; word = ''; continue; }
    if (c === '/' && (prev === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || /^(return|typeof|case|in|of|void|yield|await)$/.test(word))) {
      step(); let cls = false;
      while (i < src.length && src[i] !== '\n') { const d = src[i]; if (d === '\\') { step(); step(); continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; step(); }
      step(); prev = 'x'; word = ''; continue;
    }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (holes.length && holes[holes.length - 1]!.depth === depth) {
        const tpl = holes.pop()!; step(); templateChunk(tpl, false); prev = 'x'; word = ''; continue;
      }
    }
    if (/[A-Za-z_$0-9]/.test(c)) word = /[A-Za-z_$0-9]/.test(prev) ? word + c : c;
    if (!/\s/.test(c)) prev = c;
    step();
  }
  return out;
}

async function proseLiterals(): Promise<Words[]> {
  const files = [
    ...(await readdir(`${ROOT}/src`, { recursive: true })).filter(n => /^(views|core|edge)\/.*\.(ts|js)$/.test(n) && !n.endsWith('.d.ts')),
    'app.js',
  ].sort();
  const all: Words[] = [];
  for (const name of files) {
    const src = await Bun.file(`${ROOT}/src/${name}`).text();
    for (const w of joinedLiteralsOf(`src/${name}`, src)) {
      const text = w.text.replace(/&mdash;|&#8212;/g, '\u2014').replace(/&ndash;/g, '\u2013').replace(/&[a-z]+;|&#\d+;/g, ' ');
      for (const m of text.matchAll(/[^<>]+/g)) {
        const piece = m[0];
        if (looksLikeProse(piece)) {
          const pieceLine = w.line + text.slice(0, m.index).split('\n').length - 1;
          all.push({ ...w, line: pieceLine, text: piece.replace(/\s+/g, ' ').trim() });
        }
      }
    }
  }
  return all;
}
const said = (hits: Words[]) => hits.map(h => `${h.file}:${h.line}: ${h.text.slice(0, 120)}`);

test('the literal reader of the voice rules finds strings and template text, and skips comments and regexes', () => {
  const found = literalsOf('x.ts', "// a comment — here\nconst a = 'One two';\nconst r = /a;b/;\nconst t = `Hi ${n ? 'Big one' : 'x'} there friend`;\n");
  expect(found.map(f => f.text)).toEqual(['One two', 'Hi ', 'Big one', 'x', ' there friend']);
  const joined = joinedLiteralsOf(
    'x.ts',
    "const a = `You have ${n} offers waiting.`;\nconst b = `Loot from ${n} more fight${n === 1 ? '' : 's'} is waiting.`;\nconst c = `every ${n}-day streak gives`;\nconst d = `Hi ${n ? 'This tab shows it' : 'x'} friend`;\nconst e = `[sync] ${x} holds it`;\n",
  );
  expect(joined.map(f => f.text.replace(/\s+/g, ' ').trim())).toEqual([
    'You have 2 offers waiting.',
    '',
    's',
    'Loot from 2 more fight is waiting.',
    'every 2-day streak gives',
    'This tab shows it',
    'x',
    'Hi 2 friend',
  ]);
});

test('no em dash in a player- or GM-facing string (voice.md: use a period, comma, colon or parentheses)', async () => {
  const hits = (await proseLiterals()).filter(w => /\u2014|\s\u2013\s|\s--\s/.test(w.text));
  expect(said(hits), 'write a period, comma, colon or parentheses; a range is "1 to 10"').toEqual([]);
});

test('no semicolon joins two clauses in a player- or GM-facing string (voice.md: write two sentences)', async () => {
  const hits = (await proseLiterals()).filter(w => /[A-Za-z0-9)"'.]\s*;\s+[A-Za-z]/.test(w.text));
  expect(said(hits), 'split the clauses into two sentences').toEqual([]);
});

test('no "just" in a player- or GM-facing string (voice.md: filler)', async () => {
  const hits = (await proseLiterals()).filter(w => /\bjust\b/i.test(w.text));
  expect(said(hits), 'cut "just", or say the exact thing ("right before", "only")').toEqual([]);
});

const BRITISH = /\b(colou?r(?<=colour)\w*|centre\w*|defence\w*|armour\w*|harbour\w*|honour\w*|favour\w*|behaviour\w*|cancell(ed|ing)|travell(ed|ing)|levell(ed|ing)|labell(ed|ing)|modell(ed|ing)|realis(e|ed|es|ing)|recognis(e|ed|es|ing)|organis(e|ed|es|ing)|apologis(e|ed|es|ing)|analys(e|ed|es|ing)|grey\w*|catalogue\w*|licence|offence|metre\w*|theatre|labour\w*|rumour\w*|valour|splendour|armoury|judgement\w*|programme\w*|whilst|amongst|learnt|spelt|dreamt|fulfil|enrol|vigour|rigour|odour|saviour|neighbour\w*|flavour\w*|humour\w*|mould\w*|plough\w*|sceptic\w*|tyres?|jewellery|marvellous|practis(e|ed|es|ing))\b/i;
test('a player- or GM-facing string uses American spelling (voice.md: color, center, defense, armor, canceled)', async () => {
  const hits = (await proseLiterals()).filter(w => BRITISH.test(w.text));
  expect(said(hits), 'spell it the American way').toEqual([]);
});

// Modeled on tbhb/vale-ai-tells BareHolds: determiner, up to two non-function modifiers, non-person noun,
// optional modal/auxiliary/adverb (up to two), then one of holds, waits, gives, keeps, shows, wants, knows, decides,
// or remembers (uninflected, -s, or -ing). Duration "takes" is outside this nine-verb list.
const PERSONIFY_DET = String.raw`(?:the|a|an|this|that|these|those|your|its|their|our|my|his|her|each|every|any|no|some|all|both|many|more|most|few|several|other|another|\d+)`;
const PERSONIFY_STOP = String.raw`(?:the|a|an|this|that|these|those|your|its|their|our|my|his|her|each|every|any|no|some|all|both|and|or|but|if|to|of|for|from|in|on|at|by|with|without|as|into|onto|about|after|before|until|while|when|where|who|whom|whose|which|you|they|we|he|she|it|them|us|him|me|not|never|still|only|also|can|cannot|will|would|may|might|must|should|does|do|did|is|are|was|were|be|been|being|has|have|had)`;
const PERSONIFY_MOD = String.raw`(?!${PERSONIFY_STOP}\b)[A-Za-z0-9][A-Za-z0-9'-]*`;
const PERSONIFY_NOUN = String.raw`(?!${PERSONIFY_STOP}\b)[A-Za-z][A-Za-z0-9'-]*`;
const PERSONIFY_AUX = String.raw`(?:(?:can|cannot|can't|will|won't|would|may|might|must|should|does|doesn't|do|don't|did|didn't|is|are|was|were|has|have|had|stopped|only|also|still|never|always|not)\s+){0,2}`;
const PERSONIFY_VERB = String.raw`(?:holds?|holding|waits?|waiting|gives?|giving|keeps?|keeping|shows?|showing|wants?|wanting|knows?|knowing|decides?|deciding|remembers?|remembering)`;
const PERSONIFY = new RegExp(String.raw`\b(${PERSONIFY_DET})\s+(?:(${PERSONIFY_MOD})\s+){0,2}(${PERSONIFY_NOUN})\s+${PERSONIFY_AUX}(${PERSONIFY_VERB})\b`, 'gi');
/** People and living combatants who can act, want, decide, or keep things. */
const PERSONIFY_PERSON = /^(?:you|gm|player|players|hunter|hunters|foe|foes|monster|monsters|ally|allies|enemy|enemies|target|targets|bearer|bearers|combatant|combatants|fighter|fighters|user|users|caster|casters|boss|bosses|shadow|shadows|anyone|everyone|someone|nobody|person|people|stranger|listener|party|team|survivors)$/i;
type PersonifyAllow = { readonly re: RegExp; readonly why: string };
/** Short commented allowlist for in-world SYSTEM flavor, reward "gives", and proper-noun title names. */
const PERSONIFY_ALLOW: readonly PersonifyAllow[] = [
  { re: /^THE SYSTEM\b/, why: 'In-world SYSTEM window titles in bundles.ts.' },
  { re: /^THE STORY HOLDS$/, why: 'In-world SYSTEM window title idiom for a roleplay lie award.' },
  { re: /^THE HOUSE KEEPS$/, why: 'In-world SYSTEM window title gambling idiom in stories.ts.' },
  { re: /^The next gate will not wait$/, why: 'In-world System whisper roll table entry in gm.js.' },
  { re: /^(?:each|every)\s+(?:[A-Za-z0-9'-]+\s+){0,2}(?:level|hit|move|streak)\s+gives$/i, why: 'Reward or mechanic "gives" for levels, hits, moves, and streaks.' },
  { re: /\b(?:Clearing|Running|Completing|Doubling)\b[^.,!?]*\bgives$/, why: 'Gerund action subject stating a game payout.' },
  { re: /\bA fight outside a gate gives$/, why: 'Game reward payout rule for fights outside a gate.' },
  { re: /\bthe title Knows Its Name\b/, why: 'Proper-noun title name "Knows Its Name", not a verb for "title".' },
];

/** Clause from the preceding sentence or comma boundary through the matched phrase. */
function personifyClause(text: string, index: number, match: string): string {
  const before = text.slice(0, index);
  const start = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'), before.lastIndexOf(',')) + 1;
  return text.slice(start, index + match.length).trim();
}

function personifyHits(text: string): { match: string; allowedBy: PersonifyAllow | null }[] {
  const out: { match: string; allowedBy: PersonifyAllow | null }[] = [];
  for (const m of text.matchAll(PERSONIFY)) {
    if (PERSONIFY_PERSON.test(m[3]!)) continue;
    const match = m[0];
    const clause = personifyClause(text, m.index!, match);
    const tail = text.slice(m.index!).split(/[.!?]/)[0]!;
    const sentence = clause + tail.slice(match.length);
    const allowedBy = PERSONIFY_ALLOW.find(a => a.re.test(match) || a.re.test(clause) || a.re.test(sentence)) ?? null;
    out.push({ match, allowedBy });
  }
  return out;
}

test('no UI element or object is personified in a player- or GM-facing string (voice.md: name the person who acts)', async () => {
  const bad = [
    'Your library can hold at most 50 statuses.',
    'You have 10 offers waiting. Take one back first.',
    'Loot from 2 more fights is waiting after this.',
    'Too many messages are waiting for the room server, so the oldest message was dropped.',
    'This tab shows it but cannot change it.',
    'Each level gives 5 points. Your library can hold at most 50 items.',
  ];
  for (const s of bad) expect(personifyHits(s).filter(h => !h.allowedBy).length, `the rule catches: ${s}`).toBeGreaterThan(0);
  const fine = [
    'Waiting for the GM to confirm your last solo run of this gate.',
    'Cleared. Waiting for the room server.',
    'The GM decides how it plays.',
    'Each level gives 5 ability points.',
    'A quick action takes 70% of a standard action.',
  ];
  for (const s of fine) expect(personifyHits(s).filter(h => !h.allowedBy), `the rule passes: ${s}`).toEqual([]);

  const all = await proseLiterals();
  const seen = new Set<PersonifyAllow>();
  const hits: Words[] = [];
  for (const w of all) {
    for (const h of personifyHits(w.text)) {
      if (h.allowedBy) seen.add(h.allowedBy);
      else hits.push({ ...w, text: `${h.match} | ${w.text}` });
    }
  }
  const stale = PERSONIFY_ALLOW.filter(a => !seen.has(a)).map(a => a.why);
  expect(stale, 'remove allowlist entries that no longer match any string').toEqual([]);
  expect(said(hits), 'rewrite so a person, the GM, the player, or "you" acts (docs/guide/voice.md)').toEqual([]);
});

test('every test in tests/fight-sim.test.ts uses simTest with deterministic work budget and wide wall hang guard', async () => {
  // Wall time, process.cpuUsage(), and calling-thread user CPU (even with a Worker canary) all inflate
  // unpredictably on shared hosts under concurrent load (up to 19x). sim-budget.ts enforces deterministic
  // work counts (fights, steps, maxFightSteps) that cannot false-fail from the host, while keeping
  // WALL_TIMEOUT_MS >= 600_000 as a hang guard for true infinite loops.
  const usesProcessWide = (src: string) => /\bprocess\.cpuUsage\s*\(/.test(src);
  const usesWorkerCanary = (src: string) => /\bnode:worker_threads\b|\bnew\s+Worker\s*\(/.test(src);
  const assertsClock = (src: string) => /\bexpect\s*\([^)]*(?:wallMs|threadUserMs|threadSystemMs|effectiveUserMs|cpuMs)\b/.test(src);
  expect(usesProcessWide('const cpu = process.cpuUsage(cpu0);'), 'the rule catches process-wide cpuUsage').toBe(true);
  expect(usesWorkerCanary("import { Worker } from 'node:worker_threads';"), 'the rule catches re-introducing a Worker canary').toBe(true);
  expect(assertsClock('expect(t.threadUserMs).toBeLessThanOrEqual(cpuBudgetMs);'), 'the rule catches clock-based budget assertions').toBe(true);

  const budgetSrc = await Bun.file(`${ROOT}/tests/models/sim-budget.ts`).text();
  const wallMatch = /export const WALL_TIMEOUT_MS\s*=\s*([0-9_]+)\s*;/.exec(budgetSrc);
  expect(wallMatch, 'define export const WALL_TIMEOUT_MS in tests/models/sim-budget.ts').not.toBeNull();
  const wallMs = Number(wallMatch![1]!.replace(/_/g, ''));
  expect(wallMs, 'keep WALL_TIMEOUT_MS at least 600_000 ms so host pauses do not abort healthy rows').toBeGreaterThanOrEqual(600_000);
  expect(budgetSrc, 'define DEFAULT_WORK_BUDGET in tests/models/sim-budget.ts').toContain('export const DEFAULT_WORK_BUDGET');
  expect(budgetSrc, 'assert fights, steps, and maxFightSteps in tests/models/sim-budget.ts').toContain('expect(work.maxFightSteps');
  const budgetCode = budgetSrc.split('\n').filter(l => !isComment(l)).join('\n');
  expect(usesProcessWide(budgetCode), 'never call process.cpuUsage() in tests/models/sim-budget.ts').toBe(false);
  expect(usesWorkerCanary(budgetCode), 'do not spin up a Worker canary in tests/models/sim-budget.ts').toBe(false);
  expect(assertsClock(budgetCode), 'never fail a row on wall or CPU clock time in tests/models/sim-budget.ts').toBe(false);

  const modelSrc = await Bun.file(`${ROOT}/tests/models/fight-sim.ts`).text();
  expect(modelSrc, 'report each fight to sim-budget.ts from playFight').toContain('beginFight(');
  expect(modelSrc, 'report each playStep to sim-budget.ts from playFight').toContain('recordFightStep(');

  const simSrc = await Bun.file(`${ROOT}/tests/fight-sim.test.ts`).text();
  expect(simSrc, 'import simTest from ./models/sim-budget.ts in tests/fight-sim.test.ts').toMatch(/from\s+['"]\.\/models\/sim-budget\.ts['"]/);
  const simCode = simSrc.split('\n').filter(l => !isComment(l)).join('\n');
  expect(usesProcessWide(simCode), 'do not call process.cpuUsage() in tests/fight-sim.test.ts; use simTest from sim-budget.ts').toBe(false);
  expect(assertsClock(simCode), 'do not assert clock times in tests/fight-sim.test.ts; use simTest work budgets').toBe(false);
  const rawTests = simSrc.split('\n')
    .map((line, idx) => ({ line: idx + 1, text: line }))
    .filter(({ text: line }) => /\btest\s*\(/.test(line) && !/^\s*\/\//.test(line));
  expect(rawTests, 'call simTest(...) instead of test(...) in tests/fight-sim.test.ts so every test uses the deterministic work guard and wall timeout').toEqual([]);
});

/** Pure check backing the maker round-trip registry lint so a self-test can prove it fails on unregistered makers. */
function unregisteredMakers(
  viewFiles: ReadonlyArray<{ readonly file: string; readonly text: string }>,
  packKinds: readonly string[],
  registry: readonly MakerRegistryEntry[],
  exemptions: Readonly<Record<string, string>>,
): string[] {
  const issues: string[] = [];
  const byFile = new Map<string, MakerRegistryEntry[]>();
  for (const e of registry) {
    const list = byFile.get(e.viewFile) ?? [];
    list.push(e);
    byFile.set(e.viewFile, list);
  }
  for (const kind of packKinds) {
    if (!registry.some(e => e.packKind === kind)) issues.push(`PACK_KINDS entry "${kind}" has no row in ROUNDTRIP_REGISTRY`);
  }
  const makerFileRe = /^src\/views\/.+-(?:maker|editor)\.(?:js|ts)$/;
  const makerOpenRe = /\b(?:maker|M)\.open\s*\(/;
  const editStepRe = /\b(?:editQuest|editGate|gatePreset|writeTitle|guildStep|withBadge|saveRuleNumbers|writeTable)\s*\(/;
  for (const { file, text } of viewFiles) {
    const rows = byFile.get(file) ?? [];
    if (makerFileRe.test(file) && !rows.length) {
      issues.push(`maker/editor file ${file} has no row in ROUNDTRIP_REGISTRY`);
    }
    if (file !== 'src/views/maker.js' && makerOpenRe.test(text) && !(file in exemptions)) {
      if (!rows.some(r => r.opensMaker)) {
        issues.push(`maker.open( caller ${file} has no opensMaker row in ROUNDTRIP_REGISTRY (or MAKER_OPEN_EXEMPTIONS)`);
      }
    }
    if (editStepRe.test(text) && !rows.length) {
      issues.push(`saved-entity edit-step caller ${file} has no row in ROUNDTRIP_REGISTRY`);
    }
  }
  for (const file of Object.keys(exemptions)) {
    const found = viewFiles.find(v => v.file === file);
    if (!found || !makerOpenRe.test(found.text)) {
      issues.push(`stale MAKER_OPEN_EXEMPTIONS entry ${file}`);
    }
  }
  return issues;
}

test('every maker, editor, PACK_KINDS entry, and maker.open( caller has a row in ROUNDTRIP_REGISTRY and round-trip test coverage', async () => {
  const names = (await readdir(`${ROOT}/src/views`)).filter(n => /\.(js|ts)$/.test(n)).sort();
  const views = await Promise.all(names.map(async n => ({
    file: `src/views/${n}`,
    text: await Bun.file(`${ROOT}/src/views/${n}`).text(),
  })));

  // Self-test: prove the lint rejects a new unregistered *-maker.js file, a new unregistered maker.open( site,
  // a new unregistered M.open( site, and a new PACK_KINDS entry.
  const synthMakerFile = unregisteredMakers(
    [...views, { file: 'src/views/relic-maker.js', text: 'export function relicMaker() {}' }],
    PACK_KINDS,
    ROUNDTRIP_REGISTRY,
    MAKER_OPEN_EXEMPTIONS,
  );
  expect(synthMakerFile.some(m => m.includes('src/views/relic-maker.js')), 'lint catches a new *-maker.js file without a registry row').toBe(true);

  const synthMakerOpen = unregisteredMakers(
    [...views, { file: 'src/views/enchant.js', text: 'export function open(app) { return app.api.maker.open({ title: "New" }); }' }],
    PACK_KINDS,
    ROUNDTRIP_REGISTRY,
    MAKER_OPEN_EXEMPTIONS,
  );
  expect(synthMakerOpen.some(m => m.includes('src/views/enchant.js')), 'lint catches a new maker.open( caller without a registry row').toBe(true);

  const synthAliasOpen = unregisteredMakers(
    [...views, { file: 'src/views/runes.js', text: 'export function open(app) { const M = app.api.maker; return M.open({ title: "New" }); }' }],
    PACK_KINDS,
    ROUNDTRIP_REGISTRY,
    MAKER_OPEN_EXEMPTIONS,
  );
  expect(synthAliasOpen.some(m => m.includes('src/views/runes.js')), 'lint catches a new M.open( caller without a registry row').toBe(true);

  const synthPackKind = unregisteredMakers(
    views,
    [...PACK_KINDS, 'relics'],
    ROUNDTRIP_REGISTRY,
    MAKER_OPEN_EXEMPTIONS,
  );
  expect(synthPackKind.some(m => m.includes('relics')), 'lint catches a new PACK_KINDS entry without a registry row').toBe(true);

  // Real codebase check: zero unregistered makers or stale exemptions.
  expect(
    unregisteredMakers(views, PACK_KINDS, ROUNDTRIP_REGISTRY, MAKER_OPEN_EXEMPTIONS),
    'add the new maker or editor to tests/fixtures/maker-registry.ts and cover it in tests/maker-roundtrip.test.ts and/or tests/e2e/maker-roundtrip.e2e.ts',
  ).toEqual([]);

  // Every registered view file exists, ids are unique, and both test suites reference their registered ids.
  const ids = ROUNDTRIP_REGISTRY.map(e => e.id);
  expect(new Set(ids).size, 'ROUNDTRIP_REGISTRY ids are unique').toBe(ids.length);
  const viewSet = new Set(views.map(v => v.file));
  expect(ROUNDTRIP_REGISTRY.filter(e => !viewSet.has(e.viewFile)).map(e => e.viewFile), 'every registered viewFile exists').toEqual([]);

  const unitSrc = await Bun.file(`${ROOT}/tests/maker-roundtrip.test.ts`).text();
  const e2eSrc = await Bun.file(`${ROOT}/tests/e2e/maker-roundtrip.e2e.ts`).text();
  expect(unitSrc, 'unit round-trip suite checks UNIT_MAKER_IDS').toContain('UNIT_MAKER_IDS');
  expect(e2eSrc, 'browser round-trip suite checks E2E_MAKER_IDS').toContain('E2E_MAKER_IDS');
  for (const id of UNIT_MAKER_IDS) expect(unitSrc, `unit suite covers ${id}`).toContain(id);
  for (const id of E2E_MAKER_IDS) expect(e2eSrc, `e2e suite covers ${id}`).toContain(`'${id}'`);
});

test('no view or edge module tests a pattern against log text or .text', async () => {
  // Unit 1 (wire-codes): views and edge modules must read structured fields from core effects or state,
  // never scrape rendered log strings or display `.text` with regexes or string literals.
  const scrapes = [
    /\/(?:\\.|[^/\n])+\/[a-z]*\.test\([^)]*\.text\b/,
    /\.text\.match\s*\(/,
    /\.text\.(?:includes|startsWith|endsWith)\s*\(\s*['"`]/,
    /\.log\b[^;]*\.(?:find|findLast|some|filter)\([^)]*(?:\.test\(|\.match\(|\.(?:includes|startsWith|endsWith)\s*\(\s*['"`])/,
  ];
  const matches = (text: string) => scrapes.some(re => re.test(text));
  const bad = [
    "const line = (f.log || []).findLast(l => /is canceled\\.|will land as /.test(l.text));",
    "if (entry.text.match(/^R\\d+:/)) return;",
    "if (entry.text.includes('is canceled')) toast(entry.text);",
    "const hit = fight.log.some(l => l.text.startsWith('R1:'));",
  ];
  for (const s of bad) expect(matches(s), `the rule catches: ${s}`).toBe(true);
  const fine = [
    "for (const fx of of('omenAnswered')) toast(fx.line);",
    "if (q && !(e.title + ' ' + (e.text || '')).toLowerCase().includes(q)) return false;",
  ];
  for (const s of fine) expect(matches(s), `the rule passes: ${s}`).toBe(false);
  const lines = [...await sourceLines('src/views'), ...await sourceLines('src/edge')];
  const hits = lines.filter(l => !isComment(l.text) && matches(l.text));
  expect(report(hits), 'carry the fact as a structured field from core instead of matching patterns against log text or .text').toEqual([]);
});

test('server.ts and src/edge/sync.ts name room API errors only through API_ERRORS in src/core/protocol.ts', async () => {
  // Unit 1 (wire-codes): every room API error code lives once in src/core/protocol.ts (`API_ERRORS`, `apiError`,
  // `parseApiError`). server.ts builds room API error JSON with `apiError(...)`; sync.ts checks `parseApiError(...).code`
  // against `API_ERRORS.*.code` instead of matching English error strings.
  const serverLiteral = /\bJ\(\s*\{[^}]*\b(?:error|code)\s*:\s*['"`]/;
  const syncLiteral = /\b(?:errorOf\s*\(|data\??\.error\b|[\w$.]+\.error\s*[!=]==?\s*['"`])/;
  const badServer = [
    "if (!room) return J({ error: 'no such room' }, 404);",
    "return J({ code: 'GM_ONLY', error: 'gm only' }, 403);",
  ];
  for (const s of badServer) expect(serverLiteral.test(s), `the rule catches server.ts: ${s}`).toBe(true);
  const fineServer = [
    "if (!room) return J(apiError('noSuchRoom'), 404);",
    "if (!st) return J({ ok: false, db: database.kind, error: codeOf(e) }, 503);",
    "return J({ code, gmKey });",
  ];
  for (const s of fineServer) expect(serverLiteral.test(s), `the rule passes server.ts: ${s}`).toBe(false);

  const badSync = [
    "if (res.status === 426 && isObj(data) && data.error === 'upgrade') {",
    "if (a.status === 404 && errorOf(a) === 'no such room') return { type: 'gone', gen };",
    "if (r.status === 403 && err.error === 'not your sheet') return { type: 'notYours', gen };",
  ];
  for (const s of badSync) expect(syncLiteral.test(s), `the rule catches sync.ts: ${s}`).toBe(true);
  const fineSync = [
    "const err = parseApiError(a.data);",
    "if (a.status === 404 && err.code === API_ERRORS.noSuchRoom.code) return { type: 'gone', gen };",
  ];
  for (const s of fineSync) expect(syncLiteral.test(s), `the rule passes sync.ts: ${s}`).toBe(false);

  const sHits = (await serverLines()).filter(l => !isComment(l.text) && serverLiteral.test(l.text));
  expect(report(sHits), 'build every room API error in server.ts with apiError(...) from src/core/protocol.ts').toEqual([]);
  const syncText = await Bun.file(`${ROOT}/src/edge/sync.ts`).text();
  const yHits = syncText.split('\n').map((text, i) => ({ file: 'src/edge/sync.ts', line: i + 1, text }))
    .filter(l => !isComment(l.text) && syncLiteral.test(l.text));
  expect(report(yHits), 'parse room API errors in src/edge/sync.ts with parseApiError(...) and compare against API_ERRORS.*.code').toEqual([]);
});
