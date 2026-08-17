/**
 * Server-side HTTP fetcher (SDD v2 §0.9). Enforced policy, in order:
 *   1. network must be enabled by configuration;
 *   2. http(s) URLs only;
 *   3. hostname allowlist (watchlist hosts + configured extras);
 *   4. DNS resolution pinned and checked against private/loopback/link-local/
 *      metadata ranges — the checked addresses are the ones connected to,
 *      closing DNS-rebinding; re-validated on every redirect hop (max 5);
 *   5. robots.txt honored by default (refusals are recorded, not bypassed);
 *   6. response size and time caps; per-host min-interval rate limiting.
 *
 * Fetched content is DATA. Nothing in a response can alter configuration,
 * allowlists, or approval state — no code path exists from content to policy.
 */
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

const USER_AGENT = 'FluxologyOfficeMCP/2.0 (office-space research; contact: fluxology.ca/contact)';
const MAX_REDIRECTS = 5;

export function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) || // link-local + cloud metadata (169.254.169.254)
      (a === 100 && b >= 64 && b <= 127) // CGNAT
    );
  }
  const lower = address.toLowerCase();
  return (
    lower === '::1' ||
    lower === '::' ||
    lower.startsWith('fe80') ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('::ffff:127.') ||
    lower.startsWith('::ffff:10.') ||
    lower.startsWith('::ffff:192.168.')
  );
}

function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family }];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad) return callback(Object.assign(new Error(`refused private/link-local address ${bad.address} for ${hostname}`), { code: 'HOST_NOT_ALLOWED' }));
    const first = list[0];
    callback(null, first.address, first.family);
  });
}

export class Fetcher {
  constructor({ allowNetwork, allowedHosts = () => [], trustedInternalHosts = [], limits, log = () => {} }) {
    this.allowNetwork = allowNetwork;
    this.allowedHosts = allowedHosts; // callback so the watchlist stays live
    // v1 §7.4: private-network addresses are blocked "unless explicitly
    // configured for trusted internal services". Entries here skip the
    // private-address refusal — nothing else.
    this.trustedInternalHosts = new Set(trustedInternalHosts.map((h) => String(h).toLowerCase()));
    this.limits = limits;
    this.log = log;
    this.lastFetchByHost = new Map();
    this.robotsCache = new Map();
  }

  hostAllowed(hostname) {
    const host = hostname.toLowerCase();
    if (this.trustedInternalHosts.has(host)) return true;
    return this.allowedHosts().some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  }

  isTrustedInternal(hostname) {
    return this.trustedInternalHosts.has(String(hostname).toLowerCase());
  }

  /** One guarded request without redirect following. */
  rawRequest(url, { method = 'GET', headers = {}, body = null, trusted = false } = {}) {
    return new Promise((resolve) => {
      const target = new URL(url);
      const lib = target.protocol === 'https:' ? https : http;
      const request = lib.request(
        target,
        {
          method,
          headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/json;q=0.9,*/*;q=0.5', ...headers },
          ...(trusted ? {} : { lookup: guardedLookup }),
          timeout: this.limits.fetchTimeoutMs,
        },
        (response) => {
          const chunks = [];
          let size = 0;
          let truncated = false;
          response.on('data', (chunk) => {
            size += chunk.length;
            if (size > this.limits.fetchMaxBytes) {
              truncated = true;
              response.destroy();
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => resolve({ ok: true, status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8'), truncated }));
          response.on('close', () => resolve({ ok: true, status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8'), truncated }));
        },
      );
      request.on('timeout', () => {
        request.destroy(new Error('timeout'));
      });
      request.on('error', (err) => resolve({ ok: false, error: err.code === 'HOST_NOT_ALLOWED' ? 'HOST_NOT_ALLOWED' : 'SOURCE_FETCH_FAILED', detail: err.message }));
      if (body) request.write(body);
      request.end();
    });
  }

  async robotsAllows(target) {
    const origin = `${target.protocol}//${target.host}`;
    if (!this.robotsCache.has(origin)) {
      const res = await this.rawRequest(`${origin}/robots.txt`, { trusted: this.isTrustedInternal(target.hostname) });
      let rules = [];
      if (res.ok && res.status === 200 && typeof res.body === 'string') {
        rules = parseRobots(res.body);
      }
      this.robotsCache.set(origin, rules);
    }
    const rules = this.robotsCache.get(origin);
    const path = target.pathname + target.search;
    let allowed = true;
    let longest = -1;
    for (const rule of rules) {
      if (rule.path === '') continue;
      if (path.startsWith(rule.path) && rule.path.length > longest) {
        longest = rule.path.length;
        allowed = rule.allow;
      }
    }
    return allowed;
  }

  async throttle(host) {
    const last = this.lastFetchByHost.get(host) ?? 0;
    const wait = last + this.limits.fetchMinIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait + Math.floor(Math.random() * 250)));
    this.lastFetchByHost.set(host, Date.now());
  }

  /**
   * Policy-checked fetch with redirect re-validation. Returns
   * { ok, status, body, final_url, truncated } or { ok:false, error, detail }.
   */
  async fetchUrl(url, { method = 'GET', headers = {}, body = null } = {}) {
    if (!this.allowNetwork) return { ok: false, error: 'NETWORK_DISABLED', detail: 'FLUXOLOGY_OFFICE_ALLOW_NETWORK is not enabled' };

    let current;
    try {
      current = new URL(url);
    } catch {
      return { ok: false, error: 'VALIDATION_FAILED', detail: `invalid URL: ${url}` };
    }

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (current.protocol !== 'https:' && current.protocol !== 'http:') {
        return { ok: false, error: 'HOST_NOT_ALLOWED', detail: `scheme ${current.protocol} refused` };
      }
      const trusted = this.isTrustedInternal(current.hostname);
      if (!trusted && net.isIP(current.hostname) && isPrivateAddress(current.hostname)) {
        return { ok: false, error: 'HOST_NOT_ALLOWED', detail: `private address ${current.hostname} refused` };
      }
      if (!this.hostAllowed(current.hostname)) {
        return { ok: false, error: 'HOST_NOT_ALLOWED', detail: `${current.hostname} is not on the allowlist` };
      }
      if (current.pathname !== '/robots.txt' && !(await this.robotsAllows(current))) {
        return { ok: false, error: 'ROBOTS_DISALLOWED', detail: `${current.href} disallowed by robots.txt` };
      }

      await this.throttle(current.host);
      const response = await this.rawRequest(current.href, { method, headers, body, trusted });
      if (!response.ok) return response;

      if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.location) {
        current = new URL(response.headers.location, current); // next hop re-enters the full policy check
        continue;
      }
      if (response.status === 403 || response.status === 429) {
        return { ok: false, error: response.status === 429 ? 'RATE_LIMITED' : 'BROWSER_INTERVENTION_REQUIRED', detail: `HTTP ${response.status} at ${current.href}`, status: response.status, final_url: current.href };
      }
      return { ...response, final_url: current.href };
    }
    return { ok: false, error: 'SOURCE_FETCH_FAILED', detail: `redirect chain longer than ${MAX_REDIRECTS}` };
  }
}

function parseRobots(text) {
  const rules = [];
  let applies = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      applies = value === '*' || USER_AGENT.toLowerCase().includes(value.toLowerCase());
    } else if (applies && key === 'disallow') {
      rules.push({ path: value, allow: false });
    } else if (applies && key === 'allow') {
      rules.push({ path: value, allow: true });
    }
  }
  return rules;
}
