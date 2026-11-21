// rulesref.js (U06): searchable Rules reference, rendered live from rules() so GM overrides show immediately. It explains
// the eight stats, their curves, Armor and Resist and the turn order by speed from the numbers of `RULES.fight`.
import { RANKS, RULES, rules } from '../edge/rules.ts';
import { xpToNext as xpToNextOf } from '../core/rules.ts';
import { STAT_KEYS, STAT_LABELS, STAT_SHORT } from '../core/stats.ts';
import { ICON_CREDIT, armorCutPct, checkExample, downLine, gatePayLines, iconCreditLine, naturalLines, pointsLine, saleLine, saleRows, dailyPointsLine, soloLines, statBonusLine, stealthLines } from '../core/rules-text.ts';
import { describeStatus } from '../core/combat/effect-ops.ts';

const STAT_USE = {
  str: 'Physical power, carry, tenacity (with Discipline)',
  agi: 'Speed, Reaction (dodging what travels)',
  vit: 'Max HP, fatigue capacity, a little armor',
  ins: 'Reaction, the opening roll, crits',
  dis: 'Will (resisting curses), resist, tenacity (with Strength), holding a channel',
  pre: 'Support power (heals and shields), threat, shadow capacity',
  pow: 'Magical power, max mana',
  ctl: 'Accuracy, penetration, crit size, potency, a lower cost',
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
    return `<li><b>${esc(r)}</b> ${Object.entries(w).map(([k, v]) => `${esc(k.slice(0, 4))} ${Math.round(100 * v / tot)}%`).join(' · ')}</li>`; }).join('');
  const cond = Object.entries(R.conditions).map(([k, c]) => { const fx = describeStatus(c, null, R).join('; ');
    return `<li><b>${esc((c && c.label) || k)}</b> ${esc((c && c.desc) || '')}${fx ? ` <span class="cs-fx">${esc(fx)}</span>` : ''}</li>`; }).join('');
  const rs = R.rest.short, rl = R.rest.long;
  return `<div class="cs">
    <table class="cs-t"><caption>DC, monster XP and rank bonus by rank</caption><thead><tr><th scope="col">Rank</th><th scope="col">Easy</th><th scope="col">Std</th><th scope="col">Hard</th><th scope="col">XP</th><th scope="col">Bonus</th></tr></thead><tbody>${rows}</tbody></table>
    <h3>Loot odds by gate rank</h3><ul class="cs-l">${loot}</ul>
    <h3>Rests</h3><p>Short: +${esc(rs.hpPct)}% HP, +${esc(rs.mpPct)}% mana, −${esc(rs.fatigue)}% fatigue. Long: +${esc(rl.hpPct)}% HP and mana, −${esc(rl.fatigue)}% fatigue.</p>
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
        `<div class="rr-ex rr"><b>Worked example.</b> A rank ${esc(ex.rank)} hunter with Strength ${ex.score} (${fmtX(ex.above)} effective points above ${F.statBase}, so ${sg(exMod)}) climbs a wall (${esc(dcNames[1])} ${esc(ex.rank)}-rank DC ${exDc}). Check bonus = ${sg(exMod)} + ${exRb} (rank) = ${sg(exMod + exRb)}. They need a ${need} or higher on the d20: a roll of ${need} gives ${need} ${sg(exMod + exRb)} = ${need + exMod + exRb} ≥ ${exDc}, success.</div>`,
        `<h3>DC presets by rank</h3>` + table(['Rank', ...dcNames], RANKS.filter(r => rt[r]).map(r => [esc(r), ...rt[r].dc.map(esc)])),
      ] },
      { id: 'stats', title: 'The eight stats', body: [
        p(`Every stat starts at ${F.statBase}. A new hunter has ${F.creationPoints} points to place, and ${R.pointsPerLevel} more each level.`),
        table(['Stat', 'Short', 'What it gives'], STAT_KEYS.map(k => [esc(STAT_LABELS[k]), esc(STAT_SHORT[k]), esc(STAT_USE[k])])),
      ] },
      { id: 'curves', title: 'How a stat turns into numbers', body: [ul([
        `<b>Effective points</b> = ${F.statBase} × (score / ${F.statBase}) ^ ${F.effExp}. Doubling a stat gives ${fmtX(Math.pow(2, F.effExp))} times the effective points, not twice as many, so points spread over several stats are worth about as much as points put in one.`,
        `Physical, magical and support power are ${F.powerK} × the effective points of Strength, Power and Presence, with no cap: damage grows with rank.`,
        `<b>A capped number</b> (carry, speed, max HP's share, armor and resist from stats, crits, tenacity and the rest) grows with the effective points above ${F.statBase} and reaches half its cap at ${F.half} of them. It never reaches the cap.`,
        `<b>Tenacity</b> reads Strength and Discipline as one score, the square root of their product: equal scores count as that score, and one left at ${F.statBase} pulls the other far down. A control status on you lasts its duration × (100 + the caster's potency) / (100 + your tenacity).`,
        `Max HP = ${F.hpBase} × (1 + (level − 1) / ${F.growthDiv}) × (1 + Vitality's capped share, up to ${F.hpVitCap * 100}%), plus bonuses. Most of it comes from level, so a fight takes about the same number of hits at every rank.`,
        `Max mana = ${F.manaBase} + Power's capped share (up to ${F.manaCap}). Fatigue capacity = ${F.fatigueBase} + Vitality's capped share (up to ${F.fatigueCap}).`,
        'Bonuses come from the active title, worn items, the build path and passive skills. The Status view shows every number of your sheet.']),
      ] },
      { id: 'armor', title: 'Armor and Resist', body: [ul([
        `<b>Armor</b> reduces physical damage and <b>Resist</b> reduces magical damage. Damage dealt = damage × ${F.armorK} / (${F.armorK} + defense): ${kit.heavy.armor} armor takes ${armorCutPct(R, kit.heavy.armor)}% off, and no amount makes a body immune.`,
        `Before that, ${Math.round(F.armorFlat * 100)}% of the defense comes off every hit as a flat amount, so a weak hit loses more than a strong one.`,
        `<b>Penetration</b> lowers the defense before any of this. Armor penetration works against armor and magic penetration against resist, each a percent of it: Control gives up to ${F.penCap}% of both, items and perks more, never past ${F.penMax}% in all. Then <b>Lethality</b> ignores that many points of armor and <b>Unravel</b> that many of resist, from items and perks.`,
        `Gear gives most of it. A full set of gear: light weighs ${kit.light.weight} (armor ${kit.light.armor}, resist ${kit.light.resist}), medium ${kit.medium.weight} (${kit.medium.armor}, ${kit.medium.resist}), heavy ${kit.heavy.weight} (${kit.heavy.armor}, ${kit.heavy.resist}). Weight over half your carry slows you, up to ${Math.round(F.loadSlow * 100)}% at full carry.`]),
      ] },
      { id: 'leveling', title: 'Leveling and points', body: [
        p(`XP needed to advance: <b>${esc(R.xpPerLevel)} × current level</b>. XP shows as progress within the current level.`),
        ul([`Level 1 → 2: ${fmt(xpToNext(1))} XP`, `Level 2 → 3: ${fmt(xpToNext(2))} XP`, `Level 9 → 10: ${fmt(xpToNext(9))} XP`, `Level 19 → 20: ${fmt(xpToNext(19))} XP`]),
        ul([`Each level above 1 holds <b>${R.pointsPerLevel}</b> ability points. ${dailyPointsLine(R)}`,
          'Losing a level takes its points back. Points already spent stay in your stats, so no new points come until your levels catch up.',
          esc(pointsLine()),
          R.levelUpRestore ? 'Reaching a level for the first time fully restores HP and mana. Regaining a lost level does not.' : 'Leveling up does not restore HP and mana.']),
      ] },
      { id: 'ranks', title: 'Ranks and re-evaluation', body: [
        p('Rank is not automatic. When a hunter’s level reaches the next rank’s threshold, the Status window shows <b>Re-evaluation available</b>; the GM presses <b>Re-evaluate</b> to promote them.'),
        table(['Rank', 'Levels', 'Rank bonus'], RANKS.map((r, i) => [ui.rankBadge(r), `${esc(rl[r])}${i < RANKS.length - 1 ? '–' + rankEnd(i) : '+'}`, esc(sg(rb[r]))])),
      ] },
      { id: 'ranktable', title: 'Rank table', body: [
        p('DCs, a normal monster\'s XP and the days a gate stays open, by rank.'),
        table(['Rank', 'DC E/S/H', 'XP', 'Break days'], RANKS.filter(r => rt[r]).map(r => [esc(r), rt[r].dc.join('/'), fmt(rt[r].xp), rt[r].breakDays])),
        ul(['A defeated monster\'s XP goes to the hunters who fought it: whole to each in a fight started from no gate, shared as the gate\'s pot in a fight started from a gate (see Gates).']),
      ] },
      { id: 'monsters', title: 'Monsters', body: [
        p(`A monster is a hunter of its rank's first level with its points split 2 to 1 by its archetype: a brute Strength and Vitality in medium gear, a skirmisher Agility and Strength in light gear, a caster Power and Control in light gear. Its kind multiplies its max HP and power; a stun, a push or a curse lands on an elite or a boss as on any monster.`),
        table(['Kind', 'Max HP', 'Power', 'Stagger bar (hits)', 'XP'], Object.entries(F.kinds).map(([k, v]) => [esc(k), `×${v.hp}`, `×${v.power}`, v.stagger ? esc(v.stagger) : '—', `×${v.xp}`])),
        p('Each monster attacks with its archetype\'s attack (a strike, a shot or a curse) and its own abilities. The monster maker shows the HP, armor, resist and speed its rank, archetype and kind give.'),
      ] },
      { id: 'daily', title: 'Daily quests and penalty', body: [
        p(`The daily cycle resets at ${esc(String(resetHour).padStart(2, '0'))}:00 local time. Default daily: <b>${esc(R.dailyTemplate.title)}</b>.`),
        ul(R.dailyTemplate.objectives.map(o => `${esc(o.label)}: ${esc(o.target)}`)),
        p(`Rewards: ${esc(R.dailyTemplate.rewards.xp)} XP, ${esc(R.dailyTemplate.rewards.points)} point${R.dailyTemplate.rewards.points === 1 ? '' : 's'}. Completing all dailies raises your streak by 1.`),
        ul(['If the cycle changes with dailies unfinished, the System issues <b>one</b> penalty (even after several missed days) and the streak resets to 0.',
          `The Penalty Zone quest ("Survive for 4 hours") must be completed to clear the penalty. While penalized: −${R.penaltyCheck} to all checks.`]),
      ] },
      { id: 'rest', title: 'Fatigue and rests', body: [
        ul([`Fatigue runs from 0 to your fatigue capacity. At ${R.fatigue.penaltyAt}% of it: −${R.fatigue.penalty} to all checks. At ${R.fatigue.disAt}%: disadvantage on checks. At ${R.fatigue.collapseAt}%: collapse (Exhausted, cannot act until a long rest).`,
          `<b>Short rest</b>: +${R.rest.short.hpPct}% max HP, +${R.rest.short.mpPct}% max mana, −${R.rest.short.fatigue}% of your fatigue capacity.`,
          `<b>Long rest</b>: +${R.rest.long.hpPct}% max HP and mana, −${R.rest.long.fatigue}% of your fatigue capacity, Exhausted cleared (only a long rest clears it).`,
          esc(downLine(R))]),
      ] },
      { id: 'conditions', title: 'Statuses', body: [
        table(['Status', 'Effect', 'Mechanics'], Object.keys(R.conditions).map(k => [esc(tr(k).label), esc(tr(k).desc), esc(describeStatus(tr(k), null, R).join('; ') || '—')])),
        p('A number by rank is read at the rank of whoever put the status on.'),
        '<h3>Hiding</h3>' + ul(stealthLines(R).map(esc)),
      ] },
      { id: 'combat', title: 'Combat turn order', body: [
        ul([`Turns come by <b>speed</b>, not in rounds that go around the table. A round is the time a body of speed 100 needs for one standard action; at speed 200 you act twice a round, at ${F.speedMin} once in ${fmtX(100 / F.speedMin)} rounds.`,
          `Speed = ${F.speedBase} + Agility's capped share (up to ${F.speedCap}), slowed by the weight you carry, between ${F.speedMin} and ${F.speedMax}.`,
          `What you do takes time: a quick action ${F.cost.quick}% of a standard one, a heavy one ${F.cost.heavy}%. Your next turn comes that much later.`,
          'The fight opens with a d20 each, plus Instinct\'s opening bonus: the highest acts first.',
          `A strike, a shot or a blast travels: the target\'s d20 plus its Reaction against your Accuracy decides whether it gets out of the way. A curse does not travel: the target\'s Will resists it on ${F.resistDc} or more.`,
          'Timed statuses run in fight time: their per-round effects are paid at the start of the bearer\'s turn, for the time since they were last paid, and a status ends when its rounds have passed.']),
      ] },
      { id: 'skills', title: 'Skills and abilities', body: [
        ul([`<b>Active</b> skills are abilities of five kinds: a strike (reach ${F.abilityKinds.strike.range} tile), a shot (range ${F.abilityKinds.shot.range}), a blast (a radius at range ${F.abilityKinds.blast.range}), a curse (range ${F.abilityKinds.curse.range}) and a support (range ${F.abilityKinds.support.range}, on an ally or the user).`,
          'Each kind has its cost in fatigue and mana, its pace and a formula for its damage, heal or shield. A cooldown is in rounds.',
          `<b>Lifesteal</b>, from items and perks, heals you that share of the HP your abilities take from others, up to ${Math.round(F.kit.drainMax * 100)}%; what cuts your healing cuts it too. <b>Ability haste</b> takes that share off every cooldown, up to ${Math.round(F.kit.cooldownCutMax * 100)}%, and never takes one to nothing.`,
          '<b>Passive</b> skills grant their bonus permanently.', 'Skill levels run 1–10; level 10 shows MAX. The GM raises levels.']),
      ] },
      { id: 'shadows', title: 'Shadows', body: [
        ul([`Only a Necromancer or Shadow Monarch (${R.extractJobs.map(esc).join(', ')}) can extract shadows from defeated monsters.`,
          `Extraction: d20 + Presence check bonus vs DC = ${R.shadow.dcBase} + ${R.shadow.dcPerRank} × (monster rank − hunter rank) + ${R.shadow.bossDc} if a boss (minimum 5). Natural 20 always succeeds; natural 1 destroys the corpse. Max ${R.shadow.maxAttempts} attempts per corpse.`,
          'Success: the ARISE window, then name the shadow. It keeps the body of the monster it was, its rank and archetype; its grade sets its kind (Normal a normal body, Elite and Knight an elite one, Commander and Marshal a boss\'s).',
          `Army capacity = floor(${F.shadowPerEff} × Presence's effective points). Summon cost (mana per shadow): ${RANKS.map(r => `${esc(r)} ${esc(R.shadow.summonMp[r])}`).join(', ')}. Unsummoning is free.`]),
      ] },
      { id: 'gates', title: 'Gates', body: [
        table(['Type', 'Notes'], [['Normal', 'A standard dungeon. You may leave at any time.'],
          ['Red', `No exit until the boss dies. DCs inside +${R.gateSpawn.redDcBonus}. Time inside runs ×10.`], ['Double', 'A hidden second dungeon; the GM reveals it.'],
          ['Break', 'A gate not cleared by its break day: its monsters come out into the world.']]),
        p(`Break day = day created + break days by rank (${RANKS.filter(r => rt[r]).map(r => `${esc(r)} ${rt[r].breakDays}`).join(', ')}). The world day advances only with the GM’s Advance day button.`),
        ...gatePayLines(R).map(l => p(esc(l))),
        ...soloLines(R).map(l => p(esc(l))),
      ] },
      { id: 'loot', title: 'Loot and rarity', body: [
        table(['Tier', 'Price', 'Sells for'], saleRows(R).map(r => [`<span style="color:${esc(R.rarities[r.rar].color)}">${esc(r.rar)}</span>`, fmt(r.price), fmt(r.sell)])),
        p(`Prices are in gold. ${esc(saleLine(R))} Equipment slots: ${R.slots.map(esc).join(', ')}.`),
        p(`Gate-clear loot: gold plus one weighted item roll; the boss adds one more roll. The gold is rolled once a Clear and shared as the Gates section says, so each hunter of a party of ${esc(R.gateParty)} takes the roll.`),
        table(['Rank', 'Gold', 'Item odds'], lootRows),
      ] },
      { id: 'gm', title: 'GM cheat-sheet', body: [
        ul([`<b>Setting a DC:</b> use the rank table. Easy ${rt.E.dc[0]}, Standard ${rt.E.dc[1]}, Hard ${rt.E.dc[2]} at E-rank; scale up by the party’s rank.`,
          '<b>Monster stats on the fly:</b> the Bestiary\'s Generate makes one from a rank, an archetype and a kind; the monster maker shows its HP, armor, resist and speed.',
          `<b>Awarding XP:</b> use the monster XP column per defeated monster. A fight started from no gate gives each hunter the full amount; a fight started from a gate, and its Clear, share the gate's XP as its pot (see Gates). A hunter levels at ${esc(R.xpPerLevel)} × level.`,
          `<b>Random gate:</b> rank odds ${RANKS.map(r => `${esc(r)} ${pct(R.gateSpawn.rank, r)}%`).join(', ')}; type ${Object.keys(R.gateSpawn.type).map(k => `${esc(k)} ${pct(R.gateSpawn.type, k)}%`).join(', ')}.`,
          'Roll with the Dice tab or the d20 button; every roll is logged with who rolled it.',
          'Tap the PLAYER pill in the header to switch to GM mode for XP grants, free stat edits, gate and fight tools. In a room the GM is the phone that opened it.',
          'The GM can change any number on this page in the GM screen’s Rules editor, and the change shows here at once.']),
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
    },
    update(el) {
      const sig = JSON.stringify([store.get().rulesOverrides, store.get().library.statuses]) + '|' + store.get().settings.dailyResetHour + '|' + app.isGM();
      const body = el.querySelector('[data-rr-body]');
      if (body.dataset.sig === sig) return; body.dataset.sig = sig;
      body.innerHTML = render();
      el.querySelector('[data-rr-toc]').innerHTML = sections().map(s => `<a href="#/rules" data-to="#rr-${esc(s.id)}">${esc(s.title)}</a>`).join('');
      applyFilter(el);
    },
  });
}
