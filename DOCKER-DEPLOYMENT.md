# Docker + Apache Reference

Reference for the **container stack** that serves the Fluxology website: what
each image contains, how the Apache origin is configured, and how to diagnose it.

> **This is not the deployment procedure.** For taking a fresh VPS to a live
> site — DNS, certificates, first deploy, reading contact form inquiries,
> backups, enabling email, troubleshooting — follow
> **[`docs/DEPLOYMENT-VPS.md`](./docs/DEPLOYMENT-VPS.md)**, the single
> authoritative operator guide. This document covers the container internals it
> deliberately does not repeat.

## Overview

The site is self-hosted on the owner's own VPS. Three containers, orchestrated
by `docker-compose.yml` (Compose project name `fluxology`):

| Compose service | Container name          | Image                                    | Listens | Published |
| --------------- | ----------------------- | ---------------------------------------- | ------- | --------- |
| `caddy`         | `fluxology-caddy`       | `caddy:2-alpine`                         | 80, 443 | **yes** — 80/tcp, 443/tcp, 443/udp |
| `apache`        | `fluxology-apache`      | `fluxology-site:latest` (built here)     | 6080    | no        |
| `contact-api`   | `fluxology-contact-api` | `fluxology-contact-api:latest` (built)   | 8081    | no        |

Caddy terminates TLS, obtains Let's Encrypt certificates, and reverse-proxies
`/api/*` to `contact-api` and everything else to `apache`. **Apache and
contact-api publish no host ports** — they exist only on the internal
`fluxology-network` bridge, so `curl localhost:6080` on the VPS does not work by
design. That removes the plaintext bypass around TLS and HSTS.

Named volumes: `caddy_data` (ACME account + certificates), `caddy_config`
(Caddy's autosaved JSON), `inquiry_data` (the contact form's JSONL log). With
the project name they appear as `fluxology_caddy_data`, `fluxology_caddy_config`
and `fluxology_inquiry_data`.

### What the build produces

The site is a **static Astro 7 build**. There is no server-side runtime for the
site itself — Apache serves plain files.

- Minification is handled by Vite/terser (JS) and lightningcss (CSS). There is
  **no `astro-compress` integration** (it was removed in the overhaul).
- Fonts are self-hosted at build time via `astro:fonts`. **The build needs
  outbound network access to Google Fonts** so it can download and emit the font
  files into `dist/`. There are no manually committed font files to copy.
- The only Node process in production is the small `contact-api` service, which
  handles the contact form. It is documented in
  [`services/contact-api/README.md`](./services/contact-api/README.md).

## File structure

```
fluxology-site/
├── Dockerfile                  # Static site: multi-stage (node:22-alpine → httpd:2.4-alpine)
├── docker-compose.yml          # The three-service stack
├── .dockerignore               # Build-context exclusions (incl. all .env files, dist/)
├── .env.example                # Every variable docker-compose.yml consumes
├── caddy/
│   └── Caddyfile               # Edge: TLS, redirects, /api/* routing, sub-site template
├── docker/
│   └── apache/
│       ├── httpd.conf          # Main Apache config (mod_remoteip, headers, caching, brotli/gzip)
│       └── vhost.conf          # The single internal :6080 vhost
└── services/
    └── contact-api/            # Contact form service (own Dockerfile, own package.json)
```

All three services log to the container's stdout/stderr — there is no log
directory and no bind mount; read them with `docker compose logs`. Compose
rotates each service's JSON log file at 10 MB × 3.

## Environment variables

Copy `.env.example` to `.env` only if you need to change a default — the stack
starts correctly with no `.env` at all.

```bash
cp .env.example .env
chmod 600 .env
```

`docker-compose.yml` consumes exactly these:

