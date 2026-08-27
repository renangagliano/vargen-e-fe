# Controlled remote governance writes

This document records the Section 11.7 activation boundary.

## Current safe state

- `ADMIN_DATA_SOURCE=supabase-readonly`
- `ADMIN_REMOTE_WRITE_ENABLED=false`
- SQLite remains the authority.
- `INSTAGRAM_AUTO_PUBLISH_ON_APPROVAL` defaults to `false`.
- No Instagram write is performed by the Admin application in this state.

## Remote mutation boundary

When explicitly activated after final SQLite/Supabase reconciliation, Admin
mutations use the server-only Supabase RPC in
`docs/instagram/010_controlled_governance_mutation.sql`. The RPC is granted to
`service_role` only and receives the authenticated profile ID, expected
editorial version, and a bounded request ID. It creates versioned editorial
state, explicit Bible evidence/verification, rights confirmation, review
state, readiness evaluation, and audit records transactionally.

The browser never writes directly to Supabase and never receives the service
secret. A stale expected version fails with `EDITORIAL_VERSION_CONFLICT`.

## Publication worker boundary

Automatic publication is intentionally blocked until a personal server-side
worker is provisioned. The worker must own the delegated personal OneDrive
MSAL refresh and Instagram credentials, refresh and anonymously validate the
temporary media URL in memory, execute the existing idempotent Meta flow, read
back the media, clean up the temporary item, and persist only safe evidence.

The Vercel Admin request must not attempt to reuse the operator workstation's
MSAL cache or local SQLite media state. Until that worker exists, approval may
be used with auto-publish disabled; an auto-publish request fails closed with
`PUBLICATION_WORKER_REQUIRED`.

## Activation checklist

1. Apply the RPC migration only in the personal Supabase project.
2. Reconcile the final SQLite export, stable IDs, audit, publication, and
   analytics state.
3. Validate the RPC with mocked requests and real RLS checks.
4. Provision the personal publication worker without exposing credentials to
   the browser or storing temporary URLs.
5. Enable, separately and deliberately, `ADMIN_DATA_SOURCE=supabase`,
   `ADMIN_REMOTE_WRITE_ENABLED=true`, and then the auto-publish flag.
6. Perform one controlled Reel validation with the UI confirmation modal.

No paid infrastructure is required by this design; target incremental cost is
`BRL 0/year`.
