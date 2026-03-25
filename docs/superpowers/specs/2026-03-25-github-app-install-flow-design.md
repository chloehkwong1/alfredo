# GitHub App Installation Flow

Replace the OAuth device flow with a GitHub App installation flow using Tauri deep links. Users install the app on their org in one browser trip — no device codes, no manual org approval.

## Current State

- `github_auth.rs`: OAuth device flow with client ID `Iv23liW7PqCMQFlyKwXR` (GitHub App)
- `GithubSettings.tsx`: Shows device code, opens GitHub, polls for token
- Token stored per-repo in `.alfredo.json` as `githubToken`
- Problem: device flow tokens don't get org access without manual approval in GitHub org settings

## User Flow

1. User clicks "Connect to GitHub" in settings
2. Alfredo opens `https://github.com/apps/alfredo-desktop/installations/new` in the browser
3. User installs the app on their account/org (selects which repos to grant)
4. GitHub redirects to `alfredo://github/callback?code=CODE&installation_id=ID` (the app has "Request user authorization during installation" enabled)
5. Tauri intercepts the deep link
6. Backend exchanges `code` for a user access token
7. Token + installation ID saved to `.alfredo.json`
8. UI shows connected state with username

For users who have already installed the app but need to re-authenticate (e.g., token expired), the same URL works — GitHub skips the installation step and just does the OAuth flow.

## Architecture

### Deep Link Plugin (new)

- Add `tauri-plugin-deep-link` to `Cargo.toml`
- Register `alfredo` scheme in `tauri.conf.json` under `plugins.deep-link.desktop.schemes`
- Add `deep-link:default` to `capabilities/default.json`
- In `lib.rs` setup, register the deep link handler:
  - Parse the URL for `code` and `installation_id` query params
  - Emit a `github-auth-callback` event to the frontend with `{ code, installationId }`

### Backend: `github_auth.rs`

**Remove:**
- `github_auth_start` (device code request)
- `github_auth_poll` (device code polling)
- `DeviceCodeResponse`, `TokenResponse`, `PollResponse` structs
- `DEVICE_CODE_URL` constant

**Add:**
- `CLIENT_SECRET` constant (GitHub App client secret)
- `github_auth_exchange` command: takes `code: String`, POSTs to `https://github.com/login/oauth/access_token` with `client_id`, `client_secret`, and `code`, returns the access token

**Keep:**
- `github_auth_user` (validate token, get username)
- `github_auth_disconnect` (clear token from config)
- `CLIENT_ID` constant
- `ACCESS_TOKEN_URL` constant

### Frontend: `GithubSettings.tsx`

**AuthState** simplifies to:
```typescript
type AuthState =
  | { step: "idle" }
  | { step: "waiting" }  // browser open, waiting for deep link callback
  | { step: "connected"; username: string };
```

**Connect flow:**
1. Click "Connect to GitHub" sets state to `waiting`
2. Opens `https://github.com/apps/alfredo-desktop/installations/new` via `openUrl`
3. Listens for `github-auth-callback` Tauri event
4. On callback: calls `githubAuthExchange(code)` to get token
5. Calls `githubAuthUser(token)` to get username
6. Persists token + installationId to config
7. Sets state to `connected`

**UI changes:**
- Remove the device code display (the `waiting` state with `userCode` and "Open GitHub" button)
- `waiting` state shows a simple "Waiting for GitHub..." spinner with a cancel button
- `idle` and `connected` states stay the same

### Frontend: `api.ts`

**Remove:**
- `githubAuthStart`
- `githubAuthPoll`

**Add:**
- `githubAuthExchange(code: string): Promise<string>` — calls new `github_auth_exchange` command

### Config: `config_manager.rs` / `types.rs`

Add `installation_id: Option<u64>` to both `ConfigFile` and `AppConfig`. This tracks which GitHub App installation is associated with the repo — useful for detecting if re-installation is needed.

### `lib.rs`

- Register `tauri-plugin-deep-link`
- Add deep link event handler in `setup` that parses `alfredo://github/callback?code=X&installation_id=Y` and emits `github-auth-callback` to frontend
- Register `github_auth_exchange` command (replaces `github_auth_start` and `github_auth_poll`)

### `tauri.conf.json`

Add deep-link plugin configuration:
```json
"plugins": {
  "deep-link": {
    "desktop": {
      "schemes": ["alfredo"]
    }
  }
}
```

### `capabilities/default.json`

Add `"deep-link:default"` to permissions array.

## GitHub App Configuration

Needs to be set in GitHub App settings (`github.com/settings/apps/alfredo-desktop`):
- **Callback URL**: `alfredo://github/callback`
- **Request user authorization (OAuth) during installation**: enabled (already done)
- **Client secret**: note it for `CLIENT_SECRET` constant

## Error Handling

- Deep link parsing fails (missing code/installationId): emit error event, frontend shows "Authorization failed — please try again"
- Code exchange fails (expired, invalid): surface error in UI, reset to idle
- Timeout: if no callback received within 5 minutes, reset `waiting` state to `idle` with a "Timed out" message
- User cancels in browser: cancel button in the `waiting` UI resets to `idle`

## Migration

- Users with existing `ghu_` tokens: these continue to work until they expire. No forced re-auth needed.
- The `githubToken` field stays the same — old tokens are still valid user access tokens.
- `installation_id` will be `null` for existing configs — the app works without it, it's just metadata.

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Add `tauri-plugin-deep-link` |
| `src-tauri/tauri.conf.json` | Add deep-link plugin config |
| `src-tauri/capabilities/default.json` | Add deep-link permission |
| `src-tauri/src/lib.rs` | Register plugin, deep link handler, update command registration |
| `src-tauri/src/commands/github_auth.rs` | Replace device flow with code exchange |
| `src-tauri/src/config_manager.rs` | Add `installation_id` field |
| `src-tauri/src/types.rs` | Add `installation_id` to `AppConfig` |
| `src/api.ts` | Replace `githubAuthStart`/`githubAuthPoll` with `githubAuthExchange` |
| `src/components/settings/GithubSettings.tsx` | New connect flow, simplified waiting UI |
| `src/components/onboarding/RepoSetupDialog.tsx` | Same deep-link auth flow for onboarding |
