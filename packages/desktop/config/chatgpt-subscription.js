const { createHash } = require('node:crypto');
const { authorize, exchange, hasPlan, issue, RESOURCE, revoke, tokenSet } = require('./chatgpt-oauth');

function connectionId(account) {
  // A dynamic registration is bound to one verified account and workspace.
  return createHash('sha256').update(account.clientId).update('\0').update(account.subject).digest('hex');
}

function readCatalog(body) {
  if (!Array.isArray(body?.models)) throw issue('catalogFailed');
  const entries = new Map();
  for (const model of body.models) {
    if (!model || typeof model.visibility !== 'string') throw issue('catalogFailed');
    if (model.visibility !== 'list') continue;
    if (typeof model.slug !== 'string' || !model.slug.trim() ||
        (model.display_name != null && typeof model.display_name !== 'string')) throw issue('catalogFailed');
    if (Array.isArray(model.output_modalities) && !model.output_modalities.includes('text')) continue;
    const efforts = Array.isArray(model.supported_reasoning_levels)
      ? model.supported_reasoning_levels.map(level => level?.effort).filter(value => typeof value === 'string') : [];
    entries.set(model.slug, { slug: model.slug, name: model.display_name || model.slug, efforts,
      tools: model.supports_tools === true || model.supports_function_calling === true });
  }
  return [...entries.values()];
}

class ChatGPTSubscription {
  constructor({ store, openBrowser, syncModels, fetchImpl = fetch, signIn = authorize }) {
    this.store = store;
    this.openBrowser = openBrowser;
    this.syncModels = syncModels;
    this.fetch = fetchImpl;
    this.signIn = signIn;
    this.session = new AbortController();
    this.pending = null;
  }

  snapshot(state) {
    const account = state.account;
    return { status: !account ? 'disconnected' : !account.tokens ? 'signedOut' :
      hasPlan(account.tokens) ? 'connected' : 'needsConsent', email: account?.email || '',
      connectionRef: account?.tokens ? connectionId(account) : undefined,
      count: state.catalog?.length ?? 0, synced: Array.isArray(state.catalog),
      persistent: this.store.persistent, welcomed: state.welcomedSubjects?.includes(account?.subject) === true };
  }

  status() { return this.store.run(state => this.snapshot(state)); }

  applyCatalog(state) {
    const authorized = hasPlan(state.account?.tokens);
    return this.syncModels(authorized ? connectionId(state.account) : null, authorized ? state.catalog ?? [] : []);
  }

  async restore() {
    if (await this.store.exists()) await this.store.run(state => this.applyCatalog(state));
  }

  acknowledge() {
    return this.store.run(async (state, save) => {
      if (state.account) state.welcomedSubjects = [...new Set([...(state.welcomedSubjects || []), state.account.subject])];
      await save();
      return this.snapshot(state);
    });
  }

  cancel() { this.pending?.abort(); }

  invalidate() {
    this.session.abort();
    this.session = new AbortController();
  }

  async connect(newAccount = false) {
    this.cancel();
    const attempt = new AbortController();
    this.pending = attempt;
    const signal = AbortSignal.any([attempt.signal, AbortSignal.timeout(10 * 60 * 1000)]);
    try {
      const { account, hostId, version } = await this.store.run((state, _save, hostId) => ({
        account: newAccount ? null : state.account, hostId, version: state.version,
      }));
      const result = await this.signIn({ hostId, account, fetchImpl: this.fetch,
        openBrowser: this.openBrowser, signal });
      await this.store.run(async (state, save) => {
        if (signal.aborted || state.version !== version) throw issue('cancelled');
        const same = state.account && connectionId(state.account) === connectionId(result);
        this.invalidate();
        state.version++;
        state.account = result;
        if (!same || !hasPlan(result.tokens)) state.catalog = null;
        await save();
        await this.applyCatalog(state);
      });
      if (hasPlan(result.tokens)) return await this.refresh(signal);
      return await this.status();
    } finally {
      if (this.pending === attempt) this.pending = null;
    }
  }

  async disconnect() {
    this.cancel();
    this.invalidate();
    const old = await this.store.run(async (state, save) => {
      const account = state.account;
      state.version++;
      if (account) state.account = { ...account, tokens: null };
      state.catalog = null;
      await save();
      await this.applyCatalog(state);
      return account;
    });
    const revoked = await revoke(old, this.fetch).catch(() => false);
    return { ...await this.status(), revocationUnconfirmed: !revoked };
  }

  async token(state, save, signal) {
    const account = state.account;
    if (!account?.tokens) throw issue('reconnect');
    const old = account.tokens;
    if (!hasPlan(old)) throw issue('permissionRequired');
    if (Date.now() >= Math.max(old.expiresAt - 60000, old.earliestRefreshAt) || Date.now() >= old.expiresAt) {
      try {
        if (!old.refreshToken) throw issue('reconnect');
        const body = await exchange({ grant_type: 'refresh_token', client_id: account.clientId,
          refresh_token: old.refreshToken }, this.fetch, signal);
        account.tokens = tokenSet(body, old);
        await save();
      } catch (error) {
        if (error.message === 'chatgptSubscription.reconnect') {
          account.tokens = null;
          await save();
          await this.applyCatalog(state);
        }
        throw error;
      }
      if (!hasPlan(account.tokens)) {
        await this.applyCatalog(state);
        throw issue('permissionRequired');
      }
    }
    return account.tokens.accessToken;
  }

  async refresh(callerSignal) {
    const signals = [this.session.signal, AbortSignal.timeout(30000)];
    if (callerSignal) signals.push(callerSignal);
    const signal = AbortSignal.any(signals);
    // Serialize snapshot, catalog and projection. A late fetch cannot overwrite a newer account.
    return this.store.run(async (state, save) => {
      signal.throwIfAborted();
      const token = await this.token(state, save, signal);
      let models;
      try {
        const response = await this.fetch(RESOURCE + '/models', {
          headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal,
        });
        if (response.status === 401) throw issue('reconnect');
        if (response.status === 403) throw issue('ineligible');
        if (!response.ok) throw issue('catalogFailed');
        models = readCatalog(await response.json());
      } catch (error) {
        if (signal.aborted) throw issue('cancelled');
        if (error.code === 'chatgptSubscription.reconnect' || error.code === 'chatgptSubscription.ineligible') throw error;
        throw issue('catalogFailed');
      }
      signal.throwIfAborted();
      state.catalog = models;
      await save();
      await this.applyCatalog(state);
      return this.snapshot(state);
    });
  }

  // Only used by the in-process text adapter. Never expose this method to preload.
  access(ref, slug, callerSignal) {
    const signal = callerSignal ? AbortSignal.any([callerSignal, this.session.signal]) : this.session.signal;
    return this.store.run(async (state, save) => {
      signal.throwIfAborted();
      if (!state.account || connectionId(state.account) !== ref) throw issue('reconnect');
      const token = await this.token(state, save, AbortSignal.any([signal, AbortSignal.timeout(30000)]));
      const model = state.catalog?.find(entry => entry.slug === slug);
      if (!model) throw issue('modelUnavailable');
      signal.throwIfAborted();
      return { token, signal, model };
    });
  }
}

module.exports = { ChatGPTSubscription, readCatalog };
