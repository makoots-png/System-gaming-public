// map.js: the battle map, one component for the GM's fight screen (combat.js) and a player's HUD (table.js). Publishes
// app.api.map. It draws the `MapScene` of src/core/combat/map-view.ts and sends nothing itself: what is reachable, what
// an ability covers, who is in it and what a tap does all come from core, and each command goes back to the phone's own
// fight screen through its `MapSource` (src/core/api.ts). Three machines of core hold what the map is doing: its life on
// the page (src/core/combat/map-mount.ts: blank, opening a fight, framed, gone), the gesture (src/core/combat/gesture.ts:
// a tap, a pan, a pinch, the GM's drag and paint) and the choice (`choose` in map-view.ts: select, pick, aim, confirm).
// This file feeds them the page's events as data and carries out what they answer. The screen that mounts a map calls
// its `destroy` when it takes the map's box off the page. Its own
// arithmetic is tiles to pixels and back. Tokens are buttons in one transformed layer, the shaded tiles a layer under
// them; both update in place (src/views/patch.ts) and every move is one of src/views/motion.ts.
import { NO_CHOICE, choose, hotbar, mapScene } from '../core/combat/map-view.ts';
import { IDLE, MAX_ZOOM, gesture, zoomAbout } from '../core/combat/gesture.ts';
import { BLANK, mapMount } from '../core/combat/map-mount.ts';
import { place } from '../core/combat/space.ts';
import * as motion from './motion.ts';
import { bind, keyed } from './patch.ts';
import { icon, iconHref, sprite } from './icons.ts';

