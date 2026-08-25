# Phase 5 — Official Meta Publisher Boundary

`MetaInstagramPublisher` is an isolated adapter. It does not use browser automation, private endpoints, cookies, scraping or unofficial Instagram libraries.

The intended official flow is:

```text
approved time-limited HTTPS media URL
  -> create Reel media container
  -> poll container processing status
  -> publish processed container
  -> persist remote media ID
  -> later collect official insights
```

Section 8.1 replaces the former universal business-verification assumption
with capability-based readiness. The read-only connectivity validator checks
the configured account and permission evidence through official Graph API GET
requests. It does not create a media container and never calls
`media_publish`. Ambiguous or missing capability evidence remains fail-closed.

The Meta publisher itself still returns `BLOCKED_EXTERNAL` until a verified
connectivity result, an approved temporary HTTPS media provider, and all
existing human governance gates are supplied. Credentials alone never make
the publisher ready.

Readiness states are:

```text
UNCONFIGURED -> CREDENTIALS_PRESENT -> AUTHENTICATED -> ACCOUNT_VERIFIED
  -> PUBLISH_PERMISSION_VERIFIED -> READY_FOR_CONTROLLED_TEST
  -> BLOCKED | ERROR
```

`LIMITED` is used when Meta exposes only partial capability evidence, such
as a missing account type or incomplete permission set. Safe error
classification includes `TOKEN_EXPIRED`, `RATE_LIMITED`, `NETWORK_ERROR`,
`ACCOUNT_NOT_COMPATIBLE` and `META_API_ERROR`; these are not rewritten as a
business-verification blocker.

Expected configuration is injected at runtime only:

```text
META_GRAPH_API_VERSION=v22.0
META_GRAPH_API_BASE_URL=https://graph.facebook.com
META_PERMISSIONS_ENDPOINT=/me/permissions
META_APP_ID=
INSTAGRAM_ACCOUNT_ID=
INSTAGRAM_ACCESS_TOKEN=
```

`META_APP_SECRET` is injected by the protected runtime when configured. The
read-only probe does not need to send it, and the implementation never logs,
stores or includes it in a URL. The access token is sent only as an
`Authorization: Bearer` header for the request lifetime.

Run the validation manually with:

```text
npm run instagram:connectivity
```

The preferred real execution is the manually triggered GitHub Actions
workflow `Instagram API Connectivity`, using the `instagram-production`
environment. It reports only check states, safe account metadata and
sanitized errors. A successful result means `READY_FOR_CONTROLLED_TEST`, not
permission to publish automatically.

Secrets are never stored in SQLite payloads, audit metadata, logs or Git. The current `DryRunPublicationMediaProvider` produces a non-routable `dry-run.invalid` URL to validate payload shape without exposing OneDrive. A future provider must create a time-limited HTTPS URL for only the selected Reel and revoke it after publication.

The connected Maestri Instagram portal is an operator inspection/configuration surface, not the production publisher. Credential rotation is performed by replacing the GitHub Environment secret, rerunning the connectivity workflow, and reviewing the resulting account ID and permission state; old tokens must not be copied into Git, `.env.local`, SQLite or reports.
