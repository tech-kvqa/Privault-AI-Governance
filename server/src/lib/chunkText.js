// Section 14 — RAG Governance, "Documents -> Chunking" step. Real,
// deterministic chunking: split on paragraph boundaries first, then hard-
// wrap anything still over the target size, with a small overlap so a
// fact split across chunk boundaries isn't lost entirely. This is genuine
// text processing — no embedding model or network call needed for this
// step, unlike the vector-store step that comes after it.

const TARGET_CHARS = 800;
const OVERLAP_CHARS = 120;
const MAX_CHUNKS = 500; // guardrail against pathological inputs

function splitParagraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function hardWrap(text, size, overlap) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + size, text.length);
    out.push(text.slice(i, end));
    if (end === text.length) break;
    i = end - overlap;
  }
  return out;
}

/**
 * @param {string} text
 * @returns {string[]} chunk contents, in order
 */
function chunkText(text) {
  const paragraphs = splitParagraphs(text);
  const chunks = [];
  let buffer = '';

  const flush = () => {
    if (buffer.trim()) chunks.push(buffer.trim());
    buffer = '';
  };

  for (const p of paragraphs) {
    if (p.length > TARGET_CHARS) {
      flush();
      hardWrap(p, TARGET_CHARS, OVERLAP_CHARS).forEach((c) => chunks.push(c));
      continue;
    }
    if ((buffer + '\n\n' + p).length > TARGET_CHARS) {
      flush();
      buffer = p;
    } else {
      buffer = buffer ? `${buffer}\n\n${p}` : p;
    }
  }
  flush();

  if (chunks.length > MAX_CHUNKS) {
    const err = new Error(`Document produces ${chunks.length} chunks, over the ${MAX_CHUNKS} guardrail — split the file before uploading.`);
    err.status = 400;
    throw err;
  }

  return chunks;
}

// Rows/objects (CSV/JSON) don't have paragraph structure — treat each
// record as one chunk (one row = one retrievable unit), which is the
// standard approach for structured RAG sources.
function chunkRows(rows) {
  return rows.slice(0, MAX_CHUNKS).map((r) => JSON.stringify(r));
}

module.exports = { chunkText, chunkRows, TARGET_CHARS, OVERLAP_CHARS };
