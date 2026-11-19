// statecharts.ts: draws a Mermaid state chart of each explicit machine by walking its real reducer, and writes them to
// docs/state-machines.md. `bun scripts/statecharts.ts` prints the charts, `--write` writes the file, `--check` exits 1
// when the file is not what the code gives (tests/statecharts.test.ts runs the same check).
// Each machine is a file in scripts/charts/: how to walk it, and one or more views that name its states and steps in the
// words of the GM or player. A view follows .claude/skills/statechart: `state()` gives a string (a flat chart), a list
// (parent states) or an object (parallel regions), `step()` the arrow's label or null to hide the step.
import { channel } from './charts/channel.ts';
import { coin } from './charts/coin.ts';
import { choiceChart } from './charts/choice.ts';
import { gestureChart } from './charts/gesture.ts';
import { onboarding } from './charts/onboarding.ts';
import { upgrade } from './charts/upgrade.ts';
import { db } from './charts/db.ts';
import { outbox } from './charts/outbox.ts';
import { odds } from './charts/odds.ts';
import { soloClock, soloWait } from './charts/solo.ts';
import { offerGiver, offerRoom, offerTaker, offerWatch } from './charts/trade.ts';
import { store } from './charts/store.ts';
import { fight } from './charts/fight.ts';
import { gate } from './charts/gate.ts';
import { jobChain } from './charts/job-chain.ts';
import { life } from './charts/life.ts';
import { link } from './charts/link.ts';
import { penalty } from './charts/penalty.ts';
import { quest } from './charts/quest.ts';
import { shadow } from './charts/shadow.ts';
import { extraction } from './charts/extraction.ts';
import { stacks } from './charts/stacks.ts';
import { trips } from './charts/trips.ts';
import { delayed } from './charts/delayed.ts';
import { zone } from './charts/zone.ts';
import { summon } from './charts/summon.ts';
import { uses } from './charts/uses.ts';
import { feat } from './charts/feat.ts';
import { edge, extras, reaction, shove, stealth, ward } from './charts/wave2.ts';

// ── what a machine file gives ──
/** A chart state: a label, a path of labels (parent states first), or one label or path per region. */
export type Shape = string | readonly string[] | { readonly [region: string]: string | readonly string[] };
/** An arrow's label, null to hide the step, or one label (or null) per region in a regions chart. */
export type Arrow = string | null | { readonly [region: string]: string | null };
export type Step<S, E> = { from: S; event: E; to: S };
export type Walk<S, E> = { starts: S[]; states: S[]; steps: Step<S, E>[] };
export type View<S, E> = {
  title: string;
  /** One paragraph under the chart: what the model leaves out. */
  note: string;
  /** Which steps the chart hides, in a sentence, or '' when it hides none. */
  hides: string;
  state: (s: S) => Shape;
  step: (event: E, from: S, to: S) => Arrow;
};
export type Machine<S, E> = {
  name: string;
  /** How the states were found, in one sentence. */
  walked: string;
  walk: () => Walk<S, E>;
  /**
   * Every value of the machine's discriminant (for a fight, 'none' too), from a record keyed by the union, so a new
   * variant fails the typecheck until the view names it. The test checks each one is reached and drawn.
   */
  kinds: readonly string[];
  /** The kinds a state is in: one per union the state holds. */
  kindsOf: (s: S) => readonly string[];
  views: readonly View<S, E>[];
  /** The rows of "Where it lives". */
  where: readonly (readonly [string, string])[];
};
/** Lets the list below hold machines of different state types. A function declaration, so the chart files can call it while this file is still loading them. */
export function machine<S, E>(m: Machine<S, E>): Machine<unknown, unknown> { return m as unknown as Machine<unknown, unknown>; }

