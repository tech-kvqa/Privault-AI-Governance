// Section 18 — Shadow AI Policy Engine. A small, real rule evaluator: given
// an event's facts (external AI? personal data detected? which categories?)
// and the tenant's enabled policies (ordered by priority), returns the
// first matching policy and its action. No network calls, no guesswork —
// `personalDataDetected` and `categories` should come from a real PII scan
// (Phase 2's engine) wherever the event includes an uploaded file.

/**
 * @param {{ isExternalAi: boolean, personalDataDetected: boolean, categories: string[] }} event
 * @param {Array<{ id: string, requireExternalAi: boolean, requirePersonalData: boolean, categories: string[], action: string, enabled: boolean, priority: number }>} policies
 * @returns {{ policy: object|null, action: string }}
 */
function evaluatePolicies(event, policies) {
  const enabled = policies.filter((p) => p.enabled).sort((a, b) => a.priority - b.priority);

  for (const policy of enabled) {
    if (policy.requireExternalAi && !event.isExternalAi) continue;
    if (policy.requirePersonalData && !event.personalDataDetected) continue;
    if (policy.categories.length > 0) {
      const overlap = policy.categories.some((c) => event.categories.includes(c));
      if (!overlap) continue;
    }
    return { policy, action: policy.action };
  }

  return { policy: null, action: 'ALLOW' };
}

module.exports = { evaluatePolicies };
