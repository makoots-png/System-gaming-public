import { expect, test } from 'bun:test';

const ROOT = import.meta.dir + '/..';
/** A Postgres that is not there: nothing listens on port 1. */
const NO_PG = 'postgres://postgres:pg@127.0.0.1:1/none';

/** Reads a stream until `done` says the text so far is enough, and answers that text. */
async function readUntil(stream: ReadableStream<Uint8Array>, done: (text: string) => boolean): Promise<string> {
  const reader = stream.getReader(), decoder = new TextDecoder();
  let text = '';
  while (!done(text)) {
    const { value, done: ended } = await reader.read();
    if (ended) break;
    text += decoder.decode(value);
  }
  reader.releaseLock();
  return text;
}

test('the server started with DATABASE_URL and no Postgres listens, says so loudly, and its health answers 503', async () => {
  // Bun's own binary, not the `bun` on the path: where that is a shell script, the kill below would end the script and leave the server.
  const child = Bun.spawn([process.execPath, `${ROOT}/server.ts`], { env: { ...process.env, DATABASE_URL: NO_PG, PORT: '0' }, stdout: 'pipe', stderr: 'pipe' });
  try {
    const [out, err] = await Promise.all([readUntil(child.stdout, t => /listening on :\d+/.test(t)), readUntil(child.stderr, t => t.includes('Trying again'))]);
    expect(err).toContain('DATABASE_URL is set and Postgres does not answer');
    expect(out).toContain('NO ROOMS: Postgres does not answer');
    const port = /listening on :(\d+)/.exec(out)![1];
    const health = await fetch(`http://localhost:${port}/api/health`);
    expect(health.status).toBe(503);
    expect(await health.json()).toMatchObject({ ok: false, db: 'postgres', error: 'ERR_POSTGRES_CONNECTION_REFUSED' });
    expect((await fetch(`http://localhost:${port}/`)).status).toBe(200);
  } finally { child.kill(); await child.exited; }
}, 60_000);
