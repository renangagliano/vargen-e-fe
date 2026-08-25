import { runtimeEnvironmentValue } from "../config/automation.js";

export const DEFAULT_META_GRAPH_API_BASE_URL = "https://graph.facebook.com";
export const DEFAULT_META_GRAPH_API_VERSION = "v22.0";
export const DEFAULT_META_CONNECTIVITY_TIMEOUT_MS = 15_000;

export type InstagramApiReadinessState =
  | "UNCONFIGURED"
  | "CREDENTIALS_PRESENT"
  | "AUTHENTICATED"
  | "ACCOUNT_VERIFIED"
  | "PUBLISH_PERMISSION_VERIFIED"
  | "READY_FOR_CONTROLLED_TEST"
  | "BLOCKED"
  | "ERROR";

export type ConnectivityCapability = "PASS" | "LIMITED" | "BLOCKED";

export type ConnectivityCheckStatus = "PASS" | "FAIL" | "LIMITED" | "BLOCKED" | "NOT_RUN";

export type ConnectivityErrorCode =
  | "CONFIGURATION_ERROR"
  | "AUTHENTICATION_ERROR"
  | "ACCOUNT_MISMATCH"
  | "PERMISSION_ERROR"
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
  credentials: ConnectivityCheckStatus;
  authentication: ConnectivityCheckStatus;
  accountAccess: ConnectivityCheckStatus;
  accountIdMatch: ConnectivityCheckStatus;
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
};

export type MetaConnectivityFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

type JsonRecord = Record<string, unknown>;

const REQUIRED_PERMISSION_ALIASES: ReadonlyArray<ReadonlyArray<string>> = [
  ["instagram_basic", "instagram_business_basic"],
  ["instagram_content_publish", "instagram_business_content_publish"],
];

const OFFICIAL_META_GRAPH_HOSTS = new Set(["graph.facebook.com", "graph.instagram.com"]);

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

export function loadInstagramConnectivityConfig(env: NodeJS.ProcessEnv = process.env): InstagramConnectivityConfig {
  const appSecret = envValue("META_APP_SECRET", env);
  return {
    appId: envValue("META_APP_ID", env),
    appSecretPresent: Boolean(appSecret),
    accountId: envValue("INSTAGRAM_ACCOUNT_ID", env),
    accessToken: envValue("INSTAGRAM_ACCESS_TOKEN", env),
    graphApiVersion: envValue("META_GRAPH_API_VERSION", env) ?? DEFAULT_META_GRAPH_API_VERSION,
    graphApiBaseUrl: envValue("META_GRAPH_API_BASE_URL", env) ?? DEFAULT_META_GRAPH_API_BASE_URL,
    permissionsEndpoint: envValue("META_PERMISSIONS_ENDPOINT", env) ?? "/me/permissions",
    timeoutMs: Number(envValue("META_CONNECTIVITY_TIMEOUT_MS", env) ?? DEFAULT_META_CONNECTIVITY_TIMEOUT_MS),
  };
}

function missingConfiguration(config: InstagramConnectivityConfig): string[] {
  const missing: string[] = [];
  if (!config.appId) missing.push("META_APP_ID_MISSING");
  if (!config.accountId) missing.push("INSTAGRAM_ACCOUNT_ID_MISSING");
  if (!config.accessToken) missing.push("INSTAGRAM_ACCESS_TOKEN_MISSING");
  return missing;
}

function invalidConfiguration(config: InstagramConnectivityConfig): string[] {
  const invalid: string[] = [];
  if (!/^v\d+\.\d+$/.test(config.graphApiVersion)) invalid.push("META_GRAPH_API_VERSION_INVALID");
  try {
    const url = new URL(config.graphApiBaseUrl);
    if (url.protocol !== "https:" || !OFFICIAL_META_GRAPH_HOSTS.has(url.hostname) || url.pathname !== "/" || url.username || url.password || url.port) {
      invalid.push("META_GRAPH_API_BASE_URL_INVALID");
    }
  } catch {
    invalid.push("META_GRAPH_API_BASE_URL_INVALID");
  }
  if (!config.permissionsEndpoint.startsWith("/") || config.permissionsEndpoint.includes("..") || config.permissionsEndpoint.includes("?")) {
    invalid.push("META_PERMISSIONS_ENDPOINT_INVALID");
  }
  return invalid;
}

