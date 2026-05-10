/**
 * Track C: Chrome Cookie DB Extraction + Decryption (macOS)
 *
 * Reads PropStream cookies directly from Chrome's SQLite database,
 * decrypts them using the macOS Keychain-stored Chrome Safe Storage key,
 * and returns them in Playwright-compatible format for injection.
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type PlaywrightCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number; // Unix epoch seconds, -1 for session
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
};

/** Delimiter used for sqlite3 column separation — unlikely to appear in cookie values. */
const SQLITE_DELIM = "|~|";

/** Chrome epoch offset: microseconds between 1601-01-01 and 1970-01-01. */
const CHROME_EPOCH_OFFSET = 11_644_473_600n;

/** Map Chrome's samesite integer to Playwright string. */
const SAMESITE_MAP: Record<number, PlaywrightCookie["sameSite"]> = {
  0: "None",
  1: "Lax",
  2: "Strict",
};

/**
 * Retrieve the Chrome Safe Storage password from the macOS Keychain.
 */
function getChromeKeychainPassword(): string {
  const raw = execFileSync("security", [
    "find-generic-password",
    "-w",
    "-s",
    "Chrome Safe Storage",
  ]);
  return raw.toString("utf-8").trim();
}

/**
 * Derive the AES-128-CBC key from the Chrome Safe Storage password.
 * Chrome on macOS uses PBKDF2 with "saltysalt", 1003 iterations, SHA-1, 16-byte key.
 */
function deriveDecryptionKey(password: string): Buffer {
  return crypto.pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
}

/**
 * Decrypt a Chrome encrypted_value.
 *
 * Format: "v10" prefix (3 bytes) + AES-128-CBC ciphertext.
 * IV is 16 bytes of 0x20 (space character).
 */
function decryptCookieValue(encryptedHex: string, key: Buffer): string {
  if (!encryptedHex || encryptedHex.length === 0) return "";

  const encrypted = Buffer.from(encryptedHex, "hex");

  // Must start with "v10" (hex 763130)
  if (encrypted.length < 4 || encrypted.subarray(0, 3).toString("ascii") !== "v10") {
    // Not a v10 encrypted value — return empty (caller should use plaintext `value`)
    return "";
  }

  const ciphertext = encrypted.subarray(3);
  const iv = Buffer.alloc(16, 0x20); // 16 bytes of space character

  const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
  decipher.setAutoPadding(true);

  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf-8");
  } catch {
    // Decryption failed — cookie may be corrupted or use a different scheme
    return "";
  }
}

/**
 * Convert Chrome's expires_utc (microseconds since 1601-01-01) to Unix epoch seconds.
 * Returns -1 for session cookies (expires_utc === 0).
 */
function chromeExpiryToUnix(expiresUtc: string): number {
  const raw = BigInt(expiresUtc || "0");
  if (raw === 0n) return -1;
  return Number(raw / 1_000_000n - CHROME_EPOCH_OFFSET);
}

/**
 * Copy the Chrome Cookies DB (and WAL journal files) to a temp directory.
 * Chrome holds a lock on the DB while running, so we must work from a copy.
 */
function copyDbToTemp(dbPath: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chrome-cookies-"));
  const tmpDb = path.join(tmpDir, "Cookies");

  fs.copyFileSync(dbPath, tmpDb);

  // Copy WAL journal files if they exist (needed for consistency)
  for (const suffix of ["-wal", "-shm"]) {
    const journalPath = dbPath + suffix;
    if (fs.existsSync(journalPath)) {
      fs.copyFileSync(journalPath, tmpDb + suffix);
    }
  }

  return tmpDb;
}

/**
 * Clean up the temporary DB copy and its journal files.
 */
function cleanupTempDb(tmpDb: string): void {
  const tmpDir = path.dirname(tmpDb);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}

/**
 * Build the WHERE clause for domain filtering.
 * Each domain in the filter generates a `host_key LIKE '%domain%'` condition.
 */
function buildDomainFilter(domains: string[]): string {
  if (domains.length === 0) return "1=1";
  return domains.map((d) => `host_key LIKE '%${d.replace(/'/g, "''")}'`).join(" OR ");
}

/**
 * Extract cookies from Chrome's SQLite database and decrypt them.
 *
 * @param dbPath - Path to Chrome's Cookies SQLite DB
 * @param domainFilter - Array of domains to filter (e.g., [".propstream.com", "app.propstream.com"])
 * @returns Array of decrypted cookies in Playwright format
 */
export async function extractChromeCookies(
  dbPath: string,
  domainFilter: string[],
): Promise<PlaywrightCookie[]> {
  // 1. Copy DB to temp location (Chrome locks the original)
  const tmpDb = copyDbToTemp(dbPath);

  try {
    // 2. Query cookies via sqlite3 CLI
    const whereClause = buildDomainFilter(domainFilter);
    const sql = `SELECT host_key, name, value, hex(encrypted_value), path, expires_utc, is_secure, is_httponly, samesite FROM cookies WHERE ${whereClause};`;

    let rawOutput: string;
    try {
      rawOutput = execFileSync("sqlite3", ["-separator", SQLITE_DELIM, tmpDb, sql], {
        encoding: "utf-8",
        timeout: 10_000,
      });
    } catch (err) {
      throw new Error(
        `Failed to query Chrome Cookies DB: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const lines = rawOutput.trim().split("\n").filter(Boolean);

    if (lines.length === 0) {
      return [];
    }

    // 3. Get Chrome Safe Storage key and derive AES key
    const keychainPassword = getChromeKeychainPassword();
    const aesKey = deriveDecryptionKey(keychainPassword);

    // 4. Parse and decrypt each row
    const cookies: PlaywrightCookie[] = [];

    for (const line of lines) {
      const parts = line.split(SQLITE_DELIM);
      if (parts.length < 9) continue;

      const [hostKey, name, plainValue, encryptedHex, cookiePath, expiresUtc, isSecure, isHttpOnly, sameSiteRaw] = parts;

      // Decrypt: use plaintext value if encrypted_value is empty, otherwise decrypt
      let value: string;
      if (encryptedHex && encryptedHex.length > 0 && encryptedHex !== "0") {
        const decrypted = decryptCookieValue(encryptedHex, aesKey);
        // Fall back to plaintext value if decryption yields empty
        value = decrypted || plainValue || "";
      } else {
        value = plainValue || "";
      }

      const sameSiteInt = parseInt(sameSiteRaw || "0", 10);

      cookies.push({
        name: name || "",
        value,
        domain: hostKey || "",
        path: cookiePath || "/",
        expires: chromeExpiryToUnix(expiresUtc || "0"),
        httpOnly: isHttpOnly === "1",
        secure: isSecure === "1",
        sameSite: SAMESITE_MAP[sameSiteInt] ?? "None",
      });
    }

    return cookies;
  } finally {
    cleanupTempDb(tmpDb);
  }
}
