'use strict';

/**
 * Generates the JavaScript served to storefronts by GET /script.js.
 * Same loader contract as every Conferbot embed:
 *   window.ConferbotWidget(botId, embedType, options)
 */

const BOT_ID_RE = /^[a-f0-9]{24}$/i;

function isValidBotId(id) {
  return BOT_ID_RE.test(String(id || ''));
}

function extractBotId(text) {
  const m = String(text || '').match(/[a-f0-9]{24}/i);
  return m ? m[0] : '';
}

/**
 * @param {object} record { botId, enabled, embedType }
 * @param {string} storeHash
 * @param {object} cfg { widgetScriptUrl, appUrl, clientId }
 * @returns {string} JavaScript source (always valid JS)
 */
function buildLoaderScript(record, storeHash, cfg) {
  if (!record || !record.enabled || !isValidBotId(record.botId)) {
    return '/* conferbot: not configured for this store */\n';
  }

  const context = {
    botId: record.botId,
    embedType: record.embedType === 'popup_chat' ? 'popup_chat' : 'live_chat',
    scriptUrl: cfg.widgetScriptUrl,
    store: storeHash,
    appUrl: cfg.appUrl || '',
    clientId: cfg.clientId || '',
  };
  const json = JSON.stringify(context)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

  return `(function () {
  var cfg = ${json};
  if (document.getElementById('conferbot-js')) return;
  var js = document.createElement('script');
  js.async = true;
  js.src = cfg.scriptUrl;
  js.id = 'conferbot-js';
  js.charset = 'UTF-8';
  // The signed-in shopper, from BigCommerce's Current Customer API: the
  // storefront hands a logged-in shopper a JWT signed with our client
  // secret, and the app verifies it (POST /customer) before it is trusted.
  function signedInShopper(done) {
    var finished = false;
    var finish = function (user) { if (!finished) { finished = true; done(user); } };
    if (!cfg.clientId || !cfg.appUrl || typeof window.fetch !== 'function') return finish(null);
    setTimeout(function () { finish(null); }, 3000);
    window.fetch('/customer/current.jwt?app_client_id=' + encodeURIComponent(cfg.clientId), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (text) {
        var token = String(text || '').trim();
        try { var parsed = JSON.parse(token); if (parsed && parsed.token) token = String(parsed.token); } catch (e) {}
        if (token.split('.').length !== 3) return finish(null);
        return window.fetch(cfg.appUrl + '/customer?store=' + encodeURIComponent(cfg.store), {
          method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: token,
        })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (u) { finish(u && u.id ? { id: String(u.id), email: String(u.email || '') } : null); });
      })
      .catch(function () { finish(null); });
  }
  js.onload = function () {
    var options = { customData: { platform: 'bigcommerce', storeHash: cfg.store } };
    signedInShopper(function (user) {
      if (user) options.user = user;
      window.ConferbotWidget(cfg.botId, cfg.embedType, options);
    });
  };
  (document.head || document.documentElement).appendChild(js);
})();
`;
}

module.exports = { isValidBotId, extractBotId, buildLoaderScript };