export const MACHINES: readonly Machine<unknown, unknown>[] = [fight, channel, stacks, trips, delayed, zone, summon, uses, reaction, edge, shove, stealth, ward, extras, gate, link, life, penalty, jobChain, coin, onboarding, gestureChart, choiceChart, shadow, extraction, quest, db, upgrade, outbox, store, odds, soloClock, soloWait, feat, offerRoom, offerGiver, offerTaker, offerWatch];

// ── walking ──
/** Breadth first from `starts`: every state `moves` reaches, one per key. `maxDepth` bounds a machine with no end of states. */
export function bfs<S, E>(starts: readonly S[], moves: (s: S) => readonly { event: E; to: S }[], key: (s: S) => string, maxDepth = Infinity): Walk<S, E> {
  const seen = new Set<string>(), states: S[] = [], steps: Step<S, E>[] = [];
  const first: S[] = [];
  for (const s of starts) { const k = key(s); if (!seen.has(k)) { seen.add(k); states.push(s); first.push(s); } }
  let frontier = first;
  for (let depth = 0; frontier.length && depth < maxDepth; depth++) {
    const next: S[] = [];
    for (const from of frontier) {
      for (const { event, to } of moves(from)) {
        steps.push({ from, event, to });
        const k = key(to);
        if (seen.has(k)) continue;
        seen.add(k); states.push(to); next.push(to);
      }
    }
    frontier = next;
  }
  return { starts: first, states, steps };
}

// ── from model states to a chart ──
type Path = readonly string[];
const pathKey = (p: Path): string => p.join('\u0001');
const under = (p: Path, parent: Path): boolean => p.length > parent.length && parent.every((x, i) => p[i] === x);
type Edge = { from: Path; to: Path; label: string };
/** One region of a chart (a flat chart is one region). */
type Graph = { name: string | null; nodes: Path[]; starts: Path[]; edges: Edge[]; leafEdges: Edge[]; problems: string[] };
export type Drawn = { title: string; note: string; hides: string; regions: Graph[]; hidden: number; mermaid: string; problems: string[] };

function regionsOf(shape: Shape): [string | null, Path][] {
  if (typeof shape === 'string') return [[null, [shape]]];
  if (Array.isArray(shape)) return [[null, shape as Path]];
  return Object.entries(shape as Record<string, string | Path>).map(([r, v]) => [r, typeof v === 'string' ? [v] : v]);
}
const labelIn = (arrow: Arrow, region: string | null): string | null =>
  arrow === null || typeof arrow === 'string' ? arrow : region !== null ? (arrow[region] ?? null) : null;

/** Draws one view of a walk: maps every state once and every step once, merges states that share a label. */
export function draw<S, E>(walk: Walk<S, E>, view: View<S, E>): Drawn {
  const shapes = new Map<S, [string | null, Path][]>();
  const shapeOf = (s: S): [string | null, Path][] => { let r = shapes.get(s); if (!r) { r = regionsOf(view.state(s)); shapes.set(s, r); } return r; };
  const graphs = new Map<string | null, { g: Graph; nodes: Map<string, Path>; starts: Map<string, Path>; edges: Map<string, Edge>; moved: Set<string> }>();
  const graph = (name: string | null) => {
    let x = graphs.get(name);
    if (!x) { x = { g: { name, nodes: [], starts: [], edges: [], leafEdges: [], problems: [] }, nodes: new Map(), starts: new Map(), edges: new Map(), moved: new Set() }; graphs.set(name, x); }
    return x;
  };
  for (const s of walk.starts) for (const [r, p] of shapeOf(s)) { const x = graph(r); x.starts.set(pathKey(p), p); x.nodes.set(pathKey(p), p); }
  for (const s of walk.states) for (const [r, p] of shapeOf(s)) graph(r).nodes.set(pathKey(p), p);
  let hidden = 0;
  for (const { from, event, to } of walk.steps) {
    const a = shapeOf(from), b = new Map(shapeOf(to));
    const changes = a.filter(([r, p]) => pathKey(p) !== pathKey(b.get(r) ?? []));
    if (!changes.length) continue;
    const arrow = view.step(event, from, to);
    for (const [r, p] of changes) {
      const q = b.get(r)!, x = graph(r), label = labelIn(arrow, r);
      x.moved.add(pathKey(p));
      if (label === null) { hidden++; continue; }
      const k = `${pathKey(p)}\u0002${pathKey(q)}\u0002${label}`;
      if (!x.edges.has(k)) x.edges.set(k, { from: p, to: q, label });
    }
  }
  const regions: Graph[] = [];
  for (const x of graphs.values()) {
    const g = x.g;
    g.nodes = [...x.nodes.values()]; g.starts = [...x.starts.values()]; g.leafEdges = [...x.edges.values()];
    g.problems = check(g, x.moved);
    g.edges = lift(g.leafEdges);
    regions.push(g);
  }
  const problems = regions.flatMap(g => g.problems.map(p => `${view.title}${g.name ? `, ${g.name}` : ''}: ${p}`));
  return { title: view.title, note: view.note, hides: view.hides, regions, hidden, mermaid: mermaid(view.title, regions), problems };
}

