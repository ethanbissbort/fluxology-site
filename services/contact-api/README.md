# contact-api

Self-hosted backend for the Fluxology contact form. Replaces the third-party
form service the site was previously wired to — nothing leaves the VPS unless
you deliberately configure an SMTP relay.

- **Runtime:** Node 22, ESM, built-in `node:http`. No web framework.
- **Dependencies:** `nodemailer` only, and it is loaded lazily — a log-only
  deployment never imports it.
- **Port:** `8081` inside the container network. Caddy proxies `/api/*` here;
  Apache keeps serving the static site. Same origin, so there are no CORS
  headers by design.

## Endpoints

### `POST /api/contact`

Accepts both content types:

| Content-Type | Used by | Success | Validation failure |
| --- | --- | --- | --- |
| `application/json` | the hydrated Svelte form | `200 {"ok":true}` | `400 {"ok":false,"error":"…","fields":{…}}` |
| `application/x-www-form-urlencoded` | the no-JS native form submit | `303` → `/contact-received/` | `303` → `/contact-received/?error=1` |

Other statuses (always JSON, both content types): `413` body too large,
`429` rate limited, `500` the inquiry could not be persisted, `405` non-POST.

Fields:

| field | required | max | rules |
| --- | --- | --- | --- |
| `fullName` | yes | 120 | ≥ 2 chars after trim |
| `email` | yes | 200 | basic email shape |
| `serviceInterest` | yes | 60 | one of `fabrication`, `3d-lab`, `greenhouse`, `orchard`, `multiple`, `general` |
| `message` | yes | 5000 | ≥ 10 chars after trim |
| `companyName` | no | 160 | |
| `phone` | no | 40 | |
| `website` | no | — | **honeypot** — must be empty |

A filled `website` field gets `200 {"ok":true}` (or the success redirect) and the
submission is silently dropped. Bots are never told they were detected.

### `GET /api/health`

```json
{ "status": "ok", "emailEnabled": false, "uptimeSeconds": 1234 }
```

Used by the container `HEALTHCHECK` and by Caddy/monitoring.

## Durability

The inquiry is appended to the JSONL log **and fsync'd before** the success
response is written. If that write fails the request returns `500`, even if the
notification email went out — the visitor must find out so they can email
directly instead. Email is best-effort on top: a send failure is logged to
stderr and never fails the request, because the inquiry is already on disk.

## Environment variables

| var | default | purpose |
| --- | --- | --- |
| `PORT` | `8081` | listen port (binds `0.0.0.0`) |
| `INQUIRY_LOG_PATH` | `/data/inquiries.jsonl` | JSONL destination; parent dir is created, file mode `0600` |
| `TRUST_PROXY` | `true` | take the client IP from the first `X-Forwarded-For` entry (Caddy sets it) |
| `RATE_LIMIT_MAX` | `5` | submissions per window per IP |
| `RATE_LIMIT_WINDOW_MS` | `900000` | rate-limit window (15 min) |
| `MAX_BODY_BYTES` | `32768` | request body cap, enforced while streaming |
| `SMTP_HOST` | *(unset)* | **unset ⇒ email is skipped entirely; log-only mode** |
| `SMTP_PORT` | `587` | |
| `SMTP_SECURE` | `false` | `true` for implicit TLS on 465 |
| `SMTP_USER` | *(unset)* | omit for an unauthenticated relay |
| `SMTP_PASS` | *(unset)* | only used when `SMTP_USER` is set |
| `MAIL_TO` | `info@fluxology.ca` | inquiry destination |
| `MAIL_FROM` | *(falls back to `MAIL_TO`)* | envelope sender |

Set `TRUST_PROXY=false` if the service is ever exposed without a reverse proxy
in front of it — otherwise a client can spoof its own rate-limit identity.

## Reading stored inquiries

One JSON object per line:

```json
{"receivedAt":"2026-08-08T14:03:11.482Z","ip":"203.0.113.7","userAgent":"Mozilla/5.0 …","fullName":"Ada Lovelace","email":"ada@example.com","serviceInterest":"fabrication","message":"…","companyName":"Analytical Engines Ltd","phone":"+1 555 0100"}
```

