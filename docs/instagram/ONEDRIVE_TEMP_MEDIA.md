# Personal OneDrive temporary media

The `onedrive-personal` provider is a local-first, one-Reel temporary-media
adapter. It uses Microsoft Graph v1.0 against the operator's personal
OneDrive only. It never uses a work tenant, Azure, or Meta publishing APIs.

## Authentication and permissions

Authentication is delegated Microsoft identity authentication. The provider
accepts an injected access-token provider; it does not read or persist a token
from project files, and it does not reuse Azure CLI credentials. The minimum
Graph delegated permission for upload, metadata, anonymous-link fallback and
cleanup is `Files.ReadWrite`. No mailbox, calendar, contacts, Teams or
SharePoint permissions are requested.

The operator must create or approve a personal-account public client/device
code authentication flow, grant only `Files.ReadWrite`, and supply a short-
lived token through the approved local credential adapter. The provider calls
`/me/drive` and requires `driveType=personal` before any OneDrive mutation.
A business/document-library drive fails closed with
`PERSONAL_ONEDRIVE_IDENTITY_NOT_CONFIRMED`.

## Storage boundary and lifecycle

Only one explicit `CONTENT_READY` derived Reel is placed in:

```text
VargenFe/InstagramTemp/<reel-id>/<checksum-prefix>.mp4
```

Source masters, the complete Reels tree and the Knowledge Base are never
uploaded. The deterministic path and checksum are the idempotency key. An
existing item with a different size, type or known hash is rejected.

The preferred URL is the documented `@microsoft.graph.downloadUrl` property.
It is short-lived and held only in memory. Safe state stores provider, drive
ID, item path, size, checksum, status and estimated expiry; it never stores a
Graph token, download URL query string or sharing token.

## Validation

The URL is fetched anonymously, without an Authorization header. Validation
requires HTTPS, a trusted Microsoft/OneDrive delivery host, a final 200/206
response, video MIME type, non-zero matching size, MP4 `ftyp` content and the
expected SHA-256. Redirects are traced up to five hops and arbitrary hosts are
rejected. A range probe is reported as `SUPPORTED`, `NOT_SUPPORTED` or
`UNKNOWN`.

`createLink` with `scope=anonymous` is only a fallback. Its `webUrl` is never
accepted as a media URL unless the resulting anonymous response is the actual
MP4. Undocumented `download=1` URL rewriting is not used.

## Commands

```text
npm run instagram:media-prepare -- --reel=<reel-id> --provider=onedrive-personal --dry-run
npm run instagram:media-prepare -- --reel=<reel-id> --provider=onedrive-personal
npm run instagram:media-status -- --reel=<reel-id>
npm run instagram:media-cleanup -- --reel=<reel-id> --provider=onedrive-personal
npm run instagram:media-cleanup -- --provider=onedrive-personal --expired
```

Dry-run performs CONTENT_READY, snapshot, local-file and checksum checks only.
The real command requires the personal Graph adapter and performs exactly one
temporary upload. It does not create an Instagram media container, call
`/media`, call `media_publish` or publish content.

## Cleanup and limitations

Cleanup deletes the tracked temporary DriveItem and revokes a fallback
permission when its permission ID is available. It never deletes the local
Reel. Direct download URLs have an estimated 60-minute operational lifetime;
Graph controls the actual lifetime, so a fresh URL must be obtained when
needed. Deleting the temporary item is the definitive revocation boundary.

The implementation is intentionally authentication-gated until a personal
Microsoft account adapter is configured. No work identity is an acceptable
substitute.
