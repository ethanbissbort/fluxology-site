/**
 * Concurrency and rate limiting (SDD §18, §20).
 *
 * Three independent controls:
 *   - a global cap on active tool executions;
 *   - a per-category write gate, so Office, Deals and Jobs proceed in parallel
 *     with each other but never against themselves;
 *   - per-subject read and write rate limits.
 */

/** Counting semaphore with a bounded wait. */
export function createSemaphore(max) {
  let active = 0;
  const waiters = [];

  function next() {
    if (!waiters.length || active >= max) return;
    const waiter = waiters.shift();
    clearTimeout(waiter.timer);
    active += 1;
    waiter.resolve(release);
  }

  function release() {
    if (active > 0) active -= 1;
    next();
  }

  /**
   * @returns {Promise<() => void>} a release function
   * @throws {Error} with `code === 'ACQUIRE_TIMEOUT'` if the wait expires
   */
  function acquire(timeoutMs) {
    if (active < max) {
      active += 1;
      return Promise.resolve(release);
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        const err = new Error('timed out waiting for a slot');
        err.code = 'ACQUIRE_TIMEOUT';
        reject(err);
      }, timeoutMs);
      // Deliberately not unref'd: an unreferenced timer can be skipped when the
      // loop would otherwise be idle, which would turn a bounded wait into an
      // unbounded one. The wait is short and always cleared.
      waiters.push(waiter);
    });
  }

  return {
    acquire,
    get active() {
      return active;
    },
    get waiting() {
      return waiters.length;
    },
    get capacity() {
      return max;
    },
    /** Non-blocking check used by the HTTP layer to shed load with a 429. */
    get saturated() {
      return active >= max;
    },
  };
}

/** One semaphore per dashboard scope, sized by configuration. */
export function createScopeGates(scopes, maxPerScope) {
  const gates = new Map(scopes.map(scope => [scope, createSemaphore(maxPerScope)]));
  return {
    acquire(scope, timeoutMs) {
      const gate = gates.get(scope);
      if (!gate) throw new Error(`unknown scope ${scope}`);
      return gate.acquire(timeoutMs);
    },
    stats() {
      return Object.fromEntries([...gates].map(([scope, gate]) => [scope, { active: gate.active, waiting: gate.waiting }]));
    },
  };
}

/**
 * Fixed-window rate limiter keyed by authenticated subject.
 * Windows are per key *and* per bucket name so reads cannot starve writes.
 */
export function createRateLimiter({ windowMs = 60_000, maxKeys = 10_000 } = {}) {
  const windows = new Map();

  function prune(now) {
    if (windows.size <= maxKeys) return;
    for (const [key, entry] of windows) {
      if (entry.resetAt <= now) windows.delete(key);
      if (windows.size <= maxKeys) break;
    }
    // Still oversized: drop the oldest entries outright rather than grow forever.
    if (windows.size > maxKeys) {
      const excess = windows.size - maxKeys;
      let removed = 0;
      for (const key of windows.keys()) {
        windows.delete(key);
        if (++removed >= excess) break;
      }
    }
  }

  /**
   * @returns {{allowed: boolean, remaining: number, retryAfterSeconds: number}}
   */
  function consume(bucket, key, limit, now = Date.now()) {
    const mapKey = `${bucket}:${key}`;
    let entry = windows.get(mapKey);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      windows.set(mapKey, entry);
      prune(now);
    }
    entry.count += 1;
    const allowed = entry.count <= limit;
    return {
      allowed,
      remaining: Math.max(0, limit - entry.count),
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  return { consume, get size() { return windows.size; } };
}