```sh
# newest 10, readable
docker compose exec contact-api tail -n 10 /data/inquiries.jsonl

# pretty-print everything (needs jq on the host)
docker compose exec contact-api cat /data/inquiries.jsonl | jq .

# just the essentials
docker compose exec contact-api cat /data/inquiries.jsonl \
  | jq -r '[.receivedAt, .serviceInterest, .fullName, .email] | @tsv'

# how many came in today
docker compose exec contact-api cat /data/inquiries.jsonl \
  | jq -r 'select(.receivedAt | startswith("2026-08-08")) | .email' | wc -l
```

The file is `0600` and owned by the container's `node` user (uid 1000). Back it
up with the rest of `/data` — it is the only copy of an inquiry in log-only mode.

## Enabling email later

Email is off until `SMTP_HOST` is set. When you have mail hosting:

```yaml
# docker-compose.yml (the infra side owns this file)
environment:
  SMTP_HOST: smtp.example.net
  SMTP_PORT: "587"
  SMTP_SECURE: "false"      # "true" only for implicit TLS on port 465
  SMTP_USER: notifications@fluxology.ca
  SMTP_PASS: ${SMTP_PASS}   # from .env, never committed
  MAIL_TO: info@fluxology.ca
  MAIL_FROM: notifications@fluxology.ca
```

Restart the container and confirm the startup line reads
`Email delivery enabled: relaying via …`, and that `/api/health` reports
`"emailEnabled": true`.

`MAIL_FROM` must be an address your relay is allowed to send as. The visitor's
address is **never** used as the sender — it goes in `Reply-To` only, so SPF and
DKIM stay intact and header injection has nowhere to land.

## Running standalone (no Docker)

```sh
cd services/contact-api
npm ci

INQUIRY_LOG_PATH=./data/inquiries.jsonl PORT=8081 npm start

# in another shell
curl -s localhost:8081/api/health

curl -s localhost:8081/api/contact \
  -H 'content-type: application/json' \
  -d '{"fullName":"Ada Lovelace","email":"ada@example.com","serviceInterest":"fabrication","message":"Quote request for a fabrication run."}'
# {"ok":true}

# no-JS path (303 redirect)
curl -si localhost:8081/api/contact \
  -d 'fullName=Ada Lovelace&email=ada@example.com&serviceInterest=general&message=Testing the no-JS path.' \
  | head -n 1

cat ./data/inquiries.jsonl
```

## Tests

```sh
npm test
```

Spawns the real server on port **8099** and drives it over HTTP: both content
types, every validation failure, the honeypot, the 303 redirects, the body cap
(declared and chunked, with a memory check), rate limiting, the log-write
failure → 500 path, CRLF-injection stripping, file mode, and graceful SIGTERM
shutdown. Temp files land in `$CONTACT_API_TEST_TMP` (default: a `mkdtemp`
under the system temp dir).

## Building the image

```sh
docker build -t fluxology-contact-api:latest services/contact-api
```

Multi-stage `node:22-alpine`, production deps only, runs as the non-root `node`
user, `EXPOSE 8081`, and a `HEALTHCHECK` that calls `/api/health` with Node's
built-in `fetch` (no curl needed in the image). Mount a volume at `/data`; if
you bind-mount a host directory, `chown 1000:1000` it first.

## Security notes

- Body size is capped **while streaming** — an oversized upload is never
  buffered, and past a bounded drain allowance the connection is cut.
- Per-IP rate limiting is in-memory with periodic pruning and a hard entry cap,
  so a flood of unique source addresses cannot grow the table without limit.
- Every field is sanitised before validation: control characters (CR/LF above
  all) are stripped from single-line fields, so nothing can inject a mail
  header. Message newlines are normalised to `\n` and JSON-escaped, keeping one
  inquiry per JSONL line.
- The submitter's address appears only in `Reply-To`, passed to nodemailer as a
  structured value so the library does the header encoding.
- Error responses never echo submitted values.
- No CORS headers are emitted; responses carry `Cache-Control: no-store`,
  `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.
- State is one in-memory rate-limit map. Restarting the container clears it;
  stored inquiries are unaffected.
