// Builds the browser app: one bundle from src/app.js, the odds' worker from src/odds-worker.ts, the service worker from
// src/sw.js, and public/ copied as is.
// The server builds in memory at start and serves the result. `bun run build` writes the same files to dist/ for a
// static host (no rooms there).

import { mkdir, readdir, rm } from 'node:fs/promises';

type Bytes = Uint8Array<ArrayBuffer>;
export type BuiltFile = { type: string; body: Bytes };
export type Built = {
  /** Names this exact app. The service worker cache carries it and the room handshake compares it. */
  build: string;
  /** Keyed by URL path, for example `/app.js`. */
  files: Map<string, BuiltFile>;
};

const ROOT = import.meta.dir + '/..';

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  map: 'application/json; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', ico: 'image/x-icon',
  webmanifest: 'application/manifest+json',
};

function typeOf(path: string): string {
  const type = TYPES[path.split('.').pop() ?? ''];
  if (!type) throw new Error(`build: no content type for ${path}. Add its extension to TYPES in scripts/build.ts.`);
  return type;
}

async function listFiles(dir: string): Promise<string[]> {
  const names = await readdir(`${ROOT}/${dir}`, { recursive: true });
  const files: string[] = [];
  for (const name of names.sort()) {
    const path = `${dir}/${name}`;
    if (name.split('/').some(part => part.startsWith('.'))) continue;
    if ((await Bun.file(`${ROOT}/${path}`).stat()).isFile()) files.push(path);
  }
  return files;
}

const bytesOf = async (path: string) => new Uint8Array(await Bun.file(`${ROOT}/${path}`).arrayBuffer());

/**
 * The build id is a hash of every input, so it changes when the app a browser would get changes.
 * BUILD_SALT is mixed in so a restart can be made a new build with the same code. The deploy test uses it.
 */
async function hashInputs(paths: string[]): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update((Bun.env.BUILD_SALT ?? '') + '\0');
  for (const path of paths) {
    hasher.update(path + '\0');
    hasher.update(await bytesOf(path));
  }
  return hasher.digest('hex').slice(0, 12);
}

async function bundle(entry: string, format: 'esm' | 'iife', define: Record<string, string>): Promise<Map<string, Bytes>> {
  const result = await Bun.build({ entrypoints: [`${ROOT}/${entry}`], target: 'browser', format, minify: true, sourcemap: 'linked', define });
  if (!result.success) throw new Error(`build: ${entry} failed\n${result.logs.map(String).join('\n')}`);
  const out = new Map<string, Bytes>();
  for (const artifact of result.outputs) out.set('/' + artifact.path.replace(/^\.?\//, ''), new Uint8Array(await artifact.arrayBuffer()));
  return out;
}

/** URL path prefixes served by the app that stay out of the service worker install precache (loaded on demand). */
export const SHELL_EXCLUDED_PREFIXES = ['/intro/primer/'] as const;

/** Whether a built URL path belongs in the service worker's install-time `__SHELL__` precache. */
export const isShellPath = (path: string): boolean =>
  !path.endsWith('.map') && path !== '/sw.js' && !SHELL_EXCLUDED_PREFIXES.some(prefix => path.startsWith(prefix));

export async function buildApp(): Promise<Built> {
  const sources = await listFiles('src'), statics = await listFiles('public');
  const build = await hashInputs(['scripts/build.ts', ...sources, ...statics]);
  const files = new Map<string, BuiltFile>();
  const add = (path: string, body: Bytes) => files.set(path, { type: typeOf(path), body });

  for (const path of statics) add(path.slice('public'.length), await bytesOf(path));
  for (const [path, body] of await bundle('src/app.js', 'esm', { __BUILD__: JSON.stringify(build) })) add(path, body);
  // The odds engine's worker thread (src/edge/odds-run.ts starts it), cached with the shell so the odds play offline.
  for (const [path, body] of await bundle('src/odds-worker.ts', 'iife', {})) add(path, body);

  // The worker precaches everything a page load needs. Source maps are for debugging only; intro art loads on demand.
  const shell = ['./', ...[...files.keys()].filter(isShellPath).map(path => path.slice(1))];
  const worker = await bundle('src/sw.js', 'iife', { __BUILD__: JSON.stringify(build), __SHELL__: JSON.stringify(shell) });
  for (const [path, body] of worker) add(path, body);

  return { build, files };
}

if (import.meta.main) {
  const { build, files } = await buildApp();
  const dist = `${ROOT}/dist`;
  await rm(dist, { recursive: true, force: true });
  for (const [path, file] of files) {
    await mkdir((dist + path).replace(/\/[^/]*$/, ''), { recursive: true });
    await Bun.write(dist + path, file.body);
  }
  console.log(`Built ${files.size} files into dist/ (build ${build})`);
}
