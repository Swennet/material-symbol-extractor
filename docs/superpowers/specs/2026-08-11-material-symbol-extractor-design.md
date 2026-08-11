# Material Symbol Extractor Design

## Goal

Create a public, zero-runtime-dependency npm package that scans configurable source files for Material Symbols ligature names and downloads the matching Google Fonts `woff2` subset. The package must support both a command-line interface and a JavaScript API on Node.js 22 or newer.

The package will be developed independently in `/Users/swen/Repositories/NPM/material-symbol-extractor`. Nightscribe must remain unchanged until the package is published to npm. After publication, Nightscribe can install the package and replace its custom extractor in a separate change.

## Existing Nightscribe Behavior

The package will extract and generalize the behavior currently implemented in these absolute paths:

- Script: `/Users/swen/Personal/nightscribe/resources/js/material-symbols/sync-material-icons.mjs`
- Configuration: `/Users/swen/Personal/nightscribe/resources/js/material-symbols/material-symbols.config.json`
- JavaScript tests: `/Users/swen/Personal/nightscribe/tests-js/Unit/material-symbols-sync.test.js`
- npm scripts: `/Users/swen/Personal/nightscribe/package.json`
- Existing operational notes: `/Users/swen/Personal/nightscribe/.docs/material-symbols-self-hosted-subset.md`
- Generated font: `/Users/swen/Personal/nightscribe/resources/fonts/MaterialSymbolsRounded-Subset.woff2`
- Generated signature: `/Users/swen/Personal/nightscribe/resources/fonts/.material-symbols-signature.json`
- Font declaration: `/Users/swen/Personal/nightscribe/resources/css/_fonts.css`
- Icon utility styles: `/Users/swen/Personal/nightscribe/resources/css/utility/_icon.css`
- Runtime fallback decision: `/Users/swen/Personal/nightscribe/app/Services/MaterialSymbolsService.php`
- Runtime preload and fallback markup: `/Users/swen/Personal/nightscribe/resources/views/layouts/_head.blade.php`
- Signature guardrail test: `/Users/swen/Personal/nightscribe/tests/Feature/Performance/FontDisplayGuardrailsTest.php`
- Runtime font-loading tests: `/Users/swen/Personal/nightscribe/tests/Feature/Pages/MaterialSymbolsHeadTest.php`

The npm package owns only source scanning, icon collection, Google Fonts request generation, subset downloading, signature-based skip behavior, and safe file output. Application-specific CSS, Blade markup, PHP fallback behavior, Vite integration, and deployment policy remain the consuming project's responsibility.

## Recommended Shape

Use one small ECMAScript-module package named `material-symbol-extractor`. The name returned `404` from the public npm registry on August 11, 2026, but availability must be checked again immediately before publication. Keep the existing extractor logic as the basis, separate the reusable functions from the executable entrypoint, and do not introduce a parser framework or plugin system.

The package has no runtime dependencies. It uses Node.js 22 APIs for filesystem access, glob expansion, hashing, URL construction, HTTP requests, and atomic file writes.

## Public Interface

### CLI

The package exposes this binary:

```text
material-symbol-extractor [config-path]
```

When no path is supplied, the CLI looks for `material-symbol-extractor.config.json` in the current working directory. A supplied relative path resolves from the current working directory.

Successful output reports whether the subset was downloaded, retained because its signature was unchanged, or retained as a stale fallback after a download failure. Errors go to standard error and produce a non-zero exit code.

The CLI deliberately has no separate flag system in v1. Configuration belongs in the config file, while the optional positional path supports projects with a non-default layout.

### JavaScript API

The root ESM export exposes the minimum useful functions:

- `loadConfig(configPath = "material-symbol-extractor.config.json")` reads, validates, normalizes, and resolves configuration.
- `collectIcons({ config })` expands the normalized configuration's globs, scans matching files, and returns auto-discovered, supplemental, and combined icon lists.
- `buildGoogleFontsCssUrl(iconNames, googleFont)` creates the Google Fonts stylesheet URL.
- `syncMaterialSymbols({ configPath, config, fetch, allowStale })` performs the complete collection, signature, download, and write flow. Callers supply either `configPath` or an already normalized `config`; optional `fetch` injection supports deterministic tests.

All other validation, formatting, filesystem, signature, and parsing functions remain private in v1.

## Configuration

The JSON configuration supports:

