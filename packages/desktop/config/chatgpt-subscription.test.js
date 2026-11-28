const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createHash, generateKeyPairSync } = require('node:crypto');
const { authorize, hasPlan } = require('./chatgpt-oauth');
const { ChatGPTSubscription, readCatalog } = require('./chatgpt-subscription');
const { ChatGPTSessionStore } = require('./chatgpt-session-store');

const planScope = 'openid email profile offline_access resource.invoke chatgpt.tokens.use.direct';
const model = { slug: 'text-a', display_name: 'Text A', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }] };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('loopback registration verifies PKCE and a signed ID token before accepting a session', async () => {
  const { SignJWT, exportJWK } = await import('jose');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256' };
  for (const wrongNonce of [false, true]) {
    let request;
    const fetchImpl = async (url, options) => {
      if (String(url).endsWith('jwks.json')) return json({ keys: [jwk] });
      assert.equal(String(url), 'https://auth.openai.com/api/accounts/oauth/token');
      const body = options.body;
      assert.equal(body.get('client_id'), 'issued-id');
      assert.equal(body.get('redirect_uri'), request.get('redirect_uri'));
      assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), request.get('code_challenge'));
      const id = await new SignJWT({ nonce: wrongNonce ? 'invalid' : request.get('nonce'), email: 'test@example.test' })
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setSubject('subject').setAudience('issued-id')
        .setIssuer('https://auth.openai.com').setIssuedAt().setExpirationTime('1h').sign(privateKey);
      return json({ id_token: id, access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, scope: planScope });
    };
    const openBrowser = async uri => {
      const url = new URL(uri);
      assert.equal(url.origin, 'https://auth.openai.com');
      request = url.searchParams;
      assert.equal(request.get('client_id'), 'dynamic_agent_client');
      assert.equal(request.get('agent_name_hint'), 'Prompt Optimizer');
      assert.equal(request.get('code_challenge_method'), 'S256');
      const cb = new URL(request.get('redirect_uri'));
      cb.search = new URLSearchParams({ code: 'test-code', state: 'wrong', client_id: 'issued-id' });
      assert.equal((await fetch(cb)).status, 400);
      cb.searchParams.set('state', request.get('state'));
      assert.equal((await fetch(cb)).status, 200);
    };
    const attempt = authorize({ hostId: 'urn:uuid:test', openBrowser, fetchImpl, signal: AbortSignal.timeout(8000) });
    if (wrongNonce) await assert.rejects(attempt, /authorizationFailed/);
    else {
      const account = await attempt;
      assert.equal(account.subject, 'subject');
      assert.ok(hasPlan(account.tokens));
    }
  }
});

test('cancelling authorization closes the loopback listener', async () => {
  const controller = new AbortController();
  let callbackUrl;
  await assert.rejects(authorize({ hostId: 'test-host', signal: controller.signal,
    openBrowser: async uri => { callbackUrl = new URL(uri).searchParams.get('redirect_uri'); controller.abort(); },
  }), /cancelled/);
  await assert.rejects(fetch(callbackUrl));
});

async function fixture(t, persistent = true) {
  const dir = await mkdtemp(path.join(tmpdir(), 'po-subscription-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const storage = { isEncryptionAvailable: () => persistent, getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: value => Buffer.from(value).map(n => n ^ 123), decryptString: buffer => buffer.map(n => n ^ 123).toString() };
  const store = new ChatGPTSessionStore(dir, storage);
  const account = { clientId: 'client-a', subject: 'subject-a', email: 'account@example.test',
    tokens: { accessToken: 'secret-access', refreshToken: 'secret-refresh', expiresAt: Date.now() + 3600000, earliestRefreshAt: 0, scope: planScope } };
  const f = { store, account, catalog: { models: [model] }, grants: 0, revoked: true, projections: [] };
  const opts = {
    signIn: async () => structuredClone(f.account),
    syncModels: async (ref, models) => { f.projections.push({ ref, models }); },
    fetchImpl: async (url, init) => {
      if (String(url).endsWith('/models')) {
        assert.match(init.headers.Authorization, /^Bearer (secret-access|rotated-access)$/);
        return json(f.catalog);
      }
      if (String(url).endsWith('/token')) {
        assert.equal(init.body.get('refresh_token'), 'secret-refresh');
        f.grants++;
        return json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600 });
      }
      if (String(url).includes('openid-configuration')) return json({ issuer: 'https://auth.openai.com', revocation_endpoint: 'https://auth.openai.com/revoke' });
      assert.equal(new URL(url).pathname, '/revoke');
      return new Response(null, { status: f.revoked ? 200 : 503 });
    },
  };
  f.app = new ChatGPTSubscription({ store, ...opts });
  f.reopen = () => new ChatGPTSubscription({ store: new ChatGPTSessionStore(dir, storage), ...opts });
  return f;
}

