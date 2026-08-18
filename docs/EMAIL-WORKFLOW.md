# Fluxology business email — how Claude drafts and (only with approval) sends

The business mail for `@fluxology.ca` is self-hosted on the VPS by the
**fluxology-mail** stack (docker-mailserver: Postfix + Dovecot + Rspamd,
webmail via Roundcube/SOGo, host `mail.fluxology.ca`, submission SMTP 587
STARTTLS / 465 implicit TLS, IMAP 993). Gmail is no longer in the business
path.

The **only** approved side-effect surface for outbound email is
`tools/mcp/mail-mcp` in this repository. Its lifecycle enforces the rule the
office automation states ("any actual email send must require explicit
per-message human approval; never autonomously send"):

```
DRAFT → FROZEN → AWAITING_APPROVAL → APPROVED → SENDING → SENT
```

- Freezing canonicalizes the exact wire content and hashes it; approval
  binds that hash and can be granted **only** by the local CLI
  (`node tools/mcp/mail-mcp/bin/approve.mjs`) — no MCP tool can grant it.
- `mail_send` consumes the approval at most once; any content change voids
  it by construction.

## Wiring mail-mcp to the fluxology-mail stack

mail-mcp is a stdio MCP server — it runs on whatever machine you attach it
from (laptop/desktop is the intended place, since the approval CLI must be
run by a human on the same machine and data dir):

```bash
# once, in a checkout of fluxology-site on the machine you approve from:
claude mcp add fluxology-mail \
  --env FLUXOLOGY_MAIL_FROM="Fluxology Inc. <REPLACE-mailbox@fluxology.ca>" \
  --env FLUXOLOGY_MAIL_TRANSPORT=smtp \
  --env FLUXOLOGY_MAIL_SMTP_HOST=mail.fluxology.ca \
  --env FLUXOLOGY_MAIL_SMTP_PORT=587 \
  --env FLUXOLOGY_MAIL_SMTP_USER=REPLACE-mailbox@fluxology.ca \
  --env FLUXOLOGY_MAIL_SMTP_PASS=REPLACE \
  -- node tools/mcp/mail-mcp/bin/mail-mcp.mjs
```

Use the mailbox created by fluxology-mail's `make first-account` (or any
mailbox added since). `_SECURE=1` switches to implicit TLS on 465; the
default is STARTTLS, which matches port 587. Leaving
`FLUXOLOGY_MAIL_TRANSPORT` unset keeps the safer `outbox` mode: approved
messages render to `.eml` files you send manually from Roundcube.

## The flow, end to end

1. **Scheduled office runs draft, never send.** Each run's OUTREACH QUEUE
   lands in the office dashboard and the completion report contains the
   fully drafted message text.
2. In an interactive session with `fluxology-mail` attached, ask Claude to
   prepare the message: `mail_prepare_message` (optionally bound to the
   office outreach record) → review → `mail_request_approval`, which prints
   the exact frozen content **and the terminal command you must run**.
3. You run `node tools/mcp/mail-mcp/bin/approve.mjs` and approve (or
   reject) that exact hash.
4. `mail_send` submits through `mail.fluxology.ca` as the configured
   mailbox. `SEND_FAILED` consumes the approval (re-approve to retry);
   `OUTCOME_UNKNOWN` is never auto-resent.
5. **Replies**: export the provider's reply as `.eml` into the mail-mcp
   inbox dir and run `mail_ingest_scan` (or paste via `mail_ingest_paste`),
   then record quotes against the office dashboard.

## Deliverability caveats (from the fluxology-mail preflight)

Before relying on outbound mail for outreach, make sure `make preflight` /
`make dns-diff` in the fluxology-mail repo are clean — at the time this doc
was written the domain published DMARC `p=quarantine` with **no SPF
record**, a combination under which nothing sent as `@fluxology.ca` passes
DMARC. Fix DNS first (fluxology-mail `docs/02-dns.md`), or outreach mail
will land in spam or be rejected.
