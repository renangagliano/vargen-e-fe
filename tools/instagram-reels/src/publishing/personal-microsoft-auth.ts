import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { CryptoProvider, PublicClientApplication, PromptValue, type AccountInfo, type ICachePlugin, type IPublicClientApplication } from "@azure/msal-node";
import type { MediaConfig } from "../config/index.js";
import { createOneDrivePersonalGraphClient, type OneDriveDrive, type PersonalGraphTokenProvider } from "./onedrive-personal-temporary-media.js";

const execFileAsync = promisify(execFile);
export const PERSONAL_MICROSOFT_SCOPE = "Files.ReadWrite" as const;
export const PERSONAL_MICROSOFT_DEFAULT_AUTHORITY = "https://login.microsoftonline.com/consumers" as const;
export const PERSONAL_MICROSOFT_DEFAULT_REDIRECT_URI = "http://localhost" as const;

type PersonalMicrosoftConfig = Pick<MediaConfig, "microsoftPersonalClientId" | "microsoftPersonalAuthority" | "microsoftPersonalRedirectUri" | "microsoftPersonalScopes" | "microsoftPersonalAuthCacheRoot">;

export type PersonalDriveClassification = "personal" | "corporate" | "unknown";

export type PersonalMicrosoftAuthStatus = {
  authenticated: boolean;
  driveType: string | null;
  filesReadWriteAvailable: boolean;
  providerReadiness: "READY" | "AUTH_REQUIRED" | "APP_REGISTRATION_REQUIRED" | "CORPORATE_REJECTED" | "IDENTITY_UNCONFIRMED";
  error?: string;
};

export type PersonalMsalClient = Pick<IPublicClientApplication, "getAllAccounts" | "acquireTokenInteractive" | "acquireTokenSilent" | "getTokenCache" | "clearCache">;

export type PersonalMicrosoftAuthDependencies = {
  app?: PersonalMsalClient;
  appFactory?: (config: PersonalMicrosoftConfig) => PersonalMsalClient;
  openBrowser?: (url: string) => Promise<void>;
  graphDrive?: (accessToken: string) => Promise<OneDriveDrive>;
  hardenPath?: (target: string, directory: boolean) => Promise<void>;
};

function safeAuthority(value: string): URL {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("PERSONAL_MICROSOFT_AUTHORITY_INVALID"); }
  const pathValue = parsed.pathname.replace(/\/+$/, "").toLowerCase();
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "login.microsoftonline.com" || !["/consumers", "/common"].includes(pathValue)) throw new Error("PERSONAL_MICROSOFT_AUTHORITY_INVALID");
  return parsed;
}

export function validatePersonalMicrosoftConfiguration(config: PersonalMicrosoftConfig): { clientId: string; authority: string; redirectUri: string; scopes: string[] } {
  const clientId = config.microsoftPersonalClientId?.trim();
  if (!clientId) throw new Error("PERSONAL_MICROSOFT_APP_REGISTRATION_REQUIRED");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)) throw new Error("PERSONAL_MICROSOFT_CLIENT_ID_INVALID");
  const authority = safeAuthority(config.microsoftPersonalAuthority || PERSONAL_MICROSOFT_DEFAULT_AUTHORITY).toString().replace(/\/$/, "");
  const redirectUri = config.microsoftPersonalRedirectUri || PERSONAL_MICROSOFT_DEFAULT_REDIRECT_URI;
  if (redirectUri !== PERSONAL_MICROSOFT_DEFAULT_REDIRECT_URI) throw new Error("PERSONAL_MICROSOFT_REDIRECT_URI_INVALID");
  const scopes = config.microsoftPersonalScopes.map((scope) => scope.trim()).filter(Boolean);
  if (scopes.length !== 1 || scopes[0] !== PERSONAL_MICROSOFT_SCOPE) throw new Error("PERSONAL_MICROSOFT_SCOPES_INVALID");
  return { clientId, authority, redirectUri, scopes };
}

export function classifyPersonalDrive(drive: OneDriveDrive): PersonalDriveClassification {
  if (["business", "documentLibrary", "sharePoint"].includes(String(drive.driveType))) return "corporate";
  if (drive.driveType === "personal" && drive.id && drive.owner?.user) return "personal";
  return "unknown";
}

export function accountSafeIdentifier(account: Pick<AccountInfo, "homeAccountId">): string {
  const value = account.homeAccountId || "";
  return value ? `${value.slice(0, 8)}…` : "present";
}

async function defaultHardenPath(target: string, directory: boolean): Promise<void> {
  await fs.chmod(target, directory ? 0o700 : 0o600).catch(() => undefined);
  if (process.platform !== "win32") return;
  const username = process.env.USERNAME?.trim();
  if (!username) throw new Error("PERSONAL_AUTH_CACHE_SECURITY_UNAVAILABLE");
  const grant = directory ? `${username}:(OI)(CI)F` : `${username}:F`;
  try {
    await execFileAsync("icacls.exe", [target, "/inheritance:r", "/grant:r", grant], { windowsHide: true });
  } catch { throw new Error("PERSONAL_AUTH_CACHE_SECURITY_UNAVAILABLE"); }
}

