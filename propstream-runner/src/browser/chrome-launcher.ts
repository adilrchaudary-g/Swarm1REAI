import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";

const CHROME_PATH =
  process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "google-chrome";

/** HTTP GET helper that resolves the response body (or rejects on any error). */
function httpGet(url: string, timeoutMs = 3_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("request timeout"));
    });
  });
}

/**
 * Returns `true` if a Chrome DevTools Protocol endpoint is responding on the
 * given port.
 */
export async function isChromeRunning(port: number): Promise<boolean> {
  try {
    await httpGet(`http://localhost:${port}/json/version`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn a detached Chrome process with `--remote-debugging-port`.
 * The process is `unref()`-ed so Chrome outlives the Node process.
 * Waits up to 15 s for the debug port to become responsive.
 */
export async function launchChrome(options: {
  port: number;
  userDataDir: string;
  headless: boolean;
}): Promise<ChildProcess> {
  const args = [
    `--remote-debugging-port=${options.port}`,
    `--user-data-dir=${options.userDataDir}`,
    "--no-first-run",
    "--disable-background-networking",
  ];

  if (options.headless) {
    args.push("--headless=new");
  }

  const child = spawn(CHROME_PATH, args, {
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  // Poll /json/version until Chrome is ready (timeout 15 s).
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await isChromeRunning(options.port)) {
      return child;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(
    `Chrome did not become responsive on port ${options.port} within 15 s`,
  );
}

/**
 * Ensure a Chrome instance with CDP is running on the given port.
 * If one is already listening, this is a no-op.
 */
export async function ensureChromeRunning(options: {
  port: number;
  userDataDir: string;
  headless: boolean;
}): Promise<void> {
  if (await isChromeRunning(options.port)) return;
  await launchChrome(options);
}

/**
 * Kill the Chrome process listening on the given CDP port.
 * Attempts to discover the PID via the debug endpoint first, then falls back
 * to `lsof` on macOS / `fuser` on Linux.
 */
export async function killChrome(port: number): Promise<void> {
  // Try to find the PID from the OS first — it's the most reliable approach.
  try {
    const { execSync } = await import("node:child_process");
    const cmd =
      process.platform === "darwin"
        ? `lsof -ti tcp:${port}`
        : `fuser ${port}/tcp 2>/dev/null`;

    const output = execSync(cmd, { encoding: "utf-8" }).trim();
    const pids = output
      .split(/\s+/)
      .map(Number)
      .filter((n) => n > 0);

    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Process may have already exited — ignore.
      }
    }

    if (pids.length > 0) return;
  } catch {
    // lsof/fuser failed — continue to soft-kill via /json endpoint.
  }

  // Fallback: hit the /json/version endpoint to at least confirm Chrome is
  // running, then try SIGKILL on the ws debug URL PID path (unlikely to work
  // without OS cooperation, but harmless).
  try {
    await httpGet(`http://localhost:${port}/json/version`, 2_000);
    // If we got here, Chrome is running but we couldn't find its PID.
    // There's no pure-HTTP way to kill it; warn the caller.
    console.warn(
      `[chrome-launcher] Chrome is running on port ${port} but its PID could not be determined. Kill it manually.`,
    );
  } catch {
    // Port not responding — Chrome is already dead.
  }
}
