import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/index.js", () => ({ syncMaterialSymbols: vi.fn() }));

import { syncMaterialSymbols } from "../src/index.js";
import { runCli } from "../src/cli.js";

const temporaryDirectories = [];

afterEach(async () => {
  vi.restoreAllMocks();
  syncMaterialSymbols.mockReset();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

describe("runCli", () => {
  it.each([
    [
      "downloaded",
      { status: "downloaded", iconCount: 2, signatureHash: "a".repeat(64) },
      "log",
      `Downloaded Material Symbols subset (2 icons, ${"a".repeat(64)}).`,
    ],
    [
      "unchanged",
      { status: "unchanged", iconCount: 2, signatureHash: "b".repeat(64) },
      "log",
      `Material Symbols subset unchanged (2 icons, ${"b".repeat(64)}).`,
    ],
    [
      "stale",
      {
        status: "stale",
        iconCount: 2,
        signatureHash: "c".repeat(64),
        warning: "offline",
      },
      "warn",
      "Retained stale Material Symbols subset: offline",
    ],
  ])("reports a %s result", async (_name, result, method, message) => {
    syncMaterialSymbols.mockResolvedValue(result);
    const output = vi.spyOn(console, method).mockImplementation(() => {});

    expect(await runCli()).toBe(0);

    expect(output).toHaveBeenCalledWith(message);
  });

  it("rejects extra arguments with usage text", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runCli(["one.json", "two.json"])).toBe(1);
    expect(syncMaterialSymbols).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "Material Symbol extraction failed: Usage: material-symbol-extractor [config-path]",
    );
  });

  it("reports synchronization failures", async () => {
    syncMaterialSymbols.mockRejectedValue(new Error("broken"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runCli()).toBe(1);
    expect(error).toHaveBeenCalledWith(
      "Material Symbol extraction failed: broken",
    );
  });

  it.each([
    ["1", true],
    ["true", false],
    ["0", false],
    [undefined, false],
  ])("maps stale environment value %s to %s", async (value, expected) => {
    syncMaterialSymbols.mockResolvedValue({
      status: "unchanged",
      iconCount: 1,
      signatureHash: "a".repeat(64),
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runCli(["custom.json"], {
      MATERIAL_SYMBOL_EXTRACTOR_ALLOW_STALE: value,
    });
    expect(syncMaterialSymbols).toHaveBeenCalledWith({
      configPath: "custom.json",
      allowStale: expected,
    });
  });
});

async function subprocessFixture(configRelativePath) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "material-symbol-extractor-cli-"),
  );
  temporaryDirectories.push(directory);
  const configPath = path.join(directory, configRelativePath);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({
      projectRoot: path.relative(path.dirname(configPath), directory),
      sourceGlobs: ["resources/views/**/*.blade.php"],
      fontOutputPath: "resources/fonts/icons.woff2",
      signaturePath: "resources/fonts/icons.json",
      googleFont: {
        family: "Material Symbols Rounded",
        familyQuery: "Material Symbols Rounded:FILL,opsz,wght@0..1,20,400",
        display: "swap",
        axes: { FILL: "0..1", opsz: "20", wght: "400" },
      },
      entrypoints: [{ tag: "x-icon", attributes: ["name"] }],
    }),
  );
  await mkdir(path.join(directory, "resources/views"), { recursive: true });
  await writeFile(
    path.join(directory, "resources/views/page.blade.php"),
    '<x-icon name="search" />',
  );
  const preloadPath = path.join(directory, "fetch-preload.mjs");
  await writeFile(
    preloadPath,
    `globalThis.fetch = async (url) => String(url).includes("googleapis")
      ? new Response('@font-face { src: url(https://fonts.gstatic.com/font) format("woff2"); }')
      : new Response("font-data");\n`,
  );
  return { directory, preloadPath };
}

describe("CLI subprocess", () => {
  it.each([
    [
      "the default config filename",
      "material-symbol-extractor.config.json",
      undefined,
    ],
    [
      "an explicit relative config path",
      "config/custom.json",
      "config/custom.json",
    ],
  ])(
    "runs through the dedicated bin entrypoint with %s",
    async (_name, configPath, argument) => {
      const { directory, preloadPath } = await subprocessFixture(configPath);
      const cliPath = path.resolve("src/bin.js");
      const result = spawnSync(
        process.execPath,
        argument === undefined ? [cliPath] : [cliPath, argument],
        {
          cwd: directory,
          env: { ...process.env, NODE_OPTIONS: `--import=${preloadPath}` },
          encoding: "utf8",
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(
        /^Downloaded Material Symbols subset \(1 icons, [a-f0-9]{64}\)\.\n$/,
      );
      expect(result.stderr).toBe("");
    },
  );
});
