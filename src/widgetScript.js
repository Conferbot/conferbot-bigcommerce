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
 * @param {object} cfg { widgetScriptUrl }
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
  js.onload = function () {
    var options = { customData: { platform: 'bigcommerce', storeHash: cfg.store } };
    try {
      if (window.customer && window.customer.id) {
        options.user = { id: 'bc-' + window.customer.id, name: window.customer.name || '', email: window.customer.email || '' };
      }
    } catch (e) {}
    window.ConferbotWidget(cfg.botId, cfg.embedType, options);
  };
  (document.head || document.documentElement).appendChild(js);
})();
`;
}

module.exports = { isValidBotId, extractBotId, buildLoaderScript };
