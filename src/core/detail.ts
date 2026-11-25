// detail.ts: what "more info" on a thing says (the owner, Nov 14: "a drop down option where it shows more info? Only
// necessary stuff"). A thing on screen shows its one line; a tap opens its detail in place (src/views/detail.js), and the
// detail is this: a status's, an ability's, an item's and a zone's sentences as core already writes them
// (`describeStatus`, `describeAbility`, `describeItem`, `opLines`), and a sheet number's parts (sheet.ts `explain`).
// Pure; no sentence of a rule is written here, only the line that names what the thing is now (its stacks, its rounds).
// A new kind of thing is a member of `Thing` and its case in `detailOf` (the typecheck asks), with a case in
// tests/detail.test.ts.

import { oddsDetail } from './combat/odds.ts';
import type { OddsRead, OddsVoice } from './combat/odds.ts';
import type { Rules } from './rules.ts';
import type { Ability } from './combat/ability-types.ts';
import { describeStatus, opLines } from './combat/effect-ops.ts';
import { isStacking } from './combat/op-amount.ts';
import type { Op, StatusDef } from './combat/effect-ops.ts';
import type { ZoneTone } from './combat/zones.ts';
import { abilityLines } from './combat/fight-view.ts';
import { parseFormula, printFormula } from './formula.ts';
import { describeAbility, formulaOf, KINDS } from './registry/ability-kinds.ts';
import type { KindRules } from './registry/ability-kinds.ts';
import { weaponAttack } from './registry/abilities.ts';
import type { Attack } from './registry/items.ts';
import { describeItem } from './effects.ts';
import type { ItemEffects } from './effects.ts';
import { SHEET_LABELS } from './hunter/derive.ts';
import type { SheetNumber } from './hunter/derive.ts';
import { explain, hunterSheet, SOURCE_LABELS } from './hunter/sheet.ts';
import type { SheetHunter } from './hunter/sheet.ts';

/**
 * What a detail can be opened on. A status as a body holds it (its def at its source's tier, its count, its rounds left);
 * a status a phone knows only by name (a teammate's in the room doc) has no def. A zone's ops are known on the GM's phone
 * only (the doc carries its tone).
 */
export type Thing =
  | { readonly kind: 'status'; readonly label: string; readonly def: StatusDef | null; readonly tier: number | null; readonly stacks?: number; readonly left?: number | null }
  | { readonly kind: 'ability'; readonly ability: Ability }
  /** An item, and the hunter who holds it when it is in a bag: its amounts then say what they come to on that hunter. */
  | { readonly kind: 'item'; readonly item: ItemEffects & { readonly name: string; readonly desc?: string; readonly type?: string; readonly dice?: string; readonly attack?: Attack; readonly finesse?: true; readonly twoHanded?: true; readonly effects?: readonly Op[] }; readonly hunter?: SheetHunter }
  | { readonly kind: 'zone'; readonly name: string; readonly tone: ZoneTone; readonly left: number | null; readonly ops: readonly Op[] | null; readonly tier: number }
  | { readonly kind: 'number'; readonly key: SheetNumber; readonly hunter: SheetHunter }
  | { readonly kind: 'odds'; readonly odds: OddsRead; readonly voice: OddsVoice };

/** A detail: its title, the thing's own words (a description the GM wrote, or a zone's tone), and its lines. */
export type Detail = { readonly title: string; readonly about: string; readonly lines: readonly string[] };

const ZONE_WORD: { readonly [T in ZoneTone]: string } = {
  harm: 'Hurts whoever stands in it.', help: 'Helps whoever stands in it.', hinder: 'Slows or restricts whoever stands in it.', plain: 'A field on the ground.',
};
const rounds = (n: number): string => `${n} round${n === 1 ? '' : 's'}`;
/** A number as the sheet shows it: whole, or to two decimals. */
const shown = (n: number): string => String(Math.round(n * 100) / 100);
const signed = (n: number): string => (n < 0 ? `−${shown(-n)}` : `+${shown(n)}`);

