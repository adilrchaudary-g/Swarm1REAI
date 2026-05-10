import type { BrowserContext, Page } from "playwright";
import type { SessionHealthReport } from "./providers/types.js";

export async function checkCookieHealth(context: BrowserContext): Promise<SessionHealthReport> {
  const cookies = await context.cookies(["https://app.propstream.com", "https://login.propstream.com"]);

  const authToken = cookies.find((c) => c.name === "authToken");
  const jsession = cookies.find((c) => c.name === "JSESSIONID" && c.domain.includes("app.propstream"));

  const now = Date.now() / 1000;
  let authTokenExpiresAt: Date | null = null;
  let authTokenExpired = false;

  if (authToken && authToken.expires > 0) {
    authTokenExpiresAt = new Date(authToken.expires * 1000);
    authTokenExpired = authToken.expires < now;
  }

  if (!authToken) {
    return {
      isAuthenticated: false,
      authTokenPresent: false,
      authTokenExpiresAt: null,
      jsessionPresent: Boolean(jsession),
      needsRefresh: true,
      reason: "authToken cookie missing",
    };
  }

  if (authTokenExpired) {
    return {
      isAuthenticated: false,
      authTokenPresent: true,
      authTokenExpiresAt,
      jsessionPresent: Boolean(jsession),
      needsRefresh: true,
      reason: "authToken expired",
    };
  }

  return {
    isAuthenticated: true,
    authTokenPresent: true,
    authTokenExpiresAt,
    jsessionPresent: Boolean(jsession),
    needsRefresh: false,
    reason: "ok",
  };
}

export async function checkPageHealth(page: Page): Promise<{ authRequired: boolean; hasCaptcha: boolean }> {
  return page
    .evaluate(() => ({
      authRequired:
        Boolean(document.querySelector("input[type='password']")) ||
        /login|sign[\s-]?in/i.test(document.title || ""),
      hasCaptcha: Boolean(
        document.querySelector("iframe[src*='recaptcha'], [class*='captcha'], [id*='captcha']"),
      ),
    }))
    .catch(() => ({ authRequired: true, hasCaptcha: false }));
}

export function shouldRefreshBeforeOperation(
  report: SessionHealthReport,
  refreshMarginMs: number,
): boolean {
  if (report.needsRefresh) return true;
  if (!report.authTokenExpiresAt) return true;
  const msUntilExpiry = report.authTokenExpiresAt.getTime() - Date.now();
  return msUntilExpiry < refreshMarginMs;
}
