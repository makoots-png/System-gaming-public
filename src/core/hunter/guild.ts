// guild.ts: guild membership, per-archetype System clear gold cuts, gate crystal shares, and GM-run table perks. Pure.
//
// One writer for `Hunter.guild`: every live membership change goes through `setGuild` or `guildStep` here (enforced by
// tests/lint.test.ts). `hunter.ts` holds the default (`null`) and boundary repair (`fixHunter`).
//
// Order C (`debtFirst`) stacking: on a table world-gate clear (`from === 'clear'`), System revive debt splits gross
// clear gold first, then the guild gold cut (`Math.floor(kept * rate + 1e-9)`) runs on post-debt kept gold. Because
// `rate` caps at `GUILD_GOLD_CUT_MAX` (0.90), floor rounding always leaves at least 1 gold kept whenever post-debt gold
// is positive, and revive debt payoff stays at 4.7 to 5.0 clears.
import { RULES } from '../rules.ts';
import type { Rank, Rules } from '../rules.ts';
import type { RewardFrom } from '../protocol.ts';
import { refuse } from '../save-step.ts';
import type { Refused } from '../save-step.ts';
import { told } from '../session-log.ts';
import type { Said, Stamp } from '../session-log.ts';
import type { Save } from '../save.ts';
import { debtPaidLine, debtPaidLog, debtPreviewLine } from './revive-standing.ts';
import type { DebtPaid, DebtXpCut } from './revive-standing.ts';

/** The five Carrow guild archetypes, in display order. */
export const GUILD_ARCHETYPES = ['ironwake', 'lantern', 'aurelian', 'ninth-hour', 'redline'] as const;
export type GuildArchetype = (typeof GUILD_ARCHETYPES)[number];

/** The three contract standings within a guild (Ninth Hour offers Core and Ace only). */
export const GUILD_STANDINGS = ['rookie', 'core', 'ace'] as const;
export type GuildStanding = (typeof GUILD_STANDINGS)[number];

/** Maximum guild gold cut (90%): strictly below 1 so floor rounding always leaves at least 1 gold kept. */
export const GUILD_GOLD_CUT_MAX = 0.9;
/** Maximum length of an optional custom guild name. */
export const GUILD_NAME_MAX = 60;

/** A hunter's guild membership and optional per-hunter GM cut overrides. */
export type GuildMembership = {
  readonly archetype: GuildArchetype;
  readonly standing: GuildStanding;
  /** Optional custom guild name (1..60 chars). Omitted uses the archetype's default name. */
  readonly name?: string;
  /** Optional per-hunter GM override for System clear gold cut (0..0.90). Omitted reads `RULES.guilds`. */
  readonly goldCut?: number;
  /** Optional per-hunter GM override for gate crystal party share (0..1). Omitted reads `RULES.guilds`. */
  readonly crystalShare?: number;
};

/** Result of applying a guild gold cut to clear gold in one grant. */
export type GuildGoldCut = {
  readonly guildName: string;
  readonly archetype: GuildArchetype;
  readonly standing: GuildStanding;
  readonly rate: number;
  readonly gross: number;
  readonly taken: number;
  readonly kept: number;
  readonly custom: boolean;
};

/** GM-run table perks for a guild archetype (not paid automatically by the app; shown on the Rules page). */
export type GuildTablePerk = {
  /** Monthly retainer in mana crystal as a multiple of rank `priceBase` (GM-run). */
  readonly retainerPB: number;
  /** Signing bonus in mana crystal at ranks E and D as a multiple of `priceBase` (GM-run). */
  readonly signingBonusED: number;
  /** Which standings receive guild vault Resurrection Crystal cover (GM-run). */
  readonly vaultCover: Readonly<Record<GuildStanding, boolean>>;
  /** Plain-language summary of GM-run table perks shown on the Rules page. */
  readonly summary: string;
};

type Rec = Record<string, unknown>;
type ArchetypeTables = {
  readonly goldCut: Readonly<Partial<Record<GuildStanding, Readonly<Record<Rank, number>>>>>;
  readonly crystalShare: Readonly<Partial<Record<GuildStanding, number>>>;
};

