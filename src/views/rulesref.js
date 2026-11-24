// rulesref.js (U06): searchable Rules reference, rendered live from rules() so GM overrides show immediately. It explains
// the eight stats, their curves, Armor and Resist and the turn order by speed from the numbers of `RULES.fight`.
import { RANKS, RULES, rules } from '../edge/rules.ts';
import { xpToNext as xpToNextOf } from '../core/rules.ts';
import { STAT_KEYS, STAT_LABELS, STAT_SHORT } from '../core/stats.ts';
import { ICON_CREDIT, KEYSTONE_WORDS, armorCutPct, borrowLine, checkExample, crystalLines, crystalRows, deathLine, gatePayLines, guildLines, guildStandingRows, guildSummaryRows, restLines, iconCreditLine, keystoneLines, mythicLines, naturalLines, pointsLine, saleLine, saleRows, dailyPointsLine, soloLines, statBonusLine, stealthLines } from '../core/rules-text.ts';
import { GUILD_TABLE_PERKS, guildDisplayName, guildSheetLine } from '../core/hunter/guild.ts';
import { describeStatus } from '../core/combat/effect-ops.ts';

const STAT_USE = {
  str: 'Physical power, carry, tenacity (with Discipline)',
  agi: 'Speed, Reaction (dodging attacks)',
  vit: 'Max HP, fatigue capacity, a little armor',
  ins: 'Reaction, the opening roll, crits',
  dis: 'Will (resisting curses), resist, tenacity (with Strength), holding a channel',
  pre: 'Support power (heals and shields), threat, shadow capacity',
  pow: 'Magical power, max mana',
  ctl: 'Accuracy, penetration, crit damage, potency, lower ability costs',
};
const fmtX = n => String(Math.round(n * 100) / 100);

const CSS = `
.rr-search{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
.rr-search .field{flex:1 1 220px}
.rr-search input{width:100%}
.rr-credit{margin:14px 0 4px;font-size:12px;color:var(--cyan-dim);text-align:center;overflow-wrap:anywhere}
.rr-credit a{color:inherit;display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px}
.rr-toc{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.rr-toc a{font-size:12px;letter-spacing:.08em;color:var(--cyan-dim);border:1px solid var(--line);padding:4px 8px;text-decoration:none;min-height:32px;display:inline-flex;align-items:center}
.rr-toc a:hover{color:var(--cyan);border-color:var(--cyan)}
.rr-sec h2{scroll-margin-top:12px}
.rr-sec h3{margin:14px 0 6px;font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:var(--cyan-dim)}
.rr-sec ul{margin:0 0 10px;padding-left:20px}
.rr-sec li{margin:3px 0}
.rr-sec p{margin:0 0 8px}
.rr-ex{border-left:3px solid var(--cyan);background:rgba(10,26,46,.6);padding:8px 12px;margin:8px 0;font-size:14px}
.rr-tw{overflow-x:auto;margin:6px 0 10px;max-width:100%}
.rr-tw table{border-collapse:collapse;font-size:13px;min-width:100%}
.rr-tw th,.rr-tw td{border:1px solid var(--line);padding:5px 8px;text-align:left;white-space:nowrap}
.rr-tw th{color:var(--cyan-dim);font-weight:600;letter-spacing:.08em;font-size:12px;text-transform:uppercase;background:rgba(10,26,46,.8)}
.rr-tw td.n{font-family:var(--font-mono)}
.rr-tw td.w{white-space:normal;min-width:120px}
.cs{font-size:13px}.cs-fx{color:var(--cyan-dim)}.cs h3{margin:10px 0 4px}.cs-t{border-collapse:collapse;width:100%}.cs-t caption{text-align:left;color:var(--cyan-dim);font-size:12px;letter-spacing:.08em;padding-bottom:4px}.cs-t th,.cs-t td{border:1px solid var(--line);padding:3px 6px;text-align:center}.cs-t thead th{font-size:12px;color:var(--cyan-dim)}.cs-l{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:2px 12px}.cs-l li{overflow-wrap:anywhere}.cs p{margin:0}
.rr-none{color:var(--muted);font-style:italic}
@media (pointer:coarse),(max-width:720px){.rr-toc a{min-height:44px}}
`;

