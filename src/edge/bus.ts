// The app's event bus, typed by the event table in src/core/events.ts. `src/app.js` puts `on` and `emit` on the app.

import type { AppEvents, EventName } from '../core/events.ts';

/** The payload argument of `emit`: none for an event whose payload is `undefined`. */
type PayloadArg<K extends EventName> = AppEvents[K] extends undefined ? [] : [payload: AppEvents[K]];

export type Bus = {
  on<K extends EventName>(name: K, fn: (payload: AppEvents[K]) => void): void;
  emit<K extends EventName>(name: K, ...payload: PayloadArg<K>): void;
};

/** A bus that calls each listener of an event in the order they were added. A listener that throws is reported to
 * `failed` and the rest still run. */
export function newBus(failed: (name: EventName, error: unknown) => void): Bus {
  type Listener = (payload: unknown) => void; // the table ties each name to its payload; `on` and `emit` keep them together
  const listeners = new Map<EventName, Listener[]>();
  return {
    on(name, fn) { listeners.set(name, [...(listeners.get(name) ?? []), fn as Listener]); },
    emit(name, ...payload) {
      for (const fn of listeners.get(name) ?? []) {
        try { fn(payload[0]); } catch (e) { failed(name, e); }
      }
    },
  };
}