- `projectRoot`: base directory for project-relative paths; defaults to the configuration file's directory.
- `sourceGlobs`: one or more Node glob patterns, such as `resources/views/**/*.blade.php`.
- `excludeGlobs`: optional exclusions for generated, dependency, or cache directories.
- `fontOutputPath`: destination for the downloaded `woff2` subset.
- `signaturePath`: destination for the JSON signature.
- `googleFont`: family, family query, display mode, and axis values.
- `entrypoints`: component tags and literal attributes that may contain icon names.
- `extraIcons`: icon ligatures that cannot be statically discovered.
- `allowedDynamicSourceFiles`: source files that intentionally forward or compute icon values.
- `requestTimeoutMs`: request timeout.

Example values should be derived from `/Users/swen/Personal/nightscribe/resources/js/material-symbols/material-symbols.config.json`, but published examples must use generic project paths rather than Nightscribe-specific component names unless explicitly labelled as a Nightscribe migration example.

`sourceGlobs` replaces the current `viewsRoot` directory walk. This makes the package useful for Blade projects with multiple view roots and for other text-based template layouts without introducing template-specific parsers.

## Scanning Rules

The scanner remains explicit, conservative, text-based, and multiline-safe. It does not execute or parse Blade, PHP, or another template language.

For every configured entrypoint, it extracts quoted literal values from configured attributes. It de-duplicates and sorts all discovered icon names before requesting a font subset.

Dynamic attribute values are rejected unless their source file is listed in `allowedDynamicSourceFiles`. An allowed dynamic file is not interpreted; icons that exist only at runtime must be included in `extraIcons`. The error must name every offending source file and direct the user to those two configuration fields.

The scanner must preserve the behavior covered by `/Users/swen/Personal/nightscribe/tests-js/Unit/material-symbols-sync.test.js`, including direct icon literals, wrapper attributes, multiline markup, automatically recognized wrapper component definitions, explicit supplemental icons, and dynamic-value guardrails.

## Synchronization Flow

1. Load and validate configuration.
2. Expand `sourceGlobs`, apply exclusions, and read matching files.
3. Extract literal icons and enforce dynamic-value guardrails.
4. Merge, de-duplicate, validate, and sort discovered and supplemental icons.
5. Build a deterministic signature payload containing a signature-schema version, Google Font settings, configured entrypoints, source-glob behavior, and icon lists.
6. Hash the payload.
7. If the stored signature hash matches and the font exists, return without making a network request or rewriting files.
8. Request Google Fonts CSS with the icon names and configured axes.
9. Extract the `woff2` URL, download the font, and atomically replace the font and signature files.

The signature records enough normalized input to explain why a subset changed. It must not contain timestamps or machine-specific absolute paths because those would make identical projects produce different hashes.

## Error Handling

Configuration errors, an empty final icon list, dynamic values outside the allowlist, malformed Google Fonts CSS, unsuccessful responses, timeouts, and initial download failures are fatal.

If refresh fails and an existing font is present, stale fallback is allowed only when explicitly enabled. The JavaScript API uses `allowStale: true`; the CLI reads `MATERIAL_SYMBOL_EXTRACTOR_ALLOW_STALE=1`. The result and CLI warning must state that the old subset was retained. Any differently named Nightscribe environment variable is translated only during the later migration.

Font and signature writes use temporary sibling files followed by atomic renames. The signature is written only after the font download succeeds, preventing a new signature from describing an old font.

Errors must be ordinary `Error` instances with actionable messages. V1 does not need a custom error hierarchy.

## Testing

Use Vitest for the test runner, assertions, mocks, watch mode, and V8 coverage. Vitest and its coverage provider are development dependencies; the published package keeps zero runtime dependencies. Tests use Vitest's native APIs instead of rebuilding lifecycle, mocking, subprocess, or coverage helpers.

Tests cover:

- configuration defaults, normalization, path resolution, and invalid values;
- configurable include and exclude globs;
- literal extraction for configured tags and attributes;
- multiline markup and quoted values;
- dynamic-value rejection and allowlisting;
- extra icon merging, sorting, and de-duplication;
- deterministic signature payloads and hashes;
- unchanged-signature short-circuiting;
- Google Fonts CSS URL generation and `woff2` URL extraction;
- successful atomic writes;
- fatal initial download failure;
- explicitly enabled stale-font fallback;
- CLI exit codes and messages;
- public ESM imports.

Network behavior is tested with injected `fetch` and temporary directories. Tests must not depend on live Google Fonts responses.