/** The skill's rules for hiding: each chart state is reached by arrows from a start, and keeps an arrow out if it had a step out. */
function check(g: Graph, moved: Set<string>): string[] {
  const out: string[] = [], reached = new Set(g.starts.map(pathKey)), todo = [...g.starts];
  while (todo.length) {
    const p = todo.pop()!;
    for (const e of g.leafEdges) if (pathKey(e.from) === pathKey(p) && !reached.has(pathKey(e.to))) { reached.add(pathKey(e.to)); todo.push(e.to); }
  }
  for (const p of g.nodes) {
    if (!reached.has(pathKey(p))) out.push(`"${p.join(' / ')}" is not reached by any arrow`);
    if (moved.has(pathKey(p)) && !g.leafEdges.some(e => pathKey(e.from) === pathKey(p))) out.push(`"${p.join(' / ')}" has a step out but no arrow out`);
  }
  return out;
}

/**
 * Where an arrow is drawn. Mermaid lays out an arrow that crosses the edge of a box badly (it pulls the state out of
 * its box), so an end inside a box the other end is not in is drawn at that box. Arrows that then coincide are one.
 */
function lift(edges: Edge[]): Edge[] {
  const out = new Map<string, Edge>();
  for (const e of edges) {
    let i = 0;
    while (i < e.from.length - 1 && i < e.to.length - 1 && e.from[i] === e.to[i]) i++;
    const x = { from: e.from.slice(0, i + 1), to: e.to.slice(0, i + 1), label: e.label };
    const k = `${pathKey(x.from)}\u0002${pathKey(x.to)}\u0002${x.label}`;
    if (!out.has(k)) out.set(k, x);
  }
  return [...out.values()];
}

