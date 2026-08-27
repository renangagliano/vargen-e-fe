# Phase 5 — Publishing Control Plane

Phase 5 adds a local, durable control plane for future Instagram publishing. It does not publish the pilot or call Meta.

## Operating modes

`INSTAGRAM_PUBLISH_MODE=dry-run` is the default. It creates a safe payload, checks gates and records `DRY_RUN_VALIDATED` or `DRY_RUN_BLOCKED`; it never calls a network publisher.

`approval` requires explicit rights confirmation and editorial approval before a job can be scheduled. `full-auto` remains a future mode and requires capability-based Meta readiness, a verified temporary media provider and operational approval.

## Gates

The centralized eligibility service checks technical validation, source checksum, editorial version approval, rights confirmation, output and cover existence, editorial fields, Bible reference, duplicate publication, spacing and frequency. Pending rights or an unapproved editorial version produce `BLOCKED` and cannot become `READY_FOR_PUBLISHING`.

## Rights and review

```text
RIGHTS_PENDING_CONFIRMATION -> RIGHTS_CONFIRMED | RIGHTS_REJECTED
READY_FOR_HUMAN_REVIEW      -> APPROVED | REJECTED | NEEDS_CHANGES
```

Actions require an operator identity and note. A material editorial edit creates a new version and resets review to `READY_FOR_HUMAN_REVIEW`.

Useful commands:

```text
node tools/instagram-reels/dist/src/cli/index.js reel:eligibility <reel-id>
node tools/instagram-reels/dist/src/cli/index.js reel:rights <reel-id> confirm --by=<operator> --note=<evidence>
node tools/instagram-reels/dist/src/cli/index.js reel:approve <reel-id> --version=1 --by=<editor> --note=<review>
node tools/instagram-reels/dist/src/cli/index.js publish:dry-run <reel-id>
node tools/instagram-reels/dist/src/cli/index.js reel:schedule <reel-id> <ISO-date> --by=<operator>
```

The pilot remains rights-pending and must not be confirmed automatically.

## Section 9 handoff

Section 9 termina em `CONTENT_READY`. O inventário local
`content-ready.json` contém somente conteúdo tecnicamente validado,
editorialmente aprovado, com Bíblia verificada e direitos confirmados pelo
operador. Esse arquivo é uma fronteira para a futura Section 10; não cria
jobs, não agenda, não publica e não chama a Meta. A prontidão da API é
independente do `CONTENT_READY` e somente pode avançar após a validação
oficial de conta e permissões.

## Durable publication state

SQLite persists publication jobs, idempotency keys, retry metadata, safe payloads and audit events. Runtime state is outside Git and outside the OneDrive master directory.

```text
NOT_PUBLISHED -> READY_FOR_PUBLISHING -> SCHEDULED -> QUEUED -> PUBLISHING
  -> PROCESSING_REMOTE -> PUBLISHED
  -> PUBLISH_FAILED | BLOCKED_EXTERNAL | CANCELLED
```

Dry-run outcomes are separate from real `PUBLISHED` state.

## Section 10.3 temporary media

The approved temporary-media implementation is Azure Blob Storage with a
private container and a blob-scoped, HTTPS-only, read-only user-delegation
SAS. Use `INSTAGRAM_TEMP_MEDIA_PROVIDER=azure` only in an explicitly configured
production execution environment; local dry-run remains the default. See
`AZURE_TEMP_MEDIA.md` for RBAC, TTL, validation, cleanup, and the manual
preparation workflow. Temporary media preparation does not create a Meta
container, call `media_publish`, or publish content.

The reusable local-first alternative is `onedrive-personal`. It requires a
delegated personal Microsoft account, validates `/me/drive` as
`driveType=personal`, uploads only one frozen CONTENT_READY Reel below
`VargenFe/InstagramTemp`, and validates the anonymous
`@microsoft.graph.downloadUrl` as the exact MP4. See
`ONEDRIVE_TEMP_MEDIA.md`. A sharing web page is not a media URL, and no
provider is allowed to call Meta during media preparation.

Personal authentication setup, cache handling and the localhost PKCE flow are
documented in `PERSONAL_MICROSOFT_AUTH.md`.
# Fase 7 — governança antes da publicação

Antes de qualquer futura fila de publicação, o cockpit exige aprovação
editorial, direitos confirmados e referências bíblicas verificadas. `APPROVED`
é independente de `CONTENT_READY`; Meta continua bloqueada por
`META_CONNECTIVITY_VALIDATION_REQUIRED` até o workflow somente leitura provar
a conta configurada e as permissões de publicação. Nenhuma rota do cockpit
chama a API Meta.
## Section 10.2 one-Reel pilot

The controlled pilot is documented in [SECTION_10_2_ONE_REEL_PILOT.md](./SECTION_10_2_ONE_REEL_PILOT.md). It is the only path allowed to exercise the official write API, and it requires one explicit Reel ID, `CONTENT_READY`, a protected approval environment, and the exact confirmation `I_CONFIRM_ONE_REEL_PUBLICATION`. Dry-run and automated tests cannot create a Meta container or call `media_publish`.
