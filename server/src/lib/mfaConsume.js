const { verifyTotp } = require('./totp');

// Atomic, single-use consumption of a TOTP step or recovery code — used by every endpoint
// that accepts either, not just the login path. A plain "read mfaLastStep, check it,
// then write the new value" (what this replaces) has a check-then-act race: two
// concurrent requests carrying the SAME valid code can both read the old value before
// either writes, and both pass. These functions instead do the check *inside* a single
// conditional UPDATE, so only one of two racing requests can ever win — the loser sees
// zero rows affected and is treated as an already-used code, exactly like a real replay.

/**
 * @returns {Promise<number|null>} the consumed step, or null if the code was invalid,
 *   too old, or already consumed (including by a request that won a concurrent race).
 */
async function consumeTotpStep(prisma, userId, secretB32, code, knownLastUsedStep) {
  // Fast, cheap rejection first (bad code, expired window, or already-known-used step) —
  // avoids a database round trip for the common "wrong code" case. This is an optimization
  // only; it grants no authority on its own. The UPDATE below is the actual, final check.
  const step = verifyTotp(secretB32, code, { lastUsedStep: knownLastUsedStep });
  if (step === null) return null;

  const affected = await prisma.$executeRaw`
    UPDATE "users" SET "mfaLastStep" = ${step}
    WHERE "id" = ${userId} AND ("mfaLastStep" IS NULL OR "mfaLastStep" < ${step})
  `;
  return affected > 0 ? step : null;
}

/**
 * @returns {Promise<boolean>} true if this exact recovery-code hash was present and was
 *   just removed by this call; false if it was invalid or already used (including by a
 *   request that won a concurrent race for the same code).
 */
async function consumeRecoveryCode(prisma, userId, hash) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { mfaRecoveryHashes: true } });
    const hashes = Array.isArray(user?.mfaRecoveryHashes) ? user.mfaRecoveryHashes : [];
    if (!hashes.includes(hash)) return false;
    await tx.user.update({
      where: { id: userId },
      data: { mfaRecoveryHashes: hashes.filter((value) => value !== hash) },
    });
    return true;
  });
}

module.exports = { consumeTotpStep, consumeRecoveryCode };
