import type { AdminRole } from "./review-types";

export type AdminIdentity = {
  userId: string;
  email: string | null;
  role: AdminRole;
};

export function canReadWorkspace(role: AdminRole): boolean {
  return role === "ADMIN" || role === "REVIEWER" || role === "VIEWER";
}

export function canMutateGovernance(role: AdminRole): boolean {
  return role === "ADMIN" || role === "REVIEWER";
}

export function requireRole(identity: AdminIdentity | null, allowed: readonly AdminRole[]): AdminIdentity {
  if (!identity) throw new Error("ADMIN_AUTH_REQUIRED");
  if (!allowed.includes(identity.role)) throw new Error("ADMIN_FORBIDDEN");
  return identity;
}

export type AdminAuthAdapter = {
  getIdentity(): Promise<AdminIdentity | null>;
  signOut(): Promise<void>;
};
