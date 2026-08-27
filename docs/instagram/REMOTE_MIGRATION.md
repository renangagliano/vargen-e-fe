# Remote Review Workspace migration

## Authority and scope

The local SQLite database remains authoritative until every gate below passes. This migration moves governance state and safe metadata only. MP4 masters, generated Reels, covers, the Knowledge Base files, Meta tokens, Microsoft Graph tokens, and complete OneDrive URLs do not move to PostgreSQL.

The proposed remote store is Supabase PostgreSQL with Supabase Auth. Supabase Storage is not required: the publication provider continues to use personal OneDrive for temporary delivery.

## Schema mapping

| SQLite | PostgreSQL proposal |
| --- | --- |
| `media_assets` | `media_assets` |
| `derived_reels` | `derived_reels` |
| `reel_editorial_packages` | `editorial_versions` |
| `bible_reference_sources` | `bible_evidence` + `bible_verifications` |
| `source_rights_history` | `rights_sources` + `rights_confirmations` |
| `review_sessions` | `review_sessions` |
| `content_readiness` | `content_ready_evaluations` |
| `pilot_snapshots`, `pilot_publications` | `publication_records` plus snapshot columns |
| `publication_audit_events` | `publication_audit` |
| `instagram_analytics_snapshots` | `analytics_snapshots` |
| `temporary_media` | `temporary_media_records` |

Stable IDs are preserved as text. Editorial versions remain append-only. Analytics remain append-only and retain `AVAILABLE`, `UNSUPPORTED`, and `NOT_AVAILABLE` metric states.

## Migration sequence

1. Apply the reviewed schema in a personal Supabase project only.
2. Run `npm run admin:remote-validate` against local SQLite; save the safe row-count report outside Git.
3. Export deterministic batches keyed by stable IDs and checksums. Do not export secrets or media bytes.
4. Import into a staging schema and compare row counts, stable-ID sets, editorial-version maxima, publication IDs, analytics snapshot counts, and source checksum counts.
5. Perform read-only remote comparisons from an authenticated admin session.
6. Perform one controlled write on an unpublished candidate and verify actor, version, Bible state, audit event, and read-after-write.
7. Enable remote reads, retain local SQLite as a fallback, then enable remote writes after an explicit rollback window.

There is no destructive migration step. SQLite is not deleted and is not exposed over the internet.

## Authentication and authorization

Use Supabase Auth email/password initially, with server-side cookie sessions. Roles are `ADMIN`, `REVIEWER`, and `VIEWER`; authorization is checked in server actions/route handlers and enforced again by RLS. Roles must come from a trusted membership process or `app_metadata`, never user-editable metadata. Browser code receives no Meta or Graph token.

The current static export cannot enforce authenticated server routes. The remote admin deployment must therefore run as a dynamic Next.js deployment; the public static site can remain unchanged during Phase A–E.

## Local commands and flags

`npm run admin:export-sqlite` writes a 0600 migration export and manifest under the personal runtime state directory. `npm run admin:import-supabase` is dry-run by default; `--apply` is intentionally rejected until `ADMIN_REMOTE_WRITE_ENABLED=true`, a personal Supabase service-role key is configured server-side, and the import adapter has passed staging review. The command never exports or prints credentials, media bytes, MSAL cache, or complete temporary URLs.

`ADMIN_DATA_SOURCE=sqlite` is the safe default. `ADMIN_DATA_SOURCE=supabase-readonly` is the only remote mode enabled in this phase. The write flag defaults to `false` and is not enabled by this change.
