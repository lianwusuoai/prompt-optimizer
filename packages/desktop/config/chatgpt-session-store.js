const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const lockfile = require('proper-lockfile');

class ChatGPTSessionStore {
  constructor(userData, safeStorage) {
    this.directory = path.join(userData, 'chatgpt-subscription');
    this.file = path.join(this.directory, 'session.json');
    this.safeStorage = safeStorage;
    this.memory = null;
    this.queue = Promise.resolve();
  }

  get persistent() {
    return this.safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || this.safeStorage.getSelectedStorageBackend() !== 'basic_text');
  }

  run(action) {
    const next = this.queue.then(() => this.withLock(action));
    this.queue = next.catch(() => {});
    return next;
  }

  async exists() {
    try { await fs.access(this.file); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }

  async withLock(action) {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    // A second Electron instance may share this profile and the rotating refresh token.
    const release = await lockfile.lock(this.directory, {
      retries: { retries: 40, minTimeout: 100, maxTimeout: 1000, randomize: true },
    });
    try {
      let envelope;
      try { envelope = JSON.parse(await fs.readFile(this.file, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const isNew = !envelope;
      envelope ??= { hostId: 'urn:uuid:' + randomUUID() };
      const persistent = this.persistent;
      let data = persistent && envelope.sealed
        ? JSON.parse(this.safeStorage.decryptString(Buffer.from(envelope.sealed, 'base64')))
        : this.memory;
      data ??= { version: 0, account: null, catalog: null, welcomedSubjects: [] };
      const persistEnvelope = async () => {
        const tmp = this.file + '.' + randomUUID() + '.tmp';
        try {
          await fs.writeFile(tmp, JSON.stringify(envelope), { mode: 0o600, flag: 'wx' });
          await fs.rename(tmp, this.file);
        } finally {
          await fs.rm(tmp, { force: true });
        }
      };
      const save = async () => {
        if (persistent) {
          envelope.sealed = this.safeStorage.encryptString(JSON.stringify(data)).toString('base64');
        } else {
          this.memory = data;
          delete envelope.sealed;
        }
        await persistEnvelope();
      };
      if (isNew) await persistEnvelope();
      return await action(data, save, envelope.hostId);
    } finally {
      await release();
    }
  }
}

module.exports = { ChatGPTSessionStore };
