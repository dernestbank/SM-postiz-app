# QuantGist Postiz — human setup checklist

Git repo (source of truth): `/Volumes/ExtHDD/github/QG-ecosystem/SM-postiz-app`

OpenClaw runtime path (symlink): `~/.openclaw/infra/postiz-quantgist` → this directory. See `OPENCLAW.md`.

## URLs

| Surface | URL |
|---------|-----|
| Production UI (signup) | https://smm.quantgist.com/auth |
| Production API (CLI / agents) | `POSTIZ_API_URL=https://smm.quantgist.com` |
| Local dev (same Mac as Docker) | http://localhost:4007 |

Registration is at **`/auth`**, not `/auth/register` (that path 404s by design).

## Environment (`postiz.env`)

Generate from credentials (do not commit):

```bash
bash /Volumes/ExtHDD/github/QG-ecosystem/SM-postiz-app/scripts/render-postiz-env.sh
```

Production values (also in `postiz.env.example`):

```env
MAIN_URL=https://smm.quantgist.com
FRONTEND_URL=https://smm.quantgist.com
NEXT_PUBLIC_BACKEND_URL=https://smm.quantgist.com/api
BACKEND_INTERNAL_URL=http://localhost:3000
DISABLE_REGISTRATION=false
```

Restart after any env change:

```bash
cd ~/.openclaw/infra/postiz-quantgist
docker compose down && docker compose up -d
```

## Cloudflare (`smm.quantgist.com`)

Point the subdomain at the Mac (or tunnel) where Postiz listens on **port 4007**.

| Setting | Value |
|---------|--------|
| DNS | `smm` → origin IP or Cloudflare Tunnel; **Proxied** (orange cloud) |
| SSL/TLS | **Full** (or Full strict if origin has a cert) |
| Origin | `http://<host>:4007` (Tunnel or reverse proxy if not using 80/443) |
| WebSockets | **On** (copilot / realtime) |
| Cache | Bypass cache for HTML/API or use default dynamic |

## Credential mapping (`postiz.env` ← `sm_credential.md`)

| Postiz env var | Source in `sm_credential.md` | Notes |
|----------------|-------------------------------|--------|
| `X_API_KEY` | `X_Consumer_key` | **OAuth 1.0a Consumer Key** — not `X_Client_ID` |
| `X_API_SECRET` | `X_Secret_key` | **OAuth 1.0a Consumer Secret** — not `X_Client_Secret` |
| `LINKEDIN_CLIENT_ID` | `Linkedin_Client_ID` | OAuth 2.0 |
| `LINKEDIN_CLIENT_SECRET` | `Client_secret` | OAuth 2.0 |
| `FACEBOOK_APP_ID` | Meta Developer Console | Not the page access token |
| `FACEBOOK_APP_SECRET` | Meta Developer Console | Not in `sm_credential.md` yet |

Regenerate after credential changes:

```bash
bash /Volumes/ExtHDD/github/QG-ecosystem/SM-postiz-app/scripts/render-postiz-env.sh
cd ~/.openclaw/infra/postiz-quantgist && docker compose down && docker compose up -d
```

## OAuth callback URLs — copy-paste into developer portals

Postiz builds callbacks as `{FRONTEND_URL}/integrations/social/{provider}`.
**No trailing slash.** Register the **full path** — not `https://smm.quantgist.com` alone.

Verified from live API (`GET /api/public/v1/social/{platform}`) on 2026-06-05.

### LinkedIn Page (use this for QuantGist company)

LinkedIn Developer Portal → your app (`86zedd6om41kzy`) → **Auth** → **OAuth 2.0 settings** → **Authorized redirect URLs for your app**:

```
https://smm.quantgist.com/integrations/social/linkedin-page
http://localhost:4007/integrations/social/linkedin-page
```

Postiz sends `redirect_uri=https://smm.quantgist.com/integrations/social/linkedin-page` (decoded). If LinkedIn shows *"The redirect_uri does not match the registered value"*, the portal entry is missing or differs (typo, trailing `/`, or `linkedin` vs `linkedin-page`).

Connect **LinkedIn Page** in Postiz — not personal LinkedIn (`/linkedin`).

