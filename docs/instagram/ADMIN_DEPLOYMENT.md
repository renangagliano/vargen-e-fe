# Dynamic Admin Workspace deployment

The public site and the authenticated workspace are separate deployments.

## Applications

- Public site: the repository root, Next.js `output: "export"`, GitHub Pages.
- Admin: `apps/admin`, dynamic Next.js runtime, intended for the personal Vercel Hobby team.

The admin app reads only the migrated Supabase read model in this phase. SQLite
remains authoritative and `ADMIN_REMOTE_WRITE_ENABLED=false` must remain set.

## Vercel project

Create a separate personal Vercel project with:

- Root Directory: `apps/admin`
- Framework: Next.js
- Plan: Hobby
- Production branch: `main`
- Preview branches: feature branches as needed

Do not connect the project to a corporate Vercel team or add paid services.

## Environment variables

Configure these in Vercel Preview and Production settings, never in Git:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
ADMIN_DATA_SOURCE=supabase-readonly
ADMIN_REMOTE_WRITE_ENABLED=false
```

The secret key is server-only. The admin app uses the publishable key with the
Supabase Auth session for normal reads; no Meta or Microsoft credentials belong
in this deployment.

## Supabase Auth URLs

After the first preview is created, add its exact URL plus `/auth/callback` only
if an OAuth callback is introduced. For the current email/password flow, add
the exact preview origin and the future production origin
`https://admin.vargenefe.com.br` in Supabase Auth URL configuration. Avoid broad
wildcards.

## Validation

Validate anonymously that `/review`, `/analytics`, and `/publications` redirect
to `/login`. After signing in with the existing personal ADMIN user, validate
the queue, candidate drawer, analytics snapshots, publication history, and
logout. Mutation requests must return `REMOTE_WRITE_DISABLED` and must not
change remote rows.

## Public link

Set `NEXT_PUBLIC_ADMIN_URL` in the public GitHub Pages build environment to the
validated admin origin. Until then, the public site retains the relative
`/admin/login` fallback and the root static admin shell remains an engineering
fallback only.
