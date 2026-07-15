'use strict';

/**
 * End-to-end test: mock BigCommerce (OAuth token endpoint + Scripts API v3)
 * plus the real app, driven through the full merchant journey. The final
 * browser stage (RUN_BROWSER_E2E=1) loads the served loader on a fake
 * storefront and asserts the real CDN widget mounts.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const createApp = require('../src/server');
const bcHelpers = require('../src/bigcommerce');
const { extractBotId, isValidBotId, buildLoaderScript } = require('../src/widgetScript');

const STORE_HASH = 'abc123def';
const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';
const DEMO_ID = '691c970890527a0468f9b2c9';

let mockBc;
let mockPort;
let appServer;
let appUrl;
const mockState = { tokenRequests: [], scripts: [], nextUuid: 1 };

function makeSignedPayloadJwt(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

before(async () => {
  mockBc = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'POST' && url.pathname === '/oauth2/token') {
        mockState.tokenRequests.push(JSON.parse(body));
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({
          access_token: 'bc-mock-token', scope: 'store_content_checkout',
          context: `stores/${STORE_HASH}`, user: { id: 1, email: 'demo@conferbot.com' },
        }));
      }
      if (url.pathname === `/stores/${STORE_HASH}/v3/content/scripts`) {
        if (req.headers['x-auth-token'] !== 'bc-mock-token') {
          res.statusCode = 401;
          return res.end('{}');
        }
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET') {
          return res.end(JSON.stringify({ data: mockState.scripts }));
        }
        if (req.method === 'POST') {
          const script = JSON.parse(body);
          script.uuid = `uuid-${mockState.nextUuid++}`;
          mockState.scripts.push(script);
          res.statusCode = 200;
          return res.end(JSON.stringify({ data: script }));
        }
      }
      res.statusCode = 404;
      res.end('not found');
    });
  });
  await new Promise((r) => mockBc.listen(0, r));
  mockPort = mockBc.address().port;

  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cbbc-')), 'stores.json');
  const cfg = {
    port: 0,
    appUrl: '',
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    authBase: `http://localhost:${mockPort}`,
    apiBase: `http://localhost:${mockPort}`,
    widgetScriptUrl: 'https://cdn.conferbot.com/dist/v1/widget.min.js',
    demoBotId: DEMO_ID,
    dataFile,
  };
  const { app } = createApp(cfg);
  appServer = http.createServer(app);
  await new Promise((r) => appServer.listen(0, r));
  appUrl = `http://localhost:${appServer.address().port}`;
  cfg.appUrl = appUrl;
});

after(async () => {
  await new Promise((r) => appServer.close(r));
  await new Promise((r) => mockBc.close(r));
});

// ---- unit-ish: helpers -------------------------------------------------------

test('store hash extraction and validation', () => {
  assert.strictEqual(bcHelpers.storeHashFromContext(`stores/${STORE_HASH}`), STORE_HASH);
  assert.strictEqual(bcHelpers.storeHashFromContext('stores/UPPER'), '');
  assert.strictEqual(bcHelpers.storeHashFromContext('shops/x'), '');
  assert.strictEqual(bcHelpers.storeHashFromContext(null), '');
  assert.ok(bcHelpers.isValidStoreHash(STORE_HASH));
  assert.ok(!bcHelpers.isValidStoreHash('has space'));
  assert.ok(!bcHelpers.isValidStoreHash(''));
});

test('signed payload jwt verification accepts valid, rejects tampered/expired', () => {
  const good = makeSignedPayloadJwt({ sub: `stores/${STORE_HASH}` }, CLIENT_SECRET);
  assert.deepStrictEqual(bcHelpers.verifySignedPayloadJwt(good, CLIENT_SECRET).sub, `stores/${STORE_HASH}`);

  const wrongSecret = makeSignedPayloadJwt({ sub: 'stores/x1' }, 'other');
  assert.strictEqual(bcHelpers.verifySignedPayloadJwt(wrongSecret, CLIENT_SECRET), null);

  const expired = makeSignedPayloadJwt({ sub: `stores/${STORE_HASH}`, exp: 1 }, CLIENT_SECRET);
  assert.strictEqual(bcHelpers.verifySignedPayloadJwt(expired, CLIENT_SECRET), null);

  assert.strictEqual(bcHelpers.verifySignedPayloadJwt('a.b', CLIENT_SECRET), null);
  assert.strictEqual(bcHelpers.verifySignedPayloadJwt('', CLIENT_SECRET), null);
});

test('bot id helpers behave like every other conferbot integration', () => {
  assert.strictEqual(extractBotId(`window.ConferbotWidget("${DEMO_ID}")`), DEMO_ID);
  assert.strictEqual(extractBotId('garbage'), '');
  assert.ok(isValidBotId(DEMO_ID));
  assert.ok(!isValidBotId(DEMO_ID.slice(1)));
});

test('loader script is inert until configured and safe when it is', () => {
  assert.match(buildLoaderScript(null, STORE_HASH, { widgetScriptUrl: 'x' }), /not configured/);
  const js = buildLoaderScript({ botId: DEMO_ID, enabled: true }, STORE_HASH, {
    widgetScriptUrl: 'https://cdn.example.com/w.js?a=1&b=2</script>',
  });
  assert.ok(!js.includes('</script>'));
  assert.ok(js.includes(DEMO_ID));
});

// ---- the merchant journey ------------------------------------------------------

test('step 1: install callback exchanges the code and registers the script', async () => {
  const qs = new URLSearchParams({
    code: 'grant-1', scope: 'store_content_checkout', context: `stores/${STORE_HASH}`,
  });
  const res = await fetch(`${appUrl}/auth?${qs}`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  assert.ok(res.headers.get('location').startsWith('/app?store='));

  assert.strictEqual(mockState.tokenRequests[0].client_id, CLIENT_ID);
  assert.strictEqual(mockState.tokenRequests[0].client_secret, CLIENT_SECRET);
  assert.strictEqual(mockState.tokenRequests[0].code, 'grant-1');

  assert.strictEqual(mockState.scripts.length, 1);
  assert.strictEqual(mockState.scripts[0].src, `${appUrl}/script.js?store=${STORE_HASH}`);
  assert.strictEqual(mockState.scripts[0].auto_uninstall, true);
});

test('step 1b: install with bad context is rejected', async () => {
  const res = await fetch(`${appUrl}/auth?code=x&scope=s&context=evil`, { redirect: 'manual' });
  assert.strictEqual(res.status, 400);
});

test('step 1c: reinstall does not duplicate the script', async () => {
  const qs = new URLSearchParams({ code: 'grant-2', scope: 's', context: `stores/${STORE_HASH}` });
  const res = await fetch(`${appUrl}/auth?${qs}`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(mockState.scripts.length, 1);
});

test('step 2: load callback with signed payload redirects to settings', async () => {
  const jwt = makeSignedPayloadJwt({ sub: `stores/${STORE_HASH}` }, CLIENT_SECRET);
  const res = await fetch(`${appUrl}/load?signed_payload_jwt=${jwt}`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get('location'), `/app?store=${STORE_HASH}`);

  const forged = await fetch(`${appUrl}/load?signed_payload_jwt=a.b.c`, { redirect: 'manual' });
  assert.strictEqual(forged.status, 403);
});

test('step 3: settings page renders with demo bot; loader is a no-op before save', async () => {
  const page = await fetch(`${appUrl}/app?store=${STORE_HASH}`);
  const html = await page.text();
  assert.ok(html.includes('Paste your Chatbot ID'));
  assert.ok(html.includes(`data-demo-id="${DEMO_ID}"`));

  const js = await (await fetch(`${appUrl}/script.js?store=${STORE_HASH}`)).text();
  assert.match(js, /not configured/);
});

test('step 4: saving a pasted snippet enables the widget loader', async () => {
  const body = new URLSearchParams({
    store: STORE_HASH,
    botId: `js.onload: window.ConferbotWidget("${DEMO_ID}", "live_chat")`,
    enabled: '1',
    embedType: 'live_chat',
  });
  const save = await fetch(`${appUrl}/app/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'manual',
  });
  assert.strictEqual(save.status, 302);

  const js = await (await fetch(`${appUrl}/script.js?store=${STORE_HASH}`)).text();
  assert.ok(js.includes(DEMO_ID));
  assert.ok(js.includes('window.ConferbotWidget(cfg.botId'));
});

test('step 5: uninstall callback removes the store record', async () => {
  const jwt = makeSignedPayloadJwt({ sub: `stores/${STORE_HASH}` }, CLIENT_SECRET);
  const res = await fetch(`${appUrl}/uninstall?signed_payload_jwt=${jwt}`);
  assert.strictEqual(res.status, 200);
  const js = await (await fetch(`${appUrl}/script.js?store=${STORE_HASH}`)).text();
  assert.match(js, /not configured/);
});

test('step 6: real browser - widget mounts on a storefront page', { skip: process.env.RUN_BROWSER_E2E !== '1' }, async () => {
  // re-enable after the uninstall test above
  const body = new URLSearchParams({ store: STORE_HASH, botId: DEMO_ID, enabled: '1', embedType: 'live_chat' });
  await fetch(`${appUrl}/app/save`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual',
  });

  const puppeteer = require('puppeteer');
  const storefront = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><html><head>
      <script async src="${appUrl}/script.js?store=${STORE_HASH}"></script>
      </head><body><h1>Mock BigCommerce storefront</h1></body></html>`);
  });
  await new Promise((r) => storefront.listen(0, r));

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${storefront.address().port}/`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('conferbot-widget', { timeout: 30000 });
    assert.strictEqual(await page.evaluate(() => typeof window.ConferbotWidget), 'function');
  } finally {
    await browser.close();
    await new Promise((r) => storefront.close(r));
  }
});