### X / Twitter (OAuth 1.0a — SM.QUANTGIST)

X Developer Portal → **SM.QUANTGIST** → **User authentication settings** → **Callback URI / Redirect URL**:

```
https://smm.quantgist.com/integrations/social/x
http://localhost:4007/integrations/social/x
```

### Facebook Page (Meta app required)

Meta Developer Portal → your app → **Facebook Login** → **Settings** → **Valid OAuth Redirect URIs**:

```
https://smm.quantgist.com/integrations/social/facebook
http://localhost:4007/integrations/social/facebook
```

### Reference table

| Platform | Production callback | Local callback |
|----------|--------------------|----------------|
| X / Twitter | `https://smm.quantgist.com/integrations/social/x` | `http://localhost:4007/integrations/social/x` |
| LinkedIn (personal) | `https://smm.quantgist.com/integrations/social/linkedin` | `http://localhost:4007/integrations/social/linkedin` |
| LinkedIn Page (company) | `https://smm.quantgist.com/integrations/social/linkedin-page` | `http://localhost:4007/integrations/social/linkedin-page` |
| Facebook Page | `https://smm.quantgist.com/integrations/social/facebook` | `http://localhost:4007/integrations/social/facebook` |

## X Developer Portal (required before connect)

Postiz uses **OAuth 1.0a** (`twitter-api-v2` `generateAuthLink`), not OAuth 2.0 Client ID.