// Overrides are free-form JSON: any leaf whose type differs from the default falls back to the default.
const guard = (def, v) => {
  if (Array.isArray(def)) return Array.isArray(v) ? v.map((x, i) => (def.length ? guard(def[Math.min(i, def.length - 1)], x) : x)) : def;
  if (def && typeof def === 'object') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return def;
    const out = {};
    for (const k of Object.keys(def)) out[k] = k in v ? guard(def[k], v[k]) : def[k];
    for (const k of Object.keys(v)) if (!(k in def) && k !== '__proto__') out[k] = v[k];
    return out;
  }
  return typeof v === typeof def && (typeof def !== 'number' || Number.isFinite(v)) ? v : def;
};

/** The rules this page reads: each number guarded, the statuses as the rules hold them (each def was read by its parser at load). */
const current = () => ({ ...guard(RULES, rules()), conditions: rules().conditions });
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = n => Number(n).toLocaleString('en-US');

// GM cheat-sheet card (U19): one compact block, every number from rules() so GM overrides show.
export function cheatSheet() {
  const R = current(), sg = n => (n >= 0 ? '+' : '') + n;
  const rows = RANKS.filter(r => R.rankTable[r]).map(r => { const t = R.rankTable[r];
    return `<tr><th scope="row">${esc(r)}</th>${t.dc.map(d => `<td>${esc(d)}</td>`).join('')}<td>${esc(fmtN(t.xp))}</td><td>${esc(sg(R.rankBonus[r]))}</td></tr>`; }).join('');
  const loot = RANKS.filter(r => R.loot[r]).map(r => { const w = R.loot[r].weights, tot = Object.values(w).reduce((a, b) => a + b, 0) || 1;
    return `<li><b>${esc(r)}</b> ${Object.entries(w).map(([k, v]) => `${esc(k[0].toUpperCase() + k.slice(1))} ${Math.round(100 * v / tot)}%`).join(' · ')}</li>`; }).join('');
  const cond = Object.entries(R.conditions).map(([k, c]) => { const fx = describeStatus(c, null, R).join('; ');
    return `<li><b>${esc((c && c.label) || k)}</b> ${esc((c && c.desc) || '')}${fx ? ` <span class="cs-fx">${esc(fx)}</span>` : ''}</li>`; }).join('');
  return `<div class="cs">
    <table class="cs-t"><caption>DC, monster XP and rank bonus by rank</caption><thead><tr><th scope="col">Rank</th><th scope="col">Easy</th><th scope="col">Standard</th><th scope="col">Hard</th><th scope="col">XP</th><th scope="col">Bonus</th></tr></thead><tbody>${rows}</tbody></table>
    <h3>Loot odds by gate rank</h3><ul class="cs-l">${loot}</ul>
    <h3>Rests</h3><p>${esc(restLines(R).slice(0, 2).join(' '))}</p>
    <h3>Statuses</h3><ul class="cs-l">${cond}</ul></div>`;
}

