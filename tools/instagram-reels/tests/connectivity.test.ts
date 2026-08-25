import assert from "node:assert/strict";
import test from "node:test";
import {
  formatInstagramConnectivityResult,
  loadInstagramConnectivityConfig,
  MetaInstagramConnectivityValidator,
  assertReadOnlyConnectivityOperation,
  type InstagramConnectivityConfig,
  type MetaConnectivityFetch,
} from "../src/publishing/connectivity.js";

const secret = "connectivity-secret-token";

function config(overrides: Partial<InstagramConnectivityConfig> = {}): InstagramConnectivityConfig {
  return {
    appId: "test-app",
    appSecretPresent: true,
    accountId: "123",
    accessToken: secret,
    graphApiVersion: "v22.0",
    graphApiBaseUrl: "https://graph.facebook.com",
    permissionsEndpoint: "/me/permissions",
    timeoutMs: 1000,
    ...overrides,
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function successfulFetch(calls: Array<{ url: string; method: string; authorization: string | null }>): MetaConnectivityFetch {
  return async (input, init) => {
    const url = String(input);
    calls.push({ url, method: String(init?.method ?? "GET"), authorization: String((init?.headers as Record<string, string> | undefined)?.Authorization ?? null) });
    if (url.includes("/me/permissions")) {
      return response({ data: [
        { permission: "instagram_business_basic", status: "granted" },
        { permission: "instagram_business_content_publish", status: "granted" },
      ] });
    }
    return response({ id: "123", username: "vargen_fe", account_type: "BUSINESS" });
  };
}

test("missing connectivity credentials return configuration error without attempting HTTP", async () => {
  let calls = 0;
  const result = await new MetaInstagramConnectivityValidator(loadInstagramConnectivityConfig({} as NodeJS.ProcessEnv), async () => {
    calls += 1;
    return response({});
  }).validate();
  assert.equal(result.state, "UNCONFIGURED");
  assert.equal(result.errorCode, "CONFIGURATION_ERROR");
  assert.equal(calls, 0);
});

test("successful connectivity validates account identity and permissions without publishing", async () => {
  const calls: Array<{ url: string; method: string; authorization: string | null }> = [];
  const result = await new MetaInstagramConnectivityValidator(config(), successfulFetch(calls)).validate();
  assert.equal(result.state, "READY_FOR_CONTROLLED_TEST");
  assert.equal(result.readyForControlledTest, true);
  assert.equal(result.publishingCapability, "PASS");
  assert.equal(result.checks.configuration, "PASS");
  assert.equal(result.checks.accountCompatibility, "PASS");
  assert.equal(result.account?.id, "123");
  assert.equal(result.checks.authentication, "PASS");
  assert.equal(result.checks.accountIdMatch, "PASS");
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.method === "GET"));
  assert.ok(calls.every((call) => !call.url.includes("access_token") && !call.url.includes("media_publish") && !call.url.match(/\/media(?:\/|$)/)));
  assert.ok(calls.every((call) => call.authorization === `Bearer ${secret}`));
  assert.ok(!JSON.stringify(result).includes(secret));
  const output = formatInstagramConnectivityResult(result);
  assert.match(output, /Publishing executed: NO/);
  assert.match(output, /Configuration: PASS/);
  assert.ok(!output.includes(secret));
});

