import { runtimeEnvironmentRawValue, runtimeEnvironmentValue } from "../config/automation.js";

export const DEFAULT_META_GRAPH_API_BASE_URL = "https://graph.instagram.com";
export const DEFAULT_META_GRAPH_API_VERSION = "v22.0";
export const DEFAULT_META_CONNECTIVITY_TIMEOUT_MS = 15_000;
export const INSTAGRAM_PROFILE_ENDPOINT = "/me";

export type InstagramApiReadinessState =
  | "UNCONFIGURED"
  | "CREDENTIALS_PRESENT"
  | "AUTHENTICATED"
  | "ACCOUNT_VERIFIED"
  | "PUBLISH_PERMISSION_VERIFIED"
  | "READY_FOR_CONTROLLED_TEST"
  | "LIMITED"
  | "BLOCKED"
  | "ERROR";

export type ConnectivityCapability = "PASS" | "LIMITED" | "BLOCKED";

export type ConnectivityCheckStatus = "PASS" | "FAIL" | "LIMITED" | "BLOCKED" | "NOT_RUN";

export type ConnectivityErrorCode =
  | "CONFIGURATION_ERROR"
  | "AUTHENTICATION_ERROR"
  | "ACCOUNT_MISMATCH"
  | "ACCOUNT_NOT_COMPATIBLE"
  | "PERMISSION_ERROR"
  | "TOKEN_EXPIRED"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "META_API_ERROR";

export type InstagramConnectivityConfig = {
  appId?: string;
  appSecretPresent: boolean;
  accountId?: string;
  accessToken?: string;
  graphApiVersion: string;
  graphApiBaseUrl: string;
  permissionsEndpoint: string;
  timeoutMs: number;
  tokenShape?: InstagramTokenShapeDiagnostics;
};

export type InstagramTokenShapeDiagnostics = {
  tokenPresent: boolean;
  tokenLength: number;
  tokenPrefixLengthSafe: number;
  leadingWhitespace: boolean;
  trailingWhitespace: boolean;
  containsNewline: boolean;
  containsCarriageReturn: boolean;
  containsSpace: boolean;
  startsWithBearerLiteral: boolean;
  startsWithQuote: boolean;
  endsWithQuote: boolean;
};

export type InstagramAccountMetadata = {
  id: string;
  username?: string;
  name?: string;
  account_type?: string;
};

export type InstagramPermission = {
  permission: string;
  status: string;
};

export type ConnectivityChecks = {
  configuration: ConnectivityCheckStatus;
  credentials: ConnectivityCheckStatus;
  authentication: ConnectivityCheckStatus;
  accountAccess: ConnectivityCheckStatus;
  accountIdMatch: ConnectivityCheckStatus;
  accountCompatibility: ConnectivityCheckStatus;
  publishingCapability: ConnectivityCheckStatus;
};

export type InstagramConnectivityResult = {
  state: InstagramApiReadinessState;
  publishingCapability: ConnectivityCapability;
  readyForControlledTest: boolean;
  checks: ConnectivityChecks;
  account?: InstagramAccountMetadata;
  permissions?: InstagramPermission[];
  errorCode?: ConnectivityErrorCode;
  errorMessageSafe?: string;
  apiHost: string;
  authenticationEndpoint: string;
  authorizationMethod: "Bearer header";
  tokenShape: InstagramTokenShapeDiagnostics;
};

export type MetaConnectivityFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

type JsonRecord = Record<string, unknown>;

type MetaErrorDetails = {
  code: string;
  message: string;
  subcode?: string;
  type?: string;
};

const REQUIRED_PERMISSION_ALIASES: ReadonlyArray<ReadonlyArray<string>> = [
  ["instagram_basic", "instagram_business_basic"],
  ["instagram_content_publish", "instagram_business_content_publish"],
];

const OFFICIAL_META_GRAPH_HOSTS = new Set(["graph.instagram.com"]);

