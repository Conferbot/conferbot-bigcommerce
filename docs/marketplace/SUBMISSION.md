# BigCommerce App Marketplace: submission kit

Everything needed to list the Conferbot BigCommerce app (0.1.0) on the BigCommerce App Marketplace. Checked against docs.bigcommerce.com on 2026-10-17. The code is ready for review. What remains is hosting and the partner steps.

## 1. Where to submit

| What | Where |
| --- | --- |
| Partner status | **A Partner ID is required to submit.** Apply to the Technology Partner programme at https://www.bigcommerce.com/partners/ and wait for approval. |
| Account | A **Developer Portal** account: https://devtools.bigcommerce.com (create the app, set the callbacks, scopes and listing). |
| Submission | Developer Portal > your app > **Edit app > fill in every step > Submit** (the review and listing fee is paid here). https://docs.bigcommerce.com/developer/docs/integrations/apps/guide/publishing-apps |
| Requirements | https://docs.bigcommerce.com/developer/docs/integrations/apps/guide/approval-requirements |
| Fees | A **review and listing fee at submission**. BigCommerce does not publish the amount; it shows at checkout in the portal. A resubmission within 30 days is free, and after that it is charged again. |

## 2. Current requirements and where we stand

| Requirement | Status |
| --- | --- |
| Single-click install with OAuth; `/auth` and `/load` required, `/uninstall` recommended; `signed_payload_jwt` verified, with `aud` = client ID | OK. All three callbacks exist; the JWT is checked for `aud`, `iss`, `exp`, `nbf` and rejects `alg: none` (tests). |
| Tokens stored per **store hash**, not per user email | OK (`store.js` is keyed by store hash). |
| Styled, branded HTML after install (no raw JSON) | OK. Install lands on the branded settings page. |
| Multiple users per store | OK. Settings are per store; any user who loads the app gets the store's settings. `/remove_user` is not implemented; it is optional. |
| Storefront script through the **Scripts API** into Script Manager, with the right `consent_category`; `auto_uninstall: true` recommended; at most 10 scripts per app | OK. One script, `auto_uninstall: true`, `consent_category: functional`, footer, all pages. |
| HTTPS callbacks, V3 APIs where they exist | OK in code (Scripts V3). HTTPS depends on hosting. |
| Support reachable from inside the app | OK. The settings page footer shows `support@conferbot.com`. |
| BigDesign UI preferred | **Note.** The settings page uses Conferbot's own two-step layout, not BigDesign. This is preferred, not required. |
| Real persistence | **To do.** `src/store.js` is a JSON file, and the README checklist lists "Real database". |
| Screenshots of the app UI **inside the BigCommerce control panel** | To capture after hosting. |

Review: no official timeframe; secondary sources say 2–4 weeks. You have 30 days to answer review feedback. Approved listing changes show within 24 hours.

## 3. Blockers

1. **Tech Partner approval** (Partner ID). This comes before anything else.
2. **Hosting**: a public HTTPS `APP_URL`, a database behind `store.js`, and the client ID and secret.
3. **The review and listing fee** (amount shown in the portal), plus partner legal and contact details.
4. In-control-panel screenshots from a sandbox store.

## 4. Listing copy (ready to paste)

BigCommerce publishes no character limits. The name should be the brand only, with no tagline.

- **App name:** `Conferbot`
- **Partner name:** `Conferbot`
- **Short app summary** (shown in search): `AI chatbot and live chat for your store: answer shoppers 24/7, capture leads and hand over to your team.`
- **Full description:**

  > Conferbot adds an AI-powered chat assistant to your BigCommerce storefront. It answers product, shipping and order questions instantly, day and night, collects leads, and hands the conversation to a person on your team whenever a shopper needs one. Handover comes with queue position, file sharing, read receipts and a post-chat rating, and shoppers can leave a message when nobody is online.
  >
  > Install in one click, paste your Chatbot ID and switch the chat on. The widget is added through Script Manager in the "functional" consent category and is removed automatically when you uninstall. The widget's look and behaviour (guided flows or an AI agent trained on your content, colours, launcher, greetings and languages) are managed in your Conferbot dashboard and apply straight away.
  >
  > Signed-in shoppers are recognised securely. The storefront asks BigCommerce for a signed customer token, and the app verifies it before the shopper's ID and email reach the conversation. Shoppers cannot impersonate each other.
  >
  > The app is free. A Conferbot account is needed to run your own bot, and the free plan is enough to start. A demo bot lets you see the widget before signing up.

