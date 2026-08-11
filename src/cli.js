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
