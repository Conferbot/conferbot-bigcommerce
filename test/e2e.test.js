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

// BigCommerce's signed_payload_jwt: iss "bc", aud = client ID, exp/nbf set.
function makeSignedPayloadJwt(payload, secret, header = { alg: 'HS256', typ: 'JWT' }) {
  const now = Math.floor(Date.now() / 1000);
  const full = Object.assign({ iss: 'bc', aud: CLIENT_ID, iat: now, nbf: now, exp: now + 86400 }, payload);
  Object.keys(full).forEach((k) => full[k] === undefined && delete full[k]);
  const head = Buffer.from(JSON.stringify(header)).toString('base64url');
  const body = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
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
  const verify = (jwt, secret = CLIENT_SECRET) => bcHelpers.verifySignedPayloadJwt(jwt, secret, CLIENT_ID);
  const good = makeSignedPayloadJwt({ sub: `stores/${STORE_HASH}` }, CLIENT_SECRET);
  assert.deepStrictEqual(verify(good).sub, `stores/${STORE_HASH}`);

  const wrongSecret = makeSignedPayloadJwt({ sub: 'stores/x1' }, 'other');
  assert.strictEqual(verify(wrongSecret), null);

  const expired = makeSignedPayloadJwt({ sub: `stores/${STORE_HASH}`, exp: 1 }, CLIENT_SECRET);
  assert.strictEqual(verify(expired), null);

  assert.strictEqual(verify('a.b'), null);
  assert.strictEqual(verify(''), null);
});

