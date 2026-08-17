# fluxology-mail-mcp

The only email side-effect surface for the Fluxology office workflow (SDD v2 Part B). Zero runtime dependencies, Node ≥ 22, dual-era MCP.

```bash
FLUXOLOGY_MAIL_FROM="Your Name <you@fluxology.ca>" node bin/mail-mcp.mjs
node bin/approve.mjs             # human approval CLI for outbound email
npm test
```

## Lifecycle

```
DRAFT → FROZEN → AWAITING_APPROVAL → APPROVED → SENDING → SENT
  │        │                                      ├→ SEND_FAILED   (approval consumed; re-approve to retry)
  │        └→ mail_unfreeze → DRAFT               └→ OUTCOME_UNKNOWN (never auto-resent)
  └→ CANCELLED
```

- Freezing canonicalizes the exact wire content (from/to/cc/subject/threading headers/body) and hashes it.
- Approval binds that hash and is granted **only** by the local CLI — no MCP tool can grant it.
- `mail_send` consumes the approval atomically: at most one send per approval, even under parallel calls; any content change invalidates the approval by construction.

## Transports

- **`outbox` (default)** — renders the approved message to `<data>/outbox/<id>.eml`; you send it with your own mail client. No credentials, no network.
- **`smtp`** — set `FLUXOLOGY_MAIL_TRANSPORT=smtp` plus `FLUXOLOGY_MAIL_SMTP_HOST/_PORT/_USER/_PASS` (`_SECURE=1` for implicit TLS, otherwise STARTTLS). A connection lost after the message body was transmitted becomes `OUTCOME_UNKNOWN` — verify manually; the server never resends on its own.

## Replies

Export provider replies from your mail client as `.eml` into `<data>/inbox/` and run `mail_ingest_scan`, or paste raw text via `mail_ingest_paste` (lower evidentiary rank: `PASTED_TEXT`). Replies are matched to threads by `In-Reply-To`/`References`, falling back to a flagged subject heuristic. Then record the quote in **fluxology-office-mcp** (`office_quote_record`).

## Configuration (environment)

| Variable | Default | Purpose |
|---|---|---|
| `FLUXOLOGY_MAIL_DATA_DIR` | `~/.fluxology/mail-mcp` | Data root (must be outside this package) |
| `FLUXOLOGY_MAIL_FROM` | – (required to draft/send) | RFC 5322 From |
| `FLUXOLOGY_MAIL_TRANSPORT` | `outbox` | `outbox` or `smtp` |
| `FLUXOLOGY_MAIL_INBOX_DIR` | `<data>/inbox` | Directory scanned for reply `.eml` files |
| `FLUXOLOGY_MAIL_SMTP_*` | – | SMTP settings (only read when transport is `smtp`) |
