const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { encryptSecret, decryptSecret } = require('./secrets');
// Loaded lazily so the pure crypto / SSRF helpers can be imported (and unit
// tested) without instantiating a database client.
const prisma = () => require('./prisma');

// Section 43 — event delivery. Design notes that matter:
//  * Payloads carry identifiers and event names only — never before/after
//    values — so a webhook can't become a side channel for personal data.
//  * Deliveries are signed (HMAC-SHA256 over "<timestamp>.<body>") so the
//    receiver can verify origin and reject replays.
//  * Endpoint secrets are AES-256-GCM encrypted at rest.
//  * Delivery is best-effort, at-most-once, 5s timeout, NO retry queue —
//    a real deployment that needs guaranteed delivery should put a broker
//    (SQS/Kafka/Rabbit) behind this. The delivery log records every attempt.
//  * SSRF: URLs must be https and must not resolve to private/loopback/
//    link-local/metadata addresses (checked at registration AND delivery;
//    redirects are not followed). A DNS-rebinding race between check and
//    connect remains theoretically possible without pinning the resolved
//    IP; put an egress proxy in front for high-assurance deployments.

function httpError(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}


const generateSecret = () => 'whsec_' + crypto.randomBytes(24).toString('hex');

function signPayload(secret, timestamp, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (l.startsWith('fc') || l.startsWith('fd') || /^fe[89ab]/.test(l)) return true;
    const mapped = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  return true; // not a valid IP — refuse
}

async function assertSafeUrl(urlString) {
  let u;
  try { u = new URL(urlString); } catch { throw httpError('Invalid webhook URL'); }
  const allowInsecure = process.env.WEBHOOK_ALLOW_INSECURE === 'true';
  if (u.protocol !== 'https:' && !(allowInsecure && u.protocol === 'http:')) throw httpError('Webhook URL must use https');
  if (u.username || u.password) throw httpError('Credentials in the webhook URL are not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addrs;
  try {
    addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  } catch { throw httpError('Could not resolve webhook host'); }
  if (process.env.WEBHOOK_ALLOW_PRIVATE !== 'true' && addrs.some((a) => isPrivateAddress(a.address))) {
    throw httpError('Webhook URL resolves to a private, loopback, or link-local address');
  }
  return u;
}

async function deliver(endpoint, event, data) {
  const started = Date.now();
  let statusCode = null;
  let error = null;
  try {
    const url = await assertSafeUrl(endpoint.url);
    const body = JSON.stringify({ event, data, deliveredAt: new Date().toISOString() });
    const ts = Math.floor(Date.now() / 1000).toString();
    const secret = decryptSecret(endpoint.secretEncrypted);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(url, {
        method: 'POST', redirect: 'manual', signal: ctrl.signal, body,
        headers: {
          'Content-Type': 'application/json',
          'X-Privault-Event': event,
          'X-Privault-Timestamp': ts,
          'X-Privault-Signature': signPayload(secret, ts, body),
        },
      });
      statusCode = res.status;
      if (res.status < 200 || res.status >= 300) error = `Non-2xx response (${res.status})`;
    } finally { clearTimeout(timer); }
  } catch (e) {
    error = e.name === 'AbortError' ? 'Timed out after 5s' : e.message;
  }
  return prisma().webhookDelivery.create({
    data: { tenantId: endpoint.tenantId, endpointId: endpoint.id, event, statusCode, error, durationMs: Date.now() - started },
  });
}

async function dispatchEvent(tenantId, event, data) {
  const endpoints = await prisma().webhookEndpoint.findMany({ where: { tenantId, enabled: true } });
  const targets = endpoints.filter((e) => e.events.includes('*') || e.events.includes(event));
  await Promise.all(targets.map((e) => deliver(e, event, data).catch(() => {})));
}

module.exports = {
  encryptSecret, decryptSecret, generateSecret, signPayload,
  isPrivateAddress, assertSafeUrl, deliver, dispatchEvent,
};
