# External Caddy Integration

The Fluxology repository does **not** run Caddy. The VPS has one independent Caddy container that owns ports 80/443 and TLS for all hosted services.

The Fluxology application stack exposes no host ports. Caddy reaches these containers over one shared Docker bridge network:

- `fluxology-apache:6080`
- `fluxology-contact-api:8081`
- `fluxology-dashboard-api:8082`
- `fluxology-mcp:8083`

## 1. Create the shared Docker network once

```bash
docker network create fluxology-edge
```

If it already exists, Docker will report that and no further action is required.

Attach the existing Caddy container to it once:

```bash
docker network connect fluxology-edge <your-existing-caddy-container-name>
```

The Fluxology `docker-compose.yml` declares `fluxology-edge` as an **external** network, so `docker compose down` will not remove it.

Verify connectivity:

```bash
docker network inspect fluxology-edge
```

You should see the Caddy container plus `fluxology-apache`, `fluxology-contact-api`, `fluxology-dashboard-api`, and `fluxology-mcp` after the Fluxology stack is running.

## 2. Add these blocks to the VPS Caddyfile

The exact location of the VPS-wide Caddyfile is outside this repository. Merge the following into that existing configuration rather than replacing unrelated site blocks.

**This file is the source of truth for the edge contract.** These blocks are what the repository depends on; the previous in-repo `caddy/Caddyfile` no longer exists. Everything below is deliberately explicit and copy-pasteable — nothing here is optional decoration, and every directive is load-bearing for something in this repository. `.github/workflows/ci.yml` extracts the two fenced blocks below and runs `caddy validate` on them on every push, so this document cannot silently drift into a config that does not parse.

### 2a. Global options

A Caddyfile has at most **one** global options block and it must be the first thing in the file. If the VPS Caddyfile already has one, merge the `servers` stanza into it rather than adding a second block. These limits apply VPS-wide, which is intended: nothing hosted here needs a generous header or a slow request.

```caddyfile
{
	servers {
		timeouts {
			# Time allowed to read the request headers and body. A static site
			# plus small JSON endpoints need nothing generous, and short
			# timeouts cheaply shut down slowloris-style connections. Without
			# this, Caddy's defaults are unlimited.
			read_header 10s
			read_body 10s
			# Time allowed to write the response.
			write 30s
			# How long an idle keep-alive connection is held open.
			idle 2m
		}
		# Request line + headers cap. Caddy's default is far larger than any
		# legitimate request to these hostnames. Verified: a 40 kB header is
		# answered 431 and never reaches an upstream.
		max_header_size 32KB
	}
}
```

### 2b. Shared defaults and site blocks

