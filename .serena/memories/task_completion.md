# Completion checks
- Run the complete quality gate: `npm run check` (ESLint, Prettier, Vitest coverage, publint).
- Verify publish contents: `npm pack --dry-run`.
- Pack the package and run its CLI from a temporary minimal fixture with a stubbed/local deterministic test flow; do not rely on live Google Fonts in automated tests.
- Confirm public ESM imports and CLI behavior on Node.js 22.
- Do not claim npm publication or migrate Nightscribe as part of implementation unless separately requested.