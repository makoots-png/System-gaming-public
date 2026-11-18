// report.ts: the one way the app logs a failure that no player can act on (a bug, a browser that refuses a feature).
// A failure a player can act on is told on screen where it happened; this is for the rest. Each failure is logged once
// per place and message, with its stack, so a throw on every frame is one line and a new failure at the same place is
// another. The browser tests fail on any console warning (`device()` in tests/e2e/helpers.ts), so a report is a red test.

const seen = new Set<string>();

/** Logs `e` as a failure at `where` (a module and what it was doing), once per place and message. */
export function reported(where: string, e: unknown): void {
  const message = e instanceof Error ? e.message : String(e);
  const key = `${where}\n${message}`;
  if (seen.has(key)) return;
  seen.add(key);
  console.warn(`[${where}] ${message}`, e instanceof Error && e.stack ? `\n${e.stack}` : '');
}