| Variable               | Default             | Purpose                                                  |
| ---------------------- | ------------------- | -------------------------------------------------------- |
| `HTTP_PORT`            | `80`                | Host port mapped to **Caddy's** port 80                   |
| `HTTPS_PORT`           | `443`               | Host port mapped to **Caddy's** port 443 (tcp + udp)      |
| `TIMEZONE`             | `America/Toronto`   | Passed as `TZ` to all three containers                    |
| `RATE_LIMIT_MAX`       | `5`                 | contact-api: submissions per IP per window                |
| `RATE_LIMIT_WINDOW_MS` | `900000`            | contact-api: window length (15 minutes)                   |
| `MAX_BODY_BYTES`       | `32768`             | contact-api: request body cap                             |
| `SMTP_HOST`            | *(unset)*           | contact-api: **the email on/off switch** — unset = log-only |
| `SMTP_PORT`            | `587`               | contact-api                                               |
| `SMTP_SECURE`          | `false`             | contact-api: `true` only for implicit TLS on 465          |
| `SMTP_USER` / `SMTP_PASS` | *(unset)*        | contact-api: omit both for an unauthenticated relay       |
| `MAIL_TO`              | `info@fluxology.ca` | contact-api: inquiry destination                          |
| `MAIL_FROM`            | *(falls back to `MAIL_TO`)* | contact-api: envelope sender                     |

Everything else (Apache tuning, cache behavior, compression level, `ServerName`
/ `ServerAdmin`, HSTS) is baked into `docker/apache/httpd.conf` and
`caddy/Caddyfile`.

> **`HTTP_PORT` changed meaning.** It used to publish **Apache** on the host
> (`HTTP_PORT=6080`). It now publishes **Caddy's** HTTP port. Delete any stale
> `HTTP_PORT=6080` from an existing `.env`: a wrong value moves the public
> entrypoint off port 80, which breaks the HTTP→HTTPS redirect *and* the ACME
> HTTP-01 challenge, so no certificate is ever issued. Leave both ports at
> 80/443 unless something upstream still maps them.

> **Secrets never enter the build context.** `.dockerignore` excludes `.env`,
> `.env.*`, and `*.env` (keeping only `.env.example`), alongside `node_modules`,
> `.git`, `dist`, `.astro`, docs, and CI files. The `COPY . .` in the Dockerfile
> therefore never copies real environment files into the image.

## How the static-site image is built

The root `Dockerfile` is a multi-stage build:

```dockerfile
FROM node:22-alpine AS builder
RUN npm ci --ignore-scripts   # installs ALL deps (dev deps needed for the build)
RUN npm run build             # astro build → /app/dist, then the postbuild hook

FROM httpd:2.4-alpine
COPY docker/apache/httpd.conf /usr/local/apache2/conf/httpd.conf
COPY docker/apache/vhost.conf /usr/local/apache2/conf/extra/vhost.conf
COPY --from=builder /app/dist /usr/local/apache2/htdocs/
```

Notes:

- **`dist/` is copied into the image, not mounted.** `.dockerignore` excludes
  `dist`, so whatever sits in the host's `dist/` is irrelevant — the site is
  always compiled from the source in the build context. **Content changes
  therefore require a rebuild** (`docker compose up -d --build`), not just a
  restart.
- `npm ci` installs **all dependencies, not just production ones** — the build
  needs devDependencies such as `terser`, `typescript`, `sharp` (astro:assets
  image processing), and `@astrojs/sitemap`.
- `npm run build` also triggers the npm **`postbuild`** hook, which
  terser-minifies `dist/service-worker.js` and prunes unreferenced image
  originals from `dist/_assets` before the production stage copies `dist/`.
- `--ignore-scripts` hardens the install. The toolchain ships native binaries via
  `optionalDependencies`, not lifecycle scripts, so the build still works.
- The production stage sets `www-data:www-data` ownership with `755` permissions
  on the document root. Only that final stage ships.

