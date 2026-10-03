// In-memory stand-in for the slice of Prisma the routes use (no database needed).
// It is NOT Postgres: it does not test SQL, migrations or performance — it lets
// route logic (auth, RBAC, validation, enforcement rules) run for real.
const crypto = require('node:crypto');

const DEFAULTS = {
  vendor: { dpaSigned: false, riskTier: 'UNCLASSIFIED', isSubProcessor: false },
  evidence: { reviewStatus: 'PENDING' },
  incident: { status: 'DETECTED', severity: 'MEDIUM', isPersonalDataBreach: false, dpbNotificationRequired: false, dpbNotifiedAt: null, affectedPrincipalsNotifiedAt: null },
  consent: { status: 'GRANTED', isMinorDataSubject: false, parentalConsentVerified: false },
  webhookEndpoint: { enabled: true },
  dataAsset: { scanComplete: true, indexedAsHash: false },
  connector: { status: 'NOT_CONFIGURED' },
  dsar: { status: 'RECEIVED' },
};

function makeDb() {
  const tables = {};
  const rows = (n) => (tables[n] ||= []);
  const match = (row, where = {}) => Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return v.some((w) => match(row, w));
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('equals' in v) return String(row[k]).toLowerCase() === String(v.equals).toLowerCase();
      if ('in' in v) return v.in.includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
  const shape = (row, select) => (select && row
    ? Object.fromEntries(Object.entries(select).filter(([, v]) => v === true).map(([k]) => [k, row[k]]))
    : row);
  // Minimal relation support: `include: { dataAsset: ... }` resolves via row.dataAssetId
  // (to-one relations only; to-many and _count are ignored).
  const inc = (row, include) => {
    if (!row || !include) return row;
    const out = { ...row };
    for (const [k, v] of Object.entries(include)) {
      if (!v || k === '_count') continue;
      const fk = row[`${k}Id`];
      if (fk === undefined) continue;
      const related = rows(k).find((r) => r.id === fk) || null;
      out[k] = related && typeof v === 'object' ? shape(inc(related, v.include), v.select) : related;
    }
    return out;
  };
  const model = (name) => ({
    findFirst: async ({ where, select, include } = {}) => shape(inc(rows(name).find((r) => match(r, where)) || null, include), select),
    findUnique: async ({ where, select } = {}) => shape(rows(name).find((r) => match(r, where)) || null, select),
    findMany: async ({ where, select, include } = {}) => rows(name).filter((r) => match(r, where)).map((r) => shape(inc(r, include), select)),
    count: async ({ where } = {}) => rows(name).filter((r) => match(r, where)).length,
    create: async ({ data, select }) => {
      const row = { id: data.id || crypto.randomUUID(), createdAt: new Date(), ...(DEFAULTS[name] || {}), ...data };
      rows(name).push(row);
      return shape(row, select);
    },
    createMany: async ({ data }) => {
      data.forEach((d) => rows(name).push({ id: crypto.randomUUID(), createdAt: new Date(), ...(DEFAULTS[name] || {}), ...d }));
      return { count: data.length };
    },
    update: async ({ where, data, select }) => {
      const row = rows(name).find((r) => match(r, where));
      Object.assign(row, data);
      return shape(row, select);
    },
    updateMany: async ({ where, data }) => {
      const hit = rows(name).filter((r) => match(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    deleteMany: async ({ where } = {}) => {
      const keep = rows(name).filter((r) => !match(r, where));
      const count = rows(name).length - keep.length;
      tables[name] = keep;
      return { count };
    },
    // Matches on the `create` payload (the real compound-unique `where` key is opaque here).
    upsert: async ({ create, update }) => {
      const row = rows(name).find((r) => Object.entries(create).every(([k, v]) => r[k] === v));
      if (row) { Object.assign(row, update); return row; }
      const made = { id: crypto.randomUUID(), createdAt: new Date(), ...create };
      rows(name).push(made);
      return made;
    },
  });
  const proxy = new Proxy({}, {
    get: (_, n) => {
      if (n === '_tables') return tables;
      if (n === '$transaction') return async (fn) => fn(proxy);
      if (n === '$executeRaw' || n === '$queryRaw') return async () => 1;
      return model(n);
    },
  });
  return proxy;
}

module.exports = { makeDb };