function cachePlugin(cachePath: string, hardenPath: (target: string, directory: boolean) => Promise<void>): ICachePlugin {
  const directory = path.dirname(cachePath);
  return {
    async beforeCacheAccess(context) {
      await fs.mkdir(directory, { recursive: true });
      await hardenPath(directory, true);
      try {
        const serialized = await fs.readFile(cachePath, "utf8");
        context.tokenCache.deserialize(serialized);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw new Error("PERSONAL_AUTH_CACHE_INVALID");
      }
    },
    async afterCacheAccess(context) {
      if (!context.cacheHasChanged) return;
      await fs.mkdir(directory, { recursive: true });
      const temporaryPath = `${cachePath}.${process.pid}.tmp`;
      await fs.writeFile(temporaryPath, context.tokenCache.serialize(), { encoding: "utf8", mode: 0o600 });
      await hardenPath(temporaryPath, false);
      await fs.rm(cachePath, { force: true });
      await fs.rename(temporaryPath, cachePath);
      await hardenPath(cachePath, false);
    },
  };
}

function defaultApp(config: PersonalMicrosoftConfig, hardenPath = defaultHardenPath): PersonalMsalClient {
  const validated = validatePersonalMicrosoftConfiguration(config);
  return new PublicClientApplication({
    auth: { clientId: validated.clientId, authority: validated.authority },
    cache: { cachePlugin: cachePlugin(path.join(config.microsoftPersonalAuthCacheRoot, "msal-cache.json"), hardenPath) },
  });
}

async function defaultOpenBrowser(url: string): Promise<void> {
  if (process.platform === "win32") {
    await execFileAsync("rundll32.exe", ["url.dll,FileProtocolHandler", url], { windowsHide: true });
    return;
  }
  await execFileAsync(process.platform === "darwin" ? "open" : "xdg-open", [url]);
}

function safeAuthError(error: unknown): Error {
  const message = error instanceof Error ? error.message : "PERSONAL_MICROSOFT_AUTH_FAILED";
  if (message.includes("CORPORATE_MICROSOFT_IDENTITY_REJECTED")) return new Error("CORPORATE_MICROSOFT_IDENTITY_REJECTED");
  if (message.includes("PERSONAL_ONEDRIVE_IDENTITY_NOT_CONFIRMED")) return new Error("PERSONAL_ONEDRIVE_IDENTITY_NOT_CONFIRMED");
  if (message.includes("PERSONAL_MICROSOFT_APP_REGISTRATION_REQUIRED")) return new Error("PERSONAL_MICROSOFT_APP_REGISTRATION_REQUIRED");
  return new Error("PERSONAL_MICROSOFT_AUTH_FAILED");
}

export class PersonalMicrosoftAuthService {
  private readonly dependencies: PersonalMicrosoftAuthDependencies;
  public constructor(private readonly config: PersonalMicrosoftConfig, dependencies: PersonalMicrosoftAuthDependencies = {}) {
    this.dependencies = dependencies;
  }

  private app(): PersonalMsalClient {
    validatePersonalMicrosoftConfiguration(this.config);
    return this.dependencies.app ?? this.dependencies.appFactory?.(this.config) ?? defaultApp(this.config, this.dependencies.hardenPath ?? defaultHardenPath);
  }

  private async drive(accessToken: string): Promise<OneDriveDrive> {
    if (this.dependencies.graphDrive) return this.dependencies.graphDrive(accessToken);
    return createOneDrivePersonalGraphClient({ getAccessToken: async () => accessToken }).getDrive();
  }

  private async clearLocalCache(app: PersonalMsalClient): Promise<void> {
    app.clearCache();
    await fs.rm(path.join(this.config.microsoftPersonalAuthCacheRoot, "msal-cache.json"), { force: true });
  }

  public async login(): Promise<PersonalMicrosoftAuthStatus> {
    const validated = validatePersonalMicrosoftConfiguration(this.config);
    const app = this.app();
    try {
      const result = await app.acquireTokenInteractive({
        scopes: validated.scopes,
        prompt: PromptValue.SELECT_ACCOUNT,
        preferredPort: 0,
        openBrowser: this.dependencies.openBrowser ?? defaultOpenBrowser,
        successTemplate: "Vargen & Fé authentication completed. You may close this window.",
        errorTemplate: "Vargen & Fé authentication failed. You may close this window.",
      });
      if (!result?.accessToken) throw new Error("PERSONAL_MICROSOFT_AUTH_FAILED");
      const drive = await this.drive(result.accessToken);
      const classification = classifyPersonalDrive(drive);
      if (classification === "corporate") {
        await this.clearLocalCache(app);
        throw new Error("CORPORATE_MICROSOFT_IDENTITY_REJECTED");
      }
      if (classification !== "personal") throw new Error("PERSONAL_ONEDRIVE_IDENTITY_NOT_CONFIRMED");
      return { authenticated: true, driveType: drive.driveType ?? null, filesReadWriteAvailable: true, providerReadiness: "READY" };
    } catch (error) {
      if (error instanceof Error && error.message === "CORPORATE_MICROSOFT_IDENTITY_REJECTED") throw error;
      throw safeAuthError(error);
    }
  }

