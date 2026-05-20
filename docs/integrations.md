# Integrations Setup

This guide explains how to configure third-party integrations for `wat2do-v2`, including how to acquire OAuth credentials and where to store them.

## Current State (Important)

Right now, integrations in the backend are scaffolded with placeholder OAuth URLs and mock selectable targets (servers/channels/pages). You can see this in `backend/services/club_service.py` under `get_integration_options(...)`.

That means:

- You **can** prepare all provider credentials now.
- You **still need** backend callback/token exchange wiring to make live OAuth work end-to-end.

This README gives you a clean secret-management setup so you are ready for that wiring.

## Supported Integration Platforms

From `backend/schemas/club.py` and the club panel UI:

- WhatsApp
- Discord
- Instagram
- Slack
- Telegram
- LinkedIn
- Facebook

## Where Secrets Should Live

Store integration secrets in backend environment variables (`backend/.env`), never in frontend `.env` and never committed to git.

`backend/.env` already includes Supabase settings. Add the integration block below.

## Recommended Env Vars (Template)

Add this block to `backend/.env`:

```env
# Base URLs
APP_BASE_URL=http://localhost:5173
API_BASE_URL=http://localhost:8000

# Optional: centralized frontend return route after OAuth
INTEGRATIONS_REDIRECT_PATH=/club-panel/integrations

# Discord
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_BOT_TOKEN=
DISCORD_SIGNING_SECRET=
DISCORD_REDIRECT_URI=http://localhost:8000/integrations/discord/callback

# Slack
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_SIGNING_SECRET=
SLACK_BOT_TOKEN=
SLACK_REDIRECT_URI=http://localhost:8000/integrations/slack/callback

# LinkedIn
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_REDIRECT_URI=http://localhost:8000/integrations/linkedin/callback

# Facebook / Meta
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_REDIRECT_URI=http://localhost:8000/integrations/facebook/callback

# Instagram (via Meta Graph)
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
INSTAGRAM_REDIRECT_URI=http://localhost:8000/integrations/instagram/callback

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET=

# WhatsApp (Meta WhatsApp Cloud API)
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=
```

## Provider Setup Checklists

## 1) Discord

1. Go to the Discord Developer Portal.
2. Create a new application.
3. Add a bot user.
4. Copy:
   - Client ID -> `DISCORD_CLIENT_ID`
   - Client Secret -> `DISCORD_CLIENT_SECRET`
   - Bot Token -> `DISCORD_BOT_TOKEN`
5. Under OAuth2, add redirect URI:
   - `http://localhost:8000/integrations/discord/callback`
6. If using interactions/webhooks, copy signing key -> `DISCORD_SIGNING_SECRET`.

## 2) Slack

1. Go to Slack API -> Your Apps -> Create App.
2. Configure OAuth scopes needed for reading channels and posting updates.
3. Copy:
   - Client ID -> `SLACK_CLIENT_ID`
   - Client Secret -> `SLACK_CLIENT_SECRET`
4. Add redirect URL:
   - `http://localhost:8000/integrations/slack/callback`
5. If using events/interactivity, copy signing secret -> `SLACK_SIGNING_SECRET`.
6. Install app to workspace and capture bot token if needed -> `SLACK_BOT_TOKEN`.

## 3) LinkedIn

1. Open LinkedIn Developer Portal and create an app.
2. Configure products/permissions required for organization posting.
3. Copy:
   - Client ID -> `LINKEDIN_CLIENT_ID`
   - Client Secret -> `LINKEDIN_CLIENT_SECRET`
4. Set redirect URI:
   - `http://localhost:8000/integrations/linkedin/callback`

## 4) Facebook + Instagram (Meta)

Meta apps generally manage both Facebook Pages and Instagram Graph access.

1. Open Meta for Developers and create an app.
2. Add Facebook Login + required Graph API products.
3. Copy:
   - App ID -> `FACEBOOK_APP_ID` and `INSTAGRAM_APP_ID`
   - App Secret -> `FACEBOOK_APP_SECRET` and `INSTAGRAM_APP_SECRET`
4. Configure redirect URIs:
   - `http://localhost:8000/integrations/facebook/callback`
   - `http://localhost:8000/integrations/instagram/callback`
5. For Instagram business account flows, ensure your IG account is linked to a Facebook Page.

## 5) Telegram

1. Use BotFather to create a bot.
2. Copy bot token -> `TELEGRAM_BOT_TOKEN`.
3. Store bot username -> `TELEGRAM_BOT_USERNAME`.
4. Choose a random verification string -> `TELEGRAM_WEBHOOK_SECRET`.

## 6) WhatsApp (Cloud API)

1. In Meta developer console, enable WhatsApp Cloud API.
2. Copy:
   - Phone Number ID -> `WHATSAPP_PHONE_NUMBER_ID`
   - Business Account ID -> `WHATSAPP_BUSINESS_ACCOUNT_ID`
   - Temporary/permanent access token -> `WHATSAPP_ACCESS_TOKEN`
3. Set webhook verify token (custom string) -> `WHATSAPP_VERIFY_TOKEN`.

## Redirect URI Strategy (Dev vs Prod)

Use separate app credentials for local/dev and production.

- Dev frontend: `http://localhost:5173`
- Dev backend: `http://localhost:8000`
- Example prod frontend: `https://app.yourdomain.com`
- Example prod backend: `https://api.yourdomain.com`

For each provider, register both dev + prod redirect URIs if allowed.

## Security Notes

- Never commit `.env` with real secrets.
- Rotate secrets immediately if leaked.
- Use different credentials per environment.
- Prefer secret managers in production (cloud secret manager, Vault, etc.).
- Log minimally around OAuth/token exchange; never log raw tokens.

## Backend Wiring TODO (After Secrets)

Once secrets are in place, next implementation steps are:

1. Add settings fields for these env vars in `backend/core/config.py`.
2. Replace placeholder `oauth_url` values in `backend/services/club_service.py`.
3. Add OAuth start/callback routes under `backend/routers/clubs.py` (or a dedicated integrations router).
4. Exchange authorization code for provider access token.
5. Persist provider account/workspace/page/channel metadata.
6. Use provider APIs to sync events/messages.

## Quick Sanity Check

Before coding OAuth:

1. Confirm `backend/.env` has non-empty values for at least one platform.
2. Restart backend server after env edits.
3. Verify your provider dashboard has the exact callback URL (character-for-character).
4. Verify frontend points to backend via `VITE_API_URL`.
