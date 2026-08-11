# Tech stack
- ECMAScript modules on Node.js 22+.
- npm package: `material-symbol-extractor`.
- Zero runtime dependencies; use Node built-ins for runtime globbing, filesystem, hashing, URLs, fetch, and timeout behavior.
- Development tooling uses Vitest with V8 coverage, ESLint, Prettier, and publint.
- Public surface: root ESM API plus `material-symbol-extractor` CLI binary.