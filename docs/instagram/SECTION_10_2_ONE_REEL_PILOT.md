# Section 10.2 — One-Reel Controlled Publication Pilot

Section 10.2 adds a deliberately narrow publication path for one operator-selected Reel. It stops at the explicit human publication gate and does not enable catalog-wide automation, scheduling, or full-auto publishing.

## Governance boundary

The pilot can select only a PRIMARY Reel whose existing `CONTENT_READY` evaluation passes. That gate remains authoritative and requires technical validation, source integrity, explicit human Bible verification, editorial approval, confirmed source rights, complete editorial fields, and the existing duplicate/publication guards.

The pilot never verifies Bible references, approves editorial content, confirms rights, or changes `CONTENT_READY` by itself. If no Reel is ready, selection reports `AWAITING_HUMAN_CONTENT_READY`.

## Frozen snapshot

Before a real attempt, the system freezes the selected Reel’s source and derived SHA-256 checksums, editorial version, approved caption, Bible state, rights state, technical state, safe relative paths, and a stable publication key. A later material change invalidates the snapshot and requires reselection.

Snapshots and pilot publication state are persisted in the additive `007_section10_pilot.sql` migration. Tokens and signed media URLs are never persisted.

## Temporary media provider

Instagram must retrieve the Reel from a public HTTPS URL. The current repository includes:

- `DryRunPublicationMediaProvider`, which uses a deliberately non-routable URL and cannot publish;
- `BlockedPublicationMediaProvider`, which fails closed until an approved, time-limited, one-file HTTPS provider is configured.

The pilot validates HTTPS, public host shape, content type, status, redirects, safe URL logging, a provider-attested match to the frozen derived SHA-256, and a future expiry. It does not expose the OneDrive directory, source masters, or a directory listing. No provider credentials are invented by this phase.

## Meta flow

The real adapter uses the Instagram Login API host `graph.instagram.com` and the account configured by `INSTAGRAM_ACCOUNT_ID`:

1. create one `REELS` container with the frozen caption and temporary `video_url`;
2. poll the container status with bounded polling;
3. call `media_publish` only after the container is `FINISHED`, the snapshot is still valid, the approval environment is active, and the operator confirmation is exact;
4. read back the returned media ID through the official API.

All automated tests use mocked HTTP. The normal Section 10.2 implementation and dry-run do not call Meta.

## Commands

Safe local validation:

```text
npm run instagram:pilot -- --dry-run
npm run instagram:pilot -- --dry-run --reel=<reel-id>
```

The real command is environment-gated and requires both an exact Reel ID and `I_CONFIRM_ONE_REEL_PUBLICATION`. The intended production entry point is the manually triggered `Instagram One Reel Pilot` workflow, not local credential storage.

## Workflow boundary

`.github/workflows/instagram-one-reel-pilot.yml` is `workflow_dispatch` only, uses the `instagram-production` environment, accepts exactly one `reel_id`, and refuses any confirmation other than `I_CONFIRM_ONE_REEL_PUBLICATION`. It has no schedule, catalog loop, artifact upload, or publication trigger other than the explicit one-Reel command.

The workflow does not make the system full-auto. A protected GitHub Environment approval and the explicit dispatch confirmation remain separate operator decisions.

## Failure safety and idempotency

Pilot publication keys combine Reel identity, editorial version, derived checksum, and target account. A previously published key is blocked as `DUPLICATE_PUBLICATION_PREVENTED`. An uncertain interrupted attempt is fail-closed and requires reconciliation. Remote processing errors and timeouts never proceed to `media_publish`.

Audit events include pilot selection, snapshot creation, media-provider creation, container creation/readiness, publish start/success/failure, confirmation, duplicate prevention, and abort. Metadata is restricted to safe IDs, checksums, versions, and sanitized errors.

## Current operational blocker

At implementation time the catalog has no human-approved `CONTENT_READY` Reel and no approved temporary HTTPS media provider. Therefore no real pilot is eligible or executed. Human review and rights confirmation must happen through the existing cockpit before a future Section 10.2 run.