Coverage includes all files under `src/` and enforces explicit line, function, statement, and branch thresholds in `vitest.config.js`. Before publication, run the full Vitest suite with coverage, lint and formatting checks, `publint`, `npm pack --dry-run`, the packed CLI in a minimal fixture project, and the public ESM import smoke test on Node 22.

## Package Contents

Keep the initial package small:

- `package.json`
- `package-lock.json`
- `README.md`
- `CHANGELOG.md`
- `LICENSE`
- `src/index.js`
- `src/cli.js`
- `vitest.config.js`
- `eslint.config.js`
- focused test files and fixtures

Additional source files are justified only when the extractor becomes materially harder to understand as one module. Do not add adapters, framework presets, TypeScript compilation, a plugin API, or a configuration generator in v1.

The package uses established development tooling where it prevents project-specific reinvention: Vitest and `@vitest/coverage-v8` for tests, ESLint for static checks, Prettier for formatting, and `publint` for package validation. Native Node APIs remain preferable for runtime behavior already covered well by Node 22, including globbing, paths, hashing, fetch, timeouts, temporary directories, subprocesses, and atomic rename.

The package metadata declares ESM, Node 22 or newer, the root export, the CLI binary, published files, repository details, license, keywords, and npm provenance-compatible publication settings. The `files` allowlist publishes only runtime source and consumer-facing package documents; tests, coverage output, contributor docs, repository automation, and internal design documents remain outside the tarball.

## Documentation

The README explains installation, quick start, the CLI, the JavaScript API, every configuration field, dynamic-icon handling, stale fallback, build-script integration, troubleshooting, compatibility, contributing/security links, and a compact Blade example.

It must distinguish build-time subset generation from runtime font loading. The package does not add `@font-face`, preload markup, Google Fonts development fallback, Laravel services, or Vite configuration for consumers.

The Nightscribe migration section references the absolute paths listed in this design and explains that migration happens only after the package is published.

`CHANGELOG.md` follows Keep a Changelog and Semantic Versioning, starting with the complete `1.0.0` feature set. `CONTRIBUTING.md` documents local setup, test/lint/format/package checks, scope boundaries, and pull-request expectations. `SECURITY.md` states supported versions and provides a private vulnerability-reporting route rather than asking users to disclose vulnerabilities in public issues.

## Public Repository Quality

Commit `package-lock.json` for reproducible CI. Ignore `node_modules`, coverage output, generated tarballs, logs, editor files, and OS metadata. A GitHub Actions CI workflow runs install, lint, formatting, Vitest coverage, `publint`, and package dry-run checks on the minimum supported Node 22 release and the current maintained Node release. Dependabot keeps GitHub Actions and npm development dependencies current.

Do not add release frameworks, issue-template suites, coverage SaaS, badge collections, or custom Git hooks in v1. Add them only when the repository's contribution or release volume creates a concrete need.

## Publication and Nightscribe Migration Boundary

Package implementation, testing, and npm publication occur entirely in `/Users/swen/Repositories/NPM/material-symbol-extractor`.

Do not modify `/Users/swen/Personal/nightscribe` during package development or publication. After a published version is available, perform a separate Nightscribe change that:

1. installs the published package;
2. changes `/Users/swen/Personal/nightscribe/package.json` to invoke its CLI;
3. keeps or translates `/Users/swen/Personal/nightscribe/resources/js/material-symbols/material-symbols.config.json` into the public configuration format;
4. removes `/Users/swen/Personal/nightscribe/resources/js/material-symbols/sync-material-icons.mjs` only after parity is verified;
5. updates `/Users/swen/Personal/nightscribe/tests-js/Unit/material-symbols-sync.test.js` so package-owned behavior is not redundantly retested while Nightscribe-specific integration remains covered;
6. runs the relevant JavaScript, PHP, font guardrail, and production build checks.

Publishing the package and migrating Nightscribe are separate deliverables. V1 is complete when the public package is published and independently verified; Nightscribe migration starts afterward.

## Explicitly Deferred

- AST parsing for Blade, PHP, Vue, JSX, or other template languages.
- A parser/plugin ecosystem.
- CommonJS exports.
- Node.js versions earlier than 22.
- Automatic CSS, Blade, Laravel, Vite, or deployment integration.
- Watching files or running as a development server.
- Configuration scaffolding or interactive prompts.
- Multiple font families in one synchronization run.
- npm package installation or Nightscribe replacement before publication.
