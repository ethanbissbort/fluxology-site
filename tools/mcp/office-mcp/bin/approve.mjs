#!/usr/bin/env node
/**
 * Human approval CLI for website form submissions (SDD v2 §0.7).
 *
 * This terminal command is the ONLY way a form submission can be approved —
 * no MCP tool can grant approval. It re-displays the exact frozen fields and
 * requires the content-hash prefix so the human confirms what they saw.
 *
 *   node bin/approve.mjs                 # list pending
 *   node bin/approve.mjs show form_…     # display frozen content
 *   node bin/approve.mjs approve form_… --hash abc123def456
 *   node bin/approve.mjs reject form_…
 */
import { Store } from '../../mcp-core/store.mjs';
import { runApprovalCli } from '../../mcp-core/approval.mjs';
import { loadConfig } from '../src/config.mjs';
import { createRepos } from '../src/repos.mjs';

const config = loadConfig();
const store = new Store(config.dataDir);
const repos = createRepos(store);

const code = runApprovalCli(store, process.argv.slice(2), {
  kindLabel: 'form submissions',
  resolveSubject(submissionId) {
    const record = repos.forms.get(submissionId);
    if (!record || !record.content_hash) return null;
    return {
      contentHash: record.content_hash,
      render() {
        const lines = [
          `Form submission ${submissionId}  [${record.state}]`,
          `Target: ${record.method} ${record.target_url}`,
          'Exact fields to transmit:',
        ];
        for (const [key, value] of Object.entries(record.fields)) lines.push(`  ${key}: ${JSON.stringify(value)}`);
        return lines.join('\n');
      },
    };
  },
});
process.exit(code);
