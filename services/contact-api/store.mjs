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
    /** Records durably appended since this process started. */
    this.appendedSinceStart = 0;
  }

  /**
   * Cheap, unbounded-safe summary of the log for /api/health.
   *
   * In log-only mode (SMTP unset) this file is the ONLY record that an inquiry
   * arrived, and nothing else in the deployment surfaces it — the operator had
   * to remember to exec into the container and read it. `lastInquiryAt` makes
   * "did anything come in?" answerable from the health endpoint, and from any
   * uptime check that can assert on a JSON field.
   *
   * Deliberately derived from stat(), not from reading the file: the log is
   * append-only with no size cap, so nothing here may scale with its length.
   * A zero-byte file means the store created it at startup and nothing has
   * been written, so lastInquiryAt is null rather than the boot time.
   */
  async stats() {
    try {
      const info = await stat(this.filePath);
      return {
        bytes: info.size,
        lastInquiryAt: info.size > 0 ? new Date(info.mtimeMs).toISOString() : null,
        appendedSinceStart: this.appendedSinceStart,
      };
    } catch {
      return { bytes: 0, lastInquiryAt: null, appendedSinceStart: this.appendedSinceStart };
    }
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
      this.appendedSinceStart += 1;
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
