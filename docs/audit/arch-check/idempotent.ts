// idempotent.ts: each place a room message changes this phone, and what makes a second delivery of it do nothing.
// Principle: make-operations-idempotent ("what happens if this runs twice?").
//
//   bun docs/audit/arch-check/idempotent.ts
//
// For each `app.on('sync:event', ...)` handler in src/views and each applier in src/edge/room-events.ts, prints the
// event type it takes and the guard found in its first lines: `once(` or `appliedOnce(` (the applied ring), `onTurn(`
// (a turn is one `now`), `wasApplied(`, or a record that refuses a repeat (`coinOf`, `held`). A handler with no guard
// is listed as UNGUARDED for a reader to judge: a set (arm to X) is safe twice, an add is not.

import { filesUnder, lines, report } from './lib.ts';

const GUARD = /\bonce\(|appliedOnce\(|onTurn\(|wasApplied\(|coinOf\(|\bheld\b|noChange|offersSeen|seenOnce|\.some\(f => f\.id === id\)/;
const out: { file: string; line: number; text: string; why: string }[] = [];
for (const file of [...filesUnder('src/views'), 'src/edge/sync.ts']) {
  const ls = lines(file);
  ls.forEach((t, i) => {
    if (!/app\.on\('sync:event'/.test(t)) return;
    const body = ls.slice(i, i + 12).join('\n');
    const type = body.match(/type (?:!==|===) '(\w+)'/)?.[1] ?? '?';
    const g = body.match(GUARD)?.[0];
    out.push({ file, line: i + 1, text: t.trim(), why: `${type}: ${g ? `guard ${g}` : 'UNGUARDED'}` });
  });
}
report('View handlers of room messages and their guard against a second delivery', out, 120);
// src/edge/room-events.ts: every applier is a row of APPLIERS, and applyRoomEvent lands each with appliedOnce.
const re = lines('src/edge/room-events.ts');
console.log(`\nroom-events.ts: APPLIERS table at line ${re.findIndex(l => l.startsWith('const APPLIERS')) + 1}; appliedOnce used at lines ${re.flatMap((l, i) => (/appliedOnce\(/.test(l) ? [i + 1] : [])).join(', ')}`);
