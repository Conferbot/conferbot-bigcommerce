'use strict';

const express = require('express');
const bc = require('./bigcommerce');
const ShopStore = require('./store');
const { buildLoaderScript, extractBotId, isValidBotId } = require('./widgetScript');
const { renderAdminPage } = require('./adminPage');

/**
 * App factory - config injected so tests can point authBase/apiBase at a
 * mock BigCommerce. Returns { app, store }.
 *
 * BigCommerce flow differs from Shopify: installation STARTS on the
 * BigCommerce side, which calls GET /auth with ?code&scope&context.
 */
function createApp(cfg) {
  const app = express();
  const store = new ShopStore(cfg.dataFile);

  app.use(express.urlencoded({ extended: false }));

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.get('/logo.png', (req, res) => res.sendFile(require('path').join(__dirname, '..', 'logo.png')));

  // ---- Install callback (BigCommerce -> us) --------------------------------

  app.get('/auth', async (req, res) => {
    try {
      const { code, scope, context } = req.query;
      const storeHash = bc.storeHashFromContext(context);
      if (!code || !storeHash) {
        return res.status(400).send('Missing code or invalid context');
      }

      const token = await bc.exchangeCodeForToken({ code, scope, context, cfg });
      const src = `${cfg.appUrl}/script.js?store=${encodeURIComponent(storeHash)}`;
      const scriptUuid = await bc.ensureScript({
        storeHash,
        accessToken: token.access_token,
        src,
        cfg,
      });

      const existing = store.get(storeHash);
      store.upsert(storeHash, {
        accessToken: token.access_token,
        scriptUuid,
        enabled: existing ? existing.enabled : false,
      });
      res.redirect(`/app?store=${encodeURIComponent(storeHash)}`);
    } catch (e) {
      res.status(502).send('Installation failed: ' + e.message);
    }
  });

  // ---- Load callback (merchant opens the app in the BC admin) ----------------

  app.get('/load', (req, res) => {
    const payload = bc.verifySignedPayloadJwt(req.query.signed_payload_jwt, cfg.clientSecret);
    if (!payload) {
      return res.status(403).send('Invalid signed payload');
    }
    const storeHash = payload.sub ? bc.storeHashFromContext(payload.sub) : '';
    if (!storeHash) {
      return res.status(400).send('No store in payload');
    }
    res.redirect(`/app?store=${encodeURIComponent(storeHash)}`);
  });

  // ---- Uninstall callback -------------------------------------------------------

  app.get('/uninstall', (req, res) => {
    const payload = bc.verifySignedPayloadJwt(req.query.signed_payload_jwt, cfg.clientSecret);
    if (!payload) {
      return res.status(403).send('Invalid signed payload');
    }
    const storeHash = payload.sub ? bc.storeHashFromContext(payload.sub) : '';
    if (storeHash) {
      store.remove(storeHash);
    }
    res.json({ ok: true });
  });

  // ---- Settings page --------------------------------------------------------------

  app.get('/app', (req, res) => {
    const storeHash = String(req.query.store || '');
    if (!bc.isValidStoreHash(storeHash)) {
      return res.status(400).send('Missing or invalid store parameter');
    }
    res.send(renderAdminPage({
      store: storeHash,
      record: store.get(storeHash),
      demoBotId: cfg.demoBotId,
      saved: req.query.saved === '1',
    }));
  });

  app.post('/app/save', (req, res) => {
    const storeHash = String(req.body.store || '');
    if (!bc.isValidStoreHash(storeHash)) {
      return res.status(400).send('Missing or invalid store parameter');
    }
    const botId = extractBotId(req.body.botId);
    store.upsert(storeHash, {
      botId,
      enabled: req.body.enabled === '1' && isValidBotId(botId),
      embedType: req.body.embedType === 'popup_chat' ? 'popup_chat' : 'live_chat',
    });
    res.redirect(`/app?store=${encodeURIComponent(storeHash)}&saved=1`);
  });

  // ---- Storefront loader (the Scripts API src) ---------------------------------------

  app.get('/script.js', (req, res) => {
    const storeHash = String(req.query.store || '');
    res.type('application/javascript');
    res.set('Cache-Control', 'public, max-age=300');
    if (!bc.isValidStoreHash(storeHash)) {
      return res.send('/* conferbot: invalid store */\n');
    }
    res.send(buildLoaderScript(store.get(storeHash), storeHash, cfg));
  });

  return { app, store };
}

module.exports = createApp;