test("invalid token returns an authentication error with sanitized Meta detail", async () => {
  const result = await new MetaInstagramConnectivityValidator(config(), async (_input, init) => {
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${secret}`);
    return response({ error: { code: "190", message: `Invalid OAuth access token ${secret}` } }, 401);
  }).validate();
  assert.equal(result.state, "BLOCKED");
  assert.equal(result.errorCode, "AUTHENTICATION_ERROR");
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("expired token is classified separately from generic authentication failure", async () => {
  const result = await new MetaInstagramConnectivityValidator(config(), async () => response({
    error: { code: "190", error_subcode: "463", message: "The access token has expired." },
  }, 400)).validate();
  assert.equal(result.state, "BLOCKED");
  assert.equal(result.errorCode, "TOKEN_EXPIRED");
  assert.equal(result.readyForControlledTest, false);
});

test("rate limits fail closed with an explicit rate-limit classification", async () => {
  const result = await new MetaInstagramConnectivityValidator(config(), async () => response({
    error: { code: "4", message: "Application request limit reached." },
  }, 429)).validate();
  assert.equal(result.state, "ERROR");
  assert.equal(result.errorCode, "RATE_LIMITED");
  assert.equal(result.readyForControlledTest, false);
});

test("network failures are not reported as business verification failures", async () => {
  const result = await new MetaInstagramConnectivityValidator(config(), async () => {
    throw new TypeError("fetch failed");
  }).validate();
  assert.equal(result.state, "ERROR");
  assert.equal(result.errorCode, "NETWORK_ERROR");
  assert.ok(!JSON.stringify(result).includes("BUSINESS_VERIFICATION"));
});

test("account mismatch blocks readiness even when authentication succeeds", async () => {
  const result = await new MetaInstagramConnectivityValidator(config(), async () => response({ id: "999", username: "other" })).validate();
  assert.equal(result.state, "BLOCKED");
  assert.equal(result.errorCode, "ACCOUNT_MISMATCH");
  assert.equal(result.readyForControlledTest, false);
});

test("non-professional account types are blocked when Meta exposes the type", async () => {
  const result = await new MetaInstagramConnectivityValidator(config(), async () => response({ id: "123", username: "personal", account_type: "PERSONAL" })).validate();
  assert.equal(result.state, "BLOCKED");
  assert.equal(result.errorCode, "ACCOUNT_NOT_COMPATIBLE");
  assert.equal(result.checks.accountCompatibility, "FAIL");
});

test("missing account type remains limited rather than being treated as compatible", async () => {
  const result = await new MetaInstagramConnectivityValidator(config(), async (input) => {
    return String(input).includes("/me/permissions")
      ? response({ data: [{ permission: "instagram_business_basic", status: "granted" }, { permission: "instagram_business_content_publish", status: "granted" }] })
      : response({ id: "123", username: "vargen_fe" });
  }).validate();
  assert.equal(result.state, "LIMITED");
  assert.equal(result.errorCode, "ACCOUNT_NOT_COMPATIBLE");
  assert.equal(result.publishingCapability, "LIMITED");
});

test("missing publishing permission is limited and never assumed to pass", async () => {
  const result = await new MetaInstagramConnectivityValidator(config(), async (input) => {
    return String(input).includes("/me/permissions")
      ? response({ data: [{ permission: "instagram_basic", status: "granted" }, { permission: "instagram_content_publish", status: "declined" }] })
      : response({ id: "123", username: "vargen_fe" });
  }).validate();
  assert.equal(result.state, "LIMITED");
  assert.equal(result.publishingCapability, "LIMITED");
  assert.equal(result.checks.publishingCapability, "LIMITED");
  assert.equal(result.readyForControlledTest, false);
});

test("permission endpoint failure is blocked and uncertain capability remains fail-closed", async () => {
  const result = await new MetaInstagramConnectivityValidator(config(), async (input) => {
    return String(input).includes("/me/permissions")
      ? response({ error: { code: "10", message: "Permission denied" } }, 403)
      : response({ id: "123", username: "vargen_fe" });
  }).validate();
  assert.equal(result.errorCode, "PERMISSION_ERROR");
  assert.equal(result.publishingCapability, "BLOCKED");
  assert.equal(result.readyForControlledTest, false);
});

test("Meta API failures retain a safe API error classification", async () => {
  const result = await new MetaInstagramConnectivityValidator(config(), async () => response({ error: { code: "2", message: "Service unavailable" } }, 503)).validate();
  assert.equal(result.state, "ERROR");
  assert.equal(result.errorCode, "META_API_ERROR");
});

test("non-official Graph hosts are rejected before bearer credentials are sent", async () => {
  let calls = 0;
  const result = await new MetaInstagramConnectivityValidator(config({ graphApiBaseUrl: "https://collector.invalid" }), async () => {
    calls += 1;
    return response({ id: "123" });
  }).validate();
  assert.equal(result.state, "UNCONFIGURED");
  assert.equal(result.errorCode, "CONFIGURATION_ERROR");
  assert.ok(result.errorMessageSafe?.includes("META_GRAPH_API_BASE_URL_INVALID"));
  assert.equal(calls, 0);
});

test("connectivity client rejects publication paths before any request", async () => {
  let calls = 0;
  const result = await new MetaInstagramConnectivityValidator(config({ permissionsEndpoint: "/media" }), async () => {
    calls += 1;
    return response({ id: "123", username: "vargen_fe" });
  }).validate();
  assert.equal(result.state, "UNCONFIGURED");
  assert.equal(result.errorCode, "CONFIGURATION_ERROR");
  assert.equal(calls, 0);
});

test("connectivity operation guard permits only read-only non-publication paths", () => {
  assert.doesNotThrow(() => assertReadOnlyConnectivityOperation("GET", "/123"));
  assert.throws(() => assertReadOnlyConnectivityOperation("POST", "/123"), /READ_ONLY_OPERATION_FORBIDDEN/);
  assert.throws(() => assertReadOnlyConnectivityOperation("GET", "/123/media"), /READ_ONLY_OPERATION_FORBIDDEN/);
  assert.throws(() => assertReadOnlyConnectivityOperation("GET", "/media_publish"), /READ_ONLY_OPERATION_FORBIDDEN/);
});
