# notes: room API (s-api.mjs -> tests/server-rooms.test.ts)

5 tests added (30 -> 35 in the file; whole suite 59 pass). No browser run.

## Added
- full room read has no `exists` flag (s-api 8b, server half)
- poll of an unknown room with `?after&d` is 404 (6a/6c, server half)
- cursor past the last event: no events, sheets still returned (8 `after=999999999`)
- GM sees a polling player in presence with a timestamp; bad device id ignored (5h, server half)
- sheet PUT with no device token accepted (7 setup, old-client path)

## Already covered
- peek 200 for real and wrong code (2a, 2b, 2d server half, 8a answer shape)
- room creation code format, GM key (setup, 7 Y creation)

## Needs a browser (sync.js client code, not ported)
- 1 parseInvite: 21 text cases to a room code
- 2c/2e/2f/2g/2h check(): no console error on wrong code, 30 s cache, {ok:false} on network error or service-worker offline answer
- 3 joinRoom: notfound/badcode/net rejects leave save byte-identical; right code makes one hunter and GM sees it
- 4 conn() and pill: connecting, live, reconnecting, unreachable, Offline pill text, unsent edit reaches GM after outage
- 5 leave/rejoin: lastRoom shape, hunterId rejoin, GM rejoin without POST, gmRooms(), roster() content
- 6 gone room: poll 404 sets lastRoom gone, forgetLast, rejoin 404 adds no hunter
- 7 stale answers: a held poll for room X released after leave or join Y must not leak X sheets or doc
- 8b/8a client side: check() treats a peek 404 as not found and a full body as found
- 9 sync:status payload shape and status() values

## Mutation check
Flipped the expectation in "no exists flag" and "GM sees a polling player in presence": both failed. Restored; suite passes.
