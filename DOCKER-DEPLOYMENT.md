# Docker + Apache Deployment Guide

Self-hosted deployment guide for the Fluxology website as a Docker container
served by Apache HTTP Server.

> **Netlify is the primary deployment target for this site** (see
> [Netlify (Primary Target)](#netlify-primary-target) below). The Docker +
> Apache setup documented here is the **self-hosted alternative** for running
> the same static build on your own infrastructure.

## Overview

The deployment uses a **multi-stage Docker build**:

1. **Build stage** (`node:22-alpine`) builds the static Astro site.
2. **Production stage** (`httpd:2.4-alpine`) serves the built `dist/` directory.

**Technology stack:**

- Docker multi-stage build
- Apache HTTP Server 2.4 (Alpine)
- Node.js 22 (Alpine) for building — Astro 7 requires **Node >= 22.12**
- Static site output (no Node runtime in the final image)

### What the build produces

The app is a **static Astro 7 build**. There is no server-side runtime in
production — Apache serves plain files from `dist/`.

- Minification is handled by Vite/terser (JS) and lightningcss (CSS). There is
  **no `astro-compress` integration** (it was removed in the overhaul).
- Fonts are self-hosted at build time via `astro:fonts`. **The build needs
  outbound network access to Google Fonts** so it can download and emit the
  font files into `dist/`. There are no manually committed font files to copy.

> **Plaintext HTTP by design.** The container serves **plaintext HTTP on port
> 80**. When exposed to an untrusted network it **must sit behind a TLS
> terminator** (reverse proxy or load balancer) that handles HTTPS, HSTS, and
> the HTTP→HTTPS redirect. The commented-out `:443` vhost and HSTS header can
> be enabled instead, but only with real certificates. See
> [HTTPS / TLS](#https--tls).

## Quick Start

### Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- ~2 GB free disk space
- Outbound internet access during build (npm registry + Google Fonts)

### Start the container

```bash
# Build and start in detached mode
docker-compose up -d --build

# View logs
docker-compose logs -f

# Stop the container
docker-compose down
```

The site is served at **http://localhost** (or `http://localhost:${HTTP_PORT}`
if you override the port).

## File Structure

```
fluxology-site/
├── Dockerfile                  # Multi-stage build (node:22-alpine → httpd:2.4-alpine)
├── docker-compose.yml          # Container orchestration
├── .dockerignore               # Build-context exclusions (incl. all .env files)
├── .env.example                # Sample environment variables
├── netlify.toml                # Netlify (primary) build + headers config
├── docker/
│   └── apache/
│       ├── httpd.conf          # Main Apache config (headers, caching, brotli/gzip)
│       └── vhost.conf          # Virtual host config (:80 active, :443 commented)
└── logs/
    └── apache/                 # Apache logs (bind-mounted from the container)
```

## Configuration

### Environment variables

Copy `.env.example` to `.env` and adjust as needed:

```bash
cp .env.example .env
```

`docker-compose.yml` consumes exactly these variables (with the defaults shown):

| Variable       | Default             | Purpose                                             |
| -------------- | ------------------- | --------------------------------------------------- |
| `HTTP_PORT`    | `80`                | Host port mapped to the container's port 80         |
| `SERVER_NAME`  | `localhost`         | Passed to the container as `APACHE_SERVER_NAME`     |
| `SERVER_ADMIN` | `admin@fluxology.ca`| Passed as `APACHE_SERVER_ADMIN`                     |
| `TIMEZONE`     | `America/Toronto`   | Passed as `TZ` (container timezone)                 |

> `.env.example` also lists several forward-looking variables (`HTTPS_PORT`,
> `APACHE_LOG_LEVEL`, `ENABLE_HSTS`, `COMPRESSION_LEVEL`, database/SMTP/SSL
> placeholders, etc.). These are **not wired into `docker-compose.yml` or the
> Apache config** — the effective Apache behavior (log level `warn`, gzip
> level `6`, no HSTS) is baked into `docker/apache/httpd.conf`. Treat those
> extra keys as documentation/placeholders, not live settings.

**Change the port** — if port 80 is in use:

```bash
# in .env
HTTP_PORT=8080
```

Then access the site at http://localhost:8080. The mapping is
`"${HTTP_PORT:-80}:80"`, so only the host side changes.

> **Secrets never enter the build context.** `.dockerignore` excludes `.env`,
> `.env.*`, and `*.env` (keeping only `.env.example`), alongside
> `node_modules`, `.git`, `dist`, `.astro`, docs, and CI files. The `COPY . .`
> in the Dockerfile therefore never copies real environment files into the
> image.

### Apache configuration

**Main config:** `docker/apache/httpd.conf`

- brotli compression (`mod_brotli`, quality 5) with gzip (`mod_deflate`, level 6) fallback
- caching / `Expires` headers (`mod_expires`, `mod_headers`)
- security headers (see [Security](#security))
- SPA-style rewrite to `index.html` for non-existent paths
- `ServerTokens Prod` / `ServerSignature Off` at global scope

**Virtual host:** `docker/apache/vhost.conf`

- Active HTTP virtual host on port 80
- HTTPS (`:443`) virtual host and HTTP→HTTPS redirect are present but
  **commented out** — enable them only with real SSL certificates

> **Not enabled, on purpose:** `mod_status` (`/server-status`) and
> `mod_autoindex` directory listings are **not loaded**. This is a static site
> with no monitoring consumer, so removing them reduces attack surface.

## Building & Running

### Option 1: Docker Compose (recommended)

```bash
# Build and start
docker-compose up -d --build

# View status
docker-compose ps

# Follow logs for the service
docker-compose logs -f fluxology-web

# Restart
docker-compose restart

# Stop and remove
docker-compose down
```

The Compose service is named **`fluxology-web`**; the running container is
named **`fluxology-website`**; the image is tagged **`fluxology-site:latest`**;
the network is **`fluxology-network`** (bridge). Restart policy is
`unless-stopped`.

### Option 2: Plain Docker

```bash
# Build image
docker build -t fluxology-site:latest .

# Run container
docker run -d \
  --name fluxology-website \
  -p 80:80 \
  --restart unless-stopped \
  fluxology-site:latest

# View logs
docker logs -f fluxology-website

# Stop / remove
docker stop fluxology-website
docker rm fluxology-website
```

### How the build works

The builder stage runs:

```dockerfile
RUN npm ci --ignore-scripts   # installs ALL deps (dev deps needed for the build)
RUN npm run build             # astro build → /app/dist
```

Notes:

- `npm ci` installs **all dependencies, not just production ones** — the build
  needs devDependencies such as `terser`, `sharp`, and `typescript`.
- `--ignore-scripts` hardens the install. The toolchain ships native binaries
  via `optionalDependencies`, not lifecycle scripts, so the build still works.
- The production stage copies `/app/dist` into
  `/usr/local/apache2/htdocs/` and sets `www-data:www-data` ownership with
  `755` permissions. Only this final stage ends up in the image.

## Health Check

Both the image and Compose define a health check (they use slightly different
timings):

**Dockerfile `HEALTHCHECK`:**

```
--interval=30s --timeout=3s --start-period=5s --retries=3
CMD curl -f http://localhost/ || exit 1
```

**docker-compose.yml `healthcheck`:**

```
test: ["CMD", "curl", "-f", "http://localhost/"]
interval: 30s
timeout: 10s
retries: 3
start_period: 40s
```

Check the status:

```bash
docker inspect --format='{{.State.Health.Status}}' fluxology-website
# → healthy
```

## Monitoring

### Logs

```bash
# All logs
docker-compose logs -f

# Last 100 lines
docker-compose logs --tail=100 -f

# Specific service
docker-compose logs -f fluxology-web
```

Apache writes access/error logs to the container's stdout/stderr
(`/proc/self/fd/1` and `/proc/self/fd/2`), and `docker-compose.yml`
bind-mounts `./logs/apache` to `/usr/local/apache2/logs`.

> There is **no `/server-status` endpoint** — `mod_status` is deliberately not
> loaded. Use `docker logs` / `docker stats` for observability.

### Container stats

```bash
docker stats fluxology-website
docker stats --no-stream fluxology-website
```

## Security

### HTTP security headers

Set in `docker/apache/httpd.conf` (mirrored in `netlify.toml`):

- **Content-Security-Policy:**
  `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'`
- **X-Frame-Options:** `SAMEORIGIN`
- **X-Content-Type-Options:** `nosniff`
- **X-XSS-Protection:** `0` — the legacy XSS auditor is **intentionally
  disabled**; CSP is the real XSS defense.
- **Referrer-Policy:** `strict-origin-when-cross-origin`
- **Permissions-Policy:** `geolocation=(), microphone=(), camera=()`

Additionally:

- `Header always unset X-Powered-By`
- `ServerTokens Prod` and `ServerSignature Off` are set at **global scope**
  (they apply even if `mod_headers` is not loaded), so the `Server` header
  reports `Apache` with no version and no signature footer.

### HSTS

HSTS is **commented out** in `httpd.conf` because the container serves
plaintext HTTP:

```apache
# Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
```

Only enable it once TLS terminates in front of (or inside) the container.
On Netlify, HSTS **is** sent, because Netlify is always HTTPS.

### HTTPS / TLS

The container itself listens only on plaintext port 80. To serve HTTPS you have
two options:

**Recommended — terminate TLS upstream.** Put the container behind a reverse
proxy or load balancer (nginx, Caddy, Traefik, an ALB, Cloudflare, etc.) that
handles certificates, HSTS, and the HTTP→HTTPS redirect. Keep publishing only
port 80 to that proxy. `docker-compose.yml` documents this requirement:

```yaml
# NOTE: this container serves plaintext HTTP on port 80 by design. When
# exposed to an untrusted network it MUST sit behind a TLS terminator
# (reverse proxy / load balancer) that handles HTTPS, HSTS, and the
# HTTP->HTTPS redirect. Do not publish it directly to the internet.
```

**Alternative — terminate TLS inside Apache.** This requires real certificates
and code changes:

1. Obtain certificates (Let's Encrypt, commercial CA, etc.).
2. Mount them into the container — uncomment the SSL volume in
   `docker-compose.yml`:
   ```yaml
   # - ./docker/ssl:/etc/ssl/certs:ro
   ```
   and publish port 443.
3. Uncomment the `<VirtualHost *:443>` block (and, if desired, the HTTP→HTTPS
   redirect vhost) in `docker/apache/vhost.conf`, pointing the
   `SSLCertificateFile` / `SSLCertificateKeyFile` directives at your certs.
4. Uncomment the HSTS header in `docker/apache/httpd.conf`.
5. Note that the current `httpd.conf` does **not** load `mod_ssl`; you must add
   its `LoadModule` line before the `:443` vhost will work.
6. Rebuild and restart: `docker-compose up -d --build`.

## Performance

### Caching strategy (from `httpd.conf`)

- **HTML:** `Cache-Control: no-cache, no-store, must-revalidate` (always fresh).
- **CSS / JS:** `Cache-Control: public, max-age=31536000, immutable`
  (safe because Astro emits content-hashed filenames).
- **Images:** `public, max-age=31536000, immutable`.
- **Fonts:** `public, max-age=31536000, immutable` plus
  `Access-Control-Allow-Origin: *`.
- **`service-worker.js`:** `no-cache, no-store, must-revalidate`.

### Compression

The server negotiates compression by the request's `Accept-Encoding`:

- **Brotli** (`mod_brotli`, quality **5**) is served to clients that advertise
  `br` — the preferred, higher-ratio codec.
- **gzip** (`mod_deflate`, level **6**) is the fallback for clients that only
  support `gzip`.

Both filters target text-based responses (HTML, CSS, JS, SVG, JSON, XML, and
legacy font formats); already-compressed `woff2` fonts and raster images are
omitted, and `Vary: Accept-Encoding` is set for correct caching. The
`mod_brotli` load is guarded with `<IfFile>`, so if a future base image ships
without `mod_brotli.so`, Apache still starts and falls back to gzip. The
official `httpd:2.4-alpine` image includes `mod_brotli.so`.

### Image size

- Builder stage: large (Node + full dependency tree) but discarded.
- Final image: small (`httpd:2.4-alpine` + static `dist/`). Only the
  production stage ships.

## Troubleshooting

### Container won't start

```bash
# Is the port already in use?
sudo lsof -i :80         # or your HTTP_PORT

# Use a different host port in .env
HTTP_PORT=8080

# Inspect logs
docker-compose logs fluxology-web
```

### Build fails

```bash
# Rebuild without cache
docker-compose build --no-cache

# Check disk space
df -h
```

Common build-time causes:

- **No outbound network access.** The build downloads npm packages and, via
  `astro:fonts`, Google Fonts. A restricted network breaks the build.
- **Wrong Node version locally.** If you build outside Docker, you need
  **Node >= 22.12** (the Dockerfile pins `node:22-alpine`).

### Site not loading

```bash
# Container running?
docker ps

# Health status
docker inspect fluxology-website | grep -A 5 Health

# Shell into the container and test Apache
docker exec -it fluxology-website sh
curl http://localhost/
```

### Apache config checks

```bash
# Validate the running config
docker exec fluxology-website httpd -t

# View the active config
docker exec fluxology-website cat /usr/local/apache2/conf/httpd.conf
```

### Permission errors

```bash
docker exec fluxology-website ls -la /usr/local/apache2/htdocs/
# The Dockerfile already sets www-data:www-data ownership with 755 perms.
```

## Updating

### Update the site

```bash
# 1. Change source code
# 2. Rebuild and restart
docker-compose up -d --build
```

### Update base images

```bash
docker pull node:22-alpine
docker pull httpd:2.4-alpine
docker-compose build --no-cache
docker-compose up -d
```

## Netlify (Primary Target)

Netlify is the **primary hosting target** for this site; Docker + Apache is the
self-hosted alternative described above. Configuration lives in `netlify.toml`:

- **Build command:** `npm run build`
- **Publish directory:** `dist`
- **`NODE_VERSION`:** `22`
- **Security headers** applied to `/*` mirror the Apache config (same CSP,
  `X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection: 0`,
  `Referrer-Policy`, `Permissions-Policy`) **plus** HSTS
  (`Strict-Transport-Security = "max-age=31536000; includeSubDomains"`), which
  is safe because **Netlify always serves over HTTPS**.
- **Caching:** `/_assets/*` is `public, max-age=31536000, immutable`;
  `/service-worker.js` is `no-cache, no-store, must-revalidate`.

> **Netlify Forms caveat.** The contact form relies on **Netlify Forms**, which
> only works when the site is hosted on Netlify. On the Docker + Apache
> deployment there is no form back end — Apache serves static files only — so
> form submissions will not be captured there. Use an alternative form handler
> (or a small backend) if you self-host and need the contact form to work.

## Additional Resources

- [Apache HTTP Server 2.4 Documentation](https://httpd.apache.org/docs/2.4/)
- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Astro Documentation](https://docs.astro.build/)
- [Netlify Configuration Docs](https://docs.netlify.com/configure-builds/file-based-configuration/)

---

**Status:** Static Astro 7 build, served by Apache 2.4 (self-hosted) or Netlify
(primary). Plaintext HTTP in the container — put a TLS terminator in front for
any untrusted network.