const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const inList = <T extends string>(list: readonly T[], v: unknown): T | null =>
  ((list as readonly unknown[]).includes(v) ? (v as T) : null);
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
/** Rounds a guild rate to 0.01% precision (four decimal places) so parser and dialog agree. */
const roundRate = (n: number): number => Math.round(n * 10000) / 10000;
const fmtNum = (n: number): string => n.toLocaleString('en-US');
const pct = (rate: number): string => `${Math.round(rate * 1000) / 10}%`;
const tablesOf = (archetype: GuildArchetype, R: Pick<Rules, 'guilds'>): ArchetypeTables =>
  R.guilds.archetypes[archetype] as ArchetypeTables;

/** Default display names for the five guild archetypes. */
export const GUILD_NAMES: Readonly<Record<GuildArchetype, string>> = {
  ironwake: 'Ironwake',
  lantern: 'Lantern Company',
  aurelian: 'Aurelian',
  'ninth-hour': 'Ninth Hour',
  redline: 'Redline',
};

/** Display labels for the three guild standings. */
export const GUILD_STANDING_LABELS: Readonly<Record<GuildStanding, string>> = {
  rookie: 'Rookie',
  core: 'Core',
  ace: 'Ace',
};

/** GM-run table perks for each guild archetype, matching crystal-economy.md sections 4.2 and 4.4. */
export const GUILD_TABLE_PERKS: Readonly<Record<GuildArchetype, GuildTablePerk>> = {
  ironwake: {
    retainerPB: 1.0,
    signingBonusED: 2.0,
    vaultCover: { rookie: true, core: true, ace: true },
    summary: 'Monthly retainer (1x base crystal), E/D signing bonus (2x base crystal), and vault Resurrection Crystal cover for Rookie, Core, and Ace.',
  },
  lantern: {
    retainerPB: 0.4,
    signingBonusED: 0,
    vaultCover: { rookie: false, core: false, ace: false },
    summary: 'Monthly retainer (0.4x base crystal), co-op vote, and shared gear. No signing bonus or vault cover.',
  },
  aurelian: {
    retainerPB: 1.0,
    signingBonusED: 2.0,
    vaultCover: { rookie: false, core: false, ace: true },
    summary: 'Monthly retainer (1x base crystal), E/D signing bonus (2x base crystal), and vault Resurrection Crystal cover for Ace only.',
  },
  'ninth-hour': {
    retainerPB: 1.5,
    signingBonusED: 0,
    vaultCover: { rookie: false, core: true, ace: true },
    summary: 'Core and Ace only (no Rookie). Monthly retainer (1.5x base crystal) and vault Resurrection Crystal cover for Core and Ace.',
  },
  redline: {
    retainerPB: 0,
    signingBonusED: 0,
    vaultCover: { rookie: false, core: false, ace: false },
    summary: 'No retainer, no signing bonus, and no vault cover. Highest crystal share (35% to 40%) and low gold cut.',
  },
};

/** Standings offered by `archetype` under `R` (Ninth Hour offers Core and Ace only, with no Rookie row). */
export function allowedStandings(archetype: GuildArchetype, R: Pick<Rules, 'guilds'> = RULES): readonly GuildStanding[] {
  const t = tablesOf(archetype, R);
  return GUILD_STANDINGS.filter(s => t.goldCut[s] !== undefined && t.crystalShare[s] !== undefined);
}

/** Whether `archetype` offers `standing` under `R` (false for Ninth Hour + Rookie). */
export function isStandingAllowed(archetype: GuildArchetype, standing: GuildStanding, R: Pick<Rules, 'guilds'> = RULES): boolean {
  const t = tablesOf(archetype, R);
  return t.goldCut[standing] !== undefined && t.crystalShare[standing] !== undefined;
}

/** Parses a guild membership at a save, sheet, or protocol boundary. Unknown, malformed, or disallowed standing falls back to null (unsigned). */
export function parseGuild(v: unknown, R: Pick<Rules, 'guilds'> = RULES): GuildMembership | null {
  if (!isObj(v)) return null;
  const archetype = inList(GUILD_ARCHETYPES, v.archetype);
  const standing = inList(GUILD_STANDINGS, v.standing);
  if (!archetype || !standing || !isStandingAllowed(archetype, standing, R)) return null;
  const rawName = typeof v.name === 'string' ? v.name.replace(/\s+/g, ' ').trim().slice(0, GUILD_NAME_MAX) : '';
  const goldCut = typeof v.goldCut === 'number' && Number.isFinite(v.goldCut) ? roundRate(clamp(v.goldCut, 0, GUILD_GOLD_CUT_MAX)) : undefined;
  const crystalShare = typeof v.crystalShare === 'number' && Number.isFinite(v.crystalShare) ? roundRate(clamp(v.crystalShare, 0, 1)) : undefined;
  return {
    archetype,
    standing,
    ...(rawName ? { name: rawName } : {}),
    ...(goldCut !== undefined ? { goldCut } : {}),
    ...(crystalShare !== undefined ? { crystalShare } : {}),
  };
}

