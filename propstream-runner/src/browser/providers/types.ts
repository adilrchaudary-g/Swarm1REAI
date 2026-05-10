import type { BrowserContext, Page } from "playwright";

export type SessionHealthReport = {
  isAuthenticated: boolean;
  authTokenPresent: boolean;
  authTokenExpiresAt: Date | null;
  jsessionPresent: boolean;
  needsRefresh: boolean;
  reason: string;
};

export interface SessionProvider {
  start(options?: { headed?: boolean }): Promise<Page>;
  close(): Promise<void>;
  getPage(): Promise<Page>;
  getContext(): BrowserContext | null;
  saveStorageState(path: string): Promise<void>;
  isAuthenticated(): Promise<boolean>;
  refreshAuth(username: string, password: string): Promise<void>;
}
