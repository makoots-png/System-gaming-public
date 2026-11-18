// The app exposes itself as window.hunterApp. Tests use it for setup and for reading state, never for the action under test.
declare const hunterApp: any;
interface Window { hunterApp: any }
