# Personal Supabase Auth — Section 11.3

## Operator configuration

Create a personal Supabase project and configure email/password Auth. Disable public signup after creating the first operator account. Add the first account manually in `Authentication > Users`, then create its `profiles` row with `role='ADMIN'` using the SQL editor or a server-only administrative operation. New profile rows default to `VIEWER`.

Configure only the dynamic admin deployment with:

```text
NEXT_PUBLIC_SUPABASE_URL=https://<personal-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable-or-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<server-only-key>
ADMIN_DATA_SOURCE=supabase-readonly
ADMIN_REMOTE_WRITE_ENABLED=false
```

The service-role key is never a `NEXT_PUBLIC_` variable and must not be copied into browser code, Git, SQLite, reports, or local command arguments.

## Runtime model

`src/lib/supabase/client.ts` is the browser client. `server.ts` uses the SSR cookie client for Server Components, Server Actions, and Route Handlers. `proxy.ts` contains the session-refresh helper for the dynamic admin deployment. `service.ts` is reserved for server-only migration/administration and is not used by normal browser reads.

Server authorization must validate the session with Supabase claims, load the active `profiles` row, and apply `ADMIN`, `REVIEWER`, or `VIEWER` permissions. The role is never accepted from a form, query string, or user-editable metadata.

## Deployment boundary

The current public site remains a static export. Do not enable these server helpers in the GitHub Pages build. Deploy the admin surface as a separate dynamic Next.js/Vercel application with the variables above. Until that split exists, `/admin/*` is a non-operational shell with no governance data.

## First verification

1. Apply `SUPABASE_SCHEMA_PROPOSAL.sql` to a personal staging project.
2. Create one Auth user and its `profiles` row as `ADMIN`.
3. Verify login, logout, inactive-user rejection, and read-only queue access.
4. Run `npm run admin:import-supabase` and review the dry-run manifest.
5. Keep `ADMIN_REMOTE_WRITE_ENABLED=false` until stable IDs, versions, publication history, analytics, and checksums match.