test('signed payload jwt must be for this app, from bigcommerce, with an expiry', () => {
  const verify = (jwt, secret = CLIENT_SECRET) => bcHelpers.verifySignedPayloadJwt(jwt, secret, CLIENT_ID);
  const sub = `stores/${STORE_HASH}`;
  assert.strictEqual(verify(makeSignedPayloadJwt({ sub, aud: 'another-app' }, CLIENT_SECRET)), null);
  assert.strictEqual(verify(makeSignedPayloadJwt({ sub, iss: 'someone-else' }, CLIENT_SECRET)), null);
  assert.strictEqual(verify(makeSignedPayloadJwt({ sub, exp: undefined }, CLIENT_SECRET)), null);
  const later = Math.floor(Date.now() / 1000) + 3600;
  assert.strictEqual(verify(makeSignedPayloadJwt({ sub, nbf: later }, CLIENT_SECRET)), null);
  assert.strictEqual(verify(makeSignedPayloadJwt({ sub }, CLIENT_SECRET, { alg: 'none' }), CLIENT_SECRET), null);
  // No secret configured: nothing verifies, not even a token signed with an empty key.
  assert.strictEqual(verify(makeSignedPayloadJwt({ sub }, ''), ''), null);
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

let settingsPath; // /app?store=..&session=.. from the signed load
let formToken;    // the settings page's signed form token

test('step 2: load callback with signed payload redirects to settings', async () => {
  const jwt = makeSignedPayloadJwt({ sub: `stores/${STORE_HASH}` }, CLIENT_SECRET);
  const res = await fetch(`${appUrl}/load?signed_payload_jwt=${jwt}`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  settingsPath = res.headers.get('location');
  assert.ok(settingsPath.startsWith(`/app?store=${STORE_HASH}&session=`));

  const forged = await fetch(`${appUrl}/load?signed_payload_jwt=a.b.c`, { redirect: 'manual' });
  assert.strictEqual(forged.status, 403);
});

test('step 3: settings page renders with demo bot; loader is a no-op before save', async () => {
  const page = await fetch(`${appUrl}${settingsPath}`);
  const html = await page.text();
  assert.ok(html.includes('Paste your Chatbot ID'));
  formToken = html.match(/name="token" value="([^"]+)"/)[1];
  assert.ok(html.includes(`data-demo-id="${DEMO_ID}"`));

  const js = await (await fetch(`${appUrl}/script.js?store=${STORE_HASH}`)).text();
  assert.match(js, /not configured/);
});

test('step 3b: settings refuse anyone but the store admin', async () => {
  const session = require('../src/session');
  // A bare ?store= (the old hole), a forged token, another store's token.
  assert.strictEqual((await fetch(`${appUrl}/app?store=${STORE_HASH}`)).status, 401);
  assert.strictEqual((await fetch(`${appUrl}/app?store=${STORE_HASH}&session=a.b`)).status, 401);
  const other = session.issueToken('zzzzzzzzzz', CLIENT_SECRET);
  assert.strictEqual((await fetch(`${appUrl}/app?store=${STORE_HASH}&session=${encodeURIComponent(other)}`)).status, 401);
  const post = (fields) => fetch(`${appUrl}/app/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ store: STORE_HASH, botId: 'aaaaaaaaaaaaaaaaaaaaaaaa', enabled: '1', ...fields }),
    redirect: 'manual',
  });
  assert.strictEqual((await post({})).status, 401);
  assert.strictEqual((await post({ token: session.issueToken(STORE_HASH, 'wrong-secret') })).status, 401);
});

test('step 4: saving a pasted snippet enables the widget loader', async () => {
  const body = new URLSearchParams({
    store: STORE_HASH,
    botId: `js.onload: window.ConferbotWidget("${DEMO_ID}", "live_chat")`,
    enabled: '1',
    embedType: 'live_chat',
    token: formToken,
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

// BigCommerce's Current Customer API token: iss "bc/apps", aud = client ID.
function makeCustomerJwt(overrides = {}, secret = CLIENT_SECRET) {
  return makeSignedPayloadJwt(Object.assign({
    iss: 'bc/apps', sub: STORE_HASH, store_hash: STORE_HASH, operation: 'current_customer',
    customer: { id: 4927, email: 'shopper@example.com', group_id: '6' },
  }, overrides), secret);
}

test('step 4b: a signed-in shopper is identified only from a token BigCommerce signed for us', async () => {
  const js = await (await fetch(`${appUrl}/script.js?store=${STORE_HASH}`)).text();
  assert.ok(js.includes('/customer/current.jwt?app_client_id='));
  assert.ok(js.includes(CLIENT_ID));
  assert.ok(!js.includes('window.customer'));

  const post = (token, store = STORE_HASH) => fetch(`${appUrl}/customer?store=${store}`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: token,
  });
  const ok = await post(makeCustomerJwt());
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.headers.get('access-control-allow-origin'), '*');
  assert.deepStrictEqual(await ok.json(), { id: 'bc-4927', email: 'shopper@example.com' });

  assert.strictEqual((await post(makeCustomerJwt({}, 'wrong-secret'))).status, 401);
  assert.strictEqual((await post(makeCustomerJwt({ aud: 'another-app' }))).status, 401);
  assert.strictEqual((await post(makeCustomerJwt({ store_hash: 'otherstore' }))).status, 401);
  assert.strictEqual((await post(makeCustomerJwt({ iss: 'bc' }))).status, 401);
  assert.strictEqual((await post('not-a-jwt')).status, 401);
  assert.strictEqual((await post(makeCustomerJwt(), 'unknownstore')).status, 401);
});

test('step 5: uninstall callback removes the store record', async () => {
  const jwt = makeSignedPayloadJwt({ sub: `stores/${STORE_HASH}` }, CLIENT_SECRET);
  const res = await fetch(`${appUrl}/uninstall?signed_payload_jwt=${jwt}`);
  assert.strictEqual(res.status, 200);
  const js = await (await fetch(`${appUrl}/script.js?store=${STORE_HASH}`)).text();
  assert.match(js, /not configured/);
});

test('step 6: real browser - widget mounts on a storefront page', { skip: process.env.RUN_BROWSER_E2E !== '1' }, async () => {
  // re-install and re-enable after the uninstall test above
  const qs = new URLSearchParams({ code: 'grant-3', scope: 's', context: `stores/${STORE_HASH}` });
  const install = await fetch(`${appUrl}/auth?${qs}`, { redirect: 'manual' });
  const html = await (await fetch(`${appUrl}${install.headers.get('location')}`)).text();
  const token = html.match(/name="token" value="([^"]+)"/)[1];
  const body = new URLSearchParams({ store: STORE_HASH, botId: DEMO_ID, enabled: '1', embedType: 'live_chat', token });
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