**QuantGist app:** `SM.QUANTGIST` on [developer.x.com](https://developer.x.com). After any portal change, update `X_Consumer_key` / `X_Secret_key` in `sm_credential.md` and rerun `render-postiz-env.sh`.

1. Open [developer.x.com](https://developer.x.com) → **SM.QUANTGIST** → **Settings**.
2. **App permissions:** Read and write (needed for `authAccessType: 'write'`).
3. **Type of App:** **Web App, Automated App or Bot** — **not** Desktop App.
   - Desktop type always fails Postiz connect with error **417**: `Desktop applications only support the oauth_callback value 'oob'`.
   - Re-check this after creating a new X app (e.g. when rotating to **SM.QUANTGIST**).
4. **User authentication settings** → enable **OAuth 1.0a** (required; OAuth 2.0 Client ID alone is not used by Postiz).
5. **Callback URI / Redirect URL:** must include exactly:
   - `https://smm.quantgist.com/integrations/social/x` (production)
   - `http://localhost:4007/integrations/social/x` (local)
6. Copy **API Key** (Consumer Key) and **API Key Secret** (Consumer Secret) into
   `sm_credential.md` as `X_Consumer_key` / `X_Secret_key`, then rerun `render-postiz-env.sh`.
7. Do **not** put `X_Client_ID` / `X_Client_Secret` into `X_API_KEY` / `X_API_SECRET`.

Verify from the running container (should print `OK` + a Twitter authorize URL):

```bash
docker exec postiz node -e "
const { TwitterApi } = require('twitter-api-v2');
new TwitterApi({ appKey: process.env.X_API_KEY, appSecret: process.env.X_API_SECRET })
  .generateAuthLink('https://smm.quantgist.com/integrations/social/x', { authAccessType: 'write', linkMode: 'authenticate' })
  .then(r => console.log('OK', r.url.slice(0, 80)))
  .catch(e => console.error('ERR', e.data || e.message));
"
```

**Error 32** (`Could not authenticate you`) means Consumer Key/Secret are wrong, revoked, or from a Desktop app. Regenerate **API Key** + **API Key Secret** (OAuth 1.0a) in the X portal — do **not** use OAuth 2.0 Client ID (`X_Client_ID`). After updating `sm_credential.md`, rerun `render-postiz-env.sh` and restart the container. Postiz API returns `{"msg":"Failed to generate auth URL"}` until keys are valid.

## LinkedIn Developer Portal

1. [LinkedIn Developer Portal](https://www.linkedin.com/developers/) → your app.
2. **Auth** → add redirect URLs: `.../integrations/social/linkedin-page` (and local).
3. Products: **Share on LinkedIn**, **Sign In with LinkedIn using OpenID Connect**, and org scopes for company page posting.
4. `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` are already mapped in `postiz.env`.

## Facebook / Meta Developer Portal

Postiz needs a **Meta app** (`FACEBOOK_APP_ID` + `FACEBOOK_APP_SECRET` in `postiz.env`).
A page access token alone is not enough for the OAuth connect flow. Empty `FACEBOOK_APP_ID` produces Facebook error *"Invalid App ID — does not look like a valid app ID"* (`client_id=` in the OAuth URL).

1. [developers.facebook.com](https://developers.facebook.com/) → **Create App** → type **Business** (or use existing).
2. Add product **Facebook Login** → **Settings**.
3. **Valid OAuth Redirect URIs** — paste exactly (see copy-paste block above).
4. **Settings → Basic** → copy **App ID** and **App Secret** into `sm_credential.md`:
   ```text
   FACEBOOK_APP_ID=<numeric app id>
   FACEBOOK_APP_SECRET=<app secret>
   ```
5. Regenerate and restart:
   ```bash
   bash /Volumes/ExtHDD/github/QG-ecosystem/SM-postiz-app/scripts/render-postiz-env.sh
   cd ~/.openclaw/infra/postiz-quantgist && docker compose down && docker compose up -d
   ```
6. Verify OAuth URL contains a numeric `client_id`:
   ```bash
   curl -s -H "Authorization: $POSTIZ_API_KEY" "$POSTIZ_API_URL/public/v1/social/facebook" | jq -r .url
   ```

## Postiz UI — Add Channel (v2.21.8)

1. Open https://smm.quantgist.com/auth and sign in (`mycloudifybiz1@gmail.com`).
2. Go to **Launches** (calendar): https://smm.quantgist.com/launches
3. Left sidebar → **Add Channel** (camera icon button under the channel list).
4. Modal **Add Channel** opens with a platform grid — click the provider:
   - **X** — authorize as @quantgist (fix X portal + error 32 first; see below).
   - **LinkedIn Page** — not personal LinkedIn; pick QuantGist company page in step 2.
   - **Facebook Page** — after `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` are in `postiz.env`.
5. OAuth completes at `https://smm.quantgist.com/integrations/social/{provider}` and returns to Postiz.
6. For two-step providers (LinkedIn Page, Facebook Page), select the company/page when prompted.

Programmatic OAuth URLs (same flow as the UI; state expires in ~1 hour — regenerate if stale):

```bash
export POSTIZ_API_URL=https://smm.quantgist.com/api   # must include /api
export POSTIZ_API_KEY=$(cat ~/.openclaw/credentials/postiz-quantgist-api-key.txt)
curl -s -H "Authorization: $POSTIZ_API_KEY" "$POSTIZ_API_URL/public/v1/social/linkedin-page"
curl -s -H "Authorization: $POSTIZ_API_KEY" "$POSTIZ_API_URL/public/v1/social/x"          # fails until X keys fixed
curl -s -H "Authorization: $POSTIZ_API_KEY" "$POSTIZ_API_URL/public/v1/social/facebook"    # needs Meta app env
```

## CLI / agents

```bash
export POSTIZ_API_URL=https://smm.quantgist.com/api   # not the bare domain
export POSTIZ_API_KEY=$(cat ~/.openclaw/credentials/postiz-quantgist-api-key.txt)
postiz integrations:list
```

## After `docker compose up -d`

1. Complete **Add Channel** steps above (order: fix X keys → LinkedIn Page → Meta app → Facebook Page).
2. Confirm API key file is non-empty (`~/.openclaw/credentials/postiz-quantgist-api-key.txt`). Key may already exist in Postiz **Settings → API** / org `apiKey` in DB — copy there if the file is empty.
3. Run: `postiz integrations:list` and update integration IDs in
   `workspace_QuantGist/agents/memory/QG_SOCIAL_MEDIA_MANAGER.md` and `ops/POSTIZ.md`.
4. Run: `bash workspace_QuantGist/ops/smoke_test_postiz.sh`
5. Run: `bash workspace_QuantGist/ops/smoke_test_marketing.sh`
