# Personal Microsoft authentication

Section 10.3.3 uses a Microsoft public client and delegated Graph access for
the operator's personal OneDrive. It does not use Azure CLI credentials,
`DefaultAzureCredential`, corporate SSO, service principals, client secrets,
certificates, ROPC or client-credentials flow.

## One-time personal app registration

1. Open the Microsoft Entra admin center while signed in to the personal
   Microsoft account that owns the personal OneDrive.
2. Open **App registrations** and choose **New registration**.
3. Use the name `VargenFe Personal OneDrive Publisher`.
4. Select **Personal Microsoft accounts** when available. If the portal only
   exposes the combined option, use **Accounts in any organizational directory
   and personal Microsoft accounts**; runtime validation still requires
   Graph `driveType=personal`.
5. Under **Authentication**, add the **Mobile and desktop applications**
   platform with the loopback redirect `http://localhost`.
6. Enable public client flows if the portal requests that setting.
7. Under **API permissions**, add only Microsoft Graph delegated
   `Files.ReadWrite`. Do not add `Files.ReadWrite.All`, Sites, Mail, Calendar,
   Contacts, Directory or enterprise permissions.
8. Do not create a client secret, certificate or application password.
9. Copy the **Application (client) ID** to the ignored local `.env.local`.

Example local configuration:

```text
MICROSOFT_PERSONAL_CLIENT_ID=<personal-app-client-id>
MICROSOFT_PERSONAL_AUTHORITY=https://login.microsoftonline.com/consumers
MICROSOFT_PERSONAL_REDIRECT_URI=http://localhost
MICROSOFT_PERSONAL_SCOPES=Files.ReadWrite
```

The client ID is configuration, not a secret, but it remains local to avoid
environment-specific values in source. Never add access tokens or MSAL cache
files to the repository.

## Login and validation

```text
npm run onedrive:login
npm run onedrive:status
```

MSAL Node's public-client interactive flow opens the system browser, creates
the PKCE challenge/verifier, validates the loopback response and closes its
localhost listener. The application then calls `/me/drive`; only a personal
drive with `driveType=personal` is accepted. A business or SharePoint drive
causes `CORPORATE_MICROSOFT_IDENTITY_REJECTED` and clears the local personal
cache.

`onedrive:status` prints only authentication state, drive type, scope
availability and provider readiness. It never prints an access token,
refresh token, owner email or full Graph response.

## Cache and logout

MSAL's serialized cache is stored at:

```text
C:\Users\erengag\AppData\Local\VargenFe\instagram-reels\auth\msal-cache.json
```

The provider applies private filesystem permissions and uses the Windows
current-user ACL on this cache. The cache is runtime state, not application
state. Logout removes only this project cache:

```text
npm run onedrive:logout
```

It does not call `az logout`, remove Windows account sessions, or alter any
corporate login.

## Pilot sequence

After status reports `Provider readiness: READY`, run the dry-run and then one
real preparation:

```text
npm run instagram:media-prepare -- --reel=reel-80bc5fa99371b5d7b91b00cf --provider=onedrive-personal --dry-run
npm run instagram:media-prepare -- --reel=reel-80bc5fa99371b5d7b91b00cf --provider=onedrive-personal
```

The real command uploads exactly one derived Reel, validates the anonymous
Microsoft download URL and stores only safe DriveItem identifiers. It does not
call Instagram.
