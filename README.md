# material-symbol-extractor

Build a self-hosted Material Symbols `woff2` subset from icon names used in source files. The package is an ESM-only, zero-runtime-dependency build tool for Node.js 22 and newer.

## Install and run

```sh
npm install --save-dev material-symbol-extractor
npx material-symbol-extractor
npx material-symbol-extractor config/material-symbol-extractor.json
MATERIAL_SYMBOL_EXTRACTOR_ALLOW_STALE=1 npx material-symbol-extractor
```

The default configuration file is `material-symbol-extractor.config.json` in the current working directory. A supplied path is also resolved from the current working directory. To refresh before every build:

```json
{ "scripts": { "prebuild": "material-symbol-extractor" } }
```

## Configuration

```json
{
  "projectRoot": ".",
  "sourceGlobs": ["resources/views/**/*.blade.php"],
  "excludeGlobs": ["resources/views/generated/**"],
  "fontOutputPath": "resources/fonts/MaterialSymbolsRounded-Subset.woff2",
  "signaturePath": "resources/fonts/.material-symbols-signature.json",
  "googleFont": {
    "family": "Material Symbols Rounded",
    "familyQuery": "Material Symbols Rounded:FILL,opsz,wght@0..1,20,400",
    "display": "swap",
    "axes": { "FILL": "0..1", "opsz": "20", "wght": "400" }
  },
  "entrypoints": [
    { "tag": "x-icon", "attributes": ["name"] },
    { "tag": "x-button", "attributes": ["icon", "icon:trailing"] }
  ],
  "extraIcons": ["hourglass_top"],
  "allowedDynamicSourceFiles": ["resources/views/components/icon.blade.php"],
  "requestTimeoutMs": 15000
}
```

- `projectRoot` defaults to the configuration file's directory. All configured source and output paths are relative to it.
- `sourceGlobs` is required. `excludeGlobs`, `extraIcons`, and `allowedDynamicSourceFiles` default to empty arrays.
- `fontOutputPath` and `signaturePath` are required and must differ.
- `googleFont` defines the family request, display mode, and deterministic axis metadata.
- `entrypoints` lists exact tag and attribute names. Tags and quoted attributes may span lines.
- `requestTimeoutMs` defaults to `15000`.

The scanner accepts icon literals such as `<x-icon name="search" />`. It rejects bound values, template expressions, and invalid literals outside allowlisted files. Add files that intentionally forward dynamic values to `allowedDynamicSourceFiles`, then list every runtime-only icon in `extraIcons`. Configured `x-*` component definition paths are allowlisted implicitly.

Stale fallback is off by default. Enable it explicitly with `allowStale: true` in JavaScript or `MATERIAL_SYMBOL_EXTRACTOR_ALLOW_STALE=1` for the CLI. It retains an existing font only when a refresh fails; an initial failure remains fatal.

## JavaScript API

```js
import {
  buildGoogleFontsCssUrl,
  collectIcons,
  loadConfig,
  syncMaterialSymbols,
} from "material-symbol-extractor";

const config = await loadConfig();
const icons = await collectIcons({ config });
const cssUrl = buildGoogleFontsCssUrl(icons.allIcons, config.googleFont);
const result = await syncMaterialSymbols({ config, allowStale: true });
```

The package root exports only these four functions. `syncMaterialSymbols` accepts `configPath`, an already normalized `config`, or neither for the default path—but never both. Its optional `fetch` injection is intended for deterministic tooling and tests.

## Package boundary

This package generates a build-time `woff2`. Consumers still own `@font-face`, preload and fallback markup, Laravel or PHP services, Vite hooks, and deployment behavior. It does not provide adapters, parsers, plugins, watchers, or multiple-font orchestration.

Nightscribe migration is a separate change. Its extractor script, configuration, JavaScript tests, generated font and signature, CSS, service, Blade head markup, and PHP guardrail tests remain unchanged until a published package version is independently verified.
