# Material Symbol Extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish an independently verified `material-symbol-extractor` MVP that preserves Nightscribe's configurable Material Symbols discovery, guardrails, signature cache, download, and stale-fallback behavior behind a zero-runtime-dependency CLI and ESM API.

**Architecture:** Keep all reusable runtime behavior in `src/index.js` and the executable adapter in `src/cli.js`. Use Node.js 22 built-ins for runtime concerns they already solve well, and established development packages for testing, coverage, linting, formatting, and published-package validation.

**Tech Stack:** ECMAScript modules, Node.js 22+, npm, Vitest with V8 coverage, ESLint, Prettier, publint, GitHub Actions, Google Fonts CSS2 endpoint.

## Global Constraints

- The package name is `material-symbol-extractor`; check registry availability again immediately before publication.
- Require Node.js 22 or newer and declare no runtime dependencies. Use maintained development dependencies where they replace project-specific testing or quality tooling.
- Export only `loadConfig`, `collectIcons`, `buildGoogleFontsCssUrl`, and `syncMaterialSymbols` from the package root.
- Preserve the Nightscribe scanner's quoted literals, multiline tags, quote-aware `>` handling, Blade/HTML comment stripping, wrapper attributes, implicit wrapper-component allowlisting, supplemental icons, validation, timeout, signature skip, atomic writes, and optional stale fallback.
- Replace Nightscribe's `viewsRoot` walk with normalized `sourceGlobs` and `excludeGlobs`; retain every other configurable behavior under the public names in the design.
- Keep implementation in `src/index.js` and `src/cli.js`; do not add adapters, presets, TypeScript, CommonJS, parsers, plugins, watchers, scaffolding, framework integration, or multiple-font support.
- Never make automated tests depend on live Google Fonts. Inject `fetch` in API tests and preload a stub for CLI subprocess tests.
- Do not modify `/Users/swen/Personal/nightscribe`; its migration begins only after publication and parity verification.
- Do not create worktrees, branches, commits, tags, or other Git state unless the user explicitly requests it.
- Do not publish to npm until the user explicitly authorizes the external write.

---

### Task 1: Package tooling, metadata, and configuration loading

**Files:**

- Create: `package.json`
- Create: `package-lock.json`
- Create: `vitest.config.js`
- Create: `eslint.config.js`
- Create: `.gitignore`
- Create: `.prettierignore`
- Create: `src/index.js`
- Create: `test/index.test.js`

**Interfaces:**

- Consumes: JSON at an absolute or current-working-directory-relative config path.
- Produces: `loadConfig(configPath = "material-symbol-extractor.config.json") => Promise<NormalizedConfig>` where `NormalizedConfig` contains absolute `configPath`, `projectRoot`, `fontOutputPath`, and `signaturePath`; sorted/unique normalized arrays; validated `googleFont`, `entrypoints`, and `requestTimeoutMs`.

- [ ] **Step 1: Create the minimal ESM package manifest**

```json
{
  "name": "material-symbol-extractor",
  "version": "1.0.0",
  "description": "Build a self-hosted Material Symbols font subset from icons used in source files.",
  "type": "module",
  "engines": { "node": ">=22" },
  "exports": "./src/index.js",
  "bin": { "material-symbol-extractor": "./src/cli.js" },
  "files": ["src", "README.md", "CHANGELOG.md", "LICENSE"],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint:package": "publint --strict --pack=false",
    "check": "npm run lint && npm run format:check && npm run test:coverage && npm run lint:package",
    "prepack": "npm run check"
  },
  "keywords": ["material-symbols", "google-fonts", "font-subset", "icons"],
  "license": "MIT",
  "publishConfig": { "access": "public", "provenance": true }
}
```

Do not invent a repository URL while this directory has no Git remote. Add the `repository` field from the real public remote in Task 5 before packaging.

- [ ] **Step 2: Install and lock established development tooling**

Run:

```sh
npm install --save-dev vitest @vitest/coverage-v8 eslint @eslint/js globals prettier publint
```

