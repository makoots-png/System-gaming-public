// Hand-written types for the few Bun APIs this repo uses. @types/bun is not an approved dependency.
// Add a member here when a new Bun API is used. Keep each one as narrow as the call site needs.

interface BunFile extends Blob {
  exists(): Promise<boolean>;
  json(): Promise<unknown>;
  stat(): Promise<{ isFile(): boolean }>;
}

interface BunBuildArtifact extends Blob {
  /** Relative to the output root, for example `./app.js`. */
  readonly path: string;
}

interface BunCryptoHasher {
  update(data: string | Uint8Array): BunCryptoHasher;
  digest(encoding: 'hex'): string;
}

interface BunServer {
  readonly port: number;
  readonly url: URL;
  stop(closeActiveConnections?: boolean): Promise<void>;
}

/** The queries of one transaction (`BunSqlClient.begin`). */
interface BunSqlTx {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
}
interface BunSqlClient {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
  /** Runs `fn` in one transaction on one connection: committed when it resolves, rolled back when it throws. */
  begin<T>(fn: (tx: BunSqlTx) => Promise<T>): Promise<T>;
  /** Closes every connection of the pool. */
  close(): Promise<void>;
}

/** A child process whose output the caller reads. */
interface BunPipedProcess {
  readonly exited: Promise<number>;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  kill(): void;
}

declare const Bun: {
  /** Runs a command to its end and answers what it printed (scripts/ci.ts asks git for a tree id). */
  spawnSync(cmd: string[]): { readonly stdout: { toString(): string }; readonly exitCode: number };
  readonly env: Record<string, string | undefined>;
  file(path: string): BunFile;
  serve(options: { port?: number; hostname?: string; fetch(req: Request): Response | Promise<Response> }): BunServer;
  SQL: new (url: string) => BunSqlClient;
  CryptoHasher: new (algorithm: 'sha256') => BunCryptoHasher;
  write(path: string, data: Uint8Array | string): Promise<number>;
  build(options: {
    entrypoints: string[];
    target: 'browser';
    format: 'esm' | 'iife';
    minify: boolean;
    sourcemap: 'none' | 'linked';
    define: Record<string, string>;
  }): Promise<{ readonly success: boolean; readonly logs: unknown[]; readonly outputs: BunBuildArtifact[] }>;
  spawn(cmd: string[], options: { env?: Record<string, string | undefined>; stdout: 'pipe'; stderr: 'pipe' }): BunPipedProcess;
  spawn(cmd: string[], options?: { env?: Record<string, string | undefined>; stdout?: 'inherit' | 'pipe'; stderr?: 'inherit' | 'pipe' }): { readonly exited: Promise<number> };
};

interface ImportMeta {
  readonly dir: string;
  readonly main: boolean;
}

declare const process: {
  readonly env: Record<string, string | undefined>;
  readonly argv: string[];
  /** The path of the Bun binary that runs this process. */
  readonly execPath: string;
  exit(code?: number): never;
  /** A negative pid signals the whole process group. Throws when there is no such process. */
  kill(pid: number, signal?: 'SIGTERM' | 'SIGKILL'): true;
};

declare module 'bun:test' {
  type Fn = () => void | Promise<void>;

  interface Matchers<T> {
    readonly not: Matchers<T>;
    readonly resolves: Matchers<Awaited<T>>;
    readonly rejects: Matchers<unknown>;
    toBe(expected: T): void;
    toEqual(expected: unknown): void;
    toStrictEqual(expected: unknown): void;
    toMatchObject(expected: object): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toBeNaN(): void;
    toBeInstanceOf(ctor: abstract new (...args: never[]) => unknown): void;
    toBeGreaterThan(n: number): void;
    toBeGreaterThanOrEqual(n: number): void;
    toBeLessThan(n: number): void;
    toBeLessThanOrEqual(n: number): void;
    toBeCloseTo(n: number, digits?: number): void;
    toContain(item: unknown): void;
    toContainEqual(item: unknown): void;
    toHaveLength(n: number): void;
    toHaveProperty(path: string, value?: unknown): void;
    toMatch(pattern: RegExp | string): void;
    toThrow(expected?: RegExp | string | (abstract new (...args: never[]) => unknown)): void;
  }

  interface TestFn {
    (name: string, fn: Fn, timeoutMs?: number): void;
    only(name: string, fn: Fn, timeoutMs?: number): void;
    skip(name: string, fn: Fn, timeoutMs?: number): void;
    todo(name: string, fn?: Fn): void;
  }

  interface DescribeFn {
    (name: string, fn: () => void): void;
    only(name: string, fn: () => void): void;
    skip(name: string, fn: () => void): void;
  }

  export const test: TestFn;
  export const it: TestFn;
  export const describe: DescribeFn;
  export function expect<T>(actual: T, message?: string): Matchers<T>;
  export function beforeAll(fn: Fn): void;
  export function afterAll(fn: Fn): void;
  export function beforeEach(fn: Fn): void;
  export function afterEach(fn: Fn): void;
}

declare module 'node:child_process' {
  interface ChildProcess {
    readonly pid?: number;
  }
  /** `detached` puts the child in its own process group, so `process.kill(-pid)` stops it and what it started. */
  export function spawn(command: string, args: string[], options: { env: Record<string, string | undefined>; stdio: 'ignore' | 'inherit'; detached?: boolean }): ChildProcess;
}

declare module 'node:fs/promises' {
  export function writeFile(path: string, data: string): Promise<void>;
  export function readFile(path: string, encoding: 'utf8'): Promise<string>;
  export function readdir(path: string, options?: { recursive?: boolean }): Promise<string[]>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readFileSync(path: string): Buffer;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean };
  export function renameSync(from: string, to: string): void;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function writeFileSync(path: string, data: string | Uint8Array): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
}

interface Buffer extends Uint8Array<ArrayBuffer> {
  toString(encoding?: 'base64' | 'utf8'): string;
}

declare const Buffer: {
  from(data: string, encoding: 'base64'): Buffer;
};
