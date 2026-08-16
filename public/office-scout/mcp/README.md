# Fluxology Office Scout MCP Servers

Two zero-dependency MCP servers implementing [SDD v2](./docs/SDD-v2.md) (which supersedes the v1 design document per the [design audit](./docs/DESIGN-AUDIT-v1.md)):

| Server | Purpose |
|---|---|
| [`office-mcp/`](./office-mcp/) — **fluxology-office-mcp** | Evidence-first office-space research: taxonomy-strict normalization, conventional + managed scoring, quote/negotiation ledger, outreach preparation/validation, website-form broker, Office Scout dashboard sync, auditable coverage counters. |
| [`mail-mcp/`](./mail-mcp/) — **fluxology-mail-mcp** | The only email side-effect surface: freeze exact messages → out-of-band human approval → send exactly once (default transport writes `.eml` files; SMTP optional) → thread tracking with reply ingestion. |

`mcp-core/` is the shared dependency-free library (protocol, storage, approvals). `docs/` holds the audit, the SDD, and its `.docx` render.

## Requirements

- Node.js ≥ 22. **No `npm install` needed** — both servers run on the Node standard library alone.

## Quickstart (stdio, e.g. Claude Desktop / Claude Code)

```jsonc
// MCP client configuration
{
  "mcpServers": {
    "fluxology-office": {
      "command": "node",
      "args": ["<repo>/public/office-scout/mcp/office-mcp/bin/office-mcp.mjs"],
      "env": {
        // all optional — see office-mcp/README.md
        "FLUXOLOGY_OFFICE_BUDGET_CAD": "850"
      }
    },
    "fluxology-mail": {
      "command": "node",
      "args": ["<repo>/public/office-scout/mcp/mail-mcp/bin/mail-mcp.mjs"],
      "env": {
        "FLUXOLOGY_MAIL_FROM": "Your Name <you@fluxology.ca>"
      }
    }
  }
}
```

Both servers are **dual-era**: they speak MCP 2026-07-28 (per-request `_meta`, `server/discover`) and answer legacy `initialize` clients (2025-11-25 … 2024-11-05). An optional modern-only Streamable HTTP entry exists for the office server (`office-mcp/bin/office-mcp-http.mjs`, loopback-bound by default).

## The human-approval boundary

External side effects (submitting a provider's quote form; sending an email) **cannot be triggered by the model alone**. The flow is always:

1. a tool freezes the exact content and returns its SHA-256;
2. the human runs `node bin/approve.mjs approve <id> --hash <prefix>` in the relevant package directory — the CLI re-displays the exact content first;
3. the side-effect tool verifies and *consumes* the approval atomically (at most one execution per approval; any edit invalidates it by construction).

## Data location

Runtime data lives **outside** this directory (default `~/.fluxology/office-mcp` and `~/.fluxology/mail-mcp`) because everything under `public/` is copied verbatim into the deployed website. Both servers refuse to start with a data root inside their own package.

## Tests

```bash
cd office-mcp && npm test   # node --test, no dependencies
cd mail-mcp && npm test
```

The suites carry the release-blocking battery from SDD v2 §C2 — product-type fidelity ($399/desk is never a $399 office), 24/7-access-vs-HVAC separation, prepayment normalization, approval/idempotency, SSRF/robots policy, prompt-injection resistance, dual-era protocol conformance.