Expected: `package.json` receives development dependency ranges and `package-lock.json` locks the full reproducible dependency graph. Do not add a runtime `dependencies` block.

- [ ] **Step 3: Configure Vitest coverage**

Create `vitest.config.js`:

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.js"],
      reporter: ["text", "lcov"],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});
```

This includes untested runtime files instead of reporting only modules imported by tests.

- [ ] **Step 4: Configure ESLint, Prettier, and ignored artifacts**

Create `eslint.config.js`:

```js
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["coverage/**", "node_modules/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
  },
];
```

Create `.gitignore`:

```gitignore
node_modules/
coverage/
*.tgz
*.log
.DS_Store
.idea/
.vscode/
```

Create `.prettierignore`:

```gitignore
node_modules/
coverage/
package-lock.json
.serena/
*.tgz
```

Do not add a Prettier configuration when its defaults are sufficient.

- [ ] **Step 5: Write failing configuration tests with Vitest**

Import `afterEach`, `describe`, `expect`, and `it` from `vitest`. Create one temporary project per test with `mkdtemp`, write `material-symbol-extractor.config.json`, and remove it with `rm(..., { recursive: true })` in `afterEach`. Cover this exact normalized shape:

```js
const config = await loadConfig(configPath);

expect(config.configPath).toBe(configPath);
expect(config.projectRoot).toBe(projectDirectory);
expect(config.fontOutputPath).toBe(
  path.join(projectDirectory, "resources/fonts/icons.woff2"),
);
expect(config.signaturePath).toBe(
  path.join(projectDirectory, "resources/fonts/icons.json"),
);
expect(config.sourceGlobs).toEqual([
  "resources/components/**/*.html",
  "resources/views/**/*.blade.php",
]);
expect(config.excludeGlobs).toEqual(["resources/views/generated/**"]);
expect(config.extraIcons).toEqual(["menu", "search"]);
expect(config.allowedDynamicSourceFiles).toEqual([
  "resources/views/components/icon.blade.php",
]);
expect(config.requestTimeoutMs).toBe(15000);
```

Use a table-driven test to assert actionable `Error` messages for a non-object config; empty `sourceGlobs`; absolute or project-root-escaping source/exclude patterns; missing, root-escaping, or identical output paths; missing or invalid `googleFont`; empty entrypoints/attributes; invalid `extraIcons`; absolute or root-escaping dynamic-source paths; and non-positive/non-integer `requestTimeoutMs`. Add a JSON syntax test that includes the config path in the thrown message.

- [ ] **Step 6: Run the focused test and verify failure**

Run: `npm test -- test/index.test.js -t "loadConfig"`

Expected: FAIL because `src/index.js` or `loadConfig` does not exist.

- [ ] **Step 7: Implement minimal configuration validation and normalization**

In `src/index.js`, port the small validation primitives already proven in Nightscribe instead of adding a schema dependency. Keep them private. Normalize separators to `/`, reject absolute or `..`-escaping project-relative paths/patterns, reject identical font/signature destinations, sort and de-duplicate semantically unordered arrays, sort `googleFont.axes` keys, and preserve entrypoint order while de-duplicating each entrypoint's attributes.

```js
const DEFAULT_CONFIG_PATH = "material-symbol-extractor.config.json";
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const ICON_NAME_PATTERN = /^[a-z0-9_-]+$/;