The contact-api image is built separately from `services/contact-api/Dockerfile`
(`node:22-alpine`, `npm ci --omit=dev`, runs as the non-root `node` user,
`EXPOSE 8081`, `HEALTHCHECK` via Node's built-in `fetch`). See its README.

## Apache configuration

Apache runs as an **internal origin behind Caddy**, not as an edge server.

**Main config:** `docker/apache/httpd.conf`

- `Listen 6080` — internal only; Caddy reaches it as `apache:6080`.
- **`mod_remoteip`** with `RemoteIPHeader X-Forwarded-For` and
  `RemoteIPInternalProxy` for the private ranges, so logs and access decisions
  see the real visitor rather than Caddy's container address.
- `ServerName https://fluxology.ca` with `UseCanonicalName On`, so
  self-referential redirects (most commonly `mod_dir`'s trailing-slash redirect)
  come back as `https://` instead of bouncing visitors out of TLS.
- brotli compression (`mod_brotli`, quality 5) with gzip (`mod_deflate`, level 6)
  fallback.
- caching / `Expires` headers (`mod_expires`, `mod_headers`).
- security headers (see [Security](#security)).
- Real 404s: unknown paths return HTTP 404 with the branded `/404.html` (the old
  SPA rewrite to `index.html` produced soft-404s and was removed).
- `ServerTokens Prod` / `ServerSignature Off` at global scope.
- **No `mod_ssl`, no certificates, no HSTS.** Caddy owns TLS and is the single
  emitter of `Strict-Transport-Security`.

**Virtual host:** `docker/apache/vhost.conf`

- Exactly one vhost, on the internal port 6080, speaking plain HTTP.
- There is **no `:443` vhost and no HTTP→HTTPS redirect vhost.** The previously
  commented-out versions were deleted: Apache is unreachable except through
  Caddy, which already terminates TLS and performs the redirect, and the old SSL
  block carried a second `Strict-Transport-Security` header that would have
  produced a duplicate the moment anyone uncommented it.

**Access log format:** `proxy_combined` (defined in `httpd.conf`) — same fields
as `combined`, except the first column is `%a` (the client IP as corrected by
`mod_remoteip`) with `peer=%{c}a` appended so a misconfigured proxy chain is
still diagnosable. The raw `X-Forwarded-For` is deliberately not logged;
`mod_remoteip` consumes it, so that field would always render as `-`.

> **Not enabled, on purpose:** `mod_status` (`/server-status`) and
> `mod_autoindex` directory listings are **not loaded**. This is a static site
> with no monitoring consumer, so removing them reduces attack surface.

## Caddy configuration

`caddy/Caddyfile` is bind-mounted read-only into the container at
`/etc/caddy/Caddyfile`. Highlights:

- Automatic HTTPS for `fluxology.ca` and `www.fluxology.ca`; `www` 301s to the
  apex over HTTPS, preserving path and query; `http://` → `https://` is
  automatic.
- A `(site-defaults)` snippet holding `encode zstd gzip`, the single HSTS header
  (`max-age=31536000; includeSubDomains`, no `preload`), `X-Content-Type-Options`,
  `-Server`, and access logging — imported by every site block so additional
  hostnames inherit identical behavior.
- `handle /api/*` → `reverse_proxy contact-api:8081` with the `/api` prefix
  intact (`handle`, not `handle_path`), a 64 KB `request_body max_size` guard
  outside the service's own 32 KB limit, active health checks against
  `/api/health`, and `Cache-Control: no-store`.
- `handle` (everything else) → `reverse_proxy apache:6080`, rewriting any
  `http://` `Location` an upstream redirect emits so a client is never
  downgraded.
- Global timeouts (`read_header`/`read_body` 10s, `write` 30s, `idle` 2m) and
  `max_header_size 32KB`.
- A commented **sub-site template** (four variants) and local-testing notes
  (`tls internal`, the `localhost` swap, and the staging `acme_ca` line).

Caddyfile-only edits need no rebuild — validate and hot-reload:

```bash
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose exec caddy caddy reload  --config /etc/caddy/Caddyfile
```

## Health checks

All three services define one; see `docker-compose.yml` for exact timings.

| Service       | Probe                                                        |
| ------------- | ------------------------------------------------------------ |
| `caddy`       | `wget` against the admin API at `http://127.0.0.1:2019/config/` (container-internal only, never published) |
| `apache`      | `curl -f http://localhost:6080/`                              |
| `contact-api` | Node `fetch` against `/api/health` (no HTTP client binary is installed in that image) |

The image-level `HEALTHCHECK` in the root `Dockerfile` uses the same Apache
probe with slightly different timings
(`--interval=30s --timeout=3s --start-period=5s --retries=3`).

```bash
docker compose ps
docker inspect --format='{{.State.Health.Status}}' fluxology-apache
```

`depends_on` uses **`service_started`**, not `service_healthy`, on purpose: a
broken backend must never keep the edge from starting and take the whole site
(and every future sub-site) offline.

## Monitoring

```bash
docker compose logs -f                  # everything
docker compose logs --tail=100 -f       # last 100 lines, then follow
docker compose logs -f caddy            # edge: access logs, TLS/ACME
docker compose logs -f apache           # static site: access + error
docker compose logs -f contact-api      # form service

docker stats fluxology-apache fluxology-caddy fluxology-contact-api
```

> There is **no `/server-status` endpoint** — `mod_status` is deliberately not
> loaded. Use `docker compose logs` / `docker stats` for observability.

## Security

### HTTP response headers

Set in `docker/apache/httpd.conf` for static responses:

- **Content-Security-Policy:**
  `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'`
  — the contact form is same-origin (`/api/contact` behind the same Caddy), so
  `connect-src 'self'` covers the hydrated `fetch` path and `form-action 'self'`
  covers the no-JS `<form action="/api/contact">` path and its 303 redirect. No
  third-party sources are needed, and keeping the API same-origin is what lets
  this stay at `'self'`.
- **X-Frame-Options:** `SAMEORIGIN`
- **X-Content-Type-Options:** `nosniff`
- **X-XSS-Protection:** `0` — the legacy XSS auditor is **intentionally
  disabled**; CSP is the real XSS defense.
- **Referrer-Policy:** `strict-origin-when-cross-origin`
- **Permissions-Policy:** `geolocation=(), microphone=(), camera=()`
- `Header always unset X-Powered-By`; `ServerTokens Prod` and
  `ServerSignature Off` at global scope.

Set in `caddy/Caddyfile` (`(site-defaults)`), so they cover `/api/*` responses
and every sub-site too:

- **Strict-Transport-Security:** `max-age=31536000; includeSubDomains`
- **X-Content-Type-Options:** `nosniff` (replaces rather than appends, so
  Apache's copy does not produce a duplicate)
- `-Server` — the server software is not advertised.

The contact API adds `Cache-Control: no-store`, `X-Content-Type-Options:
nosniff` and `Referrer-Policy: no-referrer` to its own responses, and emits no
CORS headers (same-origin by design).

### HSTS is emitted by Caddy and nowhere else

`Strict-Transport-Security` lives in the `(site-defaults)` snippet of
`caddy/Caddyfile`. Do **not** add it to `httpd.conf` or `vhost.conf` — Apache
never sees the TLS connection, and two layers setting it produces a duplicated
header that silently diverges the moment one is edited. Both Apache files carry
an explicit do-not-add note.

`includeSubDomains` is set, so every future `*.fluxology.ca` sub-site must be
HTTPS-only once a browser has seen the header. `preload` is deliberately **not**
set — it is very hard to undo.

### TLS

Caddy obtains and renews Let's Encrypt certificates automatically; there is
nothing to install or rotate by hand. The certificates and the ACME account key
live in the `fluxology_caddy_data` volume — **back it up, and never run
`docker compose down -v`.** See
[`docs/DEPLOYMENT-VPS.md`](./docs/DEPLOYMENT-VPS.md) for DNS prerequisites, the
staging CA, and certificate troubleshooting.

## Performance

### Caching strategy (from `httpd.conf`)

- **`/_assets/*`** (all content-hashed build output: CSS, JS, fonts, hashed
  images): `Cache-Control: public, max-age=31536000, immutable` via a
  path-scoped `LocationMatch`.
- **HTML:** `Cache-Control: no-cache, no-store, must-revalidate` plus
  `Pragma: no-cache` and `Expires: 0` (always fresh).
- **CSS / JS** (by extension): `public, max-age=31536000, immutable` — safe
  because all shipped CSS/JS is content-hashed under `/_assets/`; the only
  unhashed `.js` is `service-worker.js`, which its own rule overrides.
- **Unhashed images** (`/images/**` and root icons — favicon, apple-touch,
  `icon-*.png`, `badge-72.png`; matched by extension): `public, max-age=604800`
  (7 days), with a matching 7-day `Expires` from `mod_expires`. These live at
  stable public URLs, so a year of `immutable` would pin an old logo forever.
- **Fonts:** `public, max-age=31536000, immutable` plus
  `Access-Control-Allow-Origin: *`.
- **`.webmanifest`:** `public, max-age=3600`.
- **`service-worker.js`:** `no-cache, no-store, must-revalidate` plus
  `Service-Worker-Allowed: /`.
- **`/api/*`:** `no-store`, set by Caddy.
- **Everything else** (`robots.txt`, generated sitemap XML, …): `mod_expires`
  default of `access plus 1 month`.

### Compression

Two layers that do not fight each other:

- **Apache** negotiates by `Accept-Encoding`: **brotli** (`mod_brotli`, quality
  **5**) for clients that advertise `br`, **gzip** (`mod_deflate`, level **6**)
  otherwise. Both target text-based responses; already-compressed `woff2` fonts
  and raster images are omitted, and `Vary: Accept-Encoding` is set.
- **Caddy** adds `encode zstd gzip`, but its `encode` handler skips any response
  that already carries a `Content-Encoding`. Apache compresses first and Caddy
  passes the result through untouched — no double compression, and browsers
  still get brotli, which Caddy cannot produce on the fly.

The `mod_brotli` load is guarded with `<IfFile>`, so if a future base image ships
without `mod_brotli.so`, Apache still starts and falls back to gzip. The official
`httpd:2.4-alpine` image includes it.

### Image size

- Builder stage: large (Node + full dependency tree) but discarded.
- Final static-site image: small (`httpd:2.4-alpine` + built `dist/`).
- contact-api image: `node:22-alpine` plus one production dependency
  (`nodemailer`).

## Container-level troubleshooting

For DNS, certificates, inquiries, backups and end-to-end verification, see
[`docs/DEPLOYMENT-VPS.md`](./docs/DEPLOYMENT-VPS.md). What follows is specific to
the containers.

### A container won't start

```bash
docker compose ps
docker compose logs --tail=50 caddy

# Something else already on 80/443?
sudo ss -tulpn | grep -E ':(80|443)\b'
```

Only `caddy` binds host ports. If it fails to bind, stop or move whatever else
owns 80/443 — do not work around it by changing `HTTP_PORT` (that breaks
certificate issuance).

### Build fails

```bash
docker compose build --no-cache
df -h
```

Common causes:

- **No outbound network access.** The build downloads npm packages and, via
  `astro:fonts`, Google Fonts. A restricted network breaks the build.
- **Wrong Node version locally.** If you build outside Docker you need
  **Node >= 22.12** (the Dockerfile pins `node:22-alpine`).

### Reaching Apache or contact-api

They are not published to the host — this is intentional. Go through the
containers:

```bash
docker compose exec caddy wget -qO- http://apache:6080/ | head -n 20
docker compose exec contact-api node -e \
  "fetch('http://127.0.0.1:8081/api/health').then(r=>r.text()).then(console.log)"
```

### Apache config checks

```bash
docker compose exec apache httpd -t                                    # syntax
docker compose exec apache httpd -M                                    # loaded modules (expect remoteip_module, no ssl)
docker compose exec apache cat /usr/local/apache2/conf/httpd.conf       # active config
docker compose exec apache ls -la /usr/local/apache2/htdocs/            # www-data:www-data, 755
```

### Caddy config checks

```bash
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose exec caddy wget -qO- http://127.0.0.1:2019/config/ | head -c 400
```

## Updating

```bash
# Site content or code
git pull
docker compose up -d --build

# Caddyfile only — no rebuild needed
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile

# Base images
docker compose pull                # caddy:2-alpine
docker compose build --no-cache    # node:22-alpine, httpd:2.4-alpine
docker compose up -d
```

> **Never `docker compose down -v`.** The `-v` flag deletes the named volumes —
> every contact form inquiry ever received *and* the ACME certificates. Plain
> `docker compose down` is safe.

## Additional resources

- [`docs/DEPLOYMENT-VPS.md`](./docs/DEPLOYMENT-VPS.md) — the operator guide
- [`services/contact-api/README.md`](./services/contact-api/README.md) — the form service
- [Caddy documentation](https://caddyserver.com/docs/)
- [Apache HTTP Server 2.4 documentation](https://httpd.apache.org/docs/2.4/)
- [Docker Compose documentation](https://docs.docker.com/compose/)
- [Astro documentation](https://docs.astro.build/)

---

**Status:** Static Astro 7 build served by Apache 2.4 behind Caddy, plus a
self-hosted Node contact API — all on the owner's own VPS. Caddy is the only
process that publishes ports.
