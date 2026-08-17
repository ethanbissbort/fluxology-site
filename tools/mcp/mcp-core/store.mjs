/**
 * Persistence: append-only JSONL ledgers + atomic JSON snapshots (SDD v2 §A2).
 *
 * Ledgers are the source of truth; entity state is a fold over events.
 * Snapshots are derived artifacts (dashboard builds, caches) written via
 * tmp-file + rename so readers never observe partial writes.
 *
 * The store also owns the delivery-safety rule (SDD v2 §0.8 / audit A11):
 * the data root must live OUTSIDE the delivered package directory, because the
 * package ships inside a web-served `public/` tree.
 */
import fs from 'node:fs';
import path from 'node:path';

export class DataDirUnsafeError extends Error {
  constructor(dataDir, packageDir) {
    super(
      `DATA_DIR_UNSAFE: refusing data root "${dataDir}" inside the delivered package "${packageDir}". ` +
        'The package directory is web-served; set FLUXOLOGY_*_DATA_DIR to a location outside it.',
    );
    this.code = 'DATA_DIR_UNSAFE';
  }
}

export function assertSafeDataRoot(dataDir, packageDir) {
  const resolvedData = path.resolve(dataDir);
  const resolvedPkg = path.resolve(packageDir);
  if (resolvedData === resolvedPkg || resolvedData.startsWith(resolvedPkg + path.sep)) {
    throw new DataDirUnsafeError(resolvedData, resolvedPkg);
  }
  return resolvedData;
}

export class Store {
  constructor(rootDir) {
    this.root = path.resolve(rootDir);
    fs.mkdirSync(path.join(this.root, 'ledgers'), { recursive: true });
    fs.mkdirSync(path.join(this.root, 'snapshots'), { recursive: true });
    fs.mkdirSync(path.join(this.root, 'locks'), { recursive: true });
    fs.mkdirSync(path.join(this.root, 'evidence'), { recursive: true });
  }

  ledgerPath(name) {
    if (!/^[a-z0-9_-]+$/.test(name)) throw new Error(`bad ledger name: ${name}`);
    return path.join(this.root, 'ledgers', `${name}.jsonl`);
  }

  appendEvent(ledger, event) {
    const line = JSON.stringify(event);
    if (line.includes('\n')) throw new Error('ledger events must serialize to a single line');
    fs.appendFileSync(this.ledgerPath(ledger), line + '\n', 'utf8');
    return event;
  }

  readEvents(ledger, filter) {
    const file = this.ledgerPath(ledger);
    if (!fs.existsSync(file)) return [];
    const events = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // a torn trailing line from a crash is skipped, never repaired in place
      }
      if (!filter || filter(parsed)) events.push(parsed);
    }
    return events;
  }

  writeSnapshot(name, value) {
    if (!/^[a-z0-9._-]+$/.test(name)) throw new Error(`bad snapshot name: ${name}`);
    const file = path.join(this.root, 'snapshots', `${name}.json`);
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
    return file;
  }

  readSnapshot(name) {
    const file = path.join(this.root, 'snapshots', `${name}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  /** Store raw evidence bytes addressed by content hash; returns the relative path. */
  writeEvidence(hashHex, content) {
    const file = path.join(this.root, 'evidence', `${hashHex}.bin`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, content);
    return path.relative(this.root, file);
  }

  /**
   * Atomic single-winner acquisition: `wx` creation is atomic at the filesystem
   * level, so exactly one concurrent caller wins. Used for approval consumption
   * and submit-once idempotency (SDD v2 §0.7, §A11, §B3).
   */
  acquireLock(name, payload = {}) {
    if (!/^[a-z0-9._-]+$/.test(name)) throw new Error(`bad lock name: ${name}`);
    const file = path.join(this.root, 'locks', `${name}.lock`);
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeSync(fd, JSON.stringify({ ...payload, pid: process.pid, at: new Date().toISOString() }));
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if (err.code === 'EEXIST') return false;
      throw err;
    }
  }

  hasLock(name) {
    return fs.existsSync(path.join(this.root, 'locks', `${name}.lock`));
  }
}
