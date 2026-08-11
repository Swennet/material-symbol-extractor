import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGoogleFontsCssUrl,
  collectIcons,
  loadConfig,
  syncMaterialSymbols,
} from "../src/index.js";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

async function fixture(overrides = {}) {
  const projectDirectory = await mkdtemp(
    path.join(os.tmpdir(), "material-symbol-extractor-"),
  );
  temporaryDirectories.push(projectDirectory);
  const configPath = path.join(
    projectDirectory,
    "material-symbol-extractor.config.json",
  );
  const rawConfig = {
    sourceGlobs: [
      "resources/views/**/*.blade.php",
      "resources/components/**/*.html",
    ],
    excludeGlobs: ["resources/views/generated/**"],
    fontOutputPath: "resources/fonts/icons.woff2",
    signaturePath: "resources/fonts/icons.json",
    googleFont: {
      family: "Material Symbols Rounded",
      familyQuery: "Material Symbols Rounded:FILL,opsz,wght@0..1,20,400",
      display: "swap",
      axes: { wght: "400", FILL: "0..1", opsz: "20" },
    },
    entrypoints: [
      { tag: "x-icon", attributes: ["name", "name"] },
      { tag: "x-button", attributes: ["icon", "icon:trailing"] },
    ],
    extraIcons: ["search", "menu", "search"],
    allowedDynamicSourceFiles: ["resources/views/components/icon.blade.php"],
    ...overrides,
  };
  await writeFile(configPath, JSON.stringify(rawConfig));
  return { configPath, projectDirectory, rawConfig };
}

async function writeProjectFile(projectDirectory, relativePath, contents) {
  const filename = path.join(projectDirectory, relativePath);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, contents);
}

describe("loadConfig", () => {
  it("loads and normalizes a project-relative configuration", async () => {
    const { configPath, projectDirectory } = await fixture();

    const config = await loadConfig(configPath);

    expect(config).toEqual({
      configPath,
      projectRoot: projectDirectory,
      sourceGlobs: [
        "resources/components/**/*.html",
        "resources/views/**/*.blade.php",
      ],
      excludeGlobs: ["resources/views/generated/**"],
      fontOutputPath: path.join(
        projectDirectory,
        "resources/fonts/icons.woff2",
      ),
      signaturePath: path.join(projectDirectory, "resources/fonts/icons.json"),
      googleFont: {
        family: "Material Symbols Rounded",
        familyQuery: "Material Symbols Rounded:FILL,opsz,wght@0..1,20,400",
        display: "swap",
        axes: { FILL: "0..1", opsz: "20", wght: "400" },
      },
      entrypoints: [
        { tag: "x-icon", attributes: ["name"] },
        { tag: "x-button", attributes: ["icon", "icon:trailing"] },
      ],
      extraIcons: ["menu", "search"],
      allowedDynamicSourceFiles: ["resources/views/components/icon.blade.php"],
      requestTimeoutMs: 15000,
    });
  });

  it("resolves the default path from the current working directory", async () => {
    const { configPath } = await fixture();
    const previousDirectory = process.cwd();
    process.chdir(path.dirname(configPath));
    try {
      expect((await loadConfig()).configPath).toBe(
        path.resolve("material-symbol-extractor.config.json"),
      );
    } finally {
      process.chdir(previousDirectory);
    }
  });

  it("includes the config path in JSON errors", async () => {
    const { configPath } = await fixture();
    await writeFile(configPath, "{");
    await expect(loadConfig(configPath)).rejects.toThrow(
      `Unable to load ${configPath}:`,
    );
  });

  it.each([
    ["a non-object config", null, "configuration must be an object"],
    [
      "empty source globs",
      { sourceGlobs: [] },
      "sourceGlobs must contain at least one",
    ],
    [
      "absolute source globs",
      { sourceGlobs: ["/views/**"] },
      "sourceGlobs must contain project-relative",
    ],
    [
      "escaping exclude globs",
      { excludeGlobs: ["../views/**"] },
      "excludeGlobs must contain project-relative",
    ],
    [
      "missing font output",
      { fontOutputPath: undefined },
      "fontOutputPath must be",
    ],
    [
      "escaping font output",
      { fontOutputPath: "../font.woff2" },
      "fontOutputPath must be project-relative",
    ],
    [
      "identical outputs",
      { signaturePath: "resources/fonts/icons.woff2" },
      "must be different",
    ],
    [
      "missing Google font",
      { googleFont: undefined },
      "googleFont must be an object",
    ],
    [
      "invalid Google font",
      {
        googleFont: { family: "", familyQuery: "x", display: "swap", axes: {} },
      },
      "googleFont.family must be",
    ],
    [
      "empty entrypoints",
      { entrypoints: [] },
      "entrypoints must contain at least one",
    ],
    [
      "empty attributes",
      { entrypoints: [{ tag: "x-icon", attributes: [] }] },
      "attributes must contain at least one",
    ],
    [
      "invalid extra icons",
      { extraIcons: ["Not Valid"] },
      "extraIcons contains invalid icon",
    ],
    [
      "absolute dynamic source",
      { allowedDynamicSourceFiles: ["/icon.blade.php"] },
      "allowedDynamicSourceFiles must contain project-relative",
    ],
    [
      "escaping dynamic source",
      { allowedDynamicSourceFiles: ["../icon.blade.php"] },
      "allowedDynamicSourceFiles must contain project-relative",
    ],
    [
      "zero timeout",
      { requestTimeoutMs: 0 },
      "requestTimeoutMs must be a positive integer",
    ],
    [
      "fractional timeout",
      { requestTimeoutMs: 1.5 },
      "requestTimeoutMs must be a positive integer",
    ],
  ])("rejects %s", async (_name, override, message) => {
    const { configPath } = await fixture(override);
    if (override === null) await writeFile(configPath, "null");
    await expect(loadConfig(configPath)).rejects.toThrow(message);
  });
});

