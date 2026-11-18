// The code a pack travels as when pasted (src/edge/pack-code.ts): HS1., the compressed JSON, and a check.
import { describe, expect, test } from 'bun:test';
import { makeCode, readCode } from '../src/edge/pack-code.ts';

const PACK = { schema: 3, kind: 'library', savedAt: '2026-11-13T10:00:00.000Z', library: { items: [{ name: 'Frost Shard', desc: 'Cold to the touch. '.repeat(20) }] } };
/** The code with the character at `i` of its body swapped for another the alphabet allows. */
const damaged = (code: string, i: number): string => {
  const at = 'HS1.'.length + i, c = code[at]!;
  return code.slice(0, at) + (c === 'A' ? 'B' : 'A') + code.slice(at + 1);
};

describe('a pack code', () => {
  test('starts with HS1. and reads back as the value it was made from, shorter than the JSON', async () => {
    const code = await makeCode(PACK);
    expect(code.startsWith('HS1.')).toBe(true);
    expect(code.length).toBeLessThan(JSON.stringify(PACK).length);
    expect(await readCode(code)).toEqual({ ok: true, value: PACK });
  });

  test('a code wrapped over lines, with text around it, still reads', async () => {
    const code = await makeCode(PACK);
    const pasted = `Here is my stuff:\n${code.slice(0, 20)}\n  ${code.slice(20)} enjoy`;
    expect(await readCode(pasted)).toEqual({ ok: true, value: PACK });
  });

  test('one changed character anywhere in the code is refused as damaged', async () => {
    const code = await makeCode(PACK);
    for (const i of [0, 5, Math.floor(code.length / 2), code.length - 'HS1.'.length - 1]) expect(await readCode(damaged(code, i))).toEqual({ ok: false, why: 'damaged' });
  });

  test('a cut code is damaged, and text without HS1. holds no code', async () => {
    const code = await makeCode(PACK);
    expect(await readCode(code.slice(0, -10))).toEqual({ ok: false, why: 'damaged' });
    expect(await readCode('{"kind":"library"}')).toEqual({ ok: false, why: 'no-code' });
    expect(await readCode('')).toEqual({ ok: false, why: 'no-code' });
  });
});
