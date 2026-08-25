# Section 10.3 — Azure temporary media

The local Reels directory remains the source of truth. Azure is only a
temporary delivery layer for one already `CONTENT_READY` Reel:

```text
local CONTENT_READY Reel -> private Blob container -> blob-scoped read-only SAS -> Meta retrieval
```

No Meta container is created by the preparation workflow and no
`media_publish` call is made.

## Resources and privacy

Create these resources separately in Azure; the application does not create
them:

- one Storage Account with a private Blob service;
- one private container, preferably `instagram-publish-temp`;
- public container access disabled and anonymous listing disabled.

The provider checks container properties and fails if public access is
enabled. It uploads only one deterministic blob under the configured
`instagram-pilot/<reel-id>/` prefix. Source masters and the rest of the Reels
library are never uploaded.

## Authentication and RBAC

The production path uses `DefaultAzureCredential` and user-delegation SAS.
The preferred GitHub path is OIDC with `azure/login`:

```text
AZURE_CLIENT_ID=<federated application client ID>
AZURE_TENANT_ID=<tenant ID>
AZURE_SUBSCRIPTION_ID=<subscription ID>
AZURE_STORAGE_ACCOUNT_NAME=<storage account name>
AZURE_STORAGE_CONTAINER_NAME=instagram-publish-temp
AZURE_STORAGE_SAS_TTL_MINUTES=60
AZURE_STORAGE_BLOB_PREFIX=instagram-pilot
AZURE_STORAGE_ENDPOINT_SUFFIX=core.windows.net
```

The federated principal should receive `Storage Blob Data Contributor` only
on the required storage account or container scope. Because this implementation
uses a user-delegation SAS, it also needs the narrow `Storage Blob Delegator`
permission at the storage-account scope so Azure can issue the delegation key.
Do not grant subscription Owner, User Access Administrator, or broad
Contributor roles. Storage keys and client secrets are not required by this
implementation and must not be added to Git or reports.

## SAS policy

The provider creates a blob-level SAS with `sp=r`, HTTPS-only protocol, a
five-minute clock-skew allowance, and a configurable TTL between 15 and 120
minutes. Full SAS URLs are held only in memory for the next handoff; state,
audit events, logs, and reports contain only a redacted URL.

The URL is validated with an anonymous HEAD request. The expected host,
blob path, `video/mp4` content type, positive content length, expiry, and
local SHA-256 are checked. Redirects, private hosts, wrong content types,
wrong sizes, public containers, and non-read-only SAS permissions fail closed.

## Commands

Safe local dry-run:

```text
npm run instagram:media-prepare -- --reel=reel-80bc5fa99371b5d7b91b00cf --dry-run
```

The dry-run checks `CONTENT_READY`, trusted Reel resolution, file existence,
and checksum stability. It performs no Azure mutation, creates no URL, and
makes no Meta call.

Azure preparation is explicit and requires the configured environment:

```text
npm run instagram:media-prepare -- --reel=<content-ready-reel-id> --provider=azure
npm run instagram:media-status -- --reel=<reel-id>
npm run instagram:media-cleanup -- --reel=<reel-id> --provider=azure
npm run instagram:media-cleanup -- --expired --provider=azure
```

The manual workflow `.github/workflows/instagram-media-prepare.yml` uses the
`instagram-production` environment, supports `dry-run` and `azure`, and has no
Meta publishing step or artifact upload.

## State and cleanup

Migration `008_section10_3_temporary_media.sql` stores only provider, blob
identity, size, checksum, timestamps, status, and cleanup state. It never
stores SAS tokens, signed URLs, credentials, filesystem paths, or captions.

Preparation is idempotent for the same publication key and derived checksum.
An existing matching blob is reused; a different checksum at the deterministic
name is a collision and is rejected. Explicit cleanup deletes only tracked
blobs under the configured prefix. Local Reel files are never deleted.

## Stop boundary

This section ends after validated temporary-media preparation. The next pilot
workflow must independently re-evaluate the frozen snapshot and governance
gates before creating an Instagram container.
