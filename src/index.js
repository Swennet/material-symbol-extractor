import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { glob, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_CONFIG_PATH = "material-symbol-extractor.config.json";
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const ICON_NAME_PATTERN = /^[a-z0-9_-]+$/;

function nonEmptyString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function projectRelative(value, name) {
  nonEmptyString(value, name);
  const normalized = value.replaceAll("\\", "/");
  if (
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(value) ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(
      `${name} must be project-relative and must not escape the project root.`,
    );
  }
  return normalized;
}

function sortedRelativeValues(value, name, nonEmpty = false) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    throw new Error(
      `${name} must contain at least one project-relative value.`,
    );
  }
  try {
    return [
      ...new Set(value.map((item) => projectRelative(item, name))),
    ].sort();
  } catch {
    throw new Error(
      `${name} must contain project-relative values that do not escape the project root.`,
    );
  }
}

function sortedIcons(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  for (const icon of value) {
    if (typeof icon !== "string" || !ICON_NAME_PATTERN.test(icon)) {
      throw new Error(`${name} contains invalid icon ${JSON.stringify(icon)}.`);
    }
  }
  return [...new Set(value)].sort();
}

function normalizeConfig(rawConfig, configPath) {
  if (
    rawConfig === null ||
    typeof rawConfig !== "object" ||
    Array.isArray(rawConfig)
  ) {
    throw new Error("configuration must be an object.");
  }

  const projectRoot = path.resolve(
    path.dirname(configPath),
    rawConfig.projectRoot ?? ".",
  );
  const fontOutputPath = path.resolve(
    projectRoot,
    projectRelative(rawConfig.fontOutputPath, "fontOutputPath"),
  );
  const signaturePath = path.resolve(
    projectRoot,
    projectRelative(rawConfig.signaturePath, "signaturePath"),
  );
  if (fontOutputPath === signaturePath)
    throw new Error("fontOutputPath and signaturePath must be different.");

  const googleFont = rawConfig.googleFont;
  if (
    googleFont === null ||
    typeof googleFont !== "object" ||
    Array.isArray(googleFont)
  ) {
    throw new Error("googleFont must be an object.");
  }
  const family = nonEmptyString(googleFont.family, "googleFont.family");
  const familyQuery = nonEmptyString(
    googleFont.familyQuery,
    "googleFont.familyQuery",
  );
  const display = nonEmptyString(googleFont.display, "googleFont.display");
  const axes = googleFont.axes;
  if (
    axes === null ||
    typeof axes !== "object" ||
    Array.isArray(axes) ||
    Object.keys(axes).length === 0
  ) {
    throw new Error("googleFont.axes must be a non-empty object.");
  }
  const normalizedAxes = {};
  for (const key of Object.keys(axes).sort()) {
    normalizedAxes[nonEmptyString(key, "googleFont axis name")] =
      nonEmptyString(axes[key], `googleFont.axes.${key}`);
  }

  if (
    !Array.isArray(rawConfig.entrypoints) ||
    rawConfig.entrypoints.length === 0
  ) {
    throw new Error("entrypoints must contain at least one entrypoint.");
  }
  const entrypoints = rawConfig.entrypoints.map((entrypoint, index) => {
    if (
      entrypoint === null ||
      typeof entrypoint !== "object" ||
      Array.isArray(entrypoint)
    ) {
      throw new Error(`entrypoints[${index}] must be an object.`);
    }
    if (
      !Array.isArray(entrypoint.attributes) ||
      entrypoint.attributes.length === 0
    ) {
      throw new Error(
        `entrypoints[${index}].attributes must contain at least one attribute.`,
      );
    }
    return {
      tag: nonEmptyString(entrypoint.tag, `entrypoints[${index}].tag`),
      attributes: [
        ...new Set(
          entrypoint.attributes.map((attribute) =>
            nonEmptyString(attribute, `entrypoints[${index}].attributes`),
          ),
        ),
      ],
    };
  });

  const requestTimeoutMs =
    rawConfig.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error("requestTimeoutMs must be a positive integer.");
  }

  return {
    configPath,
    projectRoot,
    sourceGlobs: sortedRelativeValues(
      rawConfig.sourceGlobs,
      "sourceGlobs",
      true,
    ),
    excludeGlobs: sortedRelativeValues(
      rawConfig.excludeGlobs ?? [],
      "excludeGlobs",
    ),
    fontOutputPath,
    signaturePath,
    googleFont: {
      family,
      familyQuery,
      display,
      axes: normalizedAxes,
    },
    entrypoints,
    extraIcons: sortedIcons(rawConfig.extraIcons ?? [], "extraIcons"),
    allowedDynamicSourceFiles: sortedRelativeValues(
      rawConfig.allowedDynamicSourceFiles ?? [],
      "allowedDynamicSourceFiles",
    ),
    requestTimeoutMs,
  };
}