- **Features** (up to 5):
  1. AI agent trained on your content answers shoppers 24/7
  2. Live chat handover to your team, with an offline message form
  3. Verified signed-in shopper identity (Current Customer API)
  4. One-click install, one ID, script managed in Script Manager
  5. Fully brandable widget: colours, logo, launcher, greetings, languages
- **Category:** *Customer Service* > Live Chat (primary); *Marketing* if a second is allowed
- **Pricing:** Free. Text: "Free app. Requires a Conferbot account; a free plan is available (no card). Paid Conferbot plans are billed by Conferbot."
- **Support email:** `support@conferbot.com` (the address on the app's settings page). **Contact:** owner's name and email.
- **Privacy policy:** https://www.conferbot.com/privacy-policy (HTTP 200). **Terms:** https://www.conferbot.com/terms-of-service (HTTP 200). **Docs:** https://docs.conferbot.com
- **OAuth scopes:** Content: *modify* (Scripts API). The Current Customer API needs no scope.

### Data and GDPR statement

This statement matches `src/server.js`, `src/bigcommerce.js` and `src/widgetScript.js`.

- **The app server stores** only, per store hash: the access token and the settings (bot ID, switch, embed type). `/uninstall` deletes the record, and BigCommerce deletes the script (`auto_uninstall`).
- **Signed-in shoppers:** the storefront fetches BigCommerce's `/customer/current.jwt` for this app, and the app's `/customer` endpoint verifies it (signed with the app secret, matching store hash). It returns only `{ id: "bc-<id>", email }`. **Nothing is stored.**
- **What the storefront widget sends:** the shopper's browser loads `https://cdn.conferbot.com/dist/v1/widget.min.js`. The page passes the widget:
  - the Chatbot ID
  - `platform: "bigcommerce"` and the store hash
  - for a verified signed-in shopper only: the ID and email
- Whatever the shopper types or uploads in the chat goes to Conferbot as the conversation.
- The script is in the **functional** consent category, so stores using BigCommerce's cookie consent banner control it.

## 5. Reviewer test instructions (once hosted)

> 1. Install the app on the review sandbox store from the Developer Portal draft (single-click). You land on the Conferbot settings page inside the control panel.
> 2. Click "Try our demo bot", or paste the public demo Chatbot ID `691c970890527a0468f9b2c9` (a live "Startup Consultation Chatbot"; no Conferbot account needed). Turn the chat on and save.
> 3. Storefront > Script Manager shows one "Conferbot" script (functional). Open the storefront: a chat bubble appears bottom right. Click it and reply to the bot.
> 4. Sign in as a customer and reload: the conversation receives the customer's ID and email (verified through the Current Customer API).
> 5. Uninstall: the script is removed automatically, and the store record is deleted.

## 6. Assets (in `docs/marketplace/assets/`)

| File | Size | Content |
| --- | --- | --- |
| `icon-512x512.png` | 512x512, transparent | Square icon: the Conferbot mark (from the landing site) on transparent |
| `logo-primary.png` | 1040x264, transparent | Primary logo: the Conferbot wordmark on transparent |
| `logo-alternate-dark-518x316.png` | 518x316 (2x of 259x158) | Alternate logo for dark backgrounds, no tagline: the same wordmark with the blue in white |
| `screenshot-1-settings-1600x900.png` | 1600x900 | The app's real settings page after saving (from the e2e recording) |

**Still needed:** 2–3 screenshots inside the BigCommerce control panel (the app page in Apps > My Apps, and Script Manager showing the Conferbot script), plus the storefront with the chat open. Capture them on the sandbox store. The storefront in `docs/demo.gif` is a mock and must not be used.

## 7. Owner checklist

- [ ] Apply to the BigCommerce Technology Partner programme and get the Partner ID.
- [ ] Host the app: HTTPS `APP_URL`, a database for `store.js`, and env vars for the client ID and secret.
- [ ] Developer Portal: the app's callbacks (`{APP_URL}/auth`, `/load`, `/uninstall`), the scope Content: modify, and the listing copy and assets above.
- [ ] Install on a sandbox store and capture the in-control-panel screenshots.
- [ ] Submit and pay the review and listing fee. Answer review feedback within 30 days.

Owner time: about half a day after partner approval (hosting, sandbox, screenshots, listing). Review: about 2–4 weeks. Fees: review and listing fee (amount shown in the portal).
