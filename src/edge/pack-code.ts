// pack-code.ts: the code a pack travels as when it is pasted rather than sent as a file. `HS1.`, the pack's JSON
// compressed with CompressionStream('deflate-raw') in base64url, a dot, and the CRC-32 of that base64url text in 8 hex
// digits, so a code with one character changed is refused rather than read as something else (deflate-raw has no check
// of its own). What a code holds is read by `parsePack` (src/core/pack.ts); this file only packs and unpacks the text.

export const CODE_PREFIX = 'HS1.';
/** A code longer than this, or one that unpacks to more than this many bytes, is refused: a save file's own limit. */
const MAX_BYTES = 5 * 1024 * 1024;
const CODE_RE = /HS1\.([A-Za-z0-9_-]+)\.([0-9a-f]{8})/;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(text: string): string {
  let c = 0xffffffff;
  for (let i = 0; i < text.length; i++) c = CRC_TABLE[(c ^ text.charCodeAt(i)) & 0xff]! ^ (c >>> 8);
  return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

function toBase64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64url(text: string): Uint8Array {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/** The bytes of a stream, or null past `MAX_BYTES`. */
async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array | null> {
  const reader = stream.getReader(), parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const through = (bytes: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array | null> =>
  readAll(new Blob([bytes as BlobPart]).stream().pipeThrough(t));

/** Whether this browser can make and read codes (CompressionStream: Safari 16.4, Chrome 80, Firefox 113). */
export const canCode = (): boolean => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

/** The code of a value (a pack doc). */
export async function makeCode(value: unknown): Promise<string> {
  const packed = await through(new TextEncoder().encode(JSON.stringify(value)), new CompressionStream('deflate-raw'));
  if (!packed) throw new Error('pack too large');
  const body = toBase64url(packed);
  return `${CODE_PREFIX}${body}.${crc32(body)}`;
}

export type CodeRead = { ok: true; value: unknown } | { ok: false; why: 'no-code' | 'damaged' | 'unsupported' };
/**
 * The value a pasted text's code holds. White space anywhere in the text is ignored (a chat app may wrap a long code),
 * and text around the code too. No code: the text has no `HS1.`. Damaged: the code is cut, a character changed, or
 * what it unpacks to is not JSON.
 */
export async function readCode(text: string): Promise<CodeRead> {
  const flat = String(text).replace(/\s+/g, '');
  if (!flat.includes(CODE_PREFIX)) return { ok: false, why: 'no-code' };
  if (!canCode()) return { ok: false, why: 'unsupported' };
  const m = CODE_RE.exec(flat);
  if (!m || m[1]!.length > MAX_BYTES || crc32(m[1]!) !== m[2]) return { ok: false, why: 'damaged' };
  try {
    const bytes = await through(fromBase64url(m[1]!), new DecompressionStream('deflate-raw'));
    if (!bytes) return { ok: false, why: 'damaged' };
    return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  } catch { // bytes that do not inflate or are not UTF-8 JSON: the Data view tells the GM the code is damaged
    return { ok: false, why: 'damaged' };
  }
}