  public async status(): Promise<PersonalMicrosoftAuthStatus> {
    let app: PersonalMsalClient;
    try { app = this.app(); } catch (error) {
      const message = error instanceof Error ? error.message : "PERSONAL_MICROSOFT_APP_REGISTRATION_REQUIRED";
      return { authenticated: false, driveType: null, filesReadWriteAvailable: false, providerReadiness: message === "PERSONAL_MICROSOFT_APP_REGISTRATION_REQUIRED" ? "APP_REGISTRATION_REQUIRED" : "IDENTITY_UNCONFIRMED", error: message };
    }
    const accounts = await app.getAllAccounts();
    if (accounts.length === 0) return { authenticated: false, driveType: null, filesReadWriteAvailable: false, providerReadiness: "AUTH_REQUIRED", error: "PERSONAL_ONEDRIVE_LOGIN_REQUIRED" };
    if (accounts.length !== 1) return { authenticated: false, driveType: null, filesReadWriteAvailable: false, providerReadiness: "AUTH_REQUIRED", error: "PERSONAL_MICROSOFT_ACCOUNT_SELECTION_REQUIRED" };
    try {
      const token = await app.acquireTokenSilent({ account: accounts[0], scopes: [PERSONAL_MICROSOFT_SCOPE] });
      if (!token?.accessToken) throw new Error("PERSONAL_ONEDRIVE_LOGIN_REQUIRED");
      const drive = await this.drive(token.accessToken);
      const classification = classifyPersonalDrive(drive);
      if (classification === "corporate") {
        await this.clearLocalCache(app);
        return { authenticated: true, driveType: drive.driveType ?? null, filesReadWriteAvailable: false, providerReadiness: "CORPORATE_REJECTED", error: "CORPORATE_MICROSOFT_IDENTITY_REJECTED" };
      }
      if (classification !== "personal") return { authenticated: true, driveType: drive.driveType ?? null, filesReadWriteAvailable: false, providerReadiness: "IDENTITY_UNCONFIRMED", error: "PERSONAL_ONEDRIVE_IDENTITY_NOT_CONFIRMED" };
      return { authenticated: true, driveType: drive.driveType ?? null, filesReadWriteAvailable: true, providerReadiness: "READY" };
    } catch (error) {
      const safe = safeAuthError(error);
      return { authenticated: false, driveType: null, filesReadWriteAvailable: false, providerReadiness: "AUTH_REQUIRED", error: safe.message === "PERSONAL_MICROSOFT_AUTH_FAILED" ? "PERSONAL_ONEDRIVE_LOGIN_REQUIRED" : safe.message };
    }
  }

  public async logout(): Promise<void> {
    const app = this.app();
    await this.clearLocalCache(app);
  }
}

export function createPersonalGraphTokenProvider(config: PersonalMicrosoftConfig, dependencies: PersonalMicrosoftAuthDependencies = {}): PersonalGraphTokenProvider {
  validatePersonalMicrosoftConfiguration(config);
  const app = dependencies.app ?? dependencies.appFactory?.(config) ?? defaultApp(config, dependencies.hardenPath ?? defaultHardenPath);
  return {
    async getAccessToken(): Promise<string> {
      const accounts = await app.getAllAccounts();
      if (accounts.length !== 1) throw new Error(accounts.length === 0 ? "PERSONAL_ONEDRIVE_LOGIN_REQUIRED" : "PERSONAL_MICROSOFT_ACCOUNT_SELECTION_REQUIRED");
      try {
        const result = await app.acquireTokenSilent({ account: accounts[0], scopes: [PERSONAL_MICROSOFT_SCOPE] });
        if (!result?.accessToken) throw new Error("PERSONAL_ONEDRIVE_LOGIN_REQUIRED");
        return result.accessToken;
      } catch { throw new Error("PERSONAL_ONEDRIVE_LOGIN_REQUIRED"); }
    },
  };
}

export async function clearPersonalMicrosoftCache(config: PersonalMicrosoftConfig): Promise<void> {
  await fs.rm(path.join(config.microsoftPersonalAuthCacheRoot, "msal-cache.json"), { force: true });
}

export { CryptoProvider };
