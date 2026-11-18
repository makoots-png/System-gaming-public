import { describe, expect, test } from 'bun:test';
import { qrMatrix, qrSvg } from '../src/core/qr.js';

type Golden = Record<string, { n: number; rows: string[] }>;
const golden = (await Bun.file(import.meta.dir + '/fixtures/qr-golden.json').json()) as Golden;

const asStrings = (rows: ArrayLike<number>[], n: number) => Array.from(rows, row => Array.from({ length: n }, (_, x) => (row[x] ? '1' : '0')).join(''));

describe('qrMatrix', () => {
  for (const [text, want] of Object.entries(golden)) {
    test(`${new TextEncoder().encode(text).length} bytes "${text.slice(0, 30)}" encodes to its golden matrix`, () => {
      const q = qrMatrix(text);
      expect(q).not.toBeNull();
      expect(q!.n).toBe(want.n);
      expect(asStrings(q!.rows, q!.n)).toEqual(want.rows);
    });

    test(`${new TextEncoder().encode(text).length} bytes "${text.slice(0, 30)}" has a finder pattern in three corners`, () => {
      const { n, rows } = want;
      const ring = (ox: number, oy: number) => {
        for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
          const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
          expect(rows[oy + dy]![ox + dx]).toBe(d === 2 ? '0' : '1');
        }
      };
      ring(0, 0);
      ring(n - 7, 0);
      ring(0, n - 7);
      expect(rows[n - 8]![8]).toBe('1');
    });
  }

  test('the matrix grows one version at each documented byte length', () => {
    const steps: [number, number][] = [[1, 21], [14, 21], [15, 25], [26, 25], [27, 29], [42, 29], [43, 33], [62, 33], [63, 37], [84, 37], [85, 41], [106, 41]];
    for (const [len, n] of steps) expect(qrMatrix('x'.repeat(len))?.n).toBe(n);
  });

  test('multi-byte characters count by their UTF-8 bytes', () => {
    expect(qrMatrix('狩'.repeat(5))?.n).toBe(25);
  });

  test('empty text and text over 106 bytes give null', () => {
    expect(qrMatrix('')).toBeNull();
    expect(qrMatrix(null)).toBeNull();
    expect(qrMatrix('x'.repeat(107))).toBeNull();
  });
});

describe('qrSvg', () => {
  test('a valid text gives one svg with a quiet zone of 4 modules', () => {
    const text = 'https://hunter.example.com/?room=ABCDEF';
    const svg = qrSvg(text);
    const size = golden[text]!.n + 8;
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" /);
    expect(svg).toContain(`viewBox="0 0 ${size} ${size}"`);
    expect(svg).toContain('aria-label="QR code"');
    expect(svg).toMatch(/<\/svg>$/);
    expect(svg).not.toContain(text);
  });

  test('the quiet zone option widens the view box', () => {
    const n = golden['x']!.n;
    expect(qrSvg('x', { quiet: 0 })).toContain(`viewBox="0 0 ${n} ${n}"`);
  });

  test('empty or too long text gives null instead of markup', () => {
    expect(qrSvg('')).toBeNull();
    expect(qrSvg('x'.repeat(107))).toBeNull();
  });
});