export async function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  const absoluteConfigPath = path.resolve(configPath);
  let rawConfig;

  try {
    rawConfig = JSON.parse(await readFile(absoluteConfigPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to load ${absoluteConfigPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return normalizeConfig(rawConfig, absoluteConfigPath);
}
```

`normalizeConfig` must apply these defaults and resolutions:

```js
const configDirectory = path.dirname(configPath);
const projectRoot = path.resolve(configDirectory, rawConfig.projectRoot ?? ".");

return {
  configPath,
  projectRoot,
  sourceGlobs: sortedRelativePatterns(rawConfig.sourceGlobs, "sourceGlobs", {
    nonEmpty: true,
  }),
  excludeGlobs: sortedRelativePatterns(
    rawConfig.excludeGlobs ?? [],
    "excludeGlobs",
  ),
  fontOutputPath: path.resolve(
    projectRoot,
    relativePath(rawConfig.fontOutputPath, "fontOutputPath"),
  ),
  signaturePath: path.resolve(
    projectRoot,
    relativePath(rawConfig.signaturePath, "signaturePath"),
  ),
  googleFont: normalizedGoogleFont,
  entrypoints: normalizedEntrypoints,
  extraIcons: validatedSortedIcons(rawConfig.extraIcons ?? []),
  allowedDynamicSourceFiles: sortedRelativePaths(
    rawConfig.allowedDynamicSourceFiles ?? [],
  ),
  requestTimeoutMs: rawConfig.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
};
```

- [ ] **Step 8: Run the focused test and verify success**

Run: `npm test -- test/index.test.js -t "loadConfig"`

Expected: PASS with no warnings.

---

### Task 2: Source globbing, icon collection, and Google Fonts URL generation

**Files:**

- Modify: `src/index.js`
- Modify: `test/index.test.js`

**Interfaces:**

- Consumes: the `NormalizedConfig` returned by Task 1.
- Produces: `collectIcons({ config }) => Promise<{ autoDiscoveredIcons: string[], extraIcons: string[], allIcons: string[] }>` and `buildGoogleFontsCssUrl(iconNames, googleFont) => string`.

- [ ] **Step 1: Write failing include/exclude and Nightscribe-parity scanner tests**

Create files under a temporary project and assert that `sourceGlobs` includes both Blade and HTML roots while `excludeGlobs` removes generated matches. Then cover the existing scanner behavior in one focused group:

```js
await writeFile(
  path.join(projectDirectory, "resources/views/page.blade.php"),
  `
  {{-- <x-icon name="commented_blade" /> --}}
  <!-- <x-icon name="commented_html" /> -->
  <x-icon name="search" />
  <x-button
    href="{{ $pagination->pageUrl($page + 1) }}"
    icon="west"
    icon:trailing="east">
    Next
  </x-button>
`,
);

expect(await collectIcons({ config })).toEqual({
  autoDiscoveredIcons: ["east", "search", "west"],
  extraIcons: ["menu", "search"],
  allIcons: ["east", "menu", "search", "west"],
});
```

Add tests that:

- auto-allow `resources/views/components/button.blade.php` for configured tag `x-button`, while still collecting literal call-site values;
- allow exact paths from `allowedDynamicSourceFiles`;
- aggregate every non-allowlisted `:icon="$icon"`, `icon="{{ $icon }}"`, and invalid literal into one `Error` naming all offending files and directing users to `allowedDynamicSourceFiles` and `extraIcons`;
- reject invalid `extraIcons`, return sorted unique arrays, handle single/double quotes and multiline opening tags, ignore prefix tags such as `<x-button-group>`, and stop safely at an unterminated tag;
- return three empty arrays when no icon is found; Task 3 makes an empty synchronization fatal, matching Nightscribe's separation between collection and synchronization.

- [ ] **Step 2: Write the failing URL test**

```js
expect(buildGoogleFontsCssUrl(["menu", "search"], config.googleFont)).toBe(
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded%3AFILL%2Copsz%2Cwght%400..1%2C20%2C400&icon_names=menu%2Csearch&display=swap",
);
```

- [ ] **Step 3: Run the focused tests and verify failure**

Run: `npm test -- test/index.test.js -t "collectIcons|buildGoogleFontsCssUrl"`

Expected: FAIL because both exports are missing.

- [ ] **Step 4: Implement glob expansion with Node's standard library**

Import `glob` from `node:fs/promises`. Expand each include and exclude pattern separately from `config.projectRoot` so the implementation works across the full Node 22 line without relying on later additions to `glob`'s `exclude` option.

```js
const files = new Set();

for (const pattern of config.sourceGlobs) {
  for await (const file of glob(pattern, { cwd: config.projectRoot }))
    files.add(file.replaceAll("\\", "/"));
}

for (const pattern of config.excludeGlobs) {
  for await (const file of glob(pattern, { cwd: config.projectRoot }))
    files.delete(file.replaceAll("\\", "/"));
}
```

Read sorted matches as UTF-8. Keep scanning private and text-based; do not add a parser abstraction.

- [ ] **Step 5: Port the existing conservative scanner as private local logic**

Retain the Nightscribe algorithm, including quote-aware opening-tag extraction and exact attribute matching:

```js
const sanitized = source
  .replace(/{{--[\s\S]*?--}}/g, "")
  .replace(/<!--[\s\S]*?-->/g, "");
const assignmentPattern = new RegExp(
  `(?:^|\\s)(:${escapeRegex(attribute)}|${escapeRegex(attribute)})\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
  "g",
);
```

A value is dynamic when the attribute starts with `:`, contains `{{`/`}}`, or fails `/^[a-z0-9_-]+$/`. Implicitly allow only the configured `x-*` component definition path:

```js
const implicitPath = tag.startsWith("x-")
  ? `resources/views/components/${tag.slice(2).replaceAll(".", "/")}.blade.php`
  : null;
```

After scanning all files, throw one aggregated error if any dynamic assignments remain. Otherwise merge, de-duplicate, validate, and sort the discovered and supplemental lists.

- [ ] **Step 6: Implement URL generation with `URL`**

```js
export function buildGoogleFontsCssUrl(iconNames, googleFont) {
  const url = new URL("https://fonts.googleapis.com/css2");
  url.searchParams.set("family", googleFont.familyQuery);
  url.searchParams.set("icon_names", iconNames.join(","));
  url.searchParams.set("display", googleFont.display);
  return url.toString();
}
```

- [ ] **Step 7: Run the complete test file**

Run: `npm test -- test/index.test.js`

Expected: PASS for configuration, globbing, scanning, guardrails, sorting, and URL generation.

---

### Task 3: Deterministic synchronization, atomic writes, and stale fallback

**Files:**

- Modify: `src/index.js`
- Modify: `test/index.test.js`

**Interfaces:**

- Consumes: `syncMaterialSymbols({ configPath?, config?, fetch?, allowStale? })`, with at most one of `configPath` or an already normalized `config`; when neither is supplied the default config path is used. Default `fetch` is `globalThis.fetch`; default `allowStale` is `false`.
- Produces: `Promise<{ status: "downloaded" | "unchanged" | "stale", iconCount: number, signatureHash: string, cssUrl: string, warning?: string }>`.

- [ ] **Step 1: Write failing successful-download and signature-content tests**

Inject a two-response fetch stub: Google CSS containing a quoted or unquoted `woff2` URL with query parameters, followed by a binary font response. Assert:

```js
expect(result.status).toBe("downloaded");
expect(await readFile(config.fontOutputPath, "utf8")).toBe("font-data");

const signature = JSON.parse(await readFile(config.signaturePath, "utf8"));
expect(signature.hash).toBe(result.signatureHash);
expect(signature.payload).toEqual({
  schemaVersion: 1,
  googleFont: config.googleFont,
  entrypoints: config.entrypoints,
  sourceGlobs: config.sourceGlobs,
  excludeGlobs: config.excludeGlobs,
  autoDiscoveredIcons: ["search"],
  extraIcons: ["menu"],
});
expect(signature.hash).toBe(
  createHash("sha256").update(JSON.stringify(signature.payload)).digest("hex"),
);
```

Assert both requests receive an abort signal, the CSS request receives the existing browser-like user-agent needed for Google Fonts CSS selection, the signature is written after the font succeeds, and no sibling `*.tmp` file remains.

- [ ] **Step 2: Write failing cache, failure, timeout, and stale tests**

Cover these exact outcomes:

- a matching signature plus existing font returns `unchanged`, performs zero fetches, and does not rewrite either file;
- a matching signature without a font downloads again;
- changed icon, font, entrypoint, include glob, or exclude glob input changes the hash and downloads again;
- CSS/font non-2xx responses, malformed CSS, thrown fetch errors, and request timeout reject with `Unable to refresh Material Symbols subset: ...` when no old font exists;
- an empty combined icon list rejects with `No Material Symbols were discovered.` before any request;
- the same refresh failures return `stale` with an actionable `warning` only when `allowStale: true` and an old font exists;
- `allowStale: false` remains fatal even when an old font exists;
- if the font write fails, the signature remains untouched; if the signature write fails after a font succeeds, the old signature remains so the next run retries.

Use an abort-aware timeout stub rather than sleeping:

```js
const fetch = async (_url, { signal }) =>
  new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
```

- [ ] **Step 3: Run synchronization tests and verify failure**

Run: `npm test -- test/index.test.js -t "syncMaterialSymbols"`

Expected: FAIL because `syncMaterialSymbols` is missing.

- [ ] **Step 4: Implement deterministic signature and cache short-circuiting**

Keep signature helpers private. Do not include absolute paths, timestamps, `allowedDynamicSourceFiles`, or `requestTimeoutMs`: those inputs do not alter the downloaded subset. Include source include/exclude behavior because the design explicitly makes it part of the cache key.

```js
const payload = {
  schemaVersion: 1,
  googleFont: config.googleFont,
  entrypoints: config.entrypoints,
  sourceGlobs: config.sourceGlobs,
  excludeGlobs: config.excludeGlobs,
  autoDiscoveredIcons,
  extraIcons,
};
const signatureHash = createHash("sha256")
  .update(JSON.stringify(payload))
  .digest("hex");
```

Read a missing signature as `null`; surface malformed existing JSON as an actionable error rather than silently trusting or deleting it. Return `unchanged` only when both hash and font exist.

- [ ] **Step 5: Implement timeout-bound requests and WOFF2 extraction**

Use the injected fetch consistently for both requests:

```js
const response = await fetchImplementation(url, {
  headers,
  signal: AbortSignal.timeout(config.requestTimeoutMs),
});
```

Retain the proven format-based matcher so extensionless Google Fonts URLs work:

```js
const match = css.match(
  /src:\s*url\((['"]?)(https:[^'")]+)\1\)\s*format\((['"])woff2\3\)/i,
);
if (!match)
  throw new Error(
    "Unable to find a WOFF2 URL in the Google Fonts CSS response.",
  );
```

- [ ] **Step 6: Implement sibling temporary writes and the complete flow**

Create the destination directory, write `.<basename>.<randomUUID>.tmp`, then `rename` it over the destination. On failure, remove only that known temporary file and rethrow. Write the font first and the signature second.

```js
export async function syncMaterialSymbols({
  configPath,
  config,
  fetch: fetchImplementation = globalThis.fetch,
  allowStale = false,
} = {}) {
  if (configPath !== undefined && config !== undefined) {
    throw new Error("Provide either configPath or config, not both.");
  }

  const normalizedConfig = config ?? (await loadConfig(configPath));
  const { autoDiscoveredIcons, extraIcons, allIcons } = await collectIcons({
    config: normalizedConfig,
  });
  if (allIcons.length === 0)
    throw new Error("No Material Symbols were discovered.");

  const payload = {
    schemaVersion: 1,
    googleFont: normalizedConfig.googleFont,
    entrypoints: normalizedConfig.entrypoints,
    sourceGlobs: normalizedConfig.sourceGlobs,
    excludeGlobs: normalizedConfig.excludeGlobs,
    autoDiscoveredIcons,
    extraIcons,
  };
  const signatureHash = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  const cssUrl = buildGoogleFontsCssUrl(allIcons, normalizedConfig.googleFont);
  const existingSignature = await readExistingSignature(
    normalizedConfig.signaturePath,
  );
  const hasExistingFont = existsSync(normalizedConfig.fontOutputPath);

  if (hasExistingFont && existingSignature?.hash === signatureHash) {
    return {
      status: "unchanged",
      iconCount: allIcons.length,
      signatureHash,
      cssUrl,
    };
  }

  try {
    const cssResponse = await fetchImplementation(cssUrl, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(normalizedConfig.requestTimeoutMs),
    });
    if (!cssResponse.ok)
      throw new Error(
        `Google Fonts CSS request failed with status ${cssResponse.status}.`,
      );

    const woff2Url = extractWoff2Url(await cssResponse.text());
    const fontResponse = await fetchImplementation(woff2Url, {
      signal: AbortSignal.timeout(normalizedConfig.requestTimeoutMs),
    });
    if (!fontResponse.ok)
      throw new Error(
        `Material Symbols font download failed with status ${fontResponse.status}.`,
      );

    await writeAtomically(
      normalizedConfig.fontOutputPath,
      Buffer.from(await fontResponse.arrayBuffer()),
    );
    await writeAtomically(
      normalizedConfig.signaturePath,
      `${JSON.stringify({ hash: signatureHash, payload }, null, 2)}\n`,
    );

    return {
      status: "downloaded",
      iconCount: allIcons.length,
      signatureHash,
      cssUrl,
    };
  } catch (error) {
    const warning = error instanceof Error ? error.message : String(error);
    if (allowStale && hasExistingFont) {
      return {
        status: "stale",
        iconCount: allIcons.length,
        signatureHash,
        cssUrl,
        warning,
      };
    }
    throw new Error(`Unable to refresh Material Symbols subset: ${warning}`);
  }
}
```

- [ ] **Step 7: Run the API test suite**

Run: `npm test -- test/index.test.js`

Expected: PASS with no network access and no leaked temporary files.

---

### Task 4: CLI entrypoint and subprocess behavior

**Files:**

- Create: `src/cli.js`
- Create: `test/cli.test.js`

**Interfaces:**

- Consumes: `material-symbol-extractor [config-path]`, current working directory, and `MATERIAL_SYMBOL_EXTRACTOR_ALLOW_STALE=1`.
- Produces: internal `runCli(args?, env?) => Promise<0 | 1>` for direct Vitest coverage, plus one binary success line on stdout for `downloaded`/`unchanged`, a stale-retention warning on stderr, and actionable fatal errors on stderr with exit code `1`. `runCli` is not exported from the package root.

- [ ] **Step 1: Write failing Vitest unit and subprocess tests**

Use `vi.mock`, `vi.spyOn(console, ...)`, and direct `runCli` calls to cover downloaded, unchanged, stale, usage-error, sync-error, and environment-variable branches in `src/cli.js`. Also use a real subprocess to verify the shebang entrypoint, default config filename, and current-working-directory-relative config path:

```js
const env = { ...process.env, NODE_OPTIONS: `--import=${fetchPreloadPath}` };
const args =
  optionalConfigPath === undefined ? [cliPath] : [cliPath, optionalConfigPath];
const result = spawnSync(process.execPath, args, {
  cwd,
  env,
  encoding: "utf8",
});
```

Write the ESM fetch preload into the temporary fixture so no subprocess reaches the network.

Test exact states:

```js
expect(downloaded.status).toBe(0);
expect(downloaded.stdout).toMatch(
  /^Downloaded Material Symbols subset \(2 icons, [a-f0-9]{64}\)\.\n$/,
);
expect(downloaded.stderr).toBe("");

expect(unchanged.status).toBe(0);
expect(unchanged.stdout).toMatch(
  /^Material Symbols subset unchanged \(2 icons, [a-f0-9]{64}\)\.\n$/,
);

expect(stale.status).toBe(0);
expect(stale.stderr).toMatch(
  /^Retained stale Material Symbols subset: offline\n$/,
);

expect(fatal.status).toBe(1);
expect(fatal.stderr).toMatch(/^Material Symbol extraction failed: /);
```

Cover the default config filename, an explicit relative config path resolved from `cwd`, ignored extra CLI arguments only by rejecting them with usage text, and stale fallback disabled for values other than exactly `1`.

- [ ] **Step 2: Run CLI tests and verify failure**

Run: `npm test -- test/cli.test.js`

Expected: FAIL because `src/cli.js` does not exist.

- [ ] **Step 3: Implement the thin CLI adapter**

Use a shebang and no flag parser. Reject more than one positional argument rather than silently accepting a typo.

```js
#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { syncMaterialSymbols } from "./index.js";

export async function runCli(args = process.argv.slice(2), env = process.env) {
  try {
    if (args.length > 1)
      throw new Error("Usage: material-symbol-extractor [config-path]");

    const result = await syncMaterialSymbols({
      configPath: args[0],
      allowStale: env.MATERIAL_SYMBOL_EXTRACTOR_ALLOW_STALE === "1",
    });

    if (result.status === "downloaded") {
      console.log(
        `Downloaded Material Symbols subset (${result.iconCount} icons, ${result.signatureHash}).`,
      );
    } else if (result.status === "unchanged") {
      console.log(
        `Material Symbols subset unchanged (${result.iconCount} icons, ${result.signatureHash}).`,
      );
    } else {
      console.warn(`Retained stale Material Symbols subset: ${result.warning}`);
    }

    return 0;
  } catch (error) {
    console.error(
      `Material Symbol extraction failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

const isDirectInvocation =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

/* v8 ignore next -- exercised by the real subprocess test */
if (isDirectInvocation) process.exitCode = await runCli();
```

- [ ] **Step 4: Run all automated tests**

Run: `npm test`

Expected: PASS for both API and CLI test files with zero live network calls.

---

### Task 5: Consumer documentation and public repository quality

**Files:**

- Create: `README.md`
- Create: `CHANGELOG.md`
- Create: `LICENSE`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`
- Modify: `package.json`

**Interfaces:**

- Consumes: the CLI/API/configuration finalized in Tasks 1-4 and the actual public Git remote.
- Produces: complete npm-facing documentation and provenance-compatible package metadata.

- [ ] **Step 1: Write the MIT license**

Use the standard MIT license text with copyright year `2026` and the package author's real publishing name. Do not copy Nightscribe application licensing into this package.

- [ ] **Step 2: Add repository metadata from the real remote**

After the public repository exists, read its real remote and write that exact value into npm metadata:

```sh
git remote get-url origin
npm pkg set repository.type=git repository.url="$(git remote get-url origin)"
```

This is the only publication-specific value that cannot be resolved from the current non-Git directory. Stop if `origin` is absent or does not point to the intended public package repository.

- [ ] **Step 3: Write the README around one generic config**

Document installation, CLI, four API exports, all fields, dynamic guardrails, stale fallback, build integration, package boundary, and Nightscribe migration. Use this generic config, derived from the working Nightscribe settings without its private component inventory:

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

Include these commands and distinctions verbatim in meaning:

```sh
npm install --save-dev material-symbol-extractor
npx material-symbol-extractor
npx material-symbol-extractor config/material-symbol-extractor.json
MATERIAL_SYMBOL_EXTRACTOR_ALLOW_STALE=1 npx material-symbol-extractor
```

Explain that this package generates a build-time `woff2`; consumers still own `@font-face`, preload/fallback markup, Laravel/PHP services, Vite hooks, and deployment. Include `"prebuild": "material-symbol-extractor"` as the minimal npm integration.

- [ ] **Step 4: Document the exact JavaScript API**

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

State that `fetch` injection is intended for deterministic tooling/tests and that callers may pass `configPath`, normalized `config`, or neither for the default path—but never both.

- [ ] **Step 5: Add the changelog**

Create `CHANGELOG.md` using Keep a Changelog headings and Semantic Versioning links:

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-08-11

### Added

- Configurable source and exclusion globs for Material Symbols discovery.
- Literal icon extraction with dynamic-value guardrails and supplemental icons.
- Deterministic signature caching, Google Fonts subset download, atomic output, and explicit stale fallback.
- ESM API and `material-symbol-extractor` CLI for Node.js 22 and newer.
```

Add the real repository comparison link after Task 5 Step 2 resolves the public remote.

- [ ] **Step 6: Add contributor and security guidance**

Create `CONTRIBUTING.md` with Node.js 22+, `npm ci`, `npm run check`, focused Vitest commands, formatting instructions, the zero-runtime-dependency rule, the four-export public API boundary, and pull-request expectations. Create `SECURITY.md` supporting the latest published major version and directing reports to GitHub private vulnerability reporting; explicitly tell reporters not to open public security issues. Enable private vulnerability reporting under the public repository's **Settings → Security → Code security and analysis** before linking to it from the README.

- [ ] **Step 7: Add GitHub Actions CI and Dependabot**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [22.x, 24.x, 26.x]
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm
      - run: npm ci
      - run: npm pack --dry-run
```

`npm pack --dry-run` invokes `prepack`, so each matrix entry runs the complete check once before inspecting the tarball. Node 22 is the minimum supported version, Node 24 is the current LTS line, and Node 26 is the current release line on August 11, 2026.

Create `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
```

- [ ] **Step 8: Add the publication boundary and Nightscribe migration note**

Reference the source script, config, JS tests, generated font/signature, CSS, service, Blade head, and PHP guardrail tests listed in `docs/superpowers/specs/2026-08-11-material-symbol-extractor-design.md`. State that none are modified until a published package version is independently verified; migration is a separate change.

- [ ] **Step 9: Run documentation-sensitive checks**

Run: `npm run check`

Expected: ESLint, Prettier, Vitest coverage thresholds, and strict publint all pass.

Run: `npm pack --dry-run`

Expected: the tarball contains only `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, `src/index.js`, and `src/cli.js`; tests, contributor/security docs, repository automation, coverage, design docs, `.serena`, and local artifacts are absent.

---

### Task 6: Packed-package smoke test and authorized publication

**Files:**

- No source changes expected.

**Interfaces:**

- Consumes: the npm tarball, Node.js 22, npm authentication, explicit user authorization, and current registry/repository state.
- Produces: an independently verified packed CLI/API and, after approval, the published npm version.

- [ ] **Step 1: Verify the supported runtime and full suite**

Run: `node --version`

Expected: `v22.x.x` or newer.

Run: `npm run check`

Expected: ESLint, Prettier, Vitest coverage, and publint pass together.

- [ ] **Step 2: Pack and install into a temporary consumer**

Run `npm pack --silent`, create a temporary directory with `mktemp -d`, run `npm init -y`, and install the absolute tarball path. Do not install from the registry for this check.

Create the generic Blade fixture/config from Task 5, then seed it by importing the packed API and calling `syncMaterialSymbols` with a two-response injected fetch. Run the installed `node_modules/.bin/material-symbol-extractor`; it must return `unchanged` without a network request. Also run:

```sh
node --input-type=module -e 'import { loadConfig, collectIcons, buildGoogleFontsCssUrl, syncMaterialSymbols } from "material-symbol-extractor"; console.log([loadConfig, collectIcons, buildGoogleFontsCssUrl, syncMaterialSymbols].every(value => typeof value === "function"))'
```

Expected: `true`.

- [ ] **Step 3: Check publish readiness without changing the registry**

Run: `npm whoami`

Expected: the intended npm publishing account.

Run: `npm view material-symbol-extractor version`

Expected before first publication: npm reports that the package is not found. If a package now exists, stop and resolve ownership/name rather than publishing over an unrelated package.

Run: `npm publish --dry-run`

Expected: version `1.0.0`, public access, provenance enabled, and the same six packaged files from Task 5.

- [ ] **Step 4: Obtain explicit publication authorization**

Report the passing test, pack, packed-fixture, account, name-availability, and dry-run results. Wait for the user to explicitly authorize `npm publish`; planning or implementation approval alone is not publication approval.

- [ ] **Step 5: Publish and verify only after authorization**

Run: `npm publish`

Expected: npm accepts `material-symbol-extractor@1.0.0` with public access and provenance according to `publishConfig`.

Run: `npm view material-symbol-extractor@1.0.0 name version engines exports bin dist.integrity`

Expected: registry metadata matches `package.json` and includes a distribution integrity value.

- [ ] **Step 6: Stop at the package boundary**

Report the published version and verification result. Do not install it into Nightscribe or change any Nightscribe file; begin that migration only as a separately authorized task.
