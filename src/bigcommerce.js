'use strict';

const crypto = require('crypto');

/**
 * BigCommerce OAuth + Scripts API helpers. Store identity is the store hash
 * from the OAuth context ("stores/abc123" -> "abc123").
 */

const HASH_RE = /^[a-z0-9]+$/;

function isValidStoreHash(hash) {
  return HASH_RE.test(String(hash || ''));
}

function storeHashFromContext(context) {
  const m = String(context || '').match(/^stores\/([a-z0-9]+)$/);
  return m ? m[1] : '';
}

/**
 * Verifies an HS256 JWT signed with the app's client secret and returns its
 * payload, or null. Checks the signature, the alg, aud (our client ID when
 * given), iss, exp (required) and nbf, with a minute of clock skew.
 */
function verifyHs256Jwt(jwt, clientSecret, { iss, aud, now = Math.floor(Date.now() / 1000) } = {}) {
  if (!clientSecret) {
    return null;
  }
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [headerB64, payloadB64, sigB64] = parts;
  const expected = crypto
    .createHmac('sha256', clientSecret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sigB64, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }
  try {
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    if (!header || header.alg !== 'HS256') {
      return null;
    }
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    const skew = 60;
    if (!payload || typeof payload.exp !== 'number' || payload.exp + skew < now) {
      return null;
    }
    if (typeof payload.nbf === 'number' && payload.nbf - skew > now) {
      return null;
    }
    if (iss && payload.iss !== iss) {
      return null;
    }
    if (aud && payload.aud !== aud) {
      return null;
    }
    return payload;
  } catch (e) {
    return null;
  }
}

/**
 * Verifies the signed_payload_jwt BigCommerce sends to the load/uninstall
 * callbacks (iss "bc", aud our client ID). Returns the payload or null.
 */
function verifySignedPayloadJwt(jwt, clientSecret, clientId) {
  return verifyHs256Jwt(jwt, clientSecret, { iss: 'bc', aud: clientId });
}

/**
 * Verifies a Current Customer API token from the storefront
 * (iss "bc/apps", aud our client ID, for this store). Returns the payload or null.
 */
function verifyCurrentCustomerJwt(jwt, clientSecret, clientId, storeHash) {
  const payload = verifyHs256Jwt(jwt, clientSecret, { iss: 'bc/apps', aud: clientId });
  if (!payload || payload.store_hash !== storeHash || !payload.customer || !payload.customer.id) {
    return null;
  }
  return payload;
}

async function exchangeCodeForToken({ code, scope, context, cfg }) {
  const res = await fetch(`${cfg.authBase}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      scope,
      context,
      grant_type: 'authorization_code',
      redirect_uri: `${cfg.appUrl}/auth`,
    }),
  });
  if (!res.ok) {
    throw new Error(`token exchange failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('token exchange returned no access_token');
  }
  return data;
}

/**
 * Idempotently ensures a storefront Script pointing at our loader exists
 * (Scripts API v3). Returns the script uuid.
 */
async function ensureScript({ storeHash, accessToken, src, cfg }) {
  const api = `${cfg.apiBase}/stores/${storeHash}/v3/content/scripts`;
  const headers = {
    'X-Auth-Token': accessToken,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const listRes = await fetch(api, { headers });
  if (!listRes.ok) {
    throw new Error(`script list failed: HTTP ${listRes.status}`);
  }
  const existing = ((await listRes.json()).data) || [];
  const ours = existing.find((s) => s.src === src);
  if (ours) {
    return ours.uuid;
  }

  const createRes = await fetch(api, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Conferbot Live Chat',
      description: 'Loads the Conferbot AI chat widget',
      src,
      auto_uninstall: true,
      load_method: 'async',
      location: 'footer',
      visibility: 'all_pages',
      kind: 'src',
      consent_category: 'functional',
    }),
  });
  if (!createRes.ok) {
    throw new Error(`script create failed: HTTP ${createRes.status}`);
  }
  return (await createRes.json()).data.uuid;
}

module.exports = {
  isValidStoreHash,
  storeHashFromContext,
  verifySignedPayloadJwt,
  verifyCurrentCustomerJwt,
  exchangeCodeForToken,
  ensureScript,
};
