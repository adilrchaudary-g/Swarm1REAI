import { readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";

// ── Types ────────────────────────────────────────────────────────

export type StoredCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
};

export type CookieSnapshot = {
  id: string;
  source: "cdp" | "persistent" | "cookie-injection" | "auto" | "bootstrap";
  capturedAt: string; // ISO 8601
  authTokenExpiry: number | null; // Unix epoch seconds, null if absent
  cookies: StoredCookie[];
};

export type CookieValidation = {
  valid: boolean;
  snapshotId: string;
  source: string;
  capturedAt: string;
  authTokenPresent: boolean;
  authTokenExpired: boolean;
  authTokenExpiresAt: Date | null;
  secondsUntilExpiry: number | null;
  cookieCount: number;
  reason: string;
};

type StoreFile = {
  version: 1;
  snapshots: CookieSnapshot[];
};

const MIN_VALID_SNAPSHOTS = 2;
const MAX_SNAPSHOTS = 10;

// ── Offline validation (no browser needed) ───────────────────────

export function validateCookieSnapshot(
  snapshot: CookieSnapshot,
  marginMs = 0,
): CookieValidation {
  const authToken = snapshot.cookies.find((c) => c.name === "authToken");
  const now = Date.now() / 1000;

  if (!authToken) {
    return {
      valid: false,
      snapshotId: snapshot.id,
      source: snapshot.source,
      capturedAt: snapshot.capturedAt,
      authTokenPresent: false,
      authTokenExpired: false,
      authTokenExpiresAt: null,
      secondsUntilExpiry: null,
      cookieCount: snapshot.cookies.length,
      reason: "authToken cookie missing from snapshot",
    };
  }

  const expiresAt = authToken.expires > 0 ? authToken.expires : null;
  const expired = expiresAt !== null && expiresAt < now;
  const withinMargin =
    expiresAt !== null && expiresAt - now < marginMs / 1000;

  if (expired) {
    return {
      valid: false,
      snapshotId: snapshot.id,
      source: snapshot.source,
      capturedAt: snapshot.capturedAt,
      authTokenPresent: true,
      authTokenExpired: true,
      authTokenExpiresAt: expiresAt ? new Date(expiresAt * 1000) : null,
      secondsUntilExpiry: expiresAt ? Math.floor(expiresAt - now) : null,
      cookieCount: snapshot.cookies.length,
      reason: "authToken expired",
    };
  }

  if (withinMargin) {
    return {
      valid: false,
      snapshotId: snapshot.id,
      source: snapshot.source,
      capturedAt: snapshot.capturedAt,
      authTokenPresent: true,
      authTokenExpired: false,
      authTokenExpiresAt: expiresAt ? new Date(expiresAt * 1000) : null,
      secondsUntilExpiry: expiresAt ? Math.floor(expiresAt - now) : null,
      cookieCount: snapshot.cookies.length,
      reason: `authToken expires within margin (${Math.floor((expiresAt! - now) / 60)}m remaining)`,
    };
  }

  return {
    valid: true,
    snapshotId: snapshot.id,
    source: snapshot.source,
    capturedAt: snapshot.capturedAt,
    authTokenPresent: true,
    authTokenExpired: false,
    authTokenExpiresAt: expiresAt ? new Date(expiresAt * 1000) : null,
    secondsUntilExpiry: expiresAt ? Math.floor(expiresAt - now) : null,
    cookieCount: snapshot.cookies.length,
    reason: "ok",
  };
}

// ── CookieStore class ────────────────────────────────────────────

export class CookieStore {
  private snapshots: CookieSnapshot[] = [];
  private loaded = false;

