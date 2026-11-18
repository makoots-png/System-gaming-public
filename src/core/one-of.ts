/** `v` when it is one of `list`, else `fallback`. A stored or typed choice (a save field, a select, a data attribute) is read with it. */
export const oneOf = <T, D = T>(v: unknown, list: readonly T[], fallback: D): T | D => ((list as readonly unknown[]).includes(v) ? (v as T) : fallback);
