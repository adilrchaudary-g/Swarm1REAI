import { access, rm } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { RunnerConfig } from "../config.js";
import { ensureDir } from "../utils/fs.js";

const RSYNC_EXCLUDES = [
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GrShaderCache",
  "GraphiteDawnCache",
  "ShaderCache",
  "Crashpad",
  "Singleton*",
  "RunningChromeVersion",
  "LOCK",
  "LOG",
  "LOG.old",
  "blob_storage",
  "Service Worker/CacheStorage",
  "Service Worker/ScriptCache",
];

function runRsync(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("rsync", args, {
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`rsync exited with code ${code ?? "unknown"}`));
    });
  });
}

export async function seedRunnerProfileFromChrome(config: RunnerConfig) {
  await access(config.chromeUserDataDir, constants.R_OK);

  const sourceRoot = path.resolve(config.chromeUserDataDir);
  const targetRoot = path.resolve(config.userDataDir);

  await rm(targetRoot, { force: true, recursive: true });
  await ensureDir(targetRoot);

  const args = ["-a"];
  for (const exclude of RSYNC_EXCLUDES) {
    args.push("--exclude", exclude);
    args.push("--exclude", `Default/${exclude}`);
  }
  args.push(`${sourceRoot}/`, `${targetRoot}/`);
  await runRsync(args);
}
