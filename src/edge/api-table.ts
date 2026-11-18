// api-table.ts: `app.api`, what each module registers under its name (`MODULES` in src/app.js runs each `register`).
// A read of a name no module has registered throws, so a module that reads another's api too early, or after that
// module's register failed, fails where it reads (app.js draws the failed view and logs it) instead of finding
// `undefined` and leaving its buttons doing nothing (audit row 3).

/** The table and the call that ends the boot, after which a missing name can only be a register that failed. */
export type ApiTable<T> = { api: T; booted(): void };

export function apiTable<T extends object>(): ApiTable<T> {
  const held: Record<string, unknown> = {};
  let booting = true;
  const api = new Proxy(held, {
    get(target, name) {
      if (typeof name !== 'string' || Object.hasOwn(target, name)) return Reflect.get(target, name);
      throw new Error(booting
        ? `app.api.${name} is read before its module registered it: list that module earlier in MODULES (src/app.js), or read it later than register`
        : `app.api.${name} is not registered: its module's register failed (logged as register:<module>) or no module registers it`);
    },
  });
  return { api: api as T, booted: () => { booting = false; } };
}
