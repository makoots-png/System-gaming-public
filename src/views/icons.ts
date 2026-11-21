// icons.ts: the one drawer of the icon registry (docs/agent-handoff/features/icons/design.md section 1). `sprite` puts one
// hidden SVG of `<symbol id="i-<key>">` on the page, built from src/core/registry/icons.ts, and `icon` answers the markup
// that draws a key by reference to it. No file is fetched. A drawn node changes its picture by one attribute, its
// `<use>`'s `href` (`iconHref`), which patch.ts binds with `data-attr`. The size is a token on `:root` (`--icon-token` and
// kin, public/app.css) set as `--ic` by the place that draws it; the colour is that place's `currentColor`. A picture is
// `aria-hidden` and never the only carrier of a meaning: the name or label beside it says what it is.
import { ICON_KEYS, iconDef } from '../core/registry/icons.ts';
import type { IconKey } from '../core/registry/icons.ts';

/** The id of the sprite on the page. */
const SPRITE_ID = 'icon-sprite';
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Puts the sprite on `doc`'s page once, every icon of the registry as a symbol; a second call finds it there and does nothing. */
export function sprite(doc: Document = document): void {
  if (doc.getElementById(SPRITE_ID)) return;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.id = SPRITE_ID;
  svg.setAttribute('class', 'ic-sprite');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICON_KEYS.map(k => `<symbol id="i-${k}" viewBox="0 0 24 24"><path fill-rule="evenodd" d="${iconDef(k).path}"/></symbol>`).join('');
  doc.body.prepend(svg);
}

/** The reference a `<use>` draws `key` by. */
export const iconHref = (key: IconKey): string => `#i-${key}`;

/** The markup that draws `key`: its class names `cls` beside `ic`, which say its size (`--ic`) where it is drawn. */
export const icon = (key: IconKey, cls = ''): string =>
  `<svg class="ic${cls ? ` ${cls}` : ''}" aria-hidden="true" focusable="false"><use href="${iconHref(key)}"></use></svg>`;