// ── Mermaid ──
function mermaid(title: string, regions: Graph[]): string {
  const lines = ['---', `title: ${title}`, '---', 'stateDiagram-v2'];
  const ids = new Map<string, string>();
  let n = 0;
  const id = (p: Path): string => { const k = pathKey(p); let v = ids.get(k); if (!v) { v = `s${++n}`; ids.set(k, v); } return v; };
  const quote = (s: string): string => s.replace(/"/g, "'");
  /** The box an arrow is declared in: the deepest parent that holds both ends. Mermaid lays it out inside that box. */
  const home = (e: Edge): string => {
    let i = 0;
    while (i < e.from.length - 1 && i < e.to.length - 1 && e.from[i] === e.to[i]) i++;
    return pathKey(e.from.slice(0, i));
  };
  const tree = (g: Graph, indent: string): string[] => {
    const out: string[] = [];
    const walkLevel = (prefix: Path, ind: string): void => {
      const kids: Path[] = [];
      for (const p of g.nodes) {
        if (!under(p, prefix)) continue;
        const kid = p.slice(0, prefix.length + 1);
        if (!kids.some(k => pathKey(k) === pathKey(kid))) kids.push(kid);
      }
      for (const k of kids) {
        if (g.nodes.some(p => under(p, k))) {
          out.push(`${ind}state "${quote(k[k.length - 1]!)}" as ${id(k)} {`);
          walkLevel(k, `${ind}  `);
          out.push(`${ind}}`);
        } else out.push(`${ind}state "${quote(k[k.length - 1]!)}" as ${id(k)}`);
      }
      if (!prefix.length) for (const k of new Set(g.starts.map(s => id(s.slice(0, 1))))) out.push(`${ind}[*] --> ${k}`);
      for (const e of g.edges) if (home(e) === pathKey(prefix)) out.push(`${ind}${id(e.from)} --> ${id(e.to)} : ${e.label.replace(/[:;#]/g, ',')}`);
    };
    walkLevel([], indent);
    return out;
  };
  if (regions.length === 1 && regions[0]!.name === null) lines.push(...tree(regions[0]!, '  '));
  else {
    lines.push(`  state "${quote(title)}" as all {`);
    regions.forEach((g, i) => {
      if (i) lines.push('    --');
      lines.push(`    state "${quote(g.name ?? '')}" as r${i + 1} {`, ...tree(g, '      '), '    }');
    });
    lines.push('  }');
  }
  return lines.join('\n');
}

// ── the document ──
const HEAD = `# State machines

Generated by \`bun run charts\` from the real reducers: \`scripts/statecharts.ts\` walks each machine and \`scripts/charts/\` names its states and steps. Do not edit this file by hand. \`tests/statecharts.test.ts\` fails when it is not what the code gives.

How to read a chart. A box is what the GM or a player can see. An arrow is what makes it change, in their words. An arrow that ends at a box with boxes inside goes to one of them, and an arrow that starts there leaves from one or more of them: the note under the chart says which where it matters. A step that stays inside one box is not drawn.
`;

export type Built = { machine: Machine<unknown, unknown>; walk: Walk<unknown, unknown>; charts: Drawn[] };
export function build(machines: readonly Machine<unknown, unknown>[] = MACHINES): Built[] {
  return machines.map(m => { const walk = m.walk(); return { machine: m, walk, charts: m.views.map(v => draw(walk, v)) }; });
}

export function render(built: Built[]): string {
  const out = [HEAD];
  for (const { machine: m, walk, charts } of built) {
    out.push(`## ${m.name}`, '', `${m.walked} The walk found ${walk.states.length} states and ${walk.steps.length} steps.`, '');
    for (const c of charts) {
      const states = c.regions.reduce((a, g) => a + g.nodes.length, 0), arrows = c.regions.reduce((a, g) => a + g.edges.length, 0);
      out.push(`### ${c.title}`, '', '```mermaid', c.mermaid, '```', '', c.note, '');
      out.push(`${states} chart states, ${arrows} arrows. ${c.hides ? `Hidden: ${c.hides} (${c.hidden} steps.)` : 'No step is hidden.'}`, '');
    }
    out.push('Where it lives:', '', '| What | Where |', '|---|---|', ...m.where.map(([a, b]) => `| ${a} | ${b} |`), '');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

export const DOC = new URL('../docs/state-machines.md', import.meta.url).pathname;

if (import.meta.main) {
  const built = build(), text = render(built), arg = process.argv[2];
  const problems = built.flatMap(b => b.charts.flatMap(c => c.problems));
  for (const p of problems) console.error(`chart problem: ${p}`);
  if (arg === '--write') { await Bun.write(DOC, text); console.log(`wrote ${DOC}`); }
  else if (arg === '--check') {
    const have = await Bun.file(DOC).text().catch(() => '');
    if (have !== text) { console.error('docs/state-machines.md is out of date: run bun run charts'); process.exit(1); }
    console.log('docs/state-machines.md is current');
  } else console.log(text);
  if (problems.length) process.exit(1);
}
