import assert from "node:assert/strict";
import test from "node:test";
import {
  formatInstagramConnectivityResult,
  inspectInstagramTokenShape,
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
    graphApiBaseUrl: "https://graph.instagram.com",
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

test("successful Instagram Login connectivity validates account identity without probing permissions or publishing", async () => {
  const calls: Array<{ url: string; method: string; authorization: string | null }> = [];
  const result = await new MetaInstagramConnectivityValidator(config(), successfulFetch(calls)).validate();
  assert.equal(result.state, "READY_FOR_CONTROLLED_TEST");
  assert.equal(result.readyForControlledTest, true);
  assert.equal(result.publishingCapability, "CONFIGURED_FOR_CONTROLLED_TEST");
  assert.equal(result.publishingProven, false);
  assert.deepEqual(result.requiredPublishingPermissions, ["instagram_business_basic", "instagram_business_content_publish"]);
  assert.equal(result.checks.configuration, "PASS");
  assert.equal(result.checks.accountCompatibility, "PASS");
  assert.equal(result.account?.id, "123");
  assert.equal(result.checks.authentication, "PASS");
  assert.equal(result.checks.accountIdMatch, "PASS");
  assert.equal(calls.length, 1);
  assert.ok(calls.every((call) => call.method === "GET"));
  assert.equal(calls[0]?.url, "https://graph.instagram.com/v22.0/me?fields=id%2Cusername%2Cname%2Caccount_type");
  assert.ok(calls.every((call) => !call.url.includes("/permissions") && !call.url.includes("access_token") && !call.url.includes("media_publish") && !call.url.match(/\/media(?:\/|$)/)));
  assert.ok(calls.every((call) => call.authorization === `Bearer ${secret}`));
  assert.ok(!JSON.stringify(result).includes(secret));
  const output = formatInstagramConnectivityResult(result);
  assert.match(output, /Publishing executed: NO/);
  assert.match(output, /Configuration: PASS/);
  assert.match(output, /API host: graph\.instagram\.com/);
  assert.match(output, /Authentication endpoint: \/me/);
  assert.match(output, /Authorization method: Bearer header/);
  assert.match(output, /Authenticated account ID: 123/);
  assert.match(output, /Authenticated username: vargen_fe/);
  assert.match(output, /Authenticated account type: BUSINESS/);
  assert.match(output, /Professional account: PASS/);
  assert.match(output, /API model: Instagram Login/);
  assert.match(output, /Publishing configuration: READY_FOR_CONTROLLED_TEST/);
  assert.match(output, /Publishing proven: NO/);
  assert.match(output, /token_present=true/);
  assert.ok(!output.includes(secret));
});

test("raw token shape diagnostics are safe and do not expose token content", () => {
  const diagnostics = inspectInstagramTokenShape(`  ${secret}\r\n`);
  assert.deepEqual(diagnostics, {
    tokenPresent: true,
    tokenLength: secret.length + 4,
    tokenPrefixLengthSafe: 8,
    leadingWhitespace: true,
    trailingWhitespace: true,
    containsNewline: true,
    containsCarriageReturn: true,
    containsSpace: true,
    startsWithBearerLiteral: false,
    startsWithQuote: false,
    endsWithQuote: false,
  });
  assert.ok(!JSON.stringify(diagnostics).includes(secret));
});

test("token loading uses INSTAGRAM_ACCESS_TOKEN and never substitutes app credentials", () => {
  const loaded = loadInstagramConnectivityConfig({
    META_APP_ID: "test-app",
    META_APP_SECRET: "app-secret-must-not-be-used-as-token",
    INSTAGRAM_ACCOUNT_ID: "123",
    INSTAGRAM_ACCESS_TOKEN: secret,
  } as unknown as NodeJS.ProcessEnv);
  assert.equal(loaded.accessToken, secret);
  assert.equal(loaded.appSecretPresent, true);
  assert.ok(!JSON.stringify({ accessToken: loaded.accessToken }).includes("app-secret-must-not-be-used-as-token"));
});

test("leading, trailing, LF, and CRLF whitespace is trimmed before the bearer header", async () => {
  for (const rawToken of [`  ${secret}`, `${secret}  `, `\n${secret}`, `${secret}\n`, `\r\n${secret}\r\n`]) {
    const calls: Array<{ url: string; method: string; authorization: string | null }> = [];
    const loaded = loadInstagramConnectivityConfig({
      META_APP_ID: "test-app",
      META_APP_SECRET: "test-secret",
      INSTAGRAM_ACCOUNT_ID: "123",
      INSTAGRAM_ACCESS_TOKEN: rawToken,
      META_GRAPH_API_VERSION: "v22.0",
    } as unknown as NodeJS.ProcessEnv);
    const result = await new MetaInstagramConnectivityValidator(loaded, successfulFetch(calls)).validate();
    assert.equal(result.state, "READY_FOR_CONTROLLED_TEST");
    assert.ok(calls.every((call) => call.authorization === `Bearer ${secret}`));
  }
});

test("literal Bearer prefix is rejected instead of being duplicated", async () => {
  let calls = 0;
  const result = await new MetaInstagramConnectivityValidator(config({ accessToken: `Bearer ${secret}` }), async () => {
    calls += 1;
    return response({});
  }).validate();
  assert.equal(result.errorCode, "CONFIGURATION_ERROR");
  assert.ok(result.errorMessageSafe?.includes("INSTAGRAM_ACCESS_TOKEN_MUST_CONTAIN_RAW_TOKEN"));
  assert.equal(calls, 0);
});

test("quoted token values are rejected without stripping token characters", async () => {
  let calls = 0;
  const result = await new MetaInstagramConnectivityValidator(config({ accessToken: `"${secret}"` }), async () => {
    calls += 1;
    return response({});
  }).validate();
  assert.equal(result.errorCode, "CONFIGURATION_ERROR");
  assert.ok(result.errorMessageSafe?.includes("INSTAGRAM_ACCESS_TOKEN_MUST_NOT_BE_QUOTED"));
  assert.equal(calls, 0);
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

test("Meta MEDIA_CREATOR account type is accepted as a professional Instagram account", async () => {
  let calls = 0;
  const result = await new MetaInstagramConnectivityValidator(config(), async () => {
    calls += 1;
    return response({ id: "123", username: "vargen.fe", account_type: "MEDIA_CREATOR" });
  }).validate();
  assert.equal(result.state, "READY_FOR_CONTROLLED_TEST");
  assert.equal(result.checks.accountCompatibility, "PASS");
  assert.equal(result.publishingCapability, "CONFIGURED_FOR_CONTROLLED_TEST");
  assert.equal(calls, 1);
});

test("missing account type remains limited rather than being treated as compatible", async () => {
  const result = await new MetaInstagramConnectivityValidator(config(), async () => {
    return response({ id: "123", username: "vargen_fe" });
  }).validate();
  assert.equal(result.state, "LIMITED");
  assert.equal(result.errorCode, "ACCOUNT_NOT_COMPATIBLE");
  assert.equal(result.publishingCapability, "LIMITED");
});

test("unsupported permissions edges cannot block Instagram Login connectivity readiness", async () => {
  const requestedUrls: string[] = [];
  const result = await new MetaInstagramConnectivityValidator(config(), async (input) => {
    requestedUrls.push(String(input));
    return response({ id: "123", username: "vargen_fe", account_type: "BUSINESS" });
  }).validate();
  assert.equal(result.state, "READY_FOR_CONTROLLED_TEST");
  assert.equal(result.publishingCapability, "CONFIGURED_FOR_CONTROLLED_TEST");
  assert.equal(result.publishingProven, false);
  assert.ok(requestedUrls.every((url) => !url.includes("/me/permissions")));
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

test("the Facebook Graph host is rejected for Instagram Login tokens", async () => {
  let calls = 0;
  const result = await new MetaInstagramConnectivityValidator(config({ graphApiBaseUrl: "https://graph.facebook.com" }), async () => {
    calls += 1;
    return response({ id: "123" });
  }).validate();
  assert.equal(result.errorCode, "CONFIGURATION_ERROR");
  assert.ok(result.errorMessageSafe?.includes("META_GRAPH_API_BASE_URL_INVALID"));
  assert.equal(calls, 0);
});

test("connectivity validation has no configurable permissions or publication path", async () => {
  let calls = 0;
  const result = await new MetaInstagramConnectivityValidator(config(), async () => {
    calls += 1;
    return response({ id: "123", username: "vargen_fe" });
  }).validate();
  assert.equal(result.state, "LIMITED");
  assert.equal(result.errorCode, "ACCOUNT_NOT_COMPATIBLE");
  assert.equal(calls, 1);
});

test("connectivity operation guard permits only read-only non-publication paths", () => {
  assert.doesNotThrow(() => assertReadOnlyConnectivityOperation("GET", "/123"));
  assert.throws(() => assertReadOnlyConnectivityOperation("POST", "/123"), /READ_ONLY_OPERATION_FORBIDDEN/);
  assert.throws(() => assertReadOnlyConnectivityOperation("GET", "/123/media"), /READ_ONLY_OPERATION_FORBIDDEN/);
  assert.throws(() => assertReadOnlyConnectivityOperation("GET", "/media_publish"), /READ_ONLY_OPERATION_FORBIDDEN/);
});