```caddyfile
# -----------------------------------------------------------------------------
# Shared defaults — imported by every Fluxology hostname
# -----------------------------------------------------------------------------
# Edit once, applies to all five. Named `fluxology-defaults` rather than
# something generic so it cannot collide with a snippet already defined in the
# VPS-wide Caddyfile.
(fluxology-defaults) {
	# Response compression. zstd is preferred by clients that support it, gzip
	# is the universal fallback. Apache also compresses (gzip + brotli) and
	# Caddy's `encode` skips any response that already carries a
	# Content-Encoding, so upstream-compressed responses pass through
	# untouched — no double compression, and browsers still get brotli.
	encode zstd gzip

	header {
		# ---------------------------------------------------------------
		# HSTS IS EMITTED HERE AND NOWHERE ELSE.
		# Caddy is the sole TLS terminator and the only process the browser
		# actually talks to, so it is the one layer entitled to assert
		# "this origin is HTTPS-only". docker/apache/httpd.conf and
		# docker/apache/vhost.conf deliberately do NOT set this header and
		# say so in a comment that points back here — do not re-enable it
		# there, or clients receive the header twice and the two values
		# silently diverge the moment one is edited.
		# Add `; preload` only once you are certain EVERY current and future
		# fluxology.ca subdomain is HTTPS-only; preload is hard to undo.
		# ---------------------------------------------------------------
		Strict-Transport-Security "max-age=31536000; includeSubDomains"

		# Applied at the edge so it also covers /api/* JSON responses, which
		# never pass through Apache. `header` replaces rather than appends, so
		# Apache setting the same value on static responses does not duplicate.
		X-Content-Type-Options "nosniff"

		# Don't advertise the server software.
		-Server
	}

	# Access log to the container's stdout — read with
	# `docker logs -f <caddy-container>`.
	#
	# This is the ONLY per-request record anywhere in the stack for /api/* and
	# /data/listings.json: those requests are answered by the Node services and
	# never reach Apache, dashboard-api logs only startup lines and 5xx, and
	# its audit.jsonl records only successful *changed* writes (a 401 is never
	# audited). Without this block a token-guessing run against POST
	# /api/upsert, a 404 probe sweep, or a traffic spike leaves no artifact
	# anywhere — during or after the event.
	log {
		output stdout
		format console
	}
}

# -----------------------------------------------------------------------------
# Main Fluxology site
# -----------------------------------------------------------------------------
www.fluxology.ca {
	redir https://fluxology.ca{uri} permanent
}

fluxology.ca {
	import fluxology-defaults

	# Contact form API. Keep /api/... intact because the service routes on it.
	handle /api/* {
		# Outer guard so oversized junk never reaches Node. 64KiB = 65536,
		# exactly twice contact-api's own MAX_BODY_BYTES (32768) so the
		# service's JSON 413 stays reachable for anything it would reject.
		# Write it as KiB, not KB: Caddy reads `64KB` as 64000.
		request_body {
			max_size 64KiB
		}
		reverse_proxy fluxology-contact-api:8081 {
			# Active health checking: a wedged or still-booting container is
			# taken out of rotation and the request fails fast, instead of
			# hanging. Nothing else in the stack acts on container health —
			# `restart: unless-stopped` reacts to a container EXITING, never
			# to an unhealthy-but-running one.
			health_uri /api/health
			health_interval 30s
			health_timeout 5s

			# Form submissions must never be cached anywhere.
			header_down Cache-Control "no-store"
		}
	}

	handle {
		reverse_proxy fluxology-apache:6080 {
			health_uri /
			health_interval 30s
			health_timeout 5s

			# Apache is spoken to over plain HTTP, so a self-referential
			# redirect it emits (mod_dir's /fabrication -> /fabrication/) can
			# come back with an http:// Location. Rewrite it so a client is
			# never bounced down to plaintext.
			header_down Location "^http://" "https://"
		}
	}
}

# -----------------------------------------------------------------------------
# Office dashboard
# -----------------------------------------------------------------------------
office.fluxology.ca {
	import fluxology-defaults

	# Existing browser code asks for ./data/listings.json. Serve that path from
	# the live persistent dashboard API rather than the static bootstrap file.
	# If this block is missing, misordered, or points at the wrong scope, the
	# request falls through to Apache and quietly serves the build-time
	# snapshot with a 200. That is the failure mode in the troubleshooting
	# table at the end of docs/DEPLOYMENT-VPS.md.
	handle /data/listings.json {
		rewrite * /v1/office/feed
		reverse_proxy fluxology-dashboard-api:8082 {
			health_uri /v1/office/health
			health_interval 30s
			health_timeout 5s
		}
	}

	# Public write surface used by a trusted skill/connector.
	# /api/upsert -> /v1/office/upsert
	# /api/feed   -> /v1/office/feed
	# /api/health -> /v1/office/health
	handle_path /api/* {
		# 1MiB = 1048576, matching dashboard-api's MAX_BODY_BYTES default
		# exactly. `1MB` would be 1000000 — below the service's own limit, so
		# raising DASHBOARD_MAX_BODY_BYTES in .env would be a silent no-op and
		# the service's JSON 413 could never be observed by a real client.
		request_body {
			max_size 1MiB
		}
		rewrite * /v1/office{uri}
		reverse_proxy fluxology-dashboard-api:8082 {
			health_uri /v1/office/health
			health_interval 30s
			health_timeout 5s
		}
	}

	handle {
		rewrite * /office-scout{uri}
		reverse_proxy fluxology-apache:6080 {
			health_uri /
			health_interval 30s
			health_timeout 5s

			# Keep the internal prefix, and the apex hostname, out of anything
			# the browser sees. Apache runs with `ServerName https://fluxology.ca`
			# + `UseCanonicalName On`, so a directory-shaped URL without a
			# trailing slash (e.g. /data) makes it emit
			# `Location: https://fluxology.ca/office-scout/data/` — which would
			# bounce the visitor off this subdomain onto the apex shadow copy
			# with the internal layout exposed. Rewriting to a relative
			# Location keeps them here. Applied in order; the last line repairs
			# the scheme on anything the first two did not match.
			header_down Location "^https?://fluxology\.ca/office-scout/" "/"
			header_down Location "^/office-scout/" "/"
			header_down Location "^http://" "https://"
		}
	}
}

