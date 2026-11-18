# qr test notes
- Generator: docs/agent-handoff/p3/make-qr-golden.mjs (9 texts, each jsQR-verified before writing). Fixture: tests/fixtures/qr-golden.json.
- Test: tests/qr.test.ts. Added `json(): Promise<unknown>` to BunFile in types/bun.d.ts. No qr.d.ts needed (tsc passes).
- qrSvg returns null for empty/too-long text (pinned).
- Failure proof: flipped first module of the golden file (1 -> 0), test failed; restored from backup, passes again.
