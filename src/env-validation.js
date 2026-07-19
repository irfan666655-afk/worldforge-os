/*!
 * env-validation.js — production infrastructure key validation (fail-closed).
 *
 * One spec, two consumers:
 *   - src/server.js requires it at boot: seams whose keys are unpopulated
 *     are DISABLED (their routes answer 503 with the ENV code) — the server
 *     still boots so credentialed seams and static serving keep working.
 *   - scripts/validate-env.mjs runs it standalone as the preflight report
 *     (`--strict` exits non-zero on any gap: the production gate).
 *
 * Fail-closed means the seam refuses to operate, loudly and with an
 * actionable code — never that it limps along on undefined credentials.
 */
"use strict";

var SPEC = [
  { code: "ENV-01", key: "SUPABASE_URL",      seam: "roster-api",      fix: "Supabase project URL (Settings → API)" },
  { code: "ENV-02", key: "SUPABASE_ANON_KEY", seam: "roster-api",      fix: "Supabase anon key (Settings → API)" },
  { code: "ENV-03", key: "WF_WEBHOOK_SECRET", seam: "payment-webhook", fix: "shared HMAC secret for webhook signatures (processor dashboard → webhook signing secret)" }
];

function validateEnv(env) {
  env = env || process.env;
  var missing = SPEC.filter(function (s) {
    var v = env[s.key];
    return typeof v !== "string" || !v.trim();
  });
  var seams = {};
  SPEC.forEach(function (s) { if (!(s.seam in seams)) seams[s.seam] = true; });
  missing.forEach(function (s) { seams[s.seam] = false; });
  return { ok: missing.length === 0, missing: missing, seams: seams, spec: SPEC.slice() };
}

module.exports = { validateEnv: validateEnv, SPEC: SPEC };