function safeMessage(message: string, secrets: ReadonlyArray<string | undefined>): string {
  let sanitized = message
    .replace(/([?&]access_token=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(appsecret_proof=)[^&\s]+/gi, "$1[REDACTED]");
  for (const secret of secrets) {
    if (secret) sanitized = sanitized.split(secret).join("[REDACTED]");
  }
  return sanitized.slice(0, 500);
}

function errorDetails(body: unknown, status: number, accessToken?: string): { code: string; message: string } {
  const bodyRecord = record(body);
  const apiError = record(bodyRecord?.error) ?? bodyRecord;
  const code = text(apiError?.code) ?? `HTTP_${status}`;
  const message = safeMessage(text(apiError?.message) ?? `Meta API request failed with HTTP ${status}.`, [accessToken]);
  return { code, message };
}

function resultBase(configured: boolean): InstagramConnectivityResult {
  return {
    state: configured ? "CREDENTIALS_PRESENT" : "UNCONFIGURED",
    publishingCapability: configured ? "BLOCKED" : "BLOCKED",
    readyForControlledTest: false,
    checks: {
      credentials: configured ? "PASS" : "FAIL",
      authentication: "NOT_RUN",
      accountAccess: "NOT_RUN",
      accountIdMatch: "NOT_RUN",
      publishingCapability: "NOT_RUN",
    },
  };
}

function accountMetadata(body: unknown): InstagramAccountMetadata | undefined {
  const value = record(body);
  const id = text(value?.id);
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

function pathIsForbidden(pathname: string): boolean {
  const normalized = pathname.toLowerCase();
  return normalized.includes("media_publish") || /(^|\/)media(\/|$)/.test(normalized);
}

export class MetaInstagramConnectivityValidator {
  public constructor(
    private readonly config: InstagramConnectivityConfig,
    private readonly fetchImpl: MetaConnectivityFetch = fetch,
  ) {}

  private async getJson(pathname: string, query: Record<string, string>): Promise<{ ok: boolean; status: number; body: unknown; error?: { code: string; message: string } }> {
    if (!pathname.startsWith("/") || pathname.includes("..") || pathIsForbidden(pathname)) {
      throw new Error("CONNECTIVITY_PUBLISH_OPERATION_FORBIDDEN");
    }
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
    const missing = [...missingConfiguration(this.config), ...invalidConfiguration(this.config)];
    const result = resultBase(missing.length === 0);
    if (missing.length > 0) {
      return {
        ...result,
        errorCode: "CONFIGURATION_ERROR",
        errorMessageSafe: missing.join(", "),
      };
    }

    let accountResponse: Awaited<ReturnType<MetaInstagramConnectivityValidator["getJson"]>>;
    try {
      accountResponse = await this.getJson(`/${this.config.accountId!}`, {
        fields: "id,username,name,account_type",
      });
    } catch (error) {
      return {
        ...result,
        state: "ERROR",
        errorCode: "META_API_ERROR",
        errorMessageSafe: "Meta API connectivity request failed safely.",
      };
    }
    if (!accountResponse.ok) {
      const authenticationFailure = accountResponse.status === 401 || accountResponse.error?.code === "190";
      return {
        ...result,
        state: authenticationFailure ? "BLOCKED" : "ERROR",
        checks: { ...result.checks, authentication: "FAIL", accountAccess: "FAIL" },
        errorCode: authenticationFailure ? "AUTHENTICATION_ERROR" : "META_API_ERROR",
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

    const authenticated: InstagramConnectivityResult = {
      ...result,
      state: "ACCOUNT_VERIFIED",
      checks: { ...result.checks, authentication: "PASS", accountAccess: "PASS", accountIdMatch: "PASS" },
      account,
    };

    let permissionsResponse: Awaited<ReturnType<MetaInstagramConnectivityValidator["getJson"]>>;
    try {
      permissionsResponse = await this.getJson(this.config.permissionsEndpoint, {});
    } catch {
      return {
        ...authenticated,
        state: "BLOCKED",
        publishingCapability: "BLOCKED",
        checks: { ...authenticated.checks, publishingCapability: "BLOCKED" },
        errorCode: "PERMISSION_ERROR",
        errorMessageSafe: "Meta permission capability could not be validated safely.",
      };
    }
    if (!permissionsResponse.ok) {
      const authenticationFailure = permissionsResponse.status === 401 || permissionsResponse.error?.code === "190";
      return {
        ...authenticated,
        state: authenticationFailure ? "BLOCKED" : "BLOCKED",
        publishingCapability: "BLOCKED",
        checks: { ...authenticated.checks, publishingCapability: "BLOCKED" },
        errorCode: authenticationFailure ? "AUTHENTICATION_ERROR" : "PERMISSION_ERROR",
        errorMessageSafe: permissionsResponse.error?.message ?? "Meta publishing permission validation failed safely.",
      };
    }

    const permissionItems = permissions(permissionsResponse.body);
    if (!requiredPermissionsGranted(permissionItems)) {
      return {
        ...authenticated,
        state: "BLOCKED",
        publishingCapability: permissionItems.length > 0 ? "LIMITED" : "BLOCKED",
        checks: { ...authenticated.checks, publishingCapability: permissionItems.length > 0 ? "LIMITED" : "BLOCKED" },
        permissions: permissionItems,
        errorCode: "PERMISSION_ERROR",
        errorMessageSafe: permissionItems.length > 0
          ? "Required Instagram publishing permissions were not fully granted."
          : "Meta returned no usable publishing permission evidence.",
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
  return [
    "Instagram API Connectivity",
    "---------------------------",
    `Credentials: ${status(result.checks.credentials)}`,
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
