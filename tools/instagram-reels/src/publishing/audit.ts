import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { appendAuditEvent } from "../database/db.js";

export function audit(db: DatabaseSync, input: { entityType: string; entityId: string; eventType: string; actor: string; metadata?: Record<string, unknown>; eventId?: string }): void {
  appendAuditEvent(db, { eventId: input.eventId ?? `event-${randomUUID()}`, entityType: input.entityType, entityId: input.entityId, eventType: input.eventType, actor: input.actor, metadataJsonSafe: JSON.stringify(input.metadata ?? {}) });
}
