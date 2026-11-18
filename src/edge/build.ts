/** The id of the build this code came from. `dev` where nothing was built, for example under `bun test`. */
export const BUILD: string = typeof __BUILD__ === 'undefined' ? 'dev' : __BUILD__;
