import net from "node:net";
import { URL } from "node:url";

export type MediaUrlValidation = {
  ok: boolean;
  code: "PASS" | "HTTPS_REQUIRED" | "PUBLIC_URL_REQUIRED" | "CONTENT_TYPE_INVALID" | "HTTP_ERROR" | "URL_EXPIRED" | "REDIRECT_NOT_ALLOWED" | "DRY_RUN_ONLY";
  contentType: string | null;
  contentLength: number | null;
  safeUrl: string;
};

export type TemporaryMediaUrlFetcher = (url: string) => Promise<{ status: number; headers: Headers; redirected?: boolean }>;

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(lower) || lower.endsWith(".localhost")) return true;
  const ipVersion = net.isIP(lower);
  if (ipVersion === 4) {
    const octets = lower.split(".").map(Number);
    return octets[0] === 10 || octets[0] === 127 || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168);
  }
  return ipVersion === 6 && (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:"));
}

export function sanitizeMediaUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

export function validateMediaUrlShape(value: string, dryRun = false): MediaUrlValidation {
  let parsed: URL;
  try { parsed = new URL(value); } catch { return { ok: false, code: "PUBLIC_URL_REQUIRED", contentType: null, contentLength: null, safeUrl: "[invalid-url]" }; }
  const safeUrl = sanitizeMediaUrl(value);
  if (dryRun && parsed.hostname === "dry-run.invalid") return { ok: true, code: "DRY_RUN_ONLY", contentType: "video/mp4", contentLength: null, safeUrl };
  if (parsed.protocol !== "https:") return { ok: false, code: "HTTPS_REQUIRED", contentType: null, contentLength: null, safeUrl };
  if (isPrivateHostname(parsed.hostname) || parsed.username || parsed.password) return { ok: false, code: "PUBLIC_URL_REQUIRED", contentType: null, contentLength: null, safeUrl };
  return { ok: true, code: "PASS", contentType: null, contentLength: null, safeUrl };
}

export async function validateTemporaryMediaUrl(value: string, fetcher: TemporaryMediaUrlFetcher = async (url) => {
  const response = await fetch(url, { method: "GET", redirect: "manual", headers: { Range: "bytes=0-0" } });
  return { status: response.status, headers: response.headers, redirected: response.redirected };
}, dryRun = false): Promise<MediaUrlValidation> {
  const shape = validateMediaUrlShape(value, dryRun);
  if (!shape.ok || shape.code === "DRY_RUN_ONLY") return shape;
  const response = await fetcher(value);
  if (response.redirected || [301, 302, 303, 307, 308].includes(response.status)) return { ...shape, ok: false, code: "REDIRECT_NOT_ALLOWED" };
  if (response.status !== 200 && response.status !== 206) return { ...shape, ok: false, code: "HTTP_ERROR" };
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
  const contentLengthValue = response.headers.get("content-length");
  const contentLength = contentLengthValue && /^\d+$/.test(contentLengthValue) ? Number(contentLengthValue) : null;
  if (!contentType || !["video/mp4", "application/mp4"].includes(contentType)) return { ...shape, ok: false, code: "CONTENT_TYPE_INVALID", contentType, contentLength };
  return { ...shape, code: "PASS", contentType, contentLength };
}