  constructor(private readonly storePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.storePath, "utf8");
      const data = JSON.parse(raw) as StoreFile;
      if (data.version === 1 && Array.isArray(data.snapshots)) {
        this.snapshots = data.snapshots;
      }
    } catch {
      this.snapshots = [];
    }
    this.loaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load();
  }

  private async persist(): Promise<void> {
    const data: StoreFile = { version: 1, snapshots: this.snapshots };
    await writeFile(this.storePath, JSON.stringify(data, null, 2));
  }

  /**
   * Validate all snapshots and return results sorted by freshness (newest first).
   */
  async validateAll(marginMs = 0): Promise<CookieValidation[]> {
    await this.ensureLoaded();
    return this.snapshots
      .map((s) => validateCookieSnapshot(s, marginMs))
      .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
  }

  /**
   * Get the best (newest) valid snapshot's cookies for injection.
   * Returns null if no valid snapshot exists.
   */
  async getBestCookies(marginMs = 0): Promise<{ cookies: StoredCookie[]; snapshotId: string } | null> {
    await this.ensureLoaded();

    for (const snap of this.snapshotsByFreshness()) {
      const v = validateCookieSnapshot(snap, marginMs);
      if (v.valid) {
        return { cookies: snap.cookies, snapshotId: snap.id };
      }
    }
    return null;
  }

  /**
   * Count how many currently-valid snapshots we have.
   */
  async validCount(marginMs = 0): Promise<number> {
    await this.ensureLoaded();
    return this.snapshots.filter(
      (s) => validateCookieSnapshot(s, marginMs).valid,
    ).length;
  }

  /**
   * Returns true if we have at least MIN_VALID_SNAPSHOTS valid cookie sets.
   */
  async hasMinimumValid(marginMs = 0): Promise<boolean> {
    return (await this.validCount(marginMs)) >= MIN_VALID_SNAPSHOTS;
  }

  /**
   * Capture a new snapshot from a set of cookies.
   * Deduplicates by authToken value — if the newest snapshot has the same authToken,
   * we just update its timestamp instead of creating a duplicate.
   */
  async capture(
    cookies: StoredCookie[],
    source: CookieSnapshot["source"],
  ): Promise<CookieSnapshot> {
    await this.ensureLoaded();

    const authToken = cookies.find((c) => c.name === "authToken");
    const authTokenExpiry =
      authToken && authToken.expires > 0 ? authToken.expires : null;

    // Deduplicate: if the newest snapshot from this source has the same authToken value, update it
    const existing = this.snapshotsByFreshness().find(
      (s) =>
        s.source === source &&
        s.cookies.find((c) => c.name === "authToken")?.value ===
          authToken?.value,
    );

    if (existing) {
      existing.capturedAt = new Date().toISOString();
      existing.cookies = cookies;
      existing.authTokenExpiry = authTokenExpiry;
      await this.prune();
      await this.persist();
      return existing;
    }

    const snapshot: CookieSnapshot = {
      id: crypto.randomUUID(),
      source,
      capturedAt: new Date().toISOString(),
      authTokenExpiry,
      cookies,
    };

    this.snapshots.push(snapshot);
    await this.prune();
    await this.persist();
    return snapshot;
  }

  /**
   * Run pre-flight validation before any browser operation.
   * Returns the validation of the best available snapshot (or a failed validation
   * if no snapshots exist). Logs a warning if below minimum threshold.
   */
  async preflight(marginMs = 0): Promise<CookieValidation> {
    await this.ensureLoaded();

    const validations = await this.validateAll(marginMs);
    const validOnes = validations.filter((v) => v.valid);
    const best = validations[0]; // newest, regardless of validity

    if (validOnes.length < MIN_VALID_SNAPSHOTS) {
      console.warn(
        `[cookie-store] WARNING: only ${validOnes.length}/${MIN_VALID_SNAPSHOTS} valid snapshots available — auth refresh recommended`,
      );
    }

    if (!best) {
      return {
        valid: false,
        snapshotId: "",
        source: "none",
        capturedAt: "",
        authTokenPresent: false,
        authTokenExpired: false,
        authTokenExpiresAt: null,
        secondsUntilExpiry: null,
        cookieCount: 0,
        reason: "cookie store is empty — no snapshots available",
      };
    }

    return best;
  }

  /**
   * Get all snapshots (for inspection/debugging).
   */
  async allSnapshots(): Promise<CookieSnapshot[]> {
    await this.ensureLoaded();
    return [...this.snapshots];
  }

  // ── Internal ───────────────────────────────────────────────────

  private snapshotsByFreshness(): CookieSnapshot[] {
    return [...this.snapshots].sort(
      (a, b) =>
        new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
    );
  }

  private async prune(): Promise<void> {
    // Remove expired snapshots, but never drop below what we have if all are expired
    const now = Date.now() / 1000;
    const validOnes = this.snapshots.filter(
      (s) => validateCookieSnapshot(s).valid,
    );
    const expiredOnes = this.snapshots.filter(
      (s) => !validateCookieSnapshot(s).valid,
    );

    // Keep all valid ones + trim expired to stay under MAX_SNAPSHOTS
    if (this.snapshots.length > MAX_SNAPSHOTS) {
      // Sort expired by freshness (keep newest expired)
      expiredOnes.sort(
        (a, b) =>
          new Date(b.capturedAt).getTime() -
          new Date(a.capturedAt).getTime(),
      );
      const keepExpired = Math.max(
        0,
        MAX_SNAPSHOTS - validOnes.length,
      );
      this.snapshots = [
        ...validOnes,
        ...expiredOnes.slice(0, keepExpired),
      ];
    }
  }
}