/** @param {import('./app.ts').App} app */
export function register(app) {
  const { store, ui } = app;
  const { esc, fmt } = ui;
  const st = document.createElement('style'); st.dataset.css = 'rulesref'; st.textContent = ui.themed(CSS); document.head.appendChild(st);

  const sg = n => (n >= 0 ? '+' : '') + n;
  const li = t => `<li class="rr">${t}</li>`;
  const ul = items => `<ul>${items.map(li).join('')}</ul>`;
  const p = t => `<p class="rr">${t}</p>`;
  const table = (head, rows) => `<div class="rr-tw"><table><thead><tr>${head.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr class="rr">${r.map((c, i) => `<${i ? 'td' : 'th scope="row"'}${i ? ' class="n"' : ''}>${c}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const dcNames = ['Easy', 'Standard', 'Hard'];

  function sections() {
    const R = current(), F = R.fight, kit = F.kits, xpToNext = l => xpToNextOf(R, l), rt = R.rankTable, rb = R.rankBonus, rl = R.rankLevels;
    const resetHour = store.get().settings.dailyResetHour;
    const ex = checkExample(R), exMod = ex.stat, exRb = ex.rankBonus, exDc = ex.dc, need = ex.need;
    const rankEnd = i => (i < RANKS.length - 1 ? `${rl[RANKS[i + 1]] - 1}` : '+');
    const tr = k => R.conditions[k] || { label: k, desc: '' };
    const lootRows = RANKS.filter(r => R.loot[r]).map(r => {
      const l = R.loot[r], tot = Object.values(l.weights).reduce((a, b) => a + b, 0) || 1;
      return [esc(r), `${fmt(l.gold[0])}–${fmt(l.gold[1])}`, Object.entries(l.weights).map(([k, w]) => `${esc(k)} ${Math.round(100 * w / tot)}%`).join(', ')];
    });
    const sumW = o => Object.values(o).reduce((a, b) => a + b, 0) || 1;
    const pct = (o, k) => Math.round(100 * o[k] / sumW(o));
    return [
      ...(app.isGM() ? [{ id: 'cheat', title: 'GM quick card', body: [`<div class="rr">${cheatSheet()}</div>`] }] : []),
      { id: 'checks', title: 'How checks work', body: [
        p('Roll <b>d20 + check bonus</b> and compare the total to the <b>DC</b> (difficulty class). Meet or beat the DC to succeed.'),
        p(`Check bonus = floor(the stat's effective points above ${F.statBase} / 2) + rank bonus. Rank bonus: ${RANKS.map(r => `${esc(r)} ${sg(rb[r])}`).join(', ')}. ${esc(statBonusLine(R))}`),
        ul([`Fatigue at ${R.fatigue.penaltyAt}% of your fatigue capacity or more: −${R.fatigue.penalty} to all checks. At ${R.fatigue.disAt}%: disadvantage on checks.`,
          `Penalized (failed Daily Quest): −${R.penaltyCheck} to all checks.`,
          'Advantage: roll two d20 and keep the higher. Disadvantage: keep the lower.',
          ...naturalLines().map(esc)]),
        `<div class="rr-ex rr"><b>Worked example.</b> A rank ${esc(ex.rank)} hunter with Strength ${ex.score} (${fmtX(ex.above)} effective points above ${F.statBase}, for a ${sg(exMod)} stat bonus) climbs a wall (${esc(dcNames[1])} ${esc(ex.rank)}-rank DC ${exDc}). Their check bonus is ${sg(exMod)} + ${exRb} (rank) = ${sg(exMod + exRb)}. They need a ${need} or higher on the d20. Rolling ${need} gives ${need} ${sg(exMod + exRb)} = ${need + exMod + exRb}, which meets DC ${exDc}.</div>`,
        `<h3>DC presets by rank</h3>` + table(['Rank', ...dcNames], RANKS.filter(r => rt[r]).map(r => [esc(r), ...rt[r].dc.map(esc)])),
      ] },
      { id: 'stats', title: 'The eight stats', body: [
        p(`Every stat starts at ${F.statBase}. A new hunter has ${F.creationPoints} ability points to spend, and gains ${R.pointsPerLevel} more each level.`),
        table(['Stat', 'Short', 'What it gives'], STAT_KEYS.map(k => [esc(STAT_LABELS[k]), esc(STAT_SHORT[k]), esc(STAT_USE[k])])),
      ] },
      { id: 'curves', title: 'How a stat turns into numbers', body: [ul([
        `<b>Effective points</b> = ${F.statBase} × (score / ${F.statBase}) ^ ${F.effExp}. Doubling a stat gives ${fmtX(Math.pow(2, F.effExp))} times as many effective points, not double. ${keystoneLines(R).length ? esc(keystoneLines(R).join(' ')) : 'Spreading points across several stats is worth about as much as focusing on one.'}`,
        `Physical, magical, and support power equal ${F.powerK} × the effective points of Strength, Power, and Presence. These have no cap, so damage grows with rank.`,
        `<b>Capped stats</b> (such as carry, speed, stat armor, resist, crits, and tenacity) grow from effective points above ${F.statBase}. They reach half their cap at ${F.half} effective points above ${F.statBase} and never reach the full cap.`,
        `<b>Tenacity</b> combines Strength and Discipline using the square root of their product. Equal scores count as that same score, while leaving either stat at ${F.statBase} keeps tenacity low. Control statuses on you last their base duration × (100 + caster's potency) / (100 + your tenacity).`,
        `Max HP = ${F.hpBase} × (1 + (level − 1) / ${F.growthDiv}) × (1 + Vitality's capped share, up to ${F.hpVitCap * 100}%), plus bonuses. Most of it comes from level, so a fight takes about the same number of hits at every rank.`,
        `Max mana = ${F.manaBase} + Power's capped share (up to ${F.manaCap}). Fatigue capacity = ${F.fatigueBase} + Vitality's capped share (up to ${F.fatigueCap}).`,
        'Bonuses come from your active title, equipped gear, build path, and passive skills. Open the Status view to see all your numbers.']),
        ...(keystoneLines(R).length ? [p(`<button type="button" data-rr-ks>${esc(KEYSTONE_WORDS.browseAll)}</button>`)] : []),
      ] },
      { id: 'armor', title: 'Armor and Resist', body: [ul([
        `<b>Armor</b> reduces physical damage and <b>Resist</b> reduces magical damage. Damage dealt = damage × ${F.armorK} / (${F.armorK} + defense). For example, ${kit.heavy.armor} armor cuts damage by ${armorCutPct(R, kit.heavy.armor)}%, and no amount grants full immunity.`,
        `Before that reduction, ${Math.round(F.armorFlat * 100)}% of your defense subtracts directly from each hit, so small hits lose more than large ones.`,
        `<b>Penetration</b> reduces defense first. Armor penetration lowers armor and magic penetration lowers resist by a percentage. Control gives up to ${F.penCap}% of both, and items and perks can raise the total up to ${F.penMax}%. Next, <b>Lethality</b> ignores a flat amount of armor and <b>Unravel</b> ignores a flat amount of resist.`,
        `Most defense comes from gear. A full six-piece set of light gear weighs ${kit.light.weight} (armor ${kit.light.armor}, resist ${kit.light.resist}). Medium weighs ${kit.medium.weight} (${kit.medium.armor}, ${kit.medium.resist}), and heavy weighs ${kit.heavy.weight} (${kit.heavy.armor}, ${kit.heavy.resist}). Higher-rarity gear has the same base armor and resist as common gear, but can have more bonuses and costs more. Carrying more than half your limit slows you, up to ${Math.round(F.loadSlow * 100)}% at full carry.`]),
      ] },
      { id: 'leveling', title: 'Leveling and points', body: [
        p(`XP needed to advance: <b>${esc(R.xpPerLevel)} × current level</b>. XP shows as progress within the current level.`),
        ul([`Level 1 → 2: ${fmt(xpToNext(1))} XP`, `Level 2 → 3: ${fmt(xpToNext(2))} XP`, `Level 9 → 10: ${fmt(xpToNext(9))} XP`, `Level 19 → 20: ${fmt(xpToNext(19))} XP`]),
        ul([`Each level above 1 gives <b>${R.pointsPerLevel}</b> ability points. ${dailyPointsLine(R)}`,
          'Losing a level removes its ability points. Points you already spent stay in your stats, so you do not gain new points until your level catches back up.',
          esc(pointsLine()),
          R.levelUpRestore ? 'Reaching a level for the first time fully restores HP and mana. Regaining a lost level does not.' : 'Leveling up does not restore HP and mana.']),
      ] },
      { id: 'ranks', title: 'Ranks and re-evaluation', body: [
        p('Rank does not increase automatically. When a hunter\'s level reaches the next rank threshold, you see <b>Re-evaluation available</b> in Status. Tap <b>Re-evaluate</b> to promote them.'),
        table(['Rank', 'Levels', 'Rank bonus'], RANKS.map((r, i) => [ui.rankBadge(r), `${esc(rl[r])}${i < RANKS.length - 1 ? '–' + rankEnd(i) : '+'}`, esc(sg(rb[r]))])),
      ] },
      { id: 'ranktable', title: 'Rank table', body: [
        p('DCs, a normal monster\'s XP and the days a gate stays open, by rank.'),
        table(['Rank', 'DC E/S/H', 'XP', 'Break days'], RANKS.filter(r => rt[r]).map(r => [esc(r), rt[r].dc.join('/'), fmt(rt[r].xp), rt[r].breakDays])),
        ul(['Defeated monsters award XP to the hunters who fought them. Outside a gate, each hunter gets the full XP. Inside a gate, hunters split the gate\'s XP (see Gates).']),
      ] },
      { id: 'monsters', title: 'Monsters', body: [
        p(`A monster starts with the stats of a hunter at the lowest level of its rank, split 2 to 1 by archetype. Brutes focus on Strength and Vitality in medium gear, skirmishers on Agility and Strength in light gear, and casters on Power and Control in light gear. Monster kind multiplies max HP, power, armor, and resist. Bosses are tougher because of these higher numbers, not immunity. Stuns, pushes, and curses work on elites and bosses the same way they work on normal monsters.`),
        table(['Monster kind', 'Max HP', 'Power', 'Armor', 'Resist', 'Stagger bar (hits)', 'XP'], Object.entries(F.kinds).map(([k, v]) => [esc(k), `×${v.hp}`, `×${v.power}`, `×${v.armor}`, `×${v.resist}`, v.stagger ? esc(v.stagger) : '-', `×${v.xp}`])),
        p('A trait modifies a monster on top of its kind. It multiplies max HP, armor, and resist, and shifts speed by a percentage.'),
        table(['Trait', 'Max HP', 'Armor', 'Resist', 'Speed', 'XP'], Object.entries(F.traits).map(([k, v]) => [esc(k), `×${v.hp}`, `×${v.armor}`, `×${v.resist}`, v.speed ? `${v.speed > 0 ? '+' : ''}${v.speed}%` : '-', `×${v.xp}`])),
        p('Each monster uses its archetype attack (strike, shot, or curse) plus its own abilities. The monster maker previews the HP, armor, resist, and speed for any rank, archetype, kind, and traits.'),
      ] },
      { id: 'daily', title: 'Daily quests and penalty', body: [
        p(`The daily cycle resets at ${esc(String(resetHour).padStart(2, '0'))}:00 local time. Default daily: <b>${esc(R.dailyTemplate.title)}</b>.`),
        ul(R.dailyTemplate.objectives.map(o => `${esc(o.label)}: ${esc(o.target)}`)),
        p(`Rewards: ${esc(R.dailyTemplate.rewards.xp)} XP, ${esc(R.dailyTemplate.rewards.points)} ability point${R.dailyTemplate.rewards.points === 1 ? '' : 's'}. Completing all dailies raises your streak by 1.`),
        ul(['If the cycle changes with dailies unfinished, the System issues <b>one</b> penalty (even after several missed days) and the streak resets to 0.',
          `The Penalty Zone quest ("Survive for 4 hours") must be completed to clear the penalty. While penalized: −${R.penaltyCheck} to all checks.`]),
      ] },
      { id: 'rest', title: 'Fatigue and rests', body: [
        ul([`Fatigue runs from 0 to your fatigue capacity. At ${R.fatigue.penaltyAt}%, you take −${R.fatigue.penalty} to all checks. At ${R.fatigue.disAt}%, you have disadvantage on checks. At ${R.fatigue.collapseAt}%, you collapse and become Exhausted, unable to act until you rest or clear a gate.`,
          ...restLines(R).map(l => esc(l)),
          esc(deathLine(R))]),
      ] },
      { id: 'conditions', title: 'Statuses', body: [
        table(['Status', 'Effect', 'Mechanics'], Object.keys(R.conditions).map(k => [esc(tr(k).label), esc(tr(k).desc), esc(describeStatus(tr(k), null, R).join('; ') || '-')])),
        p('Numbers that scale by rank use the rank of whoever applied the status.'),
        '<h3>Hiding</h3>' + ul(stealthLines(R).map(esc)),
      ] },
      { id: 'combat', title: 'Fight turn order', body: [
        ul([`Turn order uses <b>speed</b> instead of fixed table rounds. One round is the time a speed-100 fighter needs for one standard action. At speed 200 you act twice per round, and at speed ${F.speedMin} you act once every ${fmtX(100 / F.speedMin)} rounds.`,
          `Speed = ${F.speedBase} + Agility's capped share (up to ${F.speedCap}), slowed by the weight you carry, between ${F.speedMin} and ${F.speedMax}.`,
          `Actions take time. A quick action takes ${F.cost.quick}% of a standard action, and a heavy action takes ${F.cost.heavy}%. Your next turn comes after that delay.`,
          'Everyone starts a fight by rolling a d20 plus their Instinct opening bonus. The highest total acts first.',
          `Strikes, shots, and blasts can be dodged. The target rolls a d20 plus Reaction against your Accuracy to avoid the hit. Curses cannot be dodged, so the target rolls Will and resists on ${F.resistDc} or higher.`,
          'Timed statuses tick in fight time. Their per-round effects apply at the start of the affected target\'s turn based on elapsed time, and the status ends once its rounds run out.']),
      ] },
      ...(R.fight.mythic.scripts ? [{ id: 'mythic', title: 'How a mythic fights', body: mythicLines(R).map(l => p(esc(l))) }] : []),
      { id: 'skills', title: 'Skills and abilities', body: [
        ul([`<b>Active</b> skills are abilities of five kinds: a strike (reach ${F.abilityKinds.strike.range} tile), a shot (range ${F.abilityKinds.shot.range}), a blast (a radius at range ${F.abilityKinds.blast.range}), a curse (range ${F.abilityKinds.curse.range}) and a support (range ${F.abilityKinds.support.range}, on an ally or the user).`,
          'Each ability has a fatigue and mana cost, a speed, and a formula for damage, healing, or shields. Cooldowns are measured in rounds.',
          `<b>Lifesteal</b> from items and perks heals you for that percentage of damage your abilities deal, with no cap (150% heals 1.5 times the damage dealt). Effects that reduce healing also reduce lifesteal. <b>Ability haste</b> divides cooldowns by 1 + (haste / 100). At 100 haste, cooldowns are halved, and at 200 haste they are one-third as long. Cooldowns never drop to zero.`,
          '<b>Passive</b> skills grant their bonus permanently.', 'Skill levels run from 1 to 10. Level 10 shows MAX. Raise skill levels from the Skills panel.']),
      ] },
      { id: 'shadows', title: 'Shadows', body: [
        ul([`Only a Necromancer or Shadow Monarch (${R.extractJobs.map(esc).join(', ')}) can extract shadows from defeated monsters.`,
          `Extraction rolls d20 + Presence check bonus against DC ${R.shadow.dcBase} + ${R.shadow.dcPerRank} × (monster rank − hunter rank) + ${R.shadow.bossDc} for a boss (minimum 5). A natural 20 always succeeds. A natural 1 destroys the corpse. You get up to ${R.shadow.maxAttempts} attempts per corpse.`,
          'On success, the ARISE window opens so you can name the shadow. The shadow keeps the monster\'s rank and archetype. Its grade sets its monster kind: Normal is normal, Elite and Knight are elite, and Commander and Marshal are boss.',
          `Army capacity = floor(${F.shadowPerEff} × Presence's effective points). Summon cost (mana per shadow): ${RANKS.map(r => `${esc(r)} ${esc(R.shadow.summonMp[r])}`).join(', ')}. Unsummoning is free.`]),
      ] },
      { id: 'gates', title: 'Gates', body: [
        table(['Type', 'Notes'], [['Normal', 'A standard dungeon. You may leave at any time.'],
          ['Red', `No exit until the boss dies. DCs inside +${R.gateSpawn.redDcBonus}. Time inside runs ×10.`], ['Double', 'A hidden second dungeon. The GM reveals it.'],
          ['Break', 'A gate that is not cleared by its break day. Its monsters break out into the world.']]),
        p(`Break day = day created + break days by rank (${RANKS.filter(r => rt[r]).map(r => `${esc(r)} ${rt[r].breakDays}`).join(', ')}). The world day advances only with the GM's Advance day button.`),
        ...gatePayLines(R).map(l => p(esc(l))),
        ...soloLines(R).map(l => p(esc(l))),
      ] },
      { id: 'loot', title: 'Loot and rarity', body: [
        table(['Rarity', 'Price', 'Sells for'], saleRows(R).map(r => [`<span style="color:${esc(R.rarities[r.rar].color)}">${esc(r.rar)}</span>`, fmt(r.price), fmt(r.sell)])),
        p(`Prices are in gold. ${esc(saleLine(R))} Gear slots: ${R.slots.map(esc).join(', ')}.`),
        p(esc(borrowLine(R))),
        p(`Clearing a gate awards gold plus one weighted item roll, and a boss adds one extra item roll. Gold is rolled once per clear and split using the Gates rules, so each hunter in a party of ${esc(R.gateParty)} gets the full rolled amount.`),
        table(['Rank', 'Gold', 'Item odds'], lootRows),
      ] },
      { id: 'crystal', title: 'Mana crystal', body: [
        ...crystalLines(R).map(l => p(esc(l))),
        table(['Rank', 'World pool', `Normal (of ${R.gateParty})`, `Red / Double (of ${R.gateParty})`, 'Personal (solo)'],
          crystalRows(R).map(r => [esc(r.rank), fmt(r.pool), fmt(r.normal), fmt(r.special), fmt(r.personal)])),
      ] },
      { id: 'guilds', title: 'Guilds', body: (() => {
        const activeH = store.active();
        const own = activeH && activeH.guild ? activeH.guild : null;
        const ownBlock = own
          ? [
              p(`<b>Your guild:</b> ${esc(guildSheetLine(activeH, R))}. Table perks (GM-run): ${esc(GUILD_TABLE_PERKS[own.archetype].summary)}`),
              `<h3>${esc(guildDisplayName(own))} rates (gold cut by rank and crystal share)</h3>` + table(['Standing', ...RANKS, 'Crystal'],
                guildStandingRows(own.archetype, R).map(row => [esc(row.label), ...RANKS.map(rk => esc(row.goldCuts[rk])), esc(row.crystalShare)])),
            ]
          : [p(`<b>Your guild:</b> ${esc(guildSheetLine(activeH || { rank: 'E', guild: null }, R))}.`)];
        const summary = `<div class="rr-tw"><table><thead><tr><th scope="col">Guild</th><th scope="col">Core C cut</th><th scope="col">Crystal (R / C / A)</th><th scope="col">GM-run table perks</th></tr></thead><tbody>${
          guildSummaryRows(R).map(row => `<tr class="rr"><th scope="row">${esc(row.name)}</th><td class="n">${esc(row.coreCGoldCut)}</td><td class="n">${esc(row.crystalShares)}</td><td class="w">${esc(row.tablePerks)}</td></tr>`).join('')
        }</tbody></table></div>`;
        return [
          ...guildLines(R).map(l => p(esc(l))),
          ...ownBlock,
          '<h3>Guild archetypes (Core C gold cut, crystal share, and GM-run perks)</h3>' + summary,
        ];
      })() },
      { id: 'gm', title: 'GM cheat-sheet', body: [
        ul([`<b>Setting a DC:</b> use the rank table. E-rank uses Easy ${rt.E.dc[0]}, Standard ${rt.E.dc[1]}, and Hard ${rt.E.dc[2]}. Scale up for the party's rank.`,
          '<b>Monster stats on the fly:</b> tap Generate in the Bestiary to build a monster from a rank, archetype, and kind. The monster maker previews its HP, armor, resist, and speed.',
          `<b>Awarding XP:</b> use the monster XP column for each defeated monster. In a fight outside a gate, each hunter gets the full amount. In a fight inside a gate, hunters split the gate's XP (see Gates). A hunter levels up at ${esc(R.xpPerLevel)} × level.`,
          `<b>Random gate:</b> rank odds ${RANKS.map(r => `${esc(r)} ${pct(R.gateSpawn.rank, r)}%`).join(', ')}. Type odds: ${Object.keys(R.gateSpawn.type).map(k => `${esc(k)} ${pct(R.gateSpawn.type, k)}%`).join(', ')}.`,
          'Roll from the Dice tab or the d20 button. Every roll is logged with who rolled it.',
          'Tap the PLAYER button at the top to switch to GM mode for XP grants, free stat edits, and gate and fight tools. In a room, the GM is the person who created it.',
          'The GM can change any number on this page in the GM screen\'s Rules editor, and updates appear here right away.']),
      ] },
    ];
  }

  const link = l => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.text)}</a>`;
  const creditHtml = () => iconCreditLine().replace(ICON_CREDIT.site.text, link(ICON_CREDIT.site)).replace(ICON_CREDIT.licence.text, link(ICON_CREDIT.licence));
  const render = () => sections().map(s => `<section class="win rr-sec" id="rr-${s.id}" data-sec="${esc(s.title)}"><span class="cb"></span><h2>${esc(s.title)}</h2>${s.body.join('')}</section>`).join('');

  function applyFilter(root) {
    const q = root.querySelector('[data-rr-q]').value.trim().toLowerCase();
    let shown = 0;
    root.querySelectorAll('.rr-sec').forEach(sec => {
      const rows = sec.querySelectorAll('.rr');
      if (!q) { sec.hidden = false; rows.forEach(r => { r.hidden = false; }); sec.querySelectorAll('.rr-tw').forEach(t => { t.hidden = false; }); shown++; return; }
      const headHit = sec.dataset.sec.toLowerCase().includes(q);
      let hit = 0;
      rows.forEach(r => { const m = headHit || r.textContent.toLowerCase().includes(q); r.hidden = !m; if (m) hit++; });
      sec.querySelectorAll('.rr-tw').forEach(t => { t.hidden = !t.querySelector('tr.rr:not([hidden])'); });
      sec.hidden = !headHit && !hit; if (!sec.hidden) shown++;
    });
    root.querySelector('[data-rr-none]').hidden = shown > 0;
    root.querySelector('[data-rr-count]').textContent = q ? `${shown} section${shown === 1 ? '' : 's'} match` : '';
  }

  app.registerView({
    id: 'rules', label: 'Rules', icon: '§', order: 80,
    mount(el) {
      el.innerHTML = `<section class="win"><span class="cb"></span><h2>Rules</h2>
        <div class="rr-search">${ui.field('Search the rules', '<input type="text" data-rr-q maxlength="60" placeholder="e.g. fatigue, DC, shadow" autocomplete="off">')}<span class="empty" data-rr-count aria-live="polite"></span></div>
        <nav class="rr-toc" aria-label="Rules sections" data-rr-toc></nav></section>
        <div data-rr-body></div>
        <section class="win" data-rr-none hidden><span class="cb"></span><p class="rr-none">No rules match that search.</p></section>
        <p class="rr-credit" data-rr-credit>${creditHtml()}</p>`;
      el.querySelector('[data-rr-q]').addEventListener('input', () => applyFilter(el));
      el.querySelector('[data-rr-toc]').addEventListener('click', e => {
        const a = e.target.closest('a'); if (!a) return; e.preventDefault();
        const t = el.querySelector(a.getAttribute('data-to')); if (t) t.scrollIntoView({ block: 'start' });
      });
      el.querySelector('[data-rr-body]').addEventListener('click', e => {
        if (e.target.closest('[data-rr-ks]')) app.go('keystones');
      });
    },
    update(el) {
      const h = store.active();
      const sig = JSON.stringify(rules()) + '|' + store.get().settings.dailyResetHour + '|' + app.isGM() + '|' + (h ? `${h.rank}:${JSON.stringify(h.guild)}` : '');
      const body = el.querySelector('[data-rr-body]');
      if (body.dataset.sig === sig) return; body.dataset.sig = sig;
      body.innerHTML = render();
      el.querySelector('[data-rr-toc]').innerHTML = sections().map(s => `<a href="#/rules" data-to="#rr-${esc(s.id)}">${esc(s.title)}</a>`).join('');
      applyFilter(el);
    },
  });
}
