// mythic-switch.ts: the GM's switch for mythic scripts (`fight.mythic.scripts`) as one step for `store.apply`, the other
// overrides kept. The room's rules doc carries it to the players (hunter/build.ts `roomRulesOf`).
type Overrides = Record<string, unknown>;
const recOf = (v: unknown): Overrides => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Overrides) : {});
const set = (o: Overrides, key: string, v: unknown): Overrides => ({ ...o, [key]: v });
/** The save with the mythic switch set to `on`. */
export const mythicSwitched = <S extends { readonly rulesOverrides: unknown }>(save: S, on: boolean): S => {
  const ov = recOf(save.rulesOverrides), fight = recOf(ov.fight);
  return { ...save, rulesOverrides: set(ov, 'fight', set(fight, 'mythic', set(recOf(fight.mythic), 'scripts', on))) };
};