/** Display name of a guild membership (custom name if set, else the archetype's default name). */
export const guildDisplayName = (g: Pick<GuildMembership, 'archetype' | 'name'>): string =>
  (g.name && g.name.trim()) || GUILD_NAMES[g.archetype];

/** Table default gold cut for an archetype, standing, and rank under `R`, or null when the guild does not offer that standing. */
export function tableGoldCut(archetype: GuildArchetype, standing: GuildStanding, rank: Rank, R: Pick<Rules, 'guilds'>): number | null {
  const row = tablesOf(archetype, R).goldCut[standing];
  return row ? clamp(row[rank], 0, GUILD_GOLD_CUT_MAX) : null;
}

/** Table default gate crystal share for an archetype and standing under `R` (flat across rank), or null when unavailable. */
export function tableCrystalShare(archetype: GuildArchetype, standing: GuildStanding, R: Pick<Rules, 'guilds'>): number | null {
  const share = tablesOf(archetype, R).crystalShare[standing];
  return share === undefined ? null : clamp(share, 0, 1);
}

/** Effective System clear gold cut for hunter `h` under `R` (`0` when unsigned). */
export function effectiveGoldCut(h: { readonly rank: Rank; readonly guild?: GuildMembership | null }, R: Pick<Rules, 'guilds'>): number {
  if (!h.guild) return 0;
  const raw = h.guild.goldCut ?? tableGoldCut(h.guild.archetype, h.guild.standing, h.rank, R);
  return raw !== null && Number.isFinite(raw) ? clamp(raw, 0, GUILD_GOLD_CUT_MAX) : 0;
}

/** Effective gate mana crystal party share for hunter `h` under `R` (`crystal.unsignedShare` when unsigned). */
export function effectiveCrystalShare(h: { readonly guild?: GuildMembership | null }, R: Pick<Rules, 'crystal' | 'guilds'>): number {
  if (!h.guild) return clamp(R.crystal.unsignedShare, 0, 1);
  const raw = h.guild.crystalShare ?? tableCrystalShare(h.guild.archetype, h.guild.standing, R);
  return raw !== null && Number.isFinite(raw) ? clamp(raw, 0, 1) : clamp(R.crystal.unsignedShare, 0, 1);
}

/** Reward sources subject to guild System clear gold cuts: table world-gate clears only (never solo runs, quests, feats, or manual awards). */
export const takesGuildCut = (from: RewardFrom | null | undefined): boolean => from === 'clear';

/**
 * Computes the guild gold cut on `gold` (post-debt kept gold in Order C) for hunter `h` under `R`.
 * Returns null when unsigned, `gold <= 0`, or effective rate is 0.
 * Floor rounding with `rate <= 0.90` guarantees `kept >= 1` for every `gold >= 1`.
 */
export function guildGoldStep(
  gold: number,
  h: { readonly rank: Rank; readonly guild?: GuildMembership | null },
  R: Pick<Rules, 'guilds'>,
): GuildGoldCut | null {
  if (!h.guild || gold <= 0) return null;
  const rate = effectiveGoldCut(h, R);
  if (rate <= 0) return null;
  const taken = Math.min(gold - 1, Math.floor(gold * rate + 1e-9));
  return {
    guildName: guildDisplayName(h.guild),
    archetype: h.guild.archetype,
    standing: h.guild.standing,
    rate,
    gross: gold,
    taken,
    kept: gold - taken,
    custom: h.guild.goldCut !== undefined,
  };
}

/** Sets hunter `h`'s guild membership (the one live writer of `Hunter.guild`). */
export const setGuild = <H extends { guild: GuildMembership | null }>(h: H, guild: GuildMembership | null): H => ({
  ...h,
  guild: parseGuild(guild),
});

