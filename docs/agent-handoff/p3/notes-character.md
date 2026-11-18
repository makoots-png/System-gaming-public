# character.e2e.ts notes
- 14 checks ported into 10 tests (merged: chip+healing; remote board+remote combat; level-down pair; poisoned attack+1d4).
- No fixme. Added switchToPlayerMode to tests/e2e/helpers.ts (appended).
- Remote combat removal still uses a fixed 6s wait (no observable signal), as in the old script.
- Parallel runs share test-results/ and wipe each other (ENOENT, timeouts); use --output=/tmp/pw-character.