/**
 * What a status does to its bearer while it holds, the line a GM's card shows under its chips without a tap: its ops at its
 * source's tier (each per stack on a stacking one). Its cap, threshold, triggers and end are its detail's.
 */
export function statusGlance(def: StatusDef, tier: number | null, R: Rules): string[] {
  const lines = opLines(def.ops, tier, R);
  return isStacking(def) ? lines.map(l => `Each stack: ${l}`) : lines;
}

/**
 * What a weapon's attack line says on an item card and in the item maker's preview: the amplified attack formula
 * `weaponAttack` actually rolls under `R`, plus a plain fallback notice when the saved dice exceed current rules limits.
 */
export function weaponLines(
  i: { readonly name: string; readonly type?: string; readonly dice?: string; readonly attack?: Attack; readonly finesse?: true; readonly twoHanded?: true },
  R: KindRules,
): string[] {
  if (i.type !== 'weapon') return [];
  const attack = i.attack ?? 'strike', raw = (i.dice ?? '').trim(), fallbackDie = KINDS[attack].dice ?? '1d8';
  const a = weaponAttack({ name: i.name, dice: raw, attack, ...(i.finesse ? { finesse: true as const } : {}) }, R);
  const f = formulaOf(a, R), expr = f ? printFormula(f) : fallbackDie;
  const tags = [i.twoHanded ? 'two-handed' : '', attack === 'shot' || i.finesse ? 'finesse' : ''].filter(Boolean);
  const main = `Weapon attack: ${expr}${tags.length ? ` (${tags.join(', ')})` : ''}.`;
  return raw !== '' && !parseFormula(raw, R).ok
    ? [main, `Dice "${raw}" exceed current rules limits, so this weapon uses ${fallbackDie}.`]
    : [main];
}

/** The detail of `t` under the current rules. */
export function detailOf(t: Thing, R: Rules): Detail {
  switch (t.kind) {
    case 'status': {
      const d = t.def, now: string[] = [];
      if (t.stacks !== undefined) now.push(`${t.stacks}${d && isStacking(d) ? ` of ${d.stack.cap}` : ''} stack${t.stacks === 1 ? '' : 's'}.`);
      if (t.left !== undefined && t.left !== null) now.push(d?.end ? `Ends in ${rounds(t.left)}.` : `${rounds(t.left)} left.`);
      return { title: d?.label ?? t.label, about: d?.desc ?? '', lines: [...now, ...(d ? describeStatus(d, t.tier, R) : [])] };
    }
    case 'ability': {
      const a = t.ability, cost = [a.cost.fatigue ? `${a.cost.fatigue} fatigue` : '', a.cost.mana ? `${a.cost.mana} mana` : ''].filter(Boolean);
      const what = abilityLines(a, R).slice(0, a.effect ? 1 : 0);
      return { title: a.name, about: '', lines: [...what, ...(cost.length ? [`Costs ${cost.join(' and ')}.`] : []), ...describeAbility(a, R), ...opLines(a.ops, null, R)] };
    }
    case 'item': {
      const i = t.item;
      return { title: i.name, about: i.desc ?? '', lines: [...weaponLines(i, R), ...describeItem(R, i, i.effects ?? [], t.hunter ? hunterSheet(t.hunter, R) : null)] };
    }
    case 'zone':
      return { title: t.name, about: ZONE_WORD[t.tone], lines: [...(t.left === null ? [] : [`${rounds(t.left)} left.`]), ...(t.ops ? opLines(t.ops, t.tier, R) : [])] };
    case 'number': {
      const { total, parts } = explain(t.hunter, t.key, R);
      return { title: `${SHEET_LABELS[t.key]} ${shown(total)}`, about: '', lines: parts.filter((p, i) => i === 0 || Math.abs(p.amount) >= 0.005).map((p, i) => `${SOURCE_LABELS[p.from]} ${i === 0 ? shown(p.amount) : signed(p.amount)}`) };
    }
    case 'odds': return { title: 'The odds', about: '', lines: oddsDetail(t.odds, t.voice) };
    default: return t satisfies never;
  }
}