describe("collectIcons", () => {
  it("collects exact literal attributes from included Blade and HTML files", async () => {
    const { configPath, projectDirectory } = await fixture();
    await writeProjectFile(
      projectDirectory,
      "resources/views/page.blade.php",
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
    await writeProjectFile(
      projectDirectory,
      "resources/components/card.html",
      "<x-icon name='home' />",
    );
    await writeProjectFile(
      projectDirectory,
      "resources/views/generated/ignored.blade.php",
      '<x-icon name="delete" />',
    );

    expect(
      await collectIcons({ config: await loadConfig(configPath) }),
    ).toEqual({
      autoDiscoveredIcons: ["east", "home", "search", "west"],
      extraIcons: ["menu", "search"],
      allIcons: ["east", "home", "menu", "search", "west"],
    });
  });

  it("allows dynamic values only in implicit component definitions or exact configured files", async () => {
    const { configPath, projectDirectory } = await fixture({
      allowedDynamicSourceFiles: ["resources/views/allowed.blade.php"],
    });
    await writeProjectFile(
      projectDirectory,
      "resources/views/components/button.blade.php",
      '<x-button :icon="$icon" />',
    );
    await writeProjectFile(
      projectDirectory,
      "resources/views/allowed.blade.php",
      '<x-icon :name="$icon" />',
    );
    await writeProjectFile(
      projectDirectory,
      "resources/views/page.blade.php",
      '<x-button icon="arrow_back" />',
    );

    expect(
      (await collectIcons({ config: await loadConfig(configPath) }))
        .autoDiscoveredIcons,
    ).toEqual(["arrow_back"]);
  });

  it("aggregates dynamic and invalid values from every non-allowlisted file", async () => {
    const { configPath, projectDirectory } = await fixture();
    await writeProjectFile(
      projectDirectory,
      "resources/views/one.blade.php",
      '<x-button :icon="$icon" />',
    );
    await writeProjectFile(
      projectDirectory,
      "resources/views/two.blade.php",
      '<x-button icon="{{ $icon }}" />',
    );
    await writeProjectFile(
      projectDirectory,
      "resources/views/three.blade.php",
      '<x-button icon="Not Valid" />',
    );

    await expect(
      collectIcons({ config: await loadConfig(configPath) }),
    ).rejects.toThrow(
      /one\.blade\.php[\s\S]*three\.blade\.php[\s\S]*two\.blade\.php[\s\S]*allowedDynamicSourceFiles[\s\S]*extraIcons/,
    );
  });

  it("handles multiline quotes, exact tag names, and unterminated tags", async () => {
    const { configPath, projectDirectory } = await fixture({ extraIcons: [] });
    await writeProjectFile(
      projectDirectory,
      "resources/views/page.blade.php",
      `
        <x-icon
          name='menu'
        />
        <x-icon name="search" />
        <x-button-group icon="ignored" />
        <x-button icon="east"
      `,
    );

    expect(
      await collectIcons({ config: await loadConfig(configPath) }),
    ).toEqual({
      autoDiscoveredIcons: ["menu", "search"],
      extraIcons: [],
      allIcons: ["menu", "search"],
    });
  });

  it("returns empty arrays when no icons are present", async () => {
    const { configPath, projectDirectory } = await fixture({ extraIcons: [] });
    await writeProjectFile(
      projectDirectory,
      "resources/views/page.blade.php",
      "<main>Empty</main>",
    );
    expect(
      await collectIcons({ config: await loadConfig(configPath) }),
    ).toEqual({
      autoDiscoveredIcons: [],
      extraIcons: [],
      allIcons: [],
    });
  });
});

describe("buildGoogleFontsCssUrl", () => {
  it("encodes the family, icon names, and display mode", async () => {
    const { configPath } = await fixture();
    const config = await loadConfig(configPath);
    expect(buildGoogleFontsCssUrl(["menu", "search"], config.googleFont)).toBe(
      "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded%3AFILL%2Copsz%2Cwght%400..1%2C20%2C400&icon_names=menu%2Csearch&display=swap",
    );
  });
});

function successfulFetch() {
  return vi.fn(async (url) => {
    return String(url).startsWith("https://fonts.googleapis.com/")
      ? new Response(
          '@font-face { src: url("https://fonts.gstatic.com/font.woff2?subset=1") format("woff2"); }',
        )
      : new Response("font-data");
  });
}

async function syncFixture(overrides = {}) {
  const created = await fixture({ extraIcons: ["menu"], ...overrides });
  await writeProjectFile(
    created.projectDirectory,
    "resources/views/page.blade.php",
    '<x-icon name="search" />',
  );
  return { ...created, config: await loadConfig(created.configPath) };
}

describe("syncMaterialSymbols", () => {
  it("downloads the font and writes a deterministic signature atomically", async () => {
    const { config } = await syncFixture();
    const fetch = successfulFetch();

    const result = await syncMaterialSymbols({
      config,
      fetch,
    });

    expect(result.status).toBe("downloaded");
    expect(result.iconCount).toBe(2);
    expect(await readFile(config.fontOutputPath, "utf8")).toBe("font-data");
    const signature = JSON.parse(await readFile(config.signaturePath, "utf8"));
    expect(signature).toEqual({
      hash: result.signatureHash,
      payload: {
        schemaVersion: 1,
        googleFont: config.googleFont,
        entrypoints: config.entrypoints,
        sourceGlobs: config.sourceGlobs,
        excludeGlobs: config.excludeGlobs,
        autoDiscoveredIcons: ["search"],
        extraIcons: ["menu"],
      },
    });
    expect(signature.hash).toBe(
      createHash("sha256")
        .update(JSON.stringify(signature.payload))
        .digest("hex"),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(fetch.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
    expect(fetch.mock.calls[0][1].headers["user-agent"]).toMatch(/Mozilla/);
    expect(await readdir(path.dirname(config.fontOutputPath))).toEqual([
      "icons.json",
      "icons.woff2",
    ]);
  });

  it("returns unchanged without fetching when the signature and font match", async () => {
    const { config } = await syncFixture();
    await syncMaterialSymbols({ config, fetch: successfulFetch() });
    const fetch = vi.fn();

    const result = await syncMaterialSymbols({ config, fetch });

    expect(result.status).toBe("unchanged");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("downloads again when a matching signature has no font", async () => {
    const { config } = await syncFixture();
    await syncMaterialSymbols({ config, fetch: successfulFetch() });
    await rm(config.fontOutputPath);
    const fetch = successfulFetch();
    expect((await syncMaterialSymbols({ config, fetch })).status).toBe(
      "downloaded",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "icon",
      async (projectDirectory) =>
        writeProjectFile(
          projectDirectory,
          "resources/views/page.blade.php",
          '<x-icon name="home" />',
        ),
    ],
    [
      "font",
      async (_projectDirectory, rawConfig) => {
        rawConfig.googleFont.familyQuery += ",500";
      },
    ],
    [
      "entrypoint",
      async (_projectDirectory, rawConfig) => {
        rawConfig.entrypoints.push({ tag: "x-card", attributes: ["icon"] });
      },
    ],
    [
      "include glob",
      async (_projectDirectory, rawConfig) => {
        rawConfig.sourceGlobs.push("templates/**");
      },
    ],
    [
      "exclude glob",
      async (_projectDirectory, rawConfig) => {
        rawConfig.excludeGlobs.push("resources/views/cache/**");
      },
    ],
  ])("changes the signature when %s input changes", async (_name, change) => {
    const { configPath, projectDirectory, rawConfig, config } =
      await syncFixture();
    const initial = await syncMaterialSymbols({
      config,
      fetch: successfulFetch(),
    });
    await change(projectDirectory, rawConfig);
    await writeFile(configPath, JSON.stringify(rawConfig));

    const result = await syncMaterialSymbols({
      configPath,
      fetch: successfulFetch(),
    });

    expect(result.status).toBe("downloaded");
    expect(result.signatureHash).not.toBe(initial.signatureHash);
  });

  it.each([
    ["CSS status", async () => new Response("no", { status: 503 })],
    [
      "font status",
      async (url) =>
        String(url).includes("googleapis")
          ? new Response(
              '@font-face { src: url(https://fonts.gstatic.com/font) format("woff2"); }',
            )
          : new Response("no", { status: 404 }),
    ],
    ["malformed CSS", async () => new Response("body {}")],
    [
      "fetch error",
      async () => {
        throw new Error("offline");
      },
    ],
  ])(
    "rejects a %s refresh failure without an old font",
    async (_name, fetch) => {
      const { config } = await syncFixture();
      await expect(syncMaterialSymbols({ config, fetch })).rejects.toThrow(
        /^Unable to refresh Material Symbols subset: /,
      );
    },
  );

  it("aborts timed-out requests without sleeping", async () => {
    const { config } = await syncFixture({ requestTimeoutMs: 1 });
    const fetch = async (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    await expect(syncMaterialSymbols({ config, fetch })).rejects.toThrow(
      /^Unable to refresh Material Symbols subset: /,
    );
  });

  it("rejects an empty subset before fetching", async () => {
    const { configPath } = await fixture({ extraIcons: [] });
    const fetch = vi.fn();
    await expect(syncMaterialSymbols({ configPath, fetch })).rejects.toThrow(
      "No Material Symbols were discovered.",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns stale only when explicitly allowed and an old font exists", async () => {
    const { config } = await syncFixture();
    await mkdir(path.dirname(config.fontOutputPath), { recursive: true });
    await writeFile(config.fontOutputPath, "old-font");
    const fetch = async () => {
      throw new Error("offline");
    };

    await expect(syncMaterialSymbols({ config, fetch })).rejects.toThrow(
      "offline",
    );
    await expect(
      syncMaterialSymbols({ config, fetch, allowStale: true }),
    ).resolves.toMatchObject({
      status: "stale",
      warning: "offline",
    });
  });

  it("surfaces malformed existing signatures", async () => {
    const { config } = await syncFixture();
    await mkdir(path.dirname(config.signaturePath), { recursive: true });
    await writeFile(config.signaturePath, "{");
    await expect(
      syncMaterialSymbols({ config, fetch: successfulFetch() }),
    ).rejects.toThrow(/Unable to read existing signature/);
  });

  it("leaves the signature untouched when the font write fails", async () => {
    const { config } = await syncFixture();
    await mkdir(path.dirname(config.signaturePath), { recursive: true });
    await writeFile(config.signaturePath, '{"hash":"old"}\n');
    config.fontOutputPath = config.projectRoot;
    await expect(
      syncMaterialSymbols({ config, fetch: successfulFetch() }),
    ).rejects.toThrow(/^Unable to refresh Material Symbols subset: /);
    expect(await readFile(config.signaturePath, "utf8")).toBe(
      '{"hash":"old"}\n',
    );
  });

  it("leaves the old signature when its atomic write fails after the font succeeds", async () => {
    const { config } = await syncFixture();
    const signatureDirectory = path.dirname(config.signaturePath);
    await mkdir(signatureDirectory, { recursive: true });
    await writeFile(config.signaturePath, '{"hash":"old"}\n');
    let request = 0;
    const fetch = async () => {
      request += 1;
      if (request === 1) {
        return new Response(
          '@font-face { src: url(https://fonts.gstatic.com/font) format("woff2"); }',
        );
      }
      return {
        ok: true,
        arrayBuffer: async () => {
          await chmod(signatureDirectory, 0o500);
          return Buffer.from("new-font");
        },
      };
    };
    try {
      await expect(syncMaterialSymbols({ config, fetch })).rejects.toThrow(
        /^Unable to refresh Material Symbols subset: /,
      );
      expect(await readFile(config.signaturePath, "utf8")).toBe(
        '{"hash":"old"}\n',
      );
    } finally {
      await chmod(signatureDirectory, 0o700);
    }
  });

  it("rejects ambiguous config input", async () => {
    const { configPath, config } = await syncFixture();
    await expect(syncMaterialSymbols({ configPath, config })).rejects.toThrow(
      "Provide either configPath or config, not both.",
    );
  });
});