function record(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function envValue(key: string, env: NodeJS.ProcessEnv): string | undefined {
  const value = env === process.env ? runtimeEnvironmentValue(key, env) : env[key]?.trim();
  return value || undefined;
}

export function inspectInstagramTokenShape(rawAccessToken: string | undefined): InstagramTokenShapeDiagnostics {
  const token = rawAccessToken ?? "";
  return {
    tokenPresent: token.length > 0,
    tokenLength: token.length,
    tokenPrefixLengthSafe: Math.min(token.length, 8),
    leadingWhitespace: token.length > 0 && /^\s/.test(token),
    trailingWhitespace: token.length > 0 && /\s$/.test(token),
    containsNewline: token.includes("\n"),
    containsCarriageReturn: token.includes("\r"),
    containsSpace: token.includes(" "),
    startsWithBearerLiteral: /^Bearer\s+/i.test(token),
    startsWithQuote: /^["']/.test(token),
    endsWithQuote: /["']$/.test(token),
  };
}

export function loadInstagramConnectivityConfig(env: NodeJS.ProcessEnv = process.env): InstagramConnectivityConfig {
  const appSecret = envValue("META_APP_SECRET", env);
  const rawAccessToken = runtimeEnvironmentRawValue("INSTAGRAM_ACCESS_TOKEN", env);
  return {
    appId: envValue("META_APP_ID", env),
    appSecretPresent: Boolean(appSecret),
    accountId: envValue("INSTAGRAM_ACCOUNT_ID", env),
    accessToken: rawAccessToken?.trim() || undefined,
    graphApiVersion: envValue("META_GRAPH_API_VERSION", env) ?? DEFAULT_META_GRAPH_API_VERSION,
    graphApiBaseUrl: envValue("META_GRAPH_API_BASE_URL", env) ?? DEFAULT_META_GRAPH_API_BASE_URL,
    permissionsEndpoint: envValue("META_PERMISSIONS_ENDPOINT", env) ?? "/me/permissions",
    timeoutMs: Number(envValue("META_CONNECTIVITY_TIMEOUT_MS", env) ?? DEFAULT_META_CONNECTIVITY_TIMEOUT_MS),
    tokenShape: inspectInstagramTokenShape(rawAccessToken),
  };
}

function missingConfiguration(config: InstagramConnectivityConfig): string[] {
  const missing: string[] = [];
  if (!config.accessToken) missing.push("INSTAGRAM_ACCESS_TOKEN_MISSING");
  if (!config.accountId) missing.push("INSTAGRAM_ACCOUNT_ID_MISSING");
  return missing;
}

function invalidConfiguration(config: InstagramConnectivityConfig): string[] {
  const invalid: string[] = [];
  if (!config.appId) invalid.push("META_APP_ID_MISSING");
  if (!/^v\d+\.\d+$/.test(config.graphApiVersion)) invalid.push("META_GRAPH_API_VERSION_INVALID");
  try {
    const url = new URL(config.graphApiBaseUrl);
    if (url.protocol !== "https:" || !OFFICIAL_META_GRAPH_HOSTS.has(url.hostname) || url.pathname !== "/" || url.username || url.password || url.port) {
      invalid.push("META_GRAPH_API_BASE_URL_INVALID");
    }
  } catch {
    invalid.push("META_GRAPH_API_BASE_URL_INVALID");
  }
  if (!config.permissionsEndpoint.startsWith("/") || config.permissionsEndpoint.includes("..") || config.permissionsEndpoint.includes("?") || config.permissionsEndpoint.includes("#") || pathIsForbidden(config.permissionsEndpoint)) {
    invalid.push("META_PERMISSIONS_ENDPOINT_INVALID");
  }
  const tokenShape = config.tokenShape ?? inspectInstagramTokenShape(config.accessToken);
  if (tokenShape.startsWithBearerLiteral) invalid.push("INSTAGRAM_ACCESS_TOKEN_MUST_CONTAIN_RAW_TOKEN");
  if (tokenShape.startsWithQuote || tokenShape.endsWithQuote) invalid.push("INSTAGRAM_ACCESS_TOKEN_MUST_NOT_BE_QUOTED");
  if (config.accessToken && /\s/.test(config.accessToken)) invalid.push("INSTAGRAM_ACCESS_TOKEN_INTERNAL_WHITESPACE");
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 60_000) invalid.push("META_CONNECTIVITY_TIMEOUT_INVALID");
  return invalid;
}

function safeMessage(message: string, secrets: ReadonlyArray<string | undefined>): string {
  let sanitized = message
    .replace(/([?&]access_token=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(appsecret_proof=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\bEA[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\b(access[_ -]?token|refresh[_ -]?token|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
  for (const secret of secrets) {
    if (secret) sanitized = sanitized.split(secret).join("[REDACTED]");
  }
  return sanitized.slice(0, 500);
}

function errorDetails(body: unknown, status: number, accessToken?: string): MetaErrorDetails {
  const bodyRecord = record(body);
  const apiError = record(bodyRecord?.error) ?? bodyRecord;
  const code = text(apiError?.code) ?? `HTTP_${status}`;
  const message = safeMessage(text(apiError?.message) ?? `Meta API request failed with HTTP ${status}.`, [accessToken]);
  return {
    code,
    message,
    ...(text(apiError?.error_subcode) ? { subcode: text(apiError?.error_subcode) } : {}),
    ...(text(apiError?.type) ? { type: text(apiError?.type) } : {}),
  };
}

function safeHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "invalid";
  }
}

function resultBase(config: InstagramConnectivityConfig, configurationPresent: boolean, credentialsPresent: boolean): InstagramConnectivityResult {
  return {
    state: configurationPresent && credentialsPresent ? "CREDENTIALS_PRESENT" : "UNCONFIGURED",
    publishingCapability: "BLOCKED",
    readyForControlledTest: false,
    apiHost: safeHost(config.graphApiBaseUrl),
    authenticationEndpoint: INSTAGRAM_PROFILE_ENDPOINT,
    authorizationMethod: "Bearer header",
    tokenShape: config.tokenShape ?? inspectInstagramTokenShape(config.accessToken),
    checks: {
      configuration: configurationPresent ? "PASS" : "FAIL",
      credentials: credentialsPresent ? "PASS" : "FAIL",
      authentication: "NOT_RUN",
      accountAccess: "NOT_RUN",
      accountIdMatch: "NOT_RUN",
      accountCompatibility: "NOT_RUN",
      publishingCapability: "NOT_RUN",
    },
  };
}

function accountMetadata(body: unknown): InstagramAccountMetadata | undefined {
  const value = record(body);
  const id = text(value?.id) ?? text(value?.user_id);
  if (!id) return undefined;
  return {
    id,
    ...(text(value?.username) ? { username: text(value?.username) } : {}),
    ...(text(value?.name) ? { name: text(value?.name) } : {}),
    ...(text(value?.account_type) ? { account_type: text(value?.account_type) } : {}),
  };
}

function permissions(body: unknown): InstagramPermission[] {
  const value = record(body);
  if (!Array.isArray(value?.data)) return [];
  return value.data.flatMap((item): InstagramPermission[] => {
    const permission = record(item);
    const name = text(permission?.permission);
    const status = text(permission?.status);
    return name && status ? [{ permission: name, status }] : [];
  });
}

function requiredPermissionsGranted(items: InstagramPermission[]): boolean {
  return REQUIRED_PERMISSION_ALIASES.every((aliases) => items.some((item) => aliases.includes(item.permission) && item.status.toLowerCase() === "granted"));
}

function tokenExpired(error?: MetaErrorDetails): boolean {
  return error?.subcode === "463" || error?.subcode === "467" || /token.*expired|session.*expired|expired.*token/i.test(error?.message ?? "");
}

function rateLimited(status: number, error?: MetaErrorDetails): boolean {
  return status === 429 || ["4", "17", "32", "613"].includes(error?.code ?? "");
}

function responseErrorCode(status: number, error: MetaErrorDetails | undefined, permissionRequest: boolean): ConnectivityErrorCode {
  if (tokenExpired(error)) return "TOKEN_EXPIRED";
  if (rateLimited(status, error)) return "RATE_LIMITED";
  if (status === 401 || error?.code === "190") return "AUTHENTICATION_ERROR";
  if (status === 403 || (permissionRequest && ["10", "200", "299"].includes(error?.code ?? ""))) return "PERMISSION_ERROR";
  return "META_API_ERROR";
}

function stateForError(errorCode: ConnectivityErrorCode): "BLOCKED" | "ERROR" {
  return errorCode === "AUTHENTICATION_ERROR" || errorCode === "TOKEN_EXPIRED" || errorCode === "PERMISSION_ERROR" || errorCode === "ACCOUNT_NOT_COMPATIBLE"
    ? "BLOCKED"
    : "ERROR";
}

function compatibilityStatus(accountType: string | undefined): ConnectivityCheckStatus {
  if (!accountType) return "LIMITED";
  return accountType === "BUSINESS" || accountType === "CREATOR" ? "PASS" : "FAIL";
}

function pathIsForbidden(pathname: string): boolean {
  const normalized = pathname.toLowerCase();
  return normalized.includes("media_publish") || /(^|\/)media(\/|$)/.test(normalized);
}

export function assertReadOnlyConnectivityOperation(method: string, pathname: string): void {
  if (method.toUpperCase() !== "GET" || !pathname.startsWith("/") || pathname.includes("..") || pathIsForbidden(pathname)) {
    throw new Error("CONNECTIVITY_READ_ONLY_OPERATION_FORBIDDEN");
  }
}

export class MetaInstagramConnectivityValidator {
  public constructor(
    private readonly config: InstagramConnectivityConfig,
    private readonly fetchImpl: MetaConnectivityFetch = fetch,
  ) {}

  private async getJson(pathname: string, query: Record<string, string>): Promise<{ ok: boolean; status: number; body: unknown; error?: MetaErrorDetails }> {
    assertReadOnlyConnectivityOperation("GET", pathname);
    const base = this.config.graphApiBaseUrl.replace(/\/$/, "");
    const version = this.config.graphApiVersion.replace(/^\/+|\/+$/g, "");
    const url = new URL(`${base}/${version}/${pathname.replace(/^\/+/, "")}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.config.accessToken ?? ""}`,
      },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    const bodyText = await response.text();
    let body: unknown = undefined;
    try {
      body = bodyText ? JSON.parse(bodyText) : undefined;
    } catch {
      body = undefined;
    }
    return response.ok
      ? { ok: true, status: response.status, body }
      : { ok: false, status: response.status, body, error: errorDetails(body, response.status, this.config.accessToken) };
  }

  public async validate(): Promise<InstagramConnectivityResult> {
    const credentialErrors = missingConfiguration(this.config);
    const configurationErrors = invalidConfiguration(this.config);
    const result = resultBase(this.config, configurationErrors.length === 0, credentialErrors.length === 0);
    if (credentialErrors.length > 0 || configurationErrors.length > 0) {
      return {
        ...result,
        errorCode: "CONFIGURATION_ERROR",
        errorMessageSafe: [...configurationErrors, ...credentialErrors].join(", "),
      };
    }

    let accountResponse: Awaited<ReturnType<MetaInstagramConnectivityValidator["getJson"]>>;
    try {
      accountResponse = await this.getJson(INSTAGRAM_PROFILE_ENDPOINT, {
        fields: "id,username,name,account_type",
      });
    } catch {
      return {
        ...result,
        state: "ERROR",
        errorCode: "NETWORK_ERROR",
        errorMessageSafe: "Meta API network request failed safely.",
      };
    }
    if (!accountResponse.ok) {
      const errorCode = responseErrorCode(accountResponse.status, accountResponse.error, false);
      return {
        ...result,
        state: stateForError(errorCode),
        checks: { ...result.checks, authentication: "FAIL", accountAccess: "FAIL" },
        errorCode,
        errorMessageSafe: accountResponse.error?.message ?? "Meta account access failed safely.",
      };
    }

    const account = accountMetadata(accountResponse.body);
    if (!account) {
      return {
        ...result,
        state: "ERROR",
        checks: { ...result.checks, authentication: "PASS", accountAccess: "FAIL" },
        errorCode: "META_API_ERROR",
        errorMessageSafe: "Meta returned no usable account identity.",
      };
    }
    if (account.id !== this.config.accountId) {
      return {
        ...result,
        state: "BLOCKED",
        checks: { ...result.checks, authentication: "PASS", accountAccess: "PASS", accountIdMatch: "FAIL" },
        account,
        errorCode: "ACCOUNT_MISMATCH",
        errorMessageSafe: "The Meta account identity does not match INSTAGRAM_ACCOUNT_ID.",
      };
    }

    const accountType = account.account_type?.toUpperCase();
    const accountCompatibility = compatibilityStatus(accountType);
    if (accountCompatibility === "FAIL") {
      return {
        ...result,
        state: "BLOCKED",
        checks: { ...result.checks, authentication: "PASS", accountAccess: "PASS", accountIdMatch: "PASS", accountCompatibility },
        account,
        errorCode: "ACCOUNT_NOT_COMPATIBLE",
        errorMessageSafe: "Meta returned an account type that is not compatible with Instagram publishing.",
      };
    }

    const authenticated: InstagramConnectivityResult = {
      ...result,
      state: "ACCOUNT_VERIFIED",
      checks: { ...result.checks, authentication: "PASS", accountAccess: "PASS", accountIdMatch: "PASS", accountCompatibility },
      account,
    };

    let permissionsResponse: Awaited<ReturnType<MetaInstagramConnectivityValidator["getJson"]>>;
    try {
      permissionsResponse = await this.getJson(this.config.permissionsEndpoint, {});
    } catch {
      return {
        ...authenticated,
        state: "ERROR",
        publishingCapability: "BLOCKED",
        checks: { ...authenticated.checks, publishingCapability: "BLOCKED" },
        errorCode: "NETWORK_ERROR",
        errorMessageSafe: "Meta permission network request failed safely.",
      };
    }
    if (!permissionsResponse.ok) {
      const errorCode = responseErrorCode(permissionsResponse.status, permissionsResponse.error, true);
      return {
        ...authenticated,
        state: stateForError(errorCode),
        publishingCapability: "BLOCKED",
        checks: { ...authenticated.checks, publishingCapability: "BLOCKED" },
        errorCode,
        errorMessageSafe: permissionsResponse.error?.message ?? "Meta publishing permission validation failed safely.",
      };
    }

    const permissionItems = permissions(permissionsResponse.body);
    if (!requiredPermissionsGranted(permissionItems)) {
      return {
        ...authenticated,
        state: "LIMITED",
        publishingCapability: permissionItems.length > 0 ? "LIMITED" : "BLOCKED",
        checks: { ...authenticated.checks, publishingCapability: permissionItems.length > 0 ? "LIMITED" : "BLOCKED" },
        permissions: permissionItems,
        errorCode: "PERMISSION_ERROR",
        errorMessageSafe: permissionItems.length > 0
          ? "Required Instagram publishing permissions were not fully granted."
          : "Meta returned no usable publishing permission evidence.",
      };
    }

    if (authenticated.checks.accountCompatibility !== "PASS") {
      return {
        ...authenticated,
        state: "LIMITED",
        publishingCapability: "LIMITED",
        readyForControlledTest: false,
        errorCode: "ACCOUNT_NOT_COMPATIBLE",
        errorMessageSafe: "Meta did not expose a professional account type for compatibility validation.",
        permissions: permissionItems,
      };
    }

    return {
      ...authenticated,
      state: "READY_FOR_CONTROLLED_TEST",
      publishingCapability: "PASS",
      readyForControlledTest: true,
      checks: { ...authenticated.checks, publishingCapability: "PASS" },
      permissions: permissionItems,
    };
  }
}

export function formatInstagramConnectivityResult(result: InstagramConnectivityResult): string {
  const status = (value: ConnectivityCheckStatus): string => value;
  const tokenShape = result.tokenShape;
  return [
    "Instagram API Connectivity",
    "---------------------------",
    `Configuration: ${status(result.checks.configuration)}`,
    `Credentials: ${status(result.checks.credentials)}`,
    `API host: ${result.apiHost}`,
    `Authentication endpoint: ${result.authenticationEndpoint}`,
    `Authorization method: ${result.authorizationMethod}`,
    ...(result.account ? [
      `Authenticated account ID: ${result.account.id}`,
      `Authenticated username: ${result.account.username ?? "NOT_RETURNED"}`,
      `Authenticated account type: ${result.account.account_type ?? "NOT_RETURNED"}`,
    ] : []),
    "Token shape diagnostics:",
    `token_present=${tokenShape.tokenPresent}`,
    `token_length=${tokenShape.tokenLength}`,
    `token_prefix_length_safe=${tokenShape.tokenPrefixLengthSafe}`,
    `leading_whitespace=${tokenShape.leadingWhitespace}`,
    `trailing_whitespace=${tokenShape.trailingWhitespace}`,
    `contains_newline=${tokenShape.containsNewline}`,
    `contains_carriage_return=${tokenShape.containsCarriageReturn}`,
    `contains_space=${tokenShape.containsSpace}`,
    `starts_with_bearer_literal=${tokenShape.startsWithBearerLiteral}`,
    `starts_with_quote=${tokenShape.startsWithQuote}`,
    `ends_with_quote=${tokenShape.endsWithQuote}`,
    `Authentication: ${status(result.checks.authentication)}`,
    `Account access: ${status(result.checks.accountAccess)}`,
    `Account ID match: ${status(result.checks.accountIdMatch)}`,
    `Publishing capability: ${result.publishingCapability}`,
    "Publishing executed: NO",
    "",
    `Readiness: ${result.readyForControlledTest ? "READY_FOR_CONTROLLED_TEST" : result.state}`,
    ...(result.errorCode ? [`Error: ${result.errorCode}`, `Detail: ${result.errorMessageSafe ?? "No further safe detail available."}`] : []),
  ].join("\n");
}
