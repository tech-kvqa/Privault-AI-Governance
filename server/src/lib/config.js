// Refuses to start in production with placeholder secrets. The example values in .env.example, or
// the built-in dev fallback key, would otherwise silently protect real data.
function assertProductionConfig(env = process.env) {
  if (env.NODE_ENV !== 'production') return;
  const problems = [];
  const strong = (name) => {
    const v = env[name];
    if (!v || v.length < 32 || /change-this|dev-only/i.test(v)) problems.push(`${name} must be set to a random value of at least 32 characters`);
  };
  strong('JWT_SECRET');
  strong('WEBHOOK_ENC_KEY');
  strong('PII_INDEX_KEY');
  if (env.PII_INDEX_KEY && env.PII_INDEX_KEY === env.JWT_SECRET) problems.push('PII_INDEX_KEY must be different from JWT_SECRET');
  if (!env.DATABASE_URL) problems.push('DATABASE_URL is required');
  if (problems.length) throw new Error('Unsafe production configuration:\n - ' + problems.join('\n - '));
}
module.exports = { assertProductionConfig };
