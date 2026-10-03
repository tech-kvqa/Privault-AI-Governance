const { parse } = require('csv-parse/sync');

// Turns an uploaded CSV/JSON buffer into { headers: string[], rows: object[] }.
// Section 5 lists many more source types (XLSX, XML, PDF, databases, cloud
// storage, RAG/vector stores) — those need real connectors/parsers this
// phase doesn't build; this module intentionally throws a clear error for
// anything it can't genuinely parse rather than silently returning nothing.
function parseUpload(buffer, mimeType, filename) {
  const isJson = mimeType === 'application/json' || /\.json$/i.test(filename || '');
  const isCsv = mimeType === 'text/csv' || /\.csv$/i.test(filename || '');

  if (isJson) {
    const text = buffer.toString('utf8');
    const data = JSON.parse(text);
    const rows = Array.isArray(data) ? data : [data];
    const headerSet = new Set();
    rows.forEach((r) => Object.keys(r || {}).forEach((k) => headerSet.add(k)));
    return { headers: Array.from(headerSet), rows };
  }

  if (isCsv) {
    const text = buffer.toString('utf8');
    const records = parse(text, { columns: true, skip_empty_lines: true, trim: true });
    const headers = records.length ? Object.keys(records[0]) : [];
    return { headers, rows: records };
  }

  const err = new Error(
    `Unsupported file type for "${filename}". Phase 2 supports CSV and JSON uploads only — XLSX, XML, PDF, database, cloud storage, and RAG/vector-store connectors are not yet implemented.`
  );
  err.status = 400;
  throw err;
}

module.exports = { parseUpload };
