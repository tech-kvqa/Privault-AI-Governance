const { luhnValid, verhoeffValid } = require('./checksums');

// Section 6 — PII Detection Engine. Real, content-based detection for the
// categories that have a verifiable structure (regex, and checksum where a
// real algorithm exists — Luhn for cards, Verhoeff for Aadhaar); header-name
// (dictionary) detection for categories that don't have a verifiable format
// (Name, Address). Every finding says which method produced it and reports
// a confidence derived from actual match counts — never a fabricated score.

const HEADER_HINTS = {
  Name: ['name', 'fullname', 'firstname', 'lastname'],
  Email: ['email', 'emailaddress'],
  Phone: ['phone', 'mobile', 'contactnumber', 'phonenumber'],
  Address: ['address', 'street', 'city', 'pincode', 'zipcode'],
  'Date of Birth': ['dob', 'dateofbirth', 'birthdate'],
  PAN: ['pan', 'pannumber'],
  Aadhaar: ['aadhaar', 'aadhar', 'aadhaarnumber'],
  'Bank Account': ['accountnumber', 'bankaccount', 'acctno'],
  'Credit/Debit Card': ['cardnumber', 'creditcard', 'debitcard'],
  'Customer ID': ['customerid', 'custid'],
  'Employee ID': ['employeeid', 'empid'],
  'IP Address': ['ipaddress', 'ip'],
  'Device ID': ['deviceid', 'imei'],
  Location: ['latitude', 'longitude', 'lat', 'lng', 'geolocation'],
};

function normalizeHeader(h) {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function headerHintCategory(header) {
  const norm = normalizeHeader(header);
  for (const [category, hints] of Object.entries(HEADER_HINTS)) {
    if (hints.some((h) => norm.includes(h))) return category;
  }
  return null;
}

// Each validator returns true/false for a single trimmed string value.
const CONTENT_VALIDATORS = [
  {
    category: 'Email',
    method: 'REGEX',
    test: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  },
  {
    category: 'Phone',
    method: 'REGEX',
    test: (v) => /^(?:\+?91[-\s]?)?[6-9]\d{9}$/.test(v.replace(/[-\s]/g, '')),
  },
  {
    category: 'PAN',
    method: 'REGEX',
    test: (v) => /^[A-Z]{5}\d{4}[A-Z]$/.test(v.toUpperCase()),
  },
  {
    category: 'Aadhaar',
    method: 'CHECKSUM',
    test: (v) => {
      const digits = v.replace(/[\s-]/g, '');
      return /^\d{12}$/.test(digits) && verhoeffValid(digits);
    },
  },
  {
    category: 'Credit/Debit Card',
    method: 'CHECKSUM',
    test: (v) => {
      const digits = v.replace(/[\s-]/g, '');
      return /^\d{13,19}$/.test(digits) && luhnValid(digits);
    },
  },
  {
    category: 'IP Address',
    method: 'REGEX',
    test: (v) => {
      if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) return false;
      return v.split('.').every((o) => Number(o) >= 0 && Number(o) <= 255);
    },
  },
  {
    category: 'Date of Birth',
    method: 'REGEX',
    test: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v),
  },
];

const MAX_ROWS_SCANNED = 2000;
const MAX_VALUES_STORED_PER_COLUMN = 500;

/**
 * @param {string[]} headers
 * @param {object[]} rows
 * @returns {{ findings: object[], values: object[], rowsScanned: number }}
 */
function detectPii(headers, rows) {
  const sample = rows.slice(0, MAX_ROWS_SCANNED);
  const findings = [];
  const values = [];
  // Anything beyond these caps is NOT indexed, so the scan can't support an
  // "absent" conclusion — callers must record that (DataAsset.scanComplete).
  let truncated = rows.length > MAX_ROWS_SCANNED;

  for (const header of headers) {
    const cells = sample.map((r) => (r[header] == null ? '' : String(r[header]).trim()));
    const nonEmpty = cells.filter((c) => c.length > 0);
    if (nonEmpty.length === 0) continue;

    // Try every content validator; keep whichever has the best match ratio.
    let best = null;
    for (const validator of CONTENT_VALIDATORS) {
      const matchedIndexes = [];
      cells.forEach((c, i) => {
        if (c && validator.test(c)) matchedIndexes.push(i);
      });
      const ratio = matchedIndexes.length / nonEmpty.length;
      if (ratio >= 0.6 && (!best || ratio > best.ratio)) {
        best = { category: validator.category, method: validator.method, ratio, matchedIndexes };
      }
    }

    if (best) {
      findings.push({
        category: best.category,
        column: header,
        detectionMethod: best.method,
        confidence: Number(best.ratio.toFixed(2)),
        matchCount: best.matchedIndexes.length,
        sampleRowsScanned: sample.length,
      });
      if (best.matchedIndexes.length > MAX_VALUES_STORED_PER_COLUMN) truncated = true;
      best.matchedIndexes.slice(0, MAX_VALUES_STORED_PER_COLUMN).forEach((i) => {
        values.push({ category: best.category, column: header, value: cells[i], rowNumber: i + 1 });
      });
      continue;
    }

    // No content validator fired — fall back to a header-name (dictionary) hint.
    const hint = headerHintCategory(header);
    if (hint) {
      findings.push({
        category: hint,
        column: header,
        detectionMethod: 'DICTIONARY',
        confidence: 0.55, // header name matched, but content wasn't structurally verified
        matchCount: nonEmpty.length,
        sampleRowsScanned: sample.length,
      });
      if (nonEmpty.length > MAX_VALUES_STORED_PER_COLUMN) truncated = true;
      nonEmpty.slice(0, MAX_VALUES_STORED_PER_COLUMN).forEach((v, idx) => {
        values.push({ category: hint, column: header, value: v, rowNumber: idx + 1 });
      });
    }
  }

  return { findings, values, rowsScanned: sample.length, complete: !truncated };
}

module.exports = { detectPii, HEADER_HINTS, MAX_ROWS_SCANNED };