/** Atomic save step: sets hunter `hid`'s guild membership and logs the change when it moved. Refuses unavailable standings (such as Ninth Hour Rookie). */
export function guildStep(
  save: Save,
  hid: string,
  guild: GuildMembership | null,
  stamp: Stamp,
  R: Pick<Rules, 'guilds'> = RULES,
): { readonly save: Save; readonly changed: boolean; readonly hunter: Save['hunters'][number] } | Refused<'no-hunter' | 'standing-unavailable'> {
  const at = save.hunters.findIndex(h => h.id === hid);
  if (at < 0) return refuse('no-hunter');
  if (guild !== null && !isStandingAllowed(guild.archetype, guild.standing, R)) return refuse('standing-unavailable');
  const prev = save.hunters[at]!;
  const clean = parseGuild(guild, R);
  if (JSON.stringify(prev.guild) === JSON.stringify(clean)) {
    return { save, changed: false, hunter: prev };
  }
  const hunter = setGuild(prev, clean);
  const hunters = save.hunters.map((x, i) => (i === at ? hunter : x));
  const text = clean
    ? `${hunter.name} joined ${guildDisplayName(clean)} (${GUILD_STANDING_LABELS[clean.standing]}).`
    : `${hunter.name} left their guild and is now unsigned.`;
  const line: Said = { kind: 'system', hunterId: hunter.id, title: GUILD_WORDS.logTitle, text };
  return { save: told({ ...save, hunters }, stamp, line), changed: true, hunter };
}

/** Compact GM party-board chip for a hunter's guild, or null when unsigned. */
export const guildChip = (g: GuildMembership | null | undefined): string | null =>
  (g ? `${guildDisplayName(g)} · ${GUILD_STANDING_LABELS[g.standing]}` : null);

// ── the guild dialog's form projection ──
/** The guild dialog's five form inputs as text. */
export type GuildForm = {
  readonly archetype: string;
  readonly standing: string;
  readonly name: string;
  readonly goldCut: string;
  readonly crystalShare: string;
};
/** Result of reading the guild dialog's form fields. */
export type GuildFormResult =
  | { readonly ok: true; readonly guild: GuildMembership | null }
  | { readonly ok: false; readonly why: 'standing-unavailable' | 'bad-gold-cut' | 'bad-crystal-share'; readonly archetype: GuildArchetype; readonly standing: GuildStanding };

/** Formats a stored fraction (0..1) as percentage text to 0.01% precision, matching `guildFromForm`. */
export const formatGuildPct = (rate: number | undefined): string =>
  (rate === undefined ? '' : String(Math.round(rate * 10000) / 100));

/** Opens a saved guild membership (or null for unsigned) into the guild dialog's form fields. */
export function guildToForm(g: GuildMembership | null): GuildForm {
  return {
    archetype: g ? g.archetype : '',
    standing: g ? g.standing : 'core',
    name: g?.name ?? '',
    goldCut: formatGuildPct(g?.goldCut),
    crystalShare: formatGuildPct(g?.crystalShare),
  };
}

function parseGuildPct(raw: string, maxPct: number): { readonly ok: true; readonly value: number | undefined } | { readonly ok: false } {
  const s = raw.trim();
  if (!s) return { ok: true, value: undefined };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > maxPct) return { ok: false };
  return { ok: true, value: roundRate(n / 100) };
}

/** Reads the guild dialog's form fields into a `GuildMembership | null`, or the validation failure. */
export function guildFromForm(form: GuildForm, R: Pick<Rules, 'guilds'> = RULES): GuildFormResult {
  const archetype = inList(GUILD_ARCHETYPES, form.archetype);
  if (!archetype) return { ok: true, guild: null };
  const standing = inList(GUILD_STANDINGS, form.standing) ?? 'core';
  if (!isStandingAllowed(archetype, standing, R)) return { ok: false, why: 'standing-unavailable', archetype, standing };
  const gc = parseGuildPct(form.goldCut, Math.round(GUILD_GOLD_CUT_MAX * 100));
  if (!gc.ok) return { ok: false, why: 'bad-gold-cut', archetype, standing };
  const cs = parseGuildPct(form.crystalShare, 100);
  if (!cs.ok) return { ok: false, why: 'bad-crystal-share', archetype, standing };
  const name = form.name.replace(/\s+/g, ' ').trim().slice(0, GUILD_NAME_MAX);
  return {
    ok: true,
    guild: {
      archetype,
      standing,
      ...(name ? { name } : {}),
      ...(gc.value !== undefined ? { goldCut: gc.value } : {}),
      ...(cs.value !== undefined ? { crystalShare: cs.value } : {}),
    },
  };
}

