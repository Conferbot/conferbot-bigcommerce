# Changelog

## 0.1.0 - 2026-10-17

First tagged version of the Conferbot BigCommerce app (Express, OAuth). Not yet listed on the BigCommerce App Marketplace.

- OAuth install, load and uninstall callbacks, a settings page and a storefront script added through the Scripts API.
- Signed payloads must be for this app, from BigCommerce and unexpired; load and uninstall check the payload is for this store.
- Settings open and save only for the store admin, through signed, short-lived tokens carried by the settings form.
- Signed-in shoppers are identified through the Current Customer API: `POST /customer` verifies the token for this store and returns the shopper's id and details.
- Settings say where the bot ID is in the Conferbot dashboard (Share > Embed into your website).
