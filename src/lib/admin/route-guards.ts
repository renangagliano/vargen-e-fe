import type { AdminRole } from "./review-types";

export const PROTECTED_ADMIN_ROUTES = ["/admin", "/admin/review", "/admin/analytics", "/admin/publications"] as const;

export function requiredRolesForPath(pathname: string): readonly AdminRole[] {
  if (pathname === "/admin" || pathname === "/admin/review" || pathname === "/admin/analytics" || pathname === "/admin/publications") return ["ADMIN", "REVIEWER", "VIEWER"];
  return [];
}

