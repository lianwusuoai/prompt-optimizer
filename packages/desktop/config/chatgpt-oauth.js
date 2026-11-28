const http = require('node:http');
const { randomBytes, createHash } = require('node:crypto');

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const TOKEN_URL = ISSUER + '/api/accounts/oauth/token';

function issue(key) {
  const code = 'chatgptSubscription.' + key;
  return Object.assign(new Error(code), { code });
}

async function exchange(parameters, fetchImpl, signal) {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST', body: new URLSearchParams({ resource: RESOURCE, ...parameters }),
    redirect: 'error', signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof body.error === 'string' ? body.error : body.error?.code;
    const expired = ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired',
      'refresh_token_invalidated', 'refresh_token_reused'].includes(code);
    throw issue(expired ? 'reconnect' : 'authorizationFailed');
  }
  if (typeof body.access_token !== 'string' || !body.access_token || !(Number(body.expires_in) > 0)) {
    throw issue('authorizationFailed');
  }
  return body;
}

async function verifyIdentity(idToken, clientId, nonce, fetchImpl) {
  const { jwtVerify, createRemoteJWKSet, customFetch } = await import('jose');
  const keys = createRemoteJWKSet(new URL(ISSUER + '/.well-known/jwks.json'), { [customFetch]: fetchImpl });
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: ISSUER, audience: clientId, algorithms: ['RS256'], requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
  });
  if (typeof payload.sub !== 'string' || !payload.sub || payload.nonce !== nonce ||
      (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) ||
      (payload.azp && payload.azp !== clientId)) throw issue('authorizationFailed');
  return { subject: payload.sub, email: typeof payload.email === 'string' ? payload.email : '' };
}

// Only the loopback listener receives authorization codes. Never forward the callback URL to Electron.
async function authorize({ hostId, account, openBrowser, fetchImpl, signal, verify = verifyIdentity }) {
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  signal.throwIfAborted();
  const callback = Promise.withResolvers();
  // Abort can precede browser launch or the await below.
  callback.promise.catch(() => {});
  const server = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); }
    catch { res.writeHead(400).end(); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (req.method !== 'GET' || req.headers.host !== '127.0.0.1:' + server.address()?.port ||
        url.pathname !== '/auth/callback' || url.searchParams.get('state') !== state) {
      res.writeHead(400).end('Invalid sign-in callback.');
      return;
    }
    res.end('Return to Prompt Optimizer to continue.');
    if (url.searchParams.has('error')) callback.reject(issue('cancelled'));
    else callback.resolve(url.searchParams);
  });
  const abort = () => callback.reject(issue('cancelled'));
  signal.addEventListener('abort', abort, { once: true });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    signal.throwIfAborted();
    const redirect = 'http://127.0.0.1:' + server.address().port + '/auth/callback';
    const url = new URL(ISSUER + '/api/accounts/authorize');
    url.search = new URLSearchParams({
      client_id: account?.clientId || 'dynamic_agent_client', response_type: 'code', redirect_uri: redirect,
      resource: RESOURCE, scope: 'openid profile email offline_access resource.invoke ' + PLAN_SCOPE,
      ext_agent_host_id: hostId, state, nonce, code_challenge: challenge, code_challenge_method: 'S256',
    }).toString();
    if (!account) url.searchParams.set('agent_name_hint', 'Prompt Optimizer');
    if (account?.tokens?.idToken) url.searchParams.set('id_token_hint', account.tokens.idToken);
    if (account?.email) url.searchParams.set('login_hint', account.email);
    if (account?.tokens && !hasPlan(account.tokens)) url.searchParams.set('prompt', 'consent');
    await openBrowser(url.href).catch(() => { throw issue('authorizationFailed'); });
    const params = await callback.promise;
    const clientId = params.get('client_id') || account?.clientId;
    const code = params.get('code');
    if (!code || !clientId || clientId === 'dynamic_agent_client' || (account && account.clientId !== clientId)) {
      throw issue('authorizationFailed');
    }
    const body = await exchange({ grant_type: 'authorization_code', client_id: clientId, code,
      code_verifier: verifier, redirect_uri: redirect }, fetchImpl, signal);
    const identity = await verify(body.id_token, clientId, nonce, fetchImpl).catch(() => { throw issue('authorizationFailed'); });
    if (account && identity.subject !== account.subject) throw issue('authorizationFailed');
    return { clientId, ...identity, tokens: tokenSet(body) };
  } finally {
    signal.removeEventListener('abort', abort);
    server.close();
    server.closeAllConnections();
  }
}

function tokenSet(body, previous) {
  const earliest = Number(body.earliest_refresh_at);
  return { accessToken: body.access_token, refreshToken: body.refresh_token || previous?.refreshToken,
    idToken: body.id_token || previous?.idToken, scope: body.scope ?? previous?.scope ?? '',
    expiresAt: Date.now() + Number(body.expires_in) * 1000,
    earliestRefreshAt: Number.isFinite(earliest) ? earliest * 1000 : 0 };
}

function hasPlan(tokens) {
  return typeof tokens?.scope === 'string' && tokens.scope.split(/\s+/).includes(PLAN_SCOPE);
}

async function revoke(account, fetchImpl) {
  if (!account?.tokens?.refreshToken) return true;
  const options = { signal: AbortSignal.timeout(15000), redirect: 'error' };
  const discovery = await fetchImpl(ISSUER + '/.well-known/openid-configuration', options);
  if (!discovery.ok) return false;
  const metadata = await discovery.json();
  const endpoint = new URL(metadata.revocation_endpoint);
  if (metadata.issuer !== ISSUER || endpoint.origin !== ISSUER) return false;
  const response = await fetchImpl(endpoint, { ...options, method: 'POST', body: new URLSearchParams({
    client_id: account.clientId, token: account.tokens.refreshToken, token_type_hint: 'refresh_token',
  }) });
  return response.ok;
}

module.exports = { authorize, exchange, hasPlan, issue, RESOURCE, revoke, tokenSet, verifyIdentity };
