// DPDP Act, 2023 Section 16 — cross-border transfer is permitted by
// default, except to countries the Central Government restricts by
// notification (a list it can add to or amend at any time).
//
// HONESTY NOTE: this module does NOT ship a maintained, government-sourced
// list — doing so would silently go stale the moment the notification
// changes, and Privault has no live feed of it in this deployment. Instead
// of pretending to know the current list, this flag is captured as a
// tenant/legal-team attestation on the AiSystem record itself
// (`crossBorderRestrictedCountry`) and the risk engine reads that
// attestation rather than evaluating a country name against a hard-coded
// list. Anyone wiring this up for real use should replace this module with
// a call to whatever source of truth (legal team process, a maintained
// feed) the organization actually trusts.
function explainRestriction() {
  return 'Cross-border restriction is self-attested per AI system, not computed from a maintained government list. Confirm current restricted-country notifications with legal counsel before relying on this flag.';
}

module.exports = { explainRestriction };
