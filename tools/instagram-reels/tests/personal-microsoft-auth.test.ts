import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fixture } from "./review.test.js";
import { classifyPersonalDrive, PersonalMicrosoftAuthService, validatePersonalMicrosoftConfiguration, createPersonalGraphTokenProvider } from "../src/publishing/personal-microsoft-auth.js";
import type { MediaConfig } from "../src/config/index.js";
import type { PersonalMsalClient } from "../src/publishing/personal-microsoft-auth.js";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";

function authConfig(config: MediaConfig): MediaConfig {
  return { ...config, microsoftPersonalClientId: CLIENT_ID, microsoftPersonalAuthority: "https://login.microsoftonline.com/consumers", microsoftPersonalRedirectUri: "http://localhost", microsoftPersonalScopes: ["Files.ReadWrite"], microsoftPersonalAuthCacheRoot: path.join(config.pipelineStateRoot, "auth") };
}

function fakeApp(options: { accounts?: number; token?: string } = {}): { app: PersonalMsalClient; interactiveRequest?: Record<string, unknown>; cleared: number } {
  let cleared = 0;
  let interactiveRequest: Record<string, unknown> | undefined;
  const app = {
    async getAllAccounts() { return Array.from({ length: options.accounts ?? 1 }, (_, index) => ({ homeAccountId: `personal-${index}`, environment: "login.microsoftonline.com", tenantId: "consumers", username: "personal@example.invalid", localAccountId: `local-${index}`, name: "Personal" })); },
    async acquireTokenSilent() { return { accessToken: options.token ?? "personal-token-runtime-only" }; },
    async acquireTokenInteractive(request: Record<string, unknown>) { interactiveRequest = request; return { accessToken: options.token ?? "personal-token-runtime-only" }; },
    getTokenCache() { return {} as never; },
    clearCache() { cleared += 1; },
  } as unknown as PersonalMsalClient;
  return { app, get interactiveRequest() { return interactiveRequest; }, get cleared() { return cleared; } };
}

test("personal Microsoft configuration requires a GUID client ID, localhost redirect, consumer/common authority, and Files.ReadWrite only", async () => {
  const item = await fixture();
  const config = authConfig(item.config);
  assert.equal(validatePersonalMicrosoftConfiguration(config).scopes[0], "Files.ReadWrite");
  assert.throws(() => validatePersonalMicrosoftConfiguration({ ...config, microsoftPersonalClientId: null }), /PERSONAL_MICROSOFT_APP_REGISTRATION_REQUIRED/);
  assert.throws(() => validatePersonalMicrosoftConfiguration({ ...config, microsoftPersonalScopes: ["Files.ReadWrite", "Mail.Read"] }), /PERSONAL_MICROSOFT_SCOPES_INVALID/);
  assert.throws(() => validatePersonalMicrosoftConfiguration({ ...config, microsoftPersonalRedirectUri: "http://127.0.0.1" }), /PERSONAL_MICROSOFT_REDIRECT_URI_INVALID/);
  assert.throws(() => validatePersonalMicrosoftConfiguration({ ...config, microsoftPersonalAuthority: "https://login.microsoftonline.com/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }), /PERSONAL_MICROSOFT_AUTHORITY_INVALID/);
});

test("personal drive classification accepts only personal and rejects business drives", () => {
  assert.equal(classifyPersonalDrive({ id: "drive", driveType: "personal", owner: { user: { id: "user" } } }), "personal");
  assert.equal(classifyPersonalDrive({ id: "drive", driveType: "business", owner: { user: { id: "user" } } }), "corporate");
  assert.equal(classifyPersonalDrive({ id: "drive", driveType: "documentLibrary" }), "corporate");
  assert.equal(classifyPersonalDrive({ driveType: "unknown" }), "unknown");
});

test("auth status rejects a corporate drive and clears only the personal local cache", async () => {
  const item = await fixture();
  const config = authConfig(item.config);
  const fake = fakeApp();
  const service = new PersonalMicrosoftAuthService(config, { app: fake.app, graphDrive: async () => ({ id: "business-drive", driveType: "business", owner: { user: { id: "corporate" } } }) });
  const status = await service.status();
  assert.equal(status.providerReadiness, "CORPORATE_REJECTED");
  assert.equal(status.error, "CORPORATE_MICROSOFT_IDENTITY_REJECTED");
  assert.equal(fake.cleared, 1);
});

test("interactive login uses MSAL public-client PKCE flow and accepts only a personal drive", async () => {
  const item = await fixture();
  const config = authConfig(item.config);
  const fake = fakeApp();
  const service = new PersonalMicrosoftAuthService(config, { app: fake.app, graphDrive: async () => ({ id: "personal-drive", driveType: "personal", owner: { user: { id: "personal-user" } } }), openBrowser: async () => { throw new Error("browser should be controlled by MSAL request"); } });
  const status = await service.login();
  assert.equal(status.providerReadiness, "READY");
  assert.equal(fake.interactiveRequest?.preferredPort, 0);
  assert.equal(fake.interactiveRequest?.redirectUri, undefined);
  assert.deepEqual(fake.interactiveRequest?.scopes, ["Files.ReadWrite"]);
});

test("silent personal token provider never uses Azure or corporate ambient credentials", async () => {
  const item = await fixture();
  const config = authConfig(item.config);
  const fake = fakeApp({ token: "personal-token-runtime-only" });
  const provider = createPersonalGraphTokenProvider(config, { app: fake.app });
  assert.equal(await provider.getAccessToken(), "personal-token-runtime-only");
});

test("logout removes only the personal MSAL cache file", async () => {
  const item = await fixture();
  const config = authConfig(item.config);
  const fake = fakeApp();
  await fs.mkdir(config.microsoftPersonalAuthCacheRoot, { recursive: true });
  const cachePath = path.join(config.microsoftPersonalAuthCacheRoot, "msal-cache.json");
  await fs.writeFile(cachePath, "cache");
  await new PersonalMicrosoftAuthService(config, { app: fake.app }).logout();
  await assert.rejects(() => fs.access(cachePath));
  assert.equal(fake.cleared, 1);
});
