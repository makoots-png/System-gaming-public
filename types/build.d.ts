// scripts/build.ts replaces this name with the build id (Bun `define`) in the app bundle and the service worker.
// It does not exist anywhere else, for example under `bun test`, so read it through src/edge/build.ts.
declare const __BUILD__: string;