/** Read-only guild summary line shown on the hunter's Status Window sheet. */
export function guildSheetLine(h: { readonly rank: Rank; readonly guild?: GuildMembership | null }, R: Pick<Rules, 'crystal' | 'guilds'>): string {
  if (!h.guild) return `Unsigned · 0% gold cut · ${pct(R.crystal.unsignedShare)} crystal salvage`;
  const g = h.guild;
  const gc = effectiveGoldCut(h, R), cs = effectiveCrystalShare(h, R);
  const gcTag = g.goldCut !== undefined ? ' (custom)' : '';
  const csTag = g.crystalShare !== undefined ? ' (custom)' : '';
  return `${guildDisplayName(g)} (${GUILD_STANDING_LABELS[g.standing]}) · ${pct(gc)} gold cut${gcTag} · ${pct(cs)} crystal share${csTag}`;
}

/** Unified reward window line for clear gold when System debt and/or a guild gold cut applied, or null when neither did. */
export function clearGoldLine(paid: DebtPaid | null, guildCut: GuildGoldCut | null): string | null {
  if (!guildCut) return paid ? debtPaidLine(paid) : null;
  if (!paid || (paid.paid <= 0 && paid.burn <= 0)) {
    return `Gate clear: ${fmtNum(guildCut.gross)} gold. ${fmtNum(guildCut.taken)} went to ${guildCut.guildName} (${pct(guildCut.rate)}), and you got ${fmtNum(guildCut.kept)}.`;
  }
  const parts: string[] = [];
  if (paid.paid > 0) parts.push(`${fmtNum(paid.paid)} went to your System debt`);
  if (paid.burn > 0) parts.push(`${fmtNum(paid.burn)} was lost to debt costs`);
  parts.push(`${fmtNum(guildCut.taken)} went to ${guildCut.guildName} (${pct(guildCut.rate)})`);
  const tail = paid.left > 0 ? `You owe ${fmtNum(paid.left)} more.` : 'You paid off your System debt.';
  return `Gate clear: ${fmtNum(paid.total)} gold. ${parts.join(', ')}, and you got ${fmtNum(guildCut.kept)}. ${tail}`;
}

/** GM Pending rewards preview line covering System debt, guild gold cut, and debt XP scaling. */
export function clearPreviewLine(paid: DebtPaid | null, guildCut: GuildGoldCut | null, xp: DebtXpCut | null = null): string | null {
  if (!guildCut) return debtPreviewLine(paid, xp);
  const parts: string[] = [];
  if (!paid || (paid.paid <= 0 && paid.burn <= 0)) {
    parts.push(`Gate clear: ${fmtNum(guildCut.gross)} gold. ${fmtNum(guildCut.taken)} goes to ${guildCut.guildName} (${pct(guildCut.rate)}), and hunter gets ${fmtNum(guildCut.kept)}.`);
  } else {
    const bits: string[] = [];
    if (paid.paid > 0) bits.push(`${fmtNum(paid.paid)} goes to System debt`);
    if (paid.burn > 0) bits.push(`${fmtNum(paid.burn)} is lost to debt costs`);
    bits.push(`${fmtNum(guildCut.taken)} goes to ${guildCut.guildName} (${pct(guildCut.rate)})`);
    const tail = paid.left > 0 ? `${fmtNum(paid.left)} gold left.` : 'Debt paid off.';
    parts.push(`Gate clear: ${fmtNum(paid.total)} gold. ${bits.join(', ')}, and hunter gets ${fmtNum(guildCut.kept)}. ${tail}`);
  }
  if (xp) {
    const xpPct = `${Math.round(Math.min(1, Math.max(0, xp.rate)) * 10000) / 100}%`;
    parts.push(`XP reduced to ${xpPct} while owing ${fmtNum(xp.left)} gold: +${fmtNum(xp.xp)} XP (from ${fmtNum(xp.base)} XP).`);
  }
  return parts.join(' ');
}

