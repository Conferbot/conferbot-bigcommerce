# Conferbot BigCommerce App

Installs the [Conferbot](https://conferbot.com) AI chat widget on a BigCommerce storefront. Same product as the [Shopify app](https://github.com/Conferbot/conferbot-shopify), BigCommerce-shaped: OAuth install callback, signed-payload load/uninstall callbacks, and a storefront Script (Scripts API v3) that serves a per-store widget loader.

## See it in action

Paste the Chatbot ID in the app settings, save, and the chat is live (recorded against the mock storefront from the e2e suite):

![Conferbot BigCommerce demo](docs/demo.gif)

[HD video (MP4)](docs/demo.mp4)

## How it works

```
merchant installs the app
  -> BigCommerce calls GET /auth?code&scope&context
  -> code exchanged at login.bigcommerce.com/oauth2/token
  -> Script registered: src = {APP_URL}/script.js?store={hash}
     (auto_uninstall: true, async, footer, all_pages, consent_category: functional)
  -> merchant lands on /app (settings: paste bot ID, flip switch)

merchant opens the app later     -> GET /load?signed_payload_jwt      (HS256; aud = client ID, iss = bc, exp checked)
merchant uninstalls              -> GET /uninstall?signed_payload_jwt (same checks; record removed,
                                                                       BigCommerce deletes the Script)

every storefront page load
  -> BigCommerce injects the Script
  -> loader adds https://cdn.conferbot.com/dist/v1/widget.min.js (id "conferbot-js")
  -> signed-in shopper? the loader asks the storefront for a Current Customer
     token (/customer/current.jwt?app_client_id=...), POST /customer verifies it
     with the client secret, and only the shopper's id and email come back
  -> window.ConferbotWidget(botId, embedType,
       { customData: { platform: "bigcommerce", storeHash }, user?: { id: "bc-<id>", email } })
```

The only merchant-facing setting is the **Chatbot ID** (bare ID, full snippet, or URL - auto-extracted), with a one-click **demo bot** (`691c970890527a0468f9b2c9`) that works without a Conferbot account.

The settings page opens only from BigCommerce's signed install and load callbacks, which hand over a short-lived token signed with the client secret; every save carries one too. A bare `?store=` is refused.

Everything visitors see is set per bot in the Conferbot dashboard and delivered at runtime, with nothing to configure in the store: flows and AI agents, live chat with handover to your team (queue position, leave a message when nobody is free, read receipts, file sharing, post-chat rating), the home screen, themes and dark mode, colours, launcher and mascot, greetings, languages and disabled URLs.

## Install guide (merchants)

### Requirements

- A BigCommerce store on a Stencil theme (any plan). Headless storefronts do not run Scripts API scripts; paste the embed snippet from the Conferbot dashboard into the headless front end instead.
- A Conferbot account and a bot ([app.conferbot.com](https://app.conferbot.com)), or the built-in demo bot to try it first.
- Store owner, or a user with permission to install apps.

### 1. Install the app

- **From the BigCommerce App Marketplace:** the listing is not live yet. Until it is, Conferbot support sends an install link for the app.
- **From an install link (draft app):** open the link while signed in to your store's control panel and click **Install**. BigCommerce asks you to confirm the permission the app needs (**Content: modify**, so it can add the chat script to your storefront), then opens the Conferbot settings page.

There is no zip or theme file to upload: the chat is added by BigCommerce's Scripts API and removed again on uninstall.

### 2. Find your Chatbot ID

1. Sign in at [app.conferbot.com](https://app.conferbot.com) and open the bot you want on your store.
2. Click **Share**, then **Embed into your website**.
3. The ID is the 24-character code inside `ConferbotWidget("...")` in the snippet, for example `64a1b2c3d4e5f6a7b8c9d0e1`. It is also in the address bar: `.../chatbot/<ID>/embed`.

You can paste the ID, the whole snippet or that URL; the app keeps only the ID.

### 3. Settings

Open **Apps > My Apps > Conferbot** in the control panel.

| Setting | What it does |
| --- | --- |
| **1. Paste your Chatbot ID** | The bot that answers on your store. "Try our demo bot" fills in the public demo bot. |
| **2. Turn the chat on** | Shows or hides the chat on the storefront. The app stays installed either way. |
| **How the chat appears** (Advanced) | **Floating chat bubble** (`live_chat`, recommended) or **Popup window** (`popup_chat`). |

Press **Save**. Greetings, colours, languages, where the bubble sits and which URLs it hides on are all set on the bot in the Conferbot dashboard, not here.

### 4. Check it works

1. Open your storefront in a private window and wait a few seconds: the chat bubble appears in the corner.
2. Click it: the bot greets you. Send a message and the conversation shows up in the Conferbot dashboard under **Live Chat**.
3. Sign in as a customer and open the chat again: the team sees that customer's email beside the conversation.

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| No bubble after saving | The storefront caches the loader for up to 5 minutes; wait, then reload. Check the switch is on and the ID is 24 characters. |
| No bubble, and the store shows a cookie banner | The script is in the **Functional** consent category. Shoppers who decline functional cookies do not get the chat; accept them to test. |
| Bubble missing on some pages | Check **Disabled URLs** and **Show on** (desktop / mobile) on the bot in the Conferbot dashboard. |
| "Open Conferbot from your BigCommerce control panel" | The settings link expired (10 minutes). Open the app again from **Apps > My Apps**. |
| Signed-in shopper not recognised | Only works on the Stencil storefront domain (the Current Customer API is same-origin) and needs the app to still be installed. |
| Two chat bubbles | The Conferbot snippet is also pasted into the theme or Script Manager. Remove one; the widget mounts once either way. |

### Uninstall

**Apps > My Apps > Conferbot > Uninstall.** BigCommerce removes the storefront script (it was registered with `auto_uninstall`), and the app deletes the store's token and settings when it receives the uninstall callback. Your bot and its conversations stay in your Conferbot account.

## Project layout

```
src/
├── index.js         # entrypoint
├── server.js        # /auth, /load, /uninstall, /app, /app/save, /customer, /script.js
├── config.js        # env-driven config (BC_AUTH_BASE/BC_API_BASE overridable for tests)
├── bigcommerce.js   # token exchange, signed_payload_jwt + Current Customer JWT verify, Scripts API
├── widgetScript.js  # per-store loader generation (script-context-safe JSON)
├── adminPage.js     # two-step settings page
└── store.js         # JSON-file store (swap for a real DB behind the same interface)
test/e2e.test.js     # helpers + full journey against a mock BigCommerce + browser mount
```

## Self-hosting the app (developers)

1. Create an app in the [BigCommerce Developer Portal](https://devtools.bigcommerce.com):
   - Auth callback: `{APP_URL}/auth`
   - Load callback: `{APP_URL}/load`
   - Uninstall callback: `{APP_URL}/uninstall`
   - Remove user callback: leave empty (the app is single-user; BigCommerce makes it optional)
   - OAuth scope: **Content: modify** (Scripts API). The Current Customer API needs no scope.
2. Copy `.env.example` to `.env` with the client ID and secret. `APP_URL` must be public HTTPS, and the server must keep `data/stores.json` (or your database) between restarts.
3. `npm install && npm start` (Node 18+), then install the draft app on a sandbox store from the Developer Portal.

## Tests

```bash
npm test                    # helpers + full install/load/save/uninstall journey (mock BigCommerce)
RUN_BROWSER_E2E=1 npm test  # + headless Chrome: the real CDN widget mounts on a fake storefront
```

The tests cover: store-hash extraction/validation, signed-payload JWT verification (valid, wrong secret, expired, malformed, another app's `aud`, wrong `iss`, no `exp`, future `nbf`, `alg: none`, no secret configured), install token exchange, Script registration idempotency on reinstall, settings save with full-snippet paste, the signed-in shopper lookup (only tokens BigCommerce signed for this store), loader no-op before configuration, uninstall cleanup, and the browser mount.

## Production checklist (before marketplace submission)

- [ ] Real database behind the store record interface
- [x] Settings tied to the store's admin (signed tokens from the install and load callbacks)
- [x] Callback JWTs checked for `aud`, `iss`, `exp` and `nbf`
- [ ] Marketplace listing assets (see the submission guide)

## License

MIT.