/** Pixels in a tile at zoom 1: a thumb's width at the zoom a fight opens at. */
const TILE = 40;
/** The farthest zoom the map opens at: a token 44 pixels across, a thumb's target. */
const MIN_FIT = 44 / TILE;
/** Below this zoom the names on the ground are left out: their 12 px would draw smaller than 12. */
const NAMES_FROM = 1;
/** Half the widest words at an intent's end, in pixels of the world: they are kept this far inside the grid's sides. */
const SAY_HALF = 75;
/** The strip, in tiles, the map leaves beyond the grid's edge when it frames: room for a name under an edge token. */
const EDGE = 0.5;
/** The least height of the map's frame on a phone, when the screen has little room left under the header. */
const FRAME_MIN = 200;

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { ui, store } = app;
  const { esc } = ui;
  const toast = msg => ui.news(msg, 'warning');
  const D = () => app.api.detail;
  sprite();
  /** The count of maps mounted, for each one's own detail list (two maps on one page never share an open detail). */
  let mounts = 0;

  ui.css('map', `
.mp{display:flex;flex-direction:column;gap:8px;min-width:0}
.mp-order{list-style:none;margin:0;padding:0;display:flex;gap:6px;overflow:hidden;white-space:nowrap;font-size:13px;color:var(--cyan-dim);min-height:24px;align-items:center}
.mp-order li{flex:0 0 auto;max-width:9em;display:flex;align-items:center;gap:3px;min-width:0}
.mp-order li span{overflow:hidden;text-overflow:ellipsis}
.mp-order .ic{--ic:var(--icon-order)}
.mp-order li+li::before{content:"→ ";color:var(--muted)}
.mp-order li.now{color:var(--cyan);font-weight:700}
.mp-order li.stag{color:var(--gold)}
.mp-stage{position:relative}
.mp-frame{position:relative;height:clamp(240px,calc(100dvh - 400px),460px);overflow:hidden;touch-action:none;border:1px solid var(--line);background:var(--ground);user-select:none;-webkit-user-select:none;cursor:grab}
.mp-frame::after{content:"";position:absolute;inset:0;pointer-events:none;z-index:2;background:radial-gradient(ellipse 75% 70% at 50% 50%,transparent 55%,color-mix(in srgb,var(--ground) 70%,transparent) 100%)}
.mp-frame.panning{cursor:grabbing}
.mp-world{position:absolute;left:0;top:0;transform-origin:0 0;contain:layout style}
.mp-floor{position:absolute;inset:0;background-color:color-mix(in srgb,var(--cyan) 3%,transparent);background-image:radial-gradient(circle at center,color-mix(in srgb,var(--cyan) 26%,transparent) 0 1.1px,transparent 1.7px);background-size:${TILE}px ${TILE}px}
.mp-world.grid .mp-floor{background-image:linear-gradient(color-mix(in srgb,var(--cyan) 18%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--cyan) 18%,transparent) 1px,transparent 1px)}
.mp-layer{position:absolute;left:0;top:0;width:0;height:0}
.mp-t{position:absolute;left:0;top:0;width:${TILE}px;height:${TILE}px;pointer-events:none}
.mp-t.wall{background:var(--wall-face)}
.mp-walls{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
.mp-walls path{fill:none;stroke:var(--wall-top);stroke-width:2px;stroke-linejoin:round;fill-rule:evenodd}
.mp-t.cover{background:linear-gradient(var(--wall-top),var(--wall-top)) 0 45%/100% 4px no-repeat,linear-gradient(var(--wall-face),var(--wall-face)) bottom/100% 55% no-repeat;opacity:.85}
.mp-t.rough{background-image:radial-gradient(circle,color-mix(in srgb,var(--muted) 55%,transparent) 0 1px,transparent 1.6px);background-size:25% 25%;background-position:3px 4px}
.mp-t.pit{background:color-mix(in srgb,var(--ground) 70%,var(--panel-solid));box-shadow:inset 0 0 10px 3px var(--ground)}
.mp-zones,.mp-fog{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
.mp-zones{will-change:opacity}
.mp-zone{fill-rule:evenodd;stroke-linejoin:round;--zc:var(--muted);fill:color-mix(in srgb,var(--zc) 24%,transparent);stroke:color-mix(in srgb,var(--zc) 70%,transparent);stroke-width:2px;stroke-dasharray:7 5}
.mp-zone.harm,.mp-zl.harm{--zc:var(--red)}.mp-zone.help,.mp-zl.help{--zc:var(--green)}.mp-zone.hinder,.mp-zl.hinder{--zc:var(--purple)}
.mp-zone.mp-zedge{fill:none;stroke:var(--zc);stroke-dasharray:none}
.mp-zl{position:absolute;left:0;top:0;width:${TILE}px;height:${TILE}px;display:flex;align-items:center;justify-content:center;pointer-events:none;--zc:var(--muted)}
.mp-zl span{white-space:nowrap;font:700 12px/16px var(--font-body);padding:0 5px;border-radius:4px;color:color-mix(in srgb,var(--zc) 45%,var(--ice));background:color-mix(in srgb,var(--ground) 72%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--zc) 50%,transparent)}
.mp-world.far .mp-zl,.mp-world.far .mp-name,.mp-world.far .mp-say{display:none}
.mp-fog{filter:blur(2.5px)}
/* the ground (floor, terrain, walls, zones, fog) under the tokens. Not a composited layer of its own: measured twenty runs
   each at 4x, a use's worst frame was 100 ms twice with one and 83.4 at most without (docs/agent-handoff/final/notes-final.md) */
.mp-ground{position:absolute;inset:0}
.mp-fog path{fill-rule:evenodd}
.mp-fog{--mist:color-mix(in srgb,var(--muted) 26%,var(--ground))}
.mp-fog .dim{fill:color-mix(in srgb,var(--mist) 62%,transparent)}
.mp-fog.gm .dim{fill:color-mix(in srgb,var(--mist) 40%,transparent)}
.mp-fog .dark{fill:var(--mist)}
.mp-tok.hidden{opacity:.45}
.mp-shades{position:absolute;left:0;top:0;overflow:visible;pointer-events:none;filter:blur(1.4px)}
.mp-sh{fill-rule:evenodd;stroke-linejoin:round;--sc:var(--cyan)}
.mp-sh.hostile{--sc:var(--warm)}.mp-sh.helpful{--sc:var(--green)}
.mp-sh.stride{fill:color-mix(in srgb,var(--sc) 20%,transparent);stroke:color-mix(in srgb,var(--sc) 60%,transparent);stroke-width:1.5px}
.mp-sh.dash{fill:color-mix(in srgb,var(--sc) 7%,transparent);stroke:color-mix(in srgb,var(--sc) 26%,transparent);stroke-width:1px}
.mp-sh.way{fill:color-mix(in srgb,var(--sc) 34%,transparent);stroke:var(--sc);stroke-width:2px}
.mp-sh.reach{fill:color-mix(in srgb,var(--sc) 8%,transparent);stroke:color-mix(in srgb,var(--sc) 34%,transparent);stroke-width:1.5px}
.mp-sh.ring{fill:color-mix(in srgb,var(--sc) 16%,transparent);stroke:color-mix(in srgb,var(--sc) 55%,transparent);stroke-width:1.5px;stroke-dasharray:5 4}
.mp-sh.splash{fill:color-mix(in srgb,var(--sc) 34%,transparent);stroke:var(--sc);stroke-width:2px}
.mp-ddots{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
.mp-ddot{fill:var(--cyan);stroke:var(--ground);stroke-width:1.5px;opacity:.9}
.mp-ddot.on{fill:var(--gold);stroke:var(--ground);stroke-width:2px;opacity:1}
.mp-tok{position:absolute;left:0;top:0;width:${TILE}px;height:${TILE}px;min-height:0;min-width:0;padding:0;border:none;background:none;display:grid;place-items:center;color:var(--ice)}
.mp-disc{position:relative;width:34px;height:34px;display:grid;place-items:center;border-radius:50%;background:var(--panel,#0a1a2e);font:700 12px/1 var(--font-mono);letter-spacing:.02em}
.mp-tok.foe .mp-disc{border-radius:7px;color:#ffd6da}
.mp-ring{position:absolute;inset:-3px;border-radius:inherit;padding:3px;background:conic-gradient(var(--rc) calc(var(--f,1)*1turn),color-mix(in srgb,var(--rc) 18%,transparent) 0);-webkit-mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0);mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0)}
.mp-tok.party{--rc:var(--cyan)}.mp-tok.foe{--rc:var(--red)}
.mp-tok.now{z-index:1}
.mp-tok.now .mp-disc{transform:translateY(-3px) scale(1.08);box-shadow:0 0 0 2px var(--ground),0 0 0 4px var(--rc),0 0 16px 5px color-mix(in srgb,var(--rc) 60%,transparent)}
.mp-tok.now::before{content:"";position:absolute;left:50%;top:-13px;margin-left:-6px;border:6px solid transparent;border-top:8px solid var(--rc);pointer-events:none}
.mp-name{position:absolute;left:50%;top:calc(100% - 3px);transform:translateX(-50%);box-sizing:border-box;max-width:${TILE}px;padding:0 3px;border-radius:4px;font:600 12px/15px var(--font-body);letter-spacing:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:color-mix(in srgb,var(--ground) 84%,transparent);color:var(--ice);pointer-events:none}
.mp-tok.foe .mp-name{color:#ffd6da}
.mp-tok.mine .mp-name{color:var(--gold)}
.mp-name.above{top:auto;bottom:calc(100% - 3px)}.mp-name.wide{max-width:${3 * TILE}px}
.mp-tok.now .mp-name{background:var(--rc);color:var(--ground)}
.mp-tok.marked .mp-name{display:none}
.mp-tok.down .mp-disc{opacity:.45;transform:scaleY(.6)}
.mp-tok.mine .mp-lbl,.mp-tok.mine .mp-ic{color:var(--gold)}
.mp-ic{--ic:var(--icon-token)}
/* a pack's letter in the disc's lower corner, over the picture's corner (a silhouette's corners are its emptiest) */
.mp-pk{position:absolute;right:-3px;bottom:-3px;min-width:14px;height:15px;padding:0 2px;border-radius:4px;font:700 12px/15px var(--font-body);text-align:center;background:var(--ground);box-shadow:0 0 0 1px var(--rc);pointer-events:none}
.mp-world{--tc:var(--warm)}.mp-world[data-tone=helpful]{--tc:var(--green)}
.mp-tok.tgt .mp-disc{transform:translateY(-3px) scale(1.06);box-shadow:0 0 0 2px var(--tc),0 4px 12px color-mix(in srgb,var(--tc) 45%,transparent)}
.mp-tok.dim{opacity:.38}
.mp-tok.hit .mp-disc{box-shadow:0 0 0 3px var(--tc),0 0 14px var(--tc)}
.mp-tok.ring .mp-disc{box-shadow:0 0 0 2px color-mix(in srgb,var(--tc) 60%,transparent)}
.mp-mark{position:absolute;left:50%;bottom:-7px;transform:translateX(-50%);font:700 9px/1 var(--font-body);letter-spacing:.06em;text-transform:uppercase;padding:2px 4px;border-radius:3px;background:var(--tc);color:var(--ground);white-space:nowrap;pointer-events:none}
.mp-mark.above{bottom:auto;top:-7px}.mp-mark.edge{background:color-mix(in srgb,var(--tc) 55%,var(--ground));color:var(--ice)}
.mp-tok.lifted{z-index:2}.mp-tok.lifted .mp-disc{transform:scale(1.2);box-shadow:0 8px 18px rgba(0,0,0,.5)}
.mp-shield{position:absolute;inset:-7px;border-radius:inherit;padding:2px;background:conic-gradient(color-mix(in srgb,var(--ice) 75%,transparent) calc(var(--sh,1)*1turn),transparent 0);-webkit-mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0);mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0);pointer-events:none}
.mp-stag{position:absolute;inset:4px;border-radius:inherit;padding:2px;background:conic-gradient(var(--gold) calc(var(--st,0)*1turn),color-mix(in srgb,var(--gold) 16%,transparent) 0);-webkit-mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0);mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0);pointer-events:none;opacity:.9}
.mp-tok.staggered .mp-disc{box-shadow:0 0 0 2px var(--gold),0 0 12px color-mix(in srgb,var(--gold) 60%,transparent)}
.mp-pips{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none}
.mp-pips i{position:absolute;left:-3px;top:-3px;width:6px;height:6px;border-radius:50%;background:color-mix(in srgb,var(--mp) 25%,var(--ground));box-shadow:0 0 0 1px color-mix(in srgb,var(--mp) 60%,transparent);transform:rotate(calc(var(--i)*360deg/var(--n) - 90deg)) translateX(23px)}
.mp-pips i.on{background:var(--mp);box-shadow:0 0 6px var(--mp)}
.mp-pips.broken i.on{background:var(--gold);box-shadow:0 0 6px var(--gold)}
.mp-taunt{position:absolute;left:-4px;top:-4px;min-width:14px;height:14px;padding:0 3px;border-radius:7px;background:var(--gold);color:var(--ground);font:800 10px/14px var(--font-body);text-align:center;pointer-events:none}
.mp-lines{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
.mp-ln{stroke-linecap:round;fill:none}
.mp-ln.intent{stroke:var(--warm);stroke-width:2.5px;stroke-dasharray:8 6;opacity:.9}
.mp-ln.suggest{stroke:color-mix(in srgb,var(--muted) 70%,transparent);stroke-width:1.5px;stroke-dasharray:2 6}
.mp-ln.area{fill:none;stroke:color-mix(in srgb,var(--warm) 75%,transparent);stroke-width:1.5px;stroke-dasharray:6 5}
.mp-ln.end{fill:var(--warm);stroke:var(--ground);stroke-width:1.5px}
.mp-hb .ans{color:var(--warm);font-weight:700;white-space:nowrap}
.mp-ln.omen{stroke:var(--red);stroke-width:2.5px;stroke-dasharray:3 5;opacity:.95}
[data-kind=omen] .mp-ln.area{fill:color-mix(in srgb,var(--red) 22%,transparent);stroke:var(--red);stroke-width:2px;stroke-dasharray:7 5}
[data-kind=omen] .mp-ln.end{fill:var(--red)}
.mp-says{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none}
.mp-say{position:absolute;left:0;top:0;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;max-width:150px;padding:2px 6px;border-radius:5px;border:1px solid color-mix(in srgb,var(--warm) 70%,transparent);background:color-mix(in srgb,var(--ground) 90%,transparent);font:600 12px/15px var(--font-body);color:var(--ice);white-space:nowrap}
.mp-say b{color:var(--warm);max-width:138px;overflow:hidden;text-overflow:ellipsis}
.mp-say span{max-width:138px;overflow:hidden;text-overflow:ellipsis;color:var(--cyan-dim)}
.mp-hb.pass{flex:0 0 84px;width:84px}
.mp-hb.release{border-color:var(--mp);color:var(--ice);background:color-mix(in srgb,var(--mp) 22%,transparent);flex-basis:150px;width:150px}
.mp-dot{position:absolute;right:-2px;top:-2px;width:9px;height:9px;border-radius:50%;background:var(--purple);box-shadow:0 0 0 2px var(--ground)}
.mp-num{position:absolute;left:0;top:0;width:${TILE}px;text-align:center;font:700 15px/1 var(--font-mono);color:#ff8a96;pointer-events:none;text-shadow:0 1px 2px #000}
.mp-num.heal{color:#4dff9d}.mp-num.shield{color:var(--ice);opacity:.85}
.mp-blast{position:absolute;left:0;top:0;border-radius:50%;border:2px solid var(--red);pointer-events:none}
.mp-tools{position:absolute;right:6px;top:6px;z-index:3;display:flex;gap:6px}
.mp-news{position:absolute;left:6px;right:6px;top:calc(var(--control-h) + 12px);z-index:3;margin:0;padding:6px 10px;pointer-events:none;font-size:13px;line-height:1.35;color:var(--ice);background:color-mix(in srgb,var(--ground) 88%,transparent);border:1px solid var(--line);border-left:3px solid var(--cyan)}
.mp-news.warning{border-left-color:var(--red)}.mp-news.good{border-left-color:var(--green)}
.mp-seenas{position:absolute;left:6px;top:6px;z-index:3;margin:0;padding:4px 10px;max-width:calc(100% - 150px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;font-size:13px;color:var(--warm);background:color-mix(in srgb,var(--ground) 88%,transparent);border:1px solid var(--line)}
.mp-sending{position:absolute;left:6px;bottom:6px;z-index:3;margin:0;padding:4px 10px;pointer-events:none;font-size:13px;color:var(--ice);background:color-mix(in srgb,var(--ground) 88%,transparent);border:1px solid var(--line)}
.mp-tog{min-height:var(--control-h);min-width:var(--control-h);padding:0 10px;font-size:13px;background:color-mix(in srgb,var(--ground) 80%,transparent)}
.mp-tog[aria-pressed=true]{background:var(--cyan);border-color:var(--cyan);color:var(--ground)}
.mp-now{display:flex;gap:10px;align-items:center;min-height:28px;font-size:13px}
.mp-now b{color:var(--ice);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:40%}
.mp-now .bar{flex:1 1 0;height:6px;min-width:30px}
.mp-now small{color:var(--muted);white-space:nowrap}
.mp-dock{position:relative;min-height:28px}
.mp-paint{display:flex;gap:6px;flex-wrap:wrap;padding:4px 0}
.mp-frame.painting{cursor:crosshair}
.mp-confirm{position:absolute;left:0;right:0;bottom:0;z-index:4;display:flex;gap:8px;align-items:center;padding:6px 8px;background:color-mix(in srgb,var(--ground) 92%,transparent);border:1px solid var(--line-bright);box-shadow:0 -6px 18px rgba(0,0,0,.45)}
.mp-confirm p{margin:0;flex:1 1 0;min-width:0;font-size:13px;line-height:1.3;color:var(--ice)}
.mp-confirm button{flex:0 0 auto}
.mp-confirm [data-go]{max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mp-hot{display:flex;gap:6px;padding:2px 0 4px}
.mp-hot[hidden],.mp-confirm[hidden],.mp-paint[hidden],.mp-drawer[hidden]{display:none}
.mp-slots{flex:1 1 0;min-width:0;display:flex;gap:6px;overflow-x:auto;scroll-snap-type:x proximity;overscroll-behavior-x:contain}
.mp-passbox{display:contents}
.mp-slots.cut{-webkit-mask-image:linear-gradient(to right,#000 calc(100% - 32px),transparent);mask-image:linear-gradient(to right,#000 calc(100% - 32px),transparent)}
.mp-hot,.mp-drawer{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
.mp-dt:empty{display:none}
.mp-dt .dt{margin:0;cursor:pointer}
.mp-hb{flex:1 0 72px;width:72px;min-height:calc(var(--control-h) + 10px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:3px 6px;line-height:1.15;scroll-snap-align:start}
.mp-hb span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.mp-hb .ic{--ic:var(--icon-slot)}
.mp-hb small{font-size:12px;color:var(--muted);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mp-hb[aria-pressed=true]{background:var(--cyan);border-color:var(--cyan);color:var(--ground);box-shadow:0 0 14px color-mix(in srgb,var(--cyan) 55%,transparent)}
.mp-hb[aria-pressed=true] small{color:inherit}
.mp-hb:disabled small{color:var(--gold)}
.mp-hb.react small{color:var(--cyan-dim)}
.mp-hb.react.armed{border-color:var(--gold);box-shadow:0 0 12px color-mix(in srgb,var(--gold) 45%,transparent)}
.mp-hb.react.armed small{color:var(--gold)}
.mp-hb.react.spent{opacity:.6}
.mp-sum{position:absolute;right:-4px;top:-4px;min-width:18px;height:18px;padding:0 3px;border-radius:9px;background:var(--purple);color:var(--ground);font:700 12px/18px var(--font-body);text-align:center}
.mp-tok.summon .mp-disc{border-style:dashed}
.mp-drawer{display:flex;flex-direction:column;gap:6px;border:1px solid var(--line);padding:8px}
.mp-drawer li{display:flex;gap:6px;align-items:center}
.mp-drawer ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.mp-drawer .mp-hb{flex:1 1 auto;width:auto;max-width:none;flex-direction:row;justify-content:space-between;min-height:var(--control-h)}
@media (min-width:900px){.mp-frame{height:min(70vh,640px)}}
`);

  /** @type {import('../core/api.ts').MapApi} */
  app.api.map = { mount };

  /**
   * @param {HTMLElement} el
   * @param {import('../core/api.ts').MapSource} src
   * @returns {import('../core/api.ts').MapView}
   */
  function mount(el, src) {
    el.innerHTML = `<div class="mp">
      <ol class="mp-order" aria-label="Turn order"></ol>
      <div class="mp-frame" data-frame>
        <div class="mp-world" data-world><div class="mp-ground"><div class="mp-floor"></div><div class="mp-layer" data-terrain></div><svg class="mp-walls" data-walls aria-hidden="true"></svg><svg class="mp-zones" data-zones aria-hidden="true"></svg><svg class="mp-fog" data-fog aria-hidden="true"></svg></div><div class="mp-layer" data-zlabels aria-hidden="true"></div><svg class="mp-shades" data-area aria-hidden="true"></svg><svg class="mp-ddots" data-ddots aria-hidden="true"></svg><svg class="mp-lines" data-lines aria-hidden="true"></svg><div class="mp-layer" data-tokens></div><div class="mp-says" data-says></div><div class="mp-layer" data-fx></div></div>
        <p class="mp-news" data-news role="status" aria-live="polite" hidden></p>
        <p class="mp-sending" data-sending hidden></p>
        <p class="mp-seenas" data-seenas hidden></p>
        <div class="mp-tools">${src.paint ? '<button type="button" class="mp-tog" data-painttog aria-pressed="false" title="Paint terrain or fields">Paint</button>' : ''}<button type="button" class="mp-tog" data-grid aria-pressed="false" title="Toggle grid lines">Grid</button></div>
      </div>
      <div class="mp-paint seg" data-paint role="group" aria-label="Terrain and field brush" hidden></div>
      <div class="mp-dock"><div class="mp-now" data-now></div>
      <div class="mp-confirm" data-confirm hidden><p data-words role="status"></p><button type="button" data-cancel>Cancel</button><button type="button" class="primary" data-go></button></div></div>
      <div class="mp-dt" data-mapdt></div>
      <div class="mp-hot" data-hot role="toolbar" aria-label="Abilities"><div class="mp-slots" data-slots></div><div class="mp-passbox" data-passbox></div></div>
      <div class="mp-drawer" data-drawer hidden></div>
    </div>`;
    const $ = s => /** @type {HTMLElement} */ (el.querySelector(s));
    /** This map's list in app.api.detail: its open detail is its own. */
    const dtList = `map-${++mounts}`;
    const frame = $('[data-frame]'), world = $('[data-world]'), tokensBox = $('[data-tokens]'), areaBox = /** @type {any} */ (el.querySelector('[data-area]')), fx = $('[data-fx]');
    /** The pan and zoom: the world's offset in the frame in pixels, and its scale. */
    const view = { x: 0, y: 0, s: 1 };
    /** What the map has chosen (map-view.ts `choose`): its one writer is `act`. @type {import('../core/combat/map-view.ts').Choice} */
    let choice = NO_CHOICE;
    /** @type {import('../core/combat/map-view.ts').MapScene | null} */
    let scene = null;
    /** The map's life on the page (map-mount.ts `mapMount`): its one writer is `live`. @type {import('../core/combat/map-mount.ts').MapMount} */
    let life = BLANK;
    /** The kind of area the last draw shaded, so a new one breathes in. */
    let areaSig = '';
    /** The way a token goes in this draw, when the answer to this phone's move came (the choice's `along`). */
    let along = null;
    /** How many times the map has drawn: a tap's own redraw is skipped when the screen's redraw came first. */
    let draws = 0;
    /** Where each token was and its HP, for its slide and the number that rises off it. */
    const was = new Map();
    /**
     * The zones the last scene drew, and the edge each growing field last gained, shown until it grows again (design 4.8).
     * @type {readonly import("../core/combat/map-view.ts").MapZoneIn[]}
     */
    let zonesWas = [];
    const edges = new Map();
    /** The path drawn for each kind of area. */
    const shadeEls = new Map();

    const pos = (x, y) => `translate(${x * TILE}px,${y * TILE}px)`;
    let far = false;
    const apply = () => {
      world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.s})`;
      if (far !== view.s < NAMES_FROM) { far = !far; world.classList.toggle('far', far); }
    };
    /** The tile under a point of the frame (gesture.ts `Pt`), or null off the grid. */
    function tileOf(pt) {
      if (!scene) return null;
      const x = Math.floor((pt.x - view.x) / view.s / TILE), y = Math.floor((pt.y - view.y) / view.s / TILE);
      return x >= 0 && y >= 0 && x < scene.w && y < scene.h ? place(x, y) : null;
    }
    /**
     * Frames the scene's `frame` (the bodies and the walls and zones near them) with a tile of margin round it, at a zoom
     * where a token is a thumb's target at least (`MIN_FIT`) and at most `MAX_ZOOM`. When the box is wider than the screen
     * at that zoom, the body acting (the scene's `anchor`) stays in sight, as near the box's middle as it allows.
     */
    function fit(fw = frame.clientWidth, fh = frame.clientHeight) {
      if (!scene || !fw || !fh) return;
      const b = scene.frame, w = (b.x1 - b.x0 + 3) * TILE, h = (b.y1 - b.y0 + 3) * TILE;
      view.s = Math.max(MIN_FIT, Math.min(MAX_ZOOM, fw / w, fh / h));
      let cx = (b.x0 + b.x1 + 1) / 2, cy = (b.y0 + b.y1 + 1) / 2;
      const a = scene.anchor, hw = Math.max(0, fw / view.s / TILE / 2 - 1), hh = Math.max(0, fh / view.s / TILE / 2 - 1);
      if (a) { cx = Math.min(Math.max(cx, a.x + 0.5 - hw), a.x + 0.5 + hw); cy = Math.min(Math.max(cy, a.y + 0.5 - hh), a.y + 0.5 + hh); }
      view.x = fw / 2 - cx * TILE * view.s;
      view.y = fh / 2 - cy * TILE * view.s;
      // the grid fills the frame where it is big enough to, but for a strip at its edge where a name or a turn's mark on
      // an edge token still shows
      const W = scene.w * TILE * view.s, H = scene.h * TILE * view.s, m = EDGE * TILE * view.s;
      view.x = W + 2 * m > fw ? Math.min(m, Math.max(fw - W - m, view.x)) : (fw - W) / 2;
      view.y = H + 2 * m > fh ? Math.min(m, Math.max(fh - H - m, view.y)) : (fh - H) / 2;
      seen = { fw, fh };
      apply();
    }
    /** The frame's size at the last fit, so a turn's change can tell whether the body acting is in sight without a layout. */
    let seen = { fw: 0, fh: 0 };
    /** Whether tile `p` is wholly inside the frame as last framed. */
    const inSight = p => {
      const x = view.x + p.x * TILE * view.s, y = view.y + p.y * TILE * view.s, d = TILE * view.s;
      return x >= 0 && y >= 0 && x + d <= seen.fw && y + d <= seen.fh;
    };
    /**
     * On a phone the frame takes the height the first screen has left under what is above it, less the dock and the hotbar
     * under it and the bottom bar, so the map and the hotbar show together without a scroll (at least `FRAME_MIN`). A wide
     * screen keeps the stylesheet's height. Read once when the map first frames and again when the window changes size.
     */
    function sizeFrame() {
      if (matchMedia('(min-width:900px)').matches) { frame.style.height = ''; return; }
      const r = frame.getBoundingClientRect(), all = /** @type {HTMLElement} */ (el.firstElementChild).getBoundingClientRect();
      const nav = document.querySelector('.nav-bottom'), nr = nav && nav.getBoundingClientRect();
      const floor = nr && nr.height ? nr.top : innerHeight;
      // the dock and a hotbar of one row under the frame, whether or not the hotbar is drawn yet (a player off turn)
      const below = Math.max(all.bottom - r.bottom, 112);
      frame.style.height = `${Math.max(FRAME_MIN, Math.floor(floor - (r.top + scrollY) - below - 8))}px`;
    }
    /** The frame waiting for the next frame to be worked out again after the window's resize: its request, or 0. */
    let sized = 0;
    const onResize = () => { if (!sized) sized = requestAnimationFrame(() => { sized = 0; live({ kind: 'resized', shown: frame.clientWidth > 0 }); }); };
    addEventListener('resize', onResize);
    /**
     * Gives the map's life the event `e` (map-mount.ts) and carries out what it answers. What the source says stands over
     * the frame (`MapSource.over`) is kept with the framed state: a player's "YOUR TURN" line comes and goes with the
     * turn, and a height worked out without it would push the hotbar under the bottom bar, so new words work the height
     * out again (`reheight`).
     */
    function live(e) {
      const r = mapMount(life, e);
      life = r.mount;
      for (const fx of r.fx) {
        switch (fx.kind) {
          case 'forget':
            clearTimeout(holdTimer); holdTimer = 0; g = IDLE; frame.classList.remove('panning');
            choice = NO_CHOICE; brush = null; along = null; areaSig = '';
            was.clear(); zonesWas = []; edges.clear();
            D().move(dtList, { kind: 'close' }, drawDetail);
            break;
          // the frame's size, read only when the map asks (a draw's own read would lay the page out in the redraw)
          case 'measure': live({ kind: 'sized', shown: frame.clientWidth > 0, over: e.over }); break;
          case 'frame': sizeFrame(); fit(); break;
          case 'reheight': { const h = frame.style.height; sizeFrame(); if (frame.style.height !== h) fit(); break; }
          // at the frame's size as last framed: reading it here would lay the page out in the middle of the redraw
          case 'refit': fit(seen.fw, seen.fh); break;
          case 'stop':
            removeEventListener('resize', onResize); cancelAnimationFrame(sized); sized = 0;
            cutSeen.disconnect(); off(); clearTimeout(holdTimer); holdTimer = 0; clearTimeout(newsTimer); newsTimer = 0;
            D().move(dtList, { kind: 'close' }, () => {});
            el.replaceChildren();
            break;
          default: break;
        }
      }
    }

    // ── the choice: core's `choose` says what an event does, this carries it out ──
    /** Gives the choice event `e` to the choice and carries out what it answers; true when the choice changed. */
    function act(e) {
      const was = choice, r = choose(choice, e);
      choice = r.choice;
      for (const fx of r.fx) {
        switch (fx.kind) {
          case 'card': src.card(fx.id); break;
          case 'zone': D().move(dtList, { kind: 'toggle', key: `zone:${fx.id}` }, drawDetail); break;
          case 'refuse': toast('Out of reach.'); break;
          case 'offTurn': src.offTurn(); break;
          case 'move': src.move(fx.to, fx.dash); break;
          case 'use': {
            src.use(fx.ability, fx.aim);
            const blast = fx.ability.shape.kind === 'radius' ? fx.ability.shape : null;
            if (blast) spreadAt(fx.at, blast.ring ? blast.ring.outer : blast.radius);
            break;
          }
          case 'pass': if (src.pass) src.pass(); break;
          case 'dodge': if (src.dodge) src.dodge(fx.to); break;
          case 'along': along = { id: fx.id, tiles: fx.tiles }; break;
          default: break;
        }
      }
      return choice !== was;
    }
    /** A tap ended a gesture: on a token, the tile that body stands on now; else the tile under the finger as it touched. */
    function tapAt(target) {
      if (!scene) return;
      const p = (target.tok && (scene.tokens.find(t => t.id === target.tok) || { place: null }).place) || target.tile;
      if (p && act({ kind: 'tap', scene, at: p })) draw();
    }
    /**
     * The command's redraw comes in the next frame (a change of the save, or the room's doc), not in the tap's task, so
     * the tap answers at once; a command that changed nothing here (a player's, on its way) is drawn then all the same.
     */
    function redrawSoon() {
      const n = draws;
      requestAnimationFrame(() => { if (draws === n) draw(); });
    }
    /** A blast's ring opens where it landed, to its outer edge. */
    function spreadAt(at, r) {
      const wrap = document.createElement('div'), c = document.createElement('i'), d = (2 * r + 1) * TILE;
      wrap.className = 'mp-layer'; wrap.style.transform = pos(at.x - r, at.y - r);
      c.className = 'mp-blast'; c.style.width = c.style.height = `${d}px`;
      wrap.appendChild(c); fx.appendChild(wrap);
      void motion.spread(c).then(() => wrap.remove());
    }

    // ── the gesture: core's `gesture` says what a finger did on the map or a control, this carries it out ──
    /** @type {import('../core/combat/gesture.ts').Gesture} */
    let g = IDLE;
    /** The frame's place on the page, read when a gesture's first finger touches: the frame does not move under a finger (touch-action none). */
    let box = { left: 0, top: 0 };
    let holdTimer = 0;
    /** The GM's paint mode during a fight: the brush (a terrain, or a zone on the ground to spread), null when off. */
    let brush = null;
    const ptOf = ev => ({ x: ev.clientX - box.left, y: ev.clientY - box.top });
    const tokenAt = ev => { const b = ev.target instanceof Element ? ev.target.closest('[data-tok]') : null; return b && tokensBox.contains(b) ? /** @type {HTMLElement} */ (b) : null; };
    const tokEl = id => /** @type {HTMLElement | null} */ (tokensBox.querySelector(`[data-tok="${CSS.escape(id)}"]`));
    /** A token's button as a target: its body and the tile it stands on as drawn. */
    const targetOf = tok => ({ tok: tok.dataset.tok, tile: place(Number(tok.dataset.x), Number(tok.dataset.y)) });
    const CONTROLS = ['cancel', 'go', 'more', 'release', 'pass'];
    /**
     * The control an element is part of, by its name (gesture.ts `ControlKey`): Grid, Paint, a hotbar slot (`ab:` or
     * `arm:` and its ability), Move or Use (`go`), Cancel, More, a brush, Release, End turn, a Pin, the detail under the
     * map (`dt`); null for a token or anything else. A key's click (`pressing`) leaves out a control that is off.
     */
    function controlOf(t, pressing) {
      if (!(t instanceof Element) || !el.contains(t)) return null;
      if (t.closest('[data-mapdt]')) return 'dt';
      const b = /** @type {any} */ (t.closest('button'));
      if (!b || tokensBox.contains(b) || (pressing && b.disabled)) return null;
      const d = b.dataset;
      if (b.hasAttribute('data-grid')) return 'grid';
      if (b.hasAttribute('data-painttog')) return 'paint';
      if (d.arm) return `arm:${d.arm}`;
      if (d.ab) return `ab:${d.ab}`;
      if (d.pin) return `pin:${d.pin}`;
      if (d.brush) return `brush:${d.brush}`;
      return CONTROLS.find(k => b.hasAttribute(`data-${k}`)) ?? null;
    }
    /** Gives the pointer event `e` to the gesture and carries out what it answers. */
    function feed(e) {
      const r = gesture(g, e);
      g = r.gesture;
      for (const fx of r.fx) {
        switch (fx.kind) {
          // a finger on the map is the frame's, so its clicks and a double tap's dblclick reach the frame; one on a control is the map component's
          case 'capture': try { (g.kind === 'press' ? el : frame).setPointerCapture(fx.id); } catch { /* the pointer is already gone: its cancel follows */ } break;
          case 'timer': clearTimeout(holdTimer); holdTimer = setTimeout(() => { holdTimer = 0; feed({ kind: 'hold' }); }, fx.ms); break;
          case 'untimer': clearTimeout(holdTimer); holdTimer = 0; break;
          case 'view': Object.assign(view, fx.view); apply(); break;
          case 'lift': { const t = tokEl(fx.tok); if (t) t.classList.add('lifted'); break; }
          case 'carry': { const t = tokEl(fx.tok); if (t) t.style.transform = `translate(${(fx.at.x - view.x) / view.s - TILE / 2}px,${(fx.at.y - view.y) / view.s - TILE / 2}px)`; break; }
          case 'putBack': { const t = tokEl(fx.tok); if (t) { t.classList.remove('lifted'); t.style.transform = t.dataset.at || ''; } break; }
          case 'tap': tapAt(fx.target); break;
          case 'press': run(fx.control); break;
          case 'detail': D().move(dtList, { kind: 'toggle', key: `ab:${fx.control.slice(fx.control.indexOf(':') + 1)}` }, drawDetail); break;
          case 'undetail': D().move(dtList, { kind: 'drop', key: `ab:${fx.control.slice(fx.control.indexOf(':') + 1)}` }, drawDetail); break;
          case 'drop': if (src.place) src.place(fx.tok, fx.to); break;
          case 'paint': if (brush && src.paint) src.paint(/** @type {any} */ (fx.tiles), brush.zone ? { zone: brush.zone } : { terrain: brush.terrain }); break;
          default: break;
        }
      }
      frame.classList.toggle('panning', g.kind === 'pan');
    }
    // every press on the map or its controls is one gesture: a control acts at the lift on it, never on the browser's
    // click, which Chrome does not send for a tap right after a touch pan
    el.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return; // a secondary button is the page's (its menu)
      const control = controlOf(ev.target, false);
      if (!control && !(ev.target instanceof Element && frame.contains(ev.target))) return;
      if (g.kind === 'idle') box = frame.getBoundingClientRect();
      const at = ptOf(ev), tok = control ? null : tokenAt(ev);
      const cb = control ? /** @type {any} */ (/** @type {Element} */ (ev.target).closest('button, [data-mapdt]')) : null, cr = cb ? cb.getBoundingClientRect() : null;
      const press = control
        ? { on: 'control', control, area: { x0: cr.left - box.left, y0: cr.top - box.top, x1: cr.right - box.left, y1: cr.bottom - box.top }, off: !!cb.disabled, hold: control.startsWith('ab:') || control.startsWith('arm:') ? motion.ms('hold') : null }
        : { on: 'map', mode: scene && scene.focus.kind === 'dodge' ? 'look' : brush ? 'paint' : src.place ? 'arrange' : 'look', target: tok ? targetOf(tok) : { tok: null, tile: tileOf(at) } };
      feed({ kind: 'down', id: ev.pointerId, t: ev.timeStamp, at, view: { ...view }, press: /** @type {any} */ (press) });
    });
    el.addEventListener('pointermove', ev => { if (g.kind !== 'idle') { const at = ptOf(ev); feed({ kind: 'move', id: ev.pointerId, t: ev.timeStamp, at, tile: tileOf(at) }); } });
    el.addEventListener('pointerup', ev => {
      if (g.kind === 'idle') return;
      const at = ptOf(ev);
      feed({ kind: 'up', id: ev.pointerId, t: ev.timeStamp, at, tile: tileOf(at) });
    });
    // the browser took the finger (a scroll of the hotbar), or the map lost it (hidden or taken off the page)
    el.addEventListener('pointercancel', ev => feed({ kind: 'cancel', id: ev.pointerId, t: ev.timeStamp }));
    el.addEventListener('lostpointercapture', ev => { if (ev.target === el || ev.target === frame) feed({ kind: 'cancel', id: ev.pointerId, t: ev.timeStamp }); });
    // a pointer's click was its gesture's and acted at the lift; only a click with no press behind it (a key) acts here
    el.addEventListener('click', ev => {
      if (ev.detail !== 0) return;
      const control = controlOf(ev.target, true), tok = control ? null : tokenAt(ev);
      if (control) run(control); else if (tok) tapAt(targetOf(tok));
    });
    el.addEventListener('contextmenu', ev => { if (ev.target instanceof Element && ev.target.closest('[data-ab],[data-arm]')) ev.preventDefault(); });
    // a double tap frames the fight and selects nothing: what its two taps chose is put back
    frame.addEventListener('dblclick', () => { if (act({ kind: 'double' })) draw(); fit(); });
    frame.addEventListener('wheel', /** @param {WheelEvent} ev */ ev => {
      ev.preventDefault();
      const r = frame.getBoundingClientRect();
      Object.assign(view, zoomAbout(view, { x: ev.clientX - r.left, y: ev.clientY - r.top }, view.s * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)));
      apply();
    }, { passive: false });

    /** What a control does when it is pressed (at the lift on it) or clicked with a key. */
    function run(control) {
      const i = control.indexOf(':'), kind = i < 0 ? control : control.slice(0, i), arg = i < 0 ? '' : control.slice(i + 1);
      switch (kind) {
        case 'grid': store.setPrefs({ mapGrid: !store.prefs().mapGrid }); draw(); return;
        case 'paint': brush = brush ? null : { terrain: 'wall', zone: null }; act({ kind: 'cancel' }); draw(); return;
        // a reaction on the hotbar arms, or disarms when it is the one armed; it is never aimed (kits design 8.4.2)
        case 'arm': { const k = src.kit(); if (k) src.arm(k.armed && k.armed.ability === arg ? null : /** @type {any} */ (arg)); redrawSoon(); return; }
        case 'cancel': act({ kind: 'cancel' }); draw(); return;
        case 'go': if (scene) act({ kind: 'go', scene }); redrawSoon(); return;
        case 'more': act({ kind: 'more' }); draw(); return;
        case 'brush': { const [k, v] = arg.split(':'); brush = k === 'zone' ? { terrain: null, zone: v } : { terrain: v, zone: null }; draw(); return; }
        case 'release': if (scene && scene.actor) { src.release(); redrawSoon(); } else src.offTurn(); return;
        case 'pass': if (scene) act({ kind: 'pass', scene }); redrawSoon(); return;
        case 'pin': pin(arg); return;
        case 'ab': pick(arg); return;
        case 'dt': D().move(dtList, { kind: 'close' }, drawDetail); return;
        default: return;
      }
    }
    /** An ability from the hotbar: its reach and targets show (a self ability is aimed at once); a second tap puts it down. */
    function pick(id) {
      D().move(dtList, { kind: 'close' }, drawDetail);
      const k = src.kit(), a = k && k.list.find(x => x.id === id);
      if (scene && a && act({ kind: 'pick', scene, ability: a })) draw();
    }
    function pin(id) {
      const k = src.kit(); if (!k) return;
      const all = store.prefs().pins, now = all[k.pinKey] ?? hotbar(k.list, k.readyAt, k.now, k.costCut, null, app.rules()).bar.filter(s => s.pinned).map(s => s.id);
      const next = now.includes(id) ? now.filter(x => x !== id) : [...now, id];
      store.setPrefs({ pins: { ...all, [k.pinKey]: next } });
      draw();
    }

    // ── more info: a zone tapped, or an ability held on the hotbar, opens its detail under the map (app.api.detail) ──
    /** @returns {import('../core/detail.ts').Thing | null} */
    function thingOf(key) {
      const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
      if (kind === 'ab') { const k = src.kit(), a = k && k.list.find(x => x.id === id); return a ? { kind: 'ability', ability: a } : null; }
      const z = scene && scene.zones.find(x => x.id === id);
      return z ? { kind: 'zone', name: z.name, tone: z.tone, left: z.left, ops: z.ops ?? null, tier: z.tier ?? 0 } : null;
    }
    /** The map's open detail (its list `dtList` of app.api.detail: `ab:<ability id>` or `zone:<zone id>`) under the map. */
    function drawDetail() {
      const key = D().openIn(dtList), box = $('[data-mapdt]'), html = key ? D().panel(dtList, key, () => thingOf(key), true) : '';
      if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; }
    }

    // ── drawing ──
    const tokTemplate = () => ui.h(`<button type="button" class="mp-tok" data-attr="class:cls aria-label:label data-tok:id data-x:x data-y:y"><span class="mp-disc"><span class="mp-shield" data-attr="style:shield hidden:noShield"></span><span class="mp-ring" data-attr="style:ring"></span><span class="mp-stag" data-attr="style:stag hidden:noStag"></span><span class="mp-lbl" data-text="lbl" data-attr="hidden:hasIcon"></span><svg class="ic mp-ic" aria-hidden="true" focusable="false" data-attr="hidden:noIcon"><use data-attr="href:href"></use></svg><b class="mp-pk" data-text="letter" data-attr="hidden:noLetter" aria-hidden="true"></b><i class="mp-dot" data-attr="hidden:noDot"></i><span class="mp-taunt" data-attr="hidden:noTaunt" aria-hidden="true">!</span><span class="slot" data-part="pips"></span><span class="mp-sum" data-attr="hidden:noSum" data-text="sum" aria-hidden="true"></span></span><span data-attr="class:nameCls hidden:noName" data-text="name"></span><span data-attr="class:markCls hidden:noMark" data-text="mark"></span></button>`);
    function tokDesc(t, f) {
      const aim = f.kind === 'aim' ? f : null, inHit = aim && aim.aim && aim.aim.hit.includes(t.id), inRing = aim && aim.aim && aim.aim.ringed.includes(t.id);
      const area = aim && aim.ability.aim === 'place', can = aim && !area && aim.targets.includes(t.id), dim = aim && !area && !can && t.id !== scene.actor;
      const mark = area && inHit ? 'Caught' : area && inRing ? 'Outer ring' : '', x = t.extras;
      const hp = t.ring.band ? t.ring.band : t.bars ? `HP ${t.bars.hp[0]} of ${t.bars.hp[1]}` : '';
      return {
        id: t.id, x: t.place.x, y: t.place.y, lbl: t.label, hasIcon: !!t.icon, noIcon: !t.icon, href: t.icon ? iconHref(t.icon) : null, letter: t.letter ?? '', noLetter: !t.letter, name: t.plate ? t.plate.text : '', noName: !t.plate, nameCls: t.plate ? `mp-name ${t.plate.side}${t.plate.span === 3 ? ' wide' : ''}` : 'mp-name', noDot: !t.statuses, ring: `--f:${t.ring.share.toFixed(3)}`,
        noSum: !(t.summon && t.summon.left !== null), sum: t.summon && t.summon.left !== null ? String(Math.ceil(t.summon.left)) : '',
        mark, noMark: !mark, markCls: `mp-mark${inRing && !inHit ? ' edge' : ''}${t.plate && t.plate.side === 'above' ? ' above' : ''}`,
        shield: x.shield === null ? '' : `--sh:${x.shield.toFixed(3)}`, noShield: x.shield === null,
        stag: x.stagger ? `--st:${x.stagger.share.toFixed(3)}` : '', noStag: !x.stagger, noTaunt: !x.taunted,
        pips: x.channel ? `<span class="mp-pips${x.channel.state === 'broken' ? ' broken' : ''}" style="--n:${x.channel.max}">${Array.from({ length: x.channel.max }, (_, i) => `<i style="--i:${i}"${i < x.channel.charge ? ' class="on"' : ''}></i>`).join('')}</span>` : '',
        cls: `mp-tok ${t.side}${t.summon ? ' summon' : ''}${t.hidden ? ' hidden' : ''}${t.current ? ' now' : ''}${t.down ? ' down' : ''}${t.mine ? ' mine' : ''}${can ? ' tgt' : ''}${dim ? ' dim' : ''}${inHit ? ' hit' : inRing ? ' ring' : ''}${x.stagger && x.stagger.staggered ? ' staggered' : ''}${mark ? ' marked' : ''}`,
        label: `${t.name}, ${hp}${t.hidden ? (t.side === 'foe' ? ', unseen by the party' : ', unseen by its foes') : ''}${t.word ? `, ${t.word}` : ''}${t.current ? ', their turn' : ''}${t.statuses ? ', has statuses' : ''}${x.shield !== null ? ', shielded' : ''}${x.stagger && x.stagger.staggered ? ', staggered' : ''}${x.channel ? `, channeling ${x.channel.charge} of ${x.channel.max}` : ''}${x.taunted ? ', taunted' : ''}${t.summon ? `, ${t.summon.owner ? `${t.summon.owner}'s ` : ''}summon${t.summon.left !== null ? `, ${t.summon.left} round${t.summon.left === 1 ? '' : 's'} left` : ''}` : ''}${x.reacted ? ', reacted' : ''}`,
      };
    }
    function drawTokens(f) {
      const els = keyed(tokensBox, scene.tokens.map(t => t.id), tokTemplate);
      scene.tokens.forEach((t, i) => {
        const node = els[i], w = was.get(t.id);
        bind(node, tokDesc(t, f));
        const at = pos(t.place.x, t.place.y);
        if (!node.classList.contains('lifted') && node.dataset.at !== at) {
          node.dataset.at = at; node.style.transform = at;
          if (w && (w.x !== t.place.x || w.y !== t.place.y)) {
            const way = along && along.id === t.id && along.tiles.length && along.tiles[along.tiles.length - 1].x === t.place.x && along.tiles[along.tiles.length - 1].y === t.place.y ? along.tiles : [t.place];
            void motion.along(node, [pos(w.x, w.y), ...way.map(p => pos(p.x, p.y))]);
          }
        }
        const hp = t.bars ? t.bars.hp[0] : null, x = t.extras, sh = x.shield, ch = x.channel;
        const shieldHp = t.bars && sh !== null ? Math.round(sh * t.bars.hp[1]) : null;
        // the shield takes a hit first: what it absorbed rises pale above what reached HP
        if (w && w.shieldHp !== null && shieldHp !== w.shieldHp && (shieldHp ?? 0) < w.shieldHp) rising(t, (shieldHp ?? 0) - w.shieldHp, 'shield', -16);
        if (w && hp !== null && w.hp !== null && hp !== w.hp) rising(t, hp - w.hp);
        else if (w && t.ring.band && w.band && t.ring.band !== w.band) void motion.flash(node, 'red');
        // a stagger breaks: the disc shakes once and a burst plays (the button's own transform is its place); a channel grows:
        // its pips pulse; it breaks or goes off: they burst
        if (w && x.stagger && x.stagger.staggered && !w.staggered) { void motion.shake(node.querySelector('.mp-disc')); void motion.burst('stagger', node); }
        if (w && ch && w.charge !== null && ch.charge > w.charge && ch.state === 'holding') { const pips = node.querySelector('.mp-pips'); if (pips) void motion.pop(pips); }
        if (w && ch && ch.state === 'broken' && w.chState === 'holding') void motion.burst('channel', node);
        else if (w && !ch && w.chState) void motion.burst('channel', node);
        // an armed reaction fires: the disc pops and a tight ring of sparks plays (an earned moment, kits design 8.4)
        if (w && x.reacted && !w.reacted) { void motion.pop(node.querySelector('.mp-disc')); void motion.burst('stagger', node); }
        was.set(t.id, { x: t.place.x, y: t.place.y, hp, band: t.ring.band, shieldHp, staggered: !!(x.stagger && x.stagger.staggered), charge: ch ? ch.charge : null, chState: ch ? ch.state : null, reacted: x.reacted });
      });
      for (const id of [...was.keys()]) if (!scene.tokens.some(t => t.id === id)) was.delete(id);
      along = null;
    }
    /** What a hit or a heal did, rising off the token. */
    function rising(t, n, kind = '', dy = 0) {
      const wrap = document.createElement('div'), num = document.createElement('i');
      wrap.className = 'mp-layer'; wrap.style.transform = `translate(${t.place.x * TILE}px,${t.place.y * TILE - 8 + dy}px)`;
      num.className = `mp-num${kind ? ` ${kind}` : n > 0 ? ' heal' : ''}`; num.textContent = n > 0 ? `+${n}` : String(n);
      wrap.appendChild(num); fx.appendChild(wrap);
      void motion.rise(num).then(() => wrap.remove());
    }
    /** The selection's areas (the scene's `shades`): one soft shape per area, its outline the union of its tiles. */
    function drawArea(f) {
      const svg = areaBox, w = scene.w * TILE, h = scene.h * TILE;
      if (svg.getAttribute('width') !== String(w)) { svg.setAttribute('width', String(w)); svg.setAttribute('height', String(h)); }
      // one path per kind of area, in the scene's order (an SVG path is not an HTMLElement, so not patch.ts `keyed`)
      for (const [k, node] of shadeEls) if (!scene.shades.some(x => x.kind === k)) { node.remove(); shadeEls.delete(k); }
      scene.shades.forEach((x, i) => {
        let node = shadeEls.get(x.kind);
        if (!node) { node = document.createElementNS('http://www.w3.org/2000/svg', 'path'); shadeEls.set(x.kind, node); }
        if (svg.children[i] !== node) svg.insertBefore(node, svg.children[i] || null);
        const d = x.loops.map(l => `M${l.map(c => `${c.x * TILE} ${c.y * TILE}`).join('L')}Z`).join(''), c = `mp-sh ${x.kind} ${x.tone}`;
        if (node.getAttribute('d') !== d) node.setAttribute('d', d);
        if (node.getAttribute('class') !== c) { node.setAttribute('class', c); node.dataset.shade = x.kind; }
      });
      // the area breathes in when it is a new one (another kind, another ability), not when a tile of it changes
      const sig = f.kind === 'aim' ? `aim:${f.ability.range}:${f.ability.aim}:${f.ability.shape.kind}` : f.kind === 'dodge' ? `dodge:${f.n}` : f.kind;
      if (sig !== areaSig) { areaSig = sig; if (scene.shades.length) void motion.enter(/** @type {any} */ (svg), 'fade'); }
      const dots = /** @type {any} */ (el.querySelector('[data-ddots]'));
      if (dots.getAttribute('width') !== String(w)) { dots.setAttribute('width', String(w)); dots.setAttribute('height', String(h)); }
      const dhtml = f.kind === 'dodge'
        ? f.tiles.map(p => {
          const on = p.x === f.picked.x && p.y === f.picked.y;
          return `<circle class="mp-ddot${on ? ' on' : ''}" data-dtile="${p.x},${p.y}" cx="${(p.x + 0.5) * TILE}" cy="${(p.y + 0.5) * TILE}" r="${on ? 6 : 4}"/>`;
        }).join('')
        : '';
      if (dots.dataset.sig !== dhtml) { dots.dataset.sig = dhtml; dots.innerHTML = dhtml; }
    }
    /**
     * Each monster's intent as a line to its target (and its area's outline when known), or its threat's suggestion, quieter.
     * A line stops at the edge of the token it aims at, so lines from two sides end apart; lines that meet on one body are
     * set apart sideways, and a revealed intent says its ability and what it does above its target, one over another.
     */
    function drawLines() {
      const svg = /** @type {any} */ (el.querySelector('[data-lines]')), says = $('[data-says]'), w = scene.w * TILE, h = scene.h * TILE, c = p => (p + 0.5) * TILE;
      if (svg.getAttribute('width') !== String(w)) { svg.setAttribute('width', String(w)); svg.setAttribute('height', String(h)); }
      let words = '';
      const html = scene.lines.map(l => {
        const area = l.loops.length ? `<path class="mp-ln area" d="${l.loops.map(lp => `M${lp.map(q => `${q.x * TILE} ${q.y * TILE}`).join('L')}Z`).join('')}"/>` : '';
        const x1 = c(l.at.x), y1 = c(l.at.y), dx = c(l.to.x) - x1, dy = c(l.to.y) - y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
        const side = (l.nth - (l.of - 1) / 2) * 7, back = Math.min(len, TILE * 0.45);
        const x2 = x1 + dx - ux * back - uy * side, y2 = y1 + dy - uy * back + ux * side;
        const end = l.kind !== 'suggest' ? `<circle class="mp-ln end" cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="4"/>` : '';
        // the words sit on the line a tile back from its end, inside the grid; two that meet on one body stack back along it
        const say = Math.min(len - TILE * 0.2, TILE * (1.2 + l.nth * 0.9)), sx = Math.min(Math.max(x1 + ux * (len - say), Math.min(SAY_HALF, w / 2)), Math.max(w - SAY_HALF, w / 2)), sy = Math.min(Math.max(y1 + uy * (len - say), 18), h - 18);
        if (l.words) words += `<div class="mp-say" data-say="${esc(l.from)}" style="transform:translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-50%)"><b>${esc(l.words.name)}</b>${l.words.what ? `<span>${esc(l.words.what)}</span>` : ''}</div>`;
        return `<g data-line="${esc(l.from)}" data-kind="${l.kind}">${area}<line class="mp-ln ${l.kind}" x1="${x1}" y1="${y1}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>${end}</g>`;
      }).join('');
      if (svg.dataset.sig !== html) { const fresh = html.length > (svg.dataset.sig || '').length; svg.dataset.sig = html; svg.innerHTML = html; if (fresh) void motion.enter(svg, 'fade'); }
      if (says.dataset.sig !== words) { says.dataset.sig = words; says.innerHTML = words; }
    }
    const loopsD = loops => loops.map(l => `M${l.map(c => `${c.x * TILE} ${c.y * TILE}`).join('L')}Z`).join('');
    /** The zones on the ground, one soft area each in its tone; the layer breathes slowly while any stays. */
    function drawZones() {
      const svg = /** @type {any} */ (el.querySelector('[data-zones]')), w = scene.w * TILE, h = scene.h * TILE;
      if (svg.getAttribute('width') !== String(w)) { svg.setAttribute('width', String(w)); svg.setAttribute('height', String(h)); }
      const fresh = [];
      for (const z of scene.zones) if (z.grew.length) { edges.set(z.id, z.grew); fresh.push(z.id); }
      for (const id of [...edges.keys()]) if (!scene.zones.some(z => z.id === id)) edges.delete(id);
      zonesWas = scene.zones;
      const html = scene.zones.map(z => `<path class="mp-zone ${z.tone}" data-zone="${esc(z.id)}" d="${loopsD(z.loops)}"/>${edges.has(z.id) ? `<path class="mp-zone mp-zedge ${z.tone}" data-zedge="${esc(z.id)}" d="${loopsD(edges.get(z.id))}"/>` : ''}`).join('');
      // an aura that moved goes along with its body's token, the way the token goes (drawTokens moves the token after this)
      const ways = new Map();
      for (const z of scene.zones) {
        const t = z.anchor ? scene.tokens.find(x => x.id === z.anchor) : null, w = t && was.get(t.id);
        if (!t || !w || (w.x === t.place.x && w.y === t.place.y)) continue;
        const end = along && along.id === t.id && along.tiles.length ? along.tiles[along.tiles.length - 1] : null;
        const way = end && end.x === t.place.x && end.y === t.place.y ? along.tiles : [t.place];
        ways.set(z.id, [w, ...way].map(p => pos(p.x - t.place.x, p.y - t.place.y)));
      }
      if (svg.dataset.sig !== html) {
        svg.dataset.sig = html; svg.innerHTML = html;
        for (const [id, points] of ways) { const node = svg.querySelector(`[data-zone="${CSS.escape(id)}"]`); if (node) void motion.along(node, points); }
        for (const id of fresh) { const e = svg.querySelector(`[data-zedge="${CSS.escape(id)}"]`); if (e) void motion.enter(e, 'fade'); }
      }
      // the layer breathes as one: its own composited layer, so a breath repaints nothing
      if (html) void motion.breathe(svg); else motion.stop(svg);
      // each zone's name on the ground, on the tile nearest its middle; an aura's name goes along with it (its plate moves, the box's transform is its place)
      const box = $('[data-zlabels]'), names = scene.zones.map(z => `<div class="mp-zl ${z.tone}" data-zl="${esc(z.id)}" style="transform:${pos(z.at.x, z.at.y)}"><span>${esc(z.name)}</span></div>`).join('');
      if (box.dataset.sig !== names) {
        box.dataset.sig = names; box.innerHTML = names;
        for (const [id, points] of ways) { const node = box.querySelector(`[data-zl="${CSS.escape(id)}"] span`); if (node) void motion.along(node, points); }
      }
    }
    /** While this phone's last command waits for the GM's phone: a waiting mark (no number exists to show). */
    function drawSending(waiting) {
      const box = $('[data-sending]');
      if (box.hidden === !waiting) return;
      box.hidden = !waiting;
      if (waiting) motion.progress(box, null, 'Sending to the GM');
    }
    /** The eyes the GM's map shows, named in its corner while they are one row's and not everything (map-view.ts `MapScene.eyes`). */
    function drawSeenAs() {
      const box = $('[data-seenas]'), e = scene.eyes, text = e ? `Viewing as ${e.name}${e.down ? ' (defeated, sees allies only)' : ''}` : '';
      box.hidden = !e;
      if (box.textContent !== text) box.textContent = text;
    }
    /** The party's fog: a soft dark veil over what it does not see now, darker where it never saw; lighter on the GM's map. */
    function drawFog() {
      const svg = /** @type {any} */ (el.querySelector('[data-fog]')), w = scene.w * TILE, h = scene.h * TILE, f = scene.fog;
      if (svg.getAttribute('width') !== String(w)) { svg.setAttribute('width', String(w)); svg.setAttribute('height', String(h)); }
      const html = f ? `${f.dim.length ? `<path class="dim" d="${loopsD(f.dim)}"/>` : ''}${f.dark.length ? `<path class="dark" d="${loopsD(f.dark)}"/>` : ''}` : '';
      if (svg.dataset.sig !== html) { svg.dataset.sig = html; svg.innerHTML = html; }
      svg.classList.toggle('gm', !!(f && f.gm));
    }
    function drawTerrain() {
      const box = $('[data-terrain]');
      keyed(box, scene.terrain.map(t => `${t.place.x},${t.place.y},${t.terrain}`), k => {
        const [x, y, terrain] = k.split(','), i = document.createElement('i');
        i.className = `mp-t ${terrain}`; i.style.transform = pos(Number(x), Number(y)); return i;
      });
      const svg = /** @type {any} */ (el.querySelector('[data-walls]')), d = loopsD(scene.walls);
      if (svg.dataset.sig !== d) {
        svg.dataset.sig = d; svg.setAttribute('width', String(scene.w * TILE)); svg.setAttribute('height', String(scene.h * TILE));
        svg.innerHTML = d ? `<path d="${d}"/>` : '';
      }
    }
    const share = (v, max) => (max > 0 ? Math.max(0, Math.min(1, v / max)) : 0);
    function drawNow() {
      const t = scene.tokens.find(x => x.current), box = $('[data-now]');
      const d = t ? {
        name: t.name, hp: t.bars ? `${t.bars.hp[0]} / ${t.bars.hp[1]}` : (t.ring.band || ''), hpF: t.ring.share,
        mana: t.bars && t.bars.mana ? `${t.bars.mana[0]}` : null, manaF: t.bars && t.bars.mana ? share(t.bars.mana[0], t.bars.mana[1]) : null,
        fat: t.bars && t.bars.fatigue ? `${t.bars.fatigue[0]}` : null, fatF: t.bars && t.bars.fatigue ? share(t.bars.fatigue[0], t.bars.fatigue[1]) : null,
      } : { name: 'No turn yet', hp: '', hpF: 0, mana: null, manaF: null, fat: null, fatF: null };
      if (!box.firstElementChild) box.innerHTML = `<b data-text="name"></b><span class="bar bar-hp" data-fill="hpF">${motion.fillMarkup(0)}</span><small data-text="hp"></small>
        <span class="bar bar-mp" data-show="manaF" data-fill="manaF">${motion.fillMarkup(0)}</span><span class="bar bar-fat" data-show="fatF" data-fill="fatF">${motion.fillMarkup(0)}</span>`;
      bind(box, d);
    }
    /** A name in the order ahead, after its token's picture. */
    const orderTemplate = () => ui.h('<li data-attr="class:cls"><svg class="ic" aria-hidden="true" focusable="false" data-attr="hidden:noIcon"><use data-attr="href:href"></use></svg><span data-text="text"></span></li>');
    function drawOrder() {
      const list = src.order(), box = $('.mp-order');
      const els = keyed(box, list.map((o, i) => `${i}`), orderTemplate);
      // a staggered monster's turn is pushed back: it stands later in the line, marked; each name after its token's picture
      list.forEach((o, i) => {
        const tk = scene.tokens.find(t => t.id === o.id), st = !!(tk && tk.extras.stagger && tk.extras.stagger.staggered), ic = tk ? tk.icon : null;
        bind(els[i], { cls: `${i === 0 ? 'now' : ''}${st ? ' stag' : ''}`.trim() || null, text: st ? `${o.name} (staggered)` : o.name, noIcon: !ic, href: ic ? iconHref(ic) : null });
      });
    }
    function drawConfirm(f) {
      const box = $('[data-confirm]'), words = $('[data-words]'), cancelBtn = /** @type {HTMLButtonElement} */ ($('[data-cancel]')), goBtn = /** @type {HTMLButtonElement} */ ($('[data-go]'));
      let say = '', label = '', on = false, show = false;
      if (f.kind === 'move' && f.path) { show = true; say = f.path.words; label = f.path.dash ? 'Dash' : 'Move'; on = true; }
      if (f.kind === 'aim') {
        show = true; label = `Use ${f.ability.name}`;
        const name = id => (scene.tokens.find(t => t.id === id) || { name: id }).name;
        if (!f.aim) say = f.ability.aim === 'place' ? 'Tap where it lands.' : f.targets.length ? 'Tap a target.' : 'Nobody in reach.';
        else {
          on = f.aim.ok;
          const hit = f.aim.hit.map(name), ring = f.aim.ringed.map(name);
          say = !f.aim.ok ? 'Out of reach.' : `${hit.length ? `Hits ${hit.join(', ')}` : 'Hits nobody'}.${ring.length ? ` In outer ring (reduced damage): ${ring.join(', ')}.` : ''}`;
        }
      }
      if (f.kind === 'dodge') {
        show = true; on = true;
        label = f.staying ? 'Stay here' : 'Dodge here';
        say = f.mode === 'ring'
          ? (f.staying ? 'No way clear. Stay here or pick another outer-ring tile.' : 'No way clear. Move to this outer-ring tile (reduced damage).')
          : (f.ability ? `Dodge ${f.ability}. Tap a marked tile.` : 'Dodge an attack. Tap a marked tile.');
      }
      box.hidden = !show;
      cancelBtn.hidden = f.kind === 'dodge';
      if (words.textContent !== say) words.textContent = say;
      if (goBtn.textContent !== label) goBtn.textContent = label;
      goBtn.disabled = !on;
    }
    const costText = s => [s.fatigue ? `${s.fatigue} fatigue` : '', s.mana ? `${s.mana} mana` : ''].filter(Boolean).join(', ') || 'Free';
    const slotText = s => (s.wait > 0 ? `${s.wait} round${s.wait === 1 ? '' : 's'}` : costText(s));
    /** A hotbar button, drawn once per slot and updated in place (patch.ts), so a pick or a use writes only what changed. */
    const hbTemplate = () => ui.h('<button type="button" data-attr="class:cls data-ab:ab data-arm:arm data-release:release data-more:more data-pass:pass aria-pressed:pressed aria-expanded:expanded aria-label:label disabled:wait"><svg class="ic" aria-hidden="true" focusable="false" data-attr="hidden:noIcon"><use data-attr="href:href"></use></svg><span data-text="name"></span><small data-text="small"></small><small class="ans" data-text="ans" data-attr="hidden:noAns"></small></button>');
    /** A slot's description: an ability's slot names its picture (`href`); Release, More and End turn draw none. */
    const hbDesc = o => ({ cls: 'mp-hb', ab: null, arm: null, release: false, more: false, pass: false, pressed: null, expanded: null, label: null, wait: false, noIcon: true, href: null, ans: '', noAns: true, ...o });
    const REACT_WORD = { arm: 'Arm', armed: 'Armed', spent: 'Spent' };
    /** Whether the hotbar's last slot is cut by the edge: the bar then fades out there, to show it scrolls. */
    const cutSeen = new IntersectionObserver(es => { for (const e of es) $('[data-slots]').classList.toggle('cut', e.intersectionRatio < 0.98); }, { root: $('[data-slots]'), threshold: [0.98] });
    /** A slot that answers the omen standing says so under its cost, in plain words, and its label does too. */
    const answerDesc = s => (s.answers ? { ans: `${s.answers[0].toUpperCase()}${s.answers.slice(1).replace(/ it$/, ' the omen')}`, noAns: false } : {});
    const leftText = s => (s.left === null ? '' : `${s.left} left`);
    /** A hotbar slot: a reaction arms (Arm, Armed, Spent); an ability with uses shows them and is off at 0. */
    const slotDesc = s => s.react
      ? hbDesc({ cls: `mp-hb react ${s.react}`, arm: s.id, noIcon: false, href: iconHref(s.icon), pressed: String(s.react !== 'arm'), label: `${s.name}, reaction: ${REACT_WORD[s.react]}`, name: s.name, small: REACT_WORD[s.react] })
      : hbDesc({ ab: s.id, noIcon: false, href: iconHref(s.icon), pressed: String(choice.now.kind === 'aim' && choice.now.ability.id === s.id), wait: s.wait > 0 || s.left === 0, label: `${s.name}, ${costText(s)}${s.answers ? `, answers the omen: ${s.answers}` : ''}${s.left !== null ? `, ${leftText(s)}` : ''}${s.wait > 0 ? `, ready in ${slotText(s)}` : ''}`, name: s.name, small: s.wait > 0 || s.left === null ? slotText(s) : leftText(s), ...answerDesc(s) });
    function drawHotbar() {
      const k = scene && scene.focus.kind === 'dodge' ? null : src.kit(), bar = $('[data-hot]'), hot = $('[data-slots]'), passBox = $('[data-passbox]'), dr = $('[data-drawer]');
      bar.hidden = !k;
      if (!k) { keyed(hot, [], hbTemplate); keyed(passBox, [], hbTemplate); dr.hidden = true; return; }
      const h = hotbar(k.list, k.readyAt, k.now, k.costCut, store.prefs().pins[k.pinKey] ?? null, app.rules(), { armed: k.armed ?? null, left: k.left ?? {}, itemOf: k.itemOf, answers: k.answers ?? {} });
      const btn = s => { const d = slotDesc(s); return `<button type="button" class="${d.cls}"${d.ab ? ` data-ab="${esc(d.ab)}"` : ''}${d.arm ? ` data-arm="${esc(d.arm)}"` : ''} aria-pressed="${d.pressed}"${d.wait ? ' disabled' : ''} aria-label="${esc(d.label)}">${icon(s.icon)}<span>${esc(d.name)}</span><small>${esc(d.small)}</small>${d.ans ? `<small class="ans">${esc(d.ans)}</small>` : ''}</button>`; };
      const ch = k.channel, slots = [
        ...(ch ? [['release', hbDesc({ cls: 'mp-hb release', release: true, label: `Release ${ch.name}: charge ${ch.charge} of ${ch.max}, ${ch.factor} times its power`, name: `Release ${ch.name}`, small: `${ch.charge} of ${ch.max} · ×${ch.factor}` })]] : []),
        ...h.bar.map(s => [`ab:${s.id}`, slotDesc(s)]),
        ...(h.more.length || h.bar.length > 1 ? [['more', hbDesc({ more: true, expanded: String(choice.drawer), name: 'More', small: String(h.more.length) })]] : []),
      ];
      const els = keyed(hot, slots.map(([key]) => key), hbTemplate);
      slots.forEach(([, d], i) => bind(els[i], d));
      // End turn, the turn's one constant, sits at the bar's end outside the scroll, so it is always whole
      const pass = src.pass && scene && scene.actor ? [hbDesc({ cls: 'mp-hb pass', pass: true, name: 'End turn', small: 'Pass' })] : [];
      keyed(passBox, pass.map(() => 'pass'), hbTemplate).forEach((b, i) => bind(b, pass[i]));
      const sig = slots.map(([key]) => key).join();
      if (hot.dataset.sig !== sig) { hot.dataset.sig = sig; cutSeen.disconnect(); if (hot.lastElementChild) cutSeen.observe(hot.lastElementChild); }
      const pinned = h.bar.filter(s => s.pinned), full = h.full;
      const row = s => `<li>${btn(s)}${s.item ? '' : `<button type="button" class="quiet" data-pin="${esc(s.id)}" aria-pressed="${s.pinned}"${!s.pinned && full ? ' disabled' : ''}>${s.pinned ? 'Unpin' : 'Pin'}</button>`}</li>`;
      const dhtml = choice.drawer ? `<ul aria-label="More abilities and items">${[...pinned, ...h.more].map(row).join('')}</ul>` : '';
      if (dr.dataset.sig !== dhtml) { dr.dataset.sig = dhtml; dr.innerHTML = dhtml; }
      dr.hidden = !choice.drawer;
    }

    const PAINT_WORD = { wall: 'Wall', floor: 'Floor', cover: 'Cover', rough: 'Rough', pit: 'Pit' };
    /** The paint bar while the GM paints: each terrain, then each zone on the ground to spread. */
    function drawPaint() {
      const bar = $('[data-paint]'), tog = el.querySelector('[data-painttog]'), dodging = !!(scene && scene.focus.kind === 'dodge');
      if (tog) { tog.disabled = dodging; tog.setAttribute('aria-pressed', String(!dodging && !!brush)); }
      frame.classList.toggle('painting', !dodging && !!brush);
      bar.hidden = dodging || !brush;
      if (dodging || !brush) return;
      const zones = scene.zones.filter((z, i, all) => all.findIndex(x => x.name === z.name) === i);
      const on = v => (brush.zone ? `zone:${brush.zone}` === v : `t:${brush.terrain}` === v);
      const html = [...Object.entries(PAINT_WORD).map(([t, l]) => [`t:${t}`, l]), ...zones.map(z => [`zone:${z.id}`, z.name])]
        .map(([v, l]) => `<button type="button" data-brush="${esc(v)}" aria-pressed="${on(v)}">${esc(l)}</button>`).join('');
      if (bar.dataset.sig !== html) { bar.dataset.sig = html; bar.innerHTML = html; }
    }
    function draw() {
      if (life.at === 'gone') return;
      draws++;
      const input = src.input();
      live({ kind: 'show', fight: input ? input.fight : null });
      el.hidden = !input;
      if (!input) { scene = null; return; }
      // a new turn, a kit without the aimed ability, an open dodge prompt, or the answer to a sent move
      if (input.dodge && brush) brush = null;
      const turned = input.actor !== choice.actor, enteredDodge = !!input.dodge && (choice.now.kind !== 'dodge' || choice.now.n !== input.dodge.n), k = src.kit(), waiting = src.waiting();
      act({ kind: 'seen', actor: input.actor, kit: k ? k.list : null, waiting, dodge: input.dodge ? { n: input.dodge.n, auto: input.dodge.auto } : null });
      scene = mapScene({ ...input, before: zonesWas, sent: waiting ? choice.sent : null }, choice.now, app.rules());
      act({ kind: 'drawn', scene });
      const f = scene.focus;
      world.style.width = `${scene.w * TILE}px`; world.style.height = `${scene.h * TILE}px`;
      world.classList.toggle('grid', store.prefs().mapGrid);
      const tone = f.kind === 'aim' && scene.shades.length ? scene.shades[0].tone : '';
      if (world.dataset.tone !== tone) world.dataset.tone = tone;
      const gt = $('[data-grid]'); gt.setAttribute('aria-pressed', String(store.prefs().mapGrid));
      drawTerrain(); drawZones(); drawFog(); drawArea(f); drawLines(); drawTokens(f); drawOrder(); drawNow(); drawConfirm(f); drawHotbar(); drawPaint(); drawSending(waiting); drawSeenAs();
      const dt = D().openIn(dtList);
      if (dt && !thingOf(dt)) D().move(dtList, { kind: 'drop', key: dt }, drawDetail); else drawDetail();
      // a turn or dodge that comes to a body or offered dodge tile out of sight frames the map again
      const lost = seen.fw > 0 && ((turned && !!scene.actor && !!scene.anchor && !inSight(scene.anchor))
        || (enteredDodge && f.kind === 'dodge' && ((!!scene.anchor && !inSight(scene.anchor)) || f.tiles.some(p => !inSight(p)))));
      live({ kind: 'drawn', tokens: scene.tokens.length > 0, over: src.over ? src.over() : '', lost });
    }
    /**
     * The fight's news while this map shows a fight (the screen's view shown, a turn running): the latest in one line over
     * the map, under Paint and Grid, for as long as a toast stays. The fight's log keeps every use.
     */
    const newsBox = $('[data-news]');
    /** The timer that hides the news line after a toast's time, or 0. */
    let newsTimer = 0;
    const off = ui.newsLine((msg, kind) => {
      if (el.hidden || !scene || !scene.tokens.some(t => t.current) || !el.closest('.view:not([hidden])')) return false;
      newsBox.textContent = msg; newsBox.className = `mp-news ${kind}`; newsBox.hidden = false;
      void motion.enter(newsBox, 'fade');
      clearTimeout(newsTimer); newsTimer = setTimeout(() => { void motion.hide(newsBox); }, ui.TOAST_MS);
      return true;
    });
    return { draw, fit, destroy: () => live({ kind: 'gone' }) };
  }
}
