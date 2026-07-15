'use strict';

/**
 * Environment-driven configuration. AUTH_BASE/API_BASE exist so tests can
 * point OAuth and the Scripts API at a mock server; in production they are
 * BigCommerce's real hosts.
 */
module.exports = {
  port: parseInt(process.env.PORT || '3057', 10),
  appUrl: process.env.APP_URL || 'http://localhost:3057',
  clientId: process.env.BC_CLIENT_ID || '',
  clientSecret: process.env.BC_CLIENT_SECRET || '',
  authBase: process.env.BC_AUTH_BASE || 'https://login.bigcommerce.com',
  apiBase: process.env.BC_API_BASE || 'https://api.bigcommerce.com',
  widgetScriptUrl: process.env.CONFERBOT_WIDGET_URL || 'https://cdn.conferbot.com/dist/v1/widget.min.js',
  demoBotId: '691c970890527a0468f9b2c9',
  dataFile: process.env.DATA_FILE || require('path').join(__dirname, '..', 'data', 'stores.json'),
};
