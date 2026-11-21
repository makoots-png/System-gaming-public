// map-maker.js: the GM's battle maps (src/core/registry/maps.ts) and their maker. The maker is the map drawn as a grid of
// tiles in the maker shell (maker.js; the grid is marked `data-mk-paint`, so a tile painted is an edit the shell asks
// about before Escape drops it): a brush (a terrain of space.ts `TERRAIN`, one of the map's zones, a start tile for
// a side, or the eraser) painted by a tap or a drag, the size by steppers, each zone's name and effects through the
// effects editor, and the party's fog and sight. Save runs `parseBattleMap` and keeps what it gives back in
// `library.maps`. The Workshop (workshop.js) lists the maps; the gate form (gates.js) names one; combat.js starts a
// fight on it. Exposes app.api.maps.
import { TERRAIN, TERRAINS } from '../core/combat/space.ts';
import { zoneTone } from '../core/combat/zones.ts';
import { MAP_BOUNDS, openArena, parseBattleMap } from '../core/registry/maps.ts';
import { MAX_ZONES } from '../core/combat/zones.ts';
import { oneOf } from '../core/one-of.ts';
import { atLibrary } from '../core/save-step.ts';
import { removeEntry, saveById, savedWords } from '../core/library.ts';

const TERRAIN_WORD = { floor: 'Floor', wall: 'Wall', cover: 'Cover', rough: 'Rough', pit: 'Pit' };
const SIDE_WORD = { party: 'Party start', foe: 'Foe start' };
const TILE = 22;

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc } = ui;
  const list = () => store.get().library.maps;

  ui.css('map-maker', `
.mpm-size{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.mpm-step{display:flex;align-items:center;gap:6px}.mpm-step b{min-width:2.2em;text-align:center}
.mpm-step .icon-btn{min-width:var(--control-h);min-height:var(--control-h)}
.mpm-brush{display:flex;flex-wrap:wrap;gap:6px}.mpm-brush button{min-height:var(--control-h)}
.mpm-scroll{overflow:auto;max-height:52vh;border:1px solid var(--line);background:var(--ground)}
.mpm-grid{display:grid;touch-action:none;user-select:none;-webkit-user-select:none;width:max-content}
.mpm-c{width:${TILE}px;height:${TILE}px;position:relative;border-right:1px solid color-mix(in srgb,var(--cyan) 10%,transparent);border-bottom:1px solid color-mix(in srgb,var(--cyan) 10%,transparent);font:700 10px/${TILE}px var(--font-body);text-align:center;color:var(--ground)}
/* each terrain as the fight's map draws it (map.js .mp-t), so what the GM paints is what the table sees */
.mpm-c.wall,.mpm-brush [data-brush=wall]::before{background:var(--wall-face);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--wall-top) 55%,transparent)}
.mpm-c.cover,.mpm-brush [data-brush=cover]::before{background:linear-gradient(var(--wall-top),var(--wall-top)) 0 45%/100% 3px no-repeat,linear-gradient(var(--wall-face),var(--wall-face)) bottom/100% 55% no-repeat}
.mpm-c.rough,.mpm-brush [data-brush=rough]::before{background-image:radial-gradient(circle,color-mix(in srgb,var(--muted) 60%,transparent) 0 1px,transparent 1.6px);background-size:25% 25%}
.mpm-c.pit,.mpm-brush [data-brush=pit]::before{background:var(--panel-solid);box-shadow:inset 0 0 6px 2px var(--ground)}
.mpm-c[data-z]::after{content:"";position:absolute;inset:0;background:color-mix(in srgb,var(--zc) 24%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--zc) 55%,transparent)}
.mpm-c.harm{--zc:var(--red)}.mpm-c.help{--zc:var(--green)}.mpm-c.hinder{--zc:var(--purple)}.mpm-c.plain{--zc:var(--muted)}
/* a start is drawn as the token that will stand there: round for the party, square for a foe */
.mpm-c[data-s]::before,.mpm-brush [data-brush=party]::before,.mpm-brush [data-brush=foe]::before{content:"";position:absolute;inset:3px;border-radius:50%;border:2px solid var(--cyan);background:color-mix(in srgb,var(--cyan) 22%,transparent);z-index:1}
.mpm-c[data-s=F]::before,.mpm-brush [data-brush=foe]::before{border-radius:4px;border-color:var(--red);background:color-mix(in srgb,var(--red) 22%,transparent)}
.mpm-brush [data-brush]::before{content:"";position:relative;inset:auto;display:inline-block;width:14px;height:14px;margin-right:6px;vertical-align:-2px;box-sizing:border-box}
.mpm-brush [data-brush=floor]::before,.mpm-brush [data-brush=erase]::before,.mpm-brush [data-brush^="zone:"]::before{display:none}
.mpm-zone{display:flex;flex-direction:column;gap:8px;border:1px solid var(--line);padding:8px}
.mpm-zrow{display:flex;gap:8px;align-items:end;flex-wrap:wrap}
`);

  /**
   * The maker for `m` (null: a new map). Answers the map as saved, or null.
   * @param {import('../core/registry/maps.ts').BattleMap | null} m
   */
  function make(m) {
    const M = app.api.maker, R = app.rules(), base = m || { ...openArena(R), name: '' };
    // the form's state: the tiles as characters, zones with their tiles as indices, starts as indices
    const st = {
      name: base.name, w: base.w, h: base.h, tiles: [...base.tiles], fog: base.fog, sight: base.sight,
      zones: base.zones.map(z => ({ id: String(z.id), name: z.name, ops: z.ops, tiles: new Set(z.ground.tiles.map(p => p.y * base.w + p.x)) })),
      starts: { party: base.starts.party.map(p => p.y * base.w + p.x), foe: base.starts.foe.map(p => p.y * base.w + p.x) },
    };
    let brush = 'wall', zoneAt = 0, eff = null, painting = false;
    return M.open({
      tag: '! Map', title: m ? `Edit ${m.name}` : 'New map', save: 'Save map', cls: 'mpm',
      build(el, shell) {
        const step = (k, label) => `<span class="mpm-step"><span class="lbl">${label}</span><button type="button" class="icon-btn" data-step="${k}" data-d="-1" aria-label="Fewer ${k === 'w' ? 'columns' : 'rows'}">−</button><b data-size="${k}"></b><button type="button" class="icon-btn" data-step="${k}" data-d="1" aria-label="More ${k === 'w' ? 'columns' : 'rows'}">+</button></span>`;
        el.innerHTML = `<label class="field"><span class="lbl">Name</span><input type="text" maxlength="${MAP_BOUNDS.name}" data-name value="${esc(st.name)}" autocomplete="off"></label>
          <div class="mpm-size">${step('w', 'Width')}${step('h', 'Height')}</div>
          <div class="lbl">Brush</div><div class="mpm-brush seg" role="group" aria-label="Brush" data-brushes></div>
          <div class="mpm-scroll"><div class="mpm-grid" data-grid data-mk-paint role="grid" aria-label="The map: tap or drag to paint"></div></div>
          <div class="mpm-zone" data-zonebox hidden></div>
          <label class="mk-check"><input type="checkbox" data-fog${st.fog ? ' checked' : ''}><span>Fog of war: the party sees only what is in its sight</span></label>
          <label class="field"><span class="lbl">Sight (tiles)</span><input type="number" min="${MAP_BOUNDS.sight[0]}" max="${MAP_BOUNDS.sight[1]}" inputmode="numeric" data-sight value="${st.sight}"></label>
          ${m ? '<button type="button" data-asnew>Save as a new map</button>' : ''}`;
        const $ = s => el.querySelector(s), grid = $('[data-grid]');
        const zoneOf = i => st.zones.findIndex(z => z.tiles.has(i));
        const cellAttrs = i => {
          const t = TERRAINS.find(x => TERRAIN[x].char === st.tiles[i]) || 'floor', z = zoneOf(i);
          const s = st.starts.party.includes(i) ? 'P' : st.starts.foe.includes(i) ? 'F' : '';
          return { cls: `mpm-c ${t}${z >= 0 ? ` ${zoneTone(st.zones[z].ops)}` : ''}`, z, s };
        };
        const paintCell = i => {
          const c = grid.children[i]; if (!c) return;
          const a = cellAttrs(i);
          c.className = a.cls;
          if (a.z >= 0) c.dataset.z = String(a.z); else delete c.dataset.z;
          if (a.s) c.dataset.s = a.s; else delete c.dataset.s;
        };
        function drawGrid() {
          grid.style.gridTemplateColumns = `repeat(${st.w},${TILE}px)`;
          grid.innerHTML = Array.from({ length: st.w * st.h }, (_, i) => `<div data-i="${i}" role="gridcell" aria-label="Tile ${i % st.w + 1}, ${Math.floor(i / st.w) + 1}"></div>`).join('');
          for (let i = 0; i < st.w * st.h; i++) paintCell(i);
          $('[data-size="w"]').textContent = String(st.w); $('[data-size="h"]').textContent = String(st.h);
        }
        function drawBrushes() {
          const zs = st.zones.map((z, k) => [`zone:${k}`, z.name || `Field ${k + 1}`]);
          const all = [...TERRAINS.map(t => [t, TERRAIN_WORD[t]]), ...zs, ['party', SIDE_WORD.party], ['foe', SIDE_WORD.foe], ['erase', 'Erase']];
          $('[data-brushes]').innerHTML = all.map(([v, l]) => `<button type="button" data-brush="${esc(v)}" aria-pressed="${v === brush}">${esc(l)}</button>`).join('')
            + (st.zones.length < MAX_ZONES ? '<button type="button" class="quiet" data-newzone>New field</button>' : '');
        }
        function drawZone() {
          const box = $('[data-zonebox]'), z = brush.startsWith('zone:') ? st.zones[zoneAt] : null;
          box.hidden = !z; if (!z) { eff = null; box.innerHTML = ''; return; }
          box.innerHTML = `<div class="mpm-zrow"><label class="field"><span class="lbl">Field name</span><input type="text" maxlength="40" data-zname value="${esc(z.name)}"></label>
            <button type="button" class="danger" data-delzone>Remove field</button></div><div class="lbl">What it does to whoever stands in it</div><div data-zfx></div>`;
          eff = M.effects($('[data-zfx]'), { ops: z.ops, kind: 'status' });
        }
        function paint(i) {
          if (i < 0 || i >= st.w * st.h) return;
          const drop = () => { st.starts.party = st.starts.party.filter(x => x !== i); st.starts.foe = st.starts.foe.filter(x => x !== i); };
          // a start on a tile no body stands on is dropped by the parser at Save, not here
          const t = oneOf(brush, TERRAINS, null);
          if (t) st.tiles[i] = TERRAIN[t].char;
          else if (brush.startsWith('zone:')) st.zones[zoneAt]?.tiles.add(i);
          else if (brush === 'party' || brush === 'foe') { drop(); if (st.starts[brush].length < MAP_BOUNDS.starts) st.starts[brush].push(i); }
          else { st.tiles[i] = TERRAIN.floor.char; st.zones.forEach(z => z.tiles.delete(i)); drop(); }
          paintCell(i);
        }
        /** The map at a new size: each tile, zone tile and start keeps its place; what falls off the edge is gone. */
        function resize(w, h) {
          const old = st.w, at = i => ({ x: i % old, y: Math.floor(i / old) }), to = p => (p.x < w && p.y < h ? p.y * w + p.x : -1);
          const tiles = Array.from({ length: w * h }, (_, i) => { const x = i % w, y = Math.floor(i / w); return x < st.w && y < st.h ? st.tiles[y * st.w + x] : TERRAIN.floor.char; });
          st.zones.forEach(z => { z.tiles = new Set([...z.tiles].map(i => to(at(i))).filter(i => i >= 0)); });
          st.starts = { party: st.starts.party.map(i => to(at(i))).filter(i => i >= 0), foe: st.starts.foe.map(i => to(at(i))).filter(i => i >= 0) };
          st.tiles = tiles; st.w = w; st.h = h;
          drawGrid();
        }
        drawGrid(); drawBrushes(); drawZone();

        const cellAt = ev => { const t = document.elementFromPoint(ev.clientX, ev.clientY); const c = t && t.closest && t.closest('[data-i]'); return c && grid.contains(c) ? Number(c.dataset.i) : -1; };
        grid.addEventListener('pointerdown', ev => { painting = true; try { grid.setPointerCapture(ev.pointerId); } catch { /* the pointer already lifted: its pointerup ends the stroke */ } paint(cellAt(ev)); });
        grid.addEventListener('pointermove', ev => { if (painting) paint(cellAt(ev)); });
        const stopPaint = () => { if (painting) { painting = false; shell.changed(); } };
        grid.addEventListener('pointerup', stopPaint); grid.addEventListener('pointercancel', stopPaint);
        el.addEventListener('click', ev => {
          const b = ev.target.closest('button'); if (!b || !el.contains(b)) return;
          if (b.dataset.step) {
            const k = b.dataset.step, n = Math.max(MAP_BOUNDS.size[0], Math.min(MAP_BOUNDS.size[1], st[k] + Number(b.dataset.d)));
            if (n !== st[k]) resize(k === 'w' ? n : st.w, k === 'h' ? n : st.h);
          } else if (b.dataset.brush) {
            brush = b.dataset.brush; if (brush.startsWith('zone:')) zoneAt = Number(brush.slice(5));
            drawBrushes(); drawZone();
          } else if (b.hasAttribute('data-newzone')) {
            st.zones.push({ id: `z${Date.now().toString(36)}${st.zones.length}`, name: `Field ${st.zones.length + 1}`, ops: [{ op: 'damage', type: 'magical', amount: { kind: 'number', value: 3 } }], tiles: new Set() });
            zoneAt = st.zones.length - 1; brush = `zone:${zoneAt}`; drawBrushes(); drawZone();
          } else if (b.hasAttribute('data-delzone')) {
            st.zones.splice(zoneAt, 1); brush = 'wall'; drawBrushes(); drawZone(); drawGrid();
          } else if (b.hasAttribute('data-asnew')) { const map = saveAs(store.id('mp')); if (map) shell.done(map); return; }
          shell.changed();
        });
        el.addEventListener('input', ev => {
          const t = ev.target;
          if (t.matches('[data-name]')) st.name = t.value;
          else if (t.matches('[data-zname]') && st.zones[zoneAt]) { st.zones[zoneAt].name = t.value; drawBrushes(); }
          else if (t.matches('[data-sight]')) st.sight = Number(t.value);
          if (eff && t.closest('[data-zfx]') && st.zones[zoneAt]) st.zones[zoneAt].ops = eff.ops();
        });
        el.addEventListener('change', ev => {
          const t = ev.target;
          if (t.matches('[data-fog]')) st.fog = t.checked;
          if (eff && t.closest('[data-zfx]') && st.zones[zoneAt]) { st.zones[zoneAt].ops = eff.ops(); for (const i of st.zones[zoneAt].tiles) paintCell(i); }
        });
        /** The map the form holds under `id`, as the parser reads it. */
        const raw = id => ({
          id, name: st.name, w: st.w, h: st.h, tiles: st.tiles.join(''), fog: st.fog, sight: st.sight,
          zones: st.zones.filter(z => z.tiles.size).map(z => ({ id: z.id, name: z.name.trim() || 'Field', ops: z.ops, ground: { kind: 'tiles', tiles: [...z.tiles].sort((a, b) => a - b).map(i => ({ x: i % st.w, y: Math.floor(i / st.w) })) } })),
          starts: { party: st.starts.party.map(i => ({ x: i % st.w, y: Math.floor(i / st.w) })), foe: st.starts.foe.map(i => ({ x: i % st.w, y: Math.floor(i / st.w) })) },
        });
        /**
         * Saves the form as map `id` (the map being edited, or a new one): answers the map saved, or undefined when it was
         * refused, which the window says and stays open for.
         */
        function saveAs(id) {
          const map = parseBattleMap(raw(id), app.rules());
          if (!map) { shell.error('Name the map.'); return undefined; }
          // a write refused (the library full, another tab took over, a newer save) saved nothing: the maker stays open and says so
          if (!ui.wrote('Workshop', store.apply('library-map', atLibrary(l => saveById(l, 'maps', map))), savedWords('map', map.name))) return undefined;
          return map;
        }
        return {
          preview: () => {
            const n = c => st.tiles.filter(x => x === TERRAIN[c].char).length, read = parseBattleMap({ ...raw(''), name: st.name || 'x' }, app.rules());
            const ground = TERRAINS.filter(t => t !== 'floor' && n(t)).map(t => `${n(t)} ${TERRAIN_WORD[t].toLowerCase()}`);
            return [
              `${st.w} by ${st.h} tiles${ground.length ? `: ${ground.join(', ')}` : ', all floor'}`,
              ...st.zones.filter(z => z.tiles.size).map(z => `${z.name || 'Field'}: ${z.tiles.size} tile${z.tiles.size === 1 ? '' : 's'}, ${(app.api.effects.describe({ label: z.name, desc: '', ops: z.ops }) || []).join('; ') || 'does nothing'}`),
              `Starts: ${read.starts.party.length} for the party, ${read.starts.foe.length} for foes${read.starts.party.length + read.starts.foe.length ? '' : ' (the default lines)'}`,
              st.fog ? `Fog of war, sight ${st.sight} tiles` : 'No fog: the party sees the whole map',
            ];
          },
          blocked: () => !st.name.trim() || !!(eff && eff.blocked()),
          save: () => saveAs(m ? m.id : store.id('mp')),
        };
      },
    });
  }

  app.api.maps = {
    list: () => list(),
    get: id => list().find(m => m.id === id) || null,
    make,
    remove: id => ui.wrote('Workshop', store.apply('library-map-del', atLibrary(l => removeEntry(l, 'maps', id)))),
  };
}
