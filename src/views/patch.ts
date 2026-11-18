// patch.ts: how a screen that changes often (the fight's card and turn order, a player's fight HUD) updates in place.
// A view describes what it shows as plain data, a `Desc` per thing on screen, and draws a thing's template once. On each
// change `bind` writes only the fields whose value changed into the nodes bound to them, and `keyed` keeps one element per
// key in order, moving only those out of place. Nodes persist, so a move of motion.ts (`fillTo`, `numberTo`, `slideTo`)
// finds the node that showed the old value, and a change to one row touches that row's nodes only.
//
// A template binds a node to a field by an attribute:
//   data-part="f"   the node's markup is the field (a string of markup the view escaped); for a part made of a list or
//                   of things that come and go. The markup holds no binding of its own: it is replaced whole.
//   data-text="f"   the node's text
//   data-num="f"    a number that counts to its new value (motion.ts `numberTo`)
//   data-fill="f"   a bar's fill, a fraction from 0 to 1 (motion.ts `fillTo`)
//   data-attr="name:f name2:f2"   attributes: false or null removes one, true sets it empty, else its text
//   data-show="f"   the node is hidden while the field is null or false (a shield, a mana bar)
// A description may name what it shows in its field `key` (a row id): when that changes, the node shows another thing, so
// its numbers and bars are drawn at once rather than moved from the last thing's values.
// `changed`, `plan` and `prepended` are pure, with their cases in tests/patch.test.ts.
import { fillTo, forget, numberTo } from './motion.ts';

export type Value = string | number | boolean | null;
/** What one thing on screen shows: a flat record, so two of them compare field by field. */
export type Desc = Readonly<Record<string, Value>>;

/** The fields of `next` whose value differs from `prev`'s; every field of `next` when there is no `prev`. */
export function changed(prev: Desc | undefined, next: Desc): string[] {
  return Object.keys(next).filter(k => !prev || !Object.is(prev[k], next[k]));
}

/**
 * How a list of keyed elements goes from the order `was` to the order `now`: the keys to remove, then each key to put
 * before another (null: at the end), in the order to do it. The longest run of keys already in order stays where it is,
 * so after a turn, when one row moves down the order, that row alone moves.
 */
export function plan(was: readonly string[], now: readonly string[]): { remove: string[]; put: { key: string; before: string | null }[] } {
  const at = new Map(now.map((k, i) => [k, i]));
  const kept = was.filter(k => at.has(k)), seq = kept.map(k => at.get(k)!);
  // the longest increasing run of new places among the kept keys (patience sorting, n log n)
  const tails: number[] = [], prev: number[] = [];
  seq.forEach((v, i) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (seq[tails[mid]!]! < v) lo = mid + 1; else hi = mid; }
    prev[i] = lo > 0 ? tails[lo - 1]! : -1;
    tails[lo] = i;
  });
  const stay = new Set<string>();
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i >= 0; i = prev[i]!) stay.add(kept[i]!);
  const put: { key: string; before: string | null }[] = [];
  for (let i = now.length - 1; i >= 0; i--) if (!stay.has(now[i]!)) put.push({ key: now[i]!, before: now[i + 1] ?? null });
  return { remove: was.filter(k => !at.has(k)), put };
}

/**
 * A log grows at its front and drops its oldest lines past a cap: how many lines at the front of `now` are new since
 * `was` (the rest of `now` is the front of `was`), or null when `now` is shorter, and the list must be drawn again.
 */
export function prepended(was: readonly string[], now: readonly string[]): number | null {
  if (now.length < was.length) return null;
  for (let k = now.length - was.length; k < now.length; k++) {
    let same = true;
    for (let i = 0; k + i < now.length && same; i++) same = now[k + i] === was[i];
    if (same) return k;
  }
  return now.length;
}

const SEL = '[data-part],[data-text],[data-num],[data-fill],[data-attr],[data-show]';
const bound = new WeakMap<Element, { nodes: HTMLElement[]; last: Desc | undefined }>();

/**
 * Writes into `el`'s bound nodes the fields of `next` that changed since the last `bind` of `el`. The nodes are found at
 * the first bind: those of `el`'s template, not those of a keyed element inside it, which has its own description.
 */
export function bind(el: HTMLElement, next: Desc): void {
  let b = bound.get(el);
  if (!b) {
    const own = (n: HTMLElement) => { const k = n.closest('[data-key]'); return !k || k === el || !el.contains(k); };
    b = { nodes: [...(el.matches(SEL) ? [el] : []), ...el.querySelectorAll<HTMLElement>(SEL)].filter(own), last: undefined };
    bound.set(el, b);
  }
  const fresh = new Set(changed(b.last, next)), other = b.last !== undefined && b.last['key'] !== next['key'];
  b.last = next;
  if (!fresh.size) return;
  for (const n of b.nodes) {
    if (other && (n.dataset['num'] || n.dataset['fill'])) forget(n);
    const d = n.dataset;
    if (d['attr']) for (const pair of d['attr'].split(' ')) {
      const [name, f] = pair.split(':') as [string, string];
      if (!fresh.has(f)) continue;
      const v = next[f];
      if (v === false || v === null || v === undefined) n.removeAttribute(name); else n.setAttribute(name, v === true ? '' : String(v));
    }
    if (d['show'] && fresh.has(d['show'])) n.hidden = next[d['show']] === null || next[d['show']] === false;
    if (d['part'] && fresh.has(d['part'])) n.innerHTML = String(next[d['part']] ?? '');
    if (d['text'] && fresh.has(d['text'])) n.textContent = String(next[d['text']] ?? '');
    if (d['num'] && fresh.has(d['num'])) void numberTo(n, Number(next[d['num']]));
    if (d['fill'] && fresh.has(d['fill'])) void fillTo(n, Number(next[d['fill']]));
  }
}

/**
 * Keeps one child of `box` per key, in the order of `keys`: `make(key)` draws a new one, a child whose key is gone is
 * removed, and only a child out of place moves. Answers the children in order.
 */
export function keyed(box: Element, keys: readonly string[], make: (key: string) => HTMLElement): HTMLElement[] {
  const have = new Map<string, HTMLElement>();
  for (const c of box.children) if (c instanceof HTMLElement && c.dataset['key'] !== undefined) have.set(c.dataset['key'], c);
  const p = plan([...have.keys()], keys);
  for (const k of p.remove) have.get(k)!.remove();
  for (const { key, before } of p.put) {
    let el = have.get(key);
    if (!el) { el = make(key); el.dataset['key'] = key; have.set(key, el); }
    box.insertBefore(el, before === null ? null : have.get(before)!);
  }
  return keys.map(k => have.get(k)!);
}
