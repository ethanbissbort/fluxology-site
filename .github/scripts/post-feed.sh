#!/usr/bin/env bash
#
# Push one dashboard feed to its live ingest endpoint.
#
#   TOKEN=<ingest token> post-feed.sh <url> <listings.json>
#
# Why this exists instead of a single `curl --fail-with-body --retry N
# --retry-all-errors`:
#
#   `--fail-with-body` DISABLES curl's status-based retry entirely. Measured
#   with curl 8.5.0 (the version GitHub's ubuntu runners ship) against local
#   servers returning a fixed status, counting requests server-side:
#
#       --fail-with-body --retry 3 --retry-all-errors, 500 server -> 1 request
#       --fail           --retry 3 --retry-all-errors, 500 server -> 4 requests
#       --fail-with-body --retry 3 --retry-all-errors, closed port -> 4 attempts
#
#   So the flag set the workflow used to carry retried only connection-level
#   failures. A genuine transient 502/503 from the edge — the single most
#   likely reason a feed push fails, and the only one worth retrying — was NOT
#   retried, despite three retry flags on the command line.
#
#   The inverse also matters: `--retry-all-errors` would retry a 401 or a 413
#   if it ever did fire. A revoked token and an oversized feed are settled
#   facts; hammering production three more times cannot change them.
#
# This loop retries exactly the transient statuses (408, 429, 5xx) and any
# connection-level failure, and fails immediately on every other 4xx.
set -euo pipefail

url="${1:?usage: post-feed.sh <url> <listings.json>}"
file="${2:?usage: post-feed.sh <url> <listings.json>}"
: "${TOKEN:?ingest token missing — set TOKEN in the step environment}"

attempts="${POST_FEED_ATTEMPTS:-3}"
delay="${POST_FEED_DELAY:-5}"
body="$(mktemp)"
trap 'rm -f "$body"' EXIT

payload="$(jq -c '{listings: .listings}' "$file")"
count="$(jq -r '.listings | length' "$file")"
echo "POST $url  ($count listings, ${#payload} bytes)"

attempt=1
while :; do
  status="$(
    printf '%s' "$payload" |
      curl --silent --show-error --output "$body" --write-out '%{http_code}' \
        --max-time 60 \
        -X POST "$url" \
        -H "Authorization: Bearer $TOKEN" \
        -H 'X-Fluxology-Source: github-feed-sync' \
        -H 'Content-Type: application/json' \
        --data-binary @- || echo 000
  )"

  case "$status" in
    2??)
      echo "  -> $status"
      cat "$body"
      echo
      exit 0
      ;;
    000 | 408 | 429 | 5??)
      if [ "$status" = "000" ]; then
        reason="connection failure"
      else
        reason="transient (HTTP $status)"
      fi
      ;;
    *)
      # 4xx other than 408/429: the request itself is wrong. A retry cannot
      # fix a revoked token, a malformed body or an oversized payload.
      echo "  -> $status (not retryable)" >&2
      # Caddy answers an over-cap body with a 413 and Content-Length: 0, so
      # there may be nothing to print here. That is expected, not a bug.
      cat "$body" >&2
      echo >&2
      exit 1
      ;;
  esac

  if [ "$attempt" -ge "$attempts" ]; then
    echo "  -> $status, giving up after $attempts attempts" >&2
    cat "$body" >&2
    echo >&2
    exit 1
  fi

  echo "  -> $reason, retrying in ${delay}s ($attempt/$attempts)" >&2
  sleep "$delay"
  attempt=$((attempt + 1))
done