/** Session log line when a clear applied a guild gold cut and/or System debt split. */
export function guildPaidLog(
  name: string,
  paid: DebtPaid | null,
  guildCut: GuildGoldCut | null,
  xp: DebtXpCut | null = null,
  clearedFullXp = 0,
): Said | null {
  if (!guildCut) return debtPaidLog(name, paid, xp, clearedFullXp);
  if (!paid || (paid.paid <= 0 && paid.burn <= 0)) {
    const xpPart = xp
      ? ` XP was reduced to ${pct(xp.rate)}: +${fmtNum(xp.xp)} XP (from ${fmtNum(xp.base)} XP).`
      : '';
    return {
      kind: 'award',
      hunterId: null,
      title: `Guild cut: ${name}`,
      text: `${name} cleared a gate for ${fmtNum(guildCut.gross)} gold: ${fmtNum(guildCut.taken)} went to ${guildCut.guildName} (${pct(guildCut.rate)}), and ${name} got ${fmtNum(guildCut.kept)}.${xpPart}`,
    };
  }
  const bits: string[] = [];
  if (paid.paid > 0) bits.push(`${fmtNum(paid.paid)} went to System debt`);
  if (paid.burn > 0) bits.push(`${fmtNum(paid.burn)} was lost to debt costs`);
  bits.push(`${fmtNum(guildCut.taken)} went to ${guildCut.guildName} (${pct(guildCut.rate)})`);
  const tail = paid.left > 0 ? `${name} owes ${fmtNum(paid.left)} more.` : `${name} paid off their System debt.`;
  const xpPart = xp
    ? ` XP was reduced to ${pct(xp.rate)}: +${fmtNum(xp.xp)} XP (from ${fmtNum(xp.base)} XP).`
    : paid.left === 0 && clearedFullXp > 0
      ? ` Full XP applied: +${fmtNum(clearedFullXp)} XP.`
      : '';
  return {
    kind: 'award',
    hunterId: null,
    title: `Clear split: ${name}`,
    text: `${name} cleared a gate for ${fmtNum(paid.total)} gold: ${bits.join(', ')}, and ${name} got ${fmtNum(guildCut.kept)}. ${tail}${xpPart}`,
  };
}

/** Plain-language words for the GM Guild dialog, Status sheet, room toasts, and logs. */
export const GUILD_WORDS = {
  button: 'Guild',
  modalTitle: (name: string): string => `Guild: ${name}`,
  archetypeLabel: 'Guild',
  unsignedOption: 'Unsigned (no guild)',
  standingLabel: 'Standing',
  customNameLabel: 'Guild name (optional)',
  customNamePlaceholder: (fallback: string): string => fallback,
  goldCutLabel: 'Custom gold cut % (optional)',
  crystalShareLabel: 'Custom crystal share % (optional)',
  tableDefaultPlaceholder: (rate: number): string => `Table default (${pct(rate)})`,
  save: 'Save guild',
  cancel: 'Cancel',
  logTitle: 'Guild',
  standingUnavailable: (archetype: GuildArchetype, standing: GuildStanding, R: Pick<Rules, 'guilds'> = RULES): string => {
    const allowed = allowedStandings(archetype, R).map(s => GUILD_STANDING_LABELS[s]).join(' or ');
    return `${GUILD_NAMES[archetype]} has no ${GUILD_STANDING_LABELS[standing]} standing. Pick ${allowed}.`;
  },
  previewUnsigned: (unsignedShare: number): string =>
    `Unsigned: 0% clear gold cut, ${pct(unsignedShare)} crystal salvage, Bureau exchange (85%) or Stair fence (70%).`,
  previewSigned: (g: GuildMembership, rank: Rank, R: Pick<Rules, 'crystal' | 'guilds'>): string => {
    const gc = effectiveGoldCut({ rank, guild: g }, R);
    const cs = effectiveCrystalShare({ guild: g }, R);
    return `${guildDisplayName(g)} (${GUILD_STANDING_LABELS[g.standing]}, rank ${rank}): ${pct(gc)} clear gold cut, ${pct(cs)} crystal share, Helix clerk (${pct(R.crystal.rates.helix)}).`;
  },
  savedLocal: (name: string, g: GuildMembership | null): string =>
    (g ? `Assigned ${name} to ${guildDisplayName(g)} (${GUILD_STANDING_LABELS[g.standing]}).` : `Set ${name} to unsigned.`),
  sentRemote: (name: string, g: GuildMembership | null, now: boolean): string => {
    const what = g ? `${guildDisplayName(g)} (${GUILD_STANDING_LABELS[g.standing]})` : 'unsigned';
    return now ? `Updated ${name}'s guild to ${what}.` : `Saved. ${name}'s phone will update to ${what} once the room server confirms it.`;
  },
  playerToast: (g: GuildMembership | null): string =>
    (g ? `The GM assigned you to ${guildDisplayName(g)} (${GUILD_STANDING_LABELS[g.standing]}).` : 'The GM removed you from your guild. You are now unsigned.'),
  badGoldCut: 'Enter a gold cut from 0 to 90%, or leave it blank for the table default.',
  badCrystalShare: 'Enter a crystal share from 0 to 100%, or leave it blank for the table default.',
} as const;
