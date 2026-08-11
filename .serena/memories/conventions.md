# Conventions and boundaries
- MVP only: no parser framework, plugin system, TypeScript build, CommonJS, watcher, config generator, framework preset, or runtime CSS/application integration.
- Keep reusable logic in `src/index.js` and executable handling in `src/cli.js`; add source files only if one module becomes materially hard to understand.
- Public API is limited to `loadConfig`, `collectIcons`, `buildGoogleFontsCssUrl`, and `syncMaterialSymbols`.
- Scanning is explicit, conservative, quoted-literal, text-based, multiline-safe, and must aggregate dynamic-value violations.
- Writes use sibling temporary files plus atomic rename; signature follows successful font write.
- Preserve existing Nightscribe scanning/config behavior while replacing `viewsRoot` with include/exclude source globs.