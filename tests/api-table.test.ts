// `app.api` (src/edge/api-table.ts): a module that reads a name no module registered fails where it reads, saying why,
// instead of finding undefined and leaving its buttons doing nothing (audit row 3).

import { expect, test } from 'bun:test';
import { apiTable } from '../src/edge/api-table.ts';

type Api = { dice: { roll(): number }; coin: { flip(): string } };

test('a name a module registered reads as it was registered', () => {
  const { api } = apiTable<Api>();
  const dice = { roll: () => 4 };
  api.dice = dice;
  expect(api.dice).toBe(dice);
  expect(api.dice.roll()).toBe(4);
});

test('a register that reads a module listed after it fails, naming the module order as the cause', () => {
  const { api } = apiTable<Api>();
  api.dice = { roll: () => 4 };
  expect(() => api.coin.flip()).toThrow('app.api.coin is read before its module registered it: list that module earlier in MODULES');
});

test('after the boot, a name nobody registered fails, naming a failed register as the cause', () => {
  const { api, booted } = apiTable<Api>();
  api.dice = { roll: () => 4 };
  booted();
  expect(() => api.coin).toThrow("app.api.coin is not registered: its module's register failed");
  expect(api.dice.roll()).toBe(4);
});
