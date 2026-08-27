# Remote Review Workspace — Section 11.2

## Implemented in this phase

The public Next.js application now contains a responsive Review Workspace shell at `/admin/review` with:

- compact queue tabs and persisted-count contract;
- horizontal, composable filters;
- table-first rendering with no inline video list;
- row-level Review drawer;
- responsive drawer/table behavior for tablet and mobile;
- explicit empty state when remote data is not connected;
- a public-site admin/login entry point that exposes no governance data.

The UI does not invent candidate rows or counts. It consumes `ReviewWorkspaceData` from a future authenticated server adapter.

## Remote API contract

The browser must call authenticated Next.js route handlers/server actions only. The server adapter should expose queue, candidate detail, editorial mutation, Bible draft/verification, rights, review status, readiness, analytics, and audit reads. Every mutation must run the existing domain validation, use the authenticated user as actor, commit an append-only/versioned record, then return the canonical read model.

The browser must never receive Meta access tokens, Microsoft Graph tokens, OneDrive download URLs, or a database/service-role key.

## Authentication status

The UI has an authentication abstraction and role model (`ADMIN`, `REVIEWER`, `VIEWER`), but no Supabase project credentials or remote backend are configured in this repository. The current static export therefore cannot claim to protect server routes. Before operational use, deploy the admin surface as a dynamic Next.js application, install/configure Supabase Auth SSR, and enforce `getClaims()`/server authorization plus RLS. The static public site may remain unchanged during this transition.

## Publishing boundary

Review Workspace actions do not publish. Controlled publication remains a separate, explicitly confirmed pipeline requiring CONTENT_READY, rights, Bible, editorial approval, and duplicate protection.