export async function loadConfig(configPath = DEFAULT_CONFIG_PATH) {
  const absoluteConfigPath = path.resolve(configPath);
  let rawConfig;

  try {
    rawConfig = JSON.parse(await readFile(absoluteConfigPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to load ${absoluteConfigPath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  return normalizeConfig(rawConfig, absoluteConfigPath);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function openingTags(source, tag) {
  const starts = new RegExp(`<${escapeRegex(tag)}(?=[\\s/>])`, "g");
  const tags = [];
  let match;

  while ((match = starts.exec(source)) !== null) {
    let quote = null;
    let end = match.index + match[0].length;
    for (; end < source.length; end += 1) {
      const character = source[end];
      if (quote === null && (character === '"' || character === "'"))
        quote = character;
      else if (character === quote) quote = null;
      else if (quote === null && character === ">") break;
    }
    if (end === source.length) break;
    tags.push(source.slice(match.index, end + 1));
    starts.lastIndex = end + 1;
  }

  return tags;
}

export async function collectIcons({ config }) {
  const files = new Set();
  for (const pattern of config.sourceGlobs) {
    for await (const file of glob(pattern, { cwd: config.projectRoot })) {
      files.add(file.replaceAll("\\", "/"));
    }
  }
  for (const pattern of config.excludeGlobs) {
    for await (const file of glob(pattern, { cwd: config.projectRoot })) {
      files.delete(file.replaceAll("\\", "/"));
    }
  }

  const icons = new Set();
  const dynamicAssignments = [];
  for (const file of [...files].sort()) {
    const source = (await readFile(path.join(config.projectRoot, file), "utf8"))
      .replace(/{{--[\s\S]*?--}}/g, "")
      .replace(/<!--[\s\S]*?-->/g, "");

    for (const { tag, attributes } of config.entrypoints) {
      const implicitPath = tag.startsWith("x-")
        ? `resources/views/components/${tag.slice(2).replaceAll(".", "/")}.blade.php`
        : null;
      const dynamicAllowed =
        file === implicitPath ||
        config.allowedDynamicSourceFiles.includes(file);

      for (const openingTag of openingTags(source, tag)) {
        for (const attribute of attributes) {
          const assignments = new RegExp(
            `(?:^|\\s)(:${escapeRegex(attribute)}|${escapeRegex(attribute)})\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
            "g",
          );
          let assignment;
          while ((assignment = assignments.exec(openingTag)) !== null) {
            const value = assignment[2] ?? assignment[3];
            if (
              assignment[1].startsWith(":") ||
              value.includes("{{") ||
              value.includes("}}") ||
              !ICON_NAME_PATTERN.test(value)
            ) {
              if (!dynamicAllowed)
                dynamicAssignments.push(
                  `${file}: ${assignment[1]}=${JSON.stringify(value)}`,
                );
            } else {
              icons.add(value);
            }
          }
        }
      }
    }
  }

  if (dynamicAssignments.length > 0) {
    throw new Error(
      `Dynamic or invalid Material Symbol assignments:\n${dynamicAssignments.sort().join("\n")}\nAdd intentional dynamic files to allowedDynamicSourceFiles and their possible values to extraIcons.`,
    );
  }

  const autoDiscoveredIcons = [...icons].sort();
  const extraIcons = [...config.extraIcons];
  return {
    autoDiscoveredIcons,
    extraIcons,
    allIcons: [...new Set([...autoDiscoveredIcons, ...extraIcons])].sort(),
  };
}

export function buildGoogleFontsCssUrl(iconNames, googleFont) {
  const url = new URL("https://fonts.googleapis.com/css2");
  url.searchParams.set("family", googleFont.familyQuery);
  url.searchParams.set("icon_names", iconNames.join(","));
  url.searchParams.set("display", googleFont.display);
  return url.toString();
}

async function readExistingSignature(filename) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(
      `Unable to read existing signature ${filename}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

async function writeAtomically(filename, contents) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, contents);
    await rename(temporaryPath, filename);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function extractWoff2Url(css) {
  const match = css.match(
    /src:\s*url\((['"]?)(https:[^'")]+)\1\)\s*format\((['"])woff2\3\)/i,
  );
  if (!match)
    throw new Error(
      "Unable to find a WOFF2 URL in the Google Fonts CSS response.",
    );
  return match[2];
}

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
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
      },
      signal: AbortSignal.timeout(normalizedConfig.requestTimeoutMs),
    });
    if (!cssResponse.ok) {
      throw new Error(
        `Google Fonts CSS request failed with status ${cssResponse.status}.`,
      );
    }

    const fontResponse = await fetchImplementation(
      extractWoff2Url(await cssResponse.text()),
      {
        signal: AbortSignal.timeout(normalizedConfig.requestTimeoutMs),
      },
    );
    if (!fontResponse.ok) {
      throw new Error(
        `Material Symbols font download failed with status ${fontResponse.status}.`,
      );
    }

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
    throw new Error(`Unable to refresh Material Symbols subset: ${warning}`, {
      cause: error,
    });
  }
}
