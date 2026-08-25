# Official Instagram API Connectivity

Section 10.1 validates the owned Instagram account through official Meta
Graph API reads. It does not publish, create a media container, schedule a
job, or change rights, Bible, editorial, or `CONTENT_READY` state.

## Architecture

The connectivity adapter is
`tools/instagram-reels/src/publishing/connectivity.ts`. It sends the access
token only in an `Authorization: Bearer` header and accepts only official
HTTPS Graph hosts. The probe reads:

1. configured account metadata (`id`, `username`, `name`, `account_type`);
2. the configured account identity match;
3. read-only permission evidence from the configured permissions endpoint.

The required permission aliases include the current owned-account testing
permissions:

```text
instagram_business_basic
instagram_business_content_publish
```

Legacy aliases are accepted when returned by the official API. A successful
probe means capability is ready for a future controlled test; it does not
authorize publication.

## Readiness states

```text
UNCONFIGURED
CREDENTIALS_PRESENT
AUTHENTICATED
ACCOUNT_VERIFIED
PUBLISH_PERMISSION_VERIFIED
READY_FOR_CONTROLLED_TEST
LIMITED
BLOCKED
ERROR
```

Credentials are never treated as readiness. Missing account type, partial
permissions, ambiguous API responses, and transport failures remain
fail-closed.

## GitHub Environment

The manual workflow uses the `instagram-production` environment:

- secrets: `INSTAGRAM_ACCESS_TOKEN`, `META_APP_SECRET`;
- variables: `INSTAGRAM_ACCOUNT_ID`, `META_APP_ID`, publishing mode, approval,
  timezone and frequency controls.

The app secret is injected for environment completeness but is not sent by
the read-only probe. Neither secret is printed, persisted, placed in a URL,
stored in SQLite, or uploaded as an artifact.

## Local command

```text
npm run instagram:connectivity
```

Do not run this command locally with production credentials unless the owner
explicitly intends to make a real read-only API request. The preferred path
is the manually triggered GitHub Actions workflow `Instagram API
Connectivity`.

## Manual workflow

1. Open the repository’s GitHub Actions tab.
2. Select `Instagram API Connectivity`.
3. Select `feature/instagram-reels-growth-engine`.
4. Select **Run workflow**.
5. Review the safe summary in the job log.

The workflow has `workflow_dispatch` only. It has no cron trigger and no
artifact upload.

## Safe errors

| Error | Meaning | Action |
| --- | --- | --- |
| `CONFIGURATION_ERROR` | Required non-secret configuration or credential is absent/invalid | Correct GitHub Environment variables/secrets |
| `AUTHENTICATION_ERROR` | Token authentication failed | Check token validity and account access |
| `TOKEN_EXPIRED` | Meta explicitly reported an expired token/session | Issue a new official token and replace the secret |
| `ACCOUNT_MISMATCH` | API identity differs from `INSTAGRAM_ACCOUNT_ID` | Correct the account ID or token/account pairing |
| `ACCOUNT_NOT_COMPATIBLE` | Account type is non-professional or unavailable for compatibility proof | Verify the account type and current API login mode |
| `PERMISSION_ERROR` | Required permission evidence is missing or denied | Review app mode, account connection and permissions |
| `RATE_LIMITED` | Meta rate limit was returned | Wait and retry manually; do not automate retries here |
| `NETWORK_ERROR` | The request could not reach Meta or timed out | Check runner/network and retry manually |
| `META_API_ERROR` | Meta returned another API failure | Review only the sanitized detail and official documentation |

`META_BUSINESS_VERIFICATION_REQUIRED` is not used as a universal local
decision. Business verification remains relevant only if Meta explicitly
returns evidence that it is required for the particular account, app mode or
operation.

## Token renewal and rotation

Do not store historical tokens. Renew through the official Meta flow, replace
`INSTAGRAM_ACCESS_TOKEN` in the `instagram-production` environment, and rerun
the connectivity workflow. Never paste a token into Git, `.env.local`, an
issue, a report, a test snapshot, or a command argument.

## Publication boundary

Connectivity validation cannot call `media_publish`, create a production
container, execute the scheduler, mutate publication state, or publish. A
future publication test additionally requires the existing human rights,
Bible, editorial, technical, source-integrity and media-provider gates.