test('catalog respects provider visibility, text output, ordering, and rejects malformed replies', () => {
  assert.deepEqual(readCatalog({ models: [model, { ...model, slug: 'hidden', visibility: 'hide' },
    { ...model, slug: 'image', output_modalities: ['image'] }, { ...model, slug: 'text-b' }, model] }).map(x => x.slug), ['text-a', 'text-b']);
  assert.throws(() => readCatalog({ data: [] }), /catalogFailed/);
  assert.throws(() => readCatalog({ models: [{}] }), /catalogFailed/);
});

test('restores isolated credentials, rotates once between instances and retains last successful catalog', async t => {
  const f = await fixture(t);
  const status = await f.app.connect();
  assert.equal(status.count, 1);
  const { ref } = f.projections.at(-1);
  assert.equal(status.connectionRef, ref);
  const second = f.reopen();
  await second.restore();
  assert.deepEqual(f.projections.at(-1).models.map(x => x.slug), ['text-a']);
  const exposed = JSON.stringify([status, f.projections, await second.status()]) + await readFile(f.store.file, 'utf8');
  assert.doesNotMatch(exposed, /secret-access|secret-refresh/);
  await f.store.run(async (state, save) => { state.account.tokens.expiresAt = 0; await save(); });
  const pair = await Promise.all([f.app.access(ref, 'text-a'), second.access(ref, 'text-a')]);
  assert.ok(pair.every(entry => entry.token === 'rotated-access'));
  assert.equal(f.grants, 1);
  f.catalog = { data: [] };
  await assert.rejects(f.app.refresh(), /catalogFailed/);
  assert.equal((await f.app.status()).count, 1);
  f.catalog = { models: [] };
  assert.equal((await f.app.refresh()).count, 0);
  await assert.rejects(f.app.access(ref, 'text-a'), /modelUnavailable/);
  f.revoked = false;
  assert.equal((await f.app.disconnect()).revocationUnconfirmed, true);
  assert.equal((await second.status()).status, 'signedOut');
  assert.equal(f.projections.at(-1).ref, null);
  await assert.rejects(second.access(ref, 'text-a'), /reconnect/);
});

test('identity-only consent, account switch and session-only storage', async t => {
  const f = await fixture(t, false);
  f.account.tokens.scope = 'openid email';
  assert.equal((await f.app.connect()).status, 'needsConsent');
  assert.equal(f.projections.at(-1).ref, null);
  f.account.tokens.scope = planScope;
  await f.app.connect();
  const old = f.projections.at(-1).ref;
  f.account.clientId = 'client-b';
  f.account.subject = 'subject-b';
  await f.app.connect(true);
  await assert.rejects(f.app.access(old, 'text-a'), /reconnect/);
  assert.equal((await f.reopen().status()).status, 'disconnected');
  assert.equal(JSON.parse(await readFile(f.store.file, 'utf8')).sealed, undefined);
});

test('disconnect cancels an in-flight directory refresh before it can republish old models', async t => {
  const f = await fixture(t);
  await f.app.connect();
  const started = Promise.withResolvers();
  const realFetch = f.app.fetch;
  f.app.fetch = (url, options) => {
    if (!String(url).endsWith('/models')) return realFetch(url, options);
    started.resolve();
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  };
  const refresh = assert.rejects(f.app.refresh(), /cancelled/);
  await started.promise;
  await f.app.disconnect();
  await refresh;
  assert.deepEqual(f.projections.at(-1), { ref: null, models: [] });
});

test('terminal refresh failures clear credentials and preserve the registered client for sign-in', async t => {
  const f = await fixture(t);
  await f.app.connect();
  const { ref } = f.projections.at(-1);
  await f.store.run(async (state, save) => { state.account.tokens.expiresAt = 0; await save(); });
  f.app.fetch = async () => json({ error: 'invalid_grant' }, 400);
  await assert.rejects(f.app.access(ref, 'text-a'), /reconnect/);
  assert.equal((await f.app.status()).status, 'signedOut');
  assert.deepEqual(f.projections.at(-1), { ref: null, models: [] });
  await f.store.run(state => {
    assert.equal(state.account.tokens, null);
    assert.equal(state.account.clientId, 'client-a');
  });
});
