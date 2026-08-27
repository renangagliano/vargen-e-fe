# Phase 5 — Scheduler

The scheduler is a local tooling/backend concern. It does not depend on a browser tab, GitHub Pages or a static Next.js runtime.

`scheduler:run-once` obtains the earliest due `SCHEDULED`/`QUEUED` job, locks it durably in SQLite with a worker identity and five-minute lease, rechecks eligibility and dispatches the configured publisher.

```text
node tools/instagram-reels/dist/src/cli/index.js scheduler:run-once
node tools/instagram-reels/dist/src/cli/index.js scheduler:run-once --now=2026-08-25T21:00:00.000Z
```

Times are stored as ISO UTC values while the job retains `America/Sao_Paulo` (or configured timezone) as metadata. A production worker still needs a persistent execution host and an operator-approved process supervisor; GitHub Pages cannot run it.

Transient and rate-limit failures use bounded retry/backoff. Validation, authentication and external eligibility failures do not retry indefinitely. The same `publication_key` is reused for retries and a successful key cannot be published again.

Conservative controls are configurable through `MAX_REELS_PER_DAY`, `MIN_HOURS_BETWEEN_REELS`, `MAX_REELS_PER_SONG_PER_30_DAYS` and `MAX_REELS_PER_COLLECTION_CONSECUTIVELY`.
