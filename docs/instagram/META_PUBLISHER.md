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

The current project is externally blocked by Meta business verification/App Review requirements. `META_PRODUCTION_ELIGIBLE=false` is the safe state. While false, the adapter returns `BLOCKED_EXTERNAL` with `META_BUSINESS_VERIFICATION_REQUIRED` and performs no HTTP call.

Expected configuration is injected at runtime only:

```text
META_PRODUCTION_ELIGIBLE=false
META_GRAPH_API_VERSION=
META_APP_ID=
INSTAGRAM_ACCOUNT_ID=
INSTAGRAM_ACCESS_TOKEN=
```

Secrets are never stored in SQLite payloads, audit metadata, logs or Git. The current `DryRunPublicationMediaProvider` produces a non-routable `dry-run.invalid` URL to validate payload shape without exposing OneDrive. A future provider must create a time-limited HTTPS URL for only the selected Reel and revoke it after publication.

The connected Maestri Instagram portal is an operator inspection/configuration surface, not the production publisher.