# -----------------------------------------------------------------------------
# Deals dashboard
# -----------------------------------------------------------------------------
deals.fluxology.ca {
	import fluxology-defaults

	handle /data/listings.json {
		rewrite * /v1/deals/feed
		reverse_proxy fluxology-dashboard-api:8082 {
			health_uri /v1/deals/health
			health_interval 30s
			health_timeout 5s
		}
	}

	handle_path /api/* {
		request_body {
			max_size 1MiB
		}
		rewrite * /v1/deals{uri}
		reverse_proxy fluxology-dashboard-api:8082 {
			health_uri /v1/deals/health
			health_interval 30s
			health_timeout 5s
		}
	}

	handle {
		rewrite * /deals{uri}
		reverse_proxy fluxology-apache:6080 {
			health_uri /
			health_interval 30s
			health_timeout 5s
			header_down Location "^https?://fluxology\.ca/deals/" "/"
			header_down Location "^/deals/" "/"
			header_down Location "^http://" "https://"
		}
	}
}

# -----------------------------------------------------------------------------
# Jobs dashboard
# -----------------------------------------------------------------------------
jobs.fluxology.ca {
	import fluxology-defaults

	handle /data/listings.json {
		rewrite * /v1/jobs/feed
		reverse_proxy fluxology-dashboard-api:8082 {
			health_uri /v1/jobs/health
			health_interval 30s
			health_timeout 5s
		}
	}

	handle_path /api/* {
		request_body {
			max_size 1MiB
		}
		rewrite * /v1/jobs{uri}
		reverse_proxy fluxology-dashboard-api:8082 {
			health_uri /v1/jobs/health
			health_interval 30s
			health_timeout 5s
		}
	}

	handle {
		rewrite * /jobs{uri}
		reverse_proxy fluxology-apache:6080 {
			health_uri /
			health_interval 30s
			health_timeout 5s
			header_down Location "^https?://fluxology\.ca/jobs/" "/"
			header_down Location "^/jobs/" "/"
			header_down Location "^http://" "https://"
		}
	}
}

# -----------------------------------------------------------------------------
# MCP connector — authenticated write bridge for approved model clients
# -----------------------------------------------------------------------------
# Full deployment notes: docs/MCP-CONNECTOR.md
mcp.fluxology.ca {
	import fluxology-defaults

	# 512KiB = 524288, matching MCP_MAX_BODY_BYTES exactly.
	request_body {
		max_size 512KiB
	}

	# Streamable HTTP may hold a response stream open; do not buffer it.
	reverse_proxy fluxology-mcp:8083 {
		# Liveness, NOT readiness. /readyz reports 503 whenever the upstream
		# authorization server is unreachable, and health-checking on it takes
		# the whole host out of rotation — including /healthz and
		# /.well-known/oauth-protected-resource, the document a client needs in
		# order to authenticate. The connector could then never bootstrap out
		# of the outage. /healthz answers 200 while the process is alive.
		health_uri /healthz
		health_interval 30s
		health_timeout 5s

		flush_interval -1
	}
}
```

The dashboard API itself returns `Cache-Control: no-store` and does not emit CORS headers. Reads and writes are deliberately same-origin on each dashboard hostname.

The MCP connector also emits no CORS headers and refuses any request carrying an `Origin` header. It authenticates every request itself with OAuth 2.1, so Caddy passes traffic straight through rather than adding its own auth layer.

Note on `request_body`: when Caddy rejects an oversized body it answers `413` with `Content-Length: 0` — **no body at all**. A client must branch on the status code; there is no JSON error object to parse, and the services' own `{"error":"payload_too_large"}` is only ever seen for a body that got past the edge cap.

### What this configuration guarantees

Every one of these was verified against a live Caddy running a faithful local port of the blocks above:

| Directive | What breaks without it |
| --- | --- |
| `log` in `fluxology-defaults` | No per-request record exists anywhere for `/api/*` or `/data/listings.json`. 48 requests including 10 x 404 probes produced **zero** log lines. |
| `Strict-Transport-Security` | Emitted by nobody. Apache is forbidden from setting it (see its HSTS note) and Caddy does not add it on its own. |
| `header_down Location` on the dashboard blocks | `GET https://office.fluxology.ca/data` answers `301 Location: https://fluxology.ca/office-scout/data/` — cross-host, onto the stale apex shadow copy, with the internal prefix exposed. |
| `timeouts` + `max_header_size` | Unbounded header/body read time and a header cap far above anything legitimate. |
| `health_uri` on each `reverse_proxy` | A wedged container stays in rotation. Nothing else in the stack acts on health: Docker's `restart: unless-stopped` reacts to a container exiting, not to an unhealthy one. |
| `KiB`/`MiB` units | `1MB` is 1000000, below dashboard-api's own 1048576 limit, so `DASHBOARD_MAX_BODY_BYTES` becomes a silent no-op. |

## 3. Validate and reload the existing Caddy container

Use the actual container name and Caddyfile path from the VPS-wide Caddy deployment:

```bash
docker exec <caddy-container> caddy validate --config /etc/caddy/Caddyfile
docker exec <caddy-container> caddy reload --config /etc/caddy/Caddyfile
```

If that deployment mounts the file elsewhere, use its real path.

## 4. Verify routing

After the Fluxology stack is up:

```bash
curl -fsS https://fluxology.ca/api/health
curl -fsS https://office.fluxology.ca/api/health
curl -fsS https://deals.fluxology.ca/api/health
curl -fsS https://jobs.fluxology.ca/api/health

curl -fsS https://office.fluxology.ca/data/listings.json | jq '.listings | length'
curl -fsS https://deals.fluxology.ca/data/listings.json | jq '.listings | length'
curl -fsS https://jobs.fluxology.ca/data/listings.json | jq '.listings | length'
```

The three dashboard health responses include `writeEnabled`. It must be `true` after the corresponding ingest token is configured in `.env` and the dashboard API container is recreated.

The MCP connector deliberately serves no public feed route. An unauthenticated MCP request must be challenged, not served:

```bash
curl -fsS https://mcp.fluxology.ca/.well-known/oauth-protected-resource | jq

curl -isS -X POST https://mcp.fluxology.ca/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -20
```

The second command must return `401` with a `WWW-Authenticate: Bearer …` header.

## 5. Direct-write tests

```bash
curl -X POST https://deals.fluxology.ca/api/upsert \
  -H "Authorization: Bearer $DEALS_INGEST_TOKEN" \
  -H "X-Fluxology-Source: manual-test" \
  -H "Content-Type: application/json" \
  --data '{"listings":[{"id":"test-direct-push","category":"Test","title":"Direct push test","listingType":"buy_it_now","active":false}]}'
```

Then verify it appears in the live feed and remove or supersede the test record with a normal upsert. Routine writers should use stable IDs and should not use full-feed replacement unless performing a controlled restore.

## 6. Security boundary

- Only the VPS-wide Caddy container publishes 80/443.
- Fluxology containers publish **no** host ports.
- Read endpoints are public because the dashboards are public.
- Write endpoints require a category-scoped bearer token.
- Use a different token for office, deals, and jobs.
- Never expose those tokens in dashboard JavaScript, static JSON, Git history, screenshots, or browser local storage.
- The dashboard API limits request bodies and serializes writes per category before performing atomic file replacement.
