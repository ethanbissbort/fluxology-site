/**
 * JSONL inquiry store.
 *
 * One JSON object per line, appended with O_APPEND and fsync'd before the
 * caller is told the write succeeded — the contract requires the inquiry to be
 * durably on disk before we answer 200. The file is created 0600 (owner only).
 */

import { open, mkdir, chmod, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

const FILE_MODE = 0o600;

export class InquiryStore {
  /** @param {string} filePath */
  constructor(filePath) {
    this.filePath = filePath;
    /** @type {Promise<import('node:fs/promises').FileHandle> | null} */
    this._handle = null;
    /** @type {Promise<unknown>} */
    this._queue = Promise.resolve();
  }

  /**
   * Open (creating if needed) the log file. Memoised; a failed attempt is not
   * cached, so a transient problem (missing mount, permissions being fixed)
   * is retried on the next submission.
   */
  _getHandle() {
    if (!this._handle) {
      this._handle = (async () => {
        await mkdir(dirname(this.filePath), { recursive: true });
        const handle = await open(this.filePath, 'a', FILE_MODE);
        // `mode` only applies when the file is created; enforce it either way
        // so an existing world-readable file gets tightened on startup.
        try {
          const info = await handle.stat();
          if ((info.mode & 0o777) !== FILE_MODE) await chmod(this.filePath, FILE_MODE);
        } catch {
          /* best effort — the append is what matters */
        }
        return handle;
      })().catch((err) => {
        this._handle = null;
        throw err;
      });
    }
    return this._handle;
  }

  /** Verify the destination is usable. Used at startup (non-fatal) . */
  async check() {
    await this._getHandle();
    return stat(this.filePath);
  }

  /**
   * Append one record. Resolves only once the bytes are flushed to disk.
   * Writes are serialised so concurrent submissions cannot interleave.
   * @param {Record<string, unknown>} record
   */
  append(record) {
    const line = JSON.stringify(record) + '\n';
    const task = this._queue.then(
      () => this._write(line),
      () => this._write(line), // a previous failure must not poison the queue
    );
    // Keep the chain alive but never leave an unhandled rejection behind.
    this._queue = task.catch(() => {});
    return task;
  }

  async _write(line) {
    const handle = await this._getHandle();
    try {
      await handle.write(line, null, 'utf8');
      await handle.datasync();
    } catch (err) {
      // Drop the handle so the next attempt reopens from scratch.
      const stale = this._handle;
      this._handle = null;
      if (stale) stale.then((h) => h.close()).catch(() => {});
      throw err;
    }
  }

  async close() {
    const handle = this._handle;
    this._handle = null;
    if (!handle) return;
    try {
      await this._queue;
    } catch {
      /* ignore */
    }
    try {
      await (await handle).close();
    } catch {
      /* ignore */
    }
  }
}
