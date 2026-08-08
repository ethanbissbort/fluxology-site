# VPS Deployment Guide

**This is the primary operator guide for fluxology.ca.** It takes a fresh VPS to
a live, TLS-secured site with a working contact form, and covers the day-to-day
operations that follow.

The site is **entirely self-hosted**. There is no hosting provider, no build
service, and no third-party form handler in the request path — everything runs
as containers on your own machine.

Companion documents:

- [`DOCKER-DEPLOYMENT.md`](../DOCKER-DEPLOYMENT.md) — reference for the Apache
  container itself (image internals, cache policy, compression, Apache
  troubleshooting). It does not duplicate the deploy procedure below.
- [`services/contact-api/README.md`](../services/contact-api/README.md) — the
  contact API's endpoints, fields, and full environment-variable table.

---

## Contents

1. [Architecture](#1-architecture)
2. [Prerequisites](#2-prerequisites)
3. [DNS — do this before the first start](#3-dns--do-this-before-the-first-start)
4. [First deploy](#4-first-deploy)
5. [Reading contact form inquiries](#5-reading-contact-form-inquiries)
6. [Backups](#6-backups)
7. [Enabling email later](#7-enabling-email-later)
8. [Updating the site](#8-updating-the-site)
9. [Sub-sites and the dashboard subdomains](#9-sub-sites-and-the-dashboard-subdomains)
10. [Operational warnings](#10-operational-warnings)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Architecture

Three containers, defined in `docker-compose.yml` (Compose project name:
`fluxology`):

```
                     ┌────────────────────────────────────────────┐
  internet ─────────►│  caddy        ports 80, 443, 443/udp       │
  :80 :443           │  TLS termination · Let's Encrypt · HSTS    │
                     └──────┬──────────────────────────┬──────────┘
                            │ /api/*                   │ everything else
                            ▼                          ▼
              ┌───────────────────────────┐  ┌──────────────────────────┐
              │ contact-api  :8081        │  │ apache  :6080            │
              │ Node — contact form       │  │ httpd 2.4 — static site  │
              │ → /data/inquiries.jsonl   │  │ → built dist/            │
              └───────────────────────────┘  └──────────────────────────┘
                     internal network only — no published ports
```

| Compose service | Container name           | Image                          | Listens | Published to host |
| --------------- | ------------------------ | ------------------------------ | ------- | ----------------- |
| `caddy`         | `fluxology-caddy`        | `caddy:2-alpine`               | 80, 443 | **yes** — 80/tcp, 443/tcp, 443/udp |
| `apache`        | `fluxology-apache`       | `fluxology-site:latest` (built) | 6080   | no                |
| `contact-api`   | `fluxology-contact-api`  | `fluxology-contact-api:latest` (built) | 8081 | no        |

Key points:

- **Caddy is the only process reachable from the internet.** It terminates TLS,
  obtains and renews Let's Encrypt certificates automatically, redirects
  `http://` → `https://` and `www.fluxology.ca` → `fluxology.ca`, and emits the
  single `Strict-Transport-Security` header for every hostname (defined once in
  the `(site-defaults)` snippet of `caddy/Caddyfile`).
- **Apache and contact-api publish no host ports.** They are reachable only by
  service name on the internal `fluxology-network` bridge. `curl localhost:6080`
  on the VPS will *not* work — that is intentional. See
  [Troubleshooting](#11-troubleshooting) for how to reach them.
- **Named volumes** (`fluxology_caddy_data`, `fluxology_caddy_config`,
  `fluxology_inquiry_data`) hold the ACME certificates and the inquiry log. They
  survive `docker compose down`, image rebuilds, and container recreation.

---

## 2. Prerequisites

On the VPS:

- Docker Engine with the Compose v2 plugin (`docker compose version`).
- Ports **80/tcp**, **443/tcp** and (for HTTP/3) **443/udp** open inbound in the
  firewall *and* in any cloud-provider security group. Example with ufw:

  ```bash
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw allow 443/udp
  ```

- **Nothing else listening on 80 or 443.** A host nginx/Apache, another Caddy,
  or an existing container on those ports will make `docker compose up -d` fail
  to bind. Check with `sudo ss -tulpn | grep -E ':(80|443)\b'` and stop or move
  the conflicting service first.
- Outbound internet access **during the image build**: the build pulls npm
  packages and downloads Google Fonts (Astro self-hosts them at build time via
  `astro:fonts`). A restricted egress policy breaks the build.
- Roughly 2 GB of free disk for the build.

Node is **not** required on the VPS — the site is compiled inside the Docker
build. Node ≥ 22.12 is only needed if you want to build or run the site outside
Docker (see `package.json` `engines`).

---

## 3. DNS — do this before the first start

**Get this right before the first `docker compose up`.** Caddy obtains
certificates through Let's Encrypt's **HTTP-01 challenge**, which requires that
`fluxology.ca` and `www.fluxology.ca` already resolve to this VPS and that ports
80 and 443 are publicly reachable at those names. If they do not, issuance fails
and every retry counts against Let's Encrypt's rate limits.

At the time this guide was written the apex record pointed at a **Bell Canada
residential address (`65.95.111.17`), not a VPS.** Verify the current state
before you begin:

```bash
dig +short fluxology.ca A
dig +short fluxology.ca AAAA
dig +short www.fluxology.ca A
```

Required records at the DNS host (the domain's DNS is managed at Namecheap):

| Name  | Type | Value                         |
| ----- | ---- | ----------------------------- |
| `@`   | A    | the VPS's public IPv4 address |
| `www` | A    | the VPS's public IPv4 address |
| `@`   | AAAA | the VPS's public IPv6 address — only if the VPS has one |
| `www` | AAAA | the VPS's public IPv6 address — only if the VPS has one |

Do **not** publish an AAAA record unless the VPS actually answers on that IPv6
address: Let's Encrypt prefers IPv6 when an AAAA record exists, and a stale or
wrong one makes the challenge fail even though IPv4 works.

Wait for propagation (re-run the `dig` commands from a machine that is *not* the
VPS) before continuing.

### Experimenting safely — the staging CA

Let's Encrypt's production CA enforces hard rate limits (5 duplicate
certificates per week per hostname set). While you are still testing DNS,
firewalls, or a new sub-site, issue from the **staging** CA instead: uncomment
this line in the global block at the top of `caddy/Caddyfile`:

```caddyfile
# acme_ca https://acme-staging-v02.api.letsencrypt.org/directory
```

Staging certificates are not trusted by browsers (expect a warning), but they
are effectively unlimited, so a mistake can never lock you out of the real CA.
Comment the line back out and run `docker compose restart caddy` to go live.

---

## 4. First deploy

### 4.1 Get the code

```bash
git clone https://github.com/ethanbissbort/fluxology-site.git
cd fluxology-site
```

### 4.2 Optional — build once on the host to sanity-check

This step is **not** what feeds the running site (see 4.4), but it is a fast way
to confirm the toolchain works and to preview the output before committing to a
container build. It needs Node ≥ 22.12:

```bash
node --version        # must be >= 22.12
npm ci
npm run build         # astro build -> ./dist, then the postbuild hook
npm run preview       # serve ./dist locally
```

`npm run build` automatically triggers the npm **`postbuild`** hook defined in
`package.json`, which does two things:

1. terser-minifies `dist/service-worker.js` (files in `public/` bypass Astro's
   bundler, so they are minified here instead);
2. runs `scripts/prune-unused-images.mjs`, deleting image originals in
   `dist/_assets` that no built HTML/CSS/JS references.

Invoking `astro build` directly skips that hook.

### 4.3 Environment file (optional)

The stack starts correctly **with no `.env` file at all** — every variable has a
working default. Create one only if you need to change something:

```bash
cp .env.example .env
chmod 600 .env        # it will eventually hold the SMTP password
```

`.env.example` documents every variable `docker-compose.yml` actually consumes:
`HTTP_PORT`, `HTTPS_PORT`, `TIMEZONE`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`,
`MAX_BODY_BYTES`, and the `SMTP_*` / `MAIL_*` set. Nothing else is read.

> **Upgrading from the old single-container setup?** Delete any
> `HTTP_PORT=6080` line from an existing `.env`. That variable used to publish
> Apache directly; it now sets **Caddy's** HTTP port, and a wrong value silently
> moves the edge off port 80 — which breaks both the HTTP→HTTPS redirect and the
> ACME HTTP-01 challenge, so no certificate is ever issued.

### 4.4 Build and start

```bash
docker compose up -d --build
```

This builds two images and starts three containers:

- **`fluxology-site:latest`** from the root `Dockerfile`. It is a multi-stage
  build: a `node:22-alpine` stage runs `npm ci --ignore-scripts` and
  `npm run build`, and the final `httpd:2.4-alpine` stage copies `/app/dist`
  into `/usr/local/apache2/htdocs/`.

  **This is how the built site reaches Apache — the `dist/` directory is COPIED
  into the image at build time, not bind-mounted.** `dist` is excluded by
  `.dockerignore`, so a `dist/` on the host is irrelevant to the container; the
  compiled output always comes from the source in the build context. The
  practical consequence: **after any content or code change you must rebuild the
  image** (`docker compose up -d --build`), not just restart it.

- **`fluxology-contact-api:latest`** from `services/contact-api/Dockerfile`
  (`node:22-alpine`, production deps only, runs as the non-root `node` user).

Watch it come up:

```bash
docker compose ps
docker compose logs -f caddy
```

Caddy logs its ACME work as it goes — watch for it obtaining a certificate for
both `fluxology.ca` and `www.fluxology.ca`. Errors or repeated retries here mean
DNS or port 80 is not right yet; see
[section 11.1](#111-certificate-issuance-fails).

### 4.5 Verify

```bash
# Static site over TLS
curl -sSI https://fluxology.ca/ | head -n 1

# www redirect keeps path and query
curl -sSI "https://www.fluxology.ca/orchard/?x=1" | grep -i '^location'

# plain HTTP redirects up to HTTPS
curl -sSI http://fluxology.ca/ | head -n 1

# contact API health (proxied through Caddy)
curl -s https://fluxology.ca/api/health
# {"status":"ok","emailEnabled":false,"uptimeSeconds":…}
```

`"emailEnabled": false` is the expected and correct state until SMTP is
configured — see [section 7](#7-enabling-email-later).

Then test the form end to end (section 11.5).

---

## 5. Reading contact form inquiries

**Read this section. Right now it is the only way an inquiry reaches you.**

There is no mail hosting yet, so `SMTP_HOST` is unset and the contact API runs
in **log-only mode**: every valid submission is appended to
`/data/inquiries.jsonl` (on the `fluxology_inquiry_data` volume) and fsync'd to
disk *before* the visitor is told it succeeded. No email is sent. **That file is
the only copy.** Check it regularly.

One JSON object per line (JSONL), containing `receivedAt` (ISO 8601), `ip`,
`userAgent`, and every submitted field.

```bash
cd /path/to/fluxology-site        # the directory holding docker-compose.yml

# Everything, raw
docker compose exec contact-api cat /data/inquiries.jsonl

# The 10 most recent
docker compose exec contact-api tail -n 10 /data/inquiries.jsonl

# How many inquiries have ever arrived
docker compose exec contact-api wc -l /data/inquiries.jsonl
```

Piping into `jq` on the host is much easier to read. Use `-T` so Compose does
not attach a TTY and mangle the stream:

```bash
# Pretty-print every inquiry
docker compose exec -T contact-api cat /data/inquiries.jsonl | jq .

# One line each: when, topic, who, email
docker compose exec -T contact-api cat /data/inquiries.jsonl \
  | jq -r '[.receivedAt, .serviceInterest, .fullName, .email] | @tsv'

# Just one day's, one compact object per line (adjust the date)
docker compose exec -T contact-api cat /data/inquiries.jsonl \
  | jq -c 'select(.receivedAt | startswith("2026-08-08"))'

# The newest inquiry, in full
docker compose exec -T contact-api tail -n 1 /data/inquiries.jsonl | jq .
```

If `jq` is not installed on the VPS: `sudo apt install jq` (Debian/Ubuntu) or
`sudo dnf install jq` (Fedora/RHEL).

The file is mode `0600` and owned by the container's `node` user (uid 1000).

> **Nothing in the stack notifies you on its own** while email is off. Set
> yourself a recurring reminder to check this log, or schedule the "just
> today's" command above from cron so it lands somewhere you actually read.
> Better still, work through [section 7](#7-enabling-email-later) and turn on
> email.

---

## 6. Backups

Two volumes matter. Both survive `docker compose down` — and both are destroyed
by `docker compose down -v` (see [section 10](#10-operational-warnings)).

| Volume                    | Contents                                   | Why it matters |
| ------------------------- | ------------------------------------------ | -------------- |
| `fluxology_inquiry_data`  | `/data/inquiries.jsonl`                    | The **only non-reproducible data in the stack.** Losing it loses every inquiry. |
| `fluxology_caddy_data`    | ACME account key, issued certificates, OCSP staples | Losing it forces re-issuance of every certificate and runs straight into Let's Encrypt's rate limits. |

`fluxology_caddy_config` holds Caddy's autosaved JSON config and is regenerated
from `caddy/Caddyfile`; it does not need backing up.

### Copy the inquiry log out

```bash
docker compose cp contact-api:/data/inquiries.jsonl "./inquiries-$(date +%F).jsonl"
```

### Archive a whole volume

```bash
# Inquiries
docker run --rm \
  -v fluxology_inquiry_data:/data:ro \
  -v "$PWD":/backup alpine \
  tar czf "/backup/inquiries-$(date +%F).tar.gz" -C /data .

# Caddy's certificates and ACME account
docker run --rm \
  -v fluxology_caddy_data:/data:ro \
  -v "$PWD":/backup alpine \
  tar czf "/backup/caddy-data-$(date +%F).tar.gz" -C /data .
```

(The `fluxology_` prefix comes from the `name: fluxology` line at the top of
`docker-compose.yml`. Confirm the real names with `docker volume ls`.)

Copy the archives **off the VPS**. A daily cron entry is enough:

```cron
15 3 * * * cd /path/to/fluxology-site && docker compose cp contact-api:/data/inquiries.jsonl "/var/backups/inquiries-$(date +\%F).jsonl"
```

(`%` must be escaped as `\%` inside a crontab.)

---

## 7. Enabling email later

### What an SMTP relay is — and is not

Setting `SMTP_HOST` does **not** hand the contact form to anyone else. The form,
the validation, the rate limiting, the honeypot, and the stored JSONL record all
stay on your server exactly as they are. An SMTP relay is nothing more than mail
**transport**: after the inquiry is already safely on disk, the service opens a
connection to the relay and asks it to deliver one notification message to you.
If the relay is down or misconfigured, the failure is logged to stderr and the
inquiry is *still* recorded and *still* reported as successful to the visitor —
email is strictly best-effort on top of durable local storage.

That is a completely different arrangement from a third-party form service,
where the visitor's browser posts directly to someone else's endpoint and that
company holds the submission.

### Configure it

`SMTP_HOST` is the on/off switch. With it unset (the current state) the service
never even imports its mail library. To enable email, add the values to `.env`
in the same directory as `docker-compose.yml`:

```bash
# .env  — chmod 600, never committed (.gitignore already excludes it)
SMTP_HOST=smtp.example.net
SMTP_PORT=587                       # 587 = STARTTLS (usual), 465 = implicit TLS, 25 = unauthenticated relay
SMTP_SECURE=false                   # true ONLY for implicit TLS on 465
SMTP_USER=notifications@fluxology.ca
SMTP_PASS=…                         # the real password
MAIL_TO=info@fluxology.ca           # where inquiries are delivered
MAIL_FROM=notifications@fluxology.ca # envelope sender; must be an address the relay may send as
```

These names match `services/contact-api/config.mjs` exactly. `SMTP_HOST`,
`SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` are bare pass-throughs in
`docker-compose.yml` — Compose injects them only when they are actually set, so
leaving them out genuinely means "unset". Omit **both** `SMTP_USER` and
`SMTP_PASS` for an unauthenticated relay.

Apply and verify:

```bash
docker compose up -d contact-api
docker compose logs contact-api | tail -n 5
# [contact-api] Email delivery enabled: relaying via smtp.example.net:587 to info@fluxology.ca

curl -s https://fluxology.ca/api/health
# {"status":"ok","emailEnabled":true,"uptimeSeconds":…}
```

The visitor's address is never used as the sender — it goes in `Reply-To` only,
so replying works while SPF and DKIM stay intact.

### Getting a mailbox and a way to send

You need two things: a mailbox that receives `info@fluxology.ca`, and an SMTP
relay allowed to send as your domain. Most options give you both. Evaluate the
current terms yourself before committing — plans and free tiers change.

- **Zoho Mail** — has historically offered a free tier for a single custom
  domain with a small number of mailboxes, plus SMTP access. Cheapest path to a
  real `info@fluxology.ca` inbox.
- **Namecheap Private Email** — the domain's DNS is already managed at
  Namecheap, so mailbox setup and the required DNS records are done in one place
  with the fewest moving parts. Paid, inexpensive.
- **Microsoft 365 / Google Workspace** — full-featured, per-mailbox pricing,
  overkill for one inbox but worth it if you want calendar and documents too.
- **A transactional sender** (Postmark, Mailgun, Amazon SES, Resend, Brevo …) —
  these send well but most do **not** give you an inbox. Pair one with a mailbox
  provider, or use forwarding, if you go this route.

Whichever you pick, you will have to add DNS records at the domain's DNS host so
your mail is not treated as spam:

- **SPF** — a `TXT` record on the apex authorizing the provider's servers
  (e.g. `v=spf1 include:<provider> ~all`). Exactly one SPF record per domain;
  merge providers into a single record rather than adding a second one.
- **DKIM** — a `TXT` (sometimes `CNAME`) record on a provider-specified selector
  hostname, publishing the signing key.
- **DMARC** — a `TXT` record at `_dmarc` telling receivers what to do when SPF
  and DKIM fail, and where to send reports. Start permissive
  (`v=DMARC1; p=none; rua=mailto:…`) and tighten to `quarantine`/`reject` once
  reports look clean.
- **MX** — required if the provider hosts your *inbox*, not just sending.

The provider will give you the exact values; the point here is simply that these
records exist and are not optional if you want delivery to land in an inbox.

---

## 8. Updating the site

```bash
cd /path/to/fluxology-site
git pull
docker compose up -d --build
```

Only what changed is rebuilt and recreated. Because `dist/` is baked into the
image (section 4.4), **content changes require the `--build` flag** — a plain
restart re-runs the old image.

Editing only `caddy/Caddyfile` needs no rebuild at all. The file is bind-mounted
read-only, so validate and hot-reload it instead (zero downtime, certificates
stay in memory):

```bash
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose exec caddy caddy reload  --config /etc/caddy/Caddyfile
```

Refreshing the base images:

```bash
docker compose pull                # caddy:2-alpine
docker compose build --no-cache    # node:22-alpine, httpd:2.4-alpine
docker compose up -d
```

---

## 9. Sub-sites and the dashboard subdomains

### The three dashboards that already exist

`office.fluxology.ca`, `deals.fluxology.ca` and `jobs.fluxology.ca` serve the
static dashboard apps that live at `public/office-scout/`, `public/deals/` and
`public/jobs/`. Because they sit under `public/`, the main Astro build already
copies them into `dist/`, and Apache already serves them at
`/office-scout/`, `/deals/` and `/jobs/`. They need **no extra container and no
separate build**.

`caddy/Caddyfile` gives each one its own hostname with a `(dashboard)` snippet
that rewrites the path internally:

```
office.fluxology.ca  ->  rewrite to /office-scout/...  ->  apache:6080
```

The rewrite is internal, so the browser keeps the clean subdomain URL — the
same behaviour the site previously got from 200-rewrites at its old host. The
snippet also strips the internal prefix out of any redirect Apache emits, so
`/office-scout/` never leaks into the address bar.

To add a fourth dashboard: drop its directory under `public/`, add a DNS record,
and add three lines to `caddy/Caddyfile`:

```
newthing.fluxology.ca {
	import dashboard newthing
}
```

Each hostname still needs its own DNS record pointing at this VPS before Caddy
can obtain a certificate for it — see [section 3](#3-dns--do-this-before-the-first-start).

### A sub-site with its own container

`caddy/Caddyfile` ends with a ready-to-copy template block covering four cases:
(a) one container serving the whole sub-site, (b) a sub-site with its own
`/api/*` upstream, (c) static files served by Caddy directly with no extra
container, and (d) a plain hostname redirect. The procedure is four steps and
requires no restructuring:

1. **DNS.** Point an `A` (and `AAAA`, if applicable) record for
   `sub.fluxology.ca` at the VPS. Caddy cannot obtain a certificate before the
   name resolves here.
2. **Compose.** Add the container(s) to `docker-compose.yml` with
   `networks: [fluxology-network]` and **no `ports:` mapping** — Caddy reaches
   them by service name, and not publishing them keeps them off the host's
   interfaces. A sub-site living in its *own* Compose project joins the same
   network by declaring it external:

   ```yaml
   networks:
     fluxology-network:
       external: true
       name: fluxology-network
   ```

   (`docker-compose.yml` names the network explicitly so this works.)
3. **Caddyfile.** Uncomment and edit one template block. The minimum is:

   ```caddyfile
   sub.fluxology.ca {
       import site-defaults
       reverse_proxy sub-web:8080
   }
   ```

   `import site-defaults` is what gives the sub-site the same compression, HSTS,
   `nosniff`, `Server`-header suppression, and access logging as the main site —
   which is why HSTS stays defined in exactly one place across all hostnames.
4. **Apply.**

   ```bash
   docker compose up -d
   docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
   docker compose exec caddy caddy reload  --config /etc/caddy/Caddyfile
   ```

   Caddy fetches the new hostname's certificate on its own.

While experimenting, uncomment the staging `acme_ca` line
([section 3](#experimenting-safely--the-staging-ca)) so a DNS mistake cannot
burn the production rate limit.

> **HSTS note:** the site-wide header includes `includeSubDomains`, so once a
> browser has seen it, *every* `*.fluxology.ca` hostname must be HTTPS-only.
> Plan sub-sites accordingly. `preload` is deliberately **not** set — it is very
> hard to undo.

---

## 10. Operational warnings

### Never run `docker compose down -v`

The `-v` flag deletes the named volumes. On this stack that means:

- **every contact form inquiry ever received** (`fluxology_inquiry_data`) —
  currently the only copy, since email is off; and
- **the ACME account key and all certificates** (`fluxology_caddy_data`) —
  forcing re-issuance, which runs into Let's Encrypt's rate limits and can leave
  the site without a valid certificate for days.

Plain `docker compose down` is safe: it stops and removes the containers and
leaves the volumes alone. If you genuinely need to reset a volume, back it up
first (section 6) and remove that one volume by name.

### Delete a stale `HTTP_PORT=6080` from `.env`

In the previous single-container setup, `HTTP_PORT` published **Apache** on the
host. It now sets **Caddy's** HTTP port (`"${HTTP_PORT:-80}:80"`). Leaving
`HTTP_PORT=6080` in an old `.env` silently moves the public entrypoint to port
6080, so:

- the HTTP→HTTPS redirect never reaches visitors, and
- the ACME HTTP-01 challenge fails, so **no certificate is ever issued**.

Leave `HTTP_PORT` and `HTTPS_PORT` at 80/443 unless something upstream still
maps 80 → `HTTP_PORT` and 443 → `HTTPS_PORT`.

### Do not add `ports:` to `apache` or `contact-api`

Keeping them off the host's interfaces is what removes the plaintext bypass
around TLS and HSTS. Debug them through `docker compose exec` instead
(section 11.2).

### Keep `.env` at mode 600

Once SMTP is configured it holds a password in plaintext. `.gitignore` already
excludes `.env` while keeping `.env.example`.

---

## 11. Troubleshooting

### 11.1 Certificate issuance fails

Symptoms in `docker compose logs caddy`: repeated ACME errors, challenge
timeouts, `could not get certificate from issuer`, or `no OCSP` warnings on a
certificate that was never obtained.

Work through these in order:

1. **Does the name resolve to this VPS?** From a machine that is not the VPS:
   `dig +short fluxology.ca A` and compare with the VPS's public IP
   (`curl -s https://ifconfig.me`). This is by far the most common cause — see
   [section 3](#3-dns--do-this-before-the-first-start).
2. **Is port 80 reachable from outside?** Let's Encrypt validates over plain
   HTTP on port 80. Check the firewall, the provider's security group, and any
   NAT rule. From elsewhere: `curl -sSI http://fluxology.ca/`.
3. **Is there a stale AAAA record?** If an AAAA record exists, the challenge is
   attempted over IPv6 first. Remove it or make it correct.
4. **Is Caddy actually bound to 80/443?** `docker compose ps` should show
   `0.0.0.0:80->80/tcp` and `0.0.0.0:443->443/tcp`. If not, check `HTTP_PORT`
   in `.env` ([section 10](#10-operational-warnings)).
5. **Rate limited?** If you have already burned attempts, switch to the staging
   CA ([section 3](#experimenting-safely--the-staging-ca)), get the whole path
   working there, then switch back.

Once the underlying problem is fixed, Caddy retries on its own; `docker compose
restart caddy` forces an immediate attempt.

### 11.2 Reaching the backends (they are not on the host)

```bash
# Static site, from inside the Caddy container
docker compose exec caddy wget -qO- http://apache:6080/ | head -n 20

# Contact API health, from inside its own container
docker compose exec contact-api node -e \
  "fetch('http://127.0.0.1:8081/api/health').then(r=>r.text()).then(console.log)"
```

The contact-api image is `node:22-alpine` plus nodemailer and nothing else — no
`curl` is installed — which is why its health probe uses Node's built-in
`fetch` rather than an HTTP client binary.

### 11.3 Logs

```bash
docker compose logs -f caddy         # access logs, TLS/ACME activity
docker compose logs -f apache        # Apache access + error logs
docker compose logs -f contact-api   # inquiry service, email status, warnings
docker compose logs --tail=100 -f    # everything
```

All three services log to the container's stdout/stderr — there is no log
directory and no bind mount. Apache's access log uses the `proxy_combined`
format defined in `docker/apache/httpd.conf`: the first column is the real
visitor IP recovered from `X-Forwarded-For` by `mod_remoteip`, with
`peer=<addr>` appended showing the actual connection peer (Caddy). Compose
rotates each service's JSON log file at 10 MB × 3.

### 11.4 Health checks

Every service defines a healthcheck:

```bash
docker compose ps                    # STATUS column shows (healthy)/(unhealthy)
docker inspect --format='{{.State.Health.Status}}' fluxology-contact-api
```

- `caddy` — `wget` against its admin API at `http://127.0.0.1:2019/config/`
  (internal to the container only; never published).
- `apache` — `curl -f http://localhost:6080/`.
- `contact-api` — Node `fetch` against `/api/health`.

Publicly, `https://fluxology.ca/api/health` returns
`{"status":"ok","emailEnabled":…,"uptimeSeconds":…}`.

`depends_on` deliberately uses "started", not "healthy", so a broken backend can
never stop the edge from starting and take the whole site offline. A failing
contact-api means `/api/*` returns 502 while the static site keeps serving.

### 11.5 Verify the contact form end to end

This writes a real row into the inquiry log, so use an obvious test value and
delete or ignore it afterwards. Note the rate limit: 5 submissions per IP per 15
minutes by default (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`), after which you
get a `429`.

```bash
# 1. JSON path — what the hydrated Svelte form uses
curl -s https://fluxology.ca/api/contact \
  -H 'content-type: application/json' \
  -d '{"fullName":"Deploy Test","email":"test@example.com","serviceInterest":"general","message":"Ignore me - deployment smoke test."}'
# {"ok":true}

# 2. It landed on disk
docker compose exec -T contact-api tail -n 1 /data/inquiries.jsonl | jq .

# 3. No-JS path — urlencoded, answered with a 303 redirect
#    (-i prints the response headers; do not use -I here, that would send HEAD)
curl -si https://fluxology.ca/api/contact \
  -d 'fullName=Deploy Test&email=test@example.com&serviceInterest=general&message=Ignore me - no-JS smoke test.' \
  | grep -iE '^(HTTP|location)'
# HTTP/2 303
# location: /contact-received/

# 4. Validation is enforced server-side
curl -s https://fluxology.ca/api/contact \
  -H 'content-type: application/json' -d '{"fullName":"x","email":"nope","serviceInterest":"general","message":"too short"}'
# {"ok":false,"error":"…","fields":{…}}

# 5. The honeypot silently discards — 200, but nothing is stored
curl -s https://fluxology.ca/api/contact \
  -H 'content-type: application/json' \
  -d '{"fullName":"Bot Test","email":"bot@example.com","serviceInterest":"general","message":"Honeypot check line.","website":"http://spam.example"}'
# {"ok":true}   ← and the line count below is unchanged
docker compose exec contact-api wc -l /data/inquiries.jsonl
```

Then exercise the real form in a browser: submit from
`https://fluxology.ca/#contact` and confirm the in-page success message, and
confirm the row appears in the log. Repeat with JavaScript disabled — the native
submit posts urlencoded to the same endpoint and lands on `/contact-received/`.

Valid `serviceInterest` values are `fabrication`, `3d-lab`, `greenhouse`,
`orchard`, `multiple`, `general` (see `services/contact-api/config.mjs`).

### 11.6 Removing a test row

The log is plain JSONL, so a bad line can be filtered out. Two things matter:
stop the service first (it holds the file open and appends to it), and put the
ownership and mode back afterwards — the service runs as uid 1000 and needs
write access to the file itself, not just to `/data`.

Editing the volume directly with a throwaway container handles both:

```bash
# 1. Always take a copy first
docker compose cp contact-api:/data/inquiries.jsonl "./inquiries-before-edit.jsonl"

# 2. Stop the service so nothing is appended mid-edit
docker compose stop contact-api

# 3. Filter the file in place on the volume, then restore owner + mode
docker run --rm -v fluxology_inquiry_data:/data alpine sh -c "
  grep -v 'Deploy Test' /data/inquiries.jsonl > /data/inquiries.tmp &&
  mv /data/inquiries.tmp /data/inquiries.jsonl &&
  chown 1000:1000 /data/inquiries.jsonl &&
  chmod 600 /data/inquiries.jsonl"

# 4. Restart and check
docker compose start contact-api
docker compose exec contact-api ls -l /data/inquiries.jsonl   # -rw------- 1 node node
docker compose exec contact-api wc -l /data/inquiries.jsonl
```

Then submit one more test inquiry (11.5) to confirm writes still succeed — a
wrong owner or mode shows up as a `500` from `/api/contact`, not as a silent
failure.

### 11.7 Site not loading at all

```bash
docker compose ps                    # are all three up?
sudo ss -tulpn | grep -E ':(80|443)\b'   # is Caddy actually bound?
docker compose logs --tail=50 caddy
```

If the containers are healthy and the ports are bound but nothing arrives, the
problem is upstream of Docker: firewall, cloud security group, or DNS.

### 11.8 Build fails

```bash
docker compose build --no-cache
df -h                                # out of disk?
```

The two usual causes are **no outbound network access during the build** (npm
registry and Google Fonts are both required) and a wrong Node version if you
are building outside Docker (`>= 22.12`; the Dockerfile pins `node:22-alpine`).

---

## Quick reference

```bash
docker compose up -d --build                    # deploy / redeploy after changes
docker compose ps                               # status + health
docker compose logs -f contact-api              # per-service logs
docker compose exec contact-api tail -n 10 /data/inquiries.jsonl   # read inquiries
docker compose cp contact-api:/data/inquiries.jsonl ./backup.jsonl # back them up
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile  # apply Caddyfile edits
docker compose down                             # stop (volumes SURVIVE)
docker compose down -v                          # ☠ NEVER — destroys inquiries + certificates
```
