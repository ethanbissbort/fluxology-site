/**
 * RFC 5322 message rendering and tolerant parsing (SDD v2 §B5/§B6).
 *
 * Rendering: CRLF line endings, folded headers, RFC 2047 encoded-words for
 * non-ASCII header text, base64 text/plain body. Parsing: header unfolding,
 * encoded-word decoding, base64/quoted-printable bodies, first text/plain
 * part of a multipart. Inbound content is untrusted data — parsing never
 * executes or interprets anything.
 */

const CRLF = '\r\n';

function needsEncoding(value) {
  return /[^\x20-\x7e]/.test(value);
}

/** RFC 2047 B-encoding, chunked to keep encoded words within length limits. */
function encodeWord(value) {
  const bytes = Buffer.from(value, 'utf8');
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 42) {
    chunks.push(`=?UTF-8?B?${bytes.subarray(i, i + 42).toString('base64')}?=`);
  }
  return chunks.join(`${CRLF} `);
}

function headerValue(value) {
  return needsEncoding(value) ? encodeWord(value) : value;
}

/** Fold a header line at commas/spaces to keep physical lines under 78 chars. */
function foldHeader(name, value) {
  const full = `${name}: ${value}`;
  if (full.length <= 78 || value.includes(`${CRLF} `)) return full;
  const parts = value.split(', ');
  if (parts.length > 1) {
    let out = `${name}: ${parts[0]}`;
    for (const part of parts.slice(1)) out += `,${CRLF} ${part}`;
    return out;
  }
  return full; // a single long token (e.g. URL) is legal up to 998 chars
}

export function formatAddress({ name, email }) {
  if (!name) return email;
  const safe = needsEncoding(name) ? encodeWord(name) : /[^\w .-]/.test(name) ? `"${name.replace(/"/g, '\\"')}"` : name;
  return `${safe} <${email}>`;
}

export function renderEml({ from, to = [], cc = [], subject = '', messageId, inReplyTo = null, references = [], date = new Date(), bodyText = '' }) {
  const headers = [];
  headers.push(foldHeader('From', from));
  if (to.length) headers.push(foldHeader('To', to.join(', ')));
  if (cc.length) headers.push(foldHeader('Cc', cc.join(', ')));
  headers.push(foldHeader('Subject', headerValue(subject)));
  headers.push(`Date: ${date.toUTCString().replace('GMT', '+0000')}`);
  headers.push(`Message-ID: ${messageId}`);
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references.length) headers.push(foldHeader('References', references.join(' ')));
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset=utf-8');
  headers.push('Content-Transfer-Encoding: base64');

  const b64 = Buffer.from(bodyText.replace(/\r?\n/g, '\n'), 'utf8').toString('base64');
  const bodyLines = b64.match(/.{1,76}/g) ?? [''];
  return headers.join(CRLF) + CRLF + CRLF + bodyLines.join(CRLF) + CRLF;
}

function decodeEncodedWords(value) {
  // Adjacent encoded words are joined without the separating whitespace (RFC 2047 §6.2).
  const joined = value.replace(/(\?=)\s+(=\?)/g, '$1$2');
  return joined.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (all, charset, enc, data) => {
    try {
      if (enc.toLowerCase() === 'b') return Buffer.from(data, 'base64').toString('utf8');
      const bytes = data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
      return Buffer.from(bytes, 'binary').toString('utf8');
    } catch {
      return all;
    }
  });
}

function decodeBody(raw, encoding) {
  const enc = (encoding ?? '').toLowerCase().trim();
  if (enc === 'base64') return Buffer.from(raw.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (enc === 'quoted-printable') {
    // Decode to raw bytes first, then reassemble as UTF-8 — decoding =C3=A9
    // via fromCharCode alone would leave latin1 mojibake.
    const bytes = raw
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
    return Buffer.from(bytes, 'binary').toString('utf8');
  }
  return raw;
}

export function parseEml(raw) {
  const normalized = raw.replace(/\r\n/g, '\n');
  const splitAt = normalized.indexOf('\n\n');
  const headerBlock = splitAt === -1 ? normalized : normalized.slice(0, splitAt);
  const bodyBlock = splitAt === -1 ? '' : normalized.slice(splitAt + 2);

  const headers = {};
  let current = null;
  for (const line of headerBlock.split('\n')) {
    if (/^[ \t]/.test(line) && current) {
      headers[current] += ' ' + line.trim();
    } else {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      current = line.slice(0, idx).toLowerCase();
      headers[current] = (headers[current] ? headers[current] + ', ' : '') + line.slice(idx + 1).trim();
    }
  }

  let body = bodyBlock;
  const contentType = headers['content-type'] ?? 'text/plain';
  if (/multipart\//i.test(contentType)) {
    const boundary = contentType.match(/boundary\s*=\s*"?([^";]+)"?/i)?.[1];
    if (boundary) {
      const parts = bodyBlock.split(`--${boundary}`);
      let picked = null;
      for (const part of parts) {
        const partSplit = part.indexOf('\n\n');
        if (partSplit === -1) continue;
        const partHead = part.slice(0, partSplit).toLowerCase();
        if (partHead.includes('text/plain') || (!picked && partHead.includes('text/'))) {
          const enc = partHead.match(/content-transfer-encoding:\s*([^\n]+)/)?.[1];
          picked = decodeBody(part.slice(partSplit + 2).replace(/\n--\s*$/, ''), enc);
          if (partHead.includes('text/plain')) break;
        }
      }
      body = picked ?? bodyBlock;
    }
  } else {
    body = decodeBody(bodyBlock, headers['content-transfer-encoding']);
  }

  return {
    from: headers.from ? decodeEncodedWords(headers.from) : null,
    to: headers.to ? decodeEncodedWords(headers.to) : null,
    cc: headers.cc ? decodeEncodedWords(headers.cc) : null,
    subject: headers.subject ? decodeEncodedWords(headers.subject) : '',
    date: headers.date ?? null,
    message_id: headers['message-id'] ?? null,
    in_reply_to: headers['in-reply-to'] ?? null,
    references: headers.references ? headers.references.split(/[\s,]+/).filter((r) => r.startsWith('<')) : [],
    body: body.trim(),
  };
}

/** Normalized subject for heuristic thread matching (strips Re:/Fwd: prefixes). */
export function normalizeSubject(subject) {
  return (subject ?? '')
    .replace(/^(\s*(re|fwd?|aw)\s*:\s*)+/i, '')
    .trim()
    .toLowerCase();
}
