// qr.js: tiny QR Model 2 encoder for invite links. Byte mode, error correction M, versions 1-6 (up to 106 UTF-8 bytes).
// qrMatrix(text, opts) -> { n, rows } | null (no quiet zone); qrSvg(text, opts) -> markup | null. No DOM, runs in Node too.
const DC = [16, 28, 44, 64, 86, 108], BL = [1, 1, 1, 2, 2, 4], TOT = [26, 44, 70, 100, 134, 172], AL = [0, 18, 22, 26, 30, 34];
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = EXP[i + 255] = x; LOG[x] = i; x <<= 1; if (x > 255) x ^= 0x11D; }
const mul = (a, b) => a && b ? EXP[LOG[a] + LOG[b]] : 0;

// Reed-Solomon remainder of data by the degree-e generator (long division, one byte at a time).
const rs = (data, e) => {
  let g = [1];
  for (let i = 0; i < e; i++) { const h = new Array(g.length + 1).fill(0); g.forEach((c, j) => { h[j] ^= c; h[j + 1] ^= mul(c, EXP[i]); }); g = h; }
  const r = new Array(e).fill(0);
  for (const d of data) { const f = d ^ r.shift(); r.push(0); for (let i = 0; i < e; i++) r[i] ^= mul(g[i + 1], f); }
  return r;
};

const codewords = (bytes, v) => {
  const cap = DC[v - 1], bits = [], put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  put(4, 4); put(bytes.length, 8); bytes.forEach(b => put(b, 8));
  put(0, Math.min(4, cap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let p = 0xEC; data.length < cap; p ^= 0xEC ^ 0x11) data.push(p);
  const nb = BL[v - 1], per = cap / nb, ec = (TOT[v - 1] - cap) / nb;
  const blocks = Array.from({ length: nb }, (_, i) => data.slice(i * per, (i + 1) * per));
  const eccs = blocks.map(b => rs(b, ec)), out = [];
  for (let i = 0; i < per; i++) blocks.forEach(b => out.push(b[i]));
  for (let i = 0; i < ec; i++) eccs.forEach(b => out.push(b[i]));
  return out;
};

const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (((y >> 1) + Math.floor(x / 3)) % 2) === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => (((x + y) % 2) + (x * y) % 3) % 2 === 0];

// The two spots where format bit i lives (top-left strip, and split between the other two finders).
const fmt = (i, n) => [i < 6 ? [8, i] : i < 8 ? [8, i + 1] : i === 8 ? [7, 8] : [14 - i, 8], i < 8 ? [n - 1 - i, 8] : [8, n - 15 + i]];

// Builds the grid with function patterns; returns it plus a same-sized map of reserved (non-data) modules.
const frame = v => {
  const n = 17 + 4 * v, m = Array.from({ length: n }, () => new Uint8Array(n)), fn = Array.from({ length: n }, () => new Uint8Array(n));
  const set = (x, y, d) => { if (x >= 0 && y >= 0 && x < n && y < n) { m[y][x] = d ? 1 : 0; fn[y][x] = 1; } };
  for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]])
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(cx + dx, cy + dy, d !== 2 && d !== 4); }
  if (v > 1) { const c = AL[v - 1]; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
  for (let i = 0; i < 15; i++) fmt(i, n).forEach(([x, y]) => set(x, y, 0));
  set(8, n - 8, 1);
  return { n, m, fn };
};

const penalty = (m, n) => {
  let p = 0, dark = 0;
  const line = a => { // N1 runs of 5+, N3 finder-like 1011101 with 4 light on a side
    let run = 1;
    for (let i = 1; i <= n; i++) { if (i < n && a[i] === a[i - 1]) run++; else { if (run >= 5) p += run - 2; run = 1; } }
    for (let i = 0; i + 7 <= n; i++) {
      if (a[i] && !a[i + 1] && a[i + 2] && a[i + 3] && a[i + 4] && !a[i + 5] && a[i + 6]) {
        const l = i >= 4 && !a[i - 4] && !a[i - 3] && !a[i - 2] && !a[i - 1], r = i + 11 <= n && !a[i + 7] && !a[i + 8] && !a[i + 9] && !a[i + 10];
        if (l || r) p += 40;
      }
    }
  };
  for (let y = 0; y < n; y++) {
    line(m[y]); line(m.map(r => r[y]));
    for (let x = 0; x < n; x++) { dark += m[y][x]; if (x && y && m[y][x] === m[y][x - 1] && m[y][x] === m[y - 1][x] && m[y][x] === m[y - 1][x - 1]) p += 3; }
  }
  return p + 10 * Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5);
};

const build = (cw, v, mask) => {
  const { n, m, fn } = frame(v), bits = [];
  cw.forEach(c => { for (let i = 7; i >= 0; i--) bits.push((c >> i) & 1); });
  if (v > 1) for (let i = 0; i < 7; i++) bits.push(0);
  let k = 0;
  for (let x = n - 1, up = true; x > 0; x -= 2, up = !up) {
    if (x === 6) x = 5;
    for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) {
      const xx = x - j, y = up ? n - 1 - i : i;
      if (!fn[y][xx]) m[y][xx] = (bits[k++] || 0) ^ (MASKS[mask](xx, y) ? 1 : 0);
    }
  }
  let r = mask << 10; // level M is 00, so the 5 data bits are just the mask
  for (let i = 4; i >= 0; i--) if ((r >> (i + 10)) & 1) r ^= 0x537 << i;
  const f = ((mask << 10) | r) ^ 0x5412;
  for (let i = 0; i < 15; i++) fmt(i, n).forEach(([x, y]) => { m[y][x] = (f >> i) & 1; });
  return { n, m };
};

export const qrMatrix = (text, opts = {}) => {
  const bytes = new TextEncoder().encode(String(text ?? ''));
  if (!bytes.length) return null;
  const v = [14, 26, 42, 62, 84, 106].findIndex(c => bytes.length <= c) + 1;
  if (!v) return null;
  const cw = codewords(bytes, v);
  let best = null;
  for (const mask of Number.isInteger(opts.mask) ? [opts.mask & 7] : [0, 1, 2, 3, 4, 5, 6, 7]) {
    const b = build(cw, v, mask), p = penalty(b.m, b.n);
    if (!best || p < best.p) best = { ...b, p };
  }
  return { n: best.n, rows: best.m };
};

export const qrSvg = (text, opts = {}) => {
  const q = qrMatrix(text);
  if (!q) return null;
  const quiet = opts.quiet ?? 4, s = q.n + 2 * quiet;
  let d = '';
  q.rows.forEach((row, y) => { for (let x = 0; x < q.n; x++) if (row[x]) { let e = x; while (e < q.n && row[e]) e++; d += `M${x + quiet} ${y + quiet}h${e - x}v1h${x - e}z`; x = e; } });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${s}" height="${s}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`;
};
